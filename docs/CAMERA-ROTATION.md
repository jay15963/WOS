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
  - **Pintura:** no worker (`roofWorker.js`, modo 2 / 3), junto com a arte norte depois que a câmera girou uma vez
    (lembrado em `localStorage wos.roofTurn`: quem gira a câmera já recebe a arte pronta na próxima sessão); até lá,
    a mesma geometria em cores lisas por água. Quem nunca gira não paga nada.
  - **Luz / clima:** o telhado girado entra no mapa de luz como oclusor (`uRoofFx.w`: lâmpadas de dentro não clareiam
    o telhado), escurece com a chuva e recebe a neve só nas águas (não nas empenas) — `FACE_FS uRoofFx`. Sombras do sol:
    as peças e o volume das paredes projetados no chão ao longo do sol (`batches.shadowFaces`, MAX como os sprites):
    certas em qualquer ângulo.
  - **Interação:** tocar no telhado (desmontar etc., `roofPick`) lança um raio da tela para a câmera (subir na tela =
    subir em altura) contra a superfície de todas as regiões; o telhado fica translúcido só quando o raio do peito /
    cabeça do jogador na tela bate no telhado na frente dele; desabamento: as peças descem e somem; plantas de
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


## Móveis, estações, decoração e modo construção (`art/faces/props.js`)

Toda peça construída com chão próprio (móveis, estações, decoração, luzes, jardim) é desenhada enquanto girada pelo
tipo `prop` das faces. Pisos, tapetes, pedras de passagem e canteiros de horta continuam no chão (`uFlat`) e giram
inteiros com o mundo.

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
  água da frente a escondem); na primeira girada da sessão (quem nunca girou) os telhados aparecem em cores lisas até
  o worker pintar (~0,1–0,3 s por casa); a ordem das peças vem de um ângulo até 0,25° atrás (giro rápido: alguns
  quadros).
- Estruturas: tochas de parede continuam sprite (são da área de luzes / móveis); os pilares / postes de canto das
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
- **Móveis em pé** (peças de 1 tile, armações vistas de ponta): 4 vistas, trocam de vista a 45° como os personagens;
  poste de lampião e estandarte não têm vista de lado (em 0° também giram só pelo espelho do mundo). Barracas dos
  bandidos continuam em pé de frente para a tela.
- Faces de móveis não recebem a sombra do sol / o piscar de dano (como as paredes); o andaime de obra continua sprite.
- Desmontar com um toque pega o tile do chão sob o dedo (como em 0°); o giro de uma peça (R / ⟳) continua em
  direções do mundo (a seta no chão mostra para onde).
