// ─── AudioEngine.js ────────────────────────────────────────────────────────────
// Drop-in audio system using the Web Audio API (zero dependencies).
// Generates all SFX procedurally — no audio files needed.

export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._musicGain = null;
    this._sfxGain = null;
    this._musicNodes = [];
    this._musicLoopTimer = null;
    this._musicState = "idle"; // 'idle' | 'wave' | 'boss'
    this._enabled = true;
    this._musicVolume = 0.35;
    this._sfxVolume = 0.6;
    this._initialized = false;

    // ── Toggle flags (set by GameEngine.toggleSfx / toggleMusic) ─────────────
    this.sfxEnabled = true;
    this.musicEnabled = true;

    // Throttle same-sound calls to avoid mud
    this._lastSoundTime = {};
    this._minInterval = {
      shoot_basic: 60,
      shoot_laser: 30,
      shoot_tesla: 80,
      shoot_cannon: 120,
      shoot_sniper: 80,
      shoot_freeze: 100,
      shoot_inferno: 90,
      shoot_vortex: 110,
      shoot_missile: 150,
      enemy_death: 40,
      enemy_leak: 200,
    };
  }

  // ── Must be called from a user gesture (click/keydown) ─────────────────────
  init() {
    if (this._initialized) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = 1.0;
      this._masterGain.connect(this._ctx.destination);

      this._musicGain = this._ctx.createGain();
      this._musicGain.gain.value = this._musicVolume;
      this._musicGain.connect(this._masterGain);

      this._sfxGain = this._ctx.createGain();
      this._sfxGain.gain.value = this._sfxVolume;
      this._sfxGain.connect(this._masterGain);

      this._initialized = true;
      if (this.musicEnabled) this._startProceduralMusic("idle");
    } catch (e) {
      console.warn("AudioEngine: Web Audio API not available", e);
      this._enabled = false;
    }
  }

  // ── Public stop music method (called by GameEngine.toggleMusic) ─────────────
  stopMusic() {
    this._stopMusic();
    // Fade out gracefully
    if (this._initialized && this._musicGain) {
      this._musicGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.3);
    }
  }

  setVolume(master = 1.0, music = 0.35, sfx = 0.6) {
    if (!this._initialized) return;
    this._masterGain.gain.setTargetAtTime(master, this._ctx.currentTime, 0.1);
    this._musicGain.gain.setTargetAtTime(music, this._ctx.currentTime, 0.5);
    this._sfxGain.gain.setTargetAtTime(sfx, this._ctx.currentTime, 0.1);
    this._musicVolume = music;
    this._sfxVolume = sfx;
  }

  // ── State transitions (call from GameEngine) ────────────────────────────────
  onWaveStart(wave) {
    if (!this._enabled || !this._initialized) return;
    const state = wave > 0 ? "wave" : "idle";
    if (this.musicEnabled && this._musicState !== state)
      this._transitionMusic(state);
    this.playWaveStart(wave);
  }

  onWaveComplete() {
    if (!this._enabled || !this._initialized) return;
    if (this.musicEnabled) this._transitionMusic("idle");
    this.playWaveClear();
  }

  onBossSpawn(bossType) {
    if (!this._enabled || !this._initialized) return;
    if (this.musicEnabled) this._transitionMusic("boss");
    this.playBossRoar(bossType);
  }

  onBossKill() {
    if (!this._enabled || !this._initialized) return;
    if (this.musicEnabled) this._transitionMusic("wave");
    this.playVictoryStab();
  }

  onGameOver() {
    if (!this._enabled || !this._initialized) return;
    if (this.musicEnabled) this._transitionMusic("idle");
    this.playGameOver();
  }

  onVictory() {
    if (!this._enabled || !this._initialized) return;
    this._stopMusic();
    this.playVictoryFanfare();
  }

  onLastStand() {
    if (!this._enabled || !this._initialized) return;
    this.playLastStandAlarm();
    if (this.musicEnabled) {
      this._musicGain.gain.setTargetAtTime(
        this._musicVolume * 1.4,
        this._ctx.currentTime,
        0.3,
      );
    }
  }

  // ── Tower fire sounds ───────────────────────────────────────────────────────
  playShoot(towerType) {
    if (!this.sfxEnabled) return;
    if (!this._canPlay(`shoot_${towerType}`)) return;
    switch (towerType) {
      case "basic":
        return this._shootGunner();
      case "sniper":
        return this._shootSniper();
      case "cannon":
        return this._shootCannon();
      case "laser":
        return this._shootLaser();
      case "freeze":
        return this._shootFreeze();
      case "tesla":
        return this._shootTesla();
      case "inferno":
        return this._shootInferno();
      case "vortex":
        return this._shootVortex();
      case "missile":
        return this._shootMissile();
    }
  }

  // ── Enemy sounds ────────────────────────────────────────────────────────────
  playEnemyDeath(isBoss = false, enemyType = "basic") {
    if (!this.sfxEnabled) return;
    if (!this._canPlay("enemy_death")) return;
    if (isBoss) {
      this._bossExplosion();
    } else if (enemyType === "swarm") {
      this._swarmDeath();
    } else {
      this._enemyDeath();
    }
  }

  playEnemyLeak() {
    if (!this.sfxEnabled) return;
    if (!this._canPlay("enemy_leak")) return;
    this._alarmPulse();
  }

  // ── UI / economy sounds ─────────────────────────────────────────────────────
  playGoldEarned(amount = 10) {
    if (!this.sfxEnabled || !this._initialized) return;
    const pitch = Math.min(1.0 + amount / 200, 2.0);
    this._coin(pitch);
  }

  playTowerPlace() {
    if (!this.sfxEnabled || !this._initialized) return;
    this._thud(220, 0.12);
  }

  playTowerUpgrade() {
    if (!this.sfxEnabled || !this._initialized) return;
    this._upgradeChime();
  }

  playAbilityFire(abilityKey) {
    if (!this.sfxEnabled || !this._initialized) return;
    switch (abilityKey) {
      case "airstrike":
        return this._airstrikeSound();
      case "emp":
        return this._empSound();
      case "reinforce":
        return this._reinforceSound();
    }
  }

  playStreak(count) {
    if (!this.sfxEnabled || !this._initialized) return;
    const freq = 440 + count * 18;
    this._beep(freq, 0.08, "sine", 0.15);
    if (count >= 10) {
      setTimeout(() => this._beep(freq * 1.5, 0.1, "triangle", 0.12), 90);
    }
  }

  playBossHurt() {
    if (!this.sfxEnabled || !this._initialized) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 200;
    filter.Q.value = 3;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  playTowerDestroyed() {
    if (!this.sfxEnabled || !this._initialized) return;
    const t = this._ctx.currentTime;
    this._noiseBurst(t, 0.08, 0.4, 400, 3000);
    this._noiseBurst(t + 0.02, 0.45, 0.3, 40, 800);
    this._subPunch(t, 90, 30, 0.28, 0.4);
    setTimeout(() => {
      this._noiseBurst(this._ctx.currentTime, 0.3, 0.12, 30, 250);
    }, 120);
  }

  playFortify() {
    if (!this.sfxEnabled || !this._initialized) return;
    this._majorChord([261, 329, 392, 523], 0.28, 0.7);
  }

  playMilestoneDrum() {
    if (!this.sfxEnabled || !this._initialized) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    [0, 0.15, 0.3, 0.42].forEach((delay, i) => {
      const vol = 0.25 + i * 0.07;
      const freq = 80 + i * 8;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t + delay);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + delay + 0.18);
      gain.gain.setValueAtTime(vol, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.25);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t + delay);
      osc.stop(t + delay + 0.28);
    });
  }

  playRumble(intensity = 1.0) {
    if (!this.sfxEnabled || !this._initialized) return;
    const t = this._ctx.currentTime;
    this._noiseBurst(t, 0.35, 0.2 * intensity, 25, 200);
    this._subPunch(t, 35, 18, 0.2 * intensity, 0.35);
  }

  playEMPShockwave() {
    if (!this.sfxEnabled || !this._initialized) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    [0, 0.08, 0.16].forEach((d, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(200 + i * 150, t + d);
      osc.frequency.exponentialRampToValueAtTime(3000 - i * 200, t + d + 0.3);
      gain.gain.setValueAtTime(0.1, t + d);
      gain.gain.exponentialRampToValueAtTime(0.001, t + d + 0.35);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t + d);
      osc.stop(t + d + 0.4);
    });
    this._noiseBurst(t, 0.25, 0.22, 30, 300);
    this._subPunch(t, 60, 20, 0.25, 0.4);
  }

  playVoidStep() {
    if (!this.sfxEnabled || !this._initialized) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2000, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.12);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  playArcPulse() {
    if (!this.sfxEnabled || !this._initialized) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    this._noiseBurst(t, 0.18, 0.35, 150, 12000);
    [80, 160, 320].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.08, t + i * 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.02 + 0.15);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t + i * 0.02);
      osc.stop(t + i * 0.02 + 0.18);
    });
    if (this.musicEnabled) this._triggerMusicIntensity(0.2);
  }

  playNuke() {
    if (!this.sfxEnabled || !this._initialized) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(2200, t + 0.5);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.52);
    osc.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(t);
    osc.stop(t + 0.55);
    setTimeout(() => {
      const ti = this._ctx.currentTime;
      this._noiseBurst(ti, 0.04, 0.7, 1200, 9000);
      this._noiseBurst(ti + 0.01, 1.2, 0.65, 30, 1000);
      this._subPunch(ti, 130, 15, 0.6, 1.0);
      this._subPunch(ti + 0.08, 100, 18, 0.4, 0.8);
      this._noiseBurst(ti + 0.15, 0.9, 0.22, 25, 400);
      this._noiseBurst(ti + 0.25, 0.7, 0.12, 600, 4000);
    }, 520);
  }

  // ── Wave events ─────────────────────────────────────────────────────────────
  playWaveStart(wave) {
    if (!this.sfxEnabled || !this._initialized) return;
    if (wave % 10 === 0) {
      this.playMilestoneDrum();
    } else {
      this._waveStartDrum(wave);
    }
  }

  playWaveClear() {
    if (!this.sfxEnabled || !this._initialized) return;
    this._majorChord([523, 659, 784], 0.25, 0.6);
  }

  playBossRoar(bossType) {
    if (!this.sfxEnabled || !this._initialized) return;
    this._bossWarning(bossType);
  }

  playLastStandAlarm() {
    if (!this.sfxEnabled || !this._initialized) return;
    this._alarmSiren();
  }

  playVictoryFanfare() {
    if (!this.sfxEnabled || !this._initialized) return;
    this._fanfare();
  }

  playGameOver() {
    if (!this.sfxEnabled || !this._initialized) return;
    this._defeatStinger();
  }

  playVictoryStab() {
    if (!this.sfxEnabled || !this._initialized) return;
    this._majorChord([392, 494, 587], 0.3, 0.4);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INTERNAL — Procedural SFX generators
  // ─────────────────────────────────────────────────────────────────────────

  _canPlay(key) {
    if (!this._enabled || !this._initialized) return false;
    if (!this.sfxEnabled) return false;
    const now = performance.now();
    const min = this._minInterval[key] || 0;
    if (now - (this._lastSoundTime[key] || 0) < min) return false;
    this._lastSoundTime[key] = now;
    return true;
  }

  _beep(freq, duration, type = "sine", volume = 0.3) {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    freq = this._clampFreq(freq);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(t);
    osc.stop(t + duration + 0.01);
  }

  _noise(duration, volume = 0.2, lowpass = 2000) {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const bufLen = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this._sfxGain);
    src.start(t);
  }

  _thud(freq, volume = 0.3) {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 3, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  _scheduleNote(freq, startTime, duration, vol, type = "sine") {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    freq = this._clampFreq(freq);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(vol, startTime + 0.02);
    gain.gain.setValueAtTime(vol, startTime + duration - 0.04);
    gain.gain.linearRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(this._musicGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
    this._musicNodes.push(osc);
  }

  _thudAt(freq, time, volume = 0.25) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 3, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.04);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    osc.connect(gain);
    gain.connect(this._musicGain);
    osc.start(time);
    osc.stop(time + 0.22);
    this._musicNodes.push(osc);
  }

  _noiseAt(time, duration, volume, highpass = 2000) {
    const ctx = this._ctx;
    const bufLen = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = highpass;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this._musicGain);
    src.start(time);
    this._musicNodes.push(src);
  }

  _scheduleKick(time) {
    this._thudAt(60, time, 0.22);
  }
  _scheduleSnare(time) {
    this._noiseAt(time, 0.08, 0.1, 1800);
  }
  _scheduleHat(time) {
    this._noiseAt(time, 0.03, 0.018, 8000);
  }

  _shootGunner() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    this._noiseBurst(t, 0.06, 0.22, 3500, 8000);
    this._subPunch(t, 180, 55, 0.07, 0.18);
    this._noiseBurst(t + 0.04, 0.04, 0.06, 800, 2000);
  }

  _shootSniper() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    this._noiseBurst(t, 0.02, 0.35, 4000, 12000);
    this._subPunch(t, 1400, 120, 0.02, 0.22);
    this._noiseBurst(t + 0.03, 0.25, 0.08, 400, 1200);
  }

  _shootCannon() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    this._noiseBurst(t, 0.04, 0.45, 2000, 6000);
    this._noiseBurst(t, 0.55, 0.4, 60, 800);
    this._subPunch(t, 100, 28, 0.04, 0.55);
    this._subPunch(t + 0.04, 80, 22, 0.03, 0.35);
    this._noiseBurst(t + 0.1, 0.45, 0.12, 40, 200);
  }

  _shootLaser() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(2400, t + 0.05);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.09);
    gain.gain.setValueAtTime(0.0, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    const bpf = ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.value = 1400;
    bpf.Q.value = 5;
    osc.connect(bpf);
    bpf.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(t);
    osc.stop(t + 0.12);
    this._noiseBurst(t, 0.08, 0.1, 6000, 18000);
  }

  _shootFreeze() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    this._noiseBurst(t, 0.03, 0.28, 1000, 14000);
    this._subPunch(t, 900, 200, 0.025, 0.12);
    this._noiseBurst(t + 0.03, 0.18, 0.07, 400, 3000);
  }

  _shootTesla() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    this._noiseBurst(t, 0.09, 0.28, 200, 12000);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 60;
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(t);
    osc.stop(t + 0.1);
    [0.03, 0.06, 0.085].forEach((d) => {
      this._noiseBurst(t + d, 0.02, 0.12, 3000, 10000);
    });
  }

  _shootInferno() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    this._noiseBurst(t, 0.04, 0.35, 200, 1800);
    this._noiseBurst(t + 0.02, 0.28, 0.22, 80, 600);
    this._noiseBurst(t + 0.02, 0.22, 0.08, 1500, 5000);
    this._subPunch(t, 160, 50, 0.025, 0.18);
  }

  _shootVortex() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    this._noiseBurst(t, 0.35, 0.18, 60, 500);
    this._subPunch(t, 90, 35, 0.022, 0.38);
    const osc = ctx.createOscillator();
    const dist = ctx.createWaveShaper();
    const gain = ctx.createGain();
    dist.curve = this._makeDistortionCurve(80);
    osc.type = "sine";
    osc.frequency.setValueAtTime(75, t);
    osc.frequency.linearRampToValueAtTime(Math.max(30, 45), t + 0.3);
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.connect(dist);
    dist.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  _shootMissile() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    this._noiseBurst(t, 0.05, 0.38, 300, 5000);
    this._noiseBurst(t + 0.03, 0.22, 0.28, 80, 700);
    this._subPunch(t, 200, 50, 0.035, 0.18);
  }

  _noiseBurst(time, duration, volume, lpFreq = 2000, hpFreq = 20) {
    const ctx = this._ctx;
    const bufLen = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = lpFreq;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = hpFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    src.connect(lp);
    lp.connect(hp);
    hp.connect(gain);
    gain.connect(this._sfxGain);
    src.start(time);
  }

  _subPunch(time, freqStart, freqEnd, volume, duration) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freqStart, time);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, time + duration * 0.6);
    gain.gain.setValueAtTime(0.0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  _enemyDeath() {
    const t = this._ctx.currentTime;
    const rnd = 0.7 + Math.random() * 0.6;
    this._noiseBurst(t, 0.1, 0.2 * rnd, 80 * rnd, 1800 * rnd);
    this._subPunch(t, 120 * rnd, 40, 0.018 * rnd, 0.12);
  }

  _swarmDeath() {
    const t = this._ctx.currentTime;
    this._noiseBurst(t, 0.025, 0.14, 1200, 6000);
    this._subPunch(t, 400 + Math.random() * 200, 80, 0.012, 0.04);
  }

  _bossExplosion() {
    const t = this._ctx.currentTime;
    this._noiseBurst(t, 0.04, 0.55, 2000, 8000);
    this._noiseBurst(t + 0.01, 0.9, 0.6, 40, 1200);
    this._subPunch(t, 120, 18, 0.55, 0.8);
    this._noiseBurst(t + 0.06, 0.5, 0.3, 60, 600);
    this._subPunch(t + 0.06, 90, 22, 0.3, 0.55);
    this._noiseBurst(t + 0.15, 0.85, 0.15, 30, 300);
    this._noiseBurst(t + 0.2, 0.6, 0.1, 800, 4000);
    if (this.musicEnabled) this._triggerMusicIntensity(0.5);
  }

  _alarmPulse() {
    [440, 330].forEach((f) => {
      this._beep(f, 0.15, "square", 0.18);
    });
  }

  _coin(pitch = 1.0) {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const freqs = [1047, 1319].map((f) => f * pitch);
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.12, t + i * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.04 + 0.18);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t + i * 0.04);
      osc.stop(t + i * 0.04 + 0.2);
    });
  }

  _upgradeChime() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.12, t + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.25);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.28);
    });
  }

  _majorChord(freqs, volume, duration) {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(volume / freqs.length, t + i * 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t + i * 0.02);
      osc.stop(t + duration + 0.05);
    });
  }

  _waveStartDrum(wave) {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const isMilestone = wave % 10 === 0;
    const hits = isMilestone ? 3 : 2;
    for (let i = 0; i < hits; i++) {
      const delay = i * 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(isMilestone ? 120 : 80, t + delay);
      osc.frequency.exponentialRampToValueAtTime(40, t + delay + 0.12);
      gain.gain.setValueAtTime(0.4, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.2);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t + delay);
      osc.stop(t + delay + 0.25);
    }
  }

  _bossWarning(bossType) {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const freqMap = {
      boss_colossus: [55, 44],
      boss_phantom: [220, 165],
      boss_titan: [44, 33],
      boss_voidreaper: [110, 82],
    };
    const [f1, f2] = freqMap[bossType] || [80, 60];
    [0, 0.4, 0.7].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(f1, t + delay);
      osc.frequency.exponentialRampToValueAtTime(f2, t + delay + 0.3);
      gain.gain.setValueAtTime(0.3, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.35);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 800;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t + delay);
      osc.stop(t + delay + 0.4);
    });
  }

  _alarmSiren() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(880, t + i * 0.22);
      osc.frequency.linearRampToValueAtTime(660, t + i * 0.22 + 0.18);
      gain.gain.setValueAtTime(0.15, t + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.22 + 0.2);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t + i * 0.22);
      osc.stop(t + i * 0.22 + 0.22);
    }
  }

  _fanfare() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const notes = [
      [523, 0.0],
      [659, 0.12],
      [784, 0.24],
      [1047, 0.38],
      [784, 0.56],
      [880, 0.68],
      [1047, 0.82],
    ];
    notes.forEach(([f, d]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.25, t + d);
      gain.gain.exponentialRampToValueAtTime(0.001, t + d + 0.25);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t + d);
      osc.stop(t + d + 0.3);
    });
  }

  _defeatStinger() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const notes = [
      [392, 0.0],
      [349, 0.22],
      [330, 0.44],
      [294, 0.68],
    ];
    notes.forEach(([f, d]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.2, t + d);
      gain.gain.exponentialRampToValueAtTime(0.001, t + d + 0.3);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 600;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t + d);
      osc.stop(t + d + 0.35);
    });
  }

  _airstrikeSound() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.65);
    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.67);
    osc.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(t);
    osc.stop(t + 0.7);
    setTimeout(() => {
      const ti = this._ctx.currentTime;
      this._noiseBurst(ti, 0.05, 0.6, 1500, 7000);
      this._noiseBurst(ti + 0.01, 0.75, 0.55, 40, 900);
      this._subPunch(ti, 110, 20, 0.5, 0.8);
      this._noiseBurst(ti + 0.12, 0.6, 0.18, 30, 350);
      this._noiseBurst(ti + 0.2, 0.45, 0.08, 500, 3000);
    }, 650);
  }

  _empSound() {
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const dist = ctx.createWaveShaper();
    dist.curve = this._makeDistortionCurve(100);
    osc.type = "sine";
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.exponentialRampToValueAtTime(1800, t + 0.12);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.55);
    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(dist);
    dist.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(t);
    osc.stop(t + 0.65);
    this._noiseBurst(t + 0.08, 0.3, 0.18, 200, 10000);
  }

  _reinforceSound() {
    this._majorChord([523, 659, 784], 0.3, 0.5);
    setTimeout(() => this._majorChord([659, 784, 988], 0.25, 0.5), 180);
  }

  _triggerMusicIntensity(boost = 0.3) {
    if (!this._initialized || !this.musicEnabled) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const target = this._musicVolume * (1 + boost);
    this._musicGain.gain.setTargetAtTime(target, t, 0.05);
    this._musicGain.gain.setTargetAtTime(this._musicVolume, t + 0.4, 0.5);
  }

  // ── Procedural music ────────────────────────────────────────────────────────

  _startProceduralMusic(state) {
    this._stopMusic();
    this._musicState = state;
    this._scheduleMusicLoop(state);
  }

  _transitionMusic(newState) {
    if (this._musicState === newState) return;
    this._musicState = newState;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    this._musicGain.gain.setTargetAtTime(0, t, 0.5);
    setTimeout(() => {
      this._stopMusic();
      this._musicGain.gain.setTargetAtTime(
        this._musicVolume,
        ctx.currentTime,
        0.8,
      );
      if (this.musicEnabled) this._scheduleMusicLoop(newState);
    }, 800);
  }

  _stopMusic() {
    if (this._musicNodes) {
      this._musicNodes.forEach((n) => {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      });
    }
    this._musicNodes = [];
    clearTimeout(this._musicLoopTimer);
  }

  _scheduleMusicLoop(state) {
    if (!this._initialized || !this.musicEnabled) return;
    this._musicNodes = [];

    const ctx = this._ctx;
    const bpm = state === "boss" ? 150 : state === "wave" ? 120 : 75;
    const beat = 60 / bpm;
    const barLen = beat * 4;
    const loopBars = 4;
    const loopLen = barLen * loopBars;
    const t = ctx.currentTime + 0.1;

    const chordSets = {
      idle: [
        [110, 138, 165],
        [98, 123, 147],
        [82, 110, 131],
        [92, 123, 147],
      ],
      wave: [
        [98, 123, 147],
        [110, 138, 165],
        [123, 147, 185],
        [82, 110, 131],
      ],
      boss: [
        [73, 87, 110],
        [65, 82, 98],
        [58, 73, 87],
        [82, 98, 123],
      ],
    };

    const chords = chordSets[state] || chordSets.idle;

    for (let bar = 0; bar < loopBars; bar++) {
      const barStart = t + bar * barLen;
      const chord = chords[bar % chords.length];

      this._scheduleNote(chord[0], barStart, beat * 2, 0.07, "triangle");
      chord.forEach((note) => {
        this._scheduleNote(note * 2, barStart, barLen * 0.92, 0.022, "sine");
      });

      for (let step = 0; step < 8; step++) {
        let note = chord[step % chord.length] * (state === "boss" ? 3 : 4);
        note = Math.max(80, Math.min(1800, note));
        const arpVol = state === "idle" ? 0.012 : 0.018;
        this._scheduleNote(
          note,
          barStart + step * (beat / 2),
          beat / 3,
          arpVol,
          "square",
        );
      }

      if (state !== "idle") {
        let melNote = chord[bar % chord.length] * (state === "boss" ? 5 : 6);
        melNote = Math.max(200, Math.min(2400, melNote));
        const melVol = state === "boss" ? 0.025 : 0.018;
        this._scheduleNote(
          melNote,
          barStart + beat * 2,
          beat,
          melVol,
          "sawtooth",
        );
      }

      if (state !== "idle") {
        this._scheduleKick(barStart);
        this._scheduleKick(barStart + beat * 2);
        this._scheduleSnare(barStart + beat);
        this._scheduleSnare(barStart + beat * 3);
        const hatDiv = state === "boss" ? 4 : 2;
        for (let h = 0; h < 8 * hatDiv; h++) {
          this._scheduleHat(barStart + h * (beat / hatDiv));
        }
        if (state === "boss") {
          this._scheduleKick(barStart + beat * 0.5);
          this._scheduleKick(barStart + beat * 2.5);
        }
      } else {
        if (bar % 2 === 0) this._scheduleKick(barStart);
      }
    }

    this._musicLoopTimer = setTimeout(
      () => {
        if (
          this._musicState === state &&
          this._initialized &&
          this.musicEnabled
        ) {
          this._scheduleMusicLoop(state);
        }
      },
      loopLen * 1000 - 100,
    );
  }

  _makeDistortionCurve(amount) {
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  _clampFreq(freq) {
    return Math.max(20, Math.min(20000, freq));
  }
}
