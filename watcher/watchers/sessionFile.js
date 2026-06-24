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
// Label dipaparkan = display_name session yang paling baru diupdate.

const fs = require("fs");
const path = require("path");

const POLL_INTERVAL_MS = 4000;
const STALE_AFTER_MS = 30 * 1000; // session dianggap "active" kalau updated dalam 30s terakhir

function findMostRecentSession(raw) {
  if (!raw || typeof raw !== "object") return null;

  let newest = null;
  let newestTs = -Infinity;

  for (const session of Object.values(raw)) {
    if (!session || !session.updated_at) continue;
    const ts = new Date(session.updated_at).getTime();
    if (Number.isNaN(ts)) continue;
    if (ts > newestTs) {
      newestTs = ts;
      newest = session;
    }
  }

  if (!newest) return null;
  return { session: newest, updatedAtMs: newestTs };
}

function start(agent, dataRoot, onStateChange) {
  const filePath = path.join(dataRoot, agent.watch.path);
  let lastState = "idle";

  function poll() {
    fs.readFile(filePath, "utf8", (err, content) => {
      if (err) {
        if (lastState !== "unavailable") {
          lastState = "unavailable";
          onStateChange(agent.id, { state: "unavailable", label: "sessions.json not found" });
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
          onStateChange(agent.id, { state: "idle", label: "Idle" });
        }
        return;
      }

      const isRecent = Date.now() - result.updatedAtMs < STALE_AFTER_MS;
      const newState = isRecent ? "active" : "idle";

      if (newState !== lastState) {
        lastState = newState;
        onStateChange(agent.id, {
          state: newState,
          label: isRecent ? result.session.display_name || "Session active" : "Idle",
        });
      }
    });
  }

  poll();
  const intervalId = setInterval(poll, POLL_INTERVAL_MS);
  return () => clearInterval(intervalId);
}

module.exports = { start };
