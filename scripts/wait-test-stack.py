#!/usr/bin/env python3
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
# Wait only for synthetic loopback services; never targets a production server.
import socket, smtplib, time, http.client, subprocess
for attempt in range(120):
    try:
        with smtplib.SMTP('127.0.0.1', 25870, timeout=2) as smtp:
            smtp.ehlo()
            assert smtp.has_extn('starttls')
        with socket.create_connection(('127.0.0.1', 29930), timeout=2): pass
        connection = http.client.HTTPConnection('127.0.0.1', 38080, timeout=2)
        connection.request('GET', '/', headers={'Host': 'webmail.example.test'})
        assert connection.getresponse().status < 500
        connection.close()
        result = subprocess.run(['docker','compose','-f','compose.test.yaml','exec','-T','clamav','clamdscan','--ping=1'], capture_output=True, timeout=5)
        assert result.returncode == 0
        print('PASS synthetic SMTP, IMAP, gateway and malware scanner ready')
        break
    except (OSError, AssertionError, subprocess.TimeoutExpired): time.sleep(1)
else: raise SystemExit('Synthetic stack did not become ready within 120 attempts')
