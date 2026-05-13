/**
 * MapSelectScreen.jsx
 * Drop-in map picker shown before an Endless run starts.
 *
 * Props:
 *   onSelect(mapKey, mapDef) — called with the chosen map key + definition
 *   onBack()                 — called when player cancels
 *
 * Depends on:
 *   generateDynamicMap  — imported from gameConstants.js
 *   MAPS                — imported from gameConstants.js
 */

import { useState } from "react";
import { MAPS, generateDynamicMap } from "./gameConstants.js";

// ─── static map entries in display order ─────────────────────────────────────
const STATIC_MAPS = [
  { key: "valley", emoji: "🌋" },
  { key: "spiral", emoji: "🌀" },
  { key: "gauntlet", emoji: "⚔️" },
  { key: "abyss", emoji: "🌑" },
];

// ─── helpers ──────────────────────────────────────────────────────────────────
function accentFromTheme(theme) {
  return theme?.accent ?? "#818cf8";
}

function difficultyLabel(key) {
  return (
    { valley: "Easy", spiral: "Medium", gauntlet: "Hard", abyss: "Brutal" }[
      key
    ] ?? "???"
  );
}

function difficultyColor(key) {
  return (
    {
      valley: "#4ade80",
      spiral: "#facc15",
      gauntlet: "#f97316",
      abyss: "#ef4444",
    }[key] ?? "#94a3b8"
  );
}

// ─── tiny animated path preview ───────────────────────────────────────────────
function PathPreview({ waypoints, theme }) {
  if (!waypoints || waypoints.length < 2) return null;

  const COLS = 30,
    ROWS = 20;
  const W = 160,
    H = 107;
  const scaleX = W / COLS;
  const scaleY = H / ROWS;

  const points = waypoints.map((wp) => ({
    x: wp.col * scaleX + scaleX / 2,
    y: wp.row * scaleY + scaleY / 2,
  }));

  const pathD = points.reduce(
    (acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`),
    "",
  );

  const accent = accentFromTheme(theme);
  const bg = theme?.bg ?? "#0f172a";
  const border = theme?.pathBorder ?? "#334155";

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ borderRadius: 6, display: "block" }}
    >
      {/* background */}
      <rect width={W} height={H} fill={bg} />

      {/* subtle grid */}
      {Array.from({ length: 6 }).map((_, i) => (
        <line
          key={`h${i}`}
          x1={0}
          y1={(H * (i + 1)) / 6}
          x2={W}
          y2={(H * (i + 1)) / 6}
          stroke={border}
          strokeWidth={0.4}
          opacity={0.4}
        />
      ))}
      {Array.from({ length: 9 }).map((_, i) => (
        <line
          key={`v${i}`}
          x1={(W * (i + 1)) / 9}
          y1={0}
          x2={(W * (i + 1)) / 9}
          y2={H}
          stroke={border}
          strokeWidth={0.4}
          opacity={0.4}
        />
      ))}

      {/* path glow */}
      <path
        d={pathD}
        fill="none"
        stroke={accent}
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.15}
      />
      {/* path line */}
      <path
        d={pathD}
        fill="none"
        stroke={accent}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
        strokeDasharray="4 3"
      />

      {/* entry dot */}
      <circle cx={points[0].x} cy={points[0].y} r={4} fill="#4ade80" />
      {/* exit dot */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={4}
        fill="#ef4444"
      />
    </svg>
  );
}

// ─── single card ──────────────────────────────────────────────────────────────
function MapCard({ mapKey, mapDef, emoji, selected, onHover, onClick }) {
  const accent = accentFromTheme(mapDef.theme);
  const isSelected = selected;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => onHover(mapKey)}
      style={{
        position: "relative",
        cursor: "pointer",
        borderRadius: 10,
        padding: "14px 16px 12px",
        background: isSelected
          ? `linear-gradient(135deg, ${accent}22, ${accent}10)`
          : "rgba(15,23,42,0.7)",
        border: `2px solid ${isSelected ? accent : "rgba(255,255,255,0.08)"}`,
        boxShadow: isSelected ? `0 0 18px ${accent}44` : "none",
        transition: "border-color 0.18s, box-shadow 0.18s, background 0.18s",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 20 }}>{emoji}</span>
        <div style={{ flex: 1 }}>
          <div
            style={{
              color: isSelected ? accent : "#e2e8f0",
              fontFamily: "monospace",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: "0.04em",
            }}
          >
            {mapDef.name}
          </div>
          {mapKey !== "dynamic" && (
            <div
              style={{
                color: difficultyColor(mapKey),
                fontFamily: "monospace",
                fontSize: 10,
                marginTop: 1,
              }}
            >
              {difficultyLabel(mapKey)}
            </div>
          )}
        </div>
        {isSelected && (
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              color: "#000",
              fontWeight: 900,
            }}
          >
            ✓
          </div>
        )}
      </div>

      {/* path preview */}
      <PathPreview waypoints={mapDef.waypoints} theme={mapDef.theme} />

      {/* description */}
      <div
        style={{
          color: "#64748b",
          fontFamily: "monospace",
          fontSize: 10,
          lineHeight: 1.4,
        }}
      >
        {mapDef.description}
      </div>

      {/* bonus badge */}
      {mapDef.mapBonus && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "rgba(251,191,36,0.12)",
            border: "1px solid rgba(251,191,36,0.25)",
            borderRadius: 4,
            padding: "2px 7px",
            fontFamily: "monospace",
            fontSize: 9,
            color: "#fbbf24",
            alignSelf: "flex-start",
          }}
        >
          {mapDef.mapBonus.label}
        </div>
      )}
    </div>
  );
}

// ─── dynamic generate card ────────────────────────────────────────────────────
function DynamicCard({ selected, generating, onHover, onClick }) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => onHover("dynamic")}
      style={{
        cursor: "pointer",
        borderRadius: 10,
        padding: "14px 16px 12px",
        background: selected
          ? "linear-gradient(135deg, rgba(129,140,248,0.18), rgba(232,121,249,0.10))"
          : "rgba(15,23,42,0.7)",
        border: `2px solid ${selected ? "#818cf8" : "rgba(255,255,255,0.08)"}`,
        boxShadow: selected ? "0 0 18px rgba(129,140,248,0.35)" : "none",
        transition: "all 0.18s",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* shimmer bg when selected */}
      {selected && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(129,140,248,0.04) 8px, rgba(129,140,248,0.04) 16px)",
            pointerEvents: "none",
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 20 }}>{generating ? "⏳" : "🎲"}</span>
        <div style={{ flex: 1 }}>
          <div
            style={{
              color: selected ? "#818cf8" : "#e2e8f0",
              fontFamily: "monospace",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: "0.04em",
            }}
          >
            {generating ? "Generating…" : "Procedural Gauntlet"}
          </div>
          <div
            style={{
              color: "#818cf8",
              fontFamily: "monospace",
              fontSize: 10,
              marginTop: 1,
            }}
          >
            Random · Unique
          </div>
        </div>
        {selected && !generating && (
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#818cf8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              color: "#000",
              fontWeight: 900,
            }}
          >
            ✓
          </div>
        )}
      </div>

      {/* placeholder preview */}
      <div
        style={{
          width: 160,
          height: 107,
          borderRadius: 6,
          background: "rgba(129,140,248,0.07)",
          border: "1px dashed rgba(129,140,248,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#475569",
          fontFamily: "monospace",
          fontSize: 10,
        }}
      >
        {generating ? (
          <span style={{ color: "#818cf8" }}>⚙ building path…</span>
        ) : (
          "unique every run"
        )}
      </div>

      <div
        style={{
          color: "#64748b",
          fontFamily: "monospace",
          fontSize: 10,
          lineHeight: 1.4,
        }}
      >
        A fresh S-route layout generated at game start. No two runs alike.
      </div>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "rgba(129,140,248,0.12)",
          border: "1px solid rgba(129,140,248,0.25)",
          borderRadius: 4,
          padding: "2px 7px",
          fontFamily: "monospace",
          fontSize: 9,
          color: "#818cf8",
          alignSelf: "flex-start",
        }}
      >
        ⚔️ +8% tower damage
      </div>
    </div>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────
export default function MapSelectScreen({ onSelect, onBack }) {
  const [selected, setSelected] = useState("abyss");
  const [hoveredKey, setHoveredKey] = useState(null);
  const [generating, setGenerating] = useState(false);

  const activeKey = hoveredKey ?? selected;
  const activeMapDef =
    activeKey === "dynamic" ? null : (MAPS[activeKey] ?? MAPS.valley);

  function handleConfirm() {
    if (selected === "dynamic") {
      setGenerating(true);
      // tiny delay so the "Generating…" state is visible
      setTimeout(() => {
        const fresh = generateDynamicMap({ cols: 30, rows: 20 });
        onSelect("dynamic", fresh);
      }, 320);
    } else {
      onSelect(selected, MAPS[selected]);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background:
          "radial-gradient(ellipse at 50% 30%, #0d1220 0%, #050810 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        fontFamily: "monospace",
      }}
    >
      {/* bg grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* title */}
      <div
        style={{
          textAlign: "center",
          marginBottom: 28,
          position: "relative",
        }}
      >
        <div
          style={{
            color: "#1e3a5f",
            fontSize: 52,
            fontWeight: 900,
            letterSpacing: "0.08em",
            lineHeight: 1,
            position: "absolute",
            top: 2,
            left: "50%",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            userSelect: "none",
          }}
        >
          CHOOSE YOUR BATTLEFIELD
        </div>
        <div
          style={{
            color: "#e2e8f0",
            fontSize: 22,
            fontWeight: 900,
            letterSpacing: "0.12em",
            lineHeight: 1,
            position: "relative",
            whiteSpace: "nowrap",
          }}
        >
          ∞ ENDLESS SIEGE — CHOOSE YOUR BATTLEFIELD
        </div>
        <div
          style={{
            color: "#475569",
            fontSize: 11,
            marginTop: 6,
            letterSpacing: "0.08em",
          }}
        >
          The map you pick persists for the entire run
        </div>
      </div>

      {/* card grid: 3 across top, 3 across bottom */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 200px)",
          gap: 12,
          marginBottom: 24,
          position: "relative",
        }}
      >
        {STATIC_MAPS.map(({ key, emoji }) => (
          <MapCard
            key={key}
            mapKey={key}
            mapDef={MAPS[key]}
            emoji={emoji}
            selected={selected === key}
            onHover={setHoveredKey}
            onClick={() => setSelected(key)}
          />
        ))}
        {/* 5th static map placeholder could go here */}
        <DynamicCard
          selected={selected === "dynamic"}
          generating={generating}
          onHover={setHoveredKey}
          onClick={() => setSelected("dynamic")}
        />
      </div>

      {/* action row */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={onBack}
          disabled={generating}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#64748b",
            borderRadius: 6,
            padding: "10px 22px",
            fontFamily: "monospace",
            fontSize: 12,
            cursor: generating ? "not-allowed" : "pointer",
            letterSpacing: "0.06em",
          }}
        >
          ← BACK
        </button>

        <button
          onClick={handleConfirm}
          disabled={generating}
          style={{
            background: generating
              ? "#1e293b"
              : accentFromTheme(activeMapDef?.theme) === "#818cf8" ||
                  selected === "dynamic"
                ? "linear-gradient(135deg, #818cf8, #c084fc)"
                : `linear-gradient(135deg, ${accentFromTheme(activeMapDef?.theme)}, ${accentFromTheme(activeMapDef?.theme)}99)`,
            border: "none",
            color: generating ? "#475569" : "#000",
            borderRadius: 6,
            padding: "11px 36px",
            fontFamily: "monospace",
            fontSize: 13,
            fontWeight: 900,
            cursor: generating ? "not-allowed" : "pointer",
            letterSpacing: "0.1em",
            boxShadow: generating ? "none" : "0 0 20px rgba(129,140,248,0.35)",
            transition: "all 0.15s",
          }}
        >
          {generating
            ? "⚙ GENERATING…"
            : "▶ DEPLOY TO " +
              (selected === "dynamic"
                ? "PROCEDURAL MAP"
                : (MAPS[selected]?.name ?? "").toUpperCase())}
        </button>
      </div>

      {/* small legend */}
      <div
        style={{
          marginTop: 18,
          display: "flex",
          gap: 18,
          color: "#334155",
          fontSize: 10,
          letterSpacing: "0.06em",
        }}
      >
        <span>● Entry point</span>
        <span style={{ color: "#ef444455" }}>● Exit / Kingdom</span>
        <span>- - Path</span>
      </div>
    </div>
  );
}
