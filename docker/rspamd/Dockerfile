FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends rspamd ca-certificates && rm -rf /var/lib/apt/lists/* && usermod -u 1000 _rspamd && groupmod -g 1000 _rspamd
COPY docker/rspamd/local.d/ /etc/rspamd/local.d/
COPY docker/rspamd/nsoft.lua /etc/rspamd/rspamd.local.lua
CMD ["rspamd","-f","-u","_rspamd","-g","_rspamd"]
