# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import json, os, pathlib, pwd, grp, shutil, re, secrets
from common import ROOT, DATA, APP, atomic, run, hostname

PACKAGES = [
    "postgresql-16",
    "postfix",
    "postfix-pgsql",
    "libsasl2-modules",
    "dovecot-core",
    "dovecot-imapd",
    "dovecot-lmtpd",
    "dovecot-pgsql",
    "dovecot-sieve",
    "dovecot-managesieved",
    "rspamd",
    "valkey-server",
    "clamav-daemon",
    "clamav-freshclam",
    "nginx",
    "php8.3-fpm",
    "php8.3-pgsql",
    "php8.3-mbstring",
    "php8.3-xml",
    "php8.3-intl",
    "php8.3-curl",
    "roundcube-core",
    "roundcube-pgsql",
    "roundcube-plugins",
    "certbot",
    "python3-certbot-dns-cloudflare",
    "restic",
    "openssl",
    "ca-certificates",
    "curl",
    "git",
    "build-essential",
]


def unit(name, command, envfile=None, user="root", group=None, extra=""):
    environment = f"EnvironmentFile={envfile}\n" if envfile else ""
    text = f"""[Unit]
Description=NSoft Mail {name}
After=network-online.target postgresql.service
[Service]
Type=simple
User={user}
Group={group or user}
WorkingDirectory={APP}
{environment}ExecStart={command}
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
UMask=0027
{extra}
[Install]
WantedBy=multi-user.target
"""
    atomic(f"/etc/systemd/system/nsoft-{name}.service", text, 0o644)


def identities():
    for group in ("nsoft-host", "nsoft-dkim"):
        try:
            grp.getgrnam(group)
        except KeyError:
            run(["groupadd", "--system", group])
    for user in ("nsoft-api", "nsoft-worker", "nsoft-web"):
        try:
            pwd.getpwnam(user)
        except KeyError:
            run(
                [
                    "useradd",
                    "--system",
                    "--user-group",
                    "--home",
                    str(DATA / user),
                    "--shell",
                    "/usr/sbin/nologin",
                    user,
                ]
            )
        (DATA / user).mkdir(parents=True, exist_ok=True)
        run(["chown", f"{user}:{user}", str(DATA / user)])
    for user in ("nsoft-api", "nsoft-worker"):
        run(["usermod", "-a", "-G", "nsoft-host", user])
    for user in ("nsoft-worker", "_rspamd"):
        run(["usermod", "-a", "-G", "nsoft-dkim", user])
    try:
        pwd.getpwnam("vmail")
    except KeyError:
        if any(p.pw_uid == 5000 for p in pwd.getpwall()):
            raise ValueError(
                "UID 5000 is already in use; no identities changed for mail storage."
            )
        run(["groupadd", "-g", "5000", "vmail"])
        run(
            [
                "useradd",
                "-u",
                "5000",
                "-g",
                "vmail",
                "-d",
                "/var/vmail",
                "-s",
                "/usr/sbin/nologin",
                "vmail",
            ]
        )
    pathlib.Path("/var/vmail").mkdir(exist_ok=True)
    run(["chown", "vmail:vmail", "/var/vmail"])
    for name in ("dkim", "routes", "usage", "acme", "tls"):
        (DATA / name).mkdir(parents=True, exist_ok=True)
    run(["chown", "nsoft-worker:nsoft-dkim", str(DATA / "dkim")])
    os.chmod(DATA / "dkim", 0o2750)
    for name in ("routes", "usage"):
        run(["chown", "nsoft-worker:nsoft-worker", str(DATA / name)])


def configure_mail(state, secrets_data):
    host = hostname(state["mail"])
    base = APP / "docker/mail"
    for source, target in [
        ("main.cf", "/etc/postfix/main.cf"),
        ("master.cf", "/etc/postfix/master.cf"),
        ("dovecot.conf", "/etc/dovecot/dovecot.conf"),
    ]:
        text = (
            (base / source)
            .read_text()
            .replace("__MAIL_HOSTNAME__", host)
            .replace("/data/tls/", str(DATA / "tls") + "/")
            .replace("/opt/nsoft/", str(APP / "docker/mail") + "/")
        )
        text = (
            text.replace("inet:rspamd:11332", "inet:127.0.0.1:11332")
            .replace("maillog_file = /dev/stdout", "maillog_file =")
            .replace("log_path = /dev/stderr", "log_path = syslog")
            .replace("info_log_path = /dev/stdout", "info_log_path = syslog")
        )
        text = text.replace(
            str(APP / "docker/mail/spam.sieve"), str(DATA / "sieve/spam.svbin")
        )
        atomic(target, text, 0o644)
    queries = {
        "domains": "SELECT name FROM mail_domains WHERE name='%s'",
        "mailboxes": "SELECT email FROM mail_recipients WHERE email='%s'",
        "aliases": "SELECT destinations FROM mail_aliases WHERE source='%s'",
        "senders": "SELECT owners FROM mail_senders WHERE email='%s'",
        "sending": "SELECT action FROM mail_sending WHERE name='%d'",
    }
    for name, query in queries.items():
        target = f"/etc/postfix/pgsql-{name}.cf"
        atomic(
            target,
            f"hosts = 127.0.0.1\nuser = mail_reader\npassword = {secrets_data['MAIL_DB_PASSWORD']}\ndbname = mailcompanion\nquery = {query}\n",
            0o640,
        )
        run(["chown", "root:postfix", target])
    sql = f"driver = pgsql\nconnect = host=127.0.0.1 dbname=mailcompanion user=mail_reader password={secrets_data['MAIL_DB_PASSWORD']}\ndefault_pass_scheme = ARGON2ID\npassword_query = SELECT email AS user,password_hash AS password FROM mail_accounts WHERE email='%u'\niterate_query = SELECT email AS username FROM mail_accounts\nuser_query = SELECT 5000 AS uid,5000 AS gid,'/var/vmail/'||domain||'/'||local_part AS home,'*:bytes='||(quota_mb::bigint*1048576)::text AS quota_rule FROM mail_accounts WHERE email='%u'\n"
    atomic("/etc/dovecot/sql.conf", sql)
    (DATA / "sieve").mkdir(parents=True, exist_ok=True)
    run(["sievec", str(APP / "docker/mail/spam.sieve"), str(DATA / "sieve/spam.svbin")])
    os.chmod(DATA / "sieve/spam.svbin", 0o644)
    pathlib.Path("/var/spool/postfix/private").mkdir(parents=True, exist_ok=True)
    for file in (APP / "docker/rspamd/local.d").iterdir():
        text = (
            file.read_text()
            .replace("redis:6379", "127.0.0.1:6379")
            .replace("clamav:3310", "127.0.0.1:3310")
            .replace("/data/dkim", str(DATA / "dkim"))
        )
        atomic(pathlib.Path("/etc/rspamd/local.d") / file.name, text, 0o644)
    atomic(
        "/etc/rspamd/rspamd.local.lua",
        (APP / "docker/rspamd/nsoft.lua").read_text(),
        0o644,
    )
    # Bind private filtering/cache services to loopback; public mail ports stay unchanged.
    atomic(
        "/etc/rspamd/local.d/worker-proxy.inc",
        'bind_socket = "127.0.0.1:11332"; milter = yes; timeout = 120s; upstream "local" { default = yes; self_scan = yes; }',
        0o644,
    )
    atomic(
        "/etc/rspamd/local.d/worker-normal.inc",
        'bind_socket = "127.0.0.1:11333";',
        0o644,
    )
    atomic(
        "/etc/rspamd/local.d/worker-controller.inc",
        'bind_socket = "127.0.0.1:11334";',
        0o644,
    )
    atomic(
        "/etc/valkey/valkey.conf",
        "bind 127.0.0.1\nprotected-mode yes\nport 6379\ndir /var/lib/valkey\nappendonly yes\n",
        0o640,
    )
    run(["chown", "valkey:valkey", "/etc/valkey/valkey.conf"])
    clam = pathlib.Path("/etc/clamav/clamd.conf")
    text = clam.read_text()
    text = (
        re.sub(r"^TCP(?:Socket|Addr).*$", "", text, flags=re.M)
        + "\nTCPSocket 3310\nTCPAddr 127.0.0.1\n"
    )
    atomic(clam, text, 0o644)
    # Dovecot ManageSieve is internal to Roundcube; no unauthenticated public listener.
    dove = pathlib.Path("/etc/dovecot/dovecot.conf")
    text = dove.read_text().replace(
        "port = 4190", "address = 127.0.0.1\n    port = 4190"
    )
    atomic(dove, text, 0o644)
    for command in (
        ["postfix", "check"],
        ["doveconf", "-n"],
        ["rspamadm", "configtest"],
    ):
        run(command)


def configure_webmail(state, secrets_data):
    config = f"""<?php
$config['db_dsnw'] = 'pgsql://roundcube:{secrets_data['ROUNDCUBE_DB_PASSWORD']}@127.0.0.1/roundcube';
$config['des_key'] = '{secrets_data['ROUNDCUBE_DES_KEY']}';
$config['product_name'] = 'NSoft Mail Companion';
$config['imap_host'] = 'ssl://127.0.0.1:993';
$config['smtp_host'] = 'tls://127.0.0.1:587';
$config['smtp_user'] = '%u'; $config['smtp_pass'] = '%p';
$config['imap_conn_options'] = ['ssl'=>['verify_peer'=>true,'verify_peer_name'=>true,'peer_name'=>'{state['mail']}']];
$config['smtp_conn_options'] = $config['imap_conn_options'];
$config['plugins'] = ['archive','zipdownload','managesieve'];
$config['managesieve_host'] = 'tls://127.0.0.1'; $config['managesieve_port'] = 4190;
$config['managesieve_conn_options'] = $config['imap_conn_options'];
$config['force_https'] = true; $config['session_lifetime'] = 15;
$_SERVER['HTTPS'] = 'on';
"""
    atomic("/etc/roundcube/config.inc.php", config, 0o640)
    run(["chown", "root:www-data", "/etc/roundcube/config.inc.php"])
    # Debian/Ubuntu package keeps the SQL scripts under /usr/share/roundcube/SQL.
    sql = pathlib.Path("/usr/share/roundcube/SQL/postgres.initial.sql")
    environment = {**os.environ, "PGPASSWORD": secrets_data["ROUNDCUBE_DB_PASSWORD"]}
    count = run(
        [
            "psql",
            "-h",
            "127.0.0.1",
            "-U",
            "roundcube",
            "-d",
            "roundcube",
            "-tAc",
            "SELECT count(*) FROM information_schema.tables WHERE table_name='users'",
        ],
        env=environment,
    ).stdout.strip()
    if count == "0":
        run(
            [
                "psql",
                "-h",
                "127.0.0.1",
                "-U",
                "roundcube",
                "-d",
                "roundcube",
                "-v",
                "ON_ERROR_STOP=1",
                "-f",
                str(sql),
            ],
            env=environment,
        )
