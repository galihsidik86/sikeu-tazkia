#!/usr/bin/env bash
# Dijalankan DI VPS (oleh GitHub Actions atau manual). Build ulang & mulai ulang
# stack, jalankan migrasi (idempoten). TIDAK menjalankan seed (agar data produksi aman).
set -euo pipefail
cd "$(dirname "$0")/.."   # ke root repo

echo "→ [1/4] Build image aplikasi…"
docker compose build app

echo "→ [2/4] Pastikan database berjalan…"
docker compose up -d db

echo "→ [3/4] Migrasi skema (idempoten, aman diulang)…"
docker compose run --rm app npm run migrate

echo "→ [4/4] Mulai/segarkan seluruh layanan…"
docker compose up -d

docker image prune -f >/dev/null 2>&1 || true
echo "✓ Deploy selesai."
docker compose ps
