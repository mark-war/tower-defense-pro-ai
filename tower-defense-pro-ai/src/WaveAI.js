// ──────────────────────────────────────────────────────────────────────────────
//  WaveAI — learns across waves AND across game sessions (via persistent memory)
//  FIXES: endless progress (was always 0), boss plan key prefix, adaptation log
// ──────────────────────────────────────────────────────────────────────────────
import {
  ENEMY_TYPES,
  TOWER_TYPES,
  ADMIN_CONFIG,
  ENDLESS_CONFIG,
} from "./gameConstants.js";

const CFG = ADMIN_CONFIG.ai;
const LS_AI_MEMORY = "towerDefense_aiMemory";

function defaultGlobalMemory() {
  return {
    gamesPlayed: 0,
    towerUsageHistory: {},
    weaknessSuccessRate: {},
    strategyCounterHistory: {},
    playerTendencies: {},
    totalWavesSurvived: 0,
    bossEncounters: {},
  };
}

function loadGlobalMemory() {
  if (typeof localStorage === "undefined") {
    return defaultGlobalMemory();
  }

  try {
    const raw = JSON.parse(localStorage.getItem(LS_AI_MEMORY) || "null");
    return {
      ...defaultGlobalMemory(),
      ...(raw || {}),
    };
  } catch {
    return defaultGlobalMemory();
  }
}

function saveGlobalMemory() {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_AI_MEMORY, JSON.stringify(GLOBAL_MEMORY));
}

let GLOBAL_MEMORY = loadGlobalMemory();

export function getGlobalMemory() {
  return GLOBAL_MEMORY;
}

export class WaveAI {
  constructor(levelConfig) {
    this.levelConfig = levelConfig;
    this.bossWaves = levelConfig?.bossWaves || {};

    this.playerProfile = {
      towerCounts: {},
      towerPositions: [],
      killsByTowerType: {},
      leaksByWave: [],
      wavesSurvived: 0,
      totalGoldSpent: 0,
      preferredStrategy: null,
      weaknesses: [],
      towerSpread: 1,
      lastWaveReport: null,
      lastCounterplay: null,
    };

    this.waveHistory = [];
    this.adaptationLog = [];
    this.currentWave = 0;
    this.exploitAttempts = {};

    this._applyGlobalMemory();
  }

  _applyGlobalMemory() {
    const decay = CFG.crossGameMemoryDecay;
    const gm = GLOBAL_MEMORY;

    if (gm.gamesPlayed >= 2) {
      const seeded = [];
      for (const [weakness, rate] of Object.entries(gm.weaknessSuccessRate)) {
        if (rate * decay > 0.4) seeded.push(weakness);
      }
      if (seeded.length > 0) {
        this.playerProfile.weaknesses = seeded.slice(0, 3);
      }
    }
  }

  recordTowerPlacement(towerType, gridPos) {
    const p = this.playerProfile;
    p.towerCounts[towerType] = (p.towerCounts[towerType] || 0) + 1;
    p.towerPositions.push({
      type: towerType,
      pos: gridPos,
      wave: this.currentWave,
    });
    GLOBAL_MEMORY.towerUsageHistory[towerType] =
      (GLOBAL_MEMORY.towerUsageHistory[towerType] || 0) + 1;
    saveGlobalMemory();
  }

  recordWaveResults({
    enemiesKilled,
    enemiesLeaked,
    damageByTower,
    goldSpent,
    wave,
    currentTowerCounts = {},
  }) {
    const p = this.playerProfile;
    p.wavesSurvived = wave;
    p.totalGoldSpent += goldSpent;
    p.leaksByWave.push({ wave, leaked: enemiesLeaked, killed: enemiesKilled });

    for (const [type, dmg] of Object.entries(damageByTower)) {
      p.killsByTowerType[type] = (p.killsByTowerType[type] || 0) + dmg;
    }

    this.waveHistory.push({
      wave,
      killed: enemiesKilled,
      leaked: enemiesLeaked,
      damageByTower,
      goldSpent,
    });
    this._analyzePlayer();

    this.playerProfile.lastWaveReport = {
      wave,
      enemiesKilled,
      enemiesLeaked,
      goldSpent,
      topDamageTower: this._getTopDamageTowerType(damageByTower),
    };

    const lastLog = this.adaptationLog[this.adaptationLog.length - 1];
    this.playerProfile.lastCounterplay = this._evaluateCounterplay(
      lastLog,
      enemiesLeaked,
      currentTowerCounts,
      damageByTower,
      wave,
    );
    if (lastLog) {
      for (const w of lastLog.weaknesses || []) {
        const prev = GLOBAL_MEMORY.weaknessSuccessRate[w] || 0.5;
        const leaked = enemiesLeaked > 0 ? 1 : 0;
        GLOBAL_MEMORY.weaknessSuccessRate[w] = prev * 0.7 + leaked * 0.3;
      }
    }
    GLOBAL_MEMORY.totalWavesSurvived++;
    saveGlobalMemory();
  }

  recordBossResult(bossType, killed, towerUsed) {
    const bm = GLOBAL_MEMORY.bossEncounters;
    if (!bm[bossType])
      bm[bossType] = { encounters: 0, kills: 0, weaknessDiscovered: false };
    bm[bossType].encounters++;
    if (killed) {
      bm[bossType].kills++;
      if (towerUsed) bm[bossType].weaknessDiscovered = true;
    }
    saveGlobalMemory();
  }

  finalizeGame(won) {
    GLOBAL_MEMORY.gamesPlayed++;
    const p = this.playerProfile;

    for (const [type, count] of Object.entries(p.towerCounts)) {
      GLOBAL_MEMORY.playerTendencies[type] =
        (GLOBAL_MEMORY.playerTendencies[type] || 0) * 0.6 + count * 0.4;
    }

    if (won && p.preferredStrategy) {
      const key = p.preferredStrategy;
      GLOBAL_MEMORY.strategyCounterHistory[key] =
        (GLOBAL_MEMORY.strategyCounterHistory[key] || 0) + 1;
    }
    saveGlobalMemory();
  }

  _analyzePlayer() {
    const counts = this.playerProfile.towerCounts;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) return;

    const blended = { ...counts };
    for (const [type, val] of Object.entries(GLOBAL_MEMORY.playerTendencies)) {
      blended[type] =
        (blended[type] || 0) + val * CFG.crossGameMemoryDecay * 0.3;
    }

    let maxRatio = 0,
      dominant = null;
    const blendTotal = Object.values(blended).reduce((a, b) => a + b, 0);
    for (const [type, count] of Object.entries(blended)) {
      const r = count / blendTotal;
      if (r > maxRatio) {
        maxRatio = r;
        dominant = type;
      }
    }
    if (maxRatio > 0.28) this.playerProfile.preferredStrategy = dominant;

    this.playerProfile.towerSpread = this._calculateTowerSpread();

    const w = [];
    if ((counts.basic || 0) + (counts.sniper || 0) > (counts.cannon || 0) * 2.5)
      w.push("swarm");
    if (!counts.freeze || counts.freeze < 2) w.push("fast");
    if (!counts.sniper || counts.sniper < 2) w.push("armored");
    if (!counts.laser || counts.laser < 1) w.push("stealth");
    if (
      (counts.laser || 0) + (counts.freeze || 0) >
      (counts.sniper || 0) + (counts.cannon || 0)
    )
      w.push("boss_colossus");
    if (!counts.inferno && GLOBAL_MEMORY.gamesPlayed >= 2)
      w.push("boss_voidreaper");
    if (
      this.playerProfile.towerSpread < 0.3 &&
      this.playerProfile.towerPositions.length > 4
    )
      w.push("spread");

    // Also detect if player is ignoring a damage type
    if (!counts.tesla && total > 5) w.push("armored");
    if (!counts.cannon && total > 5) w.push("swarm");

    const boosted = [...new Set(w)].sort((a, b) => {
      const ra = GLOBAL_MEMORY.weaknessSuccessRate[a] || 0.5;
      const rb = GLOBAL_MEMORY.weaknessSuccessRate[b] || 0.5;
      return rb - ra;
    });

    this.playerProfile.weaknesses = boosted;
  }

  _getTopDamageTowerType(damageByTower) {
    let topType = null;
    let topValue = -1;

    for (const [type, value] of Object.entries(damageByTower || {})) {
      if (value > topValue) {
        topType = type;
        topValue = value;
      }
    }

    return topType;
  }

  _evaluateCounterplay(
    lastLog,
    enemiesLeaked,
    currentTowerCounts,
    damageByTower,
    wave,
  ) {
    if (!lastLog) return null;

    const threat = this._resolveForecastThreat(lastLog);
    if (!threat) return null;

    const counterMap = {
      stealth: { primary: "laser", alternates: [] },
      swarm: { primary: "cannon", alternates: ["vortex", "inferno"] },
      fast: { primary: "freeze", alternates: ["vortex"] },
      armored: { primary: "sniper", alternates: ["tesla", "inferno"] },
      spread: { primary: "cannon", alternates: ["inferno", "vortex"] },
      boss_colossus: { primary: "tesla", alternates: ["sniper"] },
      boss_phantom: { primary: "laser", alternates: [] },
      boss_titan: { primary: "cannon", alternates: ["vortex"] },
      boss_voidreaper: { primary: "inferno", alternates: ["tesla"] },
    };

    const plan = counterMap[threat];
    const topDamageTower = this._getTopDamageTowerType(damageByTower);
    const primaryOnline = plan ? (currentTowerCounts[plan.primary] || 0) > 0 : false;
    const alternateOnline = plan
      ? plan.alternates.some((type) => (currentTowerCounts[type] || 0) > 0)
      : false;
    const answeredWithDamage = plan
      ? topDamageTower === plan.primary || plan.alternates.includes(topDamageTower)
      : false;

    let result = "stalled";
    if (enemiesLeaked === 0 && (primaryOnline || alternateOnline || answeredWithDamage)) {
      result = "countered";
    } else if (enemiesLeaked === 0) {
      result = "stabilized";
    } else if (enemiesLeaked >= 3) {
      result = "punished";
    }

    return {
      wave,
      threat,
      result,
      primaryCounter: plan?.primary || null,
      topDamageTower,
      leaks: enemiesLeaked,
    };
  }

  _resolveForecastThreat(lastLog) {
    if (lastLog?.forecast?.threat) return lastLog.forecast.threat;
    if (lastLog?.bossType) return lastLog.bossType;
    if (lastLog?.weaknesses?.length > 0) return lastLog.weaknesses[0];
    return null;
  }

  _calculateTowerSpread() {
    const positions = this.playerProfile.towerPositions;
    if (positions.length < 2) return 1;
    let totalDist = 0,
      count = 0;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].pos.col - positions[j].pos.col;
        const dy = positions[i].pos.row - positions[j].pos.row;
        totalDist += Math.sqrt(dx * dx + dy * dy);
        count++;
      }
    }
    return Math.min(totalDist / count / 15, 1);
  }

  // ── Generate wave ─────────────────────────────────────────────────────────
  generateWave(waveNumber, totalWaves) {
    this.currentWave = waveNumber;

    // FIX: Endless mode has totalWaves=Infinity → progress was always 0.
    // Use a 30-wave rolling cycle so AI adapts every ~10 waves.
    const isEndless = !isFinite(totalWaves);
    const progress = isEndless
      ? Math.min(0.95, ((waveNumber - 1) % 30) / 30)
      : totalWaves
        ? waveNumber / totalWaves
        : 0;

    const baseCountRaw = Math.floor(12 + waveNumber * 5);
    const intensity =
      1 + progress * 0.8 + (isEndless ? Math.floor(waveNumber / 30) * 0.15 : 0);
    const baseCount = Math.floor(baseCountRaw * intensity);

    const hpMult =
      1 + waveNumber * (isEndless ? CFG.endlessHpPerWave : CFG.enemyHpPerWave);
    const speedMult =
      1 +
      waveNumber *
        (isEndless ? CFG.endlessSpeedPerWave : CFG.enemySpeedPerWave);

    let bossType = this.bossWaves[waveNumber] || null;
    if (!bossType) bossType = this._endlessBossForWave(waveNumber);
    if (progress > 0.75 && !bossType && waveNumber % 3 === 0) {
      bossType = this._endlessBossForWave(waveNumber);
    }

    const plan = this._buildAdaptationPlan(waveNumber, bossType, progress);

    const phaseMsg =
      progress < 0.25
        ? "Analyzing your defenses..."
        : progress < 0.5
          ? "Adapting to your strategy..."
          : progress < 0.75
            ? "Exploiting weaknesses..."
            : "Final assault. No mercy.";

    const finalMessage = `${phaseMsg} ${plan.message || ""}`.trim();

    if (waveNumber <= CFG.minWavesBeforeAdapt) {
      const comp =
        waveNumber === 1
          ? [{ type: "basic", weight: 10 }]
          : [
              { type: "basic", weight: 7 },
              { type: "fast", weight: 3 },
            ];

      return this._buildWave(
        waveNumber,
        comp,
        baseCount,
        hpMult,
        speedMult,
        finalMessage,
        bossType,
        progress,
      );
    }

    const waveData = this._buildWave(
      waveNumber,
      plan.composition,
      baseCount,
      hpMult,
      speedMult,
      finalMessage,
      bossType,
      progress,
    );

    this.adaptationLog.push({
      wave: waveNumber,
      strategy: this.playerProfile.preferredStrategy,
      weaknesses: [...this.playerProfile.weaknesses],
      bossType,
      message: finalMessage,
      forecast: plan.forecast || null,
    });

    return waveData;
  }

  calcMinimumRequiredTowers(waveNumber) {
    const reqs = {};
    const w = this.playerProfile.weaknesses;
    const boss = this.bossWaves[waveNumber];

    if (boss) {
      const bDef = ENEMY_TYPES[boss];
      if (bDef) {
        reqs[bDef.weakness] = Math.max(reqs[bDef.weakness] || 0, 2);
        if (bDef.phaseAt) reqs["freeze"] = Math.max(reqs["freeze"] || 0, 1);
      }
    }
    if (w.includes("swarm")) reqs["cannon"] = Math.max(reqs["cannon"] || 0, 2);
    if (w.includes("fast")) reqs["freeze"] = Math.max(reqs["freeze"] || 0, 2);
    if (w.includes("stealth")) reqs["laser"] = Math.max(reqs["laser"] || 0, 1);
    if (w.includes("armored"))
      reqs["sniper"] = Math.max(reqs["sniper"] || 0, 2);

    return reqs;
  }

  _buildAdaptationPlan(waveNumber, bossType, progress) {
    if (bossType) return this._bossWavePlan(bossType, waveNumber);

    const { weaknesses, preferredStrategy } = this.playerProfile;

    if (progress < 0.25) return this._escalationWave(waveNumber);

    if (progress < 0.5 && weaknesses.length > 0) {
      const targeted =
        weaknesses.find(
          (w) => (this.exploitAttempts[w] || 0) < CFG.maxExploitAttempts,
        ) || weaknesses[0];
      this.exploitAttempts[targeted] =
        (this.exploitAttempts[targeted] || 0) + 1;
      return this._exploitWeakness(targeted, waveNumber);
    }

    if (progress >= 0.5 && progress < 0.75) {
      if (preferredStrategy)
        return this._counterStrategy(preferredStrategy, waveNumber);
      if (weaknesses.length > 0) {
        const targeted =
          weaknesses[
            Math.floor(Math.random() * Math.min(2, weaknesses.length))
          ];
        this.exploitAttempts[targeted] =
          (this.exploitAttempts[targeted] || 0) + 1;
        return this._exploitWeakness(targeted, waveNumber);
      }
    }

    if (progress >= 0.75) return this._lateGamePressure(waveNumber, weaknesses);

    return this._escalationWave(waveNumber);
  }

  _lateGamePressure(waveNumber, weaknesses) {
    const validAggressive = ["swarm", "fast", "armored", "stealth"];

    const primary = weaknesses.find((w) => validAggressive.includes(w));
    const secondary = weaknesses.filter(
      (w) => validAggressive.includes(w) && w !== primary,
    )[0];

    const aggressive = {
      swarm: [
        { type: "swarm", weight: 10 },
        { type: "fast", weight: 5 },
      ],
      fast: [
        { type: "fast", weight: 10 },
        { type: "stealth", weight: 4 },
      ],
      armored: [
        { type: "armored", weight: 10 },
        { type: "basic", weight: 3 },
      ],
      stealth: [
        { type: "stealth", weight: 10 },
        { type: "fast", weight: 5 },
      ],
    };

    // Mix two weaknesses if available for maximum pressure
    let comp = aggressive[primary] || [
      { type: "fast", weight: 6 },
      { type: "armored", weight: 4 },
    ];
    if (secondary && aggressive[secondary]) {
      comp = [
        ...aggressive[primary].map((e) => ({
          ...e,
          weight: Math.ceil(e.weight * 0.6),
        })),
        ...aggressive[secondary].map((e) => ({
          ...e,
          weight: Math.ceil(e.weight * 0.4),
        })),
      ];
    }

    return {
      composition: comp,
      forecast: this._makeForecast(
        "Late-game pressure",
        secondary
          ? `${primary || "Mixed"} + ${secondary} assault likely`
          : `${primary || "Mixed"} assault likely`,
        secondary
          ? "The AI is stacking two pressure vectors to break mature defenses."
          : "The AI is entering its late-game pressure phase and committing to your softest lane.",
        secondary ? "high" : "medium",
        primary || secondary || "mixed",
      ),
      message: `⚠ FINAL PUSH: Dual exploitation — ${primary || "overwhelming force"}.`,
    };
  }

  // FIX: Added "boss_" prefix to all plan keys
  _bossWavePlan(bossType, waveNumber) {
    const plans = {
      boss_colossus: {
        composition: [
          { type: "armored", weight: 6 },
          { type: "basic", weight: 3 },
          { type: "fast", weight: 1 },
        ],
        message: `⚠ COLOSSUS: Armored escort inbound. Tesla required.`,
      },
      boss_phantom: {
        composition: [
          { type: "stealth", weight: 7 },
          { type: "fast", weight: 3 },
        ],
        message: `⚠ PHANTOM LORD: Ghost vanguard. Laser is your only counter.`,
      },
      boss_titan: {
        composition: [
          { type: "swarm", weight: 8 },
          { type: "basic", weight: 4 },
        ],
        message: `⚠ TITAN HIVE: Swarm carpet. Cannon splash critical.`,
      },
      boss_voidreaper: {
        composition: [
          { type: "stealth", weight: 5 },
          { type: "fast", weight: 3 },
          { type: "armored", weight: 2 },
        ],
        message: `⚠ VOID REAPER: Phase vanguard. Inferno required.`,
      },
    };
    return plans[bossType] || this._escalationWave(waveNumber);
  }

  _exploitWeakness(weakness, waveNumber) {
    const gamesStr =
      GLOBAL_MEMORY.gamesPlayed > 0
        ? ` [${GLOBAL_MEMORY.gamesPlayed} runs]`
        : "";
    const plans = {
      swarm: {
        composition: [
          { type: "swarm", weight: 8 },
          { type: "basic", weight: 2 },
          { type: "spread", weight: waveNumber > 5 ? 2 : 0 },
        ],
        message: `AI${gamesStr}: Swarm flood. No cannon coverage detected.`,
      },
      fast: {
        composition: [
          { type: "fast", weight: 7 },
          { type: "swarm", weight: 3 },
        ],
        message: `AI${gamesStr}: No Cryo detected. High-speed raid.`,
      },
      armored: {
        composition: [
          { type: "armored", weight: 6 },
          { type: "basic", weight: 4 },
        ],
        message: `AI${gamesStr}: Insufficient armor-pierce. Steel column.`,
      },
      stealth: {
        composition: [
          { type: "stealth", weight: 7 },
          { type: "fast", weight: 3 },
        ],
        message: `AI${gamesStr}: No Laser towers. Ghosts will pass unseen.`,
      },
      spread: {
        composition: [
          { type: "fast", weight: 4 },
          { type: "stealth", weight: 3 },
          { type: "swarm", weight: 5 },
        ],
        message: `AI${gamesStr}: Clustered defenses. Multi-vector flanking.`,
      },
      boss_colossus: {
        composition: [
          { type: "armored", weight: 5 },
          { type: "basic", weight: 3 },
          { type: "fast", weight: 2 },
        ],
        message: `AI${gamesStr}: Anti-armor insufficient. Colossus prep.`,
      },
      boss_voidreaper: {
        composition: [
          { type: "stealth", weight: 5 },
          { type: "armored", weight: 3 },
          { type: "fast", weight: 2 },
        ],
        message: `AI${gamesStr}: Void vanguard. Inferno critical.`,
      },
    };
    return plans[weakness] || this._escalationWave(waveNumber);
  }

  _counterStrategy(strategy, waveNumber) {
    const gamesStr =
      GLOBAL_MEMORY.gamesPlayed > 0
        ? ` [${GLOBAL_MEMORY.gamesPlayed} runs]`
        : "";
    const counters = {
      basic: {
        composition: [
          { type: "armored", weight: 5 },
          { type: "fast", weight: 3 },
          { type: "stealth", weight: 2 },
        ],
        message: `Counter${gamesStr}: GUNNER spam → Mixed hard targets.`,
      },
      sniper: {
        composition: [
          { type: "swarm", weight: 8 },
          { type: "fast", weight: 4 },
        ],
        message: `Counter${gamesStr}: SNIPER spam → Volume beats precision.`,
      },
      cannon: {
        composition: [
          { type: "fast", weight: 6 },
          { type: "spread", weight: 2 },
          { type: "stealth", weight: 2 },
        ],
        message: `Counter${gamesStr}: CANNON spam → Speed + stealth dodge splash.`,
      },
      laser: {
        composition: [
          { type: "armored", weight: 6 },
          { type: "spread", weight: 2 },
        ],
        message: `Counter${gamesStr}: LASER spam → Armor absorbs beams.`,
      },
      freeze: {
        composition: [
          { type: "armored", weight: 5 },
          { type: "fast", weight: 3 },
        ],
        message: `Counter${gamesStr}: CRYO spam → Cold-immune heavies.`,
      },
      tesla: {
        composition: [
          { type: "stealth", weight: 6 },
          { type: "spread", weight: 3 },
        ],
        message: `Counter${gamesStr}: TESLA spam → Stealth breaks chain logic.`,
      },
      inferno: {
        composition: [
          { type: "armored", weight: 7 },
          { type: "basic", weight: 3 },
        ],
        message: `Counter${gamesStr}: INFERNO spam → Armor resists burn.`,
      },
      vortex: {
        composition: [
          { type: "fast", weight: 5 },
          { type: "stealth", weight: 4 },
        ],
        message: `Counter${gamesStr}: VORTEX spam → Speed + stealth escape gravity.`,
      },
    };
    return counters[strategy] || this._escalationWave(waveNumber);
  }

  _escalationWave(waveNumber) {
    const patterns = [
      [
        { type: "basic", weight: 8 },
        { type: "fast", weight: 2 },
      ],
      [
        { type: "basic", weight: 5 },
        { type: "armored", weight: 3 },
        { type: "fast", weight: 2 },
      ],
      [
        { type: "fast", weight: 6 },
        { type: "swarm", weight: 4 },
      ],
      [
        { type: "armored", weight: 4 },
        { type: "basic", weight: 4 },
        { type: "stealth", weight: 2 },
      ],
      [
        { type: "spread", weight: 3 },
        { type: "swarm", weight: 5 },
        { type: "fast", weight: 2 },
      ],
      [
        { type: "stealth", weight: 5 },
        { type: "fast", weight: 3 },
        { type: "basic", weight: 2 },
      ],
    ];
    const gamesStr =
      GLOBAL_MEMORY.gamesPlayed > 0
        ? ` [Run #${GLOBAL_MEMORY.gamesPlayed + 1}]`
        : "";
    return {
      composition: patterns[waveNumber % patterns.length],
      message: `Wave ${waveNumber}${gamesStr}: Escalating...`,
    };
  }

  _buildWave(
    waveNumber,
    composition,
    baseCount,
    hpMult,
    speedMult,
    message,
    bossType,
    progress,
  ) {
    let bossDelay = 0;
    let bossLane = 0;

    const validComp = composition.filter(
      (c) => c.weight > 0 && ENEMY_TYPES[c.type],
    );

    if (validComp.length === 0) {
      validComp.push({ type: "basic", weight: 10 });
      validComp.push({ type: "fast", weight: 3 });
    }

    const totalWeight = validComp.reduce((s, c) => s + c.weight, 0);

    if (totalWeight === 0) {
      return { waveNumber, enemies: [], message, bossType, totalEnemies: 0 };
    }

    const enemies = [];
    let globalDelay = 0;
    const delayFactor = Math.max(0.4, 1 - progress * 0.55);

    const rewardMult = 1 + Math.sqrt(waveNumber - 1) * 0.2;

    const GROUP_SIZE = 4;
    const INTRA_DELAY = 10;
    const INTER_DELAY = 65;

    for (const entry of validComp) {
      const count = Math.max(
        1,
        Math.round((entry.weight / totalWeight) * baseCount),
      );
      const lane = Math.random() < 0.7 ? 0 : 1;
      for (let i = 0; i < count; i++) {
        enemies.push({
          type: entry.type,
          hpMult,
          speedMult,
          rewardMult,
          spawnDelay: globalDelay,
          lane,
        });
        globalDelay +=
          ((i + 1) % GROUP_SIZE === 0 ? INTER_DELAY : INTRA_DELAY) *
          delayFactor;
      }
      globalDelay += INTER_DELAY * delayFactor;
    }

    const totalWaveDuration = globalDelay;

    if (bossType && ENEMY_TYPES[bossType]) {
      const bossHpMult = hpMult * 0.9 * ADMIN_CONFIG.ai.bossHpScaling;

      const r = Math.random();
      const bossPhase = r < 0.33 ? "early" : r < 0.66 ? "mid" : "late";

      if (bossPhase === "early")
        bossDelay = Math.max(80, totalWaveDuration * 0.2);
      else if (bossPhase === "mid")
        bossDelay = Math.max(80, totalWaveDuration * 0.5);
      else bossDelay = Math.max(80, totalWaveDuration * 0.75);

      bossLane = Math.random() < 0.5 ? 0 : 1;

      enemies.push({
        type: bossType,
        hpMult: bossHpMult,
        speedMult: 1,
        rewardMult: 1,
        spawnDelay: bossDelay,
        isBoss: true,
        lane: bossLane,
      });

      // Enhanced escort based on boss type
      const escortConfig = {
        boss_colossus: { type: "armored", count: 4 },
        boss_phantom: { type: "stealth", count: 3 },
        boss_titan: { type: "swarm", count: 6 },
        boss_voidreaper: { type: "fast", count: 4 },
      };
      const escort = escortConfig[bossType] || {
        type: progress > 0.6 ? "fast" : "basic",
        count: 3,
      };
      for (let i = 0; i < escort.count; i++) {
        enemies.push({
          type: escort.type,
          hpMult,
          speedMult,
          rewardMult,
          spawnDelay: bossDelay + i * 8,
          lane: bossLane,
        });
      }

      if (progress < 0.5) {
        enemies.push({
          type: "basic",
          hpMult,
          speedMult,
          rewardMult,
          spawnDelay: bossDelay + 60,
        });
      }
    }

    // Second boss on milestone waves (wave 20+)
    const allBossTypes = [
      "boss_colossus",
      "boss_phantom",
      "boss_titan",
      "boss_voidreaper",
    ];
    const eligibleSecond = allBossTypes.filter(
      (b) => b !== bossType && ENEMY_TYPES[b],
    );
    let secondBossType = null;

    if (waveNumber >= 20 && eligibleSecond.length > 0) {
      const isMilestone = waveNumber % 10 === 0;
      const chance = isMilestone
        ? 1.0
        : Math.min(0.7, 0.25 + (waveNumber - 20) * 0.01);
      if (Math.random() < chance) {
        secondBossType =
          eligibleSecond[Math.floor(Math.random() * eligibleSecond.length)];
      }
    }

    if (secondBossType) {
      const secondDelay =
        bossDelay > totalWaveDuration * 0.5
          ? Math.max(80, totalWaveDuration * 0.25)
          : Math.max(80, totalWaveDuration * 0.75);

      const secondHpMult = hpMult * 0.75 * ADMIN_CONFIG.ai.bossHpScaling;
      const secondLane = bossLane === 0 ? 1 : 0;

      enemies.push({
        type: secondBossType,
        hpMult: secondHpMult,
        speedMult: 1,
        rewardMult: 1.5,
        spawnDelay: secondDelay,
        isBoss: true,
        lane: secondLane,
      });

      const secondEscort = progress > 0.5 ? "armored" : "fast";
      for (let i = 0; i < 2; i++) {
        enemies.push({
          type: secondEscort,
          hpMult,
          speedMult,
          rewardMult,
          spawnDelay: secondDelay + i * 10,
          lane: secondLane,
        });
      }
    }

    return {
      waveNumber,
      enemies: enemies.sort((a, b) => a.spawnDelay - b.spawnDelay),
      message,
      bossType,
      totalEnemies: enemies.length,
    };
  }

  _endlessBossForWave(waveNumber) {
    if (waveNumber < 10) return null;
    if (waveNumber % 5 !== 0) return null;
    const schedule = ENDLESS_CONFIG.bossSchedule;
    if (!schedule || schedule.length === 0) return null;
    const idx = Math.floor(waveNumber / 5) - 2;
    return schedule[idx % schedule.length] || null;
  }

  getAdaptationSummary(runtimeContext = {}) {
    const recentAdaptation =
      this.adaptationLog[this.adaptationLog.length - 1] || null;

    return {
      strategy: this.playerProfile.preferredStrategy,
      weaknesses: this.playerProfile.weaknesses,
      towerCounts: { ...this.playerProfile.towerCounts },
      gamesPlayed: GLOBAL_MEMORY.gamesPlayed,
      recentAdaptation,
      report: this._buildAiReport(recentAdaptation, runtimeContext),
    };
  }

  _buildAiReport(recentAdaptation, runtimeContext) {
    const strategy = this.playerProfile.preferredStrategy;
    const weaknesses = this.playerProfile.weaknesses || [];
    const primaryWeakness = weaknesses[0] || null;
    const lastWave = this.playerProfile.lastWaveReport;
    const lastCounterplay = this.playerProfile.lastCounterplay;

    return {
      tone: this._getAiTone(strategy),
      taunt: this._buildTaunt(strategy, primaryWeakness, lastCounterplay),
      debrief: this._buildDebrief(
        strategy,
        weaknesses,
        recentAdaptation,
        lastCounterplay,
      ),
      forecast: this._buildForecast(recentAdaptation, primaryWeakness),
      suggestion: this._buildSuggestion(
        primaryWeakness,
        recentAdaptation,
        runtimeContext,
      ),
      lastWave: this._buildLastWaveBreakdown(lastWave, lastCounterplay),
      counterplay: this._buildCounterplayBeat(lastCounterplay),
    };
  }

  _buildLastWaveBreakdown(lastWave, lastCounterplay) {
    if (!lastWave) {
      return {
        headline: "No combat data yet.",
        summary: "Start a wave to generate the first debrief.",
        status: "neutral",
        statusLabel: "Awaiting data",
      };
    }

    const leakedText =
      lastWave.enemiesLeaked > 0
        ? `breach detected: ${lastWave.enemiesLeaked} enemy units got through`
        : "defense held perfectly";

    const carryType = lastWave.topDamageTower
      ? TOWER_TYPES[lastWave.topDamageTower]?.name || lastWave.topDamageTower
      : "No tower";

    let status = "neutral";
    let statusLabel = "Holding pattern";
    let headline = `Wave ${lastWave.wave} analysis`;
    let summary = `${leakedText}. Top damage came from ${carryType}.`;

    if (lastCounterplay?.result === "countered") {
      status = "success";
      statusLabel = "Counter held";
      headline = `Wave ${lastWave.wave}: counter held`;
      summary = `You read the last threat correctly and shut it down. ${carryType} carried the damage line.`;
    } else if (lastCounterplay?.result === "stabilized") {
      status = "warning";
      statusLabel = "Pressure survived";
      headline = `Wave ${lastWave.wave}: pressure survived`;
      summary = `The line held, but the AI still sees room to retry that angle. ${carryType} did most of the work.`;
    } else if (lastCounterplay?.result === "punished") {
      status = "danger";
      statusLabel = "Exploit succeeded";
      headline = `Wave ${lastWave.wave}: exploit succeeded`;
      summary = `The AI found a working breach pattern. ${lastWave.enemiesLeaked} units got through before ${carryType} could stabilize the lane.`;
    }

    return {
      headline,
      summary,
      status,
      statusLabel,
    };
  }

  _getAiTone(strategy) {
    const tones = {
      basic: "You rely on raw volume. Predictable.",
      sniper: "Precision is elegant. It is also fragile.",
      cannon: "Heavy blast patterns detected.",
      laser: "Energy doctrine identified.",
      freeze: "Control-focused defense logged.",
      tesla: "Chain-response strategy recognized.",
      inferno: "Sustained burn patterns observed.",
      vortex: "Displacement tactics detected.",
    };

    return tones[strategy] || "I am still studying your defense pattern.";
  }

  _buildTaunt(strategy, weakness, lastCounterplay) {
    if (lastCounterplay?.result === "countered") {
      return "You adapted faster than expected. I will need a cleaner angle.";
    }
    if (lastCounterplay?.result === "punished") {
      return "Your correction was too slow. The breach data is useful.";
    }
    if (weakness === "stealth") {
      return "You still leave gaps in detection. Ghost units remain viable.";
    }
    if (weakness === "swarm") {
      return "Your defenses struggle when the field gets crowded.";
    }
    if (weakness === "fast") {
      return "Your response window is too slow for rapid assaults.";
    }
    if (weakness === "armored") {
      return "Armor continues to blunt your strongest attacks.";
    }
    if (strategy) {
      return `Your dependence on ${strategy.toUpperCase()} towers is becoming exploitable.`;
    }
    return "Every wave tells me more about how you think.";
  }

  _buildDebrief(strategy, weaknesses, recentAdaptation, lastCounterplay) {
    if (!recentAdaptation) {
      return "No combat read yet. Start a wave so the AI can profile your build.";
    }

    const weaknessText =
      weaknesses.length > 0 ? weaknesses.slice(0, 2).join(", ") : "none yet";

    if (lastCounterplay?.result === "countered") {
      return `Detected strategy: ${strategy || "mixed"}. You answered the last ${lastCounterplay.threat} read and closed the leak window.`;
    }
    if (lastCounterplay?.result === "punished") {
      return `Detected strategy: ${strategy || "mixed"}. The last ${lastCounterplay.threat} pressure wave still broke through your line.`;
    }

    return `Detected strategy: ${strategy || "mixed"}. Current pressure points: ${weaknessText}.`;
  }

  _buildCounterplayBeat(lastCounterplay) {
    if (!lastCounterplay) return null;

    const threatName =
      ENEMY_TYPES[lastCounterplay.threat]?.name ||
      TOWER_TYPES[lastCounterplay.threat]?.name ||
      lastCounterplay.threat;
    const counterName =
      TOWER_TYPES[lastCounterplay.primaryCounter]?.name ||
      lastCounterplay.primaryCounter;

    if (lastCounterplay.result === "countered") {
      return {
        label: "Counterplay memory",
        color: "#86efac",
        text: `You answered the last ${threatName} read${counterName ? ` with ${counterName}` : ""}. The AI noticed.`,
      };
    }

    if (lastCounterplay.result === "punished") {
      return {
        label: "Counterplay memory",
        color: "#fca5a5",
        text: `${threatName} pressure still broke through. The AI will treat that lane as exploitable.`,
      };
    }

    return {
      label: "Counterplay memory",
      color: "#fbbf24",
      text: `You stabilized the last ${threatName} push, but the AI has not ruled out that angle yet.`,
    };
  }

  _buildForecast(recentAdaptation, primaryWeakness) {
    const lastCounterplay = this.playerProfile.lastCounterplay;
    if (recentAdaptation?.forecast) {
      return this._adjustForecastConfidence(
        recentAdaptation.forecast,
        lastCounterplay,
      );
    }

    if (recentAdaptation?.bossType) {
      const bossDef = ENEMY_TYPES[recentAdaptation.bossType];
      return this._adjustForecastConfidence(
        this._makeForecast(
          "Boss schedule",
          `${bossDef?.name || recentAdaptation.bossType} incoming`,
          bossDef?.weaknessHint ||
            recentAdaptation?.message ||
            "Boss pressure is building and the AI expects a major defense check.",
          "certain",
          recentAdaptation.bossType,
        ),
        lastCounterplay,
      );
    }

    if (recentAdaptation?.strategy) {
      return this._adjustForecastConfidence(
        this._makeForecast(
          "Strategy counter",
          `${recentAdaptation.strategy.toUpperCase()} counter-pressure likely`,
          recentAdaptation?.message ||
            "The AI believes your dominant tower pattern is predictable enough to counter directly.",
          "high",
          primaryWeakness || recentAdaptation.strategy,
        ),
        lastCounterplay,
      );
    }

    const fallbackByWeakness = {
      stealth: this._makeForecast(
        "Weakness exploit",
        "Stealth pressure likely",
        "Detection remains thin, so ghost probes are still efficient.",
        "high",
        "stealth",
      ),
      swarm: this._makeForecast(
        "Weakness exploit",
        "Mass-unit pressure likely",
        "Your current build is still vulnerable to crowd saturation.",
        "high",
        "swarm",
      ),
      fast: this._makeForecast(
        "Weakness exploit",
        "High-speed raids likely",
        "The AI still sees slow response windows in your defense.",
        "high",
        "fast",
      ),
      armored: this._makeForecast(
        "Weakness exploit",
        "Armored columns likely",
        "Armor remains an efficient way to soak your frontline damage.",
        "high",
        "armored",
      ),
      spread: this._makeForecast(
        "Weakness exploit",
        "Split-pressure formations likely",
        "Your defense still looks vulnerable to multi-lane stress.",
        "medium",
        "spread",
      ),
    };

    return this._adjustForecastConfidence(
      fallbackByWeakness[primaryWeakness] ||
        this._makeForecast(
        "Adaptive pressure",
        "Mixed wave pattern likely",
        recentAdaptation?.message ||
          "The AI is still probing for the cleanest line of attack.",
        "medium",
        "mixed",
      ),
      lastCounterplay,
    );
  }

  _adjustForecastConfidence(forecast, lastCounterplay) {
    if (!forecast) return forecast;
    if (!lastCounterplay) return forecast;
    if (!forecast.threat || forecast.threat !== lastCounterplay.threat) {
      return forecast;
    }

    const order = ["low", "medium", "high", "certain"];
    const currentIndex = Math.max(0, order.indexOf(forecast.confidence || "medium"));
    let nextIndex = currentIndex;

    if (lastCounterplay.result === "countered") {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (lastCounterplay.result === "punished") {
      nextIndex = Math.min(order.length - 1, currentIndex + 1);
    }

    if (nextIndex === currentIndex) return forecast;

    return {
      ...forecast,
      confidence: order[nextIndex],
      detail:
        lastCounterplay.result === "countered"
          ? `${forecast.detail} Confidence reduced after your last successful answer.`
          : `${forecast.detail} Confidence increased after the last breach.`,
    };
  }

  _buildSuggestion(primaryWeakness, recentAdaptation, runtimeContext) {
    const towerCounts = runtimeContext.towerCounts || {};
    const towerCaps = runtimeContext.towerCaps || {};
    const towerCatCounts = runtimeContext.towerCatCounts || {};
    const unlockedTowers = runtimeContext.unlockedTowers || [];
    const gold = runtimeContext.gold || 0;
    const totalTowers = Object.values(towerCounts).reduce((a, b) => a + b, 0);
    const totalCap = Object.values(towerCaps).reduce((a, b) => a + b, 0);
    const atCap = totalCap > 0 && totalTowers >= totalCap;
    const hasFortifyRoom =
      typeof runtimeContext.fortifyLevel === "number" &&
      typeof runtimeContext.maxFortifyLevel === "number" &&
      runtimeContext.fortifyLevel < runtimeContext.maxFortifyLevel;
    const canFortify =
      hasFortifyRoom && gold >= (runtimeContext.fortifyCost || Infinity);

    const threatPlans = {
      stealth: {
        counter: "laser",
        altCounters: [],
        build: "Add a Laser tower before the next wave or stealth units will slip through.",
        upgrade:
          "Tower cap reached. Preserve your Laser coverage and upgrade it before the next wave.",
        replace:
          "Tower cap reached and detection is thin. Sell a low-impact tower and replace it with Laser coverage.",
        fallback:
          "Stealth pressure is coming. Hold your panic tools for the first breach and rebalance into detection next build window.",
      },
      swarm: {
        counter: "cannon",
        altCounters: ["vortex", "inferno"],
        build: "Add Cannon coverage near a choke point to keep swarm pressure under control.",
        upgrade:
          "Tower cap reached. Upgrade your splash tower line and concentrate damage at the busiest choke.",
        replace:
          "Your anti-swarm answer is thin. Sell a low-impact single-target tower for Cannon or Vortex coverage.",
        fallback:
          "Swarm pressure is likely. Save abilities for crowd collapse and avoid spending your last gold on minor upgrades.",
      },
      fast: {
        counter: "freeze",
        altCounters: ["vortex"],
        build: "Add Cryo coverage earlier on the path so fast units spend more time under fire.",
        upgrade:
          "Tower cap reached. Upgrade your slowing coverage and make sure it triggers earlier on the route.",
        replace:
          "Fast raids are likely. Replace a low-value tower with Cryo control or stronger early-path coverage.",
        fallback:
          "Speed pressure is coming. Save stun and burst tools for the first rush, then rebalance into control.",
      },
      armored: {
        counter: "sniper",
        altCounters: ["tesla", "inferno"],
        build: "Add Sniper or Tesla pressure so armor stops soaking your entire frontline.",
        upgrade:
          "Tower cap reached. Upgrade your armor-piercing line instead of widening the build.",
        replace:
          "Armor pressure is outpacing your damage. Sell a weak utility tower and pivot into Sniper or Tesla.",
        fallback:
          "Armored columns are likely. Prioritize your strongest pierce upgrades and hold burst abilities for the lead units.",
      },
      spread: {
        counter: "cannon",
        altCounters: ["inferno", "vortex"],
        build: "Keep some splash coverage online and avoid stacking every tower in one cluster.",
        upgrade:
          "Tower cap reached. Strengthen your splash lane and spread your strongest towers across multiple zones.",
        replace:
          "Split-pressure formations are likely. Replace a redundant tower in your main cluster with wider area coverage.",
        fallback:
          "Multi-angle pressure is likely. Save map-wide abilities and do not overcommit to one corner of the map.",
      },
    };

    const plan = threatPlans[primaryWeakness];
    const bossPlan = this._buildBossSuggestion(recentAdaptation, runtimeContext);
    if (bossPlan) return bossPlan;

    if (!plan) {
      return atCap
        ? "Suggestion: tower cap reached. Upgrade your highest-impact towers and trim anything that is no longer solving a threat."
        : "Suggestion: diversify tower roles so one counter-wave cannot punish the whole defense.";
    }

    const counterUnlocked = unlockedTowers.includes(plan.counter);
    const counterCount = towerCounts[plan.counter] || 0;
    const altCount = (plan.altCounters || []).reduce(
      (sum, type) => sum + (towerCounts[type] || 0),
      0,
    );
    const hasRelevantCounter = counterCount > 0 || altCount > 0;
    const counterDef = TOWER_TYPES[plan.counter];
    const counterCategory = counterDef?.category;
    const catLimit =
      counterCategory && towerCaps[counterCategory] !== undefined
        ? towerCaps[counterCategory]
        : null;
    const catUsed =
      counterCategory && towerCatCounts[counterCategory] !== undefined
        ? towerCatCounts[counterCategory]
        : 0;
    const categoryFull = catLimit !== null && catUsed >= catLimit;
    const canAffordCounter = counterDef ? gold >= counterDef.cost : false;

    if (!counterUnlocked) {
      return `Suggestion: ${primaryWeakness} is a live weakness, but your ideal counter is not unlocked here. Lean on upgrades, abilities, and the best substitute towers you have online.`;
    }

    if (!atCap && !categoryFull && canAffordCounter) {
      return plan.build;
    }

    if (!atCap && !categoryFull && !canAffordCounter) {
      if (canFortify) {
        return `${plan.fallback} You cannot afford ${counterDef.name} yet, so a fortify purchase is the cleanest short-term stabilizer.`;
      }
      return `${plan.fallback} You cannot afford ${counterDef.name} yet, so preserve gold for a real counter purchase.`;
    }

    if (hasRelevantCounter) {
      return plan.upgrade;
    }

    if (atCap || categoryFull) {
      return plan.replace;
    }

    return plan.fallback;
  }

  _buildBossSuggestion(recentAdaptation, runtimeContext) {
    const bossType = recentAdaptation?.bossType;
    if (!bossType) return null;

    const bossDef = ENEMY_TYPES[bossType];
    if (!bossDef?.weakness) return null;

    const weakness = bossDef.weakness;
    const weaknessTower = TOWER_TYPES[weakness];
    const towerCounts = runtimeContext.towerCounts || {};
    const unlockedTowers = runtimeContext.unlockedTowers || [];
    const gold = runtimeContext.gold || 0;
    const totalTowers = Object.values(towerCounts).reduce((a, b) => a + b, 0);
    const totalCap = Object.values(runtimeContext.towerCaps || {}).reduce(
      (a, b) => a + b,
      0,
    );
    const atCap = totalCap > 0 && totalTowers >= totalCap;
    const hasWeaknessCounter = (towerCounts[weakness] || 0) > 0;

    if (!unlockedTowers.includes(weakness)) {
      return `Suggestion: ${bossDef.name} is approaching, but its best counter is locked on this level. Prepare burst abilities and strengthen your highest-damage lane.`;
    }

    if (!hasWeaknessCounter && !atCap && weaknessTower && gold >= weaknessTower.cost) {
      return `Suggestion: ${bossDef.name} is coming. Build ${weaknessTower.name} now to answer its weakness cleanly.`;
    }

    if (!hasWeaknessCounter && atCap) {
      return `Suggestion: ${bossDef.name} is coming and you are at tower cap. Sell a low-impact tower and pivot into ${weaknessTower?.name || weakness}.`;
    }

    if (hasWeaknessCounter) {
      return `Suggestion: ${bossDef.name} is coming. Strengthen your ${weaknessTower?.name || weakness} line and save abilities for the boss phase.`;
    }

    return `Suggestion: ${bossDef.name} is approaching. Prepare your strongest lane and keep emergency abilities off cooldown.`;
  }

  _makeForecast(source, headline, detail, confidence, threat = null) {
    return {
      source,
      headline,
      detail,
      confidence,
      threat,
    };
  }
}

