// FX sprites. Mostly white/neutral (tinted at runtime); fx_flame / fx_leaf / fx_ember are colored.

import { spritePx, TAU, lin, rad, circle, leaf } from './paint.js';

const softDot = (stops) => (g, W, H) => {
  g.fillStyle = rad(g, W / 2, H / 2, 0, W / 2, stops);
  g.fillRect(0, 0, W, H);
};

function flame(v) {
  return spritePx(32, 52, (g) => {
    const cx = 16, base = 49;
    const tongue = (s, lean, col) => {
      g.beginPath();
      g.moveTo(cx + lean * s, base - 46 * s);
      g.bezierCurveTo(cx + 4 * s + lean * 0.4 * s, base - 30 * s, cx + 13 * s, base - 20 * s, cx + 11 * s, base - 9 * s);
      g.bezierCurveTo(cx + 9 * s, base, cx - 9 * s, base, cx - 11 * s, base - 9 * s);
      g.bezierCurveTo(cx - 13 * s, base - 20 * s, cx - 4 * s + lean * 0.4 * s, base - 30 * s, cx + lean * s, base - 46 * s);
      g.closePath();
      g.fillStyle = col; g.fill();
    };
    const lean = v === 1 ? 3 : v === 2 ? -3 : 0;
    // soft outer glow (layered, no shadowBlur — that is very slow on canvas)
    tongue(1.12, lean, 'rgba(230,70,10,0.14)');
    tongue(1.04, lean, 'rgba(235,80,12,0.22)');
    tongue(0.98, lean, 'rgba(240,90,15,0.4)');
    tongue(0.92, lean, lin(g, 0, base - 44, 0, base, [[0, 'rgba(230,60,10,0)'], [0.25, 'rgba(240,96,20,0.85)'], [1, 'rgba(255,140,30,1)']]));
    tongue(0.68, lean * 0.8, lin(g, 0, base - 32, 0, base, [[0, 'rgba(255,170,40,0)'], [0.3, 'rgba(255,190,60,0.95)'], [1, 'rgba(255,215,110,1)']]));
    tongue(0.4, lean * 0.5, lin(g, 0, base - 20, 0, base, [[0, 'rgba(255,245,200,0)'], [0.4, 'rgba(255,248,215,0.95)'], [1, 'rgba(255,255,240,1)']]));
  });
}

export function addFx(add) {
  // contact shadow (soft dark ellipse)
  add('fx_blob', spritePx(64, 32, (g) => {
    g.save(); g.scale(1, 0.5);
    g.fillStyle = rad(g, 32, 32, 0, 31, [[0, 'rgba(0,0,0,0.62)'], [0.45, 'rgba(0,0,0,0.42)'], [0.75, 'rgba(0,0,0,0.16)'], [1, 'rgba(0,0,0,0)']]);
    g.fillRect(0, 0, 64, 64); g.restore();
  }), 0.5, 0.5);
  add('fx_soft', spritePx(32, 32, (g) => softDot([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.65)'], [0.7, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']])(g, 32, 32)), 0.5, 0.5);
  add('fx_spark', spritePx(16, 16, (g) => softDot([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.95)'], [0.55, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']])(g, 16, 16)), 0.5, 0.5);
  add('fx_glow', spritePx(64, 64, (g) => softDot([[0, 'rgba(255,200,120,0.9)'], [0.3, 'rgba(255,150,60,0.45)'], [0.7, 'rgba(200,80,20,0.12)'], [1, 'rgba(160,50,10,0)']])(g, 64, 64)), 0.5, 0.5);
  add('fx_ember', spritePx(12, 12, (g) => softDot([[0, 'rgba(255,240,190,1)'], [0.3, 'rgba(255,170,60,0.95)'], [0.65, 'rgba(230,80,20,0.35)'], [1, 'rgba(200,40,0,0)']])(g, 12, 12)), 0.5, 0.5);
  add('fx_smoke', spritePx(64, 64, (g) => {
    const puffs = [[32, 36, 20], [21, 30, 13], [43, 29, 14], [31, 22, 13], [24, 41, 12], [41, 41, 12]];
    for (const [x, y, r] of puffs) {
      g.fillStyle = rad(g, x - r * 0.25, y - r * 0.3, 0, r, [[0, 'rgba(255,255,255,0.5)'], [0.6, 'rgba(240,240,240,0.3)'], [1, 'rgba(230,230,230,0)']]);
      g.beginPath(); circle(g, x, y, r); g.fill();
    }
  }), 0.5, 0.5);
  add('fx_dust', spritePx(48, 48, (g) => {
    // soft billowing puff: overlapping lobes, brighter top-left
    for (const [x, y, r, k] of [[24, 28, 15, 1], [14, 26, 10, 0.9], [34, 25, 11, 0.9], [22, 18, 10, 1.1], [31, 17, 7, 1], [16, 33, 8, 0.8], [34, 33, 8, 0.8]]) {
      g.fillStyle = rad(g, x - r * 0.3, y - r * 0.35, 0, r, [[0, `rgba(248,242,228,${0.5 * k})`], [0.55, `rgba(236,226,206,${0.26 * k})`], [1, 'rgba(230,220,200,0)']]);
      g.beginPath(); circle(g, x, y, r); g.fill();
    }
  }), 0.5, 0.5);
  add('fx_leaf', spritePx(18, 18, (g, P) => P.layer((g) => {
    g.fillStyle = lin(g, 3, 3, 15, 15, [[0, '#8db04c'], [1, '#4d7230']]);
    g.beginPath(); leaf(g, 3, 13, 15, 5, 4, 0.5); g.fill();
    g.strokeStyle = 'rgba(40,60,20,0.8)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(4, 12.5); g.lineTo(13.5, 6); g.stroke();
  }, 1.1, 'rgba(30,36,16,0.8)')), 0.5, 0.5);
  // seasons: a blossom petal (spring, white → tinted pink) and an ice shard (winter walkers shattering)
  add('fx_petal', spritePx(12, 12, (g, P) => P.layer((g) => {
    g.fillStyle = lin(g, 2, 3, 10, 9, [[0, '#ffffff'], [1, '#f1dde4']]);
    g.beginPath(); g.ellipse(6, 6, 4.4, 2.7, 0.5, 0, TAU); g.fill();
    g.fillStyle = 'rgba(226,160,184,0.6)'; g.beginPath(); g.ellipse(3.8, 7.4, 1.3, 0.8, 0.5, 0, TAU); g.fill();
  }, 0.7, 'rgba(150,96,112,0.5)')), 0.5, 0.5);
  add('fx_shard', spritePx(12, 20, (g, P) => P.layer((g) => {
    g.fillStyle = lin(g, 2, 2, 10, 18, [[0, '#ffffff'], [0.45, '#d4f2fc'], [1, '#7cc2de']]);
    g.beginPath(); g.moveTo(6, 1); g.lineTo(10, 8); g.lineTo(7.5, 19); g.lineTo(3, 12.5); g.lineTo(2.5, 6); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(6, 2.2); g.lineTo(5.6, 15); g.stroke();
  }, 0.9, 'rgba(36,86,116,0.65)')), 0.5, 0.5);
  add('fx_drop', spritePx(4, 32, (g) => {
    g.fillStyle = lin(g, 0, 0, 0, 32, [[0, 'rgba(255,255,255,0)'], [0.7, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0.95)']]);
    g.beginPath(); g.moveTo(2, 0); g.lineTo(3, 30); g.quadraticCurveTo(2, 32, 1, 30); g.closePath(); g.fill();
  }), 0.5, 1);
  add('fx_ring', spritePx(80, 56, (g) => {
    const cx = 40, cy = 28, rx = 35, ry = 23;
    for (const [lw, a] of [[9, 0.1], [6, 0.18]]) { g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = lw; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2.6;
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 5;
    g.beginPath(); g.ellipse(cx, cy, rx - 3.5, ry - 2.5, 0, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,1)';
    for (const [x, y, a] of [[cx, cy - ry, 0], [cx, cy + ry, Math.PI], [cx - rx, cy, -Math.PI / 2], [cx + rx, cy, Math.PI / 2]]) {
      g.save(); g.translate(x, y); g.rotate(a);
      g.beginPath(); g.moveTo(-4, -3.5); g.lineTo(4, -3.5); g.lineTo(0, 3); g.closePath(); g.fill();
      g.restore();
    }
  }), 0.5, 0.5);
  add('fx_splash', spritePx(64, 44, (g) => {
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2.2;
    g.beginPath(); g.ellipse(32, 32, 24, 9, 0, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(32, 32, 15, 5.5, 0, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (const [x, y, r] of [[22, 18, 2.2], [32, 11, 2.6], [42, 17, 2.1], [27, 6, 1.5], [38, 7, 1.4], [16, 25, 1.6], [48, 24, 1.6]]) { g.beginPath(); g.ellipse(x, y, r * 0.8, r * 1.2, 0, 0, TAU); g.fill(); }
  }), 0.5, 0.72);
  add('fx_slash', spritePx(80, 80, (g) => {
    // tapered crescent over the top (opening toward the bottom), bright leading edge fading into a trail;
    // rotate at runtime toward the hit direction
    const cx = 40, cy = 46;
    const cres = (r, th, a0, a1) => {
      g.beginPath();
      const n = 24;
      for (let i = 0; i <= n; i++) { const t = i / n, a = a0 + (a1 - a0) * t, w = th * Math.sin(t * Math.PI) ** 0.8; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      for (let i = n; i >= 0; i--) { const t = i / n, a = a0 + (a1 - a0) * t, w = th * Math.sin(t * Math.PI) ** 0.8; const x = cx + Math.cos(a) * (r - w), y = cy + Math.sin(a) * (r - w); g.lineTo(x, y); }
      g.closePath();
    };
    cres(35, 15, Math.PI * 1.02, Math.PI * 1.98); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fill();
    cres(33, 11, Math.PI * 1.06, Math.PI * 1.94); g.fillStyle = lin(g, 6, 0, 74, 0, [[0, 'rgba(255,255,255,0.1)'], [0.5, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0.75)']]); g.fill();
    cres(32, 5.5, Math.PI * 1.12, Math.PI * 1.9); g.fillStyle = lin(g, 8, 0, 74, 0, [[0, 'rgba(255,255,255,0.3)'], [0.6, 'rgba(255,255,255,0.95)'], [1, 'rgba(255,255,255,1)']]); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [a, r, s] of [[1.3, 26, 1.4], [1.55, 23, 1.1], [1.75, 27, 1.2]]) { g.beginPath(); circle(g, cx + Math.cos(Math.PI * a) * r, cy + Math.sin(Math.PI * a) * r, s); g.fill(); }
  }), 0.5, 0.5);
  add('fx_star', spritePx(32, 32, (g) => {
    // hit sparkle: soft core + long 4-point rays + short diagonal rays
    g.fillStyle = rad(g, 16, 16, 0, 16, [[0, 'rgba(255,255,255,0.85)'], [0.35, 'rgba(255,255,255,0.2)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, 32, 32);
    const star = (n, r0, r1, rot) => { g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * TAU + rot, r = i % 2 ? r1 : r0; const x = 16 + Math.cos(a) * r, y = 16 + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.fill(); };
    g.fillStyle = 'rgba(255,255,255,0.7)'; star(4, 9, 1.6, Math.PI / 4);
    g.fillStyle = '#ffffff'; star(4, 15.5, 2.2, -Math.PI / 2);
    g.beginPath(); circle(g, 16, 16, 3); g.fill();
  }), 0.5, 0.5);
  // shield block: bright spark burst with flying shards (white, tint at runtime — e.g. gold)
  add('fx_block', spritePx(48, 48, (g) => {
    g.fillStyle = rad(g, 24, 24, 0, 22, [[0, 'rgba(255,255,255,0.95)'], [0.3, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]); g.fillRect(0, 0, 48, 48);
    g.strokeStyle = '#ffffff'; g.lineCap = 'round';
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + 0.2, r0 = 6, r1 = 15 + (i % 3) * 4; g.lineWidth = 2.4 - (i % 3) * 0.5; g.beginPath(); g.moveTo(24 + Math.cos(a) * r0, 24 + Math.sin(a) * r0); g.lineTo(24 + Math.cos(a) * r1, 24 + Math.sin(a) * r1); g.stroke(); }
    g.fillStyle = '#ffffff'; for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.6, r = 19; g.beginPath(); circle(g, 24 + Math.cos(a) * r, 24 + Math.sin(a) * r, 1.3); g.fill(); }
    g.beginPath(); circle(g, 24, 24, 4.5); g.fill();
  }), 0.5, 0.5);
  // broken chunks of rock (cave-ins: pieces of the ceiling falling): grey, tinted at runtime by the rock colour.
  // Three shapes, each an outline, a lit top facet and a shaded face split by a ridge.
  const RUBBLE = [
    { pts: [[6, 14], [11, 6], [20, 4], [27, 10], [28, 19], [22, 27], [12, 28], [5, 22]], top: [[9, 13], [13, 8], [20, 7], [24, 11], [17, 15]], low: [[17, 15], [25, 12], [25, 19], [20, 24], [14, 25]], ridge: [[9, 13], [17, 15], [25, 12]], leg: [[17, 15], [14, 25]] },
    { pts: [[3, 18], [8, 9], [17, 7], [29, 12], [27, 21], [18, 25], [8, 25]], top: [[7, 16], [10, 10], [17, 9], [26, 13], [16, 17]], low: [[16, 17], [26, 14], [24, 20], [17, 23], [10, 22]], ridge: [[7, 16], [16, 17], [26, 14]], leg: [[16, 17], [12, 23]] },
    { pts: [[9, 5], [21, 6], [27, 15], [24, 27], [13, 28], [5, 20], [5, 11]], top: [[8, 11], [11, 7], [20, 8], [23, 14], [14, 16]], low: [[14, 16], [23, 15], [22, 25], [14, 26]], ridge: [[8, 11], [14, 16], [23, 15]], leg: [[14, 16], [14, 26]] },
  ];
  RUBBLE.forEach((R, n) => add(n ? 'fx_rubble_' + n : 'fx_rubble', spritePx(32, 32, (g) => {
    const path = (pts, k = 1) => { g.beginPath(); pts.forEach(([x, y], i) => { const px = 16 + (x - 16) * k, py = 16 + (y - 16) * k; i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath(); };
    path(R.pts); g.fillStyle = '#2a2724'; g.fill();                                  // outline
    path(R.pts, 0.86); g.fillStyle = lin(g, 6, 6, 26, 26, [[0, '#f2eee8'], [0.45, '#c9c4bc'], [1, '#7d7871']]); g.fill();
    path(R.top); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
    path(R.low); g.fillStyle = 'rgba(40,36,32,0.3)'; g.fill();
    g.strokeStyle = 'rgba(40,36,32,0.45)'; g.lineWidth = 1; g.beginPath();
    R.ridge.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.moveTo(...R.leg[0]); g.lineTo(...R.leg[1]); g.stroke();
  }), 0.5, 0.5));
  // poison: bubbly green cloud with drips (colored)
  add('fx_poison', spritePx(40, 40, (g, P) => P.layer((g) => {
    for (const [x, y, r] of [[20, 22, 9], [12, 20, 6], [28, 19, 7], [19, 13, 6], [26, 27, 5], [13, 28, 4.5]]) {
      g.fillStyle = rad(g, x - r * 0.35, y - r * 0.35, 0, r, [[0, 'rgba(200,255,140,0.95)'], [0.6, 'rgba(110,190,60,0.85)'], [1, 'rgba(60,120,30,0.8)']]);
      g.beginPath(); circle(g, x, y, r); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); circle(g, x - r * 0.35, y - r * 0.4, r * 0.22); g.fill();
    }
    g.fillStyle = 'rgba(110,190,60,0.9)'; g.beginPath(); g.ellipse(16, 33, 1.6, 2.8, 0, 0, TAU); g.ellipse(25, 33.5, 1.3, 2.4, 0, 0, TAU); g.fill();
  }, 1.4, 'rgba(24,48,14,0.85)')), 0.5, 0.5);
  // blood droplet splat (colored dark red; particles can tint lighter)
  add('fx_blood', spritePx(24, 24, (g) => {
    g.fillStyle = '#8a1218';
    g.beginPath(); circle(g, 12, 13, 5.5); g.fill();
    for (const [x, y, r] of [[5, 8, 2], [19, 7, 1.6], [20, 17, 2.2], [6, 19, 1.4], [13, 4, 1.2]]) { g.beginPath(); circle(g, x, y, r); g.fill(); }
    g.fillStyle = '#c42a2a'; g.beginPath(); circle(g, 11, 12, 3.8); g.fill();
    g.fillStyle = 'rgba(255,200,190,0.8)'; g.beginPath(); circle(g, 9.6, 10.6, 1.1); g.fill();
  }), 0.5, 0.5);
  // three claw rakes (animal attacks); white, rotate/tint at runtime
  add('fx_claw', spritePx(48, 48, (g) => {
    for (let i = 0; i < 3; i++) {
      const o = (i - 1) * 9;
      g.beginPath(); g.moveTo(10 + o, 8); g.quadraticCurveTo(22 + o, 22, 30 + o, 42); g.quadraticCurveTo(20 + o, 24, 7 + o, 11); g.closePath();
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
    }
  }), 0.5, 0.5);
  for (let i = 0; i < 3; i++) add('fx_flame_' + i, flame(i), 0.5, 49 / 52);
  // contract name (single flame) = variant 0
  add('fx_flame', flame(0), 0.5, 49 / 52);
}
