/**
 * Builds WaveSystem.js, EnemySystem.js, RenderSystem.js from GameEngine.js.
 * Run from repo root: node scripts/extract-wave-enemy-render.mjs
 */
import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gp = `${root}/src/GameEngine.js`;
const L = fs.readFileSync(gp, "utf8").split("\n");

const i1 = (n) => n - 1;

function lines(a, b) {
  return L.slice(i1(a), i1(b + 1));
}

function unwrapClassMethod(lineStart, lineEnd) {
  const block = lines(lineStart, lineEnd);
  if (!block[0].trim().endsWith("{")) throw new Error(`Bad start ${lineStart}: ${block[0]}`);
  if (block[block.length - 1].trim() !== "}") throw new Error(`Bad end ${lineEnd}`);
  return block.slice(1, -1);
}

function thisToEngine(body) {
  return body.replace(/\bthis\./g, "engine.");
}

function indentBody(body, pad = "    ") {
  return body
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : pad + line))
    .join("\n");
}

// ── WaveSystem ───────────────────────────────────────────────────────────────
const pickInner = unwrapClassMethod(303, 311).join("\n");
const startInner = thisToEngine(unwrapClassMethod(314, 551).join("\n")).replace(
  /engine\._buildPath\(/g,
  "engine._buildPath(",
);
const spawnTickInner = thisToEngine(unwrapClassMethod(733, 742).join("\n")).replace(
  /engine\._spawnEnemy\(/g,
  "engine.enemySystem.spawnEnemy(",
);
let completeInner = thisToEngine(unwrapClassMethod(1383, 1490).join("\n"))
  .replace(/engine\._weightedRandomModifier\(\)/g, "engine.waveSystem.pickWeightedModifier()")
  .replace(/engine\._grantWaveEndXp\(/g, "engine.waveSystem.grantWaveEndXp(")
  .replace(/engine\._checkLastStand\(\)/g, "engine.enemySystem.checkLastStand()");
const grantInner = thisToEngine(unwrapClassMethod(1500, 1551).join("\n"));

const waveSrc = `/**
 * WaveSystem.js — wave start, spawn queue, wave clear, wave-end XP.
 */

import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  TOWER_TYPES,
  ENEMY_TYPES,
  WAVE_MODIFIERS,
  BOSS_MUTATIONS,
  ADMIN_CONFIG,
} from "../gameConstants.js";
import { SpawnCamp } from "../SpawnCamp.js";

const VCFG = ADMIN_CONFIG.visual;

export class WaveSystem {
  constructor(engine) {
    this.engine = engine;
  }

  pickWeightedModifier() {
${indentBody(pickInner)}
  }

  startWave() {
    const engine = this.engine;
${indentBody(startInner)}
  }

  tickSpawning() {
    const engine = this.engine;
${indentBody(spawnTickInner)}
  }

  checkWaveComplete() {
    const engine = this.engine;
${indentBody(completeInner)}
  }

  grantWaveEndXp(budget) {
    const engine = this.engine;
${indentBody(grantInner)}
  }
}
`;

fs.writeFileSync(`${root}/src/systems/WaveSystem.js`, waveSrc);

// ── EnemySystem ──────────────────────────────────────────────────────────────
let spawnInner = thisToEngine(unwrapClassMethod(554, 731).join("\n"));
let updateInner = thisToEngine(unwrapClassMethod(746, 1341).join("\n"))
  .replace(/\bengine\._killEnemy\(/g, "engine.combatSystem.killEnemy(")
  .replace(/\bengine\._damageEnemy\(/g, "engine.combatSystem.damageEnemy(")
  .replace(/\bengine\._checkTowerProgression\(/g, "engine.towerSystem.checkProgression(")
  .replace(/\bengine\._spawnChildAt\(/g, "engine.enemySystem.spawnChildAt(")
  .replace(/\bengine\._addParticles\(/g, "engine.vfx.addParticles(")
  .replace(/\bengine\._addFloatingText\(/g, "engine.vfx.addFloatingText(")
  .replace(/\bengine\._addBolt\(/g, "engine.vfx.addBolt(")
  .replace(/\bengine\._triggerShake\(/g, "engine.vfx.triggerShake(")
  .replace(/\bengine\._checkLastStand\(/g, "engine.enemySystem.checkLastStand(");

const enemySrc = `/**
 * EnemySystem.js — spawn definitions and per-tick enemy simulation.
 */

import { ENEMY_TYPES, ADMIN_CONFIG, TOWER_TYPES } from "../gameConstants.js";

const CFG = ADMIN_CONFIG.ai;

export class EnemySystem {
  constructor(engine) {
    this.engine = engine;
  }

  checkLastStand() {
    const engine = this.engine;
    const wasActive = engine.lastStandActive;
    engine.lastStandActive = engine.lives <= 3 && engine.lives > 0;
    if (engine.lastStandActive && !wasActive) {
      engine.audio?.onLastStand();
      engine.vfx.addFloatingText(
        engine.canvas.width / 2,
        engine.canvas.height / 2 - 20,
        "🔥 LAST STAND! All towers +50% DMG",
        "#ef4444",
      );
    }
  }

  spawnChildAt(parent, type) {
    const engine = this.engine;
    const def = ENEMY_TYPES[type];
    if (!def) return;

    const waveHpMult =
      1 +
      engine.wave *
        (engine.isEndless ? CFG.endlessHpPerWave : CFG.enemyHpPerWave);
    const waveSpeedMult =
      1 +
      engine.wave *
        (engine.isEndless ? CFG.endlessSpeedPerWave : CFG.enemySpeedPerWave);

    const lateGameFactor =
      engine.wave > 20
        ? Math.pow(CFG.lateGameExpScale || 1.18, (engine.wave - 20) / 10)
        : 1;

    const scaledHp = def.hp * waveHpMult * lateGameFactor * 0.8;
    const scaledSpeed = def.speed * waveSpeedMult;

    engine.enemies.push({
      id: Date.now() + Math.random(),
      type,
      x: parent.x + (Math.random() - 0.5) * 18,
      y: parent.y + (Math.random() - 0.5) * 18,
      pathIndex: Math.max(0, parent.pathIndex - 1),
      hp: scaledHp,
      maxHp: scaledHp,
      speed: scaledSpeed * 1.1,
      baseSpeed: scaledSpeed * 1.1,
      reward: def.reward,
      color: def.color,
      size: def.size,
      armor: def.armor || 0,
      baseArmor: def.armor || 0,
      stealth: false,
      slowTimer: 0,
      stunTimer: 0,
      burnTimer: 0,
      burnDmg: 0,
      stunCooldown: 0,
      spawnsOnDeath: null,
      spawnCount: 0,
      distanceTraveled: parent.distanceTraveled,
      name: def.name,
      icon: def.icon || "🐝",
      isBoss: false,
      phaseTriggered: false,
      phaseDef: null,
      spawnOnDmg: null,
      immunities: [],
      weakness: null,
      bossAbility: null,
      lootDrop: null,
      requiresCounter: null,
      counterNote: "",
      burnStacks: 0,
      assistTowers: new Set(),
      stunImmunity: 0,
      rageTimer: 0,
    });
  }

  spawnEnemy(data) {
    const engine = this.engine;
${indentBody(spawnInner)}
  }

  update() {
    const engine = this.engine;
${indentBody(updateInner)}
  }
}
`;

fs.writeFileSync(`${root}/src/systems/EnemySystem.js`, enemySrc);

// ── RenderSystem ─────────────────────────────────────────────────────────────
let drawInner = thisToEngine(unwrapClassMethod(1560, 2600).join("\n"));
drawInner = drawInner
  .replace(/\b_roundRect\(/g, "roundRectR(")
  .replace(/\b_blendColor\(/g, "blendColorR(")
  .replace(/\b_shadeColor\(/g, "shadeColorR(")
  .replace(/\b_drawPathCell\(/g, "drawPathCellR(")
  .replace(/\b_drawGroundCell\(/g, "drawGroundCellR(")
  .replace(/\b_drawTowerShape\(/g, "drawTowerShapeR(")
  .replace(/\b_drawEnemyShape\(/g, "drawEnemyShapeR(")
  .replace(/\b_drawProjectile\(/g, "drawProjectileR(");

let helpers = L.slice(i1(2857), i1(3445) + 1).join("\n");
helpers = helpers
  .replace(/function _roundRect/g, "function roundRectR")
  .replace(/function _blendColor/g, "function blendColorR")
  .replace(/function _shadeColor/g, "function shadeColorR")
  .replace(/function _drawPathCell/g, "function drawPathCellR")
  .replace(/function _drawGroundCell/g, "function drawGroundCellR")
  .replace(/function _drawTowerShape/g, "function drawTowerShapeR")
  .replace(/function _drawEnemyShape/g, "function drawEnemyShapeR")
  .replace(/function _drawProjectile/g, "function drawProjectileR");

const renderSrc = `/**
 * RenderSystem.js — full canvas frame (grid, entities, HUD overlays).
 */

import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  TOWER_TYPES,
  ENEMY_TYPES,
  ABILITIES,
  ACHIEVEMENTS,
} from "../gameConstants.js";

export class RenderSystem {
  constructor(engine) {
    this.engine = engine;
  }

  draw() {
    const engine = this.engine;
${indentBody(drawInner)}
  }
}

${helpers}
`;

fs.writeFileSync(`${root}/src/systems/RenderSystem.js`, renderSrc);

console.log("OK: WaveSystem.js, EnemySystem.js, RenderSystem.js");
