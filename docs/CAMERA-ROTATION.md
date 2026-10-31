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
- **Escadas:** 5 degraus sólidos nas cores das tábuas, subindo da entrada.
- **Pisos de cima:** as camadas planas do piso na altura do andar + a borda da laje nos lados à mostra.
- **Coisas penduradas na parede** (quadro, troféu, ervas, cortina, ganchos): planas na face da parede.
- **Personagens e bichos:** a vista desenhada = a direção deles menos a da câmera (`viewFacing`), em 4 vistas.
- Coisas de um andar de cima desenhadas como sprite sobem reto na tela (levels.drawUpper).

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

- **8 direções** dos personagens: hoje 4 vistas; as diagonais pedem o rig em 5 vistas (o resto espelhado).
- Telhado com tacaniça (hip): as linhas diagonais ficam aproximadas na grade; a parte de baixo do beiral não é
  desenhada.
- Portão aparece como um trecho de cerca (a folha do portão tem um quadro próprio); a luz das lâmpadas de dentro
  ainda clareia o telhado girado (o telhado não entra no mapa de luz enquanto girado).
- **Móveis em pé** (peças de 1 tile, armações vistas de ponta): 4 vistas, trocam de vista a 45° como os personagens;
  poste de lampião e estandarte não têm vista de lado (em 0° também giram só pelo espelho do mundo). Barracas dos
  bandidos continuam em pé de frente para a tela.
- Faces de móveis não recebem a sombra do sol / o piscar de dano (como as paredes); o andaime de obra continua sprite.
- Desmontar com um toque pega o tile do chão sob o dedo (como em 0°); o giro de uma peça (R / ⟳) continua em
  direções do mundo (a seta no chão mostra para onde).
