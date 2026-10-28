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

export const TERRAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUV;
out vec4 o;
uniform vec2 uCam, uView, uWorld;
uniform float uTime;
uniform sampler2D uTile;    // R ground id, G random, B rock type (regional), A ore
uniform sampler2D uField;   // 4x res, linear: R rock mask, G rock height, B water depth, A shore wetness
uniform sampler2D uField2;  // 1x res, linear: R lushness, GB river flow (0.5 = none), A snow
uniform sampler2D uNoise;   // tileable noise RGBA
uniform sampler2D uShadow;  // sprite sun-shadows (screen space)
uniform sampler2DArray uGround; // 0..7 ground, 8..11 rock types
uniform vec2 uShadowDir;
uniform float uShadowStr;
uniform vec3 uSun;          // light dir (x, y-down, z-up), normalized
uniform float uSunI;        // sun intensity 0..1
uniform vec3 uSky;          // reflection color
uniform float uWet;         // rain wetness

int idAt(ivec2 c){
  c = clamp(c, ivec2(0), ivec2(uWorld) - 1);
  return int(texelFetch(uTile, c, 0).r * 255.0 + 0.5);
}

vec3 groundCol(int id, vec2 wp){
  float l = float(id);
  vec3 a = texture(uGround, vec3(wp * 0.25, l)).rgb;
  vec3 b = texture(uGround, vec3(wp * 0.093 + vec2(0.37, 0.71), l)).rgb;
  return mix(a, b, 0.38);
}

vec4 field(vec2 wp){ return texture(uField, wp / uWorld); }

void main(){
  vec2 wp = uCam + vec2(vUV.x - 0.5, 0.5 - vUV.y) * uView;
  vec4 nA = texture(uNoise, wp * 0.093);
  vec4 nB = texture(uNoise, wp * 0.29 + 0.5);
  vec4 nC = texture(uNoise, wp * 0.021 + 0.25);
  vec2 warp = (nA.xy - 0.5) * 0.9 + (nB.xy - 0.5) * 0.35;

  // ---------- ground blend (4 nearest tiles, noise-warped, sharpened) ----------
  vec2 q = wp + warp - 0.5;
  ivec2 i0 = ivec2(floor(q));
  vec2 f = fract(q);
  int a = idAt(i0), b = idAt(i0 + ivec2(1, 0)), c = idAt(i0 + ivec2(0, 1)), d = idAt(i0 + ivec2(1, 1));
  vec3 col;
  if (a == b && a == c && a == d) {
    col = groundCol(a, wp);
  } else {
    vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    w = w * w * w;
    w /= (w.x + w.y + w.z + w.w);
    col = groundCol(a, wp) * w.x + groundCol(b, wp) * w.y + groundCol(c, wp) * w.z + groundCol(d, wp) * w.w;
  }

  vec4 F2 = texture(uField2, wp / uWorld);
  // lush areas get a faint green cast (grass roots / moss under the plant sprites)
  col = mix(col, col * vec3(0.86, 1.07, 0.72), F2.r * 0.55 * (0.7 + 0.6 * nB.z));
  // large scale mottling
  col *= 0.88 + 0.24 * nC.z;

  vec4 F = field(wp);
  // damp ground near water + rain
  col *= 1.0 - 0.30 * F.a - 0.16 * uWet;

  // ---------- rock (mountains) ----------
  vec2 rq = wp + (nB.zw - 0.5) * 0.16 + (nA.zw - 0.5) * 0.12;
  float rm = field(rq).r;
  float shadowMask = 1.0;
  if (rm > 0.47) {
    float e = 0.28;
    float hl = field(rq - vec2(e, 0.0)).g, hr = field(rq + vec2(e, 0.0)).g;
    float hu = field(rq - vec2(0.0, e)).g, hd = field(rq + vec2(0.0, e)).g;
    float h = field(rq).g;
    vec3 N = normalize(vec3((hl - hr) * 2.6, (hu - hd) * 2.6, 0.32));
    int rt = int(texelFetch(uTile, ivec2(clamp(floor(rq), vec2(0.0), uWorld - 1.0)), 0).b * 255.0 + 0.5);
    float layer = 8.0 + float(clamp(rt - 1, 0, 3));
    vec3 rc = texture(uGround, vec3(wp * 0.22, layer)).rgb;
    vec3 rc2 = texture(uGround, vec3(wp * 0.071 + 0.3, layer)).rgb;
    rc = mix(rc, rc2, 0.35);
    // detail bump from texture luminance
    float dl = dot(rc, vec3(0.33));
    N = normalize(N + vec3((nB.x - 0.5) * 0.25, (nB.y - 0.5) * 0.25, 0.0));
    float lit = 0.50 + 0.62 * max(dot(N, uSun), 0.0) * (0.35 + 0.65 * uSunI);
    vec3 rock = rc * lit * (0.86 + 0.22 * h);
    // ore specks
    float ore = texelFetch(uTile, ivec2(clamp(floor(rq), vec2(0.0), uWorld - 1.0)), 0).a * 255.0;
    if (ore > 0.5) {
      float sp = texture(uNoise, wp * 0.9).w;
      vec3 oc = ore < 1.5 ? vec3(0.55, 0.36, 0.25) : (ore < 2.5 ? vec3(0.95, 0.78, 0.25) : vec3(0.3, 0.75, 0.55));
      rock = mix(rock, oc * (0.7 + 0.5 * lit), smoothstep(0.62, 0.70, sp) * 0.9);
    }
    // dark rim (RimWorld-style outline) + inner edge highlight
    float rim = smoothstep(0.47, 0.56, rm);
    rock *= mix(0.28, 1.0, rim);
    rock += vec3(0.05) * smoothstep(0.56, 0.62, rm) * (1.0 - smoothstep(0.62, 0.8, rm)) * uSunI;
    col = rock;
    shadowMask = 0.35;
  } else {
    // ambient occlusion at mountain feet
    col *= 1.0 - 0.38 * smoothstep(0.12, 0.47, rm);
    // mountain cast shadow along sun direction
    float rs = 0.0;
    for (int k = 1; k <= 5; k++) {
      float t = float(k) * 0.32;
      float occ = smoothstep(0.42, 0.55, field(wp - uShadowDir * t).r);
      rs = max(rs, occ * (1.0 - float(k) * 0.09));
    }
    col *= 1.0 - rs * uShadowStr * 0.85;
  }

  // ---------- water ----------
  vec2 wq = wp + warp * 0.45;
  float wd = field(wq).b;
  float wl = wd + (nB.x - 0.5) * 0.10 + (nA.w - 0.5) * 0.06;
  if (wl > 0.26 && rm <= 0.47) {
    float deep = smoothstep(0.38, 0.95, wl);
    vec2 flow = (F2.gb - 0.5) * 2.0;
    float ph0 = fract(uTime * 0.2), ph1 = fract(uTime * 0.2 + 0.5);
    float mixW = abs(ph0 * 2.0 - 1.0);
    vec2 base1 = wp * 0.23 + uTime * vec2(0.017, 0.011);
    vec2 base2 = wp * 0.37 - uTime * vec2(0.013, -0.019);
    vec2 n0 = texture(uNoise, base1 - flow * ph0 * 0.9).xy + texture(uNoise, base2 - flow * ph0 * 1.3).yz;
    vec2 n1 = texture(uNoise, base1 - flow * ph1 * 0.9 + 0.5).xy + texture(uNoise, base2 - flow * ph1 * 1.3 + 0.5).yz;
    vec2 nn = mix(n0, n1, mixW) - 1.0;
    vec3 N = normalize(vec3(nn * 0.85, 1.0));
    vec3 shallowCol = vec3(0.30, 0.47, 0.44);
    vec3 deepCol = vec3(0.075, 0.17, 0.23);
    vec3 bottom = groundCol(2, wp + nn * 0.15) * 0.8;
    vec3 wc = mix(mix(bottom, shallowCol, 0.62), deepCol, deep);
    wc = mix(wc, uSky, 0.10 + 0.10 * clamp(nn.x + 0.5, 0.0, 1.0));
    // caustics in the shallows
    float cz = texture(uNoise, wp * 0.47 + nn * 0.25 + uTime * 0.03).w;
    float ca = pow(1.0 - abs(cz * 2.0 - 1.0), 9.0);
    wc += ca * (1.0 - deep) * 0.16 * (0.3 + 0.7 * uSunI);
    // sun glints
    vec3 H = normalize(uSun + vec3(0.0, 0.0, 1.0));
    float sp = pow(max(dot(N, H), 0.0), 90.0);
    wc += sp * 0.55 * uSunI;
    // shore: darker wet line + animated foam
    float edge = smoothstep(0.26, 0.30, wl);
    float shore = 1.0 - smoothstep(0.29, 0.42, wl);
    float fl = texture(uNoise, wp * 0.63 + vec2(uTime * 0.025, uTime * 0.01)).r;
    float wave = 0.5 + 0.5 * sin(uTime * 1.4 - wl * 28.0 + fl * 6.0);
    float foam = smoothstep(0.62, 0.8, fl * 0.7 + wave * 0.45) * shore;
    col *= mix(1.0, 0.7, smoothstep(0.2, 0.27, wl) * (1.0 - edge));
    col = mix(col, wc, edge);
    col = mix(col, vec3(0.86, 0.91, 0.89), foam * 0.5 * edge);
    shadowMask = 0.55;
  }

  // ---------- sprite sun shadows ----------
  float sh = texture(uShadow, vUV).r;
  col *= 1.0 - sh * uShadowStr * shadowMask;

  o = vec4(col, 1.0);
}`;

export const POST_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uScene, uLight, uNoise;
uniform vec2 uCam, uView;
uniform float uTime;
uniform float uCloud;   // cloud cover 0..1
uniform float uDay;     // daylight 0..1
uniform vec2 uCloudVel;
uniform float uFog;
uniform vec3 uFogCol;
uniform vec3 uTint;
uniform float uSat, uContrast, uVig, uFlash;
void main(){
  vec3 c = texture(uScene, vUV).rgb;
  vec3 L = texture(uLight, vUV).rgb * 2.0;
  c *= L;
  // warm bloom where lights are strong
  c += max(L - 1.0, 0.0) * 0.06;

  vec2 wp = uCam + vec2(vUV.x - 0.5, 0.5 - vUV.y) * uView;
  // drifting cloud shadows
  float cl = texture(uNoise, wp * 0.0105 + uCloudVel * uTime).r * 0.62
           + texture(uNoise, wp * 0.027 + uCloudVel * uTime * 1.35 + 0.3).g * 0.38;
  cl = smoothstep(0.52 - 0.28 * uCloud, 0.78, cl) * (0.35 + 0.65 * uCloud);
  c *= 1.0 - cl * 0.30 * uDay;

  // ground mist
  float mist = texture(uNoise, wp * 0.018 + uTime * vec2(0.0021, 0.0009)).b;
  mist = mix(mist, texture(uNoise, wp * 0.047 - uTime * vec2(0.003, 0.002)).a, 0.4);
  c = mix(c, uFogCol, clamp(uFog * (0.35 + mist * 0.9), 0.0, 0.85));

  c *= uTint;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  vec2 v = vUV - 0.5;
  c *= 1.0 - dot(v, v) * uVig;
  c += uFlash;
  // dither
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;
