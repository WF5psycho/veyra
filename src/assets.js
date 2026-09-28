// Loads the few bundled binary assets (models, HDRI lighting). In the single-file build they are
// inlined as base64 in window.__VEYRA_ASSETS; in development they are fetched from assets/.
import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { EXRLoader } from '../vendor/jsm/loaders/EXRLoader.js';

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function loadBuffer(name) {
  const inline = typeof window !== 'undefined' && window.__VEYRA_ASSETS && window.__VEYRA_ASSETS[name];
  if (inline) return base64ToBuffer(inline);
  const res = await fetch(`assets/${name}`);
  if (!res.ok) throw new Error(`Could not load assets/${name} (${res.status})`);
  return res.arrayBuffer();
}

export async function loadGLTF(name) {
  const buf = await loadBuffer(name);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', resolve, reject));
}

// Equirectangular HDR texture from an EXR file, ready for PMREM.
export async function loadEXR(name) {
  const buf = await loadBuffer(name);
  const d = new EXRLoader().setDataType(THREE.HalfFloatType).parse(buf);
  const tex = new THREE.DataTexture(d.data, d.width, d.height, d.format, d.type);
  tex.colorSpace = d.colorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}
