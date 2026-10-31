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
- **Personagens e bichos:** em 8 vistas (abaixo).
- Coisas de um andar de cima desenhadas como sprite sobem reto na tela (levels.drawUpper).

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


## O que falta

- Telhado com tacaniça (hip): as linhas diagonais ficam aproximadas na grade; a parte de baixo do beiral não é
  desenhada.
- Portão aparece como um trecho de cerca (a folha do portão tem um quadro próprio); a luz das lâmpadas de dentro
  ainda clareia o telhado girado (o telhado não entra no mapa de luz enquanto girado).
- Fantasmas do modo construção (o que você está posicionando) continuam sprites.
- O minimapa / radar fica com o norte para cima (a bússola mostra o giro).
- Personagens: a 3/4 é feita da vista de frente / costas (não há arte pintada em diagonal): o braço de lá ainda
  aparece na borda; o nariz não sai do perfil. Bichos na diagonal = perfil encurtado (sem vista 3/4 própria).
  Sentado e o rodopio usam a vista mais perto. Bichinhos do ambiente só trocam de lado (não giram de verdade).
