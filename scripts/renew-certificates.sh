#!/bin/sh
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
set -eu
docker compose --profile certificates run --rm acme
