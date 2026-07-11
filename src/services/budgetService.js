'use strict';
const db = require('../db');
const audit = require('./audit');
const { toSen } = require('../utils/money');

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }

const POSTED = "('posted','reversed')";

async function realisasi(accountId, unitId, tahun, normal) {
  const r = await db.prepare(`
    SELECT COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.kredit),0) k
    FROM journal_lines jl JOIN journals j ON j.id=jl.journal_id
    WHERE jl.account_id=? AND jl.unit_id=? AND j.status IN ${POSTED}
      AND substr(j.tanggal,1,4)=?`).get(accountId, unitId, String(tahun));
  return normal === 'D' ? r.d - r.k : r.k - r.d;
}

async function getBudgetLine(tahun, unitId, accountId) {
  return db.prepare(`SELECT b.*, a.kode, a.nama, a.tipe, a.normal_balance
    FROM budgets b JOIN accounts a ON a.id=b.account_id
    WHERE b.tahun=? AND b.unit_id=? AND b.account_id=?`).get(tahun, unitId, accountId);
}

async function rkatStatus(tahun, unitId) {
  if (!unitId) return null;
  const rows = await db.prepare('SELECT DISTINCT status FROM budgets WHERE tahun=? AND unit_id=?').all(tahun, unitId);
  if (!rows.length) return 'draft';
  const order = ['draft', 'diajukan', 'disahkan'];
  return order.find(s => rows.some(r => r.status === s)) || 'draft';
}

function flagOf(persen) { return persen > 100 ? 'lebih' : persen >= 80 ? 'waspada' : 'normal'; }

async function listRkat(tahun, unitId) {
  const params = [tahun]; let where = 'b.tahun=?';
  if (unitId) { where += ' AND b.unit_id=?'; params.push(unitId); }
  const rows = await db.prepare(`SELECT b.*, a.kode, a.nama, a.tipe, a.normal_balance, u.kode AS unit_kode, u.nama AS unit_nama
    FROM budgets b JOIN accounts a ON a.id=b.account_id JOIN units u ON u.id=b.unit_id
    WHERE ${where} ORDER BY u.id, a.kode`).all(...params);
  let totA = 0, totR = 0;
  const out = [];
  for (const b of rows) {
    const real = await realisasi(b.account_id, b.unit_id, tahun, b.normal_balance);
    const persen = b.nominal > 0 ? Math.round((real / b.nominal) * 1000) / 10 : 0;
    totA += b.nominal; totR += real;
    out.push({ id: b.id, tahun: b.tahun, unit_id: b.unit_id, unit_kode: b.unit_kode, unit_nama: b.unit_nama,
      account_id: b.account_id, kode: b.kode, nama: b.nama, tipe: b.tipe, status: b.status,
      anggaran: b.nominal, realisasi: real, sisa: b.nominal - real, persen, flag: flagOf(persen) });
  }
  const persenTot = totA > 0 ? Math.round((totR / totA) * 1000) / 10 : 0;
  return { tahun, unit: unitId, rows: out, totalAnggaran: totA, totalRealisasi: totR,
    totalSisa: totA - totR, persen: persenTot, status: await rkatStatus(tahun, unitId) };
}

async function assertDraft(tahun, unitId) {
  const st = await rkatStatus(tahun, unitId);
  if (st !== 'draft') throw new ApiError(409, `RKAT ${tahun} sudah "${st}". Buka kembali ke draft untuk mengubah.`);
}
async function upsertLine(user, b) {
  if (!b.tahun || !b.unit_id || !b.account_id) throw new ApiError(400, 'Tahun, unit, dan akun wajib diisi.');
  const acc = await db.prepare('SELECT * FROM accounts WHERE id=?').get(b.account_id);
  if (!acc || !acc.is_postable) throw new ApiError(400, 'Akun anggaran harus akun postable.');
  await assertDraft(b.tahun, b.unit_id);
  const nominal = toSen(b.nominal);
  if (nominal < 0) throw new ApiError(400, 'Nominal tidak boleh negatif.');
  const exist = await db.prepare('SELECT id FROM budgets WHERE tahun=? AND unit_id=? AND account_id=?').get(b.tahun, b.unit_id, b.account_id);
  if (exist) await db.prepare('UPDATE budgets SET nominal=? WHERE id=?').run(nominal, exist.id);
  else await db.prepare("INSERT INTO budgets (tahun,unit_id,account_id,nominal,status) VALUES (?,?,?,?,'draft')").run(b.tahun, b.unit_id, b.account_id, nominal);
  await audit.log(user, exist ? 'update' : 'create', 'budget', exist ? exist.id : null, { tahun: b.tahun, akun: acc.kode, nominal }, user.ip);
  return listRkat(b.tahun, b.unit_id);
}
async function deleteLine(user, id) {
  const b = await db.prepare('SELECT * FROM budgets WHERE id=?').get(id);
  if (!b) throw new ApiError(404, 'Pos anggaran tidak ditemukan.');
  await assertDraft(b.tahun, b.unit_id);
  await db.prepare('DELETE FROM budgets WHERE id=?').run(id);
  await audit.log(user, 'delete', 'budget', id, null, user.ip);
  return listRkat(b.tahun, b.unit_id);
}

async function transition(user, tahun, unitId, from, to, action) {
  const st = await rkatStatus(tahun, unitId);
  const rows = (await db.prepare('SELECT COUNT(*) c FROM budgets WHERE tahun=? AND unit_id=?').get(tahun, unitId)).c;
  if (!rows) throw new ApiError(409, 'Belum ada pos anggaran untuk diproses.');
  if (st !== from) throw new ApiError(409, `Status RKAT saat ini "${st}", tidak dapat ${action}.`);
  await db.prepare('UPDATE budgets SET status=? WHERE tahun=? AND unit_id=?').run(to, tahun, unitId);
  await audit.log(user, action, 'budget', null, { tahun, unit_id: unitId, status: to }, user.ip);
  return listRkat(tahun, unitId);
}
const submit = (user, tahun, unitId) => transition(user, tahun, unitId, 'draft', 'diajukan', 'ajukan_rkat');
const approve = (user, tahun, unitId) => transition(user, tahun, unitId, 'diajukan', 'disahkan', 'sahkan_rkat');
async function reopen(user, tahun, unitId) {
  await db.prepare('UPDATE budgets SET status=? WHERE tahun=? AND unit_id=?').run('draft', tahun, unitId);
  await audit.log(user, 'reopen_rkat', 'budget', null, { tahun, unit_id: unitId }, user.ip);
  return listRkat(tahun, unitId);
}

module.exports = { ApiError, realisasi, getBudgetLine, rkatStatus, listRkat,
  upsertLine, deleteLine, submit, approve, reopen };
