// llmDecision.js
//
// Modul ini bagi robot ExpensePilot "fikiran sendiri" - setiap kali ada row
// baru (expense/debt), kita hantar data tu ke Ollama Cloud dan minta model
// PUTUSKAN sendiri macam mana robot patut bergerak/bertindak balas (bukan
// sekadar pilih dari beberapa "action" pra-takrif).
//
// PENTING - dua lapis keselamatan:
// 1. Ollama "format" parameter (JSON Schema) - constrained decoding, model
//    SECARA TEKNIKAL tak boleh keluar dari struktur skema ni semasa generate.
// 2. validateAndClamp() di bawah - safety net tambahan kita sendiri, sebab
//    walaupun struktur betul, NILAI di dalam (cth durationMs=999999,
//    waypoint="dapur" yang tak wujud) masih boleh "pelik". Kita clamp/repair
//    nilai sebelum hantar ke frontend, supaya robot tak sekali-kali "rosak"
//    visualnya walau apa pun respons LLM.
//
// Kalau API gagal/timeout/respons tak valid langsung, kita FALLBACK ke
// sequence default (deterministic) - robot tetap bergerak, cuma dengan
// "fikiran" generik, bukan freeze/diam.

const VALID_WAYPOINTS = ["aisle", "sideAisle", "vault", "desk", "idle"];
const VALID_EFFECTS = ["vault_open", "vault_close", "calc_flicker", "dial_pulse", null];
const MIN_DURATION = 300;
const MAX_DURATION = 3000;
const MAX_MOVES = 6;

// JSON Schema yang dihantar ke Ollama "format" param - ini yang constrain
// model semasa decoding (bukan sekadar instruction dalam prompt).
const DECISION_SCHEMA = {
  type: "object",
  properties: {
    thought: { type: "string", description: "Ayat pendek (bawah 12 patah perkataan) apa robot \"fikir\" tentang transaksi ni." },
    mood: { type: "string", enum: ["calm", "concerned", "alert", "pleased"] },
    visorColor: { type: "string", description: "Hex color, cth #7fd8ff" },
    moves: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          waypoint: { type: "string", enum: VALID_WAYPOINTS },
          durationMs: { type: "integer" },
          holdMs: { type: "integer" },
          effect: { type: ["string", "null"], enum: VALID_EFFECTS },
        },
        required: ["waypoint", "durationMs", "holdMs"],
      },
    },
  },
  required: ["thought", "mood", "visorColor", "moves"],
};

function clampNumber(n, min, max, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function isValidHexColor(c) {
  return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c);
}

// Safety net: betulkan/buang apa-apa nilai yang tak masuk akal walaupun
// struktur JSON dah betul. Pulangkan null kalau data terlalu rosak untuk
// dipulihkan (caller akan fallback ke default sequence).
function validateAndClamp(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.moves) || raw.moves.length === 0) return null;

  const moves = raw.moves
    .slice(0, MAX_MOVES)
    .map((m) => {
      if (!m || !VALID_WAYPOINTS.includes(m.waypoint)) return null;
      return {
        waypoint: m.waypoint,
        durationMs: clampNumber(m.durationMs, MIN_DURATION, MAX_DURATION, 800),
        holdMs: clampNumber(m.holdMs, 0, MAX_DURATION, 0),
        effect: VALID_EFFECTS.includes(m.effect) ? m.effect : null,
      };
    })
    .filter(Boolean);

  if (moves.length === 0) return null;

  // Sentiasa pastikan move TERAKHIR adalah "idle", supaya robot tak
  // tersangkut di vault/desk kalau LLM terlupa letak step balik.
  if (moves[moves.length - 1].waypoint !== "idle") {
    moves.push({ waypoint: "idle", durationMs: 800, holdMs: 0, effect: null });
  }

  const thought =
    typeof raw.thought === "string" && raw.thought.trim() ? raw.thought.trim().slice(0, 120) : "Processing...";
  const mood = ["calm", "concerned", "alert", "pleased"].includes(raw.mood) ? raw.mood : "calm";
  const visorColor = isValidHexColor(raw.visorColor) ? raw.visorColor : "#7fd8ff";

  return { thought, mood, visorColor, moves };
}

// Fallback deterministic - dipakai kalau LLM call gagal/timeout/respons rosak.
// Ini sequence "expense_small" yang sama macam sebelum kita ada LLM,
// supaya robot still functional walaupun Ollama Cloud down.
function fallbackDecision(rowType) {
  if (rowType === "debt") {
    return {
      thought: "Filing this record.",
      mood: "calm",
      visorColor: "#f59e0b",
      moves: [
        { waypoint: "aisle", durationMs: 700, holdMs: 0, effect: null },
        { waypoint: "sideAisle", durationMs: 600, holdMs: 0, effect: null },
        { waypoint: "vault", durationMs: 500, holdMs: 1200, effect: "vault_open" },
        { waypoint: "sideAisle", durationMs: 500, holdMs: 0, effect: "vault_close" },
        { waypoint: "aisle", durationMs: 600, holdMs: 0, effect: null },
        { waypoint: "idle", durationMs: 700, holdMs: 0, effect: null },
      ],
    };
  }
  return {
    thought: "Logging this expense.",
    mood: "calm",
    visorColor: "#7fd8ff",
    moves: [
      { waypoint: "aisle", durationMs: 700, holdMs: 0, effect: null },
      { waypoint: "sideAisle", durationMs: 600, holdMs: 0, effect: null },
      { waypoint: "vault", durationMs: 500, holdMs: 500, effect: "vault_open" },
      { waypoint: "sideAisle", durationMs: 500, holdMs: 0, effect: "vault_close" },
      { waypoint: "aisle", durationMs: 600, holdMs: 0, effect: null },
      { waypoint: "desk", durationMs: 700, holdMs: 1000, effect: "calc_flicker" },
      { waypoint: "aisle", durationMs: 700, holdMs: 0, effect: null },
      { waypoint: "idle", durationMs: 700, holdMs: 0, effect: null },
    ],
  };
}

function buildPrompt(rowType, row, context) {
  const lines = [];
  lines.push(
    `You are the "mind" of a small robot character named ExpensePilot in a 3D office dashboard. ` +
      `It just detected a new ${rowType === "debt" ? "debt" : "expense"} entry. Decide how the robot ` +
      `should react: walk to the vault (to get/file cash or records), optionally the desk (to calculate), ` +
      `and back to idle. Keep the tone light and brief, like a quick inner thought.`
  );
  lines.push(`Entry data: ${JSON.stringify(row)}`);
  if (context && context.length) {
    lines.push(`Recent entries for context: ${JSON.stringify(context)}`);
  }
  lines.push(
    `Respond with your decision as the structured fields requested. ` +
      `"moves" should be a short sequence (2-6 steps) describing the robot's path: each step has a ` +
      `waypoint (one of: aisle, sideAisle, vault, desk, idle), how long it takes to walk there (durationMs, ` +
      `300-3000), how long to pause there (holdMs, 0-3000), and an optional effect to trigger on arrival ` +
      `(vault_open, vault_close, calc_flicker, dial_pulse, or null). The LAST step should return to "idle". ` +
      `Use "mood" and "visorColor" to reflect how the robot feels about this entry (e.g. a concerning large ` +
      `expense could use mood="concerned" and a warmer/red-ish visorColor).`
  );
  return lines.join("\n\n");
}

// Panggil Ollama Cloud. Pulangkan keputusan yang dah divalidate, ATAU
// fallback deterministic kalau apa-apa gagal (network, timeout, JSON rosak).
async function decide(rowType, row, context, cfg) {
  const timeoutMs = cfg.timeoutMs || 12000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${cfg.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: buildPrompt(rowType, row, context) }],
        format: DECISION_SCHEMA,
        stream: false,
        options: { temperature: 0.4 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[llmDecision] Ollama Cloud respons HTTP ${res.status} - guna fallback.`);
      return fallbackDecision(rowType);
    }

    const data = await res.json();
    const content = data && data.message && data.message.content;
    if (!content) {
      console.error("[llmDecision] respons Ollama tak ada message.content - guna fallback.");
      return fallbackDecision(rowType);
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("[llmDecision] gagal parse JSON dari respons LLM - guna fallback.", e.message);
      return fallbackDecision(rowType);
    }

    const validated = validateAndClamp(parsed);
    if (!validated) {
      console.error("[llmDecision] respons LLM tak lepas validation - guna fallback.");
      return fallbackDecision(rowType);
    }

    return validated;
  } catch (err) {
    if (err.name === "AbortError") {
      console.error(`[llmDecision] Ollama Cloud timeout (${timeoutMs}ms) - guna fallback.`);
    } else {
      console.error("[llmDecision] ralat memanggil Ollama Cloud - guna fallback.", err.message);
    }
    return fallbackDecision(rowType);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { decide, fallbackDecision, validateAndClamp };
