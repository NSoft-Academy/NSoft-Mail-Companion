# Coolify integration

Supported integration is a companion Docker Compose stack; there is no required modification to Coolify. Initially use a Git-based Compose application so the stack's build contexts and configuration mounts are available.

1. Connect this repository in Coolify. Select the single mail resource server; check provider port availability and avoid conflicting installed mail servers.
2. Configure required environment variables from `.env.example`. Generate secrets locally. Configure `WEB_URL` to the public HTTPS panel origin and `PANEL_HOSTNAME` to its bare hostname.
3. Merge `compose.yaml` and `compose.coolify.yaml` with Compose 2.24+ on a trusted local machine, or use Coolify's supported multi-file Compose configuration. The overlay connects only web and gateway to the existing `coolify` network; databases and mail internals remain off that proxy network. Review Coolify's generated Compose before deploying.
4. Ensure fixed mail ports 25/465/587/993 remain published, volumes remain persistent, and API/DB/Redis/Rspamd have no public ports. Do not use preview/PR deployments for this stateful mail stack.
5. Route the panel hostname to `web:3000`. Route canonical and exact customer webmail hostnames to `gateway:8080`; attach their own HTTPS certificates through Coolify. The overlay's broad webmail matching rule does **not** provision wildcard or customer certificates. Use explicit Coolify-managed host routes/certificates for every customer domain.
6. Issue the mail-protocol certificate separately. Prefer the Cloudflare DNS-01 profile when Coolify's own ACME handler intercepts `/.well-known/acme-challenge/`. For HTTP-01, verify the generated proxy really forwards challenge requests to gateway before issuance.
7. Bootstrap the administrator, enroll MFA, and follow the domain onboarding guide. Configure Coolify's notification SMTP to the canonical hostname and an explicitly created mailbox if desired; do not expose mailbox passwords through the panel API.

The overlay is for Traefik's `http` and `https` entrypoints and `letsencrypt` resolver naming. Caddy/custom proxies require equivalent explicit routes. Coolify version/proxy settings can vary: inspect generated labels, storage names and networks, and run acceptance tests before using real customer mail. A real Coolify/Hetzner deployment is a release acceptance step, not simulated by local Compose tests.

For larger installations, move this unchanged stack to another connected server with the same hostname/MX and a migration of persistent storage and database. Revalidate new IP reputation, PTR, SPF, TLS and provider permissions. Never run two writers against the same Maildir storage.

Official references: https://coolify.io/docs/services/ and https://coolify.io/docs/api/overview
