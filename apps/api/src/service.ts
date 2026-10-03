// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@nsoft/database';
import {
  canAccessTenant,
  domainSchema,
  mailboxSchema,
  aliasSchema,
  sendingReady,
  type Actor,
  type Check,
} from '@nsoft/core';
import { hashPassword } from './auth.js';
import { ApiError } from './errors.js';

export async function ownedDomain(db: PrismaClient, actor: Actor, id: string) {
  const domain = await db.domain.findUnique({ where: { id } });
  if (!domain || !canAccessTenant(actor, domain.tenantId))
    throw new ApiError(404, 'NOT_FOUND', 'Domain not found.');
  return domain;
}
export function audit(actor: Actor, action: string, entityId: string, tenantId = actor.tenantId) {
  return { actorId: actor.id, tenantId, action, entityId };
}
export async function createDomain(db: PrismaClient, actor: Actor, body: unknown) {
  const input = domainSchema.parse(body),
    tenantId = actor.role === 'PLATFORM_ADMIN' ? input.tenantId : actor.tenantId;
  if (!tenantId) throw new ApiError(400, 'TENANT_REQUIRED', 'Select a tenant.');
  return db.$transaction(async (tx) => {
    const domain = await tx.domain.create({
      data: {
        name: input.name,
        tenantId,
        quotaMb: input.quotaMb,
        mailboxLimit: input.mailboxLimit,
        verificationToken: randomBytes(24).toString('hex'),
      },
    });
    await tx.job.create({ data: { kind: 'PROVISION_DOMAIN', entityId: domain.id } });
    await tx.auditLog.create({ data: audit(actor, 'DOMAIN_CREATE', domain.id, tenantId) });
    return domain;
  });
}
export async function createMailbox(
  db: PrismaClient,
  actor: Actor,
  domainId: string,
  body: unknown,
) {
  await ownedDomain(db, actor, domainId);
  const input = mailboxSchema.parse(body),
    passwordHash = '{ARGON2ID}' + (await hashPassword(input.password));
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM domains WHERE id=${domainId}::uuid FOR UPDATE`;
      const domain = await tx.domain.findUniqueOrThrow({ where: { id: domainId } });
      if (!domain.active)
        throw new ApiError(409, 'DOMAIN_NOT_READY', 'Verify and provision the domain first.');
      const count = await tx.mailbox.count({ where: { domainId } }),
        sum = await tx.mailbox.aggregate({ where: { domainId }, _sum: { quotaMb: true } });
      if (domain.mailboxLimit !== null && count >= domain.mailboxLimit)
        throw new ApiError(409, 'MAILBOX_LIMIT', 'Domain mailbox limit reached.');
      if ((sum._sum.quotaMb ?? 0) + input.quotaMb > domain.quotaMb)
        throw new ApiError(
          409,
          'QUOTA_EXCEEDED',
          'Allocated mailbox quotas exceed the domain quota.',
        );
      const email = `${input.localPart}@${domain.name}`;
      if (await tx.alias.findUnique({ where: { source: email } }))
        throw new ApiError(409, 'ADDRESS_EXISTS', 'An alias already uses this address.');
      const mailbox = await tx.mailbox.create({
        data: {
          domainId,
          localPart: input.localPart,
          email,
          name: input.name,
          quotaMb: input.quotaMb,
          passwordHash,
        },
      });
      await tx.auditLog.create({
        data: audit(actor, 'MAILBOX_CREATE', mailbox.id, domain.tenantId),
      });
      return publicMailbox(mailbox);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
export function publicMailbox<T extends { passwordHash: string; usedBytes: bigint }>(mailbox: T) {
  const { passwordHash: _passwordHash, usedBytes, ...safe } = mailbox;
  return { ...safe, usedBytes: usedBytes.toString() };
}
export async function createAlias(db: PrismaClient, actor: Actor, domainId: string, body: unknown) {
  const domain = await ownedDomain(db, actor, domainId),
    input = aliasSchema.parse(body);
  if (!domain.active) throw new ApiError(409, 'DOMAIN_NOT_READY', 'Verify the domain first.');
  if (input.externalForwarding)
    throw new ApiError(
      422,
      'FORWARDING_UNSUPPORTED',
      'External forwarding requires SRS/ARC support and is disabled in v1.',
    );
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM domains WHERE id=${domainId}::uuid FOR UPDATE`;
    const source =
      input.localPart === '*' ? `@${domain.name}` : `${input.localPart}@${domain.name}`;
    if (input.destinations.includes(source))
      throw new ApiError(422, 'ALIAS_LOOP', 'An alias cannot forward to itself.');
    const mailboxes = await tx.mailbox.findMany({
      where: { email: { in: input.destinations }, active: true, domainId },
    });
    if (mailboxes.length !== input.destinations.length)
      throw new ApiError(
        422,
        'INVALID_DESTINATION',
        'Aliases must point to active mailboxes in this domain.',
      );
    if (await tx.mailbox.findUnique({ where: { email: source } }))
      throw new ApiError(409, 'ADDRESS_EXISTS', 'A mailbox already uses this address.');
    const alias = await tx.alias.create({
      data: { domainId, source, destinations: input.destinations },
    });
    await tx.auditLog.create({ data: audit(actor, 'ALIAS_CREATE', alias.id, domain.tenantId) });
    return alias;
  });
}
export async function enableSending(db: PrismaClient, actor: Actor, id: string, enabled: boolean) {
  await ownedDomain(db, actor, id);
  return db.$transaction(async (tx) => {
    const domain = await tx.domain.findUniqueOrThrow({ where: { id } });
    const checks = domain.readiness as Check[] | null;
    if (
      enabled &&
      (!domain.active ||
        !domain.readinessAt ||
        Date.now() - domain.readinessAt.getTime() > 24 * 60 * 60 * 1000 ||
        !checks ||
        !sendingReady(checks))
    )
      throw new ApiError(
        409,
        'READINESS_FAILED',
        'Run and pass current delivery checks before enabling sending.',
      );
    const result = await tx.domain.update({ where: { id }, data: { sendingEnabled: enabled } });
    await tx.auditLog.create({
      data: audit(actor, enabled ? 'SENDING_ENABLE' : 'SENDING_DISABLE', id, domain.tenantId),
    });
    return result;
  });
}
