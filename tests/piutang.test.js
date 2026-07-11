'use strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://sikeu:sikeu123@127.0.0.1:55432/sikeu_test';
const test = require('node:test');
const assert = require('node:assert');
const migrate = require('../src/db/migrate');
const db = require('../src/db');
const svc = require('../src/services/piutangService');
const jsvc = require('../src/services/journalService');

const sen = (r) => r * 100;
let unit, U, A = {}, baId, stu, stu2, invA;

test.before(async () => {
  await migrate({ fresh: true });
  unit = (await db.prepare("INSERT INTO units (kode,nama,is_yayasan) VALUES ('STM','STMIK',0)").run()).lastInsertRowid;
  U = { id: (await db.prepare("INSERT INTO users (nama,email,password_hash,role) VALUES ('Staf','s@x','x','staf_akuntansi')").run()).lastInsertRowid, nama: 'Staf', role: 'staf_akuntansi' };
  const mk = async (kode, tipe, nb, kontra) => (await db.prepare("INSERT INTO accounts (kode,nama,tipe,is_postable,normal_balance,is_kontra) VALUES (?,?,?,1,?,?)").run(kode, 'Akun ' + kode, tipe, nb, kontra ? 1 : 0)).lastInsertRowid;
  A.p = await mk('1131', 'aset', 'D'); A.def = await mk('2120', 'liabilitas', 'K'); A.rev = await mk('4100', 'pendapatan', 'K');
  A.ckpn = await mk('1139', 'aset', 'K', true); A.beban = await mk('5800', 'beban', 'D');
  A.bank = await mk('1121', 'aset', 'D');
  baId = (await db.prepare("INSERT INTO bank_accounts (nama,bank,no_rekening,account_id,unit_id) VALUES ('Bank','Bank','1',?,?)").run(A.bank, unit)).lastInsertRowid;
  stu = (await db.prepare("INSERT INTO students (nim,nama,unit_id,status) VALUES ('001','Ani',?,'aktif')").run(unit)).lastInsertRowid;
  stu2 = (await db.prepare("INSERT INTO students (nim,nama,unit_id,status) VALUES ('002','Budi',?,'aktif')").run(unit)).lastInsertRowid;
});
test.after(async () => { await db.close(); });

test('terbit tagihan → jurnal D Piutang / K Pendapatan Diterima di Muka', async () => {
  invA = await svc.createInvoice(U, { student_id: stu, semester: '2026 Genap', nominal: 9000000, tanggal: '2026-02-01', jatuh_tempo: '2026-02-28', tenor_bulan: 6, mulai_amortisasi: '2026-02-01' });
  assert.strictEqual(invA.nominal, sen(9000000));
  assert.strictEqual(invA.deferred, sen(9000000));
  const lines = await db.prepare('SELECT jl.*, a.kode FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.journal_id=?').all(invA.journal_id);
  assert.ok(lines.find(l => l.kode === '1131' && l.debit === sen(9000000)));
  assert.ok(lines.find(l => l.kode === '2120' && l.kredit === sen(9000000)));
});

test('pembayaran cicilan sebagian → status sebagian, sisa benar', async () => {
  const r = await svc.recordPayment(U, { invoice_id: invA.id, tanggal: '2026-03-10', nominal: 3000000, bank_account_id: baId });
  assert.strictEqual(r.status, 'sebagian');
  assert.strictEqual(r.paid, sen(3000000));
  assert.strictEqual(r.sisa, sen(6000000));
});

test('pembayaran melebihi sisa ditolak', async () => {
  await assert.rejects(() => svc.recordPayment(U, { invoice_id: invA.id, tanggal: '2026-03-11', nominal: 999000000, bank_account_id: baId }), /melebihi sisa/i);
});

test('aging menempatkan tagihan pada bucket & menghitung CKPN', async () => {
  const ag = await svc.aging({ unitId: unit, asOf: '2026-07-10' });
  const b4 = ag.buckets.find(b => b.key === 'b4');
  assert.strictEqual(b4.outstanding, sen(6000000));
  assert.strictEqual(b4.ckpn, sen(3000000));
  assert.strictEqual(ag.totalOutstanding, sen(6000000));
});

test('amortisasi bulanan mengakui 1/tenor & mencegah proses ganda', async () => {
  const pre = await svc.amortisasiPreview(2026, 2, unit);
  assert.strictEqual(pre.total, sen(1500000));
  const run = await svc.runAmortisasi(U, 2026, 2);
  assert.strictEqual(run.grandTotal, sen(1500000));
  const inv = await svc.getInvoice(invA.id);
  assert.strictEqual(inv.recognized, sen(1500000));
  const lines = await db.prepare('SELECT jl.*, a.kode FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.journal_id=?').all(inv.recognitions[0].journal_id);
  assert.ok(lines.find(l => l.kode === '2120' && l.debit === sen(1500000)));
  assert.ok(lines.find(l => l.kode === '4100' && l.kredit === sen(1500000)));
  await assert.rejects(() => svc.runAmortisasi(U, 2026, 2), /sudah diproses|tidak ada/i);
});

test('CKPN dihitung per bucket dgn tarif terkonfigurasi & jurnal dibuat sebagai DRAFT', async () => {
  const r = await svc.runCkpn(U, '2026-07-10');
  const stm = r.results.find(x => x.draft_id);
  assert.strictEqual(stm.required, sen(3000000));
  assert.strictEqual(stm.delta, sen(3000000));
  assert.strictEqual(stm.status, 'draft');
  assert.strictEqual(await svc.ckpnBalance(unit), 0);
  await jsvc.submit(U, stm.draft_id); await jsvc.approve(U, stm.draft_id);
  assert.strictEqual(await svc.ckpnBalance(unit), sen(3000000));
});

test('tarif CKPN dapat dikonfigurasi admin', async () => {
  await svc.updateCkpnRate(U, 'b4', 60);
  const ag = await svc.aging({ unitId: unit, asOf: '2026-07-10' });
  assert.strictEqual(ag.buckets.find(b => b.key === 'b4').rate, 0.6);
  assert.strictEqual(ag.buckets.find(b => b.key === 'b4').ckpn, Math.round(sen(6000000) * 0.6));
  await svc.updateCkpnRate(U, 'b4', 50);
});

test('generate massal melewati mahasiswa yang sudah punya tagihan semester sama', async () => {
  const r = await svc.generateInvoices(U, { unit_id: unit, semester: '2026 Genap', nominal: 5000000, tanggal: '2026-02-01', jatuh_tempo: '2026-03-01', tenor_bulan: 6, mulai_amortisasi: '2026-02-01' });
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.total, sen(5000000));
});
