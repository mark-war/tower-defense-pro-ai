/**
 * RenderSystem.js — full canvas frame (grid, entities, HUD overlays).
 */

import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  TOWER_TYPES,
  ENEMY_TYPES,
  ABILITIES,
  ACHIEVEMENTS,
} from "../gameConstants.js";
import {
  roundRect,
  blendColor,
  shadeColor,
  drawPathCell,
  drawGroundCell,
  drawTowerShape,
  drawEnemyShape,
  drawProjectile,
} from "../helpers/drawHelpers.js";

export class RenderSystem {
  constructor(engine) {
    this.engine = engine;
  }

  draw() {
    const engine = this.engine;
    const ctx = engine.ctx;

    const skinMapTheme = engine.activeSkin?.maps?.[engine._currentMapKey];
    const theme = skinMapTheme
      ? { ...engine.mapDef.theme, ...skinMapTheme }
      : engine.mapDef.theme;

    const W = engine.canvas.width,
      H = engine.canvas.height;

    // ── Screen shake ──────────────────────────────────────────────────────────
    ctx.save();
    if (engine.shake.frames > 0) {
      engine.shake.frames--;
      engine.shake.x = (Math.random() - 0.5) * engine.shake.intensity;
      engine.shake.y = (Math.random() - 0.5) * engine.shake.intensity;
    } else {
      engine.shake.x = 0;
      engine.shake.y = 0;
    }
    ctx.translate(engine.shake.x, engine.shake.y);

    ctx.clearRect(-10, -10, W + 20, H + 20);

    // ── Background grid with scanlines ───────────────────────────────────────
    const mapStyle = engine.activeSkin?.mapStyle || "neon";

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const isPath = engine._isPathCell(col, row);
        const isSecondPath = engine._secondPathCells?.has(`${col},${row}`);
        const x = col * CELL_SIZE,
          y = row * CELL_SIZE;

        if (isPath || isSecondPath) {
          // Path base
          ctx.fillStyle =
            isSecondPath && !isPath
              ? blendColor(theme.path, "#4ade80", 0.15)
              : theme.path;
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          // subtle path glow
          ctx.fillStyle = "rgba(255,255,255,0.03)";
          ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);

          drawPathCell(ctx, x, y, CELL_SIZE, mapStyle, theme, engine.tick);
        } else {
          // Ground base — checkerboard
          ctx.fillStyle =
            (row + col) % 2 === 0 ? theme.bg : shadeColor(theme.bg, 8);
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          drawGroundCell(
            ctx,
            x,
            y,
            CELL_SIZE,
            mapStyle,
            theme,
            row,
            col,
            engine.tick,
          );
        }
        // thin grid lines
        ctx.strokeStyle = isPath ? theme.pathBorder : "rgba(255,255,255,0.03)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      }
    }

    // scanline overlay — every 2 rows, faint dark line
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

    // ── Path direction arrows ─────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = theme.pathBorder;
    ctx.lineWidth = 1;
    for (let i = 0; i < engine.path.length - 5; i += 10) {
      const a = engine.path[i],
        b = engine.path[Math.min(i + 5, engine.path.length - 1)];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 0);
      ctx.lineTo(2, -3);
      ctx.moveTo(4, 0);
      ctx.lineTo(2, 3);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // ── Second path arrows (dual front) ────────────────────────────────────
    if (engine._secondPath?.length > 1) {
      ctx.save();
      ctx.strokeStyle = "#4ade80"; // green to distinguish from main path
      ctx.lineWidth = 1;
      for (let i = 0; i < engine._secondPath.length - 5; i += 10) {
        const a = engine._secondPath[i];
        const b =
          engine._secondPath[Math.min(i + 5, engine._secondPath.length - 1)];
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(ang);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(-4, 0);
        ctx.lineTo(4, 0);
        ctx.lineTo(2, -3);
        ctx.moveTo(4, 0);
        ctx.lineTo(2, 3);
        ctx.stroke();
        ctx.restore();
      }
      // Entry point marker
      const entry = engine._secondPath[0];
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(engine.tick * 0.1));
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(entry.x, entry.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⚠ 2ND FRONT", entry.x, entry.y - 22);
      ctx.restore();
    }

    // ── Spawn camps + Kingdom ─────────────────────────────────────────────
    for (const camp of engine.spawnCamps) camp.draw(ctx, engine.tick);
    if (engine.kingdom) {
      const hpFrac = Math.max(0, engine.lives / engine.levelConfig.startLives);
      engine.kingdom.draw(ctx, hpFrac, engine.tick);
    }

    // ── Last-stand pulsing border ─────────────────────────────────────────────
    if (engine.lastStandActive) {
      const alpha = 0.3 + 0.3 * Math.sin(engine.tick * 0.2);
      ctx.strokeStyle = `rgba(239,68,68,${alpha})`;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, W - 8, H - 8);
    }

    // ── Wave modifier banner ──────────────────────────────────────────────────
    if (engine.activeModifier) {
      const mod = engine.activeModifier;
      const typeColor =
        mod.type === "buff"
          ? "#4ade80"
          : mod.type === "debuff"
            ? "#ef4444"
            : "#818cf8";
      ctx.fillStyle =
        mod.type === "buff"
          ? "rgba(74,222,128,0.12)"
          : mod.type === "debuff"
            ? "rgba(239,68,68,0.12)"
            : "rgba(129,140,248,0.12)";
      ctx.fillRect(0, 0, W, 30);
      ctx.fillStyle = typeColor;
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`${mod.icon} ${mod.name.toUpperCase()}: ${mod.desc}`, 8, 15);
      if (engine.silencedTowerType) {
        const tDef = TOWER_TYPES[engine.silencedTowerType];
        ctx.fillStyle = "#ef4444";
        ctx.textAlign = "right";
        ctx.fillText(
          `🔇 ${tDef?.name || engine.silencedTowerType} SILENCED`,
          W - 8,
          15,
        );
      }
      ctx.textBaseline = "alphabetic";
    }

    // ── Streak display ────────────────────────────────────────────────────────
    if (engine._streakCount >= 5) {
      const alpha = Math.min(1, engine._streakTimer / 30);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#fbbf24";
      ctx.font = `bold ${14 + Math.min(engine._streakCount, 20)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`🔥 ${engine._streakCount} STREAK!`, W / 2, H / 2 - 60);
      ctx.globalAlpha = 1;
      ctx.textBaseline = "alphabetic";
    }

    // ── Global buff banner ────────────────────────────────────────────────────
    if (engine.globalBuff.timer > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, 26);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `${engine.globalBuff.label}  [${Math.ceil(engine.globalBuff.timer / 60)}s]`,
        W / 2,
        13,
      );
    }

    // ── Hover highlight ───────────────────────────────────────────────────────
    if (engine.hoveredCell && !["gameover", "victory"].includes(engine.state)) {
      const { col, row } = engine.hoveredCell;
      const check = engine.canPlaceTower(col, row, engine.selectedTowerType);
      const cx = col * CELL_SIZE + CELL_SIZE / 2,
        cy = row * CELL_SIZE + CELL_SIZE / 2;
      ctx.fillStyle = check.ok
        ? "rgba(74,222,128,0.15)"
        : "rgba(239,68,68,0.12)";
      ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      if (check.ok) {
        const tDef = TOWER_TYPES[engine.selectedTowerType];
        // filled range circle
        ctx.beginPath();
        ctx.arc(cx, cy, tDef.range, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(74,222,128,0.04)";
        ctx.fill();
        ctx.strokeStyle = "rgba(74,222,128,0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ── TOWERS ────────────────────────────────────────────────────────────────
    for (const tower of engine.towers) {
      const cx = tower.x,
        cy = tower.y;
      const isSelected =
        engine.selectedTowerCell?.col === tower.col &&
        engine.selectedTowerCell?.row === tower.row;
      ctx.arc(
        cx,
        cy,
        TOWER_TYPES[engine.selectedTowerType].range,
        0,
        Math.PI * 2,
      );

      // last-stand red tint
      if (engine.lastStandActive) {
        ctx.fillStyle = "rgba(239,68,68,0.12)";
        ctx.fillRect(
          tower.col * CELL_SIZE + 1,
          tower.row * CELL_SIZE + 1,
          CELL_SIZE - 2,
          CELL_SIZE - 2,
        );
      }

      // base platform
      ctx.fillStyle = isSelected ? "#1e3050" : "#111827";
      roundRect(
        ctx,
        tower.col * CELL_SIZE + 2,
        tower.row * CELL_SIZE + 2,
        CELL_SIZE - 4,
        CELL_SIZE - 4,
        5,
      );
      ctx.fill();

      // selection/color border
      ctx.strokeStyle = isSelected ? "#ffffff" : tower.color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      roundRect(
        ctx,
        tower.col * CELL_SIZE + 2,
        tower.row * CELL_SIZE + 2,
        CELL_SIZE - 4,
        CELL_SIZE - 4,
        5,
      );
      ctx.stroke();

      // upgrade-ready gold pulse
      if (tower.upgradeReady) {
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(engine.tick * 0.12));
        ctx.strokeStyle = `rgba(251,191,36,${pulse})`;
        ctx.lineWidth = 2.5;
        roundRect(
          ctx,
          tower.col * CELL_SIZE + 1,
          tower.row * CELL_SIZE + 1,
          CELL_SIZE - 2,
          CELL_SIZE - 2,
          6,
        );
        ctx.stroke();
      }

      // ── Draw tower body (canvas shapes, no emoji) ─────────────────────────
      ctx.save();
      ctx.translate(cx, cy);

      // glow ring on cooldown flash
      const coolPct = 1 - tower.cooldown / tower.fireRate;
      if (coolPct > 0.85) {
        ctx.globalAlpha = ((coolPct - 0.85) / 0.15) * 0.4;
        ctx.fillStyle = tower.color;
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      drawTowerShape(ctx, tower, engine.tick, engine.activeSkin);
      ctx.restore();

      // range ring on select
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(cx, cy, tower.range, 0, Math.PI * 2);
        ctx.strokeStyle = tower.color + "55";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(cx, cy, tower.range, 0, Math.PI * 2);
        ctx.fillStyle = tower.color + "08";
        ctx.fill();
      }

      // Cyclone spin ring visual
      if (tower.specials?.includes("cyclone")) {
        const spinRadius = tower.range * 0.65;
        const rot = engine.tick * 0.08;
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.15 * Math.sin(engine.tick * 0.15);
        ctx.strokeStyle = tower.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 12]);
        ctx.lineDashOffset = -engine.tick * 0.8; // animates the dash moving
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, spinRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // 3 orbiting dots
        for (let i = 0; i < 3; i++) {
          const a = rot + i * ((Math.PI * 2) / 3);
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = tower.color;
          ctx.beginPath();
          ctx.arc(
            tower.x + Math.cos(a) * spinRadius,
            tower.y + Math.sin(a) * spinRadius,
            4,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.restore();
      }

      // tier badge
      {
        const c = tower.color;
        const bx = tower.col * CELL_SIZE + CELL_SIZE - 7;
        const by = tower.row * CELL_SIZE + 7;

        // Determine badge tier
        const hasL2 = tower.legendary100Unlocked;
        const hasL1 = tower.legendaryUnlocked;
        const hasT2 = tower.skill10chosen;
        const hasT1 = tower.skill5chosen;

        if (hasL2) {
          // ✦✦ Legendary 100 — red star with pulse
          const pulse = 0.7 + 0.3 * Math.sin(engine.tick * 0.15);
          ctx.save();
          ctx.globalAlpha = pulse;
          ctx.shadowColor = "#ef4444";
          if (!engine._isMobile) {
            ctx.shadowColor = c;
            ctx.shadowBlur = 10;
          }
          ctx.shadowBlur = 0;
          // outer glow ring
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(bx, by, 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          // badge fill
          ctx.fillStyle = "#450a0a";
          ctx.beginPath();
          ctx.arc(bx, by, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.restore();
          ctx.font = "9px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("✦", bx, by + 0.5);
        } else if (hasL1) {
          // ✦ Legendary 50 — gold star with pulse
          const pulse = 0.75 + 0.25 * Math.sin(engine.tick * 0.12);
          ctx.save();
          ctx.globalAlpha = pulse;
          ctx.shadowColor = "#f59e0b";
          ctx.shadowBlur = 8;
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(bx, by, 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#451a03";
          ctx.beginPath();
          ctx.arc(bx, by, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.restore();
          ctx.font = "9px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("✦", bx, by + 0.5);
        } else if (hasT2) {
          // T2 — yellow diamond
          ctx.save();
          ctx.fillStyle = "#fbbf24";
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(bx, by - 7);
          ctx.lineTo(bx + 5, by);
          ctx.lineTo(bx, by + 7);
          ctx.lineTo(bx - 5, by);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = "#000";
          ctx.font = "bold 6px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("T2", bx, by + 0.5);
        } else if (hasT1) {
          // T1 — blue circle
          ctx.save();
          ctx.fillStyle = "#38bdf8";
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.arc(bx, by, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = "#000";
          ctx.font = "bold 6px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("T1", bx, by + 0.5);
        }

        // Upgrade-ready indicator — small flashing dot on bottom-left corner
        if (tower.upgradeReady) {
          const dotPulse = 0.5 + 0.5 * Math.abs(Math.sin(engine.tick * 0.18));
          ctx.save();
          ctx.globalAlpha = dotPulse;
          ctx.fillStyle = "#fbbf24";
          ctx.shadowColor = "#fbbf24";
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(
            tower.col * CELL_SIZE + 6,
            tower.row * CELL_SIZE + CELL_SIZE - 6,
            4,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.restore();
        }
      }

      // HP bar (only show if damaged)
      if (tower.hp < tower.maxHp) {
        const hpPct = tower.hp / tower.maxHp;
        const barW = CELL_SIZE - 6;
        const barX = tower.col * CELL_SIZE + 3;
        const barY = tower.row * CELL_SIZE + 2;
        ctx.fillStyle = "rgba(0,0,0,0.8)";
        ctx.fillRect(barX - 1, barY - 1, barW + 2, 5);
        ctx.fillStyle =
          hpPct > 0.6 ? "#4ade80" : hpPct > 0.3 ? "#facc15" : "#ef4444";
        ctx.fillRect(barX, barY, barW * hpPct, 3);
        // Disabled overlay
        if (tower.disabled) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(
            tower.col * CELL_SIZE + 2,
            tower.row * CELL_SIZE + 2,
            CELL_SIZE - 4,
            CELL_SIZE - 4,
          );
          ctx.fillStyle = "#ef4444";
          ctx.font = "bold 14px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            "✕",
            tower.col * CELL_SIZE + CELL_SIZE / 2,
            tower.row * CELL_SIZE + CELL_SIZE / 2,
          );
          ctx.textBaseline = "alphabetic";
        }
      }

      // cooldown bar
      if (tower.cooldown > 0) {
        const barW = (CELL_SIZE - 6) * (1 - tower.cooldown / tower.fireRate);
        ctx.fillStyle = tower.color + "40";
        ctx.fillRect(
          tower.col * CELL_SIZE + 3,
          tower.row * CELL_SIZE + CELL_SIZE - 5,
          CELL_SIZE - 6,
          3,
        );
        ctx.fillStyle = tower.color;
        ctx.fillRect(
          tower.col * CELL_SIZE + 3,
          tower.row * CELL_SIZE + CELL_SIZE - 5,
          barW,
          3,
        );
      }
    }

    // ── SYNERGY LINKS ────────────────────────────────────────────────────────
    for (const syn of engine.activeSynergies) {
      const towersA = engine.towers.filter((t) => t.type === syn.towers[0]);
      const towersB = engine.towers.filter((t) => t.type === syn.towers[1]);
      const pulse = 0.25 + 0.15 * Math.sin(engine.tick * 0.08);
      for (const a of towersA) {
        for (const b of towersB) {
          const sdx = b.x - a.x,
            sdy = b.y - a.y;
          const sdist = Math.sqrt(sdx * sdx + sdy * sdy);
          if (sdist > 320) continue;
          ctx.save();
          ctx.globalAlpha = pulse;
          ctx.strokeStyle = syn.color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 6]);
          ctx.lineDashOffset = -(this.tick * 0.5) % 12;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = syn.color;
          ctx.globalAlpha = pulse * 1.8;
          ctx.font = "9px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("✨", (a.x + b.x) / 2, (a.y + b.y) / 2 - 8);
          ctx.restore();
        }
      }
    }

    // ── BALL LIGHTNINGS ────────────────────────────────────────────────────────
    for (const bl of engine.ballLightnings || []) {
      const life = bl.timer / 300;
      ctx.save();
      ctx.globalAlpha = life;
      ctx.shadowColor = bl.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = bl.color;
      ctx.beginPath();
      ctx.arc(bl.x, bl.y, 6 + 3 * Math.sin(engine.tick * 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bl.x, bl.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── BURN ZONES ─────────────────────────────────────────────────────────────
    for (const z of engine.burnZones || []) {
      const alpha = (z.timer / 180) * 0.35;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ff6600";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── BLACK HOLES ────────────────────────────────────────────────────────────
    for (const bh of engine.blackHoles || []) {
      const life = bh.timer / 180;
      const pulseR = bh.radius * (0.15 + 0.08 * Math.sin(engine.tick * 0.2));
      ctx.save();
      ctx.globalAlpha = life * 0.6;
      ctx.strokeStyle = "#818cf8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bh.x, bh.y, bh.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = life;
      ctx.fillStyle = "#1e1b4b";
      ctx.beginPath();
      ctx.arc(bh.x, bh.y, pulseR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── ENEMIES ───────────────────────────────────────────────────────────────
    for (const enemy of engine.enemies) {
      ctx.save();
      ctx.globalAlpha = enemy.stealth ? 0.38 : 1;
      ctx.translate(enemy.x, enemy.y);

      drawEnemyShape(ctx, enemy, engine.tick);

      // status rings
      if (enemy.slowTimer > 0) {
        ctx.strokeStyle = "#a5f3fc";
        ctx.lineWidth = 2;
        ctx.globalAlpha =
          (enemy.stealth ? 0.38 : 1) *
          (0.6 + 0.4 * Math.sin(engine.tick * 0.2));
        ctx.beginPath();
        ctx.arc(0, 0, enemy.size + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (enemy.burnTimer > 0) {
        ctx.strokeStyle = `rgba(255,100,0,${0.5 + 0.5 * Math.sin(engine.tick * 0.35)})`;
        ctx.lineWidth = 2;
        ctx.globalAlpha = enemy.stealth ? 0.38 : 1;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.size + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (enemy.stunTimer > 0) {
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.size + 6, 0, Math.PI * 2);
        ctx.stroke();
        // star sparks
        for (let s = 0; s < 3; s++) {
          const a = engine.tick * 0.15 + s * ((Math.PI * 2) / 3);
          ctx.fillStyle = "#fbbf24";
          ctx.beginPath();
          ctx.arc(
            Math.cos(a) * (enemy.size + 9),
            Math.sin(a) * (enemy.size + 9),
            2,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      if (enemy.armor > 0.2) {
        ctx.strokeStyle = "rgba(148,163,184,0.5)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(0, 0, enemy.size * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
      ctx.globalAlpha = 1;

      // counter warning
      if (
        enemy.requiresCounter &&
        !engine.towers.some((t) => t.type === enemy.requiresCounter)
      ) {
        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "center";
        ctx.fillText("⚠ LASER", enemy.x, enemy.y - enemy.size - 14);
      }

      // Healer priority marker
      if (enemy.type === "healer") {
        ctx.fillStyle = "#4ade80";
        ctx.font = "bold 8px monospace";
        ctx.textAlign = "center";
        ctx.fillText("⚕ PRIORITY", enemy.x, enemy.y - enemy.size - 14);
      }

      // Missile lock-on indicator
      const isLocked = engine.projectiles.some(
        (p) => p.towerType === "missile" && p.homing && p.targetId === enemy.id,
      );
      if (isLocked) {
        ctx.save();
        ctx.strokeStyle = "#f43f5e";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(engine.tick * 0.25));
        const rSize = enemy.size + 8;
        // Corner brackets
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          ctx.beginPath();
          ctx.moveTo(enemy.x + sx * rSize, enemy.y + sy * (rSize - 4));
          ctx.lineTo(enemy.x + sx * rSize, enemy.y + sy * rSize);
          ctx.lineTo(enemy.x + sx * (rSize - 4), enemy.y + sy * rSize);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Elite indicator ring
      if (enemy.isElite) {
        ctx.save();
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2.5;
        ctx.shadowColor = "#facc15";
        ctx.shadowBlur = 10;
        const t = engine.tick * 0.15;
        ctx.beginPath();
        ctx.arc(
          enemy.x,
          enemy.y,
          enemy.size + 5 + Math.sin(t) * 2,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // Mutation indicator on boss
      if (enemy.isBoss && enemy.mutation) {
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(
          `${enemy.mutation.icon} ${enemy.mutation.name}`,
          enemy.x,
          enemy.y - enemy.size - 18,
        );
        ctx.textBaseline = "alphabetic";
      }

      // HP bar
      const bw = enemy.isBoss ? enemy.size * 3.8 : enemy.size * 2.6;
      const bh = enemy.isBoss ? 5 : 3;
      const bx = enemy.x - bw / 2,
        by = enemy.y - enemy.size - (enemy.isBoss ? 14 : 7);
      const r = Math.max(0, enemy.hp / enemy.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = r > 0.55 ? "#4ade80" : r > 0.28 ? "#facc15" : "#ef4444";
      ctx.fillRect(bx, by, bw * r, bh);
      if (enemy.isBoss) {
        ctx.fillStyle = r > 0.28 ? "#fde68a" : "#fca5a5";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const hpK =
          enemy.hp >= 1000
            ? `${(enemy.hp / 1000).toFixed(1)}k`
            : Math.ceil(enemy.hp);
        ctx.fillText(
          `${hpK} / ${enemy.maxHp >= 1000 ? `${(enemy.maxHp / 1000).toFixed(1)}k` : Math.ceil(enemy.maxHp)}`,
          enemy.x,
          by - 1,
        );
        ctx.textBaseline = "alphabetic";
      }
    }

    // ── PROJECTILES ───────────────────────────────────────────────────────────
    for (const p of engine.projectiles) {
      ctx.save();
      drawProjectile(ctx, p, engine.tick);
      ctx.restore();
    }

    // ── TESLA BOLT EFFECTS ────────────────────────────────────────────────────
    for (const bolt of engine.boltEffects) {
      const alpha = bolt.life / bolt.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = bolt.color;
      ctx.shadowBlur = 12 * alpha;
      ctx.strokeStyle = bolt.color;
      ctx.lineWidth = 1.5 + alpha * 2;
      ctx.beginPath();
      ctx.moveTo(bolt.x1, bolt.y1);
      ctx.lineTo(bolt.mx, bolt.my);
      ctx.lineTo(bolt.x2, bolt.y2);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 0.5;
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
    }

    // ── PARTICLES ─────────────────────────────────────────────────────────────
    for (const p of engine.particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── FLOATING TEXTS ────────────────────────────────────────────────────────
    for (const t of engine.floatingTexts) {
      const maxLife = t.fontSize ? 50 : 75;
      const a = t.life / maxLife;
      ctx.globalAlpha = Math.min(a * 1.5, 1);
      const size = t.fontSize || 10 + (1 - a) * 4;
      ctx.font = `bold ${size}px monospace`;
      ctx.fillStyle = t.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    // ── EVOLUTION ALERT ──────────────────────────────────────────────────────
    if (engine.evolutionAlertTimer > 0) {
      engine.evolutionAlertTimer--;
      const evo = engine.evolutionAlertDef;
      if (evo) {
        const fadeAlpha = Math.min(1, engine.evolutionAlertTimer / 30);
        ctx.globalAlpha = fadeAlpha;
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(W * 0.15, H * 0.38, W * 0.7, 70);
        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⚠ ENEMY EVOLUTION DETECTED", W / 2, H * 0.38 + 16);
        ctx.fillStyle = "#fde68a";
        ctx.font = "bold 13px monospace";
        ctx.fillText(`${evo.icon} ${evo.name}`, W / 2, H * 0.38 + 34);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "10px monospace";
        ctx.fillText(evo.desc, W / 2, H * 0.38 + 52);
        ctx.globalAlpha = 1;
        ctx.textBaseline = "alphabetic";
      }
    }

    // ── BOSS WARNING ──────────────────────────────────────────────────────────
    if (engine.bossWarningTimer > 0) {
      engine.bossWarningTimer--;
      const alpha =
        Math.min(1, engine.bossWarningTimer / 30) *
        Math.abs(Math.sin(engine.tick * 0.15));
      const bDef = ENEMY_TYPES[engine.bossWarningType];
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#1a0000";
      ctx.fillRect(0, H / 2 - 50, W, 100);
      ctx.globalAlpha = Math.min(1, alpha * 2);
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 24px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`⚠ BOSS: ${bDef?.name || "???"} ⚠`, W / 2, H / 2 - 16);
      ctx.fillStyle = "#fca5a5";
      ctx.font = "12px monospace";
      ctx.fillText(
        bDef?.weaknessHint || "Find its weakness!",
        W / 2,
        H / 2 + 6,
      );
      if (engine.bossWarningMutation) {
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 11px monospace";
        ctx.fillText(
          `🧬 MUTATION: ${engine.bossWarningMutation.icon} ${engine.bossWarningMutation.name} — ${engine.bossWarningMutation.desc}`,
          W / 2,
          H / 2 + 42,
        );
      }
      if (bDef?.immunities?.length) {
        ctx.fillStyle = "#f87171";
        ctx.font = "10px monospace";
        ctx.fillText(
          `IMMUNE: ${bDef.immunities.map((i) => TOWER_TYPES[i]?.name || i).join(", ")}`,
          W / 2,
          H / 2 + 24,
        );
      }
      ctx.globalAlpha = 1;
    }

    // ── Persistent wave info bar ──────────────────────────────────────────────
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, W, 30);

    // Wave number (left)
    const waveLabel = engine.isEndless
      ? `∞ WAVE ${engine.wave}`
      : `WAVE ${engine.wave} / ${engine.levelConfig.waves}`;
    ctx.fillStyle = engine.isEndless ? "#818cf8" : "#38bdf8";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(waveLabel, 10, 15);

    // ── AI TAUNT OVERLAY ─────────────────────────────────────────────────────
    if (this._aiTaunt && this._aiTaunt.life > 0) {
      this._aiTaunt.life--;
      const tAlpha =
        Math.min(1, this._aiTaunt.life / 40) *
        Math.min(1, (240 - this._aiTaunt.life + 40) / 40);
      const msgW = Math.min(this._aiTaunt.text.length * 6.2 + 32, W - 40);
      ctx.save();
      ctx.globalAlpha = tAlpha * 0.92;
      ctx.fillStyle = "rgba(8,0,18,0.85)";
      ctx.fillRect((W - msgW) / 2, 34, msgW, 22);
      ctx.strokeStyle = "#818cf8";
      ctx.lineWidth = 0.5;
      ctx.strokeRect((W - msgW) / 2, 34, msgW, 22);
      ctx.fillStyle = "#c4b5fd";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`🧠 ${this._aiTaunt.text}`, W / 2, 45);
      ctx.restore();
    }

    // Modifier or incoming warning (center-right)
    if (engine.activeModifier) {
      const mod = engine.activeModifier;
      const tc =
        mod.type === "buff"
          ? "#4ade80"
          : mod.type === "debuff"
            ? "#ef4444"
            : "#c4b5fd";
      const bg =
        mod.type === "buff"
          ? "rgba(74,222,128,0.15)"
          : mod.type === "debuff"
            ? "rgba(239,68,68,0.15)"
            : "rgba(129,140,248,0.15)";
      ctx.fillStyle = bg;
      ctx.fillRect(W * 0.28, 2, W * 0.72 - 4, 26);
      ctx.fillStyle = tc;
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        `${mod.icon} ${mod.name.toUpperCase()} — ${mod.desc}`,
        W * 0.65,
        15,
      );
      if (engine.silencedTowerType) {
        const tDef = TOWER_TYPES[engine.silencedTowerType];
        ctx.fillStyle = "#fca5a5";
        ctx.textAlign = "right";
        ctx.fillText(
          `🔇 ${tDef?.name || engine.silencedTowerType} SILENCED`,
          W - 6,
          15,
        );
      }
    } else if (engine._incomingModifier) {
      const mod = engine._incomingModifier;
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(engine.tick * 0.1));
      const tc =
        mod.type === "buff"
          ? `rgba(134,239,172,${pulse})`
          : mod.type === "debuff"
            ? `rgba(252,165,165,${pulse})`
            : `rgba(196,181,253,${pulse})`;
      ctx.fillStyle = tc;
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText(
        `⚡ NEXT WAVE: ${mod.icon} ${mod.name} — ${mod.desc}`,
        W - 10,
        15,
      );
    } else if (engine.state === "idle") {
      ctx.fillStyle = "#374151";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText(
        `▶ Deploy towers — start wave ${engine.wave + 1}`,
        W - 10,
        15,
      );
    }
    ctx.textBaseline = "alphabetic";

    // ── GAME OVER / VICTORY ───────────────────────────────────────────────────
    if (engine.state === "gameover" || engine.state === "victory") {
      const gameOver = engine.state === "gameover";
      if (gameOver) engine.audio?.onGameOver();
      const won = engine.state === "victory";
      if (won) engine.audio?.onVictory();
      ctx.fillStyle = "rgba(0,0,0,0.82)";
      ctx.fillRect(0, 0, W, H);
      // animated title scale
      const scale = 1 + 0.03 * Math.sin(engine.tick * 0.08);
      ctx.save();
      ctx.translate(W / 2, H / 2 - 40);
      ctx.scale(scale, scale);
      ctx.fillStyle = won ? "#4ade80" : "#ef4444";
      ctx.font = "bold 42px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(won ? "VICTORY!" : "GAME OVER", 0, 0);
      ctx.restore();
      ctx.fillStyle = "#94a3b8";
      ctx.font = "16px monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        `Score: ${engine.score.toLocaleString()}`,
        W / 2,
        H / 2 + 10,
      );
      ctx.fillText(
        engine.isEndless
          ? `Survived ${engine.wave} waves!`
          : won
            ? "The AI couldn't stop you."
            : "The AI has defeated you.",
        W / 2,
        H / 2 + 34,
      );
    }

    // ── PAUSE OVERLAY ─────────────────────────────────────────────────────────────
    if (engine.paused) {
      ctx.fillStyle = "rgba(0,0,0,0.68)";
      ctx.fillRect(0, 0, W, H);
      const pulse = 0.8 + 0.2 * Math.sin(engine.tick * 0.07);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 40px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⏸ PAUSED", W / 2, H / 2 - 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#475569";
      ctx.font = "13px monospace";
      ctx.fillText("Space / P  to resume", W / 2, H / 2 + 22);
    }

    ctx.restore(); // pop shake transform
  }
}
