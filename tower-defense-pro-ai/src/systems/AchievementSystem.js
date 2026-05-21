/**
 * AchievementSystem.js
 * Tracks and unlocks run-scoped achievements. Emits state once per unlock
 * so the UI can show a toast. The signal auto-clears after one frame.
 */

import { ACHIEVEMENTS } from "../gameConstants.js";

export class AchievementSystem {
  constructor(engine) {
    this.engine = engine;
  }

  /** Unlock an achievement by id (no-op if already unlocked or id unknown). */
  unlock(id) {
    const engine = this.engine;
    if (!ACHIEVEMENTS[id]) return;
    if (engine._runAchievements.includes(id)) return;

    engine._runAchievements.push(id);
    engine._newAchievementId = id;
    engine._emitState();

    // Clear toast signal after one beat
    setTimeout(() => {
      engine._newAchievementId = null;
    }, 100);
  }

  /** Run after each wave to check milestone achievements. */
  checkWaveAchievements() {
    const { wave, gold, activeModifier, runStats, activeSynergies } =
      this.engine;

    if (wave >= 1) this.unlock("first_wave");
    if (wave >= 25) this.unlock("wave_25");
    if (wave >= 50) this.unlock("wave_50");

    if (activeModifier || runStats.modifiersFaced.length > 0)
      this.unlock("modifier_survive");

    if (gold >= 2000) this.unlock("gold_hoarder");

    if (activeSynergies.length >= 3) this.unlock("synergist");
  }
}
