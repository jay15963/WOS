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
`;

// sway displacement shared by sprite & shadow shaders
const SWAY_FN = `
vec2 swayLocal(vec2 c, vec2 local){
  float top = clamp(aAnchor.y - c.y, 0.0, 1.0);
  float ph = uTime * (1.3 + uWind) + aPos.x * 0.63 + aPos.y * 0.37;
  float gust = sin(uTime * 0.45 + aPos.x * 0.09 + aPos.y * 0.05) * 0.5 + 0.5;
  float s = sin(ph) * 0.55 + sin(ph * 2.31 + 1.7) * 0.25 + (0.4 + uWind) * gust * 0.8;
  local.x += s * aParams.x * top * top * aSize.y * (0.6 + uWind);
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

// Ground, rock (mountains), water. One fullscreen pass, world-space.
// Extra uniforms (uRain, uSunWarm, uCloud, uCloudVel...) come from env.extra (0 = neutral defaults).
export const TERRAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUV;
out vec4 o;
uniform vec2 uCam, uView, uWorld;
uniform float uTime;
uniform sampler2D uTile;    // R ground id, G random, B rock type (regional 1..4), A ore
uniform sampler2D uField;   // 4x res, linear: R rock mask, G rock height, B water depth, A shore wetness
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
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
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

// rounded ore nuggets on rock tops, clustered inside ore tiles
void oreNuggets(vec2 wp, float sc, float seed, float skip, float rs, inout vec3 col){
  vec2 p = wp * sc;
  vec2 c = floor(p), f = fract(p);
  vec2 h1 = hash22(c + seed), h2 = hash22(c + seed + 19.19);
  if (h1.x < skip) return;
  vec2 cw = (c + 0.5) / sc;
  float ov = texelFetch(uTile, ivec2(clamp(floor(cw), vec2(0.0), uWorld - 1.0)), 0).a * 255.0;
  if (ov < 0.5) return;
  vec2 ctr = 0.38 + 0.24 * h2;
  float r = (0.17 + 0.15 * h1.y) * rs;
  vec2 d = f - ctr;
  float a = atan(d.y, d.x);
  float rr = r * (1.0 + 0.15 * sin(a * 3.0 + h1.y * 40.0) + 0.08 * sin(a * 5.0 + h2.x * 30.0));
  float dist = length(d) / rr;
  vec2 so = normalize(uShadowDir + vec2(1e-4, 0.0)) * r * 0.45;
  float dsh = length(d - so) / rr;
  col *= 1.0 - 0.45 * (1.0 - smoothstep(0.75, 1.2, dsh)) * step(0.97, dist);
  if (dist < 1.0) {
    vec3 oc = ov < 1.5 ? vec3(0.46, 0.52, 0.62) : (ov < 2.5 ? vec3(1.0, 0.78, 0.22) : vec3(0.26, 0.76, 0.50));
    float spe = ov < 1.5 ? 0.9 : (ov < 2.5 ? 1.3 : 0.75);
    vec3 n = normalize(vec3(d / rr * 1.15, sqrt(max(1.0 - dist * dist, 0.0)) + 0.2));
    // faceted look: quantize normal a little
    n = normalize(n + vec3((hash22(floor((f + h1) * 9.0)) - 0.5) * 0.35, 0.0));
    float l = max(dot(n, uSun), 0.0);
    vec3 c2 = oc * (0.40 + 0.8 * l * (0.35 + 0.65 * uSunI));
    vec3 H = normalize(uSun + vec3(0.0, 0.0, 1.0));
    c2 += pow(max(dot(n, H), 0.0), 26.0) * spe * (0.2 + 0.8 * uSunI);
    c2 = mix(c2, oc * 0.13, smoothstep(0.72, 0.95, dist));
    col = mix(col, c2, 1.0 - smoothstep(0.92, 1.0, dist));
  }
}

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
  vec3 sunT = vec3(1.0) + uSunWarm;

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
    float dif = max(dot(N, uSun), 0.0);
    float shade = 0.5 + 0.68 * dif * (0.3 + 0.7 * uSunI);
    vec3 alb = RT.rgb * (0.93 + 0.14 * nC.z) * 0.92;
    // mass: darker toward the edges, lighter on the high ground and crests
    float mass = (0.86 + 0.14 * smoothstep(0.25, 1.3, sd) + 0.08 * Fr.g) * (0.92 + 0.16 * r0 * rk);
    vec3 rock = alb * shade * mass * mix(vec3(1.0), sunT, dif * uSunI);
    rock *= 0.8 + 0.4 * smoothstep(0.12, 0.6, RT.a);         // cavities
    // ore veins
    if (ta.a + tb.a + tc.a + td.a > 0.0 && sd > 0.2) {
      oreNuggets(wp, 1.6, 3.7, 0.25, 1.0, rock);
      oreNuggets(wp + 0.37, 2.9, 11.3, 0.65, 0.75, rock);
    }
    // RimWorld-like edge: thick dark outline + lighter bevel just inside it
    const float OW = 0.085;
    vec2 sunXY = normalize(uSun.xy + vec2(1e-4, 0.0));
    float facing = dot(outward, sunXY);
    float bev = smoothstep(OW, OW + 0.02, sd) * (1.0 - smoothstep(OW + 0.07, OW + 0.2, sd));
    rock *= 1.0 + bev * (0.3 + 0.35 * facing * (0.3 + 0.7 * uSunI));
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

    // rain wetness: darker, a bit richer; puddles in low spots; marsh keeps standing water
    float wet = uWet;
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
      vec3 rp = uRain > 0.02 ? ripples(wp) * uRain : vec3(0.0);
      vec2 pn = rp.xy + (nB.xy - 0.5) * 0.08;
      vec3 Np = normalize(vec3(pn, 1.0));
      vec3 pc = col * vec3(0.5, 0.55, 0.55) + uSky * 0.2;
      pc += pow(max(dot(Np, Hs), 0.0), 90.0) * 0.6 * uSunI * sunT;
      pc += rp.z * 0.12 * (uSky + 0.1);
      col = mix(col, pc, pm * 0.85);
    }

    // ---------- mountains: ambient occlusion + cast shadow ----------
    float prox = F2.a;
    if (sd > -1.6) col *= 1.0 - 0.42 * pow(1.0 - clamp(-sd / 1.35, 0.0, 1.0), 2.0);
    col *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.6, prox));
    if (prox < 0.95 && uShadowStr > 0.01) {
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
      col *= 1.0 - rs * min(uShadowStr * 1.35, 0.75) * vec3(1.0, 0.95, 0.84);
    }

    // ================= WATER =================
    col *= 1.0 - 0.3 * smoothstep(0.16, 0.255, wl);          // wet dark sand at the waterline
    if (wl > 0.235) {
      vec2 flow = (F2.gb - 0.5) * 2.0;
      float fl = length(flow);
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
      float sparkMask = smoothstep(0.62, 0.8, textureLod(uNoise, wp * 0.9 + uTime * vec2(0.05, -0.04), nLod(0.9)).g);
      float lightI = uSunI + uNight * 0.3 * (1.0 - uCloud);   // moonlight glints at night
      wc += (pow(nh, 160.0) * 0.4 + pow(nh, 1600.0) * 2.2 * sparkMask) * lightI * sunT * (1.0 - uCloud * 0.6);
      // shore foam + thin bright lip at the waterline
      float shore = 1.0 - smoothstep(0.27, 0.42, wl);
      float fn = textureLod(uNoise, wp * 0.7 + vec2(uTime * 0.03, uTime * 0.012), nLod(0.7)).r;
      float wave = 0.5 + 0.5 * sin(uTime * 1.25 - wl * 34.0 + fn * 7.0);
      float foam = smoothstep(0.66, 0.9, fn * 0.55 + wave * 0.55) * shore;
      foam += (1.0 - smoothstep(0.26, 0.29, wl)) * 0.55 * (0.55 + 0.45 * fn);
      if (fl > 0.15) {
        // flow streaks on the river
        vec2 fd = flow / fl, pd = vec2(-fd.y, fd.x);
        vec2 sp2 = vec2(dot(wp, fd) * 0.32 - uTime * 0.3 * fl, dot(wp, pd) * 1.7);
        float st = textureLod(uNoise, sp2, nLod(1.7)).b;
        foam += smoothstep(0.64, 0.84, st) * 0.4 * smoothstep(0.15, 0.6, fl) * (1.0 - depth * 0.4);
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
  col *= 1.0 - sh * uShadowStr * shadowMask * vec3(1.0, 0.96, 0.86);

  o = vec4(col, 1.0);
}`;

// Lighting composite + atmosphere + grading. Extra uniforms via env.extra (0 = neutral).
export const POST_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uScene, uLight, uNoise, uField;
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

  // drifting cloud shadows (domain-warped, soft)
  vec2 cuv = wp * 0.0105 + uCloudVel * uTime;
  vec2 cw = (texture(uNoise, cuv * 0.6 + 0.17).gb - 0.5) * 0.35;
  float cl = texture(uNoise, cuv + cw).r * 0.62 + texture(uNoise, wp * 0.026 + uCloudVel * uTime * 1.3 + 0.3 + cw).g * 0.38;
  cl = smoothstep(0.58 - 0.3 * uCloud, 0.82 - 0.12 * uCloud, cl);
  c *= 1.0 - cl * max(0.17 + uCloudSh, 0.0) * uDay;

  // lightning: re-light the scene with a cold flash
  c += uFlash * (c * 2.2 + 0.05) * (vec3(0.85, 0.9, 1.0) + uFlashCol);

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
  c = mix(c, uFogCol, clamp(fogA, 0.0, 0.85));

  // rain streaks (3 parallax layers)
  if (uRain > 0.01) {
    float r = rainLayer(wp, 1.5, 22.0, 1.0, 0.7 * uRain) * 0.6
            + rainLayer(wp + 13.1, 2.2, 17.0, 5.0, 0.75 * uRain) * 0.45
            + rainLayer(wp + 27.7, 3.2, 13.0, 9.0, 0.8 * uRain) * 0.3;
    vec3 rc = mix(uFogCol * 1.15, vec3(0.75, 0.8, 0.88), 0.4) * (0.55 + 0.45 * uDay);
    c = mix(c, rc, clamp(r, 0.0, 1.0) * 0.55);
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
  float vg = dot(v, v) * uVig;
  c *= 1.0 - vg;
  c = max(c, 0.0);
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;
