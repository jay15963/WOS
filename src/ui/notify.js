// Reusable top notification: slides down from the top edge, auto-hides (or stays until tapped / closed).
//   notify(text, { sub, kind: 'info'|'good'|'warn'|'update', icon, ms, sticky, onClick, key }) → { close, el }
// A second call with the same `key` replaces the first one. Works before any game exists (main menu).

const CSS = `
.wos-notes { position: fixed; left: 50%; top: 0; transform: translateX(-50%); z-index: 400; display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding-top: calc(10px + env(safe-area-inset-top, 0px)); pointer-events: none; width: min(460px, calc(100vw - 20px)); }
.wos-note { pointer-events: auto; display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 14px 11px 12px; border-radius: 14px;
  background: linear-gradient(180deg, rgba(44,40,32,.97), rgba(26,24,20,.97)); color: #f1e9d6; font: 600 14px/1.3 var(--font, system-ui);
  border: 1px solid rgba(217,180,90,.45); box-shadow: 0 10px 30px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.08);
  transform: translateY(-140%); opacity: 0; transition: transform .45s cubic-bezier(.2,1.25,.35,1), opacity .3s; cursor: default; }
.wos-note.in { transform: none; opacity: 1; }
.wos-note.out { transform: translateY(-140%); opacity: 0; transition: transform .35s ease-in, opacity .3s; }
.wos-note.click { cursor: pointer; }
.wos-note .ni { flex: none; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-size: 18px;
  background: rgba(217,180,90,.16); color: #ffd98a; }
.wos-note .ni svg { width: 20px; height: 20px; }
.wos-note .nt { flex: 1; min-width: 0; }
.wos-note .nt small { display: block; margin-top: 2px; font-weight: 500; font-size: 12px; color: #b9b0a0; }
.wos-note .nx { flex: none; width: 28px; height: 28px; border-radius: 8px; border: 0; background: rgba(255,255,255,.06); color: #b9b0a0; font-size: 15px; cursor: pointer; }
.wos-note.good { border-color: rgba(127,220,106,.5); } .wos-note.good .ni { background: rgba(127,220,106,.16); color: #b8f0a0; }
.wos-note.warn { border-color: rgba(255,150,90,.5); } .wos-note.warn .ni { background: rgba(255,150,90,.16); color: #ffc49a; }
.wos-note.update { border-color: rgba(120,190,255,.6); } .wos-note.update .ni { background: rgba(120,190,255,.18); color: #b8dcff; }
`;

const ICON = {
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  good: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5L19.5 7"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.3"/></svg>',
  update: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/></svg>',
};

let box = null;
const live = new Map();

function ensure() {
  if (box && box.isConnected) return box;
  if (!document.getElementById('wos-note-css')) {
    const st = document.createElement('style'); st.id = 'wos-note-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  box = document.createElement('div');
  box.className = 'wos-notes';
  document.body.appendChild(box);
  return box;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function notify(text, { sub = '', kind = 'info', icon = null, ms = 3800, sticky = false, onClick = null, key = null } = {}) {
  const root = ensure();
  if (key && live.has(key)) live.get(key).close(true);
  const el = document.createElement('div');
  el.className = `wos-note ${kind}${onClick ? ' click' : ''}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="ni">${icon || ICON[kind] || ICON.info}</span><span class="nt">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>${sticky ? '<button class="nx" aria-label="Fechar">✕</button>' : ''}`;
  root.appendChild(el);
  let timer = null, closed = false;
  const api = {
    el,
    close(now = false) {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (key) live.delete(key);
      if (now) { el.remove(); return; }
      el.classList.remove('in'); el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    },
  };
  if (key) live.set(key, api);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  setTimeout(() => el.classList.add('in'), 60); // background tabs: rAF may not run
  el.addEventListener('click', (e) => {
    if (e.target.closest('.nx')) { api.close(); return; }
    if (onClick) { onClick(); api.close(); }
  });
  if (!sticky) timer = setTimeout(() => api.close(), ms);
  return api;
}
