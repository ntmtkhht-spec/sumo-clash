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
let hudText: Text;
let scoreboardText: Text;

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

async function startLobby(username: string, mapId: string) {
  statusEl.innerText = "Connecting to matchmaking server...";
  const client = new Client("wss://sumo-clash-server.onrender.com");

  try {
    room = await client.joinOrCreate("battle", { username, mapId });
    console.log("[SUMO] Room joined, sessionId:", room.sessionId);
    statusEl.innerText = `Joined room successfully. Initializing renderer...`;

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

    // Initial state copy
    localState = new GameState();

    room.onStateChange((state: any) => {
      if (!localState || !state) return;

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

        if (sPlayer.id === room.sessionId) {
          const dx = lPlayer.x - sPlayer.x;
          const dy = lPlayer.y - sPlayer.y;

          if (Math.sqrt(dx * dx + dy * dy) > 1.0) {
            lPlayer.x = sPlayer.x;
            lPlayer.y = sPlayer.y;
            lPlayer.vx = sPlayer.vx;
            lPlayer.vy = sPlayer.vy;

            const toReplay = pendingInputs.filter(item => item.seq > lastAckedSeq);
            for (const item of toReplay) {
              const inMap = new Map<string, PlayerInput>();
              inMap.set(room.sessionId, item.input);
              stepPhysics(localState, inMap, 1 / 60);
            }
          }
        } else {
          lPlayer.x = sPlayer.x;
          lPlayer.y = sPlayer.y;
          lPlayer.vx = sPlayer.vx;
          lPlayer.vy = sPlayer.vy;
        }
      }
    });

    // Helper to add hazard to local state
    const addLocalHazard = (h: any) => {
      const localH = new Hazard();
      localH.id = h.id;
      localH.type = h.type;
      localH.x = h.x;
      localH.y = h.y;
      localH.radius = h.radius || 30;
      localState?.hazards.push(localH);
      
      h.onChange = () => {
        localH.x = h.x;
        localH.y = h.y;
        localH.radius = h.radius;
      };
    };

    // Helper to add powerup to local state
    const addLocalPowerup = (p: any) => {
      const localP = new PowerUp();
      localP.id = p.id;
      localP.type = p.type;
      localP.x = p.x;
      localP.y = p.y;
      localP.radius = p.radius || 18;
      localState?.powerups.push(localP);
    };

    // Hazards/powerups rendered directly from room.state each frame — no onAdd needed.

    room.onMessage("ack", (message: { seq: number }) => {
      lastAckedSeq = message.seq;
      const idx = pendingInputs.findIndex(item => item.seq === lastAckedSeq);
      if (idx !== -1) pendingInputs.splice(0, idx + 1);
    });

    room.onMessage("kill", (data: { killer: string, victim: string }) => {
      showKill(data.killer, data.victim);
    });

    room.onMessage("ended", (data: { winner: string }) => {
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
      const seq = nextSeq++;
      const inputCopy = { ...currentInput };

      const lp = localState.players.find(p => p.id === room.sessionId);
      if (inputCopy.dash && lp && lp.dashCooldown === 0) {
        playSound("dash");
        spawnParticles(lp.x, lp.y, 20, parseInt(lp.color.replace("#", ""), 16), 1.2);
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
    if (statusEl?.parentNode) statusEl.innerText = "Connection failed!";
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
  const renderTime = now - 100;

  if (snapshotBuffer.length >= 2) {
    let before: Snapshot | null = null;
    let after: Snapshot | null = null;
    for (let i = 0; i < snapshotBuffer.length - 1; i++) {
      if (snapshotBuffer[i].timestamp <= renderTime && snapshotBuffer[i + 1].timestamp >= renderTime) {
        before = snapshotBuffer[i];
        after = snapshotBuffer[i + 1];
        break;
      }
    }
    if (before && after) {
      const alpha = (renderTime - before.timestamp) / (after.timestamp - before.timestamp);
      for (const player of localState.players) {
        if (player.id === room.sessionId) continue;
        const bP = before.players.get(player.id);
        const aP = after.players.get(player.id);
        if (bP && aP && bP.alive && aP.alive) {
          player.x = bP.x + (aP.x - bP.x) * alpha;
          player.y = bP.y + (aP.y - bP.y) * alpha;
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
      ox = cx - camPlayer.x; oy = cy - camPlayer.y;
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

  // 6. Render Players
  const renderList = serverPlayers.length > 0 ? serverPlayers : Array.from(localState.players as Iterable<any>);
  for (const player of renderList) {
    if (!player?.id) continue;
    if (!player.alive) { playerGraphicsMap.get(player.id)?.clear(); continue; }
    let pg = playerGraphicsMap.get(player.id);
    if (!pg) { pg = new Graphics(); app.stage.addChild(pg); playerGraphicsMap.set(player.id, pg); }
    pg.clear();

    const isLocal = player.id === room.sessionId;
    const px = (isLocal && lp?.alive) ? lp.x : (player.x ?? 0);
    const py = (isLocal && lp?.alive) ? lp.y : (player.y ?? 0);
    const radius = player.radius || 30;
    const colorStr: string = player.color ?? "";
    const pColor = colorStr.startsWith("#")
      ? (parseInt(colorStr.slice(1), 16) || 0x3b82f6)
      : 0x3b82f6;

    const pAlpha = player.ghostTimer > 0 ? 0.4 : 1.0;
    pg.circle(ox + px, oy + py, radius).fill({ color: pColor, alpha: pAlpha }).stroke({ color: 0xffffff, width: isLocal ? 3 : 1, alpha: pAlpha });
    
    if (player.shieldActive) pg.circle(ox + px, oy + py, radius + 6).stroke({ color: 0x22d3ee, width: 3 });
    if (player.hammerCharge) {
      // Draw a "heavy" outline for hammer charge
      pg.circle(ox + px, oy + py, radius + 4).stroke({ color: 0xf87171, width: 4, alpha: 0.6 + Math.sin(Date.now() * 0.02) * 0.4 });
    }
    if (player.ghostTimer > 0) {
      // Trail effect for ghost
      if (Math.random() > 0.8) spawnParticles(px, py, 1, 0xa5b4fc, 0.2);
    }
  }

  // 7. Update Scoreboard
  const sortedPlayers = [...renderList].sort((a, b) => (b.kills || 0) - (a.kills || 0));
  let sb = "SCOREBOARD\n";
  sortedPlayers.forEach((p, i) => {
    sb += `${i+1}. ${p.name || "???"}: ${p.kills || 0} Kills\n`;
  });
  scoreboardText.text = sb;
  scoreboardText.x = (window.innerWidth / viewScale) - scoreboardText.width - 20;
  scoreboardText.y = 20;

  const aliveCount = renderList.filter((p: any) => p?.alive).length;
  const objectCount = (room?.state?.hazards?.length || 0) + (room?.state?.powerups?.length || 0);
  hudText.text = `SUMO CLASH\nMap: ${(localState?.mapId || "Classic").toUpperCase()}\nPlayers Alive: ${aliveCount}\nTime: ${Math.ceil(localState?.matchTimer || 0)}s\nObjects: ${objectCount}`;

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
