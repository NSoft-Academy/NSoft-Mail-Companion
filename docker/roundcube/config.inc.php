<?php
// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
// This container is private; gateway overwrites the scheme header.
if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') { $_SERVER['HTTPS'] = 'on'; }
$config['product_name'] = 'NSoft Mail Companion';
$config['imap_host'] = 'ssl://mail:993';
$config['smtp_host'] = 'tls://mail:587';
$config['smtp_user'] = '%u';
$config['smtp_pass'] = '%p';
$config['imap_conn_options'] = ['ssl' => ['verify_peer'=>true, 'verify_peer_name'=>true, 'peer_name'=>getenv('MAIL_HOSTNAME')]];
$config['smtp_conn_options'] = ['ssl' => ['verify_peer'=>true, 'verify_peer_name'=>true, 'peer_name'=>getenv('MAIL_HOSTNAME')]];
$config['force_https'] = true;
$config['session_domain'] = '';
$config['session_lifetime'] = 15;
$config['login_autocomplete'] = 0;
$config['plugins'] = ['archive', 'zipdownload', 'managesieve'];
$config['managesieve_host'] = 'tls://mail';
$config['managesieve_port'] = 4190;
$config['managesieve_conn_options'] = ['ssl' => ['verify_peer'=>true, 'verify_peer_name'=>true, 'peer_name'=>getenv('MAIL_HOSTNAME')]];
