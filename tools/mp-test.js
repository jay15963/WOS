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
  // deterministic camps
  const camps = (f) => (f.game.camps || []).map((c) => (c.objects || []).map((o) => String(o.id)));
  const ch = camps(H), cg = camps(G);
  t.check(ch.length && JSON.stringify(ch) === JSON.stringify(cg), 'camp object ids identical', `host ${short(ch, 140)} · guest ${short(cg, 140)}`);
  t.check(ch.flat().every((id) => /^camp\d+:\d+$/.test(id)), "camp ids are deterministic ('camp<i>:<k>')", short(ch.flat().slice(0, 6)));
  const props = (f) => (f.game.props || []).map((o) => String(o.id)).join(',');
  t.check(props(H) === props(G), 'crate (prop) ids identical', `${(H.game.props || []).length} props`);
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
  await t.sleep(6000);
  const ratios = [];
  pairs.forEach(([m, p], i) => {
    const dm = m.moveT - s0[i][0], dp = p.moveT - s0[i][1];
    if (dm >= 0.5 && !m.dead) ratios.push({ nid: m.nid, sp: m.species, dm: f2(dm), dp: f2(dp), r: dp / dm, tiles: f2(Math.hypot(m.x - s0[i][2], m.y - s0[i][3])) });
  });
  t.metric('mobRatios', ratios.slice(0, 8).map((r) => `${r.sp}:${f2(r.r)}`).join(' '));
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
  const solid = (f) => site.tiles.map(([x, y]) => f.game.world.solid[f.game.world.idx(x, y)]);
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
  api: 'chest panel [data-slot] click (chest.put intent → chest.set); toggleDecon (build.decon → struct.decon); decon work (decon.hit → struct.remove {refund, drops}); o.store',
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
  const solid = () => `${H.game.world.solid[di]} / ${G.game.world.solid[di]}`;
  const doorG = () => A.structOn(G, door.id);
  t.check(!door.open && !doorG()?.open && H.game.world.solid[di] === 1 && G.game.world.solid[di] === 1, 'finished door starts closed (solid 1 on both)', `open ${door.open}/${doorG()?.open} · solid ${solid()}`);
  // nobody passes a closed door (it never opens by itself)
  A.teleport(H, dx + 0.5, y0 - 1.1);
  { const rel = A.holdMove(H, 0, 1); await t.sleep(900); rel(); }
  t.check(hp.y < y0 + 0.05 && !door.open, 'host cannot walk through the closed door (no auto-open)', `host y ${f2(hp.y)} · open ${door.open}`);
  A.teleport(H, dx + 4.5, y0 + 3.5);
  // the guest opens it with an explicit action
  A.teleport(G, dx + 0.5, y0 - 0.95);
  await A.hostSees(t, H, G);
  A.useDoor(G, MG, doorG());
  const ms = await t.timeTo(() => door.open && doorG()?.open && H.game.world.solid[di] === 0 && G.game.world.solid[di] === 0, RT() + 400, 'door open on both (solid 0)', () => `open ${door.open}/${doorG()?.open} · solid ${solid()}`);
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
  await t.waitFor(() => !door.open && !doorG()?.open && H.game.world.solid[di] === 1 && G.game.world.solid[di] === 1, RT() + 400, 'door closed on both (solid 1)', () => `open ${door.open}/${doorG()?.open} · solid ${solid()}`);
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
  const list = A.oreTiles(H, MH, sp.x, sp.y).filter((c) => !env.claimed.has('ore' + c.i) && G.game.world.rock[c.i] === 1);
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
  const ev = A.edgeWatch(t, { h: () => H.game.world.rock[i] === 0, g: () => G.game.world.rock[i] === 0 });
  await A.mine(t, G, MG, tx, ty, { stand });
  await t.waitFor(() => H.game.world.rock[i] === 0, ONEWAY() + 300, 'tile mined on the host');
  await t.sleep(700);
  loot.stop();
  const GS = MG.worldgen.G?.STONE;
  for (const f of [H, G]) {
    const w = f.game.world;
    t.check(w.rock[i] === 0 && w.ore[i] === 0 && (GS == null || w.ground[i] === GS), `${f.label}: rock 0, ore 0, ground STONE`, `rock ${w.rock[i]} ore ${w.ore[i]} ground ${w.ground[i]}`);
    t.check(f.game.minedTiles?.includes(i), `${f.label}: minedTiles has the tile`);
  }
  let td = true;
  for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) {
    const k = H.game.world.idx(x, y) * 4;
    for (let b = 0; b < 4; b++) if (H.game.world.tileData[k + b] !== G.game.world.tileData[k + b]) td = false;
  }
  t.check(td, 'tile textures (tileData 3×3) identical');
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
  t.check(cmp.ok && (li.potato || 0) >= 3, 'harvest loot identical on both (potatoes + seeds)', `${cmp.detail} · ${short(li)}`);
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
  const crates = (H.game.props || []).filter((o) => !o.broken && !env.claimed.has('prop' + o.id)).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y));
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
  t.need(F && F.chunks?.length && 'ci' in F && 't' in F && typeof F.dyn?.keys === 'function', 'host flora internals (game.flora.ci/t/chunks/dyn) missing — cannot accelerate regrowth');
  const sp = spawnOf(H);
  const tr = A.pickTree(H, MH, G, sp.x + 10, sp.y, env.claimed, { r: 40 });
  t.assert(tr, 'found a tree');
  const o = tr.o, W = H.game.world, CH = 16;
  const k = Math.min(W.CH - 1, Math.floor(o.y / CH)) * W.CW + Math.min(W.CW - 1, Math.floor(o.x / CH));
  A.ensure(G, { axe_steel: 1 });
  A.teleport(G, tr.west[0], tr.west[1]);
  await A.chop(t, G, MG, A.objOn(G, o.id), { tool: 'axe_steel', until: 'stump' });
  t.log(`chunk ${k} now lacks a ${o.type}`);
  const cx = (k % W.CW) * CH + 8, cy = Math.floor(k / W.CW) * CH + 8;
  sendAway(H, MH, cx, cy, 42, 0); sendAway(G, MG, cx, cy, 44, 0.3);
  await t.sleep(300);
  const before = new Set(F.dyn.keys());
  const found = [];
  const t0 = now();
  while (now() - t0 < 45000) {
    F.ci = k; F.t = 0;
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
  t.check(g.world.solid[g.world.idx(wx, wy)] === 1, 'wall completed and solid');
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
    t.check(g.world.rock[c.i] === 0 && (it.stone || 0) >= 1, 'mining removes the rock and drops stone + ore', short(it));
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
    t.check((it.potato || 0) >= 3 && (it.potato || 0) <= 4, 'harvest yields 3–4 potatoes (+ seeds)', short(it));
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
  const sol = (f) => tiles.map(([x, y]) => f.game.world.solid[f.game.world.idx(x, y)]);
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
  const sol = (f) => [0, 1].map((k) => f.game.world.solid[f.game.world.idx(tx + k, ty)]);
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
    for (let yy = y; yy < y + 6 && ok; yy++) for (let xx = x; xx < x + 6 && ok; xx++) { const i = w.idx(xx, yy); if (w.rock[i] || w.water[i]) ok = false; }
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
  H.doc.querySelector(`[data-cslot="${wi}"]`)?.click();
  await t.waitFor(() => A.count(H, 'wood') >= wood0 + 7 && !content(bodyOn(G, ch.id)).wood, RT() + 600, 'host takes the wood (gone from the body on both)');
  const si = H.game.player.inv.slots.findIndex((q) => q && q.id === 'stone');
  H.doc.querySelector(`[data-slot="${si}"]`)?.click();
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
  const EH = H.game.env, gp = G.game.player;
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
  t.check(H.game.world.frozen && G.game.world.frozen, 'the water is frozen on both');
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
  const green = A.hostMobs(H, (m) => m.temper === 'passive' && !m.leaving).length;
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
  t.check(!H.game.world.solid[H.game.world.idx(hit.tx, hit.ty)] && !G.game.world.solid[G.game.world.idx(hit.tx, hit.ty)], 'the tile is open on both');
  await t.waitFor(() => m.state === 'chase' || m.state === 'siege', 6000, 'the walker comes in', () => m.state);
  // sunrise: it crumbles; the cracks left on the other walls settle
  for (const id of ids) { const o = H.game.build.structures.find((q) => q.id === id); if (o && !o.removed) { H.game.net.emit('struct.dmg', { id, d: 0.3, x: o.x + 1, y: o.y }); break; } }
  H.game.net.emit('env.skip', { hour: 6.8, day: 6, wt: H.game.worldTime + 1, by: H.game.net.pid });
  await t.waitFor(() => m.dead, 12000, 'the walker crumbles at sunrise');
  await t.waitFor(() => !H.game.build.structures.some((o) => o.dmg > 0) && !G.game.build.structures.some((o) => o.dmg > 0), 6000 + RT(), 'the cracks settle on both');
  await t.checkDigest(H, G);
  env.history.push('W2');
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
const roofIds = (f) => f.game.build.structures.filter((o) => o.roof).map((o) => o.id + ':' + o.style + (o.blueprint ? ':bp' : '')).sort();
const regionAt = (f, x, y) => { const R = f.game.roofs, w = f.game.world; return R.regions.get(R.regionOf[w.idx(x, y)]) || null; };

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
  const bro = (f) => { const w = f.game.world; let s = 0; for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 6; x++) s += w.broof[w.idx(x, y)] ? 1 : 0; return s; };
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
  title: 'J: mining a mountain open removes its natural roof identically on both', timeout: 150000,
  expected: 'Mined tiles keep the mountain roof while rock is within 6 tiles; opening a 14×14 box takes it off in the middle on both peers (world.roof bytes equal, roofAt / isCave equal per tile, the centre is open sky, tiles next to the remaining rock stay caves); a guest mining hit through rock.hit keeps them equal; digest equal',
  api: 'tile.mine → world.mineRock → _naturalRoof (world.roof, lastLost); world.roofAt / isCave; digest tiles part (roof, broof)',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const w = H.game.world, sp = spawnOf(H);
  // a solid mountain block (all rock, roof0 in the middle) closest to the spawn
  let best = null, bd = 1e9;
  for (let cy = 12; cy < w.H - 12; cy += 2) for (let cx = 12; cx < w.W - 12; cx += 2) {
    const i = w.idx(cx, cy);
    if (!w.rock[i] || !w.roof0[i]) continue;
    const d = Math.hypot(cx - sp.x, cy - sp.y);
    if (d >= bd) continue;
    let ok = true;
    for (let y = cy - 9; y < cy + 9 && ok; y++) for (let x = cx - 9; x < cx + 9; x++) if (!w.rock[w.idx(x, y)]) { ok = false; break; }
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
  for (let y = cy - 7; y < cy + 7; y++) for (let x = cx - 7; x < cx + 7; x++) if (w.rock[w.idx(x, y)]) H.game.net.emit('tile.mine', { tx: x, ty: y, drops: [], by: H.game.net.pid, xp: 0 });
  await t.waitFor(() => G.game.world.rock[G.game.world.idx(cx, cy)] === 0, RT() + 1000, 'guest has the mined box');
  await t.sleep(ONEWAY() + 300);
  const eqRoof = () => { const a = H.game.world.roof, b = G.game.world.roof; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };
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
  await t.waitFor(() => H.game.world.rock[w.idx(tx, ty)] === 0 && G.game.world.rock[w.idx(tx, ty)] === 0, RT() + 600, 'guest mining hit reached both');
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
  for (let cy = 14; cy < w.H - 14; cy += 2) for (let cx = 14; cx < w.W - 14; cx += 2) {
    const i = w.idx(cx, cy);
    if (!w.rock[i] || !w.roof0[i] || taken.some(([x, y]) => Math.hypot(x - cx, y - cy) < 30)) continue;
    const d = Math.hypot(cx - sp.x, cy - sp.y);
    if (d >= bd) continue;
    let ok = true;
    for (let y = cy - 12; y < cy + 12 && ok; y++) for (let x = cx - 12; x < cx + 12; x++) { const j = w.idx(x, y); if (!w.rock[j] || !w.roof0[j]) { ok = false; break; } }
    if (ok) { best = [cx, cy]; bd = d; }
  }
  t.need(best, 'needs a 24×24 solid mountain block in this seed');
  const [cx, cy] = best;
  env.claimed.add('mountain' + cx + ',' + cy);
  A.pacify(H, cx, cy, 30);
  A.keepAlive(t, G); A.keepAlive(t, H);
  // the hall around a pillar at (cx, cy): every tile stays within 6 of rock → one covered cave
  for (let y = cy - 10; y < cy + 10; y++) for (let x = cx - 10; x < cx + 10; x++) if ((x !== cx || y !== cy) && w.rock[w.idx(x, y)]) H.game.net.emit('tile.mine', { tx: x, ty: y, drops: [], by: H.game.net.pid, xp: 0 });
  await t.waitFor(() => G.game.world.rock[G.game.world.idx(cx - 9, cy - 9)] === 0, RT() + 1500, 'guest has the dug hall');
  await t.sleep(ONEWAY() + 400);
  const A_ = (f, x, y) => f.game.roofs.data[f.game.world.idx(x, y) * 4 + 3];
  const caveId = (f, x, y) => f.game.roofs.caveOf[f.game.world.idx(x, y)];
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
  await t.waitFor(() => G.game.world.rock[G.game.world.idx(cx, cy)] === 0, RT() + 1000, 'guest has the pillar mined');
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
  t.check(!data.world.lvs && g.build.structures.every((o) => !(o.lv > 0)), 'no structure level data needed (all lv 0; levels add no save version)', `v ${data.v}`);
  S.reload();
  await t.waitFor(() => S.loads >= 2 && S.game && S.loadingHidden && S.game !== g, CFG.bootMs, 'reloaded (1)');
  let p2 = S.game.player;
  t.check(p2.lv === 1 && p2.z === 1 && Math.hypot(p2.x - at[0], p2.y - at[1]) < 0.05, 'reloads standing on the rampart (lv 1)', `${lvOf(p2)} at ${f2(p2.x)},${f2(p2.y)}`);
  // an older build's save: no player z, plus a legacy 10-field wall row (v3)
  const old = JSON.parse(JSON.stringify(data));
  delete old.player.z;
  old.v = 3;
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
    if (G.game.world.inBounds(tx, ty) && !G.game.world.rock[G.game.world.idx(tx, ty)] && !LG.supportedL(tx, ty, 1, true)) far = [tx, ty];
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
    t.check(L.blk[1]?.[I(x + 1, y)] && L.blk[1]?.[I(x + 3, y + 1)] && !L.blk[1]?.[I(x + 1, y + 1)], `${nm}: upper walls and the closed upper door block story 1, the floor does not`);
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
  t.check(data.v === 9, 'save version 9 (L stories, after M\'s v8)', `v ${data.v}`);
  t.check(up.every((id) => lvs.get(id) === 1) && lvs.size === up.length, 'world.lvs lists every upper piece at story 1', `${lvs.size} rows`);
  t.check(data.player.z === 1, 'player z 1 saved');
  S.reload();
  await t.waitFor(() => S.loads >= 2 && S.game && S.loadingHidden && S.game !== g, CFG.bootMs, 'reloaded');
  const g2 = S.game, L2 = g2.levels;
  const back = up.map((id) => g2.build.structures.find((o) => o.id === id));
  t.check(back.every((o) => o && o.lv === 1 && !o.blueprint), 'every upper piece is back on story 1', short(back.map((o) => o ? `${o.type}@${o.lv}` : 'missing')));
  L2.sync();
  t.check(L2.storeysAt(x + 1, y + 1) === 2 && L2.isSurface(1, g2.world.idx(x + 1, y + 1)) && L2.blk[1]?.[g2.world.idx(x + 2, y)], 'the derived story-1 map is rebuilt (2 stories, floor surface, upper wall blocks)');
  const p2 = g2.player;
  t.check(p2.lv === 1 && p2.z === 1 && Math.hypot(p2.x - (x + 2.5), p2.y - (y + 2.5)) < 0.05, 'the player wakes up on the upper floor', `${lvOf(p2)} at ${f2(p2.x)},${f2(p2.y)}`);
  // a v8 save (M's terrain paths version, no stories) still loads
  const old = JSON.parse(JSON.stringify(data));
  old.v = 8; delete old.world.lvs; delete old.player.z;
  const ids = new Set(up);
  old.world.structs = old.world.structs.filter((r) => !ids.has(r[0]));
  g2.noSave = true; // the page would save itself again on pagehide
  S.win.localStorage.setItem(key, JSON.stringify(old));
  S.reload();
  await t.waitFor(() => S.loads >= 3 && S.game && S.loadingHidden && S.game !== g2, CFG.bootMs, 'reloaded (v8 save)');
  const g3 = S.game;
  t.check(g3.build.structures.some((o) => o.type === 'wall_wood' && o.tx === x && o.ty === y) && g3.build.structures.every((o) => !(o.lv > 0)), 'v8 save loads (ground floor only)', `${g3.build.structures.length} structures`);
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
  t.check(F.every(([h]) => H.game.world.solid[H.game.world.idx(h.tx, h.ty)] === 1), 'styled walls are solid like any wall');
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
    v: 4, seed: CFG.seed, savedAt: Date.now(), worldTime: 100, env: { hour: 10, day: 0, weather: 'clear' },
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
    S = t.open('solo-oldsave', `seed=${CFG.seed}&pid=k4solo`, 'k4solo');
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
  expected: 'Over a walled room the guest places roof plans with "Telha de barro" + hip ends / dormers / warm tone (Detalhes): same style + canonical det on both and the same derived painter style (roofArtStyle key); the style brush repaints the plans (slate + chimney) on both; once finished the roof is painted on both, the dormer tiles get a slope position (roofPropAt) and a restyle is refused; digest equal',
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
  placeStyled(G, MG, 'roof_stone', 'terracotta', 't_warm.dormer.end_hip', [x0 + 2, y0 + 1]);
  const want = KG.kits.cleanDet('roof_stone', 't_warm.dormer.end_hip');
  await t.waitFor(() => roofs(H).length >= 6 && roofs(G).length === roofs(H).length, RT() + 1200, 'roof plans for the room on both');
  const key = (f, K) => roofs(f).map((o) => `${o.id}:${o.style}:${o.det}:${K.kits.roofArtStyle(o)?.key || '-'}`).sort().join(' ');
  t.check(roofs(H).every((o) => o.style === 'terracotta' && o.det === want && o.blueprint), 'plans: terracotta + canonical det on the host', short(roofs(H).slice(0, 2).map(look)));
  t.check(key(H, KH) === key(G, KG), 'same plans, looks and derived painter style on both', short(key(G, KG), 160));
  t.check(/end_hip/.test(KH.kits.roofArtStyle(roofs(H)[0])?.key || '') && KH.kits.roofArtStyle(roofs(H)[0]).style.ends === 'hip', 'derived style turns hip ends on for J\'s painter', KH.kits.roofArtStyle(roofs(H)[0])?.key);
  // brush the plans to slate + chimney (dormers kept)
  const g = G.game;
  MG.building.setBuildLook(g, 'roof_stone', 'slate', 'chimney.dormer');
  MG.building.enterStyleBrush(g, 'roof_stone');
  MG.building.buildDragStart(g, x0 + 0.5, y0 + 0.5);
  MG.building.buildDragEnd(g, x0 + 4.5, y0 + 3.5);
  MG.building.exitBuildMode(g);
  const want2 = KG.kits.cleanDet('roof_stone', 'chimney.dormer');
  await t.waitFor(() => [H, G].every((f) => roofs(f).every((o) => o.style === 'slate' && o.det === want2)), RT() + 800, 'brushed to slate + chimney on both');
  // the host finishes them (test shortcut, like J's scenarios) → painted region on both
  for (const o of roofs(H)) H.game.net.emit('struct.complete', { id: o.id, by: H.game.net.pid, xp: 0 });
  await t.waitFor(() => roofs(G).every((o) => !o.blueprint) && regionAt(H, x0 + 2, y0 + 1)?.art && regionAt(G, x0 + 2, y0 + 1)?.art, 9000, 'roof finished and painted on both');
  const RG = await fimp(G, 'game/roofs.js');
  const pr = RG.roofPropAt(G.game, x0 + 2, y0 + 1);
  t.check(pr && pr.lift > 0.3 && Number.isFinite(pr.key), 'dormer tile has a slope position on the guest (roofPropAt)', JSON.stringify(pr));
  let refused = null;
  g.net.request('struct.style', { ids: [roofs(G)[0].id], type: 'roof_stone', style: 'stone', det: '' }, { onReject: (why) => { refused = why || 'refused'; } });
  await t.waitFor(() => refused, RT() + 600, 'finished roof: restyle refused');
  t.check(roofs(H).every((o) => o.style === 'slate') && roofs(G).every((o) => o.style === 'slate'), 'finished roof keeps its look on both');
  let drew = true; for (const f of [H, G]) { try { f.game.render(); } catch (e) { drew = false; t.log(e.message); } }
  t.check(drew, 'both render the styled roof with dormers');
  await t.checkDigest(H, G);
  env.history.push('K5');
});

// =====================================================================================================
// M1–M5 — painted terrain paths (agent M): shared path grid (world.path / world.pathPlan), intents path.plan / path.lay /
// path.dig → ops path.plan / path.set, digest part 'paths', snapshot / save rows
const frameImport = (f, p) => f.win.Function('u', 'return import(u)')(new URL('src/' + p, f.win.location.href).href);
const pathCells = (f, tiles) => tiles.map((i) => `${f.game.world.path[i]}/${f.game.world.pathPlan[i]}`).join(' ');
const gridHash = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; } return (h >>> 0).toString(36); };
// a straight row of `n` paintable tiles near (x, y), valid on both peers (MP = frame's mut/paths.js)
function pathRow(H, MP, x, y, n, { rMin = 2, rMax = 12, avoid = null } = {}) {
  const w = H.game.world;
  for (let r = rMin; r <= rMax; r++) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, x0 = Math.floor(x + Math.cos(a) * r), y0 = Math.floor(y + Math.sin(a) * r);
    const tiles = [];
    for (let d = 0; d < n; d++) {
      const tx = x0 + d, ty = y0, i = w.idx(tx, ty);
      if (!w.inBounds(tx, ty) || MP.canPaint(H.game, tx, ty) || w.path[i] || w.pathPlan[i] || (avoid && avoid(tx, ty))) break;
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
  const nextIdx = () => tiles.find((j) => w.pathPlan[j] && (code == null || w.pathPlan[j] === code));
  const next = () => { const i = nextIdx(); return i == null ? null : f.game.paths.jobAt(i % W, (i / W) | 0); };
  const stand = () => {
    const i = nextIdx();
    if (i == null) return;
    p.autoAttack = false; p.target = null; p._atkRootT = 0; p.rooted = false;
    const s = A.freeSpot(f, M, (i % W) + 0.5, ((i / W) | 0) + 0.5, { rMin: 0, rMax: 1.4 });
    if (s) A.teleport(f, s[0], s[1]);
  };
  await A.workUntil(t, f, next, () => tiles.every((j) => !w.pathPlan[j] || (code != null && w.pathPlan[j] !== code)), ms, 'works the planned path tiles', { retries: 12, stand });
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
  const ms = await t.timeTo(() => tiles.every((i) => H.game.world.pathPlan[i] === 1), RT() + 500, 'host has the 8 blueprints');
  t.metric('planRoundTripMs', Math.round(ms));
  await t.waitFor(() => tiles.every((i) => G.game.world.pathPlan[i] === 1), ONEWAY() + 400, 'guest has the 8 blueprints');
  t.check(pathCells(H, tiles) === pathCells(G, tiles), 'blueprint cells identical', pathCells(H, tiles));
  await layPaths(t, G, MG, tiles);
  await t.waitFor(() => tiles.every((i) => H.game.world.path[i] === 1 && !H.game.world.pathPlan[i]), ONEWAY() + 600, 'host has the 8 built dirt tiles');
  await t.sleep(ONEWAY() + 100);
  t.check(pathCells(H, tiles) === pathCells(G, tiles) && tiles.every((i) => G.game.world.path[i] === 1), 'built cells identical on both (type 1, no plan)', `host ${pathCells(H, tiles)} · guest ${pathCells(G, tiles)}`);
  const d = A.invDiff(inv0, A.invSnap(G));
  t.check(!Object.values(d).some((v) => v < 0), 'the dirt path is free (nothing left the guest bag)', short(d));
  // walking speed bonus on the path (owner side)
  const W = G.game.world.W, i0 = tiles[3];
  A.teleport(G, (i0 % W) + 0.5, ((i0 / W) | 0) + 0.5);
  await t.sleep(250);
  const onPath = gp.speed;
  const off = A.freeSpot(G, MG, (i0 % W) + 0.5, ((i0 / W) | 0) + 3.5, { rMin: 0, rMax: 2, avoid: (x, y) => !!G.game.world.path[G.game.world.idx(Math.floor(x), Math.floor(y))] });
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
  await t.waitFor(() => tiles.every((i) => G.game.world.pathPlan[i] === 2), RT() + 600, 'gravel blueprints on the guest');
  t.check(A.count(G, 'pebble') === peb0, 'blueprints are free (no pebble taken when painting)', `${peb0} → ${A.count(G, 'pebble')}`);
  await layPaths(t, G, MG, tiles);
  await t.waitFor(() => tiles.every((i) => w.path[i] === 2), ONEWAY() + 600, 'host has the 4 gravel tiles');
  t.check(A.count(G, 'pebble') === peb0 - 4, '1 pebble per tile left the bag when laid', `${peb0} → ${A.count(G, 'pebble')}`);
  // eraser on 2 tiles, deconstruct tool on the other 2
  G.game.paths.paint('remove', tiles.slice(0, 2));
  const n = MG.building.deconRect(G.game, tiles[2] % W, (tiles[2] / W) | 0, tiles[3] % W, (tiles[3] / W) | 0);
  t.check(n >= 2, 'the deconstruct tool marks painted path tiles', `${n} marked`);
  await t.waitFor(() => tiles.every((i) => w.pathPlan[i] === 15), RT() + 600, 'host has the 4 removal marks');
  await t.waitFor(() => tiles.every((i) => G.game.world.pathPlan[i] === 15), ONEWAY() + 400, 'guest has the 4 removal marks');
  await layPaths(t, G, MG, tiles, { code: 15 });
  await t.waitFor(() => tiles.every((i) => !w.path[i] && !w.pathPlan[i]), ONEWAY() + 600, 'host: the 4 gravel tiles are gone');
  await t.sleep(ONEWAY() + 100);
  t.check(pathCells(H, tiles) === pathCells(G, tiles), 'cells identical after removal', `host ${pathCells(H, tiles)} · guest ${pathCells(G, tiles)}`);
  t.check(A.count(G, 'pebble') === peb0 - 4 + 3, '75% of the pebbles came back (3 of 4)', `${A.count(G, 'pebble')} (start ${peb0})`);
  // part of the M1 dirt path: erase 3 tiles; a blueprint under the eraser is cancelled at once (no work)
  const old = (env.pathTiles || []).filter((i) => w.path[i] === 1);
  if (old.length >= 4) {
    const part = old.slice(0, 3);
    G.game.paths.paint('remove', part);
    await t.waitFor(() => part.every((i) => w.pathPlan[i] === 15), RT() + 600, 'host marks 3 dirt tiles for removal');
    await t.waitFor(() => part.every((i) => G.game.world.pathPlan[i] === 15), ONEWAY() + 400, 'guest has the 3 removal marks');
    await layPaths(t, G, MG, part, { code: 15 });
    await t.waitFor(() => part.every((i) => !w.path[i]), ONEWAY() + 600, 'host: 3 dirt tiles removed');
    t.check(old.slice(3).every((i) => w.path[i] === 1 && G.game.world.path[i] === 1), 'the rest of the dirt path stays on both');
  } else t.note('no M1 dirt path left — partial erase of it skipped');
  const bp = pathRow(H, MP, gp.x, gp.y, 2);
  if (bp) {
    G.game.paths.paint('flag', bp);
    await t.waitFor(() => bp.every((i) => w.pathPlan[i] === 3), RT() + 600, 'flagstone blueprints on the host');
    G.game.paths.paint('remove', bp);
    await t.waitFor(() => bp.every((i) => !w.pathPlan[i] && !w.path[i]), RT() + 600, 'the eraser cancels blueprints at once (host)');
  }
  await t.checkDigest(H, G);
});

def('M3', {
  title: 'M: flora never regrows on paths', timeout: 150000,
  expected: 'With most free tiles of a chunk turned into a path (host ops) and a few plants removed, accelerated host regrowth spawns nothing on a path / plan tile (world.growWeight = 0 there on both peers, every kind); whatever regrew appears on the guest identically; digest equal',
  api: 'world.growWeight / canGrow (path check); host floraSystem internals game.flora.{ci,t,chunks,dyn} (like S21); ops path.set / obj.add',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const F = H.game.flora;
  t.need(F && F.chunks?.length && 'ci' in F && 't' in F, 'host flora internals (game.flora.ci/t/chunks) missing — cannot accelerate regrowth');
  const MP = await frameImport(H, 'game/mut/paths.js');
  const w = H.game.world, W = w.W, CH = 16, sp = spawnOf(H);
  // a grassy chunk ~25 tiles from the spawn with room for paths
  let k = -1, free = [];
  for (let r = 22; r < 60 && k < 0; r += 6) for (let a = 0; a < 8 && k < 0; a++) {
    const cx = Math.floor((sp.x + Math.cos(a) * r) / CH), cy = Math.floor((sp.y + Math.sin(a) * r) / CH);
    if (cx < 0 || cy < 0 || cx >= w.CW || cy >= w.CH) continue;
    const list = [];
    for (let y = cy * CH; y < cy * CH + CH; y++) for (let x = cx * CH; x < cx * CH + CH; x++) if (!MP.canPaint(H.game, x, y) && !w.path[w.idx(x, y)] && !w.pathPlan[w.idx(x, y)]) list.push(w.idx(x, y));
    if (list.length > 120) { k = cy * w.CW + cx; free = list; }
  }
  t.assert(k >= 0, 'found a chunk with room for paths');
  env.history.push('M3');
  const lay = free.filter((i, n) => n % 5 !== 4);     // 80% of the free tiles: built path
  const plan = free.filter((i, n) => n % 10 === 4);   // 10%: dirt blueprints
  const rle = MP.rleTiles;
  H.game.net.emit('path.set', { t: 1, tiles: rle(lay) });
  H.game.net.emit('path.plan', { c: 1, tiles: rle(plan) });
  await t.waitFor(() => lay.every((i) => G.game.world.path[i] === 1), ONEWAY() + 600, 'guest has the chunk paths');
  const kinds = ['tree', 'bush', 'berrybush', 'herbbush', 'fibergrass', 'pebble', 'stick', 'boulder', 'wild_potato', 'wild_cotton', 'wild_corn'];
  const zero = (f) => [...lay, ...plan].every((i) => kinds.every((kd) => f.game.world.growWeight(i % W, (i / W) | 0, kd) === 0));
  t.check(zero(H) && zero(G), 'growWeight is 0 on every path / blueprint tile, every kind (host and guest)');
  // make room: remove some plants of the chunk (host op), then accelerate regrowth with both players away
  const ids = [];
  w.forChunks((k % w.CW) * CH + 1, Math.floor(k / w.CW) * CH + 1, (k % w.CW) * CH + 14, Math.floor(k / w.CW) * CH + 14, (c) => { for (const o of c.objects) if (!o.building && (o.type === 'bush' || o.type === 'fibergrass' || o.type === 'pebble' || o.type === 'stick') && ids.length < 6) ids.push(o.id); });
  if (ids.length) H.game.net.emit('obj.remove', { ids });
  const cx = (k % w.CW) * CH + 8, cy = Math.floor(k / w.CW) * CH + 8;
  sendAway(H, MH, cx, cy, 40, 0); sendAway(G, MG, cx, cy, 42, 0.3);
  await t.sleep(300);
  const before = new Set(F.dyn.keys()), found = [];
  const t0 = now();
  while (now() - t0 < 25000) {
    F.ci = k; F.t = 0;
    await t.sleep(25);
    for (const [id, q] of F.dyn) if (!before.has(id)) { before.add(id); found.push(q); }
    if (found.length >= 6) break;
  }
  const onPath = found.filter((q) => { const i = w.idx(Math.floor(q.x), Math.floor(q.y - 0.05)); return w.path[i] || w.pathPlan[i]; });
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
  await t.waitFor(() => tiles.every((i) => g.world.pathPlan[i] === 2 && w.pathPlan[i] === 2), RT() + 600, 'gravel plans on both');
  g.work.paused = false;
  t.defer(() => { g.work.cancel(true); g.work.paused = true; });
  await t.sleep(1500);
  t.check(!g.work.seq && tiles.every((i) => !w.path[i]) && A.count(G, 'pebble') === peb0, 'painting starts nothing (no tile laid, no pebble taken)');
  // a real tap on a plan tile (a point the controller's pick resolves to that path job)
  const tapPlan = async (code) => {
    const i0 = tiles.find((i) => g.world.pathPlan[i] === code);
    const sp = A.freeSpot(G, MG, (i0 % W) + 0.5, ((i0 / W) | 0) + 0.5, { rMin: 0.8, rMax: 2.5, prefer: Math.PI / 2 });
    t.assert(sp, 'free spot next to the stroke');
    A.teleport(G, sp[0], sp[1]);
    await A.hostSees(t, H, G);
    g.cam.x = gp.x; g.cam.y = gp.y - 0.4;
    await t.sleep(80);
    let tap = null;
    for (const i of tiles) for (const [ox, oy] of [[0.5, 0.5], [0.3, 0.8], [0.7, 0.2]]) {
      if (tap || g.world.pathPlan[i] !== code) continue;
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
  await t.waitFor(() => tiles.every((i) => w.path[i] === 2 && !w.pathPlan[i]) && !g.work.seq, 45000, 'the sequence laid the whole stroke and stopped',
    () => `laid ${tiles.filter((i) => w.path[i] === 2).length}/6 · ${JSON.stringify(g.work.status())} · work ${gp.work?.label ?? '-'} · busy goal=${g.ctl.goal?.type ?? '-'}${g.ctl.goal?.auto ? '(auto)' : ''} moving=${gp.moving} atk=${gp.autoAttack} combat=${gp.inCombat} modal=${!!g.ui?.modal} craft=${g.craft?.queue?.length} charge=${!!gp.charge} chasers=${chasers(G)} failed=${g.work.failed.size} at ${f2(gp.x)},${f2(gp.y)} · ui: ${G.lastUi()}`);
  await t.sleep(ONEWAY() + 100);
  t.check(pathCells(H, tiles) === pathCells(G, tiles), 'built cells identical on both', pathCells(H, tiles));
  t.check(A.count(G, 'pebble') === peb0 - 6, '6 pebbles left the guest bag when laid', `${peb0} → ${A.count(G, 'pebble')}`);
  // removal marks work like deconstruction marks
  g.paths.paint('remove', tiles);
  await t.waitFor(() => tiles.every((i) => w.pathPlan[i] === 15 && g.world.pathPlan[i] === 15), RT() + 600, 'red removal marks on both');
  await t.sleep(800);
  t.check(tiles.every((i) => w.path[i] === 2), 'marking removes nothing by itself');
  await tapPlan(15);
  t.check(g.work.status()?.verb === 'Removendo caminho', 'status: Removendo caminho', JSON.stringify(g.work.status()));
  await t.waitFor(() => tiles.every((i) => !w.path[i] && !w.pathPlan[i]) && !g.work.seq, 45000, 'the sequence dug the stroke out',
    () => `left ${tiles.filter((i) => w.path[i]).length} · ${JSON.stringify(g.work.status())}`);
  await t.sleep(ONEWAY() + 100);
  t.check(pathCells(H, tiles) === pathCells(G, tiles), 'cells identical after removal', pathCells(H, tiles));
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
