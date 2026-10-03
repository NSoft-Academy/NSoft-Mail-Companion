# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import json, re, urllib.request, urllib.parse
from common import ROOT, atomic, hostname


def request(token, path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4" + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
    )
    try:
        result = json.loads(urllib.request.urlopen(req, timeout=15).read(65536))
        if not result.get("success"):
            raise ValueError("Cloudflare permissions or DNS request failed.")
        return result["result"]
    except Exception:
        raise ValueError(
            "Cloudflare could not complete the request. Check Zone Read and DNS Edit permissions."
        ) from None


def provider(values):
    if not isinstance(values, dict) or set(values) != {"zoneId", "zoneName", "token"}:
        raise ValueError("Invalid DNS provider settings.")
    zone = hostname(values["zoneName"])
    token = values["token"]
    identifier = values["zoneId"]
    if (
        not isinstance(token, str)
        or not re.fullmatch(r"[a-zA-Z0-9_-]{20,256}", token)
        or not re.fullmatch(r"[a-f0-9]{32}", identifier)
    ):
        raise ValueError("Invalid DNS provider credentials.")
    actual = request(token, "/zones/" + identifier)
    if actual["name"] != zone:
        raise ValueError("Zone permissions do not match.")
    directory = ROOT / "dns"
    directory.mkdir(mode=0o700, exist_ok=True)
    atomic(directory / (zone + ".ini"), "dns_cloudflare_api_token = " + token + "\n")
    return {"status": "SUCCEEDED", "zoneName": zone}


def initial_dns(state):
    hosts = [state["panel"], state["mail"]]
    ip = state["publicIpv4"]
    if state["dns"] == "cloudflare":
        token = (ROOT / "acme.env").read_text().split("=", 1)[1].strip()
        zones = request(token, "/zones?per_page=50&status=active")
        changes = []
        for host in hosts:
            matches = [
                z for z in zones if host == z["name"] or host.endswith("." + z["name"])
            ]
            if not matches:
                raise ValueError(
                    "The Cloudflare token cannot read the panel/mail zone. Grant Zone Read and DNS Edit."
                )
            zone = max(matches, key=lambda z: len(z["name"]))
            records = request(
                token,
                "/zones/"
                + zone["id"]
                + "/dns_records?name="
                + urllib.parse.quote(host),
            )
            if records:
                if not all(
                    r["type"] == "A" and r["content"] == ip and not r.get("proxied")
                    for r in records
                ):
                    raise ValueError(
                        "Existing DNS conflicts with "
                        + host
                        + ". Preserve or migrate those records explicitly; then resume."
                    )
            else:
                changes.append((zone, host))
        if changes:
            print("DNS preview (DNS-only; existing records are preserved):")
            for _, host in changes:
                print("Create A " + host + " → " + ip)
            if input("Approve these new DNS records? [y/N]: ").strip().lower() != "y":
                raise ValueError(
                    "DNS was not changed. Create the displayed records manually and resume."
                )
            for zone, host in changes:
                request(
                    token,
                    "/zones/" + zone["id"] + "/dns_records",
                    "POST",
                    {
                        "type": "A",
                        "name": host,
                        "content": ip,
                        "ttl": 300,
                        "proxied": False,
                    },
                )
    else:
        import socket

        for host in hosts:
            try:
                matches = socket.gethostbyname(host) == ip
            except OSError:
                matches = False
            if not matches:
                raise ValueError(
                    "Create a DNS-only A record: "
                    + host
                    + " → "
                    + ip
                    + ". Wait for propagation, allow inbound 80/443, then rerun with --resume."
                )
