'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const svc = require('../services/piutangService');
const { h, ip } = require('./helpers');

const router = express.Router();
const canStudentMaster = auth.requireRole('admin', 'staf_akuntansi');
const canBilling = auth.requireRole('admin', 'staf_akuntansi', 'bendahara');
const canPay = auth.requireRole('admin', 'staf_akuntansi', 'kasir', 'bendahara');
const canProcess = auth.requireRole('admin', 'staf_akuntansi', 'bendahara');
const withIp = (req) => Object.assign(req.user, { ip: ip(req) });

async function unitIdFromKode(kode) {
  if (!kode || kode === 'all') return null;
  const u = await db.prepare('SELECT id FROM units WHERE kode=?').get(kode);
  return u ? u.id : null;
}

// ---- Mahasiswa ----
router.get('/students', h(async (req) => svc.listStudents(await unitIdFromKode(req.query.unit), req.query.q)));
router.post('/students', canStudentMaster, h((req) => svc.createStudent(withIp(req), req.body || {})));
router.put('/students/:id', canStudentMaster, h((req) => svc.updateStudent(withIp(req), +req.params.id, req.body || {})));
router.post('/students/import', canStudentMaster, h((req) => svc.importStudents(withIp(req), req.body || {})));

// ---- Tagihan ----
router.get('/invoices', h(async (req) => svc.listInvoices({
  unitId: await unitIdFromKode(req.query.unit), semester: req.query.semester, status: req.query.status })));
router.get('/invoices/:id', h((req) => svc.getInvoice(+req.params.id)));
router.post('/invoices', canBilling, h((req) => svc.createInvoice(withIp(req), req.body || {})));
router.post('/invoices/generate', canBilling, h((req) => svc.generateInvoices(withIp(req), req.body || {})));

// ---- Pembayaran ----
router.post('/payments', canPay, h((req) => svc.recordPayment(withIp(req), req.body || {})));

// ---- Keringanan UKT (potongan & beasiswa) ----
router.post('/reliefs', canBilling, h((req) => svc.recordRelief(withIp(req), req.body || {})));

// ---- Aging & CKPN ----
router.get('/aging', h(async (req) => svc.aging({ unitId: await unitIdFromKode(req.query.unit), asOf: req.query.asof })));
router.get('/ckpn/rates', h(() => svc.listCkpnRates()));
router.put('/ckpn/rates/:key', canStudentMaster, h((req) => svc.updateCkpnRate(withIp(req), req.params.key, (req.body || {}).rate_persen)));
router.post('/ckpn/run', canProcess, h((req) => svc.runCkpn(withIp(req), (req.body || {}).tanggal)));

// ---- Amortisasi pendapatan (PSAK 72) ----
router.get('/amortisasi/preview', h(async (req) => svc.amortisasiPreview(+req.query.tahun, +req.query.bulan,
  await unitIdFromKode(req.query.unit))));
router.post('/amortisasi/run', canProcess, h((req) => {
  const { tahun, bulan } = req.body || {};
  if (!tahun || !bulan) { const e = new Error('tahun & bulan wajib diisi.'); e.status = 400; throw e; }
  return svc.runAmortisasi(withIp(req), +tahun, +bulan);
}));

module.exports = router;
