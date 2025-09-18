import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Visual horse race renderer with lightweight confetti overlay.
 */
export default function RaceTrack({
  horses = [],
  positions = [],
  trackLen = 100,
  stage = "betting",
  events = {},
  winner = null,
  showConfetti = false,
}) {
  const confettiPieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        emoji: ["🎉", "✨", "🥳", "🎊", "💥", "💫"][i % 6],
        x: Math.random() * 100,
        d: 0.9 + Math.random() * 0.8,
      })),
    []
  );

  const runnerPercent = (idx) => {
    const pos = positions[idx] ?? 0;
    if (!Number.isFinite(pos) || trackLen <= 0) return 0;
    return Math.min(97, Math.max(0, (pos / trackLen) * 100));
  };

  const barWidth = (pct) => Math.min(100, pct + 3);

  return (
    <div className="track-card">
      <div className="track-header">
        <span className="track-stage-badge">{stage.toUpperCase()}</span>
        <span className="track-meta">Track length: {trackLen}</span>
      </div>

      <div className="track-surface">
        {horses.length ? (
          horses.map((horse, idx) => {
            const pct = runnerPercent(idx);
            return (
              <div key={horse.slot ?? idx} className="track-lane">
                <div className="lane-background" />
                <div
                  className="lane-progress"
                  style={{ width: `${barWidth(pct)}%` }}
                />
                <motion.div
                  className="lane-runner"
                  initial={false}
                  animate={{ left: `${pct}%` }}
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
          <div className="track-empty">Awaiting next line-up...</div>
        )}
      </div>

      <AnimatePresence>
        {showConfetti && (
          <motion.div
            key="confetti"
            className="confetti-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {confettiPieces.map((piece) => (
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
