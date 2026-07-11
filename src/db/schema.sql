-- ============================================================================
-- SIKEU Tazkia — Skema Database (PostgreSQL)
-- Catatan desain:
--  * Nilai uang disimpan sebagai BIGINT "sen" (1 rupiah = 100 sen) — BIGINT wajib
--    karena nilai sen bisa menembus batas INTEGER 4-byte PostgreSQL.
--  * Kolom waktu (created_at, ts, dll.) bertipe TEXT berisi 'YYYY-MM-DD HH24:MI:SS'
--    (UTC) agar konsisten dengan pemrosesan string di layer aplikasi.
-- ============================================================================

CREATE TABLE IF NOT EXISTS units (
  id          SERIAL PRIMARY KEY,
  kode        TEXT NOT NULL UNIQUE,
  nama        TEXT NOT NULL,
  is_yayasan  INTEGER NOT NULL DEFAULT 0,
  aktif       INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  nama          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN
                  ('admin','staf_akuntansi','kasir','bendahara','kepala_unit','pengurus_yayasan')),
  unit_id       INTEGER REFERENCES units(id),
  aktif         INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id             SERIAL PRIMARY KEY,
  kode           TEXT NOT NULL UNIQUE,
  nama           TEXT NOT NULL,
  tipe           TEXT NOT NULL CHECK (tipe IN
                   ('aset','liabilitas','aset_neto','pendapatan','beban')),
  parent_id      INTEGER REFERENCES accounts(id),
  is_postable    INTEGER NOT NULL DEFAULT 1,
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('D','K')),
  is_interunit   INTEGER NOT NULL DEFAULT 0,
  is_kontra      INTEGER NOT NULL DEFAULT 0,
  net_asset_class TEXT CHECK (net_asset_class IN ('tanpa','dengan')),
  aktif          INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_accounts_tipe   ON accounts(tipe);

CREATE TABLE IF NOT EXISTS periods (
  id         SERIAL PRIMARY KEY,
  tahun      INTEGER NOT NULL,
  bulan      INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by  INTEGER REFERENCES users(id),
  closed_at  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tahun, bulan)
);

CREATE TABLE IF NOT EXISTS journals (
  id           SERIAL PRIMARY KEY,
  nomor        TEXT UNIQUE,
  tanggal      TEXT NOT NULL,
  deskripsi    TEXT NOT NULL,
  unit_id      INTEGER NOT NULL REFERENCES units(id),
  period_id    INTEGER NOT NULL REFERENCES periods(id),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                 ('draft','pending','posted','reversed','rejected')),
  sumber       TEXT NOT NULL DEFAULT 'manual',
  created_by   INTEGER NOT NULL REFERENCES users(id),
  submitted_by INTEGER REFERENCES users(id),
  approved_by  INTEGER REFERENCES users(id),
  rejected_by  INTEGER REFERENCES users(id),
  reject_alasan TEXT,
  posted_at    TEXT,
  reversal_of  INTEGER REFERENCES journals(id),
  reversed_by  INTEGER REFERENCES journals(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_journals_unit_period ON journals(unit_id, period_id);
CREATE INDEX IF NOT EXISTS idx_journals_status ON journals(status);

CREATE TABLE IF NOT EXISTS journal_lines (
  id         SERIAL PRIMARY KEY,
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  line_no    INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  unit_id    INTEGER NOT NULL REFERENCES units(id),
  debit      BIGINT NOT NULL DEFAULT 0,
  kredit     BIGINT NOT NULL DEFAULT 0,
  memo       TEXT,
  CHECK (debit >= 0 AND kredit >= 0),
  CHECK (NOT (debit > 0 AND kredit > 0))
);
CREATE INDEX IF NOT EXISTS idx_lines_journal ON journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_lines_unit    ON journal_lines(unit_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  ts         TEXT NOT NULL DEFAULT (datetime('now')),
  user_id    INTEGER REFERENCES users(id),
  user_nama  TEXT,
  role       TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  detail     TEXT,
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);

CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT PRIMARY KEY,
  expires    BIGINT NOT NULL,
  data       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id       SERIAL PRIMARY KEY,
  nim      TEXT NOT NULL UNIQUE,
  nama     TEXT NOT NULL,
  prodi    TEXT,
  unit_id  INTEGER NOT NULL REFERENCES units(id),
  angkatan INTEGER,
  status   TEXT NOT NULL DEFAULT 'aktif',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id         SERIAL PRIMARY KEY,
  nama       TEXT NOT NULL,
  bank       TEXT,
  no_rekening TEXT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  unit_id    INTEGER NOT NULL REFERENCES units(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_categories (
  id         SERIAL PRIMARY KEY,
  jenis      TEXT NOT NULL CHECK (jenis IN ('penerimaan','pengeluaran')),
  nama       TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  aktif      INTEGER NOT NULL DEFAULT 1,
  urutan     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id          SERIAL PRIMARY KEY,
  nomor       TEXT UNIQUE,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  unit_id     INTEGER NOT NULL REFERENCES units(id),
  semester    TEXT NOT NULL,
  tanggal     TEXT NOT NULL,
  nominal     BIGINT NOT NULL,
  jatuh_tempo TEXT,
  tenor_bulan INTEGER NOT NULL DEFAULT 6,
  mulai_amortisasi TEXT,
  status      TEXT NOT NULL DEFAULT 'terbit' CHECK (status IN ('terbit','sebagian','lunas','void')),
  journal_id  INTEGER REFERENCES journals(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id);
CREATE INDEX IF NOT EXISTS idx_invoices_unit ON invoices(unit_id);

CREATE TABLE IF NOT EXISTS payments (
  id         SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  tanggal    TEXT NOT NULL,
  nominal    BIGINT NOT NULL,
  metode     TEXT,
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  journal_id INTEGER REFERENCES journals(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS revenue_recognition (
  id         SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  tahun      INTEGER NOT NULL,
  bulan      INTEGER NOT NULL,
  nominal    BIGINT NOT NULL,
  journal_id INTEGER REFERENCES journals(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (invoice_id, tahun, bulan)
);

CREATE TABLE IF NOT EXISTS budgets (
  id         SERIAL PRIMARY KEY,
  tahun      INTEGER NOT NULL,
  unit_id    INTEGER NOT NULL REFERENCES units(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  nominal    BIGINT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diajukan','disahkan')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tahun, unit_id, account_id)
);

CREATE TABLE IF NOT EXISTS bank_statements (
  id             SERIAL PRIMARY KEY,
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  tanggal        TEXT NOT NULL,
  keterangan     TEXT,
  debit          BIGINT NOT NULL DEFAULT 0,
  kredit         BIGINT NOT NULL DEFAULT 0,
  matched_journal_line INTEGER REFERENCES journal_lines(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ckpn_rates (
  bucket_key TEXT PRIMARY KEY,
  rate_bp    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_rates (
  id               SERIAL PRIMARY KEY,
  kode             TEXT NOT NULL UNIQUE,
  nama             TEXT NOT NULL,
  jenis            TEXT NOT NULL CHECK (jenis IN ('pph21','pph23')),
  account_utang_id INTEGER NOT NULL REFERENCES accounts(id),
  tarif_bp         INTEGER NOT NULL,
  aktif            INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_withholdings (
  id            SERIAL PRIMARY KEY,
  nomor         TEXT UNIQUE,
  jenis         TEXT NOT NULL,
  tanggal       TEXT NOT NULL,
  unit_id       INTEGER NOT NULL REFERENCES units(id),
  rate_id       INTEGER REFERENCES tax_rates(id),
  lawan_nama    TEXT,
  lawan_npwp    TEXT,
  dpp           BIGINT NOT NULL,
  tarif_bp      INTEGER NOT NULL,
  pajak         BIGINT NOT NULL,
  keterangan    TEXT,
  journal_id    INTEGER REFERENCES journals(id),
  setor_journal_id INTEGER REFERENCES journals(id),
  status        TEXT NOT NULL DEFAULT 'dipotong' CHECK (status IN ('dipotong','disetor')),
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wht_periode ON tax_withholdings(jenis, tanggal);

CREATE TABLE IF NOT EXISTS year_closings (
  id         SERIAL PRIMARY KEY,
  tahun      INTEGER NOT NULL,
  unit_id    INTEGER NOT NULL REFERENCES units(id),
  journal_id INTEGER REFERENCES journals(id),
  surplus    BIGINT,
  closed_by  INTEGER REFERENCES users(id),
  closed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tahun, unit_id)
);
