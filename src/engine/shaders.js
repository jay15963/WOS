// All GLSL (WebGL2 / GLSL ES 3.00).
// World coords: 1 unit = 1 tile, x right, y DOWN. Screen clip: y up.

export const FULL_VS = `#version 300 es
out vec2 vUV;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SPRITE_ATTRIBS = `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec2 aPos;
layout(location=2) in vec2 aSize;
layout(location=3) in vec2 aAnchor;
layout(location=4) in vec4 aUV;
layout(location=5) in vec4 aColor;
layout(location=6) in vec4 aParams; // sway, rot, flash, flip
layout(location=7) in vec2 aExtra;  // recvShadow, lift
uniform vec2 uCam;
uniform vec2 uScale;   // clip units per world unit
uniform float uTime;
uniform float uWind;   // 0..1 wind strength
uniform vec2 uWindDir; // wind direction (world, y down)
uniform vec2 uWindPh;  // accumulated phases: x = sway oscillation, y = travelling wind waves
`;

// travelling wind waves rolling over grass fields (0..1). Shared by the sprite sway and the terrain
// grass sheen so tufts bend exactly where the ground brightens. ph = accumulated wave phase.
const WAVE_FN = `
float windWave(vec2 p, vec2 dir, float ph){
  vec2 pp = vec2(-dir.y, dir.x);
  float s = dot(p, dir) * 0.32 - ph + sin(dot(p, pp) * 0.19 + ph * 0.06) * 1.4 + sin(dot(p, pp) * 0.071 - 1.3) * 2.2;
  float k = 0.5 + 0.5 * sin(s);
  return k * k * k;
}
`;

// sway displacement shared by sprite & shadow shaders. Calm by design: the oscillation frequency is
// almost constant (CPU-integrated phase, ~1.0–1.3 rad/s; trees ×0.9, grass ×1.2–1.3) and only the
// AMPLITUDE follows the (low-passed) wind, with caps. uWindPh wraps at 100·2π, so every multiplier of a
// phase keeps m·100 integer (fr is quantized to 0.05 steps, harmonic ×1.6). Mirror: wind bench in the
// C-agent report (keep both in sync if you tune it).
const SWAY_FN = `${WAVE_FN}
vec2 swayLocal(vec2 c, vec2 local){
  float top = clamp(aAnchor.y - c.y, 0.0, 1.0);
  float sw = clamp(aParams.x, 0.0, 0.2);
  float fr = floor((0.8 + min(sw, 0.15) * 3.3) * 20.0 + 0.5) * 0.05;
  float ph = uWindPh.x * fr + aPos.x * 0.63 + aPos.y * 0.37;
  float slow = sin(uTime * 0.31 + aPos.x * 0.09 + aPos.y * 0.05) * 0.5 + 0.5;
  float w = clamp(uWind, 0.0, 1.1);
  float k = sw * top * top * aSize.y * (0.55 + 0.6 * w);
  float s = sin(ph) * 0.6 + sin(ph * 1.6 + 1.7) * 0.2;
  local.x += s * k;
  // steady bend down-wind (slowly breathing) + the passing wind wave (y foreshortened by the 3/4 view)
  float wv = windWave(aPos, uWindDir, uWindPh.y);
  float bend = (0.15 + 0.5 * w) * (0.55 + 0.45 * slow) + wv * (0.2 + 0.55 * w);
  local += vec2(uWindDir.x, uWindDir.y * 0.4) * bend * k;
  return local;
}
vec2 rotLocal(vec2 l, float r){
  float cs = cos(r), sn = sin(r);
  return vec2(l.x * cs - l.y * sn, l.x * sn + l.y * cs);
}
`;

export const SPRITE_VS = `#version 300 es
${SPRITE_ATTRIBS}
out vec2 vUV;
out vec4 vColor;
out float vFlash;
out float vRecv;
out vec2 vLocal;
${SWAY_FN}
void main(){
  vec2 c = aCorner;
  vec2 local = (c - aAnchor) * aSize;
  local = rotLocal(local, aParams.y);
  if (aParams.x > 0.0) local = swayLocal(c, local);
  vec2 w = aPos + local;
  w.y -= aExtra.y;
  vec2 clip = (w - uCam) * uScale;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vec2 tc = c;
  if (aParams.w < 0.0) tc.x = 1.0 - tc.x;
  vUV = mix(aUV.xy, aUV.zw, tc);
  vColor = aColor;
  // grass tufts catch the light as a wind wave bends them (silvery sheen rolling over the fields)
  if (aParams.x > 0.09) vColor.rgb *= 1.0 + windWave(aPos, uWindDir, uWindPh.y) * (0.04 + 0.1 * uWind);
  vFlash = aParams.z;
  vRecv = aExtra.x;
  vLocal = c;
}`;

export const SPRITE_FS = `#version 300 es
precision mediump float;
in vec2 vUV; in vec4 vColor; in float vFlash; in float vRecv; in vec2 vLocal;
uniform sampler2D uTex;
uniform sampler2D uShadow;
uniform vec2 uViewport;
uniform float uShadowStr;
out vec4 o;
void main(){
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.003) discard;
  vec4 c = vec4(t.rgb * vColor.rgb, t.a) * vColor.a;
  c.rgb = mix(c.rgb, vec3(c.a), clamp(vFlash, 0.0, 1.0));
  if (vRecv > 0.0) {
    float s = texture(uShadow, gl_FragCoord.xy / uViewport).r;
    c.rgb *= 1.0 - s * uShadowStr * vRecv;
  }
  o = c;
}`;

// Sun shadow: sprite silhouette sheared along uShadowDir by its height above the anchor.
export const SHADOW_VS = `#version 300 es
${SPRITE_ATTRIBS}
uniform vec2 uShadowDir;
out vec2 vUV;
out float vA;
${SWAY_FN}
void main(){
  vec2 c = aCorner;
  vec2 local = (c - aAnchor) * aSize;
  local = rotLocal(local, aParams.y);
  if (aParams.x > 0.0) local = swayLocal(c, local);
  float h = max(0.0, -local.y) + aExtra.y;
  vec2 base = vec2(local.x, max(local.y, 0.0) * 0.6);
  vec2 w = aPos + base + uShadowDir * h;
  vec2 clip = (w - uCam) * uScale;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vec2 tc = c;
  if (aParams.w < 0.0) tc.x = 1.0 - tc.x;
  vUV = mix(aUV.xy, aUV.zw, tc);
  vA = aColor.a;
}`;

export const SHADOW_FS = `#version 300 es
precision mediump float;
in vec2 vUV; in float vA;
uniform sampler2D uTex;
out vec4 o;
void main(){
  float a = texture(uTex, vUV).a * vA;
  if (a < 0.01) discard;
  o = vec4(a, a, a, 1.0);
}`;

// Point light: radial falloff, additive into the lightmap (stored at half intensity).
export const LIGHT_FS = `#version 300 es
precision mediump float;
in vec2 vUV; in vec4 vColor; in float vFlash; in float vRecv; in vec2 vLocal;
out vec4 o;
void main(){
  vec2 d = vLocal * 2.0 - 1.0;
  float r = dot(d, d);
  float f = max(0.0, 1.0 - r);
  f = f * f * (0.6 + 0.4 * f);
  o = vec4(vColor.rgb * vColor.a * f * 0.5, 1.0);
}`;

// Ambient light (light target, half res): env.ambient, dimmed to uCaveAmb inside mined mountain caves.
// Point lights are added on top afterwards, so torches light caves fully.
export const AMBIENT_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uCave;   // R = cave darkness (see world.js caveData)
uniform vec2 uCam, uView, uWorld;
uniform vec3 uAmb, uCaveAmb;
void main(){
  vec2 wp = uCam + vec2(vUV.x - 0.5, 0.5 - vUV.y) * uView;
  float c = texture(uCave, wp / uWorld).r;
  c = pow(c, 1.4);   // keep the spill onto the surrounding rock tight
  o = vec4(mix(uAmb, min(uAmb, uCaveAmb), c) * 0.5, 1.0);
}`;

// Terrain decals (drawn right after the terrain, before any sprite): one quad per tile that needs
// detail the main terrain shader should not pay for everywhere — ore deposits on the rock tops and
// loose rubble on rough stone floors (tunnels, mountain feet). World code lists the tiles per chunk
// (world.js chunk.decals); the ambient system adds the quads (B.decal.addRaw: r = kind 0 ore / 1 rubble).
// Output is premultiplied "over" compositing on the finished terrain, so cost is paid only on those tiles.
export const DECAL_VS = `#version 300 es
${SPRITE_ATTRIBS}
out vec2 vW;
out float vKind;
void main(){
  vec2 w = aPos + (aCorner - aAnchor) * aSize;
  vec2 clip = (w - uCam) * uScale;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vW = w;
  vKind = aColor.r;
}`;

export const DECAL_FS = `#version 300 es
precision highp float;
in vec2 vW;
in float vKind;
out vec4 o;
uniform vec2 uWorld, uViewport;
uniform float uTime;
uniform sampler2D uTile, uNoise, uField, uCave, uShadow;
uniform vec3 uSun;
uniform float uSunI, uShadowStr, uWet;
uniform vec2 uShadowDir;

// mean albedo of the rock types (granite, limestone, slate, marble) for loose rubble
const vec3 ROCKC[4] = vec3[4](vec3(0.53, 0.49, 0.475), vec3(0.63, 0.595, 0.515), vec3(0.36, 0.37, 0.4), vec3(0.72, 0.715, 0.69));

float PPX;
vec4 ACC = vec4(0.0);   // premultiplied result: rgb + coverage
void over(vec3 c, float a){ a = clamp(a, 0.0, 1.0); ACC.rgb = c * a + ACC.rgb * (1.0 - a); ACC.a = a + ACC.a * (1.0 - a); }
void darken(float a){ over(vec3(0.0), a); }

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float nLod(float s){ return max(log2(PPX * s * 256.0), 0.0); }
vec4 tileAt(ivec2 c){ return texelFetch(uTile, clamp(c, ivec2(0), ivec2(uWorld) - 1), 0); }
float oreOf(ivec2 c){ return floor(tileAt(c).a * 255.0 + 0.5); }
vec4 fieldAt(vec2 p){ return texture(uField, p / uWorld); }

// ---------- ore deposits ----------
// Broad mineral staining that follows the ore tiles (readable from afar). ty = ore id, cov = coverage.
void oreStain(vec2 wp, vec4 nA, vec4 nB, float ty, float cov, float lf){
  if (ty < 1.5) {        // copper: green patina streaks
    float s = smoothstep(0.5, 0.8, textureLod(uNoise, wp * vec2(0.9, 0.35) + 0.3, nLod(0.9)).g + (nB.x - 0.5) * 0.4);
    over(vec3(0.34, 0.45, 0.39) * lf, cov * 0.3);
    over(vec3(0.16, 0.46, 0.38) * (0.55 + 0.45 * nA.z) * lf, cov * s * 0.4);
  } else if (ty < 2.5) { // iron: rust / ochre bleeding around the nodules
    float s = smoothstep(0.4, 0.75, nB.y + (nA.x - 0.5) * 0.5);
    over(vec3(0.5, 0.31, 0.2) * lf, cov * (0.3 + 0.22 * s));
    over(vec3(0.42, 0.22, 0.13) * (0.7 + 0.3 * nA.z) * lf, cov * s * 0.22);
  } else if (ty < 3.5) { // coal: sooty banded seam
    float band = 0.5 + 0.5 * sin(dot(wp, vec2(0.55, 1.35)) * 4.2 + nA.y * 7.0);
    darken(cov * (0.34 + 0.14 * band));
  } else if (ty < 4.5) { // gold: white quartz veins
    float r = 1.0 - abs(textureLod(uNoise, wp * 0.3 + 0.71, nLod(0.3)).b * 2.0 - 1.0);
    float r2 = 1.0 - abs(textureLod(uNoise, wp * 0.62 + 0.2, nLod(0.62)).a * 2.0 - 1.0);
    float q = max(smoothstep(0.9, 0.965, r), smoothstep(0.94, 0.985, r2) * 0.8);
    over(vec3(0.66, 0.6, 0.46) * lf, cov * 0.16);
    over(vec3(0.9, 0.89, 0.84) * (0.8 + 0.2 * nA.z) * lf, q * cov * 0.85);
  } else {               // jade: smooth serpentine green host rock
    float s = smoothstep(0.35, 0.7, nB.w + (nA.y - 0.5) * 0.4);
    over(vec3(0.34, 0.44, 0.37) * lf, cov * 0.32);
    over(vec3(0.2, 0.42, 0.3) * (0.75 + 0.35 * nA.z) * lf, cov * s * 0.3);
  }
}

// One layer of ore pieces: cells of 1/sc tiles, each maybe holding a piece of the ore found in the
// tile under the cell centre. Ld / LI = light dir / intensity, sdir = unit cast-shadow direction.
void oreCells(vec2 wp, float sc, float seed, float skip, float rs, vec3 Ld, float LI, vec2 sdir){
  vec2 p = wp * sc;
  vec2 c = floor(p), f = fract(p);
  vec2 h1 = hash22(c + seed), h2 = hash22(c + seed + 19.19);
  float ov = oreOf(ivec2(floor((c + 0.5) / sc)));
  if (ov < 0.5 || h1.x < skip * (ov > 4.5 ? 0.4 : 1.0)) return;
  vec2 d = f - (0.36 + 0.28 * h2);
  vec3 Hh = normalize(Ld + vec3(0.0, 0.0, 1.0));
  float lk = 0.35 + 0.65 * LI;
  float aa = PPX * sc * 1.5;   // ~1.5 px in cell units
  if (ov < 1.5) {
    // COPPER: hammered orange metal nuggets crusted with banded malachite
    float a = atan(d.y, d.x);
    float r = (0.2 + 0.13 * h1.y) * rs;
    float rr = r * (1.0 + 0.16 * sin(a * 3.0 + h1.y * 40.0) + 0.09 * sin(a * 5.0 + h2.x * 30.0));
    float dist = length(d) / rr;
    float dsh = length(d - sdir * r * 0.45) / rr;
    darken(0.45 * (1.0 - smoothstep(0.75, 1.2, dsh)) * smoothstep(0.92, 1.0, dist));
    if (dist < 1.0) {
      vec3 n = normalize(vec3(d / rr * 1.2, sqrt(max(1.0 - dist * dist, 0.0)) + 0.15));
      n = normalize(n + vec3((hash22(floor((f + h1) * 10.0)) - 0.5) * 0.4, 0.0));
      float l = max(dot(n, Ld), 0.0);
      vec3 base = vec3(0.84, 0.44, 0.2);
      vec3 c2 = base * (0.3 + 0.75 * l * lk);
      c2 += vec3(1.0, 0.72, 0.48) * pow(max(dot(n, Hh), 0.0), 22.0) * (0.25 + 0.9 * LI);
      float crust = smoothstep(0.52, 0.74, hash12(floor((f + h2) * 6.0) + c) * 0.65 + dist * 0.45);
      float band = 0.5 + 0.5 * sin(dist * 28.0 + h1.y * 9.0);
      vec3 mal = mix(vec3(0.08, 0.38, 0.30), vec3(0.32, 0.74, 0.56), band) * (0.5 + 0.6 * l);
      c2 = mix(c2, mal, crust);
      c2 = mix(c2, base * 0.12, smoothstep(0.8, 0.98, dist));
      over(c2, 1.0 - smoothstep(1.0 - aa / rr, 1.0, dist));
    }
  } else if (ov < 2.5) {
    // IRON: clusters of dark red-brown kidney nodules (hematite) with steely highlights, rusty skirts
    float best = 9.0, bsh = 9.0;
    vec2 bd = vec2(0.0);
    for (int k = 0; k < 3; k++) {
      vec2 hk = hash22(c + seed + float(k) * 3.7);
      vec2 ok = (hk - 0.5) * 0.3 * rs;
      float rk = (0.11 + 0.08 * hk.y) * rs;
      vec2 dk = (d - ok) / rk;
      float dd = length(dk);
      bsh = min(bsh, length(d - ok - sdir * rk * 0.5) / rk);
      if (dd < best) { best = dd; bd = dk; }
    }
    over(vec3(0.45, 0.27, 0.17) * (0.6 + 0.4 * lk), 0.35 * (1.0 - smoothstep(1.0, 2.3, best)));
    darken(0.45 * (1.0 - smoothstep(0.8, 1.25, bsh)) * smoothstep(0.92, 1.0, best));
    if (best < 1.0) {
      vec3 n = normalize(vec3(bd * 1.1, sqrt(max(1.0 - best * best, 0.0)) + 0.1));
      float l = max(dot(n, Ld), 0.0);
      vec3 c2 = vec3(0.36, 0.15, 0.11) * (0.35 + 0.8 * l * lk);
      c2 += vec3(0.74, 0.72, 0.76) * pow(max(dot(n, Hh), 0.0), 30.0) * (0.3 + 0.9 * LI);
      c2 = mix(c2, vec3(0.7, 0.35, 0.15) * (0.5 + 0.5 * l), smoothstep(0.62, 0.92, best) * 0.7);
      c2 = mix(c2, vec3(0.1, 0.045, 0.03), smoothstep(0.88, 1.0, best));
      over(c2, 1.0 - smoothstep(0.93, 1.0, best));
    }
  } else if (ov < 3.5) {
    // COAL: irregular angular black lumps, a glint on the facets that face the light
    float sides = 5.0 + floor(h2.y * 2.0), seg = 6.2832 / sides, rot = h1.y * 6.2832;
    float a = atan(d.y, d.x) + rot;
    float fi = floor(a / seg), an = (fi + 0.5) * seg;
    float r = (0.2 + 0.13 * h1.y) * rs * (0.82 + 0.3 * hash12(vec2(fi, h2.x * 91.0)));
    float dist = length(d) * cos(a - an) / r;
    vec2 dsv = d - sdir * r * 0.4;
    float as2 = atan(dsv.y, dsv.x) + rot;
    float dsh = length(dsv) * cos(as2 - (floor(as2 / seg) + 0.5) * seg) / r;
    darken(0.5 * (1.0 - smoothstep(0.85, 1.15, dsh)) * smoothstep(0.93, 1.0, dist));
    if (dist < 1.0) {
      float ang = an - rot;
      float top = smoothstep(0.45, 0.8, dist);                 // flat top, bevelled facets
      vec3 n = normalize(vec3(vec2(cos(ang), sin(ang)) * top * 0.9, 1.0));
      float l = max(dot(n, Ld), 0.0);
      vec3 c2 = vec3(0.055, 0.054, 0.06) * (0.75 + 0.7 * l);
      c2 += vec3(0.5, 0.54, 0.62) * pow(max(dot(n, Hh), 0.0), 70.0) * (0.25 + 0.75 * LI) * top;
      c2 += vec3(0.1, 0.105, 0.12) * pow(max(dot(n, Hh), 0.0), 6.0) * 0.5 * (1.0 - top);   // waxy top
      over(c2, 1.0 - smoothstep(1.0 - aa / r, 1.0, dist));
    }
  } else if (ov < 4.5) {
    // GOLD: bright flecks that twinkle
    for (int k = 0; k < 3; k++) {
      vec2 hk = hash22(c + seed + float(k) * 5.3);
      vec2 dk = f - (0.15 + 0.7 * hk);
      float a = atan(dk.y, dk.x);
      float r = (0.055 + 0.05 * hk.y) * rs * 1.5 * (1.0 + 0.3 * sin(a * 3.0 + hk.x * 20.0));
      float dist = length(dk) / r;
      if (dist < 1.0) {
        vec3 n = normalize(vec3(dk / r * 0.9, 1.0));
        n = normalize(n + vec3((hash22(floor((f + hk) * 24.0)) - 0.5) * 0.7, 0.0));
        float l = max(dot(n, Ld), 0.0);
        vec3 c2 = vec3(1.0, 0.77, 0.22) * (0.5 + 0.75 * l * lk);
        c2 += vec3(1.0, 0.94, 0.62) * pow(max(dot(n, Hh), 0.0), 16.0) * (0.45 + LI);
        c2 = mix(c2, vec3(0.42, 0.28, 0.05), smoothstep(0.72, 1.0, dist));
        over(c2, 1.0 - smoothstep(0.85, 1.0, dist));
      }
      float tw = pow(max(sin(uTime * (1.7 + hk.y) + hk.x * 40.0), 0.0), 30.0);
      float star = tw * (exp(-abs(dk.x) * 90.0) * exp(-abs(dk.y) * 14.0) + exp(-abs(dk.y) * 90.0) * exp(-abs(dk.x) * 14.0));
      ACC.rgb += vec3(1.0, 0.92, 0.65) * star * (0.8 + LI);
    }
  } else {
    // JADE: translucent green prisms growing from a common base
    for (int k = 0; k < 3; k++) {
      vec2 hk = hash22(c + seed + float(k) * 7.1);
      if (k == 2 && hk.x < 0.45) break;
      float ang = h1.y * 6.2832 + (float(k) - 1.0) * (0.75 + 0.45 * hk.x);
      vec2 dir = vec2(cos(ang), sin(ang)), pd = vec2(-dir.y, dir.x);
      float Lk = (0.3 + 0.16 * hk.y) * rs, wk = (0.075 + 0.04 * hk.x) * rs;
      vec2 q = d + dir * wk * 0.8;
      float u = dot(q, dir), v = dot(q, pd);
      vec2 qs = q - sdir * 0.06 * rs;
      float us = dot(qs, dir), vs = dot(qs, pd);
      float wsh = wk * clamp((Lk - us) / (wk * 1.3), 0.0, 1.0);
      if (us > 0.0 && us < Lk && abs(vs) < wsh) darken(0.32);
      float wv = wk * clamp((Lk - u) / (wk * 1.3), 0.0, 1.0);
      if (u > -wk * 0.3 && u < Lk && abs(v) < wv) {
        float side = v < 0.0 ? -1.0 : 1.0;
        float tip = smoothstep(Lk - wk * 1.3, Lk, u);
        vec3 n = normalize(vec3(pd * side * 0.85 + dir * tip * 0.6, 1.0));
        float l = max(dot(n, Ld), 0.0);
        float ev = abs(v) / max(wv, 1e-4);
        vec3 c2 = mix(vec3(0.05, 0.28, 0.17), vec3(0.26, 0.7, 0.45), 0.3 + 0.7 * l * lk);
        c2 += vec3(0.12, 0.34, 0.2) * (1.0 - ev) * (0.45 + 0.55 * u / Lk);   // light scattered inside
        c2 += vec3(0.78, 1.0, 0.86) * pow(max(dot(n, Hh), 0.0), 40.0) * (0.3 + 0.9 * LI);
        c2 = mix(c2, vec3(0.03, 0.15, 0.08), smoothstep(0.8, 1.0, ev) * 0.75);
        over(c2, 1.0 - smoothstep(1.0 - aa / max(wv, 1e-3), 1.0, ev));
      }
    }
  }
}

// ---------- loose rubble on rough stone floors ----------
// A stone exists if its cell centre lies on a stone-floor tile; denser along the walls and in tunnels.
void rubble(vec2 wp, float sc, float seed, vec3 Ld, vec2 sdir, float shade){
  vec2 p = wp * sc;
  vec2 c = floor(p), f = fract(p);
  vec2 h = hash22(c + seed);
  vec2 cw = (c + 0.5) / sc;
  vec4 tc = tileAt(ivec2(floor(cw)));
  if (floor(tc.r * 255.0 + 0.5) != 6.0) return;            // only on rough stone ground
  float wallN = smoothstep(0.02, 0.42, fieldAt(cw).r);
  float mined = texture(uCave, cw / uWorld).a;
  float dens = (0.1 + 0.42 * wallN) * (0.65 + 0.35 * mined) + mined * 0.06;
  if (h.x > dens) return;
  vec2 h2 = hash22(c + seed + 7.13);
  vec2 d = f - (0.3 + 0.4 * h2);
  float a = atan(d.y, d.x);
  float r = 0.14 + 0.2 * h.y;
  float rr = r * (1.0 + 0.2 * sin(a * 3.0 + h.y * 30.0) + 0.1 * sin(a * 5.0 + h2.x * 20.0));
  float dist = length(d) / rr;
  float dsh = length(d - sdir * r * 0.5) / rr;
  darken(0.38 * (1.0 - smoothstep(0.7, 1.2, dsh)) * smoothstep(0.9, 1.0, dist));
  if (dist < 1.0) {
    vec3 n = normalize(vec3(d / rr * 1.15, sqrt(max(1.0 - dist * dist, 0.0)) + 0.3));
    float l = max(dot(n, Ld), 0.0);
    vec3 sc0 = ROCKC[int(clamp(floor(tc.b * 255.0 + 0.5) - 1.0, 0.0, 3.0))];
    vec3 st = sc0 * (0.8 + 0.4 * h2.y) * (0.5 + 0.62 * l) * shade;
    st *= 1.0 - 0.45 * smoothstep(0.75, 1.0, dist);
    over(st, 1.0 - smoothstep(0.86, 1.0, dist));
  }
}

void main(){
  vec2 wp = vW;
  PPX = max(abs(dFdx(wp.x)), 1e-5);
  vec4 nA = texture(uNoise, wp * 0.093);
  vec4 nB = texture(uNoise, wp * 0.29 + 0.5);
  vec4 CV = texture(uCave, wp / uWorld);
  float cave = CV.r, outK = 1.0 - cave;
  vec3 Ld = normalize(mix(uSun, vec3(-0.35, -0.45, 0.82), cave));
  float LI = mix(uSunI, 0.8, cave);
  vec2 sdirU = normalize(mix(normalize(uShadowDir + vec2(1e-4, 0.0)), vec2(0.6, 0.8), cave));
  // rock edge as signed distance (tiles, + inside) — identical to the terrain shader
  vec2 rq = wp + (nB.zw - 0.5) * 0.22 + (nA.zw - 0.5) * 0.2;
  vec4 Fr = fieldAt(rq);
  float sd = -9.0;
  if (Fr.r > 0.004) {
    const float E = 0.18;
    vec4 Fx = fieldAt(rq + vec2(E, 0.0)), Fy = fieldAt(rq + vec2(0.0, E));
    vec2 gr = vec2(Fx.r - Fr.r, Fy.r - Fr.r) / E;
    sd = (Fr.r - 0.5) / max(length(gr), 0.32);
  }
  float shadowMask;
  if (vKind < 0.5) {
    // ore deposits on the rock top (clear of the outline / bevel)
    if (sd < 0.16) discard;
    vec2 oq = wp + (nB.zw - 0.5) * 0.5 - 0.5;
    ivec2 oi = ivec2(floor(oq));
    vec4 ov = vec4(oreOf(oi), oreOf(oi + ivec2(1, 0)), oreOf(oi + ivec2(0, 1)), oreOf(oi + ivec2(1, 1)));
    float edge = smoothstep(0.16, 0.4, sd);
    if (ov.x + ov.y + ov.z + ov.w > 0.5) {
      vec2 of = smoothstep(0.0, 1.0, fract(oq));
      vec4 wh = vec4((1.0 - of.x) * (1.0 - of.y), of.x * (1.0 - of.y), (1.0 - of.x) * of.y, of.x * of.y) * step(0.5, ov);
      float ty = wh.x >= max(wh.y, max(wh.z, wh.w)) ? ov.x : (wh.y >= max(wh.z, wh.w) ? ov.y : (wh.z >= wh.w ? ov.z : ov.w));
      float cov = smoothstep(0.15, 0.7, wh.x + wh.y + wh.z + wh.w + (nA.z - 0.5) * 0.35) * edge;
      oreStain(wp, nA, nB, ty, cov, 0.62 + 0.4 * LI);
    }
    oreCells(wp, 1.3, 3.7, 0.2, 1.0, Ld, LI, sdirU);
    oreCells(wp + 0.37, 2.5, 11.3, 0.55, 0.8, Ld, LI, sdirU);
    ACC *= edge;
    shadowMask = 0.4;
  } else {
    // rubble on the floor (not on the rock)
    if (sd > -0.03) discard;
    float ao = 1.0 - 0.36 * pow(1.0 - clamp(-sd / 1.35, 0.0, 1.0), 2.0);
    float shade = ao * (1.0 - 0.15 * uWet * outK);
    rubble(wp, 2.7, 1.7, Ld, sdirU, shade);
    if (PPX < 0.03) rubble(wp + 0.43, 4.6, 8.9, Ld, sdirU, shade);
    ACC *= smoothstep(-0.03, -0.12, sd);
    shadowMask = 1.0;
  }
  if (ACC.a < 0.002 && dot(ACC.rgb, vec3(1.0)) < 0.002) discard;
  // the same sprite sun shadows the terrain received
  float sh = texture(uShadow, gl_FragCoord.xy / uViewport).r;
  ACC.rgb *= 1.0 - sh * uShadowStr * shadowMask * outK * vec3(1.0, 0.96, 0.86);
  o = ACC;
}`;

// Ground, rock (mountains), water. One fullscreen pass, world-space.
// Extra uniforms (uRain, uSunWarm, uCloud, uCloudVel...) come from env.extra (0 = neutral defaults).
export const TERRAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUV;
out vec4 o;
uniform vec2 uCam, uView, uWorld;
uniform float uTime;
uniform sampler2D uTile;    // R ground id, G random, B rock type (regional 1..4), A ore (1 copper, 2 iron, 3 coal, 4 gold, 5 jade)
uniform sampler2D uField;   // 4x res, linear: R rock mask, G rock height, B water depth, A shore wetness
uniform sampler2D uCave;    // 1x res, linear: R cave darkness (mined under a roof), G ore nearby, B trampled ground, A mined floor
// (ore deposits and loose rubble are drawn by the DECAL pass right after this one)
uniform sampler2D uField2;  // 1x res, linear: R lushness, GB river flow (0.5 = none), A distance to rock (1 = 4+ tiles)
uniform sampler2D uNoise;   // tileable noise RGBA
uniform sampler2D uShadow;  // sprite sun-shadows (screen space)
uniform sampler2DArray uGround; // 0..7 ground, 8..11 rock types; A = height
uniform vec2 uShadowDir;
uniform float uShadowStr;
uniform vec3 uSun;          // light dir (x, y-down, z-up), normalized
uniform float uSunI;        // sun intensity 0..1
uniform vec3 uSky;          // reflection colour
uniform float uWet;         // ground wetness after rain 0..1
uniform float uRain;        // current rain intensity 0..1 (ripples)
uniform vec3 uSunWarm;      // direct light tint delta (0 = white)
uniform float uCloud;       // cloud cover (reflections)
uniform vec2 uCloudVel;
uniform float uNight;
uniform vec2 uWindDir;      // wind direction (grass waves)
uniform vec2 uWindPh;       // accumulated phases (y = travelling wind waves)
uniform float uWindK;       // wind strength 0..1.2

const mat2 ROT = mat2(0.8253, 0.5646, -0.5646, 0.8253);
// per ground id: puddle affinity (soil, rich, sand, gravel, marsh, mud, stone, forest floor)
const float PUD[8] = float[8](0.9, 1.0, 0.3, 0.12, 1.6, 1.4, 0.5, 0.8);

float LOD;   // mip level for ground textures
float PPX;   // world units per device pixel

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float nLod(float s){ return max(log2(PPX * s * 256.0), 0.0); }

vec4 tileAt(ivec2 c){ return texelFetch(uTile, clamp(c, ivec2(0), ivec2(uWorld) - 1), 0); }
float gidOf(vec4 t){ return floor(t.r * 255.0 + 0.5); }
float ridOf(vec4 t){ return 8.0 + clamp(floor(t.b * 255.0 + 0.5) - 1.0, 0.0, 3.0); }
vec4 fieldAt(vec2 p){ return texture(uField, p / uWorld); }
float ridgeN(vec2 p, float l){
  vec4 n = textureLod(uNoise, p * 0.032 + 0.13, l);
  return (1.0 - abs(n.g * 2.0 - 1.0)) * 0.7 + (1.0 - abs(n.b * 2.0 - 1.0)) * 0.3;
}

// layer sample with anti-tiling: two rotated/scaled samples, height-aware mix by low-freq noise m
vec4 gtex(float l, vec2 wp, float m){
  vec4 a = textureLod(uGround, vec3(wp * 0.25, l), LOD);
  vec4 b = textureLod(uGround, vec3(ROT * wp * 0.23 + vec2(0.31, 0.67), l), max(LOD - 0.12, 0.0));
  float t = clamp((m - 0.5) * 3.5 + (b.a - a.a) * 2.0 + 0.5, 0.0, 1.0);
  return mix(a, b, t);
}

// height-blended mix of the 4 surrounding tiles' layers
vec4 blend4(float la, float lb, float lc, float ld, vec2 wp, float m, vec2 f, out vec4 bw){
  vec4 A = gtex(la, wp, m);
  if (la == lb && la == lc && la == ld) { bw = vec4(1.0, 0.0, 0.0, 0.0); return A; }
  vec4 B = lb == la ? A : gtex(lb, wp, m);
  vec4 C = lc == la ? A : (lc == lb ? B : gtex(lc, wp, m));
  vec4 D = ld == la ? A : (ld == lb ? B : (ld == lc ? C : gtex(ld, wp, m)));
  vec2 s = mix(f, f * f * (3.0 - 2.0 * f), 0.5);
  vec4 w = vec4((1.0 - s.x) * (1.0 - s.y), s.x * (1.0 - s.y), (1.0 - s.x) * s.y, s.x * s.y);
  vec4 hh = vec4(A.a, B.a, C.a, D.a) * 0.6 + w * 1.15;
  float mx = max(max(hh.x, hh.y), max(hh.z, hh.w));
  bw = max(hh - (mx - 0.34), 0.0);
  bw /= (bw.x + bw.y + bw.z + bw.w);
  return A * bw.x + B * bw.y + C * bw.z + D * bw.w;
}

// expanding rain rings: xy = normal perturbation, z = ring brightness
vec3 ripples(vec2 p){
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    if (k == 2 && uRain < 0.45) break;   // extra layer of drops in heavy rain
    vec2 q = p * (2.4 + fk * 1.35) + fk * 7.31;
    vec2 c = floor(q), f = fract(q) - 0.5;
    vec2 h = hash22(c + fk * 13.7);
    float t = fract(uTime * (0.75 + 0.35 * h.y) + h.x);
    vec2 d = f - (h - 0.5) * 0.45;
    float r = length(d), rad = t * 0.42;
    float env = smoothstep(0.07, 0.0, abs(r - rad)) * (1.0 - t) * step(h.y, 0.8);
    float ring = sin((r - rad) * 48.0) * env;
    acc.xy += d / max(r, 1e-3) * ring;
    acc.z += max(ring, 0.0) * 0.6 + env * 0.25;
  }
  return acc * 0.7;
}

${WAVE_FN}
void main(){
  vec2 wp = uCam + vec2(vUV.x - 0.5, 0.5 - vUV.y) * uView;
  PPX = max(abs(dFdx(wp.x)), 1e-5);
  LOD = max(log2(PPX * 0.25 * float(textureSize(uGround, 0).x)), 0.0);
  float aaW = PPX * 1.25;

  vec4 nA = texture(uNoise, wp * 0.093);
  vec4 nB = texture(uNoise, wp * 0.29 + 0.5);
  vec4 nC = texture(uNoise, wp * 0.021 + 0.25);
  vec2 warp = (nA.xy - 0.5) * 1.5 + (nB.xy - 0.5) * 0.95;
  vec4 F = fieldAt(wp);
  vec4 F2 = texture(uField2, wp / uWorld);
  vec4 CV = texture(uCave, wp / uWorld);
  float cave = CV.r;                         // 1 = dark cave under a mountain roof
  float outK = 1.0 - cave;
  vec3 sunT = vec3(1.0) + uSunWarm * outK;
  // relief light: the sun outdoors, a soft fixed top-left light underground (torches do the rest)
  vec3 Ld = normalize(mix(uSun, vec3(-0.35, -0.45, 0.82), cave));
  float LI = mix(uSunI, 0.8, cave);

  // 4 tiles around the (warped) point
  vec2 q = wp + warp - 0.5;
  ivec2 i0 = ivec2(floor(q));
  vec2 f = fract(q);
  vec4 ta = tileAt(i0), tb = tileAt(i0 + ivec2(1, 0)), tc = tileAt(i0 + ivec2(0, 1)), td = tileAt(i0 + ivec2(1, 1));

  // ---------- rock edge as signed distance (tiles, + inside) ----------
  vec2 rq = wp + (nB.zw - 0.5) * 0.22 + (nA.zw - 0.5) * 0.2;
  vec4 Fr = fieldAt(rq);
  float sd = -9.0;
  vec2 gr = vec2(0.0);
  vec4 Fx = Fr, Fy = Fr;
  if (Fr.r > 0.004) {
    const float E = 0.18;
    Fx = fieldAt(rq + vec2(E, 0.0)); Fy = fieldAt(rq + vec2(0.0, E));
    gr = vec2(Fx.r - Fr.r, Fy.r - Fr.r) / E;
    sd = (Fr.r - 0.5) / max(length(gr), 0.32);
  }

  // water level (needed by both paths)
  vec2 wq = wp + warp * 0.3;
  float wl = fieldAt(wq).b + (nB.x - 0.5) * 0.08 + (nA.w - 0.5) * 0.05;

  vec3 col;
  float shadowMask = 1.0;

  if (sd > 0.0) {
    // ================= ROCK =================
    vec4 bw;
    vec4 RT = blend4(ridOf(ta), ridOf(tb), ridOf(tc), ridOf(td), wp * 0.9, nC.x, f, bw);
    vec2 hg = vec2(dFdx(RT.a), -dFdy(RT.a)) / PPX;          // texture height slope (per tile)
    vec2 outward = -gr / max(length(gr), 1e-3);
    float cliff = 1.0 - smoothstep(0.06, 0.62, sd);
    vec2 hgM = vec2(Fx.g - Fr.g, Fy.g - Fr.g) / 0.18;        // massif height slope (inward)
    // ridged relief on the massifs (crests and gullies lit by the sun)
    const float E2 = 0.22;
    float rl = nLod(0.032);
    float r0 = ridgeN(wp, rl), rx = ridgeN(wp + vec2(E2, 0.0), rl), ry = ridgeN(wp + vec2(0.0, E2), rl);
    float rk = smoothstep(0.06, 0.5, Fr.g);
    vec2 hgR = vec2(rx - r0, ry - r0) / E2 * rk * 0.85;
    vec3 N = normalize(vec3(-hgM * 2.4 * (1.0 - cliff) - hgR + outward * cliff * 1.9 - hg * 0.3, 1.0));
    float dif = max(dot(N, Ld), 0.0);
    float shade = 0.5 + 0.68 * dif * (0.3 + 0.7 * LI);
    vec3 alb = RT.rgb * (0.93 + 0.14 * nC.z) * 0.92;
    // mass: darker toward the edges, lighter on the high ground and crests
    float mass = (0.86 + 0.14 * smoothstep(0.25, 1.3, sd) + 0.08 * Fr.g) * (0.92 + 0.16 * r0 * rk);
    vec3 rock = alb * shade * mass * mix(vec3(1.0), sunT, dif * uSunI * outK);
    rock *= 0.8 + 0.4 * smoothstep(0.12, 0.6, RT.a);         // cavities
    // RimWorld-like edge: thick dark outline + lighter bevel just inside it
    const float OW = 0.085;
    vec2 sunXY = normalize(Ld.xy + vec2(1e-4, 0.0));
    float facing = dot(outward, sunXY);
    float bev = smoothstep(OW, OW + 0.02, sd) * (1.0 - smoothstep(OW + 0.06, OW + 0.22, sd));
    rock = mix(rock, rock * (1.32 + 0.3 * facing * (0.3 + 0.7 * LI)) + alb * 0.04, bev);
    float olm = 1.0 - smoothstep(OW - aaW * 0.5, OW + aaW * 0.5, sd);
    rock = mix(rock, alb * 0.15, olm);
    col = rock;
    shadowMask = 0.4;
  } else {
    // ================= GROUND =================
    vec4 bw;
    float ia = gidOf(ta), ib = gidOf(tb), ic = gidOf(tc), id = gidOf(td);
    vec4 GT = blend4(ia, ib, ic, id, wp, nC.x, f, bw);
    col = GT.rgb;
    float hgt = GT.a;
    vec4 isMarsh = vec4(equal(vec4(ia, ib, ic, id), vec4(4.0)));
    vec4 isMud = vec4(equal(vec4(ia, ib, ic, id), vec4(5.0)));
    float marshK = dot(bw, isMarsh), mudK = dot(bw, isMud);
    float pk = PUD[int(ia)] * bw.x + PUD[int(ib)] * bw.y + PUD[int(ic)] * bw.z + PUD[int(id)] * bw.w;

    // gentle large-scale variation (no dark stains)
    col *= 0.955 + 0.09 * nC.z;
    col *= 0.975 + 0.05 * nA.z;
    // faint green cast under lush grass
    col = mix(col, col * vec3(0.94, 1.04, 0.84), F2.r * 0.3);
    // damp ground near water
    col *= 1.0 - 0.05 * F.a;
    vec4 gids = vec4(ia, ib, ic, id);
    // short turf between the tufts: olive patches on soil where the grass is lush
    float soilK = dot(bw, vec4(lessThan(gids, vec4(1.5))));
    if (soilK > 0.01 && F2.r > 0.3) {
      float gn = nB.y;
      float turf = smoothstep(0.42, 0.85, F2.r + (nC.y - 0.5) * 0.8 + (nB.w - 0.5) * 0.3) * soilK * (1.0 - CV.b);
      vec3 turfC = vec3(0.33, 0.36, 0.185) * (0.82 + 0.36 * gn) * (0.9 + 0.2 * nA.z);
      col = mix(col, turfC, turf * (0.42 + 0.2 * smoothstep(0.42, 0.66, gn)));
    }

    // forest floor: drifts of autumn leaves and dark damp humus
    float forK = dot(bw, vec4(equal(gids, vec4(7.0))));
    if (forK > 0.01) {
      float au = smoothstep(0.38, 0.72, nC.y + (nA.w - 0.5) * 0.35);
      float hum = smoothstep(0.5, 0.8, nC.w + (nB.z - 0.5) * 0.3);
      col = mix(col, col * vec3(1.18, 0.98, 0.7), au * forK * 0.5);
      col = mix(col, col * vec3(0.8, 0.86, 0.78), hum * forK * 0.35);
    }
    // tiny flower heads scattered through lush grass, in colour patches
    if (F2.r > 0.5 && PPX < 0.035) {
      vec2 fp = wp * 3.3;
      vec2 fc = floor(fp), fh = hash22(fc + 3.17);
      float patchK = smoothstep(0.52, 0.8, nC.y * 0.7 + nA.x * 0.3);
      if (fh.x < patchK * smoothstep(0.5, 0.85, F2.r) * 0.55) {
        vec2 fd = fract(fp) - (0.2 + 0.6 * hash22(fc + 9.21));
        float fr = length(fd) / 0.075;
        if (fr < 1.0) {
          float hue = fract(nC.x * 3.0 + fh.y * 0.25);
          vec3 fcol = hue < 0.25 ? vec3(0.95, 0.93, 0.86) : hue < 0.5 ? vec3(0.98, 0.82, 0.3) : hue < 0.75 ? vec3(0.72, 0.55, 0.9) : vec3(0.95, 0.55, 0.62);
          col = mix(col, fcol * (0.75 + 0.35 * (1.0 - fr)), (1.0 - smoothstep(0.55, 1.0, fr)) * 0.85);
        }
      }
    }
    // trampled ground (bandit camps and their trails): packed dusty earth, scuffed by many feet
    float tr = CV.b;
    if (tr > 0.01) {
      float lumT = dot(col, vec3(0.333));
      vec3 packed = mix(vec3(lumT), col, 0.62) * vec3(1.16, 1.07, 0.94) + vec3(0.03, 0.025, 0.015);
      col = mix(col, packed, smoothstep(0.0, 0.7, tr) * 0.62);
      float scuff = textureLod(uNoise, wp * 1.7, nLod(1.7)).g, scuff2 = textureLod(uNoise, wp * vec2(3.1, 2.3) + 0.4, nLod(3.1)).b;
      col *= 1.0 - tr * (0.09 * smoothstep(0.52, 0.75, scuff) + 0.06 * smoothstep(0.6, 0.8, scuff2));
    }
    // wind waves rolling over the grass (matches the decor sway)
    if (F2.r > 0.3 && uWindK > 0.1) {
      col *= 1.0 + windWave(wp, uWindDir, uWindPh.y) * F2.r * (0.025 + 0.06 * uWindK) * outK;
    }

    // rain wetness: darker, a bit richer; puddles in low spots; marsh keeps standing water (never in caves)
    float wet = uWet * outK;
    col *= 1.0 - 0.2 * wet * min(pk, 1.0);
    float lum0 = dot(col, vec3(0.333));
    col = mix(vec3(lum0), col, 1.0 + 0.18 * wet);
    vec3 Hs = normalize(uSun + vec3(0.0, 0.0, 1.0));
    float level = (wet * 0.42 + marshK * 0.17 + mudK * 0.07) * pk;
    float pm = smoothstep(0.0, 0.05, level - hgt + (nB.y - 0.5) * 0.2);
    // wet sheen from texture micro-relief
    vec2 hgG = vec2(dFdx(hgt), -dFdy(hgt)) / PPX;
    vec3 Ng = normalize(vec3(-hgG * 0.05, 1.0));
    float sheen = pow(max(dot(Ng, Hs), 0.0), 24.0) * (wet * 0.5 + marshK * 0.3 + mudK * 0.3);
    col += sheen * 0.10 * uSunI * sunT;
    if (pm > 0.001) {
      vec3 rp = uRain > 0.02 && cave < 0.5 ? ripples(wp) * uRain : vec3(0.0);
      vec2 pn = rp.xy + (nB.xy - 0.5) * 0.08;
      vec3 Np = normalize(vec3(pn, 1.0));
      vec3 pc = col * vec3(0.5, 0.55, 0.55) + uSky * 0.2;
      pc += pow(max(dot(Np, Hs), 0.0), 90.0) * 0.6 * uSunI * sunT;
      pc += rp.z * 0.12 * (uSky + 0.1);
      col = mix(col, pc, pm * 0.85);
    }

    // ---------- mountains: ambient occlusion + cast shadow ----------
    float prox = F2.a;
    if (sd > -1.6) col *= 1.0 - 0.36 * pow(1.0 - clamp(-sd / 1.35, 0.0, 1.0), 2.0);
    col *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.6, prox));
    if (prox < 0.95 && uShadowStr > 0.01 && cave < 0.98) {
      float sl = length(uShadowDir);
      vec2 sdir = uShadowDir / max(sl, 1e-3);
      float maxD = min(4.2, 2.6 * sl + 0.4);
      float rs = 0.0;
      for (int k = 1; k <= 6; k++) {
        float t = float(k) / 6.0 * maxD;
        vec4 Fk = fieldAt(wp - sdir * t);
        float occH = smoothstep(0.45, 0.62, Fk.r) * (1.0 + 1.5 * Fk.g) * sl;
        rs = max(rs, smoothstep(t - 0.25, t + 0.2, occH));
      }
      col *= 1.0 - rs * min(uShadowStr * 1.1, 0.6) * outK * vec3(1.0, 0.95, 0.84);
    }

    // ================= WATER =================
    vec2 flow = (F2.gb - 0.5) * 2.0;
    float fl = length(flow);
    // gentle swash: lake shores breathe in and out (rivers keep a steady edge)
    float swb = smoothstep(0.1, 0.24, wl) * (1.0 - smoothstep(0.3, 0.45, wl)) * (1.0 - smoothstep(0.1, 0.4, fl));
    float swash = (0.5 + 0.5 * sin(uTime * 0.85 + nA.x * 8.0 + dot(wp, vec2(0.13, 0.07)))) * 0.03 * swb;
    col *= 1.0 - 0.3 * smoothstep(0.16, 0.255, wl + 0.03 * swb);   // wet dark sand at the waterline
    wl += swash;
    if (wl > 0.235) {
      float depth = smoothstep(0.26, 1.0, wl) * (1.0 - 0.4 * smoothstep(0.2, 0.7, fl));
      float ph0 = fract(uTime * 0.22), ph1 = fract(uTime * 0.22 + 0.5);
      float mw = abs(ph0 * 2.0 - 1.0);
      vec2 b1 = wp * 0.31 + uTime * vec2(0.021, 0.013);
      vec2 b2 = wp * 0.57 - uTime * vec2(0.017, -0.023);
      float l1 = nLod(0.31), l2 = nLod(0.57);
      vec2 o0 = flow * ph0 * 1.5, o1 = flow * ph1 * 1.5;
      vec2 n0 = textureLod(uNoise, b1 - o0 * 0.31, l1).xy + textureLod(uNoise, b2 - o0 * 0.57, l2).yz * 0.7;
      vec2 n1 = textureLod(uNoise, b1 - o1 * 0.31 + 0.5, l1).xy + textureLod(uNoise, b2 - o1 * 0.57 + 0.5, l2).yz * 0.7;
      vec2 nn = (mix(n0, n1, mw) - 0.85) * (0.7 + fl * 0.5);
      vec3 rp = uRain > 0.02 ? ripples(wp) * uRain : vec3(0.0);
      nn += rp.xy * 1.3;
      vec3 N = normalize(vec3(nn * 0.55, 1.0));

      // sandy bottom seen through clear water (refracted), absorbed with depth
      vec2 refr = N.xy * (0.05 + 0.2 * depth);
      vec3 bottom = textureLod(uGround, vec3((wp + refr) * 0.25, 2.0), LOD).rgb * (0.9 + 0.12 * nA.x);
      float cz = textureLod(uNoise, wp * 0.43 + nn * 0.3 + uTime * 0.035, nLod(0.43)).w;
      float caus = pow(1.0 - abs(cz * 2.0 - 1.0), 7.0);
      bottom += caus * 0.32 * (1.0 - depth) * (0.2 + 0.8 * uSunI) * sunT;
      float dd = 0.05 + depth * 1.95;
      vec3 Tr = exp(-vec3(2.4, 0.92, 0.66) * dd);
      vec3 deepCol = vec3(0.026, 0.10, 0.16);
      vec3 wc = bottom * Tr + deepCol * (1.0 - Tr.g);
      // sky + cloud reflection
      float cr = textureLod(uNoise, (wp + N.xy * 3.0) * 0.0105 + uCloudVel * uTime, 0.0).r;
      vec3 sky = uSky * (0.85 + 0.45 * smoothstep(0.45, 0.78, cr) * (0.25 + uCloud));
      float fres = clamp(0.05 + 0.1 * depth + 3.0 * (1.0 - N.z), 0.0, 0.55);
      wc = mix(wc, sky, fres);
      wc += rp.z * 0.14 * (sky + 0.08);
      // sun glints + pinpoint sparkles
      vec3 H = normalize(uSun + vec3(0.0, 0.0, 1.0));
      float nh = max(dot(N, H), 0.0);
      float sparkMask = smoothstep(0.7, 0.86, textureLod(uNoise, wp * 0.9 + uTime * vec2(0.05, -0.04), nLod(0.9)).g);
      float lightI = uSunI + uNight * 0.3 * (1.0 - uCloud);   // moonlight glints at night
      wc += (pow(nh, 160.0) * 0.28 + pow(nh, 1600.0) * 2.0 * sparkMask) * lightI * sunT * (1.0 - uCloud * 0.6);
      // clear nights: twinkling stars mirrored in calm water (screen-fixed, like the real sky)
      if (uNight > 0.05 && uCloud < 0.85) {
        vec2 sp = vUV * uView * 1.6 + N.xy * 0.35;
        vec2 scl = floor(sp), sh2 = hash22(scl + 41.0);
        if (sh2.x > 0.82) {
          vec2 sd2 = fract(sp) - (0.2 + 0.6 * hash22(scl + 7.0));
          float st = exp(-dot(sd2, sd2) * mix(900.0, 260.0, sh2.y * sh2.y)) * (0.55 + 0.45 * sin(uTime * (1.3 + sh2.y * 3.0) + sh2.x * 50.0));
          wc += vec3(0.78, 0.84, 1.0) * st * uNight * (1.0 - uCloud) * (1.0 - 0.6 * fl) * (0.8 + 1.2 * sh2.y);
        }
      }
      wc *= 1.0 - 0.07 * uRain;                                  // rain roughens and dulls the surface
      // shore foam + thin bright lip at the waterline
      float shore = 1.0 - smoothstep(0.27, 0.42, wl);
      float fn = textureLod(uNoise, wp * 0.7 + vec2(uTime * 0.03, uTime * 0.012), nLod(0.7)).r;
      float wave = 0.5 + 0.5 * sin(uTime * 1.25 - wl * 34.0 + fn * 7.0);
      float foam = smoothstep(0.66, 0.9, fn * 0.55 + wave * 0.55) * shore;
      foam += (1.0 - smoothstep(0.26, 0.29, wl)) * 0.55 * (0.55 + 0.45 * fn);
      if (fl > 0.15) {
        // flow streaks on the river
        vec2 fd = flow / fl, pd = vec2(-fd.y, fd.x);
        vec2 sp2 = vec2(dot(wp, fd) * 0.22 - uTime * 0.25 * fl, dot(wp, pd) * 1.9);
        float st = textureLod(uNoise, sp2, nLod(1.7)).b;
        foam += smoothstep(0.7, 0.88, st) * 0.3 * smoothstep(0.15, 0.6, fl) * (1.0 - depth * 0.4);
      }
      vec3 foamCol = vec3(0.86, 0.91, 0.92) * (0.65 + 0.35 * uSunI);
      wc = mix(wc, foamCol, clamp(foam, 0.0, 1.0) * 0.5);
      float edge = smoothstep(0.255 - aaW * 0.4, 0.255 + aaW * 0.4, wl);
      col = mix(col, wc, edge);
      shadowMask = mix(1.0, 0.55, edge);
    }
    // antialiased transition into the rock outline
    if (sd > -0.5) col = mix(col, vec3(0.075, 0.07, 0.065), smoothstep(-aaW, aaW * 0.4, sd));
  }

  // ---------- sprite sun shadows (slightly cool) ----------
  float sh = texture(uShadow, vUV).r;
  col *= 1.0 - sh * uShadowStr * shadowMask * outK * vec3(1.0, 0.96, 0.86);

  o = vec4(col, 1.0);
}`;

// Lighting composite + atmosphere + grading. Extra uniforms via env.extra (0 = neutral).
export const POST_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uScene, uLight, uNoise, uField;
uniform sampler2D uCave;  // R = cave darkness (no sky effects underground)
uniform vec2 uCam, uView, uWorld;
uniform float uTime;
uniform float uCloud;   // cloud cover 0..1
uniform float uDay;     // daylight 0..1
uniform vec2 uCloudVel;
uniform float uFog;
uniform vec3 uFogCol;
uniform vec3 uTint;
uniform float uSat, uContrast, uVig, uFlash;
uniform vec3 uLift;       // shadow tint added in the darks
uniform float uRain;      // rain streak intensity
uniform vec2 uRainDir;    // streak slant (x per unit fall)
uniform float uMist;      // low mist hugging water/lowlands
uniform float uHasField;  // 1 when uField is bound
uniform float uCloudSh;   // extra cloud-shadow strength
uniform vec3 uFlashCol;
uniform float uNight;
uniform float uRays;      // low-sun light shafts through the morning / evening haze
uniform vec2 uSunXY;      // horizontal direction towards the sun (world, y down)
uniform float uCamCave;   // camera inside a cave (0..1): deeper vignette

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// world-space rain streaks (one layer)
float rainLayer(vec2 wp, float scale, float speed, float seed, float dens){
  vec2 dir = normalize(vec2(uRainDir.x, 1.0));
  vec2 p = vec2(dot(wp, vec2(dir.y, -dir.x)), dot(wp, dir)) * scale;
  p.y -= uTime * speed;
  float colw = 1.0, rowh = 5.0;
  vec2 cell = vec2(floor(p.x / colw), floor(p.y / rowh));
  vec2 fr = vec2(fract(p.x / colw), fract(p.y / rowh));
  float h = hash12(cell + seed);
  if (h > dens) return 0.0;
  float x0 = 0.2 + 0.6 * hash12(cell + seed + 3.1);
  float y0 = hash12(cell + seed + 7.7) * 0.6;
  float len = 0.28 + 0.12 * h;
  float dx = abs(fr.x - x0);
  float dy = fr.y - y0;
  float w = 0.05;
  return smoothstep(w, 0.0, dx) * smoothstep(0.0, 0.05, dy) * (1.0 - smoothstep(len * 0.3, len, dy));
}

void main(){
  vec3 c = texture(uScene, vUV).rgb;
  vec3 L = texture(uLight, vUV).rgb * 2.0;
  c *= L;
  c += max(L - 1.0, 0.0) * 0.07;   // warm bloom where lights are strong

  vec2 wp = uCam + vec2(vUV.x - 0.5, 0.5 - vUV.y) * uView;
  float cave = uHasField > 0.5 ? texture(uCave, wp / uWorld).r : 0.0;
  float outK = 1.0 - cave;

  // drifting cloud shadows (domain-warped, soft)
  vec2 cuv = wp * 0.0105 + uCloudVel * uTime;
  vec2 cw = (texture(uNoise, cuv * 0.6 + 0.17).gb - 0.5) * 0.35;
  float cl = texture(uNoise, cuv + cw).r * 0.62 + texture(uNoise, wp * 0.026 + uCloudVel * uTime * 1.3 + 0.3 + cw).g * 0.38;
  cl = smoothstep(0.58 - 0.3 * uCloud, 0.82 - 0.12 * uCloud, cl);
  c *= 1.0 - cl * max(0.17 + uCloudSh, 0.0) * uDay * outK;

  // lightning: re-light the scene with a cold flash (barely reaches into caves)
  c += uFlash * (c * 2.2 + 0.05) * (vec3(0.85, 0.9, 1.0) + uFlashCol) * (1.0 - cave * 0.92);

  // light shafts: soft bands along the low sun, mostly visible in haze and mist
  float rays = 0.0;
  if (uRays > 0.01) {
    vec2 sd = normalize(uSunXY + vec2(1e-4, 0.0)), pp = vec2(-sd.y, sd.x);
    float u = dot(wp, pp) * 0.085 + dot(wp, sd) * 0.006;
    float n = texture(uNoise, vec2(u, uTime * 0.0035)).r * 0.6 + texture(uNoise, vec2(u * 2.3 + 0.37, uTime * 0.006 + 0.5)).g * 0.4;
    rays = smoothstep(0.48, 0.78, n) * uRays * outK;
  }

  // mist / fog banks
  float m1 = texture(uNoise, wp * 0.018 + uTime * vec2(0.0021, 0.0009)).b;
  float m2 = texture(uNoise, wp * 0.047 - uTime * vec2(0.003, 0.002)).a;
  float mist = mix(m1, m2, 0.4);
  float low = 0.5;
  if (uHasField > 0.5) {
    vec4 F = texture(uField, wp / uWorld);
    low = clamp(F.b * 1.2 + F.a * 0.6, 0.0, 1.0);
  }
  float fogA = uFog * (0.35 + mist * 0.9);
  fogA += uMist * smoothstep(0.35, 0.75, mist + low * 0.45) * (0.35 + 0.65 * low);
  fogA *= 1.0 - cave * 0.92;
  vec3 fogC = uFogCol * (1.0 + rays * 0.5);
  c = mix(c, fogC, clamp(fogA * (1.0 + rays * 0.35), 0.0, 0.85));
  c += uFogCol * rays * 0.06 * vec3(1.05, 0.98, 0.85);

  // rain streaks (3 parallax layers)
  if (uRain > 0.01) {
    float r = rainLayer(wp, 1.5, 22.0, 1.0, 0.7 * uRain) * 0.6
            + rainLayer(wp + 13.1, 2.2, 17.0, 5.0, 0.75 * uRain) * 0.45
            + rainLayer(wp + 27.7, 3.2, 13.0, 9.0, 0.8 * uRain) * 0.3;
    vec3 rc = mix(uFogCol * 1.15, vec3(0.75, 0.8, 0.88), 0.4) * (0.55 + 0.45 * uDay);
    c = mix(c, rc, clamp(r, 0.0, 1.0) * 0.55 * outK);
  }

  // grading: gain (tint), lift in the darks, saturation, contrast, soft highlight shoulder
  c *= uTint;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c += uLift * (1.0 - smoothstep(0.0, 0.55, lum));
  lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, uSat);
  c = (c - 0.45) * uContrast + 0.45;
  vec3 hi = max(c - 0.82, 0.0);
  c = c - hi + hi / (1.0 + hi * 2.2);
  vec2 v = vUV - 0.5;
  float vg = dot(v, v) * uVig * (1.0 + uCamCave * 0.7);
  c *= 1.0 - vg;
  c = max(c, 0.0);
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;
