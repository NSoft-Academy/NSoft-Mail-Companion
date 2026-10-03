# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
"""Fixed-path, atomic installation state. Never includes provider credentials in status."""

import json, os, pathlib, re, subprocess, tempfile

ROOT = pathlib.Path("/etc/nsoft-mail")
DATA = pathlib.Path("/var/lib/nsoft-mail")
APP = pathlib.Path("/opt/nsoft-mail-companion")
HOST = re.compile(
    r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"
)


def hostname(value):
    if not isinstance(value, str) or not HOST.fullmatch(value):
        raise ValueError("Enter a full lowercase hostname such as panel.example.com.")
    return value


def run(args, **kwargs):
    # Callers pass fixed executables and separate validated arguments. No shell expansion.
    return subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        timeout=kwargs.pop("timeout", 120),
        **kwargs
    )


def atomic(path, text, mode=0o600):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".nsoft-")
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w") as file:
            file.write(text)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def load(path):
    return json.loads(pathlib.Path(path).read_text())


def public_state(state):
    return {
        key: state.get(key)
        for key in (
            "method",
            "panel",
            "mail",
            "proxy",
            "phase",
            "revision",
            "lastError",
            "completed",
            "checks",
        )
    }


from contextlib import contextmanager


@contextmanager
def runtime_lock():
    import fcntl

    with open(ROOT / "runtime.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def atomic_changed(path, text, mode=0o600):
    path = pathlib.Path(path)
    if path.exists() and path.read_text() == text:
        return False
    atomic(path, text, mode)
    return True
