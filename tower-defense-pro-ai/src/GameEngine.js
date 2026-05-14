import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  TOWER_TYPES,
  TOWER_UPGRADES,
  ENEMY_TYPES,
  MAPS,
  LEVELS,
  ENDLESS_CONFIG,
  ABILITIES,
  SYNERGIES,
  ADMIN_CONFIG,
  STEALTH_COUNTERS,
  WAVE_MODIFIERS,
  BOSS_MUTATIONS,
  ACHIEVEMENTS,
  SKINS,
} from "./gameConstants.js";
import { WaveAI } from "./WaveAI.js";
import { Kingdom } from "./Kingdom.js";
import { SpawnCamp } from "./SpawnCamp.js";

const VCFG = ADMIN_CONFIG.visual;
const ECFG = ADMIN_CONFIG.economy;

export class GameEngine {
  constructor(canvas, onStateChange, levelId = 99) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onStateChange = onStateChange;
    this.levelId = levelId;
    this._applyLevel(levelId);
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
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.floatingTexts = [];
    this.activeLoot = []; // boss loot buffs in flight
    this.boltEffects = []; // tesla arc bolt visuals [{x1,y1,x2,y2,life,color}]

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

    this.burnZones = []; // burnOnSplash ground fire
    this.darkStarEnemyIds = new Set();
    this.blackHoles = []; // Singularity black holes
    this.ballLightnings = []; // Ball Lightning orbs

    this.milestoneBonus = null;
    this.secondSpawnCamp = null;
    this._secondPath = null;

    this.activeSkin = SKINS.default;
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

  // ── Tower placement ─────────────────────────────────────────────────────────
  canPlaceTower(col, row, towerType) {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS)
      return { ok: false, reason: "Out of bounds" };
    if (this.grid[row][col]) return { ok: false, reason: "Cell occupied" };
    if (this._isPathCell(col, row)) return { ok: false, reason: "On path" };
    const tDef = TOWER_TYPES[towerType];
    if (!tDef) return { ok: false, reason: "Unknown tower" };
    if (this.gold < tDef.cost)
      return { ok: false, reason: `Need ${tDef.cost}g` };
    if (!this.levelConfig.unlockedTowers.includes(towerType))
      return { ok: false, reason: "Locked" };
    const cat = tDef.category,
      caps = this.levelConfig.towerCaps,
      used = this.towerCatCounts[cat] || 0,
      limit = caps[cat] ?? 99;
    if (used >= limit) return { ok: false, reason: `${cat} cap (${limit})` };
    return { ok: true };
  }

  placeTower(col, row) {
    const check = this.canPlaceTower(col, row, this.selectedTowerType);
    if (!check.ok) {
      if (!["On path", "Cell occupied"].includes(check.reason))
        this._addFloatingText(
          col * CELL_SIZE + CELL_SIZE / 2,
          row * CELL_SIZE,
          check.reason,
          "#ef4444",
        );
      return false;
    }
    const tDef = TOWER_TYPES[this.selectedTowerType];

    const tower = {
      id: Date.now() + Math.random(),
      type: this.selectedTowerType,
      col,
      row,
      x: col * CELL_SIZE + CELL_SIZE / 2,
      y: row * CELL_SIZE + CELL_SIZE / 2,
      cooldown: 0,
      totalDamage: 0,
      kills: 0,
      // Live stats (mutable by upgrades)
      damage: tDef.damage,
      range: tDef.range,
      fireRate: tDef.fireRate,
      projectileSpeed: tDef.projectileSpeed || 5,
      splash: tDef.splash || 0,
      pullForce: tDef.pullForce || 0,
      slowFactor: tDef.slowFactor || 0,
      slowDuration: tDef.slowDuration || 0,
      chainTargets: tDef.chainTargets || 0,
      chainRange: tDef.chainRange || 0,
      armorPiercing: tDef.armorPiercing || false,
      burnDamage: tDef.burnDamage || 0,
      burnDuration: tDef.burnDuration || 0,

      // Tower HP (for enemy attack system)
      hp: tDef.towerHp || 200,
      maxHp: tDef.towerMaxHp || 200,
      damageResist: tDef.attackDamageResist || 0,
      disabled: false,
      repairCost: 0,
      lastDamagedTick: 0,
      homing: tDef.homing || false,
      _shotCount: 0, // for nuke/nuclear payload counters

      // Upgrade tracking — phased system
      xp: 0,
      passiveTier: 0, // 0–9, which passive tiers have been applied
      skill5chosen: null, // 'A' or 'B'
      skill10chosen: null,
      legendaryUnlocked: false,
      legendary100Unlocked: false,
      upgradeReady: false, // XP threshold hit, awaiting player buy
      upgradeReadyType: null, // 'passive' | 'skill5' | 'skill10' | 'legendary50' | 'legendary100'
      specials: [], // Specials from upgrades

      // _damageEnemy compat:
      tier: 0,
      chosenPath: null,
      tier2Path: null,
      xpToTier1: 999,
      xpToTier2: 999,
      // chosenPath: null, // 'A' or 'B'
      // tier2Path: null,
      // xpToTier1: upgDef?.xpToTier1 || 999,
      // xpToTier2: upgDef?.xpToTier2 || 999,

      // Base copy for display
      baseDamage: tDef.damage,
      baseRange: tDef.range,
      baseFireRate: tDef.fireRate,

      // From def
      color: tDef.color,
      projectileColor: tDef.projectileColor,
      icon: tDef.icon,
      name: tDef.name,
      cost: tDef.cost,
      category: tDef.category,
    };

    const skinTower = this.activeSkin?.towers?.[this.selectedTowerType];
    if (skinTower) {
      tower.color = skinTower.color;
      tower.projectileColor = skinTower.projectileColor;
    }

    this.grid[row][col] = tower;
    this.towers.push(tower);
    this.gold -= tDef.cost;
    this.waveGoldSpent += tDef.cost;
    this.towerCatCounts[tDef.category] =
      (this.towerCatCounts[tDef.category] || 0) + 1;
    this.waveAI.recordTowerPlacement(this.selectedTowerType, { col, row });
    this._addParticles(tower.x, tower.y, tDef.color, 10);
    this._checkSynergies();
    this._emitState();
    return true;
  }

  sellTower(col, row) {
    const tower = this.grid[row]?.[col];
    if (!tower) return;
    const upgradedValue = tower.cost + this._totalUpgradeCost(tower);
    const refund = Math.floor(upgradedValue * ECFG.towerSellRatio);
    this.gold += refund;
    this.grid[row][col] = null;
    this.towers = this.towers.filter((t) => t.id !== tower.id);
    this.towerCatCounts[tower.category] = Math.max(
      0,
      (this.towerCatCounts[tower.category] || 1) - 1,
    );
    this._addFloatingText(tower.x, tower.y, `+${refund}g`, "#facc15");
    if (
      this.selectedTowerCell?.col === col &&
      this.selectedTowerCell?.row === row
    )
      this.selectedTowerCell = null;
    this._checkSynergies();
    this._emitState();
  }

  _totalUpgradeCost(tower) {
    const upgDef = TOWER_UPGRADES[tower.type];
    if (!upgDef) return 0;
    let cost = 0;
    if (tower.tier >= 1 && tower.chosenPath)
      cost += upgDef.tier1[tower.chosenPath]?.cost || 0;
    if (tower.tier >= 2 && tower.tier2Path)
      cost += upgDef.tier2[tower.tier2Path]?.cost || 0;
    return cost;
  }

  // ── TOWER UPGRADE ───────────────────────────────────────────────────────────
  upgradeTower(col, row, skillType, path) {
    const tower = this.grid[row]?.[col];
    if (!tower) return false;

    const upgDef = TOWER_UPGRADES[tower.type];
    if (!upgDef) return false;

    // ✅ universal resolver (works for skill5, skill10, legendary50, legendary100)
    const costDef = upgDef[skillType]?.[path];
    if (!costDef) {
      console.warn("Missing upgrade:", tower.type, skillType, path);
      return false;
    }

    // ✅ base cost
    let effectiveCost = costDef.cost;

    // ✅ scaling only for legendary
    const scaleMap = {
      legendary50: 0.04,
      legendary100: 0.06,
    };

    if (scaleMap[skillType]) {
      effectiveCost = Math.floor(
        costDef.cost * (1 + this.wave * scaleMap[skillType]) + this.gold * 0.1,
      );
    }

    // ✅ prerequisite guards
    if (skillType === "skill5" && (tower.passiveTier < 4 || tower.skill5chosen))
      return false;

    if (
      skillType === "skill10" &&
      (!tower.skill5chosen || tower.passiveTier < 9 || tower.skill10chosen)
    )
      return false;

    if (
      skillType === "legendary50" &&
      (!tower.skill10chosen || tower.legendaryUnlocked)
    )
      return false;

    if (
      skillType === "legendary100" &&
      (!tower.legendaryUnlocked || tower.legendary100Unlocked)
    )
      return false;

    // ✅ gold check
    if (this.gold < effectiveCost) {
      this._addFloatingText(
        tower.x,
        tower.y - 20,
        `Need ${effectiveCost}g`,
        "#ef4444",
      );
      return false;
    }

    this.gold -= effectiveCost;

    // ✅ apply stat deltas
    const d = costDef.statDelta || {};

    if (d.damage !== undefined) tower.damage *= 1 + d.damage;
    if (d.range !== undefined) tower.range *= 1 + d.range;

    if (d.fireRate !== undefined) {
      tower.fireRate = Math.max(
        1,
        Math.round(tower.fireRate * (1 + d.fireRate)),
      );
    }

    if (d.splash !== undefined) tower.splash *= 1 + d.splash;
    if (d.pullForce !== undefined) tower.pullForce += d.pullForce;

    if (d.slowDuration !== undefined) {
      tower.slowDuration = Math.round(
        tower.slowDuration * (1 + d.slowDuration),
      );
    }

    if (d.chainTargets !== undefined) tower.chainTargets += d.chainTargets;
    if (d.burnDamage !== undefined) tower.burnDamage += d.burnDamage;

    if (d.burnDuration !== undefined) {
      tower.burnDuration = Math.round(
        tower.burnDuration * (1 + d.burnDuration),
      );
    }

    if (d.projectileSpeed !== undefined) {
      tower.projectileSpeed *= 1 + d.projectileSpeed;
    }

    // ✅ specials
    if (costDef.special) {
      tower.specials.push(costDef.special);

      // splash30: grant base splash if tower has none
      if (costDef.special === "splash30" && !tower.splash) {
        tower.splash = Math.max(tower.splash || 0, 30);
      }

      if (costDef.special === "armorPiercing") {
        tower.armorPiercing = true;
      }
    }

    // ✅ mark progression
    if (skillType === "skill5") {
      tower.skill5chosen = path;
      tower.tier = 1;
      tower.chosenPath = path;
    }

    if (skillType === "skill10") {
      tower.skill10chosen = path;
      tower.tier = 2;
      tower.tier2Path = path;
    }

    if (skillType === "legendary50") {
      tower.legendaryUnlocked = true;
      tower.legendary50Path = path;
    }

    if (skillType === "legendary100") {
      tower.legendary100Unlocked = true;
      tower.legendary100Path = path;
    }

    // ✅ reset upgrade flags
    tower.upgradeReady = false;
    tower.upgradeReadyType = null;

    // ✅ effects
    this._addParticles(tower.x, tower.y, "#facc15", 20);

    this._addFloatingText(
      tower.x,
      tower.y - 20,
      `✦ ${costDef.name}!`,
      "#fbbf24",
    );

    this._emitState();
    return true;
  }

  _applyUpgrade(tower, tierDef, tier, path) {
    const d = tierDef.statDelta || {};
    // Apply stat multipliers
    if (d.damage !== undefined) tower.damage *= 1 + d.damage;
    if (d.range !== undefined) tower.range *= 1 + d.range;
    if (d.fireRate !== undefined)
      tower.fireRate = Math.max(
        1,
        Math.round(tower.fireRate * (1 + d.fireRate)),
      );
    if (d.splash !== undefined) tower.splash *= 1 + d.splash;
    if (d.pullForce !== undefined) tower.pullForce += d.pullForce;
    if (d.slowDuration !== undefined)
      tower.slowDuration = Math.round(
        tower.slowDuration * (1 + d.slowDuration),
      );
    if (d.chainTargets !== undefined) tower.chainTargets += d.chainTargets;
    if (d.burnDuration !== undefined)
      tower.burnDuration = Math.round(
        tower.burnDuration * (1 + d.burnDuration),
      );
    if (d.burnDamage !== undefined) tower.burnDamage += d.burnDamage;
    if (d.projectileSpeed !== undefined)
      tower.projectileSpeed *= 1 + d.projectileSpeed;
    // Apply specials
    if (tierDef.special) tower.specials.push(tierDef.special);
    if (tierDef.special === "armorPiercing") tower.armorPiercing = true;
    if (tier === 1) {
      tower.tier = 1;
      tower.chosenPath = path;
    } else {
      tower.tier = 2;
      tower.tier2Path = path;
    }
    tower.upgradeReady = false;
  }

  // ── SYNERGY CHECK ────────────────────────────────────────────────────────────
  _checkSynergies() {
    const active = [];
    for (const [key, syn] of Object.entries(SYNERGIES)) {
      let hasA = false,
        hasB = false;
      for (const t of this.towers) {
        if (t.type === syn.towers[0]) hasA = true;
        if (t.type === syn.towers[1]) hasB = true;
      }
      if (hasA && hasB) active.push({ key, ...syn });
    }
    this.activeSynergies = active;
  }

  // ── ABILITIES ────────────────────────────────────────────────────────────────
  triggerAbility(abilityKey) {
    const ab = this.abilities[abilityKey];
    if (!ab || ab.cooldownLeft > 0 || this.state !== "wave") return false;

    if (abilityKey === "airstrike") {
      let hits = 0;
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        this._damageEnemy(this.enemies[i], 500, {
          towerType: null,
          towerId: null,
          armorPiercing: true,
        });
        hits++;
      }
      this._addFloatingText(
        this.canvas.width / 2,
        this.canvas.height / 2,
        `✈️ AIRSTRIKE! ${hits} hit`,
        "#ef4444",
      );
    } else if (abilityKey === "emp") {
      for (const e of this.enemies) {
        e.slowTimer = 180;
        // Bosses only get 1.5s stun from EMP (not full 3s), and respect immunity
        if (!e.isBoss) {
          e.stunTimer = 180;
        } else if (!e.stunImmunity) {
          e.stunTimer = Math.max(e.stunTimer, 90);
        }
      }
      this._addFloatingText(
        this.canvas.width / 2,
        this.canvas.height / 2,
        "🌐 EMP — All Stunned!",
        "#fbbf24",
      );
    } else if (abilityKey === "reinforce") {
      this.globalBuff = {
        fireRateMult: 0.5,
        damageMult: 1.5,
        timer: 480,
        label: "🏰 Reinforce — 2× Fire!",
      };
      this._addFloatingText(
        this.canvas.width / 2,
        this.canvas.height / 2,
        "🏰 REINFORCE!",
        "#4ade80",
      );
    }

    ab.cooldownLeft = ab.cooldown;
    this._addParticles(
      this.canvas.width / 2,
      this.canvas.height / 2,
      ab.color,
      30,
    );
    this._emitState();
    return true;
  }

  _weightedRandomModifier() {
    const total = WAVE_MODIFIERS.reduce((s, m) => s + (m.weight || 1), 0);
    let roll = Math.random() * total;
    for (const m of WAVE_MODIFIERS) {
      roll -= m.weight || 1;
      if (roll <= 0) return m;
    }
    return WAVE_MODIFIERS[WAVE_MODIFIERS.length - 1];
  }

  // ── WAVE MANAGEMENT ──────────────────────────────────────────────────────────
  startWave() {
    if (this.state !== "idle") return;
    this.wave++;

    // ── Scale tower HP with waves so late-game towers survive longer ──────
    if (this.wave > 1) {
      const hpScale = 1 + this.wave * 0.018; // +1.8% max HP per wave
      for (const tower of this.towers) {
        const newMax = Math.floor(TOWER_TYPES[tower.type].towerMaxHp * hpScale);
        if (newMax > tower.maxHp) {
          const diff = newMax - tower.maxHp;
          tower.maxHp = newMax;
          tower.hp = Math.min(tower.maxHp, tower.hp + diff); // heal the difference
          tower.repairCost = Math.ceil(
            ((tower.maxHp - tower.hp) / tower.maxHp) * tower.cost * 0.4,
          );
        }
      }
    }

    if (this.isEndless && this.wave % 10 === 0 && this.wave > 0) {
      const bonusPool = [
        { type: "gold", value: 0.2, label: "💰 +20% gold drops" },
        { type: "damage", value: 0.15, label: "⚔️ +15% tower damage" },
        { type: "range", value: 0.12, label: "🔭 +12% tower range" },
        { type: "fireRate", value: 0.12, label: "⚡ +12% fire rate" },
        { type: "damage", value: 0.2, label: "☢️ +20% tower damage" },
        { type: "gold", value: 0.3, label: "💰 +30% gold drops" },
      ];
      const bonusIdx = Math.floor(this.wave / 10) - 1;
      this.milestoneBonus = bonusPool[bonusIdx % bonusPool.length];
      this._addFloatingText(
        this.canvas.width / 2,
        this.canvas.height / 2 - 30,
        `⚡ WAVE ${this.wave} MILESTONE: ${this.milestoneBonus.label}`,
        "#fbbf24",
      );
    }

    // ── Roll wave modifier every 10 waves ────────────────────────────────────
    this.activeModifier = null;
    this.activeMapBonus = this.mapDef?.mapBonus || null;
    if (this.milestoneBonus) this.activeMapBonus = this.milestoneBonus;

    // silenced tower type settings
    this.silencedTowerType = null;
    if (this.wave % 10 === 0) {
      // Use pre-rolled modifier if available, otherwise roll fresh
      this.activeModifier =
        this._incomingModifier || this._weightedRandomModifier();
      this._incomingModifier = null;
      this.runStats.modifiersFaced.push(this.activeModifier.id);

      if (this.activeModifier.apply?.silenceRandom) {
        const silenceable = this.levelConfig.unlockedTowers.filter(
          (t) => t !== "laser", // never silence laser (stealth would be unbeatable)
        );
        this.silencedTowerType =
          silenceable[Math.floor(Math.random() * silenceable.length)];
      }

      // ── Dual-front setup ──────────────────────────────────────────────────
      // Clean up any leftover camp from a previous wave
      if (this.secondSpawnCamp) {
        this.spawnCamps = this.spawnCamps.filter(
          (c) => c !== this.secondSpawnCamp,
        );
        this.secondSpawnCamp = null;
        this._secondPath = null;
      }

      if (this.activeModifier?.apply?.dualFront) {
        // Pick a second entry point on the OPPOSITE vertical edge from the first
        const firstRow = this.mapDef.waypoints[0].row;
        const secondRow =
          firstRow < GRID_ROWS / 2
            ? Math.floor(GRID_ROWS * 0.75) // first is top-half → second is bottom
            : Math.floor(GRID_ROWS * 0.25); // first is bottom-half → second is top

        // Build a short 3-waypoint path: left edge → mid-column → join main path
        const midCol = Math.floor(GRID_COLS * 0.45);
        const joinIdx = Math.floor(this.path.length * 0.55); // join ~55% along main path
        const joinPt = this.path[joinIdx];

        this._secondPath = this._buildPath([
          { col: 0, row: secondRow },
          { col: midCol, row: secondRow },
          {
            col: Math.floor(joinPt.x / CELL_SIZE),
            row: Math.floor(joinPt.y / CELL_SIZE),
          },
          // remaining waypoints from the join point onward (reuse main path exit)
          ...this.mapDef.waypoints.slice(
            this.mapDef.waypoints.findIndex(
              (wp) => Math.abs(wp.col - Math.floor(joinPt.x / CELL_SIZE)) <= 3,
            ),
          ),
        ]);

        // Clamp to the last map waypoint so enemies always exit properly
        if (!this._secondPath || this._secondPath.length < 4) {
          // Fallback: simple straight path from second row to the kingdom
          const lastWp =
            this.mapDef.waypoints[this.mapDef.waypoints.length - 1];
          this._secondPath = this._buildPath([
            { col: 0, row: secondRow },
            { col: midCol, row: secondRow },
            { col: lastWp.col, row: lastWp.row },
          ]);
        }

        // Build second path cell set so it renders on the grid
        this.secondSpawnCamp = new SpawnCamp(
          this._secondPath[0].x,
          this._secondPath[0].y,
          1, // campIndex 1 → different visual tint
        );
        this.spawnCamps.push(this.secondSpawnCamp);

        this._secondPathCells = new Set();
        for (let i = 0; i < this._secondPath.length - 1; i++) {
          const a = this._secondPath[i];
          const b = this._secondPath[i + 1];
          const steps = Math.max(
            Math.abs(Math.floor(b.x / CELL_SIZE) - Math.floor(a.x / CELL_SIZE)),
            Math.abs(Math.floor(b.y / CELL_SIZE) - Math.floor(a.y / CELL_SIZE)),
          );
          for (let s = 0; s <= steps; s++) {
            const col = Math.round(
              Math.floor(a.x / CELL_SIZE) +
                ((Math.floor(b.x / CELL_SIZE) - Math.floor(a.x / CELL_SIZE)) *
                  s) /
                  Math.max(steps, 1),
            );
            const row = Math.round(
              Math.floor(a.y / CELL_SIZE) +
                ((Math.floor(b.y / CELL_SIZE) - Math.floor(a.y / CELL_SIZE)) *
                  s) /
                  Math.max(steps, 1),
            );
            this._secondPathCells.add(`${col},${row}`);
          }
        }
      }
    }

    // ── Boss check + warning ──────────────────────────────────────────────────
    const bossType = this.isEndless
      ? this.waveAI._endlessBossForWave(this.wave)
      : this.levelConfig.bossWaves?.[this.wave] || null;

    // Roll boss mutation (wave 30+)
    this._pendingBossMutation = null;
    if (bossType && ENEMY_TYPES[bossType] && this.wave >= 30) {
      const eligibleMutations = BOSS_MUTATIONS.filter((m) => {
        const minOk = !m.minWave || this.wave >= m.minWave;
        const maxOk = !m.maxWave || this.wave <= m.maxWave;
        return minOk && maxOk;
      });
      this._pendingBossMutation =
        eligibleMutations[Math.floor(Math.random() * eligibleMutations.length)];
    }

    if (bossType && ENEMY_TYPES[bossType]) {
      this.bossWarningType = bossType;
      this.bossWarningMutation = this._pendingBossMutation;
      this.bossWarningTimer = VCFG.bossWarningFrames;
    }

    const waveData = this.waveAI.generateWave(
      this.wave,
      this.levelConfig.waves,
      this.levelConfig,
    );

    this._eliteSpawnedCount = 0;
    this.spawnQueue = [...waveData.enemies];

    // Apply double-time modifier
    if (this.activeModifier?.apply?.enemyCountMult) {
      const mult = Math.floor(this.activeModifier.apply.enemyCountMult);
      const original = [...this.spawnQueue];
      for (let i = 1; i < mult; i++) {
        const lastDelay = original[original.length - 1]?.spawnDelay || 0;
        const offset = lastDelay + 120;
        this.spawnQueue.push(
          ...original.map((e) => ({
            ...e,
            spawnDelay: e.spawnDelay + offset * i,
          })),
        );
      }
      this.spawnQueue.sort((a, b) => a.spawnDelay - b.spawnDelay);
    }

    // Apply dual assault modifier — second enemy group with mirrored delays
    if (this.activeModifier?.apply?.dualAssault) {
      const original = [...this.spawnQueue];
      // Build a second group with staggered start so both groups run concurrently
      const lastDelay = original[original.length - 1]?.spawnDelay || 0;
      const secondGroup = original
        .filter((e) => !e.isBoss) // don't duplicate bosses
        .map((e) => ({
          ...e,
          spawnDelay: e.spawnDelay + Math.floor(lastDelay * 0.35) + 20,
        }));
      this.spawnQueue.push(...secondGroup);
      this.spawnQueue.sort((a, b) => a.spawnDelay - b.spawnDelay);
    }

    // Tag alternate enemies for the second spawn point (dual-front)
    if (this.activeModifier?.apply?.dualFront && this._secondPath) {
      this.spawnQueue.forEach((e, idx) => {
        if (idx % 2 === 1) e._useSecondPath = true;
      });
    }

    this.spawnTimer = 0;
    this.waveKills = 0;
    this.waveLeaks = 0;
    this.waveDamageByTower = {};
    this.waveGoldSpent = 0;
    this.state = "wave";
    this._waveStartTick = this.tick;
    this.nextWaveMessage = waveData.message;
    this.lastEnemyTypes = [...new Set(waveData.enemies.map((e) => e.type))];
    this.minRequiredTowers = this.waveAI.calcMinimumRequiredTowers(
      this.wave + 1,
      this.levelConfig,
    );
    this._emitState();
  }

  // ── SPAWNING ─────────────────────────────────────────────────────────────────
  _spawnEnemy(data) {
    const def = ENEMY_TYPES[data.type];
    if (!def) return;

    const e = {
      id: Date.now() + Math.random(),
      type: data.type,
      x: this.path[0].x,
      y: this.path[0].y,
      pathIndex: 0,
      hp: def.hp * data.hpMult,
      maxHp: def.hp * data.hpMult,
      speed: def.speed * data.speedMult,
      baseSpeed: def.speed * data.speedMult,
      reward: def.reward,
      color: def.color,
      size: def.size,
      armor: def.armor || 0,
      baseArmor: def.armor || 0,
      stealth: def.stealth || false,
      slowTimer: 0,
      stunTimer: 0,
      burnTimer: 0,
      burnDmg: 0,
      stunCooldown: 0,
      spawnsOnDeath: def.spawnsOnDeath || null,
      spawnCount: def.spawnCount || 0,
      distanceTraveled: 0,
      name: def.name,
      icon: def.icon || "👾",
      isBoss: !!def.isBoss,
      phaseTriggered: false,
      phaseDef: def.phaseAt ? { at: def.phaseAt, boost: def.phaseBoost } : null,
      spawnOnDmg: def.spawnsOnDamage
        ? { ...def.spawnsOnDamage, timer: 0 }
        : null,
      immunities: def.immunities || [],
      weakness: def.weakness || null,
      bossAbility: def.bossAbility || null,
      lootDrop: def.lootDrop || null,
      requiresCounter: def.requiresCounter || null,
      counterNote: def.counterNote || "",
      burnStacks: 0, // for hellfire upgrade
      assistTowers: new Set(),
      stunImmunity: 0,
      rageTimer: 0,
      waveClearTime: 0,
    };

    // ── Apply wave modifier to this enemy ─────────────────────────────────────
    if (this.activeModifier) {
      const mod = this.activeModifier.apply;
      if (mod.enemyArmorBonus)
        e.armor = Math.min(0.92, e.armor + mod.enemyArmorBonus);
      if (mod.enemySpeedMult) {
        e.speed *= 1 + mod.enemySpeedMult;
        e.baseSpeed = e.speed;
      }
      if (mod.allStealth) e.stealth = true;
      if (mod.enemyRewardMult)
        e.reward = Math.round(e.reward * mod.enemyRewardMult);
      if (mod.enemyArmorMelt)
        e.armor = Math.max(0, e.armor - mod.enemyArmorMelt);
      if (mod.immuneStunSlow) e.immunities.push("freeze");
    }

    // ── Apply elite modifier (first N spawned enemies become elites) ──────────
    if (
      this.activeModifier?.apply?.eliteCount &&
      this._eliteSpawnedCount < this.activeModifier.apply.eliteCount &&
      !e.isBoss
    ) {
      e.hp *= this.activeModifier.apply.eliteHpMult;
      e.maxHp = e.hp;
      e.reward = Math.round(
        e.reward * this.activeModifier.apply.eliteRewardMult,
      );
      e.isElite = true;
      e.size *= 1.4;
      this._eliteSpawnedCount++;
    }

    // ── Apply boss mutation ───────────────────────────────────────────────────
    if (e.isBoss && this._pendingBossMutation) {
      const mut = this._pendingBossMutation;
      e.mutation = mut;
      if (mut.apply.armorBonus)
        e.armor = Math.min(0.92, e.armor + mut.apply.armorBonus);
      if (mut.apply.speedMult) {
        e.speed *= mut.apply.speedMult;
        e.baseSpeed = e.speed;
      }
      if (mut.apply.hpMult) {
        e.hp *= mut.apply.hpMult;
        e.maxHp = e.hp;
      }
      if (mut.apply.immuneStunSlow) {
        e.immunities.push("freeze");
        e.stunImmunity = 999999;
      }
      // twin/stealth/regen handled in _updateEnemies

      // Clear pending mutation after boss has received it (not escorts)
      if (e.isBoss && this._pendingBossMutation) {
        this._pendingBossMutation = null;
      }
    }

    // ── Apply gravity immune from mutation ────────────────────────────────
    if (e.mutation?.apply?.gravityImmune) {
      e.gravityImmune = true;
    }

    // ── Apply tower damage multiplier from mutation ────────────────────────
    if (e.mutation?.apply?.towerDamageMult) {
      e.towerDamageMult = e.mutation.apply.towerDamageMult;
    }

    // ── Empowered boss loot override ──────────────────────────────────────────
    if (e.isBoss && this.activeModifier?.apply?.bossHpMult) {
      e.hp *= this.activeModifier.apply.bossHpMult;
      e.maxHp = e.hp;
      if (this.activeModifier.apply.bossLegendaryLoot) {
        e.lootDrop = {
          type: "gold_shower",
          amount: 300,
          label: "👑 Empowered Boss Drop!",
        };
      }
    }

    // ── Apply active evolutions for this enemy type ───────────────────────────
    const evolutions = this.waveAI.getActiveEvolutionsForType(data.type);
    e.activeEvolutions = [];
    for (const evo of evolutions) {
      e.activeEvolutions.push(evo.id);
      const a = evo.apply;
      if (a.hpMult) {
        e.hp *= a.hpMult;
        e.maxHp = e.hp;
      }
      if (a.armorBonus) e.armor = Math.min(0.92, e.armor + a.armorBonus);
      if (a.speedMult) {
        e.speed *= a.speedMult;
        e.baseSpeed = e.speed;
      }
      if (a.immuneSlow) e.immunities.push("freeze");
      if (a.immunities) e.immunities.push(...a.immunities);
      if (a.size) e.size = Math.max(4, e.size + a.size);
      if (a.dodgeChance) e.dodgeChance = a.dodgeChance;
      if (a.phaseCycle) e.phaseCycle = a.phaseCycle;
      if (a.piercingResist) e.piercingResist = a.piercingResist;
      if (a.scatterFormation) e.scatterFormation = true;
    }

    // Check and show evolution alert
    if (this.waveAI.pendingEvolutionAlert) {
      this.evolutionAlertDef = this.waveAI.pendingEvolutionAlert;
      this.evolutionAlertTimer =
        ADMIN_CONFIG.enemyEvolution?.evolutionNotifyFrames || 180;
      this.waveAI.pendingEvolutionAlert = null;
    }

    // Route to second path if flagged by dual-front modifier
    if (data._useSecondPath && this._secondPath?.length > 1) {
      e.x = this._secondPath[0].x;
      e.y = this._secondPath[0].y;
      e._altPath = this._secondPath; // enemies carry their own path reference
      e.pathIndex = 0;
    }

    const skinEnemy = this.activeSkin?.enemies?.[data.type];
    if (skinEnemy?.color) e.color = skinEnemy.color;

    this.enemies.push(e);
  }

  _updateSpawning() {
    if (this.spawnQueue.length === 0) return;
    this.spawnTimer++;
    // Use absolute spawnDelay — check all enemies whose delay has been reached
    while (
      this.spawnQueue.length > 0 &&
      this.spawnTimer >= this.spawnQueue[0].spawnDelay
    ) {
      this._spawnEnemy(this.spawnQueue.shift());
    }
  }

  // ── ENEMY UPDATE ─────────────────────────────────────────────────────────────
  _updateEnemies() {
    // ── BURN ZONES - ground fire from burnOnSplash
    for (let i = this.burnZones.length - 1; i >= 0; i--) {
      const z = this.burnZones[i];
      z.timer--;
      if (z.timer <= 0) {
        this.burnZones.splice(i, 1);
        continue;
      }
      if (this.tick % 20 === 0) {
        for (const e of this.enemies) {
          const d = Math.sqrt((e.x - z.x) ** 2 + (e.y - z.y) ** 2);
          if (d < z.radius) {
            e.hp -= z.damage;
            if (!e.burnTimer) {
              e.burnTimer = Math.max(e.burnTimer, 60);
              e.burnDmg = Math.max(e.burnDmg, z.damage);
            }
            if (e.hp <= 0) this._killEnemy(e, "inferno", null);
          }
        }
      }
    }

    // ── BLACK HOLES — pull all nearby enemies and damage them
    for (let i = this.blackHoles.length - 1; i >= 0; i--) {
      const bh = this.blackHoles[i];
      bh.timer--;
      if (bh.timer <= 0) {
        this.blackHoles.splice(i, 1);
        continue;
      }
      for (const e of this.enemies) {
        const dx = bh.x - e.x,
          dy = bh.y - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < bh.radius) {
          // Pull toward center
          e.x += (dx / dist) * bh.strength * (1 - dist / bh.radius);
          e.y += (dy / dist) * bh.strength * (1 - dist / bh.radius);
          // Damage tick
          if (this.tick % 20 === 0) {
            e.hp -= 8;
            if (e.hp <= 0) this._killEnemy(e, "basic", null);
          }
        }
      }
    }

    // ── BALL LIGHTNING: spawn roaming orbs
    for (let i = this.ballLightnings.length - 1; i >= 0; i--) {
      const bl = this.ballLightnings[i];
      bl.timer--;
      if (bl.timer <= 0) {
        this.ballLightnings.splice(i, 1);
        continue;
      }

      // Drift toward nearest enemy
      const nearest = this.enemies
        .filter(
          (e) =>
            !e.stealth ||
            this.towers.some((t) => t.specials?.includes("allReveal")),
        )
        .sort((a, b) => {
          const da = (a.x - bl.x) ** 2 + (a.y - bl.y) ** 2;
          const db = (b.x - bl.x) ** 2 + (b.y - bl.y) ** 2;
          return da - db;
        })[0];

      if (nearest) {
        const dx = nearest.x - bl.x,
          dy = nearest.y - bl.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        bl.vx += (dx / dist) * 0.3;
        bl.vy += (dy / dist) * 0.3;
      }

      // Cap speed
      const spd = Math.sqrt(bl.vx * bl.vx + bl.vy * bl.vy);
      if (spd > 3) {
        bl.vx = (bl.vx / spd) * 3;
        bl.vy = (bl.vy / spd) * 3;
      }

      bl.x += bl.vx;
      bl.y += bl.vy;

      // Bounce off canvas edges
      if (bl.x < 0 || bl.x > this.canvas.width) bl.vx *= -1;
      if (bl.y < 0 || bl.y > this.canvas.height) bl.vy *= -1;

      // Zap nearby enemies every 20 ticks
      if (bl.zapCooldown > 0) {
        bl.zapCooldown--;
        continue;
      }

      const zapTargets = this.enemies
        .filter(
          (e) =>
            Math.sqrt((e.x - bl.x) ** 2 + (e.y - bl.y) ** 2) < bl.zapRadius,
        )
        .slice(0, 3);

      for (const t of zapTargets) {
        this._damageEnemy(t, bl.damage, {
          towerType: "tesla",
          towerId: bl.towerId,
          armorPiercing: true,
          specials: [],
        });
        this._addBolt(bl.x, bl.y, t.x, t.y, bl.color);
      }
      if (zapTargets.length > 0) bl.zapCooldown = 20;
    }

    // enemies loop
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      // stun takes priority over slow
      if (e.stunImmunity > 0) e.stunImmunity--;

      // decrement solar blind
      if (e._solarBlindCooldown > 0) e._solarBlindCooldown--;

      // decrement dark star debuff
      if (e._darkStarDebuffTimer > 0) e._darkStarDebuffTimer--;

      // stun timer
      if (e.stunTimer > 0) {
        e.stunTimer--;
        e.speed = 0;
        // When stun expires on a boss, give it an immunity window so it can't be perma-stunned
        if (e.stunTimer === 0 && e.isBoss) {
          e.stunImmunity = 180; // 3 seconds between boss stuns
        }
        continue;
      }
      e.speed =
        e.slowTimer > 0 ? (e.slowTimer--, e.baseSpeed * 0.38) : e.baseSpeed;

      // ── GRAVITY LOCK: Vortex Event Horizon — stop enemies in range ───────────
      for (const glt of this.towers) {
        if (!glt.specials?.includes("gravityLock")) continue;
        const gld = Math.sqrt((e.x - glt.x) ** 2 + (e.y - glt.y) ** 2);
        if (gld <= glt.range) {
          e.speed = 0;
          break;
        }
      }

      // ── GLOBAL SLOW: Absolute Zero — all enemies permanently slowed ──────────
      const hasGlobalSlow = this.towers.some((t) =>
        t.specials?.includes("globalSlow"),
      );
      if (hasGlobalSlow && !e.immunities.includes("freeze")) {
        const globalSlowTower = this.towers.find((t) =>
          t.specials?.includes("globalSlow"),
        );
        if (globalSlowTower) {
          const dist = Math.sqrt(
            (e.x - globalSlowTower.x) ** 2 + (e.y - globalSlowTower.y) ** 2,
          );
          if (dist <= globalSlowTower.range * 2.5) {
            // ← range-limited now
            e.slowTimer = Math.max(e.slowTimer, 5);
          }
        }
      }

      // ── ARMOR SLOW: Permafrost — slowed enemies lose 30% armor ───────────────
      if (e.slowTimer > 1 && e._armorBeforeSlow === undefined) {
        if (this.towers.some((t) => t.specials?.includes("armorSlow"))) {
          e._armorBeforeSlow = e.armor;
          e.armor = Math.max(0, e.armor - 0.3);
        }
      }
      if (e.slowTimer <= 1 && e._armorBeforeSlow !== undefined) {
        e.armor = e._armorBeforeSlow;
        delete e._armorBeforeSlow;
      }

      // Phase cycle (evolved ghosts blink in/out)
      if (e.phaseCycle) {
        e.stealth = Math.floor(this.tick / (e.phaseCycle / 2)) % 2 === 0;
      }

      // Scatter formation — stay spread from nearby same-type enemies
      if (e.scatterFormation) {
        for (const other of this.enemies) {
          if (other.id === e.id || other.type !== e.type) continue;
          const dx = e.x - other.x,
            dy = e.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 40 && dist > 0) {
            // wider detection radius
            const push = 1.8 * (1 - dist / 40); // stronger push when closer
            e.x += (dx / dist) * push;
            e.y += (dy / dist) * push;
          }
        }
      }

      // Burn DoT
      if (e.burnTimer > 0) {
        e.burnTimer--;
        if (this.tick % 20 === 0) {
          const burnDmg = e.burnDmg * (e.burnStacks || 1);
          e.hp -= burnDmg;
          // attribute burn XP to the inferno tower that applied it
          if (e.burnSourceId) {
            const burnTower = this.towers.find((t) => t.id === e.burnSourceId);
            if (burnTower) {
              const burnXp = Math.sqrt(burnDmg) * 0.015 * this.xpMult;
              burnTower.xp += burnXp;
              burnTower.totalDamage += burnDmg;
              this._checkTowerProgression(burnTower, this.wave);
            }
          }
          if (e.hp <= 0) {
            this._killEnemy(e, "inferno", e.burnSourceId);
            continue;
          }
        }
      }

      // ── Decay anti-heal timer ─────────────────────────────────────────────
      if (e._antiHealTimer > 0) {
        e._antiHealTimer--;
        if (e._antiHealTimer === 0) e._antiHealApplied = false;
      }

      // ── VOID STEP: teleport forward periodically ──────────────────────────
      if (e.mutation?.apply?.voidStep) {
        e._voidStepTimer = (e._voidStepTimer || 0) + 1;
        if (e._voidStepTimer >= e.mutation.apply.voidStepInterval) {
          e._voidStepTimer = 0;
          const activePath = e._altPath ?? this.path;
          const targetIdx = Math.min(
            Math.floor(activePath.length * e.mutation.apply.voidStepFraction) +
              e.pathIndex,
            activePath.length - 2,
          );
          if (targetIdx > e.pathIndex) {
            e.pathIndex = targetIdx;
            e.x = activePath[targetIdx].x;
            e.y = activePath[targetIdx].y;
            this._addParticles(e.x, e.y, "#818cf8", 20);
            this._addFloatingText(e.x, e.y - 30, "⚡ VOID STEP!", "#818cf8");
          }
        }
      }

      // ── BERSERKER: speed stacks on HP loss ───────────────────────────────
      if (e.mutation?.apply?.berserker) {
        const hpPct = e.hp / e.maxHp;
        const mut = e.mutation.apply;
        const stacks = Math.min(
          Math.floor((1 - hpPct) / mut.berserkerStackSize),
          mut.berserkerMaxStacks,
        );
        if (stacks !== (e._berserkerStacks || 0)) {
          e._berserkerStacks = stacks;
          const boost = 1 + stacks * mut.berserkerSpeedBonus;
          e.baseSpeed =
            (ENEMY_TYPES[e.type]?.speed || 1) *
            boost *
            (1 + this.wave * ADMIN_CONFIG.ai.endlessSpeedPerWave);
          if (stacks > 0) {
            this._addFloatingText(
              e.x,
              e.y - 24,
              `🔥 BERSERK ×${stacks}!`,
              "#ef4444",
            );
          }
        }
      }

      // ── ADAPTIVE IMMUNITY: cycle immunity every N frames ──────────────────
      if (e.mutation?.apply?.adaptiveImmunity) {
        e._adaptiveTimer = (e._adaptiveTimer || 0) + 1;
        if (e._adaptiveTimer >= e.mutation.apply.adaptiveInterval) {
          e._adaptiveTimer = 0;
          // Remove old adaptive immunity
          e.immunities = e.immunities.filter(
            (i) => i !== e._adaptiveCurrentImmunity,
          );
          // Add immunity to last tower that hit it
          if (e._lastHitByTower && !e.immunities.includes(e._lastHitByTower)) {
            e._adaptiveCurrentImmunity = e._lastHitByTower;
            e.immunities.push(e._lastHitByTower);
            const tDef = TOWER_TYPES[e._lastHitByTower];
            this._addFloatingText(
              e.x,
              e.y - 30,
              `🧬 IMMUNE: ${tDef?.name || e._lastHitByTower}!`,
              "#fbbf24",
            );
          }
        }
      }

      // ── BURN SPEED BOOST: Thermal Boost evolution ─────────────────────────
      if (e.activeEvolutions?.includes("fast_vs_inferno") && e.burnTimer > 0) {
        e.baseSpeed =
          (ENEMY_TYPES[e.type]?.speed || 1) *
          (1 + this.wave * ADMIN_CONFIG.ai.endlessSpeedPerWave) *
          (1 + (e._thermalBoost || 0.4));
      } else if (
        e.activeEvolutions?.includes("fast_vs_inferno") &&
        e.burnTimer <= 0
      ) {
        // Reset speed when not burning
        e.baseSpeed =
          (ENEMY_TYPES[e.type]?.speed || 1) *
          (1 + this.wave * ADMIN_CONFIG.ai.endlessSpeedPerWave);
      }

      // ── Medic escort — stay with nearby allies, don't race ahead ─────────
      if (e.type === "healer") {
        const escortRadius = (ENEMY_TYPES.healer.healRadius || 90) * 2.2;
        const nearby = this.enemies.filter((other) => {
          if (other.id === e.id || other.type === "healer" || other.isBoss)
            return false;
          const ddx = other.x - e.x,
            ddy = other.y - e.y;
          return Math.sqrt(ddx * ddx + ddy * ddy) <= escortRadius;
        });

        if (nearby.length > 0) {
          // Average path index of nearby allies
          const avgIdx =
            nearby.reduce((sum, a) => sum + a.pathIndex, 0) / nearby.length;

          if (e.pathIndex > avgIdx + 4) {
            // Too far ahead — slow to 35% so allies catch up
            e.speed = e.baseSpeed * 0.35;
          } else if (e.pathIndex < avgIdx - 6) {
            // Falling behind — rush to 170% to rejoin
            e.speed = Math.min(e.baseSpeed * 1.7, 3.5);
          } else {
            // In formation — match average speed of nearby group
            const avgSpeed =
              nearby.reduce((sum, a) => sum + a.baseSpeed, 0) / nearby.length;
            e.speed = Math.max(
              e.baseSpeed * 0.8,
              Math.min(avgSpeed * 1.1, e.baseSpeed * 1.4),
            );
          }
        }
        // No nearby allies — advance normally (baseSpeed already set above)
      }

      // Heal interval shrinks at higher waves — healer becomes faster threat
      const healInterval = Math.max(
        30,
        Math.floor(
          (ENEMY_TYPES.healer.healInterval || 60) *
            Math.max(0.5, 1 - this.wave * 0.004),
        ),
      );
      if (e.type === "healer" && this.tick % healInterval === 0) {
        let healed = 0;
        const healRadius = ENEMY_TYPES.healer.healRadius || 90;
        const healRate = ENEMY_TYPES.healer.healRate || 0.08;

        for (const other of this.enemies) {
          if (other.id === e.id || other.isBoss) continue;
          const dx = other.x - e.x,
            dy = other.y - e.y;
          if (
            Math.sqrt(dx * dx + dy * dy) <= healRadius &&
            other.hp < other.maxHp
          ) {
            const healAmt = other.maxHp * healRate;
            other.hp = Math.min(other.maxHp, other.hp + healAmt);
            healed++;
            this._addParticles(other.x, other.y - 8, "#4ade80", 5);
          }
        }
        if (healed > 0) {
          this._addFloatingText(e.x, e.y - 24, `⚕ HEAL ×${healed}`, "#4ade80");
        }
      }

      // ── Boss mutation: regen ─────────────────────────────────────────────
      if (
        e.mutation?.apply?.regenRate &&
        this.tick % 60 === 0 &&
        e.hp < e.maxHp &&
        !e._antiHealTimer // ← add this guard
      ) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * e.mutation.apply.regenRate);
      }

      // ── Wave modifier: enemy regen ───────────────────────────────────────
      if (
        this.activeModifier?.apply?.enemyRegenRate &&
        this.tick % 60 === 0 &&
        e.hp < e.maxHp &&
        !e._antiHealTimer // ← add this guard
      ) {
        e.hp = Math.min(
          e.maxHp,
          e.hp + e.maxHp * this.activeModifier.apply.enemyRegenRate,
        );
      }

      if (
        e.mutation?.apply?.regenRate &&
        e.phaseTriggered &&
        e.mutation.apply.phase2RegenMult &&
        this.tick % 60 === 0 &&
        !e._antiHealTimer // ← add this guard
      ) {
        const rate =
          e.mutation.apply.regenRate * e.mutation.apply.phase2RegenMult;
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * rate);
      }

      // ── Boss mutation: phase cloak (stealth below HP threshold) ──────────
      if (
        e.mutation?.apply?.stealthBelowHp &&
        !e.stealth &&
        e.hp / e.maxHp <= e.mutation.apply.stealthBelowHp
      ) {
        e.stealth = true;
        this._addFloatingText(e.x, e.y - 30, "👻 PHASE CLOAK!", "#a78bfa");
        this._addParticles(e.x, e.y, "#a78bfa", 20);
      }

      // ── Boss mutation: twin spawn ────────────────────────────────────────
      if (
        e.isBoss &&
        e.mutation?.apply?.twinAt &&
        !e.twinSpawned &&
        e.hp / e.maxHp <= e.mutation.apply.twinAt
      ) {
        e.twinSpawned = true;
        const twin = {
          ...e,
          id: Date.now() + Math.random(),
          hp: e.maxHp * (e.mutation.apply.twinHpFraction || 0.6),
          maxHp: e.maxHp * (e.mutation.apply.twinHpFraction || 0.6),
          twinSpawned: true,
          mutation: null,
          x: e.x + 15,
          y: e.y + 15,
          slowTimer: 0,
          stunTimer: 0,
          burnTimer: 0,
          assistTowers: new Set(),
        };
        this.enemies.push(twin);
        this._addFloatingText(e.x, e.y - 36, "👥 TWIN SPAWN!", "#ef4444");
        this._addParticles(e.x, e.y, "#ef4444", 30);
      }

      // Boss spawn-on-damage timer
      if (e.spawnOnDmg) {
        e.spawnOnDmg.timer++;
        if (e.spawnOnDmg.timer >= e.spawnOnDmg.every) {
          e.spawnOnDmg.timer = 0;
          for (let s = 0; s < e.spawnOnDmg.count; s++)
            this._spawnChildAt(e, e.spawnOnDmg.type);
        }
      }

      // Boss phase 2
      if (
        e.isBoss &&
        !e.phaseTriggered &&
        e.phaseDef &&
        e.hp / e.maxHp <= e.phaseDef.at
      ) {
        e.phaseTriggered = true;
        const b = e.phaseDef.boost;
        if (b.speed) e.baseSpeed *= b.speed;
        if (b.armorDelta)
          e.armor = Math.max(0, Math.min(0.9, e.baseArmor + b.armorDelta));
        this._addParticles(e.x, e.y, "#ff0000", 25);
        this._addFloatingText(e.x, e.y - 24, "⚠ PHASE 2!", "#ff4444");
      }

      // Boss rage — escalates every 25 seconds it survives
      if (e.isBoss) {
        e.rageTimer = (e.rageTimer || 0) + 1;
        if (e.rageTimer > 0 && e.rageTimer % 1500 === 0) {
          e.baseSpeed = Math.min(e.baseSpeed * 1.22, 2.8);
          e.armor = Math.min(0.92, (e.armor || 0) + 0.05);
          this._addParticles(e.x, e.y, "#ef4444", 30);
          this._triggerShake(5, 8);
          this._addFloatingText(e.x, e.y - 44, "🔥 BOSS ENRAGED!", "#ef4444");
        }
      }

      // ── Enemy attacks nearby towers ────────────────────────────────────────
      if (this.tick % 20 === 0) {
        // check 3× per second
        const atkDps = ENEMY_TYPES[e.type]?.attackDps || 0;
        const atkRng = ENEMY_TYPES[e.type]?.attackRange || 0;
        const dmgPer20 = atkDps / 3; // 20 ticks = 1/3 second

        if (atkDps > 0) {
          for (const tower of this.towers) {
            // ── Decay mirror shield cooldown ──────────────────────────────────
            if (tower._mirrorCooldown > 0) tower._mirrorCooldown--;

            const dx = tower.x - e.x,
              dy = tower.y - e.y;
            if (Math.sqrt(dx * dx + dy * dy) <= atkRng) {
              const resist = tower.damageResist || 0;

              const hasBulwark = this.towers.some(
                (t) =>
                  t.specials?.includes("bulwarkField") &&
                  Math.sqrt((t.x - tower.x) ** 2 + (t.y - tower.y) ** 2) <=
                    t.range,
              );

              const bulwarkReduction = hasBulwark ? 0.4 : 0;
              const actualDmg =
                dmgPer20 * (1 - resist) * (1 - bulwarkReduction);

              tower.hp = Math.max(0, tower.hp - actualDmg);
              tower.lastDamagedTick = this.tick;
              tower.repairCost = Math.ceil(
                ((tower.maxHp - tower.hp) / tower.maxHp) * tower.cost * 0.4,
              );

              // Disable at 0 HP
              if (tower.hp <= 0 && !tower.disabled) {
                tower.disabled = true;
                this._addFloatingText(
                  tower.x,
                  tower.y - 20,
                  `⚠ ${TOWER_TYPES[tower.type]?.name} DISABLED!`,
                  "#ef4444",
                );
                this._addParticles(tower.x, tower.y, "#ef4444", 20);
              }

              // Visual crack effect for heavy hits
              if (actualDmg >= 5) {
                this._addParticles(tower.x, tower.y, "#94a3b8", 3);
              }
              break; // one tower attacked per enemy per check
            }
          }
        }
      }

      // Use alt path if this enemy was routed from the second entry point
      const activePath = e._altPath ?? this.path;
      const tgt = activePath[e.pathIndex + 1];
      if (!tgt) {
        this.lives = Math.max(0, this.lives - (e.isBoss ? 5 : 1));
        this.waveLeaks++;
        this._addFloatingText(
          activePath[activePath.length - 1].x,
          activePath[activePath.length - 1].y,
          e.isBoss ? "-5 ❤️" : "-1 ❤️",
          "#ef4444",
        );
        this.enemies.splice(i, 1);
        this._checkLastStand();
        if (this.lives <= 0) {
          this.state = "gameover";
          this.waveAI.finalizeGame(false);
          this._emitState();
        }
        continue;
      }
      const dx = tgt.x - e.x,
        dy = tgt.y - e.y,
        dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < e.speed) {
        e.pathIndex++;
        e.x = tgt.x;
        e.y = tgt.y;
      } else {
        e.x += (dx / dist) * e.speed;
        e.y += (dy / dist) * e.speed;
      }
      e.distanceTraveled += e.speed;
    }
  }

  _checkLastStand() {
    const wasActive = this.lastStandActive;
    this.lastStandActive = this.lives <= 3 && this.lives > 0;
    if (this.lastStandActive && !wasActive) {
      this._addFloatingText(
        this.canvas.width / 2,
        this.canvas.height / 2 - 20,
        "🔥 LAST STAND! All towers +50% DMG",
        "#ef4444",
      );
    }
  }

  _spawnChildAt(parent, type) {
    const def = ENEMY_TYPES[type];
    if (!def) return;

    const CFG = ADMIN_CONFIG.ai;
    const waveHpMult =
      1 +
      this.wave * (this.isEndless ? CFG.endlessHpPerWave : CFG.enemyHpPerWave);
    const waveSpeedMult =
      1 +
      this.wave *
        (this.isEndless ? CFG.endlessSpeedPerWave : CFG.enemySpeedPerWave);

    const lateGameFactor =
      this.wave > 20
        ? Math.pow(CFG.lateGameExpScale || 1.18, (this.wave - 20) / 10)
        : 1;

    const scaledHp = def.hp * waveHpMult * lateGameFactor * 0.8;
    const scaledSpeed = def.speed * waveSpeedMult;

    this.enemies.push({
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

  // ── TOWER FIRING ──────────────────────────────────────────────────────────────
  _updateTowers() {
    if (this.globalBuff.timer > 0) this.globalBuff.timer--;
    const fireRateMult =
      this.globalBuff.timer > 0 ? this.globalBuff.fireRateMult : 1;
    const damageMult =
      (this.globalBuff.timer > 0 ? this.globalBuff.damageMult : 1) *
      (this.lastStandActive ? 1.5 : 1);
    // Wave modifier multipliers
    const modFireRateMult = this.activeModifier?.apply?.towerFireRateMult
      ? 1 - this.activeModifier.apply.towerFireRateMult // e.g. 0.45 faster = mult 0.55
      : 1;
    const modRangeMult = this.activeModifier?.apply?.towerRangeMult
      ? 1 + this.activeModifier.apply.towerRangeMult // e.g. -0.35 = mult 0.65
      : 1;
    for (const ab of Object.values(this.abilities))
      if (ab.cooldownLeft > 0) ab.cooldownLeft--;
    // Decay bolt effects each tick
    for (let i = this.boltEffects.length - 1; i >= 0; i--) {
      this.boltEffects[i].life--;
      if (this.boltEffects[i].life <= 0) this.boltEffects.splice(i, 1);
    }
    const synergyTeslaReveal = this.activeSynergies.some(
      (s) => s.key === "laser_tesla",
    );

    for (const tower of this.towers) {
      // Silenced tower check
      if (tower.type === this.silencedTowerType) continue;
      if (tower.disabled) continue;
      if (tower.cooldown > 0) {
        tower.cooldown--;
        continue;
      }

      // ── GLOBAL REVEAL ───────────────────────────────
      const globalReveal = this.towers.some((t) =>
        t.specials?.includes("allReveal"),
      );

      // ── TESLA: immediate hit, arc bolt visuals, no projectile object ──────
      if (tower.type === "tesla") {
        const teslaCanHitStealth =
          synergyTeslaReveal ||
          globalReveal ||
          tower.specials?.includes("fullPierce"); // ← Thundergod now works

        const inRange = this.enemies
          .filter((e) => {
            if (e.stealth && !teslaCanHitStealth) return false;

            const hasPierce =
              tower.specials?.includes("shieldPierce") ||
              tower.specials?.includes("fullPierce");
            if (e.immunities.includes("tesla") && !hasPierce) return false;
            return (
              Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2) <=
              tower.range * modRangeMult
            );
          })
          .sort((a, b) => b.distanceTraveled - a.distanceTraveled)
          .slice(0, (tower.chainTargets || 3) + 1);

        // ── Range check FIRST — nothing below fires without targets ──────────
        if (inRange.length === 0) continue;

        tower.cooldown = Math.max(
          1,
          Math.round(tower.fireRate * fireRateMult * modFireRateMult),
        );
        tower._shotCount = (tower._shotCount || 0) + 1;

        // ── ARC PULSE: every 5th tesla fire = full-screen pulse ──────────────────
        if (
          tower.specials?.includes("arcPulse") &&
          tower._shotCount % 5 === 0
        ) {
          for (const e of this.enemies) {
            this._damageEnemy(e, tower.damage * 1.5, {
              towerType: "tesla",
              towerId: tower.id,
              armorPiercing: true,
              specials: [],
            });
            this._addBolt(tower.x, tower.y, e.x, e.y, tower.color);
          }
          this._triggerShake(6, 8);
          this._addFloatingText(
            tower.x,
            tower.y - 30,
            "💀 ARC PULSE!",
            "#fbbf24",
          );
        }

        // ── BALL LIGHTNING: every 8th tesla fire spawns a roaming orb ────────────
        if (tower.specials?.includes("ballLightning")) {
          tower._blCount = (tower._blCount || 0) + 1;
          if (tower._blCount % 8 === 0) {
            this.ballLightnings.push({
              x: tower.x,
              y: tower.y,
              vx: (Math.random() - 0.5) * 2,
              vy: (Math.random() - 0.5) * 2,
              timer: 300,
              damage: tower.damage * 0.6,
              zapRadius: 60,
              zapCooldown: 0,
              color: tower.color,
              towerId: tower.id,
            });
          }
        }

        const dmg = tower.damage * damageMult;
        inRange.forEach((e, idx) => {
          const chainDmg = idx === 0 ? dmg : dmg * 0.7;
          this._damageEnemy(e, chainDmg, {
            towerType: "tesla",
            towerId: tower.id,
            armorPiercing: true,
            slowDuration: 0,
            burnDamage: 0,
            burnDuration: 0,
            specials: tower.specials || [],
          });
          if (tower.specials?.includes("chainStun")) {
            if (e.stunCooldown <= 0) {
              e.stunTimer = e.isBoss ? 15 : 12;
              e.stunCooldown = e.isBoss ? 120 : 60;
            }
          }
          const src = idx === 0 ? tower : inRange[idx - 1];
          this._addBolt(src.x, src.y, e.x, e.y, tower.color);
          this._addParticles(e.x, e.y, tower.color, 4);
        });
        continue;
      }

      // ── CYCLONE: spinning continuous AoE damage + pull around vortex ─────────
      if (tower.specials?.includes("cyclone") && this.tick % 15 === 0) {
        const spinRadius = tower.range * 0.65; // tighter than full range
        const spinDmg = tower.damage * 0.15; // light per-tick, adds up fast
        const spinAngle = (this.tick * 0.08) % (Math.PI * 2); // rotating phase

        for (const e of this.enemies) {
          const dx = e.x - tower.x,
            dy = e.y - tower.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > spinRadius || dist < 4) continue;

          // Damage
          this._damageEnemy(e, spinDmg, {
            towerType: "vortex",
            towerId: tower.id,
            armorPiercing: false,
            specials: [],
          });

          // Tangential push — enemies orbit around the tower instead of just getting pulled
          const normalAng = Math.atan2(dy, dx);
          const tangentAng = normalAng + Math.PI / 2; // perpendicular = orbital
          const spinForce = 1.8 * (1 - dist / spinRadius);

          e.x += Math.cos(tangentAng) * spinForce;
          e.y += Math.sin(tangentAng) * spinForce;

          // Also slight inward pull so enemies don't just fly out
          e.x -= (dx / dist) * spinForce * 0.4;
          e.y -= (dy / dist) * spinForce * 0.4;

          // Clamp to canvas
          e.x = Math.max(0, Math.min(this.canvas.width, e.x));
          e.y = Math.max(0, Math.min(this.canvas.height, e.y));
        }

        // Visual: spinning bolt ring every 15 ticks
        for (let i = 0; i < 3; i++) {
          const a = spinAngle + i * ((Math.PI * 2) / 3);
          const bx = tower.x + Math.cos(a) * spinRadius;
          const by = tower.y + Math.sin(a) * spinRadius;
          this._addBolt(tower.x, tower.y, bx, by, tower.color);
        }
      }

      // ── HELLGATE: continuous damage + burn in range ───────────────────────────
      if (tower.specials?.includes("hellgate") && this.tick % 20 === 0) {
        for (const e of this.enemies) {
          if (e.immunities.includes("inferno")) continue;
          const d = Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2);
          if (d <= tower.range) {
            // Continuous damage — doesn't need a projectile
            this._damageEnemy(e, tower.damage * 0.45, {
              towerType: "inferno",
              towerId: tower.id,
              armorPiercing: false,
              specials: [],
              burnDamage: tower.burnDamage * 2,
              burnDuration: tower.burnDuration,
            });
          }
        }
      }

      // ── BURN AURA: Inferno — passively burn all in range ─────────────────────
      if (tower.specials?.includes("burnAura") && this.tick % 40 === 0) {
        for (const e of this.enemies) {
          if (e.immunities.includes("inferno")) continue;
          const d = Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2);
          if (d <= tower.range) {
            e.burnTimer = Math.max(e.burnTimer, 80);
            e.burnDmg = Math.max(e.burnDmg, tower.burnDamage || 3);
            e.burnSourceId = tower.id;
          }
        }
      }

      // ── METEOR STORM: random blasts in range every 30 ticks ──────────────────
      if (tower.specials?.includes("meteorStorm") && this.tick % 30 === 0) {
        // Pick a random enemy in range and deal a small blast
        const candidates = this.enemies.filter((e) => {
          return (
            Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2) <=
            tower.range * 1.5
          );
        });
        if (candidates.length > 0) {
          const target =
            candidates[Math.floor(Math.random() * candidates.length)];
          this._damageEnemy(target, tower.damage * 0.6, {
            towerType: "cannon",
            towerId: tower.id,
            armorPiercing: false,
            specials: [],
          });
          this._dealSplashDamage(
            {
              ...{ x: target.x, y: target.y },
              towerType: "cannon",
              towerId: tower.id,
              damage: tower.damage * 0.4,
              splash: tower.splash * 0.5,
              pullForce: 0,
              specials: [],
            },
            target,
          );
          this._addParticles(target.x, target.y, tower.projectileColor, 10);
          this._addFloatingText(target.x, target.y - 10, "🌠", "#f97316");
        }
      }

      // ── ARMAGEDDON: hits ALL enemies every 3 seconds ─────────────────────────
      if (
        tower.specials?.includes("armageddon") &&
        this.tick % 300 === 0 &&
        this.enemies.length > 0
      ) {
        for (const e of this.enemies) {
          if (e.immunities.includes("missile")) continue;
          this._damageEnemy(e, tower.damage, {
            towerType: "missile",
            towerId: tower.id,
            armorPiercing: false,
            splash: tower.splash,
            specials: [],
          });
          this._addParticles(e.x, e.y, tower.projectileColor, 8);
        }
        this._triggerShake(6, 8);
        this._addFloatingText(
          tower.x,
          tower.y - 30,
          "💢 ARMAGEDDON!",
          "#f43f5e",
        );
      }

      let target = null;

      if (tower.type === "missile") {
        // Missiles lock onto highest HP enemy in range
        for (const enemy of this.enemies) {
          if (enemy.stealth) continue; // missiles can't see stealth
          if (enemy.immunities.includes("missile")) continue;
          const dx = enemy.x - tower.x,
            dy = enemy.y - tower.y;
          if (Math.sqrt(dx * dx + dy * dy) <= tower.range * modRangeMult) {
            if (!target || enemy.hp > target.hp) target = enemy;
          }
        }
      } else {
        for (const enemy of this.enemies) {
          const canTargetStealth =
            tower.type === "laser" ||
            globalReveal ||
            tower.specials?.includes("fullPierce") ||
            tower.specials?.includes("trueDamage");
          if (enemy.stealth && !canTargetStealth) continue;

          if (enemy.immunities.includes(tower.type)) continue;
          const dx = enemy.x - tower.x,
            dy = enemy.y - tower.y;
          if (Math.sqrt(dx * dx + dy * dy) <= tower.range * modRangeMult) {
            if (!target || enemy.distanceTraveled > target.distanceTraveled)
              target = enemy;
          }
        }
      }
      if (!target) continue;

      // ── Laser: rapid beam — beamAll hits all enemies in range ────────────
      if (tower.type === "laser") {
        const beamAll = tower.specials?.includes("beamAll");
        const modRange = tower.range * modRangeMult;

        const targets = this.enemies
          .filter((e) => {
            if (e.immunities.includes("laser")) return false;
            const inRange =
              Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2) <=
              modRange;
            if (!inRange) return false;
            // stealth: laser always hits, or synergyReveal
            return true;
          })
          .sort((a, b) => b.distanceTraveled - a.distanceTraveled);

        if (targets.length === 0) continue;
        this._fireProjectile(tower, targets[0], damageMult);
        tower.cooldown = Math.max(
          1,
          Math.round(tower.fireRate * fireRateMult * modFireRateMult),
        );

        // beamAll: instant damage to all other enemies in range at 25% power
        if (beamAll && targets.length > 1) {
          for (let bi = 1; bi < targets.length; bi++) {
            this._damageEnemy(targets[bi], tower.damage * damageMult * 0.25, {
              towerType: "laser",
              towerId: tower.id,
              armorPiercing: false,
              specials: tower.specials,
            });
            this._addBolt(
              tower.x,
              tower.y,
              targets[bi].x,
              targets[bi].y,
              tower.color,
            );
          }
        }

        // omegeBeam
        if (tower.specials?.includes("omegaBeam") && this.tick % 25 === 0) {
          for (const e of this.enemies) {
            if (e.immunities.includes("laser")) continue;
            this._damageEnemy(e, tower.damage * 0.8, {
              towerType: "laser",
              towerId: tower.id,
              armorPiercing: false,
              specials: [],
            });
            this._addBolt(tower.x, tower.y, e.x, e.y, tower.color);
          }
        }

        // prismSplit — must be inside laser block because laser `continue`s
        if (tower.specials?.includes("prismSplit")) {
          const prismExtra = this.enemies
            .filter((e) => {
              if (e.id === target.id) return false;
              if (e.immunities.includes("laser")) return false;
              return (
                Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2) <=
                tower.range * modRangeMult
              );
            })
            .sort((a, b) => b.distanceTraveled - a.distanceTraveled)
            .slice(0, 2);
          for (const pe of prismExtra) {
            this._damageEnemy(pe, tower.damage * damageMult * 0.6, {
              towerType: "laser",
              towerId: tower.id,
              armorPiercing: false,
              specials: [],
            });
            this._addBolt(tower.x, tower.y, pe.x, pe.y, "#e879f9");
          }
        }

        continue;
      } else this._fireProjectile(tower, target, damageMult);

      tower.cooldown = Math.max(
        1,
        Math.round(tower.fireRate * fireRateMult * modFireRateMult),
      );
    }

    // ── AUTO-REPAIR: slowly heal damaged towers during wave ───────────────
    if (this.autoRepair && this.tick % 60 === 0) {
      const damagedTowers = this.towers.filter(
        (t) => t.hp < t.maxHp && !t.disabled,
      );
      for (const tower of damagedTowers) {
        const healAmt = tower.maxHp * 0.04; // 4% HP per second
        const healCost = Math.ceil(tower.cost * 0.008); // tiny gold cost per heal tick

        if (this.gold >= healCost) {
          this.gold -= healCost;
          tower.hp = Math.min(tower.maxHp, tower.hp + healAmt);
          tower.repairCost = Math.ceil(
            ((tower.maxHp - tower.hp) / tower.maxHp) * tower.cost * 0.4,
          );
          if (tower.hp >= tower.maxHp) {
            tower.repairCost = 0;
            this._addFloatingText(
              tower.x,
              tower.y - 18,
              "🔧 Repaired!",
              "#4ade80",
            );
          }
        }
      }

      // Re-enable disabled towers that got healed above threshold
      for (const tower of this.towers) {
        if (tower.disabled && tower.hp > tower.maxHp * 0.3) {
          tower.disabled = false;
          this._addFloatingText(tower.x, tower.y - 18, "↑ Online!", "#4ade80");
        }
      }
    }
  }

  _addBolt(x1, y1, x2, y2, color) {
    this.boltEffects.push({
      x1,
      y1,
      x2,
      y2,
      color,
      life: 8,
      maxLife: 8,
      mx: (x1 + x2) / 2 + (Math.random() - 0.5) * 30,
      my: (y1 + y2) / 2 + (Math.random() - 0.5) * 30,
    });
  }

  _fireProjectile(tower, target, damageMult = 1) {
    const dx = target.x - tower.x,
      dy = target.y - tower.y,
      dist = Math.sqrt(dx * dx + dy * dy);
    const hasShatterSyn = this.activeSynergies.some(
      (s) => s.key === "freeze_cannon",
    );
    const hasFrozenCrit = this.activeSynergies.some(
      (s) => s.key === "sniper_freeze",
    );
    let dmgMult = damageMult;
    if (hasFrozenCrit && tower.type === "sniper" && target.slowTimer > 0)
      dmgMult *= 1.8;

    this.projectiles.push({
      id: Date.now() + Math.random(),
      x: tower.x,
      y: tower.y,
      originX: tower.x,
      originY: tower.y,
      vx: (dx / dist) * tower.projectileSpeed,
      vy: (dy / dist) * tower.projectileSpeed,
      damage: tower.damage * dmgMult,
      color: tower.projectileColor,
      splash: tower.splash || 0,
      slowFactor: tower.slowFactor || 0,
      slowDuration: tower.slowDuration || 0,
      chainTargets: tower.chainTargets || 0,
      chainRange: tower.chainRange || 0,
      burnDamage: tower.burnDamage || 0,
      burnDuration: tower.burnDuration || 0,
      armorPiercing: tower.armorPiercing || false,
      pullForce: tower.pullForce || 0,
      projectileSpeed: tower.projectileSpeed || 5,
      homing: tower?.homing || false,
      towerId: tower.id,
      towerType: tower.type,
      targetId: target.id,
      size: tower.type === "cannon" || tower.type === "vortex" ? 6 : 4,
      specials: tower.specials || [],
      hasShatterSyn,
      maxTravelDist: (() => {
        switch (tower.type) {
          case "laser":
            return tower.range * 1.08; // very tight — beam stops at range
          case "sniper":
            return tower.range * 1.4; // long range already, small grace
          case "basic":
            return tower.range * 1.3; // bullets, moderate grace
          case "cannon":
            return tower.range * 1.35; // slow projectile, some arc grace
          case "freeze":
            return tower.range * 1.25; // slow crystal, tight
          case "inferno":
            return tower.range * 1.3; // fireball
          case "vortex":
            return tower.range * 1.3; // orb
          case "missile":
            return tower.range * 1.6; // homing gets most grace
          default:
            return tower.range * 1.35;
        }
      })(),
      travelDist: 0,
      _baseTowerDamage: tower.damage,
      _targetWasVisible: !target.stealth,
    });

    if (tower.specials?.includes("allReveal") && tower.type === "sniper") {
      // Mark the projectile: sniper crits on revealed stealth targets ignore armor
      const proj = this.projectiles[this.projectiles.length - 1];
      if (target.stealth) proj.armorPiercing = true;
    }

    // ── BLACK HOLE: every 10th shot spawns a gravity well ───────────────────
    if (tower.specials?.includes("blackHole") && tower._shotCount % 10 === 0) {
      this.blackHoles.push({
        x: target.x,
        y: target.y,
        timer: 180, // 3 seconds
        radius: 100,
        strength: 3.5,
      });
      this._addFloatingText(
        target.x,
        target.y - 20,
        "🌌 BLACK HOLE!",
        "#818cf8",
      );
      this._addParticles(target.x, target.y, "#818cf8", 30);
    }

    // ── BIG CRUNCH: every 5th shot pulls ALL enemies to tower ────────────────
    if (tower.specials?.includes("bigCrunch") && tower._shotCount % 10 === 0) {
      for (const e of this.enemies) {
        if (e.isBoss) continue; // bosses only get visual shake, no setback
        const activePath = e._altPath ?? this.path;
        // Walk the enemy back ~6 path steps (≈ one full screen segment)
        const stepsBack = Math.min(6, e.pathIndex);
        if (stepsBack > 0) {
          e.pathIndex = Math.max(0, e.pathIndex - stepsBack);
          e.x = activePath[e.pathIndex].x;
          e.y = activePath[e.pathIndex].y;
          e.distanceTraveled = Math.max(
            0,
            e.distanceTraveled - stepsBack * CELL_SIZE,
          );
        }
      }
      // Keep bosses as visual-only pull
      for (const e of this.enemies) {
        if (!e.isBoss) continue;
        const dx = tower.x - e.x,
          dy = tower.y - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        e.x += (dx / dist) * 30;
        e.y += (dy / dist) * 30;
        e.x = Math.max(0, Math.min(this.canvas.width, e.x));
        e.y = Math.max(0, Math.min(this.canvas.height, e.y));
      }
      this._triggerShake(8, 12);
      this._addFloatingText(tower.x, tower.y - 30, "🌑 BIG CRUNCH!", "#818cf8");
      this._addParticles(tower.x, tower.y, "#818cf8", 50);
    }

    // ── SUPERNOVA: every 6th shot — massive burn AOE ─────────────────────────
    if (tower.specials?.includes("supernova") && tower._shotCount % 6 === 0) {
      for (const e of this.enemies) {
        const d = Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2);
        if (d <= tower.range * 2) {
          e.burnTimer = Math.max(e.burnTimer, 300);
          e.burnDmg = Math.max(e.burnDmg, tower.burnDamage * 3 || 15);
          e.burnSourceId = tower.id;
          e.burnStacks = Math.min(3, (e.burnStacks || 0) + 1);
        }
      }
      this._addParticles(tower.x, tower.y, "#ef4444", 50);
      this._addFloatingText(tower.x, tower.y - 30, "💢 SUPERNOVA!", "#ef4444");
    }

    // ── SOLAR BLIND: every 10th shot slows all enemies ───────────────────────
    if (
      tower.specials?.includes("solarBlind") &&
      tower._shotCount > 0 &&
      tower._shotCount % 10 === 0
    ) {
      // Blind = slows all enemies (no stealth targeting = effectively blinded)
      for (const e of this.enemies) {
        if (!e._solarBlindCooldown) {
          e.slowTimer = Math.max(e.slowTimer, 60); // 1s slow, was 2s
          e._solarBlindCooldown = 180; // 3s before same enemy can be re-blinded
        }
      }
      this._addFloatingText(
        this.canvas.width / 2,
        this.canvas.height / 2 - 20,
        "☀️ SOLAR FLARE!",
        "#fbbf24",
      );
      this._addParticles(
        this.canvas.width / 2,
        this.canvas.height / 2,
        "#fbbf24",
        40,
      );
    }

    // ── TWIN SHOT: sniper fires a second simultaneous shot ────────────────────
    if (tower.specials?.includes("twinShot") && tower.type === "sniper") {
      const offset = 0.12;
      const mainAng = Math.atan2(dy, dx);
      const base = this.projectiles[this.projectiles.length - 1];
      this.projectiles.push({
        ...base,
        id: Date.now() + Math.random() + 0.2,
        vx: Math.cos(mainAng + offset) * tower.projectileSpeed,
        vy: Math.sin(mainAng + offset) * tower.projectileSpeed,
        homing: true,
        targetId: target.id,
        _twinShot: true,
        _targetWasVisible: !target.stealth,
        maxTravelDist: tower.range * 1.4,
      });
    }

    // ── SALVO: second homing missile at a different target ────────────────────
    if (tower.specials?.includes("salvo")) {
      // Pick second target — best enemy that isn't the primary target
      const secondTarget =
        this.enemies
          .filter((e) => {
            if (e.id === target.id) return false;
            if (e.stealth && tower.type !== "laser") return false;
            if (e.immunities.includes(tower.type)) return false;
            return (
              Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2) <=
              tower.range
            );
          })
          .sort((a, b) => b.distanceTraveled - a.distanceTraveled)[0] || target; // fallback same target

      const dx2 = secondTarget.x - tower.x,
        dy2 = secondTarget.y - tower.y;
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
      this.projectiles.push({
        ...this.projectiles[this.projectiles.length - 1],
        id: Date.now() + Math.random() + 0.1,
        vx: (dx2 / dist2) * tower.projectileSpeed,
        vy: (dy2 / dist2) * tower.projectileSpeed,
        targetId: secondTarget.id,
        homing: true, // ensure it homes
        _isSalvo: true,
        maxTravelDist: tower.range * 1.6,
      });
    }

    // ── SMART SWARM: replace primary shot with 6 homing missiles ─────────────
    if (tower.specials?.includes("smartSwarm")) {
      const swarmCandidates = this.enemies
        .filter((e) => {
          if (e.stealth && tower.type !== "laser") return false;
          if (e.immunities.includes(tower.type)) return false;
          return (
            Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2) <=
            tower.range * 1.5
          );
        })
        .sort((a, b) => b.distanceTraveled - a.distanceTraveled)
        .slice(0, 6);

      if (swarmCandidates.length > 0) {
        this.projectiles.pop(); // remove the primary shot
        for (let si = 0; si < swarmCandidates.length; si++) {
          const st = swarmCandidates[si];
          const sdx = st.x - tower.x,
            sdy = st.y - tower.y;
          // const sdist = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
          const spread = (si - (swarmCandidates.length - 1) / 2) * 0.1;
          const ang = Math.atan2(sdy, sdx) + spread;
          this.projectiles.push({
            id: Date.now() + Math.random() + si * 0.01,
            x: tower.x,
            y: tower.y,
            vx: Math.cos(ang) * tower.projectileSpeed,
            vy: Math.sin(ang) * tower.projectileSpeed,
            damage: tower.damage * damageMult * 0.55,
            color: tower.projectileColor,
            splash: (tower.splash || 0) * 0.6,
            slowFactor: 0,
            slowDuration: 0,
            chainTargets: 0,
            chainRange: 0,
            burnDamage: 0,
            burnDuration: 0,
            armorPiercing: tower.armorPiercing || false,
            pullForce: 0,
            homing: true,
            towerId: tower.id,
            towerType: tower.type,
            targetId: st.id,
            size: 4,
            projectileSpeed: tower.projectileSpeed,
            specials: tower.specials.filter((s) => s !== "smartSwarm"),
            hasShatterSyn: false,
            _isSwarm: true,
            maxTravelDist: tower.range * 1.6,
          });
        }
      }
    }

    // ── NUCLEAR PAYLOAD: every 5th missile shot = full screen nuke blast
    tower._shotCount = (tower._shotCount || 0) + 1;
    if (
      (tower.specials?.includes("nuclearPayload") ||
        tower.specials?.includes("nuke")) &&
      tower._shotCount % (tower.specials?.includes("nuke") ? 8 : 5) === 0
    ) {
      // Nuke: deal massive AoE damage to all enemies
      setTimeout(() => {
        for (const e of this.enemies) {
          this._damageEnemy(e, tower.damage * 4, {
            towerType: tower.type,
            towerId: tower.id,
            armorPiercing: true,
            specials: [],
          });
        }
        this._triggerShake(10, 20);
        this._addFloatingText(
          this.canvas.width / 2,
          this.canvas.height / 2 - 40,
          "☢️ NUKE!",
          "#ef4444",
        );
        this._addParticles(
          this.canvas.width / 2,
          this.canvas.height / 2,
          "#ef4444",
          80,
        );
      }, 200); // slight delay for dramatic effect
    }

    // ── TIME STOP: every 5th shot freezes all enemies ────────────────────────
    if (tower.specials?.includes("timeStop") && tower._shotCount % 5 === 0) {
      for (const e of this.enemies) {
        if (!e.immunities.includes("freeze") && e.stunCooldown <= 0) {
          e.stunTimer = Math.max(e.stunTimer, e.isBoss ? 60 : 120);
          e.stunCooldown = e.isBoss ? 120 : 60;
        }
      }
      this._addFloatingText(
        this.canvas.width / 2,
        this.canvas.height / 2,
        "⏱ TIME STOP!",
        "#a5f3fc",
      );
      this._addParticles(
        this.canvas.width / 2,
        this.canvas.height / 2,
        "#a5f3fc",
        30,
      );
    }

    // store last fire angle for barrel drawing
    tower._drawAngle =
      Math.atan2(target.y - tower.y, target.x - tower.x) + Math.PI / 2;
  }

  _updateProjectiles() {
    const globalReveal = this.towers.some((t) =>
      t.specials?.includes("allReveal"),
    );
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx;
      p.y += p.vy;

      // Range cap — laser and future ranged-limit projectiles self-destruct
      if (p.maxTravelDist > 0) {
        p.travelDist =
          (p.travelDist || 0) + Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (p.travelDist > p.maxTravelDist) {
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      // homing missile
      if (p.homing) {
        let target = p.targetId
          ? this.enemies.find((e) => e.id === p.targetId)
          : null;

        if (!target) {
          // All homing projectiles re-acquire — missiles never "miss"
          // Primary missile re-targets highest HP, seekers/swarm take nearest
          const isMissile =
            p.towerType === "missile" &&
            !p._isSalvo &&
            !p._isSwarm &&
            !p._isSeeker;
          target = this.enemies
            .filter((e) => {
              if (e.stealth && p.towerType !== "laser") return false;
              if (e.immunities.includes(p.towerType)) return false;
              if (p.piercedEnemies?.has(e.id)) return false;
              return true;
            })
            .sort((a, b) =>
              isMissile
                ? b.hp - a.hp // re-acquire highest HP on target death
                : (a.x - p.x) ** 2 +
                  (a.y - p.y) ** 2 -
                  ((b.x - p.x) ** 2 + (b.y - p.y) ** 2),
            )[0];
          if (target) p.targetId = target.id;
        }

        if (target) {
          const dx = target.x - p.x,
            dy = target.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const turnRate = 0.55;
          p.vx += ((dx / dist) * p.projectileSpeed - p.vx) * turnRate;
          p.vy += ((dy / dist) * p.projectileSpeed - p.vy) * turnRate;
          const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (speed > 0) {
            p.vx = (p.vx / speed) * p.projectileSpeed;
            p.vy = (p.vy / speed) * p.projectileSpeed;
          }
        }
      }

      if (
        p.x < -20 ||
        p.x > this.canvas.width + 20 ||
        p.y < -20 ||
        p.y > this.canvas.height + 20
      ) {
        this.projectiles.splice(i, 1);
        continue;
      }

      let hit = false;
      const isPiercing =
        p.specials?.includes("pierceThrough") ||
        p.specials?.includes("fullPierce");
      if (!p.piercedEnemies) p.piercedEnemies = new Set();

      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j];

        // stealth check — fullPierce and trueDamage can hit stealth
        const canHitStealth =
          p.towerType === "laser" ||
          p.specials?.includes("fullPierce") ||
          p.specials?.includes("trueDamage") ||
          globalReveal ||
          (p.targetId === e.id && p._targetWasVisible);

        if (e.stealth && !canHitStealth) continue;
        const bypassesImmunity =
          p.specials?.includes("fullPierce") ||
          p.specials?.includes("shieldPierce") ||
          p.specials?.includes("immunityBreak");

        if (e.immunities.includes(p.towerType) && !bypassesImmunity) continue;
        if (isPiercing && p.piercedEnemies.has(e.id)) continue;

        const dx = e.x - p.x,
          dy = e.y - p.y,
          dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < e.size + p.size) {
          hit = true;
          if (isPiercing) {
            // Don't stop — record hit and continue
            p.piercedEnemies.add(e.id);
            if (p.splash > 0 || p.pullForce > 0) {
              this._dealSplashDamage(p, e);
            } else {
              this._damageEnemy(e, p.damage, p);
              if (p.chainTargets > 0)
                this._chainLightning(e, p, p.chainTargets);
            }
            // Don't break — piercing continues
          } else {
            if (p.splash > 0 || p.pullForce > 0) {
              this._dealSplashDamage(p, e);
            } else {
              this._damageEnemy(e, p.damage, p);
              if (p.chainTargets > 0)
                this._chainLightning(e, p, p.chainTargets);
            }
            // Teleport-back special
            if (p.specials?.includes("teleportBack")) {
              e.pathIndex = Math.max(0, Math.floor(this.path.length * 0.2));
              e.x = this.path[e.pathIndex].x;
              e.y = this.path[e.pathIndex].y;
              this._addFloatingText(
                e.x,
                e.y - 20,
                "TELEPORTED BACK!",
                "#818cf8",
              );
            }
            break;
          }
        }
      }
      if (hit) {
        const hitParticles =
          p.towerType === "missile"
            ? 28
            : p.towerType === "cannon"
              ? 16
              : isPiercing
                ? 2
                : 5;
        this._addParticles(p.x, p.y, p.color, hitParticles);
        if (p.towerType === "missile") this._triggerShake(3, 4);
        if (!isPiercing) this.projectiles.splice(i, 1);
      }
    }
  }

  _dealSplashDamage(p, primaryEnemy) {
    for (const se of this.enemies) {
      if (
        se.immunities.includes(p.towerType) &&
        !p.specials?.includes("fullPierce")
      )
        continue;

      const sd = Math.sqrt((se.x - p.x) ** 2 + (se.y - p.y) ** 2);
      if (sd < p.splash) {
        // Primary enemy gets full damage, surrounding enemies get falloff
        let dmg =
          se.id === primaryEnemy.id
            ? p.damage
            : p.damage * (1 - (sd / p.splash) * 0.5);

        const hasShatterSyn = this.activeSynergies.some(
          (s) => s.key === "freeze_cannon",
        );
        if (hasShatterSyn && p.towerType === "cannon" && se.slowTimer > 0)
          dmg *= 1.5;

        this._damageEnemy(se, dmg, p);

        if (p.pullForce > 0 && sd > 2) {
          if (se._gravityImmune || se.gravityImmune) {
            // Bulwark field gives half pull to gravity-immune
            const hasBulwark = this.towers.some(
              (t) =>
                t.specials?.includes("bulwarkField") &&
                Math.sqrt((t.x - p.x) ** 2 + (t.y - p.y) ** 2) <= t.range * 1.5,
            );
            if (hasBulwark) {
              // Half pull only
              const ang = Math.atan2(p.y - se.y, p.x - se.x);
              const effectivePull = p.pullForce * (1 - sd / p.splash);
              se.x += Math.cos(ang) * effectivePull * 0.5;
              se.y += Math.sin(ang) * effectivePull * 0.5;
            }
            // skip full pull
          } else {
            const ang = Math.atan2(p.y - se.y, p.x - se.x);
            const effectivePull = p.pullForce * (1 - sd / p.splash);
            se.x += Math.cos(ang) * effectivePull;
            se.y += Math.sin(ang) * effectivePull;

            // Path setback — strong pulls move enemies back on the route
            // This is what makes vortex feel impactful vs just displacing XY
            if (effectivePull >= 1.5 && !se.isBoss && se.pathIndex > 0) {
              const stepsBack = Math.min(
                Math.floor(effectivePull / 2.5),
                Math.floor(se.pathIndex * 0.25), // cap at 25% of progress
              );
              if (stepsBack > 0) {
                se.pathIndex = Math.max(0, se.pathIndex - stepsBack);
                se.x = this.path[se.pathIndex].x;
                se.y = this.path[se.pathIndex].y;
                se.distanceTraveled = Math.max(
                  0,
                  se.distanceTraveled - stepsBack * 12,
                );
              }
            }
          }
        }
      }
    }

    // ── DARK STAR DEBUFF: enemies pulled by vortex take 3× damage ────────────
    if (p.specials?.includes("darkStarDebuff") && p.pullForce > 0) {
      for (const se of this.enemies) {
        const d = Math.sqrt((se.x - p.x) ** 2 + (se.y - p.y) ** 2);
        if (d < p.splash) se._darkStarDebuffTimer = 180;
      }
    }

    // ── BURN ON SPLASH: Napalm cannon leaves burning ground zone
    if (p.specials?.includes("burnOnSplash")) {
      this.burnZones.push({
        x: p.x,
        y: p.y,
        radius: (p.splash || 65) * 0.7,
        damage: 2,
        timer: 180, // 3 seconds
        color: "#ef4444",
      });
    }

    if (p.towerType === "vortex" && p.pullForce > 0) {
      const vt = this.towers.find((t) => t.id === p.towerId);
      if (vt) vt._wavePulls = (vt._wavePulls || 0) + 1;
    }

    this._addParticles(p.x, p.y, p.color, 14);
  }

  _chainLightning(primaryEnemy, proj, remainingChains) {
    if (remainingChains <= 0) return;

    // Find nearby enemies to chain to, excluding the primary
    const chainCandidates = this.enemies
      .filter((e) => {
        if (e.id === primaryEnemy.id) return false;
        if (e.immunities.includes(proj.towerType)) return false;
        if (e.stealth && proj.towerType !== "laser") return false;
        const dx = e.x - primaryEnemy.x;
        const dy = e.y - primaryEnemy.y;
        return Math.sqrt(dx * dx + dy * dy) <= (proj.chainRange || 80);
      })
      .sort((a, b) => {
        // Prioritize closest enemies (mirrors splash falloff logic)
        const da = Math.sqrt(
          (a.x - primaryEnemy.x) ** 2 + (a.y - primaryEnemy.y) ** 2,
        );
        const db = Math.sqrt(
          (b.x - primaryEnemy.x) ** 2 + (b.y - primaryEnemy.y) ** 2,
        );
        return da - db;
      })
      .slice(0, remainingChains);

    for (const chainTarget of chainCandidates) {
      const dist = Math.sqrt(
        (chainTarget.x - primaryEnemy.x) ** 2 +
          (chainTarget.y - primaryEnemy.y) ** 2,
      );
      const chainRange = proj.chainRange || 80;

      // Mirror _dealSplashDamage falloff: damage * (1 - (dist / range) * 0.5)
      // Primary already received full damage — chain targets get falloff
      const falloff = 1 - (dist / chainRange) * 0.5;
      const chainDmg = proj.damage * Math.max(0.5, falloff); // floor at 50% like tesla's 0.7

      this._damageEnemy(chainTarget, chainDmg, {
        ...proj,
        // Prevent recursive chaining from chain hits
        chainTargets: 0,
      });

      // Visual arc bolt between hops
      this._addBolt(
        primaryEnemy.x,
        primaryEnemy.y,
        chainTarget.x,
        chainTarget.y,
        proj.color,
      );

      this._addParticles(chainTarget.x, chainTarget.y, proj.color, 3);
    }
  }

  _damageEnemy(enemy, rawDmg, proj) {
    let dmg = rawDmg;
    const effectiveXpMult = this.isEndless
      ? this.xpMult * Math.max(0.5, 1 - (this.wave - 1) * 0.005)
      : this.xpMult;

    // Dodge check (evolved fast enemies)
    if (enemy.dodgeChance && Math.random() < enemy.dodgeChance) {
      this._addFloatingText(enemy.x, enemy.y - 10, "DODGE", "#facc15");
      return;
    }

    // darkStarDebuff: 3× damage from all sources while debuffed
    if (enemy._darkStarDebuffTimer > 0) dmg *= 3;

    // Determine damage type
    const damageType = proj?.towerType
      ? TOWER_TYPES[proj.towerType]?.damageType || "physical"
      : "physical";
    const isMagical = damageType === "magical";
    const isHybrid = damageType === "hybrid";
    const isTrueDmg =
      proj?.specials?.includes("trueDamage") ||
      proj?.specials?.includes("fullPierce");

    // Armor calculation — magical bypasses most armor
    if (!proj?.armorPiercing && !isTrueDmg) {
      let effectiveArmor = enemy.armor;
      if (enemy.piercingResist) effectiveArmor *= 1 - enemy.piercingResist;
      if (isMagical)
        effectiveArmor *= 0.35; // magic largely ignores armor
      else if (isHybrid) effectiveArmor *= 0.6;
      dmg *= 1 - effectiveArmor;
    }

    // ── EXECUTE: Cremation — 4× burn damage below 20% HP ─────────────────
    if (
      proj?.specials?.includes("execute") &&
      enemy.hp / enemy.maxHp <= 0.2 &&
      proj?.burnDamage
    ) {
      // Applied by multiplying the burn damage on the enemy
      enemy.burnDmg = Math.max(enemy.burnDmg, proj.burnDamage * 4);
      enemy.burnTimer = Math.max(enemy.burnTimer, 120);
      enemy.burnSourceId = proj.towerId;
    }

    // ── SHATTER BUFF: frozen/slowed enemies take 2× damage ───────────────────
    if (!isTrueDmg) {
      const attackingTower = proj?.towerId
        ? this.towers.find((t) => t.id === proj.towerId)
        : null;
      if (
        attackingTower?.specials?.includes("shatterBuff") &&
        (enemy.slowTimer > 0 || enemy.stunTimer > 0)
      ) {
        dmg *= 2;
      }
    }

    // Type-specific resistances
    if (!isTrueDmg) {
      if (isMagical && enemy.magicalResist) dmg *= 1 - enemy.magicalResist;
      if (!isMagical && !isHybrid && enemy.physicalResist)
        dmg *= 1 - enemy.physicalResist;
    }

    // fullPierce / trueDamage can target stealth
    if (isTrueDmg && enemy.stealth) {
      // allowed to hit
    }

    // ── INSTANT FREEZE: Flash Freeze — first hit fully freezes ───────────────
    if (
      proj?.specials?.includes("instantFreeze") &&
      !enemy._flashFrozen &&
      !enemy.immunities.includes("freeze")
    ) {
      enemy.stunTimer = Math.max(enemy.stunTimer, enemy.isBoss ? 90 : 180);
      enemy.slowTimer = 0;
      enemy._flashFrozen = true; // only triggers once per enemy instance
      this._addParticles(enemy.x, enemy.y, "#a5f3fc", 20);
      this._addFloatingText(enemy.x, enemy.y - 16, "❄ FROZEN!", "#a5f3fc");
    }

    // Armor melt special
    if (proj?.specials?.includes("armorMelt") && enemy.burnTimer > 0)
      enemy.armor = Math.max(0, enemy.armor - 0.4);

    // Map bonus damage multiplier
    if (this.activeMapBonus?.type === "damage") {
      dmg *= 1 + this.activeMapBonus.value;
    }

    enemy.hp -= dmg;

    // ── Track last tower that hit for adaptive immunity ───────────────────
    if (proj?.towerType) {
      enemy._lastHitByTower = proj.towerType;
    }

    // ── IMMUNITY BREAK: tesla godstorm — strips adaptive immunity ─────────
    if (proj?.specials?.includes("immunityBreak")) {
      // Works as fullPierce — bypass all immunities
      // Also strip adaptive immunity permanently
      if (enemy._adaptiveCurrentImmunity) {
        enemy.immunities = enemy.immunities.filter(
          (i) => i !== enemy._adaptiveCurrentImmunity,
        );
        enemy._adaptiveCurrentImmunity = null;
        enemy._adaptiveTimer = 0; // reset cycle
        this._addFloatingText(
          enemy.x,
          enemy.y - 24,
          "⚡ IMMUNITY STRIPPED!",
          "#fbbf24",
        );
      }
    }

    // ── ANTI-HEAL: sniper hemorrhage — blocks all regen for 6 seconds ────
    if (proj?.specials?.includes("antiHeal")) {
      enemy._antiHealTimer = 360; // 6 seconds at 60fps
      if (!enemy._antiHealApplied) {
        enemy._antiHealApplied = true;
        this._addFloatingText(enemy.x, enemy.y - 20, "🩸 NO REGEN!", "#ef4444");
      }
    }

    // ── MIRROR SHIELD: reflect damage to nearest tower ────────────────────
    if (enemy.mutation?.apply?.mirrorShield && proj?.towerId) {
      const sourceTower = this.towers.find((t) => t.id === proj.towerId);
      if (sourceTower) {
        // ── Per-tower cooldown so rapid-fire towers aren't destroyed ─────
        sourceTower._mirrorCooldown = sourceTower._mirrorCooldown || 0;
        if (sourceTower._mirrorCooldown > 0) {
          // skip reflect this hit
        } else {
          const reflectPct = enemy.mutation.apply.mirrorShield;
          const reflectCap = enemy.mutation.apply.mirrorShieldCap || 15;
          const reflectDmg = Math.min(dmg * reflectPct, reflectCap);

          // Only reflect if tower isn't already critically damaged
          if (sourceTower.hp > sourceTower.maxHp * 0.15) {
            const resist = sourceTower.damageResist || 0;
            const actualReflect = reflectDmg * (1 - resist);

            sourceTower.hp = Math.max(
              sourceTower.maxHp * 0.1, // ← floor at 10% — never instant kill
              sourceTower.hp - actualReflect,
            );
            sourceTower.lastDamagedTick = this.tick;
            sourceTower.repairCost = Math.ceil(
              ((sourceTower.maxHp - sourceTower.hp) / sourceTower.maxHp) *
                sourceTower.cost *
                0.4,
            );
            sourceTower._mirrorCooldown =
              enemy.mutation.apply.mirrorShieldCooldown || 180;

            this._addParticles(sourceTower.x, sourceTower.y, "#a78bfa", 5);

            // Only disable if HP truly reaches 0 from direct enemy attacks,
            // never from reflection alone
            if (sourceTower.hp <= sourceTower.maxHp * 0.1) {
              this._addFloatingText(
                sourceTower.x,
                sourceTower.y - 20,
                "🪞 REFLECTED!",
                "#a78bfa",
              );
            }
          }
        }
      }
    }

    // ── LEECH: heal on tower damage ───────────────────────────────────────
    if (enemy.mutation?.apply?.leech && proj?.towerId) {
      const sourceTower = this.towers.find((t) => t.id === proj.towerId);
      if (sourceTower && sourceTower.hp < sourceTower.maxHp) {
        const healAmt = enemy.maxHp * enemy.mutation.apply.leech;
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmt);
        this._addParticles(enemy.x, enemy.y, "#4ade80", 4);
      }
    }

    // ── GRAVITY IMMUNE: ignore vortex pull ────────────────────────────────
    if (
      (enemy.gravityImmune || enemy.mutation?.apply?.gravityImmune) &&
      proj?.towerType === "vortex"
    ) {
      // Cancel the pull force by undoing position change
      // (pull is applied in _dealSplashDamage, flag checked there)
      enemy._gravityImmune = true;
    }

    // ── OMEGA RIFT: teleport enemies back 50% of path ────────────────────────
    if (proj?.specials?.includes("omegaRift")) {
      const targetIdx = Math.floor(this.path.length * 0.5);
      if (enemy.pathIndex > targetIdx) {
        enemy.pathIndex = targetIdx;
        enemy.x = this.path[targetIdx].x;
        enemy.y = this.path[targetIdx].y;
        this._addFloatingText(enemy.x, enemy.y - 20, "🌌 RIFT!", "#818cf8");
        this._addParticles(enemy.x, enemy.y, "#818cf8", 20);
      }
    }

    // ── CLUSTER SHOT: cannon — spawn 3 mini projectiles on impact ────────────
    if (
      proj?.specials?.includes("clusterShot") &&
      !proj._isCluster &&
      !proj._clusterFired
    ) {
      proj._clusterFired = true;
      // Target enemies NOT already in the primary splash zone — spreads damage out
      const baseDamage = proj._baseTowerDamage ?? proj.damage;
      const nearby = this.enemies
        .filter((e) => e.id !== enemy.id)
        .sort((a, b) => {
          // Sort by FURTHEST first — shards hunt enemies the splash didn't reach
          const da = (a.x - enemy.x) ** 2 + (a.y - enemy.y) ** 2;
          const db = (b.x - enemy.x) ** 2 + (b.y - enemy.y) ** 2;
          return db - da; // ← reversed: furthest first
        })
        .slice(0, 3);
      for (const t of nearby) {
        const dx = t.x - enemy.x,
          dy = t.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        this.projectiles.push({
          id: Date.now() + Math.random(),
          x: enemy.x,
          y: enemy.y,
          vx: (dx / dist) * (proj.projectileSpeed || 5),
          vy: (dy / dist) * (proj.projectileSpeed || 5),
          damage: baseDamage * 0.2, // 20% of BASE tower damage, no buff stacking
          splash: 0, // no splash — precision strike only
          color: proj.color,
          size: 3,
          towerType: proj.towerType,
          towerId: proj.towerId,
          armorPiercing: false,
          projectileSpeed: (proj.projectileSpeed || 5) * 1.4, // faster than original
          slowFactor: 0,
          slowDuration: 0,
          chainTargets: 0,
          burnDamage: 0,
          burnDuration: 0,
          pullForce: 0,
          homing: true, // homes in so it actually hits
          targetId: t.id,
          _isCluster: true,
          specials: [],
          hasShatterSyn: proj.hasShatterSyn,
          piercedEnemies: new Set(),
          maxTravelDist: 180,
        });
      }
    }

    // ── CLUSTER WARHEAD: missile splits into 4 homing shards on impact ────────
    if (proj?.specials?.includes("clusterWarhead") && !proj._isWarheadShard) {
      const shardCount = 4;
      const shardBlastRadius = proj.splash || 100;

      const candidates = this.enemies
        .filter((e) => {
          if (e.id === enemy.id) return false;
          if (e.immunities.includes("missile")) return false;
          const d = Math.sqrt((e.x - enemy.x) ** 2 + (e.y - enemy.y) ** 2);
          return d < shardBlastRadius;
        })
        .sort((a, b) => {
          const da = (a.x - enemy.x) ** 2 + (a.y - enemy.y) ** 2;
          const db = (b.x - enemy.x) ** 2 + (b.y - enemy.y) ** 2;
          return da - db;
        })
        .slice(0, shardCount);

      for (let i = 0; i < shardCount; i++) {
        const shardTarget = candidates[i] || null;
        const baseAngle = Math.atan2(proj.vy, proj.vx);
        const spreadAngle = baseAngle + (i - (shardCount - 1) / 2) * 0.45;
        const spd = (proj.projectileSpeed || 2.8) * 1.4;
        this.projectiles.push({
          ...proj,
          id: Date.now() + Math.random() + i * 0.01,
          x: enemy.x,
          y: enemy.y,
          vx: Math.cos(spreadAngle) * spd,
          vy: Math.sin(spreadAngle) * spd,
          targetId: shardTarget?.id || null,
          homing: !!shardTarget,
          projectileSpeed: spd,
          damage: proj.damage * 0.25,
          splash: 0,
          _isWarheadShard: true,
          specials: [],
          maxTravelDist: 200,
          travelDist: 0,
        });
      }
      this._addParticles(enemy.x, enemy.y, proj.color, 20);
    }

    if (enemy.isBoss && proj?.towerId) {
      const t = this.towers.find((t) => t.id === proj.towerId);
      if (t) t._hitBoss = true;
    }

    if (enemy.isBoss && dmg > 50) this._triggerShake(4, 5);

    if (proj?.slowDuration && !enemy.immunities.includes(proj.towerType)) {
      enemy.slowTimer = proj.slowDuration;
      if (proj.towerType === "freeze") {
        const freezeTower = this.towers.find((t) => t.id === proj.towerId);
        if (freezeTower) {
          freezeTower._waveSlowHits = (freezeTower._waveSlowHits || 0) + 1;
          freezeTower.xp += 0.3 * effectiveXpMult;
          this._checkTowerProgression(freezeTower, this.wave);
        }
      }
    }

    if (proj?.specials?.includes("stunOnHit")) {
      if (enemy.stunCooldown <= 0) {
        if (!enemy.isBoss) {
          enemy.stunTimer = 20; // shorter stun
          enemy.stunCooldown = 60; // 1s immunity
        } else if (!enemy.stunImmunity) {
          enemy.stunTimer = 30;
          enemy.stunCooldown = 120; // bosses harder to chain
        }
      }
      if (proj?.towerId) enemy.assistTowers?.add(proj.towerId);
    }

    if (proj?.burnDamage && proj?.burnDuration) {
      enemy.burnTimer = proj.burnDuration;
      enemy.burnDmg = proj.burnDamage;
      enemy.burnSourceId = proj.towerId; // ← track who applied the burn
      if (proj.specials?.includes("burnStack"))
        enemy.burnStacks = Math.min(3, (enemy.burnStacks || 0) + 1);
    }

    const tt = proj?.towerType;
    if (tt) {
      this.waveDamageByTower[tt] = (this.waveDamageByTower[tt] || 0) + dmg;
      const tower = this.towers.find((t) => t.id === proj.towerId);
      if (tower) {
        tower.totalDamage += dmg;

        tower._waveHits = tower._waveHits || new Set();
        tower._waveHits.add(enemy.id);
      }
    }

    // ── AREA FREEZE: Nova — slow all nearby enemies on hit ───────────────────
    if (proj?.specials?.includes("areaFreeze") && proj.towerType === "freeze") {
      const aoeRadius = 80;
      for (const e of this.enemies) {
        if (e.id === enemy.id) continue;
        if (e.immunities.includes("freeze")) continue;
        const d = Math.sqrt((e.x - enemy.x) ** 2 + (e.y - enemy.y) ** 2);
        if (d < aoeRadius) e.slowTimer = Math.max(e.slowTimer, 90);
      }
      this._addParticles(enemy.x, enemy.y, "#a5f3fc", 18);
    }

    // ── FULL FREEZE: Absolute — fully stop enemy on hit ──────────────────────
    if (
      proj?.specials?.includes("fullFreeze") &&
      !enemy.immunities.includes("freeze")
    ) {
      enemy.stunTimer = Math.max(enemy.stunTimer, enemy.isBoss ? 60 : 120);
      enemy.slowTimer = 0;
      this._addParticles(enemy.x, enemy.y, "#a5f3fc", 12);
    }

    // ── AREA IGNITE: Floodfire — ignite all nearby on hit ────────────────────
    if (proj?.specials?.includes("areaIgnite")) {
      const igRadius = 70;
      const burnTower = proj.towerId
        ? this.towers.find((t) => t.id === proj.towerId)
        : null;
      for (const e of this.enemies) {
        if (e.id === enemy.id) continue;
        const d = Math.sqrt((e.x - enemy.x) ** 2 + (e.y - enemy.y) ** 2);
        if (d < igRadius) {
          e.burnTimer = Math.max(e.burnTimer, 120);
          e.burnDmg = burnTower ? burnTower.burnDamage : 3;
          e.burnSourceId = proj.towerId;
        }
      }
      this._addParticles(enemy.x, enemy.y, "#ef4444", 15);
    }

    // ── VOID BURST: Antimatter — delayed void explosion ──────────────────────
    if (proj?.specials?.includes("voidBurst") && !proj._isVoidBurst) {
      const bx = enemy.x;
      const by = enemy.y;

      // store values now so delayed burst won't depend on mutated projectile state
      const burstDamage = proj.damage * 2;
      const burstTowerId = proj.towerId;

      // 90 frames @ 60fps ≈ 1.5 seconds
      const delayFrames = 90;
      const delayMs = (delayFrames / 60) * 1000;

      setTimeout(() => {
        // prevent delayed effects after wave/game ended
        if (this.state !== "wave") return;

        for (const ve of this.enemies) {
          const dx = ve.x - bx;
          const dy = ve.y - by;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 120) {
            this._damageEnemy(ve, burstDamage, {
              ...proj,

              // important overrides
              damage: burstDamage,
              towerType: "sniper",
              towerId: burstTowerId,

              // prevent recursive bursts
              _isVoidBurst: true,

              // special behavior
              armorPiercing: true,

              // prevent re-triggering other specials
              specials: [],
            });
          }
        }

        // visuals
        this._addParticles(bx, by, "#7c3aed", 40);
        this._triggerShake(5, 8);
        this._addFloatingText(bx, by - 20, "💫 VOID BURST!", "#818cf8");
      }, delayMs);
    }

    // ── Special: quakeStun — cannon stuns all enemies in splash range ─────────
    if (proj?.specials?.includes("quakeStun") && proj.splash > 0) {
      for (const se of this.enemies) {
        const sd = Math.sqrt((se.x - proj.x) ** 2 + (se.y - proj.y) ** 2);
        if (sd < proj.splash * 1.4 && se.stunCooldown <= 0) {
          se.stunTimer = 30;
          se.stunCooldown = 90;
        }
      }
    }

    // ── Special: bulletChain — basic Overwatch bounces to nearest enemy ───────
    if (
      proj?.specials?.includes("bulletChain") &&
      (proj._chainBounces || 0) < 3
    ) {
      const nearest = this.enemies
        .filter((e) => e.id !== enemy.id && !e.stealth)
        .sort((a, b) => {
          const da = Math.sqrt((a.x - enemy.x) ** 2 + (a.y - enemy.y) ** 2);
          const db = Math.sqrt((b.x - enemy.x) ** 2 + (b.y - enemy.y) ** 2);
          return da - db;
        })[0];
      if (nearest) {
        const dx = nearest.x - enemy.x,
          dy = nearest.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        this.projectiles.push({
          ...proj,
          id: Date.now() + Math.random(),
          x: enemy.x,
          y: enemy.y,
          vx: (dx / dist) * proj.projectileSpeed,
          vy: (dy / dist) * proj.projectileSpeed,
          targetId: nearest.id,
          _chainBounces: (proj._chainBounces || 0) + 1,
          damage: proj.damage * 0.7,
          maxTravelDist: 120,
        });
      }
    }

    // ── Special: seekerChain — missile seeks 2 more enemies after impact ─────
    if (
      proj?.specials?.includes("seekerChain") &&
      !proj._isSeeker &&
      !proj._seekerFired
    ) {
      proj._seekerFired = true;
      const targets = this.enemies
        .filter((e) => e.id !== enemy.id)
        .sort((a, b) => {
          const da = Math.sqrt((a.x - enemy.x) ** 2 + (a.y - enemy.y) ** 2);
          const db = Math.sqrt((b.x - enemy.x) ** 2 + (b.y - enemy.y) ** 2);
          return da - db;
        })
        .slice(0, 2);
      for (const t of targets) {
        const dx = t.x - enemy.x,
          dy = t.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        this.projectiles.push({
          id: Date.now() + Math.random(),
          x: enemy.x,
          y: enemy.y,
          originX: enemy.x,
          originY: enemy.y,
          vx: (dx / dist) * proj.projectileSpeed,
          vy: (dy / dist) * proj.projectileSpeed,
          targetId: t.id,
          homing: true,
          _isSeeker: true,
          damage:
            Math.min(proj.damage, proj._baseTowerDamage ?? proj.damage) * 0.55,
          splash: (proj.splash || 0) * 0.5,
          color: "#ff9999",
          projectileColor: "#ff9999",
          projectileSpeed: proj.projectileSpeed,
          armorPiercing: proj.armorPiercing || false,
          towerType: proj.towerType,
          towerId: proj.towerId,
          size: proj.size || 4,
          specials: [],
          hasShatterSyn: proj.hasShatterSyn || false,
          piercedEnemies: new Set(),
          maxTravelDist: 280,
          travelDist: 0,
        });

        if (targets.length > 0) {
          this._addFloatingText(
            enemy.x,
            enemy.y - 20,
            `↗ ${targets.length} SEEKERS`,
            "#f43f5e",
          );
        }
      }
    }

    if (enemy.hp <= 0) this._killEnemy(enemy, proj?.towerType, proj?.towerId);
  }

  _checkTowerProgression(tower, currentWave) {
    const upgDef = TOWER_UPGRADES[tower.type];
    if (!upgDef) return;
    const wasReady = tower.upgradeReady;

    // ONE passive per call — break prevents multi-tier jumps on large XP bursts
    for (const passive of upgDef.passives) {
      if (passive.tier <= tower.passiveTier) continue;
      if (tower.xp < passive.xp) continue;
      if (passive.mult !== undefined) {
        if (passive.stat === "fireRate")
          tower.fireRate = Math.max(
            1,
            Math.round(tower.fireRate * (1 + passive.mult)),
          );
        else if (passive.stat === "chainTargets")
          tower.chainTargets = (tower.chainTargets || 0) + (passive.flat || 0);
        else tower[passive.stat] *= 1 + passive.mult;
      }
      if (passive.flat !== undefined && passive.stat !== "chainTargets") {
        tower[passive.stat] = (tower[passive.stat] || 0) + passive.flat;
      }
      if (passive.stat === "chainTargets" && passive.flat) {
        tower.chainTargets = (tower.chainTargets || 0) + passive.flat;
      }
      tower.passiveTier = passive.tier;
      this._addFloatingText(tower.x, tower.y - 20, passive.label, "#38bdf8");
      break; // ← ONE passive per call
    }

    const s5 = upgDef.skill5;
    if (tower.passiveTier >= 4 && !tower.skill5chosen && tower.xp >= s5.xp) {
      tower.upgradeReady = true;
      tower.upgradeReadyType = "skill5";
    }
    const s10 = upgDef.skill10;
    if (
      tower.skill5chosen &&
      tower.passiveTier >= 9 &&
      !tower.skill10chosen &&
      tower.xp >= s10.xp
    ) {
      tower.upgradeReady = true;
      tower.upgradeReadyType = "skill10";
    }
    const l50 = upgDef.legendary50;
    if (
      l50 &&
      currentWave >= l50.unlocksAtWave &&
      tower.skill10chosen &&
      !tower.legendaryUnlocked
    ) {
      tower.upgradeReady = true;
      tower.upgradeReadyType = "legendary50";
    }
    const l100 = upgDef.legendary100;
    if (
      l100 &&
      currentWave >= l100.unlocksAtWave &&
      tower.legendaryUnlocked &&
      !tower.legendary100Unlocked
    ) {
      tower.upgradeReady = true;
      tower.upgradeReadyType = "legendary100";
    }
    if (!wasReady && tower.upgradeReady) this._emitState();
  }

  _killEnemy(enemy, towerType, towerId) {
    const idx = this.enemies.indexOf(enemy);
    if (idx === -1) return;

    const effectiveXpMult = this.isEndless
      ? this.xpMult * Math.max(0.5, 1 - (this.wave - 1) * 0.005)
      : this.xpMult;

    // streak
    this._streakWindow = 180;
    this._streakCount++;
    this._streakTimer = 90;

    // ── EXECUTE: reset berserker stacks on kill ───────────────────────────
    const killerTower = this.towers.find((t) => t.id === towerId);
    if (
      killerTower?.specials?.includes("execute") &&
      enemy._berserkerStacks > 0
    ) {
      enemy._berserkerStacks = 0;
      this._addFloatingText(
        enemy.x,
        enemy.y - 20,
        "💀 BERSERKER RESET!",
        "#ef4444",
      );
    }

    // Gold bonus every 5 kills in streak
    if (this._streakCount >= 5 && this._streakCount % 5 === 0) {
      const streakBonus = Math.min(
        4 + Math.floor(this._streakCount / 5) * 4,
        40,
      );
      this.gold += streakBonus;
      this._addFloatingText(
        enemy.x,
        enemy.y - 32,
        `🔥 ${this._streakCount} STREAK  +${streakBonus}g`,
        "#fbbf24",
      );
    }

    this.gold += enemy.reward;
    this.score += Math.floor(enemy.reward * this.wave * (enemy.isBoss ? 5 : 1));
    this.waveKills++;

    this.runStats.totalKills++;

    // Record for enemy evolution system
    if (towerType && !enemy.isBoss) {
      this.waveAI.recordEnemyKill(towerType, enemy.type);
    }

    this.runStats.maxGoldAtOnce = Math.max(
      this.runStats.maxGoldAtOnce,
      this.gold + enemy.reward,
    );
    if (enemy.isBoss) {
      this.runStats.bossKills++;
      if (enemy.mutation) {
        this.runStats.mutatedBossKills++;
        this._unlockAchievement("mutation_slayer");
      }
      this._unlockAchievement("boss_slayer");
    }

    if (enemy.isBoss) {
      this.waveAI.recordBossResult(enemy.type, true, towerType);
      this._triggerBossLoot(enemy);
    }

    // ── Assist XP — support towers that tagged this enemy get a kill bonus ──
    if (enemy.assistTowers?.size > 0) {
      for (const assistId of enemy.assistTowers) {
        if (assistId === towerId) continue;
        const assistTower = this.towers.find((t) => t.id === assistId);
        if (!assistTower) continue;
        const assistXp = _calcAssistXp(assistTower, enemy);
        assistTower.xp += assistXp * effectiveXpMult;
        this._checkTowerProgression(assistTower, this.wave);
      }
    }

    // ── Killer tower XP ───────────────────────────────────────────────────────
    const tower = this.towers.find((t) => t.id === towerId);
    if (tower) {
      tower.kills++;
      // Role-based kill XP
      const killXp = _calcKillXp(tower, enemy);
      tower.xp += killXp * effectiveXpMult;
      this._checkTowerProgression(tower, this.wave);
    }

    this._addParticles(enemy.x, enemy.y, enemy.color, enemy.isBoss ? 35 : 10);
    this._addFloatingText(
      enemy.x,
      enemy.y - 12,
      `+${enemy.reward}g${enemy.isBoss ? " 💀" : ""}`,
      enemy.isBoss ? "#ff4444" : "#facc15",
    );

    if (enemy.spawnsOnDeath && enemy.spawnCount > 0)
      for (let i = 0; i < enemy.spawnCount; i++)
        this._spawnChildAt(enemy, enemy.spawnsOnDeath);

    // ── SPLINTER: split into copies on death ─────────────────────────────
    if (enemy.mutation?.apply?.splinterDeath && enemy.isBoss) {
      const count = enemy.mutation.apply.splinterCount || 3;
      const hpFrac = enemy.mutation.apply.splinterHpFraction || 0.3;
      for (let si = 0; si < count; si++) {
        const splinter = {
          ...enemy,
          id: Date.now() + Math.random() + si,
          hp: enemy.maxHp * hpFrac,
          maxHp: enemy.maxHp * hpFrac,
          size: enemy.size * 0.65,
          x: enemy.x + (Math.random() - 0.5) * 30,
          y: enemy.y + (Math.random() - 0.5) * 30,
          mutation: null, // splinters don't inherit mutation
          twinSpawned: true,
          isSplinter: true,
          reward: Math.floor(enemy.reward * 0.3),
          slowTimer: 0,
          stunTimer: 0,
          burnTimer: 0,
          assistTowers: new Set(),
          _berserkerStacks: 0,
          _voidStepTimer: 0,
        };
        this.enemies.push(splinter);
      }
      this._addFloatingText(
        enemy.x,
        enemy.y - 30,
        `💥 SPLINTER ×${count}!`,
        "#ef4444",
      );
      this._addParticles(enemy.x, enemy.y, enemy.color, 40);
    }

    // ── ICE AGE: on kill freeze all nearby enemies 3s ────────────────────────
    const hasIceAge = this.towers.some((t) => t.specials?.includes("iceAge"));
    if (hasIceAge && !enemy.isBoss) {
      for (const other of this.enemies) {
        const d = Math.sqrt(
          (other.x - enemy.x) ** 2 + (other.y - enemy.y) ** 2,
        );
        if (d < 100 && !other.immunities.includes("freeze")) {
          other.stunTimer = Math.max(other.stunTimer, 180);
        }
      }
      this._addParticles(enemy.x, enemy.y, "#a5f3fc", 18);
    }

    // ── DEATH IGNITE: Phoenix Core — killed enemy ignites neighbors ──────────
    const hasDeathIgnite = this.towers.some((t) =>
      t.specials?.includes("deathIgnite"),
    );
    if (hasDeathIgnite && !enemy.isBoss) {
      const ignRadius = 60;
      for (const other of this.enemies) {
        const d = Math.sqrt(
          (other.x - enemy.x) ** 2 + (other.y - enemy.y) ** 2,
        );
        if (d < ignRadius && d > 0) {
          other.burnTimer = Math.max(other.burnTimer, 120);
          other.burnDmg = Math.max(other.burnDmg, 4);
        }
      }
      this._addParticles(enemy.x, enemy.y, "#ef4444", 20);
    }

    this.enemies.splice(idx, 1);
    this._emitState();
  }

  _triggerBossLoot(boss) {
    const loot = boss.lootDrop;
    if (!loot) return;
    if (loot.type === "speed_boost") {
      this.globalBuff = {
        fireRateMult: 0.5,
        damageMult: 1,
        timer: loot.duration,
        label: loot.label,
      };
    }
    if (loot.type === "damage_boost") {
      this.globalBuff = {
        fireRateMult: 1,
        damageMult: 2,
        timer: loot.duration,
        label: loot.label,
      };
    }
    if (loot.type === "gold_shower") {
      this.gold += loot.amount;
      this._addFloatingText(
        boss.x,
        boss.y - 30,
        `+${loot.amount}g 💰`,
        "#facc15",
      );
    }
    if (loot.type === "lives_restore") {
      this.lives = Math.min(
        this.levelConfig.startLives,
        this.lives + loot.amount,
      );
      this._addFloatingText(
        boss.x,
        boss.y - 30,
        `+${loot.amount} ❤️`,
        "#4ade80",
      );
      this._checkLastStand();
    }
    this._addFloatingText(
      this.canvas.width / 2,
      80,
      `🎁 BOSS LOOT: ${loot.label}`,
      "#fbbf24",
    );
  }

  _addParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2,
        s = Math.random() * 3.5 + 1;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 35 + Math.random() * 20,
        maxLife: 55,
        color,
        size: Math.random() * 3 + 1,
      });
    }
  }

  _addFloatingText(x, y, text, color) {
    this.floatingTexts.push({ x, y, text, color, life: 75, vy: -0.85 });
  }

  _updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.life--;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i];
      t.y += t.vy;
      t.life--;
      if (t.life <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  _checkWaveComplete() {
    this._checkLastStand();
    if (this.state !== "wave") return;
    if (this.spawnQueue.length > 0 || this.enemies.length > 0) return;

    // Wave-end XP pass
    const waveXpBudget = 100 + this.wave * 8;
    this._grantWaveEndXp(waveXpBudget);

    this._incomingModifier = null;
    if ((this.wave + 1) % 10 === 0) {
      this._incomingModifier = this._weightedRandomModifier();
    }

    // Clear in-flight projectiles — prevents carry-over into next wave
    this.projectiles = [];
    this.boltEffects = [];

    // Clean up dual-front camp when wave ends
    if (this.secondSpawnCamp) {
      this.spawnCamps = this.spawnCamps.filter(
        (c) => c !== this.secondSpawnCamp,
      );
      this.secondSpawnCamp = null;
      this._secondPath = null;
      this._secondPathCells = new Set();
    }

    this.state = "idle";

    // Partial auto-repair between waves (20% HP restored, re-enable disabled)
    for (const tower of this.towers) {
      const healed = tower.maxHp * 0.2;
      tower.hp = Math.min(tower.maxHp, tower.hp + healed);
      tower.repairCost = Math.ceil(
        ((tower.maxHp - tower.hp) / tower.maxHp) * tower.cost * 0.4,
      );
      if (tower.disabled && tower.hp > tower.maxHp * 0.15) {
        tower.disabled = false;
        this._addFloatingText(tower.x, tower.y - 20, "↑ Repaired", "#4ade80");
      }
    }

    const clearTime = Math.round((this.tick - this._waveStartTick) / 60);
    this.lastWaveClearTime = clearTime;
    if (clearTime < this.fastestWaveClear) this.fastestWaveClear = clearTime;

    // Speed bonus — clear under 20 seconds = extra gold
    if (clearTime > 0 && clearTime < 20 && this.wave > 2) {
      const speedBonus = Math.floor(Math.max(0, 20 - clearTime) * 2.5);
      if (speedBonus > 0) {
        this.gold += speedBonus;
        this._addFloatingText(
          this.canvas.width / 2,
          this.canvas.height / 2 - 30,
          `⚡ Speed bonus +${speedBonus}g!`,
          "#38bdf8",
        );
      }
    }

    this.waveAI.recordWaveResults({
      enemiesKilled: this.waveKills,
      enemiesLeaked: this.waveLeaks,
      damageByTower: { ...this.waveDamageByTower },
      goldSpent: this.waveGoldSpent,
      wave: this.wave,
    });

    // Run stats
    this.runStats.totalLeaks += this.waveLeaks;
    if (this.waveLeaks === 0) {
      this.runStats.wavesNoLeak = (this.runStats.wavesNoLeak || 0) + 1;
      this._unlockAchievement("no_leak");
    }

    // Clear modifier
    this.activeModifier = null;
    this.silencedTowerType = null;
    this._eliteSpawnedCount = 0;

    const bonus = ECFG.waveClearBonus + Math.sqrt(this.wave) * 15;
    this.gold += bonus;
    this.runStats.goldEarned = (this.runStats.goldEarned || 0) + bonus;
    this._addFloatingText(
      this.canvas.width / 2,
      this.canvas.height / 2,
      `Wave ${this.wave} Clear! +${Math.floor(bonus)}g`,
      "#4ade80",
    );
    this.minRequiredTowers = this.waveAI.calcMinimumRequiredTowers(
      this.wave + 1,
      this.levelConfig,
    );

    // Check achievements
    this._checkAchievements();

    if (!this.isEndless && this.wave >= this.levelConfig.waves) {
      this.state = "victory";
      this.waveAI.finalizeGame(true);
      if (this.lives === this.levelConfig.startLives)
        this._unlockAchievement("perfect_run");
    }
    this._emitState();
  }

  _unlockAchievement(id) {
    if (!ACHIEVEMENTS[id]) return;
    if (this._runAchievements.includes(id)) return;
    this._runAchievements.push(id);
    this._newAchievementId = id;
    this._emitState();
    // Clear the new-achievement signal after a beat so it doesn't retrigger
    setTimeout(() => {
      this._newAchievementId = null;
    }, 100);
  }

  _checkAchievements() {
    if (this.wave >= 1) this._unlockAchievement("first_wave");
    if (this.wave >= 25) this._unlockAchievement("wave_25");
    if (this.wave >= 50) this._unlockAchievement("wave_50");
    if (this.activeModifier || this.runStats.modifiersFaced.length > 0)
      this._unlockAchievement("modifier_survive");
    if (this.gold >= 2000) this._unlockAchievement("gold_hoarder");
    if (this.activeSynergies.length >= 3) this._unlockAchievement("synergist");
  }

  _grantWaveEndXp(budget) {
    const effectiveXpMult = this.isEndless
      ? this.xpMult * Math.max(0.5, 1 - (this.wave - 1) * 0.005)
      : this.xpMult;

    for (const tower of this.towers) {
      let xp = 0;
      const role = TOWER_TYPES[tower.type]?.category;

      if (role === "attack") {
        // Kills * flat rate, capped at budget/towerCount
        const killShare = Math.min(tower.kills, 40);
        xp = killShare * 1.2;
      } else if (role === "support") {
        if (tower.type === "freeze") {
          // XP for unique enemies slowed this wave
          const slowHits = Math.min(tower._waveSlowHits || 0, 60);
          xp = slowHits * 0.8;
        } else if (tower.type === "vortex") {
          // XP for pulls executed this wave
          const pulls = Math.min(tower._wavePulls || 0, 80);
          xp = pulls * 0.5;
        }
      } else if (role === "tech") {
        if (tower.type === "laser") {
          // XP for unique enemies hit (coverage, not overkill)
          const uniqueHits = Math.min(tower._waveHits?.size || 0, 50);
          xp = uniqueHits * 1.0;
        } else if (tower.type === "tesla") {
          // XP for unique enemies chained to
          const uniqueHits = Math.min(tower._waveHits?.size || 0, 40);
          xp = uniqueHits * 1.1;
        }
      }

      // Boss participation bonus — flat, not damage-scaled
      if (tower._hitBoss) xp += 18;

      // Normalize against budget so no single tower hogs XP
      const maxPerTower = budget / Math.max(1, this.towers.length * 0.6);
      xp = Math.min(xp, maxPerTower);

      tower.xp += xp * effectiveXpMult;
      this._checkTowerProgression(tower, this.wave);

      // Reset wave trackers
      tower._waveHits = new Set();
      tower._waveSlowHits = 0;
      tower._wavePulls = 0;
      tower._hitBoss = false;
    }
  }

  fortify() {
    if (this.state !== "idle") return false;
    const cost = this.fortifyCost;
    if (this.gold < cost) return false;
    if (this.fortifyLevel >= ECFG.maxFortifyLevel) return false;

    this.gold -= cost;
    this.fortifyLevel++;
    this.fortifyCost += ECFG.fortifyCostPerPurchase;

    // Each fortify gives all towers a small permanent dmg boost
    for (const tower of this.towers) {
      tower.damage *= 1.08;
    }

    this._addFloatingText(
      this.canvas.width / 2,
      this.canvas.height / 2 - 30,
      `🏰 Fortify Lv${this.fortifyLevel}! All towers +8% dmg`,
      "#fbbf24",
    );
    this._emitState();
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  DRAWING
  // ══════════════════════════════════════════════════════════════════════════════
  _draw() {
    const ctx = this.ctx;

    const skinMapTheme = this.activeSkin?.maps?.[this._currentMapKey];
    const theme = skinMapTheme
      ? { ...this.mapDef.theme, ...skinMapTheme }
      : this.mapDef.theme;

    const W = this.canvas.width,
      H = this.canvas.height;

    // ── Screen shake ──────────────────────────────────────────────────────────
    ctx.save();
    if (this.shake.frames > 0) {
      this.shake.frames--;
      this.shake.x = (Math.random() - 0.5) * this.shake.intensity;
      this.shake.y = (Math.random() - 0.5) * this.shake.intensity;
    } else {
      this.shake.x = 0;
      this.shake.y = 0;
    }
    ctx.translate(this.shake.x, this.shake.y);

    ctx.clearRect(-10, -10, W + 20, H + 20);

    // ── Background grid with scanlines ───────────────────────────────────────
    const mapStyle = this.activeSkin?.mapStyle || "neon";

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const isPath = this._isPathCell(col, row);
        const isSecondPath = this._secondPathCells?.has(`${col},${row}`);
        const x = col * CELL_SIZE,
          y = row * CELL_SIZE;

        if (isPath || isSecondPath) {
          // Path base
          ctx.fillStyle =
            isSecondPath && !isPath
              ? _blendColor(theme.path, "#4ade80", 0.15)
              : theme.path;
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          // subtle path glow
          ctx.fillStyle = "rgba(255,255,255,0.03)";
          ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);

          _drawPathCell(ctx, x, y, CELL_SIZE, mapStyle, theme, this.tick);
        } else {
          // Ground base — checkerboard
          ctx.fillStyle =
            (row + col) % 2 === 0 ? theme.bg : _shadeColor(theme.bg, 8);
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          _drawGroundCell(
            ctx,
            x,
            y,
            CELL_SIZE,
            mapStyle,
            theme,
            row,
            col,
            this.tick,
          );
        }
        // thin grid lines
        ctx.strokeStyle = isPath ? theme.pathBorder : "rgba(255,255,255,0.03)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      }
    }

    // scanline overlay — every 2 rows, faint dark line
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

    // ── Path direction arrows ─────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = theme.pathBorder;
    ctx.lineWidth = 1;
    for (let i = 0; i < this.path.length - 5; i += 10) {
      const a = this.path[i],
        b = this.path[Math.min(i + 5, this.path.length - 1)];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 0);
      ctx.lineTo(2, -3);
      ctx.moveTo(4, 0);
      ctx.lineTo(2, 3);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // ── Second path arrows (dual front) ────────────────────────────────────
    if (this._secondPath?.length > 1) {
      ctx.save();
      ctx.strokeStyle = "#4ade80"; // green to distinguish from main path
      ctx.lineWidth = 1;
      for (let i = 0; i < this._secondPath.length - 5; i += 10) {
        const a = this._secondPath[i];
        const b =
          this._secondPath[Math.min(i + 5, this._secondPath.length - 1)];
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(ang);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(-4, 0);
        ctx.lineTo(4, 0);
        ctx.lineTo(2, -3);
        ctx.moveTo(4, 0);
        ctx.lineTo(2, 3);
        ctx.stroke();
        ctx.restore();
      }
      // Entry point marker
      const entry = this._secondPath[0];
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this.tick * 0.1));
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(entry.x, entry.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⚠ 2ND FRONT", entry.x, entry.y - 22);
      ctx.restore();
    }

    // ── Spawn camps + Kingdom ─────────────────────────────────────────────
    for (const camp of this.spawnCamps) camp.draw(ctx, this.tick);
    if (this.kingdom) {
      const hpFrac = Math.max(0, this.lives / this.levelConfig.startLives);
      this.kingdom.draw(ctx, hpFrac, this.tick);
    }

    // ── Last-stand pulsing border ─────────────────────────────────────────────
    if (this.lastStandActive) {
      const alpha = 0.3 + 0.3 * Math.sin(this.tick * 0.2);
      ctx.strokeStyle = `rgba(239,68,68,${alpha})`;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, W - 8, H - 8);
    }

    // ── Wave modifier banner ──────────────────────────────────────────────────
    if (this.activeModifier) {
      const mod = this.activeModifier;
      const typeColor =
        mod.type === "buff"
          ? "#4ade80"
          : mod.type === "debuff"
            ? "#ef4444"
            : "#818cf8";
      ctx.fillStyle =
        mod.type === "buff"
          ? "rgba(74,222,128,0.12)"
          : mod.type === "debuff"
            ? "rgba(239,68,68,0.12)"
            : "rgba(129,140,248,0.12)";
      ctx.fillRect(0, 0, W, 30);
      ctx.fillStyle = typeColor;
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`${mod.icon} ${mod.name.toUpperCase()}: ${mod.desc}`, 8, 15);
      if (this.silencedTowerType) {
        const tDef = TOWER_TYPES[this.silencedTowerType];
        ctx.fillStyle = "#ef4444";
        ctx.textAlign = "right";
        ctx.fillText(
          `🔇 ${tDef?.name || this.silencedTowerType} SILENCED`,
          W - 8,
          15,
        );
      }
      ctx.textBaseline = "alphabetic";
    }

    // ── Streak display ────────────────────────────────────────────────────────
    if (this._streakCount >= 5) {
      const alpha = Math.min(1, this._streakTimer / 30);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#fbbf24";
      ctx.font = `bold ${14 + Math.min(this._streakCount, 20)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`🔥 ${this._streakCount} STREAK!`, W / 2, H / 2 - 60);
      ctx.globalAlpha = 1;
      ctx.textBaseline = "alphabetic";
    }

    // ── Global buff banner ────────────────────────────────────────────────────
    if (this.globalBuff.timer > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, 26);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `${this.globalBuff.label}  [${Math.ceil(this.globalBuff.timer / 60)}s]`,
        W / 2,
        13,
      );
    }

    // ── Hover highlight ───────────────────────────────────────────────────────
    if (this.hoveredCell && !["gameover", "victory"].includes(this.state)) {
      const { col, row } = this.hoveredCell;
      const check = this.canPlaceTower(col, row, this.selectedTowerType);
      const cx = col * CELL_SIZE + CELL_SIZE / 2,
        cy = row * CELL_SIZE + CELL_SIZE / 2;
      ctx.fillStyle = check.ok
        ? "rgba(74,222,128,0.15)"
        : "rgba(239,68,68,0.12)";
      ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      if (check.ok) {
        const tDef = TOWER_TYPES[this.selectedTowerType];
        // filled range circle
        ctx.beginPath();
        ctx.arc(cx, cy, tDef.range, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(74,222,128,0.04)";
        ctx.fill();
        ctx.strokeStyle = "rgba(74,222,128,0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ── TOWERS ────────────────────────────────────────────────────────────────
    for (const tower of this.towers) {
      const cx = tower.x,
        cy = tower.y;
      const isSelected =
        this.selectedTowerCell?.col === tower.col &&
        this.selectedTowerCell?.row === tower.row;
      ctx.arc(
        cx,
        cy,
        TOWER_TYPES[this.selectedTowerType].range,
        0,
        Math.PI * 2,
      );

      // last-stand red tint
      if (this.lastStandActive) {
        ctx.fillStyle = "rgba(239,68,68,0.12)";
        ctx.fillRect(
          tower.col * CELL_SIZE + 1,
          tower.row * CELL_SIZE + 1,
          CELL_SIZE - 2,
          CELL_SIZE - 2,
        );
      }

      // base platform
      ctx.fillStyle = isSelected ? "#1e3050" : "#111827";
      _roundRect(
        ctx,
        tower.col * CELL_SIZE + 2,
        tower.row * CELL_SIZE + 2,
        CELL_SIZE - 4,
        CELL_SIZE - 4,
        5,
      );
      ctx.fill();

      // selection/color border
      ctx.strokeStyle = isSelected ? "#ffffff" : tower.color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      _roundRect(
        ctx,
        tower.col * CELL_SIZE + 2,
        tower.row * CELL_SIZE + 2,
        CELL_SIZE - 4,
        CELL_SIZE - 4,
        5,
      );
      ctx.stroke();

      // upgrade-ready gold pulse
      if (tower.upgradeReady) {
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(this.tick * 0.12));
        ctx.strokeStyle = `rgba(251,191,36,${pulse})`;
        ctx.lineWidth = 2.5;
        _roundRect(
          ctx,
          tower.col * CELL_SIZE + 1,
          tower.row * CELL_SIZE + 1,
          CELL_SIZE - 2,
          CELL_SIZE - 2,
          6,
        );
        ctx.stroke();
      }

      // ── Draw tower body (canvas shapes, no emoji) ─────────────────────────
      ctx.save();
      ctx.translate(cx, cy);

      // glow ring on cooldown flash
      const coolPct = 1 - tower.cooldown / tower.fireRate;
      if (coolPct > 0.85) {
        ctx.globalAlpha = ((coolPct - 0.85) / 0.15) * 0.4;
        ctx.fillStyle = tower.color;
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      _drawTowerShape(ctx, tower, this.tick, this.activeSkin);
      ctx.restore();

      // range ring on select
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(cx, cy, tower.range, 0, Math.PI * 2);
        ctx.strokeStyle = tower.color + "55";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(cx, cy, tower.range, 0, Math.PI * 2);
        ctx.fillStyle = tower.color + "08";
        ctx.fill();
      }

      // Cyclone spin ring visual
      if (tower.specials?.includes("cyclone")) {
        const spinRadius = tower.range * 0.65;
        const rot = this.tick * 0.08;
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.15 * Math.sin(this.tick * 0.15);
        ctx.strokeStyle = tower.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 12]);
        ctx.lineDashOffset = -this.tick * 0.8; // animates the dash moving
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, spinRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // 3 orbiting dots
        for (let i = 0; i < 3; i++) {
          const a = rot + i * ((Math.PI * 2) / 3);
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = tower.color;
          ctx.beginPath();
          ctx.arc(
            tower.x + Math.cos(a) * spinRadius,
            tower.y + Math.sin(a) * spinRadius,
            4,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.restore();
      }

      // tier badge
      {
        const bx = tower.col * CELL_SIZE + CELL_SIZE - 7;
        const by = tower.row * CELL_SIZE + 7;

        // Determine badge tier
        const hasL2 = tower.legendary100Unlocked;
        const hasL1 = tower.legendaryUnlocked;
        const hasT2 = tower.skill10chosen;
        const hasT1 = tower.skill5chosen;

        if (hasL2) {
          // ✦✦ Legendary 100 — red star with pulse
          const pulse = 0.7 + 0.3 * Math.sin(this.tick * 0.15);
          ctx.save();
          ctx.globalAlpha = pulse;
          ctx.shadowColor = "#ef4444";
          ctx.shadowBlur = 10;
          // outer glow ring
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(bx, by, 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          // badge fill
          ctx.fillStyle = "#450a0a";
          ctx.beginPath();
          ctx.arc(bx, by, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.restore();
          ctx.font = "9px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("✦", bx, by + 0.5);
        } else if (hasL1) {
          // ✦ Legendary 50 — gold star with pulse
          const pulse = 0.75 + 0.25 * Math.sin(this.tick * 0.12);
          ctx.save();
          ctx.globalAlpha = pulse;
          ctx.shadowColor = "#f59e0b";
          ctx.shadowBlur = 8;
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(bx, by, 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#451a03";
          ctx.beginPath();
          ctx.arc(bx, by, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.restore();
          ctx.font = "9px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("✦", bx, by + 0.5);
        } else if (hasT2) {
          // T2 — yellow diamond
          ctx.save();
          ctx.fillStyle = "#fbbf24";
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(bx, by - 7);
          ctx.lineTo(bx + 5, by);
          ctx.lineTo(bx, by + 7);
          ctx.lineTo(bx - 5, by);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = "#000";
          ctx.font = "bold 6px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("T2", bx, by + 0.5);
        } else if (hasT1) {
          // T1 — blue circle
          ctx.save();
          ctx.fillStyle = "#38bdf8";
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.arc(bx, by, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = "#000";
          ctx.font = "bold 6px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("T1", bx, by + 0.5);
        }

        // Upgrade-ready indicator — small flashing dot on bottom-left corner
        if (tower.upgradeReady) {
          const dotPulse = 0.5 + 0.5 * Math.abs(Math.sin(this.tick * 0.18));
          ctx.save();
          ctx.globalAlpha = dotPulse;
          ctx.fillStyle = "#fbbf24";
          ctx.shadowColor = "#fbbf24";
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(
            tower.col * CELL_SIZE + 6,
            tower.row * CELL_SIZE + CELL_SIZE - 6,
            4,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.restore();
        }
      }

      // HP bar (only show if damaged)
      if (tower.hp < tower.maxHp) {
        const hpPct = tower.hp / tower.maxHp;
        const barW = CELL_SIZE - 6;
        const barX = tower.col * CELL_SIZE + 3;
        const barY = tower.row * CELL_SIZE + 2;
        ctx.fillStyle = "rgba(0,0,0,0.8)";
        ctx.fillRect(barX - 1, barY - 1, barW + 2, 5);
        ctx.fillStyle =
          hpPct > 0.6 ? "#4ade80" : hpPct > 0.3 ? "#facc15" : "#ef4444";
        ctx.fillRect(barX, barY, barW * hpPct, 3);
        // Disabled overlay
        if (tower.disabled) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(
            tower.col * CELL_SIZE + 2,
            tower.row * CELL_SIZE + 2,
            CELL_SIZE - 4,
            CELL_SIZE - 4,
          );
          ctx.fillStyle = "#ef4444";
          ctx.font = "bold 14px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            "✕",
            tower.col * CELL_SIZE + CELL_SIZE / 2,
            tower.row * CELL_SIZE + CELL_SIZE / 2,
          );
          ctx.textBaseline = "alphabetic";
        }
      }

      // cooldown bar
      if (tower.cooldown > 0) {
        const barW = (CELL_SIZE - 6) * (1 - tower.cooldown / tower.fireRate);
        ctx.fillStyle = tower.color + "40";
        ctx.fillRect(
          tower.col * CELL_SIZE + 3,
          tower.row * CELL_SIZE + CELL_SIZE - 5,
          CELL_SIZE - 6,
          3,
        );
        ctx.fillStyle = tower.color;
        ctx.fillRect(
          tower.col * CELL_SIZE + 3,
          tower.row * CELL_SIZE + CELL_SIZE - 5,
          barW,
          3,
        );
      }
    }

    // ── BALL LIGHTNINGS ────────────────────────────────────────────────────────
    for (const bl of this.ballLightnings || []) {
      const life = bl.timer / 300;
      ctx.save();
      ctx.globalAlpha = life;
      ctx.shadowColor = bl.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = bl.color;
      ctx.beginPath();
      ctx.arc(bl.x, bl.y, 6 + 3 * Math.sin(this.tick * 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bl.x, bl.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── BURN ZONES ─────────────────────────────────────────────────────────────
    for (const z of this.burnZones || []) {
      const alpha = (z.timer / 180) * 0.35;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ff6600";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── BLACK HOLES ────────────────────────────────────────────────────────────
    for (const bh of this.blackHoles || []) {
      const life = bh.timer / 180;
      const pulseR = bh.radius * (0.15 + 0.08 * Math.sin(this.tick * 0.2));
      ctx.save();
      ctx.globalAlpha = life * 0.6;
      ctx.strokeStyle = "#818cf8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bh.x, bh.y, bh.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = life;
      ctx.fillStyle = "#1e1b4b";
      ctx.beginPath();
      ctx.arc(bh.x, bh.y, pulseR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── ENEMIES ───────────────────────────────────────────────────────────────
    for (const enemy of this.enemies) {
      ctx.save();
      ctx.globalAlpha = enemy.stealth ? 0.38 : 1;
      ctx.translate(enemy.x, enemy.y);

      _drawEnemyShape(ctx, enemy, this.tick);

      // status rings
      if (enemy.slowTimer > 0) {
        ctx.strokeStyle = "#a5f3fc";
        ctx.lineWidth = 2;
        ctx.globalAlpha =
          (enemy.stealth ? 0.38 : 1) * (0.6 + 0.4 * Math.sin(this.tick * 0.2));
        ctx.beginPath();
        ctx.arc(0, 0, enemy.size + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (enemy.burnTimer > 0) {
        ctx.strokeStyle = `rgba(255,100,0,${0.5 + 0.5 * Math.sin(this.tick * 0.35)})`;
        ctx.lineWidth = 2;
        ctx.globalAlpha = enemy.stealth ? 0.38 : 1;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.size + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (enemy.stunTimer > 0) {
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.size + 6, 0, Math.PI * 2);
        ctx.stroke();
        // star sparks
        for (let s = 0; s < 3; s++) {
          const a = this.tick * 0.15 + s * ((Math.PI * 2) / 3);
          ctx.fillStyle = "#fbbf24";
          ctx.beginPath();
          ctx.arc(
            Math.cos(a) * (enemy.size + 9),
            Math.sin(a) * (enemy.size + 9),
            2,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      if (enemy.armor > 0.2) {
        ctx.strokeStyle = "rgba(148,163,184,0.5)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(0, 0, enemy.size * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
      ctx.globalAlpha = 1;

      // counter warning
      if (
        enemy.requiresCounter &&
        !this.towers.some((t) => t.type === enemy.requiresCounter)
      ) {
        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "center";
        ctx.fillText("⚠ LASER", enemy.x, enemy.y - enemy.size - 14);
      }

      // Healer priority marker
      if (enemy.type === "healer") {
        ctx.fillStyle = "#4ade80";
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "center";
        ctx.fillText("⚕ PRIORITY", enemy.x, enemy.y - enemy.size - 14);
      }

      // Missile lock-on indicator
      const isLocked = this.projectiles.some(
        (p) => p.towerType === "missile" && p.homing && p.targetId === enemy.id,
      );
      if (isLocked) {
        ctx.save();
        ctx.strokeStyle = "#f43f5e";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(this.tick * 0.25));
        const rSize = enemy.size + 8;
        // Corner brackets
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          ctx.beginPath();
          ctx.moveTo(enemy.x + sx * rSize, enemy.y + sy * (rSize - 4));
          ctx.lineTo(enemy.x + sx * rSize, enemy.y + sy * rSize);
          ctx.lineTo(enemy.x + sx * (rSize - 4), enemy.y + sy * rSize);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Elite indicator ring
      if (enemy.isElite) {
        ctx.save();
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2.5;
        ctx.shadowColor = "#facc15";
        ctx.shadowBlur = 10;
        const t = this.tick * 0.15;
        ctx.beginPath();
        ctx.arc(
          enemy.x,
          enemy.y,
          enemy.size + 5 + Math.sin(t) * 2,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // Mutation indicator on boss
      if (enemy.isBoss && enemy.mutation) {
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(
          `${enemy.mutation.icon} ${enemy.mutation.name}`,
          enemy.x,
          enemy.y - enemy.size - 18,
        );
        ctx.textBaseline = "alphabetic";
      }

      // HP bar
      const bw = enemy.isBoss ? enemy.size * 3.8 : enemy.size * 2.6;
      const bh = enemy.isBoss ? 5 : 3;
      const bx = enemy.x - bw / 2,
        by = enemy.y - enemy.size - (enemy.isBoss ? 14 : 7);
      const r = Math.max(0, enemy.hp / enemy.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = r > 0.55 ? "#4ade80" : r > 0.28 ? "#facc15" : "#ef4444";
      ctx.fillRect(bx, by, bw * r, bh);
      if (enemy.isBoss) {
        ctx.fillStyle = r > 0.28 ? "#fde68a" : "#fca5a5";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const hpK =
          enemy.hp >= 1000
            ? `${(enemy.hp / 1000).toFixed(1)}k`
            : Math.ceil(enemy.hp);
        ctx.fillText(
          `${hpK} / ${enemy.maxHp >= 1000 ? `${(enemy.maxHp / 1000).toFixed(1)}k` : Math.ceil(enemy.maxHp)}`,
          enemy.x,
          by - 1,
        );
        ctx.textBaseline = "alphabetic";
      }
    }

    // ── PROJECTILES ───────────────────────────────────────────────────────────
    for (const p of this.projectiles) {
      ctx.save();
      _drawProjectile(ctx, p, this.tick);
      ctx.restore();
    }

    // ── TESLA BOLT EFFECTS ────────────────────────────────────────────────────
    for (const bolt of this.boltEffects) {
      const alpha = bolt.life / bolt.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = bolt.color;
      ctx.shadowBlur = 12 * alpha;
      ctx.strokeStyle = bolt.color;
      ctx.lineWidth = 1.5 + alpha * 2;
      ctx.beginPath();
      ctx.moveTo(bolt.x1, bolt.y1);
      ctx.lineTo(bolt.mx, bolt.my);
      ctx.lineTo(bolt.x2, bolt.y2);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 0.5;
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
    }

    // ── PARTICLES ─────────────────────────────────────────────────────────────
    for (const p of this.particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── FLOATING TEXTS ────────────────────────────────────────────────────────
    for (const t of this.floatingTexts) {
      const a = t.life / 75;
      ctx.globalAlpha = a;
      ctx.font = `bold ${10 + (1 - a) * 4}px monospace`;
      ctx.fillStyle = t.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    // ── EVOLUTION ALERT ──────────────────────────────────────────────────────
    if (this.evolutionAlertTimer > 0) {
      this.evolutionAlertTimer--;
      const evo = this.evolutionAlertDef;
      if (evo) {
        const fadeAlpha = Math.min(1, this.evolutionAlertTimer / 30);
        ctx.globalAlpha = fadeAlpha;
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(W * 0.15, H * 0.38, W * 0.7, 70);
        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⚠ ENEMY EVOLUTION DETECTED", W / 2, H * 0.38 + 16);
        ctx.fillStyle = "#fde68a";
        ctx.font = "bold 13px monospace";
        ctx.fillText(`${evo.icon} ${evo.name}`, W / 2, H * 0.38 + 34);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "10px monospace";
        ctx.fillText(evo.desc, W / 2, H * 0.38 + 52);
        ctx.globalAlpha = 1;
        ctx.textBaseline = "alphabetic";
      }
    }

    // ── BOSS WARNING ──────────────────────────────────────────────────────────
    if (this.bossWarningTimer > 0) {
      this.bossWarningTimer--;
      const alpha =
        Math.min(1, this.bossWarningTimer / 30) *
        Math.abs(Math.sin(this.tick * 0.15));
      const bDef = ENEMY_TYPES[this.bossWarningType];
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#1a0000";
      ctx.fillRect(0, H / 2 - 50, W, 100);
      ctx.globalAlpha = Math.min(1, alpha * 2);
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 24px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`⚠ BOSS: ${bDef?.name || "???"} ⚠`, W / 2, H / 2 - 16);
      ctx.fillStyle = "#fca5a5";
      ctx.font = "12px monospace";
      ctx.fillText(
        bDef?.weaknessHint || "Find its weakness!",
        W / 2,
        H / 2 + 6,
      );
      if (this.bossWarningMutation) {
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 11px monospace";
        ctx.fillText(
          `🧬 MUTATION: ${this.bossWarningMutation.icon} ${this.bossWarningMutation.name} — ${this.bossWarningMutation.desc}`,
          W / 2,
          H / 2 + 42,
        );
      }
      if (bDef?.immunities?.length) {
        ctx.fillStyle = "#f87171";
        ctx.font = "10px monospace";
        ctx.fillText(
          `IMMUNE: ${bDef.immunities.map((i) => TOWER_TYPES[i]?.name || i).join(", ")}`,
          W / 2,
          H / 2 + 24,
        );
      }
      ctx.globalAlpha = 1;
    }

    // ── Persistent wave info bar ──────────────────────────────────────────────
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, W, 30);

    // Wave number (left)
    const waveLabel = this.isEndless
      ? `∞ WAVE ${this.wave}`
      : `WAVE ${this.wave} / ${this.levelConfig.waves}`;
    ctx.fillStyle = this.isEndless ? "#818cf8" : "#38bdf8";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(waveLabel, 10, 15);

    // Modifier or incoming warning (center-right)
    if (this.activeModifier) {
      const mod = this.activeModifier;
      const tc =
        mod.type === "buff"
          ? "#4ade80"
          : mod.type === "debuff"
            ? "#ef4444"
            : "#c4b5fd";
      const bg =
        mod.type === "buff"
          ? "rgba(74,222,128,0.15)"
          : mod.type === "debuff"
            ? "rgba(239,68,68,0.15)"
            : "rgba(129,140,248,0.15)";
      ctx.fillStyle = bg;
      ctx.fillRect(W * 0.28, 2, W * 0.72 - 4, 26);
      ctx.fillStyle = tc;
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        `${mod.icon} ${mod.name.toUpperCase()} — ${mod.desc}`,
        W * 0.65,
        15,
      );
      if (this.silencedTowerType) {
        const tDef = TOWER_TYPES[this.silencedTowerType];
        ctx.fillStyle = "#fca5a5";
        ctx.textAlign = "right";
        ctx.fillText(
          `🔇 ${tDef?.name || this.silencedTowerType} SILENCED`,
          W - 6,
          15,
        );
      }
    } else if (this._incomingModifier) {
      const mod = this._incomingModifier;
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this.tick * 0.1));
      const tc =
        mod.type === "buff"
          ? `rgba(134,239,172,${pulse})`
          : mod.type === "debuff"
            ? `rgba(252,165,165,${pulse})`
            : `rgba(196,181,253,${pulse})`;
      ctx.fillStyle = tc;
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText(
        `⚡ NEXT WAVE: ${mod.icon} ${mod.name} — ${mod.desc}`,
        W - 10,
        15,
      );
    } else if (this.state === "idle") {
      ctx.fillStyle = "#374151";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`▶ Deploy towers — start wave ${this.wave + 1}`, W - 10, 15);
    }
    ctx.textBaseline = "alphabetic";

    // ── GAME OVER / VICTORY ───────────────────────────────────────────────────
    if (this.state === "gameover" || this.state === "victory") {
      const won = this.state === "victory";
      ctx.fillStyle = "rgba(0,0,0,0.82)";
      ctx.fillRect(0, 0, W, H);
      // animated title scale
      const scale = 1 + 0.03 * Math.sin(this.tick * 0.08);
      ctx.save();
      ctx.translate(W / 2, H / 2 - 40);
      ctx.scale(scale, scale);
      ctx.fillStyle = won ? "#4ade80" : "#ef4444";
      ctx.font = "bold 42px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(won ? "VICTORY!" : "GAME OVER", 0, 0);
      ctx.restore();
      ctx.fillStyle = "#94a3b8";
      ctx.font = "16px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`Score: ${this.score.toLocaleString()}`, W / 2, H / 2 + 10);
      ctx.fillText(
        this.isEndless
          ? `Survived ${this.wave} waves!`
          : won
            ? "The AI couldn't stop you."
            : "The AI has defeated you.",
        W / 2,
        H / 2 + 34,
      );
    }

    // ── PAUSE OVERLAY ─────────────────────────────────────────────────────────────
    if (this.paused) {
      ctx.fillStyle = "rgba(0,0,0,0.68)";
      ctx.fillRect(0, 0, W, H);
      const pulse = 0.8 + 0.2 * Math.sin(this.tick * 0.07);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 40px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⏸ PAUSED", W / 2, H / 2 - 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#475569";
      ctx.font = "13px monospace";
      ctx.fillText("Space / P  to resume", W / 2, H / 2 + 22);
    }

    ctx.restore(); // pop shake transform
  }

  _triggerShake(intensity = 5, frames = 6) {
    if (intensity > this.shake.intensity || this.shake.frames <= 0) {
      this.shake.intensity = intensity;
      this.shake.frames = frames;
    }
  }

  repairTower(col, row) {
    const tower = this.grid[row]?.[col];
    if (!tower) return false;
    if (tower.hp >= tower.maxHp) return false;
    const cost = tower.repairCost || 0;
    if (this.gold < cost) {
      this._addFloatingText(tower.x, tower.y - 20, `Need ${cost}g`, "#ef4444");
      return false;
    }
    this.gold -= cost;
    tower.hp = tower.maxHp;
    tower.disabled = false;
    tower.repairCost = 0;
    this._addFloatingText(tower.x, tower.y - 20, "✓ Fully Repaired", "#4ade80");
    this._addParticles(tower.x, tower.y, "#4ade80", 15);
    this._emitState();
    return true;
  }

  repairAllTowers() {
    if (this.state !== "idle") return false;
    const damaged = this.towers.filter((t) => t.hp < t.maxHp);
    if (damaged.length === 0) return false;

    const totalCost = damaged.reduce((sum, t) => sum + (t.repairCost || 0), 0);
    if (totalCost > 0 && this.gold < totalCost) {
      this._addFloatingText(
        this.canvas.width / 2,
        this.canvas.height / 2,
        `Need ${totalCost}g to repair all!`,
        "#ef4444",
      );
      return false;
    }

    this.gold -= totalCost;
    for (const t of damaged) {
      t.hp = t.maxHp;
      t.disabled = false;
      t.repairCost = 0;
      this._addParticles(t.x, t.y, "#4ade80", 8);
    }
    this._addFloatingText(
      this.canvas.width / 2,
      this.canvas.height / 2 - 20,
      `🔧 ${damaged.length} towers repaired! -${totalCost}g`,
      "#4ade80",
    );
    this._emitState();
    return true;
  }

  togglePause() {
    if (this.state !== "wave") return false;
    this.paused = !this.paused;
    this._emitState();
    return this.paused;
  }

  getSaveState() {
    return {
      version: 1,
      timestamp: new Date().toISOString(),
      levelId: this.levelId,

      savedMapKey: this._currentMapKey,
      savedMapWaveRotation: this.wave,

      wave: this.wave,
      gold: this.gold,
      lives: this.lives,
      score: this.score,
      fortifyLevel: this.fortifyLevel,
      fortifyCost: this.fortifyCost,
      selectedTowerType: this.selectedTowerType,
      towerCatCounts: { ...this.towerCatCounts },
      towers: this.towers.map((t) => {
        const s = { ...t };
        // Convert Sets → arrays so JSON.stringify works
        s._waveHits = [];
        s.assistTowers = [];
        return s;
      }),
      playerProfile: {
        ...this.waveAI.playerProfile,
        towerPositions: [...this.waveAI.playerProfile.towerPositions],
        weaknesses: [...this.waveAI.playerProfile.weaknesses],
      },
      adaptationLog: [...this.waveAI.adaptationLog],
    };
  }

  loadSaveState(save) {
    if (!save || save.version !== 1) return false;

    console.log("🔄 Loading save with map:", save.savedMapKey);
    this._applyLevel(save.levelId, save.savedMapKey || null);

    this.wave = save.wave;
    this.gold = save.gold;
    this.lives = save.lives;
    this.score = save.score;
    this.fortifyLevel = save.fortifyLevel || 0;
    this.fortifyCost = save.fortifyCost || ECFG.fortifyCostBase;
    this.selectedTowerType =
      save.selectedTowerType || this.levelConfig.unlockedTowers[0];
    this.towerCatCounts = { ...save.towerCatCounts };

    // Restore towers
    this.towers = [];
    this.grid = Array.from({ length: GRID_ROWS }, () =>
      Array(GRID_COLS).fill(null),
    );

    for (const st of save.towers) {
      const tower = { ...st };
      tower._waveHits = new Set();
      tower.assistTowers = new Set();
      this.towers.push(tower);
      this.grid[tower.row][tower.col] = tower;
    }

    // Rebuild path/kingdom using the map that was just set in _applyLevel
    this.path = this._buildPath(this.mapDef.waypoints);
    this.pathCells = this._buildPathCells(this.mapDef.waypoints);

    const lastPt = this.path[this.path.length - 1];
    this.kingdom = new Kingdom(lastPt.x, lastPt.y);
    this.spawnCamps = [new SpawnCamp(this.path[0].x, this.path[0].y, 0)];

    if (save.playerProfile) {
      this.waveAI.playerProfile = {
        ...save.playerProfile,
        towerPositions: save.playerProfile.towerPositions || [],
        weaknesses: save.playerProfile.weaknesses || [],
      };
      this.waveAI.currentWave = save.wave;
      this.waveAI.adaptationLog = save.adaptationLog || [];
    }

    this._checkSynergies();
    this.state = "idle";
    this._emitState();
    return true;
  }

  _loop() {
    this.tick++;
    if (this.state === "wave" && !this.paused) {
      this._updateSpawning();
      this._updateEnemies();
      this._updateTowers();
      this._updateProjectiles();
      this._checkWaveComplete();
    }
    if (!this.paused) {
      this._updateParticles();
      if (this._streakWindow > 0) {
        this._streakWindow--;
      } else {
        this._streakCount = 0;
      }
    }
    this._draw();
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
}

// ── Helper: rounded rect path ─────────────────────────────────────────────
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function _drawPathCell(ctx, x, y, size, style, theme, tick) {
  ctx.save();
  switch (style) {
    case "medieval": {
      // Cobblestone — alternating stone blocks
      ctx.strokeStyle = "rgba(139,105,20,0.25)";
      ctx.lineWidth = 0.5;
      const stoneW = size / 2,
        stoneH = size / 2;
      for (let si = 0; si < 2; si++)
        for (let sj = 0; sj < 2; sj++) {
          const offset = sj % 2 === 0 ? stoneW * 0.5 : 0;
          ctx.strokeRect(
            x + si * stoneW + offset,
            y + sj * stoneH,
            stoneW,
            stoneH,
          );
        }
      // moss tint
      ctx.fillStyle = "rgba(74,222,128,0.04)";
      ctx.fillRect(x, y, size, size);
      break;
    }
    case "jungle": {
      // Dirt path with root marks
      ctx.strokeStyle = "rgba(134,239,172,0.15)";
      ctx.lineWidth = 0.8;
      // horizontal root lines
      for (let i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x, y + (size / 3) * i);
        ctx.bezierCurveTo(
          x + size * 0.3,
          y + (size / 3) * i - 2,
          x + size * 0.7,
          y + (size / 3) * i + 2,
          x + size,
          y + (size / 3) * i,
        );
        ctx.stroke();
      }
      break;
    }
    case "neon": {
      // Glowing lane lines
      const pulse = 0.1 + 0.06 * Math.sin(tick * 0.05);
      ctx.strokeStyle = `rgba(0,255,255,${pulse})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2, y + 2, size - 4, size - 4);
      // center dot grid
      if ((Math.floor(x / size) + Math.floor(y / size)) % 3 === 0) {
        ctx.fillStyle = `rgba(255,0,255,${pulse * 1.5})`;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default: {
      // Tech — subtle scanline
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    }
  }
  ctx.restore();
}

function _drawGroundCell(ctx, x, y, size, style, theme, row, col, tick) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  switch (style) {
    case "medieval": {
      // Grass tufts at random-ish positions based on col/row
      if ((col * 7 + row * 3) % 5 === 0) {
        ctx.strokeStyle = "#166534";
        ctx.lineWidth = 0.8;
        const gx = x + ((col * 13) % (size - 6)) + 3;
        const gy = y + ((row * 11) % (size - 6)) + 3;
        // 3 grass blades
        for (let b = -1; b <= 1; b++) {
          ctx.beginPath();
          ctx.moveTo(gx + b * 3, gy + 4);
          ctx.quadraticCurveTo(gx + b * 3 + b, gy, gx + b * 3 + b * 2, gy - 3);
          ctx.stroke();
        }
      }
      // stone texture hint
      if ((col + row) % 4 === 0) {
        ctx.strokeStyle = "rgba(120,113,108,0.12)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x + 3, y + 3, size - 6, size - 6);
      }
      break;
    }
    case "jungle": {
      // Leaf scatter
      if ((col * 5 + row * 9) % 4 === 0) {
        ctx.fillStyle = "#15803d";
        ctx.beginPath();
        const lx = x + ((col * 17) % (size - 8)) + 4;
        const ly = y + ((row * 13) % (size - 8)) + 4;
        ctx.ellipse(lx, ly, 3, 5, (col + row) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // vine lines
      if ((col * row) % 8 === 0) {
        ctx.strokeStyle = "rgba(21,128,61,0.2)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y + size * 0.3);
        ctx.quadraticCurveTo(
          x + size * 0.5,
          y + size * 0.1,
          x + size,
          y + size * 0.5,
        );
        ctx.stroke();
      }
      break;
    }
    case "neon": {
      // Grid dots
      if ((col + row) % 2 === 0) {
        const pulse = 0.08 + 0.04 * Math.sin(tick * 0.03 + col * 0.1);
        ctx.fillStyle = `rgba(0,255,255,${pulse})`;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default:
      break; // tech skin needs nothing extra
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function _blendColor(hex1, hex2, t) {
  const n1 = parseInt(hex1.replace("#", ""), 16);
  const n2 = parseInt(hex2.replace("#", ""), 16);
  const r = Math.round(((n1 >> 16) & 0xff) * (1 - t) + ((n2 >> 16) & 0xff) * t);
  const g = Math.round(((n1 >> 8) & 0xff) * (1 - t) + ((n2 >> 8) & 0xff) * t);
  const b = Math.round((n1 & 0xff) * (1 - t) + (n2 & 0xff) * t);
  return `rgb(${r},${g},${b})`;
}

// ── Helper: darken/lighten a hex color ───────────────────────────────────
function _shadeColor(hex, amt) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

// ── Tower shape renderer ──────────────────────────────────────────────────
function _drawTowerShape(ctx, tower, tick) {
  const c = tower.color;
  const s = CELL_SIZE * 0.38;

  ctx.shadowColor = c;
  ctx.shadowBlur = 10;

  // Subtle colored glow behind emoji so color-coding is preserved
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.95, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Rotating indicator for towers that had spinning shapes
  if (
    tower.type === "basic" ||
    tower.type === "laser" ||
    tower.type === "vortex"
  ) {
    const rot = tick * (tower.type === "vortex" ? 0.07 : 0.04);
    ctx.save();
    ctx.rotate(rot);
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Barrel indicator for directional towers
  if (
    ["sniper", "cannon", "missile"].includes(tower.type) &&
    tower._drawAngle
  ) {
    ctx.save();
    ctx.rotate(tower._drawAngle);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = c;
    ctx.fillRect(-2, -s * 0.85, 4, s * 0.5);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Emoji
  ctx.font = `${CELL_SIZE * 0.62}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tower.icon || "🗼", 0, 1);

  ctx.shadowBlur = 0;
}

// ── Enemy shape renderer ──────────────────────────────────────────────────
// ctx is already translated to enemy center
function _drawEnemyShape(ctx, enemy, tick) {
  const r = enemy.size;

  ctx.shadowColor = enemy.color;
  ctx.shadowBlur = enemy.isBoss ? 16 : 8;

  // Boss pulse ring so they still feel big and threatening
  if (enemy.isBoss) {
    const pulse = 0.3 + 0.2 * Math.sin(tick * 0.1);
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = enemy.phaseTriggered ? "#ff2200" : enemy.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Phase 2 flare
  if (enemy.phaseTriggered) {
    ctx.globalAlpha = 0.35 + 0.2 * Math.sin(tick * 0.25);
    ctx.fillStyle = "#ff2200";
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Stealth shimmer ring
  if (enemy.stealth) {
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = enemy.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Healer orbit dots (keep the feel without the cross shape)
  if (enemy.type === "healer") {
    const orbitAngle = tick * 0.08;
    for (let i = 0; i < 3; i++) {
      const a = orbitAngle + i * ((Math.PI * 2) / 3);
      ctx.fillStyle = "#86efac";
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(
        Math.cos(a) * r * 1.2,
        Math.sin(a) * r * 1.2,
        r * 0.2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Speed trail for fast enemies
  if (enemy.type === "fast") {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = enemy.color;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(0, r * i * 0.6, r * 0.25 * (1 - i * 0.25), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Emoji — boss gets larger font
  const fontSize = r * (enemy.isBoss ? 2.6 : 2.1);
  ctx.font = `${fontSize}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(enemy.icon || "👾", 0, 1);

  ctx.shadowBlur = 0;
}

// ── Projectile renderer ───────────────────────────────────────────────────
function _drawProjectile(ctx, p, tick) {
  // const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);

  switch (p.towerType) {
    case "basic": {
      // ── Gatling bolt — rapid energy pulse (bolt-style like laser) ─────────
      const angle = Math.atan2(p.vy, p.vx);
      ctx.save();
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      // Trailing energy line
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(p.x - Math.cos(angle) * 10, p.y - Math.sin(angle) * 10);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      // Bright leading tip
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
      // Color core
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(
        p.x - Math.cos(angle) * 3,
        p.y - Math.sin(angle) * 3,
        1.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
      break;
    }

    case "sniper": {
      // ── High-velocity slug — elongated metallic bullet ────────────────────
      const angle = Math.atan2(p.vy, p.vx);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.shadowColor = "#c0c0c0";
      ctx.shadowBlur = 6;
      // Casing body — elongated silver cylinder
      const grad = ctx.createLinearGradient(-8, -1.5, 8, 1.5);
      grad.addColorStop(0, "#94a3b8");
      grad.addColorStop(0.4, "#e2e8f0");
      grad.addColorStop(1, "#475569");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(-8, -1.5, 14, 3, 1);
      ctx.fill();
      // Tip
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(10, -1.5);
      ctx.lineTo(10, 1.5);
      ctx.closePath();
      ctx.fill();
      // Vapor trail
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.roundRect(-18, -1, 10, 2, 1);
      ctx.fill();
      ctx.restore();
      break;
    }

    case "cannon": {
      // spinning orange fireball
      // const angle = Math.atan2(p.vy, p.vx) + tick * 0.3;
      ctx.shadowColor = "#ff6600";
      ctx.shadowBlur = 16;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2);
      ctx.fill();
      // hot core
      ctx.shadowBlur = 6;
      ctx.fillStyle = "#ffdd00";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
      ctx.fill();
      // smoke trail
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = "#aaa";
      for (let t = 1; t <= 3; t++) {
        ctx.beginPath();
        ctx.arc(
          p.x - p.vx * t * 2,
          p.y - p.vy * t * 2,
          p.size * (1 - t * 0.25),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }

    case "laser": {
      // ── Energy bolt — traveling spark from origin ─────────────────────────
      const angle = Math.atan2(p.vy, p.vx);
      ctx.save();
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;

      // Draw full path from origin to current tip if origin is stored
      if (
        p.originX !== undefined &&
        Math.abs(p.x - p.originX) + Math.abs(p.y - p.originY) > 4
      ) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(p.originX, p.originY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        // White core line
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.3;
        ctx.stroke();
      } else {
        // Short bolt trail
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(angle) * 14, p.y - Math.sin(angle) * 14);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      // Bright leading tip
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // Color glow dot
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }

    case "freeze": {
      // spinning ice crystal
      ctx.shadowColor = "#a5f3fc";
      ctx.shadowBlur = 10;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(tick * 0.18);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(0, -p.size * 2);
      ctx.lineTo(p.size * 1.2, 0);
      ctx.lineTo(0, p.size * 2);
      ctx.lineTo(-p.size * 1.2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e0f9ff";
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }

    case "inferno": {
      // fireball with orange glow
      ctx.shadowColor = "#ff2200";
      ctx.shadowBlur = 18;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffee00";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#ff6600";
      ctx.beginPath();
      ctx.arc(p.x - p.vx * 2.5, p.y - p.vy * 2.5, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }

    case "vortex": {
      // swirling purple orb
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff44";
      ctx.lineWidth = 1;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case "missile": {
      const angle = Math.atan2(p.vy, p.vx);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
      // Body
      ctx.fillStyle = p.color;
      ctx.fillRect(-3, -2, 13, 4);
      // Nose
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(14, -3);
      ctx.lineTo(14, 3);
      ctx.closePath();
      ctx.fill();
      // Exhaust
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(-11, -2.5);
      ctx.lineTo(-11, 2.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(-17, -1.5);
      ctx.lineTo(-17, 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }

    default: {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function _calcKillXp(tower, enemy) {
  // Flat kill values by role — no damage scaling
  if (enemy.isBoss) {
    // Boss kills: meaningful but not game-breaking
    const bossXp = {
      basic: 12,
      sniper: 14,
      cannon: 11,
      laser: 8,
      freeze: 6,
      tesla: 10,
      inferno: 11,
      vortex: 5,
    };
    return bossXp[tower.type] ?? 10;
  }
  // Normal kills: small flat amount, role-adjusted
  const normalXp = {
    basic: 1.6,
    sniper: 2.6,
    cannon: 1.1,
    laser: 0.89,
    freeze: 0.4,
    tesla: 1.4,
    inferno: 1.2,
    vortex: 0.3,
  };
  return normalXp[tower.type] ?? 1.0;
}

function _calcAssistXp(tower, enemy) {
  // Assists are worth less than kills, role-adjusted
  if (enemy.isBoss) {
    const bossAssist = {
      basic: 5,
      sniper: 5,
      cannon: 4,
      laser: 4,
      freeze: 6,
      tesla: 5,
      inferno: 4,
      vortex: 3,
    };
    return bossAssist[tower.type] ?? 4;
  }
  const normalAssist = {
    basic: 0.4,
    sniper: 0.6,
    cannon: 0.3,
    laser: 0.3,
    freeze: 0.5,
    tesla: 0.4,
    inferno: 0.3,
    vortex: 0.2,
  };
  return normalAssist[tower.type] ?? 0.3;
}
