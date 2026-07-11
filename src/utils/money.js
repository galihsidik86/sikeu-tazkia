'use strict';
// Uang disimpan sebagai INTEGER sen (1 rupiah = 100 sen).

// Ubah input pengguna (angka atau string "1.250.000,00" / "1250000") menjadi sen.
function toSen(input) {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') return Math.round(input * 100);
  let s = String(input).trim();
  if (!s) return 0;
  // Buang simbol mata uang & spasi
  s = s.replace(/rp/gi, '').replace(/\s/g, '');
  // Format Indonesia: titik = pemisah ribuan, koma = desimal
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Tanpa koma: titik dianggap pemisah ribuan
    s = s.replace(/\./g, '');
  }
  const val = parseFloat(s);
  if (Number.isNaN(val)) return 0;
  return Math.round(val * 100);
}

// Format sen -> "1.250.000,00"
function formatAngka(sen) {
  const neg = sen < 0;
  const abs = Math.abs(Math.round(sen));
  const rupiah = Math.floor(abs / 100);
  const desimal = String(abs % 100).padStart(2, '0');
  const ribuan = String(rupiah).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + ribuan + ',' + desimal;
}

// Format sen -> "Rp 1.250.000,00"
function formatRp(sen) {
  return 'Rp ' + formatAngka(sen || 0);
}

module.exports = { toSen, formatAngka, formatRp };
