# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod +x /usr/sbin/policy-rc.d \
    && apt-get update -qq && apt-get install -y --no-install-recommends python3
COPY native.py common.py /tmp/installer/
RUN python3 -c 'import sys; sys.path.insert(0,"/tmp/installer"); import native; print(" ".join(native.PACKAGES))' > /tmp/packages \
    && apt-get install -y --no-install-recommends $(cat /tmp/packages) \
    && rm -rf /var/lib/apt/lists/*
