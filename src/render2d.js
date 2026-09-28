// Canvas 2D renderer: sky, parallax ranges, procedural rock, holds, ledges, climber, Pip, fauna, weather.
import { ZONES, zoneIndexAt, BODY, FLORA, WORLD_HEIGHT, PICKUPS, VALLEY } from './config.js';
import { fbm2, noise1, noise2, clamp, lerp, mulberry32 } from './rng.js';

const CHUNK = 256;

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgb(c, a = 1) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

export function zoneBlend(y) {
  const i = zoneIndexAt(y);
  const z = ZONES[i];
  // blend towards the next zone near its boundary
  const edge = z.y1;
  const d = y - edge; // positive when below the upper edge
  if (i < ZONES.length - 1 && d < 220) {
    const t = 1 - d / 220;
    const n = ZONES[i + 1];
    return {
      rock: mix(z.rock, n.rock, t * 0.5), dark: mix(z.dark, n.dark, t * 0.5), light: mix(z.light, n.light, t * 0.5),
      snow: lerp(z.snow, n.snow, t * 0.5),
    };
  }
  return { rock: z.rock, dark: z.dark, light: z.light, snow: z.snow };
}

export function ik2(ax, ay, bx, by, l1, l2, side) {
  let dx = bx - ax;
  let dy = by - ay;
  let d = Math.hypot(dx, dy);
  const maxD = l1 + l2 - 0.01;
  const minD = Math.abs(l1 - l2) + 0.5;
  if (d > maxD) {
    dx *= maxD / d;
    dy *= maxD / d;
    d = maxD;
  }
  if (d < minD) d = minD;
  const ux = dx / (d || 1);
  const uy = dy / (d || 1);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const px = -uy;
  const py = ux;
  const j1 = { x: ax + ux * a + px * h, y: ay + uy * a + py * h };
  const j2 = { x: ax + ux * a - px * h, y: ay + uy * a - py * h };
  const midx = ax + dx / 2;
  return (j1.x - midx) * side >= (j2.x - midx) * side ? j1 : j2;
}

export class Renderer2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.chunks = new Map();
    this.cam = { x: 0, y: -200, zoom: 1.6 };
    this.zoomMul = 1;
    this.snow = [];
    for (let i = 0; i < 180; i++) this.snow.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 1.5, p: Math.random() * 10 });
    this.stars = [];
    const r = mulberry32(77);
    for (let i = 0; i < 160; i++) this.stars.push({ x: r(), y: r() * 0.7, s: r() * 1.4 + 0.3, tw: r() * 6 });
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.world = null;
  }

  resize(w, h, dpr) {
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.dpr = dpr;
    this.W = w;
    this.H = h;
    this.light.width = Math.floor(w / 2);
    this.light.height = Math.floor(h / 2);
  }

  baseZoom() {
    return clamp(this.H / 470, 1.05, 2.6) * this.zoomMul;
  }

  setWorld(world) {
    if (this.world !== world) {
      this.world = world;
      this.chunks.clear();
      this.ridges = null;
    }
  }

  toWorld(sx, sy) {
    const z = this.cam.zoom;
    return { x: (sx - this.W / 2) / z + this.cam.x, y: (sy - this.H / 2) / z + this.cam.y };
  }

  toScreen(wx, wy) {
    const z = this.cam.zoom;
    return { x: (wx - this.cam.x) * z + this.W / 2, y: (wy - this.cam.y) * z + this.H / 2 };
  }

  updateCamera(game, dt, focus) {
    const c = game.climber;
    const target = focus || { x: c.C.x, y: c.C.y - 30 };
    const k = Math.min(1, dt * (c.state === 'fall' ? 8 : 3));
    this.cam.x = lerp(this.cam.x, target.x, k);
    this.cam.y = lerp(this.cam.y, target.y, k);
    const zt = this.baseZoom() * (c.state === 'fall' ? 0.85 : 1);
    this.cam.zoom = lerp(this.cam.zoom, zt, Math.min(1, dt * 2));
  }

  // ---- rock chunks --------------------------------------------------------------------------
  chunk(cx, cy, budget) {
    const key = cx * 100000 + cy;
    let ch = this.chunks.get(key);
    if (ch) return ch;
    if (budget.n <= 0) return null;
    budget.n--;
    ch = this.buildChunk(cx, cy);
    this.chunks.set(key, ch);
    if (this.chunks.size > 90) {
      const first = this.chunks.keys().next().value;
      this.chunks.delete(first);
    }
    return ch;
  }

  buildChunk(cx, cy) {
    const w = this.world;
    const seed = w.seed;
    const cv = document.createElement('canvas');
    cv.width = CHUNK;
    cv.height = CHUNK;
    const g = cv.getContext('2d');
    const img = g.createImageData(CHUNK, CHUNK);
    const d = img.data;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    for (let py = 0; py < CHUNK; py++) {
      const wy = y0 + py;
      const hw = w.halfWidth(wy);
      const zb = zoneBlend(wy);
      for (let px = 0; px < CHUNK; px++) {
        const wx = x0 + px;
        const i = (py * CHUNK + px) * 4;
        const edge = hw - Math.abs(wx) + (noise2(wx * 0.05, wy * 0.05, seed + 9) - 0.5) * 26;
        if (edge < 0 || wy > 4) {
          d[i + 3] = 0;
          continue;
        }
        const big = fbm2(wx * 0.009, wy * 0.007, seed, 3);
        const det = noise2(wx * 0.09, wy * 0.09, seed + 4);
        const strata = Math.sin(wy * 0.05 + big * 9 + wx * 0.004) * 0.5 + 0.5;
        const facet = noise2(wx * 0.025, wy * 0.018, seed + 13);
        let shade = 0.5 + (big - 0.5) * 1.5 + (det - 0.5) * 0.22 + (strata - 0.5) * 0.12 + (facet - 0.5) * 0.35;
        // light from top-left: brighten where noise gradient faces up
        const gx = noise2((wx + 3) * 0.025, wy * 0.018, seed + 13) - facet;
        const gy = noise2(wx * 0.025, (wy + 3) * 0.018, seed + 13) - facet;
        shade += (-gx - gy) * 3.5;
        shade = clamp(shade, 0, 1);
        let col = shade < 0.5 ? mix(zb.dark, zb.rock, shade * 2) : mix(zb.rock, zb.light, (shade - 0.5) * 2);
        // lichen / moss low down
        if (wy > -2400) {
          const m = noise2(wx * 0.04, wy * 0.04, seed + 21);
          if (m > 0.72) col = mix(col, [110, 130, 70], (m - 0.72) * 2.2 * clamp((wy + 2400) / 1200, 0, 1));
        }
        if (zb.snow > 0) {
          const s = fbm2(wx * 0.02, wy * 0.03, seed + 31, 3) + (-gy) * 2;
          const th = 1 - zb.snow * 0.42;
          if (s > th) col = mix(col, [236, 242, 250], clamp((s - th) * 7, 0, 0.95));
        }
        // dark edges of the buttress
        if (edge < 40) col = mix(col, zb.dark, (1 - edge / 40) * 0.55);
        d[i] = col[0];
        d[i + 1] = col[1];
        d[i + 2] = col[2];
        d[i + 3] = edge < 2 ? 255 * (edge / 2) : 255;
      }
    }
    g.putImageData(img, 0, 0);
    // cracks and seams crossing this chunk
    g.lineCap = 'round';
    for (const cr of w.cracks) {
      const p0 = cr.pts[0];
      const pn = cr.pts[cr.pts.length - 1];
      if (pn.y > y0 + CHUNK + 20 || p0.y < y0 - 20) continue;
      if (Math.min(p0.x, pn.x) > x0 + CHUNK + 30 || Math.max(p0.x, pn.x) < x0 - 30) continue;
      g.strokeStyle = 'rgba(20,16,14,0.85)';
      g.lineWidth = 3;
      g.beginPath();
      cr.pts.forEach((p, i) => (i ? g.lineTo(p.x - x0, p.y - y0) : g.moveTo(p.x - x0, p.y - y0)));
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.15)';
      g.lineWidth = 1;
      g.beginPath();
      cr.pts.forEach((p, i) => (i ? g.lineTo(p.x - x0 + 2, p.y - y0) : g.moveTo(p.x - x0 + 2, p.y - y0)));
      g.stroke();
    }
    // wet streaks from springs
    for (const s of w.springs) {
      if (s.y > y0 + CHUNK || s.y + s.len < y0) continue;
      const grd = g.createLinearGradient(0, s.y - y0, 0, s.y + s.len - y0);
      grd.addColorStop(0, 'rgba(20,30,40,0.55)');
      grd.addColorStop(1, 'rgba(20,30,40,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(s.x - x0, s.y - y0 + s.len / 2, 9, s.len / 2, 0, 0, Math.PI * 2);
      g.fill();
    }
    return cv;
  }

  // ---- sky & background ---------------------------------------------------------------------------
  skyColors(game) {
    const dl = game.daylight();
    const t = game.time;
    const alt = clamp(game.summitProgress(), 0, 1);
    const dayTop = mix([74, 128, 204], [40, 84, 170], alt);
    const dayBot = [200, 222, 238];
    const nightTop = [8, 12, 30];
    const nightBot = [30, 40, 72];
    let top = mix(nightTop, dayTop, dl);
    let bot = mix(nightBot, dayBot, dl);
    const dusk = (t > 17.5 && t < 21) ? 1 - Math.abs(t - 19.3) / 1.8 : (t > 4.5 && t < 8) ? 1 - Math.abs(t - 6.3) / 1.7 : 0;
    if (dusk > 0) bot = mix(bot, [240, 140, 90], clamp(dusk, 0, 1) * 0.8);
    if (dusk > 0) top = mix(top, [90, 70, 130], clamp(dusk, 0, 1) * 0.4);
    return { top, bot, dl, dusk: clamp(dusk, 0, 1) };
  }

  drawSky(game) {
    const ctx = this.ctx;
    const { W, H } = this;
    const sc = this.skyColors(game);
    this.sky = sc;
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, rgb(sc.top));
    grd.addColorStop(1, rgb(sc.bot));
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
    // stars
    if (sc.dl < 0.6) {
      const a = 1 - sc.dl / 0.6;
      for (const s of this.stars) {
        const tw = 0.6 + 0.4 * Math.sin(game.stats.playTime * 2 + s.tw);
        ctx.fillStyle = `rgba(255,255,240,${a * tw})`;
        ctx.fillRect(s.x * W, s.y * H, s.s, s.s);
      }
    }
    // sun / moon arc
    const t = game.time;
    const sunP = (t - 6) / 14; // 0..1 across the day
    if (sunP > -0.1 && sunP < 1.1) {
      const sx = W * (0.1 + 0.8 * sunP);
      const sy = H * (0.75 - Math.sin(clamp(sunP, 0, 1) * Math.PI) * 0.6);
      const g2 = ctx.createRadialGradient(sx, sy, 0, sx, sy, 90);
      g2.addColorStop(0, 'rgba(255,250,220,0.95)');
      g2.addColorStop(0.15, 'rgba(255,240,190,0.7)');
      g2.addColorStop(1, 'rgba(255,220,160,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(sx - 90, sy - 90, 180, 180);
    }
    const moonT = t >= 18 ? t - 18 : t + 6;
    const moonP = moonT / 13;
    if (moonP > 0 && moonP < 1 && sc.dl < 0.8) {
      const mx = W * (0.15 + 0.7 * moonP);
      const my = H * (0.7 - Math.sin(moonP * Math.PI) * 0.55);
      ctx.fillStyle = `rgba(240,240,225,${1 - sc.dl})`;
      ctx.beginPath();
      ctx.arc(mx, my, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(mix([8, 12, 30], sc.top, 0.5), 1 - sc.dl);
      ctx.beginPath();
      ctx.arc(mx + 6, my - 3, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawRanges(game) {
    const ctx = this.ctx;
    const { W, H } = this;
    const sc = this.sky;
    if (!this.ridges) {
      this.ridges = [0, 1, 2].map((i) => {
        const pts = [];
        for (let x = 0; x <= 4000; x += 20) {
          const n = noise1(x * 0.004 + i * 10, 55 + i) * 0.65 + noise1(x * 0.02 + i, 66 + i) * 0.25 + noise1(x * 0.08, 70 + i) * 0.1;
          pts.push(n);
        }
        return pts;
      });
    }
    const layers = [
      { f: 0.03, h: 0.55, amp: 0.35, col: [150, 170, 200] },
      { f: 0.06, h: 0.68, amp: 0.3, col: [110, 128, 160] },
      { f: 0.1, h: 0.8, amp: 0.25, col: [70, 86, 110] },
    ];
    const yShift = (this.cam.y) ;
    layers.forEach((L, i) => {
      const pts = this.ridges[i];
      const base = H * L.h - yShift * L.f * 0.5 * 0.4 + (game.summitProgress() * H * 0.45 * (1 - i * 0.2));
      const col = mix(mix(L.col, sc.bot, 0.35 - i * 0.1), [12, 16, 30], (1 - sc.dl) * 0.8);
      ctx.fillStyle = rgb(col);
      ctx.beginPath();
      ctx.moveTo(0, H);
      const off = (this.cam.x * L.f + 1000) % 20;
      const startIdx = Math.floor((this.cam.x * L.f + 1000) / 20);
      for (let sx = -20; sx <= W + 40; sx += 20) {
        const idx = (startIdx + Math.floor(sx / 20)) % pts.length;
        const v = pts[(idx + pts.length) % pts.length];
        ctx.lineTo(sx - off, base - v * H * L.amp);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      // snow caps on the far ranges
      if (i < 2) {
        ctx.fillStyle = `rgba(255,255,255,${0.35 * sc.dl + 0.08})`;
        ctx.beginPath();
        for (let sx = -20; sx <= W + 40; sx += 20) {
          const idx = (startIdx + Math.floor(sx / 20)) % pts.length;
          const v = pts[(idx + pts.length) % pts.length];
          if (v > 0.62) {
            const y = base - v * H * L.amp;
            ctx.moveTo(sx - off - 10, y + 12);
            ctx.lineTo(sx - off, y);
            ctx.lineTo(sx - off + 10, y + 12);
          }
        }
        ctx.fill();
      }
    });
    // valley haze
    const hz = ctx.createLinearGradient(0, H * 0.6, 0, H);
    hz.addColorStop(0, rgb(sc.bot, 0));
    hz.addColorStop(1, rgb(sc.bot, 0.35));
    ctx.fillStyle = hz;
    ctx.fillRect(0, H * 0.6, W, H * 0.4);
  }

  drawClouds(game, front) {
    const ctx = this.ctx;
    const { W, H } = this;
    const t = game.stats.playTime;
    const sc = this.sky;
    const n = front ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const sp = front ? 18 : 6 + i * 2;
      const par = front ? 1.2 : 0.15 + i * 0.03;
      const wx = ((i * 537 + t * sp - this.cam.x * par) % (W + 600) + W + 600) % (W + 600) - 300;
      const baseY = front ? ((i * 1300 - 400) - this.cam.y) : H * (0.15 + i * 0.09);
      let wy = front ? ((baseY % 2400) + 2400) % 2400 - 600 : baseY - this.cam.y * 0.02;
      if (front) wy = wy * 1;
      const col = mix([255, 255, 255], [40, 50, 80], 1 - sc.dl);
      ctx.fillStyle = rgb(mix(col, [255, 170, 130], sc.dusk * 0.5), front ? 0.28 : 0.55);
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.ellipse(wx + k * 38, wy + Math.sin(k * 2 + i) * 8, 60 + k * 6, 22 + (k % 2) * 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---- world ---------------------------------------------------------------------------------------
  drawRock() {
    const ctx = this.ctx;
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.W, this.H);
    const cx0 = Math.floor(tl.x / CHUNK);
    const cx1 = Math.floor(br.x / CHUNK);
    const cy0 = Math.floor(tl.y / CHUNK);
    const cy1 = Math.floor(Math.min(br.y, 10) / CHUNK);
    const budget = { n: 3 };
    const fallback = zoneBlend(this.cam.y).rock;
    ctx.imageSmoothingEnabled = true;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const wx0 = cx * CHUNK;
        const wy0 = cy * CHUNK;
        const hw = Math.max(this.world.halfWidth(wy0), this.world.halfWidth(wy0 + CHUNK)) + 20;
        if (wx0 > hw || wx0 + CHUNK < -hw) continue;
        const ch = this.chunk(cx, cy, budget);
        if (ch) ctx.drawImage(ch, wx0, wy0, CHUNK + 0.6, CHUNK + 0.6);
        else {
          ctx.fillStyle = rgb(fallback);
          const x0 = Math.max(wx0, -this.world.halfWidth(wy0));
          const x1 = Math.min(wx0 + CHUNK, this.world.halfWidth(wy0));
          if (x1 > x0) ctx.fillRect(x0, wy0, x1 - x0, CHUNK);
        }
      }
    }
  }

  drawGround(game) {
    const ctx = this.ctx;
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.W, this.H);
    if (br.y < -20) return;
    const dl = this.sky.dl;
    const grass = mix([40, 70, 45], [74, 118, 62], dl);
    const dirt = mix([30, 26, 24], [92, 74, 58], dl);
    ctx.fillStyle = rgb(dirt);
    ctx.fillRect(tl.x - 10, 0, br.x - tl.x + 20, Math.max(0, br.y) + 20);
    ctx.fillStyle = rgb(grass);
    ctx.fillRect(tl.x - 10, -3, br.x - tl.x + 20, 10);
    // pines
    const r = mulberry32(5);
    for (let i = 0; i < 60; i++) {
      const x = -1400 + i * 48 + r() * 30;
      if (Math.abs(x) < 260 || Math.abs(x - VALLEY.camp.x) < 90) continue;
      const h = 60 + r() * 90;
      if (x < tl.x - 60 || x > br.x + 60) continue;
      ctx.fillStyle = rgb(mix([18, 38, 30], [38, 72, 52], dl * (0.7 + r() * 0.3)));
      ctx.beginPath();
      ctx.moveTo(x, -h);
      ctx.lineTo(x - h * 0.28, 2);
      ctx.lineTo(x + h * 0.28, 2);
      ctx.fill();
    }
    // base-camp sign
    ctx.fillStyle = '#6b4a2c';
    ctx.fillRect(-120, -34, 4, 34);
    ctx.fillRect(-138, -40, 40, 16);
    ctx.fillStyle = '#f0e6d0';
    ctx.font = '7px sans-serif';
    ctx.fillText('VEYRA', -133, -29);
  }

  // The valley in front of the wall, flattened onto the ground line: camp, Tobi, lake, forage, waterfall.
  drawValley(game) {
    const ctx = this.ctx;
    const t = game.stats.playTime;
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.W, this.H);
    const W = VALLEY.waterfall;
    if (br.y > W.top - 20 && tl.y < 10) {
      const g = ctx.createLinearGradient(W.x - 12, 0, W.x + 12, 0);
      g.addColorStop(0, 'rgba(200,230,250,0.2)');
      g.addColorStop(0.5, 'rgba(235,248,255,0.85)');
      g.addColorStop(1, 'rgba(200,230,250,0.2)');
      ctx.fillStyle = g;
      ctx.fillRect(W.x - 11, W.top, 22, -W.top);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 14; i++) {
        const y = W.top + (((t * 160 + i * 53) % -W.top) + -W.top) % -W.top;
        ctx.fillRect(W.x - 8 + (i * 5) % 16, y, 1.5, 14);
      }
    }
    if (br.y < -30) return;
    const L = VALLEY.lake;
    ctx.fillStyle = 'rgba(60,120,150,0.9)';
    ctx.beginPath();
    ctx.ellipse(L.x, 2, L.r * 0.7, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // camp
    const C = VALLEY.camp;
    ctx.fillStyle = '#d6782a';
    ctx.beginPath();
    ctx.moveTo(C.x - 70, 0);
    ctx.lineTo(C.x - 45, -32);
    ctx.lineTo(C.x - 20, 0);
    ctx.fill();
    const dark = 1 - (this.sky ? this.sky.dl : 1);
    this.drawFire(game, C.x, 0);
    if (dark > 0.2) {
      const g = ctx.createRadialGradient(C.x, -8, 0, C.x, -8, 70);
      g.addColorStop(0, `rgba(255,160,70,${0.35 * dark})`);
      g.addColorStop(1, 'rgba(255,160,70,0)');
      ctx.fillStyle = g;
      ctx.fillRect(C.x - 70, -78, 140, 90);
    }
    // Tobi sitting on a log
    const T = VALLEY.tobi;
    ctx.fillStyle = '#5f4128';
    ctx.fillRect(T.x - 12, -6, 24, 6);
    ctx.fillStyle = '#7a5032';
    ctx.fillRect(T.x - 6, -30, 12, 24);
    ctx.fillStyle = '#d6aa8c';
    ctx.beginPath();
    ctx.arc(T.x, -36, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c8c4bc';
    ctx.beginPath();
    ctx.arc(T.x - 1, -32, 4, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#3c5a46';
    ctx.fillRect(T.x - 9, -44, 18, 3);
    ctx.fillRect(T.x - 6, -48, 12, 5);
    // forage
    for (const v of game.world.valley) {
      if (v.x < tl.x - 30 || v.x > br.x + 30) continue;
      const ripe = v.picked !== game.day;
      ctx.save();
      ctx.translate(v.x, 0);
      if (v.kind === 'bush') {
        ctx.fillStyle = '#3f7a38';
        ctx.beginPath();
        ctx.ellipse(0, -8, 14, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        if (ripe) {
          ctx.fillStyle = '#b0306a';
          for (let i = 0; i < 7; i++) ctx.fillRect(-10 + i * 3.3, -12 + (i % 3) * 3, 2.4, 2.4);
        }
      } else if (v.kind === 'flora') {
        if (!game.journal.flora[v.id]) {
          ctx.translate(0, -4);
          this.drawFlower(v.id === 'arnica' ? 'buttercup' : 'campion', t);
        }
      } else if ((v.kind === 'mushroom' || v.kind === 'herbs') && ripe) {
        this.drawItemIcon(v.kind, t);
      }
      ctx.restore();
    }
    // chamois
    for (const f of game.meadowFauna || []) {
      ctx.save();
      ctx.translate(f.x, 0);
      ctx.fillStyle = '#82603f';
      ctx.fillRect(-12, -26, 24, 10);
      ctx.fillRect(-10, -16, 2.5, 16);
      ctx.fillRect(8, -16, 2.5, 16);
      ctx.fillRect(10, -36, 6, 11);
      ctx.fillStyle = '#2a211b';
      ctx.fillRect(12, -41, 1.5, 6);
      ctx.fillRect(14.5, -41, 1.5, 6);
      ctx.restore();
    }
  }

  drawLedges(game) {
    const ctx = this.ctx;
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.W, this.H);
    for (const l of this.world.ledges) {
      if (l.ground) continue;
      if (l.y < tl.y - 80 || l.y > br.y + 80) continue;
      const zb = zoneBlend(l.y);
      const r = mulberry32(l.id + 3);
      ctx.fillStyle = rgb(zb.dark);
      ctx.beginPath();
      ctx.moveTo(l.x1 - 8, l.y);
      for (let x = l.x1 - 8; x <= l.x2 + 8; x += 10) ctx.lineTo(x, l.y + 10 + r() * 16 * Math.sin(((x - l.x1) / (l.x2 - l.x1 + 16)) * Math.PI));
      ctx.lineTo(l.x2 + 8, l.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgb(zb.light);
      ctx.fillRect(l.x1 - 8, l.y - 3, l.x2 - l.x1 + 16, 5);
      if (zb.snow > 0.2) {
        ctx.fillStyle = 'rgba(240,246,255,0.95)';
        ctx.beginPath();
        ctx.ellipse((l.x1 + l.x2) / 2, l.y - 2, (l.x2 - l.x1) / 2 + 6, 4, 0, Math.PI, 0);
        ctx.fill();
      } else if (l.y > -4000) {
        ctx.strokeStyle = 'rgba(90,130,60,0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let x = l.x1; x < l.x2; x += 5 + r() * 7) {
          ctx.moveTo(x, l.y - 2);
          ctx.lineTo(x + (r() - 0.5) * 4, l.y - 6 - r() * 5);
        }
        ctx.stroke();
      }
      if (l.bivouac !== undefined) this.drawBivouac(game, l);
    }
  }

  drawBivouac(game, l) {
    const ctx = this.ctx;
    const cx = (l.x1 + l.x2) / 2;
    const y = l.y - 2;
    if (l.summit) {
      // summit flag + cairn
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 40, y);
      ctx.lineTo(cx + 40, y - 70);
      ctx.stroke();
      const wave = Math.sin(game.stats.playTime * 4) * 3;
      ctx.fillStyle = '#d6453d';
      ctx.beginPath();
      ctx.moveTo(cx + 40, y - 70);
      ctx.quadraticCurveTo(cx + 55, y - 66 + wave, cx + 70, y - 64);
      ctx.lineTo(cx + 40, y - 54);
      ctx.fill();
      this.drawCairn(cx - 30, y, 7);
      return;
    }
    // bolt
    ctx.strokeStyle = '#c9cfd6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, l.y - 8, 3, 0, Math.PI * 2);
    ctx.stroke();
    // fire ring
    const fx = cx - 40;
    ctx.fillStyle = '#555';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(fx - 10 + i * 4, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    const campOpen = game.state === 'camp' && game.camp && game.camp.ledge === l;
    if (l.camped) {
      // tent
      ctx.fillStyle = '#d9822b';
      ctx.beginPath();
      ctx.moveTo(cx + 30, y);
      ctx.lineTo(cx + 55, y - 26);
      ctx.lineTo(cx + 80, y);
      ctx.fill();
      ctx.fillStyle = '#7a3f10';
      ctx.beginPath();
      ctx.moveTo(cx + 50, y);
      ctx.lineTo(cx + 55, y - 20);
      ctx.lineTo(cx + 60, y);
      ctx.fill();
    }
    if (campOpen) this.drawFire(game, fx, y);
    if (l.cairn) this.drawCairn(cx + 12, y, 5);
  }

  drawFire(game, x, y) {
    const ctx = this.ctx;
    const t = game.stats.playTime;
    for (let i = 0; i < 3; i++) {
      const h = 12 + Math.sin(t * 13 + i * 2) * 4;
      ctx.fillStyle = ['rgba(255,90,20,0.9)', 'rgba(255,170,40,0.9)', 'rgba(255,240,150,0.9)'][i];
      ctx.beginPath();
      ctx.moveTo(x - 7 + i * 2, y);
      ctx.quadraticCurveTo(x + Math.sin(t * 9 + i) * 3, y - h * (1 - i * 0.25) * 2, x + 7 - i * 2, y);
      ctx.fill();
    }
  }

  drawCairn(x, y, n) {
    const ctx = this.ctx;
    let yy = y;
    for (let i = 0; i < n; i++) {
      const w = 12 - i * 1.3;
      const h = 5 - i * 0.3;
      ctx.fillStyle = i % 2 ? '#8d8a84' : '#a39f97';
      ctx.beginPath();
      ctx.ellipse(x + Math.sin(i * 2.3) * 1.5, yy - h, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      yy -= h * 1.7;
    }
  }

  drawHold(h, t, hi) {
    const ctx = this.ctx;
    const zb = zoneBlend(h.y);
    let x = h.x;
    const y = h.y;
    if (h.loose && h.stress > 0.9) x += Math.sin(t * 60) * 1.2;
    const light = h.loose ? mix(zb.light, [170, 110, 80], 0.45) : zb.light;
    const dark = zb.dark;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(h.angle || 0);
    ctx.scale(h.s || 1, h.s || 1);
    switch (h.type) {
      case 'jug':
        ctx.fillStyle = rgb(dark, 0.85);
        ctx.beginPath();
        ctx.ellipse(0, 2.5, 9, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgb(light);
        ctx.beginPath();
        ctx.ellipse(0, -1, 9, 4.2, 0, Math.PI, 0);
        ctx.lineTo(9, 0);
        ctx.fill();
        ctx.fillStyle = 'rgba(10,8,8,0.7)';
        ctx.beginPath();
        ctx.ellipse(0, 2, 6.5, 2.4, 0, 0, Math.PI);
        ctx.fill();
        break;
      case 'crimp':
        ctx.fillStyle = rgb(light);
        ctx.fillRect(-6, -1.6, 12, 2.4);
        ctx.fillStyle = 'rgba(10,8,8,0.7)';
        ctx.fillRect(-5.5, 0.8, 11, 1.6);
        break;
      case 'pocket':
        ctx.fillStyle = rgb(light, 0.9);
        ctx.beginPath();
        ctx.ellipse(0, 0, 6.5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(8,6,6,0.9)';
        ctx.beginPath();
        ctx.ellipse(0, 0.8, 4.2, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'sloper': {
        const g = ctx.createRadialGradient(-2, -3, 1, 0, 0, 11);
        g.addColorStop(0, rgb(light));
        g.addColorStop(1, rgb(dark, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 0, 11, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'crack':
        ctx.fillStyle = 'rgba(5,4,4,0.95)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 2.6, 6.5, 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = rgb(light, 0.7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-3.5, -5);
        ctx.lineTo(-3.5, 5);
        ctx.stroke();
        break;
      case 'ice': {
        const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, 9);
        g.addColorStop(0, 'rgba(235,250,255,0.95)');
        g.addColorStop(1, 'rgba(140,190,230,0.5)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-8, 1);
        ctx.lineTo(-3, -5);
        ctx.lineTo(5, -4);
        ctx.lineTo(8, 2);
        ctx.lineTo(0, 5);
        ctx.fill();
        break;
      }
      default:
        break;
    }
    if (h.loose) {
      ctx.strokeStyle = 'rgba(30,10,5,0.8)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-4, -3);
      ctx.lineTo(0, 0);
      ctx.lineTo(-1, 3);
      ctx.moveTo(0, 0);
      ctx.lineTo(4, -2);
      ctx.stroke();
    }
    if (h.chalked && h.type !== 'ledge') {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(0, -1, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (hi) {
      ctx.strokeStyle = hi;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(8, h.r + 3), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHolds(game, ui) {
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.W, this.H);
    const cx = (tl.x + br.x) / 2;
    const cy = (tl.y + br.y) / 2;
    const r = Math.hypot(br.x - tl.x, br.y - tl.y) / 2 + 20;
    const t = game.stats.playTime;
    const reachSet = ui && ui.reachable ? ui.reachable : null;
    for (const h of this.world.holdsNear(cx, cy, r)) {
      if (h.type === 'ledge') continue;
      let hi = null;
      if (reachSet && reachSet.has(h)) hi = 'rgba(255,255,255,0.35)';
      if (ui && ui.hoverHold === h) hi = ui.hoverOk ? 'rgba(120,255,160,0.95)' : 'rgba(255,110,90,0.9)';
      this.drawHold(h, t, hi);
    }
  }

  drawPickups(game) {
    const ctx = this.ctx;
    const t = game.stats.playTime;
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.W, this.H);
    game.world.pickups.forEach((p, i) => {
      if (game.taken.has(i) && !p.spring) return;
      if (p.y < tl.y - 30 || p.y > br.y + 30 || p.x < tl.x - 30 || p.x > br.x + 30) return;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.kind === 'flora') this.drawFlower(p.id, t);
      else if (p.kind === 'relic') this.drawRelic(t);
      else this.drawItemIcon(p.item, t, p);
      ctx.restore();
    });
    // springs drip
    for (const s of game.world.springs) {
      if (s.y < tl.y - 30 || s.y > br.y + 200) continue;
      for (let k = 0; k < 3; k++) {
        const ph = ((t * 0.8 + k / 3) % 1);
        ctx.fillStyle = `rgba(160,210,255,${0.8 * (1 - ph)})`;
        ctx.beginPath();
        ctx.arc(s.x + Math.sin(k) * 2, s.y + ph * s.len * 0.8, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawFlower(id, t) {
    const ctx = this.ctx;
    const colors = {
      aster: '#9b6bd6', saxifrage: '#c24d9a', jasmine: '#f4f1ea', edelweiss: '#e8ece6',
      campion: '#ea7fae', gentian: '#3a63d8', buttercup: '#f6d23f',
    };
    const sway = Math.sin(t * 2 + id.length) * 0.15;
    ctx.rotate(sway);
    ctx.strokeStyle = '#4c7a34';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(0, -2);
    ctx.stroke();
    ctx.fillStyle = colors[id] || '#fff';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 3.2, -3 + Math.sin(a) * 3.2, 2.4, 1.4, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f7d648';
    ctx.beginPath();
    ctx.arc(0, -3, 1.5, 0, Math.PI * 2);
    ctx.fill();
    this.sparkle(t, 8);
  }

  drawRelic(t) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(0, -3, 0, 0, -3, 14);
    g.addColorStop(0, 'rgba(255,230,150,0.6)');
    g.addColorStop(1, 'rgba(255,230,150,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-14, -17, 28, 28);
    ctx.fillStyle = '#e9dcb8';
    ctx.fillRect(-4, -8, 8, 7);
    ctx.fillStyle = '#9b7b4a';
    ctx.fillRect(-4, -8, 8, 1.4);
    ctx.fillRect(-2, -5, 5, 0.8);
    ctx.fillRect(-2, -3.5, 4, 0.8);
    this.sparkle(t, 11);
  }

  sparkle(t, r) {
    const ctx = this.ctx;
    const a = (Math.sin(t * 3) + 1) / 2;
    ctx.fillStyle = `rgba(255,255,220,${a})`;
    const x = Math.cos(t * 1.3) * r;
    const y = Math.sin(t * 1.7) * r - 4;
    ctx.beginPath();
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x + 0.8, y);
    ctx.lineTo(x, y + 3);
    ctx.lineTo(x - 0.8, y);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x, y + 0.8);
    ctx.lineTo(x + 3, y);
    ctx.lineTo(x, y - 0.8);
    ctx.fill();
  }

  drawItemIcon(item, t, p) {
    const ctx = this.ctx;
    const col = (PICKUPS[item] && PICKUPS[item].color) || '#fff';
    switch (item) {
      case 'berries':
        ctx.fillStyle = '#3d6b2c';
        ctx.beginPath();
        ctx.ellipse(0, -2, 7, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = col;
        for (const [x, y] of [[-3, -2], [0, -4], [3, -2], [1, 0], [-2, 1]]) {
          ctx.beginPath();
          ctx.arc(x, y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'mushroom':
        ctx.fillStyle = '#efe6d2';
        ctx.fillRect(-1.2, -3, 2.4, 5);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(0, -3, 5, 3, 0, Math.PI, 0);
        ctx.fill();
        break;
      case 'herbs':
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 2, 2);
          ctx.quadraticCurveTo(i * 5, -3, i * 3, -7);
          ctx.stroke();
        }
        break;
      case 'water':
        if (p && p.spring) break;
        break;
      default: {
        // stash bag
        ctx.fillStyle = '#6d5236';
        ctx.beginPath();
        ctx.moveTo(-6, 2);
        ctx.lineTo(-5, -6);
        ctx.lineTo(5, -6);
        ctx.lineTo(6, 2);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.fillRect(-3, -4, 6, 3);
        this.sparkle(t, 9);
      }
    }
  }

  drawRope(game) {
    const ctx = this.ctx;
    const c = game.climber;
    const pts = game.anchors.map((a) => ({ x: a.x, y: a.y }));
    const harness = { x: c.C.x, y: c.C.y + 14 };
    pts.push(harness);
    ctx.strokeStyle = '#e0562e';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const taut = (c.state === 'rope' || c.state === 'fall') && i === pts.length - 1;
      const sag = taut ? 0 : Math.min(26, len * 0.12);
      ctx.quadraticCurveTo((a.x + b.x) / 2 + sag * 0.3, (a.y + b.y) / 2 + sag, b.x, b.y);
    }
    ctx.stroke();
    // pitons (placed, including those not in the active chain)
    for (const p of game.placedPitons) {
      if (p.retrieved) continue;
      ctx.fillStyle = '#b5bcc4';
      ctx.fillRect(p.x - 5, p.y - 1, 6, 2);
      ctx.strokeStyle = '#d8dde2';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x + 2, p.y + 2, 2.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawFauna(game) {
    const ctx = this.ctx;
    const t = game.stats.playTime;
    for (const f of game.faunaState) {
      if (!f.visible) continue;
      ctx.save();
      ctx.translate(f.px, f.py);
      const seen = !!game.journal.fauna[f.id];
      switch (f.id) {
        case 'marmot':
        case 'hare': {
          const col = f.id === 'hare' ? '#f1f1ee' : '#8a6a45';
          const up = Math.sin(t * 1.3) > 0.6;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.ellipse(0, -6, 8, up ? 8 : 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(4, up ? -15 : -11, 4, 0, Math.PI * 2);
          ctx.fill();
          if (f.id === 'hare') {
            ctx.fillRect(3, up ? -25 : -21, 1.6, 8);
            ctx.fillRect(5.5, up ? -25 : -21, 1.6, 8);
          }
          ctx.fillStyle = '#111';
          ctx.fillRect(6, up ? -16 : -12, 1.2, 1.2);
          break;
        }
        case 'ibex': {
          ctx.fillStyle = '#7b6650';
          ctx.fillRect(-12, -18, 24, 10);
          ctx.fillRect(-11, -8, 3, 8);
          ctx.fillRect(8, -8, 3, 8);
          ctx.fillRect(10, -25, 7, 9);
          ctx.strokeStyle = '#4a3c2c';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(10, -28, 7, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
          break;
        }
        case 'chough':
        case 'eagle': {
          const s = f.id === 'eagle' ? 2.2 : 1;
          const flap = Math.sin(t * (f.id === 'eagle' ? 3 : 12)) * 5 * s;
          ctx.fillStyle = f.id === 'eagle' ? '#4a3420' : '#111';
          ctx.beginPath();
          ctx.moveTo(-10 * s, flap);
          ctx.quadraticCurveTo(-4 * s, -2 * s, 0, 0);
          ctx.quadraticCurveTo(4 * s, -2 * s, 10 * s, flap);
          ctx.quadraticCurveTo(4 * s, 1 * s, 0, 2 * s);
          ctx.quadraticCurveTo(-4 * s, 1 * s, -10 * s, flap);
          ctx.fill();
          if (f.id === 'chough') {
            ctx.fillStyle = '#f2c300';
            ctx.fillRect(1, -1, 3, 1.2);
          }
          break;
        }
        case 'wallcreeper': {
          const flap = Math.sin(t * 16) * 4;
          ctx.fillStyle = '#9aa0a6';
          ctx.beginPath();
          ctx.ellipse(0, 0, 4, 2.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#d3303b';
          ctx.beginPath();
          ctx.moveTo(-1, 0);
          ctx.lineTo(-7, -3 + flap);
          ctx.lineTo(-2, 2);
          ctx.moveTo(1, 0);
          ctx.lineTo(7, -3 + flap);
          ctx.lineTo(2, 2);
          ctx.fill();
          break;
        }
        default:
          break;
      }
      if (!seen) {
        ctx.strokeStyle = `rgba(255,240,160,${0.5 + 0.4 * Math.sin(t * 4)})`;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, -8, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  drawRocks(game) {
    const ctx = this.ctx;
    for (const r of game.rocks) {
      if (r.warn > 0) continue;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rot);
      ctx.fillStyle = '#5d554d';
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const rr = r.r * (0.75 + ((i * 37) % 10) / 30);
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(-r.r * 0.3, -r.r * 0.3, r.r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawParticles(game) {
    const ctx = this.ctx;
    for (const p of game.particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  limbSegments(c, l) {
    const r = c.root(l);
    const j = ik2(r.x, r.y, l.end.x, l.end.y, l.l1, l.l2, l.side);
    // clamp the end to reach for drawing
    const dx = l.end.x - r.x;
    const dy = l.end.y - r.y;
    const d = Math.hypot(dx, dy);
    const max = l.l1 + l.l2;
    const e = d > max ? { x: r.x + (dx / d) * max, y: r.y + (dy / d) * max } : l.end;
    return { r, j, e };
  }

  drawClimber(game, ui) {
    const ctx = this.ctx;
    const c = game.climber;
    ctx.save();
    if (c.shake > 0 && c.state === 'climb') {
      const s = c.shake * 1.6;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
    const C = c.C;
    const chalk = c.chalkTime > 0;
    const seg = c.limbs.map((l) => this.limbSegments(c, l));
    const line = (a, b, w, col) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // legs
    for (let i = 2; i < 4; i++) {
      const s = seg[i];
      line(s.r, s.j, 8, '#34405a');
      line(s.j, s.e, 7, '#2d3850');
      ctx.fillStyle = '#2a2320';
      ctx.beginPath();
      ctx.ellipse(s.e.x + c.limbs[i].side * 1.5, s.e.y + 1, 5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // torso (back view)
    ctx.fillStyle = '#2f7f86';
    ctx.beginPath();
    ctx.moveTo(C.x - 13, C.y - 22);
    ctx.lineTo(C.x + 13, C.y - 22);
    ctx.lineTo(C.x + 10, C.y + 24);
    ctx.lineTo(C.x - 10, C.y + 24);
    ctx.closePath();
    ctx.fill();
    // harness
    ctx.fillStyle = '#e8b53a';
    ctx.fillRect(C.x - 10, C.y + 14, 20, 3.5);
    // backpack
    ctx.fillStyle = '#b8552e';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(C.x - 10, C.y - 16, 20, 28, 4) : ctx.rect(C.x - 10, C.y - 16, 20, 28);
    ctx.fill();
    ctx.fillStyle = '#8f3e1f';
    ctx.fillRect(C.x - 8, C.y - 2, 16, 3);
    ctx.fillStyle = '#5f7f4e';
    ctx.beginPath();
    ctx.ellipse(C.x, C.y - 18, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // coiled rope on pack
    ctx.strokeStyle = '#e0562e';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(C.x, C.y + 4, 6, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    // arms
    for (let i = 0; i < 2; i++) {
      const s = seg[i];
      line(s.r, s.j, 7, '#2f7f86');
      line(s.j, s.e, 6, '#2a7078');
      ctx.fillStyle = chalk ? '#f3efe6' : '#d9a98a';
      ctx.beginPath();
      ctx.arc(s.e.x, s.e.y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // head (back view): beanie + braid
    const hx = C.x;
    const hy = C.y - 33;
    ctx.fillStyle = '#4a2f22';
    ctx.beginPath();
    ctx.arc(hx, hy, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a2f22';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(hx, hy + 6);
    ctx.quadraticCurveTo(hx + 3, hy + 14, hx + 1, hy + 19);
    ctx.stroke();
    ctx.fillStyle = '#c23b35';
    ctx.beginPath();
    ctx.arc(hx, hy - 1.5, 8.8, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(hx - 9, hy - 2.5, 18, 3);
    ctx.fillStyle = '#f0e6da';
    ctx.beginPath();
    ctx.arc(hx, hy - 10.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    // headlamp glow at night
    if (this.sky && this.sky.dl < 0.5) {
      ctx.fillStyle = 'rgba(255,250,210,0.9)';
      ctx.beginPath();
      ctx.arc(hx, hy - 3, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // interaction overlays
    if (ui && c.state !== 'fall' && game.state === 'play') {
      const sel = ui.limb;
      if (sel) {
        const r = c.root(sel);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.setLineDash([4, 5]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(r.x, r.y, sel.reach, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255,230,120,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sel.end.x, sel.end.y, 7, 0, Math.PI * 2);
        ctx.stroke();
        if (ui.hoverHold) {
          ctx.strokeStyle = ui.hoverOk ? 'rgba(120,255,160,0.6)' : 'rgba(255,110,90,0.5)';
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(sel.end.x, sel.end.y);
          ctx.lineTo(ui.hoverHold.x, ui.hoverHold.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (ui.hoverLimb && ui.hoverLimb !== sel) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ui.hoverLimb.end.x, ui.hoverLimb.end.y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // stamina ring
    if (c.state !== 'dead') {
      const frac = c.stamina / 100;
      const cap = c.staminaMax / 100;
      const show = c.stamina < c.staminaMax - 0.5 || c.staminaRate < 0 || cap < 0.99;
      this.staminaAlpha = lerp(this.staminaAlpha || 0, show ? 1 : 0, 0.08);
      if (this.staminaAlpha > 0.02) {
        const x = C.x + 26;
        const y = C.y - 30;
        ctx.globalAlpha = this.staminaAlpha;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(120,40,40,0.8)';
        ctx.beginPath();
        ctx.arc(x, y, 8, -Math.PI / 2 + cap * Math.PI * 2, Math.PI * 1.5);
        ctx.stroke();
        const col = frac > 0.5 ? '#9be37c' : frac > 0.25 ? '#f3c74a' : '#f0553e';
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, 8, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  drawPip(game) {
    const ctx = this.ctx;
    const p = game.pip;
    const t = game.stats.playTime;
    ctx.save();
    ctx.translate(p.x, p.y);
    // propeller
    ctx.strokeStyle = 'rgba(220,230,240,0.8)';
    ctx.lineWidth = 1.5;
    const w = Math.abs(Math.sin(t * 30)) * 9;
    ctx.beginPath();
    ctx.moveTo(-w, -12);
    ctx.lineTo(w, -12);
    ctx.stroke();
    ctx.strokeStyle = '#8a96a3';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, -12);
    ctx.stroke();
    // body
    ctx.fillStyle = '#e9edf1';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2a33a';
    ctx.fillRect(-8, 2, 16, 3);
    // eye visor
    ctx.fillStyle = '#1d2733';
    ctx.beginPath();
    ctx.ellipse(0, -1.5, 5.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7ff0ff';
    const eh = p.blink > 0 ? 0.4 : 2;
    ctx.fillRect(-3, -2.5, 2, eh);
    ctx.fillRect(1, -2.5, 2, eh);
    if (p.carry > 0) {
      ctx.fillStyle = '#b5bcc4';
      ctx.fillRect(-2, 8, 4, 5);
    }
    // glow
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 20);
    g.addColorStop(0, 'rgba(127,240,255,0.15)');
    g.addColorStop(1, 'rgba(127,240,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, 40, 40);
    ctx.restore();
  }

  drawScanner(game) {
    const ctx = this.ctx;
    const t = game.stats.playTime;
    for (const p of game.scanNearby()) {
      const a = 0.25 + 0.2 * Math.sin(t * 3);
      ctx.strokeStyle = `rgba(127,240,255,${a})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 4, 14 + ((t * 10) % 8), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---- screen-space effects -------------------------------------------------------------------
  drawWeather(game, dt) {
    const ctx = this.ctx;
    const { W, H } = this;
    const zi = zoneIndexAt(game.climber.C.y);
    const z = ZONES[zi];
    const snowAmt = z.snow;
    const wind = game.gust.strength * game.gust.dir;
    if (snowAmt > 0) {
      const n = Math.floor(this.snow.length * snowAmt);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < n; i++) {
        const s = this.snow[i];
        s.y += dt * (0.05 + s.s * 0.04);
        s.x += dt * (wind * 0.5 + Math.sin(game.stats.playTime + s.p) * 0.02);
        if (s.y > 1) s.y -= 1;
        if (s.x > 1) s.x -= 1;
        if (s.x < 0) s.x += 1;
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.s * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (Math.abs(wind) > 0.3) {
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.35, Math.abs(wind) * 0.3)})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 18; i++) {
        const y = ((i * 97 + game.stats.playTime * 50) % H);
        const x = ((i * 211 + game.stats.playTime * 900 * Math.sign(wind)) % (W + 200) + W + 200) % (W + 200) - 100;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 60 * Math.sign(wind), y);
        ctx.stroke();
      }
    }
  }

  drawNight(game) {
    const dark = 1 - this.sky.dl;
    if (dark < 0.05) return;
    const l = this.lctx;
    const lw = this.light.width;
    const lh = this.light.height;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, lw, lh);
    l.fillStyle = `rgba(4,6,18,${dark * 0.78})`;
    l.fillRect(0, 0, lw, lh);
    l.globalCompositeOperation = 'destination-out';
    const lights = [];
    const c = game.climber;
    lights.push({ x: c.C.x, y: c.C.y - 60, r: 190 });
    lights.push({ x: game.pip.x, y: game.pip.y, r: 50 });
    for (const lg of game.world.ledges) {
      if (lg.camped || (game.camp && game.camp.ledge === lg)) lights.push({ x: (lg.x1 + lg.x2) / 2 - 40, y: lg.y, r: game.camp && game.camp.ledge === lg ? 260 : 60 });
    }
    for (const L of lights) {
      const s = this.toScreen(L.x, L.y);
      const r = L.r * this.cam.zoom * 0.5;
      const g = l.createRadialGradient(s.x / 2, s.y / 2, 0, s.x / 2, s.y / 2, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g;
      l.fillRect(s.x / 2 - r, s.y / 2 - r, r * 2, r * 2);
    }
    this.ctx.drawImage(this.light, 0, 0, this.W, this.H);
  }

  drawSpeech(game) {
    const p = game.pip;
    if (!p.say) return;
    const ctx = this.ctx;
    const s = this.toScreen(p.x, p.y - 14);
    ctx.font = '13px "Nunito", system-ui, sans-serif';
    const maxW = Math.min(300, this.W - 40);
    const words = p.say.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxW - 20) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    const bw = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20);
    const bh = lines.length * 17 + 12;
    const x = clamp(s.x - bw / 2, 10, this.W - bw - 10);
    const y = clamp(s.y - bh - 12, 10, this.H - bh - 10);
    ctx.fillStyle = 'rgba(20,28,38,0.88)';
    ctx.strokeStyle = 'rgba(127,240,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, 8);
    else ctx.rect(x, y, bw, bh);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e8f8ff';
    lines.forEach((ln, i) => ctx.fillText(ln, x + 10, y + 20 + i * 17));
  }

  drawHammer(game) {
    const hm = game.hammer;
    if (!hm) return;
    const ctx = this.ctx;
    const w = 220;
    const x = this.W / 2 - w / 2;
    const y = this.H * 0.72;
    ctx.fillStyle = 'rgba(15,20,28,0.85)';
    ctx.fillRect(x - 10, y - 30, w + 20, 62);
    ctx.fillStyle = '#e8eef4';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`Hammer the piton — press F in the green (${hm.hits}/3)`, x - 2, y - 12);
    ctx.fillStyle = '#39424e';
    ctx.fillRect(x, y, w, 14);
    ctx.fillStyle = '#4fbf6a';
    ctx.fillRect(x + w * 0.37, y, w * 0.26, 14);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + w * hm.marker - 2, y - 4, 4, 22);
  }

  // ---- frame ----------------------------------------------------------------------------------------
  render(game, ui, dt) {
    this.setWorld(game.world);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawSky(game);
    this.drawRanges(game);
    this.drawClouds(game, false);

    const z = this.cam.zoom;
    ctx.save();
    ctx.translate(this.W / 2, this.H / 2);
    ctx.scale(z, z);
    ctx.translate(-this.cam.x, -this.cam.y);
    this.drawGround(game);
    this.drawRock();
    this.drawValley(game);
    // daylight tint on the rock
    const sc = this.sky;
    if (sc.dusk > 0.05) {
      const tl = this.toWorld(0, 0);
      ctx.fillStyle = `rgba(255,140,80,${sc.dusk * 0.12})`;
      ctx.fillRect(tl.x, tl.y, this.W / z, this.H / z);
    }
    this.drawLedges(game);
    this.drawHolds(game, ui);
    this.drawPickups(game);
    this.drawScanner(game);
    this.drawRope(game);
    this.drawFauna(game);
    this.drawRocks(game);
    this.drawClimber(game, ui);
    this.drawPip(game);
    this.drawParticles(game);
    ctx.restore();

    this.drawNight(game);
    this.drawClouds(game, true);
    this.drawWeather(game, dt);
    // rockfall warning: dust at top of the screen
    for (const r of game.rocks) {
      if (r.warn > 0) {
        const s = this.toScreen(r.x, game.climber.C.y);
        ctx.fillStyle = `rgba(200,180,150,${0.4 + 0.3 * Math.sin(game.stats.playTime * 20)})`;
        ctx.font = 'bold 22px system-ui';
        ctx.fillText('▼', s.x - 8, 30);
      }
    }
    this.drawSpeech(game);
    this.drawHammer(game);
    // vignette
    const vg = ctx.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.35, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.W, this.H);
    // exhaustion red edge
    const c = game.climber;
    if (c.shake > 0.3 && c.state === 'climb') {
      const a = (c.shake - 0.3) * 0.5 * (0.7 + 0.3 * Math.sin(game.stats.playTime * 8));
      const rg = ctx.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.3, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.7);
      rg.addColorStop(0, 'rgba(120,0,0,0)');
      rg.addColorStop(1, `rgba(140,10,10,${a})`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }
}

export { WORLD_HEIGHT, BODY, FLORA };
