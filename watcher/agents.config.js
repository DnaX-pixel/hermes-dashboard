// agents.config.js
//
// Daftar semua "avatar" yang nak ditunjuk dalam Sims room.
// Untuk tambah subagent baru nanti: tambah satu entry baru je kat array bawah.
// Code watcher (watchers/*.js) TAK PERLU diubah untuk subagent baru,
// melainkan subagent tu perlukan "watch type" yang belum wujud lagi.
//
// watch.type yang disokong sekarang:
//   - "sessionFile":     baca sessions/sessions.json, tengok ada session aktif utk agent ni
//   - "csvAppend":       watch satu CSV, bila ada row baru -> trigger state "logging"
//   - "logTail":         tail satu log file, match pattern -> trigger state ikut pattern
//   - "googleSheetsPoll": poll satu/lebih tab Google Sheet (Service Account credential).
//                         Bila row baru dikesan, watcher panggil Ollama Cloud (lihat
//                         llmDecision.js) untuk PUTUSKAN macam mana robot bergerak/
//                         bertindak balas - bukan animasi pra-takrif yang statik.
//
// DATA_ROOT (env var) = root folder bind-mount Hermes data (/opt/data dalam container watcher)
// GOOGLE_CREDENTIALS_PATH (env var) = path JSON key Service Account dalam container watcher
// OLLAMA_API_KEY (env var) = API key Ollama Cloud (https://ollama.com/settings/keys)

module.exports = [
  // ── HERMES (Boss / CEO) ────────────────────────────────────────────────────
  // Hermes adalah agent utama. Dia duduk di executive desk, pantau semua
  // aktiviti, dan "beri arahan" kepada ExpensePilot bila ada expense/debt baru.
  // Watcher: sessionFile sahaja — Hermes detect bila dia sedang "on duty" (active chat).
  {
    id: "hermes",
    name: "Hermes",
    color: "#3b6fe0",
    room: { x: 120, y: 160 },
    isBoss: true,       // render executive desk + boss visual treatment
    hasMonitor: true,
    hasVault: false,
    watch: {
      type: "sessionFile",
      path: "sessions/sessions.json",
      // Bila session dari #expensepilot Discord channel, label tunjuk "ExpensePilot mode"
      expensePilotChannelId: "1518482044563488800",
    },
  },

  // ── EXPENSEPILOT (Worker) ──────────────────────────────────────────────────
  // ExpensePilot adalah skill/personality Hermes yang handle semua expense tracking.
  // Secara teknikal dia "dihantar" oleh Hermes untuk buat kerja di vault.
  // Watcher: googleSheetsPoll — detect bila ada expense/debt baru dalam Sheets.
  // Bila row baru dikesan: ExpensePilot buat animasi vault, DAN Hermes buat
  // "directing" gesture (speech bubble) menandakan dia yang beri arahan.
  {
    id: "expensepilot",
    name: "ExpensePilot",
    color: "#2ea043",
    room: { x: 360, y: 220 },
    isBoss: false,
    hasVault: true,
    hasMonitor: false,
    bossAgentId: "hermes", // ID boss yang akan dapat "directing" notification
    watch: {
      type: "googleSheetsPoll",
      spreadsheetId: "1EFxXhmi60Mqk7tDZk0CxvOiuXKOm4Zj-A5wOKcymVA8",
      credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || "/opt/credentials/google-service-account.json",
      pollIntervalMs: 10000,
      actionDurationMs: 5500,
      llm: {
        baseUrl: "https://ollama.com",
        apiKey: process.env.OLLAMA_API_KEY,
        model: "gpt-oss:20b-cloud",
        timeoutMs: 12000,
      },
      sheets: [
        { tab: "Expenses", range: "A:S", rowType: "expense" },
        { tab: "Debts", range: "A:X", rowType: "debt" },
      ],
    },
  },
];
