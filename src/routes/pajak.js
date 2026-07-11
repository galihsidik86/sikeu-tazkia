'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const svc = require('../services/taxService');
const { h, ip } = require('./helpers');

const router = express.Router();
const canRecord = auth.requireRole('admin', 'staf_akuntansi', 'kasir', 'bendahara');
const canSetor = auth.requireRole('admin', 'staf_akuntansi', 'bendahara');
const canRate = auth.requireRole('admin', 'staf_akuntansi');
const withIp = (req) => Object.assign(req.user, { ip: ip(req) });

async function unitIdFromKode(kode) {
  if (!kode || kode === 'all') return null;
  const u = await db.prepare('SELECT id FROM units WHERE kode=?').get(kode);
  return u ? u.id : null;
}

// Tarif
router.get('/rates', h(() => svc.listRates()));
router.post('/rates', canRate, h((req) => svc.upsertRate(withIp(req), req.body || {})));
router.put('/rates/:id', canRate, h((req) => svc.upsertRate(withIp(req), { ...req.body, id: +req.params.id })));

// Pemotongan / bukti potong
router.get('/withholdings', h(async (req) => svc.listWithholdings({
  jenis: req.query.jenis, unitId: await unitIdFromKode(req.query.unit), status: req.query.status,
  from: req.query.from, to: req.query.to })));
router.get('/withholdings/:id', h((req) => svc.getWithholding(+req.params.id)));
router.post('/withholdings', canRecord, h((req) => svc.recordWithholding(withIp(req), req.body || {})));

// Rekap masa & setor
router.get('/recap', h((req) => svc.recap(+req.query.tahun || new Date().getFullYear(), +req.query.bulan || 1)));
router.post('/setor', canSetor, h((req) => svc.setor(withIp(req), req.body || {})));

module.exports = router;
