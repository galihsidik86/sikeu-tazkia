# Dokumentasi SIKEU Tazkia

Folder ini berisi **Manual Penggunaan SIKEU Tazkia** beserta perkakas untuk
meregenerasinya. Manual tersedia dalam tiga format yang dihasilkan dari **satu sumber**.

## Hasil (deliverable)

| Berkas | Format | Keterangan |
|---|---|---|
| `manual/index.html` | **HTML satu file** | Untuk host internal / akses cepat via peramban. Ada sidebar navigasi, pencarian, dan gambar ter-embed (portabel). |
| `manual/Manual-SIKEU-Tazkia.pdf` | **PDF** | Siap cetak: cover, daftar isi bernomor halaman, header/footer, ~40 halaman. |
| `manual/Manual-SIKEU-Tazkia.docx` | **Word** | Dapat diedit. Daftar isi otomatis (klik *Update Field* di Word). |
| `screenshots/` | **PNG** | Semua tangkapan layar, penamaan sistematis `NN-modul-NN-langkah.png`. |
| `assets/logo-yayasan.png` | **Logo** | *Placeholder.* Ganti dengan logo asli (lihat di bawah). |

## Struktur sumber

```
docs/
  manual/
    parts/                 # sumber konten (diedit manual)
      10-A-pendahuluan.html
      20-B-modul.html
      30-C-akuntansi.html
      40-D-lampiran.html
    index.html             # HASIL rakitan (jangan diedit langsung)
    Manual-SIKEU-Tazkia.pdf
    Manual-SIKEU-Tazkia.docx
  screenshots/             # HASIL capture Playwright
  assets/logo-yayasan.png  # logo (placeholder)
```

Skrip perakit ada di `../scripts/`:
`screenshots.mjs`, `build-manual.mjs`, `build-pdf.mjs`, `build-docx.mjs`.

## Cara meregenerasi

Prasyarat sekali saja:

```bash
npm install                       # termasuk playwright, pagedjs, html-to-docx
npx playwright install chromium   # unduh peramban untuk screenshot & PDF
```

### 1) Perbarui screenshot (saat UI berubah)

```bash
npm run reset            # siapkan data demo yang konsisten
npm start                # jalankan server di http://127.0.0.1:3000 (biarkan berjalan)
npm run docs:screenshots # ambil ulang semua screenshot → docs/screenshots/
```

> Server **harus** berjalan saat mengambil screenshot. Viewport 1440×900, UI Bahasa
> Indonesia, dengan anotasi panah/kotak merah bernomor pada elemen yang dibahas.

### 2) Rakit ulang manual (semua format sekaligus)

```bash
npm run docs:all         # = docs:manual + docs:pdf + docs:docx
```

Atau satu per satu:

```bash
npm run docs:manual      # parts/*.html + screenshots → manual/index.html
npm run docs:pdf         # index.html → PDF (via Paged.js)
npm run docs:docx        # index.html → DOCX (via html-to-docx)
```

> `docs:manual` juga **menggenerate otomatis** Lampiran D.1 (Bagan Akun) dari basis
> data dan D.2 (Matriks Peran) dari konfigurasi kode. Agar Bagan Akun terisi, jalankan
> saat server DB aktif (`DATABASE_URL` benar). Tanpa DB, bagian itu diisi catatan.

## Cara memperbarui isi manual

1. Edit berkas di `manual/parts/` (HTML biasa). Gunakan komponen yang tersedia:
   `callout tip|warn|note`, `box-sikeu` ("Di SIKEU"), `proc-meta`, tabel `jrnl`
   (jurnal), `figure`+`caption`, dan `steps` (langkah bernomor).
2. Tambahkan gambar dengan `<img src="../screenshots/NAMA.png">` — akan otomatis
   di-embed saat build.
3. Beri **id** pada tiap `<h2>`/`<h3>` agar masuk daftar isi & navigasi otomatis.
4. Jalankan `npm run docs:all`.

## Mengganti logo yayasan

Letakkan logo asli di **`docs/assets/logo-yayasan.png`** (PNG, latar transparan,
sisi ≥ 512 px). Saat ini cover memakai monogram "T" sebagai placeholder; untuk memakai
berkas logo pada cover, sisipkan `<img src="../assets/logo-yayasan.png">` pada bagian
cover di `scripts/build-manual.mjs` (fungsi `COVER`) lalu rakit ulang.

## Versi

- Manual versi **1.0**. Perbarui nomor versi & tanggal di `scripts/build-manual.mjs`
  (`VERSION`, `TANGGAL`) — atau set `MANUAL_DATE` saat build.
- Lengkapi **kontak Administrator** pada Lampiran D.6 (`parts/40-D-lampiran.html`)
  sebelum distribusi.
