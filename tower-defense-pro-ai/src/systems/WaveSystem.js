/**
 * WaveSystem.js — wave start, spawn queue, wave clear, wave-end XP.
 */

import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  TOWER_TYPES,
  ENEMY_TYPES,
  WAVE_MODIFIERS,
  BOSS_MUTATIONS,
  ADMIN_CONFIG,
} from "../gameConstants.js";
import { getEndlessWaveModifiers } from "../helpers/endlessMechanics.js";
import { SpawnCamp } from "../SpawnCamp.js";
import { RenderSystem } from "./RenderSystem.js";

const VCFG = ADMIN_CONFIG.visual;
const ECFG = ADMIN_CONFIG.economy;

export class WaveSystem {
  constructor(engine) {
    this.engine = engine;
  }

  pickWeightedModifier() {
    const total = WAVE_MODIFIERS.reduce((s, m) => s + (m.weight || 1), 0);
    let roll = Math.random() * total;
    for (const m of WAVE_MODIFIERS) {
      roll -= m.weight || 1;
      if (roll <= 0) return m;
    }
    return WAVE_MODIFIERS[WAVE_MODIFIERS.length - 1];
  }

  startWave() {
    const engine = this.engine;
    if (engine.state !== "idle") return;
    engine.wave++;

    engine.endlessWaveMods = engine.isEndless
      ? getEndlessWaveModifiers(engine.wave)
      : null;
    if (engine.waveAI) {
      engine.waveAI._endlessMods = engine.endlessWaveMods;
    }

    engine.audio?.onWaveStart(engine.wave);

    // ── Scale tower HP with waves so late-game towers survive longer ──────
    if (engine.wave > 1) {
      const hpScale = 1 + engine.wave * 0.018; // +1.8% max HP per wave
      for (const tower of engine.towers) {
        const newMax = Math.floor(TOWER_TYPES[tower.type].towerMaxHp * hpScale);
        if (newMax > tower.maxHp) {
          const diff = newMax - tower.maxHp;
          tower.maxHp = newMax;
          tower.hp = Math.min(tower.maxHp, tower.hp + diff); // heal the difference
          tower.repairCost = Math.ceil(
            ((tower.maxHp - tower.hp) / tower.maxHp) * tower.cost * 0.4,
          );
        }
      }
    }

    if (engine.isEndless && engine.wave % 10 === 0 && engine.wave > 0) {
      const bonusPool = [
        { type: "gold", value: 0.2, label: "💰 +20% gold drops" },
        { type: "damage", value: 0.15, label: "⚔️ +15% tower damage" },
        { type: "range", value: 0.12, label: "🔭 +12% tower range" },
        { type: "fireRate", value: 0.12, label: "⚡ +12% fire rate" },
        { type: "damage", value: 0.2, label: "☢️ +20% tower damage" },
        { type: "gold", value: 0.3, label: "💰 +30% gold drops" },
      ];
      const bonusIdx = Math.floor(engine.wave / 10) - 1;
      engine.milestoneBonus = bonusPool[bonusIdx % bonusPool.length];
      engine._addFloatingText(
        engine.canvas.width / 2,
        engine.canvas.height / 2 - 30,
        `⚡ WAVE ${engine.wave} MILESTONE: ${engine.milestoneBonus.label}`,
        "#fbbf24",
      );
    }

    // ── Roll wave modifier every 10 waves ────────────────────────────────────
    engine.activeModifier = null;
    engine.activeMapBonus = engine.mapDef?.mapBonus || null;
    if (engine.milestoneBonus) engine.activeMapBonus = engine.milestoneBonus;

    // silenced tower type settings
    engine.silencedTowerType = null;
    if (engine.wave % 10 === 0) {
      // Use pre-rolled modifier if available, otherwise roll fresh
      engine.activeModifier =
        engine._incomingModifier || engine.waveSystem.pickWeightedModifier();
      engine._incomingModifier = null;
      engine.runStats.modifiersFaced.push(engine.activeModifier.id);

      if (engine.activeModifier.apply?.silenceRandom) {
        const silenceable = engine.levelConfig.unlockedTowers.filter(
          (t) => t !== "laser", // never silence laser (stealth would be unbeatable)
        );
        engine.silencedTowerType =
          silenceable[Math.floor(Math.random() * silenceable.length)];
      }

      // ── Dual-front setup ──────────────────────────────────────────────────
      // Clean up any leftover camp from a previous wave
      if (engine.secondSpawnCamp) {
        engine.spawnCamps = engine.spawnCamps.filter(
          (c) => c !== engine.secondSpawnCamp,
        );
        engine.secondSpawnCamp = null;
        engine._secondPath = null;
      }

      if (engine.activeModifier?.apply?.dualFront) {
        // Pick a second entry point on the OPPOSITE vertical edge from the first
        const firstRow = engine.mapDef.waypoints[0].row;
        const secondRow =
          firstRow < GRID_ROWS / 2
            ? Math.floor(GRID_ROWS * 0.75) // first is top-half → second is bottom
            : Math.floor(GRID_ROWS * 0.25); // first is bottom-half → second is top

        // Build a short 3-waypoint path: left edge → mid-column → join main path
        const midCol = Math.floor(GRID_COLS * 0.45);
        const joinIdx = Math.floor(engine.path.length * 0.55); // join ~55% along main path
        const joinPt = engine.path[joinIdx];

        engine._secondPath = engine._buildPath([
          { col: 0, row: secondRow },
          { col: midCol, row: secondRow },
          {
            col: Math.floor(joinPt.x / CELL_SIZE),
            row: Math.floor(joinPt.y / CELL_SIZE),
          },
          // remaining waypoints from the join point onward (reuse main path exit)
          ...engine.mapDef.waypoints.slice(
            engine.mapDef.waypoints.findIndex(
              (wp) => Math.abs(wp.col - Math.floor(joinPt.x / CELL_SIZE)) <= 3,
            ),
          ),
        ]);

        // Clamp to the last map waypoint so enemies always exit properly
        if (!engine._secondPath || engine._secondPath.length < 4) {
          // Fallback: simple straight path from second row to the kingdom
          const lastWp =
            engine.mapDef.waypoints[engine.mapDef.waypoints.length - 1];
          engine._secondPath = engine._buildPath([
            { col: 0, row: secondRow },
            { col: midCol, row: secondRow },
            { col: lastWp.col, row: lastWp.row },
          ]);
        }

        // Build second path cell set so it renders on the grid
        engine.secondSpawnCamp = new SpawnCamp(
          engine._secondPath[0].x,
          engine._secondPath[0].y,
          1, // campIndex 1 → different visual tint
        );
        engine.spawnCamps.push(engine.secondSpawnCamp);

        engine._secondPathCells = new Set();
        for (let i = 0; i < engine._secondPath.length - 1; i++) {
          const a = engine._secondPath[i];
          const b = engine._secondPath[i + 1];
          const steps = Math.max(
            Math.abs(Math.floor(b.x / CELL_SIZE) - Math.floor(a.x / CELL_SIZE)),
            Math.abs(Math.floor(b.y / CELL_SIZE) - Math.floor(a.y / CELL_SIZE)),
          );
          for (let s = 0; s <= steps; s++) {
            const col = Math.round(
              Math.floor(a.x / CELL_SIZE) +
                ((Math.floor(b.x / CELL_SIZE) - Math.floor(a.x / CELL_SIZE)) *
                  s) /
                  Math.max(steps, 1),
            );
            const row = Math.round(
              Math.floor(a.y / CELL_SIZE) +
                ((Math.floor(b.y / CELL_SIZE) - Math.floor(a.y / CELL_SIZE)) *
                  s) /
                  Math.max(steps, 1),
            );
            engine._secondPathCells.add(`${col},${row}`);
          }
        }
      }
    }

    // ── Boss check + warning ──────────────────────────────────────────────────
    const bossType = engine.isEndless
      ? engine.waveAI._endlessBossForWave(engine.wave, engine.endlessWaveMods)
      : engine.levelConfig.bossWaves?.[engine.wave] || null;

    // Roll boss mutation (wave 30+)
    engine._pendingBossMutation = null;
    if (bossType && ENEMY_TYPES[bossType] && engine.wave >= 30) {
      const eligibleMutations = BOSS_MUTATIONS.filter((m) => {
        const minOk = !m.minWave || engine.wave >= m.minWave;
        const maxOk = !m.maxWave || engine.wave <= m.maxWave;
        return minOk && maxOk;
      });
      engine._pendingBossMutation =
        eligibleMutations[Math.floor(Math.random() * eligibleMutations.length)];
    }

    if (bossType && ENEMY_TYPES[bossType]) {
      engine.bossWarningType = bossType;
      engine.bossWarningMutation = engine._pendingBossMutation;
      engine.bossWarningTimer = VCFG.bossWarningFrames;
    }

    const waveData = engine.waveAI.generateWave(
      engine.wave,
      engine.levelConfig.waves,
      engine.levelConfig,
    );

    if (waveData.message && engine.wave > 2) {
      engine._aiTauntQueue.push({ text: waveData.message, life: 220 });
    }

    engine._eliteSpawnedCount = 0;
    engine.spawnQueue = [...waveData.enemies];

    // Apply double-time modifier
    if (engine.activeModifier?.apply?.enemyCountMult) {
      const mult = Math.floor(engine.activeModifier.apply.enemyCountMult);
      const original = [...engine.spawnQueue];
      for (let i = 1; i < mult; i++) {
        const lastDelay = original[original.length - 1]?.spawnDelay || 0;
        const offset = lastDelay + 120;
        engine.spawnQueue.push(
          ...original.map((e) => ({
            ...e,
            spawnDelay: e.spawnDelay + offset * i,
          })),
        );
      }
      engine.spawnQueue.sort((a, b) => a.spawnDelay - b.spawnDelay);
    }

    // Apply dual assault modifier — second enemy group with mirrored delays
    if (engine.activeModifier?.apply?.dualAssault) {
      const original = [...engine.spawnQueue];
      // Build a second group with staggered start so both groups run concurrently
      const lastDelay = original[original.length - 1]?.spawnDelay || 0;
      const secondGroup = original
        .filter((e) => !e.isBoss) // don't duplicate bosses
        .map((e) => ({
          ...e,
          spawnDelay: e.spawnDelay + Math.floor(lastDelay * 0.35) + 20,
        }));
      engine.spawnQueue.push(...secondGroup);
      engine.spawnQueue.sort((a, b) => a.spawnDelay - b.spawnDelay);
    }

    // Tag alternate enemies for the second spawn point (dual-front)
    if (engine.activeModifier?.apply?.dualFront && engine._secondPath) {
      engine.spawnQueue.forEach((e, idx) => {
        if (idx % 2 === 1) e._useSecondPath = true;
      });
    }

    engine.spawnTimer = 0;
    engine.waveKills = 0;
    engine.waveLeaks = 0;
    engine.waveDamageByTower = {};
    engine.waveGoldSpent = 0;
    for (const tower of engine.towers) {
      tower._waveKillsThisWave = 0;
    }
    engine.state = "wave";

    engine._waveStartTick = engine.tick;
    engine.nextWaveMessage = waveData.message;
    if (engine.wave >= 3 && waveData.message) {
      engine._aiTauntQueue.push({
        text: waveData.message.slice(0, 72),
        life: 240,
      });
    }
    engine.lastEnemyTypes = [...new Set(waveData.enemies.map((e) => e.type))];
    engine.minRequiredTowers = engine.waveAI.calcMinimumRequiredTowers(
      engine.wave + 1,
      engine.levelConfig,
    );
    engine._emitState();
  }

  tickSpawning() {
    const engine = this.engine;
    if (engine.tick % 120 === 0 && engine.state === "wave") {
      console.log(
        `[WaveWatch] wave ${engine.wave}, tick ${engine.tick} — spawnQueue=${engine.spawnQueue.length}, enemies=${engine.enemies.length}`,
      );
      if (engine.enemies.length > 0 && engine.spawnQueue.length === 0) {
        console.log(
          "  stuck enemies:",
          engine.enemies.map((e) => ({
            id: e.id,
            type: e.type,
            hp: Math.round(e.hp),
            pathIndex: e.pathIndex,
            stunTimer: e.stunTimer,
            speed: e.speed,
            isBoss: e.isBoss,
            altPath: !!e._altPath,
          })),
        );
      }
    }
    if (engine.spawnQueue.length === 0) return;
    engine.spawnTimer++;
    // Use absolute spawnDelay — check all enemies whose delay has been reached
    while (
      engine.spawnQueue.length > 0 &&
      engine.spawnTimer >= engine.spawnQueue[0].spawnDelay
    ) {
      engine.enemySystem.spawnEnemy(engine.spawnQueue.shift());
    }
  }

  checkWaveComplete() {
    const engine = this.engine;
    engine.enemySystem.checkLastStand();
    if (engine.state !== "wave") return;
    if (engine.spawnQueue.length > 0 || engine.enemies.length > 0) return;

    // Wave-end XP pass
    const waveXpBudget = 100 + engine.wave * 8;
    engine.waveSystem.grantWaveEndXp(waveXpBudget);

    engine._incomingModifier = null;
    if ((engine.wave + 1) % 10 === 0) {
      engine._incomingModifier = engine.waveSystem.pickWeightedModifier();
    }

    // Clear in-flight projectiles — prevents carry-over into next wave
    engine.projectiles = [];
    engine.boltEffects = [];

    // Clean up dual-front camp when wave ends
    if (engine.secondSpawnCamp) {
      engine.spawnCamps = engine.spawnCamps.filter(
        (c) => c !== engine.secondSpawnCamp,
      );
      engine.secondSpawnCamp = null;
      engine._secondPath = null;
      engine._secondPathCells = new Set();
    }

    engine.state = "idle";

    engine.audio?.onWaveComplete(engine.wave);

    // Gold Market wave-clear hooks (war bond payout, arms deal cleanup, etc.)
    engine.goldMarket?.onWaveClear(engine.waveLeaks);

    // Partial auto-repair between waves (20% HP restored, re-enable disabled)
    for (const tower of engine.towers) {
      const healed = tower.maxHp * 0.2;
      tower.hp = Math.min(tower.maxHp, tower.hp + healed);
      tower.repairCost = Math.ceil(
        ((tower.maxHp - tower.hp) / tower.maxHp) * tower.cost * 0.4,
      );
      if (tower.disabled && tower.hp > tower.maxHp * 0.15) {
        tower.disabled = false;
        engine._addFloatingText(tower.x, tower.y - 20, "↑ Repaired", "#4ade80");
      }
    }

    const clearTime = Math.round((engine.tick - engine._waveStartTick) / 60);
    engine.lastWaveClearTime = clearTime;
    if (clearTime < engine.fastestWaveClear)
      engine.fastestWaveClear = clearTime;

    // ── Wave clear rewards (always fires) ─────────────────────────────────────
    engine.waveAI.recordWaveResults({
      enemiesKilled: engine.waveKills,
      enemiesLeaked: engine.waveLeaks,
      damageByTower: { ...engine.waveDamageByTower },
      goldSpent: engine.waveGoldSpent,
      wave: engine.wave,
    });

    // Run stats
    engine.runStats.totalLeaks += engine.waveLeaks;
    if (engine.waveLeaks === 0) {
      engine.runStats.wavesNoLeak = (engine.runStats.wavesNoLeak || 0) + 1;
      engine._unlockAchievement("no_leak");
    }

    // Clear modifier
    engine.activeModifier = null;
    engine.silencedTowerType = null;
    engine._eliteSpawnedCount = 0;

    const bonus = ECFG.waveClearBonus + Math.sqrt(engine.wave) * 15;
    engine.gold += bonus;
    engine.runStats.goldEarned = (engine.runStats.goldEarned || 0) + bonus;
    engine._addFloatingText(
      engine.canvas.width / 2,
      engine.canvas.height / 2,
      `Wave ${engine.wave} Clear! +${Math.floor(bonus)}g`,
      "#4ade80",
    );

    // ── Determine Wave Hero Tower (always fires) ──────────────────────────────
    {
      const byKills = [...engine.towers].sort(
        (a, b) => (b._waveKillsThisWave || 0) - (a._waveKillsThisWave || 0),
      )[0];
      const byDamage = [...engine.towers].sort(
        (a, b) =>
          (engine.waveDamageByTower[b.type] || 0) -
          (engine.waveDamageByTower[a.type] || 0),
      )[0];

      const heroKills = byKills?._waveKillsThisWave || 0;
      const heroDmg = byDamage
        ? engine.waveDamageByTower[byDamage.type] || 0
        : 0;
      const heroTower =
        heroKills >= 3 ? byKills : heroDmg > 200 ? byDamage : null;

      if (heroTower) {
        const cDef = TOWER_TYPES[heroTower.type];
        const statStr =
          heroKills >= 3
            ? `${heroKills} kills`
            : `${Math.floor(heroDmg).toLocaleString()} dmg`;
        engine.vfx.addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 42,
          `${cDef?.icon || "🗼"} ${cDef?.name} MVP — ${statStr}`,
          "#fbbf24",
        );
        engine.lastWaveHeroTower = {
          type: heroTower.type,
          name: cDef?.name || heroTower.type,
          icon: cDef?.icon || "🗼",
          kills: heroKills,
          damage: Math.floor(heroDmg),
          col: heroTower.col,
          row: heroTower.row,
        };
      } else {
        engine.lastWaveHeroTower = null;
      }
    }

    // Speed bonus — clear under 20 seconds = extra gold
    if (clearTime > 0 && clearTime < 20 && engine.wave > 2) {
      const speedBonus = Math.floor(Math.max(0, 20 - clearTime) * 2.5);
      if (speedBonus > 0) {
        engine.gold += speedBonus;
        engine._addFloatingText(
          engine.canvas.width / 2,
          engine.canvas.height / 2 - 30,
          `⚡ Speed bonus +${speedBonus}g!`,
          "#38bdf8",
        );
        // Show which tower carried this wave
        const carryTower = [...engine.towers].sort(
          (a, b) => (b._waveKillsThisWave || 0) - (a._waveKillsThisWave || 0),
        )[0];
        if (carryTower && (carryTower._waveKillsThisWave || 0) > 3) {
          const cDef = TOWER_TYPES[carryTower.type];
          engine._addFloatingText(
            engine.canvas.width / 2,
            engine.canvas.height / 2 - 28,
            `${cDef?.icon || "🗼"} ${cDef?.name} MVP — ${carryTower._waveKillsThisWave} kills`,
            "#fbbf24",
          );
        }
      }
    }

    engine.minRequiredTowers = engine.waveAI.calcMinimumRequiredTowers(
      engine.wave + 1,
      engine.levelConfig,
    );

    // Check achievements
    engine._checkAchievements();

    if (!engine.isEndless && engine.wave >= engine.levelConfig.waves) {
      engine.state = "victory";
      engine.waveAI.finalizeGame(true);
      engine.audio?.onVictory();
      if (engine.lives === engine.levelConfig.startLives)
        engine._unlockAchievement("perfect_run");
    }
    engine._emitState();
  }

  grantWaveEndXp(budget) {
    const engine = this.engine;
    const effectiveXpMult = engine.isEndless
      ? engine.xpMult * Math.max(0.5, 1 - (engine.wave - 1) * 0.005)
      : engine.xpMult;

    for (const tower of engine.towers) {
      let xp = 0;
      const role = TOWER_TYPES[tower.type]?.category;

      if (role === "attack") {
        // Kills * flat rate, capped at budget/towerCount
        const killShare = Math.min(tower.kills, 40);
        xp = killShare * 1.2;
      } else if (role === "support") {
        if (tower.type === "freeze") {
          // XP for unique enemies slowed this wave
          const slowHits = Math.min(tower._waveSlowHits || 0, 60);
          xp = slowHits * 0.8;
        } else if (tower.type === "vortex") {
          // XP for pulls executed this wave
          const pulls = Math.min(tower._wavePulls || 0, 80);
          xp = pulls * 0.75;
        }
      } else if (role === "tech") {
        if (tower.type === "laser") {
          // XP for unique enemies hit (coverage, not overkill)
          const uniqueHits = Math.min(tower._waveHits?.size || 0, 50);
          xp = uniqueHits * 1.0;
        } else if (tower.type === "tesla") {
          // XP for unique enemies chained to
          const uniqueHits = Math.min(tower._waveHits?.size || 0, 40);
          xp = uniqueHits * 1.1;
        }
      }

      // Boss participation bonus — flat, not damage-scaled
      if (tower._hitBoss) xp += 18;

      // Normalize against budget so no single tower hogs XP
      const maxPerTower = budget / Math.max(1, engine.towers.length * 0.6);
      xp = Math.min(xp, maxPerTower);

      tower.xp += xp * effectiveXpMult;
      engine._checkTowerProgression(tower, engine.wave);

      // Reset wave trackers
      tower._waveHits = new Set();
      tower._waveSlowHits = 0;
      tower._wavePulls = 0;
      tower._hitBoss = false;
    }
  }
}
