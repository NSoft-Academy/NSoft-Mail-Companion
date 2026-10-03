// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import * as OTPAuth from 'otpauth';
import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@nsoft/database';
import {
  digest,
  constantEqual,
  loginSchema,
  seal,
  unseal,
  type Actor,
  type Environment,
} from '@nsoft/core';
import { ApiError } from './errors.js';

export type AuthRequest = Request & {
  actor: Actor;
  sessionId: string;
  csrfToken: string;
  mfaEnabled: boolean;
};
export const hashPassword = (value: string) =>
  argon2.hash(value, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
export function totp(secret: string) {
  return new OTPAuth.TOTP({
    issuer: 'NSoft Mail Companion',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}
export function auth(db: PrismaClient, env: Environment) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const cookie = req.cookies?.nsoft_session;
      if (typeof cookie !== 'string')
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      const session = await db.session.findUnique({
        where: { tokenHash: digest(cookie) },
        include: { user: true },
      });
      if (!session || session.expiresAt <= new Date() || !session.user.active)
        throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired.');
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (!constantEqual(req.get('x-csrf-token') ?? '', session.csrfToken) ||
          req.get('origin') !== new URL(env.WEB_URL).origin)
      )
        throw new ApiError(403, 'CSRF_FAILED', 'Reload the page and try again.');
      Object.assign(req, {
        actor: { id: session.user.id, role: session.user.role, tenantId: session.user.tenantId },
        sessionId: session.id,
        csrfToken: session.csrfToken,
        mfaEnabled: !!session.user.mfaSecret,
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}
export function requireMfa(env: Environment) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (env.REQUIRE_MFA === 'true' && !(req as AuthRequest).mfaEnabled)
      return next(
        new ApiError(403, 'MFA_REQUIRED', 'Enable authenticator MFA before managing mail.'),
      );
    next();
  };
}
export function platform(req: Request, _res: Response, next: NextFunction) {
  if ((req as AuthRequest).actor.role !== 'PLATFORM_ADMIN')
    return next(new ApiError(403, 'FORBIDDEN', 'Platform administrator permission is required.'));
  next();
}
export async function login(db: PrismaClient, env: Environment, req: Request, res: Response) {
  if (req.get('origin') !== new URL(env.WEB_URL).origin)
    throw new ApiError(403, 'ORIGIN_DENIED', 'Invalid origin.');
  const input = loginSchema.parse(req.body),
    user = await db.user.findUnique({ where: { email: input.email } });
  const recentFailures = await db.auditLog.count({
    where: {
      action: `LOGIN_FAILED:${digest(input.email)}`,
      createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
    },
  });
  if (recentFailures >= 10)
    throw new ApiError(429, 'LOGIN_DELAY', 'Too many attempts. Try again in 15 minutes.');
  const valid = !!user && user.active && (await argon2.verify(user.passwordHash, input.password));
  let step: bigint | undefined;
  if (valid && user?.mfaSecret && input.code) {
    const token = totp(unseal(user.mfaSecret, env.ENCRYPTION_KEY));
    const delta = token.validate({ token: input.code, window: 1 });
    if (delta !== null) step = BigInt(Math.floor(Date.now() / 30000) + delta);
  }
  if (!valid || (user?.mfaSecret && (!step || step <= user.mfaLastStep))) {
    await db.auditLog.create({ data: { action: `LOGIN_FAILED:${digest(input.email)}` } });
    throw new ApiError(
      401,
      'INVALID_CREDENTIALS',
      'Email, password, or authenticator code is incorrect.',
    );
  }
  if (!user) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Unable to sign in.');
  const token = randomBytes(32).toString('hex'),
    csrfToken = randomBytes(24).toString('hex');
  await db.$transaction(async (tx) => {
    if (step) {
      const updated = await tx.user.updateMany({
        where: { id: user.id, mfaLastStep: { lt: step } },
        data: { mfaLastStep: step },
      });
      if (updated.count !== 1)
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Authenticator code has already been used.');
    }
    await tx.session.create({
      data: {
        userId: user.id,
        tokenHash: digest(token),
        csrfToken,
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      },
    });
    await tx.auditLog.create({
      data: { actorId: user.id, tenantId: user.tenantId, action: 'LOGIN' },
    });
  });
  res.cookie('nsoft_session', token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/api',
  });
  res.json({ success: true, data: { csrfToken, mfaEnabled: !!user.mfaSecret } });
}
export async function enrollMfa(db: PrismaClient, env: Environment, actor: Actor) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (user.mfaSecret) throw new ApiError(409, 'MFA_ALREADY_ENABLED', 'MFA is already enabled.');
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  await db.user.update({
    where: { id: user.id },
    data: { pendingMfaSecret: seal(secret, env.ENCRYPTION_KEY) },
  });
  const generator = totp(secret);
  generator.label = user.email;
  return { secret, uri: generator.toString() };
}
