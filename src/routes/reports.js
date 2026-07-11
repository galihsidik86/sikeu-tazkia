'use strict';
const express = require('express');
const db = require('../db');
const rpt = require('../services/reportService');
const fs = require('../services/financialService');
const piutang = require('../services/piutangService');
const budget = require('../services/budgetService');
const { h } = require('./helpers');

const router = express.Router();
const BULAN_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

async function unitIdFromKode(kode) {
  if (!kode || kode === 'all') return null;
  const u = await db.prepare('SELECT id FROM units WHERE kode=?').get(kode);
  return u ? u.id : null;
}

router.get('/trial-balance', h(async (req) => {
  const unitId = await unitIdFromKode(req.query.unit);
  const tahun = req.query.tahun ? +req.query.tahun : null;
  const bulan = req.query.bulan ? +req.query.bulan : null;
  const tb = await rpt.trialBalance({ unitId, tahun, bulan });
  return { ...tb, unit: req.query.unit || 'all', konsolidasi: !unitId };
}));

router.get('/ledger', h(async (req) => {
  if (!req.query.account_id) { const e = new Error('account_id wajib diisi.'); e.status = 400; throw e; }
  return rpt.ledger({
    accountId: +req.query.account_id, unitId: await unitIdFromKode(req.query.unit),
    from: req.query.from || null, to: req.query.to || null,
  });
}));

router.get('/interunit-check', h((req) => rpt.interunitCheck({
  tahun: req.query.tahun ? +req.query.tahun : null,
  bulan: req.query.bulan ? +req.query.bulan : null,
})));

router.get('/dashboard', h(async (req) => {
  const unitId = await unitIdFromKode(req.query.unit);
  const tb = await rpt.trialBalance({ unitId });
  const sumBy = (pred) => tb.rows.filter(pred).reduce((s, r) => s + (r.debit - r.kredit), 0);
  const pendapatan = -sumBy(r => r.tipe === 'pendapatan');
  const beban = sumBy(r => r.tipe === 'beban');
  const counts = (await db.prepare(`SELECT status, COUNT(*) n FROM journals GROUP BY status`).all())
    .reduce((o, r) => (o[r.status] = r.n, o), {});
  return {
    aset: sumBy(r => r.tipe === 'aset'), liabilitas: -sumBy(r => r.tipe === 'liabilitas'),
    asetNeto: -sumBy(r => r.tipe === 'aset_neto'), pendapatan, beban,
    kasBank: tb.rows.filter(r => /^11(1|2)/.test(r.kode)).reduce((s, r) => s + (r.debit - r.kredit), 0),
    surplus: pendapatan - beban,
    pendingCount: counts.pending || 0, draftCount: counts.draft || 0, postedCount: counts.posted || 0,
    balanced: tb.balanced, interunit: await rpt.interunitCheck({}),
  };
}));

router.get('/executive', h(async (req) => {
  const today = new Date().toISOString().slice(0, 10);
  const tahun = +today.slice(0, 4);
  const from = tahun + '-01-01';
  const units = await db.prepare('SELECT * FROM units ORDER BY id').all();
  const perUnit = [];
  for (const u of units) perUnit.push({ unit_kode: u.kode, unit_nama: u.nama, ...(await fs.summary({ unitId: u.id, from, to: today })) });
  const konsolidasi = await fs.summary({ unitId: null, from, to: today });
  const aging = await piutang.aging({ unitId: null, asOf: today });
  let anggaran = 0, realisasi = 0;
  for (const u of units) { const r = await budget.listRkat(tahun, u.id); anggaran += r.totalAnggaran; realisasi += r.totalRealisasi; }
  const counts = (await db.prepare("SELECT status, COUNT(*) n FROM journals GROUP BY status").all())
    .reduce((o, r) => (o[r.status] = r.n, o), {});
  const nMhs = (await db.prepare("SELECT COUNT(*) n FROM students WHERE status='aktif'").get()).n;
  const outstanding = (await db.prepare(`
    SELECT COALESCE(SUM(i.nominal),0) - COALESCE((SELECT SUM(nominal) FROM payments),0) AS s
    FROM invoices i WHERE i.status<>'void'`).get()).s;
  const closed = (await db.prepare('SELECT COUNT(*) n FROM year_closings WHERE tahun=?').get(tahun)).n;
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ ym: d.toISOString().slice(0, 7), label: BULAN_SHORT[d.getUTCMonth() + 1] + ' ' + String(d.getUTCFullYear()).slice(2) });
  }
  const revByMonth = (await db.prepare(`
    SELECT substr(j.tanggal,1,7) ym, COALESCE(SUM(jl.kredit - jl.debit),0) rev
    FROM journal_lines jl JOIN journals j ON j.id=jl.journal_id JOIN accounts a ON a.id=jl.account_id
    WHERE a.tipe='pendapatan' AND j.status IN ('posted','reversed') AND j.sumber<>'closing'
      AND j.tanggal >= ? GROUP BY substr(j.tanggal,1,7)`).all(months[0].ym + '-01'))
    .reduce((o, r) => (o[r.ym] = r.rev, o), {});
  const trenPenerimaan = months.map(m => ({ ...m, total: revByMonth[m.ym] || 0 }));
  return {
    tanggal: today, tahun, konsolidasi, perUnit, aging, trenPenerimaan,
    anggaran, realisasi, serapan: anggaran > 0 ? Math.round(realisasi / anggaran * 1000) / 10 : 0,
    pendingCount: counts.pending || 0, draftCount: counts.draft || 0, postedCount: counts.posted || 0,
    mahasiswaAktif: nMhs, piutangOutstanding: outstanding,
    interunit: await rpt.interunitCheck({}), tahunDitutup: closed > 0,
  };
}));

router.get('/fs/:type', h(async (req) => {
  const unitId = await unitIdFromKode(req.query.unit);
  const today = new Date().toISOString().slice(0, 10);
  const to = req.query.to || req.query.asof || today;
  const from = req.query.from || (to.slice(0, 4) + '-01-01');
  switch (req.params.type) {
    case 'posisi': return fs.position({ unitId, asOf: to });
    case 'aktivitas': return fs.activity({ unitId, from, to });
    case 'asetneto': return fs.netAssets({ unitId, from, to });
    case 'aruskas': return fs.cashFlow({ unitId, from, to });
    default: { const e = new Error('Jenis laporan tidak dikenal.'); e.status = 400; throw e; }
  }
}));

router.get('/audit', h(async (req) => {
  const params = []; let where = '1=1';
  if (req.query.entity) { where += ' AND entity=?'; params.push(req.query.entity); }
  if (req.query.action) { where += ' AND action=?'; params.push(req.query.action); }
  if (req.query.q) { where += ' AND (user_nama ILIKE ? OR detail ILIKE ?)'; params.push('%' + req.query.q + '%', '%' + req.query.q + '%'); }
  if (req.query.from) { where += ' AND ts>=?'; params.push(req.query.from); }
  if (req.query.to) { where += ' AND ts<=?'; params.push(req.query.to + ' 23:59:59'); }
  const limit = Math.min(+req.query.limit || 200, 1000);
  const rows = await db.prepare(`SELECT * FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT ?`).all(...params, limit);
  const actions = (await db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all()).map(r => r.action);
  const entities = (await db.prepare('SELECT DISTINCT entity FROM audit_log ORDER BY entity').all()).map(r => r.entity);
  return { rows, actions, entities };
}));

module.exports = router;
