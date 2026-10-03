#!/bin/sh
set -eu
umask 077
status=0
if [ "${ACME_DNS_PROVIDER:-}" = dns_cf ]; then
 export CF_Token="$ACME_DNS_TOKEN" CF_Zone_ID="$ACME_DNS_ZONE_ID"
 acme.sh --issue --server letsencrypt -d "$MAIL_HOSTNAME" --dns dns_cf --accountemail "$ACME_EMAIL" --keylength 2048 || status=$?
else
 acme.sh --issue --server letsencrypt -d "$MAIL_HOSTNAME" -w /data/acme --accountemail "$ACME_EMAIL" --keylength 2048 || status=$?
fi
# acme.sh returns 2 when a previously issued certificate is not due for renewal.
[ "$status" = 0 ] || [ "$status" = 2 ] || exit "$status"
acme.sh --install-cert -d "$MAIL_HOSTNAME" --key-file /data/tls/privkey.next.pem --fullchain-file /data/tls/fullchain.next.pem
chmod 644 /data/tls/fullchain.next.pem
chmod 600 /data/tls/privkey.next.pem
mv /data/tls/privkey.next.pem /data/tls/privkey.pem
mv /data/tls/fullchain.next.pem /data/tls/fullchain.pem
