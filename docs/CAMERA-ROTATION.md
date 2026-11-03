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
  - Quem **dorme** (pose sleep): deitado onde é desenhado (cada parte na altura dela: colchão, travesseiro, chão), viés
    0,4. Quem **senta**: cartão pelo
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
  - **Cercas:** poste no meio (caixinha com a arte do poste; o topo é a ponta da tora vista de cima, `art/caps.js`) e,
    para cada vizinho, um braço — as varas / estacas /
    tábuas / trançado do estilo como uma tábua fina com duas faces (os braços N-S usam a arte L-O girada), as pontas
    com o corte da arte (uma coluna esticada na espessura: as pontas das varas) e o topo de cada vara / tábua como uma
    tira fina — vista ao longo da linha, a cerca nunca some; trepadeira
    nas faces; capas, bola, ponta, passarinho, lanterna (com a chama) e flores ao pé como cartões virados para a
    câmera. **Sebes** e **muros de pedra:** bloco no meio + um braço grosso por vizinho, a frente da arte nos lados e
    o trecho visto de cima no topo (a sebe com o contorno ondulado da arte subindo nas bordas). **Portões:** dois postes altos e duas folhas (arte real de cada estilo) nas duas
    faces; aberto, as folhas giram nos gonzos; arco com flores atravessando a linha do portão; plaquinha na frente.
    Sombras pelas silhuetas da própria arte (modo mundo).
  - **Colunas** (`column_wood` / `column_stone`): peças sólidas (`art/faces/solidGarden.js`): sapata, fuste redondo e
    capitel no meio do tile (o tipo de face `column` de `structures.js` fica só de reserva).
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
- **Peças 3/4: pintura nova, não sprite esticado** (`art/look/turn.js`). Pedido do dono: a diagonal parecia "um
  sprite esticado"; agora cada peça é **repintada** em 3/4. Cada camada da peça é pintada pela própria pintura dela na
  vista de frente (ou de costas, para 'ne') **e** na vista de lado, crua (antes do contorno, em 2×). As duas pinturas
  vão para um boneco 3D simples da peça: em cada linha uma elipse com a largura da pintura de frente e a profundidade
  da de lado. O boneco gira 45° (42°: o rosto fica legível) e a câmera o vê: as superfícies viradas para a frente
  pegam a pintura de frente, as viradas para o lado pegam a de lado, numa faixa de mistura na normal de
  45° (larga: ±18°, para um detalhe que só uma das pinturas tem — uma bainha, um cinto em outra altura — sumir aos
  poucos na virada em vez de terminar numa costura). Depois a camada ganha o **contorno de novo** (mesma largura e cor da
  original: o mesmo traço). Resultado: a
  silhueta muda de verdade (tronco mais estreito com o lado aparecendo, queixo e rosto virados, nuca e cabelo de trás
  do lado de perto), nada fica "deslizado" dentro de um contorno fixo. 'sw' / 'nw' = espelho.
  - **Tronco** (`body`): boneco = o corpo nu (`lk_skin`) ∪ o contorno da peça (saias, armaduras). O **braço de perto**
    (o direito: na frente fica à esquerda da tela, nas costas à direita) sai da pintura de frente / costas e o tronco
    continua por baixo dele (espelho do tronco ao lado, sem copiar a dobra do braço); quem traz o braço de perto é a
    pintura de lado (o braço dela cai sobre o lado do tronco, onde ele fica na 3/4). O braço de longe dobra junto com
    o tronco na borda de lá (atrás do peito). Ombros ficam com o tronco (o braço começa na axila).
  - **Cabeça** (`head`): boneco = a cabeça redonda nua. **Rosto** (`decal`: olhos, íris, pálpebras, nariz, boca,
    sobrancelhas, bochechas, marcas, cicatrizes, pintura, rugas, máscaras antigas, rosto do Andarilho): só a pintura de
    frente, deitada na cabeça girada (as duas pinturas não concordam onde o olho fica em 3D: misturar dobrava o olho).
    **Orelha** (`ears`): só a de lado (a orelha de perto). **Avental** (`panel`): só a frente (de lado ele é uma borda).
    **Nariz** (`nose`): a pintura de frente deitada no rosto como as outras marcas e, por baixo, o **perfil** do nariz (a
    pintura de lado, o que passa da linha do rosto) posto no meio do rosto com a profundidade esticada para a ponta
    passar um pouco do contorno da bochecha no lado virado (mais num nariz comprido que num arrebitado); dentro do rosto
    só fica a pintura de frente (o traço do dorso de lado virava um risco na bochecha).
  - **Cabelo, barba, chapéus, capacetes, capuz, bandana** (`hair`): boneco = o contorno da própria peça (linhas vazias
    de uma vista pegam a linha mais próxima da mesma pintura; volume arredondado), e o que fica **atrás da cabeça ou do
    tronco** no raio da câmera não é desenhado (a mecha do lado de lá do rosto, o rabo de cavalo atrás da nuca);
    ilhas pequenas que sobram somem. O volume vem só das camadas com contorno (a penugem rala da lateral raspada fica na
    cabeça nua). **Moicano**: a crista é o perfil de lado em volta toda (sem misturar com a frente) e fica em pé sobre a
    cabeça (não é escondida por ela). **Cabelos muito irregulares** (black power, cachos, dreads, juba, twists, puff): o
    contorno virado é suavizado (abertura + fechamento de 2 px: sem pontas soltas nem entalhes entre os cachos; os cachos
    maiores ficam). **Barba vista de trás** ('ne'): não há pintura de costas — a de frente dá o volume, a de lado os
    pixels, e a cabeça / o tronco escondem o resto: aparece a borda da barba na mandíbula de perto (só a face de perto,
    não as costas da barba no pescoço).
  - **Capas** (poncho, xale: `cape`): no tronco, sem separar braço. **Botas** (`foot`): a bota girada (a ponta na
    diagonal), usada pelos pés andando e sentado.
  - Fontes: as peças do visual (`look/index.js`) e as pinturas registradas em `art/lazyDefs.js` `PAINT_DEFS`
    (armaduras `wear_*`, bandana, máscaras antigas, armadura / gelo / rosto do Andarilho).
  Pintadas sob demanda na textura preguiçosa do visual (`look/lazy.js`), só quando uma câmera girada mostra aquela
  vista; até ficarem prontas desenha-se o lado mais perto (sem buraco). O jogador local: assim que a câmera gira, as
  duas 3/4 dele (se, ne) entram na fila em segundo plano; se for preciso antes, pinta no máximo 12 ms por quadro.
  Custo por peça (2×, uma vez): 1–2 ms (rosto, orelha), ~2–4 ms (tronco, roupas, cabeça), ~3–6 ms (cabelo), contra
  4–8 ms do deslizamento antigo.
- **Mãos e itens na 3/4:** posições como antes (frente / costas misturada com a de lado), e agora **atrás do corpo**
  quando a profundidade deles (de lado da pose de frente / costas e para a frente da de lado) fica atrás: a mão de
  longe some atrás do tronco (aparece na borda, onde a arte dobra o braço de lá), escudo / tocha no braço de lá idem.
- **Pose 3/4** (`art/compose.js`): a pose do boneco virou uma função (`rigPose`) que calcula tudo de uma vista (corpo,
  cabeça, pés, mãos, item na mão / na outra mão, quem fica atrás do corpo). Na diagonal roda a da frente / costas e a
  de lado e mistura (`blendPose`): deslocamentos de lado ficam quase inteiros (a arte 3/4 também), os para a frente
  (o x da vista de lado, a profundidade da de frente) vão na diagonal, alturas na média, itens na mão giram pelo vetor
  de direção (encurtam quando apontam para a câmera), ordem de desenho da vista de frente / costas. Pés: a bota 3/4
  (ponta na diagonal), passada na diagonal. Rastro dos golpes misturado igual. Andar, atacar, habilidades,
  bloquear, arco, lança, ferramentas, comer / curar, nadar, escadas, pescar: tudo pela mesma pose. **Sentado no chão**
  também (a pose 3/4 de sentado, como na cadeira). **Rodopio**: passa pelas 8 vistas (2 voltas, 3/4 nas diagonais
  quando as peças já estão pintadas; até lá o lado de antes), em qualquer giro da câmera, 0° também.
  **Pescar** (`rodPhase` / `rodAim`): a vara tem um ângulo de verdade (da vertical para a água, um pouco para o lado da
  mão) projetado para a vista desenhada — de frente curta e para cima, de lado inclinada, de costas longa — e a outra
  mão vai na vara; a linha sai da ponta desenhada (`_rodTip`). Arremesso, espera, mordida e puxão: docs/LIVESTOCK.md.
  Cabeça virada para algo: num corpo 3/4 só para os dois lados da diagonal (a cabeça de lado / frente / costas).
- **A pose em volta da criatura** (`viewB` / `viewPt`): o rig monta as partes com deslocamentos de tela em volta do
  corpo; com a câmera girada um adaptador do lote vira esses deslocamentos em deslocamentos do mundo em volta do ponto
  no chão (antes as mãos / pés / cabeça descolavam do corpo girado). Vale para pessoas, bichos, mortos e corpos no chão
  (`art/corpseDraw.js`): um corpo deitado fica deitado de lado na tela, sangue / manchas / moscas juntos.
- **Bichos: quadros 3/4 próprios** (`art/beast34.js`, especificação de cada espécie em `art/animals.js` /
  `art/creatures.js`): lobo, raposa, cervo e corça, javali, urso, coelho, aranha — parado e os 4 passos (coelho: 3),
  'se' e 'ne' (sw / nw espelho). Feitos das pinturas da própria espécie, não do sprite de lado: o corpo da pintura de
  lado fica na **diagonal do chão** (a frente mais baixa vindo para a câmera, mais alta indo embora: a profundidade
  tão curta quanto a arte de frente / costas a desenha, ×0,22) e é **varrido pela largura do corpo** (cópias a cada
  ~1 px do flanco de lá, mais escuro e menor — costas e peito / anca arredondados — ao de perto, que é a pintura como
  ela é); pernas de lá no lado de lá (mais para cima e para o lado), pernas de perto na frente; cauda uma só, no
  meio; **cabeça** vindo para a câmera girada como as peças do boneco (cabeça de frente + de lado num boneco girado:
  os dois olhos, focinho na diagonal, a orelha de perto; galhada do cervo inclinada linha a linha como a de lado),
  indo embora a cabeça de lado varrida (nuca, orelha e bochecha de perto; o pescoço longo do cervo por cima). Cada
  parte com o próprio contorno. Pintados sob demanda na textura preguiçosa (`<espécie>_se`, `_se_walk`, `_se_w1..w3`,
  `_ne…`); corpo / cauda / cabeça são pintados uma vez para todos os quadros da espécie (os quadros irmãos são pedidos
  juntos), ~10 ms por quadro. Até ficarem prontos: o lado encurtado de antes. Bote e passadas na diagonal como antes;
  morto: de lado no chão (como antes). O ajudante `beast34(spec, view)` é genérico (outros bichos podem usar).
  - **Orelhas pontudas** (raposa, lobo, coelho: `head.ears`): as linhas acima do topo do crânio são inclinadas como a
    galhada (a pintura de frente estreitada e posta na profundidade da de lado, linha a linha), não deitadas no boneco
    (que borrava as duas orelhas num caroço mole); indo embora ('ne') vêm da pintura de costas por cima da nuca varrida
    (que é cortada acima do crânio: a orelha de lado não vira um bloco).
  - **Costas redondas** (urso, javali: `hump`): na varredura a espinha fica acima dos flancos (as cópias do meio sobem
    `hump` px numa curva) e as cópias de dentro são a pintura suavizada (borrão + puxada para a cor média) com 6 tons do
    claro na espinha ao escuro no flanco de lá — vistas de trás, as costas são um volume redondo em vez de uma laje com
    listras repetidas.
  - **Pastar / farejar** (`<espécie>_se_graze`, `_ne_graze`; lobo, raposa, cervo, javali, urso): a mesma dobra do quadro
    de lado (`GRAZE`: pescoço e cabeça girados em volta da cernelha) aplicada nas camadas de lado antes da varredura; a
    cabeça virada vai para onde o pescoço a leva (o giro do plano do lado visto na caixa 3/4) mas só rola uma parte (uma
    cabeça de frente abaixando não gira no plano: as orelhas ficam para os lados).
  - **Olhar em volta** (`_se_look`, `_ne_look`): a cabeça virada para a câmera — vindo, quase de frente (8°); indo, o rosto
    meio virado (66°) por cima do corpo. Os dois entram no lugar do quadro de pé nas mesmas horas do lado.
- **Bichos da criação** (vaca, ovelha, porco, galinha e os filhotes; docs/LIVESTOCK.md): não usam o `beast34` — são
  um **modelo 3D** de elipsoides (`art/livestock.js`) pintado por traçado de raios em cada vista (e, se, s, ne, n),
  então as diagonais são vistas de verdade do mesmo bicho (as manchas da vaca no mesmo lugar em todas). Só os três
  lados de pé dos adultos ficam no atlas; diagonais, passos, pastar e filhotes vêm sob demanda da textura preguiçosa
  (`art/livestockDraw.js`: até ficarem prontos, o quadro pintado mais perto). Também em 0°: um bicho andando na
  diagonal aparece na vista 3/4 (`viewFacing8` com giro 0).
- **Na cama:** deitado **ao longo da cama** como a tela a mostra (ângulo da cama − giro, uma vez só: antes o giro era
  descontado duas vezes — a 45° o corpo ficava torto e a 180° de cabeça para baixo fora da cama), a cabeça no
  travesseiro do modelo (`restAt` da cama sólida: o ponto do travesseiro na altura do colchão; o pescoço 0,17 para os pés,
  a cabeça vai para a cabeceira), o corpo sob o cobertor. A profundidade fica logo na frente da cama / cadeira em
  qualquer giro (`_sobj`); a cabeceira vista do lado da cabeça é desenhada depois (abaixo, `cover`). Dormindo no chão e
  o Zzz: na tela.
- **Sentado numa cadeira:** virado para onde a cadeira está virada no mundo (`facing.js`: sentado, o ângulo é o da
  cadeira, não o do alvo / movimento) e com as **8 vistas**: a pose 3/4 de sentado (frente / costas misturada com a de
  lado, coxas e botas encurtadas na diagonal: `rigFeet` 'd'); de trás vê-se as costas contra o encosto, de lado o
  perfil. O corpo no assento do modelo (`seatAt`: o ponto do assento, o traseiro na altura dele — `PELVIS` medido na
  cadeira de madeira).
- **Projéteis** (`game/projectiles.js`): flechas / lanças apontam pelo voo na tela (movimento no mundo girado − subida),
  inclusive as cravadas; sombra do arremesso na direção da tela; ordem por profundidade girada (`zkRot`).
- **Luzes e efeitos:** luz do jogador, do Andarilho, da caverna e dos vaga-lumes sobem reto na tela; anel do alvo
  sob os pés no andar de cima; números de dano sobem reto (overlay); traços da mira e do alcance, rastros de golpe /
  investida / rodopio (`wrot`: ângulo no chão − giro).
- **Bichinhos do ambiente** (`fx/wildlife.js` `_face`): cada um olha para onde anda **na tela** — o rumo no chão (do
  próprio movimento; virar no lugar = leste / oeste do mundo) menos o giro da câmera; os pequenos (pássaros, sapos,
  esquilos, patos) viram para a esquerda / direita (andando reto para cima / baixo da tela mantêm o lado), os coelhos
  nas 8 vistas (lado, frente, costas e os quadros 3/4 do coelho, pintados sob demanda; até lá o lado). Em 0° também.
- **Em 0°**: o boneco é pixel a pixel o de antes (comparado contra o commit anterior nas 4 vistas, andando, atacando,
  escudo, tocha, arco, morto).


## Peças sólidas (`art/faces/solid.js`): móveis como as paredes

Pedido do dono: **todas** as estruturas (baú, luzes, cama, mesa, cadeira, lareira…) são objetos 3D de verdade, parados
no mundo enquanto a câmera gira, como as paredes; só vegetação e criaturas (jogador, NPCs, bichos) continuam sprites em
pé. O kit `art/faces/solid.js` faz isso a partir da **arte da própria peça**; cada tipo é só uma entrada de tabela
(`defineSolid(tipo, spec)`, em `art/faces/solidTypes.js` e nas tabelas por área: `solidLights.js` = luzes, fogo e
estações, `solidFurniture.js` = móveis e decoração de dentro, `solidGarden.js` = jardim, exterior, colunas e o
acampamento dos bandidos). Tipo na tabela sai do `props.js` (o tipo de face `solid` tem `prio: 1`); tipo fora da tabela
continua como antes (em pé de frente para a tela / arte dobrada). Depois o dono pediu **nada de cara de sprite em 0°**:
o 3D vale em todos os ângulos, 0° também (outro trabalho liga as faces em 0°); o kit não achata mais perto de 0° (a
profundidade de verdade sempre; `k` só diz como a arte desenha a profundidade). Prontos: **baú** (refeito como caixa com
arte própria, aberto também), **barril**, **mesa**, **cadeira**, **cama**, **pilha de caixotes**, os móveis de
`solidFurniture.js` e o jardim de `solidGarden.js` (abaixo) e, em `solidLights.js`: **fogueira**, **braseiro**, **caldeirão**,
**fornalha**, **bigorna**, **bancada**, **mesa de cantaria**, **tear**, **lareira**, **velas**, **candelabro**,
**lanterna de pedra**, **poste de lanterna**, **poste com lanterna** e a **tocha** — de chão e **de parede** (as quatro
paredes).

### Como funciona

- **Textura projetiva, como nas paredes:** um ponto (x, y, h) da peça pega o texel onde a arte daquela vista mostra
  esse ponto (em 0°: coluna = 64·x, linha = 64·y − 64·h a partir da âncora do sprite). A vista que a câmera vê em 0° (a
  do lado para onde a peça está virada) texturiza o modelo: topos, a frente e o quarto da frente de uma peça redonda —
  então na vista exata a frente é a arte. Cada outro lado
  pega a arte da vista que olha para ele (`<tipo>_n` / `_back`, `<tipo>_e` / `_side`, oeste = leste espelhado), **ajustada
  parte por parte** (os pintores nem sempre desenham a peça no mesmo lugar / tamanho em cada vista: cada vista pode
  listar as mesmas partes nos números da própria arte). Texel transparente = buraco (pernas, vãos e contornos saem da
  arte numa caixa simples).
- **Contorno:** o contorno escuro da arte (2,6 px) faz parte do sólido: cada parte cresce por ele dos lados, atrás do
  topo e abaixo do chão (senão em 0°+ε a peça perdia o contorno).
- **Arte achatada (`k`):** arte antiga desenha a profundidade mais curta do que é (a elipse do topo do barril). `k` =
  profundidade na arte / profundidade de verdade, `piv` = a linha em volta da qual achata (0 = a âncora = a frente do
  corpo; uma peça redonda: o eixo). O modelo tem a profundidade de verdade em qualquer ângulo, 0° também (a arte
  esticada sobre ela; `ramp: false` das luzes virou o padrão). Peça redonda pode usar `k1 = k`: achatada ao longo da
  vista em qualquer ângulo, o que numa peça redonda é igual de todos os lados (barril, banquinho, mesa redonda, vasos,
  potes, sacos: a cara da arte).
- **Arte própria das faces (`uv`):** uma textura pintada com cada face nas proporções de verdade (o baú: `CHEST_UV` em
  `art/buildings.js chestUV` — frente, costas, lados, topo, tampa, dentro e o conteúdo); cada face de uma parte pega o
  retângulo dela (`uv: { s, n, e, w, t, i, q }`), sem projeção.
- **No lugar do corpo (centrado na grade):** a arte nem sempre desenha a peça onde o corpo dela está (a cadeira 0,2 tile
  atrás da frente, a fornalha / bigorna / fogueira quase meio tile para a frente — o dono: "estruturas de produção não
  estão centralizadas na grid"); **toda peça** é posta no corpo, em qualquer rotação e ângulo: `align: 'center'` é o
  padrão (a caixa do modelo no meio dos tiles), um número põe o eixo de uma peça redonda no centro (a linha da arte do
  cúpula / cepo / anel), `'back'` encosta na borda de trás (estantes, cômoda, guarda-roupa, suporte de armas: encostado
  numa parede ele chega nela sem atravessar). A sombra de contato padrão de uma peça de tiles vai para o meio da pegada.
  Conferir: `game.debugK.solidProbe()` (caixa do modelo × pegada de cada peça pronta, por tipo e rotação). `geo` dá o
  tamanho de verdade de uma parte que a arte desenha mais curta (a cama enche os dois tiles: a cabeceira na borda,
  encostada na parede; a arte esticada junto).
- **Sem amostrar vizinhos do atlas:** cada face é recortada (no carregamento do modelo, na CPU) no retângulo da imagem
  do sprite: nenhuma mudança de shader, nenhum custo por quadro.
- **Luz e estado:** lados com a luz das paredes (`kit.shade`), topo sem sombreado, lados de dentro (`open`) mais
  escuros; planta / fantasma / obra / desaparecer (`props.tintOf`), andaime da obra (sprite), tremor do golpe (para o
  lado da tela), **piscar de golpe** (`o.flash`) e o clarear das plantas (0,14, como o sprite) — o alfa da face leva o
  flash (`encA`: 2 + 2·nível + 0,25 + alfa/2, 16 níveis, decodificado no `FACE_FS`), **rachaduras** de dano (`o.hp` /
  `maxHp` como `overlays`, e as de cerco do `fx/rockfx.js`) nas faces que aparecem (`solidCracks`), sombra de contato
  do pintor (presa ao mundo), a **mancha de terra** que o pintor desenha em volta do pé (`decal`: `decal_dirt` no chão,
  achatada ao longo da vista como a peça — antes sumia ao girar), sombra do sol (caixas: `kit.shadowRect`; peças
  redondas: a silhueta da arte atravessada ao sol).
- **Ordem:** as partes da peça de trás para frente (pelo centro; `z` corrige), e dentro de uma parte: lados de dentro,
  lados, topo. A peça entra na ordem geral pelo ponto mais à frente do modelo (achatado como ele); num andar de cima
  nunca antes do piso do próprio tile (`floorUp`).
- **Chamas, brilhos, luz:** `fx` põe a chama / brilho do pintor no ponto 3D (a chama continua de frente para a tela,
  como partícula, mas presa ao pavio); `light` é onde a poça de luz, o halo e a fumaça de `fx/ambient.js` saem
  (`lightAt`). Quem **senta** senta no assento do modelo (`seat`, `art/compose.js` pergunta `seatAt`); quem **dorme**
  deita com a cabeça no travesseiro (`rest`, `restAt`). As partes `cover` (encosto, cabeceira) mais perto da câmera que
  o assento / o corpo vão para um desenhável próprio (`solidFront`, empurrado por `game.js` logo depois da peça) que é
  desenhado depois de quem senta / dorme: de trás, o encosto fica na frente das costas.
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

Por parte: `sh: false` (sem sombra do sol), `z` (ajuste da ordem), `top: 'strip' | 'none' | 'open'` (+ `band`), `cap`
(a **arte de cima**, `art/caps.js capArt(tipo, cor, redondo)`: o topo de uma caixa, a tampa de um torno e os anéis de uma
cúpula com menos de 45° pegam uma arte pintada vista de cima — pedras, laje, ponta de tora, tábuas, ferro —, sem esticar
a borda de cima da arte de frente), `wind: [a, h]` (balança ao vento: um cisalhamento ao longo da tela, `a`·sen(t) tiles
por tile de altura a partir de `h` px; só cosmético), `geo`,
`uv`, `cover`, `solo` (todos os lados da própria arte: tábua, espelho, quadro), `sx` (torno esticado no x do modelo: tina
oval — numa vista de lado o esticão vai na profundidade da arte), `ow` (o contorno da própria parte: pernas, corrente,
ripas finas 0–1), `px` (a parte com a cor de um ponto da arte: `[x, v, h]` em todas as faces, ou **por face**
`{ s, n, e, w, t }` — frente, costas, +x, −x, topo / tampa; as outras faces com a arte de sempre: a frente da bigorna é a
arte, o topo e as pontas na cor do ferro; `[x, v, h, 'sprite']` pega a cor de **outro sprite assado**, linha de âncora 1:
o ferro e a tocha de uma arandela).
Por tipo: `k`, `k1`, `piv`,
`V`, `ow` (contorno), `foot: true` (peças de decoração encostáveis: a arte é desenhada mais baixa pelo pé,
`archCompose.footOf`), `views: { n | e: { parts, k, piv, V, seat… } }` (a mesma lista de partes nos números da arte
daquela vista), `borrow: { n: 'mirror', e: 'front' | 'edge' }` (vista sem arte: o verso espelha a frente; o lado mostra a
frente como se fosse a frente — bom para peças redondas / simétricas — ou `'edge'`, as colunas da borda da frente
esticadas no lado — caixas compridas), `when(o)` (false = fica com o `props.js`), `state(o)` + `variants` (outra arte
para um estado; `only: true` = os outros lados emprestam dela), `fx: [{ at: [x, v, h], draw(B, A, o, t, x, y, lift,
a, fs) }]` (`always`: também na planta / fantasma), `light: [x, v, h]`, `seat: [x, v, h]`, `rest: [x, v, h]`,
`blob: false | [sx, sy, dy, a]` (sem `blob`: peça de borda com a sombra do pintor na frente, as outras com a sombra no
meio da pegada), `decal: [x, v, rx, ry, a]`, `align` (padrão `'center'`: **toda peça centrada nos próprios tiles**, a
caixa do modelo; um número = a linha da arte do eixo de uma peça redonda posta no centro — cúpula, cepo, anel de pedras;
`'back'` = encostada na borda de trás; `false` = onde a arte desenha), `variant(st)` (a variante que a tabela monta para
um estado que ela calcula: o visual e os detalhes de uma coluna), `fixed` (desenhada virada para o sul seja qual
for a frente: o estandarte, como em 0°), `scale` + `hang(o)` (arte em escala e o modelo àquela altura: coisa de parede
solta), `pt` (a parte cujo encaixe põe os pontos), `uvS` (o sprite das faces `uv`).

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
- **Fornalha:** cúpula de pedra **no meio do tile** (`align` no eixo: antes ficava 0,4 tile para a frente, metade fora
  da pegada), o alto da cúpula visto de cima com pedras de verdade (`cap` 'stone': antes a borda de cima da arte esticada)
  (a boca e as juntas acesas como **brilho sobre a face**, só quando trabalha), chaminé saindo de trás da
  cúpula (a boca de fuligem na cor dela), atiçador encostado na cúpula e fole no pé (cores próprias: de trás não ficam
  vazados); a chama da boca só aparece de frente. **Vista de trás pintada** (`furnace_back`, preguiçosa) também nos
  **lados** (`e: 'furnace_back'`): antes os lados mostravam uma segunda boca.
- **Bigorna:** do tamanho de uma bigorna de verdade no tile (`anvil_big`: a mesma pintura 1,55× maior em volta do pé; o
  `anvil` assado continua sendo o ícone e a cor de ferro que outras peças amostram); cepo redondo **no meio do tile**
  (o topo do cepo com os anéis da madeira, `cap`) e, **sobre** o cepo (a arte a desenha 3 px acima: `geo`), o ferro em
  blocos com a profundidade de verdade: pé, cintura, mesa com o calcanhar e o **chifre afinando em três degraus**; a frente
  é a arte, topos e pontas na cor do ferro (`px` por face); o martelo (cabo e cabeça) deitado na mesa.
- **Caldeirão:** no meio do tile; **tripé de verdade**: as três pernas (cor da madeira, finas) saem de um círculo fora das
  pedras e se encontram bem em cima do caldeirão (a arte desenha o ápice atrás), amarração no ápice, corrente reta; o
  caldeirão começa onde a arte o desenha (antes o fundo pegava o fogo e as pernas), a boca cheia do ensopado; cada pedra
  do anel numa cor de pedra (antes as de trás pegavam o caldeirão). Visto de trás: `cooking_pot_back` (a concha do outro
  lado, o monte de cinza sem as pedras da frente pintadas, a luz ainda da esquerda).
- **Fogueira:** o anel cabe no tile (raio 22: a arte é mais larga que um tile e o anel ficava meio tile para a frente),
  centrado; cada pedra na cor da sua pedra na arte. **Braseiro:** centrado, pernas finas na cor do ferro.
- **Bancada / cantaria / tear** (2×1, `model: 'front'`: a mesma peça virada para qualquer lado; a arte `_n` / `_e` só
  pinta): bancada vazada com o painel de ferramentas atrás; mesa de pedra com o bloco sendo lavrado, **três** blocos
  prontos (dois lado a lado e um em cima, como a arte) e duas pedras redondas no chão **dentro** da pegada; tear com o
  quadro **de madeira de verdade** (dois montantes quadrados em **pés compridos** — de lado é um T em pé, não um pau —,
  viga de cima, rolo do pano e a urdidura com o pano entre eles; pontas e topos na cor da madeira: a arte `_e` desenha o
  quadro torto, só o banco e o cesto pegam dela), o banco do tecelão e o cesto de algodão. Centradas pela caixa.
- **Lareira:** **uma lareira de pedra só, ocupando a pegada inteira** (2×1: `k` 0,5 leva a profundidade da arte até a
  parede de trás e a borda da frente), a mesma de todos os lados (`model: 'front'`; a arte de lado / de trás só pinta):
  o peito da chaminé subindo pela parede, a lareira com uma **boca de verdade** (dois batentes, a verga, a parede do
  fundo — o fogo queima dentro, visto só de frente), a prateleira do consolo saindo para a frente e as duas velas.
- **Velas / candelabro** (peças de borda, `foot`): prato com três velas / tripé, haste, braços e cinco velas nos
  copinhos, cada chama no pavio. **Lanterna de pedra:** base, fuste, colar, a cabeça com uma janela acesa **em cada
  lado** (brilho sobre as faces) e a chama dentro, telhadinho (visto de cima: laje de pedra, `cap`; a base e o colar
  também). **Postes** (de madeira e com lanterna): base, poste, braço e a lanterna redonda pendurada — o vidro aceso em
  volta toda (brilho sobre as faces) e o halo nela; vistos de cima: a sapata de pedra, a ponta do poste com os anéis da
  madeira, o braço de tábua e o chapéu de ferro da lanterna (`cap`).
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

### Jardim, exterior e acampamentos (`art/faces/solidGarden.js`)

Profundidade de verdade em qualquer ângulo, 0° também, e ocupando a pegada; arte que desenha
coisas redondas achatadas (elipses) mapeia a textura com `k`, e `piv` põe o centro de verdade onde ele deve ficar
(`piv = (d_arte − k·d_real) / (1 − k)`); uma parte movida em profundidade leva as alturas junto (64 px por tile) para
continuar com a arte dela; superfícies que a arte nunca mostra (águas de telhadinho, o topo de um cepo) são cheias com
um texel da arte (`px`).

- **Bancos** (madeira: caixa vazada; pedra: laje sobre dois blocos), **floreira** (caixa + a massa de flores em cima),
  **lenha** (pilha, cepo com o cabo do machado), **carroça** (caixa, sacos, estacas, rodas dos dois lados — as de trás
  pegam a arte das da frente vista de trás, `views.n` — e os varais inclinados), **varal** (dois cavaletes em A, a vara,
  couros e ervas pendurados: estrutura aberta de verdade).
- **Chafariz** (2×2): tanque redondo de verdade no meio da pegada, a água, o pedestal, a bacia com a água dela, a bica;
  gotas saindo da bacia e caindo no tanque e o anel na água, em espaço do mundo. **Poço:** anel de pedra, a água escura,
  postes, sarilho com a manivela, corda e balde, telhadinho de duas águas (as águas em `px`, as empenas com a arte).
- **Estátua** (pedestal quadrado de verdade — os topos em laje vista de cima — e a figura, guerreiro ou coruja, em duas
  tábuas cruzadas: de frente a arte, **de costas a arte das costas** — `statue_<v>_back`: as asas e a cauda da coruja, sem
  os olhos; o escudo do guerreiro pelo lado de dentro — e a tábua de través com o **perfil**, `statue_<v>_side`),
  **totem** (tronco com o chapéu e as asas como tábuas), **colmeia** (banquinho e a colmeia de palha; abelhas
  voando em volta, no mundo), **monte de feno** (com os dentes do forcado), **espantalho** (poste, camisa na travessa,
  cabeça — as costas e os lados da cabeça só de estopa, sem rosto —, chapéu de aba de verdade; balança ao vento: `tilt`), **casinha de passarinho** (poste sob a casa, a casa,
  telhado de duas águas com as empenas), **quadro de avisos** (postes, quadro, telhado como a vista de lado o desenha:
  cumeeira ao longo do quadro, empenas nas pontas), **placa** (poste e as duas setas como tábuas; a ponta do poste vista
  de cima, `cap`).
- **Arco de jardim:** um caramanchão de verdade, centrado no tile: dois postes de cada lado (frente e trás: `geo` com a
  arte dos postes nos dois planos) ligados por uma treliça (os lados com a borda dos postes esticada: as trepadeiras —
  `borrow: { e: 'edge' }`), o arco com as rosas nos dois planos (a guirlanda balança um pouco ao vento, `wind`) e ripas
  por cima acompanhando a curva — de lado não é mais um risco. **Pérgola** (quatro postes, duas vigas, as ripas e folhas
  deitadas em cima, que mexem com o vento): postes e vigas de verdade; a sombra do sol é a silhueta da arte (uma parte só
  de sombra, `SHADOW`). **Varal:** os couros e as ervas pendurados balançam ao vento em volta da vara (`wind` com o pivô
  na vara).
- **Floreira:** a caixa com a terra (`planter_base` / `planter_base_e`: a arte sem as flores) e as flores como
  **vegetação em pé** (`planter_plants`: hastes, folhas e flores numa linha de base) em quatro fatias, cada uma no seu
  trecho da caixa, no lado comprido mais perto da câmera: vista de ponta vira uma fileira de moitas (antes uma massa
  lisa na caixa).
- **Colunas** (o kit de colunas de `content/kits.js`, que antes não aparecia em ângulo nenhum): até o beiral (64 px, o
  topo das paredes: antes paravam 10 px abaixo do telhado), centradas; os quatro visuais — **poste de madeira**, **coluna
  de pedra**, **redonda** e **entalhada** (anéis no fuste, capitel em sino), as duas últimas no material do tipo com **arte
  própria** (`art/roofs.js columnTurned`, lazy `column_<redonda|entalhada>_<w|s>`: os mesmos perfis do modelo, fuste
  redondo com a luz da esquerda, molduras, caneluras na pedra e veio na madeira; antes usavam a arte do fuste do material)
  e os topos de sapata, base e capitel vistos de cima (`cap`) — e os
  detalhes: **capitel** (colar + ábaco; no poste, um segundo coxim em cruz), **base de pedra**, **estandarte** (o pano do
  estandarte pendurado na frente do fuste), **arandela** (placa e braço de ferro, tocha inclinada para fora com a chama;
  a luz é a luz do kit, `o.light`, saindo dali) e **hera** (a hera das paredes em volta do fuste); os **tons** do kit
  tingem as faces (`o._k.tint`, todas as peças sólidas com kit). `state` guarda a chave no objeto do kit decodificado
  (nada de texto por quadro), `variant` monta cada combinação uma vez.
- **Canteiro de flores:** o canteiro é sólido com a arte sem as flores (`flower_bed_base`, preguiçosa) e as flores
  (`flower_bed_plants_<v>`: as duas camadas da arte separadas, juntas são a arte inteira) são vegetação — um sprite em
  pé na borda do canteiro mais perto da câmera, subindo sobre ele em qualquer ângulo (também na planta / obra).
- **Boneco de treino:** pé em cruz, poste, tronco de palha, braços, cabeça; **balança quando apanha** (a mesma conta do
  `archCompose`: `o._wobT` / `_wobA` / `_wobD`) pelo `tilt` do kit.
- **Acampamento dos bandidos** (objetos do mundo, não construções: `world: [l, p]`): **barraca de lona** (cumeeira ao
  longo da profundidade, as duas águas inclinadas de verdade, a empena da frente com a entrada, a de trás na cor da
  lona), **tenda cônica** (cone com as varas saindo em leque no topo; atrás e dos lados `tent_1_back`: uma costura com
  cordão, sem uma segunda porta), **caixotes**; a **fogueira** do acampamento usa a
  fogueira 3D de `solidLights.js` (um objeto do mundo de um tipo de construção pega o tamanho da construção).
- **O kit ganhou** (genérico, em `solid.js`): `px` (parte cheia com um texel), `tilt` / `tiltAt` (partes que inclinam:
  golpe, vento), `fx` com `always` (desenhado também na planta / obra; o mesmo nome dos móveis), objetos do mundo (`world`; corpo ancorado no
  meio da frente `o.x, o.y`), `views.n` também para o verso emprestado (espelhado) e faces inclinadas: um `quad`
  inclinado tem o lado de fora para cima (vertical: para a vista de 0°); até 45° é um topo (visto de todo lado: a câmera
  olha de cima a 45°), mais íngreme é visto enquanto `v > −1` (normal × tan da inclinação).

### Defesa (`art/faces/solidDefense.js`): a balista

- Feita só de caixas e fitas com **arte própria das faces** (`uv`, `ballista_uv`, como o baú): a base (cruz de vigas,
  pés de ferro, prato giratório, poste) fica; o topo (garfo, coronha, quadro com as duas meadas de corda, braços
  recurvados, a corda puxada até a garra, o sarilho e a flecha no trilho) **gira em volta do poste** para a mira.
- **O kit ganhou** (genérico, em `solid.js`): partes `spin: true` giram num eixo vertical em `spinAt` [x, v, h] para o
  ângulo do mundo `spin(o, t)` (vértices, normais — visibilidade e luz — e a ordem das partes giram juntos; sem sombra do
  sol própria: a balista põe uma sombra suave sob os braços pelo `fx`); partes com `vis(o, t)` falso somem naquele quadro
  (depois do disparo: sem flecha no trilho, corda reta até recarregar).
- O ângulo desenhado é `o._aimD` (game/ballista.js: quem opera vê o próprio na hora; os outros, suavizado até o ângulo
  compartilhado `o.aim`).

### Andaime de obra em 3D (`art/faces/scaffold.js`)

Com a câmera girada o andaime (`scaffold_0`) de **qualquer** peça em construção (paredes, portas, cercas, portões,
colunas, móveis, estações, decoração, coisas de parede) é uma armação parada no mundo em volta da pegada: quatro
painéis com os postes, as duas travessas, a diagonal e a tábua de cima (a arte em ordem do mundo: visto por trás fica
espelhado); painéis vizinhos se cruzam no eixo de cada poste, então cada poste de canto é um poste de qualquer lado. A
**altura acompanha a peça** (a tábua de cima um pouco acima do topo do modelo da peça sólida; uma história para paredes /
portas; a altura da cerca): um baú ou um banco ganham um andaime baixo, não de dois tiles.
`game.js` chama `drawFacesTurned`: os painéis vistos por dentro antes da peça (fechando o segmento de faces: ficam
antes até dos sprites dela) e os outros depois; a barra de progresso continua de frente para a tela. Tirados: o sprite
de frente para a tela das peças sólidas / `props.js` (`XB` o descarta) e o andaime que era pintado nas faces das
paredes (a gravação o ignora). Custo: 4 quads por peça em obra, nada guardado.

### Móveis e decoração de dentro (`art/faces/solidFurniture.js`)

- **Cadeira estofada** (encosto `cover`, assento), **banquinho** (assento redondo achatado como a arte, três pés numa
  caixa vazada), **mesa redonda** (pé, tampo com a toalha caindo, vela), **mesinha** (caixa vazada + o vaso com a flor
  como caixa no plano da arte: um torno entortaria a arte chapada).
- **Estante** (painel de trás, três prateleiras, dois postes, as coisas de cada prateleira em pé onde a arte as põe;
  vistas de lado e de trás com os próprios números), **estante de livros** (painel, laterais, poste do meio, tampo, três
  prateleiras, os livros em pé, a vela; o pintor pintava o tampo da prateleira **por cima dos livros** — a estante era
  um armário liso; agora os livros aparecem), **cômoda** (gaveteiro, espelho em pé `solo`: o verso é a moldura, vela,
  a bacia pintada no tampo), **guarda-roupa** (uma caixa alta, vistas de lado e de trás). Todas encostadas no fundo
  (`align: 'back'`).
- **Suporte de armas** (a armação como tábua, as lanças encostadas numa face inclinada — pés para a frente —, a espada e
  o escudo pendurados), **suporte de armadura** (tábua do pé, poste, a armadura como caixa: a malha na frente, os ombros
  esticados no topo; o elmo), **tina** (torno oval `sx`, a água no aro).
- **Estandarte** (`fixed`: virado para o sul como em 0°): poste e travessa sólidos, o **pano** pendurado na travessa
  em quatro faixas formando um S raso de cada lado da travessa (dobras que respiram com o vento: visto de lado aparece
  em volta do poste, não some), balançando no plano como em 0° (desenhado a cada quadro: `bannerCloth`), sombra do pano
  como caixa fina.
- **Vasos** (`flower_pot`, `plant_pot`): o vaso é o sólido (redondo, achatado como a arte); a planta / as flores ficam
  **em pé como vegetação, presas no eixo do vaso** — `<tipo>_<v>_leaf` é a mesma pintura com o miolo do vaso recortado
  (o contorno fica), desenhada em pé no ponto do eixo (`fx` `always`): vaso + planta = o sprite inteiro em qualquer giro.
- **Potes** e **sacos**: tornos (um por pote / saco), achatados como a arte em qualquer ângulo, um só faz a sombra.
- **Coisas de parede soltas** (quadro, troféu, cortina, ervas, ganchos sem parede atrás — `o._mount` falso): uma tábua
  fina virada para a frente dela, na escala (0,66) e na altura em que ficaria na parede (`hang`). Na parede: as faces
  planas de `faces/structures.js` (`drawMountFaces`), presas à face da parede em qualquer giro (conferidas na casa).
- **Mesa:** a caneca e a **vela no castiçal com a chama acesa no pavio** em cima do tampo (antes sumiam: a arte os
  desenha atrás do tampo), cores próprias (`px` de `table_wood`), a mesma mesa virada para qualquer lado; o tampo vem de
  `table_wood_bare` / `_bare_e` (a arte sem a caneca e a vela: antes apareciam duas vezes de lado, pintadas e em 3D).
  **Cama:** a cabeceira é uma tábua de 10 px (o topo e as pontas na madeira dela: de quina não é mais um papel) e as
  **duas colunas com as bolas**, a mesma cama em qualquer giro
  (`model: 'front'`: a virada para o norte era 0,26 tile mais curta). **Tina:** virada de lado ficava atravessada na
  pegada (o `sx` da vista de lado esticava o eixo errado: corrigido no kit). **Cômoda:** o espelho é uma **moldura** de
  verdade — dois montantes e duas travessas de 7 px de fundo em volta do vidro, lados, topos e o verso na madeira da
  moldura (`px`), a frente da arte: de quina é uma moldura, não uma folha.
- **Baú** (`solidTypes.js`): corpo de 16 px e tampa de 9 px rentes na pegada inteira, faixas de ferro passando pela
  frente, tampa e costas nos mesmos x, fechadura só na frente, cantoneiras e alça nos lados; aberto (o jogador usando,
  qualquer frente): paredes de dentro escuras, o conteúdo no fundo, a tampa em pé na borda de trás. **Cama:** enche os
  dois tiles (`geo`; a cabeceira encostada na parede), a cabeceira `cover`, `rest` no travesseiro.
- **Desempenho** (vitrine `game.debugK.showcase()`, giro 0,7, `game.debug.bench(150)` sem cabeça): com estes tipos ou
  com o caminho antigo (`props.js`) a diferença fica no ruído (~2,4–3,1 ms de CPU de render dos dois jeitos); os nomes
  de sprite das plantas / do pano são guardados (nada de texto por quadro).

Conferir: `game.debugK.props(['tipo', …])` (vitrine: cada tipo em todas as rotações + uma planta), câmera 0°, 45°,
90°, 135°, 180°, 270°, noite (`game.debug.setTime(22)`), num andar de cima e **numa casa mobiliada** (peças encostadas
em cada parede, alguém sentado / dormindo); `solidEntry(o)` devolve o modelo guardado de uma peça.

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

## Trapiche e ponte (`art/faces/deck.js`): peças procedurais

Pedido do dono: construções na água "procedurais igual o telhado e com detalhes" — a ponte tem início, corpo e fim e o
visual 3D se conecta conforme o jogador empilha as peças; o trapiche na mesma lógica. Regras e jogabilidade:
docs/PLAN-V2.md "Trapiche e ponte".

- **Forma a partir dos vizinhos** (`game/decks.js`, refeita quando as estruturas mudam, `game.build.v`): cada peça ganha
  `o._dk` — trapiche: vizinhos de trapiche, lados de margem, o eixo que as tábuas cruzam, a ponta (o único lado
  conectado oposto à água aberta), as estacas dos 4 cantos (cada canto desenhado uma vez, pela primeira peça em volta
  dele: no contorno um toco sobre o deque, dentro de uma plataforma um canto sim outro não sob o deque, na ponta
  frades altos com corda enrolada, do lado da margem baixos), lados abertos; ponte: eixo, papel (cabeceira / corpo /
  ilha), alturas no começo / meio / fim da peça ao longo do eixo (o trecho atravessado de margem a margem arqueia:
  `0,3 + A·sen(π·u / L)`, A = min(0,15; 0,03·L)), vizinhos (nada / margem / água), cavalete (nas bordas internas: simétrico
  numa travessia completa, um tile sim outro não a partir da margem numa inacabada), poste no fim do trecho, rampa da
  cabeceira (sobe para a água; ilha = plana). Planejadas contam (o visual liga com a planta; o fantasma completa).
- **Geometria** (`deck.js`): quads com textura (atlas, 64 px por tile, `art/decks.js`: tábuas de deque em 3 variantes,
  madeira de lado, casca de estaca, pedra aparelhada, corda, neve), feitos com caixas, prismas de 6 lados (estacas),
  vigas entre dois pontos (corrimãos seguindo o arco), tábuas finas de dois lados (contraventamento em X, balaústres em
  zigue-zague) e faces livres (tampo do deque em dois segmentos, rampas, lados das rampas em trapézio, pedra da
  cabeceira). **Trapiche:** deque, testeira nos lados abertos, X por baixo, estacas com a faixa molhada mais escura na
  linha d'água, tábuas descendo até a margem sobre um tronco, escada até a água na ponta. **Ponte:** deque, testeiras,
  longarinas recuadas, postes em cada borda, corrimão + travessa do meio + balaústre em zigue-zague, cavalete (duas
  estacas, viga de topo, X), tábua de fim onde a ponte para; **cabeceira** de pedra com parapeitos, pilares na entrada
  e as tábuas subindo entre eles.
- **Cache:** a geometria de uma peça é feita uma vez por mudança (`o._dk.sig` + o atlas) em coordenadas do mundo
  (`o._dg`, 28 floats por quad); um quadro só descarta os lados virados para longe (`seen`), sombreia pelo sol
  (`shade`) e copia (`FaceBatch.quadF`, sem alocação). Fantasmas: a forma calculada com as peças já existentes +
  as do arraste (`ghostShapes`, guardada por chave), geometria refeita no rascunho (só no modo construção); um fantasma
  vermelho é desenhado como peça solta.
- **Obra:** cada quad tem uma etapa — estacas / pedra (≥ 0,25 do progresso), estrutura (vigas, testeiras, X ≥ 0,55),
  deque e guarda-corpos (≥ 0,85); o que falta fica na cor da planta. Sem o andaime genérico (`scaffold.js` pula a camada
  `deck`).
- **Clima / luz:** neve (`season.snow`) em manchas sobre os tampos (deque, corrimãos, parapeitos, pilares, topo dos
  postes) como uma camada translúcida; luz e noite pelo mapa de luz como tudo; sombra do sol do deque e dos
  guarda-corpos na água (`shadowRect`). Água congelada: as peças ficam sobre o gelo.
- **Quem está em cima:** pessoas e bichos no topo do deque (`e._dh` na altura do cartão e da profundidade), coisas
  pequenas construídas em cima (`o._dkh`: o kit sólido soma na base `H0`), itens no chão desenhados no topo, e **corpos**
  (`corpsesSystem.collect`: as camadas de chão do corpo vão para o lote ordenado, levantadas até o tampo e deitadas nele
  — modo de profundidade 1, um fio acima das tábuas; as moscas sobem junto; antes ficavam embaixo do deque).
- **Quem está embaixo:** quem entra numa peça de ponte sobre a água pelos lados com guarda-corpo, vindo da água / do
  gelo / da margem ao lado (`e._ud`, physics.js `deckTrack`), fica **embaixo** do deque: desenhado na água (`_dh` 0),
  nadando onde é fundo; os guarda-corpos não são parede lá, os cavaletes e as cabeceiras de pedra sim (`world.railU`).
- Conferir: `game.debug.deckScene()` + `deckAt('bridge' | 'pier' | 'bank', k)`; capturas em `shots/water_*.png`.
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
- Personagens 3/4: repintadas de frente + lado num boneco simples (não há uma terceira pintura feita à mão): onde as
  duas pinturas discordam a virada é uma transição larga (±18°), não uma costura — mas um detalhe em alturas diferentes
  nas duas vistas (um cinto) aparece como uma rampa curta; o perfil do nariz é só a ponta passando do contorno (o
  sombreado de frente fica no meio do rosto, como numa cabeça redonda); o moicano em 3/4 é a crista de lado estreitada
  (as pontas um pouco amassadas); a barba de trás é só a borda na mandíbula (um cavanhaque não aparece). Bichos 3/4: o
  cervo pastando indo embora ('ne') leva a orelha de lado varrida (um bloco); a crina do javali repete um pouco nas
  costas. Bichinhos do ambiente pequenos só têm lado (esquerda / direita na tela). Ferramenta de revisão:
  `tools/diag.html` (folha das 8 vistas pelo compose do jogo: `?set=people|gear|states|animals` — states tem sentado no
  chão, rodopio e as poses de pesca; animals tem pastar / farejar / olhar (`_idleU`) —, `?parts=lk_hair_long,…` mostra
  frente / 3/4 / lado / 3/4 costas / costas de cada peça).
- **Peças sólidas:** **todas as peças do menu de construir são 3D** (tabela de `art/faces/solid.js` ou os tipos de face
  das estruturas; pisos, tapetes, pedras de caminho, canteiros de horta e coisas de parede ficam planos no chão / na
  face da parede); o `props.js` só desenha uma peça sólida enquanto a arte dela ainda não foi pintada (alguns quadros).
  Lacunas: os topos com arte de cima (`cap`: cúpula da fornalha, postes, sapatas, capitéis, telhadinho da lanterna de
  pedra, postes de cerca) são pinturas genéricas por material e cor (pedras, laje, ponta de tora, tábuas, ferro), não
  um desenho próprio de cada peça; outras peças de arte chapada ainda têm o topo da borda de cima esticada onde ele quase
  não aparece (o topo do totem, a cabeça da lanterna de pedra sob o telhadinho, o banquinho da colmeia, o monte de
  feno); a crescente de `ow` atrás do topo é a linha de contorno dividida por `k` (em `k` 0,3 a base de uma coluna fica
  ~8 px mais funda atrás); a bigorna grande é a arte 1,55× (um pouco mais macia que as outras); o caldeirão visto de
  lado pega a frente; a estátua de lado é o perfil numa tábua só (a 45° as duas tábuas cruzadas — frente e perfil —
  ainda leem como duas figuras); as velas do consolo da lareira vistas de lado pegam a arte de lado; a fumaça de um fogo de baixo
  atravessa um piso de cima (como antes); o halo de `fx/ambient.js` continua por cima de tudo (como em 0°); uma tocha de
  parede no lado norte de uma parede sobe um pouco acima do topo dela vista de longe; o anel de pedras / o prato são
  círculos de verdade (a arte os desenhava achatados). Móveis: a arte de quem só tem a vista de frente é esticada na
  profundidade de verdade (a cama, a tina) e os lados sem arte emprestam a frente; o vidro do espelho da cômoda é a
  arte de frente (de trás, a madeira da moldura); coisas de parede soltas flutuam na altura da parede (como em 0°); a
  planta de um vaso é um cartão em pé (vegetação), não gira com o vaso; os potes / sacos / vasos ficam achatados ao
  longo da vista como a arte. Sentado: a pose 3/4 só aparece quando as peças 3/4 do visual já estão pintadas (até lá o
  lado mais perto); a altura do corpo no assento vem de uma medida (`PELVIS` 0,476) tirada da cadeira de madeira. O
  encosto / a cabeceira na frente continuam como desenhável à parte (inofensivo: a profundidade por pixel já decide).
  Um ponto de `fx` não acompanha o achatamento perto de 0° (≤ 1 px). Estante, cômoda e suporte de armas ficam
  encostados na borda de trás de propósito (`align: 'back'`: vão contra a parede).
- Faces de móveis não recebem a sombra do sol (como as paredes).
- **Jardim / acampamento:** peças sem vista de trás pintada mostram a frente espelhada atrás (o banco, o poço, a
  carroça: simétricas, sem rosto); arte "de frente" esticada sobre a profundidade de verdade (topos das caixas, o
  banquinho da colmeia) parece lisa; a empena da frente da barraca de lona corta o alto da entrada; o vento é um
  cisalhamento das partes leves (couros do varal, a guirlanda do arco, as folhas da pérgola), não um pano simulado.
- Desmontar com um toque pega o tile do chão sob o dedo (como em 0°); o giro de uma peça (R / ⟳) continua em
  direções do mundo (a seta no chão mostra para onde).
- **Trapiche / ponte:** a ponte é só reta (N-S / L-O; a diagonal fica para depois: ver docs/PLAN-V2.md "Trapiche e
  ponte"); a parte de baixo do deque nunca aparece (a câmera olha de cima a 45°); a neve é uma camada sobre os tampos
  (não acumula nos lados); quem passa por baixo da ponte a pé (gelo, água rasa) aparece com a cabeça acima do deque (a
  ponte é baixa: só quem nada cabe de verdade; o recorte em volta do jogador abre o deque na frente dele); um corpo
  sobre o deque fica deitado de lado na tela como no chão (pode passar do guarda-corpo).