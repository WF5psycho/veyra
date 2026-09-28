// three.js renderer: low-poly displaced rock wall with relief and shadows, 3D climber, props and lights.
// Shares all game state with the 2D renderer; sim coordinates (x, y-down) map to 3D (x, -y, z out of the wall).
import * as THREE from '../vendor/three.module.min.js';
import { ZONES, zoneIndexAt, BODY, FLORA, WORLD_HEIGHT, VALLEY } from './config.js';
import { Environment } from './env3d.js';
import { makeRockTextures, makeGroundTextures, makeSnowTextures } from './tex3d.js';
import { loadEXR } from './assets.js';
import { ClimberModel } from './climber3d.js';
import { fbm2, noise2, clamp, lerp, mulberry32 } from './rng.js';
import { ik2, zoneBlend } from './render2d.js';

const CH = 360; // chunk height in world units
const STEP = 10; // vertex spacing

const col3 = (c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

export class Renderer3D {
  constructor(container, r2) {
    this.container = container;
    this.r2 = r2;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xcfe3f2, 0.00009);
    this.camera = new THREE.PerspectiveCamera(45, 1, 3, 40000);
    this.camPos = new THREE.Vector3(0, 200, 600);
    this.camLook = new THREE.Vector3(0, 100, 0);
    this.userYaw = 0;
    this.userPitch = 0;
    this.walkYaw = 0;
    this.walkPitch = 0.28;
    this.camMode = 'climb';
    this.camTarget = new THREE.Vector3(0, 100, 0);
    this.yaw = 0.22;
    this.chunks = new Map();
    this.world = null;
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    // lights
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x4a3f35, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -220; sc.right = 220; sc.top = 220; sc.bottom = -220; sc.near = 10; sc.far = 1200;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.headlamp = new THREE.SpotLight(0xfff4d0, 0, 420, 0.6, 0.5, 1.2);
    this.scene.add(this.headlamp);
    this.scene.add(this.headlamp.target);
    this.fireLight = new THREE.PointLight(0xff8a3a, 0, 380, 1.4);
    this.scene.add(this.fireLight);
    this.pipLight = new THREE.PointLight(0x7ff0ff, 0.6, 60, 2);
    this.scene.add(this.pipLight);

    this.env = new Environment(this.scene, this);

    this.mats = {
      rock: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
      holdLight: new THREE.MeshStandardMaterial({ vertexColors: false, color: 0xcfc6b4, flatShading: true, roughness: 0.9 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 1 }),
      ice: new THREE.MeshStandardMaterial({ color: 0xcfeaff, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true }),
      jacket: new THREE.MeshStandardMaterial({ color: 0x2f7f86, roughness: 0.8 }),
      pants: new THREE.MeshStandardMaterial({ color: 0x34405a, roughness: 0.9 }),
      boot: new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.9 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xd9a98a, roughness: 0.8 }),
      chalk: new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 1 }),
      pack: new THREE.MeshStandardMaterial({ color: 0xb8552e, roughness: 0.85 }),
      beanie: new THREE.MeshStandardMaterial({ color: 0xc23b35, roughness: 0.9 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x4a2f22, roughness: 0.9 }),
      harness: new THREE.MeshStandardMaterial({ color: 0xe8b53a, roughness: 0.6 }),
      rope: new THREE.MeshStandardMaterial({ color: 0xe0562e, roughness: 0.7 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xc9cfd6, roughness: 0.3, metalness: 0.8 }),
      pip: new THREE.MeshStandardMaterial({ color: 0xe9edf1, roughness: 0.4 }),
      visor: new THREE.MeshStandardMaterial({ color: 0x1d2733, roughness: 0.2, emissive: 0x0a2a30 }),
      eye: new THREE.MeshBasicMaterial({ color: 0x7ff0ff }),
      orange: new THREE.MeshStandardMaterial({ color: 0xf2a33a, roughness: 0.6 }),
      tent: new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.8, flatShading: true }),
      stone: new THREE.MeshStandardMaterial({ color: 0x9c978f, roughness: 0.95, flatShading: true }),
      snow: new THREE.MeshStandardMaterial({ color: 0xf0f5fc, roughness: 0.9, flatShading: true }),
      grass: new THREE.MeshStandardMaterial({ color: 0x4f7a3e, roughness: 1 }),
      pine: new THREE.MeshStandardMaterial({ color: 0x2c5a3e, roughness: 1, flatShading: true }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x4b3423, roughness: 1 }),
      fire: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
      fire2: new THREE.MeshBasicMaterial({ color: 0xffe08a }),
      flag: new THREE.MeshStandardMaterial({ color: 0xd6453d, side: THREE.DoubleSide }),
      hover: new THREE.MeshBasicMaterial({ color: 0x78ffa0, transparent: true, opacity: 0.9 }),
      hoverBad: new THREE.MeshBasicMaterial({ color: 0xff6e5a, transparent: true, opacity: 0.9 }),
      hoverLunge: new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95 }),
    };

    // Generated surface detail: tileable albedo + normal maps.
    this.tex = { rock: makeRockTextures(), ground: makeGroundTextures(), snow: makeSnowTextures() };
    this.mats.rock.map = this.tex.rock.map;
    this.mats.rock.normalMap = this.tex.rock.normalMap;
    this.mats.rock.normalScale = new THREE.Vector2(0.9, 0.9);
    this.mats.holdLight.normalMap = this.tex.rock.normalMap;
    this.mats.holdLight.normalScale = new THREE.Vector2(0.6, 0.6);
    this.envMaps = {};
    this.loadLighting();

    this.geo = {
      jug: (() => { const g = new THREE.IcosahedronGeometry(1, 0); g.scale(8, 4.5, 5); return g; })(),
      crimp: new THREE.BoxGeometry(12, 2.2, 4),
      pocketRim: new THREE.TorusGeometry(5, 1.8, 5, 8),
      pocketHole: new THREE.CircleGeometry(4.2, 10),
      sloper: (() => { const g = new THREE.SphereGeometry(1, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2); g.rotateX(Math.PI / 2); g.scale(11, 7, 5); return g; })(),
      crack: new THREE.BoxGeometry(3, 12, 2),
      ice: (() => { const g = new THREE.IcosahedronGeometry(1, 0); g.scale(8, 5, 4); return g; })(),
      cap: new THREE.CapsuleGeometry(1, 1, 4, 8),
      sphere: new THREE.SphereGeometry(1, 14, 10),
      box: new THREE.BoxGeometry(1, 1, 1),
      ring: new THREE.TorusGeometry(1, 0.08, 6, 32),
    };

    this.holdMeshes = new Map();
    this.pickupSprites = new Map();
    this.spriteTex = new Map();
    this.buildClimber();
    this.buildPip();
    this.ropeMesh = null;
    this.pitonGroup = new THREE.Group();
    this.scene.add(this.pitonGroup);
    this.pitonMeshes = new Map();
    this.hoverRing = new THREE.Mesh(this.geo.ring, this.mats.hover);
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
    this.reachRing = new THREE.Mesh(this.geo.ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
    this.reachRing.visible = false;
    this.scene.add(this.reachRing);
    this.rockGroup = new THREE.Group();
    this.scene.add(this.rockGroup);
    this.faunaSprites = new Map();
  }

  // Image-based lighting from CC0 Poly Haven HDRIs (lighting and reflections only; the sky dome stays ours).
  async loadLighting() {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      for (const name of ['park', 'dawn', 'sunset', 'night']) {
        const eq = await loadEXR(`hdri/${name}.exr`);
        this.envMaps[name] = pmrem.fromEquirectangular(eq).texture;
        eq.dispose();
      }
      pmrem.dispose();
    } catch (e) {
      console.warn('HDRI lighting unavailable, using plain lights', e);
    }
  }

  // The HDRIs are used for reflections only (water, metal, robots); diffuse light stays ours so the rock keeps its colour.
  pickEnvironment(game, dl) {
    const t = game.time;
    let name = 'park';
    if (dl < 0.25) name = 'night';
    else if (dl < 0.85) name = t < 12 ? 'dawn' : 'sunset';
    const env = this.envMaps[name] || null;
    if (env !== this.currentEnv) {
      this.currentEnv = env;
      const reflective = [this.mats.metal, this.mats.pip, this.mats.visor, this.env.lakeMat, ...(this.env.reflective || [])];
      for (const m of reflective) {
        if (!m) continue;
        m.envMap = env;
        m.needsUpdate = true;
      }
    }
    return false;
  }

  resize(w, h, dpr) {
    this.W = w;
    this.H = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- terrain ----------------------------------------------------------------------------------
  surfaceZ(x, y) {
    const w = this.world;
    const s = w.seed;
    const ridge = 1 - Math.abs(noise2(x * 0.011, y * 0.008, s + 52) * 2 - 1);
    let z = (fbm2(x * 0.005, y * 0.004, s + 50, 3) - 0.5) * 70
      + ridge * ridge * 22
      + (noise2(x * 0.035, y * 0.03, s + 51) - 0.5) * 12;
    const hw = w.halfWidth(y);
    const e = Math.abs(x) - hw;
    if (e > -60) z -= Math.max(0, e + 60) * 0.9;
    const over = -WORLD_HEIGHT - 30 - y;
    if (over > 0) z -= over * 2.2; // above the summit the ridge falls away
    return z;
  }

  setWorld(world) {
    if (this.world === world) return;
    this.world = world;
    for (const ch of this.chunks.values()) this.disposeChunk(ch);
    this.chunks.clear();
    this.holdMeshes.clear();
    for (const s of this.pickupSprites.values()) this.scene.remove(s);
    this.pickupSprites.clear();
    for (const s of this.faunaSprites.values()) this.scene.remove(s);
    this.faunaSprites.clear();
    for (const m of this.pitonMeshes.values()) this.pitonGroup.remove(m);
    this.pitonMeshes.clear();
    this.buildFarMountain();
    this.env.build(world);
  }

  disposeChunk(ch) {
    this.scene.remove(ch.group);
    ch.group.traverse((o) => {
      if (o.geometry && o.userData.own) o.geometry.dispose();
    });
    for (const h of ch.holds) this.holdMeshes.delete(h);
  }

  // Colour of the rock at sim (x, y); e = distance outside the climbing face (flanks).
  rockColor(sx, sy, e) {
    const seed = this.world.seed;
    const zb = zoneBlend(sy);
    const big = fbm2(sx * 0.009, sy * 0.007, seed, 3);
    const det = noise2(sx * 0.09, sy * 0.09, seed + 4);
    const strata = Math.sin(sy * 0.05 + big * 9) * 0.5 + 0.5;
    const facet = noise2(sx * 0.05, sy * 0.05, seed + 13);
    const shade = clamp(0.5 + (big - 0.5) * 1.6 + (det - 0.5) * 0.3 + (strata - 0.5) * 0.2 + (facet - 0.5) * 0.5, 0, 1);
    let c = shade < 0.5
      ? col3(zb.dark).lerp(col3(zb.rock), shade * 2)
      : col3(zb.rock).lerp(col3(zb.light), (shade - 0.5) * 2);
    if (sy > -2400) {
      const m = noise2(sx * 0.04, sy * 0.04, seed + 21);
      if (m > 0.66) c.lerp(col3([96, 122, 58]), (m - 0.66) * 2.2 * clamp((sy + 2400) / 1200, 0, 1));
    }
    if (e > 30) {
      // flanks: alpine meadow and forest low down, bare rock higher up
      const veg = fbm2(sx * 0.006, sy * 0.006, seed + 33, 2);
      const low = clamp((sy + 2300 + (veg - 0.5) * 800) / 900, 0, 1);
      if (low > 0) c.lerp(veg > 0.5 ? col3([46, 78, 50]) : col3([92, 118, 62]), low * clamp((e - 30) / 120, 0, 1) * 0.9);
    }
    return c;
  }

  snowAmount(sx, sy, e) {
    const zb = zoneBlend(sy);
    let a = zb.snow * 0.55;
    const n = noise2(sx * 0.004, sy * 0.004, this.world.seed + 34);
    if (e > 60 && sy < -4300 + (n - 0.5) * 1400) a = Math.max(a, 0.85);
    if (sy < -8200) a = Math.max(a, 0.9);
    return a;
  }

  // Grid mesh of the mountain between sim y0 (top) and y1, extending into receding flanks on both sides.
  buildWallMesh(y0, y1, stepY, innerStep, outerCols, zOffset) {
    const w = this.world;
    let maxHW = 0;
    for (let y = y0; y <= y1; y += 40) maxHW = Math.max(maxHW, w.halfWidth(y));
    const inner = maxHW + 160;
    const outer = 1700;
    const xs = [];
    for (let k = outerCols; k >= 1; k--) xs.push(-inner - outer * Math.pow(k / outerCols, 1.5));
    const nIn = Math.ceil((inner * 2) / innerStep);
    for (let k = 0; k <= nIn; k++) xs.push(-inner + (2 * inner * k) / nIn);
    for (let k = 1; k <= outerCols; k++) xs.push(inner + outer * Math.pow(k / outerCols, 1.5));
    const ny = Math.ceil((y1 - y0) / stepY);
    const cols = xs.length;
    const pos = new Float32Array(cols * (ny + 1) * 3);
    const col = new Float32Array(cols * (ny + 1) * 3);
    const uvs = new Float32Array(cols * (ny + 1) * 2);
    const E = new Float32Array(cols * (ny + 1));
    for (let j = 0; j <= ny; j++) {
      const sy = y0 + (j * (y1 - y0)) / ny;
      for (let i = 0; i < cols; i++) {
        const sx = xs[i];
        const k = j * cols + i;
        // The silhouette narrows into a peak: nothing rises above the summit ridge line.
        const ridge = -WORLD_HEIGHT - 70 + Math.max(0, Math.abs(sx) - 70) * 1.15;
        const vy = Math.max(sy, ridge);
        const e = Math.abs(sx) - w.halfWidth(vy);
        pos[k * 3] = sx;
        pos[k * 3 + 1] = -vy;
        pos[k * 3 + 2] = this.surfaceZ(sx, vy) + zOffset;
        uvs[k * 2] = sx / 170;
        uvs[k * 2 + 1] = -vy / 170;
        const c = this.rockColor(sx, vy, e);
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
        E[k] = e;
      }
    }
    const idx = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i;
        idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const seed = w.seed;
    for (let k = 0; k < cols * (ny + 1); k++) {
      const sx = pos[k * 3];
      const sy = -pos[k * 3 + 1];
      const amt = this.snowAmount(sx, sy, E[k]);
      if (amt <= 0) continue;
      const up = nrm.getY(k);
      const n = fbm2(sx * 0.02, sy * 0.03, seed + 31, 2);
      const kk = clamp((up + n * 0.6 - (1 - amt)) * 5, 0, 0.95);
      if (kk > 0) {
        col[k * 3] = lerp(col[k * 3], 0.86, kk);
        col[k * 3 + 1] = lerp(col[k * 3 + 1], 0.9, kk);
        col[k * 3 + 2] = lerp(col[k * 3 + 2], 0.97, kk);
      }
    }
    const mesh = new THREE.Mesh(geo, this.mats.rock);
    mesh.receiveShadow = true;
    mesh.userData.own = true;
    return { mesh, inner };
  }

  buildFarMountain() {
    if (this.farMountain) {
      this.scene.remove(this.farMountain);
      this.farMountain.geometry.dispose();
    }
    const { mesh } = this.buildWallMesh(-WORLD_HEIGHT - 420, 40, 60, 45, 14, -26);
    mesh.receiveShadow = false;
    this.farMountain = mesh;
    this.scene.add(mesh);
  }

  buildChunk(ci) {
    const w = this.world;
    const y0 = ci * CH; // sim y of chunk top (more negative is higher)
    const y1 = y0 + CH;
    const { mesh, inner: xw } = this.buildWallMesh(y0, y1, STEP, STEP, 16, 0);
    const group = new THREE.Group();
    group.add(mesh);

    // holds
    const holds = [];
    for (const h of w.holdsNear(0, (y0 + y1) / 2, Math.hypot(xw, CH / 2) + 10)) {
      if (h.y < y0 || h.y >= y1 || h.type === 'ledge') continue;
      const m = this.makeHold(h);
      group.add(m);
      holds.push(h);
      this.holdMeshes.set(h, m);
    }
    // cracks
    for (const cr of w.cracks) {
      const p0 = cr.pts[0];
      if (p0.y < y0 || p0.y >= y1) continue;
      const pts = cr.pts.map((p) => new THREE.Vector3(p.x, -p.y, this.surfaceZ(p.x, p.y) + 0.6));
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 2, 1.4, 4, false), this.mats.dark);
      tube.userData.own = true;
      group.add(tube);
    }
    // ledges
    for (const l of w.ledges) {
      if (l.ground || l.y < y0 || l.y >= y1) continue;
      group.add(this.makeLedge(l));
    }
    this.scene.add(group);
    return { group, holds, ci };
  }

  holdMat(color) {
    this.holdMats = this.holdMats || new Map();
    const key = color.getHex();
    let m = this.holdMats.get(key);
    if (!m) {
      m = this.mats.holdLight.clone();
      m.color = color;
      this.holdMats.set(key, m);
    }
    return m;
  }

  makeHold(h) {
    const z = this.surfaceZ(h.x, h.y);
    const zb = zoneBlend(h.y);
    let m;
    const lc = h.loose ? [175, 120, 90] : zb.light;
    const lightCol = col3([Math.round(lc[0] / 8) * 8, Math.round(lc[1] / 8) * 8, Math.round(lc[2] / 8) * 8]);
    switch (h.type) {
      case 'jug':
      case 'sloper': {
        m = new THREE.Mesh(h.type === 'jug' ? this.geo.jug : this.geo.sloper, this.holdMat(lightCol));
        break;
      }
      case 'crimp': {
        m = new THREE.Mesh(this.geo.crimp, this.holdMat(lightCol));
        break;
      }
      case 'pocket': {
        m = new THREE.Group();
        m.add(new THREE.Mesh(this.geo.pocketRim, this.holdMat(lightCol)));
        const hole = new THREE.Mesh(this.geo.pocketHole, this.mats.dark);
        hole.position.z = 0.8;
        m.add(hole);
        break;
      }
      case 'crack':
        m = new THREE.Mesh(this.geo.crack, this.mats.dark);
        break;
      case 'ice':
        m = new THREE.Mesh(this.geo.ice, this.mats.ice);
        break;
      default:
        m = new THREE.Mesh(this.geo.jug, this.mats.holdLight);
    }
    m.position.set(h.x, -h.y, z + (h.type === 'crack' ? 0.5 : 1.5));
    m.rotation.z = -(h.angle || 0);
    const s = h.s || 1;
    m.scale.set(s, s, s);
    m.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    return m;
  }

  makeLedge(l) {
    const g = new THREE.Group();
    const zb = zoneBlend(l.y);
    const w = l.x2 - l.x1 + 16;
    const cx = (l.x1 + l.x2) / 2;
    const z = this.surfaceZ(cx, l.y);
    const geo = new THREE.BoxGeometry(w, 16, 46, Math.ceil(w / 14), 2, 3);
    const p = geo.attributes.position;
    const r = mulberry32(l.id + 3);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 0) p.setY(i, y - r() * 10);
      p.setX(i, p.getX(i) + (r() - 0.5) * 3);
      if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) + (r() - 0.5) * 6);
    }
    geo.computeVertexNormals();
    const lmap = this.tex.rock.map.clone();
    const lnrm = this.tex.rock.normalMap.clone();
    for (const t of [lmap, lnrm]) {
      t.repeat.set(w / 120, 0.4);
      t.needsUpdate = true;
    }
    const mat = new THREE.MeshStandardMaterial({ color: col3(zb.light).lerp(col3(zb.rock), 0.4), flatShading: true, roughness: 0.95, map: lmap, normalMap: lnrm });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, -l.y - 8, z + 14);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.own = true;
    g.add(m);
    if (zb.snow > 0.2) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w - 4, 3, 40), this.mats.snow);
      s.position.set(cx, -l.y + 1, z + 14);
      s.receiveShadow = true;
      s.userData.own = true;
      g.add(s);
    }
    l.z3 = z + 14;
    if (l.bivouac !== undefined) {
      const props = new THREE.Group();
      props.name = 'props';
      g.add(props);
      l.props3 = props;
      l.propsState = '';
    }
    return g;
  }

  updateBivouacProps(game, l) {
    const props = l.props3;
    if (!props) return;
    const campOpen = game.state === 'camp' && game.camp && game.camp.ledge === l;
    const key = `${l.camped}|${l.cairn}|${campOpen}|${l.summit}`;
    const cx = (l.x1 + l.x2) / 2;
    const y = -l.y;
    const z = l.z3;
    if (key !== l.propsState) {
      l.propsState = key;
      while (props.children.length) props.remove(props.children[0]);
      const addCairn = (x, n) => {
        let yy = y;
        for (let i = 0; i < n; i++) {
          const s = new THREE.Mesh(this.geo.sphere, this.mats.stone);
          const w = 11 - i * 1.2;
          s.scale.set(w, 4.2 - i * 0.2, w * 0.8);
          yy += 4;
          s.position.set(x + Math.sin(i * 2.3) * 1.2, yy, z);
          yy += 3.5;
          s.castShadow = true;
          props.add(s);
        }
      };
      if (l.summit) {
        const pole = new THREE.Mesh(this.geo.box, this.mats.metal);
        pole.scale.set(1.5, 70, 1.5);
        pole.position.set(cx + 40, y + 35, z);
        props.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(30, 16, 6, 1), this.mats.flag);
        flag.position.set(cx + 55, y + 62, z);
        flag.name = 'flag';
        props.add(flag);
        addCairn(cx - 30, 7);
      } else {
        const ring = new THREE.Mesh(this.geo.ring, this.mats.metal);
        ring.scale.set(3, 3, 3);
        ring.position.set(cx, y + 8, z - 18);
        props.add(ring);
        for (let i = 0; i < 7; i++) {
          const st = new THREE.Mesh(this.geo.sphere, this.mats.stone);
          const a = (i / 7) * Math.PI * 2;
          st.scale.set(2.5, 2, 2.5);
          st.position.set(cx - 40 + Math.cos(a) * 7, y + 1.5, z + Math.sin(a) * 7);
          props.add(st);
        }
        if (l.camped) {
          const tent = new THREE.Mesh(new THREE.ConeGeometry(18, 26, 4), this.mats.tent);
          tent.position.set(cx + 50, y + 13, z - 4);
          tent.rotation.y = Math.PI / 4;
          tent.castShadow = true;
          props.add(tent);
        }
        if (campOpen) {
          const f1 = new THREE.Mesh(new THREE.ConeGeometry(5, 14, 6), this.mats.fire);
          f1.position.set(cx - 40, y + 7, z);
          f1.name = 'fire';
          props.add(f1);
          const f2 = new THREE.Mesh(new THREE.ConeGeometry(2.8, 9, 6), this.mats.fire2);
          f2.position.set(cx - 40, y + 5, z);
          f2.name = 'fire2';
          props.add(f2);
        }
        if (l.cairn) addCairn(cx + 12, 5);
      }
    }
    const t = game.stats.playTime;
    const f = props.getObjectByName('fire');
    if (f) f.scale.y = 1 + Math.sin(t * 13) * 0.2;
    const flag = props.getObjectByName('flag');
    if (flag) {
      const p = flag.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        p.setZ(i, Math.sin(t * 5 + x * 0.3) * (x + 15) * 0.12);
      }
      p.needsUpdate = true;
    }
  }

  // ---- climber -------------------------------------------------------------------------------------
  buildClimber() {
    this.model = new ClimberModel(this.scene);
  }

  // Build the skeleton for the climbing pose from the 2D simulation and pose the model.
  updateClimber(game) {
    const c = game.climber;
    let sx = 0;
    let sy = 0;
    if (c.shake > 0 && c.state === 'climb') {
      sx = (Math.random() - 0.5) * c.shake * 1.6;
      sy = (Math.random() - 0.5) * c.shake * 1.6;
    }
    const Cx = c.C.x + sx;
    const Cy = c.C.y + sy;
    const bodyZ = this.surfaceZ(Cx, Cy) + 17;
    const V = (x, y, z) => new THREE.Vector3(x, -y, z);
    const pelvis = V(Cx, Cy + 16, bodyZ - 1);
    const chest = V(Cx, Cy - 17, bodyZ + 1);
    const U = new THREE.Vector3().subVectors(chest, pelvis).normalize();
    const F = new THREE.Vector3(0, 0, -1).addScaledVector(U, -U.z).normalize();
    const R = new THREE.Vector3().crossVectors(F, U).normalize();
    const head = V(Cx, Cy - 34, bodyZ + 0.5);
    // look at the hold a limb is reaching for, otherwise up the wall
    let look = new THREE.Vector3(0, 0.45, -1);
    const moving = c.limbs.find((l) => l.state === 'moving');
    const target = moving ? moving.move.hold : c.state === 'fall' ? null : null;
    if (target) {
      const tp = V(target.x, target.y, this.surfaceZ(target.x, target.y));
      look = tp.sub(head).normalize().multiplyScalar(0.7).add(new THREE.Vector3(0, 0, -0.6)).normalize();
    }
    if (c.state === 'fall' || c.state === 'rope') look = new THREE.Vector3(0, -0.2, 1);
    const limbs = c.limbs.map((l) => {
      const r = c.root(l);
      r.x += sx;
      r.y += sy;
      const j = ik2(r.x, r.y, l.end.x, l.end.y, l.l1, l.l2, l.side);
      const grip = l.state === 'grip';
      const endZ = grip ? this.surfaceZ(l.end.x, l.end.y) + (l.hand ? 4 : 5) : bodyZ + (l.hand ? 2 : -2);
      const rootZ = bodyZ + (l.hand ? 0 : -2);
      const jz = (rootZ + endZ) / 2 + (l.hand ? 7 : 9);
      const dx = l.end.x - r.x;
      const dy = l.end.y - r.y;
      const d = Math.hypot(dx, dy);
      const max = l.l1 + l.l2;
      const ex = d > max ? r.x + (dx / d) * max : l.end.x;
      const ey = d > max ? r.y + (dy / d) * max : l.end.y;
      return {
        hand: l.hand, side: l.side, grip,
        root: V(r.x, r.y, rootZ), joint: V(j.x, j.y, jz), end: V(ex, ey, endZ),
        normal: grip ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-l.side, 0, 0.3),
        dir: grip ? new THREE.Vector3(l.side * 0.25, -0.2, -1) : new THREE.Vector3(0, -1, -0.5),
      };
    });
    this.model.pose({
      pelvis, chest, head, R, U, F, look, limbs,
      chalk: c.chalkTime > 0, night: this.r2.sky ? this.r2.sky.dl < 0.5 : false,
      sway: Math.sin(game.stats.playTime * 2) * 0.3 + sx * 0.2,
    });
    return { x: Cx, y: Cy, z: bodyZ };
  }

  buildPip() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.geo.sphere, this.mats.pip);
    body.scale.setScalar(8);
    body.castShadow = true;
    g.add(body);
    const visor = new THREE.Mesh(this.geo.sphere, this.mats.visor);
    visor.scale.set(5.6, 3.6, 3);
    visor.position.set(0, 1.5, 6.2);
    g.add(visor);
    for (const x of [-2, 2]) {
      const e = new THREE.Mesh(this.geo.box, this.mats.eye);
      e.scale.set(1.8, 1.8, 0.5);
      e.position.set(x, 2, 9);
      e.name = 'eye';
      g.add(e);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(8, 1.2, 6, 20), this.mats.orange);
    band.rotation.x = Math.PI / 2;
    band.position.y = -2;
    g.add(band);
    const mast = new THREE.Mesh(this.geo.box, this.mats.metal);
    mast.scale.set(1, 5, 1);
    mast.position.y = 10;
    g.add(mast);
    const prop = new THREE.Mesh(this.geo.box, new THREE.MeshStandardMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.7 }));
    prop.scale.set(20, 0.6, 2.5);
    prop.position.y = 12.5;
    prop.name = 'prop';
    g.add(prop);
    this.pip = g;
    this.scene.add(g);
  }

  // ---- sprites for pickups and fauna (drawn with the 2D renderer's icon code) ------------------------
  iconTexture(key, draw) {
    let tex = this.spriteTex.get(key);
    if (tex) return tex;
    const cv = document.createElement('canvas');
    cv.width = 96;
    cv.height = 96;
    const ctx = cv.getContext('2d');
    const saved = this.r2.ctx;
    this.r2.ctx = ctx;
    ctx.translate(48, 60);
    ctx.scale(3.2, 3.2);
    try {
      draw();
    } finally {
      this.r2.ctx = saved;
    }
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.spriteTex.set(key, tex);
    return tex;
  }

  updatePickups(game) {
    const cam = this.camTarget;
    game.world.pickups.forEach((p, i) => {
      if (p.spring) return;
      const near = Math.abs(-p.y - cam.y) < 700;
      let s = this.pickupSprites.get(i);
      if (!near || game.taken.has(i)) {
        if (s) s.visible = false;
        return;
      }
      if (!s) {
        const key = p.kind === 'flora' ? `f_${p.id}` : p.kind === 'relic' ? 'relic' : `i_${p.item}`;
        const tex = this.iconTexture(key, () => {
          if (p.kind === 'flora') this.r2.drawFlower(p.id, 0);
          else if (p.kind === 'relic') this.r2.drawRelic(0);
          else this.r2.drawItemIcon(p.item, 0, p);
        });
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        s.scale.set(30, 30, 1);
        const z = p.ledge && p.ledge.z3 !== undefined ? p.ledge.z3 : this.surfaceZ(p.x, p.y) + 4;
        s.position.set(p.x, -p.y + 6, z);
        this.scene.add(s);
        this.pickupSprites.set(i, s);
      }
      s.visible = true;
    });
  }

  updateFauna(game) {
    const t = game.stats.playTime;
    for (const f of game.faunaState) {
      let s = this.faunaSprites.get(f.id);
      if (!s) {
        const cv = document.createElement('canvas');
        cv.width = 128;
        cv.height = 128;
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        s.userData.cv = cv;
        s.scale.set(56, 56, 1);
        this.scene.add(s);
        this.faunaSprites.set(f.id, s);
      }
      s.visible = f.visible;
      if (!f.visible) continue;
      // redraw animated sprite
      const cv = s.userData.cv;
      const ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 128, 128);
      const saved = this.r2.ctx;
      this.r2.ctx = ctx;
      ctx.translate(64, 84);
      ctx.scale(2.2, 2.2);
      const fake = { stats: { playTime: t }, journal: game.journal, faunaState: [{ ...f, px: 0, py: 0 }] };
      try {
        this.r2.drawFauna(fake);
      } finally {
        this.r2.ctx = saved;
      }
      s.material.map.needsUpdate = true;
      const z = f.kind === 'ledge' && f.home && f.home.z3 !== undefined ? f.home.z3 : this.surfaceZ(f.px, f.py) + (f.kind === 'fly' ? 60 : 6);
      s.position.set(f.px, -f.py + 12, z);
    }
  }

  updateRope(game, climberPos) {
    const c = game.climber;
    // Unclipped while strolling around: the rope stays coiled on the pack.
    const strolling = climberPos.walker && game.explore.z > 12;
    if (this.ropeMesh) this.ropeMesh.visible = !strolling;
    if (strolling) return;
    const pts = game.anchors.map((a) => new THREE.Vector3(a.x, -a.y, this.surfaceZ(a.x, a.y) + 3));
    pts.push(new THREE.Vector3(climberPos.x, -(climberPos.y + 16), climberPos.z));
    const all = [];
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = a.distanceTo(b);
        const taut = (c.state === 'rope' || c.state === 'fall') && i === pts.length - 1;
        const sag = taut ? 0 : Math.min(26, len * 0.12);
        all.push(new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2 - sag, (a.z + b.z) / 2 + 4));
      }
      all.push(pts[i]);
    }
    const curve = new THREE.CatmullRomCurve3(all);
    const geo = new THREE.TubeGeometry(curve, Math.min(300, all.length * 10), 0.9, 4, false);
    if (this.ropeMesh) {
      this.ropeMesh.geometry.dispose();
      this.ropeMesh.geometry = geo;
    } else {
      this.ropeMesh = new THREE.Mesh(geo, this.mats.rope);
      this.ropeMesh.castShadow = true;
      this.scene.add(this.ropeMesh);
    }
    // pitons
    const seen = new Set();
    for (const p of game.placedPitons) {
      if (p.retrieved) continue;
      seen.add(p);
      if (!this.pitonMeshes.has(p)) {
        const g = new THREE.Group();
        const spike = new THREE.Mesh(this.geo.box, this.mats.metal);
        spike.scale.set(7, 1.6, 1.6);
        g.add(spike);
        const ring = new THREE.Mesh(this.geo.ring, this.mats.metal);
        ring.scale.setScalar(2.6);
        ring.position.set(3, -2, 1.5);
        g.add(ring);
        g.position.set(p.x, -p.y, this.surfaceZ(p.x, p.y) + 2);
        this.pitonGroup.add(g);
        this.pitonMeshes.set(p, g);
      }
    }
    for (const [p, m] of this.pitonMeshes) {
      if (!seen.has(p)) {
        this.pitonGroup.remove(m);
        this.pitonMeshes.delete(p);
      }
    }
  }

  updateRocks(game) {
    while (this.rockGroup.children.length < game.rocks.length) {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), this.mats.stone);
      m.castShadow = true;
      this.rockGroup.add(m);
    }
    this.rockGroup.children.forEach((m, i) => {
      const r = game.rocks[i];
      m.visible = !!r && r.warn <= 0;
      if (!m.visible) return;
      m.scale.setScalar(r.r);
      m.position.set(r.x, -r.y, this.surfaceZ(r.x, r.y) + 20);
      m.rotation.set(r.rot, r.rot * 0.7, 0);
    });
  }

  // ---- picking ------------------------------------------------------------------------------------
  toWorld(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.W) * 2 - 1, -(sy / this.H) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // intersect with a plane at the local wall depth near the camera target
    this.plane.constant = -this.surfaceZ(this.camTarget.x, -this.camTarget.y);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return { x: 0, y: 0 };
    // refine using the local surface depth
    for (let i = 0; i < 2; i++) {
      this.plane.constant = -this.surfaceZ(hit.x, -hit.y) - 2;
      this.raycaster.ray.intersectPlane(this.plane, hit);
    }
    return { x: hit.x, y: -hit.y };
  }

  toScreen(wx, wy, dz = 0) {
    const v = new THREE.Vector3(wx, -wy, this.surfaceZ(wx, wy) + dz).project(this.camera);
    return { x: (v.x + 1) / 2 * this.W, y: (1 - v.y) / 2 * this.H };
  }

  // ---- camera ------------------------------------------------------------------------------------------
  viewYaw() {
    return Math.atan2(this.camPos.x - this.camLook.x, this.camPos.z - this.camLook.z);
  }

  orbit(dx, dy) {
    if (this.camMode === 'walk') {
      this.walkYaw -= dx * 0.006;
      this.walkPitch = clamp(this.walkPitch + dy * 0.004, 0.02, 1.25);
    } else {
      this.userYaw = clamp(this.userYaw - dx * 0.004, -1.1, 1.1);
      this.userPitch = clamp(this.userPitch + dy * 0.003, -0.45, 0.7);
    }
  }

  // Walking pose: local (right, up, forward) around the feet position P with heading h.
  updateWalker(game, dt) {
    const ex = game.explore;
    const c = game.climber;
    const lg = ex.ledge;
    let x = ex.x;
    let y;
    let z;
    if (lg.ground) {
      z = this.env.zOff(x) + ex.z;
      y = this.env.groundHeight(x, z);
    } else {
      z = this.surfaceZ(x, c.C.y) + 17 + ex.z;
      y = -lg.y;
    }
    this.walkAmp = lerp(this.walkAmp || 0, ex.walking ? 1 : 0, Math.min(1, dt * 8));
    const a = this.walkAmp;
    const run = ex.speed > 180 ? 1.4 : 1;
    const h = ex.heading;
    const F = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
    const R = new THREE.Vector3(-F.z, 0, F.x);
    const bob = Math.abs(Math.sin(ex.phase)) * 1.8 * a;
    const P = new THREE.Vector3(x, y + bob, z);
    const L = (lx, ly, lz) => P.clone().addScaledVector(R, lx).addScaledVector(F, lz).setY(P.y + ly);
    const lean = a * (run > 1 ? 5 : 2);
    const U = new THREE.Vector3(0, 1, 0).addScaledVector(F, lean * 0.012).normalize();
    const limbs = c.limbs.map((l) => {
      const s = l.side;
      const ph = ex.phase + (s > 0 ? Math.PI : 0);
      if (!l.hand) {
        const f = Math.sin(ph) * 16 * a * run;
        const lift = Math.max(0, Math.cos(ph)) * 7 * a;
        const j = ik2(0, 59, f, lift, l.l1, l.l2, 1);
        return { hand: false, side: s, grip: false, root: L(s * 8, 59, 0), joint: L(s * 8.5, j.y, j.x), end: L(s * 8, lift + 5, f), dir: F.clone().addScaledVector(R, s * 0.12) };
      }
      const f = -Math.sin(ph) * 13 * a * run;
      const j = ik2(0, 99, f, 52 + Math.abs(f) * 0.3, l.l1, l.l2, -1);
      return {
        hand: true, side: s, grip: false,
        root: L(s * 12, 99, lean * 0.8), joint: L(s * 14, j.y, j.x + lean * 0.5), end: L(s * 13.5, 52 + Math.abs(f) * 0.3, f + 3),
        normal: R.clone().multiplyScalar(-s), dir: F,
      };
    });
    this.model.pose({
      pelvis: L(0, 56, lean * 0.3), chest: L(0, 99, lean), head: L(0, 115, lean + 1), R, U, F,
      look: F.clone().add(new THREE.Vector3(0, -0.12, 0)), limbs,
      chalk: false, night: this.r2.sky ? this.r2.sky.dl < 0.5 : false,
      sway: Math.sin(ex.phase) * a * 0.6,
    });
    this.walker = { P, F, R };
    return { x, y: -(y + 81), z, walker: true };
  }

  updateCamera(game, dt, focus) {
    const c = game.climber;
    const r2 = this.r2;
    const ex = game.explore;
    const wantWalk = ex.active && (game.state === 'play' || game.state === 'camp');
    if (wantWalk && this.camMode !== 'walk') {
      this.walkYaw = this.viewYaw();
      this.walkPitch = 0.3;
    }
    this.camMode = wantWalk ? 'walk' : 'climb';
    let pos;
    let look;
    if (this.camMode === 'walk') {
      const d = 470 / (r2.zoomMul || 1);
      look = new THREE.Vector3(focus.x, focus.y + 78, focus.z);
      const p = this.walkPitch;
      pos = look.clone().add(new THREE.Vector3(Math.sin(this.walkYaw) * Math.cos(p) * d, Math.sin(p) * d, Math.cos(this.walkYaw) * Math.cos(p) * d));
      // keep the camera out of the rock and above the ground
      const wz = this.surfaceZ(pos.x, -pos.y) + 25;
      if (pos.z < wz) pos.z = wz;
      const gy = ex.ledge && ex.ledge.ground ? this.env.groundHeight(pos.x, pos.z) + 12 : -1e9;
      if (pos.y < gy) pos.y = gy;
    } else {
      const tx = r2.cam.x;
      const ty = -r2.cam.y;
      const tz = this.surfaceZ(tx, -ty);
      const dist = 520 / (r2.zoomMul || 1) * (c.state === 'fall' ? 1.2 : 1);
      if (game.state === 'summit') this.userYaw += dt * 0.1;
      const yaw = 0.22 + Math.sin(game.stats.playTime * 0.05) * 0.05 + this.userYaw;
      look = new THREE.Vector3(tx, ty + 25, tz);
      pos = new THREE.Vector3(tx + Math.sin(yaw) * dist, ty - 130 + this.userPitch * 420, tz + Math.cos(yaw) * dist);
      if (ty < 400) pos.y = Math.max(pos.y, this.env.groundHeight(pos.x, pos.z) + 25);
    }
    const k = 1 - Math.exp(-dt * 5);
    if (!this.camInit) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
      this.camInit = true;
    }
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camTarget.copy(this.camLook);
  }

  sunDirection(game) {
    const a = ((game.time - 6) / 14) * Math.PI;
    return new THREE.Vector3(-Math.cos(a) * 0.8, Math.sin(a) * 0.85 + 0.03, 0.62).normalize();
  }

  render(game, ui, dt) {
    this.setWorld(game.world);
    const c = game.climber;
    const r2 = this.r2;
    const walking = game.explore.active && (game.state === 'play' || game.state === 'camp');
    const cp = walking ? this.updateWalker(game, dt) : this.updateClimber(game);
    const focus = walking ? new THREE.Vector3(cp.x, -(cp.y + 81), cp.z) : new THREE.Vector3(c.C.x, -c.C.y, this.surfaceZ(c.C.x, c.C.y) + 17);
    this.focus = focus;
    this.updateCamera(game, dt, focus);
    const ty = this.camTarget.y;

    // chunks around the focus
    const center = Math.floor(-ty / CH);
    const needed = new Set();
    for (let ci = center - 3; ci <= center + 2; ci++) {
      if (ci * CH > 60) continue;
      needed.add(ci);
    }
    let budget = 1;
    for (const ci of needed) {
      if (!this.chunks.has(ci) && budget-- > 0) this.chunks.set(ci, this.buildChunk(ci));
    }
    for (const [ci, ch] of this.chunks) {
      if (ci < center - 5 || ci > center + 4) {
        this.disposeChunk(ch);
        this.chunks.delete(ci);
      }
    }
    for (const [h, m] of this.holdMeshes) {
      if (h.removed && m.visible) m.visible = false;
    }
    for (const l of game.world.ledges) if (l.props3 && Math.abs(-l.y - ty) < 900) this.updateBivouacProps(game, l);

    // sky, sun, moon, fog
    const sky = r2.skyColors(game);
    r2.sky = sky;
    const dl = sky.dl;
    const sunDir = this.sunDirection(game);
    this.env.update(game, this.camera, dt, sky, sunDir, focus);
    const fogCol = col3(sky.bot).lerp(new THREE.Color(0.01, 0.012, 0.03), (1 - dl) * 0.75);
    this.scene.fog.color.copy(fogCol);
    const altK = clamp(focus.y / 9000, 0, 1);
    this.scene.fog.density = (0.00011 - altK * 0.00006) * (1 + (1 - dl) * 1.5);
    const ibl = this.pickEnvironment(game, dl);
    this.hemi.intensity = (0.25 + dl * 0.9) * (ibl ? 0.8 : 1);
    this.hemi.color.copy(col3(sky.top).lerp(new THREE.Color(1, 0.97, 0.92), 0.82));
    this.hemi.groundColor.copy(col3([86, 96, 70]).lerp(new THREE.Color(0.02, 0.02, 0.04), 1 - dl));
    const moonlight = dl < 0.35;
    const lightDir = moonlight ? new THREE.Vector3(-sunDir.x, 0.8, 0.6).normalize() : sunDir;
    this.sun.intensity = moonlight ? 0.35 : dl * 2.6;
    this.sun.color.copy(moonlight ? new THREE.Color(0.55, 0.65, 1) : new THREE.Color(1, 0.94, 0.84).lerp(new THREE.Color(1, 0.55, 0.3), sky.dusk));
    this.sun.position.copy(focus).addScaledVector(lightDir, 900);
    this.sun.target.position.copy(focus);

    // headlamp at night
    const night = 1 - dl;
    this.headlamp.intensity = night > 0.3 ? night * 500 : 0;
    if (walking && this.walker) {
      const w = this.walker;
      this.headlamp.position.copy(w.P).add(new THREE.Vector3(0, 118, 0)).addScaledVector(w.F, 8);
      this.headlamp.target.position.copy(w.P).addScaledVector(w.F, 220);
    } else {
      this.headlamp.position.set(cp.x, -(cp.y - 36), cp.z + 12);
      const aim = ui && ui.mouse && ui.mouse.inside ? this.toWorld(ui.mouse.x, ui.mouse.y) : { x: cp.x, y: cp.y - 80 };
      this.headlamp.target.position.set(aim.x, -aim.y, this.surfaceZ(aim.x, aim.y));
    }
    const campL = game.state === 'camp' && game.camp ? game.camp.ledge : null;
    if (campL) {
      this.fireLight.position.set((campL.x1 + campL.x2) / 2 - 40, -campL.y + 12, campL.z3 + 6);
      this.fireLight.intensity = 900 * (0.85 + 0.15 * Math.sin(game.stats.playTime * 17));
    } else this.fireLight.intensity = 0;

    // Pip hovers by your shoulder
    const p = game.pip;
    if (walking && this.walker && p.mode === 'follow') {
      const w = this.walker;
      const t = game.stats.playTime;
      const target = w.P.clone().addScaledVector(w.R, -34).addScaledVector(w.F, -8).add(new THREE.Vector3(0, 108 + Math.sin(t * 1.9) * 5, 0));
      if (!this.pip3) this.pip3 = target.clone();
      this.pip3.lerp(target, Math.min(1, dt * 4));
    } else {
      const target = new THREE.Vector3(p.x, -p.y, this.surfaceZ(p.x, p.y) + 34);
      if (!this.pip3) this.pip3 = target.clone();
      this.pip3.lerp(target, Math.min(1, dt * 6));
    }
    this.pip.position.copy(this.pip3);
    this.pip.rotation.y = walking ? Math.atan2(this.camPos.x - this.pip3.x, this.camPos.z - this.pip3.z) : Math.sin(game.stats.playTime * 0.8) * 0.4;
    this.pip.getObjectByName('prop').rotation.y = game.stats.playTime * 30;
    this.pipLight.position.copy(this.pip.position);

    this.updateRope(game, cp);
    this.updatePickups(game);
    this.updateFauna(game);
    this.updateRocks(game);

    // hover ring and reach ring
    this.hoverRing.visible = false;
    this.reachRing.visible = false;
    if (ui && game.state === 'play') {
      if (ui.hoverHold) {
        const h = ui.hoverHold;
        this.hoverRing.visible = true;
        this.hoverRing.material = ui.hoverOk ? this.mats.hover : ui.hoverLunge ? this.mats.hoverLunge : this.mats.hoverBad;
        this.hoverRing.position.set(h.x, -h.y, this.surfaceZ(h.x, h.y) + 4);
        this.hoverRing.scale.setScalar(Math.max(8, h.r + 3));
      }
      if (ui.limb) {
        const r = c.root(ui.limb);
        this.reachRing.visible = true;
        this.reachRing.position.set(r.x, -r.y, cp.z);
        this.reachRing.scale.setScalar(ui.limb.reach);
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.renderOverlay(game, ui, dt, cp);
  }

  // Screen-space effects drawn on the (transparent) 2D canvas above the WebGL view.
  renderOverlay(game, ui, dt, cp) {
    const r2 = this.r2;
    const ctx = r2.ctx;
    ctx.setTransform(r2.dpr, 0, 0, r2.dpr, 0, 0);
    ctx.clearRect(0, 0, r2.W, r2.H);
    const savedToScreen = r2.toScreen;
    r2.toScreen = (x, y) => this.toScreen(x, y, 30);
    const projectV = (v) => {
      const q = v.clone().project(this.camera);
      return { x: (q.x + 1) / 2 * this.W, y: (1 - q.y) / 2 * this.H };
    };
    try {
      r2.drawWeather(game, dt);
      // stamina ring next to the climber
      const c = game.climber;
      const s = game.explore.active && this.walker ? projectV(this.walker.P.clone().add(new THREE.Vector3(0, 130, 0)).addScaledVector(this.walker.R, 26)) : this.toScreen(c.C.x + 26, c.C.y - 30, 20);
      const frac = c.stamina / 100;
      const cap = c.staminaMax / 100;
      const show = c.stamina < c.staminaMax - 0.5 || c.staminaRate < 0 || cap < 0.99;
      r2.staminaAlpha = lerp(r2.staminaAlpha || 0, show ? 1 : 0, 0.08);
      if (r2.staminaAlpha > 0.02 && c.state !== 'dead') {
        ctx.globalAlpha = r2.staminaAlpha;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = frac > 0.5 ? '#9be37c' : frac > 0.25 ? '#f3c74a' : '#f0553e';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 12, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(120,40,40,0.8)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 12, -Math.PI / 2 + cap * Math.PI * 2, Math.PI * 1.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (ui && ui.hoverLimb) {
        const e = this.toScreen(ui.hoverLimb.end.x, ui.hoverLimb.end.y, 4);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (ui && ui.limb) {
        const e = this.toScreen(ui.limb.end.x, ui.limb.end.y, 4);
        ctx.strokeStyle = 'rgba(255,230,120,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      // scanner rings
      for (const p of game.scanNearby()) {
        const q = this.toScreen(p.x, p.y - 4, 6);
        ctx.strokeStyle = `rgba(127,240,255,${0.3 + 0.2 * Math.sin(game.stats.playTime * 3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 18 + ((game.stats.playTime * 12) % 10), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const rk of game.rocks) {
        if (rk.warn > 0) {
          const q = this.toScreen(rk.x, c.C.y, 0);
          ctx.fillStyle = `rgba(200,180,150,${0.4 + 0.3 * Math.sin(game.stats.playTime * 20)})`;
          ctx.font = 'bold 22px system-ui';
          ctx.fillText('▼', q.x - 8, 30);
        }
      }
      if (this.pip3) r2.toScreen = () => projectV(this.pip3.clone().add(new THREE.Vector3(0, 14, 0)));
      r2.drawSpeech(game);
      r2.drawHammer(game);
      const vg = ctx.createRadialGradient(r2.W / 2, r2.H / 2, Math.min(r2.W, r2.H) * 0.35, r2.W / 2, r2.H / 2, Math.max(r2.W, r2.H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, r2.W, r2.H);
      if (c.shake > 0.3 && c.state === 'climb') {
        const a = (c.shake - 0.3) * 0.5 * (0.7 + 0.3 * Math.sin(game.stats.playTime * 8));
        const rg = ctx.createRadialGradient(r2.W / 2, r2.H / 2, Math.min(r2.W, r2.H) * 0.3, r2.W / 2, r2.H / 2, Math.max(r2.W, r2.H) * 0.7);
        rg.addColorStop(0, 'rgba(120,0,0,0)');
        rg.addColorStop(1, `rgba(140,10,10,${a})`);
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, r2.W, r2.H);
      }
    } finally {
      r2.toScreen = savedToScreen;
    }
  }
}

export { ZONES, zoneIndexAt, BODY, FLORA };
