// app.js — orchestrator (light-mode Stitch layout)
//
// 1. Fetch agent metadata dari /api/agents
// 2. Bina 3D room (room3d.js) + populate sidebar/overview
// 3. Connect Socket.io, dengar state update, refresh semua view
// 4. Klik agent (room atau sidebar) -> papar task panel

const WATCHER_URL = window.WATCHER_URL || "";

const agents = {};
let selectedAgentId = null;

// map agent color hex -> tailwind-ish dot (we just use inline style with the hex)
function fmtTimeAgo(ts) {
  if (!ts) return "—";
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 1500) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  return `${Math.floor(diff / 60000)}m ago`;
}
function progressFor(state) {
  if (state === "logging" || state === "working") return 68;
  if (state === "thinking") return 35;
  if (state === "active") return 50;
  if (state === "error") return 100;
  return 0;
}

// ---------------- Sidebar agent tree ----------------
function renderSidebar() {
  const tree = document.getElementById("agent-tree");
  tree.innerHTML = "";
  Object.values(agents).forEach((a) => {
    const row = document.createElement("div");
    row.className =
      "px-2 py-1 flex items-center justify-between cursor-pointer hover:bg-slate-50 " +
      (a.id === selectedAgentId ? "bg-blue-50" : "");
    row.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full" style="background:${a.color}"></span>
        <span class="${a.id === selectedAgentId ? "text-slate-900 font-medium" : ""}">${a.name}</span>
      </div>
      <span class="text-[10px] text-slate-400 font-mono">${a.state}</span>`;
    row.addEventListener("click", () => selectAgent(a.id));
    tree.appendChild(row);
  });
}

// ---------------- Task panel ----------------
function renderTaskPanel() {
  const empty = document.getElementById("task-empty");
  const detail = document.getElementById("task-detail");
  if (!selectedAgentId || !agents[selectedAgentId]) {
    empty.classList.remove("hidden");
    detail.classList.add("hidden");
    detail.classList.remove("flex");
    return;
  }
  const a = agents[selectedAgentId];
  empty.classList.add("hidden");
  detail.classList.remove("hidden");
  detail.classList.add("flex");
  document.getElementById("task-name").textContent = a.name;
  document.getElementById("task-state").textContent = a.state;
  document.getElementById("task-activity").textContent = a.label || "—";
  document.getElementById("task-updated").textContent = fmtTimeAgo(a.updated_at);
  const p = progressFor(a.state);
  document.getElementById("task-progress").style.width = `${p}%`;
  document.getElementById("task-progress-label").textContent = `${p}%`;

  const sel = document.getElementById("terminal-selected");
  sel.innerHTML = `<span class="w-2 h-2 rounded-full" style="background:${a.color}"></span> ${a.name}`;
}
setInterval(renderTaskPanel, 1000);

// ---------------- System Overview dots ----------------
function renderOverview() {
  const wrap = document.getElementById("overview-dots");
  wrap.innerHTML = "";
  const list = Object.values(agents);
  list.forEach((a, i) => {
    // place dots around the orbit ring
    const ang = (i / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radius = 42;
    const x = 48 + Math.cos(ang) * radius;
    const y = 48 + Math.sin(ang) * radius;
    const active = a.state !== "idle" && a.state !== "unavailable";
    const dot = document.createElement("div");
    dot.className = "absolute rounded-full" + (active ? " animate-pulse" : "");
    dot.style.cssText = `width:6px;height:6px;background:${a.color};left:${x}px;top:${y}px;transform:translate(-50%,-50%);`;
    wrap.appendChild(dot);
  });
  const activeCount = list.filter((a) => a.state !== "idle" && a.state !== "unavailable").length;
  document.getElementById("overview-count").textContent = `${activeCount} of ${list.length} agents active`;
}

// ---------------- Room (Three.js) ----------------
function buildRoom() {
  const mount = document.getElementById("room-3d");
  ROOM3D.init(mount);
  Object.values(agents).forEach((a) => ROOM3D.addAgent(a, (id) => selectAgent(id)));
  ROOM3D.start();
  refreshRoomVisualState();
}
function refreshRoomVisualState() {
  Object.values(agents).forEach((a) => {
    ROOM3D.setAgentState(a.id, a.state, a.id === selectedAgentId, a.action);
  });
}

function selectAgent(id) {
  selectedAgentId = id;
  renderSidebar();
  renderTaskPanel();
  refreshRoomVisualState();
}

// ---------------- Apply incoming state update ----------------
function applyStateUpdate(update) {
  const a = agents[update.agentId];
  if (!a) return;
  const stateChanged = a.state !== update.state;
  a.state = update.state;
  a.label = update.label;
  a.action = update.action || null;
  a.meta = update.meta || null;
  a.updated_at = update.updated_at || Date.now();
  if (stateChanged) TERMINAL.append(a.name, a.color, update);
  renderSidebar();
  renderTaskPanel();
  renderOverview();
  refreshRoomVisualState();
}

// ---------------- Clock ----------------
function tickClock() {
  document.getElementById("clock").textContent = new Date().toTimeString().slice(0, 8);
}
setInterval(tickClock, 1000);
tickClock();

// ---------------- Boot ----------------
async function init() {
  TERMINAL.init(document.getElementById("terminal-body"));
  TERMINAL.boot("booting spatial monitor, fetching agent registry...");

  let meta = [];
  try {
    const res = await fetch(`${WATCHER_URL}/api/agents`);
    meta = await res.json();
  } catch (e) {
    TERMINAL.boot("failed to reach watcher service at /api/agents");
    return;
  }

  meta.forEach((m) => {
    agents[m.id] = { ...m, state: "idle", label: "Idle", updated_at: Date.now() };
  });

  buildRoom();
  renderSidebar();
  renderOverview();
  renderTaskPanel();

  const wsDot = document.getElementById("ws-dot");
  const wsLabel = document.getElementById("ws-label");

  const socket = io(WATCHER_URL);
  socket.on("connect", () => {
    wsDot.className = "w-1.5 h-1.5 rounded-full bg-green-500";
    wsLabel.className = "text-green-500";
    wsLabel.textContent = "connected";
    TERMINAL.boot("websocket connected");
  });
  socket.on("disconnect", () => {
    wsDot.className = "w-1.5 h-1.5 rounded-full bg-red-500";
    wsLabel.className = "text-red-500";
    wsLabel.textContent = "disconnected";
    TERMINAL.boot("websocket disconnected, retrying...");
  });
  socket.on("agent:snapshot", (snapshot) => snapshot.forEach(applyStateUpdate));
  socket.on("agent:state", (update) => applyStateUpdate(update));
}

if (window.THREE) init();
else window.addEventListener("three-ready", () => init(), { once: true });
