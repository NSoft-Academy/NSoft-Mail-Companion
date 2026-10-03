// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import pino from 'pino';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { z } from '@nsoft/core';
import { Prisma, type PrismaClient } from '@nsoft/database';
import {
  dnsRecords,
  tenantScope,
  canAccessTenant,
  password,
  unseal,
  userSchema,
  type Environment,
} from '@nsoft/core';
import {
  auth,
  login,
  requireMfa,
  platform,
  enrollMfa,
  totp,
  hashPassword,
  type AuthRequest,
} from './auth.js';
import {
  ownedDomain,
  createDomain,
  createMailbox,
  createAlias,
  enableSending,
  publicMailbox,
  audit,
} from './service.js';
import { ApiError } from './errors.js';

export function createApp(db: PrismaClient, env: Environment) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: new URL(env.WEB_URL).origin, credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  const logger = pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });
  app.use((req, res, next) => {
    const started = Date.now();
    req.headers['x-request-id'] = crypto.randomUUID();
    res.setHeader('X-Request-ID', req.headers['x-request-id']);
    res.on('finish', () =>
      logger.info(
        {
          method: req.method,
          route: req.route?.path ?? 'unmatched',
          status: res.statusCode,
          duration: Date.now() - started,
          requestId: req.headers['x-request-id'],
        },
        'request',
      ),
    );
    next();
  });
  app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'alive' } }));
  app.get('/ready', async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ success: true, data: { status: 'ready' } });
    } catch {
      res
        .status(503)
        .json({ success: false, error: { code: 'NOT_READY', message: 'Database unavailable.' } });
    }
  });
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
    },
  });
  app.post('/api/v1/auth/login', limit, async (req, res) => login(db, env, req, res));
  app.use('/api/v1', auth(db, env));
  app.get('/api/v1/auth/me', async (req, res) => {
    const r = req as AuthRequest;
    const user = await db.user.findUniqueOrThrow({
      where: { id: r.actor.id },
      select: { id: true, name: true, email: true, role: true, tenantId: true },
    });
    res.json({
      success: true,
      data: { ...user, csrfToken: r.csrfToken, mfaEnabled: r.mfaEnabled },
    });
  });
  app.post('/api/v1/auth/logout', async (req, res) => {
    await db.session.delete({ where: { id: (req as AuthRequest).sessionId } });
    res.clearCookie('nsoft_session', { path: '/api' });
    res.json({ success: true });
  });
  app.post('/api/v1/auth/mfa/enroll', limit, async (req, res) =>
    res.json({ success: true, data: await enrollMfa(db, env, (req as AuthRequest).actor) }),
  );
  app.post('/api/v1/auth/mfa/confirm', limit, async (req, res) => {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body),
      r = req as AuthRequest,
      user = await db.user.findUniqueOrThrow({ where: { id: r.actor.id } });
    if (
      !user.pendingMfaSecret ||
      totp(unseal(user.pendingMfaSecret, env.ENCRYPTION_KEY)).validate({
        token: code,
        window: 1,
      }) === null
    )
      throw new ApiError(422, 'INVALID_MFA', 'Authenticator code is invalid.');
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaSecret: user.pendingMfaSecret, pendingMfaSecret: null },
      });
      await tx.session.deleteMany({ where: { userId: user.id, id: { not: r.sessionId } } });
      await tx.auditLog.create({ data: audit(r.actor, 'MFA_ENABLE', user.id) });
    });
    res.json({ success: true });
  });
  app.use(
    '/api/v1',
    requireMfa(env),
    rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  const actor = (req: Request) => (req as AuthRequest).actor;
  const id = (req: Request) => z.string().uuid().parse(req.params.id);
  app.get('/api/v1/overview', async (req, res) => {
    const scope = tenantScope(actor(req));
    const [domains, mailboxes, jobs] = await Promise.all([
      db.domain.findMany({
        where: scope,
        select: { id: true, active: true, sendingEnabled: true },
      }),
      db.mailbox.count({ where: { domain: scope } }),
      db.job.count({
        where: {
          status: 'FAILED',
          entityId: {
            in: (await db.domain.findMany({ where: scope, select: { id: true } })).map((d) => d.id),
          },
        },
      }),
    ]);
    res.json({
      success: true,
      data: {
        domains: domains.length,
        mailboxes,
        ready: domains.filter((d) => d.sendingEnabled).length,
        failedJobs: jobs,
      },
    });
  });
  app.get('/api/v1/tenants', platform, async (_req, res) =>
    res.json({ success: true, data: await db.tenant.findMany({ orderBy: { name: 'asc' } }) }),
  );
  app.post('/api/v1/tenants', platform, async (req, res) => {
    const input = z
      .object({ name: z.string().trim().min(1).max(120) })
      .strict()
      .parse(req.body);
    const tenant = await db.$transaction(async (tx) => {
      const result = await tx.tenant.create({ data: input });
      await tx.auditLog.create({ data: audit(actor(req), 'TENANT_CREATE', result.id, result.id) });
      return result;
    });
    res.status(201).json({ success: true, data: tenant });
  });
  app.get('/api/v1/users', platform, async (_req, res) =>
    res.json({
      success: true,
      data: await db.user.findMany({
        select: { id: true, name: true, email: true, role: true, tenantId: true, active: true },
      }),
    }),
  );
  app.post('/api/v1/users', platform, async (req, res) => {
    const input = userSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          tenantId: input.tenantId,
          role: 'DOMAIN_ADMIN',
          passwordHash,
        },
      });
      await tx.auditLog.create({ data: audit(actor(req), 'USER_CREATE', user.id, input.tenantId) });
      return { id: user.id, email: user.email };
    });
    res.status(201).json({ success: true, data: result });
  });
  app.patch('/api/v1/users/:id', platform, async (req, res) => {
    const input = z.object({ active: z.boolean() }).strict().parse(req.body);
    const user = await db.user.findUniqueOrThrow({ where: { id: id(req) } });
    if (user.role === 'PLATFORM_ADMIN')
      throw new ApiError(
        403,
        'ADMIN_PROTECTED',
        'Platform administrators are managed by the recovery CLI.',
      );
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: input });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({ data: audit(actor(req), 'USER_STATUS', user.id, user.tenantId) });
    });
    res.json({ success: true });
  });
  app.get('/api/v1/domains', async (req, res) =>
    res.json({
      success: true,
      data: await db.domain.findMany({
        where: tenantScope(actor(req)),
        orderBy: { createdAt: 'desc' },
      }),
    }),
  );
  app.post('/api/v1/domains', async (req, res) =>
    res.status(201).json({ success: true, data: await createDomain(db, actor(req), req.body) }),
  );
  app.get('/api/v1/domains/:id', async (req, res) =>
    res.json({ success: true, data: await ownedDomain(db, actor(req), id(req)) }),
  );
  app.patch('/api/v1/domains/:id', async (req, res) => {
    const domain = await ownedDomain(db, actor(req), id(req));
    const input = z.object({ active: z.boolean() }).strict().parse(req.body);
    if (input.active && (!domain.verifiedAt || !domain.provisionedAt))
      throw new ApiError(409, 'DOMAIN_NOT_READY', 'Verify and provision the domain first.');
    await db.$transaction(async (tx) => {
      await tx.domain.update({
        where: { id: domain.id },
        data: { active: input.active, sendingEnabled: false },
      });
      await tx.auditLog.create({
        data: audit(actor(req), 'DOMAIN_STATUS', domain.id, domain.tenantId),
      });
    });
    res.json({ success: true });
  });
  app.post('/api/v1/domains/:id/sending', async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    res.json({ success: true, data: await enableSending(db, actor(req), id(req), enabled) });
  });
  app.get('/api/v1/domains/:id/dns', async (req, res) => {
    const domain = await ownedDomain(db, actor(req), id(req));
    res.json({
      success: true,
      data: dnsRecords(domain, env.MAIL_HOSTNAME, env.PUBLIC_IPV4, env.SMTP_RELAY_SPF),
    });
  });
  app.post('/api/v1/domains/:id/check', limit, async (req, res) => {
    const domain = await ownedDomain(db, actor(req), id(req));
    const job = await db.$transaction(async (tx) => {
      const job = await tx.job.create({ data: { kind: 'CHECK_DOMAIN', entityId: domain.id } });
      await tx.auditLog.create({
        data: audit(actor(req), 'DOMAIN_CHECK', domain.id, domain.tenantId),
      });
      return job;
    });
    res.status(202).json({ success: true, data: job });
  });
  app.get('/api/v1/domains/:id/mailboxes', async (req, res) => {
    const domain = await ownedDomain(db, actor(req), id(req));
    const list = await db.mailbox.findMany({
      where: { domainId: domain.id },
      orderBy: { email: 'asc' },
    });
    res.json({ success: true, data: list.map(publicMailbox) });
  });
  app.post('/api/v1/domains/:id/mailboxes', async (req, res) =>
    res
      .status(201)
      .json({ success: true, data: await createMailbox(db, actor(req), id(req), req.body) }),
  );
  app.patch('/api/v1/mailboxes/:id', async (req, res) => {
    const mailbox = await db.mailbox.findUnique({
      where: { id: id(req) },
      include: { domain: true },
    });
    if (!mailbox || !canAccessTenant(actor(req), mailbox.domain.tenantId))
      throw new ApiError(404, 'NOT_FOUND', 'Mailbox not found.');
    const input = z
      .object({ active: z.boolean().optional(), password: password.optional() })
      .strict()
      .parse(req.body);
    await db.$transaction(async (tx) => {
      await tx.mailbox.update({
        where: { id: mailbox.id },
        data: {
          ...(input.active === undefined ? {} : { active: input.active }),
          ...(input.password
            ? { passwordHash: '{ARGON2ID}' + (await hashPassword(input.password)) }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: audit(actor(req), 'MAILBOX_UPDATE', mailbox.id, mailbox.domain.tenantId),
      });
    });
    res.json({ success: true });
  });
  app.get('/api/v1/domains/:id/aliases', async (req, res) => {
    const domain = await ownedDomain(db, actor(req), id(req));
    res.json({ success: true, data: await db.alias.findMany({ where: { domainId: domain.id } }) });
  });
  app.post('/api/v1/domains/:id/aliases', async (req, res) =>
    res
      .status(201)
      .json({ success: true, data: await createAlias(db, actor(req), id(req), req.body) }),
  );
  app.delete('/api/v1/aliases/:id', async (req, res) => {
    const alias = await db.alias.findUnique({ where: { id: id(req) }, include: { domain: true } });
    if (!alias || !canAccessTenant(actor(req), alias.domain.tenantId))
      throw new ApiError(404, 'NOT_FOUND', 'Alias not found.');
    await db.$transaction(async (tx) => {
      await tx.alias.delete({ where: { id: alias.id } });
      await tx.auditLog.create({
        data: audit(actor(req), 'ALIAS_DELETE', alias.id, alias.domain.tenantId),
      });
    });
    res.json({ success: true });
  });
  app.get('/api/v1/jobs', async (req, res) => {
    const domains = await db.domain.findMany({
      where: tenantScope(actor(req)),
      select: { id: true },
    });
    res.json({
      success: true,
      data: await db.job.findMany({
        where: { entityId: { in: domains.map((d) => d.id) } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    });
  });
  app.post('/api/v1/jobs/:id/retry', async (req, res) => {
    const job = await db.job.findUnique({ where: { id: id(req) } });
    if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found.');
    const domain = await ownedDomain(db, actor(req), job.entityId);
    if (job.status !== 'FAILED')
      throw new ApiError(409, 'JOB_NOT_FAILED', 'Only failed jobs can be retried.');
    await db.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: job.id },
        data: {
          status: 'PENDING',
          attempts: 0,
          availableAt: new Date(),
          lastError: null,
          lockToken: null,
          lockedAt: null,
        },
      });
      await tx.auditLog.create({ data: audit(actor(req), 'JOB_RETRY', job.id, domain.tenantId) });
    });
    res.json({ success: true });
  });
  app.get('/api/v1/audit', async (req, res) =>
    res.json({
      success: true,
      data: await db.auditLog.findMany({
        where: tenantScope(actor(req)),
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    }),
  );
  app.get('/api/v1/settings', platform, (_req, res) =>
    res.json({
      success: true,
      data: {
        hostname: env.MAIL_HOSTNAME,
        ipv4: env.PUBLIC_IPV4,
        delivery: env.SMTP_RELAY_HOST ? 'relay' : 'direct',
        cloudflare: !!env.CLOUDFLARE_TOKEN,
        mfaRequired: env.REQUIRE_MFA === 'true',
      },
    }),
  );
  app.post('/api/v1/domains/:id/cloudflare/preview', platform, async (req, res) => {
    const domain = await ownedDomain(db, actor(req), id(req));
    const { zoneId } = z
      .object({ zoneId: z.string().regex(/^[a-f0-9]{32}$/) })
      .strict()
      .parse(req.body);
    const result = await cloudflare(env, `zones/${zoneId}`);
    const zone = result as { name: string };
    if (domain.name !== zone.name && !domain.name.endsWith('.' + zone.name))
      throw new ApiError(422, 'ZONE_MISMATCH', 'Cloudflare zone does not own this domain.');
    const current = await cloudflare(env, `zones/${zoneId}/dns_records?per_page=5000`);
    const suggested = dnsRecords(domain, env.MAIL_HOSTNAME, env.PUBLIC_IPV4, env.SMTP_RELAY_SPF);
    res.json({ success: true, data: { suggested, current } });
  });
  app.post('/api/v1/domains/:id/cloudflare/apply', platform, async (req, res) => {
    const domain = await ownedDomain(db, actor(req), id(req));
    const input = z
      .object({
        zoneId: z.string().regex(/^[a-f0-9]{32}$/),
        records: z.array(z.number().int().min(0).max(5)).min(1).max(6),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(req.body);
    const zone = (await cloudflare(env, `zones/${input.zoneId}`)) as { name: string };
    if (domain.name !== zone.name && !domain.name.endsWith('.' + zone.name))
      throw new ApiError(422, 'ZONE_MISMATCH', 'Zone mismatch.');
    const existing = (await cloudflare(env, `zones/${input.zoneId}/dns_records?per_page=5000`)) as {
      name: string;
      type: string;
      content: string;
    }[];
    const suggested = dnsRecords(domain, env.MAIL_HOSTNAME, env.PUBLIC_IPV4, env.SMTP_RELAY_SPF);
    const selected = input.records.map((index) => suggested[index]!);
    if (
      selected.some((record) =>
        existing.some((r) => r.name === record.name && r.type === record.type),
      ) ||
      selected.some((r) => r.value.includes('PENDING_'))
    )
      throw new ApiError(
        409,
        'DNS_CONFLICT',
        'An existing record needs manual review, or DKIM provisioning is pending. No records changed.',
      );
    for (const r of selected)
      await cloudflare(env, `zones/${input.zoneId}/dns_records`, {
        method: 'POST',
        body: JSON.stringify({
          type: r.type,
          name: r.name,
          content: r.value,
          ttl: 300,
          proxied: false,
          ...('priority' in r ? { priority: r.priority } : {}),
        }),
      });
    await db.auditLog.create({ data: audit(actor(req), 'DNS_APPLY', domain.id, domain.tenantId) });
    res.json({
      success: true,
      data: { message: 'Records created. Run DNS checks after propagation.' },
    });
  });
  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Endpoint not found.')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError)
      return res.status(422).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Check the submitted fields.',
          fields: error.flatten().fieldErrors,
        },
      });
    if (error instanceof ApiError)
      return res
        .status(error.status)
        .json({ success: false, error: { code: error.code, message: error.message } });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002')
        return res.status(409).json({
          success: false,
          error: { code: 'ALREADY_EXISTS', message: 'This record already exists.' },
        });
      if (error.code === 'P2025')
        return res
          .status(404)
          .json({ success: false, error: { code: 'NOT_FOUND', message: 'Record not found.' } });
      if (error.code === 'P2034')
        return res.status(409).json({
          success: false,
          error: {
            code: 'RETRY_TRANSACTION',
            message: 'Another change occurred. Retry your request.',
          },
        });
    }
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' },
    });
  });
  return app;
}
async function cloudflare(env: Environment, path: string, init: RequestInit = {}) {
  if (!env.CLOUDFLARE_TOKEN)
    throw new ApiError(
      409,
      'DNS_PROVIDER_NOT_CONFIGURED',
      'Configure a scoped Cloudflare token first.',
    );
  const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });
  const body = (await response.json()) as { success: boolean; result: unknown };
  if (!response.ok || !body.success)
    throw new ApiError(
      502,
      'DNS_PROVIDER_FAILED',
      'Cloudflare rejected the request. Check token permissions; some records may have been created.',
    );
  return body.result;
}
