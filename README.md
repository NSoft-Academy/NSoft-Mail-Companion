# NSoft Mail Companion

A self-hosted, Hestia-style mail companion for Coolify and standalone Docker. Create custom-domain mailboxes, delegate domain administration, and give customers their own `webmail.example.com` login.

**Copyright © 2026 M Suthakaran, trading as NSoft Academy.**

**Licensed under the Apache License, Version 2.0.**

This is an initial implementation for controlled pilots. Passing local tests does not establish production capacity, remote-provider inbox placement, or compatibility with every Coolify release. Review [verification](docs/verification.md) before hosting customer mail.

## Included

- Next.js panel, Express `/api/v1` API, PostgreSQL/Prisma, durable provisioning worker.
- Platform and tenant administrators, required TOTP MFA, tenant isolation, audit trail.
- Domains, ownership verification, mailboxes, passwords, suspension, aliases, catch-all, allocation quotas.
- Postfix, Dovecot, Rspamd, Redis, Roundcube and ClamAV container integration.
- Domain DNS instructions, optional scoped Cloudflare creation, DKIM keys, sending readiness checks.
- Direct delivery with optional authenticated SMTP relay, persistent messages/queues, backup and recovery tooling.
- No commercial limits on domains or mailboxes. Hardware, storage, quotas, and abuse controls still limit capacity.

Billing, bulk campaigns, reseller tiers, automatic clustering, external forwarding/SRS, and guaranteed inbox placement are not included. Mailbox users use Roundcube and normal SMTP/IMAP clients; they do not receive administrator accounts.

## Start here

Require a Linux server, Docker Engine with Compose 2.24+, a domain, public reachable IPv4, provider-controlled reverse DNS, and available mail ports. Linux x86-64 is the initial production target. Reserve at least 4 vCPU / 8 GiB RAM for a pilot including ClamAV; this is a starting budget, **not a measured mailbox capacity**. Do not install HestiaCP alongside this stack.

```sh
git clone https://github.com/NSoft-Academy/NSoft-Mail-Companion.git
cd NSoft-Mail-Companion
python3 scripts/generate-secrets.py
# Edit .env: WEB_URL, MAIL_HOSTNAME, PUBLIC_IPV4, ACME_EMAIL.
# Review the install guide before starting services.
docker compose up -d --build
```

The mail service stays closed until a certificate is installed. Configure your existing HTTPS proxy for the panel and gateway, then issue mail-protocol certificates using the [installation guide](docs/installation.md). Never publish database, Redis, API, or filtering ports.

Create the initial administrator without putting passwords in command-line arguments:

```sh
read -r BOOTSTRAP_EMAIL
read -rs BOOTSTRAP_PASSWORD; printf '\n'
export BOOTSTRAP_EMAIL BOOTSTRAP_PASSWORD
docker compose exec -e BOOTSTRAP_EMAIL -e BOOTSTRAP_PASSWORD api pnpm bootstrap
unset BOOTSTRAP_EMAIL BOOTSTRAP_PASSWORD
```

Open the panel, enroll an authenticator, create a tenant and domain, publish DNS records, run checks, create a `postmaster` mailbox, and enable sending only after readiness passes. Add every customer's webmail HTTPS hostname to the proxy.

## Coolify

Use [docs/coolify.md](docs/coolify.md). The companion integrates as Docker infrastructure; it does not patch Coolify or depend on a proprietary plugin interface. Mail TCP ports bypass the HTTP proxy, while panel and customer webmail use it. Normal application deployments must never delete mail volumes.

## Development and tests

Use Node.js 22 LTS and the pinned pnpm version. Tests use synthetic data and loopback-only infrastructure:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm e2e
# Database/API and local SMTP/IMAP/DKIM tests:
./scripts/test-stack.sh
```

For local application development, start the test PostgreSQL service and set `DATABASE_URL`, `WEB_URL=http://localhost:3000`, `NODE_ENV=development`, `ENCRYPTION_KEY`, `MAIL_HOSTNAME`, `PUBLIC_IPV4`, `DKIM_DIR=.runtime/dkim` and `USAGE_DIR=.runtime/usage` in your shell before `pnpm dev`. API listens on 4000; web listens on 3000. Environment files are not committed or automatically shared between workspaces.

## Documentation

- [Installation, certificates and DNS](docs/installation.md)
- [Coolify integration](docs/coolify.md)
- [Architecture and API](docs/architecture/overview.md)
- [Security and threat model](docs/security/threat-model.md)
- [Backups, restoration, upgrades and monitoring](docs/operations.md)
- [Deliverability and home-hosting limitations](docs/deliverability.md)
- [Verification and known limits](docs/verification.md)
- [Third-party licenses](THIRD_PARTY_NOTICES.md)

Read [SECURITY.md](SECURITY.md) for private vulnerability reporting and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting code.
