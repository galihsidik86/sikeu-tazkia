'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const cash = require('../services/cashService');
const recon = require('../services/reconcileService');
const audit = require('../services/audit');
const { h, ip } = require('./helpers');

const router = express.Router();
const CASH_ROLES = ['kasir', 'staf_akuntansi', 'bendahara', 'admin'];
const RECON_ROLES = ['staf_akuntansi', 'bendahara', 'admin'];
const canCash = auth.requireRole(...CASH_ROLES);
const canRecon = auth.requireRole(...RECON_ROLES);
const canMaster = auth.requireRole(...auth.MASTER_ROLES);

async function unitIdFromKode(kode) {
  if (!kode || kode === 'all') return null;
  const u = await db.prepare('SELECT id FROM units WHERE kode=?').get(kode);
  return u ? u.id : null;
}
const withIp = (req) => Object.assign(req.user, { ip: ip(req) });

// ---- Rekening kas/bank ----
router.get('/bank-accounts', h(async (req) => cash.listBankAccounts(await unitIdFromKode(req.query.unit))));

router.post('/bank-accounts', canMaster, h(async (req) => {
  const b = req.body || {};
  if (!b.nama || !b.account_id || !b.unit_id) throw errr(400, 'Nama, akun buku besar, dan unit wajib diisi.');
  const acc = await db.prepare('SELECT * FROM accounts WHERE id=?').get(b.account_id);
  if (!acc || !acc.is_postable) throw errr(400, 'Akun buku besar tidak valid (harus postable).');
  const info = await db.prepare(`INSERT INTO bank_accounts (nama,bank,no_rekening,account_id,unit_id) VALUES (?,?,?,?,?)`)
    .run(b.nama.trim(), b.bank || null, b.no_rekening || null, b.account_id, b.unit_id);
  await audit.log(req.user, 'create', 'bank_account', info.lastInsertRowid, { nama: b.nama }, ip(req));
  return db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(info.lastInsertRowid);
}));

// ---- Mapping kategori kas (dikelola admin/staf) ----
router.get('/categories', h((req) => cash.listCategories(req.query.jenis)));
router.post('/categories', canMaster, h((req) => cash.upsertCategory(withIp(req), req.body || {})));
router.put('/categories/:id', canMaster, h((req) => cash.upsertCategory(withIp(req), { ...req.body, id: +req.params.id })));
router.delete('/categories/:id', canMaster, h((req) => cash.deleteCategory(withIp(req), +req.params.id)));

// ---- Penerimaan / pengeluaran (auto-jurnal, berstatus PENDING → disetujui bendahara) ----
router.post('/receipt', canCash, h((req) => cash.createReceipt(req.user, { ...req.body, ip: ip(req) })));
router.post('/payment', canCash, h((req) => cash.createPayment(req.user, { ...req.body, ip: ip(req) })));

router.get('/transactions', h(async (req) =>
  cash.listCashTransactions(await unitIdFromKode(req.query.unit), req.query.bank_account_id ? +req.query.bank_account_id : null)));

// ---- Rekonsiliasi ----
router.post('/reconcile/parse-headers', canRecon, h((req) => {
  if (!req.body || !req.body.csv) throw errr(400, 'csv wajib diisi.');
  return recon.parseHeaders(req.body.csv);
}));
router.post('/reconcile/import', canRecon, h((req) => {
  const { bank_account_id, csv, replace, mapping } = req.body || {};
  if (!bank_account_id || !csv) throw errr(400, 'bank_account_id dan csv wajib diisi.');
  return recon.importStatements(withIp(req), +bank_account_id, csv, !!replace, mapping);
}));
router.get('/reconcile/:id', h((req) => recon.getReconciliation(+req.params.id)));
router.post('/reconcile/:id/automatch', canRecon, h(async (req) => ({ matched: await recon.autoMatch(+req.params.id) })));
router.post('/reconcile/:id/match', canRecon, h((req) =>
  recon.manualMatch(withIp(req), +req.params.id, +req.body.statement_id, +req.body.journal_line_id)));
router.post('/reconcile/:id/unmatch', canRecon, h((req) =>
  recon.unmatch(withIp(req), +req.params.id, +req.body.statement_id)));
router.delete('/reconcile/:id', canRecon, h((req) => recon.clearStatements(withIp(req), +req.params.id)));

function errr(s, m) { const e = new Error(m); e.status = s; return e; }
module.exports = router;
