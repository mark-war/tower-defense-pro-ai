/**
 * AbilitySystem.js
 * Handles player-triggered abilities (Airstrike, EMP, Reinforce).
 * Each ability is self-contained: it reads engine state, applies effects,
 * sets its own cooldown, and returns whether it fired.
 */

import { ABILITIES } from "../gameConstants.js";

export class AbilitySystem {
  constructor(engine) {
    this.engine = engine;
  }

  /** Attempt to fire an ability. Returns true if it fired. */
  trigger(abilityKey) {
    const engine = this.engine;
    const ab = engine.abilities[abilityKey];
    if (!ab || ab.cooldownLeft > 0 || engine.state !== "wave") return false;

    switch (abilityKey) {
      case "airstrike":
        this._fireAirstrike(ab);
        break;
      case "emp":
        this._fireEMP(ab);
        break;
      case "reinforce":
        this._fireReinforce(ab);
        break;
    }

    engine.audio?.playAbilityFire(abilityKey);
    ab.cooldownLeft = ab.cooldown;
    engine.vfx.addParticles(
      engine.canvas.width / 2,
      engine.canvas.height / 2,
      ab.color,
      30,
    );
    engine._emitState();
    return true;
  }

  /** Tick cooldowns. Called by TowerSystem.update() each frame. */
  tickCooldowns() {
    for (const ab of Object.values(this.engine.abilities)) {
      if (ab.cooldownLeft > 0) ab.cooldownLeft--;
    }
  }

  // ── Private ability implementations ────────────────────────────────────────

  _fireAirstrike(ab) {
    const engine = this.engine;
    let hits = 0;
    for (let i = engine.enemies.length - 1; i >= 0; i--) {
      engine.combatSystem.damageEnemy(engine.enemies[i], 500, {
        towerType: null,
        towerId: null,
        armorPiercing: true,
      });
      hits++;
    }
    engine.vfx.addFloatingText(
      engine.canvas.width / 2,
      engine.canvas.height / 2,
      `✈️ AIRSTRIKE! ${hits} hit`,
      "#ef4444",
    );
  }

  _fireEMP(ab) {
    const engine = this.engine;
    for (const e of engine.enemies) {
      e.slowTimer = 180;
      if (!e.isBoss) {
        e.stunTimer = 180;
      } else if (!e.stunImmunity) {
        e.stunTimer = Math.max(e.stunTimer, 90);
      }
    }
    engine.audio?.playEMPShockwave();
    engine.vfx.addFloatingText(
      engine.canvas.width / 2,
      engine.canvas.height / 2,
      "🌐 EMP — All Stunned!",
      "#fbbf24",
    );
  }

  _fireReinforce(ab) {
    const engine = this.engine;
    engine.globalBuff = {
      fireRateMult: 0.5,
      damageMult: 1.5,
      timer: 480,
      label: "🏰 Reinforce — 2× Fire!",
    };
    engine.vfx.addFloatingText(
      engine.canvas.width / 2,
      engine.canvas.height / 2,
      "🏰 REINFORCE!",
      "#4ade80",
    );
  }
}
