/**
 * endlessMechanics.js — milestone scaling for Endless Siege (waves 50/100/200+).
 * Values are applied in WaveAI (spawn mults) and EnemySystem (armor, etc.).
 */

import { ENDLESS_CONFIG } from "../gameConstants.js";

/** @typedef {{
 *   hpMult: number,
 *   speedMult: number,
 *   armorBonus: number,
 *   bossHpMult: number,
 *   doubleBoss: boolean,
 *   forceStealth: boolean,
 *   addJuggernaut: boolean,
 *   addChronoRaider: boolean,
 *   evolutionKillThreshold: number|null,
 *   milestoneLabel: string|null,
 *   signatureBoss: string|null,
 * }} EndlessWaveMods */

/**
 * @param {number} waveNumber
 * @returns {EndlessWaveMods}
 */
export function getEndlessWaveModifiers(waveNumber) {
  const mods = {
    hpMult: 1,
    speedMult: 1,
    armorBonus: 0,
    bossHpMult: 1,
    doubleBoss: false,
    forceStealth: false,
    addJuggernaut: false,
    addChronoRaider: false,
    evolutionKillThreshold: null,
    milestoneLabel: null,
    signatureBoss: null,
  };

  if (waveNumber >= 10) mods.armorBonus += 0.2;
  if (waveNumber >= 20) mods.speedMult *= 1.15;
  if (waveNumber >= 40) mods.forceStealth = true;
  if (waveNumber >= 50) {
    mods.bossHpMult *= 2;
    mods.doubleBoss = true;
    mods.milestoneLabel = ENDLESS_CONFIG.mechanics[50]?.label || "Titan Protocol";
  }
  if (waveNumber >= 75) mods.addJuggernaut = true;
  if (waveNumber >= 100) {
    mods.hpMult *= 1.5;
    mods.speedMult *= 1.5;
    mods.armorBonus += 0.1;
    mods.milestoneLabel = ENDLESS_CONFIG.mechanics[100]?.label || "Apex Tide";
  }
  if (waveNumber >= 150) {
    mods.bossHpMult *= 1.75;
    mods.addChronoRaider = true;
    mods.milestoneLabel = ENDLESS_CONFIG.mechanics[150]?.label || "Void Storm";
  }
  if (waveNumber >= 200) {
    mods.hpMult *= 1.65;
    mods.milestoneLabel = ENDLESS_CONFIG.mechanics[200]?.label || "God Tier";
  }
  if (waveNumber >= 300) {
    mods.evolutionKillThreshold = 5;
    mods.milestoneLabel = ENDLESS_CONFIG.mechanics[300]?.label || "Singularity";
  }
  if (waveNumber >= 500 && waveNumber % 3 === 0) {
    mods.doubleBoss = true;
    mods.milestoneLabel = ENDLESS_CONFIG.mechanics[500]?.label || "Extinction Event";
  }

  // Signature boss beats — distinct feel at key legendary unlock waves
  if (waveNumber === 50) mods.signatureBoss = "boss_titan";
  if (waveNumber === 100) mods.signatureBoss = "boss_voidreaper";
  if (waveNumber === 200) mods.signatureBoss = "boss_titan";

  return mods;
}
