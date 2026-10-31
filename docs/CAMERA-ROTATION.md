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
- **Estruturas** (`art/faces/structures.js` registra; construtores em `art/faces/walls.js`, `doors.js`, `fences.js`;
  ferramentas em `art/faces/kit.js`). Regra de arte: um ponto (xr, yr) do tile na altura h foi pintado pela vista
  norte no pixel `col = 64·xr`, `linha = R0 + 64·yr − 64·h` do quadro da peça (R0 = 64 nas paredes / portas, 36 nas
  cercas / portões) — então uma face virada para o sul acha a própria arte (em 0°+ε fica igual ao sprite), o topo
  também; as outras faces pegam a arte de uma face igual. A arte vai na ordem do mundo (coluna da arte ↔ posição),
  então uma face vista por trás aparece espelhada, como uma tábua pintada. Só o pedaço que a imagem (recortada) do
  sprite cobre é desenhado — nunca amostra os vizinhos do atlas.
  - **Paredes** (todos os estilos e o estilo padrão, que é desenhado como o estilo que ele é): caixa. Os pintores da
    própria peça (`archCompose.drawWall`) desenham numa gravação (base, acabamentos, cantos, janelas e o brilho delas,
    prateleiras / quadros, hera, musgo, rachaduras, andaime de planta); cada camada no quadro vai para a caixa: a
    metade de cima no topo, a fachada em cada lado à mostra — sul / norte com a fachada de um trecho reto L-O (o norte
    é a mesma vista de trás), leste / oeste como se aquele lado fosse a frente. Lados internos nunca. Janelas dos dois
    lados (brilho de noite na camada de brilho, poça de luz diante de cada lado da janela); prateleira / quadro /
    escudo / arandela só no lado sul, onde foram postos (a chama da arandela no lugar dela). **Ameias** viram dentes
    3D no topo (dois por borda aberta, a arte do dente sul); **contrafortes de pedra** viram pilares 3D em dois
    estágios com o topo inclinado, no meio de cada lado aberto (os de madeira ficam pintados na face); **cantos
    suaves** cortam cada canto convexo com uma face a 45° (as colunas de "dobra" da arte suave). Sombra do sol da
    caixa (modo mundo do shader de sombra: os 4 lados como cartões em pé + o topo).
  - **Portas:** dois batentes de madeira atravessando a parede (arte do batente da porta L-O na frente / trás, a do
    batente da porta N-S nas pontas, topos dos quadros da vista norte) e duas folhas penduradas neles com a arte real
    da folha (cada estilo) nas duas faces; fechada, preenche o vão; aberta, cada folha gira no gonzo para trás como
    uma tábua fina e o vão fica livre. Aldrava / guirlanda (fechada), arco de pedra, lanterna (com a chama) e toldo
    na frente; degrau e soleira no chão (giram inteiros).
  - **Cercas:** poste no meio (caixinha com a arte do poste) e, para cada vizinho, um braço — as varas / estacas /
    tábuas / trançado do estilo como uma tábua fina com duas faces (os braços N-S usam a arte L-O girada), as pontas
    com o corte da arte (uma coluna esticada na espessura: as pontas das varas) e o topo de cada vara / tábua como uma
    tira fina — vista ao longo da linha, a cerca nunca some; trepadeira
    nas faces; capas, bola, ponta, passarinho, lanterna (com a chama) e flores ao pé como cartões virados para a
    câmera. **Sebes** e **muros de pedra:** bloco no meio + um braço grosso por vizinho, a frente da arte nos lados e
    o trecho visto de cima no topo (a sebe com o contorno ondulado da arte subindo nas bordas). **Portões:** dois postes altos e duas folhas (arte real de cada estilo) nas duas
    faces; aberto, as folhas giram nos gonzos; arco com flores atravessando a linha do portão; plaquinha na frente.
    Sombras pelas silhuetas da própria arte (modo mundo).
  - **Colunas** (`column_wood` / `column_stone`, fuste redondo): cartão virado para a câmera onde a vista norte pinta o
    fuste (o pé a 0,78 do tile; o billboard comum girava só a âncora, a borda sul, e a coluna saía do lugar), sombra
    pela silhueta virada de frente para o sol.
  - **Coisas penduradas** (quadro, troféu, ervas, cortina, ganchos): planas na face da parede em que foram postas, só
    vistas do lado do cômodo, desenhadas logo depois da parede (na vista norte elas nunca apareciam: `DECOR_GEOM.mount`
    guarda só a altura e `drawDecorProp` lia `g.l` / `g.s` → altura NaN; corrigido). **Rachaduras de cerco** (`fx/rockfx.js`): no topo e em
    cada lado à mostra (porta: nas faces das folhas; cerca: um cartão no meio).
- **Telhados:** malha inclinada (`game/roofs.js roofMesh`, `art/roofRaster.roofShape` = os mesmos retângulos e
  planos do pintor): a superfície numa grade que passa pelas cumeeiras e pelas linhas das paredes, com a imagem
  pintada do telhado como textura (um ponto (x, y, h) do telhado é onde a vista norte o pintou, (x, y − h)); oitões e
  degraus entre telhados como faces verticais até o beiral (os do sul pintados, os outros em reboco); chaminés como
  caixas de pedra. Ordenado como uma peça só (pelo ponto mais à frente); some quando o jogador entra (como sempre) e
  fica translúcido quando esconde o jogador.
- **Escadas:** 5 degraus sólidos nas cores das tábuas, subindo da entrada.
- **Pisos de cima:** as camadas planas do piso na altura do andar + a borda da laje nos lados à mostra.
- **Personagens e bichos:** a vista desenhada = a direção deles menos a da câmera (`viewFacing`), em 4 vistas.
- Coisas de um andar de cima desenhadas como sprite sobem reto na tela (levels.drawUpper).

## O que falta

- **8 direções** dos personagens: hoje 4 vistas; as diagonais pedem o rig em 5 vistas (o resto espelhado).
- Telhado com tacaniça (hip): as linhas diagonais ficam aproximadas na grade; a parte de baixo do beiral não é
  desenhada.
- A luz das lâmpadas de dentro ainda clareia o telhado girado (o telhado não entra no mapa de luz enquanto girado).
- Estruturas: tochas de parede continuam sprite (são da área de luzes / móveis); os pilares / postes de canto das
  paredes ficam pintados nas faces (não saem da caixa); faces não recebem sombra de outras coisas (como antes). Ao
  sair de 0° as sebes / muros de pedra / postes mudam alguns
  pixels (a arte da vista norte não tem topo nem espessura; em 3D têm).
- Fantasmas do modo construção (o que você está posicionando) continuam sprites.
- O minimapa / radar fica com o norte para cima (a bússola mostra o giro).
