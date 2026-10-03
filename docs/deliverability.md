# Deliverability and home hosting

Direct sending is the default; an administrator can configure `SMTP_RELAY_HOST`, `SMTP_RELAY_USERNAME`, `SMTP_RELAY_PASSWORD` and `SMTP_RELAY_SPF` for an authenticated global relay on port 587. Verify the provider permits hosted domains and supplies aligned sender authentication. A relay change requires coordinated worker/mail redeployment and fresh DNS checks. Delivery never silently changes routes.

The readiness gate checks domain ownership, canonical MX/A/PTR, one SPF policy authorising the configured route, matching DKIM, DMARC, outbound SMTP connectivity and a trusted public STARTTLS handshake. It is a conservative configuration check, not a complete recursive SPF evaluator, spam-content assessor, blacklist authority or inbox prediction model.

Before customer launch:

- Verify SPF, DKIM and DMARC alignment from full headers in controlled Gmail, Outlook and Yahoo recipients.
- Distinguish server accepted (SMTP 250), recipient accepted, bounce/defer, and observed inbox/spam folder placement. A 250 response does not reveal the recipient folder.
- Send legitimate, expected business messages; start with low volume. Do not generate artificial warm-up traffic. Investigate bounces and complaints, subscribe to provider postmaster/reputation tools and monitor abused accounts.
- Use stable hostnames/IPs, correct PTR, aligned From identities, TLS and reviewed DNS. Authentication alone cannot overcome poor reputation or unwanted content.
- Keep bulk campaigns on separate specialised infrastructure. This companion's limits and product scope are for business mail and application notifications.

Hetzner blocks outbound ports 25/465 by default. Its documented process allows a case-by-case unblocking request after account age/payment requirements; port 587 can be used for a relay. Confirm the actual account policy and firewall reachability before direct sending. See https://docs.hetzner.com/cloud/servers/faq/ .

Home servers may have CGNAT, dynamic IPs, ISP port blocks, no PTR control or IP ranges unsuitable for mail. Do not label these environments ready for direct delivery. Outbound relay helps sending but does not provide inbound port 25 or overcome CGNAT. Use a publicly reachable receiving gateway/VPS or supported provider if inbound hosting is impossible. v1 does not deploy tunnels or gateways automatically.

No email software—including HestiaCP—can guarantee inbox placement across all recipient providers. Google's requirements illustrate authentication, DNS/TLS and spam-rate expectations: https://support.google.com/mail/answer/81126?hl=en .
