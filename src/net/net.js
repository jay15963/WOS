// Net core — the ONLY way shared state changes (docs/SYNC.md §3.2).
//
//   game.net.role: 'solo' | 'host' | 'guest'   (solo = host with zero peers: same code path)
//   net.request(intent, args, { refund, refundAt, onOk, onReject })   any gameplay code asking for a shared
//       change. Authority: runs the intent synchronously; guest: sends { t:'rq' } and waits for the host's
//       ack (no local prediction of shared state). `refund` items go back to the inventory on a reject.
//   net.emit(op, args)   authority only: applies the op locally (deterministic applier) and queues it for
//       broadcast; ops are sequenced (seq) and flushed once per frame to every synced guest.
//   net.toOwner(pid, name, args)   authority only: owner message (player.hurt …); local pid → immediate.
//   net.newId(prefix), net.roll()  authority only: id allocation / randomness (results go into op args).
//   net.applying   > 0 while an op / snapshot / deterministic layout is being applied (world mutation guard).
//
// Op args may carry owner effects: by (pid), xp, give {item: qty}, giveAt [x, y], toast, tip. After the
// applier runs, the peer whose pid === by applies them (mut/own.js) — appliers never touch game.player.
//
// Debug / test API (docs/SYNC.md §4.4): digest(), dump(part), diff(a, b), stats, ents, forceResync(), selfTest().

import { netlog } from './netlog.js';
import { INTENTS, OPS, OWN } from './registry.js';
import { applyOwnerEffects } from '../game/mut/own.js';

export { defineIntent, defineOp, defineOwn, INTENTS, OPS, OWN } from './registry.js';

const DEV = typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);
const isReject = (r) => r === false || typeof r === 'string';

export class Net {
  constructor(game) {
    this.game = game;
    this.role = 'solo';
    this.pid = 'local';
    this.seq = 0;            // authority: last seq assigned · guest: last seq applied
    this.queue = [];         // authority: [op, args] applied but not flushed yet
    this.queueSeq = 1;       // seq of queue[0]
    this.applying = 0;
    this.ids = { s: 0, f: 0, L: 0, m: 0 };
    this.rid = 0;
    this.pending = new Map(); // guest: rid -> { name, opts, t }
    this.session = null;
    this.synced = true;       // guest: false until the join snapshot is applied
    this.stats = { opsIn: 0, opsOut: 0, rq: 0, rejects: 0, bytesIn: 0, bytesOut: 0, desyncs: 0, resyncs: 0, lastSeq: 0, acks: 0 };
    this.entsApi = null;      // set by net/entities.js (host: server, guest: client)
    this._guardSites = new Set();
    this.hooks = {};          // digest / selfTest providers (installed by net/digest.js)
    game.world.guard = (name) => this._guard(name);
  }

  get auth() { return this.role !== 'guest'; }
  get ents() { return this.entsApi ? this.entsApi.debug() : null; }

  // ---------- mutation guard ----------
  _guard(name) {
    if (this.applying > 0) return;
    this.violation(`world.${name}() fora de uma op: estado compartilhado mudado sem replicação`);
  }
  // dev (localhost): throw; prod: netlog.error('sync') once per call site
  violation(msg) {
    if (DEV) throw new Error('[sync] ' + msg);
    const site = msg + ' @ ' + ((new Error().stack || '').split('\n').slice(3, 5).join(' | '));
    if (this._guardSites.has(site)) return;
    this._guardSites.add(site);
    netlog.error('sync', msg, site);
  }
  // run fn with the guard open (snapshot apply, deterministic camp layout, save load)
  withApply(fn) { this.applying++; try { return fn(); } finally { this.applying--; } }

  // ---------- authority helpers ----------
  newId(prefix) {
    if (!this.auth) this.violation(`net.newId('${prefix}') num convidado`);
    this.ids[prefix] = (this.ids[prefix] || 0) + 1;
    return prefix + this.ids[prefix].toString(36);
  }
  // bump id counters above ids already present (after a load)
  seeId(id) {
    if (typeof id !== 'string') return;
    const m = /^([a-zA-Z])([0-9a-z]+)$/.exec(id);
    if (!m || !(m[1] in this.ids)) return;
    const n = parseInt(m[2], 36);
    if (Number.isFinite(n) && n > this.ids[m[1]]) this.ids[m[1]] = n;
  }
  roll() {
    if (!this.auth) this.violation('net.roll() num convidado');
    return Math.random(); // sync-ok: authority randomness; every outcome travels in op args
  }

  // ---------- intents ----------
  request(name, args = {}, opts = {}) {
    const I = INTENTS[name];
    if (!I) { this.violation(`intent desconhecida: ${name}`); return false; }
    if (this.auth) {
      let r;
      try { r = I.run(this.game, args, { pid: this.pid, ent: this.game.player, local: true }, this); } catch (e) { console.error(e); r = 'erro interno'; }
      if (isReject(r)) { this._rejected(opts, r); return false; }
      opts.onOk?.(r);
      return true;
    }
    if (!this.session || !this.synced) { this._rejected(opts, 'Sem conexão com o anfitrião'); return false; }
    const rid = ++this.rid;
    this.pending.set(rid, { name, opts, t: performance.now() });
    this.stats.rq++;
    this.session.sendHost({ t: 'rq', r: rid, n: name, a: args });
    return null; // pending
  }
  _rejected(opts, why) {
    this.stats.rejects++;
    if (opts.refund) applyOwnerEffects(this.game, { by: this.pid, give: opts.refund, giveAt: opts.refundAt, quiet: true });
    opts.onReject?.(typeof why === 'string' ? why : '');
  }
  // guest: ack from the host (arrives after the op batch it produced)
  onAck(m) {
    const p = this.pending.get(m.r);
    if (!p) return;
    this.pending.delete(m.r);
    this.stats.acks++;
    if (m.ok) p.opts.onOk?.(m.res);
    else this._rejected(p.opts, typeof m.why === 'string' ? m.why.slice(0, 160) : '');
  }
  // host: request from a guest -> ack message (sent by the session after the flush)
  onRequest(pid, ent, m) {
    const I = typeof m.n === 'string' ? INTENTS[m.n] : null;
    let r;
    if (!I) r = 'intent desconhecida';
    else {
      try { r = I.run(this.game, m.a && typeof m.a === 'object' ? m.a : {}, { pid, ent, local: false }, this); } catch (e) {
        netlog.error('sync', `Intent ${m.n} de ${pid} falhou: ${e.message}`); if (DEV) console.error(e); r = 'erro no anfitrião';
      }
    }
    this.flush(); // the ack must reach the guest after the ops it caused (same ordered channel)
    if (isReject(r)) { this.stats.rejects++; return { t: 'ack', r: m.r, ok: 0, why: r || '' }; }
    return { t: 'ack', r: m.r, ok: 1, res: r && typeof r === 'object' ? r : undefined };
  }

  // ---------- ops ----------
  emit(name, args) {
    if (!this.auth) { this.violation(`net.emit('${name}') num convidado`); return; }
    if (!OPS[name]) { this.violation(`op desconhecida: ${name}`); return; }
    const seq = ++this.seq;
    if (!this.queue.length) this.queueSeq = seq;
    this._apply(name, args, seq);
    this.queue.push([name, args]);
    this.stats.opsOut++;
    this.stats.lastSeq = seq;
  }
  _apply(name, args, seq) {
    const ctx = { seq, mine: !!args && args.by != null && args.by === this.pid, net: this, auth: this.auth };
    this.applying++;
    try { OPS[name].apply(this.game, args, ctx); } catch (e) {
      netlog.error('sync', `Falha ao aplicar ${name} (seq ${seq}): ${e.message}`);
      if (DEV) console.error(e);
    } finally { this.applying--; }
    if (ctx.mine) applyOwnerEffects(this.game, args);
  }
  // end of every frame (and after each guest request): one ordered batch to every synced guest
  flush() {
    if (!this.queue.length) return;
    const msg = { t: 'ops', s: this.queueSeq, l: this.queue };
    this.queue = [];
    this.session?.broadcastOps?.(msg);
  }
  // guest: batch from the host
  onOps(m) {
    if (!this.synced || !Array.isArray(m.l)) return;
    const s0 = m.s | 0;
    for (let k = 0; k < m.l.length; k++) {
      const seq = s0 + k;
      if (seq <= this.seq) continue; // already contained in the snapshot
      if (seq !== this.seq + 1) {
        netlog.error('sync', `Dessincronia (lacuna de ops): esperava ${this.seq + 1}, chegou ${seq}`);
        this.requestResync('lacuna de ops');
        return;
      }
      const e = m.l[k];
      if (!Array.isArray(e) || !OPS[e[0]]) {
        netlog.error('sync', `Op desconhecida do anfitrião: ${Array.isArray(e) ? e[0] : '?'}`);
        this.requestResync('op desconhecida');
        return;
      }
      this.seq = seq;
      this._apply(e[0], e[1] || {}, seq);
      this.stats.opsIn++;
    }
    this.stats.lastSeq = this.seq;
  }

  // ---------- owner messages ----------
  toOwner(pid, name, args) {
    if (!this.auth) { this.violation('net.toOwner num convidado'); return; }
    if (pid == null || pid === this.pid) { this.onOwn({ n: name, a: args }); return; }
    this.session?.sendToPid?.(pid, { t: 'own', n: name, a: args });
  }
  onOwn(m) {
    const H = OWN[m.n];
    if (!H) return;
    try { H.apply(this.game, m.a || {}); } catch (e) { netlog.error('sync', `Mensagem ${m.n} falhou: ${e.message}`); if (DEV) console.error(e); }
  }

  // ---------- resync / debug ----------
  requestResync(why = 'manual') { return this.session?.requestResync?.(why) || false; }
  forceResync() { return this.requestResync('manual'); }
  digest() { return this.hooks.digest ? this.hooks.digest() : null; }
  dump(part) { return this.hooks.dump ? this.hooks.dump(part) : null; }
  diff(a, b) { return this.hooks.diff ? this.hooks.diff(a, b) : null; }
  selfTest() { return this.hooks.selfTest ? this.hooks.selfTest() : null; }
}
