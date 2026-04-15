import { useState } from "react";
import {
  TOWER_TYPES,
  ENEMY_TYPES,
  LEVELS,
  MAPS,
  TOWER_CATEGORY_CAPS,
  ADMIN_CONFIG,
} from "./gameConstants.js";
import { getGlobalMemory } from "./WaveAI.js";

// ─── tiny helper ──────────────────────────────────────────────────────────────
const S = (base, extra = {}) => ({ ...base, ...extra });
const mono = "'Courier New', monospace";

export function HUD({
  gameState,
  selectedTower,
  activeTab,
  onSelectTower,
  onStartWave,
  onReset,
  onLevelSelect,
  onSetTab,
  onSellMode,
  sellMode,
}) {
  const [showAdmin, setShowAdmin] = useState(false);

  if (!gameState)
    return (
      <div
        style={{
          width: 300,
          background: "#0a0a14",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#475569",
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
    levelName,
    mapName,
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
    towers = [],
  } = gameState;

  const gm = getGlobalMemory();
  const canAfford = (type) => gold >= (TOWER_TYPES[type]?.cost || 9999);
  const isUnlocked = (type) => unlockedTowers.includes(type);
  const catLeft = (cat) =>
    Math.max(0, (towerCaps[cat] || 0) - (towerCatCounts[cat] || 0));

  // Next boss wave info
  const nextBossWave = Object.entries(bossWaves)
    .map(([w, t]) => ({ w: +w, t }))
    .find((e) => e.w > wave);
  const nextBossDef = nextBossWave ? ENEMY_TYPES[nextBossWave.t] : null;

  // Performance aggregation
  const towerPerf = towers.reduce((acc, t) => {
    if (!acc[t.type]) acc[t.type] = { kills: 0, damage: 0 };
    acc[t.type].kills += t.kills;
    acc[t.type].damage += t.damage;
    return acc;
  }, {});

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 300,
        minWidth: 300,
        maxWidth: 300,
        height: "100vh",
        background: "#0a0a14",
        borderLeft: "1px solid #1e293b",
        fontFamily: mono,
        color: "#e2e8f0",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div
        style={{
          background: "#06060f",
          borderBottom: "1px solid #1e293b",
          padding: "10px 12px",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "#475569",
            letterSpacing: "0.1em",
            marginBottom: 4,
          }}
        >
          {levelName} · {mapName}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 5,
          }}
        >
          <StatBox label="GOLD" value={`${gold}g`} color="#facc15" />
          <StatBox
            label="LIVES"
            value={lives}
            color={lives <= 5 ? "#ef4444" : "#4ade80"}
          />
          <StatBox
            label="WAVE"
            value={`${wave}/${totalWaves}`}
            color="#38bdf8"
          />
          <StatBox
            label="SCORE"
            value={score.toLocaleString()}
            color="#a78bfa"
          />
        </div>
      </div>

      {/* ── TABS ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid #1e293b",
          background: "#080810",
        }}
      >
        {["build", "intel", "stats", "levels"].map((tab) => (
          <button
            key={tab}
            onClick={() => onSetTab(tab)}
            style={{
              flex: 1,
              padding: "7px 0",
              fontSize: 9,
              fontFamily: mono,
              letterSpacing: "0.07em",
              background: activeTab === tab ? "#1e293b" : "transparent",
              color: activeTab === tab ? "#e2e8f0" : "#475569",
              border: "none",
              borderBottom:
                activeTab === tab
                  ? `2px solid ${tab === "intel" ? "#e879f9" : "#38bdf8"}`
                  : "2px solid transparent",
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            {tab === "build"
              ? "🔨"
              : tab === "intel"
                ? "🧠"
                : tab === "stats"
                  ? "📊"
                  : "🗺️"}{" "}
            {tab}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
           TAB: BUILD
         ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "build" && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* Category caps */}
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid #1e293b",
              background: "#0b0b18",
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: "#475569",
                letterSpacing: "0.1em",
                marginBottom: 5,
              }}
            >
              TOWER CAPS
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {Object.entries(TOWER_CATEGORY_CAPS).map(([cat, def]) => {
                const used = towerCatCounts[cat] || 0;
                const limit = towerCaps[cat] ?? def.cap;
                const pct = used / limit;
                return (
                  <div
                    key={cat}
                    style={{
                      flex: 1,
                      background: "#111827",
                      borderRadius: 5,
                      padding: "5px 6px",
                      border: `1px solid ${pct >= 1 ? "#ef4444" : "#1e293b"}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        color: pct >= 1 ? "#ef4444" : "#64748b",
                      }}
                    >
                      {def.icon} {def.label}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: "bold",
                        color:
                          pct >= 1
                            ? "#ef4444"
                            : pct > 0.7
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
                        marginTop: 3,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(100, pct * 100)}%`,
                          background:
                            pct >= 1
                              ? "#ef4444"
                              : pct > 0.7
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

          {/* Tower list */}
          <div
            style={{ padding: "8px 12px", borderBottom: "1px solid #1e293b" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
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
                {sellMode ? "✕ Cancel" : "💲 Sell"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {Object.entries(TOWER_TYPES).map(([key, def]) => {
                const unlocked = isUnlocked(key);
                const affordable = canAfford(key);
                const selected = selectedTower === key && !sellMode;
                const catFull = catLeft(def.category) <= 0;
                const disabled = !unlocked || catFull;
                const dimmed = !affordable || disabled;

                return (
                  <button
                    key={key}
                    onClick={() => !disabled && onSelectTower(key)}
                    disabled={disabled}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "6px 9px",
                      background: selected
                        ? "#1e293b"
                        : catFull
                          ? "#1a0a0a"
                          : "transparent",
                      border: selected
                        ? `1px solid ${def.color}`
                        : catFull
                          ? "1px solid #3a1a1a"
                          : "1px solid #1e293b",
                      borderRadius: 5,
                      color: dimmed ? "#374151" : "#e2e8f0",
                      cursor: disabled ? "not-allowed" : "pointer",
                      textAlign: "left",
                      fontFamily: mono,
                      opacity: !unlocked ? 0.4 : dimmed ? 0.65 : 1,
                      transition: "all 0.12s",
                    }}
                  >
                    <span style={{ fontSize: 17 }}>{def.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: "bold",
                          color: selected
                            ? def.color
                            : unlocked
                              ? "inherit"
                              : "#374151",
                        }}
                      >
                        {def.name}
                        {!unlocked && (
                          <span
                            style={{
                              fontSize: 9,
                              color: "#6b7280",
                              marginLeft: 4,
                            }}
                          >
                            🔒 LVL {def.unlockedAtLevel}
                          </span>
                        )}
                        {catFull && (
                          <span
                            style={{
                              fontSize: 9,
                              color: "#ef4444",
                              marginLeft: 4,
                            }}
                          >
                            CAP
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 9, color: "#4b5563" }}>
                        {def.desc}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", minWidth: 36 }}>
                      <div
                        style={{
                          fontSize: 11,
                          color:
                            affordable && !disabled ? "#facc15" : "#374151",
                          fontWeight: "bold",
                        }}
                      >
                        {def.cost}g
                      </div>
                      <div style={{ fontSize: 8, color: "#374151" }}>
                        {def.category}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Next boss warning */}
          {nextBossDef && (
            <div
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid #1e293b",
                background: "#1a0a0a",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#ef4444",
                  letterSpacing: "0.1em",
                  marginBottom: 4,
                }}
              >
                ⚠ NEXT BOSS — WAVE {nextBossWave.w}
              </div>
              <div
                style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
              >
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
                    style={{ fontSize: 9, color: "#6b7280", lineHeight: 1.4 }}
                  >
                    {nextBossDef.weaknessHint}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      display: "flex",
                      gap: 4,
                      flexWrap: "wrap",
                    }}
                  >
                    {nextBossDef.immunities.map((im) => (
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
                        ✓{" "}
                        {TOWER_TYPES[nextBossDef.weakness]?.name ||
                          nextBossDef.weakness}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Min required towers for next wave */}
          {Object.keys(minRequiredTowers).length > 0 && state === "idle" && (
            <div
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid #1e293b",
                background: "#0a120a",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#4ade80",
                  letterSpacing: "0.1em",
                  marginBottom: 5,
                }}
              >
                AI THREAT ASSESSMENT
              </div>
              <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 4 }}>
                Estimated minimum to survive:
              </div>
              {Object.entries(minRequiredTowers).map(([type, count]) => {
                const def = TOWER_TYPES[type];
                if (!def) return null;
                const current = towers.filter((t) => t.type === type).length;
                const ok = current >= count;
                return (
                  <div
                    key={type}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 3,
                      fontSize: 10,
                      color: ok ? "#4ade80" : "#f97316",
                    }}
                  >
                    <span>{def.icon}</span>
                    <span>{def.name}</span>
                    <span style={{ marginLeft: "auto", fontWeight: "bold" }}>
                      {current}/{count} {ok ? "✓" : "⚠"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Controls */}
          <div style={{ padding: "10px 12px", marginTop: "auto" }}>
            {state === "idle" && wave < totalWaves && (
              <button
                onClick={onStartWave}
                style={{
                  width: "100%",
                  padding: "10px",
                  background: "#0f2a0f",
                  border: "1px solid #4ade80",
                  borderRadius: 6,
                  color: "#4ade80",
                  fontFamily: mono,
                  fontSize: 12,
                  fontWeight: "bold",
                  cursor: "pointer",
                  letterSpacing: "0.05em",
                }}
              >
                ▶ SEND WAVE {wave + 1}
                {bossWaves[wave + 1] ? ` 💀 BOSS` : ""}
              </button>
            )}
            {state === "wave" && (
              <div
                style={{
                  textAlign: "center",
                  padding: "9px",
                  background: "#1a0f0a",
                  border: "1px solid #f97316",
                  borderRadius: 5,
                  color: "#f97316",
                  fontSize: 11,
                }}
              >
                ⚔ WAVE {wave} IN PROGRESS · {enemyCount} active ·{" "}
                {spawnRemaining} queued
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
                  borderRadius: 6,
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

      {/* ════════════════════════════════════════════════════════════════════
           TAB: INTEL
         ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "intel" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
          {/* AI pulse indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 10,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#e879f9",
                animation: "pulse 1.4s infinite",
              }}
            />
            <span
              style={{ fontSize: 9, color: "#e879f9", letterSpacing: "0.12em" }}
            >
              AI SYSTEM · {gm.gamesPlayed} GAMES REMEMBERED
            </span>
          </div>

          {/* AI message */}
          <div
            style={{
              background: "#12002a",
              border: "1px solid #3b1a5a",
              borderRadius: 6,
              padding: "9px 10px",
              fontSize: 11,
              color: "#c4b5fd",
              lineHeight: 1.55,
              marginBottom: 10,
              minHeight: 56,
            }}
          >
            {nextWaveMessage}
          </div>

          {/* Strategy detection */}
          <Section label="DETECTED STRATEGY">
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
                  ? "Still learning..."
                  : "No pattern yet"}
            </div>
          </Section>

          {/* Weaknesses AI is targeting */}
          {(aiSummary?.weaknesses || []).length > 0 && (
            <Section label="EXPLOITING YOUR GAPS">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {aiSummary.weaknesses.map((w) => {
                  const def = ENEMY_TYPES[w] || TOWER_TYPES[w];
                  return (
                    <span
                      key={w}
                      style={{
                        fontSize: 9,
                        padding: "2px 7px",
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
            </Section>
          )}

          {/* Current wave enemy types */}
          {lastEnemyTypes.length > 0 && (
            <Section label="CURRENT WAVE ENEMIES">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {lastEnemyTypes.map((type) => {
                  const def = ENEMY_TYPES[type];
                  if (!def) return null;
                  return (
                    <div
                      key={type}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                        padding: "4px 6px",
                        background: "#111827",
                        borderRadius: 5,
                        border: "1px solid #1e293b",
                        minWidth: 50,
                      }}
                    >
                      <span style={{ fontSize: 18 }}>{def.icon}</span>
                      <span style={{ fontSize: 8, color: "#64748b" }}>
                        {def.name}
                      </span>
                      {def.immunities?.length > 0 && (
                        <span style={{ fontSize: 7, color: "#ef4444" }}>
                          🚫{" "}
                          {def.immunities
                            .map((i) => TOWER_TYPES[i]?.name || i)
                            .join(",")}
                        </span>
                      )}
                      {def.isBoss && (
                        <span
                          style={{
                            fontSize: 7,
                            color: "#f97316",
                            fontWeight: "bold",
                          }}
                        >
                          BOSS
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Cross-game memory */}
          {gm.gamesPlayed >= 1 && (
            <Section label={`CROSS-GAME MEMORY (${gm.gamesPlayed} runs)`}>
              <div style={{ fontSize: 10, color: "#4b5563", marginBottom: 4 }}>
                Historical exploit success rates:
              </div>
              {Object.entries(gm.weaknessSuccessRate).map(([w, rate]) => {
                const def = ENEMY_TYPES[w] || TOWER_TYPES[w];
                return (
                  <div
                    key={w}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 12 }}>{def?.icon || "?"}</span>
                    <span style={{ fontSize: 10, flex: 1, color: "#6b7280" }}>
                      {def?.name || w}
                    </span>
                    <div
                      style={{
                        width: 60,
                        height: 4,
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
                        fontSize: 9,
                        color: "#6b7280",
                        minWidth: 28,
                        textAlign: "right",
                      }}
                    >
                      {Math.round(rate * 100)}%
                    </span>
                  </div>
                );
              })}
            </Section>
          )}

          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.2}}`}</style>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
           TAB: STATS
         ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "stats" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
          <Section label="TOWER PERFORMANCE">
            {Object.keys(towerPerf).length === 0 && (
              <div style={{ fontSize: 10, color: "#374151" }}>
                No towers placed yet.
              </div>
            )}
            {Object.entries(towerPerf).map(([type, s]) => {
              const def = TOWER_TYPES[type];
              if (!def) return null;
              return (
                <div
                  key={type}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 5,
                    padding: "5px 7px",
                    background: "#0d1117",
                    borderRadius: 5,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{def.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: "bold",
                        color: def.color,
                      }}
                    >
                      {def.name}
                    </div>
                    <div style={{ fontSize: 9, color: "#4b5563" }}>
                      {def.category}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#4ade80" }}>
                      {s.kills} 💀
                    </div>
                    <div style={{ fontSize: 9, color: "#f97316" }}>
                      {s.damage.toLocaleString()} dmg
                    </div>
                  </div>
                </div>
              );
            })}
          </Section>

          <Section label="CATEGORY USAGE">
            {Object.entries(TOWER_CATEGORY_CAPS).map(([cat, def]) => {
              const used = towerCatCounts[cat] || 0;
              const limit = towerCaps[cat] || def.cap;
              return (
                <div key={cat} style={{ marginBottom: 6 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 10,
                      color: "#6b7280",
                      marginBottom: 2,
                    }}
                  >
                    <span>
                      {def.icon} {def.label}
                    </span>
                    <span>
                      {used}/{limit}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 5,
                      background: "#1e293b",
                      borderRadius: 3,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, (used / limit) * 100)}%`,
                        background:
                          used / limit >= 1
                            ? "#ef4444"
                            : used / limit > 0.7
                              ? "#f97316"
                              : "#38bdf8",
                        borderRadius: 3,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </Section>

          <Section label="AI GLOBAL MEMORY">
            <div style={{ fontSize: 10, color: "#6b7280" }}>
              Games played:{" "}
              <span style={{ color: "#e879f9" }}>{gm.gamesPlayed}</span>
            </div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>
              Waves total:{" "}
              <span style={{ color: "#38bdf8" }}>{gm.totalWavesSurvived}</span>
            </div>
            <div style={{ fontSize: 10, color: "#6b7280", marginTop: 4 }}>
              Player tendencies:
            </div>
            {Object.entries(gm.playerTendencies).map(([type, val]) => {
              const def = TOWER_TYPES[type];
              if (!def || val < 0.5) return null;
              return (
                <div
                  key={type}
                  style={{
                    fontSize: 9,
                    color: "#4b5563",
                    marginLeft: 8,
                    marginTop: 2,
                  }}
                >
                  {def.icon} {def.name}:{" "}
                  <span style={{ color: "#a78bfa" }}>{val.toFixed(1)}</span>
                </div>
              );
            })}
          </Section>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
           TAB: LEVELS
         ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "levels" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
          <div
            style={{
              fontSize: 9,
              color: "#475569",
              letterSpacing: "0.1em",
              marginBottom: 8,
            }}
          >
            SELECT LEVEL
          </div>
          {LEVELS.map((lvl) => {
            const mapDef = MAPS[lvl.map];
            const isActive = lvl.id === gameState.levelId;
            return (
              <div
                key={lvl.id}
                onClick={() =>
                  (state === "idle" ||
                    state === "gameover" ||
                    state === "victory") &&
                  onLevelSelect(lvl.id)
                }
                style={{
                  marginBottom: 8,
                  padding: "9px 11px",
                  borderRadius: 7,
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
                    marginBottom: 3,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: "bold",
                      color: isActive ? "#38bdf8" : "#e2e8f0",
                    }}
                  >
                    {lvl.name}
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
                  <span
                    style={{
                      fontSize: 8,
                      padding: "1px 5px",
                      background: "#0f2a0f",
                      color: "#86efac",
                      borderRadius: 3,
                    }}
                  >
                    🗺 {mapDef?.name || lvl.map}
                  </span>
                  <span
                    style={{
                      fontSize: 8,
                      padding: "1px 5px",
                      background: "#1a1a0a",
                      color: "#fde68a",
                      borderRadius: 3,
                    }}
                  >
                    💰 {lvl.startGold}g
                  </span>
                  <span
                    style={{
                      fontSize: 8,
                      padding: "1px 5px",
                      background: "#1a0a0a",
                      color: "#fca5a5",
                      borderRadius: 3,
                    }}
                  >
                    ❤ {lvl.startLives}
                  </span>
                  {Object.keys(lvl.bossWaves).length > 0 && (
                    <span
                      style={{
                        fontSize: 8,
                        padding: "1px 5px",
                        background: "#2a0a0a",
                        color: "#ef4444",
                        borderRadius: 3,
                      }}
                    >
                      💀 {Object.keys(lvl.bossWaves).length} boss
                      {Object.keys(lvl.bossWaves).length > 1 ? "es" : ""}
                    </span>
                  )}
                </div>
                {/* Tower unlocks */}
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {lvl.unlockedTowers.map((t) => (
                    <span
                      key={t}
                      title={TOWER_TYPES[t]?.name}
                      style={{ fontSize: 14 }}
                    >
                      {TOWER_TYPES[t]?.icon || "?"}
                    </span>
                  ))}
                </div>
                {/* Boss schedule */}
                {Object.keys(lvl.bossWaves).length > 0 && (
                  <div style={{ marginTop: 5, fontSize: 9, color: "#6b7280" }}>
                    Bosses:{" "}
                    {Object.entries(lvl.bossWaves).map(([w, t]) => (
                      <span key={w} style={{ marginRight: 5 }}>
                        W{w}: {ENEMY_TYPES[t]?.icon} {ENEMY_TYPES[t]?.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Admin config toggle */}
          <div
            style={{
              marginTop: 8,
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
                padding: "5px",
                background: "transparent",
                border: "1px solid #334155",
                borderRadius: 4,
                color: "#475569",
                cursor: "pointer",
                letterSpacing: "0.08em",
              }}
            >
              {showAdmin ? "▲" : "▼"} ADMIN CONFIG
            </button>

            {showAdmin && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 9,
                  color: "#6b7280",
                  lineHeight: 1.8,
                }}
              >
                <div style={{ color: "#38bdf8", marginBottom: 4 }}>
                  AI Settings (edit gameConstants.js)
                </div>
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
                  style={{ color: "#38bdf8", marginTop: 6, marginBottom: 4 }}
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
                    lineHeight: 1.5,
                  }}
                >
                  To add levels: add entries to LEVELS[].
                  <br />
                  To add maps: add entries to MAPS{}.<br />
                  To add towers: add to TOWER_TYPES{}.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ background: "#111827", borderRadius: 5, padding: "5px 6px" }}>
      <div style={{ fontSize: 8, color: "#374151", letterSpacing: "0.1em" }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: "bold", color }}>{value}</div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 9,
          color: "#475569",
          letterSpacing: "0.1em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
