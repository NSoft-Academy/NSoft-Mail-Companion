# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import io, json, pathlib, sys, tarfile, tempfile, unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "installer"))
import common, preflight, source, proxy, actions, dns, agent, install


class InstallerTests(unittest.TestCase):
    def facts(self, **extra):
        return dict(
            os="ubuntu",
            version="24.04",
            arch="x86_64",
            memoryMb=8192,
            diskGb=40,
            publicIpv4="8.8.8.8",
            proxy="standalone",
            **extra
        )

    def state(self, **extra):
        return dict(
            panel="panel.example.com",
            mail="mail.example.com",
            method="native",
            proxy="standalone",
            proxyAddress="127.0.0.1",
            dns="http",
            publicIpv4="8.8.8.8",
            **extra
        )

    def test_eligible_server(self):
        self.assertTrue(all(x["passed"] for x in preflight.evaluate(self.facts())))

    def test_home_cgnat_rejected(self):
        facts = self.facts()
        facts["publicIpv4"] = "100.64.1.2"
        self.assertFalse(
            next(
                x["passed"]
                for x in preflight.evaluate(facts)
                if x["name"] == "public-ipv4"
            )
        )

    def test_old_os_rejected(self):
        facts = self.facts()
        facts["version"] = "22.04"
        self.assertFalse(all(x["passed"] for x in preflight.evaluate(facts)))

    def test_existing_services_even_when_ports_free(self):
        self.assertFalse(
            all(
                x["passed"]
                for x in preflight.evaluate(
                    self.facts(installedServices=["postgresql"])
                )
            )
        )

    def test_existing_installation_identities_permitted(self):
        self.assertTrue(
            all(
                x["passed"]
                for x in preflight.evaluate(
                    self.facts(identityConflicts=["vmail"]), existing=True
                )
            )
        )

    def test_port_conflict_refused(self):
        self.assertFalse(
            all(
                x["passed"]
                for x in preflight.evaluate(self.facts(occupiedMailPorts=[25]))
            )
        )

    def test_shell_hostname_rejected(self):
        for host in [
            "mail.example.com;reboot",
            "../foo",
            "MAIL.example.com",
            "localhost",
            "mail.example.com\n",
        ]:
            with self.subTest(host=host), self.assertRaises(ValueError):
                common.hostname(host)

    def test_state_redacted(self):
        self.assertNotIn(
            "token", common.public_state({"token": "private", "method": "native"})
        )

    def test_runtime_credentials_separated(self):
        secret = {
            k: "secret-" + k
            for k in (
                "ENCRYPTION_KEY",
                "APP_DB_PASSWORD",
                "MIGRATION_DB_PASSWORD",
                "MAIL_DB_PASSWORD",
                "ROUNDCUBE_DB_PASSWORD",
                "POSTGRES_PASSWORD",
            )
        }
        text = install.env_text(dict(self.state(), contact="owner@example.com"), secret)
        self.assertIn("secret-APP_DB_PASSWORD", text)
        for key in (
            "MIGRATION_DB_PASSWORD",
            "MAIL_DB_PASSWORD",
            "ROUNDCUBE_DB_PASSWORD",
            "POSTGRES_PASSWORD",
        ):
            self.assertNotIn(secret[key], text)

    def test_coolify_nginx_does_not_bind_public_http(self):
        state = self.state()
        state.update(proxy="coolify", proxyAddress="172.18.0.1")
        text = proxy.nginx_config(state, ["mail.example.com"])
        self.assertNotIn("listen 80;", text)
        self.assertNotIn("listen 443", text)
        self.assertIn("listen 172.18.0.1:8080", text)

    def test_backup_input_cannot_be_shell_or_local(self):
        for repository in [
            "/etc",
            "s3:http://example.com/b",
            "s3:https://example.com/b;reboot",
            "s3:https://example.com/b\n",
        ]:
            with self.subTest(repository=repository), self.assertRaises(ValueError):
                actions.backup_settings(
                    dict(
                        repository=repository,
                        password="x" * 25,
                        accessKey="test",
                        secretKey="test",
                    )
                )

    def test_atomic_private_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "state"
            common.atomic(path, "private")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.read_text(), "private")

    def test_export_rejects_dirty_checkout(self):
        with patch.object(source, "run", return_value=Mock(stdout=" M unsafe.py")):
            with self.assertRaises(ValueError):
                source.export_source(pathlib.Path("/tmp"), "a" * 40)

    def test_export_rejects_symlinks_without_committing_stage(self):
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w") as file:
            member = tarfile.TarInfo("unsafe")
            member.type = tarfile.SYMTYPE
            member.linkname = "/etc/shadow"
            file.addfile(member)
        with tempfile.TemporaryDirectory() as directory, patch.object(
            source, "ROOT", pathlib.Path(directory)
        ), patch.object(source, "run", return_value=Mock(stdout="")), patch.object(
            source.subprocess, "run", return_value=Mock(stdout=archive.getvalue())
        ):
            with self.assertRaises(ValueError):
                source.export_source(pathlib.Path("/tmp"), "a" * 40)
            self.assertFalse((pathlib.Path(directory) / "source").exists())

    def test_provider_zone_verified_before_persisting(self):
        with patch.object(dns, "request", return_value={"name": "other.example.com"}):
            with self.assertRaises(ValueError):
                dns.provider(
                    dict(zoneId="a" * 32, zoneName="example.com", token="t" * 30)
                )

    def test_cloudflare_conflict_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            dns, "ROOT", pathlib.Path(directory)
        ), patch.object(
            dns,
            "request",
            side_effect=[
                [{"id": "a" * 32, "name": "example.com"}],
                [{"type": "A", "content": "1.1.1.1", "proxied": False}],
            ],
        ) as calls:
            common.atomic(
                pathlib.Path(directory) / "acme.env",
                "dns_cloudflare_api_token = " + "t" * 30,
            )
            state = self.state()
            state["dns"] = "cloudflare"
            with self.assertRaises(ValueError):
                dns.initial_dns(state)
            self.assertEqual(calls.call_count, 2)

    def test_build_created_privileged_modules_are_discarded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            stage = root / "stage"
            app = root / "app"
            for name in ("installer", "docker", "scripts"):
                (stage / name).mkdir(parents=True)
                (app / name).mkdir(parents=True)
                (stage / name / "reviewed.py").write_text("trusted")
                (app / name / "shadow.py").write_text("unreviewed")
            with patch.object(source, "APP", app):
                source.restore_privileged_sources(stage)
            self.assertFalse((app / "installer/shadow.py").exists())
            self.assertEqual((app / "installer/reviewed.py").read_text(), "trusted")

    def test_docker_caller_rejects_host_user_cgroup(self):
        def group(path):
            if str(path) == "/proc/99/cgroup":
                return "0::/user.slice/user-1000.slice"
            return "0::/system.slice/docker-fixture.scope"

        with patch.object(
            agent,
            "run",
            side_effect=[
                Mock(stdout="fixture"),
                Mock(stdout="10"),
                Mock(stdout="fixture2"),
                Mock(stdout="11"),
            ],
        ), patch.object(pathlib.Path, "read_text", group):
            self.assertFalse(agent.docker_caller(99))

    def test_docker_caller_accepts_only_expected_container_cgroup(self):
        def group(path):
            return (
                "0::/"
                if str(path) == "/proc/1/cgroup"
                else "0::/system.slice/docker-fixture.scope"
            )

        with patch.object(
            agent, "run", side_effect=[Mock(stdout="fixture"), Mock(stdout="10")]
        ), patch.object(pathlib.Path, "read_text", group):
            self.assertTrue(agent.docker_caller(99))

    def test_queue_replay_does_not_repeat_success(self):
        queue = agent.Queue.__new__(agent.Queue)
        queue.lock = __import__("threading").Lock()
        queue.items = {
            "test": dict(operation="backup", target=None, status="SUCCEEDED")
        }
        queue.save = Mock()
        queue.pool = Mock()
        self.assertEqual(queue.add("backup", None, "test")["status"], "SUCCEEDED")
        queue.pool.submit.assert_not_called()

    def test_queue_failed_action_can_retry(self):
        queue = agent.Queue.__new__(agent.Queue)
        queue.lock = __import__("threading").Lock()
        queue.items = {"test": dict(operation="backup", target=None, status="FAILED")}
        queue.save = Mock()
        queue.pool = Mock()
        self.assertEqual(queue.add("backup", None, "test")["status"], "PENDING")
        queue.pool.submit.assert_called_once()

    def test_idempotency_payload_conflict(self):
        queue = agent.Queue.__new__(agent.Queue)
        queue.lock = __import__("threading").Lock()
        queue.items = {
            "test": dict(operation="backup", target=None, status="SUCCEEDED")
        }
        with self.assertRaises(ValueError):
            queue.add("certificate", "mail.example.com", "test")


if __name__ == "__main__":
    unittest.main()
