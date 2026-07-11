'use strict';
// Session store berbasis PostgreSQL (tabel `sessions`).
const session = require('express-session');
const db = require('./db');

const Store = session.Store;

class PgStore extends Store {
  constructor() {
    super();
    // Bersihkan sesi kedaluwarsa tiap jam
    setInterval(() => {
      db.query('DELETE FROM sessions WHERE expires < ?', [Date.now()]).catch(() => {});
    }, 3600 * 1000).unref();
  }

  _expiry(sess) {
    const maxAge = sess && sess.cookie && sess.cookie.maxAge;
    return Date.now() + (maxAge || 7 * 24 * 3600 * 1000);
  }

  get(sid, cb) {
    db.query('SELECT data, expires FROM sessions WHERE sid = ?', [sid])
      .then((r) => {
        const row = r.rows[0];
        if (!row) return cb(null, null);
        if (Number(row.expires) < Date.now()) { db.query('DELETE FROM sessions WHERE sid = ?', [sid]).catch(() => {}); return cb(null, null); }
        cb(null, JSON.parse(row.data));
      }).catch(cb);
  }
  set(sid, sess, cb) {
    db.query(
      'INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?) ' +
      'ON CONFLICT (sid) DO UPDATE SET expires = EXCLUDED.expires, data = EXCLUDED.data',
      [sid, this._expiry(sess), JSON.stringify(sess)]
    ).then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
  destroy(sid, cb) {
    db.query('DELETE FROM sessions WHERE sid = ?', [sid]).then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
  touch(sid, sess, cb) {
    db.query('UPDATE sessions SET expires = ? WHERE sid = ?', [this._expiry(sess), sid])
      .then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
}

module.exports = PgStore;
