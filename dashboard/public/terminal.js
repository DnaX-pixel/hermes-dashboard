// terminal.js — event log feed (light-mode, Stitch style)

const TERMINAL = (() => {
  const MAX_LINES = 200;
  let bodyEl = null;

  function init(el) { bodyEl = el; }

  function levelLabel(state) {
    if (state === "error") return ["[ERROR]", "text-red-500"];
    if (state === "logging" || state === "active") return ["[SUCCESS]", "text-green-600"];
    if (state === "unavailable") return ["[WARN]", "text-amber-500"];
    return ["[INFO]", "text-slate-500"];
  }
  function timeStr(ts) { return new Date(ts).toTimeString().slice(0, 8); }

  function append(agentName, color, update) {
    if (!bodyEl) return;
    const [lvl, lvlClass] = levelLabel(update.state);
    const row = document.createElement("div");
    row.className = "flex gap-4 mb-1";
    row.innerHTML = `
      <span class="text-slate-400">${timeStr(update.updated_at || Date.now())}</span>
      <span class="font-bold whitespace-nowrap" style="color:${color}">• ${agentName}</span>
      <span class="${lvlClass} whitespace-nowrap">${lvl}</span>
      <span class="text-slate-700 truncate">${update.state.toUpperCase()} — ${update.label || ""}</span>`;
    bodyEl.appendChild(row);
    while (bodyEl.children.length > MAX_LINES) bodyEl.removeChild(bodyEl.firstChild);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function boot(message) {
    if (!bodyEl) return;
    const row = document.createElement("div");
    row.className = "flex gap-4 mb-1";
    row.innerHTML = `
      <span class="text-slate-400">${timeStr(Date.now())}</span>
      <span class="text-slate-400">[system]</span>
      <span class="text-slate-600 truncate">${message}</span>`;
    bodyEl.appendChild(row);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  return { init, append, boot };
})();
