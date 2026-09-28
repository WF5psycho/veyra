// Procedural, tileable surface textures generated at startup: a detail (albedo) map and a normal map
// for rock, meadow ground and snow. Everything is computed here, so there are no image files to license.
import * as THREE from '../vendor/three.module.min.js';

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2654435761) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Value noise that tiles with the given period (lattice cells per texture width).
function tileNoise(u, v, period, seed) {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const m = (n) => ((n % period) + period) % period;
  const a = hash(m(ix), m(iy), seed);
  const b = hash(m(ix + 1), m(iy), seed);
  const c = hash(m(ix), m(iy + 1), seed);
  const d = hash(m(ix + 1), m(iy + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function tileFbm(u, v, period, seed, oct) {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  for (let o = 0; o < oct; o++) {
    s += tileNoise(u, v, p, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return s / norm;
}

// Build a height field with `heightFn(u, v) -> { h, a }` (height and albedo), then derive normals.
function build(size, heightFn, strength) {
  const H = new Float32Array(size * size);
  const A = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = heightFn(x / size, y / size);
      H[y * size + x] = r.h;
      A[y * size + x] = r.a;
    }
  }
  const nrm = new Uint8Array(size * size * 4);
  const alb = new Uint8Array(size * size * 4);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nrm[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nrm[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nrm[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nrm[i + 3] = 255;
      const a = Math.max(0, Math.min(255, A[y * size + x] * 255));
      alb[i] = a;
      alb[i + 1] = a;
      alb[i + 2] = a;
      alb[i + 3] = 255;
    }
  }
  const mk = (data, color) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(alb, true), normalMap: mk(nrm, false) };
}

export function makeRockTextures(size = 512) {
  return build(size, (u, v) => {
    const base = tileFbm(u, v, 4, 11, 5);
    const ridge = 1 - Math.abs(tileFbm(u, v, 5, 17, 4) * 2 - 1);
    const mask = Math.max(0, tileFbm(u, v, 2, 19, 2) - 0.52) * 4;
    const cracks = Math.pow(ridge, 30) * Math.min(1, mask);
    const fine = tileFbm(u, v, 32, 23, 3);
    const strata = Math.sin((v + base * 0.25) * Math.PI * 2 * 7) * 0.5 + 0.5;
    const h = base * 0.9 + fine * 0.22 + strata * 0.06 - cracks * 0.35;
    const speck = hash(Math.floor(u * size), Math.floor(v * size), 5);
    const a = 0.86 + (base - 0.5) * 0.28 + (fine - 0.5) * 0.2 - cracks * 0.3 + (speck - 0.5) * 0.1 + strata * 0.04;
    return { h, a };
  }, 7);
}

export function makeGroundTextures(size = 256) {
  return build(size, (u, v) => {
    const clumps = tileFbm(u, v, 8, 41, 4);
    const blades = tileNoise(u * 1.0, v * 6.0, 64, 43);
    const pebbles = Math.pow(tileNoise(u, v, 24, 47), 6);
    const h = clumps * 0.6 + blades * 0.25 + pebbles * 0.6;
    const a = 0.82 + (clumps - 0.5) * 0.4 + (blades - 0.5) * 0.18 + pebbles * 0.25;
    return { h, a };
  }, 5);
}

export function makeSnowTextures(size = 256) {
  return build(size, (u, v) => {
    const drift = tileFbm(u, v, 3, 61, 4);
    const ripples = Math.sin((u * 0.4 + v + drift * 0.6) * Math.PI * 2 * 10) * 0.5 + 0.5;
    const sparkle = hash(Math.floor(u * size), Math.floor(v * size), 67);
    const h = drift * 0.8 + ripples * 0.12;
    const a = 0.94 + (drift - 0.5) * 0.08 + (sparkle > 0.985 ? 0.06 : 0);
    return { h, a };
  }, 3);
}
