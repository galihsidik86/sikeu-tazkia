# Deploy SIKEU Tazkia ke VPS (Docker Compose + Caddy + GitHub Actions)

Arsitektur:

```
Internet ──HTTPS──▶ Caddy (80/443, auto-TLS) ──▶ app (Node/Express :3000) ──▶ db (PostgreSQL)
                         ▲                                                        │
              domain (DNS A record)                              volume: pgdata (data), appdata (backup)
```

Deploy dipicu **otomatis** oleh GitHub Actions setiap `push` ke `main`: workflow SSH ke
VPS, menarik kode terbaru, lalu `docker compose up -d --build` + migrasi.

---

## 1. Prasyarat VPS (sekali saja)

VPS Linux (mis. Ubuntu 22.04+) dengan Docker & plugin Compose:

```bash
# Install Docker + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"    # agar bisa 'docker' tanpa sudo — logout/login setelahnya

# Clone repo ke lokasi standar
sudo mkdir -p /opt/sikeu-tazkia && sudo chown "$USER" /opt/sikeu-tazkia
git clone https://github.com/galihsidik86/sikeu-tazkia /opt/sikeu-tazkia
cd /opt/sikeu-tazkia
```

Arahkan **DNS**: buat A record `DOMAIN` → IP publik VPS. Buka port **80** dan **443**
di firewall.

## 2. Konfigurasi rahasia

```bash
cp .env.production.example .env
nano .env      # isi DOMAIN, POSTGRES_PASSWORD, SESSION_SECRET (openssl rand -hex 32)
```

`.env` tidak pernah di-commit (masuk `.gitignore`), dan `git reset --hard` saat deploy
tidak menghapusnya (berkas untracked tetap aman).

## 3. Peluncuran pertama

```bash
docker compose build
docker compose up -d db
docker compose run --rm app npm run migrate    # buat skema
docker compose run --rm app npm run seed        # HANYA sekali: buat data awal + admin
docker compose up -d                             # jalankan app + caddy
```

> `npm run seed` membuat pengguna demo (mis. `admin1@tazkia.ac.id` / `sikeu123`) **dan
> menghapus seluruh data lama**. Jalankan **hanya pada peluncuran pertama**. Setelah login,
> segera ganti kata sandi admin dan sesuaikan data. **Jangan** pernah menjalankan `seed`
> pada sistem yang sudah berisi data produksi.

Cek: buka `https://DOMAIN` — Caddy otomatis menerbitkan sertifikat TLS.

## 4. Aktifkan deploy otomatis (GitHub Actions)

Di VPS, buat kunci SSH khusus deploy dan otorisasi:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/sikeu_deploy -N ""     # tanpa passphrase
cat ~/.ssh/sikeu_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/sikeu_deploy                                  # <- salin PRIVATE key ini
```

Di GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**,
tambahkan:

| Secret | Nilai |
|---|---|
| `VPS_HOST` | IP / hostname VPS |
| `VPS_USER` | user SSH (anggota grup `docker`) |
| `VPS_SSH_KEY` | isi **private key** `sikeu_deploy` (lengkap, termasuk baris BEGIN/END) |
| `VPS_PORT` | *(opsional)* port SSH, default `22` |
| `VPS_APP_DIR` | *(opsional)* path repo, default `/opt/sikeu-tazkia` |

Setelah itu, setiap `push` ke `main` akan otomatis men-deploy. Bisa juga dipicu manual
di tab **Actions → Deploy ke VPS → Run workflow**.

## 5. Operasional

```bash
docker compose ps                     # status layanan
docker compose logs -f app            # log aplikasi
docker compose logs -f caddy          # log TLS/proxy
docker compose restart app            # restart aplikasi
docker compose down                   # hentikan semua (data tetap di volume)
```

**Backup database.** Backup logis JSON otomatis tersimpan di volume `appdata`
(`/app/data/backups`, retensi 30 hari). Untuk menyalin ke luar container:

```bash
docker compose cp app:/app/data/backups ./backups-$(date +%F)
```

Backup penuh PostgreSQL kapan saja:

```bash
docker compose exec db pg_dump -U sikeu sikeu | gzip > sikeu-$(date +%F).sql.gz
```

## 6. Catatan perubahan skema

Migrasi memakai `CREATE TABLE IF NOT EXISTS`, sehingga `deploy.sh` aman menjalankannya
tiap deploy: **tabel baru** dibuat, tabel lama tak tersentuh. Perubahan pada kolom tabel
yang sudah ada perlu skrip `ALTER` manual (belum ada kerangka migrasi bertingkat).
