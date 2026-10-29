// Multiplayer test harness core (docs/SYNC.md §4.6): game frames (same-origin iframes, all visible so every
// frame keeps running requestAnimationFrame), scenario runner with per-scenario timeouts, waits/watchers,
// digest comparison with row diffs, netlog `sync` error collection, storage guard and the plain-text report.
// Scenarios live in tools/mp-test.js; player actions in tools/mp-test/act.js.

export const Q = new URLSearchParams(location.search);
export const now = () => performance.now();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ROOT = new URL('../', location.href).href; // repo root (serves index.html)

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const rand = (n = 6, chars = 'abcdefghijkmnpqrstuvwxyz23456789') =>
  Array.from(crypto.getRandomValues(new Uint32Array(n)), (v) => chars[v % chars.length]).join('');
export const newRoom = () => 'T' + rand(5, CODE_CHARS);
export const fmtMs = (ms) => (ms == null || !Number.isFinite(ms) ? '—' : ms >= 10000 ? (ms / 1000).toFixed(1) + 's' : ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : Math.round(ms) + 'ms');
export const short = (v, n = 300) => {
  let s;
  try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch { s = String(v); }
  if (s == null) s = String(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };

// ---------------- configuration (URL) ----------------
// ?run=all | star | S6,S10 | S6-S12     ?transport=bc|webrtc     ?relay=1 (webrtc through TURN only)
// ?budget=ms (timing budget override)   ?slow=2 (timeouts ×2)    ?keep=1 (leave frames open at the end)
// ?soak=600 (S29 seconds)               ?hidden=60 (S26 seconds) ?seed=4242
export const CFG = (() => {
  const relay = Q.get('relay') === '1';
  const transport = relay || Q.get('transport') === 'webrtc' ? 'webrtc' : 'bc';
  const budget = +Q.get('budget') || (relay ? 600 : transport === 'webrtc' ? 300 : 100);
  return {
    transport, relay, budget,
    seed: +Q.get('seed') || 4242,
    joinMs: transport === 'bc' ? 45000 : 120000,
    bootMs: 90000,
    keep: Q.has('keep'),
    soak: Q.has('soak') ? Math.max(0, +Q.get('soak') || 0) : 600,
    hidden: Q.has('hidden') ? Math.max(5, +Q.get('hidden') || 60) : 60,
    slow: Math.max(0.5, +Q.get('slow') || 1),
    link: transport === 'bc' ? '&link=bc' : '',
  };
})();
// Request→ops round trip (guest intent, host op back) and one-way op budgets.
export const RT = () => CFG.budget * 2 + 120;
export const ONEWAY = () => CFG.budget + 60;

// ---------------- errors ----------------
export class Skip extends Error { constructor(m) { super(m); this.name = 'Skip'; } }
export class Fail extends Error { constructor(m, detail) { super(m); this.name = 'Fail'; this.detail = detail; } }
export class Timeout extends Error {
  constructor(label, ms, diag) { super(`timeout after ${fmtMs(ms)} waiting for: ${label}${diag ? ' — ' + diag : ''}`); this.name = 'Timeout'; }
}
export class Abort extends Error { constructor() { super('aborted (scenario timed out)'); this.name = 'Abort'; } }

// ---------------- page plumbing ----------------
const $ = (s) => document.querySelector(s);
export function setStatus(text) { const el = $('#status'); if (el) el.textContent = text; }

// ---------------- storage guard: tests never leave traces in this origin's storage ----------------
// Snapshots every 'wos.' key of localStorage + the tab's sessionStorage 'wos.pid' and restores them at the end.
export const storage = {
  saved: null, ssPid: null,
  snapshot() {
    this.saved = {};
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('wos.')) this.saved[k] = localStorage.getItem(k); } catch { /* ignore */ }
    try { this.ssPid = sessionStorage.getItem('wos.pid'); } catch { /* ignore */ }
  },
  newKeys() {
    const out = [];
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('wos.') && !(k in (this.saved || {}))) out.push(k); } catch { /* ignore */ }
    return out;
  },
  restore() {
    if (!this.saved) return;
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('wos.') && !(k in this.saved)) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(this.saved)) if (localStorage.getItem(k) !== v) localStorage.setItem(k, v);
    } catch { /* ignore */ }
    try { if (this.ssPid == null) sessionStorage.removeItem('wos.pid'); else sessionStorage.setItem('wos.pid', this.ssPid); } catch { /* ignore */ }
  },
};

// ---------------- frames ----------------
let frameSeq = 0;
export class Frame {
  constructor(label, query, pid) {
    this.label = label;
    this.query = query;
    this.pidHint = pid || null;
    this.n = ++frameSeq;
    this.url = ROOT + '?' + query;
    this.errors = [];   // uncaught exceptions / unhandled rejections in the frame
    this.cerr = [];     // console.error lines (informational)
    this.syncLog = [];  // netlog entries with cat 'sync' and level 'error'
    this.ui = [];       // game 'error' / 'toast' events (pt-BR messages shown to the player)
    this.loads = 0;
    this.box = document.createElement('div');
    this.box.className = 'fbox';
    this.cap = document.createElement('div');
    this.cap.className = 'fcap';
    this.cap.textContent = `${label} #${this.n} · ${query}`;
    this.el = document.createElement('iframe');
    this.el.title = label;
    this.el.setAttribute('allow', 'autoplay');
    this.el.addEventListener('load', () => { this.loads++; this._hook(); });
    this.box.append(this.cap, this.el);
    this.el.src = this.url;
    this.born = now();
    this._watchNav();
  }
  // Wrap requestAnimationFrame in the new document as soon as it exists (before the game's module graph runs),
  // so the pump below can drive the game loop when the browser renders nothing (hidden pane / occluded window).
  _watchNav(old = null) {
    const t0 = now();
    const poll = () => {
      let w = null;
      try { w = this.el.contentWindow; if (w && w !== old && !w.__mpRaf && w.location.href !== 'about:blank') patchRaf(w); } catch { /* not yet */ }
      if ((w && w !== old && w.__mpRaf) || now() - t0 > 20000 || !this.box.isConnected) return;
      setTimeout(poll, 0);
    };
    setTimeout(poll, 0);
  }
  get win() { try { return this.el.contentWindow; } catch { return null; } }
  get doc() { try { return this.win?.document || null; } catch { return null; } }
  get game() { try { return this.win?.game || null; } catch { return null; } }
  get net() { return this.game?.net || null; }
  get session() { try { return this.win?.session || this.game?.session || null; } catch { return null; } }
  get netlog() { try { return this.win?.netlog || null; } catch { return null; } }
  get pid() { return this.net?.pid || this.session?.pid || this.pidHint; }
  get loadingText() { return this.doc?.querySelector('#loading-text')?.textContent || ''; }
  get loadingHidden() { const el = this.doc?.querySelector('#loading'); return !!el && el.classList.contains('hidden'); }
  get bootError() { const t = this.loadingText; return /^Erro:/.test(t) ? t : null; }
  get alive() { return this.box.isConnected && !!this.win; }
  text() { try { return this.doc?.body?.innerText || ''; } catch { return ''; } }
  _hook() {
    const w = this.win;
    if (!w || w.__mpHooked) return;
    w.__mpHooked = true;
    w.addEventListener('error', (e) => this.errors.push({ t: now(), msg: `${e.message} @ ${(e.filename || '').replace(ROOT, '')}:${e.lineno}` }));
    w.addEventListener('unhandledrejection', (e) => this.errors.push({ t: now(), msg: 'unhandled rejection: ' + (e.reason?.stack || e.reason?.message || String(e.reason)).slice(0, 300) }));
    try {
      const ce = w.console.error.bind(w.console);
      w.console.error = (...a) => { this.cerr.push({ t: now(), msg: a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : short(x, 120))).join(' ').slice(0, 300) }); ce(...a); };
    } catch { /* ignore */ }
    // netlog lives in the frame's module graph; subscribe as soon as it exists
    const t0 = now();
    const tryLog = () => {
      const nl = this.netlog;
      if (nl?.subscribe) {
        nl.subscribe((e) => { if (e.cat === 'sync' && e.level === 'error') this.syncLog.push({ t: now(), msg: e.msg + (e.data ? ' ' + e.data : '') }); });
        for (const e of nl.session?.entries || []) if (e.cat === 'sync' && e.level === 'error') this.syncLog.push({ t: now(), msg: e.msg });
        return;
      }
      if (now() - t0 < 120000 && this.win === w) setTimeout(tryLog, 100);
    };
    tryLog();
  }
  // game 'error'/'toast' events (pt-BR texts); installed once the game exists
  hookUi() {
    const g = this.game;
    if (!g?.events || g.__mpUi) return;
    g.__mpUi = true;
    g.events.on('error', (d) => this.ui.push({ t: now(), kind: 'error', text: String(d?.text || '') }));
    g.events.on('toast', (d) => this.ui.push({ t: now(), kind: d?.kind || 'toast', text: String(d?.text || '') }));
  }
  lastUi(n = 3, since = 0) { return this.ui.filter((u) => u.t >= since).slice(-n).map((u) => `${u.kind}: ${u.text}`).join(' | '); }
  netlogTail(n = 8) {
    const E = this.netlog?.session?.entries || [];
    return E.slice(-n).map((e) => `+${e.t.toFixed(1)} ${e.level} [${e.cat}] ${e.msg}`).join('\n      ');
  }
  reload() { const old = this.win; old.location.reload(); this._watchNav(old); }
  get pumped() { try { return this.win?.__mpRaf?.st.pumped || 0; } catch { return 0; } }
  remove() {
    try { this.session?.close?.('teste encerrado'); } catch { /* ignore */ }
    this.box.remove();
  }
}

// ---------------- rAF pump ----------------
// Same-origin iframes only get requestAnimationFrame while the browser actually renders the page. When it does
// not (hidden Browser pane, minimized window), the pump runs the frames' queued rAF callbacks every 16 ms with
// the frame's own clock, so the game loops (and the tests) keep going. Native rAF wins whenever it fires.
export const PUMP = { active: false, ticks: 0 };
function patchRaf(w) {
  const native = w.requestAnimationFrame.bind(w);
  const q = new Map();
  let seq = 0;
  const st = { lastNative: now(), pumped: 0 };
  w.__mpRaf = { q, st };
  w.requestAnimationFrame = (cb) => {
    const h = ++seq;
    q.set(h, cb);
    native((ts) => { st.lastNative = now(); if (q.delete(h)) cb(ts); });
    return h;
  };
  w.cancelAnimationFrame = (h) => { q.delete(h); };
}
setInterval(() => {
  let any = false;
  for (const f of frames.live) {
    let w, R;
    try { w = f.el.contentWindow; R = w?.__mpRaf; } catch { continue; }
    if (!R || !R.q.size || now() - R.st.lastNative < 150) continue;
    const cbs = [...R.q.values()];
    R.q.clear();
    const ts = w.performance.now();
    for (const cb of cbs) { try { cb(ts); } catch (e) { f.errors.push({ t: now(), msg: 'in rAF callback: ' + (e?.stack || e).toString().slice(0, 300) }); } }
    R.st.pumped++;
    any = true;
  }
  if (any) { PUMP.ticks++; if (!PUMP.active) { PUMP.active = true; render(); } }
}, 16);

export const frames = {
  all: [],
  get live() { return this.all.filter((f) => f.box.isConnected); },
  open(label, query, pid) {
    const f = new Frame(label, query, pid);
    this.all.push(f);
    $('#frames').appendChild(f.box);
    return f;
  },
  close(f) { if (f && f.box.isConnected) f.remove(); },
  closeAll() { for (const f of this.live) f.remove(); },
};

// ---------------- watchers ----------------
// Calls fn every ~4 ms (same thread as the frames: keep fn cheap). Errors stop nothing.
export function watch(fn, every = 4) {
  let on = true;
  const h = setInterval(() => { if (on) { try { fn(); } catch { /* ignore */ } } }, every);
  return { stop() { on = false; clearInterval(h); } };
}

// ---------------- net helpers (feature-detected; work before and after the net core merge) ----------------
export const TOLERANT_PARTS = new Set(['env', 'ents']);
export const hasNet = (f) => !!f?.net;
export const hasDigest = (f) => typeof f?.net?.digest === 'function';
export function seqOf(f) {
  const n = f?.net;
  if (!n) return undefined;
  return n.stats?.lastSeq ?? n.lastSeq ?? n.seq;
}
export const LEGACY = Q.has('legacy'); // harness self-test against the Phase-1 game (see pair.js)
export function isSynced(f) {
  const n = f?.net;
  if (!n && LEGACY) return f?.session?.role === 'guest' && f.session.state === 'connected' && f.loadingHidden;
  if (!n || n.role !== 'guest') return false;
  if (typeof n.synced === 'boolean') return n.synced && f.session?.state !== 'lost';
  return f.loadingHidden && f.session?.state === 'connected';
}
export function stat(f, k) { const v = f?.net?.stats?.[k]; return typeof v === 'number' ? v : undefined; }

function partsOf(d) { return d?.parts && typeof d.parts === 'object' ? d.parts : {}; }
export function diffDigestParts(a, b) {
  const pa = partsOf(a), pb = partsOf(b);
  const names = [...new Set([...Object.keys(pa), ...Object.keys(pb)])];
  return names.filter((k) => !TOLERANT_PARTS.has(k) && short(pa[k], 1e6) !== short(pb[k], 1e6));
}

const rowKey = (r) => (Array.isArray(r) ? short(r[0], 200) : r && typeof r === 'object' ? short(r.id ?? r.nid ?? r, 200) : short(r, 200));
export function rowDiff(part, ra, rb, la, lb) {
  if (!Array.isArray(ra) || !Array.isArray(rb)) return `${part}: dump not an array (${la} ${short(ra, 120)} / ${lb} ${short(rb, 120)})`;
  const ma = new Map(), mb = new Map();
  for (const r of ra) ma.set(rowKey(r), short(r, 400));
  for (const r of rb) mb.set(rowKey(r), short(r, 400));
  const onlyA = [], onlyB = [], changed = [];
  for (const [k, v] of ma) { if (!mb.has(k)) onlyA.push(v); else if (mb.get(k) !== v) changed.push(`${k}: ${la} ${v} ≠ ${lb} ${mb.get(k)}`); }
  for (const [k, v] of mb) if (!ma.has(k)) onlyB.push(v);
  const L = [`${part}: ${la} ${ra.length} rows, ${lb} ${rb.length} rows`];
  if (onlyA.length) L.push(`  only in ${la} (${onlyA.length}): ${onlyA.slice(0, 20).join(' ')}`);
  if (onlyB.length) L.push(`  only in ${lb} (${onlyB.length}): ${onlyB.slice(0, 20).join(' ')}`);
  if (changed.length) L.push(`  different (${changed.length}): ${changed.slice(0, 20).join(' ; ')}`);
  if (!onlyA.length && !onlyB.length && !changed.length) L.push('  rows equal but hash differs (row order / hashing input?)');
  return L.join('\n');
}
export function partDiffs(A, B, parts) {
  const out = [];
  for (const part of parts) {
    let ra, rb;
    try { ra = A.net.dump(part); rb = B.net.dump(part); } catch (e) { out.push(`${part}: dump() failed (${e.message})`); continue; }
    out.push(rowDiff(part, ra, rb, A.label, B.label));
    if (typeof A.net.diff === 'function') { try { out.push('  net.diff: ' + short(A.net.diff(ra, rb), 600)); } catch { /* ignore */ } }
  }
  return out;
}

// ---------------- scenario context ----------------
export class Ctx {
  constructor(sc, env) {
    this.sc = sc; this.env = env;
    this.t0 = now();
    this.lines = []; this.checks = []; this.notes = []; this.cleanups = []; this.metrics = {};
    this.aborted = false; this.skipReason = null; this.diffs = []; this.frames = [];
  }
  get elapsed() { return now() - this.t0; }
  log(msg) {
    this.lines.push(`+${(this.elapsed / 1000).toFixed(3)} ${msg}`);
    setStatus(`${this.sc.id} · ${msg}`);
  }
  note(msg) { this.notes.push(msg); this.log('note: ' + msg); }
  metric(k, v) { this.metrics[k] = v; }
  check(ok, label, detail) {
    ok = !!ok;
    this.checks.push({ ok, label, detail: detail == null ? '' : String(detail) });
    this.log(`${ok ? '✓' : '✗'} ${label}${detail != null && detail !== '' ? ' — ' + detail : ''}`);
    return ok;
  }
  assert(ok, label, detail) { if (!this.check(ok, label, detail)) throw new Fail(label + (detail ? ': ' + detail : '')); }
  need(cond, reason) { if (!cond) throw new Skip(reason); }
  skip(reason) { throw new Skip(reason); }
  defer(fn) { this.cleanups.push(fn); }
  checkAbort() { if (this.aborted) throw new Abort(); }
  async sleep(ms) {
    const end = now() + ms;
    while (now() < end) { this.checkAbort(); await sleep(Math.min(40, Math.max(1, end - now()))); }
    this.checkAbort();
  }
  // resolves with the predicate's truthy value; throws Timeout (with diag()) after ms
  async waitFor(pred, ms, label = 'condition', diag) {
    const t0 = now();
    let lastErr = null;
    for (;;) {
      this.checkAbort();
      let v;
      try { v = pred(); } catch (e) { v = undefined; lastErr = e; }
      if (v) return v;
      if (now() - t0 > ms) {
        let d = '';
        try { d = diag ? diag() : ''; } catch (e) { d = 'diag failed: ' + e.message; }
        if (lastErr) d += (d ? ' · ' : '') + 'predicate threw: ' + lastErr.message;
        throw new Timeout(label, ms, d);
      }
      await sleep(4);
    }
  }
  async timeTo(pred, ms, label, diag) { const t0 = now(); await this.waitFor(pred, ms, label, diag); return now() - t0; }
  async tryWait(pred, ms) { try { await this.waitFor(pred, ms); return true; } catch (e) { if (e instanceof Abort) throw e; return false; } }
  watch(fn, every) { const w = watch(fn, every); this.defer(() => w.stop()); return w; }
  on(f, type, fn) { const off = f.game?.events?.on?.(type, fn); if (off) this.defer(off); return off; }
  // frames opened by a scenario are closed at its end (unless ?keep)
  open(label, query, pid) {
    const f = frames.open(label, query, pid);
    this.frames.push(f);
    this.defer(() => { if (!CFG.keep) frames.close(f); });
    return f;
  }

  // digest equality between two frames (exact parts), after their sequence numbers match
  async digestEqual(A, B, { ms = CFG.budget * 4 + 1500, label = '' } = {}) {
    if (!hasDigest(A) || !hasDigest(B)) return { ok: false, missing: true, why: 'net.digest() missing' };
    const t0 = now();
    let last = null, seqSeen = false;
    for (;;) {
      this.checkAbort();
      const sa = seqOf(A), sb = seqOf(B);
      if (sa === sb) {
        seqSeen = true;
        const a = A.net.digest(), b = B.net.digest();
        const bad = diffDigestParts(a, b);
        if (!bad.length) return { ok: true, ms: now() - t0, seq: sa, parts: Object.keys(partsOf(a)), counts: a.counts };
        last = { a, b, bad, sa, sb };
      }
      if (now() - t0 > ms) break;
      await sleep(5);
    }
    if (!last) {
      return { ok: false, ms: now() - t0, why: `sequence numbers never matched (${A.label} ${seqOf(A)} vs ${B.label} ${seqOf(B)})${seqSeen ? '' : ''}` };
    }
    const lines = [`digest diff${label ? ' [' + label + ']' : ''} @seq ${A.label}=${last.sa} ${B.label}=${last.sb}: parts ${last.bad.join(', ')}`, ...partDiffs(A, B, last.bad)];
    this.diffs.push(lines.join('\n'));
    return { ok: false, ms: now() - t0, bad: last.bad, why: `parts differ: ${last.bad.join(', ')}`, report: lines.join('\n') };
  }
  // check() wrapper for digest equality
  async checkDigest(A, B, label = 'digest equal', opts) {
    const r = await this.digestEqual(A, B, opts);
    if (r.missing) { this.note(`${label}: skipped (net.digest() missing)`); return r; }
    this.check(r.ok, `${label} (${A.label} vs ${B.label})`, r.ok ? `${fmtMs(r.ms)} · seq ${r.seq}` : r.why);
    return r;
  }
}

// ---------------- results + report ----------------
export const results = [];
const STAR = (sc) => (sc.star ? '★' : ' ');
export const RUN_INFO = { started: null, ended: null, selection: '', hostBuild: null, guestBuild: null };

function frameBuild(f) {
  try {
    const w = f.win;
    return w?.__WOS_BUILD || f.game?.net?.build || f.session?._hello?.()?.build || null;
  } catch { return null; }
}
export function noteBuilds(H, G) {
  if (H && !RUN_INFO.hostBuild) RUN_INFO.hostBuild = frameBuild(H);
  if (G && !RUN_INFO.guestBuild) RUN_INFO.guestBuild = frameBuild(G);
}

export function reportText({ withPasses = false } = {}) {
  const L = [];
  const n = (s) => results.filter((r) => r.status === s).length;
  const total = RUN_INFO.ended && RUN_INFO.started ? RUN_INFO.ended - RUN_INFO.started : RUN_INFO.started ? now() - RUN_INFO.started : 0;
  L.push(`=== WOS mp-test · ${new Date().toLocaleString('pt-BR')} · transport ${CFG.transport}${CFG.relay ? ' + relay (wos.forceRelay=1)' : ''} · budget ${CFG.budget} ms · seed ${CFG.seed} ===`);
  L.push(`run: ${RUN_INFO.selection || '—'} · host build ${RUN_INFO.hostBuild || '?'} · guest build ${RUN_INFO.guestBuild || '?'} · page ${location.pathname}${location.search}`);
  if (LEGACY) L.push('note: ?legacy=1 — harness self-test against the Phase-1 game (pair joined through the join panel over Trystero/WebRTC); failures here describe the old game');
  if (PUMP.active) L.push(`note: the browser did not render this page (no requestAnimationFrame) — game loops were driven by the harness pump (${PUMP.ticks} ticks); timing budgets still apply`);
  L.push('');
  L.push(`${pad('ID', 4)} ${pad('★', 1)} ${pad('Scenario', 46)} ${pad('Status', 6)} ${pad('Time', 7)} Summary`);
  for (const r of results) {
    L.push(`${pad(r.id, 4)} ${STAR(r)} ${pad(r.title, 46)} ${pad(r.status, 6)} ${pad(r.status === 'RUN' ? '…' : fmtMs(r.ms), 7)} ${r.summary || ''}`);
  }
  L.push('');
  L.push(`Totals: PASS ${n('PASS')} · FAIL ${n('FAIL')} · SKIP ${n('SKIP')} · ERROR ${n('ERROR')}${n('RUN') ? ' · running ' + n('RUN') : ''} · ${fmtMs(total)}`);
  const bad = results.filter((r) => r.status === 'FAIL' || r.status === 'ERROR');
  if (bad.length) {
    L.push('', '=== FAILURES ===');
    for (const r of bad) L.push(...detailLines(r));
  }
  const sk = results.filter((r) => r.status === 'SKIP');
  if (sk.length) {
    L.push('', '=== SKIPPED ===');
    for (const r of sk) {
      const ok = (r.checks || []).filter((c) => c.ok).length;
      L.push(`[${r.id}] ${r.title}: ${r.summary}${ok ? ` (${ok} checks passed before the skip)` : ''}`);
      if (withPasses && ok) L.push(...detailLines(r, true).slice(1));
    }
  }
  if (withPasses) {
    const ok = results.filter((r) => r.status === 'PASS');
    if (ok.length) { L.push('', '=== PASSED (details) ==='); for (const r of ok) L.push(...detailLines(r, true)); }
  }
  return L.join('\n');
}

function detailLines(r, brief = false) {
  const L = [''];
  L.push(`[${r.id}] ${r.star ? '★ ' : ''}${r.title} — ${r.status} (${fmtMs(r.ms)})`);
  L.push(`  Expected: ${r.expected}`);
  if (r.error) L.push(`  Error: ${r.error}`);
  const failed = (r.checks || []).filter((c) => !c.ok);
  if (failed.length) {
    L.push('  Failed checks:');
    for (const c of failed) L.push(`   ✗ ${c.label}${c.detail ? ' — ' + c.detail : ''}`);
  }
  const passed = (r.checks || []).filter((c) => c.ok);
  if (passed.length) L.push(`  Passed checks: ${passed.map((c) => c.label + (c.detail ? ' (' + c.detail + ')' : '')).join(' · ')}`);
  if (r.metrics && Object.keys(r.metrics).length) L.push(`  Metrics: ${short(r.metrics, 600)}`);
  for (const d of r.diffs || []) L.push('  ' + d.split('\n').join('\n    '));
  if (r.sync?.length) { L.push('  Netlog sync errors:'); for (const s of r.sync.slice(0, 20)) L.push(`    ${s}`); }
  if (r.frameErrors?.length) { L.push('  Frame exceptions:'); for (const s of r.frameErrors.slice(0, 12)) L.push(`    ${s}`); }
  if (r.consoleErrors?.length && !brief) { L.push('  console.error (informational):'); for (const s of r.consoleErrors.slice(0, 8)) L.push(`    ${s}`); }
  if (r.notes?.length) L.push(`  Notes: ${r.notes.join(' · ')}`);
  if (!brief) {
    L.push(`  Reproduce: ${location.pathname}?run=${r.id}${CFG.transport === 'webrtc' ? '&transport=webrtc' : ''}${CFG.relay ? '&relay=1' : ''}  (API: ${r.api || '—'})`);
    if (r.lines?.length) { L.push('  Steps:'); for (const s of r.lines.slice(-60)) L.push('    ' + s); }
  }
  return L;
}

let renderQueued = false;
export function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const el = $('#report');
    if (el) el.textContent = reportText({ withPasses: Q.has('verbose') });
  });
  // also usable without rAF (background tab)
  setTimeout(() => { if (renderQueued) { renderQueued = false; const el = $('#report'); if (el) el.textContent = reportText({ withPasses: Q.has('verbose') }); } }, 300);
}
window.mpReport = (opts) => reportText(opts);
window.mpResults = results;

// ---------------- runner ----------------
export async function runScenarios(list, env) {
  RUN_INFO.started = now();
  for (const sc of list) {
    const r = { id: sc.id, title: sc.title, star: !!sc.star, expected: sc.expected, api: sc.api, status: 'RUN', ms: 0, summary: '' };
    results.push(r);
    render();
    const t = new Ctx(sc, env);
    const marks = new Map(frames.all.map((f) => [f, { sync: f.syncLog.length, err: f.errors.length, cerr: f.cerr.length }]));
    let timer = null;
    try {
      const p = Promise.resolve().then(() => sc.run(t, env));
      p.catch(() => {});
      const limit = (sc.timeout || 60000) * CFG.slow;
      await Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => { t.aborted = true; rej(new Timeout(`scenario time limit (last step: ${t.lines[t.lines.length - 1] || '—'})`, limit)); }, limit); })]);
      r.status = t.checks.some((c) => !c.ok) ? 'FAIL' : 'PASS';
    } catch (e) {
      if (e instanceof Skip) { r.status = t.checks.some((c) => !c.ok) ? 'FAIL' : 'SKIP'; r.summary = e.message; t.skipReason = e.message; }
      else if (e instanceof Fail || e instanceof Timeout) { r.status = 'FAIL'; r.error = e.message + (e.detail ? ' · ' + e.detail : ''); }
      else if (e instanceof Abort) { r.status = 'FAIL'; r.error = e.message; }
      else { r.status = 'ERROR'; r.error = `harness exception (or game API mismatch): ${e?.stack || e}`.slice(0, 1500); }
    } finally {
      clearTimeout(timer);
      t.aborted = true;
      for (const fn of t.cleanups.reverse()) { try { await fn(); } catch (e) { t.notes.push('cleanup failed: ' + e.message); } }
    }
    // netlog sync errors + frame exceptions that appeared during the scenario
    const sync = [], ferr = [], cerr = [];
    for (const f of frames.all) {
      const m = marks.get(f) || { sync: 0, err: 0, cerr: 0 };
      for (const s of f.syncLog.slice(m.sync)) sync.push(`${f.label}#${f.n}: ${s.msg}`);
      for (const s of f.errors.slice(m.err)) ferr.push(`${f.label}#${f.n}: ${s.msg}`);
      for (const s of f.cerr.slice(m.cerr)) cerr.push(`${f.label}#${f.n}: ${s.msg}`);
    }
    if (sync.length && !sc.allowSync && r.status === 'PASS') { r.status = 'FAIL'; t.checks.push({ ok: false, label: 'no netlog sync errors', detail: `${sync.length}: ${sync[0]}` }); }
    if (ferr.length && !sc.allowErrors && (r.status === 'PASS' || r.status === 'SKIP')) { r.status = 'FAIL'; t.checks.push({ ok: false, label: 'no uncaught exceptions in frames', detail: `${ferr.length}: ${ferr[0]}` }); }
    r.ms = t.elapsed;
    r.checks = t.checks.slice(); r.lines = t.lines.slice(); r.notes = t.notes.slice(); r.metrics = { ...t.metrics }; r.diffs = t.diffs.slice();
    r.sync = sync; r.frameErrors = ferr; r.consoleErrors = cerr;
    if (!r.summary) {
      const failed = t.checks.filter((c) => !c.ok);
      r.summary = r.error ? r.error.split('\n')[0].slice(0, 160)
        : failed.length ? `${failed.length} check(s) failed: ${failed.map((c) => c.label).join('; ')}`.slice(0, 160)
          : `${t.checks.length} checks ok${t.notes.length ? ' · ' + t.notes[0] : ''}`.slice(0, 160);
    }
    render();
  }
  RUN_INFO.ended = now();
  render();
}
