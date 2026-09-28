// Procedural mountain: wall outline, holds, cracks, ledges, pickups, collectibles.
import { mulberry32, noise1, clamp, dist } from './rng.js';
import {
  WORLD_HEIGHT, ZONES, zoneIndexAt, BIVOUACS, HOLD_TYPES, PICKUPS, FLORA, FAUNA, RELICS, VALLEY, DIFFICULTY,
} from './config.js';

const CELL = 80;

export class World {
  constructor(seed = 1, difficulty = 'easy') {
    this.seed = seed;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.easy;
    this.rand = mulberry32(seed);
    this.holds = [];
    this.grid = new Map();
    this.ledges = [];
    this.cracks = [];
    this.pickups = [];
    this.fauna = [];
    this.springs = [];
    this.nextHoldId = 1;
    this.generate();
    this.generateValley();
  }

  // ---- geometry ----------------------------------------------------------
  halfWidth(y) {
    const base = 520 + 150 * (noise1(y * 0.0018, this.seed + 3) - 0.5) * 2;
    // Taper towards the summit ridge.
    const top = -WORLD_HEIGHT;
    const t = clamp((y - top) / 1600, 0, 1); // 0 at summit, 1 far below
    const hw = clamp(base * (0.22 + 0.78 * t), 120, 900);
    // Above the summit ledge the rock closes into a peak.
    const over = top - 20 - y;
    if (over > 0) return Math.max(0, hw * (1 - over / 70));
    return hw;
  }

  routeX(y) {
    const n = noise1(y * 0.0011, this.seed + 7) - 0.5;
    const n2 = noise1(y * 0.004, this.seed + 11) - 0.5;
    const hw = this.halfWidth(y);
    const m = this.diff ? this.diff.meander : 1;
    // The line starts right above base camp and wanders off from there.
    const start = clamp((-y - 60) / 500, 0, 1);
    return clamp((n * 360 + n2 * 80) * m * start, -hw + 90, hw - 90);
  }

  insideWall(x, y, margin = 0) {
    return Math.abs(x) < this.halfWidth(y) - margin && y < 20;
  }

  // ---- spatial index -----------------------------------------------------
  key(cx, cy) {
    return cx * 100000 + cy;
  }

  addHold(x, y, type, extra = {}) {
    const h = { id: this.nextHoldId++, x, y, type, q: HOLD_TYPES[type].q, r: HOLD_TYPES[type].r, ...extra };
    h.angle = (this.rand() - 0.5) * 0.7;
    h.s = 0.75 + this.rand() * 0.55;
    this.holds.push(h);
    const k = this.key(Math.floor(x / CELL), Math.floor(y / CELL));
    let arr = this.grid.get(k);
    if (!arr) this.grid.set(k, (arr = []));
    arr.push(h);
    return h;
  }

  removeHold(h) {
    h.removed = true;
    const k = this.key(Math.floor(h.x / CELL), Math.floor(h.y / CELL));
    const arr = this.grid.get(k);
    if (arr) {
      const i = arr.indexOf(h);
      if (i >= 0) arr.splice(i, 1);
    }
  }

  holdsNear(x, y, r) {
    const out = [];
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.grid.get(this.key(cx, cy));
        if (!arr) continue;
        for (const h of arr) {
          if (dist(h.x, h.y, x, y) <= r) out.push(h);
        }
      }
    }
    return out;
  }

  nearestHold(x, y, r) {
    let best = null;
    let bd = r;
    for (const h of this.holdsNear(x, y, r)) {
      const d = dist(h.x, h.y, x, y) - h.r * 0.5;
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  ledgeAt(x, y, tol = 6) {
    for (const l of this.ledges) {
      if (x >= l.x1 && x <= l.x2 && Math.abs(y - l.y) <= tol) return l;
    }
    return null;
  }

  // ---- generation ---------------------------------------------------------
  pickType(zone, r) {
    const entries = Object.entries(zone.types);
    let total = 0;
    for (const [, w] of entries) total += w;
    let v = r * total;
    for (const [t, w] of entries) {
      v -= w;
      if (v <= 0) return t;
    }
    return entries[0][0];
  }

  generate() {
    const R = this.rand;

    // Ground: a wide ledge at y = 0.
    this.addLedge(VALLEY.x0, VALLEY.x1, 0, { ground: true, name: 'Base of Veyra' });

    // Bivouac ledges.
    BIVOUACS.forEach((b, i) => {
      const cx = b.summit ? 0 : this.routeX(b.y);
      const w = b.summit ? 110 : 110 + R() * 50;
      this.addLedge(cx - w, cx + w, b.y, { bivouac: i, name: b.name, summit: !!b.summit });
    });

    // Side ledges with stashes, fauna and relics (off-route exploration).
    for (let y = -700; y > -WORLD_HEIGHT + 600; y -= 520 + R() * 380) {
      if (this.ledges.some((l) => Math.abs(l.y - y) < 160)) continue;
      const rx = this.routeX(y);
      const side = R() < 0.5 ? -1 : 1;
      const hw = this.halfWidth(y);
      const cx = clamp(rx + side * (170 + R() * 120), -hw + 90, hw - 90);
      if (Math.abs(cx - rx) < 110) continue;
      const w = 45 + R() * 30;
      this.addLedge(cx - w, cx + w, y, { side: true });
    }

    // Main route: guaranteed climbable line of holds.
    this.route = [];
    let side = 1;
    let y = -32;
    while (y > -WORLD_HEIGHT - 10) {
      const zone = ZONES[zoneIndexAt(y)];
      const lg = this.ledges.find((l) => l.bivouac !== undefined && y <= l.y + 34 && y >= l.y - 34);
      if (lg) {
        // skip to above the ledge
        y = lg.y - 60 - R() * 10;
        if (lg.summit) break;
        continue;
      }
      const rx = this.routeX(y);
      let x = rx + side * (10 + R() * 24);
      // Keep every move on the line within reach, however much the line wanders.
      const prev = this.route.filter((p) => !p.stance).pop();
      if (prev && !this.ledges.some((l) => l.bivouac !== undefined && prev.y > l.y && y < l.y)) {
        const dy = prev.y - y;
        const maxDx = Math.sqrt(Math.max(0, 88 * 88 - dy * dy));
        x = clamp(x, prev.x - maxDx, prev.x + maxDx);
      }
      // Every third route hold is a good rest hold.
      let type;
      const idx = this.route.length;
      const rest = idx % this.diff.restEvery === 0;
      if (rest) type = this.diff.restEvery > 3 || R() < 0.6 ? 'jug' : 'pocket';
      else type = this.pickType(zone, R());
      const h = this.addHold(x, y, type, { route: true });
      this.route.push(h);
      // On harder levels rests are rarer, but always a real stance: a jug with a good foothold below.
      if (rest && this.diff.restEvery > 3) {
        const fx = x - side * 12;
        const fy = y + 78;
        if (!this.holdsNear(fx, fy, 16).length) this.addHold(fx, fy, 'jug', { route: true, stance: true });
      }
      side = -side;
      y -= (zone.step[0] + R() * (zone.step[1] - zone.step[0])) * this.diff.stepMul;
    }

    // Holds under each ledge lip so it can be reached from below, and along it for feet.
    for (const l of this.ledges) {
      for (let x = l.x1 + 6; x <= l.x2 - 6; x += 18) {
        this.addHold(x, l.y, 'ledge', { ledge: l });
      }
    }

    // Cracks: vertical-ish seams along the route; holds on them are piton spots.
    for (let cy = -260; cy > -WORLD_HEIGHT + 200; cy -= 240 + R() * 180) {
      if (this.ledges.some((l) => cy < l.y + 20 && cy > l.y - 60)) continue;
      const len = 120 + R() * 200;
      const x0 = this.routeX(cy) + (R() - 0.5) * 70;
      const pts = [];
      const n = Math.ceil(len / 14);
      let cx = x0;
      for (let i = 0; i <= n; i++) {
        pts.push({ x: cx, y: cy - i * 14 });
        cx += (R() - 0.5) * 9;
      }
      const crack = { pts };
      this.cracks.push(crack);
      for (let i = 2; i < pts.length - 1; i += 3) {
        const p = pts[i];
        if (this.ledges.some((l) => Math.abs(p.y - l.y) < 26 && p.x > l.x1 - 10 && p.x < l.x2 + 10)) continue;
        if (this.holdsNear(p.x, p.y, 14).length) continue;
        this.addHold(p.x, p.y, 'crack', { crack });
      }
    }

    // Filler holds (Poisson-ish rejection sampling).
    for (let zi = 0; zi < ZONES.length; zi++) {
      const z = ZONES[zi];
      const yTop = Math.max(z.y1, -WORLD_HEIGHT);
      const yBot = Math.min(z.y0, -20);
      const area = (yBot - yTop) * 1000;
      const count = Math.floor(area * z.density * 0.42 * this.diff.filler);
      for (let i = 0; i < count; i++) {
        const hy = yTop + R() * (yBot - yTop);
        const hw = this.halfWidth(hy);
        const hx = (R() * 2 - 1) * (hw - 20);
        if (this.holdsNear(hx, hy, 38).length) continue;
        if (this.ledges.some((l) => hx > l.x1 - 14 && hx < l.x2 + 14 && hy > l.y - 12 && hy < l.y + 26)) continue;
        const type = this.pickType(z, R());
        const loose = R() < z.loose * this.diff.loose;
        this.addHold(hx, hy, type, loose ? { loose: true } : {});
      }
    }

    // Springs: wet streaks that refill water.
    for (let sy = -500; sy > -WORLD_HEIGHT + 400; sy -= 900 + R() * 500) {
      const zi = zoneIndexAt(sy);
      if (!PICKUPS.water.weights[zi]) continue;
      const near = this.route.filter((h) => Math.abs(h.y - sy) < 60);
      if (!near.length) continue;
      const h = near[Math.floor(R() * near.length)];
      this.springs.push({ x: h.x + (R() - 0.5) * 20, y: h.y - 10, len: 160 + R() * 120 });
      this.pickups.push({ kind: 'item', item: 'water', amount: 6, x: h.x, y: h.y - 6, spring: true, hold: h, refill: true });
    }

    // Item pickups near the route.
    const itemKeys = Object.keys(PICKUPS).filter((k) => !PICKUPS[k].spring);
    for (let py = -200; py > -WORLD_HEIGHT + 200; py -= 150 + R() * 170) {
      const zi = zoneIndexAt(py);
      let total = 0;
      for (const k of itemKeys) total += PICKUPS[k].weights[zi];
      let v = R() * total;
      let item = itemKeys[0];
      for (const k of itemKeys) {
        v -= PICKUPS[k].weights[zi];
        if (v <= 0) { item = k; break; }
      }
      const cands = this.holds.filter((h) => !h.ledge && Math.abs(h.y - py) < 50 && Math.abs(h.x - this.routeX(py)) < 170);
      if (!cands.length) continue;
      const h = cands[Math.floor(R() * cands.length)];
      const a = PICKUPS[item].amount;
      this.pickups.push({ kind: 'item', item, amount: a[0] + Math.floor(R() * (a[1] - a[0] + 1)), x: h.x + 10, y: h.y - 8, hold: h });
    }

    // Stashes on side ledges.
    const sideLedges = this.ledges.filter((l) => l.side);
    sideLedges.forEach((l, i) => {
      const zi = zoneIndexAt(l.y);
      const stash = [];
      for (const k of itemKeys) if (PICKUPS[k].stash && PICKUPS[k].weights[zi]) stash.push(k);
      const item = stash[i % stash.length] || 'chalk';
      this.pickups.push({ kind: 'item', item, amount: item === 'pitons' ? 2 : 2, x: (l.x1 + l.x2) / 2, y: l.y - 8, ledge: l, stash: true });
      if (item !== 'meat') this.pickups.push({ kind: 'item', item: 'meat', amount: 1, x: (l.x1 + l.x2) / 2 + 16, y: l.y - 8, ledge: l, stash: true });
    });

    // Flora: placed on holds in their zone, slightly off route.
    for (const f of FLORA) {
      if (f.ground) continue;
      const z = ZONES[f.zone];
      const cands = this.holds.filter((h) => !h.ledge && h.y < z.y0 - 100 && h.y > Math.max(z.y1, -WORLD_HEIGHT) + 100 && Math.abs(h.x - this.routeX(h.y)) > 70 && Math.abs(h.x - this.routeX(h.y)) < 200);
      if (!cands.length) continue;
      const h = cands[Math.floor(R() * cands.length)];
      this.pickups.push({ kind: 'flora', id: f.id, x: h.x + 12, y: h.y - 10, hold: h });
    }

    // Relics: on bivouacs and side ledges.
    const relicSpots = [];
    const bivs = this.ledges.filter((l) => l.bivouac !== undefined && !l.summit);
    for (let i = 0; i < RELICS.length; i++) {
      const r = RELICS[i];
      if (r.id === 'r8') {
        const s = this.ledges.find((l) => l.bivouac === BIVOUACS.length - 2);
        relicSpots.push({ r, l: s });
        continue;
      }
      const pool = i % 2 === 0 ? bivs : sideLedges;
      const l = pool[Math.min(pool.length - 1, Math.floor((i / RELICS.length) * pool.length))] || bivs[i % bivs.length];
      relicSpots.push({ r, l });
    }
    for (const { r, l } of relicSpots) {
      if (!l) continue;
      this.pickups.push({ kind: 'relic', id: r.id, x: l.x1 + 22 + R() * 20, y: l.y - 6, ledge: l });
    }

    // Fauna spawn points.
    for (const f of FAUNA) {
      const z = ZONES[f.zone];
      const top = Math.max(z.y1, -WORLD_HEIGHT);
      if (f.kind === 'meadow') continue;
      if (f.kind === 'ledge') {
        const cands = this.ledges.filter((l) => (l.side || l.bivouac !== undefined) && !l.summit && l.y < z.y0 && l.y > top);
        const l = cands[Math.floor(R() * cands.length)];
        if (l) this.fauna.push({ ...f, x: (l.x1 + l.x2) / 2 + (l.x2 - l.x1) * 0.25, y: l.y, home: l });
      } else {
        const fy = (z.y0 + top) / 2;
        this.fauna.push({ ...f, x: this.routeX(fy) + 120, y: fy, range: [top, z.y0] });
      }
    }
  }

  // Things in the valley (x along the wall, z out from it). Uses its own RNG so the wall stays the same.
  generateValley() {
    const R = mulberry32(this.seed * 7 + 999);
    const V = VALLEY;
    this.valley = [];
    const free = (x, z, r) => {
      if (Math.hypot(x - V.lake.x, z - V.lake.z) < V.lake.r + r + 20) return false;
      if (Math.hypot(x - V.camp.x, z - V.camp.z) < 90 + r) return false;
      if (Math.abs(x) < 160 && z < 120) return false;
      return this.valley.every((o) => Math.hypot(o.x - x, o.z - z) > r + 30);
    };
    const place = (kind, n, extra = () => ({})) => {
      for (let i = 0, tries = 0; i < n && tries < 400; tries++) {
        const x = V.x0 + 80 + R() * (V.x1 - V.x0 - 160);
        const z = 60 + R() * (V.z1 - 120);
        if (!free(x, z, 20)) continue;
        this.valley.push({ kind, x, z, picked: -1, ...extra(i) });
        i++;
      }
    };
    place('bush', 7);
    place('mushroom', 4);
    place('herbs', 4);
    place('flora', 2, (i) => ({ id: ['alpenrose', 'arnica'][i] }));
    this.valley.push({ kind: 'water', x: V.lake.x - V.lake.r * 0.8, z: V.lake.z - V.lake.r * 0.4 });
    this.valley.push({ kind: 'npc', x: V.tobi.x, z: V.tobi.z });
    this.meadowFauna = FAUNA.filter((f) => f.kind === 'meadow').map((f) => ({ ...f, x: V.lake.x + 260, z: V.lake.z - 120 }));
  }

  addLedge(x1, x2, y, extra) {
    const l = { x1, x2, y, id: this.ledges.length, ...extra };
    this.ledges.push(l);
    return l;
  }
}
