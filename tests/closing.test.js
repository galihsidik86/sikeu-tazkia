'use strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://sikeu:sikeu123@127.0.0.1:55432/sikeu_test';
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');
const migrate = require('../src/db/migrate');
const db = require('../src/db');
const jsvc = require('../src/services/journalService');
const fin = require('../src/services/financialService');
const closing = require('../src/services/closingService');
const backup = require('../src/services/backupService');

const sen = (r) => r * 100;
let unit, U, A = {};

test.before(async () => {
  await migrate({ fresh: true });
  unit = (await db.prepare("INSERT INTO units (kode,nama,is_yayasan) VALUES ('STM','STMIK',0)").run()).lastInsertRowid;
  U = { id: (await db.prepare("INSERT INTO users (nama,email,password_hash,role) VALUES ('P','p@x','x','pengurus_yayasan')").run()).lastInsertRowid, nama: 'P', role: 'pengurus_yayasan' };
  const mk = async (kode, nama, tipe, nb, nac) => (await db.prepare("INSERT INTO accounts (kode,nama,tipe,is_postable,normal_balance,net_asset_class) VALUES (?,?,?,1,?,?)").run(kode, nama, tipe, nb, nac || null)).lastInsertRowid;
  A.kas = await mk('1111', 'Kas', 'aset', 'D');
  A.na = await mk('3100', 'Aset Neto Tanpa Pembatasan', 'aset_neto', 'K', 'tanpa');
  A.naR = await mk('3200', 'Aset Neto Dengan Pembatasan', 'aset_neto', 'K', 'dengan');
  A.ukt = await mk('4100', 'Pendapatan UKT', 'pendapatan', 'K');
  A.hibah = await mk('4300', 'Hibah Terikat', 'pendapatan', 'K', 'dengan');
  A.beban = await mk('5400', 'Beban Operasional', 'beban', 'D');
  const post = (tgl, lines) => jsvc.createPosted(U, { tanggal: tgl, unit_id: unit, deskripsi: 'x', lines: lines.map(l => ({ ...l, unit_id: unit })) });
  await post('2026-03-01', [{ account_id: A.kas, debit: 50000000 }, { account_id: A.ukt, kredit: 50000000 }]);
  await post('2026-03-10', [{ account_id: A.kas, debit: 20000000 }, { account_id: A.hibah, kredit: 20000000 }]);
  await post('2026-04-01', [{ account_id: A.beban, debit: 30000000 }, { account_id: A.kas, kredit: 30000000 }]);
});
test.after(async () => { await db.close(); try { fs.rmSync(backup.BK_DIR, { recursive: true, force: true }); } catch (_) {} });

test('tutup buku memindahkan surplus ke aset neto (tanpa & dengan pembatasan)', async () => {
  const r = await closing.closeYear(U, 2026);
  const stm = r.results.find(x => x.unit === 'STM');
  assert.strictEqual(stm.surplus, sen(40000000));
  const net = await fin.computeNet({ unitId: unit, from: '2026-01-01', to: '2026-12-31' });
  assert.strictEqual(net.byKode['4100'] || 0, 0);
  assert.strictEqual(net.byKode['5400'] || 0, 0);
  assert.strictEqual(-(net.byKode['3100'] || 0), sen(20000000));
  assert.strictEqual(-(net.byKode['3200'] || 0), sen(20000000));
});

test('setelah tutup buku, periode terkunci menolak posting', async () => {
  await assert.rejects(() => jsvc.createPosted(U, { tanggal: '2026-05-01', unit_id: unit, deskripsi: 'x',
    lines: [{ account_id: A.kas, unit_id: unit, debit: 1000 }, { account_id: A.ukt, unit_id: unit, kredit: 1000 }] }), /ditutup|closed/i);
});

test('tutup buku tak bisa dijalankan dua kali', async () => {
  const r = await closing.closeYear(U, 2026);
  assert.ok(r.results.every(x => x.skip));
});

test('batalkan tutup buku membalik jurnal penutup & buka periode; L/R tetap riil', async () => {
  const r = await closing.reopenYear(U, 2026);
  assert.ok(r.dibatalkan >= 1);
  const net = await fin.computeNet({ unitId: unit, from: '2026-01-01', to: '2026-12-31' });
  assert.strictEqual(-(net.byKode['4100'] || 0), sen(50000000));
  assert.strictEqual((await db.prepare('SELECT COUNT(*) n FROM year_closings WHERE tahun=2026').get()).n, 0);
  const act = await fin.activity({ unitId: unit, from: '2026-01-01', to: '2026-12-31' });
  assert.strictEqual(act.rows.find(x => x.label.startsWith('SURPLUS')).values[0], sen(40000000));
});

test('backup database menghasilkan berkas', async () => {
  const r = await backup.backupNow(U, 'test');
  assert.match(r.name, /^sikeu-.*\.json\.gz$/);
  assert.ok(fs.existsSync(path.join(backup.BK_DIR, r.name)));
  assert.ok(backup.listBackups().length >= 1);
});
