// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@nsoft/database';
import { envSchema } from '../../packages/core/src/index.js';
import { claimJob, processNextJob, provisionDomain } from '../../apps/worker/src/jobs.js';
const db = new PrismaClient({
  datasourceUrl:
    process.env.TEST_DATABASE_URL ??
    'postgresql://nsoft_runtime:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc@127.0.0.1:55439/mailcompanion',
});
let tenantId: string, domainId: string, directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'nsoft-worker-test-'));
  const tenant = await db.tenant.create({ data: { name: 'Worker tests' } });
  tenantId = tenant.id;
  const domain = await db.domain.create({
    data: { name: `worker-${randomUUID()}.example.com`, tenantId, verificationToken: 'test' },
  });
  domainId = domain.id;
});
afterAll(async () => {
  await db.job.deleteMany({ where: { entityId: domainId } });
  await db.domain.delete({ where: { id: domainId } });
  await db.tenant.delete({ where: { id: tenantId } });
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
});
describe('Durable jobs and mail database policy', () => {
  it('runtime is not a database superuser and cannot change audit history', async () => {
    const roles = await db.$queryRaw<
      { rolsuper: boolean; rolcreatedb: boolean }[]
    >`SELECT rolsuper,rolcreatedb FROM pg_roles WHERE rolname=current_user`;
    expect(roles[0]).toMatchObject({ rolsuper: false, rolcreatedb: false });
    const permissions = await db.$queryRaw<
      { delete: boolean }[]
    >`SELECT has_table_privilege(current_user,'audit_logs','DELETE') AS delete`;
    expect(permissions[0]?.delete).toBe(false);
  });
  it('claims concurrent jobs once and reclaims stale leases', async () => {
    const first = await db.job.create({ data: { kind: 'TEST', entityId: domainId } });
    const claimed = await Promise.all([claimJob(db), claimJob(db)]);
    expect(claimed.filter((j) => j?.id === first.id)).toHaveLength(1);
    await db.job.update({
      where: { id: first.id },
      data: { lockedAt: new Date(Date.now() - 600000) },
    });
    expect((await claimJob(db))?.id).toBe(first.id);
    await db.job.update({ where: { id: first.id }, data: { status: 'SUCCEEDED' } });
  });
  it('records retry/backoff and stops after bounded attempts', async () => {
    const job = await db.job.create({
      data: { kind: 'UNSUPPORTED', entityId: domainId, attempts: 4 },
    });
    const env = envSchema.parse({
      DATABASE_URL: 'test',
      ENCRYPTION_KEY: 'a'.repeat(64),
      MAIL_HOSTNAME: 'mail.example.com',
      PUBLIC_IPV4: '192.0.2.1',
      DKIM_DIR: directory,
    });
    await processNextJob(db, env);
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('FAILED');
  });
  it('preserves DKIM keys across retries', async () => {
    const env = envSchema.parse({
      DATABASE_URL: 'test',
      ENCRYPTION_KEY: 'a'.repeat(64),
      MAIL_HOSTNAME: 'mail.example.com',
      PUBLIC_IPV4: '192.0.2.1',
      DKIM_DIR: directory,
    });
    await provisionDomain(db, env, domainId);
    const first = await db.domain.findUniqueOrThrow({ where: { id: domainId } });
    const key = await readFile(path.join(directory, first.name, 'nsoft2026.key'), 'utf8');
    await provisionDomain(db, env, domainId);
    expect((await db.domain.findUniqueOrThrow({ where: { id: domainId } })).dkimPublicKey).toBe(
      first.dkimPublicKey,
    );
    expect(await readFile(path.join(directory, first.name, 'nsoft2026.key'), 'utf8')).toBe(key);
  });
});
