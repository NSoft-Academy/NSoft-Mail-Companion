// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@nsoft/database';
import { digest, envSchema } from '@nsoft/core';
const env = envSchema.parse(process.env),
  db = new PrismaClient();
try {
  if (new URL(env.WEB_URL).protocol !== 'https:')
    throw new Error('Setup requires trusted panel HTTPS.');
  const token = randomBytes(32).toString('hex');
  const available = await db.$transaction(
    async (tx) => {
      if (await tx.user.count()) return false;
      const old = await tx.systemSetup.findUnique({ where: { id: 'installation' } });
      if (old?.claimedAt) return false;
      await tx.systemSetup.upsert({
        where: { id: 'installation' },
        create: {
          bootstrapHash: digest(token),
          bootstrapExpiresAt: new Date(Date.now() + 30 * 60000),
        },
        update: {
          bootstrapHash: digest(token),
          bootstrapExpiresAt: new Date(Date.now() + 30 * 60000),
        },
      });
      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  console.log(
    JSON.stringify({
      url: available ? `${env.WEB_URL}/setup#${token}` : `${env.WEB_URL}/setup`,
      expiresMinutes: available ? 30 : null,
    }),
  );
} finally {
  await db.$disconnect();
}
