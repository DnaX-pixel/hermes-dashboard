# Hermes Room — Spatial Agent Monitor

Dashboard 3D (Three.js) bergaya IDE yang tunjuk setiap agent Hermes sebagai
robot dalam satu "office room", dengan furniture kontekstual (Hermes = meja+monitor,
ExpensePilot = meja+vault+kalkulator). Robot beranimasi ikut aktiviti sebenar
agent — dikesan dari fail data Hermes (read-only), bukan dengan mengubah Hermes.

Layout & chrome (sidebar Explorer, terminal/event-log, task panel, System Overview)
ikut gaya light-mode yang kemas. Boleh drag mouse untuk putar kamera dalam room.

## Cara ia berfungsi

```
Hermes (container sedia ada — JANGAN diubah)
   └── tulis fail ke /docker/hermes-agent-o8vg/data/...

watcher (container baru — baca data tu READ-ONLY)
   └── detect perubahan (expenses.csv, sessions.json) -> emit WebSocket event

dashboard (container baru — nginx serve frontend)
   └── render room 3D + proxy WebSocket/API ke watcher (internal Docker network)
```

Cuma SATU port (4501) perlu dibuka di firewall — semua trafik (HTML, WebSocket,
API) lalu melalui nginx pada port tu.

## Tiada dependency CDN luar

Semua library di-bundle dalam projek (di-serve dari VPS sendiri), supaya tak
gagal walaupun firewall block CDN luar:
- Three.js + OrbitControls -> `dashboard/public/vendor/three/`
- socket.io client -> `dashboard/public/vendor/socketio/`
- Tailwind CSS -> di-build masa Docker build (stage `css-builder`), hasil minimal ~14KB
- Google Fonts (Inter/JetBrains Mono) -> masih dari CDN, tapi degrade ke font
  sistem kalau di-block (tak rosakkan layout)

## Setup ExpensePilot (Google Sheets watcher)

ExpensePilot kini menulis data ke **Google Sheets** (bukan CSV lokal lagi), jadi
watcher perlu kredential Google untuk baca Sheet tu (read-only).

### 1. Buat Service Account di Google Cloud Console

1. https://console.cloud.google.com/iam-admin/serviceaccounts -> pilih/buat project
2. Enable **Google Sheets API** (APIs & Services -> Library)
3. **+ Create Service Account** -> bagi nama (cth `hermes-dashboard-watcher`) -> skip
   role/access -> **Done**
4. Klik service account tu -> tab **Keys** -> **Add Key** -> **Create new key** -> **JSON**
5. Fail JSON auto-download

### 2. Share Google Sheet dengan service account

1. Buka fail JSON, copy nilai `client_email` (cth `xxx@xxx.iam.gserviceaccount.com`)
2. Buka Google Sheet ExpensePilot -> **Share** -> paste email tu -> role **Viewer** -> **Send**

### 3. Letak fail JSON kat VPS

```bash
# Dari laptop kau (scp / WinSCP / FileZilla)
scp google-service-account.json root@<vps-ip>:/docker/hermes-dashboard/watcher/google-service-account.json
```

Fail ni **TIDAK** masuk git repo (`.gitignore` dah exclude). Lihat
`watcher/google-service-account.json.example` untuk struktur yang dijangka.

`docker-compose.yml` akan mount fail ni read-only ke dalam container watcher
secara automatik (path `./watcher/google-service-account.json` relatif kepada
folder projek ni kat VPS).

### 4. Sesuaikan config kalau Sheet ID / nama tab berbeza

Dalam `watcher/agents.config.js`, agent `expensepilot` ada `spreadsheetId` dan
senarai `sheets` (satu entry per tab, cth "Expenses" dan "Debts"). Kalau Sheet
ID atau nama tab kau berbeza, sesuaikan kat sini. `labelFrom` tentukan macam
mana label dipaparkan dalam dashboard apabila row baru dikesan.

### 5. Test

```bash
docker compose up -d --build
docker logs -f hermes-dashboard-watcher
```

Tambah satu row baru dalam Sheet (Expenses atau Debts), tunggu sehingga
`pollIntervalMs` (default 10 saat) berlalu — patut nampak baris log:

```
[state] expensepilot -> logging Kopi Tuaran - RM5.00
```

Kalau tak nampak apa-apa, semak:
- `docker logs hermes-dashboard-watcher` ada error berkaitan credentials/permission?
- Nama tab dalam config sama dengan nama tab sebenar dalam Sheet (case-sensitive)?
- Service account dah betul-betul di-**Share** sebagai Viewer pada Sheet tu?

## Setup

```bash
# 1. Extract zip ni ke VPS
unzip hermes-dashboard.zip -d /docker/

# 2. Masuk folder
cd /docker/hermes-dashboard

# 3. (Optional) confirm path data Hermes betul dalam docker-compose.yml
#    Default: /docker/hermes-agent-o8vg/data
#    Check: docker inspect hermes-agent-o8vg-hermes-agent-1 --format '{{json .Mounts}}'

# 4. Build & run
docker compose up -d --build

# 5. Buka browser
http://<ip-vps>:4501
```

## Kalau skrin 3D putih/kosong

Buka Console browser (F12 -> Console) dan tengok error:
- Kalau ada error berkaitan module/import -> kemungkinan MIME type. Pastikan
  guna Dockerfile yang disertakan (nginx config dah set MIME `.js`/`.mjs` betul).
- Halaman dah ada error handler — kalau Three.js gagal load, ia papar mesej
  (bukan putih senyap). Kalau masih putih, hard-refresh (Ctrl+Shift+R) untuk
  clear cache.

## Sesuaikan selepas setup

1. **Struktur `sessions.json`** — buka untuk lihat struktur (bukan isi sensitif):
   ```bash
   python3 -m json.tool < /docker/hermes-agent-o8vg/data/sessions/sessions.json | head -40
   ```
   Lepas tu sesuaikan regex `match` dalam `watcher/agents.config.js` (agent "hermes")
   ikut field sebenar.

2. **Test watcher berasingan**:
   ```bash
   docker compose up watcher
   curl http://localhost:4500/health
   # tambah expense baru via Hermes, tengok log watcher untuk "[state] expensepilot -> logging"
   ```

## Tambah subagent baru (cth: DebtTracker)

1. Tambah satu entry dalam `watcher/agents.config.js`
2. Robot baru auto-muncul dalam room di slot seterusnya (tak perlu ubah kod 3D).
   Untuk furniture kontekstual khas (cth: objek unik DebtTracker), tambah satu
   builder dalam `dashboard/public/room3d.js` ikut pattern `buildVault`/`buildMonitor`.

## Keselamatan

- Data Hermes di-mount **read-only** (`:ro`) — watcher tak boleh tulis/rosakkan.
- Jangan expose ke internet awam tanpa auth — label aktiviti boleh dedahkan
  maklumat (cth: nama kedai dalam expense). Letak di belakang reverse proxy
  dengan basic auth, atau restrict by IP.

## Struktur projek

```
hermes-dashboard/
├── docker-compose.yml
├── watcher/                  # backend: baca data Hermes, emit state
│   ├── index.js              # Express + Socket.io server
│   ├── agents.config.js      # daftar agent (extensible)
│   └── watchers/             # handler per jenis sumber data
│       ├── csvAppend.js      # watch expenses.csv
│       ├── sessionFile.js    # poll sessions.json
│       └── logTail.js        # tail log (untuk kegunaan masa depan)
└── dashboard/                # frontend: 3D room + IDE chrome
    ├── Dockerfile            # multi-stage: build Tailwind CSS + nginx serve
    ├── tailwind.config.js
    ├── nginx.conf
    └── public/
        ├── index.html        # layout IDE (light mode)
        ├── room3d.js         # Three.js scene (robot, furniture, room)
        ├── app.js            # orchestrator (state, sidebar, terminal, panel)
        ├── terminal.js       # event log feed
        └── vendor/           # Three.js, OrbitControls, socket.io (bundled)
```
