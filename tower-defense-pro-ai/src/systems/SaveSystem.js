/**
 * SaveSystem.js
 * Serialises and restores game state. Isolated here so save-format
 * versioning doesn't pollute the rest of the engine.
 */

import { GRID_COLS, GRID_ROWS, ADMIN_CONFIG } from "../gameConstants.js";

const ECFG = ADMIN_CONFIG.economy;
import { Kingdom } from "../Kingdom.js";
import { SpawnCamp } from "../SpawnCamp.js";

const SAVE_VERSION = 1;

export class SaveSystem {
  constructor(engine) {
    this.engine = engine;
  }

  // ── Serialise ───────────────────────────────────────────────────────────────

  getSaveState() {
    const engine = this.engine;
    return {
      version: SAVE_VERSION,
      timestamp: new Date().toISOString(),
      levelId: engine.levelId,
      savedMapKey: engine._currentMapKey,
      savedMapWaveRotation: engine.wave,
      wave: engine.wave,
      gold: engine.gold,
      lives: engine.lives,
      score: engine.score,
      fortifyLevel: engine.fortifyLevel,
      fortifyCost: engine.fortifyCost,
      selectedTowerType: engine.selectedTowerType,
      towerCatCounts: { ...engine.towerCatCounts },
      // Sets → arrays for JSON safety
      towers: engine.towers.map((t) => ({
        ...t,
        _waveHits: [],
        assistTowers: [],
      })),
      playerProfile: {
        ...engine.waveAI.playerProfile,
        towerPositions: [...engine.waveAI.playerProfile.towerPositions],
        weaknesses: [...engine.waveAI.playerProfile.weaknesses],
      },
      adaptationLog: [...engine.waveAI.adaptationLog],
    };
  }

  // ── Restore ─────────────────────────────────────────────────────────────────

  loadSaveState(save) {
    if (!save || save.version !== SAVE_VERSION) return false;

    const engine = this.engine;
    engine._applyLevel(save.levelId, save.savedMapKey || null);

    engine.wave = save.wave;
    engine.gold = save.gold;
    engine.lives = save.lives;
    engine.score = save.score;
    engine.fortifyLevel = save.fortifyLevel || 0;
    engine.fortifyCost = save.fortifyCost || ECFG.fortifyCostBase;
    engine.selectedTowerType =
      save.selectedTowerType || engine.levelConfig.unlockedTowers[0];
    engine.towerCatCounts = { ...save.towerCatCounts };

    // Restore towers — convert arrays back to Sets
    engine.towers = [];
    engine.grid = Array.from({ length: GRID_ROWS }, () =>
      Array(GRID_COLS).fill(null),
    );

    for (const st of save.towers) {
      const tower = { ...st, _waveHits: new Set(), assistTowers: new Set() };
      engine.towers.push(tower);
      engine.grid[tower.row][tower.col] = tower;
    }

    // Rebuild geometry from the restored map
    engine.path = engine._buildPath(engine.mapDef.waypoints);
    engine.pathCells = engine._buildPathCells(engine.mapDef.waypoints);

    const lastPt = engine.path[engine.path.length - 1];
    engine.kingdom = new Kingdom(lastPt.x, lastPt.y);
    engine.spawnCamps = [new SpawnCamp(engine.path[0].x, engine.path[0].y, 0)];

    if (save.playerProfile) {
      engine.waveAI.playerProfile = {
        ...save.playerProfile,
        towerPositions: save.playerProfile.towerPositions || [],
        weaknesses: save.playerProfile.weaknesses || [],
      };
      engine.waveAI.currentWave = save.wave;
      engine.waveAI.adaptationLog = save.adaptationLog || [];
    }

    engine.synergySystem.check();
    engine.state = "idle";
    engine._emitState();
    return true;
  }
}
