'use strict';
// Migrasi skema PostgreSQL. Jalankan: npm run migrate  (atau: npm run migrate -- --fresh)
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function run({ fresh = false } = {}) {
  if (fresh) {
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    console.log('• Skema public di-reset (--fresh).');
  }
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.exec(schema);
  console.log('✓ Migrasi selesai (PostgreSQL).');
}

if (require.main === module) {
  run({ fresh: process.argv.includes('--fresh') })
    .then(() => db.close())
    .catch((e) => { console.error(e); process.exit(1); });
}
module.exports = run;
