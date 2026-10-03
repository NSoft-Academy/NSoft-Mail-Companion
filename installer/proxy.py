# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
"""Only writes NSoft-owned routes. Existing Coolify configuration is never replaced."""

import json, pathlib, ipaddress, time
from common import ROOT, DATA, APP, atomic, atomic_changed, run, hostname


def nginx_config(state, hosts):
    panel = hostname(state["panel"])
    mail = hostname(state["mail"])
    address = state["proxyAddress"] if state["proxy"] == "coolify" else "127.0.0.1"
    backend = f"{address}:3000"
    allowed = " ".join(hostname(host) for host in hosts)
    # Native gateway serves only generated, verified host routes. PHP never sees arbitrary Host.
    base = f"""server {{
 listen {address}:8080;
 server_name {allowed};
 client_max_body_size 25m;
 root /usr/share/roundcube;
 index index.php;
 location / {{ try_files $uri $uri/ /index.php?$query_string; }}
 location ~ ^/(config|temp|logs|bin|SQL)/ {{ deny all; }}
 location ~ \\.php$ {{
   include /etc/nginx/fastcgi_params;
   fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
   fastcgi_param HTTPS on;
   fastcgi_pass unix:/run/php/php8.3-fpm.sock;
 }}
}}
server {{ listen {address}:8080 default_server; server_name _; return 444; }}
"""
    if state["method"] == "docker":
        base = ""
    if state["proxy"] == "standalone":
        base += f"""server {{ listen 80; server_name {panel} {allowed};
 location /.well-known/acme-challenge/ {{ root {DATA}/acme; }}
 location / {{ return 301 https://$host$request_uri; }}
}}
"""
        for host in [panel] + hosts:
            cert = DATA / "tls" / host / "fullchain.pem"
            if not cert.exists():
                continue
            target = backend if host == panel else "127.0.0.1:8080"
            base += f"""server {{ listen 443 ssl; server_name {host};
 ssl_certificate {cert}; ssl_certificate_key {cert.parent}/privkey.pem;
 ssl_protocols TLSv1.2 TLSv1.3;
 client_max_body_size 25m;
 location / {{ proxy_pass http://{target}; proxy_set_header Host $host;
 proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $remote_addr; }}
}}
"""
    return base


def configure(state, hosts, force_reload=False):
    hosts = sorted(set([hostname(state["mail"])] + [hostname(h) for h in hosts]))
    if state["method"] == "native" or state["proxy"] == "standalone":
        changed = atomic_changed(
            ROOT / "nginx.conf",
            "pid /run/nsoft-mail-nginx.pid;\nuser www-data;\nevents {}\nhttp { include /etc/nginx/mime.types; default_type application/octet-stream; "
            + nginx_config(state, hosts)
            + " }\n",
            0o644,
        )
        from native import unit

        if changed or force_reload:
            unit("gateway", f'/usr/sbin/nginx -c {ROOT}/nginx.conf -g "daemon off;"')
            run(["nginx", "-t", "-c", str(ROOT / "nginx.conf")])
            run(["systemctl", "daemon-reload"])
            run(["systemctl", "enable", "--now", "nsoft-gateway"])
            run(["nginx", "-s", "reload", "-c", str(ROOT / "nginx.conf")])
    if state["proxy"] == "coolify":
        # Existing Traefik file-provider directory is required. Do not create/reconfigure its provider.
        directory = pathlib.Path("/data/coolify/proxy/dynamic")
        if not directory.is_dir():
            raise ValueError("Coolify Traefik dynamic routing is unavailable.")
        ip = state["proxyAddress"]
        ipaddress.IPv4Address(ip)
        routers = {}
        services = {}
        for n, host in enumerate([state["panel"]] + hosts):
            name = "nsoft-guided-" + str(n)
            port = 3000 if host == state["panel"] else 8080
            services[name] = {
                "loadBalancer": {"servers": [{"url": f"http://{ip}:{port}"}]}
            }
            routers[name] = {
                "rule": f"Host(`{hostname(host)}`)",
                "entryPoints": ["https"],
                "service": name,
                "tls": {},
            }
        if state["dns"] == "http":
            services["nsoft-guided-acme"] = {
                "loadBalancer": {"servers": [{"url": f"http://{ip}:8090"}]}
            }
            routers["nsoft-guided-acme"] = {
                "rule": "("
                + " || ".join("Host(`" + h + "`)" for h in [state["panel"]] + hosts)
                + ") && PathPrefix(`/.well-known/acme-challenge/`)",
                "entryPoints": ["http"],
                "service": "nsoft-guided-acme",
                "priority": 10001,
            }
        certificates = []
        for host in [state["panel"]] + hosts:
            cert = DATA / "tls" / host / "fullchain.pem"
            key = cert.parent / "privkey.pem"
            if cert.exists() and key.exists():
                target = directory / "nsoft-certificates"
                atomic(target / (host + ".pem"), cert.read_text(), 0o644)
                atomic(target / (host + ".key"), key.read_text(), 0o600)
                certificates.append(
                    {
                        "certFile": "/traefik/dynamic/nsoft-certificates/"
                        + host
                        + ".pem",
                        "keyFile": "/traefik/dynamic/nsoft-certificates/"
                        + host
                        + ".key",
                    }
                )
        # JSON is valid YAML; the file provider requires a .yaml/.yml/.toml extension.
        atomic_changed(
            directory / "nsoft-guided.yaml",
            json.dumps(
                {
                    "http": {"routers": routers, "services": services},
                    "tls": {"certificates": certificates},
                }
            )
            + (
                f"\n# NSoft certificate reload {time.time_ns()}\n"
                if force_reload
                else ""
            ),
            0o644,
        )
