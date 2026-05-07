"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameState = exports.PowerUp = exports.Hazard = exports.Player = exports.PHYSICS = void 0;
exports.stepPhysics = stepPhysics;
exports.helloShared = helloShared;
if (typeof Symbol.metadata === "undefined") {
    Symbol.metadata = Symbol.for("Symbol.metadata");
}
const schema_1 = require("@colyseus/schema");
exports.PHYSICS = {
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
class Player extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = "";
        this.name = "";
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.radius = exports.PHYSICS.PLAYER_RADIUS_DEFAULT;
        this.mass = exports.PHYSICS.PLAYER_MASS_DEFAULT;
        this.color = "#3498db";
        this.alive = true;
        this.dashCooldown = 0;
        this.stunTimer = 0;
        this.shieldActive = false;
        this.speedBoostTimer = 0;
        this.kills = 0;
        this.score = 0;
        this.lastHitBy = "";
        this.ghostTimer = 0;
        this.hammerCharge = false;
    }
}
exports.Player = Player;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Player.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Player.prototype, "name", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Player.prototype, "x", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Player.prototype, "y", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Player.prototype, "vx", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Player.prototype, "vy", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Player.prototype, "radius", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Player.prototype, "mass", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Player.prototype, "color", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], Player.prototype, "alive", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Player.prototype, "dashCooldown", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Player.prototype, "stunTimer", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], Player.prototype, "shieldActive", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Player.prototype, "speedBoostTimer", void 0);
__decorate([
    (0, schema_1.type)("uint16"),
    __metadata("design:type", Number)
], Player.prototype, "kills", void 0);
__decorate([
    (0, schema_1.type)("uint32"),
    __metadata("design:type", Number)
], Player.prototype, "score", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Player.prototype, "lastHitBy", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Player.prototype, "ghostTimer", void 0);
__decorate([
    (0, schema_1.type)("boolean"),
    __metadata("design:type", Boolean)
], Player.prototype, "hammerCharge", void 0);
class Hazard extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = "";
        this.type = "lava";
        this.x = 0;
        this.y = 0;
        this.radius = 80;
        this.vx = 0;
        this.vy = 0;
    }
}
exports.Hazard = Hazard;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Hazard.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], Hazard.prototype, "type", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Hazard.prototype, "x", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Hazard.prototype, "y", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Hazard.prototype, "radius", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Hazard.prototype, "vx", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], Hazard.prototype, "vy", void 0);
class PowerUp extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.id = "";
        this.type = "speed";
        this.x = 0;
        this.y = 0;
        this.radius = 18;
    }
}
exports.PowerUp = PowerUp;
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], PowerUp.prototype, "id", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], PowerUp.prototype, "type", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], PowerUp.prototype, "x", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], PowerUp.prototype, "y", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], PowerUp.prototype, "radius", void 0);
class GameState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.players = new schema_1.ArraySchema();
        this.hazards = new schema_1.ArraySchema();
        this.powerups = new schema_1.ArraySchema();
        this.arenaRadius = exports.PHYSICS.ARENA_RADIUS_DEFAULT;
        this.matchPhase = "waiting";
        this.matchTimer = 90;
        this.mapId = "classic";
    }
}
exports.GameState = GameState;
__decorate([
    (0, schema_1.type)([Player]),
    __metadata("design:type", Object)
], GameState.prototype, "players", void 0);
__decorate([
    (0, schema_1.type)([Hazard]),
    __metadata("design:type", Object)
], GameState.prototype, "hazards", void 0);
__decorate([
    (0, schema_1.type)([PowerUp]),
    __metadata("design:type", Object)
], GameState.prototype, "powerups", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], GameState.prototype, "arenaRadius", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameState.prototype, "matchPhase", void 0);
__decorate([
    (0, schema_1.type)("float32"),
    __metadata("design:type", Number)
], GameState.prototype, "matchTimer", void 0);
__decorate([
    (0, schema_1.type)("string"),
    __metadata("design:type", String)
], GameState.prototype, "mapId", void 0);
/**
 * Deterministic physics step function for shared use by server and client.
 */
function stepPhysics(state, inputs, dt, updateGlobalState = true) {
    // 1. Process arena shrinking
    if (updateGlobalState && state.matchPhase === "playing") {
        state.matchTimer = Math.max(0, state.matchTimer - dt);
        const elapsed = 90 - state.matchTimer;
        if (elapsed > exports.PHYSICS.ARENA_SHRINK_GRACE) {
            state.arenaRadius = Math.max(0, state.arenaRadius - exports.PHYSICS.ARENA_SHRINK_RATE * dt);
        }
    }
    // 2. Process inputs and update movement
    for (const player of state.players) {
        if (!player.alive)
            continue;
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
            if (input.up)
                ay -= 1;
            if (input.down)
                ay += 1;
            if (input.left)
                ax -= 1;
            if (input.right)
                ax += 1;
            // Normalize diagonal movement accel
            const dist = Math.sqrt(ax * ax + ay * ay);
            if (dist > 0) {
                let accel = exports.PHYSICS.PLAYER_ACCEL;
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
                    player.vx += (ax / dist) * exports.PHYSICS.DASH_IMPULSE;
                    player.vy += (ay / dist) * exports.PHYSICS.DASH_IMPULSE;
                }
                else {
                    // Dash in the direction the player was facing or just default to forward
                    player.vy -= exports.PHYSICS.DASH_IMPULSE;
                }
                player.dashCooldown = exports.PHYSICS.DASH_COOLDOWN;
            }
        }
        // Apply friction
        player.vx *= Math.exp(-exports.PHYSICS.FRICTION * dt);
        player.vy *= Math.exp(-exports.PHYSICS.FRICTION * dt);
        // Limit max speed
        const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
        let maxSpeed = exports.PHYSICS.PLAYER_MAX_SPEED;
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
            }
            else if (hazard.type === "blackhole") {
                const time = state.matchTimer * 0.7;
                hazard.x = Math.sin(time) * 180;
                hazard.y = Math.cos(time) * 180;
            }
        }
        for (const player of state.players) {
            if (!player.alive)
                continue;
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
                }
                else {
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
            if (!player.alive)
                continue;
            const dx = player.x - pu.x;
            const dy = player.y - pu.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < player.radius + pu.radius) {
                // Apply effect
                if (pu.type === "speed") {
                    player.speedBoostTimer = 6.0;
                }
                else if (pu.type === "shield") {
                    player.shieldActive = true;
                }
                else if (pu.type === "growth") {
                    player.mass = Math.min(exports.PHYSICS.MAX_MASS, player.mass + 0.3);
                    player.radius = Math.min(exports.PHYSICS.MAX_RADIUS, player.radius + 6);
                }
                else if (pu.type === "hammer") {
                    player.hammerCharge = true;
                }
                else if (pu.type === "ghost") {
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
            if (!p1.alive || !p2.alive)
                continue;
            if (p1.ghostTimer > 0 || p2.ghostTimer > 0)
                continue; // No collision in ghost mode
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
                    if (p1.hammerCharge) {
                        bonus += 1.5;
                        p1.hammerCharge = false;
                    }
                    if (p2.hammerCharge) {
                        bonus += 1.5;
                        p2.hammerCharge = false;
                    }
                    // Standard 2D elastic collision formula
                    const impulse = (2 * p) / (m1 + m2) * exports.PHYSICS.COLLISION_RESTITUTION * exports.PHYSICS.PUSH_FORCE_MULTIPLIER * bonus;
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
function helloShared() {
    return "Hello from @sumo/shared!";
}
