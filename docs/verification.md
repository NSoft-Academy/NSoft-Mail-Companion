# Verification and pilot acceptance

This report records local verification on 4 October 2026. It is not a certificate of production readiness for an untested server. No live customer deployment or external recipient delivery was performed.

## Executed locally

- Locked pnpm installation, formatting, ESLint, strict application/package TypeScript, and production builds succeeded. Next.js panel first-load JavaScript is approximately 109 kB in the production build.
- 11 unit tests cover validation, isolation policies, authenticated secret encryption, sending gates, DNS checks and unreachable outbound relay behavior.
- 14 real PostgreSQL/API/worker tests cover MFA enrollment, CSRF, tenant boundaries, privilege denial, mailbox hashes, quotas, aliases, readiness enforcement, durable jobs, concurrent claims, stale leases, bounded retries and unchanged DKIM keys. The runtime database role is not a superuser and cannot delete audit history.
- Chromium tests cover sign-in errors, accessible empty dashboard, mobile keyboard navigation, provisioning retries and live Roundcube login through a customer hostname. Automated axe checks report no violations on sign-in and the empty dashboard; layout checks pass at 320, 390, 768, 1024, 1440 and 1920 pixels. Panel tests mock API responses; separate API and live webmail tests exercise their real services.
- The isolated Docker mail stack passes unauthenticated relay denial, no AUTH before STARTTLS, invalid credential rejection, authenticated envelope and From-header ownership, alias delivery, IMAP quota enforcement, and rejection of the standard harmless antivirus test pattern.
- SMTP → Postfix → Rspamd → LMTP → Dovecot delivery reaches a local IMAP mailbox, with the DKIM signature independently verified using dkimpy. This does not establish external inbox placement.
- The same mail-protocol checks pass after recreating the mail container while preserving mail/queue/key volumes. Existing messages remain accessible.
- Replacing a synthetic TLS certificate triggers Dovecot reload without container recreation. The synthetic gateway reload is also exercised; actual ACME issuance/renewal remains a deployment check.
- A synthetic PostgreSQL dump restores into a separate database with its mailbox records. A local restic encrypted repository passes integrity checking and restores byte-identical database dump, Maildir and key archives. This is a local restore drill, not an off-server backup verification.
- Production Docker application smoke confirms the panel rewrites requests to the separate API container using its internal hostname.
- Production pnpm dependency audit reports no known vulnerabilities at verification time. Local Git-history secret scanning reports no leaked secrets. CI additionally runs these scans and CodeQL; their remote results should be checked on the implementation PR.

Reproduce with `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, Chromium installation and `./scripts/test-stack.sh`. Docker, Python with venv support, outbound image/package access and free loopback test ports are required. Synthetic fixtures and private test artifacts remain under ignored `.runtime/`. Never deploy `compose.test.yaml` or `compose.application-test.yaml` publicly.

## Measured resource observation

A local Docker Desktop observation during synthetic testing showed approximately 55 MiB for mail daemons, 73 MiB for Rspamd, 46 MiB for PostgreSQL and 964 MiB for ClamAV. The local engine had 7.75 GiB available. ClamAV ran as an emulated x86-64 container on an ARM Mac; these numbers are observations, not Linux production capacity ratings. They exclude application/webmail memory, operating-system overhead, peak antivirus scans, indexing and backups.

No mailbox/domain throughput or customer capacity has been certified. The recommended pilot starting budget is 4 vCPU and 8 GiB RAM, matching README. This is a conservative recommendation, not a verified minimum or certified capacity; monitor actual peaks and increase resources for larger workloads. Measure simultaneous IMAP sessions, submission/delivery latency, message sizes, scanner throughput, disk IOPS, queue depth and backup duration on the target server before publishing supported capacity. There are no paid account caps; configured quotas, per-domain mailbox limits and abuse rates apply.

## Required target-server checks

Before accepting customer mail, record evidence for:

1. Linux x86-64 deployment, provider/firewall inbound mail ports and outbound 25 permission; configured relay authentication, trusted TLS, SPF and failure behavior when direct delivery is unavailable.
2. Canonical A/PTR, every domain's ownership/MX/SPF/DKIM/DMARC, authoritative propagation and public hostname-matching certificates. The SPF check validates the configured route; it is not a complete recursive SPF evaluator.
3. Real ACME issue and renewal, Postfix and Dovecot reloaded certificates, and expiry alerts. The local test uses synthetic trust only; production verification remains enabled.
4. Coolify's actual generated proxy labels, exact customer webmail HTTPS certificates, preserved Host headers, ACME routing, stable storage mappings and coexistence with existing applications. The overlay has been source-reviewed, not exercised against a live Coolify installation.
5. A scoped Cloudflare token in an isolated test zone: preview, selected-record creation, existing-record refusal and partial-write recovery. No production zone was mutated during implementation.
6. Controlled external Gmail/Outlook/other recipient tests, recording inbox versus spam placement and authentication results; monitored bounces, complaints, reputation and warmed-up sending rates. SMTP acceptance never guarantees inbox delivery.
7. An encrypted **off-server** backup/restore drill including offline deployment secrets, owners/grants, queued mail and key preservation, followed by a planned separate-server migration rehearsal.
8. Target-server capacity measurement, spam-folder handling under real filtering, sustained abuse limits, upstream container/package security scanning, independent monitoring and incident/recovery procedures.

Local tests do not replace these checks. Keep production sending disabled until domain readiness succeeds and administrators have completed pilot acceptance. No merge or live deployment is part of this implementation PR.

## Guided installer verification (2026-10-04)

The beginner installer adds a native Ubuntu 24.04 path, optional Docker orchestration, resumable root state, a restricted Unix helper, browser bootstrap and a guided `/setup` interface. Local verification:

- 22 Python installer tests cover eligibility and CGNAT-address refusal, occupied mail ports, existing services/identities, hostname injection rejection, private atomic state, role-secret separation, source staging refusal for dirty checkouts/symlinks and removal of build-created privileged modules, Cloudflare conflict preservation and zone ownership, helper cgroup authorization, idempotent replay and failed-action retries.
- Six setup API tests run against a separately created, disposable PostgreSQL database: expiry/origin/wrong-token refusal, simultaneous bootstrap claims and replay, MFA and encrypted enrollment, idempotent first-domain creation, constrained system tasks/retries, incomplete-setup refusal, Cloudflare permission errors/encrypted provider credentials and redacted diagnostics. Three additional worker integration tests verify real database leases, bounded failures and interruption recovery through a synthetic Unix socket. Platform-only setup routes are also checked against domain administrator sessions.
- Browser tests cover the bootstrap fragment being removed, expiry recovery, saved progress, actionable blockers, task retry, axe accessibility and 320/390/768/1024/1440/1920px layouts. The full stack run includes the existing live Roundcube browser check (six browser tests total).
- An isolated **Ubuntu 24.04 x86-64** package fixture validates Postfix, Dovecot including Argon2 support, Rspamd, Nginx, PostgreSQL role creation, all migrations, Roundcube schema initialization and PHP syntax. This is configuration verification, not a fresh systemd installer acceptance run.
- The existing Docker mail/security, persistence, certificate replacement, local encrypted archive restore and isolated database restore checks pass again with the new migration and API. Production application Docker builds and internal API forwarding pass.
- Formatting, lint, strict TypeScript, unit tests and production builds pass. No live DNS, mail accounts or production services were changed.

Reproduce Python checks with `pnpm test:installer`. `./scripts/test-stack.sh` includes the isolated setup API suite via `scripts/setup-test.sh`. For the native package fixture:

```bash
docker build --platform linux/amd64 -t nsoft-native-config-test -f tests/installer/Dockerfile installer
docker run --rm --platform linux/amd64 -v "$PWD:/opt/nsoft-mail-companion:ro" nsoft-native-config-test bash /opt/nsoft-mail-companion/tests/installer/ubuntu-config.sh
```

**Still required before publishing an installer release:** fresh native and guided-Docker installation on eligible Ubuntu VMs; real systemd startup/reboot and interrupted/repeated installation; native SMTP/IMAP/webmail/alias/quota and full restore checks; actual Coolify coexistence and unrelated-route preservation; scoped Cloudflare success/permission failures in a test zone; public ACME issuance/renewal and reload failures; external inbound connectivity, residential/CGNAT scenarios and relay configuration; encrypted off-server recovery on both methods; representative nontechnical-user trials requiring no configuration-file editing on eligible direct-delivery servers. The dashboard reports a manual reviewed-update policy; automatic upgrades and automatic native/Docker conversion are absent. The guided restore check validates an isolated archive, not live recovery. Public inbox placement remains a measured test, never a promise.
