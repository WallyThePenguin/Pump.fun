// chat-bridge.js  (READ-ONLY • UI replies only • Drop-in)
// - Listens to Pump.fun chat (no auth needed)
// - Accepts UI messages over ws://localhost:4001
// - Processes commands and replies ONLY to your UI
// - Instantly echoes bets as: "User1 betted 100$ on horse #x"

const { PumpChatClient } = require("pump-chat-client");
const WebSocket = require("ws");
const http = require("http");

// Node 18+ has global fetch; backfill for older
const fetch = global.fetch || ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

// ---------- Config ----------
const REQUIRED_ROOM_ID = "3mpnrWoDtsQsmjaQNeB6cfXNgWfXMfwwF6Nu6Due5Guj";
const envRoom =
  (process.env.pump_fun_token && process.env.pump_fun_token.trim()) ||
  (process.env.PUMP_FUN_TOKEN && process.env.PUMP_FUN_TOKEN.trim());
if (envRoom && envRoom !== REQUIRED_ROOM_ID) {
  console.warn("[config] Overriding Pump.fun room token from environment.");
}
process.env.PUMP_FUN_TOKEN = REQUIRED_ROOM_ID;
process.env.pump_fun_token = REQUIRED_ROOM_ID;
const roomId = REQUIRED_ROOM_ID;
const PORT = Number(process.env.CHAT_BRIDGE_PORT || 4001);
// Your game API endpoints
const GAME_BASE = process.env.GAME_BASE || "http://localhost:4000";
const URL_BALANCE = `${GAME_BASE}/balance`;
const URL_LEADERBOARD = `${GAME_BASE}/leaderboard`;
const URL_BET = `${GAME_BASE}/bet`;

// ---------- Local WS (frontend bridge) ----------
const server = http.createServer();
const wss = new WebSocket.Server({ server });

const clients = new Set();
server.listen(PORT, () => {
  console.log(`Chat bridge (READ-ONLY) on ws://localhost:${PORT} — room ${roomId}`);
});

wss.on("connection", (ws) => {
  clients.add(ws);
  safeSend(ws, { type: "hello", ok: true, mode: "read-only" });

  ws.on("message", async (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "chat" && typeof msg.text === "string") {
      const user = (msg.user || "you").trim() || "you";
      const text = msg.text.trim();
      // show their line in UI
      broadcast({ type: "chat", user, text });
      // handle as command (UI-originated)
      await handleCommand(user, text, { optimisticBetEcho: true });
    }
  });

  ws.on("close", () => clients.delete(ws));
});

// keep browser sockets alive
setInterval(() => {
  for (const ws of clients) {
    try {
      ws.ping();
    } catch {}
  }
}, 25_000);

function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const c of clients) {
    try {
      c.send(s);
    } catch {}
  }
}
function safeSend(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}
function uiSay(text, user = "bridge") {
  broadcast({ type: "chat", user, text: String(text) });
}
function uiStatus(status, info = {}) {
  broadcast({ type: "pfc-status", status, ...info });
}

// ---------- Commands ----------
async function handleCommand(user, text, opts = {}) {
  const optimistic = !!opts.optimisticBetEcho;
  const line = String(text || "").trim();
  if (!line) return false;

  // !help
  if (/^!help$/i.test(line)) {
    uiSay("Commands: !bet <amount> <horse(1-8)> | !balance | !leaderboard");
    return true;
  }

  // !balance
  if (/^!balance$/i.test(line)) {
    try {
      const r = await fetch(`${URL_BALANCE}?user=${encodeURIComponent(user)}`);
      const j = await r.json();
      if (j?.ok) uiSay(`${user}, you have ${j.balance} coins.`);
      else uiSay(`${user}, balance error: ${j?.error || "unknown"}.`);
    } catch {
      uiSay(`${user}, balance error.`);
    }
    return true;
  }

  // !leaderboard
  if (/^!leaderboard$/i.test(line)) {
    try {
      const r = await fetch(URL_LEADERBOARD);
      const j = await r.json();
      if (j?.ok) {
        const top = (j.players || []).slice(0, 10);
        const msg = top.map((p, i) => `${i + 1}. ${p.name}: ${p.balance}`).join(" | ");
        uiSay(`🏆 Leaderboard → ${msg}`);
      } else {
        uiSay(`Leaderboard error: ${j?.error || "unknown"}`);
      }
    } catch {
      uiSay("Leaderboard error.");
    }
    return true;
  }

  // !bet <amount> <horse>
  const m = /^!bet\s+(\d+)\s+(\d+)/i.exec(line);
  if (m) {
    const amount = Math.max(1, Math.floor(+m[1] || 0));
    let horseHuman = Math.max(1, Math.min(8, Math.floor(+m[2] || 1))); // 1..8 for UI
    const horseIdx = horseHuman - 1; // 0..7 for backend

    if (!Number.isFinite(amount) || amount <= 0) {
      uiSay(`${user}, usage: !bet <amount> <horse(1-8)>`);
      return true;
    }

    // Instant UI echo (your requested format)
    if (optimistic) {
      uiSay(`${user} betted ${amount}$ on horse #${horseHuman}`, "system");
    }

    try {
      const res = await fetch(URL_BET, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, horse: horseIdx, amount }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        uiSay(`✅ ${user} bet ${amount} on #${horseHuman}. New balance: ${j.balance}`);
      } else {
        uiSay(`❌ Bet failed for ${user}: ${j?.error || res.status}`);
      }
    } catch {
      uiSay(`❌ Bet failed for ${user}.`);
    }
    return true;
  }

  return false;
}

// ---------- Pump.fun (read-only) ----------
let chat,
  backoff = 0;
const MAX_BACKOFF = 60_000;
const MIN_BACKOFF = 3_000;
let reconnectTimer = null;
let connectingPump = false;

async function connectPump() {
  if (connectingPump) return;
  connectingPump = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (chat?.disconnect) {
    try {
      chat.disconnect();
    } catch {}
  }

  chat = new PumpChatClient({
    roomId,
    username: "bridge", // display name only (we don't send)
    messageHistoryLimit: 100,
  });

  chat.on?.("connected", () => {
    backoff = 0;
    console.log("[Pump] connected (read-only)");
    uiStatus("open");
    uiSay("bridge online (read-only): !bet <amount> <horse(1-8)>, !balance, !leaderboard");
  });

  chat.on?.("disconnected", () => {
    console.log("[Pump] disconnected");
    uiStatus("backoff");
    scheduleReconnect("disconnect");
  });

  chat.on?.("error", (e) => {
    const message = e?.message || String(e);
    console.warn("[Pump] error:", message);
    uiStatus("error", { message });
    if (String(message).includes("429")) {
      backoff = Math.max(backoff, 30_000);
    }
    scheduleReconnect("error");
  });

  // Forward Pump chat to UI; handle commands (no sending to Pump)
  chat.on?.("message", async (m) => {
    const user = m?.username || "guest";
    const text = String(m?.message || "").trim();
    if (!text) return;

    // Always show the raw line from Pump in your UI
    broadcast({ type: "chat", user, text });

    // Process commands (no optimistic echo here, since it's from Pump)
    await handleCommand(user, text, { optimisticBetEcho: false });
  });

  try {
    await chat.connect();
  } catch (e) {
    const message = e?.message || String(e);
    console.error("[Pump] connect failed:", message);
    uiStatus("error", { message });
    scheduleReconnect("connect_failed");
  } finally {
    connectingPump = false;
  }
}

function scheduleReconnect(reason = "") {
  if (connectingPump) return;
  if (reconnectTimer) return;

  const base = backoff || MIN_BACKOFF;
  const delay = Math.min(Math.max(base, MIN_BACKOFF) * 1.5, MAX_BACKOFF);
  backoff = delay;
  const jitter = 250 + Math.floor(Math.random() * 750);
  const wait = Math.round(delay + jitter);
  const suffix = reason ? ` (${reason})` : "";
  console.log(`[Pump] reconnect in ${wait}ms${suffix}`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectPump().catch((e) => {
      const message = e?.message || String(e);
      console.error("[Pump] reconnect attempt failed:", message);
      uiStatus("error", { message });
    });
  }, wait);
}

// Start
connectPump().catch((e) => {
  console.error("[Pump] initial connect failed:", e?.message || e);
  uiStatus("error", { message: e?.message || String(e) });
  scheduleReconnect();
});

// ---------- Graceful shutdown ----------
function shutdown() {
  console.log("Shutting down chat-bridge (read-only)…");
  try {
    chat?.disconnect?.();
  } catch {}
  try {
    for (const c of clients) c.close();
    wss.close(() => process.exit(0));
  } catch {
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
