-- Copyright © 2026 M Suthakaran, trading as NSoft Academy.
-- Licensed under the Apache License, Version 2.0.
CREATE TABLE system_setup (
 id TEXT PRIMARY KEY DEFAULT 'installation', bootstrap_hash TEXT, bootstrap_expires_at TIMESTAMPTZ,
 claimed_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, first_domain_id UUID,
 delivery_confirmed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE provider_connections (
 id UUID PRIMARY KEY, zone_id TEXT NOT NULL UNIQUE, zone_name TEXT NOT NULL,
 token_encrypted TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE system_tasks (
 id UUID PRIMARY KEY, operation TEXT NOT NULL, target TEXT, status "JobStatus" NOT NULL DEFAULT 'PENDING',
 attempts INTEGER NOT NULL DEFAULT 0, available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 locked_at TIMESTAMPTZ, lock_token UUID, result JSONB, last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX system_tasks_status_available_at_idx ON system_tasks(status, available_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON system_setup, provider_connections, system_tasks TO nsoft_runtime;
