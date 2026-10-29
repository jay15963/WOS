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
uniform sampler2D uClim;  // R = snow affinity (cold biomes), G = structure occupancy (contact AO)
uniform vec2 uWorldSz;
uniform float uSnow;      // snow cover 0..1 (env.extra.uSnow)
out vec2 vUV;
out vec4 vColor;
out float vFlash;
out float vRecv;
out vec2 vLocal;
out vec2 vW;              // world position on the ground plane (before lift)
out float vFrost;         // snow lying on this (vegetation) sprite
flat out vec2 vVr;        // v range of the sprite in the atlas (top-edge sampling stays inside it)
${SWAY_FN}
void main(){
  vec2 c = aCorner;
  vec2 local = (c - aAnchor) * aSize;
  local = rotLocal(local, aParams.y);
  if (aParams.x > 0.0) local = swayLocal(c, local);
  vec2 w = aPos + local;
  vW = w;
  w.y -= aExtra.y;
  vec2 clip = (w - uCam) * uScale;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vec2 tc = c;
  if (aParams.w < 0.0) tc.x = 1.0 - tc.x;
  vUV = mix(aUV.xy, aUV.zw, tc);
  vVr = vec2(min(aUV.y, aUV.w), max(aUV.y, aUV.w));
  vColor = aColor;
  // grass tufts catch the light as a wind wave bends them (silvery sheen rolling over the fields)
  if (aParams.x > 0.09) vColor.rgb *= 1.0 + windWave(aPos, uWindDir, uWindPh.y) * (0.04 + 0.1 * uWind);
  vFlash = aParams.z;
  vRecv = aExtra.x;
  vLocal = c;
  vFrost = 0.0;
#if QL >= 1
  if (uSnow > 0.01 && aParams.x > 0.0) vFrost = uSnow * smoothstep(0.45, 0.75, textureLod(uClim, aPos / uWorldSz, 0.0).r);
#endif
}`;

export const SPRITE_FS = `#version 300 es
precision mediump float;
in vec2 vUV; in vec4 vColor; in float vFlash; in float vRecv; in vec2 vLocal; in vec2 vW; in float vFrost;
flat in vec2 vVr;
uniform sampler2D uTex;
uniform sampler2D uShadow;
uniform sampler2D uClim;
uniform highp vec2 uWorldSz;
uniform vec2 uViewport;
uniform float uShadowStr;
uniform float uAO;        // 1 while drawing ground / decor: darken next to walls (contact AO)
out vec4 o;
void main(){
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.003) discard;
  vec4 c = vec4(t.rgb * vColor.rgb, t.a) * vColor.a;
#if QL >= 1
  if (vFrost > 0.01) {
    // snow settles on the top edges of leaves / needles / blades (texel above is empty)
    float dv = 2.5 / float(textureSize(uTex, 0).y);
    float up = min(texture(uTex, vec2(vUV.x, max(vUV.y - dv, vVr.x))).a, texture(uTex, vec2(vUV.x, max(vUV.y - dv * 2.6, vVr.x))).a);
    float cap = smoothstep(0.12, 0.6, t.a - up * 0.9);
    float lum = dot(c.rgb, vec3(0.3, 0.59, 0.11)) / max(c.a, 1e-3);
    vec3 sn = vec3(0.88, 0.91, 0.97) * (0.78 + 0.3 * smoothstep(0.1, 0.45, lum)) * c.a;
    c.rgb = mix(c.rgb, sn, vFrost * (cap * 0.85 + 0.1));
  }
  if (uAO > 0.0) {
    float so = texture(uClim, (vW + vec2(0.0, -0.08)) / uWorldSz).g;
    c.rgb *= 1.0 - uAO * 0.3 * smoothstep(0.18, 0.62, so);
  }
#endif
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

// ---------- [paths] painted terrain paths (agent M) ----------
// Paths are drawn INSIDE the terrain pass, from a per-tile grid (uPath, src/game/paths.js) and a material bank
// (uPathMat, src/world/pathTex.js). The edge is an iso-line of a C1-smooth signed distance field, pushed around by
// two noise octaves and by the material / ground heights (pebbles spill out, slab outlines follow the stones, grass
// tufts creep in): it never shows the tile grid. Relief is lit by the real sun (micro normals from the height,
// soft cast shadows at QL 2); the gaps of slabs / setts / stepping stones show the ground under them. Built paths
// also feed the ground height / puddle affinity (rain pools in ruts and joints) and dim the grass wind waves.
// Blueprints (plans) are tinted blue (removal red) at the end of the ground branch.
const PATH_FN = `
// per type (index = type - 1: earth, gravel, flagstones, cobbles, stepping stones)
const float P_EH[5] = float[5](0.07, 0.30, 0.34, 0.24, 0.3);     // how far the material relief moves the edge (tiles)
const float P_EW[5] = float[5](0.1, 0.035, 0.03, 0.03, 0.035);   // edge softness (tiles)
const float P_GAP[5] = float[5](0.0, 0.0, 0.85, 0.38, 1.0);      // share of the real ground seen in the gaps
const float P_REL[5] = float[5](0.4, 1.0, 0.75, 0.9, 0.8);       // sun relief strength
const float P_PUD[5] = float[5](1.35, 0.28, 0.6, 0.5, 0.75);     // puddle affinity (rain)
const float P_HS[5] = float[5](0.016, 0.04, 0.03, 0.034, 0.03); // height scale of the micro normals (tiles per unit)
const vec3 P_STRAY[3] = vec3[3](vec3(0.6, 0.58, 0.54), vec3(0.68, 0.63, 0.55), vec3(0.5, 0.49, 0.48));

// C1-smooth sample of the 1x path texture (bilinear on smoothstepped coordinates: no creases along tile lines)
vec4 pathRaw(vec2 p){
  vec2 q = p - 0.5, i = floor(q), f = q - i;
  f = f * f * (3.0 - 2.0 * f);
  return texture(uPath, (i + f + 0.5) / uWorld);
}
// smooth coverage at 2x (same smoothstepped-bilinear trick)
vec2 pathCov(vec2 p){
  vec2 q = p * 2.0 - 0.5, i = floor(q), f = q - i;
  f = f * f * (3.0 - 2.0 * f);
  return texture(uPathF, (i + f + 0.5) / (uWorld * 2.0)).rg;
}
// edge distance: the Gaussian coverage near the outline (≈ tiles there), the exact tile distance deep inside / far out
float pathSd(float c, float sdT){ return mix(sdT, c - 0.36, smoothstep(0.0, 0.18, c) * (1.0 - smoothstep(0.84, 1.0, c))); }
float pathCode(ivec2 c, int ch){ vec4 t = texelFetch(uPath, clamp(c, ivec2(0), ivec2(uWorld) - 1), 0); return floor((ch == 0 ? t.r : t.g) * 255.0 + 0.5); }
// material sample; earth and gravel get the anti-tiling pair of the ground textures
vec4 pathMat(float l, vec2 p, float m){
  vec4 a = textureLod(uPathMat, vec3(p * 0.25, l), LOD);
#if QL >= 1
  if (l < 1.5) {
    vec4 b = textureLod(uPathMat, vec3(ROT * p * 0.23 + vec2(0.31, 0.67), l), max(LOD - 0.12, 0.0));
    a = mix(a, b, clamp((m - 0.5) * 3.5 + (b.a - a.a) * 2.0 + 0.5, 0.0, 1.0));
  }
#endif
  return a;
}

void pathGround(vec2 wp, vec4 nA, vec4 nB, vec4 nC, vec3 Ld, float LI, vec3 sunT, float aaW,
                inout vec3 col, inout float hgt, inout float pk, out float pathK, out vec2 pw, out float en, out float sdPlan){
  pathK = 0.0;
  // organic edge: the sample point wanders, a finer noise frays the iso-line
  pw = wp + (nB.xy - 0.5) * 0.34 + (nA.zw - 0.5) * 0.2;
  en = (nB.z - 0.5) * 0.16 + (textureLod(uNoise, wp * 1.9 + 0.37, nLod(1.9)).r - 0.5) * 0.14;
#if QL >= 1
  en += (textureLod(uNoise, wp * 4.7 + 0.71, nLod(4.7)).g - 0.5) * 0.07;
#endif
  vec4 S = pathRaw(pw);
  float sdT = S.a * 4.0 - 2.0, sdTP = S.b * 4.0 - 2.0;
  if (sdT < -1.25 && sdTP < -1.25) return;     // nothing built or planned near
  vec2 C = pathCov(pw);
  sdPlan = pathSd(C.g, sdTP);
  float sdB = pathSd(C.r, sdT), sdE = sdB + en;
  if (sdE < -0.75) return;
  // type of the 4 tiles around the warped point (halo tiles carry their nearest type), smooth weights
  vec2 q = pw - 0.5;
  ivec2 c0 = ivec2(floor(q));
  vec2 f = fract(q); f = f * f * (3.0 - 2.0 * f);
  vec4 T = vec4(pathCode(c0, 0), pathCode(c0 + ivec2(1, 0), 0), pathCode(c0 + ivec2(0, 1), 0), pathCode(c0 + ivec2(1, 1), 0));
  vec4 inT = vec4(lessThan(T, vec4(127.5))) * vec4(greaterThan(T, vec4(0.5))); // built corners (not halo)
  T = mod(T, 128.0);
  vec4 w4 = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  // the material comes from built corners; halo corners (nearest type) only where none is built
  w4 *= dot(w4, inT) > 0.0 ? inT : vec4(greaterThan(T, vec4(0.5)));
  float tA = 0.0, wA = 0.0, tB = 0.0, wB = 0.0;
  for (int k = 0; k < 4; k++) {
    float tk = T[k], wk = w4[k];
    if (wk <= 0.0) continue;
    if (wA == 0.0 || tk == tA) { tA = tk; wA += wk; }
    else if (wB == 0.0 || tk == tB) { tB = tk; wB += wk; }
  }
  if (wA <= 0.0) return;
  if (wB > wA) { float s = tA; tA = tB; tB = s; s = wA; wA = wB; wB = s; }
  vec4 M = pathMat(tA - 1.0, wp, nC.x);
  int ia = int(tA) - 1;
  // laid stone: a calmer outline (the stones themselves shape it through their height), earth / gravel fray more
  if (tA == 3.0 || tA == 5.0) sdE = sdB + en * 0.55;
  if (wB > 0.02) {
    // junction of two path types: height-blended like the ground layers
    vec4 Mb = pathMat(tB - 1.0, wp, nC.x);
    float bb = clamp(((Mb.a * 0.6 + wB * 1.15) - (M.a * 0.6 + wA * 1.15)) / 0.2 + 0.5, 0.0, 1.0);
    M = mix(M, Mb, bb);
    if (bb > 0.5) ia = int(tB) - 1;
  }
  // tangent of the path (along the iso-lines) for ruts, footprints and trampled grass streaks
  vec2 gd = vec2(dFdx(sdB), -dFdy(sdB)) / PPX;
  float gl = length(gd);
  vec2 nrm = gl > 0.05 ? gd / gl : vec2(0.0, 1.0), tg = vec2(-nrm.y, nrm.x); // flat middle of wide paths: any direction
  float h = M.a;
  vec3 pc = M.rgb;
  if (ia == 0) {
    // packed earth: two ruts following the edges (iso-lines of the distance), broken up; a smoother worn middle
    float sdS = sdB + (nB.z - 0.5) * 0.16;  // ruts follow the slow wobble of the edge, not its fraying
    float rn = textureLod(uNoise, wp * 0.55 + 0.11, nLod(0.55)).g;
    float rz = (sdS - 0.3) / 0.11, rut = exp(-rz * rz) * smoothstep(0.28, 0.6, rn + 0.1); // (no pow(): negative base)
    float cz = (sdS - 0.6) / 0.14, crown = exp(-cz * cz) * smoothstep(0.45, 0.62, sdS + 0.1);
    // ruts: compacted darker grooves, a little smoother (less grit); a lighter crown between them
    pc = mix(pc, vec3(dot(pc, vec3(0.333))) * vec3(1.02, 0.98, 0.92), 0.25 * rut) * (1.0 - 0.08 * rut) * (1.0 + 0.035 * crown);
    h -= 0.14 * rut;
    pc = mix(pc, pc * vec3(1.05, 1.04, 1.01), smoothstep(0.32, 0.9, sdS) * 0.6);
#if QL >= 1
    // footprints along the path (close zoom)
    if (PPX < 0.03) {
      vec2 fp = wp * 3.3, fc = floor(fp), fh = hash22(fc + 5.3);
      if (fh.x < 0.55 * smoothstep(0.08, 0.22, sdS)) {
        // a sole: toe wider than the heel, pressed in (darker, smoother) with a raised crumbly rim
        vec2 d = (fp - fc - 0.25 - 0.5 * hash22(fc + 1.7)) / 3.3;
        float flip = fh.y > 0.5 ? 1.0 : -1.0;
        float u = dot(d, tg) * flip, v = dot(d, nrm) + (fh.y - 0.5) * 0.01;
        float r = length(vec2(u / 0.065, v / (u > 0.0 ? 0.036 : 0.026)));
        if (r < 1.2) {
          float imp = 1.0 - smoothstep(0.6, 0.98, r), rim = smoothstep(0.85, 1.0, r) * (1.0 - smoothstep(1.0, 1.2, r));
          pc *= (1.0 - 0.16 * imp) * (1.0 + 0.07 * rim);
          h -= 0.1 * imp;
        }
      }
    }
#endif
  }
  // sun relief from the material height: micro normals from finite differences of the texture (smooth, no 2×2
  // screen-quad blocks) + (QL 2) small cast shadows
  float he = max(PPX, 1.0 / 128.0) * 1.5;
  vec2 hg = (vec2(pathMat(float(ia), wp + vec2(he, 0.0), nC.x).a, pathMat(float(ia), wp + vec2(0.0, he), nC.x).a) - M.a) / he * P_HS[ia];
  vec3 N = normalize(vec3(-hg, 1.0));
  float dif = max(dot(N, Ld), 0.0), flat0 = max(Ld.z, 0.25);
  float rel = P_REL[ia] * (0.3 + 0.7 * LI);
  float shade = mix(1.0, (0.42 + 0.66 * dif) / (0.42 + 0.66 * flat0), rel);
#if QL >= 2
  if (rel > 0.3 && PPX < 0.05) {
    float h2 = pathMat(float(ia), wp + normalize(Ld.xy + 1e-4) * 0.03, nC.x).a;
    shade *= 1.0 - 0.3 * smoothstep(0.03, 0.14, h2 - M.a) * LI; // material only (ruts / prints are not occluders)
  }
#endif
  pc *= shade * mix(vec3(1.0), sunT, dif * 0.6);
  pc *= 0.955 + 0.09 * nC.z;                              // same large-scale variation as the ground
  // gaps (joints, between stepping stones): the real ground, a bit greener and in contact shadow
  float gapK = (1.0 - smoothstep(0.16, 0.25, h)) * step(0.01, P_GAP[ia]);
  if (gapK > 0.0) {
    // joints of slabs / setts: grass creeping in · around stepping stones: just the ground, with contact shade
    vec3 gg = ia == 4 ? col : mix(col, vec3(0.3, 0.37, 0.17) * (0.85 + 0.3 * nB.w), 0.4);
    vec3 g = mix(M.rgb, gg, P_GAP[ia]) * (1.0 - (ia == 4 ? 0.3 : 0.38) * smoothstep(0.0, 0.15, h));
    pc = mix(pc, g, gapK);
  }
  // damp, darker margin (soil pushed to the sides)
  pc *= 1.0 - 0.05 * (1.0 - smoothstep(-0.1, 0.45, sdE));
  // edge: the material relief and the ground height push the iso-line around
  float ew = max(P_EW[ia], aaW);
  float m = smoothstep(-ew, ew, sdE + (h - 0.5) * P_EH[ia] - (hgt - 0.5) * 0.1);
  // outside: trampled grass streaked along the path, stray stones kicked off it
  if (m < 1.0 && sdE < 0.05) {
    float halo = smoothstep(-0.6, -0.02, sdE) * (1.0 - m);
    float st = textureLod(uNoise, vec2(dot(wp, tg) * 0.9, dot(wp, nrm) * 6.0) + 0.3, nLod(6.0)).b;
    float l0 = dot(col, vec3(0.333));
    vec3 tr = mix(vec3(l0), col, 0.72) * vec3(1.07, 1.05, 0.9);
    col = mix(col, tr, halo * (0.3 + 0.45 * smoothstep(0.45, 0.72, st)) * (ia == 0 ? 0.9 : ia == 1 ? 0.5 : 0.25));
#if QL >= 1
    if (ia > 0 && PPX < 0.06) {
      vec2 sp = wp * 6.0, sc = floor(sp), sh = hash22(sc + 9.7 + float(ia) * 3.1);
      if (sh.x < (ia == 1 ? 0.6 : 0.24) * halo * halo) {
        vec2 dd = (sp - sc - 0.2 - 0.6 * hash22(sc + 2.3)) / 6.0;
        float rr = 0.02 + 0.022 * sh.y, d2 = length(dd) / rr;
        float shd = 1.0 - smoothstep(0.75, 1.3, length(dd + normalize(Ld.xy + 1e-4) * rr * 0.5) / rr);
        col *= 1.0 - 0.3 * shd * (0.3 + 0.7 * LI);
        if (d2 < 1.0) {
          vec3 Np = normalize(vec3(dd / rr * 0.9, sqrt(max(1.0 - d2 * d2, 0.0)) + 0.25));
          vec3 sc3 = P_STRAY[int(fract(sh.y * 7.31) * 2.99)] * (0.9 + 0.2 * fract(sh.x * 13.7));
          col = mix(col, sc3 * (0.45 + 0.72 * max(dot(Np, Ld), 0.0)) * sunT, 1.0 - smoothstep(0.8, 1.0, d2));
          hgt = max(hgt, 0.75);
        }
      }
    }
#endif
  }
  col = mix(col, pc, m);
  hgt = mix(hgt, h, m);
  pk = mix(pk, P_PUD[ia], m);
  pathK = m;
}

// blueprint tint of planned tiles (blue = lay, red = remove), drawn after water / snow / shadows
void pathPlanTint(vec2 wp, vec2 pw, float en, float sd, inout vec3 col){
  float sdP = sd + en * 0.5;
  if (sdP < -0.06) return;
  vec2 q = pw - 0.5;
  ivec2 c0 = ivec2(floor(q));
  float code = max(max(pathCode(c0, 1), pathCode(c0 + ivec2(1, 0), 1)), max(pathCode(c0 + ivec2(0, 1), 1), pathCode(c0 + ivec2(1, 1), 1)));
  float prev = step(15.5, code);
  code = mod(code, 16.0);
  if (code < 0.5) return;
  bool rem = code > 14.5;
  vec3 bp = rem ? vec3(1.0, 0.42, 0.34) : vec3(0.42, 0.72, 1.0);
  float inside = smoothstep(-0.03, 0.03, sdP);
  float l0 = dot(col, vec3(0.333));
  // ghost of the planned material (gravel, slabs, setts…) in the blueprint colour
  float ghost = rem ? 0.5 : textureLod(uPathMat, vec3(wp * 0.25, min(code, 5.0) - 1.0), LOD + 0.5).a;
  vec3 tint = vec3(l0) * 0.5 + bp * (0.42 + 0.22 * ghost);
  float hatch = smoothstep(0.32, 0.5, abs(fract((wp.x + wp.y) * 1.6 - uTime * 0.2) - 0.5));
  float a = inside * (0.48 + 0.07 * hatch) * (prev > 0.5 ? 0.82 + 0.18 * sin(uTime * 5.0) : 1.0);
  col = mix(col, tint, a);
  float line = 1.0 - smoothstep(0.012, 0.035 + PPX * 1.5, abs(sdP - 0.025));
  col = mix(col, bp * 1.05, line * 0.7);
}
`;

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
uniform float uWindK;       // wind strength 0..1.1
uniform sampler2D uClim;    // 1x, linear: R snow affinity (cold biomes), G structure occupancy (contact AO)
uniform float uSnow;        // snow cover 0..1 (builds up while it snows over cold biomes, melts slowly)
uniform float uSnowPeak;    // permanent snow on the high mountain tops (cold biomes)
uniform float uClimOn;      // 0 = skip the climate fetch (no snow lying and no walls in view)
// [paths] painted terrain paths (agent M, src/game/paths.js): bound on units 14 / 15 by the renderer
uniform sampler2D uPath;          // 1x RGBA linear: R built type (+128 = nearest type, outside) and G plan code (+16 = local
                                  // preview) read with texelFetch; B plan / A built signed distance (sd = v * 4 - 2 tiles)
uniform sampler2D uPathF;         // 2x res, linear: R built / G plan coverage (tile grid smoothed by a Gaussian, σ 0.5 tile):
                                  // the visible outline (iso 0.36) — rounded, never stair-stepped
uniform sampler2DArray uPathMat;  // path materials (src/world/pathTex.js): RGB albedo (unlit), A height (low = gap)
uniform float uPathOn;            // 0 = no path / plan in the world: the whole block is skipped

// quality (QL from the renderer: 0 low, 1 medium, 2 high)
#if QL == 0
#define RIPK 1
#define SHK 3
#elif QL == 1
#define RIPK 2
#define SHK 6
#else
#define RIPK 3
#define SHK 6
#endif

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
#if QL == 0
  return a;
#endif
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
  for (int k = 0; k < RIPK; k++) {
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
${PATH_FN}
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
  vec4 CL = vec4(0.0);
  if (uClimOn > 0.5) CL = texture(uClim, wp / uWorld);
  float snowA = smoothstep(0.45, 0.75, CL.r) * outK;   // where snow can lie (cold biomes, outdoors)
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
#if QL == 0
    float r0 = ridgeN(wp, rl), rx = r0, ry = r0;
#else
    float r0 = ridgeN(wp, rl), rx = ridgeN(wp + vec2(E2, 0.0), rl), ry = ridgeN(wp + vec2(0.0, E2), rl);
#endif
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
    // snow on the cold massifs: permanent on the high tops, everywhere after snowfall (flat, upward faces)
    float capS = max(uSnow, uSnowPeak * smoothstep(0.35, 0.95, Fr.g)) * snowA;
    if (capS > 0.01) {
      float m = smoothstep(0.3, 0.62, capS * 1.15 + (N.z - 0.9) * 2.4 + (RT.a - 0.5) * 0.6 + (nB.y - 0.5) * 0.35 - 0.28) * (1.0 - cliff * 0.75);
      vec3 snC = vec3(0.86, 0.89, 0.95) * (0.56 + 0.56 * dif * (0.3 + 0.7 * LI)) * mix(vec3(1.0), sunT, dif * uSunI * outK);
      rock = mix(rock, snC, m);
    }
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
    if (QL >= 1 && F2.r > 0.5 && PPX < 0.035) {
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
    // [paths] painted paths blend into the ground here (see PATH_FN); plans are tinted at the end of the branch
    float pathK = 0.0, pathEn = 0.0, pathSdP = -2.0;
    vec2 pathPw = wp;
    if (uPathOn > 0.5) pathGround(wp, nA, nB, nC, Ld, LI, sunT, aaW, col, hgt, pk, pathK, pathPw, pathEn, pathSdP);
    // wind waves rolling over the grass (matches the decor sway)
    if (F2.r > 0.3 && uWindK > 0.1) {
      col *= 1.0 + windWave(wp, uWindDir, uWindPh.y) * F2.r * (0.025 + 0.06 * uWindK) * outK * (1.0 - pathK);
    }

    // rain wetness: darker, a bit richer; puddles in low spots; marsh keeps standing water (never in caves)
    float wet = uWet * outK * (1.0 - 0.9 * snowA * step(0.02, uSnow));
    col *= 1.0 - 0.2 * wet * min(pk, 1.0);
    float lum0 = dot(col, vec3(0.333));
    col = mix(vec3(lum0), col, 1.0 + 0.18 * wet);
    vec3 Hs = normalize(uSun + vec3(0.0, 0.0, 1.0));
    float level = (wet * 0.42 + (marshK * 0.17 + mudK * 0.07) * (1.0 - pathK)) * pk; // paths: puddles only after rain
    float pm = smoothstep(0.0, 0.05, level - hgt + (nB.y - 0.5) * 0.2);
    // wet sheen from texture micro-relief
    vec2 hgG = vec2(dFdx(hgt), -dFdy(hgt)) / PPX;
    vec3 Ng = normalize(vec3(-hgG * 0.05, 1.0));
    float sheen = pow(max(dot(Ng, Hs), 0.0), 24.0) * (wet * 0.5 + (marshK * 0.3 + mudK * 0.3) * (1.0 - pathK));
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

    // snow cover on the ground of cold biomes (bumps first, then a full blanket)
    if (uSnow > 0.01 && snowA > 0.01) {
      float sn = uSnow * snowA;
      float m = smoothstep(0.3, 0.6, sn * 1.3 + (hgt - 0.5) * 0.6 + (nB.y - 0.5) * 0.45 + (nA.z - 0.5) * 0.25 - 0.3);
      vec3 Ns = normalize(vec3(-hgG * 0.03, 1.0));
      float sd2 = max(dot(Ns, uSun), 0.0);
      vec3 snC = vec3(0.85, 0.88, 0.93) * (0.8 + 0.2 * sd2 * uSunI + 0.06 * nA.z) * sunT;
      col = mix(col, snC, m * (1.0 - 0.6 * max(CV.b, pathK * 0.5))); // trampled ground / paths keep less snow
    }
    // contact AO at the foot of walls / structures
    col *= 1.0 - 0.3 * smoothstep(0.18, 0.62, CL.g);

    // ---------- mountains: ambient occlusion + cast shadow ----------
    float prox = F2.a;
    if (sd > -1.6) col *= 1.0 - 0.36 * pow(1.0 - clamp(-sd / 1.35, 0.0, 1.0), 2.0);
    col *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.6, prox));
    if (prox < 0.95 && uShadowStr > 0.01 && cave < 0.98) {
      float sl = length(uShadowDir);
      vec2 sdir = uShadowDir / max(sl, 1e-3);
      float maxD = min(4.2, 2.6 * sl + 0.4);
      float rs = 0.0;
      for (int k = 1; k <= SHK; k++) {
        float t = float(k) / float(SHK) * maxD;
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
#if QL >= 1
      float cz = textureLod(uNoise, wp * 0.43 + nn * 0.3 + uTime * 0.035, nLod(0.43)).w;
      float caus = pow(1.0 - abs(cz * 2.0 - 1.0), 7.0);
      bottom += caus * 0.32 * (1.0 - depth) * (0.2 + 0.8 * uSunI) * sunT;
#endif
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
      if (QL >= 1 && uNight > 0.05 && uCloud < 0.85) {
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
      if (QL >= 1 && fl > 0.15) {
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
    if (pathSdP > -0.08) pathPlanTint(wp, pathPw, pathEn, pathSdP, col); // [paths] blueprints
    // antialiased transition into the rock outline
    if (sd > -0.5) col = mix(col, vec3(0.075, 0.07, 0.065), smoothstep(-aaW, aaW * 0.4, sd));
  }

  // ---------- sprite sun shadows (slightly cool) ----------
  float sh = texture(uShadow, vUV).r;
  col *= 1.0 - sh * uShadowStr * shadowMask * outK * vec3(1.0, 0.96, 0.86);

  o = vec4(col, 1.0);
}`;

// Lighting composite + atmosphere + grading. Extra uniforms via env.extra (0 = neutral).
// QL (renderer quality): 0 low (1 rain layer, no bloom / grain), 1 medium, 2 high (canopy light shafts).
export const POST_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uScene, uLight, uNoise, uField;
uniform sampler2D uCave;  // R = cave darkness (no sky effects underground)
uniform sampler2D uClim;  // R = snow affinity: precipitation falls as snow over cold biomes
uniform sampler2D uShadow; // sprite sun shadows (canopy light shafts, high quality)
uniform vec2 uCam, uView, uWorld;
uniform float uTime;
uniform float uCloud;   // cloud cover 0..1
uniform float uDay;     // daylight 0..1
uniform vec2 uCloudVel;
uniform float uFog;
uniform vec3 uFogCol;
uniform vec3 uTint;
uniform float uSat, uContrast, uVig, uFlash;
uniform vec3 uAmb;        // ambient light (light above it = fire / torch light: keeps warmth and saturation)
uniform vec3 uCaveAmb;    // ambient inside mined caves (see AMBIENT_FS)
uniform vec3 uLift;       // shadow tint added in the darks
uniform float uRain;      // precipitation intensity
uniform vec2 uRainDir;    // streak slant (x per unit fall)
uniform float uMist;      // low mist hugging water/lowlands
uniform float uHasField;  // 1 when uField is bound
uniform float uCloudSh;   // extra cloud-shadow strength
uniform vec3 uFlashCol;
uniform float uNight;
uniform float uRays;      // low-sun light shafts through the morning / evening haze
uniform vec2 uSunXY;      // horizontal direction towards the sun (world, y down)
uniform vec2 uShadowDir;  // sun-shadow offset per unit height (world, y down)
uniform float uCamCave;   // camera inside a cave (0..1): deeper vignette
uniform vec4 uBolt;       // lightning strike: world x, y, radius, intensity
uniform float uGrain;     // film grain amount (0 = off)
uniform float uBloom;     // soft bloom around strong lights
// local player's status (src/fx/status.js): A = (hp, cold, hunger, wet), B = (sick, warm, hit flash, heartbeat),
// C = (shake x, shake y, dizzy wobble, sick wave); all 0 = nothing to do
uniform vec4 uFeelA, uFeelB, uFeelC;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// world-space rain streaks (one layer). The streak axis is the fall direction (screen down, slanted by the
// wind: dir); it moves towards +dir, so the crisp bright HEAD is at the bottom end and the TAIL fades out
// above it, thinning (dy = 0 tail ... len head).
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
  if (dy < 0.0 || dy > len) return 0.0;
  float k = dy / len;
  float w = 0.05 * (0.5 + 0.5 * k);
  float head = 1.0 - smoothstep(len - 0.045, len, dy);
  float tail = smoothstep(0.0, 0.8, k);
  return (1.0 - smoothstep(0.0, w, dx)) * head * tail * tail;
}

// world-space snowflakes (one layer): slow fall, drift with the wind, each flake wobbling on its own
float snowLayer(vec2 wp, float scale, float speed, float seed, float dens){
  vec2 p = wp * scale;
  p.y -= uTime * speed;
  p.x -= uTime * speed * uRainDir.x * 1.6;
  vec2 cell = floor(p), f = fract(p) - 0.5;
  float h = hash12(cell + seed);
  if (h > dens) return 0.0;
  vec2 c0 = (vec2(hash12(cell + seed + 3.1), hash12(cell + seed + 7.7)) - 0.5) * 0.55;
  c0.x += sin(uTime * (0.7 + h * 1.3) + h * 40.0) * 0.14;
  float r = length(f - c0);
  float sz = 0.05 + 0.06 * hash12(cell + seed + 1.3);
  return 1.0 - smoothstep(sz * 0.25, sz, r);
}

// water droplets on the "lens" (one layer, p in screen units with y UP): xy = position inside the drop
// (-1..1), z = coverage, w = squared radius (0 centre .. 1 rim)
vec4 dropLayer(vec2 p, float dens, float seed){
  vec2 c = floor(p), f = fract(p) - 0.5;
  float h = hash12(c + seed);
  if (h > dens) return vec4(0.0);
  vec2 o = (vec2(hash12(c + seed + 3.1), hash12(c + seed + 7.3)) - 0.5) * 0.45;
  float r = 0.12 + 0.17 * hash12(c + seed + 1.7);
  vec2 d = (f - o) / r;
  d.y *= 1.12;   // a little heavier at the bottom
  float l = dot(d, d);
  if (l > 1.0) return vec4(0.0);
  return vec4(d, 1.0 - smoothstep(0.8, 1.0, l), l);
}

void main(){
  // ---- status displacement (shiver, dizzy wobble, sick wave) and lens effects (frost, droplets) ----
  vec2 uv = vUV + uFeelC.xy;
  vec2 q0 = vUV - 0.5;
  float e2 = dot(q0, q0);
  if (uFeelC.z > 0.001) {
    uv += vec2(sin(uTime * 0.7), cos(uTime * 0.53)) * 0.005 * uFeelC.z * (0.25 + e2 * 3.0);
    float a = sin(uTime * 0.41) * 0.02 * uFeelC.z * e2 * 3.0;
    uv = 0.5 + mat2(cos(a), -sin(a), sin(a), cos(a)) * (uv - 0.5);
  }
  if (uFeelC.w > 0.001) uv += vec2(sin(vUV.y * 8.0 + uTime * 1.2), cos(vUV.x * 6.0 + uTime * 0.9)) * 0.0018 * uFeelC.w;
  vec2 sp = q0 * vec2(uView.x / uView.y, 1.0);   // aspect-correct screen position (height 1)
  vec2 ae = abs(q0) * 2.0;                       // 0 centre .. 1 screen edges
  float edgeK = max(ae.x, ae.y);
  float frost = 0.0, crys = 0.0, drop = 0.0, dropHi = 0.0, dropRim = 0.0;
  vec2 lens = vec2(0.0);
  if (uFeelA.y > 0.01) {
    // frost creeping in from the corners: feathery ice (ridged noise), reach grows with the cold
    float cd = edgeK * 0.5 + length(ae) * 0.5;
    float n1 = texture(uNoise, sp * 1.4 + 0.13).r, n2 = texture(uNoise, sp * 3.4 + 0.71).g;
    float ridge = 1.0 - abs(n2 * 2.0 - 1.0);
    float reach = 1.42 - uFeelA.y * 0.5;
    frost = smoothstep(reach, reach + 0.26, cd + (n1 - 0.5) * 0.3 + ridge * 0.08);
    crys = pow(ridge, 9.0) * smoothstep(reach - 0.06, reach + 0.14, cd + (n1 - 0.5) * 0.3);
#if QL >= 1
    lens += (vec2(n1, n2) - 0.5) * 0.012 * frost;
#endif
  }
  if (uFeelA.w > 0.01) {
    // droplets beading on the screen edges after wading / heavy rain, a few sliding down slowly
    float band = smoothstep(0.3, 0.9, edgeK - (1.0 - uFeelA.w) * 0.25);
    vec4 d1 = dropLayer(sp * 8.0, 0.55 * uFeelA.w, 1.0);
    vec2 ps = sp * 5.0;
    ps.y += uTime * (0.04 + 0.07 * hash12(vec2(floor(ps.x), 3.0)));   // a few drops slide down slowly
    vec4 d2 = dropLayer(ps, 0.3 * uFeelA.w, 9.0);
    vec4 d = d1.z > d2.z ? d1 : d2;
    drop = d.z * band;
    vec2 g = d.xy - vec2(-0.32, 0.38);                        // glint up-left inside the drop
    dropHi = exp(-dot(g, g) * 16.0) * drop;
    dropRim = smoothstep(0.55, 0.95, d.w) * drop;
#if QL >= 1
    lens -= d.xy * sqrt(max(1.0 - d.w, 0.0)) * vec2(uView.y / uView.x, 1.0) * 0.03 * drop;  // the drop flips what is behind it
#endif
  }
  uv += lens;

  vec2 wp = uCam + vec2(uv.x - 0.5, 0.5 - uv.y) * uView;
  float cave = uHasField > 0.5 ? texture(uCave, wp / uWorld).r : 0.0;
  float outK = 1.0 - cave;
  vec3 c = texture(uScene, uv).rgb;
#if QL >= 1
  // near death: the edges of the view soften (cheap 3-tap blur of the scene)
  float bk = smoothstep(0.6, 1.0, uFeelA.x) * smoothstep(0.1, 0.45, e2);
  if (bk > 0.01) {
    vec2 bo = q0 * 0.016 * bk;
    c = (c + texture(uScene, uv + bo).rgb + texture(uScene, uv - bo).rgb + texture(uScene, uv + vec2(-bo.y, bo.x)).rgb) * 0.25;
  }
#endif
  vec3 alb = c;   // unlit scene (the lightning flash lights this, so firelit spots do not burn out)
  vec3 L = textureLod(uLight, uv, 0.0).rgb * 2.0;
  // point lights over a bright ambient are washed out by daylight: compress their excess by the local
  // ambient level (same cave dimming as AMBIENT_FS), full strength at night and underground
  vec3 ambL = mix(uAmb, min(uAmb, uCaveAmb), pow(cave, 1.4));
  float gain = 1.0 / (1.0 + max(dot(ambL, vec3(0.3, 0.5, 0.2)) - 0.4, 0.0) * 2.0);
  vec3 ex = max(L - ambL, 0.0) * gain;
  ex /= 1.0 + ex * 0.4;   // soft knee: firelight falls off gently instead of burning out the centre
  L = min(L, ambL) + ex;
  c *= L;
  c += max(L - 1.0, 0.0) * 0.07;   // warm bloom where lights are strong
  // light above the ambient level (fires, torches, lanterns): keeps its warmth through the night grade
  float fireK = clamp(dot(ex, vec3(0.4, 0.4, 0.2)) * 2.2, 0.0, 1.0);

#if QL >= 1
  if (uBloom > 0.0) {
    // soft bloom from the mipmapped light map (renderer builds the mips when bloom is on): one or two fetches
    vec3 Lb = textureLod(uLight, uv, 2.5).rgb * 2.0;
#if QL >= 2
    Lb = Lb * 0.55 + textureLod(uLight, uv, 4.0).rgb * 0.9;   // plus a wider, fainter ring
#endif
    c += max((Lb - ambL) * gain - 0.45, 0.0) * vec3(1.0, 0.8, 0.58) * 0.22 * uBloom;
  }
#endif

  // drifting cloud shadows (domain-warped, soft)
  vec2 cuv = wp * 0.0105 + uCloudVel * uTime;
  vec2 cw = (texture(uNoise, cuv * 0.6 + 0.17).gb - 0.5) * 0.35;
  float cl = texture(uNoise, cuv + cw).r * 0.62 + texture(uNoise, wp * 0.026 + uCloudVel * uTime * 1.3 + 0.3 + cw).g * 0.38;
  cl = smoothstep(0.58 - 0.3 * uCloud, 0.82 - 0.12 * uCloud, cl);
  c *= 1.0 - cl * max(0.17 + uCloudSh, 0.0) * uDay * outK;

  // lightning: re-light the scene with a cold flash (barely reaches into caves), stronger near the strike
  float fl = uFlash * (1.0 - cave * 0.92);
  if (uBolt.w > 0.001) {
    vec2 bd = (wp - uBolt.xy) * vec2(1.0, 1.35) / uBolt.z;
    fl += uBolt.w * exp(-dot(bd, bd) * 2.2) * outK;
  }
  c += fl * (alb * 1.3 + 0.04) * (vec3(0.85, 0.9, 1.0) + uFlashCol) / (1.0 + fireK * 1.5);

  // light shafts: soft bands along the low sun, mostly visible in haze and mist
  float rays = 0.0;
  if (uRays > 0.01) {
    vec2 sd = normalize(uSunXY + vec2(1e-4, 0.0)), pp = vec2(-sd.y, sd.x);
    float u = dot(wp, pp) * 0.085 + dot(wp, sd) * 0.006;
    float n = texture(uNoise, vec2(u, uTime * 0.0035)).r * 0.6 + texture(uNoise, vec2(u * 2.3 + 0.37, uTime * 0.006 + 0.5)).g * 0.4;
    rays = smoothstep(0.48, 0.78, n) * uRays * outK;
#if QL >= 2
    // shafts through the canopy gaps: the hazy air above a point is sunlit unless a crown blocks the sun
    // (march the sun-shadow map along the light path): bright haze in the gaps, dim streaks behind crowns
    vec2 sdUV = vec2(uShadowDir.x, -uShadowDir.y) / uView;
    float occ = 0.0;
    for (int k = 1; k <= 5; k++) occ += texture(uShadow, uv + sdUV * (float(k) * 0.55)).r;
    float lit = clamp(1.0 - occ * 0.2 * 1.7, 0.0, 1.0);
    c *= 1.0 - uRays * outK * (1.0 - lit) * 0.1;
    rays = rays * 0.5 + uRays * outK * lit * 0.9;
#endif
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
  fogA += uMist * smoothstep(0.35, 0.75, mist + low * 0.45) * (0.2 + 0.8 * low);   // hugs water and shores
  fogA *= 1.0 - cave * 0.92;
  vec3 fogC = uFogCol * (1.0 + rays * 0.5);
  c = mix(c, fogC, clamp(fogA * (1.0 + rays * 0.35), 0.0, 0.85));
  c += uFogCol * rays * 0.16 * vec3(1.08, 0.97, 0.8);   // warm light shafts in the haze

  // precipitation: rain streaks (parallax layers), snowflakes over cold biomes
  if (uRain > 0.01 && outK > 0.01) {
    float snowK = uHasField > 0.5 ? smoothstep(0.45, 0.75, texture(uClim, wp / uWorld).r) : 0.0;
    vec3 rc = mix(uFogCol * 1.15, vec3(0.75, 0.8, 0.88), 0.4) * (0.55 + 0.45 * uDay);
    if (snowK < 0.99) {
      float r = rainLayer(wp, 1.5, 22.0, 1.0, 0.7 * uRain) * 0.6;
#if QL >= 1
      r += rainLayer(wp + 13.1, 2.2, 17.0, 5.0, 0.75 * uRain) * 0.45;
#endif
#if QL >= 2
      r += rainLayer(wp + 27.7, 3.2, 13.0, 9.0, 0.8 * uRain) * 0.3;
#endif
      c = mix(c, rc, clamp(r, 0.0, 1.0) * 0.62 * outK * (1.0 - snowK));
    }
    if (snowK > 0.01) {
      float sf = snowLayer(wp, 1.1, 1.1, 2.0, 0.55 * uRain) + snowLayer(wp + 7.3, 1.7, 0.85, 6.0, 0.6 * uRain) * 0.8;
#if QL >= 1
      sf += snowLayer(wp + 19.1, 2.6, 0.62, 11.0, 0.65 * uRain) * 0.6;
#endif
      vec3 scol = vec3(0.93, 0.95, 1.0) * clamp(max(L, vec3(0.42)) * (0.75 + 0.25 * uDay), 0.0, 1.25);
      c = mix(c, scol, clamp(sf, 0.0, 1.0) * 0.85 * outK * snowK);
    }
  }

  // grading: gain (tint), lift in the darks, saturation, contrast, soft highlight shoulder.
  // Firelit areas keep a warm, saturated look under the cool night grade.
  vec3 tint = mix(uTint, vec3(1.0), fireK * 0.75);
  tint *= mix(vec3(1.0), vec3(0.9, 0.97, 1.1), uFeelA.y) * mix(vec3(1.0), vec3(0.97, 0.99, 1.03), uFeelA.w)
        * mix(vec3(1.0), vec3(0.95, 1.05, 0.86), uFeelB.x * 0.8);
  c *= tint;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c += uLift * (1.0 - smoothstep(0.0, 0.55, lum)) * (1.0 - fireK * 0.6);
  c += vec3(0.0, 0.012, -0.004) * uFeelB.x;
  lum = dot(c, vec3(0.299, 0.587, 0.114));
  float satF = mix(uSat, max(uSat, 1.06), fireK) * (1.0 - 0.42 * uFeelA.z - 0.22 * uFeelA.x);
  c = mix(vec3(lum), c, satF);
  c = (c - 0.45) * uContrast * (1.0 - 0.1 * uFeelA.z) + 0.45;
  vec3 hi = max(c - 0.82, 0.0);
  c = c - hi + hi / (1.0 + hi * 2.2);
  vec2 v = vUV - 0.5;
  float vg = dot(v, v) * uVig * (1.0 + uCamCave * 0.7) * (1.0 + smoothstep(0.7, 1.0, uFeelA.z) * 1.3);
  c *= 1.0 - vg;
  c = max(c, 0.0);
  if (dot(uFeelA, vec4(1.0)) + uFeelB.x + uFeelB.y + uFeelB.z > 0.002) {
    float rim = smoothstep(0.32, 1.0, length(v * vec2(1.0, 0.92)) * 1.5);   // centre stays clear
    // cold: frosted glass with bright crystal veins
    if (frost > 0.001) {
      lum = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 fc = vec3(0.78, 0.87, 0.97) * (0.55 + 0.6 * lum + 0.25 * uDay);
      c = mix(c, fc, frost * 0.42) + vec3(0.7, 0.82, 1.0) * crys * 0.22;
    }
    // wet: rim darkening of each droplet + a small specular glint
    if (drop > 0.001) c = c * (1.0 + drop * 0.07 - dropRim * 0.4) + vec3(0.92, 0.96, 1.0) * dropHi * 0.55;
    // warm by a fire: a soft golden glow at the edges
    c += vec3(0.15, 0.07, 0.012) * uFeelB.y * rim * (0.85 + 0.15 * sin(uTime * 1.3));
    // low health: red vignette pulsing with the heartbeat; damage: quick red flash
    float red = rim * (uFeelA.x * 0.3 + uFeelB.w * 0.32) + uFeelB.z * (0.1 + 0.3 * rim);
    c = mix(c, vec3(0.42, 0.03, 0.02) + c * vec3(0.35, 0.05, 0.04), clamp(red, 0.0, 0.7));
  }
#if QL >= 1
  // gentle film grain (a bit stronger in the shadows, slowly changing)
  float gr = hash12(floor(gl_FragCoord.xy * 0.75) + floor(uTime * 18.0) * vec2(37.0, 17.0)) - 0.5;
  c += gr * uGrain * (0.6 + 0.4 * (1.0 - smoothstep(0.0, 0.6, lum)));
#endif
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;
