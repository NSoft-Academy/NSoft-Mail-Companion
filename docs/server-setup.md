# Step-by-step server setup with Coolify

Copyright © 2026 M Suthakaran, trading as NSoft Academy. Licensed under the Apache License, Version 2.0.

This guide covers a VPS, dedicated server, or home Linux server alongside Coolify. Initially support Linux x86-64 and one mail node. The implementation remains on `codex/mail-companion-foundation` until its PR is merged; `main` currently contains the project introduction only. Use a reviewed commit from that branch for a pilot. No step here guarantees external inbox placement.

## 1. Choose your server and check eligibility

| Hosting                      | Check before installing                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VPS, including Hetzner Cloud | A stable public IPv4; provider SMTP permissions; controllable PTR; persistent disk; provider firewall; spare resources alongside your applications.                                                  |
| Dedicated server             | The same checks, plus disk redundancy, hardware monitoring, recovery console and off-server backups. RAID does not replace backups.                                                                  |
| Home server                  | Static public IPv4, ISP permission to operate mail, inbound 25 and client ports, outbound SMTP, provider-managed PTR, router forwarding, NAT loopback, reliable power/internet and off-site backups. |

Plan a pilot starting budget of 4 vCPU and 8 GiB RAM **available for this stack**, plus capacity for Coolify and other applications. This is a recommendation, not a certified minimum or mailbox capacity. Use an SSD and budget mail storage, queues and backups separately. See [measured observations](verification.md).

Hetzner Cloud restricts outbound 25/465 by default; request permission through its current support process, or explicitly configure an authenticated relay on 587. A dedicated server's rules may differ: confirm for your product. A relay changes outbound delivery only; it cannot provide inbound port 25 or fix a missing public address. References: [Hetzner FAQ](https://docs.hetzner.com/cloud/servers/faq/), [delivery guide](deliverability.md).

Stop before installing if another mail service already owns ports 25/465/587/993. Do not install HestiaCP alongside this stack.

## 2. Prepare Linux and Coolify

Use a maintained Ubuntu LTS or another Docker-supported Linux distribution. Apply operating-system updates, configure SSH keys, time synchronisation and a provider/recovery console. Keep administrative access restricted.

Install Docker Engine and Compose using the [official Docker Linux instructions](https://docs.docker.com/engine/install/). Require Compose 2.24+ for this repository's overlay syntax. If Coolify is installed, verify its existing Docker installation instead of replacing it. If it is new, follow [Coolify's installation instructions](https://coolify.io/docs/start-with-self-hosted), configure HTTPS access and connect the intended server.

On the mail server:

```sh
docker version
docker compose version
docker network inspect coolify
sudo ss -ltnp
```

The last command helps find port conflicts. The supplied proxy overlay assumes Coolify's Traefik proxy, its `coolify` network, `http`/`https` entrypoints and `letsencrypt` resolver. Verify those names in your installation. Caddy or a custom proxy needs equivalent routes; do not deploy the Traefik overlay unchanged to it.

## 3. Allocate names and DNS

Example values below are placeholders: replace them with domains and an IP you control.

| Name                       | Role                                               | Initial public record      |
| -------------------------- | -------------------------------------------------- | -------------------------- |
| `panel.example.com`        | Administrator panel                                | A → server IPv4            |
| `mail.example.com`         | Canonical SMTP/IMAP hostname and canonical webmail | A → server IPv4            |
| `webmail.customer.example` | Customer webmail                                   | CNAME → `mail.example.com` |

Set the server IPv4 PTR to `mail.example.com` in your provider's control panel. Forward A and reverse PTR must agree. Do not publish AAAA until IPv6 is supported and tested; v1 outbound is IPv4.

For Cloudflare, keep `mail.example.com` DNS-only, because SMTP/IMAP must reach the server directly. Initially keep panel/webmail DNS-only too to simplify certificate and routing diagnostics. DNS automation tokens are optional; they do not replace ownership verification.

Do not switch existing production MX records yet. Add the customer ownership/MX/SPF/DKIM/DMARC records later using the panel's generated instructions.

## 4. Open the correct ports

| Public TCP port | Destination                            |
| --------------- | -------------------------------------- |
| 80, 443         | Existing Coolify HTTP proxy            |
| 25              | Mail service; internet SMTP reception  |
| 465, 587        | Mail service; authenticated submission |
| 993             | Mail service; TLS IMAP                 |
| SSH port        | Restricted administrator access        |

Never publish PostgreSQL, Redis/Valkey, Rspamd, ClamAV, ManageSieve, the API or backend HTTP ports. Apply the provider firewall and host Docker-aware firewall rules. Docker published ports can bypass simple UFW rules, so test from another network. Leave Coolify's own management access restricted as described in its installation guide.

On a home router, reserve the server LAN address and forward 80/443/25/465/587/993 to it. Confirm there is no double NAT or CGNAT. Test externally using mobile data or another server, not only your Wi-Fi. See step 13 for unsuitable connections.

## 5. Clone and generate secrets

The following host-managed Compose route is the explicit command-based setup. Coolify continues to run the HTTP proxy and your applications; you manage this mail stack from its stable checkout. **Do not also create a Coolify application managing the same containers or storage.** For full Coolify UI management use step 12 instead.

From an administrator shell on the server:

```sh
sudo mkdir -p /opt/nsoft-mail-companion
sudo chown "$(id -u):$(id -g)" /opt/nsoft-mail-companion
git clone --branch codex/mail-companion-foundation https://github.com/NSoft-Academy/NSoft-Mail-Companion.git /opt/nsoft-mail-companion
cd /opt/nsoft-mail-companion
python3 scripts/generate-secrets.py
```

Record `git rev-parse HEAD` and pin the reviewed revision for installation/upgrades. The generator refuses to overwrite an existing `.env`. Edit the file locally without posting it in tickets or Git:

```dotenv
WEB_URL=https://panel.example.com
PANEL_HOSTNAME=panel.example.com
MAIL_HOSTNAME=mail.example.com
PUBLIC_IPV4=YOUR_ACTUAL_PUBLIC_IPV4
ACME_EMAIL=YOUR_MONITORED_CONTACT_EMAIL
REQUIRE_MFA=true
NSOFT_BACKUP_ROOT=/srv/nsoft-mail
COMPOSE_FILE=compose.yaml:compose.backup.yaml:compose.coolify.yaml:compose.hosts.yaml
```

Keep the independently generated database, webmail and encryption secrets. Preserve `.env` mode 0600 and an encrypted offline recovery copy. The Compose definitions construct the container database URLs; do not substitute the shell/development `DATABASE_URL` for their internal service URLs. Never regenerate secrets on an existing installation without a planned rotation.

## 6. Select mail-protocol certificates and optional relay

For a canonical hostname in Cloudflare, DNS-01 avoids conflicts with Coolify's own HTTP certificate handler. Add these values to `.env` using a token restricted to its zone:

```dotenv
ACME_DNS_PROVIDER=dns_cf
ACME_DNS_TOKEN=YOUR_SCOPED_TOKEN
ACME_DNS_ZONE_ID=YOUR_CANONICAL_HOST_ZONE_ID
```

The ACME token is separate from the optional panel `CLOUDFLARE_TOKEN`. For another DNS provider, use the supported HTTP-01 procedure in [installation](installation.md), first verifying that the proxy forwards the canonical challenge path to gateway. Do not assume a proxy-issued HTTPS certificate is automatically available to SMTP/IMAP.

If the provider blocks direct outbound mail, explicitly configure your chosen authenticated submission relay:

```dotenv
SMTP_RELAY_HOST=smtp.provider.example
SMTP_RELAY_USERNAME=YOUR_RELAY_USERNAME
SMTP_RELAY_PASSWORD=YOUR_RELAY_PASSWORD
SMTP_RELAY_SPF=YOUR_PROVIDER_PUBLISHED_SPF_INCLUDE_DOMAIN
```

This implementation uses global relay submission on 587 with trusted TLS. Follow the relay provider's domain verification/DKIM requirements and limits. Leave these variables unset for direct outbound delivery. There is no automatic fallback. Current readiness still requires canonical A/PTR and inbound service TLS, even with a relay.

## 7. Prepare durable storage and exact webmail routes

For a **new** installation:

```sh
sudo mkdir -p /srv/nsoft-mail/{vmail,queue,tls,usage,dkim,routes,acme-state,rspamd,database}
umask 077
cat > compose.hosts.yaml <<'YAML'
services:
  gateway:
    labels:
      traefik.http.routers.nsoft-webmail.rule: 'Host(`mail.example.com`) || Host(`webmail.customer.example`)'
      traefik.http.routers.nsoft-webmail.tls.certresolver: letsencrypt
YAML
```

This local override replaces the broad webmail rule with exact names so the resolver can issue their HTTPS certificates. Add each new customer hostname explicitly and redeploy gateway. The panel must also verify and activate that domain before gateway allows it. For later additional mail nodes, router/service names must be made unique; v1 assumes one node.

Keep this host-specific override outside Git with your encrypted deployment configuration. Do not change an existing installation from named volumes to bind mounts without the offline migration in [operations](operations.md); empty bind directories would hide the existing messages.

Validate without printing interpolated secrets:

```sh
docker compose config --quiet
docker compose run --rm volumes-init
```

Keep the same `COMPOSE_FILE`, checkout and Compose project name `nsoft-mail` for every command, timer and upgrade. Do not create a second project pointing at these storage paths.

## 8. Start the stack and install the mail certificate

```sh
docker compose up -d --build
docker compose --profile certificates run --rm acme
docker compose ps
```

First-time image builds/signature downloads take time. PostgreSQL initialises distinct roles; the migration service applies the schema; worker provisions routes/keys. Mail waits for its certificate and may initially appear unhealthy. After issuance it should start without replacing data. Investigate migration errors before attempting a second installation.

Inspect only the relevant logs locally:

```sh
docker compose logs --tail 80 migrate api worker
docker compose logs --tail 80 mail gateway rspamd clamav
```

Do not publish these logs without removing personal addresses and sensitive configuration. Check panel HTTPS and canonical HTTPS with trusted certificates. Customer webmail may return a closed connection until its domain is verified; that is expected.

## 9. Bootstrap the administrator and onboard domains

In Bash, from this checkout:

```sh
read -r -p 'Administrator email: ' BOOTSTRAP_EMAIL
read -rs -p 'Enter administrator password ' BOOTSTRAP_PASSWORD
printf '\n'
export BOOTSTRAP_EMAIL BOOTSTRAP_PASSWORD
docker compose exec -e BOOTSTRAP_EMAIL -e BOOTSTRAP_PASSWORD api pnpm bootstrap
unset BOOTSTRAP_EMAIL BOOTSTRAP_PASSWORD
```

Use a strong unique password. Open `https://panel.example.com`, sign in, enroll an authenticator and retain the server-local recovery procedure in [installation](installation.md).

1. Create a tenant and, if needed, its domain administrator.
2. Add the customer domain. Publish its `_nsoft-verify` TXT value exactly.
3. Wait for provisioning; run domain checks. Use Activity → Retry job if provisioning failed after fixing its cause.
4. Once DKIM is generated, publish the displayed MX, one correctly merged SPF policy, DKIM TXT and DMARC TXT. Create `postmaster` before directing DMARC reports there. Migrate existing mail before replacing its MX.
5. Create mailboxes with allocation quotas, then same-domain aliases if needed. Suspensions retain messages.
6. Run checks again and enable sending only after all required checks pass. Refresh checks after DNS/TLS/network changes.
7. Add the exact `webmail.<domain>` proxy route/certificate from step 7 and confirm its CNAME. Never assume one server-domain wildcard covers customer domains.

## 10. Verify from another network

```sh
dig +short A mail.example.com
dig +short -x YOUR_ACTUAL_PUBLIC_IPV4
dig +short MX customer.example
dig +short TXT customer.example
dig +short TXT nsoft2026._domainkey.customer.example
dig +short TXT _dmarc.customer.example
openssl s_client -connect mail.example.com:587 -starttls smtp -servername mail.example.com -verify_hostname mail.example.com -verify_return_error </dev/null
openssl s_client -connect mail.example.com:993 -servername mail.example.com -verify_hostname mail.example.com -verify_return_error </dev/null
```

Use a mailbox client with the full email address, IMAPS 993 and SMTP STARTTLS 587 or implicit TLS 465. Log in to customer webmail. Send between local mailboxes, test an alias, then send controlled messages to and from external accounts. Inspect authentication results, bounces and inbox/spam placement. Also verify that an unauthenticated external-to-external recipient is rejected; never send an actual message in that relay check.

The [pilot acceptance checklist](verification.md) includes outage/recovery, quotas, proxy coexistence and provider-dependent checks. Passing SMTP acceptance alone does not establish inbox placement.

## 11. Schedule maintenance before accepting customer mail

Follow [operations](operations.md) to initialise an encrypted off-server restic repository, store its credentials outside Git, schedule `scripts/backup.sh` daily and perform an isolated restoration drill. The script expects the storage overlay and briefly stops mail writers for consistency. Configure a host-scheduler failure alert independent of this mail server.

Schedule `scripts/renew-certificates.sh` twice daily from `/opt/nsoft-mail-companion`; use the actual supplied units in `docker/systemd/` as examples, updating their checkout path. The checkout's `.env` must remain available so the timer selects the same Compose files/storage. Verify public SMTP/IMAP certificates after renewal.

For the host-managed route, install the renewal units with the checkout path used above:

```sh
sudo cp docker/systemd/nsoft-mail-certificates.service /etc/systemd/system/
sudo cp docker/systemd/nsoft-mail-certificates.timer /etc/systemd/system/
sudo sed -i 's|/opt/NSoft-Mail-Companion|/opt/nsoft-mail-companion|g' /etc/systemd/system/nsoft-mail-certificates.service
sudo systemctl daemon-reload
sudo systemctl enable --now nsoft-mail-certificates.timer
sudo systemctl start nsoft-mail-certificates.service
sudo systemctl status nsoft-mail-certificates.service
```

For backups, install restic using your distribution's supported package or its official release. Create `/root/nsoft-mail-backup.env` with mode 0600 containing `NSOFT_BACKUP_ROOT=/srv/nsoft-mail`, your `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` and provider credentials such as `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. Use the same bucket/repository only after confirming it is the intended destination. Initialise it once in a root Bash shell, then run the backup:

```sh
sudo -i
cd /opt/nsoft-mail-companion
set -a
. /root/nsoft-mail-backup.env
set +a
restic init
./scripts/backup.sh
restic snapshots --tag nsoft-mail
```

Still in that root shell, create the daily scheduler:

```sh
cat > /etc/systemd/system/nsoft-mail-backup.service <<'UNIT'
[Unit]
Description=Encrypted NSoft Mail backup
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=oneshot
WorkingDirectory=/opt/nsoft-mail-companion
EnvironmentFile=/root/nsoft-mail-backup.env
ExecStart=/opt/nsoft-mail-companion/scripts/backup.sh
UNIT
cat > /etc/systemd/system/nsoft-mail-backup.timer <<'UNIT'
[Unit]
Description=Daily NSoft Mail backup
[Timer]
OnCalendar=daily
RandomizedDelaySec=1800
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now nsoft-mail-backup.timer
systemctl list-timers nsoft-mail-backup.timer nsoft-mail-certificates.timer
exit
```

Choose a suitable outage window by editing the backup timer and verify scheduler alerts. Restore into an isolated destination following the operations guide before trusting the first snapshot. For the Coolify-managed route, replace the service's working directory/command with that resource's generated Compose context; these host-managed units must not accidentally start another stack.

Configure independent HTTPS, mail-port, disk, queue and certificate-expiry monitoring. Enable worker `ALERT_WEBHOOK` if available. Keep system time correct for MFA. Perform upgrades from a reviewed revision after backup; never use `docker compose down -v`, destructive Prisma resets, preview deployments or multiple mail writers. See [upgrade and migration procedures](operations.md).

## 12. Alternative: manage the resource entirely through Coolify

Use this route **instead of** host-managed deployment above. Generate/review secrets and storage choices first, but do not start a competing host stack.

1. In the target Coolify project/environment, add a public Git repository application with this repository URL. Select the reviewed feature branch until merge, base directory `/`, and Docker Compose build pack.
2. Use the base definition plus reviewed storage/proxy overlays. Configure supported multi-file/custom Compose commands for your Coolify version, or keep a reviewed combined definition in your deployment fork. Do not paste output containing interpolated secrets into Git; `docker compose config` normally exposes them. Preserve build contexts and configuration mount paths.
3. Enable **Preserve Repository During Deployment** because database/filter/webmail configuration files are mounted from Git. Enter required values in the resource's Environment Variables; keep them out of source control.
4. Review Coolify's generated services, private networks, actual storage names/paths, fixed mail ports and the existing proxy network. Disable previews and automatic deployments for this stateful resource.
5. Assign web domain `https://panel.example.com:3000` and gateway exact domains `https://mail.example.com:8080` and `https://webmail.customer.example:8080`. These suffixes identify internal service ports, not public ports. Avoid duplicate routers from simultaneously using Coolify-generated and custom labels; inspect the final routes and choose one ownership method.
6. Deploy. Use the resource terminal/host-generated Compose directory to run certificate and bootstrap commands against **that resource**, with its generated file/environment/project flags. Do not run them from an unrelated clone using different volumes.
7. Repeat steps 9–11. Schedule renewal and backup against the same generated resource configuration; confirm backups cover Coolify's actual bind paths and DB roles. Retain the generated configuration location in your recovery runbook.

Coolify interface and generated Compose details vary. Consult its [Compose documentation](https://coolify.io/docs/applications/builds/docker-compose) and [networking documentation](https://coolify.io/docs/core/networking-in-coolify), and inspect the real generated definition before customer use. A live Coolify installation has not been verified by this repository's local tests.

## 13. Home hosting: when to use a VPS instead

If your router's WAN address is private, in `100.64.0.0/10`, or differs from the public IPv4 because of an ISP NAT, ask for a static public IPv4 and remove any extra NAT layer. A standard HTTP tunnel does not provide internet SMTP reception. If the ISP cannot permit inbound 25, supply PTR or provide reliable connectivity, put the complete mail stack on an eligible VPS/dedicated server; Coolify can still manage your home applications separately. An outbound relay alone does not solve those requirements.

The worker tests the canonical **public** submission hostname from inside the server. Home routers therefore need working NAT loopback/hairpin routing; confirm public-hostname STARTTLS works inside the worker network as well as externally. Do not bypass hostname/certificate verification to work around routing.

Use a UPS, clean shutdown, restricted router administration, off-site encrypted backup and external outage alerts. Keep the home IP out of DNS until these checks pass. Dynamic IP/DDNS operation, an inbound VPS-to-home SMTP gateway, automatic failover and clustering are not provided in v1. Never publish residential capacity or inbox-placement claims without measurements.

## Troubleshooting

| Symptom                                          | First checks                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Mail waits for certificates                      | ACME logs, DNS-01 token/zone, HTTP challenge routing, correct persistent TLS path.                            |
| `not a directory` mount failure in Coolify       | Preserve Repository During Deployment and the actual source file path.                                        |
| Panel is 502                                     | API readiness/migrations, private network, internal API hostname, proxy port 3000.                            |
| Customer webmail connection closes               | Verified active domain, worker routes, exact proxy hostname and certificate.                                  |
| Receiving works but sending is disabled          | All readiness results; PTR/A, SPF/DKIM/DMARC, provider outbound policy and trusted TLS.                       |
| Home worker TLS check fails while external works | NAT loopback and internal public-hostname routing; never disable TLS trust.                                   |
| Mail queues grow                                 | Outbound restrictions, explicit relay credentials/TLS, receiver errors, scanner health; preserve queued mail. |
| Data appears missing after redeploy              | Stop writers; check changed project/storage names or empty replacement bind mounts before restoring.          |
