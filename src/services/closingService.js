'use strict';
// Tutup buku tahunan (ISAK 35): menutup akun pendapatan & beban ke Aset Neto.
const db = require('../db');
const jsvc = require('./journalService');
const fin = require('./financialService');
const audit = require('./audit');
const { ApiError } = jsvc;

async function accByKode(kode) {
  const a = await db.prepare('SELECT * FROM accounts WHERE kode=?').get(kode);
  if (!a) throw new ApiError(500, `Akun ${kode} tidak ada di COA.`);
  return a;
}

async function computeUnit(tahun, unitId) {
  const from = `${tahun}-01-01`, to = `${tahun}-12-31`;
  const net = await fin.computeNet({ unitId, from, to });
  const rev = net.rows.filter(r => r.tipe === 'pendapatan');
  const exp = net.rows.filter(r => r.tipe === 'beban');
  const revTotal = -rev.reduce((s, r) => s + r.net, 0);
  const revRestricted = -rev.filter(r => r.net_asset_class === 'dengan').reduce((s, r) => s + r.net, 0);
  const expTotal = exp.reduce((s, r) => s + r.net, 0);
  const surplus = revTotal - expTotal;
  return { from, to, rev, exp, revTotal, revRestricted, expTotal, surplus, surplusRestricted: revRestricted, surplusUnrestricted: surplus - revRestricted };
}

async function preview(tahun) {
  const units = await db.prepare('SELECT * FROM units').all();
  const out = [];
  for (const u of units) {
    const c = await computeUnit(tahun, u.id);
    const closed = await db.prepare('SELECT * FROM year_closings WHERE tahun=? AND unit_id=?').get(tahun, u.id);
    out.push({
      unit_id: u.id, unit_kode: u.kode, unit_nama: u.nama,
      pendapatan: c.revTotal, beban: c.expTotal, surplus: c.surplus,
      surplusTanpa: c.surplusUnrestricted, surplusDengan: c.surplusRestricted,
      sudahDitutup: !!closed, journal_id: closed ? closed.journal_id : null,
      adaAktivitas: c.rev.length > 0 || c.exp.length > 0,
    });
  }
  return out;
}

const closeYear = db.transaction(async (user, tahun) => {
  const units = await db.prepare('SELECT * FROM units').all();
  const results = [];
  for (const u of units) {
    if (await db.prepare('SELECT 1 FROM year_closings WHERE tahun=? AND unit_id=?').get(tahun, u.id)) {
      results.push({ unit: u.kode, skip: 'sudah ditutup' }); continue;
    }
    const c = await computeUnit(tahun, u.id);
    if (!c.rev.length && !c.exp.length) { results.push({ unit: u.kode, skip: 'tidak ada aktivitas' }); continue; }

    const lines = [];
    for (const r of [...c.rev, ...c.exp]) {
      if (r.net === 0) continue;
      if (r.net < 0) lines.push({ account_id: r.id, unit_id: u.id, debit: -r.net });
      else lines.push({ account_id: r.id, unit_id: u.id, kredit: r.net });
    }
    if (c.surplusRestricted > 0) lines.push({ account_id: (await accByKode('3200')).id, unit_id: u.id, kredit: c.surplusRestricted });
    else if (c.surplusRestricted < 0) lines.push({ account_id: (await accByKode('3200')).id, unit_id: u.id, debit: -c.surplusRestricted });
    if (c.surplusUnrestricted > 0) lines.push({ account_id: (await accByKode('3100')).id, unit_id: u.id, kredit: c.surplusUnrestricted });
    else if (c.surplusUnrestricted < 0) lines.push({ account_id: (await accByKode('3100')).id, unit_id: u.id, debit: -c.surplusUnrestricted });

    const j = await jsvc.createPosted(user, {
      tanggal: `${tahun}-12-31`, unit_id: u.id, sumber: 'closing', amountsInSen: true, allowOverBudget: true, ip: user.ip,
      deskripsi: `Jurnal penutup tahun ${tahun} — ${u.nama}`, lines,
    });
    await db.prepare('INSERT INTO year_closings (tahun,unit_id,journal_id,surplus,closed_by) VALUES (?,?,?,?,?)')
      .run(tahun, u.id, j.id, c.surplus, user.id);
    results.push({ unit: u.kode, surplus: c.surplus, journal: j.nomor });
  }
  const ensure = db.prepare("INSERT INTO periods (tahun,bulan,status) VALUES (?,?,'open') ON CONFLICT (tahun,bulan) DO NOTHING");
  for (let m = 1; m <= 12; m++) await ensure.run(tahun, m);
  await db.prepare("UPDATE periods SET status='closed', closed_by=?, closed_at=datetime('now') WHERE tahun=?").run(user.id, tahun);
  await audit.log(user, 'close_year', 'year', tahun, { results }, user.ip);
  return { tahun, results };
});

const reopenYear = db.transaction(async (user, tahun) => {
  const closings = await db.prepare('SELECT * FROM year_closings WHERE tahun=?').all(tahun);
  if (!closings.length) throw new ApiError(409, `Tahun ${tahun} belum ditutup.`);
  await db.prepare("UPDATE periods SET status='open', closed_by=NULL, closed_at=NULL WHERE tahun=?").run(tahun);
  for (const cl of closings) {
    const j = await db.prepare('SELECT * FROM journals WHERE id=?').get(cl.journal_id);
    if (j && j.status === 'posted') {
      const rev = await jsvc.reverse(user, cl.journal_id, user.ip);
      await db.prepare("UPDATE journals SET sumber='closing' WHERE id=?").run(rev.id);
    }
    await db.prepare('DELETE FROM year_closings WHERE id=?').run(cl.id);
  }
  await audit.log(user, 'reopen_year', 'year', tahun, { dibatalkan: closings.length }, user.ip);
  return { tahun, dibatalkan: closings.length };
});

module.exports = { preview, closeYear, reopenYear };
