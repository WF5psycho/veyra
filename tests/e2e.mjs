// Browser test: loads the game in headless Chromium, plays it with the bot, and captures screenshots.
// Usage: node tests/e2e.mjs [url]   (defaults to a local static server on port 8123)
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = process.env.SHOTS || path.join(root, 'tests', 'shots');
mkdirSync(outDir, { recursive: true });

let server;
let url = process.argv[2];
if (!url) {
  server = spawn('npx', ['http-server', root, '-p', '8123', '-c-1', '-s'], { stdio: 'ignore' });
  url = 'http://127.0.0.1:8123/index.html';
  await new Promise((r) => setTimeout(r, 1500));
}

const errors = [];
let failures = 0;
const check = (c, m) => {
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`);
  if (!c) failures++;
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.g|ERR_CERT|net::/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__veyra, null, { timeout: 10000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/01-title.png` });
  check(await page.isVisible('text=VEYRA'), 'title screen visible');

  await page.click('text=New climb');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${outDir}/02-start.png` });
  check(await page.isVisible('#hud'), 'HUD visible after starting');
  check(await page.evaluate(() => !!(window.__veyra.active3d && window.__veyra.renderer3d)), '3D view is the default');

  // Walk around the valley (3D): hold S to walk away from the wall.
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyS');
  const walkedZ = await page.evaluate(() => window.__veyra.game.explore.z);
  check(walkedZ > 15, `walking with WASD in the valley (z=${Math.round(walkedZ)})`);
  // Go to Tobi and talk with E.
  await page.evaluate(() => {
    const g = window.__veyra.game;
    const T = g.world.valley.find((v) => v.kind === 'npc');
    g.explore.x = T.x + 25;
    g.explore.z = T.z + 25;
    g.climber.C.x = g.explore.x;
    g.climber.snapFeetToLedge();
    window.__veyra.renderer3d.camInit = false;
  });
  await page.waitForTimeout(2500);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/02b-tobi.png` });
  check(await page.isVisible('#dialogue'), 'talking to Tobi shows a dialogue');
  for (let i = 0; i < 3; i++) await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  check(!(await page.isVisible('#dialogue')), 'dialogue closes after the last line');
  await page.evaluate(() => {
    const g = window.__veyra.game;
    g.explore.x = 0;
    g.explore.z = 0;
    g.climber.C.x = 0;
    g.climber.snapFeetToLedge();
    window.__veyra.renderer3d.camInit = false; // snap the camera instead of gliding
  });
  await page.waitForTimeout(2500);

  // Player-style interaction: click a hold above the climber.
  const clicked = await page.evaluate(() => {
    const app = window.__veyra;
    const g = app.game;
    const c = g.climber;
    const h = g.world.holdsNear(c.C.x, c.C.y - 60, 60).find((x) => !x.ledge && c.canPlace(c.limbs[1], x).ok);
    const s = app.active3d ? app.renderer3d.toScreen(h.x, h.y, 2) : app.renderer.toScreen(h.x, h.y);
    return { x: s.x, y: s.y };
  });
  await page.mouse.move(clicked.x, clicked.y);
  await page.waitForTimeout(400);
  check(await page.evaluate(() => !!(window.__veyra.controls.hoverHold && window.__veyra.controls.hoverOk)), 'hovering a reachable hold highlights it');
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => window.__veyra.game.climber.handsAttached().length >= 1, null, { timeout: 8000 }).catch(() => {});
  const gripping = await page.evaluate(() => window.__veyra.game.climber.handsAttached().length);
  check(gripping >= 1, 'clicking a hold makes a hand grab it');
  await page.screenshot({ path: `${outDir}/03-first-grab.png` });

  // Let the bot climb in-page for a while (fast-forwarded).
  await page.evaluate(async () => {
    const app = window.__veyra;
    const { AutoClimber } = app;
    app.bot = new AutoClimber(app.game, { pitons: true, camp: false });
    app.fastForward = (secs) => {
      const g = app.game;
      const dt = 1 / 30;
      for (let i = 0; i < secs * 30; i++) {
        g.update(dt, app.bot.update(dt));
        app.flushEvents();
        if (g.state !== 'play') break;
      }
      app.renderer.cam.x = g.climber.C.x;
      app.renderer.cam.y = g.climber.C.y - 30;
    };
  });
  await page.evaluate(() => window.__veyra.fastForward(20));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/04-climbing.png` });
  const y1 = await page.evaluate(() => window.__veyra.game.climber.C.y);
  check(y1 < -300, `bot climbed in browser (y=${Math.round(y1)})`);

  // Fast-forward to the first real bivouac and open camp.
  await page.evaluate(() => {
    const app = window.__veyra;
    app.bot.opts.camp = true;
    app.fastForward(120);
  });
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => window.__veyra.game.state);
  if (st === 'camp') {
    await page.evaluate(() => window.__veyra.ui.open('camp', window.__veyra.game));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/05-camp.png` });
    check(await page.isVisible('text=Break camp'), 'camp menu opens at a bivouac');
    await page.click('text=Break camp');
  } else {
    console.log(`  info game state after fast-forward: ${st}`);
  }

  // Journal & inventory screens.
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/06-journal.png` });
  check(await page.isVisible("text=Climber's Journal"), 'journal opens with J');
  await page.keyboard.press('KeyJ');
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/07-pack.png` });
  check(await page.isVisible('text=Backpack'), 'backpack opens with I');
  await page.keyboard.press('KeyI');

  // Night and higher zones.
  await page.evaluate(() => {
    const app = window.__veyra;
    app.game.time = 22.5;
    app.bot.opts.camp = false;
    app.fastForward(90);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/08-night.png` });
  // 3D view toggle (V) mid-climb, day and night.
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${outDir}/10-view3d-night.png` });
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/10b-view2d-night.png` });
  check(await page.evaluate(() => !window.__veyra.active3d), 'V switches to the 2D view');
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(1500);
  check(await page.evaluate(() => !!window.__veyra.active3d), 'V switches back to 3D');
  await page.evaluate(() => { window.__veyra.game.time = 11; window.__veyra.fastForward(60); });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${outDir}/11-view3d-day.png` });
  const pick = await page.evaluate(() => {
    const app = window.__veyra;
    const c = app.game.climber;
    const s = app.renderer3d.toScreen(c.C.x, c.C.y);
    const w = app.renderer3d.toWorld(s.x, s.y);
    return Math.hypot(w.x - c.C.x, w.y - c.C.y);
  });
  check(pick < 12, `3D picking maps screen back to the wall (error ${pick.toFixed(1)})`);
  await page.evaluate(() => {
    const app = window.__veyra;
    app.game.time = 12;
    app.fastForward(400);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/09-high.png` });
  const alt = await page.evaluate(() => window.__veyra.game.altitude());
  console.log(`  info altitude reached: ${alt} m`);

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
} finally {
  await browser.close();
  if (server) server.kill();
}
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log('e2e passed');
