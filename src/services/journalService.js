'use strict';
const db = require('../db');
const { toSen } = require('../utils/money');
const audit = require('./audit');

// Error yang membawa kode status HTTP
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- Prepared statements ----------
const qAccount = db.prepare('SELECT * FROM accounts WHERE id = ?');
const qUnit = db.prepare('SELECT * FROM units WHERE id = ?');
const qPeriodByYM = db.prepare('SELECT * FROM periods WHERE tahun = ? AND bulan = ?');
const qInsertPeriod = db.prepare("INSERT INTO periods (tahun, bulan, status) VALUES (?, ?, 'open')");
const qJournal = db.prepare('SELECT * FROM journals WHERE id = ?');
const qLines = db.prepare('SELECT * FROM journal_lines WHERE journal_id = ? ORDER BY line_no');
const qCountNomor = db.prepare(
  'SELECT COUNT(*) AS n FROM journals WHERE unit_id = ? AND period_id = ? AND nomor IS NOT NULL');
const qDeleteLines = db.prepare('DELETE FROM journal_lines WHERE journal_id = ?');
const qInsertLine = db.prepare(`
  INSERT INTO journal_lines (journal_id, line_no, account_id, unit_id, debit, kredit, memo)
  VALUES (@journal_id, @line_no, @account_id, @unit_id, @debit, @kredit, @memo)`);

// ---------- Periode ----------
async function ensurePeriod(tanggal) {
  const d = parseDate(tanggal);
  let p = await qPeriodByYM.get(d.tahun, d.bulan);
  if (!p) {
    await qInsertPeriod.run(d.tahun, d.bulan);
    p = await qPeriodByYM.get(d.tahun, d.bulan);
  }
  return p;
}
function parseDate(tanggal) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(tanggal || '').trim());
  if (!m) throw new ApiError(400, 'Tanggal harus format YYYY-MM-DD.');
  return { tahun: +m[1], bulan: +m[2], hari: +m[3] };
}

// ---------- Validasi baris & keseimbangan ----------
async function normalizeLines(rawLines, journalUnitId, alreadySen = false) {
  if (!Array.isArray(rawLines) || rawLines.length < 2) {
    throw new ApiError(400, 'Jurnal minimal memiliki 2 baris.');
  }
  const conv = alreadySen ? (v) => Math.round(Number(v) || 0) : toSen;
  const lines = [];
  let totalDebit = 0, totalKredit = 0, lineNo = 0;
  for (const raw of rawLines) {
    const debit = conv(raw.debit);
    const kredit = conv(raw.kredit);
    if (debit === 0 && kredit === 0) continue;
    if (debit > 0 && kredit > 0) throw new ApiError(400, 'Satu baris tidak boleh mengisi debit dan kredit sekaligus.');
    if (debit < 0 || kredit < 0) throw new ApiError(400, 'Nilai debit/kredit tidak boleh negatif.');
    const acc = await qAccount.get(raw.account_id);
    if (!acc) throw new ApiError(400, `Akun (id ${raw.account_id}) tidak ditemukan.`);
    if (!acc.is_postable) throw new ApiError(400, `Akun ${acc.kode} — ${acc.nama} adalah akun induk, tidak bisa dijurnal.`);
    if (!acc.aktif) throw new ApiError(400, `Akun ${acc.kode} nonaktif.`);
    const unit_id = raw.unit_id || journalUnitId;
    if (!unit_id) throw new ApiError(400, 'Setiap baris jurnal wajib memiliki unit (dimensi).');
    if (!await qUnit.get(unit_id)) throw new ApiError(400, `Unit (id ${unit_id}) tidak ditemukan.`);

    lines.push({ line_no: ++lineNo, account_id: acc.id, unit_id, debit, kredit, memo: (raw.memo || '').trim() || null });
    totalDebit += debit; totalKredit += kredit;
  }
  if (lines.length < 2) throw new ApiError(400, 'Jurnal minimal memiliki 2 baris berisi nilai.');
  return { lines, totalDebit, totalKredit };
}

// Aturan Fase 4: posting beban tidak boleh melampaui pagu RKAT yang sudah DISAHKAN.
async function assertWithinBudget(lines, tanggal) {
  const budget = require('./budgetService');
  const tahun = +String(tanggal).slice(0, 4);
  const agg = new Map();
  for (const l of lines) {
    const key = l.account_id + '|' + l.unit_id;
    agg.set(key, (agg.get(key) || 0) + (l.debit - l.kredit));
  }
  for (const [key, net] of agg) {
    if (net <= 0) continue;
    const [account_id, unit_id] = key.split('|').map(Number);
    const bl = await budget.getBudgetLine(tahun, unit_id, account_id);
    if (!bl || bl.status !== 'disahkan' || bl.tipe !== 'beban') continue;
    const current = await budget.realisasi(account_id, unit_id, tahun, 'D');
    if (current + net > bl.nominal) {
      throw new ApiError(409,
        `Transaksi ditolak — melampaui pagu anggaran ${bl.kode} ${bl.nama}. ` +
        `Pagu Rp ${(bl.nominal / 100).toLocaleString('id-ID')}, realisasi menjadi Rp ${((current + net) / 100).toLocaleString('id-ID')}.`);
    }
  }
}

function assertBalanced(totalDebit, totalKredit) {
  if (totalDebit !== totalKredit) {
    throw new ApiError(400,
      `Jurnal tidak balance: total debit (${totalDebit / 100}) ≠ total kredit (${totalKredit / 100}). Jurnal ditolak.`);
  }
  if (totalDebit === 0) throw new ApiError(400, 'Total jurnal tidak boleh nol.');
}

async function saveLines(journalId, lines) {
  await qDeleteLines.run(journalId);
  for (const l of lines) await qInsertLine.run({ ...l, journal_id: journalId });
}

// ---------- Nomor otomatis: JU/<unit>/<tahun>-<bulan>/<urut4> ----------
async function generateNomor(journal) {
  const unit = await qUnit.get(journal.unit_id);
  const p = await db.prepare('SELECT * FROM periods WHERE id = ?').get(journal.period_id);
  const n = (await qCountNomor.get(journal.unit_id, journal.period_id)).n + 1;
  const bulan2 = String(p.bulan).padStart(2, '0');
  const seq4 = String(n).padStart(4, '0');
  return `JU/${unit.kode}/${p.tahun}-${bulan2}/${seq4}`;
}

// ============================================================================
//  Operasi publik (masing-masing atomik lewat transaksi)
// ============================================================================
const createDraft = db.transaction(async (user, payload) => {
  const { tanggal, unit_id, deskripsi } = payload;
  if (!deskripsi || !String(deskripsi).trim()) throw new ApiError(400, 'Deskripsi wajib diisi.');
  if (!unit_id || !await qUnit.get(unit_id)) throw new ApiError(400, 'Unit utama tidak valid.');
  const period = await ensurePeriod(tanggal);
  const { lines } = await normalizeLines(payload.lines || [], unit_id, payload.amountsInSen);

  const info = await db.prepare(`
    INSERT INTO journals (tanggal, deskripsi, unit_id, period_id, status, sumber, created_by)
    VALUES (?, ?, ?, ?, 'draft', ?, ?)`
  ).run(tanggal, String(deskripsi).trim(), unit_id, period.id, payload.sumber || 'manual', user.id);
  const journalId = info.lastInsertRowid;
  await saveLines(journalId, lines);
  await audit.log(user, 'create', 'journal', journalId, { deskripsi, status: 'draft' }, payload.ip);
  return getJournal(journalId);
});

const createPending = db.transaction(async (user, payload) => {
  const draft = await createDraft(user, payload);
  return submit(user, draft.id, payload.ip);
});

const updateDraft = db.transaction(async (user, journalId, payload) => {
  const j = await qJournal.get(journalId);
  if (!j) throw new ApiError(404, 'Jurnal tidak ditemukan.');
  if (j.status !== 'draft') throw new ApiError(409, `Jurnal berstatus "${j.status}" tidak bisa diubah. Hanya draft yang dapat diedit.`);
  const unit_id = payload.unit_id || j.unit_id;
  if (!await qUnit.get(unit_id)) throw new ApiError(400, 'Unit utama tidak valid.');
  const tanggal = payload.tanggal || j.tanggal;
  const period = await ensurePeriod(tanggal);
  const deskripsi = (payload.deskripsi != null ? payload.deskripsi : j.deskripsi);
  if (!deskripsi || !String(deskripsi).trim()) throw new ApiError(400, 'Deskripsi wajib diisi.');
  const { lines } = await normalizeLines(payload.lines || [], unit_id);

  await db.prepare(`UPDATE journals SET tanggal=?, deskripsi=?, unit_id=?, period_id=?, updated_at=datetime('now') WHERE id=?`)
    .run(tanggal, String(deskripsi).trim(), unit_id, period.id, journalId);
  await saveLines(journalId, lines);
  await audit.log(user, 'update', 'journal', journalId, { deskripsi }, payload.ip);
  return getJournal(journalId);
});

const deleteDraft = db.transaction(async (user, journalId, ip) => {
  const j = await qJournal.get(journalId);
  if (!j) throw new ApiError(404, 'Jurnal tidak ditemukan.');
  if (j.status !== 'draft') throw new ApiError(409, `Jurnal berstatus "${j.status}" tidak bisa dihapus. Koreksi lewat jurnal balik.`);
  await db.prepare('DELETE FROM journals WHERE id = ?').run(journalId);
  await audit.log(user, 'delete', 'journal', journalId, { deskripsi: j.deskripsi }, ip);
  return { deleted: true };
});

const submit = db.transaction(async (user, journalId, ip) => {
  const j = await qJournal.get(journalId);
  if (!j) throw new ApiError(404, 'Jurnal tidak ditemukan.');
  if (j.status !== 'draft') throw new ApiError(409, `Hanya draft yang bisa diajukan (status kini: ${j.status}).`);
  await assertPeriodOpen(j.period_id);
  const { totalDebit, totalKredit } = await sumLines(journalId);
  assertBalanced(totalDebit, totalKredit);
  const nomor = j.nomor || await generateNomor(j);
  await db.prepare(`UPDATE journals SET status='pending', nomor=?, submitted_by=?, updated_at=datetime('now') WHERE id=?`)
    .run(nomor, user.id, journalId);
  await audit.log(user, 'submit', 'journal', journalId, { nomor }, ip);
  return getJournal(journalId);
});

const approve = db.transaction(async (user, journalId, ip, force) => {
  const j = await qJournal.get(journalId);
  if (!j) throw new ApiError(404, 'Jurnal tidak ditemukan.');
  if (j.status !== 'pending') throw new ApiError(409, `Hanya jurnal "pending" yang bisa disetujui (status kini: ${j.status}).`);
  await assertPeriodOpen(j.period_id);
  const { totalDebit, totalKredit } = await sumLines(journalId);
  assertBalanced(totalDebit, totalKredit);
  if (!force) await assertWithinBudget(await qLines.all(journalId), j.tanggal);
  await db.prepare(`UPDATE journals SET status='posted', approved_by=?, posted_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(user.id, journalId);
  await audit.log(user, 'approve', 'journal', journalId, { nomor: j.nomor }, ip);
  await audit.log(user, 'post', 'journal', journalId, { nomor: j.nomor }, ip);
  return getJournal(journalId);
});

const reject = db.transaction(async (user, journalId, alasan, ip) => {
  const j = await qJournal.get(journalId);
  if (!j) throw new ApiError(404, 'Jurnal tidak ditemukan.');
  if (j.status !== 'pending') throw new ApiError(409, `Hanya jurnal "pending" yang bisa ditolak (status kini: ${j.status}).`);
  await db.prepare(`UPDATE journals SET status='rejected', rejected_by=?, reject_alasan=?, updated_at=datetime('now') WHERE id=?`)
    .run(user.id, (alasan || '').trim() || null, journalId);
  await audit.log(user, 'reject', 'journal', journalId, { alasan }, ip);
  return getJournal(journalId);
});

const reverse = db.transaction(async (user, journalId, ip) => {
  const j = await qJournal.get(journalId);
  if (!j) throw new ApiError(404, 'Jurnal tidak ditemukan.');
  if (j.status !== 'posted') throw new ApiError(409, `Hanya jurnal "posted" yang bisa dibalik (status kini: ${j.status}).`);
  if (j.reversed_by) throw new ApiError(409, 'Jurnal ini sudah pernah dibalik.');
  await assertPeriodOpen(j.period_id);

  const origLines = await qLines.all(journalId);
  const info = await db.prepare(`
    INSERT INTO journals (tanggal, deskripsi, unit_id, period_id, status, sumber, created_by,
                          submitted_by, approved_by, posted_at, reversal_of)
    VALUES (?, ?, ?, ?, 'posted', 'reversal', ?, ?, ?, datetime('now'), ?)`
  ).run(j.tanggal, `Pembalik atas ${j.nomor}: ${j.deskripsi}`, j.unit_id, j.period_id, user.id, user.id, user.id, journalId);
  const revId = info.lastInsertRowid;
  const nomor = await generateNomor(await qJournal.get(revId));
  await db.prepare('UPDATE journals SET nomor=? WHERE id=?').run(nomor, revId);
  const swapped = origLines.map((l, i) => ({
    line_no: i + 1, account_id: l.account_id, unit_id: l.unit_id, debit: l.kredit, kredit: l.debit, memo: l.memo,
  }));
  for (const l of swapped) await qInsertLine.run({ ...l, journal_id: revId });
  await db.prepare(`UPDATE journals SET status='reversed', reversed_by=?, updated_at=datetime('now') WHERE id=?`).run(revId, journalId);
  await audit.log(user, 'reverse', 'journal', journalId, { pembalik: nomor, reversal_id: revId }, ip);
  return getJournal(revId);
});

const createPosted = db.transaction(async (user, payload) => {
  const { tanggal, unit_id, deskripsi, sumber } = payload;
  if (!deskripsi || !String(deskripsi).trim()) throw new ApiError(400, 'Deskripsi wajib diisi.');
  if (!unit_id || !await qUnit.get(unit_id)) throw new ApiError(400, 'Unit tidak valid.');
  const period = await ensurePeriod(tanggal);
  await assertPeriodOpen(period.id);
  const { lines, totalDebit, totalKredit } = await normalizeLines(payload.lines || [], unit_id, payload.amountsInSen);
  assertBalanced(totalDebit, totalKredit);
  if (!payload.allowOverBudget) await assertWithinBudget(lines, tanggal);

  const info = await db.prepare(`
    INSERT INTO journals (tanggal, deskripsi, unit_id, period_id, status, sumber,
                          created_by, submitted_by, approved_by, posted_at)
    VALUES (?, ?, ?, ?, 'posted', ?, ?, ?, ?, datetime('now'))`
  ).run(tanggal, String(deskripsi).trim(), unit_id, period.id, sumber || 'manual', user.id, user.id, user.id);
  const journalId = info.lastInsertRowid;
  const nomor = await generateNomor(await qJournal.get(journalId));
  await db.prepare('UPDATE journals SET nomor=? WHERE id=?').run(nomor, journalId);
  await saveLines(journalId, lines);
  await audit.log(user, 'create', 'journal', journalId, { deskripsi, sumber, status: 'posted' }, payload.ip);
  await audit.log(user, 'post', 'journal', journalId, { nomor }, payload.ip);
  return getJournal(journalId);
});

// ---------- Helper baca ----------
async function assertPeriodOpen(periodId) {
  const p = await db.prepare('SELECT * FROM periods WHERE id=?').get(periodId);
  if (!p) throw new ApiError(400, 'Periode tidak ditemukan.');
  if (p.status === 'closed') {
    throw new ApiError(409, `Periode ${p.tahun}-${String(p.bulan).padStart(2, '0')} sudah ditutup. Posting ditolak.`);
  }
  return p;
}
async function sumLines(journalId) {
  const r = await db.prepare(
    'SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(kredit),0) AS k FROM journal_lines WHERE journal_id=?').get(journalId);
  return { totalDebit: r.d, totalKredit: r.k };
}
async function getJournal(journalId) {
  const j = await qJournal.get(journalId);
  if (!j) return null;
  const lines = await db.prepare(`
    SELECT jl.*, a.kode AS akun_kode, a.nama AS akun_nama, u.kode AS unit_kode, u.nama AS unit_nama
    FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id JOIN units u ON u.id = jl.unit_id
    WHERE jl.journal_id = ? ORDER BY jl.line_no`).all(journalId);
  const { totalDebit, totalKredit } = await sumLines(journalId);
  return { ...j, lines, totalDebit, totalKredit };
}

module.exports = {
  ApiError,
  createDraft, updateDraft, deleteDraft, submit, approve, reject, reverse, createPosted, createPending,
  getJournal, ensurePeriod, normalizeLines, assertBalanced,
};
