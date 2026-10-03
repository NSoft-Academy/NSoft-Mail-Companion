// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { writeFile, mkdir } from 'node:fs/promises';
import { PrismaClient } from '@nsoft/database';
import { envSchema } from '../packages/core/src/index.js';
import { provisionDomain } from '../apps/worker/src/jobs.js';
const db = new PrismaClient({
  datasourceUrl:
    process.env.TEST_DATABASE_URL ??
    'postgresql://nsoft_runtime:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc@127.0.0.1:55439/mailcompanion',
});
try {
  const domain = await db.domain.findUniqueOrThrow({ where: { name: 'example.test' } });
  await provisionDomain(
    db,
    envSchema.parse({
      DATABASE_URL: 'test',
      ENCRYPTION_KEY: 'a'.repeat(64),
      MAIL_HOSTNAME: 'mail.example.test',
      PUBLIC_IPV4: '192.0.2.1',
      DKIM_DIR: process.env.TEST_DKIM_DIR ?? '.runtime/dkim',
    }),
    domain.id,
  );
  const updated = await db.domain.findUniqueOrThrow({ where: { id: domain.id } });
  await mkdir('.runtime', { recursive: true });
  await writeFile('.runtime/test-dkim.txt', `v=DKIM1; k=rsa; p=${updated.dkimPublicKey}`);
} finally {
  await db.$disconnect();
}
