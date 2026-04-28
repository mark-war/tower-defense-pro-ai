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

  _applyLevel(levelId) {
    const isEndless = levelId === 99;
    const lvl = isEndless
      ? ENDLESS_CONFIG
      : LEVELS.find((l) => l.id === levelId) || LEVELS[0];
    this.levelConfig = lvl;
    this.isEndless = isEndless;
    this.xpMult = lvl.xpMult ?? 1.0;
    // Endless rotates maps
    const mapKey = isEndless ? "valley" : lvl.map || "valley";
    this.mapDef = MAPS[mapKey] || MAPS.valley;

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

    this._streakCount = 0;
    this._streakTimer = 0;
    this._streakWindow = 0;

    this.paused = false;
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

  // ── WAVE MANAGEMENT ──────────────────────────────────────────────────────────
  startWave() {
    if (this.state !== "idle") return;
    this.wave++;

    // Endless: rotate map every 10 waves
    if (this.isEndless && this.wave % 10 === 0 && this.wave > 0) {
      const mapKeys = Object.keys(MAPS);
      const newMap = MAPS[mapKeys[(this.wave / 10) % mapKeys.length]];
      if (newMap) {
        this.mapDef = newMap;
        this.path = this._buildPath(newMap.waypoints);
        this.pathCells = this._buildPathCells(newMap.waypoints);

        const lastPt = this.path[this.path.length - 1];
        this.kingdom = new Kingdom(lastPt.x, lastPt.y);
        this.spawnCamps = [new SpawnCamp(this.path[0].x, this.path[0].y, 0)];

        this._addFloatingText(
          this.canvas.width / 2,
          this.canvas.height / 2 - 20,
          `🗺 Map shifted: ${newMap.name}!`,
          "#818cf8",
        );
      }
    }

    const bossType = this.isEndless
      ? this.waveAI._endlessBossForWave(this.wave)
      : this.levelConfig.bossWaves?.[this.wave] || null;

    if (bossType && ENEMY_TYPES[bossType]) {
      this.bossWarningType = bossType;
      this.bossWarningTimer = VCFG.bossWarningFrames;
    }

    const waveData = this.waveAI.generateWave(
      this.wave,
      this.levelConfig.waves,
      this.levelConfig,
    );
    this.spawnQueue = [...waveData.enemies];
    this.spawnTimer = 0;
    this.waveKills = 0;
    this.waveLeaks = 0;
    this.waveDamageByTower = {};
    this.waveGoldSpent = 0;
    this.state = "wave";
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
    };
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
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      // Stun takes priority over slow
      if (e.stunImmunity > 0) e.stunImmunity--;

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

      // Move
      const tgt = this.path[e.pathIndex + 1];
      if (!tgt) {
        this.lives = Math.max(0, this.lives - (e.isBoss ? 5 : 1));
        this.waveLeaks++;
        this._addFloatingText(
          this.path[this.path.length - 1].x,
          this.path[this.path.length - 1].y,
          e.isBoss ? "-5 ❤️" : "-1 ❤️",
          "#ef4444",
        );
        this.enemies.splice(i, 1);
        // Last stand check
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
    this.enemies.push({
      id: Date.now() + Math.random(),
      type,
      x: parent.x + (Math.random() - 0.5) * 18,
      y: parent.y + (Math.random() - 0.5) * 18,
      pathIndex: Math.max(0, parent.pathIndex - 1),
      hp: def.hp * 0.75,
      maxHp: def.hp * 0.75,
      speed: def.speed * 1.1,
      baseSpeed: def.speed * 1.1,
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
      if (tower.cooldown > 0) {
        tower.cooldown--;
        continue;
      }

      // ── TESLA: immediate hit, arc bolt visuals, no projectile object ──────
      if (tower.type === "tesla") {
        const inRange = this.enemies
          .filter((e) => {
            if (e.stealth && !synergyTeslaReveal) return false;
            if (e.immunities.includes("tesla")) return false;
            return (
              Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2) <=
              tower.range
            );
          })
          .sort((a, b) => b.distanceTraveled - a.distanceTraveled)
          .slice(0, (tower.chainTargets || 3) + 1);
        if (inRange.length === 0) continue;
        tower.cooldown = Math.max(1, Math.round(tower.fireRate * fireRateMult));
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

      // ── All other towers: fire a projectile ───────────────────────────────
      let target = null;
      for (const enemy of this.enemies) {
        if (enemy.stealth && tower.type !== "laser") continue;
        if (enemy.immunities.includes(tower.type)) continue;
        const dx = enemy.x - tower.x,
          dy = enemy.y - tower.y;
        if (Math.sqrt(dx * dx + dy * dy) <= tower.range) {
          if (!target || enemy.distanceTraveled > target.distanceTraveled)
            target = enemy;
        }
      }
      if (!target) continue;
      this._fireProjectile(tower, target, damageMult);
      tower.cooldown = Math.max(1, Math.round(tower.fireRate * fireRateMult));
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
      towerId: tower.id,
      towerType: tower.type,
      targetId: target.id,
      size: tower.type === "cannon" || tower.type === "vortex" ? 6 : 4,
      specials: tower.specials || [],
      hasShatterSyn,
    });

    // store last fire angle for barrel drawing
    tower._drawAngle =
      Math.atan2(target.y - tower.y, target.x - tower.x) + Math.PI / 2;
  }

  _updateProjectiles() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx;
      p.y += p.vy;
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
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j];
        if (e.stealth && p.towerType !== "laser") continue;
        if (e.immunities.includes(p.towerType)) continue;
        const dx = e.x - p.x,
          dy = e.y - p.y,
          dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < e.size + p.size) {
          hit = true;
          if (p.splash > 0 || p.pullForce > 0) {
            for (const se of this.enemies) {
              if (se.immunities.includes(p.towerType)) continue;
              const sd = Math.sqrt((se.x - p.x) ** 2 + (se.y - p.y) ** 2);
              if (sd < p.splash) {
                let dmg = p.damage * (1 - (sd / p.splash) * 0.5);
                // Shatter synergy: slowed enemies take +50% from cannon splash
                if (
                  p.hasShatterSyn &&
                  p.towerType === "cannon" &&
                  se.slowTimer > 0
                )
                  dmg *= 1.5;
                this._damageEnemy(se, dmg, p);
                if (p.pullForce > 0 && sd > 2) {
                  const ang = Math.atan2(p.y - se.y, p.x - se.x);
                  se.x += Math.cos(ang) * p.pullForce * (1 - sd / p.splash);
                  se.y += Math.sin(ang) * p.pullForce * (1 - sd / p.splash);
                  if (p.towerId) se.assistTowers?.add(p.towerId);
                }
              }
            }
            if (p.towerType === "vortex" && p.pullForce > 0) {
              const vt = this.towers.find((t) => t.id === p.towerId);
              if (vt) {
                vt._wavePulls = (vt._wavePulls || 0) + 1;
              }
            }
            this._addParticles(p.x, p.y, p.color, 14);
          } else {
            this._damageEnemy(e, p.damage, p);
            if (p.chainTargets > 0) this._chainLightning(e, p, p.chainTargets);
          }
          // Teleport-back special
          if (p.specials?.includes("teleportBack")) {
            e.pathIndex = Math.max(0, Math.floor(this.path.length * 0.2));
            e.x = this.path[e.pathIndex].x;
            e.y = this.path[e.pathIndex].y;
            this._addFloatingText(e.x, e.y - 20, "TELEPORTED BACK!", "#818cf8");
          }
          break;
        }
      }
      if (hit) {
        this._addParticles(p.x, p.y, p.color, 5);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // _chainLightning removed — Tesla now chains directly in _updateTowers
  // using immediate-hit arc bolt logic (no projectile object needed)

  _damageEnemy(enemy, rawDmg, proj) {
    let dmg = rawDmg;
    const effectiveXpMult = this.isEndless
      ? this.xpMult * Math.max(0.5, 1 - (this.wave - 1) * 0.005)
      : this.xpMult;
    if (!proj?.armorPiercing) dmg *= 1 - enemy.armor;
    // Armor melt special
    if (proj?.specials?.includes("armorMelt") && enemy.burnTimer > 0)
      enemy.armor = Math.max(0, enemy.armor - 0.4);
    enemy.hp -= dmg;
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

    this.gold += enemy.reward;
    this.score += Math.floor(enemy.reward * this.wave * (enemy.isBoss ? 5 : 1));
    this.waveKills++;

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

    // Wave-end XP pass — role-based, wave-normalized
    const waveXpBudget = 80 + this.wave * 4; // total XP pool grows with wave
    this._grantWaveEndXp(waveXpBudget);

    this.state = "idle";
    this.waveAI.recordWaveResults({
      enemiesKilled: this.waveKills,
      enemiesLeaked: this.waveLeaks,
      damageByTower: { ...this.waveDamageByTower },
      goldSpent: this.waveGoldSpent,
      wave: this.wave,
      currentTowerCounts: this.towers.reduce((acc, tower) => {
        acc[tower.type] = (acc[tower.type] || 0) + 1;
        return acc;
      }, {}),
    });
    const bonus = ECFG.waveClearBonus + Math.sqrt(this.wave) * 15;
    this.gold += bonus;
    this._addFloatingText(
      this.canvas.width / 2,
      this.canvas.height / 2,
      `Wave ${this.wave} Clear! +${bonus}g`,
      "#4ade80",
    );
    this.minRequiredTowers = this.waveAI.calcMinimumRequiredTowers(
      this.wave + 1,
      this.levelConfig,
    );
    if (!this.isEndless && this.wave >= this.levelConfig.waves) {
      this.state = "victory";
      this.waveAI.finalizeGame(true);
    }
    this._emitState();
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
    const ctx = this.ctx,
      map = this.mapDef;
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
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const isPath = this._isPathCell(col, row);
        const x = col * CELL_SIZE,
          y = row * CELL_SIZE;
        if (isPath) {
          ctx.fillStyle = map.theme.path;
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          // subtle path glow
          ctx.fillStyle = "rgba(255,255,255,0.03)";
          ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        } else {
          // checkerboard depth
          ctx.fillStyle =
            (row + col) % 2 === 0 ? map.theme.bg : _shadeColor(map.theme.bg, 8);
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        }
        // thin grid lines
        ctx.strokeStyle = isPath
          ? map.theme.pathBorder
          : "rgba(255,255,255,0.03)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      }
    }

    // scanline overlay — every 2 rows, faint dark line
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

    // ── Path direction arrows ─────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = map.theme.pathBorder;
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

      _drawTowerShape(ctx, tower, this.tick);
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

      // tier badge
      if (tower.tier > 0) {
        ctx.fillStyle = tower.tier === 2 ? "#fbbf24" : "#38bdf8";
        ctx.beginPath();
        ctx.arc(
          tower.col * CELL_SIZE + CELL_SIZE - 6,
          tower.row * CELL_SIZE + 6,
          6,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.font = "bold 7px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          `T${tower.tier}`,
          tower.col * CELL_SIZE + CELL_SIZE - 6,
          tower.row * CELL_SIZE + 6,
        );
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

    // ── ENDLESS BADGE ─────────────────────────────────────────────────────────
    if (this.isEndless && this.state === "wave") {
      ctx.fillStyle = "rgba(129,140,248,0.9)";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`∞ WAVE ${this.wave}`, W - 8, 18);
    }

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
    this._applyLevel(save.levelId);

    this.wave = save.wave;
    this.gold = save.gold;
    this.lives = save.lives;
    this.score = save.score;
    this.fortifyLevel = save.fortifyLevel || 0;
    this.fortifyCost = save.fortifyCost || ECFG.fortifyCostBase;
    this.selectedTowerType =
      save.selectedTowerType || this.levelConfig.unlockedTowers[0];
    this.towerCatCounts = { ...save.towerCatCounts };

    for (const st of save.towers) {
      const tower = { ...st };
      tower._waveHits = new Set();
      tower.assistTowers = new Set();
      this.towers.push(tower);
      this.grid[tower.row][tower.col] = tower;
    }

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
      })),
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

// ── Helper: darken/lighten a hex color ───────────────────────────────────
function _shadeColor(hex, amt) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

// ── Tower shape renderer ──────────────────────────────────────────────────
// ctx is already translated to tower center
function _drawTowerShape(ctx, tower, tick) {
  const c = tower.color;
  const s = CELL_SIZE * 0.38; // base size

  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = 2;
  ctx.shadowColor = c;
  ctx.shadowBlur = 6;

  switch (tower.type) {
    case "basic": {
      // rotating 4-barrel gatling look
      const rot = tick * 0.04;
      for (let i = 0; i < 4; i++) {
        const a = rot + i * (Math.PI / 2);
        ctx.save();
        ctx.rotate(a);
        ctx.fillStyle = c;
        ctx.fillRect(-2, -s * 0.3, 4, s * 0.7);
        ctx.restore();
      }
      // center hub
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.15, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "sniper": {
      // long single barrel pointing toward last target angle
      const angle = tower._drawAngle || 0;
      ctx.save();
      ctx.rotate(angle);
      // barrel
      ctx.fillStyle = c;
      ctx.fillRect(-2, -s * 0.9, 4, s * 0.9);
      // scope
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-5, -s * 0.55, 10, 6);
      ctx.restore();
      // base
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "cannon": {
      // squat wide barrel
      const angle = tower._drawAngle || 0;
      ctx.save();
      ctx.rotate(angle);
      ctx.fillStyle = c;
      ctx.fillRect(-5, -s * 0.7, 10, s * 0.7);
      // muzzle ring
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -s * 0.7, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "laser": {
      // 3-prong rotating dish
      const rot = tick * 0.06;
      for (let i = 0; i < 3; i++) {
        const a = rot + i * ((Math.PI * 2) / 3);
        ctx.save();
        ctx.rotate(a);
        ctx.fillStyle = c;
        ctx.fillRect(-1.5, -s * 0.75, 3, s * 0.45);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      // pulsing core
      const pulse = 0.5 + 0.5 * Math.sin(tick * 0.2);
      ctx.globalAlpha = pulse * 0.7;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }

    case "freeze": {
      // snowflake 6 arms
      const rot = tick * -0.02;
      for (let i = 0; i < 6; i++) {
        const a = rot + i * (Math.PI / 3);
        ctx.save();
        ctx.rotate(a);
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -s * 0.72);
        ctx.stroke();
        // branch lines
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-3, -s * 0.4);
        ctx.lineTo(3, -s * 0.4);
        ctx.moveTo(-2, -s * 0.58);
        ctx.lineTo(2, -s * 0.58);
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "tesla": {
      // coil rings + electric arc indicator
      for (let ring = 1; ring <= 3; ring++) {
        const r = ring * s * 0.22;
        const alpha = 1 - ring * 0.25;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // lightning symbol in center
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(3, -s * 0.3);
      ctx.lineTo(-1, 0);
      ctx.lineTo(3, 0);
      ctx.lineTo(-3, s * 0.35);
      ctx.lineTo(1, s * 0.05);
      ctx.lineTo(-2, s * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case "inferno": {
      // rotating flame petals
      const rot = tick * 0.05;
      for (let i = 0; i < 5; i++) {
        const a = rot + i * ((Math.PI * 2) / 5);
        ctx.save();
        ctx.rotate(a);
        ctx.fillStyle = i % 2 === 0 ? c : "#ff6600";
        ctx.beginPath();
        ctx.ellipse(0, -s * 0.5, s * 0.15, s * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // core
      ctx.fillStyle = "#ffdd00";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "vortex": {
      // spiral arms
      const rot = tick * 0.07;
      for (let i = 0; i < 4; i++) {
        const a = rot + i * (Math.PI / 2);
        ctx.save();
        ctx.rotate(a);
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s * 0.28, 0, s * 0.28, Math.PI * 0.6, Math.PI * 1.8);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    default: {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.shadowBlur = 0;
}

// ── Enemy shape renderer ──────────────────────────────────────────────────
// ctx is already translated to enemy center
function _drawEnemyShape(ctx, enemy, tick) {
  const c = enemy.color;
  const r = enemy.size;

  ctx.shadowColor = c;
  ctx.shadowBlur = enemy.isBoss ? 14 : 6;

  switch (enemy.type) {
    case "basic": {
      // hexagon grunt
      ctx.fillStyle = c;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
        i === 0
          ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
          : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }

    case "fast": {
      // sharp diamond / arrowhead
      const rot = tick * 0.1;
      ctx.save();
      ctx.rotate(rot);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.3);
      ctx.lineTo(r * 0.7, r * 0.6);
      ctx.lineTo(0, r * 0.3);
      ctx.lineTo(-r * 0.7, r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // speed trail dots
      ctx.globalAlpha = 0.3;
      for (let i = 1; i <= 3; i++) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(0, r * i * 0.7, r * 0.2 * (1 - i * 0.25), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }

    case "armored": {
      // square with corner bolts (tank feel)
      ctx.fillStyle = c;
      const rr = r * 0.9;
      ctx.fillRect(-rr, -rr, rr * 2, rr * 2);
      ctx.fillStyle = "#64748b";
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        ctx.beginPath();
        ctx.arc(dx * rr * 0.7, dy * rr * 0.7, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-rr, -rr, rr * 2, rr * 2);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(-r * 0.35, -r * 0.35, r * 0.7, r * 0.7);
      break;
    }

    case "swarm": {
      // tiny organic circle with 3 spikes
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      const spikeRot = tick * 0.12;
      for (let i = 0; i < 3; i++) {
        const a = spikeRot + i * ((Math.PI * 2) / 3);
        ctx.fillStyle = c;
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.8);
        ctx.lineTo(r * 0.25, -r * 1.5);
        ctx.lineTo(-r * 0.25, -r * 1.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
    }

    case "stealth": {
      // ghostly wispy ring with inner core
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a = tick * 0.05 * (i % 2 === 0 ? 1 : -1);
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }

    case "spread": {
      // flower/brood shape — petals
      for (let i = 0; i < 6; i++) {
        const a = tick * 0.02 + i * (Math.PI / 3);
        ctx.save();
        ctx.rotate(a);
        ctx.fillStyle = i % 2 === 0 ? c : "#f0abfc";
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.7, r * 0.3, r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    // ── Bosses ──────────────────────────────────────────────────────────────

    case "boss_colossus": {
      // thick armored walker
      const pulse = 0.8 + 0.2 * Math.sin(tick * 0.1);
      ctx.fillStyle = enemy.phaseTriggered ? "#ff2200" : c;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rr = i % 2 === 0 ? r : r * 0.7;
        i === 0
          ? ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr)
          : ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      // armor rings
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.85 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      if (enemy.phaseTriggered) {
        ctx.globalAlpha = 0.4 + 0.3 * Math.sin(tick * 0.25);
        ctx.strokeStyle = "#ff2200";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      break;
    }

    case "boss_phantom": {
      // stealth wraith with rotating rings
      const rot = tick * 0.06;
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate(rot + i * ((Math.PI * 2) / 3));
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(tick * 0.08 + i);
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.1, r * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "boss_titan": {
      // hive hexagon + spawning indicator ring
      ctx.fillStyle = c;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        i === 0
          ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
          : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      // inner cells
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.fillStyle = "#0f172a";
        ctx.beginPath();
        ctx.arc(
          Math.cos(a) * r * 0.55,
          Math.sin(a) * r * 0.55,
          r * 0.22,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      // spawn ring pulse
      const spawnPulse = 0.3 + 0.4 * Math.abs(Math.sin(tick * 0.07));
      ctx.globalAlpha = spawnPulse;
      ctx.strokeStyle = "#fb923c";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }

    case "boss_voidreaper": {
      // void orb with dark tentacles
      const rot = tick * 0.04;
      for (let i = 0; i < 8; i++) {
        const a = rot + i * (Math.PI / 4);
        const len = r * (0.9 + 0.3 * Math.sin(tick * 0.1 + i));
        ctx.save();
        ctx.rotate(a);
        ctx.strokeStyle = c;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.5);
        ctx.quadraticCurveTo(r * 0.4, -r * 0.7, 0, -len);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      const glowAlpha = 0.4 + 0.3 * Math.sin(tick * 0.12);
      ctx.globalAlpha = glowAlpha;
      ctx.fillStyle = "#818cf8";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }

    default: {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.shadowBlur = 0;
}

// ── Projectile renderer ───────────────────────────────────────────────────
function _drawProjectile(ctx, p, tick) {
  // const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);

  switch (p.towerType) {
    case "basic": {
      // glowing green bullet with short trail
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      for (let t = 1; t <= 4; t++) {
        ctx.globalAlpha = (0.15 * (5 - t)) / 4;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(
          p.x - p.vx * t * 1.2,
          p.y - p.vy * t * 1.2,
          p.size * (1 - t * 0.18),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(
        p.x - p.size * 0.3,
        p.y - p.size * 0.3,
        p.size * 0.28,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      break;
    }

    case "sniper": {
      // white tracer streak — thin and fast
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 10;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 5, p.y - p.vy * 5);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
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
      // beam line from origin to tip
      const dx = p.x - (p.originX || p.x);
      const dy = p.y - (p.originY || p.y);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 1) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(p.originX || p.x, p.originY || p.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
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
    basic: 1.2,
    sniper: 2.0,
    cannon: 0.8,
    laser: 0.6,
    freeze: 0.4,
    tesla: 1.0,
    inferno: 0.9,
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
