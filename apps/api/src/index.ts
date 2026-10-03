// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import 'dotenv/config';
import pino from 'pino';
import { PrismaClient } from '@nsoft/database';
import { envSchema } from '@nsoft/core';
import { createApp } from './app.js';
const env = envSchema.parse(process.env);
if (
  env.NODE_ENV === 'production' &&
  (new URL(env.WEB_URL).protocol !== 'https:' || env.REQUIRE_MFA !== 'true')
)
  throw new Error('Production requires HTTPS and administrator MFA.');
const db = new PrismaClient(),
  logger = pino();
const app = createApp(db, env);
const server = app.listen(env.PORT, '0.0.0.0', () =>
  logger.info({ port: env.PORT }, 'api started'),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => server.close(() => void db.$disconnect()));
