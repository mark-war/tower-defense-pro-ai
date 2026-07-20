/**
 * GoldMarket.js
 * Late-game gold sink system. Provides meaningful, exciting ways to spend
 * excess gold that create visible, dramatic effects on gameplay.
 *
 * Markets:
 *  - Overcharge:  Pay to supercharge a specific tower for the next wave (3× dmg, 0.4× cooldown).
 *  - War Bond:    Gamble gold before a wave; 3× payout if zero leaks occur.
 *  - Mercenary:   Spawn a powerful temporary combat unit that attacks enemies on the path.
 *  - Dark Pact:   Convert gold directly into score + lives (diminishing returns).
 *  - Arms Deal:   Temporarily grant all towers +1 chain target and +25% range for one wave.
 */

export const GOLD_MARKET_ITEMS = {
  overcharge: {
    id: "overcharge",
    name: "Tower Overcharge",
    icon: "⚡",
    desc: "Select one tower — it deals 3× damage and fires 2.5× faster for the next wave.",
    baseCost: 200,
    costScaling: 0.04, // × wave
    color: "#fbbf24",
    requiresTarget: true, // user must click a tower after buying
    repeatable: true,
    stateGate: "idle", // only buy between waves
  },
  war_bond: {
    id: "war_bond",
    name: "War Bond",
    icon: "🏦",
    desc: "Bet gold. If next wave has ZERO leaks, you get 3× back. One active bond at a time.",
    baseCost: 150,
    costScaling: 0.03,
    color: "#4ade80",
    requiresTarget: false,
    repeatable: false, // only one bond active at a time
    stateGate: "idle",
  },
  mercenary: {
    id: "mercenary",
    name: "Mercenary Unit",
    icon: "🗡️",
    desc: "Deploys a powerful combat unit mid-wave. Attacks nearby enemies for 20 seconds.",
    baseCost: 300,
    costScaling: 0.05,
    color: "#f43f5e",
    requiresTarget: false,
    repeatable: true,
    stateGate: "wave", // only buy during an active wave
  },
  dark_pact: {
    id: "dark_pact",
    name: "Dark Pact",
    icon: "💀",
    desc: "Sacrifice 500g for score + lives. Returns: 100%→80%→60%→40%→20%. Max 5 uses per run.",
    baseCost: 500,
    costScaling: 0,
    color: "#818cf8",
    requiresTarget: false,
    repeatable: true,
    stateGate: null,
  },
  arms_deal: {
    id: "arms_deal",
    name: "Arms Deal",
    icon: "🔫",
    desc: "All towers gain +1 chain target, +25% range, +15% damage for the NEXT wave only.",
    baseCost: 400,
    costScaling: 0.05,
    color: "#e879f9",
    requiresTarget: false,
    repeatable: true,
    stateGate: "idle",
  },
};

export class GoldMarket {
  constructor(engine) {
    this.engine = engine;
    this.warBond = null; // { bet, multiplier } or null
    this.darkPactUses = 0;
    this.pendingOvercharge = false; // waiting for user to click tower
    this.mercenaries = []; // active merc units
    this.armsDealActive = false; // consumed at wave start
  }

  getItemCost(itemId) {
    const item = GOLD_MARKET_ITEMS[itemId];
    if (!item) return Infinity;
    return Math.floor(
      item.baseCost * (1 + this.engine.wave * item.costScaling),
    );
  }

  canBuy(itemId) {
    const engine = this.engine;
    const item = GOLD_MARKET_ITEMS[itemId];
    if (!item) return { ok: false, reason: "Unknown item" };

    const cost = this.getItemCost(itemId);
    if (engine.gold < cost) return { ok: false, reason: `Need ${cost}g` };

    if (itemId === "war_bond" && this.warBond)
      return { ok: false, reason: "Bond already active" };

    if (itemId === "dark_pact" && this.darkPactUses >= 5)
      return { ok: false, reason: "Pact maxed (5 uses per run)" };

    if (itemId === "mercenary" && this.mercenaries.length >= 2)
      return { ok: false, reason: "Max 2 mercenaries active" };

    if (item.stateGate === "idle" && engine.state !== "idle")
      return { ok: false, reason: "Buy between waves only" };

    if (item.stateGate === "wave" && engine.state !== "wave")
      return { ok: false, reason: "Buy during an active wave" };

    return { ok: true, cost };
  }

  buy(itemId) {
    const engine = this.engine;
    const check = this.canBuy(itemId);
    if (!check.ok) {
      engine.vfx.addFloatingText(
        engine.canvas.width / 2,
        engine.canvas.height / 2,
        check.reason,
        "#ef4444",
      );
      return false;
    }

    engine.gold -= check.cost;

    switch (itemId) {
      case "overcharge":
        this.pendingOvercharge = true;
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 20,
          "⚡ Click a tower to OVERCHARGE it!",
          "#fbbf24",
        );
        break;

      case "war_bond":
        this.warBond = { bet: check.cost, multiplier: 3 };
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 20,
          `🏦 War Bond placed! ${check.cost}g → ${check.cost * 3}g if zero leaks!`,
          "#4ade80",
        );
        break;

      case "mercenary":
        this._spawnMercenary();
        break;

      case "dark_pact": {
        this.darkPactUses++;
        // Diminishing returns: use 1=100%, 2=80%, 3=60%, 4=40%, 5=20%
        const diminish = Math.max(0.2, 1 - (this.darkPactUses - 1) * 0.2);
        const scoreGain = Math.floor(3000 * diminish);
        const livesGain = this.darkPactUses <= 3 ? 2 : 1;
        engine.score += scoreGain;
        engine.lives = Math.min(
          engine.levelConfig.startLives,
          engine.lives + livesGain,
        );
        const remaining = 5 - this.darkPactUses;
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 20,
          `💀 DARK PACT! +${scoreGain} score, +${livesGain} ❤️ (${remaining} uses left)`,
          "#818cf8",
        );
        engine.vfx.addParticles(
          engine.canvas.width / 2,
          engine.canvas.height / 2,
          "#818cf8",
          40,
        );
        engine.vfx.triggerShake(5, 8);
        break;
      }

      case "arms_deal":
        this.armsDealActive = true;
        console.log(
          `%c[ArmsDeal] BOUGHT — wave ${engine.wave}, tick ${engine.tick}`,
          "color:#e879f9",
        );
        this._applyArmsDeal();
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 20,
          "🔫 ARMS DEAL! All towers buffed for next wave!",
          "#e879f9",
        );
        engine.vfx.addParticles(
          engine.canvas.width / 2,
          engine.canvas.height / 2,
          "#e879f9",
          35,
        );
        break;
    }

    engine._emitState();
    return true;
  }

  /** Called when user clicks a tower while pendingOvercharge is true. */
  applyOverchargeToTower(tower) {
    if (!this.pendingOvercharge) return false;
    this.pendingOvercharge = false;

    // Multiplier-based so it composes safely with fortify/XP passives
    // and is cleanly reversible at wave-end by dividing back out.
    if (!tower._overchargeActive) {
      tower._overchargeActive = true;
      tower.damage *= 3;
      tower.fireRate = Math.max(1, Math.round(tower.fireRate * 0.4));
    }

    this.engine.vfx.addFloatingText(
      tower.x,
      tower.y - 24,
      "⚡ OVERCHARGED!",
      "#fbbf24",
    );
    this.engine.vfx.addParticles(tower.x, tower.y, "#fbbf24", 30);
    this.engine.vfx.triggerShake(4, 5);
    this.engine._emitState();
    return true;
  }

  _applyArmsDeal() {
    const engine = this.engine;
    for (const tower of engine.towers) {
      if (tower._armsDealBuff) continue; // already applied — guard against double-apply

      tower._armsDealBuff = true;

      // tower._armsDealOrigChain = tower.chainTargets;
      // tower._armsDealOrigRange = tower.range;
      // tower._armsDealOrigDamage = tower.damage;
      tower.chainTargets = (tower.chainTargets || 0) + 1;
      // tower.range *= 1.25;
      // tower.damage *= 1.15;
      console.log(`[ArmsDeal] applied → tower ${tower.id} (${tower.type})`);
    }
  }

  _spawnMercenary() {
    const engine = this.engine;
    const path = engine.path;

    // Spawn near the current enemy cluster (median pathIndex of live enemies)
    let startIdx;
    if (engine.enemies.length > 0) {
      startIdx = Math.max(...engine.enemies.map((e) => e.pathIndex || 0));
      startIdx = Math.max(0, Math.min(path.length - 1, startIdx));
    } else {
      startIdx = Math.floor(path.length * 0.2);
    }

    const spawnPt = path[startIdx] || path[0];
    const merc = {
      id: Date.now() + Math.random(),
      x: spawnPt.x,
      y: spawnPt.y,
      pathIndex: startIdx,
      // Walk backwards (decreasing pathIndex toward 0)
      direction: 1,
      speed: 1.4,
      damage: Math.max(8, engine.wave * 4),
      range: 120,
      attackRate: 45,
      attackCooldown: 0,
      hp: 999999, // effectively unkillable
      timer: 60 * 20, // 20 seconds
      color: "#f43f5e",
    };
    this.mercenaries.push(merc);
    engine.vfx.addFloatingText(
      merc.x,
      merc.y - 20,
      "🗡️ MERCENARY DEPLOYED!",
      "#f43f5e",
    );
    engine.vfx.addParticles(merc.x, merc.y, "#f43f5e", 20);
  }

  /** Called each tick during waves. */
  update() {
    const engine = this.engine;
    if (engine.state !== "wave") return;

    const LEASH_AHEAD = 8;

    for (let i = this.mercenaries.length - 1; i >= 0; i--) {
      const merc = this.mercenaries[i];
      merc.timer--;

      if (merc.timer <= 0) {
        engine.vfx.addFloatingText(
          merc.x,
          merc.y - 20,
          "🗡️ Mercenary gone",
          "#6b7280",
        );
        this.mercenaries.splice(i, 1);
        continue;
      }

      const path = engine.path;
      if (!path || path.length === 0) {
        console.warn(
          "[GoldMarket] mercenary update: engine.path missing/empty",
        );
        continue;
      }

      // ── Leash logic: track the front of the wave on the SAME path the merc
      // walks (engine.path). Dual-front enemies use _altPath and aren't
      // comparable by pathIndex, so exclude them; fall back to all enemies
      // only if none exist on the main path.
      let packEnemies = engine.enemies.filter((e) => !e._altPath);
      if (packEnemies.length === 0) packEnemies = engine.enemies;

      if (packEnemies.length > 0) {
        const packFrontIdx = Math.max(
          ...packEnemies.map((e) => e.pathIndex || 0),
        );
        const avgSpeed =
          packEnemies.reduce((s, e) => s + (e.baseSpeed || e.speed || 0), 0) /
          packEnemies.length;

        merc.speed = Math.max(0.4, avgSpeed); // pace with the pack, no artificial lead

        if (
          merc.direction === 1 &&
          merc.pathIndex - packFrontIdx >= LEASH_AHEAD
        ) {
          merc.direction = -1; // too far ahead — fall back toward the wave
        } else if (merc.direction === -1 && merc.pathIndex <= packFrontIdx) {
          merc.direction = 1; // caught up — resume escorting forward
        }
      } else {
        merc.speed = 1.4; // no living enemies at all — idle pace
      }

      const nextIdx = merc.pathIndex + merc.direction;

      // Reverse direction when reaching either end of the path.
      if (nextIdx < 0 || nextIdx >= path.length) {
        merc.direction *= -1;
      } else {
        const tgt = path[nextIdx];
        const dx = tgt.x - merc.x;
        const dy = tgt.y - merc.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= merc.speed) {
          merc.pathIndex = nextIdx;
          merc.x = tgt.x;
          merc.y = tgt.y;
        } else {
          merc.x += (dx / dist) * merc.speed;
          merc.y += (dy / dist) * merc.speed;
        }
      }

      // Attack nearby enemies
      if (merc.attackCooldown > 0) {
        merc.attackCooldown--;
        continue;
      }

      const nearby = engine.enemies.filter((e) => {
        const dx = e.x - merc.x,
          dy = e.y - merc.y;
        return Math.sqrt(dx * dx + dy * dy) <= merc.range;
      });

      // Finisher targeting: lowest current HP first, not closest.
      // This means the merc needs towers to have already softened enemies —
      // it can't out-damage a full-health wave on its own within its duration.
      nearby.sort((a, b) => a.hp - b.hp);

      if (nearby.length > 0) {
        merc.attackCooldown = merc.attackRate;
        const target = nearby[0]; // single target only

        engine.combatSystem.damageEnemy(target, merc.damage, {
          towerType: "basic",
          towerId: null,
          armorPiercing: false, // respects armor like a real unit
          specials: [],
          rewardMult: 0.4,
        });

        engine.vfx.addDamageNumber(
          target.x,
          target.y - target.size - 4,
          merc.damage,
          "basic",
        );

        engine.vfx.addBolt(merc.x, merc.y, target.x, target.y, "#f43f5e");
        engine.vfx.addParticles(merc.x, merc.y, "#f43f5e", 4);
      }
    }
  }

  /** Called at wave-end. */
  onWaveClear(leakCount) {
    const engine = this.engine;
    console.log(
      `%c[WaveClear] wave ${engine.wave} ended — armsDealActive=${this.armsDealActive}, buffed towers=${engine.towers.filter((t) => t._armsDealBuff).length}`,
      "color:#4ade80; font-weight:bold",
    );
    // ── War bond payout/loss
    if (this.warBond) {
      if (leakCount === 0) {
        const payout = this.warBond.bet * this.warBond.multiplier;
        engine.gold += payout;
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 50,
          `🏦 WAR BOND PAID OUT! +${payout}g`,
          "#4ade80",
        );
        engine.vfx.addParticles(
          engine.canvas.width / 2,
          engine.canvas.height / 2,
          "#4ade80",
          50,
        );
        engine.vfx.triggerShake(4, 6);
      } else {
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 50,
          `🏦 War Bond lost — ${leakCount} leak${leakCount > 1 ? "s" : ""}`,
          "#ef4444",
        );
      }
      this.warBond = null;
    }

    // ── Overcharge: divide multiplier back out
    for (const tower of engine.towers) {
      if (tower._overchargeActive) {
        tower.damage /= 3;
        tower.fireRate = Math.max(1, Math.round(tower.fireRate / 0.4));
        delete tower._overchargeActive;
        engine.vfx.addFloatingText(
          tower.x,
          tower.y - 20,
          "⚡ Overcharge ended",
          "#94a3b8",
        );
      }
    }

    // ── Arms deal cleanup: only chainTargets was directly mutated.
    // Damage/range were runtime multipliers, auto-disabled by armsDealActive=false.
    for (const tower of engine.towers) {
      if (tower._armsDealBuff) {
        tower.chainTargets = Math.max(0, tower.chainTargets - 1);
        // tower.range /= 1.25;
        // tower.damage /= 1.15;
        delete tower._armsDealBuff;
        console.log(`[ArmsDeal] reverted ← tower ${tower.id} (${tower.type})`);
      }
    }
    this.armsDealActive = false;
    console.log(`[ArmsDeal] armsDealActive reset to false`);

    // ── Clear mercenaries
    this.mercenaries.length = 0;

    // ── Cancel any pending overcharge the player didn't use
    this.pendingOvercharge = false;
  }

  /** Serialise for save system. */
  getSaveData() {
    return {
      darkPactUses: this.darkPactUses,
      warBond: this.warBond,
    };
  }

  /** Restore from save. */
  loadSaveData(data) {
    if (!data) return;
    this.darkPactUses = data.darkPactUses ?? 0;
    this.warBond = data.warBond ?? null;
    // Never restore mid-wave state (mercs, pendingOvercharge, armsDeal)
    this.mercenaries = [];
    this.pendingOvercharge = false;
    this.armsDealActive = false;
  }

  getState() {
    return {
      warBond: this.warBond ? { ...this.warBond } : null,
      pendingOvercharge: this.pendingOvercharge,
      darkPactUses: this.darkPactUses,
      darkPactRemaining: 5 - this.darkPactUses,
      mercenaryCount: this.mercenaries.length,
      armsDealActive: this.armsDealActive,
      mercenaries: this.mercenaries.map((m) => ({
        id: m.id,
        x: m.x,
        y: m.y,
        timer: m.timer,
        damage: m.damage,
      })),
    };
  }
}
