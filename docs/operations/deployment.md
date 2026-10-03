# Deployment

See [installation](../installation.md), [Coolify](../coolify.md) and [operations](../operations.md) for actual configuration. Deploy one reviewed Git revision with pinned dependencies. Run migrations with the separate migration role before starting API/worker. Keep persistent mounts unchanged. Review a backup and rollback plan before production operations.

Initial support is one Linux x86-64 node. Local native ARM development tests do not certify x86-64 production capacity. Use CI's Linux mail tests plus actual target-host acceptance. Do not expose database, Redis-compatible cache, API or filtering ports.
