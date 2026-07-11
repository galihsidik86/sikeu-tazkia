# Panduan Kontribusi — SIKEU Tazkia

Terima kasih telah berkontribusi pada **Sistem Informasi Keuangan & Akuntansi**
Yayasan Tazkia Cendikia. Karena ini **sistem keuangan produksi**, kualitas dan
kebenaran akuntansi didahulukan di atas kecepatan. Baca panduan ini sebelum mulai.

---

## 1. Prinsip yang tidak boleh dilanggar

Ini bukan sekadar konvensi gaya — melanggarnya berarti laporan keuangan bisa salah.

- **Double-entry ketat** — setiap jurnal harus balance (Σ debit = Σ kredit) dan
  divalidasi di **backend**, bukan hanya di UI.
- **Imutabilitas jurnal terposting** — jurnal berstatus `posted` **tidak boleh**
  diedit atau dihapus. Koreksi **hanya** lewat **jurnal balik (reversal)**.
- **Penguncian periode** — periode yang sudah ditutup **menolak** posting baru.
  Jangan menambah jalur yang menembus penguncian ini.
- **Dimensi unit wajib** — setiap baris jurnal harus punya `unit_id`. Akun
  antar-unit **tereliminasi** saat konsolidasi.
- **Uang = integer sen** — semua nominal disimpan sebagai `BIGINT` sen
  (1 rupiah = 100 sen). **Jangan pernah** memakai `float`/`Number` desimal untuk
  rupiah. Konversi & format lewat `src/utils/money.js`.
- **Jejak audit** — perubahan data sensitif menulis ke `audit_log`.

Jika sebuah fitur tampak menuntut pelanggaran salah satu prinsip di atas, **buka
Issue** untuk diskusi dulu — hampir selalu ada cara yang benar (mis. lewat reversal
atau akun penyesuaian).

---

## 2. Menyiapkan lingkungan

```bash
npm install
cp .env.example .env          # sesuaikan DATABASE_URL & SESSION_SECRET
# siapkan PostgreSQL, mis. via Docker:
# docker run -d --name sikeu-pg -e POSTGRES_USER=sikeu -e POSTGRES_PASSWORD=sikeu \
#   -e POSTGRES_DB=sikeu -p 5432:5432 postgres:16-alpine
npm run reset                 # migrate + seed data contoh
npm start                     # http://127.0.0.1:3000
```

Untuk uji, siapkan database terpisah `sikeu_test` (lihat `README.md` bagian 1) lalu
set `TEST_DATABASE_URL` bila berbeda dari default.

---

## 3. Alur kerja

1. **Branch dari `main`** — `git checkout -b <jenis>/<nama-singkat>`
   (mis. `fitur/rekap-pph`, `fix/aging-bucket`). Jangan commit langsung ke `main`.
2. **Tulis kode** yang seragam dengan gaya sekitarnya (penamaan, idiom, kepadatan komentar).
3. **Tulis / perbarui uji** di `tests/` untuk setiap perubahan pada `src/services/*`
   yang menyentuh jurnal, saldo, atau laporan. Perubahan angka tanpa uji tidak diterima.
4. **`npm test` harus hijau semua** sebelum push (butuh database `sikeu_test`).
5. **Commit** dengan pesan bermakna (lihat §4).
6. **Buka Pull Request** ke `main` mengikuti template; minimal **1 reviewer** menyetujui.

---

## 4. Konvensi commit

Pesan ringkas **Bahasa Indonesia**, satu tujuan per commit, dengan prefiks jenis:

| Prefiks     | Untuk                                             |
|-------------|---------------------------------------------------|
| `feat:`     | fitur baru                                        |
| `fix:`      | perbaikan bug                                     |
| `docs:`     | dokumentasi saja                                  |
| `refactor:` | ubah struktur tanpa mengubah perilaku             |
| `test:`     | menambah / memperbaiki uji                        |
| `chore:`    | perkakas, dependensi, konfigurasi                 |

Contoh: `fix: perbaiki bucket aging CKPN untuk tenggat > 365 hari`

---

## 5. Standar uji

- Kerangka: `node:test` (`npm test`), dijalankan `--test-concurrency=1`.
- Nominal dalam uji memakai helper `sen(rupiah)` — bandingkan nilai **sen**, bukan float.
- Uji perilaku akuntansi wajib mengecek **arah debit/kredit** dan **saldo akhir**,
  bukan hanya "tidak error".
- Untuk error yang diharapkan pada fungsi async, gunakan `assert.rejects`.

---

## 6. Melaporkan bug / usul fitur

Buka **Issue** dengan: langkah reproduksi, perilaku diharapkan vs aktual, dan —
bila menyangkut angka — jurnal/laporan terkait beserta unit & periodenya. Untuk
usulan besar, diskusikan di Issue sebelum mengerjakan agar tidak sia-sia.

---

Dengan berkontribusi, Anda setuju kontribusi dirilis di bawah
[MIT License](LICENSE) proyek ini.
