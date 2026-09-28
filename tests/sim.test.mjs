// Headless simulation tests: world generation invariants and a bot climbing to the summit.
// Minimal localStorage shim so saving can be tested in Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
import { Game } from '../src/game.js';
import { AutoClimber } from '../src/autoclimb.js';
import { WORLD_HEIGHT, BIVOUACS } from '../src/config.js';

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}

function climb(seed, opts = {}, maxMinutes = 90) {
  const game = new Game({ seed, survival: false, hazards: false, ...opts });
  const bot = new AutoClimber(game, { camp: !!opts.camp, pitons: !!opts.pitons });
  const dt = 1 / 30;
  let t = 0;
  let lastProgress = 0;
  let bestY = 0;
  const bivReached = new Set();
  while (t < maxMinutes * 60) {
    const input = bot.update(dt);
    game.update(dt, input);
    game.events.length = 0;
    t += dt;
    const c = game.climber;
    if (c.C.y < bestY - 1) {
      bestY = c.C.y;
      lastProgress = t;
    }
    const lg = c.standingLedge();
    if (lg && lg.bivouac !== undefined) bivReached.add(lg.bivouac);
    if (game.state === 'summit') break;
    if (game.state === 'dead') break;
    if (t - lastProgress > 120) break; // stuck
  }
  return { game, t, bestY, bivReached, stats: game.stats };
}

console.log('World generation');
for (const seed of [1, 7, 42]) {
  const g = new Game({ seed });
  const w = g.world;
  check(w.route.length > 150, `seed ${seed}: route has ${w.route.length} holds`);
  let maxGap = 0;
  for (let i = 1; i < w.route.length; i++) {
    const a = w.route[i - 1];
    const b = w.route[i];
    if (w.ledges.some((l) => l.bivouac !== undefined && a.y > l.y && b.y < l.y)) continue;
    maxGap = Math.max(maxGap, Math.hypot(a.x - b.x, a.y - b.y));
  }
  check(maxGap < 100, `seed ${seed}: max route gap ${maxGap.toFixed(1)} < 100 (zig-zag between hands)`);
  check(w.ledges.filter((l) => l.bivouac !== undefined).length === BIVOUACS.length, `seed ${seed}: all bivouacs placed`);
  check(w.pickups.filter((p) => p.kind === 'flora').length >= 5, `seed ${seed}: flora placed`);
  check(w.holds.every((h) => Number.isFinite(h.x) && Number.isFinite(h.y)), `seed ${seed}: holds finite`);
}

console.log('Climber basics');
{
  const g = new Game({ seed: 7, survival: false, hazards: false });
  const c = g.climber;
  check(c.standing, 'starts standing on the ground');
  const h = g.world.holdsNear(c.C.x, c.C.y - 60, 60).filter((x) => !x.ledge && c.canPlace(c.limbs[0], x).ok).sort((a, b) => a.y - b.y)[0];
  check(!!h && h.y < c.C.y - 20, 'a hold above is reachable from the start');
  const lh = c.limbs[0];
  const r = c.place(lh, h);
  check(r.ok, `can reach first hold (${r.reason || 'ok'})`);
  for (let i = 0; i < 30; i++) g.update(1 / 30, {});
  check(lh.state === 'grip', 'left hand gripping after move');
  // With one hand on the wall and feet on the ground, lifting that hand is fine (standing).
  check(c.lift(lh), 'can let go when standing on the ground');
  // A foot cannot be placed above the torso.
  const high = g.world.holdsNear(c.C.x, c.C.y - 40, 40).find((x) => x.y < c.C.y - 20);
  if (high) check(!c.canPlace(c.limbs[2], high).ok, 'foot cannot go above the torso');
}

console.log('Rope, pitons, camp and saving');
{
  // Climb until the bot has placed a piton, then let go: the rope must catch the fall.
  const g = new Game({ seed: 7, survival: false, hazards: false });
  const bot = new AutoClimber(g, { pitons: true });
  let t = 0;
  while (t < 300 && !(g.placedPitons.length && g.climber.C.y < g.placedPitons[g.placedPitons.length - 1].y - 60)) {
    g.update(1 / 30, bot.update(1 / 30));
    t += 1 / 30;
  }
  check(g.placedPitons.length > 0, `bot hammered a piton (${g.placedPitons.length})`);
  const piton = g.anchors[g.anchors.length - 1];
  g.climber.startFall('test');
  for (let i = 0; i < 120; i++) g.update(1 / 30, {});
  const c = g.climber;
  const below = c.C.y - piton.y;
  check(c.state === 'rope' || c.state === 'climb' || g.anchors[g.anchors.length - 1] !== piton, `fall caught (state ${c.state}, ${Math.round(below)} below anchor)`);
  check(g.vitals.health > 0, `survived the lead fall (health ${Math.round(g.vitals.health)})`);
}
{
  const g = new Game({ seed: 7, survival: false, hazards: false });
  const bot = new AutoClimber(g, { camp: true });
  let t = 0;
  while (t < 300 && g.lastBivouac < 0) {
    g.update(1 / 30, bot.update(1 / 30));
    t += 1 / 30;
  }
  check(g.lastBivouac === 0, 'reached and camped at the first bivouac');
  g.inv.berries = 5;
  g.save();
  const loaded = Game.load({ survival: false, hazards: false });
  check(!!loaded && loaded.lastBivouac === 0, 'save loads back at the bivouac');
  check(loaded.inv.berries === 5, 'inventory restored from save');
  check(loaded.climber.standing, 'loaded climber stands on the bivouac ledge');
  // Eating needs three points of contact or a ledge.
  check(loaded.use('berries') && loaded.inv.berries === 4, 'can eat while standing on a ledge');
  // Death from a long unprotected fall.
  const d = new Game({ seed: 7, survival: false, hazards: false });
  d.climber.C.y = -900;
  d.climber.C.x = 640; // clear of any ledge on the way down
  d.climber.anchor = null;
  d.climber.startFall('test');
  for (let i = 0; i < 200 && d.state !== 'dead'; i++) d.update(1 / 30, {});
  check(d.state === 'dead', 'a 100 m unroped fall is fatal');
}

console.log('Climbing onto a ledge (regression: pressing W while a hand is still moving)');
{
  const g = new Game({ seed: 7, survival: false, hazards: false });
  const bot = new AutoClimber(g, {});
  const c = g.climber;
  let caught = false;
  for (let k = 0; k < 30 * 120 && !caught; k++) {
    const moving = c.limbs.find((l) => l.hand && l.state === 'moving' && l.move.hold.ledge && l.move.hold.ledge.bivouac === 0);
    if (moving) caught = true;
    else g.update(1 / 30, bot.update(1 / 30));
  }
  check(caught, 'a hand is on its way to the first bivouac lip');
  check(!c.startMantle(), 'cannot mantle while the hand is still moving');
  for (let i = 0; i < 30 && c.limbs.some((l) => l.state === 'moving'); i++) g.update(1 / 30, {});
  check(!!c.mantleLedge() && c.startMantle(), 'can mantle once the hand grips the lip');
  for (let i = 0; i < 60; i++) g.update(1 / 30, {});
  check(Number.isFinite(c.C.x) && Number.isFinite(c.C.y), 'position stays valid after the mantle');
  check(!!c.standingLedge() && c.standingLedge().bivouac === 0, 'standing on the bivouac after climbing onto it');
  // safety net: an invalid position is recovered instead of freezing the game
  c.C.x = NaN;
  g.update(1 / 30, {});
  check(Number.isFinite(c.C.x) && Number.isFinite(c.C.y), 'an invalid position is recovered');
}

console.log('Walking in the valley');
{
  const g = new Game({ seed: 7, survival: false, hazards: false });
  const step = (secs, input) => { for (let i = 0; i < secs * 30; i++) g.update(1 / 30, input); };
  step(0.1, {});
  check(g.explore.active, 'explore mode is active when standing at the base');
  step(2, { walk: { x: 0, z: 1 } });
  check(g.explore.z > 150, `walking away from the wall (z=${Math.round(g.explore.z)})`);
  // walk to Tobi and talk
  const T = g.world.valley.find((v) => v.kind === 'npc');
  for (let i = 0; i < 600 && Math.hypot(g.explore.x - T.x, g.explore.z - T.z) > 30; i++) {
    const dx = T.x - g.explore.x;
    const dz = T.z - g.explore.z;
    const d = Math.hypot(dx, dz);
    g.update(1 / 30, { walk: { x: dx / d, z: dz / d } });
  }
  const tgt = g.interactTarget();
  check(tgt && tgt.kind === 'npc', 'Tobi is the interaction target when standing next to him');
  const pitons = g.inv.pitons;
  g.interact();
  check(!!g.dialogue && g.dialogue.name === 'Tobi', 'talking opens a dialogue');
  check(g.inv.pitons === pitons + 2, 'Tobi gives you pitons the first time');
  while (g.dialogue) g.advanceDialogue();
  // berries grow back each day
  const bush = g.world.valley.find((v) => v.kind === 'bush');
  g.explore.x = bush.x;
  g.explore.z = bush.z;
  g.climber.C.x = bush.x;
  const berries = g.inv.berries;
  check(g.interactTarget() === bush && g.interact() && g.inv.berries > berries, 'picking berries from a bush');
  check(g.interactTarget() !== bush, 'a picked bush is empty until tomorrow');
  g.day++;
  check(g.interactTarget() === bush, 'berries grow back the next day');
  // click a hold from far away: walk back to the wall, then climb
  g.explore.x = 0;
  g.climber.C.x = 0;
  g.climber.snapFeetToLedge();
  g.explore.z = 300;
  const hold = g.world.holdsNear(0, -110, 60).find((h) => !h.ledge && g.canWalkTo(h));
  check(!!hold && g.walkToHold(hold), 'a wall hold can be targeted while walking in the valley');
  step(6, {});
  check(g.climber.handsAttached().length + g.climber.feetAttached().filter((f) => !f.hold.ledge).length > 0 && g.explore.z < 5, `walked back to the wall and grabbed the hold (z=${Math.round(g.explore.z)})`);
  // 2D (flat) mode: the valley depth is ignored
  const f = new Game({ seed: 7, survival: false, hazards: false });
  f.flat = true;
  const b2 = f.world.valley.find((v) => v.kind === 'bush');
  for (let i = 0; i < 900 && Math.abs(f.climber.C.x - b2.x) > 10; i++) f.update(1 / 30, { move: { x: Math.sign(b2.x - f.climber.C.x), y: 0 } });
  check(f.interactTarget() === b2, `2D: walking along the ground reaches the bush (x=${Math.round(f.climber.C.x)})`);
}

console.log('Bot climbs to the summit (no hazards)');
for (const seed of [7, 1, 42]) {
  const r = climb(seed);
  const alt = Math.round(-r.bestY);
  check(r.game.state === 'summit', `seed ${seed}: summit reached in ${(r.t / 60).toFixed(1)} min sim, falls ${r.stats.falls}, height ${alt}/${WORLD_HEIGHT}`);
}

console.log('Bot with survival + hazards + camping (informational)');
{
  const r = climb(7, { survival: true, hazards: true, camp: true, pitons: true }, 120);
  console.log(`  info seed 7: state=${r.game.state} height=${Math.round(-r.bestY)} falls=${r.stats.falls} pitons=${r.stats.pitons} time=${(r.t / 60).toFixed(1)}min health=${r.game.vitals.health.toFixed(0)} bivouacs=${[...r.bivReached].join(',')}`);
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
