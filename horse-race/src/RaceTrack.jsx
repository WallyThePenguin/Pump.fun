// src/RaceTrack.jsx
import React from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Visual horse race renderer with winner banner + confetti.
 * Props:
 * - horses: [{ slot, emoji }]
 * - positions: number[] (0..trackLen)
 * - trackLen: number
 * - phase: "bet" | "racing" | "payout"
 * - events: { [slot]: string } // e.g., "🚀", "🍌"
 * - winner: number | null
 * - pools: Map<number, number>
 * - odds: Map<number, number> (optional)
 */
export default function RaceTrack({
  horses,
  positions,
  trackLen = 100,
  phase = "bet",
  events = {},
  winner = null,
  pools,
  odds,
}) {
  const pct = (v) => `${Math.max(0, Math.min(100, (v / trackLen) * 100))}%`;

  const confettiEmojis = ["🎉", "🎊", "✨", "💥", "🪙", "🏁"];
  const confetti = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    emoji: confettiEmojis[i % confettiEmojis.length],
    x: Math.random() * 100,
    d: 0.9 + Math.random() * 0.8,
  }));

  return (
    <div className="race-wrap">
      <div className="race-bg w-full h-full rounded-3xl border border-gray-800 shadow-xl overflow-hidden relative">
        <div className="flex items-center justify-between px-4 py-3 bg-gray-900/60 border-b border-gray-800">
          <div className="text-sm text-gray-300">
            Phase: <span className="font-semibold text-white">{phase.toUpperCase()}</span>
          </div>
          <div className="text-xs text-gray-400">Track length: {trackLen}</div>
        </div>

        <div className="relative">
          <div
            className="absolute top-0 bottom-0 right-0 w-1 bg-gradient-to-b from-yellow-400 via-yellow-300 to-yellow-500"
            style={{ boxShadow: "0 0 12px rgba(250, 204, 21, 0.5)" }}
          />
          <div className="divide-y divide-gray-800">
            {horses.map((h, idx) => {
              const x = pct(positions[idx] || 0);
              const isWinner = winner === idx && phase === "payout";
              const pool = pools?.get(idx) || pools?.get(h.slot) || 0;
              const odd = odds?.get(idx) || odds?.get(h.slot);

              return (
                <div key={h.slot} className="relative h-16 md:h-20 bg-gradient-to-r from-gray-950 to-gray-900">
                  <div className="absolute inset-y-0 left-0 bg-gray-800/40" style={{ width: x }} />
                  <motion.div
                    className="absolute top-1/2 -translate-y-1/2 left-2 flex items-center gap-3"
                    animate={{ x }}
                    transition={{ type: "spring", stiffness: 120, damping: 18 }}
                  >
                    <div className={`text-2xl md:text-3xl ${isWinner ? "animate-bounce" : ""}`}>{h.emoji}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm md:text-base font-semibold">#{h.slot + 1}</span>
                      <AnimatePresence>
                        {events[idx] && (
                          <motion.span
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            className="text-xs md:text-sm text-yellow-300 bg-yellow-900/20 px-2 py-0.5 rounded-full"
                          >
                            {events[idx]}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 text-right text-xs md:text-sm">
                    <div className="text-gray-400">Pool: {Math.floor(pool).toLocaleString()}</div>
                    <div className="text-gray-300">{odd ? `Odds: ${odd.toFixed(2)}x` : "Odds: –"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <AnimatePresence>
          {phase === "payout" && winner != null && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="p-3 text-center text-green-300 bg-green-900/20 border-t border-gray-800 relative overflow-hidden"
            >
              Winner:{" "}
              <span className="font-semibold">
                {horses[winner].emoji} #{horses[winner].slot + 1}
              </span>{" "}
              🎉
              <div className="pointer-events-none absolute inset-0">
                {confetti.map((c) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: -20, x: `${c.x}%`, rotate: 0 }}
                    animate={{ opacity: 1, y: "120%", rotate: 360 }}
                    transition={{ duration: 1.6 * c.d, ease: "easeOut" }}
                    className="absolute text-xl"
                  >
                    {c.emoji}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
