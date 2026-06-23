// agents.config.js
//
// Daftar semua "avatar" yang nak ditunjuk dalam Sims room.
// Untuk tambah subagent baru nanti: tambah satu entry baru je kat array bawah.
// Code watcher (watchers/*.js) TAK PERLU diubah untuk subagent baru,
// melainkan subagent tu perlukan "watch type" yang belum wujud lagi.
//
// watch.type yang disokong sekarang:
//   - "sessionFile": baca sessions/sessions.json, tengok ada session aktif utk agent ni
//   - "csvAppend":   watch satu CSV, bila ada row baru -> trigger state "logging"
//   - "logTail":     tail satu log file, match pattern -> trigger state ikut pattern
//
// DATA_ROOT (env var) = root folder bind-mount Hermes data (/opt/data dalam container watcher)

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
      type: "csvAppend",
      path: "expensepilot/expenses.csv",
      // berapa lama avatar kekal dalam state "logging" lepas row baru dikesan (ms)
      activeDurationMs: 3000,
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
