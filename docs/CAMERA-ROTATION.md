# Câmera giratória (protótipo das faces calculadas)

Pedido do dono: girar a câmera suavemente, continuando 2D e leve. As estruturas não viram sprites de 8 / 32
direções (emendas tortas, atlas enorme): viram **faces calculadas** — retângulos texturizados com a arte de sempre,
calculados para o ângulo do momento.

## Controles

- **PC:** arrastar com o **botão do meio do mouse** (para a direita = a câmera gira para a direita); **clique duplo
  no botão do meio** = de volta ao norte.
- **Celular:** **dois dedos girando como um volante**. Abrir / fechar os dedos continua sendo zoom: o primeiro
  movimento claro (giro ou pinça) fica com o gesto até os dedos saírem da tela (input.js `gLock`).
- Com a câmera girada aparece uma **bússola no radar** (a agulha aponta o norte); tocar nela volta ao norte.
- O joystick e o WASD andam em relação à tela (para cima = para longe da câmera).

## Como funciona

- `game.cam.rot` (radianos) segue `rot To` com suavização; `rotFade` (0..1) enquanto girada. Em 0° tudo é desenhado
  exatamente como antes.
- Uma transformação só: o mundo gira em volta da câmera; a altura sobe reta na tela (`y − h`, como sempre).
  - Shaders: `uRot` (cos, sen). Sprites em pé (personagens, árvores, itens, móveis) giram só a âncora e continuam de
    frente para a tela; sprites deitados (`uFlat`: pisos, tapetes, decalques) giram inteiros. Terreno, luz ambiente
    e pós-processamento convertem tela → mundo pela rotação; sombras do sol e feixes de luz também.
  - JS: `game.screenToWorld` / `worldToScreen(x, y, h)` (h = altura na tela: plaquinhas de nome), `view()` (a caixa
    em volta da tela girada), profundidade = o y girado.
- **Paredes:** caixas de faces. Os pintores da própria peça desenham numa "gravação" (as mesmas camadas da vista
  norte: base, acabamentos, janelas, postes, hera, brilhos); cada camada no quadro da peça vai para as faces — a
  metade de cima no topo, a fachada em cada lado virado para a câmera (desenhada como se os vizinhos daquele lado
  fossem esquerda / direita). Janelas aparecem dos dois lados da parede; prateleiras / quadros da parede só no lado
  em que foram postos. Lados internos (parede encostada) nunca são desenhados. Paredes no estilo padrão e portas:
  caixa com a arte simples da parede (a porta mais escura); porta / portão abertos: nada no caminho.
  (`art/archCompose.drawWallFaces`, `engine/faceBatch.js`, `FACE_VS / FACE_FS`; brilhos de janela: alfa negativo →
  camada de brilho.)
- **Telhados:** malha inclinada (`game/roofs.js roofMesh`, `art/roofRaster.roofShape` = os mesmos retângulos e
  planos do pintor): a superfície numa grade que passa pelas cumeeiras e pelas linhas das paredes, com a imagem
  pintada do telhado como textura (um ponto (x, y, h) do telhado é onde a vista norte o pintou, (x, y − h)); oitões e
  degraus entre telhados como faces verticais até o beiral (os do sul pintados, os outros em reboco); chaminés como
  caixas de pedra. Ordenado como uma peça só (pelo ponto mais à frente); some quando o jogador entra (como sempre) e
  fica translúcido quando esconde o jogador.
- **Cercas / muros de pedra / sebes / portões:** painéis finos pelo meio do tile (um por eixo em que correm), com a
  arte da própria cerca; vistos dos dois lados.
- **Escadas (níveis, `art/faces/levels.js`):** a arte de verdade da escada (`art/stairs.js`) em faces calculadas, nas 4
  rotações e em qualquer andar: cada degrau com a pisada de `stairs_wood` no topo e o espelho (riser) de
  `stairs_wood` na frente, as duas longarinas com o perfil em degraus de `stairs_wood_e` nos lados (a viga diagonal por
  baixo, aberta como na vista de lado), o topo e os degraus das longarinas na cor da madeira, a face de trás do degrau
  mais alto de `stairs_wood_n`, os corrimãos (postes com chapéu e o corrimão inclinado) e as pernas da viga como caixas
  finas na paleta da escada (`STAIR_ART`). Ordem dentro da escada por faixas de altura (uma por degrau: na mesma
  posição da tela a superfície mais alta é a mais perto, a câmera olha de cima a 45°); os lados das longarinas, postes,
  pernas e corrimão são cortados nas faixas. Duas partes: a de trás (longarina do fundo, degraus) com a própria escada,
  a da frente (longarina da frente, o corrimão dela, a face de trás) como um desenhável próprio (`levels.collect` →
  `stairFront`), e quem está subindo fica entre as duas (`Levels.zkRot`): o corrimão da frente passa na frente das
  pernas. Plantas (azul) e o fantasma do modo construção também em faces. Sombra de contato (blob) embaixo.
- **Pisos de cima (`floorUp`):** as camadas planas do próprio piso (padrão ou com estilo: `drawStatic` gravado) deitadas
  na altura do andar; a viga da laje (`slab_edge`, pintada sob demanda) em cada lado aberto virado para a câmera (sem
  superfície do mesmo andar do outro lado, sem parede embaixo); a grade azul de uma planta. Profundidade: logo depois
  das paredes do andar de baixo (os topos delas ficam embaixo) e antes de tudo do próprio andar.
- **O resto de um andar de cima (`upperSprite`, prio −1):** móveis, decoração, baús continuam sprites
  (`levels.drawUpper` → `drawUpperRot`): sobem reto na tela, a base no meio da borda do tile virada para a câmera,
  camadas planas (tapete, soleira, fantasma de piso) deitadas como faces na ordem do desenho, grade azul de planta
  plana, anel de desmontar e luz subindo reto; profundidade logo acima da laje embaixo.
- **Gente em cima de muralha / piso:** a profundidade de quem está num andar ganha uma margem (o canto da frente do
  topo da parede pode ficar até ~1,07 tile à frente dos pés na diagonal) — o personagem nunca some atrás da parede em
  que anda.
- **Recorte / revelar (cutaway / reveal):** com a câmera girada "na frente" é o lado da câmera (16 passos de giro):
  paredes do cômodo cujo vizinho do lado de longe está dentro, paredes do lado de perto da laje e as que estão na frente
  do jogador na tela (mais uma por andar) ficam translúcidas; o revelar (andares acima somem) não depende do giro.
- **Modo construção num andar:** o cursor sobe reto na tela (`building.originAt`), os quadrados do fantasma deitados no
  andar, o fantasma de escada em faces, os anéis do patamar subindo reto; `levels.pickUpper` e a escolha de peças de
  cima no `controller` também sobem pela rotação.
- **Terreno:** tudo em coordenadas do mundo (pedra, relevo, penhascos, bocas e tetos de caverna, túneis, minério,
  água, margens, caminhos, roças, neve); as inclinações tiradas da tela (`dFdx / dFdy`: relevo fino da pedra, brilho do
  chão molhado, teto de caverna, direção dos caminhos para pegadas) voltam para o mundo pela rotação (`v2w`). Raios de
  sol entre as árvores (pós) marcham na direção da sombra vista na tela; raios de sol de interiores (`fx/rays.js`)
  idem; chuva e neve caem para baixo na tela (camadas em espaço de vista, ainda presas ao chão quando a câmera anda).
- **Coisas penduradas na parede** (quadro, troféu, ervas, cortina, ganchos): planas na face da parede.
- **Personagens e bichos:** a vista desenhada = a direção deles menos a da câmera (`viewFacing`), em 4 vistas.
- Coisas de um andar de cima desenhadas como sprite sobem reto na tela (levels.drawUpper; ver "O resto de um andar de
  cima").

## O que falta

- **8 direções** dos personagens: hoje 4 vistas; as diagonais pedem o rig em 5 vistas (o resto espelhado).
- Telhado com tacaniça (hip): as linhas diagonais ficam aproximadas na grade; a parte de baixo do beiral não é
  desenhada.
- Portão aparece como um trecho de cerca (a folha do portão tem um quadro próprio); a luz das lâmpadas de dentro
  ainda clareia o telhado girado (o telhado não entra no mapa de luz enquanto girado).
- Fantasmas do modo construção (o que você está posicionando) continuam sprites (menos escadas e pisos num andar de
  cima, e os quadrados do fantasma num andar).
- Escadas / pisos girados não projetam sombra do sol (as faces não entram no mapa de sombras) nem recebem neve; na
  vista de lado a escada não tem o contorno escuro do sprite.
- Em 0° um baú / mesa num andar de cima sumia embaixo da laje do próprio tile (âncora acima da borda sul): agora a
  profundidade de peças de cima usa a borda sul do tile (`levels.rebuild`).
- O minimapa / radar fica com o norte para cima (a bússola mostra o giro).
