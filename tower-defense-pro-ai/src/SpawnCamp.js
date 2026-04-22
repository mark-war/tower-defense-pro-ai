// SpawnCamp.js — enemy base at path entry, destroyable for gold bonus
export class SpawnCamp {
  constructor(x, y, id) {
    this.x = x;
    this.y = y;
    this.id = id;
    this.maxHp = 800;
    this.hp = this.maxHp;
    this.destroyed = false;
    this.spawnDelayBonus = 0; // frames of extra delay when damaged
    this.flashTimer = 0;
    this._rebuildTimer = 0;
    this._rebuildWaves = 3; // rebuilds after 3 waves
  }

  takeDmg(dmg) {
    if (this.destroyed) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.flashTimer = 6;
    if (this.hp <= 0) {
      this.destroyed = true;
      this.spawnDelayBonus = 1800; // 30s of extra delay on spawns from this camp
      return true; // killed
    }
    return false;
  }

  // Call at wave end — count down rebuild
  onWaveEnd() {
    if (!this.destroyed) return;
    this._rebuildTimer++;
    if (this._rebuildTimer >= this._rebuildWaves) {
      this.destroyed = false;
      this.hp = this.maxHp;
      this._rebuildTimer = 0;
      this.spawnDelayBonus = 0;
    }
  }

  draw(ctx, tick) {
    if (this.flashTimer > 0) this.flashTimer--;
    const alpha = this.destroyed ? 0.25 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.x, this.y);

    // Pulsing aura when active
    if (!this.destroyed) {
      const pulse = 0.15 + 0.1 * Math.abs(Math.sin(tick * 0.08));
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }

    // Main structure — dark fortress shard
    ctx.fillStyle = this.destroyed
      ? "#374151"
      : this.flashTimer > 0
        ? "#fca5a5"
        : "#7f1d1d";
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(18, -10);
    ctx.lineTo(22, 14);
    ctx.lineTo(0, 22);
    ctx.lineTo(-22, 14);
    ctx.lineTo(-18, -10);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = this.destroyed ? "#4b5563" : "#dc2626";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner glow core
    if (!this.destroyed) {
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      // Rotating shard indicator
      const rot = tick * 0.06;
      for (let i = 0; i < 3; i++) {
        const a = rot + i * ((Math.PI * 2) / 3);
        ctx.strokeStyle = "#fca5a5";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
        ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
        ctx.stroke();
      }
    } else {
      // Rubble
      ctx.fillStyle = "#374151";
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 12, Math.sin(a) * 12, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Rebuild timer ring
      const frac = this._rebuildTimer / this._rebuildWaves;
      ctx.strokeStyle = "#4ade80";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
    }

    // HP bar
    if (!this.destroyed) {
      const hpFrac = this.hp / this.maxHp;
      const bw = 44;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(-bw / 2, 28, bw, 4);
      ctx.fillStyle =
        hpFrac > 0.5 ? "#4ade80" : hpFrac > 0.25 ? "#facc15" : "#ef4444";
      ctx.fillRect(-bw / 2, 28, bw * hpFrac, 4);
    }

    // "CAMP" label
    ctx.fillStyle = this.destroyed ? "#4b5563" : "#fca5a5";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(this.destroyed ? "REBUILDING" : "ENEMY CAMP", 0, 42);

    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
