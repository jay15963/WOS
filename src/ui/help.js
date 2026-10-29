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
        ${row(L(KEYS.target).concat(['Clique']), 'Próximo alvo · ou clique na criatura')}
        ${row(['Esc'], 'Cancelar (mira, construção, tarefa automática) · menu')}
        <h4>Barra de itens</h4>
        ${row(['1', '…', '9', '0'], 'Usar o slot: equipar ferramenta/arma, comer, construir')}
        ${row(['Arrastar'], 'Itens entre barra, mochila, equipamento e baú')}
        ${row(['Botão dir.'], 'Tirar um item da barra')}
        ${row(L(KEYS.eat), 'Comer a melhor comida')}
      </div>
      <div class="hk-col"><h4>Combate</h4>
        ${row(L(KEYS.attack), 'Atacar o alvo (ou o inimigo mais perto)')}
        ${row(L(ABILITY_KEYS), 'Habilidades da arma e do escudo, na ordem da barra (T e X só com espada + escudo)')}
        ${row(L(KEYS.heal), 'Curar (as ervas também vão para a barra 1–5)')}
        ${row(['⇧ Shift'], 'Disparada (correr)')}
        <h4>Tiro longo · Lançar lança</h4>
        ${row(['Segurar tecla'], 'Mirar com o mouse; clique ou solte a tecla para atirar')}
        ${row(['Alt'], 'Segurado: mira livre (sem mira assistida)')}
        ${row(['Botão dir.', 'Esc'], 'Cancelar a mira')}
        <h4>Janelas</h4>
        ${row(L(KEYS.inv), 'Mochila e equipamento')}
        ${row(L(KEYS.craft), 'Criar itens')}
        ${row(L(KEYS.build), 'Construir')}
        ${row(L(KEYS.map), 'Mapa')}
        ${row(['H', 'F1'], 'Esta ajuda')}
        <h4>Construindo</h4>
        ${row(['Clique', 'Arrastar'], 'Colocar · fileira / área')}
        ${row(['R', '⇧R'], 'Girar')}
        ${row(['Botão dir.', 'Esc'], 'Cancelar')}
        ${row(['Botão dir.'], 'Numa construção: usar · mover · desmontar')}
        ${row(['Clique'], 'Numa planta azul (ou marcada para desmontar): o personagem faz a fileira inteira e para · Esc cancela')}
        ${row(['Minerar'], 'Encoste numa rocha com picareta e use E')}
      </div>`;
    const mob = `
      <div class="hk-col"><h4>Tela de toque</h4>
        ${row(['☝ esquerda'], 'Arraste no lado esquerdo para andar (joystick)')}
        ${row(['Toque'], 'Usar / mirar a coisa tocada — chegue perto antes')}
        ${row(['✌ pinça'], 'Dois dedos: aproximar / afastar a câmera')}
        ${row(['Botão grande'], 'Ataque automático')}
        ${row(['Botões em arco'], 'Habilidades')}
        ${row(['Segurar e arrastar'], 'Tiro longo / lançar lança: arraste para mirar, solte para atirar (gruda no bicho perto)')}
        ${row(['✕ / centro'], 'Solte no ✕ ou volte ao centro para cancelar a mira')}
        ${row(['Botão dourado'], 'Interagir com o que está perto')}
        ${row(['Mapa'], 'Toque no minimapa para o mapa grande')}
        ${row(['Segurar'], 'Numa construção: usar · mover · desmontar')}
        ${row(['☝ arrastar'], 'Construindo: fileira / área (o joystick fica só na beirada esquerda)')}
        ${row(['Toque'], 'Numa planta azul: o personagem constrói a fileira e para · ✕ no aviso de cima cancela')}
        ${row(['Minerar'], 'Encoste numa rocha com picareta e use o botão dourado')}
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
