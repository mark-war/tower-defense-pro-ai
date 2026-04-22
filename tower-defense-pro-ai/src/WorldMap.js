// WorldMap.js — camera, coordinate transforms, minimap
export class WorldMap {
  constructor(worldW, worldH, viewW, viewH) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.viewW = viewW;
    this.viewH = viewH;
    this.camX = 0;
    this.camY = 0;
    this._dragging = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._dragCamX = 0;
    this._dragCamY = 0;
    this.manualScrollTimer = 0;
  }

  // Clamp camera so it never shows outside the world
  _clamp() {
    this.camX = Math.max(0, Math.min(this.worldW - this.viewW, this.camX));
    this.camY = Math.max(0, Math.min(this.worldH - this.viewH, this.camY));
  }

  // Convert world coords → screen pixels
  worldToScreen(wx, wy) {
    return { x: wx - this.camX, y: wy - this.camY };
  }

  // Convert screen pixels → world coords
  screenToWorld(sx, sy) {
    return { x: sx + this.camX, y: sy + this.camY };
  }

  // True if a world rect is visible in the viewport (for culling)
  isVisible(wx, wy, margin = 40) {
    return (
      wx > this.camX - margin &&
      wx < this.camX + this.viewW + margin &&
      wy > this.camY - margin &&
      wy < this.camY + this.viewH + margin
    );
  }

  panTo(wx, wy) {
    this.camX = wx - this.viewW / 2;
    this.camY = wy - this.viewH / 2;
    this._clamp();
  }

  panBy(dx, dy) {
    this.camX += dx;
    this.camY += dy;
    this._clamp();
  }

  // Edge-scroll when mouse is near viewport edge
  edgeScroll(sx, sy, speed = 6) {
    const edge = 40;
    let moved = false;
    if (sx < edge) {
      this.camX -= speed * (1 - sx / edge);
      moved = true;
    }
    if (sx > this.viewW - edge) {
      this.camX += speed * (1 - (this.viewW - sx) / edge);
      moved = true;
    }
    if (sy < edge) {
      this.camY -= speed * (1 - sy / edge);
      moved = true;
    }
    if (sy > this.viewH - edge) {
      this.camY += speed * (1 - (this.viewH - sy) / edge);
      moved = true;
    }
    if (moved) this.manualScrollTimer = 300; // 5s override
    this._clamp();
  }

  // Middle-mouse / right-drag pan
  startDrag(sx, sy) {
    this._dragging = true;
    this._dragStartX = sx;
    this._dragStartY = sy;
    this._dragCamX = this.camX;
    this._dragCamY = this.camY;
  }

  updateDrag(sx, sy) {
    if (!this._dragging) return;
    this.camX = this._dragCamX - (sx - this._dragStartX);
    this.camY = this._dragCamY - (sy - this._dragStartY);
    this.manualScrollTimer = 300;
    this._clamp();
  }

  endDrag() {
    this._dragging = false;
  }

  getMinimapRect(viewW, viewH) {
    return { x: viewW - 150, y: viewH - 100, w: 140, h: 90 };
  }

  handleMinimapClick(px, py, viewW, viewH) {
    const { x, y, w, h } = this.getMinimapRect(viewW, viewH);
    if (px < x || px > x + w || py < y || py > y + h) return false;
    const fracX = (px - x) / w;
    this.camX = fracX * this.worldW - this.viewW / 2;
    this._clamp();
    this.manualScrollTimer = 0; // minimap click re-enables auto-scroll
    return true;
  }

  // Draw the minimap into a small canvas region (bottom-right corner)
  drawMinimap(ctx, towers, enemies, paths, viewW, viewH) {
    const MM_W = 140,
      MM_H = 90;
    const MM_X = viewW - MM_W - 10;
    const MM_Y = viewH - MM_H - 10;
    const scaleX = MM_W / this.worldW;
    const scaleY = MM_H / this.worldH;

    ctx.save();

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(MM_X, MM_Y, MM_W, MM_H, 4);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.roundRect(MM_X, MM_Y, MM_W, MM_H, 4);
    ctx.clip();

    // Draw paths
    for (const path of paths) {
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      path.forEach((pt, i) => {
        const x = MM_X + pt.x * scaleX;
        const y = MM_Y + pt.y * scaleY;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Towers
    for (const t of towers) {
      ctx.fillStyle = t.color || "#4ade80";
      ctx.fillRect(MM_X + t.x * scaleX - 2, MM_Y + t.y * scaleY - 2, 4, 4);
    }

    // Enemies
    for (const e of enemies) {
      ctx.fillStyle = e.isBoss ? "#ef4444" : e.color || "#fb923c";
      ctx.beginPath();
      ctx.arc(
        MM_X + e.x * scaleX,
        MM_Y + e.y * scaleY,
        e.isBoss ? 3 : 1.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Viewport rect
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      MM_X + this.camX * scaleX,
      MM_Y + this.camY * scaleY,
      this.viewW * scaleX,
      this.viewH * scaleY,
    );

    ctx.restore();
  }
}
