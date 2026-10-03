// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { resolveTxt, resolveMx, resolve4, reverse } from 'node:dns/promises';
import { connect } from 'node:net';
import { connect as secureConnect } from 'node:tls';
import type { Domain } from '@nsoft/database';
import { type Check, type Environment } from '@nsoft/core';
export async function smtpGreeting(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 5000 });
    let data = '';
    const finish = (valid: boolean) => {
      socket.destroy();
      resolve(valid);
    };
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (data.includes('\r\n')) finish(/^220[ -]/.test(data));
      if (data.length > 4096) finish(false);
    });
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}
async function txt(name: string) {
  try {
    return (await resolveTxt(name)).map((parts) => parts.join(''));
  } catch {
    return [];
  }
}
export async function checkDomain(domain: Domain, env: Environment): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });
  const [ownership, spf, dkim, dmarc] = await Promise.all([
    txt(`_nsoft-verify.${domain.name}`),
    txt(domain.name),
    txt(`${domain.dkimSelector}._domainkey.${domain.name}`),
    txt(`_dmarc.${domain.name}`),
  ]);
  check(
    'ownership',
    ownership.includes(domain.verificationToken),
    'Ownership TXT must match the generated token.',
  );
  try {
    const mx = await resolveMx(domain.name);
    check(
      'mx',
      mx.length > 0 &&
        mx.every((r) => r.exchange.toLowerCase().replace(/\.$/, '') === env.MAIL_HOSTNAME),
      'MX must route exclusively to the canonical mail hostname.',
    );
  } catch {
    check('mx', false, 'No valid MX found.');
  }
  const policies = spf.filter((r) => r.startsWith('v=spf1 '));
  const expected = env.SMTP_RELAY_HOST
    ? `include:${env.SMTP_RELAY_SPF ?? 'UNCONFIGURED'}`
    : `ip4:${env.PUBLIC_IPV4}`;
  check(
    'spf',
    policies.length === 1 &&
      policies[0]!.split(/\s+/).includes(expected) &&
      !/\+?all(?:\s|$)/.test(policies[0]!.replace(/[-~?]all/g, '')),
    'One SPF policy must authorise the configured route and must not allow all senders.',
  );
  check(
    'dkim',
    !!domain.dkimPublicKey &&
      dkim.length === 1 &&
      dkim[0]!.replace(/\s/g, '').includes(`p=${domain.dkimPublicKey}`),
    'DKIM public key must match the provisioned private key.',
  );
  check(
    'dmarc',
    dmarc.length === 1 &&
      /^v=DMARC1\s*;/i.test(dmarc[0]!) &&
      /\bp\s*=\s*(none|quarantine|reject)\s*(;|$)/i.test(dmarc[0]!),
    'Publish a valid DMARC policy, beginning with monitoring.',
  );
  try {
    const records = await reverse(env.PUBLIC_IPV4);
    check(
      'ptr',
      records.some((r) => r.toLowerCase() === env.MAIL_HOSTNAME),
      'Set reverse DNS at the server/IP provider.',
    );
  } catch {
    check('ptr', false, 'Reverse DNS unavailable.');
  }
  try {
    check(
      'address',
      (await resolve4(env.MAIL_HOSTNAME)).includes(env.PUBLIC_IPV4),
      'Canonical A record must match the sending IPv4.',
    );
  } catch {
    check('address', false, 'Canonical A record unavailable.');
  }
  check(
    'smtp',
    await smtpGreeting(
      env.SMTP_RELAY_HOST ?? 'gmail-smtp-in.l.google.com',
      env.SMTP_RELAY_HOST ? 587 : 25,
    ),
    'Outbound SMTP must be reachable. This does not test inbox placement.',
  );
  check(
    'tls',
    await trustedSubmission(env.MAIL_HOSTNAME),
    'Public submission must complete STARTTLS with a trusted hostname-matching certificate.',
  );
  return checks;
}

export async function trustedSubmission(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 587, timeout: 5000 });
    let stage = 0,
      buffer = '';
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.length > 16384) return finish(false);
      const lines = buffer.split('\r\n');
      if (lines.length < 2) return;
      const last = lines[lines.length - 2] ?? '';
      if (!/^\d{3} /.test(last)) return;
      if (stage === 0) {
        if (!last.startsWith('220 ')) return finish(false);
        stage = 1;
        buffer = '';
        socket.write('EHLO nsoft-readiness\r\n');
      } else if (stage === 1) {
        if (!last.startsWith('250 ') || !buffer.includes('STARTTLS')) return finish(false);
        stage = 2;
        buffer = '';
        socket.write('STARTTLS\r\n');
      } else {
        if (!last.startsWith('220 ')) return finish(false);
        socket.removeListener('data', onData);
        const secure = secureConnect(
          { socket, servername: host, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
          () => {
            const certificate = secure.getPeerCertificate();
            const valid =
              secure.authorized && Date.parse(certificate.valid_to) > Date.now() + 7 * 86400000;
            secure.destroy();
            finish(valid);
          },
        );
        secure.on('error', () => finish(false));
      }
    };
    socket.on('data', onData);
  });
}
