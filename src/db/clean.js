'use strict';
// Pembersih data demo — menyiapkan sistem untuk data riil.
//
// MENYIMPAN (struktur & konfigurasi): bagan akun (COA), unit, periode, kategori kas,
//   rekening bank, tarif pajak, tarif CKPN, dan pengguna ber-peran admin.
// MENGHAPUS (transaksi & demo): jurnal, kas, piutang (mahasiswa/tagihan/pembayaran/
//   pengakuan pendapatan), anggaran RKAT, pemotongan pajak, mutasi bank, jejak audit,
//   tutup buku, dan pengguna NON-admin.
// Membuat BACKUP otomatis sebelum menghapus. Bersifat destruktif → butuh --confirm.
//
// Contoh:
//   npm run clean                              (pratinjau saja, tidak menghapus)
//   npm run clean -- --confirm                 (hapus; menyimpan semua admin)
//   npm run clean -- --confirm --keep-admin=admin@tazkia.ac.id
//                                              (hapus; hanya menyimpan 1 admin ini)
const db = require('./index');
const backup = require('../services/backupService');

const TX_TABLES = ['journal_lines', 'journals', 'revenue_recognition', 'payments', 'invoices',
  'students', 'budgets', 'tax_withholdings', 'bank_statements', 'audit_log', 'year_closings'];
const REPORT = ['journals', 'students', 'invoices', 'payments', 'tax_withholdings', 'budgets', 'users'];

async function counts() {
  const o = {};
  for (const t of REPORT) o[t] = (await db.prepare(`SELECT COUNT(*) c FROM ${t}`).get()).c;
  return o;
}

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--confirm') || process.env.CLEAN_CONFIRM === '1';
  const keepEmail = (args.find(a => a.startsWith('--keep-admin=')) || '').split('=')[1];

  console.log('Sebelum:', await counts());

  if (!confirmed) {
    console.log('\n⚠  PRATINJAU — belum ada yang dihapus.');
    console.log('   Perintah ini akan menghapus SELURUH data transaksi & demo, menyimpan COA,');
    console.log('   unit, periode, konfigurasi, dan pengguna admin. Backup dibuat otomatis dulu.');
    console.log('   Jalankan ulang dengan --confirm untuk melanjutkan:  npm run clean -- --confirm');
    await db.close();
    return;
  }

  // Validasi --keep-admin agar tidak mengunci diri sendiri
  if (keepEmail) {
    const u = await db.prepare('SELECT id, role FROM users WHERE lower(email)=lower(?)').get(keepEmail);
    if (!u) { console.error(`✗ Batal: pengguna "${keepEmail}" tidak ditemukan.`); await db.close(); process.exit(1); }
  }

  console.log('→ Membuat backup pengaman…');
  try {
    const admin = await db.prepare("SELECT id, nama, role FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
    const actor = admin ? { ...admin, ip: 'clean' } : { id: null, nama: 'system', role: 'admin', ip: 'clean' };
    const b = await backup.backupNow(actor, 'pre-clean');
    console.log('  backup dibuat:', b.name);
  } catch (e) {
    console.log('  (backup dilewati:', e.message, ')');
  }

  await db.tx(async () => {
    await db.exec(`TRUNCATE ${TX_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await db.prepare("UPDATE periods SET status='open', closed_by=NULL, closed_at=NULL").run();
    let del;
    if (keepEmail) {
      await db.prepare('UPDATE users SET role=? WHERE lower(email)=lower(?)').run('admin', keepEmail);
      del = await db.prepare('DELETE FROM users WHERE lower(email) <> lower(?)').run(keepEmail);
    } else {
      del = await db.prepare("DELETE FROM users WHERE role <> 'admin'").run();
    }
    console.log(`  pengguna dihapus: ${del.changes}`);
  });

  console.log('Sesudah:', await counts());
  const admins = await db.prepare("SELECT email FROM users WHERE role='admin' ORDER BY id").all();
  console.log('Admin tersisa:', admins.map(a => a.email).join(', ') || '(tidak ada!)');
  console.log('✓ Pembersihan selesai. Segera GANTI SANDI admin dan masukkan data riil.');
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
