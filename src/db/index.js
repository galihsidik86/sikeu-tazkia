'use strict';
// Lapisan akses data ASINKRON di atas PostgreSQL (pg).
// Menyediakan API mirip better-sqlite3 (prep().get/all/run, transaction) agar konversi
// dari kode sinkron minimal: cukup menambahkan `await`. Transaksi memakai AsyncLocalStorage
// sehingga semua query di dalam satu transaksi otomatis memakai koneksi yang sama.
const pg = require('pg');
const { Pool } = pg;
const { AsyncLocalStorage } = require('async_hooks');
const config = require('../config');

// BIGINT / SUM / COUNT / NUMERIC dikembalikan pg sebagai string demi presisi. Nilai kita
// (sen, bilangan bulat) masih dalam rentang aman Number → parse ke number agar aritmetika
// (khususnya '+') benar. Catatan: SUM(bigint) menghasilkan NUMERIC (OID 1700), bukan int8.
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));   // int8 / bigint
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));   // numeric (hasil SUM bigint)

const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on('error', (e) => console.error('PG pool error:', e.message));

const als = new AsyncLocalStorage();
function conn() { return als.getStore() || pool; }

// Terjemahkan dialek SQLite → PostgreSQL pada string SQL.
function translate(sql) {
  return sql.replace(/datetime\('now'\)/g, "to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')");
}
// Ubah placeholder '?' (positional) atau '@name' (named) → $1,$2 (pg).
function bind(sql, args) {
  const named = args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]);
  if (named) {
    const obj = args[0]; const values = []; const map = {};
    const text = sql.replace(/@(\w+)/g, (_, n) => {
      if (!(n in map)) { values.push(obj[n]); map[n] = '$' + values.length; }
      return map[n];
    });
    return { text, values };
  }
  let i = 0;
  const text = sql.replace(/\?/g, () => '$' + (++i));
  return { text, values: args };
}
// Auto-tambah RETURNING id untuk INSERT biasa (semua tabel utama punya kolom id SERIAL),
// kecuali yang memakai ON CONFLICT / sudah punya RETURNING.
function withReturning(sql) {
  if (/^\s*insert/i.test(sql) && !/returning/i.test(sql) && !/on\s+conflict/i.test(sql)) {
    return sql.replace(/;?\s*$/, ' RETURNING id');
  }
  return sql;
}

async function q(sql, args) {
  const { text, values } = bind(translate(sql), args);
  return conn().query(text, values);
}

// Statement "prepared" (lazy) bergaya better-sqlite3, semuanya async.
function prep(sql) {
  return {
    get: async (...a) => (await q(sql, a)).rows[0],
    all: async (...a) => (await q(sql, a)).rows,
    run: async (...a) => {
      const r = await q(withReturning(sql), a);
      return { changes: r.rowCount, lastInsertRowid: r.rows[0] ? r.rows[0].id : undefined, rows: r.rows };
    },
  };
}

// Jalankan skrip SQL banyak-pernyataan (mis. skema).
async function exec(sqlText) { await conn().query(translate(sqlText)); }

// Transaksi; nested = bergabung dengan transaksi terluar (roll back bersama).
async function tx(fn) {
  if (als.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await als.run(client, fn);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}
// db.transaction(fn) → fungsi yang, saat dipanggil, menjalankan fn dalam transaksi.
function transaction(fn) { return (...args) => tx(() => fn(...args)); }

module.exports = {
  pool, prep, prepare: prep, q, query: q, exec, tx, transaction, conn,
  close: () => pool.end(),
};
