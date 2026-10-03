// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { beforeAll, afterAll, it, expect } from 'vitest';
import { PrismaClient } from '@nsoft/database';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processSystemTask } from '../../apps/worker/src/system.js';
const db = new PrismaClient({
  datasourceUrl:
    process.env.TEST_DATABASE_URL ??
    'postgresql://nsoft_runtime:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc@127.0.0.1:55439/mailcompanion',
});
let server: Server,
  directory: string,
  reply: { status: string } = { status: 'SUCCEEDED' },
  status = 200;
const previous = process.env.HOST_AGENT_SOCKET,
  ids: string[] = [],
  keys: string[] = [];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nsoft-job-'));
  process.env.HOST_AGENT_SOCKET = join(directory, 'agent.sock');
  server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
    });
    req.on('end', () => {
      const body = JSON.parse(data) as { idempotencyKey?: string };
      if (body.idempotencyKey) keys.push(body.idempotencyKey);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(process.env.HOST_AGENT_SOCKET, resolve));
});
afterAll(async () => {
  await db.systemTask.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.HOST_AGENT_SOCKET;
  else process.env.HOST_AGENT_SOCKET = previous;
});
it('leases durable jobs and uses the task UUID as the host idempotency key', async () => {
  const task = await db.systemTask.create({
    data: { operation: 'refresh', availableAt: new Date(Date.now() - 1000) },
  });
  ids.push(task.id);
  await processSystemTask(db);
  const row = await db.systemTask.findUniqueOrThrow({ where: { id: task.id } });
  expect(row.status).toBe('SUCCEEDED');
  expect(row.attempts).toBe(1);
  expect(row.lockToken).toBeNull();
  expect(keys).toContain(task.id);
});
it('bounds failures and exposes only actionable redacted errors', async () => {
  status = 422;
  reply = { status: 'FAILED' };
  const task = await db.systemTask.create({
    data: { operation: 'refresh', attempts: 2, availableAt: new Date(Date.now() - 1000) },
  });
  ids.push(task.id);
  await processSystemTask(db);
  const row = await db.systemTask.findUniqueOrThrow({ where: { id: task.id } });
  expect(row.status).toBe('FAILED');
  expect(row.lastError).toContain('setup health');
  expect(row.lockToken).toBeNull();
});
it('releases an interrupted job for resume without spending a retry attempt', async () => {
  status = 200;
  reply = { status: 'RUNNING' };
  const task = await db.systemTask.create({
    data: { operation: 'backup', availableAt: new Date(Date.now() - 1000) },
  });
  ids.push(task.id);
  const controller = new AbortController();
  controller.abort();
  await processSystemTask(db, controller.signal);
  const row = await db.systemTask.findUniqueOrThrow({ where: { id: task.id } });
  expect(row.status).toBe('PENDING');
  expect(row.attempts).toBe(0);
  expect(row.lastError).toBeNull();
  expect(row.lockToken).toBeNull();
  // Prevent this intentionally interrupted fixture from being claimed by subsequent tests.
  await db.systemTask.update({ where: { id: task.id }, data: { status: 'SUCCEEDED' } });
});
