// HUD panels: Mochila (inventory + equipment paper-doll), Criar (crafting, see crafting.js),
// Construir (build menu by category + deconstruct), containers (Baú and any adapter of container.js:
// backpack beside the container, click / drag to transfer, sort buttons), Mapa (world map).
// Non-pausing (MMO): the world keeps running; tapping the world closes the panel.
// Also installs the work bar (build / deconstruct modes) — see workbar.js.

import { ITEMS, BUILDINGS, BUILD_ORDER, BUILD_CATS, SLOT_PT, ITEM_CAT_PT, TIER_SPEED } from '../game/data.js';
import { eat } from '../game/survival.js';
import { enterBuildMode, enterDeconMode, lastLook } from '../game/building.js';
import { hasKit, stylesFor, normStyle, detList } from '../game/content/kits.js'; // agent K: Detalhes
import { dropLoot } from '../game/loot.js';
import { equipFromSlot, unequip, SLOTS } from '../game/equipment.js';
import { CROPS } from '../game/farming.js';
import { svgIcon, uiIcon } from './icons.js';
import { SORT_MODES, SORT_PT, sortBackpack } from '../game/invsort.js';
import { itemIco, buildIco, econIcon } from './econIcons.js';
import { craftBody, craftBind, craftUpdate } from './crafting.js';
import { installWorkbar } from './workbar.js';
import { chestAdapter } from './container.js';
import { uiScale } from './uiscale.js';
import { pathCatalog, PATH_TAB } from './pathbar.js'; // painted terrain paths (agent M)

const ERA_PT = ['Primitiva', 'Pedra', 'Cobre', 'Ferro', 'Aço'];
const WTYPE_PT = { knife: 'faca', axe: 'machado', pickaxe: 'picareta', spear: 'lança', sword: 'espada', club: 'clava', bow: 'arco' };
const MINES_PT = ['rocha e pedregulhos', 'rocha, cobre e carvão', 'rocha, cobre, carvão e ferro', 'todos os minérios', 'todos os minérios'];
const SLOT_ICON = { main: '🗡️', off: '🛡️', body: '👕', head: '🪖' };
const x100 = (v) => '×' + (Math.round(v * 100) / 100).toString().replace('.', ',');
const WIN_KEY = { inv: 'Tab', craft: 'C', build: 'B', map: 'M' };

export function itemStats(id) {
  const d = ITEMS[id];
  const out = [];
  if (d.tool?.chop) out.push(`Corta árvores ${x100(d.tool.chop)}`);
  if (d.tool?.mine) out.push(`Minera ${x100(d.tool.mine)} · ${MINES_PT[d.tier]}`);
  if (d.tool?.skin) out.push('Tira couro dos animais · fibra mais rápida');
  if (d.weapon) out.push(`Arma: ${WTYPE_PT[d.weapon.type] || d.weapon.type}${d.weapon.twoHanded ? ' · duas mãos' : ''}`);
  if (d.armor) out.push(`Armadura +${d.armor.value}${d.armor.warmth ? ` · calor +${d.armor.warmth}` : ''}`);
  if (d.shield) out.push(`Bloqueia ${Math.round(d.shield.block * 100)}% do dano`);
  if (d.light) out.push('Ilumina em volta de você');
  if (d.food) out.push(`+${d.food.hunger} fome${d.food.heal ? ` · +${d.food.heal} vida` : ''}${d.food.sick ? ' · risco de indigestão' : ''}${d.food.warm ? ` · aquece por ${d.food.warm} s` : ''}`);
  if (d.seed) out.push(`Planta: ${CROPS[d.seed]?.name || d.seed}`);
  return out;
}

export class Panels {
  constructor(game, el) {
    this.g = game;
    this.el = el;
    this.open = null;   // panel name
    this.data = null;
    this.sel = null;    // inventory selection { kind: 'inv', i } | { kind: 'eq', slot }
    this.mapT = 0;
    this.craftTab = 'tools';
    this.craftStation = null;
    this.buildTab = 'struct';
    this.scroll = {};
    this.pos = {};      // desktop window offsets (dragged by the title bar)
    this.sortMode = {}; // last sort per container ('inv' | 'chest:<id>'), kept in localStorage
    try { this.sortMode = JSON.parse(localStorage.getItem('wos.sort') || '{}') || {}; } catch { /* ignore */ }
    game.events.on('toggle', (d) => this.toggle(d.panel));
    game.events.on('closepanels', () => this.close());
    game.events.on('open', (d) => this.show(d.panel, d));
    // container contents are shared (op chest.set …): refresh the open one when anyone changes it
    game.events.on('chest', (d) => { const c = this.container; if (c && (c.event === 'chest' ? c.chest === d.o : true)) this.render(); });
    game.events.on('container', (d) => { const c = this.container; if (c && (!d?.id || d.id === c.id)) this.render(); });
    game.events.on('inventory', () => { if (this.container) this.render(); });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    // never keep focus on panel buttons (Space/Enter are game keys)
    el.addEventListener('click', () => setTimeout(() => document.activeElement?.blur?.(), 0));
    this.workbar = installWorkbar(game, el.parentElement);
  }

  toggle(name) {
    if (this.open === name && !(name === 'craft' && this.craftStation)) this.close();
    else this.show(name);
  }

  // the open container adapter (container.js), if any
  get container() { return this.open === 'chest' || this.open === 'container' ? this.data?.adapter || null : null; }

  show(name, data = null) {
    const g = this.g;
    if (g.player.dead) return;
    if (name === 'chest' && data?.chest && !data.adapter) data = { ...data, adapter: chestAdapter(g, data.chest) };
    if (name === 'container' && data?.adapter?.event && data.adapter.event !== 'chest' && !this._evs?.has(data.adapter.event)) {
      (this._evs ||= new Set()).add(data.adapter.event);
      g.events.on(data.adapter.event, () => { if (this.container?.event === data.adapter.event) this.render(); });
    }
    if (g.build.mode && (name === 'build' || name === 'craft')) { g.build.mode = null; g.events.emit('buildui', {}); }
    if (name === 'craft') this.craftStation = data?.station || null;
    if (this.open !== name) this.sel = null;
    this.open = name; this.data = data;
    g.ui.modal = true;
    this.fresh = true;
    this.render();
    this.fresh = false;
    g.audio?.play('ui_open', {});
  }

  close() {
    if (!this.open) return;
    this.open = null; this.data = null;
    this.el.innerHTML = '';
    this.g.audio?.play('ui_close', {});
    this.g.ui.modal = false;
  }

  refresh() { if (this.open && this.open !== 'map') this.render(); }

  resetScroll(k) { delete this.scroll[k]; }

  frame(title, icon, body, cls = '') {
    // desktop: a window with its shortcut key, draggable by the title bar (position kept per window)
    const k = WIN_KEY[this.open];
    const pos = this.pos[this.open];
    const st = pos ? ` style="translate:${pos[0]}px ${pos[1]}px"` : '';
    return `<div class="panel ${cls}${this.fresh ? '' : ' still'}"${st}><div class="ph"><span class="pt">${icon}<span>${title}</span>${k ? `<kbd class="pk">${k}</kbd>` : ''}</span><button class="px" data-close>${svgIcon('close')}</button></div><div class="pb" data-scroll="pb-${this.open}">${body}</div></div>`;
  }

  // sort buttons (A→Z · Tipo · Quantidade); the last one used per container is highlighted
  sortBar(key) {
    const cur = this.sortMode[key];
    return `<div class="sortbar"><span>Ordenar</span>${SORT_MODES.map((m) => `<button class="sbt ${cur === m ? 'on' : ''}" data-sort="${m}" data-sortk="${key}">${SORT_PT[m]}</button>`).join('')}</div>`;
  }

  slots(inv, tag, cols, selected = -1) {
    const A = this.g.A;
    return `<div class="grid" style="--cols:${cols}">${inv.slots.map((s, i) => `<button class="slot ${s ? 'full' : ''} ${i === selected ? 'sel' : ''}" data-${tag}="${i}" ${s ? `title="${ITEMS[s.id]?.name || ''}"` : ''}>${s ? `${itemIco(A, s.id)}<span class="n">${s.qty > 1 ? s.qty : ''}</span>` : ''}</button>`).join('')}</div>`;
  }

  invBody() {
    const g = this.g, A = g.A, p = g.player;
    const sel = this.sel;
    let id = null, qty = 0, fromEq = null;
    if (sel?.kind === 'inv') { const s = p.inv.slots[sel.i]; if (s) { id = s.id; qty = s.qty; } else this.sel = null; }
    else if (sel?.kind === 'eq') { id = p.equip[sel.slot]; qty = 1; fromEq = sel.slot; if (!id) this.sel = null; }
    const def = id && ITEMS[id];
    const eq = (slot) => {
      const it = p.equip[slot];
      const on = sel?.kind === 'eq' && sel.slot === slot;
      const blocked = slot === 'off' && ITEMS[p.equip.main]?.weapon?.twoHanded;
      return `<button class="eqs ${it ? 'full' : ''} ${on ? 'sel' : ''} ${blocked ? 'blk' : ''}" data-eq="${slot}" title="${SLOT_PT[slot]}">
        ${it ? itemIco(A, it) : `<span class="ph0">${blocked ? '🏹' : SLOT_ICON[slot]}</span>`}<small>${SLOT_PT[slot]}</small></button>`;
    };
    let detail;
    if (def) {
      const acts = [];
      if (fromEq) acts.push(`<button class="btn primary" data-act="unequip">${econIcon(A, 'equip')}Desequipar</button>`);
      else if (def.slot) acts.push(`<button class="btn primary" data-act="equip">${econIcon(A, 'equip')}Equipar</button>`);
      if (def.food && !fromEq) acts.push(`<button class="btn primary" data-act="eat">${svgIcon('eat')}Comer</button>`);
      if (def.seed && !fromEq) acts.push(`<button class="btn ${p.seedPref === id ? 'on' : ''}" data-act="seed">${econIcon(A, 'seed')}${p.seedPref === id ? 'Semente escolhida' : 'Plantar esta'}</button>`);
      if (!fromEq) {
        if (qty > 1) acts.push(`<button class="btn" data-act="drop1">${svgIcon('drop')}Largar 1</button>`);
        acts.push(`<button class="btn" data-act="drop">${svgIcon('drop')}Largar${qty > 1 ? ' tudo' : ''}</button>`);
      }
      const stats = itemStats(id).map((s) => `<li>${s}</li>`).join('');
      detail = `
        <div class="it-head">${itemIco(A, id)}<div><b>${def.name}</b><small>${ITEM_CAT_PT[def.cat] || ''}${def.tier != null ? ` · era ${ERA_PT[def.tier]}` : ''}${qty > 1 ? ` · × ${qty}` : ''}</small></div></div>
        <p>${def.desc}</p>${stats ? `<ul class="stats">${stats}</ul>` : ''}
        <div class="acts">${acts.join('')}</div>`;
    } else {
      detail = `<p class="muted">${g.input.isTouch ? 'Toque' : 'Clique'} num item para ver detalhes, equipar ou usar.${g.input.isTouch ? '' : ' Arraste itens para a barra (1–0), para o equipamento ou para um baú.'}</p>
        <p class="muted small">Ferramentas na mochila são usadas automaticamente (a melhor). Itens no chão são coletados ao passar perto.</p>`;
    }
    const used = p.inv.used();
    const doll = `<div class="doll">
        <span></span>${eq('head')}<span></span>
        ${eq('main')}<div class="dstat"><span title="Armadura">🛡 ${p.armorV ?? p.armorValue ?? 0}</span><span title="Calor das roupas">🔥 ${p.warmth || 0}</span></div>${eq('off')}
        <span></span>${eq('body')}<span></span>
      </div>`;
    return { title: `Mochila <small>${used}/${p.inv.size}</small>`, body: `<div class="inv2">${doll}<div class="inv-grid">${this.sortBar('inv')}${this.slots(p.inv, 'slot', 6, sel?.kind === 'inv' ? sel.i : -1)}</div><div class="detail detail2">${detail}</div></div>` };
  }

  buildBody() {
    const g = this.g, A = g.A, p = g.player;
    const tab = this.buildTab;
    const cats = BUILD_CATS.flatMap((c) => (c[0] === 'floor' ? [c, PATH_TAB] : [c])); // "Caminhos" after "Pisos"
    const tabs = cats.map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" data-btab="${k}">${n}</button>`).join('');
    const pcost = (cost) => { const e = Object.entries(cost); return e.length ? e.map(([it, n]) => `<span class="cost ${p.inv.count(it) >= n ? '' : 'lack'}" title="${ITEMS[it].name}">${itemIco(A, it)}${p.inv.count(it)}/${n}</span>`).join('') : '<span class="cost">grátis</span>'; };
    const pathCards = tab !== 'path' ? '' : pathCatalog(g).map((c) => `<button class="bcard" data-path="${c.key}"><span class="bi">${c.icon ? `<img class="spri" src="${c.icon}" alt="" draggable="false">` : `<span class="emo" style="display:block;width:100%;height:100%;border-radius:50%;background:${c.swatch}"></span>`}</span><span class="bt"><b>${c.name}</b><small>${c.desc}</small><small class="bm">${c.meta}</small>${c.remove ? '' : `<span class="costs">${pcost(c.cost)}</span>`}</span></button>`).join('');
    const cards = pathCards || BUILD_ORDER.filter((id) => BUILDINGS[id].cat.includes(tab)).map((id) => {
      const b = BUILDINGS[id];
      const ok = p.inv.has(b.cost);
      const entries = Object.entries(b.cost);
      const cost = entries.length ? entries.map(([it, n]) => {
        const have = p.inv.count(it);
        return `<span class="cost ${have >= n ? '' : 'lack'}" title="${ITEMS[it].name}">${itemIco(A, it)}${have}/${n}</span>`;
      }).join('') : '<span class="cost">grátis</span>';
      const meta = [b.size[0] * b.size[1] > 1 ? `${b.size[0]}×${b.size[1]}` : '', b.drag === 'line' ? 'arraste: linha/sala' : b.drag === 'area' ? 'arraste: área' : '', b.drag ? 'custo por tile' : ''].filter(Boolean).join(' · ');
      let sty = '';
      if (hasKit(id)) { // agent K: styles chip (opens Detalhes) + the remembered look
        const [st, dt] = lastLook(g, id), n = detList(dt).length, sn = stylesFor(id).find((s) => s.id === normStyle(id, st))?.name;
        sty = `<span class="bsty" data-style="${id}">✦ Estilos${sn || n ? ` · ${[sn, n ? n + ' det.' : ''].filter(Boolean).join(' · ')}` : ''}</span>`;
      }
      return `<button class="bcard ${ok ? '' : 'cant'}" data-build="${id}"><span class="bi">${buildIco(A, id)}</span><span class="bt"><b>${b.name}</b><small>${b.desc}</small>${meta ? `<small class="bm">${meta}</small>` : ''}<span class="costs">${cost}</span>${sty}</span></button>`;
    }).join('');
    return `<div class="tabs" data-scrollx="btabs">${tabs}<button class="tab tab-go" data-goto="craft">Criar itens ›</button></div>
      <div class="btools"><button class="btn" data-decon>${econIcon(A, 'decon')}Desmontar construções</button><small class="muted">Desmontar devolve 75% do material.</small></div>
      <div class="bgrid" data-scroll="bgrid">${cards}</div>`;
  }

  render() {
    const g = this.g, A = g.A, p = g.player;
    const name = this.open;
    // keep scroll positions across re-renders
    this.el.querySelectorAll('[data-scroll]').forEach((n) => { this.scroll[n.dataset.scroll] = n.scrollTop; });
    this.el.querySelectorAll('[data-scrollx]').forEach((n) => { this.scroll['x' + n.dataset.scrollx] = n.scrollLeft; });
    let html = '';
    if (name === 'inv') {
      const r = this.invBody();
      html = this.frame(r.title, uiIcon(A, 'bag'), r.body, 'p-inv');
    } else if (name === 'craft') {
      html = this.frame('Criar', econIcon(A, 'craft'), craftBody(this), 'p-craft');
    } else if (name === 'build') {
      html = this.frame('Construir', uiIcon(A, 'build'), this.buildBody(), 'p-build');
    } else if (name === 'chest' || name === 'container') {
      const c = this.container;
      if (!c || !c.canOpen()) { this.close(); return; }
      const how = g.input.isTouch ? 'toque' : 'clique ou arraste';
      html = this.frame(c.title, c.icon || buildIco(A, 'chest'), `
        <div class="chest-wrap">
          <div class="inv-side"><div class="gl">Mochila <small>${how} para guardar</small></div>${this.sortBar('inv')}${this.slots(p.inv, 'slot', 6)}</div>
          <div class="chest-side"><div class="gl">${c.label || c.title} <small>${how} para pegar</small></div>${this.sortBar(c.id)}${this.slots({ slots: c.items() }, 'cslot', c.cols || 5)}</div>
        </div>`, 'p-chest');
    } else if (name === 'map') {
      html = this.frame('Mapa', svgIcon('map'), `<canvas class="bigmap"></canvas><div class="legend"><span><i style="background:#ec5a4c"></i>Hostil</span><span><i style="background:#f0c24a"></i>Neutro</span><span><i style="background:#9cc45a"></i>Passivo</span><span><i style="background:#4cc2b4"></i>Jogadores</span><span><i style="background:#ffa040"></i>Fogo</span></div>`, 'p-map');
    }
    this.el.innerHTML = html;
    this.el.querySelectorAll('[data-scroll]').forEach((n) => { const v = this.scroll[n.dataset.scroll]; if (v) n.scrollTop = v; });
    this.el.querySelectorAll('[data-scrollx]').forEach((n) => { const v = this.scroll['x' + n.dataset.scrollx]; if (v) n.scrollLeft = v; });
    this.bind();
    if (name === 'map') this.drawMap();
  }

  bind() {
    const g = this.g, p = g.player, el = this.el;
    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.close()));
    // desktop windows: drag by the title bar
    const ph = el.querySelector('.ph'), win = el.querySelector('.panel'), name = this.open;
    ph?.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button')) return;
      const p0 = this.pos[name] || [0, 0], x0 = e.clientX, y0 = e.clientY;
      const mv = (ev) => {
        const s = uiScale(), hw = innerWidth / s / 2, hh = innerHeight / s / 2;
        const nx = Math.max(-hw + 80, Math.min(hw - 80, p0[0] + (ev.clientX - x0) / s));
        const ny = Math.max(-hh + 40, Math.min(hh - 40, p0[1] + (ev.clientY - y0) / s));
        this.pos[name] = [Math.round(nx), Math.round(ny)];
        win.style.translate = `${this.pos[name][0]}px ${this.pos[name][1]}px`;
      };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
    el.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.slot;
      const c = this.container;
      if (c) {
        const s = p.inv.slots[i];
        if (!s) return;
        // the whole stack leaves the backpack now; shared containers get it from the host (leftovers come back)
        if (c.put(i, s.qty) === false) return;
        g.audio?.play('pickup', {});
        g.events.emit('inventory', {});
        this.render();
      } else {
        const same = this.sel?.kind === 'inv' && this.sel.i === i;
        this.sel = same || !p.inv.slots[i] ? null : { kind: 'inv', i };
        this.render();
      }
    }));
    el.querySelectorAll('[data-eq]').forEach((b) => b.addEventListener('click', () => {
      const slot = b.dataset.eq;
      const same = this.sel?.kind === 'eq' && this.sel.slot === slot;
      this.sel = same || !p.equip[slot] ? null : { kind: 'eq', slot };
      if (!p.equip[slot] && !same) {
        // empty slot: hint which backpack items fit
        const fit = p.inv.slots.findIndex((s) => s && ITEMS[s.id]?.slot === slot);
        if (fit >= 0) this.sel = { kind: 'inv', i: fit };
        else g.events.emit('toast', { text: `Nada para ${SLOT_PT[slot].toLowerCase()} na mochila`, kind: 'info' });
      }
      this.render();
    }));
    el.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const mode = b.dataset.sort, key = b.dataset.sortk;
      this.sortMode[key] = mode;
      try { localStorage.setItem('wos.sort', JSON.stringify(this.sortMode)); } catch { /* ignore */ }
      g.audio?.play('ui_click', {});
      if (key === 'inv') { this.sel = null; sortBackpack(g, mode); this.render(); return; }
      const c = this.container;
      if (!c || c.id !== key) return;
      // shared containers: the host sorts (store.sort → chest.set / corpse.set) and every peer gets the same order
      c.sort(mode);
      this.render();
    }));
    el.querySelectorAll('[data-cslot]').forEach((b) => b.addEventListener('click', () => {
      const c = this.container, i = +b.dataset.cslot, s = c?.items()[i];
      if (!s) return;
      if (c.take(i, s.qty) !== false) g.audio?.play('pickup', {});
    }));
    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act, sel = this.sel;
      if (!sel) return;
      if (act === 'unequip' && sel.kind === 'eq') { if (unequip(g, sel.slot)) this.sel = null; this.render(); return; }
      const s = sel.kind === 'inv' ? p.inv.slots[sel.i] : null;
      if (!s) return;
      if (act === 'equip') {
        const slot = ITEMS[s.id].slot;
        if (equipFromSlot(g, sel.i)) this.sel = { kind: 'eq', slot };
      } else if (act === 'eat') eat(g, s.id);
      else if (act === 'seed') { p.seedPref = s.id; g.events.emit('toast', { text: `Vai plantar: ${CROPS[ITEMS[s.id].seed]?.name || ''}`, kind: 'info' }); }
      else if (act === 'drop' || act === 'drop1') {
        const fx = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[p.facing] || [0, 1];
        let it;
        if (act === 'drop1') { p.inv.remove(s.id, 1); it = { id: s.id, qty: 1 }; }
        else it = p.inv.takeSlot(sel.i);
        dropLoot(g, p.x + fx[0] * 0.8, p.y + fx[1] * 0.6, it.id, it.qty, 0.3, { hold: true }); // hold: not re-picked at once
        g.events.emit('inventory', {});
      }
      if (this.sel?.kind === 'inv' && !p.inv.slots[this.sel.i]) this.sel = null;
      this.render();
    }));
    el.querySelectorAll('[data-btab]').forEach((b) => b.addEventListener('click', () => { this.buildTab = b.dataset.btab; this.resetScroll('bgrid'); this.render(); }));
    el.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.dataset.style;
      this.close();
      enterBuildMode(g, id);
      g.later?.(0.05, () => g.events.emit('details', { type: id }));
    }));
    el.querySelectorAll('[data-build]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.build;
      if (!p.inv.has(BUILDINGS[id].cost)) { g.events.emit('error', { text: 'Materiais insuficientes' }); return; }
      this.close();
      enterBuildMode(g, id);
    }));
    el.querySelector('[data-decon]')?.addEventListener('click', () => { this.close(); enterDeconMode(g); });
    el.querySelectorAll('[data-path]').forEach((b) => b.addEventListener('click', () => { this.close(); g.paths?.enter(b.dataset.path); }));
    if (this.open === 'build' && this.buildTab === 'path' && !g._paths?.layers) g.paths?.layers().then(() => { if (this.open === 'build' && this.buildTab === 'path') this.render(); });
    if (this.open === 'craft') craftBind(this, el);
    if (this.open === 'build') el.querySelector('[data-goto]')?.addEventListener('click', () => this.show('craft'));
    const map = el.querySelector('.bigmap');
    if (map) map.addEventListener('click', () => this.close());
  }

  drawMap() {
    const cv = this.el.querySelector('.bigmap');
    const mini = this.g.ui.minimap;
    if (!cv || !mini) return;
    const sc = uiScale(), size = Math.floor(Math.min((innerWidth / sc) * 0.86, (innerHeight / sc) * 0.72, 620));
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.style.width = cv.style.height = size + 'px';
    if (cv.width !== size * dpr) { cv.width = cv.height = size * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mini.draw(ctx, size, size, 0, true);
  }

  update(dt) {
    this.workbar?.update(dt);
    if (this.open === 'map') {
      this.mapT -= dt;
      if (this.mapT <= 0) { this.mapT = 0.25; this.drawMap(); }
    }
    if (this.open === 'craft') craftUpdate(this);
    const c = this.container;
    if (c && !c.canOpen()) this.close();
  }
}

export { TIER_SPEED, SLOTS };
