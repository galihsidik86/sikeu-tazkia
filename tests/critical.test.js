'use strict';
// Uji aturan akuntansi kritis (PostgreSQL, database sikeu_test).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://sikeu:sikeu123@127.0.0.1:55432/sikeu_test';
const test = require('node:test');
const assert = require('node:assert');
const migrate = require('../src/db/migrate');
const db = require('../src/db');
const svc = require('../src/services/journalService');

let unit, kas, pend, accHdr, U, APPR;

test.before(async () => {
  await migrate({ fresh: true });
  unit = (await db.prepare("INSERT INTO units (kode,nama,is_yayasan) VALUES ('STM','STMIK Tazkia',0)").run()).lastInsertRowid;
  const user = (await db.prepare("INSERT INTO users (nama,email,password_hash,role) VALUES ('Staf','staf@x','x','staf_akuntansi')").run()).lastInsertRowid;
  const appr = (await db.prepare("INSERT INTO users (nama,email,password_hash,role) VALUES ('Bdh','bdh@x','x','bendahara')").run()).lastInsertRowid;
  const acc = async (kode, normal) => (await db.prepare("INSERT INTO accounts (kode,nama,tipe,is_postable,normal_balance) VALUES (?,?,?,1,?)")
    .run(kode, 'Akun ' + kode, normal === 'D' ? 'aset' : 'pendapatan', normal)).lastInsertRowid;
  accHdr = (await db.prepare("INSERT INTO accounts (kode,nama,tipe,is_postable,normal_balance) VALUES ('9000','Header','aset',0,'D')").run()).lastInsertRowid;
  kas = await acc('1111', 'D');
  pend = await acc('4100', 'K');
  U = { id: user, nama: 'Staf', role: 'staf_akuntansi' };
  APPR = { id: appr, nama: 'Bdh', role: 'bendahara' };
});
test.after(async () => { await db.close(); });

test('jurnal tidak balance DITOLAK saat diajukan', async () => {
  const j = await svc.createDraft(U, { tanggal: '2026-07-01', unit_id: unit, deskripsi: 'Tak balance',
    lines: [{ account_id: kas, unit_id: unit, debit: 100000 }, { account_id: pend, unit_id: unit, kredit: 90000 }] });
  await assert.rejects(() => svc.submit(U, j.id), /tidak balance/i);
  assert.strictEqual((await db.prepare('SELECT status FROM journals WHERE id=?').get(j.id)).status, 'draft');
});

test('jurnal balance BOLEH diajukan & disetujui (posted)', async () => {
  const j = await svc.createDraft(U, { tanggal: '2026-07-01', unit_id: unit, deskripsi: 'Balance',
    lines: [{ account_id: kas, unit_id: unit, debit: 100000 }, { account_id: pend, unit_id: unit, kredit: 100000 }] });
  await svc.submit(U, j.id);
  const posted = await svc.approve(APPR, j.id);
  assert.strictEqual(posted.status, 'posted');
  assert.ok(posted.nomor);
});

test('jurnal POSTED tidak bisa diedit atau dihapus (immutability)', async () => {
  const j = await svc.createDraft(U, { tanggal: '2026-07-02', unit_id: unit, deskripsi: 'Untuk diposting',
    lines: [{ account_id: kas, unit_id: unit, debit: 50000 }, { account_id: pend, unit_id: unit, kredit: 50000 }] });
  await svc.submit(U, j.id); await svc.approve(APPR, j.id);
  await assert.rejects(() => svc.updateDraft(U, j.id, { lines: [{ account_id: kas, unit_id: unit, debit: 99 }, { account_id: pend, unit_id: unit, kredit: 99 }] }), /tidak bisa diubah|hanya draft/i);
  await assert.rejects(() => svc.deleteDraft(U, j.id), /tidak bisa dihapus/i);
});

test('posting ke periode TERKUNCI ditolak', async () => {
  const j = await svc.createDraft(U, { tanggal: '2026-08-01', unit_id: unit, deskripsi: 'Di periode yang akan dikunci',
    lines: [{ account_id: kas, unit_id: unit, debit: 10000 }, { account_id: pend, unit_id: unit, kredit: 10000 }] });
  await db.prepare("UPDATE periods SET status='closed' WHERE tahun=2026 AND bulan=8").run();
  await assert.rejects(() => svc.submit(U, j.id), /ditutup|terkunci|closed/i);
});

test('akun non-postable (header) ditolak', async () => {
  await assert.rejects(() => svc.createDraft(U, { tanggal: '2026-07-01', unit_id: unit, deskripsi: 'Pakai header',
    lines: [{ account_id: accHdr, unit_id: unit, debit: 1000 }, { account_id: pend, unit_id: unit, kredit: 1000 }] }), /akun induk|tidak bisa dijurnal/i);
});

test('baris tanpa unit (dimensi) ditolak', async () => {
  await assert.rejects(() => svc.createDraft(U, { tanggal: '2026-07-01', unit_id: null, deskripsi: 'Tanpa unit',
    lines: [{ account_id: kas, unit_id: null, debit: 1000 }, { account_id: pend, unit_id: null, kredit: 1000 }] }), /unit/i);
});

test('jurnal balik (reversal) membalik D/K & menandai jurnal asal', async () => {
  const j = await svc.createDraft(U, { tanggal: '2026-09-01', unit_id: unit, deskripsi: 'Akan dibalik',
    lines: [{ account_id: kas, unit_id: unit, debit: 70000 }, { account_id: pend, unit_id: unit, kredit: 70000 }] });
  await svc.submit(U, j.id); await svc.approve(APPR, j.id);
  const rev = await svc.reverse(APPR, j.id);
  assert.strictEqual(rev.status, 'posted');
  assert.strictEqual(rev.reversal_of, j.id);
  assert.strictEqual((await db.prepare('SELECT status FROM journals WHERE id=?').get(j.id)).status, 'reversed');
  const rl = await db.prepare('SELECT * FROM journal_lines WHERE journal_id=? ORDER BY line_no').all(rev.id);
  assert.strictEqual(rl[0].kredit, 70000 * 100);
  assert.strictEqual(rl[1].debit, 70000 * 100);
  await assert.rejects(() => svc.reverse(APPR, j.id), /sudah pernah dibalik|bisa dibalik/i);
});
