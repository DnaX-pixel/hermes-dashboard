// watchers/sessionFile.js
//
// Poll fail sessions/sessions.json setiap beberapa saat untuk tentukan sama
// ada Hermes "active" (ada session yang baru diupdate) atau "idle".
//
// STRUKTUR SEBENAR (dah confirm, 2026-06-24):
//   sessions.json = satu OBJECT, key = session_key (cth "agent:main:telegram:dm:315726227")
//   setiap value ada field penting:
//     - updated_at: ISO timestamp, bila session ni last "bercakap"
//     - display_name: nama mesra-manusia untuk session (cth "DnaXAi / #general / hi")
//     - platform: "telegram" | "discord" | dll
//
// Semua session di sini ialah session AGENT UTAMA Hermes (bukan subagent
// berasingan) - tiada field "agent" yang explicitly cakap "hermes". Jadi kita
// anggap Hermes "active" kalau MANA-MANA session ada updated_at baru-baru ni.
//
// "Active" = updated_at dalam STALE_AFTER_MS saat terakhir (default 30s).
//
// ROUTING EXPENSEPILOT:
// ExpensePilot adalah skill/personality Hermes yang diload bila message masuk
// dari Discord #expensepilot channel (ID dikonfigur dalam agents.config.js sebagai
// expensePilotChannelId). Bila session_key mengandungi channel ID tu, label
// dashboard tunjuk "ExpensePilot" supaya dashboard tahu Hermes sedang dalam
// expense-tracking mode — bukan sekadar general chat.
//
// session_key format Discord: "agent:main:discord:channel:<channelId>"
// session_key format Telegram: "agent:main:telegram:dm:<userId>"

const fs = require("fs");
const path = require("path");

const POLL_INTERVAL_MS = 4000;
const STALE_AFTER_MS = 30 * 1000; // session dianggap "active" kalau updated dalam 30s terakhir

// Return { session, sessionKey, updatedAtMs } untuk session yang paling baru diupdate.
// sessionKey diperlukan untuk detect sama ada session tu dari channel ExpensePilot.
function findMostRecentSession(raw) {
  if (!raw || typeof raw !== "object") return null;

  let newest = null;
  let newestKey = null;
  let newestTs = -Infinity;

  for (const [key, session] of Object.entries(raw)) {
    if (!session || !session.updated_at) continue;
    const ts = new Date(session.updated_at).getTime();
    if (Number.isNaN(ts)) continue;
    if (ts > newestTs) {
      newestTs = ts;
      newest = session;
      newestKey = key;
    }
  }

  if (!newest) return null;
  return { session: newest, sessionKey: newestKey, updatedAtMs: newestTs };
}

function start(agent, dataRoot, onStateChange) {
  const cfg = agent.watch;
  const filePath = path.join(dataRoot, cfg.path);
  const expensePilotChannelId = cfg.expensePilotChannelId || null;
  let lastState = "idle";
  let lastLabel = "Idle";

  function poll() {
    fs.readFile(filePath, "utf8", (err, content) => {
      if (err) {
        if (lastState !== "unavailable") {
          lastState = "unavailable";
          lastLabel = "sessions.json not found";
          onStateChange(agent.id, { state: "unavailable", label: lastLabel });
        }
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        return; // fail tengah ditulis / corrupt sementara - skip cycle ni
      }

      const result = findMostRecentSession(parsed);
      if (!result) {
        if (lastState !== "idle") {
          lastState = "idle";
          lastLabel = "Idle";
          onStateChange(agent.id, { state: "idle", label: lastLabel });
        }
        return;
      }

      const isRecent = Date.now() - result.updatedAtMs < STALE_AFTER_MS;
      const newState = isRecent ? "active" : "idle";

      // Detect sama ada Hermes sedang dalam ExpensePilot mode (Discord #expensepilot channel)
      // session_key mengandungi channel ID kalau message dari channel tu
      const isExpensePilotMode =
        isRecent &&
        expensePilotChannelId &&
        result.sessionKey.includes(expensePilotChannelId);

      const newLabel = isRecent
        ? isExpensePilotMode
          ? `ExpensePilot • ${result.session.display_name || ""}`.trim().replace(/•\s*$/, "")
          : result.session.display_name || "Session active"
        : "Idle";

      // Emit kalau state ATAU label berubah (label boleh berubah tanpa state berubah,
      // cth: bertukar dari channel biasa ke #expensepilot tanpa state idle di tengah)
      if (newState !== lastState || newLabel !== lastLabel) {
        lastState = newState;
        lastLabel = newLabel;
        onStateChange(agent.id, { state: newState, label: newLabel });
      }
    });
  }

  poll();
  const intervalId = setInterval(poll, POLL_INTERVAL_MS);
  return () => clearInterval(intervalId);
}

module.exports = { start };
