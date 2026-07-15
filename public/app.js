'use strict';
/* SIKEU Tazkia — SPA Fase 1 */

// ---------------- Utilities ----------------
const $ = (s, r = document) => r.querySelector(s);
const api = {
  async req(method, url, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(url, opt);
    if (res.status === 401) { location.href = '/login'; throw new Error('Sesi berakhir.'); }
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.error) || 'Terjadi kesalahan.');
    return data;
  },
  get(u) { return this.req('GET', u); },
  post(u, b) { return this.req('POST', u, b || {}); },
  put(u, b) { return this.req('PUT', u, b || {}); },
  del(u) { return this.req('DELETE', u); },
};

function fmtNum(sen) {
  const neg = sen < 0; sen = Math.abs(Math.round(sen));
  const r = Math.floor(sen / 100), d = String(sen % 100).padStart(2, '0');
  return (neg ? '-' : '') + String(r).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
}
const fmtRp = (sen) => 'Rp ' + fmtNum(sen || 0);
function toSen(input) {
  if (input == null || input === '') return 0;
  if (typeof input === 'number') return Math.round(input * 100);
  let s = String(input).trim().replace(/rp/gi, '').replace(/\s/g, '');
  if (!s) return 0;
  s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/\./g, '');
  const v = parseFloat(s); return Number.isNaN(v) ? 0 : Math.round(v * 100);
}
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return iso || '';
  return `${+m[3]} ${MONTHS[+m[2]]} ${m[1]}`;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const STATUS = { draft: 'Draft', pending: 'Menunggu', posted: 'Diposting', reversed: 'Dibalik', rejected: 'Ditolak' };
const statusBadge = (s) => `<span class="badge ${s}">${STATUS[s] || s}</span>`;

function toast(msg, kind = '') {
  const box = $('#toast'); const el = document.createElement('div');
  el.className = 'msg ' + kind; el.textContent = msg; box.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function openChangePassword() {
  openModal('Ganti Kata Sandi', `
    <div class="field"><label>Kata sandi lama <span class="req">*</span></label>
      <input class="inp" type="password" id="cpOld" autocomplete="current-password"></div>
    <div class="field" style="margin-top:12px;"><label>Kata sandi baru <span class="req">*</span></label>
      <input class="inp" type="password" id="cpNew" autocomplete="new-password" placeholder="Minimal 8 karakter"></div>
    <div class="field" style="margin-top:12px;"><label>Ulangi kata sandi baru <span class="req">*</span></label>
      <input class="inp" type="password" id="cpNew2" autocomplete="new-password"></div>
    <div class="note" style="margin-top:10px;">Setelah diganti, gunakan kata sandi baru pada login berikutnya.</div>`,
    async () => {
      const old_password = $('#cpOld').value, new_password = $('#cpNew').value, confirm2 = $('#cpNew2').value;
      if (!old_password || !new_password) throw new Error('Lengkapi semua kolom.');
      if (new_password.length < 8) throw new Error('Kata sandi baru minimal 8 karakter.');
      if (new_password !== confirm2) throw new Error('Konfirmasi kata sandi baru tidak cocok.');
      await api.post('/api/auth/change-password', { old_password, new_password });
      toast('Kata sandi berhasil diganti.', 'ok');
    });
}

// ---------------- State ----------------
const state = { user: null, units: [], unit: 'all', accounts: [] };
const perms = {};
function computePerms() {
  const r = state.user.role;
  perms.author = ['staf_akuntansi', 'kasir', 'bendahara', 'admin'].includes(r);
  perms.approve = ['bendahara', 'pengurus_yayasan', 'admin'].includes(r);
  perms.cash = ['kasir', 'staf_akuntansi', 'bendahara', 'admin'].includes(r);
  perms.recon = ['staf_akuntansi', 'bendahara', 'admin'].includes(r);
  perms.billing = ['admin', 'staf_akuntansi', 'bendahara'].includes(r);
  perms.pay = ['admin', 'staf_akuntansi', 'kasir', 'bendahara'].includes(r);
  perms.process = ['admin', 'staf_akuntansi', 'bendahara'].includes(r);
  perms.studentMaster = ['admin', 'staf_akuntansi'].includes(r);
  perms.budgetEdit = ['admin', 'staf_akuntansi', 'bendahara'].includes(r);
  perms.budgetApprove = ['admin', 'pengurus_yayasan'].includes(r);
  perms.taxRecord = ['admin', 'staf_akuntansi', 'kasir', 'bendahara'].includes(r);
  perms.taxSetor = ['admin', 'staf_akuntansi', 'bendahara'].includes(r);
  perms.taxRate = ['admin', 'staf_akuntansi'].includes(r);
  perms.closing = ['admin', 'bendahara', 'pengurus_yayasan'].includes(r);
  perms.reopenYear = ['admin', 'pengurus_yayasan'].includes(r);
  perms.backup = r === 'admin';
  perms.master = ['admin', 'staf_akuntansi'].includes(r);
  perms.admin = r === 'admin';
  perms.period = ['admin', 'bendahara', 'pengurus_yayasan'].includes(r);
}
const unitName = () => state.unit === 'all' ? 'Konsolidasi — semua unit'
  : (state.units.find(u => u.kode === state.unit) || {}).nama || state.unit;

// ---------------- Boot ----------------
(async function boot() {
  try {
    const me = await api.get('/api/auth/me'); state.user = me.user;
  } catch { location.href = '/login'; return; }
  computePerms();
  state.units = await api.get('/api/master/units');
  try { state.accounts = await api.get('/api/master/accounts'); } catch { state.accounts = []; }
  renderShell();
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/dashboard';
  route();
})();

// ---------------- Shell ----------------
const NAV = [
  { group: 'TRANSAKSI' },
  { k: 'dashboard', label: 'Dashboard', icon: iconDash },
  { k: 'jurnal', label: 'Jurnal Umum', icon: iconDoc },
  { k: 'kasbank', label: 'Kas & Bank', icon: iconWallet },
  { k: 'piutang', label: 'Piutang UKT', icon: iconGrad },
  { k: 'pajak', label: 'Pajak (PPh)', icon: iconTax },
  { k: 'anggaran', label: 'Anggaran (RKAT)', icon: iconBudget },
  { group: 'PELAPORAN' },
  { k: 'laporan', label: 'Laporan Keuangan', icon: iconReport },
  { k: 'bukubesar', label: 'Buku Besar', icon: iconBook },
  { k: 'neraca', label: 'Neraca Saldo', icon: iconChart },
  { group: 'PENGATURAN' },
  { k: 'master', label: 'Master Data', icon: iconDb, need: () => true },
  { k: 'admin', label: 'Administrasi', icon: iconGear, need: () => perms.closing || perms.backup },
  { k: 'audit', label: 'Jejak Audit', icon: iconShield, need: () => perms.admin || state.user.role === 'pengurus_yayasan' },
];

function renderShell() {
  const initials = state.user.nama.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const navHtml = NAV.map(n => {
    if (n.group) return `<div class="nav-group">${n.group}</div>`;
    if (n.need && !n.need()) return '';
    return `<div class="nav-item" data-nav="${n.k}">${n.icon()}<span>${n.label}</span></div>`;
  }).join('');
  const unitOpts = ['<option value="all">Konsolidasi — semua unit</option>']
    .concat(state.units.map(u => `<option value="${u.kode}">${esc(u.nama)}</option>`)).join('');

  $('#app').innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <div class="logo">T</div>
        <div><div class="t1">SIKEU</div><div class="t2">YAYASAN TAZKIA CENDIKIA</div></div>
      </div>
      ${navHtml}
      <div class="side-user">
        <div class="avatar">${initials}</div>
        <div style="min-width:0;">
          <div style="font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(state.user.nama)}</div>
          <div style="margin-top:2px;"><span class="badge draft">${esc(state.user.roleLabel)}</span></div>
        </div>
      </div>
    </aside>
    <div class="main-wrap">
      <header class="topbar">
        <div class="crumb">SIKEU / <b id="crumb">Dashboard</b></div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:10px;">
          <div class="unit-pick">
            ${iconBuilding()}
            <select id="unitSel">${unitOpts}</select>
          </div>
          <button class="btn sm" id="pwdBtn">Ganti Sandi</button>
          <button class="btn sm" id="logoutBtn">Keluar</button>
        </div>
      </header>
      <main id="main"></main>
    </div>
  </div>`;

  $('#unitSel').value = state.unit;
  $('#unitSel').addEventListener('change', e => { state.unit = e.target.value; route(); });
  $('#logoutBtn').addEventListener('click', async () => { await api.post('/api/auth/logout'); location.href = '/login'; });
  $('#pwdBtn').addEventListener('click', openChangePassword);
  $('#app').querySelectorAll('[data-nav]').forEach(el =>
    el.addEventListener('click', () => { location.hash = '#/' + el.dataset.nav; }));
}

function setActive(k, crumb) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.nav === k));
  const c = $('#crumb'); if (c) c.textContent = crumb;
}

// ---------------- Router ----------------
async function route() {
  const hash = location.hash.replace(/^#/, '') || '/dashboard';
  const parts = hash.split('/').filter(Boolean); // e.g. ['jurnal','5']
  const main = $('#main'); if (!main) return;
  main.innerHTML = '<div class="subtle" style="padding:20px;">Memuat…</div>';
  try {
    switch (parts[0]) {
      case 'dashboard': setActive('dashboard', 'Dashboard'); return viewDashboard();
      case 'jurnal':
        if (parts[1] === 'baru') { setActive('jurnal', 'Buat Jurnal'); return viewJurnalForm(null); }
        if (parts[1] && parts[2] === 'edit') { setActive('jurnal', 'Ubah Jurnal'); return viewJurnalForm(+parts[1]); }
        if (parts[1]) { setActive('jurnal', 'Detail Jurnal'); return viewJurnalDetail(+parts[1]); }
        setActive('jurnal', 'Jurnal Umum'); return viewJurnalList();
      case 'kasbank': setActive('kasbank', 'Kas & Bank'); return viewKasBank(parts[1] || 'rekening');
      case 'piutang': setActive('piutang', 'Piutang UKT'); return viewPiutang(parts[1] || 'daftar');
      case 'pajak': setActive('pajak', 'Pajak (PPh)'); return viewPajak(parts[1] || 'pemotongan');
      case 'anggaran': setActive('anggaran', 'Anggaran (RKAT)'); return viewAnggaran();
      case 'laporan': setActive('laporan', 'Laporan Keuangan'); return viewLaporan();
      case 'bukubesar': setActive('bukubesar', 'Buku Besar'); return viewLedger();
      case 'neraca': setActive('neraca', 'Neraca Saldo'); return viewTrialBalance();
      case 'admin': setActive('admin', 'Administrasi'); return viewAdmin(parts[1] || 'tutupbuku');
      case 'master': setActive('master', 'Master Data'); return viewMaster(parts[1] || 'coa');
      case 'audit': setActive('audit', 'Jejak Audit'); return viewAudit();
      default: location.hash = '#/dashboard';
    }
  } catch (e) { main.innerHTML = `<div class="err-box">${esc(e.message)}</div>`; }
}

// ================= DASHBOARD EKSEKUTIF =================
async function viewDashboard() {
  const d = await api.get('/api/reports/executive');
  const k = d.konsolidasi;
  const stat = (label, val, sub, color) => `
    <div class="stat"><div class="label">${label}</div><div class="value">${val}</div>
      ${sub ? `<div class="sub" style="color:${color || 'var(--muted)'}">${sub}</div>` : ''}</div>`;

  const unitRows = d.perUnit.map(u => `<tr>
    <td style="font-weight:700;">${esc(u.unit_nama)}</td>
    <td class="r mono">${fmtNum(u.aset)}</td>
    <td class="r mono">${fmtNum(u.pendapatan)}</td>
    <td class="r mono">${fmtNum(u.beban)}</td>
    <td class="r mono" style="font-weight:700;color:${u.surplus >= 0 ? 'var(--green)' : 'var(--red)'};">${fmtNum(u.surplus)}</td>
    <td class="r mono">${fmtNum(u.kas)}</td></tr>`).join('');

  const agingMax = Math.max(1, ...d.aging.buckets.map(b => b.outstanding));
  const agingBars = d.aging.buckets.map(b => `
    <div style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:600;color:var(--muted2);">
        <span>${esc(b.label)} <span class="note">(${(b.rate * 100).toLocaleString('id')}%)</span></span><span class="mono">${fmtNum(b.outstanding)}</span></div>
      <div style="height:7px;background:#EEECF3;border-radius:9999px;margin-top:3px;"><div style="height:100%;border-radius:9999px;width:${Math.round(b.outstanding / agingMax * 100)}%;background:${b.key === 'b4' || b.key === 'b3' ? 'var(--red)' : b.key === 'b2' ? 'var(--gold)' : 'var(--green)'};"></div></div>
    </div>`).join('');

  const serapWarn = d.serapan >= 80;
  const tren = d.trenPenerimaan || [];
  const trenMax = Math.max(1, ...tren.map(t => t.total));
  const trenBars = tren.map(t => `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;" title="${esc(t.label)}: ${fmtRp(t.total)}">
      <div style="width:100%;height:110px;display:flex;align-items:flex-end;justify-content:center;">
        <div style="width:60%;border-radius:4px 4px 0 0;background:linear-gradient(180deg,#4B3080,#2E1E4F);height:${Math.max(2, Math.round(t.total / trenMax * 110))}px;"></div></div>
      <div class="note" style="font-size:9.5px;white-space:nowrap;">${esc(t.label)}</div>
    </div>`).join('');
  $('#main').innerHTML = `
    <div class="row-between">
      <div><h1 class="page">Dashboard Eksekutif</h1>
        <div class="subtle">Yayasan Tazkia Cendikia · konsolidasi · posisi per ${fmtDate(d.tanggal)}</div></div>
      <div class="pill">Tahun anggaran ${d.tahun}${d.tahunDitutup ? ' · <b style="color:var(--red);">sudah ditutup</b>' : ''}</div>
    </div>
    <div class="stat-grid">
      ${stat('Total Aset', fmtRp(k.aset))}
      ${stat('Kas &amp; Bank', fmtRp(k.kas))}
      ${stat('Aset Neto', fmtRp(k.asetNeto))}
      ${stat('Surplus / (Defisit) YTD', fmtRp(k.surplus), k.surplus >= 0 ? 'Surplus' : 'Defisit', k.surplus >= 0 ? 'var(--green)' : 'var(--red)')}
      ${stat('Piutang Beredar', fmtRp(d.piutangOutstanding), 'CKPN ' + fmtRp(d.aging.totalCkpn), 'var(--red)')}
      ${stat('Serapan Anggaran', d.serapan + '%', fmtRp(d.realisasi) + ' / ' + fmtRp(d.anggaran), serapWarn ? 'var(--gold-ink)' : 'var(--muted)')}
      ${stat('Mahasiswa Aktif', d.mahasiswaAktif.toLocaleString('id'))}
      ${stat('Menunggu Persetujuan', d.pendingCount + ' jurnal', d.draftCount + ' draft', 'var(--gold-ink)')}
    </div>
    <div class="grid" style="grid-template-columns:1.4fr 1fr;margin-top:16px;align-items:start;">
      <div class="card tbl-wrap">
        <div style="padding:14px 18px;border-bottom:1px solid var(--line);font-weight:800;">Kinerja per unit (tahun berjalan)</div>
        <table class="tbl"><thead><tr><th>UNIT</th><th class="r">ASET</th><th class="r">PENDAPATAN</th><th class="r">BEBAN</th><th class="r">SURPLUS</th><th class="r">KAS</th></tr></thead>
        <tbody>${unitRows}</tbody>
        <tfoot><tr class="tfoot"><td>KONSOLIDASI</td><td class="r mono">${fmtNum(k.aset)}</td><td class="r mono">${fmtNum(k.pendapatan)}</td><td class="r mono">${fmtNum(k.beban)}</td><td class="r mono">${fmtNum(k.surplus)}</td><td class="r mono">${fmtNum(k.kas)}</td></tr></tfoot></table>
      </div>
      <div class="card pad">
        <div style="font-size:14px;font-weight:800;margin-bottom:12px;">Umur piutang UKT</div>
        ${agingBars}
        <div style="display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:8px;margin-top:4px;font-weight:800;font-size:12.5px;">
          <span>Total piutang</span><span class="mono">${fmtRp(d.aging.totalOutstanding)}</span></div>
      </div>
    </div>
    <div class="card pad" style="margin-top:16px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;">
        <div style="font-size:14px;font-weight:800;">Tren penerimaan 12 bulan terakhir</div>
        <div class="note">total ${fmtRp(tren.reduce((s, t) => s + t.total, 0))}</div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:6px;">${trenBars || '<div class="note">Belum ada data.</div>'}</div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:16px;">
      <div class="card pad">
        <div style="font-size:14px;font-weight:800;margin-bottom:10px;">Status pembukuan</div>
        ${d.interunit.balanced ? '<div class="ok-box">Akun antar-unit ter-eliminasi sempurna (saldo konsolidasi = 0).</div>' : `<div class="warn-box">Saldo akun antar-unit belum nol: ${fmtRp(d.interunit.totalNet)}.</div>`}
        ${serapWarn ? `<div class="warn-box" style="margin-top:8px;">Serapan anggaran ${d.serapan}% — mendekati/melewati batas 80%.</div>` : ''}
      </div>
      <div class="card pad">
        <div style="font-size:14px;font-weight:800;margin-bottom:10px;">Aksi cepat</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${perms.author ? `<button class="btn primary" onclick="location.hash='#/jurnal/baru'">+ Buat jurnal baru</button>` : ''}
          <button class="btn outline" onclick="location.hash='#/laporan'">Laporan keuangan ISAK 35</button>
          <button class="btn" onclick="location.hash='#/anggaran'">Realisasi anggaran (RKAT)</button>
        </div>
      </div>
    </div>`;
}

// ================= JURNAL: LIST =================
async function viewJurnalList() {
  const unitQ = state.unit === 'all' ? '' : '?unit=' + state.unit;
  const rows = await api.get('/api/journals' + unitQ);
  const body = rows.map(j => `
    <tr class="clickable" data-id="${j.id}">
      <td class="mono" style="color:var(--primary);font-weight:700;">${esc(j.nomor || '—')}</td>
      <td>${fmtDate(j.tanggal)}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(j.deskripsi)}</td>
      <td>${esc(j.unit_kode)}</td>
      <td class="r mono">${fmtRp(j.total)}</td>
      <td>${statusBadge(j.status)}</td>
      <td style="color:var(--muted2);">${esc(j.created_by_nama || '')}</td>
    </tr>`).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:28px;">Belum ada jurnal.</td></tr>`;
  $('#main').innerHTML = `
    <div class="row-between">
      <div><h1 class="page">Jurnal Umum</h1><div class="subtle">${rows.length} jurnal · ${esc(unitName())}</div></div>
      ${perms.author ? `<button class="btn primary" onclick="location.hash='#/jurnal/baru'">+ Buat jurnal</button>` : ''}
    </div>
    <div class="card tbl-wrap" style="margin-top:18px;">
      <table class="tbl"><thead><tr>
        <th>NO. JURNAL</th><th>TANGGAL</th><th>DESKRIPSI</th><th>UNIT</th>
        <th class="r">TOTAL (D=K)</th><th>STATUS</th><th>DIBUAT OLEH</th>
      </tr></thead><tbody>${body}</tbody></table>
    </div>`;
  $('#main').querySelectorAll('tr[data-id]').forEach(tr =>
    tr.addEventListener('click', () => { location.hash = '#/jurnal/' + tr.dataset.id; }));
}

// ================= JURNAL: FORM =================
async function viewJurnalForm(id) {
  const postable = state.accounts.filter(a => a.is_postable);
  let form;
  if (id) {
    const j = await api.get('/api/journals/' + id);
    if (j.status !== 'draft') { toast('Hanya draft yang bisa diedit.', 'err'); location.hash = '#/jurnal/' + id; return; }
    form = { id, tanggal: j.tanggal, unit_id: j.unit_id, deskripsi: j.deskripsi,
      lines: j.lines.map(l => ({ account_id: l.account_id, unit_id: l.unit_id, debit: l.debit ? fmtNum(l.debit) : '', kredit: l.kredit ? fmtNum(l.kredit) : '' })) };
  } else {
    const defUnit = state.unit !== 'all' ? (state.units.find(u => u.kode === state.unit) || {}).id : (state.user.unit_id || state.units[0].id);
    const today = new Date().toISOString().slice(0, 10);
    form = { id: null, tanggal: today, unit_id: defUnit, deskripsi: '',
      lines: [{ account_id: '', unit_id: defUnit, debit: '', kredit: '' }, { account_id: '', unit_id: defUnit, debit: '', kredit: '' }] };
  }

  const unitOpt = (sel) => state.units.map(u => `<option value="${u.id}" ${u.id == sel ? 'selected' : ''}>${esc(u.nama)}</option>`).join('');
  const accOpt = (sel) => `<option value="">— pilih akun —</option>` +
    postable.map(a => `<option value="${a.id}" ${a.id == sel ? 'selected' : ''}>${esc(a.kode)} — ${esc(a.nama)}</option>`).join('');

  function lineRows() {
    return form.lines.map((l, i) => `
      <tr>
        <td><select class="inp" data-i="${i}" data-f="account_id" style="min-width:220px;">${accOpt(l.account_id)}</select></td>
        <td><select class="inp" data-i="${i}" data-f="unit_id">${unitOpt(l.unit_id)}</select></td>
        <td><input class="inp mono r" data-i="${i}" data-f="debit" value="${esc(l.debit)}" placeholder="0"></td>
        <td><input class="inp mono r" data-i="${i}" data-f="kredit" value="${esc(l.kredit)}" placeholder="0"></td>
        <td class="c"><button class="btn sm danger" data-rm="${i}" title="Hapus baris">×</button></td>
      </tr>`).join('');
  }
  function totals() {
    let d = 0, k = 0;
    form.lines.forEach(l => { d += toSen(l.debit); k += toSen(l.kredit); });
    return { d, k, sel: d - k };
  }

  $('#main').innerHTML = `
    <div class="back" onclick="location.hash='#/jurnal'">← Kembali ke daftar jurnal</div>
    <h1 class="page">${id ? 'Ubah draft jurnal' : 'Buat jurnal baru'}</h1>
    <div class="subtle">Nomor diberikan otomatis saat jurnal diajukan.</div>
    <div class="card pad" style="margin-top:18px;">
      <div class="grid" style="grid-template-columns:180px 260px 1fr;">
        <div class="field"><label>Tanggal</label><input class="inp" type="date" id="fDate" value="${form.tanggal}"></div>
        <div class="field"><label>Unit utama <span class="req">*</span></label><select class="inp" id="fUnit">${unitOpt(form.unit_id)}</select></div>
        <div class="field"><label>Deskripsi <span class="req">*</span></label><input class="inp" id="fDesc" value="${esc(form.deskripsi)}" placeholder="Contoh: Pembayaran honor dosen Juli 2026"></div>
      </div>
      <div class="card tbl-wrap" style="margin-top:18px;">
        <table class="tbl"><thead><tr>
          <th>AKUN (KODE — NAMA)</th><th>UNIT / DIMENSI *</th><th class="r">DEBIT (Rp)</th><th class="r">KREDIT (Rp)</th><th></th>
        </tr></thead><tbody id="lineBody">${lineRows()}</tbody></table>
        <div style="display:flex;align-items:center;gap:14px;padding:11px 14px;background:var(--soft);">
          <button class="btn sm outline" id="addLine">+ Tambah baris</button>
          <div style="margin-left:auto;display:flex;align-items:center;gap:18px;" id="totalsBox"></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:18px;">
        <button class="btn" onclick="location.hash='#/jurnal'">Batal</button>
        <div style="margin-left:auto;display:flex;gap:10px;">
          <button class="btn outline" id="saveDraft">Simpan draft</button>
          <button class="btn primary" id="submitBtn">Ajukan persetujuan</button>
        </div>
      </div>
      <div class="note" style="margin-top:10px;text-align:right;">Jurnal hanya bisa diajukan saat total debit = total kredit.</div>
    </div>`;

  function renderTotals() {
    const t = totals();
    const balanced = t.sel === 0 && t.d > 0;
    $('#totalsBox').innerHTML = `
      <div class="note">Total debit <b class="mono" style="color:var(--ink);margin-left:6px;">${fmtRp(t.d)}</b></div>
      <div class="note">Total kredit <b class="mono" style="color:var(--ink);margin-left:6px;">${fmtRp(t.k)}</b></div>
      <span class="badge ${balanced ? 'posted' : 'rejected'}">${balanced ? 'Balance' : 'Selisih ' + fmtRp(t.sel)}</span>`;
    $('#submitBtn').disabled = !balanced;
  }
  function rebindLines() {
    $('#lineBody').innerHTML = lineRows();
    $('#lineBody').querySelectorAll('[data-i]').forEach(el => {
      el.addEventListener('change', ev => {
        const i = +ev.target.dataset.i, f = ev.target.dataset.f;
        form.lines[i][f] = ev.target.value; renderTotals();
      });
      if (el.classList.contains('mono')) el.addEventListener('input', () => renderTotals());
    });
    $('#lineBody').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
      if (form.lines.length <= 2) { toast('Minimal 2 baris.', 'err'); return; }
      form.lines.splice(+b.dataset.rm, 1); rebindLines(); renderTotals();
    }));
  }
  $('#fDate').addEventListener('change', e => form.tanggal = e.target.value);
  $('#fUnit').addEventListener('change', e => form.unit_id = +e.target.value);
  $('#fDesc').addEventListener('input', e => form.deskripsi = e.target.value);
  $('#addLine').addEventListener('click', () => { form.lines.push({ account_id: '', unit_id: form.unit_id, debit: '', kredit: '' }); rebindLines(); renderTotals(); });
  rebindLines(); renderTotals();

  async function persist() {
    const payload = { tanggal: form.tanggal, unit_id: +form.unit_id, deskripsi: form.deskripsi,
      lines: form.lines.filter(l => l.account_id && (toSen(l.debit) || toSen(l.kredit)))
        .map(l => ({ account_id: +l.account_id, unit_id: +l.unit_id, debit: l.debit || 0, kredit: l.kredit || 0 })) };
    if (form.id) return api.put('/api/journals/' + form.id, payload);
    return api.post('/api/journals', payload);
  }
  $('#saveDraft').addEventListener('click', async () => {
    try { const j = await persist(); toast('Draft tersimpan.', 'ok'); location.hash = '#/jurnal/' + j.id; }
    catch (e) { toast(e.message, 'err'); }
  });
  $('#submitBtn').addEventListener('click', async () => {
    try { const j = await persist(); await api.post('/api/journals/' + j.id + '/submit'); toast('Jurnal diajukan untuk persetujuan.', 'ok'); location.hash = '#/jurnal/' + j.id; }
    catch (e) { toast(e.message, 'err'); }
  });
}

// ================= JURNAL: DETAIL =================
async function viewJurnalDetail(id) {
  const j = await api.get('/api/journals/' + id);
  const lines = j.lines.map(l => `
    <tr><td><span class="mono" style="color:var(--primary);">${esc(l.akun_kode)}</span> — ${esc(l.akun_nama)}</td>
      <td style="color:var(--muted2);">${esc(l.unit_kode)}</td>
      <td class="r mono">${l.debit ? fmtNum(l.debit) : ''}</td>
      <td class="r mono">${l.kredit ? fmtNum(l.kredit) : ''}</td></tr>`).join('');
  const hist = (j.history || []).map(h => `
    <div style="display:flex;gap:10px;padding-bottom:14px;">
      <div style="display:flex;flex-direction:column;align-items:center;">
        <span style="width:9px;height:9px;border-radius:9999px;background:var(--primary);margin-top:4px;"></span>
        <span style="width:1.5px;flex:1;background:var(--line);margin-top:3px;"></span></div>
      <div><div style="font-size:12.5px;font-weight:700;">${esc(actLabel(h.action))}</div>
        <div class="note">${esc(h.user_nama || '')}${h.role ? ' · ' + esc(h.role) : ''}</div>
        <div style="font-size:11px;color:#ABA4B8;font-weight:600;">${esc(h.ts)}</div></div>
    </div>`).join('') || '<div class="note">Belum ada aktivitas.</div>';

  const actions = [];
  if (j.status === 'draft') {
    if (perms.author) {
      actions.push(`<button class="btn outline" id="aEdit">Ubah draft</button>`);
      actions.push(`<button class="btn primary" id="aSubmit">Ajukan persetujuan</button>`);
      actions.push(`<button class="btn danger" id="aDelete">Hapus</button>`);
    }
  } else if (j.status === 'pending') {
    if (perms.approve) {
      actions.push(`<button class="btn danger" id="aReject">Tolak</button>`);
      actions.push(`<button class="btn green" id="aApprove">Setujui &amp; posting</button>`);
    } else actions.push(`<div class="note">Menunggu persetujuan bendahara/pengurus.</div>`);
  } else if (j.status === 'posted') {
    if (perms.approve) actions.push(`<button class="btn gold" id="aReverse">Buat jurnal balik</button>`);
  }
  if (j.nomor) actions.unshift(`<button class="btn outline" id="aVoucher">Cetak voucher</button>`);

  const linkInfo = [];
  if (j.reversal_of_nomor) linkInfo.push(`Jurnal pembalik atas <b class="mono">${esc(j.reversal_of_nomor)}</b>`);
  if (j.reversed_by_nomor) linkInfo.push(`Sudah dibalik oleh <b class="mono">${esc(j.reversed_by_nomor)}</b>`);
  if (j.reject_alasan) linkInfo.push(`Alasan penolakan: ${esc(j.reject_alasan)}`);

  $('#main').innerHTML = `
    <div class="back" onclick="location.hash='#/jurnal'">← Kembali ke daftar jurnal</div>
    <div class="grid" style="grid-template-columns:1fr 320px;align-items:start;">
      <div class="card" style="padding:26px 30px;">
        <div style="text-align:center;border-bottom:2px solid var(--primary);padding-bottom:14px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:.16em;color:var(--muted);">YAYASAN TAZKIA CENDIKIA</div>
          <div style="font-size:19px;font-weight:800;color:var(--primary-d);margin-top:4px;">Bukti Jurnal Umum</div>
          <div class="mono" style="font-size:12.5px;font-weight:700;color:var(--primary);margin-top:4px;">${esc(j.nomor || '(draft — belum bernomor)')}</div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr;margin-top:16px;">
          <div><div class="note">TANGGAL</div><div style="font-weight:700;margin-top:3px;">${fmtDate(j.tanggal)}</div></div>
          <div><div class="note">UNIT</div><div style="font-weight:700;margin-top:3px;">${esc(j.unit_nama)}</div></div>
          <div><div class="note">STATUS</div><div style="margin-top:3px;">${statusBadge(j.status)}</div></div>
        </div>
        <div style="margin-top:12px;"><div class="note">DESKRIPSI</div><div style="font-weight:600;margin-top:3px;">${esc(j.deskripsi)}</div></div>
        ${linkInfo.length ? `<div class="warn-box" style="margin-top:12px;">${linkInfo.join('<br>')}</div>` : ''}
        <div class="card tbl-wrap" style="margin-top:16px;box-shadow:none;">
          <table class="tbl"><thead><tr><th>AKUN</th><th>UNIT</th><th class="r">DEBIT</th><th class="r">KREDIT</th></tr></thead>
          <tbody>${lines}</tbody>
          <tfoot><tr class="tfoot"><td>TOTAL</td><td></td><td class="r mono">${fmtNum(j.totalDebit)}</td><td class="r mono">${fmtNum(j.totalKredit)}</td></tr></tfoot>
          </table>
        </div>
        <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end;">${actions.join('')}</div>
      </div>
      <div class="card pad">
        <div style="font-size:14px;font-weight:800;margin-bottom:12px;">Riwayat dokumen</div>
        ${hist}
        <div class="note" style="border-top:1px solid #F0EEF4;padding-top:10px;">Dibuat oleh <b style="color:var(--ink);">${esc(j.created_by_nama || '')}</b></div>
      </div>
    </div>`;

  const bind = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
  bind('#aEdit', () => location.hash = '#/jurnal/' + id + '/edit');
  bind('#aDelete', async () => { if (!confirm('Hapus draft ini?')) return; try { await api.del('/api/journals/' + id); toast('Draft dihapus.', 'ok'); location.hash = '#/jurnal'; } catch (e) { toast(e.message, 'err'); } });
  bind('#aSubmit', async () => { try { await api.post('/api/journals/' + id + '/submit'); toast('Jurnal diajukan.', 'ok'); viewJurnalDetail(id); } catch (e) { toast(e.message, 'err'); } });
  bind('#aApprove', async () => {
    try { await api.post('/api/journals/' + id + '/approve'); toast('Jurnal disetujui & diposting.', 'ok'); viewJurnalDetail(id); }
    catch (e) {
      if (/pagu/i.test(e.message) && confirm(e.message + '\n\nTetap setujui dan lampaui pagu anggaran?')) {
        try { await api.post('/api/journals/' + id + '/approve', { force: true }); toast('Disetujui (melampaui pagu).', 'ok'); viewJurnalDetail(id); } catch (e2) { toast(e2.message, 'err'); }
      } else toast(e.message, 'err');
    }
  });
  bind('#aReject', async () => { const alasan = prompt('Alasan penolakan:'); if (alasan === null) return; try { await api.post('/api/journals/' + id + '/reject', { alasan }); toast('Jurnal ditolak.', 'ok'); viewJurnalDetail(id); } catch (e) { toast(e.message, 'err'); } });
  bind('#aReverse', async () => { if (!confirm('Buat jurnal balik (reversal) untuk jurnal terposting ini?')) return; try { const r = await api.post('/api/journals/' + id + '/reverse'); toast('Jurnal balik dibuat & diposting.', 'ok'); location.hash = '#/jurnal/' + r.id; } catch (e) { toast(e.message, 'err'); } });
  bind('#aVoucher', () => printVoucher(j));
}

function printVoucher(j) {
  const rows = j.lines.map(l => `<tr>
    <td><span class="k">${esc(l.akun_kode)}</span> ${esc(l.akun_nama)}</td>
    <td class="c">${esc(l.unit_kode)}</td>
    <td class="r">${l.debit ? fmtNum(l.debit) : ''}</td>
    <td class="r">${l.kredit ? fmtNum(l.kredit) : ''}</td></tr>`).join('');
  const approver = (j.history || []).find(h => h.action === 'approve' || h.action === 'post');
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Voucher ${esc(j.nomor || '')}</title>
    <style>
      *{box-sizing:border-box;} body{font-family:'Segoe UI',Arial,sans-serif;color:#1c1626;margin:0;padding:32px;font-size:12px;}
      .sheet{max-width:720px;margin:0 auto;}
      .head{text-align:center;border-bottom:2.5px solid #3F2A68;padding-bottom:12px;}
      .yys{font-size:10px;font-weight:800;letter-spacing:.18em;color:#6b647a;}
      .ttl{font-size:20px;font-weight:800;color:#2E1E4F;margin-top:4px;}
      .no{font-family:'Consolas',monospace;font-weight:700;color:#3F2A68;margin-top:3px;}
      .meta{display:flex;gap:24px;margin-top:16px;}
      .meta div .lab{font-size:9px;font-weight:800;letter-spacing:.08em;color:#8a8397;}
      .meta div .val{font-weight:700;margin-top:2px;}
      .desc{margin-top:12px;} .desc .lab{font-size:9px;font-weight:800;letter-spacing:.08em;color:#8a8397;}
      table{width:100%;border-collapse:collapse;margin-top:16px;}
      th{background:#f4f3f8;font-size:9px;letter-spacing:.06em;text-align:left;padding:8px 10px;border-bottom:1.5px solid #d9d5e4;}
      th.r,td.r{text-align:right;} th.c,td.c{text-align:center;}
      td{padding:7px 10px;border-bottom:1px solid #eeecf3;} td .k{font-family:'Consolas',monospace;color:#3F2A68;font-weight:700;}
      tfoot td{font-weight:800;border-top:1.5px solid #3F2A68;border-bottom:none;background:#faf9fc;}
      .sign{display:flex;justify-content:space-between;margin-top:48px;text-align:center;}
      .sign div{width:40%;} .sign .line{margin-top:56px;border-top:1px solid #1c1626;padding-top:5px;font-weight:700;}
      .foot{margin-top:32px;font-size:9px;color:#a49db2;text-align:center;}
      @media print{body{padding:0;}}
    </style></head><body onload="window.print()">
    <div class="sheet">
      <div class="head"><div class="yys">YAYASAN TAZKIA CENDIKIA</div>
        <div class="ttl">Bukti Jurnal Umum</div><div class="no">${esc(j.nomor || '')}</div></div>
      <div class="meta">
        <div><div class="lab">TANGGAL</div><div class="val">${fmtDate(j.tanggal)}</div></div>
        <div><div class="lab">UNIT</div><div class="val">${esc(j.unit_nama)}</div></div>
        <div><div class="lab">STATUS</div><div class="val">${(STATUS[j.status] || j.status)}</div></div>
      </div>
      <div class="desc"><div class="lab">DESKRIPSI</div><div class="val">${esc(j.deskripsi)}</div></div>
      <table><thead><tr><th>AKUN</th><th class="c">UNIT</th><th class="r">DEBIT (Rp)</th><th class="r">KREDIT (Rp)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>TOTAL</td><td></td><td class="r">${fmtNum(j.totalDebit)}</td><td class="r">${fmtNum(j.totalKredit)}</td></tr></tfoot></table>
      <div class="sign">
        <div><div>Dibuat oleh,</div><div class="line">${esc(j.created_by_nama || '(………………)')}</div></div>
        <div><div>Disetujui oleh,</div><div class="line">${esc(approver ? approver.user_nama : '(………………)')}</div></div>
      </div>
      <div class="foot">Dicetak dari SIKEU Tazkia · ${fmtDate(new Date().toISOString())}</div>
    </div></body></html>`;
  const w = window.open('', '_blank', 'width=820,height=920');
  if (!w) { toast('Popup diblokir. Izinkan popup untuk mencetak voucher.', 'err'); return; }
  w.document.write(html); w.document.close();
}
function actLabel(a) {
  return { create: 'Draft dibuat', update: 'Draft diubah', submit: 'Diajukan untuk persetujuan',
    approve: 'Disetujui', post: 'Diposting', reject: 'Ditolak', reverse: 'Dibalik (reversal)', delete: 'Dihapus' }[a] || a;
}

// ================= KAS & BANK =================
function bankAccountsForUnit() {
  return api.get('/api/kasbank/bank-accounts' + (state.unit === 'all' ? '' : '?unit=' + state.unit));
}

async function viewKasBank(tab) {
  const tabs = [['rekening', 'Rekening & saldo'], ['terima', 'Penerimaan kas'], ['keluar', 'Pengeluaran kas'], ['rekon', 'Rekonsiliasi bank']];
  if (perms.master) tabs.push(['kategori', 'Kategori']);
  const tabHtml = tabs.map(([k, l]) => `<div class="tab ${k === tab ? 'active' : ''}" onclick="location.hash='#/kasbank/${k}'">${l}</div>`).join('');
  $('#main').innerHTML = `<h1 class="page">Kas &amp; Bank</h1><div class="subtle">${esc(unitName())}</div>
    <div class="tabs">${tabHtml}</div><div id="kbOut"></div>`;
  if (tab === 'terima') return kbForm('receipt');
  if (tab === 'keluar') return kbForm('payment');
  if (tab === 'rekon') return kbRekon();
  if (tab === 'kategori' && perms.master) return kbKategori();
  return kbRekening();
}

async function kbRekening() {
  const accts = await bankAccountsForUnit();
  const trx = await api.get('/api/kasbank/transactions' + (state.unit === 'all' ? '' : '?unit=' + state.unit));
  const cards = accts.map(a => `
    <div class="card" style="padding:18px 20px;">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
        <div style="font-weight:700;">${esc(a.nama)}</div>
        <span class="badge draft">${esc(a.unit_kode)}</span></div>
      <div class="mono note" style="margin-top:4px;">${esc(a.bank || '')} · ${esc(a.no_rekening || '')}</div>
      <div class="mono" style="font-size:19px;font-weight:700;margin-top:12px;">${fmtRp(a.saldo)}</div>
      <div class="note" style="margin-top:4px;">Saldo berjalan · <span class="mono" style="color:var(--primary);">${esc(a.akun_kode)}</span></div>
    </div>`).join('') || '<div class="note">Belum ada rekening.</div>';
  const trxRows = trx.map(t => `<tr class="clickable" data-id="${t.id}">
    <td>${fmtDate(t.tanggal)}</td><td class="mono" style="color:var(--primary);">${esc(t.nomor || '')}</td>
    <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.deskripsi)}</td>
    <td>${t.sumber === 'penerimaan' ? '<span class="badge posted">masuk</span>' : '<span class="badge rejected">keluar</span>'}</td>
    <td>${statusBadge(t.status)}</td>
    <td>${esc(t.unit_kode)}</td><td class="r mono">${fmtRp(t.total)}</td></tr>`).join('')
    || '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px;">Belum ada transaksi kas.</td></tr>';
  $('#kbOut').innerHTML = `
    ${perms.master ? `<div style="margin:6px 0 12px;"><button class="btn primary sm" id="addBank">+ Tambah rekening</button></div>` : ''}
    <div class="stat-grid" style="margin-top:6px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));">${cards}</div>
    <div class="card tbl-wrap" style="margin-top:18px;">
      <div style="padding:14px 18px;border-bottom:1px solid var(--line);font-weight:800;">Transaksi kas terbaru</div>
      <table class="tbl" style="min-width:820px;"><thead><tr><th>TANGGAL</th><th>NO. JURNAL</th><th>DESKRIPSI</th><th>ARAH</th><th>STATUS</th><th>UNIT</th><th class="r">JUMLAH</th></tr></thead>
      <tbody>${trxRows}</tbody></table>
    </div>`;
  $('#kbOut').querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => location.hash = '#/jurnal/' + tr.dataset.id));
  const b = $('#addBank'); if (b) b.addEventListener('click', addBankModal);
}
function addBankModal() {
  const cashAcc = state.accounts.filter(a => a.is_postable && /^11(1|2)/.test(a.kode));
  const accOpt = cashAcc.map(a => `<option value="${a.id}">${esc(a.kode)} — ${esc(a.nama)}</option>`).join('');
  const unitOpt = state.units.map(u => `<option value="${u.id}">${esc(u.nama)}</option>`).join('');
  openModal('Tambah Rekening Kas/Bank', `
    <div class="field"><label>Nama rekening</label><input class="inp" id="bNama" placeholder="mis. Bank Mandiri — Operasional"></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:12px;">
      <div class="field"><label>Bank</label><input class="inp" id="bBank" placeholder="Bank Mandiri"></div>
      <div class="field"><label>No. rekening</label><input class="inp" id="bNo"></div>
      <div class="field"><label>Akun buku besar</label><select class="inp" id="bAcc">${accOpt}</select></div>
      <div class="field"><label>Unit</label><select class="inp" id="bUnit">${unitOpt}</select></div>
    </div>`, async () => {
    await api.post('/api/kasbank/bank-accounts', { nama: $('#bNama').value.trim(), bank: $('#bBank').value.trim(), no_rekening: $('#bNo').value.trim(), account_id: +$('#bAcc').value, unit_id: +$('#bUnit').value });
    toast('Rekening ditambahkan.', 'ok'); kbRekening();
  });
}

async function kbForm(kind) {
  if (!perms.cash) { $('#kbOut').innerHTML = '<div class="err-box">Peran Anda tidak berwenang mencatat transaksi kas.</div>'; return; }
  const isRcv = kind === 'receipt';
  const accts = await api.get('/api/kasbank/bank-accounts');
  const cats = await api.get('/api/kasbank/categories?jenis=' + (isRcv ? 'penerimaan' : 'pengeluaran'));
  if (!accts.length) { $('#kbOut').innerHTML = '<div class="warn-box">Belum ada rekening. Tambahkan di tab “Rekening & saldo”.</div>'; return; }
  if (!cats.length) { $('#kbOut').innerHTML = `<div class="warn-box">Belum ada kategori ${isRcv ? 'penerimaan' : 'pengeluaran'}. ${perms.master ? 'Tambahkan di tab “Kategori”.' : 'Minta admin menyiapkan kategori.'}</div>`; return; }
  const cats2 = cats.filter(c => c.aktif);
  const model = { bank_account_id: accts[0].id, category_id: cats2[0] ? cats2[0].id : '', amount: '', tanggal: new Date().toISOString().slice(0, 10), catatan: '' };

  const bankOpt = accts.map(a => `<option value="${a.id}">${esc(a.nama)} (${esc(a.unit_kode)})</option>`).join('');
  const catOpt = cats2.map(c => `<option value="${c.id}">${esc(c.nama)}</option>`).join('');
  $('#kbOut').innerHTML = `
    <div class="grid" style="grid-template-columns:1fr 340px;align-items:start;margin-top:6px;">
      <div class="card pad">
        <div style="font-size:15px;font-weight:800;">${isRcv ? 'Catat penerimaan kas' : 'Catat pengeluaran kas'}</div>
        <div class="note" style="margin-top:3px;">Cukup pilih kategori — sistem membentuk jurnalnya. Kasir tidak perlu memahami debit/kredit.</div>
        <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:16px;">
          <div class="field"><label>${isRcv ? 'Masuk ke rekening' : 'Dibayar dari rekening'}</label><select class="inp" id="kBank">${bankOpt}</select></div>
          <div class="field"><label>${isRcv ? 'Kategori penerimaan' : 'Kategori pengeluaran'} <span class="req">*</span></label><select class="inp" id="kCat">${catOpt}</select></div>
          <div class="field"><label>Tanggal</label><input class="inp" type="date" id="kDate" value="${model.tanggal}"></div>
          <div class="field"><label>Jumlah (Rp) <span class="req">*</span></label><input class="inp mono r" id="kAmt" placeholder="0"></div>
        </div>
        <div class="field" style="margin-top:12px;"><label>Catatan (opsional)</label><input class="inp" id="kNote" placeholder="${isRcv ? 'Contoh: setoran tunai loket pagi' : 'Contoh: tagihan PLN Juli'}"></div>
        <button class="btn ${isRcv ? 'green' : 'danger'}" id="kSave" style="margin-top:16px;${isRcv ? '' : 'border:none;background:var(--red);color:#fff;'}">${isRcv ? 'Ajukan penerimaan' : 'Ajukan pengeluaran'}</button>
      </div>
      <div class="card pad" style="background:var(--primary-bg);border-color:var(--line2);">
        <div style="font-size:12px;font-weight:800;color:var(--primary);letter-spacing:.04em;">JURNAL OTOMATIS</div>
        <div class="note" style="margin-top:8px;">Sistem membentuk jurnal ini berstatus <b>menunggu persetujuan bendahara</b>:</div>
        <div class="card mono" id="kPreview" style="padding:12px 14px;margin-top:10px;font-size:12px;line-height:1.9;box-shadow:none;"></div>
        <div class="warn-box" style="margin-top:10px;">Jurnal belum memengaruhi saldo sampai <b>disetujui bendahara</b> di menu Jurnal Umum.</div>
      </div>
    </div>`;

  const accById = (id) => accts.find(a => a.id == id) || {};
  const catById = (id) => cats2.find(c => c.id == id) || {};
  function preview() {
    const ba = accById(model.bank_account_id), cp = catById(model.category_id);
    const amt = fmtRp(toSen(model.amount));
    const bankStr = `${esc(ba.akun_kode || '')} — ${esc(ba.nama || '')}`;
    const catStr = `${esc(cp.akun_kode || '')} — ${esc(cp.akun_nama || '')} <span class="note">(${esc(cp.nama || '')})</span>`;
    const D = isRcv ? bankStr : catStr, K = isRcv ? catStr : bankStr;
    $('#kPreview').innerHTML = `(D) ${D} <span style="float:right;">${amt}</span><br>(K) &nbsp;&nbsp;${K} <span style="float:right;">${amt}</span>`;
  }
  $('#kBank').addEventListener('change', e => { model.bank_account_id = +e.target.value; preview(); });
  $('#kCat').addEventListener('change', e => { model.category_id = +e.target.value; preview(); });
  $('#kDate').addEventListener('change', e => model.tanggal = e.target.value);
  $('#kAmt').addEventListener('input', e => { model.amount = e.target.value; preview(); });
  $('#kNote').addEventListener('input', e => model.catatan = e.target.value);
  preview();

  $('#kSave').addEventListener('click', async () => {
    if (toSen(model.amount) <= 0) { toast('Jumlah harus lebih dari nol.', 'err'); return; }
    try {
      const j = await api.post('/api/kasbank/' + (isRcv ? 'receipt' : 'payment'), {
        bank_account_id: model.bank_account_id, category_id: model.category_id,
        amount: model.amount, tanggal: model.tanggal, catatan: model.catatan,
      });
      toast('Diajukan (menunggu persetujuan bendahara): ' + j.nomor, 'ok');
      location.hash = '#/jurnal/' + j.id;
    } catch (e) { toast(e.message, 'err'); }
  });
}

// Kelola mapping kategori kas → akun (admin/staf)
async function kbKategori() {
  const cats = await api.get('/api/kasbank/categories');
  const postable = state.accounts.filter(a => a.is_postable);
  const group = (jenis) => cats.filter(c => c.jenis === jenis).map(c => `<tr>
    <td>${esc(c.nama)}</td>
    <td><span class="mono" style="color:var(--primary);">${esc(c.akun_kode)}</span> ${esc(c.akun_nama)}</td>
    <td>${c.aktif ? '<span class="badge open">aktif</span>' : '<span class="badge closed">nonaktif</span>'}</td>
    <td class="r"><button class="btn sm danger" data-delcat="${c.id}">Hapus</button></td></tr>`).join('')
    || '<tr><td colspan="4" class="note" style="padding:14px;">Belum ada kategori.</td></tr>';
  $('#kbOut').innerHTML = `
    <div class="note" style="margin:14px 0;">Kasir memilih <b>kategori</b> ini saat mencatat kas; sistem memetakannya ke akun buku besar. Kelola di sini.</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;">
      <div class="card tbl-wrap">
        <div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;"><b>Kategori Penerimaan</b><button class="btn sm primary" data-addcat="penerimaan">+ Tambah</button></div>
        <table class="tbl"><thead><tr><th>KATEGORI</th><th>AKUN</th><th>STATUS</th><th></th></tr></thead><tbody>${group('penerimaan')}</tbody></table>
      </div>
      <div class="card tbl-wrap">
        <div style="padding:12px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;"><b>Kategori Pengeluaran</b><button class="btn sm primary" data-addcat="pengeluaran">+ Tambah</button></div>
        <table class="tbl"><thead><tr><th>KATEGORI</th><th>AKUN</th><th>STATUS</th><th></th></tr></thead><tbody>${group('pengeluaran')}</tbody></table>
      </div>
    </div>`;
  $('#kbOut').querySelectorAll('[data-delcat]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Hapus kategori ini?')) return;
    try { await api.del('/api/kasbank/categories/' + b.dataset.delcat); toast('Kategori dihapus.', 'ok'); kbKategori(); } catch (e) { toast(e.message, 'err'); }
  }));
  $('#kbOut').querySelectorAll('[data-addcat]').forEach(b => b.addEventListener('click', () => {
    const jenis = b.dataset.addcat;
    const relevant = postable.filter(a => jenis === 'penerimaan' ? (a.tipe === 'pendapatan' || a.tipe === 'aset' || a.tipe === 'liabilitas') : (a.tipe === 'beban' || a.tipe === 'aset' || a.tipe === 'liabilitas'));
    const accOpt = relevant.map(a => `<option value="${a.id}">${esc(a.kode)} — ${esc(a.nama)}</option>`).join('');
    openModal('Tambah Kategori ' + jenis, `
      <div class="field"><label>Nama kategori</label><input class="inp" id="ncNama" placeholder="${jenis === 'penerimaan' ? 'mis. Pembayaran UKT mahasiswa' : 'mis. Beban listrik'}"></div>
      <div class="field" style="margin-top:12px;"><label>Petakan ke akun</label><select class="inp" id="ncAcc">${accOpt}</select></div>`,
      async () => { await api.post('/api/kasbank/categories', { jenis, nama: $('#ncNama').value.trim(), account_id: +$('#ncAcc').value }); toast('Kategori ditambahkan.', 'ok'); kbKategori(); });
  }));
}

async function kbRekon() {
  const accts = await api.get('/api/kasbank/bank-accounts');
  const banks = accts.filter(a => a.bank && a.bank !== 'Tunai');
  if (!banks.length) { $('#kbOut').innerHTML = '<div class="warn-box">Belum ada rekening bank untuk direkonsiliasi.</div>'; return; }
  let current = banks[0].id;
  const bankOpt = banks.map(a => `<option value="${a.id}">${esc(a.nama)} (${esc(a.unit_kode)})</option>`).join('');
  $('#kbOut').innerHTML = `
    <div class="card pad" style="margin-top:6px;">
      <div class="grid" style="grid-template-columns:1fr auto auto auto;align-items:end;">
        <div class="field"><label>Rekening bank</label><select class="inp" id="rBank">${bankOpt}</select></div>
        ${perms.recon ? `<button class="btn outline" id="rImport">Import CSV mutasi</button>
        <button class="btn" id="rAuto">Cocokkan otomatis</button>
        <button class="btn danger" id="rClear">Hapus mutasi</button>` : ''}
      </div>
      <div class="note" style="margin-top:10px;">Kolom CSV <b>fleksibel</b> — Anda memetakan kolom saat impor. <b>debit</b>=uang masuk, <b>kredit</b>=uang keluar. Auto-match: nominal sama &amp; tanggal ±3 hari. <a href="/contoh-mutasi.csv" download>Unduh contoh</a></div>
      <input type="file" id="rFile" accept=".csv,text/csv" class="hidden">
    </div>
    <div id="rekonOut" style="margin-top:16px;"></div>`;
  $('#rBank').addEventListener('change', e => { current = +e.target.value; loadRekon(); });
  const imp = $('#rImport'); if (imp) {
    imp.addEventListener('click', () => $('#rFile').click());
    $('#rFile').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const text = await file.text();
      e.target.value = '';
      try {
        const hdr = await api.post('/api/kasbank/reconcile/parse-headers', { csv: text });
        openMappingModal(text, hdr);
      } catch (err) { toast(err.message, 'err'); }
    });
  }
  // Modal pemetaan kolom → impor
  function openMappingModal(text, hdr) {
    const guess = (names) => hdr.columns.find(c => names.some(n => c.toLowerCase().includes(n))) || '';
    const opt = (sel, allowEmpty) => (allowEmpty ? '<option value="">— tidak ada —</option>' : '') +
      hdr.columns.map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const sampleTbl = hdr.sample.length ? `<div class="tbl-wrap" style="margin-top:10px;"><table class="tbl" style="min-width:0;"><thead><tr>${hdr.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${hdr.sample.map(r => `<tr>${r.map(v => `<td class="note">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
    openModal('Pemetaan kolom CSV', `
      <div class="note">Delimiter terdeteksi: <b class="mono">${esc(hdr.delimiter)}</b>. Petakan kolom berkas ke field sistem:</div>
      <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:12px;">
        <div class="field"><label>Tanggal <span class="req">*</span></label><select class="inp" id="mpTgl">${opt(guess(['tanggal', 'tgl', 'date']))}</select></div>
        <div class="field"><label>Keterangan</label><select class="inp" id="mpKet">${opt(guess(['keterangan', 'uraian', 'desc', 'berita']), true)}</select></div>
        <div class="field"><label>Debit / Uang masuk <span class="req">*</span></label><select class="inp" id="mpDeb">${opt(guess(['debit', 'masuk', 'kredit ']), true)}</select></div>
        <div class="field"><label>Kredit / Uang keluar</label><select class="inp" id="mpKre">${opt(guess(['kredit', 'keluar', 'debet ']), true)}</select></div>
      </div>${sampleTbl}
      <div class="note" style="margin-top:10px;">Baris berikutnya akan menimpa mutasi rekening ini.</div>`,
      async () => {
        const mapping = { tanggal: $('#mpTgl').value, keterangan: $('#mpKet').value, debit: $('#mpDeb').value, kredit: $('#mpKre').value };
        const r = await api.post('/api/kasbank/reconcile/import', { bank_account_id: current, csv: text, replace: true, mapping });
        toast(`Impor ${r.imported} baris, ${r.matched} cocok otomatis (±3 hari).`, 'ok'); loadRekon();
      });
  }
  const auto = $('#rAuto'); if (auto) auto.addEventListener('click', async () => { const r = await api.post('/api/kasbank/reconcile/' + current + '/automatch'); toast(r.matched + ' baris tercocokkan.', 'ok'); loadRekon(); });
  const clr = $('#rClear'); if (clr) clr.addEventListener('click', async () => { if (!confirm('Hapus semua mutasi bank terimpor untuk rekening ini?')) return; await api.del('/api/kasbank/reconcile/' + current); toast('Mutasi dihapus.', 'ok'); loadRekon(); });

  async function loadRekon() {
    const d = await api.get('/api/kasbank/reconcile/' + current);
    const chip = (matched) => `<span style="width:18px;height:18px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;${matched ? 'background:var(--green);color:#fff;' : 'background:var(--gold-bg);color:var(--gold-ink);border:1px solid var(--gold);'}">${matched ? '✓' : '!'}</span>`;
    const bankRows = d.statements.map(s => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #F0EEF4;${s.matched ? '' : 'background:#FEFBF2;'}">
        ${chip(s.matched)}
        <span class="mono note" style="width:64px;flex-shrink:0;">${s.tanggal.slice(5)}</span>
        <span style="font-size:12px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.keterangan)}</span>
        <span class="mono" style="font-size:11.5px;font-weight:700;${s.kredit ? 'color:var(--red);' : ''}">${s.debit ? fmtNum(s.debit) : '-' + fmtNum(s.kredit)}</span>
      </div>`).join('') || '<div class="note" style="padding:14px;">Belum ada mutasi. Klik “Import CSV mutasi”.</div>';
    const bookRows = d.book.map(l => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #F0EEF4;${l.matched ? '' : 'background:#FEFBF2;'}">
        ${chip(l.matched)}
        <span class="mono note" style="width:64px;flex-shrink:0;">${l.tanggal.slice(5)}</span>
        <span style="font-size:12px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(l.nomor || '')} · ${esc(l.deskripsi)}</span>
        <span class="mono" style="font-size:11.5px;font-weight:700;${l.kredit ? 'color:var(--red);' : ''}">${l.debit ? fmtNum(l.debit) : '-' + fmtNum(l.kredit)}</span>
      </div>`).join('') || '<div class="note" style="padding:14px;">Belum ada catatan buku pada rekening ini.</div>';

    $('#rekonOut').innerHTML = `
      <div class="card pad">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <div><div style="font-size:15px;font-weight:800;">Rekonsiliasi — ${esc(d.bank_account.nama)}</div>
            <div class="note" style="margin-top:3px;">Saldo buku <b class="mono" style="color:var(--ink);">${fmtRp(d.saldoBuku)}</b> · Mutasi belum cocok: bank ${d.unmatchedBankCount}, buku ${d.unmatchedBukuCount}</div></div>
          <div>${d.reconciled ? '<span class="badge posted" style="font-size:12px;padding:6px 12px;">Terekonsiliasi ✓</span>' : `<span class="badge pending" style="font-size:12px;padding:6px 12px;">Selisih ${fmtRp(d.selisih)}</span>`}</div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:16px;">
          <div class="card" style="box-shadow:none;">
            <div style="padding:10px 14px;background:var(--soft);border-bottom:1px solid var(--line);font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--primary);">MUTASI BANK (IMPORT CSV)</div>${bankRows}</div>
          <div class="card" style="box-shadow:none;">
            <div style="padding:10px 14px;background:var(--soft);border-bottom:1px solid var(--line);font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--primary);">CATATAN SISTEM (BUKU BANK)</div>${bookRows}</div>
        </div>
        <div class="note" style="display:flex;gap:16px;margin-top:12px;">
          <span style="display:inline-flex;align-items:center;gap:6px;">${chip(true)} Cocok</span>
          <span style="display:inline-flex;align-items:center;gap:6px;">${chip(false)} Belum cocok — perlu pencocokan manual atau jurnal penyesuaian</span>
        </div>
      </div>`;
  }
  loadRekon();
}

// ================= PIUTANG UKT =================
function daysTo(iso) { if (!iso) return null; const a = Date.parse(iso + 'T00:00:00Z'), b = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'); return Math.round((b - a) / 86400000); }
function umurChip(days) {
  if (days == null) return '<span class="badge draft">—</span>';
  if (days <= 0) return '<span class="badge posted">belum JT</span>';
  if (days <= 30) return `<span class="badge pending">${days} hr</span>`;
  if (days <= 90) return `<span class="badge rejected">${days} hr</span>`;
  return `<span class="badge rejected">${days} hr</span>`;
}

async function viewPiutang(tab) {
  const tabs = [['daftar', 'Daftar tagihan'], ['mahasiswa', 'Mahasiswa'], ['generate', 'Generate tagihan massal'], ['ckpn', 'Aging & CKPN'], ['amortisasi', 'Pengakuan pendapatan']];
  const tabHtml = tabs.map(([k, l]) => `<div class="tab ${k === tab ? 'active' : ''}" onclick="location.hash='#/piutang/${k}'">${l}</div>`).join('');
  $('#main').innerHTML = `<h1 class="page">Piutang Mahasiswa (UKT)</h1><div class="subtle">${esc(unitName())}</div>
    <div class="tabs">${tabHtml}</div><div id="piOut"></div>`;
  if (tab === 'mahasiswa') return piMahasiswa();
  if (tab === 'generate') return piGenerate();
  if (tab === 'ckpn') return piCkpn();
  if (tab === 'amortisasi') return piAmortisasi();
  return piDaftar();
}

async function piDaftar(status) {
  const q = new URLSearchParams(); if (state.unit !== 'all') q.set('unit', state.unit); if (status) q.set('status', status);
  const invs = await api.get('/api/piutang/invoices?' + q.toString());
  const chips = [['', 'Semua'], ['terbit', 'Belum dibayar'], ['sebagian', 'Sebagian'], ['lunas', 'Lunas']]
    .map(([k, l]) => `<button class="tab ${(status || '') === k ? 'active' : ''}" data-st="${k}">${l}</button>`).join('');
  let tTag = 0, tBayar = 0, tSisa = 0;
  const rows = invs.map(i => {
    tTag += i.nominal; tBayar += i.paid; tSisa += i.sisa;
    const d = daysTo(i.jatuh_tempo);
    return `<tr>
      <td class="mono" style="color:var(--primary);font-weight:700;">${esc(i.nim)}</td>
      <td style="font-weight:700;">${esc(i.mhs_nama)}</td>
      <td class="note">${esc(i.prodi || '')}</td>
      <td>${esc(i.unit_kode)}</td>
      <td class="r mono">${fmtNum(i.nominal)}</td>
      <td class="r mono" style="color:var(--green);">${fmtNum(i.paid)}</td>
      <td class="r mono" style="font-weight:700;${i.sisa > 0 ? '' : 'color:var(--green);'}">${fmtNum(i.sisa)}</td>
      <td>${statusInvBadge(i.status)}</td>
      <td>${i.sisa > 0 ? umurChip(d) : '<span class="badge posted">lunas</span>'}</td>
      <td class="r" style="white-space:nowrap;">${(perms.pay && i.sisa > 0) ? `<button class="btn sm outline" data-pay="${i.id}">Catat bayar</button>` : ''}${(perms.billing && i.sisa > 0) ? ` <button class="btn sm gold" data-relief="${i.id}">Keringanan</button>` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:24px;">Belum ada tagihan.</td></tr>';
  $('#piOut').innerHTML = `
    <div class="tabs" style="margin:14px 0 6px;">${chips}</div>
    <div class="card tbl-wrap">
      <table class="tbl" style="min-width:1000px;"><thead><tr>
        <th>NIM</th><th>NAMA</th><th>PRODI</th><th>UNIT</th><th class="r">TAGIHAN</th><th class="r">TERBAYAR</th><th class="r">SISA</th><th>STATUS</th><th>UMUR</th><th></th>
      </tr></thead><tbody>${rows}</tbody>
      <tfoot><tr class="tfoot"><td colspan="4">TOTAL</td><td class="r mono">${fmtNum(tTag)}</td><td class="r mono" style="color:var(--green);">${fmtNum(tBayar)}</td><td class="r mono">${fmtNum(tSisa)}</td><td colspan="3"></td></tr></tfoot>
      </table>
    </div>`;
  $('#piOut').querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => piDaftar(b.dataset.st || undefined)));
  $('#piOut').querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => payModal(+b.dataset.pay)));
  $('#piOut').querySelectorAll('[data-relief]').forEach(b => b.addEventListener('click', () => reliefModal(+b.dataset.relief)));
}
function statusInvBadge(s) {
  const m = { terbit: ['pending', 'Belum dibayar'], sebagian: ['pending', 'Sebagian'], lunas: ['posted', 'Lunas'], void: ['draft', 'Batal'] };
  const x = m[s] || ['draft', s]; return `<span class="badge ${x[0]}">${x[1]}</span>`;
}

async function payModal(invoiceId) {
  const inv = await api.get('/api/piutang/invoices/' + invoiceId);
  const banks = await api.get('/api/kasbank/bank-accounts');
  const bankOpt = banks.map(b => `<option value="${b.id}">${esc(b.nama)} (${esc(b.unit_kode)})</option>`).join('');
  const payHist = inv.payments.map(p => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F0EEF4;">
    <div><div style="font-weight:700;font-size:12.5px;">${fmtDate(p.tanggal)}</div><div class="note">${esc(p.metode || '')} · ${esc(p.jurnal_nomor || '')}</div></div>
    <div class="mono" style="color:var(--green);font-weight:700;">${fmtRp(p.nominal)}</div></div>`).join('') || '<div class="note">Belum ada pembayaran.</div>';
  openModal(`Catat pembayaran — ${inv.mhs_nama}`, `
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;">
      <div class="stat" style="padding:12px 14px;"><div class="label">TAGIHAN</div><div class="value" style="font-size:15px;">${fmtRp(inv.nominal)}</div></div>
      <div class="stat" style="padding:12px 14px;"><div class="label">TERBAYAR</div><div class="value" style="font-size:15px;color:var(--green);">${fmtRp(inv.paid)}</div></div>
      <div class="stat" style="padding:12px 14px;background:var(--gold-bg);"><div class="label" style="color:var(--gold-ink);">SISA</div><div class="value" style="font-size:15px;">${fmtRp(inv.sisa)}</div></div>
    </div>
    <div class="note" style="margin-top:8px;"><span class="mono" style="color:var(--primary);">${esc(inv.nomor)}</span> · ${esc(inv.semester)} · ${esc(inv.nim)}</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:12px;">
      <div class="field"><label>Jumlah (Rp) — boleh cicilan</label><input class="inp mono r" id="pyAmt" placeholder="0"></div>
      <div class="field"><label>Rekening penerima</label><select class="inp" id="pyBank">${bankOpt}</select></div>
      <div class="field"><label>Tanggal</label><input class="inp" type="date" id="pyDate" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field"><label>Metode</label><select class="inp" id="pyMet"><option>transfer</option><option>tunai</option><option>QRIS</option><option>virtual account</option></select></div>
    </div>
    <div class="note" style="margin-top:10px;">Sistem otomatis memposting jurnal (D) Rekening — (K) Piutang UKT.</div>
    <div style="margin-top:12px;font-weight:800;font-size:13px;">Riwayat pembayaran</div>${payHist}`,
    async () => {
      const nominal = $('#pyAmt').value;
      if (toSen(nominal) <= 0) throw new Error('Jumlah harus lebih dari nol.');
      await api.post('/api/piutang/payments', { invoice_id: invoiceId, tanggal: $('#pyDate').value, nominal, metode: $('#pyMet').value, bank_account_id: +$('#pyBank').value });
      toast('Pembayaran tercatat & diposting.', 'ok'); piDaftar();
    });
}

async function reliefModal(invoiceId) {
  const inv = await api.get('/api/piutang/invoices/' + invoiceId);
  const relHist = (inv.reliefs || []).map(r => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F0EEF4;">
    <div><div style="font-weight:700;font-size:12.5px;">${fmtDate(r.tanggal)} · ${r.jenis === 'potongan' ? 'Potongan' : 'Beasiswa'}</div>
      <div class="note"><span class="mono">${esc(r.akun_kode)}</span> ${esc(r.akun_nama)}${r.keterangan ? ' · ' + esc(r.keterangan) : ''}</div></div>
    <div class="mono" style="color:var(--gold-ink);font-weight:700;">${fmtRp(r.nominal)}</div></div>`).join('') || '<div class="note">Belum ada keringanan.</div>';
  openModal(`Keringanan UKT — ${inv.mhs_nama}`, `
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;">
      <div class="stat" style="padding:12px 14px;"><div class="label">TAGIHAN</div><div class="value" style="font-size:15px;">${fmtRp(inv.nominal)}</div></div>
      <div class="stat" style="padding:12px 14px;"><div class="label">KERINGANAN</div><div class="value" style="font-size:15px;color:var(--gold-ink);">${fmtRp(inv.relief)}</div></div>
      <div class="stat" style="padding:12px 14px;background:var(--gold-bg);"><div class="label" style="color:var(--gold-ink);">SISA</div><div class="value" style="font-size:15px;">${fmtRp(inv.sisa)}</div></div>
    </div>
    <div class="note" style="margin-top:8px;"><span class="mono" style="color:var(--primary);">${esc(inv.nomor)}</span> · ${esc(inv.semester)} · ${esc(inv.nim)}</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:12px;">
      <div class="field"><label>Jenis</label><select class="inp" id="rlJenis">
        <option value="potongan">Potongan / diskon</option>
        <option value="beasiswa">Beasiswa</option></select></div>
      <div class="field"><label>Jumlah (Rp) — boleh sebagian</label><input class="inp mono r" id="rlAmt" placeholder="0"></div>
      <div class="field"><label>Tanggal</label><input class="inp" type="date" id="rlDate" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field"><label>Keterangan</label><input class="inp" id="rlKet" placeholder="mis. beasiswa prestasi / keringanan yatim"></div>
    </div>
    <div class="note" style="margin-top:10px;"><b>Potongan</b> → (D) Potongan UKT 4150 / (K) Piutang — mengurangi pendapatan neto.
      <b>Beasiswa</b> → (D) Beban Beasiswa 5350 / (K) Piutang — pendapatan tetap bruto.</div>
    <div style="margin-top:12px;font-weight:800;font-size:13px;">Riwayat keringanan</div>${relHist}`,
    async () => {
      const nominal = $('#rlAmt').value;
      if (toSen(nominal) <= 0) throw new Error('Jumlah harus lebih dari nol.');
      await api.post('/api/piutang/reliefs', { invoice_id: invoiceId, jenis: $('#rlJenis').value, nominal, tanggal: $('#rlDate').value, keterangan: $('#rlKet').value.trim() });
      toast('Keringanan dicatat & diposting.', 'ok'); piDaftar();
    });
}

async function piMahasiswa() {
  const q = new URLSearchParams(); if (state.unit !== 'all') q.set('unit', state.unit);
  const load = async (search) => {
    const qq = new URLSearchParams(q); if (search) qq.set('q', search);
    const rows = (await api.get('/api/piutang/students?' + qq.toString())).map(s => `<tr>
      <td class="mono" style="color:var(--primary);font-weight:700;">${esc(s.nim)}</td>
      <td style="font-weight:700;">${esc(s.nama)}</td><td class="note">${esc(s.prodi || '')}</td>
      <td>${esc(s.unit_kode)}</td><td>${esc(s.angkatan || '')}</td>
      <td>${s.status === 'aktif' ? '<span class="badge open">aktif</span>' : '<span class="badge closed">' + esc(s.status) + '</span>'}</td></tr>`).join('')
      || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">Belum ada mahasiswa.</td></tr>';
    $('#stuBody').innerHTML = rows;
  };
  $('#piOut').innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;margin:14px 0;flex-wrap:wrap;">
      <input class="inp" id="stuSearch" placeholder="Cari NIM atau nama…" style="max-width:280px;">
      ${perms.studentMaster ? `<button class="btn outline sm" id="impStu" style="margin-left:auto;">Impor CSV</button>
      <button class="btn primary sm" id="addStu">+ Tambah mahasiswa</button>` : ''}
    </div>
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>NIM</th><th>NAMA</th><th>PRODI</th><th>UNIT</th><th>ANGKATAN</th><th>STATUS</th></tr></thead><tbody id="stuBody"></tbody></table></div>`;
  $('#stuSearch').addEventListener('input', e => load(e.target.value.trim()));
  const b = $('#addStu'); if (b) b.addEventListener('click', () => {
    const unitOpt = state.units.filter(u => !u.is_yayasan).map(u => `<option value="${u.id}">${esc(u.nama)}</option>`).join('');
    openModal('Tambah Mahasiswa', `
      <div class="grid" style="grid-template-columns:1fr 1fr;">
        <div class="field"><label>NIM</label><input class="inp" id="msNim"></div>
        <div class="field"><label>Nama</label><input class="inp" id="msNama"></div>
        <div class="field"><label>Program studi</label><input class="inp" id="msProdi"></div>
        <div class="field"><label>Unit</label><select class="inp" id="msUnit">${unitOpt}</select></div>
        <div class="field"><label>Angkatan</label><input class="inp" type="number" id="msAng" value="2025"></div>
      </div>`, async () => {
      await api.post('/api/piutang/students', { nim: $('#msNim').value.trim(), nama: $('#msNama').value.trim(), prodi: $('#msProdi').value.trim(), unit_id: +$('#msUnit').value, angkatan: +$('#msAng').value });
      toast('Mahasiswa ditambahkan.', 'ok'); piMahasiswa();
    });
  });
  const imp = $('#impStu'); if (imp) imp.addEventListener('click', openImportStudents);
  load();
}

// Parser CSV sederhana (delimiter , atau ; ; baris pertama = header)
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (!lines.length) return { headers: [], rows: [] };
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = (line) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); return out.map(s => s.trim());
  };
  const headers = split(lines[0]).map(h => h.toLowerCase());
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

function openImportStudents() {
  let parsed = [];
  openModal('Impor Mahasiswa dari CSV', `
    <div class="note" style="margin-bottom:10px;">Format kolom (baris pertama = judul): <b>nim, nama, prodi, unit, angkatan</b>.
      Kolom <b>unit</b> memakai kode <span class="mono">YYS</span>/<span class="mono">STM</span>/<span class="mono">UNV</span>.</div>
    <div style="margin-bottom:10px;"><a href="#" id="dlTemplate" style="color:var(--primary);font-weight:700;font-size:12.5px;">↓ Unduh templat CSV</a></div>
    <div class="field"><label>Berkas CSV</label><input class="inp" type="file" id="impFile" accept=".csv,text/csv"></div>
    <div id="impPrev" style="margin-top:12px;"></div>`,
    async () => {
      if (!parsed.length) throw new Error('Pilih berkas CSV yang valid dahulu.');
      const r = await api.post('/api/piutang/students/import', { students: parsed });
      let msg = `${r.inserted} mahasiswa diimpor`;
      if (r.skipped) msg += `, ${r.skipped} dilewati`;
      toast(msg + '.', r.skipped ? '' : 'ok');
      piMahasiswa();
    });
  $('#dlTemplate').addEventListener('click', (e) => {
    e.preventDefault();
    const tpl = 'nim,nama,prodi,unit,angkatan\n2301010,Nama Mahasiswa,Teknik Informatika,STM,2023\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([tpl], { type: 'text/csv' }));
    a.download = 'templat-mahasiswa.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#impFile').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { headers, rows } = parseCsv(String(reader.result));
      const idx = (names) => headers.findIndex(hh => names.includes(hh));
      const iNim = idx(['nim']), iNama = idx(['nama', 'name']), iProdi = idx(['prodi', 'program studi', 'jurusan']),
        iUnit = idx(['unit', 'kode unit', 'kampus']), iAng = idx(['angkatan', 'tahun']);
      if (iNim < 0 || iNama < 0 || iUnit < 0) {
        parsed = []; $('#impPrev').innerHTML = `<div class="err-box">Kolom wajib tidak lengkap. Butuh minimal: nim, nama, unit.</div>`; return;
      }
      parsed = rows.map(c => ({ nim: c[iNim], nama: c[iNama], prodi: iProdi >= 0 ? c[iProdi] : '', unit: c[iUnit], angkatan: iAng >= 0 ? c[iAng] : '' }))
        .filter(r => (r.nim || r.nama));
      const head = '<tr><th>NIM</th><th>NAMA</th><th>PRODI</th><th>UNIT</th><th>ANGK.</th></tr>';
      const body = parsed.slice(0, 8).map(r => `<tr><td class="mono">${esc(r.nim)}</td><td>${esc(r.nama)}</td><td class="note">${esc(r.prodi)}</td><td>${esc(r.unit)}</td><td>${esc(r.angkatan)}</td></tr>`).join('');
      $('#impPrev').innerHTML = `<div class="ok-box" style="margin-bottom:8px;">${parsed.length} baris terbaca. Pratinjau ${Math.min(8, parsed.length)} baris pertama:</div>
        <div class="card tbl-wrap" style="box-shadow:none;"><table class="tbl">${head}${body}</table></div>`;
    };
    reader.readAsText(f);
  });
}

async function piGenerate() {
  if (!perms.billing) { $('#piOut').innerHTML = '<div class="err-box" style="margin-top:14px;">Peran Anda tidak berwenang menerbitkan tagihan.</div>'; return; }
  const students = await api.get('/api/piutang/students');
  const unitOpt = state.units.filter(u => !u.is_yayasan).map(u => `<option value="${u.id}">${esc(u.nama)}</option>`).join('');
  const model = { unit_id: state.units.find(u => !u.is_yayasan).id, semester: '2026 Ganjil', nominal: '9.000.000', tanggal: new Date().toISOString().slice(0, 10), jatuh_tempo: '', tenor_bulan: 6, mulai_amortisasi: '', prodi: '', angkatan: '' };
  $('#piOut').innerHTML = `
    <div class="grid" style="grid-template-columns:1fr 340px;align-items:start;margin-top:14px;">
      <div class="card pad">
        <div style="font-size:15px;font-weight:800;">Generate tagihan UKT massal</div>
        <div class="note" style="margin-top:3px;">Menerbitkan tagihan untuk seluruh mahasiswa aktif pada unit terpilih yang belum ditagih semester ini.</div>
        <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:16px;">
          <div class="field"><label>Unit kampus</label><select class="inp" id="gUnit">${unitOpt}</select></div>
          <div class="field"><label>Semester</label><input class="inp" id="gSem" value="${model.semester}"></div>
          <div class="field"><label>Prodi (opsional)</label><input class="inp" id="gProdi" placeholder="semua prodi"></div>
          <div class="field"><label>Angkatan (opsional)</label><input class="inp" id="gAng" placeholder="semua angkatan"></div>
          <div class="field"><label>Nominal UKT / mahasiswa (Rp)</label><input class="inp mono r" id="gAmt" value="${model.nominal}"></div>
          <div class="field"><label>Tanggal terbit</label><input class="inp" type="date" id="gTgl" value="${model.tanggal}"></div>
          <div class="field"><label>Jatuh tempo</label><input class="inp" type="date" id="gJt"></div>
          <div class="field"><label>Tenor amortisasi (bulan)</label><input class="inp" type="number" id="gTenor" value="6"></div>
          <div class="field"><label>Mulai amortisasi</label><input class="inp" type="date" id="gMulai" placeholder="default: bulan terbit"></div>
        </div>
        <button class="btn primary" id="gGo" style="margin-top:18px;">Generate tagihan</button>
      </div>
      <div class="card pad" style="background:var(--primary-bg);border-color:var(--line2);">
        <div style="font-size:12px;font-weight:800;color:var(--primary);letter-spacing:.04em;">PRATINJAU</div>
        <div id="gPrev" style="margin-top:12px;"></div>
        <div class="note" style="margin-top:12px;line-height:1.6;">PSAK 72: jurnal (D) Piutang UKT — (K) Pendapatan Diterima di Muka diposting per unit saat tagihan terbit; pendapatan diakui bertahap via amortisasi bulanan.</div>
      </div>
    </div>`;
  function preview() {
    const unitId = +$('#gUnit').value, prodi = $('#gProdi').value.trim(), ang = $('#gAng').value.trim();
    const cnt = students.filter(s => s.unit_id === unitId && s.status === 'aktif' && (!prodi || s.prodi === prodi) && (!ang || String(s.angkatan) === ang)).length;
    const total = toSen($('#gAmt').value) * cnt;
    $('#gPrev').innerHTML = `<div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;color:var(--muted2);"><span>Mahasiswa aktif</span><b style="color:var(--ink);">${cnt}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;color:var(--muted2);margin-top:8px;"><span>Total tagihan</span><b class="mono" style="color:var(--ink);">${fmtRp(total)}</b></div>
      <div class="note" style="margin-top:6px;">(mahasiswa yang sudah ditagih semester ini akan dilewati)</div>`;
  }
  ['gUnit', 'gProdi', 'gAng', 'gAmt'].forEach(id => $('#' + id).addEventListener('input', preview));
  preview();
  $('#gGo').addEventListener('click', async () => {
    try {
      const r = await api.post('/api/piutang/invoices/generate', {
        unit_id: +$('#gUnit').value, semester: $('#gSem').value.trim(), nominal: $('#gAmt').value,
        tanggal: $('#gTgl').value, jatuh_tempo: $('#gJt').value || null, tenor_bulan: +$('#gTenor').value,
        mulai_amortisasi: $('#gMulai').value || null, prodi: $('#gProdi').value.trim() || null, angkatan: $('#gAng').value.trim() || null,
      });
      toast(`${r.count} tagihan diterbitkan (${fmtRp(r.total)}) — ${r.nomor}`, 'ok'); location.hash = '#/piutang/daftar';
    } catch (e) { toast(e.message, 'err'); }
  });
}

async function piCkpn() {
  const today = new Date().toISOString().slice(0, 10);
  const render = async (asof) => {
    const q = new URLSearchParams({ asof }); if (state.unit !== 'all') q.set('unit', state.unit);
    const ag = await api.get('/api/piutang/aging?' + q.toString());
    const rows = ag.buckets.map(b => `<tr>
      <td>${esc(b.label)}</td><td class="r mono">${fmtNum(b.outstanding)}</td>
      <td class="r mono note">${(b.rate * 100).toLocaleString('id')}%</td>
      <td class="r mono" style="color:var(--red);font-weight:700;">${fmtNum(b.ckpn)}</td></tr>`).join('');
    const detail = ag.rows.sort((a, b) => b.umur_hari - a.umur_hari).map(r => `<tr>
      <td class="mono" style="color:var(--primary);">${esc(r.nomor)}</td><td>${esc(r.mhs_nama)}</td><td>${esc(r.unit_kode)}</td>
      <td>${fmtDate(r.jatuh_tempo)}</td><td class="r">${r.umur_hari} hr</td><td class="note">${esc(r.bucket_label)}</td>
      <td class="r mono" style="font-weight:700;">${fmtNum(r.sisa)}</td></tr>`).join('')
      || '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px;">Tidak ada piutang beredar.</td></tr>';
    $('#ckpnOut').innerHTML = `
      <div class="card tbl-wrap">
        <div style="padding:16px 20px;"><div style="font-size:15px;font-weight:800;">Ringkasan CKPN — Cadangan Kerugian Penurunan Nilai</div>
          <div class="note" style="margin-top:3px;">${ag.unit ? esc(unitName()) : 'Konsolidasi seluruh unit'} · metode aging piutang · per ${fmtDate(ag.asof)}</div></div>
        <table class="tbl"><thead><tr><th>KELOMPOK UMUR PIUTANG</th><th class="r">SALDO PIUTANG</th><th class="r">% CADANGAN</th><th class="r">NILAI CADANGAN</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="tfoot"><td>TOTAL</td><td class="r mono">${fmtNum(ag.totalOutstanding)}</td><td></td><td class="r mono" style="color:var(--red);">${fmtNum(ag.totalCkpn)}</td></tr></tfoot></table>
      </div>
      <div class="card tbl-wrap" style="margin-top:16px;">
        <div style="padding:14px 18px;border-bottom:1px solid var(--line);font-weight:800;">Rincian per tagihan</div>
        <table class="tbl" style="min-width:760px;"><thead><tr><th>NO. TAGIHAN</th><th>MAHASISWA</th><th>UNIT</th><th>JATUH TEMPO</th><th class="r">UMUR</th><th>KELOMPOK</th><th class="r">SISA</th></tr></thead><tbody>${detail}</tbody></table>
      </div>`;
  };
  const rates = await api.get('/api/piutang/ckpn/rates');
  const rateCfg = perms.studentMaster ? `
    <div class="card pad" style="margin-top:14px;">
      <div style="font-size:13px;font-weight:800;margin-bottom:8px;">Tarif CKPN per kelompok umur <span class="note">(dapat dikonfigurasi — Enter untuk simpan)</span></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${rates.map(r => `<div class="field" style="width:130px;"><label>${esc(r.label)}</label>
          <input class="inp mono r" data-ckrate="${r.bucket_key}" value="${r.rate_persen}" style="padding:6px 8px;">%</div>`).join('')}
      </div>
    </div>` : '';
  $('#piOut').innerHTML = `
    <div class="card pad" style="margin-top:14px;">
      <div class="grid" style="grid-template-columns:auto auto 1fr;align-items:end;">
        <div class="field"><label>Per tanggal</label><input class="inp" type="date" id="ckAsof" value="${today}"></div>
        ${perms.process ? `<button class="btn gold" id="ckRun">Buat draft penyesuaian CKPN</button>` : ''}
        <div class="note" style="text-align:right;">Menghitung cadangan per bucket, lalu membuat <b>jurnal draft</b> (D Beban CKPN / K CKPN 1139) untuk direview.</div>
      </div>
    </div>
    ${rateCfg}
    <div id="ckpnOut" style="margin-top:16px;"></div>`;
  $('#ckAsof').addEventListener('change', e => render(e.target.value));
  $('#piOut').querySelectorAll('[data-ckrate]').forEach(inp => inp.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    try { await api.put('/api/piutang/ckpn/rates/' + inp.dataset.ckrate, { rate_persen: inp.value }); toast('Tarif CKPN diperbarui.', 'ok'); piCkpn(); }
    catch (err) { toast(err.message, 'err'); }
  }));
  const b = $('#ckRun'); if (b) b.addEventListener('click', async () => {
    const asof = $('#ckAsof').value;
    if (!confirm('Buat draft penyesuaian CKPN per ' + asof + '? (jurnal berstatus draft, direview lalu diajukan)')) return;
    try {
      const r = await api.post('/api/piutang/ckpn/run', { tanggal: asof });
      const made = r.results.filter(x => x.delta !== 0);
      const msg = made.length ? made.map(x => `${x.unit}: ${fmtRp(x.delta)}`).join('; ') : 'tidak ada perubahan';
      toast('Draft CKPN dibuat — ' + msg + '. Tinjau di Jurnal Umum.', 'ok'); render(asof);
    } catch (e) { toast(e.message, 'err'); }
  });
  render(today);
}

async function piAmortisasi() {
  const now = new Date();
  const model = { tahun: now.getUTCFullYear(), bulan: now.getUTCMonth() + 1 };
  const render = async () => {
    const q = new URLSearchParams({ tahun: model.tahun, bulan: model.bulan }); if (state.unit !== 'all') q.set('unit', state.unit);
    const pv = await api.get('/api/piutang/amortisasi/preview?' + q.toString());
    const perUnit = Object.entries(pv.perUnit).map(([uid, amt]) => {
      const u = state.units.find(x => x.id == uid) || {}; return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F0EEF4;"><span>${esc(u.nama || uid)}</span><b class="mono">${fmtRp(amt)}</b></div>`;
    }).join('') || '<div class="note">Tidak ada tagihan yang perlu diamortisasi bulan ini (atau sudah diproses).</div>';
    $('#amOut').innerHTML = `
      <div class="grid" style="grid-template-columns:1fr 340px;align-items:start;">
        <div class="card pad">
          <div style="font-size:15px;font-weight:800;">Pengakuan pendapatan UKT — ${MONTHS[model.bulan]} ${model.tahun}</div>
          <div class="note" style="margin-top:3px;">PSAK 72: memindahkan porsi bulan berjalan dari Pendapatan Diterima di Muka (2120) ke Pendapatan UKT (4100).</div>
          <div class="stat-grid" style="grid-template-columns:1fr 1fr;margin-top:14px;">
            <div class="stat"><div class="label">TAGIHAN DIPROSES</div><div class="value">${pv.count}</div></div>
            <div class="stat"><div class="label">TOTAL PENGAKUAN</div><div class="value">${fmtRp(pv.total)}</div></div>
          </div>
          ${perms.process ? `<button class="btn primary" id="amRun" style="margin-top:16px;" ${pv.count ? '' : 'disabled'}>Proses pengakuan pendapatan</button>` : ''}
        </div>
        <div class="card pad" style="background:var(--primary-bg);border-color:var(--line2);">
          <div style="font-size:12px;font-weight:800;color:var(--primary);letter-spacing:.04em;">RINCIAN PER UNIT</div>
          <div style="margin-top:10px;">${perUnit}</div>
        </div>
      </div>`;
    const b = $('#amRun'); if (b) b.addEventListener('click', async () => {
      if (!confirm(`Proses pengakuan pendapatan ${MONTHS[model.bulan]} ${model.tahun}?`)) return;
      try { const r = await api.post('/api/piutang/amortisasi/run', { tahun: model.tahun, bulan: model.bulan });
        toast(`Diakui ${fmtRp(r.grandTotal)} — ${r.results.map(x => x.unit + ':' + x.journal).join(', ')}`, 'ok'); render();
      } catch (e) { toast(e.message, 'err'); }
    });
  };
  const yearOpt = [2025, 2026, 2027].map(y => `<option value="${y}" ${y === model.tahun ? 'selected' : ''}>${y}</option>`).join('');
  const monOpt = MONTHS.slice(1).map((m, i) => `<option value="${i + 1}" ${i + 1 === model.bulan ? 'selected' : ''}>${m}</option>`).join('');
  $('#piOut').innerHTML = `
    <div class="card pad" style="margin-top:14px;">
      <div class="grid" style="grid-template-columns:auto auto 1fr;align-items:end;">
        <div class="field"><label>Bulan</label><select class="inp" id="amBulan">${monOpt}</select></div>
        <div class="field"><label>Tahun</label><select class="inp" id="amTahun">${yearOpt}</select></div>
        <div class="note" style="text-align:right;">Jalankan tiap akhir bulan. Bulan yang sudah diproses tidak akan dihitung ulang.</div>
      </div>
    </div>
    <div id="amOut" style="margin-top:16px;"></div>`;
  $('#amBulan').addEventListener('change', e => { model.bulan = +e.target.value; render(); });
  $('#amTahun').addEventListener('change', e => { model.tahun = +e.target.value; render(); });
  render();
}

// ================= PAJAK (PPh 21 / PPh 23) =================
async function viewPajak(tab) {
  const tabs = [['pemotongan', 'Pemotongan & Bukti Potong'], ['rekap', 'Rekap & Setor'], ['tarif', 'Tarif Pajak']];
  const tabHtml = tabs.map(([k, l]) => `<div class="tab ${k === tab ? 'active' : ''}" onclick="location.hash='#/pajak/${k}'">${l}</div>`).join('');
  $('#main').innerHTML = `<h1 class="page">Pajak Penghasilan (PPh)</h1><div class="subtle">Pemotongan PPh 21 (honor/gaji) &amp; PPh 23 (jasa/sewa), rekap masa, dan penyetoran.</div>
    <div class="tabs">${tabHtml}</div><div id="pjOut"></div>`;
  if (tab === 'rekap') return pjRekap();
  if (tab === 'tarif') return pjTarif();
  return pjPemotongan();
}

async function pjPemotongan() {
  const rates = await api.get('/api/pajak/rates');
  const banks = await api.get('/api/kasbank/bank-accounts');
  const list = await api.get('/api/pajak/withholdings' + (state.unit === 'all' ? '' : '?unit=' + state.unit));
  const postable = state.accounts.filter(a => a.is_postable);

  const rows = list.map(w => `<tr>
    <td class="mono" style="color:var(--primary);font-weight:700;">${esc(w.nomor)}</td>
    <td>${fmtDate(w.tanggal)}</td>
    <td>${w.jenis === 'pph21' ? '<span class="badge reversed">PPh 21</span>' : '<span class="badge pending">PPh 23</span>'}</td>
    <td>${esc(w.lawan_nama || '')}<div class="note mono">${esc(w.lawan_npwp || '')}</div></td>
    <td class="r mono">${fmtNum(w.dpp)}</td>
    <td class="r mono" style="color:var(--red);font-weight:700;">${fmtNum(w.pajak)}</td>
    <td>${w.status === 'disetor' ? '<span class="badge posted">disetor</span>' : '<span class="badge draft">dipotong</span>'}</td>
    <td class="r"><button class="btn sm outline" data-bp="${w.id}">Bukti potong</button></td></tr>`).join('')
    || '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px;">Belum ada pemotongan.</td></tr>';

  const formHtml = perms.taxRecord ? `
    <div class="grid" style="grid-template-columns:1fr 320px;align-items:start;margin-bottom:18px;">
      <div class="card pad">
        <div style="font-size:15px;font-weight:800;">Catat pemotongan pajak</div>
        <div class="note" style="margin-top:3px;">Sistem membentuk jurnal: (D) Objek — (K) Utang PPh — (K) Kas/Bank (neto).</div>
        <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:16px;">
          <div class="field"><label>Jenis / tarif</label><select class="inp" id="txRate">${rates.filter(r => r.aktif).map(r => `<option value="${r.id}">${esc(r.nama)} — ${(r.tarif_bp / 100)}%</option>`).join('')}</select></div>
          <div class="field"><label>Tanggal</label><input class="inp" type="date" id="txDate" value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="field"><label>Unit</label><select class="inp" id="txUnit">${state.units.map(u => `<option value="${u.id}">${esc(u.nama)}</option>`).join('')}</select></div>
          <div class="field"><label>Akun objek (beban/aset)</label><select class="inp" id="txAcc">${postable.filter(a => a.tipe === 'beban' || /^12/.test(a.kode)).map(a => `<option value="${a.id}">${esc(a.kode)} — ${esc(a.nama)}</option>`).join('')}</select></div>
          <div class="field"><label>Rekening pembayar</label><select class="inp" id="txBank">${banks.map(b => `<option value="${b.id}">${esc(b.nama)} (${esc(b.unit_kode)})</option>`).join('')}</select></div>
          <div class="field"><label>Bruto / DPP (Rp)</label><input class="inp mono r" id="txDpp" placeholder="0"></div>
          <div class="field"><label>Nama penerima (WP dipotong)</label><input class="inp" id="txNama"></div>
          <div class="field"><label>NPWP</label><input class="inp mono" id="txNpwp" placeholder="00.000.000.0-000.000"></div>
        </div>
        <div class="field" style="margin-top:12px;"><label>Keterangan</label><input class="inp" id="txKet" placeholder="mis. Honor mengajar Juli 2026"></div>
        <button class="btn primary" id="txSave" style="margin-top:16px;">Simpan &amp; potong</button>
      </div>
      <div class="card pad" style="background:var(--primary-bg);border-color:var(--line2);">
        <div style="font-size:12px;font-weight:800;color:var(--primary);letter-spacing:.04em;">PERHITUNGAN & JURNAL</div>
        <div id="txPrev" style="margin-top:12px;"></div>
      </div>
    </div>` : '';

  $('#pjOut').innerHTML = formHtml + `
    <div class="card tbl-wrap">
      <div style="padding:14px 18px;border-bottom:1px solid var(--line);font-weight:800;">Riwayat pemotongan</div>
      <table class="tbl" style="min-width:900px;"><thead><tr><th>NO. BUKTI</th><th>TANGGAL</th><th>JENIS</th><th>PENERIMA</th><th class="r">DPP</th><th class="r">PAJAK</th><th>STATUS</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  $('#pjOut').querySelectorAll('[data-bp]').forEach(b => b.addEventListener('click', () => buktiPotongModal(+b.dataset.bp)));

  if (perms.taxRecord) {
    const rateById = (id) => rates.find(r => r.id == id) || {};
    const accById = (id) => postable.find(a => a.id == id) || {};
    const bankById = (id) => banks.find(b => b.id == id) || {};
    function preview() {
      const r = rateById($('#txRate').value), dpp = toSen($('#txDpp').value);
      const pajak = Math.round(dpp * (r.tarif_bp || 0) / 10000), neto = dpp - pajak;
      const acc = accById($('#txAcc').value), bank = bankById($('#txBank').value);
      $('#txPrev').innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:12.5px;"><span class="note">Bruto (DPP)</span><b class="mono">${fmtRp(dpp)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-top:4px;"><span class="note">Tarif</span><b>${(r.tarif_bp || 0) / 100}%</b></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-top:4px;"><span class="note">Pajak dipotong</span><b class="mono" style="color:var(--red);">${fmtRp(pajak)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-top:4px;border-top:1px solid var(--line2);padding-top:6px;"><span class="note">Neto dibayar</span><b class="mono" style="color:var(--green);">${fmtRp(neto)}</b></div>
        <div class="card mono" style="padding:10px 12px;margin-top:10px;font-size:11px;line-height:1.9;box-shadow:none;">
          (D) ${esc(acc.kode || '')} ${esc(acc.nama || '')} <span style="float:right;">${fmtNum(dpp)}</span><br>
          (K) &nbsp;&nbsp;${esc(r.utang_kode || '')} ${esc(r.utang_nama || 'Utang PPh')} <span style="float:right;">${fmtNum(pajak)}</span><br>
          (K) &nbsp;&nbsp;${esc(acc2kode(bank))} ${esc(bank.nama || '')} <span style="float:right;">${fmtNum(neto)}</span></div>`;
    }
    ['txRate', 'txAcc', 'txBank'].forEach(id => $('#' + id).addEventListener('change', preview));
    $('#txDpp').addEventListener('input', preview);
    preview();
    $('#txSave').addEventListener('click', async () => {
      if (toSen($('#txDpp').value) <= 0) { toast('Bruto/DPP harus lebih dari nol.', 'err'); return; }
      try {
        const w = await api.post('/api/pajak/withholdings', {
          rate_id: +$('#txRate').value, tanggal: $('#txDate').value, unit_id: +$('#txUnit').value,
          beban_account_id: +$('#txAcc').value, bank_account_id: +$('#txBank').value,
          lawan_nama: $('#txNama').value.trim(), lawan_npwp: $('#txNpwp').value.trim(),
          dpp: $('#txDpp').value, keterangan: $('#txKet').value.trim(),
        });
        toast('Pemotongan tercatat: ' + w.nomor, 'ok'); pjPemotongan();
      } catch (e) { toast(e.message, 'err'); }
    });
  }
}
function acc2kode(bank) { return bank.akun_kode || ''; }

async function buktiPotongModal(id) {
  const w = await api.get('/api/pajak/withholdings/' + id);
  openModal(`Bukti Pemotongan ${w.jenis_label}`, `
    <div style="text-align:center;border-bottom:2px solid var(--primary);padding-bottom:10px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:.14em;color:var(--muted);">YAYASAN TAZKIA CENDIKIA</div>
      <div style="font-size:15px;font-weight:800;color:var(--primary-d);margin-top:3px;">BUKTI PEMOTONGAN ${esc(w.jenis_label)}</div>
      <div class="mono" style="font-size:12px;color:var(--primary);font-weight:700;margin-top:2px;">${esc(w.nomor)}</div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:14px;gap:10px;">
      <div><div class="note">TANGGAL</div><div style="font-weight:700;">${fmtDate(w.tanggal)}</div></div>
      <div><div class="note">UNIT PEMOTONG</div><div style="font-weight:700;">${esc(w.unit_nama)}</div></div>
      <div><div class="note">NAMA WP DIPOTONG</div><div style="font-weight:700;">${esc(w.lawan_nama || '-')}</div></div>
      <div><div class="note">NPWP</div><div class="mono" style="font-weight:700;">${esc(w.lawan_npwp || '-')}</div></div>
    </div>
    <div class="card" style="margin-top:14px;box-shadow:none;">
      <div class="tree-row"><span style="flex:1;">Dasar Pengenaan Pajak (Bruto)</span><b class="mono">${fmtRp(w.dpp)}</b></div>
      <div class="tree-row"><span style="flex:1;">Tarif</span><b>${w.tarif_bp / 100}%</b></div>
      <div class="tree-row"><span style="flex:1;font-weight:800;">PPh Dipotong</span><b class="mono" style="color:var(--red);">${fmtRp(w.pajak)}</b></div>
      <div class="tree-row"><span style="flex:1;">Neto Dibayarkan</span><b class="mono" style="color:var(--green);">${fmtRp(w.neto)}</b></div>
    </div>
    <div class="note" style="margin-top:10px;">${esc(w.keterangan || '')} · Jurnal <b class="mono">${esc(w.jurnal_nomor || '')}</b> · Status: <b>${w.status}</b></div>`,
    async () => {});
  // ubah tombol Simpan jadi Tutup
  const ok = document.querySelector('.toast'); // no-op
}

async function pjRekap() {
  const now = new Date(); const model = { tahun: now.getUTCFullYear(), bulan: now.getUTCMonth() + 1 };
  const banks = await api.get('/api/kasbank/bank-accounts');
  const render = async () => {
    const rc = await api.get(`/api/pajak/recap?tahun=${model.tahun}&bulan=${model.bulan}`);
    const card = (j) => `
      <div class="card pad">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:15px;font-weight:800;">${esc(j.label)}</div>
          ${j.jenis === 'pph21' ? '<span class="badge reversed">21</span>' : '<span class="badge pending">23</span>'}</div>
        <div class="stat-grid" style="grid-template-columns:1fr 1fr;margin-top:12px;">
          <div class="stat" style="padding:12px 14px;"><div class="label">DIPOTONG (${j.count})</div><div class="value" style="font-size:16px;">${fmtRp(j.pajak)}</div></div>
          <div class="stat" style="padding:12px 14px;background:${j.belumSetor > 0 ? 'var(--gold-bg)' : 'var(--green-bg)'};"><div class="label">BELUM DISETOR</div><div class="value" style="font-size:16px;">${fmtRp(j.belumSetor)}</div></div>
        </div>
        <div class="note" style="margin-top:8px;">Sudah disetor: <b class="mono">${fmtRp(j.disetor)}</b></div>
        ${perms.taxSetor && j.belumSetor > 0 ? `<button class="btn primary" data-setor="${j.jenis}" style="margin-top:12px;">Setor ${esc(j.label)}</button>` : ''}
      </div>`;
    $('#rekapOut').innerHTML = `<div class="grid" style="grid-template-columns:1fr 1fr;">${card(rc.byJenis.pph21)}${card(rc.byJenis.pph23)}</div>`;
    $('#rekapOut').querySelectorAll('[data-setor]').forEach(b => b.addEventListener('click', () => {
      const jenis = b.dataset.setor;
      const bankOpt = banks.map(x => `<option value="${x.id}">${esc(x.nama)} (${esc(x.unit_kode)})</option>`).join('');
      openModal('Setor ' + (jenis === 'pph21' ? 'PPh 21' : 'PPh 23'), `
        <div class="note">Menyetorkan seluruh ${jenis === 'pph21' ? 'PPh 21' : 'PPh 23'} yang belum disetor pada masa ${MONTHS[model.bulan]} ${model.tahun}. Jurnal: (D) Utang PPh — (K) Kas/Bank.</div>
        <div class="field" style="margin-top:12px;"><label>Rekening pembayar</label><select class="inp" id="stBank">${bankOpt}</select></div>
        <div class="field" style="margin-top:12px;"><label>Tanggal setor</label><input class="inp" type="date" id="stDate" value="${new Date().toISOString().slice(0, 10)}"></div>`,
        async () => {
          const r = await api.post('/api/pajak/setor', { tahun: model.tahun, bulan: model.bulan, jenis, bank_account_id: +$('#stBank').value, tanggal: $('#stDate').value });
          toast(`Disetor ${fmtRp(r.total)} — jurnal ${r.jurnal}`, 'ok'); render();
        });
    }));
  };
  const yearOpt = [2025, 2026, 2027].map(y => `<option value="${y}" ${y === model.tahun ? 'selected' : ''}>${y}</option>`).join('');
  const monOpt = MONTHS.slice(1).map((m, i) => `<option value="${i + 1}" ${i + 1 === model.bulan ? 'selected' : ''}>${m}</option>`).join('');
  $('#pjOut').innerHTML = `
    <div class="card pad" style="margin-top:14px;">
      <div class="grid" style="grid-template-columns:auto auto 1fr;align-items:end;">
        <div class="field"><label>Bulan</label><select class="inp" id="rkBulan">${monOpt}</select></div>
        <div class="field"><label>Tahun</label><select class="inp" id="rkTahun">${yearOpt}</select></div>
        <div class="note" style="text-align:right;">Rekap PPh Masa untuk mendukung pelaporan SPT Masa.</div>
      </div>
    </div>
    <div id="rekapOut" style="margin-top:16px;"></div>`;
  $('#rkBulan').addEventListener('change', e => { model.bulan = +e.target.value; render(); });
  $('#rkTahun').addEventListener('change', e => { model.tahun = +e.target.value; render(); });
  render();
}

async function pjTarif() {
  const rates = await api.get('/api/pajak/rates');
  const rows = rates.map(r => `<tr>
    <td class="mono" style="font-weight:700;">${esc(r.kode)}</td><td>${esc(r.nama)}</td>
    <td>${r.jenis === 'pph21' ? 'PPh 21' : 'PPh 23'}</td>
    <td>${esc(r.utang_kode)} ${esc(r.utang_nama)}</td>
    <td class="r">${perms.taxRate ? `<input class="inp mono r" data-rate="${r.id}" value="${r.tarif_bp / 100}" style="width:80px;padding:5px 8px;">%` : (r.tarif_bp / 100) + '%'}</td></tr>`).join('');
  $('#pjOut').innerHTML = `
    ${perms.taxRate ? '<div class="note" style="margin:14px 0 6px;">Ubah nilai tarif langsung di tabel (tekan Enter untuk simpan).</div>' : ''}
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>KODE</th><th>NAMA</th><th>JENIS</th><th>AKUN UTANG</th><th class="r">TARIF</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $('#pjOut').querySelectorAll('[data-rate]').forEach(inp => inp.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    try { await api.put('/api/pajak/rates/' + inp.dataset.rate, { tarif_persen: inp.value }); toast('Tarif diperbarui.', 'ok'); pjTarif(); }
    catch (err) { toast(err.message, 'err'); }
  }));
}

// ================= LAPORAN KEUANGAN (ISAK 35) =================
const lapState = { type: 'posisi', from: null, to: null };
function fmtAcc(sen) { if (!sen) return '-'; const neg = sen < 0; const s = fmtNum(Math.abs(sen)); return neg ? '(' + s + ')' : s; }

async function viewLaporan() {
  const today = new Date().toISOString().slice(0, 10);
  if (!lapState.to) lapState.to = today;
  if (!lapState.from) lapState.from = today.slice(0, 4) + '-01-01';
  const isPeriod = lapState.type !== 'posisi';
  const q = new URLSearchParams({ from: lapState.from, to: lapState.to });
  if (state.unit !== 'all') q.set('unit', state.unit);
  const rep = await api.get('/api/reports/fs/' + lapState.type + '?' + q.toString());

  const typeOpt = [['posisi', 'Laporan Posisi Keuangan'], ['aktivitas', 'Laporan Penghasilan Komprehensif'],
    ['asetneto', 'Laporan Perubahan Aset Neto'], ['aruskas', 'Laporan Arus Kas']]
    .map(([k, l]) => `<option value="${k}" ${k === lapState.type ? 'selected' : ''}>${l}</option>`).join('');

  const cols = rep.columns.length;
  const gridCols = `minmax(240px,1fr) ${'160px '.repeat(cols).trim()}`;
  let cells = `<div class="fs-cell head">URAIAN</div>` + rep.columns.map(c => `<div class="fs-cell head val">${esc(c)}</div>`).join('');
  for (const r of rep.rows) {
    if (r.section) { cells += `<div class="fs-sec" style="grid-column:1 / -1;">${esc(r.label)}</div>`; continue; }
    const rule = r.rule ? 'border-top:1.5px solid var(--primary);' : '';
    const b = r.bold ? 'font-weight:800;' : '';
    const pad = r.indent ? 'padding-left:20px;' : '';
    cells += `<div class="fs-cell lbl" style="${rule}${b}${pad}">${esc(r.label)}</div>`;
    for (let i = 0; i < cols; i++) cells += `<div class="fs-cell val" style="${rule}${b}">${r.values ? fmtAcc(r.values[i]) : ''}</div>`;
  }

  const balWarn = rep.balanced === false ? `<div class="err-box no-print" style="margin-top:12px;">Laporan tidak seimbang${rep.selisih != null ? ` — selisih <b>${fmtRp(rep.selisih)}</b> antara Aset Neto residual (${fmtRp(rep.asetNetoResidual)}) dan Aset Neto riil dari akun ekuitas + surplus (${fmtRp(rep.asetNetoRiil)})` : ''}. Kemungkinan pasangan jurnal (mis. antar-unit) belum lengkap.</div>` : '';
  // Fase 5: validasi saldo akun antar-unit di konsolidasi harus nol; jika tidak, tampilkan rincian selisih.
  let iuWarn = '';
  if (state.unit === 'all') {
    const iu = await api.get('/api/reports/interunit-check');
    if (!iu.balanced) {
      const detail = iu.rows.map(r => `${esc(r.kode)} ${esc(r.nama)}: ${fmtRp(r.net)}`).join(' · ');
      iuWarn = `<div class="warn-box no-print" style="margin-top:12px;"><b>Peringatan konsolidasi:</b> saldo akun antar-unit belum nol (selisih <b>${fmtRp(iu.totalNet)}</b>). Rincian — ${detail}. Pasangan jurnal antar-unit kemungkinan belum lengkap.</div>`;
    }
  }
  $('#main').innerHTML = `
    <h1 class="page no-print">Laporan Keuangan</h1>
    <div class="subtle no-print">Format ISAK 35 — entitas berorientasi nonlaba</div>
    <div class="no-print" style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap;align-items:flex-end;">
      <div class="field"><label>Jenis laporan</label><select class="inp" id="lapType" style="min-width:280px;">${typeOpt}</select></div>
      <div class="field ${isPeriod ? '' : 'hidden'}"><label>Dari tanggal</label><input class="inp" type="date" id="lapFrom" value="${lapState.from}"></div>
      <div class="field"><label>${isPeriod ? 'Sampai tanggal' : 'Per tanggal'}</label><input class="inp" type="date" id="lapTo" value="${lapState.to}"></div>
      <div style="margin-left:auto;display:flex;gap:8px;">
        <button class="btn outline" id="lapXls" style="border-color:var(--green);color:var(--green);">Export Excel</button>
        <button class="btn primary" id="lapPdf">Export PDF</button>
      </div>
    </div>
    ${balWarn}${iuWarn}
    <div class="print-doc">
      <div style="display:flex;align-items:center;gap:14px;border-bottom:2.5px solid var(--primary);padding-bottom:16px;">
        <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(150deg,#4B3080,#2E1E4F);display:flex;align-items:center;justify-content:center;color:var(--cream);font-size:24px;font-weight:800;flex-shrink:0;">T</div>
        <div><div style="font-size:16px;font-weight:800;letter-spacing:.02em;color:var(--primary-d);">YAYASAN TAZKIA CENDIKIA</div>
          <div class="note">Jl. Pendidikan No. 27, Kota Serang, Banten · NPWP 01.234.567.8-401.000</div></div>
      </div>
      <div style="text-align:center;margin-top:22px;">
        <div style="font-size:20px;font-weight:800;color:var(--ink);">${esc(rep.title)}</div>
        <div style="font-size:13px;font-weight:600;color:var(--muted2);margin-top:4px;">${esc(rep.period)}</div>
        <div style="font-size:12px;font-weight:700;color:var(--primary);margin-top:3px;">${esc(rep.unitName)}</div>
        <div class="note" style="margin-top:4px;">(Disajikan dalam Rupiah)</div>
      </div>
      <div style="margin-top:24px;overflow-x:auto;"><div class="fs-grid" style="grid-template-columns:${gridCols};">${cells}</div></div>
      <div style="display:flex;justify-content:space-between;margin-top:40px;padding-top:16px;">
        <div class="note">Dicetak dari SIKEU Tazkia · ${fmtDate(today)}</div>
        <div style="text-align:center;">
          <div style="font-size:11.5px;font-weight:600;color:var(--muted2);">Serang, ${fmtDate(today)}</div>
          <div style="font-size:11.5px;font-weight:600;color:var(--muted2);">Bendahara Yayasan,</div>
          <div style="height:52px;"></div>
          <div style="font-size:12px;font-weight:800;color:var(--ink);border-top:1px solid var(--ink);padding-top:5px;">( .................................. )</div>
        </div>
      </div>
    </div>`;

  $('#lapType').addEventListener('change', e => { lapState.type = e.target.value; viewLaporan(); });
  $('#lapTo').addEventListener('change', e => { lapState.to = e.target.value; viewLaporan(); });
  const lf = $('#lapFrom'); if (lf) lf.addEventListener('change', e => { lapState.from = e.target.value; viewLaporan(); });
  $('#lapPdf').addEventListener('click', () => window.print());
  $('#lapXls').addEventListener('click', () => exportExcel(rep));
}

// Unduh tabel apa pun sebagai .xls (Excel membuka tabel HTML). rows = array of array.
function downloadXls(filename, title, subtitle, head, rows) {
  const cell = v => typeof v === 'number' ? `<td align="right">${v}</td>` : `<td>${esc(v)}</td>`;
  let html = `<table border="1"><tr><td colspan="${head.length}"><b>${esc(title)}</b></td></tr>`;
  html += `<tr><td colspan="${head.length}">${esc(subtitle)}</td></tr><tr></tr>`;
  html += `<tr>${head.map(h => `<td align="center"><b>${esc(h)}</b></td>`).join('')}</tr>`;
  for (const r of rows) html += `<tr>${r.map(cell).join('')}</tr>`;
  html += '</table>';
  const blob = new Blob(['﻿<html><head><meta charset="utf-8"></head><body>' + html + '</body></html>'], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename + '.xls'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('File Excel diunduh.', 'ok');
}

function exportExcel(rep) {
  const cols = rep.columns;
  let html = `<table border="1"><tr><td colspan="${cols.length + 1}"><b>${esc(rep.title)}</b></td></tr>`;
  html += `<tr><td colspan="${cols.length + 1}">${esc(rep.unitName)} — ${esc(rep.period)}</td></tr><tr></tr>`;
  html += `<tr><td><b>URAIAN</b></td>${cols.map(c => `<td align="right"><b>${esc(c)}</b></td>`).join('')}</tr>`;
  for (const r of rep.rows) {
    if (r.section) { html += `<tr><td colspan="${cols.length + 1}"><b>${esc(r.label)}</b></td></tr>`; continue; }
    html += `<tr><td>${esc(r.label)}</td>${cols.map((_, i) => `<td align="right">${r.values ? (r.values[i] / 100) : ''}</td>`).join('')}</tr>`;
  }
  html += '</table>';
  const blob = new Blob(['﻿<html><head><meta charset="utf-8"></head><body>' + html + '</body></html>'], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = rep.title.replace(/\s+/g, '_') + '_' + (state.unit) + '.xls'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('File Excel diunduh.', 'ok');
}

// ================= ANGGARAN (RKAT) =================
let rkatYear = new Date().getUTCFullYear();
function barColor(flag) { return flag === 'lebih' ? 'var(--red)' : flag === 'waspada' ? 'var(--gold)' : 'var(--green)'; }

async function viewAnggaran() {
  const unitId = state.unit === 'all' ? null : (state.units.find(u => u.kode === state.unit) || {}).id;
  const rep = await api.get('/api/budget?tahun=' + rkatYear + (state.unit === 'all' ? '' : '&unit=' + state.unit));
  const editable = !!unitId && rep.status === 'draft' && perms.budgetEdit;
  const yearOpt = [2025, 2026, 2027].map(y => `<option value="${y}" ${y === rkatYear ? 'selected' : ''}>${y}</option>`).join('');

  const statusPill = (s, label, active) => `<span class="badge ${active ? (s === 'disahkan' ? 'posted' : s === 'diajukan' ? 'pending' : 'draft') : 'draft'}" style="${active ? '' : 'opacity:.45;'}">${label}</span>`;
  const st = rep.status;
  const flow = state.unit === 'all' ? '' : `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span class="note">Status RKAT ${rkatYear}:</span>
      ${statusPill('draft', 'Draft', true)} <span style="color:#D5CFE2;">→</span>
      ${statusPill('diajukan', 'Diajukan', st === 'diajukan' || st === 'disahkan')} <span style="color:#D5CFE2;">→</span>
      ${statusPill('disahkan', st === 'disahkan' ? '✓ Disahkan Yayasan' : 'Disahkan', st === 'disahkan')}
    </div>`;

  const warn = rep.rows.filter(r => r.flag !== 'normal');
  const warnBox = warn.length ? `<div class="${warn.some(r => r.flag === 'lebih') ? 'err-box' : 'warn-box'}" style="margin-top:14px;">
    ${warn.some(r => r.flag === 'lebih') ? 'Ada pos yang <b>melebihi anggaran</b>: ' : 'Pos mendekati/melewati 80% pagu: '}
    ${warn.map(r => `${esc(r.kode)} ${esc(r.nama)} (${r.persen}%)`).join(', ')}.</div>` : '';

  const rows = rep.rows.map(r => {
    const w = Math.min(100, Math.max(2, r.persen));
    const anggaranCell = editable
      ? `<input class="inp mono r" data-line-acc="${r.account_id}" value="${fmtNum(r.anggaran)}" style="padding:6px 8px;font-size:12px;">`
      : `<span class="mono">${fmtNum(r.anggaran)}</span>`;
    return `<tr>
      <td class="note">${esc(r.unit_kode)}</td>
      <td style="font-weight:700;"><span class="mono" style="color:var(--primary);">${esc(r.kode)}</span> ${esc(r.nama)}</td>
      <td class="r">${anggaranCell}</td>
      <td class="r mono">${fmtNum(r.realisasi)}</td>
      <td class="r mono" style="font-weight:700;color:${r.sisa < 0 ? 'var(--red)' : 'var(--ink)'};">${fmtNum(r.sisa)}</td>
      <td><div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;height:7px;background:#EEECF3;border-radius:9999px;"><div style="height:100%;border-radius:9999px;width:${w}%;background:${barColor(r.flag)};"></div></div>
        <span class="mono" style="font-size:11px;font-weight:700;width:48px;text-align:right;color:${barColor(r.flag)};">${r.persen}%</span>
      </div></td>
      ${editable ? `<td class="c"><button class="btn sm danger" data-del-line="${r.id}" title="Hapus">×</button></td>` : ''}
    </tr>`;
  }).join('') || `<tr><td colspan="${editable ? 7 : 6}" style="text-align:center;color:var(--muted);padding:24px;">Belum ada pos anggaran untuk ${rkatYear}${state.unit === 'all' ? '' : ' pada unit ini'}.</td></tr>`;

  const actions = [];
  if (state.unit !== 'all') {
    if (st === 'draft' && perms.budgetEdit && rep.rows.length) actions.push(`<button class="btn outline" id="rkSubmit">Ajukan RKAT</button>`);
    if (st === 'diajukan' && perms.budgetApprove) actions.push(`<button class="btn green" id="rkApprove">Sahkan RKAT</button>`);
    if ((st === 'disahkan' || st === 'diajukan') && perms.budgetApprove) actions.push(`<button class="btn gold" id="rkReopen">Buka kembali ke draft</button>`);
  }

  $('#main').innerHTML = `
    <div class="row-between no-print">
      <div><h1 class="page">Anggaran (RKAT) ${rkatYear}</h1>
        <div class="subtle">${esc(unitName())}${state.unit === 'all' ? ' · gabungan seluruh unit (baca saja)' : ''}</div></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <select class="inp" id="rkYear" style="width:auto;">${yearOpt}</select>
        <button class="btn outline sm" id="rkXls" style="border-color:var(--green);color:var(--green);">Export Excel</button>
        <button class="btn sm" id="rkPrint">Cetak / PDF</button>
        ${flow}
      </div>
    </div>
    <div class="print-only" style="text-align:center;margin-bottom:10px;">
      <div style="font-size:15px;font-weight:800;color:var(--primary-d);">YAYASAN TAZKIA CENDIKIA</div>
      <div style="font-size:14px;font-weight:800;margin-top:2px;">LAPORAN REALISASI ANGGARAN (RKAT) ${rkatYear}</div>
      <div style="font-size:12px;">${esc(unitName())} · per ${fmtDate(new Date().toISOString())}</div>
    </div>
    ${warnBox}
    <div class="card tbl-wrap" style="margin-top:18px;">
      <table class="tbl" style="min-width:900px;"><thead><tr>
        <th>UNIT</th><th>POS ANGGARAN</th><th class="r">ANGGARAN</th><th class="r">REALISASI</th><th class="r">SISA</th><th>% TERPAKAI</th>${editable ? '<th></th>' : ''}
      </tr></thead><tbody>${rows}</tbody>
      <tfoot><tr class="tfoot"><td colspan="2">TOTAL</td><td class="r mono">${fmtNum(rep.totalAnggaran)}</td><td class="r mono">${fmtNum(rep.totalRealisasi)}</td><td class="r mono">${fmtNum(rep.totalSisa)}</td><td class="c mono" style="color:var(--primary);">${rep.persen}%</td>${editable ? '<td></td>' : ''}</tr></tfoot>
      </table>
    </div>
    <div style="display:flex;gap:16px;margin-top:12px;font-size:11.5px;font-weight:600;color:var(--muted);align-items:center;flex-wrap:wrap;">
      <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:12px;height:7px;border-radius:9999px;background:var(--green);"></span>Normal</span>
      <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:12px;height:7px;border-radius:9999px;background:var(--gold);"></span>&gt; 80% terpakai</span>
      <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:12px;height:7px;border-radius:9999px;background:var(--red);"></span>Melebihi anggaran</span>
      <span style="margin-left:auto;display:flex;gap:8px;">
        ${editable ? `<button class="btn primary sm" id="rkAdd">+ Tambah pos</button>` : ''}
        ${actions.join('')}
      </span>
    </div>
    ${state.unit === 'all' ? '<div class="note" style="margin-top:10px;">Pilih unit tertentu di kanan atas untuk menyusun/mengesahkan RKAT-nya.</div>' : ''}`;

  $('#rkYear').addEventListener('change', e => { rkatYear = +e.target.value; viewAnggaran(); });

  // Edit nominal pos (saat draft)
  $('#main').querySelectorAll('[data-line-acc]').forEach(inp => inp.addEventListener('change', async () => {
    try { await api.post('/api/budget/line', { tahun: rkatYear, unit_id: unitId, account_id: +inp.dataset.lineAcc, nominal: inp.value }); toast('Pagu diperbarui.', 'ok'); viewAnggaran(); }
    catch (e) { toast(e.message, 'err'); }
  }));
  $('#main').querySelectorAll('[data-del-line]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Hapus pos anggaran ini?')) return;
    try { await api.del('/api/budget/line/' + b.dataset.delLine); toast('Pos dihapus.', 'ok'); viewAnggaran(); } catch (e) { toast(e.message, 'err'); }
  }));

  const addBtn = $('#rkAdd'); if (addBtn) addBtn.addEventListener('click', () => {
    const bebanFirst = state.accounts.filter(a => a.is_postable).sort((a, b) => (a.tipe === 'beban' ? -1 : 1) - (b.tipe === 'beban' ? -1 : 1));
    const accOpt = bebanFirst.map(a => `<option value="${a.id}">${esc(a.kode)} — ${esc(a.nama)} (${a.tipe})</option>`).join('');
    openModal('Tambah Pos Anggaran', `
      <div class="field"><label>Akun</label><select class="inp" id="rlAcc">${accOpt}</select></div>
      <div class="field" style="margin-top:12px;"><label>Anggaran (Rp)</label><input class="inp mono r" id="rlNom" placeholder="0"></div>`,
      async () => { await api.post('/api/budget/line', { tahun: rkatYear, unit_id: unitId, account_id: +$('#rlAcc').value, nominal: $('#rlNom').value }); toast('Pos ditambahkan.', 'ok'); viewAnggaran(); });
  });

  const bind = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
  bind('rkPrint', () => window.print());
  bind('rkXls', () => {
    const head = ['UNIT', 'KODE', 'POS ANGGARAN', 'ANGGARAN', 'REALISASI', 'SISA', '% TERPAKAI'];
    const body = rep.rows.map(r => [r.unit_kode, r.kode, r.nama, r.anggaran / 100, r.realisasi / 100, r.sisa / 100, r.persen]);
    body.push(['', '', 'TOTAL', rep.totalAnggaran / 100, rep.totalRealisasi / 100, rep.totalSisa / 100, rep.persen]);
    downloadXls(`Realisasi_RKAT_${rkatYear}_${state.unit}`, `Laporan Realisasi Anggaran (RKAT) ${rkatYear}`, unitName(), head, body);
  });
  bind('rkSubmit', async () => { try { await api.post('/api/budget/submit', { tahun: rkatYear, unit_id: unitId }); toast('RKAT diajukan.', 'ok'); viewAnggaran(); } catch (e) { toast(e.message, 'err'); } });
  bind('rkApprove', async () => { if (!confirm('Sahkan RKAT ' + rkatYear + '? Setelah disahkan, pagu ditegakkan pada posting beban.')) return; try { await api.post('/api/budget/approve', { tahun: rkatYear, unit_id: unitId }); toast('RKAT disahkan.', 'ok'); viewAnggaran(); } catch (e) { toast(e.message, 'err'); } });
  bind('rkReopen', async () => { if (!confirm('Buka kembali RKAT ke draft untuk revisi?')) return; try { await api.post('/api/budget/reopen', { tahun: rkatYear, unit_id: unitId }); toast('RKAT dibuka kembali.', 'ok'); viewAnggaran(); } catch (e) { toast(e.message, 'err'); } });
}

// ================= BUKU BESAR =================
async function viewLedger() {
  const postable = state.accounts.filter(a => a.is_postable);
  const accOpt = postable.map(a => `<option value="${a.id}">${esc(a.kode)} — ${esc(a.nama)}</option>`).join('');
  $('#main').innerHTML = `
    <h1 class="page">Buku Besar</h1>
    <div class="subtle">Mutasi & saldo berjalan per akun · ${esc(unitName())}</div>
    <div class="card pad" style="margin-top:18px;">
      <div class="grid" style="grid-template-columns:1fr 160px 160px auto;align-items:end;">
        <div class="field"><label>Akun</label><select class="inp" id="lAcc">${accOpt}</select></div>
        <div class="field"><label>Dari tanggal</label><input class="inp" type="date" id="lFrom"></div>
        <div class="field"><label>Sampai tanggal</label><input class="inp" type="date" id="lTo"></div>
        <button class="btn primary" id="lGo">Tampilkan</button>
      </div>
    </div>
    <div id="ledgerOut" style="margin-top:16px;"></div>`;
  $('#lGo').addEventListener('click', loadLedger);
  async function loadLedger() {
    const accId = $('#lAcc').value; if (!accId) return;
    const q = new URLSearchParams({ account_id: accId });
    if (state.unit !== 'all') q.set('unit', state.unit);
    if ($('#lFrom').value) q.set('from', $('#lFrom').value);
    if ($('#lTo').value) q.set('to', $('#lTo').value);
    const d = await api.get('/api/reports/ledger?' + q.toString());
    const rows = d.rows.map(r => `
      <tr><td>${fmtDate(r.tanggal)}</td><td class="mono" style="color:var(--primary);">${esc(r.nomor || '')}</td>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.deskripsi)}</td>
        <td class="r mono">${r.debit ? fmtNum(r.debit) : ''}</td>
        <td class="r mono">${r.kredit ? fmtNum(r.kredit) : ''}</td>
        <td class="r mono" style="font-weight:700;">${fmtNum(r.saldo)}</td></tr>`).join('');
    $('#ledgerOut').innerHTML = `
      <div class="card tbl-wrap">
        <div style="padding:14px 18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div style="font-weight:800;"><span class="mono" style="color:var(--primary);">${esc(d.account.kode)}</span> — ${esc(d.account.nama)}</div>
          <div class="note">Saldo normal: ${d.account.normal_balance} · Saldo akhir: <b class="mono" style="color:var(--ink);">${fmtRp(d.closing)}</b></div>
        </div>
        <table class="tbl"><thead><tr><th>TANGGAL</th><th>NO. JURNAL</th><th>URAIAN</th><th class="r">DEBIT</th><th class="r">KREDIT</th><th class="r">SALDO</th></tr></thead>
        <tbody>
          <tr><td colspan="5" style="font-weight:700;color:var(--muted2);">Saldo awal</td><td class="r mono" style="font-weight:700;">${fmtNum(d.opening)}</td></tr>
          ${rows || `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">Tidak ada mutasi pada rentang ini.</td></tr>`}
        </tbody>
        <tfoot><tr class="tfoot"><td colspan="3">Jumlah mutasi</td><td class="r mono">${fmtNum(d.totalDebit)}</td><td class="r mono">${fmtNum(d.totalKredit)}</td><td class="r mono">${fmtNum(d.closing)}</td></tr></tfoot>
        </table>
      </div>`;
  }
  loadLedger();
}

// ================= NERACA SALDO =================
async function viewTrialBalance() {
  const q = state.unit === 'all' ? '' : '?unit=' + state.unit;
  const d = await api.get('/api/reports/trial-balance' + q);
  const rows = d.rows.map(r => `
    <tr class="clickable" data-acc="${r.account_id}">
      <td class="mono" style="color:var(--primary);">${esc(r.kode)}</td>
      <td>${esc(r.nama)}${r.is_interunit ? ' <span class="badge reversed">antar-unit</span>' : ''}</td>
      <td class="r mono">${r.debit ? fmtNum(r.debit) : ''}</td>
      <td class="r mono">${r.kredit ? fmtNum(r.kredit) : ''}</td></tr>`).join('')
    || `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px;">Belum ada transaksi terposting.</td></tr>`;

  let iuHtml = '';
  if (state.unit === 'all') {
    const iu = await api.get('/api/reports/interunit-check');
    const iuRows = iu.rows.map(r => `<tr><td class="mono" style="color:var(--primary);">${esc(r.kode)}</td><td>${esc(r.nama)}</td><td class="r mono">${fmtNum(r.net)}</td></tr>`).join('')
      || `<tr><td colspan="3" class="note" style="padding:14px;">Belum ada saldo antar-unit.</td></tr>`;
    iuHtml = `
      <div class="card tbl-wrap" style="margin-top:16px;">
        <div style="padding:14px 18px;border-bottom:1px solid var(--line);font-weight:800;">Pemeriksaan akun antar-unit (eliminasi konsolidasi)</div>
        <table class="tbl"><thead><tr><th>KODE</th><th>AKUN</th><th class="r">SALDO NETO</th></tr></thead><tbody>${iuRows}</tbody>
        <tfoot><tr class="tfoot"><td colspan="2">Total neto (harus 0)</td><td class="r mono">${fmtNum(iu.totalNet)}</td></tr></tfoot></table>
        <div style="padding:12px 18px;">${iu.balanced ? '<div class="ok-box">Saldo antar-unit ter-eliminasi sempurna (= 0).</div>' : '<div class="warn-box">Saldo antar-unit belum nol — periksa pasangan jurnal antar-unit.</div>'}</div>
      </div>`;
  }

  $('#main').innerHTML = `
    <div class="row-between">
      <div><h1 class="page">Neraca Saldo</h1>
        <div class="subtle">${d.konsolidasi ? 'Konsolidasi seluruh unit (setelah eliminasi antar-unit dilaporkan terpisah)' : esc(unitName())}</div></div>
      <div class="pill">${d.balanced ? 'Seimbang ✓' : 'TIDAK seimbang'}</div>
    </div>
    <div class="card tbl-wrap" style="margin-top:18px;">
      <table class="tbl"><thead><tr><th>KODE</th><th>NAMA AKUN</th><th class="r">DEBIT</th><th class="r">KREDIT</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="tfoot"><td colspan="2">TOTAL</td><td class="r mono">${fmtNum(d.totalDebit)}</td><td class="r mono">${fmtNum(d.totalKredit)}</td></tr></tfoot>
      </table>
    </div>
    ${d.balanced ? '' : '<div class="err-box" style="margin-top:12px;">Total debit ≠ total kredit. Ada anomali pada data.</div>'}
    ${iuHtml}`;
  $('#main').querySelectorAll('tr[data-acc]').forEach(tr =>
    tr.addEventListener('click', () => { location.hash = '#/bukubesar'; setTimeout(() => { const s = $('#lAcc'); if (s) { s.value = tr.dataset.acc; $('#lGo').click(); } }, 60); }));
}

// ================= MASTER DATA =================
async function viewMaster(tab) {
  const tabs = [['coa', 'Bagan Akun'], ['unit', 'Unit'], ['periode', 'Periode'], ['pengguna', 'Pengguna']];
  const tabHtml = tabs.map(([k, l]) => `<div class="tab ${k === tab ? 'active' : ''}" onclick="location.hash='#/master/${k}'">${l}</div>`).join('');
  $('#main').innerHTML = `<h1 class="page">Master Data</h1><div class="subtle">Kelola data acuan sistem.</div>
    <div class="tabs">${tabHtml}</div><div id="masterOut"></div>`;
  if (tab === 'coa') return masterCOA();
  if (tab === 'unit') return masterUnit();
  if (tab === 'periode') return masterPeriode();
  if (tab === 'pengguna') return masterPengguna();
}

async function masterCOA() {
  const tree = await api.get('/api/master/accounts/tree');
  function render(nodes, depth) {
    return nodes.map(n => {
      const tags = [];
      if (!n.is_postable) tags.push('<span class="badge draft">induk</span>');
      if (n.is_interunit) tags.push('<span class="badge reversed">antar-unit</span>');
      if (n.is_kontra) tags.push('<span class="badge rejected">kontra</span>');
      if (n.net_asset_class) tags.push(`<span class="badge pending">${n.net_asset_class} pembatasan</span>`);
      return `<div class="tree-row ${n.is_postable ? '' : 'header'}" style="padding-left:${10 + depth * 22}px;">
        <span class="kode">${esc(n.kode)}</span><span style="flex:1;">${esc(n.nama)}</span>${tags.join(' ')}
        <span class="note">${n.normal_balance}</span></div>` + render(n.children || [], depth + 1);
    }).join('');
  }
  $('#masterOut').innerHTML = `
    ${perms.master ? `<div style="margin-bottom:12px;"><button class="btn primary sm" id="addAcc">+ Tambah akun</button></div>` : ''}
    <div class="card">${render(tree, 0)}</div>`;
  const b = $('#addAcc'); if (b) b.addEventListener('click', addAccountModal);
}
function addAccountModal() {
  const parentOpt = '<option value="">(tanpa induk)</option>' +
    state.accounts.map(a => `<option value="${a.id}">${esc(a.kode)} — ${esc(a.nama)}</option>`).join('');
  openModal('Tambah Akun', `
    <div class="grid" style="grid-template-columns:1fr 1fr;">
      <div class="field"><label>Kode <span class="req">*</span></label><input class="inp" id="mKode" placeholder="mis. 5910"></div>
      <div class="field"><label>Nama <span class="req">*</span></label><input class="inp" id="mNama"></div>
      <div class="field"><label>Tipe</label><select class="inp" id="mTipe">
        <option value="aset">Aset</option><option value="liabilitas">Liabilitas</option>
        <option value="aset_neto">Aset Neto</option><option value="pendapatan">Pendapatan</option><option value="beban">Beban</option></select></div>
      <div class="field"><label>Saldo normal</label><select class="inp" id="mNorm"><option value="D">Debit</option><option value="K">Kredit</option></select></div>
      <div class="field"><label>Akun induk</label><select class="inp" id="mParent">${parentOpt}</select></div>
      <div class="field"><label>Dapat dijurnal?</label><select class="inp" id="mPost"><option value="1">Ya (postable)</option><option value="0">Tidak (header)</option></select></div>
      <div class="field"><label>Antar-unit?</label><select class="inp" id="mIU"><option value="0">Tidak</option><option value="1">Ya (eliminasi)</option></select></div>
      <div class="field"><label>Klasifikasi aset neto</label><select class="inp" id="mNAC"><option value="">—</option><option value="tanpa">Tanpa pembatasan</option><option value="dengan">Dengan pembatasan</option></select></div>
    </div>`, async () => {
    await api.post('/api/master/accounts', {
      kode: $('#mKode').value.trim(), nama: $('#mNama').value.trim(), tipe: $('#mTipe').value,
      normal_balance: $('#mNorm').value, parent_id: $('#mParent').value ? +$('#mParent').value : null,
      is_postable: $('#mPost').value === '1', is_interunit: $('#mIU').value === '1',
      net_asset_class: $('#mNAC').value || null,
    });
    state.accounts = await api.get('/api/master/accounts');
    toast('Akun ditambahkan.', 'ok'); masterCOA();
  });
}

async function masterUnit() {
  const units = await api.get('/api/master/units');
  const rows = units.map(u => `<tr><td class="mono" style="color:var(--primary);">${esc(u.kode)}</td><td>${esc(u.nama)}</td>
    <td>${u.is_yayasan ? '<span class="badge pending">pusat</span>' : '<span class="badge draft">unit</span>'}</td>
    <td>${u.aktif ? '<span class="badge open">aktif</span>' : '<span class="badge closed">nonaktif</span>'}</td></tr>`).join('');
  $('#masterOut').innerHTML = `
    ${perms.master ? `<div style="margin-bottom:12px;"><button class="btn primary sm" id="addUnit">+ Tambah unit</button></div>` : ''}
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>KODE</th><th>NAMA</th><th>JENIS</th><th>STATUS</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const b = $('#addUnit'); if (b) b.addEventListener('click', () => openModal('Tambah Unit', `
    <div class="field"><label>Kode <span class="req">*</span></label><input class="inp" id="uKode" placeholder="mis. AKD"></div>
    <div class="field" style="margin-top:12px;"><label>Nama <span class="req">*</span></label><input class="inp" id="uNama"></div>
    <div class="field" style="margin-top:12px;"><label>Unit pusat/yayasan?</label><select class="inp" id="uYys"><option value="0">Tidak</option><option value="1">Ya</option></select></div>`,
    async () => { await api.post('/api/master/units', { kode: $('#uKode').value.trim(), nama: $('#uNama').value.trim(), is_yayasan: $('#uYys').value === '1' });
      state.units = await api.get('/api/master/units'); renderShell(); toast('Unit ditambahkan.', 'ok'); route(); }));
}

async function masterPeriode() {
  const periods = await api.get('/api/master/periods');
  const rows = periods.map(p => `<tr>
    <td class="mono">${p.tahun}-${String(p.bulan).padStart(2, '0')}</td>
    <td>${MONTHS[p.bulan]} ${p.tahun}</td>
    <td>${p.status === 'open' ? '<span class="badge open">terbuka</span>' : '<span class="badge closed">tertutup</span>'}</td>
    <td class="note">${p.closed_by_nama ? 'oleh ' + esc(p.closed_by_nama) : ''}</td>
    <td class="r">${perms.period ? (p.status === 'open'
      ? `<button class="btn sm danger" data-close="${p.id}">Tutup</button>`
      : `<button class="btn sm outline" data-reopen="${p.id}">Buka kembali</button>`) : ''}</td></tr>`).join('');
  $('#masterOut').innerHTML = `
    ${perms.period ? `<div style="margin-bottom:12px;"><button class="btn primary sm" id="addPer">+ Tambah periode</button></div>` : ''}
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>KODE</th><th>PERIODE</th><th>STATUS</th><th>PENUTUP</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note" style="margin-top:10px;">Periode tertutup menolak posting jurnal baru (dicek di backend).</div>`;
  $('#masterOut').querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Tutup periode ini? Posting baru akan ditolak.')) return;
    try { await api.post('/api/master/periods/' + b.dataset.close + '/close'); toast('Periode ditutup.', 'ok'); masterPeriode(); } catch (e) { toast(e.message, 'err'); }
  }));
  $('#masterOut').querySelectorAll('[data-reopen]').forEach(b => b.addEventListener('click', async () => {
    try { await api.post('/api/master/periods/' + b.dataset.reopen + '/reopen'); toast('Periode dibuka kembali.', 'ok'); masterPeriode(); } catch (e) { toast(e.message, 'err'); }
  }));
  const a = $('#addPer'); if (a) a.addEventListener('click', () => openModal('Tambah Periode', `
    <div class="grid" style="grid-template-columns:1fr 1fr;">
      <div class="field"><label>Tahun</label><input class="inp" id="pTahun" type="number" value="2026"></div>
      <div class="field"><label>Bulan (1-12)</label><input class="inp" id="pBulan" type="number" min="1" max="12" value="1"></div>
    </div>`, async () => { await api.post('/api/master/periods', { tahun: +$('#pTahun').value, bulan: +$('#pBulan').value }); toast('Periode ditambahkan.', 'ok'); masterPeriode(); }));
}

async function masterPengguna() {
  if (!perms.master) { $('#masterOut').innerHTML = '<div class="err-box">Anda tidak berwenang melihat data pengguna.</div>'; return; }
  const users = await api.get('/api/master/users');
  const rows = users.map(u => `<tr><td>${esc(u.nama)}</td><td class="note">${esc(u.email)}</td>
    <td><span class="badge draft">${esc(u.role)}</span></td><td>${esc(u.unit_nama || '—')}</td>
    <td>${u.aktif ? '<span class="badge open">aktif</span>' : '<span class="badge closed">nonaktif</span>'}</td></tr>`).join('');
  $('#masterOut').innerHTML = `
    ${perms.admin ? `<div style="margin-bottom:12px;"><button class="btn primary sm" id="addUser">+ Tambah pengguna</button></div>` : ''}
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>NAMA</th><th>EMAIL</th><th>PERAN</th><th>UNIT</th><th>STATUS</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const b = $('#addUser'); if (b) b.addEventListener('click', () => {
    const roleOpt = ['admin', 'staf_akuntansi', 'kasir', 'bendahara', 'kepala_unit', 'pengurus_yayasan'].map(r => `<option value="${r}">${r}</option>`).join('');
    const unitOpt = '<option value="">(lintas unit)</option>' + state.units.map(u => `<option value="${u.id}">${esc(u.nama)}</option>`).join('');
    openModal('Tambah Pengguna', `
      <div class="grid" style="grid-template-columns:1fr 1fr;">
        <div class="field"><label>Nama</label><input class="inp" id="nNama"></div>
        <div class="field"><label>Email</label><input class="inp" id="nEmail"></div>
        <div class="field"><label>Kata sandi</label><input class="inp" id="nPass" type="text" value="sikeu123"></div>
        <div class="field"><label>Peran</label><select class="inp" id="nRole">${roleOpt}</select></div>
        <div class="field"><label>Unit</label><select class="inp" id="nUnit">${unitOpt}</select></div>
      </div>`, async () => {
      await api.post('/api/master/users', { nama: $('#nNama').value.trim(), email: $('#nEmail').value.trim(), password: $('#nPass').value, role: $('#nRole').value, unit_id: $('#nUnit').value ? +$('#nUnit').value : null });
      toast('Pengguna ditambahkan.', 'ok'); masterPengguna();
    });
  });
}

// ================= ADMINISTRASI (Tutup Buku & Backup) =================
async function viewAdmin(tab) {
  const tabs = [['tutupbuku', 'Tutup Buku Tahunan'], ['backup', 'Backup Database']];
  const tabHtml = tabs.filter(([k]) => k !== 'backup' || perms.backup)
    .map(([k, l]) => `<div class="tab ${k === tab ? 'active' : ''}" onclick="location.hash='#/admin/${k}'">${l}</div>`).join('');
  $('#main').innerHTML = `<h1 class="page">Administrasi</h1><div class="subtle">Tutup buku tahunan & pemeliharaan basis data.</div>
    <div class="tabs">${tabHtml}</div><div id="admOut"></div>`;
  if (tab === 'backup' && perms.backup) return admBackup();
  return admClosing();
}

let closingYear = new Date().getUTCFullYear();
async function admClosing() {
  const d = await api.get('/api/admin/closing?tahun=' + closingYear);
  const anyClosed = d.units.some(u => u.sudahDitutup);
  const yearOpt = [2025, 2026, 2027].map(y => `<option value="${y}" ${y === closingYear ? 'selected' : ''}>${y}</option>`).join('');
  const rows = d.units.map(u => `<tr>
    <td style="font-weight:700;">${esc(u.unit_nama)}</td>
    <td class="r mono">${fmtNum(u.pendapatan)}</td>
    <td class="r mono">${fmtNum(u.beban)}</td>
    <td class="r mono" style="font-weight:700;color:${u.surplus >= 0 ? 'var(--green)' : 'var(--red)'};">${fmtNum(u.surplus)}</td>
    <td class="r mono note">${fmtNum(u.surplusTanpa)}</td>
    <td class="r mono note">${fmtNum(u.surplusDengan)}</td>
    <td>${u.sudahDitutup ? '<span class="badge closed">ditutup</span>' : (u.adaAktivitas ? '<span class="badge open">siap</span>' : '<span class="badge draft">—</span>')}</td></tr>`).join('');
  $('#admOut').innerHTML = `
    <div class="card pad" style="margin-top:14px;">
      <div class="grid" style="grid-template-columns:auto 1fr auto;align-items:end;">
        <div class="field"><label>Tahun buku</label><select class="inp" id="clYear">${yearOpt}</select></div>
        <div class="note">Tutup buku memindahkan surplus/defisit ke <b>Aset Neto</b> (tanpa pembatasan → 3100, dengan pembatasan → 3200) dan <b>mengunci seluruh periode</b> tahun tsb.</div>
        <div style="display:flex;gap:8px;">
          ${!anyClosed && perms.closing ? `<button class="btn green" id="clRun">Tutup buku ${closingYear}</button>` : ''}
          ${anyClosed && perms.reopenYear ? `<button class="btn gold" id="clReopen">Batalkan tutup buku</button>` : ''}
        </div>
      </div>
    </div>
    <div class="card tbl-wrap" style="margin-top:16px;">
      <table class="tbl" style="min-width:760px;"><thead><tr><th>UNIT</th><th class="r">PENDAPATAN</th><th class="r">BEBAN</th><th class="r">SURPLUS</th><th class="r">→ TANPA</th><th class="r">→ DENGAN</th><th>STATUS</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
    ${anyClosed ? `<div class="warn-box" style="margin-top:12px;">Tahun ${closingYear} sudah ditutup. Jurnal penutup telah dibuat dan periode dikunci. Batalkan hanya bila diperlukan (membuat jurnal balik).</div>` : ''}`;
  $('#clYear').addEventListener('change', e => { closingYear = +e.target.value; admClosing(); });
  const run = $('#clRun'); if (run) run.addEventListener('click', async () => {
    if (!confirm(`Tutup buku tahun ${closingYear}? Ini membuat jurnal penutup per unit dan MENGUNCI seluruh periode ${closingYear}.`)) return;
    try { const r = await api.post('/api/admin/closing/run', { tahun: closingYear });
      const msg = r.results.filter(x => x.journal).map(x => `${x.unit}: ${x.journal}`).join(', ') || 'tidak ada aktivitas';
      toast('Tutup buku selesai — ' + msg, 'ok'); admClosing();
    } catch (e) { toast(e.message, 'err'); }
  });
  const reo = $('#clReopen'); if (reo) reo.addEventListener('click', async () => {
    if (!confirm(`Batalkan tutup buku ${closingYear}? Jurnal penutup akan dibalik dan periode dibuka kembali.`)) return;
    try { const r = await api.post('/api/admin/closing/reopen', { tahun: closingYear }); toast(`Tutup buku dibatalkan (${r.dibatalkan} jurnal dibalik).`, 'ok'); admClosing(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

async function admBackup() {
  const list = await api.get('/api/admin/backups');
  const rows = list.map(b => `<tr>
    <td class="mono" style="font-weight:700;">${esc(b.name)}</td>
    <td class="note">${fmtDate(b.mtime.slice(0, 10))} ${b.mtime.slice(11, 16)}</td>
    <td class="r">${(b.size / 1024).toLocaleString('id', { maximumFractionDigits: 0 })} KB</td>
    <td class="r"><a class="btn sm outline" href="/api/admin/backups/${encodeURIComponent(b.name)}/download">Unduh</a></td></tr>`).join('')
    || '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px;">Belum ada backup.</td></tr>';
  $('#admOut').innerHTML = `
    <div class="card pad" style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div class="note">Backup dibuat otomatis saat server mulai & setiap hari (14 terakhir disimpan). Anda juga dapat membuat backup manual.</div>
      <button class="btn primary" id="bkNow">Backup sekarang</button>
    </div>
    <div class="card tbl-wrap" style="margin-top:16px;">
      <table class="tbl"><thead><tr><th>NAMA BERKAS</th><th>WAKTU</th><th class="r">UKURAN</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  $('#bkNow').addEventListener('click', async () => {
    try { const r = await api.post('/api/admin/backups'); toast('Backup dibuat: ' + r.name, 'ok'); admBackup(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

// ================= AUDIT =================
let auditFilter = { entity: '', action: '', q: '' };
async function viewAudit() {
  const q = new URLSearchParams({ limit: 300 });
  Object.entries(auditFilter).forEach(([k, v]) => { if (v) q.set(k, v); });
  const d = await api.get('/api/reports/audit?' + q.toString());
  const opt = (arr, sel) => '<option value="">semua</option>' + arr.map(a => `<option value="${a}" ${a === sel ? 'selected' : ''}>${a}</option>`).join('');
  const body = d.rows.map(r => `<tr><td class="note">${esc(r.ts)}</td><td>${esc(r.user_nama || '')}</td>
    <td>${r.role ? '<span class="note">' + esc(r.role) + '</span>' : ''}</td>
    <td><span class="badge draft">${esc(r.action)}</span></td><td>${esc(r.entity)} ${r.entity_id ? '#' + esc(r.entity_id) : ''}</td>
    <td class="note" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.detail || '')}</td></tr>`).join('')
    || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">Tidak ada aktivitas sesuai filter.</td></tr>';
  $('#main').innerHTML = `<h1 class="page">Jejak Audit</h1><div class="subtle">${d.rows.length} aktivitas (maks 300)</div>
    <div class="card pad" style="margin-top:14px;">
      <div class="grid" style="grid-template-columns:1fr 1fr 2fr;">
        <div class="field"><label>Entitas</label><select class="inp" id="afEntity">${opt(d.entities, auditFilter.entity)}</select></div>
        <div class="field"><label>Aksi</label><select class="inp" id="afAction">${opt(d.actions, auditFilter.action)}</select></div>
        <div class="field"><label>Cari (pengguna / detail)</label><input class="inp" id="afQ" value="${esc(auditFilter.q)}" placeholder="ketik lalu Enter"></div>
      </div>
    </div>
    <div class="card tbl-wrap" style="margin-top:16px;"><table class="tbl" style="min-width:860px;">
      <thead><tr><th>WAKTU</th><th>PENGGUNA</th><th>PERAN</th><th>AKSI</th><th>ENTITAS</th><th>DETAIL</th></tr></thead><tbody>${body}</tbody></table></div>`;
  $('#afEntity').addEventListener('change', e => { auditFilter.entity = e.target.value; viewAudit(); });
  $('#afAction').addEventListener('change', e => { auditFilter.action = e.target.value; viewAudit(); });
  $('#afQ').addEventListener('keydown', e => { if (e.key === 'Enter') { auditFilter.q = e.target.value.trim(); viewAudit(); } });
}

// ================= Modal =================
function openModal(title, bodyHtml, onSubmit) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(36,30,51,.42);display:flex;align-items:center;justify-content:center;z-index:80;padding:20px;';
  wrap.innerHTML = `<div class="card pad" style="width:100%;max-width:560px;max-height:90vh;overflow:auto;">
    <div style="font-size:17px;font-weight:800;margin-bottom:14px;">${esc(title)}</div>
    <div>${bodyHtml}</div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
      <button class="btn" id="mCancel">Batal</button><button class="btn primary" id="mOk">Simpan</button></div></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  $('#mCancel', wrap).addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  $('#mOk', wrap).addEventListener('click', async () => {
    try { await onSubmit(); close(); } catch (e) { toast(e.message, 'err'); }
  });
}

// ================= Icons =================
function iconDash() { return svg('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'); }
function iconDoc() { return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>'); }
function iconBook() { return svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'); }
function iconChart() { return svg('<line x1="4" y1="20" x2="20" y2="20"/><rect x="5" y="11" width="3" height="7" rx="0.5"/><rect x="10.5" y="6" width="3" height="12" rx="0.5"/><rect x="16" y="14" width="3" height="4" rx="0.5"/>'); }
function iconDb() { return svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'); }
function iconShield() { return svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'); }
function iconWallet() { return svg('<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20"/><path d="M16 14h2"/>'); }
function iconGrad() { return svg('<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>'); }
function iconBudget() { return svg('<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/>'); }
function iconReport() { return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/>'); }
function iconTax() { return svg('<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2-3 2z"/><line x1="15" y1="9" x2="9" y2="15"/><circle cx="9.5" cy="9.5" r="1"/><circle cx="14.5" cy="14.5" r="1"/>'); }
function iconGear() { return svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'); }
function iconBuilding() { return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3F2A68" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-4h6v4"/></svg>`; }
function svg(inner) { return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`; }
