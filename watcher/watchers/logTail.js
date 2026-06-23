// watchers/logTail.js
//
// Tail satu log file (contoh: logs/agent.log) dan match setiap baris baru
// terhadap senarai patterns. Setiap pattern boleh map ke satu state + label.
//
// Belum digunakan oleh agents.config.js lagi (sebab kita belum confirm format
// sebenar agent.log/gateway.log) - tapi disediakan untuk subagent akan datang
// yang log-nya boleh diparse dengan regex.
//
// Contoh config untuk guna watcher ni nanti:
//   watch: {
//     type: "logTail",
//     path: "logs/agent.log",
//     patterns: [
//       { match: /thinking/i, state: "thinking", label: "Thinking..." },
//       { match: /calling tool (\w+)/i, state: "working", label: (m) => `Using ${m[1]}` },
//       { match: /error/i, state: "error", label: "Error" },
//     ],
//     idleAfterMs: 5000, // balik idle kalau tiada baris baru selepas ni
//   }

const fs = require("fs");
const path = require("path");

function start(agent, dataRoot, onStateChange) {
  const filePath = path.join(dataRoot, agent.watch.path);
  const patterns = agent.watch.patterns || [];
  const idleAfterMs = agent.watch.idleAfterMs || 5000;
  let lastSize = -1;
  let idleTimer = null;

  function scheduleIdleRevert() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      onStateChange(agent.id, { state: "idle", label: "Idle" });
    }, idleAfterMs);
  }

  function handleNewLines(newText) {
    const lines = newText.split("\n").filter(Boolean);
    for (const line of lines) {
      for (const p of patterns) {
        const m = line.match(p.match);
        if (m) {
          const label = typeof p.label === "function" ? p.label(m) : p.label;
          onStateChange(agent.id, { state: p.state, label });
          scheduleIdleRevert();
          break;
        }
      }
    }
  }

  function poll() {
    fs.stat(filePath, (err, stats) => {
      if (err) return;
      if (lastSize === -1) {
        lastSize = stats.size; // baseline - jangan replay log lama
        return;
      }
      if (stats.size < lastSize) {
        lastSize = stats.size; // log rotated
        return;
      }
      if (stats.size === lastSize) return;

      const start = lastSize;
      const end = stats.size;
      lastSize = stats.size;

      const stream = fs.createReadStream(filePath, { start, end, encoding: "utf8" });
      let buf = "";
      stream.on("data", (chunk) => (buf += chunk));
      stream.on("end", () => handleNewLines(buf));
    });
  }

  const intervalId = setInterval(poll, 1500);
  return () => {
    clearInterval(intervalId);
    if (idleTimer) clearTimeout(idleTimer);
  };
}

module.exports = { start };
