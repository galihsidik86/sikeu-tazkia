'use strict';
// Uji Kas & Bank (PostgreSQL): kategori, form kas PENDING, rekonsiliasi ±3 hari + pemetaan kolom.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://sikeu:sikeu123@127.0.0.1:55432/sikeu_test';
const test = require('node:test');
const assert = require('node:assert');
const migrate = require('../src/db/migrate');
const db = require('../src/db');
const jsvc = require('../src/services/journalService');
const cash = require('../src/services/cashService');
const recon = require('../src/services/reconcileService');

const sen = (rp) => rp * 100;
let unit, STAF, BDH, bankAcc, pend, beban, baId, catIn, catOut;

test.before(async () => {
  await migrate({ fresh: true });
  unit = (await db.prepare("INSERT INTO units (kode,nama,is_yayasan) VALUES ('STM','STMIK',0)").run()).lastInsertRowid;
  STAF = { id: (await db.prepare("INSERT INTO users (nama,email,password_hash,role) VALUES ('Kasir','k@x','x','kasir')").run()).lastInsertRowid, nama: 'Kasir', role: 'kasir' };
  BDH = { id: (await db.prepare("INSERT INTO users (nama,email,password_hash,role) VALUES ('Bdh','b@x','x','bendahara')").run()).lastInsertRowid, nama: 'Bdh', role: 'bendahara' };
  const mk = async (kode, tipe, nb) => (await db.prepare("INSERT INTO accounts (kode,nama,tipe,is_postable,normal_balance) VALUES (?,?,?,1,?)").run(kode, 'Akun ' + kode, tipe, nb)).lastInsertRowid;
  bankAcc = await mk('1121', 'aset', 'D'); pend = await mk('4200', 'pendapatan', 'K'); beban = await mk('5400', 'beban', 'D');
  baId = (await db.prepare("INSERT INTO bank_accounts (nama,bank,no_rekening,account_id,unit_id) VALUES ('Bank Mandiri','Bank Mandiri','123',?,?)").run(bankAcc, unit)).lastInsertRowid;
  catIn = (await db.prepare("INSERT INTO cash_categories (jenis,nama,account_id) VALUES ('penerimaan','Pendaftaran',?)").run(pend)).lastInsertRowid;
  catOut = (await db.prepare("INSERT INTO cash_categories (jenis,nama,account_id) VALUES ('pengeluaran','Operasional',?)").run(beban)).lastInsertRowid;
});
test.after(async () => { await db.close(); });

test('penerimaan via KATEGORI → jurnal PENDING (belum memengaruhi saldo)', async () => {
  const j = await cash.createReceipt(STAF, { bank_account_id: baId, tanggal: '2026-06-05', category_id: catIn, amount: 8500000, catatan: 'Loket pagi' });
  assert.strictEqual(j.status, 'pending');
  assert.ok(j.nomor);
  assert.ok(j.lines.find(l => l.account_id === bankAcc && l.debit === sen(8500000)));
  assert.ok(j.lines.find(l => l.account_id === pend && l.kredit === sen(8500000)));
  assert.strictEqual(await cash.bookBalance(bankAcc, unit), 0);
});

test('bendahara menyetujui → terposting, saldo naik', async () => {
  const list = await db.prepare("SELECT id FROM journals WHERE status='pending'").all();
  await jsvc.approve(BDH, list[0].id);
  assert.strictEqual(await cash.bookBalance(bankAcc, unit), sen(8500000));
});

test('pengeluaran via kategori → pending → disetujui → saldo turun', async () => {
  const j = await cash.createPayment(STAF, { bank_account_id: baId, tanggal: '2026-06-20', category_id: catOut, amount: 3250000 });
  assert.strictEqual(j.status, 'pending');
  await jsvc.approve(BDH, j.id);
  assert.strictEqual(await cash.bookBalance(bankAcc, unit), sen(8500000 - 3250000));
});

test('kategori tidak valid ditolak', async () => {
  await assert.rejects(() => cash.createReceipt(STAF, { bank_account_id: baId, tanggal: '2026-06-06', category_id: 9999, amount: 1000 }), /kategori/i);
});

test('penerimaan ke periode terkunci ditolak (saat diajukan)', async () => {
  await db.prepare("INSERT INTO periods (tahun,bulan,status) VALUES (2026,3,'closed')").run();
  await assert.rejects(() => cash.createReceipt(STAF, { bank_account_id: baId, tanggal: '2026-03-10', category_id: catIn, amount: 1000000 }), /ditutup|closed/i);
});

test('rekonsiliasi: import CSV & auto-match nominal sama + tanggal ±3 hari', async () => {
  const csv = ['tanggal,keterangan,debit,kredit', '2026-06-07,Setoran pendaftaran,8500000,0', '2026-06-20,Pembelian ATK,0,3250000', '2026-06-30,Biaya admin bank,0,25000'].join('\n');
  const r = await recon.importStatements(STAF, baId, csv, true);
  assert.strictEqual(r.imported, 3);
  assert.strictEqual(r.matched, 2);
  assert.strictEqual((await recon.getReconciliation(baId)).unmatchedBankCount, 1);
});

test('rekonsiliasi: pemetaan kolom CSV kustom', async () => {
  const csv = ['Tgl;Uraian;Masuk;Keluar', '13/06/2026;Transfer masuk;8500000;0'].join('\n');
  await recon.importStatements(STAF, baId, csv, true, { tanggal: 'Tgl', keterangan: 'Uraian', debit: 'Masuk', kredit: 'Keluar' });
  const view = await recon.getReconciliation(baId);
  const s = view.statements.find(x => x.keterangan === 'Transfer masuk');
  assert.ok(s);
  assert.strictEqual(s.debit, sen(8500000));
  assert.strictEqual(s.matched, false);
});
