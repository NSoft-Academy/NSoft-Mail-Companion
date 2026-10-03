#!/usr/bin/env python3
# Copyright © 2026 M Suthakaran, trading as NSoft Academy.
# Licensed under the Apache License, Version 2.0.
import pathlib,secrets,os
path=pathlib.Path('.env')
if path.exists():raise SystemExit('.env already exists; refusing to replace secrets.')
text=pathlib.Path('.env.example').read_text()
for placeholder in ['REPLACE_BOOTSTRAP_SECRET','REPLACE_MIGRATION_SECRET','REPLACE_APP_SECRET','REPLACE_MAIL_SECRET','REPLACE_ROUNDCUBE_SECRET','REPLACE_ENCRYPTION_SECRET']:
 text=text.replace(placeholder,secrets.token_hex(32))
text=text.replace('REPLACE_WITH_24_RANDOM_CHARACTERS',secrets.token_hex(12))
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as file:file.write(text)
print('Generated .env with mode 0600. Edit hostnames, IP, panel URL, and ACME contact before deployment.')
