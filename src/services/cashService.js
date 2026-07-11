'use strict';
const db = require('../db');
const jsvc = require('./journalService');
const audit = require('./audit');
const { toSen } = require('../utils/money');
const { ApiError } = jsvc;

const POSTED = "('posted','reversed')";

// Saldo buku sebuah rekening = saldo akun buku besar terkait, disaring per unit rekening.
async function bookBalance(accountId, unitId) {
  const r = await db.prepare(`
    SELECT COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.kredit),0) k
    FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
    WHERE jl.account_id=? AND jl.unit_id=? AND j.status IN ${POSTED}`).get(accountId, unitId);
  return r.d - r.k;
}

async function listBankAccounts(unitId) {
  const params = []; let where = '1=1';
  if (unitId) { where += ' AND ba.unit_id=?'; params.push(unitId); }
  const rows = await db.prepare(`
    SELECT ba.*, a.kode AS akun_kode, a.nama AS akun_nama, u.kode AS unit_kode, u.nama AS unit_nama
    FROM bank_accounts ba JOIN accounts a ON a.id=ba.account_id JOIN units u ON u.id=ba.unit_id
    WHERE ${where} ORDER BY ba.id`).all(...params);
  const out = [];
  for (const r of rows) out.push({ ...r, saldo: await bookBalance(r.account_id, r.unit_id) });
  return out;
}

async function getBankAccount(id) {
  const ba = await db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(id);
  if (!ba) throw new ApiError(404, 'Rekening tidak ditemukan.');
  return ba;
}

// ---- Mapping kategori kas → akun (dikelola admin) ----
async function listCategories(jenis) {
  const params = []; let where = '1=1';
  if (jenis) { where += ' AND c.jenis=?'; params.push(jenis); }
  return db.prepare(`SELECT c.*, a.kode AS akun_kode, a.nama AS akun_nama
    FROM cash_categories c JOIN accounts a ON a.id=c.account_id
    WHERE ${where} ORDER BY c.jenis, c.urutan, c.id`).all(...params);
}
async function upsertCategory(user, b) {
  if (!['penerimaan', 'pengeluaran'].includes(b.jenis)) throw new ApiError(400, 'Jenis harus penerimaan/pengeluaran.');
  const acc = await db.prepare('SELECT * FROM accounts WHERE id=?').get(b.account_id);
  if (!acc || !acc.is_postable) throw new ApiError(400, 'Akun harus akun postable.');
  if (!b.nama) throw new ApiError(400, 'Nama kategori wajib diisi.');
  if (b.id) {
    await db.prepare('UPDATE cash_categories SET nama=?, account_id=?, jenis=?, aktif=?, urutan=? WHERE id=?')
      .run(b.nama.trim(), b.account_id, b.jenis, b.aktif === false ? 0 : 1, b.urutan || 0, b.id);
  } else {
    await db.prepare('INSERT INTO cash_categories (jenis,nama,account_id,urutan) VALUES (?,?,?,?)')
      .run(b.jenis, b.nama.trim(), b.account_id, b.urutan || 0);
  }
  await audit.log(user, b.id ? 'update' : 'create', 'cash_category', b.id || null, { nama: b.nama }, user.ip);
  return listCategories();
}
async function deleteCategory(user, id) {
  await db.prepare('DELETE FROM cash_categories WHERE id=?').run(id);
  await audit.log(user, 'delete', 'cash_category', id, null, user.ip);
  return listCategories();
}
async function counterpartAccount(p) {
  if (p.category_id) {
    const cat = await db.prepare('SELECT * FROM cash_categories WHERE id=?').get(p.category_id);
    if (!cat || !cat.aktif) throw new ApiError(400, 'Kategori tidak valid/nonaktif.');
    const acc = await db.prepare('SELECT * FROM accounts WHERE id=?').get(cat.account_id);
    return { acc, nama: cat.nama };
  }
  if (p.counterpart_account_id) {
    const acc = await db.prepare('SELECT * FROM accounts WHERE id=?').get(p.counterpart_account_id);
    if (!acc) throw new ApiError(400, 'Akun kategori tidak valid.');
    return { acc, nama: acc.nama };
  }
  throw new ApiError(400, 'Kategori wajib dipilih.');
}

// Penerimaan: (D) rekening — (K) akun lawan. PENDING → disetujui bendahara.
async function createReceipt(user, p) {
  const ba = await getBankAccount(p.bank_account_id);
  const amount = toSen(p.amount);
  if (amount <= 0) throw new ApiError(400, 'Jumlah harus lebih dari nol.');
  const { acc: lawan, nama } = await counterpartAccount(p);
  const deskripsi = `Penerimaan kas — ${nama}${p.catatan && p.catatan.trim() ? ' (' + p.catatan.trim() + ')' : ''}`;
  return jsvc.createPending(user, {
    tanggal: p.tanggal, unit_id: ba.unit_id, deskripsi, sumber: 'penerimaan', ip: p.ip, amountsInSen: true,
    lines: [
      { account_id: ba.account_id, unit_id: ba.unit_id, debit: amount, memo: `Masuk ke ${ba.nama}` },
      { account_id: lawan.id, unit_id: ba.unit_id, kredit: amount },
    ],
  });
}

// Pengeluaran: (D) akun lawan — (K) rekening. PENDING → disetujui bendahara.
async function createPayment(user, p) {
  const ba = await getBankAccount(p.bank_account_id);
  const amount = toSen(p.amount);
  if (amount <= 0) throw new ApiError(400, 'Jumlah harus lebih dari nol.');
  const { acc: lawan, nama } = await counterpartAccount(p);
  const deskripsi = `Pengeluaran kas — ${nama}${p.catatan && p.catatan.trim() ? ' (' + p.catatan.trim() + ')' : ''}`;
  return jsvc.createPending(user, {
    tanggal: p.tanggal, unit_id: ba.unit_id, deskripsi, sumber: 'pengeluaran', ip: p.ip, amountsInSen: true,
    lines: [
      { account_id: lawan.id, unit_id: ba.unit_id, debit: amount },
      { account_id: ba.account_id, unit_id: ba.unit_id, kredit: amount, memo: `Dibayar dari ${ba.nama}` },
    ],
  });
}

async function listCashTransactions(unitId, bankAccountId) {
  const params = [];
  let where = "j.sumber IN ('penerimaan','pengeluaran')";
  if (unitId) { where += ' AND j.unit_id=?'; params.push(unitId); }
  if (bankAccountId) {
    const ba = await getBankAccount(bankAccountId);
    where += ' AND EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.journal_id=j.id AND jl.account_id=? AND jl.unit_id=?)';
    params.push(ba.account_id, ba.unit_id);
  }
  return db.prepare(`
    SELECT j.id, j.nomor, j.tanggal, j.deskripsi, j.sumber, j.status, un.kode AS unit_kode,
           (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE journal_id=j.id) AS total
    FROM journals j JOIN units un ON un.id=j.unit_id
    WHERE ${where} ORDER BY j.tanggal DESC, j.id DESC LIMIT 100`).all(...params);
}

module.exports = { listBankAccounts, getBankAccount, bookBalance, createReceipt, createPayment, listCashTransactions,
  listCategories, upsertCategory, deleteCategory };
