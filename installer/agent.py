#!/usr/bin/env python3
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
"""Root helper: Unix peer credentials + fixed operations, no shell command API."""

import concurrent.futures, fcntl, http.server, json, os, pathlib, pwd, socket, socketserver, struct, threading, uuid
from common import ROOT, atomic, load, run
from actions import status, execute, backup_settings

OPERATIONS = {
    "status",
    "task",
    "refresh",
    "certificate",
    "webmail",
    "backup",
    "restore-check",
    "backup-configure",
    "dns-provider",
}


class Queue:
    def __init__(self, state, path):
        self.state = state
        self.path = path
        self.lock = threading.Lock()
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self.items = load(path) if path.exists() else {}
        for key, item in self.items.items():
            if item["status"] in ("PENDING", "RUNNING"):
                item["status"] = "PENDING"
                self.pool.submit(self.perform, key)

    def save(self):
        atomic(self.path, json.dumps(self.items))

    def perform(self, key):
        with self.lock:
            item = self.items[key]
            item["status"] = "RUNNING"
            self.save()
        try:
            result = execute(item["operation"], item.get("target"), self.state)
            with self.lock:
                item.update(status="SUCCEEDED", result=result)
                self.save()
        except Exception:
            with self.lock:
                item.update(
                    status="FAILED",
                    result={
                        "detail": "Action needed. Check domain DNS, service readiness and configured provider permissions before retrying."
                    },
                )
                self.save()

    def add(self, operation, target, key):
        with self.lock:
            if key in self.items:
                old = self.items[key]
                if old["operation"] != operation or old.get("target") != target:
                    raise ValueError("Idempotency key conflict.")
                if old["status"] != "FAILED":
                    return dict(old)
                old.update(status="PENDING", result=None)
                self.save()
                self.pool.submit(self.perform, key)
                return {"id": key, "status": "PENDING"}
            self.items[key] = {
                "id": key,
                "operation": operation,
                "target": target,
                "status": "PENDING",
            }
            self.save()
        self.pool.submit(self.perform, key)
        return {"id": key, "status": "PENDING"}


def docker_caller(pid):
    # Host UID 1000 alone is insufficient: require the actual API/worker container cgroup.
    try:
        caller = pathlib.Path(f"/proc/{pid}/cgroup").read_text()
        for service in ("api", "worker"):
            ids = run(
                [
                    "docker",
                    "ps",
                    "--filter",
                    "label=com.docker.compose.project=nsoft-guided",
                    "--filter",
                    "label=com.docker.compose.service=" + service,
                    "--format",
                    "{{.ID}}",
                ]
            ).stdout.split()
            for container in ids:
                process = int(
                    run(
                        ["docker", "inspect", "--format", "{{.State.Pid}}", container]
                    ).stdout.strip()
                )
                group = pathlib.Path(f"/proc/{process}/cgroup").read_text()
                if (
                    group == caller
                    and group != pathlib.Path("/proc/1/cgroup").read_text()
                ):
                    return True
    except Exception:
        pass
    return False


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        pid, uid, _ = struct.unpack(
            "3i",
            connection.getsockopt(
                socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")
            ),
        )
        if uid not in self.allowed_uids or (
            self.state["method"] == "docker" and uid != 0 and not docker_caller(pid)
        ):
            connection.close()
            raise OSError("Caller denied")
        return connection, address


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        code = 200
        try:
            if self.path != "/action":
                raise ValueError("Route denied")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192:
                raise ValueError("Invalid request size")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or set(body) - {
                "operation",
                "target",
                "values",
                "idempotencyKey",
            }:
                raise ValueError("Unexpected fields")
            operation = body.get("operation")
            if operation not in OPERATIONS:
                raise ValueError("Operation denied")
            target = body.get("target")
            if operation == "status":
                result = status(self.server.state)
            elif operation == "task":
                uuid.UUID(target)
                with self.server.queue.lock:
                    result = dict(self.server.queue.items[target])
            elif operation == "dns-provider":
                from dns import provider

                result = provider(body.get("values"))
            elif operation == "backup-configure":
                values = backup_settings(body.get("values"))
                atomic(ROOT / "backup-proposal.json", json.dumps(values))
                # A separate server-local confirmation binds root permission to this exact destination.
                result = {"status": "SUCCEEDED", "approvalRequired": True}
            else:
                if body.get("values"):
                    raise ValueError("Values are not permitted for this action")
                key = body.get("idempotencyKey") or str(uuid.uuid4())
                uuid.UUID(key)
                result = self.server.queue.add(operation, target, key)
        except Exception:
            code = 422
            result = {
                "status": "FAILED",
                "detail": "The requested server action is invalid or unavailable.",
            }
        encoded = json.dumps(result).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main():
    if os.geteuid() != 0:
        raise SystemExit("The host agent must run as root under systemd.")
    state = load(ROOT / "installation.json")
    path = pathlib.Path("/run/nsoft-mail/agent.sock")
    lock = open(ROOT / "agent.lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    path.parent.mkdir(exist_ok=True)
    path.unlink(missing_ok=True)
    server = Server(str(path), Handler)
    server.state = state
    server.allowed_uids = (
        {0, 1000}
        if state["method"] == "docker"
        else {0, pwd.getpwnam("nsoft-api").pw_uid, pwd.getpwnam("nsoft-worker").pw_uid}
    )
    os.chmod(path, 0o660)
    server.queue = Queue(state, ROOT / "host-tasks.json")
    server.serve_forever()


if __name__ == "__main__":
    main()
