// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { request } from 'node:http';
export type HostOperation =
  | 'task'
  | 'status'
  | 'refresh'
  | 'certificate'
  | 'webmail'
  | 'backup'
  | 'restore-check'
  | 'backup-configure'
  | 'dns-provider';
export async function hostAction(
  operation: HostOperation,
  target?: string,
  values?: Record<string, string>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const socketPath = process.env.HOST_AGENT_SOCKET;
  if (!socketPath) throw new Error('HOST_AGENT_NOT_INSTALLED');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ operation, target, values, idempotencyKey });
    const req = request(
      {
        socketPath,
        path: '/action',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 65536) req.destroy(new Error('HOST_RESPONSE_TOO_LARGE'));
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            if (res.statusCode !== 200) reject(new Error('HOST_ACTION_FAILED'));
            else resolve(parsed);
          } catch {
            reject(new Error('HOST_RESPONSE_INVALID'));
          }
        });
      },
    );
    req.on('error', () => reject(new Error('HOST_UNAVAILABLE')));
    req.on('timeout', () => req.destroy(new Error('HOST_TIMEOUT')));
    req.end(body);
  });
}
