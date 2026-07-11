'use strict';
const express = require('express');
const auth = require('../auth');
const backup = require('../services/backupService');
const closing = require('../services/closingService');
const { h, ip } = require('./helpers');

const router = express.Router();
const isAdmin = auth.requireRole('admin');
const canClose = auth.requireRole('admin', 'bendahara', 'pengurus_yayasan');
const canReopen = auth.requireRole('admin', 'pengurus_yayasan');
const withIp = (req) => Object.assign(req.user, { ip: ip(req) });

// ---- Backup database ----
router.get('/backups', isAdmin, h(() => backup.listBackups()));
router.post('/backups', isAdmin, async (req, res) => {
  try { res.json(await backup.backupNow(withIp(req), 'manual')); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.get('/backups/:name/download', isAdmin, (req, res) => {
  try { res.download(backup.backupPath(req.params.name), req.params.name); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---- Tutup buku tahunan ----
router.get('/closing', h(async (req) => ({
  tahun: +req.query.tahun || new Date().getFullYear(),
  units: await closing.preview(+req.query.tahun || new Date().getFullYear()),
})));
router.post('/closing/run', canClose, h((req) => closing.closeYear(withIp(req), +req.body.tahun)));
router.post('/closing/reopen', canReopen, h((req) => closing.reopenYear(withIp(req), +req.body.tahun)));

module.exports = router;
