-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PLATFORM_ADMIN', 'DOMAIN_ADMIN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "tenant_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mfa_secret" TEXT,
    "pending_mfa_secret" TEXT,
    "mfa_last_step" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domains" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "verification_token" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sending_enabled" BOOLEAN NOT NULL DEFAULT false,
    "provisioned_at" TIMESTAMP(3),
    "dkim_public_key" TEXT,
    "dkim_selector" TEXT NOT NULL DEFAULT 'nsoft2026',
    "quota_mb" INTEGER NOT NULL DEFAULT 10240,
    "mailbox_limit" INTEGER,
    "readiness" JSONB,
    "readiness_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailboxes" (
    "id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "local_part" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "quota_mb" INTEGER NOT NULL DEFAULT 1024,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "used_bytes" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aliases" (
    "id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "destinations" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "external_forwarding" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "lock_token" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "tenant_id" UUID,
    "action" TEXT NOT NULL,
    "entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "domains_name_key" ON "domains"("name");

-- CreateIndex
CREATE INDEX "domains_tenant_id_idx" ON "domains"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_email_key" ON "mailboxes"("email");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_domain_id_local_part_key" ON "mailboxes"("domain_id", "local_part");

-- CreateIndex
CREATE UNIQUE INDEX "aliases_source_key" ON "aliases"("source");

-- CreateIndex
CREATE INDEX "jobs_status_available_at_idx" ON "jobs"("status", "available_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domains" ADD CONSTRAINT "domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

