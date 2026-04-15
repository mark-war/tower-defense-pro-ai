import { useEffect, useRef, useState, useCallback } from "react";
import { GameEngine } from "./GameEngine.js";
import { HUD } from "./HUD.jsx";
import { CELL_SIZE } from "./gameConstants.js";

export default function App() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [gameState, setGameState] = useState(null);
  const [selectedTower, setSelected] = useState("basic");
  const [activeTab, setActiveTab] = useState("build");
  const [sellMode, setSellMode] = useState(false);
  const [currentLevel, setCurrentLevel] = useState(1);

  // ── Boot engine ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, setGameState, 1);
    engineRef.current = engine;
    return () => engine.destroy();
  }, []);

  // ── Canvas interactions ──────────────────────────────────────────────────────
  const getCell = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      col: Math.floor(((e.clientX - rect.left) * scaleX) / CELL_SIZE),
      row: Math.floor(((e.clientY - rect.top) * scaleY) / CELL_SIZE),
    };
  };

  const handleClick = useCallback(
    (e) => {
      if (!engineRef.current) return;
      const { col, row } = getCell(e);
      if (sellMode) {
        engineRef.current.sellTower(col, row);
      } else {
        engineRef.current.placeTower(col, row);
      }
    },
    [sellMode],
  );

  const handleMouseMove = useCallback((e) => {
    if (!engineRef.current) return;
    const { col, row } = getCell(e);
    engineRef.current.setHoveredCell(col, row);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.setHoveredCell(-1, -1);
  }, []);

  // ── HUD callbacks ─────────────────────────────────────────────────────────
  const handleSelectTower = useCallback((type) => {
    setSelected(type);
    setSellMode(false);
    if (engineRef.current) engineRef.current.setSelectedTowerType(type);
  }, []);

  const handleSellMode = useCallback(() => {
    setSellMode((m) => !m);
  }, []);

  const handleStartWave = useCallback(() => {
    if (engineRef.current) engineRef.current.startWave();
  }, []);

  const handleReset = useCallback(
    (levelId) => {
      if (!engineRef.current) return;
      const lvlId = levelId || currentLevel;
      setCurrentLevel(lvlId);
      setSellMode(false);
      engineRef.current.reset(lvlId);
      // Select first unlocked tower
      const eng = engineRef.current;
      if (eng.levelConfig?.unlockedTowers?.[0]) {
        setSelected(eng.levelConfig.unlockedTowers[0]);
        eng.setSelectedTowerType(eng.levelConfig.unlockedTowers[0]);
      }
    },
    [currentLevel],
  );

  const handleLevelSelect = useCallback((levelId) => {
    setCurrentLevel(levelId);
    setSellMode(false);
    setActiveTab("build");
    if (engineRef.current) {
      engineRef.current.reset(levelId);
      const eng = engineRef.current;
      if (eng.levelConfig?.unlockedTowers?.[0]) {
        setSelected(eng.levelConfig.unlockedTowers[0]);
        eng.setSelectedTowerType(eng.levelConfig.unlockedTowers[0]);
      }
    }
  }, []);

  const handleSetTab = useCallback((tab) => setActiveTab(tab), []);

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
      {/* ── Canvas area ───────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: "#060610",
          cursor: sellMode ? "cell" : "crosshair",
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

      {/* ── HUD ──────────────────────────────────────────────────────────── */}
      <HUD
        gameState={gameState}
        selectedTower={selectedTower}
        activeTab={activeTab}
        sellMode={sellMode}
        onSelectTower={handleSelectTower}
        onSellMode={handleSellMode}
        onStartWave={handleStartWave}
        onReset={handleReset}
        onLevelSelect={handleLevelSelect}
        onSetTab={handleSetTab}
      />
    </div>
  );
}
