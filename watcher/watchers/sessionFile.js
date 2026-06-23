// watchers/sessionFile.js
//
// Poll satu fail JSON (contoh: sessions/sessions.json) setiap beberapa saat,
// dan tentukan sama ada agent tu "active" (ada session terbuka) atau "idle".
//
// NOTA: Struktur sessions.json sebenar Hermes belum kita confirm 100%.
// Kod ni reka untuk TAHAN (defensive) terhadap pelbagai bentuk struktur biasa:
//   - array of session objects: [{ id, agent, status, updated_at }, ...]
//   - object keyed by session id: { "<id>": { agent, status, ... }, ... }
// Kalau struktur sebenar lain, sesuaikan fungsi `extractSessions()` di bawah
// selepas kita tengok output `cat sessions.json` (ingat: redact apa-apa token/secret).

const fs = require("fs");
const path = require("path");

const POLL_INTERVAL_MS = 4000;
const STALE_AFTER_MS = 60 * 1000; // session dianggap idle kalau tak updated dalam 60s

function extractSessions(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    // cuba cari array di dalam, atau treat values sebagai list
    for (const key of ["sessions", "active", "items"]) {
      if (Array.isArray(raw[key])) return raw[key];
    }
    return Object.values(raw);
  }
  return [];
}

function isRecentlyUpdated(session) {
  const ts =
    session.updated_at || session.updatedAt || session.last_active || session.timestamp;
  if (!ts) return true; // kalau tak ada timestamp, anggap active (better false-positive than missing it)
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t < STALE_AFTER_MS;
}

function start(agent, dataRoot, onStateChange) {
  const filePath = path.join(dataRoot, agent.watch.path);
  let lastState = "idle";

  function poll() {
    fs.readFile(filePath, "utf8", (err, content) => {
      if (err) {
        // fail tak wujud / tak boleh baca - jangan crash, just report idle + log sekali
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

      const sessions = extractSessions(parsed);
      const relevant = sessions.filter((s) => {
        const haystack = JSON.stringify(s);
        return agent.watch.match.test(haystack);
      });

      const active = relevant.some((s) => isRecentlyUpdated(s));
      const newState = active ? "active" : "idle";

      if (newState !== lastState) {
        lastState = newState;
        onStateChange(agent.id, {
          state: newState,
          label: active ? "Session active" : "Idle",
        });
      }
    });
  }

  poll();
  const intervalId = setInterval(poll, POLL_INTERVAL_MS);
  return () => clearInterval(intervalId);
}

module.exports = { start };
