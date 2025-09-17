import React, { useEffect, useRef, useState } from "react";

export default function ChatPanel({ currentUser = "User1" }) {
  const [lines, setLines] = useState([]);
  const [text, setText] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    function onChat(ev) {
      const { user, text } = ev.detail || {};
      if (!text) return;
      setLines((prev) => [...prev, { user, text }]);
    }
    function onStatus(ev) {
      const s = ev.detail?.status || ev.detail;
      setLines((prev) => [...prev, { sys: true, text: `[status] ${s}` }]);
    }
    window.addEventListener("pfc-chat", onChat);
    window.addEventListener("pfc-status", onStatus);
    return () => {
      window.removeEventListener("pfc-chat", onChat);
      window.removeEventListener("pfc-status", onStatus);
    };
  }, []);

  useEffect(() => {
    // autoscroll
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lines]);

  const sendToBackend = (payload) => {
    // via the bridge IIFE
    if (window.PFCBridge?.sendRaw) {
      window.PFCBridge.sendRaw(payload);
    } else if (window.PFCBridge?.sendChat && typeof payload.text === "string") {
      window.PFCBridge.sendChat(payload.text, payload.user);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;

    // Optimistic UI for bets
    const m = /^!bet\s+(\d+)\s+(\d+)/i.exec(msg);
    if (m) {
      const amount = parseInt(m[1], 10);
      const horse = parseInt(m[2], 10);
      if (Number.isFinite(amount) && Number.isFinite(horse)) {
        setLines((prev) => [...prev, { sys: true, text: `${currentUser} betted ${amount}$ on horse #${horse}` }]);
      }
    }

    // Show user's line immediately
    setLines((prev) => [...prev, { user: currentUser, text: msg }]);

    // Send to backend for real processing (backend replies will come back as chat lines)
    sendToBackend({ type: "chat", user: currentUser, text: msg });

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
