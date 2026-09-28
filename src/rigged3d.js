// The climber as a downloaded, rigged character (KayKit Adventurers "Rogue" by Kay Lousberg, CC0),
// with a climbing helmet, pack and harness added on top.
// - Walking in the valley and around camp it plays the model's own animations (idle, walk, run, sit, cheer).
// - On the wall the bones are placed directly from the same small skeleton the simulation produces
//   (pelvis, chest, head and a root/joint/end per limb). The model has short, stylised limbs, so the
//   arm and leg bones are stretched along their length when a hold is further away than they reach.
import * as THREE from '../vendor/three.module.min.js';

const S = 52; // model units -> world units (about 114 tall, like the simulated climber)
const HEAD = 0.56; // the stylised head is very large; shrink it a little for a climber
const MANUAL = ['hips', 'spine', 'chest', 'head', 'upperarm.l', 'lowerarm.l', 'wrist.l', 'upperarm.r', 'lowerarm.r', 'wrist.r',
  'upperleg.l', 'lowerleg.l', 'foot.l', 'upperleg.r', 'lowerleg.r', 'foot.r'];
// the model faces +Z with its right hand towards -X
const REST_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));

export class RiggedClimber {
  constructor(scene, gltf) {
    const obj = gltf.scene;
    this.obj = obj;
    obj.updateMatrixWorld(true);
    this.bones = {};
    this.rest = {};
    obj.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // bones are moved far from the mesh's own origin while climbing
      }
    });
    // the loader strips dots from node names ('hand.l' -> 'handl')
    for (const n of [...MANUAL, 'hand.l', 'hand.r', 'toes.l', 'toes.r']) this.bones[n] = this.bones[n] || this.bones[n.replace('.', '')];
    for (const n in this.bones) this.rest[n] = this.bones[n].matrixWorld.clone();
    const pos = (n) => new THREE.Vector3().setFromMatrixPosition(this.rest[n]);
    this.hips0 = pos('hips');
    const chain = (a, b, c) => ({ a: pos(a), b: pos(b), c: pos(c), l1: pos(a).distanceTo(pos(b)) * S, l2: pos(b).distanceTo(pos(c)) * S });
    this.chains = {
      'hand.l': { names: ['upperarm.l', 'lowerarm.l', 'wrist.l'], tip: pos('hand.l'), ...chain('upperarm.l', 'lowerarm.l', 'wrist.l') },
      'hand.r': { names: ['upperarm.r', 'lowerarm.r', 'wrist.r'], tip: pos('hand.r'), ...chain('upperarm.r', 'lowerarm.r', 'wrist.r') },
      'foot.l': { names: ['upperleg.l', 'lowerleg.l', 'foot.l'], tip: pos('toes.l'), ...chain('upperleg.l', 'lowerleg.l', 'foot.l') },
      'foot.r': { names: ['upperleg.r', 'lowerleg.r', 'foot.r'], tip: pos('toes.r'), ...chain('upperleg.r', 'lowerleg.r', 'foot.r') },
    };
    scene.add(obj);

    this.mixer = new THREE.AnimationMixer(obj);
    this.acts = {};
    for (const a of gltf.animations) this.acts[a.name] = this.mixer.clipAction(a);
    this.current = null;
    this.manual = null;
    this.addGear();
    this.tmp = { m: new THREE.Matrix4(), m2: new THREE.Matrix4(), v: new THREE.Vector3(), v2: new THREE.Vector3(), q: new THREE.Quaternion() };
  }

  // Helmet with headlamp on the head, a pack with a rope coil on the back and a harness at the hips.
  // Sizes are in model units (1 = about 52 world units) since the gear hangs off the bones.
  addGear() {
    const std = (color, rough = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
    this.mats = {
      helmet: std(0xf08a24, 0.35),
      dark: std(0x2a2a2e, 0.6),
      lamp: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0, roughness: 0.2 }),
      pack: std(0x8a3b24, 0.85),
      packDark: std(0x5a2616, 0.9),
      rope: std(0xe0562e, 0.75),
      webbing: std(0xe7b53a, 0.7),
      metal: std(0xc9cfd6, 0.3, { metalness: 0.85 }),
    };
    const M = this.mats;
    const mesh = (geo, mat, parent, p, s = [1, 1, 1], r = [0, 0, 0]) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...p);
      m.scale.set(...s);
      m.rotation.set(...r);
      m.castShadow = true;
      m.frustumCulled = false;
      parent.add(m);
      return m;
    };
    const head = this.bones.head;
    // the head mesh spans y 0..0.95 above the head bone, radius about 0.55
    const dome = new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52);
    mesh(dome, M.helmet, head, [0, 0.46, -0.04], [0.62, 0.62, 0.66]);
    for (const x of [-0.18, 0, 0.18]) mesh(new THREE.BoxGeometry(0.06, 0.03, 0.3), M.dark, head, [x, 1.07, -0.06]);
    mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16), M.dark, head, [0, 0.72, 0.6], [1, 1, 1], [Math.PI / 2, 0, 0]);
    this.lamp = mesh(new THREE.CircleGeometry(0.075, 16), M.lamp, head, [0, 0.72, 0.645]);
    // pack on the chest bone, on the back (-Z): a rounded bag with a lid, straps and a rope coil
    const chest = this.bones.chest;
    const bag = new THREE.CapsuleGeometry(0.17, 0.12, 6, 14);
    mesh(bag, M.pack, chest, [0, 0.02, -0.3], [1.3, 1, 0.75]);
    mesh(new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.packDark, chest, [0, 0.19, -0.3], [1.15, 0.45, 0.8]);
    mesh(new THREE.TorusGeometry(0.13, 0.045, 8, 20), M.rope, chest, [0, -0.22, -0.3], [1.3, 1, 1], [Math.PI / 2, 0, 0]);
    for (const x of [-0.17, 0.17]) mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 16, Math.PI), M.packDark, chest, [x, 0.1, -0.1], [1, 1, 1.1], [0, Math.PI / 2, 0]);
    // harness around the hips with a few carabiners
    const hips = this.bones.hips;
    mesh(new THREE.TorusGeometry(0.4, 0.045, 8, 28), M.webbing, hips, [0, 0.08, 0], [1, 1, 0.85], [Math.PI / 2, 0, 0]);
    for (const a of [-2.3, -1.9, 1.9, 2.3]) {
      mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12), M.metal, hips, [Math.sin(a) * 0.41, -0.02, Math.cos(a) * 0.35], [1, 1.5, 1]);
    }
  }

  setManual(on) {
    if (this.manual === on) return;
    this.manual = on;
    for (const n of MANUAL) this.bones[n].matrixWorldAutoUpdate = !on;
    if (on) {
      this.mixer.stopAllAction();
      this.current = null;
    }
  }

  play(name, fade = 0.25, timeScale = 1) {
    const a = this.acts[name];
    if (!a) return;
    a.timeScale = timeScale;
    if (this.current === name) return;
    const prev = this.current && this.acts[this.current];
    a.reset().play();
    if (prev) a.crossFadeFrom(prev, fade, false);
    this.current = name;
  }

  // Walking and camp: the model's own animations. P is the point between the feet on the ground.
  animate(P, heading, st, dt) {
    this.setManual(false);
    this.obj.position.copy(P);
    this.obj.rotation.set(0, heading, 0);
    this.obj.scale.setScalar(S);
    if (st.cheer) this.play('Cheer');
    else if (st.sit) this.play('Sit_Floor_Idle', 0.5);
    else if (st.speed > 180) this.play('Running_A', 0.2, st.speed / 330);
    else if (st.speed > 8) this.play('Walking_A', 0.2, Math.max(0.6, st.speed / 120));
    else this.play('Idle', 0.35);
    this.mixer.update(dt);
    this.bones.head.scale.setScalar(HEAD);
    this.lamp.material.emissiveIntensity = st.night ? 2.2 : 0;
  }

  // Climbing: place the bones from the simulation skeleton (see ClimberModel.pose for the fields).
  pose(sk) {
    this.setManual(true);
    const t = this.tmp;
    // torso frame, re-orthonormalised
    const U = sk.U.clone().normalize();
    const F = sk.F.clone().addScaledVector(U, -sk.F.dot(U)).normalize();
    const R = new THREE.Vector3().crossVectors(F, U);
    const Q = new THREE.Matrix4().makeBasis(R, U, F).multiply(REST_BASIS);

    // the model's legs are short: move the torso a bit towards the feet (or hands) so the stretch
    // is shared between arms and legs instead of all going into one pair
    const shoulder = (P, local) => local.clone().sub(this.hips0).multiplyScalar(S).applyMatrix4(Q).add(P);
    const excess = (P, hand) => {
      let e = 0;
      for (const l of sk.limbs) {
        if (l.hand !== hand) continue;
        const ch = this.chains[this.key(l)];
        e = Math.max(e, shoulder(P, ch.a).distanceTo(l.end) - (ch.l1 + ch.l2));
      }
      return e;
    };
    let P = sk.pelvis.clone();
    const shift = THREE.MathUtils.clamp((excess(P, false) - excess(P, true)) * 0.5, -12, 16);
    P.addScaledVector(U, -shift);

    const Tt = new THREE.Matrix4().makeTranslation(P.x, P.y, P.z)
      .multiply(Q)
      .multiply(new THREE.Matrix4().makeScale(S, S, S))
      .multiply(new THREE.Matrix4().makeTranslation(-this.hips0.x, -this.hips0.y, -this.hips0.z));
    for (const n of ['hips', 'spine', 'chest']) this.bones[n].matrixWorld.multiplyMatrices(Tt, this.rest[n]);

    // head: turn towards where the climber looks (limited), pivoting at the neck
    const neck = new THREE.Vector3().setFromMatrixPosition(this.rest.head).applyMatrix4(Tt);
    const look = sk.look.clone().normalize();
    const lf = F.clone().lerp(look, 0.55).normalize();
    const lu = U.clone().addScaledVector(lf, -U.dot(lf)).normalize();
    const lr = new THREE.Vector3().crossVectors(lf, lu);
    const Qh = new THREE.Matrix4().makeBasis(lr, lu, lf).multiply(REST_BASIS);
    this.placeRigid('head', neck, Qh, S * HEAD);

    for (const l of sk.limbs) this.poseLimb(l, Tt, R);

    // bones not placed here (hands, toes, slots) follow their parents when the scene updates
    this.lamp.material.emissiveIntensity = sk.night ? 2.2 : 0;
  }

  key(l) {
    return (l.hand ? 'hand.' : 'foot.') + (l.side > 0 ? 'r' : 'l');
  }

  // world = T(p) * Qw * scale * restRotation, i.e. the bone keeps its rest orientation relative to Qw
  placeRigid(name, p, Qw, scale) {
    const r = this.tmp.m2.copy(this.rest[name]).setPosition(0, 0, 0);
    this.bones[name].matrixWorld.makeTranslation(p.x, p.y, p.z).multiply(Qw).multiply(this.tmp.m.makeScale(scale, scale, scale)).multiply(r);
  }

  // A bone from a to b: rotate its rest direction onto the new one (minimal twist relative to the
  // torso frame) and stretch it along that direction by k.
  placeSegment(name, aRest, bRest, Tq, a, b, k) {
    const d0 = bRest.clone().sub(aRest).normalize().transformDirection(Tq);
    const d1 = b.clone().sub(a).normalize();
    const rot = new THREE.Matrix4().makeRotationFromQuaternion(this.tmp.q.setFromUnitVectors(d0, d1));
    // stretch along d1: I + (k - 1) d1 d1^T
    const e = new THREE.Matrix4().set(
      1 + (k - 1) * d1.x * d1.x, (k - 1) * d1.x * d1.y, (k - 1) * d1.x * d1.z, 0,
      (k - 1) * d1.y * d1.x, 1 + (k - 1) * d1.y * d1.y, (k - 1) * d1.y * d1.z, 0,
      (k - 1) * d1.z * d1.x, (k - 1) * d1.z * d1.y, 1 + (k - 1) * d1.z * d1.z, 0,
      0, 0, 0, 1,
    );
    const lin = e.multiply(rot).multiply(new THREE.Matrix4().extractRotation(Tq)).multiply(new THREE.Matrix4().makeScale(S, S, S));
    const r = this.tmp.m2.copy(this.rest[name]).setPosition(0, 0, 0);
    this.bones[name].matrixWorld.makeTranslation(a.x, a.y, a.z).multiply(lin).multiply(r);
  }

  poseLimb(l, Tt, R) {
    const ch = this.chains[this.key(l)];
    const [n1, n2, n3] = ch.names;
    const A = ch.a.clone().applyMatrix4(Tt);
    const E = l.end.clone();
    const toE = E.clone().sub(A);
    let D = toE.length();
    if (D < 1e-3) {
      toE.set(0, -1, 0);
      D = 1e-3;
    }
    const dir = toE.clone().divideScalar(D);
    const k = Math.min(2.4, Math.max(1, D / ((ch.l1 + ch.l2) * 0.985)));
    const L1 = ch.l1 * k;
    const L2 = ch.l2 * k;
    const reach = Math.min(D, L1 + L2 - 1e-3);
    // bend towards the simulation's elbow/knee
    const pole = l.joint.clone().sub(A);
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-4) pole.copy(R).multiplyScalar(l.side).addScaledVector(dir, -R.dot(dir) * l.side);
    pole.normalize();
    const cosA = THREE.MathUtils.clamp((L1 * L1 + reach * reach - L2 * L2) / (2 * L1 * reach), -1, 1);
    const B = A.clone().addScaledVector(dir, L1 * cosA).addScaledVector(pole, L1 * Math.sqrt(1 - cosA * cosA));
    const C = A.clone().addScaledVector(dir, reach);
    this.placeSegment(n1, ch.a, ch.b, Tt, A, B, k);
    this.placeSegment(n2, ch.b, ch.c, Tt, B, C, k);
    // wrist / ankle: hands carry on along the forearm, bent towards the wall when gripping;
    // feet point along the limb's dir
    const ld = l.dir.clone().normalize();
    const aim = l.hand ? C.clone().sub(B).normalize().lerp(ld, l.grip ? 0.6 : 0.25).normalize() : ld.addScaledVector(dir, 0.3).normalize();
    this.placeSegment(n3, ch.c, ch.tip, Tt, C, C.clone().add(aim), 1);
  }

  dispose() {
    this.obj.parent?.remove(this.obj);
    this.mixer.stopAllAction();
  }
}
