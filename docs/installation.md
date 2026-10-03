# Installation

## Preflight

Use a dedicated hostname such as `mail.example.com`. Its A record must point to the public mail IPv4. Set that IP's PTR to the same hostname. Every hosted domain can use the same MX target; customer webmail hostnames remain separate. Do not publish AAAA records until IPv6 routing and reverse DNS are independently supported and tested (v1 sends IPv4 only).

Check the provider's SMTP policy, port 25 outbound, inbound 25, 465, 587 and 993, disk capacity, time synchronisation, and backups. Permit only these mail ports plus proxy HTTP/HTTPS; restrict SSH. Docker published ports can bypass host UFW rules: enforce provider firewall/DOCKER-USER policy as appropriate. Close PostgreSQL, Redis, filtering, and the Express API to the internet.

No real credentials are seeded. `scripts/generate-secrets.py` creates an ignored `.env` with independent secrets and mode 0600. Keep its encryption key and DB passwords in encrypted offline recovery storage. Changing environment passwords does not change existing PostgreSQL role passwords; rotate using a controlled DB change and coordinated service restart.

## Standalone reverse proxy

The base stack binds panel `127.0.0.1:3000` and webmail gateway `127.0.0.1:8080`; it deliberately leaves existing ports 80/443 to your proxy. Configure your Nginx/Caddy/Traefik rather than installing another conflicting proxy.

Initially route `http://mail.example.com/.well-known/acme-challenge/` to `127.0.0.1:8080` without redirect or authentication. For Nginx:

```nginx
server {
    listen 80;
    server_name mail.example.com;
    location /.well-known/acme-challenge/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }
    location / { return 404; }
}
```

Start the stack, then issue its SMTP/IMAP certificate:

```sh
docker compose --profile certificates run --rm acme
```

For an existing proxy that intercepts ACME paths, use the DNS-01 option below. Keep HTTPS certificates for the panel/webmail in the existing proxy. The mail certificate lives in the separate `tls` volume; it is used by Postfix and Dovecot. The gateway serves only verified active customer webmail hosts and the canonical mail hostname.

After certificate issuance, configure HTTPS panel to port 3000 and canonical/customer webmail to 8080 with `Host` preserved, `X-Forwarded-Proto: https`, and trusted proxy client-IP headers. Obtain certificates for **each exact hostname** (`panel.example.com`, `mail.example.com`, `webmail.customer.com`); a wildcard for `example.com` cannot cover a customer domain. Disable direct access to the backend HTTP ports.

## Certificate renewal

Set a root-owned systemd timer to run `scripts/renew-certificates.sh` twice daily from the checkout. Example units are in `docker/systemd/`; edit their project path before enabling. Renewals install the PEM files atomically. The mail service watches certificate changes and reloads Postfix/Dovecot. Check actual public SMTP/IMAP certificates after renewal. Expiring or untrusted certificates fail readiness.

Cloudflare DNS-01 is optional: set `ACME_DNS_PROVIDER=dns_cf`, `ACME_DNS_TOKEN`, and `ACME_DNS_ZONE_ID` in `.env`. Use a token scoped to the canonical hostname's zone. This token is separate from the panel's `CLOUDFLARE_TOKEN`. Without it the stack uses HTTP webroot validation. Manual DNS records remain supported for domain onboarding; manually issued external certificates can also be installed into the `tls` volume by an administrator.

## Onboarding

Bootstrap the platform administrator as in README and enroll MFA. Create a tenant and its domain administrators. Add a domain, publish the ownership TXT, wait for DKIM provisioning, then publish MX/SPF/DKIM/DMARC and webmail DNS. DNS automation previews changes and only creates explicitly selected absent records; it never overwrites existing MX/SPF. Multiple API writes are not transactional at Cloudflare: review the zone after a partial provider failure.

Run domain checks, refresh the panel, and create mailboxes after ownership verification activates the domain. Create `postmaster` for DMARC reports before publishing that reporting address. The checks are conservative for a single-node deployment: all domain MX records must point at the canonical host. Existing secondary-MX configurations require manual migration planning.

An ownership failure suspends the domain; recovery does not silently enable sending. Suspensions preserve mailbox data. v1 avoids destructive mailbox/domain deletion: deletion/retention procedures require administrator-controlled maintenance.

## Client settings

- Username: complete email address.
- Incoming: canonical mail hostname, IMAPS port 993.
- Outgoing: canonical mail hostname, submission 587 with STARTTLS or 465 with implicit TLS.
- Webmail: `https://webmail.<customer-domain>`.
- ManageSieve stays internal for Roundcube; POP3 is not enabled.

Strong mailbox passwords use Argon2id. Application and mailbox passwords are separate identities. Administrator password/MFA recovery is a server-local CLI operation (`pnpm bootstrap -- --recover` in the API workspace), revokes sessions, and is audited. Deliver initial passwords through a secure channel; no invitation email feature is assumed.
