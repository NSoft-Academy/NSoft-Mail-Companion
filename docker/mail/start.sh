#!/bin/sh
set -eu
umask 077
python3 /opt/nsoft/configure.py
mkdir -p /var/vmail /data/usage /var/spool/postfix/private
chown vmail:vmail /var/vmail
chown 1000:1000 /data/usage
while [ ! -s /data/tls/fullchain.pem ] || [ ! -s /data/tls/privkey.pem ]; do
  echo 'Mail TLS certificate missing. Run certificate setup; mail service remains closed.'
  sleep 10
done
postfix check
doveconf -n >/dev/null
exec supervisord -c /opt/nsoft/supervisord.conf
