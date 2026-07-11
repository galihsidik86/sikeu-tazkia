'use strict';
const path = require('path');
require('dotenv').config();

const ROOT = path.resolve(__dirname, '..');

const config = {
  root: ROOT,
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',
  sessionSecret: process.env.SESSION_SECRET || 'sikeu-dev-secret-ganti-di-produksi',
  // PostgreSQL (backend produksi multi-user)
  databaseUrl: process.env.DATABASE_URL || 'postgres://sikeu:sikeu@127.0.0.1:5432/sikeu',
  isProd: process.env.NODE_ENV === 'production',
};

module.exports = config;
