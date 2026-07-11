'use strict';
const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO audit_log (user_id, user_nama, role, action, entity, entity_id, detail, ip)
  VALUES (@user_id, @user_nama, @role, @action, @entity, @entity_id, @detail, @ip)
`);

// user boleh berupa objek user (dari sesi) atau null (mis. event sistem)
async function log(user, action, entity, entity_id, detail, ip) {
  await insertStmt.run({
    user_id: user ? user.id : null,
    user_nama: user ? user.nama : 'sistem',
    role: user ? user.role : null,
    action,
    entity,
    entity_id: entity_id != null ? String(entity_id) : null,
    detail: detail ? JSON.stringify(detail) : null,
    ip: ip || null,
  });
}

module.exports = { log };
