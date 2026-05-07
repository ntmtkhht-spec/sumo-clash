import { Room, Client } from "colyseus";
import { GameState, Player, Hazard, PowerUp, PHYSICS, stepPhysics, PlayerInput } from "@sumo/shared";

interface InputMessage {
  seq: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  dash: boolean;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l / 100 - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export class BattleRoom extends Room<any> {
  maxClients = 8;
  inputs = new Map<string, PlayerInput>();
  inputBuffer = new Map<string, InputMessage[]>();
  lastSeq = new Map<string, number>();

  powerupTimer = 10;
  bumperTimer = 15;
  countdownStarted: boolean = false;
  accumulatedTime: number = 0;

  onCreate(options: any) {
    this.setState(new GameState());

    if (options.mapId) {
      this.state.mapId = options.mapId;
    }

    this.onMessage("input", (client: Client, message: InputMessage) => {
      let clientInputs = this.inputBuffer.get(client.sessionId);
      if (!clientInputs) {
        clientInputs = [];
        this.inputBuffer.set(client.sessionId, clientInputs);
      }
      clientInputs.push(message);
    });

    this.setSimulationInterval((dt: number) => {
      this.accumulatedTime += dt / 1000;
      while (this.accumulatedTime >= PHYSICS.TICK_DT) {
        this.update(PHYSICS.TICK_DT);
        this.accumulatedTime -= PHYSICS.TICK_DT;
      }
    }, 1000 / PHYSICS.TICK_RATE_HZ);
    
    console.log("BattleRoom created with map:", this.state.mapId, this.roomId);
  }

  onJoin(client: Client, options: any) {
    console.log(options.username || client.sessionId, "joined!");

    const player = new Player();
    player.id = client.sessionId;
    player.name = options.username || `Player_${client.sessionId.slice(0, 4)}`;
    
    const radius = this.state.arenaRadius * 0.5;
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * radius;
    player.x = Math.cos(angle) * dist;
    player.y = Math.sin(angle) * dist;
    
    const hue = Math.floor(Math.random() * 360);
    const hex = hslToHex(hue, 75, 60);
    player.color = hex;
    player.alive = true;

    this.state.players.push(player);

    if (this.state.matchPhase === "waiting" && !this.countdownStarted) {
      this.state.matchTimer = 3;
      this.countdownStarted = true;
    }
  }

  onLeave(client: Client, code?: number) {
    const player = this.state.players.find((p: Player) => p.id === client.sessionId);
    if (player) {
      player.alive = false;
    }
    console.log(client.sessionId, "left!");
  }

  onDispose() {
    console.log("Room", this.roomId, "disposing...");
  }

  setupHazardsForMap() {
    this.state.hazards.clear();

    if (this.state.mapId === "volcano") {
      const lava = new Hazard();
      lava.id = "volcano_lava";
      lava.type = "lava";
      lava.x = 0;
      lava.y = 0;
      lava.radius = 100;
      this.state.hazards.push(lava);
    } else if (this.state.mapId === "space") {
      const bh = new Hazard();
      bh.id = "space_blackhole";
      bh.type = "blackhole";
      bh.x = 0;
      bh.y = 0;
      bh.radius = 60;
      this.state.hazards.push(bh);
    }
    // Classic map now has no hazards by default
  }

  update(dt: number) {
    // 0. Countdown phase — runs inside simulation loop so Colyseus broadcasts it
    if (this.state.matchPhase === "waiting" && this.countdownStarted) {
      this.state.matchTimer = Math.max(0, this.state.matchTimer - dt);
      if (this.state.matchTimer <= 0) {
        this.state.matchPhase = "playing";
        this.state.matchTimer = 90;
        this.countdownStarted = false;
        this.setupHazardsForMap();
      }
    }

    // 1. Match State Management
    if (this.state.matchPhase === "playing") {
      this.powerupTimer -= dt;
      if (this.powerupTimer <= 0) {
        this.powerupTimer = 10;
        const pu = new PowerUp();
        pu.id = `pu_${Date.now()}`;
        const types = ["speed", "shield", "growth", "hammer", "ghost"];
        pu.type = types[Math.floor(Math.random() * types.length)];
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * (this.state.arenaRadius - 40) * 0.7;
        pu.x = Math.cos(angle) * dist;
        pu.y = Math.sin(angle) * dist;
        this.state.powerups.push(pu);
        console.log("PowerUp spawned:", pu.type, "at", pu.x, pu.y);
      }

      this.bumperTimer -= dt;
      if (this.bumperTimer <= 0) {
        this.bumperTimer = 8; // New bumper every 8 seconds
        // Cap bumpers to prevent unbounded growth
        const bumperCount = this.state.hazards.filter((h: any) => h.type === "bumper").length;
        if (bumperCount < PHYSICS.BUMPER_MAX) {
          const bumper = new Hazard();
          bumper.id = `bumper_${Date.now()}`;
          bumper.type = "bumper";
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * (this.state.arenaRadius - 100);
          bumper.x = Math.cos(angle) * dist;
          bumper.y = Math.sin(angle) * dist;
          bumper.radius = 25 + Math.random() * 15;
          this.state.hazards.push(bumper);
          console.log("Bumper spawned at", bumper.x, bumper.y);
        }
      }

      const alivePlayers = this.state.players.filter((p: Player) => p.alive);
      const totalPlayers = this.state.players.length;
      
      // Match ends if:
      // 1. There were multiple players and only 1 is left alive
      // 2. The match timer reaches 0
      if ((totalPlayers >= 2 && alivePlayers.length <= 1) || this.state.matchTimer <= 0) {
        this.state.matchPhase = "ended";
        
        let winnerName = "No one";
        if (alivePlayers.length === 1) {
          winnerName = alivePlayers[0].name;
        } else if (alivePlayers.length > 1) {
          // Tie-break by kills if timer ran out
          const sorted = [...alivePlayers].sort((a: Player, b: Player) => b.kills - a.kills);
          winnerName = sorted[0].name;
        }

        this.broadcast("ended", { winner: winnerName });
      }
    }

    // 2. Clear out input map
    this.inputs.clear();

    // 3. Process buffered client inputs - accumulate all, not just last
    for (const [sessionId, buffered] of this.inputBuffer.entries()) {
      const player = this.state.players.find((p: Player) => p.id === sessionId);
      if (!player || !player.alive || this.state.matchPhase !== "playing") continue;

      if (buffered.length > 0) {
        // Use last input's direction (most recent intent)
        const lastInput = buffered[buffered.length - 1];
        // Accumulate dash across ALL buffered inputs so one-shot dashes aren't lost
        const dashAccum = buffered.some(inp => inp.dash);
        this.inputs.set(sessionId, {
          up: lastInput.up,
          down: lastInput.down,
          left: lastInput.left,
          right: lastInput.right,
          dash: dashAccum
        });
        this.lastSeq.set(sessionId, lastInput.seq);
        this.inputBuffer.set(sessionId, []);
      }
    }

    // 4. Send acknowledgements
    for (const player of this.state.players) {
      if (this.lastSeq.has(player.id)) {
        const client = this.clients.find((c: Client) => c.sessionId === player.id);
        if (client) {
          client.send("ack", { seq: this.lastSeq.get(player.id) });
        }
      }
    }

    // 5. Run physics
    const wasAlive = new Map<string, boolean>();
    for (const p of this.state.players) wasAlive.set(p.id, p.alive);

    stepPhysics(this.state, this.inputs, dt);

    // Validate player speeds (anti-cheat)
    const maxValidSpeed = PHYSICS.PLAYER_MAX_SPEED * 1.5 + PHYSICS.DASH_IMPULSE + 200;
    for (const player of this.state.players) {
      if (!player.alive) continue;
      const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
      if (speed > maxValidSpeed) {
        const scale = maxValidSpeed / speed;
        player.vx *= scale;
        player.vy *= scale;
      }
      // Clamp position to arena bounds
      const distFromCenter = Math.sqrt(player.x * player.x + player.y * player.y);
      if (distFromCenter > this.state.arenaRadius + player.radius) {
        const clampScale = (this.state.arenaRadius - player.radius) / distFromCenter;
        player.x *= clampScale;
        player.y *= clampScale;
      }
    }

    // 6. Check for new deaths
    for (const player of this.state.players) {
      if (wasAlive.get(player.id) && !player.alive) {
        // Player just died!
        let killerName = "The Void";
        if (player.lastHitBy) {
          const killer = this.state.players.find((p: Player) => p.id === player.lastHitBy);
          if (killer) {
            killer.kills++;
            killer.score += 100;
            killerName = killer.name;
          }
        }
        
        this.broadcast("kill", {
          victim: player.name,
          killer: killerName
        });
      }
    }
  }
}
