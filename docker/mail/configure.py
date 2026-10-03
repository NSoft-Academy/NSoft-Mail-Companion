# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import os, re, pathlib, subprocess
hostname=os.environ['MAIL_HOSTNAME']
if not re.fullmatch(r'[a-z0-9.-]+',hostname): raise ValueError('Invalid mail hostname')
password=os.environ['MAIL_DB_PASSWORD']
if not re.fullmatch(r'[a-f0-9]{64}',password): raise ValueError('Use a 64-character hex MAIL_DB_PASSWORD')
base=pathlib.Path('/opt/nsoft')
for source,target in [('main.cf','/etc/postfix/main.cf'),('master.cf','/etc/postfix/master.cf'),('dovecot.conf','/etc/dovecot/dovecot.conf')]:
 pathlib.Path(target).write_text((base/source).read_text().replace('__MAIL_HOSTNAME__',hostname))
queries={
 'domains':"SELECT name FROM mail_domains WHERE name='%s'",
 'mailboxes':"SELECT email FROM mail_recipients WHERE email='%s'",
 'aliases':"SELECT destinations FROM mail_aliases WHERE source='%s'",
 'senders':"SELECT owners FROM mail_senders WHERE email='%s'",
 'sending':"SELECT action FROM mail_sending WHERE name='%d'",
}
for name,query in queries.items():
 target=pathlib.Path('/etc/postfix/pgsql-'+name+'.cf')
 target.write_text('hosts = postgres\nuser = mail_reader\npassword = '+password+'\ndbname = mailcompanion\nquery = '+query+'\n')
 target.chmod(0o640)
 subprocess.run(['chown','root:postfix',str(target)],check=True)
pathlib.Path('/etc/dovecot/sql.conf').write_text("driver = pgsql\nconnect = host=postgres dbname=mailcompanion user=mail_reader password="+password+"\ndefault_pass_scheme = ARGON2ID\npassword_query = SELECT email AS user, password_hash AS password FROM mail_accounts WHERE email='%u'\niterate_query = SELECT email AS username FROM mail_accounts\nuser_query = SELECT 5000 AS uid, 5000 AS gid, '/var/vmail/' || domain || '/' || local_part AS home, '*:bytes=' || (quota_mb::bigint * 1048576)::text AS quota_rule FROM mail_accounts WHERE email='%u'\n")
pathlib.Path('/etc/dovecot/sql.conf').chmod(0o600)
relay=os.environ.get('SMTP_RELAY_HOST','')
if relay:
 if not re.fullmatch(r'[a-z0-9.-]+',relay): raise ValueError('Invalid relay host')
 user=os.environ.get('SMTP_RELAY_USERNAME','');secret=os.environ.get('SMTP_RELAY_PASSWORD','')
 if not user or not secret or any(c in user+secret for c in '\r\n'): raise ValueError('Relay credentials missing or invalid')
 file=pathlib.Path('/etc/postfix/sasl_passwd');file.write_text('['+relay+']:587 '+user+':'+secret+'\n');file.chmod(0o600)
 subprocess.run(['postmap',str(file)],check=True)
 for entry in ['relayhost=['+relay+']:587','smtp_sasl_auth_enable=yes','smtp_sasl_password_maps=hash:/etc/postfix/sasl_passwd','smtp_sasl_security_options=noanonymous','smtp_tls_security_level=verify']:
  subprocess.run(['postconf','-e',entry],check=True)
