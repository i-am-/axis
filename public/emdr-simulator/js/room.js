// Therapy room around the device: walls, window, ceiling lights, floor, two
// therapy chairs with seated figures, rug, side table and a plant.
// Scene units: metres; linear value 1.0 = `lref` cd/m². The device hangs on the
// back wall (z = 0), the room extends to +z. Lighting splits the "room light"
// illuminance between ambient, ceiling lights and the window, so walls still show
// about ρ·E/π whatever the mix.

import * as THREE from 'three';
import { kelvinToLinear } from './materials.js';

export const ROOM_DEFAULT = {
  wallColor: '#ece6dc', // device wall
  sideColor: '#ece6dc', // other walls
  ceilingColor: '#f4f2ee',
  height: 2.7, // m
  floor: 'oak',
  window: true,
  sky: 'overcast', // day | overcast | dusk | night
  blinds: 0.3, // 0 open .. 1 closed
  ceilingLights: 'downlights', // downlights | pendant | off
  lightCct: 3000,
  clientChair: true,
  facing: 30, // degrees off face-to-face between client and therapist
  clientTurn: 15, // degrees the client chair turns toward the therapist
  chairGap: 1.3, // m between chair centres
  therapistChair: true,
  people: true,
  clientFigure: 'f_dark_curly',
  therapistFigure: 'm_brown_short',
  fabric: '#8f8577',
  rug: true,
  table: true,
  plant: true,
};

// Sky luminance seen through the window, cd/m², and its colour.
const SKY = {
  day: { L: 4000, color: [0.78, 0.86, 1.0], share: 0.5 },
  overcast: { L: 1500, color: [0.9, 0.92, 0.95], share: 0.35 },
  dusk: { L: 120, color: [1.0, 0.68, 0.45], share: 0.12 },
  night: { L: 2, color: [0.25, 0.3, 0.45], share: 0 },
};

// Light colour for a colour temperature: linear rgb with luminance 1, so the
// intensity still means illuminance.
// The eye (and a camera) adapts to the room light, so warm light looks only
// slightly warm: blend 35 % of the black-body tint into neutral.
function kelvinColor(k) {
  const t = kelvinToLinear(k);
  return new THREE.Color(...t.map((v) => 1 + (v - 1) * 0.35));
}

let plasterTex = null;
function plasterTexture() {
  if (plasterTex) return plasterTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 238 + rnd() * 17;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  plasterTex = new THREE.CanvasTexture(c);
  plasterTex.colorSpace = THREE.SRGBColorSpace;
  plasterTex.wrapS = plasterTex.wrapT = THREE.RepeatWrapping;
  plasterTex.repeat.set(12, 6);
  return plasterTex;
}

const floorCache = {};
// Oak / walnut planks (14 cm, staggered joints), oak herringbone, grey carpet, concrete.
function floorTexture(kind) {
  if (floorCache[kind]) return floorCache[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tones = { oak: [176, 138, 94], herringbone: [182, 142, 98], walnut: [104, 72, 50], carpet: [128, 124, 118], concrete: [158, 156, 150] };
  const tone = tones[kind] ?? tones.oak;
  const plank = (x, y, len, h, vertical) => {
    const k = 0.93 + rnd() * 0.12;
    g.save();
    g.translate(x, y);
    if (vertical) g.rotate(Math.PI / 2);
    g.fillStyle = `rgb(${tone[0] * k},${tone[1] * k},${tone[2] * k})`;
    g.fillRect(0, 0, len, h);
    for (let l = 0; l < 8; l++) {
      g.strokeStyle = `rgba(60,40,20,${0.05 + rnd() * 0.1})`;
      g.lineWidth = 0.5 + rnd() * 1.5;
      g.beginPath();
      const y0 = rnd() * h;
      g.moveTo(0, y0);
      g.bezierCurveTo(len / 3, y0 + (rnd() - 0.5) * 10, (2 * len) / 3, y0 + (rnd() - 0.5) * 10, len, y0);
      g.stroke();
    }
    g.strokeStyle = 'rgba(30,20,10,0.45)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, len, h);
    g.restore();
  };
  if (kind === 'oak' || kind === 'walnut') {
    const rows = 8;
    const h = c.height / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 600;
      while (x < c.width) {
        const len = 500 + rnd() * 500;
        plank(x, r * h, len, h, false);
        x += len;
      }
    }
  } else if (kind === 'herringbone') {
    const w = 64;
    const len = 256;
    for (let col = -1; col < 1024 / len + 1; col++) {
      for (let row = -4; row < 1024 / w + 4; row++) {
        const x = col * len;
        const y = row * w;
        if ((row + col) % 2 === 0) plank(x, y, len, w, false);
        else plank(x + w, y - len + w, len, w, true);
      }
    }
  } else {
    const img = g.createImageData(c.width, c.height);
    const amp = kind === 'carpet' ? 30 : 14;
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * amp;
      img.data[i] = tone[0] + n;
      img.data[i + 1] = tone[1] + n;
      img.data[i + 2] = tone[2] + n;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6 / 1.12, 5 / 1.12);
  t.anisotropy = 8;
  floorCache[kind] = t;
  return t;
}

// Upholstered therapy armchair. Local frame: the sitter faces -z.
function makeChair(fabric) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: fabric, roughness: 1 });
  const cushion = new THREE.MeshStandardMaterial({ color: new THREE.Color(fabric).multiplyScalar(1.08), roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3f2a, roughness: 0.55 });
  const box = (w, h, d, x, y, z, mat = cloth, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    g.add(m);
  };
  box(0.74, 0.22, 0.74, 0, 0.23, 0); // base
  box(0.52, 0.12, 0.6, 0, 0.4, -0.02, cushion); // seat cushion
  box(0.74, 0.62, 0.14, 0, 0.62, 0.32, cloth, 0.12); // back
  box(0.5, 0.42, 0.1, 0, 0.66, 0.23, cushion, 0.16); // back cushion
  box(0.11, 0.3, 0.74, -0.315, 0.5, 0); // arms
  box(0.11, 0.3, 0.74, 0.315, 0.5, 0);
  for (const [x, z] of [[-0.31, -0.31], [0.31, -0.31], [-0.31, 0.31], [0.31, 0.31]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.12, 12), wood);
    leg.position.set(x, 0.06, z);
    g.add(leg);
  }
  return g;
}

// Appearance presets for the seated figures: body build, skin tone, hair.
export const FIGURES = {
  f_dark_curly: { label: 'Woman · dark skin · curly hair', build: 'f', skin: 0x5a3a27, hair: 'curly', hairColor: 0x1a120e, shirt: 0x8a5a6a, trousers: 0x2e3038 },
  m_brown_short: { label: 'Man · brown skin · short hair', build: 'm', skin: 0x93633f, hair: 'short', hairColor: 0x15100d, shirt: 0x5f6b7a, trousers: 0x3c4048 },
  f_light_long: { label: 'Woman · light skin · long dark hair', build: 'f', skin: 0xdcb593, hair: 'long', hairColor: 0x15110e, shirt: 0x6d7f6a, trousers: 0x34363c },
  m_fair_grey: { label: 'Man · fair skin · grey hair', build: 'm', skin: 0xe4c2a6, hair: 'short', hairColor: 0x9c9893, shirt: 0x7d6b5d, trousers: 0x2f3137 },
  f_tan_bun: { label: 'Woman · tan skin · hair in a bun', build: 'f', skin: 0xb5835f, hair: 'bun', hairColor: 0x2b1c14, shirt: 0x5a6f8c, trousers: 0x3a3330 },
  m_deep_shaved: { label: 'Man · deep brown skin · shaved head', build: 'm', skin: 0x4a3022, hair: 'none', hairColor: 0x1a120e, shirt: 0x6b6f5a, trousers: 0x2b2d33 },
  f_fair_blonde: { label: 'Woman · fair skin · blonde hair', build: 'f', skin: 0xecc9af, hair: 'long', hairColor: 0xc7a26a, shirt: 0x9a7f6a, trousers: 0x3b3f48 },
  m_olive_beard: { label: 'Man · olive skin · beard', build: 'm', skin: 0xa8775a, hair: 'short', beard: true, hairColor: 0x1f1712, shirt: 0x4f5d6b, trousers: 0x35322f },
};

// Seated figure built from tapered limbs and shaped volumes, adult proportions
// (stature ~1.72 m; seated eye height ~1.2 m). Chair-local frame: faces -z, the
// seat cushion top is at y = 0.46. opts: shirt, trousers, skin, hair, tablet.
function makePerson({ build = 'm', shirt = 0x5f6b7a, trousers = 0x3c4048, skin = 0xc8a58c, hair = 'short', hairColor = 0x3b2c22, beard = false, shoes = 0x2a2522, tablet = false } = {}) {
  // Build: shoulder half-width, hip half-width, chest depth (female: narrower
  // shoulders, wider hips, fuller chest; male the reverse).
  const B = build === 'f' ? { sh: 0.168, hip: 0.19, chest: 0.125, chestW: 0.16, thigh: 0.1 } : { sh: 0.19, hip: 0.172, chest: 0.115, chestW: 0.175, thigh: 0.095 };
  const g = new THREE.Group();
  const M = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const mShirt = M(shirt);
  const mTrousers = M(trousers);
  const mSkin = M(skin, 0.6);
  const mHair = M(hairColor, 0.9);
  const mShoes = M(shoes, 0.5);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // Ellipsoid at a point with radii.
  const blob = (mat, c, rx, ry, rz, rotX = 0) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), mat);
    m.position.copy(c);
    m.scale.set(rx, ry, rz);
    m.rotation.x = rotX;
    g.add(m);
    return m;
  };
  // Tapered segment from a (radius ra) to b (radius rb), with rounded joints.
  const limb = (mat, a, b, ra, rb) => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, len, 20, 1), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    g.add(m);
    blob(mat, a, ra, ra, ra);
    blob(mat, b, rb, rb, rb);
  };
  // Torso, leaning back ~10° against the chair back (+z is the chair back).
  blob(mTrousers, V(0, 0.56, 0.05), B.hip, 0.1, 0.13); // pelvis
  blob(mShirt, V(0, 0.7, 0.08), 0.145, 0.12, 0.092, 0.12); // abdomen
  blob(mShirt, V(0, 0.9, 0.1), B.chestW, 0.17, B.chest, 0.16); // chest
  blob(mShirt, V(0, 1.025, 0.12), B.sh, 0.055, 0.095); // shoulder line
  limb(mSkin, V(0, 1.06, 0.12), V(0, 1.14, 0.105), 0.05, 0.045); // neck
  // Head: cranium, jaw, nose, ears, hair.
  const head = blob(mSkin, V(0, 1.245, 0.095), 0.078, 0.105, 0.098);
  blob(mSkin, V(0, 1.195, 0.088), 0.06, 0.052, 0.07); // jaw (mostly inside the cranium)
  blob(mSkin, V(0, 1.235, 0.0), 0.014, 0.022, 0.018); // nose
  for (const s of [-1, 1]) blob(mSkin, V(s * 0.078, 1.24, 0.1), 0.012, 0.025, 0.018); // ears
  if (hair === 'short') blob(mHair, V(0, 1.29, 0.11), 0.084, 0.075, 0.098);
  else if (hair === 'long') {
    blob(mHair, V(0, 1.29, 0.11), 0.088, 0.08, 0.102);
    blob(mHair, V(0, 1.17, 0.16), 0.09, 0.13, 0.055); // falls behind the shoulders
  } else if (hair === 'bun') {
    blob(mHair, V(0, 1.29, 0.11), 0.084, 0.076, 0.1);
    blob(mHair, V(0, 1.31, 0.2), 0.045, 0.045, 0.045);
  } else if (hair === 'curly') blob(mHair, V(0, 1.3, 0.11), 0.112, 0.1, 0.122);
  if (beard) blob(mHair, V(0, 1.185, 0.075), 0.064, 0.056, 0.07);
  for (const s of [-1, 1]) {
    // Legs: hip -> knee -> ankle, knees bent ~95°.
    const hip = V(s * B.thigh, 0.53, 0.03);
    const knee = V(s * (B.thigh + 0.01), 0.53, -0.41);
    const ankle = V(s * 0.115, 0.1, -0.45);
    limb(mTrousers, hip, knee, 0.085, 0.058);
    limb(mTrousers, knee, V(s * 0.11, 0.33, -0.43), 0.056, 0.05); // calf bulge
    limb(mTrousers, V(s * 0.11, 0.33, -0.43), ankle, 0.05, 0.036);
    blob(mShoes, V(s * 0.115, 0.045, -0.52), 0.048, 0.04, 0.12); // shoe
    // Arms: shoulder -> elbow -> wrist; forearms on the armrests, or holding a tablet.
    const shoulder = V(s * B.sh, 1.03, 0.12);
    const elbow = tablet ? V(s * 0.22, 0.76, 0.02) : V(s * 0.255, 0.76, 0.08);
    const wrist = tablet ? V(s * 0.1, 0.66, -0.2) : V(s * 0.285, 0.69, -0.1);
    limb(mShirt, shoulder, elbow, 0.048, 0.038);
    limb(mShirt, elbow, V().lerpVectors(elbow, wrist, 0.85), 0.037, 0.03);
    limb(mSkin, V().lerpVectors(elbow, wrist, 0.85), wrist, 0.028, 0.025);
    const hand = blob(mSkin, V(wrist.x, wrist.y - 0.006, wrist.z - 0.045), 0.026, 0.014, 0.048);
    if (tablet) hand.rotation.z = s * 0.4;
  }
  if (tablet) {
    // The therapist's tablet (phone app controls the device), held on the lap.
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.008, 0.17), M(0x1b1d21, 0.3));
    t.position.set(0, 0.665, -0.24);
    t.rotation.x = 0.35;
    g.add(t);
  }
  g.userData.head = head;
  return g;
}

function makePlant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.32, 24), new THREE.MeshStandardMaterial({ color: 0xb8a48c, roughness: 0.8 }));
  pot.position.y = 0.16;
  g.add(pot);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3d5a35, roughness: 0.9 });
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12 + rnd() * 0.08, 12, 10), leaf);
    m.position.set((rnd() - 0.5) * 0.3, 0.5 + rnd() * 0.6, (rnd() - 0.5) * 0.3);
    m.scale.y = 1.3;
    g.add(m);
  }
  return g;
}

export class Room {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.cfg = { ...ROOM_DEFAULT };
    this.viewerDistance = 1.5;
    // The device wall material is kept across rebuilds (the halo reads its colour).
    this.wallMat = new THREE.MeshStandardMaterial({ color: this.cfg.wallColor, roughness: 0.95, map: plasterTexture() });
  }

  build(cfg = {}, viewerDistance = this.viewerDistance, deviceZ = this.deviceZ ?? 0) {
    this.deviceZ = deviceZ;
    this.cfg = { ...ROOM_DEFAULT, ...cfg };
    this.viewerDistance = viewerDistance;
    const c = this.cfg;
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => {
        o.geometry?.dispose();
        if (o.material && o.material !== this.wallMat) {
          if (o.material.map && !Object.values(floorCache).includes(o.material.map) && o.material.map !== plasterTex) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    const G = new THREE.Group();
    this.group = G;
    this.furniture = [];
    const W = 6;
    const Dr = 5;
    const Hr = c.height;
    const add = (geo, mat, pos, rot = [0, 0, 0], parent = G) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos);
      m.rotation.set(...rot);
      parent.add(m);
      return m;
    };
    this.wallMat.color.set(c.wallColor);
    const sideMat = new THREE.MeshStandardMaterial({ color: c.sideColor, roughness: 0.95, map: plasterTexture() });
    add(new THREE.PlaneGeometry(W, Hr), this.wallMat, [0, Hr / 2, 0]);
    add(new THREE.PlaneGeometry(Dr, Hr), sideMat, [W / 2, Hr / 2, Dr / 2], [0, -Math.PI / 2, 0]);
    add(new THREE.PlaneGeometry(W, Hr), sideMat, [0, Hr / 2, Dr], [0, Math.PI, 0]);

    // Left wall, with a window opening (z 1.4..3.2 m, sill 0.85 m).
    const win = { z0: 1.4, z1: 3.2, y0: 0.85, y1: Math.min(Hr - 0.3, 2.25) };
    const wallShape = new THREE.Shape();
    wallShape.moveTo(0, 0);
    wallShape.lineTo(Dr, 0);
    wallShape.lineTo(Dr, Hr);
    wallShape.lineTo(0, Hr);
    wallShape.closePath();
    if (c.window) {
      const hole = new THREE.Path();
      hole.moveTo(win.z0, win.y0);
      hole.lineTo(win.z0, win.y1);
      hole.lineTo(win.z1, win.y1);
      hole.lineTo(win.z1, win.y0);
      hole.closePath();
      wallShape.holes.push(hole);
    }
    const leftGeo = new THREE.ShapeGeometry(wallShape);
    // Shape x -> room z, shape y -> height; the wall faces +x (into the room).
    const left = add(leftGeo, sideMat, [-W / 2, 0, 0], [0, Math.PI / 2, 0]);
    left.scale.x = -1; // keep z increasing into the room after the rotation
    left.material.side = THREE.DoubleSide;
    const sky = SKY[c.sky] ?? SKY.overcast;
    this.sky = sky;
    if (c.window) {
      const frameMat = new THREE.MeshStandardMaterial({ color: 0xf1eee8, roughness: 0.5 });
      const fw = 0.05;
      const fz = (win.z0 + win.z1) / 2;
      const fy = (win.y0 + win.y1) / 2;
      const wz = win.z1 - win.z0;
      const wy = win.y1 - win.y0;
      const fx = -W / 2 + 0.03;
      add(new THREE.BoxGeometry(0.08, fw, wz + fw), frameMat, [fx, win.y0, fz]);
      add(new THREE.BoxGeometry(0.08, fw, wz + fw), frameMat, [fx, win.y1, fz]);
      add(new THREE.BoxGeometry(0.08, wy, fw), frameMat, [fx, fy, win.z0]);
      add(new THREE.BoxGeometry(0.08, wy, fw), frameMat, [fx, fy, win.z1]);
      add(new THREE.BoxGeometry(0.06, wy, 0.035), frameMat, [fx, fy, fz]); // mullion
      add(new THREE.BoxGeometry(0.22, 0.03, wz + 0.12), frameMat, [-W / 2 + 0.11, win.y0 - 0.02, fz]); // sill
      // Sky seen through the glass (unlit, luminance from the sky setting).
      this.skyMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      add(new THREE.PlaneGeometry(wz, wy), this.skyMat, [-W / 2 - 0.05, fy, fz], [0, Math.PI / 2, 0]);
      // Roller blind, lowered by the blinds setting.
      if (c.blinds > 0) {
        const bh = wy * c.blinds;
        const blindMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d6, roughness: 1, side: THREE.DoubleSide });
        add(new THREE.PlaneGeometry(wz, bh), blindMat, [-W / 2 + 0.02, win.y1 - bh / 2, fz], [0, Math.PI / 2, 0]);
      }
      this.window = win;
    } else {
      this.skyMat = null;
    }

    const ceilingMat = new THREE.MeshStandardMaterial({ color: c.ceilingColor, roughness: 1, map: plasterTexture() });
    add(new THREE.PlaneGeometry(W, Dr), ceilingMat, [0, Hr, Dr / 2], [Math.PI / 2, 0, 0]);
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(c.floor), roughness: c.floor === 'carpet' ? 1 : c.floor === 'concrete' ? 0.85 : 0.55 });
    add(new THREE.PlaneGeometry(W, Dr), floorMat, [0, 0, Dr / 2], [-Math.PI / 2, 0, 0]);
    const skirt = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.5 });
    add(new THREE.BoxGeometry(W, 0.08, 0.015), skirt, [0, 0.04, 0.0075]);
    add(new THREE.BoxGeometry(0.015, 0.08, Dr), skirt, [-W / 2 + 0.0075, 0.04, Dr / 2]);
    add(new THREE.BoxGeometry(0.015, 0.08, Dr), skirt, [W / 2 - 0.0075, 0.04, Dr / 2]);

    // Ceiling lights: fittings (unlit, bright) and the lights themselves.
    this.fixtureMats = [];
    this.ceilingLights = [];
    const lampColor = kelvinColor(c.lightCct);
    const fixture = () => {
      const m = new THREE.MeshBasicMaterial({ color: lampColor.clone(), toneMapped: false });
      this.fixtureMats.push(m);
      return m;
    };
    if (c.ceilingLights === 'downlights') {
      for (const [x, z] of [[-1.2, 1.2], [1.2, 1.2], [-1.2, 3.2], [1.2, 3.2]]) {
        add(new THREE.CircleGeometry(0.06, 24), fixture(), [x, Hr - 0.002, z], [Math.PI / 2, 0, 0]);
        add(new THREE.RingGeometry(0.06, 0.08, 24), new THREE.MeshStandardMaterial({ color: 0xdedbd5 }), [x, Hr - 0.001, z], [Math.PI / 2, 0, 0]);
        const l = new THREE.PointLight(lampColor, 0, 0, 2);
        l.position.set(x, Hr - 0.1, z);
        G.add(l);
        this.ceilingLights.push(l);
      }
    } else if (c.ceilingLights === 'pendant') {
      const shadeMat = new THREE.MeshStandardMaterial({ color: 0xd8cbb4, roughness: 0.8, side: THREE.DoubleSide });
      const y = Hr - 0.7;
      add(new THREE.CylinderGeometry(0.003, 0.003, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0x222222 }), [0, Hr - 0.35, 2.2]);
      add(new THREE.CylinderGeometry(0.12, 0.25, 0.22, 32, 1, true), shadeMat, [0, y, 2.2]);
      add(new THREE.CircleGeometry(0.24, 32), fixture(), [0, y - 0.1, 2.2], [Math.PI / 2, 0, 0]);
      const l = new THREE.PointLight(lampColor, 0, 0, 2);
      l.position.set(0, y - 0.15, 2.2);
      G.add(l);
      this.ceilingLights.push(l);
    }
    this.hemi = new THREE.HemisphereLight(lampColor, new THREE.Color(0.75, 0.7, 0.62), 0); // ground = floor/rug bounce
    G.add(this.hemi);
    this.windowLight = new THREE.DirectionalLight(new THREE.Color(...sky.color), 0);
    this.windowLight.position.set(-W / 2 - 1, 2.2, 2.3);
    this.windowLight.target.position.set(0.5, 1.0, 1.0);
    G.add(this.windowLight, this.windowLight.target);

    // Seating (EMDR practice): client and therapist nearly face each other. The
    // angle between their facing directions is 180° − c.facing (default 150°).
    // The client turns c.clientTurn toward the therapist; the therapist sits at
    // azimuth clientTurn + facing from the client, c.chairGap away, looking at
    // the client, which keeps them outside the client's line of sight to the bar.
    // Azimuth 0 = toward the wall (-z), positive = toward +x (the control end).
    const d = viewerDistance;
    const rad = Math.PI / 180;
    const fwd = (az) => new THREE.Vector3(Math.sin(az), 0, -Math.cos(az));
    const clientAz = c.clientTurn * rad;
    const clientPos = new THREE.Vector3(0, 0, deviceZ + d + 0.05); // in front of the device (wall or tripod)
    this.clientHead = null;
    this.clientPerson = null;
    if (c.clientChair) {
      const ch = makeChair(c.fabric);
      ch.position.copy(clientPos);
      ch.rotation.y = -clientAz;
      G.add(ch);
      this.furniture.push(ch);
      if (c.people) {
        const p = makePerson(FIGURES[c.clientFigure] ?? FIGURES.f_dark_curly);
        ch.add(p);
        this.clientHead = p.userData.head;
        this.clientPerson = p;
      }
    }
    this.therapistPos = null;
    if (c.therapistChair) {
      const az = (c.clientTurn + c.facing) * rad;
      const pos = clientPos.clone().add(fwd(az).multiplyScalar(c.chairGap));
      const ch = makeChair(c.fabric);
      ch.position.copy(pos);
      ch.rotation.y = -(az + Math.PI); // looking back at the client
      G.add(ch);
      this.furniture.push(ch);
      if (c.people) ch.add(makePerson({ ...(FIGURES[c.therapistFigure] ?? FIGURES.m_brown_short), tablet: true }));
      this.therapistPos = pos;
    }
    if (c.rug) {
      const rugMat = new THREE.MeshStandardMaterial({ color: 0x8c7a66, roughness: 1 });
      add(new THREE.PlaneGeometry(2.4, 1.8), rugMat, [0.45, 0.003, d - 0.35], [-Math.PI / 2, 0, 0]);
    }
    if (c.table) {
      // Side table between the two chairs, set back from the line joining them so
      // it stays clear of the space between their knees.
      const T = this.therapistPos ?? clientPos.clone().add(new THREE.Vector3(1, 0, -0.8));
      const mid = clientPos.clone().add(T).multiplyScalar(0.5);
      const dir = T.clone().sub(clientPos).normalize();
      const away = new THREE.Vector3(-dir.z, 0, dir.x);
      if (away.z < 0) away.negate(); // toward the room, away from the wall
      const at = mid.addScaledVector(away, 0.5);
      const tm = new THREE.MeshStandardMaterial({ color: 0x6b4c33, roughness: 0.6 });
      const top = add(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 32), tm, [at.x, 0.52, at.z]);
      const stem = add(new THREE.CylinderGeometry(0.03, 0.05, 0.5, 16), tm, [at.x, 0.26, at.z]);
      this.furniture.push(top, stem);
    }
    if (c.plant) {
      const pl = makePlant();
      pl.position.set(-W / 2 + 0.45, 0, 0.45);
      G.add(pl);
    }
    this.scene.add(G);
  }

  // Chairs and people step aside (hidden) during the exploded view.
  setFurnitureVisible(on) {
    if (this._furnitureOn === on) return;
    this._furnitureOn = on;
    for (const o of this.furniture ?? []) o.visible = on;
    if (on) this.update(this._lastCam ?? { position: new THREE.Vector3(0, 0, 99) });
  }

  // Lighting for a target illuminance (lux) at display white lref (cd/m²).
  setLight(lux, lref) {
    const e = lux / lref;
    const c = this.cfg;
    const sky = this.sky ?? SKY.overcast;
    const hasCeil = this.ceilingLights.length > 0;
    let shares = { amb: 0.4, ceil: hasCeil ? 0.6 : 0, win: c.window ? sky.share * (1 - c.blinds * 0.8) : 0 };
    const sum = shares.amb + shares.ceil + shares.win || 1;
    for (const k in shares) shares[k] /= sum;
    // Each part is scaled so its illuminance on the device wall, at the bar, is its
    // share of the room light. Hemisphere light on a vertical wall gives the mean of
    // sky and ground (~0.85 here).
    this.hemi.intensity = (e * shares.amb) / 0.85;
    // Window: a directional light; only the cos of its angle to the wall reaches it.
    const dir = this.windowLight.target.position.clone().sub(this.windowLight.position).normalize();
    const cosWall = Math.max(0.15, -dir.z);
    this.windowLight.intensity = Math.min(3, 1 / cosWall) * e * shares.win;
    // Point lights: E = I cos(α) / r² at the bar position.
    const bar = new THREE.Vector3(0, 1.25, 0.01);
    let geo = 0;
    for (const l of this.ceilingLights) {
      const v = l.position.clone().sub(bar);
      geo += Math.max(0, v.z / v.length()) / v.lengthSq();
    }
    for (const l of this.ceilingLights) l.intensity = geo > 0 ? (e * shares.ceil) / geo / this.ceilingLights.length : 0;
    // Fittings: about 3000 cd/m² diffusers; capped so bloom stays soft.
    const fx = hasCeil ? Math.min(12, (3000 * Math.min(1, lux / 100 + 0.2)) / lref) : 0;
    for (const m of this.fixtureMats) m.color.copy(kelvinColor(c.lightCct)).multiplyScalar(fx);
    // Sky through the glass: shown just above display white, so it reads as bright
    // daylight without flooding the view with bloom.
    if (this.skyMat) this.skyMat.color.setRGB(...sky.color).multiplyScalar(Math.min(1.15, sky.L / lref));
  }

  // Hide the client figure when the camera is inside or right behind its head.
  update(camera) {
    this._lastCam = camera;
    if (!this.clientHead || !this.clientPerson) return;
    const p = new THREE.Vector3();
    this.clientHead.getWorldPosition(p);
    this.clientPerson.visible = camera.position.distanceTo(p) > 0.5;
  }
}
