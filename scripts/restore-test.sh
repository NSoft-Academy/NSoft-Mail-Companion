#!/bin/sh
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
set -eu
# Explicitly touches only the synthetic compose.test.yaml cluster.
mkdir -p .runtime
docker compose -f compose.test.yaml exec -T postgres pg_dump -U nsoft_bootstrap -d mailcompanion -Fc > .runtime/restore-test.dump
docker compose -f compose.test.yaml exec -T postgres psql -v ON_ERROR_STOP=1 -U nsoft_bootstrap -d postgres -c 'CREATE DATABASE nsoft_restore_test OWNER nsoft_migrate'
trap 'docker compose -f compose.test.yaml exec -T postgres psql -U nsoft_bootstrap -d postgres -c "DROP DATABASE IF EXISTS nsoft_restore_test" >/dev/null' EXIT INT TERM
docker compose -f compose.test.yaml exec -T postgres pg_restore --no-owner -U nsoft_bootstrap -d nsoft_restore_test < .runtime/restore-test.dump
count=$(docker compose -f compose.test.yaml exec -T postgres psql -U nsoft_bootstrap -d nsoft_restore_test -tAc "SELECT COUNT(*) FROM mailboxes WHERE email IN ('alice@example.test','bob@example.test')")
[ "$count" = 2 ]
echo 'PASS isolated database dump/restore preserves synthetic mailboxes'
