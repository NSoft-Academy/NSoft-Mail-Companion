#!/bin/sh
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
set -eu
python3 -m venv .runtime/python
.runtime/python/bin/pip install -r tests/requirements.txt
mkdir -p .runtime/routes
printf "mail.example.test 1;\nwebmail.example.test 1;\n" > .runtime/routes/hosts.map
# Only the fixed, loopback-only synthetic test project is touched.
docker compose -f compose.test.yaml up -d --build
export DATABASE_URL=postgresql://nsoft_migrate:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@127.0.0.1:55439/mailcompanion
pnpm db:migrate
unset DATABASE_URL
pnpm test:integration
pnpm exec tsx scripts/setup-test-mail.ts
pnpm exec tsx scripts/provision-test-mail.ts
mkdir -p .runtime
docker compose -f compose.test.yaml cp certificates:/data/tls/fullchain.pem .runtime/test-ca.pem
docker compose -f compose.test.yaml cp .runtime/dkim/example.test/nsoft2026.key certificates:/data/dkim/example.test/nsoft2026.key
docker compose -f compose.test.yaml run --rm --entrypoint sh certificates -c 'chown -R 1000:1000 /data/dkim; chmod 640 /data/dkim/example.test/nsoft2026.key'
docker compose -f compose.test.yaml exec -T rspamd rspamadm configtest
python3 scripts/wait-test-stack.py
TEST_CA_FILE=.runtime/test-ca.pem .runtime/python/bin/python scripts/mail-smoke.py
docker compose -f compose.test.yaml up -d --force-recreate --no-deps mail
python3 scripts/wait-test-stack.py
TEST_CA_FILE=.runtime/test-ca.pem .runtime/python/bin/python scripts/mail-smoke.py
# Stop containers when finished. Volumes are deliberately retained for persistence tests.
./scripts/backup-test.sh
./scripts/restore-test.sh
python3 scripts/certificate-test.py
TEST_WEBMAIL=true pnpm e2e
docker compose -f compose.test.yaml -f compose.application-test.yaml up -d --build api web
python3 scripts/application-test.py
docker compose -f compose.test.yaml -f compose.application-test.yaml stop api web
docker compose -f compose.test.yaml stop
