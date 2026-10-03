# Operations, backups and recovery

## Durable storage

Keep a stable Compose project name (`nsoft-mail`). Never use `docker compose down -v` for production. Named volumes hold PostgreSQL, Maildir, queued mail, DKIM keys, TLS certificates, allowed-host routes, Redis/filter state and webmail data. Changing a Coolify resource name may create different volume names: inspect generated storage mappings before every migration.

## Encrypted off-server backup

For a new production install, merge `compose.backup.yaml` before creating data; set `NSOFT_BACKUP_ROOT=/srv/nsoft-mail` in `.env` and the backup service environment. This changes critical mail/key paths to named, administrator-controlled bind directories that restic can capture. Moving an existing install to bind mounts requires an offline copy and ownership preservation; simply adding the overlay to an existing install creates empty storage.

Create the directories under a root-owned parent and run volumes-init to set worker ownership. Install restic on the server. Set `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` and provider credentials in a root-readable environment file outside Git. Run `restic init` once. Keep the same storage overlay selected through `COMPOSE_FILE=compose.yaml:compose.backup.yaml` (and Coolify overlay where applicable).

Run `scripts/backup.sh` daily using systemd/cron. It stops mail/worker/API/webmail writers, dumps application and webmail databases, encrypts the bind directory to off-server storage, retains 30 daily snapshots and checks repository integrity. Mail is unavailable during this consistency window; remote SMTP senders should retry. The shell trap restarts services on success or failure. A failed job must alert through the host scheduler; worker alerts also detect a missing/overdue backup timestamp after 36 hours.

Keep an encrypted offline copy of deployment secrets, the database role passwords, the encryption key and the exact Git revision. These are not implicitly captured from `.env`. Redis/filter caches can be rebuilt, but losing DKIM private keys or mailbox data is not acceptable. Do not treat an on-server snapshot as off-server backup.

## Restoration

1. Restore into a new isolated server first. Disable public mail ports and use the recorded Git revision. Supply the original deployment secrets through a secure channel.
2. Run `restic snapshots --tag nsoft-mail`, choose a snapshot, and `restic restore <snapshot> --target <isolated-directory>`; verify `restic check` and restored file hashes.
3. Copy restored critical directories to the configured bind root preserving ownership (vmail UID/GID 5000, worker/DKIM UID/GID 1000). Do not overwrite a live mail store.
4. Start only PostgreSQL; its initializer recreates separate roles from the original secrets. Restore each custom dump using `pg_restore --clean --if-exists --no-owner` as the bootstrap role into the correct database. Reassign schema objects to the migration owner and reapply the documented runtime/mail-reader grants if restoring from an older schema.
5. Run migration validation, start services privately, and test IMAP mailbox content, SMTP sender permissions, aliases, keys, queues and public certificate validity. Reconcile routes with the worker.
6. Only then switch DNS/IP routing and reopen mail ports. Review queued messages for duplicates and record the recovery point/time.

Restoration is an administrator-controlled procedure, not an unattended command that can overwrite production. Test it quarterly and before accepting customer mail. The local verification report distinguishes executable tooling checks from a real off-server restore drill.

## Upgrades and rollback

Pin a reviewed Git revision and locked dependencies. Build/stage images, back up first, apply Prisma migrations with the migration role, restart with minimal interruption and verify `/health`, `/ready`, SMTP/IMAP and webmail. Never use `prisma migrate reset` or destructive database resets in production. Roll back application images only when the schema remains compatible; otherwise use a verified recovery point with an agreed mail outage. Published Docker tags identify component versions; record image digests for promotion and do not use floating `latest` tags.

## Monitoring and logs

API logs contain request ID, matched route, method, status and duration without request bodies, cookies, passwords or tokens. Standard mail daemon logs contain operational email addresses: restrict access and configure Docker log rotation (`max-size=10m`, `max-file=5`) or your host logging policy. Never publish production mail logs to GitHub.

Worker collects quota usage from Dovecot and watches mail queue depth/age, disk space, stale health and overdue backup timestamps. It can notify a configured external HTTPS `ALERT_WEBHOOK`; avoid relying on this same mail server to report its outage. Configure independent external monitoring for HTTPS `/health` and `/ready`, ports 25/587/993, certificate expiry and systemd backup/renewal failures. Worker-only monitoring cannot report a stopped worker or host outage.

The mail service reloads changed TLS certificates. Verify expiry with a real STARTTLS/IMAPS client after the renewal timer runs. Investigate queue growth rather than automatically switching to a relay or discarding messages.

## Moving to another server

Provision the destination privately, backup/restore offline, preserve server hostname and customer MX names, then update its A/PTR and SPF. Use a short planned cutover with only one active writer. Recheck provider outbound permissions and sending reputation; test inbound mail and client TLS. Domain/tenant count alone is not a capacity metric: storage, concurrent connections, indexing and antivirus load matter.
