// Perakit Manual SIKEU Tazkia → docs/manual/index.html (satu file, gambar ter-embed).
// Menyusun bagian dari docs/manual/parts/*.html, membuat daftar isi & navigasi
// dari heading, menyematkan screenshot sebagai data URI, dan menyuntik lampiran
// yang digenerate dari database (bagan akun & matriks peran).
// Jalankan:  npm run docs:manual
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAN = join(ROOT, 'docs', 'manual');
const PARTS = join(MAN, 'parts');
const SHOTS = join(ROOT, 'docs', 'screenshots');

const VERSION = '1.0';
const TANGGAL = process.env.MANUAL_DATE || new Date().toISOString().slice(0, 10);

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };
async function dataUri(file) {
  const buf = await readFile(file);
  return `data:${MIME[extname(file).toLowerCase()] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
}

// Sematkan <img src="...screenshots/xxx.png"> / src="../screenshots/xxx.png" sebagai data URI
async function inlineImages(html) {
  const re = /src="([^"]*screenshots\/[^"]+|[^"]*assets\/[^"]+)"/g;
  const jobs = [];
  html.replace(re, (m, p) => { jobs.push(p); return m; });
  const map = {};
  for (const p of [...new Set(jobs)]) {
    const base = p.split('/').pop();
    const dir = p.includes('assets/') ? join(ROOT, 'docs', 'assets') : SHOTS;
    const abs = join(dir, base);
    map[p] = existsSync(abs) ? await dataUri(abs) : p;
  }
  return html.replace(re, (m, p) => `src="${map[p] || p}"`);
}

// Ambil heading h2 (bab) & h3 (sub-bab) untuk TOC + sidebar
function extractToc(html) {
  const re = /<h([23])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  const items = []; let m;
  while ((m = re.exec(html))) {
    const text = m[3].replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim();
    items.push({ level: +m[1], id: m[2], text });
  }
  return items;
}

async function loadParts() {
  if (!existsSync(PARTS)) return [];
  const files = (await readdir(PARTS)).filter(f => f.endsWith('.html')).sort();
  const out = [];
  for (const f of files) out.push(await readFile(join(PARTS, f), 'utf8'));
  return out;
}

// ---- Lampiran dari database (opsional; hanya bila server DB tersedia) ----
async function genBaganAkun() {
  try {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://sikeu:sikeu123@127.0.0.1:55432/sikeu';
    const db = (await import(new URL('../src/db/index.js', import.meta.url))).default;
    const rows = await db.prepare(`SELECT kode,nama,tipe,is_postable,normal_balance,is_kontra,is_interunit,net_asset_class
      FROM accounts ORDER BY kode`).all();
    await db.close();
    const tr = rows.map(a => `<tr>
      <td class="mono">${a.kode}</td><td>${esc(a.nama)}</td><td>${esc(a.tipe)}</td>
      <td class="c">${a.normal_balance}</td>
      <td>${a.is_postable ? 'Ya' : '—'}</td>
      <td>${[a.is_kontra ? 'kontra' : '', a.is_interunit ? 'antar-unit' : '', a.net_asset_class ? 'neto:' + a.net_asset_class : ''].filter(Boolean).join(', ') || '—'}</td>
    </tr>`).join('');
    return `<div class="figure"><table class="tbl"><thead><tr><th>KODE</th><th>NAMA AKUN</th><th>TIPE</th><th class="c">SALDO NORMAL</th><th>DAPAT DIPOSTING</th><th>SIFAT</th></tr></thead><tbody>${tr}</tbody></table></div>
    <p class="src-note">Dihasilkan otomatis dari basis data — ${rows.length} akun. Perbarui dengan <span class="mono">npm run docs:manual</span>.</p>`;
  } catch (e) {
    return `<p class="callout warn">Bagan akun tidak dapat digenerate otomatis (server DB tidak terjangkau saat build): ${esc(e.message)}. Jalankan ulang saat DB aktif.</p>`;
  }
}

function genMatriksPeran() {
  // Cermin dari computePerms() (public/app.js) & requireRole (src/routes/*).
  const roles = ['admin', 'staf_akuntansi', 'kasir', 'bendahara', 'kepala_unit', 'pengurus_yayasan'];
  const label = { admin: 'Admin', staf_akuntansi: 'Staf Akuntansi', kasir: 'Kasir', bendahara: 'Bendahara', kepala_unit: 'Kepala Unit', pengurus_yayasan: 'Pengurus Yayasan' };
  const caps = [
    ['Input jurnal / kas', ['staf_akuntansi', 'kasir', 'bendahara', 'admin']],
    ['Setujui & posting jurnal', ['bendahara', 'pengurus_yayasan', 'admin']],
    ['Rekonsiliasi bank', ['staf_akuntansi', 'bendahara', 'admin']],
    ['Kelola mahasiswa & tagihan', ['admin', 'staf_akuntansi', 'bendahara']],
    ['Catat pembayaran UKT', ['admin', 'staf_akuntansi', 'kasir', 'bendahara']],
    ['Proses CKPN & amortisasi', ['admin', 'staf_akuntansi', 'bendahara']],
    ['Susun anggaran RKAT', ['admin', 'staf_akuntansi', 'bendahara']],
    ['Sahkan anggaran RKAT', ['admin', 'pengurus_yayasan']],
    ['Potong & setor pajak', ['admin', 'staf_akuntansi', 'bendahara']],
    ['Kelola master data & COA', ['admin', 'staf_akuntansi']],
    ['Kunci / buka periode', ['admin', 'bendahara', 'pengurus_yayasan']],
    ['Tutup buku tahunan', ['admin', 'bendahara', 'pengurus_yayasan']],
    ['Backup database', ['admin']],
    ['Lihat semua laporan & dashboard', roles],
    ['Lihat jejak audit', ['admin', 'pengurus_yayasan']],
  ];
  const head = `<tr><th>KEWENANGAN</th>${roles.map(r => `<th class="c">${label[r]}</th>`).join('')}</tr>`;
  const body = caps.map(([cap, allowed]) =>
    `<tr><td>${cap}</td>${roles.map(r => `<td class="c">${allowed.includes(r) ? '<span class="yes">●</span>' : '<span class="no">·</span>'}</td>`).join('')}</tr>`).join('');
  return `<div class="figure"><table class="tbl matrix"><thead>${head}</thead><tbody>${body}</tbody></table></div>
  <p class="src-note">● = berwenang. Sumber: konfigurasi <span class="mono">computePerms()</span> & <span class="mono">requireRole()</span> di kode.</p>`;
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function shell(bodyHtml, toc) {
  const navItems = toc.map(t => `<a class="nav-l${t.level} ${''}" href="#${t.id}" data-id="${t.id}">${esc(t.text)}</a>`).join('');
  const tocList = toc.map(t => `<li class="toc-l${t.level}"><a href="#${t.id}">${esc(t.text)}</a></li>`).join('');
  return `<meta charset="utf-8">
<title>Manual Penggunaan SIKEU Tazkia</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
<div class="doc">
  <aside class="sidebar no-print">
    <div class="side-brand"><div class="logo">T</div><div><b>SIKEU</b><span>Manual Penggunaan</span></div></div>
    <input id="q" class="search" type="search" placeholder="Cari di manual…" autocomplete="off">
    <nav class="side-nav">${navItems}</nav>
    <div class="side-foot">v${VERSION} · ${TANGGAL}</div>
  </aside>
  <main class="content">
    ${COVER(tocList)}
    ${bodyHtml}
  </main>
</div>
<script>${JS}</script>`;
}

function COVER(tocList) {
  return `<section class="cover">
    <div class="cover-top">
      <div class="cover-logo">T</div>
      <div class="cover-org">YAYASAN TAZKIA CENDIKIA</div>
    </div>
    <div class="cover-mid">
      <div class="cover-kicker">Dokumen Resmi · Panduan Pengguna</div>
      <h1 class="cover-title">Manual Penggunaan<br>SIKEU Tazkia</h1>
      <div class="cover-sub">Sistem Informasi Keuangan &amp; Akuntansi<br>Yayasan Tazkia Cendikia — STMIK &amp; Universitas Tazkia</div>
    </div>
    <div class="cover-foot">
      <div><b>Versi ${VERSION}</b></div><div>${TANGGAL}</div>
    </div>
  </section>
  <section class="toc-page">
    <h2 id="daftar-isi" class="notoc">Daftar Isi</h2>
    <ul class="toc">${tocList}</ul>
  </section>`;
}

const CSS = `
:root{--primary:#2E1E4F;--primary2:#3F2A68;--ink:#241E33;--muted:#6b647a;--muted2:#4a4458;--line:#E7E4EF;--soft:#F4F3F8;--gold:#C9A227;--gold-bg:#F3E9C8;--gold-ink:#8A6A16;--green:#256D42;--red:#C0392B;}
*{box-sizing:border-box;} html{scroll-behavior:smooth;}
body{margin:0;font-family:'Plus Jakarta Sans',system-ui,Segoe UI,Arial,sans-serif;color:var(--ink);background:var(--soft);line-height:1.62;font-size:15px;}
.mono{font-family:'JetBrains Mono',ui-monospace,Consolas,monospace;}
.doc{display:flex;}
.sidebar{position:fixed;top:0;left:0;bottom:0;width:288px;background:linear-gradient(180deg,#2E1E4F,#3F2A68);color:#EFEAF7;display:flex;flex-direction:column;padding:20px 0;z-index:10;}
.side-brand{display:flex;gap:11px;align-items:center;padding:0 22px 16px;}
.side-brand .logo{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#C9A227,#F3E9C8);color:#2E1E4F;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:20px;}
.side-brand b{display:block;font-size:16px;letter-spacing:.03em;} .side-brand span{display:block;font-size:11px;color:#B7ACD6;}
.search{margin:0 18px 12px;padding:9px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;font-size:13px;font-family:inherit;}
.search::placeholder{color:#B7ACD6;}
.side-nav{overflow-y:auto;flex:1;padding:4px 10px 10px;}
.side-nav a{display:block;color:#CFC6E6;text-decoration:none;font-size:12.6px;padding:5px 12px;border-radius:7px;border-left:2px solid transparent;}
.side-nav a:hover{background:rgba(255,255,255,.07);color:#fff;}
.side-nav a.active{background:rgba(201,162,39,.18);color:#fff;border-left-color:var(--gold);}
.side-nav a.nav-l3{padding-left:24px;font-size:12px;color:#B0A6CC;}
.side-nav a.hide{display:none;}
.side-foot{padding:12px 22px 2px;font-size:11px;color:#9A8FBC;border-top:1px solid rgba(255,255,255,.1);}
.content{margin-left:288px;flex:1;max-width:940px;padding:0 56px 90px;background:#fff;min-height:100vh;box-shadow:0 0 40px rgba(46,30,79,.06);}
.content>section{padding-top:26px;}
h2{font-size:26px;font-weight:800;color:var(--primary);margin:46px 0 6px;padding-top:14px;border-top:3px solid var(--gold);letter-spacing:-.01em;}
h2.notoc,h2.nobreak{border-top:none;}
h3{font-size:19.5px;font-weight:800;color:var(--primary2);margin:30px 0 8px;}
h4{font-size:15.5px;font-weight:800;color:var(--ink);margin:20px 0 6px;}
p{margin:9px 0;} a{color:var(--primary2);}
ul,ol{margin:9px 0;padding-left:22px;} li{margin:4px 0;}
ol.steps{counter-reset:step;list-style:none;padding-left:0;}
ol.steps>li{counter-increment:step;position:relative;padding:6px 0 6px 44px;margin:6px 0;}
ol.steps>li::before{content:counter(step);position:absolute;left:0;top:5px;width:28px;height:28px;background:var(--primary);color:#fff;border-radius:50%;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;}
.lead{font-size:16.5px;color:var(--muted2);}
.mono,code{font-family:'JetBrains Mono',monospace;font-size:.9em;background:var(--soft);padding:1px 5px;border-radius:5px;}
.callout{border-radius:11px;padding:13px 16px 13px 46px;margin:14px 0;position:relative;font-size:14px;border:1px solid;}
.callout::before{position:absolute;left:14px;top:12px;font-size:18px;}
.callout.tip{background:#EAF6EF;border-color:#BFE3CD;} .callout.tip::before{content:"💡";}
.callout.warn{background:#FBF3DC;border-color:#EAD79B;} .callout.warn::before{content:"⚠️";}
.callout.note{background:#EEF0FB;border-color:#CBD2F0;} .callout.note::before{content:"📌";}
.box-sikeu{background:linear-gradient(180deg,#F7F3FF,#F1ECFA);border:1px solid #DBCFF2;border-left:4px solid var(--primary);border-radius:11px;padding:13px 16px;margin:16px 0;font-size:14px;}
.box-sikeu b.tag{display:inline-block;background:var(--primary);color:#fff;font-size:11px;font-weight:800;padding:2px 9px;border-radius:6px;letter-spacing:.04em;margin-right:6px;}
.figure{margin:18px 0;}
.figure img{width:100%;border:1px solid var(--line);border-radius:10px;box-shadow:0 6px 18px rgba(46,30,79,.10);}
.caption{font-size:12.5px;color:var(--muted);margin-top:7px;text-align:center;font-weight:600;}
.caption b{color:var(--primary2);}
table.tbl{width:100%;border-collapse:collapse;font-size:13px;margin:4px 0;}
table.tbl th{background:var(--soft);text-align:left;padding:8px 10px;border-bottom:2px solid var(--line);font-size:11px;letter-spacing:.03em;color:var(--muted2);}
table.tbl td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top;}
table.tbl td.c,table.tbl th.c{text-align:center;} table.tbl td.r{text-align:right;}
table.matrix .yes{color:var(--green);font-size:15px;} table.matrix .no{color:#CFC9DA;}
.jrnl{width:100%;border-collapse:collapse;font-size:13px;margin:10px 0;font-family:'JetBrains Mono',monospace;}
.jrnl th{background:var(--primary);color:#fff;padding:7px 10px;font-size:11px;text-align:left;}
.jrnl td{padding:6px 10px;border-bottom:1px solid var(--line);} .jrnl td.r{text-align:right;} .jrnl tr.tot td{font-weight:700;border-top:2px solid var(--primary);background:var(--soft);}
.src-note{font-size:12px;color:var(--muted);font-style:italic;}
.proc{margin:22px 0 6px;padding:8px 14px;background:linear-gradient(90deg,#F1ECFA,transparent);border-left:4px solid var(--gold);font-size:16px;font-weight:800;color:var(--primary2);border-radius:0 8px 8px 0;}
.proc-meta{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:12px 0;font-size:13px;background:#fff;}
.proc-meta>div{padding:10px 14px;border-right:1px solid var(--line);}
.proc-meta>div:last-child{border-right:none;}
.proc-meta .k{display:block;font-size:10px;font-weight:800;letter-spacing:.05em;color:var(--gold-ink);text-transform:uppercase;margin-bottom:3px;}
.result{background:#EAF6EF;border:1px solid #BFE3CD;border-radius:9px;padding:9px 14px;margin:12px 0;font-size:14px;}
.result b{color:var(--green);}
.dl dt{font-weight:800;color:var(--primary2);margin-top:12px;}
.dl dd{margin:2px 0 0;padding-left:0;color:var(--muted2);}
.faq{margin:14px 0;border-bottom:1px solid var(--line);padding-bottom:12px;}
.faq .q{font-weight:800;color:var(--ink);}
.faq .q::before{content:"T: ";color:var(--gold-ink);}
.faq .a{margin-top:4px;color:var(--muted2);}
.faq .a::before{content:"J: ";color:var(--primary2);font-weight:800;}
.pill{display:inline-block;background:var(--gold-bg);color:var(--gold-ink);font-size:11px;font-weight:800;padding:2px 9px;border-radius:9999px;}
.status-row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;}
.badge{display:inline-block;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:800;}
.b-draft{background:#EDE9F6;color:#3F2A68;} .b-pending{background:#FBF3DC;color:#8A6A16;} .b-posted{background:#E3F1E7;color:#256D42;} .b-rev{background:#EAE6F2;color:#5B5468;} .b-rej{background:#F7E4E1;color:#C0392B;}
/* Cover */
.cover{height:min(100vh,1040px);min-height:840px;background:linear-gradient(150deg,#2E1E4F 0%,#3F2A68 60%,#4B3080 100%);color:#fff;display:flex;flex-direction:column;justify-content:space-between;padding:64px 60px;margin:0 -56px;position:relative;overflow:hidden;}
.cover::after{content:"";position:absolute;right:-120px;top:-120px;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,rgba(201,162,39,.30),transparent 70%);}
.cover-top{display:flex;align-items:center;gap:16px;z-index:1;}
.cover-logo{width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,#C9A227,#F3E9C8);color:#2E1E4F;font-weight:800;font-size:34px;display:flex;align-items:center;justify-content:center;}
.cover-org{font-size:14px;font-weight:700;letter-spacing:.22em;color:#E7DCFF;}
.cover-kicker{font-size:14px;font-weight:700;letter-spacing:.18em;color:var(--gold);text-transform:uppercase;}
.cover-title{font-size:56px;font-weight:800;line-height:1.05;margin:14px 0 18px;letter-spacing:-.02em;}
.cover-sub{font-size:18px;color:#D9CEF2;line-height:1.6;}
.cover-foot{display:flex;justify-content:space-between;font-size:15px;color:#CFC3EC;border-top:1px solid rgba(255,255,255,.2);padding-top:18px;z-index:1;}
.toc-page{padding-top:30px;}
ul.toc{list-style:none;padding:0;margin:12px 0;column-gap:40px;}
ul.toc li{margin:3px 0;}
ul.toc li.toc-l2{font-weight:800;color:var(--primary);margin-top:12px;border-top:1px solid var(--line);padding-top:8px;}
ul.toc li.toc-l3{padding-left:18px;font-size:13.5px;}
ul.toc a{text-decoration:none;color:inherit;display:flex;justify-content:space-between;gap:12px;align-items:baseline;}
ul.toc a:hover{color:var(--gold-ink);}
mark{background:#FCE9A6;padding:0 2px;border-radius:3px;}
/* Print / PDF */
@media print{
  @page{size:A4;margin:20mm 16mm 18mm;
    @bottom-center{content:"Manual SIKEU Tazkia · v${VERSION}";font-family:'Plus Jakarta Sans',sans-serif;font-size:9px;color:#8a8397;}
    @bottom-right{content:"Hal. " counter(page);font-family:'Plus Jakarta Sans',sans-serif;font-size:9px;color:#8a8397;}
    @top-right{content:"Yayasan Tazkia Cendikia";font-family:'Plus Jakarta Sans',sans-serif;font-size:9px;color:#b3acc0;}
  }
  @page cover{margin:0;@bottom-center{content:none;}@bottom-right{content:none;}@top-right{content:none;}}
  .no-print{display:none!important;}
  body{background:#fff;font-size:10.5pt;}
  .content{margin:0;max-width:none;box-shadow:none;padding:0;}
  .cover{page:cover;height:100vh;margin:0;page-break-after:always;}
  .toc-page{page-break-after:always;}
  h2{page-break-before:always;page-break-after:avoid;border-top:none;padding-top:0;}
  h2.notoc,h2.nobreak,#daftar-isi{page-break-before:avoid;}
  h3,h4{page-break-after:avoid;}
  .figure,table,.callout,.box-sikeu,.jrnl,.proc-meta,.result,.faq{page-break-inside:avoid;}
  .proc{page-break-after:avoid;}
  .figure img{box-shadow:none;}
  ul.toc a::after{content:target-counter(attr(href), page);color:var(--muted);font-weight:700;}
}
@media(max-width:900px){.sidebar{display:none;}.content{margin:0;padding:0 20px 60px;}.cover{margin:0 -20px;}}
`;

const JS = `
(function(){
  const nav=[...document.querySelectorAll('.side-nav a')];
  const q=document.getElementById('q');
  // Scrollspy
  const heads=nav.map(a=>document.getElementById(a.dataset.id)).filter(Boolean);
  const spy=()=>{let cur=heads[0];for(const h of heads){if(h.getBoundingClientRect().top<=120)cur=h;}
    nav.forEach(a=>a.classList.toggle('active',a.dataset.id===(cur&&cur.id)));};
  document.addEventListener('scroll',spy,{passive:true});spy();
  // Search: filter nav + highlight in content
  let marks=[];
  q.addEventListener('input',()=>{
    const term=q.value.trim().toLowerCase();
    nav.forEach(a=>a.classList.toggle('hide',term&&!a.textContent.toLowerCase().includes(term)));
    marks.forEach(m=>{const p=m.parentNode;p.replaceChild(document.createTextNode(m.textContent),m);p.normalize();});marks=[];
    if(term.length<2)return;
    const walk=document.createTreeWalker(document.querySelector('.content'),NodeFilter.SHOW_TEXT);
    const hits=[];let n;while(n=walk.nextNode()){if(n.parentNode.closest('script,style,.cover'))continue;if(n.nodeValue.toLowerCase().includes(term))hits.push(n);}
    hits.slice(0,400).forEach(node=>{const idx=node.nodeValue.toLowerCase().indexOf(term);if(idx<0)return;
      const m=document.createElement('mark');m.textContent=node.nodeValue.substr(idx,term.length);
      const after=node.splitText(idx);after.nodeValue=after.nodeValue.substr(term.length);
      node.parentNode.insertBefore(m,after);marks.push(m);});
  });
})();
`;

async function main() {
  await mkdir(MAN, { recursive: true });
  let parts = await loadParts();
  let body = parts.join('\n');
  body = body.split('<!--BAGAN_AKUN-->').join(await genBaganAkun());
  body = body.split('<!--MATRIKS_PERAN-->').join(genMatriksPeran());
  const toc = extractToc(body);
  let html = shell(body, toc);
  html = await inlineImages(html);
  const out = join(MAN, 'index.html');
  await writeFile(out, '<!doctype html>\n' + html, 'utf8');
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  console.log(`✓ Manual dirakit: docs/manual/index.html (${kb} KB, ${toc.length} heading, ${parts.length} bagian)`);
}
main().catch(e => { console.error(e); process.exit(1); });
