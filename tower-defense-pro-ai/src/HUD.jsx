import { useState } from "react";
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
} from "./gameConstants.js";
import { getGlobalMemory } from "./WaveAI.js";

const mono = "'Courier New', monospace";

export function HUD({
  gameState,
  selectedTower,
  activeTab,
  sellMode,
  onSelectTower,
  onSellMode,
  onStartWave,
  onReset,
  onLevelSelect,
  onSetTab,
  onUpgrade,
  onTriggerAbility,
  onTowerCellClick,
}) {
  const [confirmLevel, setConfirmLevel] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);

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
    activeSynergies = [],
    abilities = {},
    globalBuff,
    lastStandActive,
    towers = [],
  } = gameState;

  const gm = getGlobalMemory();
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 310,
        minWidth: 310,
        height: "100vh",
        background: "#0a0a14",
        borderLeft: "1px solid #1e293b",
        fontFamily: mono,
        color: "#e2e8f0",
        overflowY: "auto",
        overflowX: "hidden",
        position: "relative",
      }}
    >
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
            const ready = ab.cooldownLeft === 0 && state === "wave";
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
      </div>

      {/* ── TABS ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid #1e293b",
          background: "#070710",
        }}
      >
        {["build", "upgrade", "intel", "levels"].map((tab) => (
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
                  ? `2px solid ${{ build: "#4ade80", upgrade: "#fbbf24", intel: "#e879f9", levels: "#38bdf8" }[tab]}`
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

          {/* Synergy badges */}
          {activeSynergies.length > 0 && (
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
                  marginBottom: 3,
                }}
              >
                ✨ ACTIVE SYNERGIES
              </div>
              {activeSynergies.map((s) => (
                <div
                  key={s.key}
                  style={{ fontSize: 10, color: "#86efac", marginBottom: 2 }}
                >
                  <span style={{ color: s.color, marginRight: 4 }}>●</span>
                  {s.name}: {s.desc}
                </div>
              ))}
            </div>
          )}

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
            )}
            {state === "wave" && (
              <div
                style={{
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
}) {
  if (!skillDef) return null;
  const canBuy = !locked && !taken && gold >= skillDef.cost;
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
        {skillDef.special && (
          <div style={{ fontSize: 8, color: "#818cf8", marginTop: 1 }}>
            ✦ {skillDef.special}
          </div>
        )}
      </div>
      {!taken && !locked && (
        <div
          style={{
            fontSize: 10,
            color: gold >= skillDef.cost ? "#facc15" : "#374151",
            fontWeight: "bold",
            minWidth: 36,
            textAlign: "right",
          }}
        >
          {skillDef.cost}g
        </div>
      )}
    </button>
  );
}

function UpgradePanel({ tower, onUpgrade, gold, currentWave }) {
  const def = TOWER_TYPES[tower.type];
  const upgDef = TOWER_UPGRADES[tower.type];
  if (!def || !upgDef)
    return <div style={{ fontSize: 10, color: "#374151" }}>No upgrades.</div>;

  const passiveTier = tower.passiveTier || 0;
  const nextPassive = upgDef.passives.find((p) => p.tier > passiveTier);
  const s5 = upgDef.skill5,
    s10 = upgDef.skill10;
  const l50 = upgDef.legendary50,
    l100 = upgDef.legendary100;

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
                : ""}
          </div>
          <SkillBtn
            skillType="legendary50"
            path="A"
            skillDef={l50}
            locked={!tower.skill10chosen || currentWave < l50.unlocksAtWave}
            taken={tower.legendaryUnlocked}
            gold={gold}
            onUpgrade={onUpgrade}
            tower={tower}
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
            ✦✦ LEGENDARY (wave {l100.unlocksAtWave}+)
          </div>
          <SkillBtn
            skillType="legendary100"
            path="A"
            skillDef={l100}
            locked={currentWave < l100.unlocksAtWave}
            taken={tower.legendary100Unlocked}
            gold={gold}
            onUpgrade={onUpgrade}
            tower={tower}
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
