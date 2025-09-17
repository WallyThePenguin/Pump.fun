import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Visual horse race renderer with winner banner + confetti.
 */
export default function RaceTrack({
  horses = [],
  positions = [],
  trackLen = 100,
  stage = "betting",
  events = {},
  winner = null,
}) {
  const highlightWinner = stage === "cooldown" && winner != null;
  const confetti = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        id: i,
        emoji: ["🎉", "✨", "🥇", "🎊"][i % 4],
        x: Math.random() * 100,
        d: 0.9 + Math.random() * 0.8,
      })),
    []
  );

  const getProgress = (idx) => {
    const pos = positions[idx] ?? 0;
    const pct = trackLen > 0 ? Math.min(100, (pos / trackLen) * 100) : 0;
    return `${pct}%`;
  };

  return (
    <div className="track-card">
      <div className="track-header">
        <span className="track-stage-badge">{stage.toUpperCase()}</span>
        <span className="track-meta">Track length: {trackLen}</span>
      </div>

      <div className="track-surface">
        {horses.length ? (
          horses.map((horse, idx) => {
            const progress = getProgress(idx);
            const isWinner = highlightWinner && winner === idx;
            return (
              <div key={horse.slot ?? idx} className={`track-lane ${isWinner ? "lane-winner" : ""}`}>
                <div className="lane-background" />
                <div className="lane-progress" style={{ width: progress }} />
                <motion.div
                  className="lane-runner"
                  initial={false}
                  animate={{ left: progress }}
                  transition={{ type: "spring", stiffness: 160, damping: 22 }}
                >
                  <span className="lane-emoji">{horse.emoji || "🐎"}</span>
                  <span className="lane-number">#{(horse.slot ?? idx) + 1}</span>
                  <AnimatePresence>
                    {events[idx] && (
                      <motion.span
                        key={`${idx}-${events[idx]}`}
                        className="lane-event"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                      >
                        {events[idx]}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>
            );
          })
        ) : (
          <div className="track-empty">Awaiting next line-up…</div>
        )}
      </div>

      <AnimatePresence>
        {highlightWinner && winner != null && horses[winner] && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="track-banner"
          >
            <span className="banner-text">
              Winner: {horses[winner].emoji} #{(horses[winner].slot ?? winner) + 1}
            </span>
            <div className="confetti-wrap" aria-hidden>
              {confetti.map((piece) => (
                <motion.span
                  key={piece.id}
                  className="confetti-piece"
                  initial={{ opacity: 0, y: -20, x: `${piece.x}%`, rotate: 0 }}
                  animate={{ opacity: 1, y: "120%", rotate: 360 }}
                  transition={{ duration: 1.6 * piece.d, ease: "easeOut" }}
                >
                  {piece.emoji}
                </motion.span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
