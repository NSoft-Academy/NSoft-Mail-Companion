FROM debian:bookworm-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postfix postfix-pgsql libsasl2-modules dovecot-core dovecot-imapd dovecot-lmtpd dovecot-pgsql dovecot-sieve dovecot-managesieved supervisor ca-certificates openssl python3 && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 5000 vmail && useradd -u 5000 -g vmail -d /var/vmail -s /usr/sbin/nologin vmail
COPY docker/mail/ /opt/nsoft/
RUN chmod +x /opt/nsoft/start.sh && sievec /opt/nsoft/spam.sieve
EXPOSE 25 465 587 993
ENTRYPOINT ["/opt/nsoft/start.sh"]
