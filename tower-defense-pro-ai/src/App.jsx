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
  const [currentLevel, setCurrentLevel] = useState(99); // default to last level for easy testing
  const [inspectedEnemy, setInspectedEnemy] = useState(null);

  // ── Boot ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(
      canvasRef.current,
      (s) => {
        // Expose selectedTowerCell on state for HUD
        setGameState({ ...s, selectedTowerCell: engine.selectedTowerCell });
      },
      99, // default to last level for easy testing
    );
    engineRef.current = engine;
    return () => engine.destroy();
  }, []);

  // ── Cell coordinate helper ────────────────────────────────────────────────────
  const getCell = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      col: Math.floor(((e.clientX - rect.left) * scaleX) / CELL_SIZE),
      row: Math.floor(((e.clientY - rect.top) * scaleY) / CELL_SIZE),
    };
  }, []);

  // ── Canvas click ──────────────────────────────────────────────────────────────
  const handleClick = useCallback(
    (e) => {
      if (!engineRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // Check for enemy click first during wave
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
        // Click in upgrade mode: select tower for panel
        engineRef.current.selectTowerCell(col, row);
        setGameState((s) => ({
          ...s,
          selectedTowerCell: engineRef.current.selectedTowerCell,
        }));
      } else {
        const placed = engineRef.current.placeTower(col, row);
        if (!placed && engineRef.current.grid[row]?.[col]) {
          // Clicked an existing tower while in build mode → switch to upgrade tab and select it
          engineRef.current.selectTowerCell(col, row);
          setActiveTab("upgrade");
          setGameState((s) => ({
            ...s,
            selectedTowerCell: engineRef.current.selectedTowerCell,
          }));
        }
      }
    },
    [sellMode, activeTab, getCell, gameState?.state],
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

  // ── HUD handlers ─────────────────────────────────────────────────────────────
  const handleSelectTower = useCallback((type) => {
    setSelected(type);
    setSellMode(false);
    engineRef.current?.setSelectedTowerType(type);
    engineRef.current?.selectTowerCell(-1, -1); // deselect
  }, []);

  const handleSellMode = useCallback(() => {
    setSellMode((m) => !m);
  }, []);

  const handleStartWave = useCallback(() => {
    engineRef.current?.startWave();
  }, []);

  const handleReset = useCallback(
    (levelId) => {
      if (!engineRef.current) return;
      const id = levelId || currentLevel;
      setCurrentLevel(id);
      setSellMode(false);
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
    if (!engineRef.current) return;
    engineRef.current.upgradeTower(col, row, tier, path);
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

  const getCursor = () => {
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
      />
    </div>
  );
}
