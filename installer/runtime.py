# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import json, os, pathlib, pwd, grp, subprocess
from common import ROOT, DATA, APP, atomic, run
import native


def docker_environment(state, secrets_data):
    # Render Compose using the repository's schemas; secrets never go to stdout or the browser.
    for name in (
        "vmail",
        "queue",
        "tls",
        "usage",
        "dkim",
        "routes",
        "acme-state",
        "rspamd",
        "database",
    ):
        (DATA / name).mkdir(parents=True, exist_ok=True)
    address = state["proxyAddress"]
    try:
        host_group = grp.getgrnam("nsoft-host")
    except KeyError:
        run(["groupadd", "--system", "nsoft-host"])
        host_group = grp.getgrnam("nsoft-host")
    env = {
        **os.environ,
        **secrets_data,
        "NODE_ENV": "production",
        "WEB_URL": "https://" + state["panel"],
        "PANEL_HOSTNAME": state["panel"],
        "MAIL_HOSTNAME": state["mail"],
        "PUBLIC_IPV4": state["publicIpv4"],
        "REQUIRE_MFA": "true",
        "ACME_EMAIL": state["contact"],
        "NSOFT_BACKUP_ROOT": str(DATA),
    }
    rendered = json.loads(
        run(
            [
                "docker",
                "compose",
                "-f",
                str(APP / "compose.yaml"),
                "-f",
                str(APP / "compose.backup.yaml"),
                "config",
                "--format",
                "json",
            ],
            cwd=APP,
            env=env,
        ).stdout
    )
    rendered["name"] = "nsoft-guided"
    for service, port in [("web", 3000), ("gateway", 8080)]:
        rendered["services"][service]["ports"] = [
            {
                "target": port,
                "published": str(port),
                "host_ip": address,
                "protocol": "tcp",
            }
        ]
    # Root-owned Unix directory mounted to node services, never the Docker daemon socket.
    for service in ("api", "worker"):
        rendered["services"][service]["group_add"] = [str(host_group.gr_gid)]
        rendered["services"][service]["environment"][
            "HOST_AGENT_SOCKET"
        ] = "/run/nsoft-mail/agent.sock"
        rendered["services"][service]["volumes"].append(
            {
                "type": "bind",
                "source": "/run/nsoft-mail",
                "target": "/run/nsoft-mail",
                "read_only": True,
            }
        )
    for service in ("web",):
        rendered["services"][service]["environment"][
            "INTERNAL_API_URL"
        ] = "http://api:4000"
    for service in ("migrate", "api", "worker", "web"):
        rendered["services"][service]["build"]["context"] = str(APP)
    atomic(ROOT / "compose.json", json.dumps(rendered))
    # Existing mounts read this shared storage; dedicated Docker stack keeps its own project name.
    run(["chown", "1000:1000", str(DATA / "rspamd")])
    os.chmod(DATA / "rspamd", 0o750)
    pathlib.Path("/run/nsoft-mail").mkdir(mode=0o750, exist_ok=True)
    run(["chown", "root:nsoft-host", "/run/nsoft-mail"])


def install_agent(state):
    from native import unit

    group = "nsoft-host"
    # RuntimeDirectory creates the socket parent after reboot; app containers only mount this directory.
    unit(
        "host-agent",
        f"/usr/bin/python3 {APP}/installer/agent.py",
        group=group,
        extra="RuntimeDirectory=nsoft-mail\nRuntimeDirectoryMode=0750\nRuntimeDirectoryPreserve=yes\n",
    )
    unit("maintenance", f"/usr/bin/python3 {APP}/installer/maintenance.py")
    atomic(
        "/etc/systemd/system/nsoft-maintenance.timer",
        "[Unit]\nDescription=NSoft certificate and health checks\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=60s\nPersistent=true\n[Install]\nWantedBy=timers.target\n",
        0o644,
    )
    # oneshot avoids Restart= for the periodic action.
    service = pathlib.Path("/etc/systemd/system/nsoft-maintenance.service")
    atomic(
        service,
        service.read_text()
        .replace("Type=simple", "Type=oneshot")
        .replace("Restart=on-failure\nRestartSec=5\n", ""),
        0o644,
    )
    unit("backup", f"/usr/bin/python3 {APP}/installer/maintenance.py backup")
    backup_service = pathlib.Path("/etc/systemd/system/nsoft-backup.service")
    atomic(
        backup_service,
        backup_service.read_text()
        .replace("Type=simple", "Type=oneshot")
        .replace("Restart=on-failure\nRestartSec=5\n", ""),
        0o644,
    )
    atomic(
        "/etc/systemd/system/nsoft-backup.timer",
        "[Unit]\nDescription=Daily encrypted NSoft backup\n[Timer]\nOnCalendar=daily\nRandomizedDelaySec=1800\nPersistent=true\n[Install]\nWantedBy=timers.target\n",
        0o644,
    )
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", "--now", "nsoft-host-agent", "nsoft-maintenance.timer"])


def compose(args):
    return run(
        ["docker", "compose", "-f", str(ROOT / "compose.json")] + args,
        cwd=APP,
        timeout=1800,
    )


def native_services():
    return ["nsoft-api", "nsoft-worker", "postfix", "dovecot", "php8.3-fpm"]


def reload_mail(state):
    if state["method"] == "native":
        run(["systemctl", "reload-or-restart", "postfix", "dovecot"])
    # Container maintenance sees updated certificate files and reloads without recreation.
