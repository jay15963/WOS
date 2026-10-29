// WebRTC helpers: ICE servers, a tracer that logs every step of each RTCPeerConnection and explains
// failures in plain Portuguese, and a NAT test ("Testar minha rede").

import { netlog, describeCandidate, parseCandidate, classifyIp, maskIp } from './netlog.js';

// Public STUN servers (free): Google + Cloudflare. An optional TURN server can be saved in the
// settings (localStorage 'wos.turn' = { urls, username, credential }).
export const STUN_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

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
  const turn = loadTurn();
  return turn ? STUN_SERVERS.concat([turn]) : STUN_SERVERS.slice();
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
    if (c) counts[c.type] = (counts[c.type] || 0) + 1;
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

async function explainFailure(pc, id) {
  try {
    const { st, all } = await statsOf(pc);
    const local = all.filter((r) => r.type === 'local-candidate');
    const remote = all.filter((r) => r.type === 'remote-candidate');
    const pairs = all.filter((r) => r.type === 'candidate-pair');
    const types = (list) => [...new Set(list.map((c) => c.candidateType))].join(', ') || 'nenhum';
    const pstates = {};
    for (const p of pairs) pstates[p.state] = (pstates[p.state] || 0) + 1;
    let why;
    if (!remote.length) why = 'o outro jogador não enviou nenhum candidato (a troca pela sinalização não completou)';
    else if (!remote.some((c) => c.candidateType === 'srflx' || c.candidateType === 'relay' || c.candidateType === 'prflx')) why = 'o outro jogador não conseguiu descobrir o endereço público dele (UDP bloqueado ou STUN inacessível do lado dele)';
    else if (!local.some((c) => c.candidateType === 'srflx' || c.candidateType === 'relay')) why = 'seu navegador não conseguiu descobrir seu endereço público (UDP bloqueado/firewall do seu lado)';
    else why = 'os dois têm endereço público, mas nenhuma rota passou: NAT incompatível (provável NAT simétrico ou CGNAT restritivo). Solução: TURN ou Radmin VPN ligado nos dois';
    netlog.error('ice', `${id}: conexão falhou — ${why}`, { locais: types(local), remotos: types(remote), pares: pstates });
    netlog.fact('Última falha ICE', why);
    for (const c of remote.slice(0, 6)) netlog.info('ice', `${id}: candidato remoto ${c.candidateType} ${c.protocol || ''} ${maskIp(c.address || c.ip)} (${classifyIp(c.address || c.ip)})`);
    void st;
  } catch (e) { netlog.warn('ice', `${id}: falha ao analisar o erro: ${e.message}`); }
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
