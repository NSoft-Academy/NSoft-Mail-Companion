// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { z } from 'zod';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
} from 'node:crypto';

export const domainName = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'Use a valid public domain name.',
  );
export const password = z.string().min(14).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/);
export const localPart = z
  .string()
  .trim()
  .toLowerCase()
  .max(64)
  .regex(/^[a-z0-9]+(?:[._+-][a-z0-9]+)*$/);
export const domainSchema = z
  .object({
    name: domainName,
    tenantId: z.string().uuid().optional(),
    quotaMb: z.number().int().min(1).max(2147483).default(10240),
    mailboxLimit: z.number().int().positive().nullable().default(null),
  })
  .strict();
export const mailboxSchema = z
  .object({
    localPart,
    name: z.string().trim().min(1).max(120),
    password,
    quotaMb: z.number().int().min(1).max(2147483).default(1024),
  })
  .strict();
export const aliasSchema = z
  .object({
    localPart: localPart.or(z.literal('*')),
    destinations: z.array(z.string().email().toLowerCase()).min(1).max(20),
    externalForwarding: z.boolean().default(false),
  })
  .strict();
export const loginSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().max(128),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict();
export const userSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().email().toLowerCase(),
    password,
    tenantId: z.string().uuid(),
  })
  .strict();
export type Actor = {
  id: string;
  role: 'PLATFORM_ADMIN' | 'DOMAIN_ADMIN';
  tenantId: string | null;
};
export function canAccessTenant(actor: Actor, tenantId: string): boolean {
  return actor.role === 'PLATFORM_ADMIN' || actor.tenantId === tenantId;
}
export function tenantScope(actor: Actor): { tenantId?: string } {
  return actor.role === 'PLATFORM_ADMIN'
    ? {}
    : { tenantId: actor.tenantId ?? '00000000-0000-0000-0000-000000000000' };
}
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function constantEqual(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function seal(value: string, key: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(
    '.',
  );
}
export function unseal(value: string, key: string): string {
  const [iv, tag, body] = value.split('.');
  if (!iv || !tag || !body) throw new Error('Invalid encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}
export type Check = { name: string; passed: boolean; detail: string };
export function sendingReady(checks: Check[]): boolean {
  const required = ['ownership', 'mx', 'spf', 'dkim', 'dmarc', 'ptr', 'address', 'smtp', 'tls'];
  return required.every((name) => checks.some((c) => c.name === name && c.passed));
}
export function dnsRecords(
  domain: {
    name: string;
    verificationToken: string;
    dkimPublicKey: string | null;
    dkimSelector: string;
  },
  hostname: string,
  ipv4: string,
  relaySpf?: string,
) {
  return [
    {
      type: 'TXT',
      name: `_nsoft-verify.${domain.name}`,
      value: domain.verificationToken,
      purpose: 'Ownership verification',
    },
    { type: 'MX', name: domain.name, value: hostname, priority: 10, purpose: 'Inbound mail' },
    {
      type: 'TXT',
      name: domain.name,
      value: `v=spf1 ip4:${ipv4}${relaySpf ? ` include:${relaySpf}` : ''} -all`,
      purpose: 'Authorised senders; merge with any existing SPF',
    },
    {
      type: 'TXT',
      name: `${domain.dkimSelector}._domainkey.${domain.name}`,
      value: `v=DKIM1; k=rsa; p=${domain.dkimPublicKey ?? 'PENDING_PROVISIONING'}`,
      purpose: 'DKIM authentication',
    },
    {
      type: 'TXT',
      name: `_dmarc.${domain.name}`,
      value: `v=DMARC1; p=none; rua=mailto:postmaster@${domain.name}; adkim=r; aspf=r`,
      purpose: 'Monitoring; create the postmaster mailbox first',
    },
    {
      type: 'CNAME',
      name: `webmail.${domain.name}`,
      value: hostname,
      purpose: 'Customer webmail (HTTPS route required)',
    },
  ];
}
const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().default(4000),
  ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/),
  MAIL_HOSTNAME: domainName,
  PUBLIC_IPV4: z.string().ip({ version: 'v4' }),
  DKIM_DIR: z.string().default('/data/dkim'),
  MAIL_TLS_DIR: z.string().default('/data/tls'),
  CLOUDFLARE_TOKEN: z.string().optional(),
  SMTP_RELAY_HOST: domainName.optional(),
  SMTP_RELAY_SPF: domainName.optional(),
  ALERT_WEBHOOK: z.string().url().optional(),
  REQUIRE_MFA: z.enum(['true', 'false']).default('true'),
});
export const envSchema = z.preprocess(
  (value) =>
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        item === '' ? undefined : item,
      ]),
    ),
  rawEnvSchema,
);
export type Environment = z.infer<typeof rawEnvSchema>;

export { z } from 'zod';
export { hostAction, type HostOperation } from './host.js';
