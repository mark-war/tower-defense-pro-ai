/**
 * drawHelpers.js
 * Pure canvas drawing utilities — stateless, no game-engine references.
 * Each function receives only the ctx and the data it needs.
 */

import { CELL_SIZE, TOWER_TYPES } from "../gameConstants.js";

// ── Geometry ─────────────────────────────────────────────────────────────────

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Color utilities ───────────────────────────────────────────────────────────

export function blendColor(hex1, hex2, t) {
  const n1 = parseInt(hex1.replace("#", ""), 16);
  const n2 = parseInt(hex2.replace("#", ""), 16);
  const r = Math.round(((n1 >> 16) & 0xff) * (1 - t) + ((n2 >> 16) & 0xff) * t);
  const g = Math.round(((n1 >> 8) & 0xff) * (1 - t) + ((n2 >> 8) & 0xff) * t);
  const b = Math.round((n1 & 0xff) * (1 - t) + (n2 & 0xff) * t);
  return `rgb(${r},${g},${b})`;
}

export function shadeColor(hex, amt) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

// ── Grid cell renderers ───────────────────────────────────────────────────────

export function drawPathCell(ctx, x, y, size, style, theme, tick) {
  ctx.save();
  switch (style) {
    case "medieval": {
      ctx.strokeStyle = "rgba(139,105,20,0.25)";
      ctx.lineWidth = 0.5;
      const stoneW = size / 2,
        stoneH = size / 2;
      for (let si = 0; si < 2; si++)
        for (let sj = 0; sj < 2; sj++) {
          const offset = sj % 2 === 0 ? stoneW * 0.5 : 0;
          ctx.strokeRect(
            x + si * stoneW + offset,
            y + sj * stoneH,
            stoneW,
            stoneH,
          );
        }
      ctx.fillStyle = "rgba(74,222,128,0.04)";
      ctx.fillRect(x, y, size, size);
      break;
    }
    case "jungle": {
      ctx.strokeStyle = "rgba(134,239,172,0.15)";
      ctx.lineWidth = 0.8;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x, y + (size / 3) * i);
        ctx.bezierCurveTo(
          x + size * 0.3,
          y + (size / 3) * i - 2,
          x + size * 0.7,
          y + (size / 3) * i + 2,
          x + size,
          y + (size / 3) * i,
        );
        ctx.stroke();
      }
      break;
    }
    case "neon": {
      const pulse = 0.1 + 0.06 * Math.sin(tick * 0.05);
      ctx.strokeStyle = `rgba(0,255,255,${pulse})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2, y + 2, size - 4, size - 4);
      if ((Math.floor(x / size) + Math.floor(y / size)) % 3 === 0) {
        ctx.fillStyle = `rgba(255,0,255,${pulse * 1.5})`;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default: {
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    }
  }
  ctx.restore();
}

export function drawGroundCell(ctx, x, y, size, style, theme, row, col, tick) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  switch (style) {
    case "medieval": {
      if ((col * 7 + row * 3) % 5 === 0) {
        ctx.strokeStyle = "#166534";
        ctx.lineWidth = 0.8;
        const gx = x + ((col * 13) % (size - 6)) + 3;
        const gy = y + ((row * 11) % (size - 6)) + 3;
        for (let b = -1; b <= 1; b++) {
          ctx.beginPath();
          ctx.moveTo(gx + b * 3, gy + 4);
          ctx.quadraticCurveTo(gx + b * 3 + b, gy, gx + b * 3 + b * 2, gy - 3);
          ctx.stroke();
        }
      }
      if ((col + row) % 4 === 0) {
        ctx.strokeStyle = "rgba(120,113,108,0.12)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x + 3, y + 3, size - 6, size - 6);
      }
      break;
    }
    case "jungle": {
      if ((col * 5 + row * 9) % 4 === 0) {
        ctx.fillStyle = "#15803d";
        ctx.beginPath();
        const lx = x + ((col * 17) % (size - 8)) + 4;
        const ly = y + ((row * 13) % (size - 8)) + 4;
        ctx.ellipse(lx, ly, 3, 5, (col + row) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if ((col * row) % 8 === 0) {
        ctx.strokeStyle = "rgba(21,128,61,0.2)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y + size * 0.3);
        ctx.quadraticCurveTo(
          x + size * 0.5,
          y + size * 0.1,
          x + size,
          y + size * 0.5,
        );
        ctx.stroke();
      }
      break;
    }
    case "neon": {
      if ((col + row) % 2 === 0) {
        const pulse = 0.08 + 0.04 * Math.sin(tick * 0.03 + col * 0.1);
        ctx.fillStyle = `rgba(0,255,255,${pulse})`;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ── Entity renderers ──────────────────────────────────────────────────────────

export function drawTowerShape(ctx, tower, tick, activeSkin) {
  const c = tower.color;
  const s = CELL_SIZE * 0.38;

  // Recoil: push tower body opposite to firing direction
  const recoil =
    tower._recoilTimer > 0
      ? Math.sin((tower._recoilTimer / tower._recoilMax) * Math.PI) * 3
      : 0;
  if (tower._recoilTimer > 0) tower._recoilTimer--;
  if (recoil > 0 && tower._drawAngle) {
    const recoilAngle = tower._drawAngle - Math.PI / 2;
    ctx.translate(
      -Math.cos(recoilAngle) * recoil,
      -Math.sin(recoilAngle) * recoil,
    );
  }

  ctx.shadowColor = c;
  ctx.shadowBlur = 10;

  ctx.globalAlpha = 0.2;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.95, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (["basic", "laser", "vortex"].includes(tower.type)) {
    const rot = tick * (tower.type === "vortex" ? 0.07 : 0.04);
    ctx.save();
    ctx.rotate(rot);
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  if (
    ["sniper", "cannon", "missile"].includes(tower.type) &&
    tower._drawAngle
  ) {
    ctx.save();
    ctx.rotate(tower._drawAngle);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = c;
    ctx.fillRect(-2, -s * 0.85, 4, s * 0.5);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  ctx.font = `${CELL_SIZE * 0.62}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tower.icon || "🗼", 0, 1);
  ctx.shadowBlur = 0;
}

export function drawEnemyShape(ctx, enemy, tick) {
  const r = enemy.size;

  ctx.shadowColor = enemy.color;
  ctx.shadowBlur = enemy.isBoss ? 16 : 8;

  if (enemy.isBoss) {
    const pulse = 0.3 + 0.2 * Math.sin(tick * 0.1);
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = enemy.phaseTriggered ? "#ff2200" : enemy.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (enemy.phaseTriggered) {
    ctx.globalAlpha = 0.35 + 0.2 * Math.sin(tick * 0.25);
    ctx.fillStyle = "#ff2200";
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (enemy.stealth) {
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = enemy.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  if (enemy.type === "healer") {
    const orbitAngle = tick * 0.08;
    for (let i = 0; i < 3; i++) {
      const a = orbitAngle + i * ((Math.PI * 2) / 3);
      ctx.fillStyle = "#86efac";
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(
        Math.cos(a) * r * 1.2,
        Math.sin(a) * r * 1.2,
        r * 0.2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (enemy.type === "fast") {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = enemy.color;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(0, r * i * 0.6, r * 0.25 * (1 - i * 0.25), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const fontSize = r * (enemy.isBoss ? 2.6 : 2.1);
  ctx.font = `${fontSize}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(enemy.icon || "👾", 0, 1);
  ctx.shadowBlur = 0;
}

export function drawProjectile(ctx, p, tick) {
  switch (p.towerType) {
    case "basic": {
      const angle = Math.atan2(p.vy, p.vx);
      ctx.save();
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(p.x - Math.cos(angle) * 10, p.y - Math.sin(angle) * 10);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(
        p.x - Math.cos(angle) * 3,
        p.y - Math.sin(angle) * 3,
        1.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
      break;
    }
    case "sniper": {
      const angle = Math.atan2(p.vy, p.vx);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.shadowColor = "#c0c0c0";
      ctx.shadowBlur = 6;
      const grad = ctx.createLinearGradient(-8, -1.5, 8, 1.5);
      grad.addColorStop(0, "#94a3b8");
      grad.addColorStop(0.4, "#e2e8f0");
      grad.addColorStop(1, "#475569");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(-8, -1.5, 14, 3, 1);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(10, -1.5);
      ctx.lineTo(10, 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.roundRect(-18, -1, 10, 2, 1);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "cannon": {
      ctx.shadowColor = "#ff6600";
      ctx.shadowBlur = 16;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 6;
      ctx.fillStyle = "#ffdd00";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = "#aaa";
      for (let t = 1; t <= 3; t++) {
        ctx.beginPath();
        ctx.arc(
          p.x - p.vx * t * 2,
          p.y - p.vy * t * 2,
          p.size * (1 - t * 0.25),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "laser": {
      const angle = Math.atan2(p.vy, p.vx);
      ctx.save();
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      if (
        p.originX !== undefined &&
        Math.abs(p.x - p.originX) + Math.abs(p.y - p.originY) > 4
      ) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(p.originX, p.originY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.3;
        ctx.stroke();
      } else {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(angle) * 14, p.y - Math.sin(angle) * 14);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "freeze": {
      ctx.shadowColor = "#a5f3fc";
      ctx.shadowBlur = 10;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(tick * 0.18);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(0, -p.size * 2);
      ctx.lineTo(p.size * 1.2, 0);
      ctx.lineTo(0, p.size * 2);
      ctx.lineTo(-p.size * 1.2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e0f9ff";
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "inferno": {
      ctx.shadowColor = "#ff2200";
      ctx.shadowBlur = 18;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffee00";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#ff6600";
      ctx.beginPath();
      ctx.arc(p.x - p.vx * 2.5, p.y - p.vy * 2.5, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case "vortex": {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff44";
      ctx.lineWidth = 1;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "missile": {
      const angle = Math.atan2(p.vy, p.vx);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = p.color;
      ctx.fillRect(-3, -2, 13, 4);
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(14, -3);
      ctx.lineTo(14, 3);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(-11, -2.5);
      ctx.lineTo(-11, 2.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(-17, -1.5);
      ctx.lineTo(-17, 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    default: {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}
