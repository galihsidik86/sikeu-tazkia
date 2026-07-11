'use strict';
const db = require('../db');
const { toSen } = require('../utils/money');
const { getBankAccount, bookBalance } = require('./cashService');
const audit = require('./audit');
const { ApiError } = require('./journalService');

const POSTED = "('posted','reversed')";

const detectDelim = (line) => (line.match(/;/g) || []).length > (line.match(/,/g) || []).length ? ';' : ',';
const splitLine = (l, delim) => l.split(delim).map(c => c.trim().replace(/^"|"$/g, ''));

function parseHeaders(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new ApiError(400, 'CSV kosong.');
  const delim = detectDelim(lines[0]);
  return { delimiter: delim, columns: splitLine(lines[0], delim), sample: lines.slice(1, 4).map(l => splitLine(l, delim)) };
}

function parseCsv(text, mapping) {
  const linesRaw = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!linesRaw.length) throw new ApiError(400, 'CSV kosong.');
  const delim = detectDelim(linesRaw[0]);
  const header = splitLine(linesRaw[0], delim);
  const headerLc = header.map(c => c.toLowerCase());
  let idx, start;
  if (mapping && (mapping.tanggal || mapping.debit || mapping.kredit)) {
    const col = (name) => name ? header.indexOf(name) : -1;
    idx = { tanggal: col(mapping.tanggal), keterangan: col(mapping.keterangan), debit: col(mapping.debit), kredit: col(mapping.kredit) };
    if (idx.tanggal < 0) throw new ApiError(400, 'Kolom tanggal pada pemetaan tidak ditemukan di CSV.');
    if (idx.debit < 0 && idx.kredit < 0) throw new ApiError(400, 'Pemetaan kolom debit/kredit tidak valid.');
    start = 1;
  } else {
    const known = ['tanggal', 'keterangan', 'debit', 'kredit'];
    const hasHeader = headerLc.some(c => known.includes(c));
    idx = hasHeader
      ? { tanggal: headerLc.indexOf('tanggal'), keterangan: headerLc.indexOf('keterangan'), debit: headerLc.indexOf('debit'), kredit: headerLc.indexOf('kredit') }
      : { tanggal: 0, keterangan: 1, debit: 2, kredit: 3 };
    start = hasHeader ? 1 : 0;
  }
  const rows = [];
  for (let i = start; i < linesRaw.length; i++) {
    const c = splitLine(linesRaw[i], delim);
    const tanggal = normDate(c[idx.tanggal]);
    if (!tanggal) continue;
    rows.push({
      tanggal,
      keterangan: idx.keterangan >= 0 ? (c[idx.keterangan] || '') : '',
      debit: idx.debit >= 0 ? toSen(c[idx.debit]) : 0,
      kredit: idx.kredit >= 0 ? toSen(c[idx.kredit]) : 0,
    });
  }
  if (!rows.length) throw new ApiError(400, 'Tidak ada baris mutasi yang valid pada CSV.');
  return rows;
}
function normDate(s) {
  if (!s) return null;
  s = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${p2(m[2])}-${p2(m[1])}`;
  return null;
}
const p2 = (n) => String(n).padStart(2, '0');

async function importStatements(user, bankAccountId, csvText, replace, mapping) {
  const ba = await getBankAccount(bankAccountId);
  const rows = parseCsv(csvText, mapping);
  await db.tx(async () => {
    if (replace) await db.prepare('DELETE FROM bank_statements WHERE bank_account_id=?').run(ba.id);
    const stmt = db.prepare('INSERT INTO bank_statements (bank_account_id,tanggal,keterangan,debit,kredit) VALUES (?,?,?,?,?)');
    for (const r of rows) await stmt.run(ba.id, r.tanggal, r.keterangan, r.debit, r.kredit);
  });
  await audit.log(user, 'import', 'bank_statement', ba.id, { rekening: ba.nama, jumlah: rows.length }, user.ip);
  const matched = await autoMatch(ba.id);
  return { imported: rows.length, matched };
}

async function bookLines(ba) {
  return db.prepare(`
    SELECT jl.id, j.tanggal, j.nomor, j.deskripsi, jl.debit, jl.kredit
    FROM journal_lines jl JOIN journals j ON j.id=jl.journal_id
    WHERE jl.account_id=? AND jl.unit_id=? AND j.status IN ${POSTED}
    ORDER BY j.tanggal, j.id`).all(ba.account_id, ba.unit_id);
}

const TOLERANSI_HARI = 3;
function dayDiff(a, b) { return Math.abs(Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000)); }

async function autoMatch(bankAccountId) {
  const ba = await getBankAccount(bankAccountId);
  const stmts = await db.prepare('SELECT * FROM bank_statements WHERE bank_account_id=? AND matched_journal_line IS NULL').all(ba.id);
  const used = new Set(
    (await db.prepare('SELECT matched_journal_line m FROM bank_statements WHERE bank_account_id=? AND matched_journal_line IS NOT NULL').all(ba.id)).map(r => r.m));
  const lines = await bookLines(ba);
  let matched = 0;
  const upd = db.prepare('UPDATE bank_statements SET matched_journal_line=? WHERE id=?');
  await db.tx(async () => {
    for (const s of stmts) {
      const cand = lines
        .filter(l => !used.has(l.id) &&
          ((s.debit > 0 && l.debit === s.debit) || (s.kredit > 0 && l.kredit === s.kredit)) &&
          dayDiff(l.tanggal, s.tanggal) <= TOLERANSI_HARI)
        .sort((a, b) => dayDiff(a.tanggal, s.tanggal) - dayDiff(b.tanggal, s.tanggal));
      if (!cand.length) continue;
      const pick = cand[0];
      await upd.run(pick.id, s.id); used.add(pick.id); matched++;
    }
  });
  return matched;
}

async function manualMatch(user, bankAccountId, statementId, journalLineId) {
  const ba = await getBankAccount(bankAccountId);
  const s = await db.prepare('SELECT * FROM bank_statements WHERE id=? AND bank_account_id=?').get(statementId, ba.id);
  if (!s) throw new ApiError(404, 'Baris mutasi tidak ditemukan.');
  const l = await db.prepare('SELECT * FROM journal_lines WHERE id=? AND account_id=? AND unit_id=?').get(journalLineId, ba.account_id, ba.unit_id);
  if (!l) throw new ApiError(400, 'Baris buku tidak sesuai rekening ini.');
  const ok = (s.debit > 0 && l.debit === s.debit) || (s.kredit > 0 && l.kredit === s.kredit);
  if (!ok) throw new ApiError(400, 'Nominal/arah mutasi tidak cocok dengan baris buku.');
  const dup = await db.prepare('SELECT 1 FROM bank_statements WHERE matched_journal_line=? AND id<>?').get(journalLineId, statementId);
  if (dup) throw new ApiError(409, 'Baris buku sudah dicocokkan dengan mutasi lain.');
  await db.prepare('UPDATE bank_statements SET matched_journal_line=? WHERE id=?').run(journalLineId, statementId);
  return { ok: true };
}

async function unmatch(user, bankAccountId, statementId) {
  const ba = await getBankAccount(bankAccountId);
  await db.prepare('UPDATE bank_statements SET matched_journal_line=NULL WHERE id=? AND bank_account_id=?').run(statementId, ba.id);
  return { ok: true };
}

async function clearStatements(user, bankAccountId) {
  const ba = await getBankAccount(bankAccountId);
  const n = (await db.prepare('DELETE FROM bank_statements WHERE bank_account_id=?').run(ba.id)).changes;
  await audit.log(user, 'clear', 'bank_statement', ba.id, { rekening: ba.nama, dihapus: n }, user.ip);
  return { cleared: n };
}

async function getReconciliation(bankAccountId) {
  const ba = await getBankAccount(bankAccountId);
  const acc = await db.prepare('SELECT kode,nama FROM accounts WHERE id=?').get(ba.account_id);
  const unit = await db.prepare('SELECT kode,nama FROM units WHERE id=?').get(ba.unit_id);
  const stmts = await db.prepare('SELECT * FROM bank_statements WHERE bank_account_id=? ORDER BY tanggal, id').all(ba.id);
  const matchedLineIds = new Set(stmts.filter(s => s.matched_journal_line).map(s => s.matched_journal_line));
  const lines = (await bookLines(ba)).map(l => ({ ...l, matched: matchedLineIds.has(l.id) }));

  const stmtRows = stmts.map(s => ({
    id: s.id, tanggal: s.tanggal, keterangan: s.keterangan, debit: s.debit, kredit: s.kredit,
    matched: !!s.matched_journal_line, matched_journal_line: s.matched_journal_line,
  }));
  const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
  const saldoBuku = await bookBalance(ba.account_id, ba.unit_id);
  const totalMutasiBank = sum(stmtRows, s => s.debit - s.kredit);
  const unmatchedBank = sum(stmtRows.filter(s => !s.matched), s => s.debit - s.kredit);
  const unmatchedBuku = sum(lines.filter(l => !l.matched), l => l.debit - l.kredit);

  return {
    bank_account: { id: ba.id, nama: ba.nama, no_rekening: ba.no_rekening, bank: ba.bank },
    account: acc, unit, statements: stmtRows, book: lines, saldoBuku, totalMutasiBank,
    unmatchedBankCount: stmtRows.filter(s => !s.matched).length,
    unmatchedBukuCount: lines.filter(l => !l.matched).length,
    unmatchedBank, unmatchedBuku, selisih: unmatchedBuku - unmatchedBank,
    reconciled: stmtRows.every(s => s.matched) && lines.every(l => l.matched),
  };
}

module.exports = { parseCsv, parseHeaders, importStatements, autoMatch, manualMatch, unmatch, clearStatements, getReconciliation };
