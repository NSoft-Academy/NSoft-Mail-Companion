// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { randomBytes } from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { Prisma, type PrismaClient } from '@nsoft/database';
import { z, password, digest, seal, unseal, domainName, type Environment } from '@nsoft/core';
import { hashPassword, platform, type AuthRequest } from './auth.js';
import { ApiError } from './errors.js';
import { hostAction } from '@nsoft/core';
import { audit } from './service.js';

export function setupBootstrap(
  app: Express,
  db: PrismaClient,
  env: Environment,
  limit: RequestHandler,
) {
  let hashing = false;
  app.post('/api/v1/setup/claim', limit, async (req, res) => {
    if (req.get('origin') !== new URL(env.WEB_URL).origin)
      throw new ApiError(403, 'ORIGIN_DENIED', 'Open the setup link on the configured panel.');
    const input = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        name: z.string().min(1).max(100),
        email: z
          .string()
          .email()
          .transform((s) => s.toLowerCase()),
        password,
      })
      .strict()
      .parse(req.body);
    const candidate = await db.systemSetup.findUnique({ where: { id: 'installation' } });
    if (
      !candidate ||
      candidate.claimedAt ||
      !candidate.bootstrapExpiresAt ||
      candidate.bootstrapExpiresAt <= new Date() ||
      candidate.bootstrapHash !== digest(input.token) ||
      (await db.user.count())
    )
      throw new ApiError(
        409,
        'SETUP_UNAVAILABLE',
        'This setup link has expired or was already used. Sign in or resume the installer.',
      );
    if (hashing)
      throw new ApiError(
        409,
        'SETUP_BUSY',
        'Administrator creation is already in progress. Please retry.',
      );
    hashing = true;
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(input.password);
    } finally {
      hashing = false;
    }
    const token = randomBytes(32).toString('hex'),
      csrfToken = randomBytes(24).toString('hex');
    await db.$transaction(
      async (tx) => {
        const setup = await tx.systemSetup.findUnique({ where: { id: 'installation' } });
        if (
          !setup ||
          setup.claimedAt ||
          !setup.bootstrapExpiresAt ||
          setup.bootstrapExpiresAt <= new Date() ||
          setup.bootstrapHash !== digest(input.token)
        )
          throw new ApiError(
            409,
            'SETUP_UNAVAILABLE',
            'This setup link has expired or was already used. Run the installer again to resume.',
          );
        if (await tx.user.count())
          throw new ApiError(
            409,
            'SETUP_CLOSED',
            'An administrator already exists. Sign in instead.',
          );
        const consumed = await tx.systemSetup.updateMany({
          where: { id: 'installation', claimedAt: null, bootstrapHash: digest(input.token) },
          data: { claimedAt: new Date(), bootstrapHash: null, bootstrapExpiresAt: null },
        });
        if (consumed.count !== 1)
          throw new ApiError(409, 'SETUP_CLOSED', 'Setup has already been claimed.');
        const user = await tx.user.create({
          data: { email: input.email, name: input.name, passwordHash, role: 'PLATFORM_ADMIN' },
        });
        await tx.session.create({
          data: {
            tokenHash: digest(token),
            csrfToken,
            userId: user.id,
            expiresAt: new Date(Date.now() + 8 * 3600000),
          },
        });
        await tx.auditLog.create({ data: { actorId: user.id, action: 'SETUP_CLAIM' } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    res.cookie('nsoft_session', token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api',
      maxAge: 8 * 3600000,
    });
    res.status(201).json({ success: true, data: { csrfToken } });
  });
}

async function cloudflare(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  const data = (await response.json()) as { success: boolean; result: unknown };
  if (!response.ok || !data.success)
    throw new ApiError(
      422,
      'DNS_PROVIDER_DENIED',
      'Cloudflare could not complete the request. Check the selected zone and token permissions.',
    );
  return data.result;
}
export function setupRoutes(app: Express, db: PrismaClient, env: Environment) {
  const actor = (req: Express.Request) => (req as AuthRequest).actor;
  app.get('/api/v1/setup/status', platform, async (_req, res) => {
    const [setup, connections, tasks, domains] = await Promise.all([
      db.systemSetup.findUnique({
        where: { id: 'installation' },
        select: {
          claimedAt: true,
          completedAt: true,
          firstDomainId: true,
          deliveryConfirmedAt: true,
        },
      }),
      db.providerConnection.findMany({ select: { id: true, zoneId: true, zoneName: true } }),
      db.systemTask.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          operation: true,
          target: true,
          status: true,
          lastError: true,
          result: true,
          createdAt: true,
        },
      }),
      db.domain.count(),
    ]);
    let host: Record<string, unknown> = {
      available: false,
      detail: 'Install the host service to manage this server from the wizard.',
    };
    try {
      host = await hostAction('status');
    } catch {
      /* Existing Compose installations remain usable. */
    }
    res.json({ success: true, data: { setup, connections, tasks, domains, host } });
  });
  app.post('/api/v1/setup/first-domain', platform, async (req, res) => {
    const input = z
      .object({ name: domainName, tenantName: z.string().min(1).max(100) })
      .strict()
      .parse(req.body);
    const setup = await db.systemSetup.findUnique({ where: { id: 'installation' } });
    if (setup?.firstDomainId) {
      res.json({
        success: true,
        data: await db.domain.findUniqueOrThrow({ where: { id: setup.firstDomainId } }),
      });
      return;
    }
    // Domain uniqueness and serializable setup lock protect interrupted retries.
    const result = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM system_setup WHERE id='installation' FOR UPDATE`;
        const current = await tx.systemSetup.findUnique({ where: { id: 'installation' } });
        if (current?.firstDomainId)
          return tx.domain.findUniqueOrThrow({ where: { id: current.firstDomainId } });
        const tenant = await tx.tenant.create({ data: { name: input.tenantName } });
        const domain = await tx.domain.create({
          data: {
            tenantId: tenant.id,
            name: input.name,
            verificationToken: randomBytes(24).toString('hex'),
          },
        });
        await tx.job.create({ data: { kind: 'PROVISION_DOMAIN', entityId: domain.id } });
        await tx.systemSetup.upsert({
          where: { id: 'installation' },
          create: { firstDomainId: domain.id },
          update: { firstDomainId: domain.id },
        });
        await tx.auditLog.create({ data: audit(actor(req), 'FIRST_DOMAIN_CREATE', domain.id) });
        return domain;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    res.status(201).json({ success: true, data: result });
  });
  app.post('/api/v1/setup/complete', platform, async (req, res) => {
    const input = z
      .object({ receivedLocalTest: z.literal(true), testedExternalDelivery: z.literal(true) })
      .strict()
      .parse(req.body);
    const setup = await db.systemSetup.findUnique({ where: { id: 'installation' } });
    const domain = setup?.firstDomainId
      ? await db.domain.findUnique({
          where: { id: setup.firstDomainId },
          include: { mailboxes: true },
        })
      : null;
    if (
      !domain?.sendingEnabled ||
      !domain.mailboxes.length ||
      !domain.readinessAt ||
      Date.now() - domain.readinessAt.getTime() > 86400000
    )
      throw new ApiError(
        409,
        'SETUP_NOT_READY',
        'Finish domain checks, create a mailbox and enable sending before completing setup.',
      );
    void input;
    await db.systemSetup.update({
      where: { id: 'installation' },
      data: { completedAt: new Date(), deliveryConfirmedAt: new Date() },
    });
    res.json({ success: true });
  });
  app.post('/api/v1/setup/tasks', platform, async (req, res) => {
    const input = z
      .object({
        operation: z.enum(['refresh', 'certificate', 'webmail', 'backup', 'restore-check']),
        target: domainName.optional(),
      })
      .strict()
      .parse(req.body);
    if (input.operation === 'certificate' || input.operation === 'webmail') {
      if (!input.target)
        throw new ApiError(
          422,
          'HOSTNAME_REQUIRED',
          'Choose the mail hostname or an active domain webmail hostname.',
        );
      if (input.target !== env.MAIL_HOSTNAME) {
        const domain = await db.domain.findUnique({
          where: { name: input.target.replace(/^webmail\./, '') },
        });
        if (!input.target.startsWith('webmail.') || !domain?.active || !domain.verifiedAt)
          throw new ApiError(
            422,
            'HOSTNAME_DENIED',
            'Verify and activate the customer domain first.',
          );
      }
    }
    const task = await db.systemTask.create({ data: input });
    await db.auditLog.create({ data: audit(actor(req), 'SYSTEM_TASK_QUEUE', task.id) });
    res.status(202).json({ success: true, data: task });
  });
  app.post('/api/v1/setup/tasks/:id/retry', platform, async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const changed = await db.systemTask.updateMany({
      where: { id, status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, availableAt: new Date(), lastError: null },
    });
    if (!changed.count)
      throw new ApiError(409, 'TASK_NOT_FAILED', 'Only failed tasks can be retried.');
    await db.auditLog.create({ data: audit(actor(req), 'SYSTEM_TASK_RETRY', id) });
    res.json({ success: true, data: { status: 'PENDING' } });
  });
  app.post('/api/v1/setup/providers/cloudflare/zones', platform, async (req, res) => {
    const { token } = z
      .object({ token: z.string().min(20).max(256) })
      .strict()
      .parse(req.body);
    res.json({ success: true, data: await cloudflare(token, 'zones?per_page=50&status=active') });
  });
  app.post('/api/v1/setup/providers/cloudflare', platform, async (req, res) => {
    const input = z
      .object({ token: z.string().min(20).max(256), zoneId: z.string().regex(/^[a-f0-9]{32}$/) })
      .strict()
      .parse(req.body);
    const zone = (await cloudflare(input.token, `zones/${input.zoneId}`)) as { name: string };
    domainName.parse(zone.name);
    const connection = await db.providerConnection.upsert({
      where: { zoneId: input.zoneId },
      create: {
        zoneId: input.zoneId,
        zoneName: zone.name,
        tokenEncrypted: seal(input.token, env.ENCRYPTION_KEY),
      },
      update: { zoneName: zone.name, tokenEncrypted: seal(input.token, env.ENCRYPTION_KEY) },
      select: { id: true, zoneId: true, zoneName: true },
    });
    if (process.env.HOST_AGENT_SOCKET)
      await hostAction('dns-provider', undefined, { ...input, zoneName: zone.name });
    await db.auditLog.create({ data: audit(actor(req), 'DNS_PROVIDER_CONNECT', connection.id) });
    res.json({ success: true, data: connection });
  });
  app.post('/api/v1/setup/backup', platform, async (req, res) => {
    const input = z
      .object({
        repository: z
          .string()
          .min(10)
          .max(500)
          .regex(/^s3:https:\/\/[a-zA-Z0-9./_-]+$/),
        password: z.string().min(20).max(256),
        accessKey: z.string().min(1).max(256),
        secretKey: z.string().min(1).max(256),
      })
      .strict()
      .parse(req.body);
    try {
      await hostAction('backup-configure', undefined, input);
    } catch {
      throw new ApiError(
        503,
        'BACKUP_CONFIGURATION_FAILED',
        'The host service could not save backup settings. Retry after checking server health.',
      );
    }
    await db.auditLog.create({ data: audit(actor(req), 'BACKUP_CONFIGURE', 'installation') });
    res.json({ success: true });
  });
  app.get('/api/v1/setup/diagnostics', platform, async (_req, res) => {
    const tasks = await db.systemTask.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: { operation: true, status: true, lastError: true, createdAt: true },
    });
    // Strict allowlist; never include env, tokens, addresses, raw provider errors or logs.
    const report = {
      product: 'NSoft Mail Companion',
      generatedAt: new Date().toISOString(),
      tasks,
      checks: 'Use the authenticated setup dashboard for hostname-specific checks.',
    };
    res.setHeader('Content-Disposition', 'attachment; filename="nsoft-mail-diagnostics.json"');
    res.json(report);
  });
}
export async function connectionToken(db: PrismaClient, env: Environment, zoneId: string) {
  const connection = await db.providerConnection.findUnique({ where: { zoneId } });
  return connection ? unseal(connection.tokenEncrypted, env.ENCRYPTION_KEY) : env.CLOUDFLARE_TOKEN;
}
