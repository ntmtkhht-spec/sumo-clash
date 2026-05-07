import "./index.css";
import { Application, Graphics, Text } from "pixi.js";
import { Client } from "@colyseus/sdk";
import { GameState, Player, Hazard, PowerUp, PHYSICS, stepPhysics, PlayerInput } from "@sumo/shared";

// Premium lobby UI
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
const statusEl = document.getElementById("status")!;

let app: Application | null = null;
let room: any = null;

// Particle system
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
}
const particles: Particle[] = [];
let particleGraphics: Graphics | null = null;

function spawnParticles(x: number, y: number, count: number, color: number, speedMult: number = 1.0) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 200 + 50) * speedMult;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: Math.random() * 0.3 + 0.2,
      maxLife: 0.5,
      color,
      size: Math.random() * 4 + 2
    });
  }
}

// Game Simulation state
let localState: GameState | null = null;
let lastAckedSeq: number = 0;

// Smoothing: visual offset that decays exponentially toward zero
const SMOOTH_RATE = 18.0;
const SNAP_THRESHOLD = 80.0;
let smoothOffsetX = 0;
let smoothOffsetY = 0;

// Prediction replay buffer
interface InputRecord {
  seq: number;
  input: PlayerInput;
}
const pendingInputs: InputRecord[] = [];
let nextSeq = 1;

// Interpolation buffer for other players
interface Snapshot {
  timestamp: number;
  players: Map<string, { x: number; y: number; vx: number; vy: number; radius: number; mass: number; alive: boolean }>;
}
const snapshotBuffer: Snapshot[] = [];

// Track inputs
const currentInput: PlayerInput = {
  up: false,
  down: false,
  left: false,
  right: false,
  dash: false
};

// PixiJS display objects
let arenaGraphics: Graphics;
const playerGraphicsMap = new Map<string, Graphics>();
const playerNameTextMap = new Map<string, Text>();
let hudText: Text;
let scoreboardText: Text;

// Performance caches
const colorCache = new Map<string, number>();
function parseColor(hex: string): number {
  let c = colorCache.get(hex);
  if (c === undefined) {
    c = hex.startsWith("#") ? (parseInt(hex.slice(1), 16) || 0x3b82f6) : 0x3b82f6;
    colorCache.set(hex, c);
  }
  return c;
}
let lastKillHash = "";

// Killfeed state
const killfeedEl = document.createElement("div");
killfeedEl.className = "killfeed-container";
// We will append this to the body after the canvas is created in startLobby
// document.body.appendChild(killfeedEl);

function showKill(killer: string, victim: string) {
  const entry = document.createElement("div");
  entry.className = "killfeed-entry";
  entry.innerHTML = `<span class="killer">${killer}</span> knocked out <span class="victim">${victim}</span>`;
  killfeedEl.appendChild(entry);
  setTimeout(() => entry.classList.add("fade-out"), 4000);
  setTimeout(() => entry.remove(), 5000);
}

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

// Synth audio context
let audioCtx: AudioContext | null = null;
function playSound(type: "hit" | "pickup" | "dash" | "fall") {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === "hit") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(120, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    } else if (type === "pickup") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(400, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } else if (type === "dash") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(80, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } else if (type === "fall") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(220, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
    }
  } catch (e) {
    // Ignore context failure
  }
}

// Global Screen Shake Amount
let screenShakeAmount = 0;

joinBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim() || "Guest";
  const mapId = mapSelect.value;
  startLobby(username, mapId);
});

// Proactive wake-up for Render.com free tier
async function wakeUpServer() {
  const isDev = import.meta.env.DEV;
  const serverUrl = import.meta.env.VITE_SERVER_URL || (isDev ? "ws://127.0.0.1:2567" : "wss://sumo-clash-server.onrender.com");
  const httpUrl = serverUrl.replace("ws", "http");
  
  try {
    console.log("[SUMO] Sending wake-up call to:", httpUrl + "/ping");
    await fetch(httpUrl + "/ping");
    console.log("[SUMO] Server is awake!");
  } catch (e) {
    console.warn("[SUMO] Wake-up call failed or server still sleeping:", e);
  }
}
wakeUpServer();

function resetGameState() {
  localState = null;
  lastAckedSeq = 0;
  smoothOffsetX = 0;
  smoothOffsetY = 0;
  pendingInputs.length = 0;
  nextSeq = 1;
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

  // Show connecting screen
  document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;
    height:100vh;background:#0d1117;color:#e2e8f0;font-family:'Outfit','Inter',sans-serif;
    font-size:24px;font-weight:700;">Connecting...</div>`;

  const isDev = import.meta.env.DEV;
  const serverUrl = import.meta.env.VITE_SERVER_URL || (isDev ? "ws://127.0.0.1:2567" : "wss://sumo-clash-server.onrender.com");
  console.log(`[SUMO] Connecting to: ${serverUrl} (Dev: ${isDev})`);
  
  const client = new Client(serverUrl);

  try {
    const startTime = Date.now();
    room = await client.joinOrCreate("battle", { username, mapId });
    const duration = Date.now() - startTime;
    console.log(`[SUMO] Room joined in ${duration}ms, sessionId:`, room.sessionId);
    console.log(`[SUMO] Connected in ${duration}ms`);

    // Initialize PixiJS Application
    app = new Application();
    await app.init({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0x0d1117,
      antialias: true
    });

    document.body.innerHTML = "";
    document.body.appendChild(app.canvas);
    document.body.appendChild(killfeedEl); // Re-attach killfeed after clearing body

    // Initial setup
    arenaGraphics = new Graphics();
    app.stage.addChild(arenaGraphics);

    particleGraphics = new Graphics();
    app.stage.addChild(particleGraphics);

    hudText = new Text({
      text: "Loading match...",
      style: {
        fontFamily: "'Outfit', 'Inter', sans-serif",
        fontSize: 24,
        fontWeight: "800",
        fill: 0xffffff,
        dropShadow: {
            alpha: 0.5,
            blur: 4,
            distance: 2,
            color: 0x000000
        }
      }
    });
    hudText.x = 20;
    hudText.y = 20;
    app.stage.addChild(hudText);

    scoreboardText = new Text({
      text: "",
      style: {
        fontFamily: "'Outfit', 'Inter', sans-serif",
        fontSize: 18,
        fontWeight: "600",
        fill: 0xffffff,
        align: "right"
      }
    });
    app.stage.addChild(scoreboardText);

    // HTML countdown overlay — not affected by canvas scaling
    const countdownEl = document.createElement("div");
    countdownEl.id = "countdown-overlay";
    countdownEl.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      font-family: 'Outfit', 'Inter', sans-serif; font-size: 120px; font-weight: 900;
      color: #facc15; text-shadow: 0 4px 10px rgba(0,0,0,0.5);
      pointer-events: none; z-index: 100; display: none;
      transition: transform 0.15s ease-out;
    `;
    document.body.appendChild(countdownEl);
    (app as any).countdownEl = countdownEl;


    // Initial state copy
    localState = new GameState();

    room.onStateChange((state: any) => {
      if (!localState || !state) return;

      localState.matchPhase = state.matchPhase;
      localState.matchTimer = state.matchTimer;
      localState.mapId = state.mapId;
      localState.arenaRadius = state.arenaRadius;

      // Player sync remains manual for prediction
      const serverIds = Array.from(state.players).map((p: any) => p.id);
      for (let i = localState.players.length - 1; i >= 0; i--) {
        if (!serverIds.includes(localState.players[i].id)) {
          localState.players.splice(i, 1);
        }
      }

      for (const sPlayer of state.players) {
        let lPlayer = localState.players.find(p => p.id === sPlayer.id);

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

        if (sPlayer.id === room.sessionId) {
          // Save old predicted position for smoothing
          const oldPredX = lPlayer.x;
          const oldPredY = lPlayer.y;

          // Always reset to server authoritative state
          lPlayer.x = sPlayer.x;
          lPlayer.y = sPlayer.y;
          lPlayer.vx = sPlayer.vx;
          lPlayer.vy = sPlayer.vy;
          lPlayer.stunTimer = sPlayer.stunTimer;

          // Replay unacknowledged inputs (movement only, skip collisions)
          const toReplay = pendingInputs.filter(item => item.seq > lastAckedSeq);
          for (const item of toReplay) {
            const inMap = new Map<string, PlayerInput>();
            inMap.set(room.sessionId, item.input);
            stepPhysics(localState, inMap, 1 / 60, false, true);
          }

          // Compute smoothing offset: difference between old visual and new predicted
          const newPredX = lPlayer.x;
          const newPredY = lPlayer.y;
          const correctionDist = Math.sqrt(
            (oldPredX - newPredX) ** 2 + (oldPredY - newPredY) ** 2
          );

          if (correctionDist > SNAP_THRESHOLD) {
            // Teleport: too far, hard snap (no smoothing)
            smoothOffsetX = 0;
            smoothOffsetY = 0;
          } else {
            // Accumulate offset: visual stays at old position, decays toward new
            smoothOffsetX += oldPredX - newPredX;
            smoothOffsetY += oldPredY - newPredY;
          }
        } else {
          lPlayer.x = sPlayer.x;
          lPlayer.y = sPlayer.y;
          lPlayer.vx = sPlayer.vx;
          lPlayer.vy = sPlayer.vy;
        }
      }

      // Sync hazards to local state
      localState.hazards.clear();
      if (state.hazards) {
        for (const sh of state.hazards) {
          const lh = new Hazard();
          lh.id = sh.id; lh.type = sh.type;
          lh.x = sh.x; lh.y = sh.y; lh.radius = sh.radius;
          localState.hazards.push(lh);
        }
      }

      // Sync powerups to local state + detect collection for sound
      const prevPuIds = new Set<string>();
      for (const lp of localState.powerups) prevPuIds.add(lp.id);

      localState.powerups.clear();
      if (state.powerups) {
        for (const sp of state.powerups) {
          const lp = new PowerUp();
          lp.id = sp.id; lp.type = sp.type;
          lp.x = sp.x; lp.y = sp.y; lp.radius = sp.radius;
          localState.powerups.push(lp);
        }
      }

      // Play pickup sound for collected powerups (was in prev but not in current)
      const currPuIds = new Set<string>();
      for (const lp of localState.powerups) currPuIds.add(lp.id);
      for (const prevId of prevPuIds) {
        if (!currPuIds.has(prevId)) {
          playSound("pickup");
          break;
        }
      }

      // Fill snapshot buffer for remote player interpolation
      const snap: Snapshot = {
        timestamp: Date.now(),
        players: new Map()
      };
      for (const sp of state.players) {
        snap.players.set(sp.id, {
          x: sp.x, y: sp.y,
          vx: sp.vx, vy: sp.vy,
          radius: sp.radius, mass: sp.mass,
          alive: sp.alive
        });
      }
      snapshotBuffer.push(snap);
      while (snapshotBuffer.length > 60) snapshotBuffer.shift();
    });

    room.onMessage("ack", (message: { seq: number }) => {
      lastAckedSeq = message.seq;
      const idx = pendingInputs.findIndex(item => item.seq === lastAckedSeq);
      if (idx !== -1) pendingInputs.splice(0, idx + 1);
    });

    room.onMessage("kill", (data: { killer: string, victim: string }) => {
      showKill(data.killer, data.victim);
    });

    room.onMessage("ended", (data: { winner: string }) => {
      document.getElementById("lost-overlay")?.remove();
      const overlay = document.createElement("div");
      overlay.className = "overlay-container";
      overlay.innerHTML = `
        <h2 class="overlay-title">MATCH ENDED</h2>
        <h3 class="winner-announcement">🏆 WINNER: ${data.winner} 🏆</h3>
        <p class="overlay-subtitle">Play Again?</p>
        <button id="play-again-btn" class="lobby-btn" style="max-width: 200px;">RE-JOIN LOBBY</button>
      `;
      document.body.appendChild(overlay);
      document.getElementById("play-again-btn")?.addEventListener("click", () => {
        overlay.remove();
        room.leave();
        startLobby(username, mapId);
      });
    });

    setInterval(() => {
      if (!room || !localState) return;

      // Always read matchPhase from authoritative Colyseus state
      const roomPhase = room?.state?.matchPhase ?? localState.matchPhase;
      if (localState.matchPhase !== roomPhase) {
        localState.matchPhase = roomPhase;
      }
      const isWaiting = roomPhase === "waiting";
      const seq = nextSeq++;
      
      // If waiting, force all inputs to false
      const inputCopy = isWaiting ? { up: false, down: false, left: false, right: false, dash: false } : { ...currentInput };


      const lp = localState.players.find(p => p.id === room.sessionId);
      // Sound on dash START
      if (inputCopy.dash && lp && lp.dashCooldown === 0 && lp.dashTimer === 0) {
        playSound("dash");
      }
      // Trail particles while dashing
      if (lp && lp.dashTimer > 0) {
        spawnParticles(lp.x, lp.y, 3, parseInt(lp.color.replace("#", ""), 16), 0.8);
      }

      pendingInputs.push({ seq, input: inputCopy });
      const inMap = new Map<string, PlayerInput>();
      inMap.set(room.sessionId, inputCopy);
      
      // Use 1/60 for prediction since setInterval is 60Hz
      stepPhysics(localState, inMap, 1 / 60);

      room.send("input", { seq, ...inputCopy });
    }, 1000 / 60);

    app.ticker.add(() => renderGame());
  } catch (err: any) {
    console.error("[startLobby] error:", err);
    // Show error visually
    const errDiv = document.createElement("div");
    errDiv.style.cssText = "position:fixed;top:0;left:0;right:0;background:red;color:white;padding:16px;z-index:9999;font-family:monospace;white-space:pre-wrap;";
    errDiv.textContent = "[startLobby] " + (err?.stack || err?.message || String(err));
    document.body.appendChild(errDiv);
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;
      height:100vh;background:#0d1117;color:#ef4444;font-family:'Outfit','Inter',sans-serif;
      font-size:24px;font-weight:700;">Connection failed!</div>`;
  }
}

let lastLocalAlive = true;
let lastLocalVx = 0;
let lastLocalVy = 0;
let renderLogOnce = false;
const powerupGraphicsMap = new Map<string, Graphics>();
const hazardGraphicsMap = new Map<string, Graphics>();

function renderGame() {
  try {
  if (!localState || !app) return;
  if (!renderLogOnce) {
    renderLogOnce = true;
    const sp: any[] = room?.state?.players ? Array.from(room.state.players as Iterable<any>) : [];
    console.log("[SUMO] renderGame first call. localPlayers:", localState.players.length, "serverPlayers:", sp.length, "matchPhase:", localState.matchPhase);
  }

  const now = Date.now();

  // Decay smoothing offset exponentially
  const renderDt = app.ticker.deltaMS / 1000;
  const decay = Math.exp(-SMOOTH_RATE * renderDt);
  smoothOffsetX *= decay;
  smoothOffsetY *= decay;
  // Kill tiny residual
  if (Math.abs(smoothOffsetX) < 0.1) smoothOffsetX = 0;
  if (Math.abs(smoothOffsetY) < 0.1) smoothOffsetY = 0;

  // Compute interpolated positions for remote players from snapshot buffer
  const interpolatedPositions = new Map<string, { x: number; y: number }>();
  if (snapshotBuffer.length >= 2) {
    const renderTime = now - 100; // 100ms render delay for smooth interpolation
    let before: Snapshot | null = null;
    let after: Snapshot | null = null;
    for (let i = 0; i < snapshotBuffer.length - 1; i++) {
      if (snapshotBuffer[i].timestamp <= renderTime && snapshotBuffer[i + 1].timestamp >= renderTime) {
        before = snapshotBuffer[i];
        after = snapshotBuffer[i + 1];
        break;
      }
    }
    // Fallback: use last two snapshots if no pair found around renderTime
    if (!before && snapshotBuffer.length >= 2) {
      before = snapshotBuffer[snapshotBuffer.length - 2];
      after = snapshotBuffer[snapshotBuffer.length - 1];
    }
    if (before && after) {
      const range = after.timestamp - before.timestamp || 1;
      const alpha = Math.max(0, Math.min(1, (renderTime - before.timestamp) / range));
      for (const player of localState.players) {
        if (player.id === room.sessionId) continue;
        const bP = before.players.get(player.id);
        const aP = after.players.get(player.id);
        if (bP && aP && bP.alive && aP.alive) {
          interpolatedPositions.set(player.id, {
            x: bP.x + (aP.x - bP.x) * alpha,
            y: bP.y + (aP.y - bP.y) * alpha,
          });
        }
      }
    }
  }

  const minDim = Math.min(window.innerWidth, window.innerHeight);
  const viewScale = Math.min(1.0, minDim / ((PHYSICS.ARENA_RADIUS_DEFAULT * 2) + 120));
  app.stage.scale.set(viewScale);

  const cx = (window.innerWidth * 0.5) / viewScale;
  const cy = (window.innerHeight * 0.5) / viewScale;

  const lp = localState.players.find(p => p.id === room.sessionId);
  const serverPlayers: any[] = room?.state?.players ? Array.from(room.state.players as Iterable<any>) : [];
  const serverLp = serverPlayers.find(p => p.id === room.sessionId);
  const camPlayer = lp ?? serverLp;
  let ox = cx, oy = cy;
  if (camPlayer) {
    if (lastLocalAlive && !camPlayer.alive) {
      playSound("fall");
      const fallColor = typeof camPlayer.color === "string" && camPlayer.color.startsWith("#")
        ? (parseInt(camPlayer.color.slice(1), 16) || 0xff4444) : 0xff4444;
      spawnParticles(camPlayer.x, camPlayer.y, 40, fallColor, 2.0);

      // Show Game Lost overlay
      if (!document.getElementById("lost-overlay")) {
        const lostEl = document.createElement("div");
        lostEl.id = "lost-overlay";
        lostEl.style.cssText = `
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.6); z-index: 200; pointer-events: auto;
        `;
        lostEl.innerHTML = `
          <h2 style="font-family: 'Outfit','Inter',sans-serif; font-size: 72px; font-weight: 900;
            color: #ef4444; text-shadow: 0 4px 10px rgba(0,0,0,0.5); margin: 0;">YOU LOST</h2>
          <p style="font-family: 'Outfit','Inter',sans-serif; font-size: 20px; color: #94a3b8;
            margin: 16px 0 32px;">Knocked out of the arena!</p>
          <div style="display: flex; gap: 16px;">
            <button id="spectate-btn" style="padding: 12px 32px; font-size: 18px; font-weight: 700;
              font-family: 'Outfit','Inter',sans-serif; background: #1e293b; color: #e2e8f0;
              border: 2px solid #475569; border-radius: 8px; cursor: pointer;">SPECTATE</button>
            <button id="rejoin-btn" style="padding: 12px 32px; font-size: 18px; font-weight: 700;
              font-family: 'Outfit','Inter',sans-serif; background: #3b82f6; color: white;
              border: none; border-radius: 8px; cursor: pointer;">REJOIN</button>
          </div>
        `;
        document.body.appendChild(lostEl);
        document.getElementById("spectate-btn")?.addEventListener("click", () => {
          lostEl.remove();
        });
        document.getElementById("rejoin-btn")?.addEventListener("click", () => {
          const playerName = camPlayer.name || "Guest";
          const currentMap = localState?.mapId || "classic";
          lostEl.remove();
          room.leave();
          startLobby(playerName, currentMap);
        });
      }
    }
    lastLocalAlive = camPlayer.alive;
    if (camPlayer.alive) {
      const dv = Math.sqrt(Math.pow(camPlayer.vx - lastLocalVx, 2) + Math.pow(camPlayer.vy - lastLocalVy, 2));
      if (dv > 220) {
        playSound("hit");
        screenShakeAmount = 15;
        spawnParticles(camPlayer.x, camPlayer.y, 15, 0xffffff, 1.5);
      }
      lastLocalVx = camPlayer.vx; lastLocalVy = camPlayer.vy;
      ox = cx - camPlayer.x;
      oy = cy - camPlayer.y;
    }
  }

  if (screenShakeAmount > 0) {
    ox += (Math.random() - 0.5) * screenShakeAmount;
    oy += (Math.random() - 0.5) * screenShakeAmount;
    screenShakeAmount *= 0.9;
  }

  arenaGraphics.clear();
  
  // Arena shrink visual: turn border red when shrinking
  const isShrinking = (90 - localState.matchTimer) > PHYSICS.ARENA_SHRINK_GRACE;
  const borderColor = isShrinking ? 0xef4444 : 0x3b82f6;
  const borderAlpha = isShrinking ? 0.8 + Math.sin(Date.now() * 0.01) * 0.2 : 1.0;
  
  arenaGraphics.circle(ox, oy, localState.arenaRadius)
    .fill({ color: 0x111827 })
    .stroke({ color: borderColor, width: isShrinking ? 6 : 4, alpha: borderAlpha });

  if (isShrinking && Math.random() > 0.7) {
    // Add small danger particles at the edge
    const angle = Math.random() * Math.PI * 2;
    const px = Math.cos(angle) * localState.arenaRadius;
    const py = Math.sin(angle) * localState.arenaRadius;
    spawnParticles(px, py, 2, 0xef4444, 0.5);
  }

  if (particleGraphics) {
    particleGraphics.clear();
    const dt = app.ticker.deltaMS / 1000;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const alpha = Math.max(0, p.life / p.maxLife);
      particleGraphics.circle(ox + p.x, oy + p.y, p.size * alpha).fill({ color: p.color, alpha });
    }
  }

  // 4. Render Hazards (Directly from server state)
    const hazards = room?.state?.hazards || [];
    const currentHazardIds = new Set();
    for (const h of hazards) {
        currentHazardIds.add(h.id);
        let hG = hazardGraphicsMap.get(h.id);
        if (!hG) { 
            hG = new Graphics(); 
            app.stage.addChild(hG); 
            hazardGraphicsMap.set(h.id, hG); 
        }
        hG.clear();
        
        const hx = ox + h.x;
        const hy = oy + h.y;
        const radius = h.radius || 30;

        if (h.type === "lava") {
            hG.circle(hx, hy, radius).fill({ color: 0xef4444, alpha: 0.7 }).stroke({ color: 0xffffff, width: 3 });
        } else if (h.type === "blackhole") {
            hG.circle(hx, hy, radius).fill({ color: 0x111111, alpha: 0.9 }).stroke({ color: 0x8b5cf6, width: 4 });
            hG.circle(hx, hy, radius * 0.7).stroke({ color: 0x6366f1, width: 2, alpha: 0.5 });
        } else if (h.type === "bumper") {
            hG.circle(hx, hy, radius).fill({ color: 0x22d3ee, alpha: 0.6 }).stroke({ color: 0xffffff, width: 4 });
            for (let i = 0; i < 3; i++) {
                hG.circle(hx, hy, radius * (0.3 + i * 0.2)).stroke({ color: 0x06b6d4, width: 2 });
            }
            const pulse = 1 + Math.sin(Date.now() * 0.015) * 0.08;
            hG.scale.set(pulse);
            // Re-center after scaling
            hG.pivot.set(hx, hy);
            hG.position.set(hx, hy);
        }
    }

    // Cleanup old hazard graphics
    for (const [id, hG] of hazardGraphicsMap.entries()) {
        if (!currentHazardIds.has(id)) {
            hG.destroy();
            hazardGraphicsMap.delete(id);
        }
    }

  // 5. Render Power-Ups (Directly from server state)
    const powerups = room?.state?.powerups || [];
    const currentPowerupIds = new Set();
    for (const pu of powerups) {
        currentPowerupIds.add(pu.id);
        let pG = powerupGraphicsMap.get(pu.id);
        if (!pG) { 
            pG = new Graphics(); 
            app.stage.addChild(pG); 
            powerupGraphicsMap.set(pu.id, pG); 
        }
        pG.clear();
        const px_pu = ox + pu.x;
        const py_pu = oy + pu.y;

        const color = pu.type === "speed" ? 0xfacc15 : 
                    (pu.type === "shield" ? 0x22d3ee : 
                    (pu.type === "growth" ? 0x4ade80 : 
                    (pu.type === "hammer" ? 0xf87171 : 0xa5b4fc)));
        pG.circle(px_pu, py_pu, pu.radius).fill({ color }).stroke({ color: 0xffffff, width: 2 });
    }

    // Cleanup old powerup graphics
    for (const [id, pG] of powerupGraphicsMap.entries()) {
        if (!currentPowerupIds.has(id)) {
            pG.destroy();
            powerupGraphicsMap.delete(id);
        }
    }

  // 6. Render Players from localState (with interpolation for remotes)
  const localPlayers = localState.players as Iterable<any>;
  const renderList = (serverPlayers.length > 0 && localState.players.length === 0)
    ? serverPlayers
    : Array.from(localPlayers);
  const renderTime = now;

  for (const player of renderList) {
    if (!player?.id) continue;
    if (!player.alive) {
        playerGraphicsMap.get(player.id)?.clear();
        const nt = playerNameTextMap.get(player.id);
        if (nt) nt.visible = false;
        continue;
    }
    let pg = playerGraphicsMap.get(player.id);
    if (!pg) { pg = new Graphics(); app.stage.addChild(pg); playerGraphicsMap.set(player.id, pg); }
    pg.clear();

    const isLocal = player.id === room.sessionId;
    const radius = player.radius || 30;

    // Use interpolated position for remote players, smoothed predicted for local
    let px: number, py: number;
    if (isLocal && lp?.alive) {
      px = lp.x + smoothOffsetX;
      py = lp.y + smoothOffsetY;
    } else if (!isLocal) {
      const interp = interpolatedPositions.get(player.id);
      if (interp) {
        px = interp.x;
        py = interp.y;
      } else {
        px = player.x ?? 0;
        py = player.y ?? 0;
      }
    } else {
      px = player.x ?? 0;
      py = player.y ?? 0;
    }

    const colorStr: string = player.color ?? "";
    const pColor = parseColor(colorStr);

    const pAlpha = player.ghostTimer > 0 ? 0.4 : 1.0;
    // Main circle
    pg.circle(ox + px, oy + py, radius)
      .fill({ color: pColor, alpha: pAlpha })
      .stroke({ color: 0xffffff, width: isLocal ? 3 : 1, alpha: pAlpha });

    // Stun visual - flashing white overlay
    if (player.stunTimer > 0) {
      const stunPulse = 0.3 + Math.sin(renderTime * 0.025) * 0.3;
      pg.circle(ox + px, oy + py, radius + 3)
        .stroke({ color: 0xffffff, width: 3, alpha: stunPulse });
    }

    if (player.shieldActive)
      pg.circle(ox + px, oy + py, radius + 6).stroke({ color: 0x22d3ee, width: 3 });
    if (player.hammerCharge) {
      pg.circle(ox + px, oy + py, radius + 4)
        .stroke({ color: 0xf87171, width: 4, alpha: 0.6 + Math.sin(renderTime * 0.02) * 0.4 });
    }
    if (player.ghostTimer > 0) {
      if (Math.random() > 0.8) spawnParticles(px, py, 1, 0xa5b4fc, 0.2);
    }

    // Dash: glow ring while boosting, cooldown ring otherwise
    if (isLocal && player.dashTimer > 0) {
      // Active dash: pulsing orange ring
      const dashAlpha = 0.6 + Math.sin(renderTime * 0.03) * 0.4;
      pg.circle(ox + px, oy + py, radius + 10)
        .stroke({ color: 0xf97316, width: 4, alpha: dashAlpha });
    } else if (isLocal && player.dashCooldown > 0) {
      const cdFrac = player.dashCooldown / PHYSICS.DASH_COOLDOWN;
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (1 - cdFrac) * Math.PI * 2;
      pg.arc(ox + px, oy + py, radius + 8, startAngle, endAngle)
        .stroke({ color: 0xfacc15, width: 2, alpha: 0.8 });
    }

    // Render Name Tag
    let nameText = playerNameTextMap.get(player.id);
    if (!nameText) {
      nameText = new Text({
        text: player.name || "Guest",
        style: {
          fontFamily: "'Outfit', 'Inter', sans-serif",
          fontSize: 16,
          fontWeight: "800",
          fill: 0xffffff,
          align: "center",
          stroke: { color: 0x000000, width: 3 }
        }
      });
      nameText.anchor.set(0.5);
      app.stage.addChild(nameText);
      playerNameTextMap.set(player.id, nameText);
    }
    nameText.text = player.name || "Guest";
    nameText.x = ox + px;
    nameText.y = oy + py + radius + 20;
    nameText.visible = true;
    nameText.alpha = pAlpha;
  }

  // Cleanup old player graphics and names
  for (const [id, pg] of playerGraphicsMap.entries()) {
    const stillInList = renderList.some((p: any) => p.id === id);
    if (!stillInList) {
        pg.destroy();
        playerGraphicsMap.delete(id);
        const nt = playerNameTextMap.get(id);
        if (nt) { nt.destroy(); playerNameTextMap.delete(id); }
    }
  }

  // 7. Update Scoreboard (only when kills change)
  const sortedPlayers = [...renderList].sort((a, b) => (b.kills || 0) - (a.kills || 0));
  const killHash = sortedPlayers.map(p => `${p.id}:${p.kills || 0}`).join(",");
  if (killHash !== lastKillHash) {
    lastKillHash = killHash;
    let sb = "SCOREBOARD\n";
    sortedPlayers.forEach((p, i) => {
      sb += `${i+1}. ${p.name || "???"}: ${p.kills || 0} Kills\n`;
    });
    scoreboardText.text = sb;
    scoreboardText.x = (window.innerWidth / viewScale) - scoreboardText.width - 20;
    scoreboardText.y = 20;
  }

  const aliveCount = renderList.filter((p: any) => p?.alive).length;
  const objectCount = (room?.state?.hazards?.length || 0) + (room?.state?.powerups?.length || 0);
  const ping = room?.connection?.transport?.ping || 0;

  const currentPhase = room?.state?.matchPhase ?? localState?.matchPhase;
  const isWaiting = currentPhase === "waiting";
  const timerLabel = isWaiting ? "STARTS IN" : "TIME";
  const timerVal = Math.ceil(localState?.matchTimer || 0);

  hudText.text = `SUMO CLASH\nMap: ${(localState?.mapId || "Classic").toUpperCase()}\nPlayers Alive: ${aliveCount}\n${timerLabel}: ${timerVal}s\nObjects: ${objectCount}\nPing: ${ping}ms`;
  
  const cdEl = (app as any).countdownEl as HTMLDivElement | undefined;
  if (cdEl) {
    if (isWaiting && timerVal > 0) {
      const pulse = 1 + Math.sin(Date.now() * 0.01) * 0.1;
      cdEl.style.display = "block";
      cdEl.textContent = timerVal.toString();
      cdEl.style.color = "#facc15";
      cdEl.style.transform = `translate(-50%, -50%) scale(${pulse})`;
    } else if (currentPhase === "playing" && localState.matchTimer > 88) {
      cdEl.style.display = "block";
      cdEl.textContent = "GO!";
      cdEl.style.color = "#4ade80";
      cdEl.style.transform = "translate(-50%, -50%) scale(1.2)";
    } else {
      cdEl.style.display = "none";
    }
  }

  if (isWaiting) {
    hudText.style.fill = 0xfacc15;
  } else {
    hudText.style.fill = 0xffffff;
  }

  } catch (err: any) {
    console.error("[renderGame] crash:", err);
    // Show error on screen
    const errDiv = document.getElementById("render-error") || document.createElement("div");
    errDiv.id = "render-error";
    errDiv.style.cssText = "position:fixed;top:0;left:0;right:0;background:red;color:white;padding:16px;z-index:9999;font-family:monospace;white-space:pre-wrap;";
    errDiv.textContent = "[renderGame] " + (err?.stack || err?.message || String(err));
    document.body.appendChild(errDiv);
  }
}

window.addEventListener("resize", () => {
  if (app) {
    app.renderer.resize(window.innerWidth, window.innerHeight);
  }
});
