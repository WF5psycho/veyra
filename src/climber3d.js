// The climber's 3D model, built from code: sculpted torso, tapered limbs, hands with fingers,
// helmet with headlamp, harness and gear, pack with rope, climbing shoes.
// pose(sk) places everything from a small skeleton computed by the renderer (climbing or walking).
import * as THREE from '../vendor/three.module.min.js';

const srgb = (hex) => new THREE.Color(hex);
const UP = new THREE.Vector3(0, 1, 0);

// A unit segment along +Y from 0 to 1, tapering from rBottom to rTop (scaled per frame).
function taper(rBottom, rTop, radial = 12) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, 1, radial, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

export class ClimberModel {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const std = (color, rough = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color: srgb(color), roughness: rough, ...extra });
    this.m = {
      skin: std(0xd8a68a, 0.7),
      chalk: std(0xf2efe8, 0.95),
      jacket: std(0x2e8a8f, 0.72),
      jacketDark: std(0x1f5f63, 0.8),
      pants: std(0x3a4252, 0.9),
      patch: std(0x2b303b, 0.95),
      shoe: std(0xd2552f, 0.6),
      rubber: std(0x1d1b1a, 0.9),
      helmet: std(0xf08a24, 0.35),
      helmetDark: std(0x2a2a2e, 0.6),
      lamp: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0, roughness: 0.2 }),
      webbing: std(0xe7b53a, 0.7),
      webbingDark: std(0x3b3f4a, 0.8),
      metal: std(0xc9cfd6, 0.3, { metalness: 0.85 }),
      rope: std(0xe0562e, 0.75),
      pack: std(0x8a3b24, 0.85),
      packDark: std(0x5a2616, 0.9),
      hair: std(0x4a2d1e, 0.85),
      eye: std(0x1b1b1f, 0.3),
      bag: std(0xb8302f, 0.8),
    };
    const add = (geo, mat, cast = true) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    const M = this.m;

    // torso: lathe profile from pelvis (y=0) to shoulders (y=1), elliptical cross-section
    const prof = [[0.0, 0.0], [0.62, 0.0], [0.7, 0.08], [0.66, 0.22], [0.58, 0.38], [0.62, 0.55], [0.74, 0.72], [0.8, 0.86], [0.7, 0.96], [0.36, 1.02], [0.0, 1.03]];
    const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 18);
    this.torso = add(lathe, M.jacket);
    this.hips = add(new THREE.SphereGeometry(1, 16, 10), M.pants);
    this.zip = add(new THREE.BoxGeometry(0.06, 0.8, 0.04), M.jacketDark, false);
    this.collar = add(new THREE.TorusGeometry(1, 0.35, 8, 18), M.jacketDark);
    this.neck = add(taper(1, 0.95), M.skin);

    // head
    this.head = new THREE.Group();
    this.group.add(this.head);
    const h = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.castShadow = true;
      this.head.add(mesh);
      return mesh;
    };
    const sph = new THREE.SphereGeometry(1, 18, 14);
    h(sph, M.skin, 0, 0, 0.6, 6.6, 7.8, 6.6); // face/skull
    h(sph, M.skin, 0, -3.6, 2.2, 4.6, 3.4, 4.2); // jaw
    h(new THREE.ConeGeometry(0.9, 2.4, 8), M.skin, 0, 0.2, 6.9, 1, 1, 1).rotation.x = Math.PI / 2; // nose
    h(sph, M.eye, -2.3, 1.6, 6.0, 0.75, 0.75, 0.5);
    h(sph, M.eye, 2.3, 1.6, 6.0, 0.75, 0.75, 0.5);
    h(sph, M.skin, -6.4, 0.2, 0.6, 1.1, 1.8, 0.9);
    h(sph, M.skin, 6.4, 0.2, 0.6, 1.1, 1.8, 0.9);
    h(sph, M.hair, 0, 0.8, -1.4, 6.9, 7.6, 6.2); // hair at the back
    // helmet: shell, rim, vents, lamp
    const shell = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
    h(shell, M.helmet, 0, 2.6, 0.4, 8.1, 7.4, 8.4);
    const rim = h(new THREE.TorusGeometry(8.05, 0.55, 6, 28), M.helmetDark, 0, 2.3, 0.4, 1, 1, 1.04);
    rim.rotation.x = Math.PI / 2;
    for (const vx of [-3, 0, 3]) h(new THREE.BoxGeometry(1.2, 0.5, 4), M.helmetDark, vx, 9.6, -0.5);
    h(new THREE.BoxGeometry(3.4, 2, 1.6), M.helmetDark, 0, 5.6, 8.1);
    this.lampLens = h(new THREE.CylinderGeometry(0.9, 0.9, 0.5, 12), M.lamp, 0, 5.6, 9.0);
    this.lampLens.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) h(new THREE.BoxGeometry(0.4, 7, 0.6), M.helmetDark, s * 6.2, -2.4, 2.4).rotation.z = s * 0.12;
    // ponytail (swings)
    this.pony = add(taper(1.6, 0.7), M.hair);

    // backpack + rope coil + straps
    this.pack = add(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), M.pack);
    this.packLid = add(new THREE.CylinderGeometry(1, 1, 1, 14, 1), M.packDark);
    this.ropeCoil = add(new THREE.TorusGeometry(1, 0.28, 8, 22), M.rope);
    this.straps = [0, 1].map(() => add(new THREE.BoxGeometry(1, 1, 1), M.webbingDark, false));

    // harness: waist belt, leg loops, belay loop, gear, chalk bag
    this.belt = add(new THREE.TorusGeometry(1, 0.16, 6, 24), M.webbing);
    this.legLoops = [0, 1].map(() => add(new THREE.TorusGeometry(1, 0.2, 6, 18), M.webbing));
    this.belay = add(new THREE.TorusGeometry(1.8, 0.45, 6, 12), M.webbingDark);
    this.biners = [0, 1, 2, 3].map(() => add(new THREE.TorusGeometry(1.3, 0.28, 6, 12), M.metal));
    this.chalkBag = add(new THREE.CylinderGeometry(3, 2.6, 5.5, 12), M.bag);
    this.chalkRim = add(new THREE.TorusGeometry(3, 0.45, 6, 16), M.chalk);

    // limbs
    this.limbs = [0, 1, 2, 3].map((i) => {
      const arm = i < 2;
      const o = {
        upper: add(arm ? taper(3.8, 3.3) : taper(5.8, 4.6), arm ? M.jacket : M.pants),
        lower: add(arm ? taper(3.2, 2.4) : taper(4.4, 3.1), arm ? M.jacket : M.pants),
        j0: add(new THREE.SphereGeometry(1, 12, 10), arm ? M.jacket : M.pants),
        j1: add(new THREE.SphereGeometry(1, 12, 10), arm ? M.jacket : M.pants),
        cuff: add(new THREE.CylinderGeometry(1, 1, 1, 12), arm ? M.jacketDark : M.patch),
      };
      if (arm) {
        const hand = new THREE.Group();
        this.group.add(hand);
        const palm = new THREE.Mesh(new THREE.BoxGeometry(4.6, 4.8, 2.2), M.skin);
        palm.position.y = 2.4;
        palm.castShadow = true;
        hand.add(palm);
        const fingers = [];
        for (let f = 0; f < 4; f++) {
          const base = new THREE.Group();
          base.position.set(-1.7 + f * 1.13, 4.8, 0);
          hand.add(base);
          const seg1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.6, 3, 6), M.skin);
          seg1.position.y = 1.1;
          base.add(seg1);
          const knuckle = new THREE.Group();
          knuckle.position.y = 2.1;
          base.add(knuckle);
          const seg2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 1.3, 3, 6), M.skin);
          seg2.position.y = 0.9;
          knuckle.add(seg2);
          fingers.push({ base, knuckle, meshes: [seg1, seg2] });
        }
        const thumb = new THREE.Group();
        thumb.position.set(2.3, 1.8, 0.4);
        hand.add(thumb);
        const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 2, 3, 6), M.skin);
        t1.position.y = 1.3;
        thumb.add(t1);
        o.hand = { group: hand, palm, fingers, thumb, meshes: [palm, t1, ...fingers.flatMap((f) => f.meshes)] };
      } else {
        const foot = new THREE.Group();
        this.group.add(foot);
        const upper = new THREE.Mesh(new THREE.CapsuleGeometry(2.3, 7, 4, 10), M.shoe);
        upper.rotation.x = Math.PI / 2;
        upper.scale.set(1.05, 1, 0.8);
        upper.position.set(0, 1.6, 2.6);
        upper.castShadow = true;
        foot.add(upper);
        const sole = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1, 11.5), M.rubber);
        sole.position.set(0, -0.2, 2.6);
        foot.add(sole);
        const rand = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.rubber);
        rand.position.set(0, 1.1, 7.2);
        rand.rotation.x = -Math.PI / 2;
        foot.add(rand);
        o.foot = { group: foot };
      }
      return o;
    });
    this.tmp = { q: new THREE.Quaternion(), m: new THREE.Matrix4(), v: new THREE.Vector3() };
  }

  // Place a tapered segment from a to b.
  seg(mesh, a, b, scale = 1) {
    const d = this.tmp.v.subVectors(b, a);
    const len = d.length();
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / (len || 1)));
    mesh.scale.set(scale, len, scale);
  }

  // Orient an object with basis (x = right, y = up, z = forward).
  // (Mirrored bases are flipped on x so the result is always a proper rotation.)
  basis(obj, R, U, F) {
    const x = this.tmp.v.copy(R);
    if (new THREE.Vector3().crossVectors(R, U).dot(F) < 0) x.negate();
    this.tmp.m.makeBasis(x, U, F);
    obj.quaternion.setFromRotationMatrix(this.tmp.m);
  }

  // sk: { pelvis, chest, R, U, F, head, look, limbs: [{ hand, side, root, joint, end, grip, dir, normal }], chalk, night, t, sway }
  pose(sk) {
    const { R, U, F } = sk;
    const at = (base, x, y, z) => base.clone().addScaledVector(R, x).addScaledVector(U, y).addScaledVector(F, z);
    const torsoLen = sk.chest.distanceTo(sk.pelvis) + 6;

    // torso and hips
    this.torso.position.copy(at(sk.pelvis, 0, -4, 0));
    this.basis(this.torso, R, U, F);
    this.torso.scale.set(14, torsoLen, 9.5);
    this.hips.position.copy(at(sk.pelvis, 0, -1, 0));
    this.basis(this.hips, R, U, F);
    this.hips.scale.set(11.5, 8, 8);
    this.zip.position.copy(at(sk.pelvis, 0, torsoLen * 0.52, 7.6));
    this.basis(this.zip, R, U, F);
    this.zip.scale.set(8, torsoLen, 8);
    this.collar.position.copy(at(sk.chest, 0, 3.2, 0.5));
    this.basis(this.collar, R, F.clone().negate(), U);
    this.collar.scale.set(5.2, 4.6, 4);
    this.seg(this.neck, at(sk.chest, 0, 2, 0.5), sk.head.clone().addScaledVector(U, -5), 2.6);

    // head looks towards sk.look
    const lookF = sk.look.clone().normalize();
    const lookR = new THREE.Vector3().crossVectors(lookF, U).normalize();
    const lookU = new THREE.Vector3().crossVectors(lookR, lookF).normalize();
    this.head.position.copy(sk.head);
    this.basis(this.head, lookR, lookU, lookF);
    this.m.lamp.emissiveIntensity = sk.night ? 3 : 0;
    // ponytail behind the head, swinging a little
    const ponyBase = sk.head.clone().addScaledVector(lookF, -6).addScaledVector(lookU, 1);
    const ponyEnd = ponyBase.clone().addScaledVector(U, -11).addScaledVector(F, -3 - Math.abs(sk.sway) * 2).addScaledVector(R, sk.sway * 3);
    this.seg(this.pony, ponyBase, ponyEnd);

    // backpack on the back
    this.pack.position.copy(at(sk.pelvis, 0, torsoLen * 0.55, -11.5));
    this.basis(this.pack, R, U, F);
    this.pack.scale.set(17, 25, 9);
    this.packLid.position.copy(at(sk.pelvis, 0, torsoLen * 0.55 + 13, -11.5));
    this.basis(this.packLid, U.clone().negate(), R, F);
    this.packLid.scale.set(4.6, 17, 4.6);
    this.ropeCoil.position.copy(at(sk.pelvis, 0, torsoLen * 0.5, -16.5));
    this.basis(this.ropeCoil, R, U, F);
    this.ropeCoil.scale.set(6.5, 6.5, 6.5);
    this.straps.forEach((s, i) => {
      const side = i ? 1 : -1;
      s.position.copy(at(sk.pelvis, side * 6.5, torsoLen * 0.7, 6.8));
      this.basis(s, R, U, F);
      s.scale.set(2.2, 16, 0.8);
    });

    // harness
    this.belt.position.copy(at(sk.pelvis, 0, 2.5, 0));
    this.basis(this.belt, R, F.clone().negate(), U);
    this.belt.scale.set(10.8, 7.8, 5);
    this.belay.position.copy(at(sk.pelvis, 0, -1.5, 7.6));
    this.basis(this.belay, R, U, F);
    this.biners.forEach((b, i) => {
      const side = i < 2 ? -1 : 1;
      b.position.copy(at(sk.pelvis, side * (9.5 + (i % 2) * 1.5), -1 - (i % 2) * 2.5, 2 - (i % 2) * 4));
      this.basis(b, F, U, R);
    });
    this.chalkBag.position.copy(at(sk.pelvis, 0, -1, -8.5));
    this.basis(this.chalkBag, R, U, F);
    this.chalkRim.position.copy(at(sk.pelvis, 0, 1.8, -8.5));
    this.basis(this.chalkRim, R, F.clone().negate(), U);

    // limbs
    sk.limbs.forEach((l, i) => {
      const o = this.limbs[i];
      const arm = l.hand;
      this.seg(o.upper, l.root, l.joint);
      this.seg(o.lower, l.joint, l.end);
      o.j0.position.copy(l.root);
      o.j0.scale.setScalar(arm ? 4.0 : 5.9);
      o.j1.position.copy(l.joint);
      o.j1.scale.setScalar(arm ? 3.4 : 4.6);
      const d = new THREE.Vector3().subVectors(l.end, l.joint).normalize();
      if (arm) {
        // sleeve cuff at the wrist, then the hand continuing the forearm
        o.cuff.position.copy(l.end).addScaledVector(d, -1.5);
        o.cuff.quaternion.setFromUnitVectors(UP, d);
        o.cuff.scale.set(2.6, 2.2, 2.6);
        const hand = o.hand;
        const palmN = l.normal.clone().addScaledVector(d, -l.normal.dot(d)).normalize();
        const hx = new THREE.Vector3().crossVectors(d, palmN).normalize();
        hand.group.position.copy(l.end).addScaledVector(d, -0.5);
        this.basis(hand.group, hx, d, palmN.clone().negate());
        const curl = l.grip ? 1.25 : 0.35;
        for (const f of hand.fingers) {
          f.base.rotation.x = curl * 0.8;
          f.knuckle.rotation.x = curl;
        }
        hand.thumb.rotation.set(l.grip ? 0.9 : 0.3, 0, -0.5);
        const mat = sk.chalk ? this.m.chalk : this.m.skin;
        for (const mesh of hand.meshes) mesh.material = mat;
      } else {
        o.cuff.position.copy(l.end).addScaledVector(d, -2);
        o.cuff.quaternion.setFromUnitVectors(UP, d);
        o.cuff.scale.set(3.1, 2.4, 3.1);
        const fwd = l.dir.clone().normalize();
        const up = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3().crossVectors(U, fwd)).normalize();
        const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
        o.foot.group.position.copy(l.end).addScaledVector(up, -2.5).addScaledVector(fwd, -2.5);
        this.basis(o.foot.group, right, up, fwd);
      }
    });
  }
}
