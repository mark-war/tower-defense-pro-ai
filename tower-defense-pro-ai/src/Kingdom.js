// Kingdom.js — drawn castle at path exit with HP-linked visual state
export class Kingdom {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.shakeTimer = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  hit() {
    this.shakeTimer = 12;
  }

  draw(ctx, hpFrac, tick) {
    if (this.shakeTimer > 0) {
      this.shakeTimer--;
      this.shakeX = (Math.random() - 0.5) * 6;
      this.shakeY = (Math.random() - 0.5) * 6;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }

    const x = this.x + this.shakeX;
    const y = this.y + this.shakeY;

    ctx.save();
    ctx.translate(x, y);

    // Base wall
    const wallColor =
      hpFrac > 0.5 ? "#64748b" : hpFrac > 0.25 ? "#78450a" : "#5a1a1a";
    ctx.fillStyle = wallColor;
    ctx.fillRect(-28, -20, 56, 36);

    // Gate arch
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(0, 16, 10, Math.PI, 0);
    ctx.rect(-10, 6, 20, 12);
    ctx.fill();

    // Towers left & right
    for (const dx of [-22, 22]) {
      ctx.fillStyle = wallColor;
      ctx.fillRect(dx - 8, -34, 16, 20);
      // Battlements
      for (let b = -1; b <= 1; b++) {
        ctx.fillRect(dx - 6 + b * 5, -40, 4, 8);
      }
    }

    // Center tower
    ctx.fillStyle = wallColor;
    ctx.fillRect(-8, -44, 16, 26);
    for (let b = -1; b <= 1; b++) {
      ctx.fillRect(-6 + b * 5, -50, 4, 8);
    }

    // Flag
    const flagPulse = Math.sin(tick * 0.05) * 3;
    ctx.fillStyle =
      hpFrac > 0.5 ? "#4ade80" : hpFrac > 0.25 ? "#f97316" : "#ef4444";
    ctx.beginPath();
    ctx.moveTo(0, -50);
    ctx.lineTo(10 + flagPulse, -45);
    ctx.lineTo(0, -40);
    ctx.fill();

    // Cracks on damage
    if (hpFrac < 0.75) {
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-15, -10);
      ctx.lineTo(-10, 0);
      ctx.lineTo(-18, 8);
      ctx.stroke();
    }
    if (hpFrac < 0.4) {
      ctx.beginPath();
      ctx.moveTo(8, -20);
      ctx.lineTo(14, -8);
      ctx.lineTo(6, 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-5, -35);
      ctx.lineTo(2, -25);
      ctx.lineTo(-3, -15);
      ctx.stroke();
    }

    // Glow pulse on last stand
    if (hpFrac < 0.15) {
      ctx.globalAlpha = 0.3 + 0.3 * Math.abs(Math.sin(tick * 0.15));
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(0, -10, 40, 0, Math.PI * 2);
      ctx.fill();
    }

    // HP bar above
    const barW = 60,
      barH = 5;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(-barW / 2, -62, barW, barH);
    ctx.fillStyle =
      hpFrac > 0.55 ? "#4ade80" : hpFrac > 0.28 ? "#facc15" : "#ef4444";
    ctx.fillRect(-barW / 2, -62, barW * hpFrac, barH);

    ctx.restore();
  }
}
