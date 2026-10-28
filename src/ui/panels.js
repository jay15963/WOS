// HUD panels: Mochila (inventory), Construir (build menu), Baú (chest transfer), Mapa (world map).
// Non-pausing (MMO): the world keeps running; tapping the world closes the panel.

import { ITEMS, BUILDINGS, BUILD_ORDER } from '../game/data.js';
import { eat } from '../game/survival.js';
import { enterBuildMode } from '../game/building.js';
import { dropLoot } from '../game/loot.js';
import { svgIcon, itemIcon, buildIcon, uiIcon } from './icons.js';

export class Panels {
  constructor(game, el) {
    this.g = game;
    this.el = el;
    this.open = null;   // panel name
    this.data = null;
    this.sel = -1;
    this.mapT = 0;
    game.events.on('toggle', (d) => this.toggle(d.panel));
    game.events.on('closepanels', () => this.close());
    game.events.on('open', (d) => this.show(d.panel, d));
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    // never keep focus on panel buttons (Space/Enter are game keys)
    el.addEventListener('click', () => setTimeout(() => document.activeElement?.blur?.(), 0));
  }

  toggle(name) {
    if (this.open === name) this.close();
    else this.show(name);
  }

  show(name, data = null) {
    const g = this.g;
    if (g.player.dead) return;
    if (name === 'build' && g.build.mode) { g.build.mode = null; g.events.emit('buildmode', { type: null }); }
    this.open = name; this.data = data; this.sel = -1;
    g.ui.modal = true;
    this.render();
    g.audio?.play('ui', {});
  }

  close() {
    if (!this.open) return;
    this.open = null; this.data = null;
    this.el.innerHTML = '';
    this.g.ui.modal = false;
  }

  refresh() { if (this.open && this.open !== 'map') this.render(); }

  frame(title, icon, body, cls = '') {
    return `<div class="panel ${cls}"><div class="ph"><span class="pt">${icon}<span>${title}</span></span><button class="px" data-close>${svgIcon('close')}</button></div><div class="pb">${body}</div></div>`;
  }

  slots(inv, tag, cols, selected = -1) {
    const A = this.g.A;
    return `<div class="grid" style="--cols:${cols}">${inv.slots.map((s, i) => `<button class="slot ${s ? 'full' : ''} ${i === selected ? 'sel' : ''}" data-${tag}="${i}">${s ? `${itemIcon(A, s.id)}<span class="n">${s.qty > 1 ? s.qty : ''}</span>` : ''}</button>`).join('')}</div>`;
  }

  render() {
    const g = this.g, A = g.A, p = g.player;
    const name = this.open;
    let html = '';
    if (name === 'inv') {
      const s = p.inv.slots[this.sel];
      const def = s && ITEMS[s.id];
      const detail = def ? `
        <div class="it-head">${itemIcon(A, s.id)}<div><b>${def.name}</b><small>× ${s.qty}</small></div></div>
        <p>${def.desc}</p>
        ${def.food ? `<p class="stat">+${def.food.hunger} fome${def.food.heal ? ` · +${def.food.heal} vida` : ''}${def.food.sick ? ' · risco de indigestão' : ''}</p>` : ''}
        <div class="acts">
          ${def.food ? `<button class="btn primary" data-act="eat">${svgIcon('eat')}Comer</button>` : ''}
          <button class="btn" data-act="drop">${svgIcon('drop')}Largar</button>
        </div>` : `<p class="muted">Toque num item para ver detalhes.</p>
        <p class="muted small">Itens no chão são coletados automaticamente ao passar perto.</p>`;
      const used = p.inv.slots.filter(Boolean).length;
      html = this.frame(`Mochila <small>${used}/${p.inv.size}</small>`, uiIcon(A, 'bag'), `<div class="inv-wrap">${this.slots(p.inv, 'slot', 5, this.sel)}<div class="detail">${detail}</div></div>`, 'p-inv');
    } else if (name === 'build') {
      const cards = BUILD_ORDER.map((id) => {
        const b = BUILDINGS[id];
        const ok = p.inv.has(b.cost);
        const cost = Object.entries(b.cost).map(([it, n]) => {
          const have = p.inv.count(it);
          return `<span class="cost ${have >= n ? '' : 'lack'}">${itemIcon(A, it)}${have}/${n}</span>`;
        }).join('');
        return `<button class="bcard ${ok ? '' : 'cant'}" data-build="${id}"><span class="bi">${buildIcon(A, id)}</span><span class="bt"><b>${b.name}</b><small>${b.desc}</small><span class="costs">${cost}</span></span></button>`;
      }).join('');
      html = this.frame('Construir', uiIcon(A, 'build'), `<div class="bgrid">${cards}</div>`, 'p-build');
    } else if (name === 'chest') {
      const c = this.data?.chest;
      if (!c || !c.store) { this.close(); return; }
      html = this.frame('Baú', buildIcon(A, 'chest'), `
        <div class="chest-wrap">
          <div><div class="gl">Mochila <small>toque para guardar</small></div>${this.slots(p.inv, 'slot', 5)}</div>
          <div><div class="gl">Baú <small>toque para pegar</small></div>${this.slots(c.store, 'cslot', 4)}</div>
        </div>`, 'p-chest');
    } else if (name === 'map') {
      html = this.frame('Mapa', svgIcon('map'), `<canvas class="bigmap"></canvas><div class="legend"><span><i style="background:#ff5a48"></i>Hostil</span><span><i style="background:#ffd84a"></i>Neutro</span><span><i style="background:#7fdc6a"></i>Passivo</span><span><i style="background:#ffb040"></i>Fogo</span></div>`, 'p-map');
    }
    this.el.innerHTML = html;
    this.bind();
    if (name === 'map') this.drawMap();
  }

  bind() {
    const g = this.g, p = g.player, el = this.el;
    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.close()));
    el.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.slot;
      if (this.open === 'chest') {
        const s = p.inv.slots[i];
        if (!s) return;
        const left = this.data.chest.store.add(s.id, s.qty);
        if (left === s.qty) { g.events.emit('error', { text: 'Baú cheio' }); return; }
        p.inv.remove(s.id, s.qty - left);
        g.audio?.play('pickup', {});
        g.touched && g.events.emit('inventory', {});
        this.render();
      } else {
        this.sel = this.sel === i ? -1 : i;
        this.render();
      }
    }));
    el.querySelectorAll('[data-cslot]').forEach((b) => b.addEventListener('click', () => {
      const st = this.data.chest.store, i = +b.dataset.cslot, s = st.slots[i];
      if (!s) return;
      const left = p.inv.add(s.id, s.qty);
      if (left === s.qty) { g.events.emit('error', { text: 'Mochila cheia' }); return; }
      st.remove(s.id, s.qty - left);
      g.audio?.play('pickup', {});
      g.events.emit('inventory', {});
      this.render();
    }));
    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const s = p.inv.slots[this.sel];
      if (!s) return;
      if (b.dataset.act === 'eat') eat(g, s.id);
      else if (b.dataset.act === 'drop') {
        const it = p.inv.takeSlot(this.sel);
        const fx = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[p.facing] || [0, 1];
        const drop = dropLoot(g, p.x + fx[0] * 0.8, p.y + fx[1] * 0.6, it.id, it.qty, 0.3);
        drop.t = -2; // don't instantly re-pick
        g.events.emit('inventory', {});
      }
      if (!p.inv.slots[this.sel]) this.sel = -1;
      this.render();
    }));
    el.querySelectorAll('[data-build]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.build;
      if (!p.inv.has(BUILDINGS[id].cost)) { g.events.emit('error', { text: 'Materiais insuficientes' }); return; }
      this.close();
      enterBuildMode(g, id);
    }));
    const map = el.querySelector('.bigmap');
    if (map) map.addEventListener('click', () => this.close());
  }

  drawMap() {
    const cv = this.el.querySelector('.bigmap');
    const mini = this.g.ui.minimap;
    if (!cv || !mini) return;
    const size = Math.floor(Math.min(innerWidth * 0.86, innerHeight * 0.72, 620));
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.style.width = cv.style.height = size + 'px';
    if (cv.width !== size * dpr) { cv.width = cv.height = size * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mini.draw(ctx, size, size, 0, true);
  }

  update(dt) {
    if (this.open === 'map') {
      this.mapT -= dt;
      if (this.mapT <= 0) { this.mapT = 0.25; this.drawMap(); }
    }
    if (this.open === 'chest' && this.data?.chest) {
      const c = this.data.chest, p = this.g.player;
      if (Math.hypot(c.x - p.x, c.y - p.y) > 2.6 || !this.g.build.structures.includes(c)) this.close();
    }
  }
}
