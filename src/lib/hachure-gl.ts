// Draws the terrain strokes (terrain.ts) with WebGL2: every hachure and
// contour segment is one instance of a quad, expanded to a round-capped,
// antialiased capsule in the shaders. One draw call per frame, and frames
// are drawn only on demand: a gauge change, a resize, a theme flip.
//
// The golden path is a uniform: a gold-set stroke at position t along the
// river turns gold once t ≤ uProgress, with a short feather at the front.

import { STRIDE } from './terrain';

export type RGB = [number, number, number];
export interface Look {
  ink: RGB; gold: RGB;
  hachure: number; contour: number; index: number; goldAlpha: number;   // alphas
}
export interface Frame {
  cell: number;                                            // CSS px per grid cell
  hole: { x0: number; y0: number; x1: number; y1: number }; // CSS px, kept clear
  soft: number;                                            // px over which the map fades in from the hole
  fade: [from: number, to: number];                        // y in CSS px: the map fades out downwards
  progress: number;                                        // 0…1 along the golden path
}

const VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSeg;
layout(location = 2) in vec2 aWK;
uniform vec2 uView;
uniform float uCell;
uniform float uProgress;
out vec2 vPos;
flat out vec4 vSeg;
flat out float vHalf;
flat out vec2 vKind;
void main() {
  vec2 p0 = aSeg.xy * uCell, p1 = aSeg.zw * uCell;
  float k = aWK.y;
  float w = k <= -1.5 ? 0.75 : mix(0.6, 1.4, aWK.x);
  float g = k >= 0.0 ? 1.0 - smoothstep(uProgress - 0.03, uProgress, k) : 0.0;
  w *= mix(1.0, 1.3, g);
  float half_ = 0.5 * w;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float pad = half_ + 1.0;
  vec2 pos = p0 + dir * (aCorner.x * (len + 2.0 * pad) - pad) + nrm * aCorner.y * pad;
  vPos = pos; vSeg = vec4(p0, p1); vHalf = half_; vKind = vec2(k, g);
  vec2 clip = pos / uView * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vPos;
flat in vec4 vSeg;
flat in float vHalf;
flat in vec2 vKind;
uniform vec3 uInk, uGold;
uniform vec4 uAlpha;     // hachure, contour, index contour, gold
uniform vec4 uHole;
uniform float uSoft, uDpr;
uniform vec2 uFade;
out vec4 outColor;
void main() {
  vec2 pa = vPos - vSeg.xy, ba = vSeg.zw - vSeg.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h);
  float cover = clamp((vHalf - d) * uDpr + 0.5, 0.0, 1.0);
  vec2 q = max(uHole.xy - vPos, vPos - uHole.zw);
  float m = smoothstep(0.0, uSoft, length(max(q, 0.0)));
  m *= 1.0 - smoothstep(uFade.x, uFade.y, vPos.y);
  float k = vKind.x, g = vKind.y;
  float base = k <= -2.5 ? uAlpha.z : (k <= -1.5 ? uAlpha.y : uAlpha.x);
  float a = mix(base, uAlpha.w, g) * cover * m;
  outColor = vec4(mix(uInk, uGold, g) * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

export interface Renderer {
  upload(data: Float32Array, count: number): void;
  resize(width: number, height: number): void;
  draw(frame: Frame, look: Look): void;
}

/** A renderer on the canvas, or null where WebGL2 is not available. */
export function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
  if (!gl) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const U = {
    view: u('uView'), cell: u('uCell'), progress: u('uProgress'), ink: u('uInk'), gold: u('uGold'),
    alpha: u('uAlpha'), hole: u('uHole'), soft: u('uSoft'), dpr: u('uDpr'), fade: u('uFade'),
  };

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE * 4, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE * 4, 16);
  gl.vertexAttribDivisor(2, 1);

  let count = 0, cssW = 1, cssH = 1, dpr = 1;

  return {
    upload(data, n) {
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      count = n;
    },
    resize(width, height) {
      cssW = width;
      cssH = height;
      // at most 2× and within the GPU's comfortable 4096 px
      dpr = Math.min(window.devicePixelRatio || 1, 2, 4096 / width, 4096 / height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    },
    draw(f, look) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!count) return;
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(U.view, cssW, cssH);
      gl.uniform1f(U.cell, f.cell);
      gl.uniform1f(U.progress, f.progress);
      gl.uniform3fv(U.ink, look.ink);
      gl.uniform3fv(U.gold, look.gold);
      gl.uniform4f(U.alpha, look.hachure, look.contour, look.index, look.goldAlpha);
      gl.uniform4f(U.hole, f.hole.x0, f.hole.y0, f.hole.x1, f.hole.y1);
      gl.uniform1f(U.soft, f.soft);
      gl.uniform1f(U.dpr, dpr);
      gl.uniform2f(U.fade, f.fade[0], f.fade[1]);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    },
  };
}

/** #RRGGBB to 0…1 floats. */
export function hexRGB(hex: string, fallback: RGB): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
