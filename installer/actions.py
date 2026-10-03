# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import datetime, hashlib, ipaddress, json, os, pathlib, shutil, socket, ssl, tempfile, time, urllib.request
from common import (
    ROOT,
    DATA,
    APP,
    atomic,
    run,
    load,
    public_state,
    hostname,
    runtime_lock,
)
from certificates import issue, expiry, trusted_https
from proxy import configure
from runtime import compose, native_services, reload_mail


def allowed_hosts(state):
    hosts = [state["mail"]]
    path = DATA / "routes/hosts.map"
    if path.exists():
        for line in path.read_text().splitlines():
            value = line.split(" ")[0]
            if value.startswith("webmail."):
                hosts.append(hostname(value))
    return sorted(set(hosts))


def status(state):
    state = load(ROOT / "installation.json")
    host = state["mail"]
    checks = []

    def add(name, passed, detail):
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    try:
        ptr = socket.gethostbyaddr(state["publicIpv4"])[0].rstrip(".").lower()
        add(
            "reverse-dns",
            ptr == host,
            "Set reverse DNS to " + host + " in your server provider account.",
        )
    except OSError:
        add(
            "reverse-dns",
            False,
            "Your IP provider must configure reverse DNS. Home connections may not support this.",
        )
    try:
        add(
            "canonical-address",
            socket.gethostbyname(host) == state["publicIpv4"],
            "Point " + host + " to the server public IPv4.",
        )
    except OSError:
        add("canonical-address", False, "Publish the canonical mail A record.")
    for port in (25, 587, 993):
        try:
            with socket.create_connection((host, port), timeout=3):
                pass
            add(
                "port-" + str(port),
                True,
                "Public-hostname connectivity works from this server; external inbound connectivity still needs testing.",
            )
        except OSError:
            add(
                "port-" + str(port),
                False,
                "Check port "
                + str(port)
                + " and router NAT loopback. Test externally too.",
            )
    add(
        "panel-https",
        trusted_https(state["panel"]),
        "Panel must have a publicly trusted hostname-matching certificate.",
    )
    result = {
        **public_state(state),
        "available": True,
        "checks": checks,
        "certificates": [expiry(h) for h in [state["panel"]] + allowed_hosts(state)],
        "backupConfigured": (ROOT / "backup.json").exists(),
        "update": {
            "installedRevision": state["revision"],
            "policy": "Only reviewed updates; no automatic replacement.",
        },
    }
    try:
        result["lastBackupAt"] = (DATA / "usage/backup.timestamp").read_text().strip()
    except OSError:
        result["lastBackupAt"] = None
    return result


def backup_settings(values):
    import re

    if not isinstance(values, dict) or set(values) != {
        "repository",
        "password",
        "accessKey",
        "secretKey",
    }:
        raise ValueError("Invalid backup configuration.")
    if not re.fullmatch(r"s3:https://[a-zA-Z0-9./_-]{1,490}", values["repository"]):
        raise ValueError("Use an HTTPS S3-compatible off-server repository.")
    if not 20 <= len(values["password"]) <= 256:
        raise ValueError("Use a long backup encryption password.")
    for item in values.values():
        if not isinstance(item, str) or len(item) > 500 or "\n" in item or "\r" in item:
            raise ValueError("Invalid backup input.")
    return values


def backup_env():
    values = load(ROOT / "backup.json")
    return {
        **os.environ,
        "RESTIC_REPOSITORY": values["repository"],
        "RESTIC_PASSWORD": values["password"],
        "AWS_ACCESS_KEY_ID": values["accessKey"],
        "AWS_SECRET_ACCESS_KEY": values["secretKey"],
    }


def backup(state):
    env = backup_env()
    out = DATA / "database"
    out.mkdir(exist_ok=True)
    # Only initialise if the repository is genuinely absent, never on an auth/network failure.
    probe = __import__("subprocess").run(
        ["restic", "cat", "config"], env=env, capture_output=True, text=True, timeout=30
    )
    if probe.returncode:
        if not any(
            marker in probe.stderr.lower()
            for marker in (
                "does not exist",
                "no such key",
                "nosuchkey",
                "404 not found",
            )
        ):
            raise ValueError(
                "Backup repository cannot be accessed. Check credentials and connectivity."
            )
        run(["restic", "init"], env=env)
    if state["method"] == "native":
        run(["systemctl", "stop"] + native_services())
    else:
        compose(["stop", "worker", "api", "roundcube", "mail"])
    try:
        for database in ("mailcompanion", "roundcube"):
            if state["method"] == "docker":
                # Binary dump must not pass through text decoding.
                result = __import__("subprocess").run(
                    [
                        "docker",
                        "compose",
                        "-f",
                        str(ROOT / "compose.json"),
                        "exec",
                        "-T",
                        "postgres",
                        "pg_dump",
                        "-U",
                        "nsoft_bootstrap",
                        "-d",
                        database,
                        "-Fc",
                    ],
                    capture_output=True,
                    check=True,
                    timeout=120,
                )
                (out / (database + ".dump")).write_bytes(result.stdout)
                continue
            # Native uses a separate binary invocation as well.
            result = __import__("subprocess").run(
                ["runuser", "-u", "postgres", "--", "pg_dump", "-d", database, "-Fc"],
                capture_output=True,
                check=True,
                timeout=120,
            )
            (out / (database + ".dump")).write_bytes(result.stdout)
        sources = [str(DATA), str(ROOT)] + (
            ["/var/vmail", "/var/spool/postfix"] if state["method"] == "native" else []
        )
        run(
            ["restic", "backup"]
            + sources
            + [
                "--exclude",
                str(DATA / "restore-drills"),
                "--exclude",
                str(DATA / "downloads"),
                "--exclude",
                str(DATA / "build"),
                "--tag",
                "nsoft-guided",
            ],
            env=env,
            timeout=1800,
        )
        run(["restic", "check"], env=env, timeout=1800)
        atomic(DATA / "usage/backup.timestamp", str(int(time.time())) + "\n", 0o644)
    finally:
        if state["method"] == "native":
            run(["systemctl", "start"] + native_services())
        else:
            compose(["start", "mail", "api", "worker", "roundcube"])
    return {"backup": "Complete", "offServer": True}


def restore_check(state):
    env = backup_env()
    run(["restic", "check"], env=env, timeout=1800)
    destination = DATA / "restore-drills" / str(__import__("uuid").uuid4())
    destination.mkdir(parents=True, mode=0o700)
    # Never restore over active storage. Keep drill data private until administrator removes it.
    run(
        [
            "restic",
            "restore",
            "latest",
            "--tag",
            "nsoft-guided",
            "--target",
            str(destination),
        ],
        env=env,
        timeout=1800,
    )
    dump = destination / str(DATA).lstrip("/") / "database/mailcompanion.dump"
    if not dump.is_file() or dump.stat().st_size == 0:
        raise ValueError("Backup is missing the database dump.")
    return {
        "restore": "Archives restored to an isolated private directory. Database import and live-mail checks remain a separate recovery drill.",
        "verifiedArchive": True,
    }


def _execute(operation, target, state, values=None):
    if operation == "refresh":
        configure(state, allowed_hosts(state))
        if state["method"] == "native":
            result = run(["doveadm", "-f", "json", "quota", "get", "-A"])
            atomic(DATA / "usage/usage.json", result.stdout, 0o644)
            queued = run(["postqueue", "-j"]).stdout.splitlines()
            messages = [json.loads(line) for line in queued if line]
            atomic(
                DATA / "usage/health.json",
                json.dumps(
                    {
                        "queueDepth": len(messages),
                        "oldestAgeSeconds": max(
                            [
                                time.time() - m.get("arrival_time", time.time())
                                for m in messages
                            ],
                            default=0,
                        ),
                        "timestamp": time.time(),
                    }
                ),
                0o644,
            )
        return {"health": "Complete"}
    if operation in ("certificate", "webmail"):
        if target not in allowed_hosts(state) + [state["panel"]]:
            raise ValueError(
                "Only canonical or verified webmail hostnames are permitted."
            )
        issue(target, state)
        configure(state, allowed_hosts(state), force_reload=True)
        reload_mail(state)
        return {"certificate": "Complete", "hostname": target}
    if operation == "backup":
        return backup(state)
    if operation == "restore-check":
        return restore_check(state)
    raise ValueError("Operation is not supported.")


def execute(operation, target, state, values=None):
    with runtime_lock():
        return _execute(operation, target, state, values)
