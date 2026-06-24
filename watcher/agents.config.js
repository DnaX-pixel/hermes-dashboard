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
//   - "googleSheetsPoll": poll satu/lebih tab Google Sheet (Service Account credential),
//                         bila row count tab tu naik -> trigger state "logging"
//
// DATA_ROOT (env var) = root folder bind-mount Hermes data (/opt/data dalam container watcher)
// GOOGLE_CREDENTIALS_PATH (env var) = path JSON key Service Account dalam container watcher

module.exports = [
  {
    id: "hermes",
    name: "Hermes",
    color: "#3b6fe0",
    room: { x: 120, y: 160 },
    watch: {
      type: "sessionFile",
      path: "sessions/sessions.json",
      // "match" - substring/regex untuk cari entry session yang berkaitan agent ni
      // Sesuaikan ni lepas kita tengok isi sebenar sessions.json
      match: /hermes/i,
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
      activeDurationMs: 4000, // kekal "logging" selama 4 saat lepas row baru dikesan
      sheets: [
        {
          tab: "Expenses",
          range: "A:S",
          // Column header sebenar (row 1): ID, Date, Time, Merchant, Description, Amount, ...
          labelFrom: (row) =>
            `${row.Merchant || row.Description || "Expense"} - RM${Number(row.Amount || 0).toFixed(2)}`,
        },
        {
          tab: "Debts",
          range: "A:X",
          // Column header sebenar (row 1): DebtID, DebtType, PersonName, ..., Amount, ...
          labelFrom: (row) =>
            `Hutang: ${row.PersonName || "?"} - RM${Number(row.Amount || 0).toFixed(2)}`,
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
