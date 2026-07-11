'use strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://sikeu:sikeu123@127.0.0.1:55432/sikeu_test';
const test = require('node:test');
const assert = require('node:assert');
const migrate = require('../src/db/migrate');
const db = require('../src/db');
const tax = require('../src/services/taxService');

const sen = (r) => r * 100;
let unit, U, A = {}, baId, rate21, rate23;
async function saldo(accId) {
  return (await db.prepare("SELECT COALESCE(SUM(kredit-debit),0) s FROM journal_lines jl JOIN journals j ON j.id=jl.journal_id WHERE jl.account_id=? AND j.status IN ('posted','reversed')").get(accId)).s;
}

test.before(async () => {
  await migrate({ fresh: true });
  unit = (await db.prepare("INSERT INTO units (kode,nama,is_yayasan) VALUES ('STM','STMIK',0)").run()).lastInsertRowid;
  U = { id: (await db.prepare("INSERT INTO users (nama,email,password_hash,role) VALUES ('S','s@x','x','staf_akuntansi')").run()).lastInsertRowid, nama: 'S', role: 'staf_akuntansi' };
  const mk = async (kode, tipe, nb) => (await db.prepare("INSERT INTO accounts (kode,nama,tipe,is_postable,normal_balance) VALUES (?,?,?,1,?)").run(kode, 'Akun ' + kode, tipe, nb)).lastInsertRowid;
  A.honor = await mk('5300', 'beban', 'D'); A.pph21 = await mk('2130', 'liabilitas', 'K'); A.pph23 = await mk('2135', 'liabilitas', 'K');
  A.bank = await mk('1121', 'aset', 'D'); A.jasa = await mk('5400', 'beban', 'D');
  baId = (await db.prepare("INSERT INTO bank_accounts (nama,bank,no_rekening,account_id,unit_id) VALUES ('Bank','Bank','1',?,?)").run(A.bank, unit)).lastInsertRowid;
  rate21 = (await db.prepare("INSERT INTO tax_rates (kode,nama,jenis,account_utang_id,tarif_bp) VALUES ('P21','PPh21','pph21',?,500)").run(A.pph21)).lastInsertRowid;
  rate23 = (await db.prepare("INSERT INTO tax_rates (kode,nama,jenis,account_utang_id,tarif_bp) VALUES ('P23','PPh23','pph23',?,200)").run(A.pph23)).lastInsertRowid;
});
test.after(async () => { await db.close(); });

test('potong PPh 21 → jurnal (D)Beban (K)Utang PPh21 (K)Bank neto', async () => {
  const w = await tax.recordWithholding(U, { rate_id: rate21, tanggal: '2026-07-05', unit_id: unit, beban_account_id: A.honor, bank_account_id: baId, lawan_nama: 'Dr. Hendra', dpp: 10000000 });
  assert.strictEqual(w.dpp, sen(10000000));
  assert.strictEqual(w.pajak, sen(500000));
  assert.strictEqual(w.neto, sen(9500000));
  assert.ok(w.nomor.startsWith('BP21/'));
  assert.strictEqual(await saldo(A.pph21), sen(500000));
  assert.strictEqual(await saldo(A.bank), sen(9500000));
});

test('potong PPh 23 → 2% dari DPP', async () => {
  const w = await tax.recordWithholding(U, { rate_id: rate23, tanggal: '2026-07-06', unit_id: unit, beban_account_id: A.jasa, bank_account_id: baId, lawan_nama: 'CV Solusi', dpp: 15000000 });
  assert.strictEqual(w.pajak, sen(300000));
  assert.strictEqual(await saldo(A.pph23), sen(300000));
});

test('rekap masa menjumlahkan pajak dipotong & belum disetor', async () => {
  const r = await tax.recap(2026, 7);
  assert.strictEqual(r.byJenis.pph21.pajak, sen(500000));
  assert.strictEqual(r.byJenis.pph21.belumSetor, sen(500000));
  assert.strictEqual(r.byJenis.pph23.pajak, sen(300000));
});

test('setor PPh 21 → (D)Utang PPh21 (K)Bank, tandai disetor, utang nol', async () => {
  const r = await tax.setor(U, { tahun: 2026, bulan: 7, jenis: 'pph21', bank_account_id: baId });
  assert.strictEqual(r.total, sen(500000));
  assert.strictEqual(r.jumlah, 1);
  assert.strictEqual(await saldo(A.pph21), 0);
  const rc = await tax.recap(2026, 7);
  assert.strictEqual(rc.byJenis.pph21.disetor, sen(500000));
  assert.strictEqual(rc.byJenis.pph21.belumSetor, 0);
});

test('setor tanpa data → ditolak', async () => {
  await assert.rejects(() => tax.setor(U, { tahun: 2026, bulan: 8, jenis: 'pph21', bank_account_id: baId }), /belum disetor|tidak ada/i);
});
