/**
 * VisualEffectsSystem.js
 * Owns all transient visual state: particles, floating texts, screen shake,
 * and tesla bolt effects. All other systems call into this one — never mutate
 * these arrays directly.
 */

export class VisualEffectsSystem {
  constructor(engine) {
    this.engine = engine;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  addParticles(x, y, color, count) {
    const { particles } = this.engine;
    // Hard cap: never exceed 400 particles total. When near cap, scale down count.
    const cap = 400;
    const current = particles.length;
    if (current >= cap) return;
    const allowed = Math.min(count, cap - current);
    for (let i = 0; i < allowed; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * 3.5 + 1;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 35 + Math.random() * 20,
        maxLife: 55,
        color,
        size: Math.random() * 3 + 1,
      });
    }
  }

  addFloatingText(x, y, text, color) {
    const { floatingTexts } = this.engine;
    // Cap at 60 floating texts — old ones scroll off anyway
    if (floatingTexts.length >= 60) floatingTexts.shift();
    floatingTexts.push({ x, y, text, color, life: 75, vy: -0.85 });
  }

  addDamageNumber(x, y, damage, towerType) {
    const { floatingTexts } = this.engine;
    // Skip damage numbers when already saturated — they're cosmetic only
    if (floatingTexts.length >= 55) return;
    const dmgColors = {
      basic: "#86efac",
      sniper: "#38bdf8",
      cannon: "#f97316",
      laser: "#e879f9",
      freeze: "#a5f3fc",
      tesla: "#fbbf24",
      inferno: "#ef4444",
      vortex: "#818cf8",
      missile: "#f43f5e",
    };
    const color = dmgColors[towerType] || "#ffffff";
    const dmgFloor = Math.floor(damage);
    if (dmgFloor < 5) return; // skip tiny chip damage numbers
    const fontSize = Math.min(8 + Math.sqrt(dmgFloor) * 0.4, 14);
    floatingTexts.push({
      x: x + (Math.random() - 0.5) * 12,
      y,
      text: dmgFloor.toString(),
      color,
      life: 50,
      vy: -0.7,
      fontSize,
    });
  }

  addBolt(x1, y1, x2, y2, color) {
    // Cap bolt effects — tesla chains can generate hundreds per frame
    if (this.engine.boltEffects.length >= 80) return;
    this.engine.boltEffects.push({
      x1,
      y1,
      x2,
      y2,
      color,
      life: 8,
      maxLife: 8,
      mx: (x1 + x2) / 2 + (Math.random() - 0.5) * 30,
      my: (y1 + y2) / 2 + (Math.random() - 0.5) * 30,
    });
  }

  triggerShake(intensity = 5, frames = 6) {
    const { shake } = this.engine;
    if (intensity > shake.intensity || shake.frames <= 0) {
      shake.intensity = intensity;
      shake.frames = frames;
    }
    if (intensity >= 5) this.engine.audio?.playRumble(intensity / 10);
  }

  // ── Update (called every tick) ──────────────────────────────────────────────

  update() {
    this._updateParticles();
    this._updateFloatingTexts();
    this._updateStreak();
  }

  _updateParticles() {
    const { particles } = this.engine;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  _updateFloatingTexts() {
    const { floatingTexts } = this.engine;
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const t = floatingTexts[i];
      t.y += t.vy;
      t.life--;
      if (t.life <= 0) floatingTexts.splice(i, 1);
    }
  }

  _updateStreak() {
    const engine = this.engine;
    if (!engine.paused) {
      if (engine._streakWindow > 0) {
        engine._streakWindow--;
      } else {
        engine._streakCount = 0;
      }
    }
  }
}
