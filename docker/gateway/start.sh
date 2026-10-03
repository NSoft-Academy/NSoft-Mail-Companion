#!/bin/sh
set -eu
while [ ! -s /data/routes/hosts.map ]; do sleep 2; done
nginx -t
nginx
last=$(sha256sum /data/routes/hosts.map)
while sleep 10; do
 current=$(sha256sum /data/routes/hosts.map)
 if [ "$current" != "$last" ]; then nginx -t && nginx -s reload; last="$current"; fi
done
