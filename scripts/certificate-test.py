#!/usr/bin/env python3
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import subprocess,ssl,socket,time,hashlib
compose=['docker','compose','-f','compose.test.yaml']
def fingerprint():
 ctx=ssl._create_unverified_context()
 with ctx.wrap_socket(socket.socket(),server_hostname='mail.example.test') as sock:
  sock.settimeout(5);sock.connect(('127.0.0.1',29930));return hashlib.sha256(sock.getpeercert(binary_form=True)).hexdigest()
old=fingerprint()
# Generate a replacement only in the synthetic test volume; no production certificate is touched.
subprocess.run(compose+['run','--rm','--entrypoint','sh','certificates','-c','openssl req -x509 -newkey rsa:2048 -nodes -keyout /data/tls/privkey.next.pem -out /data/tls/fullchain.next.pem -days 2 -subj /CN=mail.example.test -addext subjectAltName=DNS:mail.example.test,DNS:webmail.example.test 2>/dev/null; chmod 600 /data/tls/privkey.next.pem; chmod 644 /data/tls/fullchain.next.pem; mv /data/tls/privkey.next.pem /data/tls/privkey.pem; mv /data/tls/fullchain.next.pem /data/tls/fullchain.pem'],check=True)
for attempt in range(20):
 try:
  if fingerprint()!=old:print('PASS Dovecot reloads replaced TLS certificate without recreation');break
 except OSError:pass
 time.sleep(1)
else:raise AssertionError('Certificate replacement was not reloaded')
# Reload the test gateway so its HTTPS certificate also follows this synthetic renewal.
subprocess.run(compose+['exec','-T','gateway','nginx','-s','reload'],check=True)
