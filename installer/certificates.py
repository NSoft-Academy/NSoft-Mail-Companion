# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import hashlib, json, os, pathlib, shutil, ssl, socket, tempfile
from common import ROOT, DATA, hostname, run, atomic, load


def trusted_https(host):
    try:
        with ssl.create_default_context().wrap_socket(
            socket.socket(), server_hostname=hostname(host)
        ) as sock:
            sock.settimeout(5)
            sock.connect((host, 443))
            return (
                ssl.cert_time_to_seconds(sock.getpeercert()["notAfter"])
                > __import__("time").time() + 7 * 86400
            )
    except (OSError, ValueError):
        return False


def issue(host, state):
    host = hostname(host)
    credentials = ROOT / "acme.env"
    directory = ROOT / "dns"
    if directory.exists():
        matches = [
            p
            for p in directory.glob("*.ini")
            if host == p.stem or host.endswith("." + p.stem)
        ]
        if matches:
            credentials = max(matches, key=lambda p: len(p.stem))
    command = [
        "certbot",
        "certonly",
        "--non-interactive",
        "--agree-tos",
        "--email",
        state["contact"],
        "-d",
        host,
        "--keep-until-expiring",
        "--key-type",
        "rsa",
        "--rsa-key-size",
        "2048",
    ]
    if state["dns"] == "cloudflare":
        command += [
            "--dns-cloudflare",
            "--dns-cloudflare-credentials",
            str(credentials),
            "--dns-cloudflare-propagation-seconds",
            "30",
        ]
    else:
        command += ["--webroot", "-w", str(DATA / "acme")]
    run(command, timeout=300)
    source = pathlib.Path("/etc/letsencrypt/live") / host
    destination = DATA / "tls" / host
    destination.mkdir(parents=True, exist_ok=True)
    atomic(destination / "fullchain.pem", (source / "fullchain.pem").read_text(), 0o644)
    atomic(destination / "privkey.pem", (source / "privkey.pem").read_text(), 0o600)
    if host == state["mail"]:
        atomic(
            DATA / "tls/fullchain.pem", (source / "fullchain.pem").read_text(), 0o644
        )
        atomic(DATA / "tls/privkey.pem", (source / "privkey.pem").read_text(), 0o600)
    return {"hostname": host, "certificate": "installed"}


def expiry(host):
    try:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(
            str(DATA / "tls" / hostname(host) / "fullchain.pem"),
            str(DATA / "tls" / hostname(host) / "privkey.pem"),
        )
        info = ssl._ssl._test_decode_cert(
            str(DATA / "tls" / hostname(host) / "fullchain.pem")
        )
        return {
            "hostname": host,
            "expiresAt": info["notAfter"],
            "status": (
                "Action needed"
                if ssl.cert_time_to_seconds(info["notAfter"])
                < __import__("time").time() + 30 * 86400
                else "Complete"
            ),
        }
    except (OSError, ValueError, ssl.SSLError):
        return {"hostname": host, "status": "Action needed"}
