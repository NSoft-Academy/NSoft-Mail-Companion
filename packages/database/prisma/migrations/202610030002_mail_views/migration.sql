-- Copyright © 2026 M Suthakaran, trading as NSoft Academy.
-- Licensed under the Apache License, Version 2.0.
ALTER TABLE domains ADD CONSTRAINT domain_quota_positive CHECK (quota_mb>0);
ALTER TABLE mailboxes ADD CONSTRAINT mailbox_quota_positive CHECK (quota_mb>0);
ALTER TABLE users ADD CONSTRAINT user_tenant_role CHECK ((role='PLATFORM_ADMIN' AND tenant_id IS NULL) OR (role='DOMAIN_ADMIN' AND tenant_id IS NOT NULL));
CREATE VIEW mail_domains AS SELECT name FROM domains WHERE active AND verified_at IS NOT NULL AND provisioned_at IS NOT NULL;
CREATE VIEW mail_accounts AS SELECT m.email,m.password_hash,m.local_part,d.name AS domain,m.quota_mb FROM mailboxes m JOIN domains d ON d.id=m.domain_id WHERE m.active AND d.active AND d.verified_at IS NOT NULL AND d.provisioned_at IS NOT NULL;
CREATE VIEW mail_recipients AS SELECT email FROM mail_accounts;
CREATE VIEW mail_aliases AS SELECT a.source,array_to_string(a.destinations,',') AS destinations FROM aliases a JOIN domains d ON d.id=a.domain_id WHERE a.active AND d.active AND d.verified_at IS NOT NULL;
CREATE VIEW mail_senders AS
 SELECT email,email AS owners FROM mail_accounts
 UNION ALL
 SELECT a.source,array_to_string(a.destinations,',') AS owners FROM aliases a JOIN domains d ON d.id=a.domain_id WHERE a.active AND d.active AND a.source NOT LIKE '@%';
CREATE VIEW mail_sending AS SELECT name,CASE WHEN active AND sending_enabled AND verified_at IS NOT NULL AND provisioned_at IS NOT NULL AND readiness_at>NOW()-INTERVAL '24 hours' THEN 'DUNNO' ELSE 'REJECT Sending disabled until domain readiness passes' END AS action FROM domains;

GRANT USAGE ON SCHEMA public TO mail_reader;
GRANT SELECT ON mail_domains,mail_accounts,mail_recipients,mail_aliases,mail_senders,mail_sending TO mail_reader;
REVOKE ALL ON tenants,users,sessions,domains,mailboxes,aliases,jobs,audit_logs FROM mail_reader;

GRANT USAGE ON SCHEMA public TO nsoft_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenants,users,sessions,domains,mailboxes,aliases,jobs,audit_logs TO nsoft_runtime;
GRANT SELECT ON mail_domains,mail_accounts,mail_recipients,mail_aliases,mail_senders,mail_sending TO nsoft_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT SELECT,INSERT ON audit_logs TO nsoft_runtime;
