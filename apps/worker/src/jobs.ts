// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { generateKeyPairSync, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient, type Job } from '@nsoft/database';
import { domainName, sendingReady, type Environment } from '@nsoft/core';
import { checkDomain } from './checks.js';
export async function claimJob(db: PrismaClient): Promise<Job | null> {
  const token = randomUUID();
  const rows = await db.$queryRaw<
    Job[]
  >`UPDATE jobs SET status='RUNNING',attempts=attempts+1,locked_at=NOW(),lock_token=${token} WHERE id=(SELECT id FROM jobs WHERE (status='PENDING' AND available_at<=NOW()) OR (status='RUNNING' AND locked_at<NOW()-INTERVAL '5 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,kind,entity_id AS "entityId",status,attempts,available_at AS "availableAt",locked_at AS "lockedAt",lock_token AS "lockToken",last_error AS "lastError",created_at AS "createdAt"`;
  return rows[0] ?? null;
}
export async function provisionDomain(db: PrismaClient, env: Environment, id: string) {
  const domain = await db.domain.findUniqueOrThrow({ where: { id } });
  const name = domainName.parse(domain.name);
  const dir = path.join(env.DKIM_DIR, name);
  await mkdir(dir, { recursive: true, mode: 0o750 });
  const keyPath = path.join(dir, `${domain.dkimSelector}.key`);
  try {
    const key = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
      publicKeyEncoding: { format: 'pem', type: 'spki' },
    });
    await writeFile(keyPath, key.privateKey, { mode: 0o640, flag: 'wx' });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  const privateKey = createPrivateKey(await readFile(keyPath));
  const publicKey = createPublicKey(privateKey)
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
  await db.domain.update({
    where: { id },
    data: { dkimPublicKey: publicKey, provisionedAt: new Date() },
  });
}
export async function executeJob(db: PrismaClient, env: Environment, job: Job) {
  if (job.kind === 'PROVISION_DOMAIN') await provisionDomain(db, env, job.entityId);
  else if (job.kind === 'CHECK_DOMAIN') {
    const domain = await db.domain.findUniqueOrThrow({ where: { id: job.entityId } }),
      checks = await checkDomain(domain, env);
    const owned = checks.some((c) => c.name === 'ownership' && c.passed);
    await db.domain.update({
      where: { id: domain.id },
      data: {
        readiness: checks,
        readinessAt: new Date(),
        verifiedAt: owned ? (domain.verifiedAt ?? new Date()) : null,
        active: owned ? (domain.verifiedAt ? domain.active : !!domain.provisionedAt) : false,
        sendingEnabled: domain.sendingEnabled && owned && sendingReady(checks),
      },
    });
  } else throw new Error('UNSUPPORTED_JOB');
}
export async function reconcileHosts(db: PrismaClient, env: Environment) {
  const directory = process.env.ROUTES_DIR ?? '/data/routes';
  await mkdir(directory, { recursive: true });
  const domains = await db.domain.findMany({
    where: { active: true, verifiedAt: { not: null } },
    select: { name: true },
  });
  const contents =
    [
      `${env.MAIL_HOSTNAME} 1;`,
      ...domains.map((d) => `webmail.${domainName.parse(d.name)} 1;`),
    ].join('\n') + '\n';
  let old = '';
  try {
    old = await readFile(path.join(directory, 'hosts.map'), 'utf8');
  } catch {
    /* First run. */
  }
  if (old !== contents) {
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    await writeFile(temporary, contents, { mode: 0o644 });
    await rename(temporary, path.join(directory, 'hosts.map'));
  }
}
export async function processNextJob(db: PrismaClient, env: Environment) {
  const job = await claimJob(db);
  if (!job) return false;
  try {
    await executeJob(db, env, job);
    await db.job.updateMany({
      where: { id: job.id, lockToken: job.lockToken, status: 'RUNNING' },
      data: { status: 'SUCCEEDED', lockedAt: null, lockToken: null, lastError: null },
    });
  } catch {
    await db.job.updateMany({
      where: { id: job.id, lockToken: job.lockToken, status: 'RUNNING' },
      data: {
        status: job.attempts >= 5 ? 'FAILED' : 'PENDING',
        lockedAt: null,
        lockToken: null,
        lastError: 'PROVISIONING_FAILED: inspect service health and configuration.',
        availableAt: new Date(Date.now() + Math.min(300, 2 ** job.attempts) * 1000),
      },
    });
  }
  return true;
}
