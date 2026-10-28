// Tiny event bus: simulation emits, presentation (HUD, overlay, audio) listens.
// Keeps the sim free of DOM so a server can own it later.
//
// Events used:
//  damage {target, src, amount, crit, kind:'hit'|'miss'|'dodge'|'immune'|'heal'}
//  xp {amount}  levelup {level}  loot {item, qty}  toast {text, kind}  error {text}
//  death {}  respawn {where}  inventory {}  target {target}  open {panel, data}  build {type}

export class Events {
  constructor() { this.h = new Map(); }
  on(type, fn) {
    let l = this.h.get(type);
    if (!l) this.h.set(type, (l = []));
    l.push(fn);
    return () => { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  }
  emit(type, data = {}) {
    const l = this.h.get(type);
    if (l) for (const fn of l) {
      try { fn(data); } catch (e) { console.error('evento', type, e); }
    }
  }
}
