# Cavalo — domar com trigo, alimentar, selar, montar e lutar a cavalo

Pedido do dono: "andar pelo mapa é tedioso, então adicione cavalo ao jogo, onde para domesticar tem que dar trigo para
ele e também deve ser alimentado para não morrer, o alimentador serve para cavalo também e ele come trigo, ele dá pouca
carne e muito couro, para montar nele tem que colocar uma sela nele, a velocidade dele é a mesma de corrida do jogador,
a única arma que dá de usar montado nele é a lança onde o tiro longo vira uma nova habilidade, a estocada que dá mais
dano se estiver em movimento com o cavalo, a única habilidade que não para o movimento para atacar."

Arquivos: `src/game/content/horses.js` (números), `src/game/horses.js` (domar, montar, o cavaleiro, o desenho em par),
`src/game/mut/horses.js` (intents e ops), `src/art/fauna.js` (o modelo 3D: pelagens, sela, rédeas, galope),
`src/art/faunaDraw.js` (`horseKey`, `ridePose` / `rideDraw`: o cavalo montado), `src/art/compose.js` (o cavaleiro
montado: pernas abertas, a lança deitada). Ganchos de uma linha em `livestock.js`, `ai.js`, `fauna.js`, `abilities.js`,
`combat.js`, `controller.js`, `work.js`, `boats.js`, `players.js`, `game.js`, `net/entities.js`, `ui/hud.js`.

## O cavalo selvagem

- `wild_horse` (já existia: manadas de 3–7 na estepe, 3–5 no deserto frio, nas mesas e na charneca). Agora tem
  **pelagens** (bits 2–3 da variante, sorteados na manada): baio/lobuno (o de sempre) 65 %, alazão 18 % (crina clara e
  lista branca na cara), tordilho 10 % (cinza rodado), preto 7 %.
- **Calmo**: chegar andando até ele não o assusta (dá para encostar). Quem **corre** (Disparada, ou a galope) a até
  **9 tiles** espanta o cavalo — e a manada inteira foge junto. Bater nele também (como qualquer animal passivo).
- Morto e carneado: **1 carne e 4–5 couros** (o couro precisa de faca), o selvagem e o domado.

## Domar: trigo da mão

- Com **trigo** na mochila, perto do cavalo selvagem: **"Dar trigo"** (E / Usar, ou um toque no cavalo). O jogador
  oferece o trigo por 0,6 s; sai **1 trigo** por vez. Sem trigo o botão diz "Dar trigo (precisa de trigo)".
- A cada trigo o cavalo para e fica quieto **8 s** (não foge nem com a manada). No **3º trigo** ele é domado:
  "Você domou o cavalo! Sela para montar, trigo para comer".
- Domado, é o mesmo bicho (mesmo id, mesma pelagem), agora o **Cavalo** da criação: do jogador (sai da manada, que só
  repõe a vaga 1,5 dia depois), salvo com o mundo, amarrável com corda (5 por jogador, como os outros), embarca no barco
  como animal (ocupa 1,45 × 0,62 do barco), e o ataque automático nunca o escolhe. Uma faca o abate com um golpe (como
  os outros domesticados).
- Dar trigo à mão **só existe para domar cavalos**: os outros animais (e o cavalo já domado) comem no alimentador.

## Comer: o alimentador

- O cavalo domado come **trigo** no **alimentador** (2 por dia; só trigo — milho e o resto ficam). Barriga cheia dura
  **2 dias** (26 min).
- Diferente da vaca / ovelha (que pastam sozinhas fora do alcance de um alimentador), o cavalo domado **tem fome em
  qualquer lugar**: deixado longe, a barriga esvazia do mesmo jeito. Com fome perto de um alimentador (6 tiles) ele vai
  até o cocho e come; longe de todos os jogadores (> 50 tiles) come direto.
- Barriga vazia: "Um cavalo está passando fome: leve-o ao alimentador!" (ou "…no alimentador!" se estiver perto de um),
  o aviso aos 60 % do prazo ("…vai morrer de fome: trigo no alimentador!") e a morte depois de **meio dia** com fome
  (corpo normal). Comer zera o prazo. Montado, não come.
- Plaquinha: "Cavalo · domado" / "· selado" (dourado), "· com fome" (laranja), "· faminto!" (vermelho), "· amarrado".
- Cavalos não têm potros (nem procriam no alimentador).
- **Modo criativo**: nunca com fome, como os outros.

## A sela

- **Sela** (`saddle`): **Bancada de trabalho**, 5 couros + 2 madeiras + 2 cordas, 8 s. Fica na mochila.
- Com a sela na mochila, perto do seu cavalo domado: **"Selar"** (0,9 s). A sela aparece no cavalo: manta vermelha com
  barra dourada, assento de couro entre o arção e a patilha, abas, estribos e a cilha, e o **cabresto com as rédeas**.
- Selado, a ação é **"Montar"** e a segunda opção é **"Tirar sela"** (devolve a sela). A segunda opção aparece num
  botão ao lado do de usar: no computador a tecla **Y** (remapeável em Configurações → Controles: "Interagir (2ª
  opção)"), no celular o botão pequeno acima do de usar. Sem sela, a segunda opção é amarrar / soltar o cavalo.

## Montar

- **"Montar"** num cavalo domado e selado que ninguém monta (no chão, fora do barco, ele fora da água funda). O jogador
  passa para a sela; uma corda que o prendia a ele volta para a mochila.
- **Desmontar**: **E** (o botão de usar diz "Desmontar"). O jogador desce ao lado do cavalo (do lado esquerdo primeiro),
  em chão seco; o cavalo fica ali, selado.
- **Velocidade**: a da corrida do jogador (4 × 1,65 = **6,6 tiles/s**), constante, **sem gastar energia**; a Disparada
  (Shift) não soma ("Montado: o cavalo já galopa"). O terreno conta como para quem anda (ladeira acima, água rasa).
- **O corpo do cavalo** (raio 0,34 em vez de 0,24): passagens estreitas não dão. Onde o cavalo não vai: **água funda**
  ("Água funda: o cavalo não nada"), **portas** (abertas ou não; o **portão** de cerca passa), **escadas e andares de
  cima**, **túneis** ("Cavalo não passa: portas, escadas e túneis só a pé"), **barco** ("Desça do cavalo para
  embarcar"). Barrancos pequenos (até 1 andar) ele pula como quem anda.
- **Montado não se trabalha**: coletar, cortar, minerar, construir, abrir baús / portas, pescar, cavar… tudo responde
  "Desça do cavalo". Comer e as ervas funcionam.
- **Apanhar**: as criaturas atacam o cavaleiro; **metade** dos golpes acerta o cavalo (o alvo maior). O cavalo tem 80
  de vida (sara devagar quando não está montado). Se o cavalo morre, o cavaleiro **cai sem se machucar** ("Seu cavalo
  morreu: você caiu (sem se machucar)"). Os lobos que caçam a criação à noite não escolhem um cavalo montado.
- Salvar: o cavalo montado é salvo como os outros (com a sela); o anfitrião que salvou montado volta para a sela ao
  carregar. Os outros jogadores voltam a pé.

## Lutar a cavalo: só a lança

- Montado, **só a lança ataca**. Machado, espada, faca, clava, arco, as mãos — o ataque (Espaço / clique) e as
  habilidades respondem "Montado: só a lança"; o ataque automático armado não sai. As ervas e o Bloquear do escudo
  continuam valendo.
- Com a lança na mão, montado, o **"Lançar Lança"** (o tiro longo de segurar e arrastar) vira **"Estocada"**:
  - crava a lança à frente, deitada, sem parar o cavalo — **a única habilidade que não para o movimento**;
  - acerta a primeira criatura numa faixa à frente do cavalo (2,7 tiles de alcance, 0,65 de meia-largura) 0,16 s depois;
  - o dano cresce com a **velocidade medida do cavalo** (k = velocidade / 6,6, de 0 a 1):
    **× (0,5 + 2,5 k) + (1 + 9 k)** — parado, 50 % +1; a galope, **300 % +10** (com a lança de pedra no nível 1: ~5
    parado, ~34 a galope); empurra o alvo (mais a galope); 20 de energia, recarga **6 s**, ícone próprio.
- Os outros ataques da lança (o automático, Perfurar, Varredura) funcionam montado e **param o cavalo** um instante
  (0,42 s), como o golpe para quem anda.
- Desmontado, tudo volta ao normal (o "Lançar Lança" de volta na barra).

## Multijogador

- O cavalo é uma criatura do anfitrião (cérebros, fome, o relógio da criação). O **fluxo de entidades** leva o que
  muda: a espécie e o nome no registro estático (domar reenvia: o mesmo `nid` vira `horse`), a pelagem na variante, a
  **sela** no bit 256 dos bits da criação e o **pid de quem o monta** no campo `[15]`.
- Intents: `horse.feed` (o trigo sai da mochila antes; devolvido se o anfitrião recusa), `horse.saddle` (a sela sai
  antes), `horse.unsaddle`, `horse.mount`, `horse.dismount`. Ops: **`horse.ride`** `{nid, pid, on, x, y}` (quem monta o
  quê: `game.horses.rides` em todo mundo; ao descer, o cliente do cavaleiro vai para `x, y`) e `horse.note`
  (retorno: comeu / domado / sela, com `toast` e a sela de volta em `give` para o `by`).
- **Quem monta dirige** (como o remador do barco): o cavaleiro move o próprio avatar (velocidade e colisão de montado);
  o anfitrião mantém o cavalo sob o avatar dele (`rideFollow`: a posição mais recente) e o desmonta se o avatar some,
  morre ou se afasta mais de 6 tiles. Cada cliente desenha o par **no ponto desenhado do cavaleiro** (o cavalo não é
  desenhado sozinho), com o galope pelo relógio de passos do cavaleiro — por isso não há descompasso entre os dois.
- A Estocada é uma habilidade do dono: a rolagem é do atacante (como todo golpe), o anfitrião aplica via `mob.hit`; os
  outros veem a pose pela ação `lance` da presença.
- Salvamento: as linhas `world.stock` ganharam `[11]` sela e `[12]` "o anfitrião montava este" (saves antigos: sem
  sela). Montado não vai para o salvamento do jogador.
- Cenários `tools/mp-test.js`: **HO1** domar com trigo (3 trigos, mesma criatura vira o cavalo; andar até ele não
  assusta, correr assusta), **HO2** alimentador (só trigo), fome em qualquer lugar, morte de fome, abate com faca (1
  carne, 4–5 couros), **HO3** selar / tirar sela / montar, velocidade de corrida, o anfitrião vê o par a galope, sem
  trabalho / barco / porta montado, **HO4** Estocada parado × a galope (≥ 2,5 ×; medido ~6 ×) sem parar o cavalo,
  Perfurar para, **HO5** só a lança (machado, arco, mãos recusados; ervas sim), **HO6** desmontar (Lançar Lança de
  volta), cavalo morto derruba o cavaleiro ileso, **HO7** salvar / carregar com pelagens e selas.

## Arte

- O cavalo é o modelo 3D do selvagem (`art/fauna.js`, kit de elipsoides do `MODEL3D`: cada vista é o animal visto de
  verdade, as diagonais incluídas), com as pelagens como materiais (o tordilho com manchas no espaço do corpo, o alazão
  com a lista branca) e, selado, a sela e o cabresto **no modelo** (a sela fica certa em todas as vistas, escondida
  atrás do pescoço quando ele vem de frente). Quadros: parado, passo (4), pastar, empinar e **galope (4 quadros, cada
  perna por si e o corpo arfando)**. Só o baio (selvagem e domado) vai assado no atlas; as outras pelagens e os
  selados são pintados sob demanda (até ficarem prontos, o baio tingido da cor da pelagem).
- **Cavalo e cavaleiro são uma peça só** (`art/compose.js` drawPawn com `p._rideD`): uma vista para os dois (8 vistas
  em qualquer ângulo da câmera, também a 0°), o cavaleiro sentado na sela (o corpo encolhido, carregado pelo balanço e
  pelo galope do cavalo, inclinado para a frente a galope), as **pernas abertas**: de cada lado uma coxa descendo pelo
  flanco e a bota no estribo. A ordem de desenho num só cartão de profundidade: a perna do lado de lá, o cavalo, o
  corpo, a perna do lado de cá — e, quando o cavalo vem de frente, o corpo antes do cavalo (o pescoço e a cabeça dele
  na frente do colo do cavaleiro) com as duas pernas ao lado do peito.
- As mãos seguram as rédeas quando livres; a lança fica em pé ao lado. A **Estocada** deita a lança à frente, encaixada
  sob o braço, e a empurra (pose `lance`).
- Ícone da Estocada: a lança deitada com as linhas de velocidade (`ui/icons.js`). Ícone da sela: `item_saddle`
  (`art/livestock.js`).
