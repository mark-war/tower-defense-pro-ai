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
      this._startProceduralMusic("idle");
    } catch (e) {
      console.warn("AudioEngine: Web Audio API not available", e);
      this._enabled = false;
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
    if (this._musicState !== state) this._transitionMusic(state);
    this.playWaveStart(wave);
  }

  onWaveComplete() {
    if (!this._enabled || !this._initialized) return;
    this._transitionMusic("idle");
    this.playWaveClear();
  }

  onBossSpawn(bossType) {
    if (!this._enabled || !this._initialized) return;
    this._transitionMusic("boss");
    this.playBossRoar(bossType);
  }

  onBossKill() {
    if (!this._enabled || !this._initialized) return;
    this._transitionMusic("wave");
    this.playVictoryStab();
  }

  onGameOver() {
    if (!this._enabled || !this._initialized) return;
    this._transitionMusic("idle");
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
    // Urgency: boost music intensity
    this._musicGain.gain.setTargetAtTime(
      this._musicVolume * 1.4,
      this._ctx.currentTime,
      0.3,
    );
  }

  // ── Tower fire sounds ───────────────────────────────────────────────────────
  playShoot(towerType) {
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
    if (!this._canPlay("enemy_leak")) return;
    this._alarmPulse();
  }

  // ── UI / economy sounds ─────────────────────────────────────────────────────
  playGoldEarned(amount = 10) {
    if (!this._initialized) return;
    const pitch = Math.min(1.0 + amount / 200, 2.0);
    this._coin(pitch);
  }

  playTowerPlace() {
    if (!this._initialized) return;
    this._thud(220, 0.12);
  }

  playTowerUpgrade() {
    if (!this._initialized) return;
    this._upgradeChime();
  }

  playAbilityFire(abilityKey) {
    if (!this._initialized) return;
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
    if (!this._initialized) return;
    const freq = 440 + count * 18;
    this._beep(freq, 0.08, "sine", 0.15);
    // Extra punch at milestone streaks
    if (count >= 10) {
      setTimeout(() => this._beep(freq * 1.5, 0.1, "triangle", 0.12), 90);
    }
  }

  // ── Context-aware SFX: call these from GameEngine for richer audio ──────────

  /**
   * Call when a boss takes a big hit (hp < 50%).
   * Adds a low metallic "wounded" clang.
   */
  playBossHurt() {
    if (!this._initialized) return;
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

  /**
   * Call when a tower is destroyed/disabled.
   * Sounds like a structure collapsing.
   */
  playTowerDestroyed() {
    if (!this._initialized) return;
    const t = this._ctx.currentTime;
    this._noiseBurst(t, 0.08, 0.4, 400, 3000); // structural crack
    this._noiseBurst(t + 0.02, 0.45, 0.3, 40, 800); // collapse body
    this._subPunch(t, 90, 30, 0.28, 0.4); // impact thud
    setTimeout(() => {
      this._noiseBurst(this._ctx.currentTime, 0.3, 0.12, 30, 250); // debris settle
    }, 120);
  }

  /**
   * Call when a fortify purchase is made.
   */
  playFortify() {
    if (!this._initialized) return;
    this._majorChord([261, 329, 392, 523], 0.28, 0.7);
  }

  /**
   * Call when a milestone wave (every 10) starts.
   * Heavy war-drum build-up.
   */
  playMilestoneDrum() {
    if (!this._initialized) return;
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

  /**
   * Call when screen shake triggers from big explosions.
   * Sub-bass rumble to reinforce the physical feel.
   */
  playRumble(intensity = 1.0) {
    if (!this._initialized) return;
    const t = this._ctx.currentTime;
    this._noiseBurst(t, 0.35, 0.2 * intensity, 25, 200);
    this._subPunch(t, 35, 18, 0.2 * intensity, 0.35);
  }

  /**
   * Call when EMP fully lands and stuns everything on screen.
   * Wide electromagnetic sweep.
   */
  playEMPShockwave() {
    if (!this._initialized) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    // Rising sweep
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
    // Sub-bass shockwave body
    this._noiseBurst(t, 0.25, 0.22, 30, 300);
    this._subPunch(t, 60, 20, 0.25, 0.4);
  }

  /**
   * Call when void step / teleport happens.
   */
  playVoidStep() {
    if (!this._initialized) return;
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

  /**
   * Call when arc pulse fires (full-screen tesla).
   */
  playArcPulse() {
    if (!this._initialized) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    this._noiseBurst(t, 0.18, 0.35, 150, 12000);
    // Crackling harmonic burst
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
    this._triggerMusicIntensity(0.2); // brief swell
  }

  /**
   * Call when nuke / armageddon fires.
   */
  playNuke() {
    if (!this._initialized) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    // Build-up whine
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
    // Detonation — biggest explosion in the game
    setTimeout(() => {
      const ti = this._ctx.currentTime;
      this._noiseBurst(ti, 0.04, 0.7, 1200, 9000); // sharp crack
      this._noiseBurst(ti + 0.01, 1.2, 0.65, 30, 1000); // massive boom body
      this._subPunch(ti, 130, 15, 0.6, 1.0); // chest-punch sub
      this._subPunch(ti + 0.08, 100, 18, 0.4, 0.8); // secondary wave
      this._noiseBurst(ti + 0.15, 0.9, 0.22, 25, 400); // long debris rumble
      this._noiseBurst(ti + 0.25, 0.7, 0.12, 600, 4000); // fire crackle tail
    }, 520);
  }

  // ── Wave events ─────────────────────────────────────────────────────────────
  playWaveStart(wave) {
    if (!this._initialized) return;
    if (wave % 10 === 0) {
      this.playMilestoneDrum();
    } else {
      this._waveStartDrum(wave);
    }
  }

  playWaveClear() {
    if (!this._initialized) return;
    this._majorChord([523, 659, 784], 0.25, 0.6);
  }

  playBossRoar(bossType) {
    if (!this._initialized) return;
    this._bossWarning(bossType);
  }

  playLastStandAlarm() {
    if (!this._initialized) return;
    this._alarmSiren();
  }

  playVictoryFanfare() {
    if (!this._initialized) return;
    this._fanfare();
  }

  playGameOver() {
    if (!this._initialized) return;
    this._defeatStinger();
  }

  playVictoryStab() {
    if (!this._initialized) return;
    this._majorChord([392, 494, 587], 0.3, 0.4);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INTERNAL — Procedural SFX generators
  // ─────────────────────────────────────────────────────────────────────────

  _canPlay(key) {
    if (!this._enabled || !this._initialized) return false;
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

  // ── Scheduled versions for the music loop ──────────────────────────────────
  // These accept an absolute Web Audio time and push nodes into _musicNodes.

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

  // ── Tower fire SFX ──────────────────────────────────────────────────────────
  // All designed around layered noise bursts + sub-bass bodies.
  // Recipe for convincing explosions:
  //   1. SHORT sharp transient  (crack/snap — attack character)
  //   2. NOISE burst            (body — filtered white noise decay)
  //   3. SUB-BASS pitch drop    (weight — sine freq sweep to sub)
  //   4. Optional tail          (rumble / crackle / hiss)

  _shootGunner() {
    // Fast machine-gun crack — sharp transient, very short tail
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // 1. Crack transient: short noise burst through highpass
    this._noiseBurst(t, 0.06, 0.22, 3500, 8000);

    // 2. Body: pitched punch dropping from 180→55 Hz
    this._subPunch(t, 180, 55, 0.07, 0.18);

    // 3. Subtle mechanical rattle tail
    this._noiseBurst(t + 0.04, 0.04, 0.06, 800, 2000);
  }

  _shootSniper() {
    // Single high-velocity rifle crack — loud sharp snap then long mid tail
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // 1. Crack: very fast highpass noise burst
    this._noiseBurst(t, 0.02, 0.35, 4000, 12000);

    // 2. Whipcrack pitch sweep 1400→120 Hz
    this._subPunch(t, 1400, 120, 0.02, 0.22);

    // 3. Reverb-like mid-range tail (the "echo off a wall" feel)
    this._noiseBurst(t + 0.03, 0.25, 0.08, 400, 1200);
  }

  _shootCannon() {
    // Heavy artillery — big sub-bass body, slow decay, ground shake feel
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // 1. Ignition crack
    this._noiseBurst(t, 0.04, 0.45, 2000, 6000);

    // 2. BOOM body — wide noise, low filter
    this._noiseBurst(t, 0.55, 0.4, 60, 800);

    // 3. Deep sub-bass punch 100→28 Hz — this is the "feel it in your chest"
    this._subPunch(t, 100, 28, 0.04, 0.55);

    // 4. Shockwave ring: second sub punch slightly delayed
    this._subPunch(t + 0.04, 80, 22, 0.03, 0.35);

    // 5. Long low rumble tail
    this._noiseBurst(t + 0.1, 0.45, 0.12, 40, 200);
  }

  _shootLaser() {
    // Sci-fi energy discharge — electric whine + ionization hiss
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // 1. Capacitor discharge: rising frequency sweep
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

    // 2. Ionization hiss — thin highpass noise
    this._noiseBurst(t, 0.08, 0.1, 6000, 18000);
  }

  _shootFreeze() {
    // Ice shard impact — crystalline CRACK, not a gentle tinkle
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // 1. Shatter crack: very short wideband noise burst
    this._noiseBurst(t, 0.03, 0.28, 1000, 14000);

    // 2. Resonant icy ring — short pitched tone dropping fast
    this._subPunch(t, 900, 200, 0.025, 0.12);

    // 3. Frost spray: softer mid-range hiss tail
    this._noiseBurst(t + 0.03, 0.18, 0.07, 400, 3000);
  }

  _shootTesla() {
    // Electric arc discharge — aggressive crackling snap
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // 1. Arc crack: wideband noise burst with ultra-fast attack
    this._noiseBurst(t, 0.09, 0.28, 200, 12000);

    // 2. 60 Hz buzz undertone (electrical hum)
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

    // 3. Stutter crackle: 3 rapid mini bursts
    [0.03, 0.06, 0.085].forEach((d) => {
      this._noiseBurst(t + d, 0.02, 0.12, 3000, 10000);
    });
  }

  _shootInferno() {
    // Napalm whoosh-ignition — deep roaring combustion
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // 1. Ignition pop
    this._noiseBurst(t, 0.04, 0.35, 200, 1800);

    // 2. Fire roar body — low rumbling noise sustained
    this._noiseBurst(t + 0.02, 0.28, 0.22, 80, 600);

    // 3. Hiss/crackle on top
    this._noiseBurst(t + 0.02, 0.22, 0.08, 1500, 5000);

    // 4. Sub-bass ignition thud
    this._subPunch(t, 160, 50, 0.025, 0.18);
  }

  _shootVortex() {
    // Gravity well opening — deep resonant whorl + air displacement
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // 1. Air displacement whoosh: mid noise with slow attack
    this._noiseBurst(t, 0.35, 0.18, 60, 500);

    // 2. Resonant low-end drone dropping in pitch
    this._subPunch(t, 90, 35, 0.022, 0.38);

    // 3. Distorted sub rumble
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
    // Rocket ignition then whoosh — short ignition blast + sustained thrust
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // 1. Ignition bang: quick wide noise
    this._noiseBurst(t, 0.05, 0.38, 300, 5000);

    // 2. Thrust body: low rumbling noise sustained (rocket exhaust)
    this._noiseBurst(t + 0.03, 0.22, 0.28, 80, 700);

    // 3. Sub-bass punch for the launch kick
    this._subPunch(t, 200, 50, 0.035, 0.18);
  }

  // ── Core explosion primitives ───────────────────────────────────────────────
  // These are the building blocks for all SFX above.

  /**
   * Filtered white noise burst — the "body" of any explosion/impact.
   * @param {number} time      - Web Audio absolute start time
   * @param {number} duration  - seconds
   * @param {number} volume    - peak gain
   * @param {number} lpFreq    - lowpass cutoff Hz (controls boom vs crack)
   * @param {number} hpFreq    - highpass cutoff Hz (cuts mud below this)
   */
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
    // Sharp attack, exponential decay
    gain.gain.setValueAtTime(0.0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    src.connect(lp);
    lp.connect(hp);
    hp.connect(gain);
    gain.connect(this._sfxGain);
    src.start(time);
  }

  /**
   * Sub-bass pitch-sweep punch — the "weight" of an explosion.
   * Sine wave that drops rapidly in frequency (the gut-punch feel).
   * @param {number} time      - Web Audio absolute start time
   * @param {number} freqStart - starting frequency Hz (e.g. 150)
   * @param {number} freqEnd   - end frequency Hz (e.g. 30)
   * @param {number} volume    - peak gain
   * @param {number} duration  - seconds
   */
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

  // ── Enemy SFX ───────────────────────────────────────────────────────────────

  _enemyDeath() {
    // Small splat/crunch — varies slightly each call via random pitch offset
    const t = this._ctx.currentTime;
    const rnd = 0.7 + Math.random() * 0.6; // ±pitch variation

    // Soft mid-range thump
    this._noiseBurst(t, 0.1, 0.2 * rnd, 80 * rnd, 1800 * rnd);
    this._subPunch(t, 120 * rnd, 40, 0.018 * rnd, 0.12);
  }

  _swarmDeath() {
    // Tiny pop — very fast, high-pitched noise burst
    const t = this._ctx.currentTime;
    this._noiseBurst(t, 0.025, 0.14, 1200, 6000);
    this._subPunch(t, 400 + Math.random() * 200, 80, 0.012, 0.04);
  }

  _bossExplosion() {
    // Massive layered explosion — multiple stages
    const t = this._ctx.currentTime;

    // Stage 1: ignition crack (immediate, sharp)
    this._noiseBurst(t, 0.04, 0.55, 2000, 8000);

    // Stage 2: primary blast body (wide-spectrum boom)
    this._noiseBurst(t + 0.01, 0.9, 0.6, 40, 1200);

    // Stage 3: sub-bass "ground punch" — the deepest thud
    this._subPunch(t, 120, 18, 0.55, 0.8);

    // Stage 4: secondary shockwave ring (slightly delayed)
    this._noiseBurst(t + 0.06, 0.5, 0.3, 60, 600);
    this._subPunch(t + 0.06, 90, 22, 0.3, 0.55);

    // Stage 5: long debris rumble tail
    this._noiseBurst(t + 0.15, 0.85, 0.15, 30, 300);

    // Stage 6: high crackle/fire sounds continuing
    this._noiseBurst(t + 0.2, 0.6, 0.1, 800, 4000);

    this._triggerMusicIntensity(0.5);
  }

  _alarmPulse() {
    [440, 330].forEach((f) => {
      this._beep(f, 0.15, "square", 0.18);
    });
  }

  // ── UI / economy SFX ───────────────────────────────────────────────────────

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

  // ── Wave event SFX ─────────────────────────────────────────────────────────

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

  // ── Ability SFX ─────────────────────────────────────────────────────────────

  _airstrikeSound() {
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // Incoming whistle — descending sine
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

    // Impact explosion at end — full layered bomb
    setTimeout(() => {
      const ti = this._ctx.currentTime;
      this._noiseBurst(ti, 0.05, 0.6, 1500, 7000); // sharp crack
      this._noiseBurst(ti + 0.01, 0.75, 0.55, 40, 900); // boom body
      this._subPunch(ti, 110, 20, 0.5, 0.8); // sub gut-punch
      this._noiseBurst(ti + 0.12, 0.6, 0.18, 30, 350); // debris rumble
      this._noiseBurst(ti + 0.2, 0.45, 0.08, 500, 3000); // fire crackle
    }, 650);
  }

  _empSound() {
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // EM shockwave: expanding sphere of interference
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

    // Electrical burst riding on top
    this._noiseBurst(t + 0.08, 0.3, 0.18, 200, 10000);
  }

  _reinforceSound() {
    this._majorChord([523, 659, 784], 0.3, 0.5);
    setTimeout(() => this._majorChord([659, 784, 988], 0.25, 0.5), 180);
  }

  // ── Adaptive music intensity ────────────────────────────────────────────────
  // Briefly swell the music gain on big moments, then settle back.
  _triggerMusicIntensity(boost = 0.3) {
    if (!this._initialized) return;
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
      this._scheduleMusicLoop(newState);
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

  // ── Core music loop ─────────────────────────────────────────────────────────
  // State-aware: idle = ambient pad, wave = driving beat, boss = heavy & fast.
  _scheduleMusicLoop(state) {
    if (!this._initialized) return;
    this._musicNodes = [];

    const ctx = this._ctx;
    const bpm = state === "boss" ? 150 : state === "wave" ? 120 : 75;
    const beat = 60 / bpm;
    const barLen = beat * 4;
    const loopBars = 4;
    const loopLen = barLen * loopBars;
    const t = ctx.currentTime + 0.1;

    // ── Chord sets per state ──────────────────────────────────────────────────
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

      // ── Bass note (root, half-bar duration) ────────────────────────────────
      this._scheduleNote(chord[0], barStart, beat * 2, 0.07, "triangle");

      // ── Pad (full bar, all chord notes) ────────────────────────────────────
      chord.forEach((note) => {
        this._scheduleNote(note * 2, barStart, barLen * 0.92, 0.022, "sine");
      });

      // ── Arpeggio (8 steps per bar, cycles chord tones) ────────────────────
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

      // ── Melody line (wave + boss only, upper register) ────────────────────
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

      // ── Percussion ────────────────────────────────────────────────────────
      if (state !== "idle") {
        // Kick on beats 1 & 3
        this._scheduleKick(barStart);
        this._scheduleKick(barStart + beat * 2);

        // Snare on beats 2 & 4
        this._scheduleSnare(barStart + beat);
        this._scheduleSnare(barStart + beat * 3);

        // Hi-hats: 8th notes normally, 16th notes for boss
        const hatDiv = state === "boss" ? 4 : 2;
        for (let h = 0; h < 8 * hatDiv; h++) {
          this._scheduleHat(barStart + h * (beat / hatDiv));
        }

        // Boss: extra low hits on off-beats for tension
        if (state === "boss") {
          this._scheduleKick(barStart + beat * 0.5);
          this._scheduleKick(barStart + beat * 2.5);
        }
      } else {
        // Idle: very sparse kick every 2 bars for subtle pulse
        if (bar % 2 === 0) this._scheduleKick(barStart);
      }
    }

    // Schedule next loop
    this._musicLoopTimer = setTimeout(
      () => {
        if (this._musicState === state && this._initialized) {
          this._scheduleMusicLoop(state);
        }
      },
      loopLen * 1000 - 100,
    );
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

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
    return Math.max(20, Math.min(20000, freq)); // safe range
  }
}

// ─── HOW TO WIRE THIS INTO GameEngine.js ───────────────────────────────────────
//
// Existing wiring (already in your code):
//  1.  import { AudioEngine } from './AudioEngine.js';  ✓
//  2.  this.audio = new AudioEngine();  ✓
//  3.  handleClick → engineRef.current?.audio?.init();  ✓
//  4.  _killEnemy  → this.audio?.playEnemyDeath(enemy.isBoss, enemy.type);  ✓
//  5.  _killEnemy  → this.audio?.playGoldEarned(enemy.reward);  ✓
//  6.  _fireProjectile → this.audio?.playShoot(tower.type);  ✓
//  7.  startWave   → this.audio?.onWaveStart(this.wave);  ✓
//  8.  _checkWaveComplete → this.audio?.onWaveComplete(this.wave);  ✓
//  9.  _spawnEnemy → if (data.isBoss) this.audio?.onBossSpawn(data.type);  ✓
//  10. _killEnemy  → if (enemy.isBoss) this.audio?.onBossKill();  ✓
//  11. state→gameover → this.audio?.onGameOver();  ✓
//  12. state→victory  → this.audio?.onVictory();  ✓
//  13. _checkLastStand → this.audio?.onLastStand();  ✓
//  14. placeTower  → this.audio?.playTowerPlace();  ✓
//  15. upgradeTower → this.audio?.playTowerUpgrade();  ✓
//  16. triggerAbility → this.audio?.playAbilityFire(abilityKey);  ✓
//  17. _killEnemy streak → this.audio?.playStreak(this._streakCount);  ✓
//
// NEW optional wires for richer game feel:
//
//  A. In _triggerShake() (when intensity >= 5):
//       this.audio?.playRumble(intensity / 10);
//
//  B. In tower.disabled block (when hp hits 0):
//       this.audio?.playTowerDestroyed();
//
//  C. In fortify():
//       this.audio?.playFortify();
//
//  D. In _fireProjectile when specials includes "arcPulse":
//       this.audio?.playArcPulse();
//
//  E. In _fireProjectile / setTimeout block for nuclearPayload/nuke:
//       this.audio?.playNuke();    // replace the plain shake with this
//
//  F. In _damageEnemy, when boss hp drops below 50% for first time:
//       if (enemy.isBoss && !enemy._hurtPlayed && enemy.hp / enemy.maxHp < 0.5) {
//         enemy._hurtPlayed = true;
//         this.audio?.playBossHurt();
//       }
//
//  G. In _updateEnemies void step block:
//       this.audio?.playVoidStep();
//
//  H. In triggerAbility "emp" block:
//       this.audio?.playEMPShockwave();   // replaces plain _empSound feel
