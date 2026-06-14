/**
 * skillRegistry.js — upgrade visual class + global stacking rules.
 *
 * visual: "aura"     → persistent ring/field on tower (drawTowerSkillAuras)
 *         "projectile" → on-shot / on-hit (projectiles, combat, VFX)
 *         "stat"      → statDelta / flags only (armorPiercing, splash30, …)
 *         "world"     → screen-wide entities (black holes, burn zones)
 *
 * stack:  "perTower"  → each upgraded tower runs its own instance
 *         "strongest" → only the best tower (by stat) applies once per tick
 *         "presence"  → boolean global; does not stack with duplicates
 */

export const SKILL_STACK_RULES = {
  // ── Global uniques (strongest tower wins) ─────────────────────────────────
  globalSlow: { stack: "strongest", stat: "range" },
  heatDeath: { stack: "strongest", stat: "damage" },
  infernalRealm: { stack: "strongest", stat: "burnDamage" },
  stormGod: { stack: "strongest", stat: "damage" },
  solarGod: { stack: "strongest", stat: "damage" },
  omniscience: { stack: "strongest", stat: "damage" },
  zeusProtocol: { stack: "strongest", stat: "damage" },
  singularityRex: { stack: "strongest", stat: "range" },
  realityFold: { stack: "strongest", stat: "range" },
  voidRings: { stack: "strongest", stat: "damage" },
  armageddon: { stack: "strongest", stat: "damage" },

  // ── Presence globals (on/off, no magnitude stack) ─────────────────────────
  allReveal: { stack: "presence" },
  iceAge: { stack: "presence" },
  armorSlow: { stack: "presence" },
  deathIgnite: { stack: "presence", stat: "burnDamage" },
  cryoStorm: { stack: "presence", stat: "damage" },

  // Default for everything else
  _default: { stack: "perTower" },
};

/** @type {Record<string, Record<string, Record<string, { visual: string, special?: string|string[] }>>>} */
export const TOWER_SKILL_VISUAL_MAP = {
  basic: {
    skill5: {
      A: { visual: "stat" },
      B: { visual: "stat" },
    },
    skill10: {
      A: { visual: "stat", special: "armorPiercing" },
      B: { visual: "projectile", special: "splash30" },
    },
    legendary50: {
      A: { visual: "projectile", special: "bulletChain" },
      B: { visual: "stat", special: "armorPiercing" },
    },
    legendary100: {
      A: { visual: "world", special: "blackHole" },
      B: { visual: "stat", special: "fullPierce" },
    },
    ascension200: {
      A: { visual: "projectile", special: "extinctionProtocol" },
      B: { visual: "aura", special: "voidRings" },
    },
  },
  sniper: {
    skill5: {
      A: { visual: "stat" },
      B: { visual: "stat", special: "armorPiercing" },
    },
    skill10: {
      A: { visual: "projectile", special: "pierceThrough" },
      B: { visual: "projectile", special: "antiHeal" },
    },
    legendary50: {
      A: { visual: "presence", special: "allReveal" },
      B: { visual: "projectile", special: "twinShot" },
    },
    legendary100: {
      A: { visual: "projectile", special: "voidBurst" },
      B: { visual: "projectile", special: "timeStop" },
    },
    ascension200: {
      A: { visual: "projectile", special: "executionShot" },
      B: { visual: "aura", special: "omniscience" },
    },
  },
  cannon: {
    skill5: { A: { visual: "stat" }, B: { visual: "stat" } },
    skill10: {
      A: { visual: "projectile", special: "burnOnSplash" },
      B: { visual: "projectile", special: "clusterShot" },
    },
    legendary50: {
      A: { visual: "projectile", special: "quakeStun" },
      B: { visual: "stat", special: "armorPiercing" },
    },
    legendary100: {
      A: { visual: "projectile", special: "nuke" },
      B: { visual: "aura", special: "meteorStorm" },
    },
    ascension200: {
      A: { visual: "world", special: "planetCracker" },
      B: { visual: "aura", special: "tectonicPull" },
    },
  },
  laser: {
    skill5: { A: { visual: "stat" }, B: { visual: "stat" } },
    skill10: {
      A: { visual: "projectile", special: "beamAll" },
      B: { visual: "projectile", special: "stunOnHit" },
    },
    legendary50: {
      A: { visual: "projectile", special: "solarBlind" },
      B: { visual: "projectile", special: "prismSplit" },
    },
    legendary100: {
      A: { visual: "aura", special: "omegaBeam" },
      B: { visual: "stat", special: "trueDamage" },
    },
    ascension200: {
      A: { visual: "aura", special: "solarGod" },
      B: { visual: "projectile", special: "mirrorWeb" },
    },
  },
  freeze: {
    skill5: {
      A: { visual: "stat" },
      B: { visual: "projectile", special: "areaFreeze" },
    },
    skill10: {
      A: { visual: "projectile", special: "fullFreeze" },
      B: { visual: "projectile", special: "shatterBuff" },
    },
    legendary50: {
      A: { visual: "presence", special: "armorSlow" },
      B: { visual: "projectile", special: "instantFreeze" },
    },
    legendary100: {
      A: { visual: "presence", special: "iceAge" },
      B: { visual: "aura", special: "globalSlow" },
    },
    ascension200: {
      A: { visual: "aura", special: "heatDeath" },
      B: { visual: "presence", special: "cryoStorm" },
    },
  },
  tesla: {
    skill5: { A: { visual: "stat" }, B: { visual: "stat" } },
    skill10: {
      A: { visual: "stat" },
      B: { visual: "projectile", special: "chainStun" },
    },
    legendary50: {
      A: { visual: "projectile", special: ["immunityBreak", "shieldPierce"] },
      B: { visual: "aura", special: "ballLightning" },
    },
    legendary100: {
      A: { visual: "aura", special: "arcPulse" },
      B: { visual: "stat", special: "fullPierce" },
    },
    ascension200: {
      A: { visual: "aura", special: "zeusProtocol" },
      B: { visual: "aura", special: "stormGod" },
    },
  },
  inferno: {
    skill5: {
      A: { visual: "stat" },
      B: { visual: "aura", special: ["areaIgnite", "burnAura"] },
    },
    skill10: {
      A: { visual: "projectile", special: "burnStack" },
      B: { visual: "projectile", special: "armorMelt" },
    },
    legendary50: {
      A: { visual: "presence", special: "deathIgnite" },
      B: { visual: "projectile", special: "execute" },
    },
    legendary100: {
      A: { visual: "projectile", special: "supernova" },
      B: { visual: "aura", special: "hellgate" },
    },
    ascension200: {
      A: { visual: "projectile", special: "solarCore" },
      B: { visual: "aura", special: "infernalRealm" },
    },
  },
  vortex: {
    skill5: {
      A: { visual: "stat" },
      B: { visual: "aura", special: "cyclone" },
    },
    skill10: {
      A: { visual: "projectile", special: "teleportBack" },
      B: { visual: "stat" },
    },
    legendary50: {
      A: { visual: "aura", special: "gravityLock" },
      B: { visual: "aura", special: "darkStarDebuff" },
    },
    legendary100: {
      A: { visual: "aura", special: "bulwarkField" },
      B: { visual: "projectile", special: ["omegaRift", "bigCrunch"] },
    },
    ascension200: {
      A: { visual: "world", special: "singularityRex" },
      B: { visual: "aura", special: "realityFold" },
    },
  },
  missile: {
    skill5: { A: { visual: "stat" }, B: { visual: "projectile", special: "salvo" } },
    skill10: {
      A: { visual: "projectile", special: "clusterWarhead" },
      B: { visual: "projectile", special: "seekerChain" },
    },
    legendary50: {
      A: { visual: "projectile", special: "nuclearPayload" },
      B: { visual: "projectile", special: "smartSwarm" },
    },
    legendary100: {
      A: { visual: "aura", special: "armageddon" },
      B: { visual: "stat", special: "fullPierce" },
    },
    ascension200: {
      A: { visual: "projectile", special: "doomsdayProtocol" },
      B: { visual: "projectile", special: "hiveMind" },
    },
  },
};

export function getStackRule(special) {
  return SKILL_STACK_RULES[special] || SKILL_STACK_RULES._default;
}

/** Towers with `special`; for strongest/presence picks the authoritative one. */
export function pickStrongestTowerWith(towers, special, stat = "damage") {
  const matches = towers.filter((t) => t.specials?.includes(special));
  if (!matches.length) return null;
  return matches.sort((a, b) => (b[stat] || 0) - (a[stat] || 0))[0];
}

export function isAuthoritativeTower(towers, tower, special, stat = "damage") {
  const rule = getStackRule(special);
  if (rule.stack === "perTower") return true;
  const best = pickStrongestTowerWith(towers, special, rule.stat || stat);
  return best?.id === tower.id;
}

export const STACK_HINTS = {
  strongest: "Map-wide — does not stack (strongest tower applies)",
  presence: "Global — duplicate towers do not stack",
};

export function normalizeSpecials(special) {
  if (!special) return [];
  return Array.isArray(special) ? special : [special];
}

/** Human-readable stack / scope hints for upgrade tooltips. */
export function getSkillStackHints(skillDef) {
  const hints = [];
  const seen = new Set();
  for (const sp of normalizeSpecials(skillDef?.special)) {
    const rule = getStackRule(sp);
    if (rule.stack === "perTower") continue;
    const text = STACK_HINTS[rule.stack];
    if (text && !seen.has(text)) {
      seen.add(text);
      hints.push(text);
    }
  }
  return hints;
}

/** Tags shown under skill description (special id + stack mode). */
export function formatSpecialTags(skillDef) {
  return normalizeSpecials(skillDef?.special).map((sp) => {
    const rule = getStackRule(sp);
    if (rule.stack === "perTower") return sp;
    return `${sp} [${rule.stack}]`;
  });
}
