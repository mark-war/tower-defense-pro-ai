/**
 * TowerSystem.js
 * Owns tower placement, selling, upgrading, per-frame firing logic,
 * tower progression (XP/passive tiers), and fortify.
 *
 * Cross-system calls go through engine references:
 *   engine.vfx.*             – particles / floating text / bolts
 *   engine.combatSystem.*    – damage calculations
 *   engine.synergySystem.*   – synergy queries
 *   engine.projectileSystem.* – spawn / tick / splash projectiles
 */

import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  TOWER_TYPES,
  TOWER_UPGRADES,
  ABILITIES,
  ADMIN_CONFIG,
  SKINS,
} from "../gameConstants.js";

const ECFG = ADMIN_CONFIG.economy;
const VCFG = ADMIN_CONFIG.visual;

export class TowerSystem {
  constructor(engine) {
    this.engine = engine;
  }

  // ── Placement ───────────────────────────────────────────────────────────────

  canPlace(col, row, towerType) {
    const { grid, levelConfig, gold, towerCatCounts } = this.engine;
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS)
      return { ok: false, reason: "Out of bounds" };
    if (grid[row][col]) return { ok: false, reason: "Cell occupied" };
    if (this.engine._isPathCell(col, row))
      return { ok: false, reason: "On path" };

    const tDef = TOWER_TYPES[towerType];
    if (!tDef) return { ok: false, reason: "Unknown tower" };
    if (gold < tDef.cost) return { ok: false, reason: `Need ${tDef.cost}g` };
    if (!levelConfig.unlockedTowers.includes(towerType))
      return { ok: false, reason: "Locked" };

    const cat = tDef.category;
    const caps = levelConfig.towerCaps;
    const used = towerCatCounts[cat] || 0;
    const limit = caps[cat] ?? 99;
    if (used >= limit) return { ok: false, reason: `${cat} cap (${limit})` };

    return { ok: true };
  }

  place(col, row) {
    const engine = this.engine;
    const type = engine.selectedTowerType;
    const check = this.canPlace(col, row, type);

    if (!check.ok) {
      if (!["On path", "Cell occupied"].includes(check.reason))
        engine.vfx.addFloatingText(
          col * CELL_SIZE + CELL_SIZE / 2,
          row * CELL_SIZE,
          check.reason,
          "#ef4444",
        );
      return false;
    }

    const tDef = TOWER_TYPES[type];
    const tower = this._buildTowerObject(col, row, type, tDef);

    // Apply active skin overrides
    const skinTower = engine.activeSkin?.towers?.[type];
    if (skinTower) {
      tower.color = skinTower.color;
      tower.projectileColor = skinTower.projectileColor;
    }

    engine.grid[row][col] = tower;
    engine.towers.push(tower);
    engine.gold -= tDef.cost;
    engine.waveGoldSpent += tDef.cost;
    engine.towerCatCounts[tDef.category] =
      (engine.towerCatCounts[tDef.category] || 0) + 1;

    engine.waveAI.recordTowerPlacement(type, { col, row });
    engine.vfx.addParticles(tower.x, tower.y, tDef.color, 10);
    engine.synergySystem.check();
    engine.audio?.playTowerPlace();
    engine._emitState();
    return true;
  }

  sell(col, row) {
    const engine = this.engine;
    const tower = engine.grid[row]?.[col];
    if (!tower) return;

    const refund = Math.floor(
      (tower.cost + this._totalUpgradeCost(tower)) * ECFG.towerSellRatio,
    );
    engine.gold += refund;
    engine.grid[row][col] = null;
    engine.towers = engine.towers.filter((t) => t.id !== tower.id);
    engine.towerCatCounts[tower.category] = Math.max(
      0,
      (engine.towerCatCounts[tower.category] || 1) - 1,
    );

    engine.vfx.addFloatingText(tower.x, tower.y, `+${refund}g`, "#facc15");

    if (
      engine.selectedTowerCell?.col === col &&
      engine.selectedTowerCell?.row === row
    )
      engine.selectedTowerCell = null;

    engine.synergySystem.check();
    engine._emitState();
  }

  // ── Upgrades ────────────────────────────────────────────────────────────────

  upgrade(col, row, skillType, path) {
    const engine = this.engine;
    const tower = engine.grid[row]?.[col];
    if (!tower) return false;

    const upgDef = TOWER_UPGRADES[tower.type];
    if (!upgDef) return false;

    const costDef = upgDef[skillType]?.[path];
    if (!costDef) {
      console.warn("Missing upgrade:", tower.type, skillType, path);
      return false;
    }

    // Cost scaling for legendaries
    const scaleMap = {
      legendary50: 0.04,
      legendary100: 0.06,
      ascension200: 0.08,
    };
    let effectiveCost = costDef.cost;
    if (scaleMap[skillType]) {
      effectiveCost = Math.floor(
        costDef.cost * (1 + engine.wave * scaleMap[skillType]) +
          engine.gold * 0.1,
      );
    }

    // Prerequisite guards
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
    if (
      skillType === "ascension200" &&
      (!tower.legendary100Unlocked || tower.ascension200Unlocked)
    )
      return false;

    if (engine.gold < effectiveCost) {
      engine.vfx.addFloatingText(
        tower.x,
        tower.y - 20,
        `Need ${effectiveCost}g`,
        "#ef4444",
      );
      return false;
    }

    engine.gold -= effectiveCost;
    this._applyStatDeltas(tower, costDef.statDelta || {});

    if (costDef.special) {
      tower.specials.push(costDef.special);
      if (costDef.special === "splash30" && !tower.splash)
        tower.splash = Math.max(tower.splash || 0, 30);
      if (costDef.special === "armorPiercing") tower.armorPiercing = true;
    }

    // Mark progression milestones
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
    if (skillType === "ascension200") {
      tower.ascension200Unlocked = true;
      tower.ascension200Path = path;
    }

    tower.upgradeReady = false;
    tower.upgradeReadyType = null;

    engine.audio?.playTowerUpgrade();
    engine.vfx.addParticles(tower.x, tower.y, "#facc15", 20);
    engine.vfx.addFloatingText(
      tower.x,
      tower.y - 20,
      `✦ ${costDef.name}!`,
      "#fbbf24",
    );
    engine._emitState();
    return true;
  }

  // ── Repair ─────────────────────────────────────────────────────────────────

  repair(col, row) {
    const engine = this.engine;
    const tower = engine.grid[row]?.[col];
    if (!tower || tower.hp >= tower.maxHp) return false;

    const cost = tower.repairCost || 0;
    if (engine.gold < cost) {
      engine.vfx.addFloatingText(
        tower.x,
        tower.y - 20,
        `Need ${cost}g`,
        "#ef4444",
      );
      return false;
    }

    engine.gold -= cost;
    tower.hp = tower.maxHp;
    tower.disabled = false;
    tower.repairCost = 0;
    engine.vfx.addFloatingText(
      tower.x,
      tower.y - 20,
      "✓ Fully Repaired",
      "#4ade80",
    );
    engine.vfx.addParticles(tower.x, tower.y, "#4ade80", 15);
    engine._emitState();
    return true;
  }

  repairAll() {
    const engine = this.engine;
    if (engine.state !== "idle") return false;

    const damaged = engine.towers.filter((t) => t.hp < t.maxHp);
    if (!damaged.length) return false;

    const totalCost = damaged.reduce((s, t) => s + (t.repairCost || 0), 0);
    if (totalCost > 0 && engine.gold < totalCost) {
      engine.vfx.addFloatingText(
        engine.canvas.width / 2,
        engine.canvas.height / 2,
        `Need ${totalCost}g to repair all!`,
        "#ef4444",
      );
      return false;
    }

    engine.gold -= totalCost;
    for (const t of damaged) {
      t.hp = t.maxHp;
      t.disabled = false;
      t.repairCost = 0;
      engine.vfx.addParticles(t.x, t.y, "#4ade80", 8);
    }
    engine.vfx.addFloatingText(
      engine.canvas.width / 2,
      engine.canvas.height / 2 - 20,
      `🔧 ${damaged.length} towers repaired! -${totalCost}g`,
      "#4ade80",
    );
    engine._emitState();
    return true;
  }

  // ── Fortify ────────────────────────────────────────────────────────────────

  fortify() {
    const engine = this.engine;
    if (engine.state !== "idle") return false;
    if (engine.gold < engine.fortifyCost) return false;
    if (engine.fortifyLevel >= ECFG.maxFortifyLevel) return false;

    engine.gold -= engine.fortifyCost;
    engine.fortifyLevel++;
    engine.fortifyCost += ECFG.fortifyCostPerPurchase;

    for (const tower of engine.towers) tower.damage *= 1.08;

    engine.audio?.playFortify();
    engine.vfx.addFloatingText(
      engine.canvas.width / 2,
      engine.canvas.height / 2 - 30,
      `🏰 Fortify Lv${engine.fortifyLevel}! All towers +8% dmg`,
      "#fbbf24",
    );
    engine._emitState();
    return true;
  }

  // ── Per-frame update (the main tower firing loop) ──────────────────────────

  update() {
    const engine = this.engine;
    const {
      towers,
      enemies,
      globalBuff,
      lastStandActive,
      activeModifier,
      boltEffects,
      tick,
    } = engine;

    // Global buff tick
    if (globalBuff.timer > 0) globalBuff.timer--;

    const fireRateMult = globalBuff.timer > 0 ? globalBuff.fireRateMult : 1;
    const damageMult =
      (globalBuff.timer > 0 ? globalBuff.damageMult : 1) *
      (lastStandActive ? 1.5 : 1);
    const modFireRateMult = activeModifier?.apply?.towerFireRateMult
      ? 1 - activeModifier.apply.towerFireRateMult
      : 1;
    const modRangeMult = activeModifier?.apply?.towerRangeMult
      ? 1 + activeModifier.apply.towerRangeMult
      : 1;

    // Tick ability cooldowns
    engine.abilitySystem.tickCooldowns();

    // Decay bolt effects
    for (let i = boltEffects.length - 1; i >= 0; i--) {
      boltEffects[i].life--;
      if (boltEffects[i].life <= 0) boltEffects.splice(i, 1);
    }

    const synergyTeslaReveal = engine.synergySystem.has("laser_tesla");
    const globalReveal = towers.some((t) => t.specials?.includes("allReveal"));
    const synergyInfernoCannonActive =
      engine.synergySystem.has("inferno_cannon");
    const synergyVortexCannonActive = engine.synergySystem.has("vortex_cannon");

    for (const tower of towers) {
      if (tower.type === engine.silencedTowerType) continue;
      if (tower.disabled) continue;
      if (tower.cooldown > 0) {
        tower.cooldown--;
        continue;
      }

      // Delegate to the appropriate tower type handler
      const handled = this._handleSpecialTowerFire(
        tower,
        enemies,
        tick,
        damageMult,
        modRangeMult,
        modFireRateMult,
        fireRateMult,
        synergyTeslaReveal,
        globalReveal,
      );
      if (handled) continue;

      // Standard targeting + projectile
      const target = this._findTarget(
        tower,
        enemies,
        globalReveal,
        modRangeMult,
      );
      if (!target) continue;

      if (tower.type === "laser") {
        this._fireLaser(
          tower,
          target,
          enemies,
          damageMult,
          modRangeMult,
          modFireRateMult,
          fireRateMult,
          globalReveal,
        );
        continue;
      }

      // Synergy: inferno_cannon — cannon gains burnOnSplash
      if (
        synergyInfernoCannonActive &&
        tower.type === "cannon" &&
        !tower.specials.includes("burnOnSplash")
      ) {
        tower.specials.push("burnOnSplash");
        engine.projectileSystem.fire(tower, target, damageMult);
        tower.specials = tower.specials.filter((s) => s !== "burnOnSplash");
      } else {
        engine.projectileSystem.fire(tower, target, damageMult);
      }
      tower.cooldown = Math.max(
        1,
        Math.round(tower.fireRate * fireRateMult * modFireRateMult),
      );

      if (synergyVortexCannonActive && tower.type === "cannon") {
        tower.specials.push("vortexOnHit");
        engine.projectileSystem.fire(tower, target, damageMult);
        tower.specials = tower.specials.filter((s) => s !== "vortexOnHit");
      }
    }

    // Auto-repair during waves
    if (engine.autoRepair && tick % 60 === 0) this._autoRepairTick();
  }

  // ── Tower XP / progression ─────────────────────────────────────────────────

  checkProgression(tower, currentWave) {
    const upgDef = TOWER_UPGRADES[tower.type];
    if (!upgDef) return;

    const wasReady = tower.upgradeReady;

    // Keep xpToTier1/2 accurate for the HUD XP bars
    if (upgDef.skill5?.xp) tower.xpToTier1 = upgDef.skill5.xp;
    if (upgDef.skill10?.xp) tower.xpToTier2 = upgDef.skill10.xp;

    // Apply one passive tier per call
    for (const passive of upgDef.passives) {
      if (passive.tier <= tower.passiveTier) continue;
      if (tower.xp < passive.xp) continue;

      this._applyPassive(tower, passive);
      tower.passiveTier = passive.tier;
      this.engine.vfx.addFloatingText(
        tower.x,
        tower.y - 20,
        passive.label,
        "#38bdf8",
      );
      break; // one at a time
    }

    // Check skill/legendary unlock thresholds
    const s5 = upgDef.skill5;
    const s10 = upgDef.skill10;
    const l50 = upgDef.legendary50;
    const l100 = upgDef.legendary100;
    const a200 = upgDef.ascension200;

    if (tower.passiveTier >= 4 && !tower.skill5chosen && tower.xp >= s5.xp) {
      tower.upgradeReady = true;
      tower.upgradeReadyType = "skill5";
    }
    if (
      tower.skill5chosen &&
      tower.passiveTier >= 9 &&
      !tower.skill10chosen &&
      tower.xp >= s10.xp
    ) {
      tower.upgradeReady = true;
      tower.upgradeReadyType = "skill10";
    }
    if (
      l50 &&
      currentWave >= l50.unlocksAtWave &&
      tower.skill10chosen &&
      !tower.legendaryUnlocked
    ) {
      tower.upgradeReady = true;
      tower.upgradeReadyType = "legendary50";
    }
    if (
      l100 &&
      currentWave >= l100.unlocksAtWave &&
      tower.legendaryUnlocked &&
      !tower.legendary100Unlocked
    ) {
      tower.upgradeReady = true;
      tower.upgradeReadyType = "legendary100";
    }
    if (
      a200 &&
      currentWave >= a200.unlocksAtWave &&
      tower.legendary100Unlocked &&
      !tower.ascension200Unlocked
    ) {
      tower.upgradeReady = true;
      tower.upgradeReadyType = "ascension200";
    }

    if (!wasReady && tower.upgradeReady) this.engine._emitState();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _buildTowerObject(col, row, type, tDef) {
    return {
      id: Date.now() + Math.random(),
      type,
      col,
      row,
      x: col * CELL_SIZE + CELL_SIZE / 2,
      y: row * CELL_SIZE + CELL_SIZE / 2,
      cooldown: 0,
      totalDamage: 0,
      kills: 0,
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
      hp: tDef.towerHp || 200,
      maxHp: tDef.towerMaxHp || 200,
      damageResist: tDef.attackDamageResist || 0,
      disabled: false,
      repairCost: 0,
      lastDamagedTick: 0,
      homing: tDef.homing || false,
      _shotCount: 0,
      _recoilTimer: 0,
      _recoilMax: 8,
      xp: 0,
      passiveTier: 0,
      skill5chosen: null,
      skill10chosen: null,
      legendaryUnlocked: false,
      legendary100Unlocked: false,
      ascension200Unlocked: false,
      ascension200Path: null,
      upgradeReady: false,
      upgradeReadyType: null,
      specials: [],
      tier: 0,
      chosenPath: null,
      tier2Path: null,
      xpToTier1: TOWER_UPGRADES[type]?.skill5?.xp ?? 999,
      xpToTier2: TOWER_UPGRADES[type]?.skill10?.xp ?? 999,
      baseDamage: tDef.damage,
      baseRange: tDef.range,
      baseFireRate: tDef.fireRate,
      color: tDef.color,
      projectileColor: tDef.projectileColor,
      icon: tDef.icon,
      name: tDef.name,
      cost: tDef.cost,
      category: tDef.category,
    };
  }

  _totalUpgradeCost(tower) {
    const upgDef = TOWER_UPGRADES[tower.type];
    if (!upgDef) return 0;
    let cost = 0;
    if (tower.skill5chosen)
      cost += upgDef.skill5?.[tower.skill5chosen]?.cost || 0;
    if (tower.skill10chosen)
      cost += upgDef.skill10?.[tower.skill10chosen]?.cost || 0;
    if (tower.legendaryUnlocked && tower.legendary50Path)
      cost += upgDef.legendary50?.[tower.legendary50Path]?.cost || 0;
    if (tower.legendary100Unlocked && tower.legendary100Path)
      cost += upgDef.legendary100?.[tower.legendary100Path]?.cost || 0;
    return cost;
  }

  _applyStatDeltas(tower, d) {
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
    if (d.burnDamage !== undefined) tower.burnDamage += d.burnDamage;
    if (d.burnDuration !== undefined)
      tower.burnDuration = Math.round(
        tower.burnDuration * (1 + d.burnDuration),
      );
    if (d.projectileSpeed !== undefined)
      tower.projectileSpeed *= 1 + d.projectileSpeed;
  }

  _applyPassive(tower, passive) {
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
    if (passive.flat !== undefined && passive.stat !== "chainTargets")
      tower[passive.stat] = (tower[passive.stat] || 0) + passive.flat;
    if (passive.stat === "chainTargets" && passive.flat)
      tower.chainTargets = (tower.chainTargets || 0) + passive.flat;
  }

  _findTarget(tower, enemies, globalReveal, modRangeMult) {
    let target = null;
    if (tower.type === "missile") {
      for (const enemy of enemies) {
        if (enemy.stealth) continue;
        if (enemy.immunities.includes("missile")) continue;
        const dx = enemy.x - tower.x,
          dy = enemy.y - tower.y;
        if (Math.sqrt(dx * dx + dy * dy) <= tower.range * modRangeMult)
          if (!target || enemy.hp > target.hp) target = enemy;
      }
    } else {
      for (const enemy of enemies) {
        const canTargetStealth =
          tower.type === "laser" ||
          globalReveal ||
          tower.specials?.includes("fullPierce") ||
          tower.specials?.includes("trueDamage");
        if (enemy.stealth && !canTargetStealth) continue;
        if (enemy.immunities.includes(tower.type)) continue;
        const dx = enemy.x - tower.x,
          dy = enemy.y - tower.y;
        if (Math.sqrt(dx * dx + dy * dy) <= tower.range * modRangeMult)
          if (!target || enemy.distanceTraveled > target.distanceTraveled)
            target = enemy;
      }
    }
    return target;
  }

  /** Returns true if the tower was handled by a special firing routine. */
  _handleSpecialTowerFire(
    tower,
    enemies,
    tick,
    damageMult,
    modRangeMult,
    modFireRateMult,
    fireRateMult,
    synergyTeslaReveal,
    globalReveal,
  ) {
    const engine = this.engine;

    // ── Tesla ────────────────────────────────────────────────────────────────
    if (tower.type === "tesla") {
      const canHitStealth =
        synergyTeslaReveal ||
        globalReveal ||
        tower.specials?.includes("fullPierce");

      const inRange = enemies
        .filter((e) => {
          if (e.stealth && !canHitStealth) return false;
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

      if (!inRange.length) return true;

      tower.cooldown = Math.max(
        1,
        Math.round(tower.fireRate * fireRateMult * modFireRateMult),
      );
      tower._shotCount = (tower._shotCount || 0) + 1;

      // Arc Pulse: every 5th shot = full-screen pulse
      if (tower.specials?.includes("arcPulse") && tower._shotCount % 5 === 0) {
        for (const e of enemies) {
          engine.combatSystem.damageEnemy(e, tower.damage * 1.5, {
            towerType: "tesla",
            towerId: tower.id,
            armorPiercing: true,
            specials: [],
          });
          engine.vfx.addBolt(tower.x, tower.y, e.x, e.y, tower.color);
        }
        engine.audio?.playArcPulse();
        engine.vfx.triggerShake(6, 8);
        engine.vfx.addFloatingText(
          tower.x,
          tower.y - 30,
          "💀 ARC PULSE!",
          "#fbbf24",
        );
      }

      // Ball Lightning: every 8th shot
      if (tower.specials?.includes("ballLightning")) {
        tower._blCount = (tower._blCount || 0) + 1;
        if (tower._blCount % 8 === 0) {
          engine.ballLightnings.push({
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
        engine.combatSystem.damageEnemy(e, chainDmg, {
          towerType: "tesla",
          towerId: tower.id,
          armorPiercing: true,
          slowDuration: 0,
          burnDamage: 0,
          burnDuration: 0,
          specials: tower.specials || [],
        });
        if (tower.specials?.includes("chainStun") && e.stunCooldown <= 0) {
          e.stunTimer = e.isBoss ? 15 : 12;
          e.stunCooldown = e.isBoss ? 120 : 60;
        }
        const src = idx === 0 ? tower : inRange[idx - 1];
        engine.vfx.addBolt(src.x, src.y, e.x, e.y, tower.color);
        engine.vfx.addParticles(e.x, e.y, tower.color, 4);
      });
      return true;
    }

    // ── Cyclone (passive AoE spin, not standard fire loop) ──────────────────
    if (tower.specials?.includes("cyclone") && tick % 15 === 0) {
      this._cycloneEffect(tower, enemies);
    }

    // ── Hellgate (continuous burn aura) ────────────────────────────────────
    if (tower.specials?.includes("hellgate") && tick % 20 === 0) {
      this._hellgateEffect(tower, enemies);
    }

    // ── Burn Aura ──────────────────────────────────────────────────────────
    if (tower.specials?.includes("burnAura") && tick % 40 === 0) {
      for (const e of enemies) {
        if (e.immunities.includes("inferno")) continue;
        const d = Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2);
        if (d <= tower.range) {
          e.burnTimer = Math.max(e.burnTimer, 80);
          e.burnDmg = Math.max(e.burnDmg, tower.burnDamage || 3);
          e.burnSourceId = tower.id;
        }
      }
    }

    // ── Meteor Storm ──────────────────────────────────────────────────────
    if (tower.specials?.includes("meteorStorm") && tick % 30 === 0) {
      this._meteorStormEffect(tower, enemies, damageMult);
    }

    // ── Armageddon ────────────────────────────────────────────────────────
    if (
      tower.specials?.includes("armageddon") &&
      tick % 300 === 0 &&
      enemies.length > 0
    ) {
      for (const e of enemies) {
        if (e.immunities.includes("missile")) continue;
        engine.combatSystem.damageEnemy(e, tower.damage, {
          towerType: "missile",
          towerId: tower.id,
          armorPiercing: false,
          splash: tower.splash,
          specials: [],
        });
        engine.vfx.addParticles(e.x, e.y, tower.projectileColor, 8);
      }
      engine.vfx.triggerShake(6, 8);
      engine.vfx.addFloatingText(
        tower.x,
        tower.y - 30,
        "💢 ARMAGEDDON!",
        "#f43f5e",
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // ASCENSION 200 SKILLS
    // ══════════════════════════════════════════════════════════════════════

    // ── Basic A: Extinction Protocol — every bullet applies all debuffs ───
    // Handled in ProjectileSystem via proj.specials check — special is on tower
    // and copied to projectile automatically via `specials: tower.specials`.

    // ── Basic B: Void Arsenal — handled in ProjectileSystem (voidRings) ──
    if (tower.specials?.includes("voidRings") && tick % 20 === 0) {
      const ringRadius = 60 + (tick % 120);
      for (const e of enemies) {
        const d = Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2);
        if (d < ringRadius && d > ringRadius - 20) {
          engine.combatSystem.damageEnemy(e, tower.damage * 0.5, {
            towerType: "basic",
            towerId: tower.id,
            armorPiercing: true,
            specials: [],
          });
        }
      }
    }

    // ── Sniper A: executionShot — handled in CombatSystem.damageEnemy() ──
    // ── Sniper B: Omniscience — hits ALL enemies every 5s ─────────────────
    if (
      tower.specials?.includes("omniscience") &&
      tick % 300 === 0 &&
      enemies.length > 0
    ) {
      for (const e of enemies) {
        engine.combatSystem.damageEnemy(e, tower.damage * damageMult, {
          towerType: "sniper",
          towerId: tower.id,
          armorPiercing: true,
          specials: tower.specials,
        });
        engine.vfx.addBolt(tower.x, tower.y, e.x, e.y, tower.color);
      }
      engine.vfx.addFloatingText(
        engine.canvas.width / 2,
        engine.canvas.height / 2 - 50,
        "🌐 OMNISCIENCE!",
        "#38bdf8",
      );
      engine.vfx.triggerShake(4, 6);
    }

    // ── Cannon A: Planet Cracker — every 3rd shot = nuke + burn zone ──────
    if (tower.specials?.includes("planetCracker")) {
      tower._shotCount = tower._shotCount || 0;
      // shotCount is incremented in ProjectileSystem.fire() — we react here
      if (
        tower._shotCount > 0 &&
        tower._shotCount % 3 === 0 &&
        tower._lastPlanetCrack !== tower._shotCount
      ) {
        tower._lastPlanetCrack = tower._shotCount;
        setTimeout(() => {
          for (const e of engine.enemies) {
            engine.combatSystem.damageEnemy(e, tower.damage * damageMult * 3, {
              towerType: "cannon",
              towerId: tower.id,
              armorPiercing: true,
              specials: [],
            });
          }
          // Permanent burn zone at tower position
          engine.burnZones.push({
            x: tower.x,
            y: tower.y,
            radius: tower.splash * 1.5,
            damage: tower.burnDamage || 8,
            timer: 600,
            color: "#ef4444",
          });
          engine.vfx.triggerShake(10, 16);
          engine.vfx.addFloatingText(
            engine.canvas.width / 2,
            engine.canvas.height / 2 - 40,
            "🌍 PLANET CRACKER!",
            "#f97316",
          );
          engine.vfx.addParticles(tower.x, tower.y, "#f97316", 60);
        }, 300);
      }
    }

    // ── Cannon B: Tectonic — handled via proj.specials (splash + pull) ────
    // statDelta splash:3.0 already applied at upgrade time.
    // Pull is handled in dealSplashDamage when pullForce > 0 — add pull here:
    if (tower.specials?.includes("tectonicPull") && tick % 30 === 0) {
      for (const e of enemies) {
        const d = Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2);
        if (d <= tower.splash && !e.gravityImmune) {
          const ang = Math.atan2(tower.y - e.y, tower.x - e.x);
          e.x += Math.cos(ang) * 4;
          e.y += Math.sin(ang) * 4;
        }
      }
    }

    // ── Laser A: Solar God — permanent true-dmg beam on every enemy ───────
    if (tower.specials?.includes("solarGod") && tick % 3 === 0) {
      for (const e of enemies) {
        engine.combatSystem.damageEnemy(e, tower.damage * damageMult, {
          towerType: "laser",
          towerId: tower.id,
          armorPiercing: true,
          specials: ["trueDamage"],
        });
        if (tick % 30 === 0)
          engine.vfx.addBolt(tower.x, tower.y, e.x, e.y, tower.color);
      }
    }

    // ── Laser B: Mirror Web — beam reflects to 8 extra targets ───────────
    // Handled in _fireLaser() — see addition below (prismSplit-like but 8 targets)

    // ── Freeze A: Heat Death — all non-boss enemies permanently slowed ────
    if (tower.specials?.includes("heatDeath") && tick % 30 === 0) {
      for (const e of enemies) {
        if (e.immunities.includes("freeze")) continue;
        if (e.isBoss) {
          // Bosses only get a slow, not a full freeze
          e.slowTimer = Math.max(e.slowTimer, 60);
        } else {
          // Non-bosses get permanently frozen (re-applied every 0.5s)
          e.stunTimer = Math.max(e.stunTimer, 35);
        }
      }
    }

    // ── Freeze B: Cryo Storm — frozen enemies explode on death ───────────
    // Handled in CombatSystem.killEnemy() — see addition below.

    // ── Tesla A: Zeus Protocol — chains to ALL enemies, full damage ───────
    if (tower.specials?.includes("zeusProtocol") && tower.type === "tesla") {
      // Override normal chain limit: already handled inside Tesla block above.
      // We inject this BEFORE the tesla block so it intercepts and overrides.
      const allTargets = enemies.filter(
        (e) =>
          !(e.stealth && !globalReveal) &&
          !(
            e.immunities.includes("tesla") &&
            !tower.specials.includes("fullPierce")
          ),
      );
      if (allTargets.length > 0 && tower.cooldown <= 0) {
        tower.cooldown = Math.max(
          1,
          Math.round(tower.fireRate * fireRateMult * modFireRateMult),
        );
        const dmg = tower.damage * damageMult;
        for (const e of allTargets) {
          engine.combatSystem.damageEnemy(e, dmg, {
            towerType: "tesla",
            towerId: tower.id,
            armorPiercing: true,
            specials: tower.specials || [],
          });
          engine.vfx.addBolt(tower.x, tower.y, e.x, e.y, tower.color);
        }
        engine.vfx.addParticles(tower.x, tower.y, tower.color, 20);
        return true; // skip normal tesla targeting
      }
    }

    // ── Tesla B: Storm God — passive 30 dmg/tick to all enemies ──────────
    if (tower.specials?.includes("stormGod") && tick % 4 === 0) {
      for (const e of enemies) {
        if (
          e.immunities.includes("tesla") &&
          !tower.specials.includes("fullPierce")
        )
          continue;
        engine.combatSystem.damageEnemy(e, 30 * damageMult, {
          towerType: "tesla",
          towerId: tower.id,
          armorPiercing: true,
          specials: [],
        });
      }
      if (tick % 60 === 0 && enemies.length > 0) {
        engine.vfx.addParticles(tower.x, tower.y, tower.color, 8);
      }
    }

    // ── Inferno A: Solar Core — burn becomes true dmg, stacks cap 10 ─────
    // Handled in EnemySystem burn DoT block — see addition there.

    // ── Inferno B: Infernal Realm — whole map is a burn zone ─────────────
    if (tower.specials?.includes("infernalRealm") && tick % 60 === 0) {
      for (const e of enemies) {
        if (e.immunities.includes("inferno")) continue;
        e.burnTimer = Math.max(e.burnTimer, 80);
        e.burnDmg = Math.max(e.burnDmg, tower.burnDamage || 5);
        e.burnSourceId = tower.id;
      }
      if (tick % 120 === 0) {
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 30,
          "😈 INFERNAL REALM",
          "#ef4444",
        );
      }
    }

    // ── Vortex A: Singularity Rex — permanent mega black hole ────────────
    if (tower.specials?.includes("singularityRex")) {
      // Ensure exactly one permanent black hole exists for this tower
      if (!engine.blackHoles.some((bh) => bh._ownerId === tower.id)) {
        engine.blackHoles.push({
          x: tower.x,
          y: tower.y,
          timer: Infinity,
          radius: tower.range * 1.5,
          strength: 8,
          _ownerId: tower.id,
          _permanent: true,
        });
      }
      // Heal the timer each tick so it never expires
      const bh = engine.blackHoles.find((b) => b._ownerId === tower.id);
      if (bh) {
        bh.x = tower.x;
        bh.y = tower.y;
        bh.timer = 999999;
        bh.radius = tower.range * 1.5;
      }
      // Extra damage every 20 ticks (beyond the base black hole tick damage)
      if (tick % 20 === 0) {
        for (const e of enemies) {
          const d = Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2);
          if (d <= tower.range * 1.5) {
            engine.combatSystem.damageEnemy(e, 200 * damageMult, {
              towerType: "vortex",
              towerId: tower.id,
              armorPiercing: true,
              specials: [],
            });
          }
        }
      }
    }

    // ── Vortex B: Reality Fold — teleport all in range back to spawn every 6s
    if (
      tower.specials?.includes("realityFold") &&
      tick % 360 === 0 &&
      enemies.length > 0
    ) {
      let teleported = 0;
      const now = engine.tick;
      for (const e of enemies) {
        const d = Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2);
        if (d <= tower.range) {
          // Same cooldown guard as teleportBack fix
          const cooldown = e.isBoss ? 900 : 360;
          if (e._realityFoldCooldown && now - e._realityFoldCooldown < cooldown)
            continue;
          e._realityFoldCooldown = now;
          e.pathIndex = 0;
          const activePath = e._altPath ?? engine.path;
          e.x = activePath[0].x;
          e.y = activePath[0].y;
          e.distanceTraveled = 0;
          teleported++;
          engine.vfx.addParticles(e.x, e.y, "#818cf8", 15);
        }
      }
      if (teleported > 0) {
        engine.vfx.addFloatingText(
          tower.x,
          tower.y - 30,
          `🌌 REALITY FOLD! ×${teleported}`,
          "#818cf8",
        );
        engine.vfx.triggerShake(5, 8);
      }
    }

    // ── Missile A: Doomsday Protocol — every missile triggers a nuke ─────
    // Handled in ProjectileSystem.fire() via _shotCount — see addition below.

    // ── Missile B: Hive Mind — each hit spawns 3 new homing missiles ─────
    // Handled in CombatSystem.damageEnemy() via proj.specials check.

    return false; // not fully handled — caller continues with standard targeting
  }

  _fireLaser(
    tower,
    target,
    enemies,
    damageMult,
    modRangeMult,
    modFireRateMult,
    fireRateMult,
    globalReveal,
  ) {
    const engine = this.engine;
    const modRange = tower.range * modRangeMult;

    const targets = enemies
      .filter((e) => {
        if (e.immunities.includes("laser") && !globalReveal) return false;
        return (
          Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2) <= modRange
        );
      })
      .sort((a, b) => b.distanceTraveled - a.distanceTraveled);

    if (!targets.length) return;

    engine.projectileSystem.fire(tower, targets[0], damageMult);
    tower.cooldown = Math.max(
      1,
      Math.round(tower.fireRate * fireRateMult * modFireRateMult),
    );

    // beamAll — instant damage at 25% power to remaining in-range enemies
    if (tower.specials?.includes("beamAll") && targets.length > 1) {
      for (let bi = 1; bi < targets.length; bi++) {
        engine.combatSystem.damageEnemy(
          targets[bi],
          tower.damage * damageMult * 0.25,
          {
            towerType: "laser",
            towerId: tower.id,
            armorPiercing: false,
            specials: tower.specials,
          },
        );
        engine.vfx.addBolt(
          tower.x,
          tower.y,
          targets[bi].x,
          targets[bi].y,
          tower.color,
        );
      }
    }

    // omegaBeam
    if (tower.specials?.includes("omegaBeam") && engine.tick % 25 === 0) {
      for (const e of enemies) {
        if (e.immunities.includes("laser")) continue;
        engine.combatSystem.damageEnemy(e, tower.damage * 0.8, {
          towerType: "laser",
          towerId: tower.id,
          armorPiercing: false,
          specials: [],
        });
        engine.vfx.addBolt(tower.x, tower.y, e.x, e.y, tower.color);
      }
    }

    // prismSplit
    if (tower.specials?.includes("prismSplit")) {
      const prismExtra = enemies
        .filter(
          (e) =>
            e.id !== target.id &&
            !e.immunities.includes("laser") &&
            Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2) <= modRange,
        )
        .sort((a, b) => b.distanceTraveled - a.distanceTraveled)
        .slice(0, 2);
      for (const pe of prismExtra) {
        engine.combatSystem.damageEnemy(pe, tower.damage * damageMult * 0.6, {
          towerType: "laser",
          towerId: tower.id,
          armorPiercing: false,
          specials: [],
        });
        engine.vfx.addBolt(tower.x, tower.y, pe.x, pe.y, "#e879f9");
      }
    }

    // mirrorWeb — beam reflects off hit enemy to up to 8 additional targets
    if (tower.specials?.includes("mirrorWeb") && targets.length > 0) {
      const primary = targets[0];
      const webTargets = enemies
        .filter(
          (e) =>
            e.id !== primary.id &&
            !e.immunities.includes("laser") &&
            Math.sqrt((e.x - primary.x) ** 2 + (e.y - primary.y) ** 2) <=
              modRange,
        )
        .sort((a, b) => b.distanceTraveled - a.distanceTraveled)
        .slice(0, 8);
      for (const wt of webTargets) {
        engine.combatSystem.damageEnemy(wt, tower.damage * damageMult * 0.5, {
          towerType: "laser",
          towerId: tower.id,
          armorPiercing: true,
          specials: ["trueDamage"],
        });
        engine.vfx.addBolt(primary.x, primary.y, wt.x, wt.y, "#e879f9");
      }
    }
  }

  _cycloneEffect(tower, enemies) {
    const engine = this.engine;
    const spinRadius = tower.range * 0.65;
    const tick = engine.tick;
    const spinAngle = (tick * 0.08) % (Math.PI * 2);

    for (const e of enemies) {
      const dx = e.x - tower.x,
        dy = e.y - tower.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > spinRadius || dist < 4) continue;

      engine.combatSystem.damageEnemy(e, tower.damage * 0.15, {
        towerType: "vortex",
        towerId: tower.id,
        armorPiercing: false,
        specials: [],
      });

      const normalAng = Math.atan2(dy, dx);
      const tangentAng = normalAng + Math.PI / 2;
      const spinForce = 1.8 * (1 - dist / spinRadius);

      e.x += Math.cos(tangentAng) * spinForce - (dx / dist) * spinForce * 0.4;
      e.y += Math.sin(tangentAng) * spinForce - (dy / dist) * spinForce * 0.4;
      e.x = Math.max(0, Math.min(engine.canvas.width, e.x));
      e.y = Math.max(0, Math.min(engine.canvas.height, e.y));
    }

    for (let i = 0; i < 3; i++) {
      const a = spinAngle + i * ((Math.PI * 2) / 3);
      const bx = tower.x + Math.cos(a) * spinRadius;
      const by = tower.y + Math.sin(a) * spinRadius;
      engine.vfx.addBolt(tower.x, tower.y, bx, by, tower.color);
    }
  }

  _hellgateEffect(tower, enemies) {
    const engine = this.engine;
    for (const e of enemies) {
      if (e.immunities.includes("inferno")) continue;
      const d = Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2);
      if (d <= tower.range) {
        engine.combatSystem.damageEnemy(e, tower.damage * 0.45, {
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

  _meteorStormEffect(tower, enemies, damageMult) {
    const engine = this.engine;
    const candidates = enemies.filter(
      (e) =>
        Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2) <=
        tower.range * 1.5,
    );
    if (!candidates.length) return;

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    engine.combatSystem.damageEnemy(target, tower.damage * damageMult * 0.6, {
      towerType: "cannon",
      towerId: tower.id,
      armorPiercing: false,
      specials: [],
    });
    engine.projectileSystem.dealSplashDamage(
      {
        x: target.x,
        y: target.y,
        towerType: "cannon",
        towerId: tower.id,
        damage: tower.damage * damageMult * 0.4,
        splash: tower.splash * 0.5,
        pullForce: 0,
        specials: [],
      },
      target,
    );
    engine.vfx.addParticles(target.x, target.y, tower.projectileColor, 10);
    engine.vfx.addFloatingText(target.x, target.y - 10, "🌠", "#f97316");
  }

  _autoRepairTick() {
    const engine = this.engine;
    const damaged = engine.towers.filter((t) => t.hp < t.maxHp && !t.disabled);

    for (const tower of damaged) {
      const healAmt = tower.maxHp * 0.04;
      const healCost = Math.ceil(tower.cost * 0.008);
      if (engine.gold < healCost) continue;

      engine.gold -= healCost;
      tower.hp = Math.min(tower.maxHp, tower.hp + healAmt);
      tower.repairCost = Math.ceil(
        ((tower.maxHp - tower.hp) / tower.maxHp) * tower.cost * 0.4,
      );
      if (tower.hp >= tower.maxHp) {
        tower.repairCost = 0;
        engine.vfx.addFloatingText(
          tower.x,
          tower.y - 18,
          "🔧 Repaired!",
          "#4ade80",
        );
      }
    }

    // Re-enable disabled towers that recovered above threshold
    for (const tower of engine.towers) {
      if (tower.disabled && tower.hp > tower.maxHp * 0.3) {
        tower.disabled = false;
        engine.vfx.addFloatingText(
          tower.x,
          tower.y - 18,
          "↑ Online!",
          "#4ade80",
        );
      }
    }
  }
}
