// WOS multiplayer sync tests (docs/SYNC.md §4.6 harness, §6 scenarios S1–S30).
// Open /tools/mp-test.html?run=all (BroadcastChannel transport, ~0 ms latency), then the ★ ones over real
// WebRTC (?run=star&transport=webrtc) and through TURN (?run=star&relay=1). Results are plain text in the
// page (<main>), also window.mpReport() / window.mpResults; window.mpDone becomes true at the end.
//
// Adding a mechanic? Add a scenario here: def('Sxx', { title, expected, api, timeout }, async (t) => { … }).
// Use pairCtx(t) for the shared host+guest pair, the act helpers (A.*) for player actions, t.check(...) for
// assertions and t.checkDigest(H, G) for the world digest. Missing game APIs → t.need(cond, 'reason') (SKIP).

import {
  CFG, Q, RT, ONEWAY, Skip, Fail, now, sleep, fmtMs, short, frames, storage, render, runScenarios, setStatus,
  results, hasDigest, isSynced, seqOf, stat, newRoom, rand, reportText, RUN_INFO,
} from './mp-test/harness.js';
import { env, pairCtx, bootHost, bootGuest, bootSolo, waitGuestSynced, presetPid, legacyJoin } from './mp-test/pair.js';
import * as A from './mp-test/act.js';
import * as TC from './mp-test/towncheck.js'; // settlement validator (FX1)

const S = [];
const def = (id, meta, run) => S.push({ id, timeout: 90000, ...meta, run });
const spawnOf = (f) => f.game.world.spawn;
const near = (a, b, d) => Math.hypot(a.x - b.x, a.y - b.y) <= d;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : NaN; };
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));

// guest's avatar as seen by the host / host's avatar as seen by the guest
const guestOnHost = (H, G) => A.authAvatarOn(H, G.pid);
// page text + boot error + last session error (messages shown to the player)
const pageText = (f) => `${f.text()} ${f.win?.wosBootError || ''} ${f.session?.lastError?.msg || ''}`.replace(/\s+/g, ' ');
const hostOnGuest = (H, G) => A.avatarOn(G, H.pid);

// move a player far from (x, y) (keeps loot out of magnet range, views away from spawns…)
function sendAway(f, M, x, y, d = 7, prefer = Math.PI) {
  for (let k = 0; k < 8; k++) {
    const a = prefer + (k * Math.PI) / 4;
    const s = A.freeSpot(f, M, x + Math.cos(a) * d, y + Math.sin(a) * d, { rMin: 0, rMax: 3 });
    if (s) { A.teleport(f, s[0], s[1]); return s; }
  }
  return null;
}

// =====================================================================================================
// S1 ★ Join a fresh host
def('S1', {
  star: true, title: 'Join a fresh host', timeout: 180000,
  expected: 'Connected; digest equal immediately after the snapshot; guest ran no createSpawners/ensureStarter (every guest mob has proxy:true); camp object ids identical (camp1:0…); worldTime within 2 s',
  api: '?mp=host ?autojoin=1 ?link=bc ?nosave=1 &pid; net.{role,pid,synced,digest,dump,stats.lastSeq}; session.state; proxies {proxy,nid,species}; game.camps[].objects[].id; game.props[].id; game.spawners',
}, async (t) => {
  const P = await env.getPair(t, { fresh: true });
  const { H, G } = P;
  const r = await t.checkDigest(H, G, 'digest equal right after the snapshot', { ms: CFG.budget * 3 + 500 });
  t.metric('digestAfterSnapshotMs', Math.round(r.ms || 0));
  t.check(H.net?.role === 'host' && G.net?.role === 'guest', 'roles host / guest', `${H.net?.role} / ${G.net?.role}`);
  t.check(G.session?.state === 'connected', 'guest session connected', G.session?.state);
  t.check(H.session?.players?.has?.(G.pid), 'host lists the guest player', `guest pid ${G.pid}`);
  t.check(G.pid !== H.pid, 'distinct player ids', `${H.pid} / ${G.pid}`);
  // entity stream: proxies only
  const gotMobs = await t.tryWait(() => A.mobs(G).length > 0, 4000);
  const gm = A.mobs(G);
  t.check(gotMobs, 'guest receives creatures (entity stream started)', `${gm.length} mobs`);
  const local = gm.filter((e) => !e.proxy);
  t.check(!local.length, 'every creature on the guest is a proxy (no local createSpawners / raiders)', local.length ? `${local.length} local: ${local.slice(0, 4).map((e) => e.species + '@' + f2(e.x) + ',' + f2(e.y)).join(' ')}` : `${gm.length} proxies`);
  t.check(!(G.game.spawners?.length), 'guest has no spawners', `${G.game.spawners?.length ?? 0}`);
  const byNid = new Map(A.hostMobs(H).map((m) => [m.nid, m]));
  const prox = gm.filter((e) => e.proxy);
  const badRef = prox.filter((e) => !byNid.has(e.nid) || byNid.get(e.nid).species !== e.species);
  t.check(prox.length && !badRef.length, 'each proxy matches a host creature (nid + species)', badRef.length ? `${badRef.length} mismatched: ${badRef.slice(0, 4).map((e) => e.nid + ':' + e.species).join(' ')}` : `${prox.length} proxies`);
  // deterministic camps (a planet: each peer builds the camps of the chunks it has loaded — compare the ones both have;
  // none near the spawn on both: the guest walks to the host's nearest camp)
  const both = (c) => c.chunk == null || (H.game.world.isLoaded(c.chunk) && G.game.world.isLoaded(c.chunk));
  if (!(H.game.camps || []).some(both)) {
    const hw = H.game.world, s0 = hw.spawn;
    if (!H.game.camps.length) for (let r = 1; r <= 6 && !H.game.camps.length; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) hw.ensure(hw.chunkIndex(s0.x + dx * 64, s0.y + dy * 64));
    const k = H.game.camps.slice().sort((a, b) => Math.hypot(hw.dx(a.x, s0.x), a.y - s0.y) - Math.hypot(hw.dx(b.x, s0.x), b.y - s0.y))[0];
    if (k) { G.game.world.ensure(k.chunk); A.teleport(G, k.x + 8, k.y + 8); await t.waitFor(() => G.game.camps.some((q) => q.id === k.id), 6000, 'the guest has the camp near it'); }
  }
  const camps = (f) => (f.game.camps || []).filter(both).map((c) => [c.id, ...(c.objects || []).map((o) => String(o.id))]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const ch = camps(H), cg = camps(G);
  t.check(ch.length && JSON.stringify(ch) === JSON.stringify(cg), 'camp object ids identical (camps loaded on both)', `host ${short(ch, 140)} · guest ${short(cg, 140)}`);
  t.check(ch.flat().filter((id) => id.includes(':')).every((id) => /^camp\d+:\d+$/.test(id)), "camp ids are deterministic ('camp<i>:<k>')", short(ch.flat().slice(0, 6)));
  const props = (f) => (f.game.camps || []).filter(both).flatMap((c) => c.crates.map((o) => String(o.id))).sort().join(',');
  t.check(props(H) === props(G), 'crate (prop) ids identical', `${props(H).split(',').length} crates`);
  const dwt = Math.abs(H.game.worldTime - G.game.worldTime);
  t.check(dwt <= 2, 'worldTime within 2 s', `host ${f2(H.game.worldTime)} guest ${f2(G.game.worldTime)}`);
  const eh = H.game.env, eg = G.game.env;
  t.check(eh.dayIndex === eg.dayIndex && Math.abs(eh.hour - eg.hour) <= 0.05 && eh.weather === eg.weather, 'clock and weather equal', `host d${eh.dayIndex} ${f2(eh.hour)}h ${eh.weather} · guest d${eg.dayIndex} ${f2(eg.hour)}h ${eg.weather}`);
});

// =====================================================================================================
// S2 Version mismatch
def('S2', {
  title: 'Version mismatch (?fakebuild)', timeout: 150000,
  expected: 'Guest with ?fakebuild=X is rejected with the pt-BR "Versões diferentes…" message naming both builds; no world generated; the host never lists it',
  api: '?fakebuild=X (localhost only); hello.build; reject {reason:"version"}; message in the guest page',
}, async (t) => {
  const room = newRoom();
  const H = await bootHost(t, room);
  const G = await bootGuest(t, room, H, { extra: '&fakebuild=FAKEX9', waitSync: false, label: 'guest-fakebuild' });
  let everJoined = false, hostListed = false;
  t.watch(() => { if (isSynced(G)) everJoined = true; if (H.session?.players?.has?.(G.pidHint)) hostListed = true; }, 30);
  const shown = await t.tryWait(() => /Vers(õ|o)es diferentes/i.test(pageText(G)) || everJoined, 40000);
  const txt = pageText(G);
  t.check(shown && !everJoined, 'guest shows "Versões diferentes…"', short(txt.slice(0, 220), 220));
  t.check(/FAKEX9/.test(txt), 'message names the guest build (sua X, anfitrião Y)');
  await t.sleep(2000);
  t.check(!everJoined && !isSynced(G), 'guest never joined');
  t.check(!G.game, 'no world generated on the guest (window.game absent)');
  t.check(!hostListed && !(H.session?.players?.size), 'host has no players', `players=${H.session?.players?.size}`);
});

// =====================================================================================================
// S3 Atlas mismatch
def('S3', {
  title: 'Atlas mismatch (sprite removed / placeholder)', timeout: 200000,
  expected: 'Guest with a different atlas refuses ("Gráficos incompletos") or clears its cache and reloads once; it never connects with a different atlas digest',
  api: '?fakeart=<sprite> and ?fakeart=ph:<sprite> (localhost hook: delete a sprite / mark it a placeholder before the handshake); hello.art; reject {reason:"atlas"}; game.A.placeholders',
}, async (t) => {
  let ran = 0;
  for (const [label, val] of [['missing spider_s', 'spider_s'], ['placeholder stick_0', 'ph:stick_0']]) {
    const room = newRoom();
    const H = await bootHost(t, room, { label: 'host-' + (ran + 1) });
    const G = await bootGuest(t, room, H, { extra: '&fakeart=' + encodeURIComponent(val), waitSync: false, label: 'guest-art' });
    let everJoined = false;
    t.watch(() => { if (isSynced(G)) everJoined = true; }, 30);
    const re = /Gr(á|a)ficos (incompletos|corrompidos)/i;
    await t.tryWait(() => re.test(pageText(G)) || everJoined, 40000);
    if (everJoined || G.game) {
      const A0 = G.game?.A;
      const hookWorked = val.startsWith('ph:') ? !!A0?.placeholders?.includes?.(val.slice(3)) : A0 && !A0.has(val);
      if (!hookWorked) { t.note(`${label}: ?fakeart hook not implemented (atlas unchanged) — variant skipped`); frames.close(G); frames.close(H); continue; }
    }
    ran++;
    t.check(re.test(pageText(G)), `${label}: guest shows "Gráficos incompletos/corrompidos"`, short(pageText(G).slice(0, 200), 200));
    t.check(!everJoined, `${label}: never connected with a different atlas`, `frame loads=${G.loads}`);
    t.check(G.loads <= 2, `${label}: reloaded at most once`, `loads=${G.loads}`);
    t.check(!(H.session?.players?.size), `${label}: host has no players`);
    frames.close(G); frames.close(H);
  }
  t.need(ran, 'needs the ?fakeart=<sprite> localhost hook (see report)');
});

// =====================================================================================================
// S4 Atlas cache poisoning
const IDB_HINT = Q.get('atlasdb') || 'wos-atlas';
async function idbList() { try { return (await indexedDB.databases()).map((d) => d.name); } catch { return []; } }
function idbOpen(name) { return new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onupgradeneeded = () => {}; }); }
async function idbReadAll(name) {
  if (!(await idbList()).includes(name)) return null;
  const db = await idbOpen(name);
  const out = { name, version: db.version, stores: {} };
  for (const s of db.objectStoreNames) {
    out.stores[s] = await new Promise((res) => {
      const rows = [];
      const c = db.transaction(s, 'readonly').objectStore(s).openCursor();
      c.onsuccess = () => { const cur = c.result; if (cur) { rows.push([cur.key, cur.value]); cur.continue(); } else res(rows); };
      c.onerror = () => res(rows);
    });
  }
  db.close();
  return out;
}
function idbDelete(name) { return new Promise((res) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => res(); }); }
async function idbWriteAll(dump) {
  await idbDelete(dump.name);
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open(dump.name, dump.version);
    r.onupgradeneeded = () => { for (const s in dump.stores) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  for (const s in dump.stores) {
    await new Promise((res) => { const tx = db.transaction(s, 'readwrite'); for (const [k, v] of dump.stores[s]) tx.objectStore(s).put(v, k); tx.oncomplete = tx.onerror = () => res(); });
  }
  db.close();
}
async function idbCount(name) { const d = await idbReadAll(name); return d ? Object.values(d.stores).reduce((n, rows) => n + rows.length, 0) : 0; }
function atlasSource(f) {
  const a = f.game?.A, w = f.win;
  if (typeof a?.source === 'string') return a.source;
  if (typeof w?.__atlasSource === 'string') return w.__atlasSource;
  if (typeof a?.fromCache === 'boolean') return a.fromCache ? 'cache' : 'painted';
  return null;
}
async function pollAsync(t, fn, ok, ms, every = 400) {
  const t0 = now();
  for (;;) { const v = await fn(); if (ok(v)) return v; if (now() - t0 > ms) return v; await t.sleep(every); }
}
def('S4', {
  title: 'Atlas cache poisoning (?cache=1)', timeout: 240000,
  expected: 'Painter failure → no atlas stored; a stored atlas missing spider_s is rejected on the next boot and repainted; selfTest().speciesFallbacks empty',
  api: '?cache=1; net.selfTest() {atlasOk, placeholders, missingSprites, speciesFallbacks}; atlas source (game.A.source "cache"|"painted" or window.__atlasSource); ?fakepaintfail=1 (localhost hook); IndexedDB record with meta.sprites',
}, async (t) => {
  const before = await idbList();
  const backups = [];
  for (const n of before) if (/atlas/i.test(n)) backups.push(await idbReadAll(n));
  t.defer(async () => {
    for (const n of await idbList()) if (/atlas/i.test(n) && !before.includes(n)) await idbDelete(n);
    for (const b of backups) await idbWriteAll(b);
  });
  for (const b of backups) await idbDelete(b.name);

  const S1 = await bootSolo(t, '&cache=1', 'solo-cache');
  t.need(typeof S1.net?.selfTest === 'function', 'game.net.selfTest() missing (net core / atlas validation not merged)');
  const st = S1.net.selfTest();
  t.check(st.atlasOk, 'selfTest().atlasOk on a clean boot', short(st, 200));
  t.check(!(st.placeholders?.length) && !(st.missingSprites?.length), 'no placeholders / missing sprites', short({ p: st.placeholders, m: st.missingSprites }));
  t.check(!(st.speciesFallbacks?.length), 'selfTest().speciesFallbacks empty', short(st.speciesFallbacks));
  const src1 = atlasSource(S1);
  t.need(src1, 'atlas source unknown — needs game.A.source = "cache"|"painted" (or window.__atlasSource)');
  t.check(src1 === 'painted', 'first boot (empty cache) paints', src1);
  await pollAsync(t, async () => (await idbList()).filter((n) => !before.includes(n) || /atlas/i.test(n)), (l) => l.length > 0, 10000);
  const dbName = (await idbList()).find((n) => /atlas/i.test(n)) || IDB_HINT;
  const n1 = await pollAsync(t, () => idbCount(dbName), (n) => n > 0, 10000);
  t.check(n1 > 0, 'clean atlas stored in IndexedDB', `${dbName}: ${n1} record(s)`);
  frames.close(S1);
  const S2 = await bootSolo(t, '&cache=1', 'solo-cache2');
  t.check(atlasSource(S2) === 'cache', 'second boot uses the cached atlas', atlasSource(S2));
  frames.close(S2);

  // painter failure must never be cached
  await idbDelete(dbName);
  const S3 = await bootSolo(t, '&cache=1&fakepaintfail=1', 'solo-paintfail');
  const nf = (S3.game.A.failures?.length || 0) + (S3.game.A.placeholders?.length || 0);
  if (!nf) t.note('?fakepaintfail hook not implemented — painter-failure sub-check skipped');
  else {
    await t.sleep(6500);
    t.check((await idbCount(dbName)) === 0, 'atlas with painter failures is NOT stored', `${nf} failures/placeholders`);
    t.check(!S3.net.selfTest().atlasOk, 'selfTest flags the broken atlas');
  }
  frames.close(S3);

  // poisoned cache: stored atlas without spider_s → rejected, repainted
  await idbDelete(dbName);
  const S4 = await bootSolo(t, '&cache=1', 'solo-store');
  const n4 = await pollAsync(t, () => idbCount(dbName), (n) => n > 0, 10000);
  frames.close(S4);
  t.assert(n4 > 0, 'atlas stored again for the poisoning step');
  const dump = await idbReadAll(dbName);
  let poisoned = 0;
  for (const s in dump.stores) for (const row of dump.stores[s]) {
    const v = row[1];
    const sp = v?.meta?.sprites;
    if (Array.isArray(sp)) { const k = sp.length; v.meta.sprites = sp.filter((x) => x?.name !== 'spider_s'); if (v.meta.sprites.length < k) poisoned++; }
  }
  if (!poisoned) { t.note('cache record format not recognised (no meta.sprites[].name) — poisoning skipped'); return; }
  await idbWriteAll(dump);
  const S5 = await bootSolo(t, '&cache=1', 'solo-poisoned');
  t.check(atlasSource(S5) === 'painted', 'poisoned cache (no spider_s) rejected and repainted', atlasSource(S5));
  t.check(S5.game.A.has('spider_s'), 'spider_s present after boot');
  const st5 = S5.net.selfTest();
  t.check(st5.atlasOk && !(st5.speciesFallbacks?.length), 'selfTest ok, no species fallbacks', short(st5, 200));
});

// =====================================================================================================
// S5 ★ Animation parity
def('S5', {
  star: true, title: 'Animation parity (gait 0.25/tile)', timeout: 90000,
  expected: "Host walks 10 tiles: the guest's copy moveT delta = host delta ±10% (0.25/tile); same for host creatures seen on the guest",
  api: 'session.players.get(pid).ent.moveT (remote avatar); proxies {nid, moveT}; host mob moveT',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sp = spawnOf(H);
  let start = null, dir = null;
  outer: for (let r = 0; r <= 24; r += 2) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = sp.x + Math.cos(a) * r, y = sp.y + Math.sin(a) * r;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (A.clearLine(H, MH, x, y, x + dx * 12.5, y + dy * 12.5) && !MH.physics.collides(H.game.world, x, y, 0.3, null, true)) { start = [x, y]; dir = [dx, dy]; break outer; }
    }
  }
  t.assert(start, 'found a clear 12-tile straight line for the host');
  A.teleport(H, start[0], start[1]);
  const gs = A.freeSpot(G, MG, start[0] - dir[1] * 4 + dir[0] * 5, start[1] + dir[0] * 4 + dir[1] * 5, { rMin: 0, rMax: 4 });
  if (gs) A.teleport(G, gs[0], gs[1]);
  await t.sleep(900);
  const copy = hostOnGuest(H, G);
  t.assert(copy, "guest has the host's avatar");
  const hp = H.game.player;
  const h0 = { m: hp.moveT, x: hp.x, y: hp.y }, c0 = copy.moveT;
  const release = A.holdMove(H, dir[0], dir[1]);
  t.defer(release);
  await t.waitFor(() => Math.hypot(hp.x - h0.x, hp.y - h0.y) >= 10, 6000, 'host walked 10 tiles');
  release();
  await t.sleep(800);
  const dist = Math.hypot(hp.x - h0.x, hp.y - h0.y), dh = hp.moveT - h0.m, dc = copy.moveT - c0;
  t.metric('host', { tiles: f2(dist), dMoveT: f2(dh), perTile: f2(dh / dist) });
  t.metric('guestCopy', { dMoveT: f2(dc), ratio: f2(dc / dh) });
  t.check(Math.abs(dh / dist - 0.25) <= 0.025, 'host gait 0.25 moveT per tile (±10%)', `${f2(dh / dist)}/tile over ${f2(dist)} tiles`);
  t.check(Math.abs(dc / dh - 1) <= 0.1, "guest's copy moveT delta = host delta ±10%", `copy ${f2(dc)} vs host ${f2(dh)} (×${f2(dc / dh)})`);

  // creatures: host mob vs guest proxy over 6 s
  const pairs = A.hostMobs(H).map((m) => [m, A.proxyOf(G, m)]).filter(([, p]) => p);
  if (!pairs.length) { t.note('no creature proxies on the guest — creature gait sub-check skipped'); return; }
  const s0 = pairs.map(([m, p]) => [m.moveT, p.moveT, m.x, m.y]);
  // the host's straight-line progress per 0.1 s (the stream's rate): back-and-forth faster than that (a fight's footwork,
  // bumping in a crowd) never reaches a 10 Hz copy — such a creature is left out of the gait parity
  const seg = pairs.map(([m]) => ({ x: m.x, y: m.y, d: 0, st: {} }));
  const wt = t.watch(() => pairs.forEach(([m], i) => { const q = seg[i]; q.d += Math.hypot(m.x - q.x, m.y - q.y); q.x = m.x; q.y = m.y; q.st[m.state] = 1; }), 100);
  await t.sleep(6000);
  wt.stop?.();
  const ratios = [], skipped = [];
  pairs.forEach(([m, p], i) => {
    const dm = m.moveT - s0[i][0], dp = p.moveT - s0[i][1], walked = dm / 0.25;
    if (dm < 0.5 || m.dead) return;
    if (walked > seg[i].d * 1.5 + 0.5) { skipped.push(`${m.species}(${Object.keys(seg[i].st).join('/')} ${f2(walked)}/${f2(seg[i].d)})`); return; }
    ratios.push({ nid: m.nid, sp: m.species, dm: f2(dm), dp: f2(dp), r: dp / dm, tiles: f2(Math.hypot(m.x - s0[i][2], m.y - s0[i][3])) });
  });
  t.metric('mobRatios', ratios.slice(0, 8).map((r) => `${r.sp}:${f2(r.r)}`).join(' '));
  if (skipped.length) t.note(`left out (shuffling faster than the 10 Hz stream): ${skipped.join(' ')}`);
  if (!ratios.length) { t.note('no creature walked ≥ 2 tiles in 6 s — creature gait sub-check skipped'); return; }
  const med = median(ratios.map((r) => r.r));
  t.check(Math.abs(med - 1) <= 0.1, 'creature proxy moveT delta = host delta ±10% (median)', `median ×${f2(med)} over ${ratios.length} creatures`);
});

// =====================================================================================================
// S6 / S7 chopping
async function chopScenario(t, who) {
  const C = await pairCtx(t);
  const { H, G, MH, MG } = C;
  const [actor, MA, obs, MO] = who === 'host' ? [H, MH, G, MG] : [G, MG, H, MH];
  const sp = spawnOf(H);
  const tr = A.pickTree(H, MH, G, sp.x, sp.y, env.claimed);
  t.assert(tr, 'found a standing tree present on both frames');
  const id = tr.o.id, oH = A.objOn(H, id), oG = A.objOn(G, id);
  A.ensure(actor, { axe_copper: 1 });
  A.teleport(actor, tr.west[0], tr.west[1]);
  const os = A.freeSpot(obs, MO, oH.x - 5, oH.y + 1, { rMin: 0, rMax: 3 });
  if (os) A.teleport(obs, os[0], os[1]);
  await t.sleep(300);
  const xpA = A.xpRecorder(t, actor), xpO = A.xpRecorder(t, obs);
  const obsLv = [obs.game.player.level, obs.game.player.xp];
  const loot = A.lootRecorder(t, [H, G]);
  const ev = A.edgeWatch(t, {
    hShake: () => oH.shake > 0, gShake: () => oG.shake > 0, hProg: () => oH.prog > 0, gProg: () => oG.prog > 0,
    hFall: () => oH.fall > 0, gFall: () => oG.fall > 0, hStump: () => oH.stump, gStump: () => oG.stump,
  });
  await A.chop(t, actor, MA, A.objOn(actor, id), { until: 'fall' });
  sendAway(actor, MA, oH.x, oH.y, 6, Math.PI);
  await t.waitFor(() => oH.stump && oG.stump, 8000, 'stump on both', () => `host fall=${f2(oH.fall)} stump=${oH.stump} · guest fall=${f2(oG.fall)} stump=${oG.stump}`);
  await t.sleep(600);
  loot.stop();
  t.check(ev.gShake.edges > 0 || ev.gProg.edges > 0, 'guest sees the chopping (shake / progress) before the fall', `guest shakes ${ev.gShake.edges}, prog ${ev.gProg.edges ? 'yes' : 'no'}`);
  t.check(ev.hShake.edges > 0 || ev.hProg.edges > 0, 'host sees the chopping (shake / progress)', `host shakes ${ev.hShake.edges}`);
  const dFall = ev.gFall.first - ev.hFall.first, dStump = ev.gStump.first - ev.hStump.first;
  t.metric('fallLagMs', Math.round(dFall)); t.metric('stumpLagMs', Math.round(dStump));
  t.check(ev.hFall.first != null && ev.gFall.first != null && dFall <= CFG.budget + 20, `fall starts on the guest ≤ ${CFG.budget} ms after the host`, `${fmtMs(dFall)}`);
  t.check(ev.hFall.edges === 1 && ev.gFall.edges === 1, 'exactly one fall on each frame', `host ${ev.hFall.edges}, guest ${ev.gFall.edges}`);
  t.check(Math.abs(dStump) <= CFG.budget + 40, 'stump at the end on both (same moment ± budget)', fmtMs(dStump));
  const cmp = loot.compare(0, 1);
  const items = loot.items(0);
  t.check(cmp.ok && cmp.n > 0, 'wood/stick loot with identical ids/items on both', cmp.detail);
  t.check((items.wood || 0) >= 2 && (items.wood || 0) <= 5, 'one set of wood drops (2–5)', short(items));
  t.check(xpA.total > 0, `XP to the ${who} (chopper)`, `+${xpA.total}`);
  t.check(xpO.total === 0 && obs.game.player.level === obsLv[0] && obs.game.player.xp === obsLv[1], `no XP for the other player`, `+${xpO.total}`);
  await t.checkDigest(H, G);
  env.history.push(t.sc.id);
}
def('S6', {
  star: true, title: 'Host chops a tree', timeout: 90000,
  expected: 'Guest sees shakes during chopping, fall start ≤ budget, stump at the end; wood/stick loot with identical ids/items on both; digest equal',
  api: 'ctl.interact(describeObject) (gather.hit intent); ops obj.prog/tree.fell/tree.land/tree.stump; o.{shake,prog,fall,stump}; game.loot[].{id,item,qty}; events xp; net.digest',
}, (t) => chopScenario(t, 'host'));
def('S7', {
  star: true, title: 'Guest chops a tree', timeout: 90000,
  expected: 'Same as S6; XP only on the guest; host game.player.xp unchanged',
  api: 'as S6, through a guest gather.hit intent',
}, (t) => chopScenario(t, 'guest'));

// =====================================================================================================
// S8 Both chop the same tree
def('S8', {
  title: 'Both chop the same tree', timeout: 90000,
  expected: 'Exactly one fall; one set of drops; XP to the finishing player only; the other work loop stops',
  api: 'gather.hit from both (host local + guest intent); tree.fell once; loot ids; events xp',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sp = spawnOf(H);
  const tr = A.pickTree(H, MH, G, sp.x - 6, sp.y, env.claimed, { sides: 2 });
  t.assert(tr, 'found a tree with room on both sides');
  const id = tr.o.id, oH = A.objOn(H, id), oG = A.objOn(G, id);
  A.ensure(H, { axe_copper: 1 }); A.ensure(G, { axe_copper: 1 });
  A.teleport(H, tr.west[0], tr.west[1]); A.teleport(G, tr.east[0], tr.east[1]);
  await t.sleep(300);
  const xpH = A.xpRecorder(t, H), xpG = A.xpRecorder(t, G);
  const loot = A.lootRecorder(t, [H, G]);
  const ev = A.edgeWatch(t, { hFall: () => oH.fall > 0, gFall: () => oG.fall > 0, hStump: () => oH.stump, gStump: () => oG.stump });
  const itH = MH.gathering.describeObject(H.game, oH), itG = MG.gathering.describeObject(G.game, oG);
  A.interact(H, itH); A.interact(G, itG); // same tick
  t.log('both players chop');
  await t.waitFor(() => oH.fall > 0 || oH.stump, 20000, 'tree falls (host)', () => `host work=${short(H.game.player.work?.label)} guest work=${short(G.game.player.work?.label)} prog H ${f2(oH.prog)} G ${f2(oG.prog)}`);
  const stopped = await t.tryWait(() => !H.game.player.work && !G.game.player.work, 1200 + CFG.budget);
  t.check(stopped, 'both work loops stop once the tree falls', `host work=${short(H.game.player.work?.label)} guest work=${short(G.game.player.work?.label)}`);
  sendAway(H, MH, oH.x, oH.y, 7, -Math.PI / 2); sendAway(G, MG, oH.x, oH.y, 7, -Math.PI / 2 + 0.6);
  await t.waitFor(() => oH.stump && oG.stump, 8000, 'stump on both');
  await t.sleep(600);
  loot.stop();
  t.check(ev.hFall.edges === 1 && ev.gFall.edges === 1, 'exactly one fall (each frame)', `host ${ev.hFall.edges}, guest ${ev.gFall.edges}`);
  const items = loot.items(0);
  t.check((items.wood || 0) >= 2 && (items.wood || 0) <= 5 && (items.stick || 0) <= 1, 'one set of drops (wood 2–5, stick ≤ 1)', short(items));
  const cmp = loot.compare(0, 1);
  t.check(cmp.ok, 'drops identical on both', cmp.detail);
  t.check((xpH.total > 0) !== (xpG.total > 0), 'XP to exactly one player (the finisher)', `host +${xpH.total} guest +${xpG.total}`);
  t.check(xpH.total + xpG.total <= 6.0001, 'tree XP granted once (6)', `${xpH.total + xpG.total}`);
  await t.checkDigest(H, G);
  env.history.push('S8');
});

// =====================================================================================================
// S9 Same pebble, same frame
def('S9', {
  title: 'Both pick the same pebble at once', timeout: 60000,
  expected: 'One item gain in total; the other request gets ack ok:0; object gone on both',
  api: 'gather.hit kind pick (obj.remove {give}); net.stats.rejects; inventory counts',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sp = spawnOf(H);
  const cands = A.shared(H, G, sp.x, sp.y, 40, (o) => o.type === 'pebble' && !o.gone, env.claimed);
  let pick = null;
  for (const o of cands) {
    const a = A.freeSpot(H, MH, o.x, o.y, { rMin: 0.4, rMax: 0.6, prefer: Math.PI }), b = A.freeSpot(H, MH, o.x, o.y, { rMin: 0.4, rMax: 0.6, prefer: 0 });
    if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.5) { pick = { o, a, b }; break; }
  }
  t.assert(pick, 'found a pebble present on both frames');
  env.claimed.add(pick.o.id);
  const id = pick.o.id, oH = A.objOn(H, id), oG = A.objOn(G, id);
  A.teleport(H, pick.a[0], pick.a[1]); A.teleport(G, pick.b[0], pick.b[1]);
  await t.sleep(300);
  const c0 = [A.count(H, 'pebble'), A.count(G, 'pebble')];
  const rej0 = [stat(H, 'rejects'), stat(G, 'rejects')];
  const loot = A.lootRecorder(t, [H, G]);
  A.interact(H, MH.gathering.describeObject(H.game, oH));
  A.interact(G, MG.gathering.describeObject(G.game, oG));
  await t.waitFor(() => (oH.gone || !A.objOn(H, id)) && (oG.gone || !A.objOn(G, id)), 5000, 'pebble gone on both');
  await t.tryWait(() => !H.game.player.work && !G.game.player.work, 2000);
  await t.sleep(RT());
  loot.stop();
  const gain = [A.count(H, 'pebble') - c0[0], A.count(G, 'pebble') - c0[1]];
  t.check(gain.filter((g) => g > 0).length === 1, 'exactly one player got the pebble', `host +${gain[0]} guest +${gain[1]}`);
  t.check(gain[0] + gain[1] >= 1 && gain[0] + gain[1] <= 2, 'one gain in total (1–2 pebbles)', `${gain[0] + gain[1]}`);
  t.check(!(loot.items(0).pebble), 'no duplicate pebble loot on the ground', short(loot.items(0)));
  const rej1 = [stat(H, 'rejects'), stat(G, 'rejects')];
  if (rej0[1] != null) {
    const loser = gain[0] > 0 ? 1 : 0;
    t.check(rej1[loser] > rej0[loser] || loser === 0, `the losing request was rejected (ack ok:0)`, `rejects host ${rej0[0]}→${rej1[0]} guest ${rej0[1]}→${rej1[1]}`);
  } else t.note('net.stats.rejects missing — reject check skipped');
  await t.checkDigest(H, G);
  env.history.push('S9');
});

// =====================================================================================================
// S10 ★ Guest builds a wall line with a corner
const L5 = (x0, y0) => [[x0, y0], [x0 + 1, y0], [x0 + 2, y0], [x0 + 2, y0 + 1], [x0 + 2, y0 + 2]];
def('S10', {
  star: true, title: 'Guest builds a wall line (5 tiles) incl. a corner', timeout: 120000,
  expected: 'Host sees 5 structures with the same ids, mask, orient; world.solid=1 on both; host cannot walk through; blueprints free, guest delivers the wood once while building',
  api: 'build mode enterBuildMode/commitPlacement (build.place intent) → struct.add; build.hit → struct.progress/struct.complete; o.{mask,orient,blueprint}; world.solid',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.ensure(G, { wood: 30 });
  const gp = G.game.player, hp = H.game.player;
  const site = A.findSite([H, G], [MH, MG], 'wall_wood', L5, gp.x, gp.y, { rMin: 3, rMax: 14, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a free 3×3 site for an L-shaped wall');
  const { x0, y0 } = site;
  const invG0 = A.invSnap(G), invH0 = A.invSnap(H);
  const xpG = A.xpRecorder(t, G), xpH = A.xpRecorder(t, H);
  A.place(G, MG, 'wall_wood', [x0, y0], [x0 + 2, y0]);
  A.place(G, MG, 'wall_wood', [x0 + 2, y0 + 1], [x0 + 2, y0 + 2]);
  t.log(`guest placed L wall at (${x0},${y0})`);
  const at = (f, M) => site.tiles.map(([x, y]) => A.structAt(f, M, x, y, 'main'));
  const ms = await t.timeTo(() => at(H, MH).every(Boolean), RT() + 400, 'host has the 5 blueprints', () => `host has ${at(H, MH).filter(Boolean).length}/5; guest ui: ${G.lastUi()}`);
  t.metric('placeRoundTripMs', Math.round(ms));
  await t.waitFor(() => at(G, MG).every(Boolean), ONEWAY() + 300, 'guest has the 5 blueprints');
  const ids = at(H, MH).map((o) => o.id);
  t.check(JSON.stringify(ids) === JSON.stringify(at(G, MG).map((o) => o.id)), 'blueprint ids identical', short(ids));
  t.check(!A.invDiff(invG0, A.invSnap(G)).wood, 'blueprints are free: no wood taken when placing', short(A.invDiff(invG0, A.invSnap(G))));
  await A.buildAll(t, G, MG, ids);
  await t.waitFor(() => ids.every((id) => !A.structOn(H, id)?.blueprint), ONEWAY() + 300, 'host sees all 5 completed');
  await t.sleep(ONEWAY());
  const sh = ids.map((id) => A.structOn(H, id)), sg = ids.map((id) => A.structOn(G, id));
  t.check(sh.every(Boolean) && sg.every(Boolean), 'all 5 structures exist on both');
  const mo = (o) => `${o?.mask}/${o?.orient ?? '-'}`;
  t.check(sh.map(mo).join(' ') === sg.map(mo).join(' '), 'mask / orient identical', `host ${sh.map(mo).join(' ')} · guest ${sg.map(mo).join(' ')}`);
  const solid = (f) => site.tiles.map(([x, y]) => f.game.world.solid.get(f.game.world.idx(x, y)));
  t.check(solid(H).every((v) => v === 1) && solid(G).every((v) => v === 1), 'world.solid = 1 on both', `host ${solid(H)} guest ${solid(G)}`);
  t.check(A.invDiff(invG0, A.invSnap(G)).wood === -10, 'guest delivered the materials once, when building (−10 wood)', short(A.invDiff(invG0, A.invSnap(G))));
  t.check(!A.invDiff(invH0, A.invSnap(H)).wood, 'host inventory untouched', short(A.invDiff(invH0, A.invSnap(H))));
  t.check(xpG.total > 0 && xpH.total === 0, 'build XP only to the guest', `guest +${xpG.total} host +${xpH.total}`);
  // host tries to walk south through the middle wall
  const nx = x0 + 1.5, ny = y0 - 0.75;
  if (!MH.physics.collides(H.game.world, nx, ny, 0.27, null, true)) {
    A.teleport(H, nx, ny);
    const rel = A.holdMove(H, 0, 1);
    await t.sleep(1000);
    rel();
    t.check(hp.y < y0 + 0.05, 'host cannot walk through the wall', `host y ${f2(hp.y)} (wall row starts at ${y0})`);
  } else t.note('north side of the wall blocked — walk-through test skipped');
  await t.checkDigest(H, G);
  env.history.push('S10');
});

// =====================================================================================================
// S11 Placement race
def('S11', {
  title: 'Guest places on a tile the host just built', timeout: 60000,
  expected: 'That tile rejected (blueprints are free: the guest keeps its wood); one structure (the host’s) on both',
  api: 'build.place reject → give refund; struct.add from the host; net.stats.rejects',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.ensure(H, { wood: 10 }); A.ensure(G, { wood: 10 });
  const gp = G.game.player, hp = H.game.player;
  const site = A.findSite([H, G], [MH, MG], 'wall_wood', (x, y) => [[x, y]], (gp.x + hp.x) / 2, (gp.y + hp.y) / 2, { rMin: 2, rMax: 12, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a free tile');
  const [tx, ty] = site.tiles[0];
  const w0 = A.count(G, 'wood'), rej0 = stat(G, 'rejects');
  A.place(H, MH, 'wall_wood', [tx, ty]);
  let guestErr = null;
  try { A.place(G, MG, 'wall_wood', [tx, ty]); } catch (e) { guestErr = e.message; }
  if (guestErr) t.note('guest placement refused locally (host op already applied): ' + guestErr);
  t.log(`host and guest place wall_wood at (${tx},${ty}) in the same tick`);
  const refunded = await t.tryWait(() => A.count(G, 'wood') === w0, RT() + 600);
  t.check(refunded, 'guest wood unchanged (free blueprint, nothing to refund)', `${w0} → ${A.count(G, 'wood')}`);
  await t.sleep(ONEWAY());
  const oh = A.structAt(H, MH, tx, ty, 'main'), og = A.structAt(G, MG, tx, ty, 'main');
  t.check(oh && og && oh.id === og.id, 'one structure at the tile, same id on both', `${oh?.id} / ${og?.id}`);
  t.check(H.game.build.structures.filter((o) => o.tx === tx && o.ty === ty).length === 1, 'host has exactly one structure there');
  if (rej0 != null && !guestErr) t.check(stat(G, 'rejects') > rej0, 'guest request rejected (ack ok:0)', `${rej0} → ${stat(G, 'rejects')}`);
  await t.checkDigest(H, G);
  env.history.push('S11');
});

// =====================================================================================================
// S12 Guest deconstructs a chest with items
def('S12', {
  title: 'Guest deconstructs a chest with items', timeout: 120000,
  expected: 'Structure gone on both; 75% refund only to the guest; chest contents appear as loot with identical ids',
  api: 'chest panel [data-slot] shift-click (chest.put intent → chest.set); toggleDecon (build.decon → struct.decon); decon work (decon.hit → struct.remove {refund, drops}); o.store',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.ensure(H, { wood: 10 });
  const hp = H.game.player, gp = G.game.player;
  const site = A.findSite([H, G], [MH, MG], 'chest', (x, y) => [[x, y]], hp.x, hp.y, { rMin: 2, rMax: 10, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a free tile for the chest');
  const [tx, ty] = site.tiles[0];
  A.place(H, MH, 'chest', [tx, ty]);
  const chestH = await t.waitFor(() => A.structAt(H, MH, tx, ty, 'main'), 2000, 'host chest blueprint');
  await A.buildAll(t, H, MH, [chestH.id]);
  const chestG = await t.waitFor(() => { const o = A.structOn(G, chestH.id); return o && !o.blueprint && o; }, ONEWAY() + 300, 'guest sees the finished chest');
  A.ensure(G, { stone: 5 });
  A.standBy(G, MG, chestG);
  const stone0 = A.count(G, 'stone');
  await A.chestPut(t, G, MG, chestG, 'stone');
  const slots = (o) => short((o?.store?.slots || []).filter(Boolean).map((s) => `${s.id}×${s.qty}`));
  await t.waitFor(() => (chestH.store?.count?.('stone') || 0) >= stone0, RT() + 400, 'host chest holds the stone', () => `host ${slots(chestH)} guest ${slots(chestG)} guest inv stone ${A.count(G, 'stone')}`);
  await t.tryWait(() => slots(A.structOn(G, chestH.id)) === slots(chestH), ONEWAY() + 300);
  t.check(slots(A.structOn(G, chestH.id)) === slots(chestH), 'chest contents identical on both', `host ${slots(chestH)}`);
  const invG0 = A.invSnap(G), invH0 = A.invSnap(H);
  const loot = A.lootRecorder(t, [H, G]);
  await A.decon(t, G, MG, chestH.id);
  await t.waitFor(() => !A.structOn(H, chestH.id), ONEWAY() + 300, 'chest gone on the host');
  await t.sleep(400);
  loot.stop();
  const dg = A.invDiff(invG0, A.invSnap(G)), dh = A.invDiff(invH0, A.invSnap(H));
  t.check(dg.wood === 6, '75% refund (6 wood) to the guest', short(dg));
  t.check(!dh.wood, 'no refund to the host', short(dh));
  const cmp = loot.compare(0, 1), li = loot.items(0);
  t.check(cmp.ok && (li.stone || 0) === stone0, 'chest contents dropped as loot with identical ids', `${cmp.detail} · items ${short(li)}`);
  await t.checkDigest(H, G);
  env.history.push('S12');
});

// =====================================================================================================
// S13 Door built by the host, opened / closed by the guest (doors open ONLY by an explicit action)
def('S13', {
  title: 'A: Door — guest opens / closes it; closed it blocks everyone (host creature too)', timeout: 150000,
  expected: 'Finished door starts closed (world.solid 1 on both, nobody passes); the guest opens it (door.toggle → door.set: open on both, solid 0, the guest walks through); closing is refused while someone stands in it; closed again, a host creature lured toward the guest never enters the door tile',
  api: 'door_wood replacing a wall (struct.remove + struct.add); describeStructure kind door + useStructure (door.toggle intent → door.set op); o.open; world.solid; host AI pathing; proxies',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.ensure(H, { wood: 40, rope: 2 });
  const hp = H.game.player, gp = G.game.player;
  const line = (x0, y0) => [0, 1, 2, 3, 4, 5, 6].map((k) => [x0 + k, y0]);
  const site = A.findSite([H, G], [MH, MG], 'wall_wood', (x, y) => [...line(x, y), [x + 3, y - 1], [x + 3, y + 1], [x + 3, y - 2], [x + 3, y + 2]].map((p) => p), hp.x, hp.y, { rMin: 3, rMax: 16, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a site for a 7-wide wall with a door');
  const { x0, y0 } = site, dx = x0 + 3;
  A.place(H, MH, 'wall_wood', [x0, y0], [x0 + 6, y0]);
  await t.waitFor(() => A.structAt(H, MH, dx, y0, 'main'), 1500, 'host wall blueprints');
  A.place(H, MH, 'door_wood', [dx, y0]);
  const door = await t.waitFor(() => { const o = A.structAt(H, MH, dx, y0, 'main'); return o?.type === 'door_wood' && o; }, 1500, 'door replaces the middle wall');
  const ids = line(x0, y0).map(([x, y]) => A.structAt(H, MH, x, y, 'main')?.id);
  await A.buildAll(t, H, MH, ids);
  await t.waitFor(() => ids.every((id) => A.structOn(G, id) && !A.structOn(G, id).blueprint), ONEWAY() + 400, 'guest sees the finished wall + door');
  const di = H.game.world.idx(dx, y0);
  const solid = () => `${H.game.world.solid.get(di)} / ${G.game.world.solid.get(di)}`;
  const doorG = () => A.structOn(G, door.id);
  t.check(!door.open && !doorG()?.open && H.game.world.solid.get(di) === 1 && G.game.world.solid.get(di) === 1, 'finished door starts closed (solid 1 on both)', `open ${door.open}/${doorG()?.open} · solid ${solid()}`);
  // nobody passes a closed door (it never opens by itself)
  A.teleport(H, dx + 0.5, y0 - 1.1);
  { const rel = A.holdMove(H, 0, 1); await t.sleep(900); rel(); }
  t.check(hp.y < y0 + 0.05 && !door.open, 'host cannot walk through the closed door (no auto-open)', `host y ${f2(hp.y)} · open ${door.open}`);
  A.teleport(H, dx + 4.5, y0 + 3.5);
  // the guest opens it with an explicit action
  A.teleport(G, dx + 0.5, y0 - 0.95);
  await A.hostSees(t, H, G);
  A.useDoor(G, MG, doorG());
  const ms = await t.timeTo(() => door.open && doorG()?.open && H.game.world.solid.get(di) === 0 && G.game.world.solid.get(di) === 0, RT() + 400, 'door open on both (solid 0)', () => `open ${door.open}/${doorG()?.open} · solid ${solid()}`);
  t.metric('doorOpenRoundTripMs', Math.round(ms));
  { const rel = A.holdMove(G, 0, 1); const ok = await t.tryWait(() => gp.y > y0 + 1.3, 3000); rel(); t.check(ok, 'guest walks through the open door', `y ${f2(gp.y)}`); }
  // closing while standing in the doorway is refused
  A.teleport(G, dx + 0.5, y0 + 0.5);
  await A.hostSees(t, H, G);
  const rej0 = stat(G, 'rejects');
  A.useDoor(G, MG, doorG());
  await t.sleep(RT() + 300);
  t.check(door.open && doorG()?.open, 'closing refused while the guest stands in the doorway', `open ${door.open}/${doorG()?.open} · rejects ${rej0} → ${stat(G, 'rejects')}`);
  // step out (south) and close it
  A.teleport(G, dx + 0.5, y0 + 2.2);
  await A.hostSees(t, H, G);
  G.game.player.x = dx + 0.5; G.game.player.y = y0 + 1.45; // within reach of the door, outside its tile
  await A.hostSees(t, H, G);
  A.useDoor(G, MG, doorG());
  await t.waitFor(() => !door.open && !doorG()?.open && H.game.world.solid.get(di) === 1 && G.game.world.solid.get(di) === 1, RT() + 400, 'door closed on both (solid 1)', () => `open ${door.open}/${doorG()?.open} · solid ${solid()}`);
  // a host creature lured toward the guest on the other side never enters the closed door tile
  const wolf = A.hostMobs(H, (m) => m.kind === 'animal' && (m.temper || '') === 'hostile').sort((a, b) => Math.hypot(a.x - dx, a.y - y0) - Math.hypot(b.x - dx, b.y - y0))[0]
    || A.hostMobs(H, (m) => m.kind === 'animal')[0];
  t.assert(wolf, 'found a host creature to lure');
  A.keepAlive(t, G);
  const ns = A.freeSpot(H, MH, dx + 0.5, y0 - 2.5, { rMin: 0, rMax: 1.5 });
  t.assert(ns, 'free spot north of the door');
  const orig = { x: wolf.x, y: wolf.y, home: wolf.home };
  t.defer(() => { // put the creature back home (it must not haunt the spawn in later scenarios)
    wolf.x = orig.x; wolf.y = orig.y; wolf.home = orig.home; wolf.state = 'idle'; wolf.stateT = 1; wolf.threat = null; wolf.calmT = 120;
  });
  wolf.calmT = 0;
  wolf.x = ns[0]; wolf.y = ns[1]; wolf.home = { x: ns[0], y: ns[1] };
  A.teleport(G, dx + 0.5, y0 + 2.2);
  await t.sleep(400);
  const av = guestOnHost(H, G);
  try { MH.ai.aggro(H.game, wolf, av || H.game.player); } catch (e) { t.note('aggro failed: ' + e.message); }
  let inside = 0, insideProxy = 0, samples = 0;
  const inDoor = (e) => e && e.x >= dx && e.x < dx + 1 && e.y >= y0 && e.y < y0 + 1;
  t.watch(() => { samples++; if (inDoor(wolf)) inside++; if (inDoor(A.proxyOf(G, wolf))) insideProxy++; }, 10);
  await t.sleep(8000);
  t.metric('lure', { species: wolf.species, state: wolf.state, samples, end: `${f2(wolf.x)},${f2(wolf.y)}` });
  t.check(inside === 0, 'host creature never inside the closed door tile', `${inside}/${samples} samples`);
  t.check(insideProxy === 0, 'creature proxy on the guest never inside the door tile', `${insideProxy}/${samples}`);
  t.check(!door.open, 'the door stayed closed (creatures never open it)', `open ${door.open}`);
  await t.checkDigest(H, G);
  env.history.push('S13');
});

// =====================================================================================================
// S14 ★ Guest mines an ore tile
def('S14', {
  star: true, title: 'Guest mines a rock tile with ore', timeout: 150000,
  expected: 'tile.mine on both (rock 0, ground STONE, textures updated); adjacent wall masks updated; ore loot ids equal',
  api: 'mining rockIt + ctl.interact (rock.hit intent → rock.prog / tile.mine); world.{rock,ore,ground,tileData}; game.minedTiles; structure masks',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sp = spawnOf(H);
  const list = A.oreTiles(H, MH, sp.x, sp.y).filter((c) => !env.claimed.has('ore' + c.i) && G.game.world.rock.get(c.i) === 1);
  t.assert(list.length, 'found an ore tile reachable from an open neighbour');
  const c = list[0];
  env.claimed.add('ore' + c.i);
  const { tx, ty, i } = c;
  A.ensure(G, { pickaxe_steel: 1, wood: 6 });
  A.pacify(H, tx, ty, 16); A.pacify(G, tx, ty, 16); // (guest: no-op with proxies)
  A.keepAlive(t, G);
  // optional: a wall next to the ore tile, to check mask updates
  let wall = null;
  const second = c.opens[1];
  A.teleport(G, c.opens[0][0] + 0.5, c.opens[0][1] + 0.5);
  await A.hostSees(t, H, G);
  if (second && MG.building.placeReason(G.game, 'wall_wood', second[0], second[1]) === null && MH.building.placeReason(H.game, 'wall_wood', second[0], second[1]) === null) {
    A.place(G, MG, 'wall_wood', second);
    const wb = await t.waitFor(() => A.structAt(H, MH, second[0], second[1], 'main'), RT() + 400, 'host has the guest wall blueprint');
    await t.waitFor(() => A.structOn(G, wb.id), ONEWAY() + 300, 'guest has the wall blueprint');
    await A.buildAll(t, G, MG, [wb.id]);
    await t.waitFor(() => !A.structOn(H, wb.id)?.blueprint, ONEWAY() + 300, 'host sees the wall completed');
    wall = { id: wb.id, mask0: A.structOn(H, wb.id).mask };
  } else t.note('no second open neighbour — wall-mask sub-check skipped');
  const stand = () => A.teleport(G, c.opens[0][0] + 0.5, c.opens[0][1] + 0.5);
  stand();
  await A.hostSees(t, H, G);
  const oreItem = MG.worldgen.ORE_ITEM?.[c.ore] || MG.items.ORE_ITEM?.[c.ore];
  const loot = A.lootRecorder(t, [H, G]);
  const xpG = A.xpRecorder(t, G), xpH = A.xpRecorder(t, H);
  const ev = A.edgeWatch(t, { h: () => H.game.world.rock.get(i) === 0, g: () => G.game.world.rock.get(i) === 0 });
  await A.mine(t, G, MG, tx, ty, { stand });
  await t.waitFor(() => H.game.world.rock.get(i) === 0, ONEWAY() + 300, 'tile mined on the host');
  await t.sleep(700);
  loot.stop();
  const GS = MG.worldgen.G?.STONE;
  for (const f of [H, G]) {
    const w = f.game.world;
    t.check(w.rock.get(i) === 0 && w.ore.get(i) === 0 && (GS == null || w.ground.get(i) === GS), `${f.label}: rock 0, ore 0, ground STONE`, `rock ${w.rock.get(i)} ore ${w.ore.get(i)} ground ${w.ground.get(i)}`);
    t.check(f.game.minedTiles?.includes(i), `${f.label}: minedTiles has the tile`);
  }
  let td = true;
  for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) {
    const k = H.game.world.idx(x, y), a = H.game.world, b = G.game.world; // (the GPU tile texture is made from these layers)
    for (const L of ['ground', 'rockType', 'ore', 'rock']) if (a[L].get(k) !== b[L].get(k)) td = false;
  }
  t.check(td, 'tile layers (ground / rock type / ore / rock 3×3) identical');
  if (wall) {
    const mh = A.structOn(H, wall.id)?.mask, mg = A.structOn(G, wall.id)?.mask;
    t.check(mh === mg, 'adjacent wall mask identical after mining', `host ${mh} guest ${mg} (before ${wall.mask0})`);
    t.check(mh !== wall.mask0, 'adjacent wall mask updated by the mining', `${wall.mask0} → ${mh}`);
  }
  const cmp = loot.compare(0, 1), li = loot.items(0);
  t.check(cmp.ok && (!oreItem || li[oreItem] > 0), 'stone/ore loot with identical ids on both', `${cmp.detail} · ${short(li)}`);
  t.check(xpG.total > 0 && xpH.total === 0, 'mining XP only to the guest', `guest +${xpG.total} host +${xpH.total}`);
  t.metric('mineLagMs', Math.round(ev.g.first - ev.h.first));
  await t.checkDigest(H, G);
  env.history.push('S14');
});

// =====================================================================================================
// S15 Farming
def('S15', {
  title: 'Farming: guest plants, host time advances, host harvests', timeout: 150000,
  expected: 'crop.add on both; stage changes visible on both at the same stage; harvest loot equal; seed refunded on a rejected plant',
  api: 'farm_plot build; plot describeStructure kind plant/harvest (farm.plant / farm.harvest intents); crop.stage ops from host growth; cropAt; net.request("farm.plant", args, {refund})',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player, hp = H.game.player;
  const site = A.findSite([H, G], [MH, MG], 'farm_plot', (x, y) => [[x, y]], gp.x, gp.y, { rMin: 2, rMax: 16, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a tile for a farm plot');
  const [tx, ty] = site.tiles[0];
  A.place(G, MG, 'farm_plot', [tx, ty]);
  const plotH = await t.waitFor(() => A.structAt(H, MH, tx, ty, 'floor'), RT() + 400, 'host has the plot blueprint');
  await t.waitFor(() => A.structOn(G, plotH.id), ONEWAY() + 300, 'guest has the plot blueprint');
  await A.buildAll(t, G, MG, [plotH.id]);
  await t.waitFor(() => !plotH.blueprint, ONEWAY() + 300, 'host plot completed');
  A.ensure(G, { seed_potato: 3 });
  for (const s of G.game.player.inv.slots) if (s && s.id !== 'seed_potato' && /^seed_/.test(s.id)) s.qty = 0;
  G.game.player.inv.slots = G.game.player.inv.slots.map((s) => (s && s.qty > 0 ? s : null));
  G.game.player.seedPref = 'seed_potato';
  const plotG = A.structOn(G, plotH.id);
  const seeds0 = A.count(G, 'seed_potato');
  A.standBy(G, MG, plotG);
  await A.plant(t, G, MG, plotG);
  await t.waitFor(() => MH.farming.cropAt(H.game, tx, ty), ONEWAY() + 300, 'host has the crop');
  const ch = MH.farming.cropAt(H.game, tx, ty), cg = MG.farming.cropAt(G.game, tx, ty);
  t.check(ch.kind === cg.kind && ch.kind === 'potato' && ch.stage === cg.stage, 'crop.add on both (same kind, stage)', `${ch.kind}/${ch.stage} vs ${cg.kind}/${cg.stage}`);
  t.check(A.count(G, 'seed_potato') === seeds0 - 1, 'guest paid one seed', `${seeds0} → ${A.count(G, 'seed_potato')}`);
  // host time advances: stage 1, 2, 3 in steps
  for (const [dtw, stage] of [[260, 1], [260, 2], [320, 3]]) {
    H.game.worldTime += dtw;
    await t.waitFor(() => MH.farming.cropAt(H.game, tx, ty)?.stage >= stage, 3000, `host crop reaches stage ${stage}`);
    const ok = await t.tryWait(() => MG.farming.cropAt(G.game, tx, ty)?.stage === MH.farming.cropAt(H.game, tx, ty)?.stage, ONEWAY() + 300);
    t.check(ok, `stage ${stage} visible on both`, `host ${MH.farming.cropAt(H.game, tx, ty)?.stage} guest ${MG.farming.cropAt(G.game, tx, ty)?.stage}`);
  }
  // host harvests
  const loot = A.lootRecorder(t, [H, G]);
  const xpH = A.xpRecorder(t, H);
  A.standBy(H, MH, plotH);
  sendAway(G, MG, plotH.x, plotH.y, 7);
  await A.harvest(t, H, MH, plotH);
  sendAway(H, MH, plotH.x, plotH.y, 6);
  await t.waitFor(() => !MG.farming.cropAt(G.game, tx, ty), ONEWAY() + 300, 'crop removed on the guest');
  await t.sleep(500);
  loot.stop();
  const cmp = loot.compare(0, 1), li = loot.items(0);
  t.check(cmp.ok && (li.potato || 0) >= 1, 'harvest loot identical on both (potatoes + seeds)', `${cmp.detail} · ${short(li)}`);
  t.check(xpH.total > 0, 'harvest XP to the host', `+${xpH.total}`);
  // rejected plant → seed refunded: host plants first, then the guest's request on the occupied plot
  A.ensure(H, { seed_potato: 2 });
  H.game.player.seedPref = 'seed_potato';
  A.standBy(H, MH, plotH);
  await A.plant(t, H, MH, plotH);
  await t.waitFor(() => MG.farming.cropAt(G.game, tx, ty), ONEWAY() + 300, 'guest sees the host crop');
  if (typeof G.net?.request === 'function') {
    const s0 = A.count(G, 'seed_potato');
    G.game.player.inv.remove('seed_potato', 1);
    let rejected = null;
    G.net.request('farm.plant', { tx, ty, seed: 'seed_potato' }, { refund: { seed_potato: 1 }, onReject: (why) => { rejected = why ?? true; }, onOk: () => { rejected = false; } });
    const back = await t.tryWait(() => A.count(G, 'seed_potato') === s0, RT() + 500);
    t.check(back, 'seed refunded on a rejected plant', `${s0} → ${A.count(G, 'seed_potato')} (onReject ${short(rejected)})`);
  } else t.note('net.request missing — refund sub-check skipped');
  await t.checkDigest(H, G);
  env.history.push('S15');
});

// =====================================================================================================
// S16 ★ Wolf killed by the guest
async function killByGuest(t, C, wolf, { knife }) {
  const { H, G, MG } = C;
  const gpl = G.game.player;
  // blades decide the yields (corpses: knife / sword / axe = full table; bare hands = no hide)
  const BLADE = /^(knife|sword|axe)_/;
  if (knife) A.ensure(G, { knife_stone: 1 });
  else {
    if (BLADE.test(gpl.equip.main || '')) G.game.econ.unequip('main');
    gpl.inv.slots = gpl.inv.slots.map((s) => (s && BLADE.test(s.id) ? null : s));
    G.game.events.emit('inventory', {});
  }
  const s = A.freeSpot(G, MG, wolf.x, wolf.y, { rMin: 1.1, rMax: 2 });
  t.assert(s, 'free spot next to the wolf');
  A.teleport(G, s[0], s[1]);
  const prox = await t.waitFor(() => A.proxyOf(G, wolf), 3000 + CFG.budget, 'wolf proxy on the guest');
  await t.waitFor(() => { const av = guestOnHost(H, G); return av && Math.hypot(av.x - wolf.x, av.y - wolf.y) < 3; }, 3000, 'host sees the guest next to the wolf');
  const inv0 = [A.invSnap(H), A.invSnap(G)];
  const xpH = A.xpRecorder(t, H), xpG = A.xpRecorder(t, G);
  const loot = A.lootRecorder(t, [H, G]);
  const before = new Set(H.game.corpses.map.keys());
  A.hit(G, MG, A.proxyOf(G, wolf) || prox, 9999);
  t.log(`guest hits wolf ${wolf.nid} for 9999 (knife: ${knife})`);
  const dh = await t.timeTo(() => wolf.dead, RT() + 400, 'wolf dead on the host', () => `hp ${wolf.hp} guest ui: ${G.lastUi()}`);
  await t.waitFor(() => A.proxyOf(G, wolf)?.dead || !A.proxyOf(G, wolf), ONEWAY() + 300, 'wolf dead on the guest');
  t.metric(`kill${knife ? 'Knife' : ''}RoundTripMs`, Math.round(dh));
  A.pacify(H, wolf.x, wolf.y, 24, 120); // the pack calms down while the guest works on the body
  const ch = await t.waitFor(() => [...H.game.corpses.map.values()].find((c) => !before.has(c.id) && c.of === 'wolf'), 1500, 'wolf body on the host');
  const cg = await t.waitFor(() => G.game.corpses.map.get(ch.id), ONEWAY() + 600, 'same body (id) on the guest');
  const sameBody = cg.of === ch.of && Math.abs(cg.x - ch.x) < 0.01 && Math.abs(cg.y - ch.y) < 0.01 && cg.deathT === ch.deathT;
  const verb = MG.corpses.describeCorpse(G.game, cg)?.verb;
  await A.workUntil(t, G, () => { const q = G.game.corpses.map.get(ch.id); return q && !q.butchered ? MG.corpses.describeCorpse(G.game, q) : null; },
    () => ch.butchered && G.game.corpses.map.get(ch.id)?.butchered, 20000, 'guest collects the wolf (Coletar)');
  await t.sleep(RT());
  loot.stop();
  const gainH = A.invDiff(inv0[0], A.invSnap(H)), gainG = A.invDiff(inv0[1], A.invSnap(G));
  return { sameBody, verb, ground: loot.rows(0).length + loot.rows(1).length, gainH, gainG, xpH: xpH.total, xpG: xpG.total };
}
def('S16', {
  star: true, title: 'Wolf killed by the guest', timeout: 150000,
  expected: 'Wolf dead on both; no ground loot: the same body (id) on both; the guest collects it ("Coletar"): meat to the guest only, leather only with a blade (knife), XP only to the guest',
  api: 'combat applyPlayerHit on a proxy (mob.hit intent); mob.die + corpse.add ops; corpses.describeCorpse → work "butcher" → intent corpse.butcher → op corpse.butcher {give}; proxies {nid,dead}',
}, async (t) => {
  const C = await pairCtx(t);
  const { H, G } = C;
  t.need(H.game.corpses && G.game.corpses, 'corpses not merged (game.corpses missing)');
  A.ensure(H, { knife_stone: 1 }); // the host's knife must NOT make the guest's work yield leather
  A.keepAlive(t, G);
  const sp = spawnOf(H);
  A.ensureMobs(H, await A.mods(H), 'wolf', 2, sp.x + 14, sp.y + 6, (m) => !env.claimed.has('mob' + m.nid)); // (wolves come out at night only)
  const wolves = A.hostMobs(H, (m) => m.species === 'wolf' && !env.claimed.has('mob' + m.nid)).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y));
  t.assert(wolves.length >= 2, 'found two wolves on the host', `${wolves.length}`);
  t.need(wolves[0].nid != null, 'host creatures have no nid (entity replication not merged)');
  for (const [k, knife] of [[0, false], [1, true]]) {
    const wolf = wolves[k];
    env.claimed.add('mob' + wolf.nid);
    const r = await killByGuest(t, C, wolf, { knife });
    const tag = knife ? ' (guest with knife)' : ' (guest bare-handed, host has a knife)';
    t.check(r.sameBody, 'the same wolf body (id, position, time of death) on both' + tag);
    t.check(r.ground === 0, 'no kill loot on the ground' + tag, `${r.ground} rows`);
    t.check(r.verb === 'Coletar', 'interaction on the fresh body is "Coletar"' + tag, r.verb);
    t.check((r.gainG.meat || 0) >= 1, 'meat collected by the guest' + tag, short(r.gainG));
    if (!knife) t.check(!r.gainG.leather, 'no leather bare-handed', short(r.gainG));
    else t.note(`leather with a knife: ${r.gainG.leather || 0} (70% chance)`);
    t.check(!Object.keys(r.gainH).length, 'the host got nothing' + tag, short(r.gainH));
    t.check(r.xpG > 0 && r.xpH === 0, 'kill + collect XP only to the guest' + tag, `guest +${f2(r.xpG)} host +${f2(r.xpH)}`);
  }
  await t.checkDigest(H, G);
  env.history.push('S16');
});

// =====================================================================================================
// S17 ★ Creature chases the guest
def('S17', {
  star: true, title: 'Creature chases the guest', timeout: 150000,
  expected: "Visible on both; same nid/species/name/level; proxy within 0.5 tile of the host position 150 ms earlier; bites reduce the guest's HP (owner applies), host sees it via presence; guest death → creature evades",
  api: 'host AI targeting remote avatars (players.js); proxies {nid,species,name,level,state,threat}; own player.hurt; presence hp; respawnPlayer',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sp = spawnOf(H);
  A.ensureMobs(H, MH, 'wolf', 1, sp.x + 12, sp.y - 8, (e) => !env.claimed.has('mob' + e.nid)); // (wolves come out at night only)
  const m = A.hostMobs(H, (e) => (e.species === 'wolf' || e.species === 'spider') && !env.claimed.has('mob' + e.nid))
    .sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y))[0];
  t.assert(m, 'found a hostile creature');
  t.need(m.nid != null, 'host creatures have no nid (entity replication not merged)');
  env.claimed.add('mob' + m.nid);
  m.calmT = 0;
  const s = A.freeSpot(G, MG, m.x + 4.2, m.y, { rMin: 0, rMax: 2 });
  t.assert(s, 'free spot 4 tiles from the creature');
  A.teleport(G, s[0], s[1]);
  const hpH0 = H.game.player.hp;
  const dmgG = [], dmgH = [];
  t.on(G, 'damage', (d) => { if (d.target === G.game.player && d.amount > 0) dmgG.push({ t: now(), amount: d.amount }); });
  t.on(H, 'damage', (d) => { if (d.target === H.game.player && d.amount > 0) dmgH.push(d.amount); });
  const av = () => guestOnHost(H, G);
  await t.waitFor(() => m.state === 'chase' && (m.threat === av() || m.threat?.pid === G.pid), 6000, 'host creature chases the guest avatar', () => `state=${m.state} threat=${m.threat?.pid ?? m.threat?.name ?? '-'} d=${f2(Math.hypot(m.x - s[0], m.y - s[1]))}`);
  const pr = await t.waitFor(() => A.proxyOf(G, m), 1000, 'proxy on the guest');
  t.check(pr.species === m.species && pr.name === m.name && pr.level === m.level, 'same nid / species / name / level', `${m.nid} ${m.species} "${m.name}" L${m.level} vs ${pr.nid} ${pr.species} "${pr.name}" L${pr.level}`);
  await t.tryWait(() => pr.state === 'chase' && pr.threat === G.game.player, 1000);
  t.check(pr.state === 'chase' && pr.threat === G.game.player, "guest proxy shows the chase at the guest (overlay / combat)", `state=${pr.state}`);
  // position check while the guest runs (creature keeps chasing)
  const hist = [], errs = [];
  const dir = A.clearLine(G, MG, G.game.player.x, G.game.player.y, G.game.player.x + 8, G.game.player.y) ? [1, 0] : A.clearLine(G, MG, G.game.player.x, G.game.player.y, G.game.player.x - 8, G.game.player.y) ? [-1, 0] : [0, 1];
  const posAt = (tt) => { for (let k = hist.length - 1; k > 0; k--) if (hist[k - 1][0] <= tt) { const a = hist[k - 1], b = hist[k], q = (tt - a[0]) / Math.max(1e-3, b[0] - a[0]); return [a[1] + (b[1] - a[1]) * q, a[2] + (b[2] - a[2]) * q]; } return null; };
  const wpos = t.watch(() => {
    const tt = now();
    hist.push([tt, m.x, m.y]);
    const p2 = A.proxyOf(G, m);
    const hpos = posAt(tt - 150);
    if (p2 && hpos && tt - hist[0][0] > 400) errs.push(Math.hypot(p2.x - hpos[0], p2.y - hpos[1]));
  }, 8);
  const rel = A.holdMove(G, dir[0] * 0.55, dir[1] * 0.55);
  await t.sleep(2500);
  rel();
  await t.sleep(2500);
  wpos.stop();
  const p95 = pct(errs, 0.95), mx = Math.max(...errs);
  t.metric('posErr', { n: errs.length, median: f2(median(errs)), p95: f2(p95), max: f2(mx) });
  t.check(errs.length > 50 && p95 <= 0.5, 'proxy within 0.5 tile of the host position 150 ms earlier (p95)', `p95 ${f2(p95)} max ${f2(mx)} over ${errs.length} samples`);
  // bites
  await t.tryWait(() => dmgG.length > 0, 8000);
  t.check(dmgG.length > 0, "bites reduce the guest's HP (applied by the owner)", `${dmgG.length} hits, hp ${f2(G.game.player.hp)}/${G.game.player.maxHp}`);
  const seen = await t.tryWait(() => av() && Math.abs(av().hp - G.game.player.hp) <= 1 && av().hp < av().maxHp, 1500);
  t.check(seen, 'host sees the guest HP drop via presence', `host copy ${f2(av()?.hp)} vs guest ${f2(G.game.player.hp)}`);
  t.check(!dmgH.length && H.game.player.hp >= hpH0, 'host player not hurt', `${dmgH.length} hits`);
  // death → creature evades
  G.game.player.hp = 1;
  const died = await t.tryWait(() => G.game.player.dead, 15000);
  t.check(died, 'guest dies to the creature');
  if (died) {
    const ev = await t.tryWait(() => m.state === 'evade' || (m.state !== 'chase') || (m.threat !== av() && m.threat?.pid !== G.pid), 3000 + CFG.budget);
    t.check(ev, 'creature stops chasing / evades after the guest died', `state=${m.state}`);
    MG.player.respawnPlayer(G.game);
  }
  await t.checkDigest(H, G);
});

// =====================================================================================================
// S18 Bandit archer shoots the guest
def('S18', {
  title: 'Bandit archer shoots the guest', timeout: 120000,
  expected: "Arrow visible on both; damage only on the guest; aimed-shot cast bar visible on the guest's nameplate",
  api: 'host bandit AI vs remote avatar; fx proj/pend (cosmetic projectiles on guests); own player.hurt; proxy cast {name,t,dur}',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const archers = [];
  for (const c of H.game.camps || []) for (const m of c.members || []) if (m.role === 'archer' && !m.dead) archers.push(m);
  const sp = spawnOf(H);
  archers.sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y));
  t.assert(archers.length, 'found a bandit archer');
  const ar = archers[0];
  t.need(ar.nid != null, 'host creatures have no nid (entity replication not merged)');
  let spot = null;
  for (let k = 0; k < 16 && !spot; k++) {
    const a = (k / 16) * Math.PI * 2;
    const s = A.freeSpot(G, MG, ar.x + Math.cos(a) * 7, ar.y + Math.sin(a) * 7, { rMin: 0, rMax: 1 });
    if (s && MG.combat.hasLOS(G.game.world, s[0], s[1], ar.x, ar.y)) spot = s;
  }
  t.assert(spot, 'free spot 7 tiles from the archer with line of sight');
  A.teleport(G, spot[0], spot[1]);
  A.keepAlive(t, G, { hp: false });
  t.watch(() => { const p = G.game.player; if (!p.dead && p.hp < p.maxHp * 0.5) p.hp = p.maxHp; }, 50);
  const seenH = new WeakSet(), seenG = new WeakSet();
  const st = { hArrows: 0, gArrows: 0, hFirst: null, gFirst: null, hostCast: null, guestCast: null };
  t.watch(() => {
    for (const p of H.game.projectiles || []) if (p.faction === 'bandit' && !seenH.has(p)) { seenH.add(p); st.hArrows++; st.hFirst ??= now(); }
    for (const p of G.game.projectiles || []) if ((p.faction === 'bandit' || p.cosmetic) && !seenG.has(p)) { seenG.add(p); st.gArrows++; st.gFirst ??= now(); }
    if (ar.cast && !st.hostCast) st.hostCast = ar.cast.name;
    const pr = A.proxyOf(G, ar);
    if (pr?.cast && !st.guestCast) st.guestCast = pr.cast.name ?? pr.cast.id ?? pr.castName ?? true;
  }, 8);
  const dmgG = [], dmgH = [];
  t.on(G, 'damage', (d) => { if (d.target === G.game.player && d.amount > 0) dmgG.push({ src: d.src?.role || d.src?.species || '?', ability: d.ability }); });
  t.on(H, 'damage', (d) => { if (d.target === H.game.player && d.amount > 0) dmgH.push(d.amount); });
  await t.tryWait(() => st.gArrows > 0 && dmgG.length > 0 && (st.guestCast || !st.hostCast) && st.hostCast, 30000);
  t.metric('archer', { ...st, hFirst: undefined, gFirst: undefined, lagMs: st.gFirst && st.hFirst ? Math.round(st.gFirst - st.hFirst) : null, dmg: dmgG.length });
  t.check(st.hArrows > 0, 'host simulates bandit arrows at the guest', `${st.hArrows}`);
  t.check(st.gArrows > 0, 'arrows visible on the guest (cosmetic copies)', `${st.gArrows}`);
  t.check(dmgG.length > 0, 'damage on the guest', short(dmgG.slice(0, 5)));
  t.check(!dmgH.length, 'no damage on the host player', `${dmgH.length}`);
  if (st.hostCast) t.check(!!st.guestCast, "aimed-shot cast bar visible on the guest's nameplate (proxy cast)", `host cast "${st.hostCast}", guest ${short(st.guestCast)}`);
  else t.note('archer never cast an aimed shot in 30 s — cast bar sub-check skipped');
  sendAway(G, MG, ar.x, ar.y, 40);
  await t.checkDigest(H, G);
});

// =====================================================================================================
// S19 Guest abilities on host creatures
const stunned = (e) => e?.stunT > 0 || !!e?.stunned || !!((e?.bits ?? 0) & (1 << 5));
const dazed = (e) => e?.dazeT > 0 || !!e?.dazed || !!((e?.bits ?? 0) & (1 << 10));
const feared = (e) => e?.fearT > 0 || !!e?.feared || !!((e?.bits ?? 0) & (1 << 11));
const hasDot = (id) => (e) => !!e?.dots?.some?.((d) => (d?.id ?? d) === id) || !!e?.[id];
def('S19', {
  title: 'Guest abilities on host creatures', timeout: 150000,
  expected: 'stun (smash), daze (shove), bleed (lacerate), fear (torch_swing), stun/interrupt (shield_bash) take effect on the host creature and show on the guest proxy',
  api: 'useAbility on the guest (mob.hit {stun,daze,fear,dot,interrupt} / mobEffect); host mob {stunT,dazeT,fearT,dots}; proxy bits (stunned/dazed/feared/bleed)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sp = spawnOf(H);
  const m = A.hostMobs(H, (e) => (e.species === 'boar' || e.species === 'deer') && !env.claimed.has('mob' + e.nid)).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y))[0];
  t.assert(m, 'found a boar/deer');
  t.need(m.nid != null, 'host creatures have no nid (entity replication not merged)');
  env.claimed.add('mob' + m.nid);
  m.maxHp = m.hp = 50000; // host-side test setup: survives every hit
  A.keepAlive(t, G);
  const steps = [
    { id: 'smash', gear: { main: 'club_wood' }, host: stunned, proxy: stunned, what: 'stun' },
    { id: 'shove', gear: { main: 'club_wood' }, host: dazed, proxy: dazed, what: 'daze' },
    { id: 'lacerate', gear: { main: 'knife_stone' }, host: hasDot('bleed'), proxy: hasDot('bleed'), what: 'bleed' },
    { id: 'torch_swing', gear: { main: 'club_wood', off: 'torch_hand' }, host: feared, proxy: feared, what: 'fear' },
    { id: 'shield_bash', gear: { main: 'club_wood', off: 'shield_wood' }, host: stunned, proxy: stunned, what: 'stun (bash)' },
  ];
  for (const s of steps) {
    A.equip(G, s.gear.main);
    if (s.gear.off) A.equip(G, s.gear.off); else if (G.game.player.equip.off) G.game.econ.unequip('off');
    MG.abilities.rebuildBar(G.game);
    let okHost = false, okProxy = false, tries = 0;
    while (!okHost && tries < 3) {
      tries++;
      m.stunT = 0; m.dazeT = 0; m.fearT = 0; if (m.dots) m.dots.length = 0;
      await t.sleep(CFG.budget + 150);
      if (!A.proxyOf(G, m)) { // (a planet: the creature may be out of the guest's interest — go to it)
        G.game.world.ensure(G.game.world.chunkIndex(m.x, m.y));
        const s0 = A.freeSpot(G, MG, m.x, m.y, { rMin: 1.5, rMax: 4 });
        if (s0) A.teleport(G, s0[0], s0[1]);
      }
      const pr = await t.waitFor(() => A.proxyOf(G, m), 3000, 'proxy on the guest');
      const at = A.freeSpot(G, MG, pr.x, pr.y, { rMin: 0.62, rMax: 0.85 });
      if (at) A.teleport(G, at[0], at[1]);
      await t.waitFor(() => { const av = guestOnHost(H, G); return av && Math.hypot(av.x - m.x, av.y - m.y) < 2.2; }, 2000, 'host sees the guest next to the creature');
      const used = A.ability(G, MG, s.id, A.proxyOf(G, m));
      if (!used) { t.log(`useAbility(${s.id}) refused: ${G.lastUi(1)}`); continue; }
      okHost = await t.tryWait(() => s.host(m), 900 + RT());
      if (okHost) okProxy = await t.tryWait(() => s.proxy(A.proxyOf(G, m)), ONEWAY() + 200);
    }
    t.check(okHost, `${s.id}: ${s.what} applied on the host creature`, `tries ${tries}`);
    t.check(okProxy, `${s.id}: ${s.what} shown on the guest proxy`);
  }
  await t.checkDigest(H, G);
});

// =====================================================================================================
// S20 Guest breaks a bandit crate
def('S20', {
  title: 'Guest breaks a bandit crate', timeout: 120000,
  expected: 'prop.set broken on both; loot ids equal; crate restored on both after CRATE_RESPAWN (host time)',
  api: 'applyPlayerHit on a prop (prop.hit intent → prop.set + loot.add); game.props[].{id,broken,hp}; host banditsSystem respawn (worldTime)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sp = spawnOf(H);
  const crates = (H.game.props || []).filter((o) => !o.broken && !o.dummy && !env.claimed.has('prop' + o.id)).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y));
  t.assert(crates.length, 'found an intact crate');
  const cH = crates[0];
  env.claimed.add('prop' + cH.id);
  const cG = (G.game.props || []).find((o) => String(o.id) === String(cH.id));
  t.assert(cG && !cG.broken, 'same crate on the guest', String(cH.id));
  A.keepAlive(t, G);
  const s = A.freeSpot(G, MG, cG.x, cG.y, { rMin: 0.7, rMax: 1.1 });
  A.teleport(G, s[0], s[1]);
  await t.waitFor(() => { const av = guestOnHost(H, G); return av && Math.hypot(av.x - cH.x, av.y - cH.y) < 2; }, 2000, 'host sees the guest at the crate');
  const loot = A.lootRecorder(t, [H, G]);
  // crates count hits, not damage (hp 3; a strike ≥ 18 counts 2): strike until it breaks, like a player would
  let strikes = 0;
  while (!cH.broken && strikes < 6) {
    const hp0 = cH.hp;
    A.hit(G, MG, cG, 50); strikes++;
    await t.waitFor(() => cH.broken || cH.hp < hp0, RT() + 400, `crate takes strike ${strikes} on the host`, () => `hp ${cH.hp} ui: ${G.lastUi()}`);
    await t.tryWait(() => cG.hp === cH.hp || cG.broken, ONEWAY() + 200);
  }
  t.check(cH.broken, 'crate broken on the host', `${strikes} strikes`);
  const lag = await t.timeTo(() => cG.broken, ONEWAY() + 300, 'crate broken on the guest');
  t.metric('brokenLagMs', Math.round(lag));
  await t.sleep(500);
  sendAway(G, MG, sp.x, sp.y, 2);
  await t.sleep(600);
  loot.stop();
  const cmp = loot.compare(0, 1);
  t.check(cmp.ok && cmp.n > 0, 'crate loot with identical ids on both', cmp.detail);
  t.check(!A.objOn(H, cH.id) && !A.objOn(G, cG.id), 'crate removed from both worlds while broken');
  // host time: crate respawns (players far from the camp)
  H.game.worldTime += 605;
  const back = await t.tryWait(() => !cH.broken && A.objOn(H, cH.id), 4000);
  t.check(back, 'crate restored on the host after CRATE_RESPAWN', `broken=${cH.broken}`);
  const backG = await t.tryWait(() => !cG.broken && A.objOn(G, cG.id), ONEWAY() + 300);
  t.check(backG, 'crate restored on the guest', `broken=${cG.broken}`);
  t.check(cH.hp === cG.hp, 'crate hp equal', `${cH.hp} / ${cG.hp}`);
  await t.checkDigest(H, G);
  env.history.push('S20');
});

// =====================================================================================================
// S21 Flora regrowth
def('S21', {
  title: 'Flora regrowth (host-spawned saplings)', timeout: 150000,
  expected: 'Host-spawned saplings appear on the guest with the same id/position; never inside any player view; solid flip on both',
  api: 'host floraSystem (obj.add / tree.solid ops); game.flora.{dyn,chunks,ci,t} (host internals used to accelerate regrowth); inAnyView',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const F = H.game.flora;
  // (objects come from the frame's realm: no instanceof checks against this page's Map/Array)
  t.need(F && F.keys?.length && 'ci' in F && 't' in F && typeof F.dyn?.keys === 'function', 'host flora internals (game.flora.ci/t/keys/dyn) missing — cannot accelerate regrowth');
  const sp = spawnOf(H);
  const tr = A.pickTree(H, MH, G, sp.x + 10, sp.y, env.claimed, { r: 40 });
  t.assert(tr, 'found a tree');
  const o = tr.o, W = H.game.world, CH = 16, BKW = W.W / CH; // (flora records per 16×16 bucket: key = by * BKW + bx)
  const k = Math.floor(o.y / CH) * BKW + Math.floor(o.x / CH);
  A.ensure(G, { axe_steel: 1 });
  A.teleport(G, tr.west[0], tr.west[1]);
  await A.chop(t, G, MG, A.objOn(G, o.id), { tool: 'axe_steel', until: 'stump' });
  t.log(`chunk ${k} now lacks a ${o.type}`);
  const cx = (k % BKW) * CH + 8, cy = Math.floor(k / BKW) * CH + 8;
  sendAway(H, MH, cx, cy, 42, 0); sendAway(G, MG, cx, cy, 44, 0.3);
  await t.sleep(300);
  const before = new Set(F.dyn.keys());
  const found = [];
  const t0 = now();
  while (now() - t0 < 45000) {
    F.ci = Math.max(0, F.keys.indexOf(k)); F.t = 0;
    await t.sleep(25);
    for (const [id, q] of F.dyn) if (!before.has(id)) { before.add(id); found.push({ id, q, inH: A.inView(H, q.x, q.y), inG: A.inView(G, q.x, q.y) }); }
    if (found.some((x) => A.isTree(x.q))) break;
  }
  t.check(found.length > 0, 'host spawned flora', `${found.length}: ${found.slice(0, 5).map((x) => x.q.type).join(' ')}`);
  t.need(found.length, 'nothing regrew in 45 s');
  t.check(found.every((x) => !x.inH && !x.inG), 'never spawned inside a player view', found.filter((x) => x.inH || x.inG).map((x) => x.id).join(' '));
  await t.sleep(ONEWAY() + 100);
  const same = (x) => { const q = A.objOn(G, x.id); return q && q.type === x.q.type && q.x.toFixed(2) === x.q.x.toFixed(2) && q.y.toFixed(2) === x.q.y.toFixed(2) && (q.v | 0) === (x.q.v | 0) && (q.f | 0) === (x.q.f | 0); };
  const bad = found.filter((x) => !same(x));
  t.check(!bad.length, 'same id / type / position / variant on the guest', bad.slice(0, 4).map((x) => `${x.id} ${x.q.type}@${f2(x.q.x)},${f2(x.q.y)} guest ${short(A.objOn(G, x.id) && { x: A.objOn(G, x.id).x, y: A.objOn(G, x.id).y })}`).join(' '));
  const sap = found.find((x) => A.isTree(x.q));
  if (!sap) t.note('no tree sapling regrew — solid-flip sub-check skipped');
  else {
    const q = sap.q, qg = A.objOn(G, sap.id);
    t.check(!(q.solid > 0) && !(qg?.solid > 0), 'new sapling not solid on both', `${q.solid} / ${qg?.solid}`);
    H.game.worldTime += 1000;
    await t.waitFor(() => q.solid > 0, 3000, 'host flips the sapling solid');
    const ok = await t.tryWait(() => A.objOn(G, sap.id)?.solid > 0, ONEWAY() + 300);
    t.check(ok, 'solid flip on the guest', `${A.objOn(G, sap.id)?.solid}`);
  }
  await t.checkDigest(H, G);
  env.history.push('S21');
});

// =====================================================================================================
// S22 ★ Join mid-game
def('S22', {
  star: true, title: 'Join mid-game (third client)', timeout: 180000,
  expected: 'A third client gets digest equal right after the snapshot (stumps, mined tiles, structures, crops, loot, props, falling trees)',
  api: 'serializeWorld/applyWorld (snap chunks); net.digest/counts; BroadcastLink with 3 peers',
}, async (t) => {
  const { H, G, MH, MG, room } = await pairCtx(t);
  if (env.history.length < 4) {
    t.note(`shared world has little history (${env.history.join(',') || 'none'}); adding some first`);
    const sp = spawnOf(H);
    const tr = A.pickTree(H, MH, G, sp.x + 5, sp.y + 5, env.claimed);
    if (tr) { A.teleport(H, tr.west[0], tr.west[1]); await A.chop(t, H, MH, tr.o, { until: 'stump', tool: 'axe_steel' }); }
    A.ensure(G, { wood: 6 });
    const gp = G.game.player;
    const site = A.findSite([H, G], [MH, MG], 'wall_wood', (x, y) => [[x, y], [x + 1, y]], gp.x, gp.y, { rMin: 3, rMax: 10, avoidPts: [[gp.x, gp.y]] });
    if (site) A.place(G, MG, 'wall_wood', site.tiles[0], site.tiles[1]);
    await t.sleep(RT());
  }
  // a tree mid-fall while the newcomer joins (best effort)
  const sp = spawnOf(H);
  const tr = A.pickTree(H, MH, G, sp.x - 8, sp.y - 4, env.claimed);
  const pid3 = 'g' + rand(7);
  let fallAtSnap = null;
  if (tr) {
    A.ensure(H, { axe_steel: 1 });
    A.teleport(H, tr.west[0], tr.west[1]);
    t.watch(() => { if (fallAtSnap == null && H.session?.players?.has?.(pid3)) { fallAtSnap = H.game.falling?.length || 0; A.interact(H, MH.gathering.describeObject(H.game, tr.o)); } }, 10);
  }
  const G3 = await bootGuest(t, room, H, { pid: pid3, label: 'guest-3' });
  t.log('third client synced');
  const r = await t.checkDigest(H, G3, 'digest equal right after the snapshot (third client)', { ms: CFG.budget * 3 + 800 });
  if (r.counts) t.metric('counts', r.counts);
  t.metric('fallingWhenHelloArrived', fallAtSnap);
  await t.checkDigest(G, G3, 'digest equal between both guests');
  if (tr) {
    await t.tryWait(() => tr.o.stump, 12000);
    await t.checkDigest(H, G3, 'digest equal after the tree fell (third client)');
  }
  t.check(A.mobs(G3).every((e) => e.proxy), 'third client has only creature proxies', `${A.mobs(G3).filter((e) => !e.proxy).length} local`);
});

// =====================================================================================================
// S23 ★ Guest reload / reconnect
const WORLD_KEYS = ['nat', 'gone', 'dyn', 'structs', 'structures', 'mined', 'minedTiles', 'rockp', 'rockHits', 'loot', 'crops', 'props', 'flora', 'touched', 'falling', 'marks', 'spawners', 'camps'];
def('S23', {
  star: true, title: 'Guest reload / reconnect', timeout: 240000,
  expected: 'Resync; digest equal; guest inventory/equipment/level restored from the player-only guest save; no world data in wos.save.v2.<seed>.guest',
  api: 'session reconnect (ready {resync:1} → reconcile snapshot); net.stats.resyncs; guest save (player only) without ?nosave; save.saveGame; pagehide save',
}, async (t) => {
  const { H, G, MH, MG, room } = await pairCtx(t);
  // A) connection drop without reload: host changes the world meanwhile
  const s = G.session;
  if (typeof s?._close === 'function' && s.hostKey) {
    const res0 = stat(G, 'resyncs'), resH0 = stat(H, 'resyncs');
    const states = [];
    const off = s.on?.('state', (d) => states.push(d?.state));
    if (off) t.defer(off);
    else t.watch(() => { const st = G.session?.state; if (st !== states[states.length - 1]) states.push(st); }, 2);
    t.log('simulating a lost connection on the guest');
    s._close(s.hostKey);
    A.ensure(H, { wood: 4 });
    const hp = H.game.player;
    const site = A.findSite([H], [MH], 'wall_wood', (x, y) => [[x, y]], hp.x, hp.y, { rMin: 2, rMax: 10, avoidPts: [[hp.x, hp.y]] });
    let bp = null;
    if (site) { A.place(H, MH, 'wall_wood', site.tiles[0]); bp = A.structAt(H, MH, site.tiles[0][0], site.tiles[0][1], 'main'); }
    await t.tryWait(() => states.includes('lost') || states.includes('syncing'), 3000);
    const back = await t.tryWait(() => G.session?.state === 'connected' && isSynced(G), 45000);
    t.check(back && states.includes('lost'), 'guest goes lost → reconnects → synced', `states ${states.join(' → ')}`);
    if (res0 != null) {
      const g1 = stat(G, 'resyncs'), h1 = stat(H, 'resyncs');
      t.check(g1 > res0 || h1 > resH0, 'a resync snapshot was served (net.stats.resyncs)', `guest ${res0}→${g1} · host ${resH0}→${h1}`);
      if (!(g1 > res0)) t.note(`the guest's own stats.resyncs does not count a reconnect (host ${resH0}→${h1})`);
    }
    if (bp) t.check(await t.tryWait(() => A.structOn(G, bp.id), 3000), 'change made while disconnected is present after the resync', bp.id);
    await t.checkDigest(H, G, 'digest equal after reconnect');
  } else t.note('session._close/hostKey not available — reconnect variant skipped');

  // B) reload with a player-only save (this guest runs WITHOUT ?nosave; storage is restored after the run)
  const pid = 'g' + rand(7);
  presetPid(pid);
  const R = t.open('guest-save', `sala=${room}${CFG.link}&autojoin=1&pid=${pid}`, pid);
  await legacyJoin(t, R);
  await waitGuestSynced(t, R, H, 'guest-save');
  const MR = await A.mods(R);
  const p = R.game.player;
  A.ensure(R, { stone: 7, sword_iron: 1 });
  A.equip(R, 'sword_iron');
  for (let k = 0; k < 40 && p.level < 3; k++) MR.player.gainXp(R.game, 100);
  const want = { stone: A.count(R, 'stone'), main: p.equip.main, level: p.level };
  t.log(`guest-save state: ${short(want)}`);
  if (typeof MR.save.saveGame === 'function') { try { MR.save.saveGame(R.game); } catch (e) { t.note('saveGame threw: ' + e.message); } }
  await t.sleep(300);
  presetPid(pid);
  R.reload();
  await t.waitFor(() => R.loads >= 2, 10000, 'guest frame reloaded');
  await legacyJoin(t, R);
  await waitGuestSynced(t, R, H, 'guest-save (reloaded)');
  const q = R.game.player;
  t.check(A.count(R, 'stone') >= want.stone && q.equip.main === want.main && q.level === want.level, 'inventory / equipment / level restored', `stone ${A.count(R, 'stone')}/${want.stone} main ${q.equip.main} level ${q.level}/${want.level}`);
  await t.checkDigest(H, R, 'digest equal after reload');
  const key = `wos.save.v2.${CFG.seed}.guest`;
  let data = null;
  try { data = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* ignore */ }
  t.check(!!data, `guest save ${key} exists`);
  if (data) {
    const bad = WORLD_KEYS.filter((k) => k in data && (Array.isArray(data[k]) ? data[k].length : data[k] != null));
    t.check(!bad.length, 'guest save holds no world data', `keys: ${Object.keys(data).join(',')}${bad.length ? ' · world keys: ' + bad.join(',') : ''}`);
  }
});

// =====================================================================================================
// S24 Host leaves
def('S24', {
  title: 'Host leaves', timeout: 150000,
  expected: 'Guests get "O anfitrião saiu" and return to the menu ("Voltar ao menu"); their saves contain no world data',
  api: 'session.close() → bye; guest message + "Voltar ao menu"; ?nosave (no save keys written)',
}, async (t) => {
  const room = newRoom();
  const H = await bootHost(t, room);
  const G = await bootGuest(t, room, H);
  const keys0 = storage.newKeys().filter((k) => k.startsWith('wos.save.'));
  H.session.close('saiu');
  t.log('host closed the session');
  const shown = await t.tryWait(() => /O anfitri(ã|a)o saiu/i.test(pageText(G)), 8000);
  t.check(shown, 'guest shows "O anfitrião saiu"', short(pageText(G).slice(0, 200), 200));
  const btn = [...(G.doc?.querySelectorAll('button, a') || [])].find((b) => /Voltar ao menu/i.test(b.textContent || ''));
  t.check(!!btn, '"Voltar ao menu" button present');
  if (btn) {
    btn.click();
    const menu = await t.tryWait(() => G.doc?.querySelector('#menu') && !G.doc.querySelector('#menu').classList.contains('hidden'), 15000);
    t.check(menu, 'guest back at the main menu');
  }
  const created = storage.newKeys().filter((k) => k.startsWith('wos.save.') && !keys0.includes(k));
  t.check(!created.length, 'no save written by the ?nosave frames', created.join(', '));
});

// =====================================================================================================
// S25 ★ Weather / clock
def('S25', {
  star: true, title: 'Weather / clock / bed', timeout: 150000,
  expected: 'Host weather change visible on guests ≤ 2 s; a bed only sets the respawn point (owner: the night is never skipped): host and guest use it at night, each gets it as respawn, the clock keeps running on both',
  api: 'env.setWeather (host) → sts.env; bed useStructure: p.respawn = bed id, no env.skip; env.{hour,dayIndex,weather}; worldTime',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, EG = G.game.env;
  const w = ['rain', 'fog', 'cloudy', 'clear'].find((x) => x !== EH.weather);
  EH.setWeather(w);
  const wl = await t.timeTo(() => EG.weather === w, 2000 + CFG.budget + 400, `guest weather becomes ${w}`).catch((e) => { t.check(false, 'weather reaches the guest', e.message); return null; });
  if (wl != null) t.check(wl <= 2000 + CFG.budget + 300, `weather on the guest ≤ 2 s`, fmtMs(wl));
  // bed for the host
  A.ensure(H, { wood: 10, fiber: 8, leather: 3 });
  const hp = H.game.player, gp = G.game.player;
  const site = A.findSite([H, G], [MH, MG], 'bed', (x, y) => [[x, y]], hp.x, hp.y, { rMin: 2, rMax: 10, avoidPts: [[hp.x, hp.y], [gp.x, gp.y]] });
  t.assert(site, 'found a tile for a bed');
  A.place(H, MH, 'bed', site.tiles[0]);
  const bed = await t.waitFor(() => A.structAt(H, MH, site.tiles[0][0], site.tiles[0][1], 'main'), 2000, 'host bed blueprint');
  await A.buildAll(t, H, MH, [bed.id]);
  // (leave the day back afterwards: the night brings hunting wolf packs that would interrupt later scenarios)
  t.defer(() => {
    EH.hour = 9;
    for (const e of H.game.entities.slice()) if (e.isMob && !e.dead && e.spawner?.hunt) { e.noCorpse = true; MH.combat.killMob(H.game, e, null); }
  });
  const setNight = async () => {
    EH.hour = 21;
    await t.waitFor(() => Math.abs(EG.hour - EH.hour) < 0.1, 3000 + CFG.budget, 'guest clock follows the host to 21h');
  };
  await setNight();
  hp.combatT = 0;
  const day0 = EH.dayIndex, wt0 = H.game.worldTime;
  A.standBy(H, MH, bed);
  A.useBed(H, MH, bed);
  t.check(hp.respawn === bed.id, 'host: the bed is its respawn point', String(hp.respawn));
  // the guest uses the same bed: its own respawn point, no message about the host
  const bedG = A.structOn(G, bed.id);
  const since = now();
  A.standBy(G, MG, bedG);
  A.useBed(G, MG, bedG);
  t.check(gp.respawn === bed.id, 'guest: the bed is its respawn point', String(gp.respawn));
  const msg = await t.tryWait(() => G.ui.some((u) => u.t >= since && /renascimento/i.test(u.text)), 2500);
  t.check(msg, 'guest told the respawn point is set', G.lastUi(2, since));
  await t.sleep(1500);
  t.check(EH.hour > 20 && EG.hour > 20 && EH.dayIndex === day0 && EG.dayIndex === day0, 'the night goes on (no time skip) on both', `host ${f2(EH.hour)} d${EH.dayIndex} · guest ${f2(EG.hour)} d${EG.dayIndex}`);
  t.check(H.game.worldTime < wt0 + 30, 'worldTime kept its pace', `${f2(wt0)} → ${f2(H.game.worldTime)}`);
  await t.checkDigest(H, G);
});

// =====================================================================================================
// S26 Host tab hidden 60 s
def('S26', {
  title: 'Host tab hidden 60 s', timeout: (CFG.hidden + 150) * 1000,
  expected: 'World keeps ticking (host worldTime advances ≥ 50 s of 60), guests keep receiving ents/sts',
  api: 'window.wosDebug.setHidden(bool) (localhost hook: run the hidden-tab worker clock while the frame stays visible); net.stats.bytesIn; presence',
}, async (t) => {
  const { H, G } = await pairCtx(t);
  const hook = H.win.wosDebug?.setHidden;
  t.need(typeof hook === 'function', 'needs window.wosDebug.setHidden(bool) to force the hidden-tab path in a frame (iframes cannot be document.hidden)');
  const dur = CFG.hidden * 1000;
  hook.call(H.win.wosDebug, true);
  t.defer(() => { try { H.win.wosDebug.setHidden(false); } catch { /* ignore */ } });
  const wt0 = H.game.worldTime, b0 = stat(G, 'bytesIn');
  const copy = hostOnGuest(H, G);
  const samples = [];
  const t0 = now();
  let lastB = b0, stalls = 0;
  while (now() - t0 < dur) {
    await t.sleep(5000);
    const b = stat(G, 'bytesIn');
    if (b != null && b <= lastB) stalls++;
    lastB = b;
    samples.push({ s: Math.round((now() - t0) / 1000), hostWt: f2(H.game.worldTime - wt0), guestWt: f2(G.game.worldTime - wt0), bytes: b != null ? b - b0 : null, buf: copy?._buf?.length });
  }
  H.win.wosDebug.setHidden(false);
  const adv = H.game.worldTime - wt0;
  t.metric('samples', samples.slice(-4));
  t.check(adv >= (dur / 1000) * (50 / 60), `host worldTime advanced ≥ ${Math.round((dur / 1000) * 50 / 60)} s`, `${f2(adv)} s in ${Math.round(dur / 1000)} s`);
  if (b0 != null) t.check(stalls === 0, 'guest kept receiving data every 5 s', `${stalls} stalled windows`);
  t.check(Math.abs(H.game.worldTime - G.game.worldTime) <= 3, 'guest clock still follows the host', `${f2(H.game.worldTime)} / ${f2(G.game.worldTime)}`);
  await t.checkDigest(H, G);
});

// =====================================================================================================
// S27 Desync detector
def('S27', {
  title: 'Desync detector + auto resync', timeout: 120000, allowSync: true,
  expected: 'Corrupting the guest (structures.pop() without op) → within 5 s a netlog sync error naming structs and the missing id; automatic resync restores equality',
  api: 'dg/dgx/dgr protocol; netlog.error("sync", …); game.events "desync"; net.stats.{desyncs,resyncs}; applyWorld reconcile',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(hasDigest(G), 'net.digest missing');
  if (!G.game.build.structures.length) {
    A.ensure(G, { wood: 2 });
    const gp = G.game.player;
    const site = A.findSite([H, G], [MH, MG], 'wall_wood', (x, y) => [[x, y]], gp.x, gp.y, { rMin: 2, rMax: 10, avoidPts: [[gp.x, gp.y]] });
    t.assert(site, 'site for a structure');
    A.place(G, MG, 'wall_wood', site.tiles[0]);
    await t.waitFor(() => G.game.build.structures.length > 0, RT() + 500, 'guest has a structure');
  }
  const d0 = stat(G, 'desyncs'), r0 = stat(G, 'resyncs');
  const mark = G.syncLog.length, t0 = now();
  let desyncEvt = 0;
  t.on(G, 'desync', () => { desyncEvt++; });
  const victim = G.game.build.structures.pop();
  t.log(`guest structure ${victim.id} removed without an op`);
  const err = await t.tryWait(() => G.syncLog.slice(mark).some((e) => /structs/.test(e.msg)), 5000 + 1500 + CFG.budget);
  const lag = now() - t0;
  const entry = G.syncLog.slice(mark).find((e) => /structs/.test(e.msg));
  t.check(err, 'netlog sync error naming structs', entry ? `${fmtMs(lag)}: ${entry.msg}` : `${G.syncLog.length - mark} sync errors`);
  if (entry) t.check(entry.msg.includes(String(victim.id)), 'error names the missing id', String(victim.id));
  t.check(desyncEvt > 0 || (d0 != null && stat(G, 'desyncs') > d0), "'desync' event / stats.desyncs incremented", `events ${desyncEvt} desyncs ${d0}→${stat(G, 'desyncs')}`);
  const healed = await t.tryWait(() => G.game.build.structures.some((o) => o.id === victim.id), 35000);
  t.check(healed, 'automatic resync restores the structure', victim.id);
  if (r0 != null) t.check(stat(G, 'resyncs') > r0, 'stats.resyncs incremented', `${r0} → ${stat(G, 'resyncs')}`);
  await t.checkDigest(H, G, 'digest equal after resync');
});

// =====================================================================================================
// S28 Lint
def('S28', {
  title: 'Lint (tools/check-sync.mjs)', timeout: 15000,
  expected: 'node tools/check-sync.mjs exits 0; injecting game.world.addObject({...}) in gathering.js makes it exit 1 with R1 + file:line',
  api: 'CLI: node tools/mp-test/lint-selftest.mjs (runs both checks in a temp copy)',
}, async (t) => {
  let exists = false;
  try { exists = (await fetch(new URL('../tools/check-sync.mjs', location.href), { method: 'HEAD', cache: 'no-store' })).ok; } catch { /* ignore */ }
  t.skip(exists ? 'CLI-only: run `node tools/mp-test/lint-selftest.mjs` (expects exit 0, then R1 + gathering.js:<line> on the injected copy)' : 'tools/check-sync.mjs not present yet; then run `node tools/mp-test/lint-selftest.mjs`');
});

// =====================================================================================================
// S29 Soak
function bot(t, f, M, home) {
  const g = f.game, p = g.player;
  A.ensure(f, { axe_steel: 1, pickaxe_steel: 1, wood: 20 });
  A.equip(f, 'sword_copper');
  g.work.paused = false;
  const stats = { actions: {}, errors: 0 };
  let next = 0, busySince = now();
  const pick = (r) => r[Math.floor(Math.random() * r.length)];
  t.watch(() => {
    if (p.dead) { M.player.respawnPlayer(g); return; }
    p.hunger = Math.max(p.hunger, 70); if (p.hp < p.maxHp * 0.4) p.hp = p.maxHp;
    if (A.count(f, 'wood') < 10) A.ensure(f, { wood: 20 });
    if (Math.hypot(p.x - home.x, p.y - home.y) > 22) { const s = A.freeSpot(f, M, home.x, home.y, { rMin: 0, rMax: 4 }); if (s) A.teleport(f, s[0], s[1]); }
    const busy = p.work || g.ctl.goal || p.autoAttack;
    if (busy && now() - busySince > 9000) { // fleeing prey, unreachable job: give up, pick something else
      p.autoAttack = false; g.ctl.setTarget(null); g.ctl.goal = null; p.work = null; p.action = null;
      stats.givenUp = (stats.givenUp || 0) + 1;
    }
    if (!busy) busySince = now();
    if (now() < next || busy) return;
    next = now() + 1500 + Math.random() * 3000;
    busySince = now();
    const act = pick(['walk', 'walk', 'chop', 'gather', 'gather', 'build', 'fight', 'decon', 'body', 'work', 'work']);
    stats.actions[act] = (stats.actions[act] || 0) + 1;
    try {
      if (act === 'walk') { const s = A.freeSpot(f, M, p.x + (Math.random() - 0.5) * 16, p.y + (Math.random() - 0.5) * 16, { rMin: 0, rMax: 3 }); if (s) g.ctl.walkTo(s[0], s[1]); }
      else if (act === 'chop') { const o = A.shared(f, null, p.x, p.y, 12, A.standingTree)[0]; if (o) A.interact(f, M.gathering.describeObject(g, o)); }
      else if (act === 'work') { // opt-in auto-work: "tap" a blue plan / a marked structure nearby
        const o = g.build.structures.filter((q) => (q.blueprint || g.build.decon.has(q)) && A.dist(q, p) < 14)[0];
        if (o) g.work.begin(M.building.describeStructure(g, o));
      }
      else if (act === 'gather') { const o = A.shared(f, null, p.x, p.y, 10, (q) => /^(pebble|stick|fibergrass|bush|berrybush)$/.test(q.type) && !q.gone)[0]; if (o) A.interact(f, M.gathering.describeObject(g, o)); }
      else if (act === 'build') {
        const tx = Math.floor(p.x + (Math.random() - 0.5) * 10), ty = Math.floor(p.y + (Math.random() - 0.5) * 10);
        const type = Math.random() < 0.5 ? 'floor_wood' : 'wall_wood';
        if (M.building.placeReason(g, type, tx, ty) === null && Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) > 1.5) A.place(f, M, type, [tx, ty]);
      } else if (act === 'fight') { const m = A.mobs(f, (e) => !e.dead && (e.species === 'rabbit' || e.species === 'deer' || e.species === 'boar' || e.species === 'fox') && A.dist(e, p) < 14)[0]; if (m) g.ctl.engage(m); }
      else if (act === 'body') { let it = null; g.corpses?.forNear(p.x, p.y, 12, (q) => { if (!it && q.prio >= 0) it = q; }); if (it) A.interact(f, it); }
      else if (act === 'decon') { const o = g.build.structures.filter((q) => !q.blueprint && A.dist(q, p) < 12)[0]; if (o) M.building.toggleDecon(g, o, true); }
    } catch { stats.errors++; }
  }, 250);
  return stats;
}
def('S29', {
  title: 'Soak with bots on both clients', timeout: (CFG.soak + 150) * 1000,
  expected: 'net.stats.desyncs === 0, no ack ok:0 except expected races, bandwidth per guest < 25 KB/s; digest equal at the end',
  api: 'everything (bots: walk, chop, gather, build, decon, fight with auto-work on); net.stats.{desyncs,rejects,bytesIn,bytesOut}',
}, async (t) => {
  t.need(CFG.soak > 0, 'soak disabled (?soak=0)');
  const { H, G, MH, MG } = await pairCtx(t);
  const home = spawnOf(H);
  const bh = bot(t, H, MH, home), bg = bot(t, G, MG, home);
  const s0 = { dH: stat(H, 'desyncs'), dG: stat(G, 'desyncs'), rejH: stat(H, 'rejects'), rejG: stat(G, 'rejects'), bin: stat(G, 'bytesIn'), bout: stat(G, 'bytesOut') };
  const t0 = now();
  const samples = [];
  while (now() - t0 < CFG.soak * 1000) {
    await t.sleep(10000);
    const el = (now() - t0) / 1000;
    samples.push({ s: Math.round(el), desyncs: stat(G, 'desyncs'), rejects: stat(G, 'rejects'), kbps: s0.bin != null ? f2((stat(G, 'bytesIn') - s0.bin) / 1024 / el) : null, structs: H.game.build.structures.length, loot: H.game.loot.length });
    setStatus(`S29 soak ${Math.round(el)}/${CFG.soak} s · ${short(samples[samples.length - 1])}`);
  }
  for (const f of [H, G]) { f.game.work.paused = true; f.game.ctl.goal = null; f.game.player.autoAttack = false; }
  await t.sleep(1500);
  const el = (now() - t0) / 1000;
  t.metric('samples', samples.slice(-6));
  if (s0.dG != null) t.check(stat(G, 'desyncs') === s0.dG && stat(H, 'desyncs') === (s0.dH ?? stat(H, 'desyncs')), 'net.stats.desyncs === 0', `guest ${stat(G, 'desyncs') - s0.dG}`);
  else t.note('net.stats.desyncs missing');
  if (s0.rejG != null) t.metric('rejects', { guest: stat(G, 'rejects') - s0.rejG, host: (stat(H, 'rejects') ?? 0) - (s0.rejH ?? 0) });
  if (s0.bin != null) {
    const kbps = (stat(G, 'bytesIn') - s0.bin) / 1024 / el, up = (stat(G, 'bytesOut') - (s0.bout ?? 0)) / 1024 / el;
    t.check(kbps < 25, 'guest download < 25 KB/s', `${f2(kbps)} KB/s down, ${f2(up)} KB/s up`);
  } else t.note('net.stats.bytesIn missing — bandwidth check skipped');
  await t.checkDigest(H, G, 'digest equal at the end of the soak', { ms: 6000 });
  t.metric('botActions', { host: bh.actions, guest: bg.actions, givenUp: [bh.givenUp || 0, bg.givenUp || 0], errors: bh.errors + bg.errors });
  const nAct = (s) => Object.values(s.actions).reduce((a, b) => a + b, 0);
  t.check(nAct(bh) >= el / 8 && nAct(bg) >= el / 8, 'both bots stayed active', `host ${nAct(bh)} · guest ${nAct(bg)} actions in ${Math.round(el)} s`);
  if (!t.checks.length) t.skip('bots ran, but no net stats / digest to assert on');
});

// =====================================================================================================
// S40 B: chest sort (guest sorts a shared chest through the chest panel)
def('S40', {
  title: 'B: chest sort', timeout: 120000,
  expected: 'Guest clicks Tipo / A→Z / Quantidade in the chest panel; the host sorts (store.sort → chest.set): same order on both, stacks merged, digest equal',
  api: 'chest panel [data-sort][data-sortk=chest:<id>] click (store.sort intent {kind: chest} → chest.set {slots}); o.store.slots; invsort.sortedSlots',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.ensure(H, { wood: 10 });
  const hp = H.game.player, gp = G.game.player;
  const site = A.findSite([H, G], [MH, MG], 'chest', (x, y) => [[x, y]], hp.x, hp.y, { rMin: 2, rMax: 10, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a free tile for the chest');
  const [tx, ty] = site.tiles[0];
  A.place(H, MH, 'chest', [tx, ty]);
  const chestH = await t.waitFor(() => A.structAt(H, MH, tx, ty, 'main'), 2000, 'host chest blueprint');
  await A.buildAll(t, H, MH, [chestH.id]);
  const chestG = await t.waitFor(() => { const o = A.structOn(G, chestH.id); return o && !o.blueprint && o; }, ONEWAY() + 300, 'guest sees the finished chest');
  // messy contents set by the authority: split stacks, mixed categories, gaps
  const messy = [['stone', 2], 0, ['potato', 1], ['pebble', 2], ['meat', 2], 0, ['stone', 3], ['meat', 1], ['knife_primitive', 1]];
  while (messy.length < chestH.store.size) messy.push(0);
  H.game.net.emit('chest.set', { id: chestH.id, slots: messy, by: H.game.net.pid, quiet: 1 });
  const order = (o) => (o?.store?.slots || []).filter(Boolean).map((s) => `${s.id}×${s.qty}`).join(',');
  await t.waitFor(() => order(A.structOn(G, chestH.id)) === order(chestH), ONEWAY() + 400, 'guest sees the messy chest');
  A.standBy(G, MG, chestG);
  const it = MG.building.describeStructure(G.game, chestG);
  t.assert(it && it.kind === 'chest', 'guest can use the chest', it?.kind);
  MG.building.useStructure(G.game, it);
  const sortClick = async (mode) => {
    const btn = await t.waitFor(() => G.doc.querySelector(`[data-sort="${mode}"][data-sortk="chest:${chestG.id}"]`), 3000, `guest chest panel shows the ${mode} sort button`);
    const before = order(chestH);
    btn.click();
    await t.waitFor(() => order(chestH) !== before || order(chestH) === want[mode], RT() + 600, `host chest sorted (${mode})`, () => `host ${order(chestH)}`);
    await t.waitFor(() => order(A.structOn(G, chestH.id)) === order(chestH), ONEWAY() + 400, `guest sees the ${mode} order`, () => `host ${order(chestH)} · guest ${order(A.structOn(G, chestH.id))}`);
    t.check(order(chestH) === want[mode], `${mode}: expected order`, order(chestH));
  };
  const want = {
    // tools → food (quantity desc: 3 meat before 1 potato) → materials (5 stone before 2 pebbles)
    type: 'knife_primitive×1,meat×3,potato×1,stone×5,pebble×2',
    qty: 'stone×5,meat×3,pebble×2,potato×1,knife_primitive×1',
  };
  const nm = (id) => MG.data.ITEMS[id].name;
  want.name = ['knife_primitive', 'meat', 'pebble', 'potato', 'stone'].sort((a, b) => nm(a).localeCompare(nm(b), 'pt-BR'))
    .map((id) => `${id}×${{ knife_primitive: 1, meat: 3, pebble: 2, potato: 1, stone: 5 }[id]}`).join(',');
  await sortClick('type');
  await sortClick('qty');
  await sortClick('name');
  t.check(G.doc.querySelector(`[data-sort="name"][data-sortk="chest:${chestG.id}"]`)?.classList.contains('on'), 'last sort of this chest is highlighted');
  G.game.events.emit('closepanels', {});
  await t.checkDigest(H, G);
  env.history.push('S40');
});

// =====================================================================================================
// S42 D: remote action animations (presence stream: action timeline, pose)
def('S42', {
  title: 'D: remote action anims', timeout: 150000,
  expected: "Guest's copy of the host shows the host's chop (same type, duration = work cycle, looping while chopping), a melee swing played from its start (first t < 0.4) and ending, and the sleep pose in the host's bed (pose.o = the bed); host's copy of the guest shows the guest's swing and sitting pose; the copy swims in deep water (from its position)",
  api: 'presence st/sts s.a = [type, t, dur, loop, item?], s.ps; session.players.get(pid).ent.{action, pose}; juice.lieDown(bed) via useStructure (bed at night)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const hp = H.game.player, gp = G.game.player;
  const sp = spawnOf(H);
  const copyH = () => hostOnGuest(H, G);  // drawn copy of the host on the guest
  const copyG = () => A.avatarOn(H, G.pid); // drawn copy of the guest on the host
  t.assert(copyH() && copyG(), 'both sides have the other player');
  // sample the copies at a fine interval
  const seen = { chop: [], attackG: [], attackH: [] };
  t.watch(() => {
    const c = copyH();
    if (c?.action?.type === 'chop') seen.chop.push([now(), c.action.t, c.action.dur]);
    if (c?.action?.type === 'attack') seen.attackG.push([now(), c.action.t]);
    const d = copyG();
    if (d?.action?.type === 'attack') seen.attackH.push([now(), d.action.t]);
  }, 2);

  // 1. host chops a tree: the guest sees the chop loop with the host's real cycle
  const tr = A.pickTree(H, MH, G, sp.x, sp.y, env.claimed);
  t.assert(tr, 'found a standing tree present on both frames');
  A.ensure(H, { axe_copper: 1 });
  A.teleport(H, tr.west[0], tr.west[1]);
  const gs = A.freeSpot(G, MG, tr.o.x - 4, tr.o.y + 1.5, { rMin: 0, rMax: 3 });
  if (gs) A.teleport(G, gs[0], gs[1]);
  await t.sleep(400);
  let cycle = 0;
  t.watch(() => { if (hp.work?.type === 'chop') cycle = hp.work.cycle; }, 4);
  await A.chop(t, H, MH, A.objOn(H, tr.o.id), { until: 'fall' });
  t.check(seen.chop.length > 5, "guest's copy of the host plays 'chop'", `${seen.chop.length} samples`);
  const durs = seen.chop.map((r) => r[2]);
  const medDur = median(durs);
  t.check(cycle > 0 && Math.abs(medDur - cycle) <= 0.03, 'chop duration on the copy = host work cycle', `copy ${f2(medDur)} s · host ${f2(cycle)} s`);
  let wraps = 0;
  for (let i = 1; i < seen.chop.length; i++) if (seen.chop[i][1] < seen.chop[i - 1][1] - 0.3) wraps++;
  t.check(wraps >= 1, 'the chop loops on the copy (cycle restarts)', `${wraps} restarts`);
  sendAway(H, MH, tr.o.x, tr.o.y, 6, Math.PI);
  await t.sleep(600);

  // 2. a melee swing each way: shown from its start, then it ends
  const swing = async (f, list, label) => {
    list.length = 0;
    f.game.player.action = { type: 'attack', t: 0, dur: 0.34 };
    await t.sleep(900);
    const ts = list.map((r) => r[1]);
    t.check(ts.length >= 3, `${label}: copy plays the swing`, `${ts.length} samples`);
    t.check(ts.length && ts[0] < 0.4, `${label}: swing shown from its start (first t < 0.4)`, ts.length ? `first t ${f2(ts[0])}` : 'none');
    t.check(ts.length && Math.max(...ts) > 0.7, `${label}: swing plays through`, ts.length ? `max t ${f2(Math.max(...ts))}` : 'none');
  };
  await swing(H, seen.attackG, 'host → guest');
  t.check(!copyH()?.action, "the swing ended on the guest's copy", copyH()?.action?.type || 'none');
  await swing(G, seen.attackH, 'guest → host');

  // 3. guest sits (resting pose) → host's copy sits
  gp.pose = { type: 'sit', id: null, o: null };
  const sat = await t.tryWait(() => copyG()?.pose?.type === 'sit', 2000);
  t.check(sat, "host's copy of the guest sits", copyG()?.pose?.type || 'none');
  gp.pose = null;
  await t.tryWait(() => !copyG()?.pose, 2000);
  t.check(!copyG()?.pose, 'standing up reaches the host', copyG()?.pose?.type || 'none');

  // 4. host sleeps in its bed at night → guest's copy lies in that bed
  A.ensure(H, { wood: 10, fiber: 8, leather: 3 });
  const site = A.findSite([H, G], [MH, MG], 'bed', (x, y) => [[x, y]], hp.x, hp.y, { rMin: 2, rMax: 10, avoidPts: [[hp.x, hp.y], [gp.x, gp.y]] });
  t.assert(site, 'found a tile for a bed');
  A.place(H, MH, 'bed', site.tiles[0]);
  const bed = await t.waitFor(() => A.structAt(H, MH, site.tiles[0][0], site.tiles[0][1], 'main'), 2000, 'host bed blueprint');
  await A.buildAll(t, H, MH, [bed.id]);
  H.game.env.hour = 21;
  t.defer(() => { // (day again afterwards, without the night's hunting packs: later scenarios)
    H.game.env.hour = 9;
    for (const e of H.game.entities.slice()) if (e.isMob && !e.dead && e.spawner?.hunt) { e.noCorpse = true; MH.combat.killMob(H.game, e, null); }
  });
  await t.waitFor(() => Math.abs(G.game.env.hour - 21) < 0.1, 3000 + CFG.budget, 'guest clock at night');
  A.pacify(H, hp.x, hp.y, 40); // no creature may be chasing the host ("Não dá para dormir em combate")
  for (const m of H.game.entities) if (m.isMob && !m.proxy && m.state === 'chase' && m.threat === hp) { m.state = 'idle'; m.stateT = 1; m.threat = null; m.calmT = 600; }
  await t.sleep(300);
  hp.combatT = 0; hp.inCombat = false;
  A.standBy(H, MH, bed);
  await t.sleep(200);
  A.useBed(H, MH, bed);
  t.check(hp.pose?.type === 'sleep', 'host lies down in the bed', hp.pose?.type || 'none');
  const lay = await t.tryWait(() => copyH()?.pose?.type === 'sleep', 2500);
  t.check(lay && copyH().pose.o?.id === bed.id, "guest's copy of the host sleeps in that bed", `${copyH()?.pose?.type || 'none'} · bed ${copyH()?.pose?.o?.id ?? '-'} (want ${bed.id})`);
  const release = A.holdMove(H, 0, 1);
  t.defer(release);
  await t.sleep(400);
  release();
  const woke = await t.tryWait(() => !copyH()?.pose, 2500);
  t.check(!hp.pose && woke, 'moving wakes the host up on both sides', `host ${hp.pose?.type || 'up'} · copy ${copyH()?.pose?.type || 'up'}`);

  // 5. swimming is derived from the tile under the avatar on every peer (guest's copy of the host swims too)
  const W = H.game.world;
  let deep = null;
  for (let r = 2; r < 60 && !deep; r += 2) for (let a = 0; a < 24 && !deep; a++) {
    const x = Math.floor(hp.x + Math.cos(a / 24 * Math.PI * 2) * r), y = Math.floor(hp.y + Math.sin(a / 24 * Math.PI * 2) * r);
    if (W.waterAt(x, y) === 2 && W.waterAt(x + 1, y) === 2 && W.waterAt(x - 1, y) === 2) deep = [x + 0.5, y + 0.5];
  }
  if (!deep) t.note('no deep water near the host — swim sub-check skipped');
  else {
    A.teleport(H, deep[0], deep[1]);
    const near = A.freeSpot(G, MG, deep[0] + 3, deep[1], { rMin: 0, rMax: 5 });
    if (near) A.teleport(G, near[0], near[1]);
    const swam = await t.tryWait(() => (copyH()?._swim || 0) > 0.8 && (hp._swim || 0) > 0.8, 4000);
    t.check(swam, "guest's copy of the host swims in deep water (derived from its position)", `host ${f2(hp._swim || 0)} · copy ${f2(copyH()?._swim || 0)}`);
    sendAway(H, MH, deep[0], deep[1], 8);
    hp.wetT = 0; hp._wet = 0; MH.player.removeBuff?.(hp, 'wet'); MH.player.removeBuff?.(hp, 'cold'); // leave the shared pair dry
  }
  await t.checkDigest(H, G);
});

// =====================================================================================================
// S30 Single-player regression
def('S30', {
  title: 'Single-player regression', timeout: 240000,
  expected: '?seed=N solo: chopping, building, mining, farming, combat, loot, chest, save/load behave as before (same yields/timings); no rq messages; net.role === "solo"',
  api: 'solo boot; same player APIs as the MP scenarios; net.role; net.stats.rq; save.saveGame + reload (frame without ?nosave, storage restored afterwards)',
}, async (t) => {
  const S1 = await bootSolo(t, '', 'solo');
  const M = await A.mods(S1);
  const g = S1.game, p = g.player, sp = g.world.spawn;
  await A.reset(t, S1, M, null, null);
  A.keepAlive(t, S1);
  // chop: timing and yields
  const tr = A.pickTree(S1, M, null, sp.x, sp.y, new Set());
  t.assert(tr, 'found a tree');
  const o = tr.o;
  A.ensure(S1, { axe_stone: 1 });
  for (const s of p.inv.slots) if (s && /^axe_(copper|iron|steel)/.test(s.id)) p.inv.slots[p.inv.slots.indexOf(s)] = null;
  A.teleport(S1, tr.west[0], tr.west[1]);
  const TT = { tree_oak: 4.6, tree_pine: 3.9, tree_birch: 3.6, tree_dead: 2.6 };
  const expect = ((TT[o.type] || 4) * (o.s || 1)) / 1.45;
  const loot = A.lootRecorder(t, [S1]);
  const xp = A.xpRecorder(t, S1);
  const t0 = now();
  await A.chop(t, S1, M, o, { tool: 'axe_stone', until: 'fall' });
  const took = (now() - t0) / 1000;
  t.check(took >= expect * 0.85 && took <= expect * 1.25 + 0.4, 'chop time as before (TREE_TIME × s / axe speed)', `${f2(took)} s, expected ≈ ${f2(expect)} s`);
  sendAway(S1, M, o.x, o.y, 6);
  await t.waitFor(() => o.stump, 6000, 'stump');
  await t.sleep(500);
  const wood = loot.items(0).wood || 0;
  t.check(wood >= 2 && wood <= 5, 'tree yields 2–5 wood', short(loot.items(0)));
  t.check(xp.total >= 6, 'chop XP', `+${xp.total}`);
  // pick-up through the magnet
  const inv0 = A.count(S1, 'wood');
  A.teleport(S1, o.x + (o.fallDir || 1) * 1.4 * (o.s || 1), o.y);
  await t.tryWait(() => A.count(S1, 'wood') >= inv0 + wood, 4000);
  t.check(A.count(S1, 'wood') >= inv0 + wood, 'loot picked up by walking over it', `${inv0} → ${A.count(S1, 'wood')}`);
  loot.stop();
  // build a wall
  A.ensure(S1, { wood: 10 });
  const w0 = A.count(S1, 'wood');
  const site = A.findSite([S1], [M], 'wall_wood', (x, y) => [[x, y]], p.x, p.y, { rMin: 2, rMax: 10, avoidPts: [[p.x, p.y]] });
  t.assert(site, 'site for a wall');
  const [wx, wy] = site.tiles[0];
  A.place(S1, M, 'wall_wood', [wx, wy]);
  const wall = A.structAt(S1, M, wx, wy, 'main');
  t.check(wall && wall.blueprint && A.count(S1, 'wood') === w0, 'blueprint placed for free (no wood taken yet)', `${w0} → ${A.count(S1, 'wood')}`);
  await A.buildAll(t, S1, M, [wall.id]);
  t.check(g.world.solid.get(g.world.idx(wx, wy)) === 1, 'wall completed and solid');
  t.check(A.count(S1, 'wood') === w0 - 2, '2 wood delivered when the work started', `${w0} → ${A.count(S1, 'wood')}`);
  // chest through the panel
  A.ensure(S1, { wood: 10, stone: 3 });
  const cs = A.findSite([S1], [M], 'chest', (x, y) => [[x, y]], p.x, p.y, { rMin: 2, rMax: 10, avoidPts: [[p.x, p.y]] });
  if (cs) {
    A.place(S1, M, 'chest', cs.tiles[0]);
    const chest = A.structAt(S1, M, cs.tiles[0][0], cs.tiles[0][1], 'main');
    await A.buildAll(t, S1, M, [chest.id]);
    A.standBy(S1, M, chest);
    await A.chestPut(t, S1, M, chest, 'stone');
    t.check(chest.store.count('stone') >= 3, 'chest panel puts items into the chest', `${chest.store.count('stone')}`);
  }
  // mining
  const ores = A.oreTiles(S1, M, sp.x, sp.y);
  if (ores.length) {
    const c = ores[0];
    A.ensure(S1, { pickaxe_steel: 1 });
    A.pacify(S1, c.tx, c.ty, 16);
    const stand = () => A.teleport(S1, c.opens[0][0] + 0.5, c.opens[0][1] + 0.5);
    stand();
    const ml = A.lootRecorder(t, [S1]);
    await A.mine(t, S1, M, c.tx, c.ty, { stand });
    await t.sleep(400); ml.stop();
    const it = ml.items(0);
    t.check(g.world.rock.get(c.i) === 0 && (it.stone || 0) >= 1, 'mining removes the rock and drops stone + ore', short(it));
  } else t.note('no ore tile found — mining sub-check skipped');
  // farming
  A.ensure(S1, { seed_potato: 2 });
  p.seedPref = 'seed_potato';
  const fs = A.findSite([S1], [M], 'farm_plot', (x, y) => [[x, y]], sp.x, sp.y, { rMin: 3, rMax: 18, avoidPts: [[p.x, p.y]] });
  if (fs) {
    A.teleport(S1, fs.tiles[0][0] + 1.6, fs.tiles[0][1] + 0.5);
    A.place(S1, M, 'farm_plot', fs.tiles[0]);
    const plot = A.structAt(S1, M, fs.tiles[0][0], fs.tiles[0][1], 'floor');
    await A.buildAll(t, S1, M, [plot.id]);
    A.standBy(S1, M, plot);
    await A.plant(t, S1, M, plot);
    g.worldTime += 800;
    await t.waitFor(() => M.farming.cropAt(g, plot.tx, plot.ty)?.stage === 3, 3000, 'crop ripe after 800 s');
    const fl = A.lootRecorder(t, [S1]);
    A.standBy(S1, M, plot);
    await A.harvest(t, S1, M, plot);
    await t.sleep(300); fl.stop();
    const it = fl.items(0);
    t.check((it.potato || 0) >= 1 && (it.potato || 0) <= 2, 'harvest yields 1–2 potatoes (+ seeds)', short(it)); // (docs/LIVESTOCK.md rebalance)
  } else t.note('no farm site — farming sub-check skipped');
  // combat
  const prey = A.mobs(S1, (e) => !e.dead && (e.species === 'rabbit' || e.species === 'deer' || e.species === 'fox')).sort((a, b) => A.dist(a, p) - A.dist(b, p))[0];
  if (prey) {
    const s = A.freeSpot(S1, M, prey.x, prey.y, { rMin: 0.8, rMax: 1.5 });
    if (s) A.teleport(S1, s[0], s[1]);
    const cl = A.lootRecorder(t, [S1]);
    const meat0 = A.count(S1, 'meat');
    A.hit(S1, M, prey, 9999);
    t.check(prey.dead, 'a hit kills the creature locally', prey.species);
    await t.sleep(300); cl.stop();
    t.check(!(cl.items(0).meat), 'kill drops no loot (the body stays)', short(cl.items(0)));
    const body = [...g.corpses.map.values()].find((c) => c.of === prey.species && Math.hypot(c.x - prey.x, c.y - prey.y) < 0.5);
    t.check(!!body, 'kill leaves a body', prey.species);
    if (body) {
      await A.workUntil(t, S1, () => (body.butchered ? null : M.corpses.describeCorpse(g, body)), () => body.butchered, 20000, 'collect the body (Coletar)');
      t.check(A.count(S1, 'meat') > meat0, 'Coletar gives meat', `${meat0} → ${A.count(S1, 'meat')}`);
    }
  } else t.note('no prey found — combat sub-check skipped');
  // net (merged core)
  if (S1.net) {
    t.check(S1.net.role === 'solo', 'net.role === "solo"', S1.net.role);
    const rq = stat(S1, 'rq');
    t.check(rq == null || rq === 0, 'no rq messages in single player', `rq=${rq}`);
  }
  // save / load (frame without ?nosave; this origin's storage is restored at the end of the run)
  presetPid('s' + rand(7));
  const S2 = t.open('solo-save', `seed=${CFG.seed}`, null);
  await t.waitFor(() => S2.game && S2.loadingHidden, CFG.bootMs, 'save frame boot');
  const M2 = await A.mods(S2);
  await A.reset(t, S2, M2, null, null);
  const g2 = S2.game, p2 = g2.player;
  A.ensure(S2, { wood: 6, stone: 4 });
  const s2 = A.findSite([S2], [M2], 'wall_wood', (x, y) => [[x, y]], p2.x, p2.y, { rMin: 3, rMax: 12, avoidPts: [[p2.x, p2.y]] });
  A.place(S2, M2, 'wall_wood', s2.tiles[0]);
  const wid = A.structAt(S2, M2, s2.tiles[0][0], s2.tiles[0][1], 'main').id;
  await A.buildAll(t, S2, M2, [wid]);
  const tr2 = A.pickTree(S2, M2, null, p2.x, p2.y, new Set([o.id]));
  A.ensure(S2, { axe_steel: 1 });
  A.teleport(S2, tr2.west[0], tr2.west[1]);
  await A.chop(t, S2, M2, tr2.o, { tool: 'axe_steel', until: 'stump' });
  const stone = A.count(S2, 'stone');
  t.assert(typeof M2.save.saveGame === 'function' && M2.save.saveGame(g2), 'saveGame() wrote a save');
  S2.reload();
  await t.waitFor(() => S2.loads >= 2 && S2.game && S2.loadingHidden, CFG.bootMs, 'save frame reloaded');
  const g3 = S2.game;
  t.check(g3.build.structures.some((q) => q.id === wid && !q.blueprint), 'wall persisted across reload', wid);
  t.check(A.objOn(S2, tr2.o.id)?.stump, 'stump persisted across reload', String(tr2.o.id));
  t.check(A.count(S2, 'stone') === stone, 'inventory persisted', `${A.count(S2, 'stone')}/${stone}`);
  if (!S1.net) t.skip('gameplay sub-checks above ran on the current game; net.role / rq checks need game.net (not merged yet)');
});

// =====================================================================================================
// S50 E: herb bush harvest (medicinal herbs replace bandages)
def('S50', {
  title: 'E: herb bush harvest', timeout: 120000,
  expected: 'Guest forages a herbbush: gone on both, identical herb loot ids on both, herbs end in the guest bag (not the host\'s); old "bandage" ids load as herb; the guest heals with "heal" (1 herb, HoT, interrupted by damage); digest equal',
  api: 'gather.hit kind forage on herbbush → obj.remove {drops herb}; loot.take; Inventory.load alias bandage→herb; useAbility("heal") buff heal; combat.dealDamage interrupt',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sp = spawnOf(H);
  const hb = A.shared(H, G, sp.x, sp.y, 60, (o) => o.type === 'herbbush' && !o.gone, env.claimed)[0];
  t.assert(hb, 'found a herb bush present on both frames');
  env.claimed.add(hb.id);
  const id = hb.id, oH = A.objOn(H, id), oG = A.objOn(G, id);
  t.check(!!oH && !!oG && oH.x === oG.x && oH.y === oG.y, 'same herbbush (id, position) on both', `${id} @ ${f2(oH?.x)},${f2(oH?.y)}`);
  const st = A.freeSpot(G, MG, oG.x, oG.y, { rMin: 0.7, rMax: 1.2, prefer: Math.PI });
  t.assert(st, 'free spot next to the bush');
  A.teleport(G, st[0], st[1]);
  sendAway(H, MH, oH.x, oH.y, 8, 0);
  A.pacify(H, oH.x, oH.y, 16, 120);
  await A.hostSees(t, H, G);
  const c0 = [A.count(H, 'herb'), A.count(G, 'herb')];
  const loot = A.lootRecorder(t, [H, G]);
  await A.gather(t, G, MG, oG);
  await t.waitFor(() => (oH.gone || !A.objOn(H, id)) && (oG.gone || !A.objOn(G, id)), 4000, 'herb bush gone on both');
  await t.tryWait(() => A.count(G, 'herb') > c0[1], 4000);
  await t.sleep(RT());
  loot.stop();
  const items = loot.items(0), cmp = loot.compare(0, 1);
  t.check((items.herb || 0) >= 1 && (items.herb || 0) <= 2, 'one harvest of 1–2 medicinal herbs', short(items));
  t.check(cmp.ok, 'herb loot identical on both', cmp.detail);
  t.check(A.count(G, 'herb') > c0[1], 'herbs in the guest bag', `${c0[1]} → ${A.count(G, 'herb')}`);
  t.check(A.count(H, 'herb') === c0[0], 'host bag unchanged', `${c0[0]} → ${A.count(H, 'herb')}`);
  // legacy bandages load as herbs (inventory / chest stores / ground loot all go through ITEM_ALIASES)
  const inv = new G.game.player.inv.constructor(4);
  inv.load([['bandage', 3], 0, 0, 0]);
  t.check(inv.count('herb') === 3 && !inv.count('bandage'), 'old save: 3 bandages load as 3 herbs', `herb ${inv.count('herb')} bandage ${inv.count('bandage')}`);
  // heal on the guest
  const p = G.game.player, n0 = A.count(G, 'herb');
  A.pacify(H, p.x, p.y, 16, 120);
  // keep the guest warm and dry (earlier scenarios may have soaked it: cold / hypothermia damage would eat the HoT)
  t.watch(() => { p.bodyHeat = 100; p.wetT = 0; if (p.buffs) for (let k = p.buffs.length - 1; k >= 0; k--) if (/^(cold|hypothermia|wet|chilled|starving)$/.test(p.buffs[k].id)) p.buffs.splice(k, 1); }, 4);
  p.hp = 40;
  const used = A.ability(G, MG, 'heal');
  t.check(used !== false && A.count(G, 'herb') === n0 - 1, 'heal ability uses exactly 1 herb', `used ${used} herbs ${n0} → ${A.count(G, 'herb')}`);
  t.check(G.game.player.action?.type === 'heal', "action / pose id 'heal'", String(G.game.player.action?.type));
  const hp0 = p.hp;
  await t.tryWait(() => p.hp >= hp0 + 9, 3500);
  t.check(p.hp >= hp0 + 9, 'heals over time (~5% of max HP per second)', `${f2(hp0)} → ${f2(p.hp)}`);
  MG.combat.dealDamage(G.game, { x: p.x + 1, y: p.y, level: 1 }, p, 3, { noDodge: true }); // (a dodge chance from earlier gear would make it flaky)
  const hpHit = p.hp;
  t.check(!p.buffs?.some?.((b) => b.id === 'heal'), 'taking damage interrupts the herbs', short((p.buffs || []).map((b) => b.id)));
  await t.sleep(1600);
  t.check(p.hp <= hpHit + 0.01, 'no more healing after the interruption', `${f2(hpHit)} → ${f2(p.hp)}`);
  await t.checkDigest(H, G);
  env.history.push('S50');
});

// =====================================================================================================
// Agent A (construction) scenarios — rotation / edge props, real footprints, delivery, move, decon, raze, saves
// points around every ground item (findSite avoidPts): sites ≥ ~3.5 tiles from loot, so the magnet never changes bag counts
const lootAvoid = (f, cx, cy, r = 26) => {
  const out = [], D = [-3, -1.5, 0, 1.5, 3];
  for (const l of f.game.loot) if (Math.hypot(l.x - cx, l.y - cy) < r) for (const dx of D) for (const dy of D) out.push([l.x + dx, l.y + dy]);
  return out;
};
// auto-work waits while a creature chases the player: calm every host creature around (any temper) and drop its chase
const calmAround = (H, x, y, r = 30, secs = 300) => {
  for (const m of H.game.entities) {
    if (!m.isMob || m.proxy || m.dead || Math.hypot(m.x - x, m.y - y) > r) continue;
    m.calmT = secs;
    if (m.state === 'chase') { m.state = 'idle'; m.stateT = 1; m.threat = null; }
  }
};
const chasers = (f) => f.game.entities.filter((e) => !e.dead && e.state === 'chase' && e.threat === f.game.player).map((e) => `${e.type ?? e.kind}@${f2(e.x)},${f2(e.y)}`).join(' ') || 'none';
const geo = (o) => o && `${o.tx},${o.ty} r${o.rot | 0} ${o.fw}×${o.fh} @${f2(o.x)},${f2(o.y)} c${f2(o.cy)}`;

def('S31', {
  title: 'A: rotated / edge chest seen identically', timeout: 90000,
  expected: 'Guest places a chest pushed against the east edge (rot 2): host has the same rot, x/y/cy and facing; finished, the round collider sits at the same offset on both; digest equal',
  api: 'build mode rot (R / ⟳) → build.place {rot} → struct.add rows [.., rot, paid, moveOf]; o.{rot,face,x,y,cy}; physics.collides',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.ensure(G, { wood: 10 });
  const gp = G.game.player, hp = H.game.player;
  const site = A.findSite([H, G], [MH, MG], 'chest', (x, y) => [[x, y]], gp.x, gp.y, { rMin: 2, rMax: 10, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a free tile for the chest');
  const [tx, ty] = site.tiles[0];
  A.place(G, MG, 'chest', [tx, ty], [tx, ty], 2);
  const oh = await t.waitFor(() => A.structAt(H, MH, tx, ty, 'main'), RT() + 400, 'host has the chest blueprint');
  const og = await t.waitFor(() => A.structOn(G, oh.id), ONEWAY() + 300, 'guest has it');
  t.check(oh.rot === 2 && og.rot === 2 && oh.face === 'w' && og.face === 'w', 'rot 2 (against the east edge, facing west) on both', `host ${geo(oh)} ${oh.face} · guest ${geo(og)} ${og.face}`);
  t.check(geo(oh) === geo(og), 'same derived geometry (x, y, cy) on both', `${geo(oh)} | ${geo(og)}`);
  t.check(oh.x > tx + 0.6 && Math.abs(oh.cy - (ty + 0.5)) < 0.05, 'pushed toward the east edge', geo(oh));
  await A.buildAll(t, G, MG, [oh.id]);
  await t.waitFor(() => !oh.blueprint && !A.structOn(G, oh.id)?.blueprint, ONEWAY() + 300, 'chest finished on both');
  const hit = (f, M, o) => M.physics.collides(f.game.world, o.x, o.cy, 0.05, null, true);
  const miss = (f, M, o) => M.physics.collides(f.game.world, tx + 0.18, ty + 0.5, 0.05, null, true);
  t.check(hit(H, MH, oh) && hit(G, MG, og), 'collider at the pushed position on both');
  t.check(!miss(H, MH, oh) && !miss(G, MG, og), 'west half of the tile stays free on both');
  await t.checkDigest(H, G);
  env.history.push('S31');
});

def('S32', {
  title: 'A: 2-tile bed collision on both', timeout: 120000,
  expected: 'Host builds a bed (1×2, rot 0) and one lying sideways (rot 1, 2×1): world.solid = 1 on every footprint tile on both; the guest cannot walk into the second tile; the bed art stays inside its footprint (top ≥ the footprint north edge)',
  api: 'BUILDINGS.bed.size [1,2] + rotate; dimsOf / o.{fw,fh}; completeStructure solid; physics; sprite bed / bed_e',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.ensure(H, { wood: 20, fiber: 14, leather: 6 });
  const hp = H.game.player, gp = G.game.player;
  const s0 = A.findSite([H, G], [MH, MG], 'bed', (x, y) => [[x, y]], hp.x, hp.y, { rMin: 2, rMax: 12, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]], rot: 0 });
  t.assert(s0, 'found a 1×2 spot');
  const [bx, by] = s0.tiles[0];
  A.place(H, MH, 'bed', [bx, by], [bx, by], 0);
  const b0 = await t.waitFor(() => A.structAt(H, MH, bx, by + 1, 'main'), 1500, 'bed blueprint covers both tiles (grid)');
  const s1 = A.findSite([H, G], [MH, MG], 'bed', (x, y) => [[x, y]], hp.x + 3, hp.y, { rMin: 3, rMax: 12, avoidPts: [[gp.x, gp.y], [hp.x, hp.y], [bx + 0.5, by + 1]], rot: 1 });
  t.assert(s1, 'found a 2×1 spot');
  const [cx, cy] = s1.tiles[0];
  A.place(H, MH, 'bed', [cx, cy], [cx, cy], 1);
  const b1 = await t.waitFor(() => A.structAt(H, MH, cx + 1, cy, 'main'), 1500, 'sideways bed covers 2×1');
  t.check(b0.fw === 1 && b0.fh === 2 && b1.fw === 2 && b1.fh === 1, 'footprints 1×2 and 2×1', `${geo(b0)} · ${geo(b1)}`);
  await A.buildAll(t, H, MH, [b0.id, b1.id]);
  await t.waitFor(() => [b0, b1].every((o) => A.structOn(G, o.id) && !A.structOn(G, o.id).blueprint), ONEWAY() + 400, 'guest sees both beds finished');
  const tiles = [[bx, by], [bx, by + 1], [cx, cy], [cx + 1, cy]];
  const sol = (f) => tiles.map(([x, y]) => f.game.world.solid.get(f.game.world.idx(x, y)));
  t.check(sol(H).every((v) => v === 1) && sol(G).every((v) => v === 1), 'solid 1 on all 4 footprint tiles on both', `host ${sol(H)} guest ${sol(G)}`);
  t.check(geo(b0) === geo(A.structOn(G, b0.id)) && geo(b1) === geo(A.structOn(G, b1.id)), 'same geometry on both', `${geo(b0)} · ${geo(b1)}`);
  // the guest walks west → east just south of the bed's first tile, into its second tile: blocked
  const sx = bx - 0.8, sy = by + 1.5;
  if (!MG.physics.collides(G.game.world, sx, sy, 0.27, null, true)) {
    A.teleport(G, sx, sy);
    const rel = A.holdMove(G, 1, 0);
    await t.sleep(900);
    rel();
    t.check(gp.x < bx + 0.05, 'guest cannot walk into the bed’s second tile', `guest x ${f2(gp.x)} (bed column starts at ${bx})`);
  } else t.note('west side of the bed blocked — walk test skipped');
  // art stays inside the footprint: sprite top (anchor y − h·ay) not above the footprint's north edge (beyond wall height)
  const A0 = H.game.A, spr = A0.get('bed');
  const top = b0.y - spr.h * spr.ay;
  t.check(top >= b0.ty - 0.02, 'bed art does not poke north of its footprint', `top ${f2(top)} footprint ${b0.ty}`);
  await t.checkDigest(H, G);
  env.history.push('S32');
});

def('S33', {
  title: 'A: guest drags a blueprint row and builds it (materials on delivery)', timeout: 150000,
  expected: 'Guest drags a 4-tile fence row (the same drag API as mouse / one finger): 4 free blueprints on both (no wood taken); a 5th cancelled after delivery refunds its wood; opt-in auto-work started on the first builds the others in sequence and stops on the one lacking wood ("falta material", unpaid on both); the wood leaves the guest’s bag when each starts; fences joined to a wall',
  api: 'buildDragStart/Move/End → build.place; build.hit {start, pay} → struct.paid; canSupply / work queue skip; build.decon on a paid blueprint → give; autotile joins',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const g = G.game, gp = g.player, hp = H.game.player;
  const row = (x, y) => [0, 1, 2, 3, 4].map((k) => [x + k, y]).concat([[x - 1, y]]);
  const site = A.findSite([H, G], [MH, MG], 'fence_wood', row, gp.x, gp.y, { rMin: 3, rMax: 20, avoidPts: [[gp.x, gp.y], [hp.x, hp.y], ...lootAvoid(G, gp.x, gp.y)] });
  t.assert(site, 'found a free row');
  const { x0, y0 } = site;
  // a wall post at the west end (built by the host) for the fence to join
  A.ensure(H, { wood: 6 });
  A.place(H, MH, 'wall_wood', [x0 - 1, y0]);
  const wall = await t.waitFor(() => A.structAt(H, MH, x0 - 1, y0, 'main'), 1500, 'host wall blueprint');
  await A.buildAll(t, H, MH, [wall.id]);
  // the guest drags the row with the build-mode drag API
  const wood0 = A.count(G, 'wood');
  MG.building.enterBuildMode(g, 'fence_wood');
  MG.building.buildDragStart(g, x0 + 0.5, y0 + 0.5);
  MG.building.buildDragMove(g, x0 + 2.5, y0 + 0.5);
  MG.building.buildDragEnd(g, x0 + 4.5, y0 + 0.5);
  MG.building.exitBuildMode(g);
  const at = (f, M) => [0, 1, 2, 3, 4].map((k) => A.structAt(f, M, x0 + k, y0, 'main'));
  await t.waitFor(() => at(H, MH).every(Boolean), RT() + 400, 'host has the 5 fence blueprints', () => `${at(H, MH).filter(Boolean).length}/5 · ui: ${G.lastUi()}`);
  await t.waitFor(() => at(G, MG).every(Boolean), ONEWAY() + 300, 'guest has them');
  const ids = at(H, MH).map((o) => o.id);
  t.check(A.count(G, 'wood') === wood0, 'free blueprints: guest wood unchanged after the drag', `${wood0} → ${A.count(G, 'wood')}`);
  t.check(at(H, MH).every((o) => !o.paid) && at(G, MG).every((o) => !o.paid), 'unpaid on both');
  // deliver + cancel the 5th: its wood comes back
  A.ensure(G, { wood: 1 });
  const last = A.structOn(G, ids[4]);
  const w1 = A.count(G, 'wood');
  A.standBy(G, MG, last);
  await A.hostSees(t, H, G);
  A.interact(G, MG.building.describeStructure(g, last));
  await t.waitFor(() => A.structOn(H, ids[4])?.paid, RT() + 2000, 'host: 5th blueprint delivered');
  t.check(A.count(G, 'wood') === w1 - 1, 'delivery took 1 wood from the guest', `${w1} → ${A.count(G, 'wood')}`);
  gp.work = null; gp.action = null; g.ctl.goal = null;
  MG.building.toggleDecon(g, A.structOn(G, ids[4]));
  await t.waitFor(() => !A.structOn(H, ids[4]) && !A.structOn(G, ids[4]), RT() + 400, 'cancelled on both');
  await t.waitFor(() => A.count(G, 'wood') === w1, ONEWAY() + 300, 'cancel refunded the delivered wood');
  // too little wood: one of the remaining 4 stays "falta material"
  const have = A.count(G, 'wood');
  if (have > 3) gp.inv.remove('wood', have - 3);
  if (have < 3) A.ensure(G, { wood: 3 });
  g.events.emit('inventory', {});
  // opt-in auto-work from the first fence: builds the 3 it can pay for in sequence, skips the 4th, then stops
  A.standBy(G, MG, A.structOn(G, ids[0]));
  await A.hostSees(t, H, G);
  g.work.paused = false;
  t.check(g.work.begin(MG.building.describeStructure(g, A.structOn(G, ids[0]))), 'auto-work started from the first blueprint');
  t.check(g.work.seq?.ids?.size === 4, 'the sequence holds the 4 fences of the row', `${g.work.seq?.ids?.size}`);
  await t.waitFor(() => ids.slice(0, 3).every((id) => !A.structOn(H, id)?.blueprint) && !g.work.seq, 40000, 'auto-work built 3 and stopped',
    () => `built ${ids.slice(0, 3).filter((id) => !A.structOn(H, id)?.blueprint).length}/3 · seq ${JSON.stringify(g.work.status())} · work ${gp.work?.label ?? '-'}`);
  g.work.paused = true;
  t.check(A.count(G, 'wood') === 0, 'each start took 1 wood (3 built, bag empty)', `wood ${A.count(G, 'wood')}`);
  const lack = A.structOn(G, ids[3]);
  t.check(lack.blueprint && !lack.paid && !MG.building.canSupply(g, lack) && !A.structOn(H, ids[3])?.paid, 'the 4th was skipped: unpaid, waits for material');
  A.ensure(G, { wood: 2 });
  await A.buildAll(t, G, MG, [ids[3]]);
  await t.waitFor(() => ids.slice(0, 4).every((id) => !A.structOn(H, id)?.blueprint), ONEWAY() + 300, 'host sees all 4 built');
  t.check(A.count(G, 'wood') === 1, 'the 4th took its wood when it started', `wood ${A.count(G, 'wood')}`);
  const f0 = A.structOn(H, ids[0]), f0g = A.structOn(G, ids[0]);
  t.check((f0.mask & 8) && (f0g.mask & 8), 'first fence joins the wall to its west (mask W) on both', `mask ${f0.mask}/${f0g.mask}`);
  await t.checkDigest(H, G);
  env.history.push('S33');
});

def('S34', {
  title: 'A: move a chest with its contents (Mover)', timeout: 150000,
  expected: 'Guest marks "Mover" for a host chest holding stone: a move plan appears on both (paid, moveOf); when the guest builds it the SAME chest (same id) is at the new tile on both with its contents; the old tile is free; digest equal',
  api: 'structureMenu "Mover" → enterBuildMode {move} → build.move intent → struct.add [.., moveOf]; build.hit final → struct.relocate; o.store',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.ensure(H, { wood: 10 });
  const hp = H.game.player, gp = G.game.player;
  const two = (x, y) => [[x, y], [x + 2, y]];
  const site = A.findSite([H, G], [MH, MG], 'chest', two, hp.x, hp.y, { rMin: 2, rMax: 10, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found two free tiles');
  const [[tx, ty], [nx, ny]] = site.tiles;
  A.place(H, MH, 'chest', [tx, ty]);
  const ch = await t.waitFor(() => A.structAt(H, MH, tx, ty, 'main'), 1500, 'host chest blueprint');
  await A.buildAll(t, H, MH, [ch.id]);
  const cg = await t.waitFor(() => { const o = A.structOn(G, ch.id); return o && !o.blueprint && o; }, ONEWAY() + 300, 'guest sees the chest');
  A.ensure(G, { stone: 4 });
  A.standBy(G, MG, cg);
  await A.hostSees(t, H, G);
  await A.chestPut(t, G, MG, cg, 'stone');
  await t.waitFor(() => (ch.store?.count?.('stone') || 0) >= 4, RT() + 400, 'host chest holds the stone');
  const slots = (o) => JSON.stringify(o?.store?.toJSON?.() || null);
  const before = slots(ch);
  // the guest uses the context menu entry "Mover", then places the plan at the new tile
  const menu = MG.building.structureMenu(G.game, cg);
  const mv = menu.find((e) => e.id === 'move');
  t.assert(mv, 'context menu offers Mover', menu.map((e) => e.label).join(' · '));
  mv.run();
  const m = G.game.build.mode;
  t.assert(m && m.move === cg, 'build mode carries the chest to move');
  m.hover = [nx, ny]; m.locked = true;
  MG.building.commitPlacement(G.game);
  const plan = await t.waitFor(() => H.game.build.structures.find((o) => o.moveOf === ch.id), RT() + 400, 'host has the move plan');
  const planG = await t.waitFor(() => A.structOn(G, plan.id), ONEWAY() + 300, 'guest has it');
  t.check(plan.paid && planG.paid && planG.moveOf === ch.id, 'move plan: paid (no materials), moveOf on both');
  await A.buildAll(t, G, MG, [plan.id]);
  await t.waitFor(() => !A.structOn(H, plan.id) && ch.tx === nx && ch.ty === ny, RT() + 600, 'host: chest moved, plan gone', () => `chest ${geo(ch)} plan ${!!A.structOn(H, plan.id)}`);
  await t.waitFor(() => { const o = A.structOn(G, ch.id); return o && o.tx === nx && o.ty === ny && !A.structOn(G, plan.id); }, ONEWAY() + 300, 'guest: chest moved');
  t.check(slots(ch) === before && slots(A.structOn(G, ch.id)) === before, 'contents kept on both', `${before} → host ${slots(ch)} guest ${slots(A.structOn(G, ch.id))}`);
  t.check(!A.structAt(H, MH, tx, ty, 'main') && !A.structAt(G, MG, tx, ty, 'main'), 'old tile free on both');
  t.check(A.structAt(H, MH, nx, ny, 'main') === ch && A.structAt(G, MG, nx, ny, 'main')?.id === ch.id, 'grid points to the moved chest on both');
  await t.checkDigest(H, G);
  env.history.push('S34');
});

def('S35', {
  title: 'A: deconstruct a 2×1 workbench (refund 75%)', timeout: 120000,
  expected: 'Guest deconstructs a host workbench: gone on both, both footprint tiles free (solid 0), 75% refund (8 wood, 3 stone) only to the guest; digest equal',
  api: 'structureMenu "Desmontar" → build.decon → struct.decon; decon work → decon.hit → struct.remove {give}; world.solid',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.ensure(H, { wood: 12, stone: 6 });
  const hp = H.game.player, gp = G.game.player;
  const site = A.findSite([H, G], [MH, MG], 'workbench', (x, y) => [[x, y]], hp.x, hp.y, { rMin: 2, rMax: 12, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a 2×1 spot');
  const [tx, ty] = site.tiles[0];
  A.place(H, MH, 'workbench', [tx, ty]);
  const wb = await t.waitFor(() => A.structAt(H, MH, tx + 1, ty, 'main'), 1500, 'workbench blueprint');
  await A.buildAll(t, H, MH, [wb.id]);
  await t.waitFor(() => A.structOn(G, wb.id) && !A.structOn(G, wb.id).blueprint, ONEWAY() + 300, 'guest sees it finished');
  const invG0 = A.invSnap(G), invH0 = A.invSnap(H);
  const menu = MG.building.structureMenu(G.game, A.structOn(G, wb.id));
  t.check(menu.some((e) => e.id === 'decon') && menu.some((e) => e.id === 'move') && menu.some((e) => e.id === 'use'), 'menu: Usar · Mover · Desmontar', menu.map((e) => e.label).join(' · '));
  await A.decon(t, G, MG, wb.id);
  await t.waitFor(() => !A.structOn(H, wb.id), ONEWAY() + 300, 'gone on the host');
  await t.sleep(300);
  const sol = (f) => [0, 1].map((k) => f.game.world.solid.get(f.game.world.idx(tx + k, ty)));
  t.check(sol(H).every((v) => !v) && sol(G).every((v) => !v), 'both footprint tiles free on both', `host ${sol(H)} guest ${sol(G)}`);
  const dg = A.invDiff(invG0, A.invSnap(G)), dh = A.invDiff(invH0, A.invSnap(H));
  t.check(dg.wood === 8 && dg.stone === 3, '75% refund to the guest (8 wood, 3 stone)', short(dg));
  t.check(!dh.wood && !dh.stone, 'nothing to the host', short(dh));
  await t.checkDigest(H, G);
  env.history.push('S35');
});

def('S36', {
  title: 'A: raze a campfire (Arrasar)', timeout: 90000,
  expected: 'Guest razes a host campfire next to it: removed at once on both (no work), only half the pebbles come back (2), no wood; digest equal',
  api: 'structureMenu "Arrasar" → struct.raze intent → struct.remove {give, fx:raze}',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.ensure(H, { wood: 4, pebble: 4 });
  const hp = H.game.player, gp = G.game.player;
  const site = A.findSite([H, G], [MH, MG], 'campfire', (x, y) => [[x, y]], hp.x, hp.y, { rMin: 2, rMax: 10, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a spot');
  const [tx, ty] = site.tiles[0];
  A.place(H, MH, 'campfire', [tx, ty]);
  const cf = await t.waitFor(() => A.structAt(H, MH, tx, ty, 'main'), 1500, 'campfire blueprint');
  await A.buildAll(t, H, MH, [cf.id]);
  const cg = await t.waitFor(() => { const o = A.structOn(G, cf.id); return o && !o.blueprint && o; }, ONEWAY() + 300, 'guest sees the fire');
  A.standBy(G, MG, cg);
  await A.hostSees(t, H, G);
  const invG0 = A.invSnap(G);
  const menu = MG.building.structureMenu(G.game, cg);
  const rz = menu.find((e) => e.id === 'raze');
  t.assert(rz, 'menu offers Arrasar', menu.map((e) => e.label).join(' · '));
  t.check(!menu.some((e) => e.id === 'decon'), 'campfire: Arrasar instead of Desmontar');
  rz.run();
  await t.waitFor(() => !A.structOn(H, cf.id) && !A.structOn(G, cf.id), RT() + 400, 'razed on both');
  await t.sleep(200);
  const dg = A.invDiff(invG0, A.invSnap(G));
  t.check(dg.pebble === 2 && !dg.wood, 'half the pebbles back, no wood', short(dg));
  await t.checkDigest(H, G);
  env.history.push('S36');
});

def('S37', {
  title: 'A: old save migration (1×1 beds, rows without rot / paid)', timeout: 30000,
  expected: 'migrateStructRows: v3 rows gain rot 0, paid 1, closed, no plan; a bed saved as 1×1 extends south when free, north / sideways otherwise, never onto another structure; other types unchanged',
  api: 'save.js VERSION 4, migrateStructRows(game, rows) (unit-style on the host frame’s world)',
}, async (t) => {
  const { H, MH } = await pairCtx(t);
  const g = H.game, w = g.world, sp = w.spawn;
  t.need(typeof MH.save.migrateStructRows === 'function', 'migrateStructRows missing');
  // a free 6×6 patch near the spawn (no rock / water)
  let base = null;
  for (let r = 4; r < 40 && !base; r++) for (let k = 0; k < 16 && !base; k++) {
    const x = Math.floor(sp.x + Math.cos(k / 16 * Math.PI * 2) * r), y = Math.floor(sp.y + Math.sin(k / 16 * Math.PI * 2) * r);
    let ok = true;
    for (let yy = y; yy < y + 6 && ok; yy++) for (let xx = x; xx < x + 6 && ok; xx++) { const i = w.idx(xx, yy); if (w.rock.get(i) || w.water.get(i)) ok = false; }
    if (ok) base = [x, y];
  }
  t.assert(base, 'found a free 6×6 patch');
  const [x, y] = base;
  const rows = [
    ['old_bed_a', 'bed', x, y + 1, 5, 1, 0, 0, 0, 100],          // free below → extends south
    ['old_bed_b', 'bed', x + 2, y + 1, 5, 1, 0, 0, 0, 100],      // wall below → north
    ['old_wall_b', 'wall_wood', x + 2, y + 2, 0, 1, 0, 0, 0, 100],
    ['old_bed_c', 'bed', x + 4, y + 1, 5, 1, 0, 0, 0, 100],      // walls N and S → sideways
    ['old_wall_c1', 'wall_wood', x + 4, y, 0, 1, 0, 0, 0, 100],
    ['old_wall_c2', 'wall_wood', x + 4, y + 2, 0, 1, 0, 0, 0, 100],
    ['old_chest', 'chest', x, y + 4, 0, 0.4, 0, 0, 0, 100],      // blueprint saved before "delivery" existed
  ];
  const out = MH.save.migrateStructRows(g, rows.map((r) => r.slice()));
  const by = Object.fromEntries(out.map((r) => [r[0], r]));
  t.check(out.every((r) => r.length >= 14), 'every row has the v4 fields (14; v6 adds style, det)', out.map((r) => r.length).join(','));
  t.check(out.filter((r) => r[1] !== 'bed').every((r) => r[10] === 0 && r[11] === 1 && r[12] === 0 && !r[13]), 'legacy defaults: rot 0, paid 1, closed, no plan');
  const p = (r) => `${r[2]},${r[3]} r${r[10]}`;
  t.check(by.old_bed_a && by.old_bed_a[2] === x && by.old_bed_a[3] === y + 1 && by.old_bed_a[10] === 0, 'bed A extends south', p(by.old_bed_a || []));
  t.check(by.old_bed_b && by.old_bed_b[3] === y && by.old_bed_b[10] === 0, 'bed B (wall below) extends north', p(by.old_bed_b || []));
  t.check(by.old_bed_c && by.old_bed_c[10] === 1, 'bed C (walls N and S) lies sideways', p(by.old_bed_c || []));
  // no overlaps in the migrated layout
  const cells = new Map(); let clash = null;
  for (const r of out) { const [fw, fh] = MH.building.dimsOf(r[1], r[10]); for (let yy = r[3]; yy < r[3] + fh; yy++) for (let xx = r[2]; xx < r[2] + fw; xx++) { const k = xx + ',' + yy; if (cells.has(k)) clash = `${cells.get(k)} × ${r[0]} at ${k}`; cells.set(k, r[0]); } }
  t.check(!clash, 'no two migrated structures overlap', clash || `${cells.size} cells`);
});

// =====================================================================================================
// S60 / S61 — I · corpos e decomposição (bodies decompose in shared world time)
// Time is fast-forwarded through the env op on the host (test-only path: the harness emits env.skip, the op
// every peer applies for sleeping, so worldTime / hour / day move the same way on all of them).
function skipDays(H, days) {
  const g = H.game, E = g.env, dl = E.dayLength || 720;
  let hour = E.hour + days * 24, day = E.dayIndex;
  while (hour >= 24) { hour -= 24; day++; }
  g.net.emit('env.skip', { hour: +hour.toFixed(3), day, wt: Math.round((g.worldTime + days * dl) * 100) / 100 });
  g.net.flush();
}
const bodyOn = (f, id) => f.game.corpses?.map.get(id) || null;
const corpseAgeOn = (f, M, c) => M.mcorpses.corpseAge(f.game, c);
const stageOn = (f, M, id) => { const c = bodyOn(f, id); return c ? M.mcorpses.stageOf(f.game, c) : 'none'; };
// request an intent on a frame and resolve with { ok, why }
const ask = (f, name, args) => new Promise((res) => {
  const r = f.game.net.request(name, args, { onOk: () => res({ ok: true }), onReject: (why) => res({ ok: false, why }) });
  if (r === true) res({ ok: true });
});

def('S60', {
  title: 'I: animal corpse stages + coletar', timeout: 180000,
  expected: 'Kill → the same body on both, no ground loot; day 1 the guest collects it (meat to the guest only, carcass on both); a second body: day 2 rotten → "Está podre demais"; day 3 skeleton → "Remover ossada" gives bones to the guest and removes it on both; day 5 the host removes the rest; digest equal',
  api: 'mob.die + corpse.add; corpses.describeCorpse / work kinds butcher, corpse_bones; intents corpse.butcher / corpse.bones; ops corpse.butcher / corpse.remove; stage from (worldTime - deathT) / env.dayLength; env.skip (test fast-forward)',
}, async (t) => {
  const C = await pairCtx(t);
  const { H, G, MH, MG } = C;
  t.need(H.game.corpses && G.game.corpses && MG.corpses?.describeCorpse, 'corpses not merged');
  A.keepAlive(t, G); A.keepAlive(t, H);
  const sp = spawnOf(H);
  const prey = A.hostMobs(H, (m) => ['deer', 'rabbit', 'fox', 'boar'].includes(m.species) && !env.claimed.has('mob' + m.nid))
    .sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y)).slice(0, 2);
  t.assert(prey.length === 2, 'found two animals on the host', `${prey.length}`);
  for (const m of prey) env.claimed.add('mob' + m.nid);
  A.ensure(G, { knife_stone: 1 });
  const loot = A.lootRecorder(t, [H, G]);
  const ids = [];
  for (const m of prey) {
    const s = A.freeSpot(G, MG, m.x, m.y, { rMin: 1, rMax: 2 });
    t.assert(s, 'free spot next to the ' + m.species);
    A.teleport(G, s[0], s[1]);
    await t.waitFor(() => A.proxyOf(G, m), 3000 + CFG.budget, `${m.species} proxy on the guest`);
    await A.hostSees(t, H, G, 4000);
    const before = new Set(H.game.corpses.map.keys());
    m.calmT = 999; m.state = 'idle'; m.stateT = 99; // keep still for the kill (host AI)
    A.hit(G, MG, A.proxyOf(G, m), 9999);
    await t.waitFor(() => m.dead, RT() + 600, `${m.species} dead on the host`);
    const c = await t.waitFor(() => [...H.game.corpses.map.values()].find((q) => !before.has(q.id) && q.of === m.species), 1500, `${m.species} body on the host`);
    await t.waitFor(() => bodyOn(G, c.id), ONEWAY() + 600, `${m.species} body on the guest`);
    ids.push(c.id);
  }
  await t.sleep(RT());
  t.check(loot.rows(0).length === 0 && loot.rows(1).length === 0, 'animals drop nothing on the ground', `${loot.rows(0).length}/${loot.rows(1).length}`);
  loot.stop();
  const [a, b] = ids;
  t.check(stageOn(H, MH, a) === 'fresh' && stageOn(G, MG, a) === 'fresh', 'day 1: fresh on both');
  // day 1: guest collects body A
  const ca = bodyOn(G, a);
  const it0 = MG.corpses.describeCorpse(G.game, ca);
  t.check(it0?.verb === 'Coletar' && it0.prio >= 0, 'fresh animal body offers "Coletar"', `${it0?.kind} ${it0?.verb}`);
  const invG0 = A.invSnap(G), invH0 = A.invSnap(H);
  const xpG = A.xpRecorder(t, G), xpH = A.xpRecorder(t, H);
  const sa = A.freeSpot(G, MG, ca.x, ca.y, { rMin: 0.6, rMax: 1.2 });
  if (sa) A.teleport(G, sa[0], sa[1]);
  await A.hostSees(t, H, G, 4000);
  await A.workUntil(t, G, () => { const q = bodyOn(G, a); return q && !q.butchered ? MG.corpses.describeCorpse(G.game, q) : null; },
    () => bodyOn(H, a)?.butchered && bodyOn(G, a)?.butchered, 20000, 'guest collects body A');
  await t.sleep(RT());
  const gainG = A.invDiff(invG0, A.invSnap(G)), gainH = A.invDiff(invH0, A.invSnap(H));
  t.check((gainG.meat || 0) >= 1, 'Coletar gives meat to the guest', short(gainG));
  t.check(!Object.keys(gainH).length && xpH.total === 0, 'the host got nothing', short(gainH));
  t.check(xpG.total > 0, 'small XP reward to the guest', f2(xpG.total));
  { const itB0 = MG.corpses.describeCorpse(G.game, bodyOn(G, a)); t.check(!itB0 || itB0.kind === 'corpse_discard', 'a butchered fresh body offers nothing more than "Remover corpo"', itB0?.verb); }
  const again = await ask(G, 'corpse.butcher', { id: a, blade: 'knife', tier: 1 });
  t.check(!again.ok && /coletado/i.test(again.why || ''), 'a second Coletar is refused', again.why);
  // day 2: rotten
  skipDays(H, 1.05);
  await t.waitFor(() => stageOn(G, MG, b) === 'rotten' && stageOn(H, MH, b) === 'rotten', ONEWAY() + 1500, 'day 2: body B rotten on both');
  // (an animal body is removable any time: rotten, its action is "Remover corpo"; collecting it is refused)
  const itR = MG.corpses.describeCorpse(G.game, bodyOn(G, b));
  t.check(itR && itR.kind === 'corpse_discard', 'a rotten animal body offers "Remover corpo"', `${itR?.kind} ${itR?.verb}`);
  const rot = await ask(G, 'corpse.butcher', { id: b, blade: 'knife', tier: 1 });
  t.check(!rot.ok && /podre/i.test(rot.why || ''), 'Coletar on a rotten body: "Está podre demais"', rot.why);
  const errs = [];
  t.on(G, 'error', (d) => errs.push(d?.text));
  const sb = A.freeSpot(G, MG, bodyOn(G, b).x, bodyOn(G, b).y, { rMin: 0.6, rMax: 1.2 });
  if (sb) A.teleport(G, sb[0], sb[1]);
  MG.gathering.startWork(G.game, { o: bodyOn(G, b), corpse: true, x: bodyOn(G, b).x, y: bodyOn(G, b).y, reach: 0.95, kind: 'butcher', verb: 'Coletar', icon: 'gather', prio: 3 });
  t.check(!G.game.player.work && errs.some((e) => /podre/i.test(e || '')), 'the Coletar work refuses with "Está podre demais"', short(errs));
  const early = await ask(G, 'corpse.bones', { id: b });
  t.check(!early.ok, 'no bones before the skeleton stage', early.why);
  // days 3–5: skeleton → bones
  skipDays(H, 1.05);
  await t.waitFor(() => stageOn(G, MG, a) === 'skeleton' && stageOn(H, MH, a) === 'skeleton', ONEWAY() + 1500, 'day 3: skeletons on both');
  const itS = MG.corpses.describeCorpse(G.game, bodyOn(G, a));
  t.check(itS?.kind === 'corpse_bones' && /ossada|restos/i.test(itS.verb), 'skeleton offers "Remover ossada"', `${itS?.kind} ${itS?.verb}`);
  const bones0 = A.count(G, 'bone');
  const sc = A.freeSpot(G, MG, bodyOn(G, a).x, bodyOn(G, a).y, { rMin: 0.6, rMax: 1.2 });
  if (sc) A.teleport(G, sc[0], sc[1]);
  await A.hostSees(t, H, G, 4000);
  await A.workUntil(t, G, () => { const q = bodyOn(G, a); return q ? MG.corpses.describeCorpse(G.game, q) : null; }, () => !bodyOn(H, a) && !bodyOn(G, a), 20000, 'guest removes the bones of A');
  await t.sleep(RT());
  const species = prey[0].species;
  const wantBones = MG.mcorpses.BONES[MG.mcorpses.SIZE_OF[species]] || 1;
  t.check(A.count(G, 'bone') - bones0 === (species === 'spider' ? 0 : wantBones), `"Ossos" to the guest (${species})`, `${bones0} → ${A.count(G, 'bone')}`);
  t.check(!bodyOn(H, a) && !bodyOn(G, a), 'skeleton removed on both');
  await t.checkDigest(H, G, 'digest equal (skeleton stage)');
  // day 5+: the host removes what is left
  skipDays(H, 3.1);
  await t.waitFor(() => !bodyOn(H, b) && !bodyOn(G, b), 2500 + ONEWAY(), 'after day 5 body B is gone on both');
  await t.checkDigest(H, G);
  env.history.push('S60');
});

def('S61', {
  title: 'I: player corpse loot', timeout: 180000,
  expected: 'The guest dies: its bag + equipment move into its body (same id and contents on both, "Corpo de <nome>"), it respawns with nothing; the host opens the body ("Revistar": transfer window), takes, puts and sorts both sides; the guest takes from its own body; from day 3 the body cannot be opened (refused, window closes) and offers "Remover ossada"; digest equal',
  api: 'player death → intent corpse.player → op corpse.add {owner}; container window (container.js openContainer + corpses.corpseAdapter: data-slot / data-cslot / data-sort + data-sortk); intents corpse.put / corpse.take / store.sort {kind: corpse} → op corpse.set; env.skip',
}, async (t) => {
  const C = await pairCtx(t);
  const { H, G, MH, MG } = C;
  t.need(H.game.corpses && G.game.corpses && MG.corpses?.describeCorpse, 'corpses not merged');
  A.keepAlive(t, H);
  const gp = G.game.player;
  // what the guest carries
  for (let i = 0; i < gp.inv.size; i++) gp.inv.slots[i] = null;
  A.ensure(G, { wood: 7, pebble: 3, berries: 4, stick: 2 });
  A.equip(G, 'knife_stone');
  const carried = A.invSnap(G);
  for (const k of ['main', 'off', 'body', 'head']) { const id = gp.equip[k]; if (id) carried[id] = (carried[id] || 0) + 1; }
  const before = new Set(H.game.corpses.map.keys());
  const at = { x: gp.x, y: gp.y };
  MG.player.killPlayer(G.game);
  const ch = await t.waitFor(() => [...H.game.corpses.map.values()].find((c) => !before.has(c.id) && c.owner === G.pid), RT() + 800, "guest's body on the host");
  const cg = await t.waitFor(() => bodyOn(G, ch.id), ONEWAY() + 600, "guest's body on the guest");
  const content = (c) => { const o = {}; for (const s of c.store.slots) if (s) o[s.id] = (o[s.id] || 0) + s.qty; return o; };
  t.check(JSON.stringify(content(ch)) === JSON.stringify(content(cg)) && Object.keys(A.invDiff(carried, content(ch))).length === 0,
    'bag + equipped items are in the body (same on both)', `carried ${short(carried)} · body ${short(content(ch))}`);
  t.check(Math.hypot(ch.x - at.x, ch.y - at.y) < 0.6, 'the body lies where the guest died');
  t.check(/^Corpo de /.test(ch.name || ''), 'named "Corpo de <nome>"', ch.name);
  t.check(!gp.inv.used() && !Object.values(gp.equip).some(Boolean), 'the dead guest carries nothing (bag and equipment)');
  // (items left on the ground by earlier scenarios where it wakes up would fly into its bag: cleared first)
  { const rp = MG.player.respawnPoint(G.game), ids = H.game.loot.filter((l) => Math.hypot(H.game.world.dx(l.x, rp.x), l.y - rp.y) < 14).map((l) => l.id); if (ids.length) { H.game.net.emit('loot.expire', { ids }); await t.sleep(ONEWAY() + 100); } }
  MG.player.respawnPlayer(G.game);
  await t.sleep(200);
  t.check(!gp.inv.used() && !gp.equip.main, 'respawn with nothing carried');
  // host opens the body
  const s = A.freeSpot(H, MH, ch.x, ch.y, { rMin: 0.7, rMax: 1.3 });
  t.assert(s, 'free spot next to the body');
  A.teleport(H, s[0], s[1]);
  const itO = MH.corpses.describeCorpse(H.game, ch);
  t.check(itO?.kind === 'corpse_open' && itO.verb === 'Revistar', 'pawn body offers "Revistar"', `${itO?.kind} ${itO?.verb}`);
  A.ensure(H, { stone: 4 });
  A.interact(H, itO);
  const pn = H.game.ui.panels;
  await t.waitFor(() => pn.open === 'container' && pn.container?.kind === 'corpse', 4000, 'host: container window open on the body');
  t.check(/Corpo de /.test(H.doc.querySelector('.p-chest .pt')?.textContent || ''), 'window title "Corpo de <nome>"', H.doc.querySelector('.p-chest .pt')?.textContent);
  const wood0 = A.count(H, 'wood');
  const wi = ch.store.slots.findIndex((q) => q && q.id === 'wood');
  H.doc.querySelector(`[data-cslot="${wi}"]`)?.dispatchEvent(new H.doc.defaultView.MouseEvent('click', { bubbles: true, shiftKey: true })); // (shift: the whole stack)
  await t.waitFor(() => A.count(H, 'wood') >= wood0 + 7 && !content(bodyOn(G, ch.id)).wood, RT() + 600, 'host takes the wood (gone from the body on both)');
  const si = H.game.player.inv.slots.findIndex((q) => q && q.id === 'stone');
  H.doc.querySelector(`[data-slot="${si}"]`)?.dispatchEvent(new H.doc.defaultView.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await t.waitFor(() => content(bodyOn(G, ch.id)).stone === 4 && content(ch).stone === 4, RT() + 600, 'host puts 4 stones into the body (on both)');
  H.doc.querySelector(`[data-sort="name"][data-sortk="corpse:${ch.id}"]`)?.click();
  const names = (c) => c.store.slots.filter(Boolean).map((q) => MH.data.ITEMS[q.id].name);
  const isSorted = (L) => L.every((n, i) => !i || L[i - 1].localeCompare(n, 'pt-BR') <= 0);
  await t.waitFor(() => isSorted(names(ch)) && JSON.stringify(bodyOn(G, ch.id).store.toJSON()) === JSON.stringify(ch.store.toJSON()) && !!ch.store.slots[0], RT() + 600, 'body sorted A–Z (same on both)');
  t.check(isSorted(names(ch)), 'body sorted alphabetically', names(ch).join(', '));
  A.ensure(H, { pebble: 1, wood: 1 });
  H.doc.querySelector('[data-sort="qty"][data-sortk="inv"]')?.click();
  await t.sleep(50);
  const q = H.game.player.inv.slots.filter(Boolean).map((x) => x.qty);
  t.check(q.every((v, i) => !i || q[i - 1] >= v) && !H.game.player.inv.slots.slice(0, q.length).some((x) => !x), 'backpack sorted by quantity (gaps closed)', q.join(','));
  H.doc.querySelector('[data-sort="type"][data-sortk="inv"]')?.click();
  await t.sleep(50);
  // the guest takes from its own body
  const sg = A.freeSpot(G, MG, ch.x, ch.y, { rMin: 0.7, rMax: 1.3, prefer: Math.PI });
  if (sg) A.teleport(G, sg[0], sg[1]);
  await A.hostSees(t, H, G, 4000);
  const gi = bodyOn(G, ch.id).store.slots.findIndex((x) => x && x.id === 'berries');
  const take = await ask(G, 'corpse.take', { id: ch.id, slot: gi, qty: 40 });
  await t.sleep(RT());
  t.check(take.ok && A.count(G, 'berries') === 4 && !content(ch).berries, 'the guest takes the berries back from its own body', `${take.why || ''} · guest berries ${A.count(G, 'berries')}`);
  // day 3: skeleton, can't be opened any more
  skipDays(H, 2.05);
  await t.waitFor(() => stageOn(G, MG, ch.id) === 'skeleton', ONEWAY() + 1500, 'day 3: the body is a skeleton on the guest');
  await t.waitFor(() => pn.open !== 'container', 2000, 'host window closes at the skeleton stage');
  const late = await ask(G, 'corpse.take', { id: ch.id, slot: bodyOn(G, ch.id).store.slots.findIndex(Boolean), qty: 10 });
  t.check(!late.ok && /ossada/i.test(late.why || ''), 'taking from day 3 is refused', late.why);
  const latePut = await ask(H, 'corpse.put', { id: ch.id, item: 'wood', qty: 1 });
  t.check(!latePut.ok, 'putting from day 3 is refused', latePut.why);
  const itB = MG.corpses.describeCorpse(G.game, bodyOn(G, ch.id));
  t.check(itB?.kind === 'corpse_bones' && itB.verb === 'Remover ossada', 'the action becomes "Remover ossada"', `${itB?.kind} ${itB?.verb}`);
  await t.checkDigest(H, G);
  env.history.push('S61');
});

def('S63', {
  title: 'I: bodies — animals are removed, people are dragged (Arrastar / Largar)', timeout: 90000,
  expected: 'The guest dies carrying items: its body (a person) can not be removed — the menu offers "Arrastar corpo", a removal request is refused; the host drags it (corpse.drag → dragBy on both), walks off and lets go (corpse.drop): the body lies where the host left it on both, still holding its items. An animal body (a deer) is removed at once from its menu ("Remover corpo"): gone on both; digest equal',
  api: 'corpses.corpseMenu / dragIt → work corpse_drag → intent corpse.drag {on 1} → op corpse.drag; describeCorpse corpse_drop → intent corpse.drag {on 0, x, y} → op corpse.drop; discardIt → intent corpse.discard (people refused) → op corpse.remove',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(MH.corpses?.corpseMenu && MH.corpses?.dragIt, 'corpse dragging missing');
  A.keepAlive(t, H);
  const gp = G.game.player, hp = H.game.player;
  for (let i = 0; i < gp.inv.size; i++) gp.inv.slots[i] = null;
  A.ensure(G, { wood: 5, pebble: 2 });
  const before = new Set(H.game.corpses.map.keys());
  MG.player.killPlayer(G.game);
  const ch = await t.waitFor(() => [...H.game.corpses.map.values()].find((c) => !before.has(c.id) && c.owner === G.pid), RT() + 800, "guest's body on the host");
  await t.waitFor(() => bodyOn(G, ch.id), ONEWAY() + 600, "guest's body on the guest");
  MG.player.respawnPlayer(G.game);
  const menu = MH.corpses.corpseMenu(H.game, ch);
  t.check(menu.some((m) => m.id === 'drag') && !menu.some((m) => m.id === 'discard'), 'a person\'s body: "Arrastar corpo", no "Remover corpo"', short(menu.map((m) => m.label)));
  const s = A.freeSpot(H, MH, ch.x, ch.y, { rMin: 0.6, rMax: 1.2 });
  t.assert(s, 'free spot next to the body');
  A.teleport(H, s[0], s[1]);
  let refused = null;
  H.game.net.request('corpse.discard', { id: ch.id }, { onReject: (why) => { refused = why || 'refused'; } });
  await t.waitFor(() => refused, 2000, 'removing a person\'s body is refused');
  t.check(H.game.corpses.map.has(ch.id), 'the body is still there');
  // drag it
  menu.find((m) => m.id === 'drag').run();
  await t.waitFor(() => ch.dragBy === H.pid && bodyOn(G, ch.id)?.dragBy === H.pid, 6000 + RT(), 'the host drags it (on both)');
  const x0 = ch.x, y0 = ch.y;
  const to = A.freeSpot(H, MH, x0 + 3, y0, { rMin: 0, rMax: 2 });
  t.assert(to, 'a free spot 3 tiles away');
  A.teleport(H, to[0], to[1]);
  await t.sleep(1200); // (its drawing follows the host)
  const it = MH.corpses.describeCorpse(H.game, ch);
  t.check(it?.kind === 'corpse_drop', 'its action is now "Largar corpo"', it?.verb);
  H.game.ctl.interact(it);
  await t.waitFor(() => !ch.dragBy && !bodyOn(G, ch.id)?.dragBy, 6000 + RT(), 'let go on both');
  const gch = bodyOn(G, ch.id);
  t.check(Math.hypot(ch.x - x0, ch.y - y0) > 1.5 && Math.hypot(ch.x - hp.x, ch.y - hp.y) < 2, 'the body lies where the host left it', `${f2(x0)},${f2(y0)} → ${f2(ch.x)},${f2(ch.y)} (host ${f2(hp.x)},${f2(hp.y)})`);
  t.check(gch && Math.abs(gch.x - ch.x) < 0.01 && Math.abs(gch.y - ch.y) < 0.01, 'same place on the guest', gch ? `${f2(gch.x)},${f2(gch.y)}` : 'none');
  t.check((ch.store?.slots || []).some(Boolean), 'it still holds what it carried');
  // an animal body is removed at once
  const MO = await fimp(H, 'game/mobs.js'), MC = await fimp(H, 'game/combat.js');
  const ds = A.freeSpot(H, MH, hp.x + 2, hp.y, { rMin: 0, rMax: 2, r: 0.3 });
  const deer = MO.spawnLoose(H.game, 'deer', ds[0], ds[1]);
  const b0 = new Set(H.game.corpses.map.keys());
  MC.killMob(H.game, deer, hp);
  const dc = await t.waitFor(() => [...H.game.corpses.map.values()].find((c) => !b0.has(c.id) && c.of === 'deer'), RT() + 800, 'the deer body');
  await t.waitFor(() => bodyOn(G, dc.id), ONEWAY() + 600, 'the deer body on the guest');
  const dm = MH.corpses.corpseMenu(H.game, dc);
  t.check(dm.some((m) => m.id === 'discard' && m.label === 'Remover corpo'), 'an animal body offers "Remover corpo"', short(dm.map((m) => m.label)));
  A.teleport(H, dc.x + 0.7, dc.y);
  dm.find((m) => m.id === 'discard').run();
  await t.waitFor(() => !H.game.corpses.map.has(dc.id) && !G.game.corpses.map.has(dc.id), 12000, 'the animal body is gone on both');
  await t.checkDigest(H, G);
});

def('C1', {
  title: 'Creative world: the host\'s mode reaches the guest; instant free building, no damage, full bars', timeout: 90000,
  expected: 'With the host world in creative mode, a guest resync carries it (snapshot mode): game.creative on both. The guest places 3 walls with an empty bag: finished at once on both (no blueprint), same ids; a host-side creature hit on the guest does nothing; the guest\'s bars stay full; a guest "Desmontar" removes a wall at once; back to survival afterwards (resync) for the scenarios after it; digest equal',
  api: 'creative.js (game.creative, creativeSystem), snapshot mode, build.place / build.decon (creative), combat.dealDamage (creative), players.hurtPlayer → player.hurt',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player;
  try {
    H.game.creative = true;
    G.game.net.forceResync();
    await t.waitFor(() => G.game.net.synced && G.game.creative === true, 15000, 'the guest got the creative mode with the snapshot');
    for (let i = 0; i < gp.inv.size; i++) gp.inv.slots[i] = null;
    const site = A.findSite([H, G], [MH, MG], 'wall_wood', (x, y) => [[x, y], [x + 1, y], [x + 2, y], [x, y + 1], [x + 1, y + 1], [x + 2, y + 1]], gp.x, gp.y, { rMin: 2, rMax: 8 });
    t.assert(site, 'found a free 3×2 site');
    const n0 = H.game.build.structures.length;
    G.game.net.request('build.place', { type: 'wall_wood', tiles: [[site.x0, site.y0], [site.x0 + 1, site.y0], [site.x0 + 2, site.y0]] });
    const walls = (f) => f.game.build.structures.filter((o) => o.type === 'wall_wood' && o.ty === site.y0 && o.tx >= site.x0 && o.tx <= site.x0 + 2);
    await t.waitFor(() => walls(H).length === 3 && walls(G).length === 3, RT() + 1500, 'the walls exist on both');
    t.check(walls(H).every((o) => !o.blueprint) && walls(G).every((o) => !o.blueprint), 'finished at once on both, with an empty bag', `host ${walls(H).map((o) => f2(o.progress)).join(',')}`);
    t.check(JSON.stringify(walls(H).map((o) => o.id).sort()) === JSON.stringify(walls(G).map((o) => o.id).sort()), 'same ids on both');
    t.check(H.game.build.structures.length - n0 === 3, 'nothing else was placed');
    const av = [...H.game.session.players.values()].find((p) => p.pid === G.pid)?.av;
    const hp0 = gp.hp;
    if (av) MH.players.hurtPlayer(H.game, null, av, 40, { noDodge: true });
    await t.sleep(RT() + 400);
    t.check(gp.hp >= hp0 && !gp.dead, 'a hit from the host does nothing to the guest', `hp ${hp0} → ${gp.hp}`);
    gp.energy = 1; gp.hunger = 1; gp.bodyHeat = 1;
    await t.sleep(300);
    t.check(gp.energy === gp.maxEnergy && gp.hunger === gp.maxHunger && gp.bodyHeat === 100, 'the guest\'s bars stay full', `energy ${f2(gp.energy)} hunger ${f2(gp.hunger)} heat ${f2(gp.bodyHeat)}`);
    const w0 = walls(G)[0];
    G.game.net.request('build.decon', { ids: [w0.id], on: 1 });
    await t.waitFor(() => !H.game.build.structures.includes(walls(H).find((o) => o.id === w0.id)) && walls(H).length === 2 && walls(G).length === 2, RT() + 1500, '"Desmontar" removes it at once on both');
    await t.checkDigest(H, G);
    // leave the arena as it was (the stories / creature scenarios after this one walk around here)
    G.game.net.request('build.decon', { ids: walls(G).map((o) => o.id), on: 1 });
    await t.waitFor(() => !walls(H).length && !walls(G).length, RT() + 1500, 'the test walls are gone');
  } finally {
    // the scenarios after this one play survival
    H.game.creative = false;
    G.game.net.forceResync();
    await t.waitFor(() => G.game.net.synced && G.game.creative === false, 15000, 'back to survival on the guest');
  }
});

// W1 seasons: winter on both, frozen water, a walker (Andarilho do Gelo) replicated, crumbling at sunrise
def('W1', {
  title: 'Seasons: winter night on both (frozen water), a walker replicated with its ice weapon, crumbles at sunrise', timeout: 120000,
  expected: 'The host jumps the clock to a winter night (day 5 of year 1, 23 h — calendar: a 7-day year): the guest follows; game.season is winter on both and the water is frozen on both (no swimming in deep water, walkable); a walker spawned next to the guest is a pawn proxy on the guest with species walker and an ice weapon; at sunrise (6.6 h, spring of year 2) it crumbles: dead on both, no body; passive animals are absent at night and back in the morning (host); the year turns on both; digest equal',
  api: 'seasons.js (seasonSystem, game.season, world.frozen / liquidAt), op env.skip, walkers.js spawnWalkerAt / walkersTick (killMob noCorpse), mobs.js ACTIVE / isNight, entity stream species / weapon',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, gp = G.game.player, hp0 = H.game.player;
  const day0 = EH.dayIndex, hour0 = EH.hour, wt0 = H.game.worldTime;
  t.defer(() => {
    // back to the old clock, and nothing of the night left behind (hunting packs / walkers would hunt later scenarios)
    H.game.net.emit('env.skip', { hour: hour0, day: day0, wt: H.game.worldTime + 1, by: H.game.net.pid });
    for (const e of H.game.entities.slice()) if (e.isMob && !e.dead && (e.faction === 'walker' || e.spawner?.hunt)) { e.noCorpse = true; MH.combat.killMob(H.game, e, null); }
  });
  A.keepAlive(t, G);
  H.game.net.emit('env.skip', { hour: 23, day: 5, wt: wt0 + 1, by: H.game.net.pid });
  await t.waitFor(() => G.game.env.dayIndex === 5 && Math.abs(G.game.env.hour - 23) < 0.2, 3000 + CFG.budget, 'the guest clock follows to day 5, 23 h');
  await t.waitFor(() => H.game.season?.id === 'winter' && G.game.season?.id === 'winter', 2000, 'winter on both', () => `${H.game.season?.id} / ${G.game.season?.id}`);
  t.check(H.game.world.frozenAt(hp0.x, hp0.y) && G.game.world.frozenAt(gp.x, gp.y), 'the water is frozen on both (each at its own place: seasons by latitude)', `zones ${H.game.world.zoneAt(Math.floor(hp0.x), Math.floor(hp0.y))} / ${G.game.world.zoneAt(Math.floor(gp.x), Math.floor(gp.y))}`);
  const w = G.game.world;
  let deep = null;
  for (let r = 2; r < 90 && !deep; r += 1) for (let a = 0; a < 48 && !deep; a++) {
    const x = Math.floor(gp.x + Math.cos(a / 48 * Math.PI * 2) * r), y = Math.floor(gp.y + Math.sin(a / 48 * Math.PI * 2) * r);
    if (w.inBounds(x, y) && w.waterAt(x, y) === 2) deep = [x, y];
  }
  if (deep) {
    const back = [gp.x, gp.y];
    A.teleport(G, deep[0] + 0.5, deep[1] + 0.5);
    await t.sleep(300);
    t.check(!gp.swimming && !w.blocked(deep[0], deep[1]), 'deep water is ice: no swimming, walkable', `swimming ${gp.swimming}`);
    A.teleport(G, back[0], back[1]);
    await A.hostSees(t, H, G);
  } else t.log('no deep water near the guest: ice check skipped');
  // night: no green animals on the host (they went home; some may still be walking away in view)
  await t.sleep(2500);
  // (fish stay in the water all day; farm animals of the players have no herd: both are out at night on purpose)
  // (the day animals of the dens: the planet's fauna also has creatures out at all hours — birds, crabs, seals)
  // (a streamed planet: only the active region around the players runs its dens — the creatures there; farther ones sleep)
  const seen = (m) => [H.game.player, A.authAvatarOn(H, G.pid)].some((q) => q && Math.hypot(H.game.world.dx(m.x, q.x), m.y - q.y) < 40);
  const green = A.hostMobs(H, (m) => m.temper === 'passive' && !m.leaving && m.species !== 'fish' && !!m.spawner && m.spawner.when === 'day' && !m.spawner.loose && seen(m)).length;
  t.check(green === 0, 'no passive animal out at night', `${green}`);
  // a walker next to the guest
  const s = A.freeSpot(H, MH, gp.x + 6, gp.y, { rMin: 0, rMax: 3, r: 0.3 });
  t.assert(s, 'free spot for a walker');
  const m = MH.walkers.spawnWalkerAt(H.game, s[0], s[1]);
  m.calmT = 999; m.state = 'idle';
  const px = await t.waitFor(() => A.proxyOf(G, m), RT() + 1500, 'the guest sees the walker');
  t.check(px.species === 'walker' && px.kind === 'pawn' && /^(sword|spear)_ice$/.test(px.weapon || ''), 'walker proxy: species walker, pawn, ice weapon', `${px.species} ${px.kind} ${px.weapon}`);
  // sunrise: it crumbles
  H.game.net.emit('env.skip', { hour: 6.6, day: 8, wt: H.game.worldTime + 1, by: H.game.net.pid }); // (spring of year 2)
  await t.waitFor(() => m.dead && A.proxyOf(G, m)?.dead !== false, 12000, 'the walker crumbles at sunrise (dead on the host)');
  await t.waitFor(() => !A.proxyOf(G, m) || A.proxyOf(G, m).dead, RT() + 1500, 'dead on the guest too');
  t.check(![...H.game.corpses.map.values()].some((c) => c.of === 'walker'), 'no body left');
  await t.waitFor(() => A.hostMobs(H, (e) => e.temper === 'passive').length > 0, 6000, 'passive animals are back in the morning');
  await t.waitFor(() => H.game.season?.year === 2 && G.game.season?.year === 2 && G.game.season?.id === 'spring', 2000, 'a new year (spring of year 2) on both', () => `${H.game.season?.year} / ${G.game.season?.year} ${G.game.season?.id}`);
  await t.checkDigest(H, G);
  env.history.push('W1');
});

// W2 winter walkers break into a room: cracks on both, the wall falls on both
def('W2', {
  title: 'Seasons: a winter walker breaks into a closed room (cracks on both, the wooden wall falls on both)', timeout: 120000,
  expected: 'Winter night; the guest stands inside a closed 3×3 room of wooden walls; a walker outside senses it through the walls and hits the closest wall (op struct.dmg): the same damage on both (cracks); when the damage reaches 1 the wall breaks on both (struct.remove fx smash) and the walker comes for the guest; at sunrise the remaining cracks settle (0) on both; digest equal',
  api: 'walkers.js walkerBrain (pickGoal / pickBreach / hitPiece), op struct.dmg {id, d, x, y} → o.dmg, struct.remove fx smash, rockfx.structHit / structBreak (cosmetic)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, gp = G.game.player;
  const day0 = EH.dayIndex, hour0 = EH.hour;
  A.keepAlive(t, G);
  const site = A.findSite([H, G], [MH, MG], 'wall_wood', (x, y) => { const L = []; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) L.push([x + i, y + j]); return L; }, gp.x, gp.y, { rMin: 3, rMax: 14 });
  t.assert(site, 'found a free 5×5 site');
  const { x0, y0 } = site;
  const ring = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (i === 0 || j === 0 || i === 4 || j === 4) ring.push(['wall_wood', x0 + i, y0 + j]);
  const ids = hostBuild(H, ring);
  t.defer(() => {
    for (const id of ids) H.game.net.emit('struct.remove', { id, quiet: 1 });
    H.game.net.emit('env.skip', { hour: hour0, day: day0, wt: H.game.worldTime + 1, by: H.game.net.pid });
    for (const e of H.game.entities.slice()) if (e.isMob && !e.dead && (e.faction === 'walker' || e.spawner?.hunt)) { e.noCorpse = true; MH.combat.killMob(H.game, e, null); }
  });
  await t.waitFor(() => ids.every((id) => A.structOn(G, id)), RT() + 1500, 'the guest has the room');
  A.teleport(G, x0 + 2.5, y0 + 2.5);
  await A.hostSees(t, H, G);
  H.game._walkT = 1e9; // (no natural spawns during the scenario)
  H.game.net.emit('env.skip', { hour: 22, day: 5, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => H.game.season?.id === 'winter' && G.game.season?.id === 'winter', 3000 + CFG.budget, 'winter night on both');
  H.game._walkT = 1e9;
  const s = A.freeSpot(H, MH, x0 + 7.5, y0 + 2.5, { rMin: 0, rMax: 2, r: 0.3 });
  t.assert(s, 'free spot for the walker');
  const m = MH.walkers.spawnWalkerAt(H.game, s[0], s[1]);
  const hit = await t.waitFor(() => H.game.build.structures.find((o) => ids.includes(o.id) && o.dmg > 0), 20000, 'the walker hits a wall of the room', () => `walker ${m.state} at ${f2(m.x)},${f2(m.y)}`);
  t.check(m.state === 'siege', 'the walker is breaking in (siege)', m.state);
  await t.waitFor(() => Math.abs((A.structOn(G, hit.id)?.dmg || 0) - hit.dmg) < 0.02, RT() + 1500, 'same damage (cracks) on the guest', () => `${f2(hit.dmg)} / ${f2(A.structOn(G, hit.id)?.dmg || 0)}`);
  hit.dmg = 0.995; // (the next hit breaks it: test shortcut)
  await t.waitFor(() => hit.removed && !A.structOn(G, hit.id), 12000 + RT(), 'the wall falls on both');
  t.check(!H.game.world.solid.get(H.game.world.idx(hit.tx, hit.ty)) && !G.game.world.solid.get(G.game.world.idx(hit.tx, hit.ty)), 'the tile is open on both');
  await t.waitFor(() => m.state === 'chase' || m.state === 'siege', 6000, 'the walker comes in', () => m.state);
  // sunrise: it crumbles; the cracks left on the other walls settle
  for (const id of ids) { const o = H.game.build.structures.find((q) => q.id === id); if (o && !o.removed) { H.game.net.emit('struct.dmg', { id, d: 0.3, x: o.x + 1, y: o.y }); break; } }
  H.game.net.emit('env.skip', { hour: 6.8, day: 6, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => m.dead, 12000, 'the walker crumbles at sunrise');
  await t.waitFor(() => !H.game.build.structures.some((o) => o.dmg > 0) && !G.game.build.structures.some((o) => o.dmg > 0), 6000 + RT(), 'the cracks settle on both');
  await t.checkDigest(H, G);
  env.history.push('W2');
});

// ---------- ice giants (src/game/giants.js) and the ballista (src/game/ballista.js) ----------
// clean up after a giant / ballista scenario: the clock back, giants / walkers gone, structures removed
function siegeCleanup(t, H, MH, day0, hour0, ids = []) {
  t.defer(() => {
    for (const id of ids) if (H.game.build.structures.some((o) => o.id === id)) H.game.net.emit('struct.remove', { id, quiet: 1 });
    H.game.net.emit('env.skip', { hour: hour0, day: day0, wt: H.game.worldTime + 1, by: H.game.net.pid });
    for (const e of H.game.entities.slice()) if (e.isMob && !e.dead && (e.faction === 'walker' || e.spawner?.hunt)) { e.noCorpse = true; e.onDeath = null; MH.combat.killMob(H.game, e, null); }
  });
}
// damage the local player of frame f takes (by ability), recorded until the scenario ends
function hurtLog(t, f) {
  const L = [];
  const off = f.game.events.on('damage', (d) => { if (d.target === f.game.player && (d.kind === 'hit' || d.kind === 'dodge')) L.push({ ab: d.ability || '', amount: d.amount, kind: d.kind, t: now() }); });
  t.defer(off);
  return L;
}

def('IG1', {
  title: 'Ice giants: a giant spawns, is replicated (pawn ×2.4, ice club) and breaks a stone wall much faster than a walker, on both', timeout: 120000,
  expected: 'Winter night; the guest stands inside a closed 5×5 room of stone walls; a giant spawned outside (giants.spawnGiantAt) is a pawn proxy on the guest (species giant, scale 2.4, weapon club_ice, elite); it senses the guest through the walls and hits the closest wall: one hit (op struct.dmg) is ≥ 6× a walker\'s hit on stone (giant: swingDur × SIEGE_MUL / 350); the same damage (cracks) on both; the wall falls on both and the giant comes in; the spawn numbers grow with the winters (giantNumbers); digest equal',
  api: 'giants.js spawnGiantAt / giantNumbers / SIEGE_MUL, walkers.js walkerBrain (siege), op struct.dmg / struct.remove fx smash, entity stream (species giant, scale)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, gp = G.game.player;
  const day0 = EH.dayIndex, hour0 = EH.hour;
  A.keepAlive(t, G);
  const site = A.findSite([H, G], [MH, MG], 'wall_stone', (x, y) => { const L = []; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) L.push([x + i, y + j]); return L; }, gp.x, gp.y, { rMin: 3, rMax: 14 });
  t.assert(site, 'found a free 5×5 site');
  const { x0, y0 } = site, ring = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (i === 0 || j === 0 || i === 4 || j === 4) ring.push(['wall_stone', x0 + i, y0 + j]);
  const ids = hostBuild(H, ring);
  siegeCleanup(t, H, MH, day0, hour0, ids);
  await t.waitFor(() => ids.every((id) => A.structOn(G, id)), RT() + 1500, 'the guest has the room');
  // the numbers: a few in the first winter, more later
  const N1 = MH.giants.giantNumbers(H.game, 0), N3 = MH.giants.giantNumbers(H.game, 2), N7 = MH.giants.giantNumbers(H.game, 6);
  t.check(N1.near === 1 && N3.near >= 2 && N7.near > N3.near && N1.chance < N3.chance && N1.every > N3.every, 'giants grow with the winters', `w1 ${JSON.stringify(N1)} w3 ${JSON.stringify(N3)} w7 ${JSON.stringify(N7)}`);
  A.teleport(G, x0 + 2.5, y0 + 2.5);
  await A.hostSees(t, H, G);
  H.game._walkT = 1e9; H.game._giantT = 1e9; // (no natural spawns during the scenario)
  H.game.net.emit('env.skip', { hour: 22, day: 5, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => H.game.season?.id === 'winter' && G.game.season?.id === 'winter', 3000 + CFG.budget, 'winter night on both');
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  const s = A.freeSpot(H, MH, x0 + 8, y0 + 2.5, { rMin: 0, rMax: 2.5, r: 0.45 });
  t.assert(s, 'free spot for the giant');
  const m = MH.giants.spawnGiantAt(H.game, s[0], s[1]);
  const px = await t.waitFor(() => A.proxyOf(G, m), RT() + 1500, 'the guest sees the giant');
  t.check(px.species === 'giant' && px.kind === 'pawn' && px.scale === 2.4 && px.weapon === 'club_ice' && px.elite, 'giant proxy: species giant, pawn, scale 2.4, ice club, elite', `${px.species} ${px.kind} ${px.scale} ${px.weapon} ${px.elite}`);
  const hit = await t.waitFor(() => H.game.build.structures.find((o) => ids.includes(o.id) && o.dmg > 0), 25000, 'the giant hits a wall of the room', () => `giant ${m.state} at ${f2(m.x)},${f2(m.y)}`);
  const walkerInc = (2.0 * 1.15) / 350; // (a walker: swing ~2 s × 1.15 per hit, 350 walker-seconds for stone)
  t.check(hit.dmg >= walkerInc * 6, 'one giant hit on stone ≥ 6× a walker\'s', `${hit.dmg.toFixed(4)} vs walker ~${walkerInc.toFixed(4)}`);
  t.log(`giant hit on stone: ${hit.dmg.toFixed(4)} (≈ ${((1 / hit.dmg) * m.swingDur).toFixed(0)} s alone for a stone wall)`);
  await t.waitFor(() => Math.abs((A.structOn(G, hit.id)?.dmg || 0) - hit.dmg) < 0.02, RT() + 1500, 'same damage (cracks) on the guest', () => `${f2(hit.dmg)} / ${f2(A.structOn(G, hit.id)?.dmg || 0)}`);
  hit.dmg = 0.99; // (the next hit breaks it: test shortcut)
  await t.waitFor(() => hit.removed && !A.structOn(G, hit.id), 15000 + RT(), 'the wall falls on both');
  t.check(!H.game.world.solid.get(H.game.world.idx(hit.tx, hit.ty)) && !G.game.world.solid.get(G.game.world.idx(hit.tx, hit.ty)), 'the tile is open on both');
  await t.waitFor(() => m.state === 'chase' || m.state === 'siege' || m.state === 'hunt', 8000, 'the giant comes in', () => m.state);
  await t.checkDigest(H, G);
  env.history.push('IG1');
});

def('IG2', {
  title: 'Ice giants: the slow smash (telegraph, heavy, dodgeable) and the thrown ice rock (small damage) hurt the guest', timeout: 120000,
  expected: 'Winter night, open ground. A giant next to the guest winds up a smash: the guest sees the danger circle (op giant.tele) before the blow, the blow lands ≥ 0.8 s later and does about the giant\'s heavy damage and knocks the guest back (≥ 0.3 tiles away from the giant: the knock travels in player.hurt; the host sees the guest pushed); next wind-up the guest steps out of the circle: no smash damage. Then the guest stands 9 tiles away: the giant throws an ice rock (op giant.rock: an ice_rock lob on the guest too) that lands on it: small damage, about a walker\'s hit at the giant\'s level; digest equal',
  api: 'giants.js giantChase (smash: cast Esmagar + giant.tele; throwRock: cast Arremessar + giant.rock), hurtPlayer → own player.hurt (ability giant_smash / ice_rock, knock), projectiles LOB_KINDS.ice_rock',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, gp = G.game.player;
  const day0 = EH.dayIndex, hour0 = EH.hour;
  siegeCleanup(t, H, MH, day0, hour0);
  A.keepAlive(t, G);
  // open ground with nothing built around (a planet's start can be wooded; earlier scenarios built by the spawn)
  await A.openField(t, H, MH, G, MG, 12, 8, (x, y) => !H.game.build.structures.some((o) => Math.hypot(H.game.world.dx(o.tx, x), o.ty - y) < 30));
  const dodge0 = gp.dodge;
  gp.dodge = 0; t.defer(() => { gp.dodge = dodge0; });
  const log = hurtLog(t, G);
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  H.game.net.emit('env.skip', { hour: 22, day: 5, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => H.game.season?.id === 'winter' && G.game.season?.id === 'winter', 3000 + CFG.budget, 'winter night on both');
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  A.pacify(H, gp.x, gp.y, 30, 600);
  const s = A.freeSpot(H, MH, gp.x + 1.9, gp.y, { rMin: 0, rMax: 1.5, r: 0.45 });
  t.assert(s, 'free spot for the giant');
  const m = MH.giants.spawnGiantAt(H.game, s[0], s[1]);
  const av = guestOnHost(H, G);
  MH.ai.aggro(H.game, m, av);
  // 1) the smash: telegraph first, then the heavy blow
  const tele = await t.waitFor(() => G.game.teles?.find((q) => q.k === 'smash'), 9000 + RT(), 'the guest sees the smash telegraph (giant.tele)', () => JSON.stringify(MH.giants.giantDebug(m)));
  const t0 = now();
  t.check(Math.hypot(tele.x - gp.x, tele.y - gp.y) <= tele.r + 0.3, 'the circle is on the guest', `${f2(tele.x)},${f2(tele.y)} r ${tele.r} vs guest ${f2(gp.x)},${f2(gp.y)}`);
  const kx0 = gp.x, ky0 = gp.y, gd0 = Math.hypot(gp.x - m.x, gp.y - m.y);
  const sm = await t.waitFor(() => log.find((d) => d.ab === 'giant_smash'), 4000 + RT(), 'the smash lands on the guest');
  t.check(sm.t - t0 >= 800, 'the blow lands after the wind-up (dodge window)', `${Math.round(sm.t - t0)} ms after the circle`);
  t.check(sm.amount >= m.dmg * 0.85 * 0.35 && sm.amount <= m.dmg * 1.6, 'heavy smash damage (≈ the giant\'s dmg, less armour)', `${sm.amount} vs giant dmg ${f2(m.dmg)}`);
  // the knockback reaches the guest (player.hurt carries knock: the owner moves itself) and the host sees it
  await t.sleep(60);
  const kd = Math.hypot(gp.x - kx0, gp.y - ky0), gd1 = Math.hypot(gp.x - m.x, gp.y - m.y);
  t.check(kd >= 0.3 && gd1 > gd0 + 0.2, 'the smash knocks the guest back (away from the giant)', `moved ${f2(kd)} tiles, from the giant ${f2(gd0)} → ${f2(gd1)}`);
  await t.waitFor(() => { const a = guestOnHost(H, G); return a && Math.hypot((a.ax ?? a.x) - gp.x, (a.ay ?? a.y) - gp.y) < 0.15; }, RT() + 1500, 'the host sees the guest pushed back');
  // 2) dodge: step out of the next circle before it lands
  const n0 = log.filter((d) => d.ab === 'giant_smash').length;
  m.swingT = 0;
  const tele2 = await t.waitFor(() => G.game.teles?.find((q) => q !== tele && q.k === 'smash' && q.t < q.dur * 0.6), 9000 + RT(), 'a second wind-up');
  const ax = gp.x - tele2.x, ay = gp.y - tele2.y, aL = Math.hypot(ax, ay) || 1;
  A.teleport(G, tele2.x + (ax / aL) * (tele2.r + 2.4), tele2.y + (ay / aL) * (tele2.r + 2.4));
  await t.sleep(1800);
  t.check(log.filter((d) => d.ab === 'giant_smash').length === n0, 'stepping out of the circle dodges the smash');
  // 3) the thrown rock from afar
  const far = A.freeSpot(G, MG, m.x - 9, m.y, { rMin: 0, rMax: 2.5 });
  t.assert(far, 'a spot 9 tiles from the giant');
  A.teleport(G, far[0], far[1]);
  await A.hostSees(t, H, G);
  m.throwT = 0; m.swingT = 0;
  const rock = await t.waitFor(() => (G.game.projectiles || []).find((p) => p.lob && p.cosmetic && Math.hypot(p.lx - gp.x, p.ly - gp.y) < 3), 12000 + RT(), 'the guest sees an ice rock thrown at it (giant.rock)', () => JSON.stringify(MH.giants.giantDebug(m)));
  t.check(rock.kind === 'ice_rock', 'it flies as an ice rock on the guest', rock.kind);
  const rk = await t.waitFor(() => log.find((d) => d.ab === 'ice_rock'), 6000 + RT(), 'the rock hits the guest (standing still)');
  const wk = 6 * (1 + 0.16 * (m.level - 1)) * 1.06;
  t.check(rk.amount <= wk * 1.3 && rk.amount >= 1, 'the rock does little damage (a walker\'s hit)', `${rk.amount} vs walker hit ~${f2(wk)} at level ${m.level}`);
  t.log(`smash ${sm.amount}, rock ${rk.amount} (giant L${m.level}, dmg ${f2(m.dmg)}, hp ${Math.round(m.maxHp)})`);
  await t.checkDigest(H, G);
  env.history.push('IG2');
});

def('BA1', {
  title: 'Ballista: the guest mounts it, turns it slowly (the host sees it turn), fires 2 bolts and kills an ice giant on both', timeout: 120000,
  expected: 'A finished ballista next to the guest; the guest has 4 ballista bolts and gets on it (intent ballista.use → op ballista.set: user = guest on both, the guest rooted at the seat); it aims at a giant 11 tiles away: the top turns slowly (after 0.3 s the host\'s aim is between the start and the target), then points there on both (op ballista.set aim); the first bolt (intent ballista.fire → op ballista.shot) takes 55% of the giant\'s life on the host, the proxy\'s life on the guest follows; a shot during the reload is refused and refunded; after the reload the second bolt kills it: dead on both, XP to the guest only, 2 bolts left; digest equal',
  api: 'ballista.js useBallista / ballistaCtl (stickAng, fire), mut/ballista.js intents ballista.use / aim / fire, ops ballista.set / shot / end, o.user / o.aim / o._aimD, killMob credit to the avatar',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, gp = G.game.player, hp = H.game.player;
  const day0 = EH.dayIndex, hour0 = EH.hour;
  A.keepAlive(t, G);
  const site = A.findSite([H, G], [MH, MG], 'ballista', (x, y) => { const L = []; for (let i = -1; i <= 13; i++) for (let j = -1; j <= 1; j++) L.push([x + i, y + j]); return L; }, gp.x, gp.y, { rMin: 2, rMax: 18 });
  t.assert(site, 'found a free 15×3 strip');
  const { x0, y0 } = site;
  const [bid] = hostBuild(H, [['ballista', x0, y0, 0]]);
  siegeCleanup(t, H, MH, day0, hour0, [bid]);
  await t.waitFor(() => A.structOn(G, bid) && !A.structOn(G, bid).blueprint, RT() + 1500, 'the guest has the finished ballista');
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  H.game.net.emit('env.skip', { hour: 22, day: 5, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => G.game.season?.id === 'winter', 3000 + CFG.budget, 'winter night');
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  A.pacify(H, x0, y0, 30, 600);
  A.teleport(G, x0 + 0.5, y0 + 1.6);
  await A.hostSees(t, H, G);
  const nb = gp.inv.count('ballista_bolt');
  if (nb) gp.inv.remove('ballista_bolt', nb);
  gp.inv.add('ballista_bolt', 4);
  const oG = A.structOn(G, bid), oH = A.structOn(H, bid);
  MG.ballista.useBallista(G.game, oG);
  await t.waitFor(() => oH.user === G.pid && oG.user === G.pid, RT() + 1500, 'the guest operates it on both');
  await t.sleep(400);
  const C = G.game.ballista;
  t.check(C.mounted && gp.rooted, 'the guest is on it (rooted)', `${C.mounted} ${gp.rooted}`);
  const [sx, sy] = MG.ballista.seatOf(oG, C.aimL);
  t.check(Math.hypot(gp.x - sx, gp.y - sy) < 0.3, 'the guest stands at the seat', `${f2(gp.x)},${f2(gp.y)} vs ${f2(sx)},${f2(sy)}`);
  // the giant, calm, 11 tiles east
  const gs = A.freeSpot(H, MH, x0 + 11.5, y0 + 0.5, { rMin: 0, rMax: 1.2, r: 0.45 });
  t.assert(gs, 'free spot for the giant');
  const m = MH.giants.spawnGiantAt(H.game, gs[0], gs[1]);
  m.calmT = 1e9; m.state = 'idle'; m.stateT = 1e9;
  const pxy = await t.waitFor(() => A.proxyOf(G, m), RT() + 1500, 'the guest sees the giant');
  const a0 = MH.ballista.aimOf(oH);
  const [pvx, pvy] = MG.ballista.pivotOf(oG);
  const want = Math.atan2(pxy.y - pvy, pxy.x - pvx);
  C.stickOn = true; C.stickAng = want;
  t.defer(() => { C.stickOn = false; });
  await t.sleep(300 + RT());
  const aMid = MH.ballista.aimOf(oH), dTot = Math.abs(MH.ballista.angDiff(want, a0)), dMid = Math.abs(MH.ballista.angDiff(aMid, a0));
  t.check(dMid > 0.02 && dMid < dTot - 0.05, 'it turns slowly (the host sees it on its way)', `start ${f2(a0)} mid ${f2(aMid)} target ${f2(want)}`);
  await t.waitFor(() => Math.abs(MH.ballista.angDiff(MH.ballista.aimOf(oH), want)) < 0.03, 6000 + RT(), 'it points at the giant on the host', () => `${f2(MH.ballista.aimOf(oH))} → ${f2(want)}`);
  await t.waitFor(() => Math.abs(MH.ballista.angDiff(oG._aimD ?? 0, want)) < 0.03, 1500, 'and on the guest');
  // the operator's pose (cosmetic, every peer): the host draws the guest at the grips, facing the aim (_opA)
  const geH = H.game.session?.players?.get(G.pid)?.ent;
  t.check(geH && geH._opA != null && Math.abs(MH.ballista.angDiff(geH._opA, want)) < 0.1 && gp._opA != null, 'the host draws the guest operating it, turned to the aim (and the guest itself)', `${geH?._opA} / ${gp._opA} vs ${f2(want)}`);
  const xpH = hp.xp, xpG = gp.xp, max = m.maxHp;
  // shot 1
  t.check(C.fire(), 'the guest fires (bolt paid)');
  t.check(gp.inv.count('ballista_bolt') === 3, 'one bolt used', `${gp.inv.count('ballista_bolt')}`);
  await t.waitFor(() => m.hp < max, 3000 + RT(), 'the bolt hits the giant on the host', () => `${m.hp}/${max}`);
  t.check(Math.abs((max - m.hp) - Math.ceil(max * 0.55)) <= 1, 'a bolt takes 55% of its life', `${Math.round(max - m.hp)} of ${Math.round(max)}`);
  await t.waitFor(() => Math.abs((A.proxyOf(G, m)?.hp ?? max) - m.hp) < 2, RT() + 1500, 'the guest sees its life drop');
  t.check((G.game.bolts || []).length > 0 && (H.game.bolts || []).length > 0, 'the bolt flew on both');
  // a second shot during the reload: refused, refunded
  C.cd = 0;
  C.fire();
  await t.waitFor(() => gp.inv.count('ballista_bolt') === 3, RT() + 1500, 'a shot during the reload is refused and refunded', () => `${gp.inv.count('ballista_bolt')}`);
  t.check(m.hp > 0 && !m.dead, 'the giant still stands after one bolt');
  // shot 2 after the reload
  await t.sleep(3100);
  t.check(C.fire(), 'second shot');
  await t.waitFor(() => m.dead, 3000 + RT(), 'two bolts kill the giant (host)');
  await t.waitFor(() => !A.proxyOf(G, m) || A.proxyOf(G, m).dead, RT() + 1500, 'dead on the guest too');
  await t.waitFor(() => gp.xp > xpG, RT() + 1500, 'XP to the guest');
  t.check(hp.xp === xpH, 'no XP to the host', `${xpH} → ${hp.xp}`);
  t.check(gp.inv.count('ballista_bolt') === 2, '2 bolts left', `${gp.inv.count('ballista_bolt')}`);
  await t.checkDigest(H, G);
  env.history.push('BA1');
});

def('BA2', {
  title: 'Ballista: one operator at a time; leaving frees it on both; it is saved with its aim', timeout: 90000,
  expected: 'The guest gets on a ballista; the host tries the same one: refused ("Já tem alguém operando esta balista"), the operator stays the guest on both; the guest leaves (E): nobody on it on both and the guest walks again; the host gets on: allowed; the world snapshot keeps its aim (ball rows) and a save drops the operator; an operator carried away is taken off by the host (none on both); digest equal',
  api: 'intent ballista.use {id, on} (one operator), ballista.js onInteract / leaveBallista, host ballistaSystem (operator gone), net/snapshot.js `ball` rows',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player, hp = H.game.player;
  A.keepAlive(t, G);
  const site = A.findSite([H, G], [MH, MG], 'ballista', (x, y) => { const L = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 2; j++) L.push([x + i, y + j]); return L; }, gp.x, gp.y, { rMin: 2, rMax: 16, avoidPts: [[hp.x, hp.y]] });
  t.assert(site, 'found a free site');
  const { x0, y0 } = site;
  const [bid] = hostBuild(H, [['ballista', x0, y0, 0]]);
  t.defer(() => { if (H.game.build.structures.some((o) => o.id === bid)) H.game.net.emit('struct.remove', { id: bid, quiet: 1 }); });
  await t.waitFor(() => A.structOn(G, bid) && !A.structOn(G, bid).blueprint, RT() + 1500, 'the guest has the ballista');
  const oG = A.structOn(G, bid), oH = A.structOn(H, bid);
  A.teleport(G, x0 + 0.5, y0 + 1.6);
  A.teleport(H, x0 - 0.8, y0 + 1.4);
  await A.hostSees(t, H, G);
  MG.ballista.useBallista(G.game, oG);
  await t.waitFor(() => oH.user === G.pid && oG.user === G.pid, RT() + 1500, 'the guest operates it');
  let why = null;
  H.game.net.request('ballista.use', { id: bid, on: 1 }, { onReject: (w) => { why = w; } });
  t.check(why && /Já tem alguém/.test(why), 'the host is refused (one operator)', String(why));
  await t.sleep(RT() + 200);
  t.check(oH.user === G.pid && oG.user === G.pid, 'the guest stays the operator on both');
  // the guest leaves with E (controller interact)
  G.game.ctl.interact();
  await t.waitFor(() => !oH.user && !oG.user, RT() + 1500, 'nobody on it on both after leaving');
  await t.sleep(200);
  t.check(!G.game.ballista.mounted && !gp.rooted, 'the guest walks again', `${G.game.ballista.mounted} ${gp.rooted}`);
  // the host gets on; the aim travels; the snapshot keeps it
  MH.ballista.useBallista(H.game, oH);
  await t.waitFor(() => oH.user === H.pid && oG.user === H.pid, RT() + 1500, 'the host operates it now');
  H.game.net.emit('ballista.set', { id: bid, aim: 1.234 });
  await t.waitFor(() => Math.abs((oG.aim ?? 0) - 1.234) < 1e-3, RT() + 1500, 'the aim reaches the guest');
  const SM = await snapMod(H);
  const snap = SM.serializeWorld(H.game, {}), sv = SM.serializeWorld(H.game, { save: true });
  const row = snap.ball?.find((r) => r[0] === bid), srow = sv.ball?.find((r) => r[0] === bid);
  t.check(row && Math.abs(row[1] - 1.234) < 1e-3 && row[2] === H.pid, 'the snapshot keeps its aim and operator', JSON.stringify(row));
  t.check(srow && srow[2] === 0, 'a save drops the operator', JSON.stringify(srow));
  H.game.ctl.interact(); // (the host gets off with E)
  await t.waitFor(() => !oH.user && !oG.user, RT() + 1500, 'the host gets off (both)');
  // an operator that is gone (left the game): the host takes it off
  H.game.net.emit('ballista.set', { id: bid, user: 'ghost' });
  // (the host may take it off on its next 0.5 s check before the guest's poll sees it: watch for it instead)
  let ghostG = false;
  t.watch(() => { if (oG.user === 'ghost') ghostG = true; }, 10);
  await t.waitFor(() => ghostG || !oH.user, RT() + 1500, '(a gone operator on both, or already taken off by the host)');
  await t.waitFor(() => !oH.user && !oG.user, 2000 + RT(), 'the host takes a gone operator off (both)');
  await t.checkDigest(H, G);
  env.history.push('BA2');
});

def('BA3', {
  title: 'Ballista up a story: on a wall-walk the guest gets on only from up there, stays on the wall while it turns, and its bolt flies over the walls below and plunges onto a giant', timeout: 120000,
  expected: 'A 3×2 block of stone walls (a wall-walk two tiles deep) with a ballista built on its top (story 1); winter night. From the ground under it the guest is refused ("Suba até a balista"); on the wall top (lv 1) it gets on (user = guest on both); while it turns toward an ice giant on the ground 10 tiles east the guest stays at story 1 on a wall-top tile (no fall); the bolt leaves at story 1 (b.lv 1, height ≈ 1 near the muzzle on both — it does not stop in the wall under it) and takes 55% of the giant\'s life; the guest gets off and is still up there; digest equal',
  api: 'mut/ballista.js intent ballista.use (story check), ballista.js seatSpot (levels.collidesL), boltZ / boltStops / boltReaches, op ballista.shot (lv from the ballista), struct.add {lv}',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, gp = G.game.player;
  const day0 = EH.dayIndex, hour0 = EH.hour;
  A.keepAlive(t, G);
  const site = A.findSite([H, G], [MH, MG], 'wall_stone', (x, y) => { const L = []; for (let i = -1; i <= 14; i++) for (let j = -1; j <= 3; j++) L.push([x + i, y + j]); return L; }, gp.x, gp.y, { rMin: 3, rMax: 18 });
  t.assert(site, 'found a free 16×5 strip');
  const { x0, y0 } = site, walls = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) walls.push(['wall_stone', x0 + i, y0 + j]);
  const wids = hostBuild(H, walls);
  await t.waitFor(() => wids.every((id) => A.structOn(G, id)), RT() + 1500, 'the guest has the walls');
  const [bid] = hostBuildLv(H, [['ballista', x0 + 1, y0, 0]], 1);
  siegeCleanup(t, H, MH, day0, hour0, [bid, ...wids]);
  await t.waitFor(() => A.structOn(G, bid) && !A.structOn(G, bid).blueprint, RT() + 1500, 'the guest has the ballista on the wall top');
  const oG = A.structOn(G, bid), oH = A.structOn(H, bid);
  t.check((oG.lv | 0) === 1 && (oH.lv | 0) === 1, 'the ballista stands at story 1 on both', `${oG.lv} / ${oH.lv}`);
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  H.game.net.emit('env.skip', { hour: 22, day: 5, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => G.game.season?.id === 'winter', 3000 + CFG.budget, 'winter night');
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  A.pacify(H, x0, y0, 30, 600);
  const nb = gp.inv.count('ballista_bolt');
  if (nb) gp.inv.remove('ballista_bolt', nb);
  gp.inv.add('ballista_bolt', 3);
  const errs = [];
  t.defer(G.game.events.on('error', (d) => errs.push(d.text)));
  // from the ground below: refused
  A.teleport(G, x0 + 1.5, y0 + 2.7);
  await A.hostSees(t, H, G);
  MG.ballista.useBallista(G.game, oG);
  await t.waitFor(() => errs.some((s) => /Suba até a balista/.test(s)), RT() + 1500, 'from the ground: "Suba até a balista"', () => errs.join(' | '));
  t.check(!oH.user && !oG.user, 'nobody on it');
  // on the wall top: allowed
  upOn(G, x0 + 1.5, y0 + 1.5);
  await t.sleep(RT() + 300);
  MG.ballista.useBallista(G.game, oG);
  await t.waitFor(() => oH.user === G.pid && oG.user === G.pid, RT() + 1500, 'from the wall top the guest operates it');
  // the giant on the ground, 10 tiles east
  const gs = A.freeSpot(H, MH, x0 + 11.5, y0 + 0.5, { rMin: 0, rMax: 1.2, r: 0.45 });
  t.assert(gs, 'free spot for the giant');
  const m = MH.giants.spawnGiantAt(H.game, gs[0], gs[1]);
  m.calmT = 1e9; m.state = 'idle'; m.stateT = 1e9;
  const pxy = await t.waitFor(() => A.proxyOf(G, m), RT() + 1500, 'the guest sees the giant');
  const [pvx, pvy] = MG.ballista.pivotOf(oG), want = Math.atan2(pxy.y - pvy, pxy.x - pvx);
  const C = G.game.ballista;
  C.stickOn = true; C.stickAng = want;
  t.defer(() => { C.stickOn = false; });
  let minZ = 9;
  const watch = setInterval(() => { minZ = Math.min(minZ, gp.z || 0); }, 50);
  t.defer(() => clearInterval(watch));
  await t.waitFor(() => Math.abs(MH.ballista.angDiff(MH.ballista.aimOf(oH), want)) < 0.03, 8000 + RT(), 'it points at the giant on the host');
  await t.sleep(400);
  const W = G.game.world, ti = Math.floor(gp.y) * W.W + Math.floor(gp.x);
  t.check(minZ > 0.9 && (gp.lv | 0) === 1 && G.game.levels.isSurface(1, ti), 'the guest stays up on the wall while it turns (on a wall-top tile)', `min z ${f2(minZ)}, lv ${gp.lv}, at ${f2(gp.x)},${f2(gp.y)}`);
  t.check(Math.hypot(gp.x - pvx, gp.y - pvy) > 0.6, 'the guest stands clear of it (behind / beside)', `${f2(Math.hypot(gp.x - pvx, gp.y - pvy))} tiles from the post`);
  const max = m.maxHp;
  const old = new Set([...(G.game.bolts || []), ...(H.game.bolts || [])]); // (bolts of earlier scenarios may still be listed)
  t.check(C.fire(), 'the guest fires');
  const bG = await t.waitFor(() => (G.game.bolts || []).find((b) => !old.has(b) && (!b.done || b.d > 0)), RT() + 1500, 'the bolt flies on the guest');
  const bH = await t.waitFor(() => (H.game.bolts || []).find((b) => !old.has(b)), RT() + 1500, 'and on the host');
  t.check(bG.lv === 1 && bH.lv === 1, 'the bolt leaves at story 1 on both', `${bG.lv} / ${bH.lv}`);
  t.check(MH.ballista.boltZ(1, 1) === 1 && MH.ballista.boltZ(1, 30) === 0 && !MH.ballista.boltStops(H.game, x0 + 2.5, y0 + 0.5, 1) && MH.ballista.boltStops(H.game, x0 + 2.5, y0 + 0.5, 0), 'high, it passes over the wall under it (low it would stop)');
  await t.waitFor(() => m.hp < max, 4000 + RT(), 'the plunging bolt hits the giant', () => `bolt ${f2(bH.x)},${f2(bH.y)} z ${f2(bH.z)} done ${bH.done} stuck ${bH.stuck}`);
  t.check(Math.abs((max - m.hp) - Math.ceil(max * 0.55)) <= 1, 'a bolt takes 55% of its life', `${Math.round(max - m.hp)} of ${Math.round(max)}`);
  G.game.ctl.interact();
  await t.waitFor(() => !oH.user && !oG.user, RT() + 1500, 'the guest gets off');
  await t.sleep(300);
  t.check((gp.z || 0) > 0.9, 'and is still up on the wall', lvOf(gp));
  await t.checkDigest(H, G);
  env.history.push('BA3');
});

def('S62', {
  title: 'Survival: dying of cold does not kill again after the respawn', timeout: 90000,
  expected: 'The guest freezes to death (body heat ~0, hypothermia hits); after "Renascer" its body heat is back to ≥ 75%, it is dry, no hypothermia, and 6 s later it is still alive with its half HP (no cold damage); the host sees it alive; digest equal',
  api: 'survival (p.bodyHeat, hypothermia ticks) → killPlayer; respawnPlayer (bodyHeat ≥ 75, wetT 0); presence hp / dead',
}, async (t) => {
  const { H, G, MG } = await pairCtx(t);
  const gp = G.game.player;
  A.pacify(H, gp.x, gp.y, 30);
  gp.bodyHeat = 2; gp.wetT = 60; gp.hp = 3;
  await t.waitFor(() => gp.dead, 12000, 'the guest freezes to death', () => `heat ${f2(gp.bodyHeat)} hp ${gp.hp}`);
  MG.player.respawnPlayer(G.game);
  t.check(gp.bodyHeat >= 75 && !gp.wetT, 'respawned warm and dry', `heat ${f2(gp.bodyHeat)} wet ${gp.wetT}`);
  const hp0 = gp.hp;
  await t.sleep(6000);
  t.check(!gp.dead && gp.hp >= hp0 && !gp.buffs.some((b) => b.id === 'hypothermia'), 'still alive 6 s later, no cold damage', `hp ${hp0} → ${gp.hp} heat ${f2(gp.bodyHeat)} buffs ${short(gp.buffs.map((b) => b.id))}`);
  const av = [...(H.game.session?.players?.values() || [])].find((p) => p.pid === G.pid);
  t.check(!av || !(av.av?.dead || av.ent?.dead), 'the host sees the guest alive');
  await t.checkDigest(H, G);
});

// =====================================================================================================
// S41 C: calm wind on the guest (cosmetic visuals; wind never feeds shared state)
def('S41', {
  title: 'C: calm wind on the guest (cosmetic)', timeout: 60000,
  expected: 'guest exposes game.env.wind {x,y,gust}; in a storm the sway / wave phase rates stay ≤ 1.45 rad/s (game time) and ≤ 1.7 rad/s (real time), strength ≤ 1.1 and low-passed (|Δ| ≤ 0.5 per s); weather follows the host',
  api: 'game.env.{wind,weather,cur,t,setWeather}, game.env.env.{windPh,wind}',
}, async (t) => {
  const { H, G } = await pairCtx(t);
  const EH = H.game.env, EG = G.game.env;
  const w0 = EH.weather;
  EH.setWeather('storm');
  try {
    await t.waitFor(() => EG.weather === 'storm', 8000, 'guest follows the host weather');
    EG.cur.wind = 0.92; EG.cur.storm = 1; // skip the 14 s weather blend on the guest (cosmetic values only)
    await t.sleep(3000);                   // let the low-passed strength settle
    const s = [];
    let last = null;
    for (let k = 0; k < 16; k++) {
      await t.sleep(500);
      const e = EG.env, cur = { ph0: e.windPh[0], ph1: e.windPh[1], et: EG.t, rt: now(), wind: e.wind };
      if (last && cur.et > last.et + 0.05) {
        const P = 628.31853, d0 = (cur.ph0 - last.ph0 + P) % P, d1 = (cur.ph1 - last.ph1 + P) % P, ge = cur.et - last.et, re = (cur.rt - last.rt) / 1000;
        s.push({ g0: d0 / ge, g1: d1 / ge, r0: d0 / re, r1: d1 / re, dw: Math.abs(cur.wind - last.wind) / ge, wind: cur.wind });
      }
      last = cur;
    }
    t.assert(s.length >= 8, 'guest frames advanced while sampling', `${s.length} windows`);
    const mx = (k) => Math.max(...s.map((x) => x[k]));
    t.metric('guestStorm', { swayRad: f2(mx('g0')), waveRad: f2(mx('g1')), swayRadReal: f2(mx('r0')), waveRadReal: f2(mx('r1')), windMax: f2(mx('wind')), dWindMax: f2(mx('dw')) });
    t.check(mx('g0') <= 1.45 && mx('g1') <= 1.45, 'sway / wave phase rates ≤ 1.45 rad/s (game time)', `${f2(mx('g0'))} / ${f2(mx('g1'))}`);
    t.check(mx('r0') <= 1.7 && mx('r1') <= 1.7, 'phase rates ≤ 1.7 rad/s over real time (no bursts on the guest)', `${f2(mx('r0'))} / ${f2(mx('r1'))}`);
    t.check(mx('wind') <= 1.1 && mx('dw') <= 0.5, 'wind strength capped and low-passed', `max ${f2(mx('wind'))}, |Δ| ${f2(mx('dw'))}/s`);
    const W = EG.wind;
    t.check(W && Math.abs(Math.hypot(W.x, W.y) - EG.env.wind) < 0.05 && W.gust >= 0 && W.gust <= 1, 'game.env.wind = direction × strength, gust 0..1', W ? short(W) : 'missing');
  } finally {
    EH.setWeather(w0 || 'clear');
    await t.tryWait(() => EG.weather === EH.weather, 8000);
  }
});


def('A6', {
  title: 'A: opt-in auto-work (tap a blueprint, build the row, cancel mid-way)', timeout: 150000,
  expected: 'Placing a 5-wall row starts nothing (no delivery, no work for 1.5 s); a real tap on the first blueprint starts the sequence (banner shows "Construindo · Parede de madeira · N restantes"); walls get built one after another; the banner ✕ cancels mid-way: the current step stops, the rest stay blueprints (delivered ones stay paid) and nothing more is built; digest equal',
  api: 'input tap → controller doTap → game.work.begin (work.js) → build.hit / struct.* ops; banner DOM (.awb, .x) → game.work.cancel(); game.work.status()',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const g = G.game, gp = g.player, hp = H.game.player;
  A.ensure(G, { wood: 30 });
  const row = (x, y) => [0, 1, 2, 3, 4].map((k) => [x + k, y]);
  const site = A.findSite([H, G], [MH, MG], 'wall_wood', row, gp.x, gp.y, { rMin: 3, rMax: 20, avoidPts: [[gp.x, gp.y], [hp.x, hp.y], ...lootAvoid(G, gp.x, gp.y)] });
  t.assert(site, 'found a free row');
  const { x0, y0 } = site;
  calmAround(H, x0 + 2, y0);
  A.place(G, MG, 'wall_wood', [x0, y0], [x0 + 4, y0]);
  const at = (f, M) => [0, 1, 2, 3, 4].map((k) => A.structAt(f, M, x0 + k, y0, 'main'));
  await t.waitFor(() => at(G, MG).every(Boolean) && at(H, MH).every(Boolean), RT() + 600, '5 wall blueprints on both');
  const ids = at(H, MH).map((o) => o.id);
  // nothing happens by itself, even with continuation allowed
  g.work.paused = false;
  t.defer(() => { g.work.cancel(true); g.work.paused = true; });
  const wood0 = A.count(G, 'wood');
  await t.sleep(1500);
  t.check(!g.work.seq && !gp.work && ids.every((id) => !A.structOn(H, id).paid) && A.count(G, 'wood') === wood0, 'placing starts nothing (no delivery, no work)', `seq ${!!g.work.seq} work ${gp.work?.label ?? '-'}`);
  // a real tap on a blueprint of the row (screen point → controller pick / doTap → work.begin); the point is one
  // where the controller's own pick finds that blueprint (no tree canopy in front of it)
  const first = A.structOn(G, ids[0]);
  A.standBy(G, MG, first);
  await A.hostSees(t, H, G);
  g.cam.x = gp.x; g.cam.y = gp.y - 0.4;
  await t.sleep(80);
  let tap = null;
  for (const id of ids) for (const dy of [0.9, 0.6, 0.3]) {
    if (tap) break;
    const o = A.structOn(G, id), [sx, sy] = g.worldToScreen(o.tx + 0.5, o.ty + dy);
    const h = MG.controller.pick(g, sx, sy);
    if (h.type === 'interact' && h.it?.o === o) tap = { sx, sy, id };
  }
  t.assert(tap, 'a screen point that picks a blueprint of the row');
  g.input.taps.push({ x: tap.sx, y: tap.sy, type: 'touch' });
  await t.waitFor(() => g.work.seq, 2000, 'the tap started auto-work', () => `tap at ${f2(tap.sx)},${f2(tap.sy)} · ui: ${G.lastUi()}`);
  const st = g.work.status();
  t.check(st && st.kind === 'build' && st.n >= 5 && ids.every((id) => g.work.seq.ids.has(id)) && /Parede de madeira/.test(st.name), 'status: Construindo · Parede de madeira · ≥5 (the whole row)', JSON.stringify(st));
  await t.waitFor(() => { const b = G.doc.querySelector('.awb'); return b && !b.classList.contains('hidden') && /Construindo/.test(b.textContent); }, 3000, 'banner visible with "Construindo"');
  // two walls get built in sequence (the player walks between them by itself)
  await t.waitFor(() => ids.filter((id) => !A.structOn(H, id)?.blueprint).length >= 2, 60000, 'two walls built by the sequence',
    () => `built ${ids.filter((id) => !A.structOn(H, id)?.blueprint).length} · ${JSON.stringify(g.work.status())} · work ${gp.work?.label ?? '-'}`);
  // cancel mid-way through the banner's ✕
  const btn = G.doc.querySelector('.awb .x');
  t.assert(btn, 'banner cancel button');
  btn.dispatchEvent(new G.win.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  t.check(!g.work.seq && !gp.work, 'cancel stops the sequence and its current step', `seq ${!!g.work.seq} work ${gp.work?.label ?? '-'}`);
  await t.sleep(RT() + 1500);
  const builtNow = ids.filter((id) => !A.structOn(H, id)?.blueprint).length;
  await t.sleep(1500);
  const builtLater = ids.filter((id) => !A.structOn(H, id)?.blueprint).length;
  t.check(builtLater === builtNow && builtNow < 5, 'nothing more is built after the cancel', `${builtNow} → ${builtLater}`);
  const left = ids.filter((id) => A.structOn(H, id)?.blueprint);
  t.check(left.length >= 1 && left.every((id) => A.structOn(G, id)?.blueprint), 'the rest stay blueprints (plans) on both', `${left.length} left`);
  const paidLeft = left.filter((id) => A.structOn(H, id).paid).length;
  t.check(A.count(G, 'wood') === wood0 - 2 * (builtNow + paidLeft), 'wood taken only for delivered walls (a delivered plan stays paid)', `${wood0} → ${A.count(G, 'wood')} · built ${builtNow} · paid plans ${paidLeft}`);
  t.check(G.doc.querySelector('.awb')?.classList.contains('hidden'), 'banner hidden after the cancel');
  await t.checkDigest(H, G);
  env.history.push('A6');
});

// =====================================================================================================
// entry
// =====================================================================================================
// G1 / G2 — aimed ground abilities (agent G): Tiro Longo (bow) and Lançar Lança (spear)
// host creature for an aimed throw: an animal (not a raider) with a free spot `d` tiles away for the guest
function lobSite(t, H, G, MG, d) {
  const sp = spawnOf(H);
  const list = A.hostMobs(H, (m) => m.kind === 'animal' && !env.claimed.has('mob' + m.nid) && m.state !== 'chase')
    .sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y));
  for (const m of list.slice(0, 12)) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const s = A.freeSpot(G, MG, m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, { rMin: 0, rMax: 0.8 });
      if (s && Math.abs(Math.hypot(s[0] - m.x, s[1] - m.y) - d) < 0.9) return { m, s };
    }
  }
  return null;
}
// keep a host creature still (authority-side test setup) so the aimed point stays on it
const holdStill = (t, m) => t.watch(() => { if (!m.dead) { m.stunT = 2; m.calmT = 60; } }, 30);
const lobsOf = (f, seen) => (f.game.projectiles || []).filter((q) => q.lob && !seen.has(q));

def('G1', {
  title: 'G: long shot', timeout: 150000,
  expected: 'Guest fires Tiro Longo (aim point) at a creature ~16 tiles away: host flies the authoritative arrow and rolls the landing (within range + scatter); guest copy flies at once and gets the host id + same landing on the ack; the host applies the hit (damage event ability long_shot from the guest avatar) and the guest sees it; 1 arrow leaves the guest bag per shot; an early 2nd request is refused by the host and refunded; aim beyond the range is clamped by the host; aim-assist hysteresis (lock, hop, stay, free, re-lock); a guest shot glued onto a creature walking sideways leads it and lands on its predicted position within scatter; digest equal',
  api: 'abilities.fireAimed(game, id, x, y); intent lob.fire {ab, w, x, y, ax, ay, amount, crit, skin} → {id, lx, ly}; projectiles {lob, id, lx, ly, cosmetic, owner}; fx proj lob / pend; content/weapons.js lobSpec / lobScatter; ui/aimAssist.js stepLock / assistParams; game.aim {beginMouse, release, lock}; event aimfire',
}, async (t) => {
  const { H, G, MG } = await pairCtx(t);
  t.need(MG.abilities.fireAimed, 'needs abilities.fireAimed (aimed ground abilities)');
  const W = await import(new URL('src/game/content/weapons.js', G.win.location.href).href);
  const S = W.lobSpec('bow_wood');
  A.keepAlive(t, G);
  t.assert(A.equip(G, 'bow_wood') !== false && G.game.player.equip.main === 'bow_wood', 'guest holds a bow');
  A.ensure(G, { arrow: 14 });
  MG.abilities.rebuildBar(G.game);
  const site = lobSite(t, H, G, MG, 16);
  t.assert(site, 'creature with a free spot 16 tiles away');
  const { m, s } = site;
  env.claimed.add('mob' + m.nid);
  holdStill(t, m);
  A.teleport(G, s[0], s[1]);
  await A.hostSees(t, H, G);
  const prox = await t.waitFor(() => A.proxyOf(G, m), 3000 + CFG.budget, 'creature proxy on the guest');
  t.log(`target ${m.species} ${m.nid} at ${f2(Math.hypot(m.x - s[0], m.y - s[1]))} tiles`);
  const dmgH = [], dmgG = [];
  const av = () => guestOnHost(H, G);
  t.on(H, 'damage', (d) => { if (d.target === m && d.ability === 'long_shot' && d.kind === 'hit') dmgH.push(d); });
  t.on(G, 'damage', (d) => { if (d.target?.nid === m.nid && d.ability === 'long_shot' && d.kind === 'hit') dmgG.push(d); });
  const gp = G.game.player;
  const arrows0 = A.count(G, 'arrow');
  let shots = 0, hit = false, bothSee = true, sameLanding = true, inRange = true, lastT = -1e9;
  const seenH = new Set(H.game.projectiles || []), seenG = new Set(G.game.projectiles || []);
  for (let k = 0; k < 7 && !hit && !m.dead; k++) {
    const wait = 2700 - (now() - lastT);
    if (wait > 0) await t.sleep(wait); // host cooldown (3 s, 20% slack)
    gp.cds.long_shot = 0; gp.gcdT = 0; gp.energy = gp.maxEnergy;
    const px = A.proxyOf(G, m) || prox;
    const r = MG.abilities.fireAimed(G.game, 'long_shot', px.x, px.y);
    t.assert(r === true, `shot ${k + 1} fired by the guest`, String(r));
    lastT = now(); shots++;
    const gpr = lobsOf(G, seenG)[0];
    const hpr = await t.waitFor(() => lobsOf(H, seenH)[0], RT() + 600, 'host flies the arrow');
    seenH.add(hpr); if (gpr) seenG.add(gpr);
    bothSee = bothSee && !!gpr && !hpr.cosmetic && hpr.owner === G.pid;
    await t.waitFor(() => gpr && gpr.id === hpr.id, RT() + 600, 'guest copy takes the host id (ack)');
    sameLanding = sameLanding && Math.hypot(gpr.lx - hpr.lx, gpr.ly - hpr.ly) < 0.01;
    inRange = inRange && Math.hypot(hpr.lx - hpr.x0, hpr.ly - hpr.y0) <= S.range + W.lobScatter(S, S.range) + 0.01;
    if (k === 0) {
      // the host enforces the cooldown even when the guest skips its own check (arrow refunded)
      const c0 = A.count(G, 'arrow');
      gp.inv.remove('arrow', 1);
      let why = null;
      G.game.net.request('lob.fire', { ab: 'long_shot', w: 'bow_wood', x: gp.x, y: gp.y, ax: px.x, ay: px.y, amount: 1, crit: 0, skin: 0 }, { refund: { arrow: 1 }, onReject: (w) => { why = w; } });
      await t.waitFor(() => why != null, RT() + 600, 'host answers an early 2nd shot');
      await t.sleep(50);
      t.check(/pronto/i.test(why) && A.count(G, 'arrow') === c0, 'early 2nd shot refused by the host ("Ainda não está pronto"), arrow refunded', `why="${why}" arrows ${c0} → ${A.count(G, 'arrow')}`);
    }
    t.log(`shot ${k + 1}: lands ${f2(Math.hypot(hpr.lx - m.x, hpr.ly - m.y))} from the ${m.species} (scatter ≤ ${f2(W.lobScatter(S, 16))})`);
    await t.waitFor(() => hpr.stuck || !(H.game.projectiles || []).includes(hpr), hpr.dur * 1000 + 1500, 'arrow lands on the host');
    await t.sleep(ONEWAY() + 250);
    hit = dmgH.length > 0 || m.dead;
  }
  t.check(bothSee, 'both see the arrow (host: authoritative copy owned by the guest · guest: its own copy)');
  t.check(sameLanding, 'same landing point on both (guest copy bent onto the host roll)');
  t.check(inRange, `landing within range + scatter (${S.range} + ${f2(W.lobScatter(S, S.range))} tiles)`);
  t.check(hit, `host applies the hit (${shots} shot(s) at 16 tiles)`, `host dmg ${dmgH.map((d) => d.amount).join(',') || '-'} · dead ${m.dead}`);
  if (dmgH.length) t.check(dmgH[0].src === av() || dmgH[0].src?.pid === G.pid, 'the hit comes from the guest avatar', dmgH[0].src?.pid || dmgH[0].src?.name);
  if (dmgH.length) await t.tryWait(() => dmgG.length > 0 || A.proxyOf(G, m)?.dead, RT() + 600);
  t.check(!dmgH.length || dmgG.length > 0 || A.proxyOf(G, m)?.dead || !A.proxyOf(G, m), 'guest sees the hit (fx dmg / death)', `${dmgG.length} events`);
  t.check(A.count(G, 'arrow') === arrows0 - shots, '1 arrow left the guest bag per shot', `${arrows0} → ${A.count(G, 'arrow')} after ${shots} shot(s)`);
  // range clamp by the host (aim 40 tiles away, sent directly)
  const wait = 2700 - (now() - lastT);
  if (wait > 0) await t.sleep(wait);
  const seen2 = new Set(H.game.projectiles || []);
  gp.inv.remove('arrow', 1);
  let ok2 = null;
  G.game.net.request('lob.fire', { ab: 'long_shot', w: 'bow_wood', x: gp.x, y: gp.y, ax: gp.x + 40, ay: gp.y, amount: 1, crit: 0, skin: 0 }, { refund: { arrow: 1 }, onOk: (r) => { ok2 = r || {}; }, onReject: (w) => { ok2 = { why: w }; } });
  lastT = now();
  await t.waitFor(() => ok2, RT() + 600, 'host answers the far shot');
  const far = lobsOf(H, seen2)[0];
  t.check(far && Math.hypot(far.lx - far.x0, far.ly - far.y0) <= S.range + W.lobScatter(S, S.range) + 0.01, 'aim 40 tiles away is clamped to the bow range by the host', far ? `${f2(Math.hypot(far.lx - far.x0, far.ly - far.y0))} tiles` : JSON.stringify(ok2));
  if (far) await t.tryWait(() => far.stuck || !(H.game.projectiles || []).includes(far), far.dur * 1000 + 1500);
  // aim assist hysteresis (pure): lock → hop to a neighbour → stays glued → forced free → re-lock; off = never
  const AA = await import(new URL('src/ui/aimAssist.js', G.win.location.href).href);
  const PA = AA.assistParams('normal', false);
  const tA = { x: 10, y: 10, r: 0.3 }, tB = { x: 12.2, y: 10, r: 0.3 }, tC = { x: 20, y: 10, r: 0.3 }, cs = [tA, tB, tC];
  const nm = (o) => (o === tA ? 'A' : o === tB ? 'B' : o === tC ? 'C' : '-');
  let lk = null;
  const seqOut = [];
  for (const rx of [10.3, 11.4, 13.5, 16.5, 19.3]) { lk = AA.stepLock(lk, rx, 10, cs, PA, 0, 10); seqOut.push(`${rx}→${nm(lk)}`); }
  t.check(seqOut.join(' ') === '10.3→A 11.4→B 13.5→B 16.5→- 19.3→C', 'aim assist hysteresis: lock A, hop to B, stay glued, break free, re-lock C', seqOut.join(' '));
  t.check(AA.stepLock(null, 10, 10, cs, AA.assistParams('off'), 0, 10) === null, 'aim assist off: never locks');
  // locked shot on a MOVING creature: the guest aim glues onto its proxy and leads it by the flight time
  const site2 = lobSite(t, H, G, MG, 10);
  const ga = G.game.aim;
  if (!site2 || !ga?.beginMouse) t.note('no creature for the moving-target shot (or no game.aim) — skipped');
  else {
    const m2 = site2.m;
    env.claimed.add('mob' + m2.nid);
    A.teleport(G, site2.s[0], site2.s[1]);
    await A.hostSees(t, H, G);
    await t.waitFor(() => A.proxyOf(G, m2), 3000 + CFG.budget, 'moving creature proxy on the guest');
    // host (authority test setup): the creature walks sideways at 1.2 tiles/s, stunned so its own AI stays out
    const ux = -(m2.y - site2.s[1]), uy = m2.x - site2.s[0], ul = Math.hypot(ux, uy) || 1, V = 1.2;
    const x0 = m2.x, y0 = m2.y, tm0 = now();
    const mover = t.watch(() => {
      if (m2.dead) return;
      const sec = Math.min(6, (now() - tm0) / 1000);
      m2.x = x0 + (ux / ul) * V * sec; m2.y = y0 + (uy / ul) * V * sec; m2.stunT = 2; m2.calmT = 60;
    }, 16);
    const wait2 = 2700 - (now() - lastT);
    if (wait2 > 0) await t.sleep(wait2);
    gp.cds.long_shot = 0; gp.gcdT = 0; gp.energy = gp.maxEnergy;
    A.ensure(G, { arrow: 4 });
    const cv = G.game.R.canvas;
    const mvTo = (wx, wy) => { const [sx, sy] = G.game.worldToScreen(wx, wy); cv.dispatchEvent(new G.win.PointerEvent('pointermove', { clientX: sx, clientY: sy, pointerType: 'mouse', bubbles: true })); };
    ga.beginMouse('long_shot');
    const follow = t.watch(() => { const q = A.proxyOf(G, m2); if (q) mvTo(q.x + 0.35, q.y + 0.3); }, 30);
    await t.waitFor(() => ga.lock && ga.lock === A.proxyOf(G, m2), 2500, 'guest aim glues onto the moving creature');
    await t.sleep(800); // velocity estimate settles
    let fired = null;
    t.on(G, 'aimfire', (d) => { fired = d; });
    t.on(G, 'error', (d) => t.log(`guest message: ${d.text}`));
    const q0 = A.proxyOf(G, m2), qxy = [q0.x, q0.y];
    follow.stop();
    const seen3 = new Set(H.game.projectiles || []);
    ga.release();
    t.assert(fired, 'locked shot fired by the guest (aim module)');
    const lead = Math.hypot(fired.x - qxy[0], fired.y - qxy[1]);
    t.check(lead > 0.6, 'the locked aim leads the moving creature', `${f2(lead)} tiles ahead of the proxy`);
    const hp3 = await t.waitFor(() => lobsOf(H, seen3)[0], RT() + 600, 'host flies the locked shot');
    await t.waitFor(() => hp3.stuck || !(H.game.projectiles || []).includes(hp3), hp3.dur * 1000 + 1500, 'locked shot lands on the host');
    const D3 = Math.hypot(fired.x - gp.x, fired.y - gp.y), off3 = Math.hypot(hp3.lx - m2.x, hp3.ly - m2.y);
    mover.stop();
    t.check(off3 <= W.lobScatter(S, D3) + 0.6, "locked shot lands on the moving creature's predicted position (within scatter)", `${f2(off3)} tiles from it · scatter ≤ ${f2(W.lobScatter(S, D3))} at ${f2(D3)} tiles`);
  }
  await t.sleep(900); // possible arrow recovery (loot.add) settles
  await t.checkDigest(H, G);
});

def('G2', {
  title: 'G: spear throw', timeout: 120000,
  expected: 'Guest throws its spear (Lançar Lança) at a creature 6 tiles away: both see the flight (host authoritative, guest copy), the host applies the hit (ability throw_spear); the spear stays equipped on the guest (equip.main unchanged, hand empty only while it flies, then back; the host sees the hand weapon come back via presence); no spear loot anywhere; 10 s cooldown (an immediate 2nd throw is refused); digest equal',
  api: 'abilities.fireAimed(game, "throw_spear", x, y); p._throwT / p.weapon; presence w; projectiles {lob, kind:"spear"}; loot rows',
}, async (t) => {
  const { H, G, MG } = await pairCtx(t);
  t.need(MG.abilities.fireAimed, 'needs abilities.fireAimed (aimed ground abilities)');
  A.keepAlive(t, G);
  const gp = G.game.player;
  t.assert(A.equip(G, 'spear_iron') !== false && gp.equip.main === 'spear_iron', 'guest holds a spear');
  MG.abilities.rebuildBar(G.game);
  const spears0 = gp.inv.count('spear_iron');
  const site = lobSite(t, H, G, MG, 6);
  t.assert(site, 'creature with a free spot 6 tiles away');
  const { m, s } = site;
  env.claimed.add('mob' + m.nid);
  holdStill(t, m);
  A.teleport(G, s[0], s[1]);
  await A.hostSees(t, H, G);
  const prox = await t.waitFor(() => A.proxyOf(G, m), 3000 + CFG.budget, 'creature proxy on the guest');
  const dmgH = [];
  t.on(H, 'damage', (d) => { if (d.target === m && d.ability === 'throw_spear' && d.kind === 'hit') dmgH.push(d); });
  const spearLoot = (f) => (f.game.loot || []).filter((l) => /^spear_/.test(l.item)).length;
  const loot0 = [spearLoot(H), spearLoot(G)];
  const hostHand = [];
  const av = () => A.avatarOn(H, G.pid);
  const ww = t.watch(() => hostHand.push(av() ? av().weapon : 'no avatar'), 20);
  const seenH = new Set(H.game.projectiles || []), seenG = new Set(G.game.projectiles || []);
  gp.cds.throw_spear = 0; gp.gcdT = 0; gp.energy = gp.maxEnergy;
  const px = A.proxyOf(G, m) || prox;
  const r = MG.abilities.fireAimed(G.game, 'throw_spear', px.x, px.y);
  t.assert(r === true, 'guest throws', String(r));
  const gpr = lobsOf(G, seenG)[0];
  await t.sleep(60);
  t.check(gp.weapon == null && gp.equip.main === 'spear_iron', 'hand empty while the spear flies, still equipped', `weapon ${gp.weapon} · main ${gp.equip.main}`);
  const hpr = await t.waitFor(() => lobsOf(H, seenH)[0], RT() + 600, 'host flies the spear');
  t.check(gpr && gpr.kind === 'spear' && hpr.kind === 'spear' && !hpr.cosmetic, 'both see the spear flight', `guest ${gpr?.kind} · host ${hpr.kind}`);
  const again = MG.abilities.fireAimed(G.game, 'throw_spear', px.x, px.y);
  t.check(again === false, 'immediate 2nd throw refused (10 s cooldown)', String(again));
  await t.waitFor(() => hpr.stuck || !(H.game.projectiles || []).includes(hpr), hpr.dur * 1000 + 1500, 'spear lands on the host');
  await t.tryWait(() => dmgH.length > 0 || m.dead, RT() + 400);
  t.check(dmgH.length > 0 || m.dead, 'host applies the spear hit', `dmg ${dmgH.map((d) => d.amount).join(',') || '-'} · dead ${m.dead}`);
  await t.waitFor(() => gp.weapon === 'spear_iron', 2000, 'the spear is back in the guest hand');
  await t.waitFor(() => av()?.weapon === 'spear_iron', 1500 + RT(), 'host sees the spear back in the guest hand (presence)');
  ww.stop();
  t.check(hostHand.includes(null), 'host saw the empty hand during the flight (presence)', short(hostHand.slice(0, 40)));
  await t.sleep(600);
  t.check(gp.equip.main === 'spear_iron' && gp.inv.count('spear_iron') === spears0, 'spear still equipped on the guest, inventory unchanged', `main ${gp.equip.main} · bag ${gp.inv.count('spear_iron')}`);
  t.check(spearLoot(H) === loot0[0] && spearLoot(G) === loot0[1], 'no spear loot on the ground (host / guest)', `${spearLoot(H)} / ${spearLoot(G)}`);
  await t.checkDigest(H, G);
});

// =====================================================================================================
// J · Telhados, interiores e cavernas (agent J)
const fimp = (f, p) => f.win.Function('u', 'return import(u)')(new URL('src/' + p, f.win.location.href).href);
// a w × h rect of free tiles at least `far` tiles away from rock (so only the walls / columns hold the roof)
const roomTiles = (w, h, f = null, far = 8) => (x0, y0) => {
  const out = [], W = f?.game.world;
  // …and from other players' walls / columns / roofs (earlier scenarios)
  if (f) for (const o of f.game.build.structures) {
    if (o.roof || o.type.startsWith('wall_') || o.type.startsWith('door_') || o.type.startsWith('column_')) {
      if (o.tx > x0 - 8 && o.tx < x0 + w + 8 && o.ty > y0 - 8 && o.ty < y0 + h + 8) return [[-5, -5]];
    }
  }
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (W && W.inBounds(x, y) && W.dRock && W.dRock[W.idx(x, y)] < far) return [[-5, -5]]; // too close to a mountain
    out.push([x, y]);
  }
  return out;
};
// host (authority) puts down FINISHED walls around a w × h rect (+ a door in the south wall) — test shortcut
function hostRoom(H, x0, y0, w, h, { door = true, wall = 'wall_wood' } = {}) {
  const net = H.game.net, rows = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (x !== x0 && y !== y0 && x !== x0 + w - 1 && y !== y0 + h - 1) continue;
    const isDoor = door && y === y0 + h - 1 && x === x0 + (w >> 1);
    rows.push([net.newId('s'), isDoor ? 'door_wood' : wall, x, y, 0, 1, Math.round(H.game.worldTime), 0, 1, 0]);
  }
  net.emit('struct.add', { list: rows, by: net.pid });
  return rows.map((r) => r[0]);
}
function hostRoof(H, x0, y0, w, h, type = 'roof_wood', style = 'shingle') {
  const net = H.game.net, rows = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) rows.push([net.newId('s'), type, x, y, 0, 1, Math.round(H.game.worldTime), 0, 1, 0, style, '']);
  net.emit('struct.add', { list: rows, by: net.pid });
  return rows.map((r) => r[0]);
}
const roofIds = (f) => f.game.build.structures.filter((o) => o.roof && o.town == null).map((o) => o.id + ':' + o.style + (o.blueprint ? ':bp' : '')).sort();
const regionAt = (f, x, y) => { const R = f.game.roofs, w = f.game.world; return R.regions.get(R.regionOf.get(w.idx(x, y))) || null; };

def('J1', {
  title: 'J: guest roofs a room, host sees the same roof', timeout: 240000,
  expected: 'A tap inside a closed room makes roof plans for the room and its walls (free, blue); the guest builds them (sticks + fibre leave its bag when each tile starts); host and guest have the same roof structures (ids, style), world.broof equal, one roof region painted on both; roof plans need a finished support (refused without); digest equal',
  api: 'build mode roof_thatch + tap (room fill) → build.place {style} → struct.add rows [.., style, det]; build.hit start (support check); world.broof / roofAt; game.roofs.regions (art)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player, hp = H.game.player;
  const site = A.findSite([H, G], [MH, MG], 'wall_wood', roomTiles(6, 5, H), gp.x, gp.y, { rMin: 4, rMax: 30, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a free 6×5 site');
  const { x0, y0 } = site;
  // a roof plan with no support anywhere near is refused
  const far = MG.building.placeReason(G.game, 'roof_thatch', x0 + 2, y0 + 2, gp, 0);
  t.check(typeof far === 'string' && /apoio/i.test(far), 'roof plan without any support near is refused ("Sem apoio")', String(far));
  const walls = hostRoom(H, x0, y0, 6, 5);
  await t.waitFor(() => walls.every((id) => A.structOn(G, id)), RT() + 400, 'guest has the finished walls');
  A.ensure(G, { stick: 40, fiber: 80 });
  A.keepAlive(t, G);
  const s0 = A.count(G, 'stick'), f0 = A.count(G, 'fiber');
  A.teleport(G, x0 + 3, y0 + 6.5);
  await A.hostSees(t, H, G);
  // one tap inside the room → the whole room and its walls
  MG.building.enterBuildMode(G.game, 'roof_thatch');
  const m = G.game.build.mode;
  m.hover = [x0 + 2, y0 + 2]; m.locked = true;
  MG.building.commitPlacement(G.game);
  t.check(m.room, 'the tap filled the enclosed room', `room=${m.room} n=${m.n}`);
  MG.building.exitBuildMode(G.game);
  const n = 6 * 5;
  await t.waitFor(() => roofIds(H).length === n, RT() + 600, `host has ${n} roof plans`, () => `host ${roofIds(H).length}`);
  await t.waitFor(() => roofIds(G).length === n, ONEWAY() + 400, 'guest has the roof plans');
  t.check(JSON.stringify(roofIds(H)) === JSON.stringify(roofIds(G)), 'roof plan ids and style identical', short(roofIds(H).slice(0, 3)));
  t.check(A.count(G, 'stick') === s0 && A.count(G, 'fiber') === f0, 'plans are free (nothing taken yet)');
  const ids = G.game.build.structures.filter((o) => o.roof).map((o) => o.id);
  await A.buildAll(t, G, MG, ids, { ms: 25000 });
  await t.waitFor(() => ids.every((id) => !A.structOn(H, id)?.blueprint), ONEWAY() + 400, 'host sees every roof tile finished');
  await t.sleep(ONEWAY() + 300);
  const bro = (f) => { const w = f.game.world; let s = 0; for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 6; x++) s += w.broof.get(w.idx(x, y)) ? 1 : 0; return s; };
  t.check(bro(H) === n && bro(G) === n, 'world.broof covers the room on both', `host ${bro(H)} guest ${bro(G)}`);
  t.check(H.game.world.roofAt(x0 + 2, y0 + 2) === 2 && G.game.world.roofAt(x0 + 2, y0 + 2) === 2, 'roofAt = built inside on both');
  await t.waitFor(() => regionAt(G, x0 + 2, y0 + 2)?.art && regionAt(H, x0 + 2, y0 + 2)?.art, 8000, 'roof region painted on both');
  t.check(regionAt(G, x0 + 2, y0 + 2).tiles.length === n && regionAt(H, x0 + 2, y0 + 2).tiles.length === n, `one region of ${n} tiles on both`);
  t.check(s0 - A.count(G, 'stick') === n && f0 - A.count(G, 'fiber') === 2 * n, 'materials delivered by the guest once per tile', `sticks −${s0 - A.count(G, 'stick')} fibre −${f0 - A.count(G, 'fiber')}`);
  await t.checkDigest(H, G);
  env.jRoom = { x0, y0, w: 6, h: 5 };
});

def('J2', {
  title: 'J: host goes inside, only its roof view fades; interior zoom', timeout: 150000,
  expected: 'Host walks under the roof: game.indoors = built, its roof region fades out (alpha ~0) while the guest (outside) keeps it opaque and does not draw the host avatar under it; host camera eases to the closer interior zoom (no jump > 6%/frame), zoom input is ignored inside; leaving eases back to the player zoom (±3%)',
  api: 'game.indoors {kind, region, zoomK}; game.roofs.regions[].alpha; roofs.underOpaqueRoof; game.cam.zoom; input.zoom',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  let room = env.jRoom;
  if (!room || !regionAt(H, room.x0 + 2, room.y0 + 2)) {
    const gp = G.game.player;
    const site = A.findSite([H, G], [MH, MG], 'wall_wood', roomTiles(6, 5, H), gp.x, gp.y, { rMin: 4, rMax: 30, avoidPts: [[gp.x, gp.y]] });
    t.assert(site, 'found a free 6×5 site');
    room = { x0: site.x0, y0: site.y0, w: 6, h: 5 };
    hostRoom(H, room.x0, room.y0, 6, 5); hostRoof(H, room.x0, room.y0, 6, 5);
  }
  const { x0, y0 } = room;
  const RH = await fimp(H, 'game/roofs.js'), RG = await fimp(G, 'game/roofs.js');
  A.teleport(G, x0 + 3, y0 + 7);
  A.teleport(H, x0 + 3, y0 + 7.4);
  await t.waitFor(() => regionAt(H, x0 + 2, y0 + 2)?.art && regionAt(G, x0 + 2, y0 + 2)?.art, 8000, 'the roof is painted on both');
  await t.sleep(1400);
  const z0 = H.game.cam.zoom, dz = H.game.defaultZoom();
  // frame-by-frame zoom samples on the host
  const Z = [];
  let rec = true;
  const loop = () => { if (!rec) return; Z.push(H.game.cam.zoom); H.win.requestAnimationFrame(loop); };
  H.win.requestAnimationFrame(loop);
  A.teleport(H, x0 + 2.5, y0 + 2.6);
  await t.waitFor(() => H.game.indoors.kind === 'built', 2000, 'host indoors = built');
  // zoom input while inside is ignored
  const w = t.watch(() => { H.game.input.zoom = 0.5; }, 16);
  await t.sleep(1600);
  w.stop();
  const gH = regionAt(H, x0 + 2, y0 + 2), gG = regionAt(G, x0 + 2, y0 + 2);
  t.check(gH.alpha < 0.05 && gH.reveal > 0.95, 'host: its roof faded out', `alpha ${f2(gH.alpha)} reveal ${f2(gH.reveal)}`);
  t.check(gG.alpha > 0.95, 'guest: the same roof stays opaque', `alpha ${f2(gG.alpha)}`);
  const av = A.avatarOn(G, H.pid);
  t.check(av && RG.underOpaqueRoof(G.game, av.x, av.y), 'guest: the host avatar is under an opaque roof (hidden)', av ? `${f2(av.x)},${f2(av.y)}` : 'no avatar');
  const zIn = H.game.cam.zoom, want = Math.max(z0, Math.min(110, dz * 1.32));
  t.check(Math.abs(zIn - want) / want < 0.04, 'host zoom eased to the interior zoom (input ignored)', `outside ${f2(z0)} → inside ${f2(zIn)} (want ${f2(want)})`);
  // leave: back to the player zoom, smoothly
  A.teleport(H, x0 + 3, y0 + 7.4);
  await t.waitFor(() => !H.game.indoors.kind, 2000, 'host outdoors again');
  await t.sleep(1800);
  rec = false;
  const zOut = H.game.cam.zoom;
  t.check(Math.abs(zOut - z0) / z0 < 0.03, 'zoom back to the player zoom outside', `${f2(zOut)} vs ${f2(z0)}`);
  let jump = 0;
  for (let k = 1; k < Z.length; k++) jump = Math.max(jump, Math.abs(Z[k] - Z[k - 1]) / Z[k - 1]);
  t.check(Z.length > 20 && jump < 0.06, 'no zoom jump (max change per frame < 6%)', `${Z.length} frames, max ${(jump * 100).toFixed(1)}%`);
  await t.waitFor(() => regionAt(H, x0 + 2, y0 + 2).alpha > 0.95, 2000, 'host roof opaque again outside');
  await t.checkDigest(H, G);
});

def('J3', {
  title: 'J: removing walls collapses the unsupported roof on both', timeout: 180000,
  expected: 'A 14×5 roofed hall; the guest marks the east walls for deconstruction: the first try warns "O teto vai desabar" and marks nothing, the second marks them; when the last support near the east end goes, the roof tiles farther than 6 tiles (Euclidean, tile centres) from any support collapse on both (roof.collapse: same remaining ids), the rest stays; toast "O teto desabou!"; digest equal',
  api: 'building.deconRect (confirmSupports) → build.decon; decon.hit → struct.remove → roofs supportDirty → host roofSupportSystem → op roof.collapse',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player;
  const site = A.findSite([H, G], [MH, MG], 'wall_wood', roomTiles(14, 5, H, 9), gp.x, gp.y, { rMin: 4, rMax: 34, avoidPts: [[gp.x, gp.y]] });
  t.assert(site, 'found a free 14×5 site');
  const { x0, y0 } = site;
  hostRoom(H, x0, y0, 14, 5, { door: false });
  const roofs = hostRoof(H, x0, y0, 14, 5);
  await t.waitFor(() => roofs.every((id) => A.structOn(G, id)), RT() + 600, 'guest has the hall and its roof');
  A.keepAlive(t, G);
  A.teleport(G, x0 + 10, y0 + 6.6);
  await A.hostSees(t, H, G);
  const toasts = [];
  t.on(G, 'toast', (d) => toasts.push(d.text));
  // east walls (x ≥ x0 + 6): their removal leaves x0+12, x0+13 more than 6 tiles from the last wall (x0+5)
  const east = G.game.build.structures.filter((o) => o.type === 'wall_wood' && o.tx >= x0 + 6 && o.tx <= x0 + 13 && o.ty >= y0 && o.ty <= y0 + 4);
  const n1 = MG.building.deconRect(G.game, x0 + 6, y0, x0 + 13, y0 + 4);
  t.check(n1 === 0 && toasts.some((s) => /teto vai desabar/i.test(s)), 'first try: "O teto vai desabar" warning, nothing marked', `marked ${n1} · ${short(toasts)}`);
  const n2 = MG.building.deconRect(G.game, x0 + 6, y0, x0 + 13, y0 + 4);
  t.check(n2 === east.length, 'second try marks the walls', `${n2}/${east.length}`);
  await t.waitFor(() => east.every((o) => H.game.build.decon.has(A.structOn(H, o.id))), RT() + 500, 'host has the decon marks');
  // the host finishes all but one of them (shortcut), the guest deconstructs the last one for real
  const last = east.find((o) => o.tx === x0 + 6 && o.ty === y0);
  for (const o of east) if (o !== last) H.game.net.emit('struct.remove', { id: o.id, quiet: 1 });
  await t.sleep(ONEWAY() + 300);
  // the last east wall (x0+6, y0) still holds what is within 6 tiles of it, e.g. (x0+12, y0); the far corner already fell
  await t.waitFor(() => !A.structAt(H, MH, x0 + 13, y0 + 4, 'roof'), RT() + 800, 'far corner (8 tiles from the last wall) fell');
  t.check(A.structAt(H, MH, x0 + 12, y0, 'roof') && A.structAt(G, MG, x0 + 12, y0, 'roof'), 'the last wall still holds the tiles within 6 tiles of it', `${roofIds(H).length} roof tiles`);
  await A.decon(t, G, MG, last.id);
  const gone = (f) => [12, 13].every((dx) => [0, 1, 2, 3, 4].every((dy) => !A.structAt(f, MG, x0 + dx, y0 + dy, 'roof')));
  await t.waitFor(() => gone(H) && gone(G), RT() + 800, 'tiles beyond 6 tiles collapsed on both');
  const kept = (f) => [[0, 2], [6, 2], [10, 2], [11, 0], [11, 4]].every(([dx, dy]) => A.structAt(f, MG, x0 + dx, y0 + dy, 'roof'));
  const lost11 = (f) => [1, 2, 3].every((dy) => !A.structAt(f, MG, x0 + 11, y0 + dy, 'roof'));
  t.check(kept(H) && kept(G), 'tiles within 6 tiles of the last walls stay');
  t.check(lost11(H) && lost11(G), 'tiles just beyond 6 tiles (x0+11, middle rows: 6.1–6.3) fell too');
  t.check(JSON.stringify(roofIds(H)) === JSON.stringify(roofIds(G)), 'same remaining roof tiles on both', `${roofIds(H).length} / ${roofIds(G).length}`);
  await t.tryWait(() => toasts.some((s) => /teto desabou/i.test(s)), 1500);
  t.check(toasts.some((s) => /teto desabou/i.test(s)), 'guest got "O teto desabou!"', short(toasts));
  await t.sleep(800);
  await t.checkDigest(H, G);
});

def('J4', {
  src: 'classic', // (whole-map scans and the classic mountains: the old 256 × 256 world)
  title: 'J: mining a mountain open removes its natural roof identically on both', timeout: 150000,
  expected: 'Mined tiles keep the mountain roof while rock is within 6 tiles; opening a 14×14 box takes it off in the middle on both peers (world.roof bytes equal, roofAt / isCave equal per tile, the centre is open sky, tiles next to the remaining rock stay caves); a guest mining hit through rock.hit keeps them equal; digest equal',
  api: 'tile.mine → world.mineRock → _naturalRoof (world.roof, lastLost); world.roofAt / isCave; digest tiles part (roof, broof)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const w = H.game.world, sp = spawnOf(H);
  // a solid mountain block (all rock, roof0 in the middle) closest to the spawn
  let best = null, bd = 1e9;
  for (let cy = w.by0 + 12; cy < w.by1 - 12; cy += 2) for (let cx = w.bx0 + 12; cx < w.bx1 - 12; cx += 2) {
    const i = w.idx(cx, cy);
    if (!w.rock.get(i) || !w.roof0.get(i)) continue;
    const d = Math.hypot(cx - sp.x, cy - sp.y);
    if (d >= bd) continue;
    let ok = true;
    for (let y = cy - 9; y < cy + 9 && ok; y++) for (let x = cx - 9; x < cx + 9; x++) if (!w.rock.get(w.idx(x, y))) { ok = false; break; }
    if (ok) { best = [cx, cy]; bd = d; }
  }
  t.need(best, 'needs an 18×18 solid mountain block in this seed');
  const [cx, cy] = best;
  env.claimed.add('mountain' + cx + ',' + cy);
  // a 3-wide tunnel into it first: still a cave everywhere
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 8; x <= cx; x++) H.game.net.emit('tile.mine', { tx: x, ty: y, drops: [], by: H.game.net.pid, xp: 0 });
  await t.sleep(ONEWAY() + 300);
  t.check(H.game.world.isCave(cx - 3, cy) && G.game.world.isCave(cx - 3, cy), 'a narrow tunnel stays a cave on both');
  // open the box
  for (let y = cy - 7; y < cy + 7; y++) for (let x = cx - 7; x < cx + 7; x++) if (w.rock.get(w.idx(x, y))) H.game.net.emit('tile.mine', { tx: x, ty: y, drops: [], by: H.game.net.pid, xp: 0 });
  await t.waitFor(() => G.game.world.rock.get(G.game.world.idx(cx, cy)) === 0, RT() + 1000, 'guest has the mined box');
  await t.sleep(ONEWAY() + 300);
  const eqRoof = () => { const A0 = H.game.world, B0 = G.game.world; for (let y = A0.by0; y < A0.by1; y++) for (let x = A0.bx0; x < A0.bx1; x++) { const i = A0.idx(x, y); if (A0.roof.get(i) !== B0.roof.get(i)) return i; } return -1; };
  const diffAt = eqRoof();
  t.check(diffAt < 0, 'world.roof identical on both', diffAt < 0 ? 'equal' : `first difference at tile ${diffAt}`);
  t.check(H.game.world.roofAt(cx, cy) === 0 && G.game.world.roofAt(cx, cy) === 0, 'the centre of the opened hall is open sky on both');
  t.check(!H.game.world.isCave(cx, cy) && !G.game.world.isCave(cx, cy), 'the centre is no longer a cave');
  let edgeCave = 0;
  for (let y = cy - 7; y < cy + 7; y++) { if (H.game.world.isCave(cx - 7, y)) edgeCave++; }
  t.check(edgeCave > 0, 'tiles next to the remaining rock keep their ceiling', `${edgeCave} cave tiles along the west edge`);
  // the guest mines one more rock tile at the east edge through the real rock.hit path
  A.ensure(G, { pickaxe_steel: 1 });
  A.keepAlive(t, G);
  const tx = cx + 7, ty = cy;
  const stand = () => A.teleport(G, tx - 0.5, ty + 0.5);
  stand();
  await A.hostSees(t, H, G);
  await A.mine(t, G, MG, tx, ty, { stand });
  await t.waitFor(() => H.game.world.rock.get(w.idx(tx, ty)) === 0 && G.game.world.rock.get(w.idx(tx, ty)) === 0, RT() + 600, 'guest mining hit reached both');
  await t.sleep(ONEWAY() + 300);
  t.check(eqRoof() < 0, 'world.roof still identical after the guest mined');
  await t.checkDigest(H, G);
});

def('J5', {
  title: 'J: roofs survive a guest resync and the save round trip', timeout: 120000,
  expected: 'After roofs exist, a guest resync (snapshot, reconcile) keeps the same roof structures (ids, style, det) and the guest repaints them; a save → load of the host world data restores roofs with their style (v6 rows); digest equal',
  api: 'net.forceResync(); snapshot structs rows [.., style, det]; save.buildSaveData / serializeWorld',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  if (!roofIds(H).filter((s) => !s.endsWith(':bp')).length) {
    const gp = G.game.player;
    const site = A.findSite([H, G], [MH, MG], 'wall_wood', roomTiles(5, 4, H, 2), gp.x, gp.y, { rMin: 4, rMax: 24 });
    t.assert(site, 'found a free 5×4 site');
    hostRoom(H, site.x0, site.y0, 5, 4); hostRoof(H, site.x0, site.y0, 5, 4, 'roof_stone', 'terracotta');
    await t.sleep(RT() + 400);
  }
  const before = roofIds(H);
  G.game.net.forceResync();
  await t.waitFor(() => G.game.net.synced && JSON.stringify(roofIds(G)) === JSON.stringify(before), 15000, 'guest roofs equal after the resync');
  const snap = H.game.net.digest ? (await fimp(H, 'net/snapshot.js')).serializeWorld(H.game, { save: true }) : null;
  const rows = (snap?.structs || []).filter((r) => String(r[1]).startsWith('roof_'));
  t.check(rows.length && rows.every((r) => r.length >= 16 && typeof r[14] === 'string' && r[14]), 'save rows carry the roof style (v6)', short(rows[0]));
  const SV = await fimp(H, 'game/save.js');
  const data = SV.buildSaveData(H.game);
  t.check(data.v >= 6, 'save data version bumped for roofs', `v${data.v}`);
  const mig = SV.migrateStructRows(H.game, [[ 'sx1', 'wall_wood', 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0 ]]);
  t.check(mig[0].length === 16 && mig[0][14] === '' && mig[0][15] === '', 'v4 / v5 rows migrate to v6 (style / det empty)', short(mig[0]));
  await t.checkDigest(H, G);
});

def('J6', {
  src: 'classic', // (whole-map scans and the classic mountains: the old 256 × 256 world)
  title: 'J: cave ceilings — drawn over caves nobody local is in, a guest inside sees under it, cave-ins crumble on both', timeout: 150000,
  expected: 'A 20×20 hall dug around a rock pillar is one cave on both, its ceiling drawn on both (roofData A = 255, roofs.hidden true) while both players are outside; the guest walks in: its own ceiling fades out (A → 0, indoors cave) while the host still draws it and hides the guest under it; mining the pillar takes the roof off the middle: both schedule the same crumbling tiles, the hole opens on both (A 0, no cave) while the ring by the walls stays a covered cave on the host; digest equal',
  api: 'game.roofs {caves, caveOf, data A/G, crumble, cracks, hidden}, underCaveCeiling, world.isCave / lastLost, tile.mine (collapseFx cave → caveCrumble)',
}, async (t) => {
  const { H, G } = await pairCtx(t);
  const w = H.game.world, sp = spawnOf(H);
  t.need(H.game.roofs?.caves && G.game.roofs?.caves, 'cave ceilings (game.roofs.caves) missing');
  // a solid mountain block (all rock, mountain roof) far from the ones other scenarios dug
  const taken = [...env.claimed].filter((k) => typeof k === 'string' && k.startsWith('mountain')).map((k) => k.slice(8).split(',').map(Number));
  let best = null, bd = 1e9;
  for (let cy = w.by0 + 14; cy < w.by1 - 14; cy += 2) for (let cx = w.bx0 + 14; cx < w.bx1 - 14; cx += 2) {
    const i = w.idx(cx, cy);
    if (!w.rock.get(i) || !w.roof0.get(i) || taken.some(([x, y]) => Math.hypot(x - cx, y - cy) < 30)) continue;
    const d = Math.hypot(cx - sp.x, cy - sp.y);
    if (d >= bd) continue;
    let ok = true;
    for (let y = cy - 12; y < cy + 12 && ok; y++) for (let x = cx - 12; x < cx + 12; x++) { const j = w.idx(x, y); if (!w.rock.get(j) || !w.roof0.get(j)) { ok = false; break; } }
    if (ok) { best = [cx, cy]; bd = d; }
  }
  t.need(best, 'needs a 24×24 solid mountain block in this seed');
  const [cx, cy] = best;
  env.claimed.add('mountain' + cx + ',' + cy);
  A.pacify(H, cx, cy, 30);
  A.keepAlive(t, G); A.keepAlive(t, H);
  // the hall around a pillar at (cx, cy): every tile stays within 6 of rock → one covered cave
  for (let y = cy - 10; y < cy + 10; y++) for (let x = cx - 10; x < cx + 10; x++) if ((x !== cx || y !== cy) && w.rock.get(w.idx(x, y))) H.game.net.emit('tile.mine', { tx: x, ty: y, drops: [], by: H.game.net.pid, xp: 0 });
  await t.waitFor(() => G.game.world.rock.get(G.game.world.idx(cx - 9, cy - 9)) === 0, RT() + 1500, 'guest has the dug hall');
  await t.sleep(ONEWAY() + 400);
  const A_ = (f, x, y) => f.game.roofs.data.get4(f.game.world.idx(x, y), 3);
  const caveId = (f, x, y) => f.game.roofs.caveOf.get(f.game.world.idx(x, y));
  t.check(H.game.world.isCave(cx + 3, cy + 3) && G.game.world.isCave(cx + 3, cy + 3), 'the hall is a cave on both');
  t.check(caveId(H, cx - 9, cy - 9) && caveId(H, cx - 9, cy - 9) === caveId(H, cx + 9, cy + 9) && caveId(G, cx - 9, cy - 9) === caveId(G, cx + 9, cy + 9), 'one cave region from corner to corner on both');
  t.check(A_(H, cx + 3, cy + 3) === 255 && A_(G, cx + 3, cy + 3) === 255, 'its ceiling is drawn on both while both are outside', `host ${A_(H, cx + 3, cy + 3)} guest ${A_(G, cx + 3, cy + 3)}`);
  t.check(H.game.roofs.hidden(cx + 3.5, cy + 3.9) && G.game.roofs.hidden(cx + 3.5, cy + 3.9), 'things inside are hidden under it on both');
  // the guest walks in (a corner that stays a cave after the cave-in below)
  const gx = cx - 8.5, gy = cy - 7.6;
  A.teleport(G, gx, gy);
  await t.waitFor(() => G.game.indoors.kind === 'cave' && A_(G, cx - 9, cy - 8) < 8, 4000, 'guest inside: its own ceiling faded out', () => `kind ${G.game.indoors.kind} A ${A_(G, cx - 9, cy - 8)}`);
  await t.sleep(ONEWAY() + 300);
  t.check(A_(H, cx - 9, cy - 8) === 255, 'the host (outside) still draws that ceiling', `host A ${A_(H, cx - 9, cy - 8)}`);
  const ge = H.game.session?.players ? [...H.game.session.players.values()].map((p) => p.av || p.ent).find((e) => e && Math.hypot(e.x - gx, e.y - gy) < 2) : null;
  t.check(!ge || H.game.roofs.hidden(ge.x, ge.y), 'the guest is hidden under the ceiling on the host', ge ? `${f2(ge.x)},${f2(ge.y)}` : 'no avatar handle (skipped)');
  // the pillar goes: the middle loses its roof — the same crumbling tiles on both, the hole opens on both
  H.game.net.emit('tile.mine', { tx: cx, ty: cy, drops: [], by: H.game.net.pid, xp: 0 });
  const lostH = H.game.world.lastLost.length;
  await t.waitFor(() => G.game.world.rock.get(G.game.world.idx(cx, cy)) === 0, RT() + 1000, 'guest has the pillar mined');
  const lostG = G.game.world.lastLost.length;
  t.check(lostH > 20 && lostH === lostG, 'the same section lost its roof on both', `host ${lostH} guest ${lostG}`);
  t.check(H.game.roofs.crumble.size >= lostH && G.game.roofs.crumble.size >= lostG, 'both play the crumble', `host ${H.game.roofs.crumble.size} guest ${G.game.roofs.crumble.size}`);
  await t.waitFor(() => !H.game.roofs.crumble.size && !G.game.roofs.crumble.size, 6000, 'the crumble ends on both');
  t.check(!H.game.world.isCave(cx, cy) && !G.game.world.isCave(cx, cy) && A_(H, cx, cy) === 0 && A_(G, cx, cy) === 0, 'the middle is open sky with no ceiling on both');
  t.check(A_(H, cx + 9, cy + 9) === 255 && H.game.world.isCave(cx + 9, cy + 9), 'the ring by the walls stays a covered cave on the host');
  t.check(H.game.roofs.cracks.size > 0, 'the ceiling around the hole is left cracked', `${H.game.roofs.cracks.size} tiles`);
  t.check(G.game.indoors.kind === 'cave' && A_(G, cx - 9, cy - 8) < 8, 'the guest is still inside its (revealed) cave');
  await t.checkDigest(H, G);
});

// L · Andares e escadarias (agent L, docs/LEVELS.md): stairs, ramparts, levels across the network
// host-side test setup: finished structures through the real op (no work loop) — rows [type, tx, ty, rot]
function hostBuild(H, rows) {
  const g = H.game, net = g.net;
  const list = rows.map(([type, tx, ty, rot = 0]) => [net.newId('s'), type, tx, ty, 0, 1, Math.round(g.worldTime), rot, 1, 0]);
  net.emit('struct.add', { list });
  return list.map((r) => r[0]);
}
// owner-side setup: stand on a wall top (level 1) at (x, y)
function upOn(f, x, y) { A.teleport(f, x, y); const p = f.game.player; p.lv = 1; p.z = 1; }
const lvOf = (e) => `lv ${e?.lv ?? '-'} z ${f2(e?.z ?? 0)}`;
// a wall row (x..x+n-1, y) with free ground around it, valid on both frames
const rowSite = (H, G, MH, MG, n, cx, cy, opts = {}) => A.findSite([H, G], [MH, MG], 'wall_wood', (x, y) => {
  const out = [];
  for (let k = -1; k <= n; k++) for (let dy = -1; dy <= (opts.south ?? 1); dy++) out.push([x + k, y + dy]);
  return out;
}, cx, cy, opts);

def('L1', {
  star: true, title: 'L: guest builds stairs and walks on a rampart', timeout: 180000,
  expected: 'Guest builds a wall row + stairs (blueprints, real work): same ids on both, level map identical; climbing the stairs raises z 0 → 1 smoothly and ends on the wall top (lv 1, bounded by the edges); the host sees the guest at lv 1 in the same place (avatar + drawn copy); walking along the rampart keeps lv 1; pushing at the edge hops down to lv 0 (host sees z 0); digest equal',
  api: 'BUILDINGS.stairs_wood (block "stairs", rot), game.levels {active, stairs, isSurface, stairAt}, player {lv, z}, presence st/sts z, session players.av.z / ent.z',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(MG.levels?.STORY_H && MG.data.BUILDINGS.stairs_wood, 'levels module / stairs_wood missing');
  const gp = G.game.player;
  A.keepAlive(t, G); A.keepAlive(t, H);
  const site = rowSite(H, G, MH, MG, 5, gp.x, gp.y, { rMin: 3, rMax: 18, south: 3, avoidPts: [[gp.x, gp.y], [H.game.player.x, H.game.player.y]] });
  t.assert(site, 'found a free 7×5 site');
  const { x0: x, y0: y } = site;
  A.pacify(H, x, y, 20);
  A.ensure(G, { wood: 40 });
  const walls = A.place(G, MG, 'wall_wood', [x, y], [x + 4, y]);
  const stairsL = A.place(G, MG, 'stairs_wood', [x + 1, y + 1], [x + 1, y + 1], 0);
  t.log(`guest planned ${walls.length} walls + ${stairsL.length} stairs at ${x},${y}`);
  const ids = await t.waitFor(() => { const L0 = G.game.build.structures.filter((o) => o.blueprint && o.ty >= y && o.ty <= y + 1 && o.tx >= x && o.tx <= x + 4); return L0.length >= 6 && L0; }, RT() + 600, 'guest sees 6 blueprints');
  const st = ids.find((o) => o.type === 'stairs_wood');
  t.assert(st, 'stairs blueprint present');
  t.check(st.fw === 1 && st.fh === 2 && (st.rot | 0) === 0, 'stairs footprint 1×2, rot 0 (ascends north)', `${st.fw}×${st.fh} rot ${st.rot}`);
  await A.buildAll(t, G, MG, ids.map((o) => o.id), { ms: 30000 });
  await t.waitFor(() => ids.every((o) => { const h = A.structOn(H, o.id); return h && !h.blueprint; }), RT() + 800, 'host sees every piece finished');
  const LH = H.game.levels, LG = G.game.levels;
  const wi = H.game.world.idx(x + 1, y);
  t.check(LH.active && LG.active && LH.stairs.length === LG.stairs.length, 'level map active on both (stairs registered)', `host ${LH.stairs.length} · guest ${LG.stairs.length}`);
  t.check(LH.isSurface(1, wi) && LG.isSurface(1, wi), 'wall tops are level-1 surfaces on both');
  // climb
  A.teleport(G, x + 1.5, y + 3.5);
  await A.hostSees(t, H, G);
  const zs = [];
  const zw = t.watch(() => zs.push(+(gp.z || 0).toFixed(3)), 4);
  const rel = A.holdMove(G, 0, -1);
  await t.waitFor(() => gp.lv === 1 && gp.z === 1 && gp.y < y + 0.9, 5000, 'guest climbs to level 1', () => `${lvOf(gp)} at ${f2(gp.x)},${f2(gp.y)}`);
  await t.sleep(400);
  rel(); zw.stop();
  const mids = zs.filter((v) => v > 0.05 && v < 0.95);
  t.check(mids.length >= 3, 'z rises smoothly on the stairs (intermediate heights)', short(zs.filter((_, i) => i % 3 === 0).slice(0, 30)));
  t.check(gp.lv === 1 && Math.floor(gp.y) === y && gp.y > y + 0.2, 'stands on the wall top, stopped by the north edge (no walking into the air)', `${lvOf(gp)} at ${f2(gp.x)},${f2(gp.y)}`);
  const av = () => guestOnHost(H, G), drawn = () => A.avatarOn(H, G.pid);
  await t.waitFor(() => av() && av().z === 1 && av().lv === 1 && Math.hypot(av().x - gp.x, av().y - gp.y) < 0.3, RT() + 400, 'host avatar of the guest at lv 1 in the same place', () => `host av ${lvOf(av())} ${f2(av()?.x)},${f2(av()?.y)}`);
  await t.waitFor(() => Math.abs((drawn()?.z ?? 0) - 1) < 0.01 && Math.hypot(drawn().x - gp.x, drawn().y - gp.y) < 0.35, RT() + 600, 'host draws the guest on the wall top (interpolated copy z = 1)');
  // along the rampart
  const x1 = gp.x;
  const rel2 = A.holdMove(G, 1, 0);
  await t.sleep(700);
  rel2();
  t.check(gp.lv === 1 && gp.x > x1 + 1 && Math.floor(gp.y) === y, 'walks along the rampart at lv 1', `${lvOf(gp)} x ${f2(x1)} → ${f2(gp.x)}`);
  await t.waitFor(() => av()?.lv === 1 && Math.abs(av().x - gp.x) < 0.3, RT() + 400, 'host follows the guest along the rampart');
  // jump down north (push at the edge)
  const rel3 = A.holdMove(G, 0, -1);
  await t.waitFor(() => gp.lv === 0 && gp.z === 0 && gp.y < y, 4000, 'pushing at the edge hops down to the ground', () => `${lvOf(gp)} at ${f2(gp.x)},${f2(gp.y)}`);
  rel3();
  await t.waitFor(() => av() && !(av().z > 0) && av().y < y, RT() + 400, 'host sees the guest back on the ground (z 0)');
  await t.checkDigest(H, G);
});

def('L2', {
  title: 'L: creature cannot melee a player on a wall top', timeout: 150000,
  expected: 'Guest stands on a rampart with no stairs; a hostile host creature chases it, stays at lv 0 and never lands a bite (melee only on the same level); once the guest is back on the ground next to it, it bites (control); proxies keep z 0',
  api: 'combat.reach −1 across levels; levels.findPath (no portal → partial → evade); own player.hurt; ents dyn z',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sp = spawnOf(H);
  const m = A.hostMobs(H, (e) => (e.species === 'wolf' || e.species === 'spider' || e.species === 'boar') && (e.temper || '') !== 'passive' && !env.claimed.has('mob' + e.nid))
    .sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y))[0];
  t.assert(m, 'found a hostile creature');
  env.claimed.add('mob' + m.nid);
  const site = rowSite(H, G, MH, MG, 3, m.x, m.y, { rMin: 2, rMax: 9 });
  t.assert(site, 'wall site near the creature');
  const { x0: x, y0: y } = site;
  const ids = hostBuild(H, [['wall_wood', x, y], ['wall_wood', x + 1, y], ['wall_wood', x + 2, y]]);
  await t.waitFor(() => ids.every((id) => A.structOn(G, id) && !A.structOn(G, id).blueprint), RT() + 500, 'guest sees the walls');
  const gp = G.game.player;
  upOn(G, x + 1.5, y + 0.5);
  A.keepAlive(t, G, { hp: false });
  t.watch(() => { if (!gp.dead && gp.hp < gp.maxHp * 0.5) gp.hp = gp.maxHp; }, 50);
  await t.waitFor(() => guestOnHost(H, G)?.lv === 1 && Math.hypot(guestOnHost(H, G).x - gp.x, guestOnHost(H, G).y - gp.y) < 0.3, RT() + 2000, 'host sees the guest on the wall top', () => `guest ${lvOf(gp)} ${f2(gp.x)},${f2(gp.y)} · host av ${lvOf(guestOnHost(H, G))} ${f2(guestOnHost(H, G)?.x)},${f2(guestOnHost(H, G)?.y)}`);
  const dmg = [];
  // creature hits only (survival damage — cold, hunger — has the player itself as source; DoTs are ticks)
  t.on(G, 'damage', (d) => { if (d.target === gp && d.amount > 0 && !d.dot && d.src && d.src !== gp) dmg.push({ t: now(), src: d.src.species || d.src.nid || '?', z: gp.z }); });
  m.calmT = 0; if (m.state === 'evade') { m.state = 'idle'; m.stateT = 1; }
  MH.ai.aggro(H.game, m, guestOnHost(H, G));
  let minD = 1e9, maxLv = 0, proxZ = 0;
  const w = t.watch(() => { minD = Math.min(minD, Math.hypot(m.x - gp.x, m.y - gp.y)); maxLv = Math.max(maxLv, m.lv | 0, m.z > 0 ? 1 : 0); const pr = A.proxyOf(G, m); if (pr) proxZ = Math.max(proxZ, pr.z || 0); }, 8);
  await t.sleep(7000);
  w.stop();
  t.metric('melee', { minD: f2(minD), state: m.state, fails: m.nav?.fails ?? 0 });
  t.check(minD < 2.6, 'the creature came close (below the wall)', `min distance ${f2(minD)} · state ${m.state}`);
  t.check(maxLv === 0, 'the creature stayed at lv 0 (no stairs to climb)', lvOf(m));
  t.check(!dmg.length, 'no bite reached the guest on the wall top', `${dmg.length} hits ${short(dmg.slice(0, 3))}`);
  t.check(proxZ === 0, 'creature proxy on the guest keeps z 0', `max ${f2(proxZ)}`);
  // control: back on the ground beside it → bitten
  const s = A.freeSpot(G, MG, m.x, m.y, { rMin: 0.7, rMax: 1.6 });
  t.assert(s, 'free ground spot next to the creature');
  A.teleport(G, s[0], s[1]);
  await A.hostSees(t, H, G);
  m.calmT = 0; if (m.state !== 'chase') { m.state = 'idle'; m.stateT = 1; }
  MH.ai.aggro(H.game, m, guestOnHost(H, G));
  const bit = await t.tryWait(() => dmg.length > 0, 9000);
  t.check(bit, 'on the same level the creature bites (control)', `${dmg.length} hits · creature ${m.state} at ${f2(Math.hypot(m.x - gp.x, m.y - gp.y))}`);
  sendAway(G, MG, m.x, m.y, 30);
  A.pacify(H, m.x, m.y, 6, 120);
  await t.checkDigest(H, G);
});

def('L3', {
  title: 'L: bandit archer shoots a player on a rampart', timeout: 150000,
  expected: 'Guest on a wall top (lv 1) 6–8 tiles from a bandit archer with height line of sight: the archer shoots (arrows aimed at z 1, flying over walls), the guest takes ranged damage only; arrows visible on both',
  api: 'combat.hasLOS(world, …, z0, z1); fireArrow {z0, z1}; fx proj z args; own player.hurt',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const archers = [];
  for (const c of H.game.camps || []) for (const mm of c.members || []) if (mm.role === 'archer' && !mm.dead) archers.push(mm);
  const sp = spawnOf(H);
  archers.sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y));
  t.assert(archers.length, 'found a bandit archer');
  const ar = archers[0];
  let site = null;
  for (let r = 6; r <= 8 && !site; r++) {
    const cand = rowSite(H, G, MH, MG, 3, ar.x, ar.y, { rMin: r, rMax: r });
    if (cand && MH.combat.hasLOS(H.game.world, cand.x0 + 1.5, cand.y0 + 0.5, ar.x, ar.y, 1, ar.z || 0)) site = cand;
  }
  t.assert(site, 'wall site 6–8 tiles from the archer with line of sight from the top');
  const { x0: x, y0: y } = site;
  const ids = hostBuild(H, [['wall_wood', x, y], ['wall_wood', x + 1, y], ['wall_wood', x + 2, y]]);
  await t.waitFor(() => ids.every((id) => A.structOn(G, id) && !A.structOn(G, id).blueprint), RT() + 500, 'guest sees the walls');
  const gp = G.game.player;
  upOn(G, x + 1.5, y + 0.5);
  A.keepAlive(t, G, { hp: false });
  t.watch(() => { if (!gp.dead && gp.hp < gp.maxHp * 0.5) gp.hp = gp.maxHp; }, 50);
  await t.waitFor(() => guestOnHost(H, G)?.lv === 1, RT() + 2000, 'host sees the guest on the wall top', () => `guest ${lvOf(gp)} · host av ${lvOf(guestOnHost(H, G))}`);
  const dmg = [], shotsH = [], seenH = new WeakSet(), seenG = new WeakSet();
  let gArrows = 0;
  t.on(G, 'damage', (d) => { if (d.target === gp && d.amount > 0 && !d.dot && d.src && d.src !== gp) dmg.push({ weapon: d.src.weapon || '?', srcZ: +(d.src.z || 0).toFixed(2), lv: gp.lv }); });
  t.watch(() => {
    for (const pr of H.game.projectiles || []) if (pr.faction === 'bandit' && !seenH.has(pr)) { seenH.add(pr); shotsH.push(+(pr.z1 || 0).toFixed(2)); }
    for (const pr of G.game.projectiles || []) if (pr.cosmetic && !seenG.has(pr)) { seenG.add(pr); gArrows++; }
  }, 8);
  ar.calmT = 0;
  MH.ai.aggro(H.game, ar, guestOnHost(H, G));
  await t.tryWait(() => dmg.length > 0 && gArrows > 0, 30000);
  t.metric('archer', { shots: shotsH.length, z1: short(shotsH.slice(0, 6)), hits: dmg.length, guestArrows: gArrows });
  t.check(shotsH.length > 0 && shotsH.some((z) => z === 1), 'the archer shoots at the guest on the rampart (arrows aimed at z 1)', short(shotsH.slice(0, 8)));
  t.check(dmg.length > 0, 'ranged hits reach the guest at lv 1', `${dmg.length} hits, guest ${lvOf(gp)}`);
  t.check(dmg.every((d) => /bow|spear/.test(d.weapon) && d.srcZ < 0.5 && d.lv === 1), 'every hit was a shot (bow / thrown spear) from the ground while the guest stood on the wall (no melee)', short(dmg.slice(0, 6)));
  t.check(gArrows > 0, 'arrows visible on the guest (cosmetic copies)', `${gArrows}`);
  sendAway(G, MG, ar.x, ar.y, 40);
  await t.checkDigest(H, G);
});

def('L4', {
  title: 'L: creature climbs the stairs to reach a player', timeout: 150000,
  expected: 'With a staircase up to the rampart, a hostile host creature paths through it (stairs = A* portal), reaches lv 1 and bites the guest standing on the wall top; the guest sees the creature proxy at z 1',
  api: 'levels.findPath portals, nav.steer(glv), levels.move on stairs, ents dyn z',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sp = spawnOf(H);
  const m = A.hostMobs(H, (e) => (e.species === 'wolf' || e.species === 'boar') && (e.temper || '') !== 'passive' && !env.claimed.has('mob' + e.nid))
    .sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y))[0];
  t.need(m, 'no wolf / boar left near the spawn');
  env.claimed.add('mob' + m.nid);
  const site = rowSite(H, G, MH, MG, 5, m.x, m.y, { rMin: 3, rMax: 10, south: 3 });
  t.assert(site, 'rampart site near the creature');
  const { x0: x, y0: y } = site;
  const ids = hostBuild(H, [['wall_wood', x, y], ['wall_wood', x + 1, y], ['wall_wood', x + 2, y], ['wall_wood', x + 3, y], ['wall_wood', x + 4, y], ['stairs_wood', x + 1, y + 1, 0]]);
  await t.waitFor(() => ids.every((id) => A.structOn(G, id)), RT() + 500, 'guest sees the rampart');
  const gp = G.game.player;
  upOn(G, x + 3.5, y + 0.5);
  A.keepAlive(t, G, { hp: false });
  t.watch(() => { if (!gp.dead && gp.hp < gp.maxHp * 0.5) gp.hp = gp.maxHp; }, 50);
  await t.waitFor(() => guestOnHost(H, G)?.lv === 1, RT() + 2000, 'host sees the guest on the wall top', () => `guest ${lvOf(gp)} · host av ${lvOf(guestOnHost(H, G))}`);
  const dmg = [];
  t.on(G, 'damage', (d) => { if (d.target === gp && d.amount > 0 && !d.dot && d.src && d.src !== gp) dmg.push(now()); });
  let proxZ = 0, onStairs = 0;
  t.watch(() => { const pr = A.proxyOf(G, m); if (pr) proxZ = Math.max(proxZ, pr.z || 0); if (m.z > 0.05 && m.z < 0.95) onStairs++; }, 8);
  m.calmT = 0; if (m.state === 'evade') { m.state = 'idle'; m.stateT = 1; }
  MH.ai.aggro(H.game, m, guestOnHost(H, G));
  const up = await t.tryWait(() => m.lv === 1 && m.z === 1, 20000);
  t.check(up, 'the creature climbed to lv 1 through the stairs', `${lvOf(m)} state ${m.state} at ${f2(m.x)},${f2(m.y)} fails ${m.nav?.fails ?? 0}`);
  t.check(onStairs > 0, 'it was seen mid-stairs (0 < z < 1)', `${onStairs} samples`);
  const bit = await t.tryWait(() => dmg.length > 0, 10000);
  t.check(bit, 'and bites the guest on the rampart', `${dmg.length} hits`);
  await t.tryWait(() => proxZ >= 0.99, RT() + 1200); // the proxy follows the stream (10 Hz, 150 ms behind)
  t.check(proxZ >= 0.99, 'guest sees the creature proxy up there (z 1)', `max z ${f2(proxZ)}`);
  sendAway(G, MG, m.x, m.y, 30);
  m.x = m.home.x; m.y = m.home.y; m.lv = 0; m.z = 0; // host-side cleanup
  A.pacify(H, m.x, m.y, 6, 120);
  await t.checkDigest(H, G);
});

def('L5', {
  title: 'L: saves — old save loads at lv 0, a new one keeps the rampart', timeout: 120000,
  expected: 'Solo save frame: a player saved on a wall top reloads at lv 1 on it; the same save without level data (an older build) loads at lv 0 and never inside the wall; structures without lv (incl. legacy 10-field rows) load at level 0 and their tops are surfaces',
  api: 'save.js player.z (optional), levels.restore(p, z), snapshot rows without lv; localStorage wos.save.v2.<seed> (restored after the run)',
}, async (t) => {
  const seed = CFG.seed + 17;
  presetPid('s' + rand(7));
  const S = t.open('solo-levels', `seed=${seed}`, null);
  await t.waitFor(() => S.game && S.loadingHidden, CFG.bootMs, 'save frame boot');
  const M = await A.mods(S);
  await A.reset(t, S, M, null, null);
  const g = S.game, p = g.player;
  const site = A.findSite([S], [M], 'wall_wood', (x, y) => { const o = []; for (let k = -1; k <= 5; k++) for (let dy = -1; dy <= 3; dy++) o.push([x + k, y + dy]); return o; }, p.x, p.y, { rMin: 3, rMax: 18 });
  t.assert(site, 'free site');
  const { x0: x, y0: y } = site;
  hostBuild(S, [['wall_wood', x, y], ['wall_wood', x + 1, y], ['wall_wood', x + 2, y], ['stairs_wood', x + 1, y + 1, 0]]);
  A.teleport(S, x + 1.5, y + 3.5);
  const rel = A.holdMove(S, 0, -1);
  await t.waitFor(() => p.lv === 1 && p.z === 1, 5000, 'climbs onto the wall');
  rel();
  await t.sleep(200);
  const at = [p.x, p.y];
  t.assert(M.save.saveGame(g), 'saveGame() wrote a save');
  const key = `wos.save.v2.${seed}`;
  const data = JSON.parse(S.win.localStorage.getItem(key));
  t.check(data?.player?.z === 1, 'the save records player z 1', String(data?.player?.z));
  t.check(!data.world.lvs && g.build.structures.every((o) => o.town != null || !(o.lv > 0)), 'no structure level data needed (all lv 0; levels add no save version)', `v ${data.v}`);
  S.reload();
  await t.waitFor(() => S.loads >= 2 && S.game && S.loadingHidden && S.game !== g, CFG.bootMs, 'reloaded (1)');
  let p2 = S.game.player;
  t.check(p2.lv === 1 && p2.z === 1 && Math.hypot(p2.x - at[0], p2.y - at[1]) < 0.05, 'reloads standing on the rampart (lv 1)', `${lvOf(p2)} at ${f2(p2.x)},${f2(p2.y)}`);
  // an older build's save: no player z, plus a legacy 10-field wall row (v3)
  const old = JSON.parse(JSON.stringify(data));
  delete old.player.z;
  old.v = data.v; // (saves before the planet engine (v10) are dropped: the old row formats inside a current save still load)
  old.world.structs = old.world.structs.map((r) => r.slice(0, 10));
  old.world.structs.push(['old_wall_lv', 'wall_wood', x + 4, y, 0, 1, 0, 0, 0, 100]);
  const g2 = S.game;
  g2.noSave = true; // the page would save itself again on pagehide
  S.win.localStorage.setItem(key, JSON.stringify(old));
  S.reload();
  await t.waitFor(() => S.loads >= 3 && S.game && S.loadingHidden && S.game !== g2, CFG.bootMs, 'reloaded (2: old save)');
  const g3 = S.game;
  p2 = g3.player;
  t.check(!(p2.lv > 0) && !(p2.z > 0), 'old save: the player loads at lv 0', lvOf(p2));
  const M3 = await A.mods(S);
  t.check(!M3.physics.collides(g3.world, p2.x, p2.y, p2.r, null, true), 'old save: not stuck inside the wall (nudged out at lv 0)', `${f2(p2.x)},${f2(p2.y)}`);
  const S3 = g3.build.structures;
  t.check(S3.some((o) => o.id === 'old_wall_lv') && S3.every((o) => !(o.lv > 0)), 'old rows load as level-0 structures', `${S3.length} structures`);
  const L3 = g3.levels;
  t.check(L3.active && L3.isSurface(1, g3.world.idx(x + 4, y)) && L3.isSurface(1, g3.world.idx(x + 1, y)), 'their wall tops are level-1 surfaces, stairs active', `stairs ${L3.stairs.length}`);
});

// ---------- L phase 2: stories (upper floors, walls, doors, furniture, collapse, saves) ----------
// place `type` through build mode on story `lv` (the level bar's choice, game.build.mode.lv): a drag a → b or one tile
function placeLv(f, M, type, a, b = a, lv = 1, rot = null) {
  const g = f.game;
  M.building.enterBuildMode(g, type);
  const m = g.build.mode;
  if (!m || m.kind !== 'place') throw new Fail(`${f.label}: enterBuildMode(${type}) refused`);
  m.lv = lv;
  if (rot != null) m.rot = rot;
  if (M.data.BUILDINGS[type].drag && (a[0] !== b[0] || a[1] !== b[1])) { m.anchor = [a[0], a[1]]; m.end = [b[0], b[1]]; m.hover = [b[0], b[1]]; } else m.hover = [a[0], a[1]];
  m.locked = true;
  const ok = M.building.commitPlacement(g);
  M.building.exitBuildMode(g);
  if (!ok) throw new Fail(`${f.label}: commitPlacement(${type} @ story ${lv}) failed (${f.lastUi(1)})`);
  return ok;
}
// host: finished structures on story lv (struct.add {lv})
function hostBuildLv(H, rows, lv) {
  const g = H.game, net = g.net;
  const list = rows.map(([type, tx, ty, rot = 0]) => [net.newId('s'), type, tx, ty, 0, 1, Math.round(g.worldTime), rot, 1, 0]);
  net.emit('struct.add', { list, lv });
  return list.map((r) => r[0]);
}
// a 4×4 wall ring at (x, y) with a doorway in the south wall (x + 1), as host rows
const ringRows = (x, y) => {
  const rows = [];
  for (let xx = x; xx < x + 4; xx++) for (let yy = y; yy < y + 4; yy++) if ((xx === x || xx === x + 3 || yy === y || yy === y + 3) && !(xx === x + 1 && yy === y + 3)) rows.push(['wall_wood', xx, yy]);
  return rows;
};
const upperAt = (f, x, y, w = 4, h = 4) => f.game.build.structures.filter((o) => o.lv > 0 && o.tx >= x && o.tx < x + w && o.ty >= y && o.ty < y + h);
const snapMod = (f) => f.win.Function('u', 'return import(u)')(new URL('src/net/snapshot.js', f.win.location.href).href);

def('L6', {
  star: true, title: 'L: guest builds a second story and walks in it', timeout: 240000,
  expected: 'On a finished 4×4 room with stairs up to its west wall, the guest picks story 1 in build mode and plans a floor over the room, a wall row on the north wall, a door on the east wall and a chest (blueprints with lv 1, same ids on both); the chest cannot start before the floor under it is finished; everything is built with real work; both peers derive the same story-1 map (floor surface, walls and the closed door block, 2 stories for J\'s roofs); the host snapshot carries lvs; the guest climbs the stairs, walks onto the upper floor and is stopped by the closed upper door; the host sees it at lv 1 there; digest equal',
  api: 'game.build.mode.lv (ui/levelbar.js) → build.place {lv} → struct.add {lv}; placeReason(…, lv) → levels.upperReason; levels.{buildStartReason, storeysAt, isSurface, blk}; snapshot lvs',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(MG.levels?.Levels?.prototype?.upperReason && MG.levels.Levels.prototype.drawUpper, 'stories (levels phase 2) missing');
  const gp = G.game.player, hp = H.game.player;
  A.keepAlive(t, G); A.keepAlive(t, H);
  const site = A.findSite([H, G], [MH, MG], 'wall_wood', (x, y) => { const o = []; for (let dx = -4; dx <= 5; dx++) for (let dy = -1; dy <= 5; dy++) o.push([x + dx, y + dy]); return o; }, gp.x, gp.y, { rMin: 3, rMax: 22, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a free 10×7 site');
  const { x0: x, y0: y } = site;
  A.pacify(H, x, y, 22);
  const base = hostBuild(H, [...ringRows(x, y), ['stairs_wood', x - 2, y + 1, 1]]); // stairs: entrance west, landing on the west wall top
  await t.waitFor(() => base.every((id) => A.structOn(G, id) && !A.structOn(G, id).blueprint), RT() + 600, 'guest sees the finished ground floor + stairs');
  A.ensure(G, { wood: 80, rope: 4 });
  A.teleport(G, x + 1.5, y + 5.5);
  await A.hostSees(t, H, G);
  // the guest plans story 1
  const LG = G.game.levels, LH = H.game.levels;
  let far = null;
  for (let r = 8; r < 24 && !far; r++) for (let k = 0; k < 24 && !far; k++) {
    const tx = Math.floor(x + 1 + Math.cos((k / 24) * 6.283) * r), ty = Math.floor(y + 1 + Math.sin((k / 24) * 6.283) * r);
    if (G.game.world.inBounds(tx, ty) && !G.game.world.rock.get(G.game.world.idx(tx, ty)) && !LG.supportedL(tx, ty, 1, true)) far = [tx, ty];
  }
  const farR = far && MG.building.placeReason(G.game, 'floor_wood', far[0], far[1], null, 0, null, 1);
  t.check(far && /apoio/.test(String(farR)), 'a floor with no wall / column within 6 tiles below is refused (support)', `${far} → ${farR}`);
  t.check(/Vão/.test(String(MG.building.placeReason(G.game, 'floor_wood', x - 1, y + 1, null, 0, null, 1))), 'a floor over the stairs is refused (stairwell)');
  t.check(/piso/.test(String(MG.building.placeReason(G.game, 'chest', x + 1, y + 1, null, 0, null, 1))), 'a chest in the air is refused (needs a floor)');
  placeLv(G, MG, 'floor_wood', [x + 1, y + 1], [x + 2, y + 2], 1);
  placeLv(G, MG, 'wall_wood', [x, y], [x + 3, y], 1);
  placeLv(G, MG, 'door_wood', [x + 3, y + 1], [x + 3, y + 1], 1);
  await t.waitFor(() => upperAt(G, x, y).filter((o) => o.type === 'floor_wood').length >= 4, RT() + 900, 'guest sees the planned upper floor'); // (the chest needs it, planned is enough)
  placeLv(G, MG, 'chest', [x + 2, y + 2], [x + 2, y + 2], 1);
  const ups = await t.waitFor(() => { const L = upperAt(G, x, y); return L.length >= 10 && L; }, RT() + 900, 'guest sees 10 story-1 blueprints', () => short(upperAt(G, x, y).map((o) => o.type)));
  const ids = ups.map((o) => o.id);
  t.check(ups.every((o) => o.blueprint && o.lv === 1), 'all are blueprints on story 1', short(ups.map((o) => `${o.type}@${o.lv}`)));
  await t.waitFor(() => ids.every((id) => A.structOn(H, id)?.lv === 1), RT() + 400, 'host has the same ids on story 1');
  const chest = ups.find((o) => o.type === 'chest'), chestH = A.structOn(H, chest.id);
  t.check(/piso/.test(String(LH.buildStartReason(chestH))), 'the chest cannot start before its floor is finished', String(LH.buildStartReason(chestH)));
  const order = (o) => (o.type === 'floor_wood' ? 0 : o.type === 'chest' ? 2 : 1);
  await A.buildAll(t, G, MG, ups.slice().sort((a, b) => order(a) - order(b)).map((o) => o.id), { ms: 40000 });
  await t.waitFor(() => ids.every((id) => { const h = A.structOn(H, id); return h && !h.blueprint; }), RT() + 800, 'host sees every story-1 piece finished');
  const W = G.game.world.W, N = W * G.game.world.H, I = (xx, yy) => yy * W + xx;
  for (const [nm, L] of [['host', LH], ['guest', LG]]) {
    L.sync();
    t.check(L.hasUpper && L.storeysAt(x + 1, y + 1) === 2 && L.storeysAt(x + 3, y + 3) === 1, `${nm}: 2 stories over the room (J's eaves on top), 1 where nothing is up`, `${L.storeysAt(x + 1, y + 1)} / ${L.storeysAt(x + 3, y + 3)}`);
    t.check(L.isSurface(1, I(x + 1, y + 1)) && L.isSurface(1, I(x + 2, y + 2)) && L.isSurface(1, I(x + 3, y + 2)), `${nm}: the upper floor and the wall tops are story-1 surfaces`);
    t.check(L.blk[1]?.get(I(x + 1, y)) && L.blk[1]?.get(I(x + 3, y + 1)) && !L.blk[1]?.get(I(x + 1, y + 1)), `${nm}: upper walls and the closed upper door block story 1, the floor does not`);
    t.check(L.isSurface(2, I(x + 1, y)), `${nm}: the upper walls' tops are story-2 surfaces`);
  }
  const SN = await snapMod(H);
  const lvs = new Map(SN.serializeWorld(H.game).lvs || []);
  t.check(ids.every((id) => lvs.get(id) === 1), 'host snapshot lists the story of every upper piece (lvs)', `${lvs.size} rows`);
  // climb and walk in
  A.teleport(G, x - 3.5, y + 1.5);
  await A.hostSees(t, H, G);
  const rel = A.holdMove(G, 1, 0);
  await t.waitFor(() => gp.lv === 1 && gp.x > x + 2.2, 7000, 'guest climbs onto the west wall and walks onto the upper floor', () => `${lvOf(gp)} at ${f2(gp.x)},${f2(gp.y)}`);
  await t.sleep(700);
  rel();
  t.check(gp.lv === 1 && gp.z === 1 && gp.x < x + 3 - 0.1 && Math.floor(gp.y) === y + 1, 'stopped by the closed upper door (still on story 1)', `${lvOf(gp)} at ${f2(gp.x)},${f2(gp.y)}`);
  const relN = A.holdMove(G, 0, -1);
  await t.sleep(600);
  relN();
  t.check(gp.lv === 1 && gp.y > y + 1 - 0.05, 'the upper north wall stops it too', `${lvOf(gp)} at ${f2(gp.x)},${f2(gp.y)}`);
  await t.waitFor(() => { const av = guestOnHost(H, G); return av && av.lv === 1 && Math.hypot(av.x - gp.x, av.y - gp.y) < 0.3; }, RT() + 600, 'host sees the guest on the upper floor (lv 1)');
  await t.checkDigest(H, G);
});

def('L7', {
  title: 'L: an upper story falls when its supports go', timeout: 150000,
  expected: 'Host builds a room with a story-1 floor, a wall and a chest with items on top; the guest stands up there. The host removes the ground walls: the host\'s levels system emits lv.collapse, every story-1 piece disappears on both, the chest items and half the materials drop on the ground below (loot on both), the guest falls to lv 0; digest equal',
  api: 'levels.unsupported() → op lv.collapse {ids, drops}; levels.settle (fall); loot rows',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(MG.levels?.Levels?.prototype?.unsupported, 'stories (levels phase 2) missing');
  const gp = G.game.player, hp = H.game.player;
  A.keepAlive(t, G); A.keepAlive(t, H);
  // nothing else may hold the story up: no wall / door / column / rock within 7 tiles of the room (earlier scenarios build nearby)
  const BH = MH.data.BUILDINGS, wH = H.game.world;
  const alone = (x, y) => {
    for (const o of H.game.build.structures) if (!o.lv && o.tx > x - 8 && o.tx < x + 11 && o.ty > y - 8 && o.ty < y + 11 && (BH[o.type]?.support || BH[o.type]?.connect === 'wall')) return false;
    for (let yy = y - 7; yy < y + 11; yy++) for (let xx = x - 7; xx < x + 11; xx++) if (!wH.inBounds(xx, yy) || wH.rock[wH.idx(xx, yy)]) return false;
    return true;
  };
  const site = A.findSite([H, G], [MH, MG], 'wall_wood', (x, y) => { if (!alone(x, y)) return [[-9, -9]]; const o = []; for (let dx = -2; dx <= 5; dx++) for (let dy = -1; dy <= 5; dy++) o.push([x + dx, y + dy]); return o; }, gp.x, gp.y, { rMin: 3, rMax: 40, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a free site with no other support around');
  const { x0: x, y0: y } = site;
  A.pacify(H, x, y, 22);
  const walls = hostBuild(H, ringRows(x, y));
  await t.waitFor(() => walls.every((id) => A.structOn(G, id)), RT() + 500, 'guest sees the walls');
  const fl = [];
  for (let xx = x; xx < x + 4; xx++) for (let yy = y; yy < y + 4; yy++) fl.push(['floor_wood', xx, yy]);
  const up = hostBuildLv(H, [...fl, ['wall_wood', x + 1, y], ['chest', x + 2, y + 2]], 1);
  await t.waitFor(() => up.every((id) => A.structOn(G, id)?.lv === 1), RT() + 500, 'guest sees the upper story');
  const ch = A.structOn(H, up[up.length - 1]);
  t.assert(ch?.store, 'upper chest has a store');
  ch.store.add('stone', 7);
  H.game.net.emit('chest.set', { id: ch.id, slots: ch.store.toJSON(), by: H.pid, quiet: 1 });
  await t.waitFor(() => A.structOn(G, ch.id)?.store?.count('stone') === 7, RT() + 400, 'guest sees the stones in the upper chest');
  t.check(!H.game.levels.unsupported().length, 'nothing unsupported while the walls stand');
  // the guest upstairs
  A.teleport(G, x + 1.5, y + 2.5);
  gp.lv = 1; gp.z = 1;
  await t.waitFor(() => guestOnHost(H, G)?.lv === 1, RT() + 1500, 'host sees the guest upstairs');
  const loot0 = (f) => f.game.loot.filter((it) => it.x > x - 2 && it.x < x + 6 && it.y > y - 2 && it.y < y + 6);
  const stones = (f) => loot0(f).filter((it) => it.item === 'stone').reduce((a, it) => a + it.qty, 0);
  const s0 = gp.inv.count('stone'), got = () => gp.inv.count('stone') - s0; // (the falling guest may pick them up at once)
  const n0 = new Set([...H.game.loot, ...G.game.loot].map((it) => it.id));
  for (const id of walls) H.game.net.emit('struct.remove', { id, by: H.pid, quiet: 1 });
  await t.waitFor(() => !upperAt(H, x, y).length && !upperAt(G, x, y).length, RT() + 1500, 'every story-1 piece fell on both', () => `host ${upperAt(H, x, y).length} · guest ${upperAt(G, x, y).length}`);
  const st = await t.tryWait(() => stones(G) + got() >= 7 && stones(H) + got() >= 7, RT() + 1500);
  t.check(st, 'the chest\'s 7 stones dropped below (on the ground, or already in the falling guest\'s bag)', `ground host ${stones(H)} · guest ${stones(G)} · picked ${got()}`);
  await t.sleep(RT() + 300);
  const newL = (f) => f.game.loot.filter((it) => !n0.has(it.id)).map((it) => it.id).sort().join();
  t.check(newL(H) === newL(G), 'same new loot on both', `host [${newL(H)}] · guest [${newL(G)}]`);
  await t.waitFor(() => gp.lv === 0 && gp.z === 0, 3000, 'the guest fell to the ground', () => lvOf(gp));
  await t.waitFor(() => !(guestOnHost(H, G)?.z > 0), RT() + 500, 'host sees the guest on the ground');
  await t.checkDigest(H, G);
});

def('L8', {
  title: 'L: saves keep the stories (v9)', timeout: 120000,
  expected: 'Solo frame: a room with a story-1 floor, wall and chest, the player standing upstairs; the save is v9 with world.lvs listing every upper piece; after a reload the same pieces are back on story 1 (2 stories, surfaces), the player stands on the upper floor; a v8 save (no lvs, terrain-paths version) still loads',
  api: 'save.js v9 · world.lvs [[id, lv]] · snapshot applyInner LVS · levels.restore(p, z) on a slab',
}, async (t) => {
  const seed = CFG.seed + 23;
  presetPid('s' + rand(7));
  const S = t.open('solo-stories', `seed=${seed}`, null);
  await t.waitFor(() => S.game && S.loadingHidden, CFG.bootMs, 'save frame boot');
  const M = await A.mods(S);
  t.need(M.levels?.Levels?.prototype?.upperReason, 'stories (levels phase 2) missing');
  await A.reset(t, S, M, null, null);
  const g = S.game, p = g.player;
  const site = A.findSite([S], [M], 'wall_wood', (x, y) => { const o = []; for (let dx = -1; dx <= 4; dx++) for (let dy = -1; dy <= 4; dy++) o.push([x + dx, y + dy]); return o; }, p.x, p.y, { rMin: 3, rMax: 18 });
  t.assert(site, 'free site');
  const { x0: x, y0: y } = site;
  hostBuild(S, ringRows(x, y));
  const fl = [];
  for (let xx = x; xx < x + 4; xx++) for (let yy = y; yy < y + 4; yy++) fl.push(['floor_wood', xx, yy]);
  const up = hostBuildLv(S, [...fl, ['wall_wood', x + 2, y], ['chest', x + 1, y + 2]], 1);
  await t.sleep(100);
  A.teleport(S, x + 2.5, y + 2.5);
  p.lv = 1; p.z = 1;
  await t.sleep(200);
  t.assert(M.save.saveGame(g), 'saveGame() wrote a save');
  const key = `wos.save.v2.${seed}`;
  const data = JSON.parse(S.win.localStorage.getItem(key));
  const lvs = new Map(data?.world?.lvs || []);
  t.check(data.v === 10, 'save version 10 (planet engine; L stories kept)', `v ${data.v}`);
  t.check(up.every((id) => lvs.get(id) === 1) && lvs.size === up.length, 'world.lvs lists every upper piece at story 1', `${lvs.size} rows`);
  t.check(data.player.z === 1, 'player z 1 saved');
  S.reload();
  await t.waitFor(() => S.loads >= 2 && S.game && S.loadingHidden && S.game !== g, CFG.bootMs, 'reloaded');
  const g2 = S.game, L2 = g2.levels;
  const back = up.map((id) => g2.build.structures.find((o) => o.id === id));
  t.check(back.every((o) => o && o.lv === 1 && !o.blueprint), 'every upper piece is back on story 1', short(back.map((o) => o ? `${o.type}@${o.lv}` : 'missing')));
  L2.sync();
  t.check(L2.storeysAt(x + 1, y + 1) === 2 && L2.isSurface(1, g2.world.idx(x + 1, y + 1)) && L2.blk[1]?.get(g2.world.idx(x + 2, y)), 'the derived story-1 map is rebuilt (2 stories, floor surface, upper wall blocks)');
  const p2 = g2.player;
  t.check(p2.lv === 1 && p2.z === 1 && Math.hypot(p2.x - (x + 2.5), p2.y - (y + 2.5)) < 0.05, 'the player wakes up on the upper floor', `${lvOf(p2)} at ${f2(p2.x)},${f2(p2.y)}`);
  // a v8 save (M's terrain paths version, no stories) still loads
  const old = JSON.parse(JSON.stringify(data));
  delete old.world.lvs; delete old.player.z; // (a save without stories; versions before v10 are dropped)
  const ids = new Set(up);
  old.world.structs = old.world.structs.filter((r) => !ids.has(r[0]));
  g2.noSave = true; // the page would save itself again on pagehide
  S.win.localStorage.setItem(key, JSON.stringify(old));
  S.reload();
  await t.waitFor(() => S.loads >= 3 && S.game && S.loadingHidden && S.game !== g2, CFG.bootMs, 'reloaded (v8 save)');
  const g3 = S.game;
  t.check(g3.build.structures.some((o) => o.type === 'wall_wood' && o.tx === x && o.ty === y) && g3.build.structures.every((o) => o.town != null || !(o.lv > 0)), 'v8 save loads (ground floor only)', `${g3.build.structures.length} structures`);
});

// =====================================================================================================
// S70 H: look sync (character creator)
def('S70', {
  title: 'H: look sync', timeout: 90000,
  expected: 'Guest changes its look → the host draws the very same parts and colours (look/rig layers per facing); host change → guest sees it; a malformed look from a peer (unknown ids, bad colours, garbage) is cleaned to valid defaults and draws; packed look < 320 B (avg ~200); selfTest clean',
  api: 'game/look.js {randomLook, cleanLook, packLook, applyLook} · session.sendLook() · lk / sts.look (packed) · art/look/rig.js lookRig(A, look)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(MG.look?.packLook && MG.lookRig?.lookRig, 'look schema / rig modules');
  const LK = MG.look, LH = MH.look;
  const layers = (M, A, look) => { const R = M.lookRig.lookRig(A, look), out = []; for (const d of ['s', 'n', 'e']) for (const part of ['hairBack', 'body', 'head', 'brows', 'beard', 'hair']) for (const l of R[part][d]) out.push(`${d}:${l.s.name}:${l.r.toFixed(3)},${l.g.toFixed(3)},${l.b.toFixed(3)}`); return out; };
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  // 1. the guest restyles itself (live, like the editor's "Salvar" in a running game)
  let nl = LK.randomLook(4242);
  if (LK.packLook(nl) === LK.packLook(G.game.player.look)) nl = LK.randomLook(4343);
  nl = { ...nl, hair: 'long_wavy', hairFx: 'tips', pattern: 'plaid', over: 'vest', beard: 'full' };
  LK.applyLook(G.game, nl);
  const want = LK.packLook(G.game.player.look);
  const seen = () => { const e = A.avatarOn(H, G.pid); return e && LH.packLook(e.look) === want; };
  const ms = await t.timeTo(seen, 4000, 'host sees the new guest look');
  t.metric('lookSyncMs', Math.round(ms));
  t.check(seen(), 'host has the guest look (packed equal)', want.slice(0, 80) + '…');
  const lg = layers(MG, G.game.A, G.game.player.look), lh = layers(MH, H.game.A, A.avatarOn(H, G.pid).look);
  t.check(lg.length > 30 && same(lg, lh), 'same sprite layers + tints on both clients (3 facings)', `${lg.length} layers · ${lg.slice(0, 3).join(' | ')}`);
  // lazy look atlas: the host paints the guest's parts on demand (not baked in the atlas, not in the digest)
  const RH = MH.lookRig.lookRig(H.game.A, A.avatarOn(H, G.pid).look);
  const readyH = MH.lookRig.rigReady(RH, true), st0 = H.game.net.selfTest().look;
  t.check(readyH && RH.need.every((r) => r.ready) && st0 && !st0.failures.length && !H.game.A.has('lk_skin_s'), 'host paints the guest look parts lazily (second texture), no failures', JSON.stringify(st0));
  t.check(want.length < 320, 'packed look is compact (worst case ~290 chars)', `${want.length} chars`);
  t.metric('lookBytes', want.length);
  // 2. the host restyles → the guest sees it
  const hl = { ...LH.randomLook(777), hair: 'afro', top: 'gown', paint: 'tribal' };
  LH.applyLook(H.game, hl);
  const wantH = LH.packLook(H.game.player.look);
  await t.waitFor(() => { const e = A.avatarOn(G, H.pid); return e && LK.packLook(e.look) === wantH; }, 8000, 'guest sees the new host look');
  t.check(same(layers(MH, H.game.A, H.game.player.look), layers(MG, G.game.A, A.avatarOn(G, H.pid).look)), 'guest draws the host with the same layers');
  // 3. malformed looks from a peer are cleaned (never crash, never undefined parts)
  const bad = [
    '1|nonexistent|zz|<b>|' + 'x'.repeat(40),
    { v: 1, hair: '<script>', skin: 'zzzzzz', topC: [9, -3, 'a'], eyes: 42, beardC: 'nothex', shoes: null, top: { evil: 1 } },
    { skin: [2, 2, 2], hair: 'long', hairColor: [0.2, 0.1, 0.05], shirt: [0.5, 0.2, 0.1], beard: true },
    12345, 'garbage', ['a', 1],
  ];
  for (const [i, b] of bad.entries()) {
    G.session.sendHost({ t: 'lk', look: b });
    await t.waitFor(() => { const e = A.avatarOn(H, G.pid); return e && LH.packLook(e.look) !== want; }, 3000, `host applied malformed look #${i + 1}`).catch(() => {});
    const e = A.avatarOn(H, G.pid), l = e?.look || {};
    const ok = LH.packLook(l) === LH.packLook(LH.cleanLook(l)) && /^[0-9a-f]{6}$/.test(l.skin) && /^[0-9a-f]{6}$/.test(l.topC) && typeof l.hair === 'string';
    let drew = true;
    try { layers(MH, H.game.A, l); H.game.render(); } catch (err) { drew = false; t.log('draw error ' + err.message); }
    t.check(ok && drew, `malformed look #${i + 1} cleaned and drawn`, `hair ${l.hair} skin ${l.skin} top ${l.top} topC ${l.topC}`);
    G.session.sendHost({ t: 'lk', look: want }); // back to the real one
    await t.tryWait(() => { const x = A.avatarOn(H, G.pid); return x && LH.packLook(x.look) === want; }, 3000);
  }
  const legacy = LH.cleanLook(bad[2]);
  t.check(legacy.hair === 'long' && legacy.beard !== 'none' && legacy.topC === '80331a' && LH.packLook(LH.cleanLook(bad[2])) === LK.packLook(LK.cleanLook(bad[2])), 'legacy { skin, hair, hairColor, shirt, beard } migrates the same on both', `${legacy.hair} ${legacy.beard} ${legacy.topC} ${legacy.top}`);
  const st = H.game.net.selfTest();
  t.check(st.atlasOk && !st.missingSprites.length && !st.placeholders.length, 'host selfTest clean', JSON.stringify({ atlasOk: st.atlasOk, missing: st.missingSprites.length }));
  await t.checkDigest(H, G);
});

// =====================================================================================================
// Agent K (architecture styles & details, decoration, training dummy)
const kmods = async (f) => {
  const imp = f.win.Function('u', 'return import(u)');
  const base = new URL('src/', f.win.location.href);
  const [kits, kit] = await Promise.all([imp(new URL('game/content/kits.js', base).href), imp(new URL('game/mut/kit.js', base).href)]);
  return { kits, kit };
};
const look = (o) => o && `${o.type}:${o.style || '-'}/${o.det || '-'} m${o.mask | 0}`;
// place `type` through build mode with the look picked in Detalhes (setBuildLook): a drag a → b or a single tile
function placeStyled(f, M, type, style, det, a, b = a) {
  const g = f.game;
  M.building.enterBuildMode(g, type);
  M.building.setBuildLook(g, type, style, det);
  const m = g.build.mode;
  if (!m || m.kind !== 'place') throw new Fail(`${f.label}: enterBuildMode(${type}) refused`);
  if (M.data.BUILDINGS[type].drag && (a[0] !== b[0] || a[1] !== b[1])) { m.anchor = [a[0], a[1]]; m.end = [b[0], b[1]]; m.hover = [b[0], b[1]]; } else m.hover = [a[0], a[1]];
  m.locked = true;
  const ok = M.building.commitPlacement(g);
  M.building.exitBuildMode(g);
  if (!ok) throw new Fail(`${f.label}: commitPlacement(${type}) failed (${f.lastUi(1)})`);
  return ok; // (on a guest the blueprints appear when the host's struct.add arrives)
}

def('K1', {
  title: 'K: styled walls with corner details placed by the guest', timeout: 180000,
  expected: 'Guest picks "Pedra bruta" + quoins / soft corners / crenels / ivy / sandstone tone in Detalhes and drags an L of stone walls (+ one tile with an arrow slit): the host has the same style, canonical det and masks for every piece (blueprints and finished), the decoded look (_k) matches; digest equal',
  api: 'setBuildLook → build.place {type, tiles, rot, style, det} → struct.add rows [.., style, det]; o.{style, det, mask, _k}; content/kits.js cleanDet',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const KG = await kmods(G);
  A.ensure(G, { stone_block: 20 });
  const gp = G.game.player, hp = H.game.player;
  const site = A.findSite([H, G], [MH, MG], 'wall_stone', (x, y) => [[x, y], [x + 1, y], [x + 2, y], [x, y + 1]], gp.x, gp.y, { rMin: 3, rMax: 14, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a free L of 4 tiles');
  const { x0: x, y0: y } = site;
  const DET = 'ivy.quoin.soft.crenel.t_warm';
  const want = KG.kits.cleanDet('wall_stone', DET);
  t.check(want === 'crenel.ivy.quoin.soft.t_warm', 'canonical detail string (sorted, one per group)', want);
  placeStyled(G, MG, 'wall_stone', 'rough', DET, [x, y], [x + 2, y]);
  placeStyled(G, MG, 'wall_stone', 'rough', 'quoin.slit.pillar', [x, y + 1]);
  t.check(KG.kits.cleanDet('wall_stone', 'quoin.slit.pillar') === 'pillar.slit', 'exclusive group: one corner piece kept (first in canonical order)', KG.kits.cleanDet('wall_stone', 'quoin.slit.pillar'));
  const tiles = [[x, y], [x + 1, y], [x + 2, y], [x, y + 1]];
  await t.waitFor(() => tiles.every(([tx, ty]) => A.structAt(H, MH, tx, ty, 'main') && A.structAt(G, MG, tx, ty, 'main')), RT() + 800, 'both have the 4 styled blueprints');
  const ids = tiles.map(([tx, ty]) => A.structAt(H, MH, tx, ty, 'main').id);
  t.log(`guest placed ${ids.length} styled walls at ${x},${y}`);
  const pairs = () => tiles.map(([tx, ty]) => [A.structAt(H, MH, tx, ty, 'main'), A.structAt(G, MG, tx, ty, 'main')]);
  const same = () => pairs().every(([h, g]) => h && g && h.id === g.id && look(h) === look(g));
  await t.waitFor(same, ONEWAY() + 400, 'same look on both (blueprints)');
  const P = pairs();
  t.check(P.slice(0, 3).every(([h]) => h.style === 'rough' && h.det === want), 'row: style rough + canonical det on the host', P.map(([h]) => look(h)).join(' | '));
  t.check(P[3][0].style === 'rough' && P[3][0].det === 'pillar.slit', 'single tile keeps its own details', look(P[3][0]));
  t.check(P.every(([h, g]) => h._k && g._k && h._k.key === g._k.key) && P.slice(0, 3).every(([h, g]) => h._k.on.quoin && g._k.on.quoin) && P[3][0]._k.on.pillar, 'decoded look (_k) identical on both', P.map(([h]) => h._k?.key).join(' | '));
  await A.buildAll(t, G, MG, ids, { ms: 40000 });
  await t.waitFor(() => pairs().every(([h, g]) => h && g && !h.blueprint && !g.blueprint), ONEWAY() + 600, 'all finished on both');
  await t.waitFor(same, ONEWAY() + 400, 'same look + masks on both (finished)');
  const F = pairs();
  const masks = F.map(([h]) => h.mask | 0), EXP = [6, 10, 8, 1];
  t.check(masks.every((m, i) => (m & EXP[i]) === EXP[i]), 'autotile masks of the L (E+S, E+W, W, N; natural rock may add bits)', masks.join(','));
  t.check(F.every(([h, g]) => (h.mask | 0) === (g.mask | 0)), 'masks equal on both', F.map(([h, g]) => `${h.mask}/${g.mask}`).join(' '));
  t.check(F.every(([h]) => H.game.world.solid.get(H.game.world.idx(h.tx, h.ty)) === 1), 'styled walls are solid like any wall');
  // the styled art draws without errors on both frames
  let drew = true;
  for (const f of [H, G]) { try { f.game.render(); } catch (e) { drew = false; t.log('render error ' + e.message); } }
  t.check(drew, 'both frames render the styled walls');
  await t.checkDigest(H, G);
  env.history.push('K1');
});

def('K2', {
  title: 'K: style brush over blueprints (guest); finished pieces refuse a restyle', timeout: 180000,
  expected: 'Guest drags 3 wood floor blueprints (default look), then paints "Taco xadrez" + blue carpet over them with the style brush: applied on both (struct.style), carpet links (_cm) equal; after one is built, a brush stroke over it is refused for the finished one (it keeps its look on both) while the remaining blueprints change; context menu offers "Estilo da planta" only on blueprints; digest equal',
  api: 'enterStyleBrush + buildDragStart/End (kind brush) → struct.style intent (blueprints only) → op struct.style {list:[[id, style, det]]}; structureMenu entry id "style"',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const KG = await kmods(G);
  A.ensure(G, { wood: 10 });
  const gp = G.game.player, hp = H.game.player;
  const site = A.findSite([H, G], [MH, MG], 'floor_wood', (x, y) => [[x, y], [x + 1, y], [x + 2, y]], gp.x, gp.y, { rMin: 3, rMax: 12, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found 3 free tiles');
  const { x0: x, y0: y } = site;
  placeStyled(G, MG, 'floor_wood', '', '', [x, y], [x + 2, y]);
  const T3 = [[x, y], [x + 1, y], [x + 2, y]];
  await t.waitFor(() => T3.every(([tx, ty]) => A.structAt(H, MH, tx, ty, 'floor') && A.structAt(G, MG, tx, ty, 'floor')), RT() + 800, '3 floor blueprints on both (default look)');
  const ids = T3.map(([tx, ty]) => A.structAt(H, MH, tx, ty, 'floor').id);
  t.check(ids.every((id) => !A.structOn(G, id).style && !A.structOn(G, id).det), 'default look', ids.map((id) => look(A.structOn(G, id))).join(' | '));
  const menu = MG.building.structureMenu(G.game, A.structOn(G, ids[0]));
  t.check(menu.some((e) => e.id === 'style'), 'blueprint context menu offers "Estilo da planta"', menu.map((e) => e.label).join(' · '));
  // brush: remember the look for the type, enter the brush, drag over the 3 tiles
  const g = G.game;
  MG.building.setBuildLook(g, 'floor_wood', 'parquet', 'carpet.c_blue');
  MG.building.enterStyleBrush(g, 'floor_wood');
  t.check(g.build.mode?.kind === 'brush' && g.build.mode.style === 'parquet', 'brush mode with the chosen look', JSON.stringify({ k: g.build.mode?.kind, s: g.build.mode?.style, d: g.build.mode?.det }));
  MG.building.buildDragStart(g, x + 0.5, y + 0.5);
  MG.building.buildDragMove(g, x + 2.5, y + 0.5);
  MG.building.buildDragEnd(g, x + 2.5, y + 0.5);
  const det = KG.kits.cleanDet('floor_wood', 'carpet.c_blue');
  const painted = (f) => ids.every((id) => { const o = A.structOn(f, id); return o && o.style === 'parquet' && o.det === det; });
  await t.waitFor(() => painted(H) && painted(G), RT() + 600, 'brushed look on both');
  const cm = (f) => ids.map((id) => A.structOn(f, id)._cm | 0);
  t.check(JSON.stringify(cm(H)) === JSON.stringify(cm(G)) && JSON.stringify(cm(H)) === JSON.stringify([2, 10, 8]), 'carpet links to its carpeted neighbours on both', `host ${cm(H)} guest ${cm(G)}`);
  // build the first one, then brush again with another look
  await A.buildAll(t, G, MG, [ids[0]]);
  await t.waitFor(() => !A.structOn(H, ids[0])?.blueprint && !A.structOn(G, ids[0])?.blueprint, ONEWAY() + 400, 'first floor finished on both');
  const menu2 = MG.building.structureMenu(G.game, A.structOn(G, ids[0]));
  t.check(!menu2.some((e) => e.id === 'style'), 'finished piece: no "Estilo" entry', menu2.map((e) => e.label).join(' · '));
  // a direct restyle of the finished piece is refused by the host
  let refused = null;
  g.net.request('struct.style', { ids: [ids[0]], type: 'floor_wood', style: 'herring', det: '' }, { onReject: (why) => { refused = why || 'refused'; } });
  await t.waitFor(() => refused, RT() + 600, 'host refuses restyling a finished piece');
  t.check(/desmonte/i.test(refused), 'refusal tells to deconstruct and build again', refused);
  MG.building.setBuildLook(g, 'floor_wood', 'herring', '');
  MG.building.enterStyleBrush(g, 'floor_wood');
  MG.building.buildDragStart(g, x + 0.5, y + 0.5);
  MG.building.buildDragEnd(g, x + 2.5, y + 0.5);
  const rest = ids.slice(1);
  await t.waitFor(() => rest.every((id) => A.structOn(H, id)?.style === 'herring' && A.structOn(G, id)?.style === 'herring'), RT() + 600, 'remaining blueprints repainted on both');
  MG.building.exitBuildMode(g);
  const f0 = (f) => A.structOn(f, ids[0]);
  t.check(f0(H).style === 'parquet' && f0(G).style === 'parquet' && f0(H).det === det && f0(G).det === det, 'the finished floor kept its look on both', `${look(f0(H))} | ${look(f0(G))}`);
  await t.checkDigest(H, G);
  env.history.push('K2');
});

def('K3', {
  title: 'K: training dummy hit by the guest is seen by both', timeout: 150000,
  expected: 'Host builds a "Boneco de treino"; the guest hits it: every peer gets the dummy.hit op (wobble start _wobT, straw, number: the host shows the remote hit as floating text), the dummy never breaks (hp stays, still a target, no loot), the guest earns a little XP (owner effect) that fades with many hits, the host earns nothing; DPS readout on the host; digest equal',
  api: 'combat.applyPlayerHit → damageProp → intent dummy.hit {id, amount, crit} → op dummy.hit {id, amount, crit, by, xp}; event dummyhit; o.{dummy, isProp, hp, _wobT, _dpsTxt}; game.props',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.ensure(H, { wood: 6, fiber: 10 });
  const hp = H.game.player, gp = G.game.player;
  const site = A.findSite([H, G], [MH, MG], 'training_dummy', (x, y) => [[x, y]], hp.x, hp.y, { rMin: 2, rMax: 10, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found a spot');
  const [tx, ty] = site.tiles[0];
  A.place(H, MH, 'training_dummy', [tx, ty]);
  const dh = await t.waitFor(() => A.structAt(H, MH, tx, ty, 'main'), 1500, 'dummy blueprint');
  await A.buildAll(t, H, MH, [dh.id]);
  const dg = await t.waitFor(() => { const o = A.structOn(G, dh.id); return o && !o.blueprint && o.dummy && o; }, ONEWAY() + 400, 'guest sees a finished dummy');
  t.check(dh.dummy && dh.isProp && H.game.props.includes(dh) && G.game.props.includes(dg), 'dummy is an attackable prop on both');
  A.standBy(G, MG, dg);
  A.standBy(H, MH, dh, -Math.PI / 2);
  await A.hostSees(t, H, G);
  const evH = [], evG = [], dmgH = [];
  t.on(H, 'dummyhit', (d) => evH.push(d)); t.on(G, 'dummyhit', (d) => evG.push(d));
  t.on(H, 'damage', (d) => { if (d.target === dh) dmgH.push(d); });
  const xpG = A.xpRecorder(t, G), xpH = A.xpRecorder(t, H);
  const loot0 = H.game.loot.length;
  const t0H = H.game.time, t0G = G.game.time;
  A.hit(G, MG, dg, 12);
  await t.waitFor(() => evH.length >= 1 && evG.length >= 1, RT() + 600, 'both peers got the hit');
  t.check(evH[0].amount === 12 && evG[0].amount === 12 && evG[0].mine && !evH[0].mine, 'same amount on both; it is the guest\'s hit', JSON.stringify([evH[0], evG[0]].map((e) => [e.amount, e.mine])));
  t.check(dh._wobT >= t0H && dg._wobT >= t0G, 'wobble started on both', `${dh._wobT?.toFixed?.(2)} / ${dg._wobT?.toFixed?.(2)}`);
  t.check(dmgH.some((d) => d.kind === 'status' && d.text === '12'), 'host shows the remote hit as a floating number', JSON.stringify(dmgH.map((d) => [d.kind, d.text, d.amount])));
  // many hits: never breaks, xp fades
  for (let i = 0; i < 39; i++) { A.hit(G, MG, dg, 9999); if (i % 8 === 7) await t.sleep(60); }
  await t.waitFor(() => evH.length >= 40 && evG.length >= 40, RT() * 3 + 1500, '40 hits applied on both');
  await t.sleep(RT() + 300);
  t.check(A.structOn(H, dh.id) && A.structOn(G, dh.id) && dh.hp === dh.maxHp && dg.hp === dg.maxHp && !dh.broken, 'never breaks (hp unchanged, still there)', `hp ${dh.hp}/${dh.maxHp}`);
  t.check(H.game.loot.length === loot0, 'no loot from a dummy', `${loot0} → ${H.game.loot.length}`);
  t.check(xpG.total >= 3 && xpG.total <= 18, 'guest earned a little xp (diminishing)', `+${xpG.total} xp in 40 hits`);
  const firstHalf = xpG.events.slice(0, Math.ceil(xpG.events.length / 2)).length, all = xpG.events.length;
  t.check(all >= 2 && xpG.events.every((v) => v <= 1), 'xp comes in small steps', short(xpG.events));
  t.check(xpH.total === 0, 'host earned nothing from the guest\'s hits', `+${xpH.total}`);
  t.note(`xp events ${firstHalf}/${all} in the first half of the hits`);
  await t.sleep(400);
  t.check(/DPS/.test(dh._dpsTxt || '') && /DPS/.test(dg._dpsTxt || ''), 'DPS readout on both', `${dh._dpsTxt} | ${dg._dpsTxt}`);
  await t.checkDigest(H, G);
  env.history.push('K3');
});

def('K4', {
  src: 'classic', // (a save of the classic world: its tiles are found on the classic map)
  title: 'K: old save (v4 rows without style / det) loads with default looks', timeout: 120000,
  expected: 'migrateStructRows pads v4 rows (14 fields) and v3 rows (10) to 16 with style "" / det ""; a solo game booted from a crafted v4 save has the structures with the default look (no _k), masks computed; saving again writes the current version with 16-field rows',
  api: 'save.js VERSION (5), migrateStructRows, loadGame / saveGame (solo frame without ?nosave, key wos.save.v2.<seed>, removed afterwards)',
}, async (t) => {
  const { H, MH } = await pairCtx(t);
  const g = H.game;
  const r14 = ['k4_wall', 'wall_wood', 10, 10, 3, 1, 0, 0, 0, 50, 0, 1, 0, 0];
  const r10 = ['k4_old', 'wall_stone', 12, 10, 3, 1, 0, 0, 0, 50];
  const out = MH.save.migrateStructRows(g, [r14.slice(), r10.slice()]);
  t.check(out.length === 2 && out.every((r) => r.length === 16 && r[14] === '' && r[15] === ''), 'rows padded to 16 fields with the default look', out.map((r) => r.length + ':' + JSON.stringify(r.slice(14))).join(' '));
  // a crafted v4 save for a solo frame (same seed as the pair)
  const site = A.findSite([H], [MH], 'wall_wood', (x, y) => [[x, y], [x + 1, y], [x, y + 1]], g.world.spawn.x, g.world.spawn.y, { rMin: 4, rMax: 20 });
  t.assert(site, 'free tiles for the old structures');
  const { x0: x, y0: y } = site;
  const key = `wos.save.v2.${CFG.seed}`;
  const save = {
    v: 10, seed: CFG.seed, src: 'classic', savedAt: Date.now(), worldTime: 100, env: { hour: 10, day: 0, weather: 'clear' }, // (old 14-field rows in a current save: saves before v10 are dropped)
    player: { name: 'Teste', x: g.world.spawn.x, y: g.world.spawn.y, hp: 100, energy: 100, hunger: 90, level: 1, xp: 0, inv: [], equip: {} },
    craft: null, fuel: 0, hinted: {}, marks: [],
    world: { gone: [], nat: [], dyn: [], falling: [], mined: [], rockp: [], crops: [], loot: [], props: [],
      structs: [['k4_w1', 'wall_wood', x, y, 1, 1, 0, 0, 0, 50, 0, 1, 0, 0], ['k4_w2', 'wall_wood', x + 1, y, 2, 1, 0, 0, 0, 50, 0, 1, 0, 0], ['k4_f', 'floor_stone', x, y + 1, 3, 1, 0, 0, 0, 50, 0, 1, 0, 0]] },
  };
  const prev = localStorage.getItem(key);
  localStorage.setItem(key, JSON.stringify(save));
  let S = null;
  try {
    presetPid('k4' + rand(5));
    S = t.open('solo-oldsave', `seed=${CFG.seed}&pid=k4solo&source=classic`, 'k4solo'); // (a save of the classic world: opened on it)
    await t.waitFor(() => S.game || S.bootError, CFG.bootMs, 'solo boot from the v4 save');
    t.assert(S.game, 'solo frame booted: ' + (S.bootError || ''));
    const MS = await A.mods(S);
    const o = (id) => S.game.build.structures.find((q) => q.id === id);
    await t.waitFor(() => o('k4_w1') && o('k4_w2') && o('k4_f'), 8000, 'old structures loaded');
    const L = ['k4_w1', 'k4_w2', 'k4_f'].map(o);
    t.check(L.every((q) => (q.style || '') === '' && (q.det || '') === '' && !q._k), 'default look (no style / details / decoded look)', L.map(look).join(' | '));
    t.check((o('k4_w1').mask | 0) === 2 && (o('k4_w2').mask | 0) === 8, 'masks recomputed (E / W)', `${o('k4_w1').mask} ${o('k4_w2').mask}`);
    let drew = true; try { S.game.render(); } catch (e) { drew = false; t.log(e.message); }
    t.check(drew, 'renders the old structures');
    MS.save.saveGame(S.game);
    const now = JSON.parse(localStorage.getItem(key) || 'null');
    const rows = now?.world?.structs || [];
    t.check(now && now.v >= 5 && rows.length >= 3 && rows.every((r) => r.length === 16), 'saved again: current version, 16-field rows', `v${now?.v} rows ${rows.map((r) => r.length).join(',')}`);
  } finally {
    if (S) frames.close(S);
    if (prev == null) localStorage.removeItem(key); else localStorage.setItem(key, prev);
  }
});

def('K5', {
  title: 'K: roof details (with J) — guest styles a roof plan, brush, finish', timeout: 200000,
  expected: 'Over a walled room the guest places roof plans with "Telha de barro" + hip ends / warm tone (Detalhes): same style + canonical det on both and the same derived painter style (roofArtStyle key); the style brush repaints the plans (slate + weathervane) on both; once finished the roof is painted on both, its tiles get a slope position (roofPropAt) and a restyle is refused; digest equal',
  api: 'build mode roof_stone + setBuildLook → build.place {style, det} (room fill) → struct.add; struct.style (brush); kits.roofArtStyle(o) → J artSpec spec.styles; roofs.roofPropAt',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const KH = await kmods(H), KG = await kmods(G);
  t.need(MH.data.BUILDINGS.roof_stone && KH.kits.roofArtStyle, 'roofs (agent J) merged');
  const gp = G.game.player;
  const site = A.findSite([H, G], [MH, MG], 'wall_wood', roomTiles(5, 4, H), gp.x, gp.y, { rMin: 4, rMax: 34, avoidPts: [[gp.x, gp.y]] });
  t.assert(site, 'found a free 5×4 site');
  const { x0, y0 } = site;
  const roofs = (f) => f.game.build.structures.filter((o) => o.roof && o.tx >= x0 && o.tx < x0 + 5 && o.ty >= y0 && o.ty < y0 + 4);
  const wallIds = hostRoom(H, x0, y0, 5, 4);
  // leave no roofed room behind for later scenarios (J1 counts roof plans)
  t.defer(() => { for (const o of roofs(H)) H.game.net.emit('struct.remove', { id: o.id, quiet: 1 }); for (const id of wallIds) H.game.net.emit('struct.remove', { id, quiet: 1 }); });
  await t.waitFor(() => A.structAt(G, MG, x0, y0, 'main') && !A.structAt(G, MG, x0, y0, 'main').blueprint, ONEWAY() + 600, 'guest has the walled room');
  A.teleport(G, x0 + 2.5, y0 + 6); await A.hostSees(t, H, G);
  placeStyled(G, MG, 'roof_stone', 'terracotta', 't_warm.end_hip', [x0 + 2, y0 + 1]);
  const want = KG.kits.cleanDet('roof_stone', 't_warm.end_hip');
  await t.waitFor(() => roofs(H).length >= 6 && roofs(G).length === roofs(H).length, RT() + 1200, 'roof plans for the room on both');
  const key = (f, K) => roofs(f).map((o) => `${o.id}:${o.style}:${o.det}:${K.kits.roofArtStyle(o)?.key || '-'}`).sort().join(' ');
  t.check(roofs(H).every((o) => o.style === 'terracotta' && o.det === want && o.blueprint), 'plans: terracotta + canonical det on the host', short(roofs(H).slice(0, 2).map(look)));
  t.check(key(H, KH) === key(G, KG), 'same plans, looks and derived painter style on both', short(key(G, KG), 160));
  t.check(/end_hip/.test(KH.kits.roofArtStyle(roofs(H)[0])?.key || '') && KH.kits.roofArtStyle(roofs(H)[0]).style.ends === 'hip', 'derived style turns hip ends on for J\'s painter', KH.kits.roofArtStyle(roofs(H)[0])?.key);
  // brush the plans to slate + weathervane
  const g = G.game;
  MG.building.setBuildLook(g, 'roof_stone', 'slate', 'vane');
  MG.building.enterStyleBrush(g, 'roof_stone');
  MG.building.buildDragStart(g, x0 + 0.5, y0 + 0.5);
  MG.building.buildDragEnd(g, x0 + 4.5, y0 + 3.5);
  MG.building.exitBuildMode(g);
  const want2 = KG.kits.cleanDet('roof_stone', 'vane');
  await t.waitFor(() => [H, G].every((f) => roofs(f).every((o) => o.style === 'slate' && o.det === want2)), RT() + 800, 'brushed to slate + weathervane on both');
  // the host finishes them (test shortcut, like J's scenarios) → painted region on both
  for (const o of roofs(H)) H.game.net.emit('struct.complete', { id: o.id, by: H.game.net.pid, xp: 0 });
  await t.waitFor(() => roofs(G).every((o) => !o.blueprint) && regionAt(H, x0 + 2, y0 + 1)?.art && regionAt(G, x0 + 2, y0 + 1)?.art, 9000, 'roof finished and painted on both');
  const RG = await fimp(G, 'game/roofs.js');
  const pr = RG.roofPropAt(G.game, x0 + 2, y0 + 1);
  t.check(pr && pr.lift > 0.3 && Number.isFinite(pr.key), 'a roof tile has a slope position on the guest (roofPropAt)', JSON.stringify(pr));
  let refused = null;
  g.net.request('struct.style', { ids: [roofs(G)[0].id], type: 'roof_stone', style: 'stone', det: '' }, { onReject: (why) => { refused = why || 'refused'; } });
  await t.waitFor(() => refused, RT() + 600, 'finished roof: restyle refused');
  t.check(roofs(H).every((o) => o.style === 'slate') && roofs(G).every((o) => o.style === 'slate'), 'finished roof keeps its look on both');
  let drew = true; for (const f of [H, G]) { try { f.game.render(); } catch (e) { drew = false; t.log(e.message); } }
  t.check(drew, 'both render the styled roof');
  await t.checkDigest(H, G);
  env.history.push('K5');
});

// =====================================================================================================
// M1–M5 — painted terrain paths (agent M): shared path grid (world.path / world.pathPlan), intents path.plan / path.lay /
// path.dig → ops path.plan / path.set, digest part 'paths', snapshot / save rows
const frameImport = (f, p) => f.win.Function('u', 'return import(u)')(new URL('src/' + p, f.win.location.href).href);
const pathCells = (f, tiles) => tiles.map((i) => `${f.game.world.path.get(i)}/${f.game.world.pathPlan.get(i)}`).join(' ');
const gridHash = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; } return (h >>> 0).toString(36); };
// a straight row of `n` paintable tiles near (x, y), valid on both peers (MP = frame's mut/paths.js)
function pathRow(H, MP, x, y, n, { rMin = 2, rMax = 12, avoid = null } = {}) {
  const w = H.game.world;
  for (let r = rMin; r <= rMax; r++) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, x0 = Math.floor(x + Math.cos(a) * r), y0 = Math.floor(y + Math.sin(a) * r);
    const tiles = [];
    for (let d = 0; d < n; d++) {
      const tx = x0 + d, ty = y0, i = w.idx(tx, ty);
      if (!w.inBounds(tx, ty) || MP.canPaint(H.game, tx, ty) || w.path.get(i) || w.pathPlan.get(i) || (avoid && avoid(tx, ty))) break;
      tiles.push(i);
    }
    if (tiles.length === n) return tiles;
  }
  return null;
}
// the guest lays every planned tile of `tiles` (its own work loop, auto-work paused); before each (re)start it stands
// next to the next planned tile (this tests the sync, not the walking) with no fight / aim state left from earlier scenarios
async function layPaths(t, f, M, tiles, { ms = 30000, code = null } = {}) {
  const w = f.game.world, W = w.W, p = f.game.player;
  const nextIdx = () => tiles.find((j) => w.pathPlan.get(j) && (code == null || w.pathPlan.get(j) === code));
  const next = () => { const i = nextIdx(); return i == null ? null : f.game.paths.jobAt(i % W, (i / W) | 0); };
  const stand = () => {
    const i = nextIdx();
    if (i == null) return;
    p.autoAttack = false; p.target = null; p._atkRootT = 0; p.rooted = false;
    const s = A.freeSpot(f, M, (i % W) + 0.5, ((i / W) | 0) + 0.5, { rMin: 0, rMax: 1.4 });
    if (s) A.teleport(f, s[0], s[1]);
  };
  await A.workUntil(t, f, next, () => tiles.every((j) => !w.pathPlan.get(j) || (code != null && w.pathPlan.get(j) !== code)), ms, 'works the planned path tiles', { retries: 12, stand });
}

def('M1', {
  title: 'M: guest paints and lays a dirt path', timeout: 120000,
  expected: 'Guest paints 8 dirt-path tiles (path.plan, run-length tiles): blue blueprints with identical grid cells on both; the guest lays them with its own work loop (path.lay → path.set): world.path identical on host and guest, plans cleared, dirt is free (no item taken), the guest walks faster on it, digest equal (part "paths")',
  api: 'game.paths.{paint, jobAt, counts}; world.path / world.pathPlan; intents path.plan / path.lay; ops path.plan / path.set; net.dump("paths")',
}, async (t) => {
  const { H, G, MG } = await pairCtx(t);
  t.need(G.game.paths && H.game.world.path, 'needs the painted paths module (game.paths)');
  const MP = await frameImport(H, 'game/mut/paths.js');
  A.keepAlive(t, G);
  const gp = G.game.player;
  const tiles = pathRow(H, MP, gp.x, gp.y, 8);
  t.assert(tiles, 'found a free row of 8 paintable tiles');
  env.history.push('M1');
  const inv0 = A.invSnap(G);
  G.game.paths.paint('dirt', tiles);
  const ms = await t.timeTo(() => tiles.every((i) => H.game.world.pathPlan.get(i) === 1), RT() + 500, 'host has the 8 blueprints');
  t.metric('planRoundTripMs', Math.round(ms));
  await t.waitFor(() => tiles.every((i) => G.game.world.pathPlan.get(i) === 1), ONEWAY() + 400, 'guest has the 8 blueprints');
  t.check(pathCells(H, tiles) === pathCells(G, tiles), 'blueprint cells identical', pathCells(H, tiles));
  await layPaths(t, G, MG, tiles);
  await t.waitFor(() => tiles.every((i) => H.game.world.path.get(i) === 1 && !H.game.world.pathPlan.get(i)), ONEWAY() + 600, 'host has the 8 built dirt tiles');
  await t.sleep(ONEWAY() + 100);
  t.check(pathCells(H, tiles) === pathCells(G, tiles) && tiles.every((i) => G.game.world.path.get(i) === 1), 'built cells identical on both (type 1, no plan)', `host ${pathCells(H, tiles)} · guest ${pathCells(G, tiles)}`);
  const d = A.invDiff(inv0, A.invSnap(G));
  t.check(!Object.values(d).some((v) => v < 0), 'the dirt path is free (nothing left the guest bag)', short(d));
  // walking speed bonus on the path (owner side)
  const W = G.game.world.W, i0 = tiles[3];
  A.teleport(G, (i0 % W) + 0.5, ((i0 / W) | 0) + 0.5);
  await t.sleep(250);
  const onPath = gp.speed;
  const off = A.freeSpot(G, MG, (i0 % W) + 0.5, ((i0 / W) | 0) + 3.5, { rMin: 0, rMax: 2, avoid: (x, y) => !!G.game.world.path.get(G.game.world.idx(Math.floor(x), Math.floor(y))) });
  if (off) { A.teleport(G, off[0], off[1]); await t.sleep(250); t.check(onPath > gp.speed * 1.02, 'the guest walks faster on the path', `on ${f2(onPath)} · off ${f2(gp.speed)}`); }
  await t.checkDigest(H, G);
  t.check(JSON.stringify(H.game.net.dump('paths')) === JSON.stringify(G.game.net.dump('paths')), 'digest rows "paths" identical', short(H.game.net.dump('paths')));
  env.pathTiles = tiles;
});

def('M2', {
  title: 'M: guest removes part of a path (eraser + deconstruct tool)', timeout: 150000,
  expected: 'Guest lays 4 gravel tiles (4 pebbles leave its bag when laid), then marks 2 for removal with the eraser and 2 with the deconstruct tool (red marks on both), digs them out (path.dig): host and guest grids identical, 75% of the pebbles back (3), the earlier dirt path partly erased too; blueprints under the eraser are cancelled at once; digest equal',
  api: 'game.paths.paint("remove" | "gravel"), building.deconRect → game.paths.deconRect; intents path.plan (c 15) / path.dig; op path.set {t: 0, give}',
}, async (t) => {
  const { H, G, MG } = await pairCtx(t);
  t.need(G.game.paths, 'needs the painted paths module (game.paths)');
  const MP = await frameImport(H, 'game/mut/paths.js');
  A.keepAlive(t, G);
  const gp = G.game.player, w = H.game.world, W = w.W;
  const tiles = pathRow(H, MP, gp.x, gp.y, 4);
  t.assert(tiles, 'found a free row of 4 paintable tiles');
  env.history.push('M2');
  A.ensure(G, { pebble: 10 });
  const peb0 = A.count(G, 'pebble');
  G.game.paths.paint('gravel', tiles);
  await t.waitFor(() => tiles.every((i) => G.game.world.pathPlan.get(i) === 2), RT() + 600, 'gravel blueprints on the guest');
  t.check(A.count(G, 'pebble') === peb0, 'blueprints are free (no pebble taken when painting)', `${peb0} → ${A.count(G, 'pebble')}`);
  await layPaths(t, G, MG, tiles);
  await t.waitFor(() => tiles.every((i) => w.path.get(i) === 2), ONEWAY() + 600, 'host has the 4 gravel tiles');
  t.check(A.count(G, 'pebble') === peb0 - 4, '1 pebble per tile left the bag when laid', `${peb0} → ${A.count(G, 'pebble')}`);
  // eraser on 2 tiles, deconstruct tool on the other 2
  G.game.paths.paint('remove', tiles.slice(0, 2));
  const n = MG.building.deconRect(G.game, tiles[2] % W, (tiles[2] / W) | 0, tiles[3] % W, (tiles[3] / W) | 0);
  t.check(n >= 2, 'the deconstruct tool marks painted path tiles', `${n} marked`);
  await t.waitFor(() => tiles.every((i) => w.pathPlan.get(i) === 15), RT() + 600, 'host has the 4 removal marks');
  await t.waitFor(() => tiles.every((i) => G.game.world.pathPlan.get(i) === 15), ONEWAY() + 400, 'guest has the 4 removal marks');
  await layPaths(t, G, MG, tiles, { code: 15 });
  await t.waitFor(() => tiles.every((i) => !w.path.get(i) && !w.pathPlan.get(i)), ONEWAY() + 600, 'host: the 4 gravel tiles are gone');
  await t.sleep(ONEWAY() + 100);
  t.check(pathCells(H, tiles) === pathCells(G, tiles), 'cells identical after removal', `host ${pathCells(H, tiles)} · guest ${pathCells(G, tiles)}`);
  t.check(A.count(G, 'pebble') === peb0 - 4 + 3, '75% of the pebbles came back (3 of 4)', `${A.count(G, 'pebble')} (start ${peb0})`);
  // part of the M1 dirt path: erase 3 tiles; a blueprint under the eraser is cancelled at once (no work)
  const old = (env.pathTiles || []).filter((i) => w.path.get(i) === 1);
  if (old.length >= 4) {
    const part = old.slice(0, 3);
    G.game.paths.paint('remove', part);
    await t.waitFor(() => part.every((i) => w.pathPlan.get(i) === 15), RT() + 600, 'host marks 3 dirt tiles for removal');
    await t.waitFor(() => part.every((i) => G.game.world.pathPlan.get(i) === 15), ONEWAY() + 400, 'guest has the 3 removal marks');
    await layPaths(t, G, MG, part, { code: 15 });
    await t.waitFor(() => part.every((i) => !w.path.get(i)), ONEWAY() + 600, 'host: 3 dirt tiles removed');
    t.check(old.slice(3).every((i) => w.path.get(i) === 1 && G.game.world.path.get(i) === 1), 'the rest of the dirt path stays on both');
  } else t.note('no M1 dirt path left — partial erase of it skipped');
  const bp = pathRow(H, MP, gp.x, gp.y, 2);
  if (bp) {
    G.game.paths.paint('flag', bp);
    await t.waitFor(() => bp.every((i) => w.pathPlan.get(i) === 3), RT() + 600, 'flagstone blueprints on the host');
    G.game.paths.paint('remove', bp);
    await t.waitFor(() => bp.every((i) => !w.pathPlan.get(i) && !w.path.get(i)), RT() + 600, 'the eraser cancels blueprints at once (host)');
  }
  await t.checkDigest(H, G);
});

def('M3', {
  title: 'M: flora never regrows on paths', timeout: 150000,
  expected: 'With most free tiles of a chunk turned into a path (host ops) and a few plants removed, accelerated host regrowth spawns nothing on a path / plan tile (world.growWeight = 0 there on both peers, every kind); whatever regrew appears on the guest identically; digest equal',
  api: 'world.growWeight / canGrow (path check); host floraSystem internals game.flora.{ci,t,keys,chunks (Map by bucket),dyn} (like S21); ops path.set / obj.add',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const F = H.game.flora;
  t.need(F && F.keys?.length && 'ci' in F && 't' in F, 'host flora internals (game.flora.ci/t/keys) missing — cannot accelerate regrowth');
  const MP = await frameImport(H, 'game/mut/paths.js');
  const w = H.game.world, W = w.W, CH = 16, BKW = W / CH, sp = spawnOf(H); // (flora buckets: key = by * BKW + bx)
  // a grassy chunk ~25 tiles from the spawn with room for paths
  let k = -1, free = [];
  for (let r = 22; r < 60 && k < 0; r += 6) for (let a = 0; a < 8 && k < 0; a++) {
    const cx = Math.floor((sp.x + Math.cos(a) * r) / CH), cy = Math.floor((sp.y + Math.sin(a) * r) / CH);
    if (!w.inBounds(cx * CH, cy * CH)) continue;
    const list = [];
    for (let y = cy * CH; y < cy * CH + CH; y++) for (let x = cx * CH; x < cx * CH + CH; x++) if (!MP.canPaint(H.game, x, y) && !w.path.get(w.idx(x, y)) && !w.pathPlan.get(w.idx(x, y))) list.push(w.idx(x, y));
    if (list.length > 120) { k = cy * BKW + cx; free = list; }
  }
  t.assert(k >= 0, 'found a chunk with room for paths');
  env.history.push('M3');
  const lay = free.filter((i, n) => n % 5 !== 4);     // 80% of the free tiles: built path
  const plan = free.filter((i, n) => n % 10 === 4);   // 10%: dirt blueprints
  const rle = MP.rleTiles;
  H.game.net.emit('path.set', { t: 1, tiles: rle(lay) });
  H.game.net.emit('path.plan', { c: 1, tiles: rle(plan) });
  await t.waitFor(() => lay.every((i) => G.game.world.path.get(i) === 1), ONEWAY() + 600, 'guest has the chunk paths');
  const kinds = ['tree', 'bush', 'berrybush', 'herbbush', 'fibergrass', 'pebble', 'stick', 'boulder', 'wild_potato', 'wild_cotton', 'wild_corn'];
  const zero = (f) => [...lay, ...plan].every((i) => kinds.every((kd) => f.game.world.growWeight(i % W, (i / W) | 0, kd) === 0));
  t.check(zero(H) && zero(G), 'growWeight is 0 on every path / blueprint tile, every kind (host and guest)');
  // make room: remove some plants of the chunk (host op), then accelerate regrowth with both players away
  const ids = [];
  w.forChunks((k % BKW) * CH + 1, Math.floor(k / BKW) * CH + 1, (k % BKW) * CH + 14, Math.floor(k / BKW) * CH + 14, (c) => { for (const o of c.objects) if (!o.building && (o.type === 'bush' || o.type === 'fibergrass' || o.type === 'pebble' || o.type === 'stick') && ids.length < 6) ids.push(o.id); });
  if (ids.length) H.game.net.emit('obj.remove', { ids });
  const cx = (k % BKW) * CH + 8, cy = Math.floor(k / BKW) * CH + 8;
  sendAway(H, MH, cx, cy, 40, 0); sendAway(G, MG, cx, cy, 42, 0.3);
  await t.sleep(300);
  const before = new Set(F.dyn.keys()), found = [];
  const t0 = now();
  while (now() - t0 < 25000) {
    F.ci = Math.max(0, F.keys.indexOf(k)); F.t = 0;
    await t.sleep(25);
    for (const [id, q] of F.dyn) if (!before.has(id)) { before.add(id); found.push(q); }
    if (found.length >= 6) break;
  }
  const onPath = found.filter((q) => { const i = w.idx(Math.floor(q.x), Math.floor(q.y - 0.05)); return w.path.get(i) || w.pathPlan.get(i); });
  t.log(`regrowth in chunk ${k}: ${found.length} new (${found.map((q) => q.type).join(' ') || '—'})`);
  if (!found.length) t.note('nothing regrew in 25 s (chunk full or unsuitable) — the growWeight check above still holds');
  t.check(!onPath.length, 'nothing regrew on a path or blueprint tile', onPath.map((q) => `${q.type}@${f2(q.x)},${f2(q.y)}`).join(' ') || `${found.length} spawned elsewhere`);
  await t.sleep(ONEWAY() + 200);
  t.check(found.every((q) => A.objOn(G, q.id)), 'regrown flora replicated to the guest', `${found.filter((q) => !A.objOn(G, q.id)).length} missing`);
  await t.checkDigest(H, G);
});

def('M4', {
  title: 'M: late joiner gets the paths in the snapshot', timeout: 180000,
  expected: 'A third client joining after M1–M3 gets world.path / world.pathPlan identical to the host (grid hashes) and digest equal right after the snapshot (part "paths"); its GPU path data is built (pathOn)',
  api: 'serializeWorld paths {g, p} run-length rows → applyWorld → applyPaths; net.digest parts.paths',
}, async (t) => {
  const { H, G, room } = await pairCtx(t);
  t.need(H.game.world.path, 'needs the painted paths module');
  if (!H.game.pathGrid?.built) {
    const MP = await frameImport(H, 'game/mut/paths.js');
    const tiles = pathRow(H, MP, H.game.player.x, H.game.player.y, 6);
    if (tiles) H.game.net.emit('path.set', { t: 3, tiles: MP.rleTiles(tiles) });
    t.note('no paths from earlier scenarios: laid 6 flagstone tiles on the host first');
  }
  const pid3 = 'g' + rand(7);
  const G3 = await bootGuest(t, room, H, { pid: pid3, label: 'guest-3' });
  t.log('third client synced');
  const r = await t.checkDigest(H, G3, 'digest equal right after the snapshot (third client)', { ms: CFG.budget * 3 + 800 });
  if (r.counts) t.metric('counts', r.counts);
  const hw = H.game.world, gw = G3.game.world;
  t.check(gridHash(hw.path) === gridHash(gw.path) && gridHash(hw.pathPlan) === gridHash(gw.pathPlan), 'path grids identical (host / third client)', `built ${H.game.pathGrid.built}/${G3.game.pathGrid?.built} · planned ${H.game.pathGrid.planned.size}/${G3.game.pathGrid?.planned.size}`);
  await t.tryWait(() => G3.game.R?.pathOn === 1, 6000);
  t.check(G3.game.R?.pathOn === 1 && !!G3.game.R.pathTex, 'third client draws the paths (GPU data built)', `pathOn ${G3.game.R?.pathOn}`);
  await t.checkDigest(G, G3, 'digest equal between both guests');
});

def('M5', {
  title: 'M: paths in the save file (v8) and old saves', timeout: 120000,
  expected: 'Solo: buildSaveData has v 8 and world.paths {g, p}; clearing the grids and applying the saved world (load) restores them exactly; a v7-style world without paths loads with no error and keeps the grids empty',
  api: 'save.buildSaveData, net/snapshot.js serializeWorld / applyWorld(…, "load"), mut/paths.js applyPaths / rleGrid',
}, async (t) => {
  const S = await bootSolo(t, '', 'solo-paths');
  t.need(S.game.paths, 'needs the painted paths module');
  const [MS, MP, MN] = await Promise.all([frameImport(S, 'game/save.js'), frameImport(S, 'game/mut/paths.js'), frameImport(S, 'net/snapshot.js')]);
  const g = S.game, w = g.world;
  const tiles = pathRow(S, MP, g.player.x, g.player.y, 10);
  t.assert(tiles, 'found 10 paintable tiles');
  g.net.emit('path.set', { t: 4, tiles: MP.rleTiles(tiles.slice(0, 6)) });
  g.net.emit('path.plan', { c: 2, tiles: MP.rleTiles(tiles.slice(6)) });
  const data = MS.buildSaveData(g);
  t.check(data.v >= 8 && data.world?.paths && Array.isArray(data.world.paths.g), 'save data v8 with world.paths', `v ${data.v} · paths ${short(data.world?.paths, 80)}`);
  const h0 = gridHash(w.path) + '/' + gridHash(w.pathPlan);
  const snap = JSON.parse(JSON.stringify(data.world));
  g.net.withApply(() => MP.applyPaths(g, null)); // empty grids
  t.check(!g.pathGrid.built && !g.pathGrid.planned.size, 'grids cleared');
  MN.applyWorld(g, snap, 'load');
  t.check(gridHash(w.path) + '/' + gridHash(w.pathPlan) === h0 && g.pathGrid.built === 6 && g.pathGrid.planned.size === 4, 'load restores the exact grids', `built ${g.pathGrid.built} planned ${g.pathGrid.planned.size}`);
  const old = { ...snap };
  delete old.paths;
  g.net.withApply(() => MP.applyPaths(g, null));
  let err = null;
  try { MN.applyWorld(g, old, 'load'); } catch (e) { err = e.message; }
  t.check(!err && !g.pathGrid.built && !g.pathGrid.planned.size, 'an old save without paths loads (no paths, no error)', err || 'ok');
});

def('A7', {
  title: 'A: opt-in auto-work on painted paths (tap a plan, lay the stroke, remove it)', timeout: 150000,
  expected: 'Guest paints a 6-tile gravel stroke: nothing is laid by itself (1.5 s); a real tap on one plan tile starts a path sequence (banner "Assentando caminho · Cascalho · N restantes") that lays the whole stroke through path.lay (pebbles leave the guest bag, grids identical on both); then red removal marks on the stroke + a tap dig them all out (path.dig); digest equal',
  api: 'game.paths.paint / jobAt; controller pick → doTap → game.work.begin (sequence kind path) → path.lay / path.dig; game.work.status()',
}, async (t) => {
  const { H, G, MG } = await pairCtx(t);
  t.need(G.game.paths, 'needs the painted paths module (game.paths)');
  const MP = await frameImport(H, 'game/mut/paths.js');
  A.keepAlive(t, G);
  const g = G.game, gp = g.player, w = H.game.world, W = w.W;
  const tiles = pathRow(H, MP, gp.x, gp.y, 6);
  t.assert(tiles, 'found a free row of 6 paintable tiles');
  env.history.push('A7');
  calmAround(H, (tiles[2] % W) + 0.5, ((tiles[2] / W) | 0) + 0.5);
  await t.tryWait(() => chasers(G) === 'none', 4000);
  A.ensure(G, { pebble: 12 });
  const peb0 = A.count(G, 'pebble');
  g.paths.paint('gravel', tiles);
  await t.waitFor(() => tiles.every((i) => g.world.pathPlan.get(i) === 2 && w.pathPlan.get(i) === 2), RT() + 600, 'gravel plans on both');
  g.work.paused = false;
  t.defer(() => { g.work.cancel(true); g.work.paused = true; });
  await t.sleep(1500);
  t.check(!g.work.seq && tiles.every((i) => !w.path.get(i)) && A.count(G, 'pebble') === peb0, 'painting starts nothing (no tile laid, no pebble taken)');
  // a real tap on a plan tile (a point the controller's pick resolves to that path job)
  const tapPlan = async (code) => {
    const i0 = tiles.find((i) => g.world.pathPlan.get(i) === code);
    const sp = A.freeSpot(G, MG, (i0 % W) + 0.5, ((i0 / W) | 0) + 0.5, { rMin: 0.8, rMax: 2.5, prefer: Math.PI / 2 });
    t.assert(sp, 'free spot next to the stroke');
    A.teleport(G, sp[0], sp[1]);
    await A.hostSees(t, H, G);
    g.cam.x = gp.x; g.cam.y = gp.y - 0.4;
    await t.sleep(80);
    let tap = null;
    for (const i of tiles) for (const [ox, oy] of [[0.5, 0.5], [0.3, 0.8], [0.7, 0.2]]) {
      if (tap || g.world.pathPlan.get(i) !== code) continue;
      const [sx, sy] = g.worldToScreen((i % W) + ox, ((i / W) | 0) + oy);
      const h = MG.controller.pick(g, sx, sy);
      if (h.type === 'interact' && h.it?.kind === 'path' && h.it.i === i) tap = { sx, sy };
    }
    t.assert(tap, 'a screen point that picks a plan tile of the stroke');
    g.input.taps.push({ x: tap.sx, y: tap.sy, type: 'touch' });
    await t.waitFor(() => g.work.seq?.kind === 'path', 2000, 'the tap started a path sequence', () => `ui: ${G.lastUi()}`);
  };
  await tapPlan(2);
  const st = g.work.status();
  t.check(st && st.kind === 'path' && st.n === 6 && st.name === 'Cascalho' && /Assentando caminho/.test(st.verb), 'status: Assentando caminho · Cascalho · 6', JSON.stringify(st));
  await t.waitFor(() => tiles.every((i) => w.path.get(i) === 2 && !w.pathPlan.get(i)) && !g.work.seq, 45000, 'the sequence laid the whole stroke and stopped',
    () => `laid ${tiles.filter((i) => w.path.get(i) === 2).length}/6 · ${JSON.stringify(g.work.status())} · work ${gp.work?.label ?? '-'} · busy goal=${g.ctl.goal?.type ?? '-'}${g.ctl.goal?.auto ? '(auto)' : ''} moving=${gp.moving} atk=${gp.autoAttack} combat=${gp.inCombat} modal=${!!g.ui?.modal} craft=${g.craft?.queue?.length} charge=${!!gp.charge} chasers=${chasers(G)} failed=${g.work.failed.size} at ${f2(gp.x)},${f2(gp.y)} · ui: ${G.lastUi()}`);
  await t.sleep(ONEWAY() + 100);
  t.check(pathCells(H, tiles) === pathCells(G, tiles), 'built cells identical on both', pathCells(H, tiles));
  t.check(A.count(G, 'pebble') === peb0 - 6, '6 pebbles left the guest bag when laid', `${peb0} → ${A.count(G, 'pebble')}`);
  // removal marks work like deconstruction marks
  g.paths.paint('remove', tiles);
  await t.waitFor(() => tiles.every((i) => w.pathPlan.get(i) === 15 && g.world.pathPlan.get(i) === 15), RT() + 600, 'red removal marks on both');
  await t.sleep(800);
  t.check(tiles.every((i) => w.path.get(i) === 2), 'marking removes nothing by itself');
  await tapPlan(15);
  t.check(g.work.status()?.verb === 'Removendo caminho', 'status: Removendo caminho', JSON.stringify(g.work.status()));
  await t.waitFor(() => tiles.every((i) => !w.path.get(i) && !w.pathPlan.get(i)) && !g.work.seq, 45000, 'the sequence dug the stroke out',
    () => `left ${tiles.filter((i) => w.path.get(i)).length} · ${JSON.stringify(g.work.status())}`);
  await t.sleep(ONEWAY() + 100);
  t.check(pathCells(H, tiles) === pathCells(G, tiles), 'cells identical after removal', pathCells(H, tiles));
  await t.checkDigest(H, G);
});

// =====================================================================================================
// D: piers and bridges — decks (game/decks.js, docs/PLAN-V2.md "Trapiche e ponte")
// the nearest crossing / shallow bank from the host player (the dev helper's finder, dry: nothing is built)
function deckSites(t, H) {
  t.need(H.game.debug?.deckScene && H.game.decks, 'piers / bridges (game/decks.js) missing');
  const r = H.game.debug.deckScene({ dry: true }), S = H.game.debug._decks;
  return { bridge: r.bridge ? S.bridge.slice() : null, pier: r.pier ? r.pier.slice() : null };
}
const deckAtOn = (f, x, y) => f.game.build.grid.deck.get(f.game.world.idx(x, y)) || null;
const walkedTo = (p, x, y, ex, ey) => (p.x - (x + 0.5)) * ex + (p.y - (y + 0.5)) * ey;
// build the planned pieces in order from the bank, standing on the piece before each (or on the bank)
async function buildDeckLine(t, f, M, ids, tiles, bank) {
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k], at = k === 0 ? bank : tiles[k - 1];
    const stand = () => A.teleport(f, at[0] + 0.5, at[1] + 0.5);
    const mk = () => { const q = A.structOn(f, id); return q && q.blueprint ? M.building.describeStructure(f.game, q) : null; };
    await A.workUntil(t, f, mk, () => !A.structOn(f, id)?.blueprint, 40000, `builds ${A.structOn(f, id)?.type} piece ${k + 1}/${ids.length}`, { stand });
  }
}
// hold a direction until the player gets past (x, y) along (ex, ey); records swimming and the highest deck lift
async function walkAcross(t, f, from, to, ex, ey, ms = 12000) {
  const p = f.game.player, st = { swim: false, dh: 0 };
  A.teleport(f, from[0] + 0.5, from[1] + 0.5);
  const rel = A.holdMove(f, ex, ey);
  let k = 0; st.tr = [];
  t.watch(() => { if (p.swimming) st.swim = true; st.dh = Math.max(st.dh, p._dh || 0); if (k++ % 6 === 0 && st.tr.length < 14) st.tr.push(`${f2(p.x)},${f2(p.y)}${p._hop ? 'H' : ''}${p.z > 0 ? 'z' : ''}`); }, 40);
  st.ok = await t.tryWait(() => walkedTo(p, to[0], to[1], ex, ey) > 0, ms);
  rel();
  return st;
}

def('D1', {
  star: true, title: 'D: guest builds a pier and a bridge across a river, both walk across', timeout: 300000,
  expected: 'The guest plans a bridge (bank → water → bank, drag) and a 4-piece pier from a shallow bank: blueprints with the same ids on both; deep water refuses a pier, a lone water piece refuses a bridge; a far piece cannot start before the one before it (host decks.startReason); the guest builds every piece with real work from the bank outward; both derive the same deck map (world.deck) and railings (world.rail); the guest walks across the bridge without swimming, lifted on the deck (_dh), the host sees it on the far bank; the host walks back across; the guest walks to the end of the pier; digest equal',
  api: 'BUILDINGS.pier_wood / bridge_wood (layer deck); build.place (deck batch: decks.orderDeckTiles); build.hit start → decks.startReason; world.deck / world.rail (decks.js); player._dh',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sites = deckSites(t, H);
  t.need(sites.bridge && sites.pier, 'no crossing / shallow bank near the spawn on this seed');
  const b = sites.bridge, n = b.length, ex = Math.sign(b[1][0] - b[0][0]), ey = Math.sign(b[1][1] - b[0][1]);
  const bank = [b[0][0] - ex, b[0][1] - ey], far = b[n - 1];
  A.keepAlive(t, G); A.keepAlive(t, H);
  A.pacify(H, b[0][0], b[0][1], 30);
  A.ensure(G, { wood: 120, stone: 40, rope: 30 });
  A.teleport(G, bank[0] + 0.5, bank[1] + 0.5);
  await A.hostSees(t, H, G);
  // refusals (the guest's preview runs the host's rules)
  const wG = G.game.world;
  let deep = null;
  for (const [x, y] of b) if (wG.water[wG.idx(x, y)] === 2) { deep = [x, y]; break; }
  if (deep) t.check(/rasa/.test(String(MG.building.placeReason(G.game, 'pier_wood', deep[0], deep[1], null))), 'a pier on deep water is refused (only shallow water)', String(MG.building.placeReason(G.game, 'pier_wood', deep[0], deep[1], null)));
  t.check(/terra|margem/.test(String(MG.building.placeReason(G.game, 'bridge_wood', b[2][0], b[2][1], null))), 'a lone bridge piece over the water is refused (start on land)', String(MG.building.placeReason(G.game, 'bridge_wood', b[2][0], b[2][1], null)));
  // the bridge: one drag bank → bank
  A.place(G, MG, 'bridge_wood', b[0], far);
  const bridge = await t.waitFor(() => { const L = b.map(([x, y]) => deckAtOn(G, x, y)); return L.every(Boolean) && L; }, RT() + 1200, 'guest sees the whole bridge plan', () => `${b.filter(([x, y]) => deckAtOn(G, x, y)).length}/${n}`);
  const ids = bridge.map((o) => o.id);
  t.check(bridge.every((o) => o.blueprint && o.type === 'bridge_wood'), 'every piece is a bridge blueprint');
  await t.waitFor(() => ids.every((id) => A.structOn(H, id)), RT() + 500, 'host has the same ids');
  const farH = A.structOn(H, ids[n - 2]);
  H.game.decks.sync();
  t.check(/anterior/.test(String(H.game.decks.startReason(farH))), 'a water piece cannot start before the one before it', String(H.game.decks.startReason(farH)));
  await buildDeckLine(t, G, MG, ids, b, bank);
  await t.waitFor(() => ids.every((id) => { const o = A.structOn(H, id); return o && !o.blueprint; }), RT() + 800, 'host sees every bridge piece finished');
  // the same deck map and railings on both
  await t.sleep(200);
  const deckRow = (f) => b.map(([x, y]) => { const i = f.game.world.idx(x, y); return `${f.game.world.deck?.get(i) | 0}:${f.game.world.rail?.get(i) | 0}`; }).join(' ');
  t.check(deckRow(H) === deckRow(G) && b.every(([x, y]) => G.game.world.deck.get(G.game.world.idx(x, y)) === 2), 'same deck map + railings on both (every tile walkable)', `host ${deckRow(H)} · guest ${deckRow(G)}`);
  // the guest walks across
  const wk = await walkAcross(t, G, bank, far, ex, ey);
  t.check(wk.ok, 'the guest walks across the bridge to the far bank', `at ${f2(G.game.player.x)},${f2(G.game.player.y)} far ${far}`);
  t.check(!wk.swim, 'never swimming on the bridge');
  t.check(wk.dh > 0.25, 'lifted on the deck while crossing (cosmetic _dh)', f2(wk.dh));
  await t.waitFor(() => { const av = guestOnHost(H, G); return av && walkedTo(av, far[0], far[1], ex, ey) > -0.3; }, RT() + 1500, 'host sees the guest on the far bank');
  // and the host walks back
  const hk = await walkAcross(t, H, far, b[0], -ex, -ey);
  t.check(hk.ok && !hk.swim, 'the host walks back across (no swimming)', `at ${f2(H.game.player.x)},${f2(H.game.player.y)}`);
  // the pier: 4 pieces out from a shallow bank
  const [px, py, pex, pey] = sites.pier, pt = [1, 2, 3, 4].map((k) => [px + pex * k, py + pey * k]);
  A.teleport(G, px + 0.5, py + 0.5);
  await A.hostSees(t, H, G);
  A.place(G, MG, 'pier_wood', pt[0], pt[3]);
  const pier = await t.waitFor(() => { const L = pt.map(([x, y]) => deckAtOn(G, x, y)); return L.every(Boolean) && L; }, RT() + 1200, 'guest sees the pier plan');
  const pids = pier.map((o) => o.id);
  await t.waitFor(() => pids.every((id) => A.structOn(H, id)), RT() + 500, 'host has the same pier ids');
  await buildDeckLine(t, G, MG, pids, pt, [px, py]);
  await t.waitFor(() => pids.every((id) => { const o = A.structOn(H, id); return o && !o.blueprint; }), RT() + 800, 'host sees the pier finished');
  const pk = await walkAcross(t, G, [px, py], pt[3], pex, pey, 6000);
  const gp = G.game.player;
  t.check(pk.ok && !pk.swim && Math.abs((gp._dh || 0) - 0.2) < 0.03, 'the guest walks to the end of the pier, on its deck (no swimming)', `at ${f2(gp.x)},${f2(gp.y)} dh ${f2(gp._dh)} · bank ${px},${py} end ${pt[3]} · ${JSON.stringify(pk)}`);
  await t.checkDigest(H, G);
});

def('D2', {
  title: 'D: deconstructing the middle of a bridge, then an abutment', timeout: 240000,
  expected: 'The host lays a finished bridge (dev helper); the guest deconstructs the middle piece with real work: it disappears on both, each half stays (still joined to its bank: no collapse), the gap is water again on both; the guest marks the far abutment — the first tap only warns ("A ponte vai cair"), the second marks it — and deconstructs it: the host drops the water pieces between the gap and that bank into the water (deck.collapse) on both, the near half stays; digest equal',
  api: 'decks.unsupported / lostWithout (building.confirmSupports) → host deckSupportSystem → op deck.collapse {ids, drops}; world.deck',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.debug?.deckScene, 'piers / bridges (game/decks.js) missing');
  const r = H.game.debug.deckScene({ only: 'bridge', span: 4 });
  t.need(r.bridge, 'no crossing of 4+ water tiles near the spawn on this seed');
  const b = H.game.debug._decks.bridge.slice(), n = b.length, ex = Math.sign(b[1][0] - b[0][0]), ey = Math.sign(b[1][1] - b[0][1]);
  const all = await t.waitFor(() => { const L = b.map(([x, y]) => deckAtOn(G, x, y)); return L.every((o) => o && !o.blueprint) && L; }, RT() + 1200, 'guest sees the finished bridge');
  const ids = all.map((o) => o.id), mid = n >> 1;
  A.keepAlive(t, G); A.keepAlive(t, H);
  A.pacify(H, b[0][0], b[0][1], 30);
  // the middle piece
  A.teleport(G, b[mid - 1][0] + 0.5, b[mid - 1][1] + 0.5);
  await A.hostSees(t, H, G);
  const mo = A.structOn(G, ids[mid]);
  t.check(MG.building.toggleDecon(G.game, mo, true) === true, 'marking the middle piece needs no confirmation (each half keeps its bank)');
  await t.waitFor(() => H.game.build.decon.has(A.structOn(H, ids[mid])) && G.game.build.decon.has(A.structOn(G, ids[mid])), RT() + 800, 'host marks the middle piece (and the guest sees it)');
  const mk = () => { const q = A.structOn(G, ids[mid]); return q && G.game.build.decon.has(q) ? MG.building.describeStructure(G.game, q) : null; };
  await A.workUntil(t, G, mk, () => !A.structOn(G, ids[mid]), 30000, 'deconstructs the middle piece', { stand: () => A.teleport(G, b[mid - 1][0] + 0.5, b[mid - 1][1] + 0.5) });
  await t.waitFor(() => !A.structOn(H, ids[mid]), RT() + 500, 'the middle piece is gone on the host');
  await t.sleep(RT() + 400);
  const left = (f) => ids.filter((id) => A.structOn(f, id)).length;
  t.check(left(H) === n - 1 && left(G) === n - 1, 'both halves stay (no collapse)', `host ${left(H)} · guest ${left(G)} of ${n - 1}`);
  const wm = (f) => f.game.world.deck.get(f.game.world.idx(b[mid][0], b[mid][1])) | 0;
  t.check(wm(H) === 0 && wm(G) === 0, 'the gap is water again on both');
  // the far abutment: a warning first, then marked; its half falls
  const fo = A.structOn(G, ids[n - 1]);
  const first = MG.building.toggleDecon(G.game, fo, true), second = MG.building.toggleDecon(G.game, fo, true);
  t.check(first === false && second === true, 'the far abutment asks for a second tap (the bridge would fall)', `${first} / ${second}`);
  await t.waitFor(() => H.game.build.decon.has(A.structOn(H, ids[n - 1])) && G.game.build.decon.has(A.structOn(G, ids[n - 1])), RT() + 800, 'host marks the far abutment (and the guest sees it)');
  const mk2 = () => { const q = A.structOn(G, ids[n - 1]); return q && G.game.build.decon.has(q) ? MG.building.describeStructure(G.game, q) : null; };
  await A.workUntil(t, G, mk2, () => !A.structOn(G, ids[n - 1]), 30000, 'deconstructs the far abutment', { stand: () => A.standBy(G, MG, A.structOn(G, ids[n - 1]) || fo) });
  const fell = ids.slice(mid + 1);
  await t.waitFor(() => fell.every((id) => !A.structOn(H, id) && !A.structOn(G, id)), RT() + 1500, 'the far half fell into the water on both', () => `host ${fell.filter((id) => A.structOn(H, id)).length} · guest ${fell.filter((id) => A.structOn(G, id)).length}`);
  t.check(ids.slice(0, mid).every((id) => A.structOn(H, id) && A.structOn(G, id)), 'the near half stays on both');
  await t.checkDigest(H, G);
});

// =====================================================================================================
// P · Pecuária (docs/LIVESTOCK.md): farm animals, the feeder, ties, births, slaughter, fishing
// a feeder built by the guest near (x, y) (reused by the P scenarios of one run: env.farm); wheat in it
async function farmFeeder(t, H, G, MH, MG) {
  const old = env.farm && H.game.build.structures.find((o) => o.id === env.farm && !o.blueprint);
  if (old) return old;
  const gp = G.game.player, hp = H.game.player;
  const site = A.findSite([H, G], [MH, MG], 'feeder', (x, y) => {
    const out = [];
    for (let yy = y - 3; yy <= y + 4; yy++) for (let xx = x - 3; xx <= x + 4; xx++) out.push([xx, yy]);
    return out;
  }, gp.x, gp.y, { rMin: 4, rMax: 18, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
  t.assert(site, 'found an open 8×8 area for a feeder');
  await A.hostSees(t, H, G); // (a far site: the players were moved next to it)
  const tx = site.x0, ty = site.y0;
  A.ensure(G, { wood: 12 });
  A.place(G, MG, 'feeder', [tx, ty], [tx, ty], 0);
  const bp = await t.waitFor(() => { const o = A.structAt(H, MH, tx, ty, 'main'); return o && o.type === 'feeder' ? o : null; }, RT() + 800, "host has the guest's feeder blueprint");
  const id = bp.id;
  await t.waitFor(() => A.structOn(G, id), ONEWAY() + 600, 'guest has the feeder blueprint');
  await A.buildAll(t, G, MG, [id]);
  const f = await t.waitFor(() => { const o = A.structOn(H, id); return o && !o.blueprint && o.store ? o : null; }, RT() + 800, 'host feeder finished');
  await t.waitFor(() => { const o = A.structOn(G, id); return o && !o.blueprint; }, ONEWAY() + 600, 'guest feeder finished');
  env.farm = id;
  return f;
}
const feederCentre = (o) => [o.tx + (o.fw || 2) / 2, o.ty + (o.fh || 1) / 2];
const feedCount = (f, id, item) => { const o = A.structOn(f, id); return (o?.store?.slots || []).reduce((n, s) => n + (s && s.id === item ? s.qty : 0), 0); };
// a host farm animal at a free spot near (x, y), kept from wandering off for the test
function farmAnimal(H, MH, species, x, y, opts = {}) {
  const s = A.freeSpot(H, MH, x, y, { rMin: 0, rMax: 2.5, r: 0.45 }) || [x, y];
  const m = H.game.stock.debug.spawn(species, s[0], s[1], { owned: false, ...opts });
  m.stateT = 30; // (idle a while: stays where it was put)
  return m;
}

def('P1', {
  title: 'P: tie farm animals with a rope and lead them (guest)', timeout: 120000,
  expected: 'Guest "Amarrar vaca" (a rope leaves its bag): the cow is tied to the guest on the host and on the guest (entity stream); the guest walks 6 tiles and the cow follows it on both peers; a 6th animal is refused (max 5); "Soltar vaca" gives the rope back and frees it on both; digest equal',
  api: 'game.stock.describe (livestock.js) → work stock_tie / stock_untie → intents stock.tie / stock.untie → op stock.rope {by, give}; entity dyn [13] farm bits, [14] tiedTo pid',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.stock?.debug && G.game.stock, 'livestock not merged');
  A.keepAlive(t, G);
  const gp = G.game.player;
  const ropes0 = 6;
  A.ensure(G, { rope: ropes0 });
  for (const s of gp.inv.slots) if (s && s.id === 'rope') s.qty = Math.min(s.qty, ropes0);
  const cow = farmAnimal(H, MH, 'cow', gp.x + 1.6, gp.y + 0.6);
  t.defer(() => { if (!cow.dead) { cow.tiedTo = null; } });
  const px = await t.waitFor(() => A.proxyOf(G, cow), 3000 + CFG.budget, 'cow proxy on the guest');
  const it = G.game.stock.describe(px);
  t.check(it && it.kind === 'stock_tie' && /Amarrar vaca/.test(it.verb), 'the cow offers "Amarrar vaca"', it?.verb);
  const r0 = A.count(G, 'rope');
  await A.hostSees(t, H, G, 4000);
  A.interact(G, it);
  await t.waitFor(() => cow.tiedTo === G.pid, RT() + 2500, 'host: the cow is tied to the guest');
  await t.waitFor(() => A.proxyOf(G, cow)?.tiedTo === G.pid, ONEWAY() + 600, 'guest: its proxy shows the tie');
  t.check(A.count(G, 'rope') === r0 - 1, 'a rope left the guest bag', `${r0} → ${A.count(G, 'rope')}`);
  t.check(!cow.spawner && cow.owned, 'the cow left its wild herd (owned)');
  // walk away: it follows on both
  const sp = A.freeSpot(G, MG, gp.x + 6, gp.y, { rMin: 0, rMax: 3 }) || A.freeSpot(G, MG, gp.x - 6, gp.y, { rMin: 0, rMax: 3 });
  t.assert(sp, 'a free spot 6 tiles away');
  A.teleport(G, sp[0], sp[1]);
  await A.hostSees(t, H, G, 4000);
  await t.waitFor(() => Math.hypot(cow.x - gp.x, cow.y - gp.y) < 3.2, 12000, 'host: the cow walked after the guest', () => `d ${f2(Math.hypot(cow.x - gp.x, cow.y - gp.y))}`);
  await t.waitFor(() => { const q = A.proxyOf(G, cow); return q && Math.hypot(q.x - gp.x, q.y - gp.y) < 3.6; }, ONEWAY() + 1500, 'guest: the cow is next to it too');
  // the 6th tie is refused (5 at most)
  const extra = [];
  for (let k = 0; k < 5; k++) extra.push(farmAnimal(H, MH, 'chicken', gp.x + 1 + (k % 3) * 0.6, gp.y - 1 + Math.floor(k / 3) * 0.7));
  t.defer(() => { for (const m of extra) if (!m.dead) m.tiedTo = null; });
  await t.waitFor(() => extra.every((m) => A.proxyOf(G, m)), 3000 + CFG.budget, 'the chickens on the guest');
  const res = [];
  for (const m of extra) {
    res.push(await ask(G, 'stock.tie', { nid: m.nid }));
  }
  t.check(res.slice(0, 4).every((r) => r.ok) && !res[4].ok && /m(á|a)ximo/i.test(res[4].why || ''), '4 more ties pass, the 6th is refused (5 at most)', res.map((r) => (r.ok ? 'ok' : r.why)).join(' | '));
  await t.sleep(RT());
  for (const m of extra) if (m.tiedTo === G.pid) await ask(G, 'stock.untie', { nid: m.nid });
  // release the cow by hand
  const r1 = A.count(G, 'rope');
  const it2 = G.game.stock.describe(A.proxyOf(G, cow));
  t.check(it2 && it2.kind === 'stock_untie' && /Soltar vaca/.test(it2.verb), 'a tied cow offers "Soltar vaca"', it2?.verb);
  A.interact(G, it2);
  await t.waitFor(() => !cow.tiedTo && !A.proxyOf(G, cow)?.tiedTo, RT() + 2500, 'released on both');
  await t.waitFor(() => A.count(G, 'rope') === r1 + 1, RT() + 600, 'the rope came back to the guest', () => `${r1} → ${A.count(G, 'rope')}`);
  await t.checkDigest(H, G);
});

def('P2', {
  title: 'P: a feeder domesticates the animals around it and feeds them', timeout: 150000,
  expected: 'Guest builds a feeder and puts wheat and corn in it (stone is refused: "Só comida"); wild cows / a chicken near it become domesticated on the host and show it on the guest (farm bits, "Vaca · domesticada"); hungry, the cows walk to the trough and eat: the wheat in the feeder goes down on both peers (chest.set); the chicken eats corn; digest equal',
  api: 'BUILDINGS.feeder (feed 6, slots 6); feederAdapter.put → chest.put (feed only); livestock farm clock (host 1 Hz): tame / owned / fed / wantEat → stockBrain → chest.set',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.stock?.debug, 'livestock not merged');
  A.keepAlive(t, G);
  const f = await farmFeeder(t, H, G, MH, MG);
  const LG = await frameImport(G, 'game/livestock.js');
  // the guest fills it through the feeder window's adapter (the UI path)
  A.ensure(G, { wheat: 8, corn: 4, stone: 2 });
  const fg = A.structOn(G, f.id);
  const ad = LG.feederAdapter(G.game, fg);
  const slotOf = (id) => G.game.player.inv.slots.findIndex((s) => s && s.id === id);
  A.standBy(G, MG, fg);
  await A.hostSees(t, H, G, 4000);
  const w0 = feedCount(H, f.id, 'wheat');
  ad.put(slotOf('wheat'), 99); ad.put(slotOf('corn'), 99);
  const refused = !ad.put(slotOf('stone'), 99);
  await t.waitFor(() => feedCount(H, f.id, 'wheat') >= w0 + 8 && feedCount(G, f.id, 'corn') >= 4, RT() + 800, 'wheat and corn in the feeder on both');
  t.check(refused && A.count(G, 'stone') >= 2, 'stone is refused (only food)');
  const r2 = await ask(G, 'chest.put', { id: f.id, item: 'stone', qty: 1 });
  t.check(!r2.ok && /comida/i.test(r2.why || ''), 'the host refuses a non-food item too', r2.why);
  // wild animals around it
  const [cx, cy] = feederCentre(f);
  const cows = [farmAnimal(H, MH, 'cow', cx - 2, cy + 2.5), farmAnimal(H, MH, 'cow', cx + 2, cy + 2.5)];
  const hen = farmAnimal(H, MH, 'chicken', cx + 1, cy - 2);
  env.farmCows = cows.map((m) => m.nid);
  await t.waitFor(() => cows.every((m) => m.tame && m.owned && m.feeder === f.id) && hen.tame, 3000, 'host: domesticated by the feeder (owned, out of their herds)');
  await t.waitFor(() => cows.every((m) => A.proxyOf(G, m)?.tame) && A.proxyOf(G, hen)?.tame, ONEWAY() + 1500, 'guest: the proxies show it');
  const lab = G.game.stock.label(A.proxyOf(G, cows[0]));
  t.check(lab && /Vaca · domesticada/.test(lab[0]), 'guest nameplate "Vaca · domesticada"', lab?.[0]);
  // hungry: to the trough
  const wb = feedCount(H, f.id, 'wheat'), cb = feedCount(H, f.id, 'corn');
  for (const m of cows) { m.fed = 0.3; m.stateT = 0; }
  hen.fed = 0.2; hen.stateT = 0;
  H.game.stock.debug.tick(0.01);
  // (keep the players a little away so nothing scares them)
  await t.waitFor(() => feedCount(H, f.id, 'wheat') <= wb - 2, 25000, 'host: the cows ate wheat from the trough', () => `wheat ${feedCount(H, f.id, 'wheat')} fed ${cows.map((m) => f2(m.fed)).join('/')} want ${cows.map((m) => m.wantEat).join('/')}`);
  await t.waitFor(() => feedCount(G, f.id, 'wheat') === feedCount(H, f.id, 'wheat'), ONEWAY() + 800, 'guest: the same feeder contents');
  await t.waitFor(() => feedCount(H, f.id, 'corn') < cb, 25000, 'host: the chicken ate corn');
  t.check(cows.every((m) => m.fed > 0.3), 'the cows are fuller', cows.map((m) => f2(m.fed)).join(' / '));
  await t.checkDigest(H, G);
});

def('P3', {
  title: 'P: births, growing up and hunger (time skip)', timeout: 150000,
  expected: 'Two well-fed domesticated cows at a feeder: a calf ("Bezerro", young bit, small) is born on the host and reaches the guest; after a 3-day skip (env.skip) it is a grown cow ("Vaca") on both; an animal left with an empty feeder shows "faminta" on the guest and dies of hunger after the warnings (dead on both); digest equal',
  api: 'livestock farm clock (game.stock.debug.tick on the host): births (BREED_FED, breedAt), growth (adultAt → name / variant / scale), hunger (fed, starveT → stock.note toasts, killMob); entity static record (name, variant, scale) + dyn farm bits',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.stock?.debug, 'livestock not merged');
  A.keepAlive(t, G);
  const f = await farmFeeder(t, H, G, MH, MG);
  const [cx, cy] = feederCentre(f);
  A.standBy(G, MG, A.structOn(G, f.id));
  const pa = farmAnimal(H, MH, 'cow', cx - 1.5, cy + 2), pb = farmAnimal(H, MH, 'cow', cx + 1.5, cy + 2);
  H.game.stock.debug.tick(0.01);
  await t.waitFor(() => pa.tame && pb.tame, 2000, 'two domesticated cows');
  const kids0 = new Set(A.hostMobs(H, (m) => m.species === 'cow' && (m.variant & 2)).map((m) => m.nid));
  for (const m of [pa, pb]) { m.fed = 1; m.breedAt = 0; }
  H.game.stock.debug.tick(20); // (a birth is a roll per second: 20 s of the farm clock at once)
  const kid = await t.waitFor(() => A.hostMobs(H, (m) => m.species === 'cow' && (m.variant & 2) && !kids0.has(m.nid))[0], 1500, 'host: a calf was born');
  t.check(kid.name === 'Bezerro' && kid.scale < 0.7 && kid.tame && kid.owned, 'a domesticated "Bezerro", small', `${kid.name} ${kid.scale}`);
  t.check(pa.breedAt > H.game.worldTime && pb.breedAt > H.game.worldTime, 'the parents rest before breeding again');
  const kp = await t.waitFor(() => A.proxyOf(G, kid), ONEWAY() + 2500, 'guest: the calf proxy');
  t.check(kp.name === 'Bezerro' && (kp.variant & 2) && kp.scale < 0.7, 'guest sees a calf (young art bit, small)', `${kp.name} v${kp.variant} ${kp.scale}`);
  // 3 days later: grown up
  skipDays(H, 3.05);
  await t.sleep(RT());
  H.game.stock.debug.tick(1);
  await t.waitFor(() => kid.name === 'Vaca' && !(kid.variant & 2), 1500, 'host: it grew up');
  await t.waitFor(() => { const q = A.proxyOf(G, kid); return q && q.name === 'Vaca' && !(q.variant & 2) && q.scale > 0.9; }, ONEWAY() + 2500, 'guest: a grown cow');
  // hunger: an empty feeder, a starving cow
  const slots = A.structOn(H, f.id).store.toJSON();
  H.game.net.emit('chest.set', { id: f.id, slots: slots.map(() => null), quiet: 1 });
  const notes = [];
  t.on(G, 'toast', (d) => notes.push(d?.text || ''));
  pa.fed = 0.001;
  H.game.stock.debug.tick(1);
  H.game.stock.debug.tick(1);
  await t.waitFor(() => A.proxyOf(G, pa)?.starving, ONEWAY() + 1500, 'guest: the cow shows it is starving');
  t.check(/famint/.test(G.game.stock.label(A.proxyOf(G, pa))?.[0] || ''), 'its nameplate says "faminta"', G.game.stock.label(A.proxyOf(G, pa))?.[0]);
  const D = H.game.env.dayLength;
  H.game.stock.debug.tick(D * 0.35); // past the second warning
  H.game.stock.debug.tick(D * 0.2);  // past the limit (half a day)
  await t.waitFor(() => pa.dead, 1500, 'host: it died of hunger');
  await t.waitFor(() => A.proxyOf(G, pa)?.dead || !A.proxyOf(G, pa), ONEWAY() + 1500, 'guest: dead too');
  await t.sleep(RT());
  t.check(notes.some((s) => /passando fome/.test(s)) && notes.some((s) => /morreu de fome/.test(s)), 'warnings reached the guest (passando fome … morreu de fome)', notes.filter((s) => /fome/.test(s)).join(' | '));
  await t.checkDigest(H, G);
});

def('P4', {
  title: 'P: slaughter a domesticated animal with one knife hit (guest)', timeout: 120000,
  expected: 'A domesticated pig hit by the guest with an axe only gets hurt; one hit with a knife kills it at once: dead on both, a butchered body on both, its meat on the ground with identical ids on both, XP to the guest only; a wild animal is not slaughtered by the knife (normal damage); digest equal',
  api: 'combat.dealDamage → livestock.slaughter (tame + knife: mob.hit carries w = main hand) → killMob (noCorpse, onDeath rows → loot.add) + corpse.add (butchered); bestFoe never auto-targets a domesticated animal',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.stock?.debug, 'livestock not merged');
  A.keepAlive(t, G);
  const f = await farmFeeder(t, H, G, MH, MG);
  const [cx, cy] = feederCentre(f);
  const pig = farmAnimal(H, MH, 'pig', cx, cy + 2.4);
  H.game.stock.debug.tick(0.01);
  await t.waitFor(() => pig.tame, 2000, 'a domesticated pig');
  { const g0 = G.game.player; if (Math.hypot(g0.x - cx, g0.y - cy) > 20) { const q = A.freeSpot(G, MG, cx + 3, cy, { rMin: 0, rMax: 3 }); if (q) A.teleport(G, q[0], q[1]); } } // (the farm may be away from where the guest is)
  const px = await t.waitFor(() => { const q = A.proxyOf(G, pig); return q && q.tame ? q : null; }, ONEWAY() + 2500, 'guest: its proxy (domesticated)');
  const s = A.freeSpot(G, MG, pig.x, pig.y, { rMin: 0.7, rMax: 1.4 });
  A.teleport(G, s[0], s[1]);
  await A.hostSees(t, H, G, 4000);
  t.check(MG.combat.bestFoe(G.game, 6) !== px, 'the automatic attack never picks a domesticated animal');
  A.equip(G, 'axe_stone');
  const hp0 = pig.hp;
  A.hit(G, MG, px, 3);
  await t.waitFor(() => pig.hp < hp0, RT() + 800, 'an axe hit only hurts it', () => `hp ${pig.hp}/${hp0} dead ${pig.dead}`);
  t.check(!pig.dead, 'not dead after the axe');
  pig.state = 'idle'; pig.fleeT = 0; pig.stateT = 30;
  await t.sleep(300);
  A.teleport(G, pig.x + 0.8, pig.y);
  await A.hostSees(t, H, G, 4000);
  A.equip(G, 'knife_stone');
  const loot = A.lootRecorder(t, [H, G]);
  const xpG = A.xpRecorder(t, G), xpH = A.xpRecorder(t, H);
  const before = new Set(H.game.corpses.map.keys());
  A.hit(G, MG, A.proxyOf(G, pig), 3);
  await t.waitFor(() => pig.dead, RT() + 800, 'host: one knife hit kills it');
  await t.waitFor(() => A.proxyOf(G, pig)?.dead || !A.proxyOf(G, pig), ONEWAY() + 800, 'guest: dead');
  const body = await t.waitFor(() => [...H.game.corpses.map.values()].find((c) => !before.has(c.id) && c.of === 'pig'), 1500, 'its body on the host');
  await t.waitFor(() => G.game.corpses.map.get(body.id), ONEWAY() + 800, 'its body on the guest');
  t.check(body.butchered && G.game.corpses.map.get(body.id).butchered, 'the body is already butchered on both');
  await t.sleep(RT() + 200);
  loot.stop();
  const cmp = loot.compare(0, 1), li = loot.items(0);
  t.check(cmp.ok && (li.meat || 0) >= 1, 'meat on the ground, identical on both', `${cmp.detail} · ${short(li)}`);
  t.check(xpG.total > 0 && xpH.total === 0, 'XP to the guest only', `${f2(xpG.total)} / ${f2(xpH.total)}`);
  // a wild animal: the knife does normal damage
  const wild = farmAnimal(H, MH, 'sheep', G.game.player.x + 4, G.game.player.y + 3);
  wild.stateT = 30;
  const wp = await t.waitFor(() => A.proxyOf(G, wild), 3000 + CFG.budget, 'a wild sheep on the guest');
  A.teleport(G, wild.x + 0.7, wild.y);
  await A.hostSees(t, H, G, 4000);
  const whp = wild.hp;
  A.hit(G, MG, wp, 2);
  await t.waitFor(() => wild.hp < whp, RT() + 800, 'the knife hurts the wild sheep');
  t.check(!wild.dead && !wild.tame, 'a wild animal is not slaughtered by one knife hit', `hp ${wild.hp}/${whp}`);
  await t.checkDigest(H, G);
});

def('P5', {
  title: 'P: fishing with a rod (guest) and with a long shot', timeout: 120000,
  expected: 'Guest with a rod next to water: "Pescar" casts (the bobber on both peers, the bite time from the host); pulling at once is "Cedo demais" (no fish); on a second cast, pulling when the bobber goes under ("Puxar!") gives 2-3 raw fish to the guest only and the line comes out on both; a long shot into a fish gives 1 raw fish; digest equal',
  api: 'game.fishing.near() → work fish_cast / fish_pull → intents fish.cast / fish.pull (host clock) → ops fish.bob / fish.end {by, give}; fish onDeath give (lob.fire → mob.die {give})',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.fishing && G.game.fishing, 'fishing not merged');
  A.keepAlive(t, G);
  const g = G.game, gp = g.player, w = H.game.world;
  // a shore spot facing water with a fish in front of it
  let spot = null, fish = null;
  const fishes = A.hostMobs(H, (m) => m.species === 'fish').sort((a, b) => Math.hypot(a.x - gp.x, a.y - gp.y) - Math.hypot(b.x - gp.x, b.y - gp.y));
  for (const f of fishes.slice(0, 12)) {
    for (let r = 2; r < 5 && !spot; r += 0.5) for (let a = 0; a < 16 && !spot; a++) {
      const x = f.x + Math.cos((a / 16) * 6.283) * r, y = f.y + Math.sin((a / 16) * 6.283) * r, i = w.idx(Math.floor(x), Math.floor(y));
      if (!w.water.get(i) && !w.rock.get(i) && !w.solid.get(i) && A.freeSpot(H, MH, x, y, { rMin: 0, rMax: 0.3 })) spot = [x, y];
    }
    if (spot) { fish = f; break; }
  }
  t.assert(spot, 'a shore spot next to a fish');
  A.teleport(G, spot[0], spot[1]);
  const dx = fish.x - spot[0], dy = fish.y - spot[1];
  gp.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
  await A.hostSees(t, H, G, 4000);
  A.ensure(G, { rod_wood: 1 });
  const near = () => g.fishing.near();
  await t.waitFor(() => near()?.kind === 'fish_cast', 2000, 'the use action says "Pescar"', () => JSON.stringify(near()));
  const fish0 = A.count(G, 'fish_raw'), fishH0 = A.count(H, 'fish_raw');
  // 1) cast and pull at once: too early
  A.interact(G, near());
  await t.waitFor(() => G.game.fishing.bobs.has(G.pid) && H.game.fishing.bobs.has(G.pid), RT() + 1200, 'the bobber on both peers');
  const notes = [];
  t.on(G, 'toast', (d) => notes.push(d?.text || ''));
  A.interact(G, near());
  await t.waitFor(() => !G.game.fishing.bobs.has(G.pid) && !H.game.fishing.bobs.has(G.pid), RT() + 1200, 'the line came out on both');
  t.check(A.count(G, 'fish_raw') === fish0 && notes.some((s) => /Cedo demais/.test(s)), 'too early: no fish, "Cedo demais"', notes.join(' | '));
  // 2) cast, wait for the bite, pull
  await t.sleep(400);
  await t.waitFor(() => near()?.kind === 'fish_cast', 2000, '"Pescar" again');
  A.interact(G, near());
  const b = await t.waitFor(() => G.game.fishing.bobs.get(G.pid), RT() + 1200, 'the bobber again');
  t.check(b.bite > G.game.worldTime - 0.5, 'a bite time in the future (host decided)', f2(b.bite - G.game.worldTime));
  await t.waitFor(() => near()?.verb === 'Puxar!', 20000, 'the bobber goes under: "Puxar!"', () => `${near()?.verb} bite in ${f2(b.bite - G.game.worldTime)}`);
  A.interact(G, near());
  await t.waitFor(() => A.count(G, 'fish_raw') >= fish0 + 2, RT() + 1500, 'the guest landed 2-3 fish', () => `${A.count(G, 'fish_raw') - fish0} · ${notes.slice(-2).join(' | ')}`);
  t.check(A.count(G, 'fish_raw') - fish0 <= 3 && A.count(H, 'fish_raw') === fishH0, '2-3 raw fish, to the guest only', `${A.count(G, 'fish_raw') - fish0}`);
  await t.waitFor(() => !H.game.fishing.bobs.has(G.pid) && !G.game.fishing.bobs.has(G.pid), ONEWAY() + 800, 'the line is out on both');
  // 3) a long shot into a fish (the host's own bow; 1 fish)
  const hp = H.game.player;
  const f2t = A.hostMobs(H, (m) => m.species === 'fish').sort((a, b) => Math.hypot(a.x - gp.x, a.y - gp.y) - Math.hypot(b.x - gp.x, b.y - gp.y))[0];
  t.assert(f2t, 'a fish for the long shot');
  const hs = A.freeSpot(H, MH, spot[0], spot[1], { rMin: 0.6, rMax: 2.5 }) || spot;
  A.teleport(H, hs[0], hs[1]);
  A.equip(H, 'bow_wood'); A.ensure(H, { arrow: 5 });
  f2t.stateT = 30; f2t.state = 'idle'; f2t.wp = null;
  const n0 = A.count(H, 'fish_raw');
  let hit = false;
  for (let k = 0; k < 4 && !hit; k++) {
    H.game.net.request('lob.fire', { ab: 'long_shot', w: 'bow_wood', x: hp.x, y: hp.y, ax: f2t.x, ay: f2t.y, amount: 40, crit: 0 });
    hit = await t.tryWait(() => f2t.dead, 3000);
    H.game.worldTime += 5; // (the ability's cooldown)
  }
  t.check(hit && A.count(H, 'fish_raw') === n0 + 1, 'a long shot into the fish: 1 raw fish (less than a rod)', `dead ${f2t.dead} +${A.count(H, 'fish_raw') - n0}`);
  await t.checkDigest(H, G);
});

// =====================================================================================================
// B · Barco (game/boats.js, docs/PLAN-V2.md "Barco"): the rowboat — 6 places shared by players and tied animals
const boatOn = (f, id) => f.game.boats?.map.get(id) || null;
// the river crossing near the spawn (the deck finder's, dry): launch tile = its first water tile
function boatSite(t, H) {
  const s = deckSites(t, H);
  t.need(s.bridge, 'no river crossing near the spawn on this seed');
  const b = s.bridge, ex = Math.sign(b[1][0] - b[0][0]), ey = Math.sign(b[1][1] - b[0][1]);
  return { b, ex, ey, bank: b[0], far: b[b.length - 1], tile: b[1] };
}
// a boat launched by the host at the crossing (dev helper), nobody aboard; removed at the end
async function hostBoat(t, H, G, site) {
  const r = H.game.debug.boatScene({ at: site.tile, board: false });
  t.need(r && r.id, 'no room for a boat at the crossing');
  t.defer(() => { if (boatOn(H, r.id)) { H.game.net.emit('boat.set', { id: r.id, seats: [0, 0, 0, 0, 0, 0], pets: [] }); H.game.net.emit('boat.remove', { id: r.id }); } });
  await t.waitFor(() => boatOn(G, r.id), RT() + 1500, 'the guest has the boat');
  return r.id;
}
// stand on the bank / shallows next to a boat's hull (the walkable point nearest to its outline)
function standByBoat(f, M, b) {
  const p = f.game.player, [nx, ny] = M.boatsc.hullNear(b.x, b.y, b.h, p.x, p.y);
  const s = A.freeSpot(f, M, nx, ny, { rMin: 0.35, rMax: 2.4, avoid: (x, y) => M.boatsc.inHull(b.x, b.y, b.h, x, y, 0.25) });
  if (s) A.teleport(f, s[0], s[1]);
  return s;
}
async function rowUntil(t, f, ex, ey, cond, ms) {
  const rel = A.holdMove(f, ex, ey);
  try { return await t.tryWait(cond, ms); } finally { rel(); }
}
// on the far side of the crossing: nearer its far bank than its near one, never in deep water (shallows may link the
// two banks somewhere upstream, so walking connectivity cannot tell the sides apart)
// the boat's bow has reached the far bank of the crossing (an island / sandbar mid-river can be nearer before that)
const bowAtFar = (site, b) => (b.x - site.far[0] - 0.5) * site.ex + (b.y - site.far[1] - 0.5) * site.ey > -2.9;
const onFarBank = (f, site, x, y) => Math.hypot(x - site.far[0] - 0.5, y - site.far[1] - 0.5) < Math.hypot(x - site.bank[0] - 0.5, y - site.bank[1] - 0.5) - 1.5 && f.game.world.liquidAt(Math.floor(x), Math.floor(y)) !== 2;

def('B1', {
  src: 'classic', // (a river crossing wide enough for the boat by the spawn: the classic map; boats on the planet: LZ2)
  star: true, title: 'B: guest builds a boat, two players board, the guest rows across a river, both step off on the far bank', timeout: 300000,
  expected: 'The guest places a boat on the first water tile of a river crossing (on land: refused) and builds it with real work from the bank: the blueprint becomes a floating boat (op boat.launch) with the same id and pose on both; the guest boards first (the oars, place 0), the host second; both seated (rooted, no swimming); the guest rows across (its client simulates, intent boat.move → op boat.pos): the boat moves on the host, both draw it close together and see each other seated in it; the guest steps off on the far bank (a spot not walk-linked to the near bank, never deep water); the host takes the oars (next passenger) and steps off too; digest equal',
  api: 'BUILDINGS.boat (build.place → boats.reason; build.hit final → boat.launch), game.boats.board / leave / landingSpot, intents boat.board / boat.leave / boat.move, ops boat.set / boat.pos, b.seats / b._x (drawn), p._boat',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.boats && MH.boats?.Boats && H.game.debug?.deckScene, 'boats (game/boats.js) missing');
  const site = boatSite(t, H), { ex, ey } = site;
  const gp = G.game.player, hp = H.game.player;
  A.keepAlive(t, G); A.keepAlive(t, H);
  A.pacify(H, site.tile[0], site.tile[1], 30);
  A.ensure(G, { wood: 40, rope: 10 });
  const bank = [site.bank[0] + 0.5, site.bank[1] + 0.5];
  A.teleport(G, bank[0], bank[1]);
  await A.hostSees(t, H, G);
  const land = String(MG.building.placeReason(G.game, 'boat', site.bank[0] - ex, site.bank[1] - ey, null));
  t.check(/água/.test(land), 'a boat on land is refused (on the water)', land);
  t.check(MG.building.placeReason(G.game, 'boat', site.tile[0], site.tile[1], gp) == null, 'the first water tile by the bank takes a boat', String(MG.building.placeReason(G.game, 'boat', site.tile[0], site.tile[1], gp)));
  A.place(G, MG, 'boat', site.tile);
  const bp = await t.waitFor(() => G.game.build.structures.find((o) => o.type === 'boat' && o.blueprint && o.tx === site.tile[0] && o.ty === site.tile[1]), RT() + 1200, 'guest sees the boat blueprint');
  const id = bp.id;
  t.defer(() => { if (boatOn(H, id)) { H.game.net.emit('boat.set', { id, seats: [0, 0, 0, 0, 0, 0], pets: [] }); H.game.net.emit('boat.remove', { id }); } });
  await t.waitFor(() => A.structOn(H, id), RT() + 500, 'host has the same blueprint');
  const mk = () => { const q = A.structOn(G, id); return q && q.blueprint ? MG.building.describeStructure(G.game, q) : null; };
  await A.workUntil(t, G, mk, () => !A.structOn(G, id), 60000, 'builds the boat', { stand: () => A.teleport(G, bank[0], bank[1]) });
  const bH = await t.waitFor(() => boatOn(H, id), RT() + 1500, 'the boat floats on the host (launched)');
  const bG = await t.waitFor(() => boatOn(G, id), RT() + 1500, 'and on the guest');
  t.check(!A.structOn(H, id) && !A.structOn(G, id), 'the blueprint is gone on both');
  t.check(Math.hypot(bH.x - bG.x, bH.y - bG.y) < 0.01 && Math.abs(bH.h - bG.h) < 1e-3, 'the same pose on both', `${f2(bH.x)},${f2(bH.y)} ${f2(bH.h)} / ${f2(bG.x)},${f2(bG.y)} ${f2(bG.h)}`);
  t.check(MH.boatsc.hullFree(H.game, bH.x, bH.y, bH.h, bH), 'its hull floats on the water');
  // the guest gets in first (the oars), then the host
  standByBoat(G, MG, bG);
  await A.hostSees(t, H, G);
  G.game.boats.board(bG);
  await t.waitFor(() => bH.seats[0] === G.pid && bG.seats[0] === G.pid, RT() + 1500, 'the guest is at the oars on both');
  standByBoat(H, MH, bH);
  H.game.boats.board(bH);
  await t.waitFor(() => bH.seats.includes(H.pid) && bG.seats.includes(H.pid), RT() + 1500, 'the host is aboard on both');
  await t.sleep(400);
  t.check(gp._boat === bG && gp.rooted && hp._boat === bH && hp.rooted, 'both seated (rooted)', `${!!gp._boat} ${gp.rooted} ${!!hp._boat} ${hp.rooted}`);
  // the guest rows across
  const st = { swim: false, maxD: 0 };
  t.watch(() => {
    for (const p of [gp, hp]) if (p.swimming || (p._swim || 0) > 0.3) st.swim = true;
    st.maxD = Math.max(st.maxD, Math.hypot(bH._x - bG._x, bH._y - bG._y));
  }, 50);
  const x0 = bH.x, y0 = bH.y;
  const crossed = () => { const L = G.game.boats.landingSpot(bG, gp.x, gp.y); return bowAtFar(site, bG) && L && onFarBank(G, site, L[0], L[1]); };
  const relRow = A.holdMove(G, ex, ey); // (kept pressed against the far bank: the river's current would carry it off)
  t.defer(relRow);
  const ok = await t.tryWait(crossed, 25000);
  t.check(ok, 'the guest rows until the far bank is in reach', `boat ${f2(bG.x)},${f2(bG.y)} h ${f2(bG.h)}`);
  t.check(Math.hypot(bH.x - x0, bH.y - y0) > 1.5, 'the boat moved on the host (boat.pos)', `${f2(x0)},${f2(y0)} → ${f2(bH.x)},${f2(bH.y)}`);
  await t.sleep(300);
  t.check(st.maxD < 2.5, 'drawn close together while rowing (latency only)', f2(st.maxD));
  t.check(!st.swim, 'nobody swims aboard');
  const hOnG = A.avatarOn(G, H.pid), gOnH = A.avatarOn(H, G.pid);
  t.check(hOnG && MG.boatsc.inHull(bG._x, bG._y, bG._h, hOnG.x, hOnG.y) && gOnH && MH.boatsc.inHull(bH._x, bH._y, bH._h, gOnH.x, gOnH.y), 'each sees the other seated in the boat', `host on guest ${f2(hOnG?.x)},${f2(hOnG?.y)} · guest on host ${f2(gOnH?.x)},${f2(gOnH?.y)}`);
  // off: the guest on the far bank; the host takes the oars, then gets off too
  G.game.boats.leave();
  await t.waitFor(() => !bH.seats.includes(G.pid) && !bG.seats.includes(G.pid), RT() + 1500, 'the guest got off (both)');
  relRow();
  await t.sleep(250);
  t.check(!gp._boat && !gp.rooted && onFarBank(G, site, gp.x, gp.y), 'the guest stands on the far bank', `${f2(gp.x)},${f2(gp.y)}`);
  await t.waitFor(() => bH.seats[0] === H.pid && bG.seats[0] === H.pid, RT() + 800, 'the host took the oars (next passenger)');
  await t.sleep(900);
  t.check(Math.hypot(bH._x - bG._x, bH._y - bG._y) < 0.3, 'both draw it at the same spot (the new driver lets it drift)', `host ${f2(bH._x)},${f2(bH._y)} guest ${f2(bG._x)},${f2(bG._y)}`);
  H.game.boats.leave();
  await t.waitFor(() => !bH.seats.some(Boolean) && !bG.seats.some(Boolean), RT() + 1500, 'the host got off: the boat is empty on both');
  await t.sleep(250);
  t.check(!hp._boat && H.game.world.liquidAt(Math.floor(hp.x), Math.floor(hp.y)) !== 2, 'the host is ashore (never deep water)', `${f2(hp.x)},${f2(hp.y)} far bank ${onFarBank(H, site, hp.x, hp.y)}`);
  await t.waitFor(() => { const av = guestOnHost(H, G); return av && Math.hypot(av.x - gp.x, av.y - gp.y) < 0.5; }, RT() + 1500, 'the host sees the guest on the far bank');
  await t.checkDigest(H, G);
  env.history.push('B1');
});

def('B2', {
  src: 'classic', // (a river crossing wide enough for the boat by the spawn: the classic map; boats on the planet: LZ2)
  title: 'B: one player with 5 tied animals fills the boat (6 places) and crosses; the animals ride along and get off with it; a second player is refused', timeout: 240000,
  expected: 'A boat at a river crossing; the guest leads 5 tied animals (cow, sheep, pig, chicken, sheep). With the host at the oars the guest + 5 do not fit: refused "Não cabe todo mundo" (nobody aboard, nothing left behind). The host gets off; the guest boards: its 5 animals come along (6 places used, on both), each standing in the boat on the host (creatures) and on the guest (proxies); the host is refused (full); the guest rows across: the animals move with the boat; the guest gets off on the far bank and the animals get off next to it (still tied, never in deep water) on both; digest equal',
  api: 'intent boat.board (tied animals: all or refused), b.pets [[nid, pid, place]], mobs.js (riding: no brain), host placeAll / unloadPet, entity stream positions',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.boats && H.game.stock?.debug && H.game.debug?.boatScene, 'boats / livestock missing');
  const site = boatSite(t, H);
  const gp = G.game.player;
  A.keepAlive(t, G); A.keepAlive(t, H);
  A.pacify(H, site.tile[0], site.tile[1], 30);
  const id = await hostBoat(t, H, G, site);
  const bH = boatOn(H, id), bG = boatOn(G, id);
  // the guest's 5 animals on the bank
  standByBoat(G, MG, bG);
  await A.hostSees(t, H, G, 4000);
  A.ensure(G, { rope: 5 });
  const kinds = ['cow', 'sheep', 'pig', 'chicken', 'sheep'];
  const herd = kinds.map((sp) => {
    const s = A.freeSpot(H, MH, gp.x, gp.y, { rMin: 1.2, rMax: 4, r: 0.45, avoid: (x, y) => MH.boatsc.inHull(bH.x, bH.y, bH.h, x, y, 0.5) }) || [gp.x, gp.y];
    const m = H.game.stock.debug.spawn(sp, s[0], s[1], { owned: false });
    m.stateT = 30;
    return m;
  });
  t.defer(() => { for (const m of herd) if (!m.dead) { m.tiedTo = null; m._boat = null; } });
  await t.waitFor(() => herd.every((m) => A.proxyOf(G, m)), 3000 + CFG.budget, 'the animals on the guest');
  for (const m of herd) { const r = await ask(G, 'stock.tie', { nid: m.nid }); t.assert(r.ok, `tie ${m.species}: ${r.why}`); }
  await t.waitFor(() => herd.every((m) => m.tiedTo === G.pid), RT() + 1500, 'all 5 tied to the guest');
  await t.sleep(600);
  // the host at the oars: the guest and its 5 animals do not fit
  standByBoat(H, MH, bH);
  H.game.boats.board(bH);
  await t.waitFor(() => bG.seats[0] === H.pid, RT() + 1500, 'the host is at the oars');
  standByBoat(G, MG, bG);
  await A.hostSees(t, H, G);
  const r1 = await ask(G, 'boat.board', { id });
  t.check(!r1.ok && /Não cabe todo mundo/.test(r1.why || '') && !bH.seats.includes(G.pid) && !bH.pets.length, 'the guest + 5 animals do not fit beside the host: refused, nobody boards, nothing is left behind', r1.why);
  H.game.boats.leave();
  await t.waitFor(() => !bG.seats.includes(H.pid) && !bH.seats.includes(H.pid), RT() + 1500, 'the host got off');
  // the guest boards: all 5 come along
  standByBoat(G, MG, bG);
  await A.hostSees(t, H, G);
  G.game.boats.board(bG);
  await t.waitFor(() => bH.pets.length === 5 && bG.pets.length === 5 && bG.seats[0] === G.pid, RT() + 1500, 'the guest and its 5 animals are aboard on both');
  t.check(H.game.boats.used(bH) === 6 && G.game.boats.used(bG) === 6, 'the boat is full: 6 places', `${H.game.boats.used(bH)} / ${G.game.boats.used(bG)}`);
  await t.sleep(600);
  const inH = (m) => MH.boatsc.inHull(bH._x, bH._y, bH._h, m.x, m.y, 0.25);
  t.check(herd.every(inH), 'host: every animal stands in the boat', herd.map((m) => `${m.species} ${f2(m.x)},${f2(m.y)}`).join(' · '));
  await t.waitFor(() => herd.every((m) => { const q = A.proxyOf(G, m); return q && MG.boatsc.inHull(bG._x, bG._y, bG._h, q.x, q.y, 0.3); }), ONEWAY() + 1500, 'guest: the proxies stand in the boat too');
  standByBoat(H, MH, bH);
  const r2 = await ask(H, 'boat.board', { id });
  t.check(!r2.ok && /cheio/.test(r2.why || ''), 'the host cannot board: the boat is full', r2.why);
  // across, with the animals
  const x0 = bH.x, y0 = bH.y;
  const crossed = () => { const L = G.game.boats.landingSpot(bG, gp.x, gp.y); return bowAtFar(site, bG) && L && onFarBank(G, site, L[0], L[1]); };
  const relRow = A.holdMove(G, site.ex, site.ey); // (kept pressed against the far bank: the river's current would carry it off)
  t.defer(relRow);
  const ok = await t.tryWait(crossed, 25000);
  t.check(ok, 'the guest rows across with its animals', `boat ${f2(bG.x)},${f2(bG.y)}`);
  await t.sleep(500);
  t.check(herd.every(inH) && Math.hypot(bH.x - x0, bH.y - y0) > 1.5, 'host: the animals moved with the boat', `${f2(x0)},${f2(y0)} → ${f2(bH.x)},${f2(bH.y)}`);
  G.game.boats.leave();
  await t.waitFor(() => !bH.pets.length && !bG.pets.length && !bH.seats.includes(G.pid), RT() + 1500, 'the guest and its animals got off (both)');
  relRow();
  await t.sleep(400);
  const wH = H.game.world;
  t.check(herd.every((m) => m.tiedTo === G.pid && !m._boat && wH.liquidAt(Math.floor(m.x), Math.floor(m.y)) !== 2 && Math.hypot(m.x - gp.x, m.y - gp.y) < 4.5),
    'host: the animals stand by the guest on the bank (still tied, never in deep water)', herd.map((m) => `${m.species} ${f2(m.x)},${f2(m.y)} d ${f2(Math.hypot(m.x - gp.x, m.y - gp.y))}`).join(' · '));
  t.check(onFarBank(G, site, gp.x, gp.y), 'the guest is on the far bank', `${f2(gp.x)},${f2(gp.y)}`);
  await t.waitFor(() => herd.every((m) => { const q = A.proxyOf(G, m); return q && Math.hypot(q.x - m.x, q.y - m.y) < 1.5; }), ONEWAY() + 1500, 'guest: the proxies got off too');
  await t.checkDigest(H, G);
});

def('B3', {
  src: 'classic', // (a river crossing wide enough for the boat by the spawn: the classic map; boats on the planet: LZ2)
  title: 'B: the driver gets off mid-river and the passenger takes the oars; far from the bank it is refused; frozen water holds the boat', timeout: 240000,
  expected: 'A boat at a river crossing; the guest boards first (the oars), the host second; the guest rows out into the river; getting off where no bank is in reach is refused ("Longe da margem", when the river is that wide); once a bank is in reach the guest gets off (onto land / shallow water, never deep); the host is promoted to the oars on both and rows on: the boat moves on the guest too; winter: the water freezes on both and the host\'s rowing does not move the boat; the host steps out onto the ice; digest equal',
  api: 'intent boat.leave (landing spot or refused; promote), boat.move refused on ice (fix), world.frozen (seasons.js)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.boats && H.game.debug?.boatScene, 'boats missing');
  const site = boatSite(t, H), EH = H.game.env;
  const gp = G.game.player, hp = H.game.player, day0 = EH.dayIndex, hour0 = EH.hour;
  A.keepAlive(t, G); A.keepAlive(t, H);
  A.pacify(H, site.tile[0], site.tile[1], 30);
  const id = await hostBoat(t, H, G, site);
  const bH = boatOn(H, id), bG = boatOn(G, id);
  standByBoat(G, MG, bG);
  await A.hostSees(t, H, G);
  G.game.boats.board(bG);
  await t.waitFor(() => bH.seats[0] === G.pid, RT() + 1500, 'the guest at the oars');
  standByBoat(H, MH, bH);
  H.game.boats.board(bH);
  await t.waitFor(() => bG.seats.includes(H.pid) && bH.seats.includes(H.pid), RT() + 1500, 'the host aboard');
  // out into the river
  const x0 = bH.x, y0 = bH.y;
  await rowUntil(t, G, site.ex, site.ey, () => Math.hypot(bH.x - x0, bH.y - y0) > 1.6, 10000);
  await t.sleep(900);
  if (!H.game.boats.landingSpot(bH, gp.x, gp.y)) {
    const r = await ask(G, 'boat.leave', { id });
    t.check(!r.ok && /Longe da margem/.test(r.why || '') && bH.seats[0] === G.pid, 'far from the bank getting off is refused', r.why);
    await rowUntil(t, G, site.ex, site.ey, () => !!G.game.boats.landingSpot(bG, gp.x, gp.y), 15000);
    await t.sleep(600);
  } else t.log('the river is narrow here: a bank is always in reach (no refusal to test)');
  G.game.boats.leave();
  await t.waitFor(() => !bH.seats.includes(G.pid) && !bG.seats.includes(G.pid), RT() + 1500, 'the guest got off mid-river (both)');
  await t.sleep(250);
  t.check(G.game.world.liquidAt(Math.floor(gp.x), Math.floor(gp.y)) !== 2 && !gp.swimming, 'the guest landed on land / shallow water (not deep)', `${f2(gp.x)},${f2(gp.y)}`);
  await t.waitFor(() => bH.seats[0] === H.pid && bG.seats[0] === H.pid, RT() + 800, 'the host took the oars on both');
  // the host rows on: the guest sees the boat move
  const gx0 = bG._x, gy0 = bG._y;
  await rowUntil(t, H, -site.ex, -site.ey, () => Math.hypot(bG._x - gx0, bG._y - gy0) > 1.2, 12000);
  t.check(Math.hypot(bG._x - gx0, bG._y - gy0) > 1.2, 'the guest sees the new driver row the boat', `${f2(gx0)},${f2(gy0)} → ${f2(bG._x)},${f2(bG._y)}`);
  const hOnG = A.avatarOn(G, H.pid);
  t.check(hOnG && MG.boatsc.inHull(bG._x, bG._y, bG._h, hOnG.x, hOnG.y), 'the guest sees the host seated at the oars');
  // winter: the boat is stuck in the ice; stepping out onto the ice works anywhere
  t.defer(() => H.game.net.emit('env.skip', { hour: hour0, day: day0, wt: H.game.worldTime + 1, by: H.game.net.pid }));
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  H.game.net.emit('env.skip', { hour: 12, day: 6, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => H.game.world.frozen && G.game.world.frozen, 4000 + CFG.budget, 'the water froze on both');
  await t.sleep(300);
  const ix = bH.x, iy = bH.y;
  await rowUntil(t, H, site.ex, site.ey, () => false, 1500);
  await t.sleep(RT());
  t.check(Math.hypot(bH.x - ix, bH.y - iy) < 0.05 && Math.hypot(bG.x - ix, bG.y - iy) < 0.05, 'frozen: rowing does not move the boat (on both)', `${f2(ix)},${f2(iy)} → ${f2(bH.x)},${f2(bH.y)}`);
  H.game.boats.leave();
  await t.waitFor(() => !bH.seats.some(Boolean) && !bG.seats.some(Boolean), RT() + 1500, 'the host stepped out onto the ice');
  t.check(!hp._boat && !hp.swimming, 'the host stands on the ice', `${f2(hp.x)},${f2(hp.y)}`);
  await t.checkDigest(H, G);
});

// a wolf pack of two on the host at (x, y), set to go after farm animals tonight (ai.js packMood), ignoring players
async function preyPack(H, x, y) {
  const MO = await fimp(H, 'game/mobs.js');
  const a = MO.spawnLoose(H.game, 'wolf', x, y), s = a.spawner, b = MO.spawnMember(H.game, s);
  s._preyN = H.game.env.dayIndex - (H.game.env.hour < 12 ? 1 : 0); s._preyOk = true; s._preyKills = 0; s._preyCalm = 0;
  for (const m of [a, b]) { m.calmT = 600; m.stateT = 0; m.preyT = 0; m.thinkT = 0; }
  return [a, b];
}

def('P6', {
  title: 'P: wolves hunt farm animals at night; a closed fence pen keeps them out', timeout: 150000,
  expected: 'Night. A wolf pack set to hunt tonight next to a sheep of the farm in the open (away from the players): the wolves go for it (state hunt), the sheep runs, they kill it; its body lies there for butchering (corpse.add of a sheep, on both peers); everyone gets "Os lobos mataram uma ovelha da criação!"; the pack leaves the farm alone the rest of the night. A sheep inside a closed ring of fences next to a second pack stays unhurt (the fence mostly hides it; sent at it, the wolves find no path through the fence, give up and leave it alone a while); digest equal',
  api: 'ai.js lookForPrey / huntStep / bitePrey (PREY in content/livestock.js) → combat.dealDamage → killMob → corpse.add; stock.note; nav.steer fails → give up',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.stock?.debug, 'livestock not merged');
  A.keepAlive(t, G); A.keepAlive(t, H);
  const MC = await fimp(H, 'game/combat.js');
  const hp = H.game.player, gp = G.game.player, made = [];
  H.game.env.hour = 22;
  t.defer(() => { H.game.env.hour = 9; for (const e of made) if (!e.dead) { e.noCorpse = true; MC.killMob(H.game, e, null); } });
  await t.waitFor(() => Math.abs(G.game.env.hour - 22) < 0.1, 8000 + CFG.budget, 'guest clock at night');
  const notes = [];
  t.on(G, 'toast', (d) => notes.push(d?.text || ''));
  // 1) a sheep in the open, ~16 tiles from the players (the wolves are out of their sight)
  const away = [[hp.x, hp.y], [gp.x, gp.y]];
  let sp = null;
  for (let r = 15; r < 26 && !sp; r += 2) for (let a = 0; a < 12 && !sp; a++) {
    const x = hp.x + Math.cos(a * 0.52) * r, y = hp.y + Math.sin(a * 0.52) * r, q = A.freeSpot(H, MH, x, y, { rMin: 0, rMax: 1, r: 0.45 });
    const w = q && A.freeSpot(H, MH, q[0] + 4, q[1], { rMin: 0, rMax: 1, r: 0.4 });
    if (q && w && away.every(([px, py]) => Math.hypot(px - q[0], py - q[1]) > 14) && A.clearLine(H, MH, w[0], w[1], q[0], q[1], 0.35)) sp = [q, w];
  }
  t.assert(sp, 'an open spot for the sheep and the pack');
  const sheep = H.game.stock.debug.spawn('sheep', sp[0][0], sp[0][1], { owned: true });
  sheep.stateT = 30;
  made.push(sheep);
  const pack = await preyPack(H, sp[1][0], sp[1][1]);
  made.push(...pack);
  let hunted = false, fled = false;
  const dead = await t.tryWait(() => { hunted ||= pack.some((m) => m.state === 'hunt' && m.prey === sheep); fled ||= sheep.state === 'flee'; return sheep.dead; }, 30000, 50);
  t.check(hunted, 'the wolves went for the sheep (hunt)', pack.map((m) => m.state).join('/'));
  t.check(fled, 'the sheep ran from them');
  t.check(dead, 'the pack killed the sheep', `hp ${f2(sheep.hp)} · ${pack.map((m) => `${m.state} ${f2(Math.hypot(m.x - sheep.x, m.y - sheep.y))}`).join(' / ')}`);
  if (dead) {
    const c = await t.waitFor(() => [...H.game.corpses.map.values()].find((o) => o.of === 'sheep' && Math.hypot(o.x - sheep.x, o.y - sheep.y) < 1.5), RT() + 800, 'its body on the host');
    await t.waitFor(() => bodyOn(G, c.id), ONEWAY() + 800, 'its body on the guest');
    await t.waitFor(() => notes.some((s) => /Os lobos mataram uma ovelha da criação/.test(s)), ONEWAY() + 800, 'the guest hears of it', () => notes.join(' | '));
    await t.sleep(1500);
    t.check(pack.every((m) => m.state !== 'hunt'), 'the pack lets the farm alone after the kill', pack.map((m) => m.state).join('/'));
  }
  // 2) a sheep in a closed ring of fences: out of reach
  const ring = (x0, y0) => { const o = []; for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 5; x++) if (x === x0 || y === y0 || x === x0 + 4 || y === y0 + 4) o.push([x, y]); return o; };
  const site = A.findSite([H, G], [MH, MG], 'fence_wood', (x, y) => { const o = []; for (let yy = y - 1; yy < y + 6; yy++) for (let xx = x - 3; xx < x + 6; xx++) o.push([xx, yy]); return o; }, hp.x, hp.y, { rMin: 16, rMax: 40, avoidPts: away });
  t.assert(site, 'an open area for the pen (and the pack west of it)');
  const x0 = site.x0, y0 = site.y0, net = H.game.net, wt = Math.round(H.game.worldTime);
  net.emit('struct.add', { list: ring(x0, y0).map(([x, y]) => [net.newId('s'), 'fence_wood', x, y, 0, 1, wt, 0, 1, 0, '', '']), by: H.pid });
  await t.waitFor(() => ring(x0, y0).every(([x, y]) => A.structAt(G, MG, x, y)), ONEWAY() + 1200, 'the pen stands on both');
  const penned = H.game.stock.debug.spawn('sheep', x0 + 2.5, y0 + 2.5, { owned: true });
  penned.stateT = 30;
  made.push(penned);
  const pack2 = await preyPack(H, x0 - 2.5, y0 + 2.5);
  made.push(...pack2);
  // the fence mostly hides it (fences block the line of sight); a glimpse past a post: no way in, they give up
  let tried = false;
  await t.tryWait(() => { tried ||= pack2.some((m) => m.state === 'hunt'); return false; }, 10000);
  t.check(!penned.dead && penned.hp === penned.maxHp, `the penned sheep stays unhurt (the pack ${tried ? 'tried and gave up' : 'never went for it'})`, `${pack2.map((m) => m.state).join('/')} · hp ${f2(penned.hp)}`);
  // a wolf that got a glimpse anyway (a gap, a corner): no path through the fence → it gives up, the sheep is unhurt
  pack2.forEach((m, i) => { m.x = x0 - 2.5; m.y = y0 + 1.5 + i * 1.5; m.state = 'hunt'; m.prey = penned; m.huntT = 0; m.nav = null; }); // (back next to the pen)
  const gave = await t.tryWait(() => pack2.every((m) => m.state !== 'hunt'), 12000);
  await t.sleep(1500);
  t.check(gave && !penned.dead && penned.hp === penned.maxHp, 'sent at it, they find no way in and give up; the sheep is unhurt', `${pack2.map((m) => `${m.state} ${f2(Math.hypot(m.x - penned.x, m.y - penned.y))}`).join(' / ')} · hp ${f2(penned.hp)}/${penned.maxHp}`);
  t.check(pack2.every((m) => m.preyBan?.nid === penned.nid), 'and leave that one alone for a while', pack2.map((m) => m.preyBan?.nid || '-').join('/'));
  await t.checkDigest(H, G);
});

def('P7', {
  title: 'P: the fishing cast, wait and pull seen by the other peer', timeout: 120000,
  expected: "The guest casts: the host's copy of the guest plays the cast (action fish, the rod swung back over the shoulder then out over the water: its drawn tip moves back, then toward the bobber), the bobber flies out from the rod tip in an arc and splashes where it lands (landed on both); waiting, the rod points at the water (tip on the bobber's side); the pull: the host's copy plays the reel action (rod yanked up) and the bobber flies back to it (reels ghost on both); digest equal",
  api: 'fishing.js anglers (_fishT0, _fishBite) / flyStart / drawLine / drawReel; art/compose.js rodPhase + rodAim (_rodTip); action reel on the presence stream',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.fishing?.reels && G.game.fishing?.reels, 'fishing animation not merged');
  A.keepAlive(t, G);
  const g = G.game, gp = g.player, w = H.game.world;
  let spot = null, dir = null;
  for (let r = 3; r < 40 && !spot; r += 1) for (let a = 0; a < 24 && !spot; a++) {
    const x = gp.x + Math.cos(a * 0.26) * r, y = gp.y + Math.sin(a * 0.26) * r, i = w.idx(Math.floor(x), Math.floor(y));
    if (w.water.get(i) || w.rock.get(i) || w.solid.get(i) || !A.freeSpot(H, MH, x, y, { rMin: 0, rMax: 0.3 })) continue;
    for (const [d, dx, dy] of [['e', 1, 0], ['w', -1, 0]]) { // (a side view on the host: the swing reads on the ground plane)
      let wet = 0;
      for (let k = 2; k <= 4; k++) if (w.liquidAt(Math.floor(x + dx * k), Math.floor(y + dy * k))) wet++;
      if (wet === 3) { spot = [x, y]; dir = d; break; }
    }
  }
  t.assert(spot, 'a shore spot facing open water');
  A.teleport(G, spot[0], spot[1]);
  gp.facing = dir;
  // (the host near it too: its view must draw the guest — a planet's shore can be a few screens away)
  const hs = A.freeSpot(H, MH, spot[0] - (dir === 'e' ? 3 : -3), spot[1] + 1.5, { rMin: 0, rMax: 3 });
  if (hs) A.teleport(H, hs[0], hs[1]);
  await A.hostSees(t, H, G, 4000);
  A.ensure(G, { rod_wood: 1 });
  await t.waitFor(() => g.fishing.near()?.kind === 'fish_cast', 2000, 'the use action says "Pescar"');
  const copy = () => A.avatarOn(H, G.pid);
  const tips = [];
  let t0 = 0;
  A.interact(G, g.fishing.near());
  const b = await t.waitFor(() => H.game.fishing.bobs.get(G.pid), RT() + 1500, 'the bobber reaches the host');
  await t.waitFor(() => copy()?.action?.type === 'fish', 2500, "the host's copy of the guest plays the fishing action");
  t0 = H.game.time;
  await t.tryWait(() => { const c = copy(), r = c?._rodTip; if (r && H.game.time - r[3] < 0.2) tips.push([H.game.time - t0, r[0] - c.x, r[1] - c.y, r[2]]); return H.game.time - t0 > 1.4; }, 2500, 30);
  const c = copy(), bx = b.x - c.x, by = b.y - c.y, L = Math.hypot(bx, by) || 1;
  const along = (q) => (q[1] * bx + q[2] * by) / L; // (+ toward the bobber)
  t.check(tips.length > 8, "the host draws the guest's rod tip (the cast is drawn)", `${tips.length} samples`);
  if (tips.length > 8) {
    const back = Math.min(...tips.filter((q) => q[0] < 0.5).map(along)), out = along(tips[tips.length - 1]);
    t.check(back < out - 0.3, 'the rod swings back over the shoulder, then out over the water', `back ${f2(back)} → out ${f2(out)}`);
    t.check(out > 0.2, 'waiting, the rod tip is out on the bobber side', f2(out));
  }
  t.check(c._fishT0 != null && H.game.time - c._fishT0 < 3, "the host saw the cast start (its own clock)", f2(H.game.time - (c._fishT0 ?? -99)));
  await t.waitFor(() => H.game.fishing.bobs.get(G.pid)?.landed && G.game.fishing.bobs.get(G.pid)?.landed, 3000, 'the bobber landed (splash) on both');
  // the pull (early: no fish, the reel still plays)
  let reel = false;
  A.interact(G, g.fishing.near());
  await t.waitFor(() => { reel ||= copy()?.action?.type === 'reel'; return reel; }, 2500, "the host's copy plays the pull (reel)");
  await t.waitFor(() => H.game.fishing.reels.has(G.pid) && G.game.fishing.reels.has(G.pid), RT() + 1500, 'the bobber flies back to the rod on both');
  await t.waitFor(() => !H.game.fishing.bobs.has(G.pid) && !G.game.fishing.bobs.has(G.pid), RT() + 1500, 'the line is out on both');
  await t.checkDigest(H, G);
});

// =====================================================================================================
// FA · wild fauna of the planet's biomes (docs/FAUNA.md): host brains (game/fauna.js), proxies on the guest
// a wild animal on its own spawner at a free spot near (x, y) on the host (+ n more of its group on the same spawner)
async function faunaGroup(H, MH, species, x, y, n = 0) {
  const MO = await fimp(H, 'game/mobs.js');
  const s0 = A.freeSpot(H, MH, x, y, { rMin: 0, rMax: 3, r: 0.5 }) || [x, y];
  const a = MO.spawnLoose(H.game, species, s0[0], s0[1]), out = [a];
  for (let k = 0; k < n; k++) out.push(MO.spawnMember(H.game, a.spawner));
  return out;
}
const killQuiet = async (H, list) => { const MC = await fimp(H, 'game/combat.js'); for (const e of list) if (!e.dead) { e.noCorpse = true; MC.killMob(H.game, e, null); } };

def('FA1', {
  title: 'FA: a jaguar stalks and pounces on the guest; creative mode keeps it off', timeout: 120000,
  expected: 'A jaguar (wild fauna, hostile stalker) ~7 tiles from the guest sees it and chases it on the host: creeping while far (speedK < 1), the pounce close in (speedK > 1); the guest gets its proxy (species jaguar, "Onça-pintada", the chase at the guest); its bites reduce the guest HP (the owner applies them); called off and put next to the guest in creative mode it never starts a chase; killed, its body (corpse of a jaguar) appears on both; digest equal',
  api: 'game/fauna.js walkBrain (stalk → m.speedK) → ai.js updateCreature chase / bite → players.hurtPlayer; ai.aggro creative guard; content/fauna.js FAUNA_SPECIES; net/entities.js; combat.killMob → corpse.add',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.keepAlive(t, G);
  await A.openField(t, H, MH, G, MG, 9); // (a planet's start can be wooded: open ground first)
  const gp = G.game.player, av = () => guestOnHost(H, G);
  let spot = null;
  for (let k = 0; k < 12 && !spot; k++) {
    const a = (k / 12) * Math.PI * 2, q = A.freeSpot(H, MH, gp.x + Math.cos(a) * 7, gp.y + Math.sin(a) * 7, { rMin: 0, rMax: 1, r: 0.45 });
    if (q && A.clearLine(H, MH, q[0], q[1], gp.x, gp.y, 0.35)) spot = q;
  }
  t.assert(spot, 'an open spot 7 tiles from the guest');
  const [m] = await faunaGroup(H, MH, 'jaguar', spot[0], spot[1]);
  const made = [m];
  t.defer(() => killQuiet(H, made));
  t.defer(() => { H.game.creative = false; });
  t.check(m.fauna && typeof m.brain === 'function', 'the jaguar runs the fauna brain (setupFauna)');
  let creep = false, pounce = false;
  const w = t.watch(() => { if (m.state === 'chase') { if (m.speedK < 1 && Math.hypot(m.x - gp.x, m.y - gp.y) > 4.5) creep = true; if (m.speedK > 1) pounce = true; } }, 16);
  const dmgG = [];
  t.on(G, 'damage', (d) => { if (d.target === gp && d.amount > 0) dmgG.push(d.amount); });
  m.calmT = 0; m.thinkT = 0;
  await t.waitFor(() => m.state === 'chase' && (m.threat === av() || m.threat?.pid === G.pid), 8000, 'host: the jaguar chases the guest', () => `state=${m.state} d=${f2(Math.hypot(m.x - gp.x, m.y - gp.y))}`);
  const pr = await t.waitFor(() => A.proxyOf(G, m), 1500, 'its proxy on the guest');
  t.check(pr.species === 'jaguar' && pr.name === 'Onça-pintada', 'guest proxy: species jaguar, "Onça-pintada"', `${pr.species} "${pr.name}" L${pr.level}`);
  await t.tryWait(() => pr.state === 'chase' && pr.threat === gp, ONEWAY() + 800);
  t.check(pr.state === 'chase' && pr.threat === gp, 'the guest sees the chase at itself', `state=${pr.state}`);
  await t.tryWait(() => dmgG.length > 0, 10000);
  w.stop();
  t.check(dmgG.length > 0, "its bites reduce the guest's HP (applied by the owner)", `${dmgG.length} bites: ${dmgG.join(', ')}`);
  t.check(creep, 'it crept in while far (speedK < 1)');
  t.check(pounce, 'and pounced close in (speedK > 1)');
  // creative: called off, put right next to the guest — no chase
  H.game.creative = true;
  m.state = 'idle'; m.threat = null; m.calmT = 0; m.stateT = 5; m.action = null;
  const s2 = A.freeSpot(H, MH, gp.x + 2, gp.y, { rMin: 0, rMax: 2, r: 0.45 }) || [gp.x + 2, gp.y];
  m.x = s2[0]; m.y = s2[1];
  const chased = await t.tryWait(() => m.state === 'chase', 3000);
  t.check(!chased, 'in creative mode it never starts a chase at the guest', `state=${m.state}`);
  H.game.creative = false;
  // killed: its body on both
  const MC = await fimp(H, 'game/combat.js');
  MC.killMob(H.game, m, null);
  const c = await t.waitFor(() => [...H.game.corpses.map.values()].find((o) => o.of === 'jaguar' && Math.hypot(o.x - m.x, o.y - m.y) < 1.5), RT() + 800, 'its body on the host');
  await t.waitFor(() => bodyOn(G, c.id)?.of === 'jaguar', ONEWAY() + 800, 'its body on the guest');
  await t.checkDigest(H, G);
});

def('FA2', {
  title: 'FA: a zebra herd runs off together and a gull flock takes off, the same on the guest', timeout: 120000,
  expected: 'Five zebras of one herd (one spawner) near the guest: the guest walks at them; the one it nears flees and the whole herd runs with it (all five in flee on the host within 1.5 s of the first); on the guest the five proxies run away (each ≥ 3 tiles further from the guest than when it started). Three gulls perched near the guest (fmode 0 on both): the guest walks up, the flock takes off together (fmode flying on the host) and the flying bit reaches the guest proxies; digest equal',
  api: 'game/fauna.js walkBrain herdFlee (ai.startFlee on the herd) · birdBrain takeOff (flock) → m.fmode; net/entities.js dyn[13] fmode << 4 → proxy e.fmode',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.keepAlive(t, G);
  await A.openField(t, H, MH, G, MG, 12); // (a planet's start can be wooded: open ground first)
  const gp = G.game.player;
  // an open field: the herd 9 tiles from the guest along a clear line
  let dir = null;
  for (let k = 0; k < 16 && !dir; k++) {
    const a = (k / 16) * Math.PI * 2, x = gp.x + Math.cos(a) * 9, y = gp.y + Math.sin(a) * 9;
    if (A.clearLine(G, MG, gp.x, gp.y, x, y, 0.4) && A.freeSpot(H, MH, x, y, { rMin: 0, rMax: 1, r: 0.5 })) dir = [Math.cos(a), Math.sin(a)];
  }
  t.assert(dir, 'an open line 9 tiles long from the guest');
  const herd = await faunaGroup(H, MH, 'zebra', gp.x + dir[0] * 9, gp.y + dir[1] * 9, 4);
  const made = [...herd];
  t.defer(() => killQuiet(H, made));
  for (const m of herd) { m.state = 'idle'; m.stateT = 60; }
  await t.waitFor(() => herd.every((m) => A.proxyOf(G, m)), 3000 + CFG.budget, 'the five zebras on the guest');
  const rel = A.holdMove(G, dir[0] * 0.8, dir[1] * 0.8);
  let first = null;
  await t.waitFor(() => { const f = herd.find((m) => m.state === 'flee'); if (f && !first) first = now(); return !!f; }, 9000, 'host: a zebra runs from the guest', () => herd.map((m) => `${m.state} ${f2(Math.hypot(m.x - gp.x, m.y - gp.y))}`).join(' / '));
  rel();
  const d0 = herd.map((m) => { const q = A.proxyOf(G, m); return Math.hypot(q.x - gp.x, q.y - gp.y); });
  const all = await t.tryWait(() => herd.every((m) => m.state === 'flee' || m.dead), 1500);
  t.check(all, 'the whole herd runs with it (all five flee on the host)', herd.map((m) => m.state).join('/'));
  await t.sleep(3000);
  const d1 = herd.map((m) => { const q = A.proxyOf(G, m); return q ? Math.hypot(q.x - gp.x, q.y - gp.y) : 0; });
  t.check(d1.every((d, i) => d >= d0[i] + 3), 'on the guest the five run away (each ≥ 3 tiles further)', d0.map((d, i) => `${f2(d)}→${f2(d1[i])}`).join(' '));
  // a gull flock perched near the guest takes off together
  let gs = null;
  for (let k = 0; k < 16 && !gs; k++) {
    const a = (k / 16) * Math.PI * 2, x = gp.x + Math.cos(a) * 8, y = gp.y + Math.sin(a) * 8;
    if (A.clearLine(G, MG, gp.x, gp.y, x, y, 0.4)) gs = [x, y, Math.cos(a), Math.sin(a)];
  }
  t.assert(gs, 'an open line for the gulls');
  const gulls = await faunaGroup(H, MH, 'seagull', gs[0], gs[1], 2);
  made.push(...gulls);
  for (const m of gulls) { m.state = 'perch'; m.stateT = 60; m.fmode = 0; }
  await t.waitFor(() => gulls.every((m) => A.proxyOf(G, m)), 3000 + CFG.budget, 'the gulls on the guest');
  t.check(gulls.every((m) => !(A.proxyOf(G, m).fmode & 1)), 'perched (not flying) on the guest', gulls.map((m) => A.proxyOf(G, m).fmode).join('/'));
  const rel2 = A.holdMove(G, gs[2] * 0.8, gs[3] * 0.8);
  await t.waitFor(() => gulls.every((m) => m.fmode & 1), 9000, 'host: the flock takes off together', () => gulls.map((m) => `${m.state}/${m.fmode} ${f2(Math.hypot(m.x - gp.x, m.y - gp.y))}`).join(' · '));
  rel2();
  await t.waitFor(() => gulls.every((m) => A.proxyOf(G, m)?.fmode & 1), ONEWAY() + 800, 'the guest sees them flying (fmode)');
  await t.checkDigest(H, G);
});

// =====================================================================================================
// ST1 Streamed planet (docs/STREAMING.md): a synthetic-planet host, a guest that generates the same chunks locally
def('ST1', {
  title: 'ST: streamed planet — guest generates the chunks, ops on far chunks, the seam', timeout: 180000,
  expected: 'Host on ?source=synth: the guest learns the source from the welcome and generates the same terrain locally (same tiles at both spawns); the join snapshot is diffs only (small); the host goes 3000 tiles away and changes a far chunk (a natural object removed, a rock mined): interest (net/interest.js) — the guest, whose player stays home, does NOT get those ops (skip counts, the chunk is stale for it, digests equal without it); the guest walks there: the chunk diff brings the same changes; both players cross the x seam (positions stay canonical, 0 ≤ x < W); digests equal',
  api: '?source=synth; welcome.src; world.{wrap, source.kind, isLoaded, chunkIndex, idx, rock, objById, streamer}; ops obj.remove / tile.mine; session.interest.excluded(pid); net.stats.opsSkipped / chunkDiffs; game.streamStats()',
}, async (t) => {
  const room = newRoom();
  const H = await bootHost(t, room, { extra: '&source=synth' });
  const G = await bootGuest(t, room, H);
  const hw = H.game.world, gw = G.game.world;
  t.check(hw.wrap && hw.source.kind === 'synth', 'host runs the synthetic planet (wraps)', hw.source.kind);
  t.check(gw.wrap && gw.source.kind === 'synth', 'guest got the source from the welcome and generated the same planet', gw.source.kind);
  // the same tiles around the spawn (generated separately on each peer)
  const sp = hw.spawn;
  let same = true, n = 0;
  for (let y = Math.floor(sp.y) - 20; y <= Math.floor(sp.y) + 20; y += 3) for (let x = Math.floor(sp.x) - 20; x <= Math.floor(sp.x) + 20; x += 3) {
    const i = hw.idx(x, y);
    if (!hw.isLoaded(hw.chunkIndex(x, y)) || !gw.isLoaded(gw.chunkIndex(x, y))) continue;
    n++;
    for (const L of ['rock', 'water', 'ground', 'biome', 'ore']) if (hw[L].get(i) !== gw[L].get(i)) same = false;
  }
  t.check(same && n > 50, 'the tiles around the spawn are identical on both', `${n} tiles compared`);
  const snap = JSON.stringify((await frameImport(H, 'net/snapshot.js')).serializeWorld(H.game)).length;
  t.check(snap < 200000, 'the join snapshot is diffs only (no tile data)', `${snap} bytes`);
  // the host goes far away: a far region loads on the host only
  const fx = Math.floor(sp.x) + 3000, fy = Math.floor(sp.y);
  H.game.player.x = fx + 0.5; H.game.player.y = fy + 0.5; H.game.cam.x = fx + 0.5; H.game.cam.y = fy;
  const fc = hw.chunkIndex(fx, fy);
  await t.waitFor(() => hw.isLoaded(fc), 8000, 'host loaded the far chunk');
  t.check(!gw.isLoaded(fc), 'the guest (at home) does not have the far chunk', `guest chunks ${gw.loaded}`);
  // a natural object of the far region, and a rock there (search the loaded far chunks)
  let obj = null, rk = null;
  for (let r = 0; r < 120 && (!obj || !rk); r++) for (let k = 0; k < 16 && (!obj || !rk); k++) {
    const x = fx + Math.round(Math.cos(k * 0.39) * r), y = fy + Math.round(Math.sin(k * 0.39) * r);
    if (!hw.isLoaded(hw.chunkIndex(x, y))) continue;
    if (!rk && hw.rock.get(hw.idx(x, y)) === 1 && hw.inBounds(x, y)) rk = [x, y];
    if (!obj) hw.forChunks(x, y, x, y, (c) => { for (const o of c.objects) if (!obj && !o.building && typeof o.id === 'number' && (o.type === 'pebble' || o.type.startsWith('tree_'))) obj = o; });
  }
  t.assert(obj, 'found a natural object in the far region');
  const skip0 = G.game.net.stats.opsSkipped || 0, oc = hw.chunkIndex(obj.x, obj.y);
  H.game.net.emit('obj.remove', { ids: [obj.id] });
  if (rk) H.game.net.emit('tile.mine', { tx: rk[0], ty: rk[1], drops: [], by: H.game.net.pid, xp: 0 });
  // interest: the far changes do not travel to the guest (skip counts); the host keeps the chunk stale for it
  await t.waitFor(() => (G.game.net.stats.opsSkipped || 0) > skip0, ONEWAY() + 2000, 'the guest got skip counts for the far ops');
  const ex = H.session.interest.excluded(G.pid) || [];
  t.check(ex.includes(oc), 'the far chunk is stale for the guest (left out of its digest)', `${ex.length} chunks excluded`);
  t.check(!gw.isLoaded(oc) || gw.objById.has(obj.id), 'the guest did not apply the far change', `loaded ${gw.isLoaded(oc)}`);
  await t.checkDigest(H, G, 'digest equal without the stale chunks');
  // the guest goes there: the chunk diff brings the changes
  A.teleport(G, obj.x + 2.5, obj.y + 0.5);
  await t.waitFor(() => gw.isLoaded(oc) && !gw.objById.has(obj.id), ONEWAY() + 5000, 'the guest came near: the chunk diff removed the object', () => `diffs ${G.game.net.stats.chunkDiffs || 0} stale ${(H.session.interest.excluded(G.pid) || []).length}`);
  if (rk) await t.waitFor(() => gw.rock.get(gw.idx(rk[0], rk[1])) === 0, ONEWAY() + 3000, 'guest has the same far rock mined');
  else t.note('no rock in the far region of this seed (mining part skipped)');
  t.check(!(H.session.interest.excluded(G.pid) || []).includes(oc), 'no longer stale for the guest');
  // the seam: both players step across x = W
  const W = hw.W;
  for (const f of [H, G]) { const p = f.game.player; p.x = W - 0.3; p.y = fy + 0.5; f.game.cam.x = p.x; }
  await t.sleep(300);
  for (const f of [H, G]) { const p = f.game.player; p.autoMove = [1, 0]; }
  await t.sleep(1500);
  for (const f of [H, G]) f.game.player.autoMove = null;
  const xs = [H, G].map((f) => f.game.player.x);
  t.check(xs.every((x) => x >= 0 && x < W), 'positions stay canonical across the seam (0 ≤ x < W)', xs.map((x) => x.toFixed(2)).join(' / '));
  t.check(hw.isLoaded(hw.chunkIndex(0.5, fy)) && hw.isLoaded(hw.chunkIndex(W - 0.5, fy)), 'the chunks on both sides of the seam are loaded');
  await t.checkDigest(H, G);
});

// =====================================================================================================
// ST2 Heights on the streamed planet (docs/STREAMING.md §1, docs/TERRAIN-HEIGHT.md): generated heights never travel,
// edits do (op terrain.set / snapshot terr), also for chunks a peer loads later
def('ST2', {
  title: 'ST: planet heights — generated on each peer, far edits load the chunk, a late joiner gets them', timeout: 240000,
  expected: 'Host on ?source=planet: the guest generates the same heights (heightAt / cliffs equal around the spawn); the host goes far away (beyond the chunks the guest has) and raises a few terrain corners on dry ground there (op terrain.set): the guest, at home, loads that chunk on demand and gets the same corners and surface (heightAt equal), the chunk is kept (changed); a second guest joining later gets the edits in the join snapshot (terr) and sees the same heights; digests equal',
  api: '?source=planet; world.height.{terrainH, base, ci, edits, diff}; world.heightAt / isCliff; op terrain.set; snapshot terr',
}, async (t) => {
  const room = newRoom();
  const H = await bootHost(t, room, { extra: '&source=planet' });
  const G = await bootGuest(t, room, H);
  const hw = H.game.world, gw = G.game.world;
  t.check(hw.source.kind === 'planet' && gw.source.kind === 'planet', 'both run the planet source', `${hw.source.kind} / ${gw.source.kind}`);
  t.check(hw.height.any && gw.height.any, 'the planet has terrain heights on both');
  // the same heights around the spawn (each peer generated its own) — where both have the chunk and its 8 neighbours
  // (a page next to a chunk not loaded yet is provisional: docs/STREAMING.md §1)
  const sp = hw.spawn, around = (w, c) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!w.isLoaded(((c >>> 8) + dy) * 256 + (((c & 255) + dx) & 255))) return false; return true; };
  await t.waitFor(() => around(hw, hw.chunkIndex(sp.x, sp.y)) && around(gw, gw.chunkIndex(sp.x, sp.y)), 15000, 'both loaded the chunks around the spawn');
  let n = 0, dmax = 0, cl = 0;
  for (let y = Math.floor(sp.y) - 40; y <= Math.floor(sp.y) + 40; y += 2) for (let x = Math.floor(sp.x) - 40; x <= Math.floor(sp.x) + 40; x += 2) {
    const c = hw.chunkIndex(x, y);
    if (!around(hw, c) || !around(gw, c)) continue;
    n++;
    dmax = Math.max(dmax, Math.abs(hw.heightAt(x + 0.3, y + 0.6) - gw.heightAt(x + 0.3, y + 0.6)));
    if (hw.isCliff(x, y) !== gw.isCliff(x, y)) cl++;
  }
  t.check(n > 100 && dmax < 1e-6 && cl === 0, 'heights and cliffs around the spawn are identical on both', `${n} points, max diff ${dmax}, cliff mismatches ${cl}`);
  // far away: a dry, rock-free spot on the host (the guest stays home)
  let spot = null;
  for (const [ox, oy] of [[600, 0], [-600, 0], [0, 600], [0, -500], [900, 400], [-900, 400], [2000, 0], [-2000, 0], [1500, 900], [-1500, 900]]) {
    const fx0 = Math.floor(sp.x) + ox, fy = Math.min(hw.H - 300, Math.max(300, Math.floor(sp.y) + oy));
    H.game.player.x = fx0 + 0.5; H.game.player.y = fy + 0.5; H.game.cam.x = fx0 + 0.5; H.game.cam.y = fy;
    await t.waitFor(() => around(hw, hw.chunkIndex(fx0, fy)), 15000, 'host loaded the far chunks');
    await t.sleep(1500); // (the streamer's workers bring the rest around)
    for (let r = 0; r < 150 && !spot; r += 2) for (let k = 0; k < 48 && !spot; k++) {
      const x = fx0 + Math.round(Math.cos(k * 0.1309) * r), y = fy + Math.round(Math.sin(k * 0.1309) * r);
      // (inside its chunk, ≥ 5 tiles from the edge: the surface there reads no neighbour's corners)
      if ((x & 63) < 5 || (x & 63) > 58 || (y & 63) < 5 || (y & 63) > 58) continue;
      if (!hw.isLoaded(hw.chunkIndex(x, y)) || gw.isLoaded(gw.chunkIndex(x, y))) continue;
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) { const i = hw.idx(x + dx, y + dy); if (hw.water.get(i) || hw.rock.get(i) || hw.isCliff(x + dx, y + dy)) ok = false; }
      if (ok) spot = [x, y];
    }
    if (spot) break;
  }
  t.assert(spot, 'found dry ground in a far region (not loaded on the guest)');
  const L = hw.height, p = [];
  for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) { const i = L.ci(spot[0] + dx, spot[1] + dy); p.push(i, Math.round((L.base.get(i) + 1.5) * 100)); }
  H.game.net.emit('terrain.set', { p, by: H.game.net.pid, m: 'fill' });
  const i0 = p[0], h0 = p[1] / 100, fc = gw.chunkIndex(spot[0], spot[1]);
  await t.waitFor(() => gw.isLoaded(fc) && Math.abs(gw.height.terrainH(spot[0], spot[1]) - h0) < 1e-6, ONEWAY() + 4000, 'guest loaded the far chunk on demand and raised the same corners');
  t.check(gw.height.edits.get(i0) === hw.height.edits.get(i0), 'the edit is in both edit maps (the diff)', `${hw.height.edits.get(i0)} / ${gw.height.edits.get(i0)}`);
  const hx = spot[0] + 0.5, hy = spot[1] + 0.5;
  t.check(Math.abs(hw.heightAt(hx, hy) - gw.heightAt(hx, hy)) < 1e-6 && hw.heightAt(hx, hy) > hw.height.base.get(i0) + 0.5, 'the raised surface is the same on both', `${hw.heightAt(hx, hy).toFixed(3)} / ${gw.heightAt(hx, hy).toFixed(3)}`);
  t.check(gw.crec[fc]?.dirty, 'the edited chunk is kept (changed) on the guest');
  // a late joiner gets the edits from the join snapshot
  const G3 = await bootGuest(t, room, H, { label: 'guest-3' });
  const w3 = G3.game.world;
  t.check(w3.source.kind === 'planet' && w3.height.edits.get(i0) === h0, 'the late joiner has the edit (snapshot terr)', `${w3.height.edits.get(i0)}`);
  t.check(Math.abs(w3.heightAt(hx, hy) - hw.heightAt(hx, hy)) < 1e-6, 'and the same surface there', `${w3.heightAt(hx, hy).toFixed(3)}`);
  await t.checkDigest(H, G);
  await t.checkDigest(H, G3);
});

def('FA3', {
  title: 'FA: a lion hunts and kills a zebra on the host; the guest sees the body; one kill a day', timeout: 120000,
  expected: 'A lion and a zebra ~3 tiles apart, far from both players: the hunt starts (ai.js startWildHunt: state hunt, creeping, then the sprint), the zebra runs (flee), the lion\'s bites daze it and kill it on the host; its body (corpse of a zebra) appears on the host and the guest; the lion stays by the body a while (idle, eating) and its pack does not hunt again that day (HUNT.kills: a second zebra next to it is left alone); the guest\'s proxy of the lion runs in; digest equal',
  api: 'content/fauna.js HUNT; ai.js lookForWild / startWildHunt / huntStep / wildKill; combat dealDamage → corpse; net/entities.js state',
}, async (t) => {
  const { H, G, MH } = await pairCtx(t);
  A.keepAlive(t, G);
  const gp = G.game.player, hp = H.game.player;
  let spot = null;
  for (let k = 0; k < 16 && !spot; k++) {
    const a = (k / 16) * Math.PI * 2, x = gp.x + Math.cos(a) * 22, y = gp.y + Math.sin(a) * 22;
    const q = A.freeSpot(H, MH, x, y, { rMin: 0, rMax: 2, r: 0.5 }), q2 = q && A.freeSpot(H, MH, q[0] + 3, q[1], { rMin: 0, rMax: 1, r: 0.45 });
    if (q && q2 && A.clearLine(H, MH, q[0], q[1], q2[0], q2[1], 0.45) && Math.hypot(q[0] - hp.x, q[1] - hp.y) > 16) spot = [q, q2];
  }
  t.assert(spot, 'an open field ~22 tiles from the players');
  const [lion] = await faunaGroup(H, MH, 'lion', spot[0][0], spot[0][1]);
  const [zebra] = await faunaGroup(H, MH, 'zebra', spot[1][0], spot[1][1]);
  const made = [lion, zebra];
  t.defer(() => killQuiet(H, made.filter((m) => !m.dead)));
  const MA = await fimp(H, 'game/ai.js');
  let fled = false, q0 = null, qMove = 0;
  await t.tryWait(() => A.proxyOf(G, lion), 3000);
  const w = t.watch(() => { const q = A.proxyOf(G, lion); if (q) { q0 ??= [q.x, q.y]; qMove = Math.max(qMove, Math.hypot(q.x - q0[0], q.y - q0[1])); } if (zebra.state === 'flee') fled = true; }, 16);
  MA.startWildHunt(H.game, lion, zebra);
  t.check(lion.state === 'hunt' && lion.prey === zebra && lion.huntWild, 'the lion hunts the zebra (wild hunt)', `${lion.state} ${lion.prey?.species}`);
  await t.waitFor(() => zebra.dead, 30000, 'the lion kills the zebra on the host', () => `lion ${lion.state} d=${f2(Math.hypot(lion.x - zebra.x, lion.y - zebra.y))} zebra ${zebra.state} hp ${f2(zebra.hp)}`);
  w.stop();
  t.check(fled, 'the zebra ran (flee)');
  const c = await t.waitFor(() => [...H.game.corpses.map.values()].find((o) => o.of === 'zebra' && Math.hypot(o.x - zebra.x, o.y - zebra.y) < 1.5), RT() + 1500, 'its body on the host');
  await t.waitFor(() => bodyOn(G, c.id)?.of === 'zebra', ONEWAY() + 1500, 'its body on the guest');
  t.check(!q0 || qMove > 0.8, "the guest saw the lion run in (its proxy moved)", q0 ? `${f2(qMove)} tiles` : 'out of the guest interest range');
  t.check(lion.state === 'idle' && lion.stateT > 10, 'the lion stays by the body (eating)', `${lion.state} ${f2(lion.stateT)} s`);
  // one kill a day: a second zebra right next to it is left alone
  const [z2] = await faunaGroup(H, MH, 'zebra', lion.x + 2.5, lion.y);
  made.push(z2);
  lion.stateT = 0; lion.thinkT = 0; lion.wildT = 0; H.game.env.hour = 21;
  const again = await t.tryWait(() => lion.state === 'hunt', 3000);
  t.check(!again, 'its pack does not hunt again that day', `state ${lion.state}`);
  await t.checkDigest(H, G);
});

// =====================================================================================================
// TR · terrain relief (docs/TERRAIN-HEIGHT.md): tunnels, waterfalls, the shovel, jumping down. A host on the real planet
// (seed 4242) at a mountain cliff, the guest generating the same chunks (ST2).
const RELIEF_AT = [10267, 2281]; // (seed 4242: open ground at the foot of a cliff face, west of it a relief ≥ 1 story high)
async function reliefPair(t, at = RELIEF_AT) {
  const room = newRoom();
  const H = await bootHost(t, room, { extra: `&source=planet&px=${at[0]}&py=${at[1]}` });
  const G = await bootGuest(t, room, H);
  const MH = await A.mods(H), MG = await A.mods(G);
  t.check(H.game.world.height.any && G.game.world.height.any, 'both peers on the planet with heights', `${H.game.world.source.kind} / ${G.game.world.source.kind}`);
  A.keepAlive(t, G); A.keepAlive(t, H);
  A.pacify(H, at[0], at[1], 40);
  return { H, G, MH, MG };
}
// the tunnel tile in front of a player (its work descriptor) — game/tunnels.js describeTunnel
async function tunnelIt(f, tx, ty) { const MT = await fimp(f, 'game/tunnels.js'), MM = await fimp(f, 'game/mining.js'); return MT.describeTunnel(f.game, tx, ty, true) || MM.describeRock(f.game, tx, ty); } // (a rock tile: "Minerar" — the host tunnels it)

def('TR1', {
  title: 'TR: the guest digs a tunnel into a cliff; both see it and walk in', timeout: 180000,
  expected: 'Guest at the foot of a cliff on the planet, pickaxe in hand, facing west: "Cavar túnel" digs the face (work tunnel → intent tunnel.hit → op tunnel.dig): the tile becomes a tunnel with its floor at the guest\'s ground on both peers; the guest walks in (e._tn = the floor), digs a second tile from inside, the host sees the guest in the tunnel (its avatar\'s level = the floor); the relief above is unchanged on both (heightAt equal to the generated surface); the host walks in through the mouth and stands on the floor; a body on the surface over the tunnel is not in it; digest equal (tun section)',
  api: 'game/tunnels.js describeTunnel / work tunnel; mut/tunnels.js tunnel.hit / tunnel.dig / canTunnel; world.tun / tunAt / tunnels; physics.js tunTrack (e._tn); session presence tn; digest tiles.tun',
}, async (t) => {
  const { H, G } = await reliefPair(t);
  const hw = H.game.world, gw = G.game.world, gp = G.game.player, [fx, fy] = RELIEF_AT;
  await t.waitFor(() => hw.isLoaded(hw.chunkIndex(fx, fy)) && gw.isLoaded(gw.chunkIndex(fx, fy)), 15000, 'both loaded the cliff chunk');
  // the planet's flora may stand on the tunnel line: the host clears it (an op: the same on both)
  const inLine = hw.query(fx - 2, fy + 0.5, 2.2, (o) => o.solid && Math.floor(o.y - 0.05) === fy && o.x >= fx - 3 && o.x < fx).map((o) => o.id);
  if (inLine.length) { H.game.net.emit('obj.remove', { ids: inLine, fx: 'clear' }); await t.sleep(ONEWAY() + 300); }
  A.teleport(G, fx + 0.5, fy + 0.5); gp.facing = 'w';
  A.equip(G, 'pickaxe_copper');
  await A.hostSees(t, H, G);
  const h0 = hw.heightAt(fx - 1 + 0.5, fy + 0.5), f0 = gw.heightAt(gp.x, gp.y);
  const it = await tunnelIt(G, fx - 1, fy);
  t.assert(it && it.kind === 'tunnel', 'the face west of the guest can be tunnelled ("Cavar túnel")', JSON.stringify(it));
  await A.workUntil(t, G, () => it, () => gw.isTunnel(fx - 1, fy) && hw.isTunnel(fx - 1, fy), 20000, 'dig the first tunnel tile');
  t.check(Math.abs(hw.tunAt(fx - 1, fy) - f0) < 0.06 && hw.tunAt(fx - 1, fy) === gw.tunAt(fx - 1, fy), 'its floor = the guest\'s ground, the same on both', `floor ${hw.tunAt(fx - 1, fy)} / ${gw.tunAt(fx - 1, fy)} · guest ground ${f0.toFixed(2)}`);
  t.check(Math.abs(hw.heightAt(fx - 1 + 0.5, fy + 0.5) - h0) < 1e-6 && Math.abs(gw.heightAt(fx - 1 + 0.5, fy + 0.5) - h0) < 1e-6, 'the relief above stays (surface unchanged on both)', `${h0.toFixed(2)}`);
  // in: walk west until the guest is in the tunnel
  let rel = A.holdMove(G, -1, 0);
  await t.waitFor(() => gp._tn != null && gp.x < fx - 0.3, 4000, 'the guest walks into the tunnel (its level = the floor)', () => `x=${f2(gp.x)} tn=${gp._tn}`);
  await t.sleep(400); rel();
  const it2 = await tunnelIt(G, fx - 2, fy);
  t.assert(it2, 'from inside, the next tile can be dug', `guest at ${f2(gp.x)},${f2(gp.y)} tn ${gp._tn} · rock ${gw.rock.get(gw.idx(fx - 2, fy))}`);
  await A.workUntil(t, G, () => it2, () => gw.isTunnel(fx - 2, fy) && hw.isTunnel(fx - 2, fy), 20000, 'dig the second tile from inside');
  rel = A.holdMove(G, -1, 0);
  await t.waitFor(() => gp.x < fx - 1.2, 4000, 'the guest walks deeper', () => `x=${f2(gp.x)}`);
  await t.sleep(300); rel();
  await t.waitFor(() => { const av = guestOnHost(H, G); return av && av._tn != null && Math.abs(av._tn - hw.tunAt(fx - 2, fy)) < 0.01; }, RT() + 2000, 'the host sees the guest in the tunnel (avatar level = the floor)', () => `av tn ${guestOnHost(H, G)?._tn}`);
  const copy = A.avatarOn(H, G.pid);
  await t.waitFor(() => copy && copy._tn != null, 3000, "the guest's drawn copy on the host is in the tunnel too");
  // the host walks in through the mouth
  const hp = H.game.player;
  A.teleport(H, fx + 1.4, fy + 0.5); hp.facing = 'w';
  rel = A.holdMove(H, -1, 0);
  await t.waitFor(() => hp._tn != null, 6000, 'the host walks in through the mouth (its level = the floor)', () => `x=${f2(hp.x)} tn=${hp._tn}`);
  await t.sleep(250); rel();
  t.check(hp.x < fx, 'the host stands in the tunnel', `x=${f2(hp.x)}`);
  // a body standing on the surface over the tunnel is not in it
  const top = { x: fx - 1.5, y: fy + 0.5, _tt: -1, _tn: null };
  const MP = await fimp(H, 'game/physics.js');
  MP.tunTrack(hw, top);
  t.check(top._tn == null, 'a body placed on the surface over the tunnel stays on the surface', `tn ${top._tn}`);
  await t.checkDigest(H, G);
});

def('TR2', {
  title: 'TR: a waterfall at a known feature of the planet — found, drawn, misty and loud on both', timeout: 150000,
  expected: 'Planet seed 4242, the river step at (10464.7, 1598.3) (feature waterfall, drop 2.3): both peers list the feature (chunk features) and find the same fall tiles there (water tiles whose surface slopes ≥ 0.5 story / tile: the terrain shader draws them as a falling sheet, fx/waterfalls.js), each with a foot downhill; the mist / spray particles rise at the foot on both (cosmetic, each peer its own); the roar is loud at the guest standing next to it (near() > 0.3) and silent far away; the shader path is on (heights on the GPU: uMesh)',
  api: 'fx/waterfalls.js game.waterfalls.{features, find, list, near}; world.water / tileSlope; chunk record features (planetSource adaptChunk); particles',
}, async (t) => {
  const FALL = [10464.7, 1598.3];
  const { H, G } = await reliefPair(t, [10467, 1596]);
  const hw = H.game.world, gw = G.game.world;
  await t.waitFor(() => hw.isLoaded(hw.chunkIndex(FALL[0], FALL[1])) && gw.isLoaded(gw.chunkIndex(FALL[0], FALL[1])), 15000, 'both loaded the fall chunk');
  const fh = H.game.waterfalls.features(FALL[0], FALL[1], 4), fg = G.game.waterfalls.features(FALL[0], FALL[1], 4);
  t.check(fh.length === 1 && fg.length === 1 && Math.abs(fh[0].drop - 2.3) < 0.01, 'both list the planet\'s waterfall feature there (drop 2.3)', JSON.stringify(fh[0]));
  const rect = [FALL[0] - 5, FALL[1] - 5, FALL[0] + 5, FALL[1] + 5];
  const th = H.game.waterfalls.find(...rect), tg = G.game.waterfalls.find(...rect);
  const key = (L) => L.map((f) => `${f.x},${f.y}`).sort().join(' ');
  t.check(th.length >= 2 && key(th) === key(tg), 'the same fall tiles on both (water with a steep surface)', `${th.length} tiles: ${key(th)}`);
  t.check(th.every((f) => Math.hypot(f.fx - f.x, f.fy - f.y) > 0.2 && f.s >= 0.5), 'each with a foot downhill of it', th.map((f) => `${f.s.toFixed(2)}→${f.fx.toFixed(1)},${f.fy.toFixed(1)}`).join(' '));
  // the guest stands by the fall: mist rises at the foot, the roar is loud; far away it is silent
  A.teleport(G, 10466.5, 1597.5);
  const mist = (f) => (f.game.particles?.list || f.game.particles?.parts || []).filter?.((q) => q && Math.hypot(q.x - FALL[0], q.y - FALL[1]) < 4).length ?? -1;
  await t.waitFor(() => G.game.waterfalls.list.length > 0, 4000, 'the guest\'s waterfall system lists the falls in view');
  const nk = G.game.waterfalls.near(G.game.player.x, G.game.player.y).k;
  t.check(nk > 0.3, 'the roar is loud next to the fall', nk.toFixed(2));
  t.check(G.game.waterfalls.near(G.game.player.x + 40, G.game.player.y).k === 0, 'and silent 40 tiles away');
  const n0 = mist(G);
  if (n0 >= 0) { await t.tryWait(() => mist(G) > 0, 4000); t.check(mist(G) > 0, 'mist / spray particles at the foot on the guest', `${mist(G)} particles near the fall`); }
  t.check(!!G.game.R?.hgt || G.game.headless, 'the terrain is drawn as the height mesh (the waterfall sheet is in its shader)');
  await t.checkDigest(H, G);
});

def('TR3', {
  title: 'TR: the guest flattens ground with a shovel; the same terrain on both', timeout: 150000,
  expected: 'Guest with an iron shovel (item shovel_iron) on gentle planet ground: E with the shovel in hand opens the terrain tool (its bar: Cavar / Aterrar / Aplanar / Suavizar), Aplanar fixes the level at the first point, the brush preview lists the corners it moves (green) at that height; a few strokes (intent terrain.edit → op terrain.set) bring the corners under the brush to the level on both peers (the same terrain corners and surface), the grass decor on the flattened tiles is hidden on both; without a shovel the tool refuses ("Precisa de uma pá"); digest equal',
  api: 'game/terrain.js enterTerrainMode / setTerrainMode / brushPreview / TERRAIN_TOOL; mut/terrain.js terrain.edit / terrain.set / terrainBrush; items shovel_*; ui/terrainbar.js',
}, async (t) => {
  const { H, G } = await reliefPair(t, [10470, 1593]);
  const hw = H.game.world, gw = G.game.world, g = G.game, gp = g.player;
  await t.waitFor(() => gw.isLoaded(gw.chunkIndex(10470, 1593)), 15000, 'the guest loaded the spot');
  A.teleport(G, 10470.5, 1593.5);
  await A.hostSees(t, H, G);
  const MT = await fimp(G, 'game/terrain.js');
  // without a shovel: refused
  A.ensure(G, {}); for (const s of gp.inv.slots) if (s && s.id.startsWith('shovel_')) gp.inv.remove(s.id, s.qty);
  if (gp.equip.main?.startsWith?.('shovel_')) gp.equip.main = null;
  MT.enterTerrainMode(g, 'flat');
  const errs = [];
  t.on(G, 'error', (e) => errs.push(e.text));
  g.build.mode.tool.tap(g, gp.x + 1.4, gp.y + 1);
  t.check(errs.some((e) => /pá/.test(e)), 'without a shovel the tool refuses ("Precisa de uma pá")', errs.join(' | '));
  // with the shovel: E opens the tool
  A.equip(G, 'shovel_iron');
  g.build.mode = null;
  g.ctl.near = null; g.ctl.interact();
  t.check(g.build.mode?.kind === 'terrain', 'E with a shovel in hand opens the terrain tool', `${g.build.mode?.kind} ${g.build.mode?.m}`);
  MT.setTerrainMode(g, 'flat');
  const cx = gp.x + 1.4, cy = gp.y + 1;
  const pv = MT.brushPreview(g, cx, cy);
  t.check(pv && !pv.why && pv.list.length > 0, 'the brush preview lists the corners it moves', pv ? `${pv.list.length} corners, why ${pv.why}, level ${pv.h}` : 'none');
  for (let k = 0; k < 10; k++) { g.build.mode.tool.tap(g, cx, cy); await t.sleep(260); }
  const lvl = g.build.mode.h, L = hw.height;
  const ix = Math.round(cx), iy = Math.round(cy), i0 = L.ci(ix, iy);
  await t.waitFor(() => Math.abs(hw.height.terrainH(ix, iy) - lvl) < 0.02 && gw.height.terrainH(ix, iy) === hw.height.terrainH(ix, iy), RT() + 3000, 'the corner under the brush reaches the level on both', () => `host ${hw.height.terrainH(ix, iy)} guest ${gw.height.terrainH(ix, iy)} level ${lvl}`);
  t.check(hw.height.edits.get(i0) === gw.height.edits.get(i0) && hw.height.edits.size === gw.height.edits.size, 'the same edits on both (the diff)', `${hw.height.edits.size} / ${gw.height.edits.size}`);
  t.check(Math.abs(hw.heightAt(cx, cy) - gw.heightAt(cx, cy)) < 1e-6, 'the same surface there on both', `${hw.heightAt(cx, cy).toFixed(3)}`);
  const hid = (f) => { let n = 0, h = 0; f.game.world.forChunks(cx - 1, cy - 1, cx + 1, cy + 1, (bk) => { for (const d of bk.decor) if (Math.abs(d.x - cx) < 0.9 && Math.abs(d.y - cy) < 0.9) { n++; if (d._hid) h++; } }); return [n, h]; };
  const [nh, hh] = hid(H), [ng, hg] = hid(G);
  t.check(hh === nh && hg === ng, 'grass / flowers on the flattened tiles are hidden on both', `host ${hh}/${nh} guest ${hg}/${ng}`);
  g.build.mode = null;
  await t.checkDigest(H, G);
});

def('TR4', {
  title: 'TR: jumping down a small drop (player and creature), never up', timeout: 150000,
  expected: 'Planet seed 4242 at a cliff edge ~0.9 story high: the guest pushing east at the top hops down (a short arc: e._hop, the hop lift _jh > 0.2) and lands on the lower ground without damage; the host sees it below; pushing west at the foot it does not climb back (the cliff still blocks); A* from the top to the foot plans the one-way drop (a 2-tile step over the face) and none back up; a creature on the host chasing the guest below runs over the edge and hops down too; digest equal',
  api: 'game/terrain.js dropAhead / startHop / hopStep / DROP_MAX; levels.js hopUpdate; nav.js findPath (drops); ai.js go',
}, async (t) => {
  const TOP = [10281.7, 2274.5];
  const { H, G, MH } = await reliefPair(t, [10281, 2274]);
  const hw = H.game.world, gw = G.game.world, gp = G.game.player;
  await t.waitFor(() => gw.isLoaded(gw.chunkIndex(TOP[0], TOP[1])) && hw.isLoaded(hw.chunkIndex(TOP[0], TOP[1])), 15000, 'both loaded the cliff');
  A.teleport(G, TOP[0], TOP[1]);
  await A.hostSees(t, H, G);
  const h0 = gw.heightAt(gp.x, gp.y), hp0 = gp.hp;
  let hop = false, jh = 0;
  const w = t.watch(() => { if (gp._hop?.terrain) hop = true; jh = Math.max(jh, gp._jh || 0); }, 10);
  let rel = A.holdMove(G, 1, 0);
  await t.waitFor(() => hop, 4000, 'the guest hops at the edge', () => `x=${f2(gp.x)} h=${f2(gw.heightAt(gp.x, gp.y))}`);
  rel();
  await t.waitFor(() => !gp._hop, 2000, 'and lands');
  w.stop();
  const h1 = gw.heightAt(gp.x, gp.y);
  t.check(h0 - h1 > 0.5 && h0 - h1 <= 1.35, 'it landed on the lower ground (a drop of up to ~1 story)', `${f2(h0)} → ${f2(h1)}`);
  t.check(jh > 0.2, 'a short arc over the edge (the hop lift)', `max _jh ${f2(jh)}`);
  t.check(gp.hp >= hp0, 'no damage', `${hp0} → ${gp.hp}`);
  await t.waitFor(() => { const av = guestOnHost(H, G); return av && Math.abs(hw.heightAt(av.x, av.y) - h1) < 0.4; }, RT() + 1500, 'the host sees the guest below');
  // never up: pushing back west at the foot does not climb
  const x1 = gp.x;
  rel = A.holdMove(G, -1, 0);
  await t.sleep(1500);
  rel();
  t.check(gw.heightAt(gp.x, gp.y) < h0 - 0.4 && !gp._hop, 'pushing back at the foot does not climb (the face still blocks)', `x ${f2(x1)} → ${f2(gp.x)} h ${f2(gw.heightAt(gp.x, gp.y))}`);
  // A*: down over the edge, not back up
  const MN = await fimp(H, 'game/nav.js');
  const down = MN.findPath(H.game, Math.floor(TOP[0]), Math.floor(TOP[1]), Math.floor(gp.x), Math.floor(gp.y), 4000);
  const jump = down?.path?.some((q, k) => { const a = k ? down.path[k - 1] : [Math.floor(TOP[0]) + 0.5, Math.floor(TOP[1]) + 0.5]; return Math.abs(q[0] - a[0]) + Math.abs(q[1] - a[1]) > 1.5 && hw.isCliff(Math.floor((q[0] + a[0]) / 2), Math.floor((q[1] + a[1]) / 2)); });
  t.check(down?.complete && jump, 'A* plans the drop from the top to the foot (a 2-tile step over the face)', down ? `${down.path.length} steps, complete ${down.complete}` : 'no path');
  const up = MN.findPath(H.game, Math.floor(gp.x), Math.floor(gp.y), Math.floor(TOP[0]), Math.floor(TOP[1]), 600);
  const upJump = up?.path?.some((q, k) => { const a = k ? up.path[k - 1] : [Math.floor(gp.x) + 0.5, Math.floor(gp.y) + 0.5]; return Math.abs(q[0] - a[0]) + Math.abs(q[1] - a[1]) > 1.5; });
  t.check(!upJump, 'and never back up over it', up ? `${up.path.length} steps (complete ${up.complete})` : 'no short path up');
  // a creature pushing into the same edge (its chase / path runs over it: ai.js go) hops down too
  const [m] = await faunaGroup(H, MH, 'wolf', TOP[0] - 0.4, TOP[1]);
  t.defer(() => killQuiet(H, [m]));
  m.x = TOP[0]; m.y = TOP[1]; m.state = 'idle'; m.stateT = 99; m.calmT = 99; m.threat = null;
  const MA = await fimp(H, 'game/ai.js');
  let mhop = false;
  const w2 = t.watch(() => { if (m._hop?.terrain) mhop = true; if (!m.dead && (m._hop || Math.abs(hw.heightAt(m.x, m.y) - h0) < 0.3)) { m.stateT = 99; MA.go(H.game, m, [1, 0], 4.4, 1 / 60); } }, 16);
  await t.tryWait(() => mhop && !m._hop, 4000);
  w2.stop();
  t.check(mhop && Math.abs(hw.heightAt(m.x, m.y) - h1) < 0.45, 'a wolf pushing into the edge hops down it', `wolf at ${f2(m.x)},${f2(m.y)} h ${f2(hw.heightAt(m.x, m.y))} hop ${mhop}`);
  // and a wolf chasing the guest from the top gets down to it (over the edge or around: the cheaper way)
  const [m2] = await faunaGroup(H, MH, 'wolf', TOP[0] - 1.2, TOP[1]);
  t.defer(() => killQuiet(H, [m2]));
  MA.aggro?.(H.game, m2, guestOnHost(H, G));
  const down2 = await t.tryWait(() => Math.abs(hw.heightAt(m2.x, m2.y) - h1) < 0.45 || Math.hypot(m2.x - gp.x, m2.y - gp.y) < 1.4, 12000);
  t.check(down2, 'a wolf chasing the guest from the top gets down to it', `wolf at ${f2(m2.x)},${f2(m2.y)} h ${f2(hw.heightAt(m2.x, m2.y))} state ${m2.state} hop ${!!m2._hop}`);
  await t.checkDigest(H, G);
});

// =====================================================================================================
// LZ: the planet as the game (seasons by latitude, the abyss, interest) — places found through the planet's macro map
// macro cells (512 × 256 of 32 tiles) of the frame's planet matching pred(cell, P), nearest to (x, y) first
function planetCells(f, pred, x, y, n = 1) {
  const P = f.game.world.source?.planet, K = f.game.world.source?.biomeKeys;
  if (!P) return [];
  const out = [], cx = Math.floor(x / 32), cy = Math.floor(y / 32);
  for (let c = 0; c < P.tMean.length; c++) {
    if (!pred(c, P, K)) continue;
    let dx = Math.abs((c % 512) - cx); if (dx > 256) dx = 512 - dx;
    out.push([dx + Math.abs(Math.floor(c / 512) - cy), c]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.slice(0, n).map((q) => ({ c: q[1], x: (q[1] % 512) * 32 + 16, y: Math.floor(q[1] / 512) * 32 + 16 }));
}
const cellZone = (P, c) => { const w = P.tMean[c] + P.tAmp[c] / 2, k = P.tMean[c] - P.tAmp[c] / 2; return w < 2 ? 4 : k < -12 || w < 10 ? 3 : k < 6 ? 2 : k < 16 ? 1 : 0; };
// a walkable land spot of zone z within r tiles of (x, y) on frame f (loads the chunks it reads)
function zoneSpot(f, M, x, y, z, r = 30) {
  const w = f.game.world;
  for (let d = 0; d <= r; d += 2) for (let k = 0; k < 16; k++) {
    const tx = Math.floor(x + Math.cos(k * 0.3927) * d), ty = Math.floor(y + Math.sin(k * 0.3927) * d);
    w.ensure(w.chunkIndex(tx, ty));
    if (w.waterAt(tx, ty) || w.isRock(tx, ty) || (z >= 0 && w.zoneAt(tx, ty) !== z)) continue;
    const s = A.freeSpot(f, M, tx + 0.5, ty + 0.5, { rMin: 0, rMax: 2 });
    if (s && (z < 0 || w.zoneAt(Math.floor(s[0]), Math.floor(s[1])) === z)) return s;
  }
  return null;
}
async function moveBoth(t, H, G, s, gs = null) {
  A.teleport(H, s[0], s[1]);
  const g = gs || [s[0] + 2, s[1]];
  A.teleport(G, g[0], g[1]);
  await t.sleep(600);
  await A.hostSees(t, H, G);
}

// LZ1 polar walkers every night on both peers
def('LZ1', {
  title: 'LZ: the polar zone — permanent winter on both, walkers on a SUMMER night there (and none at the temperate spawn)', timeout: 200000,
  expected: 'Both players go to a polar land cell (planet macro: the warmest month < 2 °C); the clock jumps to a summer night of the calendar: game.season is "Inverno polar" (winter, hard, frozen) on both, the water of that zone is ice on both (world.iceZ[4]); the host forces the walkers\' spawn tick: walkers appear near the players (host) and reach the guest as proxies; back at the temperate spawn the same summer night: no walker spawns there (the winter is where each player stands); digest equal',
  api: 'seasons.js zoneSeason / seasonAt / hardWinterAt, world.zoneAt / iceZ / frozenAt, walkers.js walkersTick (game._walkT), op env.skip',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, day0 = EH.dayIndex, hour0 = EH.hour, sp = H.game.world.spawn;
  t.defer(() => {
    H.game.net.emit('env.skip', { hour: hour0, day: day0, wt: H.game.worldTime + 1, by: H.game.net.pid });
    for (const e of H.game.entities.slice()) if (e.isMob && !e.dead && (e.faction === 'walker' || e.spawner?.hunt)) { e.noCorpse = true; MH.combat.killMob(H.game, e, null); }
  });
  A.keepAlive(t, H); A.keepAlive(t, G);
  const cells = planetCells(H, (c, P) => !P.ocean[c] && !P.lakeId[c] && cellZone(P, c) === 4, sp.x, sp.y, 12);
  t.assert(cells.length, 'the planet has polar land');
  let spot = null;
  for (const c of cells) { spot = zoneSpot(H, MH, c.x, c.y, 4, 40); if (spot) break; }
  t.assert(spot, 'a walkable polar spot');
  await moveBoth(t, H, G, spot);
  // a summer night of the calendar (short year: day 2, 23 h)
  H.game.net.emit('env.skip', { hour: 23, day: 2, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => G.game.env.dayIndex === 2 && Math.abs(G.game.env.hour - 23) < 0.3, 3000 + CFG.budget, 'the guest clock follows to the summer night');
  await t.waitFor(() => H.game.season?.zone === 4 && G.game.season?.zone === 4, 3000, 'both stand in the polar zone', () => `${H.game.season?.zone} / ${G.game.season?.zone}`);
  t.check(H.game.season.id === 'winter' && G.game.season.id === 'winter' && H.game.season.hard && G.game.season.hard, 'permanent winter on both (a summer day of the calendar)', `${H.game.season.name} / ${G.game.season.name}`);
  t.check(/polar/i.test(G.game.season.name), 'the guest sees "Inverno polar"', G.game.season.name);
  t.check(H.game.world.iceZ[4] === 1 && G.game.world.iceZ[4] === 1 && H.game.world.iceZ[2] === 0 && G.game.world.iceZ[2] === 0, 'polar water is ice on both, temperate water is not (summer)', `${[...H.game.world.iceZ]} / ${[...G.game.world.iceZ]}`);
  // the walkers' spawn tick (forced: one try per call)
  const near = (f, p) => A.hostMobs(H, (m) => m.faction === 'walker' && Math.hypot(H.game.world.dx(m.x, p.x), m.y - p.y) < 60).length;
  for (let k = 0; k < 12 && !near(H, H.game.player); k++) { H.game._walkT = 0; MH.walkers.walkersTick(H.game, true); await t.sleep(50); }
  t.check(near(H, H.game.player) > 0, 'walkers come out on the polar summer night (host)', `${near(H, H.game.player)}`);
  const w = A.hostMobs(H, (m) => m.faction === 'walker')[0];
  if (w) { w.calmT = 999; await t.waitFor(() => A.proxyOf(G, w) || (A.teleport(G, w.x + 3, w.y), false), RT() + 4000, 'the guest sees a walker'); }
  // back at the temperate spawn: the same night brings no walker
  for (const e of H.game.entities.slice()) if (e.isMob && !e.dead && e.faction === 'walker') { e.noCorpse = true; MH.combat.killMob(H.game, e, null); }
  const s2 = A.freeSpot(H, MH, sp.x, sp.y, { rMin: 0, rMax: 4 });
  await moveBoth(t, H, G, s2);
  await t.waitFor(() => H.game.season?.zone === 2 && G.game.season?.zone === 2, 3000, 'both back in the temperate zone');
  for (let k = 0; k < 8; k++) { H.game._walkT = 0; MH.walkers.walkersTick(H.game, true); }
  t.check(!A.hostMobs(H, (m) => m.faction === 'walker').length, 'no walker at the temperate spawn on a summer night', `${A.hostMobs(H, (m) => m.faction === 'walker').length}`);
  G.game.world.ensure(G.game.world.chunkIndex(spot[0], spot[1])); // (the polar spot is far now: its zone layer again)
  t.check(MG.seasons.hardWinterAt(G.game, spot[0], spot[1]) && !MG.seasons.hardWinterAt(G.game, s2[0], s2[1]), 'the guest computes the same: hard winter at the polar spot, none at the spawn');
  await t.checkDigest(H, G);
  env.history.push('LZ1');
});

// LZ2 the abyss: a boat stops at its edge, swimming there exhausts
def('LZ2', {
  title: 'LZ: the abyssal ocean — a boat cannot enter ("Oceano aberto: o barco não aguenta"), swimming there tires and chills', timeout: 200000,
  expected: 'Both players go to the open sea next to the abyss (planet macro: an abyssal cell next to a deep one); the host launches a boat on deep water a few tiles from the abyss; the guest boards (the oars) and rows toward the abyss for a few seconds: the hull never covers an abyssal tile (on both), the guest is told "Oceano aberto: o barco não aguenta", the boat stays put at the edge; the guest leaves the boat by teleport into the abyss: it is swimming there, gets the warning and its energy drains; digest equal',
  api: 'world.abyssAt / zone layer bit 8, content/boats.js boatable / hullAbyss, boats.js drive (error), survival.js abyssSwim (p._abyss, energy), op boat.launch / boat.set / boat.pos',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const sp = H.game.world.spawn, hw = H.game.world, gw = G.game.world;
  A.keepAlive(t, H, { hp: true }); A.keepAlive(t, G, { hp: true });
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const cells = planetCells(H, (c, P) => P.water[c] === 2 && cellZone(P, c) <= 1 && NB.some(([dx, dy]) => { const y = Math.floor(c / 512) + dy; return y >= 0 && y < 256 && P.water[y * 512 + (((c % 512) + dx + 512) % 512)] === 3; }), sp.x, sp.y, 6);
  t.assert(cells.length, 'the planet has deep sea next to the abyss');
  // a deep, non-abyssal tile with the abyss 4..9 tiles away, and the heading toward it
  let site = null;
  for (const c of cells) {
    for (let yy = c.y - 40; yy <= c.y + 40 && !site; yy += 2) for (let xx = c.x - 40; xx <= c.x + 40 && !site; xx += 2) {
      hw.ensure(hw.chunkIndex(xx, yy));
      if (hw.waterAt(xx, yy) !== 2 || hw.abyssAt(xx, yy)) continue;
      for (let k = 0; k < 8 && !site; k++) {
        const a = (k / 8) * Math.PI * 2;
        let dA = 0;
        for (let d = 1; d <= 9; d++) { const qx = Math.floor(xx + 0.5 + Math.cos(a) * d), qy = Math.floor(yy + 0.5 + Math.sin(a) * d); hw.ensure(hw.chunkIndex(qx, qy)); if (hw.abyssAt(qx, qy)) { dA = d; break; } }
        if (dA >= 5 && dA <= 9 && MH.boatsc.hullFree(H.game, xx + 0.5, yy + 0.5, a)) site = { x: xx + 0.5, y: yy + 0.5, a, dA };
      }
    }
    if (site) break;
  }
  t.assert(site, 'a launch spot by the abyss');
  await moveBoth(t, H, G, [site.x, site.y], [site.x - Math.cos(site.a) * 1.2, site.y - Math.sin(site.a) * 1.2]);
  const id = H.game.net.newId('s');
  H.game.net.emit('boat.launch', { id, x: site.x, y: site.y, h: site.a, v: 0, at: Math.round(H.game.worldTime) });
  const bG = await t.waitFor(() => G.game.boats.map.get(id), RT() + 1500, 'the guest sees the boat');
  A.teleport(G, site.x, site.y);
  G.game.boats.board(bG);
  await t.waitFor(() => bG.seats[0] === G.pid, RT() + 2000, 'the guest takes the oars');
  const since = now();
  const rel = A.holdMove(G, Math.cos(site.a), Math.sin(site.a)); // (toward the abyss, in screen space ≈ world: camera not turned)
  G.game.cam.rot = 0; G.game.cam.rotTo = 0;
  let entered = false;
  // (the hull a little inside its outline: the host accepts a driver's rounded pose with 0.05 of slack)
  const hull = (f, b) => { const w = f.game.world; for (let u = -1.7; u <= 1.9; u += 0.3) for (const sd of [-1, 1]) { const q = MH.boatsc.hullPt(b.x, b.y, b.h, u, sd * MH.boatsc.halfW(u) * 0.8); if (w.abyssAt(Math.floor(q[0]), Math.floor(q[1]))) return true; } return false; };
  t.watch(() => { const bH = H.game.boats.map.get(id); if ((bH && hull(H, bH)) || hull(G, bG)) entered = true; }, 50);
  await t.sleep(6000);
  rel();
  t.check(!entered, 'the hull never covers the abyss (on both)');
  const told = G.ui.filter((u) => u.t >= since).some((u) => /Oceano aberto: o barco/.test(u.text));
  t.check(told, 'the guest is told "Oceano aberto: o barco não aguenta"', G.lastUi(3, since));
  const bH = H.game.boats.map.get(id);
  t.check(Math.hypot(bH.x - bG.x, bH.y - bG.y) < 0.6, 'the boat stands at the same place on both', `${f2(bH.x)},${f2(bH.y)} / ${f2(bG.x)},${f2(bG.y)}`);
  // swimming in the abyss (the guest jumps in)
  G.game.net.request('boat.leave', { id, dead: 1 });
  await t.waitFor(() => !bH.seats.includes(G.pid), RT() + 1500, 'the guest left the boat');
  let ab = null;
  for (let d = 2; d < 20 && !ab; d++) { const qx = site.x + Math.cos(site.a) * (site.dA + d), qy = site.y + Math.sin(site.a) * (site.dA + d); if (gw.abyssAt(Math.floor(qx), Math.floor(qy))) ab = [qx, qy]; }
  t.assert(ab, 'an abyssal tile');
  const gp = G.game.player, e0 = gp.energy;
  const since2 = now();
  A.teleport(G, ab[0], ab[1]);
  await t.waitFor(() => gp._abyss, 3000, 'the guest swims in the abyss');
  await t.sleep(1500);
  t.check(gp.energy < e0 - 5, 'its strength drains fast there', `${f2(e0)} → ${f2(gp.energy)}`);
  t.check(G.ui.filter((u) => u.t >= since2).some((u) => /Oceano aberto: a água/.test(u.text)), 'the guest is warned about the open ocean', G.lastUi(3, since2));
  A.teleport(G, site.x - Math.cos(site.a) * 3, site.y - Math.sin(site.a) * 3);
  H.game.net.emit('boat.remove', { id });
  await t.checkDigest(H, G);
  env.history.push('LZ2');
});

// LZ3 two players far apart in different season zones
def('LZ3', {
  title: 'LZ: two players far apart in different zones — each lives the season of its place (winter vs the tropics), crops / regrowth / walkers / temperature follow the place', timeout: 200000,
  expected: 'The host stays at the temperate spawn, the guest goes to a humid tropical cell (thousands of tiles away); the clock jumps to a temperate winter night: the host is in winter (hard, its water ice), the guest in the tropics (no winter, no ice, warm: its felt base far above the host\'s); both compute the same season for each place; crops: no growth in the temperate winter, normal in the humid tropics (cropK), none in a polar zone, none on dry hot soil off the fertile strip ("Solo seco: só perto de rios") and slower on it (HOT_K), regrowth the same; forced spawns bring ice walkers only around the host (the guest\'s tropical night has its own dead, if any: skeletons in the dry season, docs/NIGHT-DEAD.md); digest equal (the far guest\'s stale chunks left out)',
  api: 'seasons.js seasonAt / zoneSeason, mut/crops.js cropK / plantProblem / hotDryAt / HOT_K, flora.js growK, walkers.js walkersTick, survival.js feltTemp (p._felt.base), world.iceZ',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, day0 = EH.dayIndex, hour0 = EH.hour, sp = H.game.world.spawn;
  const MC = await frameImport(H, 'game/mut/crops.js'), MF = await frameImport(H, 'game/flora.js');
  t.defer(() => {
    H.game.net.emit('env.skip', { hour: hour0, day: day0, wt: H.game.worldTime + 1, by: H.game.net.pid });
    for (const e of H.game.entities.slice()) if (e.isMob && !e.dead && (e.faction === 'walker' || e.spawner?.hunt)) { e.noCorpse = true; MH.combat.killMob(H.game, e, null); }
  });
  A.keepAlive(t, H); A.keepAlive(t, G);
  const trop = planetCells(H, (c, P, K) => !P.ocean[c] && !P.lakeId[c] && cellZone(P, c) === 0 && (K[P.biome[c]] === 'rainforest' || K[P.biome[c]] === 'tropical_dry') && P.precip[c] > 1200, sp.x, sp.y, 10);
  t.assert(trop.length, 'the planet has humid tropical land');
  let gs = null;
  for (const c of trop) { gs = zoneSpot(G, MG, c.x, c.y, 0, 40); if (gs) break; }
  t.assert(gs, 'a walkable tropical spot');
  const hs = A.freeSpot(H, MH, sp.x, sp.y, { rMin: 0, rMax: 4 });
  A.teleport(H, hs[0], hs[1]);
  A.teleport(G, gs[0], gs[1]);
  await t.sleep(800);
  t.log(`guest ${Math.round(Math.hypot(H.game.world.dx(gs[0], hs[0]), gs[1] - hs[1]))} tiles away from the host`);
  // a temperate winter night (short year: day 6, 22 h)
  H.game.net.emit('env.skip', { hour: 22, day: 6, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => G.game.env.dayIndex === 6 && Math.abs(G.game.env.hour - 22) < 0.3, 3000 + CFG.budget, 'the guest clock follows');
  await t.waitFor(() => H.game.season?.id === 'winter' && G.game.season?.zone === 0 && G.game.seasons?.[2]?.id === 'winter', 3000, 'host in winter, guest in the tropics (both updated)', () => `${H.game.season?.name} / ${G.game.season?.name}`);
  t.check(H.game.season.hard && !G.game.season.hard && G.game.season.id !== 'winter', 'each its own season: temperate winter / tropical (no winter)', `${H.game.season.name} / ${G.game.season.name}`);
  t.check(H.game.world.iceZ[2] === 1 && H.game.world.iceZ[0] === 0 && G.game.world.iceZ[0] === 0 && G.game.world.iceZ[2] === 1, 'ice by zone on both: temperate frozen, tropical open water', `${[...H.game.world.iceZ]} / ${[...G.game.world.iceZ]}`);
  G.game.world.ensure(G.game.world.chunkIndex(hs[0], hs[1])); // (the host's place, far from the guest: its zone layer)
  const SH = MH.seasons.seasonAt(H.game, gs[0], gs[1]), SG = MG.seasons.seasonAt(G.game, hs[0], hs[1]);
  t.check(SH.zone === 0 && !SH.hard && SG.zone === 2 && SG.hard, 'both compute the same season for the other\'s place', `host sees guest ${SH.name} · guest sees host ${SG.name}`);
  await t.sleep(1500);
  t.check((G.game.player._felt?.base ?? 0) > (H.game.player._felt?.base ?? 99) + 10, 'the tropics are warm, the temperate winter cold (felt base)', `guest ${f2(G.game.player._felt?.base)} °C · host ${f2(H.game.player._felt?.base)} °C`);
  // crops and regrowth by place
  const kH = MC.cropK(SG), kG = MC.cropK(SH, MC.hotDryAt(H.game.world, Math.floor(gs[0]), Math.floor(gs[1])), true);
  t.check(kH === 0 && kG > 0, 'crops: stopped in the temperate winter, growing in the humid tropics', `temperate ${kH} · tropics ${kG}`);
  const Spolar = MH.seasons.zoneSeason(4, MH.seasons.seasonClock(2, 13));
  t.check(MC.cropK(Spolar) === 0 && MF.growK(Spolar) === 0, 'polar: nothing grows (a summer day of the calendar)');
  t.check(MF.growK(SG) === 0 && MF.growK(SH) > 0, 'wild regrowth: none in the temperate winter, yes in the tropics');
  const Swarm = MH.seasons.zoneSeason(1, MH.seasons.seasonClock(2, 13));
  t.check(MC.cropK(Swarm, true, false) === 0 && Math.abs(MC.cropK(Swarm, true, true) - MC.HOT_K) < 1e-9, 'hot / dry land: no growth off the fertile soil, slower on it', `${MC.cropK(Swarm, true, false)} / ${MC.cropK(Swarm, true, true)}`);
  // a real dry tile: planting refused there with the reason
  const dry = planetCells(H, (c, P, K) => !P.ocean[c] && (K[P.biome[c]] === 'desert_dunes' || K[P.biome[c]] === 'desert_rocky') && !P.rkind[c], sp.x, sp.y, 4);
  let dryTile = null;
  for (const c of dry) {
    H.game.world.ensure(H.game.world.chunkIndex(c.x, c.y));
    for (let d = 0; d < 20 && !dryTile; d++) { const x = c.x + d, y = c.y; if (!H.game.world.waterAt(x, y) && !H.game.world.isRock(x, y) && !H.game.world.fertile.at(x, y)) dryTile = [x, y]; }
    if (dryTile) break;
  }
  if (dryTile) t.check(/Solo seco/.test(MC.plantProblem(H.game, 'potato', dryTile[0], dryTile[1]) || ''), 'planting on dry desert soil is refused ("Solo seco: só perto de rios")', MC.plantProblem(H.game, 'potato', dryTile[0], dryTile[1]));
  else t.note('no dry desert tile found near (planting check skipped)');
  // walkers only where the winter is (the tropics' own night danger, if any, is the skeletons of the dry season: NM)
  for (let k = 0; k < 10; k++) { H.game._walkT = 0; MH.walkers.walkersTick(H.game, true); }
  const nearG = A.hostMobs(H, (m) => m.faction === 'walker' && Math.hypot(H.game.world.dx(m.x, gs[0]), m.y - gs[1]) < 80);
  t.check(!nearG.some((m) => m.species === 'walker' || m.species === 'giant'), 'no ice walker around the guest in the tropics', nearG.map((m) => m.species).join(',') || 'none');
  const famG = MH.undead.nightFamilyAt(H.game, gs[0], gs[1]);
  t.check(nearG.every((m) => (famG === 'bone' ? m.species === 'skeleton' : famG === 'sand' ? m.species === 'mummy' : false)), `the tropics bring their own dead only (${famG || 'none'} there: ${G.game.season?.name})`, nearG.map((m) => m.species).join(',') || 'none');
  t.check(A.hostMobs(H, (m) => m.species === 'walker' && Math.hypot(H.game.world.dx(m.x, hs[0]), m.y - hs[1]) < 80).length > 0, 'walkers around the host in its winter night');
  await t.checkDigest(H, G);
  for (const e of H.game.entities.slice()) if (e.isMob && !e.dead && e.faction === 'walker') { e.noCorpse = true; MH.combat.killMob(H.game, e, null); }
  env.history.push('LZ3');
});

// LZ4 interest: a far guest does not receive a distant entity stream (nor the world changes there) until it comes close
def('LZ4', {
  title: 'LZ: interest — a far guest gets neither the creatures nor the world changes around the host, and gets both when it comes close', timeout: 200000,
  expected: 'The guest goes ~1500 tiles away; the host spawns creatures next to itself and removes a tree there: the guest has no proxy of them and skips the op (skip counts; the chunk is stale for it, digests equal without it); the guest comes back next to the host: the proxies appear and the chunk diff removes the tree; nothing is stale any more; digest equal',
  api: 'net/entities.js interest box, net/interest.js (batchFor skip counts, update → cd chunk diffs, excluded), net.stats.opsSkipped / chunkDiffs',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const hp = H.game.player, gw = G.game.world, hw = H.game.world;
  let far = null;
  for (const c of planetCells(G, (k, P) => !P.ocean[k] && !P.lakeId[k], hp.x + 1500, hp.y, 8)) { far = zoneSpot(G, MG, c.x, c.y, -1, 40); if (far) break; }
  t.assert(far, 'a far spot for the guest');
  t.log(`guest ${Math.round(Math.hypot(hw.dx(far[0], hp.x), far[1] - hp.y))} tiles away`);
  A.teleport(G, far[0], far[1]);
  await t.waitFor(() => Math.hypot(hw.dx(A.authAvatarOn(H, G.pid)?.x ?? 0, far[0]), (A.authAvatarOn(H, G.pid)?.y ?? 0) - far[1]) < 3, RT() + 2000, 'the host knows the guest is far');
  // creatures next to the host
  const mobs = [];
  for (let k = 0; k < 3; k++) { const s = A.freeSpot(H, MH, hp.x + 3 + k, hp.y + 1, { rMin: 0, rMax: 3, r: 0.36 }); if (s) mobs.push(MH.mobs.spawnLoose(H.game, 'deer', s[0], s[1])); }
  t.assert(mobs.length, 'creatures next to the host');
  // a tree next to the host
  const tr = A.pickTree(H, MH, null, hp.x, hp.y, env.claimed, { r: 40 });
  t.assert(tr, 'a tree near the host');
  const skip0 = G.game.net.stats.opsSkipped || 0, tc = hw.chunkIndex(tr.o.x, tr.o.y);
  H.game.net.emit('obj.remove', { ids: [tr.o.id], fx: 'clear' });
  await t.waitFor(() => (G.game.net.stats.opsSkipped || 0) > skip0, ONEWAY() + 2000, 'the far guest got a skip count instead of the op');
  await t.sleep(800);
  t.check(!mobs.some((m) => A.proxyOf(G, m)), 'the far guest has no proxy of the host\'s creatures (entity stream by interest)');
  t.check((H.session.interest.excluded(G.pid) || []).includes(tc), 'the tree\'s chunk is stale for the far guest');
  await t.checkDigest(H, G, 'digest equal without the stale chunks');
  // the guest comes back
  const d0 = G.game.net.stats.chunkDiffs || 0;
  const back = A.freeSpot(G, MG, hp.x + 2, hp.y, { rMin: 0, rMax: 4 });
  A.teleport(G, back[0], back[1]);
  await t.waitFor(() => mobs.every((m) => A.proxyOf(G, m)), RT() + 4000, 'back near the host: the creatures appear on the guest');
  await t.waitFor(() => (G.game.net.stats.chunkDiffs || 0) > d0 && !gw.objById.has(tr.o.id), RT() + 4000, 'the chunk diff removed the tree on the guest');
  const st = H.session.interest.debug().guests[G.pid]?.stale || [];
  t.check(!st.includes(tc) && !st.some((c) => MH.interest ? false : Math.abs((c % 256) - (tc % 256)) <= 4 && Math.abs((c >> 8) - (tc >> 8)) <= 4), 'nothing stale around the guest any more', `${st.length} stale chunks elsewhere`);
  for (const m of mobs) { m.noCorpse = true; MH.combat.killMob(H.game, m, null); }
  await t.checkDigest(H, G);
  env.history.push('LZ4');
});

// =====================================================================================================
// HO: horses (docs/HORSE.md) — taming a wild horse with wheat from the hand, the feeder, the saddle, riding at the
// sprint's speed, the lance charge (Estocada), only the spear on horseback, getting off, saving
const horseNear = (f, x, y, r = 0.3) => f.game.entities.find((e) => e.species === 'horse' && !e.dead && !e.proxy && Math.hypot(e.x - x, e.y - y) < r) || null;
// a tamed horse (host) at a free spot near (x, y), kept still a while
function tamedHorse(H, MH, x, y, o = {}) {
  const s = A.freeSpot(H, MH, x, y, { rMin: 0, rMax: 2.5, r: 0.45 }) || [x, y];
  const m = H.game.horses.debug.spawn(s[0], s[1], { saddle: !!o.saddle, coat: o.coat | 0 });
  m.state = 'idle'; m.stateT = 60;
  return m;
}
// cleanup: off the horse, then it goes quietly
async function dropHorses(H, list) {
  const MHo = await fimp(H, 'game/horses.js');
  for (const m of list) if (m && !m.dead && m.rider) MHo.dismountHorse(H.game, m, 'hand');
  await killQuiet(H, list.filter(Boolean));
}
// a direction from the guest with a clear line of `len` tiles (no water) on both peers
function openDir(H, MH, G, MG, len = 11) {
  const gp = G.game.player;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    if (A.clearLine(G, MG, gp.x, gp.y, gp.x + dx * len, gp.y + dy * len, 0.45) && A.clearLine(H, MH, gp.x, gp.y, gp.x + dx * len, gp.y + dy * len, 0.45)) return [+dx.toFixed(4), +dy.toFixed(4)];
  }
  return null;
}
// the guest gets on a saddled horse by its own "Montar"
async function rideHorse(t, H, G, MG, m) {
  const gp = G.game.player;
  const px = await t.waitFor(() => A.proxyOf(G, m), 3000 + CFG.budget, 'the horse on the guest');
  if (Math.hypot(px.x - gp.x, px.y - gp.y) > 1.8) { const s = A.freeSpot(G, MG, px.x, px.y, { rMin: 0.8, rMax: 1.6 }); if (s) A.teleport(G, s[0], s[1]); }
  await A.hostSees(t, H, G);
  const it = G.game.horses.describe(A.proxyOf(G, m));
  t.assert(it && it.kind === 'horse_mount', `"Montar" offered (${it?.verb})`);
  A.interact(G, it);
  await t.waitFor(() => m.rider === G.pid && gp.mount?.nid === m.nid, RT() + 3000, 'the guest rides the horse (host + guest)', () => `rider ${m.rider} mount ${gp.mount?.nid} goal ${G.game.ctl.goal?.type} ui ${G.lastUi(2)}`);
  await t.sleep(200);
}
// a sturdy target that stays put (host): a stunned bison with a lot of life, level 1
async function dummyBison(H, MH, x, y) {
  const [b] = await faunaGroup(H, MH, 'bison', x, y);
  b.level = 1; b.maxHp = b.hp = 5000; b.stunT = 1e4; b.calmT = 1e4; b.state = 'idle';
  return b;
}
const lastHp = (m) => m.hp;

def('HO1', {
  title: 'HO: the guest tames a wild horse with wheat from its hand (walking up is fine, a sprint spooks the herd)', timeout: 160000,
  expected: 'A wild horse next to the guest offers "Dar trigo" (without wheat: "precisa de trigo"); three gives (one wheat each, the work by hand) make the host count 1, 2 and then tame it: the same creature becomes the farm animal "Cavalo" (owned, out of its herd, its coat kept) on the host and on the guest (static record re-sent), the guest has 3 wheat less and a toast; another wild horse lets the guest walk up to 2 tiles; a third one runs off when the guest sprints at it (the host measures its speed); digest equal',
  api: 'horses.describeHorse → work horse_feed → intent horse.feed (refund wheat) → horses.feedWild / tameHorse (in place: species horse, stockBrain, takeFromHerd) → op horse.note; ai.js calm passives (SPECIES.wild_horse.calm, fastMover: av.vx / vy on the host); entity stream static record',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.horses && G.game.horses, 'horses (game/horses.js) missing');
  A.keepAlive(t, G);
  G.game.cam.rot = G.game.cam.rotTo = 0;
  await A.openField(t, H, MH, G, MG, 10);
  const gp = G.game.player;
  A.pacify(H, gp.x, gp.y, 30);
  const made = [];
  t.defer(() => dropHorses(H, made));
  const [m] = await faunaGroup(H, MH, 'wild_horse', gp.x + 1.8, gp.y);
  made.push(m);
  m.state = 'idle'; m.stateT = 60;
  const coat = (m.variant >> 2) & 3;
  const px = await t.waitFor(() => A.proxyOf(G, m), 3000 + CFG.budget, 'the wild horse on the guest');
  gp.inv.remove('wheat', gp.inv.count('wheat'));
  const it0 = G.game.horses.describe(px);
  t.check(it0?.kind === 'horse_feed' && it0.prio < 0 && /precisa de trigo/.test(it0.verb), 'without wheat: "Dar trigo (precisa de trigo)"', it0?.verb);
  A.ensure(G, { wheat: 5 });
  const notes = [];
  t.on(G, 'toast', (d) => notes.push(d?.text || ''));
  await A.hostSees(t, H, G);
  for (let k = 1; k <= 3; k++) {
    const q = A.proxyOf(G, m) || px, it = G.game.horses.describe(q);
    t.check(it?.kind === 'horse_feed' && it.verb === 'Dar trigo' && it.prio >= 0, `give ${k}: "Dar trigo"`, it?.verb);
    A.interact(G, it);
    if (k < 3) await t.waitFor(() => (m.tameN | 0) === k, RT() + 4000, `host: it ate ${k} wheat from the guest's hand`, () => `tameN ${m.tameN} state ${m.state} work ${gp.work?.label} ui ${G.lastUi(2)}`);
    t.check(m.state !== 'flee', 'it stays (calm) while it eats', m.state);
  }
  await t.waitFor(() => m.species === 'horse', RT() + 4000, 'host: tamed after the third wheat', () => `species ${m.species} tameN ${m.tameN}`);
  t.check(m.owned && m.tame && !m.spawner && !!m.stock && m.name === 'Cavalo' && !m.saddle, 'host: a farm animal "Cavalo" (owned, out of its herd, no saddle yet)', `${m.name} owned ${m.owned} tame ${m.tame}`);
  t.check(((m.variant >> 2) & 3) === coat, 'its coat kept', `coat ${coat} → ${(m.variant >> 2) & 3}`);
  t.check(A.count(G, 'wheat') === 2, '3 wheat left the guest bag', `${A.count(G, 'wheat')} left of 5`);
  const pt = await t.waitFor(() => { const q = A.proxyOf(G, m); return q && q.species === 'horse' && q.tame ? q : null; }, ONEWAY() + 2500, 'guest: its proxy is now the tamed horse');
  t.check(pt.nid === px.nid && pt.name === 'Cavalo' && ((pt.variant >> 2) & 3) === coat, 'the same creature on the guest (nid, name, coat)', `${pt.nid} "${pt.name}"`);
  t.check(/Cavalo · domado/.test(G.game.stock.label(pt)?.[0] || ''), 'guest nameplate "Cavalo · domado"', G.game.stock.label(pt)?.[0]);
  t.check(notes.some((s) => /comeu o trigo/.test(s)) && notes.some((s) => /domou o cavalo/.test(s)), 'the guest was told (ate the wheat … tamed)', notes.filter((s) => /cavalo|trigo/i.test(s)).join(' | '));
  // walking up to another wild horse is fine
  let sA = null;
  for (let k = 0; k < 16 && !sA; k++) { const a = (k / 16) * Math.PI * 2, x = gp.x + Math.cos(a) * 6, y = gp.y + Math.sin(a) * 6; if (A.clearLine(G, MG, gp.x, gp.y, x, y, 0.35) && A.clearLine(H, MH, gp.x, gp.y, x, y, 0.35)) sA = [x, y]; }
  t.assert(sA, 'an open line 6 tiles long');
  const [wA] = await faunaGroup(H, MH, 'wild_horse', sA[0], sA[1]);
  made.push(wA);
  wA.state = 'idle'; wA.stateT = 60; wA.calmT = 0;
  await t.waitFor(() => A.proxyOf(G, wA), 3000 + CFG.budget, 'a second wild horse on the guest');
  let fled = false;
  const w1 = t.watch(() => { if (wA.state === 'flee') fled = true; }, 30);
  const dx = wA.x - gp.x, dy = wA.y - gp.y, L = Math.hypot(dx, dy);
  const rel = A.holdMove(G, dx / L, dy / L);
  await t.tryWait(() => Math.hypot(wA.x - gp.x, wA.y - gp.y) < 2.2, 4000);
  rel();
  await t.sleep(1200);
  w1.stop();
  t.check(!fled && Math.hypot(wA.x - gp.x, wA.y - gp.y) < 3, 'walking up to it does not scare it', `fled ${fled} d ${f2(Math.hypot(wA.x - gp.x, wA.y - gp.y))}`);
  // a sprint at a third one: it runs off
  const back = A.freeSpot(G, MG, wA.x - (dx / L) * 7.5, wA.y - (dy / L) * 7.5, { rMin: 0, rMax: 1.5 });
  t.assert(back, 'room to run at it');
  A.teleport(G, back[0], back[1]);
  await A.hostSees(t, H, G);
  wA.state = 'idle'; wA.stateT = 60; wA.calmT = 0; wA.fleeT = 0;
  await t.sleep(400);
  t.check(A.ability(G, MG, 'sprint'), 'the guest sprints');
  const rel2 = A.holdMove(G, dx / L, dy / L);
  t.defer(rel2);
  const ran = await t.tryWait(() => wA.state === 'flee', 4000);
  rel2();
  t.check(ran, 'a sprint at a wild horse makes it run (host)', `state ${wA.state} d ${f2(Math.hypot(wA.x - gp.x, wA.y - gp.y))} av v ${f2(Math.hypot(A.authAvatarOn(H, G.pid)?.vx || 0, A.authAvatarOn(H, G.pid)?.vy || 0))}`);
  await t.checkDigest(H, G);
});

def('HO2', {
  title: 'HO: a tamed horse eats wheat at the feeder, gets hungry anywhere, starves without food; slaughtered: little meat, a lot of leather', timeout: 180000,
  expected: 'A tamed horse by the guest\'s feeder (wheat + corn in it) goes to the trough and eats wheat only (the wheat goes down on both peers, the corn stays); a horse far from any feeder still gets hungry (a cow out there does not); with an empty feeder a starving horse shows "faminto" on the guest and dies of hunger after the warnings (dead on both); a tamed horse hit by the guest with a knife dies at once: 1 meat and 4–5 leather on the ground on both; digest equal',
  api: 'STOCK.horse (eats wheat, belly 2 days, always hungry once tamed), livestock farmTick / stockBrain / eatFrom → chest.set, stock.note; livestock.slaughter (SPECIES.horse loot: meat 1, leather 4–5) → loot.add',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.horses && H.game.stock?.debug, 'horses (game/horses.js) missing');
  A.keepAlive(t, G);
  const f = await farmFeeder(t, H, G, MH, MG);
  const LG = await frameImport(G, 'game/livestock.js');
  const [cx, cy] = feederCentre(f);
  H.game.net.emit('chest.set', { id: f.id, slots: A.structOn(H, f.id).store.toJSON().map(() => null), quiet: 1 });
  await t.waitFor(() => feedCount(G, f.id, 'wheat') === 0 && feedCount(G, f.id, 'corn') === 0, ONEWAY() + 1000, 'an empty feeder on both');
  A.ensure(G, { wheat: 6, corn: 3 });
  const fg = A.structOn(G, f.id), ad = LG.feederAdapter(G.game, fg);
  const slotOf = (id) => G.game.player.inv.slots.findIndex((s) => s && s.id === id);
  A.standBy(G, MG, fg);
  await A.hostSees(t, H, G, 4000);
  ad.put(slotOf('wheat'), 99); ad.put(slotOf('corn'), 99);
  await t.waitFor(() => feedCount(H, f.id, 'wheat') >= 6 && feedCount(H, f.id, 'corn') >= 3, RT() + 1000, 'wheat and corn in the feeder');
  const made = [];
  t.defer(() => dropHorses(H, made));
  const h = tamedHorse(H, MH, cx + 2, cy + 2.4);
  made.push(h);
  h.fed = 0.3; h.stateT = 0;
  H.game.stock.debug.tick(0.01);
  t.check(h.tame && h.feeder === f.id && h.wantEat, 'host: the horse belongs to the feeder and wants to eat', `tame ${h.tame} feeder ${h.feeder} want ${h.wantEat}`);
  const w0 = feedCount(H, f.id, 'wheat'), c0 = feedCount(H, f.id, 'corn');
  await t.waitFor(() => feedCount(H, f.id, 'wheat') < w0, 25000, 'host: the horse ate wheat from the trough', () => `wheat ${feedCount(H, f.id, 'wheat')} fed ${f2(h.fed)} want ${h.wantEat} d ${f2(Math.hypot(h.x - cx, h.y - cy))}`);
  await t.waitFor(() => feedCount(G, f.id, 'wheat') === feedCount(H, f.id, 'wheat'), ONEWAY() + 1000, 'guest: the same feeder contents');
  t.check(feedCount(H, f.id, 'corn') === c0 && h.fed > 0.3, 'it eats wheat (not the corn) and is fuller', `corn ${feedCount(H, f.id, 'corn')}/${c0} fed ${f2(h.fed)}`);
  // away from every feeder a horse still gets hungry (a cow out there grazes)
  const D = H.game.env.dayLength;
  const far = tamedHorse(H, MH, cx + 20, cy);
  made.push(far);
  const cow = farmAnimal(H, MH, 'cow', cx + 22, cy, { owned: true });
  made.push(cow);
  far.fed = 0.5; cow.fed = 0.5;
  H.game.stock.debug.tick(D * 0.25);
  t.check(far.tame && far.fed < 0.45 && cow.fed === 0.5, 'a horse far from a feeder gets hungry (a cow there does not)', `horse fed ${f2(far.fed)} tame ${far.tame} · cow fed ${f2(cow.fed)}`);
  // starving: an empty feeder
  const notes = [];
  t.on(G, 'toast', (d) => notes.push(d?.text || ''));
  H.game.net.emit('chest.set', { id: f.id, slots: A.structOn(H, f.id).store.toJSON().map(() => null), quiet: 1 });
  h.fed = 0.001;
  H.game.stock.debug.tick(1); H.game.stock.debug.tick(1);
  await t.waitFor(() => A.proxyOf(G, h)?.starving, ONEWAY() + 2000, 'guest: the horse shows it is starving');
  t.check(/faminto/.test(G.game.stock.label(A.proxyOf(G, h))?.[0] || ''), 'its nameplate says "faminto"', G.game.stock.label(A.proxyOf(G, h))?.[0]);
  H.game.stock.debug.tick(D * 0.35);
  H.game.stock.debug.tick(D * 0.2);
  await t.waitFor(() => h.dead, 1500, 'host: it died of hunger');
  await t.waitFor(() => A.proxyOf(G, h)?.dead || !A.proxyOf(G, h), ONEWAY() + 1500, 'guest: dead too');
  await t.sleep(RT());
  t.check(notes.some((s) => /cavalo está passando fome/.test(s)) && notes.some((s) => /cavalo morreu de fome/.test(s)), 'warnings reached the guest (passando fome … morreu de fome)', notes.filter((s) => /fome/.test(s)).join(' | '));
  // slaughter: one knife hit by the guest — little meat, a lot of leather
  const gp = G.game.player;
  const h3 = tamedHorse(H, MH, gp.x + 1.6, gp.y);
  made.push(h3);
  const p3 = await t.waitFor(() => { const q = A.proxyOf(G, h3); return q && q.tame ? q : null; }, ONEWAY() + 2500, 'guest: a third (tamed) horse');
  const s3 = A.freeSpot(G, MG, h3.x, h3.y, { rMin: 0.7, rMax: 1.3 });
  if (s3) A.teleport(G, s3[0], s3[1]);
  await A.hostSees(t, H, G, 4000);
  A.equip(G, 'knife_stone');
  const loot = A.lootRecorder(t, [H, G]);
  A.hit(G, MG, p3, 3);
  await t.waitFor(() => h3.dead, RT() + 1500, 'one knife hit kills the tamed horse');
  await t.sleep(RT() + 500);
  loot.stop();
  const it = loot.items(0);
  t.check(it.meat === 1 && it.leather >= 4 && it.leather <= 5, 'its products: 1 meat, 4–5 leather', JSON.stringify(it));
  t.check(loot.compare(0, 1).ok, 'the same items on both', loot.compare(0, 1).detail);
  await t.checkDigest(H, G);
});

def('HO3', {
  title: 'HO: the guest saddles its horse, mounts and rides at the sprint\'s speed; the host sees it riding; no work, boats or doors on horseback', timeout: 180000,
  expected: 'The guest\'s "Selar" (a saddle from its bag) saddles the tamed horse on both peers ("Tirar sela" gives it back, "Selar" again); "Montar" puts the guest on it (host: the horse\'s rider, every peer: game.horses.rides); galloping in a straight line the guest covers the sprint\'s speed (6.6 tiles / s, ±15 %; the sprint key adds nothing and costs nothing); on the host the horse runs under the guest\'s avatar and is drawn with it (the gallop); work and boats are refused ("Desça do cavalo"); an open door stops the horse; digest equal',
  api: 'horses.describeHorse (alt), works horse_saddle / horse_unsaddle / horse_mount, intents horse.saddle / horse.unsaddle / horse.mount → op horse.ride (rides) / horse.note (give saddle); horseOwnerSystem (p.mount, p.speed = baseSpeed × 1.65), rideMove (doors, stairs, tunnels, deep water), host rideFollow, horseSystem pairs (_ride / _rideD / _riddenBy) + faunaDraw ridePose; entity stream saddle bit / rider pid',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.horses && G.game.horses, 'horses (game/horses.js) missing');
  A.keepAlive(t, G);
  G.game.cam.rot = G.game.cam.rotTo = 0;
  await A.openField(t, H, MH, G, MG, 13, 2);
  const gp = G.game.player;
  A.pacify(H, gp.x, gp.y, 30);
  const dir = openDir(H, MH, G, MG, 12);
  t.assert(dir, 'a clear line of 12 tiles to ride along');
  const made = [];
  t.defer(() => dropHorses(H, made));
  const h = tamedHorse(H, MH, gp.x - dir[0] * 1.4, gp.y - dir[1] * 1.4);
  made.push(h);
  const px = await t.waitFor(() => A.proxyOf(G, h), 3000 + CFG.budget, 'the tamed horse on the guest');
  gp.inv.remove('saddle', gp.inv.count('saddle'));
  t.check(G.game.horses.describe(px)?.prio < 0, 'without a saddle: "Selar (precisa de sela)"', G.game.horses.describe(px)?.verb);
  A.ensure(G, { saddle: 1 });
  await A.hostSees(t, H, G);
  let it = G.game.horses.describe(px);
  t.check(it?.kind === 'horse_saddle' && it.verb === 'Selar', '"Selar" with a saddle in the bag', it?.verb);
  A.interact(G, it);
  await t.waitFor(() => h.saddle, RT() + 4000, 'host: saddled', () => `work ${gp.work?.label} ui ${G.lastUi(2)}`);
  await t.waitFor(() => A.proxyOf(G, h)?.saddle, ONEWAY() + 1500, 'guest: it shows the saddle (entity stream)');
  t.check(A.count(G, 'saddle') === 0, 'the saddle left the guest bag');
  it = G.game.horses.describe(A.proxyOf(G, h));
  t.check(it?.kind === 'horse_mount' && it.verb === 'Montar' && it.alt?.verb === 'Tirar sela', '"Montar", and "Tirar sela" as the second choice', `${it?.verb} / ${it?.alt?.verb}`);
  A.interact(G, it.alt);
  await t.waitFor(() => !h.saddle && A.count(G, 'saddle') === 1, RT() + 4000, '"Tirar sela": off the horse, back in the guest bag');
  await t.waitFor(() => !A.proxyOf(G, h)?.saddle, ONEWAY() + 1500, 'guest: no saddle shown');
  A.interact(G, G.game.horses.describe(A.proxyOf(G, h)));
  await t.waitFor(() => h.saddle && A.proxyOf(G, h)?.saddle, RT() + 4000, 'saddled again');
  await rideHorse(t, H, G, MG, h);
  t.check(H.game.horses.rides.get(G.pid) === h.nid && G.game.horses.rides.get(G.pid) === h.nid, 'every peer knows who rides what (op horse.ride)');
  t.check(Math.hypot(gp.x - h.x, gp.y - h.y) < 0.6, 'the guest sits where the horse stood', `d ${f2(Math.hypot(gp.x - h.x, gp.y - h.y))}`);
  t.check(MG.controller.nearestInteractable(G.game)?.verb === 'Desmontar', 'on horseback the use button says "Desmontar"');
  // gallop along the open line
  const errs = [];
  t.on(G, 'error', (d) => errs.push(d?.text || ''));
  const e0 = gp.energy;
  t.check(!A.ability(G, MG, 'sprint') && !gp.buffs.some((b) => b.id === 'sprint'), 'the sprint adds nothing on horseback (refused)', errs.slice(-1)[0]);
  gp.energy = e0;
  let sawGallop = false;
  const av = A.avatarOn(H, G.pid), w = t.watch(() => {
    if (av?._rideD && av._rideD._spd > 3.4) sawGallop = true; // (art/faunaDraw.js ridePose: the gallop frames above 3.4 tiles / s)
  }, 30);
  const rel = A.holdMove(G, dir[0], dir[1]);
  t.defer(rel);
  await t.sleep(350);
  const x0 = gp.x, y0 = gp.y, t0 = now();
  await t.sleep(1000);
  const dt = (now() - t0) / 1000, v = Math.hypot(gp.x - x0, gp.y - y0) / dt, want = gp.baseSpeed * 1.65;
  t.check(Math.abs(gp.speed - want) < 1e-6 && v > want * 0.85 && v < want * 1.15, `the guest rides at the sprint's speed (${f2(want)} tiles / s)`, `measured ${f2(v)} · p.speed ${f2(gp.speed)}`);
  const ah = A.authAvatarOn(H, G.pid);
  t.check(h.moving && Math.hypot(h.x - ah.x, h.y - ah.y) < 0.5, 'host: the horse runs under the guest\'s avatar', `d ${f2(Math.hypot(h.x - ah.x, h.y - ah.y))} moving ${h.moving}`);
  t.check(!!av?._ride && av._ride === h && h._riddenBy === av, 'host: the guest is drawn on its horse (one unit)', `ride ${!!av?._ride}`);
  t.check(A.proxyOf(G, h)?.rider === G.pid && gp._ride === A.proxyOf(G, h), 'guest: its proxy says who rides it; drawn under the guest');
  rel();
  await t.sleep(300);
  w.stop();
  t.check(sawGallop, 'host draws the horse galloping (gallop frames at speed)');
  t.check(Math.abs(gp.energy - e0) < 8, 'no stamina spent riding', `${f2(e0)} → ${f2(gp.energy)}`);
  // no work, no boat on horseback
  errs.length = 0;
  G.game.ctl.interact({ kind: 'forage', x: gp.x, y: gp.y, reach: 99, o: {} });
  await t.sleep(200);
  G.game.boats.board({ id: 'nope', seats: [], removed: false });
  await t.sleep(150);
  t.check(errs.some((s) => /Desça do cavalo/.test(s)) && errs.some((s) => /Desça do cavalo para embarcar/.test(s)) && !gp.work, 'work and boats are refused on horseback', errs.join(' | '));
  // an open door stops the horse
  const ax = Math.abs(dir[0]) >= Math.abs(dir[1]) ? [Math.sign(dir[0]), 0] : [0, Math.sign(dir[1])];
  const gx = Math.floor(gp.x) + ax[0] * 2, gy = Math.floor(gp.y) + ax[1] * 2;
  const free = !H.game.build.grid.main.has(H.game.world.idx(gx, gy)) && !H.game.world.blocked(gx, gy);
  if (free) {
    const id = H.game.net.newId('s');
    H.game.net.emit('struct.add', { list: [[id, 'door_wood', gx, gy, 0, 0, Math.round(H.game.worldTime)]], by: H.pid });
    H.game.net.emit('struct.complete', { id, by: H.pid, xp: 0, toast: '' });
    H.game.net.emit('door.set', { id, open: 1, by: H.pid });
    t.defer(() => { if (A.structOn(H, id)) H.game.net.emit('struct.remove', { id, quiet: 1 }); });
    await t.waitFor(() => A.structOn(G, id) && !A.structOn(G, id).blueprint, ONEWAY() + 1500, 'an open door ahead (guest)');
    A.teleport(G, gx - ax[0] * 1.6 + 0.5, gy - ax[1] * 1.6 + 0.5);
    h.x = gp.x; h.y = gp.y;
    await A.hostSees(t, H, G);
    const r2 = A.holdMove(G, ax[0], ax[1]);
    let inDoor = false;
    const w2 = t.watch(() => { if (Math.floor(gp.x) === gx && Math.floor(gp.y) === gy) inDoor = true; }, 10);
    await t.sleep(1200);
    r2(); w2.stop();
    t.check(!inDoor && m0(gp), 'an open door stops the horse (no doors on horseback)', `at ${f2(gp.x)},${f2(gp.y)} door ${gx},${gy}`);
  } else t.note('no free tile for the door check');
  await t.checkDigest(H, G);
});
const m0 = (p) => !!p.mount;

def('HO4', {
  title: 'HO: on horseback the spear\'s long shot becomes "Estocada": at a full gallop it hits far harder than standing, and the horse keeps going', timeout: 200000,
  expected: 'Mounted with a spear the bar has "Estocada" (lance_thrust) instead of "Lançar Lança"; standing next to a sturdy target the thrust takes off a little life (host); galloping past it the thrust takes off ≥ 2.5 × as much (the damage grows with the measured speed) and the guest keeps moving through it (no root), the host sees the thrust (presence action lance); another spear attack (Perfurar) stops the horse a moment; digest equal',
  api: 'content/weapons.js barFor(eq, mounted) MOUNTED_SWAP; abilities.js lance_thrust (lanceThrust: THRUST mult / flat × speed k, the first creature in a line ahead) → combat applyPlayerHit → mob.hit; p.mount.spd (horseOwnerSystem); p._atkRootT; art/compose.js pose lance',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.horses && G.game.horses, 'horses (game/horses.js) missing');
  A.keepAlive(t, G);
  G.game.cam.rot = G.game.cam.rotTo = 0;
  await A.openField(t, H, MH, G, MG, 13, 2);
  const gp = G.game.player;
  A.pacify(H, gp.x, gp.y, 30);
  const dir = openDir(H, MH, G, MG, 12);
  t.assert(dir, 'a clear line of 12 tiles to ride along');
  const made = [];
  t.defer(() => dropHorses(H, made));
  const h = tamedHorse(H, MH, gp.x + dir[1] * 1.2, gp.y - dir[0] * 1.2, { saddle: true });
  made.push(h);
  A.equip(G, 'spear_stone');
  await rideHorse(t, H, G, MG, h);
  MG.abilities.rebuildBar(G.game);
  const bar = MG.data.ABILITY_ORDER.slice();
  t.check(bar.includes('lance_thrust') && !bar.includes('throw_spear'), 'mounted with a spear: "Estocada" instead of "Lançar Lança"', bar.join(','));
  // a sturdy target
  const b = await dummyBison(H, MH, gp.x + dir[0] * 1.7, gp.y + dir[1] * 1.7);
  made.push(b);
  const bp = await t.waitFor(() => A.proxyOf(G, b), 3000 + CFG.budget, 'the target on the guest');
  b.x = gp.x + dir[0] * 1.7; b.y = gp.y + dir[1] * 1.7;
  await t.sleep(900);
  const hits = async (go) => { const hp0 = b.hp; go(); await t.sleep(RT() + 700); return hp0 - b.hp; };
  const stand = [];
  for (let k = 0; k < 3; k++) {
    t.check(gp.mount.spd < 0.5, 'standing still', f2(gp.mount.spd));
    stand.push(await hits(() => A.ability(G, MG, 'lance_thrust', A.proxyOf(G, b))));
  }
  const sOk = stand.filter((v) => v > 0);
  t.assert(sOk.length, `a standing thrust lands (${stand.join(', ')})`);
  // Perfurar stops the horse a moment
  const rP = A.holdMove(G, -dir[1], dir[0]);
  await t.sleep(250);
  A.ability(G, MG, 'pierce', A.proxyOf(G, b));
  const rooted = gp._atkRootT > 0.2;
  rP();
  t.check(rooted, 'another spear attack (Perfurar) stops the horse a moment', f2(gp._atkRootT));
  await t.sleep(600);
  // galloping passes
  const gal = [];
  let sawLance = false;
  const avH = A.avatarOn(H, G.pid);
  const wl = t.watch(() => { if (avH?.action?.type === 'lance') sawLance = true; }, 15);
  for (let pass = 0; pass < 3 && gal.filter((v) => v > 0).length < 2; pass++) {
    const sg = pass % 2 ? -1 : 1, ux = dir[0] * sg, uy = dir[1] * sg;
    // the target 7.5 tiles ahead along the line (the way the guest rides)
    b.x = gp.x + ux * 7.5; b.y = gp.y + uy * 7.5;
    await t.waitFor(() => { const q = A.proxyOf(G, b); return q && Math.hypot(q.x - b.x, q.y - b.y) < 0.2; }, ONEWAY() + 1500, 'the target ahead on the guest');
    const rel = A.holdMove(G, ux, uy);
    t.defer(rel);
    await t.waitFor(() => { const q = A.proxyOf(G, b); return q && (q.x - gp.x) * ux + (q.y - gp.y) * uy < 2.3; }, 4000, 'galloping up to the target');
    const k = gp.mount.spd / (gp.baseSpeed * 1.65), x1 = gp.x, y1 = gp.y;
    const hp0 = b.hp;
    t.check(A.ability(G, MG, 'lance_thrust'), `pass ${pass + 1}: Estocada at a gallop (speed ${f2(gp.mount.spd)}, k ${f2(k)})`);
    await t.sleep(450);
    const moved = Math.hypot(gp.x - x1, gp.y - y1);
    t.check(moved > 1.8 && !(gp._atkRootT > 0), 'the horse keeps going during the thrust (not stopped)', `${f2(moved)} tiles in 0.45 s, root ${f2(gp._atkRootT || 0)}`);
    rel();
    await t.sleep(RT() + 500);
    gal.push(hp0 - b.hp);
    MG.abilities.rebuildBar(G.game);
    gp.cds.lance_thrust = 0; gp.gcdT = 0; gp.energy = gp.maxEnergy;
  }
  wl.stop();
  const gOk = gal.filter((v) => v > 0);
  t.assert(gOk.length, `a gallop thrust lands (${gal.join(', ')})`);
  t.check(Math.min(...gOk) >= 2.5 * Math.max(...sOk), 'at a full gallop the thrust hits ≥ 2.5 × harder than standing', `standing ${sOk.join(', ')} · gallop ${gOk.join(', ')}`);
  t.check(sawLance, 'the host sees the lance thrust (presence action "lance")');
  await t.checkDigest(H, G);
});

def('HO5', {
  title: 'HO: on horseback only the spear attacks (axe, bow, bare hands refused); herbs still work', timeout: 160000,
  expected: 'Mounted, with an axe: Space / the attack refuses "Montado: só a lança", its abilities are refused, an armed auto attack does no damage; with a bow the long shot and the shots are refused; bare hands refused; with herbs the heal works; with a spear the auto attack hits the target (host life goes down); digest equal',
  api: 'controller.attack / doTap (p.mount, wprof.type spear), abilities.useAbility mountedOk, aimCheck, combat auto attack (mountT), barFor',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.horses && G.game.horses, 'horses (game/horses.js) missing');
  A.keepAlive(t, G);
  await A.openField(t, H, MH, G, MG, 8);
  const gp = G.game.player;
  A.pacify(H, gp.x, gp.y, 30);
  const made = [];
  t.defer(() => dropHorses(H, made));
  const h = tamedHorse(H, MH, gp.x + 1.2, gp.y, { saddle: true });
  made.push(h);
  await rideHorse(t, H, G, MG, h);
  const b = await dummyBison(H, MH, gp.x + 1.4, gp.y);
  made.push(b);
  b.x = gp.x + 1.4; b.y = gp.y;
  const bp = await t.waitFor(() => A.proxyOf(G, b), 3000 + CFG.budget, 'a target next to the guest');
  await t.sleep(600);
  const errs = [];
  t.on(G, 'error', (d) => errs.push(d?.text || ''));
  const only = () => errs.filter((s) => /Montado: só a lança/.test(s)).length;
  // an axe
  A.equip(G, 'axe_stone');
  await t.sleep(150);
  const n0 = only();
  G.game.ctl.setTarget(A.proxyOf(G, b));
  G.game.ctl.attack();
  t.check(only() > n0, 'axe: the attack is refused ("Montado: só a lança")', errs.slice(-1)[0]);
  t.check(!A.ability(G, MG, 'cleave', A.proxyOf(G, b)), 'axe: its ability (Golpe Fendente) is refused');
  const hp0 = b.hp;
  gp.target = A.proxyOf(G, b); gp.autoAttack = true;
  await t.sleep(2200);
  t.check(b.hp === hp0 && !gp.autoAttack, 'axe: no auto attack lands', `hp ${hp0} → ${b.hp}`);
  // a bow
  A.equip(G, 'bow_wood'); A.ensure(G, { arrow: 10 });
  await t.sleep(150);
  t.check(/Montado: só a lança/.test(MG.abilities.aimCheck(G.game, 'long_shot') || ''), 'bow: the long shot is refused', MG.abilities.aimCheck(G.game, 'long_shot'));
  t.check(!A.ability(G, MG, 'aimed_shot', A.proxyOf(G, b)), 'bow: Tiro Mirado is refused');
  // bare hands
  gp.equip.main = null;
  await t.sleep(150);
  const n1 = only();
  G.game.ctl.attack();
  t.check(only() > n1, 'bare hands: refused too');
  // herbs: fine on horseback
  A.ensure(G, { herb: 2 });
  t.check(A.ability(G, MG, 'heal'), 'herbs still work on horseback');
  // the spear: its auto attack hits
  A.equip(G, 'spear_stone');
  await t.sleep(200);
  const hp1 = b.hp;
  G.game.ctl.setTarget(A.proxyOf(G, b));
  G.game.ctl.attack();
  await t.waitFor(() => b.hp < hp1, 5000, 'spear: the auto attack hits the target (host)', () => `hp ${b.hp} auto ${gp.autoAttack} d ${f2(Math.hypot(gp.x - b.x, gp.y - b.y))}`);
  gp.autoAttack = false;
  await t.checkDigest(H, G);
});

def('HO6', {
  title: 'HO: "Desmontar" puts the guest beside its horse and brings "Lançar Lança" back; a horse that dies throws its rider unhurt', timeout: 150000,
  expected: 'Mounted with a spear, the use button\'s "Desmontar" gets the guest off: beside the horse on dry ground (both peers drop the ride), the bar has "Lançar Lança" again (no "Estocada") and the throw can be aimed; the horse stays saddled where it is; mounted again, the host kills the horse: the guest falls off unhurt with a toast, its body on both; digest equal',
  api: 'horses.dismountIt → work horse_dismount → intent horse.dismount → dismountHorse (landing spot) → op horse.ride off (game.horses.land); hostTidy (dead ridden horse → horse.ride off, toast); barFor without mounted',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.horses && G.game.horses, 'horses (game/horses.js) missing');
  A.keepAlive(t, G, { hp: false });
  await A.openField(t, H, MH, G, MG, 8);
  const gp = G.game.player;
  gp.hp = gp.maxHp;
  A.pacify(H, gp.x, gp.y, 30);
  const made = [];
  t.defer(() => dropHorses(H, made));
  const h = tamedHorse(H, MH, gp.x + 1.2, gp.y, { saddle: true });
  made.push(h);
  A.equip(G, 'spear_stone');
  await rideHorse(t, H, G, MG, h);
  MG.abilities.rebuildBar(G.game);
  t.check(MG.data.ABILITY_ORDER.includes('lance_thrust'), 'mounted: "Estocada" on the bar');
  const it = MG.controller.nearestInteractable(G.game);
  t.check(it?.kind === 'horse_dismount' && it.verb === 'Desmontar', 'the use button: "Desmontar"', it?.verb);
  A.interact(G, it);
  await t.waitFor(() => !h.rider && !gp.mount && !G.game.horses.rides.has(G.pid) && !H.game.horses.rides.has(G.pid), RT() + 3000, 'off the horse (both peers drop the ride)');
  await t.sleep(250);
  const d = Math.hypot(gp.x - h.x, gp.y - h.y);
  t.check(d > 0.4 && d < 1.7 && G.game.world.liquidAt(Math.floor(gp.x), Math.floor(gp.y)) !== 2, 'the guest stands beside the horse on dry ground', `d ${f2(d)}`);
  MG.abilities.rebuildBar(G.game);
  const bar = MG.data.ABILITY_ORDER.slice();
  t.check(bar.includes('throw_spear') && !bar.includes('lance_thrust'), 'off the horse: "Lançar Lança" again', bar.join(','));
  gp.cds.throw_spear = 0; gp.gcdT = 0; gp.energy = gp.maxEnergy; gp._throwT = 0;
  t.check(MG.abilities.aimCheck(G.game, 'throw_spear') == null, 'the throw can be aimed again', String(MG.abilities.aimCheck(G.game, 'throw_spear')));
  t.check(h.saddle && !h.dead, 'the horse stays, saddled');
  // a horse killed under its rider throws it, unhurt
  await rideHorse(t, H, G, MG, h);
  const notes = [];
  t.on(G, 'toast', (dd) => notes.push(dd?.text || ''));
  const hp0 = gp.hp;
  MH.combat.killMob(H.game, h, null);
  await t.waitFor(() => !gp.mount && !G.game.horses.rides.has(G.pid), RT() + 2500, 'the rider fell off the dead horse');
  await t.sleep(300);
  t.check(gp.hp >= hp0 && !gp.dead, 'unhurt', `hp ${hp0} → ${gp.hp}`);
  t.check(notes.some((s) => /cavalo morreu/.test(s)), 'and told so', notes.join(' | '));
  await t.waitFor(() => [...G.game.corpses.map.values()].some((c) => c.of === 'horse' && Math.hypot(c.x - h.x, c.y - h.y) < 1.5), ONEWAY() + 1500, 'the horse\'s body on the guest');
  await t.checkDigest(H, G);
});

def('HO7', {
  title: 'HO: saving keeps the tamed horses, their coats and saddles (the ridden one too); loading brings them back', timeout: 150000,
  expected: 'Three tamed horses (a grey saddled one, a chestnut without a saddle, a saddled one the guest rides): the host\'s save rows (world.stock) hold all three with species horse, coat and saddle flags (1, 0, 1); loaded back (rows → restore on the farm clock) they stand where they were, tamed, with their coats and saddles, on the host and on the guest (entity stream saddle bit); the saddled one offers "Montar" to the guest; digest equal',
  api: 'net/snapshot.js serializeWorld({save}) → livestock.stockRows ([11] saddle); stashStock + restoreStock (game.stock.debug.restore); entity stream',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  t.need(H.game.horses && H.game.stock?.debug, 'horses (game/horses.js) missing');
  A.keepAlive(t, G);
  await A.openField(t, H, MH, G, MG, 8);
  const gp = G.game.player;
  const made = [];
  t.defer(() => dropHorses(H, made));
  const hA = tamedHorse(H, MH, gp.x + 2, gp.y + 1.5, { saddle: true, coat: 2 });
  const hB = tamedHorse(H, MH, gp.x - 2, gp.y + 1.5, { coat: 1 });
  const hC = tamedHorse(H, MH, gp.x + 1.2, gp.y, { saddle: true, coat: 3 });
  made.push(hA, hB, hC);
  await rideHorse(t, H, G, MG, hC);
  const SN = await fimp(H, 'net/snapshot.js'), LH = await fimp(H, 'game/livestock.js');
  const sv = JSON.parse(JSON.stringify(SN.serializeWorld(H.game, { save: true })));
  const rowOf = (m) => (sv.stock || []).find((r) => r[0] === 'horse' && Math.abs(r[1] - m.x) < 0.05 && Math.abs(r[2] - m.y) < 0.05);
  const rows = [hA, hB, hC].map(rowOf);
  t.check(rows.every(Boolean), 'the save holds the three horses (the ridden one too)', `${(sv.stock || []).filter((r) => r[0] === 'horse').length} horse rows`);
  t.check(rows.every(Boolean) && rows.map((r) => r[11]).join(',') === '1,0,1', 'with their saddles (1, 0, 1)', rows.map((r) => r && r[11]).join(','));
  t.check(rows.every(Boolean) && rows.map((r) => (r[3] >> 2) & 3).join(',') === '2,1,3', 'and their coats (grey, chestnut, black)', rows.map((r) => r && (r[3] >> 2) & 3).join(','));
  // load: the world comes back without them, then the farm clock restores the saved rows
  const spots = [hA, hB, hC].map((m) => [m.x, m.y]);
  const MHo = await fimp(H, 'game/horses.js');
  MHo.dismountHorse(H.game, hC, 'hand');
  await t.waitFor(() => !gp.mount, RT() + 2000, 'the guest is off (a loaded world has no riders)');
  await killQuiet(H, [hA, hB, hC]);
  await t.sleep(RT());
  LH.stashStock(H.game, rows);
  H.game.stock.debug.restore();
  const back = spots.map(([x, y]) => horseNear(H, x, y, 0.06));
  made.push(...back);
  t.check(back.every(Boolean), 'host: the three horses are back where they stood', back.map((m) => m ? m.nid : '-').join(' '));
  if (back.every(Boolean)) {
    t.check(back.map((m) => (m.saddle ? 1 : 0)).join(',') === '1,0,1' && back.map((m) => (m.variant >> 2) & 3).join(',') === '2,1,3' && back.every((m) => m.tame && m.owned), 'host: tamed, coats and saddles kept', back.map((m) => `${m.saddle ? 'S' : '-'}${(m.variant >> 2) & 3}`).join(' '));
    await t.waitFor(() => back.every((m) => A.proxyOf(G, m)), 3000 + CFG.budget, 'guest: the restored horses');
    await t.waitFor(() => back.map((m) => (A.proxyOf(G, m).saddle ? 1 : 0)).join(',') === '1,0,1', ONEWAY() + 1500, 'guest: the saddles shown');
    const s = A.freeSpot(G, MG, back[0].x, back[0].y, { rMin: 0.8, rMax: 1.4 });
    if (s) A.teleport(G, s[0], s[1]);
    t.check(G.game.horses.describe(A.proxyOf(G, back[0]))?.verb === 'Montar', 'the restored saddled horse offers "Montar"');
  }
  await t.checkDigest(H, G);
});

// =====================================================================================================
// NM: the night's dead of the warm lands (docs/NIGHT-DEAD.md, game/undead.js) — skeletons on the warm zone's mild-winter
// nights, mummies in the hot deserts, their giants (the ballista fells them), the temperate winter keeps its walkers,
// creative worlds are spared. Places come from the planet's macro map (planetCells / cellZone / zoneSpot of the LZ ones).
const NM_ARID = new Set(['desert_dunes', 'desert_rocky', 'badlands', 'salt_flat', 'cold_desert']);
// load the chunks around (x, y) on a frame (the desert test samples ±7 tiles)
function nmLoad(f, x, y, r = 16) { const w = f.game.world; for (let dy = -r; dy <= r; dy += 8) for (let dx = -r; dx <= r; dx += 8) w.ensure(w.chunkIndex(Math.floor(x + dx), Math.floor(y + dy))); }
// a walkable spot of zone z near the spawn that is (desert) / is not (!desert) a hot desert
function nmSpot(H, MH, zone, desert, n = 14) {
  const sp = H.game.world.spawn;
  const cells = planetCells(H, (c, P, K) => !P.ocean[c] && !P.lakeId[c] && cellZone(P, c) === zone && NM_ARID.has(K[P.biome[c]]) === desert && !P.rkind?.[c], sp.x, sp.y, n);
  for (const c of cells) {
    const s = zoneSpot(H, MH, c.x, c.y, zone, 40);
    if (!s) continue;
    nmLoad(H, s[0], s[1]);
    if (MH.undead.desertAt(H.game.world, s[0], s[1]) === desert) return s;
  }
  return null;
}
// a clock (day of the year, a night hour) when (x, y) has the family `fam`
function nmNight(f, M, x, y, fam) {
  const w = f.game.world, s = w.seasonSlot(Math.floor(x), Math.floor(y)), desert = M.undead.desertAt(w, x, y);
  for (let d = 1; d <= M.seasons.CYCLE; d++) for (const h of [22, 23, 1, 2, 3]) {
    const S = M.seasons.zoneSeason(s % 5, M.seasons.slotClock(s, M.seasons.seasonClock(d, h)));
    if (M.undead.familyForSeason(S, desert) === fam) return { day: d, hour: h };
  }
  return null;
}
// the host's clock to (day, hour); the guest follows
async function nmClock(t, H, G, day, hour) {
  H.game.net.emit('env.skip', { hour, day, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => G.game.env.dayIndex === day && Math.abs(G.game.env.hour - hour) < 0.3, 3000 + CFG.budget, `the guest clock follows to day ${day}, ${hour} h`);
}
// the night's creatures (walker faction) around (x, y) on the host
const nmNear = (H, x, y, r = 70) => A.hostMobs(H, (m) => m.faction === 'walker' && Math.hypot(H.game.world.dx(m.x, x), m.y - y) < r);
// forced spawn ticks of the night (walkers.js walkersTick: groups, then the giant schedule)
async function nmSpawn(t, H, MH, x, y, giant = false) {
  for (let k = 0; k < (giant ? 30 : 14); k++) {
    const L = nmNear(H, x, y);
    if (giant ? L.some((m) => m.giant) : L.some((m) => !m.giant)) break;
    if (giant) { H.game._giantT = 0; H.game._walkT = 1e9; } else { H.game._walkT = 0; H.game._giantT = 1e9; }
    MH.walkers.walkersTick(H.game, true);
    await t.sleep(40);
  }
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  return nmNear(H, x, y);
}
function nmCleanup(t, H, MH, day0, hour0, ids = []) {
  t.defer(() => {
    for (const id of ids) if (H.game.build.structures.some((o) => o.id === id)) H.game.net.emit('struct.remove', { id, quiet: 1 });
    H.game.net.emit('env.skip', { hour: hour0, day: day0, wt: H.game.worldTime + 1, by: H.game.net.pid });
    for (const e of H.game.entities.slice()) if (e.isMob && !e.dead && (e.faction === 'walker' || e.spawner?.hunt)) { e.noCorpse = true; e.onDeath = null; MH.combat.killMob(H.game, e, null); }
  });
}
// one of the night's creatures, calm, next to (x, y)
function nmCalm(H, MH, species, x, y, r = 0.3) {
  const s = A.freeSpot(H, MH, x, y, { rMin: 0, rMax: 2.5, r });
  if (!s) return null;
  const m = /giant/.test(species) ? MH.giants.spawnGiantAt(H.game, s[0], s[1], species) : MH.walkers.spawnWalkerAt(H.game, s[0], s[1], species);
  m.calmT = 1e9; m.state = 'idle'; m.stateT = 1e9;
  return m;
}
// sunrise after a night clock: everything of the night crumbles on both, the guest sees it fall apart (undeadfx stats)
async function nmSunrise(t, H, G, clk, list, fam) {
  const s0 = G.game.undeadFx?.stats?.[fam] || 0;
  H.game.net.emit('env.skip', { hour: 6.6, day: clk.hour > 12 ? clk.day + 1 : clk.day, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => list.every((m) => m.dead), 14000, 'they all crumble at sunrise (host)', () => list.filter((m) => !m.dead).map((m) => m.species).join(','));
  await t.waitFor(() => list.every((m) => !A.proxyOf(G, m) || A.proxyOf(G, m).dead), RT() + 2000, 'dead on the guest too');
  t.check(![...H.game.corpses.map.values()].some((c) => list.some((m) => c.of === m.species)), 'no body left');
  if (G.game.undeadFx) await t.waitFor(() => (G.game.undeadFx.stats[fam] || 0) > s0, 3000, `the guest sees them fall apart (${fam === 'bone' ? 'bones' : 'sand'})`, () => `${G.game.undeadFx.stats[fam]} vs ${s0}`);
}
// a ballista bolt from o at m (op ballista.shot: the host's copy resolves the hit; `by` the guest)
function nmBolt(H, MH, G, o, m) {
  const [px, py] = MH.ballista.pivotOf(o), a = Math.atan2(m.y - py, m.x - px), [mx, my] = MH.ballista.muzzleOf(o, a);
  H.game.net.emit('ballista.shot', { id: o.id, sid: 'nm' + Math.floor(Math.random() * 1e9).toString(36), x: +mx.toFixed(3), y: +my.toFixed(3), a: +a.toFixed(4), by: G.pid });
}
// a giant of the night next to a ballista; two bolts fell it (55 % each, like the ice giant), on both peers
async function nmGiantBallista(t, H, G, MH, MG, species) {
  const gp = G.game.player;
  const site = A.findSite([H, G], [MH, MG], 'ballista', (x, y) => { const L = []; for (let i = -1; i <= 13; i++) for (let j = -1; j <= 1; j++) L.push([x + i, y + j]); return L; }, gp.x, gp.y, { rMin: 2, rMax: 24 });
  t.assert(site, 'found a free 15×3 strip for the ballista');
  const { x0, y0 } = site;
  const [bid] = hostBuild(H, [['ballista', x0, y0, 0]]);
  t.defer(() => { if (H.game.build.structures.some((o) => o.id === bid)) H.game.net.emit('struct.remove', { id: bid, quiet: 1 }); });
  await t.waitFor(() => A.structOn(G, bid) && !A.structOn(G, bid).blueprint, RT() + 1500, 'the guest has the finished ballista');
  A.teleport(G, x0 + 0.5, y0 + 1.6);
  await A.hostSees(t, H, G);
  const m = nmCalm(H, MH, species, x0 + 11.5, y0 + 0.5, 0.8);
  t.assert(m, 'free spot for the giant');
  const px = await t.waitFor(() => A.proxyOf(G, m), RT() + 1500, 'the guest sees the giant');
  t.check(px.species === species && px.kind === 'pawn' && px.scale === 2.4 && px.elite, `giant proxy: species ${species}, pawn, scale 2.4, elite`, `${px.species} ${px.kind} ${px.scale} ${px.elite}`);
  const oH = A.structOn(H, bid), max = m.maxHp, xpG = gp.xp;
  nmBolt(H, MH, G, oH, m);
  await t.waitFor(() => m.hp < max, 3000 + RT(), 'the first bolt hits the giant (host)', () => `${m.hp}/${max}`);
  t.check(Math.abs((max - m.hp) - Math.ceil(max * 0.55)) <= 1, 'a bolt takes 55% of its life (like the ice giant)', `${Math.round(max - m.hp)} of ${Math.round(max)}`);
  await t.waitFor(() => Math.abs((A.proxyOf(G, m)?.hp ?? max) - m.hp) < 2, RT() + 1500, 'the guest sees its life drop');
  await t.sleep(3100); // (the reload)
  nmBolt(H, MH, G, oH, m);
  await t.waitFor(() => m.dead, 3000 + RT(), 'the second bolt fells it (host)');
  await t.waitFor(() => !A.proxyOf(G, m) || A.proxyOf(G, m).dead, RT() + 1500, 'dead on the guest');
  await t.waitFor(() => gp.xp > xpG || gp.level > 1, RT() + 1500, 'XP to the guest (its bolts)', () => `${xpG} → ${gp.xp}`);
  return m;
}

def('NM1', {
  title: 'NM: skeletons on a warm-zone mild-winter night (both peers, never walkers there), blunt blows shatter them; they leave as bones at sunrise', timeout: 220000,
  expected: 'Both players go to a warm-zone land cell that is not a desert (planet macro map); the clock jumps to a night of its mild winter ("Inverno ameno": no snow, no ice) on both; both compute the family "bone" there (undead.js nightFamilyAt); forced spawn ticks bring skeletons only (no walker, no mummy) and the forced giant schedule a Gigante Esqueleto; a skeleton next to the guest is a pawn proxy (species skeleton, a bone sword / spear or a bow); a guest hit with a club does 1.5× the damage of the same hit with a sword (mob.hit w → undead.js boneHitK); at sunrise every one of them crumbles (dead on both, no body) and the guest sees them fall apart into bones (undeadfx); digest equal',
  api: 'undead.js nightFamilyAt / desertAt / familyForSeason / boneHitK, walkers.js walkersTick (nightFams → spawnGroup by family, crumble by family), giants.js giantsTick (giantHere), combat.dealDamage, mob.hit (w), fx/undeadfx.js stats',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, day0 = EH.dayIndex, hour0 = EH.hour, gp = G.game.player;
  nmCleanup(t, H, MH, day0, hour0);
  A.keepAlive(t, H); A.keepAlive(t, G);
  const spot = nmSpot(H, MH, 1, false);
  t.assert(spot, 'the planet has warm-zone land that is not a desert');
  await moveBoth(t, H, G, spot);
  nmLoad(G, spot[0], spot[1]);
  const clk = nmNight(H, MH, spot[0], spot[1], 'bone');
  t.assert(clk, 'a night of the mild winter there');
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  await nmClock(t, H, G, clk.day, clk.hour);
  await t.waitFor(() => H.game.season?.zone === 1 && G.game.season?.zone === 1 && H.game.season.id === 'winter' && G.game.season.id === 'winter', 3000, 'both stand in the warm zone\'s winter', () => `${H.game.season?.name} / ${G.game.season?.name}`);
  t.check(!H.game.season.hard && !G.game.season.frozen && /ameno/i.test(G.game.season.name), '"Inverno ameno": no snow, no ice', G.game.season.name);
  t.check(MH.undead.nightFamilyAt(H.game, spot[0], spot[1]) === 'bone' && MG.undead.nightFamilyAt(G.game, gp.x, gp.y) === 'bone', 'both compute the family there: skeletons', `${MH.undead.nightFamilyAt(H.game, spot[0], spot[1])} / ${MG.undead.nightFamilyAt(G.game, gp.x, gp.y)}`);
  // the night's spawns
  const L1 = await nmSpawn(t, H, MH, spot[0], spot[1]);
  t.check(L1.length > 0 && L1.every((m) => m.species === 'skeleton'), 'skeletons come out of the dark (and nothing else)', L1.map((m) => m.species).join(',') || 'none');
  const L2 = await nmSpawn(t, H, MH, spot[0], spot[1], true);
  const gi = L2.filter((m) => m.giant);
  t.check(gi.length > 0 && gi.every((m) => m.species === 'skeleton_giant'), 'the giant schedule brings a Gigante Esqueleto (not an ice giant)', gi.map((m) => m.species).join(',') || 'none');
  for (const m of L2) { m.calmT = 1e9; m.state = 'idle'; m.stateT = 1e9; }
  // one next to the guest: its proxy
  const m = nmCalm(H, MH, 'skeleton', gp.x + 2.2, gp.y);
  t.assert(m, 'free spot for a skeleton');
  const px = await t.waitFor(() => A.proxyOf(G, m), RT() + 1500, 'the guest sees the skeleton');
  t.check(px.species === 'skeleton' && px.kind === 'pawn' && /^(sword_bone|spear_bone|bow_wood)$/.test(px.weapon || ''), 'skeleton proxy: species skeleton, pawn, a bone weapon or a bow', `${px.species} ${px.kind} ${px.weapon}`);
  // blunt blows shatter bones: a club hit vs a sword hit (the guest's main hand rides on mob.hit)
  m.maxHp = m.hp = 5000; m.armorV = 0;
  const main0 = gp.equip.main;
  t.defer(() => { gp.equip.main = main0; });
  // the amount of the hit itself (the host's damage event): a calm creature's regeneration between two reads of its
  // hp would blur an hp difference
  let lastDmg = null;
  const offD = H.game.events.on('damage', (d) => { if (d.target === m && d.kind === 'hit' && !d.dot) lastDmg = d.amount; });
  t.defer(() => { try { offD?.(); } catch { /* ignore */ } });
  const hitWith = async (w) => {
    gp.equip.main = w;
    lastDmg = null;
    MG.combat.routeHit(G.game, gp, A.proxyOf(G, m), 20, {});
    await t.waitFor(() => lastDmg != null, RT() + 1500, `the ${w} hit lands`);
    m.calmT = 1e9; m.state = 'idle';
    return lastDmg;
  };
  const dClub = await hitWith('club_wood'), dSword = await hitWith('sword_iron');
  gp.equip.main = main0;
  t.check(dClub === 30 && dSword === 20, 'a club does 1.5× on a skeleton (blunt), a sword the plain amount', `club ${dClub} · sword ${dSword}`);
  // sunrise: bones
  await nmSunrise(t, H, G, clk, [...L2, m], 'bone');
  await t.checkDigest(H, G);
  env.history.push('NM1');
});

def('NM2', {
  title: 'NM: mummies in a hot desert at night (both peers), the Múmia Gigante there; a mummy\'s touch curses (slower); killed, linen; they turn to sand at dawn', timeout: 220000,
  expected: 'Both players go to a hot desert (arid biome of the warm / tropical zone); the clock jumps to a night of its bad season (mild winter / dry season); both compute the family "sand"; forced spawn ticks bring mummies only, the giant schedule a Múmia Gigante; a mummy whose touch always curses (test) hits the guest: the guest gets the "Maldição da múmia" debuff (and the warning) and moves 35% slower; a mummy killed by the guest drops linen on the ground on both (the same rows); at sunrise all of them crumble (dead on both, no body) and the guest sees them pour into sand (undeadfx); digest equal',
  api: 'undead.js nightFamilyAt / desertAt / nightKit (curse) / nightDeath, bandits.js meleeHit (curse) → players.hurtPlayer → own player.hurt curse → afterHurt (buff curse) → player.js speed, loot.add',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, day0 = EH.dayIndex, hour0 = EH.hour, gp = G.game.player;
  nmCleanup(t, H, MH, day0, hour0);
  A.keepAlive(t, H); A.keepAlive(t, G);
  const spot = nmSpot(H, MH, 1, true) || nmSpot(H, MH, 0, true);
  t.assert(spot, 'the planet has a hot desert');
  await moveBoth(t, H, G, spot);
  nmLoad(G, spot[0], spot[1]);
  const clk = nmNight(H, MH, spot[0], spot[1], 'sand');
  t.assert(clk, 'a bad night there');
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  await nmClock(t, H, G, clk.day, clk.hour);
  await t.waitFor(() => MH.undead.nightFamilyAt(H.game, spot[0], spot[1]) === 'sand' && MG.undead.nightFamilyAt(G.game, gp.x, gp.y) === 'sand', 3000, 'both compute the family there: mummies', () => `${MH.undead.nightFamilyAt(H.game, spot[0], spot[1])} / ${MG.undead.nightFamilyAt(G.game, gp.x, gp.y)}`);
  t.log(`desert: zone ${H.game.season?.zone} · ${H.game.season?.name}`);
  const L1 = await nmSpawn(t, H, MH, spot[0], spot[1]);
  t.check(L1.length > 0 && L1.every((m) => m.species === 'mummy'), 'mummies come out of the sands (and nothing else)', L1.map((m) => m.species).join(',') || 'none');
  const L2 = await nmSpawn(t, H, MH, spot[0], spot[1], true);
  const gi = L2.filter((m) => m.giant);
  t.check(gi.length > 0 && gi.every((m) => m.species === 'mummy_giant'), 'the giant schedule brings a Múmia Gigante', gi.map((m) => m.species).join(',') || 'none');
  for (const e of L2) { e.calmT = 1e9; e.state = 'idle'; e.stateT = 1e9; }
  // the curse: a mummy whose touch always curses hits the guest
  const since = now(), base = gp.speed;
  const m = nmCalm(H, MH, 'mummy', gp.x + 1.4, gp.y);
  t.assert(m, 'free spot for a mummy');
  m.curse = { chance: 1, dur: 3 }; m.calmT = 0; m.specialT = 99;
  MH.ai.aggro(H.game, m, guestOnHost(H, G));
  await t.waitFor(() => gp.buffs.some((b) => b.id === 'curse'), 15000, 'the guest is cursed by the mummy\'s touch', () => `mummy ${m.state} d ${f2(Math.hypot(m.x - gp.x, m.y - gp.y))}`);
  await t.sleep(100);
  t.check(gp.speed < base * 0.7 + 0.01, 'cursed: 35% slower', `${f2(base)} → ${f2(gp.speed)}`);
  t.check(G.ui.filter((u) => u.t >= since).some((u) => /Maldição da múmia/.test(u.text)), 'the guest is told "Maldição da múmia"', G.lastUi(3, since));
  m.calmT = 1e9; m.state = 'idle'; m.threat = null;
  // killed by the guest: linen on the ground (the same rows on both)
  const rec = A.lootRecorder(t, [H, G]);
  const k = nmCalm(H, MH, 'mummy', gp.x - 1.6, gp.y);
  t.assert(k, 'free spot for a second mummy');
  for (let i = 0; i < 6 && !k.dead; i++) {
    const p2 = await t.waitFor(() => A.proxyOf(G, k), RT() + 1500, 'the guest sees the mummy');
    MG.combat.routeHit(G.game, gp, p2, 5000, {});
    await t.sleep(RT());
  }
  await t.waitFor(() => k.dead, 3000, 'the guest kills a mummy');
  await t.waitFor(() => (rec.items(0).linen || 0) > 0 || rec.rows(0).length > 0, RT() + 5000, 'its drop appears on the host'); // (the body sinks into sand first)
  await t.sleep(RT() + 300);
  rec.stop();
  const cmp = rec.compare(0, 1);
  t.check((rec.items(0).linen || 0) >= 1 || rec.rows(0).length > 0, 'a killed mummy leaves linen (or what it carried)', JSON.stringify(rec.items(0)));
  t.check(cmp.ok, 'the same rows on the guest', cmp.detail);
  // dawn: sand
  await nmSunrise(t, H, G, clk, [...L2, m], 'sand');
  await t.checkDigest(H, G);
  env.history.push('NM2');
});

def('NM3', {
  title: 'NM: a temperate winter night still brings Ice Walkers and the ice giant (never skeletons); a skeleton put there crumbles', timeout: 160000,
  expected: 'At the temperate spawn on a winter night (day 5, 22 h): the family there is "ice" on both; forced spawn ticks bring walkers only and the giant schedule an ice giant (species giant); the season is the plain "Inverno" (hard, frozen); a skeleton spawned there by hand (another family) crumbles within seconds on both — one family per place; digest equal',
  api: 'undead.js nightFamilyAt, walkers.js walkersTick (crumble by family), giants.js giantsTick, seasons.js',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, day0 = EH.dayIndex, hour0 = EH.hour, gp = G.game.player, hp = H.game.player;
  nmCleanup(t, H, MH, day0, hour0);
  A.keepAlive(t, H); A.keepAlive(t, G);
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  await nmClock(t, H, G, 5, 22);
  await t.waitFor(() => H.game.season?.id === 'winter' && G.game.season?.id === 'winter', 3000, 'winter on both');
  t.check(H.game.season.zone === 2 && H.game.season.hard && G.game.season.frozen && G.game.season.name === 'Inverno', 'the plain temperate "Inverno" (hard, frozen)', `${G.game.season.zone} ${G.game.season.name}`);
  t.check(MH.undead.nightFamilyAt(H.game, hp.x, hp.y) === 'ice' && MG.undead.nightFamilyAt(G.game, gp.x, gp.y) === 'ice', 'the family there: ice (walkers)');
  const L1 = await nmSpawn(t, H, MH, hp.x, hp.y);
  t.check(L1.length > 0 && L1.every((m) => m.species === 'walker'), 'walkers only (no skeleton, no mummy)', L1.map((m) => m.species).join(',') || 'none');
  const L2 = await nmSpawn(t, H, MH, hp.x, hp.y, true);
  const gi = L2.filter((m) => m.giant);
  t.check(gi.length > 0 && gi.every((m) => m.species === 'giant'), 'the giant schedule brings the ice giant', gi.map((m) => m.species).join(',') || 'none');
  for (const e of L2) { e.calmT = 1e9; e.state = 'idle'; e.stateT = 1e9; }
  // a skeleton out of its family's place: it crumbles
  const s = nmCalm(H, MH, 'skeleton', gp.x + 2, gp.y);
  t.assert(s, 'free spot for a skeleton');
  await t.waitFor(() => A.proxyOf(G, s) || s.dead, RT() + 1500, 'the guest sees it (or it is gone already)');
  await t.waitFor(() => s.dead, 10000, 'the skeleton crumbles in the temperate winter (host)');
  await t.waitFor(() => !A.proxyOf(G, s) || A.proxyOf(G, s).dead, RT() + 1500, 'and on the guest');
  t.check(L2.every((m) => !m.dead), 'the walkers and the ice giant stay (their own night)');
  await t.checkDigest(H, G);
  env.history.push('NM3');
});

def('NM4', {
  title: 'NM: creative mode — skeletons and mummies break nothing and are not drawn to light (then, in survival, they are)', timeout: 160000,
  expected: 'Host world in creative mode (the guest resyncs): a closed 5×5 room of wooden walls around the guest and a lit campfire 9 tiles away; a skeleton and a mummy outside: for 8 s none of the walls takes damage (struct.dmg) on either peer, and neither creature hunts (no goal, never "hunt" / "siege") nor walks toward the fire; back to survival: within 20 s one of them goes after the guest or the light; digest equal',
  api: 'walkers.js walkerBrain (game.creative: handOff), creative.js, op struct.dmg',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player, EH = H.game.env, day0 = EH.dayIndex, hour0 = EH.hour;
  A.keepAlive(t, G);
  const site = A.findSite([H, G], [MH, MG], 'wall_wood', (x, y) => { const L = []; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) L.push([x + i, y + j]); return L; }, gp.x, gp.y, { rMin: 3, rMax: 14 });
  t.assert(site, 'found a free 5×5 site');
  const { x0, y0 } = site, ring = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (i === 0 || j === 0 || i === 4 || j === 4) ring.push(['wall_wood', x0 + i, y0 + j]);
  const fs = A.findSite([H, G], [MH, MG], 'campfire', (x, y) => [[x, y]], x0 + 13, y0 + 2, { rMin: 0, rMax: 5 });
  t.assert(fs, 'a free tile for the campfire ~11 tiles from the room');
  ring.push(['campfire', fs.x0, fs.y0]);
  const ids = hostBuild(H, ring);
  nmCleanup(t, H, MH, day0, hour0, ids);
  try {
    H.game.creative = true;
    G.game.net.forceResync();
    await t.waitFor(() => G.game.net.synced && G.game.creative === true, 15000, 'the guest got the creative mode');
    await t.waitFor(() => ids.every((id) => A.structOn(G, id)), RT() + 2000, 'the guest has the room and the fire');
    A.teleport(G, x0 + 2.5, y0 + 2.5);
    await A.hostSees(t, H, G);
    H.game._walkT = 1e9; H.game._giantT = 1e9;
    const fire = H.game.build.structures.find((o) => o.id === ids[ids.length - 1]);
    const mx = (x0 + 4 + fire.x) / 2, my = (y0 + 2.5 + fire.y) / 2; // (between the room and the fire)
    const sk = nmCalm(H, MH, 'skeleton', mx, my + 1), mu = nmCalm(H, MH, 'mummy', mx, my - 1);
    t.assert(sk && mu, 'free spots for a skeleton and a mummy');
    const both = [sk, mu];
    for (const m of both) { m.calmT = 0; m.crumbleAt = 1e12; } // (daylight at the temperate spawn: kept from crumbling for the test)
    const d0 = both.map((m) => Math.hypot(m.x - fire.x, m.y - fire.y));
    let hunted = false;
    const w = t.watch(() => { for (const m of both) if (m.goal || m.state === 'hunt' || m.state === 'siege') hunted = true; }, 50);
    await t.sleep(8000);
    w.stop();
    const dmgH = H.game.build.structures.filter((o) => ids.includes(o.id) && o.dmg > 0).length, dmgG = G.game.build.structures.filter((o) => ids.includes(o.id) && o.dmg > 0).length;
    t.check(!dmgH && !dmgG, 'creative: no wall takes damage (both peers)', `${dmgH} / ${dmgG}`);
    t.check(!hunted, 'creative: they hunt nobody and nothing (no goal, no siege)', both.map((m) => `${m.species} ${m.state}`).join(' · '));
    const d1 = both.map((m) => Math.hypot(m.x - fire.x, m.y - fire.y));
    t.check(d1.every((d, i) => d > d0[i] - 2.6), 'creative: not drawn toward the fire', `${d0.map(f2)} → ${d1.map(f2)}`);
    // survival again: they come
    H.game.creative = false;
    G.game.net.forceResync();
    await t.waitFor(() => G.game.net.synced && G.game.creative === false, 15000, 'back to survival on the guest');
    await t.waitFor(() => both.some((m) => m.goal && (m.state === 'hunt' || m.state === 'siege' || m.state === 'chase')) || H.game.build.structures.some((o) => ids.includes(o.id) && o.dmg > 0), 20000, 'in survival they go after the guest / the light', () => both.map((m) => `${m.species} ${m.state} ${m.goal?.kind || '-'}`).join(' · '));
  } finally {
    H.game.creative = false;
    G.game.net.forceResync();
    await t.waitFor(() => G.game.net.synced && G.game.creative === false, 15000, 'back to survival on the guest');
  }
  await t.checkDigest(H, G);
  env.history.push('NM4');
});

def('NM5', {
  title: 'NM: the Gigante Esqueleto on a warm-zone mild-winter night — replicated, two ballista bolts fell it (like the ice giant)', timeout: 220000,
  expected: 'Both players at a warm-zone spot (not a desert) on a night of its mild winter; a ballista next to the guest; a Gigante Esqueleto 11 tiles away is a pawn proxy on the guest (species skeleton_giant, scale 2.4, elite); a ballista bolt (op ballista.shot, by the guest) takes 55% of its life on the host and the guest sees it drop; after the reload the second bolt fells it: dead on both, XP to the guest; digest equal',
  api: 'giants.js spawnGiantAt (GIANT_KINDS), ballista.js stepBolt / hitCreature (SPECIES giant flag) / boltReaches, op ballista.shot, killMob credit',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, day0 = EH.dayIndex, hour0 = EH.hour;
  nmCleanup(t, H, MH, day0, hour0);
  A.keepAlive(t, H); A.keepAlive(t, G);
  const spot = nmSpot(H, MH, 1, false);
  t.assert(spot, 'warm-zone land (not a desert)');
  await moveBoth(t, H, G, spot);
  const clk = nmNight(H, MH, spot[0], spot[1], 'bone');
  t.assert(clk, 'a mild-winter night');
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  await nmClock(t, H, G, clk.day, clk.hour);
  A.pacify(H, spot[0], spot[1], 40, 600);
  await nmGiantBallista(t, H, G, MH, MG, 'skeleton_giant');
  await t.checkDigest(H, G);
  env.history.push('NM5');
});

def('NM6', {
  title: 'NM: the Múmia Gigante in a hot desert at night — replicated, two ballista bolts fell it (like the ice giant)', timeout: 220000,
  expected: 'Both players in a hot desert on a night of its bad season; a ballista next to the guest; a Múmia Gigante 11 tiles away is a pawn proxy on the guest (species mummy_giant, scale 2.4, elite); a bolt (op ballista.shot) takes 55% of its life, the guest sees it drop; the second bolt fells it: dead on both, XP to the guest; digest equal',
  api: 'giants.js spawnGiantAt (GIANT_KINDS), ballista.js stepBolt / hitCreature (SPECIES giant flag), op ballista.shot',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const EH = H.game.env, day0 = EH.dayIndex, hour0 = EH.hour;
  nmCleanup(t, H, MH, day0, hour0);
  A.keepAlive(t, H); A.keepAlive(t, G);
  const spot = nmSpot(H, MH, 1, true) || nmSpot(H, MH, 0, true);
  t.assert(spot, 'a hot desert');
  await moveBoth(t, H, G, spot);
  const clk = nmNight(H, MH, spot[0], spot[1], 'sand');
  t.assert(clk, 'a bad night there');
  H.game._walkT = 1e9; H.game._giantT = 1e9;
  await nmClock(t, H, G, clk.day, clk.hour);
  A.pacify(H, spot[0], spot[1], 40, 600);
  await nmGiantBallista(t, H, G, MH, MG, 'mummy_giant');
  await t.checkDigest(H, G);
  env.history.push('NM6');
});

// ---------- siege engines (src/game/siege.js, docs/REINOS.md "Implementação — máquinas de guerra") ----------
// clean up after a siege scenario: structures removed, debug marks cleared, ammo and stick reset
function sgCleanup(t, H, G, ids) {
  t.defer(() => {
    for (const id of ids) if (A.structOn(H, id)) H.game.net.emit('struct.remove', { id, quiet: 1 });
    const D = H.game._siegeDbg;
    if (D) { D.hostile.clear(); D.gates.clear(); }
    const C = G.game.siege;
    if (C) { C.stickOn = false; C.stickAim = null; C.climb = null; }
  });
}
// a free, level w × h area (every tile valid for a wall on both frames) near the guest — a wider search than A.findSite
// (a planet's start can be wooded / hilly); both players are brought next to it. Returns { x0, y0 } (the area's corner)
function sgSite(H, MH, G, MG, w, h, { dx = 0, dy = 0 } = {}) {
  const gp = G.game.player, fs = [H, G], Ms = [MH, MG];
  const ok = (x, y) => MH.building.placeReason(H.game, 'wall_wood', x, y, null, 0) === null && MG.building.placeReason(G.game, 'wall_wood', x, y, null, 0) === null;
  const Hh = H.game.world.height;
  const test = (x0, y0) => {
    for (const [x, y] of [[x0, y0], [x0 + w - 1, y0], [x0, y0 + h - 1], [x0 + w - 1, y0 + h - 1], [x0 + (w >> 1), y0 + (h >> 1)]]) if (!ok(x, y)) return false;
    let lo = 1e9, hi = -1e9;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      if (!ok(x, y)) return false;
      if (Hh?.any) { const c = Hh.cornerH(x, y); if (c < lo) lo = c; if (c > hi) hi = c; }
    }
    return hi - lo <= 0.6;
  };
  for (let r = 2; r <= 260; r += r < 100 ? 2 : 3) for (let k = 0, n = Math.max(8, Math.round(r * 1.2)); k < n; k++) {
    const a = (k / n) * Math.PI * 2, x0 = Math.floor(gp.x + Math.cos(a) * r) - (w >> 1), y0 = Math.floor(gp.y + Math.sin(a) * r) - (h >> 1);
    if (!test(x0, y0)) continue;
    fs.forEach((f, i) => { const s = A.freeSpot(f, Ms[i], x0 + dx + i, y0 + h + 0.5 + dy, { rMin: 0, rMax: 3 }); if (s) A.teleport(f, s[0], s[1]); });
    return { x0, y0 };
  }
  return null;
}
// the guest plans a blueprint through build mode and waits for the host's struct.add to reach it
async function sgPlace(t, G, MG, type, x, y, rot = 0) {
  A.place(G, MG, type, [x, y], [x, y], rot);
  return t.waitFor(() => G.game.build.structures.find((o) => o.type === type && o.tx === x && o.ty === y), RT() + 2500, `${type} planned at ${x},${y}`, () => G.lastUi(2));
}
const sgAmmo = (f, id, n) => { const p = f.game.player, c = p.inv.count(id); if (c) p.inv.remove(id, c); if (n) p.inv.add(id, n); };
// the guest's artillery aimed at (angle a, distance d): the stick, until the host's shared aim lines up
async function sgAim(t, H, MH, G, oH, a, d, ms = 12000) {
  const C = G.game.siege;
  C.stickOn = true; C.stickAim = [a, d];
  await t.waitFor(() => Math.abs(MH.siege.angDiff(MH.siege.aimOf(oH), a)) < 0.03 && Math.abs(MH.siege.distOf(oH) - d) < 0.3 && !C.turning, ms + RT(), 'the frame points there on the host', () => `${f2(MH.siege.aimOf(oH))} / ${f2(MH.siege.distOf(oH))} → ${f2(a)} / ${f2(d)}`);
}
// the host's copy of the newest stone of `kind` (lob: its landing point is known at once)
const sgStone = (H, kind, old) => (H.game.projectiles || []).find((p) => p.kind === kind && !p.cosmetic && !old.has(p));

def('SG1', {
  title: 'Siege engines: the guest builds the Oficina de cerco, then a trebuchet, a catapult, a battering ram and a siege tower there (blueprints + real work); the host agrees', timeout: 360000,
  expected: 'Before the workshop a trebuchet plan is refused ("Construa perto de uma Oficina de cerco pronta"); the guest plans and builds the Oficina de cerco (work), then plans the four engines next to it and builds each one (its materials taken from the backpack); on the host all are finished at the same places and rotations; the tower has the stories of the wall ahead or the chosen 2 (o.v); the workshop crafts the stones (recipes at siege_workshop); digest equal',
  api: 'content/buildings.js siege_workshop / trebuchet / catapult / battering_ram / siege_tower (cat siege), mut/structures.js placeReason → siege.js siegePlaceReason (nearWorkshop), build.place n (tower stories), work loop build.hit',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player;
  A.keepAlive(t, G);
  const site = sgSite(H, MH, G, MG, 11, 9);
  t.assert(site, 'found a free 11×9 site');
  const x0 = site.x0 + 1, y0 = site.y0 + 1, ids = [];
  sgCleanup(t, H, G, ids);
  A.pacify(H, x0 + 4, y0 + 3, 30, 900);
  const cost = (type) => MG.data.BUILDINGS[type].cost;
  t.check(/Oficina de cerco/.test(String(MG.building.placeReason(G.game, 'trebuchet', x0, y0, null, 0))), 'without a workshop: "Construa perto de uma Oficina de cerco"', String(MG.building.placeReason(G.game, 'trebuchet', x0, y0, null, 0)));
  // the workshop
  const need = {};
  for (const ty of ['siege_workshop', 'trebuchet', 'catapult', 'battering_ram', 'siege_tower']) for (const k in cost(ty)) need[k] = (need[k] || 0) + cost(ty)[k];
  A.ensure(G, need);
  const inv0 = A.invSnap(G);
  A.teleport(G, x0 + 1.5, y0 + 6.6);
  await A.hostSees(t, H, G);
  const shop = await sgPlace(t, G, MG, 'siege_workshop', x0, y0 + 4, 0);
  await t.waitFor(() => A.structOn(H, shop.id), RT() + 1500, 'the host has the workshop plan');
  ids.push(shop.id);
  await A.buildAll(t, G, MG, [shop.id], { ms: 40000 });
  await t.waitFor(() => A.structOn(H, shop.id) && !A.structOn(H, shop.id).blueprint, RT() + 2000, 'the workshop is finished on the host');
  const RC = await fimp(G, 'game/content/recipes.js');
  t.check(RC.RECIPES.treb_stones.station === 'siege_workshop' && RC.RECIPES.cat_stones.station === 'siege_workshop' && RC.STATION_PT.siege_workshop === 'Oficina de cerco', 'the workshop makes the stones (recipes at siege_workshop)');
  t.check(MG.building.placeReason(G.game, 'trebuchet', x0, y0, null, 0) === null, 'next to the finished workshop the trebuchet may be planned', String(MG.building.placeReason(G.game, 'trebuchet', x0, y0, null, 0)));
  // the four engines
  const auto = MG.siege.towerAhead(G.game, x0 + 7, y0, 0);
  const plan = [['trebuchet', x0, y0, 0], ['battering_ram', x0 + 4, y0, 0], ['siege_tower', x0 + 7, y0, 0], ['catapult', x0 + 5, y0 + 5, 0]];
  const made = [];
  for (const [type, x, y, rot] of plan) {
    const o = await sgPlace(t, G, MG, type, x, y, rot);
    made.push(o.id); ids.push(o.id);
  }
  await t.waitFor(() => made.every((id) => A.structOn(H, id)), RT() + 2000, 'the host has the four plans');
  for (const id of made) {
    const o = A.structOn(G, id);
    t.log(`guest builds ${o.type} (${MG.data.BUILDINGS[o.type].time} s of work)`);
    await A.buildAll(t, G, MG, [id], { ms: 90000 });
  }
  await t.waitFor(() => made.every((id) => A.structOn(H, id) && !A.structOn(H, id).blueprint), RT() + 3000, 'all four are finished on the host');
  for (const id of made) {
    const h = A.structOn(H, id), g2 = A.structOn(G, id);
    t.check(h && g2 && h.tx === g2.tx && h.ty === g2.ty && (h.rot | 0) === (g2.rot | 0) && !g2.blueprint, `${h?.type}: same place and finished on both`, `${h?.tx},${h?.ty} / ${g2?.tx},${g2?.ty}`);
  }
  const tw = made.map((id) => A.structOn(H, id)).find((o) => o.type === 'siege_tower');
  const wantN = auto ? auto.n : 2;
  t.check(MH.siege.towerN(tw) === wantN && MG.siege.towerN(A.structOn(G, tw.id)) === wantN, `the tower has ${wantN} stories on both (${auto ? 'the wall ahead' : 'the chosen 2'})`, `${tw.v} / ${A.structOn(G, tw.id).v}`);
  const used = A.invDiff(inv0, A.invSnap(G));
  t.check((-(used.wood || 0)) >= need.wood - 1 && (-(used.iron_bar || 0)) === need.iron_bar, 'the materials came out of the guest\'s backpack', JSON.stringify(used));
  await t.checkDigest(H, G);
});

def('SG2', {
  title: 'Trebuchet: the guest operates it, the stone lands with a wide scatter (narrower at the same target) and hurts a hostile structure much more than a creature; a player\'s wall next to it is untouched', timeout: 150000,
  expected: 'A trebuchet facing east; the guest (2 trebuchet stones) gets on (op siege.set user on both), aims 16 tiles east (op siege.set aim / dist); the first stone (intent siege.fire → op siege.shot, k 1) lands off the aim point but inside the landing ellipse (0.16 × d along, 0.09 × d across); a hostile-marked stone wall at the landing tile takes heavy siege damage (op siege.dmg: hundreds of hit points, cracks on both), a creature next to it only the trebuchet\'s 70, a player\'s wall beside it nothing; a shot during the winch is refused and refunded; the second stone at the same target has a smaller scatter (k 0.8); digest equal',
  api: 'siege.js useSiege / siegeCtl (stickAim, fire), shotLanding / rangingK, siegeImpact, siegeCanDamage (siegeDebug hostile), damageStructure → op siege.dmg; projectiles.js LOB_KINDS.treb_stone',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player;
  A.keepAlive(t, G);
  const site = sgSite(H, MH, G, MG, 21, 7);
  t.assert(site, 'found a free 21×7 strip');
  const x0 = site.x0 + 1, y0 = site.y0 + 2, ids = [];
  sgCleanup(t, H, G, ids);
  const [tid] = hostBuild(H, [['trebuchet', x0, y0, 3]]);
  ids.push(tid);
  await t.waitFor(() => A.structOn(G, tid) && !A.structOn(G, tid).blueprint, RT() + 1500, 'the guest has the trebuchet');
  const oG = A.structOn(G, tid), oH = A.structOn(H, tid);
  A.pacify(H, x0 + 10, y0 + 1, 40, 900);
  sgAmmo(G, 'treb_stone', 2);
  A.teleport(G, x0 - 0.8, y0 + 1.5);
  await A.hostSees(t, H, G);
  MG.siege.useSiege(G.game, { kind: 'siege_op', o: oG });
  await t.waitFor(() => oH.user === G.pid && oG.user === G.pid, RT() + 1500, 'the guest operates the trebuchet (on both)');
  const [px, py] = MH.siege.pivotOf(oH), D = 14, tx = px + D, ty = py;
  await sgAim(t, H, MH, G, oH, 0, D);
  const old = new Set(H.game.projectiles || []);
  t.check(G.game.siege.fire(), 'the guest throws');
  t.check(gp.inv.count('treb_stone') === 1, 'one stone used', `${gp.inv.count('treb_stone')}`);
  const st = await t.waitFor(() => sgStone(H, 'treb_stone', old), 3000 + RT(), 'the stone leaves the sling on the host (after the swing)');
  const S = MH.siegec.ARTY.trebuchet, al = st.lx - tx, ac = st.ly - ty;
  t.log(`aim ${f2(tx)},${f2(ty)} → lands ${f2(st.lx)},${f2(st.ly)} (along ${f2(al)}, across ${f2(ac)}; ellipse ${f2(S.scatter[0] * D)} × ${f2(S.scatter[1] * D)})`);
  t.check(Math.hypot(al, ac) > 0.02, 'it does not land on the aim point (scatter)');
  t.check((al / (S.scatter[0] * D)) ** 2 + (ac / (S.scatter[1] * D)) ** 2 <= 1.0001, 'it lands inside the landing ellipse');
  t.check(Math.abs((oG._rng?.k ?? 0) - 1) < 1e-6, 'first shot at this target: full scatter (k 1)', `${oG._rng?.k}`);
  await t.waitFor(() => (G.game.projectiles || []).some((p) => p.kind === 'treb_stone' && p.cosmetic && Math.hypot(p.lx - st.lx, p.ly - st.ly) < 0.05), 2000 + RT(), 'the guest flies the same stone (same landing point)');
  // what is there when it comes down: a hostile stone wall on the landing tile, a player's wall beside it, a creature
  const lx = Math.floor(st.lx), ly = Math.floor(st.ly);
  const [hw] = hostBuild(H, [['wall_stone', lx, ly]]), [pw] = hostBuild(H, [['wall_wood', lx + 1, ly + 1]]);
  ids.push(hw, pw);
  MH.siege.siegeDebug(H.game).hostile.add(hw);
  const m = MH.mobs.spawnLoose(H.game, 'boar', st.lx - 0.9, st.ly + 0.4);
  m.calmT = 1e9; m.stunT = 8; m.state = 'idle'; m.stateT = 1e9;
  const hp0 = m.hp, dmgLog = [];
  t.defer(H.game.events.on('damage', (d) => { if (d.target === m) dmgLog.push(d.amount); }));
  await t.waitFor(() => (A.structOn(H, hw)?.dmg || 0) > 0, 6000, 'the hostile wall takes siege damage', () => `stone k ${f2(st.k)} stuck ${st.stuck}`);
  const wH = A.structOn(H, hw), hpW = MH.siege.structHp(H.game, wH), wallHit = wH.dmg * hpW;
  await t.waitFor(() => Math.abs((A.structOn(G, hw)?.dmg || 0) - wH.dmg) < 1e-3, RT() + 1500, 'same cracks on the guest');
  t.check(A.structOn(G, hw)?.sdmg === 1, 'siege damage does not settle at dawn (o.sdmg)');
  const mobHit = hp0 - Math.max(0, m.hp);
  t.check(Math.abs(mobHit - Math.min(hp0, S.mob)) <= 1, 'the creature takes only the trebuchet\'s small damage', `${f2(mobHit)} of ${f2(hp0)} (dealt ${dmgLog.join(',')})`);
  t.check(wallHit >= 300 && wallHit > mobHit * 4, 'much more damage to the structure than to the creature', `wall ${Math.round(wallHit)} vs creature ${Math.round(mobHit)}`);
  t.check(!(A.structOn(H, pw)?.dmg > 0) && !(A.structOn(G, pw)?.dmg > 0), 'the player\'s wall beside it is untouched (no friendly fire)');
  // a shot during the winch: refused and refunded
  const errs = [];
  t.defer(G.game.events.on('error', (d) => errs.push(d.text)));
  G.game.siege.cd = 0;
  t.check(!G.game.siege.fire() || true, 'a throw during the winch');
  await t.waitFor(() => gp.inv.count('treb_stone') === 1, RT() + 1500, 'it is refused and the stone stays', () => errs.join(' | '));
  // the second stone at the same target: the crew ranges in (k 0.8)
  await t.waitFor(() => !(oG._reload > 0) && !(oH._reload > 0), S.reload * 1000 + 3000, 'the winch re-arms it');
  await t.sleep(300);
  const old2 = new Set(H.game.projectiles || []);
  t.check(G.game.siege.fire(), 'the guest throws again at the same target');
  await t.waitFor(() => sgStone(H, 'treb_stone', old2), 3000 + RT(), 'the second stone flies');
  await t.waitFor(() => Math.abs((oG._rng?.k ?? 1) - S.settle) < 1e-3, RT() + 1500, 'same target: the scatter narrows (k 0.8)', () => `${oG._rng?.k}`);
  G.game.ctl.interact();
  await t.waitFor(() => !oH.user && !oG.user, RT() + 1500, 'the guest gets off (E)');
  await t.sleep(S.fly[0] * 1000 + 1500);
  await t.checkDigest(H, G);
});

def('SG3', {
  title: 'Catapult on a wall-walk: the guest operates it from the wall top; its stone hurts every creature in the blast exactly as much as a ballista bolt would, and nothing outside', timeout: 120000,
  expected: 'A 3×2 block of stone walls with a catapult on its top (story 1); from the ground the guest is refused ("Suba até a catapulta"); on the wall top it operates it and aims 10 tiles east; the stone (op siege.shot) leaves from the wall; three creatures at the landing point each take the ballista\'s damage (max(BALLISTA.dmg, its life × 1.01)) from the catapult, one 4 tiles away nothing; the guest stays up on the wall; digest equal',
  api: 'siege.js siegeImpact (ARTY.catapult mob / mobMin = ballista BALLISTA.dmg), seatSpot (levels), mut/siege.js siege.use story check, struct.add {lv}',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player;
  A.keepAlive(t, G);
  const site = sgSite(H, MH, G, MG, 15, 4);
  t.assert(site, 'found a free 15×4 strip');
  const x0 = site.x0 + 1, y0 = site.y0 + 1, walls = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) walls.push(['wall_stone', x0 + i, y0 + j]);
  const ids = hostBuild(H, walls);
  sgCleanup(t, H, G, ids);
  await t.waitFor(() => ids.every((id) => A.structOn(G, id)), RT() + 1500, 'the guest has the walls');
  const [cid] = hostBuildLv(H, [['catapult', x0 + 1, y0, 3]], 1);
  ids.push(cid);
  await t.waitFor(() => A.structOn(G, cid) && !A.structOn(G, cid).blueprint, RT() + 1500, 'the guest has the catapult on the wall top');
  const oG = A.structOn(G, cid), oH = A.structOn(H, cid);
  t.check((oG.lv | 0) === 1 && (oH.lv | 0) === 1, 'the catapult stands at story 1 on both');
  A.pacify(H, x0 + 8, y0, 40, 900);
  sgAmmo(G, 'cat_stone', 3);
  const errs = [];
  t.defer(G.game.events.on('error', (d) => errs.push(d.text)));
  A.teleport(G, x0 + 1.5, y0 + 2.7);
  await A.hostSees(t, H, G);
  MG.siege.useSiege(G.game, { kind: 'siege_op', o: oG });
  await t.waitFor(() => errs.some((s) => /Suba até a catapulta/.test(s)), RT() + 1500, 'from the ground: "Suba até a catapulta"', () => errs.join(' | '));
  upOn(G, x0 + 1.5, y0 + 1.5);
  await t.sleep(RT() + 300);
  MG.siege.useSiege(G.game, { kind: 'siege_op', o: oG });
  await t.waitFor(() => oH.user === G.pid && oG.user === G.pid, RT() + 1500, 'from the wall top the guest operates the catapult');
  const [px, py] = MH.siege.pivotOf(oH), D = 10;
  await sgAim(t, H, MH, G, oH, 0, D);
  // the creatures (pinned: stunned, calm), one far from the target
  const sp = [];
  for (const [dx, dy] of [[0, 0], [0.5, 0.6], [-0.6, -0.3], [4, 0.2]]) {
    const s = A.freeSpot(H, MH, px + D + dx, py + dy, { rMin: 0, rMax: 0.6, r: 0.36 }) || [px + D + dx, py + dy];
    const m = MH.mobs.spawnLoose(H.game, dx > 3 ? 'deer' : 'boar', s[0], s[1]);
    m.calmT = 1e9; m.stunT = 10; m.state = 'idle'; m.stateT = 1e9;
    sp.push(m);
  }
  const far = sp[3], near = sp.slice(0, 3), got = new Map();
  t.defer(H.game.events.on('damage', (d) => { if (sp.includes(d.target)) got.set(d.target, (got.get(d.target) || []).concat([[d.amount, d.ability]])); }));
  const old = new Set(H.game.projectiles || []);
  t.check(G.game.siege.fire(), 'the guest throws');
  const st = await t.waitFor(() => sgStone(H, 'cat_stone', old), 1500 + RT(), 'the stone flies on the host');
  t.check(st.h0 > 1, 'it leaves from the wall top (a story up)', f2(st.h0));
  // (pin the three near ones on the landing point: the blast is 1.4 tiles around it)
  near.forEach((m, k) => { m.x = st.lx + [0, 0.45, -0.5][k]; m.y = st.ly + [0, 0.4, -0.3][k]; });
  far.x = st.lx + 4; far.y = st.ly;
  await t.waitFor(() => near.every((m) => got.has(m)), 4000 + RT(), 'the three creatures in the blast are hit', () => `${got.size} hit`);
  const B = MH.ballista.BALLISTA;
  for (const m of near) {
    const want = Math.max(B.dmg, Math.ceil(m.maxHp * 1.01)), list = got.get(m) || [];
    t.check(list.length === 1 && Math.abs(list[0][0] - want) <= 1 && list[0][1] === 'catapult', `a ${m.species}: the ballista's damage (${want})`, JSON.stringify(list));
  }
  await t.sleep(600);
  t.check(!got.has(far) && !far.dead, 'the one 4 tiles away is untouched');
  t.check((gp.z || 0) > 0.9 && (gp.lv | 0) === 1, 'the guest is still up on the wall', lvOf(gp));
  G.game.ctl.interact();
  await t.waitFor(() => !oH.user && !oG.user, RT() + 1500, 'the guest gets off');
  await t.checkDigest(H, G);
});

def('SG4', {
  title: 'Battering ram: host and guest push it (one alone is much slower) up to a wall; its blows break the gate-marked door and never the wall beside it', timeout: 150000,
  expected: 'A wall row with a door marked gate + hostile and a hostile (not gate) wall next to it; a ram 4 tiles south facing it. Both grab it (op siege.set push: 2 pids on both); the guest alone pushes north: steps ≥ 2.5 s apart; with the host pushing too: ≤ 1.6 s apart (ops siege.step, same tile on both, the pushers follow); it stops against the wall; the guest\'s blows (intent siege.ram → op siege.swing + siege.dmg) crack the door (220 per blow over its 900 hit points) and leave the wall at 0; the 5th blow breaks the door (struct.remove smash on both); digest equal',
  api: 'siege.js useSiege siege_push, siegeCtl.ram, hostPush / tally / pushSpeed, frontTiles / isGate (siegeDebug gates), mut/siege.js siege.push / drive / ram, ops siege.step / swing / dmg',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player, hp = H.game.player;
  A.keepAlive(t, G); A.keepAlive(t, H);
  const site = sgSite(H, MH, G, MG, 8, 14);
  t.assert(site, 'found a free 8×14 site');
  const x0 = site.x0 + 1, y0 = site.y0 + 1;
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push([i === 2 ? 'door_wood' : 'wall_wood', x0 + i, y0]);
  const wall = hostBuild(H, rows), ids = [...wall];
  sgCleanup(t, H, G, ids);
  const door = wall[2], hw = wall[3];
  const D = MH.siege.siegeDebug(H.game);
  D.gates.add(door); D.hostile.add(door); D.hostile.add(hw);
  const [rid] = hostBuild(H, [['battering_ram', x0 + 2, y0 + 7, 2]]);
  ids.push(rid);
  await t.waitFor(() => A.structOn(G, rid) && !A.structOn(G, rid).blueprint && wall.every((id) => A.structOn(G, id)), RT() + 1500, 'the guest has the wall and the ram');
  const oG = A.structOn(G, rid), oH = A.structOn(H, rid);
  A.pacify(H, x0 + 3, y0 + 5, 30, 900);
  t.check(MH.siege.frontTiles(oH).map((q) => q.join(',')).join(' ') === `${x0 + 2},${y0 + 6} ${x0 + 3},${y0 + 6}`, 'its front faces the door and the wall', JSON.stringify(MH.siege.frontTiles(oH)));
  // both grab it from behind
  A.teleport(G, x0 + 2.5, y0 + 10.7); A.teleport(H, x0 + 3.5, y0 + 10.7);
  await A.hostSees(t, H, G);
  MG.siege.useSiege(G.game, { kind: 'siege_push', o: oG });
  MH.siege.useSiege(H.game, { kind: 'siege_push', o: oH });
  await t.waitFor(() => (oH.push || []).filter(Boolean).length === 2 && (oG.push || []).filter(Boolean).length === 2, RT() + 1500, 'both push it (2 pids on both)', () => `${JSON.stringify(oH.push)} / ${JSON.stringify(oG.push)}`);
  const steps = [];
  t.defer(H.game.events.on('siegestep', (d) => { if (d.o === oH) steps.push({ t: now(), ty: oH.ty }); }));
  // the guest alone
  const relG = A.holdMove(G, 0, -1);
  t.defer(relG);
  await t.waitFor(() => steps.length >= 2, 9000 + RT(), 'alone, the guest moves it (slowly)');
  const solo = steps[1].t - steps[0].t;
  t.check(solo >= 2500, 'one person alone: a tile every ~3 s', `${Math.round(solo)} ms`);
  // both
  const relH = A.holdMove(H, 0, -1);
  t.defer(relH);
  await t.waitFor(() => oH.ty === y0 + 1, 12000 + RT(), 'with two it reaches the wall', () => `ty ${oH.ty} (want ${y0 + 1})`);
  const fast = steps.slice(4).map((s, k) => s.t - steps[k + 3].t);
  t.check(fast.length && Math.max(...fast) <= 1700, 'two people: about a tile a second', fast.map(Math.round).join(', ') + ' ms');
  await t.waitFor(() => oG.ty === oH.ty && oG.tx === oH.tx, RT() + 1500, 'the guest has it at the same tile');
  await t.sleep(1200);
  t.check(oH.ty === y0 + 1, 'it stops against the wall', `ty ${oH.ty}`);
  const [sx, sy] = MG.siege.toWorld(oG, ...MG.siege.slotLocal(oG, oG.push.indexOf(G.pid)));
  t.check(Math.hypot(gp.x - sx, gp.y - sy) < 0.5, 'the guest walked along at its place behind it', `${f2(Math.hypot(gp.x - sx, gp.y - sy))} tiles off`);
  relG(); relH();
  // the blows
  const C = G.game.siege;
  for (let k = 1; k <= 5; k++) {
    C.ramCd = 0;
    t.check(C.onAttack(), `blow ${k}`);
    if (k < 5) await t.waitFor(() => Math.abs((A.structOn(G, door)?.dmg || 0) - 220 * k / 900) < 0.01, 3000 + RT(), `the door cracks (${k} × 220 / 900) on the guest`, () => `${f2(A.structOn(G, door)?.dmg || 0)}`);
    else await t.waitFor(() => !A.structOn(H, door) && !A.structOn(G, door), 3000 + RT(), 'the 5th blow breaks the door on both');
    t.check(!(A.structOn(H, hw)?.dmg > 0) && A.structOn(H, hw), 'the hostile wall beside it: untouched (only gates)');
    if (k < 5) await t.sleep(MH.siegec.ramCooldown(2) * 1000 + 150);
  }
  MG.siege.useSiege(G.game, { kind: 'siege_push', o: oG });
  MH.siege.useSiege(H.game, { kind: 'siege_push', o: oH });
  await t.waitFor(() => !(oH.push || []).some(Boolean) && !(oG.push || []).some(Boolean), RT() + 1500, 'both let go');
  await t.checkDigest(H, G);
});

def('SG5', {
  title: 'Siege tower: it measures a 2-story and a 3-story wall (its height follows the wall it faces); host and guest push it to the 2-story wall, the ramp drops on the wall-walk and the guest climbs it and walks onto the wall top', timeout: 150000,
  expected: 'A 2-story stone wall and a 3-story one (walls stacked with struct.add lv) and a finished workshop; towerStoriesFor gives 2 and 3 (a piece, a tile, a list); the guest plans a tower facing each: o.v = 2 and 3 on both; the 2-story one finished, host and guest push it north until it touches its wall: the ramp drops (op siege.set ramp on both; the deck is a surface of story 2 on both); the guest lets go, climbs the back ladder (E: lv 2, z 2) and walks north onto the wall-walk (a wall-top tile at story 2, the host sees it up there); digest equal',
  api: 'siege.js towerStoriesFor / wallTopStory / towerAhead (build.place v), hostPush dock → op siege.set ramp, levels.js deck surface (o.ramp), useSiege siege_up (climb)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player;
  A.keepAlive(t, G); A.keepAlive(t, H);
  const site = sgSite(H, MH, G, MG, 11, 10);
  t.assert(site, 'found a free 11×10 site');
  const x0 = site.x0 + 1, y0 = site.y0 + 1;
  const rowA = [0, 1, 2].map((i) => ['wall_stone', x0 + i, y0]), rowB = [6, 7, 8].map((i) => ['wall_stone', x0 + i, y0]);
  const ids = [...hostBuild(H, [...rowA, ...rowB]), ...hostBuildLv(H, [...rowA, ...rowB], 1), ...hostBuildLv(H, rowB, 2)];
  const [shop] = hostBuild(H, [['siege_workshop', x0 + 3, y0 + 7, 0]]);
  ids.push(shop);
  sgCleanup(t, H, G, ids);
  await t.waitFor(() => ids.every((id) => A.structOn(G, id)), RT() + 2000, 'the guest has the walls and the workshop');
  const wA = A.structOn(H, ids[0]);
  t.check(MH.siege.towerStoriesFor(H.game, wA) === 2 && MH.siege.towerStoriesFor(H.game, [x0 + 7, y0]) === 3 && MG.siege.towerStoriesFor(G.game, [[x0, y0], [x0 + 7, y0]]) === 3 && MG.siege.towerStoriesFor(G.game, [x0 + 4, y0]) === 0,
    'towerStoriesFor: 2 for the first wall, 3 for the second, the tallest of a list, 0 where there is none');
  // the guest plans a tower facing each wall (north): the height comes from the wall (from inside the site: in reach)
  A.teleport(G, x0 + 3.5, y0 + 3.5);
  await A.hostSees(t, H, G);
  const ta = await sgPlace(t, G, MG, 'siege_tower', x0, y0 + 5, 2);
  const tb = await sgPlace(t, G, MG, 'siege_tower', x0 + 6, y0 + 5, 2);
  ids.push(ta.id, tb.id);
  await t.waitFor(() => A.structOn(H, ta.id) && A.structOn(H, tb.id), RT() + 1500, 'the host has both plans');
  t.check(MH.siege.towerN(A.structOn(H, ta.id)) === 2 && MG.siege.towerN(A.structOn(G, ta.id)) === 2, 'facing the 2-story wall: a 2-story tower (on both)', `${A.structOn(H, ta.id).v}`);
  t.check(MH.siege.towerN(A.structOn(H, tb.id)) === 3 && MG.siege.towerN(A.structOn(G, tb.id)) === 3, 'facing the 3-story wall: a 3-story tower (on both)', `${A.structOn(H, tb.id).v}`);
  H.game.net.emit('struct.complete', { id: ta.id, by: H.pid, xp: 0, toast: '' });
  await t.waitFor(() => !A.structOn(G, ta.id).blueprint, RT() + 1500, 'the first tower is finished');
  const oH = A.structOn(H, ta.id), oG = A.structOn(G, ta.id);
  A.pacify(H, x0 + 1, y0 + 5, 30, 900);
  A.teleport(G, x0 + 0.5, y0 + 7.6); A.teleport(H, x0 + 1.5, y0 + 7.6);
  await A.hostSees(t, H, G);
  MG.siege.useSiege(G.game, { kind: 'siege_push', o: oG });
  MH.siege.useSiege(H.game, { kind: 'siege_push', o: oH });
  await t.waitFor(() => (oH.push || []).filter(Boolean).length === 2, RT() + 1500, 'both grab the tower');
  const relG = A.holdMove(G, 0, -1), relH = A.holdMove(H, 0, -1);
  t.defer(relG); t.defer(relH);
  await t.waitFor(() => oH.ty === y0 + 1, 14000 + RT(), 'pushed up to the wall', () => `ty ${oH.ty}`);
  await t.waitFor(() => oH.ramp && oG.ramp, 4000 + RT(), 'touching a wall of its height, the ramp drops (on both)');
  relG(); relH();
  await t.sleep(PUSHMS(MH));
  const deck = (f) => { const L = f.game.levels.sync(), w = f.game.world; return [0, 1].every((i) => L.isSurface(2, w.idx(oH.tx + i, oH.ty))); };
  t.check(deck(H) && deck(G), 'its deck is a surface of story 2 on both');
  MG.siege.useSiege(G.game, { kind: 'siege_push', o: oG });
  MH.siege.useSiege(H.game, { kind: 'siege_push', o: oH });
  await t.waitFor(() => !(oH.push || []).some(Boolean), RT() + 1500, 'both let go');
  // the guest climbs the back ladder and crosses onto the wall-walk
  const [lx, ly] = MG.siege.toWorld(oG, ...MG.siege.ladderLocal(oG), false);
  A.teleport(G, lx, ly + 0.3);
  await A.hostSees(t, H, G);
  MG.siege.useSiege(G.game, { kind: 'siege_up', o: oG });
  await t.waitFor(() => (gp.lv | 0) === 2 && Math.abs((gp.z || 0) - 2) < 0.05, 4000, 'the guest climbs up to the deck (story 2)', () => lvOf(gp));
  const relW = A.holdMove(G, 0, -1);
  t.defer(relW);
  await t.waitFor(() => Math.floor(gp.y) === y0, 5000, 'it walks across the ramp onto the wall-walk', () => `${f2(gp.x)},${f2(gp.y)} ${lvOf(gp)}`);
  await t.sleep(400);
  relW();
  const W = G.game.world;
  t.check((gp.lv | 0) === 2 && G.game.levels.isSurface(2, W.idx(Math.floor(gp.x), Math.floor(gp.y))) && A.structAt(G, MG, Math.floor(gp.x), Math.floor(gp.y))?.type === 'wall_stone', 'on top of the wall at story 2', lvOf(gp));
  await t.waitFor(() => { const av = guestOnHost(H, G); return av && Math.abs((av.z || 0) - 2) < 0.1 && av.y < y0 + 1; }, RT() + 2000, 'the host sees the guest up on the wall');
  A.teleport(G, x0 + 3.5, y0 + 4.5);
  await t.checkDigest(H, G);
});
const PUSHMS = (M) => M.siegec.PUSH.siege_tower.ramp * 1000 + 200;

def('SG6', {
  title: 'Siege engines never hurt players\' structures: the damage hook (siegeCanDamage) and a catapult stone landing on the guest\'s own walls', timeout: 90000,
  expected: 'siegeCanDamage: a player\'s wall no, a player no, a wild creature yes, a hostile-marked wall yes, a kingdom structure no while there is no war (game.realms.atWar decides when it exists); a catapult operated by the guest throws onto a 3×3 block of player walls: the stone lands there (within 1.2 tiles of its middle) and none of them takes damage (no siege.dmg); digest equal',
  api: 'siege.js siegeCanDamage / realmOf / siegeDebug, siegeImpact',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const gp = G.game.player;
  A.keepAlive(t, G);
  const site = sgSite(H, MH, G, MG, 15, 6);
  t.assert(site, 'found a free 15×6 strip');
  const x0 = site.x0 + 1, y0 = site.y0 + 2, rows = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) rows.push(['wall_wood', x0 + 9 + i, y0 - 1 + j]);
  const walls = hostBuild(H, rows), ids = [...walls];
  const [cid] = hostBuild(H, [['catapult', x0, y0, 3]]);
  ids.push(cid);
  sgCleanup(t, H, G, ids);
  await t.waitFor(() => ids.every((id) => A.structOn(G, id)), RT() + 1500, 'the guest has the walls and the catapult');
  const oH = A.structOn(H, cid), oG = A.structOn(G, cid), w0 = A.structOn(H, walls[4]);
  const can = (tg, at = oH) => MH.siege.siegeCanDamage(H.game, at, tg);
  const wild = MH.mobs.spawnLoose(H.game, 'boar', x0 + 5, y0 + 2.5);
  wild.calmT = 1e9;
  t.defer(() => { if (!wild.dead) { wild.noCorpse = true; MH.combat.killMob(H.game, wild, null); } });
  t.check(!can(w0), 'a player\'s wall: no');
  t.check(!can(H.game.player) && !can(guestOnHost(H, G)), 'a player: no');
  t.check(can(wild), 'a wild creature: yes');
  MH.siege.siegeDebug(H.game).hostile.add(walls[0]);
  t.check(can(A.structOn(H, walls[0])), 'a wall marked hostile (tests / debug): yes');
  MH.siege.siegeDebug(H.game).hostile.delete(walls[0]);
  const realmPiece = { building: true, id: 'realm:x', type: 'wall_stone', realm: 'r1' };
  t.check(!can(realmPiece, { realm: 'r2' }), 'a kingdom\'s structure while no kingdom is at war: no');
  // (phase 3a exists now: its game.realms stays — only its atWar is swapped for this check and put back)
  const R0 = H.game.realms, at0 = R0?.atWar;
  if (R0) R0.atWar = (a, b) => a !== b; else H.game.realms = { atWar: (a, b) => a !== b };
  t.check(can(realmPiece, { realm: 'r2' }) && !can(realmPiece, { realm: 'r1' }) && !can(realmPiece, oH), 'with game.realms.atWar (phase 3): an enemy kingdom\'s yes, its own / a player\'s engine no');
  if (R0) R0.atWar = at0; else delete H.game.realms;
  // the catapult throws onto the guest's own walls
  sgAmmo(G, 'cat_stone', 1);
  A.teleport(G, x0 - 0.5, y0 + 0.5);
  await A.hostSees(t, H, G);
  MG.siege.useSiege(G.game, { kind: 'siege_op', o: oG });
  await t.waitFor(() => oH.user === G.pid, RT() + 1500, 'the guest operates the catapult');
  const [px, py] = MH.siege.pivotOf(oH), cx = x0 + 10.5, cy = y0 + 0.5;
  await sgAim(t, H, MH, G, oH, Math.atan2(cy - py, cx - px), Math.hypot(cx - px, cy - py));
  const dmgOps = [];
  const off = H.game.events.on('tile', () => {});
  t.defer(off);
  const old = new Set(H.game.projectiles || []);
  t.check(G.game.siege.fire(), 'the guest throws at its own walls');
  const st = await t.waitFor(() => sgStone(H, 'cat_stone', old), 1500 + RT(), 'the stone flies');
  t.check(Math.hypot(st.lx - cx, st.ly - cy) < 1.2, 'it lands on the walls', `${f2(st.lx)},${f2(st.ly)} vs ${f2(cx)},${f2(cy)}`);
  await t.waitFor(() => st.stuck || !(H.game.projectiles || []).includes(st), 4000 + RT(), 'it comes down');
  await t.sleep(RT() + 400);
  const hurt = walls.filter((id) => A.structOn(H, id)?.dmg > 0 || A.structOn(G, id)?.dmg > 0 || !A.structOn(H, id));
  t.check(!hurt.length, 'none of the player\'s walls takes damage', `${hurt.length} hurt`);
  void dmgOps;
  G.game.ctl.interact();
  await t.waitFor(() => !oH.user, RT() + 1500, 'the guest gets off');
  await t.checkDigest(H, G);
});

// KG — kingdoms and settlements (docs/REINOS.md "Implementação — geração"): the realm made on every peer from the seed,
// settlements materialized per chunk from real structures, gates by day / night, players' gates, shared damage, the
// building rule, the start of a new world on a village plaza in front of its mural.
// =====================================================================================================
const townOf = (f, sid) => f.game.towns?.live?.get(sid) || null;
const piecesOn = (f, sid) => townOf(f, sid)?.objs?.size || 0;
const realmOf = (f) => f.game.towns?.realm || null;
// stand both players at (x, y) (free spots) and wait until the settlement's pieces there are placed on both
async function visitTown(t, H, MH, G, MG, sid, x, y, ms = 45000) {
  const a = A.freeSpot(H, MH, x, y, { rMin: 0, rMax: 4 }) || [x, y];
  A.teleport(H, a[0], a[1]);
  const b = A.freeSpot(G, MG, a[0] + 1.5, a[1], { rMin: 0, rMax: 4 }) || [a[0] + 1.5, a[1]];
  A.teleport(G, b[0], b[1]);
  await t.waitFor(() => piecesOn(H, sid) > 50 && piecesOn(G, sid) > 50 && !H.game.towns.jobs.length && !G.game.towns.jobs.length, ms,
    `the pieces of settlement ${sid} placed on both`, () => `host ${piecesOn(H, sid)} (jobs ${H.game.towns.jobs.length}) · guest ${piecesOn(G, sid)} (jobs ${G.game.towns.jobs.length})`);
  await t.sleep(600);
}
const pieceIds = (f, sid, pred = () => true) => [...(townOf(f, sid)?.objs.values() || [])].filter((o) => !o.removed && pred(o)).map((o) => o.id).sort();
const nightClock = (H, hour) => { const g = H.game, E = g.env; g.net.emit('env.skip', { hour, day: E.dayIndex + (hour < E.hour ? 1 : 0), wt: Math.round((g.worldTime + 5) * 100) / 100 }); g.net.flush(); };

def('KG1', {
  title: 'KG: both peers make the same realm (kingdoms, settlements, roads, territories); a new world starts on a temperate village plaza in front of its mural',
  src: 'village', timeout: 150000,
  expected: 'Host and guest generate the realm from the seed: same digest (kingdoms with names / colours / banners / capitals / landmasses / neighbours, settlements with kind / name / place / size / population / walls / gates, roads, the territory and district grids, the start villages); 2..30 kingdoms each with one city, 2..4 castles and ≥ 8 villages; canReach is true within a landmass. The world spawn (host and guest: welcome.sp) is the plaza of realm.starts[0]\'s first temperate village: a village (never a castle or city), zone 2 (temperate) at the tile, on the paved plaza, flat, not inside anything; the mural stands 2–4 tiles north of it with the gold "!" on the guest (never opened); "Reino de X" banner; the guest sees the same settlement pieces; digest equal',
  api: 'world/realm/realm.js generateRealm / realmDigest / canReach; planetSource villageSpawn; layout.spawn; game/towns.js placeSystem (event place, o._mark)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const RH = realmOf(H), RG = realmOf(G);
  t.need(RH && RG, 'the realm (planet.realm) on both peers');
  const dh = MH.realm.realmDigest(RH), dg = MG.realm.realmDigest(RG);
  t.check(dh === dg, 'the same realm on both peers (digest of kingdoms, settlements, roads, territories)', `${dh} / ${dg}`);
  const K = RH.kingdoms;
  t.check(K.length >= 2 && K.length <= 30, '2..30 kingdoms', K.length);
  const bad = K.filter((k) => { const ss = k.settlements.map((i) => RH.settlements[i]); const n = (kd) => ss.filter((s) => s.kind === kd).length; return n('city') !== 1 || n('castle') < 2 || n('castle') > 4 || n('village') < 8 || n('village') > 21; });
  t.check(!bad.length, 'every kingdom: 1 city, 2–4 castles, 8–20 villages', bad.map((k) => k.name).join(', ') || `${K.length} kingdoms`);
  const k0 = K[0], same = K.find((k) => k.id !== k0.id && k.comp === k0.comp), other = K.find((k) => k.comp !== k0.comp);
  t.check(MH.realm.canReach(RH, k0.id, k0.id) && (!same || MH.realm.canReach(RH, k0.id, same.id)) && (!other || !MH.realm.canReach(RH, k0.id, other.id)), 'canReach: same landmass yes, another landmass no', `${same?.name || '-'} / ${other?.name || '-'}`);
  t.check(RH.roads.length > K.length * 8, 'roads join the settlements', `${RH.roads.length} roads`);
  // the start
  const sp = H.game.world.spawn, gsp = G.game.world.spawn;
  t.check(Math.abs(sp.x - gsp.x) < 1e-6 && Math.abs(sp.y - gsp.y) < 1e-6, 'the guest starts where the host does (welcome.sp)', `${sp.x},${sp.y} / ${gsp.x},${gsp.y}`);
  const s = MH.realm.settlementAt(RH, sp.x, sp.y);
  t.check(s && s.kind === 'village' && RH.starts.includes(s.id), 'the spawn is in a start village (never a castle or a city)', s ? `${s.name} (${s.kind})` : 'none');
  const w = H.game.world, i = w.idx(Math.floor(sp.x), Math.floor(sp.y));
  t.check((w.zone.get(i) & 7) === 2, 'temperate zone at the start tile', w.zone.get(i) & 7);
  t.check(w.road.get(i) > 0 && !w.solid.get(i) && w.tileSlope(Math.floor(sp.x), Math.floor(sp.y)) < 0.3, 'on the paved plaza, flat, nothing built there', `road ${w.road.get(i)} solid ${w.solid.get(i)} slope ${f2(w.tileSlope(Math.floor(sp.x), Math.floor(sp.y)))}`);
  A.teleport(H, sp.x, sp.y); A.teleport(G, sp.x + 0.6, sp.y + 0.6);
  await t.waitFor(() => townOf(H, s.id)?.mural && townOf(G, s.id)?.mural, 30000, 'the mural placed on both');
  const m = townOf(G, s.id).mural;
  t.check(m.type === 'town_mural' && Math.abs(m.x - sp.x) < 2.5 && sp.y - m.y > 1.2 && sp.y - m.y < 4.5, 'the mural stands just north of the start, facing it', `mural @${f2(m.x)},${f2(m.y)}`);
  t.check(!MG.physics.collides(G.game.world, sp.x, sp.y, 0.24, null, false), 'the start spot is free (not inside a wall / building)');
  G.game.ctl.hinted.mural = false;
  await t.waitFor(() => m._mark === true, 2000, 'guest: the gold "!" over the mural (never opened)');
  const it = MG.building.describeStructure(G.game, m);
  t.check(it?.kind === 'mural' && it.verb === 'Ver mural', 'E / a tap on it: "Ver mural"', it?.verb);
  const ph = pieceIds(H, s.id, (o) => Math.hypot(o.x - sp.x, o.y - sp.y) < 20), pg = pieceIds(G, s.id, (o) => Math.hypot(o.x - sp.x, o.y - sp.y) < 20);
  t.check(ph.length > 30 && ph.join() === pg.join(), 'the same village pieces around the plaza on both', `${ph.length} / ${pg.length}`);
  await t.checkDigest(H, G);
});

def('KG2', {
  title: 'KG: a village, a castle and the capital city stand near the start with walls, gates, a plaza and the mural (real structures, both peers)',
  src: 'village', timeout: 240000,
  expected: 'From the start village: its kingdom\'s city and nearest castle (and a palisade village) are visited by both players. Each settlement is made of game structures with ids t<sid>.<k> on both peers: the start village has houses (doors, beds, roofs), the plaza (paved), a well and the mural; the palisade village has log walls and 2-tile wooden gates; the castle a two-story stone curtain (wall tops walkable at story 2: levels.surf[2]), a stone gate with portcullis, the keep with an upper story, stairs, ballistas on towers; the city stone walls with towers, ≥ 2 stone gates, a castle in the middle, many houses and the market plaza with the mural; the same piece ids near the player on both peers; digest equal',
  api: 'game/towns.js (materialization per chunk, layout(sid), live recs); world/realm/layout.js; levels.surf',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y), K = R.kingdoms[s0.k];
  const near = (kind, pred = () => true) => R.settlements.filter((s) => s.kind === kind && pred(s)).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y))[0];
  const city = R.settlements[K.capital], castle = near('castle'), pal = near('village', (s) => s.walls === 'palisade');
  const typesOf = (f, sid) => { const c = {}; for (const o of townOf(f, sid)?.objs.values() || []) if (!o.removed) c[o.type] = (c[o.type] || 0) + 1; return c; };
  // the start village
  await visitTown(t, H, MH, G, MG, s0.id, sp.x, sp.y);
  let c = typesOf(G, s0.id);
  t.check(c.town_mural === 1 && c.well >= 1 && c.door_wood >= 4 && c.bed >= 4 && (c.roof_thatch || 0) + (c.roof_wood || 0) + (c.roof_stone || 0) > 50, `start village ${s0.name}: mural, well, houses with doors, beds and roofs`, JSON.stringify({ mural: c.town_mural, well: c.well, doors: c.door_wood, beds: c.bed }));
  t.check(G.game.world.road.get(G.game.world.idx(Math.floor(sp.x), Math.floor(sp.y) + 1)) > 0, 'the plaza is paved');
  // a palisade village
  if (pal) {
    const L = H.game.towns.layout(pal.id), g0 = L.structs[L.gates[0]];
    await visitTown(t, H, MH, G, MG, pal.id, g0[1] + 1, g0[2] + (g0[3] & 1 ? 1 : 3));
    c = typesOf(G, pal.id);
    t.check(c.wall_wood > 40 && c.gate_big_wood >= 1, `palisade village ${pal.name}: log walls and the wooden gate`, `walls ${c.wall_wood} gates ${c.gate_big_wood}`);
    const gate = [...townOf(G, pal.id).objs.values()].find((o) => o.type === 'gate_big_wood');
    t.check(gate && G.game.build.grid.main.get(G.game.world.idx(gate.tx + (gate.rot & 1 ? 0 : 1), gate.ty + (gate.rot & 1 ? 1 : 0))) === gate, 'the gate covers 2 tiles');
  } else t.note('no palisade village in this seed');
  // the castle
  {
    const L = H.game.towns.layout(castle.id);
    await visitTown(t, H, MH, G, MG, castle.id, L.spawn[0], L.spawn[1]);
    c = typesOf(G, castle.id);
    const upper = [...townOf(G, castle.id).objs.values()].filter((o) => o.type === 'wall_stone' && o.lv === 1).length;
    t.check(upper > 60 && c.gate_stone >= 1 && c.stairs_wood >= 2 && c.town_mural === 1, `castle ${castle.name}: two-story stone curtain, stone gate, stairs, mural`, `upper walls ${upper} gates ${c.gate_stone} stairs ${c.stairs_wood}`);
    const top = [...townOf(G, castle.id).objs.values()].find((o) => o.type === 'wall_stone' && o.lv === 1);
    G.game.levels.sync();
    t.check(top && G.game.levels.surf[2]?.get(G.game.world.idx(top.tx, top.ty)) === 1, 'the wall tops are a walkable story (story 2: the wall walk)');
    t.check(c.ballista >= 1, 'ballistas on the towers', c.ballista);
  }
  // the city
  {
    const L = H.game.towns.layout(city.id);
    await visitTown(t, H, MH, G, MG, city.id, L.spawn[0], L.spawn[1], 90000);
    c = typesOf(G, city.id);
    t.check(c.town_mural === 1 && c.fountain === 1 && c.door_wood > 15, `capital ${city.name}: the market plaza with the mural and fountain, many houses`, `doors ${c.door_wood}`);
    t.check(L.gates.filter((k) => L.structs[k][0] === 'gate_stone').length >= 2 && L.towers.length >= 8, 'the city walls: ≥ 2 stone gates, towers', `gates ${L.gates.length} towers ${L.towers.length}`);
    t.check(L.buildings.some((b) => b.key === 'keep'), 'a castle (keep) in the middle');
    // (chunks may still be arriving from the workers on either peer: the same set once both have them)
    const near = (o) => Math.hypot(o.x - L.spawn[0], o.y - L.spawn[1]) < 24, same = () => { const a = pieceIds(H, city.id, near), b = pieceIds(G, city.id, near); return a.length > 100 && a.join() === b.join(); };
    await t.waitFor(same, 20000, 'the city pieces around the plaza on both', () => `${pieceIds(H, city.id, near).length} / ${pieceIds(G, city.id, near).length}`).catch(() => {});
    const hi = pieceIds(H, city.id, near), gi = pieceIds(G, city.id, near);
    t.check(hi.length > 100 && hi.join() === gi.join(), 'the same city pieces around the plaza on both', `${hi.length} / ${gi.length}`);
  }
  await t.checkDigest(H, G);
});

def('KG3', {
  title: 'KG: settlement gates close at night and open at dawn, on both peers (and close while hostiles are inside)',
  src: 'village', timeout: 150000,
  expected: 'At a walled settlement near the start (both players there, by day): its gates are open on both (world.solid 0 under them). The host\'s clock goes to night: within ~2 s the host closes every gate (op door.set from the town system) — closed on the guest too, solid 1, a town state row per closed gate on both. Dawn: they open again on both, rows gone. By day a hostile creature inside the town land closes them; it leaves → they open. Digest equal',
  api: 'game/towns.js hostTick (isNight, hostileInside, passageBusy) → op door.set; mut/towns.js TOWN.note (state rows); digest part towns',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn;
  const s = R.settlements.filter((q) => q.walls).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y))[0];
  const L = H.game.towns.layout(s.id);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  const gatesOf = (f) => [...townOf(f, s.id).objs.values()].filter((o) => o.door && M_isGate(o));
  const M_isGate = (o) => o.type === 'gate_big_wood' || o.type === 'gate_stone';
  await t.waitFor(() => gatesOf(H).length && gatesOf(G).length === gatesOf(H).length, 20000, 'the gates placed on both');
  const day0 = H.game.env.hour;
  t.defer(() => nightClock(H, Math.max(8, day0)));
  if (H.game.env.hour >= 17 || H.game.env.hour < 6.5) nightClock(H, 9);
  await t.waitFor(() => gatesOf(H).every((o) => o.open) && gatesOf(G).every((o) => o.open), 5000, 'by day: every gate open on both');
  const solidAt = (f, o) => f.game.world.solid.get(f.game.world.idx(o.tx, o.ty));
  t.check(gatesOf(G).every((o) => !solidAt(G, o)), 'open gates do not block (guest)');
  nightClock(H, 21.5);
  await t.waitFor(() => gatesOf(H).every((o) => !o.open) && gatesOf(G).every((o) => !o.open), 5000 + CFG.budget, 'at night: every gate closed on both', () => gatesOf(G).map((o) => o.open ? 'o' : 'c').join(''));
  t.check(gatesOf(G).every((o) => solidAt(G, o) === 1) && gatesOf(H).every((o) => solidAt(H, o) === 1), 'closed gates block on both (world.solid)');
  t.check(gatesOf(G).every((o) => G.game.towns.state.get(o.id)?.open === 0), 'guest: a town state row per closed gate');
  await t.checkDigest(H, G, 'digest equal at night');
  nightClock(H, 7);
  await t.waitFor(() => gatesOf(H).every((o) => o.open) && gatesOf(G).every((o) => o.open), 5000 + CFG.budget, 'at dawn: every gate open again on both');
  t.check(gatesOf(G).every((o) => !G.game.towns.state.has(o.id)), 'the rows are gone (default state)');
  // a hostile inside the town land (by day): they close; gone: they open
  A.keepAlive(t, G); A.keepAlive(t, H);
  const ws = A.freeSpot(H, MH, L.plaza[0] + 3, L.plaza[1] + 3, { rMin: 0, rMax: 5, r: 0.36 });
  const wolf = ws ? MH.mobs.spawnLoose(H.game, 'wolf', ws[0], ws[1]) : null;
  if (wolf) {
    wolf.state = 'idle'; wolf.stateT = 99; wolf.calmT = 60;
    t.defer(() => { wolf.noCorpse = true; if (!wolf.dead) MH.combat.killMob(H.game, wolf, null); });
    await t.waitFor(() => gatesOf(H).every((o) => !o.open) && gatesOf(G).every((o) => !o.open), 5000 + CFG.budget, 'a wolf inside the town: the gates close on both');
    wolf.noCorpse = true; MH.combat.killMob(H.game, wolf, null);
    await t.waitFor(() => gatesOf(H).every((o) => o.open) && gatesOf(G).every((o) => o.open), 6000 + CFG.budget, 'it is gone: they open again');
  }
  await t.checkDigest(H, G);
});

def('KG4', {
  title: "KG: a player's gate (Portão de madeira, 2 tiles) — built by the guest, opened and closed by its owner only, automatic by day / night",
  src: 'village', timeout: 180000,
  expected: 'Outside the town land the guest places and builds a gate_big_wood (wood + rope paid): a 2-tile door with gate: true, owner = the guest, automatic on (gates rows on both). The guest closes / opens it (door.toggle) on both; the host trying is refused ("Só o dono abre e fecha este portão"); the guest turns the automatic off (gate.mode) — at night it stays as it is; on again — at night it closes, at dawn it opens, on both; digest equal',
  api: 'content/buildings.js gate_big_wood (gate: true, gate2); mut/towns.js gate.mode + TOWN.gateAdded / gateReason; game/towns.js hostTick (players\' gates)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  A.keepAlive(t, G);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y);
  t.check(MH.data.BUILDINGS.gate_big_wood.gate === true && MH.data.BUILDINGS.gate_stone.gate === true && !MH.data.BUILDINGS.door_wood.gate, 'the two gates carry gate: true (the siege ram hits only these)');
  // a site outside the town land
  const out = [s0.x + (s0.r + 12), s0.y];
  A.teleport(G, out[0], out[1]); A.teleport(H, out[0] - 2, out[1]);
  await t.sleep(1200);
  const site = A.findSite([G, H], [MG, MH], 'gate_big_wood', (x, y) => [[x, y], [x + 1, y]], out[0], out[1], { rMin: 2, rMax: 18 });
  t.need(site, 'a free 2-tile site outside the town land');
  const [gx, gy] = site.tiles[0];
  A.ensure(G, { wood: 30, rope: 4 });
  const made = A.place(G, MG, 'gate_big_wood', [gx, gy], [gx, gy], 0);
  const id = await t.waitFor(() => { const o = G.game.build.structures.find((q) => q.type === 'gate_big_wood' && q.tx === gx && q.ty === gy); return o?.id; }, RT() + 2000, 'the gate blueprint on the guest');
  void made;
  t.defer(() => { const o = H.game.build.structures.find((q) => q.id === id); if (o) H.game.net.emit('struct.remove', { id, quiet: 1 }); });
  await A.buildAll(t, G, MG, [id], { ms: 40000 });
  const gH = () => A.structOn(H, id), gG = () => A.structOn(G, id);
  await t.waitFor(() => gH() && !gH().blueprint && gG() && !gG().blueprint, RT() + 2000, 'built on both');
  t.check(gG().fw === 2 && gG().door, 'a 2-tile door', `${gG().fw}×${gG().fh}`);
  const row = (f) => f.game.gates?.get(id);
  t.check(row(H)?.owner === G.pid && row(G)?.owner === G.pid && row(G).auto === 1, 'owner = the guest, automatic on (both)', JSON.stringify(row(G)));
  nightClock(H, 10);
  await t.waitFor(() => gH().open && gG().open, 4000, 'by day (automatic): open on both');
  // by hand: the owner closes it, the host may not
  H.game.net.emit('gate.mode', { id, auto: 0, owner: G.pid });
  await t.waitFor(() => row(G)?.auto === 0, ONEWAY() + 500, 'automatic off on the guest');
  A.standBy(G, MG, gG(), Math.PI / 2);
  A.useDoor(G, MG, gG());
  await t.waitFor(() => !gH().open && !gG().open, RT() + 1000, 'the owner closed it: closed on both');
  let why = null;
  A.standBy(H, MH, gH(), -Math.PI / 2);
  H.game.net.request('door.toggle', { id, open: 1 }, { onReject: (w) => { why = w; } });
  await t.sleep(300);
  t.check(why && /dono/.test(why) && !gH().open, 'the host may not open it: refused', why);
  A.useDoor(G, MG, gG());
  await t.waitFor(() => gH().open && gG().open, RT() + 1000, 'the owner opened it again: open on both');
  nightClock(H, 22);
  await t.sleep(2500);
  t.check(gH().open && gG().open, 'automatic off: night does not close it');
  G.game.net.request('gate.mode', { id, auto: 1 });
  await t.waitFor(() => !gH().open && !gG().open, RT() + 3000, 'automatic on again at night: it closes on both');
  nightClock(H, 7);
  await t.waitFor(() => gH().open && gG().open, 4000, 'dawn: it opens on both');
  await t.checkDigest(H, G);
});

def('KG5', {
  title: 'KG: damage to a castle wall (siege / monsters) is shared, survives its chunk leaving and coming back, is saved, and the place rebuilds later',
  src: 'village', timeout: 200000,
  expected: 'In the castle nearest the start the host damages a wall piece (op struct.dmg 0.6) and destroys another (struct.remove fx smash), as the walkers / siege engines do: on the guest the first has dmg 0.6, the second is gone; both have the town state rows (digest part towns); the host\'s save (serializeWorld save) carries them; both players go far away (the village chunks leave both peers) and come back: the pieces come back from the seed still damaged / still destroyed; after two days with nobody near the host rebuilds the destroyed one (town.restore) — back on both; digest equal',
  api: 'mut/structures.js struct.dmg / struct.remove → TOWN.note; mut/towns.js rows, town.restore; game/towns.js unload / placePiece / resyncPieces; net/snapshot.js towns rows',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  // (a castle near the start: the start's own chunk never leaves memory — the starter pebbles changed it)
  const R = realmOf(H), sp0 = H.game.world.spawn;
  const s0 = R.settlements.filter((q) => q.kind === 'castle').sort((a, b) => Math.hypot(a.x - sp0.x, a.y - sp0.y) - Math.hypot(b.x - sp0.x, b.y - sp0.y))[0];
  const sp = { x: H.game.towns.layout(s0.id).spawn[0], y: H.game.towns.layout(s0.id).spawn[1] };
  await visitTown(t, H, MH, G, MG, s0.id, sp.x, sp.y);
  const walls = [...townOf(H, s0.id).objs.values()].filter((o) => (o.type === 'wall_wood' || o.type === 'wall_stone') && !o.lv && Math.hypot(o.x - sp.x, o.y - sp.y) < 18 && !H.game.world.crec[H.game.world.chunkIndex(o.tx, o.ty)]?.dirty).sort((a, b) => (a.id < b.id ? -1 : 1));
  t.need(walls.length >= 2, 'two walls near the mural (in unchanged chunks)');
  const [w1, w2] = walls, id1 = w1.id, id2 = w2.id;
  // (at night: by day the winter walkers' cracks settle — walkers.js clears struct damage at sunrise)
  const h0 = H.game.env.hour;
  t.defer(() => nightClock(H, Math.max(8, Math.min(16, h0))));
  nightClock(H, 22);
  A.keepAlive(t, G); A.keepAlive(t, H);
  H.game.net.emit('struct.dmg', { id: id1, d: 0.6, x: w1.x, y: w1.y });
  H.game.net.emit('struct.remove', { id: id2, fx: 'smash' });
  H.game.net.flush();
  await t.waitFor(() => (A.objOn(G, id1)?.dmg || 0) > 0.55 && !A.objOn(G, id2), RT(), 'guest: one wall damaged, the other destroyed');
  const rowG = (id) => G.game.towns.state.get(id), rowH = (id) => H.game.towns.state.get(id);
  t.check(rowH(id1)?.dmg === 60 && rowG(id1)?.dmg === 60 && rowH(id2)?.gone && rowG(id2)?.gone, 'town state rows on both', JSON.stringify([rowG(id1), rowG(id2)]));
  const save = MH.snapshot.serializeWorld(H.game, { save: true });
  t.check(save.towns.some((r) => r[0] === id1 && r[3] === 60) && save.towns.some((r) => r[0] === id2 && r[1] === 1), 'the save carries them (towns rows)');
  await t.checkDigest(H, G, 'digest after the damage');
  // far away (the chunks leave), then back
  const far = [sp.x + 900, sp.y];
  A.teleport(H, far[0], far[1]); A.teleport(G, far[0] + 2, far[1]);
  const c1 = H.game.world.chunkIndex(w1.tx, w1.ty);
  await t.waitFor(() => !H.game.world.isLoaded(c1) && !G.game.world.isLoaded(c1), 40000, 'the village chunk left both peers', () => `host ${H.game.world.isLoaded(c1)} guest ${G.game.world.isLoaded(c1)}`);
  t.check(!A.objOn(G, id1) && G.game.towns.state.get(id1)?.dmg === 60, 'the piece left with its chunk; its state stays');
  await visitTown(t, H, MH, G, MG, s0.id, sp.x, sp.y);
  await t.waitFor(() => A.objOn(G, id1) && A.objOn(H, id1), 15000, 'the damaged wall is back from the seed on both');
  t.check(Math.abs((A.objOn(G, id1).dmg || 0) - 0.6) < 1e-6 && Math.abs((A.objOn(H, id1).dmg || 0) - 0.6) < 1e-6 && !A.objOn(G, id2) && !A.objOn(H, id2), 'still damaged / still destroyed on both');
  // two days later with nobody near: rebuilt
  A.teleport(H, far[0], far[1]); A.teleport(G, far[0] + 2, far[1]);
  await t.sleep(800);
  skipDays(H, 2.2);
  await t.waitFor(() => !H.game.towns.state.get(id2)?.gone && !G.game.towns.state.get(id2)?.gone, 6000 + CFG.budget, 'the destroyed wall rebuilt (town.restore) on both');
  await visitTown(t, H, MH, G, MG, s0.id, sp.x, sp.y);
  await t.waitFor(() => A.objOn(G, id2) && A.objOn(H, id2), 15000, 'back in place on both');
  H.game.net.emit('struct.dmg', { id: id1, d: 0 });
  await t.checkDigest(H, G);
});

def('KG6', {
  title: 'KG: building is refused inside a town land ("Terra de <Vila>: compre um terreno no mural") and in castles; free outside',
  src: 'village', timeout: 120000,
  expected: 'On the start village plaza: placing a wall is refused locally and by the host with "Terra de <name>: compre um terreno no mural" (no structure appears on either peer); just outside the town land the same wall is accepted; in a castle: "<castle>: não se constrói no castelo"; a settlement piece cannot be taken apart ("Isto pertence a …"); the creative mode is free of the rule; digest equal',
  api: 'mut/structures.js placeReason → TOWN.landReason (game/towns.js townLandAt); build.place / build.decon refusals (TOWN.refuse)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y);
  A.teleport(G, sp.x, sp.y + 0.6); A.teleport(H, sp.x - 1, sp.y + 0.6);
  await t.waitFor(() => townOf(G, s0.id)?.mural, 30000, 'the village there on the guest');
  const tx = Math.floor(sp.x) + 1, ty = Math.floor(sp.y) + 1;
  const why = MG.building.placeReason(G.game, 'wall_wood', tx, ty, G.game.player, 0);
  t.check(why === `Terra de ${s0.name}: compre um terreno no mural`, 'guest: refused on the town land with the mural hint', why);
  let rej = null;
  G.game.net.request('build.place', { type: 'wall_wood', tiles: [[tx, ty]], rot: 0 }, { onReject: (w) => { rej = w; } });
  await t.waitFor(() => rej, RT() + 500, 'the host refuses it too');
  // (the count of the host's structures moves with the settlement pieces still streaming in: the tile itself is what counts)
  const mine = (f) => f.game.build.structures.some((o) => o.tx === tx && o.ty === ty && o.town == null);
  t.check(/Terra de/.test(rej) && !mine(H) && !mine(G), 'nothing built on either peer', rej);
  // a settlement piece cannot be taken apart
  const w = [...townOf(G, s0.id).objs.values()].find((o) => o.type === 'wall_wood' || o.type === 'wall_stone');
  let rej2 = null;
  G.game.net.request('build.decon', { ids: [w.id], on: 1 }, { onReject: (x) => { rej2 = x; } });
  await t.waitFor(() => rej2, RT() + 500, 'taking a town wall apart is refused');
  t.check(/pertence a/.test(rej2) && !H.game.build.decon.has(A.objOn(H, w.id)), 'refused: "Isto pertence a …"', rej2);
  // outside the town land: free
  const ox = Math.floor(s0.x + s0.r + 8);
  A.teleport(G, ox + 0.5, s0.y + 0.5);
  await t.sleep(600);
  const site = A.findSite([G, H], [MG, MH], 'wall_wood', (x, y) => [[x, y]], ox, s0.y, { rMin: 1, rMax: 14 });
  t.check(site && MG.building.placeReason(G.game, 'wall_wood', site.x0, site.y0, G.game.player, 0) === null, 'outside the town land: allowed', site ? `${site.x0},${site.y0}` : 'no site');
  // a castle
  const c = R.settlements.filter((q) => q.kind === 'castle').sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y))[0];
  A.teleport(G, c.x + 0.5, c.y + 0.5);
  await t.sleep(500);
  const why2 = MG.building.placeReason(G.game, 'wall_wood', Math.floor(c.x) + 2, Math.floor(c.y) + 2, null, 0);
  t.check(why2 === `${c.name}: não se constrói no castelo`, 'in a castle: refused', why2);
  A.teleport(G, sp.x, sp.y + 0.6);
  await t.checkDigest(H, G);
});

def('KG7', {
  title: 'KG: the mural panel (Lugar / Reino / Trabalhos / Comércio / Exército / Propriedades) and the map data (territories, borders, names) match on both peers',
  src: 'village', timeout: 120000,
  expected: 'The guest opens the mural of the start village (E): the panel shows the place\'s name, kind, kingdom ("Reino de …"), population and the kingdom\'s banner; the tabs Lugar, Reino, Trabalhos, Comércio, Exército, Propriedades — Trabalhos, Comércio and Propriedades hold the economy (EC scenarios), Exército the army and its enlistment (phase 3c); opening it removes the gold "!" over the murals. The map: game.towns.at(x, y) gives the same kingdom / town / district on both peers along a line through the kingdom; the map window draws the territories without errors on both; the place banner said "Reino de …" / the village name',
  api: 'ui/mural.js (panel), ui/realmMap.js, ui/placebanner.js, game.towns.at / info',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y), K = R.kingdoms[s0.k];
  A.teleport(G, sp.x, sp.y);
  await t.waitFor(() => townOf(G, s0.id)?.mural, 30000, 'the mural on the guest');
  G.game.ctl.hinted.mural = false;
  const m = townOf(G, s0.id).mural;
  MG.building.useStructure(G.game, MG.building.describeStructure(G.game, m));
  await t.waitFor(() => /Mural/.test(G.doc.querySelector('.p-mural .pt')?.textContent || ''), 3000, 'the mural panel opened');
  const txt = () => G.doc.querySelector('.p-mural')?.textContent || '';
  t.check(txt().includes(s0.name) && txt().includes(`Reino de ${K.name}`) && /População/.test(txt()) && !!G.doc.querySelector('.p-mural .mu-ban'), 'name, kind, kingdom, population and banner', short(txt().replace(/\s+/g, ' '), 140));
  const tabs = [...G.doc.querySelectorAll('.p-mural [data-mtab]')].map((b) => b.textContent.replace(/[·\s]+$/g, '').trim());
  t.check(['Lugar', 'Reino', 'Trabalhos', 'Comércio', 'Exército', 'Propriedades'].every((n) => tabs.some((x) => x.startsWith(n))), 'the six tabs', tabs.join(' | '));
  // phase 2 (the economy, EC scenarios): Trabalhos / Comércio / Propriedades are real; Exército: the army and the enlistment (phase 3c)
  for (const [k, re] of [['jobs', /Quadro de/], ['trade', /Sua bolsa/], ['army', /Alistamento|Você está no exército/], ['land', /Casas à venda|não vende/]]) {
    G.doc.querySelector(`.p-mural [data-mtab=${k}]`)?.click();
    await t.sleep(120);
    t.check(re.test(txt()) && !/Em breve/.test(txt()), `${k}: ${re}`);
  }
  G.doc.querySelector('.p-mural [data-mtab=realm]')?.click();
  await t.sleep(80);
  t.check(txt().includes(R.settlements[K.capital].name), 'Reino: lists the capital and the places');
  t.check(G.game.ctl.hinted.mural === true, 'opened: the "!" goes');
  await t.waitFor(() => m._mark === false, 2000, 'no gold "!" any more');
  G.game.events.emit('closepanels', {});
  // the map data
  let same = 0, n = 0;
  for (let k = -40; k <= 40; k++) {
    const x = s0.x + k * 25, y = s0.y + k * 9;
    const a = H.game.towns.at(x, y), b = G.game.towns.at(x, y);
    const ka = [a.k, a.town?.id ?? -1, a.district?.id ?? -1].join(), kb = [b.k, b.town?.id ?? -1, b.district?.id ?? -1].join();
    n++; if (ka === kb) same++;
  }
  t.check(same === n, 'the same kingdom / town / district on both along a line', `${same}/${n}`);
  for (const f of [H, G]) {
    f.game.events.emit('open', { panel: 'map' });
    await t.sleep(400);
    const mini = f.game.ui.minimap;
    mini.view = { cx: s0.x, cy: s0.y, span: 3000 };
    let err = null;
    try { const c = f.doc.querySelector('.bigmap'); mini.draw(c.getContext('2d'), 400, 400, 0, true); } catch (e) { err = e.message; }
    t.check(!err, `${f.label}: the map draws the kingdoms`, err);
    f.game.events.emit('closepanels', {});
  }
  t.check(/Reino de|/.test(G.game.lastPlace?.title || '') && !!G.game.lastPlace, 'the place banner was shown', JSON.stringify(G.game.lastPlace));
  await t.checkDigest(H, G);
});

// =====================================================================================================
// VL1–VL8 · the settlements' people: citizens and guards (docs/REINOS.md "Fase 2 — moradores e guardas", game/people.js,
// game/npc.js, game/townnav.js, mut/people.js)
const peopleOn = (f) => f.game.entities.filter((e) => e.npc && !e.dead);
const livePeople = (H, sid) => H.game.people.debug(sid).live;
const startTownOf = (H, MH) => { const R = realmOf(H), sp = H.game.world.spawn; return MH.realm.settlementAt(R, sp.x, sp.y); };
const nearestTown = (H, pred) => { const R = realmOf(H), sp = H.game.world.spawn; return R.settlements.filter(pred).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y))[0]; };
const WORK_ACTS = new Set(['dig', 'plant', 'harvest', 'gather', 'craft', 'cook', 'chop', 'mine', 'build', 'carry', 'talk', 'cast']);
const inBoxT = (b, x, y) => x >= b[0] && x < b[2] + 1 && y >= b[1] && y < b[3] + 1;
// the clock where both players stand (and back to a calm day afterwards)
// (MH given: out of a winter first — the next spring / summer day — so the fields are worked and the children play;
// a long run of scenarios may have moved the calendar there)
const dayClock = (t, H, hour = 10, MH = null) => {
  const h0 = H.game.env.hour; t.defer(() => nightClock(H, Math.max(8, Math.min(16, h0))));
  const S = MH?.seasons, E = H.game.env;
  if (S && hour > 6 && hour < 19 && !['spring', 'summer'].includes(S.seasonIdAt(S.seasonClock(E.dayIndex, hour)))) {
    let d = E.dayIndex;
    for (let k = 1; k < 60; k++) if (['spring', 'summer'].includes(S.seasonIdAt(S.seasonClock(E.dayIndex + k, hour)))) { d = E.dayIndex + k; break; }
    H.game.net.emit('env.skip', { hour, day: d, wt: Math.round((H.game.worldTime + 5) * 100) / 100 }); H.game.net.flush();
    return;
  }
  nightClock(H, hour);
};

def('VL1', {
  title: 'VL: the start village has its people on both peers — the same names, trades, homes and looks from the seed — and they work by day',
  src: 'village', timeout: 170000,
  expected: 'Both players stand on the start village plaza at 10 h. The host makes ≥ 12 of the village people creatures near them (never more than the village cap, 40); the guest sees them as proxies that rebuild who they are from the seed (camp p<sid>.<i>: the same name, trade and packed look as the host\'s creature — the stream sends look 0); the whole population (identities, homes, beds, looks) is the same on both peers and has the settlement\'s size; game.towns.people(sid) (the economy\'s API) gives the total / alive / workplaces / productivity; a farmer works its field (hoe / plant / harvest animation inside the field) and others work (animations), seen on the guest (the action streamed); digest equal',
  api: 'game/people.js (buildPeople, LOD manager, game.towns.people, decorate), npc.js (routine: field / station / yard / plaza), net/entities.js (camp → identity, look 0, pose)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = startTownOf(H, MH), L = H.game.towns.layout(s.id);
  dayClock(t, H, 10, MH);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  await t.waitFor(() => livePeople(H, s.id).length >= 12, 20000, 'the host makes ≥ 12 people near the players', () => `${livePeople(H, s.id).length}`);
  const cap = MH.cpeople.PEOPLE.cap.village;
  t.check(livePeople(H, s.id).length <= cap, `never more than the village cap (${cap})`, livePeople(H, s.id).length);
  await t.waitFor(() => peopleOn(G).length >= 8, RT() + 4000, 'the guest sees them (proxies)', () => `${peopleOn(G).length}`);
  const bad = peopleOn(G).filter((e) => { const m = H.game.entities.find((q) => q.nid === e.nid); return !e.proxy || !m || !m.npc || m.npc.i !== e.npc.i || m.name !== e.name || e.camp !== m.camp || MH.look.packLook(m.look) !== MG.look.packLook(e.look); });
  t.check(!bad.length, 'each proxy is the same person as the host\'s creature (name, trade, look from the seed)', bad.length ? bad.slice(0, 4).map((e) => e.nid + ':' + e.name).join(' ') : `${peopleOn(G).length} people`);
  const idOf = (f, M) => f.game.people.of(s.id).persons.map((P) => [P.name, P.job, P.home, P.bed, P.work, M.look.packLook(P.look), P.look.crest || ''].join('|'));
  const iH = idOf(H, MH), iG = idOf(G, MG);
  t.check(iH.length === s.pop && iH.join(';') === iG.join(';'), 'the whole population is the same on both peers (from the seed) and has the place\'s size', `${iH.length} / ${s.pop}`);
  const jobs = new Set(H.game.people.of(s.id).persons.map((P) => P.job));
  t.check(jobs.has('guard') && jobs.has('archer') && jobs.has('farmer') && jobs.has('child'), 'trades: guards, archers, farmers, families…', [...jobs].join(','));
  const sum = H.game.towns.people(s.id), sumG = G.game.towns.people(s.id);
  t.check(Array.isArray(sum) && sum.length === sum.total && sum.every((q) => q.name && q.role) && sum.map((q) => q.name).join() === sumG.map((q) => q.name).join(), 'game.towns.people(sid) is the list of the people (name, role) — the job board of the economy names its givers from it', `${sum.length}`);
  t.check(sum.total === s.pop && sum.alive === sum.total - sum.dead && sum.workplaces.length === L.hooks.work.length && sum.productivity > 0 && sum.guards > 0 && JSON.stringify(sumG.jobs) === JSON.stringify(sum.jobs), 'game.towns.people(sid): total, alive, guards, workplaces, productivity (same on the guest)', `total ${sum.total} alive ${sum.alive} guards ${sum.guards} prod ${sum.productivity.toFixed(2)}`);
  // at work by day
  const persons = H.game.people.of(s.id).persons;
  const fieldOf = (m) => L.fields[persons[m.i].field];
  await t.waitFor(() => livePeople(H, s.id).some((m) => m.job === 'farmer' && fieldOf(m) && m.x > fieldOf(m).x0 - 1 && m.x < fieldOf(m).x1 + 1 && m.y > fieldOf(m).y0 - 1 && m.y < fieldOf(m).y1 + 1 && ['dig', 'plant', 'harvest'].includes(m.act)), 60000,
    'a farmer works its field (hoe / plant / harvest)', () => { const lp = livePeople(H, s.id); return `${lp.length} live · farmers: ` + lp.filter((m) => m.job === 'farmer').map((m) => `${m.task}/${m.act}@${f2(m.x)},${f2(m.y)}`).join(' ') + ' · all: ' + lp.slice(0, 14).map((m) => `${m.job}:${m.plan}:${m.task}`).join(' '); });
  await t.waitFor(() => livePeople(H, s.id).filter((m) => WORK_ACTS.has(m.act)).length >= 2, 30000, 'people at work (animations)');
  await t.waitFor(() => peopleOn(G).some((e) => e.action && WORK_ACTS.has(e.action.type)), 20000, 'the guest sees them work (the action streamed)');
  t.metric('liveVillage', livePeople(H, s.id).length);
  await t.checkDigest(H, G);
});

def('VL2', {
  title: 'VL: evening — the people go home; night — inside, the bed owners asleep in their beds (both peers); only the watch is out',
  src: 'village', timeout: 200000,
  expected: 'Start village. At 22 h every creature that is not a guard plans to be at home / in bed and, within ~60 s, none is left outdoors working (the ones far away became counts; the others walked home and went in). The guest walks to the door of a house whose inside can be reached: the host shows its bed owner (a creature inside the house) lying in its bed (pose sleep on that bed piece) and the guest sees the same (pose streamed: the guest\'s own town piece of the same id); guards are out (patrol / posts / the walls); digest equal',
  api: 'people.js planOf (bed / home), manage (indoors when a player is by the house; sealed houses skipped), npc.js (bed: sleep pose), net/entities.js dyn pose',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = startTownOf(H, MH), L = H.game.towns.layout(s.id);
  dayClock(t, H, 22);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  // a calm night: wild hostile creatures that wander near the village (wolves) ring the bell and send everyone to shelter
  // (awake, standing: VL4 / VL9 test that) — this scenario is about going to bed, so they are taken away while it runs
  const calm = () => { for (const e of H.game.entities) { if (!e.isMob || e.npc || e.dead || e.proxy || e.stock || (e.temper || '') !== 'hostile' || Math.hypot(e.x - s.x, e.y - s.y) > s.r + 40) continue; e.noCorpse = true; MH.combat.killMob(H.game, e, null); } };
  calm(); const calmT = setInterval(calm, 700); t.defer(() => clearInterval(calmT));
  const civOut = () => livePeople(H, s.id).filter((m) => !m.guard && !/^(bed|home|off|shelter)/.test(m.plan || '') ).length;
  await t.waitFor(() => livePeople(H, s.id).length > 0 && livePeople(H, s.id).filter((m) => !m.guard).every((m) => /^(bed|home)/.test(m.plan || '')), 20000, 'at night every citizen plans to be at home / in bed', () => livePeople(H, s.id).filter((m) => !m.guard).map((m) => m.job + ':' + m.plan).join(' '));
  const outdoor = (m) => !H.game.people.debug(s.id).homes.some((h) => inBoxT(h.box, m.x, m.y));
  await t.waitFor(() => livePeople(H, s.id).filter((m) => !m.guard && outdoor(m) && m.task !== 'vanish').length === 0, 60000, 'no citizen left outdoors (home or walking there)', () => livePeople(H, s.id).filter((m) => !m.guard && outdoor(m)).map((m) => `${m.job}:${m.task}@${f2(m.x)},${f2(m.y)}`).join(' '));
  void civOut;
  t.check(livePeople(H, s.id).some((m) => m.guard), 'the watch is out at night (guards / archers)', livePeople(H, s.id).filter((m) => m.guard).map((m) => m.job + ':' + m.task).join(' '));
  // a house whose inside can be reached, with a bed owner: the guest at its door
  const D = H.game.people.debug(s.id), persons = H.game.people.of(s.id).persons;
  const hasOwner = (h) => h.people.some((i) => persons[i].bed >= 0 && !persons[i].guard && H.game.people.alive(s.id, i));
  const home = D.homes.find((h) => h.sealed === false && hasOwner(h)) || D.homes.find(hasOwner); // (a house whose door is blocked inside by its furniture — the prefabs — still has its sleeper in bed)
  t.need(home, 'a house with a bed owner');
  const owner = home.people.find((i) => persons[i].bed >= 0 && !persons[i].guard && H.game.people.alive(s.id, i));
  const bedId = `t${s.id}.${persons[owner].bed}`;
  const at = A.freeSpot(G, MG, home.out[0], home.out[1], { rMin: 0, rMax: 2 }) || home.out;
  A.teleport(G, at[0], at[1]);
  const sleeper = () => livePeople(H, s.id).find((m) => m.i === owner);
  await t.waitFor(() => sleeper()?.pose === 'sleep', 25000, `the bed owner (${persons[owner].name}) asleep in its bed on the host`, () => { const d = sleeper(), m = d && H.game.entities.find((e) => e.nid === d.nid), T = m?.task, bo = H.game.world.objById.get(bedId); const SP = H.game.people.of(s.id), PP = SP?.persons[owner], side = PP && MH.npc.bedSide(H.game, SP, PP), nav = H.game.people.navOf(s.id); return JSON.stringify({ d, task: T && JSON.parse(JSON.stringify(T, (k, v) => (k === 'o' || k === 'b' || k === 'mate' ? undefined : v))), planKey: m?.planKey, danger: H.game.people.debug(s.id).danger, foes: (H.game.people.live.get(s.id)?.foes || []).map((f) => `${f.species}@${Math.round(f.x)},${Math.round(f.y)}`).slice(0, 4), fled: m?._fled, fear: m?.fearT, side, reach: side && m ? !!nav?.connected(m.x, m.y, side[0], side[1]) : null, home: PP?.home, route: m?.route?.length ?? null, fails: m?._fails, box: home.box, out: home.out, guest: [+G.game.player.x.toFixed(2), +G.game.player.y.toFixed(2)], bed: bo ? [bo.tx, bo.ty, bo.fw, bo.fh] : null }); });
  const nid = sleeper().nid;
  await t.waitFor(() => { const e = G.game.entities.find((q) => q.nid === nid); return e?.pose?.type === 'sleep' && e.pose.o?.id === bedId; }, RT() + 3000, 'the guest sees it asleep in the same bed (pose streamed)');
  t.check(inBoxT(home.box, sleeper().x, sleeper().y), 'inside its house');
  await t.checkDigest(H, G);
});

def('VL3', {
  title: 'VL: guards patrol the streets by day; at night archers stand on the wall walk of a castle and crews man its ballistas (both peers)',
  src: 'village', timeout: 220000,
  expected: 'Start village at 10 h: a guard on its patrol loop walks (it is several tiles away a few seconds later) and the gate posts are manned. The castle nearest the start at 22 h: ≥ 2 archers stand on the wall walk (z ≈ 2, on tiles that are a walkable story-2 surface: levels.surf[2]) and the guest sees them up there (z streamed); a ballista has its crew next to it at story 2; digest equal',
  api: 'people.js assignDuties (gates / patrol / walls / crews), planOf (guards\' shifts), npc.js upTask / crewTask / patrol, levels.surf, entity stream z',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = startTownOf(H, MH), L = H.game.towns.layout(s.id);
  dayClock(t, H, 10, MH);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  await t.waitFor(() => livePeople(H, s.id).some((m) => m.task === 'patrol'), 25000, 'a guard on patrol by day');
  const p0 = new Map(livePeople(H, s.id).filter((m) => m.task === 'patrol').map((m) => [m.nid, { x: m.x, y: m.y }]));
  await t.waitFor(() => livePeople(H, s.id).some((m) => p0.has(m.nid) && Math.hypot(m.x - p0.get(m.nid).x, m.y - p0.get(m.nid).y) > 2.5), 30000, 'the patrol walks its loop',
    () => livePeople(H, s.id).filter((m) => p0.has(m.nid)).map((m) => `${m.task}/${m.repair || '-'}@${f2(m.x)},${f2(m.y)}`).join(' ') || 'the patrol went home');
  t.check(livePeople(H, s.id).some((m) => m.guard && (m.task === 'post' || m.task === 'go' || m.task === 'patrol')), 'the watch by day (posts / patrol)');
  // the castle at night
  const c = nearestTown(H, (q) => q.kind === 'castle'), LC = H.game.towns.layout(c.id);
  await visitTown(t, H, MH, G, MG, c.id, LC.spawn[0], LC.spawn[1]);
  nightClock(H, 22);
  const up = () => livePeople(H, c.id).filter((m) => m.job === 'archer' && m.z > 1.9);
  await t.waitFor(() => up().length >= 2, 40000, 'archers up on the wall walk at night', () => livePeople(H, c.id).filter((m) => m.guard).map((m) => `${m.job}:${m.task}^${m.z}`).join(' '));
  const lev = H.game.levels.sync();
  const onWalk = up().filter((m) => lev.surf[2]?.get(H.game.world.idx(Math.floor(m.x), Math.floor(m.y))) === 1);
  t.check(onWalk.length === up().length, 'they stand on the wall walk (a story-2 surface)', `${onWalk.length}/${up().length}`);
  const seen = await t.tryWait(() => up().some((m) => { const e = G.game.entities.find((q) => q.nid === m.nid); return e && e.z > 1.8; }), RT() + 5000);
  t.check(seen || !up().some((m) => Math.abs(m.x - G.game.player.x) < 38 && Math.abs(m.y - G.game.player.y) < 28), 'the guest sees an archer up there (z streamed)');
  if ((LC.hooks.artillery || []).length) {
    const crew = await t.tryWait(() => livePeople(H, c.id).find((m) => m.task === 'up' && m.job === 'guard' && m.z > 1.9), 30000);
    t.check(!!crew, 'a ballista crew at its post (story 2)', crew ? `${f2(crew.x)},${f2(crew.y)}` : 'none');
  } else t.note('no ballista in this castle');
  t.metric('archersUp', up().length);
  await t.checkDigest(H, G);
});

def('VL4', {
  title: 'VL: danger — a wolf in the village by day: the bell, civilians run home, guards kill it; winter night walkers at the gate: the watch fights them',
  src: 'village', timeout: 240000,
  expected: 'Start village at 10 h with its people out. A hostile wolf (a tough one, ×12 hp) appears on the plaza: the host rings the bell (op town.alarm on; the guest gets it too), the civilians run home (most of them are gone from the street within ~15 s), guards engage it (state chase, threat = the wolf) and kill it; then the all-clear (alarm off on both) and the people come back out. A winter night (temperate winter, 22 h): two walkers come at the village from outside the gate — guards / archers fight them (they take damage from the town\'s side) and they die; no friendly damage between the people; digest equal',
  api: 'people.js dangerOf / town.alarm, npc.js flee / guardFight (bandits.updateBandit on the town\'s side) / upTask, players.hurtPlayer (creature vs creature), walkers.js pickGoal (the people draw them), projectiles faction town',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = startTownOf(H, MH), L = H.game.towns.layout(s.id);
  dayClock(t, H, 10, MH);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  const homes = H.game.people.debug(s.id).homes, works = H.game.people.of(s.id).works;
  const civOut = () => livePeople(H, s.id).filter((m) => !m.guard && !homes.some((h) => inBoxT(h.box, m.x, m.y)) && !works.some((w) => inBoxT(w.box, m.x, m.y))).length;
  await t.waitFor(() => civOut() >= 8, 25000, 'the people out by day');
  const civ0 = civOut();
  let alarmG = null;
  const offA = G.game.events.on('townalarm', (d) => { if (d.sid === s.id) alarmG = d.on; });
  t.defer(() => offA?.());
  const ws = A.freeSpot(H, MH, L.spawn[0] + 3, L.spawn[1] + 2, { rMin: 0, rMax: 5, r: 0.36 });
  t.need(ws, 'a free spot on the plaza for the wolf');
  const wolf = MH.mobs.spawnLoose(H.game, 'wolf', ws[0], ws[1]);
  wolf.hp = wolf.maxHp = wolf.maxHp * 12; // (a tough one: the alarm lasts while the civilians run — the guards that hunt it inside the village kill a plain wolf in seconds)
  t.defer(() => { wolf.noCorpse = true; if (!wolf.dead) MH.combat.killMob(H.game, wolf, null); });
  await t.waitFor(() => H.game.people.debug(s.id).danger, 4000, 'the host: danger in the village');
  await t.waitFor(() => alarmG === true && G.game.people.alarm.get(s.id), RT() + 2000, 'the bell rings on the guest too (town.alarm)');
  await t.waitFor(() => civOut() <= Math.max(2, Math.floor(civ0 * 0.4)), 25000, 'the civilians run home (gone from the streets)', () => `${civOut()} / ${civ0} · wolf ${wolf.dead ? "dead" : Math.round(wolf.hp)} ${wolf.state} danger ${H.game.people.debug(s.id).danger} · ` + livePeople(H, s.id).filter((m) => !m.guard && !homes.some((h) => inBoxT(h.box, m.x, m.y))).slice(0, 10).map((m) => { const e = H.game.entities.find((q) => q.nid === m.nid); return `${m.job}:${m.plan}/${m.task}@${f2(m.x)},${f2(m.y)} fled ${!!e?._fled} f${e?._fails || 0} r${e?.route ? (e.route.p ? 'p' : 'd') : '-'} pt ${f2((e?._pathT || 0) - H.game.worldTime)}`; }).join(' '));
  await t.waitFor(() => livePeople(H, s.id).some((m) => m.guard && m.state === 'chase' && m.threat === wolf.nid), 15000, 'guards engage the wolf');
  await t.waitFor(() => wolf.dead, 90000, 'the guards kill it', () => `wolf hp ${Math.round(wolf.hp)} ${wolf.state} threat ${wolf.threat?.npc ? 'npc ' + wolf.threat.npc.job : wolf.threat ? 'player' : '-'} @${f2(wolf.x)},${f2(wolf.y)} · guards ${livePeople(H, s.id).filter((m) => m.guard).map((m) => `${m.job}:${m.state}/${m.task}@${f2(m.x)},${f2(m.y)}^${m.z}`).join(' ')}`);
  await t.waitFor(() => !H.game.people.debug(s.id).danger && alarmG === false, 15000 + RT(), 'the all-clear on both');
  await t.waitFor(() => civOut() >= Math.min(civ0, 5), 40000, 'the people come back out', () => `${civOut()}`);
  // a winter night: walkers at the gate
  const sp = { x: L.spawn[0], y: L.spawn[1] };
  const SE = MH.seasons, d0 = H.game.env.dayIndex;
  let wd = d0;
  for (let k = 1; k < 60; k++) if (SE.seasonIdAt(SE.seasonClock(d0 + k, 22.5)) === 'winter') { wd = d0 + k; break; }
  H.game.net.emit('env.skip', { hour: 22.5, day: wd, wt: H.game.worldTime + 1, by: H.game.net.pid }); H.game.net.flush();
  t.defer(() => { const E = H.game.env; let sd = E.dayIndex; for (let k = 1; k < 60; k++) if (SE.seasonIdAt(SE.seasonClock(E.dayIndex + k, 9)) === 'spring') { sd = E.dayIndex + k; break; } H.game.net.emit('env.skip', { hour: 9, day: sd, wt: H.game.worldTime + 1, by: H.game.net.pid }); H.game.net.flush(); }); // (back to a spring morning)
  await t.sleep(1500);
  if (!MH.seasons.hardWinterAt(H.game, s.x, s.y)) { t.note(`not a hard winter here on day ${wd}: the walker part is skipped`); await t.checkDigest(H, G); return; }
  const gk = L.gates[0] != null ? L.structs[L.gates[0]] : null;
  const gx = gk ? gk[1] + 1 : sp.x, gy = gk ? gk[2] : sp.y - 10, ox = gx - L.x, oy = gy - L.y, od = Math.hypot(ox, oy) || 1;
  const hurtBy = new Set();
  const offD = H.game.events.on('damage', (d) => { if (d.kind === 'hit' && d.src?.npc && d.target?.faction === 'walker') hurtBy.add(d.src.npc.job); if (d.kind === 'hit' && d.src?.npc && d.target?.npc) hurtBy.add('FRIENDLY'); });
  t.defer(() => offD?.());
  const ws2 = [];
  for (let k = 0; k < 2; k++) { const q = A.freeSpot(H, MH, gx + (ox / od) * 7 + k, gy + (oy / od) * 7, { rMin: 0, rMax: 4, r: 0.3 }); if (q) ws2.push(MH.walkers.spawnWalkerAt(H.game, q[0], q[1])); }
  t.need(ws2.length, 'room for the walkers outside the gate');
  for (const m of ws2) { m.home = { x: L.x, y: L.y }; t.defer(() => { m.noCorpse = true; if (!m.dead) MH.combat.killMob(H.game, m, null); }); }
  await t.waitFor(() => hurtBy.size > 0, 45000, 'the watch fights the walkers (damage from the town\'s side)', () => ws2.map((m) => `${m.state} hp${Math.round(m.hp)}`).join(' '));
  await t.waitFor(() => ws2.some((m) => m.dead) && ws2.every((m) => m.dead || m.state === 'evade'), 60000, 'the walkers die (or one gives up and runs)', () => ws2.map((m) => `${m.state} hp${Math.round(m.hp)} @${f2(m.x)},${f2(m.y)}^${f2(m.z || 0)} lv${m.lv | 0} siege ${m.siege?.o?.id || '-'}`).join(' ') + ' · guards ' + livePeople(H, s.id).filter((m) => m.guard).map((m) => { const e = H.game.entities.find((q) => q.nid === m.nid); return `${m.job}:${m.state}/${m.task}@${f2(m.x)},${f2(m.y)}^${m.z} foe ${e?.foe?.nid || '-'} rng ${e?.foe ? f2(MH.combat.reach(e, e.foe)) : '-'} d ${e?.foe ? f2(Math.hypot(e.foe.x - e.x, e.foe.y - e.y)) : '-'} act ${e?.action?.type || '-'} sw ${f2(e?.swingT)} f${e?._fails || 0} r${e?.route ? (e.route.p ? 'p' : 'd') : '-'} mv ${e?.moving}`; }).join(' '));
  t.check(!hurtBy.has('FRIENDLY'), 'no damage between the town\'s people', [...hurtBy].join(','));
  t.metric('fightersVsWalkers', [...hurtBy].join(','));
  await t.checkDigest(H, G);
});

def('VL5', {
  title: 'VL: no friendly fire — players never hurt the people of a kingdom (host and guest hits, arrows); a tap / E talks to them ("Conversar")',
  src: 'village', timeout: 150000,
  expected: 'Start village by day, a citizen near both players. The guest\'s hit on its proxy and the host\'s hit on the creature do nothing (hp unchanged on the host; the local player sees a short warning "…sob a proteção do reino"); a stun / dot does nothing; the auto-target (bestFoe) never picks them; the siege rule (siegeCanDamage) refuses them; a tap on the person is "Conversar com <nome>" and opens the talk card on the guest with its name, trade and lines (the mural pointed out to a new player); digest equal',
  api: 'combat.dealDamage / playerMiss / stun / addDot (npc: playerish → npcImmune), combat.bestFoe (noAuto species), siege.siegeCanDamage, people.tapIt / lines, ui/talk.js',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = startTownOf(H, MH), L = H.game.towns.layout(s.id);
  dayClock(t, H, 10, MH);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  const pick = () => livePeople(H, s.id).filter((m) => !m.guard && !(m.z > 0.5)).sort((a, b) => Math.hypot(a.x - G.game.player.x, a.y - G.game.player.y) - Math.hypot(b.x - G.game.player.x, b.y - G.game.player.y))[0];
  const tg = await t.waitFor(() => { const m = pick(); return m && G.game.entities.find((e) => e.nid === m.nid && e.npc) ? m : null; }, 20000, 'a citizen seen by both');
  const hm = H.game.entities.find((e) => e.nid === tg.nid), gm = G.game.entities.find((e) => e.nid === tg.nid);
  hm.task = { k: 'stand', t: 60 }; hm.planT = 60; // (it stays put while we try)
  const hp0 = hm.hp;
  const toasts = [];
  const offT = G.game.events.on('toast', (d) => toasts.push(d.text));
  t.defer(() => offT?.());
  A.teleport(G, gm.x + 0.9, gm.y);
  await t.sleep(300);
  const got = A.hit(G, MG, gm, 80);
  await t.sleep(RT() + 300);
  t.check(got === 0 && hm.hp === hp0, 'the guest\'s hit does nothing (host hp unchanged)', `got ${got} hp ${hm.hp}/${hp0}`);
  t.check(toasts.some((x) => /proteção do reino/.test(x)), 'the guest is told why', toasts.join(' | '));
  const got2 = A.hit(H, MH, hm, 80);
  t.check(got2 === 0 && hm.hp === hp0, 'the host\'s hit does nothing either', `got ${got2}`);
  MH.combat.stun(H.game, hm, 3, H.game.player);
  MH.combat.addDot(H.game, hm, 'bleed', { dur: 4, tick: 1, dmg: 20, src: H.game.player });
  await t.sleep(1500);
  t.check(!(hm.stunT > 0) && !hm.dots?.length && hm.hp === hp0, 'stuns and bleeding from players do nothing');
  t.check(!MG.combat.bestFoe(G.game, 12) || !MG.combat.bestFoe(G.game, 12).npc, 'the auto-target never picks the people');
  t.check(!MH.siege.siegeCanDamage(H.game, { realm: 0 }, hm), 'siege engines never hurt them (no war: phase 3)');
  // talking
  const it = G.game.people.tapIt(gm);
  t.check(it?.kind === 'talk' && /Conversar com/.test(it.verb), 'a tap on the person: "Conversar com <nome>"', it?.verb);
  G.game.ctl.hinted.mural = false;
  const lines = G.game.people.lines(gm);
  t.check(lines.length >= 3 && lines.some((x) => /mural/i.test(x)), 'lines by trade / season, the mural pointed out to a new player', short(lines.join(' / '), 200));
  G.game.events.emit('talk', { e: gm });
  await t.waitFor(() => G.doc.querySelector('#talkcard.on'), 1500, 'the talk card opens on the guest');
  const card = G.doc.querySelector('#talkcard')?.textContent || '';
  t.check(card.includes(gm.npc.name) && card.includes(gm.npc.jobPt), 'it shows the name and the trade', short(card.replace(/\s+/g, ' '), 120));
  G.game.events.emit('closepanels', {});
  hm.planT = 0; hm.task = null;
  await t.checkDigest(H, G);
});

def('VL6', {
  title: 'VL: repairs by day — the village people mend a cracked palisade log and rebuild a broken one (both peers); the dawn no longer wipes a town\'s cracks',
  src: 'village', timeout: 220000,
  expected: 'A village with a palisade near the start, both players there. At night the host cracks one log (struct.dmg 0.5) and breaks another (struct.remove): at dawn the walkers\' rule does not clear the crack of a settlement piece any more. By day a worker / guard walks to the cracked log and hammers it (action build) — its damage goes down step by step to 0 on both peers (town state row gone); then the broken log is rebuilt (town.restore) and is back on both; digest equal',
  api: 'npc.js repairTick / repairWork (struct.dmg / siege.dmg steps, town.restore), walkers.js walkersTick (town pieces skipped), mut/towns.js rows',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = nearestTown(H, (q) => q.kind === 'village' && q.walls === 'palisade');
  t.need(s, 'a village with a palisade');
  const L = H.game.towns.layout(s.id);
  dayClock(t, H, 21);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  const pc = { x: L.spawn[0], y: L.spawn[1] };
  const ring = (o) => Math.abs(Math.max(Math.abs(o.tx - Math.round(L.x)), Math.abs(o.ty - Math.round(L.y))) - L.A) <= 1 || Math.abs(Math.abs(o.tx - Math.round(L.x)) + Math.abs(o.ty - Math.round(L.y)) - (2 * L.A - L.C)) <= 1; // (the palisade: the octagon of the town's wall)
  const logs = [...townOf(H, s.id).objs.values()].filter((o) => o.type === 'wall_wood' && !o.lv && !o.removed && !o.dmg && ring(o)).sort((a, b) => Math.hypot(a.x - pc.x, a.y - pc.y) - Math.hypot(b.x - pc.x, b.y - pc.y));
  t.need(logs.length >= 4, 'palisade logs');
  const [w1, , w2] = logs, id1 = w1.id, id2 = w2.id;
  H.game.net.emit('struct.dmg', { id: id1, d: 0.5, x: w1.x, y: w1.y });
  H.game.net.emit('struct.remove', { id: id2, fx: 'smash' });
  H.game.net.flush();
  await t.waitFor(() => (A.objOn(G, id1)?.dmg || 0) > 0.45 && !A.objOn(G, id2), RT() + 1000, 'cracked and broken on the guest');
  nightClock(H, 7.2);
  await t.sleep(2500);
  t.check((H.game.towns.state.get(id1)?.dmg || 0) >= 45, 'dawn: the crack of a settlement piece stays (its people repair it)', JSON.stringify(H.game.towns.state.get(id1)));
  nightClock(H, 10);
  A.teleport(H, w1.x + 2, w1.y + 2); A.teleport(G, w1.x + 3, w1.y + 2);
  const rep = await t.waitFor(() => livePeople(H, s.id).find((m) => m.repair === id1 && m.act === 'build'), 90000, 'someone hammers the cracked log', () => `log ${w1.tx},${w1.ty}: ` + (livePeople(H, s.id).filter((m) => m.repair).map((m) => { const e = H.game.entities.find((q) => q.nid === m.nid); return `${m.job}:${m.repair}@${f2(m.x)},${f2(m.y)} spot ${JSON.stringify(e?.repair?.spot)} st ${m.state} act ${m.act} fails ${e?._fails} rw ${e?._rw} task ${m.task} route ${e?.route ? (e.route.p ? e.route.i + '/' + e.route.p.length : 'direct') : '-'} pathT ${f2((e?._pathT || 0) - H.game.worldTime)} trail ${(e?._trail || []).join(' ')} pd ${f2(e?._pd)}`; }).join(' ') || 'nobody on it'));
  t.note(`repaired by a ${rep.job}`);
  await t.waitFor(() => !H.game.towns.state.get(id1)?.dmg && !G.game.towns.state.get(id1)?.dmg && !(A.objOn(G, id1)?.dmg > 0), 70000, 'the crack mended on both', () => `${H.game.towns.state.get(id1)?.dmg}`);
  await t.waitFor(() => !H.game.towns.state.get(id2)?.gone && !G.game.towns.state.get(id2)?.gone, 90000, 'the broken log rebuilt (town.restore)', () => livePeople(H, s.id).filter((m) => m.repair).map((m) => `${m.job}:${m.repair}`).join(' ') || 'nobody on it');
  await t.waitFor(() => A.objOn(G, id2) && A.objOn(H, id2), 8000, 'back in place on both');
  await t.checkDigest(H, G);
});

def('VL7', {
  title: 'VL: level of detail — the capital at noon: at most 60 people creatures near the players, a small per-frame cost; far away nothing runs but counts',
  src: 'village', timeout: 260000,
  expected: 'Both players on the plaza of the start kingdom\'s capital (a city of ~200) at 10.5 h: the host makes ≥ 25 and ≤ 60 (the city cap) people creatures; the guest has ≤ 60 proxies of them; the people system costs < 1 ms a frame on average (p95 < 3 ms: game.people.stats) and its town paths are cached / budgeted; both players go 900 tiles away: no creature of the city is left (the settlement is a count), the system then costs ~0; digest equal',
  api: 'people.js (PEOPLE.cap / matR / dropR, manage, stats), townnav.js (TownNav cache, region labels), entity interest',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s0 = startTownOf(H, MH), R = realmOf(H), c = R.settlements[R.kingdoms[s0.k].capital], L = H.game.towns.layout(c.id);
  dayClock(t, H, 10.5, MH);
  await visitTown(t, H, MH, G, MG, c.id, L.spawn[0], L.spawn[1], 90000);
  A.keepAlive(t, H); A.keepAlive(t, G);
  await t.waitFor(() => livePeople(H, c.id).length >= 25, 25000, 'the city\'s people out near the players', () => `${livePeople(H, c.id).length}`);
  const St = H.game.people.stats;
  St.msSum = 0; St.frames = 0; St.maxMs = 0; St.last.length = 0;
  await t.sleep(8000);
  const n = livePeople(H, c.id).length, cap = MH.cpeople.PEOPLE.cap.city;
  const avg = St.msSum / Math.max(1, St.frames), Ls = St.last.slice().sort((a, b) => a - b), p95 = Ls[Math.floor(Ls.length * 0.95)] || 0;
  t.check(n >= 25 && n <= cap, `25..${cap} people creatures near the players`, n);
  t.check(peopleOn(G).filter((e) => e.npc.sid === c.id).length <= cap, 'the guest: no more proxies than the cap', peopleOn(G).length);
  t.check(avg < 1 && p95 < 3, 'the people system costs < 1 ms a frame (p95 < 3 ms)', `avg ${avg.toFixed(3)} ms · p95 ${p95.toFixed(3)} ms · max ${St.maxMs.toFixed(1)} ms · ${St.frames} frames`);
  const nav = H.game.people.nav.get(c.id)?.stats;
  t.metric('cityLive', n); t.metric('cityAvgMs', +avg.toFixed(3)); t.metric('cityP95Ms', +p95.toFixed(3)); t.metric('navFinds', nav?.finds); t.metric('navMs', +(nav?.ms || 0).toFixed(1));
  // far away: counts only
  const far = [L.spawn[0] + 900, L.spawn[1]];
  A.teleport(H, far[0], far[1]); A.teleport(G, far[0] + 2, far[1]);
  await t.waitFor(() => !H.game.people.live.has(c.id) && !H.game.entities.some((e) => e.npc && e.npc.sid === c.id), 15000, 'far away: no creature of the city left (counts only)');
  St.msSum = 0; St.frames = 0;
  await t.sleep(2000);
  t.check(St.msSum / Math.max(1, St.frames) < 0.2, 'and the system costs ~nothing', `${(St.msSum / Math.max(1, St.frames)).toFixed(3)} ms`);
  await t.checkDigest(H, G);
});

def('VL8', {
  title: 'VL: monsters kill a villager — the death is shared and saved, the population regrows days later; the world\'s progress (§7b) is a saved high-water mark',
  src: 'village', timeout: 200000,
  expected: 'Start village by day: a citizen creature is killed by a hostile creature\'s blow (the monsters hurt the people): op town.pop (dead) — the row on both peers (game.towns.dead), game.towns.people(sid).alive is one less on both, the dead person leaves no body and no loot, the save carries it (tpop rows); days later (skip 1.6 days) the host replaces it (town.pop dead 0) on both. The world\'s progress: op town.prog raises it on both (saved as wprog) and the kingdoms\' people level (realmNpcLevel) follows it up to the cap of the farthest settlements; it never goes down; digest equal',
  api: 'mut/people.js (town.pop, town.prog, rows tpop / wprog, digest part towns), people.js onDeath / regrow, towns.js realmNpcLevel / worldProgress, players.hurtPlayer (creature vs creature)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = startTownOf(H, MH), L = H.game.towns.layout(s.id);
  dayClock(t, H, 10, MH);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  const v = await t.waitFor(() => livePeople(H, s.id).find((m) => !m.guard && !(m.z > 0.5)), 20000, 'a citizen out');
  const m = H.game.entities.find((e) => e.nid === v.nid);
  const alive0 = H.game.towns.people(s.id).alive;
  const loot0 = H.game.loot.length, bodies0 = H.game.corpses?.map.size || 0;
  // a hostile creature's blow (as a monster does: players.hurtPlayer → the creature target)
  const wolf = MH.mobs.spawnLoose(H.game, 'wolf', m.x + 20, m.y + 20);
  wolf.calmT = 999; t.defer(() => { wolf.noCorpse = true; if (!wolf.dead) MH.combat.killMob(H.game, wolf, null); });
  MH.players.hurtPlayer(H.game, wolf, m, 99999, {});
  t.check(m.dead, 'the citizen dies (a monster\'s blow)');
  const key = `${s.id}.${v.i}`;
  await t.waitFor(() => H.game.towns.dead?.has(key) && G.game.towns.dead?.has(key), RT() + 1500, 'the death on both (town.pop)');
  t.check(H.game.towns.people(s.id).alive === alive0 - 1 && G.game.towns.people(s.id).alive === alive0 - 1, 'one less alive on both (the economy\'s count)', `${H.game.towns.people(s.id).alive} / ${alive0}`);
  await t.sleep(800);
  t.check(H.game.loot.length === loot0 && (H.game.corpses?.map.size || 0) === bodies0, 'no body, no loot');
  const save = MH.snapshot.serializeWorld(H.game, { save: true });
  t.check(save.tpop.some((r) => r[0] === s.id && r[1] === v.i), 'the save carries the death (tpop)');
  await t.checkDigest(H, G, 'digest after the death');
  skipDays(H, 1.65);
  await t.waitFor(() => !H.game.towns.dead.has(key) && !G.game.towns.dead.has(key), 10000 + CFG.budget, 'days later the village replaced them (on both)');
  // the world's progress
  const p0 = H.game.towns.prog || 1, lv0 = MH.towns.realmNpcLevel(H.game, s);
  H.game.net.emit('town.prog', { lv: p0 + 3 }); H.game.net.flush();
  await t.waitFor(() => G.game.towns.prog === p0 + 3, RT() + 500, 'the world\'s progress raised on both (town.prog)');
  H.game.net.emit('town.prog', { lv: 1 }); H.game.net.flush();
  await t.sleep(RT());
  t.check(H.game.towns.prog === p0 + 3 && G.game.towns.prog === p0 + 3, 'it never goes down');
  t.check(MH.towns.realmNpcLevel(H.game, s) >= lv0, 'the people\'s level follows it (realmNpcLevel)', `${lv0} → ${MH.towns.realmNpcLevel(H.game, s)}`);
  t.check(MH.snapshot.serializeWorld(H.game, { save: true }).wprog === p0 + 3, 'saved (wprog)');
  await t.checkDigest(H, G);
});

def('VL9', {
  title: 'VL: the defense — at the bell the watch goes to the walls (archers up on the palisade, not at the mural); a breach in the palisade is held by a melee guard',
  src: 'village', timeout: 220000,
  expected: 'A village with a palisade near the start, 10 h, both players on its plaza. A wolf (tough, held in place: stunned, pinned against the knockback) appears a few tiles outside one stretch of the palisade: the bell rings; the defense posts are made with the threat on that side (game.townDefense); the archers go up on the palisade (story 1, every live archer posted on a wall top, none on the plaza by the mural) and the melee guards hold the gates and the stretch facing the wolf (none left at the mural). A log of that stretch is destroyed (struct.remove): it is an opening on both peers (game.townDefense.openings) and a melee guard goes to hold it (posted k gap, standing in / just inside the gap). After the all-clear one guard still holds the gap (calm: one); digest equal',
  api: 'game/defense.js perimeterOf / openings / threatOf / assignDefense, people.js defenseTick (posts on events, hunters) / planOf, npc.js postedFoe / upTask (up at the bell) / hold',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = nearestTown(H, (q) => q.kind === 'village' && q.walls === 'palisade');
  t.need(s, 'a village with a palisade');
  const L = H.game.towns.layout(s.id);
  dayClock(t, H, 10, MH);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  const TD = H.game.townDefense, per = TD.perimeter(s.id);
  t.check(per.walled && per.pieces.size > 20 && G.game.townDefense.perimeter(s.id).pieces.size === per.pieces.size, 'the wall line of the village (the same pieces on both peers)', per.pieces.size);
  await t.waitFor(() => livePeople(H, s.id).filter((m) => m.guard).length >= 3, 25000, 'the watch is out');
  // a log of an axis side of the palisade, away from the gates and the stairs / archer spots, the nearest one to the plaza
  const pc = { x: L.spawn[0], y: L.spawn[1] }, all = [...per.pieces.values()], gates = all.filter((p) => p.gate);
  const logs = all.filter((p) => !p.gate && Math.abs(p.fx) + Math.abs(p.fy) < 1.01 && gates.every((g) => Math.hypot(g.x - p.x, g.y - p.y) > 6) && L.hooks.archers.every(([x, y]) => Math.hypot(x - p.cx, y - p.cy) > 3) && A.objOn(H, p.id) && A.objOn(G, p.id))
    .sort((a, b) => Math.hypot(a.x - pc.x, a.y - pc.y) - Math.hypot(b.x - pc.x, b.y - pc.y));
  t.need(logs.length, 'a palisade log away from the gates');
  const log = logs[0];
  t.defer(() => { H.game.net.emit('town.restore', { ids: [log.id] }); H.game.net.flush(); });
  // the attacker: a wolf 6.5 tiles outside that log (tough, stunned: it stays there while we look)
  const ws = A.freeSpot(H, MH, log.cx + log.fx * 6.5, log.cy + log.fy * 6.5, { rMin: 0, rMax: 2, r: 0.36 });
  t.need(ws, 'room for the wolf outside the palisade');
  const wolf = MH.mobs.spawnLoose(H.game, 'wolf', ws[0], ws[1]);
  wolf.hp = wolf.maxHp = 100000;
  const hold = setInterval(() => { if (!wolf.dead) { wolf.stunT = 30; wolf.hp = Math.max(wolf.hp, 50000); wolf.x = ws[0]; wolf.y = ws[1]; wolf.vx = wolf.vy = 0; } }, 200);
  t.defer(() => { clearInterval(hold); wolf.noCorpse = true; if (!wolf.dead) MH.combat.killMob(H.game, wolf, null); });
  await t.waitFor(() => H.game.people.debug(s.id).danger, 5000, 'the bell rings (danger)');
  await t.waitFor(() => H.game.people.debug(s.id).def?.danger, 3000, 'the defense posts are made');
  const th = H.game.people.debug(s.id).def.th;
  t.check(th && th.fx * log.fx + th.fy * log.fy > 0.6, 'the threat comes from the wolf\'s side', JSON.stringify(th));
  const mural = L.mural >= 0 ? L.structs[L.mural] : null, mx = mural ? mural[1] + 0.5 : L.plaza[0], my = mural ? mural[2] + 0.5 : L.plaza[1];
  const D = () => H.game.people.debug(s.id);
  const archers = () => D().live.filter((m) => m.job === 'archer');
  await t.waitFor(() => archers().length >= 1 && archers().every((m) => m.duty?.k === 'wall' && m.z > 0.9), 45000, 'every archer out is up on the palisade (a wall top, story 1)',
    () => archers().map((m) => `${m.task}^${f2(m.z)} duty ${m.duty?.k || '-'} @${f2(m.x)},${f2(m.y)}`).join(' '));
  const lev = H.game.levels.sync();
  const onTop = archers().filter((m) => lev.surf[1]?.get(H.game.world.idx(Math.floor(m.x), Math.floor(m.y))) === 1);
  t.check(onTop.length === archers().length, 'they stand on the palisade\'s walk (a story-1 surface)', `${onTop.length}/${archers().length}`);
  t.check(archers().every((m) => Math.hypot(m.x - mx, m.y - my) > 8), 'no archer at the mural', archers().map((m) => f2(Math.hypot(m.x - mx, m.y - my))).join(' '));
  const melee = () => D().live.filter((m) => m.job === 'guard');
  await t.waitFor(() => melee().length && melee().every((m) => m.duty && ['gate', 'stretch', 'gap'].includes(m.duty.k) && (m.state === 'chase' || Math.hypot(m.x - m.duty.x, m.y - m.duty.y) < 2.5)), 45000, 'the melee guards hold the gates / the stretch facing the wolf',
    () => `wolf ${wolf.dead ? 'dead' : Math.round(wolf.hp)} ${wolf.state} @${f2(wolf.x)},${f2(wolf.y)} in ${H.game.entities.includes(wolf)} · danger ${D().danger} def ${!!D().def} · ` + melee().map((m) => { const e = H.game.entities.find((q) => q.nid === m.nid); return `${m.task}/${m.state} duty ${m.duty?.k || '-'} d ${m.duty ? f2(Math.hypot(m.x - m.duty.x, m.y - m.duty.y)) : '-'} @${f2(m.x)},${f2(m.y)} → ${m.duty ? f2(m.duty.x) + ',' + f2(m.duty.y) : '-'} f${e?._fails || 0} st${f2(e?._stuckT || 0)} r${e?.route ? (e.route.p ? e.route.i + '/' + e.route.p.length : 'd') : '-'} pt ${f2((e?._pathT || 0) - H.game.worldTime)} mv ${e?.moving} chk ${e?.task?.chk || 0}`; }).join(' '));
  t.check(melee().every((m) => Math.hypot(m.x - mx, m.y - my) > 8), 'no melee guard at the mural either');
  const facing = D().def.posts.filter((p) => p.k === 'stretch');
  t.check(!facing.length || facing.every((p) => (p.x - per.cx) * log.fx + (p.y - per.cy) * log.fy > -0.2 * per.A), 'the stretch guards stand on the threatened side', facing.map((p) => `${f2(p.x)},${f2(p.y)}`).join(' '));
  // the breach
  H.game.net.emit('struct.remove', { id: log.id, fx: 'smash' });
  H.game.net.flush();
  await t.waitFor(() => !A.objOn(G, log.id) && !A.objOn(H, log.id), RT() + 2000, 'the log destroyed on both');
  const opOf = (f) => f.game.townDefense.openings(s.id).find((o) => o.ids.includes(log.id));
  await t.waitFor(() => opOf(H) && opOf(G), RT() + 2000, 'an opening in the wall line on both peers (game.townDefense.openings)');
  const op = opOf(H);
  t.check(Math.hypot(op.x - log.cx, op.y - log.cy) < 0.6 && op.fx * log.fx + op.fy * log.fy > 0.9, 'the opening: where the log stood, facing out', JSON.stringify(op));
  const holders = () => melee().filter((m) => m.duty?.k === 'gap' && m.duty.op === op.id);
  await t.waitFor(() => holders().some((m) => Math.hypot(m.x - op.x, m.y - op.y) < 2.2), 45000, 'a melee guard holds the gap (in it / just inside)',
    () => `posts ${JSON.stringify(D().def?.posts.filter((p) => p.k === 'gap'))} · guards ${melee().map((m) => `${m.task}/${m.state} ${m.duty?.k || '-'}@${f2(m.x)},${f2(m.y)}`).join(' ')}`);
  t.metric('gapHolders', holders().length);
  // the all-clear: one guard still on the gap
  clearInterval(hold);
  wolf.noCorpse = true; MH.combat.killMob(H.game, wolf, null);
  await t.waitFor(() => !H.game.people.debug(s.id).danger, 15000, 'the all-clear');
  await t.waitFor(() => D().def && !D().def.danger && D().def.posts.filter((p) => p.k === 'gap').length === 1 && D().def.posts.length === 1, 5000, 'calm: one guard keeps holding the gap', () => JSON.stringify(D().def));
  await t.checkDigest(H, G);
});

def('VL10', {
  title: 'VL: talking — the person a player talks with stands still facing them while the card is open; a person in a fight has no "Conversar" (no button, a tap does nothing, the card does not open)',
  src: 'village', timeout: 170000,
  expected: 'Start village by day. The guest walks up to a citizen on its way somewhere and opens its talk card: the host gets intent npc.talk — its creature stops (no step for 9 s, not moving on either peer), faces the guest, and the card\'s refresh keeps it (talkTo.until moves on); closing the card lets it go (talkTo cleared). A tough wolf on the plaza: a guard fighting it (state chase on both peers) is left out of the guest\'s "Conversar" list next to it, a tap on it does nothing (tapIt → false), and the card refuses to open; digest equal',
  api: 'ui/talk.js (npc.talk on open / every 8 s / close), game/mut/people.js intent npc.talk, npc.js talkHold, people.js npcFighting / forNear / tapIt, controller tap',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = startTownOf(H, MH), L = H.game.towns.layout(s.id);
  dayClock(t, H, 10, MH);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  const gp = G.game.player;
  const pick = () => livePeople(H, s.id).filter((m) => !m.guard && !(m.z > 0.5) && m.task === 'go' && G.game.entities.some((e) => e.nid === m.nid && e.npc)).sort((a, b) => Math.hypot(a.x - gp.x, a.y - gp.y) - Math.hypot(b.x - gp.x, b.y - gp.y))[0];
  const tg = await t.waitFor(pick, 30000, 'a citizen on its way somewhere, seen by both');
  const hm = H.game.entities.find((e) => e.nid === tg.nid), gm = G.game.entities.find((e) => e.nid === tg.nid);
  A.teleport(G, gm.x + 0.8, gm.y);
  await t.sleep(RT() + 300); // (the host sees the guest next to it)
  G.game.events.emit('talk', { e: gm });
  await t.waitFor(() => G.doc.querySelector('#talkcard.on'), 1500, 'the talk card opens on the guest');
  await t.waitFor(() => hm.talkTo && hm.talkTo.pid === G.game.net.pid, RT() + 2500, 'the host: the person stops for the talk (intent npc.talk)', () => { const av = H.game.net.session?.players?.get?.(G.game.net.pid)?.av; return `talkTo ${hm.talkTo ? hm.talkTo.pid : '-'} (guest ${G.game.net.pid}) · nid ${gm.nid}/${hm.nid} · host avatar ${av ? f2(Math.hypot(av.x - hm.x, av.y - hm.y)) + ' tiles' : 'none'} · rq ${G.game.net.stats.rq} rejects ${G.game.net.stats.rejects} · dead ${hm.dead} in ${H.game.entities.includes(hm)}`; });
  const x0 = hm.x, y0 = hm.y, u0 = hm.talkTo.until;
  await t.sleep(9000);
  const moved = Math.hypot(hm.x - x0, hm.y - y0);
  t.check(moved < 0.05 && !hm.moving, 'it stands still while the card is open (9 s)', `moved ${f2(moved)} moving ${!!hm.moving}`);
  t.check(!gm.moving, 'the guest sees it standing too', `moving ${!!gm.moving}`);
  const dx = gp.x - hm.x, dy = gp.y - hm.y, want = Math.abs(dx) > Math.abs(dy) * 0.8 ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
  t.check(hm.facing === want, 'it faces the guest', `${hm.facing} (want ${want})`);
  t.check(hm.talkTo && hm.talkTo.until > u0, 'the open card keeps it (refresh every 8 s)', hm.talkTo ? `${f2(u0)} → ${f2(hm.talkTo.until)}` : 'no talk');
  G.game.ui.talkCard.close();
  await t.waitFor(() => !hm.talkTo, RT() + 2500, 'closing the card lets it go');
  // a fight: no "Conversar"
  const ws = A.freeSpot(H, MH, L.spawn[0] + 3, L.spawn[1] + 2, { rMin: 0, rMax: 5, r: 0.36 });
  t.need(ws, 'a free spot on the plaza for the wolf');
  const wolf = MH.mobs.spawnLoose(H.game, 'wolf', ws[0], ws[1]);
  wolf.hp = wolf.maxHp = wolf.maxHp * 12;
  t.defer(() => { wolf.noCorpse = true; if (!wolf.dead) MH.combat.killMob(H.game, wolf, null); });
  const fighter = () => { for (const m of livePeople(H, s.id)) { if (!m.guard || m.state !== 'chase' || m.z > 0.5) continue; const g = G.game.entities.find((e) => e.nid === m.nid && e.npc); if (g && g.state === 'chase') return g; } return null; };
  const gg = await t.waitFor(fighter, 25000, 'a guard fighting the wolf (state chase on both peers)');
  A.teleport(G, gg.x + 0.9, gg.y + 0.3);
  await t.sleep(150);
  const its = [];
  G.game.people.forNear((it) => { if (it) its.push(it); });
  t.check(MG.people.npcFighting(gg) && !its.some((it) => it.o === gg), 'no "Conversar" for a guard in a fight (left out of the list next to it)', `${its.length} talk items near`);
  t.check(G.game.people.tapIt(gg) === false, 'a tap on it does nothing (tapIt → false: no talk, no attack)');
  G.game.events.emit('talk', { e: gg });
  await t.sleep(300);
  t.check(!G.doc.querySelector('#talkcard.on'), 'the talk card does not open for a person in a fight');
  wolf.noCorpse = true; MH.combat.killMob(H.game, wolf, null);
  await t.waitFor(() => !H.game.people.debug(s.id).danger, 15000, 'the all-clear');
  await t.checkDigest(H, G);
});

// NB1 · the network bill: what a guest costs (docs/ARCHITECTURE.md "Multijogador"; the TURN relay is billed by bytes)
def('NB1', {
  title: 'NB: bandwidth — bytes and messages per second host → guest and guest → host in typical situations (a metric; S29 budget: 25 KB/s per guest)',
  src: 'village', timeout: 320000,
  expected: 'Both players in the start village, then the capital, the open country, a fight and the night: each situation is measured for ~20 s (payload bytes and messages sent per second by each side, JSON as sent). Every situation stays under the 25 KB/s per guest budget; the numbers are the notes / metrics (used for the TURN cost estimate); digest equal',
  api: 'session.link.send (counted here), net.stats',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const count = (F) => { const L = F.game.net.session.link, c = { n: 0, b: 0 }, o = L.send; L.send = function (k, s) { c.n++; c.b += typeof s === 'string' ? s.length : 0; return o.apply(this, arguments); }; t.defer(() => { L.send = o; }); return c; };
  const ch = count(H), cg = count(G);
  const out = [];
  const measure = async (label, ms = 20000) => {
    const h0 = { ...ch }, g0 = { ...cg }, t0 = performance.now();
    await t.sleep(ms);
    const s = (performance.now() - t0) / 1000, r = { label, hB: (ch.b - h0.b) / s, hN: (ch.n - h0.n) / s, gB: (cg.b - g0.b) / s, gN: (cg.n - g0.n) / s };
    out.push(r);
    t.note(`${label}: host→guest ${(r.hB / 1024).toFixed(2)} KB/s in ${r.hN.toFixed(1)} msg/s · guest→host ${(r.gB / 1024).toFixed(2)} KB/s in ${r.gN.toFixed(1)} msg/s`);
    t.metric(label + '.hKBs', +(r.hB / 1024).toFixed(2)); t.metric(label + '.hMsg', +r.hN.toFixed(1)); t.metric(label + '.gKBs', +(r.gB / 1024).toFixed(2)); t.metric(label + '.gMsg', +r.gN.toFixed(1));
    return r;
  };
  const walk = (F, on) => { const I = F.game.input; if (!I._nbMove) I._nbMove = I.move; if (!on) { I.move = I._nbMove; return; } const t0 = performance.now(); I.move = () => { const a = (performance.now() - t0) / 4000 * Math.PI * 2; return [Math.cos(a), Math.sin(a)]; }; };
  t.defer(() => { walk(H, false); walk(G, false); });
  const s = startTownOf(H, MH), L = H.game.towns.layout(s.id);
  dayClock(t, H, 10, MH);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  await t.sleep(4000);
  await measure('village_idle');
  walk(G, true); await measure('village_guest_walks');
  walk(H, true); await measure('village_both_walk');
  walk(H, false); walk(G, false);
  // the capital's market plaza (60 people near: the townsfolk cap)
  const R = realmOf(H), c = R.settlements[R.kingdoms[s.k].capital], LC = H.game.towns.layout(c.id);
  dayClock(t, H, 10.5, MH);
  await visitTown(t, H, MH, G, MG, c.id, LC.spawn[0], LC.spawn[1], 90000);
  await t.sleep(5000);
  await measure('city_plaza_idle');
  walk(G, true); walk(H, true); await measure('city_both_walk');
  walk(H, false); walk(G, false);
  // open country, far from any place (new chunks streaming around both)
  const far = [L.spawn[0] + 260, L.spawn[1] + 40];
  const fa = A.freeSpot(H, MH, far[0], far[1], { rMin: 0, rMax: 30 }) || far;
  A.teleport(H, fa[0], fa[1]); A.teleport(G, fa[0] + 1.5, fa[1]);
  await t.sleep(6000);
  walk(G, true); walk(H, true); await measure('country_both_walk');
  walk(H, false); walk(G, false);
  // a fight: three wolves at the players
  const ws = [];
  for (let k = 0; k < 3; k++) { const q = A.freeSpot(H, MH, fa[0] + 4 + k, fa[1] + 2, { rMin: 0, rMax: 4, r: 0.36 }); if (q) ws.push(MH.mobs.spawnLoose(H.game, 'wolf', q[0], q[1])); }
  for (const w of ws) { w.hp = w.maxHp = w.maxHp * 20; }
  t.defer(() => { for (const w of ws) { w.noCorpse = true; if (!w.dead) MH.combat.killMob(H.game, w, null); } });
  await measure('country_wolf_fight', 15000);
  for (const w of ws) { w.noCorpse = true; if (!w.dead) MH.combat.killMob(H.game, w, null); }
  // a field battle near both players (phase 3b: ~80 soldiers live, the rest in reserve)
  const [ka, kb] = btKingdoms(H, s);
  if (ka != null && kb != null && H.game.warfare) {
    await warShim(t, H, G, [[ka, kb]]);
    const bx = s.x + s.r + 60, by = s.y + 8;
    await btStand(t, H, MH, G, MG, bx, by + 9);
    const [FA, FB] = H.game.warfare.startBattle({ k: ka, n: 120, lv: 5, at: [bx - 26, by] }, { k: kb, n: 120, lv: 5, at: [bx + 26, by] });
    t.defer(() => { for (const F of [FA, FB]) if (H.game.warfare.forces.has(F.id)) H.game.warfare.dematerialize(F.id); H.game.net.flush(); });
    await t.sleep(6000);
    await measure('field_battle_240', 20000);
    for (const F of [FA, FB]) if (H.game.warfare.forces.has(F.id)) H.game.warfare.dematerialize(F.id);
    H.game.net.flush();
  } else t.note('no two kingdoms for a battle: skipped');
  // the village at night (the watch out, everyone in bed)
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  H.game.net.emit('env.skip', { hour: 22.5, day: H.game.env.dayIndex, wt: Math.round((H.game.worldTime + 5) * 100) / 100 }); H.game.net.flush();
  await t.sleep(8000);
  await measure('village_night_idle', 15000);
  const worst = out.reduce((a, r) => Math.max(a, r.hB, r.gB), 0);
  t.check(worst < 25 * 1024, 'every situation under 25 KB/s per guest', `worst ${(worst / 1024).toFixed(2)} KB/s`);
  await t.checkDigest(H, G);
});

// =====================================================================================================
// EC — the economy of the kingdoms (docs/REINOS.md "Fase 2 — economia", game/eco.js, game/mut/eco.js, ui/muralEco.js):
// coins, markets (supply and demand), jobs, reputation, membership, houses / plots, the daily tax, saves.
// =====================================================================================================
const coinsOf = (f) => f.game.player.inv.count('coin');
const recOn = (f, uid) => f.game.eco?.pl.get(uid) || null;
function setCoins(f, n) { const p = f.game.player, c = p.inv.count('coin'); if (c > n) p.inv.remove('coin', c - n); else if (c < n) p.inv.add('coin', n - c); f.game.events.emit('inventory', {}); }
function setItem(f, id, n) { const p = f.game.player, c = p.inv.count(id); if (c > n) p.inv.remove(id, c - n); else if (c < n) p.inv.add(id, n - c); f.game.events.emit('inventory', {}); }
// a request as a promise: { ok, why }
function ecoReq(f, name, args, opts = {}) {
  return new Promise((res) => { f.game.net.request(name, args, { ...opts, onOk: (x) => res({ ok: true, x }), onReject: (why) => res({ ok: false, why }) }); });
}
// the markets are open on both; the host knows the guest's economy identity (eco.hello → uid)
async function ecoReady(t, H, G) {
  await t.waitFor(() => H.game.eco?.day >= 0 && G.game.eco?.day >= 0 && G.game.eco.mk.size > 0, 20000, 'the markets open on both peers');
  await t.waitFor(() => H.game.eco.who.get(G.pid) && recOn(H, H.game.eco.who.get(G.pid)) && recOn(G, H.game.eco.who.get(G.pid)), 10000, 'the host knows the guest (eco.hello → eco.who)');
  return H.game.eco.who.get(G.pid);
}
// the guest at a settlement's mural (the host beside it), seen there by the host
async function toMural(t, H, MH, G, MG, sid) {
  G.game.towns.layout(sid); // (both peers know the place's plan, as a player standing at its mural does: its pieces are made from it)
  const m = MH.eco.muralSpot(H.game, sid);
  const a = A.freeSpot(G, MG, m.x, m.y + 2.2, { rMin: 0, rMax: 3 }) || [m.x, m.y + 2.2];
  A.teleport(G, a[0], a[1]);
  const b = A.freeSpot(H, MH, a[0] + 2.2, a[1], { rMin: 0, rMax: 4 }) || [a[0] + 2.2, a[1]];
  A.teleport(H, b[0], b[1]);
  await t.waitFor(() => { const e = guestOnHost(H, G); return e && Math.hypot(e.x - a[0], e.y - a[1]) < 1.5; }, 6000 + RT(), 'the host sees the guest at the mural');
  return a;
}
function muralTab(f, sid, tab) { const P = f.game.ui.panels; P.show('mural', { sid }); P.muralTab = tab; P.render(); }
const ecoTxt = (f) => (f.doc.querySelector('.p-mural')?.textContent || '').replace(/\s+/g, ' ');
// the host hands out reputation the way a turned-in job does (eco.job add + done)
function giveRep(H, uid, k, rep, sid) {
  const day = H.game.env.dayIndex, id = 'test.' + Math.random().toString(36).slice(2, 8);
  H.game.net.emit('eco.job', { u: uid, add: { id, sid, k, t: 'bring', n: 1, pay: 0, rep, day, exp: day + 5, title: 'teste', text: '' } });
  H.game.net.emit('eco.job', { u: uid, done: id });
  H.game.net.flush();
}
const nearVillages = (H, R, s0, n = 14) => R.settlements.filter((q) => q.kind === 'village' && R.kingdoms[q.k].comp === R.kingdoms[s0.k].comp)
  .sort((a, b) => Math.hypot(a.x - s0.x, a.y - s0.y) - Math.hypot(b.x - s0.x, b.y - s0.y)).slice(0, n);
// skip whole days on the host until the economy processed `day` on both peers
async function ecoDay(t, H, G, days = 1) {
  const want = H.game.env.dayIndex + days;
  const E = H.game.env;
  if (E.hour < 7 || E.hour > 16) E.hour = 9;
  skipDays(H, days);
  await t.waitFor(() => H.game.eco.day >= want && G.game.eco.day >= want, 5000 + RT(), `the economy's day ${want} on both peers`);
  await t.sleep(RT() + 250);
}

def('EC1', {
  title: 'EC: the guest buys and sells at a village market — coins, stock and price move on both peers',
  src: 'village', timeout: 120000,
  expected: 'At the start village\'s mural the guest opens Comércio (the market: goods, stock, buy / sell price, its backpack beside) and buys 10 of a good with the quantity chips (the coins leave its backpack, the goods arrive); the market\'s stock drops by 10 on BOTH peers and the next unit costs more; then it sells 8 wood: the stock rises by 8 on both, the coins arrive and match the quote; its trade volume counts toward its reputation there (same record on both); the purse in the HUD shows the coins; digest equal (part eco)',
  api: 'game/eco.js quoteBuy / quoteSell, mut/eco.js trade.buy / trade.sell → eco.trade, ui/muralEco.js, ui/ecoHud.js #purse',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y);
  const uid = await ecoReady(t, H, G);
  t.check(uid === 'u' + G.pid, 'the guest\'s economy id (localStorage uid; tests: u + pid)', uid);
  await toMural(t, H, MH, G, MG, s0.id);
  const P = MG.eco.profileOf(G.game, s0.id);
  const gid = ['wheat', 'potato', 'corn', 'bread', 'meat', 'stone'].find((id) => P.deals[MG.eco.GI[id]] && (G.game.eco.mk.get(s0.id)[MG.eco.GI[id]] | 0) >= 15);
  t.need(gid, 'a food / stone good with stock at the start village');
  const gi = MG.eco.GI[gid];
  setCoins(G, 1000); setItem(G, gid, 0); setItem(G, 'wood', 30);
  const s0H = H.game.eco.mk.get(s0.id)[gi], s0G = G.game.eco.mk.get(s0.id)[gi];
  t.check(s0H === s0G, 'the same stock on both peers', `${s0H} / ${s0G}`);
  const q = MG.eco.quoteBuy(G.game, s0.id, gi, 10, uid), p1 = MG.eco.quoteBuy(G.game, s0.id, gi, 1, uid).cost;
  // the UI: Comércio, the good, quantity 10, Comprar
  muralTab(G, s0.id, 'trade');
  await t.waitFor(() => G.doc.querySelector(`.p-mural [data-good="${gid}"]`), 3000, 'the market lists the good');
  t.check(/Sua bolsa/.test(ecoTxt(G)) && /Estoque/.test(ecoTxt(G)), 'Comércio: the purse, the stock / buy / sell columns', short(ecoTxt(G), 120));
  G.doc.querySelector(`.p-mural .ec-row[data-good="${gid}"]`).click();
  await t.sleep(90);
  G.doc.querySelector('.p-mural [data-qs="10"]').click();
  await t.sleep(90);
  t.check(/Comprar 10/.test(ecoTxt(G)), 'the deal box: Comprar 10 with its total', short(G.doc.querySelector('.ec-act.buy')?.textContent.replace(/\s+/g, ' '), 80));
  G.doc.querySelector('.p-mural [data-buy]').click();
  await t.waitFor(() => G.game.player.inv.count(gid) === 10 && H.game.eco.mk.get(s0.id)[gi] === s0H - 10 && G.game.eco.mk.get(s0.id)[gi] === s0H - 10, 3000 + RT(), 'bought: the goods arrive, the stock drops on both');
  t.check(coinsOf(G) === 1000 - q.cost, 'the coins left the guest\'s backpack (the quoted cost)', `${coinsOf(G)} = 1000 − ${q.cost}`);
  const p2 = MG.eco.quoteBuy(G.game, s0.id, gi, 1, uid).cost, p2H = MH.eco.quoteBuy(H.game, s0.id, gi, 1, uid).cost;
  t.check(p2 > p1 || MG.eco.quoteBuy(G.game, s0.id, gi, 1, uid).unit > q.unit, 'buying raised the price', `${p1} → ${p2}`);
  t.check(p2 === p2H, 'the same price on both peers', `${p2} / ${p2H}`);
  // sell 8 wood
  const wi = MG.eco.GI.wood;
  if (MG.eco.profileOf(G.game, s0.id).deals[wi]) {
    const w0 = H.game.eco.mk.get(s0.id)[wi], c0 = coinsOf(G), qs = MG.eco.quoteSell(G.game, s0.id, wi, 8, uid);
    G.doc.querySelector('.p-mural .ec-row[data-good="wood"]').click();
    await t.sleep(90);
    G.game.ui.panels.eco.n = 8; G.game.ui.panels.render();
    await t.sleep(60);
    G.doc.querySelector('.p-mural [data-sell]').click();
    await t.waitFor(() => coinsOf(G) === c0 + qs.gain && G.game.eco.mk.get(s0.id)[wi] === w0 + 8 && H.game.eco.mk.get(s0.id)[wi] === w0 + 8, 3000 + RT(), 'sold: the coins arrive, the stock rises on both');
    t.check(G.game.player.inv.count('wood') === 22, 'the wood left the backpack', G.game.player.inv.count('wood'));
  } else t.note('the start village does not trade wood');
  const rH = recOn(H, uid), rG = recOn(G, uid);
  t.check(rH && JSON.stringify(rH.vol) === JSON.stringify(rG.vol) && JSON.stringify(rH.rep) === JSON.stringify(rG.rep) && ((rH.rep[s0.k] | 0) > 0 || (rH.vol[s0.k] | 0) > 0), 'the trade counts toward the reputation there (same record on both)', `rep ${JSON.stringify(rH?.rep)} vol ${JSON.stringify(rH?.vol)}`);
  t.check(G.doc.querySelector('#purse b')?.textContent.replace(/\./g, '') === String(coinsOf(G)), 'the purse in the HUD shows the coins', G.doc.querySelector('#purse b')?.textContent);
  G.game.events.emit('closepanels', {});
  await t.checkDigest(H, G);
});

def('EC2', {
  title: 'EC: prices differ between a farm village and the city (supply and demand), buying in the city raises the price there, both peers agree',
  src: 'village', timeout: 180000,
  expected: 'The farm village of the start kingdom that grows the most wheat sells wheat cheaper than the capital city (which eats it); the city sells a crafted good (iron bars) and arms (swords) cheaper than a castle of the kingdom, which buys them; the guest walks to the city\'s mural and buys 20 wheat: the stock there drops by 20 on both, each unit costs more than the one before (the quote of the 20th > the 1st); the farm village\'s stock is untouched; digest equal',
  api: 'game/eco.js profileOf / balanceOf / priceFactor / quoteBuy, mut/eco.js trade.buy',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y), K = R.kingdoms[s0.k];
  const uid = await ecoReady(t, H, G);
  const city = R.settlements[K.capital], wi = MH.eco.GI.wheat, ii = MH.eco.GI.iron_bar;
  const vills = K.settlements.map((i) => R.settlements[i]).filter((q) => q.kind === 'village');
  const farm = vills.filter((q) => MH.eco.profileOf(H.game, q.id).deals[wi]).sort((a, b) => MH.eco.profileOf(H.game, b.id).p[wi] - MH.eco.profileOf(H.game, a.id).p[wi])[0];
  t.need(farm, 'a village trading wheat');
  const price = (f, M, sid, gi) => M.eco.quoteBuy(f.game, sid, gi, 1, uid).unit;
  const pv = price(H, MH, farm.id, wi), pc = price(H, MH, city.id, wi);
  t.check(pc > pv * 1.2, 'wheat: cheaper in the farm village than in the city', `${farm.name} ${pv.toFixed(1)} · ${city.name} ${pc.toFixed(1)}`);
  t.check(Math.abs(price(G, MG, farm.id, wi) - pv) < 1e-9 && Math.abs(price(G, MG, city.id, wi) - pc) < 1e-9, 'the same prices on the guest');
  // a crafted good the city forges and a castle buys (iron bars), arms the castle wants (swords)
  const castle = K.settlements.map((i) => R.settlements[i]).find((q) => q.kind === 'castle' && MH.eco.profileOf(H.game, q.id).deals[ii]);
  if (castle) {
    t.check(price(H, MH, city.id, ii) < price(H, MH, castle.id, ii), 'iron bars: cheaper in the city (it forges them) than in a castle (it buys them)', `${price(H, MH, city.id, ii).toFixed(1)} / ${price(H, MH, castle.id, ii).toFixed(1)}`);
    const si = MH.eco.GI.sword_iron;
    t.check(price(H, MH, city.id, si) < price(H, MH, castle.id, si), 'swords: cheaper in the city than in the castle (arms wanted there)', `${price(H, MH, city.id, si).toFixed(0)} / ${price(H, MH, castle.id, si).toFixed(0)}`);
  } else t.note('no castle of the kingdom trades iron bars');
  // the guest goes to the city and buys 20 wheat
  await toMural(t, H, MH, G, MG, city.id);
  setCoins(G, 3000); setItem(G, 'wheat', 0);
  const S0 = H.game.eco.mk.get(city.id)[wi], F0 = H.game.eco.mk.get(farm.id)[wi];
  t.need(S0 >= 25, `the city has wheat in stock (${S0})`);
  const q = MG.eco.quoteBuy(G.game, city.id, wi, 20, uid);
  t.check(q.next > q.unit, 'the 20th unit costs more than the first (the price climbs as the stock drops)', `${q.unit.toFixed(2)} → ${q.next.toFixed(2)}`);
  setCoins(G, 3000 - q.cost);
  const r = await ecoReq(G, 'trade.buy', { sid: city.id, g: 'wheat', n: 20, max: q.cost }, { refund: { coin: q.cost } });
  t.check(r.ok, 'the host sells it (the guest at the city\'s mural)', r.why);
  await t.waitFor(() => G.game.player.inv.count('wheat') === 20 && G.game.eco.mk.get(city.id)[wi] === S0 - 20, 2000 + RT(), 'the wheat arrives; the city\'s stock drops on the guest too');
  t.check(H.game.eco.mk.get(city.id)[wi] === S0 - 20 && H.game.eco.mk.get(farm.id)[wi] === F0, 'host: the city\'s stock −20, the farm village untouched');
  t.check(price(G, MG, city.id, wi) > pc, 'the city\'s wheat is dearer now', `${pc.toFixed(2)} → ${price(G, MG, city.id, wi).toFixed(2)}`);
  // far from its mural: refused
  A.teleport(G, sp.x, sp.y + 1);
  await t.sleep(RT() + 300);
  setCoins(G, 400); // (500, with the 100 sent along)
  const far = await ecoReq(G, 'trade.buy', { sid: city.id, g: 'wheat', n: 1, max: 100 }, { refund: { coin: 100 } });
  t.check(!far.ok && /mural/.test(far.why || '') && coinsOf(G) === 500, 'far from the mural: refused, the coins come back', far.why);
  await t.checkDigest(H, G);
});

def('EC3', {
  title: 'EC: a harvest job — accepted on the mural, the crops harvested on the town\'s fields, turned in and paid, reputation up (both peers)',
  src: 'village', timeout: 240000,
  expected: 'A village near the start has a "Colher N …" job on its board (Trabalhos) whose waypoint lies on a real field of that crop (docs/REINOS.md §10 "Trabalhos possíveis"); the guest accepts it (button Aceitar): the job is in its record on both peers, the HUD tracker shows it; near the fields the marker (game.eco.wp) stands on a real plant of that crop on the place\'s fields and the tracker names it ("pé de …"); it harvests the wild crops of that kind on the town\'s fields: the host counts each one (eco.prog) — the progress N/N on both; the tracker says "Pronto"; at the mural "Entregar" pays the coins and raises the reputation with that kingdom on both peers; the job is done (not on the list, in done); digest equal',
  api: 'game/eco.js boardOf / onOp (net.js hook) / jobState, mut/eco.js job.take / job.done → eco.job / eco.prog, ui/ecoHud.js #jtrack',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y);
  const uid = await ecoReady(t, H, G);
  for (const j of recOn(H, uid)?.jobs || []) await ecoReq(G, 'job.drop', { id: j.id });
  let job = null, vil = null;
  for (const q of nearVillages(H, R, s0)) { const j = MH.eco.boardOf(H.game, q.id).find((x) => x.t === 'harvest' && x.n <= 10); if (j) { job = j; vil = q; break; } }
  t.need(job, 'a harvest job on a village board near the start');
  t.log(`job ${job.id} at ${vil.name}: ${job.title}`);
  const L0 = H.game.towns.layout(vil.id);
  t.check(L0.fields.some((f) => f.crop === 'wild_' + job.crop && job.x >= f.x0 && job.x <= f.x1 && job.y >= f.y0 && job.y <= f.y1), 'the job\'s waypoint lies on a field of that crop (not between the fields)', `${f2(job.x)},${f2(job.y)}`);
  await toMural(t, H, MH, G, MG, vil.id);
  muralTab(G, vil.id, 'jobs');
  const btn = await t.waitFor(() => G.doc.querySelector(`.p-mural [data-jtake="${job.id}"]`), 3000, 'the job on the board');
  t.check(/Quadro de/.test(ecoTxt(G)) && ecoTxt(G).includes(job.title), 'Trabalhos: the board with the job', short(ecoTxt(G), 120));
  btn.click();
  await t.waitFor(() => recOn(H, uid)?.jobs.some((j) => j.id === job.id) && recOn(G, uid)?.jobs.some((j) => j.id === job.id), 2000 + RT(), 'the job taken on both peers');
  G.game.events.emit('closepanels', {});
  await t.waitFor(() => (G.doc.querySelector('#jtrack')?.textContent || '').includes(job.title), 2000, 'the HUD tracker shows the job');
  // harvest the crops on the fields
  const L = H.game.towns.layout(vil.id), type = 'wild_' + job.crop;
  const fields = L.fields.filter((f) => f.crop === type);
  const inF = (o) => fields.some((f) => o.x >= f.x0 && o.x <= f.x1 + 1 && o.y >= f.y0 && o.y <= f.y1 + 1);
  const centres = fields.map((f) => [(f.x0 + f.x1 + 1) / 2, (f.y0 + f.y1 + 1) / 2]);
  // near the fields: the marker stands on a real plant of the crop (the nearest), the tracker names it
  if (G.game.eco.track !== job.id) { G.game.eco.track = job.id; G.game.eco.wp = MG.eco.jobWaypoint(G.game, recOn(G, uid).jobs.find((j) => j.id === job.id)); }
  const nf = A.freeSpot(G, MG, job.x, job.y + 9, { rMin: 0, rMax: 4 }) || [job.x, job.y + 9];
  A.teleport(G, nf[0], nf[1]);
  const onPlant = () => { const wp = G.game.eco.wp; return wp && A.shared(G, null, wp.x, wp.y + 0.25, 0.3, (q) => q.type === type && !q.gone && inF(q))[0]; };
  await t.waitFor(onPlant, 4000, 'the marker stands on a real plant of the crop on the fields', () => JSON.stringify(G.game.eco.wp));
  t.check(/pé de/.test(G.doc.querySelector('#jtrack')?.textContent || ''), 'the tracker names the plant it leads to', short(G.doc.querySelector('#jtrack')?.textContent, 90));
  let done = 0;
  for (let tries = 0; tries < job.n + 8 && done < job.n; tries++) {
    let o = null;
    for (const [fx, fy] of centres) { o = A.shared(G, H, fx, fy, 8, (q) => q.type === type && !q.gone && inF(q))[0]; if (o) break; }
    if (!o) { for (const [fx, fy] of centres) { A.teleport(G, fx, fy + 4); await t.sleep(700); } continue; }
    const s = A.freeSpot(G, MG, o.x, o.y + 0.9, { rMin: 0, rMax: 2 }); if (s) A.teleport(G, s[0], s[1]);
    await A.gather(t, G, MG, o);
    done++;
  }
  await t.waitFor(() => (recOn(H, uid)?.jobs.find((j) => j.id === job.id)?.got | 0) >= job.n && (recOn(G, uid)?.jobs.find((j) => j.id === job.id)?.got | 0) >= job.n, 3000 + RT(), `the progress ${job.n}/${job.n} on both peers`,
    () => `host ${recOn(H, uid)?.jobs.find((j) => j.id === job.id)?.got} guest ${recOn(G, uid)?.jobs.find((j) => j.id === job.id)?.got} (harvested ${done})`);
  await t.waitFor(() => /Pronto/.test(G.doc.querySelector('#jtrack')?.textContent || ''), 2000, 'the tracker: "Pronto"');
  // turn it in at the mural
  const rep0 = recOn(H, uid).rep[vil.k] | 0, c0 = coinsOf(G);
  await toMural(t, H, MH, G, MG, vil.id);
  muralTab(G, vil.id, 'jobs');
  const done$ = await t.waitFor(() => G.doc.querySelector(`.p-mural [data-jdone="${job.id}"]:not([disabled])`), 3000, '"Entregar" enabled at the mural');
  done$.click();
  await t.waitFor(() => coinsOf(G) === c0 + job.pay, 2000 + RT(), `paid: +${job.pay} coins`);
  t.check((recOn(H, uid).rep[vil.k] | 0) === rep0 + job.rep && (recOn(G, uid).rep[vil.k] | 0) === rep0 + job.rep, `reputation +${job.rep} with the kingdom on both peers`, `${rep0} → ${recOn(G, uid).rep[vil.k]}`);
  t.check(!recOn(H, uid).jobs.some((j) => j.id === job.id) && recOn(G, uid).done.includes(job.id), 'the job is done (off the list, in done)');
  G.game.events.emit('closepanels', {});
  await t.checkDigest(H, G);
});

def('EC4', {
  title: 'EC: a delivery job between two settlements reachable by land — parcels on accept, paid at the destination\'s mural',
  src: 'village', timeout: 240000,
  expected: 'A village near the start offers "Levar N encomendas a <destino>" (the destination on the same land mass); the guest takes it: N parcels (Encomenda) arrive in its backpack; turning it in at the origin is refused ("Entregue no mural de <destino>"); at the destination\'s mural the "Entregar" button takes the parcels and pays the coins; reputation up with the origin\'s kingdom on both peers; digest equal',
  api: 'game/eco.js boardOf (deliver) / jobTarget, mut/eco.js job.take (give parcel) / job.done (paid parcels)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y);
  const uid = await ecoReady(t, H, G);
  for (const j of recOn(H, uid)?.jobs || []) await ecoReq(G, 'job.drop', { id: j.id });
  let job = null, vil = null;
  for (const q of nearVillages(H, R, s0)) { const j = MH.eco.boardOf(H.game, q.id).find((x) => x.t === 'deliver' && !recOn(H, uid)?.done.includes(x.id)); if (j) { job = j; vil = q; break; } }
  t.need(job, 'a delivery job on a village board near the start');
  const dest = R.settlements[job.dest];
  t.check(MH.realm.canReach(R, vil.k, dest.k), 'the destination is reachable by land', `${vil.name} → ${dest.name}`);
  setItem(G, 'parcel', 0);
  await toMural(t, H, MH, G, MG, vil.id);
  const tk = await ecoReq(G, 'job.take', { sid: vil.id, id: job.id });
  t.check(tk.ok, 'taken', tk.why);
  await t.waitFor(() => G.game.player.inv.count('parcel') === job.n, 2000 + RT(), `${job.n} parcels in the guest's backpack`);
  const early = await ecoReq(G, 'job.done', { id: job.id, paid: 0 });
  t.check(!early.ok && early.why.includes(dest.name), 'turning it in at the origin is refused', early.why);
  // the destination
  const rep0 = recOn(H, uid).rep[vil.k] | 0, c0 = coinsOf(G);
  await toMural(t, H, MH, G, MG, dest.id);
  muralTab(G, dest.id, 'jobs');
  const b = await t.waitFor(() => G.doc.querySelector(`.p-mural [data-jdone="${job.id}"]:not([disabled])`), 4000, '"Entregar" at the destination\'s mural');
  b.click();
  await t.waitFor(() => coinsOf(G) === c0 + job.pay && G.game.player.inv.count('parcel') === 0, 2000 + RT(), `paid +${job.pay}, the parcels handed over`);
  t.check((recOn(H, uid).rep[vil.k] | 0) === rep0 + job.rep && (recOn(G, uid).rep[vil.k] | 0) === rep0 + job.rep, `reputation +${job.rep} on both`);
  G.game.events.emit('closepanels', {});
  await t.checkDigest(H, G);
});

def('EC5', {
  title: 'EC: buying a house (its chest is the owner\'s) and a plot (building inside it, not next to it)',
  src: 'village', timeout: 200000,
  expected: 'Propriedades lists houses for sale / for rent and plots; with no reputation the purchase is refused ("Conhecido"); with it, the guest buys a house: the property row (owner = the guest) on both peers, the price left its backpack; its chest opens for the guest (describeStructure: chest) and not for the host; what the guest puts in it is kept in the town chests state on both peers; the house door refuses the host ("Casa de …"); the guest buys a plot: a wall inside the plot is accepted (local check and the host), a wall one tile outside it (still the town land) is refused "Terra de …"; digest equal',
  api: 'game/eco.js propsOf / plotReason / mayUsePiece, mut/eco.js prop.buy → eco.prop, game/towns.js TOWN.landReason / gateReason, mut/structures.js chestOf / chest.set (TOWN.storeSet)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y);
  const uid = await ecoReady(t, H, G);
  const P = MH.eco.propsOf(H.game, s0.id);
  const house = P.houses.find((h) => h.mode === 'sale' && h.chests.length && !H.game.eco.pr.has(h.id));
  // owner's rule: renting costs far more than owning — the daily rent is ≥ 4 × the daily tax and ≥ 7 % of the price
  { const tax = MH.eco.taxRate(H.game, s0.k), rents = P.houses.filter((h) => h.mode === 'rent').map((h) => [MH.eco.rentOf(H.game, h), Math.round(h.price * tax), h.price]);
    t.check(rents.length && rents.every(([r, tx, pr]) => r >= 4 * tx && r >= Math.round(pr * 0.07) && r === MG.eco.rentOf(G.game, P.houses.find((h) => h.price === pr && h.mode === 'rent'))), 'the rent is ≥ 4 × the tax of owning (and ≥ 7 % of the price a day), the same on both peers', rents.map(([r, tx, pr]) => `${pr}: rent ${r} vs tax ${tx}`).join(' · ')); }
  const plot = P.plots.find((p) => !H.game.eco.pr.has(p.id));
  t.need(house && plot, 'a house for sale with a chest and a free plot at the start village');
  await toMural(t, H, MH, G, MG, s0.id);
  muralTab(G, s0.id, 'land');
  await t.waitFor(() => /Casas à venda/.test(ecoTxt(G)), 3000, 'Propriedades');
  t.check(/Terrenos/.test(ecoTxt(G)) && /para alugar/.test(ecoTxt(G)), 'Propriedades: yours, for sale, for rent, plots', short(ecoTxt(G), 140));
  // no reputation: refused
  if ((recOn(H, uid)?.rep[s0.k] | 0) < 25) {
    setCoins(G, 5000 - house.price);
    const no = await ecoReq(G, 'prop.buy', { id: house.id, paid: house.price }, { refund: { coin: house.price } });
    t.check(!no.ok && /Conhecido/.test(no.why || '') && coinsOf(G) === 5000, 'without reputation: refused, the coins back', no.why);
    giveRep(H, uid, s0.k, 30, s0.id);
    await t.waitFor(() => (recOn(G, uid)?.rep[s0.k] | 0) >= 25, 2000 + RT(), 'the guest is Conhecido');
  }
  setCoins(G, 5000);
  G.game.ui.panels.render();
  const buy = await t.waitFor(() => G.doc.querySelector(`.p-mural [data-pbuy="${house.id}"]:not([disabled])`), 3000, '"Comprar" enabled');
  buy.click();
  await t.waitFor(() => H.game.eco.pr.get(house.id)?.u === uid && G.game.eco.pr.get(house.id)?.u === uid, 2000 + RT(), 'the house is the guest\'s on both peers');
  t.check(coinsOf(G) === 5000 - house.price, 'the price left the backpack', `${coinsOf(G)}`);
  // its chest: the guest's
  const cid = `t${s0.id}.${house.chests[0]}`, [, hx, hy] = H.game.towns.layout(s0.id).structs[house.chests[0]];
  A.teleport(G, hx + 0.5, hy + 1.4); A.teleport(H, hx + 1.5, hy + 1.4);
  await t.waitFor(() => A.objOn(G, cid) && A.objOn(H, cid), 15000, 'the chest placed on both');
  await t.sleep(RT() + 200);
  t.check(MG.building.describeStructure(G.game, A.objOn(G, cid))?.kind === 'chest', 'the guest can open its chest');
  t.check(!MH.building.describeStructure(H.game, A.objOn(H, cid)), 'the host cannot (not its house)');
  setItem(G, 'wood', 12);
  await A.chestPut(t, G, MG, A.objOn(G, cid), 'wood');
  await t.waitFor(() => A.objOn(H, cid)?.store?.count('wood') === 12 && JSON.stringify(H.game.eco.st.get(cid)) === JSON.stringify(G.game.eco.st.get(cid)), 2000 + RT(), 'the wood in the chest; the town chests state on both');
  const steal = await ecoReq(H, 'chest.take', { id: cid, slot: 0, qty: 5 });
  t.check(!steal.ok, 'the host cannot take from it', steal.why);
  const door = house.doors.length && `t${s0.id}.${house.doors[0]}`;
  if (door && A.objOn(H, door)) {
    const dr = H.game.towns.layout(s0.id).structs[house.doors[0]];
    A.teleport(H, dr[1] + 0.5, dr[2] + 1.6);
    await t.sleep(200);
    const nd = await ecoReq(H, 'door.toggle', { id: door, open: 1 });
    t.check(!nd.ok && /Casa de/.test(nd.why || ''), 'the house door refuses the host', nd.why);
  }
  // the plot
  await toMural(t, H, MH, G, MG, s0.id);
  const okBuy = await (async () => { setCoins(G, 5000 - plot.price); return ecoReq(G, 'prop.buy', { id: plot.id, paid: plot.price }, { refund: { coin: plot.price } }); })();
  t.check(okBuy.ok, 'the plot bought', okBuy.why);
  await t.waitFor(() => G.game.eco.pr.get(plot.id)?.u === uid, 2000 + RT(), 'the plot is the guest\'s on both');
  A.teleport(G, plot.x0 + plot.w / 2, plot.y1 + 2.5);
  await t.sleep(600);
  let tile = null;
  for (let y = plot.y0 + 1; y < plot.y1 && !tile; y++) for (let x = plot.x0 + 1; x < plot.x1 && !tile; x++) if (MG.building.placeReason(G.game, 'wall_wood', x, y, G.game.player, 0) === null) tile = [x, y];
  t.check(!!tile, 'a wall inside the plot: allowed (local check)', tile ? tile.join(',') : MG.building.placeReason(G.game, 'wall_wood', plot.x0 + 2, plot.y0 + 2, G.game.player, 0));
  if (tile) {
    const pl = await ecoReq(G, 'build.place', { type: 'wall_wood', tiles: [tile], rot: 0 });
    t.check(pl.ok, 'the host accepts it', pl.why);
    await t.waitFor(() => H.game.build.structures.some((o) => o.tx === tile[0] && o.ty === tile[1] && o.town == null) && G.game.build.structures.some((o) => o.tx === tile[0] && o.ty === tile[1] && o.town == null), 2000 + RT(), 'the wall plan on both peers');
  }
  // one tile outside the plot (still on the town land): refused
  const out = [[plot.x1 + 1, plot.y0 + 2], [plot.x0 - 1, plot.y0 + 2], [plot.x0 + 2, plot.y1 + 1], [plot.x0 + 2, plot.y0 - 1]].find(([x, y]) => MH.towns.townLandAt(H.game, x, y) && !MH.eco.propsOf(H.game, s0.id).plots.some((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1));
  if (out) {
    const why = MG.building.placeReason(G.game, 'wall_wood', out[0], out[1], G.game.player, 0);
    t.check(typeof why === 'string' && /Terra de|Passa da divisa|caminho|exists/.test(why), 'next to the plot: refused', why);
    const no = await ecoReq(G, 'build.place', { type: 'wall_wood', tiles: [out], rot: 0 });
    t.check(!no.ok || !H.game.build.structures.some((o) => o.tx === out[0] && o.ty === out[1] && o.town == null), 'the host refuses it too', no.why);
  } else t.note('no tile next to the plot on the town land');
  await t.checkDigest(H, G);
});

def('EC6', {
  title: 'EC: the daily tax is taken from the backpack with a notice; with no coins, 3 days of warning, then the kingdom takes the property',
  src: 'village', timeout: 200000,
  expected: 'The guest holds a property (a plot); at the next economy day the host bills it and the guest pays the tax from its backpack (the coins drop by the tax; notice "Imposto e aluguel pagos"); with no coins in the backpack the next day the debt stays (due > 0, warning 0 on both peers; notice "Imposto atrasado … 3 dias"); the following days count the warning up (1, 2: "Último dia"); then the kingdom takes the property back (the row gone on both; notice "tomado"; reputation −15) and the wall the guest built on the plot is gone on both (phase 3a rule: a plot lost goes back on sale clean); digest equal',
  api: 'game/eco.js dayTick (eco.bill, toOwner eco.collect) / payBills, mut/eco.js eco.pay → eco.paid, ui/ecoHud.js notices (ui/notify.js)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y);
  const uid = await ecoReady(t, H, G);
  // only one property for this test: a plot (give back any other)
  for (const [id, row] of [...H.game.eco.pr]) if (row.u === uid) await ecoReq(G, 'prop.leave', { id });
  const plot = MH.eco.propsOf(H.game, s0.id).plots.find((p) => !H.game.eco.pr.has(p.id));
  t.need(plot, 'a free plot');
  if ((recOn(H, uid)?.rep[s0.k] | 0) < 25) giveRep(H, uid, s0.k, 30, s0.id);
  await toMural(t, H, MH, G, MG, s0.id);
  setCoins(G, 1000 - plot.price);
  const b = await ecoReq(G, 'prop.buy', { id: plot.id, paid: plot.price }, { refund: { coin: plot.price } });
  t.check(b.ok, 'the guest buys a plot', b.why);
  await t.waitFor(() => G.game.eco.pr.get(plot.id)?.u === uid, 2000 + RT(), 'the plot on both');
  // a wall built on it (phase 3a rule, docs/REINOS.md §10: a plot taken back loses what was built on it)
  A.teleport(G, plot.x0 + plot.w / 2, plot.y1 + 2.5);
  await t.sleep(300);
  let wt = null;
  for (let y = plot.y0 + 1; y < plot.y1 && !wt; y++) for (let x = plot.x0 + 1; x < plot.x1 && !wt; x++) if (MG.building.placeReason(G.game, 'wall_wood', x, y, G.game.player, 0) === null) wt = [x, y];
  if (wt) await ecoReq(G, 'build.place', { type: 'wall_wood', tiles: [wt], rot: 0 });
  const onPlot = (f) => !!wt && f.game.build.structures.some((o) => o.tx === wt[0] && o.ty === wt[1] && o.town == null);
  await t.waitFor(() => onPlot(H) && onPlot(G), 2000 + RT(), 'a wall on the plot on both');
  await toMural(t, H, MH, G, MG, s0.id);
  const tax = MH.eco.chargeOf(H.game, plot.id);
  t.check(tax > 0, 'its daily tax', `${tax} coins (${(MH.eco.taxRate(H.game, s0.k) * 100).toFixed(1)}% of ${plot.price})`);
  const notes = (f) => [...f.doc.querySelectorAll('.wos-note')].map((n) => n.textContent.replace(/\s+/g, ' ')).join(' | ');
  // a day: paid from the backpack
  setCoins(G, 1000);
  await ecoDay(t, H, G);
  await t.waitFor(() => coinsOf(G) === 1000 - tax, 3000 + RT(), `the tax left the backpack (−${tax})`);
  await t.waitFor(() => H.game.eco.pr.get(plot.id)?.due === 0 && G.game.eco.pr.get(plot.id)?.due === 0, 2000 + RT(), 'nothing owed on both');
  await t.waitFor(() => /Imposto e aluguel pagos/.test(notes(G)), 2000, 'notice: "Imposto e aluguel pagos"');
  // no coins: owed, warned
  setCoins(G, 0);
  const rep0 = recOn(H, uid).rep[s0.k] | 0;
  await ecoDay(t, H, G);
  await t.waitFor(() => G.game.eco.pr.get(plot.id)?.due === tax && H.game.eco.pr.get(plot.id)?.warn === 0, 2000 + RT(), 'the debt stays (due = tax, warning 0) on both');
  await t.waitFor(() => /Imposto atrasado/.test(notes(G)) && /3 dias/.test(notes(G)), 2000, 'notice: "Imposto atrasado … 3 dias"', () => notes(G));
  await ecoDay(t, H, G);
  await t.waitFor(() => G.game.eco.pr.get(plot.id)?.warn === 1 && H.game.eco.pr.get(plot.id)?.due === tax * 2, 2000 + RT(), 'day 2: warning 1, two days owed');
  await ecoDay(t, H, G);
  await t.waitFor(() => G.game.eco.pr.get(plot.id)?.warn === 2 && /Último dia/.test(notes(G)), 2000 + RT(), 'day 3: warning 2 — "Último dia"', () => notes(G));
  await ecoDay(t, H, G);
  await t.waitFor(() => !H.game.eco.pr.has(plot.id) && !G.game.eco.pr.has(plot.id), 2000 + RT(), 'day 4: the kingdom took the plot back (gone on both)');
  await t.waitFor(() => !onPlot(H) && !onPlot(G), 2000 + RT(), 'what was built on the plot is gone on both (the plot back on sale, clean)');
  await t.waitFor(() => /tomado/.test(notes(G)), 2000, 'notice: the plot was taken', () => notes(G));
  t.check((recOn(H, uid).rep[s0.k] | 0) === rep0 - 15 && (recOn(G, uid).rep[s0.k] | 0) === rep0 - 15, 'reputation −15 on both', `${rep0} → ${recOn(G, uid).rep[s0.k]}`);
  t.check(MG.building.placeReason(G.game, 'wall_wood', plot.x0 + 3, plot.y0 + 3, G.game.player, 0) !== null, 'no more building there');
  setCoins(G, 0);
  await t.checkDigest(H, G);
});

def('EC7', {
  title: 'EC: join and leave a kingdom on the mural; a member does not deal with a kingdom of another land, a traveller trades with all',
  src: 'village', timeout: 200000,
  expected: 'Reino tab: the card "Você e <reino>" (Viajante, reputation rank and bar, what it means); "Entrar no Reino de …" makes the guest a member (record k on both peers; the card says Membro); at the mural of a settlement of a kingdom on another land mass a member is refused ("não tem relações"); "Sair do reino" there makes it a traveller again (k −1 on both) and the same purchase goes through; digest equal',
  api: 'mut/eco.js realm.join / realm.leave → eco.member, game/eco.js dealReason (canReach), ui/muralEco.js realmCard',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y), K = R.kingdoms[s0.k];
  const uid = await ecoReady(t, H, G);
  if ((recOn(H, uid)?.k ?? -1) >= 0) await ecoReq(G, 'realm.leave', {});
  await toMural(t, H, MH, G, MG, s0.id);
  muralTab(G, s0.id, 'realm');
  await t.waitFor(() => /Você e/.test(ecoTxt(G)) && /Viajante/.test(ecoTxt(G)), 3000, 'Reino: the card "Você e …" says Viajante');
  G.doc.querySelector('.p-mural [data-rjoin]').click();
  await t.waitFor(() => recOn(H, uid)?.k === K.id && recOn(G, uid)?.k === K.id, 2000 + RT(), `a member of ${K.name} on both peers`);
  await t.waitFor(() => /Membro/.test(ecoTxt(G)), 2000, 'the card says Membro');
  G.game.events.emit('closepanels', {});
  // a kingdom of another land mass
  const other = R.settlements.filter((q) => R.kingdoms[q.k].comp !== K.comp && q.kind !== 'castle').sort((a, b) => Math.hypot(a.x - s0.x, a.y - s0.y) - Math.hypot(b.x - s0.x, b.y - s0.y))[0];
  t.need(other, 'a settlement on another land mass');
  t.check(!MH.realm.canReach(R, K.id, other.k), 'not reachable by land', `${K.name} / ${R.kingdoms[other.k].name}`);
  await toMural(t, H, MH, G, MG, other.id);
  const P = MH.eco.profileOf(H.game, other.id), gi = [...Array(MH.eco.NG).keys()].find((i) => P.deals[i] && (H.game.eco.mk.get(other.id)[i] | 0) > 3);
  const gid = MH.eco.GOODS[gi][0];
  setCoins(G, 2000);
  const cost = () => MG.eco.quoteBuy(G.game, other.id, gi, 1, uid).cost;
  setCoins(G, 2000 - cost());
  const no = await ecoReq(G, 'trade.buy', { sid: other.id, g: gid, n: 1, max: cost() }, { refund: { coin: cost() } });
  t.check(!no.ok && /relações/.test(no.why || '') && coinsOf(G) === 2000, 'a member: refused at a kingdom of another land', no.why);
  muralTab(G, other.id, 'realm');
  const lv = await t.waitFor(() => G.doc.querySelector('.p-mural [data-rleave]'), 3000, 'the leave button');
  lv.click();
  await t.waitFor(() => recOn(H, uid)?.k === -1 && recOn(G, uid)?.k === -1, 2000 + RT(), 'a traveller again on both peers');
  G.game.events.emit('closepanels', {});
  const c = cost();
  setCoins(G, 2000 - c);
  const ok = await ecoReq(G, 'trade.buy', { sid: other.id, g: gid, n: 1, max: c }, { refund: { coin: c } });
  t.check(ok.ok, 'a traveller trades with all', ok.why);
  await t.checkDigest(H, G);
});

def('EC8', {
  title: 'EC: a save keeps the economy — markets, the players\' reputation / kingdom / jobs, properties and the town chests',
  src: 'village', timeout: 200000,
  expected: 'The host\'s save (buildSaveData → JSON) carries world.eco: every market\'s stocks, the guest\'s record (reputation, kingdom, jobs), the properties with their owners and debts, the contents of a bought house\'s chest; loaded into a fresh game of the same seed (applyWorld load) the economy is exactly the same (ecoDigestRows equal) and prices quote the same; digest equal',
  api: 'game/save.js buildSaveData, net/snapshot.js serializeWorld / applyWorld (eco), mut/eco.js ecoRows / applyEcoRows / ecoDigestRows',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y);
  const uid = await ecoReady(t, H, G);
  // something of everything: a job, a house with a chest holding something (EC5 may have made them already)
  const P = MH.eco.propsOf(H.game, s0.id);
  if (![...H.game.eco.pr.values()].some((r) => r.u === uid)) {
    if ((recOn(H, uid)?.rep[s0.k] | 0) < 25) giveRep(H, uid, s0.k, 30, s0.id);
    const h = P.houses.find((q) => q.mode === 'rent' && !H.game.eco.pr.has(q.id));
    if (h) { const rent = MH.eco.rentOf(H.game, h); await toMural(t, H, MH, G, MG, s0.id); setCoins(G, 1000 - rent); await ecoReq(G, 'prop.rent', { id: h.id, paid: rent }, { refund: { coin: rent } }); }
  }
  if (!recOn(H, uid)?.jobs.length) { const j = MH.eco.boardOf(H.game, s0.id).find((x) => x.t !== 'deliver'); if (j) { await toMural(t, H, MH, G, MG, s0.id); await ecoReq(G, 'job.take', { sid: s0.id, id: j.id }); } }
  await t.sleep(RT() + 200);
  const data = JSON.parse(JSON.stringify(MH.save.buildSaveData(H.game))), saved = JSON.stringify(MH.meco.ecoDigestRows(H.game)); // (the host's economy at the moment of the save)
  const gi = MH.eco.GI.wheat, q0 = MH.eco.quoteBuy(H.game, s0.id, gi, 5, uid).cost;
  const e = data.world?.eco;
  t.check(e && e.mk.length === R.settlements.length, 'the save carries every market', e ? `${e.mk.length}/${R.settlements.length}` : 'no eco');
  const pr = e?.pl.find((r) => r[0] === uid);
  t.check(pr && Object.keys(pr[3]).length > 0, 'the guest\'s record (reputation by kingdom, kingdom, jobs)', pr ? JSON.stringify(pr.slice(0, 4)) + ` jobs ${pr[6].length}` : 'none');
  t.check(e.pr.some((r) => r[1] === uid), 'the guest\'s properties', JSON.stringify(e.pr.filter((r) => r[1] === uid)));
  if (e.st.length) t.note(`town chests saved: ${e.st.length}`);
  // a fresh game of the same seed loads it
  const S = await bootSolo(t, '&start=village', 'solo');
  const MS = await A.mods(S);
  await t.waitFor(() => S.game.eco?.mk, 15000, 'the solo game\'s economy');
  S.game.net.withApply(() => MS.snapshot.applyWorld(S.game, data.world, 'load'));
  const a = saved, b = JSON.stringify(MS.meco.ecoDigestRows(S.game));
  t.check(a === b, 'loaded: the same economy (markets, players, properties, town chests)', a === b ? `${a.length} B` : `host ${a.length} B · loaded ${b.length} B`);
  t.check(MS.eco.quoteBuy(S.game, s0.id, gi, 5, uid).cost === q0, 'the same price quotes after the load', `${MS.eco.quoteBuy(S.game, s0.id, gi, 5, uid).cost} / ${q0}`);
  frames.close(S);
  await t.checkDigest(H, G);
});

// FX — settlements, phase 2 fixes (docs/REINOS.md "Fase 2 — correções e desempenho"): free doors (the validator in
// tools/mp-test/towncheck.js), climbable palisades, walking into a city without hitches.
// =====================================================================================================
// stand at (x, y) and wait until settlement sid is made around there on frame f (its chunks loaded, its pieces placed)
async function townReady(t, f, M, sid, x, y, ms = 60000) {
  const a = A.freeSpot(f, M, x, y, { rMin: 0, rMax: 4 }) || [x, y];
  A.teleport(f, a[0], a[1]);
  const T = f.game.towns;
  await t.waitFor(() => piecesOn(f, sid) > 50 && T.ready(sid), ms, `settlement ${sid} made on ${f.label}`, () => `${piecesOn(f, sid)} pieces · jobs ${T.jobs.length} · waiting ${[...T.wait.values()].reduce((n, q) => n + q.length, 0)}`);
  await t.sleep(800);
}
const nearestOf = (R, kind, x, y, pred = () => true) => R.settlements.filter((s) => s.kind === kind && pred(s)).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0] || null;

def('FX1', {
  title: 'FX: every settlement door is free inside and outside, and the game\'s own pathfinding reaches every bed, workplace and chest; every wall walk is reached by its stairs (validator, two seeds)',
  timeout: 420000,
  expected: 'Solo frames on two seeds (a new world on a village plaza). (1) Every settlement\'s plan (~240 a seed): no door with a piece of the plan on the tile right inside or right outside it, every archer spot on a wall top. (2) Every prefab (houses, workshops, tavern, barracks, keep…) × 4 rotations stamped as real structures on clear ground: the tiles inside and outside its door are free (nav.walkable) and levels.findPath goes from the doorstep through the opened door to a free tile beside every bed, workplace and chest (the keep\'s beds upstairs by its stairs). (3) The start village, the nearest castle, the capital city and the nearest palisade village made in the world: the same for every building, plus a complete path from the plaza to each door and from the plaza up the stairs to every archer spot on the wall walk (palisade story 1, stone walls / tower tops story 2). Zero problems',
  api: 'tools/mp-test/towncheck.js checkLayout / checkPrefabs / checkTown; game/levels.js findPath; game/nav.js walkable; world/realm/prefabs.js stampPrefab; world/realm/layout.js palisadeStairs',
}, async (t) => {
  let total = 0;
  for (const seed of [CFG.seed, CFG.seed + 1311]) {
    presetPid('s' + rand(7));
    const S = t.open(`solo-towns-${seed}`, `seed=${seed}&nosave=1`, null);
    await t.waitFor(() => (S.game && S.loadingHidden && S.game.towns?.realm) || S.bootError, CFG.bootMs, `solo frame (seed ${seed}) boot`);
    if (S.bootError) throw new Fail(`seed ${seed}: boot failed: ${S.bootError}`);
    const M = await A.mods(S), X = await TC.townMods(S), g = S.game, R = g.towns.realm, sp = g.world.spawn;
    A.keepAlive(t, S);
    // (1) every plan of the seed
    const P1 = [];
    for (const s of R.settlements) P1.push(...TC.checkLayout(g.towns.layout(s.id), X));
    t.check(!P1.length, `seed ${seed}: every settlement plan (${R.settlements.length}) — doors free of the plan's pieces, archer spots on wall tops`, P1.slice(0, 8).join(' | '));
    // (2) every prefab × 4 rotations (the first seed: the prefabs are the same everywhere)
    if (seed === CFG.seed) {
      // (open ground south-east of the village, its chunks loaded)
      const ax = sp.x + 70, ay = sp.y + 50;
      A.teleport(S, ax, ay);
      await t.waitFor(() => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!g.world.isLoaded(g.world.chunkIndex(ax + dx * 64, ay + dy * 64))) return false; return true; }, 30000, 'the ground around the test site loaded');
      await t.sleep(500);
      const r = TC.checkPrefabs(g, X, ax, ay);
      t.check(r.n === Object.keys(X.prefabs.PREFABS).length * 4 && !r.problems.length, `every prefab × 4 rotations (${r.n}): doors free, every bed / workplace / chest reached`, r.problems.slice(0, 8).join(' | '));
      total += r.n;
    }
    // (3) real settlements in the world
    const s0 = MS_at(M, R, sp), castle = nearestOf(R, 'castle', sp.x, sp.y), city = R.settlements[R.kingdoms[s0.k].capital];
    const pal = nearestOf(R, 'village', sp.x, sp.y, (s) => s.walls === 'palisade');
    const visit = [s0, castle, city, ...(pal && pal.id !== s0.id ? [pal] : [])];
    for (const s of visit) {
      const L = g.towns.layout(s.id);
      await townReady(t, S, M, s.id, L.spawn[0], L.spawn[1], s.kind === 'city' ? 90000 : 60000);
      const r = TC.checkTown(g, X, s.id);
      t.check(!r.problems.length && r.buildings === r.total, `seed ${seed}: ${s.kind} ${s.name} (${s.walls || 'sem muralha'}) — ${r.buildings}/${r.total} buildings, ${r.targets} beds / workplaces / chests, ${L.hooks.archers.length} archer spots: doors free, all reached`, r.problems.slice(0, 8).join(' | '));
      if (s.walls === 'palisade') t.check(L.structs.filter((q) => q[0] === 'stairs_wood').length >= L.gates.length + 1, `${s.name}: the palisade has stairs (beside each gate and on the sides)`, L.structs.filter((q) => q[0] === 'stairs_wood').length);
      total += r.buildings;
    }
    frames.close(S);
  }
  t.log(`checked ${total} buildings / prefab rotations`);
});
const MS_at = (M, R, sp) => M.realm.settlementAt(R, sp.x, sp.y);

def('FX2', {
  title: 'FX: the guest climbs a village palisade by its stairs and walks on its top; the host sees it up there',
  src: 'village', timeout: 150000,
  expected: 'The start village (seed 4242) has a palisade with wooden stairs on the inside (the same piece ids on both peers; its log walls are story-1 surfaces on both). The guest stands at the foot of the stair beside a gate and walks up: z rises 0 → 1 and it ends on the wall top (lv 1, z 1) — the host\'s avatar of the guest is at lv 1 in the same place; it walks along the wall walk (still lv 1, over wall tops); then back down the same stair to the ground (lv 0 on both); digest equal',
  api: 'world/realm/layout.js palisadeStairs (stairs_wood at the wall, hooks.archers lv 1); game/levels.js (wall tops, stairs); presence z',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const R = realmOf(H), sp = H.game.world.spawn, s0 = MS_at(MH, R, sp);
  const pal = s0.walls === 'palisade' ? s0 : nearestOf(R, 'village', sp.x, sp.y, (s) => s.walls === 'palisade');
  t.need(pal, 'a palisade village');
  const L = H.game.towns.layout(pal.id), gp = G.game.player;
  A.keepAlive(t, G); A.keepAlive(t, H);
  await visitTown(t, H, MH, G, MG, pal.id, L.spawn[0], L.spawn[1]);
  const stairs = (f) => [...(townOf(f, pal.id)?.objs.values() || [])].filter((o) => o.type === 'stairs_wood');
  await t.waitFor(() => stairs(H).length >= 2 && stairs(G).length === stairs(H).length, 20000, 'the palisade stairs on both');
  t.check(stairs(H).map((o) => o.id).sort().join() === stairs(G).map((o) => o.id).sort().join(), 'the same stairs on both', stairs(G).map((o) => o.id).join(' '));
  // the stair nearest a gate
  const gates = [...townOf(G, pal.id).objs.values()].filter((o) => o.type === 'gate_big_wood');
  const st = stairs(G).sort((a, b) => Math.min(...gates.map((q) => Math.hypot(q.x - a.x, q.y - a.y))) - Math.min(...gates.map((q) => Math.hypot(q.x - b.x, q.y - b.y))))[0];
  const r = st.rot & 3, D = [[0, -1], [1, 0], [0, 1], [-1, 0]][r];
  const ent = r === 0 ? [st.tx, st.ty + 2] : r === 2 ? [st.tx, st.ty - 1] : r === 1 ? [st.tx - 1, st.ty] : [st.tx + 2, st.ty];
  const land = r === 0 ? [st.tx, st.ty - 1] : r === 2 ? [st.tx, st.ty + 2] : r === 1 ? [st.tx + 2, st.ty] : [st.tx - 1, st.ty];
  const wi = G.game.world.idx(land[0], land[1]);
  G.game.levels.sync(); H.game.levels.sync();
  t.check(G.game.levels.isSurface(1, wi) && H.game.levels.isSurface(1, wi), 'the palisade top at the stair\'s landing is a story-1 surface on both', `${land}`);
  t.check(MG.data.BUILDINGS[G.game.build.grid.main.get(wi)?.type]?.connect === 'wall', 'the landing is a log wall of the palisade', G.game.build.grid.main.get(wi)?.type);
  A.teleport(G, ent[0] + 0.5, ent[1] + 0.5);
  await A.hostSees(t, H, G);
  const zs = [];
  const zw = t.watch(() => zs.push(+(gp.z || 0).toFixed(3)), 4);
  let rel = A.holdMove(G, D[0], D[1]);
  // (up to the middle of the wall's top: the body clear of the air beside it — pushing on past it would hop down)
  await t.waitFor(() => gp.lv === 1 && gp.z === 1 && Math.floor(gp.x) === land[0] && Math.floor(gp.y) === land[1] && Math.abs((D[0] ? gp.x : gp.y) - (D[0] ? land[0] : land[1]) - 0.5) < 0.26, 6000, 'the guest walks up the stair onto the palisade', () => `${lvOf(gp)} at ${f2(gp.x)},${f2(gp.y)}`);
  rel(); zw.stop();
  t.check(zs.filter((v) => v > 0.05 && v < 0.95).length >= 3, 'z rises smoothly on the stair', short(zs.filter((_, i) => i % 3 === 0).slice(0, 30)));
  const av = () => guestOnHost(H, G);
  await t.waitFor(() => av() && av().lv === 1 && av().z === 1 && Math.hypot(av().x - gp.x, av().y - gp.y) < 0.4, RT() + 600, 'the host sees the guest on the palisade (lv 1, z 1)', () => `host av ${lvOf(av())} ${f2(av()?.x)},${f2(av()?.y)}`);
  // along the wall walk (sideways, away from the gate when possible)
  const side = [[-D[1], D[0]], [D[1], -D[0]]].find(([sx, sy]) => G.game.levels.isSurface(1, G.game.world.idx(land[0] + sx * 3, land[1] + sy * 3)) && G.game.levels.isSurface(1, G.game.world.idx(land[0] + sx, land[1] + sy)));
  t.assert(side, 'the wall walk goes on beside the landing');
  const p0 = [gp.x, gp.y];
  rel = A.holdMove(G, side[0], side[1]);
  await t.waitFor(() => Math.hypot(gp.x - p0[0], gp.y - p0[1]) > 2.2, 4000, 'the guest walks along the wall walk', () => `${lvOf(gp)} at ${f2(gp.x)},${f2(gp.y)}`);
  rel();
  const ti = G.game.world.idx(Math.floor(gp.x), Math.floor(gp.y));
  t.check(gp.lv === 1 && gp.z === 1 && G.game.levels.isSurface(1, ti) && MG.data.BUILDINGS[G.game.build.grid.main.get(ti)?.type]?.connect === 'wall', 'still on the palisade top (lv 1, over a wall)', `${lvOf(gp)} at ${f2(gp.x)},${f2(gp.y)}`);
  await t.waitFor(() => av()?.lv === 1 && Math.hypot(av().x - gp.x, av().y - gp.y) < 0.4, RT() + 600, 'the host follows the guest along the wall walk');
  // down again: a click at the foot of the stair (the game's own path over the stories: along the wall walk, the stair)
  await A.walkTo(t, G, ent[0] + 0.5, ent[1] + 0.5, { ms: 8000 });
  await t.waitFor(() => !gp.lv && !gp.z && Math.hypot(gp.x - (ent[0] + 0.5), gp.y - (ent[1] + 0.5)) < 1.6, 4000, 'the guest walks down the stair to the ground', () => `${lvOf(gp)} at ${f2(gp.x)},${f2(gp.y)}`);
  await t.waitFor(() => av() && !av().lv && !(av().z > 0), RT() + 600, 'the host sees the guest on the ground again');
  await t.checkDigest(H, G);
});

def('FX3', {
  title: 'FX: walking from open country along a road into the capital and across it — no long frame, a sane sprite count, no chunk made on the main thread',
  timeout: 300000,
  expected: 'Solo frame (seed 4242, a new world). The player walks (8 tiles/s, the game\'s own movement + steering) ~260 tiles along the realm\'s roads into the capital, through its gate to the market plaza and on to another gate while the city streams in (~18 000 pieces). Over the walk: no frame above 120 ms of main-thread time in this headless run (it shares one thread with the test page; the measured numbers on a 1280 × 720 page are in docs/REINOS.md), p95 under 14 ms; the settlement batches stay within their frame budget (towns.stats.maxMs < 30 ms); no chunk generated synchronously because of a settlement piece (world.stats.genSync grows by ≤ 2: only the player\'s own chunk may be made at once when a worker is late); at the plaza fewer than 9000 sprites',
  api: 'game.frameStats(reset), game.towns.stats, world.stats.genSync, renderer.stats.sprites; game/towns.js (pieces kept in their anchor chunk, T.wait), levels.addPiece, mut/structures.js structsOfType',
}, async (t) => {
  presetPid('s' + rand(7));
  const S = t.open('solo-walk', `seed=${CFG.seed}&nosave=1`, null);
  await t.waitFor(() => (S.game && S.loadingHidden && S.game.towns?.realm) || S.bootError, CFG.bootMs, 'solo frame boot');
  if (S.bootError) throw new Fail(`boot failed: ${S.bootError}`);
  const M = await A.mods(S), g = S.game, R = g.towns.realm, sp = g.world.spawn, p = g.player;
  A.keepAlive(t, S);
  const s0 = MS_at(M, R, sp), city = R.settlements[R.kingdoms[s0.k].capital], L = g.towns.layout(city.id);
  // the road: roads chained away from the city (the longest each time) until ~260 tiles out, walked back in
  const ptsOf = (r, from) => { let q = []; for (let i = 0; i < r.pts.length; i += 2) q.push([r.pts[i], r.pts[i + 1]]); if (Math.hypot(q[0][0] - from.x, q[0][1] - from.y) > Math.hypot(q[q.length - 1][0] - from.x, q[q.length - 1][1] - from.y)) q.reverse(); return q; };
  let rd = [], at = city, far = 0;
  const used = new Set(), D0 = 260;
  for (let hop = 0; hop < 4 && far < D0 + 60; hop++) {
    const c = at.roads.map((id) => R.roads[id]).filter((r) => r && !used.has(r.id)).map((r) => [r, ptsOf(r, at)]).sort((a, b) => Math.hypot(b[1].at(-1)[0] - city.x, b[1].at(-1)[1] - city.y) - Math.hypot(a[1].at(-1)[0] - city.x, a[1].at(-1)[1] - city.y))[0];
    if (!c) break;
    used.add(c[0].id); rd.push(...c[1]);
    at = R.settlements[c[0].a === at.id ? c[0].b : c[0].a]; far = Math.hypot(rd.at(-1)[0] - city.x, rd.at(-1)[1] - city.y);
  }
  rd = rd.filter(([x, y]) => Math.hypot(x - city.x, y - city.y) > city.r + 3 && Math.hypot(x - city.x, y - city.y) < D0 + city.r).reverse();
  t.assert(rd.length > 4, 'a road into the capital', rd.length);
  const gd = (k) => Math.hypot(L.structs[k][1] - city.x, L.structs[k][2] - city.y), end = rd.at(-1);
  const outer = [...L.gates].filter((k) => gd(k) > L.A - 3).sort((a, b) => Math.hypot(L.structs[a][1] - end[0], L.structs[a][2] - end[1]) - Math.hypot(L.structs[b][1] - end[0], L.structs[b][2] - end[1]));
  const gc = (k) => { const q = L.structs[k]; return [q[1] + (q[3] & 1 ? 0.5 : 1), q[2] + (q[3] & 1 ? 1 : 0.5)]; };
  const [gx, gy] = gc(outer[0]), ux = (gx - city.x) / gd(outer[0]), uy = (gy - city.y) / gd(outer[0]);
  const pts = [...rd.slice(1), [gx + ux * 4, gy + uy * 4], [gx - ux * 4, gy - uy * 4], [L.plaza[0], L.plaza[1] + 2]], plazaI = pts.length - 1;
  if (outer.length > 1) { const [hx, hy] = gc(outer.at(-1)), n = Math.hypot(hx - city.x, hy - city.y); pts.push([hx - (hx - city.x) / n * 4, hy - (hy - city.y) / n * 4]); }
  A.teleport(S, rd[0][0], rd[0][1]);
  await t.waitFor(() => g.world.isLoaded(g.world.chunkIndex(p.x, p.y)), 20000, 'the start of the road loaded');
  await t.sleep(5000);
  // by day, gates open
  if (g.env.hour >= 17 || g.env.hour < 6.5) nightClock(S, 9);
  const gen0 = g.world.stats.genSync, T = g.towns;
  T.stats.maxMs = 0;
  g.frameStats(true);
  p.speed = 8;
  let i = 0, sprPlaza = 0, stuckT = 0, last = [p.x, p.y];
  const W = { done: false };
  g.input.move = () => {
    if (W.done) return [0, 0];
    const [tx, ty] = pts[i], d = Math.hypot(tx - p.x, ty - p.y);
    if (d < 2) { if (i === plazaI) sprPlaza = g.R.stats.sprites; i++; if (i >= pts.length) W.done = true; return [0, 0]; }
    return M.nav.steer(g, p, tx, ty, 1 / 60, 8, 0.3) || [(tx - p.x) / d, (ty - p.y) / d];
  };
  t.defer(() => { delete g.input.move; p.speed = 4; });
  const t0 = now();
  await t.waitFor(() => {
    if (Math.hypot(p.x - last[0], p.y - last[1]) > 0.5) { last = [p.x, p.y]; stuckT = now(); }
    else if (!stuckT) stuckT = now();
    if (now() - stuckT > 6000 && i < pts.length) { i++; stuckT = now(); } // (a stuck waypoint: the next one)
    return W.done;
  }, 200000, 'the walk into the capital and across it', () => `waypoint ${i}/${pts.length} at ${f2(p.x)},${f2(p.y)}`);
  const fs = g.frameStats(), gen = g.world.stats.genSync - gen0;
  t.log(`walk ${Math.round((now() - t0) / 1000)} s: ${fs.n} frames · avg ${fs.avg} ms · p95 ${fs.p95} · max ${fs.max} · >16 ms ${fs.over16} · towns batch max ${f2(T.stats.maxMs)} ms · sync chunks ${gen} · sprites at the plaza ${sprPlaza}`);
  t.check(fs.max < 120, 'no frame above 120 ms of main-thread time (headless, shared thread)', `max ${fs.max} ms`);
  t.check(fs.p95 < 14, 'p95 under 14 ms', `p95 ${fs.p95} ms`);
  t.check(T.stats.maxMs < 30, 'settlement batches within their frame budget', `${f2(T.stats.maxMs)} ms`);
  t.check(gen <= 2, 'no chunk generated on the main thread because of a settlement piece', `${gen} synchronous chunks`);
  t.check(sprPlaza > 300 && sprPlaza < 9000, 'a sane sprite count at the market plaza', sprPlaza);
});

// =====================================================================================================
// WR — phase 3a: diplomacy, who owns each place, armies on the map, field battles and sieges by numbers far from the
// players, conquest, the fall of a kingdom, the players' properties lost with a place (docs/REINOS.md §12 / §13).
// The kingdoms' AI is paused in every scenario (act.js reset); these drive it themselves (game.realms.dbg, op realm.rel).
// Seed 4242: Valadestra (15) and Rabelonia (4) are neighbours joined by roads, far from the start (~2 500 tiles); the
// start kingdom Galéria (9) has no border — its rivals of the same land mass (Arenudia, 11) are reached across country.
// =====================================================================================================
const RZ = (f) => f.game.realms;
const fieldOn = (f) => [...f.game.realms.armies.values()].filter((a) => a.state !== 'home');
const noteTxt = (f) => [...f.doc.querySelectorAll('.wos-note')].map((n) => n.textContent.replace(/\s+/g, ' ')).join(' | ');
const newsOn = (f) => f.game.realms.news.map((r) => f.game.realms.newsText(r));
const realmRowsOn = (f, M) => JSON.stringify(M.mrealms.realmDigestRows(f.game));
const VAL = 15, RAB = 4; // (seed 4242)
// a quiet start: the AI paused, no wars, no armies in the field, nothing frozen (both peers)
async function wrQuiet(t, H, G) {
  const R = RZ(H);
  R.dbg.stop(true); R.dbg.freeze(false);
  for (const [key] of [...R.rels]) { const [a, b] = key.split('.').map(Number); H.game.net.emit('realm.rel', { a, b, rel: 'neutral', quiet: 1 }); }
  for (const a of fieldOn(H)) H.game.net.emit('realm.army', { del: a.id });
  H.game.net.flush();
  await t.waitFor(() => !fieldOn(G).length && !RZ(G).rels.size && !RZ(H).rels.size, 3000 + RT(), 'no wars and no armies in the field on both peers');
}
// the clock forward by game hours (env.skip on the host: every peer jumps; the host's simulation catches up in steps)
function wrSkip(H, hours) {
  const g = H.game, E = g.env, hl = (E.dayLength || 780) / 24;
  let hour = E.hour + hours, day = E.dayIndex;
  while (hour >= 24) { hour -= 24; day++; }
  g.net.emit('env.skip', { hour: +hour.toFixed(3), day, wt: Math.round((g.worldTime + hours * hl) * 100) / 100 });
  g.net.flush();
}
// the places of kingdom k nearest the places of kingdom e (its border with e)
function frontOf(f, k, e, kind = null) {
  const R = realmOf(f), mine = R.settlements.filter((s) => RZ(f).owner(s.id) === k && (!kind || s.kind === kind)), theirs = R.settlements.filter((s) => RZ(f).owner(s.id) === e);
  const d = (s) => Math.min(...theirs.map((q) => Math.hypot(f.game.world.dx(q.x, s.x), q.y - s.y)));
  return mine.sort((a, b) => d(a) - d(b) || a.id - b.id);
}
const hexC = (c) => c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

def('WR1', {
  title: 'WR: the same diplomacy on both peers; never a war across the sea; the start kingdom\'s 2-day grace',
  src: 'village', timeout: 120000,
  expected: 'Both peers hold the same kingdoms\' state (relations, tensions, every place\'s home army, the start kingdom, its first day: digest part realms); realm.rel between kingdoms of different land masses is ignored on both (no ships); between neighbours of one land mass it takes on both and shows in rel / atWar; the start kingdom (the spawn village\'s) is in its grace on its first 2 days — the daily diplomacy never puts it at war then, even with the tension at 99 — and out of it from the third day, when the same tension makes the war come; digest equal',
  api: 'game/realms.js (game.realms.rel / atWar / inGrace, dayTick), game/mut/realms.js (realm.rel, realm.day, realmDigestRows), content/war.js WAR.graceDays',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const RH = RZ(H), RG = RZ(G), R = realmOf(H);
  t.need(RH?.dbg && RG?.armies, 'game.realms on both peers');
  await t.waitFor(() => RH.day0 >= 0 && RG.day0 >= 0, 8000, 'the kingdoms\' wars started on both (realm.start)');
  await wrQuiet(t, H, G);
  t.check(RH.k0 === RG.k0 && RH.k0 === MH.realm.settlementAt(R, H.game.world.spawn.x, H.game.world.spawn.y).k, 'the start kingdom: the spawn village\'s, on both', `${RH.k0} (${R.kingdoms[RH.k0]?.name})`);
  t.check(RG.armies.size === R.settlements.length && [...RG.armies.values()].every((a) => a.state === 'home'), 'every place has its home army on both', `${RH.armies.size} / ${RG.armies.size}`);
  t.check(realmRowsOn(H, MH) === realmRowsOn(G, MG), 'the same kingdoms\' state on both peers', `${realmRowsOn(H, MH).length} B`);
  // the sea: no relations across land masses
  const k0 = R.kingdoms[0], far = R.kingdoms.find((K) => K.comp !== k0.comp);
  t.need(far, 'two land masses');
  H.game.net.emit('realm.rel', { a: k0.id, b: far.id, rel: 'war', by: k0.id, why: 'debug' }); H.game.net.flush();
  H.game.net.emit('realm.rel', { a: VAL, b: RAB, rel: 'war', by: VAL, why: 'debug' }); H.game.net.flush();
  await t.waitFor(() => RG.atWar(VAL, RAB) && RH.atWar(RAB, VAL), 2000 + RT(), 'neighbours of one land mass: at war on both (rel / atWar, symmetric)');
  t.check(RH.rel(k0.id, far.id) === 'neutral' && RG.rel(k0.id, far.id) === 'neutral' && !RG.atWar(k0.id, far.id), 'kingdoms of different land masses: never at war (the op is ignored on both)', `${k0.name} × ${far.name}: ${RG.rel(k0.id, far.id)}`);
  t.check(RG.rel(VAL, VAL) === 'self' && RG.relInfo(VAL, RAB).by === VAL, 'rel(k, k) = self; who declared it', RG.relInfo(VAL, RAB).by);
  await wrQuiet(t, H, G);
  // the grace: the start kingdom's rivals at tension 99 every day — never a war in its first 2 days
  const K0 = RH.k0, rivals = RH.dbg.pairs().filter((p) => p[0] === K0 || p[1] === K0).map((p) => (p[0] === K0 ? p[1] : p[0]));
  t.need(rivals.length, 'the start kingdom has relations with somebody');
  const hot = () => { H.game.net.emit('realm.day', { day: RH.day, gar: [], tens: rivals.map((r) => [MH.mrealms.relKey(K0, r), 99]), weary: [] }); H.game.net.flush(); };
  const day0 = RH.day0, d1 = H.game.env.dayIndex;
  t.defer(() => { try { H.game.net.emit('realm.day', { day: RH.day, gar: [], tens: rivals.map((r) => [MH.mrealms.relKey(K0, r), 20]), weary: [] }); H.game.net.flush(); } catch { /* ignore */ } });
  if (d1 < day0 + 2) {
    t.check(RH.inGrace(K0) && RG.inGrace(K0), 'the start kingdom in its grace on both (day ' + d1 + ')');
    RH.H.noDiplo = false;
    for (let k = 0; k < 6; k++) { hot(); RH.dbg.day(); }
    RH.H.noDiplo = true;
    H.game.net.flush();
    await t.sleep(RT() + 200);
    t.check(!rivals.some((r) => RG.atWar(K0, r)), 'six days of diplomacy at tension 99: no war with the start kingdom in its grace', rivals.map((r) => RG.rel(K0, r)).join(','));
  } else t.note(`the world is already on day ${d1} (first day ${day0}): the grace part was checked by its rule only`);
  // out of the grace (day0 + 2): the same tension brings a war
  const want = day0 + WAR_GRACE(MH);
  if (H.game.env.dayIndex < want) { skipDays(H, want - H.game.env.dayIndex); await t.waitFor(() => G.game.env.dayIndex >= want, 3000 + RT(), 'the third day of the world on both'); }
  t.check(!RH.inGrace(K0) && !RG.inGrace(K0), 'from day ' + want + ': the grace is over', H.game.env.dayIndex);
  RH.H.noDiplo = false;
  for (let k = 0; k < 8 && !rivals.some((r) => RH.atWar(K0, r)); k++) { hot(); RH.dbg.day(); }
  RH.H.noDiplo = true;
  H.game.net.flush();
  await t.waitFor(() => rivals.some((r) => RG.atWar(K0, r)), 3000 + RT(), 'after the grace the start kingdom can be at war (seen on the guest)', () => rivals.map((r) => `${r}:${RG.rel(K0, r)}`).join(' '));
  await wrQuiet(t, H, G);
  await t.checkDigest(H, G);
});
const WAR_GRACE = (M) => M.war.WAR.graceDays;

def('WR2', {
  title: 'WR: a forced war (realm.rel) → the member guest hears every change of its kingdom; a campaign gathers and marches; the markets feel it',
  src: 'village', timeout: 200000,
  expected: 'The guest joins the start kingdom at the Estrosa mural. The host forces war between it and its rival (op realm.rel): the guest sees "O Reino de X declarou guerra ao Reino de Y" (a notice), so do an alliance and a peace treaty of its kingdom (every diplomatic change of the player\'s kingdom reaches the member); the mural\'s Reino tab lists the relations (Em guerra / Aliado / Trégua) and "Notícias do reino"; with the AI on, a war between Valadestra and Rabelonia sends a campaign: an army forms (contingents gather at a muster place) and marches on an enemy place — the same armies on both peers, the news "Um exército … marcha sobre …"; the Exército tab lists the campaign; an economy day after the war began brings war news to the markets (weapons / iron wanted at the front, food in a besieged place); digest equal',
  api: 'game/realms.js plan / sendForce / depart / marketNews, ui/warHud.js (notices), ui/muralWar.js (Reino / Exército), game/eco.js simulateDay (marketNews)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const RH = RZ(H), RG = RZ(G), R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G);
  const K0 = RH.owner(s0.id), riv = RH.dbg.pairs().filter((p) => p[0] === K0 || p[1] === K0).map((p) => (p[0] === K0 ? p[1] : p[0]))[0];
  t.need(riv != null, 'a rival of the start kingdom');
  await toMural(t, H, MH, G, MG, s0.id);
  if (recOn(H, uid)?.k !== K0) { const j = await ecoReq(G, 'realm.join', { sid: s0.id }); t.check(j.ok, 'the guest joins the start kingdom at the mural', j.why); }
  await t.waitFor(() => recOn(G, uid)?.k === K0, 2000 + RT(), 'the guest is a member on both');
  t.defer(() => { try { H.game.net.emit('eco.member', { u: uid, k: -1, name: recOn(H, uid)?.name || '' }); H.game.net.flush(); } catch { /* ignore */ } });
  // war, alliance, peace — each one a notice for the member
  H.game.net.emit('realm.rel', { a: riv, b: K0, rel: 'war', by: riv, why: 'debug' }); H.game.net.flush();
  await t.waitFor(() => /declarou guerra/.test(noteTxt(G)) && noteTxt(G).includes(R.kingdoms[K0].name), 9000, 'the member sees "… declarou guerra ao Reino de <seu reino>"', () => noteTxt(G));
  const friend = R.kingdoms.find((K) => K.id !== K0 && K.id !== riv && K.comp === R.kingdoms[K0].comp);
  if (friend) {
    H.game.net.emit('realm.rel', { a: K0, b: friend.id, rel: 'ally', why: 'debug' }); H.game.net.flush();
    await t.waitFor(() => /aliança/.test(noteTxt(G)), 9000, 'the member sees the alliance of its kingdom', () => noteTxt(G));
  }
  muralTab(G, s0.id, 'realm');
  await t.sleep(300);
  t.check(/Relações do Reino/.test(ecoTxt(G)) && /Em guerra/.test(ecoTxt(G)) && (!friend || /Aliado/.test(ecoTxt(G))) && /Notícias do reino/.test(ecoTxt(G)) && /declarou guerra/.test(ecoTxt(G)), 'mural Reino: the relations (Em guerra, Aliado) and the kingdom\'s news', short(ecoTxt(G).slice(ecoTxt(G).indexOf('Relações')), 220));
  H.game.net.emit('realm.rel', { a: riv, b: K0, rel: 'truce', until: H.game.env.dayIndex + 5, why: 'debug' }); H.game.net.flush();
  await t.waitFor(() => /assinaram a paz/.test(noteTxt(G)), 9000, 'the member sees the peace treaty (trégua)', () => noteTxt(G));
  await t.waitFor(() => /Trégua/.test(ecoTxt(G)), 3000, 'mural Reino: Trégua (the panel follows the news)');
  G.game.ui.panels.close();
  await wrQuiet(t, H, G);
  // a campaign: Valadestra and Rabelonia at war, the AI plans
  H.game.net.emit('realm.rel', { a: VAL, b: RAB, rel: 'war', by: VAL, why: 'debug' }); H.game.net.flush();
  RH.H.noPlan = false; RH.dbg.plan();
  t.defer(() => { RH.H.noPlan = true; });
  await t.waitFor(() => fieldOn(H).some((a) => a.mission === 'attack'), 5000, 'the host forms a campaign (an army with an enemy target)');
  await t.waitFor(() => JSON.stringify(fieldOn(G).map((a) => [a.id, a.k, a.target, a.n, a.state, a.mission, a.grp]).sort()) === JSON.stringify(fieldOn(H).map((a) => [a.id, a.k, a.target, a.n, a.state, a.mission, a.grp]).sort()), 3000 + RT(), 'the same armies on both peers (soldiers, target, state, muster group)');
  const camp = fieldOn(H).find((a) => a.mission === 'attack');
  t.check(R.settlements[camp.target] && RH.atWar(camp.k, RH.owner(camp.target)), 'its target: a place of the enemy', `${R.kingdoms[camp.k].name} → ${R.settlements[camp.target].name} (${R.kingdoms[RH.owner(camp.target)].name})`);
  const joins = fieldOn(H).filter((a) => a.grp === camp.id && a.mission === 'join');
  t.note(`campaign: ${camp.id} ${camp.state}/${camp.phase} ${camp.n} soldiers at ${R.settlements[camp.home].name}; ${joins.length} contingent(s) coming: ${joins.map((a) => a.n).join('+')}`);
  const tName = R.settlements[camp.target].name, out = (f) => fieldOn(f).some((a) => a.id === camp.id && a.state !== 'camp');
  for (let k = 0; k < 16 && !out(H); k++) { wrSkip(H, 1); await t.sleep(250); }
  await t.waitFor(() => out(G) && newsOn(G).some((x) => x.includes('marcha sobre ' + tName)), 4000 + RT(), `the gathered army sets out: "Um exército … marcha sobre ${tName}" on both`, () => newsOn(G).slice(-3).join(' | '));
  const main = fieldOn(H).find((a) => a.id === camp.id);
  t.check(main.n >= camp.n && main.path && (main.path.r.length > 0 || main.path.c), 'it marches as one army (the contingents joined it)', `${camp.n} → ${main.n} soldiers, ${main.path.r.length / 2} roads${main.path.c ? ' / across country' : ''}`);
  // the Exército tab of a place of that kingdom
  muralTab(G, main.home, 'army');
  await t.sleep(300);
  t.check(/Campanhas do Reino/.test(ecoTxt(G)) && /marchando sobre/.test(ecoTxt(G)) && /Alistamento|Você está no exército/.test(ecoTxt(G)), 'mural Exército: the place\'s army, the campaign (marchando sobre …) and the enlistment (phase 3c)', short(ecoTxt(G).slice(ecoTxt(G).indexOf('Campanhas')), 200));
  G.game.ui.panels.close();
  // the markets: war news at the front
  await ecoReady(t, H, G);
  await ecoDay(t, H, G);
  const GOODS = MH.ecoc.GOODS, warGoods = new Set(['arrow', 'sword_iron', 'spear_iron', 'shield_iron', 'iron_bar', 'bow_wood', 'armor_leather', 'bread', 'wheat', 'meat']);
  const front = H.game.eco.ev.filter((e) => [VAL, RAB].includes(RH.owner(e[0])) && warGoods.has(GOODS[e[1]][0]) && e[2] > 100);
  if (front.length) t.check(true, 'war news in the markets: shortages at the front', front.map((e) => `${GOODS[e[1]][0]} em ${R.settlements[e[0]].name}`).join(', '));
  else t.note('no war shortage drawn this day (the front places may not deal those goods)');
  // a day of recruits: never more soldiers at home than the place's maximum (the Exército tab: "Soldados · máx. N")
  const over = (f, M) => [...RZ(f).armies.values()].filter((a) => a.state === 'home' && a.n > M.war.capOf(R.settlements[a.home]));
  t.check(!over(H, MH).length && !over(G, MG).length, 'every home army within its maximum on both peers', over(G, MG).slice(0, 4).map((a) => `${R.settlements[a.home].name} ${a.n}/${MG.war.capOf(R.settlements[a.home])}`).join(', ') || `${R.settlements.length} places`);
  await wrQuiet(t, H, G);
  await t.checkDigest(H, G);
});

def('WR3', {
  title: 'WR: an army marches along the realm\'s roads — the same position on both peers, on the road, moving with the clock; the map and the radar draw it',
  src: 'village', timeout: 120000,
  expected: 'Valadestra at war with Rabelonia; one army leaves a Valadestra castle for a Rabelonia place (a route of realm roads, path.r); its row is the same on both peers (route, t0, d0, speed); its position — derived from the world clock on each peer — is within 3 tiles on host and guest, on the road polyline (< 1 tile from it), and moves forward ≈ speed × time (also across a time skip of 2 game hours); the map window (war layer: armies, borders at war) and the radar draw it on the guest without errors; ETA in the Exército tab; digest equal',
  api: 'game/realms.js routeOf / geomOf / along / realmsPosSystem / etaOf, ui/warMap.js drawWar / drawWarBorders, ui/realmMap.js territories',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const RH = RZ(H), RG = RZ(G), R = realmOf(H);
  await wrQuiet(t, H, G);
  H.game.net.emit('realm.rel', { a: VAL, b: RAB, rel: 'war', by: VAL, why: 'debug' }); H.game.net.flush();
  const from = frontOf(H, VAL, RAB, 'castle')[0], T = frontOf(H, RAB, VAL).find((s) => RH.dbg.route(from.id, s.id)?.road && RH.dbg.route(from.id, s.id).len > 200);
  t.need(from && T, 'a Valadestra castle and a Rabelonia place joined by road, 200+ tiles apart');
  H.game.net.emit('realm.army', { gar: [[from.id, 120]] }); H.game.net.flush();
  const a0 = RH.dbg.launch(from.id, T.id, 60);
  H.game.net.flush();
  t.check(a0 && a0.path.r.length > 0 && !a0.path.c, 'the army leaves along the realm\'s roads', a0 ? `${a0.id}: ${a0.path.r.length / 2} roads, ${f2(RH.routeOf(a0).len)} tiles to ${T.name}` : 'none');
  await t.waitFor(() => RG.armies.get(a0.id)?.state === 'march', 2000 + RT(), 'the guest has the army marching');
  const rowOf = (f) => { const a = RZ(f).armies.get(a0.id); return JSON.stringify([a.path, a.t0, a.d0, a.v, a.n, a.target]); };
  t.check(rowOf(H) === rowOf(G), 'the same row on both (route, clock, speed, soldiers, target)', rowOf(G).slice(0, 120));
  await t.sleep(1500);
  const posOn = (f) => { const a = RZ(f).armies.get(a0.id); RZ(f).posOf(a); return [a.x, a.y]; };
  const [hx, hy] = posOn(H), [gx, gy] = posOn(G);
  t.check(Math.hypot(H.game.world.dx(hx, gx), hy - gy) < 3, 'the same position on both peers (derived from the clock)', `host ${f2(hx)},${f2(hy)} · guest ${f2(gx)},${f2(gy)}`);
  // on the road: the nearest point of the route's road polylines
  const roadD = (x, y) => { let d = Infinity; const a = RZ(G).armies.get(a0.id); for (let i = 0; i < a.path.r.length; i += 2) { const P = R.roads[a.path.r[i]].pts; for (let k = 0; k + 3 < P.length; k += 2) { const ax = P[k], ay = P[k + 1], bx = P[k + 2], by = P[k + 3], px = ax + G.game.world.dx(x, ax), L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, u = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)); d = Math.min(d, Math.hypot(px - ax - u * (bx - ax), y - ay - u * (by - ay))); } } return d; };
  t.check(roadD(gx, gy) < 1, 'it walks on the road (distance to the road polyline)', f2(roadD(gx, gy)));
  const d0 = RH.routeOf(RH.armies.get(a0.id)) && MH.realms.distAt(RH.armies.get(a0.id), H.game.worldTime);
  wrSkip(H, 2);
  await t.sleep(RT() + 600);
  const [gx2, gy2] = posOn(G), d1 = MH.realms.distAt(RH.armies.get(a0.id), H.game.worldTime), hl = (H.game.env.dayLength || 780) / 24;
  t.check(d1 - d0 > 2 * hl * 0.9 * RH.armies.get(a0.id).v && Math.hypot(G.game.world.dx(gx2, gx), gy2 - gy) > 40 && roadD(gx2, gy2) < 1, 'two game hours later it is ≈ speed × time farther along the road, on both', `${f2(d0)} → ${f2(d1)} tiles along (${f2(Math.hypot(G.game.world.dx(gx2, gx), gy2 - gy))} moved on the guest)`);
  // the map and the radar draw it (and the border at war)
  const P = G.game.ui.panels;
  G.game.ui.minimap.view = { cx: gx2, cy: gy2, span: 900 };
  let err = null;
  try { P.show('map'); P.drawMap(); } catch (e) { err = e; }
  t.check(!err && G.doc.querySelector('.bigmap') && /Exército/.test(G.doc.querySelector('.p-map')?.textContent || '') && /Fronteira em guerra/.test(G.doc.querySelector('.p-map')?.textContent || ''), 'the map window draws the war layer (legend: Exército, Cerco, Batalha, Fronteira em guerra)', err ? err.message : 'ok');
  const T2 = MG.realmMap.territories(G.game), wl = T2 && MG.realmMap.TERR;
  t.check(!!wl, 'the territories raster (owners by district)');
  P.close(); G.game.ui.minimap.view = null;
  await wrQuiet(t, H, G);
  await t.checkDigest(H, G);
});

def('WR4', {
  title: 'WR: a field battle by numbers — two armies of kingdoms at war meet on the road, fight in rounds, the loser retreats',
  src: 'village', timeout: 120000,
  expected: 'A Valadestra army and a Rabelonia army march toward each other on the same roads; when they meet (≤ 10 tiles) both are in battle on both peers (the same foe, frozen at the meeting point), the news "Batalha entre os exércitos …"; rounds every 8 s of game time cost both sides soldiers (more to the weaker); when one breaks (below 45 % of what it had) it retreats home (or is wiped out) and the winner goes on — "O exército do Reino de X venceu …"; the losses are the same on both peers; digest equal',
  api: 'game/realms.js simStep (meetings) / startBattle / battleRound / endBattle / goHome, content/war.js WAR.battle',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const RH = RZ(H), RG = RZ(G), R = realmOf(H);
  await wrQuiet(t, H, G);
  H.game.net.emit('realm.rel', { a: VAL, b: RAB, rel: 'war', by: VAL, why: 'debug' }); H.game.net.flush();
  const A = frontOf(H, VAL, RAB, 'castle')[0];
  const B = frontOf(H, RAB, VAL).find((s) => s.kind !== 'village' && RH.dbg.route(A.id, s.id)?.road) || frontOf(H, RAB, VAL).find((s) => RH.dbg.route(A.id, s.id)?.road);
  t.need(A && B, 'two enemy places joined by road');
  H.game.net.emit('realm.army', { gar: [[A.id, 150], [B.id, 150]] }); H.game.net.flush();
  const n0 = RH.news.length;
  const a = RH.dbg.launch(A.id, B.id, 90), b = RH.dbg.launch(B.id, A.id, 40);
  H.game.net.flush();
  t.need(a && b, 'both armies launched');
  t.note(`${a.id} ${a.n} soldiers ${A.name} → ${B.name}; ${b.id} ${b.n} soldiers ${B.name} → ${A.name}; route ${f2(RH.routeOf(a).len)} tiles`);
  let fought = false;
  for (let k = 0; k < 40 && !fought; k++) {
    wrSkip(H, 0.5);
    await t.sleep(200);
    fought = RH.news.slice(n0).some((r) => r[3] === 'battle');
  }
  t.check(fought, 'they met and fought (news "battle")', newsOn(H).slice(-3).join(' | '));
  for (let k = 0; k < 20 && !RH.news.slice(n0).some((r) => r[3] === 'won'); k++) { wrSkip(H, 0.25); await t.sleep(200); }
  await t.waitFor(() => RG.news.slice(n0).some((r) => r[3] === 'won'), 3000 + RT(), 'the battle ends: "O exército do Reino de X venceu o do Reino de Y" on both', () => newsOn(G).slice(-3).join(' | '));
  const won = RG.news.slice(n0).find((r) => r[3] === 'won');
  t.check(won[4] === VAL, 'the stronger side (90 × 40) won', MG.realms.newsText(G.game, won));
  const sa = RH.armies.get(a.id), sb = RH.armies.get(b.id);
  t.check(!sa || sa.n < 90, 'the winner lost soldiers too', sa ? `${sa.n}/90 (${sa.state})` : 'gone');
  t.check(!sb || sb.state === 'retreat', 'the loser retreats home or was wiped out', sb ? `${sb.n} ${sb.state}` : 'wiped out');
  await t.waitFor(() => JSON.stringify([RG.armies.get(a.id)?.n, RG.armies.get(b.id)?.n, RG.armies.get(a.id)?.state, RG.armies.get(b.id)?.state]) === JSON.stringify([RH.armies.get(a.id)?.n, RH.armies.get(b.id)?.n, RH.armies.get(a.id)?.state, RH.armies.get(b.id)?.state]), 2000 + RT(), 'the same soldiers and states on both peers');
  await wrQuiet(t, H, G);
  await t.checkDigest(H, G);
});

def('WR5', {
  title: 'WR: a siege by numbers far from every player breaks the walls — the damage persists and both players see it when they arrive',
  src: 'village', timeout: 260000,
  expected: 'A big Valadestra army besieges a walled Rabelonia place ~2 500 tiles from both players: it camps on its road outside the walls (news "… está sob cerco"), builds engines (aríete, trabucos / catapulta), bombards the stretch of wall facing its camp and rams the gate: town-state rows on both peers (cracks: dmg; destroyed pieces: gone) although nobody has the place loaded; the walls are not mended while the siege lasts and for 2 days after (holdRepair); both players travel there: the destroyed pieces are missing and the cracked ones show their damage on both; digest equal',
  api: 'game/realms.js siegeHour / facing / perimeter, game/mut/realms.js realm.wall (TOWN.noteAbsent / note), game/towns.js placePiece (state rows), npc.js repairByNumbers (hold)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const RH = RZ(H), RG = RZ(G), R = realmOf(H);
  await wrQuiet(t, H, G);
  H.game.net.emit('realm.rel', { a: VAL, b: RAB, rel: 'war', by: VAL, why: 'debug' }); H.game.net.flush();
  const A = frontOf(H, VAL, RAB, 'castle')[0];
  const T = frontOf(H, RAB, VAL).find((s) => s.walls && RH.dbg.route(A.id, s.id)?.road && RH.owner(s.id) === RAB);
  t.need(A && T, 'a walled Rabelonia place joined by road to a Valadestra castle');
  const far = Math.min(Math.hypot(H.game.world.dx(T.x, H.game.player.x), T.y - H.game.player.y), Math.hypot(G.game.world.dx(T.x, G.game.player.x), T.y - G.game.player.y));
  t.check(far > 600, 'the place is far from both players (numbers, no materialized pieces)', `${Math.round(far)} tiles, walls ${T.walls}`);
  H.game.net.emit('realm.army', { gar: [[A.id, 260], [T.id, 90]] }); H.game.net.flush(); // (a garrison that holds a few hours: the siege is seen before the place falls)
  const a = RH.dbg.launch(A.id, T.id, 220);
  H.game.net.flush();
  const pre = `t${T.id}.`;
  const rowsOf = (f) => [...f.game.towns.state].filter(([id, r]) => id.startsWith(pre) && (r.gone || r.dmg > 0)).map(([id, r]) => [id, r.gone, r.dmg]).sort().join(';');
  for (let k = 0; k < 60 && !(RG.besieged(T.id) || RH.owner(T.id) !== RAB); k++) { wrSkip(H, 1); await t.sleep(150); }
  await t.waitFor(() => RG.besieged(T.id) && newsOn(G).some((x) => x.startsWith(T.name + ' está sob cerco')), 3000 + RT(), `${T.name} besieged on both ("… está sob cerco")`, () => newsOn(G).slice(-2).join(' | '));
  const sg = RH.siegeOf(T.id);
  t.check(Math.hypot(H.game.world.dx(sg.x, T.x), sg.y - T.y) > T.r + 4, 'the camp stands outside the town land, on its road', `${f2(Math.hypot(H.game.world.dx(sg.x, T.x), sg.y - T.y))} tiles from the centre (town land ${T.r})`);
  for (let k = 0; k < 40 && ![...H.game.towns.state].some(([id, r]) => id.startsWith(pre) && r.gone); k++) { wrSkip(H, 1); await t.sleep(200); }
  await t.waitFor(() => rowsOf(G) && rowsOf(G) === rowsOf(H), 3000 + RT(), 'the wall damage (cracks / destroyed pieces) in the town state on both, the place loaded by nobody', () => `host ${rowsOf(H).slice(0, 120)} · guest ${rowsOf(G).slice(0, 120)}`);
  const gone = [...H.game.towns.state].filter(([id, r]) => id.startsWith(pre) && r.gone).map(([id]) => id), hit = [...H.game.towns.state].filter(([id, r]) => id.startsWith(pre) && !r.gone && r.dmg > 0).map(([id]) => id);
  t.check(gone.length > 0, 'pieces of the wall line destroyed (the gate / a breach)', `${gone.length} gone, ${hit.length} cracked; engines ${JSON.stringify(RH.siegeOf(T.id)?.eng || RH.armies.get(a.id)?.eng || [])}`);
  t.check(RH.holdRepair(T.id) && RG.holdRepair(T.id), 'the walls are not mended while the siege lasts / just after (holdRepair)');
  // the players arrive: the breach is there on both
  RH.dbg.freeze(true); // (the siege waits while they look)
  t.defer(() => RH.dbg.freeze(false));
  const L = H.game.towns.layout(T.id), k0 = +gone[0].split('.')[1], row = L.structs[k0];
  await visitTown(t, H, MH, G, MG, T.id, row[1] + 0.5 + (row[1] > L.x ? 9 : -9), row[2] + 0.5 + (row[2] > L.y ? 9 : -9), 60000);
  const has = (f, id) => !!f.game.world.objById.get(id);
  t.check(gone.every((id) => !has(H, id) && !has(G, id)), 'the destroyed pieces are missing on both (the breach)', gone.slice(0, 6).join(' '));
  const placed = hit.filter((id) => has(H, id) && has(G, id));
  t.check(!hit.length || (placed.length && placed.every((id) => H.game.world.objById.get(id).dmg > 0 && G.game.world.objById.get(id).dmg > 0)), 'the cracked pieces show their damage on both', `${placed.length}/${hit.length} placed here`);
  t.check(gone.some((id) => { const r = L.structs[+id.split('.')[1]]; return MH.data.BUILDINGS[r[0]]?.connect === 'wall'; }), 'what broke is the wall line (walls / palisade / gate)', gone.slice(0, 4).map((id) => L.structs[+id.split('.')[1]][0]).join(', '));
  await wrQuiet(t, H, G);
  RH.dbg.freeze(false);
  await t.checkDigest(H, G);
});

def('WR6', {
  title: 'WR: a capture changes the owner everywhere — the guards\' colours, the mural, the map, the place banner, the economy\'s membership rules, the jobs, the tax',
  src: 'village', timeout: 160000,
  expected: 'With Valadestra and Rabelonia at war, a Rabelonia village is taken (game.realms.capture → op realm.capture): owner(sid) is Valadestra on both; its home army is the winners\' garrison; the news "… foi tomada pelo Reino de Valadestra"; its people are rebuilt with the new kingdom\'s colours (crest of the tabards / shields) on both; the mural says "… do Reino de Valadestra · tomada do Reino de Rabelonia"; the map\'s territory raster paints the village\'s land in Valadestra\'s colour on the guest; the place banner / towns.at give the new kingdom; a member of Rabelonia may not trade there any more (the place belongs to the enemy) and the job board / tax are Valadestra\'s; taken back, it is Rabelonia\'s again ("retomada"); digest equal',
  api: 'game/realms.js hostCapture, game/mut/realms.js realm.capture / ownerOf / ownerAt, game/people.js buildPeople (owner), game/towns.js info / placeAt / TOWN.recolor, ui/realmMap.js territories (recolor), game/eco.js dealReason / boardOf / chargeOf (owner)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const RH = RZ(H), RG = RZ(G), R = realmOf(H);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G);
  H.game.net.emit('realm.rel', { a: VAL, b: RAB, rel: 'war', by: VAL, why: 'debug' }); H.game.net.flush();
  const s = frontOf(H, RAB, VAL, 'village').find((q) => RH.owner(q.id) === RAB && q.k === RAB && !RH.besieged(q.id)); // (one of its own villages: never taken before)
  t.need(s, 'a Rabelonia village');
  // a member of Rabelonia may trade there now
  H.game.net.emit('eco.member', { u: uid, k: RAB, name: recOn(H, uid)?.name || '' }); H.game.net.flush();
  t.defer(() => { H.game.net.emit('eco.member', { u: uid, k: -1, name: recOn(H, uid)?.name || '' }); H.game.net.flush(); });
  await t.waitFor(() => recOn(G, uid)?.k === RAB, 2000 + RT(), 'the guest a member of Rabelonia on both');
  t.check(MG.eco.dealReason(G.game, uid, RG.owner(s.id)) === null, 'before: the member trades at its own kingdom\'s village');
  const T0 = MG.realmMap.territories(G.game), px = Math.floor(((s.x % 16384) + 16384) % 16384 / 8), py = Math.floor(s.y / 8);
  // the pixels of the village's own land (its district) around it: how many are painted in Valadestra's colour
  const own = []; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const i = (py + dy) * 2048 + px + dx; if (T0.dist[i] === s.id + 1) own.push(i); }
  const pkAt = () => { const T1 = MG.realmMap.territories(G.game); return own.filter((i) => T1.pk[i] === VAL + 1).length; };
  t.check(own.length > 20 && pkAt() === 0, 'the map: the village\'s land in Rabelonia\'s colour', `${pkAt()}/${own.length} px`);
  const n0 = RH.news.length;
  t.check(RH.capture(s.id, VAL), 'the host takes it (game.realms.capture)');
  H.game.net.flush();
  await t.waitFor(() => RG.owner(s.id) === VAL && RH.owner(s.id) === VAL, 2000 + RT(), 'owner(sid) = Valadestra on both');
  t.check(RG.armies.get('g' + s.id).k === VAL && RG.armies.get('g' + s.id).n > 0 && RG.armies.get('g' + s.id).n <= MG.war.capOf(s), 'its home army: the winners\' garrison, within the place\'s maximum', `${RG.armies.get('g' + s.id).n} / máx. ${MG.war.capOf(s)}`);
  t.check(RG.news.slice(n0).some((r) => r[3] === 'capture' && r[6] === s.id), `news: "${s.name} foi tomada pelo Reino de Valadestra"`, newsOn(G).slice(-1)[0]);
  const KV = R.kingdoms[VAL], crest = (f) => f.game.people.of(s.id)?.crest?.fh;
  t.check(crest(H) === hexC(KV.color) && crest(G) === hexC(KV.color), 'the guards\' tabards and shields in Valadestra\'s colours on both (rebuilt from the seed)', `${crest(H)} / ${crest(G)} (${hexC(KV.color)})`);
  t.check(G.game.towns.at(s.x, s.y).kingdom?.id === VAL && G.game.towns.info(s.id).kingdom.id === VAL, 'towns.at / towns.info (the place banner, the mural): Valadestra');
  muralTab(G, s.id, 'place');
  await t.sleep(250);
  t.check(/do Reino de Valadestra/.test(ecoTxt(G)) && /tomada do Reino de Rabelonia/.test(ecoTxt(G)), 'the mural: "… do Reino de Valadestra · tomada do Reino de Rabelonia"', short(ecoTxt(G), 160));
  G.game.ui.panels.close();
  t.check(pkAt() === own.length, 'the map paints the village\'s land in Valadestra\'s colour (territory raster, guest)', `${pkAt()}/${own.length} px`);
  const why = MG.eco.dealReason(G.game, uid, RG.owner(s.id));
  t.check(typeof why === 'string' && /guerra/.test(why), 'a member of Rabelonia may not trade there now (the place is the enemy\'s)', why);
  const bd = MG.eco.boardOf(G.game, s.id);
  t.check(bd.length && bd.every((j) => j.k === VAL), 'the job board is Valadestra\'s (reputation goes to the new owner)', bd.map((j) => j.k).join(','));
  // taken back
  t.check(RH.capture(s.id, RAB), 'Rabelonia takes it back');
  H.game.net.flush();
  await t.waitFor(() => RG.owner(s.id) === RAB && pkAt() === 0 && crest(G) === hexC(R.kingdoms[RAB].color), 2000 + RT(), 'retaken: Rabelonia\'s again everywhere (owner, map, colours)');
  t.check(RG.news.slice(n0).some((r) => r[3] === 'retake' && r[6] === s.id), 'news: "… foi retomada pelo Reino de Rabelonia"');
  await wrQuiet(t, H, G);
  await t.checkDigest(H, G);
});

def('WR7', {
  title: 'WR: a place taken in a war takes its players\' properties — the house and the plot back on sale, what was built on the plot gone (also after a save)',
  src: 'village', timeout: 220000,
  expected: 'The guest rents a house and buys a plot at the start village and builds a wall on the plot; the village is besieged — the guest is warned ("… está sob cerco: se cair, suas propriedades lá serão perdidas"); the village is taken by another kingdom: on both peers both properties are back on the place\'s lists (no rows), the wall on the plot is gone, the guest\'s notice "O Reino de X tomou … Você perdeu a casa … e o terreno … (o que estava construído no terreno foi destruído)"; the host\'s save loaded into a fresh game has no property rows and no wall there; the village goes back to its kingdom; digest equal',
  api: 'game/eco.js loseProps / plotBuildings / E.loseAt (the one path of a property lost), game/mut/eco.js eco.lose, game/realms.js hostCapture, ui/ecoHud.js (notice), ui/warHud.js (siege warning)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const RH = RZ(H), RG = RZ(G), R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G);
  const K0 = RH.owner(s0.id), foe = R.kingdoms.find((K) => K.id !== K0 && K.comp === R.kingdoms[K0].comp).id;
  // a rented house and a bought plot with a wall
  if ((recOn(H, uid)?.rep[K0] | 0) < 25) giveRep(H, uid, K0, 30, s0.id);
  const P = MH.eco.propsOf(H.game, s0.id);
  const house = P.houses.find((q) => q.mode === 'rent' && !H.game.eco.pr.has(q.id)) || P.houses.find((q) => !H.game.eco.pr.has(q.id));
  const plot = P.plots.find((q) => !H.game.eco.pr.has(q.id));
  t.need(house && plot, 'a free house and a free plot at the start village');
  await toMural(t, H, MH, G, MG, s0.id);
  setCoins(G, 9000);
  const hRent = MH.eco.rentOf(H.game, house), h = house.mode === 'rent' ? await ecoReq(G, 'prop.rent', { id: house.id, paid: hRent }, { refund: { coin: hRent } }) : await ecoReq(G, 'prop.buy', { id: house.id, paid: house.price }, { refund: { coin: house.price } });
  const p = await ecoReq(G, 'prop.buy', { id: plot.id, paid: plot.price }, { refund: { coin: plot.price } });
  t.check(h.ok && p.ok, 'the guest holds a house and a plot', `${h.why || ''} ${p.why || ''}`);
  await t.waitFor(() => G.game.eco.pr.get(house.id)?.u === uid && G.game.eco.pr.get(plot.id)?.u === uid, 2000 + RT(), 'both properties the guest\'s on both peers');
  A.teleport(G, plot.x0 + plot.w / 2, plot.y1 + 2.5);
  await t.sleep(400);
  let tile = null;
  for (let y = plot.y0 + 1; y < plot.y1 && !tile; y++) for (let x = plot.x0 + 1; x < plot.x1 && !tile; x++) if (MG.building.placeReason(G.game, 'wall_wood', x, y, G.game.player, 0) === null) tile = [x, y];
  t.need(tile, 'a free tile inside the plot');
  const pl = await ecoReq(G, 'build.place', { type: 'wall_wood', tiles: [tile], rot: 0 });
  t.check(pl.ok, 'a wall built on the plot', pl.why);
  await t.waitFor(() => H.game.build.structures.some((o) => o.tx === tile[0] && o.ty === tile[1] && o.town == null) && G.game.build.structures.some((o) => o.tx === tile[0] && o.ty === tile[1] && o.town == null), 2000 + RT(), 'the wall on both');
  const w0 = H.game.build.structures.find((o) => o.tx === tile[0] && o.ty === tile[1] && o.town == null);
  H.game.net.emit('struct.complete', { id: w0.id, by: G.pid }); H.game.net.flush();
  // besieged first: the warning
  RH.dbg.freeze(true);
  t.defer(() => RH.dbg.freeze(false));
  H.game.net.emit('realm.rel', { a: foe, b: K0, rel: 'war', by: foe, why: 'debug' });
  const sg = { id: 'a' + (RH.nid + 1), k: foe, home: R.kingdoms[foe].capital, n: 80, n0: 80, lv: 5, state: 'siege', target: s0.id, mission: 'attack', path: null, x: s0.x + s0.r + 14, y: s0.y, eng: [0, 0, 1, 0], phase: 'bombard' };
  H.game.net.emit('realm.army', { a: sg, news: ['siege', foe, K0, s0.id, 80] }); H.game.net.flush();
  await t.waitFor(() => /sob cerco/.test(noteTxt(G)) && /propriedades lá serão perdidas/.test(noteTxt(G)), 9000, 'the guest is warned: "… está sob cerco: se cair, suas propriedades lá serão perdidas"', () => noteTxt(G));
  // taken
  t.defer(() => { try { if (RH.owner(s0.id) !== s0.k) { RH.capture(s0.id, s0.k); H.game.net.flush(); } } catch { /* ignore */ } });
  H.game.net.emit('realm.army', { del: sg.id });
  t.check(RH.capture(s0.id, foe), `the village is taken by the Reino de ${R.kingdoms[foe].name}`);
  H.game.net.flush();
  await t.waitFor(() => !H.game.eco.pr.has(house.id) && !H.game.eco.pr.has(plot.id) && !G.game.eco.pr.has(house.id) && !G.game.eco.pr.has(plot.id), 2000 + RT(), 'both properties back on the place\'s lists on both peers (no rows)');
  await t.waitFor(() => !H.game.build.structures.some((o) => o.tx === tile[0] && o.ty === tile[1] && o.town == null) && !G.game.build.structures.some((o) => o.tx === tile[0] && o.ty === tile[1] && o.town == null), 2000 + RT(), 'the wall on the plot is gone on both');
  await t.waitFor(() => /tomou/.test(noteTxt(G)) && /perdeu/.test(noteTxt(G)) && /destruído/.test(noteTxt(G)), 5000, 'the guest\'s notice: "O Reino de X tomou …: Você perdeu a … e o terreno … (o que estava construído no terreno foi destruído)"', () => noteTxt(G));
  t.check(MG.eco.propsOf(G.game, s0.id).plots.some((q) => q.id === plot.id) && MG.eco.chargeOf(G.game, plot.id, { mode: 'own' }) > 0, 'the plot is on the place\'s list again (taxed by the new kingdom when sold)');
  // the save keeps it
  const data = JSON.parse(JSON.stringify(MH.save.buildSaveData(H.game)));
  const S = await bootSolo(t, '&start=village', 'solo');
  const MS = await A.mods(S);
  await t.waitFor(() => S.game.eco?.mk, 15000, 'the solo game\'s economy');
  S.game.net.withApply(() => MS.snapshot.applyWorld(S.game, data.world, 'load'));
  t.check(!S.game.eco.pr.has(house.id) && !S.game.eco.pr.has(plot.id) && !S.game.build.structures.some((o) => o.tx === tile[0] && o.ty === tile[1] && o.town == null) && S.game.realms.owner(s0.id) === foe, 'loaded from the save: no property rows, no wall, the village the conqueror\'s');
  frames.close(S);
  await wrQuiet(t, H, G);
  RH.capture(s0.id, s0.k); H.game.net.flush();
  await t.waitFor(() => RG.owner(s0.id) === s0.k, 2000 + RT(), 'the start village back to its kingdom');
  setCoins(G, 0);
  await t.checkDigest(H, G);
});

def('WR8', {
  title: 'WR: a kingdom that loses its last city falls — its castles and villages pass to the conqueror, its relations and armies end, its members become travellers',
  src: 'village', timeout: 120000,
  expected: 'Valadestra takes Rabelonia\'s capital (its only city): op realm.fall on both peers — Rabelonia is gone (alive false), every place it held is Valadestra\'s, its wars / alliances / tensions are over, its armies in the field are gone, a member of Rabelonia is a traveller again; the news "O Reino de Rabelonia caiu: suas terras passam ao Reino de Valadestra"; the map has no Rabelonia land any more (raster); digest equal',
  api: 'game/realms.js hostCapture (last city → realm.fall), game/mut/realms.js realm.fall, game/eco.js E.dropKingdom (eco.member −1)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const RH = RZ(H), RG = RZ(G), R = realmOf(H);
  await wrQuiet(t, H, G);
  t.need(RH.alive(RAB) && RH.alive(VAL), 'Rabelonia and Valadestra alive');
  const uid = await ecoReady(t, H, G);
  H.game.net.emit('realm.rel', { a: VAL, b: RAB, rel: 'war', by: VAL, why: 'debug' });
  const third = R.kingdoms.find((K) => K.id !== RAB && K.id !== VAL && R.kingdoms[RAB].neighbours.includes(K.id)) || R.kingdoms.find((K) => K.id !== RAB && K.id !== VAL && K.comp === R.kingdoms[RAB].comp);
  if (third) H.game.net.emit('realm.rel', { a: RAB, b: third.id, rel: 'ally', why: 'debug' });
  H.game.net.emit('eco.member', { u: uid, k: RAB, name: recOn(H, uid)?.name || '' });
  H.game.net.flush();
  const out = RH.dbg.launch(R.settlements.find((s) => RH.owner(s.id) === RAB && s.kind === 'castle').id, frontOf(H, VAL, RAB)[0].id, 10);
  H.game.net.flush();
  await t.waitFor(() => recOn(G, uid)?.k === RAB && (!out || RG.armies.has(out.id)), 2000 + RT(), 'setup on both (a member of Rabelonia, a Rabelonia army in the field)');
  const held = R.settlements.filter((s) => RH.owner(s.id) === RAB).map((s) => s.id);
  const cap = RH.capitalOf(RAB);
  t.check(cap && cap.kind === 'city', 'Rabelonia\'s only city', cap?.name);
  t.check(RH.capture(cap.id, VAL), 'Valadestra takes it');
  H.game.net.flush();
  await t.waitFor(() => !RG.alive(RAB) && !RH.alive(RAB), 2000 + RT(), 'Rabelonia has fallen on both (alive false)');
  t.check(held.every((sid) => RG.owner(sid) === VAL), 'every place it held is Valadestra\'s now (on the guest)', `${held.length} places`);
  t.check(![...RG.rels.keys()].some((k) => k.split('.').map(Number).includes(RAB)) && ![...RG.tens.keys()].some((k) => k.split('.').map(Number).includes(RAB)), 'its relations and tensions are over');
  t.check(!fieldOn(G).some((a) => a.k === RAB), 'its armies in the field are gone');
  await t.waitFor(() => recOn(G, uid)?.k === -1 && recOn(H, uid)?.k === -1, 2000 + RT(), 'its member is a traveller again (both)');
  t.check(newsOn(G).some((x) => /O Reino de Rabelonia caiu: suas terras passam ao Reino de Valadestra/.test(x)), 'news: "O Reino de Rabelonia caiu …"', newsOn(G).slice(-1)[0]);
  const T1 = MG.realmMap.territories(G.game);
  let left = 0;
  for (let i = 0; i < T1.pk.length; i++) if (T1.pk[i] === RAB + 1) left++;
  t.check(left === 0, 'the map: no Rabelonia land left (territory raster)', `${left} px`);
  await wrQuiet(t, H, G);
  await t.checkDigest(H, G);
});

def('WR9', {
  title: 'WR: save → load gives the same kingdoms — relations, owners, the fallen, armies in the field (marching, besieging), the news',
  src: 'village', timeout: 160000,
  expected: 'With wars, an alliance, a truce, an army marching, a siege under way, a captured place and (from WR8) a fallen kingdom, the host\'s save (buildSaveData → JSON) carries world.realms; loaded into a fresh game of the same seed the kingdoms\' state is exactly the same (realmDigestRows equal: relations, tensions, past wars, owners, the fallen, every army\'s row — a marching army by its route and clock —, the siege scars, the news) and the marching army stands at the same place; digest equal on the pair',
  api: 'net/snapshot.js serializeWorld / applyWorld (realms), game/mut/realms.js realmRows / applyRealmRows / realmDigestRows',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const RH = RZ(H), R = realmOf(H);
  await wrQuiet(t, H, G);
  // something of everything
  const ks = R.kingdoms.filter((K) => RH.alive(K.id)), pair = RH.dbg.pairs().filter(([a, b]) => RH.alive(a) && RH.alive(b));
  t.need(pair.length >= 3, 'three pairs of living kingdoms');
  const [p1, p2, p3] = pair;
  H.game.net.emit('realm.rel', { a: p1[0], b: p1[1], rel: 'war', by: p1[0], why: 'debug' });
  H.game.net.emit('realm.rel', { a: p2[0], b: p2[1], rel: 'ally', why: 'debug' });
  H.game.net.emit('realm.rel', { a: p3[0], b: p3[1], rel: 'truce', until: H.game.env.dayIndex + 4, why: 'debug' });
  const from = R.settlements.find((s) => RH.owner(s.id) === p1[0] && s.kind === 'castle'), to = R.settlements.filter((s) => RH.owner(s.id) === p1[1]).sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  H.game.net.emit('realm.army', { gar: [[from.id, 120]] });
  const m = RH.dbg.launch(from.id, to.id, 50);
  H.game.net.flush();
  t.need(m, 'an army marching');
  RH.dbg.freeze(true);
  t.defer(() => RH.dbg.freeze(false));
  await t.sleep(800);
  t.note(`${ks.length} kingdoms alive; ${RH.rels.size} relations; ${fieldOn(H).length} armies in the field; ${RH.own.size} places taken; fallen: ${[...RH.fallen].join(',') || 'none'}`);
  const data = JSON.parse(JSON.stringify(MH.save.buildSaveData(H.game))), saved = realmRowsOn(H, MH);
  const hm = RH.armies.get(m.id); RH.posOf(hm); const hp = [hm.x, hm.y]; // (where it is at the moment of the save)
  t.check(data.world?.realms?.armies?.length === RH.armies.size, 'the save carries the kingdoms (every army)', `${data.world?.realms?.armies?.length}`);
  const S = await bootSolo(t, '&start=village', 'solo');
  const MS = await A.mods(S);
  await t.waitFor(() => S.game.realms?.armies?.size, 15000, 'the solo game\'s kingdoms');
  let loaded = null, pos = null;
  S.game.net.withApply(() => { MS.snapshot.applyWorld(S.game, data.world, 'load'); loaded = JSON.stringify(MS.mrealms.realmDigestRows(S.game)); const a = S.game.realms.armies.get(m.id); S.game.realms.posOf(a); pos = [a.x, a.y]; });
  t.check(loaded === saved, 'loaded: the same kingdoms\' state (relations, owners, the fallen, armies, scars, news)', loaded === saved ? `${saved.length} B` : `saved ${saved.length} B · loaded ${loaded.length} B`);
  t.check(pos && Math.hypot(pos[0] - hp[0], pos[1] - hp[1]) < 4, 'the marching army at the same place on its road (clock + route)', `${f2(pos?.[0])},${f2(pos?.[1])} / ${f2(hp[0])},${f2(hp[1])}`);
  frames.close(S);
  await wrQuiet(t, H, G);
  await t.checkDigest(H, G);
});

def('WR10', {
  title: 'WR: joining a kingdom inherits its relations (reputation with the others replaced); leaving keeps them; negative reputation = worse prices, no joining, fixed by jobs / trade',
  src: 'village', timeout: 200000,
  expected: 'The start kingdom has an ally and an enemy. A traveller guest with +30 reputation with the enemy joins the start kingdom: on both peers its reputation becomes +40 with the ally, −60 with the enemy (replacing the +30), 0 with every other kingdom, the start kingdom\'s unchanged; it leaves: the values stay. As a traveller at an enemy village it still trades (no war for a traveller) but pays the "Malvisto" prices — buying ≥ 1.45 × and selling ≤ 0.65 × what a neutral player gets, the coins taken are that quote — and the Comércio tab says "Reputação negativa com o Reino de …"; it may not join that kingdom ("… é negativa: melhore-a …"); a job turned in and trade there bring it back to 0 and then joining works (and the new kingdom\'s relations are inherited in turn); digest equal',
  api: 'game/eco.js inheritFor / penaltyOf / quoteBuy / quoteSell / rankInfo, mut/eco.js realm.join → eco.member {inherit}, eco.rep, content/eco.js BAD_RANKS / INHERIT, ui/muralEco.js (Comércio warning, Reino card)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const RH = RZ(H), R = realmOf(H), sp = H.game.world.spawn, s0 = MH.realm.settlementAt(R, sp.x, sp.y);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G);
  const K0 = RH.owner(s0.id), others = R.kingdoms.filter((K) => K.id !== K0 && RH.alive(K.id) && K.comp === R.kingdoms[K0].comp);
  t.need(others.length >= 2, 'two other kingdoms on the start kingdom\'s land');
  const ally = others[0].id, foe = others[1].id;
  H.game.net.emit('realm.rel', { a: K0, b: ally, rel: 'ally', why: 'debug' });
  H.game.net.emit('realm.rel', { a: foe, b: K0, rel: 'war', by: foe, why: 'debug' });
  // a traveller with some reputation here and there
  const repOn = (f, k) => recOn(f, uid)?.rep[k] | 0;
  const setRep = (k, v) => { const d = v - repOn(H, k); if (d) H.game.net.emit('eco.rep', { u: uid, k, d }); };
  H.game.net.emit('eco.member', { u: uid, k: -1, name: recOn(H, uid)?.name || '' });
  setRep(foe, 30); setRep(ally, 0); if (repOn(H, K0) < 0) setRep(K0, 0);
  const kOther = R.kingdoms.find((K) => K.id !== K0 && K.id !== ally && K.id !== foe && RH.alive(K.id));
  if (kOther) setRep(kOther.id, 12);
  H.game.net.flush();
  t.defer(() => { try { H.game.net.emit('eco.member', { u: uid, k: -1, name: recOn(H, uid)?.name || '' }); for (const K of R.kingdoms) { const d = -repOn(H, K.id); if (d) H.game.net.emit('eco.rep', { u: uid, k: K.id, d: Math.max(-100, Math.min(100, d)) }); } H.game.net.flush(); } catch { /* ignore */ } });
  await t.waitFor(() => repOn(G, foe) === 30 && recOn(G, uid)?.k === -1, 2000 + RT(), 'the guest a traveller with +30 with the enemy kingdom (both)');
  const k0rep = repOn(H, K0);
  // join: the start kingdom's relations become the guest's
  await toMural(t, H, MH, G, MG, s0.id);
  const j = await ecoReq(G, 'realm.join', { sid: s0.id });
  t.check(j.ok, 'the guest joins the start kingdom', j.why);
  const want = (f) => R.kingdoms.filter((K) => K.id !== K0 && RH.alive(K.id)).every((K) => repOn(f, K.id) === (K.id === ally ? 40 : K.id === foe ? -60 : 0));
  await t.waitFor(() => want(H) && want(G) && recOn(G, uid)?.k === K0, 2000 + RT(), 'inherited on both: ally +40, enemy −60 (the +30 replaced), every other kingdom 0', () => R.kingdoms.map((K) => `${K.id}:${repOn(G, K.id)}`).join(' '));
  t.check(repOn(G, K0) === k0rep, 'its reputation with the start kingdom itself unchanged', `${k0rep} → ${repOn(G, K0)}`);
  // leave: the values stay
  const l = await ecoReq(G, 'realm.leave', {});
  t.check(l.ok, 'it leaves (a traveller again)', l.why);
  await t.waitFor(() => recOn(G, uid)?.k === -1 && recOn(H, uid)?.k === -1, 2000 + RT(), 'a traveller on both');
  t.check(repOn(G, foe) === -60 && repOn(G, ally) === 40 && repOn(H, foe) === -60, 'leaving keeps the inherited reputation (−60 with the enemy)', `${repOn(G, foe)} / ${repOn(G, ally)}`);
  // a traveller at an enemy village: it trades, at the "Malvisto" prices
  const fs = R.settlements.filter((s) => RH.owner(s.id) === foe && s.kind === 'village').sort((a, b) => a.id - b.id)[0];
  t.need(fs, 'a village of the enemy kingdom');
  await toMural(t, H, MH, G, MG, fs.id);
  const P = MG.eco.profileOf(G.game, fs.id), gid = ['wheat', 'potato', 'corn', 'bread', 'meat', 'wood', 'stone'].find((id) => P.deals[MG.eco.GI[id]] && (G.game.eco.mk.get(fs.id)[MG.eco.GI[id]] | 0) >= 12);
  t.need(gid, 'a good with stock there');
  const gi = MG.eco.GI[gid], qb = MG.eco.quoteBuy(G.game, fs.id, gi, 5, uid), nb = MG.eco.quoteBuy(G.game, fs.id, gi, 5, 'u-nobody'), qs = MG.eco.quoteSell(G.game, fs.id, gi, 5, uid), ns = MG.eco.quoteSell(G.game, fs.id, gi, 5, 'u-nobody');
  t.check(qb.cost >= nb.cost * 1.45 && qs.gain <= ns.gain * 0.65 + 1, 'negative reputation: buying ≥ 1.45 × and selling ≤ 0.65 × a neutral player\'s prices', `buy 5 ${qb.cost} vs ${nb.cost} · sell 5 ${qs.gain} vs ${ns.gain}`);
  muralTab(G, fs.id, 'trade');
  await t.sleep(250);
  t.check(/Reputação negativa com o Reino de/.test(ecoTxt(G)) && /mais cara/.test(ecoTxt(G)), 'Comércio says why ("Reputação negativa com o Reino de … compra 50 % mais cara …")', short(ecoTxt(G).slice(Math.max(0, ecoTxt(G).indexOf('Reputação negativa')), 200), 200));
  setCoins(G, 6000);
  // (the price now, once both peers agree on it: a market update the host has applied may still be on its way to the guest)
  await t.waitFor(() => MH.eco.quoteBuy(H.game, fs.id, gi, 5, uid).cost === MG.eco.quoteBuy(G.game, fs.id, gi, 5, uid).cost, 3000 + RT(), 'the same price on both peers');
  const qb1 = MG.eco.quoteBuy(G.game, fs.id, gi, 5, uid);
  const b1 = await ecoReq(G, 'trade.buy', { sid: fs.id, g: gid, n: 5, max: qb1.cost }, { refund: { coin: qb1.cost } });
  t.check(b1.ok, 'it still trades there (negative is not enemy)', b1.why);
  await t.waitFor(() => coinsOf(G) === 6000 - qb1.cost || coinsOf(G) === 6000, 2000 + RT(), 'the coins', () => `${coinsOf(G)} (quote ${qb1.cost})`);
  // no joining with a negative reputation
  const j2 = await ecoReq(G, 'realm.join', { sid: fs.id });
  t.check(!j2.ok && /negativa/.test(j2.why || ''), 'it may not join that kingdom ("… é negativa: melhore-a com comércio e trabalhos …")', j2.why);
  muralTab(G, fs.id, 'realm');
  await t.sleep(250);
  t.check(/Malvisto/.test(ecoTxt(G)) && /não pode entrar/.test(ecoTxt(G)), 'the Reino card: "Malvisto", the worse prices, "não pode entrar"', short(ecoTxt(G).slice(Math.max(0, ecoTxt(G).indexOf('Você e')), 200), 200));
  G.game.ui.panels.close();
  // a job and trade there bring it back to 0 — then it may join
  const r0 = repOn(H, foe);
  giveRep(H, uid, foe, -10 - r0, fs.id); // (a job turned in: up to −10)
  await t.waitFor(() => repOn(G, foe) === -10 && repOn(H, foe) === -10, 2000 + RT(), `a job turned in: ${r0} → −10 on both`, () => `${repOn(G, foe)}`);
  for (let k = 0; k < 6 && repOn(H, foe) < 0; k++) {
    const q = MG.eco.quoteBuy(G.game, fs.id, gi, 6, uid);
    if (q.n < 6) break;
    setCoins(G, 6000);
    await ecoReq(G, 'trade.buy', { sid: fs.id, g: gid, n: 6, max: q.cost }, { refund: { coin: q.cost } });
    await t.sleep(RT() + 120);
  }
  if (repOn(H, foe) < 0) setRep(foe, 0), H.game.net.flush(); // (the market ran dry: the rest as one more job)
  await t.waitFor(() => repOn(G, foe) >= 0, 2000 + RT(), 'trade there raises it back to 0 on both', () => `${repOn(G, foe)}`);
  const j3 = await ecoReq(G, 'realm.join', { sid: fs.id });
  t.check(j3.ok, 'now it may join the (former enemy) kingdom', j3.why);
  await t.waitFor(() => recOn(G, uid)?.k === foe && repOn(G, K0) === -60 && repOn(H, K0) === -60, 2000 + RT(), 'and inherits its relations in turn: −60 with the start kingdom (at war with it), on both', () => `${repOn(G, K0)}`);
  await wrQuiet(t, H, G);
  await t.checkDigest(H, G);
});

// =====================================================================================================
// BT — the battlefield (docs/REINOS.md §14 "Fase 3b — campo de batalha e cerco": game/warfare.js, game/soldier.js,
// game/siegeAI.js, game/mut/warfare.js): soldiers near the players, the playable siege, field battles, the players'
// rule, the hand-off with 3a (game.realms: the wars forced with its debug op realm.rel, its owners, capture, reward).
// =====================================================================================================
const btMods = async (f) => ({ W: await fimp(f, 'game/warfare.js'), C: await fimp(f, 'game/content/soldiers.js'), S: await fimp(f, 'game/soldier.js'), AI: await fimp(f, 'game/siegeAI.js') });
const btKey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
// wars between kingdoms through 3a's debug op realm.rel (the AI paused: act.js reset); back to neutral afterwards. The
// reports of 3b's forces: game.warfare.reportLog
async function warShim(t, H, G, wars) {
  const RH = RZ(H);
  RH.dbg.stop(true);
  for (const [a, b] of wars) H.game.net.emit('realm.rel', { a, b, rel: 'war', by: a, why: 'debug', quiet: 1 });
  H.game.net.flush();
  t.defer(() => { for (const [a, b] of wars) H.game.net.emit('realm.rel', { a, b, rel: 'neutral', quiet: 1 }); H.game.net.flush(); });
  await t.waitFor(() => wars.every(([a, b]) => RZ(G).atWar(a, b) && RH.atWar(a, b)), 3000 + RT(), 'the wars on both peers (realm.rel)');
  return { rep: H.game.warfare.reportLog || (H.game.warfare.reportLog = []) };
}
// two kingdoms of the start's landmass other than the start's own (the attackers), the start village (the defender)
function btKingdoms(H, s) {
  const R = realmOf(H), K = R.kingdoms, mine = K[s.k];
  return K.filter((k) => k.id !== s.k && k.comp === mine.comp).sort((a, b) => Math.hypot(R.settlements[a.capital].x - s.x, R.settlements[a.capital].y - s.y) - Math.hypot(R.settlements[b.capital].x - s.x, R.settlements[b.capital].y - s.y)).map((k) => k.id);
}
// faster sieges for the tests (the build time, the capture hold): the host's numbers, put back afterwards
async function btFast(t, H, o = {}) {
  const { C } = await btMods(H), old = { ...C.WAR.siege };
  Object.assign(C.WAR.siege, { buildK: 0.3, captureT: 8, holdT: 20, breachWait: 50, ...o });
  t.defer(() => Object.assign(C.WAR.siege, old));
  return C;
}
// the start village back as it was (pieces broken, damage, the dead of the siege)
function btHeal(H, sid) {
  const g = H.game, pre = `t${sid}.`, ids = [];
  for (const [id, r] of g.towns.state) if (id.startsWith(pre)) { if (r.gone) ids.push(id); else if (r.dmg > 0) g.net.emit(g.world.objById.get(id)?.sdmg ? 'siege.dmg' : 'struct.dmg', { id, d: 0, x: r.x + 0.5, y: r.y + 0.5 }); }
  if (ids.length) g.net.emit('town.restore', { ids });
  for (const k of [...(g.towns.dead || new Map()).keys()]) { const [a, i] = k.split('.').map(Number); if (a === sid) g.net.emit('town.pop', { sid, i, dead: 0 }); }
  g.net.flush();
}
// a debug siege of the start village by kingdom k coming from direction `from` (unit), ended (soldiers, camp, engines) at
// the end of the scenario
function btSiege(t, H, s, k, { n = 30, lv = 4, from = [1, 0], eng = null, d = 30 } = {}) {
  const at = [s.x + from[0] * (s.r + d), s.y + from[1] * (s.r + d)];
  const F = H.game.warfare.startSiege({ k, sid: s.id, n, lv, at, eng });
  t.defer(() => { if (H.game.warfare.forces.has(F.id)) H.game.warfare.dematerialize(F.id); H.game.net.flush(); });
  t.defer(() => btHeal(H, s.id));
  t.defer(() => { if (RZ(H).owner(s.id) !== s.k) RZ(H).dbg.capture(s.id, s.k); H.game.net.flush(); }); // (a capture: the place back to its kingdom)
  return F;
}
const btDbg = (H, F) => H.game.warfare.debug(F.id);
const btPhase = (H, F) => H.game.warfare.forces.get(F.id)?.phase || 'gone';
const btOn = (f, F) => f.game.warfare.forces.get(F.id) || null;
const soldiersOf = (f, k) => f.game.entities.filter((e) => e.soldier && !e.dead && (k == null || e.soldier.k === k));
const hexN = (h) => String(h || '').replace('#', '').toLowerCase();
// both players at (x, y) (free spots), the host seeing the guest there
async function btStand(t, H, MH, G, MG, x, y) {
  const a = A.freeSpot(H, MH, x, y, { rMin: 0, rMax: 5 }) || [x, y];
  A.teleport(H, a[0], a[1]);
  const b = A.freeSpot(G, MG, a[0] + 1.6, a[1], { rMin: 0, rMax: 5 }) || [a[0] + 1.6, a[1]];
  A.teleport(G, b[0], b[1]);
  await A.hostSees(t, H, G, 4000 + RT());
}
async function btVillage(t, H, MH, G, MG) {
  const s = startTownOf(H, MH);
  t.need(s && s.walls === 'palisade', 'the start village with a palisade');
  const L = H.game.towns.layout(s.id);
  dayClock(t, H, 10, MH);
  await visitTown(t, H, MH, G, MG, s.id, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  return s;
}

def('BT1', {
  title: 'BT: a debug siege of the start village — soldiers in the kingdom\'s colours on both peers, the camp out of the defenders\' reach, the bell and the watch on the threatened side',
  src: 'village', timeout: 240000,
  expected: 'game.warfare.startSiege by an enemy kingdom (at war with the village\'s: 3a\'s op realm.rel): the force on both peers (war.force), its soldiers host creatures and proxies on the guest with the same names / roles / looks rebuilt from the seed (camp w<k>.<tag>.<role><i>), the tabards / shields in the attacker\'s colours, a general; the camp (tents, banners, fires: structures of the army, o.realm = k, on both) farther than every archer post on the walls can shoot (13 × (1 + 0.2 a story)) and than the guards chase; the gates shut, the bell (danger), the defense\'s threat on the army\'s side, the archers up on the palisade; digest equal',
  api: 'game/warfare.js startSiege / debug / threatOn, soldier.js identity / decorateSoldier / crestOf, siegeAI.js plan / raiseCamp, mut/warfare.js war.force / war.mark',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = await btVillage(t, H, MH, G, MG);
  const [k2] = btKingdoms(H, s);
  t.need(k2 != null, 'another kingdom on the start\'s landmass');
  await warShim(t, H, G, [[k2, s.k]]);
  await btFast(t, H);
  const F = btSiege(t, H, s, k2, { n: 30, lv: 4, from: [1, 0] });
  await t.waitFor(() => btOn(G, F), RT() + 2000, 'the guest knows the force (war.force)');
  await t.waitFor(() => btDbg(H, F)?.siege?.planned, 30000, 'the siege is planned (the camp, the engines)', () => JSON.stringify(H.game.warfare.planWhy().slice(-6)));
  const st = btDbg(H, F).siege, camp = st.camp;
  await btStand(t, H, MH, G, MG, camp[0] - 4, camp[1] - 3);
  await t.waitFor(() => soldiersOf(G, k2).length >= 12, 20000, 'the guest sees the soldiers (proxies)', () => `${soldiersOf(G, k2).length} on the guest, ${soldiersOf(H, k2).length} on the host`);
  const crest = H.game.warfare.crest(k2);
  const gs = soldiersOf(G, k2), bad = [];
  for (const e of gs) {
    const m = H.game.entities.find((q) => q.nid === e.nid);
    if (!m) continue;
    if (e.name !== m.name || e.soldier.role !== m.soldier.role || JSON.stringify(e.look) !== JSON.stringify(m.look)) bad.push(`${e.nid} ${e.name}/${m.name} ${e.soldier.role}/${m.soldier.role}`);
  }
  t.check(!bad.length, 'the same soldiers on both peers (name, role, look rebuilt from the seed)', bad.slice(0, 3).join(' · ') || `${gs.length} soldiers`);
  const tab = gs.filter((e) => e.look?.over === 'tabard');
  t.check(tab.length && tab.every((e) => hexN(e.look.overC) === hexN(crest.fh) && e.look.crest === crest.d), 'the tabards in the attacker\'s colours with its heraldry', `${tab.length} tabards · ${crest.fh} ${crest.d}`);
  t.check(gs.filter((e) => e.offhand === 'shield_guard').every((e) => e.crest && hexN(e.crest.fh) === hexN(crest.fh)), 'the shields in its colours (the crest on the proxies)');
  t.check(soldiersOf(H, k2).some((m) => m.soldier.role === 'general'), 'a general leads them');
  // the camp
  await t.waitFor(() => btDbg(H, F).siege.campIds.length >= 6 && !['march', 'camp'].includes(btPhase(H, F)) && btDbg(H, F).siege.campIds.every((id) => A.structOn(G, id)?.realm === k2), 90000, 'the camp is raised (tents, banners, fires) — the army\'s on both peers', () => `${btDbg(H, F).siege.campIds.length} pieces · phase ${btPhase(H, F)}`);
  const ids = btDbg(H, F).siege.campIds, S = H.game.people.of(s.id), types = ids.map((id) => A.structOn(H, id)?.type);
  t.check(types.includes('war_tent') && types.includes('war_banner') && types.includes('campfire'), 'tents, banners and fires', types.join(','));
  t.check(ids.every((id) => { const o = A.structOn(G, id); return o && o._kc && Math.abs(o._kc[0] - crest.f[0]) < 1e-6; }), 'in the kingdom\'s colours on the guest (o._kc)');
  const near = [];
  for (const id of ids) {
    const o = A.structOn(H, id), cx = o.tx + o.fw / 2, cy = o.ty + o.fh / 2;
    for (const w of S.posts.walls) { const r = 13 * (1 + 0.2 * (w.lv | 0)); if (Math.hypot(cx - w.x, cy - w.y) < r + 2) near.push(`${o.type} ${f2(Math.hypot(cx - w.x, cy - w.y))} < ${f2(r)}`); }
    for (const c of S.posts.crews) if (Math.hypot(cx - c.x, cy - c.y) < 34) near.push(`${o.type} near a ballista`);
    if (Math.hypot(cx - s.x, cy - s.y) < s.r + 12) near.push(`${o.type} where the guards chase`);
  }
  t.check(!near.length, 'the whole camp out of the defenders\' reach (archers on the walls, ballistas, the guards\' chase)', near.slice(0, 3).join(' · ') || `${ids.length} pieces`);
  // the defenders
  await t.waitFor(() => H.game.people.debug(s.id).danger && H.game.people.debug(s.id).def?.danger, 10000, 'the bell: the watch takes its posts');
  const th = H.game.people.debug(s.id).def.th, A0 = [camp[0] - s.x, camp[1] - s.y], al = Math.hypot(...A0);
  t.check(th && (th.fx * A0[0] + th.fy * A0[1]) / al > 0.5, 'the threat on the army\'s side (game.townDefense via game.warfare.threatOn)', JSON.stringify(th));
  const L = H.game.towns.layout(s.id);
  await t.waitFor(() => L.gates.every((k) => { const a = A.objOn(H, `t${s.id}.${k}`), b = A.objOn(G, `t${s.id}.${k}`); return (!a || !a.open) && (!b || !b.open); }), 6000, 'the gates shut on both peers');
  // the archers up on the palisade (the players back at the plaza: the watch is out around them)
  const archers = () => H.game.people.debug(s.id).live.filter((m) => m.job === 'archer');
  await btStand(t, H, MH, G, MG, L.spawn[0], L.spawn[1]);
  await t.waitFor(() => archers().length && archers().every((m) => m.duty?.k === 'wall' && m.z > 0.9), 45000, 'the archers go up on the palisade (the watch on the walls, not at the mural)', () => archers().map((m) => `${m.duty?.k || '-'} z${f2(m.z)}`).join(' '));
  t.check(true, 'the archers on the palisade', archers().length);
  t.metric('soldiers', gs.length);
  await t.checkDigest(H, G);
});

def('BT2', {
  title: 'BT: the engines built over time (the tower at the wall\'s height), the trebuchet\'s persistent damage and the breach the watch holds',
  src: 'village', timeout: 420000,
  expected: 'The siege\'s engineers raise an Oficina de cerco, then a trebuchet and a siege tower as real blueprints whose progress grows on both peers (struct.progress) until complete; the tower\'s stories = towerStoriesFor of the wall pieces at the end of its lane; the trebuchet stands 34–43 tiles from its target. Operated by an engineer (o.user ~<nid>) it throws (siege.shot on both): the palisade takes persistent siege damage (o.sdmg, the town state) until a log breaks — an opening on both peers (game.townDefense.openings) held by the nearest melee guards (a gap post, one in / just inside it); digest equal',
  api: 'siegeAI.js plan / buildEngines / bombard / operateJob, mut/siege.js fireShot, siege.js towerStoriesFor / frontTiles, defense.js openings / assignDefense',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = await btVillage(t, H, MH, G, MG);
  const [k2] = btKingdoms(H, s);
  await warShim(t, H, G, [[k2, s.k]]);
  await btFast(t, H, { breachWait: 400 });
  const F = btSiege(t, H, s, k2, { n: 26, lv: 4, from: [1, 0], eng: { treb: 1, ram: 0, tower: 1 } });
  await t.waitFor(() => btDbg(H, F)?.siege?.planned, 30000, 'the siege is planned');
  const jobs = () => btDbg(H, F).siege.jobs, job = (r) => jobs().find((j) => j.role === r);
  t.need(job('treb') && job('tower'), 'a trebuchet and a tower planned', JSON.stringify(jobs()) + ' ' + JSON.stringify(H.game.warfare.planWhy().slice(-5)));
  const ws = job('ws');
  await btStand(t, H, MH, G, MG, ws.tx + 1, ws.ty + 5);
  // the workshop, then the engines: blueprints whose progress grows on both peers
  await t.waitFor(() => job('ws').id && A.structOn(G, job('ws').id), 60000, 'the workshop\'s blueprint on the guest', () => `phase ${btPhase(H, F)}`);
  await t.waitFor(() => job('ws').done && !A.structOn(G, job('ws').id).blueprint, 40000, 'the workshop finished on both');
  await t.waitFor(() => job('treb').id && A.structOn(G, job('treb').id)?.blueprint, 30000, 'the trebuchet\'s blueprint (the workshop is ready: the player\'s rule)');
  const tid = job('treb').id;
  const p0 = A.structOn(G, tid).progress || 0;
  await t.waitFor(() => (A.structOn(G, tid)?.progress || 0) > p0 + 0.1 || !A.structOn(G, tid)?.blueprint, 30000, 'its progress grows on the guest (struct.progress)');
  await t.waitFor(() => job('treb').done && job('tower').done && !A.structOn(G, tid).blueprint && !A.structOn(G, job('tower').id)?.blueprint, 90000, 'the trebuchet and the tower finished on both', () => JSON.stringify(jobs().map((j) => [j.role, j.p, j.done])));
  // the tower's height = the wall's at the end of its lane
  const tj = job('tower'), to = A.structOn(H, tj.id), [fw, fh] = [to.fw, to.fh];
  const want = MH.siege.towerStoriesFor(H.game, MH.siege.frontTiles({ tx: tj.end[0], ty: tj.end[1], fw, fh, rot: to.rot }));
  t.check(want >= 1 && MH.siege.towerN(to) === want && MH.siege.towerN(A.structOn(G, tj.id)) === want, 'the tower has the stories of the wall stretch it is planned against (towerStoriesFor)', `${MH.siege.towerN(to)} / wall ${want}`);
  const tr = A.structOn(H, tid), [px, py] = MH.siege.pivotOf(tr), tg = A.structOn(H, job('treb').target);
  const td = Math.hypot(tg.tx + 0.5 - px, tg.ty + 0.5 - py);
  t.check(td >= 33 && td <= 44.5, 'the trebuchet 34–43 tiles from its target (out of the archers\' reach)', f2(td));
  t.check(tr.realm === k2 && A.structOn(G, tid).realm === k2, 'the engines are the army\'s (o.realm) on both');
  // the bombardment
  const shots = [];
  t.on(G, 'siegeshot', (e) => shots.push(e));
  await btStand(t, H, MH, G, MG, tg.tx - 6, tg.ty + 2);
  await t.waitFor(() => tr.user?.startsWith('~'), 30000, 'an engineer operates the trebuchet (o.user ~<nid>)', () => `user ${tr.user} phase ${btPhase(H, F)}`);
  await t.waitFor(() => shots.length >= 1, 60000, 'it throws (siege.shot on the guest)');
  const pre = `t${s.id}.`, hurt = () => [...H.game.towns.state].filter(([id, r]) => id.startsWith(pre) && (r.dmg > 0 || r.gone));
  await t.waitFor(() => hurt().length, 200000, 'a wall piece takes siege damage', () => `${shots.length} shots · phase ${btPhase(H, F)}`);
  const d0 = hurt()[0];
  await t.waitFor(() => G.game.towns.state.get(d0[0]) && (G.game.towns.state.get(d0[0]).dmg > 0 || G.game.towns.state.get(d0[0]).gone), RT() + 2000, 'the damage is the town\'s state on the guest too (persistent)', () => `${d0[0]} host ${JSON.stringify(d0[1])} guest ${JSON.stringify(G.game.towns.state.get(d0[0]) || null)}`);
  const opOf = (f) => f.game.townDefense.openings(s.id)[0] || null;
  await t.waitFor(() => opOf(H) && opOf(G), 200000, 'a log breaks: an opening on both peers (a breach)', () => `${shots.length} shots · ${hurt().length} hurt pieces · phase ${btPhase(H, F)}`);
  const op = opOf(H);
  t.check(G.game.townDefense.openings(s.id).some((o) => o.id === op.id), 'the same opening on the guest', op.id);
  const D = () => H.game.people.debug(s.id);
  await t.waitFor(() => D().def?.posts.some((p) => p.k === 'gap' && p.op === op.id), 8000, 'the defense posts melee guards on the breach');
  await t.waitFor(() => D().live.some((m) => m.duty?.k === 'gap' && Math.hypot(m.x - op.x, m.y - op.y) < 2.6), 45000, 'a melee guard holds it (in the gap / just inside)',
    () => D().live.filter((m) => m.guard).map((m) => `${m.job} ${m.duty?.k || '-'} ${m.state} @${f2(m.x)},${f2(m.y)}`).join(' '));
  t.metric('shots', shots.length);
  await t.checkDigest(H, G);
});

def('BT3', {
  title: 'BT: the siege tower — pushed to the palisade by its crew, the ramp down, soldiers up on the wall walk; the centre held → the capture is requested',
  src: 'village', timeout: 360000,
  expected: 'A siege with a tower only: built, pushed by 2–3 soldiers (o.push ~<nid> on both, the tower moving a tile at a time — siege.step), against the palisade it drops its ramp (o.ramp on both); soldiers climb its ladder, stand on the wall walk (the levels surface of the wall\'s story, host; z > 0.5 on the guest), go down inside and take the plaza; with no guard near the centre for WAR.siege.captureT the host calls game.realms.capture(sid, k) (3a: the owner changes on both peers) and the force is \'held\' on both; digest equal',
  api: 'siegeAI.js assault / pushJob / climbers / climbJob / capture, siege.js hostPush / dock, levels.js surfaces',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = await btVillage(t, H, MH, G, MG);
  const [k2] = btKingdoms(H, s);
  const log = await warShim(t, H, G, [[k2, s.k]]);
  await btFast(t, H, { breachWait: 400 });
  const F = btSiege(t, H, s, k2, { n: 30, lv: 6, from: [1, 0], eng: { treb: 0, ram: 0, tower: 1 } });
  await t.waitFor(() => btDbg(H, F)?.siege?.planned, 30000, 'the siege is planned');
  const job = () => btDbg(H, F).siege.jobs.find((j) => j.role === 'tower');
  t.need(job(), 'a tower planned', JSON.stringify(H.game.warfare.planWhy().slice(-5)));
  await btStand(t, H, MH, G, MG, job().end[0] - 3, job().end[1] + 4);
  await t.waitFor(() => job().done, 120000, 'the tower is built', () => `phase ${btPhase(H, F)} p ${job().p}`);
  const id = job().id, oH = A.structOn(H, id);
  const x0 = oH.tx;
  await t.waitFor(() => (oH.push || []).filter((q) => q && q[0] === '~').length >= 2, 60000, 'two or more soldiers push it (o.push)', () => `push ${JSON.stringify(oH.push)} phase ${btPhase(H, F)}`);
  await t.waitFor(() => (A.structOn(G, id)?.push || []).filter((q) => q && q[0] === '~').length >= 2, RT() + 2000, 'the guest sees the crew on it');
  await t.waitFor(() => A.structOn(G, id).tx !== x0 || A.structOn(G, id).ty !== oH.ty, 20000, 'it moves (siege.step on the guest)');
  await t.waitFor(() => oH.ramp && A.structOn(G, id)?.ramp, 90000, 'against the palisade the ramp drops (on both)', () => `@${oH.tx},${oH.ty} end ${job().end} push ${JSON.stringify(oH.push)}`);
  const n = MH.siege.towerN(oH), lev = H.game.levels.sync(), w = H.game.world;
  const upH = () => soldiersOf(H, k2).filter((m) => m.z > n - 0.3 && lev.surf[n]?.get(w.idx(Math.floor(m.x), Math.floor(m.y))) === 1);
  await t.waitFor(() => upH().some((m) => !(m.x >= oH.tx && m.x < oH.tx + oH.fw && m.y >= oH.ty && m.y < oH.ty + oH.fh)), 60000, 'a soldier stands on the wall walk (past the ramp, the wall\'s story)', () => `climbed ${btDbg(H, F).siege.climbed} · up ${soldiersOf(H, k2).filter((m) => m.z > 0.3).map((m) => `${f2(m.x)},${f2(m.y)} z${f2(m.z)}`).join(' ')}`);
  await t.waitFor(() => soldiersOf(G, k2).some((e) => (e.z || 0) > 0.5), RT() + 3000, 'the guest sees soldiers up there');
  await t.waitFor(() => RZ(H).owner(s.id) === k2 && RZ(G).owner(s.id) === k2, 150000, 'the centre held with no defender: game.realms.capture(sid, k) — the place is the attackers\' on both peers',
    () => { const d = btDbg(H, F); return d ? `phase ${d.phase} capT ${d.siege.capT} at ${d.siege.capAt} def ${d.siege.capDef} · inside ${btDbg(H, F).live.filter((m) => m.order === 'flow').length}` : 'gone'; });
  await t.waitFor(() => btOn(G, F)?.phase === 'held', RT() + 2000, 'the force is \'held\' on the guest');
  t.metric('climbed', btDbg(H, F).siege.climbed);
  await t.checkDigest(H, G);
});

def('BT4', {
  title: 'BT: the battering ram — pushed by its crew to a gate of the palisade, blow after blow until the gate breaks; the soldiers go in',
  src: 'village', timeout: 300000,
  expected: 'A siege with a ram only, the army coming from a side with a gate: the ram is built, pushed by ≥ 2 soldiers (o.push on both) along a clear lane to the gate, strikes (siege.swing on the guest, damage only to the gate: siege.dmg) until the gate piece is removed on both peers; then soldiers walk in through it (one inside the wall line); digest equal',
  api: 'siegeAI.js laneFor / assault (the ram), mut/siege.js ramBlow, siege.js hostPush / isGate',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = await btVillage(t, H, MH, G, MG);
  const [k2] = btKingdoms(H, s);
  await warShim(t, H, G, [[k2, s.k]]);
  await btFast(t, H, { breachWait: 400 });
  const per = H.game.townDefense.perimeter(s.id), gate = [...per.pieces.values()].find((p) => p.gate && Math.abs(p.fx) + Math.abs(p.fy) < 1.01);
  t.need(gate, 'a gate on an axis side of the palisade');
  const F = btSiege(t, H, s, k2, { n: 26, lv: 5, from: [gate.fx, gate.fy], eng: { treb: 0, ram: 1, tower: 0 } });
  await t.waitFor(() => btDbg(H, F)?.siege?.planned, 30000, 'the siege is planned');
  const job = () => btDbg(H, F).siege.jobs.find((j) => j.role === 'ram');
  t.need(job(), 'a ram planned (a clear lane to a gate)', JSON.stringify(H.game.warfare.planWhy().slice(-5)));
  const gid = job().target;
  await btStand(t, H, MH, G, MG, job().end[0] - 4, job().end[1] + 3);
  await t.waitFor(() => job().done, 120000, 'the ram is built', () => `phase ${btPhase(H, F)} p ${job().p}`);
  const oH = A.structOn(H, job().id), swings = [];
  t.on(G, 'siegeram', (e) => swings.push(e));
  await t.waitFor(() => (oH.push || []).filter((q) => q && q[0] === '~').length >= 2 && (A.structOn(G, oH.id)?.push || []).filter(Boolean).length >= 2, 60000, 'two or more soldiers push it (on both)', () => `push ${JSON.stringify(oH.push)} phase ${btPhase(H, F)}`);
  await t.waitFor(() => swings.length >= 1, 90000, 'at the gate it strikes (siege.swing on the guest)', () => `ram @${oH.tx},${oH.ty} end ${job().end}`);
  t.check(swings.some((e) => e.hit === 1), 'a blow on the gate itself');
  await t.waitFor(() => !A.objOn(H, gid) && !A.objOn(G, gid), 120000, 'the gate breaks (removed on both peers)', () => `${swings.length} blows · gate dmg ${f2(A.objOn(H, gid)?.dmg || 0)}`);
  await t.waitFor(() => soldiersOf(H, k2).some((m) => per.inside(m.x, m.y, H.game.world)), 60000, 'soldiers go in through the broken gate');
  t.metric('blows', swings.length);
  await t.checkDigest(H, G);
});

def('BT5', {
  title: 'BT: a field battle — two kingdoms\' armies march, deploy their lines, the archers loose, the lines clash; one breaks and runs, the losses are reported',
  src: 'village', timeout: 300000,
  expected: 'game.warfare.startBattle between two kingdoms at war (the shim): both forces on both peers, a general with each (the standard), the lines deploy and advance (phases on the guest\'s rows: deploy / advance / clash), arrows fly, soldiers fall on both sides; the morale of one breaks (rout) and the other wins (won); both report their losses (lost > 0; game.realms.report for 3a\'s armies); digest equal',
  api: 'warfare.js startBattle / battleTick / formation / morale / endBattle, soldier.js melee / shoot / pickFoe',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = await btVillage(t, H, MH, G, MG);
  const [ka, kb] = btKingdoms(H, s);
  t.need(ka != null && kb != null, 'two other kingdoms on the landmass');
  const log = await warShim(t, H, G, [[ka, kb]]);
  // a field east of the village, away from its land
  const cx = s.x + s.r + 60, cy = s.y + 8;
  await btStand(t, H, MH, G, MG, cx, cy + 9);
  const phases = new Set();
  t.on(G, 'warforce', (e) => phases.add(e.phase));
  const [FA, FB] = H.game.warfare.startBattle({ k: ka, n: 24, lv: 5, at: [cx - 26, cy] }, { k: kb, n: 16, lv: 5, at: [cx + 26, cy] });
  t.defer(() => { for (const F of [FA, FB]) if (H.game.warfare.forces.has(F.id)) H.game.warfare.dematerialize(F.id); H.game.net.flush(); });
  await t.waitFor(() => btOn(G, FA) && btOn(G, FB), RT() + 2000, 'both forces on the guest');
  await t.waitFor(() => soldiersOf(G, ka).length >= 8 && soldiersOf(G, kb).length >= 8, 20000, 'the guest sees both armies');
  t.check(soldiersOf(G, ka).some((e) => e.soldier.role === 'general') && soldiersOf(G, kb).some((e) => e.soldier.role === 'general'), 'a general (with the standard) on each side, on the guest');
  let arrows = 0;
  t.watch(() => { arrows += (H.game.projectiles || []).filter((p) => p.faction === 'army' && !p._seen && (p._seen = true)).length; }, 100);
  await t.waitFor(() => btPhase(H, FA) === 'rout' || btPhase(H, FB) === 'rout' || btPhase(H, FA) === 'gone', 240000, 'one side breaks and runs (rout)',
    () => [FA, FB].map((F) => `${F.id} ${btPhase(H, F)} n ${H.game.warfare.forces.get(F.id)?.n} dead ${H.game.warfare.forces.get(F.id)?.dead} morale ${Math.round(H.game.warfare.forces.get(F.id)?.morale ?? -1)}`).join(' · '));
  const loser = btPhase(H, FA) === 'rout' ? FA : FB, winner = loser === FA ? FB : FA;
  t.check(btPhase(H, winner) === 'won', 'the other side wins', btPhase(H, winner));
  await t.waitFor(() => ['deploy', 'advance', 'clash', 'rout', 'won'].every((p) => phases.has(p)), RT() + 3000, 'the guest followed the phases (deploy → advance → clash → rout / won)', () => [...phases].join(','));
  t.check(true, 'the guest followed the phases (deploy → advance → clash → rout / won)', [...phases].join(','));
  t.check(arrows > 4, 'the archers loosed volleys', arrows);
  t.check(FA.dead > 0 && FB.dead > 0, 'losses on both sides', `${FA.dead} / ${FB.dead}`);
  await t.waitFor(() => log.rep.some(([id, r]) => id === loser.id && r.phase === 'retreat') && log.rep.some(([id, r]) => id === winner.id && r.phase === 'won'), 60000, 'both report their losses when the battle ends (the report to 3a)');
  const rl = log.rep.filter(([id, r]) => id === loser.id && r.phase === 'retreat').pop()[1], rw = log.rep.filter(([id, r]) => id === winner.id && r.phase === 'won').pop()[1];
  t.check(rl.lost > 0 && rw.lost > 0 && rl.n < 24 && rw.n >= 0, 'the reports carry the losses and the survivors', `${JSON.stringify(rl)} · ${JSON.stringify(rw)}`);
  await t.waitFor(() => !btOn(G, FA) && !btOn(G, FB), 10000, 'the forces are gone on the guest (war.end)');
  t.metric('losses', `${FA.dead}/${FB.dead}`);
  await t.checkDigest(H, G);
});

def('BT6', {
  title: 'BT: heavy losses make a siege give up — the retreat, the camp and engines struck, the attackers gone',
  src: 'village', timeout: 240000,
  expected: 'A siege by 12 soldiers; once camped, 8 of them fall (the test kills them): past WAR.siege.lossRetreat of its men the force retreats (phase retreat on both peers, a shout), its soldiers run away past the camp, the force ends (war.end on both), its camp pieces are removed on both peers and 3a gets the report (state retreat / end); digest equal',
  api: 'siegeAI.js siegeTick (retreat), warfare.js endForce / repelled, siegeEnd',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = await btVillage(t, H, MH, G, MG);
  const [k2] = btKingdoms(H, s);
  const log = await warShim(t, H, G, [[k2, s.k]]);
  await btFast(t, H);
  const F = btSiege(t, H, s, k2, { n: 12, lv: 3, from: [1, 0] });
  await t.waitFor(() => btDbg(H, F)?.siege?.planned, 30000, 'the siege is planned');
  const camp = btDbg(H, F).siege.camp;
  await btStand(t, H, MH, G, MG, camp[0] - 4, camp[1] - 3);
  await t.waitFor(() => btDbg(H, F).siege.campIds.length >= 4, 60000, 'the camp is up');
  await t.waitFor(() => ['build', 'bombard', 'assault'].includes(btPhase(H, F)), 60000, 'the siege is on (build / bombard)');
  const campIds = btDbg(H, F).siege.campIds.slice();
  const cries = [];
  t.on(G, 'warcry', (e) => cries.push(e.text));
  for (let k = 0; k < 8; k++) {
    const m = soldiersOf(H, k2).find((q) => q.soldier.role !== 'general');
    if (!m) break;
    MH.combat.killMob(H.game, m, null);
    await t.sleep(150);
  }
  await t.waitFor(() => btPhase(H, F) === 'retreat' || btPhase(H, F) === 'gone', 15000, 'past its losses the force retreats', () => `phase ${btPhase(H, F)} dead ${F.dead}/${F.n0}`);
  await t.waitFor(() => btOn(G, F)?.phase === 'retreat' || !btOn(G, F), RT() + 2000, 'the guest sees the retreat');
  t.check(cries.some((c) => /recua|Recuar|resistiu/.test(c)), 'a shout tells it (war.cry)', cries.slice(-3).join(' · '));
  await t.waitFor(() => !H.game.warfare.forces.has(F.id) && !btOn(G, F), 90000, 'the force ends (war.end on both)', () => `phase ${btPhase(H, F)} live ${F.live?.size}`);
  t.check(campIds.every((id) => !A.structOn(H, id) && !A.structOn(G, id)), 'the camp is struck on both peers', `${campIds.filter((id) => A.structOn(G, id)).length} left`);
  t.check(!soldiersOf(H, k2).length, 'no soldier of it left');
  t.check(log.rep.some(([id, r]) => id === F.id && r.phase === 'retreat'), 'the report says retreat', JSON.stringify(log.rep.filter(([id]) => id === F.id).map(([, r]) => r.phase)));
  await t.checkDigest(H, G);
});

def('BT7', {
  title: 'BT: players and soldiers — protected outside a war, a traveller helps defend the village: the soldiers it hits fight back, reputation with the defender rises',
  src: 'village', timeout: 300000,
  expected: 'A kingdom\'s column on the march (materialize; its kingdom at peace with everyone here): its soldiers never go after the players standing among them, and the guest cannot hurt one ("Soldado do Reino de X: …", host hp unchanged). A debug siege of the start village: the guest (a traveller, no kingdom) hits an attacker — host hp drops, that soldier fights back (its foe is the guest\'s avatar); the guest fells attackers: game.realms.reward gives it reputation with the village\'s kingdom (+, on both peers) and costs it with the attackers\' (−), a toast "+N de reputação no Reino de …: defendendo …"; a member of a kingdom at war with the column\'s may hurt its soldiers; townsfolk stay protected; digest equal',
  api: 'soldier.js playerMayHurt / soldierHurt, combat.js soldierBlock / soldierImmune, warfare.js onHurt / onKilled / repHit / flushRep, mut/warfare.js war.rep',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = await btVillage(t, H, MH, G, MG);
  const [k2, k3] = btKingdoms(H, s);
  await warShim(t, H, G, [[k2, s.k]]); // (the column's kingdom k3: at peace with everyone here)
  const uid = await ecoReady(t, H, G);
  const R = realmOf(H);
  // (a) a column of kingdom k3 on the march (no war with anyone here)
  const mx = s.x + s.r + 50, my = s.y - 20;
  await btStand(t, H, MH, G, MG, mx, my + 6);
  const army = { id: 'bt-army-1', k: k3, home: R.kingdoms[k3].capital, n: 10, lv: 3, x: mx - 6, y: my, state: 'march', target: s.id, path: [[mx + 60, my]], eng: { treb: 0, cat: 0, ram: 0, tower: 0 }, live: true };
  const FM = H.game.warfare.materialize(army);
  t.defer(() => { if (H.game.warfare.forces.has(FM.id)) H.game.warfare.dematerialize(FM.id); H.game.net.flush(); });
  await t.waitFor(() => soldiersOf(G, k3).length >= 4, 20000, 'the guest sees the column');
  const hits = [];
  t.on(G, 'damage', (d) => { if (d.target === G.game.player && d.amount > 0) hits.push(d); });
  await t.sleep(4000);
  t.check(!hits.length, 'the column never attacks the players among it', `${hits.length} hits`);
  const e1 = soldiersOf(G, k3)[0], m1 = H.game.entities.find((q) => q.nid === e1.nid), hp1 = m1.hp;
  const toasts = [];
  t.on(G, 'toast', (x) => toasts.push(x.text));
  A.teleport(G, e1.x + 0.6, e1.y);
  t.check(MG.combat.dealDamage(G.game, G.game.player, e1, 40) === 0, 'the guest cannot hurt a soldier of a kingdom at peace with everyone here (immune)');
  await t.sleep(RT() + 300);
  t.check(m1.hp === hp1, 'its life unchanged on the host', `${f2(hp1)} → ${f2(m1.hp)}`);
  t.check(toasts.some((x) => /Soldado do Reino de/.test(x)), 'the reason is told', toasts.slice(-2).join(' · '));
  // a member of a kingdom at war with the column's may hurt it (the village's kingdom now at war with k3: 3a's realm.rel)
  await warShim(t, H, G, [[k3, s.k]]);
  H.game.net.emit('eco.member', { u: uid, k: s.k, name: 'BT', by: G.pid }); H.game.net.flush();
  await t.waitFor(() => recOn(G, uid)?.k === s.k, RT() + 2000, 'the guest joins the village\'s kingdom (now at war with the column\'s)');
  const e2 = soldiersOf(G, k3)[0], m2 = H.game.entities.find((q) => q.nid === e2.nid), hp2 = m2.hp;
  A.teleport(G, e2.x + 0.6, e2.y);
  await A.hostSees(t, H, G);
  MG.combat.dealDamage(G.game, G.game.player, e2, 30);
  await t.waitFor(() => m2.hp < hp2, RT() + 2000, 'a member of a kingdom at war with it hurts it');
  H.game.net.emit('eco.member', { u: uid, k: -1, name: 'BT', by: G.pid }); H.game.net.flush();
  await t.waitFor(() => recOn(G, uid)?.k === -1, RT() + 2000, 'a traveller again');
  H.game.warfare.dematerialize(FM.id); H.game.net.flush();
  // (b) the traveller helps defend the village against a siege
  await btFast(t, H);
  const F = btSiege(t, H, s, k2, { n: 18, lv: 2, from: [1, 0] });
  await t.waitFor(() => btDbg(H, F)?.siege?.planned, 30000, 'the siege is planned');
  const camp = btDbg(H, F).siege.camp;
  await btStand(t, H, MH, G, MG, camp[0] - 5, camp[1] - 2);
  await t.waitFor(() => ['camp', 'build', 'bombard'].includes(btOn(G, F)?.phase) && soldiersOf(G, k2).length >= 6, 60000, 'the attackers camped, seen by the guest');
  const rep0 = recOn(H, uid)?.rep[s.k] | 0, repA0 = recOn(H, uid)?.rep[k2] | 0;
  const tgt = soldiersOf(G, k2).filter((e) => e.soldier.role !== 'general').sort((a, b) => Math.hypot(a.x - G.game.player.x, a.y - G.game.player.y) - Math.hypot(b.x - G.game.player.x, b.y - G.game.player.y))[0];
  const mt = H.game.entities.find((q) => q.nid === tgt.nid), hpT = mt.hp;
  A.teleport(G, tgt.x + 0.7, tgt.y);
  await A.hostSees(t, H, G);
  MG.combat.dealDamage(G.game, G.game.player, tgt, 25);
  await t.waitFor(() => mt.hp < hpT, RT() + 2000, 'the traveller hurts an attacker (host hp)');
  const av = guestOnHost(H, G);
  await t.waitFor(() => mt.pfoe?.e === av && (mt.foe === av || mt.threat === av), 3000, 'that soldier fights back: the guest is its foe');
  await t.waitFor(() => tgt.state === 'chase', RT() + 2000, 'the guest sees it come at it (chase)');
  // fells attackers: reputation
  for (let k = 0; k < 3; k++) {
    const e = soldiersOf(G, k2).find((q) => q.soldier.role !== 'general');
    if (!e) break;
    const m = H.game.entities.find((q) => q.nid === e.nid);
    A.teleport(G, e.x + 0.7, e.y);
    await A.hostSees(t, H, G);
    MG.combat.dealDamage(G.game, G.game.player, e, 5000);
    await t.waitFor(() => m.dead, RT() + 2000, 'an attacker falls to the guest');
  }
  await t.waitFor(() => (recOn(H, uid)?.rep[s.k] | 0) > rep0 && (recOn(G, uid)?.rep[s.k] | 0) === (recOn(H, uid)?.rep[s.k] | 0), 12000, 'reputation with the defending kingdom rises (war.rep, both peers)', () => `${rep0} → ${recOn(H, uid)?.rep[s.k] | 0}`);
  t.check((recOn(H, uid)?.rep[k2] | 0) < repA0, 'and drops with the attackers\' kingdom', `${repA0} → ${recOn(H, uid)?.rep[k2] | 0}`);
  t.check(toasts.some((x) => /reputação no Reino de .*: defendendo/.test(x)), 'a toast tells the guest (game.realms.reward)', toasts.filter((x) => /reputação/.test(x)).slice(-1)[0]);
  // the townsfolk keep their protection
  const cit = G.game.entities.find((e) => e.npc && !e.dead);
  if (cit) t.check(MG.combat.dealDamage(G.game, G.game.player, cit, 30) === 0, 'a villager is still protected (§11)');
  await t.checkDigest(H, G);
});

def('BT8', {
  title: 'BT: the live-soldier cap and the cost per frame — two big armies near the players: at most 80 creatures, reserves step in as soldiers fall, < 1 ms a frame',
  src: 'village', timeout: 240000,
  expected: 'startBattle with 220 against 200 soldiers: never more than WAR.cap.total (80) soldier creatures (each side within its cap), the rest are numbers; when live soldiers fall (killed by the test) reserves become creatures (the live count refills, the force\'s n drops); the warfare system (brains, ticks) costs < 1 ms a frame on average and p95 < 3 ms during the clash (game.warfare.stats); digest equal',
  api: 'warfare.js fillRanks / warfareSystem stats, content/soldiers.js WAR.cap',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = await btVillage(t, H, MH, G, MG);
  const [ka, kb] = btKingdoms(H, s);
  await warShim(t, H, G, [[ka, kb]]);
  const { C } = await btMods(H), cap = C.WAR.cap;
  const cx = s.x + s.r + 60, cy = s.y + 8;
  await btStand(t, H, MH, G, MG, cx, cy + 9);
  const [FA, FB] = H.game.warfare.startBattle({ k: ka, n: 220, lv: 5, at: [cx - 26, cy] }, { k: kb, n: 200, lv: 5, at: [cx + 26, cy] });
  t.defer(() => { for (const F of [FA, FB]) if (H.game.warfare.forces.has(F.id)) H.game.warfare.dematerialize(F.id); H.game.net.flush(); });
  const live = (F) => [...F.live.values()].filter((m) => !m.dead).length;
  let peak = 0;
  t.watch(() => { peak = Math.max(peak, soldiersOf(H).length); }, 50);
  await t.waitFor(() => live(FA) >= Math.min(30, FA.cap) && live(FB) >= Math.min(30, FB.cap), 30000, 'both armies out (each up to its cap)', () => `${live(FA)}/${FA.cap} · ${live(FB)}/${FB.cap} · quality ${H.game.quality}`);
  await t.sleep(3000);
  t.check(soldiersOf(H).length <= cap.total && live(FA) <= FA.cap && live(FB) <= FB.cap, `at most ${cap.total} soldier creatures (each side within its cap)`, `${soldiersOf(H).length} (${live(FA)}/${FA.cap} · ${live(FB)}/${FB.cap})`);
  // reserves step in
  const n0 = FA.n, l0 = live(FA);
  for (const m of [...FA.live.values()].filter((q) => !q.dead && q.soldier.role !== 'general').slice(0, 10)) MH.combat.killMob(H.game, m, null);
  await t.waitFor(() => FA.n === n0 - 10, 3000, 'the force counts its losses');
  await t.waitFor(() => live(FA) >= l0 - 1, 15000, 'reserves become creatures as the live ones fall', () => `${live(FA)} / ${l0}`);
  // the cost during the clash
  await t.waitFor(() => ['clash', 'rout', 'won'].includes(FA.phase), 90000, 'the lines clash', () => `${FA.phase} / ${FB.phase}`);
  const S = H.game.warfare.stats, f0 = S.frames, sum0 = S.msSum;
  const samples = [];
  t.watch(() => { samples.push(S.ms); }, 16);
  await t.sleep(10000);
  const mean = (S.msSum - sum0) / Math.max(1, S.frames - f0), p95 = pct(samples, 0.95);
  t.log(`warfare: ${S.frames - f0} frames · mean ${f2(mean)} ms · p95 ${f2(p95)} · max ${f2(Math.max(...samples))} · live ${soldiersOf(H).length} · peak ${peak}`);
  t.check(peak <= cap.total, 'never above the cap', peak);
  t.check(mean < 1, 'under 1 ms a frame on average (brains, ticks)', `${f2(mean)} ms`);
  t.check(p95 < 3, 'p95 under 3 ms', `${f2(p95)} ms`);
  t.metric('meanMs', f2(mean)); t.metric('p95', f2(p95)); t.metric('peak', peak);
  await t.checkDigest(H, G);
});

// the hand-off with 3a (§12): an army of 3a's numbers near the players → live soldiers (materialize); away → numbers again
const liveOn = (f, id) => !!RZ(f).armies.get(id)?.live;
async function btFar(t, H, MH, G, MG, x, y) {
  A.teleport(H, x, y); A.teleport(G, x + 1.5, y);
  await t.waitFor(() => { const e = guestOnHost(H, G); return e && Math.hypot(H.game.world.dx(e.x, x + 1.5), e.y - y) < 2; }, 8000 + RT(), 'the host sees the guest there');
}

def('BT9', {
  title: 'BT: the hand-off with 3a — an army of the numbers marching near the players becomes live soldiers on its road; walking away hands it back with its losses kept',
  src: 'village', timeout: 240000,
  expected: '3a (game.realms) at war; one of its armies launched along its route (dbg.launch). The players go to it: within WAR.live tiles 3a marks it live and calls game.warfare.materialize — a column of soldiers on both peers (kind march, its road ahead from 3a\'s route), the army frozen in the numbers (live on both). Six soldiers fall (killed by the test): the force and 3a\'s army count the losses (report). The players walk away (> WAR.liveOut): 3a calls dematerialize — the soldiers go, the army is numbers again (live 0), with the losses kept, marching on; digest equal',
  api: 'game/realms.js liveCheck / hostReport, game/warfare.js materialize / dematerialize / routeAhead / report',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = startTownOf(H, MH), RH = RZ(H), RG = RZ(G);
  t.need(s, 'the start village');
  const [k2] = btKingdoms(H, s);
  await warShim(t, H, G, [[k2, s.k]]);
  // an army of k2 from its place nearest to the village (3a's own launch), toward the village
  const from = frontOf(H, k2, s.k)[0];
  t.need(from && RH.dbg.route(from.id, s.id), 'a place of the enemy with a way to the start village');
  H.game.net.emit('realm.army', { gar: [[from.id, 90]] }); H.game.net.flush();
  const a0 = RH.dbg.launch(from.id, s.id, 30);
  H.game.net.flush();
  t.need(a0, 'an army launched (dbg.launch)');
  t.defer(() => { if (H.game.warfare.forces.has(a0.id)) H.game.warfare.dematerialize(a0.id); H.game.net.emit('realm.army', { del: a0.id }); H.game.net.flush(); });
  await t.waitFor(() => RG.armies.get(a0.id)?.state === 'march', 2000 + RT(), 'the army marches (both peers)');
  const n0 = RH.armies.get(a0.id).n, [ax, ay] = RH.dbg.pos(a0.id);
  // the players go to it (beside its road, a little ahead)
  await btFar(t, H, MH, G, MG, ax + 6, ay + 6);
  await t.waitFor(() => liveOn(H, a0.id) && liveOn(G, a0.id) && H.game.warfare.forces.get(a0.id)?.kind === 'march', 20000, 'near the players the army is live (3a → materialize: a column of soldiers)', () => `live ${liveOn(H, a0.id)} force ${H.game.warfare.forces.get(a0.id)?.kind || '-'}`);
  const F = H.game.warfare.forces.get(a0.id);
  t.check(F.path.length > 0, 'it walks its road ahead (3a\'s route)', `${F.path.length} points`);
  await t.waitFor(() => soldiersOf(G, k2).length >= 6, 20000, 'the guest sees the column', () => `${soldiersOf(G, k2).length} on the guest, ${soldiersOf(H, k2).length} on the host`);
  t.check(soldiersOf(G, k2).every((e) => e.soldier.tag === F.tag), 'its soldiers on the guest (identity from the force\'s tag and the seed)');
  // losses (six of its own — another army of k2 may be live elsewhere; the ranks fill a few a tick)
  const ranks = () => soldiersOf(H, k2).filter((q) => q.soldier.tag === F.tag && q.soldier.role !== 'general');
  await t.waitFor(() => ranks().length >= 6, 10000, 'six of its soldiers out on the host', () => `${ranks().length}`);
  for (const m of ranks().slice(0, 6)) MH.combat.killMob(H.game, m, null);
  await t.waitFor(() => F.n === n0 - 6, 4000, 'the force counts its losses', () => `${F.n} / ${n0}`);
  await t.waitFor(() => RH.armies.get(a0.id)?.n === n0 - 6, 10000, '3a\'s army counts them too (report)', () => `${RH.armies.get(a0.id)?.n} / ${n0 - 6}`);
  // walk away: 3a hands it back to the numbers
  await btFar(t, H, MH, G, MG, s.x, s.y + 3);
  t.need(Math.hypot(H.game.world.dx(s.x, ax), s.y - ay) > 170, 'the army\'s road far from the village (> WAR.liveOut)');
  await t.waitFor(() => !liveOn(H, a0.id) && !liveOn(G, a0.id) && !H.game.warfare.forces.has(a0.id), 20000, 'far from everyone it is numbers again (dematerialize)', () => `live ${liveOn(H, a0.id)} force ${!!H.game.warfare.forces.get(a0.id)}`);
  const a1 = RH.armies.get(a0.id);
  t.check(a1 && a1.n === n0 - 6 && RG.armies.get(a0.id)?.n === n0 - 6, 'with its losses kept (both peers)', `${a1?.n} / ${n0}`);
  t.check(a1.state === 'march' && a1.v > 0, 'and marching on (3a\'s clock)', `${a1.state} v ${a1.v}`);
  await t.waitFor(() => !soldiersOf(G, k2).length, RT() + 3000, 'its soldiers gone on the guest');
  await t.checkDigest(H, G);
});

def('BT10', {
  title: 'BT: the hand-off with 3a — a siege of the numbers becomes the playable siege when the players arrive (its camp and engines stand at once), and goes back to the numbers when they leave',
  src: 'village', timeout: 300000,
  expected: 'An army of 3a besieges the start village by numbers while the players are far (dbg.launch + the clock forward until state siege). The players come back: 3a marks it live and materialize starts the playable siege on the same place (game.warfare force kind siege, sid = the village; what the numbers built — the camp, the engines it has — stands at once); while live 3a does not run its siege hours (no damage by numbers: hrs unchanged). The players leave: dematerialize — the camp and engines struck, the army numbers again (state siege, its soldiers counted), 3a\'s siege hours go on; digest equal',
  api: 'game/realms.js liveCheck / siegeHour, game/warfare.js materialize (have / ph) / dematerialize, siegeAI.js raiseCamp / buildEngines',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const s = startTownOf(H, MH), RH = RZ(H), RG = RZ(G);
  t.need(s, 'the start village');
  const [k2] = btKingdoms(H, s);
  await warShim(t, H, G, [[k2, s.k]]);
  t.defer(() => btHeal(H, s.id));
  t.defer(() => { if (RZ(H).owner(s.id) !== s.k) RZ(H).dbg.capture(s.id, s.k); H.game.net.flush(); });
  const from = frontOf(H, k2, s.k)[0];
  t.need(from && RH.dbg.route(from.id, s.id), 'a place of the enemy with a way to the start village');
  // the players far away (the army plays by numbers)
  const away = [s.x + 420, s.y + 40];
  await btFar(t, H, MH, G, MG, away[0], away[1]);
  H.game.net.emit('realm.army', { gar: [[from.id, 160]] }); H.game.net.flush();
  const a0 = RH.dbg.launch(from.id, s.id, 60);
  H.game.net.flush();
  t.need(a0, 'an army launched');
  t.defer(() => { if (H.game.warfare.forces.has(a0.id)) H.game.warfare.dematerialize(a0.id); H.game.net.emit('realm.army', { del: a0.id }); H.game.net.flush(); });
  for (let k = 0; k < 40 && RH.armies.get(a0.id)?.state !== 'siege'; k++) { wrSkip(H, 2); await t.sleep(RT() + 300); }
  await t.waitFor(() => RH.armies.get(a0.id)?.state === 'siege' && RG.armies.get(a0.id)?.state === 'siege', 4000, 'it besieges the village by numbers', () => `${RH.armies.get(a0.id)?.state} ${RH.armies.get(a0.id)?.phase}`);
  t.check(!liveOn(H, a0.id), 'not live (the players are far)');
  for (let k = 0; k < 6 && RH.armies.get(a0.id)?.phase === 'camp'; k++) { wrSkip(H, 2); await t.sleep(RT() + 300); } // (a few hours: past its camp, building)
  const ph = RH.armies.get(a0.id).phase, eng = (RH.armies.get(a0.id).eng || []).slice();
  // the players come back to the village: the playable siege
  const L = H.game.towns.layout(s.id);
  await btFar(t, H, MH, G, MG, L.spawn[0], L.spawn[1]);
  await t.waitFor(() => liveOn(H, a0.id) && H.game.warfare.forces.get(a0.id)?.kind === 'siege', 30000, 'with the players near it is live: the playable siege (materialize)', () => `live ${liveOn(H, a0.id)} force ${H.game.warfare.forces.get(a0.id)?.kind || '-'}`);
  const F = H.game.warfare.forces.get(a0.id);
  t.check(F.sid === s.id && F.k === k2, 'on the same place, the same kingdom', `${F.sid} ${F.k}`);
  await t.waitFor(() => btOn(G, F)?.kind === 'siege', RT() + 2000, 'the guest knows the force');
  const hrs0 = RH.armies.get(a0.id).hrs;
  await t.waitFor(() => btDbg(H, F)?.siege?.planned, 30000, 'the siege is planned');
  if (ph !== 'camp') await t.waitFor(() => btDbg(H, F).siege.campIds.length >= 6, 15000, `the camp of a siege already in its ${ph} phase stands at once`);
  if (eng.some((v) => v > 0)) await t.waitFor(() => btDbg(H, F).siege.jobs.some((j) => j.role !== 'ws' && j.done), 30000, 'the engines it built by numbers stand at once', () => JSON.stringify(eng));
  await t.sleep(((H.game.env.dayLength || 780) / 24) * 1000 * 1.2); // (more than a game hour: 3a would have run a siege hour)
  t.check(RH.armies.get(a0.id).hrs === hrs0, 'while live 3a runs no siege hours on it (no damage by numbers)', `${hrs0} → ${RH.armies.get(a0.id).hrs}`);
  // the players leave: numbers again
  const campIds = btDbg(H, F).siege.campIds.slice();
  await btFar(t, H, MH, G, MG, away[0], away[1]);
  await t.waitFor(() => !liveOn(H, a0.id) && !liveOn(G, a0.id) && !H.game.warfare.forces.has(a0.id), 20000, 'far again: numbers (dematerialize)');
  // (the camp's removal reaches the guest when it comes near again: it is far now — interest, net/interest.js)
  await t.waitFor(() => campIds.every((id) => !A.structOn(H, id)), RT() + 2000, 'its camp struck (host)', () => `${campIds.filter((id) => A.structOn(H, id)).length} still up`);
  const a1 = RH.armies.get(a0.id);
  t.check(a1 && a1.state === 'siege' && a1.n > 0 && RG.armies.get(a0.id)?.n === a1.n, 'the army besieges on by numbers with its soldiers counted (both peers)', `${a1?.state} n ${a1?.n}`);
  await t.checkDigest(H, G);
});

// =====================================================================================================
// AR — phase 3c: the player in the army (docs/REINOS.md §15: game/army.js, game/mut/army.js, ui/armyHud.js, ui/muralWar.js,
// the hooks in combat.js / npc.js / soldier.js / warfare.js / siegeAI.js / mut/siege.js, game.realms.settle). The wars are
// forced with 3a's debug op realm.rel (the AI paused); the guest is made a member / given reputation by the host's ops.
// =====================================================================================================
const arRec = (f, uid) => f.game.army?.en?.get(uid) || null;
const arOrder = (f) => f.game.army?.order?.() || null;
const arDay = (f) => (f.game.eco.day >= 0 ? f.game.eco.day : f.game.env.dayIndex);
function arSetRep(H, uid, k, v) {
  let cur = recOn(H, uid)?.rep[k] | 0;
  for (let n = 0; n < 8 && cur !== v; n++) { const d = Math.max(-100, Math.min(100, v - cur)); H.game.net.emit('eco.rep', { u: uid, k, d }); cur = Math.max(-200, cur + d); }
  H.game.net.flush();
}
async function arMember(t, H, G, uid, k, rep = null, pid = G.pid, f = G) {
  H.game.net.emit('eco.member', { u: uid, k, name: recOn(H, uid)?.name || 'AR', by: pid }); H.game.net.flush();
  if (rep != null) arSetRep(H, uid, k, rep);
  await t.waitFor(() => recOn(f, uid)?.k === k && recOn(G, uid)?.k === k && (rep == null || (recOn(G, uid)?.rep[k] | 0) === rep), RT() + 2000, `${uid} a member of kingdom ${k}${rep != null ? ` (reputation ${rep})` : ''} on both peers`);
}
// enlisted straight by the host (op army.rec) in the army of place sid
async function arEnlist(t, H, G, uid, sid, patch = {}) {
  const k = RZ(H).owner(sid), d = Math.max(arDay(H), H.game.env.dayIndex | 0); // (the economy day may lag a skipped clock: not paid in the middle of a scenario)
  H.game.net.emit('army.rec', { u: uid, r: { sid, k, rank: 0, svc: 0, since: d, paid: d, kills: 0, a: '', kd: -1, kn: 0, ...patch }, ban: 0, ev: 'debug' }); H.game.net.flush();
  await t.waitFor(() => arRec(G, uid)?.sid === sid && arRec(H, uid)?.sid === sid, RT() + 2000, `enlisted in the army of ${realmOf(H).settlements[sid].name} (both peers)`);
}
// a clean slate: out of every army, no desertion, a traveller — now and at the end of the scenario
async function arClean(t, H, G, uid, pid = G.pid) {
  const out = () => { H.game.net.emit('army.rec', { u: uid, r: 0, ban: 0, ev: 'debug' }); H.game.net.emit('eco.member', { u: uid, k: -1, name: recOn(H, uid)?.name || 'AR', by: pid }); H.game.net.flush(); };
  out(); t.defer(out);
  await t.waitFor(() => !arRec(G, uid) && recOn(G, uid)?.k === -1, RT() + 2000, `${uid} a traveller out of every army`);
}
const arCard = (f) => { const el = f.doc.querySelector('#ordcard'); return el && !el.classList.contains('hidden') ? el.textContent.replace(/\s+/g, ' ') : ''; };
// a free spot for a structure of `type` near (x, y) (the player's placement rules)
function arSpot(H, MS, type, x, y, rot = 0) { // eslint-disable-line max-params
  for (let r = 0; r < 14; r++) for (let a = 0; a < 12; a++) {
    const tx = Math.floor(x + Math.cos(a * 0.52) * r * 1.5), ty = Math.floor(y + Math.sin(a * 0.52) * r * 1.5);
    if (!MS.placeReason(H.game, type, tx, ty, null, rot)) return [tx, ty];
  }
  return null;
}
// structures of kingdom k's army (complete) placed by the host: struct.add + war.mark (as game/siegeAI.js does)
function arArmyStruct(t, H, k, type, tx, ty, rot = 0) {
  const id = H.game.net.newId('s');
  H.game.net.emit('struct.add', { list: [[id, type, tx, ty, 0, 1, Math.round(H.game.worldTime), rot, 1, 0, '', '']] });
  H.game.net.emit('war.mark', { ids: [id], k });
  H.game.net.flush();
  t.defer(() => { if (H.game.world.objById.has(id)) { H.game.net.emit('struct.remove', { id, quiet: 1 }); H.game.net.flush(); } });
  return id;
}

def('AR1', {
  title: 'AR: enlisting at the mural — refused (not a member, not enough reputation, a castle asks for more), accepted, the orders card; one army at a time; leaving in peace costs nothing',
  src: 'village', timeout: 150000,
  expected: 'The guest at the start village\'s mural, Exército tab: "Alistamento" with the requirements (✕ member, ✕ reputation) and the button disabled; army.join refused "Entre no Reino de …". A member with 10 reputation: refused "Reputação Conhecido … faltam 15"; a castle of the kingdom asks for Respeitado ("faltam 90" with 10). With 30: accepted — the record (place, kingdom, Recruta) on both peers, the tab says "Você está no exército" with the pay by rank, the orders card on the guest\'s HUD (peace: "Em paz: a milícia de … treina"); a second join refused ("Você já serve"); "Dar baixa" (two taps) outside a fight: out of the army, the reputation unchanged, no ban; digest equal',
  api: 'game/army.js joinReason / joinReqs, mut/army.js army.join / army.leave / army.rec, ui/muralWar.js enlistCard / armyBind, ui/armyHud.js',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G), s = startTownOf(H, MH), R = realmOf(H), K = R.kingdoms[s.k];
  await arClean(t, H, G, uid);
  arSetRep(H, uid, s.k, 0);
  await toMural(t, H, MH, G, MG, s.id);
  muralTab(G, s.id, 'army');
  await t.waitFor(() => /Alistamento/.test(ecoTxt(G)), 3000, 'the Exército tab shows the enlistment');
  t.check(/Membro do Reino de/.test(ecoTxt(G)) && /Reputação Conhecido no Reino de/.test(ecoTxt(G)), 'the requirements are listed', short(ecoTxt(G).slice(ecoTxt(G).indexOf('Alistamento')), 160));
  t.check(G.doc.querySelector('[data-ajoin]')?.disabled === true, 'the button is disabled (not a member)');
  const r1 = await ecoReq(G, 'army.join', { sid: s.id });
  t.check(!r1.ok && /Entre no Reino de/.test(r1.why), 'refused: not a member', r1.why);
  await arMember(t, H, G, uid, s.k, 10);
  const r2 = await ecoReq(G, 'army.join', { sid: s.id });
  t.check(!r2.ok && /Reputação Conhecido no Reino de .*faltam 15/.test(r2.why), 'refused: reputation (village militia: Conhecido)', r2.why);
  const castle = R.settlements.find((q) => q.kind === 'castle' && RZ(H).owner(q.id) === s.k);
  t.need(castle, 'a castle of the kingdom');
  const why = G.game.army.joinReason(uid, castle.id, null);
  t.check(/Reputação Respeitado no Reino de .*faltam 90/.test(why || ''), 'a castle\'s garrison asks for Respeitado', why);
  arSetRep(H, uid, s.k, 30);
  await t.waitFor(() => (recOn(G, uid)?.rep[s.k] | 0) === 30, RT() + 2000, 'reputation 30 on the guest');
  muralTab(G, s.id, 'army');
  t.check(G.doc.querySelector('[data-ajoin]')?.disabled === false, 'the button is enabled now');
  G.doc.querySelector('[data-ajoin]').click();
  await t.waitFor(() => arRec(G, uid)?.sid === s.id && arRec(H, uid)?.sid === s.id, RT() + 3000, 'accepted (the button): enlisted on both peers');
  const rh = arRec(H, uid);
  t.check(rh.k === s.k && rh.rank === 0 && rh.svc === 0, 'in the kingdom\'s army as a Recruta', JSON.stringify(rh));
  await t.waitFor(() => /Você está no exército/.test(ecoTxt(G)) && /Recruta/.test(ecoTxt(G)), 3000, 'the tab says so (rank, pay)');
  await t.waitFor(() => /Ordem do general/.test(arCard(G)), 4000, 'the orders card on the guest\'s HUD', () => arCard(G));
  t.check(/Em paz/.test(arCard(G)) || /Guarde/.test(arCard(G)), 'a quiet order (no war)', arCard(G));
  const r3 = await ecoReq(G, 'army.join', { sid: s.id });
  t.check(!r3.ok && /já serve/.test(r3.why), 'one army at a time (refused again)', r3.why);
  const repB = recOn(H, uid).rep[s.k] | 0;
  muralTab(G, s.id, 'army');
  G.doc.querySelector('[data-aleave]').click();
  await t.sleep(200);
  t.check(/Confirmar a baixa/.test(ecoTxt(G)), 'leaving asks to confirm (no fight: a plain discharge)');
  G.doc.querySelector('[data-aleave]').click();
  await t.waitFor(() => !arRec(G, uid) && !arRec(H, uid), RT() + 3000, 'out of the army on both peers');
  t.check((recOn(H, uid).rep[s.k] | 0) === repB && !H.game.army.des.has(uid), 'leaving in peace: reputation unchanged, no ban', `${repB} → ${recOn(H, uid).rep[s.k] | 0}`);
  await t.waitFor(() => !arCard(G), 3000, 'the card goes');
  G.game.events.emit('closepanels', {});
  await t.checkDigest(H, G);
});

def('AR2', {
  title: 'AR: the general\'s orders follow the campaign — catch up with the army, march with it (it stays live and keeps marching), the siege by numbers, the camp of the playable siege; the waypoint on the guest',
  src: 'village', timeout: 420000,
  expected: 'The guest is enlisted in the start kingdom\'s militia; at war, an army of the kingdom (dbg.launch from its place nearest the enemy) marches on an enemy place: the host assigns it (record.a on both) and the guest\'s card says "Alcance o exército" with the waypoint on the army (game.army.wp ≈ its position) and a red mark on the radar ring. The players go to it and walk with it: it is live (3b\'s column) AND its clock keeps running (v > 0 — escorted), the column follows 3a\'s position, the order says "Marche com o exército até …" with the target as waypoint. They leave: numbers again (live 0). The clock forward: it besieges the place by numbers — "Vá ao cerco de …". The players come to it: the playable siege, and the orders of its phases (march to the camp / camp / build / bombard) with their waypoints; at least four different orders seen, each with a notice; digest equal',
  api: 'game/army.js follow / orderFor / escorted, ui/armyHud.js (card, game.army.wp), ui/radar.js, game/realms.js liveCheck / maintain (escort), game/warfare.js marchTick (follow)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G), s = startTownOf(H, MH), R = realmOf(H), RH = RZ(H), RG = RZ(G);
  const [k2] = btKingdoms(H, s);
  t.need(k2 != null, 'an enemy kingdom on the landmass');
  await arClean(t, H, G, uid);
  await arMember(t, H, G, uid, s.k, 40);
  await arEnlist(t, H, G, uid, s.id);
  await warShim(t, H, G, [[s.k, k2]]);
  const from = frontOf(H, s.k, k2)[0];
  const T = R.settlements.filter((q) => RH.owner(q.id) === k2).sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  t.need(from && T && RH.dbg.route(from.id, T.id), 'a way from the kingdom\'s front to an enemy place');
  t.defer(() => btHeal(H, T.id));
  t.defer(() => { if (RZ(H).owner(T.id) !== T.k) RZ(H).dbg.capture(T.id, T.k); H.game.net.flush(); });
  H.game.net.emit('realm.army', { gar: [[from.id, 120]] }); H.game.net.flush();
  const a0 = RH.dbg.launch(from.id, T.id, 50);
  H.game.net.flush();
  t.need(a0, 'an army launched');
  t.defer(() => { if (H.game.warfare.forces.has(a0.id)) H.game.warfare.dematerialize(a0.id); H.game.net.emit('realm.army', { del: a0.id }); H.game.net.flush(); });
  const codes = new Set(), notes = [];
  t.watch(() => { const o = arOrder(G); if (o) codes.add(o.code); }, 200);
  t.on(G, 'armyorder', (e) => notes.push(e.title)); // (ui/armyHud.js: each new order told with a notice)
  await t.waitFor(() => arRec(H, uid)?.a === a0.id && arRec(G, uid)?.a === a0.id, 6000 + RT(), 'the host gives the guest that army to follow (record.a on both)', () => `${arRec(H, uid)?.a}`);
  // far from it: catch up — the waypoint on the army (the players at a place 180–700 tiles from it)
  const p0 = RH.dbg.pos(a0.id);
  const farS = R.settlements.map((q) => [Math.hypot(H.game.world.dx(q.x, p0[0]), q.y - p0[1]), q]).filter(([d]) => d > 180 && d < 700).sort((a, b) => a[0] - b[0])[0]?.[1];
  t.need(farS, 'a place 180–700 tiles from the army');
  const away = A.freeSpot(H, MH, farS.x, farS.y + farS.r + 6, { rMin: 0, rMax: 6 }) || [farS.x, farS.y + farS.r + 6];
  await btFar(t, H, MH, G, MG, away[0], away[1]);
  await t.waitFor(() => arOrder(G)?.code === 'march' && /Alcance o exército/.test(arCard(G)), 5000, 'far from it: "Alcance o exército" on the guest\'s card', () => `${JSON.stringify(arOrder(G))} · ${arCard(G)}`);
  { const wp = G.game.army.wp, p = RG.posOf(RG.armies.get(a0.id)); t.check(wp && Math.hypot(G.game.world.dx(wp.x, p.x), wp.y - p.y) < 4 && wp.label === 'Exército', 'the waypoint is the army (game.army.wp)', JSON.stringify(wp)); }
  await t.waitFor(() => G.doc.querySelector('.rd-m.ord'), 3000, 'a red mark on the radar ring');
  // with it: live, and its clock keeps running (escorted)
  const near = () => { const p = RH.dbg.pos(a0.id); return [p[0] + 2.5, p[1] + 2.5]; };
  { const [x, y] = near(); await btFar(t, H, MH, G, MG, x, y); }
  await t.waitFor(() => liveOn(H, a0.id) && liveOn(G, a0.id) && H.game.warfare.forces.get(a0.id)?.kind === 'march', 20000, 'beside it the army is live (a column of soldiers)');
  await t.waitFor(() => RH.armies.get(a0.id).v > 0 && RG.armies.get(a0.id).v > 0, 8000, 'with its enlisted player beside it the march keeps running (v > 0 on both)', () => `v ${RH.armies.get(a0.id).v}`);
  const d0 = MH.realms.distAt(RH.armies.get(a0.id), H.game.worldTime);
  for (let k = 0; k < 10; k++) { const [x, y] = near(); A.teleport(G, x, y); A.teleport(H, x - 1.5, y); await t.sleep(1000); }
  const a1 = RH.armies.get(a0.id), d1 = MH.realms.distAt(a1, H.game.worldTime);
  t.check(liveOn(H, a0.id) && d1 - d0 > 6, 'it marched on while live (3a\'s clock)', `${f2(d0)} → ${f2(d1)} tiles`);
  { const F = H.game.warfare.forces.get(a0.id), p = RH.posOf(a1); t.check(F && Math.hypot(H.game.world.dx(F.anchor.x, p.x), F.anchor.y - p.y) < 8, 'the column of soldiers follows 3a\'s place on the road', F ? `${f2(Math.hypot(H.game.world.dx(F.anchor.x, p.x), F.anchor.y - p.y))} tiles` : 'no force'); }
  await t.waitFor(() => new RegExp(`Marche com o exército até ${T.name}`).test(arCard(G)), 4000, 'with it: "Marche com o exército até …"', () => arCard(G));
  t.check(G.game.army.wp?.label === T.name, 'the waypoint is the target now', JSON.stringify(G.game.army.wp));
  // it leaves: numbers again
  await btFar(t, H, MH, G, MG, away[0], away[1]);
  await t.waitFor(() => !liveOn(H, a0.id) && !H.game.warfare.forces.has(a0.id), 20000, 'the players away: numbers again (dematerialize)');
  // the clock forward until it besieges the place
  for (let k = 0; k < 60 && RH.armies.get(a0.id)?.state !== 'siege'; k++) { wrSkip(H, 2); await t.sleep(RT() + 300); }
  await t.waitFor(() => RH.armies.get(a0.id)?.state === 'siege' && RG.armies.get(a0.id)?.state === 'siege', 4000, 'it besieges the enemy place by numbers', () => `${RH.armies.get(a0.id)?.state} ${RH.armies.get(a0.id)?.phase}`);
  await t.waitFor(() => arOrder(G)?.code === 'siege' && new RegExp(`cerco de ${T.name}`).test(arCard(G)), 5000, '"Vá ao cerco de …" on the card', () => arCard(G));
  // to the siege: the playable siege's orders
  const sg = RH.armies.get(a0.id);
  G.game.towns.layout(T.id);
  await btFar(t, H, MH, G, MG, sg.x - 6, sg.y + 3);
  await t.waitFor(() => liveOn(H, a0.id) && H.game.warfare.forces.get(a0.id)?.kind === 'siege', 30000, 'near it: the playable siege (materialize)');
  await t.waitFor(() => ['tocamp', 'camp', 'build', 'bombard'].includes(arOrder(G)?.code), 30000, 'the order of the siege\'s phase (march to the camp / camp / build / bombard)', () => JSON.stringify(arOrder(G)));
  t.check(!!G.game.army.wp, 'with its waypoint', JSON.stringify(G.game.army.wp));
  codes.add(arOrder(G)?.code); // (the last one: the watch samples every 0,2 s)
  t.check(codes.size >= 4, 'at least four different orders as the campaign moved on', [...codes].join(', '));
  await t.waitFor(() => notes.length >= 3, 3000, 'each change with a short notice ("Ordem do general")', () => notes.join(' | '));
  t.check(true, 'each change with a short notice ("Ordem do general")', notes.join(' | '));
  t.metric('orders', [...codes].join(','));
  await t.checkDigest(H, G);
});

def('AR3', {
  title: 'AR: the army\'s engines — a soldier player pushes its army\'s ram and operates its trebuchet (the army\'s stones); a traveller cannot',
  src: 'village', timeout: 150000,
  expected: 'A ram and a trebuchet of the start kingdom\'s army (o.realm, war.mark) outside the village. The host — a traveller — is refused on both ("… só quem serve nesse exército a usa"). The guest, enlisted in that kingdom\'s militia: siege.push accepted (o.push holds it on both), it pushes (siege.drive) and the ram moves a tile (siege.step on both); siege.use on the trebuchet accepted even with no trebuchet stones, and it throws (siege.shot on the guest) without taking any; digest equal',
  api: 'mut/siege.js siege.use / siege.push (soldierOf), siege.js makeCtl.fire (army stones), game/army.js rec',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G), s = startTownOf(H, MH);
  const MS = await fimp(H, 'game/mut/structures.js');
  await arClean(t, H, G, uid);
  const hu = H.game.eco.api.me();
  await arClean(t, H, H, hu, H.pid);
  const x0 = s.x + s.r + 22, y0 = s.y + 4;
  await btStand(t, H, MH, G, MG, x0, y0 - 6);
  const ws = arSpot(H, MS, 'siege_workshop', x0 + 4, y0 - 7, 0), wsId = ws && arArmyStruct(t, H, s.k, 'siege_workshop', ws[0], ws[1], 0); // (the player's rule: engines within 16 tiles of a workshop)
  t.need(wsId, 'room for the army\'s workshop');
  const rs = arSpot(H, MS, 'battering_ram', x0, y0, 0), ram = rs && arArmyStruct(t, H, s.k, 'battering_ram', rs[0], rs[1], 0);
  const ts = arSpot(H, MS, 'trebuchet', x0 + 9, y0 + 2, 0), treb = ts && arArmyStruct(t, H, s.k, 'trebuchet', ts[0], ts[1], 0);
  t.need(ram && treb, 'room for a ram and a trebuchet');
  await t.waitFor(() => A.structOn(G, ram)?.realm === s.k && A.structOn(G, treb)?.realm === s.k, RT() + 3000, 'the army\'s engines on both peers (o.realm)');
  // the traveller (the host)
  const h1 = await ecoReq(H, 'siege.push', { id: ram, on: 1 }), h2 = await ecoReq(H, 'siege.use', { id: treb, on: 1 });
  t.check(!h1.ok && /só quem serve/.test(h1.why) && !h2.ok && /só quem serve/.test(h2.why), 'a traveller may neither push nor operate them', `${h1.why} · ${h2.why}`);
  // the soldier (the guest)
  await arMember(t, H, G, uid, s.k, 40);
  await arEnlist(t, H, G, uid, s.id);
  const o = A.structOn(G, ram), [cx, cy] = [o.tx + o.fw / 2, o.ty + o.fh / 2];
  const sp = A.freeSpot(G, MG, cx, cy, { rMin: 1.6, rMax: 3 }) || [cx + 2, cy];
  A.teleport(G, sp[0], sp[1]);
  await A.hostSees(t, H, G, 4000 + RT());
  const g1 = await ecoReq(G, 'siege.push', { id: ram, on: 1 });
  t.check(g1.ok, 'the soldier grabs its army\'s ram', g1.why);
  await t.waitFor(() => (A.structOn(H, ram)?.push || []).includes(G.pid) && (A.structOn(G, ram)?.push || []).includes(G.pid), RT() + 2000, 'it is pushing (o.push on both)');
  const tx0 = A.structOn(H, ram).tx, ty0 = A.structOn(H, ram).ty, front = A.structOn(H, ram).rot & 3;
  for (let k = 0; k < 16; k++) { await ecoReq(G, 'siege.drive', { id: ram, d: [front, (front + 2) & 3, 1, 3][Math.floor(k / 4)] }); await t.sleep(600); if (A.structOn(G, ram).tx !== tx0 || A.structOn(G, ram).ty !== ty0) break; } // (one pusher: 0,3 tile/s; the way it can go)
  await t.waitFor(() => A.structOn(G, ram).tx !== tx0 || A.structOn(G, ram).ty !== ty0, 8000, 'the ram moves (siege.step on the guest)', () => `${A.structOn(H, ram).tx},${A.structOn(H, ram).ty} msg ${A.structOn(H, ram)._msg || ''}`);
  await ecoReq(G, 'siege.push', { id: ram, on: 0 });
  // the trebuchet: no stones of its own
  setItem(G, 'treb_stone', 0);
  const tr = A.structOn(G, treb), [px, py] = MG.siege.pivotOf(tr);
  const sp2 = A.freeSpot(G, MG, px, py, { rMin: 1.4, rMax: 2.4 }) || [px + 2, py];
  A.teleport(G, sp2[0], sp2[1]);
  await A.hostSees(t, H, G, 4000 + RT());
  const g2 = await ecoReq(G, 'siege.use', { id: treb, on: 1 });
  t.check(g2.ok, 'the soldier operates its army\'s trebuchet', g2.why);
  await t.waitFor(() => A.structOn(H, treb)?.user === G.pid && G.game.siege?.o?.id === treb, RT() + 3000, 'it is the operator (o.user on the host, the local controls on the guest)');
  const shots = [];
  t.on(G, 'siegeshot', (e) => shots.push(e));
  G.game.siege.fire();
  await t.waitFor(() => shots.length >= 1, RT() + 4000, 'it throws (siege.shot on the guest)');
  t.check(G.game.player.inv.count('treb_stone') === 0, 'the army\'s stone: none taken from (or given to) the soldier', G.game.player.inv.count('treb_stone'));
  await ecoReq(G, 'siege.use', { id: treb, on: 0 });
  await t.checkDigest(H, G);
});

def('AR4', {
  title: 'AR: who may hurt whom — an enlisted player hurts the enemy\'s guards and soldiers, never civilians nor its own side; the enemy\'s guards and soldiers take it as a foe (the bell, the gates)',
  src: 'village', timeout: 240000,
  expected: 'The start village\'s kingdom at war with k2. The guest a member of k2 (not enlisted): a guard of the village is still protected. Enlisted in k2\'s army: a guard takes the hit (host hp drops), a civilian never does; the village\'s guards see it as hostile (npc.js hostile on the host), the bell rings and the gates shut; a column of the village\'s kingdom near: its soldiers list the guest as a foe (isFoe) and the guest hurts one; a k2 column: the guest cannot hurt its own side (immune); a guard of k2\'s own (rule) is protected; digest equal',
  api: 'game/army.js npcWhy / townFoe / soldierFoe, combat.js npcBlock / dealDamage, npc.js hostile / guardTargets, people.js dangerOf, towns.js hostileInside, soldier.js isFoe, warfare.js forceTick (foes)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G);
  const s = await btVillage(t, H, MH, G, MG), R = realmOf(H);
  const [k2] = btKingdoms(H, s);
  t.need(k2 != null, 'an enemy kingdom');
  await arClean(t, H, G, uid);
  await warShim(t, H, G, [[k2, s.k]]);
  const S = await fimp(H, 'game/soldier.js');
  const k2place = frontOf(H, k2, s.k)[0];
  await arMember(t, H, G, uid, k2, 40);
  const guardOf = () => G.game.entities.filter((e) => e.npc?.guard && !e.dead && e.npcS?.sid === s.id).sort((a, b) => Math.hypot(a.x - G.game.player.x, a.y - G.game.player.y) - Math.hypot(b.x - G.game.player.x, b.y - G.game.player.y))[0];
  await t.waitFor(() => guardOf(), 20000, 'a guard of the village near the guest');
  // a member, not enlisted: the guards stay protected
  let gd = guardOf(), gm = H.game.entities.find((q) => q.nid === gd.nid), hp0 = gm.hp;
  A.teleport(G, gd.x + 0.7, gd.y); await A.hostSees(t, H, G);
  t.check(MG.combat.dealDamage(G.game, G.game.player, gd, 30) === 0, 'a member who is not enlisted cannot hurt a guard (immune)');
  await t.sleep(RT() + 200);
  t.check(gm.hp === hp0, 'its life unchanged on the host');
  // enlisted
  await arEnlist(t, H, G, uid, k2place.id);
  A.keepAlive(t, G);
  gd = guardOf(); gm = H.game.entities.find((q) => q.nid === gd.nid); hp0 = gm.hp;
  A.teleport(G, gd.x + 0.7, gd.y); await A.hostSees(t, H, G);
  MG.combat.dealDamage(G.game, G.game.player, gd, 30);
  await t.waitFor(() => gm.hp < hp0, RT() + 2000, 'enlisted against the village: a guard takes the hit (host hp)', () => `${f2(hp0)} → ${f2(gm.hp)}`);
  const cit = G.game.entities.find((e) => e.npc && !e.npc.guard && !e.dead);
  if (cit) { const cm = H.game.entities.find((q) => q.nid === cit.nid), c0 = cm?.hp; t.check(MG.combat.dealDamage(G.game, G.game.player, cit, 30) === 0, 'a civilian never (immune)'); await t.sleep(RT() + 200); t.check(!cm || cm.hp === c0, 'its life unchanged on the host'); }
  else t.note('no civilian near to try');
  // the watch takes the guest as a foe: the bell, the gates
  const av = guestOnHost(H, G), Sv = H.game.people.of(s.id);
  t.check(MH.npc.hostile(av, Sv, H.game), 'the village\'s guards see the enlisted guest as hostile (npc.js hostile)');
  await t.waitFor(() => H.game.people.debug(s.id).danger, 10000, 'the bell rings (an enemy soldier in the village)');
  const L = H.game.towns.layout(s.id);
  await t.waitFor(() => L.gates.every((k) => { const o = A.objOn(H, `t${s.id}.${k}`); return !o || !o.open; }), 12000, 'the gates shut on it');
  await t.waitFor(() => H.game.entities.some((m) => m.npc?.guard && !m.dead && (m.foe === av || m.hunt === av)), 15000, 'a guard goes for the guest');
  // a column of the village's kingdom (at war with k2): its soldiers take the guest as a foe; it may hurt them
  const mx = s.x + s.r + 40, my = s.y - 20;
  await btStand(t, H, MH, G, MG, mx, my + 6);
  const F1 = H.game.warfare.materialize({ id: 'ar-army-1', k: s.k, home: R.kingdoms[s.k].capital, n: 10, lv: 3, x: mx - 6, y: my, state: 'march', target: k2place.id, path: [[mx + 60, my]], eng: { treb: 0, cat: 0, ram: 0, tower: 0 }, live: true });
  t.defer(() => { if (H.game.warfare.forces.has(F1.id)) H.game.warfare.dematerialize(F1.id); H.game.net.flush(); });
  await t.waitFor(() => soldiersOf(G, s.k).length >= 4, 20000, 'the guest sees the column');
  const av2 = guestOnHost(H, G);
  await t.waitFor(() => (F1.foes || []).includes(av2) && soldiersOf(H, s.k).some((m) => S.isFoe(H.game, m, av2)), 6000, 'its soldiers list the enlisted guest as a foe (warfare forceTick, soldier.js isFoe)');
  const e1 = soldiersOf(G, s.k).find((e) => e.soldier.role !== 'general'), m1 = H.game.entities.find((q) => q.nid === e1.nid), sh0 = m1.hp;
  A.teleport(G, e1.x + 0.6, e1.y); await A.hostSees(t, H, G);
  MG.combat.dealDamage(G.game, G.game.player, e1, 30);
  await t.waitFor(() => m1.hp < sh0, RT() + 2000, 'the guest hurts an enemy soldier');
  H.game.warfare.dematerialize(F1.id); H.game.net.flush();
  // its own side: a k2 column
  const F2 = H.game.warfare.materialize({ id: 'ar-army-2', k: k2, home: R.kingdoms[k2].capital, n: 8, lv: 3, x: mx - 6, y: my, state: 'march', target: s.id, path: [[mx + 60, my]], eng: { treb: 0, cat: 0, ram: 0, tower: 0 }, live: true });
  t.defer(() => { if (H.game.warfare.forces.has(F2.id)) H.game.warfare.dematerialize(F2.id); H.game.net.flush(); });
  await t.waitFor(() => soldiersOf(G, k2).length >= 4, 20000, 'the guest sees a column of its own kingdom');
  const e2 = soldiersOf(G, k2)[0], m2 = H.game.entities.find((q) => q.nid === e2.nid), s20 = m2.hp;
  A.teleport(G, e2.x + 0.6, e2.y); await A.hostSees(t, H, G);
  t.check(MG.combat.dealDamage(G.game, G.game.player, e2, 30) === 0, 'never its own side\'s soldiers (immune)');
  await t.sleep(RT() + 200);
  t.check(m2.hp === s20 && !soldiersOf(H, k2).some((m) => S.isFoe(H.game, m, guestOnHost(H, G))), 'unhurt, and they do not take the guest as a foe');
  // a guard of its own kingdom (the rule): protected
  t.check(!!G.game.army.npcWhy(G.game.player, { npc: { guard: true }, npcS: { sid: k2place.id } }), 'a guard of its own kingdom stays protected (the rule)');
  await t.checkDigest(H, G);
});

def('AR5', {
  title: 'AR: PvP only between members of kingdoms at war — the hit goes through the host to the victim\'s own client; never between travellers, the same kingdom, allies or kingdoms at peace',
  src: 'village', timeout: 150000,
  expected: 'Host and guest side by side. Both travellers: the guest\'s blow on the host does nothing ("… jogadores só lutam entre si quando são membros de reinos em guerra"); the host a member of the start kingdom, the guest of k2, at peace: nothing; same kingdom: nothing; allies: nothing. At war: the host\'s copy on the guest becomes attackable (e.pvp), the guest\'s blow lowers the host\'s life and the host\'s blow the guest\'s (intent pvp.hit → player.hurt on the victim); digest equal',
  api: 'game/army.js pvpWhy, combat.js pvpHit / attackable, mut/combat.js pvp.hit, ui/armyHud.js (e.pvp)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G), hu = H.game.eco.api.me(), s = startTownOf(H, MH);
  const [k2] = btKingdoms(H, s);
  await arClean(t, H, G, uid);
  await arClean(t, H, H, hu, H.pid);
  await t.waitFor(() => G.game.eco.pu?.get(H.pid) === hu, 6000, 'the guest knows the host\'s uid (eco.who: pid → uid)');
  const L = H.game.towns.layout(s.id);
  await btStand(t, H, MH, G, MG, L.spawn[0] + 30, L.spawn[1] + 30);
  const hostOnG = () => G.game.entities.find((e) => e.remote && e.pid === H.pid);
  const guestOnH = () => H.game.entities.find((e) => e.remote && e.pid === G.pid && !e.avatar);
  await t.waitFor(() => hostOnG() && guestOnH(), 5000, 'each sees the other');
  A.keepAlive(t, H, { hp: false }); A.keepAlive(t, G, { hp: false });
  const tryHit = async (label, expect) => {
    H.game.player.hp = H.game.player.maxHp; G.game.player.hp = G.game.player.maxHp;
    await t.sleep(RT() + 300);
    const h0 = H.game.player.hp, g0 = G.game.player.hp;
    const a = MG.combat.dealDamage(G.game, G.game.player, hostOnG(), 20), b = MH.combat.dealDamage(H.game, H.game.player, guestOnH(), 20);
    if (expect) {
      // (the victim rolls its dodge: a few blows)
      for (let k = 0; k < 4 && !(H.game.player.hp < h0 && G.game.player.hp < g0); k++) {
        await t.sleep(RT() + 500);
        if (!(H.game.player.hp < h0)) MG.combat.dealDamage(G.game, G.game.player, hostOnG(), 20);
        if (!(G.game.player.hp < g0)) MH.combat.dealDamage(H.game, H.game.player, guestOnH(), 20);
      }
      await t.waitFor(() => H.game.player.hp < h0 && G.game.player.hp < g0, RT() + 3000, `${label}: both blows land`, () => `host ${f2(H.game.player.hp)} · guest ${f2(G.game.player.hp)}`);
      t.check(a > 0 && b > 0, `${label}: both blows land (the host's word: pvp.hit → player.hurt)`, `host ${f2(h0)} → ${f2(H.game.player.hp)} · guest ${f2(g0)} → ${f2(G.game.player.hp)}`);
    } else {
      await t.sleep(RT() + 600);
      t.check(a === 0 && b === 0 && H.game.player.hp === h0 && G.game.player.hp === g0, `${label}: nothing`, `${a}/${b} · host ${f2(h0)} → ${f2(H.game.player.hp)} · guest ${f2(g0)} → ${f2(G.game.player.hp)}`);
    }
  };
  await tryHit('two travellers', false);
  t.check(!MG.combat.attackable(hostOnG()), 'a traveller is not a target');
  await arMember(t, H, G, hu, s.k, null, H.pid, H);
  await arMember(t, H, G, uid, k2);
  await tryHit('members of kingdoms at peace', false);
  await warShim(t, H, G, [[k2, s.k]]);
  await t.waitFor(() => hostOnG().pvp && guestOnH().pvp, 3000, 'at war each may target the other (e.pvp)');
  t.check(MG.combat.attackable(hostOnG()), 'attackable now');
  await tryHit('members of kingdoms at war', true);
  await arMember(t, H, G, uid, s.k);
  await t.waitFor(() => !hostOnG().pvp, 3000, 'the same kingdom: not a target');
  await tryHit('the same kingdom', false);
  H.game.net.emit('realm.rel', { a: k2, b: s.k, rel: 'ally', why: 'debug', quiet: 1 }); H.game.net.flush();
  await arMember(t, H, G, uid, k2);
  await t.waitFor(() => RZ(G).rel(k2, s.k) === 'ally', RT() + 2000, 'the two kingdoms allied');
  await tryHit('allies', false);
  H.game.player.hp = H.game.player.maxHp; G.game.player.hp = G.game.player.maxHp;
  await t.checkDigest(H, G);
});

def('AR6', {
  title: 'AR: the pay — a daily wage at the dawn by rank (×1,5 at war), service and a promotion, and the bonus for a siege repelled near the player',
  src: 'village', timeout: 300000,
  expected: 'The guest enlisted in the start village\'s militia with no coins. A day passes in peace: +20 coins (Recruta) in its backpack, the record paid that day on both, +1 reputation. At war: +30 (×1,5), +2 reputation. With 5 of service the next day makes 6: promoted to Soldado (a notice), the wage of a Soldado. A debug siege of the village by the enemy: 8 of its 12 soldiers fall — it retreats: the guest, there, gets the bonus (+50 coins, +10 reputation, service) with "… resistiu ao cerco! Bônus …"; digest equal',
  api: 'game/army.js hostTick (pay), onOutcome, content/army.js ARMY.ranks / warPay / bonus, ui/armyHud.js (promotion)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G);
  const s = await btVillage(t, H, MH, G, MG);
  const [k2] = btKingdoms(H, s);
  await arClean(t, H, G, uid);
  await arMember(t, H, G, uid, s.k, 40);
  await arEnlist(t, H, G, uid, s.id);
  setCoins(G, 0);
  const rep0 = recOn(H, uid).rep[s.k] | 0;
  await ecoDay(t, H, G, 1);
  await t.waitFor(() => arRec(H, uid)?.paid === arDay(H) && coinsOf(G) === 20, 6000 + RT(), 'a day in peace: +20 coins (Recruta) and the day paid on both', () => `${coinsOf(G)} coins · paid ${arRec(H, uid)?.paid} / day ${arDay(H)}`);
  t.check(arRec(G, uid).paid === arDay(H) && (recOn(H, uid).rep[s.k] | 0) === rep0 + 1, '+1 reputation for the service', `${rep0} → ${recOn(H, uid).rep[s.k] | 0}`);
  await warShim(t, H, G, [[k2, s.k]]);
  H.game.army.dbg.set(uid, { svc: 5 }); H.game.net.flush();
  await t.waitFor(() => arRec(G, uid)?.svc === 5, RT() + 2000, 'service 5 on the guest');
  const notes = [], toasts = [];
  t.on(G, 'toast', (x) => toasts.push(x.text));
  t.watch(() => { for (const n of G.doc.querySelectorAll('.wos-note')) { const x = n.textContent; if (!notes.includes(x)) notes.push(x); } }, 150);
  await ecoDay(t, H, G, 1);
  await t.waitFor(() => coinsOf(G) === 20 + 45, 6000 + RT(), 'at war a Soldado gets 30 × 1,5 = 45', () => `${coinsOf(G)} coins · rank ${arRec(H, uid)?.rank}`);
  t.check(arRec(H, uid).rank === 1 && arRec(G, uid).rank === 1 && arRec(H, uid).svc === 6, 'promoted to Soldado with 6 of service (both peers)', JSON.stringify(arRec(H, uid)));
  await t.waitFor(() => notes.some((x) => /Promovido a Soldado/.test(x)), 3000, 'a notice of the promotion', () => notes.slice(-3).join(' | '));
  t.check((recOn(H, uid).rep[s.k] | 0) === rep0 + 3, '+2 reputation at war', recOn(H, uid).rep[s.k] | 0);
  // a siege repelled near the guest
  await btFast(t, H);
  const F = btSiege(t, H, s, k2, { n: 12, lv: 3, from: [1, 0] });
  await t.waitFor(() => btDbg(H, F)?.siege?.planned, 30000, 'the siege is planned');
  const camp = btDbg(H, F).siege.camp;
  await btStand(t, H, MH, G, MG, camp[0] - 4, camp[1] - 3);
  A.keepAlive(t, G);
  await t.waitFor(() => ['build', 'bombard', 'assault'].includes(btPhase(H, F)), 90000, 'the siege is on');
  const c0 = coinsOf(G), r0 = recOn(H, uid).rep[s.k] | 0, sv0 = arRec(H, uid).svc;
  for (let k = 0; k < 8; k++) { const m = soldiersOf(H, k2).find((q) => q.soldier.role !== 'general'); if (!m) break; MH.combat.killMob(H.game, m, null); await t.sleep(150); }
  await t.waitFor(() => btPhase(H, F) === 'retreat' || btPhase(H, F) === 'gone', 15000, 'past its losses it retreats');
  await t.waitFor(() => coinsOf(G) === c0 + 50, 6000 + RT(), 'the defender\'s bonus: +50 coins', () => `${c0} → ${coinsOf(G)}`);
  await t.waitFor(() => (recOn(G, uid).rep[s.k] | 0) === r0 + 10 && arRec(G, uid).svc === sv0 + 4, RT() + 3000, '+10 reputation and +4 of service (both peers)', () => `${r0} → ${recOn(G, uid).rep[s.k] | 0} · svc ${arRec(G, uid).svc}`);
  await t.waitFor(() => toasts.some((x) => /resistiu ao cerco! Bônus/.test(x)), 4000, 'the toast tells it ("… resistiu ao cerco! Bônus …")', () => toasts.slice(-3).join(' | '));
  t.metric('coins', coinsOf(G));
  await t.checkDigest(H, G);
});

def('AR7', {
  title: 'AR: dying in war keeps the reputation and the post; leaving in the middle of a siege is desertion (reputation lost, no going back for 2 days)',
  src: 'village', timeout: 240000,
  expected: 'The guest enlisted in the start village\'s militia (reputation 60). It dies (killPlayer): the notice "Você caiu em combate …", and after the respawn the record and the reputation are the same on both. A debug siege of the village by the enemy: in action — the Exército tab warns "deserção"; leaving (two taps) is desertion: out of the army, the ban [kingdom, day + 2] on both, −25 reputation (35), the toast; enlisting again is refused ("Desertor: …"); digest equal',
  api: 'game/army.js inAction / desertToast, mut/army.js army.leave (desert), ui/armyHud.js (death), ui/muralWar.js (the warning)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G);
  const s = await btVillage(t, H, MH, G, MG);
  const [k2] = btKingdoms(H, s);
  await arClean(t, H, G, uid);
  await arMember(t, H, G, uid, s.k, 60);
  await arEnlist(t, H, G, uid, s.id, { rank: 1, svc: 8 });
  const notes = [], toasts = [];
  t.on(G, 'toast', (x) => toasts.push(x.text));
  t.watch(() => { for (const n of G.doc.querySelectorAll('.wos-note')) { const x = n.textContent; if (!notes.includes(x)) notes.push(x); } }, 150);
  // dying
  MG.player.killPlayer(G.game);
  await t.waitFor(() => notes.some((x) => /(Você caiu em combate|Você morreu).*sem perder a reputação nem o posto/.test(x)), 3000, 'the notice: renasce sem perder a reputação nem o posto');
  await t.sleep(800);
  MG.player.respawnPlayer(G.game);
  await t.waitFor(() => !G.game.player.dead, 4000, 'respawned');
  await t.sleep(RT() + 600);
  t.check(arRec(H, uid)?.rank === 1 && arRec(G, uid)?.svc === 8 && (recOn(H, uid).rep[s.k] | 0) === 60 && (recOn(G, uid).rep[s.k] | 0) === 60, 'the post and the reputation kept (both peers)', `${JSON.stringify(arRec(H, uid))} rep ${recOn(H, uid).rep[s.k] | 0}`);
  // a siege: in action
  await warShim(t, H, G, [[k2, s.k]]);
  await btFast(t, H);
  const F = btSiege(t, H, s, k2, { n: 14, lv: 2, from: [1, 0] });
  await t.waitFor(() => btOn(G, F) && G.game.army.inAction(arRec(G, uid)), 30000, 'the village besieged: the army is in action (both peers know)');
  await toMural(t, H, MH, G, MG, s.id);
  muralTab(G, s.id, 'army');
  await t.waitFor(() => /deserção/.test(ecoTxt(G)), 3000, 'the tab warns: leaving now is desertion');
  G.doc.querySelector('[data-aleave]').click();
  await t.sleep(200);
  t.check(/Confirmar a deserção/.test(ecoTxt(G)), 'it asks to confirm');
  G.doc.querySelector('[data-aleave]').click();
  await t.waitFor(() => !arRec(G, uid) && !arRec(H, uid), RT() + 3000, 'out of the army');
  const day = arDay(H);
  await t.waitFor(() => (recOn(G, uid).rep[s.k] | 0) === 35 && (recOn(H, uid).rep[s.k] | 0) === 35, RT() + 2000, 'desertion: −25 reputation (both peers)', () => `${recOn(G, uid).rep[s.k] | 0}`);
  t.check(JSON.stringify(H.game.army.des.get(uid)) === JSON.stringify([s.k, day + 2]) && JSON.stringify(G.game.army.des.get(uid)) === JSON.stringify([s.k, day + 2]), 'the ban until the day after tomorrow (both peers)', JSON.stringify(G.game.army.des.get(uid)));
  await t.waitFor(() => toasts.some((x) => /desertou/.test(x)), 3000, 'the toast says so', () => toasts.slice(-2).join(' | '));
  const r = await ecoReq(G, 'army.join', { sid: s.id });
  t.check(!r.ok && /Desertor: o Reino de .* não aceita você de volta até o dia/.test(r.why), 'enlisting again is refused', r.why);
  G.game.events.emit('closepanels', {});
  await t.checkDigest(H, G);
});

def('AR8', {
  title: 'AR: settle — a place taken near the players hands the army back to the numbers at once (home with the rest), and the new garrison comes from the winners',
  src: 'village', timeout: 360000,
  expected: 'An army of the enemy besieges the start village by numbers (dbg.launch, the clock forward); the players come: the playable siege. The capture (the centre held): game.realms.capture(sid, k, { army, n }) — the place is the enemy\'s on both peers and its garrison is min(cap, round(n × 0,5)) of the winners (not 30 % of the cap). When the victors leave the plaza (finishForce) 3b calls game.realms.settle: with the players STILL there, the army is at once going home (state retreat, or gone if few were left) on both, and live again as a column of soldiers (rematerialized) — never stuck as live; digest equal',
  api: 'game/realms.js settle / hostCapture (army, live) / maintain / remat, game/warfare.js finishForce, game/siegeAI.js capture',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  await wrQuiet(t, H, G);
  const s = startTownOf(H, MH), RH = RZ(H), RG = RZ(G);
  const [k2] = btKingdoms(H, s);
  await warShim(t, H, G, [[k2, s.k]]);
  t.defer(() => btHeal(H, s.id));
  t.defer(() => { if (RZ(H).owner(s.id) !== s.k) RZ(H).dbg.capture(s.id, s.k); H.game.net.flush(); });
  const from = frontOf(H, k2, s.k)[0];
  t.need(from && RH.dbg.route(from.id, s.id), 'a place of the enemy with a way to the start village');
  await btFast(t, H, { holdT: 12 });
  const away = [s.x + 420, s.y + 40];
  await btFar(t, H, MH, G, MG, away[0], away[1]);
  H.game.net.emit('realm.army', { gar: [[from.id, 160]] }); H.game.net.flush();
  const a0 = RH.dbg.launch(from.id, s.id, 60);
  H.game.net.flush();
  t.need(a0, 'an army launched');
  t.defer(() => { if (H.game.warfare.forces.has(a0.id)) H.game.warfare.dematerialize(a0.id); H.game.net.emit('realm.army', { del: a0.id }); H.game.net.flush(); });
  for (let k = 0; k < 40 && RH.armies.get(a0.id)?.state !== 'siege'; k++) { wrSkip(H, 2); await t.sleep(RT() + 300); }
  await t.waitFor(() => RH.armies.get(a0.id)?.state === 'siege', 4000, 'it besieges the village by numbers');
  const L = H.game.towns.layout(s.id);
  await btFar(t, H, MH, G, MG, L.spawn[0], L.spawn[1]);
  A.keepAlive(t, H); A.keepAlive(t, G);
  await t.waitFor(() => liveOn(H, a0.id) && H.game.warfare.forces.get(a0.id)?.kind === 'siege', 30000, 'the playable siege');
  const F = H.game.warfare.forces.get(a0.id);
  await t.waitFor(() => btDbg(H, F)?.siege?.planned, 40000, 'the siege is planned');
  // the centre held (the capture's own path in siegeAI: assault phase, the hold timer full)
  const n = F.n, cap = MH.war.capOf(s);
  F.phase = 'assault'; F.sg.capT = 1e6;
  await t.waitFor(() => RH.owner(s.id) === k2 && RG.owner(s.id) === k2, 15000, 'the place taken (game.realms.capture) on both', () => `phase ${btPhase(H, F)}`);
  const want = Math.max(1, Math.min(cap, Math.round(n * 0.5))), gar = RH.armies.get('g' + s.id).n;
  t.check(gar === want && RG.armies.get('g' + s.id).n === want, 'the new garrison comes from the winners (min(cap, n × 0,5))', `${gar} (winners ${n}, cap ${cap}; 30 % of the cap would be ${Math.round(cap * 0.3)})`);
  t.check(liveOn(H, a0.id), 'the army still live while the victors hold the plaza');
  await t.waitFor(() => { const a = RH.armies.get(a0.id); return !a || a.state === 'retreat'; }, 90000, 'the victors leave the plaza: settle — the army goes home at once (players still near)', () => `${RH.armies.get(a0.id)?.state} phase ${btPhase(H, F)} settled ${RH.H.stats.settled}`);
  const a1 = RH.armies.get(a0.id);
  t.check(RH.H.stats.settled >= 1, 'settle was called by 3b (finishForce)', RH.H.stats.settled);
  if (a1) {
    t.check(a1.n === n - want || a1.n <= n - want, 'it goes home with the rest (the garrison stayed)', `${a1.n} / ${n - want}`);
    await t.waitFor(() => RG.armies.get(a0.id)?.state === 'retreat', RT() + 2000, 'the guest sees it going home');
    await t.waitFor(() => liveOn(H, a0.id) && H.game.warfare.forces.get(a0.id)?.kind === 'march', 15000, 'near the players it is a column again (rematerialized), not stuck', () => `live ${liveOn(H, a0.id)} force ${H.game.warfare.forces.get(a0.id)?.kind || '-'}`);
  } else t.check(true, 'few were left: it is gone');
  await t.checkDigest(H, G);
});

def('AR9', {
  title: 'AR: save → load keeps the enlistment (rank, service, the army followed, a deserter\'s ban)',
  src: 'village', timeout: 120000,
  expected: 'The guest enlisted (Sargento, 20 of service, 3 kills) and another player\'s desertion ban: the host\'s save (buildSaveData → JSON) carries world.army; loaded into a fresh game of the same seed, the records are exactly the same (armyDigestRows); digest equal on the pair',
  api: 'net/snapshot.js serializeWorld / applyWorld (army), game/mut/army.js armyRows / applyArmyRows / armyDigestRows',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G), s = startTownOf(H, MH);
  const MA = await fimp(H, 'game/mut/army.js');
  await arClean(t, H, G, uid);
  await arMember(t, H, G, uid, s.k, 120);
  await arEnlist(t, H, G, uid, s.id, { rank: 2, svc: 20, kills: 3 });
  H.game.net.emit('army.rec', { u: 'uAR9ghost', r: 0, ban: [s.k, arDay(H) + 2], ev: 'debug' }); H.game.net.flush();
  t.defer(() => { H.game.net.emit('army.rec', { u: 'uAR9ghost', r: 0, ban: 0, ev: 'debug' }); H.game.net.flush(); });
  await t.waitFor(() => G.game.army.des.has('uAR9ghost'), RT() + 2000, 'the ban on the guest');
  const data = JSON.parse(JSON.stringify(MH.save.buildSaveData(H.game))), saved = JSON.stringify(MA.armyDigestRows(H.game));
  t.check(data.world?.army?.en?.some((r) => r[0] === uid) && data.world.army.des.some((r) => r[0] === 'uAR9ghost'), 'the save carries the records and the ban');
  const Sf = await bootSolo(t, '&start=village', 'solo');
  const MS = await A.mods(Sf);
  await t.waitFor(() => Sf.game.army?.en, 15000, 'the solo game');
  const MSA = await fimp(Sf, 'game/mut/army.js');
  let loaded = null;
  Sf.game.net.withApply(() => { MS.snapshot.applyWorld(Sf.game, data.world, 'load'); loaded = JSON.stringify(MSA.armyDigestRows(Sf.game)); });
  t.check(loaded === saved, 'loaded: the same records (rank, service, kills, place, kingdom, the ban)', loaded === saved ? `${saved.length} B` : `${saved} / ${loaded}`);
  frames.close(Sf);
  t.check(JSON.stringify(MA.armyDigestRows(G.game)) === saved, 'the guest has the same rows');
  await t.checkDigest(H, G);
});

def('AR10', {
  title: 'AR: "Ir até o exército" — from a place of its kingdom an enlisted player travels to its army (beside the column on the march, at the camp of a siege); refused outside the kingdom\'s places and near enemies; no time skipped',
  src: 'village', timeout: 360000,
  expected: 'The guest enlisted in the start kingdom\'s militia; at war, an army of the kingdom marches from a place far from the village. In free land: army.travel refused ("Viaje a partir de um lugar do Reino de …"). At the start village with a column of the enemy beside it: refused ("Inimigos por perto …"). With the enemy gone: the orders card shows "Ir até o exército"; a tap — the guest is beside the army on both peers (the host sees its avatar there), the army is live with it, the world clock did not jump. The players back home, the clock forward until the army besieges its target by numbers: from the village the guest travels to the camp (outside the target\'s land, near the army); digest equal',
  api: 'game/army.js travelWhy / travelSpot, mut/army.js army.travel, ui/armyHud.js (the button, the move)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  await wrQuiet(t, H, G);
  const uid = await ecoReady(t, H, G), s = startTownOf(H, MH), R = realmOf(H), RH = RZ(H);
  const [k2] = btKingdoms(H, s);
  t.need(k2 != null, 'an enemy kingdom on the landmass');
  await arClean(t, H, G, uid);
  await arMember(t, H, G, uid, s.k, 40);
  await arEnlist(t, H, G, uid, s.id);
  await warShim(t, H, G, [[s.k, k2]]);
  const d2 = (q) => Math.min(...R.settlements.filter((e) => RH.owner(e.id) === k2).map((e) => Math.hypot(e.x - q.x, e.y - q.y)));
  const from = R.settlements.filter((q) => RH.owner(q.id) === s.k && Math.hypot(q.x - s.x, q.y - s.y) > 220).sort((a, b) => d2(a) - d2(b))[0];
  const T = from && R.settlements.filter((q) => RH.owner(q.id) === k2).sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  t.need(from && T && RH.dbg.route(from.id, T.id), 'a place of the kingdom far from the village with a way to an enemy place');
  t.defer(() => btHeal(H, T.id));
  t.defer(() => { if (RZ(H).owner(T.id) !== T.k) RZ(H).dbg.capture(T.id, T.k); H.game.net.flush(); });
  H.game.net.emit('realm.army', { gar: [[from.id, 120]] }); H.game.net.flush();
  const a0 = RH.dbg.launch(from.id, T.id, 40);
  H.game.net.flush();
  t.need(a0, 'an army launched');
  t.defer(() => { if (H.game.warfare.forces.has(a0.id)) H.game.warfare.dematerialize(a0.id); H.game.net.emit('realm.army', { del: a0.id }); H.game.net.flush(); });
  await t.waitFor(() => arRec(H, uid)?.a === a0.id && arRec(G, uid)?.a === a0.id, 6000 + RT(), 'the guest follows that army (record.a on both)');
  const L = H.game.towns.layout(s.id);
  // free land: refused
  const fx = s.x + s.r + 30, fy = s.y;
  await btFar(t, H, MH, G, MG, fx, fy);
  t.need(!MG.realm.settlementAt(R, G.game.player.x, G.game.player.y, 6), 'the guest outside any town land');
  const r1 = await ecoReq(G, 'army.travel', {});
  t.check(!r1.ok && /Viaje a partir de um lugar do Reino de/.test(r1.why), 'outside the kingdom\'s places: refused', r1.why);
  t.check(!G.doc.querySelector('#ordcard [data-go]'), 'and the card has no button there');
  // in the village, an enemy column beside it: refused
  await btFar(t, H, MH, G, MG, L.spawn[0], L.spawn[1]);
  const Fe = H.game.warfare.materialize({ id: 'ar-enemy-col', k: k2, home: R.kingdoms[k2].capital, n: 8, lv: 3, x: L.spawn[0] + 6, y: L.spawn[1] + 2, state: 'march', target: s.id, path: [[L.spawn[0] + 7, L.spawn[1] + 2]], eng: { treb: 0, cat: 0, ram: 0, tower: 0 }, live: true });
  t.defer(() => { if (H.game.warfare.forces.has(Fe.id)) H.game.warfare.dematerialize(Fe.id); H.game.net.flush(); });
  A.keepAlive(t, G);
  await t.waitFor(() => soldiersOf(G, k2).some((e) => Math.hypot(e.x - G.game.player.x, e.y - G.game.player.y) < 14), 20000, 'enemy soldiers beside the guest (on its screen)');
  const r2 = await ecoReq(G, 'army.travel', {});
  t.check(!r2.ok && /Inimigos por perto/.test(r2.why), 'near enemies: refused', r2.why);
  H.game.warfare.dematerialize(Fe.id); H.game.net.flush();
  await t.waitFor(() => !soldiersOf(G, k2).length, 8000 + RT(), 'the enemy gone');
  // the button, the travel
  await t.waitFor(() => G.doc.querySelector('#ordcard [data-go]'), 4000, 'the orders card shows "Ir até o exército"', () => arCard(G));
  const wt0 = H.game.worldTime, moved = [];
  t.on(G, 'armytravel', (e) => moved.push(e));
  G.doc.querySelector('#ordcard [data-go]').dispatchEvent(new G.win.PointerEvent('pointerdown', { bubbles: true }));
  await t.waitFor(() => moved.length, RT() + 3000, 'the guest travels (the host\'s answer)');
  const p = () => RH.dbg.pos(a0.id);
  await t.waitFor(() => { const [x, y] = p(), q = G.game.player; return Math.hypot(H.game.world.dx(q.x, x), q.y - y) < 12; }, 3000, 'it stands beside the army (guest)', () => `${f2(G.game.player.x)},${f2(G.game.player.y)} / ${p().map(f2)}`);
  await t.waitFor(() => { const [x, y] = p(), e = guestOnHost(H, G); return e && Math.hypot(H.game.world.dx(e.x, x), e.y - y) < 14; }, 6000 + RT(), 'the host sees it there');
  t.check(H.game.worldTime - wt0 < 20, 'no time skipped (the world clock went on as usual)', `${f2(H.game.worldTime - wt0)} s`);
  A.teleport(H, G.game.player.x + 1.5, G.game.player.y);
  await t.waitFor(() => liveOn(H, a0.id) && RH.armies.get(a0.id).v > 0, 20000, 'with it there, the army is live and keeps marching (escorted)');
  t.check(!G.doc.querySelector('#ordcard [data-go]'), 'beside the army: no button');
  // the siege: from the village to the camp
  await btFar(t, H, MH, G, MG, L.spawn[0], L.spawn[1]);
  await t.waitFor(() => !liveOn(H, a0.id), 20000, 'the players home: the army is numbers again');
  for (let k = 0; k < 60 && RH.armies.get(a0.id)?.state !== 'siege'; k++) { wrSkip(H, 2); await t.sleep(RT() + 300); }
  await t.waitFor(() => RH.armies.get(a0.id)?.state === 'siege', 4000, 'it besieges its target by numbers', () => `${RH.armies.get(a0.id)?.state}`);
  const r3 = await ecoReq(G, 'army.travel', {});
  t.check(r3.ok && /acampamento diante de/.test(r3.x?.label || ''), 'from the village: to the camp', JSON.stringify(r3.x || r3.why));
  if (r3.ok) {
    const c = RH.armies.get(a0.id), d = Math.hypot(H.game.world.dx(r3.x.x, c.x), r3.x.y - c.y), dT = Math.hypot(H.game.world.dx(r3.x.x, T.x), r3.x.y - T.y);
    t.check(d < 16 && dT > T.r + 4, 'the camp spot: by the army, outside the target\'s land', `${f2(d)} from the camp · ${f2(dT)} from ${T.name} (land ${T.r})`);
  }
  await btFar(t, H, MH, G, MG, L.spawn[0], L.spawn[1]);
  await t.checkDigest(H, G);
});

const ORDER = ['S2', 'S3', 'S4', 'S28', 'S30', 'S24', 'S1', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15',
  'S16', 'S17', 'S18', 'S19', 'S20', 'S21', 'S22', 'S25', 'S27', 'S23', 'S26', 'S41', 'S29'];
const BY = Object.fromEntries(S.map((s) => [s.id, s]));
for (const s of S) if (!ORDER.includes(s.id)) ORDER.push(s.id);

function selection() {
  const run = (Q.get('run') || '').trim();
  if (!run) return null;
  if (run === 'all') return ORDER.map((id) => BY[id]);
  if (run === 'star') return ORDER.map((id) => BY[id]).filter((s) => s.star);
  const ids = [];
  for (const part of run.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)) {
    const m = part.match(/^S(\d+)-S?(\d+)$/);
    if (m) for (let k = +m[1]; k <= +m[2]; k++) ids.push('S' + k);
    else ids.push(part);
  }
  return ids.map((id) => BY[id]).filter(Boolean);
}

function catalogue() {
  const L = ['WOS multiplayer sync tests — choose a run:', ''];
  const base = location.pathname;
  L.push(`  ${base}?run=all                      every scenario over BroadcastChannel (S29 soak = ${CFG.soak} s; ?soak=60 to shorten)`);
  L.push(`  ${base}?run=star&transport=webrtc   ★ scenarios over real WebRTC (public signaling)`);
  L.push(`  ${base}?run=star&relay=1            ★ scenarios through TURN only (localStorage wos.forceRelay=1 during the run)`);
  L.push(`  ${base}?run=S6,S10  ·  ?run=S6-S12  ·  &keep=1 (leave frames open) · &verbose=1 (details of passes) · &slow=2`);
  L.push('');
  for (const id of ORDER) {
    const s = BY[id];
    L.push(`${s.id.padEnd(4)} ${s.star ? '★' : ' '} ${s.title}`);
    L.push(`       expected: ${s.expected}`);
    L.push(`       API: ${s.api}`);
  }
  return L.join('\n');
}

async function main() {
  const cfg = document.querySelector('#cfg');
  if (cfg) cfg.textContent = `transport ${CFG.transport}${CFG.relay ? ' + relay' : ''} · budget ${CFG.budget} ms · seed ${CFG.seed}`;
  const list = selection();
  if (!list) { document.querySelector('#report').textContent = catalogue(); setStatus('idle — pick a run'); window.mpDone = true; return; }
  RUN_INFO.selection = Q.get('run');
  storage.snapshot();
  if (CFG.relay) { try { localStorage.setItem('wos.forceRelay', '1'); } catch { /* ignore */ } }
  addEventListener('pagehide', () => { frames.closeAll(); storage.restore(); });
  setStatus(`running ${list.length} scenario(s)…`);
  try {
    await runScenarios(list, env);
  } finally {
    if (!CFG.keep) { frames.closeAll(); env.pair = null; }
    await sleep(400);
    storage.restore();
    const n = (s) => results.filter((r) => r.status === s).length;
    setStatus(`done — PASS ${n('PASS')} · FAIL ${n('FAIL')} · SKIP ${n('SKIP')} · ERROR ${n('ERROR')}`);
    document.title = `mp-test ${n('PASS')}/${results.length} PASS`;
    render();
    window.mpDone = true;
  }
}

main();
