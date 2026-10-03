#!/bin/sh
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
set -eu
# Synthetic local encrypted restore drill. This is not an off-server production backup.
mkdir -p .runtime/backup-input .runtime/restic-repository .runtime/restic-restored
docker compose -f compose.test.yaml exec -T postgres pg_dump -U nsoft_bootstrap -d mailcompanion -Fc > .runtime/backup-input/control.dump
docker compose -f compose.test.yaml exec -T mail tar -C /var/vmail -cf - . > .runtime/backup-input/maildir.tar
docker compose -f compose.test.yaml run --rm --entrypoint tar certificates -C /data -cf - dkim tls > .runtime/backup-input/keys.tar
restic_test() {
 docker run --rm -e RESTIC_PASSWORD=synthetic-test-password -e RESTIC_REPOSITORY=/repository -v "$PWD/.runtime/backup-input:/input:ro" -v "$PWD/.runtime/restic-repository:/repository" -v "$PWD/.runtime/restic-restored:/restored" restic/restic:0.18.1 "$@"
}
if [ ! -f .runtime/restic-repository/config ]; then restic_test init; fi
restic_test backup /input --tag synthetic-nsoft-test
restic_test check
restic_test restore latest --target /restored
python3 - <<'PY'
from pathlib import Path
import hashlib
for original in Path('.runtime/backup-input').iterdir():
 restored=Path('.runtime/restic-restored/input')/original.name
 assert hashlib.sha256(original.read_bytes()).digest()==hashlib.sha256(restored.read_bytes()).digest(),original.name
print('PASS encrypted local restore preserves database dump, Maildir and key archive hashes')
PY
