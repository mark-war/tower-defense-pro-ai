import { useEffect, useRef, useState, useCallback } from "react";
import { GameEngine } from "./GameEngine.js";
import { HUD } from "./HUD.jsx";
import { CELL_SIZE } from "./gameConstants.js";

const LS_SAVE = "towerDefense_save";
const LS_SCORES = "towerDefense_highScores";
const LS_PROFILE = "towerDefense_profile";

function defaultCommanderStats() {
  return {
    totalRuns: 0,
    totalWins: 0,
    bestWave: 0,
    bestScore: 0,
    favoriteTower: null,
    totalEnemiesDestroyed: 0,
  };
}

function normalizePlayerName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

function loadProfile() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PROFILE) || "null");
    if (!raw?.name) return null;
    return {
      name: normalizePlayerName(raw.name),
      stats: {
        ...defaultCommanderStats(),
        ...(raw.stats || {}),
      },
    };
  } catch {
    return null;
  }
}

function saveProfile(profile) {
  localStorage.setItem(LS_PROFILE, JSON.stringify(profile));
}

function getFavoriteTowerFromCounts(towerCounts) {
  let favoriteTower = null;
  let topCount = -1;

  for (const [towerType, count] of Object.entries(towerCounts || {})) {
    if (count > topCount) {
      favoriteTower = towerType;
      topCount = count;
    }
  }

  return favoriteTower;
}

function buildUpdatedProfile(profile, gameState) {
  const base = profile || {
    name: "Commander",
    stats: defaultCommanderStats(),
  };
  const prevStats = {
    ...defaultCommanderStats(),
    ...(base.stats || {}),
  };
  const towerCounts = gameState?.aiSummary?.towerCounts || {};
  const favoriteTower = getFavoriteTowerFromCounts(towerCounts);
  const enemiesDestroyedThisRun = (gameState?.towers || []).reduce(
    (sum, tower) => sum + (tower.kills || 0),
    0,
  );

  return {
    ...base,
    stats: {
      ...prevStats,
      totalRuns: prevStats.totalRuns + 1,
      totalWins: prevStats.totalWins + (gameState?.state === "victory" ? 1 : 0),
      bestWave: Math.max(prevStats.bestWave, gameState?.wave || 0),
      bestScore: Math.max(prevStats.bestScore, gameState?.score || 0),
      favoriteTower: favoriteTower || prevStats.favoriteTower || null,
      totalEnemiesDestroyed:
        prevStats.totalEnemiesDestroyed + enemiesDestroyedThisRun,
    },
  };
}

function loadScores() {
  try {
    return JSON.parse(localStorage.getItem(LS_SCORES) || "[]");
  } catch {
    return [];
  }
}

function addHighScore(entry) {
  const scores = loadScores();
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  const top = scores.slice(0, 10);
  localStorage.setItem(LS_SCORES, JSON.stringify(top));
  return top;
}

export default function App() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [gameState, setGameState] = useState(null);
  const [selectedTower, setSelected] = useState("basic");
  const [activeTab, setActiveTab] = useState("build");
  const [sellMode, setSellMode] = useState(false);
  const [currentLevel, setCurrentLevel] = useState(99);
  const [inspectedEnemy, setInspectedEnemy] = useState(null);
  const [highScores, setHighScores] = useState(loadScores);
  const [hasSave, setHasSave] = useState(() => !!localStorage.getItem(LS_SAVE));
  const [playerProfile, setPlayerProfile] = useState(loadProfile);
  const [profileName, setProfileName] = useState(() => loadProfile()?.name || "");
  const [saveToast, setSaveToast] = useState("");
  const scoreRecordedRef = useRef(false);

  // ── Boot ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(
      canvasRef.current,
      (s) => {
        setGameState({ ...s, selectedTowerCell: engine.selectedTowerCell });
      },
      99,
    );
    engineRef.current = engine;
    return () => engine.destroy();
  }, []);

  // ── High score — record once on game end ──────────────────────────────────────
  const gsState = gameState?.state;
  const gsScore = gameState?.score;
  const gsWave = gameState?.wave;
  const gsLevelName = gameState?.levelName;
  const gsLevelId = gameState?.levelId;

  useEffect(() => {
    if (
      (gsState === "gameover" || gsState === "victory") &&
      !scoreRecordedRef.current
    ) {
      scoreRecordedRef.current = true;
      const nextProfile = buildUpdatedProfile(playerProfile, gameState);
      saveProfile(nextProfile);
      const updated = addHighScore({
        playerName: nextProfile?.name || "Commander",
        score: gsScore,
        wave: gsWave,
        levelName: gsLevelName,
        levelId: gsLevelId,
        won: gsState === "victory",
        date: new Date().toLocaleDateString(),
      });
      // Defer state updates to avoid synchronous setState inside an effect body
      setTimeout(() => {
        setPlayerProfile(nextProfile);
        setHighScores(updated);
        localStorage.removeItem(LS_SAVE);
        setHasSave(false);
      }, 0);
    }
    if (gsState === "wave" || gsState === "idle") {
      scoreRecordedRef.current = false;
    }
  }, [gsState, gsScore, gsWave, gsLevelName, gsLevelId, playerProfile, gameState]);

  // ── Save / Load ───────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.state !== "idle") {
      setSaveToast("⚠ Can only save between waves!");
      setTimeout(() => setSaveToast(""), 2500);
      return;
    }
    const data = eng.getSaveState();
    localStorage.setItem(LS_SAVE, JSON.stringify(data));
    setHasSave(true);
    setSaveToast("✔ Game saved!");
    setTimeout(() => setSaveToast(""), 2000);
  }, []);

  const handleLoad = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const raw = localStorage.getItem(LS_SAVE);
    if (!raw) return;
    try {
      const save = JSON.parse(raw);
      const ok = eng.loadSaveState(save);
      if (!ok) {
        setSaveToast("⚠ Save file incompatible.");
        setTimeout(() => setSaveToast(""), 2500);
        return;
      }
      setCurrentLevel(save.levelId);
      setSelected(save.selectedTowerType || "basic");
      setSellMode(false);
      setActiveTab("build");
      scoreRecordedRef.current = false;
      setSaveToast("✔ Game loaded!");
      setTimeout(() => setSaveToast(""), 2000);
    } catch (err) {
      console.error("Load failed", err);
      setSaveToast("⚠ Save data corrupt.");
      setTimeout(() => setSaveToast(""), 2500);
    }
  }, []);

  const handleDeleteSave = useCallback(() => {
    localStorage.removeItem(LS_SAVE);
    setHasSave(false);
    setSaveToast("Save deleted.");
    setTimeout(() => setSaveToast(""), 1800);
  }, []);

  const handleClearScores = useCallback(() => {
    localStorage.removeItem(LS_SCORES);
    setHighScores([]);
  }, []);

  const handleRegisterProfile = useCallback(() => {
    const normalized = normalizePlayerName(profileName);
    if (!normalized) {
      setSaveToast("Enter a commander name first.");
      setTimeout(() => setSaveToast(""), 2200);
      return;
    }
    const nextProfile = {
      name: normalized,
      stats: playerProfile?.stats || defaultCommanderStats(),
    };
    saveProfile(nextProfile);
    setPlayerProfile(nextProfile);
    setProfileName(normalized);
    setSaveToast(`Commander registered: ${normalized}`);
    setTimeout(() => setSaveToast(""), 2200);
  }, [profileName, playerProfile]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const eng = engineRef.current;
      if (!eng) return;
      // Pause: Space or P (not when typing in inputs)
      if (
        (e.code === "Space" || e.code === "KeyP") &&
        !["INPUT", "TEXTAREA"].includes(e.target.tagName)
      ) {
        e.preventDefault();
        eng.togglePause();
      }
      // Quick-save: Ctrl+S
      if (e.code === "KeyS" && e.ctrlKey) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line

  // ── Pause ─────────────────────────────────────────────────────────────────────
  const handlePause = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  // ── Cell coordinate helper ─────────────────────────────────────────────────────
  const getCell = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      col: Math.floor(((e.clientX - rect.left) * scaleX) / CELL_SIZE),
      row: Math.floor(((e.clientY - rect.top) * scaleY) / CELL_SIZE),
    };
  }, []);

  // ── Canvas click ───────────────────────────────────────────────────────────────
  const handleClick = useCallback(
    (e) => {
      if (!engineRef.current) return;
      if (gameState?.paused) return; // ignore clicks while paused

      const rect = canvasRef.current.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      if (gameState?.state === "wave") {
        const enemy = engineRef.current?.getEnemyAtPixel(px, py);
        if (enemy) {
          setInspectedEnemy(enemy);
          return;
        }
      }

      const { col, row } = getCell(e);
      if (sellMode) {
        engineRef.current.sellTower(col, row);
      } else if (activeTab === "upgrade") {
        engineRef.current.selectTowerCell(col, row);
        setGameState((s) => ({
          ...s,
          selectedTowerCell: engineRef.current.selectedTowerCell,
        }));
      } else {
        const placed = engineRef.current.placeTower(col, row);
        if (!placed && engineRef.current.grid[row]?.[col]) {
          engineRef.current.selectTowerCell(col, row);
          setActiveTab("upgrade");
          setGameState((s) => ({
            ...s,
            selectedTowerCell: engineRef.current.selectedTowerCell,
          }));
        }
      }
    },
    [sellMode, activeTab, getCell, gameState?.state, gameState?.paused],
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!engineRef.current) return;
      const { col, row } = getCell(e);
      engineRef.current.setHoveredCell(col, row);
    },
    [getCell],
  );

  const handleMouseLeave = useCallback(() => {
    engineRef.current?.setHoveredCell(-1, -1);
  }, []);

  // ── HUD handlers ───────────────────────────────────────────────────────────────
  const handleSelectTower = useCallback((type) => {
    setSelected(type);
    setSellMode(false);
    engineRef.current?.setSelectedTowerType(type);
    engineRef.current?.selectTowerCell(-1, -1);
  }, []);

  const handleSellMode = useCallback(() => setSellMode((m) => !m), []);

  const handleStartWave = useCallback(() => {
    engineRef.current?.startWave();
  }, []);

  const handleReset = useCallback(
    (levelId) => {
      if (!engineRef.current) return;
      const id = levelId || currentLevel;
      setCurrentLevel(id);
      setSellMode(false);
      scoreRecordedRef.current = false;
      engineRef.current.reset(id);
      const firstTower = engineRef.current.levelConfig?.unlockedTowers?.[0];
      if (firstTower) {
        setSelected(firstTower);
        engineRef.current.setSelectedTowerType(firstTower);
      }
      setGameState((s) => ({ ...s, selectedTowerCell: null }));
    },
    [currentLevel],
  );

  const handleLevelSelect = useCallback((levelId) => {
    setCurrentLevel(levelId);
    setSellMode(false);
    setActiveTab("build");
    scoreRecordedRef.current = false;
    engineRef.current?.reset(levelId);
    const firstTower = engineRef.current?.levelConfig?.unlockedTowers?.[0];
    if (firstTower) {
      setSelected(firstTower);
      engineRef.current?.setSelectedTowerType(firstTower);
    }
    setGameState((s) => ({ ...s, selectedTowerCell: null }));
  }, []);

  const handleSetTab = useCallback((tab) => setActiveTab(tab), []);

  const handleUpgrade = useCallback((col, row, tier, path) => {
    engineRef.current?.upgradeTower(col, row, tier, path);
  }, []);

  const handleTriggerAbility = useCallback((key) => {
    engineRef.current?.triggerAbility(key);
  }, []);

  const handleTowerCellClick = useCallback((col, row) => {
    if (!engineRef.current) return;
    engineRef.current.selectTowerCell(col, row);
    setGameState((s) => ({
      ...s,
      selectedTowerCell: engineRef.current.selectedTowerCell,
    }));
    setActiveTab("upgrade");
  }, []);

  const handleFortify = useCallback(() => {
    engineRef.current?.fortify();
  }, []);

  const getCursor = () => {
    if (gameState?.paused) return "default";
    if (sellMode) return "cell";
    if (activeTab === "upgrade") return "pointer";
    return "crosshair";
  };

  return (
    <div
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#0a0a0f",
      }}
    >
      {/* Toast */}
      {saveToast && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            background: "#1e293b",
            border: "1px solid #38bdf8",
            borderRadius: 6,
            padding: "8px 18px",
            color: "#e2e8f0",
            fontFamily: "'Courier New', monospace",
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          {saveToast}
        </div>
      )}

      {!playerProfile && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(3, 6, 16, 0.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            style={{
              width: 360,
              maxWidth: "100%",
              background: "#0d1117",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "18px 18px 16px",
              color: "#e2e8f0",
              fontFamily: "'Courier New', monospace",
            }}
          >
            <div style={{ fontSize: 12, color: "#38bdf8", marginBottom: 6 }}>
              COMMANDER REGISTRATION
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: "bold",
                color: "#f8fafc",
                marginBottom: 8,
              }}
            >
              Claim your callsign
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#94a3b8",
                lineHeight: 1.5,
                marginBottom: 12,
              }}
            >
              Your commander name is stored locally and will be attached to high
              scores and run history on this machine.
            </div>
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRegisterProfile();
              }}
              placeholder="Commander Nova"
              maxLength={18}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 6,
                border: "1px solid #334155",
                background: "#111827",
                color: "#e2e8f0",
                fontFamily: "'Courier New', monospace",
                fontSize: 12,
                outline: "none",
                marginBottom: 12,
              }}
            />
            <button
              onClick={handleRegisterProfile}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 6,
                border: "1px solid #38bdf8",
                background: "#0b2236",
                color: "#38bdf8",
                fontFamily: "'Courier New', monospace",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Register Commander
            </button>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: "#060610",
          cursor: getCursor(),
        }}
      >
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            imageRendering: "pixelated",
          }}
        />
      </div>

      {/* HUD */}
      <HUD
        gameState={{ ...gameState, inspectedEnemy }}
        playerProfile={playerProfile}
        selectedTower={selectedTower}
        activeTab={activeTab}
        sellMode={sellMode}
        hasSave={hasSave}
        highScores={highScores}
        onSelectTower={handleSelectTower}
        onSellMode={handleSellMode}
        onStartWave={handleStartWave}
        onReset={handleReset}
        onLevelSelect={handleLevelSelect}
        onSetTab={handleSetTab}
        onUpgrade={handleUpgrade}
        onTriggerAbility={handleTriggerAbility}
        onTowerCellClick={handleTowerCellClick}
        onClearEnemyInspect={() => setInspectedEnemy(null)}
        onFortify={handleFortify}
        onPause={handlePause}
        onSave={handleSave}
        onLoad={handleLoad}
        onDeleteSave={handleDeleteSave}
        onClearScores={handleClearScores}
      />
    </div>
  );
}
