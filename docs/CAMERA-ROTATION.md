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

- `game.cam.rot` (radianos) segue `rot To` com suavização. **3D em todos os ângulos, 0° também** (pedido do dono: "não
  gostei do fato de que no ângulo 0 o jogo fica com o visual de antes"): toda peça que tem tipo de face (paredes, portas,
  cercas, portões, escadas, pisos de cima, telhados, peças sólidas, móveis do `props.js`, fantasmas da construção,
  rachaduras) é sempre desenhada em faces; `faceKindOf` é perguntado sempre; o caminho antigo de 0° (telhados em fatias
  `roofSlice`, `levels.drawUpper` levantando sprites, o recorte de paredes de 0°) não roda mais. Só vegetação e criaturas
  continuam sprites em pé.
- **Profundidade por pixel** (seção abaixo): um buffer de profundidade na cena decide o que esconde o quê, pixel a
  pixel; a ordem de pintor continua só para misturar os pixels suaves.
- Uma transformação só: o mundo gira em volta da câmera; a altura sobe reta na tela (`y − h`, como sempre).
  - Shaders: `uRot` (cos, sen). Sprites em pé (personagens, árvores, itens, móveis) giram só a âncora e continuam de
    frente para a tela; sprites deitados (`uFlat`: pisos, tapetes, decalques) giram inteiros. Terreno, luz ambiente
    e pós-processamento convertem tela → mundo pela rotação; sombras do sol e feixes de luz também.
  - JS: `game.screenToWorld` / `worldToScreen(x, y, h)` (h = altura na tela: plaquinhas de nome), `view()` (a caixa
    em volta da tela girada), ordem de pintor = o y girado.

## Profundidade por pixel (buffer de profundidade)

Pedido do dono: "não quero nenhum problema de profundidade nesse jogo" (jogador desenhado embaixo da mesa 2×1, dentro
da porta no canto da parede, perna da escada de fora por cima da casa, jogador no topo da escada coberto pelos degraus /
pela borda do piso de cima, afundado no piso de cima em 0°). Uma ordem por objeto não acerta peças grandes em 3D em
ângulos quaisquer; agora cada pixel tem profundidade.

- **Fórmula:** a projeção é oblíqua — um ponto com y de vista (para a câmera) `y` e altura `h` aparece na tela em
  `y − h`, e o raio que passa por um pixel anda em (+y, +h). Então a profundidade para a câmera é **d = y + h** (maior =
  mais perto), relativa à câmera. No clip: `z = −d / 256` (|d| < 256 em toda a tela; buffer de 24 bits ≈ 3·10⁻⁵ tile por
  passo), teste `LEQUAL`.
- **Buffer:** `renderer.resize` põe um renderbuffer `DEPTH_COMPONENT24` na FBO da cena (junto da cor e da camada de
  brilho). Limpo no começo da passada ordenada.
- **Faces** (`engine/faceBatch.js`, `FACE_VS`): exatas por vértice (planas). Cada quad leva um viés (10º float): o viés
  do desenhável + um viés minúsculo crescente por quad (`Z.ord × 2·10⁻⁴`: camadas coplanares de uma peça — base,
  acabamentos, janelas, hera — mantêm a ordem) + `faces.bias` (algo deitado de propósito sobre outra superfície:
  rachaduras 0,006, tapetes / sombras de peças de cima 0,01, piso de cima sobre o topo de parede `zBias` 0,004).
- **Sprites** (`engine/spriteBatch.js`, 26 floats por instância: modo + referência x, y, altura, viés): um **cartão em
  pé** pelo ponto de referência (d = 2·y_ref − S, S = y da tela) cuja parte abaixo do pé fica **deitada** na altura do pé
  (d = S + 2·h_ref) — o "V" não é linear no quad, então o fragmento calcula a profundidade (`gl_FragDepth`; o sprite já
  descarta texels). Modos: 0 cartão, 1 deitado (quem dorme), 2 cartão que pode abrir no recorte (copas de árvore).
  - Criaturas (jogador, NPCs, outros jogadores, bichos): **um cartão só pelo pé** (todas as partes do boneco no mesmo
    plano: a ordem do rig decide entre elas); num andar / escada o pé verdadeiro (x, y) na altura `z · STORY_H` (o
    sprite continua levantado reto na tela); viés 0,02 (os pés sobre o piso em que pisam).
  - Quem **dorme** (pose sleep): deitado no colchão (altura 0,16; no chão 0,02), viés 0,4. Quem **senta**: cartão pelo
    assento (o mesmo ponto que `art/compose.js` usa; `seatAt` com a câmera girada) na altura dele, viés 0,1 — o encosto
    esconde as costas quando a câmera olha a cadeira por trás (`game.js restDepth`, depois do desenho).
  - Árvores, pedras, plantas e o resto sem tipo de face: cartão pelo pé (o objeto).
  - Sprites de um tipo de face (chamas, brilhos, peças em pé do `props.js`, andaime): no próprio ponto deles (âncora +
    `lift`), viés 0,3 (`Z.sb`: na frente das faces da própria peça). Peças de cima desenhadas como sprite
    (`levels.drawUpper` → `drawUpperRot`): cartão pelo ponto da peça na altura do andar.
- **Quem escreve / quem só testa:** na passada ordenada (`main`, `faces`, `emissive`) tudo testa; escrevem os pixels
  opacos — um fragmento que escreve e tem alfa < 0,25 é descartado (`ALPHA_CUT`: a borda suave não esconde o que vem
  depois); sprites / faces translúcidos (alfa < 0,97: copa esmaecida, fantasmas, plantas azuis, telhados sumindo) só
  testam (`nw`: o lote divide a chamada onde a escrita muda). Brilhos (`emissive`) só testam, viés +0,1: fogo nunca por
  cima de quem está na frente, janela de trás nunca por cima do telhado. Partículas (faíscas, brasas, poeira na camada de
  brilho) são desenhadas antes de `R.depthEnd()` e também testam. Depois de `depthEnd` (sobreposições dos sistemas:
  fantasmas e grade da construção, anéis, marcas) e nas outras passadas (chão, decalques, grama, sombras de contato no
  chão, fumaça / chuva `fx`, sombras do sol, luz, pós, HUD) não há teste — como antes.
- Coplanar de propósito: camadas de uma peça (ordem do quad), rachaduras / tapetes / piso sobre parede (viés), ameias de
  uma parede com outra parede empilhada em cima não são desenhadas (`walls.js stacked`: furavam a face da de cima).

## Recorte em volta do jogador (cutout)

O dono: "estou no térreo e as estruturas dos andares de cima ficam invisíveis mesmo sem eu estar atrás" (pátio aberto
de uma fortaleza: o anel inteiro do andar de cima sumia). Agora nada some por regra; só abre o que cobre o jogador.

- `CUT_FN` (sprites e faces): fragmentos de **estruturas** (todas as faces; sprites só no modo 2 = copas de árvore) que
  estão **na frente do jogador local** (d − d do cartão dele > 0,15…0,6), **acima da cintura** dele (altura − pés >
  0,5…0,8: mesa / cadeira na frente das pernas não abrem) e dentro de uma **elipse do corpo** na tela (meia largura 0,5,
  meia altura 0,85, centro no peito) ficam furados num pontilhado (Bayer 4×4, até 78 %, borda suave): o jogador aparece
  através da parede, do piso de cima, do telhado, da escada, da copa. Pixel furado não escreve profundidade (o que está
  atrás aparece). Em qualquer ângulo; outros jogadores / NPCs desenhados normalmente; `game.cutout` (entra / sai
  suave, desligado morto).
- **Revelar** (`levels.js reveal`) só **dentro de um prédio com telhado** (a região de telhado em volta do jogador): os
  andares de cima somem para ver o cômodo, como antes. Os ramos "sala fechada no térreo" (o pátio) e "laje inteira
  acima" foram retirados. O **cutaway** (paredes do cômodo / na frente do jogador a 0,22) e o telhado translúcido
  (0,32 quando cobria o jogador) foram aposentados: o recorte faz isso só onde cobre.
- Conferir: `game.debugK.fortScene()` (pátio murado de dois andares com ameias, adarve em cima, cabana com telhado,
  fogueira, tochas de parede) e os pontos `court`, `court_s`, `walk`, `out_n`, `hut`, `fire_n`, `wtorch`;
  `game.debugK.depthScene()` (casa com portas ao lado do canto, piso de cima com mureta, escada de fora ao longo da casa
  até uma passarela entre dois andares de cima, mesa 2×1, cadeiras, cama, árvore, tocha, braseiro) e os pontos
  `table_n|s|e|w`, `door_out|mid|in`, `door_e(_out|_in)`, `stair_bot|mid|top`, `upper_top`, `walkway`, `upper_edge`,
  `tree_n|s`, `wall_n|s`, `torch`, `bed`; `game.debugK.depthAt(ponto, dx, dy, 'sleep' | 'sit')` põe o jogador lá,
  `game.debugK.depthDummy(ponto)` põe outro sobrevivente (local).
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
- **Telhados** (`art/roofFacets.js`, `game/roofs.js`): peças 3D de verdade, com arte própria em cada face — uma água
  tem a mesma cara vista de qualquer lado.
  - **Geometria exata** (`turnedGeom`, a partir de `art/roofRaster.roofShape` = os mesmos retângulos, planos e beirais
    do pintor da vista norte): a superfície é o MÁXIMO dos retângulos do MÍNIMO dos seus planos. O domínio de cada
    retângulo é cortado pelas linhas das paredes (onde o beiral fica mais raso), cada plano fica com a parte convexa em
    que é o mais baixo do seu retângulo e os outros retângulos mais altos ali são subtraídos (recorte de polígonos
    convexos): tacaniças (hip), rincões dos L / T / U e alas que morrem num telhado mais alto saem exatos.
  - **Arte em planta:** a superfície é pintada vista de cima (ortográfica, alinhada ao mundo) num atlas por região: as
    fiadas seguem o beiral de cada água (telhas escama / tabuinhas / palha / lajes por estilo, com a luz fixa da vista
    norte por água), cumeeiras (telha / amarrada / tábua), arestas das tacaniças, calhas dos rincões, musgo, desgaste,
    tom, acabamentos claros nas beiradas (`trim`). Um ponto (x, y, h) do telhado usa o texel (x, y) — sem esticar.
  - **Faces verticais:** testeiras nos beirais, bargeboards nas empenas (cor da tábua do estilo ou `trim`), degraus
    onde um telhado mais alto fica sobre um mais baixo (material da empena sob uma tábua), **empenas** na linha da
    parede (reboco com enxaimel / tábuas / pedra pelo estilo; janela quando a empena é grande, que **brilha à noite**
    com uma luz acesa dentro, na camada de brilho), sombra suave do beiral nas paredes. Empenas só onde o lado de fora
    não é dentro de outro retângulo; sob o beiral de uma empena sobre um telhado mais baixo aparece a própria empena.
  - **Chaminés** de pedra sobre as lareiras (o pé segue a água, capa mais larga, boca escura; a fumaça sai do meio da
    boca), **cata-vento** (haste em cruz, seta, cruz dos pontos cardeais: visível de qualquer lado).
  - **Ordem de desenho:** por ângulo (passos de 0,25°, guardado), só as faces viradas para a câmera (uma água com
    subida ≥ 1 na direção da vista fica escondida pela da frente); peças em planta disjuntas ordenadas na direção da
    vista (na mesma linha de vista, a mais perto da câmera vai depois; o que está em cima do telhado depois da água
    embaixo), ordenação topológica. Depois cortadas em **colunas de vista** de 1 tile: cada coluna é um desenhável
    ordenado com os sprites (chave = o ponto mais à frente das paredes a meio tile da coluna, para nenhuma caixa de
    parede passar por cima do beiral; um sprite em pé sob o beiral, na frente da parede, fica por cima — como no
    norte). Chaves relativas ao meio da região, corrigidas pelo ângulo exato a cada quadro. Girando, as vistas são
    recalculadas dentro de 2,5 ms por quadro (as mais atrasadas primeiro).
  - **Pintura:** no worker (`roofWorker.js`, modo 3: junto com a arte norte, que ainda serve para luz / raios / o mapa
    de telhados), sempre (3D em 0° também); até a arte chegar, a mesma geometria em cores lisas por água.
  - **Luz / clima:** o telhado girado entra no mapa de luz como oclusor (`uRoofFx.w`: lâmpadas de dentro não clareiam
    o telhado), escurece com a chuva e recebe a neve só nas águas (não nas empenas) — `FACE_FS uRoofFx`. Sombras do sol:
    as peças e o volume das paredes projetados no chão ao longo do sol (`batches.shadowFaces`, MAX como os sprites):
    certas em qualquer ângulo.
  - **Interação:** tocar no telhado (desmontar etc., `roofPick`) lança um raio da tela para a câmera (subir na tela =
    subir em altura) contra a superfície de todas as regiões; o telhado na frente do jogador abre no recorte em volta
    dele (não fica mais translúcido inteiro); desabamento: as peças descem e somem; plantas de
    telhado, o fantasma do telhado e a marca vermelha de desmontar viram faces que giram com o mundo (a marca deitada
    na água), `roofTileFace` / `liftedPoint`; some quando o jogador entra (como sempre).
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
- **Recorte / revelar:** ver "Recorte em volta do jogador" (o cutaway de paredes translúcidas foi aposentado; o revelar
  vale só dentro de prédio com telhado).
- **Modo construção num andar:** o cursor sobe reto na tela (`building.originAt`), os quadrados do fantasma deitados no
  andar, o fantasma de escada em faces, os anéis do patamar subindo reto; `levels.pickUpper` e a escolha de peças de
  cima no `controller` também sobem pela rotação.
- **Terreno:** tudo em coordenadas do mundo (pedra, relevo, penhascos, bocas e tetos de caverna, túneis, minério,
  água, margens, caminhos, roças, neve); as inclinações tiradas da tela (`dFdx / dFdy`: relevo fino da pedra, brilho do
  chão molhado, teto de caverna, direção dos caminhos para pegadas) voltam para o mundo pela rotação (`v2w`). Raios de
  sol entre as árvores (pós) marcham na direção da sombra vista na tela; raios de sol de interiores (`fx/rays.js`)
  idem; chuva e neve caem para baixo na tela (camadas em espaço de vista, ainda presas ao chão quando a câmera anda).
- **Coisas penduradas na parede** (quadro, troféu, ervas, cortina, ganchos): planas na face da parede.
- **Personagens e bichos:** em 8 vistas (abaixo).
- Coisas de um andar de cima desenhadas como sprite sobem reto na tela (levels.drawUpper; ver "O resto de um andar de
  cima").

## Personagens, bichos e o que vai com eles (8 vistas)

- **Ângulo de frente, só para desenhar** (`art/facing.js`): a rede continua mandando só a letra (`s / n / e / w`). Cada
  cliente deriva um ângulo do que vê: o movimento da criatura (posições interpoladas — a cópia remota anda igual ao
  original), senão o alvo / ameaça enquanto parada ou atacando; vale só enquanto concorda com a letra (±60°), senão a
  própria letra. A vista desenhada = ângulo − giro da câmera, em passos de 45° com histerese (troca 25° depois do
  centro, não 22,5°): nem a câmera girando nem a criatura virando fazem piscar. `game.js` põe `o._dv` ('se' / 'sw' /
  'ne' / 'nw') e `o.facing` = o lado mais perto durante o desenho e devolve tudo depois. Em 0° nada disso roda.
- **Peças 3/4** (`art/look/turn.js`): cada peça do visual (corpo, roupas, cabeça, rosto, cabelo, barba, pálpebras) e
  as de fora do visual (armadura `wear_*`, bandana, máscaras antigas, gelo / armadura / rosto dos Andarilhos) viram uma
  vista 3/4 a partir da frente (`se`) ou das costas (`ne`), linha por linha: o contorno fica (uma cabeça / tronco a 45°
  tem quase a mesma silhueta) e o conteúdo de dentro desliza para o lado para onde o corpo olha, como uma superfície
  enrolada num cilindro — olhos, nariz, boca, botões, risca do cabelo andam; o olho de lá estreita. O raio de cada linha
  segue o corpo (o contorno do tronco; uma esfera no crânio, cilindro das bochechas para baixo: queixo e barba andam
  com o rosto), então o alto da cabeça continua redondo. No cabelo de frente, a parte de trás da cabeça da vista de lado
  vem por baixo, apertada na borda de perto (senão o lado de perto ficava careca). sw / nw = espelho.
  Pintadas sob demanda na textura preguiçosa do visual (`look/lazy.js`, `LA.prepare` pinta as fontes sem colocá-las),
  só quando uma câmera girada mostra aquela vista; até ficarem prontas desenha-se o lado mais perto (sem buraco). O
  jogador local pinta na hora (como as peças normais).
- **Pose 3/4** (`art/compose.js`): a pose do boneco virou uma função (`rigPose`) que calcula tudo de uma vista (corpo,
  cabeça, pés, mãos, item na mão / na outra mão, quem fica atrás do corpo). Na diagonal roda a da frente / costas e a
  de lado e mistura (`blendPose`): deslocamentos de lado ficam quase inteiros (a arte 3/4 também), os para a frente
  (o x da vista de lado, a profundidade da de frente) vão na diagonal, alturas na média, itens na mão giram pelo vetor
  de direção (encurtam quando apontam para a câmera), ordem de desenho da vista de frente / costas. Pés: as botas de
  lado, passada na diagonal. Rastro dos golpes misturado igual. Andar, atacar, habilidades, bloquear, arco, lança,
  ferramentas, comer / curar, nadar, escadas: tudo pela mesma pose. Sentado e o rodopio ficam na vista mais perto.
  Cabeça virada para algo: num corpo 3/4 só para os dois lados da diagonal (a cabeça de lado / frente / costas).
- **A pose em volta da criatura** (`viewB` / `viewPt`): o rig monta as partes com deslocamentos de tela em volta do
  corpo; com a câmera girada um adaptador do lote vira esses deslocamentos em deslocamentos do mundo em volta do ponto
  no chão (antes as mãos / pés / cabeça descolavam do corpo girado). Vale para pessoas, bichos, mortos e corpos no chão
  (`art/corpseDraw.js`): um corpo deitado fica deitado de lado na tela, sangue / manchas / moscas juntos.
- **Bichos:** a diagonal é a arte de lado encurtada (×0,84) com o focinho um pouco para baixo (vindo para a câmera) /
  para cima (indo embora); o bote vai na diagonal.
- **Na cama:** a cabeça e o cobertor giram com a cama (ângulo da cama − giro); a profundidade fica logo na frente da
  cama / cadeira em qualquer giro (`_sobj`). Dormindo no chão e o Zzz: na tela.
- **Projéteis** (`game/projectiles.js`): flechas / lanças apontam pelo voo na tela (movimento no mundo girado − subida),
  inclusive as cravadas; sombra do arremesso na direção da tela; ordem por profundidade girada (`zkRot`).
- **Luzes e efeitos:** luz do jogador, do Andarilho, da caverna e dos vaga-lumes sobem reto na tela; anel do alvo
  sob os pés no andar de cima; números de dano sobem reto (overlay); traços da mira e do alcance, rastros de golpe /
  investida / rodopio (`wrot`: ângulo no chão − giro); bichinhos do ambiente viram para o lado certo.
- **Em 0°**: o boneco é pixel a pixel o de antes (comparado contra o commit anterior nas 4 vistas, andando, atacando,
  escudo, tocha, arco, morto).


## Peças sólidas (`art/faces/solid.js`): móveis como as paredes

Pedido do dono: **todas** as estruturas (baú, luzes, cama, mesa, cadeira, lareira…) são objetos 3D de verdade, parados
no mundo enquanto a câmera gira, como as paredes; só vegetação e criaturas (jogador, NPCs, bichos) continuam sprites em
pé. O kit `art/faces/solid.js` faz isso a partir da **arte da própria peça**; cada tipo é só uma entrada de tabela
(`defineSolid(tipo, spec)`, em `art/faces/solidTypes.js` e nas tabelas por área: `solidLights.js` = luzes, fogo e
estações). Tipo na tabela sai do `props.js` (o tipo de face `solid` tem `prio: 1`); tipo fora da tabela continua como
antes (em pé de frente para a tela / arte dobrada). Prontos: **baú** (com a tampa aberta `chest_open`), **barril**,
**mesa**, **cadeira**, **cama**, **pilha de caixotes** e, em `solidLights.js`: **fogueira**, **braseiro**, **caldeirão**,
**fornalha**, **bigorna**, **bancada**, **mesa de cantaria**, **tear**, **lareira**, **velas**, **candelabro**,
**lanterna de pedra**, **poste de lanterna**, **poste com lanterna** e a **tocha** — de chão e **de parede** (as quatro
paredes).

### Como funciona

- **Textura projetiva, como nas paredes:** um ponto (x, y, h) da peça pega o texel onde a arte daquela vista mostra
  esse ponto (em 0°: coluna = 64·x, linha = 64·y − 64·h a partir da âncora do sprite). A vista que a câmera vê em 0° (a
  do lado para onde a peça está virada) texturiza o modelo: topos, a frente e a metade da frente de uma peça redonda —
  então em 0° (e com o giro → 0) é o sprite pixel por pixel, sem pulo quando a câmera começa a girar. Cada outro lado
  pega a arte da vista que olha para ele (`<tipo>_n` / `_back`, `<tipo>_e` / `_side`, oeste = leste espelhado), **ajustada
  parte por parte** (os pintores nem sempre desenham a peça no mesmo lugar / tamanho em cada vista: cada vista pode
  listar as mesmas partes nos números da própria arte). Texel transparente = buraco (pernas, vãos e contornos saem da
  arte numa caixa simples).
- **Contorno:** o contorno escuro da arte (2,6 px) faz parte do sólido: cada parte cresce por ele dos lados, atrás do
  topo e abaixo do chão (senão em 0°+ε a peça perdia o contorno).
- **Arte achatada (`k`):** arte antiga desenha a profundidade mais curta do que é (a tampa do baú: 17 px para 0,56 de
  tile; a elipse do topo do barril). `k` = profundidade na arte / profundidade de verdade, `piv` = a linha em volta da
  qual achata (0 = a âncora = a frente do corpo; uma peça redonda: o eixo). O modelo tem a profundidade de verdade e,
  perto de 0°, é achatado de volta ao longo da vista; o achatamento some nos primeiros `SQ_RAMP` (0,5 rad) de giro
  (`k1` = 1). Peça redonda usa `k1 = k`: achatada em qualquer ângulo, o que numa peça redonda é igual de todos os lados
  (o barril fica com a cara da arte).
- **Sem amostrar vizinhos do atlas:** cada face é recortada (no carregamento do modelo, na CPU) no retângulo da imagem
  do sprite: nenhuma mudança de shader, nenhum custo por quadro.
- **Luz e estado:** lados com a luz das paredes (`kit.shade`, entrando junto com o giro para não pular em 0°), topo sem
  sombreado, lados de dentro (`open`) mais escuros; planta / fantasma / obra / desaparecer (`props.tintOf`), andaime
  da obra (sprite), tremor do golpe (para o lado da tela), sombra de contato do pintor (presa ao mundo), sombra do sol
  (caixas: `kit.shadowRect`, achatada junto perto de 0°; peças redondas: a silhueta da arte atravessada ao sol).
- **Ordem:** as partes da peça de trás para frente (pelo centro; `z` corrige), e dentro de uma parte: lados de dentro,
  lados, topo. A peça entra na ordem geral pelo ponto mais à frente do modelo (achatado como ele); num andar de cima
  nunca antes do piso do próprio tile (`floorUp`).
- **Chamas, brilhos, luz:** `fx` põe a chama / brilho do pintor no ponto 3D (a chama continua de frente para a tela,
  como partícula, mas presa ao pavio); `light` é onde a poça de luz, o halo e a fumaça de `fx/ambient.js` saem
  (`lightAt`). Quem **senta** senta no assento do modelo (`seat`, `art/compose.js` pergunta `seatAt` enquanto girada,
  saindo do lugar de 0° junto com o giro); quem **dorme** deita no colchão como antes.
- **Desempenho:** modelo, UVs recortadas e posições no mundo dependem só da peça: feitos uma vez por objeto (`WeakMap`,
  refeitos quando muda lugar, giro, estado, andar ou o lugar de um sprite preguiçoso no atlas). Por quadro: visibilidade
  de cada lado, ordem das partes e cores (cópia direta para `B.faces` com `FaceBatch.quadF`, sem alocação). Peças
  seguidas na ordem sem sprite no meio saem numa chamada de desenho só.
- Em 0° também são as peças em 3D (3D em todos os ângulos; ver "Profundidade por pixel").

### Como converter um tipo (uma entrada na tabela)

Números lidos do pintor da arte (`art/stations.js`, `decor.js`, `buildings.js`…): `x` = px a partir da coluna do meio
da arte, `v` = linha do chão em tiles (o `Y(v, h) = E + 64v − h` dos pintores; a linha da âncora é `v = V`, padrão 1),
`h` = px acima do chão. Partes:

| parte | formato | uso |
|---|---|---|
| `box` | `[x0, x1, v0, v1, h0, h1]` | caixa (`open: true`: vazada, os lados de trás aparecem pelos vãos — mesa, cadeira) |
| `card` | `[x0, x1, v, h0, h1]` (+ `t` px) | tábua fina em pé (encosto, cabeceira, placa, estandarte) |
| `lathe` | `[x, v, [[h, r], …]]` (+ `n` lados) | peça redonda: barril, vaso, jarro, balde, banquinho, poste, tocha |
| `quad` | `[[x, v, h] × 4]` | uma face inclinada (tampa, telhadinho) |

Por parte: `sh: false` (sem sombra do sol), `z` (ajuste da ordem), `top: 'strip' | 'none'`. Por tipo: `k`, `k1`, `piv`,
`V`, `ow` (contorno), `foot: true` (peças de decoração encostáveis: a arte é desenhada mais baixa pelo pé,
`archCompose.footOf`), `views: { n | e: { parts, k, piv, V, seat… } }` (a mesma lista de partes nos números da arte
daquela vista), `borrow: { n: 'mirror', e: 'front' | 'edge' }` (vista sem arte: o verso espelha a frente; o lado mostra a
frente como se fosse a frente — bom para peças redondas / simétricas — ou `'edge'`, as colunas da borda da frente
esticadas no lado — caixas compridas), `when(o)` (false = fica com o `props.js`), `state(o)` + `variants` (outra arte
para um estado; `only: true` = os outros lados emprestam dela), `fx: [{ at: [x, v, h], draw(B, A, o, t, x, y, lift,
a) }]`, `light: [x, v, h]`, `seat: [x, v, h]`, `blob: false | [sx, sy, dy, a]`.

Exemplo (a mesa: uma caixa vazada, a vista de lado com os próprios números):

```js
defineSolid('table_wood', {
  parts: [{ box: [-56, 56, 0.15, 0.85, 0, 27], open: true }],
  views: { e: { V: 2, parts: [{ box: [-22, 22, 0.12, 1.86, 0, 27], open: true }] } },
});
```

### Luzes, fogo e estações (`art/faces/solidLights.js`)

Pedido do dono (depois): **nada de cara de sprite em 0°** — o 3D vale em todos os ângulos, 0° também (outro trabalho
liga as faces em 0° e um buffer de profundidade por pixel). Então estas peças têm a **profundidade de verdade em
qualquer ângulo** (`ramp: false`: sem achatar perto de 0°); `k` só diz como a arte desenha a profundidade, e a arte é
esticada sobre a profundidade real (uma arte de frente chapada — fornalha, postes, lanterna de pedra — vira o topo
esticado das linhas de cima). Coisas redondas no chão (anel de pedras, prato, aro) viram círculos de verdade.

- **Fogueira:** anel de 10 pedras (cada uma um sólido) em volta de um monte baixo de cinza e lenha; brasas
  (`campfire_coals`) deitadas sobre o monte; chamas, chama que estala e brilho no centro do anel.
- **Braseiro:** bacia redonda com as brasas na boca, três pernas de ferro inclinadas de verdade (pés no anel que `k`
  dá); fogo na boca. **Caldeirão:** anel de 8 pedras, cinza / lenha com brasas, tripé de três pernas inclinadas até o
  ápice, corrente, caldeirão, alça e concha; fogo sob o caldeirão e o **vapor** saindo da boca enquanto cozinha.
- **Fornalha:** cúpula de pedra (a boca e as juntas acesas como **brilho sobre a face**, só quando trabalha), chaminé
  saindo de trás da cúpula (com a brasa no topo), atiçador encostado e fole; a chama da boca só aparece de frente
  (some girando para os lados / de trás). **Vista de trás pintada** (`furnace_back`, `art/stations.js`, preguiçosa: só com
  a câmera girada): cúpula sem boca e a chaminé do outro lado — antes as costas mostravam uma segunda boca.
- **Bigorna:** cepo redondo, cintura, mesa com o chifre e o martelo deitado em cima.
- **Bancada / cantaria / tear** (2×1, `model: 'front'`: a mesma peça virada para qualquer lado; a arte `_n` / `_e` só
  pinta): bancada vazada com o painel de ferramentas atrás; mesa de pedra com o bloco sendo lavrado, a pilha de blocos
  e as pedras no chão; tear (o quadro como uma tábua grossa), o banco do tecelão e o cesto de algodão.
- **Lareira:** **uma lareira de pedra só, ocupando a pegada inteira** (2×1: `k` 0,5 leva a profundidade da arte até a
  parede de trás e a borda da frente), a mesma de todos os lados (`model: 'front'`; a arte de lado / de trás só pinta):
  o peito da chaminé subindo pela parede, a lareira com uma **boca de verdade** (dois batentes, a verga, a parede do
  fundo — o fogo queima dentro, visto só de frente), a prateleira do consolo saindo para a frente e as duas velas.
- **Velas / candelabro** (peças de borda, `foot`): prato com três velas / tripé, haste, braços e cinco velas nos
  copinhos, cada chama no pavio. **Lanterna de pedra:** base, fuste, colar, a cabeça com uma janela acesa **em cada
  lado** (brilho sobre as faces) e a chama dentro, telhadinho. **Postes** (de madeira e com lanterna): base, poste,
  braço e a lanterna redonda pendurada — o vidro aceso em volta toda (brilho sobre as faces) e o halo nela.
- **Tocha de parede** (`o._mount`): placa de ferro na face da parede, braço e a tocha saindo **inclinada para fora**
  (`lean`), chama no topo da cabeça; o mesmo modelo nas quatro paredes (`torch_wall_e` pinta os lados). Desenhada logo
  depois da parede em que está enquanto aquela face aparece (`depth`); com a face virada para longe a parede a esconde.
- **Luz / fumaça / halo:** `light` de cada peça é o ponto no chão sob a chama (fogueira no centro do anel, lareira dentro
  da boca, postes sob a lanterna, tocha de parede sob a cabeça): a poça de luz (`game.js`), o halo, as brasas e a fumaça
  (`fx/ambient.js`) saem dali.
- **O kit ganhou** (genérico, em `solid.js`): `lean` (eixo inclinado de um torno), `glow` (arte de brilho sobre as faces,
  para a camada de brilho), `model: 'front'`, `ramp: false`, `lift` (arte desenhada acima do chão da peça; por parte: só
  a textura dela), `depth` por tipo, `blob` / `fx` / `light` das variantes; um torno pega cada **quarto** da arte da vista
  que olha para ele (antes metade da frente / metade de trás: de lado ficava uma coluna esticada); o `n` de um torno
  agora vale (o contorno o perdia).
- Teste numa casa de verdade (paredes, piso, porta, telhado, peças encostadas em cada parede, andar de cima) de dia e de
  noite em 0°, 45°, 90°, 135°, 180°, 270°.

Conferir: `game.debugK.props(['tipo', …])` (vitrine: cada tipo em todas as rotações + uma planta), câmera
`game.cam.rot = game.cam.rotTo = 0.003` contra `0` (deve ser o mesmo quadro), 45°, 90°, 135°, 180°, 270°, noite
(`game.debug.setTime(22)`), num andar de cima; `solidEntry(o)` devolve o modelo guardado de uma peça.

## Móveis, estações, decoração e modo construção (`art/faces/props.js`)

Toda peça construída com chão próprio (móveis, estações, decoração, luzes, jardim) que **ainda não está na tabela das
peças sólidas** é desenhada enquanto girada pelo tipo `prop` das faces. Pisos, tapetes, pedras de passagem e canteiros
de horta continuam no chão (`uFlat`) e giram inteiros com o mundo.

- **Peças de 1 tile** (baú, cadeiras, barril, velas, lamparinas, tocha, braseiro, fornalha, bigorna, poço, estátua,
  espantalho, boneco de treino…): continuam em pé, mas **paradas no lugar delas**. O próprio pintor desenha a peça como
  em 0° em volta do centro do corpo e tudo o que ele solta (arte, sombra de contato, sombra do sol, chamas, brilhos,
  fumaça da panela, rachaduras) vai para o mesmo lugar na tela em relação a esse centro (`XB`). A arte mostrada é o
  lado que a câmera vê da peça (s / n / e / w, espelhado como em 0°). Guarda-roupa, estante aberta e quadro de avisos
  ganharam vistas de lado e de trás (`<tipo>_side` / `<tipo>_back` em `decor.js`), usadas **só** com a câmera girada —
  em 0° nada muda.
- **Peças de vários tiles** (cama, mesa, bancada, cortador de pedra, tear, estante de livros, cômoda, bancos, lareira,
  tina, floreira, lenha, carroça, suportes): a **arte dobrada**. Da vista que a câmera vê mais de frente sai um perfil
  da arte 3/4 (`PROF`, nos números do próprio pintor `Y(v, h)`): o cartão de trás (o que fica acima do topo: cabeceira,
  painel de ferramentas, chaminé), o topo deitado na altura dele, a frente em pé, o chão na frente; na vista exata é o
  sprite pixel por pixel, no meio do caminho gira como peça sólida. O lado que aparece recebe a frente da arte vista
  daquele lado (a vista `_e`, espelhada do outro lado). Vistas de quina de armações (suporte de armas, tear, varal vistos
  de ponta) ficam em pé (`BILL`) — num cartão a ponta virava um poste alto. Estante de livros, cômoda e lareira têm
  costas pintadas (`_back`).
- **Estruturas abertas** (pérgola, arco de jardim, `PARTS`): postes em pé de frente para a câmera nos lugares deles,
  treliça deitada na altura dela, o arco em pé no próprio plano.
- **Luz, fumaça, halos:** a luz da peça, a fumaça / brasas e o halo de `fx/ambient.js` saem de onde a peça é desenhada
  (`lightAt` do tipo da face; `game.js` e `ambient.js` perguntam enquanto girada). A lamparina de madeira espelhada
  agora espelha o brilho junto.
- **Quem dorme / senta:** logo depois da cama / cadeira na profundidade; deitado no colchão (o ponto que em 0° aparece
  no mesmo lugar, levantado até o colchão) e girando com a cama.
- **Profundidade:** peça dobrada pelo ponto mais à frente do chão dela (`boxDepth`), peça em pé pela frente do corpo como
  a câmera vê.

### Modo construção girado (`game/building.js`)

- **Fantasmas** (verde / vermelho) desenhados pelo mesmo tipo de face da peça pronta (paredes como caixas, cercas como
  painéis, móveis dobrados…), e uma **seta no chão** mostra para onde a frente vai ficar — o giro (R / ⟳) é em direções
  do mundo ("Virado para o sul" = sul do mundo, onde quer que ele esteja na tela).
- Marcas da planta: grade azul no chão (gira com o mundo), barra de progresso e selo de "falta material" em cima da
  peça como a câmera vê, anéis de desmontar / mover / pincel de estilo girando com peças compridas; plantas de telhado,
  telhado marcado para desmontar e o balde de tinta do telhado como faces deitadas na altura do beiral.
- **Toque / clique** (`game/controller.js pick`, menu de toque longo): o teste é feito em espaço de tela — o alto de uma
  peça, árvore ou criatura é acertado subindo pela tela, em qualquer ângulo; o mais à frente é o de maior profundidade.
  O anel do alvo de quem está num andar de cima sobe reto na tela.

### Mira, alcance e radar

- **Mira** (`ui/aim.js`): o arrasto do celular é na tela (virado para o mundo), o foco da câmera mede a tela girada,
  os traços do anel de alcance seguem o círculo na tela; o **flash de alcance** do arco idem.
- **Rachaduras** de paredes atacadas (`fx/rockfx.js`) vão para as faces da caixa da parede (topo + lados abertos que
  se veem), ordenadas logo depois dela.
- **Radar** (`ui/radar.js`, `ui/minimap.js`): por padrão **gira com a câmera** (o que está à direita na tela está à
  direita no radar; as gotas da borda no ângulo da tela; a bússola mostra o norte). Opção no mapa grande: "Radar gira
  com a câmera" (`wos.radarRot`). O mapa grande fica sempre com o norte para cima. Enquanto girada, um cone claro no
  radar e no mapa mostra para onde a vista olha.

## O que falta

- Telhados: a parte de baixo do beiral não é desenhada (com a câmera a 45° ela nunca aparece: a parede ou a própria
  água da frente a escondem); ao carregar o mundo os telhados aparecem em cores lisas até o worker pintar (~0,1–0,3 s
  por casa); a ordem das peças vem de um ângulo até 0,25° atrás (giro rápido: alguns quadros).
- Profundidade: sprites são cartões (um plano em pé pelo pé): o braço de um personagem ao lado de uma peça é cortado
  pela peça como uma tábua, não como um corpo redondo; a copa de uma árvore é plana na altura do tronco; peças de 1 tile
  do `props.js` (ainda sprites) ficam num plano na frente do corpo. A borda suave (alfa 0,25…0,97) de um sprite que
  escreve profundidade ainda esconde o que for desenhado depois atrás dela (1 px; só onde a ordem de pintor erra).
  Sobreposições dos sistemas (fantasmas da construção, anéis) continuam por cima de tudo, sem teste. A luz da janela no
  mapa de luz / o halo de `fx/ambient.js` não são cortados por profundidade (camadas de luz em tela).
- Recorte: o pontilhado mostra o chão / o vazio de dentro de uma parede grossa onde a elipse passa da silhueta do
  jogador (porta no canto); o oclusor de luz do telhado não abre (a luz lá dentro não vaza pelo furo).
- Estruturas: os pilares / postes de canto das
  paredes ficam pintados nas faces (não saem da caixa); faces não recebem sombra de outras coisas (como antes). Ao
  sair de 0° as sebes / muros de pedra / postes mudam alguns pixels (a arte da vista norte não tem topo nem
  espessura; em 3D têm).
- Escadas / pisos girados não projetam sombra do sol (as faces não entram no mapa de sombras) nem recebem neve; na
  vista de lado a escada não tem o contorno escuro do sprite.
- Em 0° um baú / mesa num andar de cima sumia embaixo da laje do próprio tile (âncora acima da borda sul): agora a
  profundidade de peças de cima usa a borda sul do tile (`levels.rebuild`).
- Personagens: a 3/4 é feita da vista de frente / costas (não há arte pintada em diagonal): o braço de lá ainda
  aparece na borda; o nariz não sai do perfil. Bichos na diagonal = perfil encurtado (sem vista 3/4 própria).
  Sentado e o rodopio usam a vista mais perto. Bichinhos do ambiente só trocam de lado (não giram de verdade).
- **Peças sólidas:** falta converter os outros tipos de móveis / jardim para a tabela de `art/faces/solid.js` (até lá:
  em pé com 4 vistas ou arte dobrada do `props.js`); luzes, fogo e estações já estão (`solidLights.js`). Nelas: o topo
  de arte chapada (fornalha, postes, lanterna de pedra) é a borda de cima da arte esticada (a arte não tem topo); o
  caldeirão / pote visto de trás é a frente espelhada; as velas do consolo da lareira e a ponta do quadro do tear vistas
  de lado pegam a arte de lado (pedra / transparente); a fumaça de um fogo de baixo atravessa um piso de cima (como
  antes); o halo de `fx/ambient.js` continua por cima de tudo (como em 0°); uma tocha de parede no lado norte de uma
  parede sobe um pouco acima do topo dela vista de longe (é mais alta que a parede na arte); o anel de pedras / o prato
  são círculos de verdade (a arte os desenhava achatados). (Quem senta atrás do encosto: resolvido pela profundidade
  por pixel.) A mancha de terra pintada em volta do barril some ao
  girar (fica fora do sólido). Um ponto de `fx` não acompanha o achatamento perto de 0° (≤ 1 px). Faces não recebem
  rachaduras de dano.
- **Móveis em pé** (os do `props.js`: peças de 1 tile, armações vistas de ponta): 4 vistas, trocam de vista a 45° como os
  personagens; poste de lampião e estandarte não têm vista de lado (em 0° também giram só pelo espelho do mundo).
  Barracas dos bandidos continuam em pé de frente para a tela.
- Faces de móveis não recebem a sombra do sol / o piscar de dano (como as paredes); o andaime de obra continua sprite.
- Desmontar com um toque pega o tile do chão sob o dedo (como em 0°); o giro de uma peça (R / ⟳) continua em
  direções do mundo (a seta no chão mostra para onde).
