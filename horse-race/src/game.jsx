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
const BOOST_VEL = 0.55; // 🚀
const GUST_VEL = 0.35; // 💨
const SLOW_VEL = 0.5; // 🍌 (subtract)
const STUMBLE_VEL = 0.1; // 🤕 (set to)
const WARP_MIN = 1.0; // ⏩ (add to pos)
const WARP_MAX = 2.2;
const SURGE_MIN = 2.2; // 🌀 (add to pos)
const SURGE_MAX = 3.2;

// event lottery bands (must sum to <= 1.0 within handler)
const EVENT_BANDS = [
  { key: "🚀", p: 0.22 }, // boost
  { key: "🍌", p: 0.18 }, // banana slow (blocked by shield)
  { key: "💨", p: 0.15 }, // small gust
  { key: "🤕", p: 0.13 }, // short stumble (blocked by shield)
  { key: "🛡️", p: 0.06 }, // shield
  // death removed by design for fairness; if you want it back, add here
  { key: "⏩", p: 0.08 }, // small warp forward
  { key: "🌀", p: 0.08 }, // surge forward
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

export default function HorseRacingGame() {
  const [race, setRace] = useState(null); // { id, track_len, status }
  const [horses, setHorses] = useState([]); // [{slot, emoji}]
  const [leaderboard, setLeaderboard] = useState([]); // [{name, balance}]
  const [phase, setPhase] = useState("bet"); // 'bet' | 'racing' | 'payout'
  const [positions, setPositions] = useState([]); // numbers 0..track_len
  const [events, setEvents] = useState({}); // per index, string emoji
  const [winner, setWinner] = useState(null);

  const frameRef = useRef(null);
  const stateRef = useRef(null); // hold live physics state between ticks

  // initial loads + refresh leaderboard periodically
  useEffect(() => {
    refreshOpenRace();
    refreshLeaderboard();
    const li = setInterval(refreshLeaderboard, 2000);
    return () => clearInterval(li);
  }, []);

  async function refreshOpenRace() {
    const data = await getOpenRace();
    if (data?.race) {
      setRace(data.race);
      setHorses(data.horses || []);
      setPhase(data.race.status || "bet");
      setPositions(Array.from({ length: (data.horses || []).length }, () => 0));
      setEvents({});
      setWinner(null);
    } else {
      setRace(null);
      setHorses([]);
      setPhase("bet");
      setPositions([]);
      setEvents({});
      setWinner(null);
    }
  }

  async function refreshLeaderboard() {
    const data = await getLeaderboard();
    if (data?.ok) setLeaderboard(data.players || []);
  }

  const canStart = useMemo(() => phase === "bet" && horses.length === 8, [phase, horses]);

  // host actions (buttons)
  async function onNewRace() {
    await createRace(); // server: picks 8 emojis + random track length
    await refreshOpenRace(); // sync UI to new race
  }

  async function onStartRace() {
    if (!canStart) return;
    await startRace(); // server: lock betting
    setPhase("racing");
    runAnimation();
  }

  /**
   * Balanced random events engine
   * - shield blocks 🍌 and 🤕
   * - one event max per tick per horse
   * - cooldown between events for a horse to avoid spam
   */
  function maybeEventFor(i, s) {
    // cooldown ticking
    if (s.cool[i] > 0) {
      s.cool[i]--;
      return null;
    }
    if (Math.random() >= EVENTS_CHANCE_PER_TICK) return null;

    let r = Math.random();
    for (const band of EVENT_BANDS) {
      if (r < band.p) {
        s.cool[i] = EVENT_COOLDOWN_TICKS; // set cooldown whenever an event hits
        switch (band.key) {
          case "🚀":
            s.vel[i] = clamp(s.vel[i] + BOOST_VEL, MIN_VEL, MAX_VEL);
            return "🚀";
          case "🍌":
            if (s.shield[i] > 0) return "🛡️"; // display shield ping
            s.vel[i] = Math.max(MIN_VEL, s.vel[i] - SLOW_VEL);
            return "🍌";
          case "💨":
            s.vel[i] = clamp(s.vel[i] + GUST_VEL, MIN_VEL, MAX_VEL);
            return "💨";
          case "🤕":
            if (s.shield[i] > 0) return "🛡️";
            s.vel[i] = STUMBLE_VEL;
            return "🤕";
          case "🛡️":
            s.shield[i] = SHIELD_DURATION_TICKS;
            return "🛡️";
          case "⏩": {
            s.pos[i] += rand(WARP_MIN, WARP_MAX);
            return "⏩";
          }
          case "🌀": {
            s.pos[i] += rand(SURGE_MIN, SURGE_MAX);
            return "🌀";
          }
          default:
            return null;
        }
      }
      r -= band.p;
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
        setWinner(winnerIdx);
        setPhase("payout");

        // tell backend to pay out for this horse (0..7 index)
        try {
          await finishRace(winnerIdx);
        } catch (e) {
          // noop, UI will still show result
        }

        // slight delay, then refresh leaderboard + open race
        setTimeout(async () => {
          await refreshLeaderboard();
          await refreshOpenRace();
        }, 1200);
      }
    }, TICK_MS);
  }

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (frameRef.current) clearInterval(frameRef.current);
    };
  }, []);

  // Render
  const pools = useMemo(() => new Map(), []);
  const odds = useMemo(() => new Map(), []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 space-y-6">
          {/* Top bar: controls + leaderboard */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
                onClick={onNewRace}
              >
                New Race
              </button>
              <button
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-40"
                onClick={onStartRace}
                disabled={!canStart}
              >
                Start Race
              </button>
              <div className="text-xs text-gray-400 ml-2">
                Track: {race?.track_len ?? "--"} | Phase: {String(phase).toUpperCase()}
              </div>
            </div>

            <div className="text-xs text-gray-300">
              <span className="opacity-70 mr-2">Leaderboard:</span>
              {leaderboard.slice(0, 8).map((p, i) => (
                <span key={p.name} className="mr-3">
                  {i + 1}. <b>{p.name}</b> {formatCoins(p.balance)}
                </span>
              ))}
            </div>
          </div>

          <RaceTrack
            horses={horses}
            positions={positions}
            trackLen={race?.track_len || 100}
            phase={phase}
            events={events}
            winner={winner}
            pools={pools}
            odds={odds}
          />

          <div className="text-xs text-gray-500">
            Tips: Use Pump chat commands <code>!bet &lt;amount&gt; &lt;horse 1-8&gt;</code>, <code>!balance</code>,{" "}
            <code>!leaderboard</code>.
          </div>
        </div>

        <div className="w-full lg:max-w-sm">
          <ChatPanel currentUser="You" />
        </div>
      </div>
    </div>
  );
}

