#!/usr/bin/env python3
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import json, pathlib, ssl, sys, time
from common import ROOT, DATA, atomic, load, runtime_lock
from actions import execute, allowed_hosts, backup
from certificates import issue
from runtime import reload_mail


def main():
    state = load(ROOT / "installation.json")
    if len(sys.argv) > 1 and sys.argv[1] == "backup":
        execute("backup", None, state)
        return
    execute("refresh", None, state)
    attempts_path = ROOT / "renewal-attempts.json"
    attempts = load(attempts_path) if attempts_path.exists() else {}
    for host in [state["panel"]] + allowed_hosts(state):
        file = DATA / "tls" / host / "fullchain.pem"
        if not file.exists():
            continue
        info = ssl._ssl._test_decode_cert(str(file))
        remaining = ssl.cert_time_to_seconds(info["notAfter"]) - time.time()
        if remaining < 30 * 86400 and time.time() - attempts.get(host, 0) > 86400:
            attempts[host] = time.time()
            atomic(attempts_path, json.dumps(attempts))
            try:
                with runtime_lock():
                    issue(host, state)
                    reload_mail(state)
                    from proxy import configure

                    configure(state, allowed_hosts(state), force_reload=True)
            except Exception:
                atomic(
                    DATA / "usage/certificate-alert.json",
                    json.dumps(
                        {
                            "code": "CERTIFICATE_RENEWAL_FAILED",
                            "hostname": host,
                            "timestamp": time.time(),
                        }
                    ),
                    0o644,
                )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(
            "NSOFT_MAINTENANCE_FAILED: use the setup health dashboard; no credentials logged.",
            file=sys.stderr,
        )
        raise SystemExit(1)
