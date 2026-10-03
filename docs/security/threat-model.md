# Threat model

## Assets and actors

Assets: mailbox contents, mailbox password hashes, administrator sessions and MFA secrets, DKIM private keys, DNS credentials, mail reputation, audit records and backups. Actors include tenant administrators, mailbox users, platform operators, internet SMTP senders, compromised mail clients and compromised public webmail.

## Boundaries and mitigations

- Tenant resource ownership is checked in Express, not inferred from UI visibility. Platform role creation is server-local; domain administrators cannot select another tenant or create platform administrators. UUID enumeration returns 404 for foreign resources.
- Required TOTP MFA gates management. Random 256-bit session tokens are hashed in DB, expire after eight hours and are revoked on logout/recovery. Secure/HttpOnly/SameSite cookies plus exact Origin and session-bound CSRF headers protect writes. MFA enrollment invalidates other sessions. Encryption keys never go to the browser.
- Login IP limits and persistent account failure counters delay brute force; mailbox login protection and SMTP rate/connection controls remain separate operational concerns. MFA code reuse is rejected on normal login; recovery requires trusted server access.
- Postfix denies unauthenticated relay and enforces authenticated envelope sender ownership. Rspamd rejects authenticated From header/envelope mismatches. Domain sending remains disabled until recent readiness passes, including in SQL lookups when the worker stops. Credentials require TLS; IMAP plaintext ports are disabled.
- Strong Argon2id hashes support Dovecot and API users without plaintext password storage. The mail-reader role can read lookup views, including mail hashes required by Dovecot, but not application tables. Roundcube has a separate database/secret and no SQL access to those hashes. API/worker runtime is not a superuser or schema migration owner.
- Private networks and unpublished admin/DB/filter ports reduce exposure. API/worker have no Docker socket. Public webmail only accepts verified allowed hostnames. Do not expose the management API port directly when relying on one trusted HTTP proxy hop for client IPs.
- Zod rejects unknown fields and unsafe domain/local-part strings. Provisioning never interpolates client data into a shell. Cloudflare paths/zone ownership are checked; tokens are operator-supplied scoped deployment secrets. DNS automation cannot overwrite existing records.
- Filtering includes Rspamd/ClamAV. Their signatures, caches, process health and resource use need monitoring. Backup encryption, host firewalls, root recovery and operating-system patching remain operator responsibilities.

## Residual risks

One mail IP carries shared reputation across tenants; abuse can affect everyone. Same-VPS applications share host failure/resource risks. A host-root compromise exposes mail and secrets. A compromised API still has substantial write authority over mail configuration. Volume encryption at rest depends on host/storage settings; TLS is not end-to-end message encryption. Do not assume that a working ClamAV container scans every message until a harmless antivirus test has been verified.

SPF validation is an intentional configuration gate rather than an exhaustive standards resolver. Provider inbox behaviour, DNS changes and remote outages cannot be guaranteed by the application. External forwarding is rejected pending correctly tested SRS/ARC support. Limit per-tenant mail volume, monitor compromise and suspend abused accounts promptly.
