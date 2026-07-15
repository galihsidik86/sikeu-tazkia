'use strict';
const db = require('../db');
const jsvc = require('./journalService');
const audit = require('./audit');
const { ApiError } = jsvc;
const { toSen } = require('../utils/money');

const POSTED = "('posted','reversed')";
const isDup = (e) => e.code === '23505' || /unique|duplicate/i.test(String(e.message));

const CKPN_BUCKETS = [
  { key: 'lancar', label: 'Belum jatuh tempo', min: -Infinity, max: 0 },
  { key: 'b1', label: '1–30 hari', min: 1, max: 30 },
  { key: 'b2', label: '31–60 hari', min: 31, max: 60 },
  { key: 'b3', label: '61–90 hari', min: 61, max: 90 },
  { key: 'b4', label: '> 90 hari', min: 91, max: Infinity },
];
const CKPN_DEFAULT = { lancar: 0, b1: 500, b2: 1000, b3: 2500, b4: 5000 };
function bucketOf(days) { return CKPN_BUCKETS.find(b => days >= b.min && days <= b.max) || CKPN_BUCKETS[0]; }

async function ckpnRates() {
  const rows = await db.prepare('SELECT bucket_key, rate_bp FROM ckpn_rates').all();
  const map = {};
  for (const b of CKPN_BUCKETS) map[b.key] = (CKPN_DEFAULT[b.key] || 0) / 10000;
  for (const r of rows) map[r.bucket_key] = r.rate_bp / 10000;
  return map;
}
async function listCkpnRates() {
  const map = await ckpnRates();
  return CKPN_BUCKETS.map(b => ({ bucket_key: b.key, label: b.label, rate_persen: map[b.key] * 100 }));
}
async function updateCkpnRate(user, bucket_key, rate_persen) {
  if (!CKPN_BUCKETS.find(b => b.key === bucket_key)) throw new ApiError(400, 'Ember CKPN tidak dikenal.');
  const bp = Math.round(parseFloat(rate_persen) * 100);
  if (!(bp >= 0)) throw new ApiError(400, 'Persentase tidak valid.');
  await db.prepare('INSERT INTO ckpn_rates (bucket_key,rate_bp) VALUES (?,?) ON CONFLICT (bucket_key) DO UPDATE SET rate_bp=?').run(bucket_key, bp, bp);
  await audit.log(user, 'update', 'ckpn_rate', bucket_key, { rate_bp: bp }, user.ip);
  return listCkpnRates();
}

async function accByKode(kode) {
  const a = await db.prepare('SELECT * FROM accounts WHERE kode=?').get(kode);
  if (!a) throw new ApiError(500, `Akun ${kode} tidak ada di COA.`);
  return a;
}
function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86400000);
}
function firstOfMonth(iso) { return (iso || '').slice(0, 7) + '-01'; }
function ym(iso) { const m = /^(\d{4})-(\d{2})/.exec(iso || ''); return m ? { tahun: +m[1], bulan: +m[2] } : null; }

// ---------- Mahasiswa ----------
async function listStudents(unitId, q) {
  const params = []; let where = '1=1';
  if (unitId) { where += ' AND s.unit_id=?'; params.push(unitId); }
  if (q) { where += ' AND (s.nama ILIKE ? OR s.nim ILIKE ?)'; params.push('%' + q + '%', '%' + q + '%'); }
  return db.prepare(`SELECT s.*, u.kode AS unit_kode FROM students s JOIN units u ON u.id=s.unit_id
    WHERE ${where} ORDER BY s.nim`).all(...params);
}
async function createStudent(user, b) {
  if (!b.nim || !b.nama || !b.unit_id) throw new ApiError(400, 'NIM, nama, dan unit wajib diisi.');
  try {
    const info = await db.prepare(`INSERT INTO students (nim,nama,prodi,unit_id,angkatan,status) VALUES (?,?,?,?,?,?)`)
      .run(b.nim.trim(), b.nama.trim(), b.prodi || null, b.unit_id, b.angkatan || null, b.status || 'aktif');
    await audit.log(user, 'create', 'student', info.lastInsertRowid, { nim: b.nim }, user.ip);
    return db.prepare('SELECT * FROM students WHERE id=?').get(info.lastInsertRowid);
  } catch (e) { if (isDup(e)) throw new ApiError(409, 'NIM sudah terdaftar.'); throw e; }
}
async function updateStudent(user, id, b) {
  const s = await db.prepare('SELECT * FROM students WHERE id=?').get(id);
  if (!s) throw new ApiError(404, 'Mahasiswa tidak ditemukan.');
  await db.prepare('UPDATE students SET nama=?, prodi=?, angkatan=?, status=? WHERE id=?').run(
    b.nama ?? s.nama, b.prodi ?? s.prodi, b.angkatan ?? s.angkatan, b.status ?? s.status, id);
  await audit.log(user, 'update', 'student', id, b, user.ip);
  return db.prepare('SELECT * FROM students WHERE id=?').get(id);
}

async function importStudents(user, b) {
  const rows = Array.isArray(b.students) ? b.students : null;
  if (!rows || !rows.length) throw new ApiError(400, 'Tidak ada baris untuk diimpor.');
  if (rows.length > 2000) throw new ApiError(400, 'Maksimum 2000 baris per impor.');
  // Peta unit: kode (STM) atau nama → id
  const units = await db.prepare('SELECT id, kode, nama FROM units').all();
  const unitBy = {};
  for (const u of units) { unitBy[u.kode.toLowerCase()] = u.id; unitBy[u.nama.toLowerCase()] = u.id; }

  const result = { total: rows.length, inserted: 0, skipped: 0, errors: [] };
  // Best-effort: setiap baris di-insert autocommit sendiri (bukan satu transaksi),
  // agar satu baris gagal (mis. NIM duplikat) tidak membatalkan baris lain — di Postgres,
  // satu error dalam transaksi akan menggagalkan seluruh statement berikutnya.
  const seen = new Set();
  {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const baris = i + 1;
      const nim = String(r.nim || '').trim();
      const nama = String(r.nama || '').trim();
      const unitKey = String(r.unit || '').trim().toLowerCase();
      const unit_id = unitBy[unitKey];
      if (!nim || !nama || !unitKey) { result.skipped++; result.errors.push({ baris, nim, pesan: 'NIM, nama, dan unit wajib diisi.' }); continue; }
      if (!unit_id) { result.skipped++; result.errors.push({ baris, nim, pesan: `Unit "${r.unit}" tidak dikenal (pakai kode YYS/STM/UNV).` }); continue; }
      if (seen.has(nim)) { result.skipped++; result.errors.push({ baris, nim, pesan: 'NIM duplikat di dalam berkas.' }); continue; }
      seen.add(nim);
      const angkatan = r.angkatan ? parseInt(r.angkatan, 10) : null;
      try {
        await db.prepare('INSERT INTO students (nim,nama,prodi,unit_id,angkatan,status) VALUES (?,?,?,?,?,?)')
          .run(nim, nama, String(r.prodi || '').trim() || null, unit_id, Number.isFinite(angkatan) ? angkatan : null, 'aktif');
        result.inserted++;
      } catch (e) {
        result.skipped++;
        result.errors.push({ baris, nim, pesan: isDup(e) ? 'NIM sudah terdaftar.' : (e.message || 'Gagal.') });
      }
    }
  }
  await audit.log(user, 'import', 'student', null, { total: result.total, inserted: result.inserted, skipped: result.skipped }, user.ip);
  return result;
}

// ---------- Tagihan ----------
async function paidOf(invoiceId) {
  return (await db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM payments WHERE invoice_id=?').get(invoiceId)).s;
}
async function reliefOf(invoiceId) {
  return (await db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM reliefs WHERE invoice_id=?').get(invoiceId)).s;
}
async function recognizedOf(invoiceId) {
  return (await db.prepare('SELECT COALESCE(SUM(nominal),0) s FROM revenue_recognition WHERE invoice_id=?').get(invoiceId)).s;
}
async function settleStatus(inv, settled) {
  return settled >= inv.nominal ? 'lunas' : (settled > 0 ? 'sebagian' : 'terbit');
}
async function decorate(inv) {
  const paid = await paidOf(inv.id), relief = await reliefOf(inv.id), recognized = await recognizedOf(inv.id);
  return { ...inv, paid, relief, recognized, sisa: inv.nominal - paid - relief, deferred: inv.nominal - recognized };
}
async function listInvoices(f = {}) {
  const params = []; let where = '1=1';
  if (f.unitId) { where += ' AND i.unit_id=?'; params.push(f.unitId); }
  if (f.semester) { where += ' AND i.semester=?'; params.push(f.semester); }
  if (f.status) { where += ' AND i.status=?'; params.push(f.status); }
  const rows = await db.prepare(`SELECT i.*, s.nim, s.nama AS mhs_nama, s.prodi, u.kode AS unit_kode
    FROM invoices i JOIN students s ON s.id=i.student_id JOIN units u ON u.id=i.unit_id
    WHERE ${where} ORDER BY i.tanggal DESC, i.id DESC`).all(...params);
  const out = [];
  for (const r of rows) out.push(await decorate(r));
  return out;
}
async function getInvoice(id) {
  const inv = await db.prepare(`SELECT i.*, s.nim, s.nama AS mhs_nama, s.prodi, u.kode AS unit_kode, u.nama AS unit_nama
    FROM invoices i JOIN students s ON s.id=i.student_id JOIN units u ON u.id=i.unit_id WHERE i.id=?`).get(id);
  if (!inv) throw new ApiError(404, 'Tagihan tidak ditemukan.');
  const payments = await db.prepare(`SELECT p.*, j.nomor AS jurnal_nomor FROM payments p
    LEFT JOIN journals j ON j.id=p.journal_id WHERE p.invoice_id=? ORDER BY p.tanggal, p.id`).all(id);
  const recognitions = await db.prepare('SELECT * FROM revenue_recognition WHERE invoice_id=? ORDER BY tahun,bulan').all(id);
  const reliefs = await db.prepare(`SELECT r.*, a.kode AS akun_kode, a.nama AS akun_nama, j.nomor AS jurnal_nomor
    FROM reliefs r JOIN accounts a ON a.id=r.account_id LEFT JOIN journals j ON j.id=r.journal_id
    WHERE r.invoice_id=? ORDER BY r.tanggal, r.id`).all(id);
  return { ...(await decorate(inv)), payments, recognitions, reliefs };
}

async function nextInvoiceNo(unitKode) {
  const n = (await db.prepare('SELECT COUNT(*) c FROM invoices').get()).c + 1;
  return `INV/${unitKode}/${String(n).padStart(5, '0')}`;
}

const createInvoice = db.transaction(async (user, b) => {
  const s = await db.prepare('SELECT * FROM students WHERE id=?').get(b.student_id);
  if (!s) throw new ApiError(400, 'Mahasiswa tidak valid.');
  const unit = await db.prepare('SELECT * FROM units WHERE id=?').get(s.unit_id);
  const nominal = toSen(b.nominal);
  if (nominal <= 0) throw new ApiError(400, 'Nominal harus > 0.');
  const tanggal = b.tanggal;
  const mulai = firstOfMonth(b.mulai_amortisasi || tanggal);
  const tenor = b.tenor_bulan || 6;
  const nomor = await nextInvoiceNo(unit.kode);

  const info = await db.prepare(`INSERT INTO invoices
    (nomor,student_id,unit_id,semester,tanggal,nominal,jatuh_tempo,tenor_bulan,mulai_amortisasi,status)
    VALUES (?,?,?,?,?,?,?,?,?,'terbit')`).run(nomor, s.id, s.unit_id, b.semester, tanggal, nominal, b.jatuh_tempo || null, tenor, mulai);
  const invId = info.lastInsertRowid;

  const j = await jsvc.createPosted(user, {
    tanggal, unit_id: s.unit_id, sumber: 'tagihan', ip: user.ip, amountsInSen: true,
    deskripsi: `Penerbitan tagihan UKT ${b.semester} — ${s.nama} (${s.nim})`,
    lines: [
      { account_id: (await accByKode('1131')).id, unit_id: s.unit_id, debit: nominal, memo: nomor },
      { account_id: (await accByKode('2120')).id, unit_id: s.unit_id, kredit: nominal, memo: 'Pendapatan diterima di muka' },
    ],
  });
  await db.prepare('UPDATE invoices SET journal_id=? WHERE id=?').run(j.id, invId);
  await audit.log(user, 'create', 'invoice', invId, { nomor, nominal }, user.ip);
  return getInvoice(invId);
});

const generateInvoices = db.transaction(async (user, b) => {
  if (!b.unit_id) throw new ApiError(400, 'Unit wajib dipilih.');
  if (!b.semester) throw new ApiError(400, 'Semester wajib diisi.');
  const nominal = toSen(b.nominal);
  if (nominal <= 0) throw new ApiError(400, 'Nominal harus > 0.');
  const unit = await db.prepare('SELECT * FROM units WHERE id=?').get(b.unit_id);
  const params = [b.unit_id]; let where = "s.unit_id=? AND s.status='aktif'";
  if (b.prodi) { where += ' AND s.prodi=?'; params.push(b.prodi); }
  if (b.angkatan) { where += ' AND s.angkatan=?'; params.push(b.angkatan); }
  const students = await db.prepare(`SELECT * FROM students s WHERE ${where}`).all(...params);
  const eligible = [];
  for (const s of students) {
    if (!await db.prepare('SELECT 1 FROM invoices WHERE student_id=? AND semester=?').get(s.id, b.semester)) eligible.push(s);
  }
  if (!eligible.length) throw new ApiError(409, 'Tidak ada mahasiswa yang perlu ditagih (semua sudah punya tagihan semester ini).');

  const tanggal = b.tanggal;
  const mulai = firstOfMonth(b.mulai_amortisasi || tanggal);
  const tenor = b.tenor_bulan || 6;
  const total = nominal * eligible.length;

  const j = await jsvc.createPosted(user, {
    tanggal, unit_id: b.unit_id, sumber: 'tagihan', ip: user.ip, amountsInSen: true,
    deskripsi: `Penerbitan tagihan UKT massal ${b.semester} — ${unit.nama} (${eligible.length} mhs)`,
    lines: [
      { account_id: (await accByKode('1131')).id, unit_id: b.unit_id, debit: total },
      { account_id: (await accByKode('2120')).id, unit_id: b.unit_id, kredit: total },
    ],
  });
  const insInv = db.prepare(`INSERT INTO invoices
    (nomor,student_id,unit_id,semester,tanggal,nominal,jatuh_tempo,tenor_bulan,mulai_amortisasi,status,journal_id)
    VALUES (?,?,?,?,?,?,?,?,?,'terbit',?)`);
  for (const s of eligible) {
    await insInv.run(await nextInvoiceNo(unit.kode), s.id, s.unit_id, b.semester, tanggal, nominal, b.jatuh_tempo || null, tenor, mulai, j.id);
  }
  await audit.log(user, 'generate', 'invoice', j.id, { semester: b.semester, unit: unit.kode, count: eligible.length, total }, user.ip);
  return { count: eligible.length, total, journal_id: j.id, nomor: j.nomor };
});

const recordPayment = db.transaction(async (user, b) => {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id=?').get(b.invoice_id);
  if (!inv) throw new ApiError(404, 'Tagihan tidak ditemukan.');
  if (inv.status === 'void') throw new ApiError(409, 'Tagihan dibatalkan.');
  const nominal = toSen(b.nominal);
  if (nominal <= 0) throw new ApiError(400, 'Nominal pembayaran harus > 0.');
  const sisa = inv.nominal - await paidOf(inv.id) - await reliefOf(inv.id);
  if (nominal > sisa) throw new ApiError(400, `Melebihi sisa tagihan (sisa Rp ${sisa / 100}).`);

  const ba = await db.prepare('SELECT * FROM bank_accounts WHERE id=?').get(b.bank_account_id);
  if (!ba) throw new ApiError(400, 'Rekening penerima tidak valid.');
  const s = await db.prepare('SELECT * FROM students WHERE id=?').get(inv.student_id);

  const j = await jsvc.createPosted(user, {
    tanggal: b.tanggal, unit_id: inv.unit_id, sumber: 'pembayaran', ip: user.ip, amountsInSen: true,
    deskripsi: `Pembayaran UKT ${inv.semester} — ${s.nama} (${inv.nomor})`,
    lines: [
      { account_id: ba.account_id, unit_id: ba.unit_id, debit: nominal, memo: `via ${ba.nama}` },
      { account_id: (await accByKode('1131')).id, unit_id: inv.unit_id, kredit: nominal, memo: inv.nomor },
    ],
  });
  const info = await db.prepare(`INSERT INTO payments (invoice_id,tanggal,nominal,metode,bank_account_id,journal_id) VALUES (?,?,?,?,?,?)`)
    .run(inv.id, b.tanggal, nominal, b.metode || 'transfer', ba.id, j.id);
  const settled = await paidOf(inv.id) + await reliefOf(inv.id);
  await db.prepare('UPDATE invoices SET status=? WHERE id=?').run(await settleStatus(inv, settled), inv.id);
  await audit.log(user, 'create', 'payment', info.lastInsertRowid, { invoice: inv.nomor, nominal }, user.ip);
  return getInvoice(inv.id);
});

// ---------- Keringanan UKT (potongan & beasiswa) ----------
const RELIEF_ACC = { potongan: '4150', beasiswa: '5350' };
const RELIEF_LABEL = { potongan: 'Potongan/keringanan UKT', beasiswa: 'Beasiswa' };

async function ensureReliefAccounts() {
  const defs = [
    ['4150', 'Potongan / Keringanan UKT', 'pendapatan', '4000', 'D', 1],
    ['5350', 'Beban Beasiswa', 'beban', '5000', 'D', 0],
  ];
  for (const [kode, nama, tipe, parentKode, nb, kontra] of defs) {
    if (await db.prepare('SELECT 1 FROM accounts WHERE kode=?').get(kode)) continue;
    const parent = await db.prepare('SELECT id FROM accounts WHERE kode=?').get(parentKode);
    await db.prepare(`INSERT INTO accounts (kode,nama,tipe,parent_id,is_postable,normal_balance,is_kontra)
      VALUES (?,?,?,?,1,?,?) ON CONFLICT (kode) DO NOTHING`).run(kode, nama, tipe, parent ? parent.id : null, nb, kontra);
  }
}

const recordRelief = db.transaction(async (user, b) => {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id=?').get(b.invoice_id);
  if (!inv) throw new ApiError(404, 'Tagihan tidak ditemukan.');
  if (inv.status === 'void') throw new ApiError(409, 'Tagihan dibatalkan.');
  const jenis = b.jenis;
  if (!RELIEF_ACC[jenis]) throw new ApiError(400, 'Jenis keringanan tidak valid (potongan/beasiswa).');
  const nominal = toSen(b.nominal);
  if (nominal <= 0) throw new ApiError(400, 'Nominal keringanan harus > 0.');
  const sisa = inv.nominal - await paidOf(inv.id) - await reliefOf(inv.id);
  if (nominal > sisa) throw new ApiError(400, `Melebihi sisa tagihan (sisa Rp ${sisa / 100}).`);

  await ensureReliefAccounts();
  const debitAcc = b.account_id
    ? await db.prepare('SELECT * FROM accounts WHERE id=?').get(b.account_id)
    : await accByKode(RELIEF_ACC[jenis]);
  if (!debitAcc) throw new ApiError(400, 'Akun lawan tidak valid.');
  const s = await db.prepare('SELECT * FROM students WHERE id=?').get(inv.student_id);

  const j = await jsvc.createPosted(user, {
    tanggal: b.tanggal, unit_id: inv.unit_id, sumber: 'keringanan', ip: user.ip, amountsInSen: true,
    deskripsi: `${RELIEF_LABEL[jenis]} UKT ${inv.semester} — ${s.nama} (${inv.nomor})${b.keterangan ? ' · ' + b.keterangan : ''}`,
    lines: [
      { account_id: debitAcc.id, unit_id: inv.unit_id, debit: nominal, memo: inv.nomor },
      { account_id: (await accByKode('1131')).id, unit_id: inv.unit_id, kredit: nominal, memo: RELIEF_LABEL[jenis] },
    ],
  });
  const info = await db.prepare(`INSERT INTO reliefs (invoice_id,tanggal,jenis,nominal,account_id,keterangan,journal_id)
    VALUES (?,?,?,?,?,?,?)`).run(inv.id, b.tanggal, jenis, nominal, debitAcc.id, b.keterangan || null, j.id);
  const settled = await paidOf(inv.id) + await reliefOf(inv.id);
  await db.prepare('UPDATE invoices SET status=? WHERE id=?').run(await settleStatus(inv, settled), inv.id);
  await audit.log(user, 'create', 'relief', info.lastInsertRowid, { invoice: inv.nomor, jenis, nominal }, user.ip);
  return getInvoice(inv.id);
});

// ---------- Aging + CKPN ----------
async function aging(opts = {}) {
  const { unitId = null, asOf } = opts;
  const asof = asOf || new Date().toISOString().slice(0, 10);
  const params = []; let where = "i.status <> 'void'";
  if (unitId) { where += ' AND i.unit_id=?'; params.push(unitId); }
  const invs = await db.prepare(`SELECT i.*, s.nim, s.nama AS mhs_nama, u.kode AS unit_kode
    FROM invoices i JOIN students s ON s.id=i.student_id JOIN units u ON u.id=i.unit_id WHERE ${where}`).all(...params);

  const rates = await ckpnRates();
  const buckets = CKPN_BUCKETS.map(b => ({ key: b.key, label: b.label, rate: rates[b.key], outstanding: 0, ckpn: 0 }));
  const rows = [];
  for (const inv of invs) {
    const sisa = inv.nominal - await paidOf(inv.id) - await reliefOf(inv.id);
    if (sisa <= 0) continue;
    const days = inv.jatuh_tempo ? daysBetween(inv.jatuh_tempo, asof) : 0;
    const b = bucketOf(days);
    buckets.find(x => x.key === b.key).outstanding += sisa;
    rows.push({ invoice_id: inv.id, nomor: inv.nomor, nim: inv.nim, mhs_nama: inv.mhs_nama,
      unit_kode: inv.unit_kode, jatuh_tempo: inv.jatuh_tempo, umur_hari: days, bucket: b.key, bucket_label: b.label, sisa });
  }
  let totalOutstanding = 0, totalCkpn = 0;
  for (const bo of buckets) { bo.ckpn = Math.round(bo.outstanding * bo.rate); totalOutstanding += bo.outstanding; totalCkpn += bo.ckpn; }
  return { asof, unit: unitId, buckets, rows, totalOutstanding, totalCkpn };
}

async function ckpnBalance(unitId) {
  const acc = await accByKode('1139');
  const params = [acc.id]; let where = `jl.account_id=? AND j.status IN ${POSTED}`;
  if (unitId) { where += ' AND jl.unit_id=?'; params.push(unitId); }
  const r = await db.prepare(`SELECT COALESCE(SUM(jl.kredit),0) k, COALESCE(SUM(jl.debit),0) d
    FROM journal_lines jl JOIN journals j ON j.id=jl.journal_id WHERE ${where}`).get(...params);
  return r.k - r.d;
}

const runCkpn = db.transaction(async (user, asOf) => {
  const asof = asOf || new Date().toISOString().slice(0, 10);
  const units = await db.prepare('SELECT * FROM units').all();
  const results = [];
  for (const u of units) {
    const ag = await aging({ unitId: u.id, asOf: asof });
    const required = ag.totalCkpn;
    const current = await ckpnBalance(u.id);
    const delta = required - current;
    if (delta === 0) { results.push({ unit: u.kode, required, current, delta: 0, journal: null }); continue; }
    let lines;
    if (delta > 0) lines = [
      { account_id: (await accByKode('5800')).id, unit_id: u.id, debit: delta },
      { account_id: (await accByKode('1139')).id, unit_id: u.id, kredit: delta },
    ]; else lines = [
      { account_id: (await accByKode('1139')).id, unit_id: u.id, debit: -delta },
      { account_id: (await accByKode('5800')).id, unit_id: u.id, kredit: -delta },
    ];
    const j = await jsvc.createDraft(user, {
      tanggal: asof, unit_id: u.id, sumber: 'ckpn', ip: user.ip, amountsInSen: true,
      deskripsi: `Penyesuaian CKPN piutang UKT — ${u.nama} (per ${asof})`, lines,
    });
    results.push({ unit: u.kode, required, current, delta, draft_id: j.id, status: j.status });
  }
  await audit.log(user, 'run', 'ckpn', null, { asof, results }, user.ip);
  return { asof, results, catatan: 'Jurnal penyesuaian dibuat sebagai draft — tinjau lalu ajukan/setujui di Jurnal Umum.' };
});

// ---------- Amortisasi (PSAK 72) ----------
function monthlyPortion(inv, monthIndex) {
  const base = Math.floor(inv.nominal / inv.tenor_bulan);
  return monthIndex === inv.tenor_bulan - 1 ? inv.nominal - base * (inv.tenor_bulan - 1) : base;
}
async function invoicesForMonth(tahun, bulan, unitId) {
  const params = []; let where = "i.status <> 'void'";
  if (unitId) { where += ' AND i.unit_id=?'; params.push(unitId); }
  const invs = await db.prepare(`SELECT * FROM invoices i WHERE ${where}`).all(...params);
  const out = [];
  for (const inv of invs) {
    const start = ym(inv.mulai_amortisasi); if (!start) continue;
    const idx = (tahun - start.tahun) * 12 + (bulan - start.bulan);
    if (idx < 0 || idx >= inv.tenor_bulan) continue;
    if (await db.prepare('SELECT 1 FROM revenue_recognition WHERE invoice_id=? AND tahun=? AND bulan=?').get(inv.id, tahun, bulan)) continue;
    out.push({ inv, amount: monthlyPortion(inv, idx), monthIndex: idx });
  }
  return out;
}
async function amortisasiPreview(tahun, bulan, unitId) {
  const items = await invoicesForMonth(tahun, bulan, unitId);
  const perUnit = {};
  for (const it of items) perUnit[it.inv.unit_id] = (perUnit[it.inv.unit_id] || 0) + it.amount;
  return { tahun, bulan, count: items.length, total: items.reduce((s, it) => s + it.amount, 0), perUnit };
}
const runAmortisasi = db.transaction(async (user, tahun, bulan) => {
  const items = await invoicesForMonth(tahun, bulan, null);
  if (!items.length) throw new ApiError(409, 'Tidak ada tagihan yang perlu diamortisasi untuk bulan ini (mungkin sudah diproses).');
  const byUnit = {};
  for (const it of items) (byUnit[it.inv.unit_id] = byUnit[it.inv.unit_id] || []).push(it);
  const tanggal = `${tahun}-${String(bulan).padStart(2, '0')}-28`;
  let grandTotal = 0; const results = [];
  const insRec = db.prepare(`INSERT INTO revenue_recognition (invoice_id,tahun,bulan,nominal,journal_id) VALUES (?,?,?,?,?)`);
  for (const unitId of Object.keys(byUnit)) {
    const list = byUnit[unitId];
    const total = list.reduce((s, it) => s + it.amount, 0);
    const u = await db.prepare('SELECT * FROM units WHERE id=?').get(unitId);
    const j = await jsvc.createPosted(user, {
      tanggal, unit_id: +unitId, sumber: 'amortisasi', ip: user.ip, amountsInSen: true,
      deskripsi: `Pengakuan pendapatan UKT (amortisasi) ${bulan}/${tahun} — ${u.nama} (${list.length} tagihan)`,
      lines: [
        { account_id: (await accByKode('2120')).id, unit_id: +unitId, debit: total },
        { account_id: (await accByKode('4100')).id, unit_id: +unitId, kredit: total },
      ],
    });
    for (const it of list) await insRec.run(it.inv.id, tahun, bulan, it.amount, j.id);
    grandTotal += total; results.push({ unit: u.kode, count: list.length, total, journal: j.nomor });
  }
  await audit.log(user, 'run', 'amortisasi', null, { tahun, bulan, grandTotal, results }, user.ip);
  return { tahun, bulan, grandTotal, results };
});

module.exports = {
  CKPN_BUCKETS, listCkpnRates, updateCkpnRate,
  listStudents, createStudent, updateStudent, importStudents,
  listInvoices, getInvoice, createInvoice, generateInvoices,
  recordPayment, recordRelief, aging, ckpnBalance, runCkpn,
  amortisasiPreview, runAmortisasi,
};
