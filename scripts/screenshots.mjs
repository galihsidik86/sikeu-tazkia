// Skrip screenshot manual SIKEU Tazkia (reusable).
// Prasyarat: (1) DB sudah di-seed  →  npm run reset
//            (2) server berjalan     →  npm start   (http://127.0.0.1:3000)
//            (3) browser Playwright  →  npx playwright install chromium
// Jalankan:  npm run docs:screenshots
// Hasil:     docs/screenshots/NN-modul-NN-langkah.png
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.SIKEU_URL || 'http://127.0.0.1:3000';
const PASS = process.env.SIKEU_PASS || 'sikeu123';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
const EMAIL = {
  admin: 'admin1@tazkia.ac.id', staf: 'stafakuntansi1@tazkia.ac.id', kasir: 'kasir1@tazkia.ac.id',
  bendahara: 'bendahara1@tazkia.ac.id', pengurus: 'pengurusyayasan1@tazkia.ac.id',
};

let page, ok = 0, fail = 0;

async function shot(name, { full = false } = {}) {
  await page.screenshot({ path: join(OUT, name + '.png'), fullPage: full });
  console.log('  ✓', name);
  ok++;
}
async function capture(name, fn) {
  try { await fn(); await shot(name); }
  catch (e) { console.log('  ✗', name, '→', e.message.split('\n')[0]); fail++; }
}
async function goHash(hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  // Tunggu placeholder "Memuat…" tergantikan konten sesungguhnya
  await page.waitForFunction(() => {
    const m = document.querySelector('#main');
    return m && m.textContent && !/Memuat…/.test(m.textContent);
  }, { timeout: 9000 });
  await page.waitForTimeout(850); // biarkan sub-fetch (tab), data & grafik selesai
}
async function annotate(targets) {
  await page.evaluate((targets) => {
    const layer = document.createElement('div');
    layer.id = '__annot';
    layer.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;';
    targets.forEach((t, i) => {
      const el = document.querySelector(t.sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px;border:3px solid #E4322B;border-radius:10px;box-shadow:0 0 0 3px rgba(228,50,43,.16);`;
      const badge = document.createElement('div');
      badge.textContent = String(i + 1);
      badge.style.cssText = `position:absolute;left:${r.left - 15}px;top:${r.top - 15}px;width:26px;height:26px;background:#E4322B;color:#fff;border-radius:50%;font:800 14px/26px 'Plus Jakarta Sans',Arial,sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.35);`;
      layer.appendChild(box); layer.appendChild(badge);
    });
    document.body.appendChild(layer);
  }, targets);
}
async function clearAnnot() { await page.evaluate(() => { const a = document.getElementById('__annot'); if (a) a.remove(); }); }
async function closeModalUI() { const b = await page.$('#mCancel'); if (b) { await b.click(); await page.waitForTimeout(250); } }

async function login(email) {
  await page.context().clearCookies();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', PASS);
  await page.click('#submitBtn');
  await page.waitForSelector('.sidebar', { timeout: 10000 });
  await page.waitForSelector('#main .page', { timeout: 10000 });
  await page.waitForTimeout(800);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const health = await fetch(BASE + '/api/health').then(r => r.json()).catch(() => null);
  if (!health || !health.ok) { console.error(`\n✗ Server tidak terjangkau di ${BASE}. Jalankan "npm start" dahulu.\n`); process.exit(1); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'id-ID' });
  page = await ctx.newPage();

  // ============ 01 — MEMULAI (admin) ============
  await capture('01-mulai-01-login', async () => {
    await page.context().clearCookies();
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  });
  await login(EMAIL.admin);
  await capture('01-mulai-02-dashboard', async () => {
    await goHash('/dashboard', '.stat-grid');
    await annotate([{ sel: '.sidebar' }, { sel: '.unit-pick' }, { sel: '#pwdBtn' }, { sel: '.stat-grid' }]);
  });
  await clearAnnot();
  await capture('01-mulai-03-ganti-sandi', async () => {
    await page.click('#pwdBtn');
    await page.waitForSelector('#cpOld', { timeout: 4000 });
    await page.waitForTimeout(300);
  });
  await closeModalUI();

  // ============ 02 — MASTER DATA ============
  for (const [tab, name] of [['coa', 'coa'], ['unit', 'unit'], ['periode', 'periode'], ['pengguna', 'pengguna']]) {
    await capture(`02-master-0${['coa', 'unit', 'periode', 'pengguna'].indexOf(tab) + 1}-${name}`, async () => {
      await goHash('/master/' + tab, '#masterOut');
    });
  }

  // ============ 03 — JURNAL UMUM ============
  await capture('03-jurnal-01-daftar', async () => { await goHash('/jurnal'); });
  await capture('03-jurnal-02-form', async () => { await goHash('/jurnal/baru'); });
  await capture('03-jurnal-03-detail-posted', async () => {
    await goHash('/jurnal');
    await page.locator('#main tbody tr:has(.badge.posted)').first().click();
    await page.waitForSelector('#aVoucher', { timeout: 8000 });
    await page.waitForTimeout(400);
  });
  // Voucher terbuka di jendela baru (window.open) — tangkap popup langsung
  try {
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#aVoucher')]);
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(500);
    await popup.screenshot({ path: join(OUT, '03-jurnal-04-voucher.png') });
    await popup.close();
    console.log('  ✓', '03-jurnal-04-voucher'); ok++;
  } catch (e) { console.log('  ✗', '03-jurnal-04-voucher →', e.message.split('\n')[0]); fail++; }

  // ============ 04 — KAS & BANK ============
  for (const [tab, idx, name] of [['rekening', 1, 'rekening'], ['keluar', 2, 'pengeluaran'], ['rekon', 3, 'rekonsiliasi'], ['kategori', 4, 'kategori']]) {
    await capture(`04-kasbank-0${idx}-${name}`, async () => { await goHash('/kasbank/' + tab); });
  }

  // ============ 05 — PIUTANG UKT ============
  await capture('05-piutang-01-daftar', async () => { await goHash('/piutang/daftar', '#piOut'); });
  await capture('05-piutang-02-mahasiswa', async () => { await goHash('/piutang/mahasiswa', '#piOut'); });
  await capture('05-piutang-03-impor', async () => {
    await page.click('#impStu'); await page.waitForSelector('#impFile', { timeout: 4000 }); await page.waitForTimeout(300);
  });
  await closeModalUI();
  await capture('05-piutang-04-generate', async () => { await goHash('/piutang/generate'); });
  await capture('05-piutang-05-aging-ckpn', async () => { await goHash('/piutang/ckpn'); });
  await capture('05-piutang-06-amortisasi', async () => { await goHash('/piutang/amortisasi'); });
  await capture('05-piutang-07-bayar', async () => {
    await goHash('/piutang/daftar');
    await page.locator('[data-pay]').first().click();
    await page.waitForSelector('#pyAmt', { timeout: 4000 }); await page.waitForTimeout(300);
  });
  await closeModalUI();

  // ============ 06 — PAJAK ============
  for (const [tab, idx, name] of [['pemotongan', 1, 'pemotongan'], ['rekap', 2, 'rekap-setor'], ['tarif', 3, 'tarif']]) {
    await capture(`06-pajak-0${idx}-${name}`, async () => { await goHash('/pajak/' + tab, '#pjOut'); });
  }

  // ============ 07 — ANGGARAN RKAT ============
  await capture('07-anggaran-01-realisasi', async () => { await goHash('/anggaran'); });

  // ============ 08 — LAPORAN KEUANGAN ============
  for (const [type, idx, name] of [['posisi', 1, 'posisi'], ['aktivitas', 2, 'aktivitas'], ['asetneto', 3, 'perubahan-aset-neto'], ['aruskas', 4, 'arus-kas']]) {
    await capture(`08-laporan-0${idx}-${name}`, async () => {
      await goHash('/laporan');
      await page.selectOption('#lapType', type);
      await page.waitForTimeout(900);
    });
  }

  // ============ 09 — BUKU BESAR & NERACA ============
  await capture('09-lainnya-01-buku-besar', async () => { await goHash('/bukubesar'); });
  await capture('09-lainnya-02-neraca-saldo', async () => { await goHash('/neraca'); });

  // ============ 10 — AUDIT & ADMINISTRASI ============
  await capture('10-admin-01-audit', async () => { await goHash('/audit'); });
  await capture('10-admin-02-tutup-buku', async () => { await goHash('/admin/tutupbuku'); });
  await capture('10-admin-03-backup', async () => { await goHash('/admin/backup'); });

  // ============ 11 — TAMPILAN PER PERAN ============
  await login(EMAIL.kasir);
  await capture('11-peran-01-kasir-penerimaan', async () => {
    await goHash('/kasbank/terima');
    await annotate([{ sel: '#main .card' }]);
  });
  await clearAnnot();
  await login(EMAIL.bendahara);
  await capture('11-peran-02-bendahara-approval', async () => {
    await goHash('/jurnal');
    await page.locator('#main tbody tr:has(.badge.pending)').first().click();
    await page.waitForSelector('#aApprove', { timeout: 8000 });
    await page.waitForTimeout(400);
    await annotate([{ sel: '#aApprove' }, { sel: '#aReject' }]);
  });
  await clearAnnot();

  await browser.close();
  console.log(`\nSelesai: ${ok} screenshot dibuat, ${fail} gagal.  →  docs/screenshots/\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
