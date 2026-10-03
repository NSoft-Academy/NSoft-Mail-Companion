# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import hashlib, io, pathlib, shutil, subprocess, tarfile, tempfile
from common import ROOT, APP, atomic, run


def export_source(source, revision):
    # Archive a clean commit: never copy .git credentials, untracked secrets or links.
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise ValueError("Use a pinned Git commit.")
    if run(
        [
            "git",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-C",
            str(source),
            "status",
            "--porcelain",
            "--untracked-files=all",
        ]
    ).stdout.strip():
        raise ValueError(
            "The source checkout has local changes. Install a clean reviewed commit."
        )
    stage = ROOT / "source"
    if stage.exists():
        if (
            not (stage / ".nsoft-source-complete").exists()
            or (stage / ".nsoft-source-complete").read_text() != revision
        ):
            raise ValueError(
                "The staged source is incomplete or belongs to another revision. Request administrator recovery."
            )
        return stage
    archive = subprocess.run(
        [
            "git",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-C",
            str(source),
            "archive",
            "--format=tar",
            revision,
        ],
        check=True,
        capture_output=True,
    ).stdout
    temporary = pathlib.Path(tempfile.mkdtemp(prefix="source-", dir=ROOT))
    try:
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for member in tar.getmembers():
                if (
                    not (member.isfile() or member.isdir())
                    or member.name.startswith("/")
                    or ".." in pathlib.PurePosixPath(member.name).parts
                ):
                    raise ValueError(
                        "The source contains unsupported links or unsafe files."
                    )
            tar.extractall(temporary, filter="data")
        atomic(temporary / ".nsoft-source-complete", revision)
        temporary.rename(stage)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return stage


def verify_source(stage):
    for original in stage.rglob("*"):
        if not original.is_file():
            continue
        installed = APP / original.relative_to(stage)
        if (
            installed.is_symlink()
            or not installed.is_file()
            or hashlib.sha256(original.read_bytes()).digest()
            != hashlib.sha256(installed.read_bytes()).digest()
        ):
            raise ValueError(
                "A build changed reviewed source files. Installation stopped before starting privileged services."
            )


def restore_privileged_sources(stage):
    # Build outputs may include valid-looking Python bytecode or extra config modules.
    # Only the immutable reviewed archive supplies code/configuration later used by root.
    for name in ("installer", "docker", "scripts"):
        destination = APP / name
        if destination.is_symlink():
            raise ValueError(
                "A build replaced a privileged source directory with a link."
            )
        shutil.rmtree(destination)
        shutil.copytree(stage / name, destination)
