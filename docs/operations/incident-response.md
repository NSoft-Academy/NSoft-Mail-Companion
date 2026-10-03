# Incident response

For compromised credentials, suspend the mailbox/domain, revoke administrator sessions and investigate sending logs privately. Avoid deleting queued mail automatically; preserve evidence and identify affected recipients. Rotate secrets through a coordinated DB/service operation and recheck DNS/authentication.

For delivery failures, distinguish local acceptance, queue deferral, remote rejection and observed spam placement. Resolve DNS/PTR/TLS or provider issues; never hide failures by silently changing routes. For disk/host failure, follow the isolated restoration procedure in [operations](../operations.md), preserving keys and mail data. Use independent external alerting so an outage does not hide its own notification.
