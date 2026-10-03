// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import 'dotenv/config';
import { PrismaClient } from '@nsoft/database';
import { password } from '@nsoft/core';
import { hashPassword } from './auth.js';
import { z } from '@nsoft/core';
const db = new PrismaClient();
try {
  const email = z.string().email().toLowerCase().parse(process.env.BOOTSTRAP_EMAIL),
    secret = password.parse(process.env.BOOTSTRAP_PASSWORD);
  const recovery = process.argv.includes('--recover');
  if (recovery) {
    await db.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { email } });
      if (user.role !== 'PLATFORM_ADMIN')
        throw new Error('Recovery is only for platform administrators.');
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(secret),
          mfaSecret: null,
          pendingMfaSecret: null,
          mfaLastStep: 0,
        },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'ADMIN_RECOVERY' } });
    });
  } else {
    await db.$transaction(
      async (tx) => {
        if (await tx.user.count())
          throw new Error(
            'Already initialised. Use --recover for an existing platform administrator.',
          );
        await tx.user.create({
          data: {
            email,
            name: 'Platform administrator',
            role: 'PLATFORM_ADMIN',
            passwordHash: await hashPassword(secret),
          },
        });
        await tx.auditLog.create({ data: { action: 'BOOTSTRAP' } });
      },
      { isolationLevel: 'Serializable' },
    );
  }
  console.log('Administrator configured. Sign in and enroll MFA.');
} finally {
  await db.$disconnect();
}
