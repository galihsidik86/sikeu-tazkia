'use strict';
// Backup database PostgreSQL — snapshot logis (semua tabel → JSON gzip) lewat koneksi pg.
// Portabel (tak butuh biner pg_dump), cukup untuk skala yayasan. Retensi 30 hari.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('../db');
const config = require('../config');
const audit = require('./audit');

const BK_DIR = path.join(config.root, 'data', 'backups');
fs.mkdirSync(BK_DIR, { recursive: true });
const RETENTION_DAYS = 30;

function tsName() {
  const t = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `sikeu-${t}.json.gz`;
}

async function backupNow(user, reason) {
  const name = tsName();
  const tables = (await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'sessions' ORDER BY tablename", [])).rows;
  const dump = { _meta: { at: new Date().toISOString(), reason: reason || 'manual', db: 'postgres' }, data: {} };
  for (const { tablename } of tables) {
    dump.data[tablename] = (await db.query(`SELECT * FROM "${tablename}"`, [])).rows;
  }
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(dump)));
  fs.writeFileSync(path.join(BK_DIR, name), gz);
  prune();
  if (user) await audit.log(user, 'backup', 'database', name, { reason: reason || 'manual', tabel: tables.length }, user.ip);
  const s = fs.statSync(path.join(BK_DIR, name));
  return { name, size: s.size, mtime: s.mtime.toISOString(), reason: reason || 'manual' };
}

function listBackups() {
  return fs.readdirSync(BK_DIR).filter(f => /^sikeu-.*\.json\.gz$/.test(f)).map(f => {
    const s = fs.statSync(path.join(BK_DIR, f));
    return { name: f, size: s.size, mtime: s.mtime.toISOString() };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

function prune(days = RETENTION_DAYS) {
  const cutoff = Date.now() - days * 86400000;
  for (const f of listBackups()) {
    const p = path.join(BK_DIR, f.name);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p); } catch (_) {}
  }
}

function backupPath(name) {
  if (!/^sikeu-[\w.-]+\.json\.gz$/.test(name)) { const e = new Error('Nama backup tidak valid.'); e.status = 400; throw e; }
  const p = path.join(BK_DIR, name);
  if (!fs.existsSync(p)) { const e = new Error('Backup tidak ditemukan.'); e.status = 404; throw e; }
  return p;
}

function startAuto(intervalMs = 24 * 3600 * 1000) {
  backupNow(null, 'startup').catch(e => console.error('Backup gagal:', e.message));
  setInterval(() => backupNow(null, 'otomatis').catch(e => console.error('Backup gagal:', e.message)), intervalMs).unref();
}

module.exports = { backupNow, listBackups, backupPath, startAuto, BK_DIR };
