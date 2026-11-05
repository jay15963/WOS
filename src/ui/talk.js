// "Conversar" (docs/REINOS.md "Fase 2 — moradores e guardas"): the card of a talk with one of the settlements' people
// (game/people.js talkLines: by trade, season, the danger, the night; new players are pointed to the mural). Local UI:
// nothing is sent. Opened by E / a tap on a person (game event 'talk'); E / Espaço / a tap on the card goes on, Esc /
// "Tchau" / walking away closes it. The portrait is painted with the character editor's painter (art/look/preview.js).

import { PreviewAtlas, drawPawn2D, previewPawn } from '../art/look/preview.js';
import { bannerURL } from './heraldry.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let styled = false;
function style() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
#talkcard { position: absolute; left: 50%; bottom: 128px; transform: translate(-50%, 12px); width: min(560px, 92vw); display: flex; gap: 12px;
  padding: 10px 12px 10px 10px; opacity: 0; pointer-events: none; transition: opacity 0.22s ease, transform 0.22s ease; z-index: 30; }
#talkcard.on { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
#talkcard .tk-port { flex: none; width: 92px; height: 92px; border-radius: 8px; border: 2px solid var(--n-ink, #24160d);
  background: radial-gradient(circle at 50% 38%, #f6e8c8, #c9ad78 70%, #9a7c4c); box-shadow: inset 0 0 0 2px rgba(255,248,230,0.4); position: relative; overflow: hidden; }
#talkcard .tk-port canvas { width: 100%; height: 100%; display: block; }
#talkcard .tk-port img { position: absolute; right: 3px; bottom: 3px; width: 20px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.5)); }
#talkcard .tk-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
#talkcard .tk-name { font: 700 22px/1.05 var(--n-fd, serif); color: #fbf1dc; letter-spacing: 0.4px; text-shadow: 0 1px 0 #24160d; }
#talkcard .tk-sub { font: 600 13px/1.25 var(--n-fd, serif); color: #f0d48a; letter-spacing: 0.9px; text-transform: uppercase; margin-top: 2px; }
#talkcard .tk-line { font: 500 16px/1.4 system-ui, sans-serif; color: #f6ead0; margin: 8px 0 8px; min-height: 44px; }
#talkcard .tk-line b { color: #ffe39a; }
#talkcard .tk-btns { display: flex; gap: 10px; justify-content: flex-end; margin-top: auto; }
#talkcard .tk-btns .n-btn { min-height: 32px; font-size: 14px; }
#talkcard .tk-dots { font: 700 12px/1 var(--n-fd, serif); color: rgba(246,234,208,0.6); align-self: center; margin-right: auto; letter-spacing: 2px; }
`;
  document.head.appendChild(s);
}

export function installTalk(game, root) {
  if (typeof document === 'undefined' || !root) return null;
  style();
  const el = document.createElement('div');
  el.id = 'talkcard';
  el.className = 'n-panel';
  el.innerHTML = `<div class="tk-port"><canvas width="184" height="184"></canvas><img alt=""></div><div class="tk-main"><div class="tk-name"></div><div class="tk-sub"></div><div class="tk-line"></div><div class="tk-btns"><span class="tk-dots"></span><button class="n-btn" data-a="bye">Tchau</button><button class="n-btn primary" data-a="next">Continuar</button></div></div>`;
  root.appendChild(el);
  const $ = (s) => el.querySelector(s);
  let A = null, cur = null, lines = [], li = 0, typeT = null, shown = '', sentT = 0, sentN = 0;
  // the host's creature stands still while the card is open (intent npc.talk; sent again 1.5 s after opening — the host
  // may not have the player's newest position yet — then every 8 s)
  const hold = (e, on) => { if (e && e.nid != null) { sentT = performance.now(); sentN = on ? sentN + 1 : 0; if (game.net) game.net.request('npc.talk', { nid: e.nid, on: on ? 1 : 0 }); } };
  const portrait = (e) => {
    try {
      const cv = $('canvas'), ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      const view = 0.95, scale = cv.height / view;
      A = A || new PreviewAtlas(Math.max(1, Math.min(6, Math.round(scale / 64 + 0.25))));
      const p = previewPawn(e.look || e.npc?.look);
      p.facing = 's'; p.armor = { body: null, head: e.armor?.head || null }; p.scale = 1;
      drawPawn2D(ctx, A, p, 0.6, cv.width / 2, cv.height / 2 + 0.86 * scale, scale, { shadow: false });
    } catch (err) { console.warn('[talk] portrait', err); }
  };
  const type = (s) => {
    clearInterval(typeT);
    const L = $('.tk-line');
    shown = s; let n = 0;
    L.textContent = '';
    typeT = setInterval(() => { n += 2; L.textContent = s.slice(0, n); if (n >= s.length) clearInterval(typeT); }, 18);
  };
  const close = () => { if (!cur) return; hold(cur, false); cur = null; el.classList.remove('on'); clearInterval(typeT); game.ui.talk = null; };
  const next = () => {
    if (!cur) return;
    const L = $('.tk-line');
    if (L.textContent.length < shown.length) { clearInterval(typeT); L.textContent = shown; return; } // (the whole line first)
    li++;
    if (li >= lines.length) { close(); return; }
    type(lines[li]);
    $('.tk-dots').textContent = '•'.repeat(lines.length - li - 1);
    $('[data-a=next]').textContent = li === lines.length - 1 ? 'Tchau' : 'Continuar';
  };
  const open = (e) => {
    if (!e || !e.npc || e.dead || game.people?.fighting?.(e)) return;
    const P = e.npc, S = e.npcS || game.people?.of?.(P.sid);
    if (cur && cur !== e) hold(cur, false);
    cur = e; sentN = 0; lines = game.people?.lines?.(e) || []; li = 0;
    if (!lines.length) return;
    $('.tk-name').textContent = P.name;
    $('.tk-sub').innerHTML = `${esc(P.jobPt)} · ${esc(S?.name || '')}${S ? ` · Reino de ${esc(S.K.name)}` : ''}`;
    const img = $('.tk-port img');
    if (S?.K?.banner) { img.src = bannerURL(S.K.banner, 20, 30); img.style.display = ''; } else img.style.display = 'none';
    portrait(e);
    type(lines[0]);
    $('.tk-dots').textContent = '•'.repeat(lines.length - 1);
    $('[data-a=next]').textContent = lines.length > 1 ? 'Continuar' : 'Tchau';
    el.classList.add('on');
    game.ui.talk = e;
    hold(e, true);
    game.audio?.play('pickup', { volume: 0.25 });
  };
  el.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation();
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (a === 'bye') close(); else next();
  });
  game.events.on('talk', ({ e }) => { if (cur === e) next(); else open(e); });
  game.events.on('closepanels', () => close());
  // keys: E / Espaço go on, Esc closes (before the game sees them: no attack, no pause menu)
  addEventListener('keydown', (ev) => {
    if (!cur) return;
    if (ev.code === 'Escape') { close(); ev.stopPropagation(); ev.preventDefault(); }
    else if (ev.code === 'Space' || ev.code === 'Enter') { next(); ev.stopPropagation(); ev.preventDefault(); }
  }, true);
  // walking away, the person gone: the card closes
  setInterval(() => {
    if (!cur) return;
    const p = game.player;
    if (cur.dead || !game.entities.includes(cur) || p.dead || Math.hypot(cur.x - p.x, cur.y - p.y) > 4.5 || game.people?.fighting?.(cur)) close(); // (it went to fight: the talk is over)
    else if (performance.now() - sentT > (sentN < 2 ? 1500 : 8000)) hold(cur, true);
  }, 250);
  return { open, close };
}
