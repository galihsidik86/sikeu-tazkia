'use strict';
const bcrypt = require('bcryptjs');
const db = require('./db');

// ---- Definisi peran & label ----
const ROLES = {
  admin:            { label: 'Administrator',    badge: ['#EDE9F6', '#3F2A68'] },
  staf_akuntansi:   { label: 'Staf Akuntansi',   badge: ['#EDE9F6', '#3F2A68'] },
  kasir:            { label: 'Kasir',            badge: ['#E3F1E7', '#256D42'] },
  bendahara:        { label: 'Bendahara',        badge: ['#FBF3DC', '#8A6A16'] },
  kepala_unit:      { label: 'Kepala Unit',      badge: ['#F1EDF7', '#5B5468'] },
  pengurus_yayasan: { label: 'Pengurus Yayasan', badge: ['#FBF3DC', '#8A6A16'] },
};

const APPROVER_ROLES = ['bendahara', 'pengurus_yayasan', 'admin'];
const AUTHOR_ROLES = ['staf_akuntansi', 'kasir', 'bendahara', 'admin'];
const MASTER_ROLES = ['admin', 'staf_akuntansi'];
const PERIOD_ROLES = ['admin', 'bendahara', 'pengurus_yayasan'];

function hashPassword(plain) { return bcrypt.hashSync(plain, 10); }
function verifyPassword(plain, hash) { return bcrypt.compareSync(plain, hash); }

const findByEmail = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)');
const findById = db.prepare('SELECT * FROM users WHERE id = ?');

async function authenticate(email, password) {
  const u = await findByEmail.get(String(email || '').trim());
  if (!u || !u.aktif) return null;
  if (!verifyPassword(password, u.password_hash)) return null;
  return sanitize(u);
}

async function getUser(id) {
  const u = await findById.get(id);
  return u && u.aktif ? sanitize(u) : null;
}

async function changePassword(userId, oldPass, newPass) {
  const u = await findById.get(userId);
  if (!u) { const e = new Error('Pengguna tidak ditemukan.'); e.status = 404; throw e; }
  if (!verifyPassword(String(oldPass || ''), u.password_hash)) {
    const e = new Error('Kata sandi lama salah.'); e.status = 400; throw e;
  }
  const np = String(newPass || '');
  if (np.length < 8) { const e = new Error('Kata sandi baru minimal 8 karakter.'); e.status = 400; throw e; }
  if (verifyPassword(np, u.password_hash)) {
    const e = new Error('Kata sandi baru harus berbeda dari kata sandi lama.'); e.status = 400; throw e;
  }
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(np), userId);
  return true;
}

function sanitize(u) {
  return {
    id: u.id, nama: u.nama, email: u.email, role: u.role,
    unit_id: u.unit_id, aktif: u.aktif,
    roleLabel: (ROLES[u.role] || {}).label || u.role,
  };
}

// ---- Middleware ----
async function requireAuth(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Belum masuk. Silakan login.' });
    }
    const user = await getUser(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Sesi tidak valid.' });
    }
    req.user = user;
    next();
  } catch (e) { next(e); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Belum masuk.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Peran Anda tidak berwenang untuk aksi ini.' });
    }
    next();
  };
}

module.exports = {
  ROLES, APPROVER_ROLES, AUTHOR_ROLES, MASTER_ROLES, PERIOD_ROLES,
  hashPassword, verifyPassword, authenticate, changePassword, getUser, sanitize,
  requireAuth, requireRole,
};
