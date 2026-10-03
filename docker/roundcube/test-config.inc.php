<?php
// Synthetic local tests only; production continues to require trusted TLS.
$config['imap_conn_options']['ssl']['cafile'] = '/data/tls/fullchain.pem';
$config['smtp_conn_options']['ssl']['cafile'] = '/data/tls/fullchain.pem';
$config['managesieve_conn_options']['ssl']['cafile'] = '/data/tls/fullchain.pem';
