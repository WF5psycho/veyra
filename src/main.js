// Entry point: game loop, controls, screen flow and title-screen demo climb.
import { Game, hasSave, storageGet, storageSet } from './game.js';
import { AutoClimber } from './autoclimb.js';
import { Renderer2D } from './render2d.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { dist } from './rng.js';

const SETTINGS_KEY = 'veyra-settings-v2';

class Controls {
  constructor() {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false };
    this.limb = null; // explicitly selected limb
    this.hoverLimb = null;
    this.hoverHold = null;
    this.hoverOk = false;
    this.dragging = false;
    this.reachable = null;
  }

  move() {
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    return { x, y };
  }
}

export function chooseLimb(c, hold, selected) {
  return c.chooseLimb(hold, selected);
}

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer2D(this.canvas);
    this.renderer3d = null;
    this.audio = new Audio();
    this.controls = new Controls();
    this.settings = { sound: true, music: true, assist: true, view3d: true };
    try {
      Object.assign(this.settings, JSON.parse(storageGet(SETTINGS_KEY) || '{}'));
    } catch (e) {
      /* ignore */
    }
    this.mode = 'title'; // title | play
    this.paused = false;
    this.ui = new UI(document.getElementById('ui'), {
      action: (a, d) => this.action(a, d),
      hasSave: () => hasSave(),
      settings: () => this.settings,
    });
    this.startDemo();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    this.ui.open('title', this.game);
    this.applySettings();
    requestAnimationFrame((t) => this.frame(t));
    this.AutoClimber = AutoClimber;
    window.__veyra = this; // handy for debugging and automated tests
  }

  applySettings() {
    this.audio.setEnabled(this.settings.sound);
    this.audio.music = this.settings.music;
    storageSet(SETTINGS_KEY, JSON.stringify(this.settings));
    this.useView3D(this.settings.view3d);
  }

  async useView3D(on) {
    const wrap3d = document.getElementById('game3d');
    if (!on) {
      if (wrap3d) wrap3d.style.display = 'none';
      this.canvas.style.display = '';
      this.active3d = false;
      return;
    }
    if (!this.renderer3d) {
      try {
        const mod = await import('./render3d.js');
        this.renderer3d = new mod.Renderer3D(wrap3d, this.renderer);
        this.renderer3d.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
      } catch (e) {
        console.warn('3D view unavailable', e);
        this.ui.toast('3D view could not start on this device — staying in 2D.', 'warn');
        this.settings.view3d = false;
        return;
      }
    }
    wrap3d.style.display = '';
    this.active3d = true;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.resize(window.innerWidth, window.innerHeight, dpr);
    if (this.renderer3d) this.renderer3d.resize(window.innerWidth, window.innerHeight, dpr);
  }

  // ---- flow --------------------------------------------------------------------------------------
  startDemo() {
    this.game = new Game({ seed: 3, survival: false, hazards: false });
    this.demoBot = new AutoClimber(this.game, { pitons: true });
    this.game.tipsShown = new Proxy({}, { get: () => true });
    this.game.pip.say = null;
    this.mode = 'title';
    this.ui.showHUD(false);
  }

  newGame(seed) {
    this.game = new Game({ seed: seed ?? 7 });
    this.demoBot = null;
    this.mode = 'play';
    this.paused = false;
    this.ui.close();
    this.ui.showHUD(true);
    this.renderer.cam = { x: 0, y: -120, zoom: this.renderer.baseZoom() };
    this.game.save();
  }

  continueGame() {
    const g = Game.load();
    if (!g) return this.newGame();
    this.game = g;
    this.demoBot = null;
    this.mode = 'play';
    this.paused = false;
    this.ui.close();
    this.ui.showHUD(true);
    const c = g.climber.C;
    this.renderer.cam = { x: c.x, y: c.y, zoom: this.renderer.baseZoom() };
    this.ui.toast(g.lastBivouac >= 0 ? 'Back at your bivouac.' : 'Back at the base of Veyra.');
  }

  openScreen(name) {
    this.prevScreen = this.ui.screen;
    this.ui.open(name, this.game);
  }

  action(a, d = {}) {
    this.audio.resume();
    const g = this.game;
    switch (a) {
      case 'new': this.newGame(7); break;
      case 'newseed': this.newGame(Math.floor(Math.random() * 1e6)); break;
      case 'continue': this.continueGame(); break;
      case 'help': this.openScreen('help'); break;
      case 'settings': this.openScreen('settings'); break;
      case 'toggle':
        this.settings[d.key] = !this.settings[d.key];
        this.applySettings();
        this.ui.render(g);
        break;
      case 'back':
        if (this.mode === 'title') this.ui.open('title', g);
        else this.ui.open(this.prevScreen && this.prevScreen !== this.ui.screen ? this.prevScreen : 'pause', g);
        break;
      case 'resume': case 'close':
        if (g.state === 'camp') this.ui.open('camp', g);
        else if (g.state === 'summit') this.ui.open('summit', g);
        else { this.ui.close(); this.paused = false; }
        break;
      case 'quit':
        if (g.state === 'play' || g.state === 'camp') g.save();
        this.ui.close();
        this.startDemo();
        this.ui.open('title', this.game);
        break;
      case 'inv': this.paused = true; this.openScreen('inv'); break;
      case 'journal': this.paused = g.state !== 'camp'; this.openScreen('journal'); break;
      case 'use':
        g.use(d.item);
        this.flushEvents();
        this.ui.render(g);
        break;
      case 'drink':
        if (g.inv.water > 0) g.use('water');
        else this.ui.toast('Your flask is empty.', 'warn');
        break;
      case 'chalk': g.chalkUp(); break;
      case 'piton': this.pitonKey(); break;
      case 'mantle': g.climber.startMantle(); break;
      case 'interact': case 'talk': this.interactKey(); break;
      case 'camp': this.openCamp(); break;
      case 'cook': g.cook(d.item); this.flushEvents(); this.ui.render(g); break;
      case 'sleep': g.sleep(); this.flushEvents(); this.ui.render(g); break;
      case 'refill': g.refillWater(); this.flushEvents(); this.ui.render(g); break;
      case 'pip':
        g.sendPip();
        this.flushEvents();
        this.ui.close();
        break;
      case 'cairn': g.buildCairn(); this.flushEvents(); this.ui.render(g); break;
      case 'leave': g.leaveCamp(); this.ui.close(); break;
      case 'retry': this.continueGame(); break;
      default: break;
    }
  }

  interactKey() {
    const g = this.game;
    const c = g.climber;
    if (g.dialogue) g.advanceDialogue();
    else if (g.interactTarget()) g.interact();
    else if (g.campLedge()) this.openCamp();
    else if (c.mantleLedge()) c.startMantle();
    this.flushEvents();
  }

  openCamp() {
    const g = this.game;
    if (g.state === 'camp') {
      this.ui.open('camp', g);
      return;
    }
    if (g.openCamp()) {
      this.flushEvents();
      if (g.state === 'camp') this.ui.open('camp', g);
    }
  }

  pitonKey() {
    const g = this.game;
    if (g.hammer) g.hammerStrike();
    else if (!g.startHammer() && g.inv.pitons > 0) this.ui.toast('Grab a crack with a hand to place a piton.', 'warn', 1800);
  }

  // ---- input --------------------------------------------------------------------------------------
  bindInput() {
    const cv = document.getElementById('input-layer');
    const ctl = this.controls;
    window.addEventListener('keydown', (e) => {
      if (e.repeat && !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
      this.audio.resume();
      ctl.keys.add(e.code);
      if (this.mode !== 'play') return;
      this.onKey(e);
    });
    window.addEventListener('keyup', (e) => ctl.keys.delete(e.code));
    window.addEventListener('blur', () => ctl.keys.clear());

    const pos = (e) => ({ x: e.clientX, y: e.clientY });
    cv.addEventListener('pointerdown', (e) => {
      this.audio.resume();
      if (this.mode !== 'play' || this.ui.screen) return;
      ctl.mouse = { ...pos(e), inside: true };
      cv.setPointerCapture(e.pointerId);
      if (e.button === 2 || e.button === 1) {
        // Right/middle button: a drag orbits the 3D camera, a click cancels / lets go.
        ctl.look = { x: ctl.mouse.x, y: ctl.mouse.y, moved: false, click: e.button === 2 };
        return;
      }
      this.leftDown();
    });
    cv.addEventListener('pointermove', (e) => {
      const prev = ctl.mouse;
      ctl.mouse = { ...pos(e), inside: true };
      if (ctl.look) {
        if (Math.hypot(ctl.mouse.x - ctl.look.x, ctl.mouse.y - ctl.look.y) > 4) ctl.look.moved = true;
        if (ctl.look.moved && this.active3d && this.renderer3d) this.renderer3d.orbit(ctl.mouse.x - prev.x, ctl.mouse.y - prev.y);
        return;
      }
      if (ctl.pending && Math.hypot(ctl.mouse.x - ctl.pending.x, ctl.mouse.y - ctl.pending.y) > 6) {
        const limb = ctl.pending.limb;
        ctl.pending = null;
        const c = this.game.climber;
        if (c.beginDrag(limb)) {
          ctl.dragging = true;
          ctl.limb = null;
        }
        this.flushEvents();
      }
      if (ctl.dragging) {
        const w = this.screenToWorld(ctl.mouse.x, ctl.mouse.y);
        this.game.climber.dragTo(w.x, w.y);
      }
    });
    cv.addEventListener('pointerup', () => {
      if (ctl.look) {
        const l = ctl.look;
        ctl.look = null;
        if (!l.moved && l.click) this.rightClick();
        return;
      }
      if (ctl.pending) {
        // A click (no drag) on a limb: act on the hold underneath instead, if any.
        const p = ctl.pending;
        ctl.pending = null;
        if (p.hold) this.clickHold(p.hold, p.limb);
        else ctl.limb = ctl.limb === p.limb ? null : p.limb;
        return;
      }
      if (ctl.dragging) {
        ctl.dragging = false;
        const r = this.game.climber.endDrag();
        this.flushEvents();
        if (r && !r.ok && r.reason === 'nohold') { /* limb stays free, hovering */ }
      }
    });
    cv.addEventListener('pointerleave', () => { ctl.mouse.inside = false; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.renderer;
      r.zoomMul = Math.min(1.8, Math.max(0.55, r.zoomMul * (e.deltaY > 0 ? 0.9 : 1.1)));
    }, { passive: false });
  }

  screenToWorld(x, y) {
    if (this.active3d && this.renderer3d) return this.renderer3d.toWorld(x, y);
    return this.renderer.toWorld(x, y);
  }

  onKey(e) {
    const g = this.game;
    const c = g.climber;
    const code = e.code;
    if (code === 'Escape') {
      if (this.ui.screen && g.state === 'camp' && this.ui.screen !== 'camp') this.ui.open('camp', g);
      else if (this.ui.screen && g.state === 'play') this.action('resume');
      else if (g.hammer) g.cancelHammer();
      else if (this.controls.limb) this.controls.limb = null;
      else if (g.state === 'play') { this.paused = true; this.openScreen('pause'); }
      return;
    }
    if (code === 'KeyJ') {
      if (this.ui.screen === 'journal') this.action('close');
      else this.action('journal');
      return;
    }
    if (code === 'KeyI' || code === 'Tab') {
      e.preventDefault();
      if (this.ui.screen === 'inv') this.action('close');
      else if (!this.ui.screen) this.action('inv');
      return;
    }
    if (this.ui.screen) return;
    if (g.state !== 'play') return;
    switch (code) {
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': {
        const l = c.limbs[Number(code.slice(5)) - 1];
        this.controls.limb = this.controls.limb === l ? null : l;
        break;
      }
      case 'KeyF': this.pitonKey(); break;
      case 'KeyC': g.chalkUp(); break;
      case 'KeyT': this.action('drink'); break;
      case 'KeyE': case 'Space':
        e.preventDefault();
        this.interactKey();
        break;
      case 'KeyW': case 'ArrowUp':
        if (c.state === 'climb' && c.mantleLedge()) c.startMantle();
        break;
      case 'KeyR':
        if (this.controls.limb) c.lift(this.controls.limb);
        break;
      case 'KeyM':
        this.settings.music = !this.settings.music;
        this.applySettings();
        this.ui.toast(`Music ${this.settings.music ? 'on' : 'off'}`);
        break;
      case 'KeyV':
        this.settings.view3d = !this.settings.view3d;
        this.applySettings();
        this.ui.toast(`${this.settings.view3d ? '3D' : '2D'} view`);
        break;
      default: break;
    }
  }

  leftDown() {
    const g = this.game;
    const c = g.climber;
    const ctl = this.controls;
    if (g.state !== 'play') return;
    if (g.hammer) {
      g.hammerStrike();
      return;
    }
    const w = this.screenToWorld(ctl.mouse.x, ctl.mouse.y);
    if (g.tryObserve(w.x, w.y)) {
      this.flushEvents();
      return;
    }
    if (ctl.hoverLimb && (c.state === 'climb' || c.state === 'rope')) {
      // Decide on pointer-up: moving = drag this limb, no movement = click the hold below it.
      ctl.pending = { limb: ctl.hoverLimb, x: ctl.mouse.x, y: ctl.mouse.y, hold: g.world.nearestHold(w.x, w.y, 16) };
      return;
    }
    if (ctl.hoverHold) this.clickHold(ctl.hoverHold);
    else if (this.active3d && this.renderer3d) ctl.look = { x: ctl.mouse.x, y: ctl.mouse.y, moved: false, click: false };
  }

  clickHold(hold, exclude) {
    const g = this.game;
    const c = g.climber;
    const ctl = this.controls;
    const sel = ctl.limb;
    // Walking around: stroll to the wall first, then reach.
    if (g.explore.active && (g.explore.z > 4 || !c.limbs.some((l) => c.canPlace(l, hold).ok)) && g.canWalkTo(hold)) {
      g.walkToHold(hold, () => c.chooseLimb(hold, sel));
      ctl.limb = null;
      return;
    }
    let limb = chooseLimb(c, hold, ctl.limb);
    if (limb === exclude && limb.hold === hold) limb = chooseLimb(c, hold, null);
    const r = c.place(limb, hold);
    if (r.ok) ctl.limb = null;
    this.flushEvents();
  }

  rightClick() {
    const g = this.game;
    const c = g.climber;
    const ctl = this.controls;
    if (g.hammer) { g.cancelHammer(); return; }
    if (ctl.limb) { ctl.limb = null; return; }
    if (ctl.hoverLimb) {
      c.lift(ctl.hoverLimb);
      this.flushEvents();
    }
  }

  updateHover() {
    const g = this.game;
    const c = g.climber;
    const ctl = this.controls;
    ctl.hoverLimb = null;
    ctl.hoverHold = null;
    ctl.reachable = null;
    if (this.mode !== 'play' || !ctl.mouse.inside || g.state !== 'play') return;
    const w = this.screenToWorld(ctl.mouse.x, ctl.mouse.y);
    if (!ctl.dragging && (c.state === 'climb' || c.state === 'rope')) {
      let best = null;
      let bd = 12;
      for (const l of c.limbs) {
        if (l.state === 'moving') continue;
        const d = dist(l.end.x, l.end.y, w.x, w.y);
        if (d < bd) { bd = d; best = l; }
      }
      ctl.hoverLimb = best;
    }
    if (!ctl.hoverLimb && !ctl.dragging) {
      const h = g.world.nearestHold(w.x, w.y, 16);
      if (h) {
        ctl.hoverHold = h;
        const limb = chooseLimb(c, h, ctl.limb);
        ctl.hoverOk = c.canPlace(limb, h).ok || (g.explore.active && g.canWalkTo(h));
      }
    }
    if (this.settings.assist && ctl.limb) {
      const set = new Set();
      const r = c.root(ctl.limb);
      for (const h of g.world.holdsNear(r.x, r.y, ctl.limb.reach + 30)) if (c.canPlace(ctl.limb, h).ok) set.add(h);
      ctl.reachable = set;
    }
  }

  flushEvents() {
    const g = this.game;
    const demo = this.mode !== 'play';
    for (const e of g.events) {
      if (!demo) this.audio.play(e);
      if (demo) continue;
      switch (e.type) {
        case 'toast': this.ui.toast(e.text, e.kind); break;
        case 'discover': this.ui.discovery(e); break;
        case 'reject': this.ui.reject(e.reason); break;
        case 'death':
          setTimeout(() => this.ui.open('death', g), 1200);
          break;
        case 'summit':
          setTimeout(() => this.ui.open('summit', g), 1500);
          break;
        case 'grip':
          if (g.climber.chalkTime > 0 && e.hold) e.hold.chalked = true;
          break;
        default: break;
      }
    }
    g.events.length = 0;
  }

  playerInput() {
    const move = this.controls.move();
    const g = this.game;
    const input = { move };
    if (g.dialogue) return { move: { x: 0, y: 0 } };
    if (this.active3d && this.renderer3d && g.explore.active && g.state === 'play') {
      // WASD relative to the camera: W walks away from the camera.
      const yaw = this.renderer3d.viewYaw();
      const dx = move.x;
      const dz = move.y;
      if (dx || dz) {
        const len = Math.hypot(dx, dz);
        input.walk = {
          x: (dx * Math.cos(yaw) + dz * Math.sin(yaw)) / len,
          z: (-dx * Math.sin(yaw) + dz * Math.cos(yaw)) / len,
        };
      }
      input.run = this.controls.keys.has('ShiftLeft') || this.controls.keys.has('ShiftRight');
    }
    return input;
  }

  // ---- loop -----------------------------------------------------------------------------------------
  frame(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const g = this.game;
    if (this.mode === 'title') {
      const input = this.demoBot.update(dt);
      g.update(dt, input);
      if (g.state === 'summit' || g.climber.C.y < -2600) this.startDemo();
    } else if (!this.paused && !(this.ui.screen && this.ui.screen !== 'camp' && this.ui.screen !== 'death' && this.ui.screen !== 'summit')) {
      g.flat = !this.active3d;
      g.update(dt, this.playerInput());
      if (this.active3d && g.explore.active && g.explore.ledge && g.explore.ledge.ground) g.tip('walk');
    } else if (g.state === 'camp') {
      g.update(dt, {});
    }
    this.flushEvents();
    this.updateHover();
    if (this.mode === 'play') this.ui.updateHUD(this.game, this.controls);
    this.audio.update(this.game, dt);
    if (this.game.state === 'camp' && this.ui.screen === 'camp' && Math.floor(t / 500) !== this.campTick) {
      this.campTick = Math.floor(t / 500);
      // keep the camp screen's clock/stats fresh without stealing clicks
      const sub = this.ui.panel.querySelector('.sub');
      if (sub) sub.textContent = `Bivouac ${this.game.camp.ledge.bivouac + 1} of 7 · ${this.game.altitude()} m · Day ${this.game.day}, ${this.game.clockString()}`;
    }
    const focus = this.mode === 'title' ? { x: g.climber.C.x + 60, y: g.climber.C.y - 40 } : null;
    const uiState = this.mode === 'play' ? this.controls : null;
    if (this.active3d && this.renderer3d) {
      this.renderer.updateCamera(g, dt, focus);
      this.renderer3d.render(g, uiState, dt);
    } else {
      this.renderer.updateCamera(g, dt, focus);
      this.renderer.render(g, uiState, dt);
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }
}

window.addEventListener('DOMContentLoaded', () => new App());
