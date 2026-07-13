#!/usr/bin/env bash
# Dijalankan DI VPS untuk alur GHCR: TARIK image pra-bangun (bukan build di VPS),
# migrasi (idempoten), lalu segarkan layanan. TIDAK menjalankan seed.
set -euo pipefail
cd "$(dirname "$0")/.."   # ke root repo

echo "→ [1/4] Tarik image aplikasi terbaru dari GHCR…"
docker compose pull app

echo "→ [2/4] Pastikan database berjalan…"
docker compose up -d db

echo "→ [3/4] Migrasi skema (idempoten, aman diulang)…"
docker compose run --rm app npm run migrate

echo "→ [4/4] Mulai/segarkan seluruh layanan…"
docker compose up -d

docker image prune -f >/dev/null 2>&1 || true
echo "✓ Deploy (GHCR) selesai."
docker compose ps
