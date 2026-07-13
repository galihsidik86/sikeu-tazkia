# Image produksi SIKEU Tazkia (Node + Express). DB terpisah (lihat docker-compose.yml).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Instal hanya dependensi produksi (devDeps seperti playwright/pagedjs tidak diperlukan runtime)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Salin kode aplikasi (docs/, tests/, scripts/ dikecualikan via .dockerignore)
COPY . .

# Folder data (backup) — dipetakan ke volume di compose
RUN mkdir -p /app/data/backups

EXPOSE 3000

# Aplikasi membaca HOST/PORT/DATABASE_URL/SESSION_SECRET dari environment
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
