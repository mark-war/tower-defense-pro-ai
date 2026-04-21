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

let GLOBAL_MEMORY = {
  gamesPlayed: 0,
  towerUsageHistory: {},
  weaknessSuccessRate: {},
  strategyCounterHistory: {},
  playerTendencies: {},
  totalWavesSurvived: 0,
  bossEncounters: {},
};

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
  }

  recordWaveResults({
    enemiesKilled,
    enemiesLeaked,
    damageByTower,
    goldSpent,
    wave,
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

    const lastLog = this.adaptationLog[this.adaptationLog.length - 1];
    if (lastLog) {
      for (const w of lastLog.weaknesses || []) {
        const prev = GLOBAL_MEMORY.weaknessSuccessRate[w] || 0.5;
        const leaked = enemiesLeaked > 0 ? 1 : 0;
        GLOBAL_MEMORY.weaknessSuccessRate[w] = prev * 0.7 + leaked * 0.3;
      }
    }
    GLOBAL_MEMORY.totalWavesSurvived++;
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
    const primary = weaknesses[0];
    const secondary = weaknesses[1];

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
    const totalWeight = validComp.reduce((s, c) => s + c.weight, 0);
    const enemies = [];
    let globalDelay = 0;
    const delayFactor = Math.max(0.4, 1 - progress * 0.55);

    const rewardMult = 1 + (waveNumber - 1) * 0.07;

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

  getAdaptationSummary() {
    return {
      strategy: this.playerProfile.preferredStrategy,
      weaknesses: this.playerProfile.weaknesses,
      towerCounts: { ...this.playerProfile.towerCounts },
      gamesPlayed: GLOBAL_MEMORY.gamesPlayed,
      recentAdaptation:
        this.adaptationLog[this.adaptationLog.length - 1] || null,
    };
  }
}
