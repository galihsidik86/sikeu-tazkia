# SIKEU Tazkia — Sistem Informasi Keuangan & Akuntansi

![Status](https://img.shields.io/badge/status-selesai%20(Fase%201–7)-2E1E4F)
![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pg-4169E1?logo=postgresql&logoColor=white)
![Tests](https://img.shields.io/badge/tests-42%20lulus-brightgreen)
![Bahasa](https://img.shields.io/badge/UI-Bahasa%20Indonesia-C9A227)
![Standar](https://img.shields.io/badge/standar-ISAK%2035%20·%20PSAK%2072-3F2A68)

Aplikasi pembukuan **multi-unit dengan konsolidasi** untuk Yayasan Tazkia Cendikia
(unit: **Yayasan Pusat**, **STMIK Tazkia**, **Universitas Tazkia**). Dibangun dengan
Node.js + Express + **PostgreSQL** (driver `pg`), frontend HTML + vanilla JS, autentikasi
berbasis sesi (bcrypt). Seluruh antarmuka Bahasa Indonesia, format angka `Rp 1.250.000,00`.
Nilai uang disimpan sebagai `BIGINT` sen (bebas galat pembulatan).

> **Status: SELESAI — FASE 1–6 lengkap + FASE 7 (integrasi pajak).**
> - **Fase 1** — auth & peran, master data (COA, unit, periode, pengguna), jurnal umum
>   (draft → ajukan → posting → jurnal balik) dengan validasi backend, buku besar,
>   neraca saldo per unit & konsolidasi.
> - **Fase 2** — modul **Kas & Bank**: rekening + saldo berjalan; form penerimaan/pengeluaran
>   yang dipakai **kasir tanpa paham debit/kredit** — pilih **kategori** (mapping kategori→akun
>   dikelola admin), jurnal dibentuk **berstatus pending** untuk **disetujui bendahara**;
>   **rekonsiliasi bank** via import CSV **dengan pemetaan kolom fleksibel** dan **auto-match
>   nominal sama + tanggal ±3 hari**, sisanya cocokkan manual.
> - **Fase 3** — modul **Piutang UKT**: master mahasiswa, **generate tagihan massal**
>   (D Piutang / K Pendapatan Diterima di Muka), pembayaran/cicilan, **aging report**,
>   **CKPN per bucket umur dengan tarif dikonfigurasi admin** (default 0/5/10/25/50%) yang
>   jurnal penyesuaiannya **dibuat sebagai draft untuk direview**, dan **pengakuan pendapatan
>   PSAK 72** (deferred → amortisasi bulanan proporsional).
> - **Fase 4** — modul **Anggaran RKAT**: penyusunan pos anggaran per unit, alur
>   **draft → diajukan → disahkan**, laporan **realisasi vs anggaran** (bar % dengan
>   peringatan >80%), dan **blokir posting beban yang melampaui pagu** RKAT disahkan
>   (dengan opsi override untuk approver).
> - **Fase 5** — **Laporan Keuangan ISAK 35**: Posisi Keuangan, Penghasilan Komprehensif,
>   Perubahan Aset Neto (kolom tanpa/dengan pembatasan), dan Arus Kas (metode tidak
>   langsung) — per unit atau **konsolidasi dengan eliminasi antar-unit**; **export PDF**
>   (cetak) dan **export Excel**.
> - **Fase 6** — **Dashboard eksekutif** (KPI konsolidasi, kas per unit, umur piutang,
>   serapan anggaran YTD, **tren penerimaan 12 bulan**), **audit log viewer** dengan filter,
>   **backup database harian otomatis dengan retensi 30 hari**, dan **tutup buku tahunan**
>   (closing entries surplus → Aset Neto tanpa/dengan pembatasan, mengunci seluruh periode;
>   dapat dibatalkan via jurnal balik).
> - **Fase 7** — **Integrasi Pajak (PPh 21 & PPh 23)**: tarif dapat dikonfigurasi,
>   **pemotongan otomatis** saat bayar honor/jasa (auto-jurnal `D Objek / K Utang PPh / K Kas`),
>   **bukti potong**, **rekap masa** per jenis, dan **penyetoran** (`D Utang PPh / K Kas`).

---

## 1. Menjalankan aplikasi

Prasyarat: **Node.js 18+** (teruji di Node 24) dan **PostgreSQL 12+**.

**1) Siapkan database PostgreSQL.** Buat database & user, atau pakai Docker:

```bash
# Opsi Docker (contoh; sesuaikan port bila 5432 sudah dipakai):
docker run -d --name sikeu-pg -e POSTGRES_USER=sikeu -e POSTGRES_PASSWORD=sikeu \
  -e POSTGRES_DB=sikeu -p 5432:5432 postgres:16-alpine
```

**2) Konfigurasi & jalankan:**

```bash
npm install                       # instal dependensi (sekali saja)
cp .env.example .env              # lalu set DATABASE_URL sesuai server Postgres Anda
npm run reset                     # buat skema + isi seed (COA, user, jurnal contoh)
npm start                         # jalankan server
```

Buka **http://127.0.0.1:3000** di browser. `DATABASE_URL` di `.env`, mis.
`postgres://sikeu:sikeu@127.0.0.1:5432/sikeu`.

Perintah lain:

| Perintah         | Fungsi                                             |
|------------------|----------------------------------------------------|
| `npm run migrate`| Buat/segarkan skema (`-- --fresh` = DROP & buat ulang) |
| `npm run seed`   | Isi ulang data awal (TRUNCATE lalu isi)            |
| `npm run reset`  | `migrate --fresh` + `seed` (mulai dari nol)        |
| `npm test`       | Uji aturan akuntansi kritis (butuh DB `sikeu_test`; `createdb sikeu_test`) |
| `npm run dev`    | Jalankan server dengan auto-reload                 |

> **Catatan multi-user & backup:** PostgreSQL menangani banyak penulis serentak (cocok untuk
> pemakaian bersama). Backup otomatis harian berupa snapshot logis semua tabel (JSON gzip) di
> `data/backups/` dengan retensi 30 hari; untuk produksi, disarankan juga `pg_dump` terjadwal.

### Akun demo (kata sandi semua: `sikeu123`)

| Email                          | Peran             | Wewenang utama                        |
|--------------------------------|-------------------|---------------------------------------|
| `admin1@tazkia.ac.id`          | Administrator     | Semua, termasuk kelola pengguna       |
| `stafakuntansi1@tazkia.ac.id`  | Staf Akuntansi    | Buat/edit draft, ajukan, master data  |
| `bendahara1@tazkia.ac.id`      | Bendahara         | **Setujui & posting**, jurnal balik   |
| `pengurusyayasan1@tazkia.ac.id`| Pengurus Yayasan  | Setujui, baca semua unit              |

(Tersedia 3 pengguna per peran: `kasir1..3`, `kepalaunit1..3`, dst.)

---

## 2. Aturan akuntansi yang ditegakkan di backend

Bukan sekadar konvensi — semua diperiksa di server dalam transaksi database atomik:

1. **Double-entry ketat** — jurnal tak balance **ditolak** saat diajukan/diposting.
2. **Immutability** — jurnal `Diposting` tidak bisa diedit/dihapus; koreksi via **jurnal balik**.
3. **Kunci periode** — posting ke periode `closed` ditolak.
4. **Dimensi wajib** — setiap baris wajib `unit_id`. Akun **antar-unit** dieliminasi saat konsolidasi (dicek harus nol).
5. **Audit trail** — `audit_log` mencatat create/update/submit/approve/post/reject/reverse/close.
6. **Aset neto ISAK 35** — ekuitas dipecah *Tanpa* / *Dengan Pembatasan*; sumbangan terikat masuk klasifikasi "dengan pembatasan" sejak jurnal (akun `4300`).

---

## 3. Skenario tes manual (langkah demi langkah)

Login sebagai **Staf Akuntansi** (`stafakuntansi1@tazkia.ac.id`) kecuali disebut lain.

### A. Alur jurnal normal (draft → ajukan → posting)
1. Menu **Jurnal Umum → + Buat jurnal**.
2. Isi Tanggal `2026-07-10`, Unit `STMIK Tazkia`, Deskripsi `Pembayaran ATK Juli`.
3. Baris 1: akun `5400 — Beban Operasional`, unit STMIK, **Debit** `1.500.000`.
4. Baris 2: akun `1111 — Kas Besar`, unit STMIK, **Kredit** `1.500.000`.
5. Perhatikan badge **Balance** muncul (tombol *Ajukan* aktif). Klik **Ajukan persetujuan**.
   → Jurnal mendapat nomor otomatis `JU/STM/2026-07/xxxx` dan status **Menunggu**.
6. **Logout**, login sebagai **Bendahara**. Buka jurnal tadi → **Setujui & posting**.
   → Status menjadi **Diposting**, tercatat di *Riwayat dokumen*.

### B. Jurnal tidak balance DITOLAK (aturan #1)
1. Buat jurnal baru: Debit `100.000` pada satu akun, Kredit `90.000` pada akun lain.
2. Tombol **Ajukan** nonaktif (selisih tampak). Simpan sebagai draft, buka detailnya, klik Ajukan → **backend menolak** dengan pesan "Jurnal tidak balance …".

### C. Jurnal terposting tidak bisa diubah (aturan #2)
1. Buka jurnal berstatus **Diposting**. Tidak ada tombol *Ubah*/*Hapus*, hanya **Buat jurnal balik**.
2. (Uji backend) `PUT /api/journals/:id` pada jurnal posted → ditolak `409`.

### D. Jurnal balik / reversal (aturan #2)
1. Pada jurnal **Diposting** (sbg Bendahara), klik **Buat jurnal balik**.
   → Terbentuk jurnal baru terposting dengan Debit/Kredit **tertukar**, mereferensikan jurnal asal.
   → Jurnal asal berubah status menjadi **Dibalik**. Neraca saldo kembali seperti sebelum jurnal asal.

### E. Kunci periode (aturan #3)
1. Menu **Master Data → Periode**. Periode **2025-12** sudah **tertutup** (contoh seed).
2. Buat jurnal baru bertanggal `2025-12-20` lalu **Ajukan** → **ditolak**: "Periode 2025-12 sudah ditutup".
3. (Sbg Bendahara/Pengurus) coba **Tutup** periode `Juli 2026`. Bila masih ada draft/pending, sistem menolak sampai diselesaikan.

### F. Konsolidasi & eliminasi antar-unit (aturan #4)
1. Menu **Neraca Saldo**. Di pojok kanan atas pilih unit **STMIK Tazkia** → hanya saldo STMIK.
2. Pilih **Konsolidasi — semua unit** → seluruh unit digabung; muncul tabel **Pemeriksaan akun antar-unit** yang harus bersaldo **0** (data seed sudah seimbang: Piutang Antar-Unit YYS ⇄ Utang Antar-Unit STM).

### G. Buku besar
1. Menu **Buku Besar**, pilih akun `1121 — Bank Mandiri UKT STMIK`, unit STMIK → saldo berjalan Rp 120.000.000,00 dari pembayaran UKT contoh.

### H. Jejak audit
1. Login **admin1**, menu **Jejak Audit** → lihat semua aktivitas (login, create, submit, approve, post, reverse, close).

### I. Kas & Bank — penerimaan oleh kasir (alur persetujuan) — Fase 2
1. Login sebagai **Kasir** (`kasir1@tazkia.ac.id`). Menu **Kas & Bank → Penerimaan kas**.
2. Pilih rekening `Bank Mandiri — UKT STMIK`, **kategori** `Pembayaran UKT mahasiswa`, jumlah `5.000.000`.
   Panel kanan menampilkan pratinjau jurnal (D Bank Mandiri / K Piutang UKT) dan catatan bahwa jurnal berstatus **menunggu persetujuan bendahara**.
3. Klik **Ajukan penerimaan** → jurnal dibuat **berstatus pending**. Cek tab **Rekening & saldo**: saldo Bank Mandiri **belum berubah** (pending belum memengaruhi buku).
4. **Logout**, login **Bendahara** (`bendahara1@tazkia.ac.id`). Menu **Jurnal Umum** → buka jurnal pending tadi → **Setujui & posting**. Saldo Bank Mandiri kini bertambah Rp 5.000.000.

### J. Kas & Bank — pengeluaran
1. Tab **Pengeluaran kas** (Kasir): rekening `Bank Mandiri`, kategori `Listrik, air & internet`, jumlah `2.000.000` → **Ajukan**. Jurnal (D Beban / K Bank) menjadi **pending**; bendahara menyetujui untuk memposting.

### J2. Kelola kategori kas (admin/staf)
1. Tab **Kategori** (muncul untuk admin/staf) → daftar **kategori penerimaan & pengeluaran** beserta akun yang dipetakan. Tambah/hapus kategori dan petakan ke akun buku besar. Kasir hanya melihat nama kategori, tidak perlu tahu akunnya.

### K. Rekonsiliasi bank (import CSV + pemetaan kolom)
1. Login **Staf Akuntansi**. Tab **Rekonsiliasi bank**, pilih `Bank Mandiri — UKT STMIK`.
2. Klik **Import CSV mutasi** → pilih file (kolom **bebas**; contoh `public/contoh-mutasi.csv`). Muncul **dialog pemetaan kolom**: petakan kolom berkas ke *Tanggal / Keterangan / Debit (uang masuk) / Kredit (uang keluar)* — sistem menebak otomatis, dan menampilkan contoh baris. Klik **Simpan**.
3. Sistem mengimpor & **mencocokkan otomatis** berdasarkan **nominal sama dan selisih tanggal ≤ 3 hari** (mis. mutasi bank 07 Jun cocok dengan catatan buku 05 Jun). Baris tanpa padanan tetap **kuning**.
4. Tindak lanjut baris kuning: pencocokan manual, atau buat jurnal penyesuaian lalu **Cocokkan otomatis**.

### L. Piutang UKT — master & tagihan massal — Fase 3
1. Login **Staf Akuntansi**. Menu **Piutang UKT → Mahasiswa** → 6 mahasiswa contoh (3 STMIK, 3 Universitas). Tambah bila perlu.
2. Tab **Generate tagihan massal**: pilih unit, semester `2026 Ganjil`, nominal `9.000.000`, jatuh tempo, tenor `6`. Panel **Pratinjau** menampilkan jumlah mahasiswa & total. Klik **Generate** → tagihan terbit + jurnal `(D) Piutang UKT — (K) Pendapatan Diterima di Muka` (PSAK 72) diposting per unit.

### M. Pembayaran / cicilan
1. Tab **Daftar tagihan** → pada baris mahasiswa, klik **Catat bayar**. Masukkan jumlah (boleh **cicilan sebagian**), rekening penerima, metode → **Simpan**.
   Sistem memposting `(D) Rekening — (K) Piutang UKT`, memperbarui *Terbayar/Sisa*, dan status jadi **Sebagian**/**Lunas**. Membayar melebihi sisa **ditolak**.

### N. Aging & CKPN (tarif dikonfigurasi + jurnal draft)
1. Tab **Aging & CKPN** → tabel 5 kelompok umur (belum jatuh tempo, 1–30, 31–60, 61–90, >90 hari) dengan **saldo, % cadangan, dan nilai CKPN**, plus rincian per tagihan. Data seed sengaja bertanggal-tempo bervariasi agar semua bucket terisi.
2. **Tarif CKPN dapat dikonfigurasi admin/staf** — default **0% / 5% / 10% / 25% / 50%**. Ubah nilai persen langsung di kartu *Tarif CKPN* (tekan Enter untuk simpan); tabel & total CKPN langsung mengikuti.
3. Klik **Buat draft penyesuaian CKPN** → sistem membuat **jurnal DRAFT** per unit `(D) Beban CKPN — (K) CKPN Piutang (1139)` ke tingkat cadangan yang dibutuhkan. Jurnal **belum memengaruhi buku** sampai ditinjau & disetujui di **Jurnal Umum** (alur review).

### O. Pengakuan pendapatan (PSAK 72 / amortisasi)
1. Tab **Pengakuan pendapatan** → pilih bulan/tahun (mis. Juli 2026). Pratinjau menampilkan jumlah tagihan & total pengakuan (porsi = nominal ÷ tenor).
2. Klik **Proses pengakuan pendapatan** → jurnal `(D) Pendapatan Diterima di Muka — (K) Pendapatan UKT` per unit. Bulan yang **sudah diproses tidak dihitung ulang** (dicek di backend).

### P. Anggaran RKAT — realisasi vs anggaran — Fase 4
1. Login **Staf/Bendahara**. Pilih unit **STMIK Tazkia** di kanan atas, menu **Anggaran (RKAT)**.
2. Laporan menampilkan tiap pos: **anggaran, realisasi, sisa, dan bar % terpakai**. Pos **Honor Dosen LB** sengaja ~**85,7%** → bar & label **kuning** (peringatan >80%), dengan banner peringatan di atas tabel.
3. Pilih **Konsolidasi — semua unit** untuk melihat gabungan seluruh unit (baca saja).

### Q. Penyusunan & pengesahan RKAT
1. Pilih unit + tahun **2027** (masih kosong/draft). Klik **+ Tambah pos**, pilih akun beban & nominal. Nominal bisa diedit langsung di tabel saat status **Draft**.
2. Klik **Ajukan RKAT** (Draft → Diajukan). Login **Pengurus Yayasan** (`pengurusyayasan1@…`) → **Sahkan RKAT** (Diajukan → Disahkan). Setelah disahkan, tabel terkunci; approver dapat **Buka kembali ke draft** untuk revisi.

### R. Blokir posting melebihi pagu
1. RKAT 2026 STMIK sudah **disahkan** dengan pagu Honor Dosen LB Rp 45.000.000 (realisasi Rp 40.000.000 → ~89% waspada).
2. Buat **Jurnal Umum** beban `5300 — Honor Dosen LB` STMIK sebesar `6.000.000`, ajukan, lalu (sbg Bendahara) **Setujui**. Sistem **menolak** (`melampaui pagu … realisasi menjadi Rp 46.000.000`).
3. Muncul konfirmasi **"Tetap setujui dan lampaui pagu?"** — approver dapat memaksa posting (tercatat di audit).

### S. Laporan Keuangan ISAK 35 — Fase 5
1. Menu **Laporan Keuangan**. Pilih **Jenis laporan** dan **tanggal**; unit diambil dari pemilih di kanan atas.
   - **Laporan Posisi Keuangan** — Aset = Liabilitas + Aset Neto (Tanpa/Dengan Pembatasan). Selalu **seimbang**.
   - **Penghasilan Komprehensif** — Pendapatan (tanpa/dengan pembatasan) − Beban = Surplus/Defisit.
   - **Perubahan Aset Neto** — kolom **Tanpa Pembatasan / Dengan Pembatasan / Jumlah** (saldo awal → surplus → saldo akhir).
   - **Arus Kas** — metode **tidak langsung** (operasi/investasi/pendanaan), tie-out ke perubahan kas.
2. Pilih **Konsolidasi — semua unit** → akun **antar-unit tereliminasi** (mis. Piutang/Utang Antar-Unit tidak muncul). Bandingkan dengan satu unit yang memunculkannya.
3. **Export PDF** membuka dialog cetak (dokumen berkop; sidebar & kontrol otomatis disembunyikan). **Export Excel** mengunduh berkas `.xls`.

### T. Dashboard eksekutif — Fase 6
1. Menu **Dashboard** menampilkan KPI konsolidasi (aset, kas, aset neto, surplus, piutang beredar + CKPN, **serapan anggaran %**, mahasiswa aktif, antrean persetujuan), tabel **kinerja per unit**, grafik **umur piutang**, dan status pembukuan.

### U. Jejak audit dengan filter
1. Login **admin1**. Menu **Jejak Audit** → saring per **entitas**, **aksi**, atau kata kunci pengguna/detail.

### V. Backup database
1. Menu **Administrasi → Backup Database** (admin). Backup file SQLite dibuat **otomatis** saat server mulai & **harian**, dengan **retensi 30 hari** (backup >30 hari otomatis dihapus) di `data/backups/`. Klik **Backup sekarang** untuk manual, atau **Unduh** untuk mengambil berkas `.db`.

### W. Tutup buku tahunan (closing)
1. Menu **Administrasi → Tutup Buku Tahunan**. Pilih tahun → tabel menampilkan surplus per unit dan alokasinya ke aset neto **Tanpa/Dengan Pembatasan**.
2. Klik **Tutup buku 2026** → sistem membuat **jurnal penutup per unit** (`D Pendapatan / C Beban / C Aset Neto`) yang menolkan pendapatan & beban dan memindahkan surplus ke Aset Neto (sumbangan terikat → 3200), lalu **mengunci seluruh 12 periode** tahun itu. Posting baru ke tahun tsb ditolak.
3. Bila perlu revisi, **Batalkan tutup buku** (admin/pengurus) membalik jurnal penutup dan membuka kembali periode.

### Q2. Export laporan realisasi RKAT (monev / akreditasi LAM-INFOKOM)
1. Di menu **Anggaran (RKAT)** (pilih unit/tahun): klik **Export Excel** → unduh `.xls` berisi realisasi **per pos** (unit, kode, pos, anggaran, realisasi, sisa, %). Klik **Cetak / PDF** → dokumen berkop untuk lampiran monev/akreditasi.

### S2. Validasi antar-unit pada laporan konsolidasi
1. Di **Laporan Keuangan** pilih **Konsolidasi**. Bila saldo akun antar-unit **tidak nol** (pasangan jurnal antar-unit tak lengkap), muncul **peringatan dengan rincian selisih per akun** di atas dokumen. Saat seimbang, tidak ada peringatan.

### T2. Dashboard — tren penerimaan 12 bulan
1. Menu **Dashboard** menampilkan grafik batang **tren penerimaan (pendapatan) 12 bulan terakhir**, di samping saldo kas per unit, piutang + aging, dan realisasi anggaran YTD.

### X. Pajak — pemotongan PPh 21 / PPh 23 — Fase 7
1. Menu **Pajak (PPh) → Pemotongan**. Contoh seed: honor dosen Dr. Hendra (PPh 21) & jasa CV Solusi Digital (PPh 23).
2. Isi form: pilih **tarif** (PPh 21 Honor 5% / PPh 23 Jasa 2%), unit, akun objek (mis. `5300 Honor`), rekening pembayar, nama/NPWP penerima, dan **bruto/DPP**. Panel kanan menghitung **pajak & neto** serta pratinjau jurnal `(D) Objek — (K) Utang PPh — (K) Kas (neto)`. Klik **Simpan & potong** → jurnal diposting otomatis + **nomor bukti potong** dibuat. Klik **Bukti potong** untuk melihat slipnya.

### Y. Rekap masa & setor pajak
1. Tab **Rekap & Setor** → pilih masa (mis. Juli 2026). Kartu PPh 21 & PPh 23 menampilkan total dipotong / belum disetor / sudah disetor.
2. Klik **Setor PPh 21** → pilih rekening pembayar → jurnal `(D) Utang PPh 21 — (K) Kas/Bank` diposting dan bukti potong terkait ditandai **disetor**.
3. Tab **Tarif** (admin/staf): ubah persentase tarif langsung di tabel (mendukung penyesuaian regulasi).

---

## 4. Cloudflare Tunnel

Server mengikat ke `HOST`/`PORT` dari `.env` (default `127.0.0.1:3000`) dan `trust proxy`
sudah aktif. Contoh:

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Di produksi set `NODE_ENV=production` (cookie `secure`) dan `SESSION_SECRET` yang acak & panjang.

---

## 5. Struktur proyek

```
server.js                 # entry Express (sesi, rute, statis)
src/
  config.js               # konfigurasi dari .env (DATABASE_URL)
  auth.js                 # peran, bcrypt, middleware requireAuth/requireRole (async)
  sessionStore.js         # session store berbasis PostgreSQL (tabel sessions)
  db/
    schema.sql            # DDL PostgreSQL (SERIAL id, uang = BIGINT "sen")
    migrate.js  seed.js   # migrasi & data awal (async)
    index.js              # lapisan async pg: pool + prep()/tx() (AsyncLocalStorage),
                          #   auto-terjemah datetime('now'), auto RETURNING id
  services/
    journalService.js     # ★ aturan inti: balance, immutability, periode, reversal, createPosted
    cashService.js        # Fase 2: rekening, saldo, auto-jurnal penerimaan/pengeluaran
    reconcileService.js   # Fase 2: parsing CSV, pencocokan otomatis/manual
    piutangService.js     # Fase 3: mahasiswa, tagihan, pembayaran, aging, CKPN, amortisasi PSAK 72
    budgetService.js      # Fase 4: RKAT, realisasi vs anggaran, penegakan pagu
    financialService.js   # Fase 5: laporan keuangan ISAK 35 + eliminasi antar-unit
    closingService.js     # Fase 6: tutup buku tahunan (closing ke aset neto)
    backupService.js      # Fase 6: backup database otomatis & manual
    taxService.js         # Fase 7: PPh 21/23 — tarif, pemotongan, rekap, setor
    reportService.js      # neraca saldo, buku besar, cek antar-unit
    audit.js              # penulisan audit_log
  routes/                 # auth, master, journals, kasbank, piutang, pajak, budget, admin, reports
  utils/money.js          # konversi & format rupiah
public/                   # login.html, index.html, app.js, style.css (SPA)
public/contoh-mutasi.csv  # contoh file mutasi bank untuk rekonsiliasi
data/backups/             # backup database otomatis (.db)
tests/                    # critical(8)+kasbank(6)+piutang(8)+budget(7)+financial(5)+closing(6)+tax(6) = 46 uji
```

---

## 6. Peta fase berikutnya
- ~~**Fase 1**: auth, master data, jurnal umum, buku besar, neraca saldo~~ ✅ selesai
- ~~**Fase 2**: Kas & Bank auto-jurnal + rekonsiliasi CSV~~ ✅ selesai
- ~~**Fase 3**: Piutang UKT, tagihan massal, CKPN aging, pengakuan pendapatan PSAK 72~~ ✅ selesai
- ~~**Fase 4**: RKAT (anggaran) & realisasi vs pagu~~ ✅ selesai
- ~~**Fase 5**: Laporan Keuangan ISAK 35 (posisi, aktivitas, perubahan aset neto, arus kas) + export PDF/Excel~~ ✅ selesai
- ~~**Fase 6**: Dashboard eksekutif, viewer audit lanjutan, backup otomatis, tutup buku tahunan~~ ✅ selesai

**Seluruh 6 fase selesai.** Aplikasi mencakup pembukuan double-entry multi-unit lengkap,
kas & bank, piutang UKT (PSAK 72), anggaran RKAT, laporan keuangan ISAK 35, dan tutup buku.
