// Rakit PDF dari docs/manual/index.html memakai Paged.js (paginasi + nomor halaman + TOC).
// Jalankan:  npm run docs:pdf   (prasyarat: npm run docs:manual)
import { chromium } from 'playwright';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAN = join(ROOT, 'docs', 'manual');

async function main() {
  const src = await readFile(join(MAN, 'index.html'), 'utf8');
  const paged = await readFile(join(ROOT, 'node_modules', 'pagedjs', 'dist', 'paged.polyfill.js'), 'utf8');
  // Sisipkan Paged.js di akhir dokumen agar memaginasi konten sesuai @media print / @page.
  const temp = join(MAN, '_pdf-temp.html');
  await writeFile(temp, src + `\n<script>${paged}</script>`, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.emulateMedia({ media: 'print' });
  await page.goto(pathToFileURL(temp).href, { waitUntil: 'load', timeout: 120000 });
  // Tunggu Paged.js selesai memaginasi
  await page.waitForFunction(() => document.querySelector('.pagedjs_pages') &&
    document.querySelectorAll('.pagedjs_page').length > 0, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const pages = await page.evaluate(() => document.querySelectorAll('.pagedjs_page').length);

  const out = join(MAN, 'Manual-SIKEU-Tazkia.pdf');
  await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
  await browser.close();
  await unlink(temp).catch(() => {});
  if (errors.length) console.log('  catatan:', errors.slice(0, 3).join(' | '));
  console.log(`✓ PDF dirakit: docs/manual/Manual-SIKEU-Tazkia.pdf (${pages} halaman)`);
}
main().catch(e => { console.error(e); process.exit(1); });
