// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import 'dotenv/config';
import pino from 'pino';
import { PrismaClient } from '@nsoft/database';
import { envSchema } from '@nsoft/core';
import { monitor } from './monitor.js';
import { processNextJob, reconcileHosts } from './jobs.js';
const db = new PrismaClient(),
  env = envSchema.parse(process.env),
  logger = pino();
let stopping = false,
  lastMaintenance = 0;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    stopping = true;
  });
while (!stopping) {
  try {
    await processNextJob(db, env);
    await reconcileHosts(db, env);
    if (Date.now() - lastMaintenance > 60000) {
      lastMaintenance = Date.now();
      await monitor(db, env);
      await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      const stale = await db.domain.findMany({
        where: {
          sendingEnabled: true,
          OR: [{ readinessAt: { lt: new Date(Date.now() - 86400000) } }, { readinessAt: null }],
        },
      });
      for (const domain of stale)
        await db.job.create({ data: { kind: 'CHECK_DOMAIN', entityId: domain.id } });
      const failures = await db.job.count({
        where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 3600000) } },
      });
      if (failures && env.ALERT_WEBHOOK)
        await fetch(env.ALERT_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'provisioning-failure', count: failures }),
          signal: AbortSignal.timeout(5000),
        });
    }
  } catch {
    logger.error(
      { code: 'WORKER_CYCLE_FAILED' },
      'Worker cycle failed; no secrets or job payloads logged.',
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
await db.$disconnect();
