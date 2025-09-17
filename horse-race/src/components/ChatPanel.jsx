import React, { useCallback, useEffect, useRef, useState } from "react";

const MAX_LINES = 200;

export default function ChatPanel({ currentUser = "User1" }) {
  const [lines, setLines] = useState([]);
  const [text, setText] = useState("");
  const listRef = useRef(null);

  const appendLine = useCallback((entry) => {
    if (!entry || !entry.text) return;
    setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), entry]);
  }, []);

  useEffect(() => {
    function onChat(ev) {
      const { user, text } = ev.detail || {};
      if (!text) return;
      appendLine({ user: user || "bridge", text: String(text) });
    }

    function onStatus(ev) {
      const s = ev.detail?.status || ev.detail;
      if (!s) return;
      appendLine({ sys: true, text: `[status] ${s}` });
    }

    window.addEventListener("pfc-chat", onChat);
    window.addEventListener("pfc-status", onStatus);
    return () => {
      window.removeEventListener("pfc-chat", onChat);
      window.removeEventListener("pfc-status", onStatus);
    };
  }, [appendLine]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTo({ top: listRef.current.scrollHeight });
  }, [lines]);

  const onSubmit = (e) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;

    const bridge = window.PFCBridge;
    const betMatch = /^!bet\s+(\d+)\s+(\d+)/i.exec(msg);

    if (bridge) {
      if (betMatch && typeof bridge.sendBet === "function") {
        const amount = parseInt(betMatch[1], 10);
        const horse = parseInt(betMatch[2], 10);
        if (Number.isFinite(amount) && Number.isFinite(horse)) {
          bridge.sendBet(currentUser, amount, horse);
        } else if (typeof bridge.sendChat === "function") {
          bridge.sendChat(currentUser, msg);
        }
      } else if (typeof bridge.sendChat === "function") {
        bridge.sendChat(currentUser, msg);
      } else if (typeof bridge.sendRaw === "function") {
        bridge.sendRaw({ type: "chat", user: currentUser, text: msg });
      } else {
        appendLine({ user: currentUser, text: msg });
      }
    } else {
      appendLine({ sys: true, text: "[warn] chat bridge offline; message not sent" });
      appendLine({ user: currentUser, text: msg });
    }

    setText("");
  };

  return (
    <div className="w-full max-w-xl mx-auto border rounded-xl overflow-hidden">
      <div ref={listRef} className="h-80 overflow-y-auto p-3 space-y-1 bg-black/5">
        {lines.map((l, idx) => (
          <div key={idx} className="text-sm">
            {l.sys ? (
              <span className="text-gray-500 italic">{l.text}</span>
            ) : (
              <>
                <span className="font-semibold">{l.user}:</span> <span>{l.text}</span>
              </>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={onSubmit} className="flex gap-2 p-3 border-t bg-white">
        <input
          className="flex-1 border rounded-lg px-3 py-2 outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type !bet 100 3, !balance, !leaderboard, or !help"
        />
        <button className="px-4 py-2 rounded-lg border bg-black text-white" type="submit">
          Send
        </button>
      </form>
    </div>
  );
}
