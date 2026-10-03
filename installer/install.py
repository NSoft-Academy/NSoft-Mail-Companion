#!/usr/bin/env python3
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
"""Resumable server-local installer. Never runs on the development workstation."""

import argparse, fcntl, getpass, hashlib, ipaddress, json, os, pathlib, shutil, socket, subprocess, sys, tarfile, urllib.request
from common import ROOT, DATA, APP, atomic, load, run, hostname, public_state
from preflight import collect, evaluate
from certificates import issue, trusted_https
from proxy import configure
from dns import initial_dns
import native

SOURCE = pathlib.Path(__file__).resolve().parent.parent


def node_runtime():
    version = "22.23.1"
    name = f"node-v{version}-linux-x64.tar.xz"
    url = f"https://nodejs.org/dist/v{version}/"
    directory = DATA / "downloads"
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / name
    urllib.request.urlretrieve(url + name, archive)
    sums = urllib.request.urlopen(url + "SHASUMS256.txt", timeout=30).read().decode()
    expected = next(
        line.split()[0] for line in sums.splitlines() if line.endswith("  " + name)
    )
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise ValueError("Node download integrity check failed.")
    with tarfile.open(archive) as tar:
        tar.extractall("/opt", filter="data")
    node_dir = f"/opt/node-v{version}-linux-x64/bin"
    for binary in ("node", "npm", "npx", "corepack"):
        destination = pathlib.Path("/usr/local/bin") / binary
        if destination.exists() or destination.is_symlink():
            if not destination.is_symlink() or not str(
                destination.readlink()
            ).startswith("/opt/node-v"):
                raise ValueError(
                    "An existing Node installation must be reviewed; it will not be replaced."
                )
            destination.unlink()
        destination.symlink_to(pathlib.Path(node_dir) / binary)
    run(["corepack", "enable"])
    run(["corepack", "prepare", "pnpm@10.33.0", "--activate"], timeout=300)


def sql(state, secrets_data):
    run(["systemctl", "enable", "--now", "postgresql"])
    # Role/database creation is journalled before the next installer phase; credentials stay off argv.
    sqltext = ""
    for role, key in [
        ("nsoft_migrate", "MIGRATION_DB_PASSWORD"),
        ("nsoft_runtime", "APP_DB_PASSWORD"),
        ("mail_reader", "MAIL_DB_PASSWORD"),
        ("roundcube", "ROUNDCUBE_DB_PASSWORD"),
    ]:
        sqltext += f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='{role}') THEN CREATE ROLE {role} LOGIN PASSWORD '{secrets_data[key]}'; END IF; END $$;\n"
    run(
        [
            "runuser",
            "-u",
            "postgres",
            "--",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-d",
            "postgres",
        ],
        input=sqltext,
    )
    for database, owner in [
        ("mailcompanion", "nsoft_migrate"),
        ("roundcube", "roundcube"),
    ]:
        found = run(
            [
                "runuser",
                "-u",
                "postgres",
                "--",
                "psql",
                "-tAc",
                f"SELECT 1 FROM pg_database WHERE datname='{database}'",
            ]
        ).stdout.strip()
        if found != "1":
            run(["runuser", "-u", "postgres", "--", "createdb", "-O", owner, database])
    run(
        [
            "runuser",
            "-u",
            "postgres",
            "--",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-d",
            "mailcompanion",
        ],
        input="GRANT ALL ON SCHEMA public TO nsoft_migrate;",
    )
    # Local-only database connections; installer refuses pre-existing PostgreSQL before adoption.
    run(["systemctl", "restart", "postgresql"])


def env_text(state, secrets_data, migrate=False):
    host = "127.0.0.1" if state["method"] == "native" else "postgres"
    role = "nsoft_migrate" if migrate else "nsoft_runtime"
    password = secrets_data["MIGRATION_DB_PASSWORD" if migrate else "APP_DB_PASSWORD"]
    values = {
        **({} if migrate else {"ENCRYPTION_KEY": secrets_data["ENCRYPTION_KEY"]}),
        "NODE_ENV": "production",
        "DATABASE_URL": f"postgresql://{role}:{password}@{host}:5432/mailcompanion",
        "WEB_URL": "https://" + state["panel"],
        "PANEL_HOSTNAME": state["panel"],
        "MAIL_HOSTNAME": state["mail"],
        "PUBLIC_IPV4": state["publicIpv4"],
        "REQUIRE_MFA": "true",
        "INTERNAL_API_URL": "http://127.0.0.1:4000",
        "API_BIND_HOST": "127.0.0.1",
        "DKIM_DIR": str(DATA / "dkim"),
        "ROUTES_DIR": str(DATA / "routes"),
        "USAGE_DIR": str(DATA / "usage"),
        "HOST_AGENT_SOCKET": "/run/nsoft-mail/agent.sock",
        "ACME_EMAIL": state["contact"],
        "NSOFT_BACKUP_ROOT": str(DATA),
    }
    return "".join(f"{key}={value}\n" for key, value in values.items())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--approve-backup", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("Use sudo on the target server.")
    if args.approve_backup:
        proposal = load(ROOT / "backup-proposal.json")
        from actions import backup_settings

        backup_settings(proposal)
        print(
            "Approve encrypted backups to this exact repository: "
            + proposal["repository"]
        )
        if (
            input("Approve this destination and daily backup schedule? [y/N]: ")
            .strip()
            .lower()
            != "y"
        ):
            raise SystemExit("No backup settings changed.")
        atomic(ROOT / "backup.json", json.dumps(proposal))
        (ROOT / "backup-proposal.json").unlink()
        run(["systemctl", "enable", "--now", "nsoft-backup.timer"])
        print("Backup destination approved. Refresh the setup dashboard.")
        return
    if args.check:
        facts = collect()
        print(json.dumps({"facts": facts, "checks": evaluate(facts)}, indent=2))
        return
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(ROOT, 0o700)
    lock = open(ROOT / "install.lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    path = ROOT / "installation.json"
    existing = path.exists()
    if existing:
        state = load(path)
        print(
            "Resuming your existing installation. Changing deployment method requires a separate migration."
        )
    else:
        method = input("Installation method: [native] or docker: ").strip() or "native"
        if method not in ("native", "docker"):
            raise ValueError("Choose native or docker.")
        panel = hostname(
            input("Panel hostname (for example panel.example.com): ").strip().lower()
        )
        contact = input("Certificate contact email: ").strip()
        if not __import__("re").fullmatch(
            r"[a-zA-Z0-9._+\-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", contact
        ):
            raise ValueError("Enter a valid contact email.")
        dns = (
            input("Certificate DNS method: [cloudflare] or http: ").strip()
            or "cloudflare"
        )
        if dns not in ("cloudflare", "http"):
            raise ValueError("Choose cloudflare or http.")
        facts = collect(panel)
        try:
            public = (
                urllib.request.urlopen("https://checkip.amazonaws.com", timeout=10)
                .read(64)
                .decode()
                .strip()
            )
        except OSError:
            public = facts["publicIpv4"]
        facts["publicIpv4"] = public
        checks = evaluate(facts)
        for item in checks:
            print(
                ("Complete: " if item["passed"] else "Action needed: ") + item["detail"]
            )
        if not all(c["passed"] for c in checks):
            raise ValueError(
                "Resolve the checks above, then run this installer again. No packages or existing services were changed."
            )
        address = "127.0.0.1"
        if facts["proxy"] == "coolify":
            info = json.loads(run(["docker", "network", "inspect", "coolify"]).stdout)[
                0
            ]
            address = info["IPAM"]["Config"][0]["Gateway"]
            ip = ipaddress.ip_address(address)
            if not ip.is_private:
                raise ValueError("Coolify bridge address must be private.")
        mail = "mail." + (panel[6:] if panel.startswith("panel.") else panel)
        state = {
            "method": method,
            "panel": panel,
            "mail": mail,
            "contact": contact,
            "dns": dns,
            "proxy": facts["proxy"],
            "proxyAddress": address,
            "publicIpv4": public,
            "phase": "preflight",
            "completed": [],
            "checks": checks,
            "revision": run(
                ["git", "-C", str(SOURCE), "rev-parse", "HEAD"]
            ).stdout.strip(),
            "lastError": None,
        }
        atomic(path, json.dumps(state))
        if dns == "cloudflare":
            token = getpass.getpass("Cloudflare zone DNS edit token (hidden): ")
            if not __import__("re").fullmatch(r"[a-zA-Z0-9_-]{20,256}", token):
                raise ValueError("Use a scoped Cloudflare API token.")
            atomic(ROOT / "acme.env", "dns_cloudflare_api_token = " + token + "\n")
    if state["dns"] == "cloudflare" and not (ROOT / "acme.env").exists():
        token = getpass.getpass("Cloudflare zone DNS edit token (hidden): ")
        if not __import__("re").fullmatch(r"[a-zA-Z0-9_-]{20,256}", token):
            raise ValueError("Use a scoped Cloudflare API token.")
        atomic(ROOT / "acme.env", "dns_cloudflare_api_token = " + token + "\n")
    from source import export_source, verify_source, restore_privileged_sources

    stage = ROOT / "source"
    stage = export_source(SOURCE, state["revision"])
    secrets_path = ROOT / "secrets.json"
    if not secrets_path.exists():
        import secrets

        values = {
            key: secrets.token_hex(32)
            for key in (
                "POSTGRES_PASSWORD",
                "MIGRATION_DB_PASSWORD",
                "APP_DB_PASSWORD",
                "MAIL_DB_PASSWORD",
                "ROUNDCUBE_DB_PASSWORD",
                "ENCRYPTION_KEY",
            )
        }
        values["ROUNDCUBE_DES_KEY"] = secrets.token_hex(12)
        atomic(secrets_path, json.dumps(values))
    secrets_data = load(secrets_path)

    def phase(name, function):
        if name in state["completed"]:
            return
        print("Setting up: " + name.replace("-", " "))
        state["phase"] = name
        atomic(path, json.dumps(state))
        function()
        state["completed"].append(name)
        atomic(path, json.dumps(state))

    try:

        def packages():
            os.environ["DEBIAN_FRONTEND"] = "noninteractive"
            # Prevent default mail/web daemons opening public ports before secured configuration.
            policy = pathlib.Path("/usr/sbin/policy-rc.d")
            owned_policy = ROOT / "apt-policy-owned"
            policy_text = "#!/bin/sh\nexit 101\n"
            if policy.exists() and not (
                owned_policy.exists() and policy.read_text() == policy_text
            ):
                raise ValueError(
                    "An existing package service policy needs administrator review."
                )
            atomic(owned_policy, "NSoft installer temporary package policy")
            atomic(policy, policy_text, 0o755)
            try:
                # Masks survive an interrupted installation/reboot. Only absent services
                # passed preflight; packaged Nginx stays masked in favor of our private gateway.
                masked = (
                    ["nginx", "certbot.timer"]
                    if state["proxy"] == "standalone" or state["method"] == "native"
                    else ["certbot.timer"]
                )
                if state["method"] == "native":
                    masked += [
                        "postfix",
                        "dovecot",
                        "rspamd",
                        "valkey-server",
                        "clamav-daemon",
                        "clamav-freshclam",
                        "php8.3-fpm",
                    ]
                run(["systemctl", "mask"] + masked)
                run(["apt-get", "update"], timeout=600)
                chosen = (
                    native.PACKAGES
                    if state["method"] == "native"
                    else [
                        "certbot",
                        "python3-certbot-dns-cloudflare",
                        "restic",
                        "openssl",
                        "ca-certificates",
                        "curl",
                        "git",
                    ]
                    + (["nginx"] if state["proxy"] == "standalone" else [])
                )
                if state["method"] == "docker" and not shutil.which("docker"):
                    chosen += ["docker.io", "docker-compose-v2"]
                run(
                    ["apt-get", "install", "-y", "--no-install-recommends"] + chosen,
                    timeout=1800,
                )
                if state["method"] == "docker":
                    run(["systemctl", "enable", "--now", "docker"])
            finally:
                policy.unlink(missing_ok=True)
                owned_policy.unlink(missing_ok=True)

        phase("packages", packages)

        def application():
            if APP.exists():
                marker = APP / ".nsoft-revision"
                if (
                    not marker.exists()
                    or marker.read_text().strip() != state["revision"]
                ):
                    raise ValueError(
                        "The target directory already exists and is not this installation. Use a clean source checkout outside /opt/nsoft-mail-companion."
                    )
            else:
                shutil.copytree(stage, APP)
                atomic(APP / ".nsoft-revision", state["revision"] + "\n", 0o644)
            if state["method"] == "native":
                node_runtime()
                native.identities()
                sql(state, secrets_data)
                try:
                    __import__("pwd").getpwnam("nsoft-build")
                except KeyError:
                    run(
                        [
                            "useradd",
                            "--system",
                            "--user-group",
                            "--create-home",
                            "--home",
                            str(DATA / "build"),
                            "--shell",
                            "/usr/sbin/nologin",
                            "nsoft-build",
                        ]
                    )
                run(["chown", "-R", "nsoft-build:nsoft-build", str(APP)])
                run(
                    [
                        "runuser",
                        "-u",
                        "nsoft-build",
                        "--",
                        "/usr/local/bin/pnpm",
                        "install",
                        "--frozen-lockfile",
                    ],
                    cwd=APP,
                    timeout=600,
                )
                run(
                    [
                        "runuser",
                        "-u",
                        "nsoft-build",
                        "--",
                        "/usr/local/bin/pnpm",
                        "build",
                    ],
                    cwd=APP,
                    timeout=600,
                )
                verify_source(stage)
                # Recreate privileged Python code from root-only staging: discard build-created
                # bytecode or shadow modules that source hashing alone would not detect.
                restore_privileged_sources(stage)
                run(["chown", "-R", "root:root", str(APP)])
                atomic(ROOT / "migrate.env", env_text(state, secrets_data, True))
                atomic(ROOT / "application.env", env_text(state, secrets_data))
                env = {
                    **os.environ,
                    **dict(
                        line.split("=", 1)
                        for line in (ROOT / "migrate.env").read_text().splitlines()
                    ),
                }
                run(
                    [
                        "runuser",
                        "-u",
                        "nsoft-build",
                        "--",
                        "/usr/local/bin/pnpm",
                        "db:migrate",
                    ],
                    cwd=APP,
                    env=env,
                    timeout=300,
                )
                native.configure_webmail(state, secrets_data)
                native.unit(
                    "api",
                    f"/usr/local/bin/node {APP}/apps/api/dist/index.js",
                    ROOT / "application.env",
                    "nsoft-api",
                    extra="ProtectSystem=strict\nProtectHome=true\n",
                )
                native.unit(
                    "worker",
                    f"/usr/local/bin/node {APP}/apps/worker/dist/index.js",
                    ROOT / "application.env",
                    "nsoft-worker",
                    extra=f"ProtectSystem=strict\nReadWritePaths={DATA}/dkim {DATA}/routes\nProtectHome=true\n",
                )
                native.unit(
                    "web",
                    f'/usr/local/bin/node {APP}/apps/web/node_modules/next/dist/bin/next start -p 3000 -H {state["proxyAddress"]}',
                    user="nsoft-web",
                    extra="Environment=INTERNAL_API_URL=http://127.0.0.1:4000\n",
                )
            else:
                if not shutil.which("docker"):
                    raise ValueError(
                        "Docker Engine is needed for Docker mode. Install it using official Docker/Coolify instructions, then resume."
                    )
                from runtime import docker_environment

                docker_environment(state, secrets_data)
                run(
                    [
                        "docker",
                        "compose",
                        "-f",
                        str(ROOT / "compose.json"),
                        "up",
                        "-d",
                        "--build",
                    ],
                    cwd=APP,
                    env={**os.environ, "COMPOSE_PROJECT_NAME": "nsoft-guided"},
                    timeout=1800,
                )

        phase("application", application)
        (DATA / "acme").mkdir(parents=True, exist_ok=True)
        if state["proxy"] == "coolify":
            native.unit(
                "acme-webroot",
                f'/usr/bin/python3 -m http.server 8090 --bind {state["proxyAddress"]} --directory {DATA}/acme',
                user="www-data",
            )
        run(["systemctl", "daemon-reload"])
        if state["proxy"] == "coolify":
            run(["systemctl", "enable", "--now", "nsoft-acme-webroot"])
        phase("initial-dns", lambda: initial_dns(state))
        phase("initial-routes", lambda: configure(state, [state["mail"]]))
        phase("panel-certificate", lambda: issue(state["panel"], state))
        phase("mail-certificate", lambda: issue(state["mail"], state))

        def services():
            configure(state, [state["mail"]])
            if state["method"] == "native":
                native.configure_mail(state, secrets_data)
                run(
                    [
                        "systemctl",
                        "unmask",
                        "postfix",
                        "dovecot",
                        "rspamd",
                        "valkey-server",
                        "clamav-daemon",
                        "clamav-freshclam",
                        "php8.3-fpm",
                    ]
                )
                run(
                    [
                        "systemctl",
                        "enable",
                        "--now",
                        "valkey-server",
                        "clamav-freshclam",
                        "clamav-daemon",
                        "rspamd",
                        "php8.3-fpm",
                        "postfix",
                        "dovecot",
                        "nsoft-api",
                        "nsoft-worker",
                        "nsoft-web",
                    ]
                )
            from runtime import install_agent

            install_agent(state)

        phase("services", services)
        if not trusted_https(state["panel"]):
            raise ValueError(
                "Trusted panel HTTPS could not be verified. Check DNS, inbound 443 and proxy certificates; then resume."
            )
        phase("https-verified", lambda: None)
        if state["method"] == "native":
            environment = {
                **os.environ,
                **dict(
                    line.split("=", 1)
                    for line in (ROOT / "application.env").read_text().splitlines()
                ),
            }
            result = run(
                [
                    "runuser",
                    "-u",
                    "nsoft-api",
                    "--",
                    "/usr/local/bin/node",
                    str(APP / "apps/api/dist/issue-setup.js"),
                ],
                cwd=APP,
                env=environment,
            ).stdout
        else:
            result = run(
                [
                    "docker",
                    "compose",
                    "-f",
                    str(ROOT / "compose.json"),
                    "exec",
                    "-T",
                    "api",
                    "pnpm",
                    "--filter",
                    "@nsoft/api",
                    "issue-setup",
                ],
                cwd=APP,
            ).stdout
        link = json.loads(
            next(line for line in reversed(result.splitlines()) if line.startswith("{"))
        )
        state["phase"] = "browser-setup"
        state["lastError"] = None
        atomic(path, json.dumps(state))
        print(
            "\nOpen this secure setup link (expires in 30 minutes; do not share it):\n"
            + link["url"]
        )
    except Exception as error:
        state["lastError"] = (
            "Installation needs attention at "
            + state["phase"]
            + ". Fix the prerequisite and rerun scripts/install.sh --resume; your generated secrets and data are preserved."
        )
        atomic(path, json.dumps(state))
        print(state["lastError"], file=sys.stderr)
        if isinstance(error, ValueError):
            print(str(error), file=sys.stderr)
        # Raw command output may include sensitive values; keep it out of shared logs.
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print(
            "Installation interrupted. Your progress is saved; rerun with --resume.",
            file=sys.stderr,
        )
        raise SystemExit(130)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(
            (
                str(error)
                if isinstance(error, ValueError)
                else "A server prerequisite failed. Inspect local service health and retry."
            ),
            file=sys.stderr,
        )
        raise SystemExit(1)
