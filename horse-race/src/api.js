// src/api.js
const API = (path) => `http://localhost:4000${path}`;

export async function getOpenRace() {
  const r = await fetch(API("/race/open"));
  return r.json();
}

export async function createRace() {
  const r = await fetch(API("/race/new"), { method: "POST" });
  return r.json();
}

export async function startRace() {
  const r = await fetch(API("/race/start"), { method: "POST" });
  return r.json();
}

export async function finishRace(winner) {
  const r = await fetch(API("/race/finish"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ winner }),
  });
  return r.json();
}

export async function getLeaderboard() {
  const r = await fetch(API("/leaderboard"));
  return r.json();
}
