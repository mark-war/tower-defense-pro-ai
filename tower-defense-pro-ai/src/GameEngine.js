import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  TOWER_TYPES,
  ENEMY_TYPES,
  MAPS,
  LEVELS,
  ADMIN_CONFIG,
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
    const lvl = LEVELS.find((l) => l.id === levelId) || LEVELS[0];
    this.levelConfig = lvl;
    this.mapDef = MAPS[lvl.map] || MAPS.valley;

    this.grid = Array.from({ length: GRID_ROWS }, () =>
      Array(GRID_COLS).fill(null),
    );
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.floatingTexts = [];
    this.burnEffects = []; // { enemyId, damage, remaining }

    this.gold = lvl.startGold;
    this.lives = lvl.startLives;
    this.wave = 0;
    this.score = 0;
    this.state = "idle";
    this.selectedTowerType = lvl.unlockedTowers[0] || "basic";
    this.hoveredCell = null;

    // Category placement counts
    this.towerCatCounts = { attack: 0, support: 0, tech: 0 };

    this.waveAI = new WaveAI(lvl);
    this.currentWaveData = null;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.waveKills = 0;
    this.waveLeaks = 0;
    this.waveDamageByTower = {};
    this.waveGoldSpent = 0;
    this.nextWaveMessage = "Deploy towers, then start wave.";
    this.bossWarningTimer = 0;
    this.bossWarningType = null;
    this.lastEnemyTypes = []; // what's in current wave (for HUD icons)
    this.minRequiredTowers = {};

    this.tick = 0;
    this.animFrame = null;

    this.path = this._buildPath(this.mapDef.waypoints);
    this.pathCells = this._buildPathCells(this.mapDef.waypoints);
  }

  _setupCanvas() {
    this.canvas.width = GRID_COLS * CELL_SIZE;
    this.canvas.height = GRID_ROWS * CELL_SIZE;
  }

  // ── Path building ───────────────────────────────────────────────────────────
  _buildPath(waypoints) {
    const points = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i],
        b = waypoints[i + 1];
      const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
      for (let s = 0; s <= steps; s++) {
        points.push({
          x:
            (a.col + ((b.col - a.col) * s) / steps) * CELL_SIZE + CELL_SIZE / 2,
          y:
            (a.row + ((b.row - a.row) * s) / steps) * CELL_SIZE + CELL_SIZE / 2,
        });
      }
    }
    return points;
  }

  _buildPathCells(waypoints) {
    const cells = new Set();
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i],
        b = waypoints[i + 1];
      const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
      for (let s = 0; s <= steps; s++) {
        cells.add(
          `${Math.round(a.col + ((b.col - a.col) * s) / steps)},${Math.round(a.row + ((b.row - a.row) * s) / steps)}`,
        );
      }
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
    // Category cap
    const cat = tDef.category;
    const caps = this.levelConfig.towerCaps;
    const used = this.towerCatCounts[cat] || 0;
    const limit = caps[cat] ?? 99;
    if (used >= limit)
      return { ok: false, reason: `${cat} cap reached (${limit})` };
    return { ok: true };
  }

  placeTower(col, row) {
    const check = this.canPlaceTower(col, row, this.selectedTowerType);
    if (!check.ok) {
      if (
        check.reason &&
        check.reason !== "On path" &&
        check.reason !== "Cell occupied"
      ) {
        this._addFloatingText(
          col * CELL_SIZE + CELL_SIZE / 2,
          row * CELL_SIZE,
          check.reason,
          "#ef4444",
        );
      }
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
      ...tDef,
    };
    this.grid[row][col] = tower;
    this.towers.push(tower);
    this.gold -= tDef.cost;
    this.waveGoldSpent += tDef.cost;
    this.towerCatCounts[tDef.category] =
      (this.towerCatCounts[tDef.category] || 0) + 1;
    this.waveAI.recordTowerPlacement(this.selectedTowerType, { col, row });
    this._addParticles(tower.x, tower.y, tDef.color, 10);
    this._emitState();
    return true;
  }

  sellTower(col, row) {
    const tower = this.grid[row]?.[col];
    if (!tower) return;
    const refund = Math.floor(tower.cost * ECFG.towerSellRatio);
    this.gold += refund;
    this.grid[row][col] = null;
    this.towers = this.towers.filter((t) => t.id !== tower.id);
    this.towerCatCounts[tower.category] = Math.max(
      0,
      (this.towerCatCounts[tower.category] || 1) - 1,
    );
    this._addFloatingText(tower.x, tower.y, `+${refund}g`, "#facc15");
    this.waveAI.recordTowerPlacement("sell_" + tower.type, { col, row });
    this._emitState();
  }

  // ── Wave management ─────────────────────────────────────────────────────────
  startWave() {
    if (this.state !== "idle") return;
    this.wave++;

    // Boss warning
    const bossType = this.levelConfig.bossWaves[this.wave];
    if (bossType && ENEMY_TYPES[bossType]) {
      this.bossWarningType = bossType;
      this.bossWarningTimer = VCFG.bossWarningFrames;
    }

    const waveData = this.waveAI.generateWave(
      this.wave,
      this.levelConfig.waves,
      this.levelConfig,
    );
    this.currentWaveData = waveData;
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

  // ── Spawning ────────────────────────────────────────────────────────────────
  _spawnEnemy(data) {
    const def = ENEMY_TYPES[data.type];
    if (!def) return;
    const isBoss = !!def.isBoss;
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
      burnTimer: 0,
      burnDmg: 0,
      spawnsOnDeath: def.spawnsOnDeath || null,
      spawnCount: def.spawnCount || 0,
      distanceTraveled: 0,
      name: def.name,
      icon: def.icon || "👾",
      isBoss,
      phaseTriggered: false,
      phaseDef: def.phaseAt ? { at: def.phaseAt, boost: def.phaseBoost } : null,
      spawnOnDmg: def.spawnsOnDamage
        ? { ...def.spawnsOnDamage, timer: 0 }
        : null,
      immunities: def.immunities || [],
      weakness: def.weakness || null,
      weaknessHint: def.weaknessHint || null,
      bossAbility: def.bossAbility || null,
    };
    this.enemies.push(e);
  }

  _updateSpawning() {
    if (this.spawnQueue.length === 0) return;
    this.spawnTimer++;
    const next = this.spawnQueue[0];
    if (this.spawnTimer >= next.spawnDelay) {
      this._spawnEnemy(next);
      this.spawnQueue.shift();
      if (this.spawnQueue.length > 0) {
        const gap = this.spawnQueue[0].spawnDelay - next.spawnDelay;
        this.spawnTimer = 0;
        this.spawnQueue[0] = { ...this.spawnQueue[0], spawnDelay: gap };
      }
    }
  }

  // ── Enemy update ────────────────────────────────────────────────────────────
  _updateEnemies() {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      // Slow
      if (e.slowTimer > 0) {
        e.slowTimer--;
        e.speed = e.baseSpeed * 0.38;
      } else {
        e.speed = e.baseSpeed;
      }

      // Burn DoT
      if (e.burnTimer > 0) {
        e.burnTimer--;
        if (e.burnTimer % 20 === 0) {
          e.hp -= e.burnDmg;
          if (e.hp <= 0) {
            this._killEnemy(e);
            continue;
          }
        }
      }

      // Boss: spawn-on-damage timer
      if (e.spawnOnDmg) {
        e.spawnOnDmg.timer++;
        if (e.spawnOnDmg.timer >= e.spawnOnDmg.every) {
          e.spawnOnDmg.timer = 0;
          for (let s = 0; s < e.spawnOnDmg.count; s++) {
            this._spawnChildAt(e, e.spawnOnDmg.type);
          }
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
        const boost = e.phaseDef.boost;
        if (boost.speed) e.baseSpeed *= boost.speed;
        if (boost.armorDelta)
          e.armor = Math.max(0, Math.min(0.9, e.baseArmor + boost.armorDelta));
        this._addParticles(e.x, e.y, "#ff0000", 25);
        this._addFloatingText(e.x, e.y - 20, "⚠ PHASE 2!", "#ff4444");
      }

      // Move along path
      const target = this.path[e.pathIndex + 1];
      if (!target) {
        this.lives = Math.max(0, this.lives - (e.isBoss ? 5 : 1));
        this.waveLeaks++;
        this._addFloatingText(
          this.path[this.path.length - 1].x,
          this.path[this.path.length - 1].y,
          e.isBoss ? "-5 ❤️" : "-1 ❤️",
          "#ef4444",
        );
        this.enemies.splice(i, 1);
        if (this.lives <= 0) {
          this.state = "gameover";
          this._emitState();
        }
        continue;
      }
      const dx = target.x - e.x,
        dy = target.y - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < e.speed) {
        e.pathIndex++;
        e.x = target.x;
        e.y = target.y;
      } else {
        e.x += (dx / dist) * e.speed;
        e.y += (dy / dist) * e.speed;
      }
      e.distanceTraveled += e.speed;
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
      weaknessHint: null,
      bossAbility: null,
    });
  }

  // ── Tower firing ─────────────────────────────────────────────────────────────
  _updateTowers() {
    for (const tower of this.towers) {
      if (tower.cooldown > 0) {
        tower.cooldown--;
        continue;
      }

      // Find best target (furthest along path, respecting stealth)
      let target = null;
      for (const enemy of this.enemies) {
        if (enemy.stealth && tower.type !== "laser") continue;
        // Immunity check — this tower type is in the enemy's immunity list
        if (enemy.immunities.includes(tower.type)) continue;
        const dx = enemy.x - tower.x,
          dy = enemy.y - tower.y;
        if (Math.sqrt(dx * dx + dy * dy) <= tower.range) {
          if (!target || enemy.distanceTraveled > target.distanceTraveled)
            target = enemy;
        }
      }
      if (!target) continue;

      this._fireProjectile(tower, target);
      tower.cooldown = tower.fireRate;
    }
  }

  _fireProjectile(tower, target) {
    const dx = target.x - tower.x,
      dy = target.y - tower.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this.projectiles.push({
      id: Date.now() + Math.random(),
      x: tower.x,
      y: tower.y,
      vx: (dx / dist) * tower.projectileSpeed,
      vy: (dy / dist) * tower.projectileSpeed,
      damage: tower.damage,
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
    });
  }

  // ── Projectile update ────────────────────────────────────────────────────────
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
        if (e.stealth && !p.armorPiercing && p.towerType !== "laser") continue;
        // Skip if immune to this tower type
        if (e.immunities.includes(p.towerType)) continue;

        const dx = e.x - p.x,
          dy = e.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < e.size + p.size) {
          hit = true;
          if (p.splash > 0 || p.pullForce > 0) {
            for (const se of this.enemies) {
              if (se.immunities.includes(p.towerType)) continue;
              const sd = Math.sqrt((se.x - p.x) ** 2 + (se.y - p.y) ** 2);
              if (sd < p.splash) {
                const falloff = 1 - (sd / p.splash) * 0.5;
                this._damageEnemy(se, p.damage * falloff, p);
                // Vortex pull
                if (p.pullForce > 0 && sd > 2) {
                  const angle = Math.atan2(p.y - se.y, p.x - se.x);
                  se.x += Math.cos(angle) * p.pullForce * (1 - sd / p.splash);
                  se.y += Math.sin(angle) * p.pullForce * (1 - sd / p.splash);
                }
              }
            }
            this._addParticles(p.x, p.y, p.color, 14);
          } else {
            this._damageEnemy(e, p.damage, p);
            // Tesla chain
            if (p.chainTargets > 0) this._chainLightning(e, p, p.chainTargets);
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

  _chainLightning(origin, proj, remaining) {
    if (remaining <= 0) return;
    let nearest = null,
      bestDist = proj.chainRange;
    for (const e of this.enemies) {
      if (e === origin || e.immunities.includes(proj.towerType)) continue;
      const d = Math.sqrt((e.x - origin.x) ** 2 + (e.y - origin.y) ** 2);
      if (d < bestDist) {
        bestDist = d;
        nearest = e;
      }
    }
    if (!nearest) return;
    this._damageEnemy(nearest, proj.damage * 0.7, proj);
    this._addParticles(nearest.x, nearest.y, proj.color, 6);
    this._chainLightning(nearest, proj, remaining - 1);
  }

  _damageEnemy(enemy, rawDmg, proj) {
    let dmg = rawDmg;
    if (!proj.armorPiercing) dmg *= 1 - enemy.armor;
    enemy.hp -= dmg;

    // Slow
    if (proj.slowDuration && !enemy.immunities.includes(proj.towerType)) {
      enemy.slowTimer = proj.slowDuration;
    }
    // Burn
    if (proj.burnDamage && proj.burnDuration) {
      enemy.burnTimer = proj.burnDuration;
      enemy.burnDmg = proj.burnDamage;
    }

    // Track damage
    const tt = proj.towerType;
    if (tt) {
      this.waveDamageByTower[tt] = (this.waveDamageByTower[tt] || 0) + dmg;
      const tower = this.towers.find((t) => t.id === proj.towerId);
      if (tower) tower.totalDamage += dmg;
    }

    if (enemy.hp <= 0) this._killEnemy(enemy, proj.towerType, proj.towerId);
  }

  _killEnemy(enemy, towerType, towerId) {
    const idx = this.enemies.indexOf(enemy);
    if (idx === -1) return;

    this.gold += enemy.reward;
    this.score += Math.floor(enemy.reward * this.wave * (enemy.isBoss ? 5 : 1));
    this.waveKills++;

    if (enemy.isBoss) {
      this.waveAI.recordBossResult(enemy.type, true, towerType);
    }

    const tower = this.towers.find((t) => t.id === towerId);
    if (tower) tower.kills++;

    this._addParticles(enemy.x, enemy.y, enemy.color, enemy.isBoss ? 30 : 10);
    this._addFloatingText(
      enemy.x,
      enemy.y - 12,
      `+${enemy.reward}g${enemy.isBoss ? " 💀" : ""}`,
      enemy.isBoss ? "#ff4444" : "#facc15",
    );

    // Spawn children
    if (enemy.spawnsOnDeath && enemy.spawnCount > 0) {
      for (let i = 0; i < enemy.spawnCount; i++)
        this._spawnChildAt(enemy, enemy.spawnsOnDeath);
    }

    this.enemies.splice(idx, 1);
    this._emitState();
  }

  // ── Particles & floating text ────────────────────────────────────────────────
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
    this.floatingTexts.push({ x, y, text, color, life: 60, vy: -0.9 });
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

  // ── Wave completion ──────────────────────────────────────────────────────────
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
      `Wave Clear! +${bonus}g`,
      "#4ade80",
    );

    this.minRequiredTowers = this.waveAI.calcMinimumRequiredTowers(
      this.wave + 1,
      this.levelConfig,
    );

    if (this.wave >= this.levelConfig.waves) {
      this.state = "victory";
      this.waveAI.finalizeGame(true);
    }
    this._emitState();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  DRAWING
  // ══════════════════════════════════════════════════════════════════════════════
  _draw() {
    const ctx = this.ctx;
    const map = this.mapDef;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // ── Grid ──────────────────────────────────────────────────────────────────
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const isPath = this._isPathCell(col, row);
        ctx.fillStyle = isPath ? map.theme.path : map.theme.bg;
        ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        ctx.strokeStyle = isPath
          ? map.theme.pathBorder
          : map.theme.bg === "#0f172a"
            ? "#1e293b"
            : map.theme.pathBorder;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }

    // ── Path arrows ───────────────────────────────────────────────────────────
    ctx.strokeStyle = map.theme.pathBorder;
    ctx.lineWidth = 1;
    for (let i = 0; i < this.path.length - 5; i += 10) {
      const a = this.path[i],
        b = this.path[Math.min(i + 5, this.path.length - 1)];
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(3, 0);
      ctx.lineTo(1, -2);
      ctx.moveTo(3, 0);
      ctx.lineTo(1, 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── Hover preview ─────────────────────────────────────────────────────────
    if (
      this.hoveredCell &&
      this.state !== "gameover" &&
      this.state !== "victory"
    ) {
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

    // ── Towers ────────────────────────────────────────────────────────────────
    for (const tower of this.towers) {
      const x = tower.col * CELL_SIZE,
        y = tower.row * CELL_SIZE;
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      ctx.strokeStyle = tower.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      ctx.font = `${Math.round(CELL_SIZE * 0.55)}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tower.icon, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
      // Cooldown bar
      if (tower.cooldown > 0) {
        const prog = 1 - tower.cooldown / tower.fireRate;
        ctx.fillStyle = tower.color + "55";
        ctx.fillRect(x + 2, y + CELL_SIZE - 5, (CELL_SIZE - 4) * prog, 3);
      }
    }

    // ── Enemies ───────────────────────────────────────────────────────────────
    for (const enemy of this.enemies) {
      const alpha = enemy.stealth ? 0.45 : 1;
      ctx.globalAlpha = alpha;

      // Shadow
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

      // Body circle
      ctx.fillStyle = enemy.color;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.size, 0, Math.PI * 2);
      ctx.fill();

      // Boss glow ring
      if (enemy.isBoss) {
        ctx.strokeStyle = enemy.phaseTriggered ? "#ff2200" : "#ff8800";
        ctx.lineWidth = enemy.phaseTriggered ? 3 : 2;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.size + 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Slow ring
      if (enemy.slowTimer > 0) {
        ctx.strokeStyle = "#a5f3fc";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.size + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Burn glow
      if (enemy.burnTimer > 0) {
        ctx.strokeStyle = `rgba(255,100,0,${0.4 + 0.4 * Math.sin(this.tick * 0.3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.size + 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Armor ring
      if (enemy.armor > 0.2) {
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.size * 0.68, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // Emoji icon on top (drawn opaque regardless of stealth)
      ctx.globalAlpha = enemy.stealth ? 0.6 : 1;
      const emojiSize = Math.round(enemy.size * 1.5);
      ctx.font = `${emojiSize}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(enemy.icon, enemy.x, enemy.y);
      ctx.globalAlpha = 1;

      // HP bar
      const bw = enemy.size * 2.6,
        bh = 3;
      const bx = enemy.x - bw / 2,
        by = enemy.y - enemy.size - 7;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(bx, by, bw, bh);
      const r = enemy.hp / enemy.maxHp;
      ctx.fillStyle = r > 0.55 ? "#4ade80" : r > 0.28 ? "#facc15" : "#ef4444";
      ctx.fillRect(bx, by, bw * r, bh);
    }

    // ── Projectiles ───────────────────────────────────────────────────────────
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

    // ── Particles ─────────────────────────────────────────────────────────────
    for (const p of this.particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── Floating texts ────────────────────────────────────────────────────────
    for (const t of this.floatingTexts) {
      ctx.globalAlpha = t.life / 60;
      ctx.fillStyle = t.color;
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    // ── Boss warning ──────────────────────────────────────────────────────────
    if (this.bossWarningTimer > 0) {
      this.bossWarningTimer--;
      const alpha =
        Math.min(1, this.bossWarningTimer / 30) *
        Math.abs(Math.sin(this.tick * 0.15));
      const bDef = ENEMY_TYPES[this.bossWarningType];
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#1a0000";
      ctx.fillRect(0, this.canvas.height / 2 - 40, this.canvas.width, 80);
      ctx.globalAlpha = Math.min(1, alpha * 2);
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 28px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `⚠ BOSS INCOMING: ${bDef?.name || "???"} ${bDef?.icon || "💀"} ⚠`,
        this.canvas.width / 2,
        this.canvas.height / 2 - 10,
      );
      ctx.fillStyle = "#fca5a5";
      ctx.font = "14px monospace";
      ctx.fillText(
        bDef?.weaknessHint || "Find its weakness!",
        this.canvas.width / 2,
        this.canvas.height / 2 + 16,
      );
      ctx.globalAlpha = 1;
    }

    // ── Game over / victory overlays ──────────────────────────────────────────
    if (this.state === "gameover" || this.state === "victory") {
      const won = this.state === "victory";
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = won ? "#4ade80" : "#ef4444";
      ctx.font = "bold 46px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        won ? "⚡ VICTORY! ⚡" : "💀 GAME OVER 💀",
        this.canvas.width / 2,
        this.canvas.height / 2 - 30,
      );
      ctx.fillStyle = "#94a3b8";
      ctx.font = "18px monospace";
      ctx.fillText(
        `Score: ${this.score.toLocaleString()}`,
        this.canvas.width / 2,
        this.canvas.height / 2 + 14,
      );
      ctx.fillText(
        won ? "The AI could not stop you." : "The AI has defeated you.",
        this.canvas.width / 2,
        this.canvas.height / 2 + 42,
      );
    }
  }

  // ── Main loop ────────────────────────────────────────────────────────────────
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
      totalWaves: lvl.waves,
      score: this.score,
      state: this.state,
      levelId: this.levelId,
      levelName: lvl.name,
      mapName: this.mapDef.name,
      enemyCount: this.enemies.length,
      spawnRemaining: this.spawnQueue.length,
      aiSummary: this.waveAI.getAdaptationSummary(),
      nextWaveMessage: this.nextWaveMessage,
      lastEnemyTypes: this.lastEnemyTypes,
      minRequiredTowers: this.minRequiredTowers,
      bossWaves: lvl.bossWaves,
      unlockedTowers: lvl.unlockedTowers,
      towerCaps: lvl.towerCaps,
      towerCatCounts: { ...this.towerCatCounts },
      towers: this.towers.map((t) => ({
        type: t.type,
        kills: t.kills,
        damage: Math.floor(t.totalDamage),
        category: t.category,
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
