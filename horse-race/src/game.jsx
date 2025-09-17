// src/game.jsx
import React, { useEffect, useRef, useState } from "react";
import RaceTrack from "./RaceTrack";
import ChatPanel from "./components/ChatPanel";
import { getOpenRace, createRace, startRace, finishRace, getLeaderboard } from "./api";

/**
 * Race timing + physics knobs
 * - TICK_MS: frame duration (higher = slower)
 * - BASE_VEL range keeps the race moving but not too fast
 * - ACCEL bounds control jitter from frame to frame
 * - EVENTS_* tune the balanced random events engine
 */
const TICK_MS = 95; // slower updates for longer, more suspenseful races

const BASE_VEL_MIN = 0.35;
const BASE_VEL_MAX = 1.0;
const ACCEL_MIN = -0.08;
const ACCEL_MAX = 0.12;
const MAX_VEL = 1.8;
const MIN_VEL = 0.12;

// random events dial
const EVENTS_CHANCE_PER_TICK = 0.035; // 3.5% per tick per horse
const EVENT_COOLDOWN_TICKS = 6; // after any event fires for a horse
const SHIELD_DURATION_TICKS = 4;

// mild, readable effects
const BOOST_VEL = 0.55;
const GUST_VEL = 0.35;
const SLOW_VEL = 0.5;
const STUMBLE_VEL = 0.1;
const WARP_MIN = 1.0;
const WARP_MAX = 2.2;
const SURGE_MIN = 2.2;
const SURGE_MAX = 3.2;
const BETTING_SECONDS = 30;
const COOLDOWN_SECONDS = 15;

const EVENT_BANDS = [
  { key: 'boost', label: '⚡', p: 0.22 },
  { key: 'slow', label: '🍌', p: 0.18 },
  { key: 'gust', label: '💨', p: 0.15 },
  { key: 'stumble', label: '💥', p: 0.13 },
  { key: 'shield', label: '🛡️', p: 0.06 },
  { key: 'warp', label: '✨', p: 0.08 },
  { key: 'surge', label: '🚀', p: 0.08 },
];

function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function formatCoins(n) {
  return Math.floor(n).toLocaleString();
}
function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STAGE_TITLES = {
  loading: "Preparing New Race",
  betting: "Place Your Bets",
  racing: "Race In Progress",
  cooldown: "Winners Circle",
  error: "Reconnecting",
};

const STAGE_MESSAGES = {
  loading: "Hang tight while we spin up the next race.",
  betting: "Drop !bet <amount> <horse>. Odds shift with every wager.",
  racing: "All bets locked. Watch the lanes!",
  cooldown: "Paying out winners and prepping the next heat.",
  error: "Connection hiccup. Recovering automatically.",
};

export default function HorseRacingGame() {
  const [race, setRace] = useState(null); // { id, track_len, status }
  const [horses, setHorses] = useState([]); // [{slot, emoji}]
  const [leaderboard, setLeaderboard] = useState([]); // [{name, balance}]
  const [stage, setStage] = useState("loading"); // 'loading' | 'betting' | 'racing' | 'cooldown' | 'error'
  const [countdown, setCountdown] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [positions, setPositions] = useState([]); // numbers 0..track_len
  const [events, setEvents] = useState({}); // per index, string emoji
  const [winner, setWinner] = useState(null);

  const frameRef = useRef(null);
  const stateRef = useRef(null); // hold live physics state between ticks
  const countdownTimersRef = useRef({ tick: null, stage: null });
  const runningRef = useRef(false);
  const recoveryRef = useRef(null);

  // refresh leaderboard periodically
  useEffect(() => {
    refreshLeaderboard();
    const leaderboardTimer = setInterval(refreshLeaderboard, 4000);
    return () => clearInterval(leaderboardTimer);
  }, []);

  // bootstrap automated race cycle
  useEffect(() => {
    let active = true;

    (async () => {
      const info = await ensureRace();
      if (!active) return;
      if (info) {
        startBettingPhase(info);
      } else {
        setStage("error");
        scheduleRecovery();
      }
    })();

    return () => {
      active = false;
      clearCountdownTimers();
    };
  }, []);
  async function refreshOpenRace() {
    try {
      const data = await getOpenRace();
      if (data?.race) {
        const nextHorses = data.horses || [];
        setRace(data.race);
        setHorses(nextHorses);
        setPositions(Array.from({ length: nextHorses.length }, () => 0));
        setEvents({});
        setWinner(null);
        return { race: data.race, horses: nextHorses };
      }
    } catch (e) {
      console.error("open race error", e);
    }

    setRace(null);
    setHorses([]);
    setPositions([]);
    setEvents({});
    return null;
  }

  async function refreshLeaderboard() {
    try {
      const data = await getLeaderboard();
      if (data?.ok) setLeaderboard(data.players || []);
    } catch (e) {
      console.error("leaderboard error", e);
    }
  }

  function clearCountdownTimers() {
    if (countdownTimersRef.current.tick) {
      clearInterval(countdownTimersRef.current.tick);
      countdownTimersRef.current.tick = null;
    }
    if (countdownTimersRef.current.stage) {
      clearTimeout(countdownTimersRef.current.stage);
      countdownTimersRef.current.stage = null;
    }
  }

  function startCountdown(seconds, onComplete) {
    clearCountdownTimers();
    if (!Number.isFinite(seconds) || seconds <= 0) {
      setCountdown(null);
      if (onComplete) onComplete();
      return;
    }

    setCountdown(seconds);
    countdownTimersRef.current.tick = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return prev;
        return prev > 0 ? prev - 1 : 0;
      });
    }, 1000);

    countdownTimersRef.current.stage = setTimeout(() => {
      clearCountdownTimers();
      setCountdown(0);
      if (onComplete) onComplete();
    }, seconds * 1000);
  }

  function scheduleRecovery(delay = 5000) {
    if (recoveryRef.current) return;
    recoveryRef.current = setTimeout(async () => {
      const info = await ensureRace();
      if (info) {
        recoveryRef.current = null;
        startBettingPhase(info);
        return;
      }
      recoveryRef.current = null;
      scheduleRecovery(Math.min(delay + 2000, 15000));
    }, delay);
  }

  async function ensureRace() {
    const info = await refreshOpenRace();
    if (info) return info;

    const created = await createRace().catch(() => null);
    if (!created?.ok) return null;

    return refreshOpenRace();
  }

  function startBettingPhase(info) {
    const horseCount = info?.horses?.length ?? horses.length;
    if (!horseCount) {
      return;
    }
    if (recoveryRef.current) {
      clearTimeout(recoveryRef.current);
      recoveryRef.current = null;
    }
    runningRef.current = false;
    setStage("betting");
    setLastResult(null);
    setEvents({});
    setWinner(null);
    startCountdown(BETTING_SECONDS, () => {
      beginRace();
    });
  }

  async function beginRace() {
    if (runningRef.current) return;
    const currentRace = race || (await ensureRace())?.race;
    if (!currentRace) {
      setStage("error");
      return;
    }

    runningRef.current = true;
    clearCountdownTimers();
    setCountdown(null);
    try {
      await startRace();
    } catch (e) {
      console.error("startRace error", e);
      runningRef.current = false;
      setStage("error");
      scheduleRecovery();
      return;
    }

    setStage("racing");
    runAnimation();
  }

  function startCooldown() {
    runningRef.current = false;
    setStage("cooldown");
    startCountdown(COOLDOWN_SECONDS, async () => {
      setCountdown(null);
      const info = await ensureRace();
      if (info) {
        startBettingPhase(info);
      } else {
        setStage("error");
        scheduleRecovery();
      }
    });
  }
  function maybeEventFor(index, state) {
    if (state.cool[index] > 0) {
      state.cool[index]--;
      return null;
    }
    if (Math.random() >= EVENTS_CHANCE_PER_TICK) return null;

    let roll = Math.random();
    for (const band of EVENT_BANDS) {
      if (roll < band.p) {
        state.cool[index] = EVENT_COOLDOWN_TICKS;

        switch (band.key) {
        case 'boost':
          state.vel[index] = clamp(state.vel[index] + BOOST_VEL, MIN_VEL, MAX_VEL);
          return band.label;
        case 'slow':
          if (state.shield[index] > 0) {
            return '🛡️';
          }
          state.vel[index] = Math.max(MIN_VEL, state.vel[index] - SLOW_VEL);
          return band.label;
        case 'gust':
          state.vel[index] = clamp(state.vel[index] + GUST_VEL, MIN_VEL, MAX_VEL);
          return band.label;
        case 'stumble':
          if (state.shield[index] > 0) {
            return '🛡️';
          }
          state.vel[index] = STUMBLE_VEL;
          return band.label;
        case 'shield':
          state.shield[index] = SHIELD_DURATION_TICKS;
          return band.label;
        case 'warp':
          state.pos[index] += rand(WARP_MIN, WARP_MAX);
          return band.label;
        case 'surge':
          state.pos[index] += rand(SURGE_MIN, SURGE_MAX);
          return band.label;
            return band.label;
          default:
            return null;
        }
      }
      roll -= band.p;
    }
    return null;
  }

  function runAnimation() {
    const trackLen = race?.track_len || 120;
    const N = horses.length || 8;

    const s = {
      pos: Array.from({ length: N }, () => 0),
      vel: Array.from({ length: N }, () => rand(BASE_VEL_MIN, BASE_VEL_MAX)),
      shield: Array.from({ length: N }, () => 0),
      cool: Array.from({ length: N }, () => 0), // per-horse event cooldown
    };
    stateRef.current = s;

    // safety: clear any previous loop
    if (frameRef.current) clearInterval(frameRef.current);

    frameRef.current = setInterval(async () => {
      const st = stateRef.current;
      if (!st) return;
      const newEvents = {};

      for (let i = 0; i < N; i++) {
        // gentle per-frame accel jitter
        st.vel[i] = clamp(st.vel[i] + rand(ACCEL_MIN, ACCEL_MAX), MIN_VEL, MAX_VEL);

        // random event (at most one per tick)
        const ev = maybeEventFor(i, st);
        if (ev) newEvents[i] = ev;

        // shield decay
        if (st.shield[i] > 0) st.shield[i]--;

        // advance
        st.pos[i] += st.vel[i];
        st.pos[i] = Math.min(st.pos[i], trackLen);
      }

      setPositions([...st.pos]);
      setEvents(newEvents);

      const winnerIdx = st.pos.findIndex((p) => p >= trackLen);
      if (winnerIdx !== -1) {
        clearInterval(frameRef.current);
        frameRef.current = null;
        stateRef.current = null;
        const resolvedWinner = winnerIdx;
        setWinner(resolvedWinner);

        let summary = { winner: resolvedWinner };
        try {
          const payout = await finishRace(resolvedWinner);
          if (payout?.ok) {
            summary = {
              winner: resolvedWinner,
              raceId: payout.race_id,
              result: payout.result,
            };
          }
        } catch (e) {
          console.error("finishRace error", e);
        }

        await refreshLeaderboard();
        setLastResult(summary);
        startCooldown();
      }
    }, TICK_MS);
  }

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (frameRef.current) clearInterval(frameRef.current);
      stateRef.current = null;
      clearCountdownTimers();
      if (recoveryRef.current) {
        clearTimeout(recoveryRef.current);
        recoveryRef.current = null;
      }
    };
  }, []);

  // Render
  const stageTitle = STAGE_TITLES[stage] || "Stable Stakes";
  const stageMessage = STAGE_MESSAGES[stage] || "Automated races running 24/7.";
  const countdownDisplay = stage === "racing" ? "LIVE" : countdown != null ? formatClock(countdown) : "--:--";
  const topLeaderboard = leaderboard.slice(0, 6);
  const winningHorse = winner != null ? horses[winner] : null;
  const showWinnerSlot = stage === "cooldown" && winningHorse;
  const winnerPayouts = (lastResult?.result?.winners || []).slice(0, 3);

  return (
    <div className="app-shell">
      <header className="info-bar">
        <div className="info-copy">
          <h1>Stable Stakes Live</h1>
          <p>{stageMessage}</p>
        </div>
        <div className="info-countdown">
          <span className={`status-pill status-${stage}`}>{stageTitle}</span>
          <span className={`countdown-value ${stage === "racing" ? "is-live" : ""}`}>{countdownDisplay}</span>
        </div>
      </header>

      <div className="main-grid">
        <section className="main-track">
          <RaceTrack
            horses={horses}
            positions={positions}
            trackLen={race?.track_len || 100}
            stage={stage}
            events={events}
            winner={winner}
          />
        </section>

        <aside className="side-stack">
          {showWinnerSlot && (
            <div className="card winner-slot">
              <div className="winner-emoji">{winningHorse.emoji}</div>
              <div className="winner-details">
                <span className="winner-label">Winner</span>
                <span className="winner-horse">#{(winningHorse.slot ?? winner) + 1}</span>
                {winnerPayouts.length ? (
                  <ul className="winner-payouts">
                    {winnerPayouts.map((entry) => (
                      <li key={entry.name}>
                        <span>{entry.name}</span>
                        <span>{formatCoins(entry.amount)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="winner-note">Settling payouts...</span>
                )}
              </div>
            </div>
          )}

          <div className="card leaderboard-card">
            <div className="card-header">
              <span>Leaderboard</span>
            </div>
            <ul>
              {topLeaderboard.map((player, index) => (
                <li key={player.name}>
                  <span>
                    {index + 1}. {player.name}
                  </span>
                  <span>{formatCoins(player.balance)}</span>
                </li>
              ))}
              {!topLeaderboard.length && <li className="empty">Waiting for first bets...</li>}
            </ul>
          </div>

          <ChatPanel />
        </aside>
      </div>
    </div>
  );
}


