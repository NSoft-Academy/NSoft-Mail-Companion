// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@nsoft/database';
import { envSchema, digest } from '../../packages/core/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { totp } from '../../apps/api/src/auth.js';
const db = new PrismaClient({
  datasourceUrl: process.env.SETUP_DATABASE_URL ?? 'postgresql://unused',
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
const app = createApp(db, env),
  origin = env.WEB_URL,
  token = 'b'.repeat(64);
let cookie: string, csrf: string;
const claim = (value = token) =>
  request(app).post('/api/v1/setup/claim').set('Origin', origin).send({
    token: value,
    name: 'Setup Owner',
    email: 'owner@example.com',
    password: 'Long-Setup-Password42!',
  });
const post = (path: string, body: unknown) =>
  request(app)
    .post('/api/v1' + path)
    .set('Origin', origin)
    .set('Cookie', cookie)
    .set('x-csrf-token', csrf)
    .send(body);
describe.skipIf(!process.env.SETUP_DATABASE_URL)(
  'single-use guided setup against a fresh isolated database',
  () => {
    beforeAll(async () => {
      await db.$connect();
      expect(await db.user.count()).toBe(0);
      await db.systemSetup.create({
        data: { bootstrapHash: digest(token), bootstrapExpiresAt: new Date(Date.now() - 1000) },
      });
    });
    afterAll(async () => {
      await db.$disconnect();
    });
    it('rejects expired and invalid bootstrap links before account creation', async () => {
      expect((await claim()).status).toBe(409);
      expect(await db.user.count()).toBe(0);
      await db.systemSetup.update({
        where: { id: 'installation' },
        data: { bootstrapExpiresAt: new Date(Date.now() + 600000) },
      });
      expect((await claim('c'.repeat(64))).status).toBe(409);
      expect(
        (
          await request(app)
            .post('/api/v1/setup/claim')
            .set('Origin', 'https://evil.example')
            .send({})
        ).status,
      ).toBe(403);
    });
    it('permits exactly one concurrent administrator claim and rejects replay', async () => {
      const responses = await Promise.all([claim(), claim()]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      const accepted = responses.find((r) => r.status === 201)!;
      cookie = accepted.headers['set-cookie'][0].split(';')[0];
      csrf = accepted.body.data.csrfToken;
      expect(await db.user.count()).toBe(1);
      expect((await claim()).status).toBe(409);
      const row = await db.systemSetup.findUniqueOrThrow({ where: { id: 'installation' } });
      expect(row.bootstrapHash).toBeNull();
      expect(row.claimedAt).not.toBeNull();
    });
    it('requires MFA and stores the enrolled key encrypted', async () => {
      expect((await request(app).get('/api/v1/setup/status').set('Cookie', cookie)).status).toBe(
        403,
      );
      const enrolled = await post('/auth/mfa/enroll', {});
      expect(enrolled.status).toBe(200);
      expect((await db.user.findFirstOrThrow()).pendingMfaSecret).not.toContain(
        enrolled.body.data.secret,
      );
      expect(
        (await post('/auth/mfa/confirm', { code: totp(enrolled.body.data.secret).generate() }))
          .status,
      ).toBe(200);
      const status = await request(app).get('/api/v1/setup/status').set('Cookie', cookie);
      expect(status.status).toBe(200);
      expect(JSON.stringify(status.body)).not.toContain('bootstrapHash');
    });
    it('resumes the first domain without duplicates, audits tasks and retries only failed tasks', async () => {
      const input = { name: 'example.com', tenantName: 'My organisation' };
      const first = await post('/setup/first-domain', input);
      expect(first.status).toBe(201);
      const repeat = await post('/setup/first-domain', input);
      expect(repeat.status).toBe(200);
      expect(repeat.body.data.id).toBe(first.body.data.id);
      expect(await db.domain.count()).toBe(1);
      const queued = await post('/setup/tasks', { operation: 'refresh' });
      expect(queued.status).toBe(202);
      expect((await post('/setup/tasks/' + queued.body.data.id + '/retry', {})).status).toBe(409);
      await db.systemTask.update({
        where: { id: queued.body.data.id },
        data: { status: 'FAILED' },
      });
      expect((await post('/setup/tasks/' + queued.body.data.id + '/retry', {})).status).toBe(200);
      expect((await post('/setup/tasks', { operation: 'shell', target: 'reboot' })).status).toBe(
        422,
      );
      expect(
        (await post('/setup/tasks', { operation: 'certificate', target: 'attacker.example.com' }))
          .status,
      ).toBe(422);
    });
    it('protects provider credentials and explains permission failures', async () => {
      const providerToken = 'fixture-provider-token-1234567890',
        zoneId = 'a'.repeat(32);
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 403 })),
      );
      try {
        const denied = await post('/setup/providers/cloudflare/zones', { token: providerToken });
        expect(denied.status).toBe(422);
        expect(denied.body.error.message).toContain('permissions');
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ success: true, result: { name: 'example.com' } }), {
              status: 200,
            }),
          ),
        );
        const connected = await post('/setup/providers/cloudflare', {
          token: providerToken,
          zoneId,
        });
        expect(connected.status).toBe(200);
        expect(JSON.stringify(connected.body)).not.toContain(providerToken);
        const saved = await db.providerConnection.findUniqueOrThrow({ where: { zoneId } });
        expect(saved.tokenEncrypted).not.toContain(providerToken);
      } finally {
        vi.unstubAllGlobals();
      }
    });
    it('requires real domain readiness and mailbox work before completion; diagnostics contain no keys', async () => {
      expect(
        (await post('/setup/complete', { receivedLocalTest: true, testedExternalDelivery: true }))
          .status,
      ).toBe(409);
      const diagnostics = await request(app).get('/api/v1/setup/diagnostics').set('Cookie', cookie);
      expect(diagnostics.status).toBe(200);
      expect(diagnostics.headers['content-disposition']).toContain('attachment');
      expect(JSON.stringify(diagnostics.body)).not.toMatch(
        /tokenEncrypted|bootstrapHash|passwordHash|mfaSecret|ENCRYPTION_KEY/,
      );
    });
  },
);
