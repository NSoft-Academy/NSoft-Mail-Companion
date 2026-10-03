#!/usr/bin/env python3
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import http.client,time,json
for attempt in range(30):
 try:
  connection=http.client.HTTPConnection('127.0.0.1',3308,timeout=2)
  connection.request('GET','/api/v1/auth/me')
  response=connection.getresponse()
  assert response.status==401
  assert json.loads(response.read())['error']['code']=='UNAUTHENTICATED'
  connection.close()
  print('PASS production Docker panel rewrites API requests to the separate API container')
  break
 except (OSError,AssertionError,json.JSONDecodeError):time.sleep(1)
else:raise SystemExit('Production application Docker smoke failed')
