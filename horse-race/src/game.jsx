// src/game.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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

const BASE_VEL_MIN = 0.45;
const BASE_VEL_MAX = 0.85;
const ACCEL_MIN = -0.05;
const ACCEL_MAX = 0.09;
const MAX_VEL = 1.35;
const MIN_VEL = 0.25;

// random events dial
const EVENTS_CHANCE_PER_TICK = 0.035; // 3.5% per tick per horse
const EVENT_COOLDOWN_TICKS = 6; // after any event fires for a horse
const SHIELD_DURATION_TICKS = 4;
const EVENT_BADGE_TTL = 14; // ticks to display effect badges
const CONFETTI_DURATION_MS = 2600;

// mild, readable effects
const BOOST_VEL = 0.55;
const GUST_VEL = 0.32;
const SLOW_VEL = 0.45;
const STUMBLE_VEL = 0.12;
const WARP_MIN = 1.0;
const WARP_MAX = 2.0;
const SURGE_MIN = 2.1;
const SURGE_MAX = 2.8;
const BETTING_SECONDS = 30;
const COOLDOWN_SECONDS = 15;

const SHIELD_ICON = "\uD83D\uDEE1";

const EVENT_BANDS = [
  { key: "boost", label: "\u26A1", p: 0.22 },
  { key: "slow", label: "\uD83D\uDC0C", p: 0.18 },
  { key: "gust", label: "\uD83D\uDCA8", p: 0.15 },
  { key: "stumble", label: "\u274C", p: 0.13 },
  { key: "shield", label: SHIELD_ICON, p: 0.06 },
  { key: "warp", label: "\u2728", p: 0.08 },
  { key: "surge", label: "\uD83D\uDE80", p: 0.08 },
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

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return value >= 10 ? Math.round(value) + "%" : value.toFixed(1) + "%";
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
  const [confettiBurst, setConfettiBurst] = useState(false);

  const frameRef = useRef(null);
  const stateRef = useRef(null); // hold live physics state between ticks
  const countdownTimersRef = useRef({ tick: null, stage: null });
  const runningRef = useRef(false);
  const recoveryRef = useRef(null);
  const confettiTimerRef = useRef(null);
  const oddsNoiseRef = useRef([]);
  const oddsSignalRef = useRef([]);

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

  function bumpOddsSignal(index, delta) {
    const signals = oddsSignalRef.current;
    if (!Array.isArray(signals) || index < 0 || index >= signals.length) return;
    signals[index] = clamp(signals[index] + delta, -0.45, 0.55);
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
    if (confettiTimerRef.current) {
      clearTimeout(confettiTimerRef.current);
      confettiTimerRef.current = null;
    }
    setConfettiBurst(false);
    oddsNoiseRef.current = Array.from({ length: horseCount }, () => (Math.random() - 0.5) * 0.24);
    oddsSignalRef.current = Array.from({ length: horseCount }, () => 0);
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
          case "boost":
            state.vel[index] = clamp(state.vel[index] + BOOST_VEL, MIN_VEL, MAX_VEL);
            bumpOddsSignal(index, 0.18);
            return band.label;
          case "slow":
            if (state.shield[index] > 0) {
              bumpOddsSignal(index, 0.05);
              return SHIELD_ICON;
            }
            state.vel[index] = Math.max(MIN_VEL, state.vel[index] - SLOW_VEL);
            bumpOddsSignal(index, -0.22);
            return band.label;
          case "gust":
            state.vel[index] = clamp(state.vel[index] + GUST_VEL, MIN_VEL, MAX_VEL);
            bumpOddsSignal(index, 0.12);
            return band.label;
          case "stumble":
            if (state.shield[index] > 0) {
              bumpOddsSignal(index, 0.04);
              return SHIELD_ICON;
            }
            state.vel[index] = STUMBLE_VEL;
            bumpOddsSignal(index, -0.24);
            return band.label;
          case "shield":
            state.shield[index] = SHIELD_DURATION_TICKS;
            bumpOddsSignal(index, 0.1);
            return band.label;
          case "warp":
            state.pos[index] += rand(WARP_MIN, WARP_MAX);
            bumpOddsSignal(index, 0.22);
            return band.label;
          case "surge":
            state.pos[index] += rand(SURGE_MIN, SURGE_MAX);
            bumpOddsSignal(index, 0.26);
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
    if (!Array.isArray(oddsNoiseRef.current) || oddsNoiseRef.current.length !== N) {
      oddsNoiseRef.current = Array.from({ length: N }, () => (Math.random() - 0.5) * 0.2);
    }
    if (!Array.isArray(oddsSignalRef.current) || oddsSignalRef.current.length !== N) {
      oddsSignalRef.current = Array.from({ length: N }, () => 0);
    }

    const s = {
      pos: Array.from({ length: N }, () => 0),
      vel: Array.from({ length: N }, () => rand(BASE_VEL_MIN, BASE_VEL_MAX)),
      shield: Array.from({ length: N }, () => 0),
      cool: Array.from({ length: N }, () => 0), // per-horse event cooldown
      fxTimer: Array.from({ length: N }, () => 0),
      fxLabel: Array.from({ length: N }, () => null),
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
        if (ev) {
          st.fxTimer[i] = EVENT_BADGE_TTL;
          st.fxLabel[i] = ev;
        }
        if (st.fxTimer[i] > 0) {
          st.fxTimer[i] -= 1;
          newEvents[i] = st.fxLabel[i];
        }

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
        if (confettiTimerRef.current) {
          clearTimeout(confettiTimerRef.current);
        }
        setConfettiBurst(true);
        confettiTimerRef.current = setTimeout(() => setConfettiBurst(false), CONFETTI_DURATION_MS);
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
      if (confettiTimerRef.current) {
        clearTimeout(confettiTimerRef.current);
        confettiTimerRef.current = null;
      }
    };
  }, []);

  // Render
  const stageTitle = STAGE_TITLES[stage] || "Stable Stakes";
  const stageMessage = STAGE_MESSAGES[stage] || "Automated races running 24/7.";
  const countdownDisplay = stage === "racing" ? "LIVE" : countdown != null ? formatClock(countdown) : "--:--";
  const trackLen = race?.track_len || 0;
  const payouts = (lastResult?.result?.winners || []).slice().sort((a, b) => b.amount - a.amount);
  const moneyLeaders = payouts.slice(0, 5);
  const totalPool = lastResult?.result?.totalPool ?? null;
  const afterHouse = lastResult?.result?.afterHouse ?? null;
  const oddsBoard = useMemo(() => {
    if (!horses.length) return [];
    const len = trackLen > 0 ? trackLen : 100;
    if (!Array.isArray(oddsNoiseRef.current) || oddsNoiseRef.current.length !== horses.length) {
      oddsNoiseRef.current = Array.from({ length: horses.length }, () => (Math.random() - 0.5) * 0.24);
    }
    if (!Array.isArray(oddsSignalRef.current) || oddsSignalRef.current.length !== horses.length) {
      oddsSignalRef.current = Array.from({ length: horses.length }, () => 0);
    }
    const noises = oddsNoiseRef.current;
    const signals = oddsSignalRef.current;
    const leaderPos = positions.reduce((max, value) => (value != null && value > max ? value : max), 0);
    const lastWinnerSlot = lastResult?.winner ?? null;
    const equalShare = horses.length ? 1 / horses.length : 0;

    const weights = horses.map((horse, idx) => {
      const slot = horse.slot ?? idx;
      const emoji = horse.emoji || "\uD83D\uDC0E";
      const base = 1;
      const noise = noises[idx] ?? 0;
      const signal = signals[idx] ?? 0;
      const pos = positions[idx] ?? 0;
      const progress = stage === "racing" ? Math.min(pos / Math.max(len, 1), 1) : 0;
      const leaderGap = stage === "racing" ? Math.max(leaderPos - pos, 0) / Math.max(len, 1) : 0;
      const comebackBonus = leaderGap * 0.18;
      const momentum = stage === "racing" ? progress * 0.6 : 0;
      const legacy = stage === "betting" && lastWinnerSlot != null ? (slot === lastWinnerSlot ? -0.05 : 0.03) : 0;
      const weight = Math.max(0.2, base + noise + signal + momentum + comebackBonus + legacy);
      return { slot, emoji, weight };
    });

    const temperature = stage === "racing" ? 0.55 : 0.75;
    const scaled = weights.map((entry) => ({
      ...entry,
      scaled: Math.pow(entry.weight, 1 / Math.max(temperature, 0.2)),
    }));

    const scaledTotal = scaled.reduce((sum, entry) => sum + entry.scaled, 0) || 1;

    return scaled
      .map(({ slot, emoji, scaled }) => {
        const share = scaled / scaledTotal;
        const softened = share * 0.8 + equalShare * 0.2;
        const percent = Math.max(0, Math.min(100, Math.round(softened * 1000) / 10));
        return { slot, emoji, percent };
      })
      .sort((a, b) => (b.percent === a.percent ? a.slot - b.slot : b.percent - a.percent));
  }, [horses, positions, stage, trackLen, lastResult]);
  const winningHorse = lastResult?.winner != null ? horses[lastResult.winner] : null;
  const winnerSlot = winningHorse?.slot ?? (lastResult?.winner ?? null);
  const winnerEmoji = winningHorse?.emoji || (winnerSlot != null ? "\uD83D\uDC0E" : null);
  const winnerPayouts = payouts.slice(0, 3);
  const topLeaderboard = leaderboard.slice(0, 6);

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
            showConfetti={confettiBurst}
          />
        </section>

        <aside className="side-grid">
          <div className="side-column">
            {stage === "cooldown" && winnerSlot != null && winnerEmoji && (
              <div className="card winner-card">
                <div className="card-header winner-header">
                  <span>Last Winner</span>
                  <span className={"winner-badge winner-badge--" + stage}>{stageTitle}</span>
                </div>
                <div className="winner-body">
                  <span className="winner-emoji">{winnerEmoji}</span>
                  <div className="winner-meta">
                    <span className="winner-label">Horse #{(winnerSlot ?? 0) + 1}</span>
                    {totalPool != null && (
                      <span className="winner-sub">Pool: {formatCoins(totalPool)} coins</span>
                    )}
                    {afterHouse != null && (
                      <span className="winner-sub winner-sub--highlight">Paid: {formatCoins(afterHouse)} coins</span>
                    )}
                  </div>
                </div>
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
                  <div className="winner-note">No winning bets recorded.</div>
                )}
              </div>
            )}

            <div className="card odds-card">
              <div className="card-header odds-header">
                <span>Win Odds</span>
                <span className="odds-phase">{stageTitle}</span>
              </div>
              <ul className="odds-list">
                {oddsBoard.length ? (
                  oddsBoard.map((entry, index) => (
                    <li key={entry.slot}>
                      <div className="odds-left">
                        <span className="odds-rank">#{index + 1}</span>
                        <span className="odds-emoji">{entry.emoji}</span>
                        <span className="odds-label">Horse #{entry.slot + 1}</span>
                      </div>
                      <span className="odds-value">{formatPercent(entry.percent)}</span>
                    </li>
                  ))
                ) : (
                  <li className="empty">Waiting for roster...</li>
                )}
              </ul>
            </div>

            <ChatPanel />
          </div>

          <div className="side-column">
            <div className="card money-card">
              <div className="card-header money-header">
                <span>Money Leaderboard</span>
                <div className="card-metrics">
                  {totalPool != null && (
                    <span className="card-subtitle">Pool: {formatCoins(totalPool)}</span>
                  )}
                  {afterHouse != null && (
                    <span className="card-subtitle">Paid: {formatCoins(afterHouse)} coins</span>
                  )}
                </div>
              </div>
              <ul className="money-list">
                {moneyLeaders.length ? (
                  moneyLeaders.map((entry, idx) => (
                    <li key={entry.name}>
                      <span className="money-rank">{idx + 1}.</span>
                      <span className="money-name">{entry.name}</span>
                      <span className="money-amount">{formatCoins(entry.amount)} coins</span>
                    </li>
                  ))
                ) : (
                  <li className="empty">No payouts yet...</li>
                )}
              </ul>
            </div>

            <div className="card leaderboard-card">
              <div className="card-header">
                <span>Player Balances</span>
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
          </div>
        </aside>
      </div>
    </div>
  );
}


















