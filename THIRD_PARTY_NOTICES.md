# Third-party software

Original NSoft Mail Companion source/configuration: Copyright © 2026 M Suthakaran, trading as NSoft Academy; Apache-2.0. This notice does not relicense upstream components.

| Component                          | Upstream license/reference                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Postfix                            | IBM Public License / Eclipse Public License as applicable; https://www.postfix.org/LICENSE |
| Dovecot / Pigeonhole               | LGPL/MIT and component-specific terms; https://www.dovecot.org/                            |
| Rspamd                             | Apache-2.0; https://github.com/rspamd/rspamd/blob/master/LICENSE.md                        |
| Roundcube                          | GPL-3.0-or-later with exceptions; https://roundcube.net/license/                           |
| ClamAV                             | GPL-2.0; https://github.com/Cisco-Talos/clamav                                             |
| Valkey (Redis-compatible protocol) | BSD-3-Clause; https://github.com/valkey-io/valkey/blob/unstable/COPYING                    |
| PostgreSQL                         | PostgreSQL License; https://www.postgresql.org/about/licence/                              |
| Nginx                              | BSD-style; https://nginx.org/LICENSE                                                       |
| acme.sh                            | GPL-3.0; https://github.com/acmesh-official/acme.sh                                        |
| Node.js                            | MIT and bundled notices; https://github.com/nodejs/node/blob/main/LICENSE                  |
| Next.js / React / Express / Prisma | MIT/Apache-2.0 as applicable; see installed package LICENSE files                          |

Redis 7.4's licensing is incompatible with claiming the entire bundle is permissively open-source. The project uses **Valkey** as its production-compatible Redis-protocol cache instead; retained references to Redis describe the protocol/component role, not a new license grant. See https://github.com/valkey-io/valkey/blob/unstable/COPYING .

Container distributions include additional packages with their own notices. Preserve `/usr/share/doc/*/copyright`, upstream license files and required source offers when redistributing built images. Generate and review an SBOM for each published image; this summary is not a substitute for the complete dependency license inventory.
