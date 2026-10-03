# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import pathlib, hashlib, time, subprocess, json, os
last=''
while True:
 try:
  fingerprint=hashlib.sha256(pathlib.Path('/data/tls/fullchain.pem').read_bytes()+pathlib.Path('/data/tls/privkey.pem').read_bytes()).hexdigest()
  cert_key=subprocess.run(['openssl','x509','-in','/data/tls/fullchain.pem','-pubkey','-noout'],capture_output=True,check=True).stdout
  private_key=subprocess.run(['openssl','pkey','-in','/data/tls/privkey.pem','-pubout'],capture_output=True,check=True).stdout
  if cert_key!=private_key: raise ValueError('Certificate/key pair incomplete')
  if last and last!=fingerprint:
   subprocess.run(['postfix','reload'],check=True)
   subprocess.run(['doveadm','reload'],check=True)
  last=fingerprint
  result=subprocess.run(['doveadm','-f','json','quota','get','-A'],capture_output=True,text=True,timeout=25)
  if result.returncode==0:
   temporary=pathlib.Path('/data/usage/usage.tmp');temporary.write_text(result.stdout);os.replace(temporary,'/data/usage/usage.json')
  result=subprocess.run(['postqueue','-j'],capture_output=True,text=True,timeout=10)
  messages=[json.loads(line) for line in result.stdout.splitlines() if line]
  pathlib.Path('/data/usage/health.json').write_text(json.dumps({'queueDepth':len(messages),'oldestAgeSeconds':max([time.time()-m.get('arrival_time',time.time()) for m in messages],default=0),'timestamp':time.time()}))
 except Exception:
  print('Mail maintenance failed; inspect service health.',flush=True)
 time.sleep(max(1, int(os.environ.get('MAINTENANCE_INTERVAL_SECONDS','60'))))
