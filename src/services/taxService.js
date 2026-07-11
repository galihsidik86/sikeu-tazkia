'use strict';
// Integrasi Pajak (Fase 7): PPh 21 (honor/gaji) & PPh 23 (jasa/sewa).
const db = require('../db');
const jsvc = require('./journalService');
const audit = require('./audit');
const { ApiError } = jsvc;
const { toSen } = require('../utils/money');

const JENIS_LABEL = { pph21: 'PPh Pasal 21', pph23: 'PPh Pasal 23' };
const isDup = (e) => e.code === '23505' || /duplicate|unique/i.test(String(e.message));

async function listRates() {
  return db.prepare(`SELECT r.*, a.kode AS utang_kode, a.nama AS utang_nama
    FROM tax_rates r JOIN accounts a ON a.id=r.account_utang_id ORDER BY r.jenis, r.kode`).all();
}
async function getRate(id) {
  const r = await db.prepare('SELECT * FROM tax_rates WHERE id=?').get(id);
  if (!r) throw new ApiError(400, 'Tarif pajak tidak ditemukan.');
  return r;
}
async function upsertRate(user, b) {
  if (b.id) {
    const cur = await db.prepare('SELECT * FROM tax_rates WHERE id=?').get(b.id);
    if (!cur) throw new ApiError(404, 'Tarif tidak ditemukan.');
    const tarif_bp = b.tarif_persen != null ? Math.round(parseFloat(b.tarif_persen) * 100) : cur.tarif_bp;
    if (!(tarif_bp >= 0)) throw new ApiError(400, 'Tarif tidak valid.');
    await db.prepare('UPDATE tax_rates SET nama=?, jenis=?, account_utang_id=?, tarif_bp=?, aktif=? WHERE id=?')
      .run(b.nama ?? cur.nama, b.jenis ?? cur.jenis, b.account_utang_id ?? cur.account_utang_id,
        tarif_bp, b.aktif === false ? 0 : (b.aktif === true ? 1 : cur.aktif), b.id);
    await audit.log(user, 'update', 'tax_rate', b.id, { tarif_bp }, user.ip);
  } else {
    if (!b.kode || !b.nama || !b.jenis || !b.account_utang_id) throw new ApiError(400, 'Kode, nama, jenis, dan akun utang wajib diisi.');
    if (!['pph21', 'pph23'].includes(b.jenis)) throw new ApiError(400, 'Jenis harus pph21 atau pph23.');
    const tarif_bp = Math.round(parseFloat(b.tarif_persen) * 100);
    if (!(tarif_bp >= 0)) throw new ApiError(400, 'Tarif tidak valid.');
    try {
      const info = await db.prepare('INSERT INTO tax_rates (kode,nama,jenis,account_utang_id,tarif_bp) VALUES (?,?,?,?,?)')
        .run(b.kode.trim(), b.nama.trim(), b.jenis, b.account_utang_id, tarif_bp);
      await audit.log(user, 'create', 'tax_rate', info.lastInsertRowid, { kode: b.kode, tarif_bp }, user.ip);
    } catch (e) { if (isDup(e)) throw new ApiError(409, 'Kode tarif sudah dipakai.'); throw e; }
  }
  return listRates();
}

async function nextNomor(jenis, unitKode) {
  const n = (await db.prepare('SELECT COUNT(*) c FROM tax_withholdings WHERE jenis=?').get(jenis)).c + 1;
  const tag = jenis === 'pph21' ? 'BP21' : 'BP23';
  return `${tag}/${unitKode}/${String(n).padStart(5, '0')}`;
}

const recordWithholding = db.transaction(async (user, p) => {
  const rate = await getRate(p.rate_id);
  const unit = await db.prepare('SELECT * FROM units WHERE id=?').get(p.unit_id);
  if (!unit) throw new ApiError(400, 'Unit tidak valid.');
  const beban = await db.prepare('SELECT * FROM accounts WHERE id=?').get(p.beban_account_id);
  if (!beban || !beban.is_postable) throw new ApiError(400, 'Akun beban/objek tidak valid.');
  const ba = await db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(p.bank_account_id);
  if (!ba) throw new ApiError(400, 'Rekening pembayar tidak valid.');
  const dpp = toSen(p.dpp);
  if (dpp <= 0) throw new ApiError(400, 'DPP (bruto) harus lebih dari nol.');
  const pajak = Math.round(dpp * rate.tarif_bp / 10000);
  const neto = dpp - pajak;
  const nomor = await nextNomor(rate.jenis, unit.kode);
  const label = JENIS_LABEL[rate.jenis];

  const j = await jsvc.createPosted(user, {
    tanggal: p.tanggal, unit_id: unit.id, sumber: 'pajak', amountsInSen: true, ip: user.ip,
    deskripsi: `${label} — ${p.lawan_nama || rate.nama}${p.keterangan ? ' (' + p.keterangan + ')' : ''} [${nomor}]`,
    lines: [
      { account_id: beban.id, unit_id: unit.id, debit: dpp, memo: 'Bruto' },
      { account_id: rate.account_utang_id, unit_id: unit.id, kredit: pajak, memo: `Potong ${label} ${rate.tarif_bp / 100}%` },
      { account_id: ba.account_id, unit_id: ba.unit_id, kredit: neto, memo: `Neto ke ${ba.nama}` },
    ],
  });
  const info = await db.prepare(`INSERT INTO tax_withholdings
    (nomor,jenis,tanggal,unit_id,rate_id,lawan_nama,lawan_npwp,dpp,tarif_bp,pajak,keterangan,journal_id,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(nomor, rate.jenis, p.tanggal, unit.id, rate.id,
    p.lawan_nama || null, p.lawan_npwp || null, dpp, rate.tarif_bp, pajak, p.keterangan || null, j.id, user.id);
  await audit.log(user, 'create', 'tax_withholding', info.lastInsertRowid, { nomor, pajak }, user.ip);
  return getWithholding(info.lastInsertRowid);
});

async function decorateWht(w) {
  const rate = w.rate_id ? await db.prepare('SELECT nama FROM tax_rates WHERE id=?').get(w.rate_id) : null;
  const unit = await db.prepare('SELECT kode,nama FROM units WHERE id=?').get(w.unit_id);
  const jnl = w.journal_id ? await db.prepare('SELECT nomor FROM journals WHERE id=?').get(w.journal_id) : null;
  return { ...w, rate_nama: rate ? rate.nama : null, unit_kode: unit.kode, unit_nama: unit.nama,
    jurnal_nomor: jnl ? jnl.nomor : null, neto: w.dpp - w.pajak, jenis_label: JENIS_LABEL[w.jenis] };
}
async function getWithholding(id) {
  const w = await db.prepare('SELECT * FROM tax_withholdings WHERE id=?').get(id);
  if (!w) throw new ApiError(404, 'Bukti potong tidak ditemukan.');
  return decorateWht(w);
}
async function listWithholdings(f = {}) {
  const params = []; let where = '1=1';
  if (f.jenis) { where += ' AND jenis=?'; params.push(f.jenis); }
  if (f.unitId) { where += ' AND unit_id=?'; params.push(f.unitId); }
  if (f.status) { where += ' AND status=?'; params.push(f.status); }
  if (f.from) { where += ' AND tanggal>=?'; params.push(f.from); }
  if (f.to) { where += ' AND tanggal<=?'; params.push(f.to); }
  const rows = await db.prepare(`SELECT * FROM tax_withholdings WHERE ${where} ORDER BY tanggal DESC, id DESC`).all(...params);
  const out = [];
  for (const w of rows) out.push(await decorateWht(w));
  return out;
}

async function recap(tahun, bulan) {
  const from = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
  const to = `${tahun}-${String(bulan).padStart(2, '0')}-31`;
  const rows = await db.prepare(`SELECT jenis,
      COUNT(*) n, COALESCE(SUM(dpp),0) dpp, COALESCE(SUM(pajak),0) pajak,
      COALESCE(SUM(CASE WHEN status='disetor' THEN pajak ELSE 0 END),0) disetor,
      COALESCE(SUM(CASE WHEN status='dipotong' THEN pajak ELSE 0 END),0) belum
    FROM tax_withholdings WHERE tanggal>=? AND tanggal<=? GROUP BY jenis`).all(from, to);
  const byJenis = {};
  for (const j of ['pph21', 'pph23']) {
    const r = rows.find(x => x.jenis === j) || { n: 0, dpp: 0, pajak: 0, disetor: 0, belum: 0 };
    byJenis[j] = { jenis: j, label: JENIS_LABEL[j], count: r.n, dpp: r.dpp, pajak: r.pajak, disetor: r.disetor, belumSetor: r.belum };
  }
  return { tahun, bulan, byJenis };
}

const setor = db.transaction(async (user, p) => {
  const { tahun, bulan, jenis } = p;
  const ba = await db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(p.bank_account_id);
  if (!ba) throw new ApiError(400, 'Rekening pembayar tidak valid.');
  const from = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
  const to = `${tahun}-${String(bulan).padStart(2, '0')}-31`;
  const whs = await db.prepare(`SELECT w.*, r.account_utang_id FROM tax_withholdings w
    LEFT JOIN tax_rates r ON r.id=w.rate_id
    WHERE w.jenis=? AND w.status='dipotong' AND w.tanggal>=? AND w.tanggal<=?`).all(jenis, from, to);
  if (!whs.length) throw new ApiError(409, `Tidak ada ${JENIS_LABEL[jenis]} yang belum disetor pada masa ini.`);

  const grp = new Map();
  let total = 0;
  for (const w of whs) {
    const key = w.unit_id + '|' + w.account_utang_id;
    grp.set(key, (grp.get(key) || 0) + w.pajak); total += w.pajak;
  }
  const lines = [];
  for (const [key, amt] of grp) { const [unit_id, acc] = key.split('|').map(Number); lines.push({ account_id: acc, unit_id, debit: amt }); }
  lines.push({ account_id: ba.account_id, unit_id: ba.unit_id, kredit: total, memo: `Setor via ${ba.nama}` });

  const j = await jsvc.createPosted(user, {
    tanggal: p.tanggal || to, unit_id: ba.unit_id, sumber: 'setor_pajak', amountsInSen: true, allowOverBudget: true, ip: user.ip,
    deskripsi: `Setor ${JENIS_LABEL[jenis]} masa ${bulan}/${tahun}`, lines,
  });
  const upd = db.prepare("UPDATE tax_withholdings SET status='disetor', setor_journal_id=? WHERE id=?");
  for (const w of whs) await upd.run(j.id, w.id);
  await audit.log(user, 'setor', 'tax', null, { jenis, tahun, bulan, total, jurnal: j.nomor }, user.ip);
  return { jenis, tahun, bulan, total, jumlah: whs.length, jurnal: j.nomor };
});

module.exports = { JENIS_LABEL, listRates, upsertRate, recordWithholding, getWithholding, listWithholdings, recap, setor };
