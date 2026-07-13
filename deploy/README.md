# Deploy SIKEU Tazkia ke VPS (Docker Compose + Caddy + GitHub Actions)

Arsitektur — **dua mode**:

**Mode A · Berdiri sendiri** (server belum punya reverse proxy) — Caddy bawaan aktif:

```
Internet ─HTTPS─▶ Caddy bawaan (80/443) ─▶ app (:3000) ─▶ db (PostgreSQL)
   (aktifkan: docker compose --profile proxy up -d)
```

**Mode B · Di belakang proxy yang sudah ada** (server sudah menjalankan Caddy/Nginx untuk
domain lain) — **default**; Caddy bawaan TIDAK dijalankan, app diterbitkan ke loopback:

```
Internet ─HTTPS─▶ Caddy/Nginx HOST (80/443) ─▶ 127.0.0.1:${APP_PORT} ─▶ app (:3000) ─▶ db
```

Pada Mode B, tambahkan satu blok vhost di proxy host (lihat bagian 4b). `docker compose
up -d` (tanpa `--profile proxy`) hanya menjalankan **app + db**.

Deploy dipicu **otomatis** oleh GitHub Actions setiap `push` ke `main`.

**Dua alur tersedia** (pilih salah satu):

| Alur | Image dibangun di | Workflow | Skrip VPS |
|---|---|---|---|
| **GHCR (disarankan)** | GitHub Actions → didorong ke `ghcr.io` | `build-image.yml` (otomatis) | `deploy/deploy-ghcr.sh` (pull) |
| **Build di VPS** | di VPS saat deploy | `deploy.yml` (manual) | `deploy/deploy.sh` (build) |

Alur GHCR lebih cepat & tidak membebani VPS (VPS cukup **menarik** image jadi). Panduan
di bawah memakai alur GHCR; untuk build-di-VPS lihat bagian akhir.

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

Pastikan image sudah ada di GHCR (push ke `main` sekali agar `build-image.yml`
membangunnya), lalu **jadikan package publik** agar VPS bisa menariknya tanpa login:
GitHub → tab **Packages** → `sikeu-tazkia` → *Package settings* → **Change visibility →
Public**. (Alternatif: login di VPS dengan `docker login ghcr.io` memakai PAT ber-scope
`read:packages`.)

```bash
docker compose pull app                          # tarik image dari GHCR
docker compose up -d db
docker compose run --rm app npm run migrate      # buat skema
docker compose run --rm app npm run seed          # HANYA sekali: buat data awal + admin
docker compose up -d                              # jalankan app + caddy
```

> Memakai build-di-VPS? Ganti `docker compose pull app` dengan `docker compose build`.

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

Setelah itu, setiap `push` ke `main` menjalankan **Build image (GHCR) & deploy**:
GitHub Actions membangun image, mendorongnya ke GHCR, lalu SSH ke VPS untuk `docker
compose pull` + `up`. Tidak perlu `GITHUB_TOKEN` tambahan — Actions memakai token bawaan
untuk mendorong ke GHCR (izin `packages: write` sudah diatur di workflow).

> **Alternatif build-di-VPS:** jalankan workflow **Deploy ke VPS (build di VPS — fallback
> manual)** dari tab Actions → Run workflow. Ini memakai `deploy/deploy.sh` (build image
> langsung di VPS) alih-alih menarik dari GHCR.

## 4b. Integrasi dengan reverse proxy host (Mode B)

Jika server sudah menjalankan Caddy/Nginx untuk domain lain (port 80/443 sudah dipakai),
**jangan** aktifkan Caddy bawaan. Set `APP_PORT` ke port loopback yang bebas di `.env`,
jalankan `docker compose up -d` (app+db saja), lalu tambahkan vhost di proxy host.

**Caddy host** — tambahkan blok ke `/etc/caddy/Caddyfile` lalu `systemctl reload caddy`:

```
sikeu.tazkia.ac.id {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000    # samakan dengan APP_PORT
}
```

**Nginx host** — buat server block yang `proxy_pass http://127.0.0.1:3000;` lalu jalankan
`certbot --nginx -d sikeu.tazkia.ac.id`.

> Prasyarat: A record domain sudah mengarah ke IP server agar penerbitan TLS berhasil.

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
