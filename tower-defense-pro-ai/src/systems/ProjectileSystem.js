/**
 * ProjectileSystem.js
 * Spawns projectiles, advances them each tick, resolves hits (splash/chain),
 * and applies tower shot specials that piggyback on firing (black hole, nuke, etc.).
 */

import { CELL_SIZE } from "../gameConstants.js";

export class ProjectileSystem {
  constructor(engine) {
    this.engine = engine;
  }

  /** Spawn a standard projectile from tower toward target. */
  fire(tower, target, damageMult = 1) {
    const engine = this.engine;
    const dx = target.x - tower.x,
      dy = target.y - tower.y,
      dist = Math.sqrt(dx * dx + dy * dy);
    const hasShatterSyn = engine.activeSynergies.some(
      (s) => s.key === "freeze_cannon",
    );
    const hasFrozenCrit = engine.activeSynergies.some(
      (s) => s.key === "sniper_freeze",
    );
    let dmgMult = damageMult;
    if (hasFrozenCrit && tower.type === "sniper" && target.slowTimer > 0)
      dmgMult *= 1.8;

    engine.projectiles.push({
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
            return tower.range * 1.08;
          case "sniper":
            return tower.range * 1.4;
          case "basic":
            return tower.range * 1.3;
          case "cannon":
            return tower.range * 1.35;
          case "freeze":
            return tower.range * 1.25;
          case "inferno":
            return tower.range * 1.3;
          case "vortex":
            return tower.range * 1.3;
          case "missile":
            return tower.range * 1.6;
          default:
            return tower.range * 1.35;
        }
      })(),
      travelDist: 0,
      _baseTowerDamage: tower.damage,
      _targetWasVisible: !target.stealth,
    });

    engine.audio?.playShoot(tower.type);

    if (tower.specials?.includes("allReveal") && tower.type === "sniper") {
      const proj = engine.projectiles[engine.projectiles.length - 1];
      if (target.stealth) proj.armorPiercing = true;
    }

    if (tower.specials?.includes("blackHole") && tower._shotCount % 10 === 0) {
      engine.blackHoles.push({
        x: target.x,
        y: target.y,
        timer: 180,
        radius: 100,
        strength: 3.5,
      });
      engine.vfx.addFloatingText(
        target.x,
        target.y - 20,
        "🌌 BLACK HOLE!",
        "#818cf8",
      );
      engine.vfx.addParticles(target.x, target.y, "#818cf8", 30);
    }

    if (tower.specials?.includes("bigCrunch") && tower._shotCount % 10 === 0) {
      for (const e of engine.enemies) {
        if (e.isBoss) continue;
        const now = engine.tick;
        if (e._bigCrunchCooldown && now - e._bigCrunchCooldown < 240) continue;
        e._bigCrunchCooldown = now;
        const activePath = e._altPath ?? engine.path;
        const maxSteps = Math.max(
          1,
          Math.min(3, Math.floor(6 / (1 + engine.wave * 0.05))),
        );
        const stepsBack = Math.min(maxSteps, e.pathIndex);
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
      for (const e of engine.enemies) {
        if (!e.isBoss) continue;
        const bx = tower.x - e.x,
          by = tower.y - e.y;
        const d = Math.sqrt(bx * bx + by * by) || 1;
        e.x += (bx / d) * 30;
        e.y += (by / d) * 30;
        e.x = Math.max(0, Math.min(engine.canvas.width, e.x));
        e.y = Math.max(0, Math.min(engine.canvas.height, e.y));
      }
      engine.vfx.triggerShake(8, 12);
      engine.vfx.addFloatingText(
        tower.x,
        tower.y - 30,
        "🌑 BIG CRUNCH!",
        "#818cf8",
      );
      engine.vfx.addParticles(tower.x, tower.y, "#818cf8", 50);
    }

    if (tower.specials?.includes("supernova") && tower._shotCount % 6 === 0) {
      for (const e of engine.enemies) {
        const d = Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2);
        if (d <= tower.range * 2) {
          e.burnTimer = Math.max(e.burnTimer, 300);
          e.burnDmg = Math.max(e.burnDmg, tower.burnDamage * 3 || 15);
          e.burnSourceId = tower.id;
          e.burnStacks = Math.min(3, (e.burnStacks || 0) + 1);
        }
      }
      engine.vfx.addParticles(tower.x, tower.y, "#ef4444", 50);
      engine.vfx.addFloatingText(
        tower.x,
        tower.y - 30,
        "💢 SUPERNOVA!",
        "#ef4444",
      );
    }

    if (
      tower.specials?.includes("solarBlind") &&
      tower._shotCount > 0 &&
      tower._shotCount % 10 === 0
    ) {
      for (const e of engine.enemies) {
        if (!e._solarBlindCooldown) {
          e.slowTimer = Math.max(e.slowTimer, 60);
          e._solarBlindCooldown = 180;
        }
      }
      engine.vfx.addFloatingText(
        engine.canvas.width / 2,
        engine.canvas.height / 2 - 20,
        "☀️ SOLAR FLARE!",
        "#fbbf24",
      );
      engine.vfx.addParticles(
        engine.canvas.width / 2,
        engine.canvas.height / 2,
        "#fbbf24",
        40,
      );
    }

    if (tower.specials?.includes("twinShot") && tower.type === "sniper") {
      const offset = 0.12;
      const mainAng = Math.atan2(dy, dx);
      const base = engine.projectiles[engine.projectiles.length - 1];
      engine.projectiles.push({
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

    if (tower.specials?.includes("salvo")) {
      const secondTarget =
        engine.enemies
          .filter((e) => {
            if (e.id === target.id) return false;
            if (e.stealth && tower.type !== "laser") return false;
            if (e.immunities.includes(tower.type)) return false;
            return (
              Math.sqrt((e.x - tower.x) ** 2 + (e.y - tower.y) ** 2) <=
              tower.range
            );
          })
          .sort((a, b) => b.distanceTraveled - a.distanceTraveled)[0] || target;

      const dx2 = secondTarget.x - tower.x,
        dy2 = secondTarget.y - tower.y;
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
      engine.projectiles.push({
        ...engine.projectiles[engine.projectiles.length - 1],
        id: Date.now() + Math.random() + 0.1,
        vx: (dx2 / dist2) * tower.projectileSpeed,
        vy: (dy2 / dist2) * tower.projectileSpeed,
        targetId: secondTarget.id,
        homing: true,
        _isSalvo: true,
        maxTravelDist: tower.range * 1.6,
      });
    }

    if (tower.specials?.includes("smartSwarm")) {
      const swarmCandidates = engine.enemies
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
        engine.projectiles.pop();
        for (let si = 0; si < swarmCandidates.length; si++) {
          const st = swarmCandidates[si];
          const sdy = st.y - tower.y,
            sdx = st.x - tower.x;
          const spread = (si - (swarmCandidates.length - 1) / 2) * 0.1;
          const ang = Math.atan2(sdy, sdx) + spread;
          engine.projectiles.push({
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

    tower._shotCount = (tower._shotCount || 0) + 1;
    if (
      (tower.specials?.includes("nuclearPayload") ||
        tower.specials?.includes("nuke")) &&
      tower._shotCount % (tower.specials?.includes("nuke") ? 8 : 5) === 0
    ) {
      setTimeout(() => {
        for (const e of engine.enemies) {
          engine.combatSystem.damageEnemy(e, tower.damage * 4, {
            towerType: tower.type,
            towerId: tower.id,
            armorPiercing: true,
            specials: [],
          });
        }
        engine.audio?.playNuke();
        engine.vfx.triggerShake(10, 20);
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 40,
          "☢️ NUKE!",
          "#ef4444",
        );
        engine.vfx.addParticles(
          engine.canvas.width / 2,
          engine.canvas.height / 2,
          "#ef4444",
          80,
        );
      }, 200);
    }

    if (tower.specials?.includes("timeStop") && tower._shotCount % 5 === 0) {
      for (const e of engine.enemies) {
        if (!e.immunities.includes("freeze") && e.stunCooldown <= 0) {
          e.stunTimer = Math.max(e.stunTimer, e.isBoss ? 60 : 120);
          e.stunCooldown = e.isBoss ? 120 : 60;
        }
      }
      engine.vfx.addFloatingText(
        engine.canvas.width / 2,
        engine.canvas.height / 2,
        "⏱ TIME STOP!",
        "#a5f3fc",
      );
      engine.vfx.addParticles(
        engine.canvas.width / 2,
        engine.canvas.height / 2,
        "#a5f3fc",
        30,
      );
    }

    tower._drawAngle =
      Math.atan2(target.y - tower.y, target.x - tower.x) + Math.PI / 2;

    // ── Ascension: Extinction Protocol — every bullet applies all debuffs ─
    if (tower.specials?.includes("extinctionProtocol")) {
      const proj = engine.projectiles[engine.projectiles.length - 1];
      if (proj) {
        proj.slowDuration = 180;
        proj.slowFactor = 0.1;
        proj.burnDamage = tower.burnDamage || 5;
        proj.burnDuration = 180;
        proj.chainTargets = Math.max(proj.chainTargets, 3);
        proj.armorPiercing = true;
        if (!proj.specials.includes("stunOnHit"))
          proj.specials.push("stunOnHit");
        if (!proj.specials.includes("antiHeal")) proj.specials.push("antiHeal");
      }
    }

    // ── Ascension: Doomsday Protocol — every missile shot = full nuke ─────
    if (
      tower.specials?.includes("doomsdayProtocol") &&
      tower.type === "missile"
    ) {
      setTimeout(() => {
        if (engine.state !== "wave") return;
        for (const e of engine.enemies) {
          engine.combatSystem.damageEnemy(e, tower.damage * damageMult * 3, {
            towerType: "missile",
            towerId: tower.id,
            armorPiercing: true,
            specials: [],
          });
        }
        engine.audio?.playNuke();
        engine.vfx.triggerShake(12, 20);
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 40,
          "☢️ DOOMSDAY!",
          "#f43f5e",
        );
        engine.vfx.addParticles(
          engine.canvas.width / 2,
          engine.canvas.height / 2,
          "#f43f5e",
          100,
        );
      }, 400);
    }

    tower._recoilTimer = 8;
  }

  update() {
    const engine = this.engine;
    const globalReveal = engine.towers.some((t) =>
      t.specials?.includes("allReveal"),
    );
    for (let i = engine.projectiles.length - 1; i >= 0; i--) {
      const p = engine.projectiles[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.maxTravelDist > 0) {
        p.travelDist =
          (p.travelDist || 0) + Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (p.travelDist > p.maxTravelDist) {
          engine.projectiles.splice(i, 1);
          continue;
        }
      }

      if (p.homing) {
        let target = p.targetId
          ? engine.enemies.find((e) => e.id === p.targetId)
          : null;

        if (!target) {
          const isMissile =
            p.towerType === "missile" &&
            !p._isSalvo &&
            !p._isSwarm &&
            !p._isSeeker;
          target = engine.enemies
            .filter((e) => {
              if (!e) return false;
              if (e.stealth && p.towerType !== "laser") return false;
              if (e.immunities.includes(p.towerType)) return false;
              if (p.piercedEnemies?.has(e.id)) return false;
              return true;
            })
            .sort((a, b) =>
              isMissile
                ? b.hp - a.hp
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
        p.x > engine.canvas.width + 20 ||
        p.y < -20 ||
        p.y > engine.canvas.height + 20
      ) {
        engine.projectiles.splice(i, 1);
        continue;
      }

      let hit = false;
      const isPiercing =
        p.specials?.includes("pierceThrough") ||
        p.specials?.includes("fullPierce");
      if (!p.piercedEnemies) p.piercedEnemies = new Set();

      for (let j = engine.enemies.length - 1; j >= 0; j--) {
        const e = engine.enemies[j];

        // defensive check since enemies can be removed mid-loop
        if (!e) continue;

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
            p.piercedEnemies.add(e.id);
            if (p.splash > 0 || p.pullForce > 0) {
              this.dealSplashDamage(p, e);
            } else {
              engine.combatSystem.damageEnemy(e, p.damage, p);
              if (p.chainTargets > 0)
                this._chainLightning(e, p, p.chainTargets);
            }
          } else {
            if (p.splash > 0 || p.pullForce > 0) {
              this.dealSplashDamage(p, e);
            } else {
              engine.combatSystem.damageEnemy(e, p.damage, p);
              if (p.chainTargets > 0)
                this._chainLightning(e, p, p.chainTargets);
            }
            if (p.specials?.includes("teleportBack")) {
              const shouldTeleport = e.isBoss
                ? Math.random() < 0.05 // 5% chance for bosses
                : Math.random() < 0.75; // 50% chance for non-bosses

              const keepProgress = e.isBoss ? 0.75 : 0.25; // Bosses can only be teleported up to 25% back, non-bosses up to 75% back

              if (shouldTeleport) {
                e.pathIndex = Math.max(
                  0,
                  Math.floor(e.pathIndex * keepProgress),
                );
                e.x = engine.path[e.pathIndex].x;
                e.y = engine.path[e.pathIndex].y;

                engine.vfx.addFloatingText(
                  e.x,
                  e.y - 20,
                  "TELEPORTED BACK!",
                  "#818cf8",
                );
              }
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
        engine.vfx.addParticles(p.x, p.y, p.color, hitParticles);
        if (p.towerType === "missile") engine.vfx.triggerShake(3, 4);
        if (!isPiercing) engine.projectiles.splice(i, 1);
      }
    }
  }

  dealSplashDamage(p, primaryEnemy) {
    const engine = this.engine;
    for (const se of engine.enemies) {
      if (
        se.immunities.includes(p.towerType) &&
        !p.specials?.includes("fullPierce")
      )
        continue;

      // Synergy: vortex_cannon — extend splash radius by 30% for pulled enemies
      const hasVortexCannon =
        p.towerType === "cannon" &&
        engine.activeSynergies.some((s) => s.key === "vortex_cannon");
      const effectiveSplash =
        hasVortexCannon && se._gravityStrength > 0.1
          ? p.splash * 1.3
          : p.splash;

      const sd = Math.sqrt((se.x - p.x) ** 2 + (se.y - p.y) ** 2);
      if (sd < effectiveSplash) {
        let dmg =
          se.id === primaryEnemy.id
            ? p.damage
            : p.damage * (1 - (sd / effectiveSplash) * 0.5);

        const hasShatterSyn = engine.activeSynergies.some(
          (s) => s.key === "freeze_cannon",
        );
        if (hasShatterSyn && p.towerType === "cannon" && se.slowTimer > 0)
          dmg *= 1.5;

        engine.combatSystem.damageEnemy(se, dmg, p);

        if (p.pullForce > 0 && sd > 2) {
          if (se._gravityImmune) {
            const hasBulwark = engine.towers.some(
              (t) =>
                t.specials?.includes("bulwarkField") &&
                Math.sqrt((t.x - p.x) ** 2 + (t.y - p.y) ** 2) <= t.range * 1.5,
            );
            if (hasBulwark && !se.gravityImmune) {
              const ang = Math.atan2(p.y - se.y, p.x - se.x);
              const effectivePull = p.pullForce * (1 - sd / p.splash);
              se.x += Math.cos(ang) * effectivePull * 0.5;
              se.y += Math.sin(ang) * effectivePull * 0.5;
            }
          } else {
            const ang = Math.atan2(p.y - se.y, p.x - se.x);
            const effectivePull = p.pullForce * (1 - sd / p.splash);
            se.x += Math.cos(ang) * effectivePull;
            se.y += Math.sin(ang) * effectivePull;

            if (effectivePull >= 1.5 && !se.isBoss && se.pathIndex > 0) {
              const stepsBack = Math.min(
                Math.floor(effectivePull / 2.5),
                Math.floor(se.pathIndex * 0.25),
              );
              if (stepsBack > 0) {
                se.pathIndex = Math.max(0, se.pathIndex - stepsBack);
                se.x = engine.path[se.pathIndex].x;
                se.y = engine.path[se.pathIndex].y;
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

    if (p.specials?.includes("darkStarDebuff") && p.pullForce > 0) {
      for (const se of engine.enemies) {
        const d = Math.sqrt((se.x - p.x) ** 2 + (se.y - p.y) ** 2);
        if (d < p.splash) se._darkStarDebuffTimer = 180;
      }
    }

    const hasInfernoCannon = engine.activeSynergies.some(
      (s) => s.key === "inferno_cannon",
    );
    if (
      p.specials?.includes("burnOnSplash") ||
      (hasInfernoCannon && p.towerType === "cannon")
    ) {
      const infernoTower = engine.towers.find((t) => t.type === "inferno");
      engine.burnZones.push({
        x: p.x,
        y: p.y,
        radius: (p.splash || 65) * 0.7,
        damage: Math.max(2, infernoTower?.burnDamage || 2),
        timer: 180,
        color: "#ef4444",
      });
    }

    if (p.towerType === "vortex" && p.pullForce > 0) {
      const vt = engine.towers.find((t) => t.id === p.towerId);
      if (vt) vt._wavePulls = (vt._wavePulls || 0) + 1;
    }

    engine.vfx.addParticles(p.x, p.y, p.color, 14);
  }

  _chainLightning(primaryEnemy, proj, remainingChains) {
    if (remainingChains <= 0) return;
    const engine = this.engine;

    const chainCandidates = engine.enemies
      .filter((e) => {
        if (!e) return false;
        if (e.id === primaryEnemy.id) return false;
        if (e.immunities.includes(proj.towerType)) return false;
        if (e.stealth && proj.towerType !== "laser") return false;
        const dx = e.x - primaryEnemy.x;
        const dy = e.y - primaryEnemy.y;
        return Math.sqrt(dx * dx + dy * dy) <= (proj.chainRange || 80);
      })
      .sort((a, b) => {
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
      const falloff = 1 - (dist / chainRange) * 0.5;
      const chainDmg = proj.damage * Math.max(0.5, falloff);

      engine.combatSystem.damageEnemy(chainTarget, chainDmg, {
        ...proj,
        chainTargets: 0,
      });

      engine.vfx.addBolt(
        primaryEnemy.x,
        primaryEnemy.y,
        chainTarget.x,
        chainTarget.y,
        proj.color,
      );

      engine.vfx.addParticles(chainTarget.x, chainTarget.y, proj.color, 3);
    }
  }
}
