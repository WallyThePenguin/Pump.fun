// src/chatprocessor.jsx
import { PumpFunChat } from "pump-fun-chat-mcp";

const chat = new PumpFunChat({ token: "YOUR_TOKEN_ADDRESS" });

chat.on("message", async (msg) => {
  const text = (msg.text || "").trim();
  if (!text.toLowerCase().startsWith("!bet")) return;

  const parts = text.split(/\s+/);
  const horse = (parseInt(parts[1], 10) || 1) - 1; // 0..7
  const amount = Math.max(1, Math.floor(+parts[2] || 0));

  try {
    await fetch("http://localhost:4000/bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: msg.user || "guest", horse, amount }),
    });
  } catch (e) {
    console.error("bet error", e);
  }

  // Optional UI event
  window.dispatchEvent(new CustomEvent("pfc-chat", { detail: { user: msg.user, text } }));
});

chat.connect();
