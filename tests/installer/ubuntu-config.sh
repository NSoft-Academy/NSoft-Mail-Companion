#!/bin/bash
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
# Run only inside an isolated Ubuntu container, never on an existing server.
set -euo pipefail
[ -f /.dockerenv ] || { echo 'This fixture requires an isolated container.' >&2; exit 1; }
mkdir -p /var/lib/nsoft-mail/tls /etc/nsoft-mail
openssl req -x509 -newkey rsa:2048 -nodes -keyout /var/lib/nsoft-mail/tls/privkey.pem -out /var/lib/nsoft-mail/tls/fullchain.pem -days 2 -subj /CN=mail.example.test >/dev/null 2>&1
python3 - <<'PY'
import sys, pathlib, subprocess, os
from unittest.mock import patch
sys.path.insert(0,'/opt/nsoft-mail-companion/installer')
import native, common, proxy, install
state=dict(panel='panel.example.test',mail='mail.example.test',method='native',proxy='coolify',proxyAddress='127.0.0.1',dns='http')
native.identities()
native.configure_mail(state,{'MAIL_DB_PASSWORD':'a'*64})
assert 'ARGON2ID' in common.run(['doveadm','pw','-l']).stdout
common.atomic('/etc/nsoft-mail/nginx.conf','events {} http { include /etc/nginx/mime.types; '+proxy.nginx_config(state,[state['mail']])+' }',0o644)
common.run(['nginx','-t','-c','/etc/nsoft-mail/nginx.conf'])
assert pathlib.Path('/usr/share/roundcube/SQL/postgres.initial.sql').exists()
common.run(['pg_ctlcluster','16','main','start'])
secrets_data={key:'a'*64 for key in ('MIGRATION_DB_PASSWORD','APP_DB_PASSWORD','MAIL_DB_PASSWORD','ROUNDCUBE_DB_PASSWORD')}
secrets_data['ROUNDCUBE_DES_KEY']='b'*24
original=common.run
with patch.object(install,'run',side_effect=lambda args,**kw: subprocess.CompletedProcess(args,0,'','') if args[0]=='systemctl' else original(args,**kw)):
    install.sql(state,secrets_data)
for migration in sorted(pathlib.Path('/opt/nsoft-mail-companion/packages/database/prisma/migrations').glob('*/migration.sql')):
    common.run(['psql','-h','127.0.0.1','-U','nsoft_migrate','-d','mailcompanion','-v','ON_ERROR_STOP=1','-f',str(migration)],env={**os.environ,'PGPASSWORD':secrets_data['MIGRATION_DB_PASSWORD']})
native.configure_webmail(state,secrets_data)
common.run(['php','-l','/etc/roundcube/config.inc.php'])
common.run(['psql','-h','127.0.0.1','-U','mail_reader','-d','mailcompanion','-tAc','SELECT count(*) FROM mail_accounts'],env={**os.environ,'PGPASSWORD':secrets_data['MAIL_DB_PASSWORD']})
print('Ubuntu packaged Postfix, Dovecot/Argon2, Rspamd, Nginx and Roundcube configuration checks passed.')
PY
