// watchers/googleSheetsPoll.js
//
// Watch type: "googleSheetsPoll"
//
// Poll satu atau lebih tab dalam satu Google Sheet (cth: "Expenses" + "Debts")
// guna Service Account credential (read-only). Bila row count sesuatu tab
// bertambah berbanding poll sebelumnya, anggap row baru = panggil LLM
// (Ollama Cloud) untuk PUTUSKAN macam mana robot ExpensePilot patut bergerak
// dan bertindak balas - bukan sekadar pilih dari "action" pra-takrif.
//
// Config (dalam agents.config.js) untuk agent yang guna watcher ni:
//   watch: {
//     type: "googleSheetsPoll",
//     spreadsheetId: "...",
//     credentialsPath: "/opt/credentials/google-service-account.json",
//     pollIntervalMs: 10000,
//     actionDurationMs: 5500,      // hard cap - paksa balik idle kalau LLM/sequence terlalu lama
//     llm: {
//       baseUrl: "https://ollama.com",
//       apiKey: process.env.OLLAMA_API_KEY,
//       model: "gpt-oss:20b-cloud",
//       timeoutMs: 12000,
//     },
//     sheets: [
//       { tab: "Expenses", range: "A:S", rowType: "expense" },
//       { tab: "Debts", range: "A:X", rowType: "debt" },
//     ],
//   }
//
// LLM decision dikira dalam watchers/../llmDecision.js (lihat fail tu untuk
// schema, validation, dan fallback). Kalau LLM gagal/timeout, kita tetap
// hantar fallback deterministic - robot tak sekali-kali "freeze".
//
// Kredential Service Account & Ollama API key TIDAK PERNAH ditulis ke log
// atau dihantar ke frontend - cuma dibaca sekali untuk auth.

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const llmDecision = require(path.join(__dirname, "..", "llmDecision"));

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
  const actionDurationMs = cfg.actionDurationMs || 5500;

  if (!cfg.spreadsheetId || !cfg.credentialsPath || !cfg.sheets || !cfg.sheets.length) {
    console.warn(`[googleSheetsPoll] config tak lengkap untuk agent "${agent.id}", skip.`);
    return () => {};
  }
  if (!cfg.llm || !cfg.llm.apiKey) {
    console.warn(
      `[googleSheetsPoll] config.llm/apiKey tak lengkap untuk agent "${agent.id}". ` +
        `Robot akan guna fallback decision sahaja (tiada "fikiran" LLM).`
    );
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

  // Track row count setiap tab, supaya kita boleh detect row baru.
  const lastRowCount = {};
  let activeTimer = null;
  let stopped = false;
  let busyDeciding = false; // elak overlap kalau LLM call lambat & poll seterusnya dah start

  async function pollOnce() {
    if (busyDeciding) return; // tunggu LLM call sebelum ni habis dulu
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
          const rowType = sheetCfg.rowType || "expense";
          // Context: beberapa row terkini (selain yang baru) untuk bantu LLM
          // bandingkan (cth "ni kali ke-3 makan luar minggu ni").
          const context = rows.slice(-6, -1);

          busyDeciding = true;
          // Label ringkas untuk sidebar/terminal (sementara LLM "fikir").
          const quickLabel =
            rowType === "debt"
              ? `Hutang: ${newest.PersonName || "?"} - RM${Number(newest.Amount || 0).toFixed(2)}`
              : `${newest.Merchant || newest.Description || "Expense"} - RM${Number(newest.Amount || 0).toFixed(2)}`;

          // Notify boss agent (Hermes) untuk buat "directing" gesture —
          // visual naratif: boss bagi arahan, worker buat kerja.
          if (agent.bossAgentId) {
            onStateChange(agent.bossAgentId, {
              state: "directing",
              label: `Directing: ${quickLabel}`,
              decision: null,
            });
            // Boss balik idle selepas 4s (lepas worker mula bergerak)
            setTimeout(() => {
              onStateChange(agent.bossAgentId, { state: "idle", label: "Idle", decision: null });
            }, 4000);
          }

          onStateChange(agent.id, { state: "logging", label: quickLabel, decision: null });

          let decision;
          try {
            decision = cfg.llm && cfg.llm.apiKey
              ? await llmDecision.decide(rowType, newest, context, cfg.llm)
              : llmDecision.fallbackDecision(rowType);
          } catch (e) {
            console.error(`[googleSheetsPoll] llmDecision.decide() gagal tanpa ditangkap dalaman:`, e.message);
            decision = llmDecision.fallbackDecision(rowType);
          }
          busyDeciding = false;

          onStateChange(agent.id, { state: "logging", label: quickLabel, decision });

          // Hard cap - kalau jumlah durationMs+holdMs sequence kurang dari
          // actionDurationMs, kita still paksa balik "idle" lepas tempoh ni
          // sebagai safety net tambahan (elak robot stuck kalau ada bug lain).
          const totalSequenceMs = decision.moves.reduce((sum, m) => sum + m.durationMs + m.holdMs, 0);
          const waitMs = Math.max(totalSequenceMs, actionDurationMs);

          if (activeTimer) clearTimeout(activeTimer);
          activeTimer = setTimeout(() => {
            if (!stopped) onStateChange(agent.id, { state: "idle", label: "Idle", decision: null });
          }, waitMs);
        }

        lastRowCount[sheetCfg.tab] = count;
      } catch (err) {
        // Jangan crash seluruh watcher kalau satu tab gagal (cth: rate limit sekejap,
        // atau nama tab silap) - log dan cuba lagi pada poll seterusnya.
        busyDeciding = false;
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
