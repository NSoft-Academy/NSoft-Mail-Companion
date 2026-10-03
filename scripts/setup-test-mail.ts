// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { PrismaClient } from '@nsoft/database';
import { hashPassword } from '../apps/api/src/auth.js';
const db = new PrismaClient({
  datasourceUrl:
    process.env.TEST_DATABASE_URL ??
    'postgresql://nsoft_runtime:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc@127.0.0.1:55439/mailcompanion',
});
try {
  const tenant = await db.tenant.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    create: { id: '00000000-0000-4000-8000-000000000001', name: 'Local protocol tests' },
    update: {},
  });
  const domain = await db.domain.upsert({
    where: { name: 'example.test' },
    create: {
      name: 'example.test',
      tenantId: tenant.id,
      verificationToken: 'test-only',
      active: true,
      verifiedAt: new Date(),
      provisionedAt: new Date(),
      sendingEnabled: true,
      readinessAt: new Date(),
    },
    update: { active: true, sendingEnabled: true, readinessAt: new Date() },
  });
  for (const name of ['alice', 'bob', 'quota'])
    await db.mailbox.upsert({
      where: { email: `${name}@example.test` },
      create: {
        domainId: domain.id,
        localPart: name,
        name,
        email: `${name}@example.test`,
        passwordHash: '{ARGON2ID}' + (await hashPassword('Integration-Password42')),
        quotaMb: name === 'quota' ? 1 : 1024,
      },
      update: {},
    });
  await db.alias.upsert({
    where: { source: 'support@example.test' },
    create: {
      domainId: domain.id,
      source: 'support@example.test',
      destinations: ['bob@example.test'],
    },
    update: { active: true },
  });
} finally {
  await db.$disconnect();
}
