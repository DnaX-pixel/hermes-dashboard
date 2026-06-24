// watchers/googleSheetsPoll.js
//
// Watch type: "googleSheetsPoll"
//
// Poll satu atau lebih tab dalam satu Google Sheet (cth: "Expenses" + "Debts")
// guna Service Account credential (read-only). Bila row count sesuatu tab
// bertambah berbanding poll sebelumnya, anggap row baru = trigger "logging".
//
// Config (dalam agents.config.js) untuk agent yang guna watcher ni:
//   watch: {
//     type: "googleSheetsPoll",
//     spreadsheetId: "...",
//     credentialsPath: "/opt/credentials/google-service-account.json",  // path DALAM container watcher
//     pollIntervalMs: 10000,                                            // berapa kerap poll (default 10s)
//     activeDurationMs: 4000,                                           // berapa lama kekal "logging" lepas row baru
//     sheets: [
//       {
//         tab: "Expenses",
//         range: "A:S",              // column range untuk baca (header di row 1)
//         labelFrom: (row) => `${row.Merchant || row.Description || "Expense"} - RM${Number(row.Amount || 0).toFixed(2)}`,
//       },
//       {
//         tab: "Debts",
//         range: "A:X",
//         labelFrom: (row) => `Hutang: ${row.PersonName || "?"} - RM${Number(row.Amount || 0).toFixed(2)}`,
//       },
//     ],
//   }
//
// Kredential Service Account TIDAK PERNAH ditulis ke log atau dihantar ke
// frontend - ia cuma dibaca sekali untuk auth, kekal dalam memory container watcher.

const fs = require("fs");
const { google } = require("googleapis");

function rowsToObjects(values) {
  // values: array-of-arrays dari Sheets API. Row pertama = header.
  if (!values || values.length < 2) return [];
  const [header, ...rows] = values;
  return rows
    .filter((r) => r.some((cell) => cell !== undefined && cell !== ""))
    .map((r) => {
      const obj = {};
      header.forEach((key, i) => {
        obj[key] = r[i];
      });
      return obj;
    });
}

function start(agent, dataRoot, onStateChange) {
  const cfg = agent.watch;
  const pollIntervalMs = cfg.pollIntervalMs || 10000;
  const activeDurationMs = cfg.activeDurationMs || 4000;

  if (!cfg.spreadsheetId || !cfg.credentialsPath || !cfg.sheets || !cfg.sheets.length) {
    console.warn(`[googleSheetsPoll] config tak lengkap untuk agent "${agent.id}", skip.`);
    return () => {};
  }

  if (!fs.existsSync(cfg.credentialsPath)) {
    console.warn(
      `[googleSheetsPoll] credentials file tak jumpa di "${cfg.credentialsPath}" (agent: ${agent.id}). ` +
        `Pastikan service account JSON key sudah di-mount ke path ini dalam container watcher.`
    );
    return () => {};
  }

  let sheetsApi;
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: cfg.credentialsPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    sheetsApi = google.sheets({ version: "v4", auth });
  } catch (err) {
    console.error(`[googleSheetsPoll] gagal init Google auth untuk agent "${agent.id}":`, err.message);
    return () => {};
  }

  // Track row count terakhir setiap tab, supaya kita boleh detect "row baru".
  const lastRowCount = {};
  let activeTimer = null;
  let stopped = false;

  async function pollOnce() {
    for (const sheetCfg of cfg.sheets) {
      try {
        const res = await sheetsApi.spreadsheets.values.get({
          spreadsheetId: cfg.spreadsheetId,
          range: `${sheetCfg.tab}!${sheetCfg.range || "A:Z"}`,
        });
        const rows = rowsToObjects(res.data.values);
        const count = rows.length;
        const prevCount = lastRowCount[sheetCfg.tab];

        if (prevCount !== undefined && count > prevCount) {
          const newest = rows[rows.length - 1];
          const label = sheetCfg.labelFrom ? sheetCfg.labelFrom(newest) : `New entry in ${sheetCfg.tab}`;

          onStateChange(agent.id, { state: "logging", label });

          if (activeTimer) clearTimeout(activeTimer);
          activeTimer = setTimeout(() => {
            if (!stopped) onStateChange(agent.id, { state: "idle", label: "Idle" });
          }, activeDurationMs);
        }

        lastRowCount[sheetCfg.tab] = count;
      } catch (err) {
        // Jangan crash seluruh watcher kalau satu tab gagal (cth: rate limit sekejap,
        // atau nama tab silap) - log dan cuba lagi pada poll seterusnya.
        console.error(
          `[googleSheetsPoll] gagal baca tab "${sheetCfg.tab}" (agent: ${agent.id}):`,
          err.message
        );
      }
    }
  }

  // Poll pertama serta-merta (untuk dapatkan baseline row count), lepas tu ikut interval.
  pollOnce();
  const interval = setInterval(() => {
    if (!stopped) pollOnce();
  }, pollIntervalMs);

  return function stop() {
    stopped = true;
    clearInterval(interval);
    if (activeTimer) clearTimeout(activeTimer);
  };
}

module.exports = { start };
