import "./index.css";
import { Application, Graphics, Text } from "pixi.js";
import { Client } from "@colyseus/sdk";
import { GameState, Player, Hazard, PowerUp, PHYSICS, PlayerInput } from "@sumo/shared";

// Lobby UI
const appEl = document.getElementById("app")!;
appEl.innerHTML = `
  <div class="lobby-container">
    <h1 class="lobby-title">SUMO CLASH</h1>
    <p class="lobby-subtitle">Enter the arena.</p>
    <div class="input-group">
      <label>Player Name</label>
      <input id="username-input" class="lobby-input" type="text" placeholder="Enter username..." />
    </div>
    <div class="input-group">
      <label>Select Arena</label>
      <select id="map-select" class="lobby-select">
        <option value="classic">Classic Arena</option>
        <option value="volcano">Volcano (Moving Lava Pool)</option>
        <option value="space">Space (Moving Black Hole)</option>
      </select>
    </div>
    <button id="join-btn" class="lobby-btn">PLAY NOW</button>
    <div id="status" class="status-text"></div>
  </div>
`;

const usernameInput = document.getElementById("username-input") as HTMLInputElement;
const mapSelect = document.getElementById("map-select") as HTMLSelectElement;
const joinBtn = document.getElementById("join-btn") as HTMLButtonElement;

let app: Application | null = null;
let room: any = null;
let inputIntervalId: number | null = null;

// Interpolation buffer for all players
interface Snapshot {
  timestamp: number;
  players: Map<string, { x: number; y: number; vx: number; vy: number; radius: number; mass: number; alive: boolean; name: string; color: string; shieldActive: boolean; hammerCharge: boolean; ghostTimer: number; dashTimer: number }>;
}
const snapshotBuffer: Snapshot[] = [];

// Particle system
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: number; size: number; }
const particles: Particle[] = [];
let particleGraphics: Graphics | null = null;

function spawnParticles(x: number, y: number, count: number, color: number, speedMult: number = 1.0) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 200 + 50) * speedMult;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: Math.random() * 0.3 + 0.2, maxLife: 0.5, color, size: Math.random() * 4 + 2 });
  }
}

// Input tracking
const currentInput = { up: false, down: false, left: false, right: false, dash: false };

window.addEventListener("keydown", (e) => {
  switch (e.key.toLowerCase()) {
    case "w": case "arrowup": currentInput.up = true; break;
    case "s": case "arrowdown": currentInput.down = true; break;
    case "a": case "arrowleft": currentInput.left = true; break;
    case "d": case "arrowright": currentInput.right = true; break;
    case " ": currentInput.dash = true; break;
  }
});
window.addEventListener("keyup", (e) => {
  switch (e.key.toLowerCase()) {
    case "w": case "arrowup": currentInput.up = false; break;
    case "s": case "arrowdown": currentInput.down = false; break;
    case "a": case "arrowleft": currentInput.left = false; break;
    case "d": case "arrowright": currentInput.right = false; break;
    case " ": currentInput.dash = false; break;
  }
});

// Audio
let audioCtx: AudioContext | null = null;
function playSound(type: "hit" | "pickup" | "dash" | "fall") {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    if (type === "hit") {
      osc.type = "sine"; osc.frequency.setValueAtTime(120, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.1); osc.start(); osc.stop(audioCtx.currentTime + 0.1);
    } else if (type === "pickup") {
      osc.type = "triangle"; osc.frequency.setValueAtTime(400, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.15); osc.start(); osc.stop(audioCtx.currentTime + 0.15);
    } else if (type === "dash") {
      osc.type = "sawtooth"; osc.frequency.setValueAtTime(80, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.08); osc.start(); osc.stop(audioCtx.currentTime + 0.08);
    } else if (type === "fall") {
      osc.type = "sine"; osc.frequency.setValueAtTime(220, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.4, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.4); osc.start(); osc.stop(audioCtx.currentTime + 0.4);
    }
  } catch (_) {}
}

// PixiJS objects
let arenaGraphics: Graphics;
const playerGraphicsMap = new Map<string, Graphics>();
const playerNameTextMap = new Map<string, Text>();
let hudText: Text;
let scoreboardText: Text;

const colorCache = new Map<string, number>();
function parseColor(hex: string): number {
  let c = colorCache.get(hex);
  if (c === undefined) { c = hex.startsWith("#") ? (parseInt(hex.slice(1), 16) || 0x3b82f6) : 0x3b82f6; colorCache.set(hex, c); }
  return c;
}

let screenShakeAmount = 0;
let lastLocalAlive = true;
let lastLocalVx = 0;
let lastLocalVy = 0;
let lastKillHash = "";
let renderLogOnce = false;
let localState: any = null;
const hazardGraphicsMap = new Map<string, Graphics>();
const powerupGraphicsMap = new Map<string, Graphics>();

// Killfeed
const killfeedEl = document.createElement("div");
killfeedEl.className = "killfeed-container";
function showKill(killer: string, victim: string) {
  const entry = document.createElement("div");
  entry.className = "killfeed-entry";
  entry.innerHTML = `<span class="killer">${killer}</span> knocked out <span class="victim">${victim}</span>`;
  killfeedEl.appendChild(entry);
  setTimeout(() => entry.classList.add("fade-out"), 4000);
  setTimeout(() => entry.remove(), 5000);
}

joinBtn.addEventListener("click", () => {
  startLobby(usernameInput.value.trim() || "Guest", mapSelect.value);
});

// Wake-up for Render.com free tier
(async () => {
  const isDev = import.meta.env.DEV;
  const url = (import.meta.env.VITE_SERVER_URL || (isDev ? "ws://127.0.0.1:2567" : "wss://sumo-clash-server.onrender.com")).replace("ws", "http");
  try { await fetch(url + "/ping"); } catch (_) {}
})();

function resetGameState() {
  localState = null;
  snapshotBuffer.length = 0;
  lastLocalAlive = true;
  lastLocalVx = 0;
  lastLocalVy = 0;
  lastKillHash = "";
  screenShakeAmount = 0;
  renderLogOnce = false;
  particles.length = 0;
  playerGraphicsMap.clear();
  playerNameTextMap.clear();
  powerupGraphicsMap.clear();
  hazardGraphicsMap.clear();
  if (app) { app.destroy(true); app = null; }
  document.getElementById("lost-overlay")?.remove();
  document.getElementById("countdown-overlay")?.remove();
}



async function startLobby(username: string, mapId: string) {
  resetGameState();
  document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0d1117;color:#e2e8f0;font-family:'Outfit','Inter',sans-serif;font-size:24px;font-weight:700;">Connecting...</div>`;

  const isDev = import.meta.env.DEV;
  const serverUrl = import.meta.env.VITE_SERVER_URL || (isDev ? "ws://127.0.0.1:2567" : "wss://sumo-clash-server.onrender.com");
  const client = new Client(serverUrl);

  try {
    room = await client.joinOrCreate("battle", { username, mapId });
    localState = { players: [], hazards: [], powerups: [], matchPhase: "waiting", matchTimer: 0, mapId: mapId, arenaRadius: PHYSICS.ARENA_RADIUS_DEFAULT };

    app = new Application();
    await app.init({ width: window.innerWidth, height: window.innerHeight, backgroundColor: 0x0d1117, antialias: true });
    document.body.innerHTML = "";
    document.body.appendChild(app.canvas);
    document.body.appendChild(killfeedEl);

    arenaGraphics = new Graphics();
    app.stage.addChild(arenaGraphics);
    particleGraphics = new Graphics();
    app.stage.addChild(particleGraphics);

    hudText = new Text({ text: "Loading...", style: { fontFamily: "'Outfit','Inter',sans-serif", fontSize: 24, fontWeight: "800", fill: 0xffffff, dropShadow: { alpha: 0.5, blur: 4, distance: 2, color: 0x000000 } } });
    hudText.x = 20; hudText.y = 20;
    app.stage.addChild(hudText);

    scoreboardText = new Text({ text: "", style: { fontFamily: "'Outfit','Inter',sans-serif", fontSize: 18, fontWeight: "600", fill: 0xffffff, align: "right" } });
    app.stage.addChild(scoreboardText);

    const countdownEl = document.createElement("div");
    countdownEl.id = "countdown-overlay";
    countdownEl.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-family:'Outfit','Inter',sans-serif;font-size:120px;font-weight:900;color:#facc15;text-shadow:0 4px 10px rgba(0,0,0,0.5);pointer-events:none;z-index:100;display:none;";
    document.body.appendChild(countdownEl);

    room.onMessage("kill", (data: { killer: string; victim: string }) => showKill(data.killer, data.victim));
    room.onMessage("ack", (message: { seq: number }) => {});
    room.onMessage("ended", (data: { winner: string }) => {
      const overlay = document.createElement("div");
      overlay.className = "overlay-container";
      overlay.innerHTML = `<h2 class="overlay-title">MATCH ENDED</h2><h3 class="winner-announcement">WINNER: ${data.winner}</h3><p class="overlay-subtitle">Play Again?</p><button id="play-again-btn" class="lobby-btn" style="max-width:200px;">RE-JOIN</button>`;
      document.body.appendChild(overlay);
      document.getElementById("play-again-btn")?.addEventListener("click", () => { overlay.remove(); room.leave(); startLobby(username, mapId); });
    });

    setInterval(() => {
      if (!room || !localState) return;
      const roomPhase = room?.state?.matchPhase ?? localState.matchPhase;
      const isWaiting = roomPhase === "waiting";
      const inputCopy = isWaiting ? { up: false, down: false, left: false, right: false, dash: false } : { ...currentInput };
      room.send("input", inputCopy);
    }, 1000 / 60);

    room.onStateChange((state: any) => {
      if (!localState || !state) return;

      localState.matchPhase = state.matchPhase;
      localState.matchTimer = state.matchTimer;
      localState.mapId = state.mapId;
      localState.arenaRadius = state.arenaRadius;

      const serverIds = Array.from(state.players).map((p: any) => p.id);
      for (let i = localState.players.length - 1; i >= 0; i--) {
        if (!serverIds.includes(localState.players[i].id)) localState.players.splice(i, 1);
      }

      for (const sPlayer of state.players) {
        let lPlayer = localState.players.find((p: any) => p.id === sPlayer.id);
        if (!lPlayer) {
          lPlayer = new Player();
          lPlayer.id = sPlayer.id;
          lPlayer.name = sPlayer.name;
          lPlayer.color = sPlayer.color;
          localState.players.push(lPlayer);
        }
        lPlayer.alive = sPlayer.alive;
        lPlayer.radius = sPlayer.radius;
        lPlayer.mass = sPlayer.mass;
        lPlayer.kills = sPlayer.kills;
        lPlayer.score = sPlayer.score;
        lPlayer.shieldActive = sPlayer.shieldActive;
        lPlayer.hammerCharge = sPlayer.hammerCharge;
        lPlayer.ghostTimer = sPlayer.ghostTimer;
        lPlayer.dashTimer = sPlayer.dashTimer;
      }

      localState.hazards.length = 0;
      if (state.hazards) {
        for (const sh of state.hazards) {
          const lh = new Hazard();
          lh.id = sh.id; lh.type = sh.type;
          lh.x = sh.x; lh.y = sh.y; lh.radius = sh.radius;
          localState.hazards.push(lh);
        }
      }

      const prevPuIds = new Set(localState.powerups.map((lp: any) => lp.id));
      localState.powerups.length = 0;
      if (state.powerups) {
        for (const sp of state.powerups) {
          const lp = new PowerUp();
          lp.id = sp.id; lp.type = sp.type;
          lp.x = sp.x; lp.y = sp.y; lp.radius = sp.radius;
          localState.powerups.push(lp);
        }
      }
      const currPuIds = new Set(localState.powerups.map((lp: any) => lp.id));
      for (const prevId of prevPuIds) { if (!currPuIds.has(prevId)) { playSound("pickup"); break; } }

      const snap: Snapshot = {
        timestamp: Date.now(),
        players: new Map()
      };
      for (const sp of state.players) {
        snap.players.set(sp.id, {
          x: sp.x, y: sp.y, vx: sp.vx, vy: sp.vy,
          radius: sp.radius, mass: sp.mass,
          alive: sp.alive, name: sp.name, color: sp.color,
          shieldActive: sp.shieldActive, hammerCharge: sp.hammerCharge,
          ghostTimer: sp.ghostTimer, dashTimer: sp.dashTimer
        });
      }
      snapshotBuffer.push(snap);
      while (snapshotBuffer.length > 30) snapshotBuffer.shift();
    });

    app.ticker.add(() => renderGame(countdownEl));
  } catch (err: any) {
    console.error("[SUMO] Error:", err);
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0d1117;color:#ef4444;font-family:'Outfit','Inter',sans-serif;font-size:24px;font-weight:700;">Connection failed: ${err?.message || err}</div>`;
  }
}

function renderGame(countdownEl: HTMLDivElement) {
  if (!app || !localState) return;
  const dt = app.ticker.deltaMS / 1000;
  const now = Date.now();
  const renderTime = now - 100;
  
  let interpolatedPlayers = new Map<string, any>();
  if (snapshotBuffer.length >= 2) {
    let b = snapshotBuffer.length - 1;
    while (b > 0 && snapshotBuffer[b].timestamp > renderTime) b--;
    const s1 = snapshotBuffer[b], s2 = snapshotBuffer[b + 1];
    const alpha = (renderTime - s1.timestamp) / (s2.timestamp - s1.timestamp);
    for (const [id, p2] of s2.players) {
      const p1 = s1.players.get(id);
      if (p1) {
        interpolatedPlayers.set(id, {
          ...p2,
          x: p1.x + (p2.x - p1.x) * alpha,
          y: p1.y + (p2.y - p1.y) * alpha
        });
      } else interpolatedPlayers.set(id, p2);
    }
  } else if (snapshotBuffer.length > 0) {
    for (const [id, p] of snapshotBuffer[snapshotBuffer.length - 1].players) interpolatedPlayers.set(id, p);
  }

  const minDim = Math.min(window.innerWidth, window.innerHeight);
  const viewScale = Math.min(1.0, minDim / ((PHYSICS.ARENA_RADIUS_DEFAULT * 2) + 120));
  app.stage.scale.set(viewScale);
  const cx = (window.innerWidth * 0.5) / viewScale;
  const cy = (window.innerHeight * 0.5) / viewScale;

  const camPlayer = interpolatedPlayers.get(room.sessionId);
  let ox = cx, oy = cy;
  if (camPlayer) {
    if (lastLocalAlive && !camPlayer.alive) {
      playSound("fall");
      const fallColor = parseColor(camPlayer.color);
      spawnParticles(camPlayer.x, camPlayer.y, 40, fallColor, 2.0);
      if (!document.getElementById("lost-overlay")) {
        const lostEl = document.createElement("div");
        lostEl.id = "lost-overlay";
        lostEl.style.cssText = `position: fixed; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); z-index: 200; pointer-events: auto;`;
        lostEl.innerHTML = `<h2 style="font-family: 'Outfit','Inter',sans-serif; font-size: 72px; font-weight: 900; color: #ef4444; text-shadow: 0 4px 10px rgba(0,0,0,0.5); margin: 0;">YOU LOST</h2><p style="font-family: 'Outfit','Inter',sans-serif; font-size: 20px; color: #94a3b8; margin: 16px 0 32px;">Knocked out of the arena!</p><div style="display: flex; gap: 16px;"><button id="spectate-btn" style="padding: 12px 32px; font-size: 18px; font-weight: 700; font-family: 'Outfit','Inter',sans-serif; background: #1e293b; color: #e2e8f0; border: 2px solid #475569; border-radius: 8px; cursor: pointer;">SPECTATE</button><button id="rejoin-btn" style="padding: 12px 32px; font-size: 18px; font-weight: 700; font-family: 'Outfit','Inter',sans-serif; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer;">REJOIN</button></div>`;
        document.body.appendChild(lostEl);
        document.getElementById("spectate-btn")?.addEventListener("click", () => lostEl.remove());
        document.getElementById("rejoin-btn")?.addEventListener("click", () => { lostEl.remove(); room.leave(); startLobby(camPlayer.name || "Guest", localState?.mapId || "classic"); });
      }
    }
    lastLocalAlive = camPlayer.alive;
    if (camPlayer.alive) {
      const dv = Math.sqrt(Math.pow(camPlayer.vx - lastLocalVx, 2) + Math.pow(camPlayer.vy - lastLocalVy, 2));
      if (dv > 220) { playSound("hit"); screenShakeAmount = 15; spawnParticles(camPlayer.x, camPlayer.y, 15, 0xffffff, 1.5); }
      lastLocalVx = camPlayer.vx; lastLocalVy = camPlayer.vy;
      ox = cx - camPlayer.x; oy = cy - camPlayer.y;
    }
  }

  if (screenShakeAmount > 0) {
    ox += (Math.random() - 0.5) * screenShakeAmount;
    oy += (Math.random() - 0.5) * screenShakeAmount;
    screenShakeAmount *= 0.9;
    if (screenShakeAmount < 0.5) screenShakeAmount = 0;
  }

  arenaGraphics.clear();
  const arenaRadius = localState.arenaRadius || PHYSICS.ARENA_RADIUS_DEFAULT;
  const matchTimer = localState.matchTimer || 0;
  const isShrinking = (90 - matchTimer) > PHYSICS.ARENA_SHRINK_GRACE;
  arenaGraphics.circle(ox, oy, arenaRadius).fill({ color: 0x111827 }).stroke({ color: isShrinking ? 0xef4444 : 0x3b82f6, width: isShrinking ? 6 : 4, alpha: isShrinking ? 0.8 + Math.sin(now * 0.01) * 0.2 : 1.0 });

  if (particleGraphics) {
    particleGraphics.clear();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const alpha = Math.max(0, p.life / p.maxLife);
      particleGraphics.circle(ox + p.x, oy + p.y, p.size * alpha).fill({ color: p.color, alpha });
    }
  }

  for (const h of localState.hazards) {
    let hG = hazardGraphicsMap.get(h.id);
    if (!hG) { hG = new Graphics(); app.stage.addChild(hG); hazardGraphicsMap.set(h.id, hG); }
    hG.clear();
    if (h.type === "lava") hG.circle(ox + h.x, oy + h.y, h.radius).fill({ color: 0xef4444, alpha: 0.7 }).stroke({ color: 0xffffff, width: 3 });
    else if (h.type === "blackhole") { hG.circle(ox + h.x, oy + h.y, h.radius).fill({ color: 0x111111, alpha: 0.9 }).stroke({ color: 0x8b5cf6, width: 4 }); hG.circle(ox + h.x, oy + h.y, h.radius * 0.7).stroke({ color: 0x6366f1, width: 2, alpha: 0.5 }); }
  }

  for (const pu of localState.powerups) {
    let pG = powerupGraphicsMap.get(pu.id);
    if (!pG) { pG = new Graphics(); app.stage.addChild(pG); powerupGraphicsMap.set(pu.id, pG); }
    pG.clear();
    const color = pu.type === "speed" ? 0xfacc15 : pu.type === "shield" ? 0x22d3ee : pu.type === "growth" ? 0x4ade80 : pu.type === "hammer" ? 0xf87171 : 0xa5b4fc;
    pG.circle(ox + pu.x, oy + pu.y, pu.radius).fill({ color }).stroke({ color: 0xffffff, width: 2 });
  }

  for (const [id, player] of interpolatedPlayers) {
    if (!player.alive) { playerGraphicsMap.get(id)?.clear(); const nt = playerNameTextMap.get(id); if (nt) nt.visible = false; continue; }
    let pg = playerGraphicsMap.get(id);
    if (!pg) { pg = new Graphics(); app.stage.addChild(pg); playerGraphicsMap.set(id, pg); }
    pg.clear();
    const isLocal = id === room.sessionId;
    const px = player.x, py = player.y, radius = player.radius || 30, pColor = parseColor(player.color), pAlpha = player.ghostTimer > 0 ? 0.4 : 1.0;
    pg.circle(ox + px, oy + py, radius).fill({ color: pColor, alpha: pAlpha }).stroke({ color: 0xffffff, width: isLocal ? 3 : 1, alpha: pAlpha });
    if (player.shieldActive) pg.circle(ox + px, oy + py, radius + 6).stroke({ color: 0x22d3ee, width: 3 });
    if (player.hammerCharge) pg.circle(ox + px, oy + py, radius + 4).stroke({ color: 0xf87171, width: 4, alpha: 0.6 + Math.sin(Date.now() * 0.02) * 0.4 });
    if (player.ghostTimer > 0 && Math.random() > 0.8) spawnParticles(px, py, 1, 0xa5b4fc, 0.2);
    if (player.dashTimer > 0) spawnParticles(px, py, 1, pColor, 0.5);

    let nameText = playerNameTextMap.get(id);
    if (!nameText) { nameText = new Text({ text: player.name || "Guest", style: { fontFamily: "'Outfit', 'Inter', sans-serif", fontSize: 16, fontWeight: "800", fill: 0xffffff, align: "center", stroke: { color: 0x000000, width: 3 } } }); nameText.anchor.set(0.5); app.stage.addChild(nameText); playerNameTextMap.set(id, nameText); }
    nameText.text = player.name || "Guest"; nameText.x = ox + px; nameText.y = oy + py + radius + 20; nameText.visible = true; nameText.alpha = pAlpha;
  }

  const renderList = Array.from(interpolatedPlayers.values());
  const sorted = [...renderList].sort((a, b) => (b.kills || 0) - (a.kills || 0));
  const killHash = sorted.map(p => `${p.id}:${p.kills || 0}`).join(",");
  if (killHash !== lastKillHash) {
    lastKillHash = killHash;
    scoreboardText.text = "SCOREBOARD\n" + sorted.map((p, i) => `${i + 1}. ${p.name || "???"}: ${p.kills || 0} Kills`).join("\n");
    scoreboardText.x = (window.innerWidth / viewScale) - scoreboardText.width - 20;
    scoreboardText.y = 20;
  }

  const isWaiting = localState.matchPhase === "waiting";
  const timerVal = Math.ceil(matchTimer || 0);
  hudText.text = `SUMO CLASH\nMap: ${(localState.mapId || "Classic").toUpperCase()}\nPlayers: ${renderList.filter(p => p.alive).length}\n${isWaiting ? "STARTS IN" : "TIME"}: ${timerVal}s`;
  hudText.style.fill = isWaiting ? 0xfacc15 : 0xffffff;

  if (isWaiting && timerVal > 0) {
    countdownEl.style.display = "block"; countdownEl.textContent = timerVal.toString();
    countdownEl.style.color = "#facc15"; countdownEl.style.transform = `translate(-50%,-50%) scale(${1 + Math.sin(now * 0.01) * 0.1})`;
  } else if (localState.matchPhase === "playing" && matchTimer > 88) {
    countdownEl.style.display = "block"; countdownEl.textContent = "GO!";
    countdownEl.style.color = "#4ade80"; countdownEl.style.transform = "translate(-50%,-50%) scale(1.2)";
  } else countdownEl.style.display = "none";
}

window.addEventListener("resize", () => { if (app) app.renderer.resize(window.innerWidth, window.innerHeight); });
