// Booting game frames for the tests: host (?mp=host), guests (?autojoin=1), solo, and the shared host+guest pair
// reused by most scenarios (recreated when it breaks or carries a desync from an earlier scenario).

import { CFG, frames, Fail, Skip, isSynced, hasNet, hasDigest, rand, newRoom, short, noteBuilds, now, LEGACY } from './harness.js';
import { mods, reset } from './act.js';

export const hostQuery = (room, pid, extra = '') => `seed=${CFG.seed}&mp=host&sala=${room}${CFG.link}&nosave=1&pid=${pid}${extra}`;
export const guestQuery = (room, pid, extra = '') => `sala=${room}${CFG.link}&autojoin=1&nosave=1&pid=${pid}${extra}`;
export const soloQuery = (extra = '') => `seed=${CFG.seed}&nosave=1${extra}`;

// Same-origin iframes share the tab's sessionStorage, where the game keeps its player id ('wos.pid'): preset a
// distinct id right before each frame boots (and pass &pid= too, for a game that reads it from the URL).
export function presetPid(pid) { try { sessionStorage.setItem('wos.pid', pid); } catch { /* ignore */ } }

const scenarioOpen = (t) => (l, q, p) => t.open(l, q, p);
const sharedOpen = () => (l, q, p) => frames.open(l, q, p);

export function joinDiag(H, G) {
  const s = G?.session;
  return [
    `guest: game=${!!G?.game} net.role=${G?.net?.role ?? '—'} synced=${G?.net?.synced ?? '—'} session.state=${s?.state ?? '—'} loading="${G?.loadingText}" page="${short((G?.text() || '').replace(/\s+/g, ' ').slice(0, 200), 200)}"`,
    `host: players=${H?.session?.players?.size ?? '—'} state=${H?.session?.state ?? '—'}`,
    `guest netlog:\n      ${G?.netlogTail(6) || '—'}`,
    `host netlog:\n      ${H?.netlogTail(6) || '—'}`,
  ].join('\n    ');
}

export async function bootSolo(t, extra = '', label = 'solo') {
  const pid = 's' + rand(7);
  presetPid(pid);
  const S = t.open(label, soloQuery(extra), pid);
  await t.waitFor(() => S.game || S.bootError, CFG.bootMs, `${label} boot (window.game)`, () => `loading: "${S.loadingText}"`);
  if (S.bootError) throw new Fail(`${label} boot failed: ${S.bootError}`);
  await t.waitFor(() => S.loadingHidden, 20000, `${label} loading screen hidden`);
  S.hookUi();
  return S;
}

export async function bootHost(t, room, { pid = 'h' + rand(7), extra = '', label = 'host', shared = false } = {}) {
  presetPid(pid);
  const open = shared ? sharedOpen() : scenarioOpen(t);
  const H = open(label, hostQuery(room, pid, extra), pid);
  await t.waitFor(() => H.game || H.bootError, CFG.bootMs, `${label} boot (window.game)`, () => `loading: "${H.loadingText}"`);
  if (H.bootError) throw new Fail(`${label} boot failed: ${H.bootError}`);
  H.hookUi();
  if (!hasNet(H)) {
    frames.close(H);
    throw new Skip('game.net missing — net core not merged yet (host frame booted as plain single player)');
  }
  await t.waitFor(() => H.session && (H.session.role === 'host' || H.net.role === 'host'), 15000, `${label}: ?mp=host created a hosting session`,
    () => `net.role=${H.net?.role} session=${!!H.session} state=${H.session?.state}`);
  try { H.game.events.emit('closepanels', {}); } catch { /* ignore */ }
  noteBuilds(H, null);
  return H;
}

export async function bootGuest(t, room, H, { pid = 'g' + rand(7), extra = '', label = 'guest', shared = false, waitSync = true } = {}) {
  presetPid(pid);
  const open = shared ? sharedOpen() : scenarioOpen(t);
  const G = open(label, guestQuery(room, pid, extra), pid);
  await legacyJoin(t, G);
  if (!waitSync) return G;
  await waitGuestSynced(t, G, H, label);
  return G;
}

// ?legacy=1 only: the Phase-1 game has no ?autojoin — click "Entrar" in the join panel
export async function legacyJoin(t, G) {
  if (!LEGACY) return;
  const btn = await t.waitFor(() => G.doc?.querySelector('.mpanel [data-a=go]:not([disabled])'), 30000, 'legacy join panel');
  btn.click();
}

export async function waitGuestSynced(t, G, H, label = G.label) {
  await t.waitFor(() => isSynced(G) || G.bootError, CFG.joinMs, `${label} joined and applied the world snapshot`, () => joinDiag(H, G));
  if (G.bootError) throw new Fail(`${label} boot failed: ${G.bootError}`);
  G.hookUi();
  noteBuilds(null, G);
}

// ---------------- harness self-test against the Phase-1 game (?legacy=1) ----------------
// Before the net core exists there is no ?mp=host / ?autojoin: build the pair the old way (solo host frame +
// new Session().host(), guest clicks "Entrar" in the join panel; real WebRTC via public signaling). Scenarios
// then run their two-frame code paths and fail on the missing replication — useful only to test the harness.
async function legacyPair(t, room) {
  const hpid = 'h' + rand(7);
  presetPid(hpid);
  const H = frames.open('host', `seed=${CFG.seed}&nosave=1&pid=${hpid}`, hpid);
  await t.waitFor(() => H.game && H.loadingHidden, CFG.bootMs, 'legacy host boot');
  H.hookUi();
  const SM = await H.win.Function('u', 'return import(u)')(new URL('src/net/session.js', H.win.location.href).href);
  new SM.Session().host(H.game, room);
  await t.waitFor(() => H.session?.state === 'hosting', 5000, 'legacy host session');
  const gpid = 'g' + rand(7);
  presetPid(gpid);
  const G = frames.open('guest', `sala=${room}&nosave=1&pid=${gpid}`, gpid);
  await legacyJoin(t, G);
  await waitGuestSynced(t, G, H, 'legacy guest');
  noteBuilds(H, G);
  t.note('legacy pair (Phase-1 session, no game.net): harness self-test only');
  return { room, H, G, opened: now(), legacy: true };
}

// ---------------- the shared pair ----------------
export const env = {
  pair: null,
  unsupported: null,   // Skip reason once we know the game can't host (no game.net)
  setupFail: null,     // last setup failure (fail fast after two in a row)
  setupFails: 0,
  claimed: new Set(),  // world object ids consumed by earlier scenarios
  history: [],         // scenario ids that mutated the shared world

  healthy() {
    const P = this.pair;
    return !!P && P.H.alive && P.G.alive && !!P.H.game && !!P.G.game && isSynced(P.G) && P.H.session?.state !== 'closed';
  },
  closePair() {
    const P = this.pair;
    this.pair = null;
    this.history = [];
    if (P && !CFG.keep) { frames.close(P.G); frames.close(P.H); }
  },
  async getPair(t, { fresh = false } = {}) {
    if (this.unsupported) throw new Skip(this.unsupported);
    if (this.setupFails >= 2 && this.setupFail) throw new Fail('shared pair setup keeps failing: ' + this.setupFail);
    if (!fresh && this.healthy()) {
      const P = this.pair;
      if (hasDigest(P.H) && hasDigest(P.G)) {
        const r = await t.digestEqual(P.H, P.G, { ms: 3000, label: 'pre-check' });
        if (r.ok) { t.diffs.length = 0; return P; }
        t.diffs.length = 0;
        t.note(`shared pair carried a desync from an earlier scenario (${r.why}); recreating it`);
      } else return P;
    } else if (!fresh && this.pair) t.note('shared pair unhealthy (frame gone / guest not synced); recreating it');
    this.closePair();
    const room = newRoom();
    t.log(`opening host+guest pair in room ${room} (${CFG.transport})`);
    try {
      if (LEGACY) { this.pair = await legacyPair(t, room); return this.pair; }
      const H = await bootHost(t, room, { shared: true });
      const G = await bootGuest(t, room, H, { shared: true });
      this.pair = { room, H, G, opened: now() };
      this.setupFails = 0; this.setupFail = null;
      return this.pair;
    } catch (e) {
      if (e instanceof Skip) { this.unsupported = e.message; frames.closeAll(); throw e; }
      this.setupFails++; this.setupFail = e.message.split('\n')[0];
      for (const f of frames.live) if (!CFG.keep) frames.close(f);
      throw e;
    }
  },
};

// pair + module handles + both players reset near the spawn
export async function pairCtx(t, { fresh = false } = {}) {
  const P = await env.getPair(t, { fresh });
  const [MH, MG] = await Promise.all([mods(P.H), mods(P.G)]);
  await reset(t, P.H, MH, P.G, MG);
  t.log(`pair ready: host ${P.H.pid} · guest ${P.G.pid} · room ${P.room}`);
  return { ...P, MH, MG };
}
