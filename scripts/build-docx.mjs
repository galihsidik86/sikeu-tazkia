// Rakit DOCX dari konten manual (docs/manual/index.html) memakai html-to-docx.
// Menyisipkan field TOC Word (daftar isi otomatis + nomor halaman saat dibuka).
// Jalankan:  npm run docs:docx   (prasyarat: npm run docs:manual)
import HTMLtoDOCX from 'html-to-docx';
import JSZip from 'jszip';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAN = join(ROOT, 'docs', 'manual');
const VERSION = '1.0';
const TANGGAL = process.env.MANUAL_DATE || new Date().toISOString().slice(0, 10);

async function injectToc(buf) {
  const zip = await JSZip.loadAsync(buf);
  // 1) Ganti paragraf penanda TOKENTOC dengan field TOC
  let doc = await zip.file('word/document.xml').async('string');
  const field =
    '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t xml:space="preserve">Daftar isi akan tampil di sini. Klik kanan lalu pilih "Update Field".</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  doc = doc.replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?TOKENTOC[\s\S]*?<\/w:r>/, field);
  zip.file('word/document.xml', doc);
  // 2) Minta Word memperbarui field saat dokumen dibuka
  const sf = zip.file('word/settings.xml');
  if (sf) {
    let s = await sf.async('string');
    if (!/updateFields/.test(s)) s = s.replace(/(<w:settings[^>]*>)/, '$1<w:updateFields w:val="true"/>');
    zip.file('word/settings.xml', s);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function main() {
  const built = await readFile(join(MAN, 'index.html'), 'utf8');
  // Ambil konten Bagian A–D (gambar sudah ter-embed, lampiran sudah tergenerate)
  const start = built.indexOf('<h2 id="bagian-a"');
  const end = built.indexOf('</main>');
  if (start < 0 || end < 0) throw new Error('Struktur index.html tak dikenali. Jalankan docs:manual dulu.');
  const body = built.slice(start, end);

  const cover =
    `<p style="text-align:center;font-size:13px;letter-spacing:2px;color:#8a6a16;">YAYASAN TAZKIA CENDIKIA</p>` +
    `<h1 style="text-align:center;color:#2E1E4F;">Manual Penggunaan SIKEU Tazkia</h1>` +
    `<p style="text-align:center;font-size:15px;color:#444;">Sistem Informasi Keuangan &amp; Akuntansi<br/>` +
    `Yayasan Tazkia Cendikia — STMIK &amp; Universitas Tazkia</p>` +
    `<p style="text-align:center;color:#666;">Versi ${VERSION} &nbsp;·&nbsp; ${TANGGAL}</p>` +
    `<hr/><h1>Daftar Isi</h1><p>TOKENTOC</p><br style="page-break-after:always"/>`;

  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><style>
    body{font-family:'Segoe UI',Arial,sans-serif;color:#241E33;font-size:11pt;line-height:1.5;}
    h1{font-size:19pt;color:#2E1E4F;} h2{font-size:15pt;color:#2E1E4F;} h3{font-size:13pt;color:#3F2A68;} h4{font-size:11.5pt;}
    table{border-collapse:collapse;width:100%;} th,td{border:1px solid #ccc;padding:4px 7px;font-size:9.5pt;text-align:left;}
    th{background:#F0EDF7;} img{max-width:100%;}
  </style></head><body>${cover}${body}</body></html>`;

  const opts = {
    title: 'Manual Penggunaan SIKEU Tazkia',
    orientation: 'portrait',
    margins: { top: 1134, right: 1000, bottom: 1134, left: 1000 },
    footer: true,
    pageNumber: true,
    table: { row: { cantSplit: true } },
    font: 'Segoe UI',
    fontSize: 22,
    heading: { headingFontSize: 30 },
  };
  let buf = await HTMLtoDOCX(html, null, opts, null);
  try { buf = await injectToc(buf); }
  catch (e) { console.log('  (TOC field dilewati:', e.message + ')'); }
  const out = join(MAN, 'Manual-SIKEU-Tazkia.docx');
  await writeFile(out, buf);
  console.log(`✓ DOCX dirakit: docs/manual/Manual-SIKEU-Tazkia.docx (${Math.round(buf.length / 1024)} KB)`);
}
main().catch(e => { console.error(e); process.exit(1); });
