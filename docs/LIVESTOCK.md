# Agropecuária — criação de animais, pesca, trigo e o rebalanço da comida

Pedido do dono: cinco animais novos (vaca, porco, galinha, ovelha e peixe), pesca com vara (o tiro longo com flecha e a
lança também pescam, mas dão menos), domesticação pelo **alimentador**, a **corda** para amarrar e levar até 5 animais,
reprodução quando bem alimentados (senão morrem), filhotes que crescem, abate com 1 golpe de faca, o **trigo** (só em
solo fértil, perto dos rios) e o **pão** na fornalha, e um rebalanço das plantações e da comida.

Arquivos: `src/game/content/livestock.js` (números), `src/game/livestock.js` (rebanhos, cérebros, relógio da criação,
cordas, abate, alimentador, salvamento), `src/game/mut/stock.js` (amarrar / soltar), `src/game/fishing.js` +
`src/game/mut/fish.js` (pesca), `src/world/soil.js` (solo fértil), `src/art/livestock.js` (arte: animais em 3D, alimentador,
trigo, ícones, vara, corda, boia), `src/art/livestockDraw.js` (desenho em 8 vistas), `src/art/faces/solidFarm.js`
(o alimentador como peça sólida 3D). Ganchos de uma linha em `mobs.js`, `combat.js`, `controller.js`, `building.js`,
`net/entities.js`, `net/snapshot.js`, `ui/overlay.js`, `game.js`, `systems.js`.

## Os animais

| Espécie | Vida | Onde (selvagem) | Bando | Come (no alimentador) | Por dia | Abate (faca) | Filhote (cresce em) |
|---|---|---|---|---|---|---|---|
| Vaca | 72 | campos verdes | 2–3 | trigo | 3 | 5–7 carne, 3–4 couro | Bezerro (3 dias) |
| Ovelha | 40 | campos verdes | 3–4 | trigo | 1 (~1,4) | 1–2 carne, 3–4 couro, 2–4 lã | Cordeiro (2 dias) |
| Porco | 46 | matas, campos | 2–3 | qualquer comida (e trigo) | 2 | 2 carne | Leitão (2 dias) |
| Galinha | 10 | campos, margens | 3–5 | milho | 1 (~1,4) | 1 carne, 2–4 penas | Pintinho (1,5 dia) |
| Peixe | 4 | rios e lagos (cardumes de 2–3) | — | — | — | vara: 2–3 peixes crus; tiro longo / lança: 1 | — |

- Lã (`wool`) e pena (`feather`) ainda não têm uso. Um filhote abatido dá uma parte (bezerro / cordeiro 40 %, leitão 50 %,
  pintinho 100 %, sempre ao menos 1 carne).
- Selvagens são calmos: só correm quando apanham (dá para chegar perto e amarrar). São animais do dia (como cervos e
  coelhos: somem à noite e ficam raros no inverno) — os da criação nunca somem.
- Rebanhos: 7 de vacas, 7 de ovelhas, 6 de porcos, 8 de galinhas; 34 cardumes. Gerados com um rng próprio da semente
  (`createStockSpawners`), então os outros spawners do mundo continuam onde estavam. Um animal tirado do rebanho deixa
  uma vaga que só se repõe 1,5 dia depois.
- Nomes na plaquinha: "Vaca · domesticada" (dourado), "· com fome" (laranja, barriga < 30 %), "· faminta!" (vermelho),
  "· amarrada". O ataque automático nunca escolhe um animal da criação nem um peixe (só um alvo marcado).

## Corda (amarrar e levar)

- Com uma corda na mochila, perto de uma vaca / ovelha / porco / galinha: "Amarrar vaca" (E / Usar, ou um toque /
  clique no animal). A corda sai da mochila; o animal segue o jogador numa fila atrás dele (1,5 tile + 0,55 por animal),
  com a corda desenhada da mão até o pescoço (em todos os clientes, em qualquer ângulo da câmera).
- No máximo **5** por jogador. "Soltar vaca" devolve a corda; o animal fica onde está.
- Longe demais (> 16 tiles: um teletransporte, renascer) a corda solta e volta para o jogador; o mesmo se o animal
  morrer ou o jogador sair da sala.
- Amarrado, o animal é do jogador (sai do rebanho selvagem) e é salvo com o mundo.

## Alimentador (domesticação)

- Construção 2×1 (Agricultura): 6 madeira, gira, pode ser movida ("Mover" leva a comida junto). Peça sólida 3D
  (`solidFarm.js`): cocho de tábuas com aros de ferro sobre quatro pés; com comida dentro mostra o monte de grãos.
- Janela própria ("Alimentador", 6 espaços): só aceita comida — trigo e qualquer item com valor de comida (milho, frutas,
  batata, carne…). Pedra e outros itens são recusados no cliente e no anfitrião.
- **Domesticado = dentro do alcance (6 tiles do centro) de um alimentador pronto** e não amarrado. Um anel tracejado
  mostra o alcance enquanto se posiciona o alimentador e, fraco, quando o jogador está perto de um.
- Os domesticados passeiam pela área do alimentador; com fome vão até o cocho e comem (uma porção a cada 2,5 s de
  mastigar). Um animal longe de todos os jogadores (> 50 tiles) come direto, sem andar.

### Fome (só para os domesticados)

- Barriga 0..1. Cheia dura **1 dia** (13 min). Uma porção = 1 / (comida por dia) da barriga; vai comer quando cabe uma
  porção inteira, e nunca depois de 35 % (ovelha e galinha comem ~1,4 por dia por isso). Filhotes comem metade.
- Barriga vazia = **passando fome**: aviso para todos ("Uma vaca está passando fome no alimentador!"), outro aos 60 %
  do prazo ("…vai morrer de fome: ponha comida no alimentador!") e a morte depois de **meio dia** com fome (corpo
  normal, "Uma vaca morreu de fome."). Comer zera o prazo.
- Fora do alcance de um alimentador o animal não passa fome (pasta sozinho) — mas também não é domesticado.
- **Modo criativo**: domesticados sempre cheios, o alimentador não é consumido, ninguém morre de fome.

### Reprodução e crescimento

- Dois adultos da mesma espécie, domesticados no mesmo alimentador, ambos com barriga ≥ 60 % e descansados: a cada
  segundo 6 % de chance → nasce um filhote entre eles (domesticado). Os pais descansam (vaca 2 dias, ovelha / porco 1,5,
  galinha 1) e perdem 15 % da barriga. No máximo **10** animais por alimentador.
- O filhote nasce com 56 % do tamanho e cresce até virar adulto (vaca 3 dias, ovelha / porco 2, galinha 1,5); a arte de
  filhote (cabeça maior, pernas proporcionais, sem chifres / úbere) vira a de adulto no fim.
- O tempo vale com o relógio compartilhado (anos de qualquer duração; pular dias com `env.skip` faz crescer).

### Abate

- Um animal **domesticado** morre com **um golpe de faca** (qualquer faca, golpe ou habilidade): o corpo fica no chão já
  esquartejado e os produtos (tabela completa da faca) caem como itens. Com outra arma é dano normal (ele foge).
  Selvagens: dano normal com qualquer arma; o corpo se coleta como os outros animais ("Coletar").
- Um clique / toque num animal domesticado só o marca (nunca ataca por acidente); o abate é pelo botão de ataque / Espaço.

## Pesca

- **Vara de pescar** (`rod_wood`, à mão: 2 gravetos + 3 fibras). Basta tê-la na mochila (ou na mão).
- Perto da água, "Pescar" (E / Usar): a linha vai para a água à frente (1,6 a 6,5 tiles; em leque se reto não houver
  água); o jogador fica parado segurando a vara, a boia (vermelha e branca) balança com ondinhas.
- Um peixe de verdade perto da boia (3,5 tiles) nada até ela; a mordida vem em 3–9 s (com 3+ peixes perto, 25 % mais
  rápido; sem peixe por perto: 9–16 s, um peixe de passagem). A boia afunda, espirra, soa e aparece "Puxe! (E / Usar)":
  o botão de usar vira **"Puxar!"**.
- Puxar na janela (1,25 s + 0,45 s de folga de rede, no relógio do anfitrião) = **2–3 peixes crus** (+XP). Cedo demais:
  "Cedo demais: o peixe fugiu"; tarde: "O peixe escapou". Andar recolhe a linha; longe da boia a linha arrebenta.
- **Tiro longo / Lançar lança** que cai na água onde há peixe: o peixe morre e dá **1** peixe cru direto para quem
  atirou (menos que a vara). Flechas comuns num peixe marcado também.
- Peixe cru (6 de fome, pode fazer mal) → **Peixe assado** na fogueira / caldeirão (22 de fome).
- Inverno: a água congela — "Água congelada", sem pesca; os peixes ficam sob o gelo (não aparecem).

## Trigo, solo fértil e pão

- **Solo fértil** = até **5 tiles** de um rio (água com correnteza; lagos não contam) — `src/world/soil.js`, derivado do
  mundo gerado, igual em todos os clientes.
- **Semente de trigo**: do **trigo silvestre** (cresce sozinho só no solo fértil, campos e margens: colher dá 1–2 trigo +
  1–2 sementes) e, às vezes (12 %), colhendo fibra perto do rio.
- O trigo só cresce num canteiro em solo fértil. Ao posicionar canteiros com sementes de trigo na mochila, o solo fértil
  em volta fica verde e os canteiros fora dele vermelhos; no canteiro, o botão diz "Solo não fértil" (e o anfitrião
  recusa o plantio fora dele).
- **Pão**: 2 trigo na **fornalha** (6 s, 1 de combustível) → 30 de fome.

## Rebalanço (plantações e comida)

Crescimento: **8 min** para todas (regra do dono), mais rápido na chuva, parado no inverno.

| Planta | Colheita (por canteiro) | Antes |
|---|---|---|
| Batata | 1–2 batatas + 1–2 sementes | 3–4 + 1–2 |
| Milho | 1–2 milhos + 1–2 sementes | 2–3 + 1–2 |
| Algodão | 2–3 algodões + 1–2 sementes | 3–4 + 1–2 |
| Trigo (novo, solo fértil) | 2–3 trigos + 1–2 sementes | — |

| Comida | Fome | Antes |
|---|---|---|
| Frutas silvestres | 6 | 10 |
| Batata crua / assada | 4 / 12 | 12 / 30 |
| Milho cru / assado | 3 / 10 | 10 / 26 |
| **Pão** (novo) | **30** | — |
| Carne crua / **assada** | 14 / **40** | 14 / 40 |
| Peixe cru / assado (novos) | 6 / 22 | — |
| Ensopado (2 por receita) | 50 | 60 |

Só o pão chega a 30 e a carne assada a 40; batata e milho viraram complemento.

## Multijogador

- Os animais e peixes são criaturas do anfitrião (rebanhos, cérebros, relógio da criação `stockSystem`, sync 'host').
  O fluxo de entidades (`net/entities.js`) leva, além do de sempre, dois campos dinâmicos: `[13]` bits da criação
  (domesticado 1, com fome 2, faminto 4, do jogador 8) e `[14]` o pid de quem o leva na corda; nome / variante (bit 2 =
  filhote) / tamanho vão no registro estático (crescer reenvia).
- Intents `stock.tie` / `stock.untie` → op `stock.rope` (corda de volta = `give`, toast); `stock.note` = aviso para
  todos (nascimento, fome). O alimentador é um contêiner compartilhado (`chest.put` / `chest.take` / `store.sort`; comer
  = `chest.set`), então o conteúdo está no snapshot, no salvamento e no digest (`structs`).
- Abate = `mob.hit` (leva `w`, a arma da mão) → `mob.die` + `corpse.add` (esquartejado) + `loot.add`. Peixe de tiro:
  `mob.die {give}`.
- Pesca: intents `fish.cast` / `fish.pull` / `fish.stop` → ops `fish.bob` (boia, hora da mordida no relógio do anfitrião,
  convertida para o relógio de cada cliente) / `fish.end` (peixes = `give`). Sessões são de segundos: não vão para o
  snapshot nem para o digest.
- Salvamento (só do anfitrião): `world.stock` = `[[espécie, x, y, variante, barriga, nasceu, adulto, procria, tamanho,
  nível, vida]]` dos animais do jogador (amarrados uma vez, domesticados, nascidos na criação); voltam no primeiro tique
  da criação. Saves antigos não têm a lista. Cordas não são salvas (soltos ao carregar).
- Cenários `tools/mp-test.js`: **P1** amarrar e levar (máx. 5, soltar), **P2** alimentador domestica e alimenta,
  **P3** nascimento, crescimento (pulo de dias) e morte de fome, **P4** abate com faca (convidado), **P5** pesca com vara
  (cedo demais / na hora) e tiro longo.

## Arte

- **Animais em 3D de verdade** (`art/livestock.js`): cada animal é um conjunto de elipsoides no espaço do corpo (tronco,
  quadris, peito, pescoço, cabeça, focinho, orelhas, chifres, úbere, rabo, pernas em dois segmentos, cascos; a lã da
  ovelha são ~34 tufos sobre o corpo). Cada sprite gira o corpo para a vista (e, se, s, ne, n; w / sw / nw espelhadas) e é
  pintado pixel a pixel por traçado de raios ortográfico (câmera 18° acima do horizonte, luz de cima à esquerda): normais
  das partes que se tocam misturadas (juntas suaves), sombreado cel com sombras quentes, ruído de pelo, manchas da vaca
  no espaço do corpo (as mesmas em todas as vistas e quadros), olhos e narinas como marcas na superfície, linha interna
  onde uma parte passa na frente de outra, e o contorno dos pintores. Por isso as diagonais são vistas reais, não o lado
  esticado.
- Quadros: em pé, trote em 4 quadros (s / n: 2), pastando (e, se, ne); filhotes com 2 quadros. Segunda pelagem por tinta
  (vaca marrom, ovelha preta rara, porco mais escuro, galinha marrom). ~160 sprites, ~1 s de pintura no desktop (o atlas
  fica em cache).
- `art/livestockDraw.js`: escolhe a vista pelo `_dv` de `art/facing.js` (câmera girada) e, em 0°, pelo próprio
  movimento (um animal andando na diagonal aparece na vista 3/4); trote pela distância andada, balanço, respiração,
  pastar / bicar num horário compartilhado, comer no cocho (`action 'eat'`), piscar de golpe, sombra.
- Peixe: visto de cima nadando (3 quadros de cauda, achatado no chão sob a água, gira com o mundo), de lado num salto.
