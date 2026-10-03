// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import { resolveTxt, resolveMx, resolve4, reverse } from 'node:dns/promises';
import type { Domain } from '@nsoft/database';
import { envSchema } from '../../packages/core/src/index.js';
import { checkDomain, smtpGreeting } from '../../apps/worker/src/checks.js';
vi.mock('node:dns/promises', () => ({
  resolveTxt: vi.fn(),
  resolveMx: vi.fn(),
  resolve4: vi.fn(),
  reverse: vi.fn(),
}));
vi.mock('node:net', () => ({
  connect: () => {
    const socket = new EventEmitter() as EventEmitter & { destroy: () => void };
    socket.destroy = () => {};
    queueMicrotask(() => socket.emit('error', new Error('Synthetic unreachable route')));
    return socket;
  },
}));
const env = envSchema.parse({
  DATABASE_URL: 'test',
  ENCRYPTION_KEY: 'a'.repeat(64),
  MAIL_HOSTNAME: 'mail.example.com',
  PUBLIC_IPV4: '192.0.2.1',
});
const domain = {
  name: 'example.com',
  verificationToken: 'owned',
  dkimSelector: 'nsoft2026',
  dkimPublicKey: 'public-key',
} as Domain;
function dns(spf = 'v=spf1 ip4:192.0.2.1 -all') {
  vi.mocked(resolveTxt).mockImplementation(async (name) => [
    [
      name.startsWith('_nsoft-verify.')
        ? 'owned'
        : name.startsWith('_dmarc.')
          ? 'v=DMARC1; p=none;'
          : name.startsWith('nsoft2026.')
            ? 'v=DKIM1; p=public-key'
            : spf,
    ],
  ]);
  vi.mocked(resolveMx).mockResolvedValue([{ priority: 10, exchange: 'mail.example.com' }]);
  vi.mocked(resolve4).mockResolvedValue(['192.0.2.1']);
  vi.mocked(reverse).mockResolvedValue(['mail.example.com']);
}
describe('DNS readiness and relay failure', () => {
  it('checks the owned domain records but fails closed when connectivity or TLS fails', async () => {
    dns();
    const checks = await checkDomain(domain, env);
    expect(checks.filter((c) => c.passed).map((c) => c.name)).toEqual([
      'ownership',
      'mx',
      'spf',
      'dkim',
      'dmarc',
      'ptr',
      'address',
    ]);
    expect(checks.filter((c) => !c.passed).map((c) => c.name)).toEqual(['smtp', 'tls']);
  });
  it('rejects SPF allow-all and foreign MX routes', async () => {
    dns('v=spf1 ip4:192.0.2.1 +all');
    vi.mocked(resolveMx).mockResolvedValue([{ priority: 10, exchange: 'foreign.example.com' }]);
    const checks = await checkDomain(domain, env);
    expect(checks.find((c) => c.name === 'spf')?.passed).toBe(false);
    expect(checks.find((c) => c.name === 'mx')?.passed).toBe(false);
  });
  it('returns false on a failed relay connection rather than enabling sending', async () => {
    expect(await smtpGreeting('relay.example.test', 587)).toBe(false);
  });
});
