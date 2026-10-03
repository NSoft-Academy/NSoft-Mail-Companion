// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { randomUUID } from 'node:crypto';
import type { PrismaClient, SystemTask } from '@nsoft/database';
import { hostAction, type HostOperation } from '@nsoft/core';
export async function processSystemTask(db: PrismaClient) {
  const lease = randomUUID();
  const rows = await db.$queryRaw<
    SystemTask[]
  >`UPDATE system_tasks SET status='RUNNING',attempts=attempts+1,locked_at=NOW(),lock_token=${lease}::uuid WHERE id=(SELECT id FROM system_tasks WHERE (status='PENDING' AND available_at<=NOW()) OR (status='RUNNING' AND locked_at<NOW()-INTERVAL '5 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,operation,target,status,attempts,lock_token AS "lockToken"`;
  const task = rows[0];
  if (!task) return;
  try {
    let result = await hostAction(
      task.operation as HostOperation,
      task.target ?? undefined,
      undefined,
      task.id,
    );
    for (let n = 0; result.status === 'PENDING' || result.status === 'RUNNING'; n++) {
      if (n >= 1800) throw new Error('HOST_TASK_TIMEOUT');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      result = await hostAction('task', task.id);
      if (n % 15 === 0)
        await db.systemTask.updateMany({
          where: { id: task.id, lockToken: lease, status: 'RUNNING' },
          data: { lockedAt: new Date() },
        });
    }
    if (result.status === 'FAILED') throw new Error('HOST_TASK_FAILED');
    await db.systemTask.updateMany({
      where: { id: task.id, lockToken: lease, status: 'RUNNING' },
      data: {
        status: 'SUCCEEDED',
        lockToken: null,
        lockedAt: null,
        result: JSON.parse(JSON.stringify(result)),
      },
    });
  } catch {
    await db.systemTask.updateMany({
      where: { id: task.id, lockToken: lease, status: 'RUNNING' },
      data: {
        status: task.attempts >= 3 ? 'FAILED' : 'PENDING',
        lastError: 'The server action needs attention. Check the setup health cards, then retry.',
        availableAt: new Date(Date.now() + 60000),
        lockToken: null,
        lockedAt: null,
      },
    });
  }
}
