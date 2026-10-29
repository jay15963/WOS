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
  const { H, G, MH, MG } = C;
  const gpl = G.game.player;
  if (knife) A.ensure(G, { knife_stone: 1 });
  else {
    if (/^knife_/.test(gpl.equip.main || '')) G.game.econ.unequip('main');
    gpl.inv.slots = gpl.inv.slots.map((s) => (s && /^knife_/.test(s.id) ? null : s));
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
  A.hit(G, MG, A.proxyOf(G, wolf) || prox, 9999);
  t.log(`guest hits wolf ${wolf.nid} for 9999 (knife: ${knife})`);
  const dh = await t.timeTo(() => wolf.dead, RT() + 400, 'wolf dead on the host', () => `hp ${wolf.hp} guest ui: ${G.lastUi()}`);
  await t.waitFor(() => A.proxyOf(G, wolf)?.dead || !A.proxyOf(G, wolf), ONEWAY() + 300, 'wolf dead on the guest');
  t.metric(`kill${knife ? 'Knife' : ''}RoundTripMs`, Math.round(dh));
  await t.waitFor(() => loot.rows(0).length > 0, 1500, 'kill loot on the host');
  await t.sleep(ONEWAY() + 150);
  const rows = loot.rows(0);
  const mid = rows.reduce((a, r) => [a[0] + (H.game.loot.find((l) => String(l.id) === r.id)?.x ?? wolf.x), a[1] + (H.game.loot.find((l) => String(l.id) === r.id)?.y ?? wolf.y)], [0, 0]).map((v) => v / rows.length);
  // both players stand on the pile: each item picked by exactly one of them
  A.teleport(H, mid[0], mid[1]);
  A.teleport(G, mid[0] + 0.3, mid[1]);
  const killIds = new Set(rows.map((r) => r.id));
  const gone = await t.tryWait(() => !H.game.loot.some((l) => killIds.has(String(l.id))) && !G.game.loot.some((l) => killIds.has(String(l.id))), 5000);
  await t.sleep(RT());
  loot.stop();
  const cmp = loot.compare(0, 1), li = loot.items(0);
  const gainH = A.invDiff(inv0[0], A.invSnap(H)), gainG = A.invDiff(inv0[1], A.invSnap(G));
  const sum = {};
  for (const k of Object.keys(li)) sum[k] = (gainH[k] || 0) + (gainG[k] || 0);
  return { cmp, li, gone, gainH, gainG, sum, xpH: xpH.total, xpG: xpG.total };
}
def('S16', {
  star: true, title: 'Wolf killed by the guest', timeout: 150000,
  expected: 'Wolf dead on both; loot on both with identical ids; leather only if the guest had a knife; XP only to the guest; each item picked by one player only',
  api: 'combat applyPlayerHit on a proxy (mob.hit intent {skin}); mob.die op + loot.add; loot.take arbitration; proxies {nid,dead}',
}, async (t) => {
  const C = await pairCtx(t);
  const { H, G } = C;
  A.ensure(H, { knife_stone: 1 }); // the host's knife must NOT make the guest's kill drop leather
  A.keepAlive(t, G);
  const sp = spawnOf(H);
  const wolves = A.hostMobs(H, (m) => m.species === 'wolf' && !env.claimed.has('mob' + m.nid)).sort((a, b) => Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y));
  t.assert(wolves.length >= 2, 'found two wolves on the host', `${wolves.length}`);
  t.need(wolves[0].nid != null, 'host creatures have no nid (entity replication not merged)');
  let leatherNoKnife = 0;
  for (const [k, knife] of [[0, false], [1, true]]) {
    const wolf = wolves[k];
    env.claimed.add('mob' + wolf.nid);
    const r = await killByGuest(t, C, wolf, { knife });
    const tag = knife ? ' (guest with knife)' : ' (guest without knife, host has one)';
    t.check(r.cmp.ok && r.cmp.n > 0, 'kill loot with identical ids on both' + tag, r.cmp.detail);
    t.check((r.li.meat || 0) >= 1, 'meat dropped' + tag, short(r.li));
    if (!knife) { leatherNoKnife = r.li.leather || 0; t.check(!leatherNoKnife, 'no leather without a knife (skin flag from the killing hit)', short(r.li)); }
    else t.note(`leather with a knife: ${r.li.leather || 0} (70% chance)`);
    t.check(r.xpG > 0 && r.xpH === 0, 'kill XP only to the guest' + tag, `guest +${f2(r.xpG)} host +${f2(r.xpH)}`);
    t.check(r.gone, 'all kill loot picked up' + tag);
    const dup = Object.keys(r.li).filter((k2) => r.sum[k2] !== r.li[k2]);
    t.check(!dup.length, 'each item picked by exactly one player (no duplication / loss)' + tag, `dropped ${short(r.li)} · host +${short(r.gainH)} · guest +${short(r.gainG)}`);
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
  star: true, title: 'Weather / clock / sleep', timeout: 150000,
  expected: 'Host weather change visible on guests ≤ 2 s; host sleep → env.skip on all (hour, day, worldTime); guest sleep refused with a message',
  api: 'env.setWeather (host) → sts.env; bed useStructure: host env.skip op, guest refusal message; env.{hour,dayIndex,weather}; worldTime',
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
  const setNight = async () => {
    EH.hour = 21;
    await t.waitFor(() => Math.abs(EG.hour - EH.hour) < 0.1, 3000 + CFG.budget, 'guest clock follows the host to 21h');
  };
  await setNight();
  hp.combatT = 0;
  const day0 = EH.dayIndex, wt0 = H.game.worldTime;
  A.standBy(H, MH, bed);
  A.useBed(H, MH, bed);
  const ev = A.edgeWatch(t, { h: () => Math.abs(EH.hour - 6) < 0.05, g: () => Math.abs(EG.hour - 6) < 0.05 });
  await t.waitFor(() => Math.abs(EH.hour - 6) < 0.05, 3000, 'host slept to 6h', () => `hour ${f2(EH.hour)} ui: ${H.lastUi()}`);
  await t.waitFor(() => Math.abs(EG.hour - 6) < 0.05, ONEWAY() + 300, 'guest clock skipped to 6h');
  t.metric('skipLagMs', Math.round(ev.g.first - ev.h.first));
  t.check(ev.g.first - ev.h.first <= CFG.budget + 40, 'env.skip reaches the guest within the budget', fmtMs(ev.g.first - ev.h.first));
  t.check(EH.dayIndex === day0 + 1 && EG.dayIndex === EH.dayIndex, 'day advanced on both', `host ${EH.dayIndex} guest ${EG.dayIndex}`);
  t.check(H.game.worldTime > wt0 + 100 && Math.abs(H.game.worldTime - G.game.worldTime) <= 2, 'worldTime jumped on both (±2 s)', `host ${f2(H.game.worldTime)} guest ${f2(G.game.worldTime)}`);
  // guest sleep refused
  await setNight();
  const bedG = A.structOn(G, bed.id);
  const since = now();
  A.standBy(G, MG, bedG);
  A.useBed(G, MG, bedG);
  const msg = await t.tryWait(() => G.ui.some((u) => u.t >= since && /anfitri(ã|a)o/i.test(u.text)), 2500);
  t.check(msg, 'guest sleep refused with a message', G.lastUi(2, since));
  await t.sleep(1500);
  t.check(EG.hour > 20 && EH.hour > 20, 'no time skip from the guest', `host ${f2(EH.hour)} guest ${f2(EG.hour)}`);
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
    const act = pick(['walk', 'walk', 'chop', 'gather', 'gather', 'build', 'fight', 'decon']);
    stats.actions[act] = (stats.actions[act] || 0) + 1;
    try {
      if (act === 'walk') { const s = A.freeSpot(f, M, p.x + (Math.random() - 0.5) * 16, p.y + (Math.random() - 0.5) * 16, { rMin: 0, rMax: 3 }); if (s) g.ctl.walkTo(s[0], s[1]); }
      else if (act === 'chop') { const o = A.shared(f, null, p.x, p.y, 12, A.standingTree)[0]; if (o) A.interact(f, M.gathering.describeObject(g, o)); }
      else if (act === 'gather') { const o = A.shared(f, null, p.x, p.y, 10, (q) => /^(pebble|stick|fibergrass|bush|berrybush)$/.test(q.type) && !q.gone)[0]; if (o) A.interact(f, M.gathering.describeObject(g, o)); }
      else if (act === 'build') {
        const tx = Math.floor(p.x + (Math.random() - 0.5) * 10), ty = Math.floor(p.y + (Math.random() - 0.5) * 10);
        const type = Math.random() < 0.5 ? 'floor_wood' : 'wall_wood';
        if (M.building.placeReason(g, type, tx, ty) === null && Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) > 1.5) A.place(f, M, type, [tx, ty]);
      } else if (act === 'fight') { const m = A.mobs(f, (e) => !e.dead && (e.species === 'rabbit' || e.species === 'deer' || e.species === 'boar' || e.species === 'fox') && A.dist(e, p) < 14)[0]; if (m) g.ctl.engage(m); }
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
  expected: 'Guest clicks Tipo / A→Z / Quantidade in the chest panel; the host sorts (chest.sort → chest.set): same order on both, stacks merged, digest equal',
  api: 'chest panel [data-sort][data-sortk=chest:<id>] click (chest.sort intent → chest.set {slots}); o.store.slots; invsort.sortedSlots',
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
    A.hit(S1, M, prey, 9999);
    t.check(prey.dead, 'a hit kills the creature locally', prey.species);
    await t.sleep(300); cl.stop();
    t.check((cl.items(0).meat || 0) >= 1, 'kill drops meat', short(cl.items(0)));
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
  p.hp = 40;
  const used = A.ability(G, MG, 'heal');
  t.check(used !== false && A.count(G, 'herb') === n0 - 1, 'heal ability uses exactly 1 herb', `used ${used} herbs ${n0} → ${A.count(G, 'herb')}`);
  t.check(G.game.player.action?.type === 'heal', "action / pose id 'heal'", String(G.game.player.action?.type));
  const hp0 = p.hp;
  await t.tryWait(() => p.hp >= hp0 + 9, 3500);
  t.check(p.hp >= hp0 + 9, 'heals over time (~5% of max HP per second)', `${f2(hp0)} → ${f2(p.hp)}`);
  MG.combat.dealDamage(G.game, { x: p.x + 1, y: p.y, level: 1 }, p, 3, {});
  const hpHit = p.hp;
  t.check(!p.buffs?.some?.((b) => b.id === 'heal'), 'taking damage interrupts the herbs', short((p.buffs || []).map((b) => b.id)));
  await t.sleep(1600);
  t.check(p.hp <= hpHit + 0.01, 'no more healing after the interruption', `${f2(hpHit)} → ${f2(p.hp)}`);
  await t.checkDigest(H, G);
  env.history.push('S50');
});

// =====================================================================================================
// S70 H: look sync (character creator)
def('S70', {
  title: 'H: look sync', timeout: 90000,
  expected: 'Guest changes its look → the host draws the very same parts and colours (look/rig layers per facing); host change → guest sees it; a malformed look from a peer (unknown ids, bad colours, garbage) is cleaned to valid defaults and draws; packed look < 260 B; selfTest clean',
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
  t.check(want.length < 260, 'packed look is compact', `${want.length} chars`);
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
  t.check(legacy.hair === 'long' && legacy.beard === 'full' && legacy.topC === '80331a', 'legacy { skin, hair, hairColor, shirt, beard } migrates', `${legacy.hair} ${legacy.beard} ${legacy.topC}`);
  const st = H.game.net.selfTest();
  t.check(st.atlasOk && !st.missingSprites.length && !st.placeholders.length, 'host selfTest clean', JSON.stringify({ atlasOk: st.atlasOk, missing: st.missingSprites.length }));
  await t.checkDigest(H, G);
// Agent A (construction) scenarios — rotation / edge props, real footprints, delivery, move, decon, raze, saves
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
  expected: 'Guest drags a 4-tile fence row (the same drag API as mouse / one finger): 4 free blueprints on both (no wood taken); a 5th cancelled after delivery refunds its wood; with too little wood one stays "falta material" (skipped by auto-work, unpaid on both); building takes the wood from the guest’s bag when each starts; fences joined to a wall',
  api: 'buildDragStart/Move/End → build.place; build.hit {start, pay} → struct.paid; canSupply / work queue skip; build.decon on a paid blueprint → give; autotile joins',
}, async (t) => {
  const { H, G, MH, MG } = await pairCtx(t);
  const g = G.game, gp = g.player, hp = H.game.player;
  const row = (x, y) => [0, 1, 2, 3, 4].map((k) => [x + k, y]).concat([[x - 1, y]]);
  const site = A.findSite([H, G], [MH, MG], 'fence_wood', row, gp.x, gp.y, { rMin: 3, rMax: 12, avoidPts: [[gp.x, gp.y], [hp.x, hp.y]] });
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
  for (const id of ids.slice(0, 3)) { const o = A.structOn(G, id); A.standBy(G, MG, o); await A.hostSees(t, H, G); await A.buildAll(t, G, MG, [id]); }
  t.check(A.count(G, 'wood') === 0, 'each start took 1 wood (3 built, bag empty)', `wood ${A.count(G, 'wood')}`);
  const lack = A.structOn(G, ids[3]);
  t.check(lack.blueprint && !lack.paid && !MG.building.canSupply(g, lack), 'the 4th waits for material (unpaid, cannot supply)');
  g.work.paused = false;
  await t.sleep(1800);
  g.work.paused = true;
  const busy = gp.work?.it?.o === lack;
  gp.work = null; gp.action = null; g.ctl.goal = null;
  t.check(!busy && !A.structOn(H, ids[3])?.paid, 'auto-work skips it (falta material)', `busy ${busy}`);
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
  t.check(out.every((r) => r.length === 14), 'every row has 14 fields', out.map((r) => r.length).join(','));
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
  expected: 'Guest fires Tiro Longo (aim point) at a creature ~16 tiles away: host flies the authoritative arrow and rolls the landing (within range + scatter); guest copy flies at once and gets the host id + same landing on the ack; the host applies the hit (damage event ability long_shot from the guest avatar) and the guest sees it; 1 arrow leaves the guest bag per shot; an early 2nd request is refused by the host and refunded; aim beyond the range is clamped by the host; digest equal',
  api: 'abilities.fireAimed(game, id, x, y); intent lob.fire {ab, w, x, y, ax, ay, amount, crit, skin} → {id, lx, ly}; projectiles {lob, id, lx, ly, cosmetic, owner}; fx proj lob / pend; content/weapons.js lobSpec / lobScatter',
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
  await t.waitFor(() => ok2, RT() + 600, 'host answers the far shot');
  const far = lobsOf(H, seen2)[0];
  t.check(far && Math.hypot(far.lx - far.x0, far.ly - far.y0) <= S.range + W.lobScatter(S, S.range) + 0.01, 'aim 40 tiles away is clamped to the bow range by the host', far ? `${f2(Math.hypot(far.lx - far.x0, far.ly - far.y0))} tiles` : JSON.stringify(ok2));
  if (far) await t.tryWait(() => far.stuck || !(H.game.projectiles || []).includes(far), far.dur * 1000 + 1500);
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
