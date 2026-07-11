'use strict';
const db = require('../db');

// Jurnal yang punya efek buku besar: 'posted' dan 'reversed'.
const POSTED = "('posted','reversed')";

// ---------- Neraca Saldo (Trial Balance) ----------
async function trialBalance(opts = {}) {
  const { unitId = null, tahun = null, bulan = null } = opts;
  const params = {};
  let where = `j.status IN ${POSTED}`;
  if (unitId) { where += ' AND jl.unit_id = @unitId'; params.unitId = unitId; }
  if (tahun && bulan) {
    where += ' AND j.tanggal <= @cutoff';
    params.cutoff = `${tahun}-${String(bulan).padStart(2, '0')}-31`;
  }
  // Catatan PostgreSQL: HAVING tidak boleh memakai alias SELECT → pakai ekspresi agregat.
  const rows = await db.prepare(`
    SELECT a.id, a.kode, a.nama, a.tipe, a.normal_balance, a.is_interunit,
           COALESCE(SUM(jl.debit),0)  AS sum_debit,
           COALESCE(SUM(jl.kredit),0) AS sum_kredit
    FROM accounts a
    JOIN journal_lines jl ON jl.account_id = a.id
    JOIN journals j ON j.id = jl.journal_id
    WHERE ${where}
    GROUP BY a.id
    HAVING COALESCE(SUM(jl.debit),0) <> COALESCE(SUM(jl.kredit),0)
    ORDER BY a.kode
  `).all(params);

  let totalDebit = 0, totalKredit = 0;
  const out = rows.map(r => {
    const net = r.sum_debit - r.sum_kredit;
    const debit = net >= 0 ? net : 0;
    const kredit = net < 0 ? -net : 0;
    totalDebit += debit; totalKredit += kredit;
    return { account_id: r.id, kode: r.kode, nama: r.nama, tipe: r.tipe,
      normal_balance: r.normal_balance, is_interunit: !!r.is_interunit, debit, kredit };
  });
  return { rows: out, totalDebit, totalKredit, balanced: totalDebit === totalKredit };
}

// ---------- Buku Besar (General Ledger) per akun ----------
async function ledger(opts = {}) {
  const { accountId, unitId = null, from = null, to = null } = opts;
  const acc = await db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId);
  if (!acc) throw new Error('Akun tidak ditemukan.');

  const base = { accountId };
  let unitClause = '';
  if (unitId) { unitClause = ' AND jl.unit_id = @unitId'; base.unitId = unitId; }

  let opening = 0;
  if (from) {
    const o = await db.prepare(`
      SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.kredit),0) AS k
      FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id
      WHERE jl.account_id=@accountId AND j.status IN ${POSTED} AND j.tanggal < @from ${unitClause}
    `).get({ ...base, from });
    opening = o.d - o.k;
  }

  const p = { ...base };
  let dateClause = '';
  if (from) { dateClause += ' AND j.tanggal >= @from'; p.from = from; }
  if (to) { dateClause += ' AND j.tanggal <= @to'; p.to = to; }

  const moves = await db.prepare(`
    SELECT j.id AS journal_id, j.nomor, j.tanggal, j.deskripsi, j.status,
           jl.debit, jl.kredit, jl.memo, u.kode AS unit_kode
    FROM journal_lines jl
    JOIN journals j ON j.id = jl.journal_id
    JOIN units u ON u.id = jl.unit_id
    WHERE jl.account_id=@accountId AND j.status IN ${POSTED} ${unitClause} ${dateClause}
    ORDER BY j.tanggal, j.id, jl.line_no
  `).all(p);

  let running = opening;
  const rows = moves.map(m => { running += (m.debit - m.kredit); return { ...m, saldo: running }; });
  const totalDebit = moves.reduce((s, m) => s + m.debit, 0);
  const totalKredit = moves.reduce((s, m) => s + m.kredit, 0);
  return {
    account: { id: acc.id, kode: acc.kode, nama: acc.nama, tipe: acc.tipe, normal_balance: acc.normal_balance },
    opening, rows, totalDebit, totalKredit, closing: running,
  };
}

// ---------- Pemeriksaan akun antar-unit (harus nol saat konsolidasi) ----------
async function interunitCheck(opts = {}) {
  const { tahun = null, bulan = null } = opts;
  const params = {};
  let cutoff = '';
  if (tahun && bulan) { cutoff = ' AND j.tanggal <= @cutoff'; params.cutoff = `${tahun}-${String(bulan).padStart(2, '0')}-31`; }
  const rows = await db.prepare(`
    SELECT a.id, a.kode, a.nama,
           COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.kredit),0) AS net
    FROM accounts a
    JOIN journal_lines jl ON jl.account_id = a.id
    JOIN journals j ON j.id = jl.journal_id
    WHERE a.is_interunit = 1 AND j.status IN ${POSTED} ${cutoff}
    GROUP BY a.id ORDER BY a.kode
  `).all(params);
  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  return { rows, totalNet, balanced: totalNet === 0 };
}

module.exports = { trialBalance, ledger, interunitCheck };
