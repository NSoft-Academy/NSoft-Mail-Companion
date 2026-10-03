# Architecture

## Components and trust boundaries

`apps/web` is a Next.js operational panel. It proxies `/api/v1` to Express; the Docker build sets the internal API hostname before Next compiles rewrites. `apps/api` validates requests, authenticates sessions, checks MFA and tenant policies, applies business rules and writes audit records. `apps/worker` provisions keys, verifies DNS/delivery readiness, reconciles allowed webmail hosts, collects usage and sends configured operational alerts. No application mounts Docker's socket or accepts arbitrary shell commands.

`packages/core` contains Zod schemas, permission helpers, encryption and DNS instructions. `packages/database` contains Prisma models and migrations. Domain and mailbox creation writes are transactional; domain-row locking and serializable mailbox allocation prevent quota overbooking. Job claiming uses PostgreSQL `FOR UPDATE SKIP LOCKED`, leases, bounded retries and lock tokens. Repeated DKIM provisioning preserves existing private keys.

Postfix receives SMTP and uses SQL views to recognise domains, recipients, aliases, allowed senders and sending readiness. Dovecot authenticates with Argon2id SQL hashes and delivers through LMTP to Maildir with quotas. Rspamd enforces filtering, signing, authenticated From consistency and rate limits. Roundcube connects through IMAPS/STARTTLS, never directly reading mailbox password hashes. Its SQL database and password are separate. PostgreSQL's bootstrap superuser is only used for initialization/recovery; migrator owns schema, runtime can write application tables, and mail-reader can only read its lookup views.

## State

Models: Tenant, User, Session, Domain, Mailbox, Alias, Job, AuditLog. User roles are platform administrator and tenant-scoped domain administrator. Mailbox users authenticate to SMTP/IMAP/webmail, not the management API. Domain ownership, provisioning and sending are separate states. SQL disables sending if readiness is older than 24 hours even if the worker is unavailable. Periodic checks refresh readiness and disable sending on failure.

Mailbox/queue storage, DKIM keys, certificates, routes, Redis/filter state and Roundcube state live outside application images. Persistent storage is never replaced during normal deployment. Suspensions retain mail. Direct SMTP and relay modes are explicitly configured globally through deployment environment; there is no automatic delivery fallback or per-domain relay setting in v1.

## REST API

Responses are `{success:true,data:...}` or `{success:false,error:{code,message,fields?}}`. Password hashes and secrets are excluded from responses. Lists are tenant-filtered; foreign resource IDs return 404. Record conflicts return 409, invalid fields 422, unauthenticated requests 401, forbidden/CSRF/MFA failures 403. Resource UUIDs are validated. Mailbox usage is serialised as decimal bytes.

- Authentication: `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/mfa/enroll`, `POST /auth/mfa/confirm`.
- Domains: `GET/POST /domains`, `GET/PATCH /domains/:id`, `POST /domains/:id/sending`, `GET /domains/:id/dns`, `POST /domains/:id/check`.
- Mailboxes: `GET/POST /domains/:id/mailboxes`, `PATCH /mailboxes/:id` (suspend/reactivate or reset password).
- Aliases: `GET/POST /domains/:id/aliases`, `DELETE /aliases/:id`; internal same-domain destinations only, explicit `*` catch-all.
- Platform administration: `GET/POST /tenants`, `GET/POST /users`, `PATCH /users/:id`, `GET /settings`.
- DNS automation: platform-only `POST /domains/:id/cloudflare/preview` and `/apply` with explicit record indices and `confirmed:true`.
- Operations: `GET /overview`, `GET /jobs`, `GET /audit`, and public process/database liveness `/health`, `/ready`.

Paths above are under `/api/v1` except health. Cookie authentication requires an exact configured Origin and `X-CSRF-Token` for writes. Tokens are random, hashed in DB and expire after eight hours. MFA enrollment is the only permitted initial setup operation before protected management; password/MFA recovery is intentionally local and audited.

## Decisions

No artificial mailbox caps, but tenant quotas and optional mailbox count limits. One node with portable migration. SMTP/IMAP certificates are independent of Coolify's HTTP certificates. No public registration. Original source is Apache-2.0, with third-party components remaining separately licensed. No HestiaCP code is incorporated.
