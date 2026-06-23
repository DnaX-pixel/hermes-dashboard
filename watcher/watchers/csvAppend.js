// watchers/csvAppend.js
//
// Watch satu CSV (contoh: expensepilot/expenses.csv). Bila fail size bertambah
// (row baru ditambah), emit state "logging" untuk seketika (activeDurationMs),
// lepas tu balik ke "idle". Kita juga baca row terakhir untuk dijadikan "label"
// (contoh: "Logged: Gym ums - RM4.00") supaya UI boleh tunjuk apa yang baru jadi.

const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");

function parseLastRow(content) {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return null; // header je, tiada data row lagi

  const header = lines[0].split(",");
  const lastLine = lines[lines.length - 1];

  // Naive CSV split - cukup untuk expenses.csv yang tak ada koma dalam field.
  // Kalau notes/description ada koma, ganti dengan proper CSV parser (csv-parse).
  const cols = lastLine.split(",");
  const row = {};
  header.forEach((h, i) => {
    row[h.trim()] = (cols[i] || "").trim();
  });
  return row;
}

function start(agent, dataRoot, onStateChange) {
  const filePath = path.join(dataRoot, agent.watch.path);
  const activeDurationMs = agent.watch.activeDurationMs || 3000;
  let lastSize = -1;
  let revertTimer = null;

  function handleChange() {
    fs.stat(filePath, (err, stats) => {
      if (err) return;
      if (lastSize === -1) {
        // first read after watcher boots - just record baseline, don't fire event
        lastSize = stats.size;
        return;
      }
      if (stats.size <= lastSize) {
        lastSize = stats.size;
        return; // file shrank or unchanged - ignore
      }
      lastSize = stats.size;

      fs.readFile(filePath, "utf8", (err2, content) => {
        if (err2) return;
        const row = parseLastRow(content);
        const label = row
          ? `Logged: ${row.description || "expense"} - RM${row.amount || "?"}`
          : "New entry logged";

        onStateChange(agent.id, { state: "logging", label });

        if (revertTimer) clearTimeout(revertTimer);
        revertTimer = setTimeout(() => {
          onStateChange(agent.id, { state: "idle", label: "Idle" });
        }, activeDurationMs);
      });
    });
  }

  // Baseline awal
  fs.stat(filePath, (err, stats) => {
    lastSize = err ? -1 : stats.size;
    if (err) {
      onStateChange(agent.id, { state: "unavailable", label: "expenses.csv not found" });
    }
  });

  const watcher = chokidar.watch(filePath, {
    usePolling: true, // penting bila guna bind mount Docker - native fs events selalu tak reliable
    interval: 1500,
    ignoreInitial: true,
  });

  watcher.on("change", handleChange);
  watcher.on("add", handleChange);

  return () => {
    if (revertTimer) clearTimeout(revertTimer);
    watcher.close();
  };
}

module.exports = { start };
