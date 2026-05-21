/**
 * xpHelpers.js
 * Pure functions for XP calculations — no side effects, easily unit-testable.
 */

const KILL_XP = {
  basic: 1.6, sniper: 2.6, cannon: 1.1, laser: 0.89,
  freeze: 0.4, tesla: 1.4, inferno: 1.2, vortex: 0.3,
};

const BOSS_KILL_XP = {
  basic: 12, sniper: 14, cannon: 11, laser: 8,
  freeze: 6,  tesla: 10,  inferno: 11, vortex: 5,
};

const ASSIST_XP = {
  basic: 0.4, sniper: 0.6, cannon: 0.3, laser: 0.3,
  freeze: 0.5, tesla: 0.4, inferno: 0.3, vortex: 0.2,
};

const BOSS_ASSIST_XP = {
  basic: 5, sniper: 5, cannon: 4, laser: 4,
  freeze: 6, tesla: 5, inferno: 4, vortex: 3,
};

export function calcKillXp(tower, enemy) {
  if (enemy.isBoss) return BOSS_KILL_XP[tower.type] ?? 10;
  return KILL_XP[tower.type] ?? 1.0;
}

export function calcAssistXp(tower, enemy) {
  if (enemy.isBoss) return BOSS_ASSIST_XP[tower.type] ?? 4;
  return ASSIST_XP[tower.type] ?? 0.3;
}

export function calcEffectiveXpMult(isEndless, xpMult, wave) {
  if (!isEndless) return xpMult;
  return xpMult * Math.max(0.5, 1 - (wave - 1) * 0.005);
}