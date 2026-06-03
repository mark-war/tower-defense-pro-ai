import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  TOWER_TYPES,
  ENEMY_TYPES,
  MAPS,
  LEVELS,
  ENDLESS_CONFIG,
  ABILITIES,
  SYNERGIES,
  ADMIN_CONFIG,
  STEALTH_COUNTERS,
  ACHIEVEMENTS,
  SKINS,
} from "./gameConstants.js";
import { WaveAI } from "./WaveAI.js";
import { Kingdom } from "./Kingdom.js";
import { SpawnCamp } from "./SpawnCamp.js";
import { AudioEngine } from "./AudioEngine.js";
import { VisualEffectsSystem } from "./systems/VisualEffectsSystem.js";
import { SynergySystem } from "./systems/SynergySystem.js";
import { AchievementSystem } from "./systems/AchievementSystem.js";
import { AbilitySystem } from "./systems/AbilitySystem.js";
import { SaveSystem } from "./systems/SaveSystem.js";
import { CombatSystem } from "./systems/CombatSystem.js";
import { EnemySystem } from "./systems/EnemySystem.js";
import { TowerSystem } from "./systems/TowerSystem.js";
import { ProjectileSystem } from "./systems/ProjectileSystem.js";
import { WaveSystem } from "./systems/WaveSystem.js";
import { RenderSystem } from "./systems/RenderSystem.js";

const VCFG = ADMIN_CONFIG.visual;
const ECFG = ADMIN_CONFIG.economy;

export class GameEngine {
  constructor(canvas, onStateChange, levelId = 99) {
    this._isMobile = window.innerWidth < 1024 || navigator.maxTouchPoints > 0;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onStateChange = onStateChange;
    this.levelId = levelId;

    this._applyLevel(levelId);
    this._initSystems();

    this._setupCanvas();
    this._loop();
  }

  _applyLevel(levelId, savedMapKey = null) {
    const isEndless = levelId === 99;
    const lvl = isEndless
      ? ENDLESS_CONFIG
      : LEVELS.find((l) => l.id === levelId) || LEVELS[0];

    this.levelConfig = lvl;
    this.isEndless = isEndless;
    this.xpMult = lvl.xpMult ?? 1.0;

    this.autoRepair = false;
    this.autoRepairCostPerWave = 0;

    this.forceTargetId = null;
    this.forceTargetTimer = 0;

    this._aiTauntQueue = [];
    this._aiTauntTimer = 0;
    this._currentAiTaunt = null;

    this.speedMultiplier = 1;

    // ── MAP HANDLING ─────────────────────────────────────
    let mapKeyToUse = savedMapKey || "valley";

    if (!mapKeyToUse || !MAPS[mapKeyToUse]) {
      mapKeyToUse = lvl.map; // fallback to level default
    }

    this.mapDef = MAPS[mapKeyToUse];
    this._currentMapKey = mapKeyToUse;

    // Safety check
    if (!this.mapDef) {
      console.warn(`Map "${mapKeyToUse}" not found. Falling back to spiral.`);
      this.mapDef = MAPS.spiral;
      this._currentMapKey = "spiral";
    }

    this.fortifyLevel = 0;
    this.fortifyCost = ECFG.fortifyCostBase;

    this.grid = Array.from({ length: GRID_ROWS }, () =>
      Array(GRID_COLS).fill(null),
    );
    if (!this.towers) this.towers = [];
    else this.towers.length = 0;
    if (!this.enemies) this.enemies = [];
    else this.enemies.length = 0;
    if (!this.projectiles) this.projectiles = [];
    else this.projectiles.length = 0;
    if (!this.particles) this.particles = [];
    else this.particles.length = 0;
    if (!this.floatingTexts) this.floatingTexts = [];
    else this.floatingTexts.length = 0;
    if (!this.activeLoot) this.activeLoot = [];
    else this.activeLoot.length = 0;
    if (!this.boltEffects) this.boltEffects = [];
    else this.boltEffects.length = 0;

    this.gold = lvl.startGold;
    this.lives = lvl.startLives;
    this.wave = 0;
    this.score = 0;
    this.state = "idle";
    this.selectedTowerType = lvl.unlockedTowers[0] || "basic";
    this.hoveredCell = null;
    this.selectedTowerCell = null; // for upgrade panel click
    this.inspectedEnemy = null; // for enemy click-to-inspect

    this.towerCatCounts = { attack: 0, support: 0, tech: 0 };

    // Abilities state
    this.abilities = Object.fromEntries(
      Object.entries(ABILITIES).map(([k, v]) => [
        k,
        { ...v, cooldownLeft: 0, active: false },
      ]),
    );

    // Last-stand rage flag
    this.lastStandActive = false;

    this.waveAI = new WaveAI(lvl);
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.waveKills = 0;
    this.waveLeaks = 0;
    this.waveDamageByTower = {};
    this.waveGoldSpent = 0;

    this._waveStartTick = 0;
    this.lastWaveClearTime = 0;
    this.fastestWaveClear = Infinity;

    this.nextWaveMessage = "Deploy towers, then start wave.";
    this.bossWarningTimer = 0;
    this.bossWarningType = null;
    this.lastEnemyTypes = [];
    this.minRequiredTowers = {};
    this.activeSynergies = [];

    // Global buffs (from abilities / boss loot)
    this.globalBuff = { fireRateMult: 1, damageMult: 1, timer: 0, label: "" };

    this.tick = 0;
    this.shake = { x: 0, y: 0, frames: 0, intensity: 0 };
    this.animFrame = null;
    this.path = this._buildPath(this.mapDef.waypoints);
    this.pathCells = this._buildPathCells(this.mapDef.waypoints);

    // Kingdom at path exit
    const lastPt = this.path[this.path.length - 1];
    this.kingdom = new Kingdom(lastPt.x, lastPt.y);

    // Spawn camp at path entry
    this.spawnCamps = [new SpawnCamp(this.path[0].x, this.path[0].y, 0)];
    console.log(this.path[0].x, this.path[0].y);
    console.log(lastPt.x, lastPt.y);

    this.milestoneBonus = null; // ← persists across startWave() resets
    this.secondSpawnCamp = null; // ← dual-front camp reference
    this._secondPath = null; // ← short path for second entry

    this._secondPathCells = new Set();

    this._streakCount = 0;
    this._streakTimer = 0;
    this._streakWindow = 0;

    this.paused = false;

    this.activeMapBonus = this.mapDef?.mapBonus || null;
    this._towerShotCounters = {}; // for nuke/nuclear tracking

    this.evolutionAlertTimer = 0;
    this.evolutionAlertDef = null;

    this._incomingModifier = null;
    this._eliteSpawnedCount = 0;
    this._pendingBossMutation = null;
    this.bossWarningMutation = null;
    this.lastWaveClearTime = 0;
    this.fastestWaveClear = Infinity;

    this.activeModifier = null;
    this.silencedTowerType = null;
    this.runStats = {
      totalKills: 0,
      totalLeaks: 0,
      goldEarned: this.gold,
      bossKills: 0,
      mutatedBossKills: 0,
      modifiersFaced: [],
      maxGoldAtOnce: 0,
      wavesNoLeak: 0,
    };
    this._runAchievements = []; // unlocked this run
    this._newAchievementId = null; // triggers toast

    this.darkStarEnemyIds = new Set();

    if (!this.burnZones) this.burnZones = [];
    else this.burnZones.length = 0;
    if (!this.blackHoles) this.blackHoles = [];
    else this.blackHoles.length = 0;
    if (!this.ballLightnings) this.ballLightnings = [];
    else this.ballLightnings.length = 0;

    this.milestoneBonus = null;
    this.secondSpawnCamp = null;
    this._secondPath = null;

    this.activeSkin = SKINS.default;
    this.audio = new AudioEngine();

    this._aiTaunt = null; // current taunt text to display
    this._aiTauntTimer = 0; // frames left to display taunt
    this._aiTauntQueue = []; // queue of taunts to display
  }

  _initSystems() {
    this.vfx = new VisualEffectsSystem(this);
    this.synergySystem = new SynergySystem(this);
    this.achievementSystem = new AchievementSystem(this);
    this.abilitySystem = new AbilitySystem(this);
    this.saveSystem = new SaveSystem(this);
    this.combatSystem = new CombatSystem(this);
    this.enemySystem = new EnemySystem(this);
    this.towerSystem = new TowerSystem(this);
    this.projectileSystem = new ProjectileSystem(this);
    this.waveSystem = new WaveSystem(this);
    this.renderSystem = new RenderSystem(this);
  }

  toggleFastForward() {
    // Cycles: 1× → 2× → 4× → back to 1×
    if (this.speedMultiplier === 1) this.speedMultiplier = 2;
    else if (this.speedMultiplier === 2) this.speedMultiplier = 4;
    else this.speedMultiplier = 1;
    this._emitState();
    return this.speedMultiplier;
  }

  setSkin(skinId) {
    this.activeSkin = SKINS[skinId] || SKINS.default;
    this._emitState();
  }

  toggleAutoRepair() {
    this.autoRepair = !this.autoRepair;
    this._emitState();
    return this.autoRepair;
  }

  _setupCanvas() {
    this.canvas.width = GRID_COLS * CELL_SIZE;
    this.canvas.height = GRID_ROWS * CELL_SIZE;
  }

  _buildPath(waypoints) {
    const pts = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i],
        b = waypoints[i + 1];
      const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
      for (let s = 0; s <= steps; s++)
        pts.push({
          x:
            (a.col + ((b.col - a.col) * s) / steps) * CELL_SIZE + CELL_SIZE / 2,
          y:
            (a.row + ((b.row - a.row) * s) / steps) * CELL_SIZE + CELL_SIZE / 2,
        });
    }
    return pts;
  }

  _buildPathCells(waypoints) {
    const cells = new Set();
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i],
        b = waypoints[i + 1];
      const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
      for (let s = 0; s <= steps; s++)
        cells.add(
          `${Math.round(a.col + ((b.col - a.col) * s) / steps)},${Math.round(a.row + ((b.row - a.row) * s) / steps)}`,
        );
    }
    return cells;
  }

  _isPathCell(col, row) {
    return this.pathCells.has(`${col},${row}`);
  }

  // ── Tower operations → TowerSystem ───────────────────────────────────────
  canPlaceTower(col, row, towerType) {
    return this.towerSystem.canPlace(col, row, towerType);
  }

  placeTower(col, row) {
    return this.towerSystem.place(col, row);
  }

  sellTower(col, row) {
    this.towerSystem.sell(col, row);
  }

  upgradeTower(col, row, skillType, path) {
    return this.towerSystem.upgrade(col, row, skillType, path);
  }

  // ── SYNERGY CHECK ────────────────────────────────────────────────────────────
  _checkSynergies() {
    this.synergySystem.check();
  }

  // ── ABILITIES ────────────────────────────────────────────────────────────────
  triggerAbility(abilityKey) {
    return this.abilitySystem.trigger(abilityKey);
  }

  startWave() {
    return this.waveSystem.startWave();
  }

  _checkLastStand() {
    this.enemySystem.checkLastStand();
  }

  _spawnChildAt(parent, type) {
    this.enemySystem.spawnChildAt(parent, type);
  }

  _addBolt(x1, y1, x2, y2, color) {
    this.vfx.addBolt(x1, y1, x2, y2, color);
  }

  _damageEnemy(enemy, rawDmg, proj) {
    return this.combatSystem.damageEnemy(enemy, rawDmg, proj);
  }

  _checkTowerProgression(tower, currentWave) {
    return this.towerSystem.checkProgression(tower, currentWave);
  }

  _killEnemy(enemy, towerType, towerId) {
    return this.combatSystem.killEnemy(enemy, towerType, towerId);
  }

  _addParticles(x, y, color, count) {
    this.vfx.addParticles(x, y, color, count);
  }

  _addFloatingText(x, y, text, color) {
    this.vfx.addFloatingText(x, y, text, color);
  }

  _updateParticles() {
    this.vfx.update();
  }

  _unlockAchievement(id) {
    this.achievementSystem.unlock(id);
  }

  _checkAchievements() {
    this.achievementSystem.checkWaveAchievements();
  }

  fortify() {
    return this.towerSystem.fortify();
  }

  _triggerShake(intensity = 5, frames = 6) {
    this.vfx.triggerShake(intensity, frames);
  }

  repairTower(col, row) {
    return this.towerSystem.repair(col, row);
  }

  repairAllTowers() {
    return this.towerSystem.repairAll();
  }

  togglePause() {
    if (this.state !== "wave") return false;
    this.paused = !this.paused;
    this._emitState();
    return this.paused;
  }

  getSaveState() {
    return this.saveSystem.getSaveState();
  }

  loadSaveState(save) {
    if (!save) return false;
    console.log("🔄 Loading save with map:", save.savedMapKey);
    return this.saveSystem.loadSaveState(save);
  }

  _loop() {
    this.tick++;
    if (this.state === "wave" && !this.paused) {
      const steps = this.speedMultiplier || 1;
      for (let _s = 0; _s < steps; _s++) {
        this.waveSystem.tickSpawning();
        this.enemySystem.update();
        this.towerSystem.update();
        this.projectileSystem.update();
        this.waveSystem.checkWaveComplete();
        if (this.state !== "wave") break;
      }
    }
    if (!this.paused) {
      this._updateParticles();
    }
    this.renderSystem.draw();
    if (this.tick % 30 === 0) this._emitState();
    this.animFrame = requestAnimationFrame(() => this._loop());
  }

  _emitState() {
    const lvl = this.levelConfig;
    this.onStateChange({
      gold: Math.floor(this.gold),
      lives: this.lives,
      wave: this.wave,
      totalWaves: this.isEndless ? "∞" : lvl.waves,
      score: this.score,
      state: this.state,
      paused: this.paused,
      activeMapBonus: this.activeMapBonus || null,
      repairAllCost: this.towers.reduce(
        (s, t) => s + (t.hp < t.maxHp ? t.repairCost || 0 : 0),
        0,
      ),
      damagedTowerCount: this.towers.filter((t) => t.hp < t.maxHp).length,
      activeModifier: this.activeModifier,

      incomingModifier: this._incomingModifier || null,
      lastWaveClearTime: this.lastWaveClearTime || 0,
      fastestWaveClear:
        this.fastestWaveClear === Infinity ? 0 : this.fastestWaveClear || 0,

      silencedTowerType: this.silencedTowerType,
      runStats: { ...this.runStats },
      runAchievements: [...(this._runAchievements || [])],
      newAchievementId: this._newAchievementId || null,
      levelId: this.levelId,
      levelName: lvl.name,
      mapName: this.mapDef.name,
      isEndless: this.isEndless,
      enemyCount: this.enemies.length,
      spawnRemaining: this.spawnQueue.length,
      aiSummary: this.waveAI.getAdaptationSummary({
        gold: Math.floor(this.gold),
        towerCounts: Object.fromEntries(
          Object.entries(
            this.towers.reduce((acc, tower) => {
              acc[tower.type] = (acc[tower.type] || 0) + 1;
              return acc;
            }, {}),
          ),
        ),
        unlockedTowers: [...lvl.unlockedTowers],
        towerCaps: { ...lvl.towerCaps },
        towerCatCounts: { ...this.towerCatCounts },
        fortifyLevel: this.fortifyLevel,
        fortifyCost: this.fortifyCost,
        maxFortifyLevel: ECFG.maxFortifyLevel,
      }),
      nextWaveMessage: this.nextWaveMessage,
      lastEnemyTypes: this.lastEnemyTypes,
      minRequiredTowers: this.minRequiredTowers,
      bossWaves: lvl.bossWaves || {},
      unlockedTowers: lvl.unlockedTowers,
      towerCaps: lvl.towerCaps,
      towerCatCounts: { ...this.towerCatCounts },
      activeSynergies: this.activeSynergies,
      inspectedEnemy: this.inspectedEnemy ? { ...this.inspectedEnemy } : null,
      selectedTowerCell: this.selectedTowerCell,
      abilities: Object.fromEntries(
        Object.entries(this.abilities).map(([k, v]) => [k, { ...v }]),
      ),
      globalBuff: { ...this.globalBuff },
      lastStandActive: this.lastStandActive,
      evolutionAlertDef: this.evolutionAlertDef,
      activeEvolutions: { ...this.waveAI.activeEvolutions },
      towers: this.towers.map((t) => ({
        id: t.id,
        type: t.type,
        col: t.col,
        row: t.row,
        kills: t.kills,
        damage: Math.floor(t.totalDamage),
        category: t.category,

        // new phased upgrade fields
        passiveTier: t.passiveTier,
        skill5chosen: t.skill5chosen,
        skill10chosen: t.skill10chosen,
        legendaryUnlocked: t.legendaryUnlocked,
        legendary100Unlocked: t.legendary100Unlocked,
        upgradeReady: t.upgradeReady,
        upgradeReadyType: t.upgradeReadyType,
        xp: Math.floor(t.xp),
        specials: t.specials,

        tier: t.tier,
        xpToTier1: t.xpToTier1,
        xpToTier2: t.xpToTier2,
        chosenPath: t.chosenPath,
        tier2Path: t.tier2Path,

        legendary50Path: t.legendary50Path || null,
        legendary100Path: t.legendary100Path || null,

        hp: Math.ceil(t.hp),
        maxHp: t.maxHp,
        disabled: t.disabled,
        repairCost: t.repairCost || 0,
        damageType: TOWER_TYPES[t.type]?.damageType || "physical",

        // ── ADDITIONAL STATS ──────────────────────────────────────
        currentDamage: Math.round(t.damage), // live damage (not totalDamage)
        fireRate: t.fireRate,
        range: Math.round(t.range),
        splash: t.splash || 0,
        slowFactor: t.slowFactor || 0,
        burnDamage: t.burnDamage || 0,
        chainTargets: t.chainTargets || 0,
        armorPiercing: t.armorPiercing || false,
        homing: t.homing || false,
      })),
      autoRepair: this.autoRepair,
      autoRepairCostPerSec:
        this.towers.filter((t) => t.hp < t.maxHp).length *
        Math.ceil(50 * 0.008), // rough estimate shown in UI
      speedMultiplier: this.speedMultiplier,
      continueGoldCost: this.continueGoldCost || 0,
      continueCount: this.continueCount || 0,
      livesOnContinue: ADMIN_CONFIG.continueSystem.livesOnContinue,
      lastWaveHeroTower: this.lastWaveHeroTower || null,
    });
  }

  setHoveredCell(col, row) {
    this.hoveredCell =
      col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS
        ? null
        : { col, row };
  }

  setSelectedTowerType(type) {
    this.selectedTowerType = type;
    this.selectedTowerCell = null;
  }

  selectTowerCell(col, row) {
    const tower = this.grid[row]?.[col];
    this.selectedTowerCell = tower ? { col, row } : null;
    this._emitState();
  }

  reset(levelId) {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.levelId = levelId || this.levelId;
    this._applyLevel(this.levelId);
    this._setupCanvas();
    this._emitState();
    this._loop();
  }

  startEndlessWithMap(mapKey, mapDef) {
    this._currentMapKey = mapKey;

    this.mapDef = mapDef;
    this.activeMapBonus = mapDef.mapBonus || null;
    this.path = this._buildPath(mapDef.waypoints);
    this.pathCells = this._buildPathCells(mapDef.waypoints);

    const lastPt = this.path[this.path.length - 1];
    this.kingdom = new Kingdom(lastPt.x, lastPt.y);
    this.spawnCamps = [new SpawnCamp(this.path[0].x, this.path[0].y, 0)];

    this._emitState();
  }

  destroy() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }

  setForceTarget = (enemyId) => {
    this.forceTargetId = enemyId;
    this.forceTargetTimer = 240; // 4 seconds
    this._addFloatingText(
      this.canvas.width / 2,
      60,
      "🎯 FOCUS TARGET LOCKED",
      "#ef4444",
    );
  };

  // Returns a plain-object snapshot of the enemy at canvas pixel (px, py)
  getEnemyAtPixel(px, py) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = e.x - px,
        dy = e.y - py;
      if (Math.sqrt(dx * dx + dy * dy) <= e.size + 8) {
        return {
          type: e.type,
          name: e.name,
          icon: e.icon,
          hp: Math.ceil(e.hp),
          maxHp: Math.ceil(e.maxHp),
          armor: e.armor,
          speed: e.speed.toFixed(2),
          stealth: e.stealth,
          isBoss: e.isBoss,
          immunities: e.immunities,
          weakness: e.weakness,
          slowTimer: e.slowTimer,
          stunTimer: e.stunTimer,
          burnTimer: e.burnTimer,
          burnStacks: e.burnStacks || 0,
          phaseTriggered: e.phaseTriggered,
          distanceTraveled: Math.floor(e.distanceTraveled),
        };
      }
    }
    return null;
  }

  useContinue() {
    const cfg = ADMIN_CONFIG.continueSystem;
    if (this.state !== "continue_prompt") return false;
    if (this.gold < this.continueGoldCost) return false;
    this.gold -= this.continueGoldCost;
    this.lives = cfg.livesOnContinue;
    this.continueCount++;
    this.state = "wave"; // resume
    this._checkLastStand();
    this._unlockAchievement("used_continue");
    if (this.continueCount >= cfg.maxContinues) {
      this._unlockAchievement("max_continues");
    }
    this._emitState();
    return true;
  }

  forceGameOver() {
    this.state = "gameover";
    this._emitState();
  }
}
