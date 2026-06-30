import { useEffect, useRef, useState, useCallback } from "react";
import { GameEngine } from "./GameEngine.js";
import { HUD } from "./HUD.jsx";
import {
  CELL_SIZE,
  ACHIEVEMENTS,
  MAPS,
  TOWER_TYPES,
  TOWER_UPGRADES,
  ENEMY_TYPES,
  ADMIN_CONFIG,
  MARKET_UNLOCK_WAVE,
} from "./gameConstants.js";
import MapSelectScreen from "./MapSelectScreen.jsx";

const LS_SAVE = "towerDefense_save";
const LS_SCORES = "towerDefense_highScores";
const LS_PROFILE = "towerDefense_profile";
const LS_ACHIEVE = "towerDefense_achievements";

const mono = "'Courier New', monospace";

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

function loadAchievements() {
  try {
    return JSON.parse(localStorage.getItem(LS_ACHIEVE) || "{}");
  } catch {
    return {};
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

const isTouchDevice =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0);

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
  const [unlockedAchievements, setUnlockedAchievements] =
    useState(loadAchievements);
  const [hasSave, setHasSave] = useState(() => !!localStorage.getItem(LS_SAVE));
  const [saveToast, setSaveToast] = useState("");
  const [loadWarning, setLoadWarning] = useState(false);
  const [achievementToast, setAchievementToast] = useState(null);
  const [showRunSummary, setShowRunSummary] = useState(false);
  const [playerProfile, setPlayerProfile] = useState(loadProfile);
  const [profileName, setProfileName] = useState(
    () => loadProfile()?.name || "",
  );
  const scoreRecordedRef = useRef(false);
  const achievementQueueRef = useRef([]);
  const toastTimerRef = useRef(null);

  const hudRef = useRef(null);

  const [showAchievements, setShowAchievements] = useState(false);

  // ── HUD visibility and mobile state ──────────────────────────────────────────────────────────
  const [hudVisible, setHudVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => isTouchDevice || window.innerWidth < 1024,
  );

  // ── Map select state ──────────────────────────────────────────────────────────
  const [showMapSelect, setShowMapSelect] = useState(false);
  const pendingLevelIdRef = useRef(null); // level to reset to after map chosen

  // ── Bottom Bar state ──────────────────────────────────────────────────────────
  const [bottomBarVisible, setBottomBarVisible] = useState(true);
  const bottomBarTimerRef = useRef(null);

  const marketUnlocked = (gameState?.wave ?? 0) >= MARKET_UNLOCK_WAVE;

  const hudTabs = [
    { id: "build", icon: "🔨", label: "Build" },
    { id: "upgrade", icon: "⬆️", label: "Upgrade" },

    ...(marketUnlocked ? [{ id: "market", icon: "💰", label: "Market" }] : []),

    { id: "intel", icon: "🧠", label: "Intel" },
    { id: "levels", icon: "🗺️", label: "Levels" },
  ];

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

  useEffect(() => {
    if (!gameState?.state) return;
    if (gameState.state === "idle" && gameState.wave > 0) {
      setTimeout(() => setShowAchievements(true), 0);
      setTimeout(() => setHudVisible(true), 0);
    }
    if (gameState.state === "wave") {
      setTimeout(() => setShowAchievements(false), 0);
      // don't hide HUD on wave start — player may still be looking at upgrades
    }
  }, [gameState?.state, gameState?.wave]);

  // Load saved skin preference (safe version)
  useEffect(() => {
    const savedSkin = localStorage.getItem("towerDefense_activeSkin");
    if (!savedSkin) return;

    const engine = engineRef.current;
    if (!engine?.setActiveSkin) return;

    // Apply to engine first
    const success = engine.setActiveSkin(savedSkin);

    if (success) {
      // Use setTimeout to avoid synchronous setState in effect
      setTimeout(() => {
        setGameState((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            activeSkinId: savedSkin,
          };
        });
      }, 0);
    }
  }, []); // Empty dependency array is fine here

  // ── Mobile Resize ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(isTouchDevice || window.innerWidth < 1024);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const showBottomBar = useCallback(() => {
    clearTimeout(bottomBarTimerRef.current);
    setBottomBarVisible(true);

    // Only auto-hide during a wave
    if (gameState?.state === "wave") {
      bottomBarTimerRef.current = setTimeout(() => {
        setBottomBarVisible(false);
      }, 3000);
    }
  }, [gameState?.state]);

  useEffect(() => {
    if (
      gameState?.state === "idle" ||
      gameState?.state === "gameover" ||
      gameState?.state === "victory"
    ) {
      clearTimeout(bottomBarTimerRef.current);
      setTimeout(() => setBottomBarVisible(true), 0);
    }
    if (gameState?.state === "wave") {
      setTimeout(() => showBottomBar(), 0);
    }
  }, [gameState?.state, showBottomBar]);

  useEffect(() => {
    return () => clearTimeout(bottomBarTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isMobile) return; // desktop HUD is always visible, no need

    const handlePointerDown = (e) => {
      if (!hudVisible) return;
      // If click is outside the HUD drawer, close it
      if (hudRef.current && !hudRef.current.contains(e.target)) {
        setHudVisible(false);
      }
    };

    // Use pointerdown so it catches both mouse and touch
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isMobile, hudVisible]);

  // ── Achievement toast queue ──────────────────────────────────────────────────
  const isShowingToastRef = useRef(false);
  const showNextAchievementRef = useRef(null);

  const showNextAchievement = useCallback(() => {
    if (isShowingToastRef.current) return;
    if (achievementQueueRef.current.length === 0) return;
    const id = achievementQueueRef.current.shift();
    const def = ACHIEVEMENTS[id];
    if (!def) return;
    isShowingToastRef.current = true;
    setAchievementToast(def);
    toastTimerRef.current = setTimeout(() => {
      setAchievementToast(null);
      isShowingToastRef.current = false;
      setTimeout(() => showNextAchievementRef.current?.(), 300);
    }, 3500);
  }, []);

  useEffect(() => {
    showNextAchievementRef.current = showNextAchievement;
  }, [showNextAchievement]);

  // ── Watch for new achievements + game end ─────────────────────────────────────
  useEffect(() => {
    if (!gameState) return;
    const st = gameState.state;

    if (gameState.newAchievementId) {
      const id = gameState.newAchievementId;
      const stored = loadAchievements();
      if (!stored[id]) {
        stored[id] = { unlockedAt: new Date().toISOString() };
        localStorage.setItem(LS_ACHIEVE, JSON.stringify(stored));
        achievementQueueRef.current.push(id);
        setTimeout(() => {
          setUnlockedAchievements({ ...stored });
          if (!achievementToast) showNextAchievement();
        }, 0);
      }
    }

    if ((st === "gameover" || st === "victory") && !scoreRecordedRef.current) {
      scoreRecordedRef.current = true;
      const updated = addHighScore({
        score: gameState.score,
        wave: gameState.wave,
        levelName: gameState.levelName,
        levelId: gameState.levelId,
        won: st === "victory",
        date: new Date().toLocaleDateString(),
      });
      setTimeout(() => {
        setHighScores(updated);
        localStorage.removeItem(LS_SAVE);
        setHasSave(false);
        setShowRunSummary(true);
      }, 0);
    }
    if (st === "wave" || st === "idle") scoreRecordedRef.current = false;
  }, [gameState, achievementToast, showNextAchievement]);

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
  }, [
    gsState,
    gsScore,
    gsWave,
    gsLevelName,
    gsLevelId,
    playerProfile,
    gameState,
  ]);

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
    const isActive =
      eng.wave > 0 && !["gameover", "victory"].includes(eng.state);
    if (isActive && !loadWarning) {
      setLoadWarning(true);
      return;
    }
    setLoadWarning(false);
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
  }, [loadWarning]);

  // ── Keyboard shortcuts — driven by ADMIN_CONFIG.hotkeys ──────────────────────
  // All tower-type → select mappings live here too so they hot-reload with config.
  const TOWER_ORDER = [
    "basic",
    "sniper",
    "cannon",
    "laser",
    "freeze",
    "tesla",
    "inferno",
    "vortex",
    "missile",
  ];
  useEffect(() => {
    const HK = ADMIN_CONFIG.hotkeys;
    const onKey = (e) => {
      const eng = engineRef.current;
      if (!eng) return;
      // Never fire inside text inputs
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;

      const { code, ctrlKey, metaKey } = e;

      // ── Pause / resume (always Space or P as fallback) ────────────────────
      if (
        code === HK.pauseResume ||
        code === "KeyP" ||
        (code === "Space" && !ctrlKey)
      ) {
        e.preventDefault();
        eng.togglePause();
        return;
      }

      // ── Save shortcuts ────────────────────────────────────────────────────
      if ((ctrlKey || metaKey) && code === "KeyS") {
        e.preventDefault();
        handleSave();
        return;
      }
      if (code === HK.save && !ctrlKey && !metaKey) {
        // bare S only if it's not the same as Ctrl+S above
        if (HK.save !== "KeyS") {
          e.preventDefault();
          handleSave();
          return;
        }
      }

      // ── Wave control ──────────────────────────────────────────────────────
      if (code === HK.startWave) {
        if (eng.state === "idle") {
          e.preventDefault();
          eng.startWave();
        }
        return;
      }
      if (code === HK.fastForward) {
        e.preventDefault();
        eng.toggleFastForward?.();
        return;
      }
      if (code === HK.fortify) {
        if (eng.state === "idle") {
          e.preventDefault();
          eng.fortify?.();
        }
        return;
      }

      // ── Ability keys ──────────────────────────────────────────────────────
      const abilityMap = {
        [HK.airstrike]: "airstrike",
        [HK.emp]: "emp",
        [HK.reinforce]: "reinforce",
        [HK.overload]: "overload",
        [HK.massRepair]: "mass_repair",
      };
      if (abilityMap[code]) {
        e.preventDefault();
        eng.triggerAbility(abilityMap[code]);
        return;
      }

      // ── Tower selection ───────────────────────────────────────────────────
      const towerKeyMap = {
        [HK.selectBasic]: "basic",
        [HK.selectSniper]: "sniper",
        [HK.selectCannon]: "cannon",
        [HK.selectLaser]: "laser",
        [HK.selectFreeze]: "freeze",
        [HK.selectTesla]: "tesla",
        [HK.selectInferno]: "inferno",
        [HK.selectVortex]: "vortex",
        [HK.selectMissile]: "missile",
      };
      if (towerKeyMap[code]) {
        const type = towerKeyMap[code];
        if (eng.levelConfig?.unlockedTowers?.includes(type)) {
          e.preventDefault();
          setSelected(type);
          setSellMode(false);
          eng.setSelectedTowerType(type);
          eng.selectTowerCell(-1, -1);
          setActiveTab("build");
        }
        return;
      }

      // ── Sell mode toggle ──────────────────────────────────────────────────
      if (code === HK.sellMode) {
        e.preventDefault();
        setSellMode((m) => !m);
        return;
      }

      // ── Tab switches ──────────────────────────────────────────────────────
      if (code === HK.tabBuild) {
        e.preventDefault();
        setActiveTab("build");
        return;
      }
      if (code === HK.tabUpgrade) {
        e.preventDefault();
        setActiveTab("upgrade");
        return;
      }
      if (code === HK.tabMarket) {
        e.preventDefault();
        setActiveTab("market");
        return;
      }
      if (code === HK.tabIntel) {
        e.preventDefault();
        setActiveTab("intel");
        return;
      }
      if (code === HK.tabLevels) {
        e.preventDefault();
        setActiveTab("levels");
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

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

  // ────────────────────────────────────────────────────────────────────────────
  const handleBuyMarketItem = useCallback((itemId) => {
    engineRef.current?.buyMarketItem(itemId);
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  const handleCancelOvercharge = useCallback(() => {
    engineRef.current?.cancelPendingOvercharge();
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // SKIN HANDLER
  const handleSetSkin = useCallback((skinId) => {
    const engine = engineRef.current;
    if (!engine) return;

    // Tell the engine to switch skin (this should update visuals immediately)
    const success = engine.setActiveSkin?.(skinId);

    if (success) {
      // Update React state so HUD reflects the change instantly
      setGameState((prev) => ({
        ...prev,
        activeSkinId: skinId,
      }));

      // Optional: Persist choice across refreshes
      try {
        localStorage.setItem("towerDefense_activeSkin", skinId);
      } catch (e) {
        console.warn("Failed to save skin preference", e);
      }
    } else {
      console.warn(`Skin "${skinId}" could not be applied`);
    }
  }, []);

  // ── Pause ─────────────────────────────────────────────────────────────────────
  const handlePause = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  // ── Continue ─────────────────────────────────────────────────────────────
  const handleContinue = useCallback(() => {
    const success = engineRef.current?.useContinue();

    if (!success) {
      setSaveToast("Not enough gold to continue.");
      setTimeout(() => setSaveToast(""), 2000);
    }
  }, []);

  // ── Give Up ─────────────────────────────────────────────────────────────
  const handleGiveUp = useCallback(() => {
    engineRef.current?.forceGameOver?.();
  }, []);

  // ── Fast Forward ─────────────────────────────────────────────────────────────
  const handleFastForward = useCallback(() => {
    engineRef.current?.toggleFastForward();
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
      showBottomBar();

      engineRef.current?.audio?.init();

      if (!engineRef.current) return;
      if (gameState?.paused) return;

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

      // Overcharge targeting mode — click a tower to apply
      if (gameState?.goldMarket?.pendingOvercharge) {
        engineRef.current.tryApplyOvercharge(col, row);
        return;
      }

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
        if (placed) {
          // ← switch to upgrade tab showing the tower just placed
          engineRef.current.selectTowerCell(col, row);
          setActiveTab("upgrade");
          setGameState((s) => ({
            ...s,
            selectedTowerCell: engineRef.current.selectedTowerCell,
          }));
        } else if (!placed && engineRef.current.grid[row]?.[col]) {
          engineRef.current.selectTowerCell(col, row);
          setActiveTab("upgrade");
          setGameState((s) => ({
            ...s,
            selectedTowerCell: engineRef.current.selectedTowerCell,
          }));
        }
      }
    },
    [
      sellMode,
      activeTab,
      getCell,
      gameState?.state,
      gameState?.paused,
      gameState?.goldMarket,
      showBottomBar,
    ],
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

  // ── HUD handlers ──────────────────────────────────────────────────────────────
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

  // ── Touch Handlers ──────────────────────────────────────────────────────────────
  const handleTouchStart = useCallback(
    (e) => {
      showBottomBar();
      if (!engineRef.current || gameState?.paused) return;
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvasRef.current.getBoundingClientRect();
      const px = touch.clientX - rect.left;
      const py = touch.clientY - rect.top;
      const scaleX = canvasRef.current.width / rect.width;
      const scaleY = canvasRef.current.height / rect.height;
      const col = Math.floor((px * scaleX) / CELL_SIZE);
      const row = Math.floor((py * scaleY) / CELL_SIZE);

      if (gameState?.state === "wave") {
        const enemy = engineRef.current?.getEnemyAtPixel(px, py);
        if (enemy) {
          setInspectedEnemy(enemy);
          return;
        }
      }
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
        if (placed) {
          // ← switch to upgrade tab showing the tower just placed
          engineRef.current.selectTowerCell(col, row);
          setActiveTab("upgrade");
          setGameState((s) => ({
            ...s,
            selectedTowerCell: engineRef.current.selectedTowerCell,
          }));
        } else if (!placed && engineRef.current.grid[row]?.[col]) {
          engineRef.current.selectTowerCell(col, row);
          setActiveTab("upgrade");
          setGameState((s) => ({
            ...s,
            selectedTowerCell: engineRef.current.selectedTowerCell,
          }));
        }
      }
    },
    [sellMode, activeTab, gameState?.state, gameState?.paused, showBottomBar],
  );

  const handleTouchMove = useCallback((e) => {
    if (!engineRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const col = Math.floor(((touch.clientX - rect.left) * scaleX) / CELL_SIZE);
    const row = Math.floor(((touch.clientY - rect.top) * scaleY) / CELL_SIZE);
    engineRef.current.setHoveredCell(col, row);
  }, []);

  // ── Level select — intercepts endless to show map picker ─────────────────────
  const _doReset = useCallback((levelId) => {
    if (!engineRef.current) return;
    setCurrentLevel(levelId);
    setSellMode(false);
    scoreRecordedRef.current = false;
    engineRef.current.reset(levelId);
    const firstTower = engineRef.current.levelConfig?.unlockedTowers?.[0];
    if (firstTower) {
      setSelected(firstTower);
      engineRef.current.setSelectedTowerType(firstTower);
    }
    setGameState((s) => ({ ...s, selectedTowerCell: null }));
  }, []);

  const handleReset = useCallback(
    (levelId) => {
      const id = levelId ?? currentLevel;
      if (id === 99) {
        // Endless — show map picker first
        pendingLevelIdRef.current = id;
        setShowMapSelect(true);
      } else {
        _doReset(id);
      }
    },
    [currentLevel, _doReset],
  );

  const handleLevelSelect = useCallback((levelId) => {
    setActiveTab("build");
    if (levelId === 99) {
      pendingLevelIdRef.current = levelId;
      setShowMapSelect(true);
    } else {
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
    }
  }, []);

  // ── Map select confirmed ──────────────────────────────────────────────────────
  const handleMapSelected = useCallback(
    (mapKey, mapDef) => {
      setShowMapSelect(false);
      const levelId = pendingLevelIdRef.current ?? 99;

      // First do a normal reset so the engine is clean
      _doReset(levelId);

      // Then swap the map definition in
      if (engineRef.current) {
        engineRef.current.startEndlessWithMap(mapKey, mapDef);
      }
    },
    [_doReset],
  );

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

  const handleRepairTower = useCallback((col, row) => {
    engineRef.current?.repairTower(col, row);
  }, []);

  const handleRepairAll = useCallback(() => {
    engineRef.current?.repairAllTowers();
  }, []);

  const handleFortify = useCallback(() => {
    engineRef.current?.fortify();
  }, []);

  const handleAutoRepair = useCallback(() => {
    engineRef.current?.toggleAutoRepair();
  }, []);

  const handleToggleSfx = useCallback(() => {
    engineRef.current?.toggleSfx();
  }, []);

  const handleToggleMusic = useCallback(() => {
    engineRef.current?.toggleMusic();
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
        position: "relative",
      }}
    >
      {/* ── Map select screen (renders over everything) ───────────────────── */}
      {showMapSelect && (
        <MapSelectScreen
          onSelect={handleMapSelected}
          onBack={() => setShowMapSelect(false)}
        />
      )}

      {/* Toast */}
      {saveToast && (
        <div
          style={{
            position: "fixed",
            top: 70,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            background: "#1e293b",
            border: "1px solid #38bdf8",
            borderRadius: 6,
            padding: "8px 18px",
            color: "#e2e8f0",
            fontFamily: mono,
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
              fontFamily: mono,
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
                fontFamily: mono,
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
                fontFamily: mono,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Register Commander
            </button>
          </div>
        </div>
      )}

      {/* ── Achievement toast ─────────────────────────────────────────────── */}
      {achievementToast && (
        <div
          style={{
            position: "fixed",
            bottom: 90,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            background: "#1a1a0a",
            border: "2px solid #fbbf24",
            borderRadius: 8,
            padding: "12px 20px",
            color: "#e2e8f0",
            fontFamily: mono,
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 0 30px rgba(251,191,36,0.3)",
            pointerEvents: "none",
            minWidth: 260,
          }}
        >
          <span style={{ fontSize: 28 }}>{achievementToast.icon}</span>
          <div>
            <div
              style={{
                fontSize: 10,
                color: "#fbbf24",
                letterSpacing: "0.1em",
                marginBottom: 2,
              }}
            >
              🏆 ACHIEVEMENT UNLOCKED
            </div>
            <div style={{ fontSize: 13, fontWeight: "bold" }}>
              {achievementToast.name}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>
              {achievementToast.desc}
            </div>
          </div>
        </div>
      )}

      {/* ── Load warning dialog ───────────────────────────────────────────── */}
      {loadWarning && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.80)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#0d1117",
              border: "2px solid #ef4444",
              borderRadius: 8,
              padding: "24px 28px",
              maxWidth: 320,
              fontFamily: mono,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
            <div
              style={{
                fontSize: 13,
                color: "#fca5a5",
                lineHeight: 1.7,
                marginBottom: 16,
              }}
            >
              Loading will <strong>discard your current run</strong>.<br />
              Wave {gameState?.wave} progress will be lost.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={handleLoad}
                style={{
                  padding: "8px 18px",
                  background: "#3a1a1a",
                  border: "1px solid #ef4444",
                  borderRadius: 5,
                  color: "#ef4444",
                  fontFamily: mono,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Yes, load anyway
              </button>
              <button
                onClick={() => setLoadWarning(false)}
                style={{
                  padding: "8px 18px",
                  background: "#1e293b",
                  border: "1px solid #475569",
                  borderRadius: 5,
                  color: "#94a3b8",
                  fontFamily: mono,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {gameState?.state === "continue_prompt" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 420,
              maxWidth: "90%",
              background: "#0d1117",
              border: "2px solid #fbbf24",
              borderRadius: 10,
              padding: 24,
              fontFamily: mono,
              textAlign: "center",
              color: "#e2e8f0",
            }}
          >
            <div
              style={{
                fontSize: 32,
                marginBottom: 10,
              }}
            >
              💀
            </div>

            <div
              style={{
                fontSize: 20,
                fontWeight: "bold",
                color: "#fbbf24",
                marginBottom: 12,
              }}
            >
              Continue?
            </div>

            <div
              style={{
                fontSize: 13,
                color: "#94a3b8",
                lineHeight: 1.6,
                marginBottom: 18,
              }}
            >
              Your defenses have fallen.
              <br />
              Spend gold to re-enter the battle.
            </div>

            <div
              style={{
                background: "#111827",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: 12,
                marginBottom: 18,
              }}
            >
              <div style={{ marginBottom: 6 }}>
                Cost:{" "}
                <strong style={{ color: "#facc15" }}>
                  {gameState.continueGoldCost} Gold
                </strong>
              </div>

              <div style={{ marginBottom: 6 }}>
                Lives Restored:{" "}
                <strong style={{ color: "#4ade80" }}>
                  {gameState.livesOnContinue ??
                    ADMIN_CONFIG.continueSystem.livesOnContinue}
                </strong>
              </div>

              <div>
                Continues Remaining:{" "}
                <strong style={{ color: "#38bdf8" }}>
                  {ADMIN_CONFIG.continueSystem.maxContinues -
                    (gameState.continueCount || 0)}
                </strong>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "center",
              }}
            >
              <button
                onClick={handleContinue}
                disabled={gameState.gold < gameState.continueGoldCost}
                style={{
                  padding: "10px 20px",
                  background:
                    gameState.gold >= gameState.continueGoldCost
                      ? "#0f2a0f"
                      : "#1e293b",
                  border: `1px solid ${
                    gameState.gold >= gameState.continueGoldCost
                      ? "#4ade80"
                      : "#475569"
                  }`,
                  borderRadius: 6,
                  color:
                    gameState.gold >= gameState.continueGoldCost
                      ? "#4ade80"
                      : "#64748b",
                  cursor:
                    gameState.gold >= gameState.continueGoldCost
                      ? "pointer"
                      : "not-allowed",
                  fontFamily: mono,
                }}
              >
                Continue
              </button>

              <button
                onClick={handleGiveUp}
                style={{
                  padding: "10px 20px",
                  background: "#3a1a1a",
                  border: "1px solid #ef4444",
                  borderRadius: 6,
                  color: "#ef4444",
                  cursor: "pointer",
                  fontFamily: mono,
                }}
              >
                Give Up
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Run Summary Modal ─────────────────────────────────────────────── */}
      {showRunSummary && gameState && (
        <RunSummaryModal
          gameState={gameState}
          highScores={highScores}
          onPlayAgain={() => {
            setShowRunSummary(false);
            handleReset(gameState.levelId);
          }}
          onLevels={() => {
            setShowRunSummary(false);
            setActiveTab("levels");
          }}
        />
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
        {/* Canvas inspect overlays — enemy + tower, shown over canvas on mobile */}
        {isMobile && gameState && (
          <CanvasInspectOverlay
            inspectedEnemy={inspectedEnemy}
            onClearEnemy={() => setInspectedEnemy(null)}
            selectedTowerObj={
              gameState.selectedTowerCell
                ? gameState.towers?.find(
                    (t) =>
                      t.col === gameState.selectedTowerCell.col &&
                      t.row === gameState.selectedTowerCell.row,
                  )
                : null
            }
            gameState={gameState}
            onUpgrade={(col, row, tier, path) => {
              engineRef.current?.upgradeTower(col, row, tier, path);
            }}
            onRepairTower={(col, row) =>
              engineRef.current?.repairTower(col, row)
            }
            onClearTower={() => {
              engineRef.current?.selectTowerCell(-1, -1);
              setGameState((s) => ({ ...s, selectedTowerCell: null }));
            }}
            onSetTab={(tab) => {
              setActiveTab(tab);
              setHudVisible(true); // ← slides HUD drawer open
            }}
          />
        )}
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={(e) => e.preventDefault()}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            imageRendering: "pixelated",
            touchAction: "none",
          }}
        />

        {/* ── FLOATING OVERLAY ── */}
        {gameState && (
          <>
            {/* Top bar — mobile visible */}
            {isMobile && (
              <div
                style={{
                  position: "fixed",
                  top: 10,
                  left: 10,
                  right: 10,
                  zIndex: 100,
                  display: "flex",
                  gap: 6,
                  pointerEvents: "none",
                }}
              >
                {[
                  { label: "GOLD", val: `${gameState.gold}g`, c: "#facc15" },
                  {
                    label: "LIVES",
                    val: gameState.lives,
                    c:
                      gameState.lives <= 3
                        ? "#ef4444"
                        : gameState.lives <= 7
                          ? "#f97316"
                          : "#4ade80",
                  },
                  {
                    label: "WAVE",
                    val: `${gameState.wave}/${gameState.totalWaves}`,
                    c: gameState.isEndless ? "#818cf8" : "#38bdf8",
                  },
                  {
                    label: "SCORE",
                    val:
                      gameState.score > 9999
                        ? `${Math.floor(gameState.score / 1000)}k`
                        : gameState.score,
                    c: "#a78bfa",
                  },
                ].map(({ label, val, c }) => (
                  <div
                    key={label}
                    style={{
                      flex: 1,
                      background: "rgba(6,6,16,0.82)",
                      border: "1px solid #1e293b",
                      borderRadius: 5,
                      padding: "4px 6px",
                      textAlign: "center",
                      fontFamily: mono,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 7,
                        color: "#475569",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {label}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: "bold", color: c }}>
                      {val}
                    </div>
                  </div>
                ))}

                {gameState.damagedTowerCount > 0 && (
                  <div
                    style={{
                      background: "rgba(239,68,68,0.15)",
                      border: "1px solid #7f1d1d",
                      borderRadius: 5,
                      padding: "4px 6px",
                      textAlign: "center",
                      fontFamily: mono,
                      minWidth: 44,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 7,
                        color: "#ef4444",
                        letterSpacing: "0.08em",
                      }}
                    >
                      DMG
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: "bold",
                        color: "#ef4444",
                      }}
                    >
                      {gameState.damagedTowerCount} 🔧
                    </div>
                  </div>
                )}

                {/* Auto-repair active indicator */}
                {gameState.autoRepair && (
                  <div
                    style={{
                      background: "rgba(74,222,128,0.12)",
                      border: "1px solid #166534",
                      borderRadius: 5,
                      padding: "4px 6px",
                      textAlign: "center",
                      fontFamily: mono,
                      minWidth: 44,
                      pointerEvents: "none",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 7,
                        color: "#4ade80",
                        letterSpacing: "0.08em",
                      }}
                    >
                      AUTO
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: "bold",
                        color: "#4ade80",
                      }}
                    >
                      🔧
                    </div>
                  </div>
                )}

                {/* HUD toggle — top right */}
                <button
                  onClick={() => setHudVisible((v) => !v)}
                  style={{
                    background: "rgba(6,6,16,0.82)",
                    border: "1px solid #334155",
                    borderRadius: 5,
                    color: "#94a3b8",
                    fontFamily: mono,
                    fontSize: 11,
                    cursor: "pointer",
                    padding: "4px 10px",
                    pointerEvents: "all",
                  }}
                >
                  {hudVisible ? "✕" : "☰"}
                </button>
              </div>
            )}

            {/* Bottom bar */}
            {isMobile && (
              <div
                style={{
                  position: "fixed",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  display: "flex",
                  flexDirection: "column",
                  transform: bottomBarVisible
                    ? "translateY(0)"
                    : "translateY(100%)",
                  transition: "transform 0.3s ease",
                  pointerEvents: bottomBarVisible ? "all" : "none",
                  background: "rgba(6,6,14,0.96)",
                  borderTop: "1px solid #1e293b",
                }}
              >
                {/* ── Tab row (mirrors HUD tabs) ─────────────────────────── */}
                <div
                  style={{ display: "flex", borderBottom: "1px solid #1e293b" }}
                >
                  {hudTabs.map((tab) => {
                    const tabColors = {
                      build: "#4ade80",
                      upgrade: "#fbbf24",
                      market: "#facc15",
                      intel: "#e879f9",
                      levels: "#38bdf8",
                    };
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setHudVisible(true);
                        }}
                        style={{
                          flex: 1,
                          padding: "5px 0",
                          fontSize: 9,
                          fontFamily: mono,
                          background: isActive ? "#1e293b" : "transparent",
                          color: isActive ? tabColors[tab.id] : "#475569",
                          border: "none",
                          borderBottom: isActive
                            ? `2px solid ${tabColors[tab.id]}`
                            : "2px solid transparent",
                          cursor: "pointer",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {tab.icon} {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* ── Ability row + action buttons ───────────────────────── */}
                <div
                  style={{
                    display: "flex",
                    gap: 5,
                    padding: "6px 8px 8px",
                    alignItems: "stretch",
                  }}
                >
                  {/* Abilities */}
                  <div style={{ display: "flex", gap: 4, flex: 1 }}>
                    {Object.entries(gameState.abilities || {}).map(
                      ([key, ab]) => {
                        const ready =
                          ab.cooldownLeft === 0 &&
                          gameState?.state === "wave" &&
                          gameState?.wave >=
                            (ab.unlocksAtWave != undefined
                              ? ab.unlocksAtWave
                              : 0);
                        const pct = Math.max(
                          0,
                          1 - ab.cooldownLeft / ab.cooldown,
                        );
                        return (
                          <button
                            key={key}
                            onClick={() => ready && handleTriggerAbility(key)}
                            title={ab.desc}
                            style={{
                              flex: 1,
                              padding: "4px 3px",
                              border: `1px solid ${ready ? ab.color : "#1e293b"}`,
                              borderRadius: 5,
                              background: ready
                                ? `rgba(6,6,16,0.88)`
                                : "rgba(6,6,16,0.72)",
                              color: ready ? ab.color : "#374151",
                              fontFamily: mono,
                              fontSize: 8,
                              cursor: ready ? "pointer" : "not-allowed",
                              textAlign: "center",
                              position: "relative",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                position: "absolute",
                                bottom: 0,
                                left: 0,
                                height: "2px",
                                width: `${pct * 100}%`,
                                background: ab.color,
                                borderRadius: 2,
                              }}
                            />
                            <div style={{ fontSize: 13 }}>{ab.icon}</div>
                            <div style={{ fontSize: 7 }}>{ab.name}</div>
                            <div style={{ fontSize: 6, color: "#475569" }}>
                              {ab.cooldownLeft > 0
                                ? `${Math.ceil(ab.cooldownLeft / 60)}s`
                                : "READY"}
                            </div>
                          </button>
                        );
                      },
                    )}
                  </div>

                  {/* Right side — state-dependent actions */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      minWidth: 96,
                    }}
                  >
                    {/* Between waves: Fortify + Save + Repair + Start Wave */}
                    {gameState.state === "idle" && (
                      <>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            onClick={handleFortify}
                            disabled={
                              gameState.gold < gameState.fortifyCost ||
                              gameState.fortifyLevel >=
                                gameState.maxFortifyLevel
                            }
                            style={{
                              flex: 1,
                              padding: "4px 6px",
                              background: "rgba(6,6,16,0.88)",
                              border: `1px solid ${gameState.gold >= gameState.fortifyCost && gameState.fortifyLevel < gameState.maxFortifyLevel ? "#fbbf24" : "#1e293b"}`,
                              borderRadius: 5,
                              color:
                                gameState.gold >= gameState.fortifyCost &&
                                gameState.fortifyLevel <
                                  gameState.maxFortifyLevel
                                  ? "#fbbf24"
                                  : "#374151",
                              fontFamily: mono,
                              fontSize: 8,
                              cursor:
                                gameState.gold >= gameState.fortifyCost &&
                                gameState.fortifyLevel <
                                  gameState.maxFortifyLevel
                                  ? "pointer"
                                  : "not-allowed",
                            }}
                          >
                            🏰{" "}
                            {gameState.fortifyLevel >= gameState.maxFortifyLevel
                              ? "MAX"
                              : `${gameState.fortifyCost}g`}
                          </button>
                          <button
                            onClick={handleSave}
                            style={{
                              flex: 1,
                              padding: "4px 6px",
                              background: "rgba(6,6,16,0.88)",
                              border: "1px solid #38bdf8",
                              borderRadius: 5,
                              color: "#38bdf8",
                              fontFamily: mono,
                              fontSize: 8,
                              cursor: "pointer",
                            }}
                          >
                            💾 Save
                          </button>
                        </div>

                        {gameState.damagedTowerCount > 0 && (
                          <button
                            onClick={handleRepairAll}
                            disabled={gameState.gold < gameState.repairAllCost}
                            style={{
                              padding: "3px 6px",
                              background: "rgba(6,6,16,0.88)",
                              border: `1px solid ${
                                gameState.gold >= gameState.repairAllCost
                                  ? "#4ade80"
                                  : "#1e293b"
                              }`,
                              borderRadius: 5,
                              color:
                                gameState.gold >= gameState.repairAllCost
                                  ? "#4ade80"
                                  : "#374151",
                              fontFamily: mono,
                              fontSize: 8,
                              cursor:
                                gameState.gold >= gameState.repairAllCost
                                  ? "pointer"
                                  : "not-allowed",
                            }}
                          >
                            🔧 Repair ({gameState.damagedTowerCount}){" "}
                            {gameState.repairAllCost}g
                          </button>
                        )}

                        <button
                          onClick={handleStartWave}
                          style={{
                            padding: "6px 8px",
                            background: "rgba(6,6,16,0.88)",
                            border: "1px solid #4ade80",
                            borderRadius: 5,
                            color: "#4ade80",
                            fontFamily: mono,
                            fontSize: 10,
                            fontWeight: "bold",
                            cursor: "pointer",
                            textAlign: "center",
                          }}
                        >
                          ▶ WAVE {gameState.wave + 1}
                          {gameState.bossWaves?.[gameState.wave + 1]
                            ? " 💀"
                            : ""}
                        </button>
                      </>
                    )}

                    {/* During wave: auto-repair + pause + fast-forward */}
                    {gameState.state === "wave" && (
                      <>
                        <button
                          onClick={handleAutoRepair}
                          style={{
                            padding: "4px 6px",
                            background: gameState.autoRepair
                              ? "rgba(74,222,128,0.15)"
                              : "rgba(6,6,16,0.88)",
                            border: `1px solid ${gameState.autoRepair ? "#4ade80" : "#334155"}`,
                            borderRadius: 5,
                            color: gameState.autoRepair ? "#4ade80" : "#475569",
                            fontFamily: mono,
                            fontSize: 8,
                            cursor: "pointer",
                            textAlign: "center",
                          }}
                        >
                          🔧 AUTO {gameState.autoRepair ? "ON" : "OFF"}
                        </button>

                        {/* SFX toggle */}
                        <button
                          onClick={handleToggleSfx}
                          style={{
                            padding: "5px 8px",
                            background: gameState.sfxEnabled
                              ? "rgba(56,189,248,0.12)"
                              : "rgba(6,6,16,0.88)",
                            border: `1px solid ${gameState.sfxEnabled ? "#38bdf8" : "#334155"}`,
                            borderRadius: 5,
                            color: gameState.sfxEnabled ? "#38bdf8" : "#475569",
                            fontFamily: mono,
                            fontSize: 9,
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 1,
                          }}
                        >
                          <span>{gameState.sfxEnabled ? "🔊" : "🔇"}</span>
                          <span style={{ fontSize: 7, color: "#475569" }}>
                            SFX
                          </span>
                        </button>

                        {/* Music toggle */}
                        <button
                          onClick={handleToggleMusic}
                          style={{
                            padding: "5px 8px",
                            background: gameState.musicEnabled
                              ? "rgba(167,139,250,0.12)"
                              : "rgba(6,6,16,0.88)",
                            border: `1px solid ${gameState.musicEnabled ? "#a78bfa" : "#334155"}`,
                            borderRadius: 5,
                            color: gameState.musicEnabled
                              ? "#a78bfa"
                              : "#475569",
                            fontFamily: mono,
                            fontSize: 9,
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 1,
                          }}
                        >
                          <span>{gameState.musicEnabled ? "🎵" : "🎵"}</span>
                          <span style={{ fontSize: 7, color: "#475569" }}>
                            MUS
                          </span>
                        </button>

                        <button
                          onClick={handlePause}
                          style={{
                            padding: "6px 8px",
                            background: "rgba(6,6,16,0.88)",
                            border: `1px solid ${gameState.paused ? "#4ade80" : "#fbbf24"}`,
                            borderRadius: 5,
                            color: gameState.paused ? "#4ade80" : "#fbbf24",
                            fontFamily: mono,
                            fontSize: 10,
                            fontWeight: "bold",
                            cursor: "pointer",
                            textAlign: "center",
                          }}
                        >
                          {gameState.paused ? "▶ RESUME" : "⏸ PAUSE"}
                        </button>

                        <button
                          onClick={handleFastForward}
                          style={{
                            padding: "4px 6px",
                            background:
                              gameState.speedMultiplier === 4
                                ? "rgba(239,68,68,0.2)"
                                : gameState.speedMultiplier === 2
                                  ? "rgba(251,191,36,0.15)"
                                  : "rgba(6,6,16,0.88)",
                            border: `1px solid ${
                              gameState.speedMultiplier === 4
                                ? "#ef4444"
                                : gameState.speedMultiplier === 2
                                  ? "#fbbf24"
                                  : "#334155"
                            }`,
                            borderRadius: 5,
                            color:
                              gameState.speedMultiplier === 4
                                ? "#ef4444"
                                : gameState.speedMultiplier === 2
                                  ? "#fbbf24"
                                  : "#64748b",
                            fontFamily: mono,
                            fontSize: 9,
                            cursor: "pointer",
                            textAlign: "center",
                          }}
                        >
                          {gameState.speedMultiplier === 4
                            ? "⏩ 4×"
                            : gameState.speedMultiplier === 2
                              ? "⏩ 2×"
                              : "▶ 1×"}
                        </button>
                      </>
                    )}

                    {/* Game over / victory */}
                    {(gameState.state === "gameover" ||
                      gameState.state === "victory") && (
                      <button
                        onClick={() => handleReset(gameState.levelId)}
                        style={{
                          padding: "6px 8px",
                          background: "rgba(6,6,16,0.88)",
                          border: `1px solid ${gameState.state === "victory" ? "#4ade80" : "#ef4444"}`,
                          borderRadius: 5,
                          color:
                            gameState.state === "victory"
                              ? "#4ade80"
                              : "#ef4444",
                          fontFamily: mono,
                          fontSize: 10,
                          fontWeight: "bold",
                          cursor: "pointer",
                        }}
                      >
                        ↺ AGAIN
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
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
        unlockedAchievements={unlockedAchievements}
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
        showAchievements={showAchievements}
        onToggleAchievements={() => setShowAchievements((s) => !s)}
        onRepairTower={handleRepairTower}
        onRepairAll={handleRepairAll}
        isMobile={isMobile}
        onFastForward={handleFastForward}
        hudVisible={isMobile ? hudVisible : true}
        onCloseHud={() => setHudVisible(false)}
        hudRef={hudRef}
        onToggleSfx={handleToggleSfx}
        onToggleMusic={handleToggleMusic}
        sfxEnabled={gameState?.sfxEnabled !== false}
        musicEnabled={gameState?.musicEnabled !== false}
        onBuyMarketItem={handleBuyMarketItem}
        onCancelOvercharge={handleCancelOvercharge}
        onSetSkin={handleSetSkin}
      />
    </div>
  );
}

// ─── Canvas Inspect Overlay ────────────────────────────────────────────────────────
function CanvasInspectOverlay({
  inspectedEnemy,
  onClearEnemy,
  selectedTowerObj,
  gameState,
  onUpgrade,
  onRepairTower,
  onClearTower,
  onSetTab,
}) {
  if (!inspectedEnemy && !selectedTowerObj) return null;
  const mono = "'Courier New', monospace";

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => {
          onClearEnemy?.();
          onClearTower?.();
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 490,
          background: "rgba(0,0,0,0.45)",
        }}
      />
      {/* Sheet */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 500,
          background: "#0f172a",
          borderTop: "2px solid #1e293b",
          borderRadius: "16px 16px 0 0",
          maxHeight: "70vh",
          overflowY: "auto",
          fontFamily: mono,
          boxShadow: "0 -8px 40px rgba(0,0,0,0.8)",
          animation: "slideUp 0.22s ease",
        }}
      >
        {/* Drag handle */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "10px 0 4px",
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "#334155",
            }}
          />
        </div>

        <div style={{ padding: "0 16px 24px" }}>
          {inspectedEnemy && (
            <CanvasEnemyCard enemy={inspectedEnemy} onClose={onClearEnemy} />
          )}
          {selectedTowerObj && (
            <CanvasTowerCard
              tower={selectedTowerObj}
              gold={gameState.gold}
              wave={gameState.wave}
              onUpgrade={onUpgrade}
              onRepairTower={onRepairTower}
              onClose={onClearTower}
              onFullUpgrade={() => {
                onSetTab("upgrade");
              }}
            />
          )}
        </div>
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </>
  );
}

function CanvasEnemyCard({ enemy, onClose }) {
  const mono = "'Courier New', monospace";
  const [showExtra, setShowExtra] = useState(false);
  const hpPct = Math.max(0, enemy.hp / enemy.maxHp);
  const def = ENEMY_TYPES[enemy.type];

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <span style={{ fontSize: 40 }}>{enemy.icon}</span>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 18,
                fontWeight: "bold",
                color: enemy.isBoss ? "#fca5a5" : "#ffffff",
              }}
            >
              {enemy.name}
            </span>
            {enemy.isBoss && (
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 7px",
                  background: "#3a0a0a",
                  color: "#ef4444",
                  border: "1px solid #7f1d1d",
                  borderRadius: 4,
                }}
              >
                BOSS 💀
              </span>
            )}
            {enemy.isElite && (
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 7px",
                  background: "#1a1400",
                  color: "#facc15",
                  border: "1px solid #facc15",
                  borderRadius: 4,
                }}
              >
                ELITE ⭐
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            {def?.desc}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 8,
            color: "#94a3b8",
            fontSize: 16,
            cursor: "pointer",
            padding: "6px 10px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Mutation banner */}
      {enemy.mutation && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            background: "#1a1400",
            border: "1px solid #fbbf24",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 24 }}>{enemy.mutation.icon}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: "bold", color: "#fbbf24" }}>
              🧬 {enemy.mutation.name}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
              {enemy.mutation.desc}
            </div>
          </div>
        </div>
      )}

      {/* HP bar */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "#94a3b8",
            marginBottom: 4,
          }}
        >
          <span>HP</span>
          <span style={{ color: "#e2e8f0", fontWeight: "bold" }}>
            {enemy.hp >= 1000
              ? `${(enemy.hp / 1000).toFixed(1)}k`
              : Math.ceil(enemy.hp)}
            {" / "}
            {enemy.maxHp >= 1000
              ? `${(enemy.maxHp / 1000).toFixed(1)}k`
              : enemy.maxHp}
          </span>
        </div>
        <div style={{ height: 8, background: "#1e293b", borderRadius: 4 }}>
          <div
            style={{
              height: "100%",
              borderRadius: 4,
              width: `${hpPct * 100}%`,
              background:
                hpPct > 0.55 ? "#4ade80" : hpPct > 0.28 ? "#facc15" : "#ef4444",
              transition: "width 0.15s",
            }}
          />
        </div>
      </div>

      {/* Core stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          marginBottom: 12,
        }}
      >
        {[
          {
            label: "ARMOR",
            val: enemy.armor > 0 ? `${Math.round(enemy.armor * 100)}%` : "None",
            color: enemy.armor > 0.3 ? "#fca5a5" : "#94a3b8",
          },
          {
            label: "SPEED",
            val: parseFloat(enemy.speed).toFixed(1),
            color: "#facc15",
          },
          {
            label: "PHASE",
            val: enemy.phaseTriggered ? "P2 🔥" : "P1",
            color: enemy.phaseTriggered ? "#ff4444" : "#94a3b8",
          },
        ].map(({ label, val, color }) => (
          <div
            key={label}
            style={{
              background: "#1e293b",
              borderRadius: 8,
              padding: "8px 10px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "#64748b",
                marginBottom: 3,
                letterSpacing: "0.06em",
              }}
            >
              {label}
            </div>
            <div style={{ fontSize: 15, fontWeight: "bold", color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Status effects */}
      <div
        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}
      >
        {enemy.slowTimer > 0 && (
          <span
            style={{
              fontSize: 11,
              padding: "3px 8px",
              background: "#a5f3fc22",
              color: "#a5f3fc",
              border: "1px solid #a5f3fc66",
              borderRadius: 5,
            }}
          >
            ❄ SLOWED
          </span>
        )}
        {enemy.stunTimer > 0 && (
          <span
            style={{
              fontSize: 11,
              padding: "3px 8px",
              background: "#fbbf2422",
              color: "#fbbf24",
              border: "1px solid #fbbf2466",
              borderRadius: 5,
            }}
          >
            ⚡ STUNNED
          </span>
        )}
        {enemy.burnTimer > 0 && (
          <span
            style={{
              fontSize: 11,
              padding: "3px 8px",
              background: "#f9741622",
              color: "#f97416",
              border: "1px solid #f9741666",
              borderRadius: 5,
            }}
          >
            🔥 BURNING{enemy.burnStacks > 1 ? ` ×${enemy.burnStacks}` : ""}
          </span>
        )}
        {enemy.stealth && (
          <span
            style={{
              fontSize: 11,
              padding: "3px 8px",
              background: "#a78bfa22",
              color: "#a78bfa",
              border: "1px solid #a78bfa66",
              borderRadius: 5,
            }}
          >
            👻 STEALTH
          </span>
        )}
      </div>

      {/* Toggle extra */}
      <button
        onClick={() => setShowExtra((v) => !v)}
        style={{
          width: "100%",
          padding: "10px",
          marginBottom: showExtra ? 12 : 0,
          background: "#1e293b",
          border: "1px solid #1e293b",
          borderRadius: 8,
          color: "#94a3b8",
          fontFamily: mono,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {showExtra ? "▲ Hide details" : "▼ More details"}
      </button>

      {showExtra && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Immunities / weakness */}
          {(def?.immunities?.length > 0 || def?.weakness) && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: "#64748b",
                  marginBottom: 6,
                  letterSpacing: "0.06em",
                }}
              >
                IMMUNITIES & WEAKNESS
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {def.immunities?.map((im) => (
                  <span
                    key={im}
                    style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      background: "#3a1a1a",
                      color: "#fca5a5",
                      border: "1px solid #7f1d1d",
                      borderRadius: 5,
                    }}
                  >
                    🚫 {TOWER_TYPES[im]?.name || im}
                  </span>
                ))}
                {def?.weakness && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      background: "#0f2a0f",
                      color: "#86efac",
                      border: "1px solid #166534",
                      borderRadius: 5,
                    }}
                  >
                    ✓ {TOWER_TYPES[def.weakness]?.name}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Active evolutions */}
          {enemy.activeEvolutions?.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: "#64748b",
                  marginBottom: 6,
                  letterSpacing: "0.06em",
                }}
              >
                EVOLUTIONS
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {enemy.activeEvolutions.map((evoId) => (
                  <span
                    key={evoId}
                    style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      background: "#1a0808",
                      color: "#fca5a5",
                      border: "1px solid #7f1d1d",
                      borderRadius: 5,
                    }}
                  >
                    {evoId.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {def?.tip && (
            <div
              style={{
                fontSize: 12,
                color: "#fbbf24",
                padding: "8px 10px",
                background: "#1a1a0a",
                borderRadius: 6,
                border: "1px solid #3a3000",
                lineHeight: 1.5,
              }}
            >
              💡 {def.tip}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CanvasTowerCard({
  tower,
  gold,
  wave,
  onUpgrade,
  onRepairTower,
  onClose,
  onFullUpgrade,
}) {
  const mono = "'Courier New', monospace";
  const [showExtra, setShowExtra] = useState(false);
  const def = TOWER_TYPES[tower.type];
  const upgDef = TOWER_UPGRADES[tower.type];
  if (!def) return null;

  const hpPct = tower.hp / tower.maxHp;
  const atkPerSec = (60 / Math.max(1, tower.fireRate)).toFixed(1);

  const tierLabel = tower.ascension200Unlocked
    ? "☄ A200"
    : tower.legendary100Unlocked
      ? "✦✦ L100"
      : tower.legendaryUnlocked
        ? "✦ L50"
        : tower.skill10chosen
          ? "T2"
          : tower.skill5chosen
            ? "T1"
            : `P${tower.passiveTier}`;
  const tierColor = tower.ascension200Unlocked
    ? "#c084fc"
    : tower.legendary100Unlocked
      ? "#ef4444"
      : tower.legendaryUnlocked
        ? "#f59e0b"
        : tower.skill10chosen
          ? "#fbbf24"
          : tower.skill5chosen
            ? "#38bdf8"
            : "#64748b";
  const tierBg = tower.ascension200Unlocked
    ? "#1a0a2e"
    : tower.legendary100Unlocked
      ? "#450a0a"
      : tower.legendaryUnlocked
        ? "#451a03"
        : tower.skill10chosen
          ? "#1a1400"
          : tower.skill5chosen
            ? "#0a1a2a"
            : "#1e293b";

  const dmgTypeColor =
    def.damageType === "magical"
      ? "#c4b5fd"
      : def.damageType === "hybrid"
        ? "#a5f3fc"
        : "#86efac";
  const dmgTypeLabel =
    def.damageType === "magical"
      ? "MAG"
      : def.damageType === "hybrid"
        ? "HYB"
        : "PHY";

  const nextUpgrade = (() => {
    if (!upgDef) return null;
    if (tower.upgradeReadyType === "skill5" && !tower.skill5chosen)
      return {
        type: "skill5",
        options: [upgDef.skill5?.A, upgDef.skill5?.B],
        paths: ["A", "B"],
      };
    if (tower.upgradeReadyType === "skill10" && !tower.skill10chosen)
      return {
        type: "skill10",
        options: [upgDef.skill10?.A, upgDef.skill10?.B],
        paths: ["A", "B"],
      };
    if (tower.upgradeReadyType === "legendary50" && !tower.legendaryUnlocked) {
      const cost = Math.floor(
        (upgDef.legendary50?.A?.cost || 0) * (1 + wave * 0.04),
      );
      return {
        type: "legendary50",
        options: [upgDef.legendary50?.A, upgDef.legendary50?.B],
        paths: ["A", "B"],
        scaledCost: cost,
      };
    }
    if (
      tower.upgradeReadyType === "legendary100" &&
      !tower.legendary100Unlocked
    ) {
      const cost = Math.floor(
        (upgDef.legendary100?.A?.cost || 0) * (1 + wave * 0.06),
      );
      return {
        type: "legendary100",
        options: [upgDef.legendary100?.A, upgDef.legendary100?.B],
        paths: ["A", "B"],
        scaledCost: cost,
      };
    }
    if (
      tower.upgradeReadyType === "ascension200" &&
      !tower.ascension200Unlocked
    ) {
      const cost = Math.floor(
        (upgDef.ascension200?.A?.cost || 0) * (1 + wave * 0.08) + gold * 0.1,
      );
      return {
        type: "ascension200",
        options: [upgDef.ascension200?.A, upgDef.ascension200?.B],
        paths: ["A", "B"],
        scaledCost: cost,
        isAscension: true,
      };
    }
    return null;
  })();

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <span style={{ fontSize: 40 }}>{def.icon}</span>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{ fontSize: 18, fontWeight: "bold", color: def.color }}
            >
              {def.name}
            </span>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                background: tierBg,
                color: tierColor,
                border: `1px solid ${tierColor}`,
                borderRadius: 4,
                fontWeight: "bold",
              }}
            >
              {tierLabel}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            {tower.kills} kills · {Math.floor(tower.xp)} xp
          </div>
        </div>
        <button
          onClick={onFullUpgrade}
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 8,
            color: "#94a3b8",
            fontSize: 12,
            cursor: "pointer",
            padding: "6px 10px",
            fontFamily: mono,
          }}
        >
          ⬆ Full
        </button>
        <button
          onClick={onClose}
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 8,
            color: "#94a3b8",
            fontSize: 16,
            cursor: "pointer",
            padding: "6px 10px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Core stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: 8,
          marginBottom: 12,
        }}
      >
        {[
          {
            label: "DMG",
            val: tower.currentDamage ?? Math.round(tower.damage),
            color: "#fca5a5",
          },
          { label: "ATK/s", val: atkPerSec, color: "#fb923c" },
          { label: "RANGE", val: Math.round(tower.range), color: "#38bdf8" },
          { label: "TYPE", val: dmgTypeLabel, color: dmgTypeColor },
        ].map(({ label, val, color }) => (
          <div
            key={label}
            style={{
              background: "#1e293b",
              borderRadius: 8,
              padding: "8px 6px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "#64748b",
                marginBottom: 3,
                letterSpacing: "0.06em",
              }}
            >
              {label}
            </div>
            <div style={{ fontSize: 15, fontWeight: "bold", color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* XP bar */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "#94a3b8",
            marginBottom: 4,
          }}
        >
          <span>XP</span>
          <span
            style={{
              color: tower.upgradeReady ? "#fbbf24" : "#94a3b8",
              fontWeight: tower.upgradeReady ? "bold" : "normal",
            }}
          >
            {tower.upgradeReady
              ? `✦ ${tower.upgradeReadyType?.replace(/([0-9]+)/, " $1").toUpperCase()} READY`
              : `${Math.floor(tower.xp)} xp`}
          </span>
        </div>
        <div style={{ height: 8, background: "#1e293b", borderRadius: 4 }}>
          <div
            style={{
              height: "100%",
              borderRadius: 4,
              width: `${Math.min(100, (tower.xp / (upgDef?.skill5?.xp || 999)) * 100)}%`,
              background: tower.upgradeReady ? "#fbbf24" : "#38bdf8",
            }}
          />
        </div>
      </div>

      {/* Damaged / repair */}
      {tower.hp < tower.maxHp && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            background: tower.disabled ? "#2a0a0a" : "#1a1400",
            border: `1px solid ${tower.disabled ? "#ef4444" : "#f97316"}`,
            borderRadius: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              color: tower.disabled ? "#ef4444" : "#f97316",
              marginBottom: 6,
            }}
          >
            <span>{tower.disabled ? "⚠ DISABLED" : "🔧 DAMAGED"}</span>
            <span style={{ color: "#94a3b8" }}>
              {Math.ceil(tower.hp)}/{tower.maxHp} HP
            </span>
          </div>
          <div
            style={{
              height: 6,
              background: "#1e293b",
              borderRadius: 3,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${hpPct * 100}%`,
                background:
                  hpPct > 0.6 ? "#4ade80" : hpPct > 0.3 ? "#facc15" : "#ef4444",
                borderRadius: 3,
              }}
            />
          </div>
          <button
            onClick={() => onRepairTower(tower.col, tower.row)}
            disabled={gold < (tower.repairCost || 0)}
            style={{
              width: "100%",
              padding: "8px",
              background:
                gold >= (tower.repairCost || 0) ? "#1a2a0a" : "#1e293b",
              border: `1px solid ${gold >= (tower.repairCost || 0) ? "#4ade80" : "#374151"}`,
              borderRadius: 6,
              fontFamily: mono,
              fontSize: 13,
              color: gold >= (tower.repairCost || 0) ? "#4ade80" : "#374151",
              cursor:
                gold >= (tower.repairCost || 0) ? "pointer" : "not-allowed",
            }}
          >
            🔧 Repair — {tower.repairCost || 0}g
          </button>
        </div>
      )}

      {/* Toggle extra stats */}
      <button
        onClick={() => setShowExtra((v) => !v)}
        style={{
          width: "100%",
          padding: "10px",
          marginBottom: showExtra ? 12 : 0,
          background: "#1e293b",
          border: "1px solid #1e293b",
          borderRadius: 8,
          color: "#94a3b8",
          fontFamily: mono,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {showExtra ? "▲ Hide stats" : "▼ More stats"}
      </button>

      {showExtra && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8,
            marginBottom: 12,
          }}
        >
          {[
            tower.splash > 0 && {
              label: "Splash",
              val: Math.round(tower.splash),
              color: "#f97316",
            },
            tower.slowFactor > 0 && {
              label: "Slow",
              val: `${Math.round(tower.slowFactor * 100)}%`,
              color: "#a5f3fc",
            },
            tower.burnDamage > 0 && {
              label: "Burn DMG",
              val: tower.burnDamage,
              color: "#ef4444",
            },
            tower.chainTargets > 0 && {
              label: "Chains",
              val: tower.chainTargets,
              color: "#fbbf24",
            },
            tower.armorPiercing && {
              label: "Pierce",
              val: "YES",
              color: "#86efac",
            },
            tower.homing && { label: "Homing", val: "YES", color: "#fca5a5" },
          ]
            .filter(Boolean)
            .map(({ label, val, color }) => (
              <div
                key={label}
                style={{
                  background: "#1e293b",
                  borderRadius: 8,
                  padding: "8px 6px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "#64748b",
                    marginBottom: 3,
                    letterSpacing: "0.06em",
                  }}
                >
                  {label}
                </div>
                <div style={{ fontSize: 14, fontWeight: "bold", color }}>
                  {val}
                </div>
              </div>
            ))}

          {tower.specials?.length > 0 && (
            <div style={{ gridColumn: "span 3", marginTop: 4 }}>
              <div
                style={{
                  fontSize: 10,
                  color: "#64748b",
                  marginBottom: 6,
                  letterSpacing: "0.06em",
                }}
              >
                SPECIALS
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {tower.specials.map((s) => (
                  <span
                    key={s}
                    style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      background: "#12002a",
                      color: "#c4b5fd",
                      border: "1px solid #3b1a5a",
                      borderRadius: 5,
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Inline upgrade choice */}
      {nextUpgrade && (
        <div
          style={{
            borderTop: "1px solid #1e293b",
            paddingTop: 12,
            marginTop: 4,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "#fbbf24",
              marginBottom: 10,
              fontWeight: "bold",
            }}
          >
            ✦ UPGRADE READY — Choose one:
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {nextUpgrade.options.map((opt, i) => {
              if (!opt) return null;
              const cost = nextUpgrade.scaledCost ?? opt.cost;
              const canBuy = gold >= cost;
              const accentColor = nextUpgrade.isAscension
                ? "#c084fc"
                : "#fbbf24";
              const accentBg = nextUpgrade.isAscension ? "#1a0a2e" : "#1a1a0a";
              const textColor = nextUpgrade.isAscension ? "#e9d5ff" : "#fde68a";
              return (
                <button
                  key={i}
                  onClick={() =>
                    canBuy &&
                    onUpgrade(
                      tower.col,
                      tower.row,
                      nextUpgrade.type,
                      nextUpgrade.paths[i],
                    )
                  }
                  style={{
                    flex: 1,
                    padding: "10px 10px",
                    background: canBuy ? accentBg : "#1e293b",
                    border: `1px solid ${canBuy ? accentColor : "#1e293b"}`,
                    borderRadius: 8,
                    fontFamily: mono,
                    color: canBuy ? textColor : "#374151",
                    cursor: canBuy ? "pointer" : "not-allowed",
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontSize: 22, marginBottom: 4 }}>
                    {opt.icon}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: "bold",
                      marginBottom: 4,
                    }}
                  >
                    {opt.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      lineHeight: 1.4,
                      marginBottom: 8,
                    }}
                  >
                    {opt.desc}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      color: canBuy ? "#facc15" : "#374151",
                      fontWeight: "bold",
                    }}
                  >
                    {cost}g
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Run Summary Modal ────────────────────────────────────────────────────────
function RunSummaryModal({ gameState, highScores, onPlayAgain, onLevels }) {
  const mono = "'Courier New', monospace";
  const won = gameState.state === "victory";
  const isNewRecord =
    highScores[0]?.score === gameState.score &&
    highScores[0]?.wave === gameState.wave;

  const bestTower = [...(gameState.towers || [])].sort(
    (a, b) => b.kills - a.kills,
  )[0];

  const runAchievements = gameState.runAchievements || [];
  const modifierNames = [...new Set(gameState.runStats?.modifiersFaced || [])];

  const statRow = (label, val, color = "#e2e8f0") => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 5,
        fontSize: 11,
      }}
    >
      <span style={{ color: "#64748b" }}>{label}</span>
      <span style={{ color, fontWeight: "bold" }}>{val}</span>
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.88)",
        zIndex: 8000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: mono,
      }}
    >
      <div
        style={{
          background: "#0d1117",
          border: `2px solid ${won ? "#4ade80" : "#ef4444"}`,
          borderRadius: 10,
          padding: "24px 28px",
          width: 380,
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 36, marginBottom: 4 }}>
            {won ? "🏆" : "💀"}
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: "bold",
              color: won ? "#4ade80" : "#ef4444",
            }}
          >
            {won ? "VICTORY!" : "GAME OVER"}
          </div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>
            {gameState.levelName} · Wave {gameState.wave}
            {gameState.totalWaves !== "∞" ? `/${gameState.totalWaves}` : ""}
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: "bold",
              color: "#facc15",
              marginTop: 8,
            }}
          >
            {gameState.score.toLocaleString()}
            {isNewRecord && (
              <span style={{ fontSize: 11, color: "#fbbf24", marginLeft: 8 }}>
                🏆 NEW RECORD!
              </span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div
          style={{
            background: "#111827",
            borderRadius: 6,
            padding: "10px 14px",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "#475569",
              letterSpacing: "0.1em",
              marginBottom: 8,
            }}
          >
            RUN STATISTICS
          </div>
          {statRow(
            "Enemies killed",
            (gameState.runStats?.totalKills || 0).toLocaleString(),
            "#4ade80",
          )}
          {statRow(
            "Enemies leaked",
            gameState.runStats?.totalLeaks || 0,
            gameState.runStats?.totalLeaks > 0 ? "#f97316" : "#4ade80",
          )}
          {statRow(
            "Bosses killed",
            gameState.runStats?.bossKills || 0,
            "#fbbf24",
          )}
          {statRow(
            "Mutated bosses killed",
            gameState.runStats?.mutatedBossKills || 0,
            "#a78bfa",
          )}
          {statRow(
            "Lives remaining",
            gameState.lives,
            gameState.lives > 0 ? "#4ade80" : "#ef4444",
          )}
          {statRow("Modifiers survived", modifierNames.length, "#818cf8")}
          {statRow(
            "Flawless waves",
            gameState.runStats?.wavesNoLeak || 0,
            "#38bdf8",
          )}
          {bestTower &&
            statRow(
              "Best tower",
              `${bestTower.type} (${bestTower.kills} kills)`,
              "#e879f9",
            )}
        </div>

        {/* Modifiers faced */}
        {modifierNames.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 9,
                color: "#475569",
                letterSpacing: "0.1em",
                marginBottom: 5,
              }}
            >
              MODIFIERS SURVIVED
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {modifierNames.map((id) => (
                <span
                  key={id}
                  style={{
                    fontSize: 9,
                    padding: "2px 7px",
                    background: "#1e293b",
                    color: "#94a3b8",
                    borderRadius: 4,
                    border: "1px solid #334155",
                  }}
                >
                  {id.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Achievements this run */}
        {runAchievements.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 9,
                color: "#fbbf24",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              ACHIEVEMENTS THIS RUN
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {runAchievements.map((id) => {
                const def = ACHIEVEMENTS[id];
                if (!def) return null;
                return (
                  <div
                    key={id}
                    style={{
                      fontSize: 9,
                      padding: "3px 7px",
                      background: "#1a1a0a",
                      border: "1px solid #fbbf24",
                      borderRadius: 5,
                      color: "#fde68a",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span>{def.icon}</span> {def.name}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onPlayAgain}
            style={{
              flex: 2,
              padding: "10px",
              background: won ? "#0f2a0f" : "#2a0f0f",
              border: `1px solid ${won ? "#4ade80" : "#ef4444"}`,
              borderRadius: 6,
              color: won ? "#4ade80" : "#ef4444",
              fontFamily: mono,
              fontSize: 12,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            ↺ PLAY AGAIN
          </button>
          <button
            onClick={onLevels}
            style={{
              flex: 1,
              padding: "10px",
              background: "#111827",
              border: "1px solid #475569",
              borderRadius: 6,
              color: "#94a3b8",
              fontFamily: mono,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            🗺️ LEVELS
          </button>
        </div>
      </div>
    </div>
  );
}
