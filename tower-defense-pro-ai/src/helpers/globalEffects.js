/**
 * globalEffects.js — once-per-tick handling for map-wide tower skills that must not stack.
 */

import { pickStrongestTowerWith } from "../skillRegistry.js";

/**
 * Run map-wide skills that should only fire from the strongest owning tower.
 * Called once per frame from TowerSystem.update().
 */
export function tickGlobalUniqueTowerEffects(engine, ctx) {
  const { towers, enemies, tick } = engine;
  const { damageMult, modFireRateMult, fireRateMult, globalReveal } = ctx;
  if (!enemies.length && tick % 60 !== 0) return;

  // ── Freeze: Heat Death ─────────────────────────────────────────────────────
  const heatDeathTower = pickStrongestTowerWith(towers, "heatDeath", "damage");
  if (heatDeathTower && tick % 30 === 0) {
    for (const e of enemies) {
      if (e.immunities.includes("freeze")) continue;
      if (e.isBoss) {
        e.slowTimer = Math.max(e.slowTimer, 60);
      } else {
        e.stunTimer = Math.max(e.stunTimer, 35);
      }
    }
  }

  // ── Inferno: Infernal Realm ────────────────────────────────────────────────
  const infernalTower = pickStrongestTowerWith(towers, "infernalRealm", "burnDamage");
  if (infernalTower && tick % 60 === 0) {
    for (const e of enemies) {
      if (e.immunities.includes("inferno")) continue;
      e.burnTimer = Math.max(e.burnTimer, 80);
      e.burnDmg = Math.max(e.burnDmg, infernalTower.burnDamage || 5);
      e.burnSourceId = infernalTower.id;
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

  // ── Basic: Void Rings ──────────────────────────────────────────────────────
  const voidTower = pickStrongestTowerWith(towers, "voidRings", "damage");
  if (voidTower && tick % 20 === 0) {
    const ringRadius = 60 + (tick % 120);
    for (const e of enemies) {
      const d = Math.sqrt((e.x - voidTower.x) ** 2 + (e.y - voidTower.y) ** 2);
      if (d < ringRadius && d > ringRadius - 20) {
        engine.combatSystem.damageEnemy(e, voidTower.damage * 0.5, {
          towerType: "basic",
          towerId: voidTower.id,
          armorPiercing: true,
          specials: [],
        });
      }
    }
  }

  // ── Sniper: Omniscience ────────────────────────────────────────────────────
  const omniTower = pickStrongestTowerWith(towers, "omniscience", "damage");
  if (omniTower && tick % 300 === 0 && enemies.length > 0) {
    for (const e of enemies) {
      engine.combatSystem.damageEnemy(e, omniTower.damage * damageMult, {
        towerType: "sniper",
        towerId: omniTower.id,
        armorPiercing: true,
        specials: omniTower.specials,
      });
      engine.vfx.addBolt(omniTower.x, omniTower.y, e.x, e.y, omniTower.color);
    }
    engine.vfx.addFloatingText(
      engine.canvas.width / 2,
      engine.canvas.height / 2 - 50,
      "🌐 OMNISCIENCE!",
      "#38bdf8",
    );
    engine.vfx.triggerShake(4, 6);
  }

  // ── Laser: Solar God ───────────────────────────────────────────────────────
  const solarTower = pickStrongestTowerWith(towers, "solarGod", "damage");
  if (solarTower && tick % 3 === 0) {
    for (const e of enemies) {
      engine.combatSystem.damageEnemy(e, solarTower.damage * damageMult, {
        towerType: "laser",
        towerId: solarTower.id,
        armorPiercing: true,
        specials: ["trueDamage"],
      });
      if (tick % 30 === 0)
        engine.vfx.addBolt(solarTower.x, solarTower.y, e.x, e.y, solarTower.color);
    }
  }

  // ── Tesla: Storm God ───────────────────────────────────────────────────────
  const stormTower = pickStrongestTowerWith(towers, "stormGod", "damage");
  if (stormTower && tick % 4 === 0) {
    const stormDmg = 22 * damageMult;
    for (const e of enemies) {
      if (
        e.immunities.includes("tesla") &&
        !stormTower.specials.includes("fullPierce")
      )
        continue;
      engine.combatSystem.damageEnemy(e, stormDmg, {
        towerType: "tesla",
        towerId: stormTower.id,
        armorPiercing: true,
        specials: [],
      });
    }
    if (tick % 60 === 0 && enemies.length > 0) {
      engine.vfx.addParticles(stormTower.x, stormTower.y, stormTower.color, 8);
    }
  }

  // ── Tesla: Zeus Protocol ───────────────────────────────────────────────────
  const zeusTower = pickStrongestTowerWith(towers, "zeusProtocol", "damage");
  if (
    zeusTower &&
    zeusTower.type === "tesla" &&
    zeusTower.cooldown <= 0 &&
    enemies.length > 0
  ) {
    const allTargets = enemies.filter(
      (e) =>
        !(e.stealth && !globalReveal) &&
        !(
          e.immunities.includes("tesla") &&
          !zeusTower.specials.includes("fullPierce")
        ),
    );
    if (allTargets.length > 0) {
      zeusTower.cooldown = Math.max(
        1,
        Math.round(zeusTower.fireRate * fireRateMult * modFireRateMult),
      );
      const dmg = zeusTower.damage * damageMult;
      for (const e of allTargets) {
        engine.combatSystem.damageEnemy(e, dmg, {
          towerType: "tesla",
          towerId: zeusTower.id,
          armorPiercing: true,
          specials: zeusTower.specials || [],
        });
        engine.vfx.addBolt(zeusTower.x, zeusTower.y, e.x, e.y, zeusTower.color);
      }
      engine.vfx.addParticles(zeusTower.x, zeusTower.y, zeusTower.color, 20);
    }
  }

  // ── Missile: Armageddon ────────────────────────────────────────────────────
  const armTower = pickStrongestTowerWith(towers, "armageddon", "damage");
  if (armTower && tick % 300 === 0 && enemies.length > 0) {
    const strikeDmg = armTower.damage * damageMult * 0.35;
    for (const e of enemies) {
      if (e.immunities.includes("missile")) continue;
      engine.combatSystem.damageEnemy(e, strikeDmg, {
        towerType: "missile",
        towerId: armTower.id,
        armorPiercing: false,
        splash: armTower.splash,
        specials: [],
      });
      engine.vfx.addParticles(e.x, e.y, armTower.projectileColor, 8);
    }
    engine.vfx.triggerShake(6, 8);
    engine.vfx.addFloatingText(
      armTower.x,
      armTower.y - 30,
      "💢 ARMAGEDDON!",
      "#f43f5e",
    );
  }

  // ── Vortex: Singularity Rex (one permanent hole) ───────────────────────────
  const rexTower = pickStrongestTowerWith(towers, "singularityRex", "range");
  const rexOwners = new Set(
    towers.filter((t) => t.specials?.includes("singularityRex")).map((t) => t.id),
  );
  engine.blackHoles = (engine.blackHoles || []).filter(
    (bh) => !bh._ownerId || !rexOwners.has(bh._ownerId) || bh._ownerId === rexTower?.id,
  );
  if (rexTower) {
    if (!engine.blackHoles.some((bh) => bh._ownerId === rexTower.id)) {
      engine.blackHoles.push({
        x: rexTower.x,
        y: rexTower.y,
        timer: Infinity,
        radius: rexTower.range * 1.5,
        strength: 8,
        _ownerId: rexTower.id,
        _permanent: true,
      });
    }
    const bh = engine.blackHoles.find((b) => b._ownerId === rexTower.id);
    if (bh) {
      bh.x = rexTower.x;
      bh.y = rexTower.y;
      bh.timer = 999999;
      bh.radius = rexTower.range * 1.5;
    }
    if (tick % 20 === 0) {
      const rexDmg = 130 * damageMult;
      for (const e of enemies) {
        const d = Math.sqrt((e.x - rexTower.x) ** 2 + (e.y - rexTower.y) ** 2);
        if (d <= rexTower.range * 1.5) {
          engine.combatSystem.damageEnemy(e, rexDmg, {
            towerType: "vortex",
            towerId: rexTower.id,
            armorPiercing: true,
            specials: [],
          });
        }
      }
    }
  }

  // ── Vortex: Reality Fold ───────────────────────────────────────────────────
  const foldTower = pickStrongestTowerWith(towers, "realityFold", "range");
  if (foldTower && tick % 360 === 0 && enemies.length > 0) {
    let teleported = 0;
    const now = engine.tick;
    for (const e of enemies) {
      const d = Math.sqrt((e.x - foldTower.x) ** 2 + (e.y - foldTower.y) ** 2);
      if (d <= foldTower.range) {
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
        foldTower.x,
        foldTower.y - 30,
        `🌌 REALITY FOLD! ×${teleported}`,
        "#818cf8",
      );
      engine.vfx.triggerShake(5, 8);
    }
  }
}
