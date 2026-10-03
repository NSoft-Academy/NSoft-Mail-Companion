// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@nsoft/database';
import { envSchema, digest } from '../../packages/core/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { hashPassword, totp } from '../../apps/api/src/auth.js';
const db = new PrismaClient({
  datasourceUrl:
    process.env.TEST_DATABASE_URL ??
    'postgresql://nsoft_runtime:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc@127.0.0.1:55439/mailcompanion',
});
const env = envSchema.parse({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test',
  ENCRYPTION_KEY: 'a'.repeat(64),
  MAIL_HOSTNAME: 'mail.example.com',
  PUBLIC_IPV4: '192.0.2.1',
  WEB_URL: 'http://localhost:3000',
  REQUIRE_MFA: 'true',
});
const app = createApp(db, env);
const origin = 'http://localhost:3000';
let tenantA: string, tenantB: string, domainA: string, domainB: string, userA: string;
let cookie: string, csrf: string;
async function session(id: string) {
  const token = randomUUID(),
    csrf = randomUUID();
  await db.session.create({
    data: {
      userId: id,
      tokenHash: digest(token),
      csrfToken: csrf,
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  return { cookie: `nsoft_session=${token}`, csrf };
}
beforeAll(async () => {
  await db.$connect();
  const marker = randomUUID();
  const a = await db.tenant.create({ data: { name: 'A-' + marker } }),
    b = await db.tenant.create({ data: { name: 'B-' + marker } });
  tenantA = a.id;
  tenantB = b.id;
  const user = await db.user.create({
    data: {
      name: 'Tenant A',
      email: `${marker}@example.com`,
      tenantId: tenantA,
      role: 'DOMAIN_ADMIN',
      passwordHash: await hashPassword('Integration-Password42'),
    },
  });
  userA = user.id;
  ({ cookie, csrf } = await session(user.id));
  const dA = await db.domain.create({
      data: {
        name: `a-${marker}.example.com`,
        tenantId: tenantA,
        verificationToken: 'a',
        active: true,
        verifiedAt: new Date(),
        provisionedAt: new Date(),
        quotaMb: 1024,
      },
    }),
    dB = await db.domain.create({
      data: { name: `b-${marker}.example.com`, tenantId: tenantB, verificationToken: 'b' },
    });
  domainA = dA.id;
  domainB = dB.id;
});
afterAll(async () => {
  const ids = [domainA, domainB].filter(Boolean);
  await db.job.deleteMany({ where: { entityId: { in: ids } } });
  await db.alias.deleteMany({ where: { domainId: { in: ids } } });
  await db.mailbox.deleteMany({ where: { domainId: { in: ids } } });
  await db.domain.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({ where: { tenantId: { in: [tenantA, tenantB].filter(Boolean) } } });
  await db.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB].filter(Boolean) } } });
  await db.$disconnect();
});
function get(path: string) {
  return request(app)
    .get('/api/v1' + path)
    .set('Cookie', cookie);
}
function post(path: string, body: unknown) {
  return request(app)
    .post('/api/v1' + path)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .set('X-CSRF-Token', csrf)
    .send(body);
}
describe('Authentication and MFA', () => {
  it('denies anonymous access', async () => {
    expect((await request(app).get('/api/v1/domains')).status).toBe(401);
  });
  it('requires MFA and rejects wrong credentials', async () => {
    expect((await get('/domains')).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .set('Origin', origin)
          .send({ email: 'nobody@example.com', password: 'wrong' })
      ).status,
    ).toBe(401);
  });
  it('enrolls MFA and requires CSRF', async () => {
    expect(
      (await request(app).post('/api/v1/auth/mfa/enroll').set('Cookie', cookie).send({})).status,
    ).toBe(403);
    const enrollment = await post('/auth/mfa/enroll', {});
    expect(enrollment.status).toBe(200);
    const result = await post('/auth/mfa/confirm', {
      code: totp(enrollment.body.data.secret).generate(),
    });
    expect(result.status).toBe(200);
    expect((await get('/domains')).status).toBe(200);
  });
});
describe('Authorisation and transactional mail management', () => {
  it('does not return foreign domains', async () => {
    const result = await get('/domains');
    expect(result.body.data.map((d: { id: string }) => d.id)).toContain(domainA);
    expect(result.body.data.map((d: { id: string }) => d.id)).not.toContain(domainB);
    expect((await get(`/domains/${domainB}`)).status).toBe(404);
    expect((await get(`/domains/${domainB}/dns`)).status).toBe(404);
    expect(
      (
        await post(`/domains/${domainB}/mailboxes`, {
          localPart: 'hello',
          name: 'Hello',
          password: 'Integration-Password42',
        })
      ).status,
    ).toBe(404);
  });
  it('denies platform administration to domain admins', async () => {
    expect((await get('/users')).status).toBe(403);
    expect((await post('/tenants', { name: 'Illegal' })).status).toBe(403);
  });
  it('does not permit sending without valid recent checks', async () => {
    expect((await post(`/domains/${domainA}/sending`, { enabled: true })).status).toBe(409);
  });
  it('creates hashed mailboxes, prevents duplicates, and enforces quotas', async () => {
    const data = {
      localPart: 'hello',
      name: 'Hello',
      password: 'Integration-Password42',
      quotaMb: 512,
    };
    const result = await post(`/domains/${domainA}/mailboxes`, data);
    expect(result.status).toBe(201);
    expect(result.body.data.passwordHash).toBeUndefined();
    expect((await post(`/domains/${domainA}/mailboxes`, data)).status).toBe(409);
    expect(
      (
        await post(`/domains/${domainA}/mailboxes`, {
          ...data,
          localPart: 'too-large',
          quotaMb: 1024,
        })
      ).status,
    ).toBe(409);
    const stored = await db.mailbox.findUniqueOrThrow({ where: { id: result.body.data.id } });
    expect(stored.passwordHash.startsWith('{ARGON2ID}')).toBe(true);
  });
  it('rejects cross-domain and external aliases', async () => {
    const mailbox = await db.mailbox.findFirstOrThrow({ where: { domainId: domainA } });
    expect(
      (
        await post(`/domains/${domainA}/aliases`, {
          localPart: 'alias',
          destinations: ['other@example.net'],
          externalForwarding: true,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await post(`/domains/${domainA}/aliases`, {
          localPart: 'alias',
          destinations: [mailbox.email],
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(`/domains/${domainA}/aliases`, {
          localPart: 'hello',
          destinations: [mailbox.email],
        })
      ).status,
    ).toBe(422);
  });
  it('creates durable jobs and returns safe errors', async () => {
    const result = await post(`/domains/${domainA}/check`, {});
    expect(result.status).toBe(202);
    expect(await db.job.count({ where: { entityId: domainA } })).toBeGreaterThan(0);
    const invalid = await get('/domains/not-a-uuid');
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.stack).toBeUndefined();
  });
  it('revokes sessions on logout', async () => {
    expect((await post('/auth/logout', {})).status).toBe(200);
    expect((await get('/domains')).status).toBe(401);
    expect(await db.session.count({ where: { userId: userA } })).toBe(0);
  });
});
