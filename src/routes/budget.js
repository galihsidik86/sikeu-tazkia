'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const svc = require('../services/budgetService');
const { h, ip } = require('./helpers');

const router = express.Router();
// Penyusunan RKAT: admin, staf, bendahara. Pengesahan: pengurus_yayasan, admin.
const canEdit = auth.requireRole('admin', 'staf_akuntansi', 'bendahara');
const canApproveRkat = auth.requireRole('admin', 'pengurus_yayasan');
const withIp = (req) => Object.assign(req.user, { ip: ip(req) });

async function unitIdFromKode(kode) {
  if (!kode || kode === 'all') return null;
  const u = await db.prepare('SELECT id FROM units WHERE kode=?').get(kode);
  return u ? u.id : null;
}

// Laporan RKAT & realisasi
router.get('/', h(async (req) => svc.listRkat(+req.query.tahun || new Date().getFullYear(),
  await unitIdFromKode(req.query.unit))));

// Penyusunan
router.post('/line', canEdit, h((req) => svc.upsertLine(withIp(req), req.body || {})));
router.delete('/line/:id', canEdit, h((req) => svc.deleteLine(withIp(req), +req.params.id)));

// Alur status
router.post('/submit', canEdit, h((req) => svc.submit(withIp(req), +req.body.tahun, +req.body.unit_id)));
router.post('/approve', canApproveRkat, h((req) => svc.approve(withIp(req), +req.body.tahun, +req.body.unit_id)));
router.post('/reopen', canApproveRkat, h((req) => svc.reopen(withIp(req), +req.body.tahun, +req.body.unit_id)));

module.exports = router;
