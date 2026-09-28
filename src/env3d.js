// 3D surroundings: sky dome, stars, surrounding peaks, the valley (meadow, forest, lake, stream,
// waterfall, base camp, Tobi, forage), clouds and birds.
import * as THREE from '../vendor/three.module.min.js';
import { VALLEY, FLORA } from './config.js';
import { loadGLTF } from './assets.js';
import { fbm2, noise2, clamp, lerp, mulberry32 } from './rng.js';

const smooth = (t) => t * t * (3 - 2 * t);

export const srgb = (r, g, b) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);

// Merge simple geometries into one non-indexed geometry with a flat vertex colour per part.
export function mergeParts(parts) {
  const geos = parts.map((p) => {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    g.computeVertexNormals();
    return { g, c: p.color };
  });
  let count = 0;
  for (const { g } of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const { g, c } of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    const cc = c.isColor ? c : srgb(c[0], c[1], c[2]);
    for (let i = 0; i < n; i++) {
      col[(o + i) * 3] = cc.r;
      col[(o + i) * 3 + 1] = cc.g;
      col[(o + i) * 3 + 2] = cc.b;
    }
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

const M4 = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return m;
};

function softTexture(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Environment {
  constructor(scene, r3) {
    this.scene = scene;
    this.r3 = r3;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.t = 0;
    this.buildSky();
  }

  // ---- valley terrain -------------------------------------------------------------------------
  // Offset between valley coordinates (z measured from the wall foot) and world z.
  zOff(x) {
    return Math.max(this.r3.surfaceZ(x, -81) + 17, 12);
  }

  // Height of the ground at world (x, z).
  groundHeight(x, z) {
    const seed = this.seed;
    const vz = z - this.zOff(x);
    const und = (fbm2(x * 0.003 + 11, vz * 0.003, seed + 70, 3) - 0.5) * 60;
    const near = smooth(clamp((vz - 30) / 220, 0, 1));
    const ex = Math.max(0, Math.abs(x) - 1300);
    const ez = Math.max(0, vz - 1000);
    const hill = Math.pow(ex + ez, 1.18) * 0.2 * (0.6 + 0.8 * fbm2(x * 0.0015, vz * 0.0015, seed + 71, 2));
    let h = und * near + hill;
    if (vz < 0) h += -vz * 0.35;
    const L = VALLEY.lake;
    const dl = Math.hypot(x - L.x, vz - L.z);
    if (dl < L.r + 90) h = lerp(h, -18, smooth(clamp((L.r + 90 - dl) / 110, 0, 1)));
    const C = VALLEY.camp;
    const dc = Math.hypot(x - C.x, vz - C.z);
    if (dc < 150) h = lerp(h, 0, smooth(clamp((150 - dc) / 70, 0, 1)));
    // the stream from the waterfall to the lake
    const sd = this.streamDist(x, vz);
    if (sd < 30) h = lerp(h, -5, smooth(clamp((30 - sd) / 22, 0, 1)));
    return h;
  }

  streamPts() {
    if (this._stream) return this._stream;
    const W = VALLEY.waterfall;
    const L = VALLEY.lake;
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      pts.push({ x: lerp(W.x, L.x - 40, t) + Math.sin(t * 6) * 45 * (1 - t), z: lerp(20, L.z - L.r * 0.7, t) });
    }
    this._stream = pts;
    return pts;
  }

  streamDist(x, z) {
    const pts = this.streamPts();
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
    }
    return best;
  }

  pathDist(x, vz) {
    // dirt trail: base camp -> wall foot, base camp -> lake
    const segs = [[VALLEY.camp, { x: 0, z: 10 }], [VALLEY.camp, { x: VALLEY.lake.x - VALLEY.lake.r, z: VALLEY.lake.z - 60 }]];
    let best = Infinity;
    for (const [a, b] of segs) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (vz - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const wob = Math.sin(t * 9) * 18;
      best = Math.min(best, Math.hypot(x - (a.x + dx * t) - wob, vz - (a.z + dz * t)));
    }
    return best;
  }

  build(world) {
    while (this.root.children.length) this.root.remove(this.root.children[0]);
    this.world = world;
    this.seed = world.seed;
    this._stream = null;
    this.buildPeaks();
    this.buildValley();
    this.buildForest();
    this.buildWater();
    this.buildCamp();
    this.buildForage();
    this.buildClouds();
    this.buildBirds();
    this.loadModels();
  }

  // Animated glTF models: the fox in the meadow and Kip, Mara's old robot, at base camp.
  async loadModels() {
    const world = this.world;
    try {
      const fox = await loadGLTF('Fox.glb');
      if (this.world !== world) return;
      const obj = fox.scene;
      const box = new THREE.Box3().setFromObject(obj);
      const len = Math.max(box.max.z - box.min.z, box.max.x - box.min.x);
      obj.scale.setScalar(72 / len);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const holder = new THREE.Group();
      holder.add(obj);
      this.root.add(holder);
      const mixer = new THREE.AnimationMixer(obj);
      const clip = (n) => fox.animations.find((a) => a.name === n);
      const acts = {};
      for (const n of ['Survey', 'Walk', 'Run']) if (clip(n)) acts[n] = mixer.clipAction(clip(n));
      this.fox = { holder, mixer, acts, current: null };
      this.playFox('Survey');
      this.chamois.visible = false;
    } catch (e) {
      console.warn('Fox model unavailable', e);
    }
    try {
      // Tobi: KayKit "Barbarian" (CC0) with a beanie and scarf, sitting by the fire with his mug
      const tobi = await loadGLTF('tobi.glb');
      if (this.world !== world) return;
      const obj = tobi.scene;
      obj.scale.setScalar(52);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const bones = {};
      obj.traverse((o) => { if (o.isBone) bones[o.name] = o; });
      const wool = new THREE.MeshStandardMaterial({ color: srgb(60, 110, 80), roughness: 0.95 });
      const knit = new THREE.MeshStandardMaterial({ color: srgb(200, 70, 50), roughness: 0.95 });
      const beanie = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), wool);
      beanie.scale.set(0.6, 0.62, 0.64);
      beanie.position.set(0, 0.5, -0.03);
      const brim = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.08, 8, 28), wool);
      brim.rotation.x = Math.PI / 2;
      brim.position.set(0, 0.5, -0.03);
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), knit);
      pom.position.set(0, 1.12, -0.05);
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.08, 8, 20), knit);
      scarf.rotation.x = Math.PI / 2;
      scarf.position.set(0, 0.55, 0);
      for (const m of [beanie, brim, pom]) { m.castShadow = true; bones.head.add(m); }
      scarf.castShadow = true;
      bones.chest.add(scarf);
      for (const c of this.tobi.children) c.visible = false;
      this.tobi.add(obj);
      obj.scale.divideScalar(this.tobi.scale.x || 1);
      const mixer = new THREE.AnimationMixer(obj);
      const sit = tobi.animations.find((a) => a.name === 'Sit_Floor_Idle');
      if (sit) mixer.clipAction(sit).play();
      this.tobiRig = { obj, mixer, head: bones.head, look: 0 };
    } catch (e) {
      console.warn('Tobi model unavailable', e);
    }
    try {
      const bot = await loadGLTF('RobotExpressive.glb');
      if (this.world !== world) return;
      const obj = bot.scene;
      const box = new THREE.Box3().setFromObject(obj);
      obj.scale.setScalar(88 / (box.max.y - box.min.y));
      this.reflective = [];
      obj.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          this.reflective.push(o.material);
          this.r3.currentEnv = undefined; // re-apply reflections to the new materials
        }
      });
      const it = this.world.valley.find((v) => v.kind === 'robot');
      const z = it.z + this.zOff(it.x);
      obj.position.set(it.x, this.groundHeight(it.x, z), z);
      this.root.add(obj);
      const mixer = new THREE.AnimationMixer(obj);
      const acts = {};
      for (const a of bot.animations) acts[a.name] = mixer.clipAction(a);
      for (const n of ['Wave', 'Yes', 'ThumbsUp', 'Jump']) {
        if (acts[n]) {
          acts[n].setLoop(THREE.LoopOnce, 1);
          acts[n].clampWhenFinished = true;
        }
      }
      mixer.addEventListener('finished', () => this.playRobot(this.robot.idle));
      this.robot = { obj, mixer, acts, current: null, idle: 'Idle', waved: false };
      this.playRobot('Idle');
    } catch (e) {
      console.warn('Robot model unavailable', e);
    }
  }

  playFox(name) {
    const f = this.fox;
    if (!f || f.current === name || !f.acts[name]) return;
    const next = f.acts[name];
    next.reset().fadeIn(0.3).play();
    if (f.current) f.acts[f.current].fadeOut(0.3);
    f.current = name;
  }

  playRobot(name) {
    const r = this.robot;
    if (!r || !r.acts[name]) return;
    if (r.current === name && r.acts[name].loop !== THREE.LoopOnce) return;
    const next = r.acts[name];
    next.reset().fadeIn(0.25).play();
    if (r.current && r.current !== name) r.acts[r.current].fadeOut(0.25);
    r.current = name;
  }

  // ---- sky ----------------------------------------------------------------------------------------
  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        top: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        bottom: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunCol: { value: new THREE.Color(1, 0.95, 0.8) },
        sunAmt: { value: 1 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunAmt;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-h, 0.0, 1.0), 0.4));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunCol * (pow(s, 1400.0) * 3.0 + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.12) * sunAmt;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(24000, 32, 16), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    // stars
    const r = mulberry32(99);
    const n = 1600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1;
      const a = r() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.05;
      const q = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * q * 23000;
      pos[i * 3 + 1] = y * 23000;
      pos[i * 3 + 2] = Math.sin(a) * q * 23000;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
    // moon
    const moonTex = softTexture(128, (c, s) => {
      const gr = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,240,1)');
      gr.addColorStop(0.28, 'rgba(250,250,235,1)');
      gr.addColorStop(0.33, 'rgba(220,230,255,0.25)');
      gr.addColorStop(1, 'rgba(200,210,255,0)');
      c.fillStyle = gr;
      c.fillRect(0, 0, s, s);
    });
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, transparent: true, depthWrite: false }));
    this.moon.scale.set(1900, 1900, 1);
    this.scene.add(this.moon);
  }

  // ---- surrounding range ----------------------------------------------------------------------------
  buildPeaks() {
    const r = mulberry32(this.seed + 404);
    const parts = [];
    const peaks = [];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + r() * 0.12;
      const d = 6500 + r() * 9000;
      const x = Math.sin(a) * d;
      const z = Math.cos(a) * d + 400;
      if (Math.abs(x) < 3000 && z < 0 && z > -7000) continue; // leave the space behind our own massif
      const h = 3200 + r() * 4800 * (d / 16000 + 0.35);
      const rad = Math.min(h * (0.65 + r() * 0.35), d * 0.33);
      peaks.push({ x, z, h, rad });
    }
    for (const p of peaks) {
      const geo = new THREE.ConeGeometry(p.rad, p.h, 11, 9);
      const pos = geo.attributes.position;
      const col = [];
      const seed = Math.floor(p.x * 13 + p.z * 7);
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);
        const t = (y + p.h / 2) / p.h; // 0 bottom, 1 top
        const ang = Math.atan2(z, x);
        const n = noise2(Math.cos(ang) * 2 + seed, t * 4, 3) - 0.5;
        const k = 1 + n * 0.45;
        x *= k;
        z *= k;
        y += n * p.h * 0.08 * (1 - t);
        pos.setXYZ(i, x, y, z);
      }
      const ng = geo.toNonIndexed();
      ng.computeVertexNormals();
      const np = ng.attributes.position;
      const nn = ng.attributes.normal;
      const cols = new Float32Array(np.count * 3);
      const snowLine = 0.5 + (noise2(seed, 1, 9) - 0.5) * 0.2;
      for (let i = 0; i < np.count; i += 3) {
        // one colour per face for the low-poly look
        const ty = (np.getY(i) + np.getY(i + 1) + np.getY(i + 2)) / 3;
        const t = (ty + p.h / 2) / p.h;
        const up = (nn.getY(i) + nn.getY(i + 1) + nn.getY(i + 2)) / 3;
        const jitter = noise2(np.getX(i) * 0.01, ty * 0.01, seed) * 0.15;
        let c;
        if (t + jitter > snowLine + (up < 0.35 ? 0.12 : 0)) c = srgb(236, 242, 250);
        else if (t + jitter < 0.2) c = srgb(46, 74, 52);
        else if (t + jitter < 0.3) c = srgb(78, 88, 70);
        else c = srgb(104 + jitter * 80, 106 + jitter * 80, 116 + jitter * 80);
        for (let k = 0; k < 3; k++) {
          cols[(i + k) * 3] = c.r;
          cols[(i + k) * 3 + 1] = c.g;
          cols[(i + k) * 3 + 2] = c.b;
        }
      }
      ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      ng.translate(p.x, p.h / 2 - 250, p.z);
      parts.push(ng);
    }
    // concatenate
    let count = 0;
    for (const g of parts) count += g.attributes.position.count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      col.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    this.root.add(mesh);
  }

  // ---- valley ground ------------------------------------------------------------------------------
  buildValley() {
    const W = 7000;
    const D = 6400;
    const geo = new THREE.PlaneGeometry(W, D, 175, 160);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const zc = 1400;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i) + zc;
      pos.setXYZ(i, x, this.groundHeight(x, z), z);
    }
    const ng = geo.toNonIndexed();
    ng.computeVertexNormals();
    const np = ng.attributes.position;
    const nn = ng.attributes.normal;
    const cols = new Float32Array(np.count * 3);
    const seed = this.seed;
    for (let i = 0; i < np.count; i += 3) {
      const x = (np.getX(i) + np.getX(i + 1) + np.getX(i + 2)) / 3;
      const y = (np.getY(i) + np.getY(i + 1) + np.getY(i + 2)) / 3;
      const z = (np.getZ(i) + np.getZ(i + 1) + np.getZ(i + 2)) / 3;
      const up = (nn.getY(i) + nn.getY(i + 1) + nn.getY(i + 2)) / 3;
      const vz = z - this.zOff(x);
      const n = fbm2(x * 0.004, z * 0.004, seed + 80, 3);
      const n2 = noise2(x * 0.03, z * 0.03, seed + 81);
      let c = srgb(86 + n * 50, 124 + n * 40, 58 + n * 20); // meadow
      if (n2 > 0.7) c = srgb(120, 140, 62);
      if (y > 180) c = c.lerp(srgb(58, 84, 56), clamp((y - 180) / 200, 0, 1)); // forested hills
      if (up < 0.6) c = srgb(112 + n * 30, 108 + n * 30, 100 + n * 30); // steep: rock
      if (y > 900 && up > 0.6) c = srgb(236, 240, 248); // high snow
      const pd = this.pathDist(x, vz);
      if (pd < 14) c = c.lerp(srgb(146, 120, 88), smooth(clamp((14 - pd) / 8, 0, 1)));
      const L = VALLEY.lake;
      const dl = Math.hypot(x - L.x, vz - L.z);
      if (dl < L.r + 36 && dl > L.r - 10) c = srgb(170, 156, 120);
      if (vz < 25 && Math.abs(x) < 900) c = c.lerp(srgb(120, 112, 100), 0.6); // scree at the wall foot
      for (let k = 0; k < 3; k++) {
        cols[(i + k) * 3] = c.r;
        cols[(i + k) * 3 + 1] = c.g;
        cols[(i + k) * 3 + 2] = c.b;
      }
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const guv = new Float32Array(np.count * 2);
    for (let i = 0; i < np.count; i++) {
      guv[i * 2] = np.getX(i) / 90;
      guv[i * 2 + 1] = np.getZ(i) / 90;
    }
    ng.setAttribute('uv', new THREE.BufferAttribute(guv, 2));
    const gt = this.r3.tex && this.r3.tex.ground;
    const mesh = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 1,
      map: gt ? gt.map : null, normalMap: gt ? gt.normalMap : null, normalScale: new THREE.Vector2(0.7, 0.7),
    }));
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.ground = mesh;

    // grass tufts and flowers near the walkable meadow
    const r = mulberry32(seed + 5);
    const tuft = mergeParts([
      { geo: new THREE.ConeGeometry(1.4, 9, 3), color: [255, 255, 255], matrix: M4(0, 4.5, 0, 1, 1, 1, 0, 0.25, 0.1) },
      { geo: new THREE.ConeGeometry(1.2, 7, 3), color: [255, 255, 255], matrix: M4(2, 3.5, 1, 1, 1, 1, 1, -0.3, 0.2) },
      { geo: new THREE.ConeGeometry(1.2, 8, 3), color: [255, 255, 255], matrix: M4(-2, 4, -1, 1, 1, 1, 2, 0.1, -0.35) },
    ]);
    const nT = 4200;
    const grass = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), nT);
    const flowerGeo = new THREE.IcosahedronGeometry(1.6, 0);
    const nF = 1400;
    const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), nF);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const fCols = [srgb(250, 250, 245), srgb(245, 214, 70), srgb(160, 110, 220), srgb(236, 120, 170), srgb(90, 130, 230)];
    let gi = 0;
    let fi = 0;
    for (let k = 0; k < 20000 && (gi < nT || fi < nF); k++) {
      const x = VALLEY.x0 - 200 + r() * (VALLEY.x1 - VALLEY.x0 + 400);
      const vz = 20 + r() * (VALLEY.z1 + 250);
      const z = vz + this.zOff(x);
      const L = VALLEY.lake;
      if (Math.hypot(x - L.x, vz - L.z) < L.r + 30) continue;
      if (this.pathDist(x, vz) < 12 || this.streamDist(x, vz) < 22) continue;
      const y = this.groundHeight(x, z);
      if (gi < nT) {
        e.set(0, r() * 6, 0);
        q.setFromEuler(e);
        const sc = 0.7 + r() * 0.9;
        m.compose(v.set(x, y, z), q, s.set(sc, sc * (0.8 + r() * 0.6), sc));
        grass.setMatrixAt(gi, m);
        grass.setColorAt(gi, srgb(70 + r() * 60, 110 + r() * 50, 40 + r() * 30));
        gi++;
      }
      if (fi < nF && fbm2(x * 0.006, z * 0.006, seed + 90, 2) > 0.52) {
        const sc = 0.8 + r() * 0.8;
        m.compose(v.set(x, y + 5 + r() * 2, z), q, s.set(sc, sc, sc));
        flowers.setMatrixAt(fi, m);
        flowers.setColorAt(fi, fCols[Math.floor(r() * fCols.length)]);
        fi++;
      }
    }
    grass.count = gi;
    flowers.count = fi;
    this.root.add(grass);
    this.root.add(flowers);
  }

  // ---- trees and boulders -------------------------------------------------------------------------------
  buildForest() {
    const seed = this.seed;
    const r = mulberry32(seed + 6);
    const pine = mergeParts([
      { geo: new THREE.CylinderGeometry(1.6, 2.4, 14, 5), color: [92, 64, 44], matrix: M4(0, 7, 0) },
      { geo: new THREE.ConeGeometry(15, 26, 7), color: [44, 86, 58], matrix: M4(0, 22, 0) },
      { geo: new THREE.ConeGeometry(12, 22, 7), color: [52, 98, 64], matrix: M4(0, 34, 0, 1, 1, 1, 0.4) },
      { geo: new THREE.ConeGeometry(8, 18, 7), color: [60, 108, 70], matrix: M4(0, 45, 0, 1, 1, 1, 0.9) },
    ]);
    const broad = mergeParts([
      { geo: new THREE.CylinderGeometry(1.8, 2.6, 18, 5), color: [104, 80, 60], matrix: M4(0, 9, 0) },
      { geo: new THREE.IcosahedronGeometry(13, 0), color: [96, 140, 64], matrix: M4(0, 26, 0) },
      { geo: new THREE.IcosahedronGeometry(9, 0), color: [112, 156, 72], matrix: M4(6, 33, 3) },
      { geo: new THREE.IcosahedronGeometry(8, 0), color: [84, 128, 58], matrix: M4(-6, 30, -4) },
    ]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    const nP = 1300;
    const nB = 260;
    const pines = new THREE.InstancedMesh(pine, mat, nP);
    const broads = new THREE.InstancedMesh(broad, mat, nB);
    pines.castShadow = true;
    broads.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const e = new THREE.Euler();
    let pi = 0;
    let bi = 0;
    const put = (mesh, idx, x, y, z, sc, tint) => {
      e.set(0, r() * 6.28, 0);
      q.setFromEuler(e);
      m.compose(v.set(x, y, z), q, s.set(sc, sc * (0.85 + r() * 0.35), sc));
      mesh.setMatrixAt(idx, m);
      mesh.setColorAt(idx, srgb(215 + tint, 225 + tint, 215 + tint));
    };
    // valley and surrounding hills
    for (let k = 0; k < 30000 && (pi < nP - 380 || bi < nB); k++) {
      const x = -3300 + r() * 6600;
      const vz = -300 + r() * 4200;
      const z = vz + this.zOff(x);
      const inMeadow = x > VALLEY.x0 - 100 && x < VALLEY.x1 + 100 && vz < VALLEY.z1 + 100;
      const dens = fbm2(x * 0.0022, vz * 0.0022, seed + 60, 3);
      if (inMeadow ? dens < 0.64 : dens < 0.42) continue;
      if (vz < 60 && Math.abs(x) < 800) continue;
      const L = VALLEY.lake;
      if (Math.hypot(x - L.x, vz - L.z) < L.r + 60) continue;
      if (Math.hypot(x - VALLEY.camp.x, vz - VALLEY.camp.z) < 170) continue;
      if (this.pathDist(x, vz) < 30 || this.streamDist(x, vz) < 40) continue;
      if (this.world.valley.some((it) => Math.hypot(it.x - x, it.z - vz) < 40)) continue;
      const y = this.groundHeight(x, z);
      if (y > 1000) continue;
      const tint = Math.floor((r() - 0.5) * 50);
      if (inMeadow && vz < 900 && bi < nB && r() < 0.45) put(broads, bi++, x, y - 1, z, 0.8 + r() * 0.7, tint);
      else if (pi < nP - 380) put(pines, pi++, x, y - 1, z, 0.9 + r() * 1.1, tint);
    }
    // forest on the lower flanks of the massif
    const w = this.world;
    for (let k = 0; k < 6000 && pi < nP; k++) {
      const sy = -r() * 2200;
      const side = r() < 0.5 ? -1 : 1;
      const hw = w.halfWidth(sy);
      const x = side * (hw + 70 + r() * 900);
      const dens = fbm2(x * 0.004, sy * 0.004, seed + 61, 2);
      if (dens < 0.45 + (-sy / 2200) * 0.2) continue;
      const z = this.r3.surfaceZ(x, sy) - 3;
      put(pines, pi++, x, -sy, z, 0.8 + r() * 0.9, Math.floor((r() - 0.5) * 40));
    }
    pines.count = pi;
    broads.count = bi;
    this.root.add(pines);
    this.root.add(broads);

    // boulders
    const nR = 150;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: srgb(150, 146, 138), flatShading: true, roughness: 1 }), nR);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    let ri = 0;
    for (let k = 0; k < 4000 && ri < nR; k++) {
      const nearWall = r() < 0.4;
      const x = nearWall ? (r() - 0.5) * 1700 : VALLEY.x0 + r() * (VALLEY.x1 - VALLEY.x0);
      const vz = nearWall ? 10 + r() * 90 : 60 + r() * VALLEY.z1;
      if (Math.hypot(x - VALLEY.camp.x, vz - VALLEY.camp.z) < 140) continue;
      if (Math.abs(x) < 120 && vz < 120) continue;
      const L = VALLEY.lake;
      if (Math.hypot(x - L.x, vz - L.z) < L.r + 20) continue;
      if (this.pathDist(x, vz) < 20) continue;
      const z = vz + this.zOff(x);
      const sc = nearWall ? 6 + r() * 16 : 5 + r() * 12;
      e.set(r() * 3, r() * 3, r() * 3);
      q.setFromEuler(e);
      m.compose(v.set(x, this.groundHeight(x, z) + sc * 0.3, z), q, s.set(sc * (1 + r() * 0.6), sc * (0.6 + r() * 0.4), sc));
      rocks.setMatrixAt(ri, m);
      rocks.setColorAt(ri, srgb(200 + r() * 55, 200 + r() * 50, 195 + r() * 45));
      ri++;
    }
    rocks.count = ri;
    this.root.add(rocks);
  }

  // ---- water ------------------------------------------------------------------------------------------------
  buildWater() {
    const L = VALLEY.lake;
    const lz = L.z + this.zOff(L.x);
    this.lakeMat = new THREE.MeshStandardMaterial({ color: srgb(34, 78, 98), roughness: 0.16, metalness: 0.15, envMapIntensity: 0.8, transparent: true, opacity: 0.93 });
    const lake = new THREE.Mesh(new THREE.CircleGeometry(L.r + 40, 48), this.lakeMat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(L.x, -4, lz);
    lake.receiveShadow = true;
    this.root.add(lake);

    // flowing water texture
    this.flowTex = softTexture(64, (c, s) => {
      c.fillStyle = 'rgba(190,225,245,0.55)';
      c.fillRect(0, 0, s, s);
      for (let i = 0; i < 40; i++) {
        c.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`;
        c.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 6 + Math.random() * 20);
      }
    });
    this.flowTex.wrapS = THREE.RepeatWrapping;
    this.flowTex.wrapT = THREE.RepeatWrapping;

    // waterfall down the wall
    const Wf = VALLEY.waterfall;
    const rows = 40;
    const cols = 4;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let j = 0; j <= rows; j++) {
      const sy = Wf.top + (-Wf.top) * (j / rows);
      for (let i = 0; i <= cols; i++) {
        const x = Wf.x - 16 + (32 * i) / cols;
        const bulge = 5 + Math.sin((i / cols) * Math.PI) * 3;
        pos.push(x, -sy, this.r3.surfaceZ(x, sy) + bulge);
        uv.push(i / cols * 0.5, (sy / 120));
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i;
        idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    fg.setIndex(idx);
    this.fallTex = this.flowTex.clone();
    this.fallTex.needsUpdate = true;
    this.fallTex.wrapS = THREE.RepeatWrapping;
    this.fallTex.wrapT = THREE.RepeatWrapping;
    const fall = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: this.fallTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 }));
    this.root.add(fall);

    // stream ribbon from the pool to the lake
    const sp = this.streamPts();
    const sPos = [];
    const sUv = [];
    const sIdx = [];
    let acc = 0;
    for (let i = 0; i < sp.length; i++) {
      const p = sp[i];
      const n = sp[Math.min(i + 1, sp.length - 1)];
      const pr = sp[Math.max(i - 1, 0)];
      const dx = n.x - pr.x;
      const dz = n.z - pr.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      const w = 10 + (i / sp.length) * 8;
      if (i > 0) acc += Math.hypot(p.x - sp[i - 1].x, p.z - sp[i - 1].z);
      for (const sd of [-1, 1]) {
        const x = p.x + nx * w * sd;
        const vz = p.z + nz * w * sd;
        const z = vz + this.zOff(x);
        sPos.push(x, this.groundHeight(x, z) + 1.5, z);
        sUv.push(sd * 0.5 + 0.5, acc / 60);
      }
      if (i > 0) {
        const a = (i - 1) * 2;
        sIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(sUv, 2));
    sg.setIndex(sIdx);
    const stream = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: this.flowTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0x9ccbe8 }));
    this.root.add(stream);

    // mist at the foot of the fall
    const mistTex = softTexture(64, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.7)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    });
    this.mist = [];
    for (let i = 0; i < 6; i++) {
      const sp2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: 0.5 }));
      sp2.scale.set(50, 50, 1);
      this.root.add(sp2);
      this.mist.push(sp2);
    }
    this.mistBase = new THREE.Vector3(Wf.x, 8, this.r3.surfaceZ(Wf.x, -5) + 16);
  }

  // ---- base camp and Tobi ----------------------------------------------------------------------------------
  buildCamp() {
    const C = VALLEY.camp;
    const cz = C.z + this.zOff(C.x);
    const cy = this.groundHeight(C.x, cz);
    const g = new THREE.Group();
    g.position.set(C.x, cy, cz);
    this.root.add(g);
    const tent = new THREE.Mesh(new THREE.ConeGeometry(34, 44, 4), new THREE.MeshStandardMaterial({ color: srgb(214, 120, 42), flatShading: true, roughness: 0.8 }));
    tent.position.set(-40, 22, -30);
    tent.rotation.y = Math.PI / 4;
    tent.castShadow = true;
    g.add(tent);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(14, 22), new THREE.MeshBasicMaterial({ color: 0x3a1c08 }));
    door.position.set(-28, 11, -18);
    door.rotation.y = Math.PI / 4;
    g.add(door);
    const tent2 = new THREE.Mesh(new THREE.ConeGeometry(24, 32, 4), new THREE.MeshStandardMaterial({ color: srgb(60, 120, 140), flatShading: true }));
    tent2.position.set(50, 16, -46);
    tent2.rotation.y = 0.5;
    tent2.castShadow = true;
    g.add(tent2);
    // fire ring, logs, flames
    const stoneM = new THREE.MeshStandardMaterial({ color: srgb(120, 116, 110), flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(3.2, 0), stoneM);
      st.position.set(Math.cos(a) * 11, 1.5, Math.sin(a) * 11);
      g.add(st);
    }
    const logM = new THREE.MeshStandardMaterial({ color: srgb(96, 66, 40) });
    for (const [x, z, ry] of [[30, 8, 0.3], [-4, 32, 1.4], [24, -22, -0.6]]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 30, 7), logM);
      log.rotation.set(0, ry, Math.PI / 2);
      log.position.set(x, 4, z);
      log.castShadow = true;
      g.add(log);
    }
    this.campFire = [];
    const fm = [new THREE.MeshBasicMaterial({ color: 0xff7a22 }), new THREE.MeshBasicMaterial({ color: 0xffd070 })];
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(6 - i * 2.5, 16 - i * 5, 6), fm[i]);
      f.position.set(0, 8 - i * 2, 0);
      g.add(f);
      this.campFire.push(f);
    }
    this.fireLight = new THREE.PointLight(0xff9a4a, 0, 520, 1.3);
    this.fireLight.position.set(C.x, cy + 18, cz);
    this.root.add(this.fireLight);
    // sign post
    const post = new THREE.Mesh(new THREE.BoxGeometry(3, 40, 3), logM);
    post.position.set(120, 20, -60);
    g.add(post);
    const signTex = softTexture(128, (c, s) => {
      c.fillStyle = '#7a5530';
      c.fillRect(0, 30, s, 68);
      c.fillStyle = '#f3e7cf';
      c.font = 'bold 26px Georgia, serif';
      c.textAlign = 'center';
      c.fillText('VEYRA', s / 2, 62);
      c.font = '17px Georgia, serif';
      c.fillText('2930 m ↑', s / 2, 86);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide }));
    sign.position.set(120, 36, -58);
    g.add(sign);
    // Tobi, sitting by the fire
    this.tobi = this.buildPerson({ jacket: [120, 80, 50], pants: [60, 62, 58], hat: [60, 90, 70], beard: true });
    const T = VALLEY.tobi;
    const tz = T.z + this.zOff(T.x);
    this.tobi.position.set(T.x, this.groundHeight(T.x, tz), tz);
    this.tobi.rotation.y = Math.atan2(C.x - T.x, cz - tz);
    this.root.add(this.tobi);
    // start cairn at the wall foot
    let yy = 0;
    for (let i = 0; i < 6; i++) {
      const st = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), stoneM);
      st.scale.set(12 - i * 1.4, 4.5, 10 - i);
      yy += 4.2;
      st.position.set(-70 + Math.sin(i) * 1.5, yy, this.zOff(-70) + 30);
      yy += 3.5;
      st.castShadow = true;
      this.root.add(st);
    }
  }

  // A seated person built from capsules.
  buildPerson(c) {
    const g = new THREE.Group();
    const cap = new THREE.CapsuleGeometry(1, 1, 4, 8);
    const mat = (col) => new THREE.MeshStandardMaterial({ color: srgb(...col), roughness: 0.85 });
    const jacket = mat(c.jacket);
    const pants = mat(c.pants);
    const skin = mat([214, 170, 140]);
    const seg = (m, a, b, r) => {
      const mesh = new THREE.Mesh(cap, m);
      const d = new THREE.Vector3().subVectors(b, a);
      mesh.position.copy(a).addScaledVector(d, 0.5);
      mesh.scale.set(r, d.length() / 2, r);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    // seated on a log: hips at 22 high, facing +z
    seg(jacket, V(0, 26, -4), V(0, 56, 0), 12);
    for (const s of [-1, 1]) {
      seg(pants, V(s * 7, 24, 0), V(s * 8, 22, 26), 5);
      seg(pants, V(s * 8, 22, 26), V(s * 8, 2, 28), 4.3);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 12), mat([50, 40, 34]));
      boot.position.set(s * 8, 2.5, 31);
      g.add(boot);
      seg(jacket, V(s * 12, 54, 0), V(s * 11, 38, 14), 3.6);
      seg(jacket, V(s * 11, 38, 14), V(s * 4, 40, 28), 3.2);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), skin);
      hand.position.set(s * 4, 40, 29);
      g.add(hand);
    }
    const head = new THREE.Group();
    head.position.set(0, 70, 2);
    g.add(head);
    const face = new THREE.Mesh(new THREE.SphereGeometry(8.5, 14, 10), skin);
    head.add(face);
    if (c.beard) {
      const beard = new THREE.Mesh(new THREE.SphereGeometry(7, 10, 8), mat([200, 196, 188]));
      beard.scale.set(1, 1.1, 0.8);
      beard.position.set(0, -4, 4);
      head.add(beard);
    }
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 5, 12), mat(c.hat));
    hat.position.y = 6;
    head.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 1.2, 14), mat(c.hat));
    brim.position.y = 4;
    head.add(brim);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0x222222 }));
      eye.position.set(s * 3, 1, 7.8);
      head.add(eye);
    }
    g.userData.head = head;
    return g;
  }

  // ---- forage (bushes, mushrooms, herbs, flowers) -------------------------------------------------------------
  buildForage() {
    this.forage = [];
    const leaf = new THREE.MeshStandardMaterial({ color: srgb(58, 110, 52), flatShading: true });
    const berry = new THREE.MeshStandardMaterial({ color: srgb(180, 30, 70), roughness: 0.4 });
    const stemM = new THREE.MeshStandardMaterial({ color: srgb(240, 230, 210) });
    const capM = new THREE.MeshStandardMaterial({ color: srgb(190, 70, 50) });
    const herbM = new THREE.MeshStandardMaterial({ color: srgb(110, 190, 90), flatShading: true });
    const flowerCol = {
      alpenrose: srgb(230, 90, 140), arnica: srgb(250, 196, 40),
    };
    for (const it of this.world.valley) {
      if (it.kind === 'npc' || it.kind === 'water' || it.kind === 'robot') continue;
      const g = new THREE.Group();
      const z = it.z + this.zOff(it.x);
      g.position.set(it.x, this.groundHeight(it.x, z), z);
      const fruit = new THREE.Group();
      if (it.kind === 'bush') {
        for (const [x, y, zz, s] of [[0, 9, 0, 10], [8, 7, 3, 7], [-7, 6, -2, 7.5], [2, 14, -3, 6]]) {
          const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), leaf);
          b.position.set(x, y, zz);
          b.castShadow = true;
          g.add(b);
        }
        for (let i = 0; i < 14; i++) {
          const a = i * 2.4;
          const bb = new THREE.Mesh(new THREE.SphereGeometry(1.5, 6, 4), berry);
          bb.position.set(Math.cos(a) * 9, 5 + (i % 5) * 2.4, Math.sin(a) * 9);
          fruit.add(bb);
        }
      } else if (it.kind === 'mushroom') {
        for (const [x, zz, s] of [[0, 0, 1], [6, 3, 0.7], [-4, 5, 0.6]]) {
          const st = new THREE.Mesh(new THREE.CylinderGeometry(1.2 * s, 1.6 * s, 6 * s, 6), stemM);
          st.position.set(x, 3 * s, zz);
          fruit.add(st);
          const cp = new THREE.Mesh(new THREE.SphereGeometry(4.5 * s, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), capM);
          cp.position.set(x, 6 * s, zz);
          fruit.add(cp);
        }
      } else if (it.kind === 'herbs') {
        for (let i = 0; i < 7; i++) {
          const h = new THREE.Mesh(new THREE.ConeGeometry(1.5, 12 + (i % 3) * 3, 4), herbM);
          h.position.set(Math.cos(i * 2) * 4, 6, Math.sin(i * 2) * 4);
          h.rotation.set(Math.sin(i) * 0.3, 0, Math.cos(i) * 0.3);
          fruit.add(h);
        }
      } else if (it.kind === 'flora') {
        const col = new THREE.MeshStandardMaterial({ color: flowerCol[it.id] || srgb(250, 250, 250), emissive: flowerCol[it.id] || 0xffffff, emissiveIntensity: 0.25 });
        for (let k = 0; k < 3; k++) {
          const st = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 12, 4), herbM);
          st.position.set(k * 4 - 4, 6, (k % 2) * 3);
          fruit.add(st);
          for (let p = 0; p < 5; p++) {
            const pe = new THREE.Mesh(new THREE.SphereGeometry(1.6, 6, 4), col);
            const a = (p / 5) * Math.PI * 2;
            pe.position.set(k * 4 - 4 + Math.cos(a) * 2, 12.5, (k % 2) * 3 + Math.sin(a) * 2);
            fruit.add(pe);
          }
        }
      }
      g.add(fruit);
      this.root.add(g);
      this.forage.push({ it, fruit });
    }
    // chamois
    this.chamois = this.buildChamois();
    this.root.add(this.chamois);
  }

  buildChamois() {
    const g = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: srgb(130, 96, 64), roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: srgb(40, 30, 24) });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(9, 22, 4, 8), fur);
    body.rotation.x = Math.PI / 2;
    body.position.y = 34;
    body.castShadow = true;
    g.add(body);
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(4, 12, 4, 6), fur);
    neck.position.set(0, 46, 16);
    neck.rotation.x = 0.6;
    g.add(neck);
    const head = new THREE.Mesh(new THREE.CapsuleGeometry(4, 9, 4, 6), new THREE.MeshStandardMaterial({ color: srgb(220, 206, 186) }));
    head.position.set(0, 53, 23);
    head.rotation.x = 1.3;
    g.add(head);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.TorusGeometry(3, 0.8, 4, 8, Math.PI), dark);
      horn.position.set(s * 2.4, 59, 21);
      horn.rotation.y = Math.PI / 2;
      g.add(horn);
    }
    g.userData.legs = [];
    for (const [x, z] of [[-5, 12], [5, 12], [-5, -12], [5, -12]]) {
      const leg = new THREE.Group();
      leg.position.set(x, 30, z);
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.6, 30, 2.6), dark);
      m.position.y = -15;
      leg.add(m);
      g.add(leg);
      g.userData.legs.push(leg);
    }
    return g;
  }

  // ---- clouds and birds ------------------------------------------------------------------------------------
  buildClouds() {
    const tex = softTexture(128, (c, s) => {
      for (let i = 0; i < 14; i++) {
        const x = s * (0.2 + Math.random() * 0.6);
        const y = s * (0.35 + Math.random() * 0.3);
        const r = s * (0.12 + Math.random() * 0.18);
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, s, s);
      }
    });
    this.cloudMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9, fog: true });
    this.clouds = new THREE.Group();
    this.root.add(this.clouds);
    const r = mulberry32(this.seed + 8);
    const add = (x, y, z, s) => {
      const sp = new THREE.Sprite(this.cloudMat);
      sp.scale.set(s, s * 0.45, 1);
      sp.position.set(x, y, z);
      this.clouds.add(sp);
    };
    // a sea of clouds around the Granite Shield: you climb through it and then above it
    for (let i = 0; i < 190; i++) {
      const a = r() * Math.PI * 2;
      const d = 600 + r() * 8000;
      const x = Math.sin(a) * d;
      const z = Math.cos(a) * d;
      if (z > -200 && Math.abs(x) < 1100) continue; // keep the climbing line clear
      add(x, 2350 + r() * 350, z, 700 + r() * 1300);
    }
    for (let i = 0; i < 50; i++) {
      const a = r() * Math.PI * 2;
      const d = 2500 + r() * 9000;
      add(Math.sin(a) * d, 4500 + r() * 4500, Math.cos(a) * d, 900 + r() * 1600);
    }
  }

  buildBirds() {
    this.flocks = [];
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -3, 0, 0, 3, 12, 0, 0], 3));
    wingGeo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0x1c1c22, side: THREE.DoubleSide });
    for (let f = 0; f < 3; f++) {
      const flock = { birds: [], phase: f * 2.1, radius: 500 + f * 250, height: 250 + f * 120 };
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Group();
        const l = new THREE.Mesh(wingGeo, mat);
        const rr = new THREE.Mesh(wingGeo, mat);
        rr.scale.x = -1;
        b.add(l, rr);
        b.userData = { l, r: rr, off: new THREE.Vector3((i % 3) * 30 - 30, (i % 2) * 12, Math.floor(i / 3) * 30), ph: i * 0.7 };
        this.root.add(b);
        flock.birds.push(b);
      }
      this.flocks.push(flock);
    }
  }

  // ---- per frame -------------------------------------------------------------------------------------------------
  update(game, camera, dt, sky, sunDir, focus) {
    this.t += dt;
    const t = game.stats.playTime;
    const dl = sky.dl;
    // sky dome follows the camera
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    const u = this.sky.material.uniforms;
    u.top.value.setRGB(sky.top[0] / 255, sky.top[1] / 255, sky.top[2] / 255);
    u.horizon.value.setRGB(sky.bot[0] / 255, sky.bot[1] / 255, sky.bot[2] / 255);
    u.bottom.value.setRGB(sky.bot[0] / 255 * 0.8, sky.bot[1] / 255 * 0.85, sky.bot[2] / 255 * 0.9);
    u.sunDir.value.copy(sunDir);
    u.sunAmt.value = clamp(dl * 1.2, 0, 1) * (sunDir.y > -0.05 ? 1 : 0);
    u.sunCol.value.setRGB(1, lerp(0.95, 0.65, sky.dusk), lerp(0.8, 0.45, sky.dusk));
    this.stars.material.opacity = clamp(1 - dl * 1.6, 0, 1);
    const moonDir = new THREE.Vector3(-sunDir.x, Math.abs(sunDir.y) * 0.8 + 0.25, -sunDir.z * 0.5 + 0.5).normalize();
    this.moon.position.copy(camera.position).addScaledVector(moonDir, 15000);
    this.moon.material.opacity = clamp(1 - dl * 1.4, 0, 1);

    // clouds tinted by daylight
    const cc = new THREE.Color(1, 1, 1).lerp(new THREE.Color(1, 0.72, 0.55), sky.dusk * 0.7).lerp(new THREE.Color(0.18, 0.22, 0.34), (1 - dl) * 0.85);
    this.cloudMat.color.copy(cc);
    this.clouds.rotation.y = t * 0.002;

    // water flow
    if (this.fallTex) this.fallTex.offset.y += dt * 1.6;
    if (this.flowTex) this.flowTex.offset.y -= dt * 0.6;
    this.mist.forEach((m, i) => {
      const ph = (t * 0.4 + i / this.mist.length) % 1;
      m.position.copy(this.mistBase).add(new THREE.Vector3(Math.sin(i * 3) * 22, ph * 40, Math.cos(i * 2) * 14));
      m.material.opacity = 0.45 * (1 - ph) * (0.4 + dl * 0.6);
      m.scale.setScalar(30 + ph * 50);
    });

    // camp fire flicker, brighter at night
    this.campFire.forEach((f, i) => { f.scale.y = 1 + Math.sin(t * 14 + i * 2) * 0.22; });
    this.fireLight.intensity = (400 + (1 - dl) * 2600) * (0.85 + 0.15 * Math.sin(t * 17));
    // Tobi looks at you when you are close
    if (this.tobiRig) {
      const tr = this.tobiRig;
      tr.mixer.update(dt);
      const ex = game.explore;
      let want = Math.sin(t * 0.3) * 0.3;
      if (ex.active && ex.ledge && ex.ledge.ground && Math.hypot(ex.x - VALLEY.tobi.x, ex.z - VALLEY.tobi.z) < 220) {
        const T = this.tobi.position;
        const a = Math.atan2(ex.x - T.x, ex.z + this.zOff(ex.x) - T.z) - this.tobi.rotation.y;
        want = THREE.MathUtils.clamp(Math.atan2(Math.sin(a), Math.cos(a)), -1.1, 1.1);
      }
      tr.look = lerp(tr.look, want, Math.min(1, dt * 3));
      tr.head.rotation.y += tr.look;
      tr.head.scale.setScalar(0.72);
    }
    const head = this.tobi.userData.head;
    const ex = game.explore;
    if (ex.active && ex.ledge && ex.ledge.ground && Math.hypot(ex.x - VALLEY.tobi.x, ex.z - VALLEY.tobi.z) < 200) {
      head.rotation.y = lerp(head.rotation.y, Math.sin(t) * 0.1 + 0.5, dt * 3);
    } else head.rotation.y = Math.sin(t * 0.3) * 0.3;
    head.rotation.x = Math.sin(t * 0.7) * 0.05;

    // forage regrowth
    for (const f of this.forage) {
      const it = f.it;
      f.fruit.visible = it.kind === 'flora' ? !game.journal.flora[it.id] : it.picked !== game.day;
    }

    // fox (animated model) or the simple stand-in
    const ch = game.meadowFauna && game.meadowFauna[0];
    if (ch && this.fox) {
      const z = ch.z + this.zOff(ch.x);
      const h = this.fox.holder;
      const prev = h.position.clone();
      h.position.set(ch.x, this.groundHeight(ch.x, z), z);
      const speed = prev.distanceTo(h.position) / Math.max(dt, 1e-3);
      if (speed > 0.5) h.rotation.y = Math.atan2(h.position.x - prev.x, h.position.z - prev.z);
      this.playFox(speed > 60 ? 'Run' : speed > 4 ? 'Walk' : 'Survey');
      this.fox.mixer.update(dt);
    }
    if (this.robot) {
      const r = this.robot;
      const ex = game.explore;
      const it = this.world.valley.find((v) => v.kind === 'robot');
      const near = ex.active && ex.ledge && ex.ledge.ground && Math.hypot(ex.x - it.x, ex.z - it.z) < 220;
      r.idle = game.journal.cairns[7] ? 'Dance' : 'Idle';
      if (near && !r.waved) {
        r.waved = true;
        this.playRobot('Wave');
      } else if (!near) {
        r.waved = false;
        if (r.current !== 'Wave' && r.current !== 'Yes' && r.current !== 'ThumbsUp') this.playRobot(r.idle);
      }
      if (game.robotCheer) {
        game.robotCheer = false;
        this.playRobot(Math.random() < 0.5 ? 'Yes' : 'ThumbsUp');
      }
      // turn to face the player
      if (near) {
        const tz = this.zOff(ex.x) + ex.z;
        const want = Math.atan2(ex.x - r.obj.position.x, tz - r.obj.position.z);
        r.obj.rotation.y += (Math.atan2(Math.sin(want - r.obj.rotation.y), Math.cos(want - r.obj.rotation.y))) * Math.min(1, dt * 3);
      }
      r.mixer.update(dt);
    }
    if (ch && !this.fox) {
      const z = ch.z + this.zOff(ch.x);
      this.chamois.position.set(ch.x, this.groundHeight(ch.x, z), z);
      this.chamois.rotation.y = ch.heading || 0;
      const legs = this.chamois.userData.legs;
      legs.forEach((l, i) => { l.rotation.x = ch.moving ? Math.sin(t * 10 + (i % 2) * Math.PI) * 0.5 : 0; });
    }

    // birds circle near the player's altitude
    for (const fl of this.flocks) {
      const a = t * 0.12 + fl.phase;
      const cx = focus.x + Math.cos(a) * fl.radius;
      const cz = focus.z + 200 + Math.sin(a) * fl.radius;
      const cy = focus.y + fl.height;
      for (const b of fl.birds) {
        const d = b.userData;
        b.position.set(cx + d.off.x, cy + d.off.y + Math.sin(t * 2 + d.ph) * 6, cz + d.off.z);
        b.rotation.y = -a;
        const flap = Math.sin(t * 9 + d.ph) * 0.6;
        d.l.rotation.z = flap;
        d.r.rotation.z = -flap;
      }
    }
  }
}

export { FLORA };
