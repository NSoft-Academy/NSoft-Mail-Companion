#!/bin/sh
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
set -eu
umask 077
: "${RESTIC_REPOSITORY:?Set encrypted off-server repository}"
: "${RESTIC_PASSWORD:?Set backup encryption password}"
: "${NSOFT_BACKUP_ROOT:?Set absolute bind-mount directory from compose.backup.yaml}"
command -v restic >/dev/null
[ "$NSOFT_BACKUP_ROOT" != / ] || exit 1
mkdir -p "$NSOFT_BACKUP_ROOT/database"
# This script requires compose.backup.yaml and the stable nsoft-mail Compose project name.
# Quiesce writers for a consistent single-node recovery point. A short mail outage is expected.
docker compose stop worker api roundcube mail
trap 'docker compose start mail api worker roundcube' EXIT INT TERM
docker compose exec -T postgres pg_dump -U nsoft_bootstrap -d mailcompanion -Fc > "$NSOFT_BACKUP_ROOT/database/control.dump"
docker compose exec -T postgres pg_dump -U nsoft_bootstrap -d roundcube -Fc > "$NSOFT_BACKUP_ROOT/database/roundcube.dump"
restic backup "$NSOFT_BACKUP_ROOT" --tag nsoft-mail
restic forget --tag nsoft-mail --keep-daily 30 --prune
restic check
mkdir -p "$NSOFT_BACKUP_ROOT/usage"
date -u +%s > "$NSOFT_BACKUP_ROOT/usage/backup.timestamp"
echo 'Backup and integrity check completed.'
