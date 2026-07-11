'use strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://sikeu:sikeu123@127.0.0.1:55432/sikeu_test';
const test = require('node:test');
const assert = require('node:assert');
const migrate = require('../src/db/migrate');
const db = require('../src/db');
const jsvc = require('../src/services/journalService');
const budget = require('../src/services/budgetService');

const sen = (rp) => rp * 100;
let unit, U, APP, beban, kas;

async function postBeban(rp, tanggal, force) {
  return jsvc.createPosted(U, { tanggal: tanggal || '2026-06-01', unit_id: unit, deskripsi: 'Honor', allowOverBudget: force,
    lines: [{ account_id: beban, unit_id: unit, debit: rp }, { account_id: kas, unit_id: unit, kredit: rp }] });
}

test.before(async () => {
  await migrate({ fresh: true });
  unit = (await db.prepare("INSERT INTO units (kode,nama,is_yayasan) VALUES ('STM','STMIK',0)").run()).lastInsertRowid;
  U = { id: (await db.prepare("INSERT INTO users (nama,email,password_hash,role) VALUES ('S','s@x','x','staf_akuntansi')").run()).lastInsertRowid, nama: 'S', role: 'staf_akuntansi' };
  APP = { id: (await db.prepare("INSERT INTO users (nama,email,password_hash,role) VALUES ('P','p@x','x','pengurus_yayasan')").run()).lastInsertRowid, nama: 'P', role: 'pengurus_yayasan' };
  const mk = async (kode, tipe, nb) => (await db.prepare("INSERT INTO accounts (kode,nama,tipe,is_postable,normal_balance) VALUES (?,?,?,1,?)").run(kode, 'Akun ' + kode, tipe, nb)).lastInsertRowid;
  beban = await mk('5300', 'beban', 'D'); kas = await mk('1111', 'aset', 'D');
});
test.after(async () => { await db.close(); });

test('penyusunan RKAT & alur status draft → diajukan → disahkan', async () => {
  await budget.upsertLine(U, { tahun: 2026, unit_id: unit, account_id: beban, nominal: 35000000 });
  assert.strictEqual(await budget.rkatStatus(2026, unit), 'draft');
  await budget.submit(U, 2026, unit);
  assert.strictEqual(await budget.rkatStatus(2026, unit), 'diajukan');
  await assert.rejects(() => budget.upsertLine(U, { tahun: 2026, unit_id: unit, account_id: beban, nominal: 40000000 }), /draft/i);
  await budget.approve(APP, 2026, unit);
  assert.strictEqual(await budget.rkatStatus(2026, unit), 'disahkan');
});

test('laporan realisasi vs anggaran menghitung % & flag', async () => {
  await postBeban(30000000);
  const rep = await budget.listRkat(2026, unit);
  const row = rep.rows.find(r => r.kode === '5300');
  assert.strictEqual(row.anggaran, sen(35000000));
  assert.strictEqual(row.realisasi, sen(30000000));
  assert.ok(row.persen >= 85 && row.persen <= 86);
  assert.strictEqual(row.flag, 'waspada');
});

test('posting yang MELAMPAUI pagu diblokir', async () => {
  await assert.rejects(() => postBeban(10000000), /melampaui pagu|ditolak/i);
  assert.strictEqual(await budget.realisasi(beban, unit, 2026, 'D'), sen(30000000));
});

test('posting di bawah pagu diperbolehkan', async () => {
  await postBeban(4000000);
  assert.strictEqual(await budget.realisasi(beban, unit, 2026, 'D'), sen(34000000));
});

test('override allowOverBudget melewati blokir', async () => {
  await assert.rejects(() => postBeban(5000000), /pagu/i);
  const j = await postBeban(5000000, '2026-06-02', true);
  assert.strictEqual(j.status, 'posted');
  assert.strictEqual(await budget.realisasi(beban, unit, 2026, 'D'), sen(39000000));
});

test('anggaran BELUM disahkan tidak menegakkan pagu', async () => {
  const b2 = (await db.prepare("INSERT INTO accounts (kode,nama,tipe,is_postable,normal_balance) VALUES ('5400','B','beban',1,'D')").run()).lastInsertRowid;
  await budget.upsertLine(U, { tahun: 2027, unit_id: unit, account_id: b2, nominal: 1000000 });
  assert.strictEqual(await budget.rkatStatus(2027, unit), 'draft');
  const j = await jsvc.createPosted(U, { tanggal: '2027-06-03', unit_id: unit, deskripsi: 'Ops',
    lines: [{ account_id: b2, unit_id: unit, debit: 5000000 }, { account_id: kas, unit_id: unit, kredit: 5000000 }] });
  assert.strictEqual(j.status, 'posted');
});
