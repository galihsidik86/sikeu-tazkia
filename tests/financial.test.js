'use strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://sikeu:sikeu123@127.0.0.1:55432/sikeu_test';
const test = require('node:test');
const assert = require('node:assert');
const migrate = require('../src/db/migrate');
const db = require('../src/db');
const jsvc = require('../src/services/journalService');
const FS = require('../src/services/financialService');

const sen = (r) => r * 100;
let unit, U, A = {};
const P = { unitId: null, from: '2026-01-01', to: '2026-12-31' };

test.before(async () => {
  await migrate({ fresh: true });
  unit = (await db.prepare("INSERT INTO units (kode,nama,is_yayasan) VALUES ('STM','STMIK',0)").run()).lastInsertRowid;
  P.unitId = unit;
  U = { id: (await db.prepare("INSERT INTO users (nama,email,password_hash,role) VALUES ('S','s@x','x','staf_akuntansi')").run()).lastInsertRowid, nama: 'S', role: 'staf_akuntansi' };
  const mk = async (kode, nama, tipe, nb, opt = {}) => (await db.prepare("INSERT INTO accounts (kode,nama,tipe,is_postable,normal_balance,is_kontra,net_asset_class) VALUES (?,?,?,1,?,?,?)").run(kode, nama, tipe, nb, opt.kontra ? 1 : 0, opt.nac || null)).lastInsertRowid;
  A.kas = await mk('1111', 'Kas & Bank', 'aset', 'D');
  A.piutang = await mk('1131', 'Piutang UKT', 'aset', 'D');
  A.gedung = await mk('1220', 'Gedung', 'aset', 'D');
  A.akum = await mk('1290', 'Akum. Penyusutan', 'aset', 'K', { kontra: 1 });
  A.deferred = await mk('2120', 'Pendapatan Diterima di Muka', 'liabilitas', 'K');
  A.na = await mk('3100', 'Aset Neto Tanpa Pembatasan', 'aset_neto', 'K', { nac: 'tanpa' });
  A.pendapatan = await mk('4100', 'Pendapatan UKT', 'pendapatan', 'K');
  A.beban = await mk('5400', 'Beban Operasional', 'beban', 'D');
  A.penyusutan = await mk('5700', 'Beban Penyusutan', 'beban', 'D');
  const post = (tanggal, lines) => jsvc.createPosted(U, { tanggal, unit_id: unit, deskripsi: 'x', lines: lines.map(l => ({ ...l, unit_id: unit })) });
  await post('2026-01-02', [{ account_id: A.kas, debit: 100000000 }, { account_id: A.na, kredit: 100000000 }]);
  await post('2026-03-01', [{ account_id: A.kas, debit: 30000000 }, { account_id: A.pendapatan, kredit: 30000000 }]);
  await post('2026-03-05', [{ account_id: A.beban, debit: 10000000 }, { account_id: A.kas, kredit: 10000000 }]);
  await post('2026-04-01', [{ account_id: A.gedung, debit: 40000000 }, { account_id: A.kas, kredit: 40000000 }]);
  await post('2026-06-30', [{ account_id: A.penyusutan, debit: 5000000 }, { account_id: A.akum, kredit: 5000000 }]);
  await post('2026-06-30', [{ account_id: A.piutang, debit: 20000000 }, { account_id: A.deferred, kredit: 20000000 }]);
});
test.after(async () => { await db.close(); });

test('Laporan Posisi Keuangan SEIMBANG (Aset = Liabilitas + Aset Neto)', async () => {
  const r = await FS.position({ unitId: unit, asOf: '2026-12-31' });
  assert.ok(r.balanced);
  assert.strictEqual(r.rows.find(x => x.label === 'JUMLAH ASET').values[0], sen(135000000));
});

test('Penghasilan Komprehensif: surplus = pendapatan - beban', async () => {
  const r = await FS.activity(P);
  assert.strictEqual(r.rows.find(x => x.label.startsWith('SURPLUS')).values[0], sen(30000000 - 15000000));
});

test('Perubahan Aset Neto konsisten (saldo akhir = awal + surplus + kontribusi)', async () => {
  const r = await FS.netAssets(P);
  assert.ok(r.balanced);
  assert.strictEqual(r.rows.find(x => x.label === 'Saldo akhir aset neto').values[2], sen(115000000));
});

test('Arus Kas (tidak langsung) tie-out ke perubahan kas', async () => {
  const r = await FS.cashFlow(P);
  assert.ok(r.balanced);
  assert.strictEqual(r.rows.find(x => x.label.startsWith('KAS DAN SETARA KAS AKHIR')).values[0], sen(80000000));
});
