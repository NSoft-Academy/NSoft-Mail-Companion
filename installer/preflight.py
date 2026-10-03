# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import errno, ipaddress, pwd, grp, os, pathlib, platform, shutil, socket, subprocess


def eligible_ipv4(value):
    try:
        return (
            ipaddress.ip_address(value).version == 4
            and ipaddress.ip_address(value).is_global
        )
    except ValueError:
        return False


def evaluate(facts, existing=False):
    checks = []

    def add(name, passed, detail):
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    add(
        "operating-system",
        facts.get("os") == "ubuntu" and facts.get("version") == "24.04",
        "Use Ubuntu 24.04 LTS for this installer.",
    )
    add("architecture", facts.get("arch") == "x86_64", "Use a Linux x86-64 server.")
    add(
        "memory",
        facts.get("memoryMb", 0) >= 7168,
        "Reserve 8 GiB RAM for mail, plus capacity for other applications.",
    )
    add(
        "disk",
        facts.get("diskGb", 0) >= 20,
        "At least 20 GiB free is needed to install; mailbox capacity requires additional storage.",
    )
    add(
        "public-ipv4",
        eligible_ipv4(facts.get("publicIpv4", "")),
        "A stable public IPv4 is required. Ask your ISP about static addressing/CGNAT.",
    )
    add(
        "mail-ports",
        existing or not facts.get("occupiedMailPorts"),
        "Existing mail ports/services must be migrated separately; this installer will not replace them.",
    )
    add(
        "application-ports",
        existing or not facts.get("occupiedApplicationPorts"),
        "Ports 3000, 4000, 8080 and 8090 must be unused by other host applications.",
    )
    add(
        "application-directory",
        existing or not facts.get("applicationConflict"),
        "The installer destination and local Node executable must be unused; existing files are preserved.",
    )
    add(
        "proxy",
        facts.get("proxy") in ("standalone", "coolify"),
        "An unsupported existing proxy occupies HTTP ports. Configure it separately before continuing.",
    )
    add(
        "service-identities",
        existing or not facts.get("identityConflicts"),
        "Reserved service identities and UID/GID 5000 must be unused on a fresh server.",
    )
    add(
        "existing-services",
        existing or not facts.get("installedServices"),
        "Existing PostgreSQL, mail, filtering or webmail services are not adopted or overwritten.",
    )
    return checks


def collect(panel=None):
    release = {}
    for line in pathlib.Path("/etc/os-release").read_text().splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            release[key] = value.strip('"')
    memory = (
        int(
            next(
                line.split()[1]
                for line in pathlib.Path("/proc/meminfo").read_text().splitlines()
                if line.startswith("MemTotal:")
            )
        )
        // 1024
    )
    disk = shutil.disk_usage("/").free // (1024**3)

    def occupied_port(port):
        for family, address in [(socket.AF_INET, "0.0.0.0"), (socket.AF_INET6, "::")]:
            try:
                with socket.socket(family) as sock:
                    if family == socket.AF_INET6:
                        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                    sock.bind((address, port))
            except OSError as error:
                if family == socket.AF_INET6 and error.errno in (
                    errno.EAFNOSUPPORT,
                    errno.EADDRNOTAVAIL,
                    errno.ENODEV,
                ):
                    continue
                return True
        return False

    occupied = [p for p in (25, 465, 587, 993) if occupied_port(p)]
    application_ports = [p for p in (3000, 4000, 8080, 8090) if occupied_port(p)]
    http = any(occupied_port(p) for p in (80, 443))
    coolify = pathlib.Path("/data/coolify/proxy/dynamic").is_dir()
    proxy = "coolify" if coolify else ("unsupported" if http else "standalone")
    if coolify:
        try:
            image = subprocess.run(
                ["docker", "inspect", "--format", "{{.Config.Image}}", "coolify-proxy"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            if "traefik" not in image:
                proxy = "unsupported"
        except (OSError, subprocess.SubprocessError):
            proxy = "unsupported"
    public = ""
    if panel:
        try:
            public = socket.gethostbyname(panel)
        except OSError:
            pass
    services = []
    for service in (
        "postfix",
        "dovecot",
        "postgresql",
        "rspamd",
        "clamav-daemon",
        "valkey-server",
        "nginx",
        "php8.3-fpm",
        "certbot.timer",
    ):
        result = subprocess.run(
            ["systemctl", "is-active", service], capture_output=True, text=True
        )
        configured = (
            subprocess.run(
                ["systemctl", "show", "-p", "LoadState", "--value", service],
                capture_output=True,
                text=True,
            ).stdout.strip()
            == "loaded"
        )
        if configured:
            services.append(service)
    conflicts = [
        p.pw_name
        for p in pwd.getpwall()
        if p.pw_uid == 5000
        or p.pw_name
        in ("vmail", "nsoft-api", "nsoft-worker", "nsoft-web", "nsoft-build")
    ]
    conflicts += [
        g.gr_name
        for g in grp.getgrall()
        if g.gr_gid == 5000 or g.gr_name in ("nsoft-host", "nsoft-dkim")
    ]
    return {
        "identityConflicts": conflicts,
        "occupiedApplicationPorts": application_ports,
        "applicationConflict": pathlib.Path("/opt/nsoft-mail-companion").exists()
        or pathlib.Path("/usr/local/bin/node").exists(),
        "os": release.get("ID"),
        "version": release.get("VERSION_ID"),
        "arch": platform.machine(),
        "memoryMb": memory,
        "diskGb": disk,
        "publicIpv4": public,
        "occupiedMailPorts": occupied,
        "proxy": proxy,
        "installedServices": services,
    }
