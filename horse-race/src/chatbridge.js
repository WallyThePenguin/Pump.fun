// src/chatbridge.js (frontend transport + optimistic bet echo)
(function () {
  const WS_URL = window.PFC_WS_URL || "ws://localhost:4001";
  const BACKOFF_MAX_MS = 60_000;

  // prevent multiple instances (hot reload safety)
  if (window.__pfcFrontendBridge?.alive) return;
  const state = {
    alive: true,
    ws: null,
    tries: 0,
    status: "init",
  };
  window.__pfcFrontendBridge = state;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (n) => n + Math.floor(Math.random() * 400);
  const backoff = () => Math.min(1000 * Math.pow(2, state.tries++), BACKOFF_MAX_MS);

  function setStatus(s) {
    state.status = s;
    window.dispatchEvent(new CustomEvent("pfc-status", { detail: { status: s } }));
  }

  function dispatchChat(user, text) {
    window.dispatchEvent(new CustomEvent("pfc-chat", { detail: { user, text } }));
  }

  // Public API (for your React/vanilla UI)
  window.PFCBridge = {
    // low-level send for prepared payloads (no optimistic echo)
    sendRaw(payload) {
      if (!payload || typeof payload !== "object") return;
      send(payload);
    },

    // send a raw chat line to backend (it will process commands & reply back to UI)
    sendChat(user, text) {
      const u = (user || "you").trim() || "you";
      const msg = String(text ?? "").trim();
      if (!msg) return;
      // echo user's own line immediately (optional UX)
      dispatchChat(u, msg);
      send({ type: "chat", user: u, text: msg });
    },

    // helper for bets with optimistic UI line exactly as requested
    sendBet(user, amount, horse) {
      const u = (user || "you").trim() || "you";
      const a = Math.max(1, Math.floor(+amount || 0));
      const h = Math.max(1, Math.min(8, Math.floor(+horse || 1)));

      // your requested optimistic echo:
      dispatchChat("system", `${u} betted ${a}$ on horse #${h}`);

      // also show the actual command the user typed (optional; comment out if you don't want it)
      dispatchChat(u, `!bet ${a} ${h}`);

      // send to backend (backend will confirm success/error)
      send({ type: "chat", user: u, text: `!bet ${a} ${h}` });
    },

    status() {
      return state.status;
    },
  };

  function send(obj) {
    try {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(obj));
      }
    } catch {}
  }

  (async function connectLoop() {
    while (state.alive) {
      setStatus("connecting");
      let ws;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        setStatus("backoff");
        await sleep(jitter(backoff()));
        continue;
      }

      const opened = await new Promise((resolve) => {
        let done = false;
        const onOpen = () => {
          if (!done) {
            done = true;
            resolve(true);
          }
        };
        const onError = () => {
          if (!done) {
            done = true;
            resolve(false);
          }
        };
        ws.addEventListener("open", onOpen, { once: true });
        ws.addEventListener("error", onError, { once: true });
      });

      if (!opened) {
        setStatus("backoff");
        await sleep(jitter(backoff()));
        continue;
      }

      // Connected
      state.ws = ws;
      state.tries = 0;
      setStatus("open");

      ws.addEventListener("message", (ev) => {
        let data = null;
        try {
          data = JSON.parse(ev.data);
        } catch {}
        if (!data) return;

        // From backend: {type:"chat", user, text}
        if (data.type === "chat" && typeof data.text === "string") {
          dispatchChat(data.user || "bridge", String(data.text));
          return;
        }

        // From backend: status updates
        if (data.type === "pfc-status") {
          setStatus(data.status || "open");
          return;
        }
      });

      await new Promise((resolve) => {
        ws.addEventListener("close", () => resolve(), { once: true });
        ws.addEventListener("error", () => {
          try {
            ws.close();
          } catch {}
        });
      });

      setStatus("backoff");
      await sleep(jitter(backoff()));
    }
  })();
})();

