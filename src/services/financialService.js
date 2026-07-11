'use strict';
// Laporan Keuangan ISAK 35 (entitas nonlaba): Posisi Keuangan, Penghasilan Komprehensif,
// Perubahan Aset Neto, dan Arus Kas (metode tidak langsung). Nilai dalam sen.
const db = require('../db');

const POSTED = "('posted','reversed')";

async function computeNet({ unitId = null, from = null, to = null, excludeInterunit = false, excludeClosing = false }) {
  const params = [];
  let where = `j.status IN ${POSTED}`;
  if (unitId) { where += ' AND jl.unit_id=?'; params.push(unitId); }
  if (from) { where += ' AND j.tanggal>=?'; params.push(from); }
  if (to) { where += ' AND j.tanggal<=?'; params.push(to); }
  if (excludeInterunit) where += ' AND a.is_interunit=0';
  if (excludeClosing) where += " AND j.sumber <> 'closing'";
  const rows = await db.prepare(`
    SELECT a.id, a.kode, a.nama, a.tipe, a.normal_balance, a.is_kontra, a.is_interunit, a.net_asset_class,
           COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.kredit),0) AS net
    FROM accounts a JOIN journal_lines jl ON jl.account_id=a.id JOIN journals j ON j.id=jl.journal_id
    WHERE ${where} GROUP BY a.id ORDER BY a.kode`).all(...params);
  const byKode = {};
  for (const r of rows) byKode[r.kode] = r.net;
  return { rows, byKode, N: (kode) => byKode[kode] || 0 };
}

const dayBefore = (iso) => new Date(Date.parse(iso + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
async function unitName(unitId) {
  if (!unitId) return 'Konsolidasi seluruh unit';
  return (await db.prepare('SELECT kode,nama FROM units WHERE id=?').get(unitId)).nama;
}

async function position({ unitId = null, asOf }) {
  const net = await computeNet({ unitId, to: asOf, excludeInterunit: !unitId });
  const aset = net.rows.filter(r => r.tipe === 'aset');
  const liab = net.rows.filter(r => r.tipe === 'liabilitas');
  const totalAset = aset.reduce((s, r) => s + r.net, 0);
  const totalLiab = -liab.reduce((s, r) => s + r.net, 0);
  const restrictedNA = -(net.N('3200') + net.N('4300'));
  const totalNA = totalAset - totalLiab;
  const unrestrictedNA = totalNA - restrictedNA;
  const revUnrestricted = -net.rows.filter(r => r.tipe === 'pendapatan' && r.net_asset_class !== 'dengan').reduce((s, r) => s + r.net, 0);
  const expenseTotal = net.rows.filter(r => r.tipe === 'beban').reduce((s, r) => s + r.net, 0);
  const realNA = -(net.N('3100') + net.N('3300') + net.N('3200') + net.N('4300')) + revUnrestricted - expenseTotal;
  const selisih = totalNA - realNA;

  const R = [];
  const grp = (label, list, sign) => {
    if (!list.length) return;
    R.push({ label, bold: true });
    for (const r of list) if (r.net !== 0) R.push({ label: `${r.kode} ${r.nama}`, indent: 1, values: [sign * r.net] });
  };
  R.push({ label: 'ASET', section: true });
  grp('Aset Lancar', aset.filter(r => r.kode < '1200'), 1);
  grp('Aset Tidak Lancar', aset.filter(r => r.kode >= '1200'), 1);
  R.push({ label: 'JUMLAH ASET', bold: true, rule: true, values: [totalAset] });
  R.push({ label: 'LIABILITAS', section: true });
  grp('Liabilitas Jangka Pendek', liab.filter(r => r.kode < '2200'), -1);
  grp('Liabilitas Jangka Panjang', liab.filter(r => r.kode >= '2200'), -1);
  R.push({ label: 'Jumlah Liabilitas', bold: true, values: [totalLiab] });
  R.push({ label: 'ASET NETO', section: true });
  R.push({ label: 'Tanpa Pembatasan dari Pemberi', indent: 1, values: [unrestrictedNA] });
  R.push({ label: 'Dengan Pembatasan dari Pemberi', indent: 1, values: [restrictedNA] });
  R.push({ label: 'Jumlah Aset Neto', bold: true, values: [totalNA] });
  R.push({ label: 'JUMLAH LIABILITAS DAN ASET NETO', bold: true, rule: true, values: [totalLiab + totalNA] });

  return {
    type: 'posisi', title: 'LAPORAN POSISI KEUANGAN', period: `Per ${fmtTanggal(asOf)}`,
    unitName: await unitName(unitId), columns: ['(Rp)'], rows: R,
    balanced: selisih === 0, selisih, asetNetoResidual: totalNA, asetNetoRiil: realNA,
  };
}

async function activity({ unitId = null, from, to }) {
  const net = await computeNet({ unitId, from, to, excludeInterunit: !unitId, excludeClosing: true });
  const rev = net.rows.filter(r => r.tipe === 'pendapatan');
  const exp = net.rows.filter(r => r.tipe === 'beban');
  const revTanpa = rev.filter(r => r.net_asset_class !== 'dengan');
  const revDengan = rev.filter(r => r.net_asset_class === 'dengan');
  const totRevTanpa = -revTanpa.reduce((s, r) => s + r.net, 0);
  const totRevDengan = -revDengan.reduce((s, r) => s + r.net, 0);
  const totRev = totRevTanpa + totRevDengan;
  const totExp = exp.reduce((s, r) => s + r.net, 0);

  const R = [];
  R.push({ label: 'PENDAPATAN', section: true });
  R.push({ label: 'Tanpa Pembatasan', bold: true });
  for (const r of revTanpa) if (r.net) R.push({ label: `${r.kode} ${r.nama}`, indent: 1, values: [-r.net] });
  if (revDengan.length) {
    R.push({ label: 'Dengan Pembatasan', bold: true });
    for (const r of revDengan) if (r.net) R.push({ label: `${r.kode} ${r.nama}`, indent: 1, values: [-r.net] });
  }
  R.push({ label: 'Jumlah Pendapatan', bold: true, rule: true, values: [totRev] });
  R.push({ label: 'BEBAN', section: true });
  for (const r of exp) if (r.net) R.push({ label: `${r.kode} ${r.nama}`, indent: 1, values: [r.net] });
  R.push({ label: 'Jumlah Beban', bold: true, rule: true, values: [totExp] });
  R.push({ label: 'SURPLUS (DEFISIT)', bold: true, values: [totRev - totExp] });
  R.push({ label: 'Penghasilan Komprehensif Lain', indent: 1, values: [0] });
  R.push({ label: 'JUMLAH PENGHASILAN KOMPREHENSIF', bold: true, rule: true, values: [totRev - totExp] });

  return {
    type: 'aktivitas', title: 'LAPORAN PENGHASILAN KOMPREHENSIF',
    period: `Periode ${fmtTanggal(from)} s.d. ${fmtTanggal(to)}`,
    unitName: await unitName(unitId), columns: ['(Rp)'], rows: R,
  };
}

async function netAssets({ unitId = null, from, to }) {
  const naSplit = async (to_) => {
    const n = await computeNet({ unitId, to: to_, excludeInterunit: !unitId });
    const aset = n.rows.filter(r => r.tipe === 'aset').reduce((s, r) => s + r.net, 0);
    const liab = -n.rows.filter(r => r.tipe === 'liabilitas').reduce((s, r) => s + r.net, 0);
    const total = aset - liab;
    const restricted = -(n.N('3200') + n.N('4300'));
    return { total, restricted, unrestricted: total - restricted };
  };
  const open = await naSplit(dayBefore(from));
  const close = await naSplit(to);
  const per = await computeNet({ unitId, from, to, excludeInterunit: !unitId, excludeClosing: true });
  const rev = per.rows.filter(r => r.tipe === 'pendapatan');
  const revDengan = -rev.filter(r => r.net_asset_class === 'dengan').reduce((s, r) => s + r.net, 0);
  const revTanpa = -rev.filter(r => r.net_asset_class !== 'dengan').reduce((s, r) => s + r.net, 0);
  const beban = per.rows.filter(r => r.tipe === 'beban').reduce((s, r) => s + r.net, 0);
  const surplusTanpa = revTanpa - beban;
  const surplusDengan = revDengan;
  const otherTanpa = -(per.N('3100') + per.N('3300'));
  const otherDengan = -(per.N('3200'));

  const row = (label, t, d, opts = {}) => ({ label, values: [t, d, t + d], ...opts });
  const R = [
    row('Saldo awal aset neto', open.unrestricted, open.restricted, { bold: true }),
    row('Surplus (defisit) periode berjalan', surplusTanpa, surplusDengan),
  ];
  if (otherTanpa || otherDengan) R.push(row('Kontribusi & penyesuaian aset neto', otherTanpa, otherDengan));
  R.push(row('Saldo akhir aset neto', close.unrestricted, close.restricted, { bold: true, rule: true }));

  return {
    type: 'asetneto', title: 'LAPORAN PERUBAHAN ASET NETO',
    period: `Periode ${fmtTanggal(from)} s.d. ${fmtTanggal(to)}`,
    unitName: await unitName(unitId), columns: ['Tanpa Pembatasan', 'Dengan Pembatasan', 'Jumlah'], rows: R,
    balanced: close.unrestricted === open.unrestricted + surplusTanpa + otherTanpa,
  };
}

async function cashFlow({ unitId = null, from, to }) {
  const per = await computeNet({ unitId, from, to, excludeInterunit: !unitId, excludeClosing: true });
  const isCash = (r) => /^11(1|2)/.test(r.kode);
  const kasAwal = (await computeNet({ unitId, to: dayBefore(from), excludeInterunit: !unitId })).rows.filter(isCash).reduce((s, r) => s + r.net, 0);
  const kenaikanKas = per.rows.filter(isCash).reduce((s, r) => s + r.net, 0);

  const rev = per.rows.filter(r => r.tipe === 'pendapatan').reduce((s, r) => s + r.net, 0);
  const exp = per.rows.filter(r => r.tipe === 'beban').reduce((s, r) => s + r.net, 0);
  const surplus = (-rev) - exp;
  const penyusutan = per.N('5700');
  const ckpn = per.N('5800');

  const wc = per.rows.filter(r => (r.tipe === 'aset' || r.tipe === 'liabilitas') && !isCash(r) && !r.is_kontra && !/^12/.test(r.kode));
  const fixed = per.rows.filter(r => r.tipe === 'aset' && /^12/.test(r.kode) && !r.is_kontra);
  const equity = per.rows.filter(r => r.tipe === 'aset_neto');

  const R = [];
  R.push({ label: 'ARUS KAS DARI AKTIVITAS OPERASI', section: true });
  R.push({ label: 'Surplus (defisit) periode berjalan', indent: 1, values: [surplus] });
  if (penyusutan) R.push({ label: 'Penyusutan aset tetap', indent: 1, values: [penyusutan] });
  if (ckpn) R.push({ label: 'Beban cadangan kerugian penurunan nilai', indent: 1, values: [ckpn] });
  let opWc = 0;
  for (const r of wc) if (r.net) { const c = -r.net; opWc += c; R.push({ label: `Perubahan ${r.nama}`, indent: 1, values: [c] }); }
  const kasOperasi = surplus + penyusutan + ckpn + opWc;
  R.push({ label: 'Kas Neto dari Aktivitas Operasi', bold: true, rule: true, values: [kasOperasi] });

  R.push({ label: 'ARUS KAS DARI AKTIVITAS INVESTASI', section: true });
  let kasInvestasi = 0;
  for (const r of fixed) if (r.net) { const c = -r.net; kasInvestasi += c; R.push({ label: `Perubahan ${r.nama}`, indent: 1, values: [c] }); }
  if (!kasInvestasi) R.push({ label: 'Tidak ada aktivitas investasi', indent: 1, values: [0] });
  R.push({ label: 'Kas Neto dari Aktivitas Investasi', bold: true, rule: true, values: [kasInvestasi] });

  R.push({ label: 'ARUS KAS DARI AKTIVITAS PENDANAAN', section: true });
  let kasPendanaan = 0;
  for (const r of equity) if (r.net) { const c = -r.net; kasPendanaan += c; R.push({ label: `Kontribusi/penyesuaian ${r.nama}`, indent: 1, values: [c] }); }
  if (!kasPendanaan) R.push({ label: 'Tidak ada aktivitas pendanaan', indent: 1, values: [0] });
  R.push({ label: 'Kas Neto dari Aktivitas Pendanaan', bold: true, rule: true, values: [kasPendanaan] });

  R.push({ label: 'KENAIKAN (PENURUNAN) KAS BERSIH', bold: true, values: [kasOperasi + kasInvestasi + kasPendanaan] });
  R.push({ label: 'Kas dan setara kas awal periode', values: [kasAwal] });
  R.push({ label: 'KAS DAN SETARA KAS AKHIR PERIODE', bold: true, rule: true, values: [kasAwal + kasOperasi + kasInvestasi + kasPendanaan] });

  return {
    type: 'aruskas', title: 'LAPORAN ARUS KAS', period: `Periode ${fmtTanggal(from)} s.d. ${fmtTanggal(to)} (metode tidak langsung)`,
    unitName: await unitName(unitId), columns: ['(Rp)'], rows: R,
    balanced: (kasOperasi + kasInvestasi + kasPendanaan) === kenaikanKas,
  };
}

const BULAN = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
function fmtTanggal(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${+m[3]} ${BULAN[+m[2]]} ${m[1]}` : iso; }

async function summary({ unitId = null, from, to }) {
  const kum = await computeNet({ unitId, to, excludeInterunit: !unitId });
  const per = await computeNet({ unitId, from, to, excludeInterunit: !unitId, excludeClosing: true });
  const sum = (rows, pred, sign) => rows.filter(pred).reduce((s, r) => s + sign * r.net, 0);
  const aset = sum(kum.rows, r => r.tipe === 'aset', 1);
  const liabilitas = sum(kum.rows, r => r.tipe === 'liabilitas', -1);
  const kas = sum(kum.rows, r => /^11(1|2)/.test(r.kode), 1);
  const pendapatan = sum(per.rows, r => r.tipe === 'pendapatan', -1);
  const beban = sum(per.rows, r => r.tipe === 'beban', 1);
  return { aset, liabilitas, asetNeto: aset - liabilitas, kas, pendapatan, beban, surplus: pendapatan - beban };
}

module.exports = { position, activity, netAssets, cashFlow, computeNet, summary };
