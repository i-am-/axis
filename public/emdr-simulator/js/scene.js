// WebGL scene: wall-mounted wooden light bar(s) whose face luminance is computed in a
// fragment shader as the superposition of per-LED emission × diffuser PSF.
// Scene units are metres; linear scene value 1.0 = `lref` cd/m² (display white).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { bodySize, stackDepth, MATERIALS } from './materials.js';
import { Room } from './room.js';

const FACE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FACE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uLeds;   // N x 1, rgb = emission (lm-weighted linear rgb)
uniform sampler2D uPsf;    // nx x ny, rgb = cd/m² per lm / uPsfMax
uniform float uN;
uniform float uPitch;      // mm
uniform float uRx;         // PSF half-range along x, mm
uniform vec2 uFace;        // face size, mm
uniform float uScale;      // uPsfMax / lref
uniform int uK;
uniform float uReady;
uniform vec3 uAmbient;   // diffuse reflection of room light (scene units)
uniform float uFront;    // share of LED light that leaves through the face (rear slot takes the rest)
varying vec2 vUv;
void main() {
  float x = vUv.x * uFace.x;            // 0 .. light length
  float y = (vUv.y - 0.5) * uFace.y;     // -W/2 .. W/2
  float py = clamp(vUv.y, 0.0, 1.0);
  int i0 = int(floor(x / uPitch));
  vec3 L = vec3(0.0);
  for (int k = -48; k <= 48; k++) {
    if (k < -uK || k > uK) continue;
    int i = i0 + k;
    if (i < 0 || float(i) >= uN) continue;
    float dx = x - (float(i) + 0.5) * uPitch;
    if (abs(dx) >= uRx) continue;
    vec3 e = texelFetch(uLeds, ivec2(i, 0), 0).rgb;
    if (e.r + e.g + e.b <= 0.0) continue;
    vec3 p = texture2D(uPsf, vec2((dx + uRx) / (2.0 * uRx), py)).rgb;
    L += e * p;
  }
  gl_FragColor = vec4(L * uScale * uReady * uFront + uAmbient, 1.0);
}`;

// Rear light on the wall. Rendered into a small off-screen texture in wall
// coordinates, then added onto the wall. Each LED is a point source with
// I(θ) = Φ (m+1)/(2π) cos^m θ about its axis; illuminance E = I cos(α) / r²,
// wall luminance = ρ E / π. Up to 4 sources (2 bars × 2 edge slots).
const HALO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const HALO_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uLeds;
uniform float uN;
uniform vec4 uRegion;        // x0, x1, y0, y1 (m) on the wall z = 0
uniform int uNS;
uniform vec3 uSrcO[4];       // world position of the exit for LED 0
uniform vec3 uSrcS[4];       // world step from one LED to the next
uniform vec3 uSrcA[4];       // world unit axis of the exit (beam direction)
uniform vec2 uSrcP[4];       // beam exponent m, lumens per unit of front emission
uniform vec3 uSteady[4];     // lumens per LED (linear rgb) from a steady rear strip
uniform vec3 uRho;           // wall reflectance (linear rgb)
uniform float uInvLref;
varying vec2 vUv;
const float PI = 3.14159265;
void main() {
  vec3 w = vec3(mix(uRegion.x, uRegion.y, vUv.x), mix(uRegion.z, uRegion.w, vUv.y), 0.0);
  vec3 E = vec3(0.0);
  for (int s = 0; s < 4; s++) {
    if (s >= uNS) break;
    float m = uSrcP[s].x;
    float k = (m + 1.0) / (2.0 * PI);
    for (int i = 0; i < 256; i++) {
      if (float(i) >= uN) break;
      vec3 lm = texelFetch(uLeds, ivec2(i, 0), 0).rgb * uSrcP[s].y + uSteady[s];
      if (lm.r + lm.g + lm.b <= 0.0) continue;
      vec3 p = uSrcO[s] + float(i) * uSrcS[s];
      p.z = max(p.z, 0.0005);
      vec3 d = w - p;
      float r2 = dot(d, d) + 2.5e-5;   // ~5 mm softening: the exit is not a point
      float r = sqrt(r2);
      float cosT = dot(d, uSrcA[s]) / r;  // angle from the exit axis
      float cosA = -d.z / r;              // angle of incidence on the wall
      if (cosT <= 0.0 || cosA <= 0.0) continue;
      E += lm * (k * pow(cosT, m) * cosA / r2);
    }
  }
  gl_FragColor = vec4(uRho * E / PI * uInvLref, 1.0);
}`;

// Device mounting: flat or tilted on the wall, or on a tripod in the room.
export const MOUNT_DEFAULT = { type: 'wall', tilt: 0, roll: 0, dist: 0.9, height: 1.25, cable: 'visible' }; // cable: visible | concealed | off

const woodCache = {};
// Wood textures are expensive to draw (2048×256 canvas + noise pass), so each
// species/finish pair is made once and shared by every rebuild. Marked shared so
// build() never disposes them.
function woodTexture(kind, finish = 'raw') {
  const key = kind + '|' + finish;
  if (!woodCache[key]) {
    woodCache[key] = makeWoodTexture(kind, finish);
    woodCache[key].userData.shared = true;
  }
  return woodCache[key];
}

const WOOD_TONES = {
  ash: { base: '#dcc9a6', dark: [150, 118, 80], light: [243, 230, 204], lines: 150, seed: 3 },
  oak: { base: '#c8a674', dark: [120, 86, 48], light: [226, 202, 152], lines: 120, seed: 5, rays: true },
  walnut: { base: '#5b3d2a', dark: [35, 22, 14], light: [120, 85, 60], lines: 140, seed: 9 },
};
// Finish as a per-channel multiply plus a lift toward white.
const FINISH_TINT = {
  raw: { mul: [1, 1, 1], lift: 0 },
  oil: { mul: [0.95, 0.86, 0.7], lift: 0 },
  white_oil: { mul: [1, 0.99, 0.97], lift: 0.18 },
  lacquer: { mul: [0.98, 0.93, 0.84], lift: 0.02 },
};
export const FINISH_ROUGHNESS = { raw: 0.85, oil: 0.6, white_oil: 0.65, lacquer: 0.45 };

function makeWoodTexture(kind, finish) {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 256;
  const g = c.getContext('2d');
  const tones = WOOD_TONES[kind] ?? WOOD_TONES.ash;
  g.fillStyle = tones.base;
  g.fillRect(0, 0, c.width, c.height);
  let seed = tones.seed;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let l = 0; l < tones.lines; l++) {
    const y0 = rnd() * c.height;
    const amp = 2 + rnd() * 10;
    const freq = 0.002 + rnd() * 0.006;
    const ph = rnd() * 6.28;
    const dark = rnd() < 0.6;
    const col = dark ? tones.dark : tones.light;
    g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.08 + rnd() * 0.25})`;
    g.lineWidth = 0.5 + rnd() * (dark ? 3 : 1.5);
    g.beginPath();
    for (let x = 0; x <= c.width; x += 8) {
      const y = y0 + amp * Math.sin(x * freq + ph) + 3 * Math.sin(x * freq * 3.7 + ph * 2);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  if (tones.rays) {
    // Oak medullary rays: short pale flecks across the grain.
    for (let f = 0; f < 900; f++) {
      g.fillStyle = `rgba(240,222,180,${0.1 + rnd() * 0.25})`;
      g.beginPath();
      g.ellipse(rnd() * c.width, rnd() * c.height, 3 + rnd() * 14, 0.6 + rnd() * 1.2, 0, 0, 6.283);
      g.fill();
    }
  }
  const img = g.getImageData(0, 0, c.width, c.height);
  const ft = FINISH_TINT[finish] ?? FINISH_TINT.raw;
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    for (let k = 0; k < 3; k++) {
      const v = (img.data[i + k] + n) * ft.mul[k];
      img.data[i + k] = v + (255 - v) * ft.lift;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Cross-section in the (depth z, height y) plane, front corners shaped, extruded
// along the bar. UVs: u along the bar (grain direction), v around the profile.
function bodyGeometry(L, H, D, edge, r) {
  r = edge === 'square' ? 0 : Math.max(0, Math.min(r, H / 2 - 0.0005, D / 2 - 0.0005));
  // Shape coordinates are (-z, y) so that rotating +90° about y maps them onto the bar.
  const zf = D / 2;
  const zb = -D / 2;
  const sh = new THREE.Shape();
  sh.moveTo(-zb, -H / 2);
  sh.lineTo(-zb, H / 2);
  if (r > 0 && edge === 'chamfer') {
    sh.lineTo(-(zf - r), H / 2);
    sh.lineTo(-zf, H / 2 - r);
    sh.lineTo(-zf, -H / 2 + r);
    sh.lineTo(-(zf - r), -H / 2);
  } else if (r > 0) {
    sh.lineTo(-(zf - r), H / 2);
    sh.absarc(-(zf - r), H / 2 - r, r, Math.PI / 2, Math.PI, false);
    sh.lineTo(-zf, -H / 2 + r);
    sh.absarc(-(zf - r), -H / 2 + r, r, Math.PI, 1.5 * Math.PI, false);
  } else {
    sh.lineTo(-zf, H / 2);
    sh.lineTo(-zf, -H / 2);
  }
  sh.closePath();
  const uv = {
    generateTopUV(geo, v, a, b, c) {
      return [a, b, c].map((i) => new THREE.Vector2(v[i * 3] * 8 + 0.5, v[i * 3 + 1] * 8 + 0.5));
    },
    generateSideWallUV(geo, v, a, b, c, d) {
      return [a, b, c, d].map((i) => new THREE.Vector2(v[i * 3 + 2] / L, (v[i * 3] + v[i * 3 + 1]) * 6 + 0.5));
    },
  };
  const geo = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false, steps: 1, curveSegments: 6, UVGenerator: uv });
  geo.rotateY(Math.PI / 2);
  geo.translate(-L / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

// Engraved touch-sensor marks: IEC 60417-5009 power symbol (broken ring + bar)
// and a play triangle for "next programme". r = outer radius in metres.
function powerSymbolGeometry(r) {
  const w = r * 0.3; // stroke width
  const gap = 0.9; // radians of the gap at the top
  const ring = new THREE.RingGeometry(r - w, r, 32, 1, Math.PI / 2 + gap / 2, 2 * Math.PI - gap);
  const bar = new THREE.PlaneGeometry(w, r * 0.95);
  bar.translate(0, r * 0.45, 0);
  return mergeGeometries([ring, bar]);
}
function playSymbolGeometry(r) {
  const sh = new THREE.Shape();
  sh.moveTo(-r * 0.6, -r * 0.85);
  sh.lineTo(r * 0.9, 0);
  sh.lineTo(-r * 0.6, r * 0.85);
  sh.closePath();
  return new THREE.ShapeGeometry(sh);
}
// Minimal merge for non-indexed/indexed position-only geometries.
function mergeGeometries(geos) {
  const pos = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...ng.attributes.position.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

// ---------- exploded view ----------
const EXPLODE_SECONDS = 2.5;
// Look of each optical material when shown as a separate slab.
function layerMaterial(id) {
  const look = {
    air: { color: 0xffffff, opacity: 0.05 },
    epoxy_clear: { color: 0xfff2d8, opacity: 0.28 },
    epoxy_ink: { color: 0xf7f5f0, opacity: 0.62 },
    epoxy_pigment: { color: 0xffffff, opacity: 0.78 },
    pc_opal: { color: 0xf4f4f2, opacity: 0.85 },
    pmma_opal: { color: 0xf6f6f4, opacity: 0.82 },
    pmma_satin: { color: 0xf2f4f6, opacity: 0.55 },
    pmma_clear: { color: 0xeef6ff, opacity: 0.2 },
    pet_film: { color: 0xfafafa, opacity: 0.88 },
    silicone: { color: 0xf3f1ea, opacity: 0.66 },
    wood_veneer: { color: 0xe6cf9f, opacity: 0.92 },
  }[id] ?? { color: 0xffffff, opacity: 0.5 };
  return new THREE.MeshStandardMaterial({ color: look.color, transparent: true, opacity: look.opacity, roughness: 0.25, depthWrite: look.opacity > 0.5 });
}
// Small always-facing label for an exploded part.
function partLabel(text) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '600 30px "IBM Plex Sans", system-ui, sans-serif';
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 24;
  c.height = 46;
  g.font = font;
  g.fillStyle = 'rgba(18,15,12,0.85)';
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, 8);
  g.fill();
  g.fillStyle = '#e6ded2';
  g.fillText(text, 12, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, toneMapped: false }));
  const h = 0.014;
  sp.scale.set((h * c.width) / c.height, h, 1);
  sp.center.set(0, 0);
  sp.renderOrder = 10;
  return sp;
}

// Bar caption on the wall: light text on a dark plate, readable on any paint colour.
// It is an annotation, not part of the room, so it is not lit or tone-mapped
// (text level stays below the bloom threshold).
function wallLabel(text) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '600 34px "IBM Plex Sans", system-ui, sans-serif';
  g.font = font;
  const tw = Math.ceil(g.measureText(text).width);
  c.width = tw + 32;
  c.height = 56;
  g.font = font;
  g.fillStyle = 'rgba(18,15,12,0.85)';
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, 10);
  g.fill();
  g.fillStyle = '#e6ded2';
  g.fillText(text, 16, 39);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
  const h = 0.024;
  const w = (h * c.width) / c.height;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.geometry.translate(w / 2, 0, 0);
  return mesh;
}

export class DeviceScene {
  constructor(container) {
    this.container = container;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // phones: fill-rate is the limit (bloom + halo passes), so cap the pixel ratio lower
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    r.setPixelRatio(Math.min(coarse ? 1.5 : 2, window.devicePixelRatio));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    container.appendChild(r.domElement);
    this.renderer = r;
    // GPU resets (driver timeout, sleep, too many contexts) lose the WebGL context.
    // preventDefault lets the browser restore it; three.js then re-uploads resources.
    r.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      console.warn('WebGL context lost');
      window.__twinFail?.('The GPU dropped the 3D view (WebGL context lost).', 'Waiting for the browser to restore it. If the view stays black, reload the page.');
    });
    r.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      console.warn('WebGL context restored');
      this.onContextRestored?.();
    });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 50);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.barY = 1.25;
    this.bars = [];
    this.lref = 300;
    this.lux = 30;
    this.indicator = 0;
    this.onTouch = null;
    this.rig = new THREE.Group(); // the device (one or two bars), moved by the mount
    this.scene.add(this.rig);
    this.stand = new THREE.Group(); // tripod, stays upright
    this.scene.add(this.stand);
    this.power = new THREE.Group(); // USB-C cable, power adaptor, wall socket
    this.scene.add(this.power);
    this.mount = { ...MOUNT_DEFAULT };
    this._buildRoom();
    this._buildHalo();
    this._setupPicking();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  // Room, furniture and room lighting live in room.js.
  _buildRoom() {
    this.room = new Room(this.scene);
    this.wallMat = this.room.wallMat;
    this.room.build();
  }

  // Rebuild the room from its settings. The device-wall colour also sets the
  // reflectance the rear-light halo uses.
  setRoom(cfg, viewerDistance) {
    this.room.build(cfg, viewerDistance ?? this.room.viewerDistance, this.mount.type === 'tripod' ? this.mount.dist : 0);
    this.halo?.mat.uniforms.uRho.value.copy(this.wallMat.color);
    this.applyLighting();
  }

  wallReflectance() {
    const c = this.wallMat.color;
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  }

  _buildHalo() {
    const rt = new THREE.WebGLRenderTarget(384, 192, { type: THREE.HalfFloatType, depthBuffer: false });
    rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
    const mat = new THREE.ShaderMaterial({
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uLeds: { value: null },
        uN: { value: 0 },
        uRegion: { value: new THREE.Vector4(-1, 1, 0.7, 1.8) },
        uNS: { value: 0 },
        uSrcO: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
        uSrcS: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
        uSrcA: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
        uSrcP: { value: [0, 1, 2, 3].map(() => new THREE.Vector2(1, 0)) },
        uSteady: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
        uRho: { value: this.wallMat.color.clone() },
        uInvLref: { value: 1 / 300 },
      },
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: rt.texture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
    );
    overlay.visible = false;
    this.scene.add(overlay);
    this.halo = { rt, mat, scene, cam: new THREE.Camera(), overlay, sources: [] };
  }

  _setupPicking() {
    const ray = new THREE.Raycaster();
    const v = new THREE.Vector2();
    const pick = (ev) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      v.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(v, this.camera);
      const pads = this.bars.flatMap((b) => b.pads);
      const hit = ray.intersectObjects(pads)[0];
      return hit?.object.userData.touch ?? null;
    };
    let down = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const t = pick(e);
      if (t) this.onTouch?.(t);
    });
    this.renderer.domElement.addEventListener('pointermove', (e) => {
      this.renderer.domElement.style.cursor = pick(e) ? 'pointer' : '';
    });
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this._fitFov();
  }

  // The preset field of view is vertical and tuned for a wide view. On a narrow
  // (phone, portrait) view, widen it so the horizontal field stays the same as at 16:10.
  _fitFov() {
    const c = this.camera;
    const base = this.baseFov ?? 42;
    const REF = 1.6;
    c.fov = c.aspect >= REF ? base
      : Math.min(100, (2 * Math.atan(Math.tan((base * Math.PI) / 360) * (REF / c.aspect)) * 180) / Math.PI);
    c.updateProjectionMatrix();
  }

  // bars: [{ stack, label }]
  build(strip, bars) {
    for (const b of this.bars) {
      b.group.removeFromParent();
      b.group.traverse((o) => {
        o.geometry?.dispose();
        if (o.material?.map && !o.material.map.userData.shared) o.material.map.dispose();
        o.material?.uniforms?.uPsf?.value?.dispose();
        o.material?.dispose?.();
      });
    }
    this.bars = [];
    this.strip = strip;
    const pitch = 1000 / strip.ledsPerM;
    const lightLen = strip.count * pitch; // mm
    this.lightLen = lightLen;
    if (!this.ledTex || this.ledTex.image.width !== strip.count) {
      this.ledTex?.dispose();
      this.ledData = new Float32Array(strip.count * 4);
      this.ledTex = new THREE.DataTexture(this.ledData, strip.count, 1, THREE.RGBAFormat, THREE.FloatType);
      this.ledTex.minFilter = this.ledTex.magFilter = THREE.NearestFilter;
      this.ledTex.needsUpdate = true;
    }
    const tallest = Math.max(...bars.map((b) => bodySize(b.stack).H)) / 1000;
    // Compare mode: bars 30 cm apart (centre to centre), more if they are very tall.
    const gap = Math.max(0.15, tallest / 2 + 0.08);
    const halo = this.halo;
    halo.sources = [];
    bars.forEach((spec, idx) => {
      const st = spec.stack;
      const hs = st.housing;
      const size = bodySize(st);
      const H = size.H / 1000;
      const D = size.D / 1000;
      const L = (lightLen + 2 * strip.endCap) / 1000;
      const group = new THREE.Group();
      const onWall = this.mount.type === 'wall';
      const y = bars.length > 1 ? (idx === 0 ? gap : -gap) : 0; // within the rig
      group.position.set(0, y, (onWall ? hs.standoff / 1000 : 0) + D / 2 + 0.001);
      const woodKind = hs.species;
      const tex = woodTexture(woodKind, hs.finish);
      const woodMat = new THREE.MeshStandardMaterial({ map: tex, roughness: FINISH_ROUGHNESS[hs.finish] ?? 0.6, metalness: 0 });
      const edgeR = Math.min(hs.edgeR, hs.rail - 0.5) / 1000;
      const body = new THREE.Mesh(bodyGeometry(L, H, D, hs.edge, edgeR), woodMat);
      group.add(body);
      if (onWall && hs.standoff > 0) {
        // Hidden cleat holding the bar off the wall.
        const cleat = new THREE.Mesh(
          new THREE.BoxGeometry(L * 0.7, H * 0.5, hs.standoff / 1000),
          new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 1 }),
        );
        cleat.position.set(0, 0, -D / 2 - hs.standoff / 2000);
        group.add(cleat);
      }
      // Rear-light exits in the bar's frame; converted to world space after mounting.
      if (st.back.mode !== 'off') {
        const x0 = -lightLen / 2000 + pitch / 2000;
        const ex = st.back.exit;
        const list = ex === 'rear' ? [[0, -D / 2, [0, 0, -1], 1]] : [];
        if (ex === 'top' || ex === 'both') list.push([H / 2, 0, [0, 1, 0], ex === 'both' ? 0.5 : 1]);
        if (ex === 'bottom' || ex === 'both') list.push([-H / 2, 0, [0, -1, 0], ex === 'both' ? 0.5 : 1]);
        for (const [ly, lz, ax, share] of list) {
          halo.sources.push({ bar: idx, group, local: new THREE.Vector3(x0, ly, lz), localAxis: new THREE.Vector3(...ax), pitchM: pitch / 1000, share, beam: st.back.beam, follow: 0, steady: [0, 0, 0] });
        }
      }
      // Face (diffuser surface).
      const faceMat = new THREE.ShaderMaterial({
        vertexShader: FACE_VERT,
        fragmentShader: FACE_FRAG,
        uniforms: {
          uLeds: { value: this.ledTex },
          uPsf: { value: null },
          uN: { value: strip.count },
          uPitch: { value: pitch },
          uRx: { value: 50 },
          uFace: { value: new THREE.Vector2(lightLen, st.width) },
          uScale: { value: 0 },
          uK: { value: 8 },
          uReady: { value: 0 },
          uAmbient: { value: new THREE.Vector3() },
          uFront: { value: 1 },
        },
      });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(lightLen / 1000, st.width / 1000), faceMat);
      face.position.set(0, 0, D / 2 + 0.0002);
      group.add(face);
      // Thin shadow line around the face (groove edge).
      const edgeMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 });
      for (const sy of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.PlaneGeometry(lightLen / 1000 + 0.002, 0.0008), edgeMat);
        e.position.set(0, (sy * (st.width / 2 + 0.4)) / 1000, D / 2 + 0.00015);
        group.add(e);
      }
      // Hidden touch sensors, engraved marks on the control end (FR-UI-08).
      const pads = [];
      const padMat = new THREE.MeshStandardMaterial({ color: { walnut: 0x2e1f15, oak: 0x7d6440 }[woodKind] ?? 0x9c8462, roughness: 0.9 });
      const xEnd = L / 2 - strip.endCap / 2000;
      [
        [1, xEnd - 0.012],
        [2, xEnd + 0.012],
      ].forEach(([id, x]) => {
        const geo = id === 1 ? powerSymbolGeometry(0.0035) : playSymbolGeometry(0.0035);
        const pad = new THREE.Mesh(geo, padMat);
        pad.position.set(x, 0, D / 2 + 0.0003);
        pad.userData.touch = id;
        // Larger invisible hit target.
        const hit = new THREE.Mesh(new THREE.CircleGeometry(0.009, 16), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.copy(pad.position);
        hit.userData.touch = id;
        group.add(pad, hit);
        pads.push(hit);
      });
      // Therapist-facing discreet indicator on the end face (FR-CL-06).
      const indMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const ind = new THREE.Mesh(new THREE.CircleGeometry(0.0025, 20), indMat);
      ind.rotation.y = Math.PI / 2;
      ind.position.set(L / 2 + 0.0002, 0, 0);
      group.add(ind);
      const label = wallLabel(spec.label);
      const flat = onWall && !this.mount.tilt && !this.mount.roll;
      // Flat on the wall: caption on the wall above the bar. Otherwise it rides
      // just above the bar.
      if (flat) label.position.set(-L / 2, H / 2 + 0.02, -(hs.standoff / 1000 + D / 2 + 0.001) + 0.0008);
      else label.position.set(-L / 2, H / 2 + 0.012, 0);
      group.add(label);
      this.rig.add(group);
      const exploded = this._buildExploded(group, st, strip, { L, H, D, lightLen: lightLen / 1000, pitch: pitch / 1000, xEnd });
      const assembled = group.children.filter((o) => o !== label && !exploded.group.children.includes(o) && o !== exploded.group);
      this.bars.push({ group, faceMat, pads, indMat, L, H, D, stack: st, exploded, assembled });
    });
    this._explodeDone = null;
    this._placeRig(gap, tallest);
    this._buildPower();
    for (const src of halo.sources) {
      src.o = src.group.localToWorld(src.local.clone());
      const q = new THREE.Quaternion();
      src.group.getWorldQuaternion(q);
      src.step = new THREE.Vector3(src.pitchM, 0, 0).applyQuaternion(q);
      src.axis = src.localAxis.clone().applyQuaternion(q);
    }
    // Halo region on the wall: the whole bar length plus margin, ±0.6 m around the bars.
    const maxL = Math.max(1, ...this.bars.map((b) => b.L));
    const c = this.rig.position;
    const reg = [c.x - maxL / 2 - 0.5, c.x + maxL / 2 + 0.5, c.y - 0.6, c.y + 0.6];
    const u = halo.mat.uniforms;
    u.uRegion.value.set(...reg);
    u.uLeds.value = this.ledTex;
    u.uN.value = strip.count;
    halo.overlay.scale.set(reg[1] - reg[0], reg[3] - reg[2], 1);
    halo.overlay.position.set((reg[0] + reg[1]) / 2, (reg[2] + reg[3]) / 2, 0.0005);
    this.applyLighting();
  }

  setMount(m) {
    this.mount = { ...MOUNT_DEFAULT, ...m };
  }

  // Position the device. On the wall it is tilted (about the horizontal) and/or
  // rotated in the wall plane (diagonal), then pushed out until no part is behind
  // the wall. On a tripod it stands at a distance from the wall and height.
  _placeRig(gap, tallest) {
    const m = this.mount;
    const r = this.rig;
    const rad = Math.PI / 180;
    r.rotation.set(m.tilt * rad, 0, m.roll * rad, 'XYZ');
    if (m.type === 'tripod') r.position.set(0, m.height, m.dist);
    else r.position.set(0, this.barY, 0);
    r.updateMatrixWorld(true);
    if (m.type === 'wall') {
      let minZ = Infinity;
      const box = new THREE.Box3();
      for (const b of this.bars) {
        box.setFromObject(b.assembled[0]); // the wooden body
        minZ = Math.min(minZ, box.min.z);
      }
      if (minZ < 0.001) r.position.z += 0.001 - minZ;
      r.updateMatrixWorld(true);
    }
    // Tripod: three legs, a mast and a mounting plate behind the bars.
    this.stand.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    this.stand.clear();
    if (m.type === 'tripod') {
      const metal = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.45, metalness: 0.3 });
      const back = new THREE.Vector3(0, 0, -0.01);
      const headW = r.localToWorld(back.clone());
      const headY = headW.y - 0.06;
      const mastTop = new THREE.Vector3(headW.x, headY, headW.z - 0.02);
      const hub = new THREE.Vector3(mastTop.x, Math.min(0.75, headY - 0.1), mastTop.z);
      const seg = (a, b, rad) => {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, a.distanceTo(b), 12), metal);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        this.stand.add(mesh);
      };
      seg(hub, mastTop, 0.014);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        const foot = new THREE.Vector3(hub.x + 0.42 * Math.sin(a), 0.01, hub.z + 0.42 * Math.cos(a));
        seg(hub, foot, 0.011);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), metal);
        tip.position.copy(foot);
        this.stand.add(tip);
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), metal);
      head.position.copy(mastTop).add(new THREE.Vector3(0, 0.03, 0));
      this.stand.add(head);
      // Plate on the back of the device (tilts with it), holding one or two bars.
      const span = this.bars.length > 1 ? 2 * gap + tallest : tallest;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, span, 0.008), metal);
      plate.position.set(0, 0, -0.004);
      this.rig.add(plate);
      this._plate?.removeFromParent();
      this._plate = plate;
    } else {
      this._plate?.removeFromParent();
      this._plate = null;
    }
  }

  // Power: a USB-C cable from J1 on each bar's control end to a 5 V / 3 A adaptor
  // in a wall socket 30 cm above the floor (one cable per bar in compare mode).
  // 'concealed': the cable runs inside the wall, only the socket plate shows.
  _buildPower() {
    const P = this.power;
    P.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    P.clear();
    const mode = this.mount.cable ?? 'visible';
    if (mode === 'off' || !this.bars.length) return;
    const tripod = this.mount.type === 'tripod';
    const white = new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.45 });
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.6 });
    const n = this.bars.length;
    const { c } = this.deviceFrame();
    const maxL = Math.max(...this.bars.map((b) => b.L));
    // Socket: under the control end (wall mount), or beside the tripod.
    const sx = c.x + maxL / 2 + (tripod ? 0.55 : -0.04);
    const sy = 0.3;
    const plateW = n > 1 ? 0.146 : 0.086;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(plateW, 0.086, 0.009), white);
    plate.position.set(sx, sy, 0.0045);
    P.add(plate);
    if (mode === 'concealed' && !tripod) return; // cable inside the wall, nothing plugged in
    this.bars.forEach((b, i) => {
      const ox = sx + (n > 1 ? (i === 0 ? -0.03 : 0.03) : 0);
      // Adaptor plugged into the socket, cable leaving from its underside.
      const brick = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.056, 0.032), white);
      brick.position.set(ox, sy, 0.009 + 0.016);
      P.add(brick);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.006), new THREE.MeshBasicMaterial({ color: 0x9a978f }));
      label.position.set(ox, sy + 0.012, 0.0412);
      P.add(label);
      const end = new THREE.Vector3(ox, sy - 0.028, 0.025);
      // J1 position and the direction out of the end face, in world space.
      const j1 = b.group.localToWorld(new THREE.Vector3(b.L / 2 + 0.004, -b.H / 4, 0));
      const out = new THREE.Vector3(1, 0, 0).transformDirection(b.group.matrixWorld);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.011, 0.007), cableMat);
      boot.position.copy(j1).addScaledVector(out, 0.011);
      boot.quaternion.copy(b.group.getWorldQuaternion(new THREE.Quaternion()));
      P.add(boot);
      const start = j1.clone().addScaledVector(out, 0.022);
      const pts = [start, start.clone().addScaledVector(out, 0.035).add(new THREE.Vector3(0, -0.02, 0))];
      const z = 0.006 + i * 0.006; // along the wall surface
      if (tripod) {
        // Down behind the device to the mast, down the mast, across the floor.
        const mast = new THREE.Vector3(c.x + 0.025, 0, c.z - 0.04);
        pts.push(new THREE.Vector3(mast.x + 0.05, start.y - 0.12, mast.z), new THREE.Vector3(mast.x, 0.9, mast.z), new THREE.Vector3(mast.x, 0.45, mast.z));
        // Floor run lies on top of the rug (rug surface at 3 mm).
        pts.push(new THREE.Vector3(mast.x + 0.06, 0.014, mast.z - 0.08), new THREE.Vector3((mast.x + ox) / 2, 0.009, mast.z / 2), new THREE.Vector3(ox, 0.009, 0.03));
        pts.push(new THREE.Vector3(ox, sy - 0.12, 0.022), end);
      } else {
        // A short loop out of the end cap, then straight down the wall to the socket.
        const x1 = start.x + 0.05;
        pts.push(new THREE.Vector3(x1, start.y - 0.08, z + 0.006), new THREE.Vector3(x1 - 0.01, start.y - 0.25, z), new THREE.Vector3(ox + 0.02, sy + 0.25, z), new THREE.Vector3(ox + 0.01, sy - 0.07, 0.016), end);
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      P.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.0024, 8, false), cableMat));
    });
  }

  // World centre of the device and its facing direction (unit).
  deviceFrame() {
    const c = new THREE.Vector3();
    this.rig.getWorldPosition(c);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(this.rig.quaternion);
    return { c, n };
  }

  // CPU estimate of the wall halo for bar `index` (same model as the shader).
  // Samples the wall just above and below the device. Returns peak cd/m².
  haloPeak(index, emission, rho = 0.75) {
    const res = { peak: 0, at: '—' };
    const srcs = this.halo.sources.filter((s) => s.bar === index && s.o);
    if (!srcs.length || !emission) return res;
    const bar = this.bars[index];
    const n = Math.min(this.strip.count, emission.length / 4);
    const centre = new THREE.Vector3();
    bar.group.getWorldPosition(centre);
    const half = this.lightLen / 2000;
    const Y = (k) => 0.2126 * emission[k] + 0.7152 * emission[k + 1] + 0.0722 * emission[k + 2];
    for (const sgn of [1, -1]) {
      for (const off of [0.005, 0.015, 0.03, 0.06, 0.1, 0.2]) {
        const wy = centre.y + sgn * (bar.H / 2 + off);
        for (let j = 0; j < 40; j++) {
          const wx = centre.x - half + (j / 39) * 2 * half;
          let E = 0;
          for (const s of srcs) {
            const m = s.beam;
            const k = (m + 1) / (2 * Math.PI);
            const stY = 0.2126 * s.steady[0] + 0.7152 * s.steady[1] + 0.0722 * s.steady[2];
            for (let i = 0; i < n; i++) {
              const lm = s.follow * Y(i * 4) + stY;
              if (lm <= 0) continue;
              const px = s.o.x + i * s.step.x;
              const py = s.o.y + i * s.step.y;
              const pz = Math.max(0.0005, s.o.z + i * s.step.z);
              const dx = wx - px;
              const dy = wy - py;
              const dz = -pz;
              const r2 = dx * dx + dy * dy + dz * dz + 2.5e-5;
              const r = Math.sqrt(r2);
              const cosT = (dx * s.axis.x + dy * s.axis.y + dz * s.axis.z) / r;
              const cosA = pz / r;
              if (cosT <= 0) continue;
              E += (lm * k * cosT ** m * cosA) / r2;
            }
          }
          const L = (rho * E) / Math.PI;
          if (L > res.peak) {
            res.peak = L;
            res.at = `${(off * 1000).toFixed(0)} mm ${sgn > 0 ? 'above' : 'below'} the bar`;
          }
        }
      }
    }
    return res;
  }

  // Per frame: rear-light drive for one bar. follow = lumens per unit of front
  // emission (slot share × efficiency, or rear strip gain); steady = lm per LED;
  // front = share of light that still leaves through the face.
  setBack(index, { follow = 0, steady = [0, 0, 0], front = 1 } = {}) {
    const bar = this.bars[index];
    if (bar) bar.faceMat.uniforms.uFront.value = front;
    for (const s of this.halo.sources) {
      if (s.bar !== index) continue;
      s.follow = follow * s.share;
      s.steady = steady.map((v) => v * s.share);
    }
  }

  _renderHalo() {
    const h = this.halo;
    const on = h.sources.some((s) => s.follow > 0 || s.steady[0] + s.steady[1] + s.steady[2] > 0);
    h.overlay.visible = on;
    if (!on) return;
    const u = h.mat.uniforms;
    u.uNS.value = Math.min(4, h.sources.length);
    h.sources.slice(0, 4).forEach((s, i) => {
      u.uSrcO.value[i].copy(s.o);
      u.uSrcS.value[i].copy(s.step);
      u.uSrcA.value[i].copy(s.axis);
      u.uSrcP.value[i].set(s.beam, s.follow);
      u.uSteady.value[i].set(...s.steady);
    });
    u.uInvLref.value = 1 / this.lref;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(h.rt);
    r.render(h.scene, h.cam);
    r.setRenderTarget(prev);
  }

  setPsf(index, optics) {
    const bar = this.bars[index];
    if (!bar || !optics?.ready) return;
    const { nx, ny, rx } = optics.cfg.grid;
    // Half-float conversion is cached per PSF result, so rebuilding the scene reuses it.
    if (optics._halfSrc !== optics.psf) {
      const h = new Uint16Array(nx * ny * 4);
      const inv = 1 / optics.psfMax;
      for (let i = 0; i < h.length; i++) h[i] = THREE.DataUtils.toHalfFloat(optics.psf[i] * inv);
      optics._half = h;
      optics._halfSrc = optics.psf;
    }
    const half = optics._half;
    const old = bar.faceMat.uniforms.uPsf.value;
    let tex = old;
    if (!old || old.image.width !== nx || old.image.height !== ny) {
      old?.dispose();
      tex = new THREE.DataTexture(half, nx, ny, THREE.RGBAFormat, THREE.HalfFloatType);
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    } else {
      tex.image.data = half;
    }
    tex.needsUpdate = true;
    const u = bar.faceMat.uniforms;
    u.uPsf.value = tex;
    u.uRx.value = rx;
    u.uK.value = Math.min(48, Math.ceil(rx / (1000 / this.strip.ledsPerM)) + 1);
    bar.psfMax = optics.psfMax;
    u.uReady.value = 1;
    this._updateScale();
  }

  // Parts of one bar for the exploded view, in the bar's frame (x along the bar,
  // y up, z toward the viewer; the back of the body is at z = -D/2). Each part
  // has an assembled position and an explode offset; _applyExplode blends them.
  _buildExploded(group, st, strip, { L, H, D, lightLen, pitch, xEnd }) {
    const G = new THREE.Group();
    G.visible = false;
    group.add(G);
    const parts = [];
    const hs = st.housing;
    const W = st.width / 1000;
    const back = hs.back / 1000;
    const cav = stackDepth(st) / 1000;
    const capL = (L - lightLen) / 2;
    const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture(hs.species, hs.finish), roughness: FINISH_ROUGHNESS[hs.finish] ?? 0.6 });
    const add = (obj, pos, off, label, labelOff = [0, 0, 0]) => {
      obj.position.set(...pos);
      G.add(obj);
      const part = { obj, base: new THREE.Vector3(...pos), off: new THREE.Vector3(...off) };
      if (label) {
        const sp = partLabel(label);
        G.add(sp);
        part.label = sp;
        part.labelOff = new THREE.Vector3(...labelOff);
      }
      parts.push(part);
      return obj;
    };
    const box = (w, h, d, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x1a1612, transparent: true, opacity: 0.35 }));
      m.add(e);
      return m;
    };
    const zStrip = -D / 2 + back; // top of the back panel = LED side of the cavity
    // Explosion goes into the room (+z), one step per part in assembly order.
    const STEP = 0.07;
    const lx = (k) => -lightLen / 2 + 0.02 + ((0.11 * k) % 0.66); // label position along the bar, per step
    const nL = st.layers.length;
    // Wood: back panel, rails above and below the window, end caps.
    add(box(lightLen, H, back, woodMat), [0, 0, -D / 2 + back / 2], [0, 0, 0], `Back panel · ${hs.back} mm ${hs.species} (stays on the wall)`, [lx(0), H / 2 + 0.006, 0]);
    const railH = (H - W) / 2;
    add(box(lightLen, railH, cav, woodMat), [0, W / 2 + railH / 2, zStrip + cav / 2], [0, 0.02, STEP * (nL + 2)], `Top rail · ${hs.rail} mm`, [lx(nL + 2), railH / 2 + 0.004, 0]);
    add(box(lightLen, railH, cav, woodMat), [0, -W / 2 - railH / 2, zStrip + cav / 2], [0, -0.02, STEP * (nL + 2)], 'Bottom rail', [lx(nL + 2), -railH / 2 - 0.02, 0]);
    add(box(capL, H, D, woodMat), [-lightLen / 2 - capL / 2, 0, 0], [-0.03, 0, STEP * (nL + 3)], 'End cap', [-capL / 2, H / 2 + 0.006, 0]);
    add(box(capL, H, D, woodMat), [lightLen / 2 + capL / 2, 0, 0], [0.03, 0, STEP * (nL + 3)], 'Control end cap', [-capL / 2, H / 2 + 0.006, 0]);
    // LED strip: white PCB with one package per LED (colours follow the live output).
    const pcbW = Math.min(W, 0.01);
    const pcb = box(lightLen, pcbW, 0.0016, new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 }));
    add(pcb, [0, 0, zStrip + 0.0008], [0, 0, STEP], `LED strip · ${strip.count} × SK6812 RGBWW, ${strip.ledsPerM}/m`, [lx(1), pcbW / 2 + 0.004, 0]);
    const leds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.005, 0.005, 0.0016), new THREE.MeshBasicMaterial({ toneMapped: false }), strip.count);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < strip.count; i++) {
      m4.makeTranslation(-lightLen / 2 + (i + 0.5) * pitch, 0, 0.0016);
      leds.setMatrixAt(i, m4);
      leds.setColorAt(i, new THREE.Color(0.25, 0.24, 0.22));
    }
    pcb.add(leds);
    this._explodeLeds = this._explodeLeds ?? [];
    // Optical layers from the LED side to the face.
    let z = zStrip;
    st.layers.forEach((l, i) => {
      const t = l.t / 1000;
      const name = MATERIALS[l.materialId]?.label ?? l.materialId;
      const slab = box(lightLen, W, Math.max(0.0004, t), layerMaterial(l.materialId));
      add(slab, [0, 0, z + t / 2], [0, 0, STEP * (2 + i)], `${name} · ${l.t} mm${l.ink !== undefined ? ` · dose ${l.ink}` : ''}`, [lx(2 + i), W / 2 + 0.004, 0]);
      z += t;
    });
    // Control end: controller board, USB-C power socket, touch pads behind the marks.
    const xc = lightLen / 2 + capL / 2;
    const board = box(0.05, 0.022, 0.004, new THREE.MeshStandardMaterial({ color: 0x1f5c3a, roughness: 0.5 }));
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.016, 0.003), new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.3, roughness: 0.35 }));
    chip.position.z = 0.003;
    board.add(chip);
    add(board, [xc, 0, -D / 2 + back / 2 + 0.002], [0.03, 0.035, STEP * (nL + 4)], 'Controller · ESP32 (WLED)', [0.028, 0.006, 0]);
    const usb = box(0.012, 0.007, 0.009, new THREE.MeshStandardMaterial({ color: 0xb4b9bf, metalness: 0.3, roughness: 0.35 }));
    add(usb, [L / 2 - 0.006, -H / 4, 0], [0.07, -0.01, STEP * (nL + 4)], 'J1 · USB-C 5 V / 3 A', [0.012, -0.004, 0]);
    const copper = new THREE.MeshStandardMaterial({ color: 0xd08a52, metalness: 0.25, roughness: 0.4 }); // no env map: keep metalness low so it reads as copper
    [[1, xEnd - 0.012], [2, xEnd + 0.012]].forEach(([id, x]) => {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.0008, 24), copper);
      pad.rotation.x = Math.PI / 2;
      add(pad, [x, 0, D / 2 - 0.003], [0.03, -0.035, STEP * (nL + 3.5)], id === 1 ? 'Touch pad 1 · on/off' : 'Touch pad 2 · next', id === 1 ? [-0.03, -0.016, 0] : [0.006, -0.016, 0]);
    });
    if (st.back.mode === 'strip') {
      const rs = box(lightLen, 0.01, 0.0016, new THREE.MeshStandardMaterial({ color: 0xf2f0ea }));
      add(rs, [0, 0, -D / 2 - 0.001], [0, -0.02, 0], 'Rear strip (wall light)', [-lightLen / 2, -0.016, 0]);
    }
    this._explodeLeds.push(leds);
    return { group: G, parts, leds };
  }

  // 0 = assembled, 1 = fully exploded. The view eases toward the target.
  setExplode(target) {
    this.explodeTarget = target;
  }

  _applyExplode(dt) {
    const target = this.explodeTarget ?? 0;
    const cur = this.explodeT ?? 0;
    if (Math.abs(target - cur) < 1e-4 && this._explodeDone === target) return;
    // Steady, unhurried motion: a full take-apart takes EXPLODE_SECONDS.
    const step = dt / EXPLODE_SECONDS;
    const t = target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step);
    this.explodeT = t;
    this._explodeDone = this.explodeT === target ? target : null;
    const e = this.explodeT;
    const s = e * e * (3 - 2 * e);
    this.room.setFurnitureVisible(e < 0.05);
    this.power.visible = e < 0.05;
    for (const b of this.bars) {
      const on = e > 0.002;
      b.exploded.group.visible = on;
      for (const o of b.assembled) o.visible = !on;
      for (const p of b.exploded.parts) {
        p.obj.position.copy(p.base).addScaledVector(p.off, s);
        if (p.label) {
          p.label.position.copy(p.obj.position).add(p.labelOff);
          p.label.material.opacity = Math.max(0, (e - 0.5) * 2);
          p.label.visible = e > 0.5;
        }
      }
    }
  }

  setEmission(emission) {
    // The LED count can change a moment before the bars are rebuilt; copy what fits.
    const n = Math.min(emission.length, this.ledData.length);
    this.ledData.set(n === emission.length ? emission : emission.subarray(0, n));
    this.ledTex.needsUpdate = true;
    if ((this.explodeT ?? 0) > 0.002) {
      // Exploded: light each LED package with its output (lumens -> display level).
      const col = new THREE.Color();
      for (const b of this.bars) {
        const leds = b.exploded.leds;
        const k = 0.25 * Math.max(1, 300 / this.lref);
        for (let i = 0; i < leds.count && i * 4 + 2 < this.ledData.length; i++) {
          const d = this.ledData;
          col.setRGB(0.22 + d[i * 4] * k, 0.21 + d[i * 4 + 1] * k, 0.19 + d[i * 4 + 2] * k);
          leds.setColorAt(i, col);
        }
        leds.instanceColor.needsUpdate = true;
      }
    }
  }

  setIndicator(level) {
    this.indicator = level;
    const v = (level * 150) / this.lref; // ~150 cd/m² amber dot
    for (const b of this.bars) b.indMat.color.setRGB(v * 1.0, v * 0.45, v * 0.05);
  }

  setLighting({ lux, lref, bloom }) {
    if (lux !== undefined) this.lux = lux;
    if (lref !== undefined) this.lref = lref;
    if (bloom !== undefined) this.bloom.strength = bloom;
    this.applyLighting();
  }

  applyLighting() {
    // Illuminance in lux; Lambertian radiance = albedo·E/π, scene unit = lref cd/m².
    this.room.setLight(this.lux, this.lref);
    // Diffuser faces scatter room light back (albedo ~0.55, slightly warm).
    const amb = (0.55 * this.lux) / Math.PI / this.lref;
    for (const b of this.bars) b.faceMat.uniforms.uAmbient.value.set(amb, amb * 0.97, amb * 0.92);
    this._updateScale();
    this.setIndicator(this.indicator);
  }

  _updateScale() {
    for (const b of this.bars) if (b.psfMax) b.faceMat.uniforms.uScale.value = b.psfMax / this.lref;
  }

  setCamera(preset, viewerDistance = 1.5, { animate = false } = {}) {
    const c = this.camera;
    const L = (this.bars[0]?.L ?? 1) / 2;
    const { c: dc } = this.deviceFrame();
    // Presets in the device's frame (x along the bar, z out of the face), except
    // the client seat (eyes at 1.2 m, viewer distance in front of the device) and
    // the room view.
    const local = {
      close: [[-0.3, -0.02, 0.4], [-0.05, 0, 0]],
      end: [[L + 0.22, 0.06, 0.28], [L - 0.05, 0, 0]],
      oblique: [[-1.1, 0.1, 0.9], [0, 0, 0]],
      exploded: [[-L - 0.55, 0.4, 1.2], [0.05, -0.03, 0.32]],
    };
    const toWorld = (v) => this.rig.localToWorld(new THREE.Vector3(...v)).toArray();
    const presets = {
      viewer: [[dc.x, 1.2, dc.z + viewerDistance], dc.toArray()],
      overview: [[2.7, 1.95, 4.75], [-0.9, 1.05, 1.0]], // far corner: device wall, window, chairs
    };
    for (const [k, [p, t]] of Object.entries(local)) presets[k] = [toWorld(p), toWorld(t)];
    const [pos, tgt] = presets[preset] ?? presets.viewer;
    this.baseFov = preset === 'close' ? 35 : 42;
    this._fitFov();
    if (animate) {
      // Glide to the preset with the same timing as the explosion.
      this.camTween = {
        t: 0,
        p0: c.position.clone(),
        t0: this.controls.target.clone(),
        p1: new THREE.Vector3(...pos),
        t1: new THREE.Vector3(...tgt),
      };
      return;
    }
    this.camTween = null;
    c.position.set(...pos);
    this.controls.target.set(...tgt);
    this.controls.update();
  }

  _applyCamTween(dt) {
    const k = this.camTween;
    if (!k) return;
    k.t = Math.min(1, k.t + dt / EXPLODE_SECONDS);
    const s = k.t * k.t * (3 - 2 * k.t);
    this.camera.position.lerpVectors(k.p0, k.p1, s);
    this.controls.target.lerpVectors(k.t0, k.t1, s);
    if (k.t >= 1) this.camTween = null;
  }

  render() {
    if (this.contextLost) return;
    const now = performance.now();
    const fdt = Math.min(0.25, (now - (this._lastRender ?? now)) / 1000); // real time, so slow frames do not stretch animations
    this._applyExplode(fdt);
    this._applyCamTween(fdt);
    this._lastRender = now;
    this._renderHalo();
    this.controls.update();
    this.room.update(this.camera);
    this.composer.render();
  }
}
