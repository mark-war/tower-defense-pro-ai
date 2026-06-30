import { useRef, useState } from "react";
import {
  TOWER_TYPES,
  TOWER_UPGRADES,
  ENEMY_TYPES,
  LEVELS,
  ENDLESS_CONFIG,
  MAPS,
  TOWER_CATEGORY_CAPS,
  ADMIN_CONFIG,
  ABILITIES,
  SYNERGIES,
  ACHIEVEMENTS,
  ENEMY_EVOLUTIONS,
  SKINS,
  MARKET_UNLOCK_WAVE,
} from "./gameConstants.js";
import { getGlobalMemory } from "./WaveAI.js";
import { formatSpecialTags, getSkillStackHints } from "./skillRegistry.js";
import { GOLD_MARKET_ITEMS } from "./GoldMarket.js";

const mono = "'Courier New', monospace";

export function HUD({
  gameState,
  playerProfile,
  selectedTower,
  activeTab,
  sellMode,
  hasSave,
  highScores = [],
  onSelectTower,
  onSellMode,
  onStartWave,
  onReset,
  onLevelSelect,
  onSetTab,
  onUpgrade,
  onTriggerAbility,
  onTowerCellClick,
  onClearEnemyInspect,
  onFortify,
  unlockedAchievements = {},
  onPause,
  onSave,
  onLoad,
  onDeleteSave,
  onClearScores,
  onRepairTower,
  onRepairAll,
  isMobile = false,
  onFastForward,
  hudVisible = true,
  onCloseHud,
  hudRef,
  onToggleSfx,
  onToggleMusic,
  sfxEnabled = true,
  musicEnabled = true,
  onBuyMarketItem,
  onCancelOvercharge,
  onSetSkin,
}) {
  const [confirmLevel, setConfirmLevel] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);

  const prevLen = useRef(0);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showHighScores, setShowHighScores] = useState(false);

  const currentLen = gameState?.runAchievements?.length || 0;
  if (currentLen > prevLen.current) {
    prevLen.current = currentLen;
    setShowAchievements(true);
  }

  if (!gameState)
    return (
      <div
        style={{
          width: 310,
          background: "#0a0a14",
          color: "#475569",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: mono,
          fontSize: 13,
        }}
      >
        Loading...
      </div>
    );

  const {
    gold,
    lives,
    wave,
    totalWaves,
    score,
    state,
    levelId,
    isEndless,
    enemyCount,
    spawnRemaining,
    aiSummary,
    nextWaveMessage,
    lastEnemyTypes = [],
    minRequiredTowers = {},
    bossWaves = {},
    unlockedTowers = [],
    towerCaps = {},
    towerCatCounts = {},
    abilities = {},
    globalBuff,
    lastStandActive,
    towers = [],
    inspectedEnemy,
    fortifyLevel = 0,
    fortifyCost = 150,
    maxFortifyLevel = 20,
    activeModifier = null,
    incomingModifier = null,
    lastWaveClearTime = 0,
    fastestWaveClear = 0,
    activeEvolutions = {},
    repairAllCost = 0,
    damagedTowerCount = 0,
    activeMapBonus = null,
  } = gameState;

  const aiReport = aiSummary?.report;
  const showWaveDebrief = state === "idle" && wave > 0 && aiReport?.lastWave;
  const forecast = aiReport?.forecast;
  const debriefStatusColor = {
    success: "#4ade80",
    warning: "#fbbf24",
    danger: "#ef4444",
    neutral: "#94a3b8",
  };
  const forecastConfidenceColor = {
    certain: "#ef4444",
    high: "#f97316",
    medium: "#fbbf24",
    low: "#38bdf8",
  };

  const gm = getGlobalMemory();
  const commanderStats = playerProfile?.stats || null;
  const commanderRank = commanderStats
    ? getCommanderRank(commanderStats)
    : null;
  const rivalDossier = getRivalDossier(gm);
  const canAfford = (cost) => gold >= cost;
  const isUnlocked = (t) => unlockedTowers.includes(t);
  const catLeft = (cat) =>
    Math.max(0, (towerCaps[cat] || 0) - (towerCatCounts[cat] || 0));

  // Selected tower for upgrade panel
  const selectedTowerCell = gameState?.selectedTowerCell;
  const selectedTowerObj = selectedTowerCell
    ? gameState.towers?.find(
        (t) =>
          t.col === selectedTowerCell.col && t.row === selectedTowerCell.row,
      )
    : null;

  const nextBossWave = Object.entries(bossWaves)
    .map(([w, t]) => ({ w: +w, t }))
    .filter((e) => e.w > wave)[0];
  const nextBossDef = nextBossWave ? ENEMY_TYPES[nextBossWave.t] : null;

  const towerPerf = towers.reduce((acc, t) => {
    if (!acc[t.type]) acc[t.type] = { kills: 0, damage: 0 };
    acc[t.type].kills += t.kills;
    acc[t.type].damage += t.damage;
    return acc;
  }, {});

  // Handle level selection with confirmation
  const handleLevelClick = (lvlId) => {
    if (state === "idle" && wave === 0) {
      onLevelSelect(lvlId);
      return;
    }
    if (state === "gameover" || state === "victory") {
      onLevelSelect(lvlId);
      return;
    }
    setConfirmLevel(lvlId);
  };

  const marketUnlocked = wave >= MARKET_UNLOCK_WAVE;

  const hudTabs = [
    "build",
    "upgrade",
    ...(marketUnlocked ? ["market"] : []),
    "intel",
    "levels",
  ];

  return (
    <div
      ref={hudRef}
      style={{
        ...(isMobile
          ? {
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              zIndex: 6000,
              transform: hudVisible ? "translateX(0)" : "translateX(100%)",
              transition: "transform 0.25s ease",
              width: "min(310px, 92vw)",
              boxShadow: hudVisible ? "-4px 0 24px rgba(0,0,0,0.6)" : "none",
            }
          : {
              position: "relative",
              width: 310,
              minWidth: 310,
            }),
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0a0a14",
        borderLeft: "1px solid #1e293b",
        fontFamily: mono,
        color: "#e2e8f0",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {isMobile && (
        <button
          onClick={onCloseHud}
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            width: "100%",
            padding: "10px",
            background: "#0d1117",
            border: "none",
            borderBottom: "1px solid #1e293b",
            color: "#64748b",
            fontFamily: mono,
            fontSize: 11,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: "#38bdf8" }}>◀ CLOSE HUD</span>
          <span>✕</span>
        </button>
      )}

      {/* ── ENEMY INSPECT PANEL ───────────────────────────────────────────── */}
      {inspectedEnemy && (
        <EnemyInspectPanel
          enemy={inspectedEnemy}
          onClose={() => onClearEnemyInspect()}
        />
      )}

      {/* ── CONFIRM LEVEL CHANGE DIALOG ──────────────────────────────────── */}
      {confirmLevel && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 100,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            padding: 24,
          }}
        >
          <div style={{ fontSize: 22 }}>⚠️</div>
          <div
            style={{
              fontSize: 13,
              color: "#fca5a5",
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            Switching levels will
            <br />
            <strong>end your current run</strong>.<br />
            Wave {wave} progress will be lost.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => {
                onLevelSelect(confirmLevel);
                setConfirmLevel(null);
              }}
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
              Yes, switch level
            </button>
            <button
              onClick={() => setConfirmLevel(null)}
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
      )}

      {/* ── HEADER STATS ─────────────────────────────────────────────────── */}
      <div
        style={{
          background: "#06060f",
          borderBottom: "1px solid #1e293b",
          padding: "9px 11px",
        }}
      >
        {lastStandActive && (
          <div
            style={{
              marginBottom: 5,
              padding: "3px 8px",
              background: "#3a0a0a",
              border: "1px solid #ef4444",
              borderRadius: 4,
              fontSize: 10,
              color: "#ef4444",
              textAlign: "center",
              animation: "pulse 1s infinite",
            }}
          >
            🔥 LAST STAND — All towers +50% damage!
          </div>
        )}
        {globalBuff?.timer > 0 && (
          <div
            style={{
              marginBottom: 5,
              padding: "3px 8px",
              background: "#1a1a0a",
              border: "1px solid #fbbf24",
              borderRadius: 4,
              fontSize: 10,
              color: "#fbbf24",
              textAlign: "center",
            }}
          >
            {globalBuff.label} [{Math.ceil(globalBuff.timer / 60)}s]
          </div>
        )}
        <div
          style={{
            marginBottom: 6,
            padding: "4px 8px",
            background: "#0b1220",
            border: "1px solid #22304a",
            borderRadius: 4,
            fontSize: 10,
            color: "#93c5fd",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Commander</span>
          <span style={{ color: "#e2e8f0", fontWeight: "bold" }}>
            {playerProfile?.name || "Unregistered"}
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 4,
            marginBottom: 8,
          }}
        >
          <SB label="GOLD" val={`${gold}g`} c="#facc15" />
          <SB
            label="LIVES"
            val={lives}
            c={lives <= 3 ? "#ef4444" : lives <= 7 ? "#f97316" : "#4ade80"}
          />
          <SB
            label="WAVE"
            val={`${wave}/${totalWaves}`}
            c={isEndless ? "#818cf8" : "#38bdf8"}
          />
          <SB
            label="SCORE"
            val={score > 9999 ? `${Math.floor(score / 1000)}k` : score}
            c="#a78bfa"
          />
        </div>
        {/* Ability bar */}
        <div style={{ display: "flex", gap: 5 }}>
          {Object.entries(abilities).map(([key, ab]) => {
            const ready =
              ab.cooldownLeft === 0 &&
              state === "wave" &&
              wave >= (ab.unlocksAtWave != undefined ? ab.unlocksAtWave : 0);
            const pct = Math.max(0, 1 - ab.cooldownLeft / ab.cooldown);
            return (
              <button
                key={key}
                onClick={() => ready && onTriggerAbility(key)}
                title={ab.desc}
                style={{
                  flex: 1,
                  padding: "5px 4px",
                  border: `1px solid ${ready ? ab.color : "#334155"}`,
                  borderRadius: 4,
                  background: ready ? `${ab.color}22` : "#111827",
                  color: ready ? ab.color : "#374151",
                  fontFamily: mono,
                  fontSize: 9,
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
                <div style={{ fontSize: 14 }}>{ab.icon}</div>
                <div>{ab.name}</div>
                <div style={{ fontSize: 8, color: "#475569" }}>
                  {ab.cooldownLeft > 0
                    ? `${Math.ceil(ab.cooldownLeft / 60)}s`
                    : "READY"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Pause + Save/Load bar */}
        <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
          <button
            onClick={onPause}
            disabled={state !== "wave"}
            style={{
              flex: 1,
              padding: "5px 4px",
              border: `1px solid ${state === "wave" ? (gameState?.paused ? "#4ade80" : "#fbbf24") : "#334155"}`,
              borderRadius: 4,
              background:
                state === "wave"
                  ? gameState?.paused
                    ? "#0f2a0f"
                    : "#1a1a0a"
                  : "#111827",
              color:
                state === "wave"
                  ? gameState?.paused
                    ? "#4ade80"
                    : "#fbbf24"
                  : "#374151",
              fontFamily: mono,
              fontSize: 10,
              cursor: state === "wave" ? "pointer" : "not-allowed",
            }}
          >
            {gameState?.paused ? "▶ RESUME" : "⏸ PAUSE"}
            <div style={{ fontSize: 8, color: "#475569" }}>Space / P</div>
          </button>
          <button
            onClick={onSave}
            disabled={state !== "idle"}
            title="Save between waves (Ctrl+S)"
            style={{
              flex: 1,
              padding: "5px 4px",
              border: `1px solid ${state === "idle" ? "#38bdf8" : "#334155"}`,
              borderRadius: 4,
              background: state === "idle" ? "#0a1a2a" : "#111827",
              color: state === "idle" ? "#38bdf8" : "#374151",
              fontFamily: mono,
              fontSize: 10,
              cursor: state === "idle" ? "pointer" : "not-allowed",
            }}
          >
            💾 SAVE
            <div style={{ fontSize: 8, color: "#475569" }}>Ctrl+S</div>
          </button>
          <button
            onClick={onLoad}
            disabled={!hasSave}
            title="Load most recent save"
            style={{
              flex: 1,
              padding: "5px 4px",
              border: `1px solid ${hasSave ? "#a78bfa" : "#334155"}`,
              borderRadius: 4,
              background: hasSave ? "#1a0a2e" : "#111827",
              color: hasSave ? "#a78bfa" : "#374151",
              fontFamily: mono,
              fontSize: 10,
              cursor: hasSave ? "pointer" : "not-allowed",
            }}
          >
            📂 LOAD
            <div style={{ fontSize: 8, color: "#475569" }}>
              {hasSave ? "save exists" : "no save"}
            </div>
          </button>
        </div>

        {/* ── SFX / Music toggles ─────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
          <button
            onClick={onToggleSfx}
            title="Toggle sound effects"
            style={{
              flex: 1,
              padding: "5px 4px",
              border: `1px solid ${sfxEnabled ? "#38bdf8" : "#334155"}`,
              borderRadius: 4,
              background: sfxEnabled ? "#0a1a2a" : "#111827",
              color: sfxEnabled ? "#38bdf8" : "#475569",
              fontFamily: mono,
              fontSize: 10,
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            {sfxEnabled ? "🔊" : "🔇"} SFX
            <div
              style={{ fontSize: 8, color: sfxEnabled ? "#38bdf8" : "#374151" }}
            >
              {sfxEnabled ? "ON" : "OFF"}
            </div>
          </button>
          <button
            onClick={onToggleMusic}
            title="Toggle music"
            style={{
              flex: 1,
              padding: "5px 4px",
              border: `1px solid ${musicEnabled ? "#a78bfa" : "#334155"}`,
              borderRadius: 4,
              background: musicEnabled ? "#1a0a2e" : "#111827",
              color: musicEnabled ? "#a78bfa" : "#475569",
              fontFamily: mono,
              fontSize: 10,
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            🎵 MUSIC
            <div
              style={{
                fontSize: 8,
                color: musicEnabled ? "#a78bfa" : "#374151",
              }}
            >
              {musicEnabled ? "ON" : "OFF"}
            </div>
          </button>
        </div>
      </div>

      {showWaveDebrief && (
        <div
          style={{
            margin: "8px 10px 0",
            padding: "10px 12px",
            background: "#10131c",
            border: "1px solid #334155",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: debriefStatusColor[aiReport.lastWave.status] || "#a78bfa",
              letterSpacing: "0.08em",
              marginBottom: 6,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>POST-WAVE DEBRIEF</span>
            <span
              style={{
                fontSize: 8,
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${debriefStatusColor[aiReport.lastWave.status] || "#475569"}`,
                color:
                  debriefStatusColor[aiReport.lastWave.status] || "#94a3b8",
                background: "#111827",
                textTransform: "uppercase",
              }}
            >
              {aiReport.lastWave.statusLabel}
            </span>
          </div>

          <div
            style={{
              fontSize: 11,
              color: debriefStatusColor[aiReport.lastWave.status] || "#e2e8f0",
              fontWeight: "bold",
              marginBottom: 4,
            }}
          >
            {aiReport.lastWave.headline}
          </div>

          <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.5 }}>
            {aiReport.lastWave.summary}
          </div>

          <div
            style={{
              marginTop: 8,
              fontSize: 10,
              color: "#fbbf24",
              lineHeight: 1.5,
            }}
          >
            {aiReport.suggestion}
          </div>
        </div>
      )}

      {/* ── TABS ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid #1e293b",
          background: "#070710",
        }}
      >
        {hudTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onSetTab(tab)}
            style={{
              flex: 1,
              padding: "6px 0",
              fontSize: 9,
              fontFamily: mono,
              letterSpacing: "0.06em",
              background: activeTab === tab ? "#1e293b" : "transparent",
              color: activeTab === tab ? "#e2e8f0" : "#475569",
              border: "none",
              borderBottom:
                activeTab === tab
                  ? `2px solid ${{ build: "#4ade80", upgrade: "#fbbf24", market: "#facc15", intel: "#e879f9", levels: "#38bdf8" }[tab]}`
                  : "2px solid transparent",
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            {tab === "build"
              ? "🔨"
              : tab === "upgrade"
                ? "⬆️"
                : tab === "intel"
                  ? "🧠"
                  : tab === "market"
                    ? "💰"
                    : "🗺️"}{" "}
            {tab}
          </button>
        ))}
      </div>

      {/* ════ TAB: BUILD ════════════════════════════════════════════════════ */}
      {activeTab === "build" && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* Cat caps */}
          <div
            style={{
              padding: "7px 11px",
              borderBottom: "1px solid #1e293b",
              background: "#0b0b18",
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: "#475569",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              PLACEMENT CAPS
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              {Object.entries(TOWER_CATEGORY_CAPS).map(([cat, def]) => {
                const used = towerCatCounts[cat] || 0,
                  limit = towerCaps[cat] ?? def.cap,
                  full = used >= limit;
                return (
                  <div
                    key={cat}
                    style={{
                      flex: 1,
                      background: "#111827",
                      borderRadius: 4,
                      padding: "4px 6px",
                      border: `1px solid ${full ? "#ef4444" : "#1e293b"}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        color: full ? "#ef4444" : "#64748b",
                      }}
                    >
                      {def.icon} {def.label}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: "bold",
                        color: full
                          ? "#ef4444"
                          : used / limit > 0.7
                            ? "#f97316"
                            : "#4ade80",
                      }}
                    >
                      {used}/{limit}
                    </div>
                    <div
                      style={{
                        height: 2,
                        background: "#1e293b",
                        borderRadius: 2,
                        marginTop: 2,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(100, (used / limit) * 100)}%`,
                          background: full
                            ? "#ef4444"
                            : used / limit > 0.7
                              ? "#f97316"
                              : "#4ade80",
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active map bonus */}
          {activeMapBonus && (
            <div
              style={{
                padding: "5px 11px",
                borderBottom: "1px solid #1e293b",
                background: "#0a120f",
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <span style={{ fontSize: 14 }}>🗺</span>
              <div>
                <div style={{ fontSize: 8, color: "#475569" }}>
                  MAP BONUS — {gameState?.mapName}
                </div>
                <div
                  style={{ fontSize: 10, color: "#4ade80", fontWeight: "bold" }}
                >
                  {activeMapBonus.label}
                </div>
              </div>
            </div>
          )}

          {/* Synergy roster — active + almost-ready pairs */}
          {(() => {
            const ownedTypes = new Set(towers.map((t) => t.type));
            const synergyRows = Object.entries(SYNERGIES).map(([key, syn]) => {
              const hasA = ownedTypes.has(syn.towers[0]);
              const hasB = ownedTypes.has(syn.towers[1]);
              return { key, ...syn, hasA, hasB, active: hasA && hasB };
            });
            const showSynergies = synergyRows.some((s) => s.hasA || s.hasB);
            if (!showSynergies) return null;
            return (
              <div
                style={{
                  padding: "6px 11px",
                  borderBottom: "1px solid #1e293b",
                  background: "#0a120a",
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    color: "#4ade80",
                    letterSpacing: "0.1em",
                    marginBottom: 4,
                  }}
                >
                  ✨ TOWER SYNERGIES
                </div>
                {synergyRows.map((s) => {
                  if (!s.hasA && !s.hasB) return null;
                  const status = s.active
                    ? "ACTIVE"
                    : `need ${!s.hasA ? TOWER_TYPES[s.towers[0]]?.name : TOWER_TYPES[s.towers[1]]?.name}`;
                  return (
                    <div
                      key={s.key}
                      style={{
                        fontSize: 10,
                        color: s.active ? "#86efac" : "#64748b",
                        marginBottom: 3,
                        opacity: s.active ? 1 : 0.75,
                      }}
                    >
                      <span style={{ color: s.color, marginRight: 4 }}>●</span>
                      <span
                        style={{ fontWeight: s.active ? "bold" : "normal" }}
                      >
                        {s.name}
                      </span>
                      <span style={{ color: "#475569", marginLeft: 4 }}>
                        ({status})
                      </span>
                      {s.active && (
                        <div
                          style={{
                            fontSize: 9,
                            color: "#6b7280",
                            marginLeft: 12,
                            marginTop: 1,
                          }}
                        >
                          {s.desc}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Tower list */}
          <div
            style={{ padding: "8px 11px", borderBottom: "1px solid #1e293b" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 5,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#475569",
                  letterSpacing: "0.1em",
                }}
              >
                SELECT TOWER
              </div>
              <button
                onClick={onSellMode}
                style={{
                  fontSize: 9,
                  fontFamily: mono,
                  padding: "2px 6px",
                  background: sellMode ? "#3a1a1a" : "transparent",
                  border: `1px solid ${sellMode ? "#ef4444" : "#334155"}`,
                  color: sellMode ? "#ef4444" : "#64748b",
                  borderRadius: 3,
                  cursor: "pointer",
                }}
              >
                {sellMode ? "✕ Cancel" : "💲 Sell (60%)"}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {Object.entries(TOWER_TYPES).map(([key, def]) => {
                const unlocked = isUnlocked(key),
                  canBuy = canAfford(def.cost) && unlocked,
                  catFull = catLeft(def.category) <= 0;
                const sel = selectedTower === key && !sellMode;
                const upgDef = TOWER_UPGRADES[key];
                return (
                  <button
                    key={key}
                    onClick={() =>
                      !(catFull && !sel) && unlocked && onSelectTower(key)
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 8px",
                      background: sel
                        ? "#1e293b"
                        : catFull
                          ? "#1a0a0a"
                          : "transparent",
                      border: `1px solid ${sel ? def.color : catFull ? "#3a1a1a" : "#1e293b"}`,
                      borderRadius: 5,
                      color: !unlocked || catFull ? "#374151" : "#e2e8f0",
                      cursor: unlocked && !catFull ? "pointer" : "not-allowed",
                      textAlign: "left",
                      fontFamily: mono,
                      opacity: !unlocked ? 0.4 : !canBuy && !sel ? 0.6 : 1,
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{def.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: "bold",
                          color: sel ? def.color : "inherit",
                        }}
                      >
                        {def.name}
                        {!unlocked && (
                          <span
                            style={{
                              fontSize: 8,
                              color: "#6b7280",
                              marginLeft: 3,
                            }}
                          >
                            🔒
                          </span>
                        )}
                        {catFull && (
                          <span
                            style={{
                              fontSize: 8,
                              color: "#ef4444",
                              marginLeft: 3,
                            }}
                          >
                            CAP
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 9, color: "#4b5563" }}>
                        {def.desc}
                      </div>
                      <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                        <span
                          style={{
                            fontSize: 7,
                            padding: "1px 4px",
                            borderRadius: 3,
                            background:
                              def.damageType === "magical"
                                ? "#1a0a2e"
                                : def.damageType === "hybrid"
                                  ? "#0a1a1a"
                                  : "#0a1a0a",
                            color:
                              def.damageType === "magical"
                                ? "#c4b5fd"
                                : def.damageType === "hybrid"
                                  ? "#a5f3fc"
                                  : "#86efac",
                            border: `1px solid ${
                              def.damageType === "magical"
                                ? "#4c1d95"
                                : def.damageType === "hybrid"
                                  ? "#164e63"
                                  : "#14532d"
                            }`,
                          }}
                        >
                          {def.damageType === "magical"
                            ? "MAG"
                            : def.damageType === "hybrid"
                              ? "HYB"
                              : "PHY"}
                        </span>
                        {def.homing && (
                          <span
                            style={{
                              fontSize: 7,
                              padding: "1px 4px",
                              borderRadius: 3,
                              background: "#1a0a0a",
                              color: "#fca5a5",
                              border: "1px solid #7f1d1d",
                            }}
                          >
                            HOMING
                          </span>
                        )}
                      </div>
                      {upgDef && (
                        <div
                          style={{
                            fontSize: 8,
                            color: "#475569",
                            marginTop: 1,
                          }}
                        >
                          XP↑ at {upgDef.xpToTier1}/{upgDef.xpToTier2} kills
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: canBuy ? "#facc15" : "#374151",
                        fontWeight: "bold",
                        minWidth: 32,
                        textAlign: "right",
                      }}
                    >
                      {def.cost}g
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Next boss hint */}
          {nextBossDef && (
            <div
              style={{
                padding: "7px 11px",
                borderBottom: "1px solid #1e293b",
                background: "#1a0808",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#ef4444",
                  letterSpacing: "0.1em",
                  marginBottom: 3,
                }}
              >
                ⚠ BOSS — WAVE {nextBossWave?.w}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ fontSize: 22 }}>{nextBossDef.icon}</span>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: "bold",
                      color: "#fca5a5",
                    }}
                  >
                    {nextBossDef.name}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "#6b7280",
                      lineHeight: 1.45,
                      marginBottom: 4,
                    }}
                  >
                    {nextBossDef.counterNote || nextBossDef.weaknessHint}
                  </div>
                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                    {nextBossDef.immunities?.map((im) => (
                      <span
                        key={im}
                        style={{
                          fontSize: 8,
                          padding: "1px 5px",
                          background: "#3a1a1a",
                          color: "#fca5a5",
                          border: "1px solid #7f1d1d",
                          borderRadius: 3,
                        }}
                      >
                        🚫 {TOWER_TYPES[im]?.name || im}
                      </span>
                    ))}
                    {nextBossDef.weakness && (
                      <span
                        style={{
                          fontSize: 8,
                          padding: "1px 5px",
                          background: "#0f2a0f",
                          color: "#86efac",
                          border: "1px solid #166534",
                          borderRadius: 3,
                        }}
                      >
                        ✓ {TOWER_TYPES[nextBossDef.weakness]?.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Incoming modifier warning */}
          {incomingModifier && state === "idle" && (
            <div
              style={{
                padding: "8px 11px",
                borderBottom: "1px solid #1e293b",
                background:
                  incomingModifier.type === "buff"
                    ? "#061a06"
                    : incomingModifier.type === "debuff"
                      ? "#1a0606"
                      : "#0a0a1a",
                border: `1px solid ${
                  incomingModifier.type === "buff"
                    ? "#166534"
                    : incomingModifier.type === "debuff"
                      ? "#7f1d1d"
                      : "#3730a3"
                }`,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#fbbf24",
                  letterSpacing: "0.1em",
                  marginBottom: 4,
                }}
              >
                ⚡ PREPARE — NEXT WAVE IS MODIFIER WAVE
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 22 }}>{incomingModifier.icon}</span>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: "bold",
                      color:
                        incomingModifier.type === "buff"
                          ? "#4ade80"
                          : incomingModifier.type === "debuff"
                            ? "#ef4444"
                            : "#818cf8",
                    }}
                  >
                    {incomingModifier.name}
                    <span
                      style={{
                        fontSize: 8,
                        marginLeft: 5,
                        color: "#475569",
                        fontWeight: "normal",
                      }}
                    >
                      {incomingModifier.type.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: 9, color: "#6b7280" }}>
                    {incomingModifier.desc}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Min required towers */}
          {Object.keys(minRequiredTowers).length > 0 && state === "idle" && (
            <div
              style={{
                padding: "7px 11px",
                borderBottom: "1px solid #1e293b",
                background: "#0a140a",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#4ade80",
                  letterSpacing: "0.1em",
                  marginBottom: 4,
                }}
              >
                AI THREAT ASSESSMENT
              </div>
              {Object.entries(minRequiredTowers).map(([type, count]) => {
                const def = TOWER_TYPES[type];
                if (!def) return null;
                const cur = towers.filter((t) => t.type === type).length,
                  ok = cur >= count;
                return (
                  <div
                    key={type}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      marginBottom: 3,
                      fontSize: 10,
                      color: ok ? "#4ade80" : "#f97316",
                    }}
                  >
                    <span>{def.icon}</span>
                    <span style={{ flex: 1 }}>{def.name}</span>
                    <span style={{ fontWeight: "bold" }}>
                      {cur}/{count} {ok ? "✓" : "⚠"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Wave control */}
          <div style={{ padding: "9px 11px", marginTop: "auto" }}>
            {state === "idle" && (
              <>
                {/* Fortify button */}
                <button
                  onClick={onFortify}
                  disabled={
                    gold < fortifyCost || fortifyLevel >= maxFortifyLevel
                  }
                  title={`Permanently boost all towers +8% damage. Cost increases each purchase.`}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    marginBottom: 6,
                    background:
                      fortifyLevel >= maxFortifyLevel
                        ? "#111827"
                        : gold >= fortifyCost
                          ? "#1a140a"
                          : "#0d0d0d",
                    border: `1px solid ${
                      fortifyLevel >= maxFortifyLevel
                        ? "#374151"
                        : gold >= fortifyCost
                          ? "#fbbf24"
                          : "#374151"
                    }`,
                    borderRadius: 5,
                    color:
                      fortifyLevel >= maxFortifyLevel
                        ? "#374151"
                        : gold >= fortifyCost
                          ? "#fbbf24"
                          : "#4b5563",
                    fontFamily: mono,
                    fontSize: 10,
                    cursor:
                      gold >= fortifyCost && fortifyLevel < maxFortifyLevel
                        ? "pointer"
                        : "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>
                    🏰 Fortify{" "}
                    <span style={{ fontSize: 8, color: "#6b7280" }}>
                      Lv {fortifyLevel}/{maxFortifyLevel}
                    </span>
                  </span>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span style={{ fontSize: 9, color: "#94a3b8" }}>
                      all towers +8% dmg
                    </span>
                    <span style={{ fontWeight: "bold" }}>
                      {fortifyLevel >= maxFortifyLevel
                        ? "MAX"
                        : `${fortifyCost}g`}
                    </span>
                  </span>
                </button>
                {/* XP bar showing fortify progress */}
                {fortifyLevel > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div
                      style={{
                        height: 2,
                        background: "#1e293b",
                        borderRadius: 2,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${(fortifyLevel / maxFortifyLevel) * 100}%`,
                          background: "#fbbf24",
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </div>
                )}
                <button
                  onClick={onStartWave}
                  style={{
                    width: "100%",
                    padding: "10px",
                    background: "#0f2a0f",
                    border: "1px solid #4ade80",
                    borderRadius: 5,
                    color: "#4ade80",
                    fontFamily: mono,
                    fontSize: 12,
                    fontWeight: "bold",
                    cursor: "pointer",
                    letterSpacing: "0.04em",
                  }}
                >
                  ▶ SEND WAVE {wave + 1}
                  {bossWaves[wave + 1] ? " 💀 BOSS" : ""}
                </button>
              </>
            )}

            {state === "wave" && (
              <div style={{ display: "flex", gap: 5 }}>
                <div
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "8px",
                    background: "#1a0f0a",
                    border: "1px solid #f97316",
                    borderRadius: 5,
                    color: "#f97316",
                    fontSize: 11,
                  }}
                >
                  ⚔ WAVE {wave} — {enemyCount} active · {spawnRemaining} queued
                </div>
                <button
                  onClick={() => onFastForward?.()}
                  title="Cycle speed: 1× → 2× → 4×"
                  style={{
                    padding: "6px 10px",
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
                    fontSize: 11,
                    fontWeight: "bold",
                    cursor: "pointer",
                    minWidth: 44,
                    flexShrink: 0,
                  }}
                >
                  {gameState.speedMultiplier === 4
                    ? "⏩4×"
                    : gameState.speedMultiplier === 2
                      ? "⏩2×"
                      : "▶1×"}
                </button>
              </div>
            )}

            {(state === "gameover" || state === "victory") && (
              <button
                onClick={() => onReset(levelId)}
                style={{
                  width: "100%",
                  padding: "10px",
                  background: state === "victory" ? "#0f2a0f" : "#2a0f0f",
                  border: `1px solid ${state === "victory" ? "#4ade80" : "#ef4444"}`,
                  borderRadius: 5,
                  color: state === "victory" ? "#4ade80" : "#ef4444",
                  fontFamily: mono,
                  fontSize: 12,
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                ↺ PLAY AGAIN
              </button>
            )}
          </div>
        </div>
      )}

      {/* ════ TAB: UPGRADE ══════════════════════════════════════════════════ */}
      {activeTab === "upgrade" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 11px" }}>
          {/* Repair All banner */}
          {damagedTowerCount > 0 && (
            <div
              style={{
                marginBottom: 8,
                padding: "7px 10px",
                background: "#1a0808",
                border: "1px solid #ef4444",
                borderRadius: 5,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div>
                <div
                  style={{ fontSize: 10, color: "#fca5a5", fontWeight: "bold" }}
                >
                  ⚠ {damagedTowerCount} tower{damagedTowerCount > 1 ? "s" : ""}{" "}
                  damaged
                </div>
                <div style={{ fontSize: 8, color: "#6b7280" }}>
                  Auto-heals 20% between waves
                </div>
              </div>
              <button
                onClick={onRepairAll}
                disabled={state !== "idle" || gold < repairAllCost}
                style={{
                  padding: "5px 10px",
                  background:
                    state === "idle" && gold >= repairAllCost
                      ? "#1a2a0a"
                      : "#111827",
                  border: `1px solid ${state === "idle" && gold >= repairAllCost ? "#4ade80" : "#374151"}`,
                  borderRadius: 4,
                  color:
                    state === "idle" && gold >= repairAllCost
                      ? "#4ade80"
                      : "#374151",
                  fontFamily: mono,
                  fontSize: 10,
                  cursor:
                    state === "idle" && gold >= repairAllCost
                      ? "pointer"
                      : "not-allowed",
                  whiteSpace: "nowrap",
                }}
              >
                🔧 All — {repairAllCost}g
              </button>
            </div>
          )}

          {/* Upgrade-ready towers */}
          {towers.filter((t) => t.upgradeReady).length > 0 && (
            <div
              style={{
                marginBottom: 10,
                padding: "6px 8px",
                background: "#1a1a0a",
                border: "1px solid #fbbf24",
                borderRadius: 5,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#fbbf24",
                  letterSpacing: "0.1em",
                  marginBottom: 4,
                }}
              >
                ↑ UPGRADE AVAILABLE
              </div>
              {towers
                .filter((t) => t.upgradeReady)
                .map((t) => (
                  <div
                    key={t.id}
                    onClick={() => onTowerCellClick(t.col, t.row)}
                    style={{
                      fontSize: 10,
                      color: "#fde68a",
                      cursor: "pointer",
                      marginBottom: 2,
                    }}
                  >
                    {TOWER_TYPES[t.type]?.icon} {TOWER_TYPES[t.type]?.name} at (
                    {t.col},{t.row}) · Click to select
                  </div>
                ))}
            </div>
          )}

          {/* Selected tower upgrade panel */}
          {selectedTowerObj ? (
            <UpgradePanel
              tower={selectedTowerObj}
              onUpgrade={onUpgrade}
              onRepairTower={onRepairTower}
              gold={gold}
              currentWave={wave}
            />
          ) : (
            <div
              style={{
                fontSize: 11,
                color: "#374151",
                textAlign: "center",
                marginTop: 24,
                lineHeight: 1.8,
              }}
            >
              Click a tower on the map
              <br />
              to view its upgrade tree.
              <br />
              <br />
              <span style={{ fontSize: 9, color: "#1e293b" }}>
                Towers gain XP from kills.
                <br />
                XP unlocks upgrade tiers.
                <br />
                Gold buys the upgrade.
              </span>
            </div>
          )}

          {/* All tower XP bars */}
          {towers.length > 0 && (
            <div
              style={{
                marginTop: 12,
                borderTop: "1px solid #1e293b",
                paddingTop: 10,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#475569",
                  letterSpacing: "0.1em",
                  marginBottom: 6,
                }}
              >
                ALL TOWER XP
              </div>
              {towers.map((t) => {
                const def = TOWER_TYPES[t.type];
                if (!def) return null;
                const xpNeeded = t.tier < 1 ? t.xpToTier1 : t.xpToTier2;
                const xpPct = xpNeeded > 0 ? Math.min(1, t.xp / xpNeeded) : 1;
                return (
                  <div
                    key={t.id}
                    onClick={() => onTowerCellClick(t.col, t.row)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      marginBottom: 4,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ fontSize: 12 }}>{def.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 9,
                          color: t.upgradeReady ? "#fbbf24" : "#6b7280",
                        }}
                      >
                        <span>{def.name}</span>
                        <span>
                          T{t.tier} · {Math.floor(t.xp)}/{xpNeeded}xp
                        </span>
                      </div>
                      <div
                        style={{
                          height: 3,
                          background: "#1e293b",
                          borderRadius: 2,
                          marginTop: 1,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${xpPct * 100}%`,
                            background: t.upgradeReady ? "#fbbf24" : "#38bdf8",
                            borderRadius: 2,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════ TAB: INTEL ════════════════════════════════════════════════════ */}
      {activeTab === "intel" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 11px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#e879f9",
              }}
            />
            <span
              style={{ fontSize: 9, color: "#e879f9", letterSpacing: "0.1em" }}
            >
              AI SYSTEM · {gm.gamesPlayed} GAMES LEARNED
            </span>
          </div>
          <div
            style={{
              background: "#12002a",
              border: "1px solid #3b1a5a",
              borderRadius: 5,
              padding: "8px 10px",
              fontSize: 11,
              color: "#c4b5fd",
              lineHeight: 1.55,
              marginBottom: 10,
              minHeight: 52,
            }}
          >
            {nextWaveMessage}
          </div>

          {/* Active or upcoming modifier */}
          {activeModifier && (
            <div
              style={{
                marginBottom: 10,
                padding: "7px 10px",
                borderRadius: 5,
                background:
                  activeModifier.type === "buff"
                    ? "#0a200a"
                    : activeModifier.type === "debuff"
                      ? "#200a0a"
                      : "#10102a",
                border: `1px solid ${activeModifier.type === "buff" ? "#4ade80" : activeModifier.type === "debuff" ? "#ef4444" : "#818cf8"}`,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#475569",
                  marginBottom: 3,
                  letterSpacing: "0.08em",
                }}
              >
                ⚡ ACTIVE WAVE MODIFIER
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 20 }}>{activeModifier.icon}</span>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: "bold",
                      color:
                        activeModifier.type === "buff"
                          ? "#4ade80"
                          : activeModifier.type === "debuff"
                            ? "#ef4444"
                            : "#818cf8",
                    }}
                  >
                    {activeModifier.name}
                  </div>
                  <div style={{ fontSize: 9, color: "#6b7280" }}>
                    {activeModifier.desc}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Wave stats */}
          {lastWaveClearTime > 0 && (
            <div
              style={{
                display: "flex",
                gap: 6,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  flex: 1,
                  background: "#0d1117",
                  borderRadius: 5,
                  padding: "5px 8px",
                  border: "1px solid #1e293b",
                }}
              >
                <div style={{ fontSize: 8, color: "#475569" }}>LAST WAVE</div>
                <div
                  style={{ fontSize: 13, fontWeight: "bold", color: "#38bdf8" }}
                >
                  {lastWaveClearTime}s
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  background: "#0d1117",
                  borderRadius: 5,
                  padding: "5px 8px",
                  border: "1px solid #1e293b",
                }}
              >
                <div style={{ fontSize: 8, color: "#475569" }}>FASTEST</div>
                <div
                  style={{ fontSize: 13, fontWeight: "bold", color: "#fbbf24" }}
                >
                  {fastestWaveClear > 0 ? `${fastestWaveClear}s` : "—"}
                </div>
              </div>
            </div>
          )}

          {/* DETECTED STRATEGY */}
          <Sect label="DETECTED STRATEGY">
            <div
              style={{
                fontSize: 13,
                fontWeight: "bold",
                color: aiSummary?.strategy ? "#e879f9" : "#374151",
              }}
            >
              {aiSummary?.strategy
                ? aiSummary.strategy.toUpperCase()
                : wave < 3
                  ? "Observing..."
                  : "No pattern yet"}
            </div>
          </Sect>

          <Sect label="RIVAL DOSSIER">
            <div
              style={{
                background: "#111827",
                border: "1px solid #1e293b",
                borderRadius: 6,
                padding: "8px 9px",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "7px 10px",
                marginBottom: 8,
              }}
            >
              {[
                ["Observed Runs", rivalDossier.observedRuns, "#e879f9"],
                ["Total Waves", rivalDossier.totalWaves, "#93c5fd"],
                ["Favored Tower", rivalDossier.favoredTower, "#c4b5fd"],
                ["Best Exploit", rivalDossier.favoriteExploit, "#fca5a5"],
                ["Targeted Style", rivalDossier.targetedStrategy, "#fbbf24"],
                ["Boss Pressure", rivalDossier.bossPattern, "#86efac"],
              ].map(([label, value, color]) => (
                <div key={label}>
                  <div style={{ fontSize: 8, color: "#475569" }}>{label}</div>
                  <div style={{ fontSize: 11, color, fontWeight: "bold" }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                background: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: 6,
                padding: "8px 9px",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#64748b",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                RIVAL ASSESSMENT
              </div>
              <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.55 }}>
                {rivalDossier.assessment}
              </div>
            </div>
          </Sect>

          {commanderStats && (
            <Sect label="COMMANDER RECORD">
              <div
                style={{
                  background: "#111827",
                  border: "1px solid #1e293b",
                  borderRadius: 6,
                  padding: "8px 9px",
                }}
              >
                <div
                  style={{
                    paddingBottom: 8,
                    marginBottom: 8,
                    borderBottom: "1px solid #1e293b",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 8,
                          color: "#475569",
                          letterSpacing: "0.08em",
                        }}
                      >
                        COMMANDER RANK
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: "bold",
                          color: commanderRank.color,
                        }}
                      >
                        {commanderRank.title}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: "bold",
                        color: commanderRank.color,
                      }}
                    >
                      Lv {commanderRank.level}
                    </div>
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: "#0b1220",
                      borderRadius: 4,
                      overflow: "hidden",
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${commanderRank.progressPct}%`,
                        background: commanderRank.color,
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 8,
                      color: "#64748b",
                    }}
                  >
                    <span>{commanderRank.points} prestige</span>
                    <span>{commanderRank.nextLabel}</span>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "6px 10px",
                  }}
                >
                  {[
                    ["Runs", commanderStats.totalRuns, "#93c5fd"],
                    ["Wins", commanderStats.totalWins, "#86efac"],
                    ["Best Wave", commanderStats.bestWave, "#fbbf24"],
                    [
                      "Best Score",
                      commanderStats.bestScore.toLocaleString(),
                      "#e2e8f0",
                    ],
                    [
                      "Favorite",
                      TOWER_TYPES[commanderStats.favoriteTower]?.name ||
                        commanderStats.favoriteTower ||
                        "None",
                      "#c4b5fd",
                    ],
                    [
                      "Kills",
                      commanderStats.totalEnemiesDestroyed.toLocaleString(),
                      "#fca5a5",
                    ],
                  ].map(([label, value, color]) => (
                    <div key={label}>
                      <div style={{ fontSize: 8, color: "#475569" }}>
                        {label}
                      </div>
                      <div style={{ fontSize: 11, color, fontWeight: "bold" }}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Sect>
          )}

          <div
            style={{ fontSize: 9, color: "#475569", letterSpacing: "0.08em" }}
          >
            RIVAL INTELLIGENCE FEED
          </div>
          {/* AI REPORT */}
          <Sect label="AI REPORT">
            <div
              style={{
                background: "#111827",
                border: "1px solid #1e293b",
                borderRadius: 6,
                padding: "10px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 10, color: "#a78bfa", lineHeight: 1.5 }}>
                {aiReport?.tone || "No AI tone available yet."}
              </div>

              <div style={{ fontSize: 10, color: "#fca5a5", lineHeight: 1.5 }}>
                {aiReport?.taunt || "The rival has not spoken yet."}
              </div>

              <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.5 }}>
                {aiReport?.debrief || "No debrief available yet."}
              </div>

              <div
                style={{
                  background: "#0b1220",
                  border: "1px solid #22304a",
                  borderRadius: 5,
                  padding: "8px 8px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: "#fbbf24",
                      fontWeight: "bold",
                    }}
                  >
                    {forecast?.headline || "No forecast available yet."}
                  </div>
                  {forecast?.confidence && (
                    <span
                      style={{
                        fontSize: 8,
                        padding: "2px 5px",
                        borderRadius: 4,
                        border: `1px solid ${forecastConfidenceColor[forecast.confidence] || "#475569"}`,
                        color:
                          forecastConfidenceColor[forecast.confidence] ||
                          "#94a3b8",
                        background: "#111827",
                        textTransform: "uppercase",
                      }}
                    >
                      {forecast.confidence}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 3 }}>
                  Source: {forecast?.source || "None"}
                </div>
                <div
                  style={{ fontSize: 10, color: "#fbbf24", lineHeight: 1.5 }}
                >
                  {forecast?.detail || "The AI does not have a clear read yet."}
                </div>
              </div>

              <div style={{ fontSize: 10, color: "#86efac", lineHeight: 1.5 }}>
                {aiReport?.suggestion || "No suggestion available yet."}
              </div>

              {aiReport?.counterplay && (
                <div
                  style={{
                    borderTop: "1px solid #1e293b",
                    paddingTop: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      color: aiReport.counterplay.color,
                      marginBottom: 3,
                      letterSpacing: "0.06em",
                    }}
                  >
                    {aiReport.counterplay.label}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: aiReport.counterplay.color,
                      lineHeight: 1.5,
                    }}
                  >
                    {aiReport.counterplay.text}
                  </div>
                </div>
              )}
            </div>
          </Sect>

          {(aiSummary?.weaknesses || []).length > 0 && (
            <Sect label="EXPLOITING YOUR GAPS">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {aiSummary.weaknesses.map((w) => {
                  const def = ENEMY_TYPES[w] || TOWER_TYPES[w];
                  return (
                    <span
                      key={w}
                      style={{
                        fontSize: 9,
                        padding: "2px 6px",
                        background: "#3a1a1a",
                        color: "#fca5a5",
                        border: "1px solid #7f1d1d",
                        borderRadius: 4,
                      }}
                    >
                      {def?.icon || "⚠"} {def?.name || w}
                    </span>
                  );
                })}
              </div>
            </Sect>
          )}
          {/* Wave enemy roster with counter notes */}
          {lastEnemyTypes.length > 0 && (
            <Sect label="WAVE ENEMY ROSTER">
              {lastEnemyTypes.map((type) => {
                const def = ENEMY_TYPES[type];
                if (!def) return null;
                const hasCounter = def.requiresCounter
                  ? towers.some((t) => t.type === def.requiresCounter)
                  : true;
                return (
                  <div
                    key={type}
                    style={{
                      display: "flex",
                      gap: 8,
                      marginBottom: 6,
                      padding: "5px 7px",
                      background: "#0d1117",
                      borderRadius: 5,
                      border: `1px solid ${!hasCounter ? "#7f1d1d" : "#1e293b"}`,
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{def.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: "bold",
                          color: def.isBoss ? "#fca5a5" : "#e2e8f0",
                        }}
                      >
                        {def.name}
                        {def.isBoss && " 💀"}
                      </div>
                      {def.counterNote && (
                        <div
                          style={{
                            fontSize: 9,
                            color: !hasCounter ? "#ef4444" : "#6b7280",
                            lineHeight: 1.4,
                          }}
                        >
                          {def.counterNote}
                        </div>
                      )}
                      {def.immunities?.length > 0 && (
                        <div
                          style={{
                            fontSize: 8,
                            color: "#9ca3af",
                            marginTop: 2,
                          }}
                        >
                          Immune:{" "}
                          {def.immunities
                            .map((i) => TOWER_TYPES[i]?.name || i)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </Sect>
          )}
          {/* Active enemy evolutions */}
          {Object.keys(activeEvolutions || {}).length > 0 && (
            <Sect label="⚠ ENEMY ADAPTATIONS">
              {Object.entries(activeEvolutions).map(([enemyType, evoIds]) => {
                const eDef = ENEMY_TYPES[enemyType];
                return evoIds.map((evoId) => {
                  const evo = ENEMY_EVOLUTIONS?.[evoId];
                  if (!evo) return null;
                  return (
                    <div
                      key={evoId}
                      style={{
                        display: "flex",
                        gap: 7,
                        marginBottom: 6,
                        padding: "5px 7px",
                        background: "#1a0808",
                        borderRadius: 5,
                        border: "1px solid #7f1d1d",
                      }}
                    >
                      <span style={{ fontSize: 16 }}>
                        {eDef?.icon}
                        {evo.icon}
                      </span>
                      <div>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: "bold",
                            color: "#fca5a5",
                          }}
                        >
                          {eDef?.name} — {evo.name}
                        </div>
                        <div style={{ fontSize: 9, color: "#6b7280" }}>
                          {evo.desc}
                        </div>
                      </div>
                    </div>
                  );
                });
              })}
            </Sect>
          )}
          {gm.gamesPlayed >= 1 && (
            <Sect label={`CROSS-GAME MEMORY (${gm.gamesPlayed} runs)`}>
              {Object.entries(gm.weaknessSuccessRate).map(([w, rate]) => {
                const def = ENEMY_TYPES[w] || TOWER_TYPES[w];
                return (
                  <div
                    key={w}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      marginBottom: 3,
                    }}
                  >
                    <span style={{ fontSize: 11 }}>{def?.icon || "?"}</span>
                    <span style={{ fontSize: 10, flex: 1, color: "#6b7280" }}>
                      {def?.name || w}
                    </span>
                    <div
                      style={{
                        width: 55,
                        height: 3,
                        background: "#1e293b",
                        borderRadius: 2,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.round(rate * 100)}%`,
                          background:
                            rate > 0.6
                              ? "#ef4444"
                              : rate > 0.4
                                ? "#f97316"
                                : "#4ade80",
                          borderRadius: 2,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 8,
                        color: "#6b7280",
                        minWidth: 26,
                        textAlign: "right",
                      }}
                    >
                      {Math.round(rate * 100)}%
                    </span>
                  </div>
                );
              })}
            </Sect>
          )}

          {/* tower performance */}
          {Object.keys(towerPerf).length > 0 && (
            <Sect label="TOWER PERFORMANCE">
              {Object.entries(towerPerf).map(([type, data]) => {
                const def = TOWER_TYPES[type];
                if (!def) return null;

                return (
                  <div
                    key={type}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 12 }}>{def.icon}</span>

                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#e2e8f0" }}>
                        {def.name}
                      </div>
                      <div style={{ fontSize: 8, color: "#6b7280" }}>
                        {data.kills} kills · {Math.floor(data.damage)} dmg
                      </div>
                    </div>

                    <div style={{ width: 60 }}>
                      <div
                        style={{
                          height: 3,
                          background: "#1e293b",
                          borderRadius: 2,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.min(100, data.kills * 2)}%`,
                            background: "#4ade80",
                            borderRadius: 2,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </Sect>
          )}

          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>
        </div>
      )}

      {/* ════ TAB: LEVELS ═══════════════════════════════════════════════════ */}
      {activeTab === "levels" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "9px 11px" }}>
          {/* ── SKIN PICKER ──────────────────────────────────────────────── */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 9,
                color: "#475569",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              🎨 VISUAL SKIN — changes instantly, any time
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {Object.values(SKINS).map((skin) => {
                const isActive =
                  (gameState?.activeSkinId || gameState?.activeSkin) ===
                  skin.id; // Pick a representative color for the swatch
                const swatchColor =
                  skin.towers?.basic?.color ||
                  skin.maps?.valley?.accent ||
                  "#4ade80";
                return (
                  <button
                    key={skin.id}
                    onClick={() => onSetSkin?.(skin.id)}
                    title={skin.name}
                    style={{
                      flex: 1,
                      minWidth: 60,
                      padding: "7px 5px",
                      background: isActive ? "#1e293b" : "#0d1117",
                      border: `2px solid ${isActive ? swatchColor : "#1e293b"}`,
                      borderRadius: 6,
                      cursor: "pointer",
                      fontFamily: mono,
                      textAlign: "center",
                      transition: "border-color 0.15s",
                    }}
                  >
                    {/* Color swatch dot */}
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: swatchColor,
                        margin: "0 auto 4px",
                        boxShadow: isActive ? `0 0 6px ${swatchColor}` : "none",
                      }}
                    />
                    <div
                      style={{
                        fontSize: 9,
                        color: isActive ? swatchColor : "#475569",
                        fontWeight: isActive ? "bold" : "normal",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {skin.name}
                    </div>
                    {isActive && (
                      <div
                        style={{ fontSize: 7, color: "#64748b", marginTop: 2 }}
                      >
                        ACTIVE
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            style={{
              fontSize: 9,
              color: "#475569",
              letterSpacing: "0.1em",
              marginBottom: 7,
            }}
          >
            SELECT LEVEL
          </div>

          {/* Endless mode card */}
          <div
            onClick={() => handleLevelClick(99)}
            style={{
              marginBottom: 7,
              padding: "9px 11px",
              borderRadius: 6,
              cursor: "pointer",
              background: levelId === 99 ? "#1a0a2e" : "#0d1117",
              border: `2px solid ${levelId === 99 ? "#818cf8" : "#2d1b69"}`,
              transition: "all 0.12s",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 3,
              }}
            >
              <span
                style={{ fontSize: 12, fontWeight: "bold", color: "#818cf8" }}
              >
                ∞ Endless Siege
              </span>
              <span style={{ fontSize: 9, color: "#475569" }}>No limit</span>
            </div>
            <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 5 }}>
              All towers unlocked. Waves get harder every 10 clears. Map
              rotates. Never ends.
            </div>
            <div style={{ fontSize: 9, color: "#4c1d95" }}>
              Difficulty escalates qualitatively, not just numerically.
            </div>
            <div
              style={{
                display: "flex",
                gap: 3,
                marginTop: 5,
                flexWrap: "wrap",
              }}
            >
              {Object.values(TOWER_TYPES).map((t) => (
                <span key={t.icon} style={{ fontSize: 13 }} title={t.name}>
                  {t.icon}
                </span>
              ))}
            </div>
          </div>

          {/* Fixed levels */}
          {LEVELS.map((lvl) => {
            const mapDef = MAPS[lvl.map];
            const isActive = lvl.id === levelId;
            return (
              <div
                key={lvl.id}
                onClick={() => handleLevelClick(lvl.id)}
                style={{
                  marginBottom: 6,
                  padding: "8px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: isActive ? "#111827" : "#0d1117",
                  border: `1px solid ${isActive ? "#38bdf8" : "#1e293b"}`,
                  transition: "all 0.12s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: "bold",
                      color: isActive ? "#38bdf8" : "#e2e8f0",
                    }}
                  >
                    Lv{lvl.id}. {lvl.name}
                  </span>
                  <span style={{ fontSize: 9, color: "#475569" }}>
                    {lvl.waves} waves
                  </span>
                </div>
                <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 4 }}>
                  {lvl.description}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    flexWrap: "wrap",
                    marginBottom: 4,
                  }}
                >
                  <Tag c="#0f2a0f" tc="#86efac">
                    🗺 {mapDef?.name || lvl.map}
                  </Tag>
                  <Tag c="#1a1a0a" tc="#fde68a">
                    💰 {lvl.startGold}g
                  </Tag>
                  <Tag c="#1a0a0a" tc="#fca5a5">
                    ❤ {lvl.startLives}
                  </Tag>
                  {Object.keys(lvl.bossWaves).length > 0 && (
                    <Tag c="#2a0a0a" tc="#ef4444">
                      💀 {Object.keys(lvl.bossWaves).length} boss
                    </Tag>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 3,
                    flexWrap: "wrap",
                    marginBottom: 4,
                  }}
                >
                  {lvl.unlockedTowers.map((t) => (
                    <span
                      key={t}
                      title={TOWER_TYPES[t]?.name}
                      style={{ fontSize: 13 }}
                    >
                      {TOWER_TYPES[t]?.icon || "?"}
                    </span>
                  ))}
                </div>
                {Object.keys(lvl.bossWaves).length > 0 && (
                  <div style={{ fontSize: 8, color: "#6b7280" }}>
                    {Object.entries(lvl.bossWaves).map(([w, t]) => (
                      <span key={w} style={{ marginRight: 6 }}>
                        W{w}: {ENEMY_TYPES[t]?.icon} {ENEMY_TYPES[t]?.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div
            style={{
              marginTop: 6,
              borderTop: "1px solid #1e293b",
              paddingTop: 8,
            }}
          >
            <button
              onClick={() => setShowAdmin(!showAdmin)}
              style={{
                fontSize: 9,
                fontFamily: mono,
                width: "100%",
                padding: "4px",
                background: "transparent",
                border: "1px solid #334155",
                borderRadius: 4,
                color: "#475569",
                cursor: "pointer",
              }}
            >
              {showAdmin ? "▲" : "▼"} ADMIN CONFIG
            </button>
            {showAdmin && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 9,
                  color: "#6b7280",
                  lineHeight: 1.9,
                }}
              >
                {Object.entries(ADMIN_CONFIG.ai).map(([k, v]) => (
                  <div
                    key={k}
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span>{k}</span>
                    <span style={{ color: "#a78bfa" }}>{v}</span>
                  </div>
                ))}
                <div
                  style={{ color: "#38bdf8", marginTop: 6, marginBottom: 3 }}
                >
                  Economy
                </div>
                {Object.entries(ADMIN_CONFIG.economy).map(([k, v]) => (
                  <div
                    key={k}
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span>{k}</span>
                    <span style={{ color: "#a78bfa" }}>{v}</span>
                  </div>
                ))}
                <div
                  style={{
                    color: "#4b5563",
                    marginTop: 6,
                    fontSize: 8,
                    lineHeight: 1.6,
                  }}
                >
                  Add levels → LEVELS[] in gameConstants.js
                  <br />
                  Add towers → TOWER_TYPES + TOWER_UPGRADES
                  <br />
                  Add maps → MAPS{"{}"}
                  <br />
                  Endless config → ENDLESS_CONFIG
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════ TAB: MARKET ══════════════════════════════════════════════════ */}
      {activeTab === "market" && (
        <GoldMarketPanel
          gameState={gameState}
          gold={gold}
          wave={wave}
          onBuyMarketItem={onBuyMarketItem}
          onCancelOvercharge={onCancelOvercharge}
        />
      )}

      {/* Achievements */}
      <div
        style={{
          marginTop: 10,
          borderTop: "1px solid #1e293b",
          paddingTop: 8,
          marginBottom: 10,
        }}
      >
        {/* Header — always visible, always clickable */}
        <div
          onClick={() => setShowAchievements((v) => !v)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: showAchievements ? 8 : 0,
            cursor: "pointer",
            userSelect: "none",
            padding: "2px 0",
          }}
        >
          <div
            style={{
              fontSize: 9,
              color:
                Object.keys(unlockedAchievements).length > 0
                  ? "#fbbf24"
                  : "#374151",
              letterSpacing: "0.1em",
            }}
          >
            🏅 ACHIEVEMENTS ({Object.keys(unlockedAchievements).length}/
            {Object.keys(ACHIEVEMENTS).length})
          </div>
          <div style={{ fontSize: 9, color: "#475569" }}>
            {showAchievements ? "▲ hide" : "▼ show"}
          </div>
        </div>

        {/* Body — only rendered when open */}
        {showAchievements && (
          <>
            {Object.keys(unlockedAchievements).length === 0 ? (
              <div
                style={{
                  fontSize: 9,
                  color: "#374151",
                  fontStyle: "italic",
                  padding: "4px 0",
                }}
              >
                No achievements yet. Play to unlock them.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 4,
                }}
              >
                {Object.values(ACHIEVEMENTS).map((ach) => {
                  const unlocked = !!unlockedAchievements[ach.id];
                  if (!unlocked && ach.secret) return null;
                  return (
                    <div
                      key={ach.id}
                      style={{
                        padding: "5px 7px",
                        borderRadius: 4,
                        background: unlocked ? "#1a1a0a" : "#0d1117",
                        border: `1px solid ${unlocked ? "#fbbf24" : "#1e293b"}`,
                        opacity: unlocked ? 1 : 0.4,
                      }}
                    >
                      <div style={{ fontSize: 12 }}>{ach.icon}</div>
                      <div
                        style={{
                          fontSize: 9,
                          color: unlocked ? "#fde68a" : "#6b7280",
                          fontWeight: "bold",
                        }}
                      >
                        {ach.name}
                      </div>
                      <div
                        style={{
                          fontSize: 8,
                          color: "#475569",
                          lineHeight: 1.4,
                        }}
                      >
                        {ach.secret && !unlocked ? "???" : ach.desc}
                        {unlocked &&
                          unlockedAchievements[ach.id]?.unlockedAt && (
                            <span
                              style={{
                                display: "block",
                                color: "#374151",
                                marginTop: 1,
                              }}
                            >
                              {new Date(
                                unlockedAchievements[ach.id].unlockedAt,
                              ).toLocaleDateString()}
                            </span>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* High Scores */}
      <div
        style={{ marginTop: 10, borderTop: "1px solid #1e293b", paddingTop: 8 }}
      >
        <div
          onClick={() => setShowHighScores((v) => !v)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: showHighScores ? 6 : 0,
            cursor: "pointer",
            userSelect: "none",
            padding: "2px 0",
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: highScores.length > 0 ? "#facc15" : "#374151",
              letterSpacing: "0.1em",
            }}
          >
            🏆 HIGH SCORES ({highScores.length})
          </div>
          <div style={{ fontSize: 9, color: "#475569" }}>
            {showHighScores ? "▲ hide" : "▼ show"}
          </div>
        </div>

        {showHighScores && (
          <>
            {highScores.length === 0 ? (
              <div style={{ fontSize: 9, color: "#374151" }}>
                No scores yet. Play a game!
              </div>
            ) : (
              highScores.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    marginBottom: 4,
                    padding: "3px 6px",
                    background: i === 0 ? "#1a1a0a" : "transparent",
                    borderRadius: 4,
                    border:
                      i === 0 ? "1px solid #facc15" : "1px solid transparent",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: "bold",
                      color:
                        i === 0
                          ? "#facc15"
                          : i === 1
                            ? "#94a3b8"
                            : i === 2
                              ? "#b45309"
                              : "#374151",
                      minWidth: 14,
                    }}
                  >
                    #{i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: "#e2e8f0" }}>
                      {s.score.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 8, color: "#93c5fd" }}>
                      {s.playerName || "Unknown Commander"}
                    </div>
                    <div style={{ fontSize: 8, color: "#6b7280" }}>
                      {s.levelName} · W{s.wave} ·{" "}
                      {s.won ? (
                        <span style={{ color: "#4ade80" }}>WIN</span>
                      ) : (
                        <span style={{ color: "#ef4444" }}>LOSS</span>
                      )}{" "}
                      · {s.date}
                    </div>
                  </div>
                </div>
              ))
            )}
            {hasSave && (
              <div style={{ marginTop: 8 }}>
                <button
                  onClick={onDeleteSave}
                  style={{
                    width: "100%",
                    fontSize: 9,
                    fontFamily: mono,
                    padding: "3px",
                    background: "transparent",
                    border: "1px solid #3a1a1a",
                    borderRadius: 3,
                    color: "#6b7280",
                    cursor: "pointer",
                  }}
                >
                  🗑 Delete current save
                </button>
              </div>
            )}
            {highScores.length > 0 && (
              <button
                onClick={onClearScores}
                style={{
                  fontSize: 8,
                  fontFamily: mono,
                  padding: "1px 5px",
                  background: "transparent",
                  border: "1px solid #374151",
                  borderRadius: 3,
                  color: "#475569",
                  cursor: "pointer",
                }}
              >
                clear
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Upgrade Panel ────────────────────────────────────────────────────────────
function SkillBtn({
  skillType,
  path,
  skillDef,
  locked,
  taken,
  gold,
  onUpgrade,
  tower,
  scaledCost,
}) {
  if (!skillDef) return null;
  const displayCost = scaledCost ?? skillDef.cost;
  const canBuy = !locked && !taken && gold >= displayCost;
  return (
    <button
      onClick={() => canBuy && onUpgrade(tower.col, tower.row, skillType, path)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 7,
        padding: "7px 9px",
        width: "100%",
        textAlign: "left",
        marginBottom: 4,
        background: taken ? "#0f2a0f" : locked ? "#1a0a0a" : "#0d1117",
        border: `1px solid ${taken ? "#4ade80" : locked ? "#3a1a1a" : canBuy ? "#fbbf24" : "#1e293b"}`,
        borderRadius: 5,
        color: locked && !taken ? "#374151" : "#e2e8f0",
        cursor: canBuy ? "pointer" : "default",
        fontFamily: "monospace",
        opacity: locked && !taken ? 0.45 : 1,
      }}
    >
      <span style={{ fontSize: 16 }}>{skillDef.icon}</span>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: "bold",
            color: taken ? "#4ade80" : "#e2e8f0",
          }}
        >
          {skillDef.name}
          {taken ? " ✓" : ""}
        </div>
        <div style={{ fontSize: 9, color: "#6b7280", lineHeight: 1.4 }}>
          {skillDef.desc}
        </div>
        {formatSpecialTags(skillDef).length > 0 && (
          <div style={{ fontSize: 8, color: "#818cf8", marginTop: 1 }}>
            ✦ {formatSpecialTags(skillDef).join(" · ")}
          </div>
        )}
        {getSkillStackHints(skillDef).map((hint) => (
          <div
            key={hint}
            style={{
              fontSize: 8,
              color: "#fbbf24",
              marginTop: 2,
              lineHeight: 1.3,
            }}
          >
            ⚠ {hint}
          </div>
        ))}
      </div>
      {!taken && !locked && (
        <div
          style={{
            fontSize: 10,
            color: gold >= displayCost ? "#facc15" : "#374151",
            fontWeight: "bold",
            minWidth: 36,
            textAlign: "right",
          }}
        >
          {displayCost}g
        </div>
      )}
    </button>
  );
}

// Upgrade panel for a selected tower, showing passive tiers and skill choices.
function UpgradePanel({ tower, onUpgrade, onRepairTower, gold, currentWave }) {
  const def = TOWER_TYPES[tower.type];
  const upgDef = TOWER_UPGRADES[tower.type];

  if (!def || !upgDef)
    return <div style={{ fontSize: 10, color: "#374151" }}>No upgrades.</div>;

  const passiveTier = tower.passiveTier || 0;
  const nextPassive = upgDef.passives.find((p) => p.tier > passiveTier);
  const s5 = upgDef.skill5,
    s10 = upgDef.skill10;
  const l50 = upgDef.legendary50,
    l100 = upgDef.legendary100,
    a200 = upgDef.ascension200;

  const l50ScaledCost = l50?.A?.cost
    ? Math.floor(l50.A.cost * (1 + currentWave * 0.04))
    : l50?.B?.cost
      ? Math.floor(l50.B.cost * (1 + currentWave * 0.04))
      : 0;
  const l100ScaledCost = l100?.A?.cost
    ? Math.floor(l100.A.cost * (1 + currentWave * 0.06))
    : l100?.B?.cost
      ? Math.floor(l100.B.cost * (1 + currentWave * 0.06))
      : 0;
  const a200ScaledCost = a200?.A?.cost
    ? Math.floor(a200.A.cost * (1 + currentWave * 0.08) + gold * 0.1)
    : a200?.B?.cost
      ? Math.floor(a200.B.cost * (1 + currentWave * 0.08) + gold * 0.1)
      : 0;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          padding: "7px 9px",
          background: "#111827",
          borderRadius: 5,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: "bold", color: def.color }}>
            {def.name} <span style={{ color: "#475569" }}>P{passiveTier}</span>
          </div>
          <div style={{ fontSize: 9, color: "#6b7280" }}>
            {tower.kills} kills · {Math.floor(tower.xp)} xp
          </div>
        </div>
      </div>

      {/* Repair button — only shown when damaged */}
      {tower.hp < tower.maxHp && (
        <div
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            background: tower.disabled ? "#2a0a0a" : "#1a1400",
            border: `1px solid ${tower.disabled ? "#ef4444" : "#f97316"}`,
            borderRadius: 5,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 5,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: tower.disabled ? "#ef4444" : "#f97316",
              }}
            >
              {tower.disabled ? "⚠ DISABLED" : "🔧 DAMAGED"}
            </div>
            <div style={{ fontSize: 9, color: "#6b7280" }}>
              {Math.ceil(tower.hp)}/{tower.maxHp} HP
            </div>
          </div>
          <div
            style={{
              height: 4,
              background: "#1e293b",
              borderRadius: 2,
              marginBottom: 7,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(tower.hp / tower.maxHp) * 100}%`,
                background:
                  tower.hp / tower.maxHp > 0.6
                    ? "#4ade80"
                    : tower.hp / tower.maxHp > 0.3
                      ? "#facc15"
                      : "#ef4444",
                borderRadius: 2,
              }}
            />
          </div>
          <button
            onClick={() => onRepairTower(tower.col, tower.row)}
            disabled={gold < (tower.repairCost || 0)}
            style={{
              width: "100%",
              padding: "5px",
              background:
                gold >= (tower.repairCost || 0) ? "#1a2a0a" : "#111827",
              border: `1px solid ${gold >= (tower.repairCost || 0) ? "#4ade80" : "#374151"}`,
              borderRadius: 4,
              color: gold >= (tower.repairCost || 0) ? "#4ade80" : "#374151",
              fontFamily: mono,
              fontSize: 10,
              cursor:
                gold >= (tower.repairCost || 0) ? "pointer" : "not-allowed",
            }}
          >
            🔧 Repair — {tower.repairCost || 0}g
          </button>
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontSize: 9,
            color: "#38bdf8",
            letterSpacing: "0.08em",
            marginBottom: 4,
          }}
        >
          PASSIVE UPGRADES (auto)
        </div>
        <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
            const isSkill = n === 5 || n === 10;
            const done =
              n <= passiveTier ||
              (n === 5 && tower.skill5chosen) ||
              (n === 10 && tower.skill10chosen);
            return (
              <div
                key={n}
                style={{
                  flex: 1,
                  height: 18,
                  borderRadius: 3,
                  fontSize: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: "bold",
                  background: done
                    ? isSkill
                      ? "#fbbf24"
                      : "#1d4ed8"
                    : "#1e293b",
                  color: done ? "#000" : "#374151",
                  border: isSkill ? "1px solid #fbbf24" : "none",
                }}
              >
                {isSkill ? "S" : n}
              </div>
            );
          })}
        </div>
        {nextPassive && (
          <div style={{ fontSize: 9, color: "#4b5563" }}>
            Next passive at {nextPassive.xp} xp: {nextPassive.label}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ height: 5, background: "#1e293b", borderRadius: 3 }}>
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, (tower.xp / (nextPassive?.xp || s5?.xp || 999)) * 100)}%`,
              background: tower.upgradeReady ? "#fbbf24" : "#38bdf8",
              borderRadius: 3,
            }}
          />
        </div>
      </div>

      <div
        style={{
          fontSize: 9,
          color: "#fbbf24",
          letterSpacing: "0.08em",
          marginBottom: 5,
        }}
      >
        SKILL — TIER 5{" "}
        {!tower.skill5chosen && tower.passiveTier < 4
          ? "(reach passive 4 first)"
          : tower.xp < s5?.xp
            ? `(${s5.xp - Math.floor(tower.xp)} xp needed)`
            : ""}
      </div>
      <SkillBtn
        skillType="skill5"
        path="A"
        skillDef={s5?.A}
        locked={tower.passiveTier < 4 || tower.xp < s5?.xp}
        taken={tower.skill5chosen === "A"}
        gold={gold}
        onUpgrade={onUpgrade}
        tower={tower}
      />
      <SkillBtn
        skillType="skill5"
        path="B"
        skillDef={s5?.B}
        locked={tower.passiveTier < 4 || tower.xp < s5?.xp}
        taken={tower.skill5chosen === "B"}
        gold={gold}
        onUpgrade={onUpgrade}
        tower={tower}
      />

      <div
        style={{
          fontSize: 9,
          color: "#818cf8",
          letterSpacing: "0.08em",
          marginBottom: 5,
          marginTop: 10,
        }}
      >
        SKILL — TIER 10{" "}
        {!tower.skill5chosen
          ? "(complete skill 5 first)"
          : tower.passiveTier < 9
            ? "(reach passive 9 first)"
            : tower.xp < s10?.xp
              ? `(${s10.xp - Math.floor(tower.xp)} xp needed)`
              : ""}
      </div>
      <SkillBtn
        skillType="skill10"
        path="A"
        skillDef={s10?.A}
        locked={
          !tower.skill5chosen || tower.passiveTier < 9 || tower.xp < s10?.xp
        }
        taken={tower.skill10chosen === "A"}
        gold={gold}
        onUpgrade={onUpgrade}
        tower={tower}
      />
      <SkillBtn
        skillType="skill10"
        path="B"
        skillDef={s10?.B}
        locked={
          !tower.skill5chosen || tower.passiveTier < 9 || tower.xp < s10?.xp
        }
        taken={tower.skill10chosen === "B"}
        gold={gold}
        onUpgrade={onUpgrade}
        tower={tower}
      />

      {l50 && (
        <>
          <div
            style={{
              fontSize: 9,
              color: "#f59e0b",
              letterSpacing: "0.08em",
              marginBottom: 5,
              marginTop: 10,
            }}
          >
            ✦ LEGENDARY (wave {l50.unlocksAtWave}+){" "}
            {!tower.skill10chosen
              ? "(complete skill 10 first)"
              : currentWave < l50.unlocksAtWave
                ? `(reach wave ${l50.unlocksAtWave})`
                : tower.legendaryUnlocked
                  ? `✓ ${tower.legendary50Path === "A" ? l50.A?.name : l50.B?.name} chosen`
                  : "Choose one:"}
          </div>
          <SkillBtn
            skillType="legendary50"
            path="A"
            skillDef={l50?.A}
            locked={
              !tower.skill10chosen ||
              currentWave < l50.unlocksAtWave ||
              (tower.legendaryUnlocked && tower.legendary50Path !== "A")
            }
            taken={tower.legendaryUnlocked && tower.legendary50Path === "A"}
            gold={gold}
            onUpgrade={onUpgrade}
            tower={tower}
            scaledCost={l50ScaledCost}
          />
          <SkillBtn
            skillType="legendary50"
            path="B"
            skillDef={l50?.B}
            locked={
              !tower.skill10chosen ||
              currentWave < l50.unlocksAtWave ||
              (tower.legendaryUnlocked && tower.legendary50Path !== "B")
            }
            taken={tower.legendaryUnlocked && tower.legendary50Path === "B"}
            gold={gold}
            onUpgrade={onUpgrade}
            tower={tower}
            scaledCost={l50ScaledCost}
          />
        </>
      )}

      {l100 && tower.legendaryUnlocked && (
        <>
          <div
            style={{
              fontSize: 9,
              color: "#ef4444",
              letterSpacing: "0.08em",
              marginBottom: 5,
              marginTop: 10,
            }}
          >
            ✦✦ LEGENDARY (wave {l100.unlocksAtWave}+){" "}
            {currentWave < l100.unlocksAtWave
              ? `(reach wave ${l100.unlocksAtWave})`
              : tower.legendary100Unlocked
                ? `✓ ${tower.legendary100Path === "A" ? l100.A?.name : l100.B?.name} chosen`
                : "Choose one:"}
          </div>
          <SkillBtn
            skillType="legendary100"
            path="A"
            skillDef={l100?.A}
            locked={
              currentWave < l100.unlocksAtWave ||
              (tower.legendary100Unlocked && tower.legendary100Path !== "A")
            }
            taken={tower.legendary100Unlocked && tower.legendary100Path === "A"}
            gold={gold}
            onUpgrade={onUpgrade}
            tower={tower}
            scaledCost={l100ScaledCost}
          />
          <SkillBtn
            skillType="legendary100"
            path="B"
            skillDef={l100?.B}
            locked={
              currentWave < l100.unlocksAtWave ||
              (tower.legendary100Unlocked && tower.legendary100Path !== "B")
            }
            taken={tower.legendary100Unlocked && tower.legendary100Path === "B"}
            gold={gold}
            onUpgrade={onUpgrade}
            tower={tower}
            scaledCost={l100ScaledCost}
          />
        </>
      )}

      {a200 && (
        <>
          <div
            style={{
              fontSize: 9,
              color: "#c084fc",
              letterSpacing: "0.08em",
              marginBottom: 5,
              marginTop: 10,
            }}
          >
            ☄ ASCENSION (wave {a200.unlocksAtWave}+){" "}
            {currentWave < a200.unlocksAtWave
              ? `(reach wave ${a200.unlocksAtWave})`
              : tower.ascension200Unlocked
                ? `✓ ${tower.ascension200Path === "A" ? a200.A?.name : a200.B?.name} chosen`
                : "Choose one:"}
          </div>
          <SkillBtn
            skillType="ascension200"
            path="A"
            skillDef={a200?.A}
            locked={
              currentWave < a200.unlocksAtWave ||
              (tower.ascension200Unlocked && tower.ascension200Path !== "A")
            }
            taken={tower.ascension200Unlocked && tower.ascension200Path === "A"}
            gold={gold}
            onUpgrade={onUpgrade}
            tower={tower}
            scaledCost={a200ScaledCost}
          />
          <SkillBtn
            skillType="ascension200"
            path="B"
            skillDef={a200?.B}
            locked={
              currentWave < a200.unlocksAtWave ||
              (tower.ascension200Unlocked && tower.ascension200Path !== "B")
            }
            taken={tower.ascension200Unlocked && tower.ascension200Path === "B"}
            gold={gold}
            onUpgrade={onUpgrade}
            tower={tower}
            scaledCost={a200ScaledCost}
          />
        </>
      )}

      {tower.specials?.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 9, color: "#6b7280" }}>
          Active:{" "}
          <span style={{ color: "#818cf8" }}>{tower.specials.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

// ─── Enemy Inspect Panel ─────────────────────────────────────────────────────
function EnemyInspectPanel({ enemy, onClose }) {
  if (!enemy) return null;
  const def = ENEMY_TYPES[enemy.type];
  const hpPct = Math.max(0, enemy.hp / enemy.maxHp);

  const statusBadge = (active, color, label) =>
    active ? (
      <span
        style={{
          fontSize: 8,
          padding: "1px 5px",
          background: color + "22",
          color,
          border: `1px solid ${color}`,
          borderRadius: 3,
          marginRight: 3,
        }}
      >
        {label}
      </span>
    ) : null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0d1117",
          border: `2px solid ${enemy.isBoss ? "#ef4444" : "#334155"}`,
          borderRadius: 8,
          padding: "14px 16px",
          width: 260,
          fontFamily: "'Courier New', monospace",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 28 }}>{enemy.icon}</span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: "bold",
                color: enemy.isBoss ? "#fca5a5" : "#e2e8f0",
              }}
            >
              {enemy.name} {enemy.isBoss && "💀"}
            </div>
            <div style={{ fontSize: 9, color: "#6b7280" }}>{def?.desc}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#475569",
              fontSize: 14,
              cursor: "pointer",
              padding: "2px 6px",
            }}
          >
            ✕
          </button>
        </div>

        {/* HP bar */}
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 9,
              color: "#6b7280",
              marginBottom: 2,
            }}
          >
            <span>HP</span>
            <span>
              {enemy.hp} / {enemy.maxHp}
            </span>
          </div>
          <div style={{ height: 6, background: "#1e293b", borderRadius: 3 }}>
            <div
              style={{
                height: "100%",
                width: `${hpPct * 100}%`,
                background:
                  hpPct > 0.55
                    ? "#4ade80"
                    : hpPct > 0.28
                      ? "#facc15"
                      : "#ef4444",
                borderRadius: 3,
                transition: "width 0.1s",
              }}
            />
          </div>
        </div>

        {/* Stats grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "4px 10px",
            marginBottom: 8,
          }}
        >
          {[
            [
              "Armor",
              enemy.armor > 0 ? `${Math.round(enemy.armor * 100)}%` : "None",
              enemy.armor > 0.3 ? "#fca5a5" : "#94a3b8",
            ],
            ["Speed", enemy.speed, "#facc15"],
            [
              "Stealth",
              enemy.stealth ? "YES" : "No",
              enemy.stealth ? "#a78bfa" : "#374151",
            ],
            [
              "Phase",
              enemy.phaseTriggered ? "ACTIVE" : "Normal",
              enemy.phaseTriggered ? "#ff4444" : "#374151",
            ],
          ].map(([label, val, color]) => (
            <div key={label}>
              <div style={{ fontSize: 8, color: "#475569" }}>{label}</div>
              <div style={{ fontSize: 11, fontWeight: "bold", color }}>
                {val}
              </div>
            </div>
          ))}
        </div>

        {/* Active status effects */}
        <div style={{ marginBottom: 8 }}>
          {statusBadge(
            enemy.slowTimer > 0,
            "#a5f3fc",
            `❄ SLOWED (${Math.ceil(enemy.slowTimer / 60)}s)`,
          )}
          {statusBadge(
            enemy.stunTimer > 0,
            "#fbbf24",
            `⚡ STUNNED (${Math.ceil(enemy.stunTimer / 60)}s)`,
          )}
          {statusBadge(
            enemy.burnTimer > 0,
            "#f97316",
            `🔥 BURNING${enemy.burnStacks > 1 ? ` ×${enemy.burnStacks}` : ""}`,
          )}
        </div>

        {/* Immunities / weakness */}
        {(def?.immunities?.length > 0 || def?.weakness) && (
          <div
            style={{
              marginBottom: 8,
              display: "flex",
              gap: 3,
              flexWrap: "wrap",
            }}
          >
            {def.immunities?.map((im) => (
              <span
                key={im}
                style={{
                  fontSize: 8,
                  padding: "1px 5px",
                  background: "#3a1a1a",
                  color: "#fca5a5",
                  border: "1px solid #7f1d1d",
                  borderRadius: 3,
                }}
              >
                🚫 {TOWER_TYPES[im]?.name || im}
              </span>
            ))}
            {def?.weakness && (
              <span
                style={{
                  fontSize: 8,
                  padding: "1px 5px",
                  background: "#0f2a0f",
                  color: "#86efac",
                  border: "1px solid #166534",
                  borderRadius: 3,
                }}
              >
                ✓ {TOWER_TYPES[def.weakness]?.name}
              </span>
            )}
          </div>
        )}

        {/* Lore / tip */}
        {def?.lore && (
          <div
            style={{
              fontSize: 9,
              color: "#4b5563",
              lineHeight: 1.5,
              marginBottom: 6,
              fontStyle: "italic",
            }}
          >
            "{def.lore}"
          </div>
        )}
        {def?.tip && (
          <div
            style={{
              fontSize: 9,
              color: "#fbbf24",
              lineHeight: 1.5,
              padding: "4px 6px",
              background: "#1a1a0a",
              borderRadius: 4,
              border: "1px solid #3a3000",
            }}
          >
            💡 {def.tip}
          </div>
        )}

        {/* Distance traveled */}
        <div style={{ fontSize: 8, color: "#374151", marginTop: 6 }}>
          Distance traveled: {enemy.distanceTraveled}px
        </div>
      </div>
    </div>
  );
}

// ─── Gold Market Panel ────────────────────────────────────────────────────────
function GoldMarketPanel({
  gameState,
  gold,
  wave,
  onBuyMarketItem,
  onCancelOvercharge,
}) {
  const market = gameState?.goldMarket;
  // const state = gameState?.state;

  const getScaledCost = (item) =>
    Math.floor(item.baseCost * (1 + wave * item.costScaling));

  const canBuyItem = (item) => {
    const cost = getScaledCost(item);
    if (gold < cost) return false;
    if (item.id === "war_bond" && market?.warBond) return false;
    if (item.id === "dark_pact" && market?.darkPactUses >= 5) return false;
    return true;
  };

  const marketEntries = Object.values(GOLD_MARKET_ITEMS);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "10px 11px" }}>
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: 11,
            color: "#facc15",
            fontWeight: "bold",
            marginBottom: 4,
          }}
        >
          💰 GOLD MARKET
        </div>
        <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.5 }}>
          Spend excess gold on powerful one-wave effects. Effects become pricier
          as waves progress.
        </div>
      </div>

      {/* Active states */}
      {market?.warBond && (
        <div
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            background: "#061a06",
            border: "1px solid #4ade80",
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 9, color: "#475569", marginBottom: 3 }}>
            ACTIVE WAR BOND
          </div>
          <div style={{ fontSize: 12, color: "#4ade80", fontWeight: "bold" }}>
            🏦 {market.warBond.bet}g →{" "}
            {market.warBond.bet * market.warBond.multiplier}g
          </div>
          <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>
            Zero leaks this wave to collect!
          </div>
        </div>
      )}

      {market?.pendingOvercharge && (
        <div
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            background: "#1a1400",
            border: "2px solid #fbbf24",
            borderRadius: 6,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "#fbbf24", fontWeight: "bold" }}>
              ⚡ Awaiting target...
            </div>
            <div style={{ fontSize: 9, color: "#64748b" }}>
              Click a tower on the map
            </div>
          </div>
          <button
            onClick={onCancelOvercharge}
            style={{
              padding: "4px 8px",
              background: "#1e293b",
              border: "1px solid #475569",
              borderRadius: 4,
              color: "#94a3b8",
              fontFamily: mono,
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            ✕ Cancel
          </button>
        </div>
      )}

      {market?.armsDealActive && (
        <div
          style={{
            marginBottom: 10,
            padding: "7px 10px",
            background: "#160a20",
            border: "1px solid #e879f9",
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 11, color: "#e879f9", fontWeight: "bold" }}>
            🔫 Arms Deal Active
          </div>
          <div style={{ fontSize: 9, color: "#64748b" }}>
            All towers: +1 chain, +25% range, +15% dmg this wave
          </div>
        </div>
      )}

      {market?.mercenaryCount > 0 && (
        <div
          style={{
            marginBottom: 10,
            padding: "7px 10px",
            background: "#1a0a0a",
            border: "1px solid #f43f5e",
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 11, color: "#f43f5e", fontWeight: "bold" }}>
            🗡️ {market.mercenaryCount} Mercenary
            {market.mercenaryCount > 1 ? "s" : ""} Active
          </div>
          {market.mercenaries?.map((m) => (
            <div
              key={m.id}
              style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}
            >
              {Math.ceil(m.timer / 60)}s remaining · {m.damage} dmg/hit
            </div>
          ))}
        </div>
      )}

      {/* Market items */}
      {marketEntries.map((item) => {
        const cost = getScaledCost(item);
        const canBuy = canBuyItem(item);
        const isTaken = item.id === "war_bond" && market?.warBond;
        const isMaxed = item.id === "dark_pact" && market?.darkPactUses >= 5;
        const isPending = item.id === "overcharge" && market?.pendingOvercharge;

        return (
          <div
            key={item.id}
            style={{
              marginBottom: 8,
              padding: "10px 11px",
              background: canBuy ? "#0d1117" : "#080c12",
              border: `1px solid ${canBuy ? item.color + "66" : "#1e293b"}`,
              borderRadius: 6,
              opacity: isTaken || isMaxed ? 0.55 : 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
              <span style={{ fontSize: 24, lineHeight: 1 }}>{item.icon}</span>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 3,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: "bold",
                      color: canBuy ? item.color : "#374151",
                    }}
                  >
                    {item.name}
                  </span>
                  {item.id === "dark_pact" && market?.darkPactUses > 0 && (
                    <span style={{ fontSize: 9, color: "#6b7280" }}>
                      uses: {market.darkPactUses}/5
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#6b7280",
                    lineHeight: 1.45,
                    marginBottom: 8,
                  }}
                >
                  {item.desc}
                </div>
                <button
                  onClick={() =>
                    !isTaken &&
                    !isMaxed &&
                    !isPending &&
                    canBuy &&
                    onBuyMarketItem(item.id)
                  }
                  disabled={!canBuy || isTaken || isMaxed || isPending}
                  style={{
                    width: "100%",
                    padding: "7px",
                    background:
                      canBuy && !isTaken && !isMaxed && !isPending
                        ? `${item.color}22`
                        : "#111827",
                    border: `1px solid ${canBuy && !isTaken && !isMaxed && !isPending ? item.color : "#1e293b"}`,
                    borderRadius: 4,
                    color:
                      canBuy && !isTaken && !isMaxed && !isPending
                        ? item.color
                        : "#374151",
                    fontFamily: mono,
                    fontSize: 11,
                    fontWeight: "bold",
                    cursor:
                      canBuy && !isTaken && !isMaxed && !isPending
                        ? "pointer"
                        : "not-allowed",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>
                    {isTaken
                      ? "Bond active"
                      : isMaxed
                        ? "Max uses reached"
                        : isPending
                          ? "Awaiting target..."
                          : `Buy ${item.name}`}
                  </span>
                  <span style={{ color: gold >= cost ? "#facc15" : "#374151" }}>
                    {isMaxed ? "—" : `${cost}g`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Dark pact diminishing returns warning */}
      {market?.darkPactUses > 0 && (
        <div
          style={{
            fontSize: 9,
            color: "#475569",
            textAlign: "center",
            marginTop: 4,
          }}
        >
          Dark Pact returns:{" "}
          {Math.round(Math.max(20, 100 - (market.darkPactUses - 1) * 20))}%
          (diminishes each use)
        </div>
      )}
    </div>
  );
}

// ─── tiny helpers ─────────────────────────────────────────────────────────────
function SB({ label, val, c }) {
  return (
    <div style={{ background: "#111827", borderRadius: 4, padding: "4px 5px" }}>
      <div style={{ fontSize: 8, color: "#374151", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div style={{ fontSize: 12, fontWeight: "bold", color: c }}>{val}</div>
    </div>
  );
}

function Sect({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontSize: 9,
          color: "#475569",
          letterSpacing: "0.1em",
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Tag({ c, tc, children }) {
  return (
    <span
      style={{
        fontSize: 8,
        padding: "1px 5px",
        background: c,
        color: tc,
        borderRadius: 3,
      }}
    >
      {children}
    </span>
  );
}

function getCommanderRank(stats) {
  const points =
    stats.totalRuns * 10 +
    stats.totalWins * 35 +
    stats.bestWave * 4 +
    Math.floor(stats.bestScore / 250) +
    Math.floor(stats.totalEnemiesDestroyed / 20);

  const tiers = [
    { min: 0, title: "Cadet", color: "#93c5fd" },
    { min: 120, title: "Lieutenant", color: "#86efac" },
    { min: 280, title: "Captain", color: "#fbbf24" },
    { min: 520, title: "Major", color: "#f97316" },
    { min: 900, title: "Commander", color: "#c084fc" },
    { min: 1400, title: "Marshal", color: "#f472b6" },
  ];

  let currentTier = tiers[0];
  let nextTier = null;

  for (let i = 0; i < tiers.length; i++) {
    if (points >= tiers[i].min) {
      currentTier = tiers[i];
      nextTier = tiers[i + 1] || null;
    }
  }

  const currentFloor = currentTier.min;
  const nextFloor = nextTier?.min || currentFloor;
  const span = Math.max(1, nextFloor - currentFloor);
  const progressPct = nextTier
    ? Math.max(0, Math.min(100, ((points - currentFloor) / span) * 100))
    : 100;

  return {
    title: currentTier.title,
    color: currentTier.color,
    points,
    level: Math.max(1, 1 + Math.floor(points / 120)),
    progressPct,
    nextLabel: nextTier
      ? `${Math.max(0, nextTier.min - points)} to ${nextTier.title}`
      : "Max tier reached",
  };
}

function getTopMemoryKey(record) {
  let topKey = null;
  let topValue = -Infinity;

  for (const [key, value] of Object.entries(record || {})) {
    if (typeof value !== "number") continue;
    if (value > topValue) {
      topKey = key;
      topValue = value;
    }
  }

  return topKey;
}

function getBestBossPressure(bossEncounters) {
  let bestBoss = null;
  let bestRate = -1;

  for (const [bossKey, entry] of Object.entries(bossEncounters || {})) {
    const encounters = entry?.encounters || 0;
    if (!encounters) continue;
    const kills = entry?.kills || 0;
    const failRate = 1 - kills / encounters;
    if (failRate > bestRate) {
      bestBoss = bossKey;
      bestRate = failRate;
    }
  }

  return bestBoss;
}

function getRivalDossier(memory) {
  const favoredTowerKey = getTopMemoryKey(memory?.towerUsageHistory);
  const favoredTower =
    TOWER_TYPES[favoredTowerKey]?.name ||
    favoredTowerKey ||
    "Insufficient data";

  const exploitKey = getTopMemoryKey(memory?.weaknessSuccessRate);
  const favoriteExploit =
    ENEMY_TYPES[exploitKey]?.name ||
    TOWER_TYPES[exploitKey]?.name ||
    exploitKey ||
    "No stable exploit";

  const strategyKey = getTopMemoryKey(memory?.strategyCounterHistory);
  const targetedStrategy =
    TOWER_TYPES[strategyKey]?.name || strategyKey || "Mixed builds";

  const bossKey = getBestBossPressure(memory?.bossEncounters);
  const bossPattern =
    ENEMY_TYPES[bossKey]?.name || bossKey || "Boss reads still forming";

  const observedRuns = memory?.gamesPlayed || 0;
  const totalWaves = memory?.totalWavesSurvived || 0;
  const exploitRate =
    exploitKey && typeof memory?.weaknessSuccessRate?.[exploitKey] === "number"
      ? Math.round(memory.weaknessSuccessRate[exploitKey] * 100)
      : null;

  let assessment =
    "The rival is still young. It has not gathered enough evidence to form a dangerous long-term profile.";

  if (observedRuns >= 2) {
    assessment = `The rival has observed ${observedRuns} runs and prefers ${favoriteExploit} pressure against ${targetedStrategy}.`;
  }
  if (observedRuns >= 4 && exploitRate !== null) {
    assessment = `The rival now expects ${favoriteExploit} to work ${exploitRate}% of the time and is increasingly willing to commit around ${bossPattern}.`;
  }

  return {
    observedRuns,
    totalWaves,
    favoredTower,
    favoriteExploit,
    targetedStrategy,
    bossPattern,
    assessment,
  };
}
