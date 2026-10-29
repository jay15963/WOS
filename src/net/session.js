// Multiplayer session (co-op, host-authoritative in the host's browser). docs/SYNC.md §3.
// Transport: TrysteroLink (code) / ManualLink (codes by hand) / BroadcastLink (?link=bc, automated tests).
//
// Join: guest → hello {v, build, art, pid, name, look}; host checks protocol / build / atlas digest →
// welcome {seed, hour, day, weather, wt, …} (or reject {reason, msg}); the guest generates the seed world
// as a guest (no local creatures / regrowth / world save), sends ready; the host answers with the world
// snapshot (chunks ≤ 48 KB) and from then on the guest is `synced`: it receives every op batch (ops), the
// creature stream (ents), cosmetic events (fx), owner messages (own), digests (dg) and acks to its requests.
//
// Messages: hello welcome reject ready snap st sts lk chat ping pong left bye rq ack ops own ents fx dg dgx dgr
// Presence (st / sts, 12 Hz) carries the sender clock (ts / ht): remote players are interpolated in the
// sender's time with a min-filtered clock offset (stable on TURN jitter).

import { TrysteroLink, ManualLink, BroadcastLink, NETWORKS } from './links.js';
import { netlog, PROTO, BUILD, runtime } from './netlog.js';
import { prepareIce } from './rtc.js';
import { stepGait } from '../game/anim.js';
import { serializeWorld, applyWorld } from './snapshot.js';
import { EntityServer, EntityClient, ClockSync } from './entities.js';
import { DigestHost, DigestGuest } from './digest.js';
import { releaseStations } from '../game/mut/structures.js';
import { clearAtlasCache } from '../engine/atlasCache.js';

const NAT_FAIL = 'A sala foi encontrada e vocês trocaram endereços, mas a conexão entre as duas redes falhou em todas as tentativas (NAT incompatível). Solução: TURN da Cloudflare em Configurações (copie o relatório se ele já estiver ativo).';
const QS = new URLSearchParams(location.search);
const DEV = /^(localhost|127\.|\[::1\])/.test(location.hostname);
const LINK_BC = QS.get('link') === 'bc';

export const MAX_PLAYERS = 4;
const SEND_HZ = 12;
const INTERP_DELAY = 0.12;     // s behind the newest presence sample (sender time)
const STALE_S = 12;            // drop a remote player after this long without data
const CHUNK = 48000;           // snapshot chunk (chars of JSON)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FACINGS = new Set(['s', 'n', 'e', 'w']);

export function newRoomCode() {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return [...a].map((n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
}
export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}
// one id per browser TAB (sessionStorage survives reloads of that tab, so reconnects keep the id,
// while two tabs/windows on the same PC are still different players)
export function playerId() {
  const forced = DEV ? QS.get('pid') : null; // tests: ?pid=<id> (iframes of one harness share sessionStorage)
  if (forced) return forced.slice(0, 12);
  try {
    let id = sessionStorage.getItem('wos.pid');
    if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('wos.pid', id); } // sync-ok: player id (playerId), never world state
    return id;
  } catch { return Math.random().toString(36).slice(2, 10); } // sync-ok: player id (playerId)
}
export function playerName() {
  try { return (localStorage.getItem('wos.name') || '').trim().slice(0, 18) || 'Sobrevivente'; } catch { return 'Sobrevivente'; }
}
export function setPlayerName(n) {
  try { localStorage.setItem('wos.name', String(n || '').trim().slice(0, 18)); } catch { /* ignore */ }
}

// ---- sanitizers for untrusted peer data ----
const num = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v, max = 32) => (typeof v === 'string' ? v.slice(0, max) : null);
const color = (c) => (Array.isArray(c) && c.length === 3 ? c.map((x) => num(x, 0, 1.5, 0.5)) : null);
function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  return {
    skin: color(l.skin) || [0.95, 0.8, 0.66], hair: str(l.hair, 16) || 'short', hairColor: color(l.hairColor) || [0.35, 0.22, 0.12],
    shirt: color(l.shirt) || [0.4, 0.5, 0.7], pants: color(l.pants) || undefined, beard: !!l.beard,
  };
}

function packState(p) {
  const a = p.action && p.action.t < 1 ? [p.action.type, +(+p.action.t).toFixed(2)] : 0;
  return {
    x: +p.x.toFixed(2), y: +p.y.toFixed(2), f: p.facing, mv: p.moving ? 1 : 0, a,
    w: p.weapon || 0, o: p.offhand || 0, ab: p.armor?.body || 0, ah: p.armor?.head || 0,
    hp: Math.round(p.hp || 0), mh: Math.round(p.maxHp || 100), d: p.dead ? 1 : 0, bl: p.blocking ? 1 : 0, lv: p.level || 1,
  };
}

export const versionMessage = (mine, host) => `Versões diferentes do jogo (sua ${mine || '?'}, anfitrião ${host || '?'}). Recarregue a página (Ctrl+Shift+R); se persistir, o anfitrião também deve recarregar.`;
export const GRAPHICS_BROKEN = 'Gráficos incompletos neste navegador: recarregue a página (Ctrl+Shift+R) antes de jogar em grupo.';

export class Session {
  constructor() {
    this.role = null;
    this.code = null;
    this.link = null;
    this.manuals = new Map();   // host: one ManualLink per manual guest
    this.game = null;
    this.pid = playerId();
    this.name = playerName();
    this.players = new Map();   // pid -> { pid, name, key, ent (drawn), av (latest, for host AI), rtt, last, look, synced, clk }
    this.keyToPid = new Map();
    this.hostKey = null;
    this.hostPid = null;
    this.listeners = {};
    this.sendAcc = 0; this.envAcc = 0; this.pingAcc = 0; this.lookAcc = 99;
    this.rtt = null;
    this.bubbles = new Map();   // pid -> { text, until }
    this.reconnects = 0;
    this.state = 'idle';        // idle | hosting | joining | syncing | connected | lost | hostgone | closed
    this.allList = [];          // host: [local player, ...synced remote avatars] (players.js)
    this.snapIn = null;         // guest: snapshot chunks being received
    this.lastResync = -1e9;
    this.lastError = null;
    this.ents = null;
    this.digest = null;
    this.hostClock = new ClockSync();
    window.session = this;      // debug handle
  }

  on(type, fn) { (this.listeners[type] ||= []).push(fn); return () => { this.listeners[type] = this.listeners[type].filter((f) => f !== fn); }; }
  emit(type, data) { for (const fn of this.listeners[type] || []) { try { fn(data); } catch (e) { console.error(e); } } }
  _setState(s, extra) { this.state = s; netlog.fact('Estado da sessão', s); this.emit('state', { state: s, ...extra }); }
  get count() { return this.players.size + 1; }
  get net() { return this.game?.net; }

  _newLink(role) {
    const cb = { onOpen: (k, i) => this._open(k, i), onClose: (k) => this._close(k), onData: (k, m) => this._data(k, m) };
    if (LINK_BC) return new BroadcastLink({ code: this.code, role, ...cb });
    return new TrysteroLink({ code: this.code, role, ...cb, onFail: () => this._linkFailed() });
  }

  // a peer was found on a network but WebRTC could not connect. When every network failed, stop waiting.
  _linkFailed() {
    const L = this.link;
    if (this.role !== 'guest' || !this._joinWait || !L || L.open) return;
    if (L.failures >= NETWORKS.length) {
      netlog.error('session', NAT_FAIL);
      netlog.fact('Falha ao entrar', NAT_FAIL);
      this._joinWait.reject(new Error(NAT_FAIL));
    }
  }

  // ---------------- host ----------------
  // returns false (and does nothing) when this browser's graphics are incomplete
  host(game, code = newRoomCode()) {
    if (runtime.atlasOk === false) {
      this.lastError = { reason: 'graphics', msg: GRAPHICS_BROKEN };
      netlog.error('session', 'Sala não criada: ' + GRAPHICS_BROKEN);
      game.events?.emit('error', { text: GRAPHICS_BROKEN });
      return false;
    }
    this.role = 'host';
    this.code = code;
    game.net.role = 'host';
    game.net.pid = this.pid;
    game.player.pid = this.pid;
    this.attach(game);
    netlog.fact('Papel', 'anfitrião');
    netlog.fact('Sala', code);
    netlog.ok('session', `Sala ${code} criada (mundo ${game.world.seed}). Compartilhe o código com seus amigos.`);
    this.link = this._newLink('host');
    const link = this.link;
    if (LINK_BC) link.start();
    else prepareIce().finally(() => { if (this.link === link) link.start(); }); // TURN credentials first (if configured)
    this._setState('hosting');
    return true;
  }

  // manual pairing, host side (one guest per invite)
  async manualInvite() {
    if (this.role !== 'host') throw new Error('Crie uma sala primeiro');
    if (this._pendingManual && !this._pendingManual.open) this._pendingManual.close();
    await prepareIce();
    const ml = new ManualLink({ role: 'host', onOpen: (k, i) => this._open(k, i), onClose: (k) => this._close(k), onData: (k, m) => this._data(k, m) });
    this.manuals.set(ml.key, ml);
    this._pendingManual = ml;
    return ml.createOffer();
  }
  async manualAccept(answer) {
    if (!this._pendingManual) throw new Error('Gere um convite primeiro');
    await this._pendingManual.acceptAnswer(answer);
  }

  // ---------------- guest ----------------
  // Connect & handshake before the world exists. Resolves with the host's welcome (seed, time...).
  async join(code, { timeoutMs = 55000 } = {}) {
    this.role = 'guest';
    this.code = code;
    await runtime.atlasReady;
    if (runtime.atlasOk === false) {
      this.lastError = { reason: 'graphics', msg: GRAPHICS_BROKEN };
      netlog.error('session', GRAPHICS_BROKEN);
      throw new Error(GRAPHICS_BROKEN);
    }
    netlog.fact('Papel', 'convidado');
    netlog.fact('Sala', code);
    netlog.info('session', `Entrando na sala ${code}…`);
    this._setState('joining');
    this.link = this._newLink('guest');
    return this._awaitWelcome(timeoutMs, () => (LINK_BC ? this.link.start() : prepareIce().finally(() => this.link?.start())));
  }

  // manual pairing, guest side: paste the invite, returns the answer code; welcome arrives later
  async manualJoin(invite, { timeoutMs = 90000 } = {}) {
    this.role = 'guest';
    this.code = 'MANUAL';
    await runtime.atlasReady;
    if (runtime.atlasOk === false) throw new Error(GRAPHICS_BROKEN);
    netlog.fact('Papel', 'convidado (código manual)');
    this._setState('joining');
    await prepareIce();
    this.link = new ManualLink({ role: 'guest', onOpen: (k, i) => this._open(k, i), onClose: (k) => this._close(k), onData: (k, m) => this._data(k, m) });
    const answer = await this.link.acceptOffer(invite);
    this.welcome = this._awaitWelcome(timeoutMs, () => {});
    return answer;
  }

  _awaitWelcome(timeoutMs, start) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._joinWait = null;
        const why = this.link?.open ? 'conectou, mas o anfitrião não respondeu'
          : this.link?.failures ? NAT_FAIL
          : 'ninguém foi encontrado com esse código (sala fechada, código errado ou redes de encontro bloqueadas)';
        netlog.error('session', `Tempo esgotado ao entrar: ${why}`);
        netlog.fact('Falha ao entrar', why);
        this.close('timeout');
        reject(new Error('Tempo esgotado: ' + why));
      }, timeoutMs);
      this._joinWait = {
        resolve: (w) => { clearTimeout(timer); this._joinWait = null; resolve(w); },
        reject: (e) => { clearTimeout(timer); this._joinWait = null; this.close('rejected'); reject(e); },
      };
      start();
    });
  }

  // called once the game exists (host: immediately; guest: after the world was generated as a guest)
  attach(game) {
    this.game = game;
    game.session = this;
    game.net.session = this;
    if (this.role === 'host') {
      this.ents = new EntityServer(game, this);
      this.digest = new DigestHost(game, this);
      this._rebuildAll();
      return;
    }
    // guest: the host owns the weather and the world
    game.net.role = 'guest';
    game.net.pid = this.pid;
    game.player.pid = this.pid;
    game.env.weatherT = 1e9;
    this.ents = new EntityClient(game, this);
    this.digest = new DigestGuest(game, this);
    for (const pl of this.players.values()) if (!pl.ent) this._spawn(pl);
    if (this.welcomeInfo) this._applyWelcomeClock(this.welcomeInfo);
    this._sendReady(false);
  }

  _applyWelcomeClock(w) {
    const g = this.game;
    g.env.hour = w.hour; g.env.dayIndex = w.day; g.env.setWeather(w.weather); g.env.weatherT = 1e9;
    if (Number.isFinite(w.wt)) g.worldTime = w.wt;
  }

  _sendReady(resync) {
    const net = this.game.net;
    if (!resync) net.synced = false;
    this.snapIn = null;
    this._setState('syncing');
    this.sendHost({ t: 'ready', resync: resync ? 1 : 0 });
  }

  // ---------------- transport ----------------
  _hello() {
    return { t: 'hello', v: PROTO, build: BUILD, art: runtime.atlasDigest, pid: this.pid, name: this.name, look: this.game ? this.game.player.look : null };
  }

  _open(key, info) {
    netlog.info('session', `Canal aberto via ${info?.label || '?'}; apresentando-se`);
    if (this.role === 'guest') this._sendTo(key, this._hello()); // the host never introduces itself first
  }

  _sendTo(key, msg) {
    if (!key) return;
    const s = JSON.stringify(msg);
    if (this.game?.net) this.game.net.stats.bytesOut += s.length;
    if (key.startsWith('manual:') && this.role === 'host') this.manuals.get(key)?.send(key, s);
    else this.link?.send(key, s);
  }
  sendHost(msg) { if (this.hostKey) this._sendTo(this.hostKey, msg); }
  sendToPid(pid, msg) { const pl = this.players.get(pid); if (pl?.key) this._sendTo(pl.key, msg); }
  _broadcast(msg, exceptKey = null) {
    const s = JSON.stringify(msg);
    for (const pl of this.players.values()) {
      if (!pl.key || pl.key === exceptKey) continue;
      if (this.game?.net) this.game.net.stats.bytesOut += s.length;
      if (pl.key.startsWith('manual:')) this.manuals.get(pl.key)?.send(pl.key, s); else this.link?.send(pl.key, s);
    }
  }
  _broadcastSynced(msg) {
    const s = JSON.stringify(msg);
    for (const pl of this.players.values()) {
      if (!pl.key || !pl.synced) continue;
      this.game.net.stats.bytesOut += s.length;
      if (pl.key.startsWith('manual:')) this.manuals.get(pl.key)?.send(pl.key, s); else this.link?.send(pl.key, s);
    }
  }
  // net.flush(): one ordered op batch per frame to every synced guest
  broadcastOps(msg) { if (this.role === 'host') this._broadcastSynced(msg); }
  syncedGuests() { const out = []; for (const pl of this.players.values()) if (pl.synced && pl.key) out.push(pl); return out; }

  _close(key) {
    const pid = this.keyToPid.get(key);
    this.keyToPid.delete(key);
    if (this.role === 'guest' && key === this.hostKey) {
      this.hostKey = null;
      for (const pl of [...this.players.values()]) this._remove(pl.pid, true);
      if (this.state === 'hostgone' || this.state === 'closed') return;
      netlog.error('session', 'Conexão com o anfitrião perdida');
      this._setState('lost');
      this.emit('toast', { text: 'Conexão com o anfitrião perdida — tentando reconectar…', kind: 'warn' });
      this._reconnect();
      return;
    }
    if (pid) {
      const pl = this.players.get(pid);
      if (pl && pl.key === key) {
        this._remove(pid);
        if (this.role === 'host') this._broadcast({ t: 'left', pid });
      }
    }
  }

  _reconnect() {
    if (this.reconnects >= 3 || this.code === 'MANUAL') { this._hostGone('Não foi possível reconectar à sala.'); return; }
    this.reconnects++;
    netlog.warn('session', `Tentativa de reconexão ${this.reconnects}/3`);
    this.link?.close();
    this.link = this._newLink('guest');
    this._awaitWelcome(40000, () => (LINK_BC ? this.link.start() : prepareIce().finally(() => this.link?.start())))
      .then(() => this.emit('toast', { text: 'Reconectado à sala! Sincronizando…', kind: 'good' }))
      .catch(() => { if (this.state !== 'hostgone') setTimeout(() => this._reconnect(), 3000); });
  }

  // the host left for good: no silent switch to a half-simulated solo world
  _hostGone(why) {
    if (this.state === 'hostgone') return;
    netlog.error('session', `O anfitrião saiu: ${why}`);
    this.link?.close();
    this._setState('hostgone', { why });
    this.emit('hostgone', { why });
  }

  _data(key, raw) {
    let m = raw;
    if (typeof raw === 'string') {
      if (this.game?.net) this.game.net.stats.bytesIn += raw.length;
      try { m = JSON.parse(raw); } catch { return; }
    } else if (raw && this.game?.net) this.game.net.stats.bytesIn += JSON.stringify(raw).length;
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    const fromHost = this.role === 'guest' && key === this.hostKey;
    switch (m.t) {
      case 'hello': return this._onHello(key, m);
      case 'welcome': return this._onWelcome(key, m);
      case 'reject': return this._onReject(m);
      case 'ready': return this._onReady(key, m);
      case 'snap': if (fromHost) this._onSnap(m); return;
      case 'st': {
        const pid = this.keyToPid.get(key);
        if (pid && this.role === 'host') this._applyState(pid, m.s, num(m.ts, 0, 1e9, 0));
        return;
      }
      case 'sts': {
        if (!fromHost) return;
        const ht = num(m.ht, 0, 1e9, 0);
        if (ht) this.hostClock.sample(ht);
        if (Array.isArray(m.list)) for (const it of m.list.slice(0, MAX_PLAYERS)) {
          const pid = str(it?.pid, 12);
          if (!pid || pid === this.pid) continue;
          if (!this.players.has(pid)) this._addPlayer(pid, str(it.name, 18) || 'Jogador', null);
          const pl = this.players.get(pid);
          if (it.name) pl.name = str(it.name, 18);
          if (it.look) { pl.look = cleanLook(it.look); if (pl.ent && pl.look) pl.ent.look = pl.look; }
          this._applyState(pid, it.s, ht, this.hostClock);
        }
        if (m.env && this.game) this._applyEnv(m.env);
        return;
      }
      case 'rq': {
        const pid = this.keyToPid.get(key), pl = pid && this.players.get(pid);
        if (this.role !== 'host' || !pl || !pl.synced || !this.game) return;
        const ack = this.game.net.onRequest(pid, pl.av, m);
        this._sendTo(key, ack);
        return;
      }
      case 'ack': if (fromHost) this.game?.net.onAck(m); return;
      case 'ops': if (fromHost && this.game) this.game.net.onOps(m); return;
      case 'own': if (fromHost && this.game) this.game.net.onOwn(m); return;
      case 'ents': if (fromHost && this.ents) this.ents.onEnts(m); return;
      case 'fx': if (fromHost && this.ents) this.ents.onFx(m); return;
      case 'dg': if (fromHost && this.digest) this.digest.onDigest(m); return;
      case 'dgr': if (fromHost && this.digest) this.digest.onRows(m); return;
      case 'dgx': {
        const pid = this.keyToPid.get(key);
        if (this.role === 'host' && pid && this.digest) this.digest.onRequest(key, m);
        return;
      }
      case 'lk': {
        const pid = this.keyToPid.get(key);
        const pl = pid && this.players.get(pid);
        if (pl) { pl.look = cleanLook(m.look); if (pl.ent && pl.look) pl.ent.look = pl.look; }
        return;
      }
      case 'left': {
        const pid = str(m.pid, 12);
        if (fromHost && pid) this._remove(pid);
        return;
      }
      case 'chat': {
        const text = str(m.text, 140);
        if (!text) return;
        const pid = this.role === 'host' ? this.keyToPid.get(key) : str(m.pid, 12);
        if (!pid) return;
        const name = this.players.get(pid)?.name || str(m.name, 18) || 'Jogador';
        if (this.role === 'host') this._broadcast({ t: 'chat', pid, name, text }, key);
        this._showChat(pid, name, text);
        return;
      }
      case 'ping': this._sendTo(key, { t: 'pong', ts: m.ts }); return;
      case 'pong': {
        const ms = performance.now() - num(m.ts, 0, 1e12, 0);
        if (ms >= 0 && ms < 60000) {
          const pid = this.keyToPid.get(key);
          if (this.role === 'guest' && key === this.hostKey) this.rtt = ms;
          else if (pid && this.players.get(pid)) this.players.get(pid).rtt = ms;
          this.emit('rtt', {});
        }
        return;
      }
      case 'bye': {
        if (fromHost) { this._hostGone('o anfitrião fechou a sala'); return; }
        netlog.info('session', 'Outro jogador saiu da sala');
        this._close(key);
        return;
      }
    }
  }

  _onHello(key, m) {
    if (this.role !== 'host' || !this.game) return; // guests ignore hellos from other guests (mesh links)
    const pid = str(m.pid, 12), name = str(m.name, 18) || 'Jogador';
    if (!pid) return;
    if (m.v !== PROTO || m.build !== BUILD) {
      netlog.warn('session', `Recusado ${name}: versão ${m.build || '?'} (protocolo ${m.v}) ≠ ${BUILD} (protocolo ${PROTO})`);
      this._sendTo(key, { t: 'reject', reason: 'version', host: BUILD, mine: str(m.build, 24), msg: versionMessage(str(m.build, 24), BUILD) });
      return;
    }
    if (m.art !== runtime.atlasDigest) {
      netlog.warn('session', `Recusado ${name}: atlas ${m.art} ≠ ${runtime.atlasDigest}`);
      this._sendTo(key, { t: 'reject', reason: 'atlas', msg: 'Gráficos diferentes do anfitrião neste navegador.' });
      return;
    }
    if (!this.players.has(pid) && this.players.size >= MAX_PLAYERS - 1) {
      this._sendTo(key, { t: 'reject', reason: 'full', msg: `Sala cheia (${MAX_PLAYERS} jogadores)` });
      return;
    }
    const existing = this.players.get(pid);
    if (existing && existing.key !== key) { this.keyToPid.delete(existing.key); existing.key = key; existing.synced = false; this._rebuildAll(); }
    if (!existing) this._addPlayer(pid, name, key);
    const pl = this.players.get(pid);
    pl.name = name;
    pl.look = cleanLook(m.look);
    if (pl.ent && pl.look) pl.ent.look = pl.look;
    this.keyToPid.set(key, pid);
    const g = this.game, env = g.env;
    this._sendTo(key, {
      t: 'welcome', v: PROTO, build: BUILD, art: runtime.atlasDigest, hostPid: this.pid, hostName: this.name, seed: g.world.seed,
      hour: env.hour, day: env.dayIndex, weather: env.weather, wt: Math.round(g.worldTime * 100) / 100,
      players: [...this.players.values()].filter((p) => p.pid !== pid).map((p) => ({ pid: p.pid, name: p.name })),
    });
    netlog.ok('session', `${name} conectou (${this.count}/${MAX_PLAYERS}); aguardando a sincronização do mundo`);
    netlog.fact('Jogadores', this.count);
    if (!existing) this.emit('toast', { text: `${name} entrou no mundo`, kind: 'good' });
    this.emit('players', {});
  }

  _onWelcome(key, m) {
    if (this.role !== 'guest') return;
    if (m.v !== PROTO || (m.build && m.build !== BUILD)) {
      const msg = versionMessage(BUILD, str(m.build, 24));
      this.lastError = { reason: 'version', msg };
      this._joinWait?.reject(new Error(msg));
      return;
    }
    this.hostKey = key;
    this.hostPid = str(m.hostPid, 12);
    this.link.keepOnly?.(key);
    this.keyToPid.set(key, this.hostPid);
    const hostName = str(m.hostName, 18) || 'Anfitrião';
    if (!this.players.has(this.hostPid)) this._addPlayer(this.hostPid, hostName, key);
    const hp = this.players.get(this.hostPid);
    hp.host = true; hp.key = key;
    const welcome = {
      seed: num(m.seed, -2147483648, 4294967295, 1) | 0, hour: num(m.hour, 0, 24, 8), day: num(m.day, 1, 1e6, 1) | 0,
      weather: str(m.weather, 12) || 'clear', wt: num(m.wt, 0, 1e9, 0), hostName,
    };
    this.welcomeInfo = welcome;
    netlog.ok('session', `Bem-vindo! Anfitrião: ${hostName}, mundo ${welcome.seed}`);
    netlog.fact('Mundo', welcome.seed);
    this.reconnects = 0;
    if (this._joinWait) this._joinWait.resolve(welcome);
    if (this.game) { this._applyWelcomeClock(welcome); this._sendReady(true); } // reconnect: resync the world
  }

  _onReject(m) {
    const reason = str(m.reason, 16) || '';
    let msg = str(m.msg, 300) || str(m.reason, 120) || 'recusado';
    if (reason === 'version') msg = versionMessage(BUILD, str(m.host, 24));
    if (reason === 'atlas') {
      let tried = false;
      try { tried = sessionStorage.getItem('wos.atlasRetry') === '1'; } catch { /* ignore */ }
      if (!tried && !QS.has('nosave')) {
        try { sessionStorage.setItem('wos.atlasRetry', '1'); } catch { /* ignore */ }
        netlog.warn('session', 'Atlas diferente do anfitrião: limpando o cache de gráficos e recarregando');
        clearAtlasCache().finally(() => location.reload());
        return;
      }
      msg = 'Gráficos corrompidos neste navegador — limpe os dados do site (Configurações → Apagar todos os dados) e recarregue.';
    }
    this.lastError = { reason, msg };
    netlog.error('session', `O anfitrião recusou: ${msg}`);
    this._joinWait?.reject(new Error(msg));
  }

  // host: a guest generated its world and wants the current state (join or resync)
  _onReady(key, m) {
    if (this.role !== 'host' || !this.game) return;
    const pid = this.keyToPid.get(key), pl = pid && this.players.get(pid);
    if (!pl) return;
    const net = this.game.net;
    net.flush(); // ops already applied go out first (seq ≤ snapshot seq: the guest skips them)
    const json = JSON.stringify(serializeWorld(this.game));
    const n = Math.max(1, Math.ceil(json.length / CHUNK));
    for (let i = 0; i < n; i++) this._sendTo(key, { t: 'snap', i, n, d: json.slice(i * CHUNK, (i + 1) * CHUNK) });
    pl.synced = true;
    this.ents?.resetGuest(pid);
    this._rebuildAll();
    if (m.resync) net.stats.resyncs++;
    netlog.ok('session', `${pl.name}: ${m.resync ? 'ressincronizado' : 'mundo enviado'} (${Math.round(json.length / 1024)} KB, seq ${net.seq})`);
    this.emit('players', {});
  }

  // guest: snapshot chunks
  _onSnap(m) {
    const n = num(m.n, 1, 10000, 1) | 0, i = num(m.i, 0, n - 1, 0) | 0;
    if (!this.snapIn || this.snapIn.n !== n || i === 0) this.snapIn = { n, parts: new Array(n), got: 0 };
    const S = this.snapIn;
    if (S.parts[i] == null && typeof m.d === 'string') { S.parts[i] = m.d; S.got++; }
    if (S.got < S.n) return;
    this.snapIn = null;
    let data;
    try { data = JSON.parse(S.parts.join('')); } catch (e) { netlog.error('sync', 'Snapshot do mundo inválido: ' + e.message); return; }
    const g = this.game, net = g.net;
    this.ents?.clear();
    applyWorld(g, data, 'net');
    net.seq = data.seq | 0;
    net.stats.lastSeq = net.seq;
    net.synced = true;
    netlog.ok('sync', `Mundo sincronizado (seq ${net.seq}, ${data.structs?.length || 0} construções, ${data.loot?.length || 0} itens no chão)`);
    this._setState('connected');
    this.emit('synced', { seq: net.seq });
  }

  // guest: ask the host for a fresh snapshot (rate-limited)
  requestResync(why = 'manual') {
    if (this.role !== 'guest' || !this.hostKey || !this.game) return false;
    const now = performance.now() / 1000;
    if (why !== 'manual' && now - this.lastResync < 30) return false;
    this.lastResync = now;
    this.game.net.stats.resyncs++;
    netlog.warn('sync', `Pedindo ressincronização ao anfitrião (${why})`);
    if (why === 'lacuna de ops' || why === 'op desconhecida') this.game.net.synced = false;
    this.sendHost({ t: 'ready', resync: 1 });
    return true;
  }

  // ---------------- players ----------------
  _addPlayer(pid, name, key) {
    const pl = { pid, name, key, ent: null, av: null, rtt: null, last: performance.now(), look: null, synced: false, clk: new ClockSync() };
    this.players.set(pid, pl);
    if (key) this.keyToPid.set(key, pid);
    if (this.game) this._spawn(pl);
    this.emit('players', {});
    return pl;
  }

  _spawn(pl) {
    const g = this.game;
    const sp = g.world.spawn;
    pl.ent = {
      isEntity: true, kind: 'pawn', remote: true, faction: 'friend', pid: pl.pid, name: pl.name,
      x: sp.x, y: sp.y, r: 0.24, facing: 's', moving: false, moveT: 0, action: null, flash: 0,
      look: pl.look || { skin: [0.95, 0.8, 0.66], hair: 'short', hairColor: [0.3, 0.2, 0.12], shirt: [0.55, 0.42, 0.3] },
      weapon: null, offhand: null, armor: { body: null, head: null }, hp: 100, maxHp: 100, level: 1, dead: false,
      _buf: [], _seen: false,
    };
    // the host's AI / hit checks use the LATEST position (avatar), not the interpolated drawing
    pl.av = { isEntity: true, kind: 'pawn', avatar: true, remote: true, pid: pl.pid, name: pl.name, x: sp.x, y: sp.y, r: 0.24, facing: 's', moving: false,
      speed: 4, vx: 0, vy: 0, hp: 100, maxHp: 100, level: 1, dead: false, blocking: false, passDoors: true, gone: false, ent: pl.ent, lastHitSkin: false };
    g.entities.push(pl.ent);
  }

  _remove(pid, quiet = false) {
    const pl = this.players.get(pid);
    if (!pl) return;
    this.players.delete(pid);
    if (pl.av) pl.av.gone = true;
    if (pl.ent && this.game) {
      const i = this.game.entities.indexOf(pl.ent);
      if (i >= 0) this.game.entities.splice(i, 1);
    }
    if (this.role === 'host' && this.game) { releaseStations(this.game, pid); this.ents?.dropGuest(pid); }
    this._rebuildAll();
    if (!quiet) {
      netlog.info('session', `${pl.name} saiu da sala`);
      this.emit('toast', { text: `${pl.name} saiu do mundo`, kind: 'warn' });
    }
    netlog.fact('Jogadores', this.count);
    this.emit('players', {});
  }

  _rebuildAll() {
    if (!this.game) return;
    const L = [this.game.player];
    if (this.role === 'host') for (const pl of this.players.values()) if (pl.synced && pl.av && !pl.av.gone) L.push(pl.av);
    this.allList = L;
  }

  // presence sample (sender clock ts): drawn copy (interpolated) + host avatar (latest)
  _applyState(pid, s, ts, clock = null) {
    const pl = this.players.get(pid);
    if (!pl || !s || typeof s !== 'object') return;
    pl.last = performance.now();
    const e = pl.ent;
    if (!e) { pl.pending = [s, ts]; return; }
    const W = this.game.world;
    const x = num(s.x, 0, W.W, e.x), y = num(s.y, 0, W.H, e.y);
    const clk = clock || pl.clk;
    if (ts && !clock) clk.sample(ts);
    const t = ts || performance.now() / 1000;
    const B = e._buf;
    const prev = B[B.length - 1];
    if (prev && t <= prev.t) { /* out of order / duplicate sample */ } else {
      if (prev && Math.hypot(x - prev.x, y - prev.y) > 6) { B.length = 0; e.x = x; e.y = y; } // teleport / respawn: snap
      B.push({ t, x, y });
      if (B.length > 24) B.shift();
    }
    if (!e._seen) { e.x = x; e.y = y; e._seen = true; }
    if (FACINGS.has(s.f)) e.facing = s.f;
    e.netMoving = !!s.mv;
    if (Array.isArray(s.a) && typeof s.a[0] === 'string') {
      const type = s.a[0].slice(0, 16), at = num(s.a[1], 0, 1, 0);
      if (!e.action || e.action.type !== type || at < e.action.t - 0.05) e.action = { type, t: at, dur: 0.4, remote: true };
      else e.action.t = Math.max(e.action.t, at);
    } else e.action = null;
    e.weapon = str(s.w, 32) || null;
    e.offhand = str(s.o, 32) || null;
    e.armor = { body: str(s.ab, 32) || null, head: str(s.ah, 32) || null };
    e.maxHp = num(s.mh, 1, 99999, 100);
    e.hp = num(s.hp, 0, e.maxHp, e.maxHp);
    if (!e.dead && s.d) e.deadT = 0;
    e.dead = !!s.d;
    e.blocking = !!s.bl;
    e.level = num(s.lv, 1, 999, 1) | 0;
    e.name = pl.name;
    const av = pl.av;
    if (av) {
      const dt = av._t != null ? t - av._t : 0;
      if (dt > 0.02 && dt < 1) { av.vx = (x - av.x) / dt; av.vy = (y - av.y) / dt; } else if (dt >= 1) { av.vx = av.vy = 0; }
      if (!s.mv) av.vx = av.vy = 0;
      av._t = t;
      av.x = x; av.y = y; av.facing = e.facing; av.moving = !!s.mv; av.dead = e.dead; av.hp = e.hp; av.maxHp = e.maxHp;
      av.level = e.level; av.blocking = e.blocking; av.name = pl.name;
    }
  }

  _applyEnv(env) {
    const G = this.game, E = G.env;
    const h = num(env.h, 0, 24, E.hour);
    let dh = h - E.hour;
    if (dh > 12) dh -= 24; else if (dh < -12) dh += 24;
    if (Math.abs(dh) > 0.02) E.hour = h;
    E.dayIndex = num(env.d, 1, 1e6, E.dayIndex) | 0;
    const w = str(env.w, 12);
    if (w && w !== E.weather) { E.setWeather(w); }
    E.weatherT = 1e9;
    if (env.wt != null) {
      const wt = num(env.wt, 0, 1e9, G.worldTime);
      if (Math.abs(wt - G.worldTime) > 2) G.worldTime = wt; // the host's clock drives respawns, crops, decay
    }
  }

  // ---------------- chat ----------------
  say(text) {
    text = String(text || '').trim().slice(0, 140);
    if (!text) return;
    if (this.role === 'host') this._broadcast({ t: 'chat', pid: this.pid, name: this.name, text });
    else if (this.hostKey) this._sendTo(this.hostKey, { t: 'chat', text });
    this._showChat(this.pid, this.name, text);
  }
  _showChat(pid, name, text) {
    this.bubbles.set(pid, { text, until: performance.now() + 6000 });
    this.emit('chat', { pid, name, text, self: pid === this.pid });
  }

  // ---------------- per-frame (installed as a game system through netui) ----------------
  update(game, dt) {
    if (!this.game || this.state === 'closed' || this.state === 'hostgone') return;
    const p = game.player;
    const now = performance.now() / 1000;
    this.sendAcc += dt; this.envAcc += dt; this.pingAcc += dt; this.lookAcc += dt;
    if (this.sendAcc >= 1 / SEND_HZ) {
      this.sendAcc = 0;
      const s = packState(p);
      if (this.role === 'guest' && this.hostKey) {
        this._sendTo(this.hostKey, { t: 'st', s, ts: +now.toFixed(3) });
        if (this.lookAcc > 5) { this.lookAcc = 0; this._sendTo(this.hostKey, { t: 'lk', look: p.look }); }
      } else if (this.role === 'host' && this.players.size) {
        const withLook = this.lookAcc > 5;
        if (withLook) this.lookAcc = 0;
        const list = [{ pid: this.pid, name: this.name, s, look: withLook ? p.look : undefined }];
        for (const pl of this.players.values()) {
          if (!pl.ent || !pl.synced) continue;
          list.push({ pid: pl.pid, name: pl.name, s: packState(pl.av || pl.ent), look: withLook ? pl.look : undefined });
        }
        const msg = { t: 'sts', ht: +now.toFixed(3), list };
        if (this.envAcc > 2) { this.envAcc = 0; msg.env = { h: +game.env.hour.toFixed(3), d: game.env.dayIndex, w: game.env.weather, wt: Math.round(game.worldTime * 100) / 100 }; }
        this._broadcastSynced(msg);
      }
    }
    if (this.pingAcc > 3) {
      this.pingAcc = 0;
      const ts = performance.now();
      if (this.role === 'guest' && this.hostKey) this._sendTo(this.hostKey, { t: 'ping', ts });
      else this._broadcast({ t: 'ping', ts });
    }
    this.ents?.tick(dt);
    if (this.role === 'host') this.digest?.tick(dt);
    this._interpolate(dt, now);
  }

  // remote players: interpolated in the sender's clock, same gait clock as everyone (anim.js)
  _interpolate(dt, now) {
    for (const pl of this.players.values()) {
      const e = pl.ent;
      if (!e) continue;
      if (pl.pending) { const [s, ts] = pl.pending; pl.pending = null; this._applyState(pl.pid, s, ts); }
      const clk = this.role === 'guest' ? this.hostClock : pl.clk;
      const B = e._buf;
      if (B.length) {
        const rt = clk.ready ? now - clk.off - INTERP_DELAY : (B[B.length - 1].t - INTERP_DELAY);
        let a = B[0], b = B[B.length - 1];
        for (let i = B.length - 1; i > 0; i--) if (B[i - 1].t <= rt) { a = B[i - 1]; b = B[i]; break; }
        let x, y;
        if (rt <= a.t) { x = a.x; y = a.y; } else if (rt >= b.t) {
          const ex = Math.min(0.2, rt - b.t), prev = B.length > 1 ? B[B.length - 2] : b, span = Math.max(1e-3, b.t - prev.t);
          x = b.x + ((b.x - prev.x) / span) * ex * (e.netMoving ? 1 : 0);
          y = b.y + ((b.y - prev.y) / span) * ex * (e.netMoving ? 1 : 0);
        } else {
          const k = (rt - a.t) / Math.max(1e-3, b.t - a.t);
          x = a.x + (b.x - a.x) * k; y = a.y + (b.y - a.y) * k;
        }
        const d = Math.hypot(x - e.x, y - e.y);
        if (d > 6) { // teleport / respawn: snap, never interpolate across the map
          const last = B[B.length - 1];
          B.length = 0; B.push(last);
          e.x = last.x; e.y = last.y;
        } else { e.x = x; e.y = y; stepGait(e, Math.min(d, 1)); }
        e.moving = e.netMoving || d > 0.01;
      }
      if (e.action && !e.action.remote) e.action = null;
      if (e.action) { e.action.t = Math.min(1, e.action.t + dt / (e.action.dur || 0.4)); if (e.action.t >= 1) e.action = null; }
      if (performance.now() - pl.last > STALE_S * 1000 && !pl.host) {
        netlog.warn('session', `${pl.name} parou de enviar dados há ${STALE_S}s; removendo`);
        this._remove(pl.pid);
        if (this.role === 'host') this._broadcast({ t: 'left', pid: pl.pid });
      }
    }
  }

  // nameplates + chat bubbles on the overlay canvas (drawn after the regular overlay)
  render(game) {
    if (!this.game) return;
    const cv = document.getElementById('overlay');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = cv.width / Math.max(1, cv.clientWidth);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    const now = performance.now();
    const z = game.cam.zoom;
    const draw = (e, name, isSelf) => {
      const [sx, sy] = game.worldToScreen(e.x, e.y - 1.25);
      if (sx < -80 || sy < -80 || sx > cv.clientWidth + 80 || sy > cv.clientHeight + 80) return;
      if (!isSelf) {
        ctx.font = `700 ${z < 40 ? 11 : 12}px "Segoe UI", system-ui, sans-serif`;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.fillStyle = '#8fd0ff';
        const label = `${name}  ${e.level || 1}`;
        ctx.strokeText(label, sx, sy); ctx.fillText(label, sx, sy);
        if (e.hp < e.maxHp) {
          const w = 44, k = Math.max(0, e.hp / e.maxHp);
          ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(sx - w / 2 - 1, sy + 3, w + 2, 6);
          ctx.fillStyle = '#4fbf5a'; ctx.fillRect(sx - w / 2, sy + 4, w * k, 4);
        }
      }
      const b = this.bubbles.get(e === game.player ? this.pid : e.pid);
      if (b && b.until > now) {
        const a = Math.min(1, (b.until - now) / 600);
        ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
        const text = b.text.length > 42 ? b.text.slice(0, 40) + '…' : b.text;
        const tw = ctx.measureText(text).width + 14;
        const by = sy - (isSelf ? 4 : 18);
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(250,246,236,0.95)'; ctx.strokeStyle = 'rgba(30,26,22,0.85)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect?.(sx - tw / 2, by - 18, tw, 20, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2a241c'; ctx.fillText(text, sx, by - 4);
        ctx.globalAlpha = 1;
      }
    };
    for (const pl of this.players.values()) if (pl.ent && !pl.ent.dead) draw(pl.ent, pl.name, false);
    draw(game.player, this.name, true);
  }

  close(reason = 'saiu') {
    if (this.state === 'closed') return;
    try {
      if (this.role === 'guest' && this.hostKey) this._sendTo(this.hostKey, { t: 'bye' });
      else if (this.role === 'host') this._broadcast({ t: 'bye' });
    } catch { /* ignore */ }
    this.link?.close();
    for (const ml of this.manuals.values()) ml.close();
    for (const pid of [...this.players.keys()]) this._remove(pid, true);
    netlog.info('session', `Sessão encerrada (${reason})`);
    this._setState('closed');
    if (this.game) {
      this.ents?.clear?.();
      if (this.game.session === this) this.game.session = null;
      if (this.game.net.session === this) this.game.net.session = null;
      if (this.game.net.role === 'host') this.game.net.role = 'solo'; // the host keeps its world (solo again)
    }
  }
}
