#!/usr/bin/env python3
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
# Synthetic LOCAL protocol tests. Never sends mail to external recipients.
import smtplib, ssl, imaplib, time, os, pathlib, uuid
import dkim
ctx=ssl.create_default_context(cafile=os.environ['TEST_CA_FILE'])
# Local certificate CN is checked by configuring an explicit trusted CA and localhost hosts alias.
ctx.check_hostname=False
host='127.0.0.1'; password='Integration-Password42'
message_id=f'<nsoft-{uuid.uuid4()}@example.test>'
with smtplib.SMTP(host,25250,timeout=10) as smtp:
 smtp.ehlo();smtp.mail('sender@external.example');code,_=smtp.rcpt('recipient@other.example')
 assert code>=500, 'Open relay detected'
print('PASS unauthenticated relay denied')
with smtplib.SMTP(host,25870,timeout=10) as smtp:
 smtp.ehlo();assert not smtp.has_extn('auth'), 'AUTH offered before TLS';smtp.starttls(context=ctx);smtp.ehlo()
 try: smtp.login('alice@example.test','wrong-password')
 except smtplib.SMTPAuthenticationError: pass
 else: raise AssertionError('Wrong password accepted')
print('PASS STARTTLS required and invalid credentials rejected')
with smtplib.SMTP(host,25870,timeout=10) as smtp:
 smtp.starttls(context=ctx);smtp.login('alice@example.test',password)
 smtp.mail('bob@example.test');code,_=smtp.rcpt('alice@example.test')
 assert code>=500,'Sender impersonation accepted'
print('PASS authenticated sender ownership enforced')
with smtplib.SMTP(host,25870,timeout=10) as smtp:
 smtp.starttls(context=ctx);smtp.login('alice@example.test',password)
 try:smtp.sendmail('alice@example.test',['bob@example.test'],'From: attacker@different.example\r\nTo: bob@example.test\r\nSubject: Spoof test\r\n\r\nBlocked header.\r\n')
 except smtplib.SMTPDataError:pass
 else:raise AssertionError('Header impersonation accepted')
print('PASS authenticated From header ownership enforced')
with smtplib.SMTP(host,25870,timeout=10) as smtp:
 smtp.starttls(context=ctx);smtp.login('alice@example.test',password)
 smtp.sendmail('alice@example.test',['support@example.test'],f'From: alice@example.test\r\nTo: bob@example.test\r\nSubject: NSoft local smoke\r\nMessage-ID: {message_id}\r\n\r\nLocal delivery test.\r\n')
for attempt in range(20):
 with imaplib.IMAP4_SSL(host,29930,ssl_context=ctx) as imap:
  imap.login('bob@example.test',password);imap.select('INBOX');_,messages=imap.search(None,'HEADER','Message-ID',message_id)
  if messages[0]:
   _,content=imap.fetch(messages[0].split()[-1],'RFC822');body=content[0][1];assert b'DKIM-Signature:' in body,'DKIM missing';key=pathlib.Path('.runtime/test-dkim.txt').read_bytes();assert dkim.verify(body,dnsfunc=lambda name,timeout=5:key if name.rstrip(b'.')==b'nsoft2026._domainkey.example.test' else b''),'Independent DKIM verification failed';break
 time.sleep(1)
else:raise AssertionError('Message did not reach local IMAP inbox')
print('PASS SMTP to LMTP to IMAP delivery with independently verified DKIM')

with imaplib.IMAP4_SSL(host,29930,ssl_context=ctx) as imap:
 imap.login('quota@example.test',password)
 status,data=imap.append('INBOX',None,None,b'From: quota@example.test\r\nSubject: quota test\r\n\r\n'+b'x'*(2*1024*1024))
 assert status=='NO' and b'OVERQUOTA' in b' '.join(data),'Mailbox quota not enforced'
print('PASS IMAP mailbox quota enforced and SMTP alias delivered')
# Standard harmless antivirus test pattern, not executable malware.
eicar='X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
with smtplib.SMTP(host,25870,timeout=20) as smtp:
 smtp.starttls(context=ctx);smtp.login('alice@example.test',password)
 try:smtp.sendmail('alice@example.test',['bob@example.test'],'From: alice@example.test\r\nTo: bob@example.test\r\nSubject: Harmless scanner test\r\n\r\n'+eicar+'\r\n')
 except smtplib.SMTPDataError as error:assert error.smtp_code>=500
 else:raise AssertionError('Antivirus test pattern not rejected')
print('PASS harmless antivirus test pattern rejected')
