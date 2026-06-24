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
  {
    id: "hermes",
    name: "Hermes",
    color: "#3b6fe0",
    room: { x: 120, y: 160 },
    watch: {
      type: "sessionFile",
      path: "sessions/sessions.json",
      // Tiada "match" - struktur sebenar sessions.json tak ada field yang
      // bezakan subagent. Hermes dianggap "active" kalau MANA-MANA session
      // (Telegram/Discord/dll) ada updated_at dalam 30s terakhir.
      // Lihat watchers/sessionFile.js untuk logic penuh.
    },
  },
  {
    id: "expensepilot",
    name: "ExpensePilot",
    color: "#2ea043",
    room: { x: 360, y: 220 },
    watch: {
      type: "googleSheetsPoll",
      spreadsheetId: "1EFxXhmi60Mqk7tDZk0CxvOiuXKOm4Zj-A5wOKcymVA8",
      credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || "/opt/credentials/google-service-account.json",
      pollIntervalMs: 10000, // poll setiap 10 saat
      actionDurationMs: 5500, // hard cap - paksa balik idle selepas tempoh ni walau apa pun sequence LLM
      llm: {
        baseUrl: "https://ollama.com",
        apiKey: process.env.OLLAMA_API_KEY,
        model: "gpt-oss:20b-cloud",
        timeoutMs: 12000, // kalau Ollama Cloud tak respons dalam tempoh ni, guna fallback
      },
      sheets: [
        {
          tab: "Expenses",
          range: "A:S",
          rowType: "expense", // column header sebenar (row 1): ID, Date, Time, Merchant, Description, Amount, ...
        },
        {
          tab: "Debts",
          range: "A:X",
          rowType: "debt", // column header sebenar (row 1): DebtID, DebtType, PersonName, ..., Amount, ...
        },
      ],
    },
  },

  // === Contoh macam mana nak tambah subagent baru (uncomment & edit) ===
  // {
  //   id: "debttracker",
  //   name: "DebtTracker",
  //   color: "#d9822b",
  //   room: { x: 520, y: 160 },
  //   watch: {
  //     type: "csvAppend",
  //     path: "debttracker/debts.csv",
  //     activeDurationMs: 3000,
  //   },
  // },
];
