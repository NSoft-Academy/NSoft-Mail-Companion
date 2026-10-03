# Guided-installation maintenance

The installer is an initial-installation/resume tool, **not an upgrade script**. Rerunning it keeps the original deployment method and pinned commit. Never delete `/etc/nsoft-mail/installation.json` to force adoption or conversion.

## Reviewed updates

1. Record the installed commit shown in Server setup & health. Review release notes and migration changes. No installer releases are published yet.
2. Run and verify an off-server backup and isolated database/mail recovery drill. Keep the old binaries and root-owned installation state available for rollback.
3. Arrange a maintenance window. Stage a clean reviewed checkout outside `/opt/nsoft-mail-companion`. Build native application dependencies as an unprivileged build identity; do not run package lifecycle scripts as root. Verify original source before installing privileged helper changes.
4. Stop writers, apply additive Prisma migrations using the migration role, and atomically install the reviewed application and helper revision. Preserve database role passwords, the encryption key, DKIM, TLS, maildirs, Postfix queue, Roundcube data and proxy routes.
5. Restart only NSoft services. Check readiness, DNS/TLS, MFA, mail submission/receiving, aliases, quotas, webmail and backup scheduling. Check unrelated Coolify apps continue to work.
6. Record the new revision only after verification. Roll back binaries and configuration if checks fail. Database changes need their own compatible rollback or restored backup; never run a production database reset.

Automatic binary upgrade orchestration is intentionally absent. A tested versioned upgrade command is a later release requirement; the dashboard reports the installed revision and this manual maintenance policy.

## Native ↔ Docker or separate-server migration

Conversion is never automatic. Use an eligible fresh target with the chosen method, reserve a maintenance window and rehearse restoration first. Preserve all mail data, queues and DKIM keys. Back up both databases and root configuration securely. Restore to isolated target paths and confirm UID/GID mappings and database privileges before enabling listeners. Do not run two independent nodes writing the same maildir or queue.

Keep customer MX unchanged until receiving, submission, IMAP and webmail pass on the target. Issue publicly trusted target certificates, configure its public A/PTR, update SPF if the sending IP changes, and deliberately change MX/webmail DNS with appropriate TTLs. Drain the old queue and keep the old node available during DNS propagation. Re-test external receiving and delivery placement. Revert DNS and restore the old node only according to the rehearsed rollback procedure.

Existing manual Docker installations should retain their current Compose volumes, secrets and proxy. Do not run the fresh installer over them. Apply the additive database migration and application changes through their existing maintenance workflow to use the browser wizard for domain tasks; server actions remain unavailable until the restricted helper is deliberately installed and reviewed. See [operations](operations.md) and [Coolify deployment](coolify.md).
