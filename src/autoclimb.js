// A simple AI that climbs using the same moves a player has. Used for tests and the title-screen demo.
import { dist } from './rng.js';

export class AutoClimber {
  constructor(game, opts = {}) {
    this.game = game;
    this.opts = { camp: false, ...opts };
    this.cool = 0;
    this.lastLimb = null;
    this.stuck = 0;
    this.resting = false;
    this.walkDir = 0;
    this.log = [];
  }

  bestMove(allowSideways = false) {
    const g = this.game;
    const c = g.climber;
    const w = g.world;
    const handsY = c.limbs.filter((l) => l.hand).map((l) => l.end.y);
    const feetY = c.limbs.filter((l) => !l.hand).map((l) => l.end.y);
    const feetLow = Math.min(...feetY) - Math.max(...handsY);
    let best = null;
    for (const l of c.limbs) {
      if (l.state === 'moving') return null;
      const r = c.root(l);
      const cands = w.holdsNear(r.x, r.y, l.reach + 45);
      for (const h of cands) {
        if (h.ledge && h.ledge.side) continue;
        if (h.loose) continue;
        if (l.state === 'grip' && h === l.hold) continue;
        const gain = (l.state === 'grip' ? l.hold.y : Math.max(l.end.y, c.C.y + (l.hand ? 20 : 60))) - h.y;
        if (!allowSideways && gain < 8) continue;
        if (!l.hand && h.y < c.C.y + 5) continue;
        const rx = w.routeX(h.y);
        let score = gain + h.q * (l.hand ? 14 : 6) - Math.abs(h.x - rx) * 0.3;
        if (h.ledge && l.hand) score += 25;
        if (l.state !== 'grip') score += 60;
        if (l === this.lastLimb) score -= 18;
        if (!l.hand) score += feetLow > 110 ? 35 : -10;
        if (l.hand && gain > 60) score -= (gain - 60) * 0.5;
        if (best && score <= best.score) continue;
        const chk = c.canPlace(l, h);
        if (!chk.ok) continue;
        best = { limb: l, hold: h, score };
      }
    }
    return best;
  }

  update(dt) {
    const g = this.game;
    const c = g.climber;
    const input = { move: { x: 0, y: 0 } };
    this.cool -= dt;
    if (g.state === 'camp') {
      if (this.cool > 0) return input;
      this.cool = 0.4;
      if (g.pip.mode === 'fetch') return input;
      if (!this.campDone) {
        this.campDone = true;
        const v = g.vitals;
        for (const r of ['stew', 'porridge', 'tea']) while (g.canCook(r)) g.cook(r);
        g.refillWater();
        const eatOrder = ['stew', 'porridge', 'meat', 'berries', 'mushroom', 'tea', 'herbs'];
        for (const it of eatOrder) {
          while (g.inv[it] > 0 && v.satiety < 75 && it !== 'tea' && it !== 'herbs') g.use(it);
        }
        while (g.inv.water > 2 && v.hydration < 80) g.use('water');
        g.refillWater();
        if (v.health < 60 && g.inv.bandage > 0) g.use('bandage');
        g.buildCairn();
        if (g.isNight() || g.time > 18 || v.health < 70) g.sleep();
        if (g.sendPip()) return input;
      }
      this.campDone = false;
      g.leaveCamp();
      return input;
    }
    if (g.state !== 'play') return input;
    if (g.hammer) {
      if (Math.abs(g.hammer.marker - 0.5) < 0.08) g.hammerStrike();
      return input;
    }
    if (this.cool > 0) return input;
    if (c.limbs.some((l) => l.state === 'moving') || c.state === 'mantle' || c.state === 'fall') return input;

    const lg = c.standingLedge();
    if (lg && lg.bivouac !== undefined && !lg.camped) {
      if (lg.summit || this.opts.camp) {
        g.openCamp();
        this.cool = 0.5;
        return input;
      }
      lg.camped = true;
    }
    if (lg && lg.summit) {
      g.openCamp();
      return input;
    }

    if (c.state === 'climb' && c.mantleLedge()) {
      c.startMantle();
      this.cool = 0.2;
      return input;
    }

    // Pitons on cracks when available (for demo realism).
    const lastA = g.anchors[g.anchors.length - 1];
    if (this.opts.pitons && g.pitonCandidate() && g.inv.pitons > 0 && c.attached().length >= 3 && lastA.y - c.C.y > 160) {
      g.startHammer();
      return input;
    }

    // Eat and drink when it is safe.
    if (g.canEat() && c.state === 'climb') {
      const v = g.vitals;
      if (v.hydration < 35 && g.inv.water > 0) g.use('water');
      else if (v.satiety < 35) {
        for (const it of ['meat', 'porridge', 'stew', 'berries', 'mushroom']) if (g.inv[it] > 0) { g.use(it); break; }
      } else if (v.warmth < 30 && g.inv.tea > 0) g.use('tea');
      else if (v.health < 40 && g.inv.bandage > 0) g.use('bandage');
    }

    // Rest when tired and resting helps.
    if (lg && c.stamina < c.staminaMax * 0.6) this.resting = true;
    if (c.state === 'climb' && lg && this.resting) {
      if (c.stamina > c.staminaMax * 0.95) this.resting = false;
      else return input;
    }
    if (c.state === 'climb' && !lg) {
      if (c.stamina < 30 && c.chalkTime <= 0 && g.inv.chalk > 0 && c.staminaRate < 0) g.chalkUp();
      if (c.stamina < 50 && c.staminaRate > 1) this.resting = true;
      if (this.resting) {
        if (c.stamina > c.staminaMax * 0.9 || c.staminaRate < 0.6) this.resting = false;
        else return input;
      }
    }

    let mv = this.bestMove(false);
    if (!mv) mv = this.bestMove(true);
    if (mv) {
      c.place(mv.limb, mv.hold);
      this.lastLimb = mv.limb;
      this.stuck = 0;
      this.cool = 0.05;
      return input;
    }

    this.stuck++;
    if (c.state === 'rope') {
      input.move.y = -1;
      return input;
    }
    if (lg) {
      // Walk toward the route above.
      const rx = g.world.routeX(lg.y - 90);
      input.move.x = Math.sign(rx - c.C.x) || (this.stuck % 60 < 30 ? 1 : -1);
      return input;
    }
    // Shift weight around to find a new option.
    const phase = Math.floor(this.stuck / 20) % 4;
    input.move.x = phase === 0 ? 1 : phase === 2 ? -1 : 0;
    input.move.y = phase === 1 ? -1 : phase === 3 ? 1 : 0;
    // Free a badly placed foot occasionally.
    if (this.stuck % 45 === 44) {
      const feet = c.limbs.filter((l) => !l.hand && l.state === 'grip');
      if (feet.length) {
        const f = feet.reduce((a, b) => (a.hold.y > b.hold.y ? a : b));
        c.lift(f);
      }
    }
    return input;
  }
}

export function distToSummit(game) {
  const c = game.climber;
  return dist(c.C.x, c.C.y, 0, -9000);
}
