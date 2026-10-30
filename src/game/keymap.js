// Remappable controls (desktop): every action has up to two bindings — keyboard codes (KeyboardEvent.code) or mouse
// buttons ('Mouse1' middle, 'Mouse3' / 'Mouse4' the side buttons; left and right click keep their own jobs).
// The bindings live in localStorage `wos.keys` ({ action: [code, code] }, only the changed ones) and are applied
// IN PLACE to the arrays the game reads (KEYS / ABILITY_KEYS / the movement and hotbar lists), so code that holds
// a reference sees the change at once; 'keymap' is emitted on window (HUD labels refresh).
// Settings → Controles (src/ui/keybinds.js) edits them.

export const MOUSE_CODES = ['Mouse1', 'Mouse3', 'Mouse4'];

// [id, label, group, default codes]
export const ACTIONS = [
  ['up', 'Andar para cima', 'move', ['KeyW', 'ArrowUp']],
  ['down', 'Andar para baixo', 'move', ['KeyS', 'ArrowDown']],
  ['left', 'Andar para a esquerda', 'move', ['KeyA', 'ArrowLeft']],
  ['right', 'Andar para a direita', 'move', ['KeyD', 'ArrowRight']],
  ['sprint', 'Correr', 'move', ['ShiftLeft', 'ShiftRight']],
  ['interact', 'Interagir', 'act', ['KeyE']],
  ['attack', 'Atacar', 'act', ['Space']],
  ['target', 'Próximo alvo', 'act', ['KeyZ']],
  ['eat', 'Comer', 'act', ['KeyF']],
  ['heal', 'Curar (ervas)', 'act', ['KeyV']],
  ['site', 'Materiais da obra (perto de plantas)', 'act', ['KeyO']],
  ['ab1', 'Habilidade 1', 'abil', ['KeyQ']],
  ['ab2', 'Habilidade 2', 'abil', ['KeyR']],
  ['ab3', 'Habilidade 3', 'abil', ['KeyG']],
  ['ab4', 'Habilidade 4', 'abil', ['KeyT']],
  ['ab5', 'Habilidade 5', 'abil', ['KeyX']],
  ...Array.from({ length: 10 }, (_, i) => [`hot${i + 1}`, `Barra · espaço ${(i + 1) % 10}`, 'hot', [`Digit${(i + 1) % 10}`, `Numpad${(i + 1) % 10}`]]),
  ['inv', 'Mochila', 'ui', ['Tab', 'KeyI']],
  ['craft', 'Criar itens', 'ui', ['KeyC']],
  ['build', 'Construir', 'ui', ['KeyB']],
  ['map', 'Mapa', 'ui', ['KeyM']],
  ['help', 'Atalhos (ajuda)', 'ui', ['KeyH', 'F1']],
  ['chat', 'Chat (multijogador)', 'ui', ['Enter']],
  ['zoomIn', 'Aproximar', 'ui', ['Equal', 'NumpadAdd']],
  ['zoomOut', 'Afastar', 'ui', ['Minus', 'NumpadSubtract']],
  ['rotate', 'Girar a construção', 'buildm', ['KeyR']],
  ['details', 'Detalhes da construção', 'buildm', ['KeyT']],
  ['confirm', 'Confirmar construção', 'buildm', ['Enter']],
];
export const GROUPS = { move: 'Movimento', act: 'Ações', abil: 'Habilidades (na ordem da barra)', hot: 'Barra de atalhos', ui: 'Janelas e câmera', buildm: 'Modo construção' };
// actions that may share a key with each other (they never run at the same time): build mode vs. playing
const BUILD_ONLY = new Set(['rotate', 'details', 'confirm']);
export const canShare = (a, b) => BUILD_ONLY.has(a) !== BUILD_ONLY.has(b) || (a === 'chat' && b === 'confirm') || (a === 'confirm' && b === 'chat');

const DEF = Object.fromEntries(ACTIONS.map(([id, , , d]) => [id, d.slice()]));
// the live binding arrays (mutated in place): BIND[id] = [code?, code?]
export const BIND = Object.fromEntries(ACTIONS.map(([id, , , d]) => [id, d.slice()]));

const KEY = 'wos.keys';
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!d || typeof d !== 'object') return;
    for (const id in d) if (BIND[id] && Array.isArray(d[id])) setList(id, d[id].filter((c) => typeof c === 'string' && c).slice(0, 2));
  } catch { /* ignore */ }
}
function save() {
  const out = {};
  for (const id in BIND) if (JSON.stringify(BIND[id]) !== JSON.stringify(DEF[id])) out[id] = BIND[id].slice();
  try { if (Object.keys(out).length) localStorage.setItem(KEY, JSON.stringify(out)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}
function setList(id, list) { const a = BIND[id]; a.length = 0; a.push(...list); }
const changed = () => { save(); try { dispatchEvent(new CustomEvent('keymap')); } catch { /* ignore */ } };

// bind `code` to slot (0 / 1) of action `id`; another action using it (one that cannot share) loses it.
// Returns the label of the action that lost it, if any.
export function bindKey(id, slot, code) {
  if (!BIND[id]) return null;
  let took = null;
  if (code) for (const [o, label] of ACTIONS) {
    if (o === id || canShare(id, o)) continue;
    const i = BIND[o].indexOf(code);
    if (i >= 0) { BIND[o].splice(i, 1); took = label; }
  }
  const a = BIND[id].slice();
  const j = a.indexOf(code);
  if (j >= 0 && j !== slot) a.splice(j, 1);
  if (code) a[Math.min(slot, a.length)] = code; else a.splice(slot, 1);
  setList(id, a.filter(Boolean).slice(0, 2));
  changed();
  return took;
}
export function resetKeys(id = null) {
  for (const k of id ? [id] : Object.keys(BIND)) setList(k, DEF[k]);
  changed();
}
export const isDefault = () => Object.keys(BIND).every((k) => JSON.stringify(BIND[k]) === JSON.stringify(DEF[k]));

// human label of a code
const NAMES = {
  ShiftLeft: 'Shift', ShiftRight: 'Shift dir.', ControlLeft: 'Ctrl', ControlRight: 'Ctrl dir.', AltLeft: 'Alt', AltRight: 'Alt Gr',
  Space: 'Espaço', Tab: 'Tab', Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Enter (num.)', Backspace: '⌫', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', NumpadAdd: '+ (num.)', NumpadSubtract: '- (num.)',
  Mouse1: 'Mouse (meio)', Mouse3: 'Mouse lateral 1', Mouse4: 'Mouse lateral 2',
};
// the character printed on a key in the player's own layout (Chrome / Edge: navigator.keyboard), e.g. Semicolon → Ç
let LAYOUT = null;
try { navigator.keyboard?.getLayoutMap?.().then((m) => { LAYOUT = m; try { dispatchEvent(new CustomEvent('keymap')); } catch { /* ignore */ } }).catch(() => {}); } catch { /* ignore */ }
const PUNCT = { Equal: '=', Minus: '-', Comma: ',', Period: '.', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Slash: '/' };
export function codeLabel(code) {
  if (!code) return '';
  if (NAMES[code]) return NAMES[code];
  const ch = LAYOUT?.get?.(code);
  if (ch && ch.trim()) return ch.toUpperCase();
  if (PUNCT[code]) return PUNCT[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return code.slice(6) + ' (num.)';
  return code;
}
// short label for HUD key chips
export function shortLabel(code) {
  return { Mouse1: 'M3', Mouse3: 'M4', Mouse4: 'M5', ShiftLeft: '⇧', ShiftRight: '⇧' }[code] || codeLabel(code);
}

load();
