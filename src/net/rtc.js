// WebRTC helpers: ICE servers, a tracer that logs every step of each RTCPeerConnection and explains
// failures in plain Portuguese, and a NAT test ("Testar minha rede").

import { netlog, describeCandidate, parseCandidate, classifyIp, maskIp } from './netlog.js';

// Public STUN servers (free): Google + Cloudflare. An optional TURN server can be saved in the
// settings (localStorage 'wos.turn' = { urls, username, credential }).
export const STUN_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// ---- Cloudflare TURN (via the WOS Worker in server/turn) ----
// The Worker returns short-lived credentials. Set its address here after `npx wrangler deploy`
// (or paste it in Settings, stored as localStorage 'wos.turnEndpoint').
export const TURN_ENDPOINT_DEFAULT = '';
let cfTurn = null; // { iceServers, expires }

export function turnEndpoint() {
  try { return (localStorage.getItem('wos.turnEndpoint') || TURN_ENDPOINT_DEFAULT || '').trim(); } catch { return TURN_ENDPOINT_DEFAULT; }
}
export function setTurnEndpoint(url) {
  try {
    url = String(url || '').trim();
    if (url) localStorage.setItem('wos.turnEndpoint', url); else localStorage.removeItem('wos.turnEndpoint');
    localStorage.removeItem('wos.turnCache');
  } catch { /* ignore */ }
  cfTurn = null;
}

// Fetch (or reuse) TURN credentials. Resolves true when TURN is available. Never throws.
export async function prepareIce({ force = false } = {}) {
  const ep = turnEndpoint();
  if (!ep) { netlog.fact('TURN', 'não configurado (só conexão direta)'); return false; }
  const fresh = (c) => c && c.expires > Date.now() + 10 * 60 * 1000 && Array.isArray(c.iceServers) && c.iceServers.length;
  if (!force && fresh(cfTurn)) return true;
  if (!force) {
    try { const c = JSON.parse(localStorage.getItem('wos.turnCache') || 'null'); if (fresh(c)) { cfTurn = c; netlog.fact('TURN', 'Cloudflare ativo (credenciais em cache)'); return true; } } catch { /* ignore */ }
  }
  const t0 = performance.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(ep, { cache: 'no-store', signal: ctl.signal });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ? `${data.error}${data.status ? ' (' + data.status + ')' : ''}` : 'HTTP ' + res.status);
    const servers = (data.iceServers || []).filter((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
    if (!servers.length) throw new Error('resposta sem servidores TURN');
    cfTurn = { iceServers: servers, expires: Date.now() + (data.ttl || 3600) * 1000 };
    try { localStorage.setItem('wos.turnCache', JSON.stringify(cfTurn)); } catch { /* ignore */ }
    const n = servers.reduce((k, s) => k + [].concat(s.urls).length, 0);
    netlog.ok('turn', `TURN da Cloudflare pronto (${n} endereços, ${Math.round(performance.now() - t0)} ms)`);
    netlog.fact('TURN', 'Cloudflare ativo');
    return true;
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'tempo esgotado' : e.message;
    netlog.warn('turn', `Não foi possível obter credenciais TURN: ${msg}. Seguindo só com conexão direta.`);
    netlog.fact('TURN', 'falhou: ' + msg);
    return false;
  }
}

// Manual TURN (any provider), saved in Settings: localStorage 'wos.turn' = { urls, username, credential }
export function loadTurn() {
  try {
    const t = JSON.parse(localStorage.getItem('wos.turn') || 'null');
    return t && t.urls ? t : null;
  } catch { return null; }
}
export function saveTurn(t) {
  try { if (t && t.urls) localStorage.setItem('wos.turn', JSON.stringify(t)); else localStorage.removeItem('wos.turn'); } catch { /* ignore */ }
}
export function iceServers() {
  const list = STUN_SERVERS.slice();
  const turn = loadTurn();
  if (turn) list.push(turn);
  if (cfTurn && cfTurn.expires > Date.now()) list.push(...cfTurn.iceServers);
  return list;
}

let seq = 0;
const LEVEL = { failed: 'error', disconnected: 'warn', closed: 'info', connected: 'ok', completed: 'ok' };

// Attach logging to an RTCPeerConnection. label = route name (nostr / torrent / mqtt / manual / probe).
export function tracePC(pc, label) {
  const id = `${label}#${++seq}`;
  const t0 = performance.now();
  const el = () => ((performance.now() - t0) / 1000).toFixed(1) + 's';
  const counts = {};
  pc._wosId = id;
  const rec = pc._wos = { local: [], remote: [], snap: null, explained: false };
  // Some signaling networks (BitTorrent) pre-create offers that may never be answered. Events are
  // buffered and only written to the log once a remote peer is involved, so unused offers stay quiet.
  let active = false;
  const pending = [];
  const L = (level, msg, data) => { if (active) netlog.log(level, 'ice', msg, data); else if (pending.length < 60) pending.push([level, msg, data]); };
  const activate = () => {
    if (active) return;
    active = true;
    netlog.info('ice', `${id}: conexão WebRTC com outro jogador (criada há ${el()})`);
    for (const [lv, m, d] of pending) netlog.log(lv, 'ice', m, d);
    pending.length = 0;
  };
  L('info', `${id}: conexão WebRTC criada`);

  pc.addEventListener('icecandidate', (e) => {
    if (!e.candidate || !e.candidate.candidate) {
      L('info', `${id}: coleta de candidatos concluída (${el()})`, counts);
      return;
    }
    const c = parseCandidate(e.candidate.candidate);
    if (c) { counts[c.type] = (counts[c.type] || 0) + 1; rec.local.push(c); }
    L('info', `${id}: candidato local ${describeCandidate(e.candidate.candidate)}`);
  });
  pc.addEventListener('icecandidateerror', (e) => {
    // 701 = STUN/TURN unreachable from one interface (IPv6, VPN, or the connection finished first).
    // Usually harmless when another server or route works, so it's logged as info, not as a problem.
    const msg = `${id}: servidor STUN/TURN não respondeu (${e.errorCode || '?'} ${e.errorText || ''}) ${(e.url || '').replace(/\?.*/, '')}`;
    if (e.errorCode === 701) L('info', msg + ' — normal se outra rota funcionar');
    else L('warn', msg);
  });
  pc.addEventListener('signalingstatechange', () => {
    if (pc.remoteDescription) activate();
    L('info', `${id}: sinalização ${pc.signalingState}`);
  });
  pc.addEventListener('icegatheringstatechange', () => L('info', `${id}: coleta ${pc.iceGatheringState}`));
  pc.addEventListener('iceconnectionstatechange', () => {
    const s = pc.iceConnectionState;
    if (s !== 'new' && s !== 'closed') activate();
    L(LEVEL[s] || 'info', `${id}: ICE ${s} (${el()})`);
    if (s === 'connected' || s === 'completed') describeRoute(pc, id);
    if (s === 'failed') explainFailure(pc, id);
  });
  pc.addEventListener('connectionstatechange', () => {
    const s = pc.connectionState;
    L(LEVEL[s] || 'info', `${id}: conexão ${s} (${el()})`);
    if (s === 'failed') explainFailure(pc, id);
  });
  // what the OTHER player sent us: candidates inside the session description + trickled ones
  const remoteCand = (line, how) => {
    const c = parseCandidate(line);
    if (!c || !c.address) return;
    if (rec.remote.some((r) => r.address === c.address && r.port === c.port && r.protocol === c.protocol)) return;
    rec.remote.push(c);
    L('info', `${id}: candidato remoto (${how}) ${describeCandidate(line)}`);
  };
  const srd = pc.setRemoteDescription.bind(pc);
  pc.setRemoteDescription = (desc, ...rest) => {
    try {
      const sdp = desc && desc.sdp;
      if (sdp) {
        const lines = sdp.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l.startsWith('a=candidate:'));
        L('info', `${id}: descrição remota recebida (${desc.type}, ${lines.length} candidatos embutidos)`);
        lines.forEach((l) => remoteCand(l.slice(2), 'na descrição'));
      }
    } catch { /* ignore */ }
    return srd(desc, ...rest);
  };
  const aic = pc.addIceCandidate.bind(pc);
  pc.addIceCandidate = (cand, ...rest) => {
    try { if (cand && cand.candidate) remoteCand(cand.candidate, 'enviado depois'); } catch { /* ignore */ }
    return aic(cand, ...rest);
  };
  pc.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'checking' && !rec.snapTimers) {
      rec.snapTimers = [4000, 11000].map((ms) => setTimeout(() => snapshotPairs(pc, id, L), ms));
    }
  });
  pc.addEventListener('datachannel', (e) => traceChannel(e.channel, id));
  const create = pc.createDataChannel.bind(pc);
  pc.createDataChannel = (...a) => { const ch = create(...a); traceChannel(ch, id, () => active); return ch; };
  return id;
}

function traceChannel(ch, id, isActive = () => true) {
  ch.addEventListener('open', () => netlog.ok('dc', `${id}: canal de dados "${ch.label}" aberto`));
  ch.addEventListener('close', () => { if (isActive()) netlog.warn('dc', `${id}: canal de dados "${ch.label}" fechado`); });
  ch.addEventListener('error', (e) => netlog.error('dc', `${id}: erro no canal "${ch.label}": ${e.error?.message || e.message || 'desconhecido'}`));
}

async function statsOf(pc) {
  const st = await pc.getStats();
  const all = [];
  st.forEach((r) => all.push(r));
  return { st, all };
}

function routeKind(l, r) {
  if (l.candidateType === 'relay' || r.candidateType === 'relay') return 'via TURN (repetidor)';
  const vpn = /Radmin|Hamachi/.test(classifyIp(l.address)) || /Radmin|Hamachi/.test(classifyIp(r.address));
  if (vpn) return 'direta pela VPN (Radmin/Hamachi)';
  if (l.candidateType === 'host' && r.candidateType === 'host') return 'direta na mesma rede local';
  return 'direta pela internet (atravessou o NAT)';
}

async function describeRoute(pc, id) {
  try {
    const { st, all } = await statsOf(pc);
    let pair = null;
    const tr = all.find((r) => r.type === 'transport' && r.selectedCandidatePairId);
    if (tr) pair = st.get(tr.selectedCandidatePairId);
    if (!pair) pair = all.find((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded');
    if (!pair) return;
    const l = st.get(pair.localCandidateId) || {}, r = st.get(pair.remoteCandidateId) || {};
    const rtt = pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) + ' ms' : '?';
    const kind = routeKind(l, r);
    netlog.ok('ice', `${id}: rota escolhida ${kind}: local ${l.candidateType} ${l.protocol || ''} (${classifyIp(l.address || l.ip)}) ↔ remoto ${r.candidateType} ${r.protocol || ''} (${classifyIp(r.address || r.ip)}) · RTT ${rtt}`);
    netlog.fact('Rota da conexão', `${kind} · ${l.candidateType}↔${r.candidateType} · RTT ${rtt}`);
  } catch (e) { netlog.warn('ice', `${id}: não foi possível ler a rota: ${e.message}`); }
}

// Connectivity checks in progress: how many STUN checks went out / came back on each candidate pair.
async function snapshotPairs(pc, id, L) {
  if (pc.connectionState === 'connected' || pc.connectionState === 'closed') return;
  try {
    const { st, all } = await statsOf(pc);
    const pairs = all.filter((r) => r.type === 'candidate-pair');
    const sum = { pares: pairs.length, enviados: 0, respostas: 0, recebidos_do_outro: 0 };
    const states = {};
    for (const p of pairs) {
      sum.enviados += p.requestsSent || 0;
      sum.respostas += p.responsesReceived || 0;
      sum.recebidos_do_outro += p.requestsReceived || 0;
      states[p.state] = (states[p.state] || 0) + 1;
    }
    const top = pairs.slice(0, 4).map((p) => {
      const l = st.get(p.localCandidateId) || {}, r = st.get(p.remoteCandidateId) || {};
      return `${l.candidateType}→${r.candidateType}(${classifyIp(r.address || r.ip).replace(/ \(.*\)/, '')}) ${p.state} env ${p.requestsSent || 0}/resp ${p.responsesReceived || 0}/receb ${p.requestsReceived || 0}`;
    });
    pc._wos.snap = sum;
    L('info', `${id}: testes de conectividade em andamento`, { ...sum, estados: states, pares_exemplo: top });
  } catch { /* closed */ }
}

async function explainFailure(pc, id) {
  const rec = pc._wos || { local: [], remote: [] };
  if (rec.explained) return;
  rec.explained = true;
  let local = rec.local.map((c) => c.type), remote = rec.remote.map((c) => c.type);
  let snap = rec.snap;
  try {
    // fresher data if the connection is still readable
    const { all } = await statsOf(pc);
    const lc = all.filter((r) => r.type === 'local-candidate').map((c) => c.candidateType);
    const rc = all.filter((r) => r.type === 'remote-candidate').map((c) => c.candidateType);
    if (lc.length) local = lc;
    if (rc.length) remote = rc;
    const pairs = all.filter((r) => r.type === 'candidate-pair');
    if (pairs.length) {
      snap = { pares: pairs.length, enviados: 0, respostas: 0, recebidos_do_outro: 0 };
      for (const p of pairs) { snap.enviados += p.requestsSent || 0; snap.respostas += p.responsesReceived || 0; snap.recebidos_do_outro += p.requestsReceived || 0; }
    }
  } catch { /* already closed: use what was recorded */ }
  const pub = (list) => list.some((t) => t === 'srflx' || t === 'relay' || t === 'prflx');
  const uniq = (list) => [...new Set(list)].join(', ') || 'nenhum';
  let why;
  if (!remote.length) why = 'o outro jogador não enviou nenhum candidato (a troca pela rede de encontro não completou)';
  else if (!pub(remote)) why = 'o outro jogador não conseguiu descobrir o endereço público dele (UDP bloqueado ou STUN inacessível do lado dele)';
  else if (!pub(local)) why = 'seu navegador não conseguiu descobrir seu endereço público (UDP bloqueado/firewall do seu lado)';
  else if (local.includes('relay') || remote.includes('relay')) why = 'falhou até pelo TURN (repetidor): a rede de um dos dois bloqueia também o acesso a turn.cloudflare.com (firewall corporativo/escola?) ou a conexão caiu';
  else {
    why = 'os dois têm endereço público e trocaram endereços, mas nenhum pacote atravessou: NAT incompatível entre as duas redes (pelo menos um lado tem NAT simétrico ou bloqueio da operadora). Conexão direta não é possível nessa dupla — use um servidor TURN (Configurações → TURN)';
    if (snap && snap.enviados > 0 && snap.respostas === 0 && snap.recebidos_do_outro === 0) why += '. Nenhum pacote chegou em nenhum dos sentidos';
    else if (snap && snap.recebidos_do_outro > 0 && snap.respostas === 0) why += '. Os pacotes do outro chegaram até você, mas os seus não chegaram lá (o bloqueio está do lado dele)';
    else if (snap && snap.respostas > 0) why += '. Alguns pacotes passaram mas a conexão não se firmou (rede instável)';
  }
  netlog.error('ice', `${id}: conexão falhou — ${why}`, { locais: uniq(local), remotos: uniq(remote), testes: snap || 'sem dados' });
  netlog.fact('Última falha ICE', why);
}

// ---------- "Testar minha rede": gathers candidates against several STUN servers ----------
// Heuristic: an endpoint-independent NAT maps one local socket to ONE public ip:port for every
// server; a symmetric NAT hands out a different port per server (hole punching then usually fails).
export async function probeNetwork(timeoutMs = 7000) {
  netlog.info('nat', 'Teste de rede iniciado');
  const t0 = performance.now();
  const out = { verdict: 'erro', label: '', detail: '', ms: 0 };
  let pc;
  try {
    pc = new RTCPeerConnection({ iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' },
    ] });
  } catch (e) {
    out.label = 'WebRTC indisponível neste navegador';
    out.detail = e.message;
    netlog.error('nat', out.label, e.message);
    netlog.fact('Teste de rede', out.label);
    return out;
  }
  const cands = [], errors = [];
  pc.onicecandidate = (e) => { if (e.candidate && e.candidate.candidate) { const c = parseCandidate(e.candidate.candidate); if (c) cands.push(c); } };
  pc.onicecandidateerror = (e) => errors.push(`${e.errorCode || ''} ${(e.url || '').replace(/\?.*/, '')}`);
  pc.createDataChannel('probe');
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((res) => {
      const done = () => { if (pc.iceGatheringState === 'complete') res(); };
      pc.onicegatheringstatechange = done;
      setTimeout(res, timeoutMs);
    });
  } catch (e) { errors.push(e.message); }
  pc.close();
  out.ms = Math.round(performance.now() - t0);

  const udp = cands.filter((c) => c.protocol === 'udp');
  const hosts = udp.filter((c) => c.type === 'host');
  const srflx = udp.filter((c) => c.type === 'srflx');
  const mappings = new Set(srflx.map((c) => c.address + ':' + c.port));
  const pubIps = new Set(srflx.map((c) => c.address));
  const ipv6 = srflx.some((c) => c.address.includes(':')) || hosts.some((c) => c.address.includes(':') && classifyIp(c.address) === 'IPv6 público');
  const vpn = hosts.some((c) => /Radmin|Hamachi/.test(classifyIp(c.address)));
  const hostCount = Math.max(1, hosts.length);
  out.candidates = { host: hosts.length, srflx: srflx.length, mapeamentos: mappings.size, ipsPublicos: pubIps.size };
  for (const c of cands) netlog.info('nat', `candidato ${c.type} ${c.protocol} ${maskIp(c.address)}:${c.port} (${classifyIp(c.address)})`);
  if (errors.length) netlog.warn('nat', `erros de STUN durante o teste: ${errors.slice(0, 4).join(' | ')}`);

  if (!srflx.length) {
    out.verdict = 'bloqueado';
    out.label = 'UDP bloqueado ou STUN inacessível';
    out.detail = 'Seu navegador não descobriu seu endereço público. Conexão direta provavelmente vai falhar: tente outra rede, Radmin VPN ou um servidor TURN.';
  } else if (hosts.some((h) => srflx.some((s) => s.address === h.address))) {
    out.verdict = 'aberto';
    out.label = 'IP público direto (sem NAT)';
    out.detail = 'Ótimo: seu computador recebe conexões direto. Você é um bom anfitrião.';
  } else if (mappings.size > hostCount) {
    out.verdict = 'simetrico';
    out.label = 'NAT simétrico (restritivo)';
    out.detail = 'Sua rede muda a porta para cada destino. Conectar com outro jogador de NAT restritivo pode falhar; com NAT compatível do outro lado costuma funcionar. Se falhar: Radmin VPN ou TURN.';
  } else {
    out.verdict = 'compativel';
    out.label = 'NAT compatível';
    out.detail = 'Sua rede mantém a mesma porta pública: a conexão direta (furar o NAT) deve funcionar na maioria dos casos, inclusive com CGNAT.';
  }
  if (ipv6) out.detail += ' Você também tem IPv6 público, o que ajuda.';
  if (vpn) out.detail += ' Radmin/Hamachi detectado: ele pode servir de caminho alternativo.';
  netlog.log(out.verdict === 'compativel' || out.verdict === 'aberto' ? 'ok' : 'warn', 'nat', `Resultado: ${out.label} (${out.ms} ms)`, out.candidates);
  netlog.fact('Teste de rede', `${out.label} · ${JSON.stringify(out.candidates)}`);
  return out;
}

// Settings → "Testar TURN": gets fresh credentials and asks the relay for an address
// (iceTransportPolicy 'relay' only gathers TURN candidates).
export async function testTurnRelay() {
  const ok = await prepareIce({ force: true });
  if (!ok) return { ok: false, msg: 'Não consegui credenciais: ' + (netlog.session.facts.TURN || 'endereço vazio') };
  let pc;
  try { pc = new RTCPeerConnection({ iceServers: cfTurn.iceServers, iceTransportPolicy: 'relay' }); } catch (e) { return { ok: false, msg: e.message }; }
  pc.createDataChannel('t');
  const found = await new Promise((res) => {
    const t = setTimeout(() => res(null), 7000);
    pc.onicecandidate = (e) => { if (e.candidate && / typ relay /.test(e.candidate.candidate)) { clearTimeout(t); res(e.candidate.candidate); } };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => res(null));
  });
  pc.close();
  if (found) {
    netlog.ok('turn', `Teste do TURN: o repetidor respondeu (${describeCandidate(found)})`);
    return { ok: true, msg: 'TURN funcionando: o repetidor da Cloudflare respondeu.' };
  }
  netlog.warn('turn', 'Teste do TURN: o repetidor não respondeu em 7 s');
  return { ok: false, msg: 'Credenciais OK, mas o repetidor não respondeu em 7 s (rede bloqueando?)' };
}
