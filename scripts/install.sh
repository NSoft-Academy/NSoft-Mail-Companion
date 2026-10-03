#!/bin/bash
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
set -euo pipefail
if [ "${EUID}" -ne 0 ]; then echo 'Run this installer with sudo on the intended Ubuntu server.' >&2; exit 1; fi
installer_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../installer" && pwd)
exec python3 "$installer_directory/install.py" "$@"
