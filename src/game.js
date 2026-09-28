// Game state: survival, inventory, rope & pitons, camps, hazards, Pip the climbot, journal, saving.
import { World } from './world.js';
import { Climber } from './climber.js';
import {
  BODY, BIVOUACS, ITEMS, EAT_EFFECTS, RECIPES, START_INVENTORY, FLORA, FAUNA, RELICS,
  CLIMBOT_TIPS, ZONES, zoneIndexAt, BASE_ALT, METRES_PER_PX, WORLD_HEIGHT, VALLEY, TOBI_LINES, KIP_LINES, DIFFICULTY,
} from './config.js';
import { clamp, dist, lerp, mulberry32, noise1 } from './rng.js';

const SAVE_KEY = 'veyra-save-v1';

export function storageGet(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch (e) {
    return null;
  }
}

export function storageSet(key, val) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, val);
  } catch (e) {
    /* storage unavailable */
  }
}

export function hasSave() {
  return !!storageGet(SAVE_KEY);
}

export class Game {
  constructor(opts = {}) {
    this.opts = { survival: true, hazards: true, seed: 7, difficulty: 'normal', ...opts };
    this.seed = this.opts.seed;
    this.difficulty = DIFFICULTY[this.opts.difficulty] ? this.opts.difficulty : 'normal';
    this.diff = DIFFICULTY[this.difficulty];
    this.world = new World(this.seed, this.difficulty);
    this.rand = mulberry32(this.seed * 31 + 5);
    this.events = [];
    this.inv = { ...START_INVENTORY, ...this.diff.start };
    this.vitals = { health: 100, satiety: 80, hydration: 80, warmth: 90 };
    this.time = 7.0; // hours
    this.day = 1;
    this.journal = { flora: {}, fauna: {}, relics: {}, cairns: {} };
    this.stats = { playTime: 0, falls: 0, pitons: 0, moves: 0, maxAlt: 0, meals: 0 };
    this.tipsShown = {};
    this.lastBivouac = -1;
    this.state = 'play'; // play | camp | dead | summit
    this.camp = null;
    this.hammer = null;
    this.rocks = [];
    this.rockTimer = 40;
    this.gust = { t: 0, next: 10, dir: 1, strength: 0 };
    this.placedPitons = [];
    this.taken = new Set();
    this.particles = [];
    this.message = null;
    this.climber = new Climber(this.world, 0, 0);
    this.anchors = [{ x: 0, y: -6, type: 'bolt', q: 1 }];
    this.climber.setAnchor(this.anchors[0]);
    this.pip = { x: -40, y: -140, vx: 0, vy: 0, mode: 'follow', queue: [], carry: 0, say: null, sayT: 0, blink: 0 };
    this.faunaState = this.world.fauna.map((f) => ({ ...f, seen: false, t: this.rand() * 10, px: f.x, py: f.y, visible: false }));
    this.springCooldown = 0;
    this.explore = { active: false, x: 0, z: 0, heading: Math.PI, walking: false, phase: 0, speed: 0, pending: null, ledge: null, snapT: 0 };
    this.flat = false; // true in the 2D view: the valley's depth is ignored
    this.talkedTobi = false;
    this.dialogue = null;
    this.meadowFauna = this.world.meadowFauna.map((f) => ({ ...f, t: this.rand() * 100, visible: true }));
    this.tip('start');
  }

  // ---- helpers ----------------------------------------------------------------
  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  toast(text, kind = 'info') {
    this.emit('toast', { text, kind });
  }

  tip(key, force = false) {
    if (this.tipsShown[key] && !force) return;
    this.tipsShown[key] = true;
    this.pip.say = CLIMBOT_TIPS[key];
    this.pip.sayT = 6 + CLIMBOT_TIPS[key].length / 25;
    this.emit('tip', { key, text: CLIMBOT_TIPS[key] });
  }

  altitude(y = this.climber.C.y) {
    return Math.round(BASE_ALT + Math.max(0, -y - BODY.standHeight) * METRES_PER_PX);
  }

  zoneIndex() {
    return zoneIndexAt(this.climber.C.y);
  }

  isNight() {
    return this.time < 6 || this.time >= 20;
  }

  daylight() {
    // 0 night .. 1 full day
    const t = this.time;
    if (t >= 7 && t <= 18.5) return 1;
    if (t < 5 || t > 21) return 0;
    if (t < 7) return (t - 5) / 2;
    return 1 - (t - 18.5) / 2.5;
  }

  temperature() {
    const z = ZONES[this.zoneIndex()];
    const alt = this.altitude();
    let temp = 16 - (alt - BASE_ALT) * 0.017;
    temp -= (1 - this.daylight()) * 7;
    temp -= this.gust.strength * 4;
    temp += z.temp * 0.2;
    return temp;
  }

  staminaCap() {
    const v = this.vitals;
    const f = (x) => (x >= 30 ? 1 : 0.45 + 0.55 * (x / 30));
    const h = 0.55 + 0.45 * (v.health / 100);
    return clamp(100 * f(v.satiety) * f(v.hydration) * f(v.warmth) * h, 25, 100);
  }

  // ---- actions ----------------------------------------------------------------------
  canEat() {
    const c = this.climber;
    if (this.state === 'camp') return true;
    if (c.state === 'rope') return true;
    return c.state === 'climb' && (c.standing || c.attached().length >= 3);
  }

  use(item) {
    if (!this.inv[item] || !EAT_EFFECTS[item]) return false;
    if (!this.canEat()) {
      this.toast('Need three points of contact (or stand on a ledge) to use items.', 'warn');
      return false;
    }
    this.inv[item]--;
    const eff = EAT_EFFECTS[item];
    for (const k of Object.keys(eff)) {
      this.vitals[k] = clamp(this.vitals[k] + eff[k], 0, 100);
    }
    this.stats.meals++;
    this.emit('eat', { item });
    this.toast(`${ITEMS[item].name}: ${ITEMS[item].desc}`);
    return true;
  }

  chalkUp() {
    const c = this.climber;
    if (this.inv.chalk <= 0) {
      this.toast('No chalk left.', 'warn');
      return false;
    }
    if (c.state !== 'climb' && c.state !== 'rope') return false;
    this.inv.chalk--;
    c.chalkTime = 45;
    this.emit('chalk');
    for (let i = 0; i < 14; i++) {
      this.particles.push({ x: c.C.x + (Math.random() - 0.5) * 20, y: c.C.y - 5, vx: (Math.random() - 0.5) * 50, vy: -Math.random() * 40, life: 1.2, max: 1.2, color: '#f2f2ee', size: 3 });
    }
    return true;
  }

  pitonCandidate() {
    const c = this.climber;
    if (c.state !== 'climb') return null;
    for (const l of c.limbs) {
      if (l.hand && l.state === 'grip' && l.hold.type === 'crack' && !l.hold.piton) return l.hold;
    }
    return null;
  }

  startHammer() {
    const h = this.pitonCandidate();
    if (!h) return false;
    if (this.inv.pitons <= 0) {
      this.tip('noPitons');
      this.toast('No pitons left.', 'warn');
      return false;
    }
    this.hammer = { hold: h, t: 0, hits: 0, good: 0, marker: 0 };
    this.emit('hammerStart');
    return true;
  }

  hammerStrike() {
    const hm = this.hammer;
    if (!hm) return;
    const good = Math.abs(hm.marker - 0.5) < 0.13;
    hm.hits++;
    if (good) hm.good++;
    this.climber.stamina = Math.max(0, this.climber.stamina - (good ? 1 : 3));
    this.emit('hammer', { good });
    if (hm.hits >= 3) {
      this.inv.pitons--;
      const p = { x: hm.hold.x + 5, y: hm.hold.y + 7, type: 'piton', q: 0.35 + 0.2 * hm.good, hold: hm.hold, retrieved: false };
      hm.hold.piton = p;
      this.placedPitons.push(p);
      this.anchors.push(p);
      this.climber.setAnchor(p);
      this.stats.pitons++;
      this.hammer = null;
      this.emit('pitonPlaced', { quality: p.q });
      this.toast(hm.good >= 2 ? 'Piton set solid. Rope clipped.' : 'Piton set, but it wobbles…', hm.good >= 2 ? 'good' : 'warn');
    }
  }

  cancelHammer() {
    this.hammer = null;
  }

  // ---- camp ----------------------------------------------------------------------------------
  campLedge() {
    const lg = this.climber.standingLedge();
    if (lg && lg.bivouac !== undefined) return lg;
    return null;
  }

  openCamp() {
    const lg = this.campLedge();
    if (!lg || this.state !== 'play') return false;
    if (lg.summit) {
      this.reachSummit();
      return true;
    }
    this.state = 'camp';
    this.camp = { ledge: lg, fire: true };
    lg.camped = true;
    // Rope is re-rigged on the bivouac's bolt.
    const bolt = { x: (lg.x1 + lg.x2) / 2, y: lg.y - 4, type: 'bolt', q: 1 };
    this.anchors = [bolt];
    this.climber.setAnchor(bolt);
    this.lastBivouac = lg.bivouac;
    this.emit('camp', { ledge: lg });
    this.save();
    return true;
  }

  leaveCamp() {
    if (this.state !== 'camp') return;
    this.state = 'play';
    this.camp = null;
    this.emit('leaveCamp');
  }

  cook(recipeOut) {
    const r = RECIPES.find((x) => x.out === recipeOut);
    if (!r || this.state !== 'camp') return false;
    for (const [k, n] of Object.entries(r.need)) if ((this.inv[k] || 0) < n) return false;
    if (this.inv[r.out] >= ITEMS[r.out].max) return false;
    for (const [k, n] of Object.entries(r.need)) this.inv[k] -= n;
    this.inv[r.out]++;
    this.emit('cook', { item: r.out });
    this.toast(`Cooked ${ITEMS[r.out].name}.`, 'good');
    return true;
  }

  canCook(recipeOut) {
    const r = RECIPES.find((x) => x.out === recipeOut);
    if (!r) return false;
    for (const [k, n] of Object.entries(r.need)) if ((this.inv[k] || 0) < n) return false;
    return this.inv[r.out] < ITEMS[r.out].max;
  }

  refillWater() {
    this.inv.water = ITEMS.water.max;
    this.emit('water');
    this.toast('Filled your flask at the trickle behind the bivouac.', 'good');
  }

  sleep() {
    if (this.state !== 'camp') return;
    const hoursToMorning = this.time < 7 ? 7 - this.time : 24 - this.time + 7;
    const hours = this.isNight() || this.time > 17 ? hoursToMorning : 3;
    this.advanceClock(hours);
    this.vitals.satiety = clamp(this.vitals.satiety - hours * 1.6, 0, 100);
    this.vitals.hydration = clamp(this.vitals.hydration - hours * 2, 0, 100);
    this.vitals.health = clamp(this.vitals.health + hours * 2.5, 0, 100);
    this.vitals.warmth = 100;
    this.climber.staminaMax = this.staminaCap();
    this.climber.stamina = this.climber.staminaMax;
    this.emit('sleep', { hours });
    this.toast(`Slept ${Math.round(hours)} hours. Day ${this.day}, ${this.clockString()}.`, 'good');
    this.save();
  }

  buildCairn() {
    if (this.state !== 'camp') return;
    const lg = this.camp.ledge;
    if (this.journal.cairns[lg.bivouac]) {
      this.toast('Your cairn already stands here.');
      return;
    }
    this.journal.cairns[lg.bivouac] = true;
    lg.cairn = true;
    this.emit('cairn');
    this.toast(`You stack a cairn at ${lg.name}. Progress saved.`, 'good');
    this.save();
  }

  pitonsBelowCamp() {
    if (!this.camp) return [];
    return this.placedPitons.filter((p) => !p.retrieved && !p.fetching && p.y > this.camp.ledge.y);
  }

  sendPip() {
    const list = this.pitonsBelowCamp();
    if (!list.length) {
      this.toast('Pip: "No pitons left below us!"');
      return false;
    }
    list.sort((a, b) => a.y - b.y);
    for (const p of list) p.fetching = true;
    this.pip.mode = 'fetch';
    this.pip.queue = list.slice().reverse(); // nearest first
    this.pip.home = { x: this.climber.C.x - 30, y: this.climber.C.y - 50 };
    this.emit('pipGo');
    this.pip.say = `Be right back with ${list.length} piton${list.length > 1 ? 's' : ''}!`;
    this.pip.sayT = 3;
    return true;
  }

  // ---- summit / death / save ------------------------------------------------------------
  reachSummit() {
    if (this.state === 'summit') return;
    this.state = 'summit';
    this.journal.cairns[BIVOUACS.length - 1] = true;
    this.emit('summit');
    this.save();
  }

  die(reason) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.climber.state = 'dead';
    this.deathReason = reason;
    this.emit('death', { reason });
  }

  save() {
    const data = {
      seed: this.seed,
      difficulty: this.difficulty,
      bivouac: this.lastBivouac,
      inv: this.inv,
      vitals: this.vitals,
      time: this.time,
      day: this.day,
      journal: this.journal,
      stats: this.stats,
      taken: [...this.taken],
      tips: this.tipsShown,
      retrieved: this.placedPitons.filter((p) => p.retrieved).length,
      talkedTobi: this.talkedTobi,
      valley: this.world.valley.map((v) => v.picked ?? -1),
    };
    storageSet(SAVE_KEY, JSON.stringify(data));
    this.emit('saved');
  }

  static load(opts = {}) {
    const raw = storageGet(SAVE_KEY);
    if (!raw) return null;
    let d;
    try {
      d = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    const g = new Game({ ...opts, seed: d.seed, difficulty: d.difficulty || 'easy' });
    g.applySave(d);
    return g;
  }

  applySave(d) {
    this.inv = { ...START_INVENTORY, ...this.diff.start, ...d.inv };
    this.vitals = { ...d.vitals };
    this.vitals.health = Math.max(this.vitals.health, 60);
    this.vitals.satiety = Math.max(this.vitals.satiety, 30);
    this.vitals.hydration = Math.max(this.vitals.hydration, 30);
    this.vitals.warmth = Math.max(this.vitals.warmth, 60);
    this.time = d.time;
    this.day = d.day;
    this.journal = { flora: {}, fauna: {}, relics: {}, cairns: {}, ...d.journal };
    this.stats = { ...this.stats, ...d.stats };
    this.tipsShown = d.tips || {};
    this.taken = new Set(d.taken || []);
    this.lastBivouac = d.bivouac;
    this.talkedTobi = !!d.talkedTobi;
    if (d.valley) this.world.valley.forEach((v, i) => { if (d.valley[i] !== undefined) v.picked = d.valley[i]; });
    for (const [k] of Object.entries(this.journal.cairns)) {
      const lg = this.world.ledges.find((l) => l.bivouac === Number(k));
      if (lg) lg.cairn = true;
    }
    for (const f of this.faunaState) if (this.journal.fauna[f.id]) f.seen = true;
    if (d.bivouac >= 0) {
      const lg = this.world.ledges.find((l) => l.bivouac === d.bivouac);
      if (lg) {
        const cx = (lg.x1 + lg.x2) / 2;
        this.climber = new Climber(this.world, cx, lg.y);
        const bolt = { x: cx, y: lg.y - 4, type: 'bolt', q: 1 };
        this.anchors = [bolt];
        this.climber.setAnchor(bolt);
        this.pip.x = cx - 40;
        this.pip.y = lg.y - 140;
        lg.camped = true;
      }
    }
    this.pip.say = null;
    this.events = [];
  }

  // ---- clock -------------------------------------------------------------------------------------
  advanceClock(hours) {
    this.time += hours;
    while (this.time >= 24) {
      this.time -= 24;
      this.day++;
    }
  }

  clockString() {
    const h = Math.floor(this.time);
    const m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // ---- update --------------------------------------------------------------------------------------
  update(dt, input = {}) {
    dt = Math.min(dt, 1 / 20);
    const c = this.climber;
    if (this.state === 'dead' || this.state === 'summit') {
      this.updateParticles(dt);
      this.updatePip(dt);
      return;
    }
    this.stats.playTime += dt;
    this.advanceClock(dt * (1.5 / 60));

    const zi = this.zoneIndex();
    const zone = ZONES[zi];

    // Environment on the climber.
    c.overhang = zone.overhang;
    this.updateWind(dt, zone);
    c.wind = this.gust.strength;
    c.external.x = this.gust.dir * this.gust.strength * 38;
    c.external.y = 0;

    if (this.hammer) {
      this.hammer.t += dt;
      this.hammer.marker = (Math.sin(this.hammer.t * 4.4 - Math.PI / 2) + 1) / 2;
      if (c.state !== 'climb' || !c.limbs.some((l) => l.hand && l.hold === this.hammer.hold)) this.hammer = null;
    }

    const climberInput = this.state === 'camp' || this.hammer ? {} : input;
    c.staminaMax = this.staminaCap();
    const walking3d = !!(input.walk && this.explore.active && !this.hammer && this.state === 'play');
    c.update(dt, walking3d || this.explore.pending ? { move: { x: 0, y: 0 } } : climberInput);
    this.handleClimberEvents();
    this.updateExplore(dt, this.state === 'play' ? input : {});

    if (this.opts.survival) this.updateSurvival(dt, zone);
    if (this.opts.hazards) this.updateRocks(dt, zone);
    if (this.opts.hazards) this.updateSlips(dt);
    this.updatePickups(dt);
    this.updateFauna(dt);
    this.updateMeadow(dt);
    this.updatePip(dt);
    this.updateParticles(dt);
    this.updateTips(zone);

    this.stats.maxAlt = Math.max(this.stats.maxAlt, this.altitude());
    if (this.vitals.health <= 0) this.die(this.deathCause || 'Your body gave out.');
  }

  updateWind(dt, zone) {
    const g = this.gust;
    const base = zone.wind * 0.25 * noise1(this.stats.playTime * 0.1, 3);
    if (zone.wind >= 0.3 && this.opts.hazards) {
      g.next -= dt;
      if (g.next <= 0 && g.t <= 0) {
        g.t = 2.2;
        g.dir = this.rand() < 0.5 ? -1 : 1;
        g.next = 9 + this.rand() * 9;
        this.emit('gust');
        this.tip('wind');
      }
    }
    if (g.t > 0) {
      g.t -= dt;
      const k = Math.sin(clamp(g.t / 2.2, 0, 1) * Math.PI);
      g.strength = base + zone.wind * k;
    } else {
      g.strength = base;
    }
  }

  handleClimberEvents() {
    const c = this.climber;
    for (const e of c.events) {
      switch (e.type) {
        case 'grip':
          this.stats.moves++;
          if (e.hold && e.hold.loose && e.hand) this.tip('loose');
          this.emit('grip', e);
          break;
        case 'fall':
          this.stats.falls++;
          this.hammer = null;
          this.emit('fall', e);
          break;
        case 'land': {
          const d = e.dist;
          const dmg = d > 110 ? (d - 110) * 0.14 * this.diff.fallDamage : 0;
          if (dmg > 0) {
            this.vitals.health -= dmg;
            this.deathCause = `You fell ${Math.round(d * METRES_PER_PX)} m.`;
            this.emit('hurt', { amount: dmg });
          }
          this.emit('land', e);
          break;
        }
        case 'ropeCatch': {
          const a = this.anchors[this.anchors.length - 1];
          const d = e.dist;
          let pop = false;
          if (a && a.type === 'piton') {
            const chance = clamp((d - 140) / 500, 0, 0.7) * (1.25 - a.q);
            pop = this.rand() < chance;
          }
          if (pop) {
            this.anchors.pop();
            a.popped = true;
            a.retrieved = true;
            if (a.hold) a.hold.piton = null;
            const next = this.anchors[this.anchors.length - 1];
            c.setAnchor(next);
            c.ropeLen = dist(c.C.x, c.C.y, next.x, next.y) + 20;
            c.state = 'fall';
            c.caught = false;
            this.emit('pop');
            this.toast('The piton ripped out!', 'bad');
          } else {
            const dmg = d > 180 ? (d - 180) * 0.05 * this.diff.fallDamage : 0;
            if (dmg > 0) {
              this.vitals.health -= dmg;
              this.deathCause = 'The rope caught you too hard.';
              this.emit('hurt', { amount: dmg });
            }
            this.emit('ropeCatch', e);
            this.tip('rope');
          }
          break;
        }
        case 'crumble':
          this.emit('crumble', e);
          for (let i = 0; i < 16; i++) {
            this.particles.push({ x: e.hold.x, y: e.hold.y, vx: (Math.random() - 0.5) * 60, vy: Math.random() * 60, life: 1.5, max: 1.5, color: '#6b625a', size: 2 + Math.random() * 3, grav: 400 });
          }
          break;
        case 'stand':
          this.emit('stand', e);
          break;
        default:
          this.emit(e.type, e);
      }
    }
    c.events.length = 0;
  }

  updateSurvival(dt, zone) {
    const v = this.vitals;
    const c = this.climber;
    const exertion = c.state === 'climb' && !c.standing ? 1.25 : 0.8;
    const inCamp = this.state === 'camp';
    v.satiety = clamp(v.satiety - dt * (100 / 600) * this.diff.survival * exertion * (inCamp ? 0.5 : 1), 0, 100);
    v.hydration = clamp(v.hydration - dt * (100 / 480) * this.diff.survival * exertion * (inCamp ? 0.5 : 1), 0, 100);
    const temp = this.temperature();
    let dw = clamp((temp - 3) * 0.045, -0.55, 0.35);
    if (inCamp) dw = 2.5;
    v.warmth = clamp(v.warmth + dw * dt, 0, 100);
    let starving = false;
    if (v.satiety <= 0) { v.health -= 0.4 * dt; starving = true; this.deathCause = 'You starved on the mountain.'; }
    if (v.hydration <= 0) { v.health -= 0.6 * dt; starving = true; this.deathCause = 'Dehydration took you.'; }
    if (v.warmth <= 0) { v.health -= 0.7 * dt; starving = true; this.deathCause = 'You froze on the wall.'; }
    if (!starving && inCamp) v.health = clamp(v.health + dt * 0.8, 0, 100);
    if (v.satiety < 25) this.tip('hungry');
    if (v.hydration < 25) this.tip('thirsty');
    if (v.warmth < 30) this.tip('cold');
  }

  // Alpinist: tired hands can slip off a hold (never the last one).
  updateSlips(dt) {
    const c = this.climber;
    if (!this.diff.slip || c.state !== 'climb' || c.standing || this.state !== 'play') return;
    const frac = c.stamina / Math.max(1, c.staminaMax);
    if (frac > 0.22) return;
    const hands = c.handsAttached();
    if (hands.length < 2) return;
    if (this.rand() < this.diff.slip * (1 - frac / 0.22) * dt * 3) {
      const l = hands[Math.floor(this.rand() * hands.length)];
      l.state = 'free';
      l.hold = null;
      this.emit('slip', { limb: l.id });
      this.toast('Your tired hand slips!', 'bad');
    }
  }

  updateRocks(dt, zone) {
    const c = this.climber;
    if (zone.rockfall > 0 && this.state === 'play' && (c.state === 'climb' && !c.standing)) {
      this.rockTimer -= dt * zone.rockfall * this.diff.rockfall;
      if (this.rockTimer <= 0) {
        this.rockTimer = 45 + this.rand() * 40;
        const x = c.C.x + (this.rand() < 0.5 ? -1 : 1) * (10 + this.rand() * 80);
        this.rocks.push({ x, y: c.C.y - 520, vx: (this.rand() - 0.5) * 20, vy: 0, r: 7 + this.rand() * 7, warn: 1.8, rot: 0 });
        this.emit('rockWarn');
      }
    }
    for (const r of this.rocks) {
      if (r.warn > 0) {
        r.warn -= dt;
        continue;
      }
      r.vy += 900 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.rot += dt * 6;
      if (!r.hit && c.state !== 'fall') {
        const pts = [c.C, ...c.limbs.filter((l) => l.hand).map((l) => l.end)];
        for (const p of pts) {
          if (dist(p.x, p.y, r.x, r.y) < r.r + (p === c.C ? 22 : 10)) {
            r.hit = true;
            this.vitals.health -= 10;
            this.deathCause = 'Struck by falling rock.';
            this.emit('rockHit');
            this.toast('Hit by a falling rock!', 'bad');
            const hands = c.handsAttached();
            if (hands.length) {
              const l = hands[Math.floor(this.rand() * hands.length)];
              l.state = 'free';
              l.hold = null;
            }
            break;
          }
        }
      }
    }
    this.rocks = this.rocks.filter((r) => r.y < c.C.y + 900);
  }

  updatePickups(dt) {
    const c = this.climber;
    if (this.springCooldown > 0) this.springCooldown -= dt;
    if (c.state !== 'climb') return;
    const standingLg = c.standingLedge();
    const pts = c.limbs.filter((l) => l.hand && l.state === 'grip').map((l) => l.end);
    pts.push(c.C);
    this.world.pickups.forEach((p, i) => {
      if (this.taken.has(i)) return;
      let near = false;
      if (p.ledge) {
        near = standingLg === p.ledge && Math.abs(c.C.x - p.x) < 40;
        if (!near) near = pts.some((q) => dist(q.x, q.y, p.x, p.y) < 30);
      } else {
        near = pts.some((q) => dist(q.x, q.y, p.x, p.y) < 30);
      }
      if (!near) return;
      if (p.spring) {
        if (this.springCooldown <= 0 && this.inv.water < ITEMS.water.max) {
          this.inv.water = ITEMS.water.max;
          this.springCooldown = 5;
          this.emit('water');
          this.toast('You fill your flask from the spring.', 'good');
        }
        return;
      }
      this.taken.add(i);
      if (p.kind === 'item') {
        const before = this.inv[p.item] || 0;
        this.inv[p.item] = Math.min(ITEMS[p.item].max, before + p.amount);
        const got = this.inv[p.item] - before;
        this.emit('pickup', { item: p.item });
        this.toast(got > 0 ? `+${got} ${ITEMS[p.item].name}${p.stash ? ' (old climber\'s stash)' : ''}` : `Your pack can't hold more ${ITEMS[p.item].name}.`, got > 0 ? 'good' : 'warn');
      } else if (p.kind === 'flora') {
        this.discover('flora', p.id);
      } else if (p.kind === 'relic') {
        this.discover('relics', p.id);
      }
    });
  }

  discover(cat, id) {
    if (this.journal[cat][id]) return;
    this.journal[cat][id] = { day: this.day, time: this.clockString(), alt: this.altitude() };
    const table = cat === 'flora' ? FLORA : cat === 'fauna' ? FAUNA : RELICS;
    const entry = table.find((x) => x.id === id);
    this.emit('discover', { cat, id, entry });
  }

  updateFauna(dt) {
    const c = this.climber;
    for (const f of this.faunaState) {
      f.t += dt;
      if (f.kind === 'ledge') {
        f.px = f.x + Math.sin(f.t * 0.4) * 10;
        f.py = f.y;
        f.visible = Math.abs(f.py - c.C.y) < 700;
      } else if (f.kind === 'fly') {
        const inRange = c.C.y > f.range[0] && c.C.y < f.range[1];
        f.visible = inRange;
        if (inRange) {
          const R = f.id === 'eagle' ? 260 : 170;
          f.px = c.C.x + Math.cos(f.t * (f.id === 'eagle' ? 0.25 : 0.55)) * R;
          f.py = c.C.y - 180 + Math.sin(f.t * 0.7) * 60;
        }
      } else if (f.kind === 'wall') {
        const inRange = c.C.y > f.range[0] && c.C.y < f.range[1];
        f.visible = inRange;
        if (inRange) {
          const hop = Math.floor(f.t / 2.5);
          const r = mulberry32(hop + 99);
          const tx = c.C.x + (r() - 0.5) * 260;
          const ty = c.C.y + (r() - 0.5) * 200;
          f.px = lerp(f.px, tx, Math.min(1, dt * 3));
          f.py = lerp(f.py, ty, Math.min(1, dt * 3));
        }
      }
      if (f.visible && !this.journal.fauna[f.id] && Math.abs(f.py - c.C.y) < 350 && Math.abs(f.px - c.C.x) < 450) this.tip('fauna');
    }
  }

  // Click in world coords: record an animal sighting.
  tryObserve(x, y) {
    for (const f of this.faunaState) {
      if (!f.visible || this.journal.fauna[f.id]) continue;
      if (dist(f.px, f.py - 8, x, y) < 34 && dist(f.px, f.py, this.climber.C.x, this.climber.C.y) < 700) {
        f.seen = true;
        this.discover('fauna', f.id);
        return true;
      }
    }
    return false;
  }

  updatePip(dt) {
    const p = this.pip;
    const c = this.climber;
    p.blink -= dt;
    if (p.blink < -3) p.blink = 0.15;
    if (p.sayT > 0) {
      p.sayT -= dt;
      if (p.sayT <= 0) p.say = null;
    }
    let tx;
    let ty;
    let speed = 4;
    if (p.mode === 'fetch') {
      const target = p.queue[p.queue.length - 1];
      if (target) {
        tx = target.x;
        ty = target.y - 10;
        speed = 0;
        const d = dist(p.x, p.y, tx, ty);
        const step = Math.min(d, 900 * dt);
        if (d > 0.1) {
          p.x += ((tx - p.x) / d) * step;
          p.y += ((ty - p.y) / d) * step;
        }
        if (d < 6) {
          target.retrieved = true;
          target.fetching = false;
          if (target.hold) target.hold.piton = null;
          p.carry++;
          p.queue.pop();
          this.emit('pipGrab');
        }
      } else {
        tx = c.C.x - 34;
        ty = c.C.y - 52;
        const d = dist(p.x, p.y, tx, ty);
        const step = Math.min(d, 900 * dt);
        if (d > 0.1) {
          p.x += ((tx - p.x) / d) * step;
          p.y += ((ty - p.y) / d) * step;
        }
        if (d < 8) {
          p.mode = 'follow';
          this.inv.pitons = Math.min(ITEMS.pitons.max, this.inv.pitons + p.carry);
          this.toast(`Pip returned ${p.carry} piton${p.carry > 1 ? 's' : ''}!`, 'good');
          p.say = 'Got them all! Beep-boop.';
          p.sayT = 3;
          p.carry = 0;
          this.emit('pipBack');
        }
      }
    }
    if (p.mode === 'follow') {
      const side = c.C.x > 0 ? -1 : 1;
      tx = c.C.x + side * 42 + Math.sin(c.time * 0.8) * 6;
      ty = c.C.y - 58 + Math.sin(c.time * 1.9) * 5;
      p.x = lerp(p.x, tx, Math.min(1, dt * speed));
      p.y = lerp(p.y, ty, Math.min(1, dt * speed));
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += (p.grav || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  updateTips(zone) {
    const c = this.climber;
    if (c.stamina < 35 && c.state === 'climb' && !c.standing) this.tip('stamina');
    if (this.pitonCandidate() && this.inv.pitons > 0) this.tip('crack');
    if (this.campLedge() && this.state === 'play' && !this.campLedge().summit) this.tip('camp');
    if (this.isNight()) this.tip('night');
    const nearFlora = this.world.pickups.some((p, i) => p.kind === 'flora' && !this.taken.has(i) && dist(p.x, p.y, c.C.x, c.C.y) < 220);
    if (nearFlora) this.tip('flower');
  }

  // ---- walking around (valley and bivouac ledges) -----------------------------------------------
  updateExplore(dt, input) {
    const c = this.climber;
    const ex = this.explore;
    const lg = c.state === 'climb' && !c.limbs.some((l) => l.state === 'moving') ? c.standingLedge() : null;
    ex.active = !!lg;
    ex.ledge = lg;
    if (!lg) {
      ex.walking = false;
      ex.pending = null;
      ex.x = c.C.x;
      ex.z = lerp(ex.z, 0, Math.min(1, dt * 4));
      return;
    }
    const bounds = lg.ground
      ? { x0: VALLEY.x0 + 20, x1: VALLEY.x1 - 20, z0: 0, z1: VALLEY.z1 }
      : { x0: lg.x1 + 10, x1: lg.x2 - 10, z0: 0, z1: 16 };
    let wx = 0;
    let wz = 0;
    let speed = 115;
    if (ex.pending) {
      const tx = clamp(ex.pending.hold.x, bounds.x0, bounds.x1);
      const dx = tx - ex.x;
      const dz = -ex.z;
      const d = Math.hypot(dx, dz);
      if (Math.abs(dx) < 22 && ex.z < 4) {
        const p = ex.pending;
        ex.pending = null;
        const limb = p.choose ? p.choose() : c.chooseLimb(p.hold);
        c.place(limb, p.hold);
        this.handleClimberEvents();
      } else if (d > 0.01) {
        wx = dx / d;
        wz = dz / d;
        speed = 170;
      }
    } else if (input.walk) {
      wx = input.walk.x;
      wz = input.walk.z;
      if (input.run) speed = 200;
    } else if (!this.flat) {
      ex.x = c.C.x;
    }
    const len = Math.hypot(wx, wz);
    ex.walking = len > 0.05;
    if (ex.walking) {
      ex.x = clamp(ex.x + wx * speed * dt, bounds.x0, bounds.x1);
      ex.z = clamp(ex.z + wz * speed * dt, bounds.z0, bounds.z1);
      if (lg.ground) {
        // walk around the lake, not through it
        const L = VALLEY.lake;
        const dl = Math.hypot(ex.x - L.x, ex.z - L.z);
        if (dl < L.r) {
          ex.x = L.x + ((ex.x - L.x) / dl) * L.r;
          ex.z = L.z + ((ex.z - L.z) / dl) * L.r;
        }
      }
      ex.heading = Math.atan2(wx, wz);
      ex.phase += dt * speed * 0.09;
      ex.speed = speed;
      c.C.x = ex.x;
      ex.snapT -= dt;
      if (ex.snapT <= 0) {
        ex.snapT = 0.15;
        c.snapFeetToLedge();
      }
    } else if (this.flat) {
      ex.x = c.C.x;
    }
    if (this.flat) ex.z = 0;
  }

  // Can the player click this hold from where they are walking? (They walk to the wall first.)
  canWalkTo(hold) {
    const ex = this.explore;
    if (!ex.active || !ex.ledge) return false;
    const lg = ex.ledge;
    return hold.y < lg.y - 20 && hold.y > lg.y - 165 && hold.x > lg.x1 - 10 && hold.x < lg.x2 + 10 && !hold.ledge;
  }

  walkToHold(hold, choose) {
    if (!this.canWalkTo(hold)) return false;
    this.explore.pending = { hold, choose };
    return true;
  }

  valleyDist(v) {
    const ex = this.explore;
    return this.flat ? Math.abs(v.x - ex.x) : Math.hypot(v.x - ex.x, v.z - ex.z);
  }

  interactTarget() {
    const ex = this.explore;
    if (!ex.active || !ex.ledge || !ex.ledge.ground || this.state !== 'play') return null;
    let best = null;
    let bd = this.flat ? 34 : 60;
    for (const v of this.world.valley) {
      if ((v.kind === 'bush' || v.kind === 'mushroom' || v.kind === 'herbs') && v.picked === this.day) continue;
      if (v.kind === 'flora' && this.journal.flora[v.id]) continue;
      const d = this.valleyDist(v);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  interactLabel(v) {
    switch (v.kind) {
      case 'npc': return 'Talk to Tobi';
      case 'robot': return 'Talk to Kip';
      case 'bush': return 'Pick berries';
      case 'mushroom': return 'Pick mushrooms';
      case 'herbs': return 'Gather herbs';
      case 'water': return 'Fill your flask at the lake';
      case 'flora': return 'Look at the flower';
      default: return 'Interact';
    }
  }

  interact() {
    const v = this.interactTarget();
    if (!v) return false;
    const give = (item, n) => {
      const before = this.inv[item];
      this.inv[item] = Math.min(ITEMS[item].max, before + n);
      this.toast(this.inv[item] > before ? `+${this.inv[item] - before} ${ITEMS[item].name}` : `Your pack can't hold more ${ITEMS[item].name}.`, 'good');
      this.emit('pickup', { item });
    };
    switch (v.kind) {
      case 'npc': this.talk(); break;
      case 'robot': this.talkKip(); break;
      case 'bush': give('berries', 3); v.picked = this.day; break;
      case 'mushroom': give('mushroom', 1); v.picked = this.day; break;
      case 'herbs': give('herbs', 2); v.picked = this.day; break;
      case 'water': this.inv.water = ITEMS.water.max; this.emit('water'); this.toast('Ice-cold lake water. Flask full.', 'good'); break;
      case 'flora': this.discover('flora', v.id); break;
      default: break;
    }
    return true;
  }

  talk() {
    let lines;
    if (!this.talkedTobi) {
      lines = TOBI_LINES.first;
      this.talkedTobi = true;
      this.inv.pitons = Math.min(ITEMS.pitons.max, this.inv.pitons + 2);
      this.inv.bandage = Math.min(ITEMS.bandage.max, this.inv.bandage + 1);
      this.inv.meat = Math.min(ITEMS.meat.max, this.inv.meat + 1);
      this.toast('Tobi gave you 2 pitons, a bandage and dried meat.', 'good');
    } else if (this.journal.cairns[BIVOUACS.length - 1]) {
      lines = TOBI_LINES.summit;
    } else if (Object.keys(this.journal.relics).length > 0 && !this.tobiRelicTalk) {
      lines = TOBI_LINES.relic;
      this.tobiRelicTalk = true;
    } else {
      lines = [TOBI_LINES.idle[Math.floor(this.rand() * TOBI_LINES.idle.length)]];
    }
    this.dialogue = { name: 'Tobi', lines, i: 0 };
    this.emit('dialogue');
  }

  talkKip() {
    const k = this.kipTalks || 0;
    const lines = KIP_LINES[k === 0 ? 0 : 1 + ((k - 1) % (KIP_LINES.length - 1))];
    this.kipTalks = k + 1;
    this.robotCheer = true;
    this.dialogue = { name: 'Kip', lines, i: 0 };
    this.emit('dialogue');
    this.emit('pipGo');
  }

  advanceDialogue() {
    if (!this.dialogue) return;
    this.dialogue.i++;
    if (this.dialogue.i >= this.dialogue.lines.length) this.dialogue = null;
  }

  updateMeadow(dt) {
    const ex = this.explore;
    const onGround = ex.active && ex.ledge && ex.ledge.ground;
    for (const f of this.meadowFauna) {
      f.t += dt;
      const L = VALLEY.lake;
      const tx = L.x + Math.cos(f.t * 0.05) * 330;
      const tz = L.z + Math.sin(f.t * 0.037) * 260 - 40;
      let fx = lerp(f.x, tx, Math.min(1, dt * 0.5));
      let fz = lerp(f.z, tz, Math.min(1, dt * 0.5));
      // shy: move away from the player
      const d = Math.hypot(fx - ex.x, fz - ex.z);
      if (onGround && d < 110 && !this.flat) {
        fx += ((fx - ex.x) / d) * 90 * dt;
        fz += ((fz - ex.z) / d) * 90 * dt;
      }
      f.heading = Math.atan2(fx - f.x, fz - f.z);
      f.moving = Math.hypot(fx - f.x, fz - f.z) > 0.2 * dt;
      f.x = clamp(fx, VALLEY.x0, VALLEY.x1);
      f.z = clamp(fz, 40, VALLEY.z1);
      const near = this.flat ? Math.abs(f.x - ex.x) < 120 : d < 180;
      if (onGround && near && !this.journal.fauna[f.id]) this.discover('fauna', f.id);
    }
  }

  // Scanner: collectibles Pip can sense nearby.
  scanNearby(radius = 280) {
    const c = this.climber;
    const out = [];
    this.world.pickups.forEach((p, i) => {
      if (this.taken.has(i)) return;
      if ((p.kind === 'flora' || p.kind === 'relic' || p.stash) && dist(p.x, p.y, c.C.x, c.C.y) < radius) out.push(p);
    });
    return out;
  }

  journalProgress() {
    const f = Object.keys(this.journal.flora).length;
    const a = Object.keys(this.journal.fauna).length;
    const r = Object.keys(this.journal.relics).length;
    const k = Object.keys(this.journal.cairns).length;
    const total = FLORA.length + FAUNA.length + RELICS.length + BIVOUACS.length;
    return { flora: f, fauna: a, relics: r, cairns: k, pct: Math.round(((f + a + r + k) / total) * 100) };
  }

  summitProgress() {
    return clamp((-this.climber.C.y - BODY.standHeight) / WORLD_HEIGHT, 0, 1);
  }
}

export { SAVE_KEY };
