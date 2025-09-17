import React, { useCallback, useEffect, useRef, useState } from "react";

const MAX_LINES = 200;

export default function ChatPanel() {
  const [lines, setLines] = useState([]);
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

  return (
    <div className="chat-panel">
      <div ref={listRef} className="chat-panel__messages">
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={`chat-panel__line${line.sys ? " chat-panel__line--system" : ""}`}
          >
            {line.sys ? (
              <span>{line.text}</span>
            ) : (
              <>
                <strong>{line.user}:</strong> <span>{line.text}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
