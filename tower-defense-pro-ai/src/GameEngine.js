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

const VCFG = ADMIN_CONFIG.visual;
const ECFG = ADMIN_CONFIG.economy;

export class GameEngine {
  constructor(canvas, onStateChange, levelId = 1) {
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
    // Endless rotates maps
    const mapKey = isEndless ? "valley" : lvl.map || "valley";
    this.mapDef = MAPS[mapKey] || MAPS.valley;

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
    this.animFrame = null;
    this.path = this._buildPath(this.mapDef.waypoints);
    this.pathCells = this._buildPathCells(this.mapDef.waypoints);
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
    const upgDef = TOWER_UPGRADES[this.selectedTowerType];
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
      // Upgrade tracking
      xp: 0,
      tier: 0, // 0=base, 1=tier1 chosen, 2=tier2 chosen
      chosenPath: null, // 'A' or 'B'
      tier2Path: null,
      xpToTier1: upgDef?.xpToTier1 || 999,
      xpToTier2: upgDef?.xpToTier2 || 999,
      upgradeReady: false, // XP threshold hit, awaiting player buy
      // Specials from upgrades
      specials: [],
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
  upgradeTower(col, row, tier, path) {
    const tower = this.grid[row]?.[col];
    if (!tower) return false;
    const upgDef = TOWER_UPGRADES[tower.type];
    if (!upgDef) return false;

    const tierDef = tier === 1 ? upgDef.tier1[path] : upgDef.tier2[path];
    if (!tierDef) return false;
    if (this.gold < tierDef.cost) {
      this._addFloatingText(
        tower.x,
        tower.y - 20,
        `Need ${tierDef.cost}g`,
        "#ef4444",
      );
      return false;
    }
    if (tier === 1 && tower.tier >= 1) return false;
    if (tier === 2 && tower.tier < 1) return false;
    if (tier === 2 && tower.tier >= 2) return false;

    // Check XP unlock
    if (tier === 1 && tower.xp < tower.xpToTier1) {
      this._addFloatingText(
        tower.x,
        tower.y - 20,
        "Not enough XP yet",
        "#f97316",
      );
      return false;
    }
    if (tier === 2 && tower.xp < tower.xpToTier2) {
      this._addFloatingText(
        tower.x,
        tower.y - 20,
        "Not enough XP yet",
        "#f97316",
      );
      return false;
    }

    this.gold -= tierDef.cost;
    this._applyUpgrade(tower, tierDef, tier, path);
    this._addParticles(tower.x, tower.y, "#facc15", 18);
    this._addFloatingText(
      tower.x,
      tower.y - 20,
      `↑ ${tierDef.name}!`,
      "#facc15",
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
          // Shatter synergy: burning enemies take extra from cannon splash (handled in projectile)
          e.hp -= burnDmg;
          if (e.hp <= 0) {
            this._killEnemy(e);
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
    if (!proj?.armorPiercing) dmg *= 1 - enemy.armor;
    // Armor melt special
    if (proj?.specials?.includes("armorMelt") && enemy.burnTimer > 0)
      enemy.armor = Math.max(0, enemy.armor - 0.4);
    enemy.hp -= dmg;
    if (proj?.slowDuration && !enemy.immunities.includes(proj.towerType))
      enemy.slowTimer = proj.slowDuration;
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
      if (proj.specials?.includes("burnStack"))
        enemy.burnStacks = Math.min(3, (enemy.burnStacks || 0) + 1);
    }
    const tt = proj?.towerType;
    if (tt) {
      this.waveDamageByTower[tt] = (this.waveDamageByTower[tt] || 0) + dmg;
      const tower = this.towers.find((t) => t.id === proj.towerId);
      if (tower) {
        tower.totalDamage += dmg;
        tower.xp += Math.sqrt(dmg) * 0.4 + (enemy.isBoss ? 4 : 0.5);
        if (tower.xp >= tower.xpToTier1 && tower.tier < 1)
          tower.upgradeReady = true;
        if (tower.xp >= tower.xpToTier2 && tower.tier === 1)
          tower.upgradeReady = true;
      }
    }
    if (enemy.hp <= 0) this._killEnemy(enemy, proj?.towerType, proj?.towerId);
  }

  _killEnemy(enemy, towerType, towerId) {
    const idx = this.enemies.indexOf(enemy);
    if (idx === -1) return;
    this.gold += enemy.reward;
    this.score += Math.floor(enemy.reward * this.wave * (enemy.isBoss ? 5 : 1));
    this.waveKills++;
    if (enemy.isBoss) {
      this.waveAI.recordBossResult(enemy.type, true, towerType);
      this._triggerBossLoot(enemy);
    }
    const tower = this.towers.find((t) => t.id === towerId);
    if (tower) {
      tower.kills++;
      if (enemy.assistTowers?.size > 0) {
        const assistXp = enemy.isBoss ? 8 : 1.5;
        for (const assistId of enemy.assistTowers) {
          if (assistId === towerId) continue; // killer already got their XP above
          const assistTower = this.towers.find((t) => t.id === assistId);
          if (assistTower) {
            assistTower.xp += assistXp;
            assistTower.kills; // don't increment kills — just XP
            if (assistTower.xp >= assistTower.xpToTier1 && assistTower.tier < 1)
              assistTower.upgradeReady = true;
            if (
              assistTower.xp >= assistTower.xpToTier2 &&
              assistTower.tier === 1
            )
              assistTower.upgradeReady = true;
          }
        }
      }
      tower.xp += enemy.isBoss ? 10 : 1;
      if (tower.xp >= tower.xpToTier1 && tower.tier < 1)
        tower.upgradeReady = true;
      if (tower.xp >= tower.xpToTier2 && tower.tier === 1)
        tower.upgradeReady = true;
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
    if (this.state !== "wave") return;
    if (this.spawnQueue.length > 0 || this.enemies.length > 0) return;
    this.state = "idle";
    this.waveAI.recordWaveResults({
      enemiesKilled: this.waveKills,
      enemiesLeaked: this.waveLeaks,
      damageByTower: { ...this.waveDamageByTower },
      goldSpent: this.waveGoldSpent,
      wave: this.wave,
    });
    const bonus = ECFG.waveClearBonus + this.wave * ECFG.waveClearBonusPerWave;
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

  // ══════════════════════════════════════════════════════════════════════════════
  //  DRAWING
  // ══════════════════════════════════════════════════════════════════════════════
  _draw() {
    const ctx = this.ctx,
      map = this.mapDef;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Grid
    for (let row = 0; row < GRID_ROWS; row++)
      for (let col = 0; col < GRID_COLS; col++) {
        const isPath = this._isPathCell(col, row);
        ctx.fillStyle = isPath ? map.theme.path : map.theme.bg;
        ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        ctx.strokeStyle = isPath ? map.theme.pathBorder : "#1e293b";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }

    // Path arrows
    ctx.strokeStyle = map.theme.pathBorder;
    ctx.lineWidth = 1;
    for (let i = 0; i < this.path.length - 5; i += 10) {
      const a = this.path[i],
        b = this.path[Math.min(i + 5, this.path.length - 1)];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(3, 0);
      ctx.lineTo(1, -2);
      ctx.moveTo(3, 0);
      ctx.lineTo(1, 2);
      ctx.stroke();
      ctx.restore();
    }

    // Last-stand border pulse
    if (this.lastStandActive) {
      const alpha = 0.3 + 0.3 * Math.sin(this.tick * 0.2);
      ctx.strokeStyle = `rgba(239,68,68,${alpha})`;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, this.canvas.width - 8, this.canvas.height - 8);
    }

    // Global buff banner
    if (this.globalBuff.timer > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, this.canvas.width, 24);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `${this.globalBuff.label}  [${Math.ceil(this.globalBuff.timer / 60)}s]`,
        this.canvas.width / 2,
        12,
      );
    }

    // Hover
    if (this.hoveredCell && !["gameover", "victory"].includes(this.state)) {
      const { col, row } = this.hoveredCell;
      const check = this.canPlaceTower(col, row, this.selectedTowerType);
      ctx.fillStyle = check.ok
        ? "rgba(74,222,128,0.2)"
        : "rgba(239,68,68,0.15)";
      ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      if (check.ok) {
        const tDef = TOWER_TYPES[this.selectedTowerType];
        ctx.beginPath();
        ctx.arc(
          col * CELL_SIZE + CELL_SIZE / 2,
          row * CELL_SIZE + CELL_SIZE / 2,
          tDef.range,
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle = "rgba(74,222,128,0.25)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "rgba(74,222,128,0.05)";
        ctx.fill();
      }
    }

    // Towers
    for (const tower of this.towers) {
      const x = tower.col * CELL_SIZE,
        y = tower.row * CELL_SIZE;
      const isSelected =
        this.selectedTowerCell?.col === tower.col &&
        this.selectedTowerCell?.row === tower.row;

      // Last-stand tint
      if (this.lastStandActive) {
        ctx.fillStyle = "rgba(239,68,68,0.15)";
        ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      }

      ctx.fillStyle = "#1e293b";
      ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      ctx.strokeStyle = isSelected ? "#ffffff" : tower.color;
      ctx.lineWidth = isSelected ? 2.5 : 2;
      ctx.strokeRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);

      // Tier badge
      if (tower.tier > 0) {
        ctx.fillStyle = tower.tier === 2 ? "#fbbf24" : "#38bdf8";
        ctx.fillRect(x + CELL_SIZE - 10, y + 2, 9, 9);
        ctx.fillStyle = "#000";
        ctx.font = "bold 7px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`T${tower.tier}`, x + CELL_SIZE - 5.5, y + 6.5);
      }

      // Upgrade ready glow
      if (tower.upgradeReady) {
        const pulse = 0.5 + 0.5 * Math.sin(this.tick * 0.15);
        ctx.strokeStyle = `rgba(255,215,0,${pulse})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        ctx.fillStyle = "#facc15";
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.fillText("↑", x + CELL_SIZE / 2, y + CELL_SIZE - 4);
      }

      ctx.font = `${Math.round(CELL_SIZE * 0.52)}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tower.icon, x + CELL_SIZE / 2, y + CELL_SIZE / 2);

      // Cooldown bar
      if (tower.cooldown > 0) {
        ctx.fillStyle = tower.color + "55";
        ctx.fillRect(
          x + 2,
          y + CELL_SIZE - 5,
          (CELL_SIZE - 4) * (1 - tower.cooldown / tower.fireRate),
          3,
        );
      }
    }

    // Enemies
    for (const enemy of this.enemies) {
      ctx.globalAlpha = enemy.stealth ? 0.45 : 1;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(
        enemy.x,
        enemy.y + enemy.size * 0.75,
        enemy.size * 0.75,
        enemy.size * 0.28,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = enemy.color;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.size, 0, Math.PI * 2);
      ctx.fill();
      if (enemy.isBoss) {
        ctx.strokeStyle = enemy.phaseTriggered ? "#ff2200" : "#ff8800";
        ctx.lineWidth = enemy.phaseTriggered ? 3 : 2;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.size + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (enemy.slowTimer > 0) {
        ctx.strokeStyle = "#a5f3fc";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.size + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (enemy.burnTimer > 0) {
        ctx.strokeStyle = `rgba(255,100,0,${0.4 + 0.4 * Math.sin(this.tick * 0.3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.size + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (enemy.armor > 0.2) {
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.size * 0.68, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (enemy.stunTimer > 0) {
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.size + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Emoji icon
      ctx.globalAlpha = enemy.stealth ? 0.6 : 1;
      ctx.font = `${Math.round(enemy.size * 1.5)}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(enemy.icon, enemy.x, enemy.y);
      ctx.globalAlpha = 1;

      // IMMUNE label above stealth/immune enemies
      if (
        enemy.requiresCounter &&
        !this.towers.some((t) => t.type === enemy.requiresCounter)
      ) {
        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.fillText("⚠ NEED LASER", enemy.x, enemy.y - enemy.size - 14);
      }

      // HP bar — boss gets wider bar + numeric HP display
      const bw = enemy.isBoss ? enemy.size * 3.8 : enemy.size * 2.6;
      const bh = enemy.isBoss ? 5 : 3;
      const bx = enemy.x - bw / 2,
        by = enemy.y - enemy.size - (enemy.isBoss ? 14 : 7);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(bx, by, bw, bh);
      const r = enemy.hp / enemy.maxHp;
      ctx.fillStyle = r > 0.55 ? "#4ade80" : r > 0.28 ? "#facc15" : "#ef4444";
      ctx.fillRect(bx, by, bw * r, bh);
      // Boss: show numeric HP so player knows their damage is registering
      if (enemy.isBoss) {
        ctx.fillStyle = r > 0.28 ? "#fde68a" : "#fca5a5";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const hpK =
          enemy.hp >= 1000
            ? `${(enemy.hp / 1000).toFixed(1)}k`
            : Math.ceil(enemy.hp);
        const maxK =
          enemy.maxHp >= 1000
            ? `${(enemy.maxHp / 1000).toFixed(1)}k`
            : Math.ceil(enemy.maxHp);
        ctx.fillText(`${hpK} / ${maxK}`, enemy.x, by - 1);
        ctx.textBaseline = "alphabetic";
      }
    }

    // Projectiles
    for (const p of this.projectiles) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color + "66";
      ctx.beginPath();
      ctx.arc(p.x - p.vx * 2, p.y - p.vy * 2, p.size * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Tesla bolt effects ────────────────────────────────────────────────────
    for (const bolt of this.boltEffects) {
      const alpha = bolt.life / bolt.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = bolt.color;
      ctx.lineWidth = 1.5 + alpha * 1.5;
      ctx.shadowColor = bolt.color;
      ctx.shadowBlur = 8 + alpha * 6;
      // Jagged two-segment arc through randomized midpoint
      ctx.beginPath();
      ctx.moveTo(bolt.x1, bolt.y1);
      ctx.lineTo(bolt.mx, bolt.my);
      ctx.lineTo(bolt.x2, bolt.y2);
      ctx.stroke();
      // Inner bright core line
      ctx.globalAlpha = alpha * 0.6;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.5;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(bolt.x1, bolt.y1);
      ctx.lineTo(bolt.mx, bolt.my);
      ctx.lineTo(bolt.x2, bolt.y2);
      ctx.stroke();
      ctx.restore();
    }

    // Particles
    for (const p of this.particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Floating texts
    for (const t of this.floatingTexts) {
      ctx.globalAlpha = t.life / 75;
      ctx.fillStyle = t.color;
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    // Boss warning
    if (this.bossWarningTimer > 0) {
      this.bossWarningTimer--;
      const alpha =
        Math.min(1, this.bossWarningTimer / 30) *
        Math.abs(Math.sin(this.tick * 0.15));
      const bDef = ENEMY_TYPES[this.bossWarningType];
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#1a0000";
      ctx.fillRect(0, this.canvas.height / 2 - 44, this.canvas.width, 88);
      ctx.globalAlpha = Math.min(1, alpha * 2);
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 26px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `⚠ BOSS: ${bDef?.name || "???"} ${bDef?.icon || "💀"} ⚠`,
        this.canvas.width / 2,
        this.canvas.height / 2 - 18,
      );
      ctx.fillStyle = "#fca5a5";
      ctx.font = "13px monospace";
      ctx.fillText(
        bDef?.weaknessHint || "Find its weakness!",
        this.canvas.width / 2,
        this.canvas.height / 2 + 4,
      );
      if (bDef?.immunities?.length) {
        ctx.fillStyle = "#f87171";
        ctx.font = "11px monospace";
        ctx.fillText(
          `IMMUNE TO: ${bDef.immunities.map((i) => TOWER_TYPES[i]?.name || i).join(", ")}`,
          this.canvas.width / 2,
          this.canvas.height / 2 + 22,
        );
      }
      ctx.globalAlpha = 1;
    }

    // Endless wave badge
    if (this.isEndless && this.state === "wave") {
      ctx.fillStyle = "rgba(129,140,248,0.9)";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`∞ WAVE ${this.wave}`, this.canvas.width - 8, 18);
    }

    // Overlays
    if (this.state === "gameover" || this.state === "victory") {
      const won = this.state === "victory";
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = won ? "#4ade80" : "#ef4444";
      ctx.font = "bold 44px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        won ? "⚡ VICTORY! ⚡" : "💀 GAME OVER 💀",
        this.canvas.width / 2,
        this.canvas.height / 2 - 36,
      );
      ctx.fillStyle = "#94a3b8";
      ctx.font = "17px monospace";
      ctx.fillText(
        `Score: ${this.score.toLocaleString()}`,
        this.canvas.width / 2,
        this.canvas.height / 2 + 10,
      );
      ctx.fillText(
        this.isEndless
          ? `Survived ${this.wave} waves!`
          : won
            ? "The AI could not stop you."
            : "The AI has defeated you.",
        this.canvas.width / 2,
        this.canvas.height / 2 + 36,
      );
    }
  }

  _loop() {
    this.tick++;
    if (this.state === "wave") {
      this._updateSpawning();
      this._updateEnemies();
      this._updateTowers();
      this._updateProjectiles();
      this._checkWaveComplete();
    }
    this._updateParticles();
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
      levelId: this.levelId,
      levelName: lvl.name,
      mapName: this.mapDef.name,
      isEndless: this.isEndless,
      enemyCount: this.enemies.length,
      spawnRemaining: this.spawnQueue.length,
      aiSummary: this.waveAI.getAdaptationSummary(),
      nextWaveMessage: this.nextWaveMessage,
      lastEnemyTypes: this.lastEnemyTypes,
      minRequiredTowers: this.minRequiredTowers,
      bossWaves: lvl.bossWaves || {},
      unlockedTowers: lvl.unlockedTowers,
      towerCaps: lvl.towerCaps,
      towerCatCounts: { ...this.towerCatCounts },
      activeSynergies: this.activeSynergies,
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
        tier: t.tier,
        xp: Math.floor(t.xp),
        xpToTier1: t.xpToTier1,
        xpToTier2: t.xpToTier2,
        upgradeReady: t.upgradeReady,
        chosenPath: t.chosenPath,
        tier2Path: t.tier2Path,
        specials: t.specials,
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
}
