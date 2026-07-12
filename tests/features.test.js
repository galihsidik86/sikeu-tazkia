'use strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://sikeu:sikeu123@127.0.0.1:55432/sikeu_test';
const test = require('node:test');
const assert = require('node:assert');
const migrate = require('../src/db/migrate');
const db = require('../src/db');
const auth = require('../src/auth');
const piutang = require('../src/services/piutangService');

let U, units = {};

test.before(async () => {
  await migrate({ fresh: true });
  units.STM = (await db.prepare("INSERT INTO units (kode,nama,is_yayasan) VALUES ('STM','STMIK Tazkia',0)").run()).lastInsertRowid;
  units.UNV = (await db.prepare("INSERT INTO units (kode,nama,is_yayasan) VALUES ('UNV','Universitas Tazkia',0)").run()).lastInsertRowid;
  const uid = (await db.prepare("INSERT INTO users (nama,email,password_hash,role,aktif) VALUES ('S','s@x',?,'admin',1)").run(auth.hashPassword('sikeu123'))).lastInsertRowid;
  U = { id: uid, nama: 'S', role: 'admin', ip: '127.0.0.1' };
});
test.after(async () => { await db.close(); });

// ---- Ganti password mandiri ----
test('changePassword menolak sandi lama yang salah', async () => {
  await assert.rejects(() => auth.changePassword(U.id, 'salah', 'barubaru1'), /lama salah/i);
});
test('changePassword menolak sandi baru < 8 karakter', async () => {
  await assert.rejects(() => auth.changePassword(U.id, 'sikeu123', 'pendek'), /minimal 8/i);
});
test('changePassword menolak sandi baru sama dengan lama', async () => {
  await assert.rejects(() => auth.changePassword(U.id, 'sikeu123', 'sikeu123'), /berbeda/i);
});
test('changePassword sukses lalu authenticate dgn sandi baru', async () => {
  await auth.changePassword(U.id, 'sikeu123', 'sikeu-baru-99');
  assert.ok(await auth.authenticate('s@x', 'sikeu-baru-99'));
  assert.strictEqual(await auth.authenticate('s@x', 'sikeu123'), null);
});

// ---- Impor mahasiswa CSV ----
test('importStudents: valid masuk, duplikat & unit salah dilewati', async () => {
  await db.prepare("INSERT INTO students (nim,nama,unit_id,status) VALUES ('2201001','Ada',?,'aktif')").run(units.STM);
  const r = await piutang.importStudents(U, { students: [
    { nim: '2301099', nama: 'Test Import', prodi: 'TI', unit: 'STM', angkatan: '2023' }, // valid
    { nim: '2201001', nama: 'Dup', unit: 'STM' },        // sudah ada
    { nim: '2301098', nama: 'BadUnit', unit: 'ZZZ' },    // unit tak dikenal
    { nim: '2301099', nama: 'DupInFile', unit: 'STM' },  // duplikat di berkas
    { nim: '', nama: 'Kosong', unit: 'STM' },            // nim kosong
  ] });
  assert.strictEqual(r.total, 5);
  assert.strictEqual(r.inserted, 1);
  assert.strictEqual(r.skipped, 4);
  assert.strictEqual(r.errors.length, 4);
  const s = await db.prepare("SELECT * FROM students WHERE nim='2301099'").get();
  assert.strictEqual(s.nama, 'Test Import');
  assert.strictEqual(s.unit_id, units.STM);
});
test('importStudents menerima nama unit lengkap, bukan hanya kode', async () => {
  const r = await piutang.importStudents(U, { students: [{ nim: '2402001', nama: 'Via Nama', unit: 'Universitas Tazkia' }] });
  assert.strictEqual(r.inserted, 1);
  const s = await db.prepare("SELECT unit_id FROM students WHERE nim='2402001'").get();
  assert.strictEqual(s.unit_id, units.UNV);
});
test('importStudents menolak daftar kosong', async () => {
  await assert.rejects(() => piutang.importStudents(U, { students: [] }), /tidak ada baris/i);
});
