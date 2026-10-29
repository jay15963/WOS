// Transport links. Every link is WebRTC (direct data channel between browsers); what changes is how
// the two players FIND each other (signaling):
//   TrysteroLink — short room code, matched through free public networks, tried in cascade:
//                  Nostr relays → BitTorrent trackers → MQTT brokers (the host listens on all of them).
//   ManualLink   — no network at all: the players exchange two long codes by hand (WhatsApp etc.).
//   BroadcastLink — tests only (?link=bc): same-origin tabs / iframes talk through a BroadcastChannel.
// Common callbacks: onOpen(key, info), onClose(key), onData(key, msg). send(key | null, msg).
// msg may be an object or an already-serialized JSON string; onData may deliver either (session parses).

import { netlog } from './netlog.js';
import { rtcConfig, tracePC, forceRelay } from './rtc.js';

const APP_ID = 'wos-survival-v1';
export const NETWORKS = [
  { id: 'nostr', label: 'Nostr', load: () => import('../../vendor/trystero/trystero-nostr.js') },
  { id: 'torrent', label: 'BitTorrent', load: () => import('../../vendor/trystero/trystero-torrent.js') },
  { id: 'mqtt', label: 'MQTT', load: () => import('../../vendor/trystero/trystero-mqtt.js') },
];
const CASCADE_MS = [0, 9000, 18000]; // guest: when to add each network if nobody was found yet

export class TrysteroLink {
  constructor({ code, role, onOpen, onClose, onData, onFail }) {
    this.code = code;
    this.role = role;
    this.cb = { onOpen, onClose, onData, onFail };
    this.failures = 0;        // peers found whose direct connection then failed
    this.rooms = new Map();   // netId -> { room, act, net, mod }
    this.peers = new Map();   // key -> { netId, peerId, act }
    this.timers = [];
    this.closed = false;
  }

  start() {
    netlog.info('signal', `${this.role === 'host' ? 'Abrindo' : 'Procurando'} a sala ${this.code} nas redes públicas de encontro`);
    if (forceRelay()) netlog.warn('signal', 'Modo de teste: conexão direta desativada, tudo passa pelo TURN');
    NETWORKS.forEach((net, i) => {
      const delay = this.role === 'host' ? 0 : CASCADE_MS[i];
      if (!delay) this._join(net);
      else this.timers.push(setTimeout(() => {
        if (this.closed || this.peers.size) return;
        netlog.warn('signal', `Nada encontrado ainda; tentando também a rede ${net.label}`);
        this._join(net);
      }, delay));
    });
  }

  get open() { return this.peers.size; }

  async _join(net) {
    if (this.closed || this.rooms.has(net.id)) return;
    const t0 = performance.now();
    netlog.info('signal', `${net.label}: carregando…`);
    let mod;
    try { mod = await net.load(); } catch (e) {
      netlog.error('signal', `${net.label}: não foi possível carregar a biblioteca (${e.message})`);
      return;
    }
    if (this.closed) return;
    const Traced = class extends RTCPeerConnection {
      constructor(cfg) { super(cfg); tracePC(this, net.id); }
    };
    let room;
    try {
      room = mod.joinRoom({
        appId: APP_ID,
        password: 'wos:' + this.code,   // encrypts the session descriptions exchanged on public relays
        rtcConfig: rtcConfig(),
        rtcPolyfill: Traced,
        relayConfig: { warnOnRelayFailure: true },
      }, 'sala-' + this.code, {
        onJoinError: (d) => {
          this.failures++;
          netlog.error('signal', `${net.label}: o outro jogador foi encontrado, mas a conexão direta falhou (${d.error})`);
          this.cb.onFail?.(net.id);
        },
      });
    } catch (e) {
      netlog.error('signal', `${net.label}: falha ao entrar na sala (${e.message})`);
      return;
    }
    const act = room.makeAction('m');
    this.rooms.set(net.id, { room, act, net, mod });
    netlog.ok('signal', `${net.label}: na sala (${Math.round(performance.now() - t0)} ms), aguardando o outro jogador…`);
    act.onMessage = (data, ctx) => {
      const key = net.id + ':' + ctx.peerId;
      if (!this.peers.has(key)) return;
      this.cb.onData?.(key, data);
    };
    room.onPeerJoin = (peerId) => {
      const key = net.id + ':' + peerId;
      this.peers.set(key, { netId: net.id, peerId, act });
      netlog.ok('signal', `${net.label}: conectado a um jogador (${peerId.slice(0, 6)})`);
      netlog.fact('Rede de encontro', net.label);
      this.cb.onOpen?.(key, { net: net.id, label: net.label });
    };
    room.onPeerLeave = (peerId) => {
      const key = net.id + ':' + peerId;
      if (!this.peers.delete(key)) return;
      netlog.warn('signal', `${net.label}: jogador desconectou (${peerId.slice(0, 6)})`);
      this.cb.onClose?.(key);
    };
    const check = (when) => {
      if (this.closed || !this.rooms.has(net.id)) return;
      let socks;
      try { socks = mod.getRelaySockets?.(); } catch { return; }
      if (!socks) return;
      const list = Array.isArray(socks) ? socks : Object.entries(socks).map(([url, s]) => ({ url, s }));
      let ok = 0; const bad = [];
      for (const it of list) {
        const sock = it.s?.socket || it.s || it.socket || it;
        const url = (it.url || sock?.url || '').replace('wss://', '');
        if (sock && sock.readyState === 1) ok++; else bad.push(url);
      }
      netlog.log(ok ? 'ok' : 'error', 'signal', `${net.label}: ${ok}/${list.length} servidores de encontro respondendo (${when})`, bad.length ? { sem_resposta: bad.slice(0, 8) } : undefined);
      netlog.fact('Encontro ' + net.label, `${ok}/${list.length} servidores`);
    };
    this.timers.push(setTimeout(() => check('após 5 s'), 5000), setTimeout(() => check('após 20 s'), 20000));
  }

  send(key, msg) {
    if (this.closed) return;
    if (key) {
      const p = this.peers.get(key);
      if (p) p.act.send(msg, { target: p.peerId }).catch(() => {});
      return;
    }
    for (const p of this.peers.values()) p.act.send(msg, { target: p.peerId }).catch(() => {});
  }

  // guest: once the host is found on one network, leave the others
  keepOnly(key) {
    const netId = key.split(':')[0];
    for (const [id, r] of this.rooms) {
      if (id === netId) continue;
      netlog.info('signal', `Saindo da rede ${r.net.label} (já conectado por ${netId})`);
      r.room.leave().catch(() => {});
      this.rooms.delete(id);
      for (const k of [...this.peers.keys()]) if (k.startsWith(id + ':')) this.peers.delete(k);
    }
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  async rtt(key) {
    const p = this.peers.get(key);
    const r = p && this.rooms.get(p.netId);
    if (!r) return null;
    try { return await r.room.ping(p.peerId); } catch { return null; }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.timers.forEach(clearTimeout);
    for (const r of this.rooms.values()) r.room.leave().catch(() => {});
    this.rooms.clear();
    this.peers.clear();
    netlog.info('signal', 'Saiu da sala');
  }
}

// ---------- manual pairing (no signaling network) ----------
const PREFIX = 'WOS1-';

async function pack(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let data = bytes, z = '0';
  if (typeof CompressionStream !== 'undefined') {
    const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    data = new Uint8Array(await new Response(cs).arrayBuffer());
    z = '1';
  }
  let bin = '';
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
  return PREFIX + z + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function unpack(code) {
  code = (code || '').trim().replace(/\s+/g, '');
  if (!code.startsWith(PREFIX)) throw new Error('Código inválido (deve começar com ' + PREFIX + ')');
  const z = code[PREFIX.length];
  let b64 = code.slice(PREFIX.length + 1).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  let data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  if (z === '1') {
    const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    data = new Uint8Array(await new Response(ds).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(data));
}

function gathered(pc, ms = 6000) {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, ms);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}

let manualSeq = 0;
export class ManualLink {
  constructor({ role, onOpen, onClose, onData }) {
    this.role = role;
    this.cb = { onOpen, onClose, onData };
    this.pc = null;
    this.ch = null;
    this.key = 'manual:' + (++manualSeq);
    this.closed = false;
  }
  get open() { return this.ch && this.ch.readyState === 'open' ? 1 : 0; }

  _pc() {
    const pc = new RTCPeerConnection(rtcConfig());
    tracePC(pc, 'manual');
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this._down();
    });
    this.pc = pc;
    return pc;
  }
  _wire(ch) {
    this.ch = ch;
    ch.onopen = () => { netlog.fact('Rede de encontro', 'código manual'); this.cb.onOpen?.(this.key, { net: 'manual', label: 'código manual' }); };
    ch.onclose = () => this._down();
    ch.onmessage = (e) => { if (typeof e.data === 'string') this.cb.onData?.(this.key, e.data); };
  }
  _down() {
    if (this._wasDown) return;
    this._wasDown = true;
    this.cb.onClose?.(this.key);
  }

  // host step 1
  async createOffer() {
    const pc = this._pc();
    this._wire(pc.createDataChannel('wos', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    netlog.info('manual', 'Código de convite gerado');
    return pack({ t: 'o', sdp: pc.localDescription.sdp });
  }
  // guest step: paste the host's code, get the answer code back
  async acceptOffer(code) {
    const o = await unpack(code);
    if (o.t !== 'o') throw new Error('Esse é um código de resposta, não de convite');
    const pc = this._pc();
    pc.ondatachannel = (e) => this._wire(e.channel);
    await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    netlog.info('manual', 'Código de resposta gerado');
    return pack({ t: 'a', sdp: pc.localDescription.sdp });
  }
  // host step 2
  async acceptAnswer(code) {
    const a = await unpack(code);
    if (a.t !== 'a') throw new Error('Esse é um código de convite, não de resposta');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
    netlog.info('manual', 'Resposta aplicada, conectando…');
  }

  send(key, msg) {
    if (this.ch && this.ch.readyState === 'open') this.ch.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  keepOnly() {}
  async rtt() {
    if (!this.pc) return null;
    try {
      const st = await this.pc.getStats();
      let rtt = null;
      st.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime * 1000; });
      return rtt;
    } catch { return null; }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.ch?.close(); this.pc?.close(); } catch { /* ignore */ }
  }
}

// ---------- BroadcastChannel (automated tests: ?link=bc) ----------
// Same interface as the other links; peers are same-origin tabs / iframes using the same room code.
// Handshake: a guest announces itself ('hi'), the host answers ('hi-ack') -> both open the link.
let bcSeq = 0;
export class BroadcastLink {
  constructor({ code, role, onOpen, onClose, onData }) {
    this.code = code;
    this.role = role;
    this.cb = { onOpen, onClose, onData };
    this.id = role[0] + Date.now().toString(36) + (++bcSeq) + crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    this.peers = new Map(); // key -> peer id
    this.failures = 0;
    this.closed = false;
    this.timer = null;
  }
  start() {
    if (this.closed) return;
    this.ch = new BroadcastChannel('wos-' + this.code);
    this.ch.onmessage = (e) => this._msg(e.data);
    netlog.info('signal', `BroadcastChannel: ${this.role === 'host' ? 'abrindo' : 'procurando'} a sala ${this.code} (teste local)`);
    this._post({ k: 'hi', role: this.role });
    if (this.role === 'guest') this.timer = setInterval(() => { if (!this.peers.size) this._post({ k: 'hi', role: 'guest' }); }, 700);
    addEventListener('pagehide', () => this.close());
  }
  get open() { return this.peers.size; }
  _post(o) { if (!this.closed) this.ch.postMessage({ ...o, from: this.id }); }
  _msg(m) {
    if (!m || m.from === this.id || (m.to && m.to !== this.id)) return;
    const key = 'bc:' + m.from;
    switch (m.k) {
      case 'hi':
        if (this.role === 'host' && m.role === 'guest') {
          if (!this.peers.has(key)) { this.peers.set(key, m.from); this._post({ k: 'hi-ack', to: m.from }); this.cb.onOpen?.(key, { net: 'bc', label: 'BroadcastChannel' }); }
          else this._post({ k: 'hi-ack', to: m.from });
        } else if (this.role === 'guest' && m.role === 'host' && !this.peers.size) this._post({ k: 'hi', role: 'guest' });
        return;
      case 'hi-ack':
        if (this.role === 'guest' && !this.peers.size) {
          this.peers.set(key, m.from);
          netlog.ok('signal', 'BroadcastChannel: conectado ao anfitrião');
          this.cb.onOpen?.(key, { net: 'bc', label: 'BroadcastChannel' });
        }
        return;
      case 'm': if (this.peers.has(key)) this.cb.onData?.(key, m.d); return;
      case 'bye': if (this.peers.delete(key)) this.cb.onClose?.(key); return;
    }
  }
  send(key, msg) {
    const d = typeof msg === 'string' ? msg : JSON.stringify(msg);
    if (key) { const id = this.peers.get(key); if (id) this._post({ k: 'm', to: id, d }); return; }
    for (const id of this.peers.values()) this._post({ k: 'm', to: id, d });
  }
  keepOnly() {}
  async rtt() { return null; }
  close() {
    if (this.closed) return;
    try { this._post({ k: 'bye' }); } catch { /* ignore */ }
    this.closed = true;
    clearInterval(this.timer);
    try { this.ch?.close(); } catch { /* ignore */ }
    this.peers.clear();
  }
}
