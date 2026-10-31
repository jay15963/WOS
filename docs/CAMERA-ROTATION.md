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
- **Cercas / muros de pedra / sebes / portões:** painéis finos pelo meio do tile (um por eixo em que correm), com a
  arte da própria cerca; vistos dos dois lados.
- **Escadas:** 5 degraus sólidos nas cores das tábuas, subindo da entrada.
- **Pisos de cima:** as camadas planas do piso na altura do andar + a borda da laje nos lados à mostra.
- **Coisas penduradas na parede** (quadro, troféu, ervas, cortina, ganchos): planas na face da parede.
- **Personagens e bichos:** a vista desenhada = a direção deles menos a da câmera (`viewFacing`), em 4 vistas.
- Coisas de um andar de cima desenhadas como sprite sobem reto na tela (levels.drawUpper).

## O que falta

- **8 direções** dos personagens: hoje 4 vistas; as diagonais pedem o rig em 5 vistas (o resto espelhado).
- Telhados: a parte de baixo do beiral não é desenhada (com a câmera a 45° ela nunca aparece: a parede ou a própria
  água da frente a escondem); na primeira girada da sessão (quem nunca girou) os telhados aparecem em cores lisas até
  o worker pintar (~0,1–0,3 s por casa); a ordem das peças vem de um ângulo até 0,25° atrás (giro rápido: alguns
  quadros).
- Portão aparece como um trecho de cerca (a folha do portão tem um quadro próprio).
- Fantasmas do modo construção (o que você está posicionando) continuam sprites (menos o do telhado: faces).
- O minimapa / radar fica com o norte para cima (a bússola mostra o giro).
