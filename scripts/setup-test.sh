#!/bin/sh
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
set -eu
# Only the fixed synthetic test project/database is touched. Never accept a production URL.
docker compose -f compose.test.yaml exec -T postgres dropdb -U nsoft_bootstrap --if-exists nsoft_setup_test
docker compose -f compose.test.yaml exec -T postgres createdb -U nsoft_bootstrap -O nsoft_migrate nsoft_setup_test
trap 'docker compose -f compose.test.yaml exec -T postgres dropdb -U nsoft_bootstrap --if-exists nsoft_setup_test' EXIT
DATABASE_URL=postgresql://nsoft_migrate:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@127.0.0.1:55439/nsoft_setup_test pnpm db:migrate
SETUP_DATABASE_URL=postgresql://nsoft_runtime:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc@127.0.0.1:55439/nsoft_setup_test pnpm exec vitest run --config vitest.integration.config.ts tests/integration/setup.test.ts
