<!--
Terima kasih atas kontribusinya! Isi setiap bagian di bawah.
Baca CONTRIBUTING.md sebelum membuka PR. Hapus baris komentar ini bila perlu.
-->

## Ringkasan

<!-- Apa yang diubah dan MENGAPA. 1–3 kalimat. -->

Menutup issue: #

## Jenis perubahan

- [ ] `feat` — fitur baru
- [ ] `fix` — perbaikan bug
- [ ] `docs` — dokumentasi
- [ ] `refactor` — ubah struktur tanpa mengubah perilaku
- [ ] `test` — uji
- [ ] `chore` — perkakas / dependensi / konfigurasi

## Dampak ke akuntansi / laporan keuangan

<!-- Wajib diisi bila menyentuh jurnal, saldo, pajak, atau laporan.
Tulis "Tidak ada" bila murni UI/dokumentasi. -->

- Akun / jurnal yang terpengaruh:
- Laporan yang terpengaruh (Posisi, Aktivitas, Aset Neto, Arus Kas, Aging, RKAT, Pajak):
- Perubahan hasil angka pada data seed (bila ada), sebelum → sesudah:

## Cara menguji

<!-- Langkah agar reviewer bisa memverifikasi. -->

1.
2.

## Checklist

- [ ] Sudah membaca **CONTRIBUTING.md**
- [ ] `npm test` **hijau semua** di lokal (database `sikeu_test`)
- [ ] Menambah / memperbarui **uji** untuk perubahan pada `src/services/*` yang menyentuh angka
- [ ] Nominal uang tetap **integer sen (`BIGINT`)** — tidak ada float untuk rupiah
- [ ] Tidak mengedit/menghapus jurnal `posted` (koreksi hanya via **reversal**)
- [ ] Tidak menembus **penguncian periode**
- [ ] Setiap baris jurnal berdimensi **unit**
- [ ] Tidak ada rahasia (`.env`, kredensial, dump database) yang ikut ter-commit
- [ ] Pesan commit memakai prefiks jenis (`feat:`/`fix:`/…)
