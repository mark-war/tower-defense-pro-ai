/**
 * SynergySystem.js
 * Detects active tower synergy pairs and exposes the result for
 * other systems to query. Rebuilt whenever the tower roster changes.
 */

import { SYNERGIES } from "../gameConstants.js";

export class SynergySystem {
  constructor(engine) {
    this.engine = engine;
  }

  /** Re-evaluate synergies. Call after any tower is placed or sold. */
  check() {
    const { towers } = this.engine;
    const active = [];

    for (const [key, syn] of Object.entries(SYNERGIES)) {
      let hasA = false,
        hasB = false;
      for (const t of towers) {
        if (t.type === syn.towers[0]) hasA = true;
        if (t.type === syn.towers[1]) hasB = true;
      }
      if (hasA && hasB) active.push({ key, ...syn });
    }

    this.engine.activeSynergies = active;
  }

  /** Convenience – check if a named synergy key is currently active. */
  has(key) {
    return this.engine.activeSynergies.some((s) => s.key === key);
  }
}
