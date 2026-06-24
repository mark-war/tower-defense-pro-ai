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
  },
  mercenary: {
    id: "mercenary",
    name: "Mercenary Unit",
    icon: "🗡️",
    desc: "Deploys a powerful combat unit that walks the path and attacks nearby enemies for 20 seconds.",
    baseCost: 300,
    costScaling: 0.05,
    color: "#f43f5e",
    requiresTarget: false,
    repeatable: true,
  },
  dark_pact: {
    id: "dark_pact",
    name: "Dark Pact",
    icon: "💀",
    desc: "Sacrifice 500g for 3000 score + 2 lives. Diminishing returns after 3 uses.",
    baseCost: 500,
    costScaling: 0,
    color: "#818cf8",
    requiresTarget: false,
    repeatable: true,
  },
  arms_deal: {
    id: "arms_deal",
    name: "Arms Deal",
    icon: "🔫",
    desc: "All towers gain +1 chain target, +25% range, and +15% damage for next wave.",
    baseCost: 400,
    costScaling: 0.05,
    color: "#e879f9",
    requiresTarget: false,
    repeatable: true,
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
      return { ok: false, reason: "Pact maxed (5 uses)" };

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
        const diminish = Math.max(0.2, 1 - (this.darkPactUses - 1) * 0.2);
        const scoreGain = Math.floor(3000 * diminish);
        const livesGain = this.darkPactUses <= 3 ? 2 : 1;
        engine.score += scoreGain;
        engine.lives = Math.min(
          engine.levelConfig.startLives,
          engine.lives + livesGain,
        );
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 20,
          `💀 DARK PACT! +${scoreGain} score, +${livesGain} ❤️`,
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
        // Apply immediately for the current or next wave prep
        this._applyArmsDeal();
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 20,
          "🔫 ARMS DEAL! All towers buffed for this wave!",
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

    tower._overchargeTimer = 60 * 20; // 20 seconds worth of ticks
    tower._overchargeOrigDamage = tower.damage;
    tower._overchargeOrigFireRate = tower.fireRate;
    tower.damage *= 3;
    tower.fireRate = Math.max(1, Math.round(tower.fireRate * 0.4));

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
      tower._armsDealBuff = true;
      tower._armsDealOrigChain = tower.chainTargets;
      tower._armsDealOrigRange = tower.range;
      tower._armsDealOrigDamage = tower.damage;
      tower.chainTargets = (tower.chainTargets || 0) + 1;
      tower.range *= 1.25;
      tower.damage *= 1.15;
    }
  }

  _spawnMercenary() {
    const engine = this.engine;
    const path = engine.path;
    // Start at ~20% of path
    const startIdx = Math.floor(path.length * 0.2);
    const merc = {
      id: Date.now() + Math.random(),
      x: path[startIdx].x,
      y: path[startIdx].y,
      pathIndex: startIdx,
      // Walk backwards (decreasing pathIndex toward 0)
      direction: -1,
      speed: 1.2,
      damage: 80 + engine.wave * 12,
      range: 70,
      attackRate: 30,
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

    // ── Tick overcharged towers
    for (const tower of engine.towers) {
      if (tower._overchargeTimer > 0) {
        tower._overchargeTimer--;
        if (tower._overchargeTimer === 0) {
          // Restore original stats
          tower.damage = tower._overchargeOrigDamage;
          tower.fireRate = tower._overchargeOrigFireRate;
          delete tower._overchargeOrigDamage;
          delete tower._overchargeOrigFireRate;
          engine.vfx.addFloatingText(
            tower.x,
            tower.y - 20,
            "⚡ Overcharge ended",
            "#94a3b8",
          );
        }
      }
    }

    // ── Tick mercenaries
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

      // Move along path
      const path = engine.path;
      const nextIdx = merc.pathIndex + merc.direction;
      if (nextIdx < 0 || nextIdx >= path.length) {
        merc.direction *= -1; // bounce
      } else {
        const tgt = path[nextIdx];
        const dx = tgt.x - merc.x,
          dy = tgt.y - merc.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < merc.speed) {
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
      } else {
        const nearby = engine.enemies
          .filter((e) => {
            const dx = e.x - merc.x,
              dy = e.y - merc.y;
            return Math.sqrt(dx * dx + dy * dy) <= merc.range;
          })
          .sort(
            (a, b) =>
              (a.x - merc.x) ** 2 +
              (a.y - merc.y) ** 2 -
              ((b.x - merc.x) ** 2 + (b.y - merc.y) ** 2),
          );

        if (nearby.length > 0) {
          merc.attackCooldown = merc.attackRate;
          // Hit up to 3 enemies
          for (let j = 0; j < Math.min(3, nearby.length); j++) {
            engine.combatSystem.damageEnemy(nearby[j], merc.damage, {
              towerType: "basic",
              towerId: null,
              armorPiercing: true,
              specials: [],
            });
            engine.vfx.addBolt(
              merc.x,
              merc.y,
              nearby[j].x,
              nearby[j].y,
              "#f43f5e",
            );
          }
          engine.vfx.addParticles(merc.x, merc.y, "#f43f5e", 5);
        }
      }
    }
  }

  /** Call at wave clear — check war bond. */
  onWaveClear(leakCount) {
    const engine = this.engine;

    // ── Check war bond
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
          `🏦 War Bond lost — ${leakCount} leaks`,
          "#ef4444",
        );
      }
      this.warBond = null;
    }

    // ── Remove arms deal buffs
    for (const tower of engine.towers) {
      if (tower._armsDealBuff) {
        tower.chainTargets = tower._armsDealOrigChain;
        tower.range = tower._armsDealOrigRange;
        tower.damage = tower._armsDealOrigDamage;
        delete tower._armsDealBuff;
        delete tower._armsDealOrigChain;
        delete tower._armsDealOrigRange;
        delete tower._armsDealOrigDamage;
      }
    }
    this.armsDealActive = false;

    // ── Clear lingering mercenaries
    this.mercenaries.length = 0;

    // ── Clear pending overcharge (if player forgot to click)
    this.pendingOvercharge = false;
  }

  getState() {
    return {
      warBond: this.warBond ? { ...this.warBond } : null,
      pendingOvercharge: this.pendingOvercharge,
      darkPactUses: this.darkPactUses,
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
