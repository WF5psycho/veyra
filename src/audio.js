// Synthesized sound: wind, grips, hammer, falls, UI chimes and a generative ambient score.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.music = true;
    this.nextNote = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.8;
    this.sfx.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.22;
    this.musicBus.connect(this.master);
    // shared noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // wind bed
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.7;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.05;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
    // simple reverb for music
    this.verb = this.ctx.createConvolver();
    const ir = this.ctx.createBuffer(2, this.ctx.sampleRate * 3, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.5);
    }
    this.verb.buffer = ir;
    this.verb.connect(this.musicBus);
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.7 : 0;
  }

  now() {
    return this.ctx.currentTime;
  }

  burst({ freq = 800, q = 1, dur = 0.1, gain = 0.3, type = 'bandpass', attack = 0.005 }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone({ freq = 440, dur = 0.3, gain = 0.2, type = 'sine', slide = 0, bus, delay = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.now() + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(bus || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(ev) {
    if (!this.ctx) return;
    switch (ev.type) {
      case 'grip':
        this.burst({ freq: ev.hand ? 1800 : 900, q: 0.8, dur: 0.07, gain: 0.18 });
        this.tone({ freq: ev.hand ? 140 : 90, dur: 0.08, gain: 0.12, type: 'triangle' });
        break;
      case 'slip':
        this.burst({ freq: 2500, q: 0.5, dur: 0.25, gain: 0.2, type: 'highpass' });
        break;
      case 'fall':
        this.burst({ freq: 600, q: 0.3, dur: 1.2, gain: 0.25, attack: 0.3 });
        this.tone({ freq: 420, slide: -260, dur: 0.6, gain: 0.1, type: 'triangle' });
        break;
      case 'land':
        this.tone({ freq: 70, slide: -30, dur: 0.3, gain: ev.dist > 110 ? 0.5 : 0.15, type: 'sine' });
        this.burst({ freq: 300, dur: 0.2, gain: 0.25, type: 'lowpass' });
        break;
      case 'ropeCatch':
        this.tone({ freq: 110, slide: -40, dur: 0.35, gain: 0.35, type: 'sawtooth' });
        this.burst({ freq: 1200, dur: 0.15, gain: 0.2 });
        break;
      case 'pop':
        this.tone({ freq: 2400, slide: -1500, dur: 0.2, gain: 0.25, type: 'square' });
        break;
      case 'hammer':
        this.tone({ freq: ev.good ? 1850 : 1200, dur: 0.35, gain: 0.25, type: 'sine' });
        this.tone({ freq: ev.good ? 3700 : 2300, dur: 0.2, gain: 0.08, type: 'sine' });
        this.burst({ freq: 3000, dur: 0.05, gain: 0.3 });
        break;
      case 'pitonPlaced':
        this.tone({ freq: 880, dur: 0.12, gain: 0.12, type: 'triangle' });
        this.tone({ freq: 1320, dur: 0.2, gain: 0.12, type: 'triangle', delay: 0.08 });
        break;
      case 'chalk':
        this.burst({ freq: 3500, q: 0.4, dur: 0.4, gain: 0.12, attack: 0.05 });
        break;
      case 'pickup':
      case 'water':
        this.tone({ freq: 660, dur: 0.15, gain: 0.12, type: 'triangle' });
        this.tone({ freq: 990, dur: 0.25, gain: 0.1, type: 'triangle', delay: 0.07 });
        break;
      case 'discover':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.5, gain: 0.12, type: 'triangle', delay: i * 0.09 }));
        break;
      case 'eat':
        this.burst({ freq: 500, dur: 0.08, gain: 0.15 });
        this.burst({ freq: 600, dur: 0.08, gain: 0.12 });
        break;
      case 'crumble':
        for (let i = 0; i < 4; i++) setTimeout(() => this.burst({ freq: 400 + Math.random() * 300, dur: 0.12, gain: 0.25, type: 'lowpass' }), i * 60);
        break;
      case 'rockWarn':
        this.burst({ freq: 180, q: 0.5, dur: 1.4, gain: 0.3, type: 'lowpass', attack: 0.4 });
        break;
      case 'rockHit':
        this.tone({ freq: 90, slide: -40, dur: 0.3, gain: 0.5 });
        break;
      case 'gust':
        this.burst({ freq: 700, q: 0.4, dur: 2.2, gain: 0.3, attack: 0.8 });
        break;
      case 'camp':
        [392, 494, 587].forEach((f, i) => this.tone({ freq: f, dur: 0.8, gain: 0.1, type: 'sine', delay: i * 0.15 }));
        break;
      case 'pipGo':
      case 'pipBack':
      case 'tip':
        this.tone({ freq: 1400, slide: 400, dur: 0.07, gain: 0.06, type: 'square' });
        this.tone({ freq: 1900, slide: -300, dur: 0.07, gain: 0.06, type: 'square', delay: 0.08 });
        break;
      case 'hurt':
        this.tone({ freq: 160, slide: -80, dur: 0.25, gain: 0.25, type: 'sawtooth' });
        break;
      case 'mantle':
        this.burst({ freq: 900, dur: 0.3, gain: 0.12 });
        break;
      case 'exhausted':
        this.burst({ freq: 700, q: 2, dur: 0.5, gain: 0.15 });
        break;
      case 'summit':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 1.4, gain: 0.12, type: 'triangle', delay: i * 0.18, bus: this.verb }));
        break;
      case 'death':
        [330, 262, 196].forEach((f, i) => this.tone({ freq: f, dur: 1.2, gain: 0.12, type: 'sine', delay: i * 0.3, bus: this.verb }));
        break;
      case 'reject':
        this.tone({ freq: 220, dur: 0.08, gain: 0.06, type: 'square' });
        break;
      default:
        break;
    }
  }

  update(game, dt) {
    if (!this.ctx) return;
    const t = this.now();
    const alt = game.summitProgress();
    const wind = game.gust.strength;
    const target = 0.03 + alt * 0.08 + wind * 0.2;
    this.windGain.gain.setTargetAtTime(this.enabled ? target : 0, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(300 + wind * 700 + alt * 200, t, 0.5);
    // breathing when tired
    const c = game.climber;
    this.breathT = (this.breathT || 0) - dt;
    if (c.shake > 0.4 && c.state === 'climb' && this.breathT <= 0) {
      this.breathT = 1.1 - c.shake * 0.5;
      this.burst({ freq: 900, q: 1.5, dur: 0.35, gain: 0.05 * c.shake, attack: 0.1 });
    }
    // generative ambient music: pentatonic notes into reverb
    if (this.music && this.enabled && t > this.nextNote) {
      const night = game.isNight();
      const scale = night ? [196, 233, 262, 294, 349, 392, 466] : [262, 294, 330, 392, 440, 523, 587];
      const f = scale[Math.floor(Math.random() * scale.length)];
      this.tone({ freq: f, dur: 3.5, gain: 0.08, type: 'sine', bus: this.verb });
      if (Math.random() < 0.4) this.tone({ freq: f / 2, dur: 5, gain: 0.06, type: 'triangle', bus: this.verb });
      this.nextNote = t + 1.8 + Math.random() * 3.5;
    }
  }
}
