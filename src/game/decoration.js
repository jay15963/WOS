// Decoration & architecture presentation (agent K), sync 'cosmetic':
//  - KIT_ENV.night for the night glow of windows / lamps (art/archCompose.js)
//  - training dummies: floating numbers for every hit (op dummy.hit → event 'dummyhit'), a DPS readout on the
//    nameplate / target frame (local, from the hits seen), straw puffs
//  - localhost only: game.debugK.showcase() builds a decorated base next to the player through ops
//    (single player / host), game.debugK.fill(n) spawns n decorated pieces for performance tests.

import { KIT_ENV, archSprite, prewarmArch } from '../art/archCompose.js';
import { BUILDINGS } from './data.js';
import { DUMMY_NAME } from './mut/kit.js';

const DEV = typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);
const DPS_WIN = 5; // s

export function decorSystem(game) {
  const dummies = new Set();
  game.events.on('dummyhit', (d) => {
    const o = d.o, p = game.player;
    if (d.mine) game.events.emit('damage', { target: o, src: p, amount: d.amount, crit: d.crit, kind: 'hit', dtype: d.dtype || 'phys' });
    else game.events.emit('damage', { target: o, src: null, amount: 0, kind: 'status', text: d.crit ? `${d.amount}!` : String(d.amount), dtype: d.dtype || 'phys' });
    const H = o._hits || (o._hits = []);
    H.push(game.time, d.amount);
    while (H.length > 80) H.splice(0, 2);
    dummies.add(o);
  });
  if (DEV) installShowcase(game);
  // lazy art (styles, details, decoration): paint what the loaded world uses before the first frames
  prewarmArch(game, 700);
  game.events.on('worldreset', () => prewarmArch(game, 500));
  let acc = 0;
  return {
    sync: 'cosmetic', // glow and readouts only
    update(g, dt) {
      KIT_ENV.night = g.env?.env?.night || 0;
      // who stands near the view (a lit window right behind someone must not glow through them: archCompose)
      KIT_ENV.game = g;
      const E = KIT_ENV.ents; E.length = 0;
      if (KIT_ENV.night > 0.05 && !g.headless) {
        const v = g.view?.();
        const inV = (e) => !v || (e.x > v.x0 - 1 && e.x < v.x1 + 1 && e.y > v.y0 - 1 && e.y < v.y1 + 3);
        if (g.player && !g.player.dead) E.push(g.player);
        for (const pl of g.session?.players?.values?.() || []) if (pl.ent && !pl.ent.dead && inV(pl.ent)) E.push(pl.ent);
        for (const e of g.entities || []) if (e !== g.player && !e.dead && !e.isProp && inV(e)) { E.push(e); if (E.length > 64) break; }
      }
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      for (const o of dummies) {
        if (o.removed || !o.dummy) { dummies.delete(o); continue; }
        const H = o._hits, now = g.time;
        let sum = 0, first = now;
        for (let i = 0; i < H.length; i += 2) if (now - H[i] <= DPS_WIN) { sum += H[i + 1]; first = Math.min(first, H[i]); }
        if (!sum) { o.name = DUMMY_NAME; o._dpsTxt = null; dummies.delete(o); continue; }
        const dps = sum / Math.max(1.5, now - first + 0.6);
        o._dpsTxt = `${dps.toFixed(1).replace('.', ',')} DPS`;
        o.name = `${DUMMY_NAME} · ${o._dpsTxt}`;
      }
    },
  };
}

// ---------------- localhost showcase ----------------
function installShowcase(game) {
  const net = game.net;
  const H = {};
  game.debugK = H;
  // a free grass rectangle w×h near (x, y)
  const freeRect = (x, y, w, h) => {
    const W = game.world;
    for (let r = 0; r < 40; r++) for (let k = 0; k < Math.max(1, r * 8); k++) {
      const a = (k / Math.max(1, r * 8)) * Math.PI * 2;
      const x0 = Math.floor(x + Math.cos(a) * r - w / 2), y0 = Math.floor(y + Math.sin(a) * r - h / 2);
      let ok = true;
      for (let yy = y0 - 1; yy <= y0 + h && ok; yy++) for (let xx = x0 - 1; xx <= x0 + w && ok; xx++) {
        if (!W.inBounds(xx, yy)) { ok = false; break; }
        const i = W.idx(xx, yy);
        if (W.rock[i] || W.water[i] || game.build.grid.main.has(i) || game.build.grid.floor.has(i)) ok = false;
      }
      if (ok) return [x0, y0];
    }
    return null;
  };
  const clear = (x0, y0, w, h) => {
    const ids = [];
    game.world.forChunks(x0 - 1, y0 - 1, x0 + w + 1, y0 + h + 1, (c) => {
      for (const o of c.objects) if (!o.building && !o.gone && !o.camp && o.x >= x0 && o.x < x0 + w && o.y >= y0 && o.y < y0 + h + 0.2) ids.push(o.id);
    });
    if (ids.length) net.emit('obj.remove', { ids, fx: 'clear' });
  };
  // place rows [type, tx, ty, rot, style, det] finished (authority only, through the normal op)
  const put = (rows, done = 1, lv = 0) => {
    const list = rows.filter((r) => BUILDINGS[r[0]]).map(([type, tx, ty, rot = 0, style = '', det = '']) => [net.newId('s'), type, tx, ty, Math.floor(net.roll() * 1000), done, Math.round(game.worldTime), rot, 1, 0, style, det]);
    if (list.length) net.emit('struct.add', lv ? { list, lv } : { list });
    return list.length;
  };
  const rect = (type, x0, y0, x1, y1, style, det, skip = []) => {
    const out = [];
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) out.push([type, x, y, 0, style, det]);
    for (let y = y0 + 1; y < y1; y++) for (const x of [x0, x1]) out.push([type, x, y, 0, style, det]);
    return out.filter((r) => !skip.some(([sx, sy]) => sx === r[1] && sy === r[2]));
  };
  const area = (type, x0, y0, x1, y1, style, det) => { const out = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([type, x, y, 0, style, det]); return out; };
  H.showcase = (opts = {}) => {
    if (!net.auth) return 'só no anfitrião / um jogador';
    const p = game.player;
    const W = 26, Hh = 17;
    const at = freeRect(p.x, p.y - 4, W, Hh);
    if (!at) return 'sem espaço livre';
    const [x0, y0] = at;
    clear(x0 - 1, y0 - 1, W + 2, Hh + 2);
    const rows = [];
    // ---- cosy timber-frame cottage (7×6) ----
    const hx = x0 + 1, hy = y0 + 1, hx1 = hx + 7, hy1 = hy + 6;
    const walls = rect('wall_wood', hx, hy, hx1, hy1, 'timber', 'post', [[hx + 3, hy1], [hx + 1, hy1], [hx + 5, hy1]]);
    rows.push(...walls);
    rows.push(['wall_wood', hx + 1, hy1, 0, 'timber', 'post.window_shutters.winbox'], ['wall_wood', hx + 5, hy1, 0, 'timber', 'post.window_shutters.winbox']);
    rows.push(['door_wood', hx + 3, hy1, 0, 'panel', 'awning.lantern.wreath.step']);
    rows.push(...area('floor_wood', hx + 1, hy + 1, hx1 - 1, hy1 - 1, 'herring', ''));
    rows.push(...area('floor_wood', hx + 2, hy + 3, hx + 4, hy + 4, 'herring', 'c_red.carpet'));
    rows.push(['fireplace', hx + 2, hy + 1, 0], ['bookshelf', hx + 4, hy + 1, 0], ['bed', hx + 6, hy + 2, 0], ['wardrobe', hx + 6, hy + 4, 3],
      ['table_round', hx + 1, hy + 4, 0], ['chair_fine', hx + 1, hy + 5, 3], ['candles', hx + 5, hy + 5, 0], ['plant_pot', hx + 1, hy + 2, 4], ['painting', hx + 1, hy + 1, 1],
      ['trophy', hx + 5, hy + 1, 1], ['herbs_hang', hx + 6, hy + 1, 1], ['barrel', hx + 5, hy + 4, 0]);
    // ---- garden: picket fence, gate with arch, lanterns, flower beds ----
    const gx0 = hx - 1 + 0, gy0 = hy1 + 1, gx1 = hx1 + 1, gy1 = gy0 + 5;
    const fence = rect('fence_wood', gx0, hy1, gx1, gy1, 'picket', 'cap_ball.flowers', [[hx + 3, gy1]]).filter((r) => !(r[2] >= hy && r[2] <= hy1 && r[1] >= hx && r[1] <= hx1));
    rows.push(...fence.map((r) => (r[1] === gx0 && r[2] === gy1) || (r[1] === gx1 && r[2] === gy1) || (r[1] === gx0 && r[2] === hy1) || (r[1] === gx1 && r[2] === hy1) ? [r[0], r[1], r[2], 0, 'picket', 'cap_ball.lantern'] : r));
    rows.push(['gate_wood', hx + 3, gy1, 0, 'picket', 'arch.lantern']);
    rows.push(['flower_bed', hx, gy0 + 1, 0], ['flower_bed', hx, gy0 + 2, 0], ['flower_bed', hx1, gy0 + 1, 0], ['flower_bed', hx1, gy0 + 2, 0],
      ['bench_wood', hx + 4, gy0 + 3, 0], ['well', hx1 - 1, gy0 + 3, 0], ['birdhouse', hx + 1, gy0 + 4, 0], ['beehive', hx + 2, gy0 + 4, 3], ['scarecrow', hx + 6, gy0 + 1, 0],
      ['stepping', hx + 3, gy0, 0], ['stepping', hx + 3, gy0 + 1, 0], ['stepping', hx + 3, gy0 + 2, 0], ['stepping', hx + 3, gy0 + 3, 0], ['stepping', hx + 3, gy0 + 4, 0],
      ['lamp_wood', hx + 2, gy0 + 1, 0], ['planter', hx + 5, gy0 + 4, 0], ['signpost', hx + 4, gy1 + 1, 0]);
    // ---- stone keep (7×7) with quoins, buttresses, crenellations, arrow slits ----
    const kx = hx1 + 4, ky = y0 + 1, kx1 = kx + 7, ky1 = ky + 7;
    const kw = rect('wall_stone', kx, ky, kx1, ky1, 'rough', 'quoin.crenel.plinth', [[kx + 3, ky1], [kx + 1, ky1], [kx + 5, ky1]]);
    rows.push(...kw);
    rows.push(['wall_stone', kx + 1, ky1, 0, 'rough', 'quoin.crenel.plinth.slit.buttress.ivy'], ['wall_stone', kx + 5, ky1, 0, 'rough', 'quoin.crenel.plinth.slit.buttress']);
    rows.push(['door_wood', kx + 3, ky1, 0, 'arched', 't_dark.lantern']);
    rows.push(...area('floor_stone', kx + 1, ky + 1, kx1 - 1, ky1 - 1, 'checker', 'b_curb'));
    rows.push(['weapon_rack', kx + 1, ky + 1, 0], ['armor_stand', kx + 4, ky + 1, 1], ['banner', kx + 5, ky + 1, 1], ['candelabra', kx + 6, ky + 2, 0], ['crates', kx + 1, ky + 5, 0],
      ['sacks', kx + 6, ky + 5, 0], ['rug_fur', kx + 2, ky + 3, 0]);
    rows.push(['training_dummy', kx + 2, ky1 + 2, 0], ['training_dummy', kx + 5, ky1 + 2, 0], ['brazier', kx + 1, ky1 + 1, 0], ['brazier', kx + 6, ky1 + 1, 0],
      ['lamp_stone', kx - 1, ky1 + 2, 0], ['statue', kx + 3, ky1 + 4, 0], ['woodpile', kx + 4, ky1 + 4, 0], ['haystack', kx1 + 1, ky1 + 3, 0], ['cart', kx + 5, ky1 + 4, 0],
      ['fountain', hx1 + 1, gy0 + 1, 0], ['garden_arch', hx + 3, gy1 + 1, 0], ['pergola', kx1 + 2, ky + 2, 0], ['bench_stone', kx1 + 2, ky + 4, 0], ['plant_pot', kx1 + 4, ky + 2, 0]);
    // roof over the cottage (agent J's roofs with K's details): slate, plaster gable, tile ridge, dark boards
    if (opts.roof !== false && BUILDINGS.roof_stone) {
      for (let y = hy; y <= hy1; y++) for (let x = hx; x <= hx1; x++) {
        rows.push(['roof_stone', x, y, 0, 'slate', 'barge.end_gable.gab_plaster.r_tile']);
      }
    }
    const n = put(rows);
    p.x = hx + 3.5; p.y = gy1 + 2.5;
    if (opts.cam !== false) { game.cam.x = (x0 + W / 2); game.cam.y = y0 + Hh / 2; }
    return { n, at: [x0, y0], house: [hx, hy], keep: [kx, ky] };
  };
  // every style side by side (art review): rows of walls, soft corners + corner pieces, doors, fences, floors
  H.gallery = () => {
    if (!net.auth) return 'só no anfitrião';
    const p = game.player;
    const at = freeRect(p.x, p.y, 34, 26);
    if (!at) return 'sem espaço';
    const [x0, y0] = at;
    clear(x0 - 1, y0 - 1, 36, 28);
    const rows = [];
    const L = (type, x, y, st, dt) => rows.push([type, x, y, 0, st, dt], [type, x + 1, y, 0, st, dt], [type, x + 2, y, 0, st, dt], [type, x, y + 1, 0, st, dt]);
    const W = [['wall_wood', 'plank'], ['wall_wood', 'log'], ['wall_wood', 'timber'], ['wall_wood', 'wattle'], ['wall_stone', 'cut'], ['wall_stone', 'rough'], ['wall_stone', 'cobble'], ['wall_stone', 'tbrick']];
    W.forEach(([t, st], i) => L(t, x0 + 1 + i * 4, y0 + 1, st, ''));
    const D = ['soft.post.window', 'soft.post.window_shutters.winbox', 'soft.post.window_curtains.ivy', 'soft.endcap.window_round.moss', 'quoin.crenel.slit.plinth', 'soft.quoin.buttress.cracks', 'pillar.cap.sconce', 'soft.post.beams.painting'];
    W.forEach(([t, st], i) => L(t, x0 + 1 + i * 4, y0 + 5, st, D[i]));
    ['plank', 'panel', 'iron', 'arched', 'rustic'].forEach((st, i) => {
      const x = x0 + 1 + i * 6, y = y0 + 9;
      rows.push(['wall_wood', x, y, 0, 'timber', 'post'], ['door_wood', x + 1, y, 0, st, i === 0 ? 'awning.lantern' : i === 1 ? 'wreath.step' : i === 2 ? 'knocker' : ''], ['wall_wood', x + 2, y, 0, 'timber', 'window_shutters']);
    });
    [['fence_wood', 'rail', 'cap_flat'], ['fence_wood', 'picket', 'cap_ball.flowers'], ['fence_wood', 'board', 'cap_point.lantern'], ['fence_wood', 'wattle', 'vines'], ['fence_stone', '', 'moss'], ['hedge', '', 'bird']]
      .forEach(([t, st, dt], i) => { const x = x0 + 1 + i * 5, y = y0 + 12; for (let k = 0; k < 4; k++) rows.push([t, x + k, y, 0, st, dt]); rows.push([t, x, y + 1, 0, st, dt]); });
    ['rail', 'picket', 'board'].forEach((st, i) => { const x = x0 + 1 + i * 5, y = y0 + 15; rows.push(['fence_wood', x, y, 0, st, ''], ['gate_wood', x + 1, y, 0, st, i === 1 ? 'arch.lantern' : 'cap_ball.sign'], ['fence_wood', x + 2, y, 0, st, '']); });
    [['floor_wood', 'plank', ''], ['floor_wood', 'herring', 'b_board'], ['floor_wood', 'parquet', 'carpet.c_blue'], ['floor_wood', 'wide', 'straw'], ['floor_stone', 'flag', 'mossy'], ['floor_stone', 'cobble', 'leaves'], ['floor_stone', 'tiles', 'inlay.b_inlay'], ['floor_stone', 'checker', 'b_curb']]
      .forEach(([t, st, dt], i) => { const x = x0 + 1 + i * 4, y = y0 + 18; for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 3; xx++) rows.push([t, x + xx, y + yy, 0, st, dt]); });
    const n = put(rows);
    p.x = x0 + 16; p.y = y0 + 23;
    return { n, at };
  };
  // corner details per wall style (art review): mat 'wood' | 'stone'; a 3×3 ring (4 convex corners) per detail,
  // plus free ends (line + lone piece) for the end caps; opts.lv = stories stacked on top (same rings), opts.dets = columns
  H.corners = (mat = 'wood', opts = {}) => {
    if (!net.auth) return 'só no anfitrião';
    const styles = mat === 'stone' ? [['wall_stone', 'cut'], ['wall_stone', 'rough'], ['wall_stone', 'cobble'], ['wall_stone', 'tbrick']]
      : [['wall_wood', 'plank'], ['wall_wood', 'log'], ['wall_wood', 'timber'], ['wall_wood', 'wattle']];
    const dets = opts.dets || ['', 'soft', 'post', 'quoin', 'pillar', 'buttress', 'endcap'];
    const W = dets.length * 5 + 1, Hh = styles.length * 5 + 1;
    const p = game.player;
    const at = freeRect(p.x, p.y, W, Hh);
    if (!at) return 'sem espaço';
    const [x0, y0] = at;
    clear(x0 - 1, y0 - 1, W + 2, Hh + 2);
    const rows = [];
    styles.forEach(([type, st], j) => dets.forEach((d, i) => {
      const x = x0 + 1 + i * 5, y = y0 + 1 + j * 5;
      if (d === 'endcap') { for (let k = 0; k < 3; k++) rows.push([type, x + k, y, 0, st, d]); rows.push([type, x + 3, y + 1, 0, st, d], [type, x + 3, y + 2, 0, st, d], [type, x + 1, y + 2, 0, st, d]); }
      else rows.push(...rect(type, x, y, x + 2, y + 2, st, d === 'buttress' ? 'buttress' : d));
    }));
    let n = put(rows);
    if (opts.lv) for (let k = 1; k <= opts.lv; k++) n += put(rows, 1, k); // the same rings stacked story by story
    p.x = x0 + W / 2; p.y = y0 + Hh + 0.5;
    return { n, at: [x0, y0], W, H: Hh };
  };
  // n decorated pieces in rows (performance test)
  H.fill = (n = 400) => {
    if (!net.auth) return 'só no anfitrião';
    const p = game.player, side = Math.ceil(Math.sqrt(n));
    const at = freeRect(p.x, p.y, side + 2, side + 2);
    if (!at) return 'sem espaço';
    const [x0, y0] = at;
    clear(x0, y0, side + 2, side + 2);
    const rows = [], kinds = [['wall_wood', 'timber', 'post.window_shutters.ivy'], ['wall_stone', 'rough', 'quoin.moss.cracks'], ['floor_wood', 'parquet', 'carpet.c_blue'], ['fence_wood', 'picket', 'cap_ball.lantern.flowers'],
      ['flower_bed', '', ''], ['plant_pot', '', ''], ['candles', '', ''], ['barrel', '', ''], ['lamp_wood', '', '']];
    for (let i = 0; i < n; i++) { const [t, st, dt] = kinds[(i / side | 0) % kinds.length]; rows.push([t, x0 + 1 + (i % side), y0 + 1 + ((i / side) | 0), 0, st, dt]); }
    return put(rows);
  };
}
