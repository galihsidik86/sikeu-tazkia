'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const svc = require('../services/journalService');
const { h, ip } = require('./helpers');

const router = express.Router();
const canAuthor = auth.requireRole(...auth.AUTHOR_ROLES);
const canApprove = auth.requireRole(...auth.APPROVER_ROLES);

router.get('/', h(async (req) => {
  const params = {};
  let where = '1=1';
  if (req.query.unit && req.query.unit !== 'all') { where += ' AND un.kode=@unit'; params.unit = req.query.unit; }
  if (req.query.status) { where += ' AND j.status=@status'; params.status = req.query.status; }
  return db.prepare(`
    SELECT j.id, j.nomor, j.tanggal, j.deskripsi, j.status, j.sumber,
           un.kode AS unit_kode, un.nama AS unit_nama, cu.nama AS created_by_nama,
           (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE journal_id=j.id) AS total
    FROM journals j JOIN units un ON un.id=j.unit_id LEFT JOIN users cu ON cu.id=j.created_by
    WHERE ${where}
    ORDER BY (j.nomor IS NULL) DESC, j.tanggal DESC, j.id DESC`).all(params);
}));

router.get('/:id', h(async (req) => {
  const j = await svc.getJournal(+req.params.id);
  if (!j) throw status(404, 'Jurnal tidak ditemukan.');
  const unit = await db.prepare('SELECT * FROM units WHERE id=?').get(j.unit_id);
  const hist = await db.prepare(`SELECT al.action, al.ts, al.user_nama, al.role, al.detail
    FROM audit_log al WHERE al.entity='journal' AND al.entity_id=? ORDER BY al.id`).all(String(j.id));
  const namaOf = async (id) => id ? ((await db.prepare('SELECT nama FROM users WHERE id=?').get(id)) || {}).nama : null;
  const nomorOf = async (id) => id ? ((await db.prepare('SELECT nomor FROM journals WHERE id=?').get(id)) || {}).nomor : null;
  return {
    ...j, unit_nama: unit.nama, unit_kode: unit.kode,
    created_by_nama: await namaOf(j.created_by), approved_by_nama: await namaOf(j.approved_by),
    reversal_of_nomor: await nomorOf(j.reversal_of), reversed_by_nomor: await nomorOf(j.reversed_by),
    history: hist,
  };
}));

router.post('/', canAuthor, h((req) => svc.createDraft(req.user, { ...req.body, ip: ip(req) })));
router.put('/:id', canAuthor, h((req) => svc.updateDraft(req.user, +req.params.id, { ...req.body, ip: ip(req) })));
router.delete('/:id', canAuthor, h((req) => svc.deleteDraft(req.user, +req.params.id, ip(req))));
router.post('/:id/submit', canAuthor, h((req) => svc.submit(req.user, +req.params.id, ip(req))));
router.post('/:id/approve', canApprove, h((req) => svc.approve(req.user, +req.params.id, ip(req),
  (req.body && req.body.force) || req.query.force === '1')));
router.post('/:id/reject', canApprove, h((req) => svc.reject(req.user, +req.params.id, (req.body || {}).alasan, ip(req))));
router.post('/:id/reverse', canApprove, h((req) => svc.reverse(req.user, +req.params.id, ip(req))));

function status(s, m) { const e = new Error(m); e.status = s; return e; }
module.exports = router;
