// The climber: four limbs on a rock plane, position-based body solve, stamina, falls and rope.
import { BODY } from './config.js';
import { clamp, dist, lerp } from './rng.js';

const LIMB_DEFS = [
  { id: 'lh', hand: true, side: -1, name: 'Left hand' },
  { id: 'rh', hand: true, side: 1, name: 'Right hand' },
  { id: 'lf', hand: false, side: -1, name: 'Left foot' },
  { id: 'rf', hand: false, side: 1, name: 'Right foot' },
];

const GRAVITY = 1500;

function ease(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class Climber {
  constructor(world, x = 0, groundY = 0) {
    this.world = world;
    this.diff = world.diff || { drain: 1, regen: 1 };
    this.C = { x, y: groundY - BODY.standHeight };
    this.vel = { x: 0, y: 0 };
    this.state = 'climb'; // climb | mantle | fall | rope | dead
    this.stamina = 100;
    this.staminaMax = 100;
    this.chalkTime = 0;
    this.bias = { x: 0, y: 0 };
    this.external = { x: 0, y: 0 };
    this.overhang = 0;
    this.wind = 0;
    this.events = [];
    this.anchor = null; // {x,y}
    this.ropeLen = 0;
    this.fallStartY = 0;
    this.shake = 0;
    this.effort = 0;
    this.staminaRate = 0;
    this.time = 0;
    this.drag = null;
    this.mantle = null;
    this.limbs = LIMB_DEFS.map((d) => {
      const [l1, l2] = d.hand ? BODY.arm : BODY.leg;
      return {
        ...d, l1, l2, reach: (l1 + l2) * 0.98,
        end: { x: 0, y: 0 }, hold: null, state: 'free', move: null,
      };
    });
    for (const l of this.limbs) {
      const r = this.root(l);
      l.end = this.restPos(l, r);
    }
    this.snapFeetToLedge();
  }

  // ---- geometry -------------------------------------------------------------
  rootOffset(l) {
    return l.hand
      ? { x: l.side * BODY.shoulderX, y: BODY.shoulderY }
      : { x: l.side * BODY.hipX, y: BODY.hipY };
  }

  root(l, C = this.C) {
    const o = this.rootOffset(l);
    return { x: C.x + o.x, y: C.y + o.y };
  }

  restPos(l, r) {
    if (l.hand) return { x: r.x + l.side * 8, y: r.y + l.reach * 0.78 };
    return { x: r.x + l.side * 4, y: r.y + l.reach * 0.92 };
  }

  attached() {
    return this.limbs.filter((l) => l.state === 'grip');
  }

  handsAttached() {
    return this.limbs.filter((l) => l.hand && l.state === 'grip');
  }

  feetAttached() {
    return this.limbs.filter((l) => !l.hand && l.state === 'grip');
  }

  limbHold(l) {
    return l.state === 'grip' ? l.hold : l.state === 'moving' ? l.move.hold : null;
  }

  // Standing: no hands on the wall and both feet on the same ledge.
  standingLedge() {
    if (this.state !== 'climb') return null;
    for (const l of this.limbs) if (l.hand && (l.state === 'grip' || l.state === 'moving')) return null;
    const f1 = this.limbHold(this.limbs[2]);
    const f2 = this.limbHold(this.limbs[3]);
    if (!f1 || !f2 || !f1.ledge || f1.ledge !== f2.ledge) return null;
    if (this.C.y > f1.ledge.y - 40) return null;
    return f1.ledge;
  }

  get standing() {
    return !!this.standingLedge();
  }

  snapFeetToLedge() {
    const lg = this.world.ledgeAt(this.C.x, this.C.y + BODY.standHeight, 8);
    if (!lg) return;
    for (const l of this.limbs.slice(2)) {
      const h = this.nearestLedgeHold(lg, this.C.x + l.side * 9);
      if (h) {
        l.hold = h;
        l.state = 'grip';
        l.end = { x: h.x, y: h.y };
        l.move = null;
      }
    }
    for (const l of this.limbs.slice(0, 2)) {
      l.state = 'free';
      l.hold = null;
      l.move = null;
    }
  }

  nearestLedgeHold(ledge, x) {
    let best = null;
    let bd = Infinity;
    for (const h of this.world.holdsNear(x, ledge.y, 40)) {
      if (h.ledge !== ledge) continue;
      const d = Math.abs(h.x - x);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  // ---- body solver ------------------------------------------------------------
  constraintsFor(excludeLimb) {
    const cs = [];
    for (const l of this.limbs) {
      if (l === excludeLimb || l.state !== 'grip') continue;
      const o = this.rootOffset(l);
      cs.push({ ox: o.x, oy: o.y, px: l.hold.x, py: l.hold.y, r: l.reach, limb: l });
    }
    return cs;
  }

  ledgePlanes(C) {
    const planes = [];
    for (const lg of this.world.ledges) {
      if (C.x < lg.x1 - 16 || C.x > lg.x2 + 16) continue;
      if (C.y > lg.y + 20 && C.y < lg.y + 200) planes.push({ lg, min: lg.y + 28 });
      else if (C.y < lg.y - 50 && C.y > lg.y - 260) planes.push({ lg, max: lg.y - BODY.standHeight + 12 });
    }
    return planes;
  }

  project(C, cs, planes, iters = 40) {
    let x = C.x;
    let y = C.y;
    for (let it = 0; it < iters; it++) {
      let moved = 0;
      for (const c of cs) {
        const rx = x + c.ox - c.px;
        const ry = y + c.oy - c.py;
        const d = Math.hypot(rx, ry);
        if (d > c.r) {
          const k = (d - c.r) / d;
          x -= rx * k;
          y -= ry * k;
          moved += d - c.r;
        }
      }
      for (const p of planes) {
        if (x < p.lg.x1 - 16 || x > p.lg.x2 + 16) continue;
        if (p.min !== undefined && y < p.min) { moved += p.min - y; y = p.min; }
        if (p.max !== undefined && y > p.max) { moved += y - p.max; y = p.max; }
      }
      if (y > -40) { moved += y + 40; y = -40; }
      if (moved < 0.01) break;
    }
    let worst = 0;
    let worstC = null;
    for (const c of cs) {
      const v = Math.hypot(x + c.ox - c.px, y + c.oy - c.py) - c.r;
      if (v > worst) {
        worst = v;
        worstC = c;
      }
    }
    return { x, y, violation: worst, worst: worstC };
  }

  comfortTarget(extra) {
    const hands = [];
    const feet = [];
    for (const l of this.limbs) {
      if (l.state === 'grip') (l.hand ? hands : feet).push(l.hold);
    }
    if (extra) (extra.limb.hand ? hands : feet).push(extra.hold);
    if (!hands.length && !feet.length) return { x: this.C.x, y: this.C.y };
    const mean = (arr, k) => arr.reduce((s, h) => s + h[k], 0) / arr.length;
    let x;
    let y;
    if (hands.length && feet.length) {
      x = (mean(hands, 'x') + mean(feet, 'x')) / 2;
      const yh = mean(hands, 'y') - BODY.shoulderY + BODY.arm[0] * 1.45;
      const yf = mean(feet, 'y') - BODY.hipY - BODY.leg[0] * 1.55;
      y = (yh + yf) / 2;
    } else if (hands.length) {
      x = mean(hands, 'x');
      y = mean(hands, 'y') - BODY.shoulderY + (BODY.arm[0] + BODY.arm[1]) * 0.85;
    } else {
      x = mean(feet, 'x');
      y = mean(feet, 'y') - BODY.standHeight;
    }
    return { x, y };
  }

  // Can `limb` be placed on `hold`? Returns the body position that makes it work.
  canPlace(limb, hold) {
    if (this.state === 'fall' || this.state === 'mantle' || this.state === 'dead') return { ok: false, reason: 'busy' };
    if (limb.state === 'moving') return { ok: false, reason: 'busy' };
    if (!hold || hold.removed) return { ok: false, reason: 'nohold' };
    if (limb.state === 'grip' && limb.hold === hold) return { ok: false, reason: 'same' };
    let occ = 0;
    for (const l of this.limbs) if (l !== limb && this.limbHold(l) === hold) occ++;
    if (occ >= 2) return { ok: false, reason: 'occupied' };

    // Support check: lifting this limb must not leave us with nothing to hold on to.
    const others = this.limbs.filter((l) => l !== limb && l.state === 'grip');
    const otherHands = others.filter((l) => l.hand).length;
    const standing = this.standing;
    const onRope = this.state === 'rope';
    if (limb.state === 'grip' && !onRope) {
      if (limb.hand && otherHands === 0) {
        // Only allowed if the feet would stand on a ledge, or this hand goes to a ledge top.
        const feetOnLedge = others.filter((l) => !l.hand && l.hold.ledge).length === 2;
        if (!feetOnLedge) return { ok: false, reason: 'support' };
      }
      if (!limb.hand && otherHands === 0 && !standing) return { ok: false, reason: 'support' };
    }
    // Standing on a ledge with no hand on the rock: a foot may only shuffle along the ledge.
    if (!limb.hand && otherHands === 0 && standing && !hold.ledge) return { ok: false, reason: 'support' };
    if (!limb.hand && otherHands === 0 && !standing && !onRope && limb.state !== 'grip') {
      // placing a foot while hanging from nothing: fine only if a foot already stands on a ledge
      const footOnLedge = others.some((l) => !l.hand && l.hold.ledge);
      if (!footOnLedge) return { ok: false, reason: 'support' };
    }

    const cs = onRope ? [] : this.constraintsFor(limb);
    const o = this.rootOffset(limb);
    cs.push({ ox: o.x, oy: o.y, px: hold.x, py: hold.y, r: limb.reach * 0.97, limb });
    const comfort = this.comfortTarget({ limb, hold });
    const start = {
      x: lerp(this.C.x, comfort.x, 0.55),
      y: lerp(this.C.y, comfort.y, 0.55),
    };
    const planes = this.ledgePlanes(this.C);
    let res = this.project(start, cs, planes);
    if (res.violation > 1.5) {
      res = this.project({ x: this.C.x, y: this.C.y }, cs, planes, 80);
      if (res.violation > 1.5) return { ok: false, reason: 'reach' };
    }
    if (onRope && dist(res.x, res.y, this.C.x, this.C.y) > 6) return { ok: false, reason: 'reach' };
    if (limb.hand && hold.y > res.y + 48) return { ok: false, reason: 'low' };
    if (!limb.hand && hold.y < res.y - 6) return { ok: false, reason: 'high' };
    // Hands and feet should not cross wildly.
    const partner = this.limbs.find((l) => l.hand === limb.hand && l !== limb);
    const ph = this.limbHold(partner);
    if (ph && (hold.x - ph.x) * limb.side < -42) return { ok: false, reason: 'cross' };
    return { ok: true, C: { x: res.x, y: res.y } };
  }

  // Pick which limb should reach for a hold when the player just clicks it:
  // hands for holds above the chest, feet below the hips, and in between whichever limb gains the most height.
  chooseLimb(hold, selected) {
    if (selected) return selected;
    let best = null;
    let bestScore = -Infinity;
    const rel = hold.y - this.C.y;
    for (const l of this.limbs) {
      if (l.hold === hold || l.state === 'moving') continue;
      if (!this.canPlace(l, hold).ok) continue;
      let score = (l.end.y - hold.y) - Math.hypot(l.end.x - hold.x, l.end.y - hold.y) * 0.3;
      if (l.hand) score += rel < -20 ? 60 : rel > 20 ? -60 : 0;
      else score += rel > 20 ? 60 : rel < -20 ? -60 : 0;
      if (l.state === 'free') score += 40;
      if ((hold.x - this.C.x) * l.side > 0) score += 10;
      if (score > bestScore) {
        bestScore = score;
        best = l;
      }
    }
    if (best) return best;
    // Nothing fits: return the natural limb so the player gets a useful "why not" message.
    const [lh, rh, lf, rf] = this.limbs;
    const left = hold.x < this.C.x;
    if (rel < 18) return left ? lh : rh;
    return left ? lf : rf;
  }

  place(limb, hold) {
    const chk = this.canPlace(limb, hold);
    if (!chk.ok) {
      this.events.push({ type: 'reject', reason: chk.reason, limb: limb.id });
      return chk;
    }
    if (this.state === 'rope') this.vel = { x: 0, y: 0 };
    const d = dist(limb.end.x, limb.end.y, hold.x, hold.y);
    const wasStanding = this.standing;
    limb.state = 'moving';
    limb.hold = null;
    limb.move = {
      from: { ...limb.end }, hold, t: 0,
      dur: clamp(0.16 + d / 380, 0.18, 0.55),
      C0: { ...this.C }, C1: chk.C,
      walk: wasStanding && !limb.hand,
    };
    this.bias.x *= 0.3;
    this.bias.y *= 0.3;
    return chk;
  }

  lift(limb) {
    if (limb.state !== 'grip') return true;
    const others = this.limbs.filter((l) => l !== limb && l.state === 'grip');
    const hands = others.filter((l) => l.hand).length;
    const feetOnLedge = others.filter((l) => !l.hand && l.hold.ledge).length === 2;
    if (this.state !== 'rope' && hands === 0 && !feetOnLedge) {
      this.events.push({ type: 'reject', reason: 'support', limb: limb.id });
      return false;
    }
    limb.state = 'free';
    limb.hold = null;
    return true;
  }

  // ---- dragging ------------------------------------------------------------------
  beginDrag(limb) {
    if (this.state !== 'climb' && this.state !== 'rope') return false;
    if (limb.state === 'moving') return false;
    if (limb.state === 'grip' && !this.lift(limb)) return false;
    this.drag = { limb, target: { ...limb.end } };
    return true;
  }

  dragTo(x, y) {
    if (this.drag) this.drag.target = { x, y };
  }

  endDrag() {
    if (!this.drag) return null;
    const limb = this.drag.limb;
    this.drag = null;
    const h = this.world.nearestHold(limb.end.x, limb.end.y, 22);
    if (h) return this.place(limb, h);
    return { ok: false, reason: 'nohold' };
  }

  // ---- mantle -------------------------------------------------------------------------
  mantleLedge() {
    if (this.state !== 'climb') return null;
    // Only once a hand really holds the lip (not while a limb is still travelling).
    if (this.limbs.some((l) => l.state === 'moving')) return null;
    const hands = this.limbs.filter((l) => l.hand && l.state === 'grip' && l.hold.ledge && !l.hold.ledge.ground);
    if (!hands.length) return null;
    const lg = hands[0].hold.ledge;
    if (this.C.y < lg.y) return null;
    return lg;
  }

  startMantle() {
    const lg = this.mantleLedge();
    if (!lg) return false;
    const hx = [this.limbs[0], this.limbs[1]].filter((l) => l.state === 'grip' && l.hold.ledge === lg).map((l) => l.hold.x);
    const mean = hx.length ? hx.reduce((s, v) => s + v, 0) / hx.length : this.C.x;
    const tx = clamp(Number.isFinite(mean) ? mean : (lg.x1 + lg.x2) / 2, lg.x1 + 16, lg.x2 - 16);
    this.state = 'mantle';
    this.drag = null;
    this.mantle = { lg, t: 0, dur: 1.1, C0: { ...this.C }, C1: { x: tx, y: lg.y - BODY.standHeight } };
    for (const l of this.limbs) {
      if (!l.hand || l.state === 'moving') { l.state = 'free'; l.hold = null; l.move = null; }
    }
    this.stamina = Math.max(0, this.stamina - 6);
    this.events.push({ type: 'mantle' });
    return true;
  }

  // ---- falling ------------------------------------------------------------------------------
  startFall(reason) {
    if (this.state === 'fall' || this.state === 'dead') return;
    this.state = 'fall';
    this.drag = null;
    this.mantle = null;
    this.fallStartY = this.C.y;
    this.vel = { x: (Math.random() - 0.5) * 30, y: 0 };
    this.caught = false;
    if (this.anchor) this.ropeLen = dist(this.C.x, this.C.y, this.anchor.x, this.anchor.y) + 18;
    for (const l of this.limbs) {
      l.state = 'free';
      l.hold = null;
      l.move = null;
    }
    this.events.push({ type: 'fall', reason });
  }

  setAnchor(a) {
    this.anchor = a ? { x: a.x, y: a.y } : null;
  }

  // ---- update -----------------------------------------------------------------------------
  update(dt, input) {
    this.time += dt;
    if (this.state === 'dead') return;
    this.guardPosition();
    if (this.chalkTime > 0) this.chalkTime -= dt;
    switch (this.state) {
      case 'climb': this.updateClimb(dt, input); break;
      case 'mantle': this.updateMantle(dt); break;
      case 'fall': this.updateFall(dt); break;
      case 'rope': this.updateRope(dt, input); break;
      default: break;
    }
    this.updateFreeLimbs(dt);
  }

  // Safety net: never let an invalid number break the climber for good.
  guardPosition() {
    const ok = Number.isFinite(this.C.x) && Number.isFinite(this.C.y) && Number.isFinite(this.vel.x) && Number.isFinite(this.vel.y);
    if (ok) {
      this.lastGood = { x: this.C.x, y: this.C.y };
      return;
    }
    const g = this.lastGood || { x: 0, y: -BODY.standHeight };
    this.C = { ...g };
    this.vel = { x: 0, y: 0 };
    this.mantle = null;
    this.drag = null;
    this.state = 'climb';
    for (const l of this.limbs) {
      if (l.state === 'moving' || !Number.isFinite(l.end.x) || !Number.isFinite(l.end.y)) {
        l.state = 'free';
        l.hold = null;
        l.move = null;
        l.end = this.restPos(l, this.root(l));
      }
    }
    if (!this.limbs.some((l) => l.state === 'grip')) this.snapFeetToLedge();
    this.events.push({ type: 'recovered' });
  }

  updateMantle(dt) {
    const m = this.mantle;
    m.t += dt / m.dur;
    const t = Math.min(1, m.t);
    // Pull up first, then step over.
    const up = ease(Math.min(1, t * 1.4));
    const over = ease(clamp((t - 0.3) / 0.7, 0, 1));
    this.C.x = lerp(m.C0.x, m.C1.x, over);
    this.C.y = lerp(m.C0.y, m.C1.y, up);
    for (const l of this.limbs.slice(2)) {
      const r = this.root(l);
      l.end = { x: r.x + l.side * 6, y: Math.min(r.y + l.reach * 0.6, m.lg.y + 2) };
    }
    if (m.t >= 1) {
      this.state = 'climb';
      this.C = { ...m.C1 };
      this.mantle = null;
      this.snapFeetToLedge();
      this.events.push({ type: 'stand', ledge: m.lg });
    }
  }

  updateClimb(dt, input) {
    const move = input.move || { x: 0, y: 0 };
    const standingLg = this.standingLedge();

    const moving = this.advanceMoves(dt, standingLg);

    // Free-limb dragging pulls the body.
    if (this.drag) {
      const l = this.drag.limb;
      const r = this.root(l);
      const tx = this.drag.target.x;
      const ty = this.drag.target.y;
      const d = dist(r.x, r.y, tx, ty);
      if (d > l.reach) {
        const ex = (tx - r.x) * (1 - l.reach / d);
        const ey = (ty - r.y) * (1 - l.reach / d);
        this.bias.x += ex * Math.min(1, dt * 3);
        this.bias.y += ey * Math.min(1, dt * 3);
      }
    }

    if (!moving) {
      if (standingLg) {
        // Walk along the ledge.
        if (move.x) {
          this.C.x = clamp(this.C.x + move.x * 75 * dt, standingLg.x1 + 12, standingLg.x2 - 12);
          for (const f of this.limbs.slice(2)) {
            const want = this.C.x + f.side * 9 + move.x * 10;
            if (Math.abs(f.end.x - want) > 15 && !this.limbs.some((o) => o.state === 'moving')) {
              const h = this.nearestLedgeHold(standingLg, want);
              if (h && h !== f.hold) {
                const other = this.limbs.find((o) => !o.hand && o !== f);
                if (other.hold !== h) this.place(f, h);
              }
              break;
            }
          }
        }
        this.C.y = lerp(this.C.y, standingLg.y - BODY.standHeight, Math.min(1, dt * 6));
        this.bias.x = 0;
        this.bias.y = 0;
      } else {
        this.bias.x = clamp(this.bias.x + move.x * 90 * dt, -60, 60);
        this.bias.y = clamp(this.bias.y + move.y * 90 * dt, -60, 60);
        const comfort = this.comfortTarget();
        const want = { x: comfort.x + this.bias.x, y: comfort.y + this.bias.y };
        const k = Math.min(1, dt * 2.6);
        let nx = lerp(this.C.x, want.x, k) + this.external.x * dt;
        let ny = lerp(this.C.y, want.y, k) + this.external.y * dt;
        const cs = this.constraintsFor(null);
        const res = this.project({ x: nx, y: ny }, cs, this.ledgePlanes(this.C));
        if (res.violation > 2 && res.worst) {
          // Something must give: the most over-stretched limb slips.
          const l = res.worst.limb;
          l.state = 'free';
          l.hold = null;
          this.events.push({ type: 'slip', limb: l.id });
        } else {
          // Pull the bias back to what is actually achievable.
          this.bias.x += (res.x - nx) * 0.5;
          this.bias.y += (res.y - ny) * 0.5;
          this.C.x = res.x;
          this.C.y = res.y;
        }
      }
    }

    // Loose holds under load.
    for (const l of this.limbs) {
      if (l.state === 'grip' && l.hold.loose && l.hand) {
        l.hold.stress = (l.hold.stress || 0) + dt;
        if (l.hold.stress > 2.3 && !l.hold.removed) {
          this.world.removeHold(l.hold);
          this.events.push({ type: 'crumble', hold: l.hold });
          for (const o of this.limbs) {
            if (o.hold === l.hold) {
              o.state = 'free';
              o.hold = null;
            }
          }
        }
      }
    }

    this.updateStamina(dt);
    this.checkSupport();
  }

  advanceMoves(dt, standingLg) {
    let moving = null;
    for (const l of this.limbs) {
      if (l.state !== 'moving') continue;
      moving = l;
      const m = l.move;
      m.t += dt / m.dur;
      const t = Math.min(1, m.t);
      const e = ease(t);
      const bump = Math.sin(Math.PI * t) * (l.hand ? 10 : 6);
      l.end = {
        x: lerp(m.from.x, m.hold.x, e) + l.side * bump * 0.5,
        y: lerp(m.from.y, m.hold.y, e) - bump * (m.walk ? 0.8 : 0.3),
      };
      if (this.state === 'climb' && (!m.walk || !standingLg)) {
        this.C.x = lerp(m.C0.x, m.C1.x, e);
        this.C.y = lerp(m.C0.y, m.C1.y, e);
      }
      if (m.t >= 1) {
        if (m.hold.removed) {
          l.state = 'free';
          l.move = null;
          this.events.push({ type: 'slip', limb: l.id });
        } else {
          l.state = 'grip';
          l.hold = m.hold;
          l.end = { x: m.hold.x, y: m.hold.y };
          l.move = null;
          if (!m.walk) this.stamina = Math.max(0, this.stamina - (l.hand ? 0.9 : 0.4));
          this.events.push({ type: 'grip', limb: l.id, hand: l.hand, holdType: m.hold.type, hold: m.hold });
          if (this.state === 'rope') {
            this.state = 'climb';
            this.vel = { x: 0, y: 0 };
            this.events.push({ type: 'offRope' });
          }
        }
      }
    }
    return moving;
  }

  checkSupport() {
    if (this.state !== 'climb') return;
    if (this.standingLedge()) return;
    const hands = this.handsAttached().length;
    const handsMoving = this.limbs.some((l) => l.hand && l.state === 'moving');
    if (hands > 0) return;
    if (this.drag && this.drag.limb.hand) {
      // still ok if feet are on a ledge
    }
    const feet = this.limbs.slice(2).map((l) => this.limbHold(l));
    const feetOnLedge = feet.every((h) => h && h.ledge);
    if (feetOnLedge && (handsMoving || this.drag || this.C.y < feet[0].ledge.y - 30)) return;
    if (handsMoving && feet.filter(Boolean).length === 2 && feet.some((h) => h.ledge)) return;
    this.startFall('lost grip');
  }

  holdQuality(h) {
    let q = h.q;
    if (this.chalkTime > 0 && h.type !== 'ice' && h.type !== 'ledge') q *= 1.28;
    if (h.wet) q *= 0.8;
    return q;
  }

  computeEffort() {
    if (this.standingLedge()) return 0;
    const hands = this.handsAttached();
    const feet = this.feetAttached();
    if (!hands.length) return feet.length ? 0.2 : 3;
    let footShare = 0;
    for (const f of feet) {
      if (f.hold.ledge) {
        footShare += 0.42;
      } else if (f.hold.y > this.C.y + 8) {
        const centred = Math.abs(f.hold.x - this.C.x) < 45 ? 1 : 0.6;
        footShare += 0.3 * Math.min(1, f.hold.q) * centred;
      }
    }
    const onLedge = feet.some((f) => f.hold.ledge);
    if (!onLedge) footShare *= 1 - this.overhang;
    let load = Math.max(0.15, 1 - footShare);
    if (this.wind > 0 && this.attached().length < 4) load *= 1 + this.wind * 0.35;
    let qSum = 0;
    let bend = 0;
    for (const h of hands) {
      qSum += this.holdQuality(h.hold);
      const r = this.root(h);
      const ext = dist(r.x, r.y, h.hold.x, h.hold.y) / h.reach;
      bend += 1 + Math.max(0, 0.7 - ext) * 0.7;
    }
    bend /= hands.length;
    return (load * bend) / Math.max(0.3, qSum);
  }

  updateStamina(dt) {
    const E = this.computeEffort();
    this.effort = E;
    let rate;
    if (this.standingLedge()) rate = 9;
    else if (E < 0.45) rate = 22 * (0.45 - E) * this.diff.regen;
    else rate = -11 * (E - 0.45) * this.diff.drain;
    this.staminaRate = rate;
    this.stamina = clamp(this.stamina + rate * dt, 0, this.staminaMax);
    this.shake = clamp((32 - this.stamina) / 32, 0, 1);
    if (this.stamina <= 0 && rate < 0) {
      // Hands give out.
      for (const l of this.limbs) {
        if (l.hand && l.state === 'grip') {
          l.state = 'free';
          l.hold = null;
        }
      }
      this.events.push({ type: 'exhausted' });
    }
  }

  landingCheck(prevY) {
    const feetPrev = prevY + BODY.standHeight;
    const feetNow = this.C.y + BODY.standHeight;
    for (const lg of this.world.ledges) {
      if (this.C.x < lg.x1 - 6 || this.C.x > lg.x2 + 6) continue;
      if (feetPrev <= lg.y + 2 && feetNow >= lg.y) {
        const fallDist = Math.max(0, this.C.y - this.fallStartY);
        const speed = this.vel.y;
        this.C.y = lg.y - BODY.standHeight;
        this.C.x = clamp(this.C.x, lg.x1 + 12, lg.x2 - 12);
        this.vel = { x: 0, y: 0 };
        this.state = 'climb';
        this.snapFeetToLedge();
        this.events.push({ type: 'land', dist: fallDist, speed, ledge: lg });
        return true;
      }
    }
    return false;
  }

  ropeConstraint() {
    if (!this.anchor) return false;
    const dx = this.C.x - this.anchor.x;
    const dy = this.C.y - this.anchor.y;
    const d = Math.hypot(dx, dy);
    if (d <= this.ropeLen) return false;
    const nx = dx / d;
    const ny = dy / d;
    this.C.x = this.anchor.x + nx * this.ropeLen;
    this.C.y = this.anchor.y + ny * this.ropeLen;
    const vr = this.vel.x * nx + this.vel.y * ny;
    if (vr > 0) {
      this.vel.x -= vr * nx * 1.15;
      this.vel.y -= vr * ny * 1.15;
    }
    return vr;
  }

  updateFall(dt) {
    const prevY = this.C.y;
    this.vel.y += GRAVITY * dt;
    this.vel.x *= 1 - 0.3 * dt;
    this.C.x += this.vel.x * dt;
    this.C.y += this.vel.y * dt;
    if (this.landingCheck(prevY)) return;
    const vr = this.ropeConstraint();
    if (vr !== false && !this.caught) {
      this.caught = true;
      this.events.push({ type: 'ropeCatch', dist: this.C.y - this.fallStartY, impact: vr });
    }
    if (this.caught && this.state === 'fall') {
      this.state = 'rope';
    }
  }

  updateRope(dt, input) {
    if (this.advanceMoves(dt, null)) {
      this.vel = { x: 0, y: 0 };
      return;
    }
    if (this.state !== 'rope') return;
    const move = input.move || { x: 0, y: 0 };
    const prevY = this.C.y;
    this.vel.y += GRAVITY * dt;
    this.vel.x += move.x * 260 * dt;
    if (move.y < 0) {
      this.ropeLen = Math.max(30, this.ropeLen - 45 * dt);
      this.stamina = Math.max(0, this.stamina - 5 * dt);
    } else if (move.y > 0) {
      this.ropeLen += 70 * dt;
    } else {
      this.stamina = Math.min(this.staminaMax, this.stamina + 2 * dt);
    }
    const damp = 1 - 0.9 * dt;
    this.vel.x *= damp;
    this.vel.y *= damp;
    this.C.x += this.vel.x * dt;
    this.C.y += this.vel.y * dt;
    if (this.landingCheck(prevY)) return;
    this.ropeConstraint();
    const hw = this.world.halfWidth(this.C.y);
    this.C.x = clamp(this.C.x, -hw - 40, hw + 40);
    this.shake = clamp((32 - this.stamina) / 32, 0, 1);
  }

  updateFreeLimbs(dt) {
    const k = Math.min(1, dt * 12);
    for (const l of this.limbs) {
      if (l.state === 'grip') {
        l.end = { x: l.hold.x, y: l.hold.y };
        continue;
      }
      if (l.state === 'moving') continue;
      const r = this.root(l);
      let target;
      if (this.drag && this.drag.limb === l) {
        target = this.drag.target;
      } else if (this.state === 'fall') {
        const t = this.time * 9 + (l.hand ? 0 : 2) + l.side;
        target = {
          x: r.x + l.side * (l.reach * 0.7) + Math.sin(t) * 10,
          y: r.y + (l.hand ? -l.reach * 0.6 : l.reach * 0.6) + Math.cos(t) * 10,
        };
      } else if (this.state === 'rope' && l.hand && this.anchor) {
        const dx = this.anchor.x - this.C.x;
        const dy = this.anchor.y - this.C.y;
        const d = Math.hypot(dx, dy) || 1;
        target = { x: this.C.x + (dx / d) * 30 + l.side * 3, y: this.C.y + (dy / d) * 30 };
      } else {
        target = this.restPos(l, r);
      }
      // Clamp to reach.
      const dx = target.x - r.x;
      const dy = target.y - r.y;
      const d = Math.hypot(dx, dy);
      if (d > l.reach) {
        target = { x: r.x + (dx / d) * l.reach, y: r.y + (dy / d) * l.reach };
      }
      const kk = this.drag && this.drag.limb === l ? Math.min(1, dt * 20) : k;
      l.end = { x: lerp(l.end.x, target.x, kk), y: lerp(l.end.y, target.y, kk) };
    }
  }
}
