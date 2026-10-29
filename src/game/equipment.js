// Equipment: p.equip = { main, off, body, head } (item ids or null), equip/unequip from the inventory,
// best-tool lookup for work (axe/pickaxe/knife), derived visuals read by the art:
//   p.weapon (main hand id, or the tool in use while working), p.offhand, p.armor = { body, head },
//   p.light (hand torch), p.armorValue / p.warmth (sum of worn items) for combat / survival.

import { ITEMS, SLOT_PT } from './data.js';

export const SLOTS = ['main', 'off', 'body', 'head'];
const SHOW_TOOL_AFTER = 0.9; // s the work tool stays visible after finishing

export function initEquipment(game) {
  const p = game.player;
  p.equip = { main: null, off: null, body: null, head: null };
  p.weapon = null; p.offhand = null; p.armor = { body: null, head: null };
  p.passDoors = true; // physics: the player walks through doors / gates
  p.armorValue = 0; p.warmth = 0;
  p.equipV = 0;
}

export const itemDef = (id) => (id ? ITEMS[id] : null);
export const isTwoHanded = (id) => !!ITEMS[id]?.weapon?.twoHanded;

// every tool the player can use right now (equipped main hand + backpack)
function* toolCandidates(p) {
  if (p.equip?.main) yield p.equip.main;
  for (const s of p.inv.slots) if (s) yield s.id;
}

// best tool for a job kind ('chop' | 'mine' | 'skin' | 'fiber') -> { id, speed, tier } | null
export function bestTool(p, kind) {
  let best = null;
  for (const id of toolCandidates(p)) {
    const t = ITEMS[id]?.tool?.[kind];
    if (t && (!best || t > best.speed)) best = { id, speed: t, tier: ITEMS[id].tier ?? 0 };
  }
  return best;
}

export const hasTool = (p, kind) => !!bestTool(p, kind);

export function equipChanged(game) {
  const p = game.player;
  p.equipV = (p.equipV || 0) + 1;
  let armor = 0, warmth = 0;
  for (const s of SLOTS) {
    const d = ITEMS[p.equip[s]];
    if (d?.armor) { armor += d.armor.value || 0; warmth += d.armor.warmth || 0; }
  }
  p.armorValue = armor; p.warmth = warmth;
  syncVisual(p, true);
  game.events.emit('equipchange', {});
  game.events.emit('equip', {});
  game.events.emit('inventory', {});
}

// Equip the item in backpack slot i. Returns true on success.
export function equipFromSlot(game, i) {
  const p = game.player, s = p.inv.slots[i];
  if (!s) return false;
  const def = ITEMS[s.id];
  if (!def?.slot) { game.events.emit('error', { text: 'Esse item não pode ser equipado' }); return false; }
  const slot = def.slot;
  // what has to come off first
  const off = [];
  if (p.equip[slot]) off.push(slot);
  if (slot === 'main' && def.weapon?.twoHanded && p.equip.off) off.push('off');
  if (slot === 'off' && isTwoHanded(p.equip.main)) off.push('main');
  // room check: the slot being emptied frees one backpack slot when the stack is 1
  const freed = s.qty === 1 ? 1 : 0;
  const back = {};
  for (const k of off) back[p.equip[k]] = (back[p.equip[k]] || 0) + 1;
  if (off.length && !p.inv.fits(back, freed)) { game.events.emit('error', { text: 'Mochila cheia' }); return false; }
  p.inv.remove(s.id, 1);
  for (const k of off) { p.inv.add(p.equip[k], 1); p.equip[k] = null; }
  p.equip[slot] = s.id;
  game.audio?.play('pickup', { x: p.x, y: p.y, volume: 0.6 });
  if (off.includes('off') && slot === 'main') game.events.emit('toast', { text: 'Arco usa as duas mãos', kind: 'info' });
  equipChanged(game);
  return true;
}

export function equipItem(game, id) {
  const i = game.player.inv.slots.findIndex((s) => s && s.id === id);
  return i >= 0 && equipFromSlot(game, i);
}

export function unequip(game, slot) {
  const p = game.player, id = p.equip[slot];
  if (!id) return false;
  if (p.inv.room(id) < 1) { game.events.emit('error', { text: 'Mochila cheia' }); return false; }
  p.inv.add(id, 1);
  p.equip[slot] = null;
  game.audio?.play('pickup', { x: p.x, y: p.y, volume: 0.5 });
  equipChanged(game);
  return true;
}

// Visual main hand for the art: the tool being used for work (and shortly after), else p.equip.main.
// Combat (player.js refreshGear) derives p.offhand / p.armor / hand-torch light from p.equip.
export function syncVisual(p, force = false) {
  const tool = p.work?.tool || (p.toolShowT > 0 ? p.toolShown : null);
  const vis = tool || p.equip.main || null;
  if (force || p.weapon !== vis) p.weapon = vis;
}

export function equipmentSystem() {
  return {
    sync: 'owner', // visual tool of the local player
    update(game, dt) {
      const p = game.player;
      if (p.work?.tool) { p.toolShown = p.work.tool; p.toolShowT = SHOW_TOOL_AFTER; }
      else if (p.toolShowT > 0) {
        p.toolShowT -= dt;
        if (p.autoAttack || p.action?.type === 'attack') p.toolShowT = 0;
      }
      syncVisual(p);
    },
  };
}

export const slotName = (s) => SLOT_PT[s] || s;
