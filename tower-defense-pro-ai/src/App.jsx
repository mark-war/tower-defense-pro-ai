import { useEffect, useRef, useState, useCallback } from "react";
import { GameEngine } from "./GameEngine.js";
import { HUD } from "./HUD.jsx";
import { CELL_SIZE } from "./gameConstants.js";

const LS_SAVE = "towerDefense_save";
const LS_SCORES = "towerDefense_highScores";

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
      const updated = addHighScore({
        score: gsScore,
        wave: gsWave,
        levelName: gsLevelName,
        levelId: gsLevelId,
        won: gsState === "victory",
        date: new Date().toLocaleDateString(),
      });
      // Defer state updates to avoid synchronous setState inside an effect body
      setTimeout(() => {
        setHighScores(updated);
        localStorage.removeItem(LS_SAVE);
        setHasSave(false);
      }, 0);
    }
    if (gsState === "wave" || gsState === "idle") {
      scoreRecordedRef.current = false;
    }
  }, [gsState, gsScore, gsWave, gsLevelName, gsLevelId]);

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
