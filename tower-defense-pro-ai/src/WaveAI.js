// ──────────────────────────────────────────────────────────────────────────────
//  WaveAI — learns across waves AND across game sessions (via persistent memory)
//  Every new game feeds the same AI brain, making it progressively smarter.
// ──────────────────────────────────────────────────────────────────────────────
import { ENEMY_TYPES, TOWER_TYPES, ADMIN_CONFIG } from './gameConstants.js';

const CFG = ADMIN_CONFIG.ai;

// ── Persistent cross-game memory (survives resets in same browser tab) ────────
let GLOBAL_MEMORY = {
  gamesPlayed: 0,
  towerUsageHistory: {},     // cumulative tower usage across all games
  weaknessSuccessRate: {},   // which exploits actually leaked enemies
  strategyCounterHistory: {},// what countered each strategy
  playerTendencies: {},      // long-term behavioral patterns
  totalWavesSurvived: 0,
  bossEncounters: {},        // how player handled each boss type
};

export function getGlobalMemory() { return GLOBAL_MEMORY; }

export class WaveAI {
  constructor(levelConfig) {
    this.levelConfig = levelConfig;
    this.bossWaves   = levelConfig?.bossWaves || {};

    // Per-game profile
    this.playerProfile = {
      towerCounts:      {},
      towerPositions:   [],
      killsByTowerType: {},
      leaksByWave:      [],
      wavesSurvived:    0,
      totalGoldSpent:   0,
      preferredStrategy: null,
      weaknesses:       [],
      towerSpread:      1,
    };

    this.waveHistory    = [];
    this.adaptationLog  = [];
    this.currentWave    = 0;
    this.exploitAttempts = {};

    // Import cross-game knowledge (decayed)
    this._applyGlobalMemory();
  }

  // ── Absorb cross-game memory ────────────────────────────────────────────────
  _applyGlobalMemory() {
    const decay = CFG.crossGameMemoryDecay;
    const gm = GLOBAL_MEMORY;

    // If the AI has played enough games, bias its initial assessment
    if (gm.gamesPlayed >= 2) {
      // Pre-seed weaknesses from history
      const seeded = [];
      for (const [weakness, rate] of Object.entries(gm.weaknessSuccessRate)) {
        if (rate * decay > 0.4) seeded.push(weakness);
      }
      if (seeded.length > 0) {
        this.playerProfile.weaknesses = seeded.slice(0, 3);
      }
    }
  }

  // ── Record tower placement ──────────────────────────────────────────────────
  recordTowerPlacement(towerType, gridPos) {
    const p = this.playerProfile;
    p.towerCounts[towerType] = (p.towerCounts[towerType] || 0) + 1;
    p.towerPositions.push({ type: towerType, pos: gridPos, wave: this.currentWave });

    // Update global memory
    GLOBAL_MEMORY.towerUsageHistory[towerType] =
      (GLOBAL_MEMORY.towerUsageHistory[towerType] || 0) + 1;
  }

  // ── Record wave results ─────────────────────────────────────────────────────
  recordWaveResults({ enemiesKilled, enemiesLeaked, damageByTower, goldSpent, wave }) {
    const p = this.playerProfile;
    p.wavesSurvived = wave;
    p.totalGoldSpent += goldSpent;
    p.leaksByWave.push({ wave, leaked: enemiesLeaked, killed: enemiesKilled });

    for (const [type, dmg] of Object.entries(damageByTower)) {
      p.killsByTowerType[type] = (p.killsByTowerType[type] || 0) + dmg;
    }

    this.waveHistory.push({ wave, killed: enemiesKilled, leaked: enemiesLeaked, damageByTower, goldSpent });
    this._analyzePlayer();

    // Update global success rates for exploits attempted this wave
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

  // ── Record boss encounter result ────────────────────────────────────────────
  recordBossResult(bossType, killed, towerUsed) {
    const bm = GLOBAL_MEMORY.bossEncounters;
    if (!bm[bossType]) bm[bossType] = { encounters: 0, kills: 0, weaknessDiscovered: false };
    bm[bossType].encounters++;
    if (killed) {
      bm[bossType].kills++;
      if (towerUsed) bm[bossType].weaknessDiscovered = true;
    }
  }

  // ── Finalize a game ─────────────────────────────────────────────────────────
  finalizeGame(won) {
    GLOBAL_MEMORY.gamesPlayed++;
    const p = this.playerProfile;

    // Blend long-term tendencies
    for (const [type, count] of Object.entries(p.towerCounts)) {
      GLOBAL_MEMORY.playerTendencies[type] =
        ((GLOBAL_MEMORY.playerTendencies[type] || 0) * 0.6 + count * 0.4);
    }

    if (won && p.preferredStrategy) {
      const key = p.preferredStrategy;
      GLOBAL_MEMORY.strategyCounterHistory[key] =
        (GLOBAL_MEMORY.strategyCounterHistory[key] || 0) + 1;
    }
  }

  // ── Deep player analysis ────────────────────────────────────────────────────
  _analyzePlayer() {
    const counts = this.playerProfile.towerCounts;
    const total  = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) return;

    // Blend global tendencies (decayed) with current game
    const blended = { ...counts };
    for (const [type, val] of Object.entries(GLOBAL_MEMORY.playerTendencies)) {
      blended[type] = (blended[type] || 0) + val * CFG.crossGameMemoryDecay * 0.3;
    }

    // Dominant strategy
    let maxRatio = 0, dominant = null;
    const blendTotal = Object.values(blended).reduce((a, b) => a + b, 0);
    for (const [type, count] of Object.entries(blended)) {
      const r = count / blendTotal;
      if (r > maxRatio) { maxRatio = r; dominant = type; }
    }
    if (maxRatio > 0.28) this.playerProfile.preferredStrategy = dominant;

    // Compute spread score
    this.playerProfile.towerSpread = this._calculateTowerSpread();

    // Build weakness list
    const w = [];
    if ((counts.basic || 0) + (counts.sniper || 0) > (counts.cannon || 0) * 2.5) w.push('swarm');
    if (!counts.freeze || counts.freeze < 2) w.push('fast');
    if (!counts.sniper || counts.sniper < 2) w.push('armored');
    if (!counts.laser  || counts.laser  < 1) w.push('stealth');
    if ((counts.laser || 0) + (counts.freeze || 0) > (counts.sniper || 0) + (counts.cannon || 0)) w.push('boss_colossus');
    if (!counts.inferno && GLOBAL_MEMORY.gamesPlayed >= 2) w.push('boss_voidreaper');
    if (this.playerProfile.towerSpread < 0.3 && this.playerProfile.towerPositions.length > 4) w.push('spread');

    // Boost weaknesses the AI knows have worked historically
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
    let totalDist = 0, count = 0;
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

  // ── Generate wave ───────────────────────────────────────────────────────────
  generateWave(waveNumber, totalWaves, levelConfig) {
    this.currentWave = waveNumber;
    const baseCount     = 8 + waveNumber * 3;
    const hpMult        = 1 + waveNumber * CFG.enemyHpPerWave;
    const speedMult     = 1 + waveNumber * CFG.enemySpeedPerWave;
    const isBossWave    = !!this.bossWaves[waveNumber];
    const bossType      = this.bossWaves[waveNumber] || null;

    if (waveNumber <= CFG.minWavesBeforeAdapt) {
      const comp = waveNumber === 1
        ? [{ type:'basic', weight:10 }]
        : [{ type:'basic', weight:7 }, { type:'fast', weight:3 }];
      return this._buildWave(waveNumber, comp, baseCount, hpMult, speedMult,
        'Observing your tower placement...', bossType);
    }

    const plan = this._buildAdaptationPlan(waveNumber, bossType);
    const waveData = this._buildWave(waveNumber, plan.composition, baseCount, hpMult, speedMult, plan.message, bossType);

    this.adaptationLog.push({
      wave: waveNumber,
      strategy: this.playerProfile.preferredStrategy,
      weaknesses: [...this.playerProfile.weaknesses],
      bossType,
      message: plan.message,
    });
    return waveData;
  }

  // ── Minimum tower requirement calculation ───────────────────────────────────
  // AI determines the minimum towers you NEED to survive its strategy.
  // This is surfaced to the player as a warning.
  calcMinimumRequiredTowers(waveNumber, levelConfig) {
    const reqs = {};
    const w = this.playerProfile.weaknesses;
    const boss = this.bossWaves[waveNumber];

    if (boss) {
      const bDef = ENEMY_TYPES[boss];
      if (bDef) {
        reqs[bDef.weakness] = Math.max(reqs[bDef.weakness] || 0, 2);
        // Also recommend support
        if (bDef.phaseAt) reqs['freeze'] = Math.max(reqs['freeze'] || 0, 1);
      }
    }
    if (w.includes('swarm'))   reqs['cannon']  = Math.max(reqs['cannon']  || 0, 2);
    if (w.includes('fast'))    reqs['freeze']  = Math.max(reqs['freeze']  || 0, 2);
    if (w.includes('stealth')) reqs['laser']   = Math.max(reqs['laser']   || 0, 1);
    if (w.includes('armored')) reqs['sniper']  = Math.max(reqs['sniper']  || 0, 2);

    return reqs;
  }

  // ── Build adaptation plan ───────────────────────────────────────────────────
  _buildAdaptationPlan(waveNumber, bossType) {
    const { weaknesses, preferredStrategy } = this.playerProfile;

    if (weaknesses.length > 0 && this.waveHistory.length >= 2) {
      const targeted = weaknesses.find(w => (this.exploitAttempts[w] || 0) < CFG.maxExploitAttempts)
        || weaknesses[0];
      this.exploitAttempts[targeted] = (this.exploitAttempts[targeted] || 0) + 1;
      return this._exploitWeakness(targeted, waveNumber);
    }
    if (preferredStrategy) return this._counterStrategy(preferredStrategy, waveNumber);
    return this._escalationWave(waveNumber);
  }

  _exploitWeakness(weakness, waveNumber) {
    const plans = {
      swarm:           { composition:[{type:'swarm',weight:8},{type:'basic',weight:2},{type:'spread',weight:waveNumber>5?2:0}],
                         message:`AI Memory [${GLOBAL_MEMORY.gamesPlayed} games]: You struggle with swarms. Flooding with numbers.` },
      fast:            { composition:[{type:'fast',weight:7},{type:'swarm',weight:3}],
                         message:`AI Memory: No Cryo coverage detected. High-speed raid incoming.` },
      armored:         { composition:[{type:'armored',weight:6},{type:'basic',weight:4}],
                         message:`AI Memory: Insufficient armor-pierce. Deploying armored column.` },
      stealth:         { composition:[{type:'stealth',weight:7},{type:'fast',weight:3}],
                         message:`AI Memory: No Laser towers. Stealth infiltrators will pass unseen.` },
      spread:          { composition:[{type:'fast',weight:4},{type:'stealth',weight:3},{type:'swarm',weight:5}],
                         message:`AI Memory: Clustered defenses. Multi-type flanking assault.` },
      boss_colossus:   { composition:[{type:'armored',weight:5},{type:'basic',weight:3},{type:'fast',weight:2}],
                         message:`AI Memory: Colossus incoming. Your anti-armor is insufficient.` },
      boss_voidreaper: { composition:[{type:'stealth',weight:5},{type:'armored',weight:3},{type:'fast',weight:2}],
                         message:`AI Memory: Void energy detected. Prepare for void-class vanguard.` },
    };
    return plans[weakness] || this._escalationWave(waveNumber);
  }

  _counterStrategy(strategy, waveNumber) {
    const counters = {
      basic:   { composition:[{type:'armored',weight:5},{type:'fast',weight:3},{type:'stealth',weight:2}],
                 message:`AI adapting to GUNNER spam: Mixed hard targets. Balance isn't enough.` },
      sniper:  { composition:[{type:'swarm',weight:8},{type:'fast',weight:4}],
                 message:`AI adapting to SNIPER spam: Volume overwhelms precision. Swarm rush.` },
      cannon:  { composition:[{type:'fast',weight:6},{type:'spread',weight:2},{type:'stealth',weight:2}],
                 message:`AI adapting to CANNON spam: Speed and stealth dodge your splash zones.` },
      laser:   { composition:[{type:'armored',weight:6},{type:'spread',weight:2}],
                 message:`AI adapting to LASER spam: Armor absorbs your beams. Heavy push.` },
      freeze:  { composition:[{type:'armored',weight:5},{type:'fast',weight:3}],
                 message:`AI adapting to CRYO spam: Cold-immune heavies lead the push.` },
      tesla:   { composition:[{type:'stealth',weight:6},{type:'spread',weight:3}],
                 message:`AI adapting to TESLA spam: Stealth units break your chain logic.` },
      inferno: { composition:[{type:'armored',weight:7},{type:'basic',weight:3}],
                 message:`AI adapting to INFERNO spam: Armor resists burn. Steel column incoming.` },
      vortex:  { composition:[{type:'fast',weight:5},{type:'stealth',weight:4}],
                 message:`AI adapting to VORTEX spam: Speed and stealth escape your gravity well.` },
    };
    return counters[strategy] || this._escalationWave(waveNumber);
  }

  _escalationWave(waveNumber) {
    const patterns = [
      [{type:'basic',weight:8},{type:'fast',weight:2}],
      [{type:'basic',weight:5},{type:'armored',weight:3},{type:'fast',weight:2}],
      [{type:'fast',weight:6},{type:'swarm',weight:4}],
      [{type:'armored',weight:4},{type:'basic',weight:4},{type:'stealth',weight:2}],
      [{type:'spread',weight:3},{type:'swarm',weight:5},{type:'fast',weight:2}],
    ];
    const gamesStr = GLOBAL_MEMORY.gamesPlayed > 0 ? ` [Run #${GLOBAL_MEMORY.gamesPlayed+1}]` : '';
    return {
      composition: patterns[waveNumber % patterns.length],
      message: `Wave ${waveNumber}${gamesStr}: Escalating pressure...`,
    };
  }

  // ── Build wave ──────────────────────────────────────────────────────────────
  _buildWave(waveNumber, composition, baseCount, hpMult, speedMult, message, bossType) {
    const validComp  = composition.filter(c => c.weight > 0 && ENEMY_TYPES[c.type]);
    const totalWeight = validComp.reduce((s, c) => s + c.weight, 0);
    const enemies = [];
    let globalDelay = 0;

    for (const entry of validComp) {
      const count = Math.max(1, Math.round((entry.weight / totalWeight) * baseCount));
      for (let i = 0; i < count; i++) {
        enemies.push({
          type: entry.type,
          hpMult,
          speedMult,
          spawnDelay: globalDelay,
        });
        globalDelay += 42;
      }
    }

    // Boss appended at end of wave
    if (bossType && ENEMY_TYPES[bossType]) {
      enemies.push({
        type: bossType,
        hpMult: hpMult * ADMIN_CONFIG.ai.bossHpScaling,
        speedMult: 1,
        spawnDelay: globalDelay + 120,
        isBoss: true,
      });
    }

    return {
      waveNumber,
      enemies: enemies.sort((a, b) => a.spawnDelay - b.spawnDelay),
      message,
      bossType,
      totalEnemies: enemies.length,
    };
  }

  getAdaptationSummary() {
    return {
      strategy:  this.playerProfile.preferredStrategy,
      weaknesses: this.playerProfile.weaknesses,
      towerCounts: { ...this.playerProfile.towerCounts },
      gamesPlayed: GLOBAL_MEMORY.gamesPlayed,
      recentAdaptation: this.adaptationLog[this.adaptationLog.length - 1] || null,
    };
  }
}