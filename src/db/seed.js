'use strict';
// Seed data awal SIKEU Tazkia (PostgreSQL). Jalankan: npm run seed (idempoten).
const db = require('./index');
const auth = require('../auth');
const svc = require('../services/journalService');
const cash = require('../services/cashService');
const piutang = require('../services/piutangService');
const tax = require('../services/taxService');

const DEMO_PASS = 'sikeu123';

async function seed() {
  console.log('• Menyiapkan seed…');
  await db.exec(`TRUNCATE units,users,accounts,periods,journals,journal_lines,audit_log,students,
    bank_accounts,cash_categories,invoices,payments,revenue_recognition,budgets,bank_statements,
    ckpn_rates,tax_rates,tax_withholdings,year_closings RESTART IDENTITY CASCADE`);

  // ---------------- Units ----------------
  const insUnit = db.prepare('INSERT INTO units (kode,nama,is_yayasan) VALUES (?,?,?)');
  const units = {};
  units.YYS = (await insUnit.run('YYS', 'Yayasan Pusat', 1)).lastInsertRowid;
  units.STM = (await insUnit.run('STM', 'STMIK Tazkia', 0)).lastInsertRowid;
  units.UNV = (await insUnit.run('UNV', 'Universitas Tazkia', 0)).lastInsertRowid;

  // ---------------- COA ----------------
  const A = 'aset', L = 'liabilitas', E = 'aset_neto', P = 'pendapatan', B = 'beban';
  const coa = [
    ['1000', 'ASET', A, null, 0, 'D', {}], ['1100', 'Aset Lancar', A, '1000', 0, 'D', {}],
    ['1110', 'Kas', A, '1100', 0, 'D', {}], ['1111', 'Kas Besar', A, '1110', 1, 'D', {}],
    ['1112', 'Kas Kecil', A, '1110', 1, 'D', {}], ['1120', 'Bank', A, '1100', 0, 'D', {}],
    ['1121', 'Bank Mandiri — UKT STMIK', A, '1120', 1, 'D', {}],
    ['1122', 'Bank BSI — Operasional Yayasan', A, '1120', 1, 'D', {}],
    ['1123', 'Bank BNI — Universitas', A, '1120', 1, 'D', {}], ['1130', 'Piutang', A, '1100', 0, 'D', {}],
    ['1131', 'Piutang UKT Mahasiswa', A, '1130', 1, 'D', {}], ['1139', 'CKPN Piutang UKT', A, '1130', 1, 'K', { kontra: 1 }],
    ['1140', 'Piutang Antar-Unit', A, '1100', 1, 'D', { interunit: 1 }], ['1200', 'Aset Tetap', A, '1000', 0, 'D', {}],
    ['1210', 'Tanah', A, '1200', 1, 'D', {}], ['1220', 'Gedung & Bangunan', A, '1200', 1, 'D', {}],
    ['1230', 'Peralatan & Mesin', A, '1200', 1, 'D', {}], ['1290', 'Akumulasi Penyusutan', A, '1200', 1, 'K', { kontra: 1 }],
    ['2000', 'LIABILITAS', L, null, 0, 'K', {}], ['2100', 'Liabilitas Jangka Pendek', L, '2000', 0, 'K', {}],
    ['2110', 'Utang Usaha', L, '2100', 1, 'K', {}], ['2120', 'Pendapatan Diterima di Muka — UKT', L, '2100', 1, 'K', {}],
    ['2130', 'Utang PPh 21', L, '2100', 1, 'K', {}], ['2135', 'Utang PPh 23', L, '2100', 1, 'K', {}],
    ['2140', 'Utang BPJS', L, '2100', 1, 'K', {}], ['2150', 'Utang Antar-Unit', L, '2100', 1, 'K', { interunit: 1 }],
    ['2200', 'Liabilitas Jangka Panjang', L, '2000', 0, 'K', {}], ['2210', 'Provisi Imbalan Pascakerja', L, '2200', 1, 'K', {}],
    ['3000', 'ASET NETO', E, null, 0, 'K', {}], ['3100', 'Aset Neto Tanpa Pembatasan', E, '3000', 1, 'K', { netclass: 'tanpa' }],
    ['3200', 'Aset Neto Dengan Pembatasan', E, '3000', 1, 'K', { netclass: 'dengan' }],
    ['3300', 'Surplus (Defisit) Tahun Berjalan', E, '3000', 1, 'K', { netclass: 'tanpa' }],
    ['4000', 'PENDAPATAN', P, null, 0, 'K', {}], ['4100', 'Pendapatan UKT', P, '4000', 1, 'K', {}],
    ['4200', 'Pendapatan Pendaftaran', P, '4000', 1, 'K', {}], ['4300', 'Hibah / Sumbangan Terikat', P, '4000', 1, 'K', { netclass: 'dengan' }],
    ['4400', 'Sumbangan Tidak Terikat', P, '4000', 1, 'K', { netclass: 'tanpa' }], ['4900', 'Pendapatan Lain-lain', P, '4000', 1, 'K', {}],
    ['5000', 'BEBAN', B, null, 0, 'D', {}], ['5100', 'Beban Gaji & Tunjangan', B, '5000', 1, 'D', {}],
    ['5200', 'Beban BPJS', B, '5000', 1, 'D', {}], ['5300', 'Honor Dosen Luar Biasa', B, '5000', 1, 'D', {}],
    ['5400', 'Beban Operasional', B, '5000', 1, 'D', {}], ['5500', 'Beban Listrik, Air & Internet', B, '5000', 1, 'D', {}],
    ['5600', 'Beban Pemeliharaan', B, '5000', 1, 'D', {}], ['5700', 'Beban Penyusutan', B, '5000', 1, 'D', {}],
    ['5800', 'Beban CKPN', B, '5000', 1, 'D', {}], ['5900', 'Beban Akreditasi', B, '5000', 1, 'D', {}],
  ];
  const insAcc = db.prepare(`INSERT INTO accounts
    (kode,nama,tipe,parent_id,is_postable,normal_balance,is_interunit,is_kontra,net_asset_class)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const accId = {};
  for (const [kode, nama, tipe, parent, postable, normal, opt] of coa) {
    accId[kode] = (await insAcc.run(kode, nama, tipe, parent ? accId[parent] : null, postable, normal,
      opt.interunit ? 1 : 0, opt.kontra ? 1 : 0, opt.netclass || null)).lastInsertRowid;
  }

  // ---------------- Users (3 per peran) ----------------
  const roleUnit = { staf_akuntansi: ['STM', 'UNV', 'YYS'], kasir: ['STM', 'UNV', 'STM'], kepala_unit: ['STM', 'UNV', 'YYS'] };
  const roleNames = { admin: 'Administrator', staf_akuntansi: 'Staf Akuntansi', kasir: 'Kasir',
    bendahara: 'Bendahara', kepala_unit: 'Kepala Unit', pengurus_yayasan: 'Pengurus Yayasan' };
  const insUser = db.prepare('INSERT INTO users (nama,email,password_hash,role,unit_id,aktif) VALUES (?,?,?,?,?,1)');
  const userByRole = {};
  for (const role of Object.keys(roleNames)) {
    userByRole[role] = [];
    for (let i = 1; i <= 3; i++) {
      const uk = (roleUnit[role] || [])[i - 1] || null;
      const id = (await insUser.run(`${roleNames[role]} ${i}`, `${role.replace('_', '')}${i}@tazkia.ac.id`,
        auth.hashPassword(DEMO_PASS), role, uk ? units[uk] : null)).lastInsertRowid;
      userByRole[role].push({ id });
    }
  }

  // ---------------- Periode ----------------
  const insPeriod = db.prepare('INSERT INTO periods (tahun,bulan,status) VALUES (?,?,?)');
  await insPeriod.run(2025, 12, 'closed');
  for (let m = 1; m <= 12; m++) await insPeriod.run(2026, m, 'open');
  const adminU = await auth.getUser(userByRole.admin[0].id);
  await db.prepare("UPDATE periods SET closed_by=?, closed_at=datetime('now') WHERE tahun=2025 AND bulan=12").run(adminU.id);

  // ---------------- Jurnal contoh ----------------
  const staf = await auth.getUser(userByRole.staf_akuntansi[0].id);
  const bendahara = await auth.getUser(userByRole.bendahara[0].id);
  const post = async (payload) => { const j = await svc.createDraft(staf, payload); await svc.submit(staf, j.id); await svc.approve(bendahara, j.id); return j; };

  await post({ tanggal: '2026-01-02', unit_id: units.YYS, deskripsi: 'Saldo awal kas & bank Yayasan 2026',
    lines: [{ account_id: accId['1122'], unit_id: units.YYS, debit: 500000000 }, { account_id: accId['1111'], unit_id: units.YYS, debit: 25000000 }, { account_id: accId['3100'], unit_id: units.YYS, kredit: 525000000 }] });
  await post({ tanggal: '2026-03-25', unit_id: units.STM, deskripsi: 'Pembayaran gaji & tunjangan pegawai Maret 2026 — STMIK',
    lines: [{ account_id: accId['5100'], unit_id: units.STM, debit: 85000000 },
      { account_id: accId['2130'], unit_id: units.STM, kredit: 1700000 },
      { account_id: accId['2140'], unit_id: units.STM, kredit: 3000000 },
      { account_id: accId['1121'], unit_id: units.STM, kredit: 80300000 }] });
  await post({ tanggal: '2026-06-30', unit_id: units.STM, deskripsi: 'Penyusutan gedung & peralatan semester I 2026 — STMIK',
    lines: [{ account_id: accId['5700'], unit_id: units.STM, debit: 18000000 }, { account_id: accId['1290'], unit_id: units.STM, kredit: 18000000 }] });
  await post({ tanggal: '2026-03-10', unit_id: units.UNV, deskripsi: 'Hibah beasiswa terikat dari donatur — Universitas',
    lines: [{ account_id: accId['1123'], unit_id: units.UNV, debit: 75000000 }, { account_id: accId['4300'], unit_id: units.UNV, kredit: 75000000 }] });
  await post({ tanggal: '2026-04-05', unit_id: units.YYS, deskripsi: 'Talangan honor dosen STMIK oleh Yayasan',
    lines: [{ account_id: accId['1140'], unit_id: units.YYS, debit: 30000000 }, { account_id: accId['1122'], unit_id: units.YYS, kredit: 30000000 }] });
  await post({ tanggal: '2026-04-05', unit_id: units.STM, deskripsi: 'Pengakuan honor dosen LB (ditalangi Yayasan)',
    lines: [{ account_id: accId['5300'], unit_id: units.STM, debit: 30000000 }, { account_id: accId['2150'], unit_id: units.STM, kredit: 30000000 }] });
  // Pending & draft
  const jp = await svc.createDraft(staf, { tanggal: '2026-07-03', unit_id: units.STM, deskripsi: 'Pembayaran beban listrik & internet Juli 2026',
    lines: [{ account_id: accId['5500'], unit_id: units.STM, debit: 12500000 }, { account_id: accId['1121'], unit_id: units.STM, kredit: 12500000 }] });
  await svc.submit(staf, jp.id);
  await svc.createDraft(staf, { tanggal: '2026-07-08', unit_id: units.UNV, deskripsi: 'Draft — pembelian peralatan lab (menunggu kelengkapan)',
    lines: [{ account_id: accId['1230'], unit_id: units.UNV, debit: 45000000 }, { account_id: accId['2110'], unit_id: units.UNV, kredit: 45000000 }] });

  // ---------------- Rekening kas & bank ----------------
  const insBank = db.prepare('INSERT INTO bank_accounts (nama,bank,no_rekening,account_id,unit_id) VALUES (?,?,?,?,?)');
  const bankMandiriSTM = (await insBank.run('Bank Mandiri — UKT STMIK', 'Bank Mandiri', '137-00-1234567-8', accId['1121'], units.STM)).lastInsertRowid;
  await insBank.run('BSI — Operasional Yayasan', 'Bank Syariah Indonesia', '710-2345678', accId['1122'], units.YYS);
  const bankBNI = (await insBank.run('Bank BNI — Universitas', 'Bank BNI', '088-7654321', accId['1123'], units.UNV)).lastInsertRowid;
  await insBank.run('Kas Besar Yayasan', 'Tunai', '-', accId['1111'], units.YYS);
  await insBank.run('Kas Besar STMIK', 'Tunai', '-', accId['1111'], units.STM);

  // Kategori kas
  const insCat = db.prepare('INSERT INTO cash_categories (jenis,nama,account_id,urutan) VALUES (?,?,?,?)');
  const cat = {};
  const cats = [['penerimaan', 'Pembayaran UKT mahasiswa', '1131'], ['penerimaan', 'Pendapatan pendaftaran', '4200'],
    ['penerimaan', 'Hibah / sumbangan terikat', '4300'], ['penerimaan', 'Sumbangan tidak terikat', '4400'],
    ['penerimaan', 'Pendapatan lain-lain', '4900'], ['pengeluaran', 'Beban operasional kampus', '5400'],
    ['pengeluaran', 'Gaji & tunjangan', '5100'], ['pengeluaran', 'Honor dosen luar biasa', '5300'],
    ['pengeluaran', 'Listrik, air & internet', '5500'], ['pengeluaran', 'Pemeliharaan gedung', '5600'],
    ['pengeluaran', 'Pembayaran utang usaha', '2110']];
  for (let i = 0; i < cats.length; i++) { const [j, n, k] = cats[i]; cat[n] = (await insCat.run(j, n, accId[k], i)).lastInsertRowid; }

  const kasTx = [
    ['receipt', '2026-03-08', cat['Pendapatan pendaftaran'], 6500000, 'Penerimaan pendaftaran jalur prestasi'],
    ['payment', '2026-03-22', cat['Listrik, air & internet'], 4200000, 'Pembayaran internet kampus Maret'],
    ['receipt', '2026-04-12', cat['Sumbangan tidak terikat'], 10000000, 'Sumbangan alumni'],
    ['payment', '2026-05-06', cat['Beban operasional kampus'], 2750000, 'Pembelian bahan praktikum'],
    ['receipt', '2026-06-05', cat['Pendapatan pendaftaran'], 8500000, 'Penerimaan pendaftaran gelombang 1'],
    ['payment', '2026-06-20', cat['Beban operasional kampus'], 3250000, 'Pembelian ATK kantor'],
    ['receipt', '2026-06-28', cat['Pendapatan lain-lain'], 5000000, 'Penerimaan sewa aula & lain-lain'],
    ['receipt', '2026-07-04', cat['Pendapatan pendaftaran'], 7000000, 'Penerimaan pendaftaran gelombang 2'],
  ];
  for (const [jenis, tgl, category_id, amount, catatan] of kasTx) {
    const fn = jenis === 'receipt' ? cash.createReceipt : cash.createPayment;
    const j = await fn(staf, { bank_account_id: bankMandiriSTM, tanggal: tgl, category_id, amount, catatan });
    await svc.approve(bendahara, j.id);
  }

  // ---------------- Mahasiswa & Piutang UKT ----------------
  const insStu = db.prepare('INSERT INTO students (nim,nama,prodi,unit_id,angkatan,status) VALUES (?,?,?,?,?,?)');
  const mhs = [
    ['2201001', 'Ahmad Fauzi', 'Teknik Informatika', 'STM', 2022],
    ['2201002', 'Siti Nurhaliza', 'Sistem Informasi', 'STM', 2022],
    ['2301003', 'Budi Santoso', 'Teknik Informatika', 'STM', 2023],
    ['2301005', 'Rina Marlina', 'Sistem Informasi', 'STM', 2023],
    ['2401006', 'Dandi Kurniawan', 'Teknik Informatika', 'STM', 2024],
    ['2101007', 'Fitri Handayani', 'Sistem Informasi', 'STM', 2021],
    ['2501014', 'Yoga Prasetya', 'Teknik Informatika', 'STM', 2025],
    ['2401001', 'Dewi Lestari', 'Manajemen', 'UNV', 2024],
    ['2401002', 'Rizki Pratama', 'Akuntansi', 'UNV', 2024],
    ['2301004', 'Putri Ananda', 'Hukum', 'UNV', 2023],
    ['2201010', 'Agus Setiawan', 'Manajemen', 'UNV', 2022],
    ['2301011', 'Nabila Zahra', 'Akuntansi', 'UNV', 2023],
    ['2101012', 'Hendra Gunawan', 'Hukum', 'UNV', 2021],
    ['2401013', 'Maya Sari', 'Manajemen', 'UNV', 2024],
  ];
  const stu = {}, ukByNim = {};
  for (const [nim, nama, prodi, uk, ang] of mhs) {
    stu[nim] = (await insStu.run(nim, nama, prodi, units[uk], ang, 'aktif')).lastInsertRowid;
    ukByNim[nim] = uk;
  }
  const uktOf = (uk) => uk === 'UNV' ? 12000000 : 9000000;
  const bankOf = (uk) => uk === 'UNV' ? bankBNI : bankMandiriSTM;
  const mkInv = (sid, semester, nominal, tanggal, due, mulai) => piutang.createInvoice(staf, {
    student_id: sid, semester, nominal, tanggal, jatuh_tempo: due, tenor_bulan: 6, mulai_amortisasi: mulai });
  const pay = (invId, tanggal, nominal, uk) => piutang.recordPayment(staf, {
    invoice_id: invId, tanggal, nominal, metode: 'transfer', bank_account_id: bankOf(uk) });

  // Semester 2025 Ganjil (mahasiswa angkatan ≤ 2024): mayoritas lunas, dua menunggak (aging dalam)
  const nunggakGanjil = new Set(['2101007', '2101012']);
  for (const [nim, , , uk, ang] of mhs) {
    if (ang > 2024) continue;
    const inv = await mkInv(stu[nim], '2025 Ganjil', uktOf(uk), '2025-09-01', '2025-10-10', '2025-09-01');
    if (!nunggakGanjil.has(nim)) await pay(inv.id, '2025-09-20', uktOf(uk), uk);
  }

  // Semester 2026 Genap (semua): variasi jatuh tempo & status bayar untuk demo aging & CKPN
  // [nim, jatuh_tempo, bayar]  bayar: 'full' | 'partial' | 'none'
  const genapPlan = [
    ['2201001', '2026-03-10', 'partial'], ['2201002', '2026-06-25', 'full'], ['2301003', '2026-08-31', 'none'],
    ['2301005', '2026-05-20', 'none'], ['2401006', '2026-06-28', 'partial'], ['2101007', '2026-04-25', 'none'],
    ['2501014', '2026-07-31', 'none'], ['2401001', '2026-03-05', 'none'], ['2401002', '2026-06-20', 'full'],
    ['2301004', '2026-04-30', 'partial'], ['2201010', '2026-06-30', 'none'], ['2301011', '2026-05-15', 'none'],
    ['2101012', '2026-03-01', 'none'], ['2401013', '2026-08-15', 'full'],
  ];
  for (const [nim, due, bayar] of genapPlan) {
    const uk = ukByNim[nim], nominal = uktOf(uk);
    const inv = await mkInv(stu[nim], '2026 Genap', nominal, '2026-02-01', due, '2026-02-01');
    if (bayar === 'full') await pay(inv.id, '2026-02-25', nominal, uk);
    else if (bayar === 'partial') {
      await pay(inv.id, '2026-02-20', Math.round(nominal * 0.3), uk);
      await pay(inv.id, '2026-04-15', Math.round(nominal * 0.2), uk);
    }
  }

  // Pengakuan pendapatan (PSAK 72): amortisasi bulanan → mengisi tren penerimaan & histori pengakuan
  for (const [th, bl] of [[2025, 9], [2025, 10], [2025, 11], [2026, 2], [2026, 3], [2026, 4], [2026, 5], [2026, 6], [2026, 7]]) {
    try { await piutang.runAmortisasi(staf, th, bl); } catch (_) { /* lewati periode terkunci */ }
  }

  // ---------------- Anggaran RKAT 2026 ----------------
  const insBudget = db.prepare("INSERT INTO budgets (tahun,unit_id,account_id,nominal,status) VALUES (?,?,?,?,'disahkan')");
  const rkat = [
    [units.STM, '5100', 600000000], [units.STM, '5300', 45000000], [units.STM, '5400', 60000000], [units.STM, '5500', 48000000],
    [units.UNV, '5100', 500000000], [units.UNV, '5400', 50000000], [units.UNV, '5500', 36000000],
    [units.YYS, '5400', 40000000], [units.YYS, '5100', 200000000],
  ];
  for (const [uid, kode, nominal] of rkat) await insBudget.run(2026, uid, accId[kode], nominal * 100);

  // ---------------- Pajak ----------------
  const insRate = db.prepare('INSERT INTO tax_rates (kode,nama,jenis,account_utang_id,tarif_bp) VALUES (?,?,?,?,?)');
  const rPph21 = (await insRate.run('PPH21-HONOR', 'PPh 21 Honorarium (bukan pegawai tetap)', 'pph21', accId['2130'], 500)).lastInsertRowid;
  const rPph23Jasa = (await insRate.run('PPH23-JASA', 'PPh 23 Jasa', 'pph23', accId['2135'], 200)).lastInsertRowid;
  await insRate.run('PPH23-SEWA', 'PPh 23 Sewa (selain tanah & bangunan)', 'pph23', accId['2135'], 200);
  await tax.recordWithholding(staf, { rate_id: rPph21, tanggal: '2026-07-05', unit_id: units.STM,
    beban_account_id: accId['5300'], bank_account_id: bankMandiriSTM, lawan_nama: 'Dr. Hendra Wijaya',
    lawan_npwp: '09.876.543.2-401.000', dpp: 10000000, keterangan: 'Honor mengajar Juli 2026' });
  await tax.recordWithholding(staf, { rate_id: rPph23Jasa, tanggal: '2026-07-06', unit_id: units.UNV,
    beban_account_id: accId['5400'], bank_account_id: bankBNI, lawan_nama: 'CV Solusi Digital',
    lawan_npwp: '01.222.333.4-402.000', dpp: 15000000, keterangan: 'Jasa pemeliharaan sistem' });

  const n = async (t) => (await db.prepare(`SELECT COUNT(*) c FROM ${t}`).get()).c;
  console.log(`✓ Seed selesai: ${await n('users')} pengguna, ${await n('accounts')} akun, 3 unit, 13 periode, ${await n('journals')} jurnal, ${await n('students')} mahasiswa, ${await n('invoices')} tagihan.`);
  console.log(`  Login demo (sandi semua: "${DEMO_PASS}"): admin1@tazkia.ac.id, stafakuntansi1@…, bendahara1@…, pengurusyayasan1@…`);
}

if (require.main === module) {
  seed().then(() => db.close()).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = seed;
