// Shortcuts overlay (H / F1 / the "?" button): the desktop key scheme or the touch gestures.

import { KEYS, ABILITY_KEYS, keyLabel } from '../game/controller.js';

const row = (keys, what) => `<div class="hk-r"><span class="hk-k">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span><span>${what}</span></div>`;
const L = (codes) => codes.map(keyLabel);

export function installHelp(game) {
  const el = document.createElement('div');
  el.className = 'help hidden';
  document.body.appendChild(el);
  let open = false;
  const touch = () => document.getElementById('hud')?.classList.contains('touch');

  const render = () => {
    const desk = `
      <div class="hk-col"><h4>Movimento e mundo</h4>
        ${row(['W', 'A', 'S', 'D'], 'Andar (ou setas)')}
        ${row(L(KEYS.interact), 'Interagir com o que está perto (cortar, minerar, abrir…)')}
        ${row(['Clique'], 'Usar / mirar a coisa clicada (chegue perto antes)')}
        ${row(['Roda', '+', '−'], 'Zoom')}
        ${row(L(KEYS.target), 'Próximo alvo')}
        ${row(['Esc'], 'Cancelar · menu')}
        <h4>Barra de itens</h4>
        ${row(['1', '…', '9', '0'], 'Usar o slot: equipar ferramenta/arma, comer, construir')}
        ${row(['Arrastar'], 'Itens entre barra, mochila, equipamento e baú')}
        ${row(['Botão dir.'], 'Tirar um item da barra')}
        ${row(L(KEYS.eat), 'Comer a melhor comida')}
      </div>
      <div class="hk-col"><h4>Combate</h4>
        ${row(L(KEYS.attack), 'Ataque automático liga/desliga')}
        ${row(L(ABILITY_KEYS), 'Habilidades da arma e do escudo (na ordem da barra)')}
        ${row(L(KEYS.heal), 'Curar')}
        ${row(['⇧ Shift'], 'Disparada (correr)')}
        <h4>Janelas</h4>
        ${row(L(KEYS.inv), 'Mochila e equipamento')}
        ${row(L(KEYS.craft), 'Criar itens')}
        ${row(L(KEYS.build), 'Construir')}
        ${row(L(KEYS.map), 'Mapa')}
        ${row(L(KEYS.mine), 'Marcar rochas para minerar')}
        ${row(['H', 'F1'], 'Esta ajuda')}
        <h4>Construindo</h4>
        ${row(['Clique', 'Arrastar'], 'Colocar · fileira / área')}
        ${row(['R', '⇧R'], 'Girar')}
        ${row(['Botão dir.', 'Esc'], 'Cancelar')}
      </div>`;
    const mob = `
      <div class="hk-col"><h4>Tela de toque</h4>
        ${row(['☝ esquerda'], 'Arraste no lado esquerdo para andar (joystick)')}
        ${row(['Toque'], 'Usar / mirar a coisa tocada — chegue perto antes')}
        ${row(['✌ pinça'], 'Dois dedos: aproximar / afastar a câmera')}
        ${row(['Botão grande'], 'Ataque automático')}
        ${row(['Botões em arco'], 'Habilidades')}
        ${row(['Botão dourado'], 'Interagir com o que está perto')}
        ${row(['Mapa'], 'Toque no minimapa para o mapa grande')}
      </div>`;
    el.innerHTML = `<div class="help-card"><div class="help-h"><b>Atalhos e controles</b><button class="hx" aria-label="Fechar">✕</button></div>
      <div class="help-b">${touch() ? mob : desk}</div>
      <p class="help-f">Sobreviva: mantenha a <b>fome</b> e o <b>calor</b> do corpo altos. À noite esfria — fogueira, abrigo fechado e roupas aquecem.</p></div>`;
    el.querySelector('.hx').onclick = () => api.close();
  };
  const api = {
    open() { if (open) return; open = true; render(); el.classList.remove('hidden'); game.audio?.play('ui_open', {}); },
    close() { if (!open) return; open = false; el.classList.add('hidden'); game.audio?.play('ui_close', {}); },
    toggle() { if (open) api.close(); else api.open(); },
    isOpen: () => open,
  };
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === el) api.close(); });
  addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { e.stopPropagation(); api.close(); } }, true);
  game.events.on('help', () => api.toggle());
  game.events.on('closepanels', () => api.close());
  game.ui.help = api;
  return api;
}
