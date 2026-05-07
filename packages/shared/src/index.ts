if (typeof (Symbol as any).metadata === "undefined") {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}
import { Schema, ArraySchema, type } from "@colyseus/schema";

export const PHYSICS = {
  TICK_RATE_HZ: 60,
  TICK_DT: 1 / 60,
  PLAYER_RADIUS_DEFAULT: 30,
  PLAYER_MASS_DEFAULT: 1.0,
  PLAYER_ACCEL: 1800,
  PLAYER_MAX_SPEED: 350,
  FRICTION: 4.0,
  COLLISION_RESTITUTION: 0.85,
  PUSH_FORCE_MULTIPLIER: 1.5,
  DASH_IMPULSE: 600,
  DASH_DURATION: 0.15,
  DASH_COOLDOWN: 3.0,
  ARENA_RADIUS_DEFAULT: 500,
  ARENA_SHRINK_RATE: 0.5,
  ARENA_SHRINK_GRACE: 15,
  MASS_GROWTH_PER_SECOND: 0.04,
  RADIUS_GROWTH_PER_SECOND: 0.6,
  MAX_MASS: 3.0,
  MAX_RADIUS: 60,
};

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") vx: number = 0;
  @type("float32") vy: number = 0;
  @type("float32") radius: number = PHYSICS.PLAYER_RADIUS_DEFAULT;
  @type("float32") mass: number = PHYSICS.PLAYER_MASS_DEFAULT;
  @type("string") color: string = "#3498db";
  @type("boolean") alive: boolean = true;
  @type("float32") dashCooldown: number = 0;
  @type("float32") stunTimer: number = 0;
  @type("boolean") shieldActive: boolean = false;
  @type("float32") speedBoostTimer: number = 0;
  @type("uint16") kills: number = 0;
  @type("uint32") score: number = 0;
  @type("string") lastHitBy: string = "";
  @type("float32") ghostTimer: number = 0;
  @type("boolean") hammerCharge: boolean = false;
}

export class Hazard extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = "lava";
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") radius: number = 80;
  @type("float32") vx: number = 0;
  @type("float32") vy: number = 0;
}

export class PowerUp extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = "speed";
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") radius: number = 18;
}

export class GameState extends Schema {
  @type([Player]) players = new ArraySchema<Player>();
  @type([Hazard]) hazards = new ArraySchema<Hazard>();
  @type([PowerUp]) powerups = new ArraySchema<PowerUp>();
  @type("float32") arenaRadius: number = PHYSICS.ARENA_RADIUS_DEFAULT;
  @type("string") matchPhase: string = "waiting";
  @type("float32") matchTimer: number = 90;
  @type("string") mapId: string = "classic";
}

/**
 * Deterministic physics step function for shared use by server and client.
 */

export interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  dash: boolean;
}

/**
 * Deterministic physics step function for shared use by server and client.
 */
export function stepPhysics(state: GameState, inputs: Map<string, PlayerInput>, dt: number, updateGlobalState: boolean = true) {
  // 1. Process arena shrinking
  if (updateGlobalState && state.matchPhase === "playing") {
    state.matchTimer = Math.max(0, state.matchTimer - dt);

    const elapsed = 90 - state.matchTimer;
    if (elapsed > PHYSICS.ARENA_SHRINK_GRACE) {
      state.arenaRadius = Math.max(0, state.arenaRadius - PHYSICS.ARENA_SHRINK_RATE * dt);
    }
  }

  // 2. Process inputs and update movement
  for (const player of state.players) {
    if (!player.alive) continue;

    // Decrement timers
    if (player.stunTimer > 0) {
      player.stunTimer = Math.max(0, player.stunTimer - dt);
    }
    if (player.speedBoostTimer > 0) {
      player.speedBoostTimer = Math.max(0, player.speedBoostTimer - dt);
    }
    if (player.ghostTimer > 0) {
      player.ghostTimer = Math.max(0, player.ghostTimer - dt);
    }

    const input = inputs.get(player.id);
    // Only process inputs if not stunned
    if (input && player.stunTimer === 0) {
      // Dash cooldown processing
      if (player.dashCooldown > 0) {
        player.dashCooldown = Math.max(0, player.dashCooldown - dt);
      }

      // Movement accel
      let ax = 0;
      let ay = 0;

      if (input.up) ay -= 1;
      if (input.down) ay += 1;
      if (input.left) ax -= 1;
      if (input.right) ax += 1;

      // Normalize diagonal movement accel
      const dist = Math.sqrt(ax * ax + ay * ay);
      if (dist > 0) {
        let accel = PHYSICS.PLAYER_ACCEL;
        if (player.speedBoostTimer > 0) {
          accel *= 1.4; // Speed Boost accel multiplier
        }
        ax = (ax / dist) * accel;
        ay = (ay / dist) * accel;
      }

      player.vx += ax * dt;
      player.vy += ay * dt;

      // Apply dash impulse
      if (input.dash && player.dashCooldown === 0) {
        if (dist > 0) {
          player.vx += (ax / dist) * PHYSICS.DASH_IMPULSE;
          player.vy += (ay / dist) * PHYSICS.DASH_IMPULSE;
        } else {
          // Dash in the direction the player was facing or just default to forward
          player.vy -= PHYSICS.DASH_IMPULSE;
        }
        player.dashCooldown = PHYSICS.DASH_COOLDOWN;
      }
    }

    // Apply friction
    player.vx *= Math.exp(-PHYSICS.FRICTION * dt);
    player.vy *= Math.exp(-PHYSICS.FRICTION * dt);

    // Limit max speed
    const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
    let maxSpeed = PHYSICS.PLAYER_MAX_SPEED;
    if (player.speedBoostTimer > 0) {
      maxSpeed *= 1.5; // Speed Boost max speed multiplier
    }
    if (speed > maxSpeed) {
      player.vx = (player.vx / speed) * maxSpeed;
      player.vy = (player.vy / speed) * maxSpeed;
    }

    // Position updates
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // Eliminate if outside arena
    const distFromCenter = Math.sqrt(player.x * player.x + player.y * player.y);
    if (distFromCenter > state.arenaRadius - player.radius * 0.5) {
      player.alive = false;
      player.vx = 0;
      player.vy = 0;
    }
  }

  // 3. Move hazards and check hazard collision
  for (const hazard of state.hazards) {
    // Simple orbital motion for hazards
    if (updateGlobalState) {
      if (hazard.type === "lava") {
        const time = state.matchTimer;
        hazard.x = Math.sin(time * 0.5) * 150;
        hazard.y = Math.cos(time * 0.5) * 150;
      } else if (hazard.type === "blackhole") {
        const time = state.matchTimer * 0.7;
        hazard.x = Math.sin(time) * 180;
        hazard.y = Math.cos(time) * 180;
      }
    }

    for (const player of state.players) {
      if (!player.alive) continue;

      const dx = player.x - hazard.x;
      const dy = player.y - hazard.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const minDist = player.radius + hazard.radius;

      if (dist < minDist) {
        // Push the player away from hazard
        const nx = dx / dist;
        const ny = dy / dist;

        // Separate to prevent jitter/sinking
        const overlap = minDist - dist;
        player.x += nx * overlap;
        player.y += ny * overlap;

        if (hazard.type === "bumper") {
          // Trampoline effect: Very strong impulse and slightly longer stun
          player.vx = nx * 800;
          player.vy = ny * 800;
          player.stunTimer = 0.6;
        } else {
          player.vx += nx * 400;
          player.vy += ny * 400;
          player.stunTimer = 0.5; // Stun the player briefly on impact
        }
      }
    }
  }

  // 4. Power-Up Collision
  for (let i = state.powerups.length - 1; i >= 0; i--) {
    const pu = state.powerups[i];
    let collected = false;
    for (const player of state.players) {
      if (!player.alive) continue;

      const dx = player.x - pu.x;
      const dy = player.y - pu.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < player.radius + pu.radius) {
        // Apply effect
        if (pu.type === "speed") {
          player.speedBoostTimer = 6.0;
        } else if (pu.type === "shield") {
          player.shieldActive = true;
        } else if (pu.type === "growth") {
          player.mass = Math.min(PHYSICS.MAX_MASS, player.mass + 0.3);
          player.radius = Math.min(PHYSICS.MAX_RADIUS, player.radius + 6);
        } else if (pu.type === "hammer") {
          player.hammerCharge = true;
        } else if (pu.type === "ghost") {
          player.ghostTimer = 5.0;
        }

        state.powerups.splice(i, 1);
        collected = true;
        break;
      }
    }
  }

  // 5. Circle vs Circle collision detection & resolution
  for (let i = 0; i < state.players.length; i++) {
    for (let j = i + 1; j < state.players.length; j++) {
      const p1 = state.players[i];
      const p2 = state.players[j];

      if (!p1.alive || !p2.alive) continue;
      if (p1.ghostTimer > 0 || p2.ghostTimer > 0) continue; // No collision in ghost mode

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = p1.radius + p2.radius;

      if (dist < minDist) {
        // Normal collision resolution
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);

        // Separate slightly to prevent sinking
        const overlap = minDist - dist;
        p1.x -= nx * overlap * 0.5;
        p1.y -= ny * overlap * 0.5;
        p2.x += nx * overlap * 0.5;
        p2.y += ny * overlap * 0.5;

        // Relative velocity along normal
        const kx = p1.vx - p2.vx;
        const ky = p1.vy - p2.vy;
        const p = (kx * nx + ky * ny);

        if (p > 0) {
          // Check for shields
          let m1 = p1.mass;
          let m2 = p2.mass;

          if (p2.shieldActive) {
            p2.shieldActive = false; // absorb it!
            m2 *= 3; // acts heavier
          }
          if (p1.shieldActive) {
            p1.shieldActive = false; // absorb it!
            m1 *= 3; // acts heavier
          }

          // Hammer bonus
          let bonus = 1.0;
          if (p1.hammerCharge) { bonus += 1.5; p1.hammerCharge = false; }
          if (p2.hammerCharge) { bonus += 1.5; p2.hammerCharge = false; }

          // Standard 2D elastic collision formula
          const impulse = (2 * p) / (m1 + m2) * PHYSICS.COLLISION_RESTITUTION * PHYSICS.PUSH_FORCE_MULTIPLIER * bonus;

          p1.vx -= nx * impulse * m2;
          p1.vy -= ny * impulse * m2;
          p2.vx += nx * impulse * m1;
          p2.vy += ny * impulse * m1;

          // Track last hit for kill attribution
          p1.lastHitBy = p2.id;
          p2.lastHitBy = p1.id;
        }
      }
    }
  }
}

export function helloShared() {
  return "Hello from @sumo/shared!";
}
