// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { readFile, statfs } from 'node:fs/promises';
import type { PrismaClient } from '@nsoft/database';
import type { Environment } from '@nsoft/core';
let lastAlert = 0;
export async function monitor(db: PrismaClient, env: Environment) {
  const dir = process.env.USAGE_DIR ?? '/data/usage';
  const issues: string[] = [];
  try {
    const raw = JSON.parse(await readFile(`${dir}/usage.json`, 'utf8')) as {
      username?: string;
      user?: string;
      type?: string;
      value?: string | number;
    }[];
    for (const entry of raw) {
      const email = entry.username ?? entry.user;
      if (email && entry.type === 'STORAGE') {
        const amount = Number(entry.value) * 1024;
        if (Number.isSafeInteger(amount) && amount >= 0)
          await db.mailbox.updateMany({ where: { email }, data: { usedBytes: BigInt(amount) } });
      }
    }
  } catch {
    /* A first run may not have usage data yet. */
  }
  try {
    const health = JSON.parse(await readFile(`${dir}/health.json`, 'utf8')) as {
      queueDepth: number;
      oldestAgeSeconds: number;
      timestamp: number;
    };
    if (Date.now() / 1000 - health.timestamp > 180) issues.push('MAIL_HEALTH_STALE');
    if (health.queueDepth > 1000 || health.oldestAgeSeconds > 3600)
      issues.push('MAIL_QUEUE_PRESSURE');
  } catch {
    issues.push('MAIL_HEALTH_UNAVAILABLE');
  }
  try {
    const fs = await statfs(dir);
    if (fs.bavail / Math.max(fs.blocks, 1) < 0.15) issues.push('DISK_SPACE_LOW');
  } catch {
    issues.push('DISK_CHECK_UNAVAILABLE');
  }
  try {
    const timestamp = Number((await readFile(`${dir}/backup.timestamp`, 'utf8')).trim());
    if (!timestamp || Date.now() / 1000 - timestamp > 36 * 3600) issues.push('BACKUP_OVERDUE');
  } catch {
    issues.push('BACKUP_NOT_CONFIGURED');
  }
  if (issues.length && env.ALERT_WEBHOOK && Date.now() - lastAlert > 3600000) {
    lastAlert = Date.now();
    await fetch(env.ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'mail-health', issues }),
      signal: AbortSignal.timeout(5000),
    });
  }
  return issues;
}
