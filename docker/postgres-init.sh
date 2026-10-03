#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=migration_password="$MIGRATION_DB_PASSWORD" --set=app_password="$APP_DB_PASSWORD" --set=mail_password="$MAIL_DB_PASSWORD" --set=roundcube_password="$ROUNDCUBE_DB_PASSWORD" <<'SQL'
CREATE ROLE nsoft_migrate LOGIN PASSWORD :'migration_password';
CREATE ROLE nsoft_runtime LOGIN PASSWORD :'app_password';
CREATE ROLE mail_reader LOGIN PASSWORD :'mail_password';
CREATE ROLE roundcube LOGIN PASSWORD :'roundcube_password';
ALTER DATABASE mailcompanion OWNER TO nsoft_migrate;
GRANT ALL ON SCHEMA public TO nsoft_migrate;
CREATE DATABASE roundcube OWNER roundcube;
SQL
