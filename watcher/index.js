// index.js
//
// Server utama untuk watcher service.
// 1. Baca agents.config.js
// 2. Untuk setiap agent, panggil watcher handler yang sepadan (ikut watch.type)
// 3. Simpan "current state" semua agent dalam memory
// 4. Bila browser connect via Socket.io, hantar snapshot semua state semasa
// 5. Bila state berubah, broadcast event ke semua client yang connect

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const agents = require("./agents.config");
const sessionFileWatcher = require("./watchers/sessionFile");
const csvAppendWatcher = require("./watchers/csvAppend");
const logTailWatcher = require("./watchers/logTail");
const googleSheetsPollWatcher = require("./watchers/googleSheetsPoll");

const DATA_ROOT = process.env.DATA_ROOT || "/opt/data";
const PORT = process.env.PORT || 4500;

const WATCHER_TYPES = {
  sessionFile: sessionFileWatcher,
  csvAppend: csvAppendWatcher,
  logTail: logTailWatcher,
  googleSheetsPoll: googleSheetsPollWatcher,
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }, // sesuaikan ikut domain dashboard kau bila dah deploy betul-betul
});

// In-memory snapshot of current state per agent id
const currentState = {};

agents.forEach((agent) => {
  currentState[agent.id] = { state: "idle", label: "Idle", updated_at: Date.now() };
});

function handleStateChange(agentId, partialState) {
  currentState[agentId] = {
    ...currentState[agentId],
    ...partialState,
    updated_at: Date.now(),
  };
  io.emit("agent:state", { agentId, ...currentState[agentId] });
  console.log(
    `[state] ${agentId} ->`,
    partialState.state,
    partialState.action ? `(${partialState.action})` : "",
    partialState.label || ""
  );
}

// Start a watcher per agent, based on its configured watch.type
const stopFns = [];
agents.forEach((agent) => {
  const handler = WATCHER_TYPES[agent.watch.type];
  if (!handler) {
    console.warn(`[warn] No watcher handler for type "${agent.watch.type}" (agent: ${agent.id})`);
    return;
  }
  const stop = handler.start(agent, DATA_ROOT, handleStateChange);
  if (typeof stop === "function") stopFns.push(stop);
});

app.get("/health", (req, res) => res.json({ ok: true, agents: agents.map((a) => a.id) }));

// Static metadata about agents (name/color/room position) - frontend fetches this once on load
app.get("/api/agents", (req, res) => {
  res.json(
    agents.map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      room: a.room,
      isBoss: a.isBoss || false,
      hasVault: a.hasVault || false,
      hasMonitor: a.hasMonitor || false,
    }))
  );
});

io.on("connection", (socket) => {
  console.log("[ws] client connected:", socket.id);
  // Send current snapshot immediately so new clients aren't blank until next change
  socket.emit(
    "agent:snapshot",
    Object.entries(currentState).map(([agentId, s]) => ({ agentId, ...s }))
  );
});

server.listen(PORT, () => {
  console.log(`Watcher service listening on :${PORT}, DATA_ROOT=${DATA_ROOT}`);
});

function shutdown() {
  console.log("Shutting down watchers...");
  stopFns.forEach((fn) => fn());
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
