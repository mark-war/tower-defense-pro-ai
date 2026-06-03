/**
 * CombatSystem.js
 * Central authority for damage resolution and enemy death.
 * All damage in the game flows through damageEnemy().
 *
 * Kept separate from EnemySystem so projectile/tower/ability code
 * can call it without creating circular dependencies.
 */

import { TOWER_TYPES, ENEMY_TYPES, ADMIN_CONFIG } from "../gameConstants.js";
import {
  calcKillXp,
  calcAssistXp,
  calcEffectiveXpMult,
} from "../helpers/xpHelpers.js";

const CFG = ADMIN_CONFIG.ai;

export class CombatSystem {
  constructor(engine) {
    this.engine = engine;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Apply damage to an enemy, respecting armour, immunities, mutations,
   * and all special tags on the projectile/source descriptor.
   *
   * @param {object} enemy  - live enemy object
   * @param {number} rawDmg - damage before reductions
   * @param {object} proj   - { towerType, towerId, armorPiercing, specials, ... }
   */
  damageEnemy(enemy, rawDmg, proj) {
    const engine = this.engine;
    // const effectiveXpMult = calcEffectiveXpMult(
    //   engine.isEndless,
    //   engine.xpMult,
    //   engine.wave,
    // );

    // Dodge
    if (enemy.dodgeChance && Math.random() < enemy.dodgeChance) {
      engine.vfx.addFloatingText(enemy.x, enemy.y - 10, "DODGE", "#facc15");
      return;
    }

    // executionShot — instant kill <40% HP; bosses take 4× dmg
    if (proj?.specials?.includes("executionShot")) {
      if (!enemy.isBoss && enemy.hp / enemy.maxHp <= 0.4) {
        enemy.hp = 0;
      } else if (enemy.isBoss) {
        dmg *= 4;
      }
    }

    let dmg = rawDmg;

    // Dark Star debuff
    if (enemy._darkStarDebuffTimer > 0) dmg *= 3;

    // Damage type resolution
    const damageType = proj?.towerType
      ? TOWER_TYPES[proj.towerType]?.damageType || "physical"
      : "physical";
    const isMagical = damageType === "magical";
    const isHybrid = damageType === "hybrid";
    const isTrueDmg =
      proj?.specials?.includes("trueDamage") ||
      proj?.specials?.includes("fullPierce");

    // Armour reduction
    if (!proj?.armorPiercing && !isTrueDmg) {
      let effectiveArmor = enemy.armor;
      if (enemy.piercingResist) effectiveArmor *= 1 - enemy.piercingResist;
      if (isMagical) effectiveArmor *= 0.35;
      else if (isHybrid) effectiveArmor *= 0.6;
      dmg *= 1 - effectiveArmor;
    }

    // Synergy: tesla_missile — missiles deal +40% damage to stunned enemies
    if (
      proj?.towerType === "missile" &&
      enemy.stunTimer > 0 &&
      engine.activeSynergies.some((s) => s.key === "tesla_missile")
    ) {
      dmg *= 1.4;
    }

    // Synergy: laser_sniper — sniper deals +60% damage to enemies hit by laser recently
    if (
      proj?.towerType === "sniper" &&
      enemy._laserTaggedTimer > 0 &&
      engine.activeSynergies.some((s) => s.key === "laser_sniper")
    ) {
      dmg *= 1.6;
    }

    // Synergy: vortex_inferno — pulled enemies take 2x burn damage
    if (
      enemy._gravityStrength > 0.1 &&
      proj?.burnDamage &&
      engine.activeSynergies.some((s) => s.key === "vortex_inferno")
    ) {
      dmg *= 2.0;
    }

    // Execute: 4× burn below 20% HP
    if (
      proj?.specials?.includes("execute") &&
      enemy.hp / enemy.maxHp <= 0.2 &&
      proj?.burnDamage
    ) {
      enemy.burnDmg = Math.max(enemy.burnDmg, proj.burnDamage * 4);
      enemy.burnTimer = Math.max(enemy.burnTimer, 120);
      enemy.burnSourceId = proj.towerId;
    }

    // Shatter Buff — frozen/slowed enemies take 2× damage
    if (!isTrueDmg) {
      const attackingTower = proj?.towerId
        ? engine.towers.find((t) => t.id === proj.towerId)
        : null;
      if (
        attackingTower?.specials?.includes("shatterBuff") &&
        (enemy.slowTimer > 0 || enemy.stunTimer > 0)
      )
        dmg *= 2;
    }

    // Type resistances
    if (!isTrueDmg) {
      if (isMagical && enemy.magicalResist) dmg *= 1 - enemy.magicalResist;
      if (!isMagical && !isHybrid && enemy.physicalResist)
        dmg *= 1 - enemy.physicalResist;
    }

    // Flash Freeze: first hit instantly freezes
    if (
      proj?.specials?.includes("instantFreeze") &&
      !enemy._flashFrozen &&
      !enemy.immunities.includes("freeze")
    ) {
      enemy.stunTimer = Math.max(enemy.stunTimer, enemy.isBoss ? 90 : 180);
      enemy.slowTimer = 0;
      enemy._flashFrozen = true;
      engine.vfx.addParticles(enemy.x, enemy.y, "#a5f3fc", 20);
      engine.vfx.addFloatingText(enemy.x, enemy.y - 16, "❄ FROZEN!", "#a5f3fc");
    }

    // Armor melt
    if (proj?.specials?.includes("armorMelt") && enemy.burnTimer > 0)
      enemy.armor = Math.max(0, enemy.armor - 0.4);

    // Map bonus damage
    if (engine.activeMapBonus?.type === "damage")
      dmg *= 1 + engine.activeMapBonus.value;

    // Tower damage multiplier from boss mutation
    if (enemy.towerDamageMult) dmg *= enemy.towerDamageMult;

    enemy.hp -= dmg;

    // Show typed damage number (throttle to avoid spam: only ~30% of hits)
    if (Math.random() < 0.3 && proj?.towerType && dmg >= 5) {
      engine.vfx.addDamageNumber(
        enemy.x,
        enemy.y - enemy.size - 4,
        dmg,
        proj.towerType,
      );
    }

    // Track last hitter for adaptive immunity
    if (proj?.towerType) enemy._lastHitByTower = proj.towerType;

    // Track laser tag for laser_sniper synergy (2 seconds = 120 ticks)
    if (proj?.towerType === "laser") enemy._laserTaggedTimer = 120;

    // Immunity Break
    if (
      proj?.specials?.includes("immunityBreak") &&
      enemy._adaptiveCurrentImmunity
    ) {
      enemy.immunities = enemy.immunities.filter(
        (i) => i !== enemy._adaptiveCurrentImmunity,
      );
      enemy._adaptiveCurrentImmunity = null;
      enemy._adaptiveTimer = 0;
      engine.vfx.addFloatingText(
        enemy.x,
        enemy.y - 24,
        "⚡ IMMUNITY STRIPPED!",
        "#fbbf24",
      );
    }

    // Anti-Heal
    if (proj?.specials?.includes("antiHeal")) {
      enemy._antiHealTimer = 360;
      if (!enemy._antiHealApplied) {
        enemy._antiHealApplied = true;
        engine.vfx.addFloatingText(
          enemy.x,
          enemy.y - 20,
          "🩸 NO REGEN!",
          "#ef4444",
        );
      }
    }

    // Mirror Shield reflect
    if (enemy.mutation?.apply?.mirrorShield && proj?.towerId)
      this._applyMirrorReflect(enemy, proj, dmg);

    // Gravity immune flag for vortex
    if (
      (enemy.gravityImmune || enemy.mutation?.apply?.gravityImmune) &&
      proj?.towerType === "vortex"
    )
      enemy._gravityImmune = true;

    // Omega Rift
    if (proj?.specials?.includes("omegaRift")) {
      const cooldown = enemy.isBoss ? 900 : 300;
      const now = engine.tick;
      if (
        !enemy._omegaRiftCooldown ||
        now - enemy._omegaRiftCooldown >= cooldown
      ) {
        enemy._omegaRiftCooldown = now;
        const fraction = enemy.isBoss ? 0.7 : 0.5;
        const targetIdx = Math.floor(engine.path.length * fraction);
        if (enemy.pathIndex > targetIdx) {
          enemy.pathIndex = targetIdx;
          enemy.x = engine.path[targetIdx].x;
          enemy.y = engine.path[targetIdx].y;
          engine.vfx.addFloatingText(
            enemy.x,
            enemy.y - 20,
            "🌌 RIFT!",
            "#818cf8",
          );
          engine.vfx.addParticles(enemy.x, enemy.y, "#818cf8", 20);
        }
      }
    }

    // Cluster Shot — spawn mini projectiles on impact
    if (
      proj?.specials?.includes("clusterShot") &&
      !proj._isCluster &&
      !proj._clusterFired
    )
      this._spawnClusterShards(enemy, proj);

    // Cluster Warhead
    if (proj?.specials?.includes("clusterWarhead") && !proj._isWarheadShard)
      this._spawnWarheadShards(enemy, proj);

    // Boss shake & audio
    if (enemy.isBoss && proj?.towerId) {
      const t = engine.towers.find((t) => t.id === proj.towerId);
      if (t) t._hitBoss = true;
    }
    if (enemy.isBoss && dmg > 50) engine.vfx.triggerShake(4, 5);
    if (enemy.isBoss && !enemy._hurtPlayed && enemy.hp / enemy.maxHp < 0.5) {
      enemy._hurtPlayed = true;
      engine.audio?.playBossHurt();
    }

    // Status effects
    if (proj?.slowDuration && !enemy.immunities.includes(proj.towerType)) {
      enemy.slowTimer = proj.slowDuration;
      if (proj.towerType === "freeze") {
        const freezeTower = engine.towers.find((t) => t.id === proj.towerId);
        if (freezeTower) {
          freezeTower._waveSlowHits = (freezeTower._waveSlowHits || 0) + 1;
          freezeTower.xp +=
            0.3 *
            calcEffectiveXpMult(engine.isEndless, engine.xpMult, engine.wave);
          engine.towerSystem.checkProgression(freezeTower, engine.wave);
        }
      }
    }

    if (proj?.specials?.includes("stunOnHit") && enemy.stunCooldown <= 0) {
      if (!enemy.isBoss) {
        enemy.stunTimer = 20;
        enemy.stunCooldown = 60;
      } else {
        enemy.stunTimer = 30;
        enemy.stunCooldown = 120;
      }
      if (proj?.towerId) enemy.assistTowers?.add(proj.towerId);
    }

    if (proj?.burnDamage && proj?.burnDuration) {
      enemy.burnTimer = proj.burnDuration;
      enemy.burnDmg = proj.burnDamage;
      enemy.burnSourceId = proj.towerId;
      if (proj.specials?.includes("burnStack"))
        enemy.burnStacks = Math.min(3, (enemy.burnStacks || 0) + 1);
    }

    // Damage stat tracking
    const tt = proj?.towerType;
    if (tt) {
      engine.waveDamageByTower[tt] = (engine.waveDamageByTower[tt] || 0) + dmg;
      const tower = engine.towers.find((t) => t.id === proj.towerId);
      if (tower) {
        tower.totalDamage += dmg;
        tower._waveHits = tower._waveHits || new Set();
        tower._waveHits.add(enemy.id);
      }
    }

    // AoE secondary effects
    this._applySecondaryAoEEffects(enemy, proj);

    // Void Burst — delayed explosion
    if (proj?.specials?.includes("voidBurst") && !proj._isVoidBurst)
      this._scheduleVoidBurst(enemy, proj);

    // Quake Stun
    if (proj?.specials?.includes("quakeStun") && proj.splash > 0) {
      for (const se of engine.enemies) {
        const sd = Math.sqrt((se.x - proj.x) ** 2 + (se.y - proj.y) ** 2);
        if (sd < proj.splash * 1.4 && se.stunCooldown <= 0) {
          se.stunTimer = 30;
          se.stunCooldown = 90;
        }
      }
    }

    // Bullet Chain bounce
    if (
      proj?.specials?.includes("bulletChain") &&
      (proj._chainBounces || 0) < 3
    )
      this._spawnBulletChainBounce(enemy, proj);

    // Seeker Chain
    if (
      proj?.specials?.includes("seekerChain") &&
      !proj._isSeeker &&
      !proj._seekerFired
    )
      this._spawnSeekerChain(enemy, proj);

    if (enemy.hp <= 0) this.killEnemy(enemy, proj?.towerType, proj?.towerId);
  }

  /**
   * Handle enemy death: rewards, XP, spawns, loot, achievements.
   */
  killEnemy(enemy, towerType, towerId) {
    const engine = this.engine;
    const idx = engine.enemies.indexOf(enemy);
    if (idx === -1) return;

    const killerTower = engine.towers.find((t) => t.id === towerId);
    if (
      killerTower?.specials?.includes("execute") &&
      enemy._berserkerStacks > 0
    ) {
      enemy._berserkerStacks = 0;
      engine.vfx.addFloatingText(
        enemy.x,
        enemy.y - 20,
        "💀 BERSERKER RESET!",
        "#ef4444",
      );
    }

    const effectiveXpMult = calcEffectiveXpMult(
      engine.isEndless,
      engine.xpMult,
      engine.wave,
    );

    // Streak
    engine._streakWindow = 180;
    engine._streakCount++;
    engine._streakTimer = 90;

    engine.audio?.playEnemyDeath(enemy.isBoss, enemy.type);

    // Streak gold bonus every 5 kills
    if (engine._streakCount >= 5 && engine._streakCount % 5 === 0) {
      const bonus = Math.min(4 + Math.floor(engine._streakCount / 5) * 4, 40);
      engine.gold += bonus;
      engine.vfx.addFloatingText(
        enemy.x,
        enemy.y - 32,
        `🔥 ${engine._streakCount} STREAK  +${bonus}g`,
        "#fbbf24",
      );
      engine.audio?.playStreak(engine._streakCount);
    }

    engine.gold += enemy.reward;
    engine.audio?.playGoldEarned(enemy.reward);
    engine.score += Math.floor(
      enemy.reward * engine.wave * (enemy.isBoss ? 5 : 1),
    );
    engine.waveKills++;
    engine.runStats.totalKills++;
    engine.runStats.maxGoldAtOnce = Math.max(
      engine.runStats.maxGoldAtOnce,
      engine.gold,
    );

    if (towerType && !enemy.isBoss)
      engine.waveAI.recordEnemyKill(towerType, enemy.type);

    if (enemy.isBoss) {
      engine.runStats.bossKills++;
      if (enemy.mutation) {
        engine.runStats.mutatedBossKills++;
        engine.achievementSystem.unlock("mutation_slayer");
      }
      engine.achievementSystem.unlock("boss_slayer");
      engine.waveAI.recordBossResult(enemy.type, true, towerType);
      this._triggerBossLoot(enemy);
      engine.audio?.onBossKill();
    }

    // Assist XP
    if (enemy.assistTowers?.size > 0) {
      for (const assistId of enemy.assistTowers) {
        if (assistId === towerId) continue;
        const assistTower = engine.towers.find((t) => t.id === assistId);
        if (!assistTower) continue;
        assistTower.xp += calcAssistXp(assistTower, enemy) * effectiveXpMult;
        engine.towerSystem.checkProgression(assistTower, engine.wave);
      }
    }

    // Killer tower XP
    const tower = engine.towers.find((t) => t.id === towerId);
    if (tower) {
      tower.kills++;
      tower.xp += calcKillXp(tower, enemy) * effectiveXpMult;
      engine.towerSystem.checkProgression(tower, engine.wave);
      tower._waveKillsThisWave = (tower._waveKillsThisWave || 0) + 1;
    }

    engine.vfx.addParticles(
      enemy.x,
      enemy.y,
      enemy.color,
      enemy.isBoss ? 35 : 10,
    );
    engine.vfx.addFloatingText(
      enemy.x,
      enemy.y - 12,
      `+${enemy.reward}g${enemy.isBoss ? " 💀" : ""}`,
      enemy.isBoss ? "#ff4444" : "#facc15",
    );

    // Death spawns
    if (enemy.spawnsOnDeath && enemy.spawnCount > 0)
      for (let i = 0; i < enemy.spawnCount; i++)
        engine.enemySystem.spawnChildAt(enemy, enemy.spawnsOnDeath);

    // Splinter mutation
    if (enemy.mutation?.apply?.splinterDeath && enemy.isBoss)
      this._spawnSplinters(enemy);

    // Ice Age — chill nearby enemies on kill (slow, not hard stun)
    if (
      engine.towers.some((t) => t.specials?.includes("iceAge")) &&
      !enemy.isBoss
    ) {
      const now = engine.tick;
      for (const other of engine.enemies) {
        if (other.immunities.includes("freeze")) continue;
        const d = Math.sqrt(
          (other.x - enemy.x) ** 2 + (other.y - enemy.y) ** 2,
        );
        if (d >= 120) continue;

        // Per-enemy cooldown: 4s gap between re-applications
        if (other._iceAgeCooldown && now - other._iceAgeCooldown < 240)
          continue;

        // Distance falloff: 2.5s inner / 1.25s outer
        const slowDuration = d < 50 ? 150 : 75;

        // slowTimer not stunTimer — enemies still crawl forward
        other.slowTimer = Math.max(other.slowTimer, slowDuration);
        other._iceAgeCooldown = now;
      }
      engine.vfx.addParticles(enemy.x, enemy.y, "#a5f3fc", 18);
    }

    // Death Ignite — Phoenix Core
    if (
      engine.towers.some((t) => t.specials?.includes("deathIgnite")) &&
      !enemy.isBoss
    ) {
      for (const other of engine.enemies) {
        const d = Math.sqrt(
          (other.x - enemy.x) ** 2 + (other.y - enemy.y) ** 2,
        );
        if (d < 60 && d > 0) {
          other.burnTimer = Math.max(other.burnTimer, 120);
          other.burnDmg = Math.max(other.burnDmg, 4);
        }
      }
      engine.vfx.addParticles(enemy.x, enemy.y, "#ef4444", 20);
    }

    engine.enemies.splice(idx, 1);
    engine._emitState();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _triggerBossLoot(boss) {
    const engine = this.engine;
    const loot = boss.lootDrop;
    if (!loot) return;

    if (loot.type === "speed_boost")
      engine.globalBuff = {
        fireRateMult: 0.5,
        damageMult: 1,
        timer: loot.duration,
        label: loot.label,
      };
    if (loot.type === "damage_boost")
      engine.globalBuff = {
        fireRateMult: 1,
        damageMult: 2,
        timer: loot.duration,
        label: loot.label,
      };
    if (loot.type === "gold_shower") {
      engine.gold += loot.amount;
      engine.vfx.addFloatingText(
        boss.x,
        boss.y - 30,
        `+${loot.amount}g 💰`,
        "#facc15",
      );
    }
    if (loot.type === "lives_restore") {
      engine.lives = Math.min(
        engine.levelConfig.startLives,
        engine.lives + loot.amount,
      );
      engine.vfx.addFloatingText(
        boss.x,
        boss.y - 30,
        `+${loot.amount} ❤️`,
        "#4ade80",
      );
      engine.enemySystem.checkLastStand();
    }
    engine.vfx.addFloatingText(
      engine.canvas.width / 2,
      80,
      `🎁 BOSS LOOT: ${loot.label}`,
      "#fbbf24",
    );
  }

  _applyMirrorReflect(enemy, proj, dmg) {
    const engine = this.engine;
    const sourceTower = engine.towers.find((t) => t.id === proj.towerId);
    if (!sourceTower) return;

    sourceTower._mirrorCooldown = sourceTower._mirrorCooldown || 0;
    if (sourceTower._mirrorCooldown > 0) return;

    const reflectPct = enemy.mutation.apply.mirrorShield;
    const reflectCap = enemy.mutation.apply.mirrorShieldCap || 15;
    let reflectDmg = Math.min(dmg * reflectPct, reflectCap);

    // Mass Repair Shield mutation blocks reflect damage
    if (sourceTower._massRepairShield > 0) {
      reflectDmg = 0;
    }

    if (sourceTower.hp > sourceTower.maxHp * 0.15) {
      const actualReflect = reflectDmg * (1 - (sourceTower.damageResist || 0));
      sourceTower.hp = Math.max(
        sourceTower.maxHp * 0.1,
        sourceTower.hp - actualReflect,
      );
      sourceTower.lastDamagedTick = engine.tick;
      sourceTower.repairCost = Math.ceil(
        ((sourceTower.maxHp - sourceTower.hp) / sourceTower.maxHp) *
          sourceTower.cost *
          0.4,
      );
      sourceTower._mirrorCooldown =
        enemy.mutation.apply.mirrorShieldCooldown || 180;
      engine.vfx.addParticles(sourceTower.x, sourceTower.y, "#a78bfa", 5);
    }
  }

  _applySecondaryAoEEffects(enemy, proj) {
    const engine = this.engine;

    // Area Freeze
    if (proj?.specials?.includes("areaFreeze") && proj.towerType === "freeze") {
      for (const e of engine.enemies) {
        if (e.id === enemy.id || e.immunities.includes("freeze")) continue;
        const d = Math.sqrt((e.x - enemy.x) ** 2 + (e.y - enemy.y) ** 2);
        if (d < 80) e.slowTimer = Math.max(e.slowTimer, 90);
      }
      engine.vfx.addParticles(enemy.x, enemy.y, "#a5f3fc", 18);
    }

    // Full Freeze
    if (
      proj?.specials?.includes("fullFreeze") &&
      !enemy.immunities.includes("freeze")
    ) {
      enemy.stunTimer = Math.max(enemy.stunTimer, enemy.isBoss ? 60 : 120);
      enemy.slowTimer = 0;
      engine.vfx.addParticles(enemy.x, enemy.y, "#a5f3fc", 12);
    }

    // Area Ignite
    if (proj?.specials?.includes("areaIgnite")) {
      const burnTower = proj.towerId
        ? engine.towers.find((t) => t.id === proj.towerId)
        : null;
      for (const e of engine.enemies) {
        if (e.id === enemy.id) continue;
        const d = Math.sqrt((e.x - enemy.x) ** 2 + (e.y - enemy.y) ** 2);
        if (d < 70) {
          e.burnTimer = Math.max(e.burnTimer, 120);
          e.burnDmg = burnTower ? burnTower.burnDamage : 3;
          e.burnSourceId = proj.towerId;
        }
      }
      engine.vfx.addParticles(enemy.x, enemy.y, "#ef4444", 15);
    }
  }

  _scheduleVoidBurst(enemy, proj) {
    const engine = this.engine;
    const bx = enemy.x,
      by = enemy.y;
    const burstDamage = proj.damage * 2;
    const burstTowerId = proj.towerId;
    proj._isVoidBurst = true;

    setTimeout(() => {
      if (engine.state !== "wave") return;
      for (const ve of engine.enemies) {
        const dist = Math.sqrt((ve.x - bx) ** 2 + (ve.y - by) ** 2);
        if (dist < 120) {
          this.damageEnemy(ve, burstDamage, {
            ...proj,
            damage: burstDamage,
            towerType: "sniper",
            towerId: burstTowerId,
            _isVoidBurst: true,
            armorPiercing: true,
            specials: [],
          });
        }
      }
      engine.vfx.addParticles(bx, by, "#7c3aed", 40);
      engine.vfx.triggerShake(5, 8);
      engine.vfx.addFloatingText(bx, by - 20, "💫 VOID BURST!", "#818cf8");
    }, 1500);
  }

  _spawnClusterShards(enemy, proj) {
    const engine = this.engine;
    proj._clusterFired = true;
    const baseDamage = proj._baseTowerDamage ?? proj.damage;

    const nearby = engine.enemies
      .filter((e) => e.id !== enemy.id)
      .sort((a, b) => {
        const da = (a.x - enemy.x) ** 2 + (a.y - enemy.y) ** 2;
        const db = (b.x - enemy.x) ** 2 + (b.y - enemy.y) ** 2;
        return db - da;
      })
      .slice(0, 3);

    for (const t of nearby) {
      const dx = t.x - enemy.x,
        dy = t.y - enemy.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      engine.projectiles.push({
        id: Date.now() + Math.random(),
        x: enemy.x,
        y: enemy.y,
        vx: (dx / dist) * (proj.projectileSpeed || 5),
        vy: (dy / dist) * (proj.projectileSpeed || 5),
        damage: baseDamage * 0.2,
        splash: 0,
        color: proj.color,
        size: 3,
        towerType: proj.towerType,
        towerId: proj.towerId,
        armorPiercing: false,
        projectileSpeed: (proj.projectileSpeed || 5) * 1.4,
        slowFactor: 0,
        slowDuration: 0,
        chainTargets: 0,
        burnDamage: 0,
        burnDuration: 0,
        pullForce: 0,
        homing: true,
        targetId: t.id,
        _isCluster: true,
        specials: [],
        hasShatterSyn: proj.hasShatterSyn,
        piercedEnemies: new Set(),
        maxTravelDist: 180,
        travelDist: 0,
      });
    }
  }

  _spawnWarheadShards(enemy, proj) {
    const engine = this.engine;
    const shardCount = 4;
    const blastRadius = proj.splash || 100;

    const candidates = engine.enemies
      .filter(
        (e) =>
          e.id !== enemy.id &&
          !e.immunities.includes("missile") &&
          Math.sqrt((e.x - enemy.x) ** 2 + (e.y - enemy.y) ** 2) < blastRadius,
      )
      .sort((a, b) => {
        const da = (a.x - enemy.x) ** 2 + (a.y - enemy.y) ** 2;
        const db = (b.x - enemy.x) ** 2 + (b.y - enemy.y) ** 2;
        return da - db;
      })
      .slice(0, shardCount);

    const baseAngle = Math.atan2(proj.vy, proj.vx);
    for (let i = 0; i < shardCount; i++) {
      const st = candidates[i] || null;
      const spread = baseAngle + (i - (shardCount - 1) / 2) * 0.45;
      const spd = (proj.projectileSpeed || 2.8) * 1.4;
      engine.projectiles.push({
        ...proj,
        id: Date.now() + Math.random() + i * 0.01,
        x: enemy.x,
        y: enemy.y,
        vx: Math.cos(spread) * spd,
        vy: Math.sin(spread) * spd,
        targetId: st?.id || null,
        homing: !!st,
        projectileSpeed: spd,
        damage: proj.damage * 0.25,
        splash: 0,
        _isWarheadShard: true,
        specials: [],
        maxTravelDist: 200,
        travelDist: 0,
      });
    }
    engine.vfx.addParticles(enemy.x, enemy.y, proj.color, 20);
  }

  _spawnSplinters(enemy) {
    const engine = this.engine;
    const count = enemy.mutation.apply.splinterCount || 3;
    const hpFrac = enemy.mutation.apply.splinterHpFraction || 0.3;

    for (let si = 0; si < count; si++) {
      engine.enemies.push({
        ...enemy,
        id: Date.now() + Math.random() + si,
        hp: enemy.maxHp * hpFrac,
        maxHp: enemy.maxHp * hpFrac,
        size: enemy.size * 0.65,
        x: enemy.x + (Math.random() - 0.5) * 30,
        y: enemy.y + (Math.random() - 0.5) * 30,
        mutation: null,
        twinSpawned: true,
        isSplinter: true,
        reward: Math.floor(enemy.reward * 0.3),
        slowTimer: 0,
        stunTimer: 0,
        burnTimer: 0,
        assistTowers: new Set(),
        _berserkerStacks: 0,
        _voidStepTimer: 0,
      });
    }
    engine.vfx.addFloatingText(
      enemy.x,
      enemy.y - 30,
      `💥 SPLINTER ×${count}!`,
      "#ef4444",
    );
    engine.vfx.addParticles(enemy.x, enemy.y, enemy.color, 40);
  }

  _spawnBulletChainBounce(enemy, proj) {
    const engine = this.engine;
    const nearest = engine.enemies
      .filter((e) => e.id !== enemy.id && !e.stealth)
      .sort((a, b) => {
        const da = Math.sqrt((a.x - enemy.x) ** 2 + (a.y - enemy.y) ** 2);
        const db = Math.sqrt((b.x - enemy.x) ** 2 + (b.y - enemy.y) ** 2);
        return da - db;
      })[0];
    if (!nearest) return;

    const dx = nearest.x - enemy.x,
      dy = nearest.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    engine.projectiles.push({
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
      travelDist: 0,
    });
  }

  _spawnSeekerChain(enemy, proj) {
    const engine = this.engine;
    proj._seekerFired = true;
    const targets = engine.enemies
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
      engine.projectiles.push({
        id: Date.now() + Math.random(),
        x: enemy.x,
        y: enemy.y,
        vx: (dx / dist) * proj.projectileSpeed,
        vy: (dy / dist) * proj.projectileSpeed,
        targetId: t.id,
        homing: true,
        _isSeeker: true,
        damage:
          Math.min(proj.damage, proj._baseTowerDamage ?? proj.damage) * 0.55,
        splash: (proj.splash || 0) * 0.5,
        color: "#ff9999",
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
    }

    if (targets.length > 0)
      engine.vfx.addFloatingText(
        enemy.x,
        enemy.y - 20,
        `↗ ${targets.length} SEEKERS`,
        "#f43f5e",
      );
  }
}
