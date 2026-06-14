/**
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
    const def = ENEMY_TYPES[data.type];
    if (!def) return;

    if (data.isBoss) engine.audio?.onBossSpawn(data.type);

    const e = {
      id: Date.now() + Math.random(),
      type: data.type,
      x: engine.path[0].x,
      y: engine.path[0].y,
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

    // ── Endless milestone armor (Elite Units + Apex Tide) ─────────────────────
    if (engine.endlessWaveMods?.armorBonus) {
      e.armor = Math.min(
        0.92,
        e.armor + engine.endlessWaveMods.armorBonus,
      );
      e.baseArmor = e.armor;
    }

    // ── Apply wave modifier to this enemy ─────────────────────────────────────
    if (engine.activeModifier) {
      const mod = engine.activeModifier.apply;
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
      engine.activeModifier?.apply?.eliteCount &&
      engine._eliteSpawnedCount < engine.activeModifier.apply.eliteCount &&
      !e.isBoss
    ) {
      e.hp *= engine.activeModifier.apply.eliteHpMult;
      e.maxHp = e.hp;
      e.reward = Math.round(
        e.reward * engine.activeModifier.apply.eliteRewardMult,
      );
      e.isElite = true;
      e.size *= 1.4;
      engine._eliteSpawnedCount++;
    }

    // ── Apply boss mutation ───────────────────────────────────────────────────
    if (e.isBoss && engine._pendingBossMutation) {
      const mut = engine._pendingBossMutation;
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
      if (e.isBoss && engine._pendingBossMutation) {
        engine._pendingBossMutation = null;
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
    if (e.isBoss && engine.activeModifier?.apply?.bossHpMult) {
      e.hp *= engine.activeModifier.apply.bossHpMult;
      e.maxHp = e.hp;
      if (engine.activeModifier.apply.bossLegendaryLoot) {
        e.lootDrop = {
          type: "gold_shower",
          amount: 300,
          label: "👑 Empowered Boss Drop!",
        };
      }
    }

    // ── Apply active evolutions for this enemy type ───────────────────────────
    const evolutions = engine.waveAI.getActiveEvolutionsForType(data.type);
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
    if (engine.waveAI.pendingEvolutionAlert) {
      engine.evolutionAlertDef = engine.waveAI.pendingEvolutionAlert;
      engine.evolutionAlertTimer =
        ADMIN_CONFIG.enemyEvolution?.evolutionNotifyFrames || 180;
      engine.waveAI.pendingEvolutionAlert = null;
    }

    // Route to second path if flagged by dual-front modifier
    if (data._useSecondPath && engine._secondPath?.length > 1) {
      e.x = engine._secondPath[0].x;
      e.y = engine._secondPath[0].y;
      e._altPath = engine._secondPath; // enemies carry their own path reference
      e.pathIndex = 0;
    }

    const skinEnemy = engine.activeSkin?.enemies?.[data.type];
    if (skinEnemy?.color) e.color = skinEnemy.color;

    engine.enemies.push(e);
  }

  update() {
    const engine = this.engine;
    if (engine.forceTargetTimer > 0) engine.forceTargetTimer--;
    else engine.forceTargetId = null;

    // ── BURN ZONES - ground fire from burnOnSplash
    for (let i = engine.burnZones.length - 1; i >= 0; i--) {
      const z = engine.burnZones[i];
      z.timer--;
      if (z.timer <= 0) {
        engine.burnZones.splice(i, 1);
        continue;
      }
      if (engine.tick % 20 === 0) {
        for (const e of engine.enemies) {
          const d = Math.sqrt((e.x - z.x) ** 2 + (e.y - z.y) ** 2);
          if (d < z.radius) {
            e.hp -= z.damage;
            if (!e.burnTimer) {
              e.burnTimer = Math.max(e.burnTimer, 60);
              e.burnDmg = Math.max(e.burnDmg, z.damage);
            }
            if (e.hp <= 0) engine.combatSystem.killEnemy(e, "inferno", null);
          }
        }
      }
    }

    // ── BLACK HOLES — pull all nearby enemies and damage them
    for (let i = engine.blackHoles.length - 1; i >= 0; i--) {
      const bh = engine.blackHoles[i];
      bh.timer--;
      if (bh.timer <= 0) {
        engine.blackHoles.splice(i, 1);
        continue;
      }
      for (const e of engine.enemies) {
        const dx = bh.x - e.x,
          dy = bh.y - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < bh.radius) {
          // Pull toward center
          e.x += (dx / dist) * bh.strength * (1 - dist / bh.radius);
          e.y += (dy / dist) * bh.strength * (1 - dist / bh.radius);
          // Damage tick
          if (engine.tick % 20 === 0) {
            e.hp -= 8;
            if (e.hp <= 0) engine.combatSystem.killEnemy(e, "basic", null);
          }
        }
      }
    }

    // ── BALL LIGHTNING: spawn roaming orbs
    for (let i = engine.ballLightnings.length - 1; i >= 0; i--) {
      const bl = engine.ballLightnings[i];
      bl.timer--;
      if (bl.timer <= 0) {
        engine.ballLightnings.splice(i, 1);
        continue;
      }

      // Drift toward nearest enemy
      const nearest = engine.enemies
        .filter(
          (e) =>
            !e.stealth ||
            engine.towers.some((t) => t.specials?.includes("allReveal")),
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
      if (bl.x < 0 || bl.x > engine.canvas.width) bl.vx *= -1;
      if (bl.y < 0 || bl.y > engine.canvas.height) bl.vy *= -1;

      // Zap nearby enemies every 20 ticks
      if (bl.zapCooldown > 0) {
        bl.zapCooldown--;
        continue;
      }

      const zapTargets = engine.enemies
        .filter(
          (e) =>
            Math.sqrt((e.x - bl.x) ** 2 + (e.y - bl.y) ** 2) < bl.zapRadius,
        )
        .slice(0, 3);

      for (const t of zapTargets) {
        engine.combatSystem.damageEnemy(t, bl.damage, {
          towerType: "tesla",
          towerId: bl.towerId,
          armorPiercing: true,
          specials: [],
        });
        engine.vfx.addBolt(bl.x, bl.y, t.x, t.y, bl.color);
      }
      if (zapTargets.length > 0) bl.zapCooldown = 20;
    }

    // enemies loop
    for (let i = engine.enemies.length - 1; i >= 0; i--) {
      const e = engine.enemies[i];

      // stun takes priority over slow
      if (e.stunImmunity > 0) e.stunImmunity--;

      // decrement solar blind
      if (e._solarBlindCooldown > 0) e._solarBlindCooldown--;

      // decrement dark star debuff
      if (e._darkStarDebuffTimer > 0) e._darkStarDebuffTimer--;

      // decrement laser tag timer (for laser_sniper synergy)
      if (e._laserTaggedTimer > 0) e._laserTaggedTimer--;

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
      // for (const glt of engine.towers) {
      //   if (!glt.specials?.includes("gravityLock")) continue;
      //   const gld = Math.sqrt((e.x - glt.x) ** 2 + (e.y - glt.y) ** 2);
      //   if (gld <= glt.range) {
      //     e.speed = 0;
      //     break;
      //   }
      // }
      for (const glt of engine.towers) {
        if (!glt.specials?.includes("gravityLock")) continue;

        const gld = Math.sqrt((e.x - glt.x) ** 2 + (e.y - glt.y) ** 2);

        if (gld <= glt.range) {
          const hpPct = e.hp / e.maxHp; // 1.0 = full health, 0.0 = dead

          if (e.isBoss) {
            // ── Bosses: gravity lock is weaker overall ───────────────────
            // Full HP boss moves at 15%, near-dead boss moves at 80%
            const speedPct = 0.15 + (1 - hpPct) * 0.65;
            e.speed = Math.min(e.speed, e.baseSpeed * speedPct);
          } else {
            // ── Normal enemies ───────────────────────────────────────────
            // Full HP → speed 0
            // 50% HP  → speed 25% of base
            // 25% HP  → speed 60% of base
            // 10% HP  → speed 85% of base
            // Uses a curve so speed ramps up faster in the low HP range
            const speedPct = Math.pow(1 - hpPct, 1.8);
            e.speed = Math.min(e.speed, e.baseSpeed * speedPct);
          }

          // Visual: pulse color shifts from purple → white as enemy escapes
          // This is just a flag the renderer can read — no logic cost
          e._gravityStrength = 1 - Math.pow(1 - hpPct, 1.8);

          break;
        } else {
          e._gravityStrength = 0;
        }
      }

      // ── GLOBAL SLOW: Absolute Zero — map-wide (strongest freeze tower only) ─
      const globalSlowTower = engine.towers
        .filter((t) => t.specials?.includes("globalSlow"))
        .sort((a, b) => (b.range || 0) - (a.range || 0))[0];
      if (globalSlowTower && !e.immunities.includes("freeze")) {
        // Refresh a light permanent slow — does not stack with duplicate towers.
        e.slowTimer = Math.max(e.slowTimer, 12);
      }

      // ── ARMOR SLOW: Permafrost — slowed enemies lose 30% armor ───────────────
      if (e.slowTimer > 1 && e._armorBeforeSlow === undefined) {
        if (engine.towers.some((t) => t.specials?.includes("armorSlow"))) {
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
        e.stealth = Math.floor(engine.tick / (e.phaseCycle / 2)) % 2 === 0;
      }

      // Scatter formation — stay spread from nearby same-type enemies
      if (e.scatterFormation) {
        for (const other of engine.enemies) {
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
        if (engine.tick % 20 === 0) {
          // Solar Core: burn ignores armor (true damage) and stacks cap 10
          const maxStacks = e._burnTrueDamage ? 10 : 3;
          let burnDmg = e.burnDmg * Math.min(e.burnStacks || 1, maxStacks);
          if (
            e._gravityStrength > 0.1 &&
            engine.activeSynergies?.some((s) => s.key === "vortex_inferno")
          ) {
            burnDmg *= 2;
          }

          if (e._burnTrueDamage) {
            // True damage — bypass armor entirely
            e.hp -= burnDmg;
          } else {
            e.hp -= burnDmg * (1 - Math.min(e.armor * 0.5, 0.5)); // half armor reduction
          }

          // attribute burn XP to the inferno tower that applied it
          if (e.burnSourceId) {
            const burnTower = engine.towers.find(
              (t) => t.id === e.burnSourceId,
            );
            if (burnTower) {
              const burnXp = Math.sqrt(burnDmg) * 0.015 * engine.xpMult;
              burnTower.xp += burnXp;
              burnTower.totalDamage += burnDmg;
              engine.towerSystem.checkProgression(burnTower, engine.wave);
            }
          }
          if (e.hp <= 0) {
            engine.combatSystem.killEnemy(e, "inferno", e.burnSourceId);
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
        engine.audio?.playVoidStep();
        if (e._voidStepTimer >= e.mutation.apply.voidStepInterval) {
          e._voidStepTimer = 0;
          const activePath = e._altPath ?? engine.path;
          const targetIdx = Math.min(
            Math.floor(activePath.length * e.mutation.apply.voidStepFraction) +
              e.pathIndex,
            activePath.length - 2,
          );
          if (targetIdx > e.pathIndex) {
            e.pathIndex = targetIdx;
            e.x = activePath[targetIdx].x;
            e.y = activePath[targetIdx].y;
            engine.vfx.addParticles(e.x, e.y, "#818cf8", 20);
            engine.vfx.addFloatingText(
              e.x,
              e.y - 30,
              "⚡ VOID STEP!",
              "#818cf8",
            );
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
            (1 + engine.wave * ADMIN_CONFIG.ai.endlessSpeedPerWave);
          if (stacks > 0) {
            engine.vfx.addFloatingText(
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
            engine.vfx.addFloatingText(
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
          (1 + engine.wave * ADMIN_CONFIG.ai.endlessSpeedPerWave) *
          (1 + (e._thermalBoost || 0.4));
      } else if (
        e.activeEvolutions?.includes("fast_vs_inferno") &&
        e.burnTimer <= 0
      ) {
        // Reset speed when not burning
        e.baseSpeed =
          (ENEMY_TYPES[e.type]?.speed || 1) *
          (1 + engine.wave * ADMIN_CONFIG.ai.endlessSpeedPerWave);
      }

      // ── Medic escort — stay with nearby allies, don't race ahead ─────────
      if (e.type === "healer") {
        const escortRadius = (ENEMY_TYPES.healer.healRadius || 90) * 2.2;
        const nearby = engine.enemies.filter((other) => {
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
            Math.max(0.5, 1 - engine.wave * 0.004),
        ),
      );
      if (e.type === "healer" && engine.tick % healInterval === 0) {
        let healed = 0;
        const healRadius = ENEMY_TYPES.healer.healRadius || 90;
        const healRate = ENEMY_TYPES.healer.healRate || 0.08;

        for (const other of engine.enemies) {
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
            engine.vfx.addParticles(other.x, other.y - 8, "#4ade80", 5);
          }
        }
        if (healed > 0) {
          engine.vfx.addFloatingText(
            e.x,
            e.y - 24,
            `⚕ HEAL ×${healed}`,
            "#4ade80",
          );
        }
      }

      // ── Boss mutation regen (capped to prevent runaway scaling) ─────────────────
      if (
        e.mutation?.apply?.regenRate &&
        engine.tick % 60 === 0 &&
        e.hp < e.maxHp &&
        !e._antiHealTimer
      ) {
        const baseDef = ENEMY_TYPES[e.type];
        // Cap: never heal more than 2% of the BASE definition HP per second
        const regenCap = (baseDef?.hp || e.maxHp) * 0.02;

        let rate = e.mutation.apply.regenRate;
        if (e.phaseTriggered && e.mutation.apply.phase2RegenMult) {
          rate *= e.mutation.apply.phase2RegenMult;
        }

        const rawHeal = e.maxHp * rate;
        const cappedHeal = Math.min(rawHeal, regenCap);
        e.hp = Math.min(e.maxHp, e.hp + cappedHeal);
      }

      // ── Wave modifier: enemy regen ───────────────────────────────────────
      if (
        engine.activeModifier?.apply?.enemyRegenRate &&
        engine.tick % 60 === 0 &&
        e.hp < e.maxHp &&
        !e._antiHealTimer &&
        !e.mutation?.apply?.regenRate // ← DON'T stack with mutation regen
      ) {
        const baseDef = ENEMY_TYPES[e.type];
        const regenCap = (baseDef?.hp || e.maxHp) * 0.01; // 1% base HP cap for modifier regen
        const rawHeal = e.maxHp * engine.activeModifier.apply.enemyRegenRate;
        e.hp = Math.min(e.maxHp, e.hp + Math.min(rawHeal, regenCap));
      }

      // ── Boss mutation: phase cloak (stealth below HP threshold) ──────────
      if (
        e.mutation?.apply?.stealthBelowHp &&
        !e.stealth &&
        e.hp / e.maxHp <= e.mutation.apply.stealthBelowHp
      ) {
        e.stealth = true;
        engine.vfx.addFloatingText(e.x, e.y - 30, "👻 PHASE CLOAK!", "#a78bfa");
        engine.vfx.addParticles(e.x, e.y, "#a78bfa", 20);
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
        engine.enemies.push(twin);
        engine.vfx.addFloatingText(e.x, e.y - 36, "👥 TWIN SPAWN!", "#ef4444");
        engine.vfx.addParticles(e.x, e.y, "#ef4444", 30);
      }

      // Boss spawn-on-damage timer
      if (e.spawnOnDmg) {
        e.spawnOnDmg.timer++;
        if (e.spawnOnDmg.timer >= e.spawnOnDmg.every) {
          e.spawnOnDmg.timer = 0;
          for (let s = 0; s < e.spawnOnDmg.count; s++)
            engine.enemySystem.spawnChildAt(e, e.spawnOnDmg.type);
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
        engine.vfx.addParticles(e.x, e.y, "#ff0000", 25);
        engine.vfx.addFloatingText(e.x, e.y - 24, "⚠ PHASE 2!", "#ff4444");
      }

      // Boss rage — escalates every 25 seconds it survives
      if (e.isBoss) {
        e.rageTimer = (e.rageTimer || 0) + 1;
        if (e.rageTimer > 0 && e.rageTimer % 1500 === 0) {
          e.baseSpeed = Math.min(e.baseSpeed * 1.22, 2.8);
          e.armor = Math.min(0.92, (e.armor || 0) + 0.05);
          engine.vfx.addParticles(e.x, e.y, "#ef4444", 30);
          engine.vfx.triggerShake(5, 8);
          engine.vfx.addFloatingText(
            e.x,
            e.y - 44,
            "🔥 BOSS ENRAGED!",
            "#ef4444",
          );
        }
      }

      // ── Enemy attacks nearby towers ────────────────────────────────────────
      if (engine.tick % 20 === 0) {
        // check 3× per second
        const atkDps = ENEMY_TYPES[e.type]?.attackDps || 0;
        const atkRng = ENEMY_TYPES[e.type]?.attackRange || 0;
        const dmgPer20 = atkDps / 3; // 20 ticks = 1/3 second

        if (atkDps > 0) {
          for (const tower of engine.towers) {
            // ── Decay mirror shield cooldown ──────────────────────────────────
            if (tower._mirrorCooldown > 0) tower._mirrorCooldown--;

            const dx = tower.x - e.x,
              dy = tower.y - e.y;
            if (Math.sqrt(dx * dx + dy * dy) <= atkRng) {
              const resist = tower.damageResist || 0;

              const hasBulwark = engine.towers.some(
                (t) =>
                  t.specials?.includes("bulwarkField") &&
                  Math.sqrt((t.x - tower.x) ** 2 + (t.y - tower.y) ** 2) <=
                    t.range,
              );

              const bulwarkReduction = hasBulwark ? 0.4 : 0;
              const actualDmg =
                dmgPer20 * (1 - resist) * (1 - bulwarkReduction);

              tower.hp = Math.max(0, tower.hp - actualDmg);

              // Leech — boss heals when it successfully damages a tower
              if (
                e.mutation?.apply?.leech &&
                actualDmg > 0 &&
                !e._antiHealTimer
              ) {
                const healAmt = e.maxHp * e.mutation.apply.leech;
                e.hp = Math.min(e.maxHp, e.hp + healAmt);
                engine.vfx.addParticles(e.x, e.y, "#4ade80", 3);
              }

              tower.lastDamagedTick = engine.tick;
              tower.repairCost = Math.ceil(
                ((tower.maxHp - tower.hp) / tower.maxHp) * tower.cost * 0.4,
              );

              // Disable at 0 HP
              if (tower.hp <= 0 && !tower.disabled) {
                engine.audio?.playTowerDestroyed();
                tower.disabled = true;
                engine.vfx.addFloatingText(
                  tower.x,
                  tower.y - 20,
                  `⚠ ${TOWER_TYPES[tower.type]?.name} DISABLED!`,
                  "#ef4444",
                );
                engine.vfx.addParticles(tower.x, tower.y, "#ef4444", 20);
              }

              // Visual crack effect for heavy hits
              if (actualDmg >= 5) {
                engine.vfx.addParticles(tower.x, tower.y, "#94a3b8", 3);
              }
              break; // one tower attacked per enemy per check
            }
          }
        }
      }

      // Use alt path if this enemy was routed from the second entry point
      const activePath = e._altPath ?? engine.path;
      const tgt = activePath[e.pathIndex + 1];
      if (!tgt) {
        engine.lives = Math.max(0, engine.lives - (e.isBoss ? 5 : 1));
        engine.waveLeaks++;
        engine.vfx.addFloatingText(
          activePath[activePath.length - 1].x,
          activePath[activePath.length - 1].y,
          e.isBoss ? "-5 ❤️" : "-1 ❤️",
          "#ef4444",
        );
        engine.enemies.splice(i, 1);
        engine.enemySystem.checkLastStand();

        // Check if the game should prompt for continuation
        if (engine.lives <= 0) {
          const cfg = ADMIN_CONFIG.continueSystem;
          engine.continueCount = engine.continueCount || 0;
          if (engine.continueCount < cfg.maxContinues) {
            engine.state = "continue_prompt";
            engine.continueGoldCost =
              cfg.goldCostBase + cfg.goldCostPerUse * engine.continueCount;
            engine._emitState();
            return;
          }
          engine.state = "gameover";
          engine.waveAI.finalizeGame(false);
          engine.audio?.onGameOver();
          engine._emitState();
        }
        continue;
      }

      const dx = tgt.x - e.x,
        dy = tgt.y - e.y,
        dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0.01) e.angle = Math.atan2(dy, dx);

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
}
