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
    room: { x: 240, y: 200 },
    // hasVault: bina vault + kalkulator dalam room (Hermes handles expense tracking juga)
    // hasMonitor: bina monitor di meja
    hasVault: true,
    hasMonitor: true,
    // watch boleh array - setiap entry akan distart sebagai watcher berasingan
    // tapi emit state ke agent ID yang sama ("hermes").
    watch: [
      {
        // Watcher 1: detect bila Hermes sedang active chat (Telegram/Discord/dll)
        type: "sessionFile",
        path: "sessions/sessions.json",
        // Hermes dianggap "active" kalau MANA-MANA session ada updated_at dalam 30s terakhir.
        // expensePilotChannelId: kalau session yang aktif adalah dari Discord channel ni,
        // label akan tunjuk "ExpensePilot" (bukan nama session biasa) — sebab Hermes
        // sedang dalam "ExpensePilot mode" bila message masuk dari channel ni.
        expensePilotChannelId: "1518482044563488800",
      },
      {
        // Watcher 2: detect aktiviti expense/debt (ExpensePilot adalah personality
        // Hermes, bukan agent berasingan - data tetap masuk Google Sheets yang sama)
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
          {
            tab: "Expenses",
            range: "A:S",
            rowType: "expense",
          },
          {
            tab: "Debts",
            range: "A:X",
            rowType: "debt",
          },
        ],
      },
    ],
  },
];
