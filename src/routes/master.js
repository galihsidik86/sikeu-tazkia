'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const audit = require('../services/audit');
const { h, ip } = require('./helpers');

const router = express.Router();
const canMaster = auth.requireRole(...auth.MASTER_ROLES);
const canPeriod = auth.requireRole(...auth.PERIOD_ROLES);
const isAdmin = auth.requireRole('admin');

// ======================= UNITS =======================
router.get('/units', h(() => db.prepare('SELECT * FROM units ORDER BY id').all()));

router.post('/units', canMaster, h(async (req) => {
  const { kode, nama, is_yayasan } = req.body || {};
  if (!kode || !nama) throw err(400, 'Kode dan nama unit wajib diisi.');
  try {
    const info = await db.prepare('INSERT INTO units (kode, nama, is_yayasan) VALUES (?,?,?)')
      .run(String(kode).trim().toUpperCase(), String(nama).trim(), is_yayasan ? 1 : 0);
    await audit.log(req.user, 'create', 'unit', info.lastInsertRowid, { kode, nama }, ip(req));
    return db.prepare('SELECT * FROM units WHERE id=?').get(info.lastInsertRowid);
  } catch (e) { throw dupErr(e, 'Kode unit sudah dipakai.'); }
}));

router.put('/units/:id', canMaster, h(async (req) => {
  const u = await db.prepare('SELECT * FROM units WHERE id=?').get(req.params.id);
  if (!u) throw err(404, 'Unit tidak ditemukan.');
  const { nama, aktif } = req.body || {};
  await db.prepare('UPDATE units SET nama=?, aktif=? WHERE id=?')
    .run(nama != null ? nama : u.nama, aktif != null ? (aktif ? 1 : 0) : u.aktif, u.id);
  await audit.log(req.user, 'update', 'unit', u.id, req.body, ip(req));
  return db.prepare('SELECT * FROM units WHERE id=?').get(u.id);
}));

// ======================= ACCOUNTS / COA =======================
router.get('/accounts', h(() => db.prepare('SELECT * FROM accounts ORDER BY kode').all()));

router.get('/accounts/tree', h(async () => {
  const all = await db.prepare('SELECT * FROM accounts ORDER BY kode').all();
  const byId = new Map(all.map(a => [a.id, { ...a, children: [] }]));
  const roots = [];
  for (const a of byId.values()) {
    if (a.parent_id && byId.has(a.parent_id)) byId.get(a.parent_id).children.push(a);
    else roots.push(a);
  }
  return roots;
}));

router.post('/accounts', canMaster, h(async (req) => {
  const b = req.body || {};
  if (!b.kode || !b.nama) throw err(400, 'Kode dan nama akun wajib diisi.');
  if (!['aset', 'liabilitas', 'aset_neto', 'pendapatan', 'beban'].includes(b.tipe)) throw err(400, 'Tipe akun tidak valid.');
  if (!['D', 'K'].includes(b.normal_balance)) throw err(400, 'Saldo normal harus D atau K.');
  try {
    const info = await db.prepare(`INSERT INTO accounts
      (kode, nama, tipe, parent_id, is_postable, normal_balance, is_interunit, is_kontra, net_asset_class)
      VALUES (@kode,@nama,@tipe,@parent_id,@is_postable,@normal_balance,@is_interunit,@is_kontra,@net_asset_class)`)
      .run({
        kode: String(b.kode).trim(), nama: String(b.nama).trim(), tipe: b.tipe, parent_id: b.parent_id || null,
        is_postable: b.is_postable === false ? 0 : 1, normal_balance: b.normal_balance,
        is_interunit: b.is_interunit ? 1 : 0, is_kontra: b.is_kontra ? 1 : 0, net_asset_class: b.net_asset_class || null,
      });
    await audit.log(req.user, 'create', 'account', info.lastInsertRowid, { kode: b.kode }, ip(req));
    return db.prepare('SELECT * FROM accounts WHERE id=?').get(info.lastInsertRowid);
  } catch (e) { throw dupErr(e, 'Kode akun sudah dipakai.'); }
}));

router.put('/accounts/:id', canMaster, h(async (req) => {
  const a = await db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id);
  if (!a) throw err(404, 'Akun tidak ditemukan.');
  const b = req.body || {};
  const hasLines = await db.prepare('SELECT 1 FROM journal_lines WHERE account_id=? LIMIT 1').get(a.id);
  const kode = hasLines ? a.kode : (b.kode || a.kode);
  const tipe = hasLines ? a.tipe : (b.tipe || a.tipe);
  await db.prepare(`UPDATE accounts SET kode=?, nama=?, tipe=?, is_interunit=?, is_kontra=?, net_asset_class=?, aktif=? WHERE id=?`).run(
    kode, b.nama != null ? b.nama : a.nama, tipe,
    b.is_interunit != null ? (b.is_interunit ? 1 : 0) : a.is_interunit,
    b.is_kontra != null ? (b.is_kontra ? 1 : 0) : a.is_kontra,
    b.net_asset_class !== undefined ? (b.net_asset_class || null) : a.net_asset_class,
    b.aktif != null ? (b.aktif ? 1 : 0) : a.aktif, a.id);
  await audit.log(req.user, 'update', 'account', a.id, b, ip(req));
  return db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id);
}));

// ======================= PERIODS =======================
router.get('/periods', h(() => db.prepare(`
  SELECT p.*, u.nama AS closed_by_nama FROM periods p LEFT JOIN users u ON u.id = p.closed_by
  ORDER BY p.tahun DESC, p.bulan DESC`).all()));

router.post('/periods', canPeriod, h(async (req) => {
  const { tahun, bulan } = req.body || {};
  if (!tahun || !bulan || bulan < 1 || bulan > 12) throw err(400, 'Tahun/bulan tidak valid.');
  if (await db.prepare('SELECT * FROM periods WHERE tahun=? AND bulan=?').get(tahun, bulan)) throw err(409, 'Periode sudah ada.');
  const info = await db.prepare("INSERT INTO periods (tahun,bulan,status) VALUES (?,?,'open')").run(tahun, bulan);
  await audit.log(req.user, 'create', 'period', info.lastInsertRowid, { tahun, bulan }, ip(req));
  return db.prepare('SELECT * FROM periods WHERE id=?').get(info.lastInsertRowid);
}));

router.post('/periods/:id/close', canPeriod, h(async (req) => {
  const p = await db.prepare('SELECT * FROM periods WHERE id=?').get(req.params.id);
  if (!p) throw err(404, 'Periode tidak ditemukan.');
  if (p.status === 'closed') throw err(409, 'Periode sudah tertutup.');
  const open = (await db.prepare("SELECT COUNT(*) n FROM journals WHERE period_id=? AND status IN ('draft','pending')").get(p.id)).n;
  if (open > 0) throw err(409, `Masih ada ${open} jurnal draft/pending pada periode ini. Selesaikan dahulu.`);
  await db.prepare("UPDATE periods SET status='closed', closed_by=?, closed_at=datetime('now') WHERE id=?").run(req.user.id, p.id);
  await audit.log(req.user, 'close_period', 'period', p.id, { tahun: p.tahun, bulan: p.bulan }, ip(req));
  return db.prepare('SELECT * FROM periods WHERE id=?').get(p.id);
}));

router.post('/periods/:id/reopen', canPeriod, h(async (req) => {
  const p = await db.prepare('SELECT * FROM periods WHERE id=?').get(req.params.id);
  if (!p) throw err(404, 'Periode tidak ditemukan.');
  await db.prepare("UPDATE periods SET status='open', closed_by=NULL, closed_at=NULL WHERE id=?").run(p.id);
  await audit.log(req.user, 'reopen_period', 'period', p.id, { tahun: p.tahun, bulan: p.bulan }, ip(req));
  return db.prepare('SELECT * FROM periods WHERE id=?').get(p.id);
}));

// ======================= USERS =======================
router.get('/users', canMaster, h(() => db.prepare(`
  SELECT u.id,u.nama,u.email,u.role,u.unit_id,u.aktif,un.nama AS unit_nama
  FROM users u LEFT JOIN units un ON un.id=u.unit_id ORDER BY u.id`).all()));

router.post('/users', isAdmin, h(async (req) => {
  const b = req.body || {};
  if (!b.nama || !b.email || !b.password) throw err(400, 'Nama, email, dan kata sandi wajib diisi.');
  if (!auth.ROLES[b.role]) throw err(400, 'Peran tidak valid.');
  try {
    const info = await db.prepare(`INSERT INTO users (nama,email,password_hash,role,unit_id,aktif) VALUES (?,?,?,?,?,1)`)
      .run(b.nama.trim(), b.email.trim(), auth.hashPassword(b.password), b.role, b.unit_id || null);
    await audit.log(req.user, 'create', 'user', info.lastInsertRowid, { email: b.email, role: b.role }, ip(req));
    return auth.getUser(info.lastInsertRowid);
  } catch (e) { throw dupErr(e, 'Email sudah terdaftar.'); }
}));

router.put('/users/:id', isAdmin, h(async (req) => {
  const u = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) throw err(404, 'Pengguna tidak ditemukan.');
  const b = req.body || {};
  if (b.role && !auth.ROLES[b.role]) throw err(400, 'Peran tidak valid.');
  await db.prepare('UPDATE users SET nama=?, role=?, unit_id=?, aktif=? WHERE id=?').run(
    b.nama != null ? b.nama : u.nama, b.role || u.role,
    b.unit_id !== undefined ? (b.unit_id || null) : u.unit_id,
    b.aktif != null ? (b.aktif ? 1 : 0) : u.aktif, u.id);
  if (b.password) await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(auth.hashPassword(b.password), u.id);
  await audit.log(req.user, 'update', 'user', u.id, { role: b.role, aktif: b.aktif }, ip(req));
  return auth.getUser(u.id);
}));

function err(status, msg) { const e = new Error(msg); e.status = status; return e; }
function dupErr(e, msg) { if (e.code === '23505' || /unique|duplicate/i.test(String(e.message))) return err(409, msg); return e; }

module.exports = router;
