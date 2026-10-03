// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { describe, it, expect } from 'vitest';
import {
  domainSchema,
  mailboxSchema,
  aliasSchema,
  canAccessTenant,
  tenantScope,
  seal,
  unseal,
  sendingReady,
  dnsRecords,
  envSchema,
} from '../../packages/core/src/index.js';
describe('External boundaries', () => {
  it('rejects invalid domains, injection and unexpected privilege fields', () => {
    for (const name of ['example.com;rm -rf /', 'localhost', '-bad.example.com', 'x/../../key'])
      expect(domainSchema.safeParse({ name }).success).toBe(false);
    expect(domainSchema.safeParse({ name: 'EXAMPLE.COM' }).success).toBe(true);
    expect(domainSchema.safeParse({ name: 'example.com', sendingEnabled: true }).success).toBe(
      false,
    );
  });
  it('requires strong passwords and safe mailbox identifiers', () => {
    expect(
      mailboxSchema.safeParse({ localPart: '../x', name: 'User', password: 'Short1' }).success,
    ).toBe(false);
    expect(
      mailboxSchema.parse({ localPart: 'hello', name: 'User', password: 'Mail-Test-Password42' })
        .quotaMb,
    ).toBe(1024);
  });
  it('requires explicit catch-all input and bounded recipients', () => {
    expect(
      aliasSchema.parse({ localPart: '*', destinations: ['hello@example.com'] }).externalForwarding,
    ).toBe(false);
    expect(aliasSchema.safeParse({ localPart: 'hello', destinations: [] }).success).toBe(false);
  });
});
describe('Tenant isolation', () => {
  const actor = { id: 'one', role: 'DOMAIN_ADMIN' as const, tenantId: 'tenant-a' };
  it('denies foreign tenants and null-tenant administrators', () => {
    expect(canAccessTenant(actor, 'tenant-b')).toBe(false);
    expect(canAccessTenant(actor, 'tenant-a')).toBe(true);
    expect(tenantScope({ ...actor, tenantId: null }).tenantId).toBe(
      '00000000-0000-0000-0000-000000000000',
    );
  });
});
describe('Secrets and sending policy', () => {
  it('encrypts secrets and detects tampering', () => {
    const key = 'a'.repeat(64),
      value = seal('private', key);
    expect(value).not.toContain('private');
    expect(unseal(value, key)).toBe('private');
    expect(() => unseal(value, 'b'.repeat(64))).toThrow();
  });
  it('fails closed when any mandatory check is absent', () => {
    const names = ['ownership', 'mx', 'spf', 'dkim', 'dmarc', 'ptr', 'address', 'smtp', 'tls'];
    const checks = names.map((name) => ({ name, passed: true, detail: '' }));
    expect(sendingReady(checks)).toBe(true);
    for (let i = 0; i < checks.length; i++)
      expect(sendingReady(checks.filter((_c, index) => index !== i))).toBe(false);
    expect(sendingReady([])).toBe(false);
  });
  it('generates domain-specific webmail and DKIM records', () => {
    const records = dnsRecords(
      {
        name: 'nsoft.lk',
        verificationToken: 'token',
        dkimPublicKey: 'key',
        dkimSelector: 'nsoft2026',
      },
      'mail.example.com',
      '192.0.2.10',
    );
    expect(records.find((r) => r.name === 'webmail.nsoft.lk')?.value).toBe('mail.example.com');
    expect(records.find((r) => r.type === 'MX')?.value).toBe('mail.example.com');
  });
  it('accepts blank optional compose environment variables', () => {
    const env = envSchema.parse({
      DATABASE_URL: 'postgresql://local/test',
      ENCRYPTION_KEY: 'a'.repeat(64),
      MAIL_HOSTNAME: 'mail.example.com',
      PUBLIC_IPV4: '192.0.2.1',
      CLOUDFLARE_TOKEN: '',
      SMTP_RELAY_HOST: '',
    });
    expect(env.SMTP_RELAY_HOST).toBeUndefined();
  });
});
