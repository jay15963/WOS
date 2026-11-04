# Reinos, cerco e monstros por zona — o pedido do dono (fonte única)

Este documento guarda o que o dono pediu e as decisões já tomadas com ele. Todo agente que mexer em monstros de
inverno, vilas / castelos / cidades / reinos, diplomacia, guerra, cerco, comércio, trabalho, propriedades ou nas
máquinas de guerra lê isto antes e mantém o que está aqui. O objetivo do dono: transformar o jogo num **survival RPG
completo** — "extremamente intuitivo, dinâmico, imersivo e magnífico, tudo precisa se conversar".

## 1. Perigo noturno em todas as zonas (monstros de inverno)

Toda região tem um perigo à noite na sua estação ruim. Os novos funcionam como os Andarilhos do Gelo
(`game/walkers.js`) e o Gigante de Gelo (`game/giants.js`): surgem à noite, são atraídos pela luz, quebram
construções, somem ao amanhecer; no criativo não quebram nada nem são atraídos pela luz; a balista acerta os gigantes.

| Região (zona do tile + bioma, `game/seasons.js`) | Monstros | Quando |
|---|---|---|
| Polar | Andarilhos do Gelo + Gigante de Gelo (existem) | toda noite |
| Subpolar / temperado | Andarilhos do Gelo (existem) | noites de inverno |
| Quente, perto do equador (inverno ameno) | **Esqueletos + Gigante Esqueleto** | noites do inverno ameno |
| Trópicos úmidos (selva, savana) | **Esqueletos** | noites da estação seca |
| Desertos quentes (zona quente / tropical, biomas áridos) | **Múmias + Múmia Gigante** | noites do inverno ameno / estação seca |

Ao amanhecer: esqueleto vira ossos, múmia vira areia (o andarilho já vira neve). As estações são locais e invertidas
no outro hemisfério (`seasonAt(game, x, y)` já dá isso).

**Feito** (fase 1): [NIGHT-DEAD.md](NIGHT-DEAD.md) — regras (uma família por lugar, deserto pela região), números,
comportamento, drops (ossos → flechas / adubo; linho → tecido / curativos), arte (8 direções), sons, HUD, multijogador e
os testes NM1–NM6.

## 2. Assentamentos

Gerados proceduralmente pela semente do planeta, mas com **casas prontas** (como as estruturas do Minecraft), **partes
de castelo modulares** que se encaixam e **muralhas procedurais** que seguem o contorno do lugar e o relevo. Tudo com
o visual 3D do jogo (kit sólido, `src/art/faces/solid.js`) e feito de estruturas de verdade (quebráveis, consertáveis).

- **Vila** — povoado com ou sem paliçada de madeira, **sempre com guardas** (para o inverno). Fazendas, minas,
  animais domesticados, oficinas (ferreiro, madeireira…). População média **50**. Um **mural** no centro.
- **Castelo** — fortaleza de pedra só militar. Pouca população civil, o bastante para fazendas e animais que
  alimentam o castelo. **Não vende terreno.**
- **Cidade** — como a vila, bem maior e mais próspera, população média **200**, **muralha de pedra** e um **castelo no
  meio**. É a **capital** do reino.
- **Noite** — cidadãos ficam em casa; guardas patrulham; arqueiros nas muralhas; balistas (e catapultas) nas cidades.
  Os monstros do inverno atacam os assentamentos e as defesas lutam.
- **Portões** — madeira (2 tiles) e pedra com grade de ferro (2 tiles, mais resistente). Abertos de dia; fecham à noite
  (monstros) e quando há inimigos dentro do território. Portões do jogador: o dono abre / fecha ou deixa no automático.

Escala: até **30 reinos**; cada um com 1 cidade (capital), 2–4 castelos e 8–20 vilas, e terra livre entre eles.

## 3. Reinos, território, diplomacia

- O reino engloba seus assentamentos; tem **território marcado** (o mapa-múndi mostra territórios, nomes de cidades /
  vilas / castelos, exércitos, caravanas).
- **Reputação** do jogador com cada reino: sobe trabalhando e comerciando nele.
- **Diplomacia** simples entre reinos: amigável / neutro / inimigo. Inimigo → os exércitos se enfrentam. Amigável →
  cidadãos se visitam e comerciam entre as cidades e vilas.
- **Sem navios ainda**: reinos que não se ligam por terra **não interagem** (nem guerra, nem comércio, nem visitas).
  A ligação é calculada pela massa de terra (continente) de cada reino.

## 4. Guerra e cerco

- Cada cidade, vila e castelo tem um **exército**; podem se juntar ou fazer campanhas separadas; enfrentam outros
  exércitos e invadem cidades, vilas e castelos.
- O jogador com reputação suficiente entra num exército pelo **mural** → aparecem **ordens do general** na tela e
  **waypoints** no mapa e no minimapa.
- **Sem fogo amigo**: só dá para atacar gente (e estruturas) de reinos **inimigos**.
- **Cerco** completo: acampamento fora do alcance → a IA mede muralhas / portão e constrói as máquinas (torres na
  altura certa) → bombardeio (brechas; muralha e portão com vida, dano persistente, defensores consertam) → assalto
  (aríete no portão, torres encostam e baixam a rampa, luta nas muralhas e ruas) → conquista (segurar o centro sem
  defensores por um tempo: o lugar muda de reino) ou recuo.
- **Defesa** (dono: "os soldados vão para as muralhas e não ficam defendendo apenas o mural / castelo … caso o inimigo
  abra uma abertura na muralha os soldados corpo a corpo vão até a abertura"): em ataque de monstros ou cerco a defesa
  vai para o perímetro — arqueiros no alto das muralhas, corpo a corpo nos portões e nos trechos atacados, equipes nas
  balistas / catapultas, uma reserva pequena no castelo, civis em casa. Uma peça de muralha / paliçada / portão
  destruída vira **brecha**: os corpo a corpo mais perto vão segurar a abertura e os arqueiros dali miram nela. Vilas sem
  muralha: os guardas se formam na borda virada para a ameaça e nas entradas das estradas.
- Longe dos jogadores o cerco é resolvido por números (tropas, máquinas, muralhas, dias) com os estragos persistindo;
  perto de um jogador é jogável dos dois lados.
- Lugar conquistado muda de reino; reino sem nenhuma cidade some. Fundar o próprio reino: só no futuro.
- Morrer na guerra: renasce como sempre, sem perder reputação.
- Os reinos **não** cercam as bases dos jogadores (por enquanto): elas só sofrem com monstros e bandidos.

## 5. Máquinas de guerra (novas; visual 3D, custam recursos, o jogador também constrói)

| Peça | Papel | Dano |
|---|---|---|
| **Trabuco** | artilharia de cerco, o maior alcance | em área; muito forte em estruturas, fraco em entidades; **precisão muito ruim** |
| **Catapulta** | defesa em cima das muralhas, alcance médio | em área; dano em entidades **igual ao da balista** |
| **Aríete** (bateria quebra-portões) | quebrar portões | **só** acerta portões |
| **Torre de cerco** | atravessar a muralha (encosta e baixa uma rampa) | nenhum; **vários andares, construída na altura da muralha alvo** (a IA mede a muralha) |

Construídas numa **Oficina de cerco** (estação nova). Trabuco e catapulta: 1 operador (como a balista). Aríete e torre:
empurrados por 2+ pessoas (soldados / jogadores); sozinho, bem devagar. Só causam dano em estruturas de reinos
inimigos (sem fogo amigo), monstros e bandidos.

## 6. Economia, trabalho, propriedades

- **Moeda de ouro**: item no inventário (cai ao morrer, dá para dar a outros jogadores).
- **Comércio** por oferta e demanda (como Mount & Blade): cada lugar produz / consome coisas diferentes; dá para viver
  só de comércio. Sem reino o jogador é **viajante**: comercia com todos, mesmo reinos inimigos entre si; entra e sai
  de um reino a qualquer momento pelo mural.
- **Trabalhos** aceitos no mural (fazenda, mina, entregas, defender a vila à noite…), pagos em moedas de ouro.
- **Mural** no centro de cada vila / cidade / castelo, com abas: o lugar · o reino · trabalhos · comércio · exército ·
  propriedades (as suas, à venda, para aluguel, terrenos para comprar e construir).
- Dentro do território de uma cidade / vila só se constrói com autorização (terreno comprado). Castelo não vende
  terreno. Fora dos territórios constrói-se livre.
- **Imposto** diário por reino para quem tem propriedade: **cobrado automaticamente** das moedas do jogador, com aviso.
  Se não tiver na hora: aviso por 3 dias; depois o reino toma a propriedade.

## 7. Multijogador

Anfitrião autoritativo como o resto do jogo. Reputação, reino e propriedades **por jogador**; dois jogadores podem
estar em reinos inimigos e lutar entre si. A simulação dos reinos (economia, exércitos, diplomacia) roda no anfitrião.

## 7b. Equilíbrio: os reinos evoluem junto com o jogador

As criaturas ficam mais fortes quanto mais longe do início do mundo. Se isso valesse para os reinos, os reinos perto do
início seriam sempre os mais fracos. Regra do dono: **os NPCs dos reinos perto do início evoluem junto com o jogador**
com o tempo — o nível deles sobe acompanhando o progresso dos jogadores, e o **teto** é o nível mais alto dos NPCs mais
distantes. Assim os reinos ao redor crescem junto com o jogador e as guerras entre reinos ficam equilibradas.

- Nível de um NPC de reino (guardas, soldados, exércitos, generais) = o maior entre o nível pela distância e o nível de
  progresso do mundo, nunca acima do teto (o nível dos NPCs mais distantes).
- Progresso do mundo: o nível do jogador mais avançado do mundo (multijogador: o mais alto entre os jogadores que já
  jogaram nele); só sobe.
- Vale também para a força dos exércitos na simulação resumida (longe dos jogadores) — a mesma conta.
- As criaturas selvagens e os monstros continuam pela regra da distância (só os reinos evoluem).

## 8. Fases

1. Esqueletos / múmias e gigantes · geração dos reinos (territórios, assentamentos, casas prontas, castelo modular,
   muralhas, portões, nomes, estradas, mapa) · as 4 máquinas de guerra.
2. Moradores e guardas (rotina dia / noite, defesa nas muralhas) · mural · comércio, moeda, trabalhos, reputação,
   propriedades, imposto.
3. Diplomacia · exércitos no mapa · batalhas · IA do cerco completa · entrar num exército (ordens, waypoints).

Cada fase é testada (cenários multijogador), publicada e mostrada em prints.

Apontamentos do dono depois da fase 1 (corrigir na fase 2):
- As casas estavam com a entrada bloqueada por algum móvel: toda porta precisa de passagem livre por dentro e por fora.
- As paliçadas não tinham como subir (escada): devem ser como as muralhas, com o alto caminhável e escadas.
- Queda de frames: tudo precisa ser mais otimizado.
- Faltam os cidadãos (fase 2).

## Implementação — máquinas de guerra (fase 1)

Feito: a **Oficina de cerco** e as quatro máquinas (§5), com modelo 3D, custo, obra de verdade, vida, multijogador e
testes (SG1–SG6). Código: `game/siege.js` (regras), `game/content/siege.js` (números), `game/mut/siege.js` (ops /
intents), `art/faces/solidSiege.js` (modelos 3D), `ui/siegeUi.js` (HUD e mira), `fx/siegefx.js` + `fx/sfxEngines.js`
(efeitos e sons). Ganchos de uma linha em `building.js`, `controller.js`, `abilities.js`, `levels.js` (deck da torre),
`walkers.js`, `mut/structures.js` (colocação, andares da torre), `net/snapshot.js` (linhas `sieg` / `sdmg`),
`net/interest.js`, `ui/buildbar.js` (Andares), `ui/actionbar.js`, `ui/help.js`.

### Construir

Tudo fica no menu **Construir → Cerco**. As máquinas só podem ser planejadas com uma **Oficina de cerco pronta a até 16
tiles** ("Construa perto de uma Oficina de cerco pronta"). Planta grátis, o material sai da mochila quando a obra
começa (como toda construção).

| Peça | Tamanho | Custo | Obra | Vida (dano de cerco) |
|---|---|---|---|---|
| Oficina de cerco (estação) | 3×2 | 30 madeira, 12 pedra, 6 corda, 4 barra de ferro | 10 s | 1200 |
| Trabuco | 3×3 | 60 madeira, 12 corda, 30 pedra, 8 barra de ferro | 24 s | 1800 |
| Catapulta | 1×1 (chão ou topo de muralha) | 24 madeira, 8 corda, 4 barra de ferro, 2 couro | 12 s | 800 |
| Aríete | 2×3 | 40 madeira, 10 barra de ferro, 6 couro, 6 corda | 16 s | 1500 |
| Torre de cerco | 2×2, 1–3 andares | 70 madeira, 10 corda, 8 couro, 6 barra de ferro | 22 s | 2000 |

Munição (na Oficina de cerco): **Pedra de trabuco** = 6 pedras; **Pedra de catapulta** = 3 pedras → 2. A oficina
também faz flechas de balista. Gira com R ao planejar (a torre e o aríete andam para a frente: planeje virados para
onde vão).

### Usar

- **Trabuco** (1 operador): E opera / sai. Mouse = o alvo (direção **e** distância, 14–46 tiles); a armação gira
  devagar (0,3 rad/s) até lá; Espaço ou clique atira. No toque: arraste o botão de ataque (direção = para onde,
  comprimento = quão longe), solte para atirar; toque rápido atira para onde aponta; ✕ ou voltar ao centro cancela.
  Gasta 1 pedra de trabuco. Recarga **14 s** (o braço volta no guincho). Mira **muito ruim**: a pedra cai numa elipse de
  16 % da distância ao longo × 9 % de lado (a 30 tiles: até 4,8 × 2,7 tiles do alvo); a cada tiro no **mesmo alvo**
  (até 3 tiles do anterior) a elipse encolhe ×0,8, até 45 %. Impacto: estruturas (só inimigas) levam **650** no ponto,
  metade na borda de 2 tiles (uma muralha de pedra tem 1500); criaturas na área de 2 tiles levam só **70** (gigante de
  gelo: 10 % da vida). Braço com contrapeso balançando, funda que solta a pedra, pedra alta com sombra, aro onde vai cair
  (todos veem), poeira, pedaços, cratera e a pedra largada no chão.
- **Catapulta** (1 operador): igual, alcance 5–26 tiles, gira 0,85 rad/s, recarga **5 s**, mira boa (3,5 % × 2,5 %).
  Em criaturas faz **o mesmo dano da balista** em área de 1,4 tile (no mínimo 600 ou a vida inteira; gigante: 55 % da
  vida); em estruturas inimigas 160. Construída no topo de uma muralha, só opera quem está lá em cima (o operador fica
  ao lado, onde há piso); a pedra sai da altura da muralha. Braço de torção batendo na trava acolchoada.
- **Aríete** (empurrado): E pega / solta (até 4 pessoas). Setas / WASD / direcional empurram: **1 pessoa: 0,3
  tile/s** (bem devagar), **2: 0,95**, 3: 1,1, 4+: 1,25 (de lado: ×0,6). Encostado num portão, Espaço (ou o botão de
  ataque) dá a pancada: **220 por pancada só em portões** (portão de madeira 900, de pedra 2400 — ou o `hp` / `siegeHp`
  do portão), intervalo 4 s sozinho / 2,2 s com 2 / 1,7 s com 4. Em qualquer outra coisa: nada ("O aríete só quebra
  portões"). Cabeça de carneiro de ferro balançando nas correntes, rodas girando.
- **Torre de cerco** (empurrada): mesma regra de empurrar (1: 0,2 · 2: 0,75 · 3: 0,9 · 4: 1 tile/s). Planejada **de
  frente para uma muralha**, sai da altura dela; longe de muralhas escolha 1–3 andares (T / botão "Andares"). Empurrada
  até encostar numa muralha **da mesma altura**, a rampa desce sozinha (1,2 s) no topo da muralha; aí o deck vira piso
  do andar (levels.js) e quem está atrás usa "Subir na torre" (E: sobe a escada de trás, 0,55 s por andar) e atravessa
  a rampa para o topo da muralha. Lá em cima: "Descer da torre". Muralha de outra altura: "Esta muralha tem N andares; a
  torre tem M". Empurrar para longe sobe a rampa (nunca com gente no deck).

Todas: a primeira vez que se usa cada máquina aparece uma dica; a faixa no alto da tela diz o que está acontecendo
(alvo, dispersão, quantas pessoas empurram e a velocidade, portão à frente, rampa); a ajuda (H) tem a seção "Máquinas
de cerco". Podem ser destruídas (dano de cerco de máquinas inimigas — fase 3 — e os andarilhos / gigantes quebram as
que estão no caminho, como paredes); o dano de máquina de cerco (`o.sdmg`) **não some ao amanhecer** (só o dos
andarilhos some) e vai no save.

### Para a fase 3

- **`siegeCanDamage(game, attacker, target)`** (`game/siege.js`, o único lugar): `attacker` = a máquina (ou
  `{ realm }`), `target` = estrutura, caixote de acampamento ou criatura / jogador. Hoje: jogadores **nunca**; estruturas
  de jogadores **nunca**; estruturas com reino (`o.realm` / `o.kingdom` / `o.settle` — o gerador de reinos deve marcar
  assim, ou ajustar `realmOf`) só quando `game.realms.atWar(reinoDoAtacante, reinoDoAlvo)` existir e disser que sim;
  monstros, bandidos, criaturas selvagens e caixotes de acampamento: sim; animais da fazenda, cavalos e pets: não.
  Testes / depuração: `siegeDebug(game).hostile` (ids tratados como inimigos) e `.gates` (ids tratados como portões).
- **Portões**: o aríete acerta `BUILDINGS[type].gate` (os portões de madeira / pedra do agente dos reinos). Vida de
  cerco: `def.siegeHp` / `def.hp`, senão 900 (madeira) / 2400 (pedra).
- **`towerStoriesFor(game, alvo)`**: altura (andares) que a torre precisa para pôr a rampa no topo de uma muralha:
  aceita uma peça de muralha / portão, um tile `[tx, ty]` / `{tx, ty}` ou uma lista (a mais alta); 0 = não é muralha.
  `wallTopStory(game, tx, ty)` mede um tile; `towerAhead(game, tx, ty, rot)` acha a muralha à frente de uma torre. A IA
  do cerco planeja a torre com `o.v = towerStoriesFor(...)` (intent `build.place` com `n`, ou `struct.add` com v).
- Dano de cerco persistente: op `siege.dmg` (rachaduras em todos, `o.sdmg`, linhas `sdmg` no snapshot / save) — serve
  para muralhas e portões dos reinos.
- Limite: a torre tem no máximo 3 andares porque uma muralha tem no máximo 3 (`levels.js MAX_LV`); o pedido falava em
  "1–4": com muralhas de 4 andares basta subir `MAX_LV`.

### Multijogador

Anfitrião autoritativo. Intents: `siege.use` (operar / sair), `siege.aim` (direção e distância, ~6×/s enquanto
gira), `siege.fire` (a pedra sai da mochila, devolvida se recusado; o anfitrião confere a recarga e sorteia a
dispersão com `net.roll`), `siege.push` (pegar / soltar), `siege.drive` (para onde cada um empurra), `siege.ram`.
Ops: `siege.set` (operador, mira, distância, quem empurra, rampa), `siege.shot` (todos balançam o braço e voam a mesma
pedra; a cópia do anfitrião resolve o impacto: dano em criaturas pelo fluxo de entidades, em estruturas por
`siege.dmg` / `struct.remove`), `siege.step` (a máquina anda um tile: `relocateStructure`; o modelo desliza até lá em
todos), `siege.swing` (a pancada), `siege.dmg`. Mensagem ao dono: `siege.msg` (bloqueado, altura errada…). Snapshot:
`sieg` (mira, distância, operador e quem empurra — não vão para o save —, rampa) e `sdmg`.

### Testes e prints

`tools/mp-test.js` SG1–SG6: SG1 o convidado constrói a oficina e as quatro máquinas com obra (o anfitrião concorda) ·
SG2 trabuco: dispersão dentro da elipse, estrutura inimiga muito mais ferida que a criatura, parede do jogador
intacta, recarga recusada e devolvida, segundo tiro no mesmo alvo com dispersão ×0,8 · SG3 catapulta no topo da
muralha: cada criatura na área leva exatamente o dano da balista · SG4 aríete: sozinho ~3 s por tile, com dois ~1 s,
para na muralha, 5 pancadas quebram o portão e a parede ao lado fica intacta · SG5 torre: mede muralhas de 2 e 3
andares, sai com 2 e 3 andares, dois empurram, rampa desce, o convidado sobe e anda no topo da muralha · SG6 nunca
fere estruturas de jogadores (gancho e uma pedra de catapulta nas paredes do próprio convidado).
Prints em `shots/sg_*.png` (não vão para o git).

## 9. Implementação — geração (fase 1)

O que já está no jogo: os reinos, os territórios, as vilas / castelos / cidades feitos de estruturas de verdade, as
muralhas, os portões, as estradas, o mural e o mapa. Ainda **sem moradores, guardas, comércio, trabalhos** (fase 2): as
abas do mural que dependem deles dizem "Em breve". (Fase 2: o comércio, os trabalhos e as propriedades estão no §10.)

### O reino na semente (`src/world/realm/`)

- `realm.js` `generateRealm(planet)` — roda dentro de `generatePlanet` (`planet.realm`, ~150–210 ms) e vai junto com o
  planeta para os workers. Só hashes e aritmética (+ − × ÷ √), nada de `Math.random` / trigonometria: anfitrião e
  convidado fazem o mesmo reino (`realmDigest`). Na prática: 16–20 reinos por semente (até 30), 1 cidade (capital),
  2–4 castelos e 8–20 vilas cada; 5–6 massas de terra; ~280–400 estradas. Exemplo (semente 4242): 16 reinos, 16
  cidades, 47 castelos, 179 vilas.
  - Capitais em terra habitável e afastadas entre si; o território cresce a partir delas (raio ~17 células de 32
    tiles) e deixa **terra livre** entre os reinos. `owner` (reino + 1 por célula), `district` (o lugar dono de cada
    célula), `kingdomAt / districtAt / settlementAt / nearSettlement`, `canReach(a, b)` (mesma massa de terra: só esses
    reinos vão interagir).
  - Assentamento: `{ id, k, kind, name, x, y, r (terra da vila), ro (anel de fora: campos, currais), pop, walls,
    exits, roads }` — vila r 27 / pop ~50, castelo r 18 / ~30, cidade r 56 / ~200.
  - Estradas: A* sobre as células (reaproveita trechos já feitos), suavizadas, ligando os lugares do reino e os reinos
    vizinhos alcançáveis; vau nos rios (pontes: depois).
  - `names.js`: nomes inventados com sabor português (lista de lugares reais proibidos), 30 cores, brasão (`makeBanner`:
    campo, metal, partição, figura).
- `layout.js` `settlementLayout(planet, realm, sid)` — a planta de um lugar, pura da semente: ruas, lotes, casas
  prontas (`prefabs.js`: casas de vários tamanhos, casa de fazenda, ferraria, serraria, celeiro, taverna, tecelão,
  capela, quartel, posto de guarda, estábulo, mina, armazém, torre de menagem com andar de cima), praça com o mural,
  poço / chafariz, campos com plantações, currais com animais, muralhas (paliçada de toras de 1 andar com escadas de
  madeira por dentro — ao lado de cada portão e no meio dos lados sem portão — e o alto caminhável; pedra de 2 andares
  com ameias, torres 3 × 3, escadas para o adarve, portões nas estradas), balistas nas torres da cidade.
  Saída: `structs [[tipo, tx, ty, rot, andar, estilo, det]]` (vila ~1,1–1,7 mil peças, castelo ~1,1 mil, cidade ~7,8
  mil), `buildings`, `gates`, `mural`, `pens`, `fields`, `spawn`, a grade do chão e os **ganchos da fase 2**
  (`hooks.homes` camas por casa, `work` locais de trabalho, `guards`, `patrol`, `archers`, `artillery`).
- `ground.js` `applyRealm` — no worker de chunk: aplaina os lotes e a praça (cantos com altura-alvo), seca e limpa a
  terra da vila, pavimenta ruas e estradas (camada `road`, desenhada por `paths.js`), planta os campos.

### No jogo (`src/game/towns.js`, `src/game/mut/towns.js`)

- **Materialização por chunk** (como os acampamentos): quando um chunk carrega, as peças ancoradas nele viram
  estruturas com id `t<sid>.<k>` e `o.town = sid`, sem sujar o chunk (voltam com ele). Feito em fatias do quadro (3 ms;
  12 ms nos 3 × 3 chunks em volta do jogador), os chunks mais perto primeiro; na carga do mundo a vila do início já vem
  pronta (atrás da tela de carregamento). A âncora de uma peça é o ponto onde o mundo a guarda (o meio da borda sul do
  seu pé: uma peça na última linha de um chunk fica no chunk de baixo) e ela só é feita com todos os chunks sob o pé
  carregados (senão espera por eles: `T.wait`) — fase 2, abaixo. `game.towns.ready(sid)`: o lugar está todo feito aqui.
- A **planta** vem pronta do worker de chunk (que já a calcula para o chão): `packLayout` / `adoptLayout` — a thread
  principal não planeja uma cidade no meio de um quadro (eram 25–55 ms).
- **Estado compartilhado**: o que muda numa peça (removida, portão aberto / fechado, dano de cerco) vai pelas ops
  genéricas (`struct.remove`, `door.set`, `struct.dmg`) e fica em `game.towns.state` (linhas `towns` no snapshot /
  save / diff de chunk, parte `towns` do digest), mesmo para uma peça que aquele par ainda não fez. O lugar se refaz 2
  dias depois, sem ninguém a menos de 40 tiles (`town.restore`). Os baús / camas / comedouros dos lugares estão
  desligados (fase 2).
- **Portões**: "Portão de madeira" e "Portão de pedra" (2 tiles, `gate: true`: o alvo do aríete). Os dos lugares abrem
  de dia e fecham à noite ou com inimigo dentro (anfitrião); os do jogador: o dono abre / fecha ou deixa no
  "Automático".
- **Animais dos lugares**: nos currais, da vila (não dos jogadores: nem amarrar, nem criar), surgem aos poucos.
- **Regra de construção**: dentro da terra de uma vila / cidade — "Terra de <Vila>: compre um terreno no mural"; no
  castelo — "<Castelo>: não se constrói no castelo"; as peças de um lugar não se desmontam ("Isto pertence a …"); fora
  dos territórios, livre (o modo criativo ignora a regra). Fase 2 (§10): dentro de um terreno comprado pelo jogador, pode.
- **Nível do povo** (fase 2, §7b): `realmNpcLevel(game, s)` / `game.towns.npcLevel(sid)` — a distância ao início dá o
  `baseLevel` (nunca guardado); o povo acompanha o jogador mais avançado até o nível dos lugares mais distantes.

### O início do mundo

Um mundo novo começa **na praça de uma vila de zona temperada, em frente ao mural** (`planetSource.js`
`villageSpawn`): `realm.starts` lista as vilas no fundo da zona temperada (3 × 3 células temperadas, com folga de
1 °C), a melhor primeiro; se uma semente não tiver nenhuma, o gerador cria uma. O ponto é `layout.spawn` (2,6 tiles ao
sul do mural, na praça plana, fora de parede e de ladeira); renascer usa o mesmo `world.spawn`. Acampamentos de
bandidos ficam a 60+ tiles dos lugares. O mural chama a atenção: quadro grande com telhado, estandartes nas cores do
reino, canteiros de flores, lanterna acesa à noite, um "!" dourado balançando até o jogador abrir um mural pela
primeira vez e a dica "Veja o mural (E)".

### Mural, HUD e mapa

- Mural (`ui/mural.js`): nome, tipo, reino, brasão, população (todo número com rótulo); abas Lugar · Reino ·
  Trabalhos · Comércio · Exército · Propriedades (fase 2, §10: Trabalhos, Comércio e Propriedades prontos; Exército
  "Em breve").
- Ao entrar num lugar: a faixa "Reino de X — Vila Y" (`ui/placebanner.js`).
- Mapa (`ui/realmMap.js`, dos dados do reino — não da camada de chunks): territórios nas cores dos reinos (clareadas
  para ler sobre o planeta) com a linha de borda, estradas, ícones e nomes por importância — de longe a cor cheia, os
  nomes dos reinos com o brasão e as capitais; de perto só a borda e um tom leve (igual na terra explorada e no resto),
  castelos e vilas com a terra de cada vila em tracejado. O radar mostra as bordas, as estradas e os lugares em volta.

### Desempenho (Chrome headless, 1280 × 720; CPU por quadro: render + update; GPU)

| Onde | render | update | GPU | sprites |
|---|---|---|---|---|
| campo (início antigo) | 0,7 ms | 0,6 ms | 1,1 ms | 600 |
| vila (início) | 1,1 ms | 0,6 ms | 1,6 ms | 1 500 |
| castelo | 1,5 ms | 0,6 ms | 1,8 ms | 1 570 |
| cidade (praça) | 2,2 ms | 1,4 ms | 2,8 ms | 2 900 |

Primeiros 7 s na vila do início: p95 5,8 ms, pior quadro ~20 ms. O que foi feito para isso: telhados pintados só perto
da vista e soltos longe; objetos sob telhado fechado fora da ordenação; plantas feitas no worker; animais e peças em
fatias do quadro; calor das fogueiras por vizinhança (não varre as ~20 mil peças de uma cidade); o laço das marcas de
construção pula as peças dos lugares.

### Testes e prints

- `tools/mp-test.js` KG1–KG7 (`?run=KG1,…`): o mesmo reino nos dois pares e o início na praça; vila / castelo /
  cidade com muralhas, portões, praça e mural (as mesmas peças nos dois); portões fecham à noite e abrem de dia; portão
  do jogador (dono / automático); dano de cerco compartilhado, que sobrevive ao chunk sair e voltar, vai no save, e o
  lugar se refaz; a regra de construção; o painel do mural. Os cenários antigos começam no início clássico
  (`OLD_START`, `tools/mp-test/pair.js`).
- Prints: `shots/kg_village_day_a/b`, `kg_village_night_a/b`, `kg_village_walled`, `kg_castle_1/2`, `kg_city_1`,
  `kg_city_castle`, `kg_city_walls`, `kg_gate_wood_open/closed`, `kg_gate_stone_open/closed`, `kg_mural_panel`,
  `kg_mural_realm`, `kg_mural_soon`, `kg_spawn_1/2`, `kg_map_world`, `kg_map_far`, `kg_map_mid`, `kg_map_near`.

### Decisões

- Só vaus nos rios por enquanto (pontes depois). Os lugares ficam sempre em terra firme e habitável.
- O dano de cerco fica até alguém consertar; sem moradores ainda, os andarilhos de dia limpam o dano (fase 2: os
  guardas consertam).
- Baús, camas e comedouros dos lugares não são usáveis (fase 2: propriedades, trabalho). **Fase 2:** os baús e as camas
  de uma casa comprada / alugada são de quem mora nela (ver "Fase 2 — economia"); os comedouros continuam do lugar.
- O castelo não vende terreno; a cidade e a vila vendem pelo mural (fase 2: aba Propriedades).

## 10. Fase 2 — economia

O dinheiro, o comércio, os trabalhos, a reputação, o reino / viajante, as casas, os terrenos e o imposto (§3, §6, §7).
Código: `game/content/eco.js` (números), `game/eco.js` (o modelo, o dia do mercado no anfitrião, o quadro de trabalhos,
casas e terrenos, a API `game.eco.api`), `game/mut/eco.js` (intents / ops), `ui/muralEco.js` (as abas do mural),
`ui/ecoHud.js` (bolsa, rastreador, waypoint, divisas dos terrenos, avisos). Ganchos de uma linha em `towns.js`
(regra do terreno, baú da casa, porta da casa), `mut/structures.js` (`chestOf`, `chest.set`, `placeReason` passa o
construtor), `building.js` (baú / cama da casa), `player.js` (renascer na cama da casa), `net/net.js` (o anfitrião vê
as ações para o progresso dos trabalhos), `net/snapshot.js` / `net/digest.js` (parte `eco`), `net/interest.js` (o baú
de uma casa é global), `ui/mural.js`, `ui/panels.js` (Dar a outro jogador), `ui/radar.js` / `ui/minimap.js` (waypoint),
`ui/help.js`, `art/items.js` (ícones da moeda e da encomenda).

### Como se joga

- **Moeda de ouro** (`coin`): item da mochila (pilha de 9 999), cai ao morrer como qualquer item, dá para largar e **dar**
  a outro jogador (Mochila → selecione → "Dar 10 a Fulano" / "Dar tudo a Fulano", até 4 passos). A **bolsa** no HUD (em
  cima, à esquerda, debaixo do retrato) mostra o total da mochila e um "+42" / "−12" a cada mudança; toque nela abre a
  mochila.
- **Comerciante**: abra o mural (E / toque) → **Comércio**. A lista tem estoque, preço de compra, de venda e quanto você
  tem; em cima, "Barato aqui: …" e "Vende bem aqui: …" (comparado à média da mesma terra) e as notícias ("Falta de
  trigo em …", "Sobra de lã em …"). Toque numa mercadoria: a quantidade (− / + / 1 · 5 · 10 · 25 · "pode comprar até N" ·
  "vender tudo"), os botões **Comprar N** e **Vender N** com o total, quanto sai cada um e o preço depois (+% / −%), e
  "Vende melhor em: <lugar> <preço> (N passos a leste)" / "Mais barato em: …". Ao lado, a sua mochila com quanto este
  mercado paga por cada coisa (toque = seleciona). O laço: compre onde é barato (a vila que produz), leve, venda onde
  falta (a cidade que consome, o castelo que compra comida e armas); cada unidade muda o preço (retorno decrescente), o
  mercado volta ao normal em alguns dias.
- **Trabalhador**: mural → **Trabalhos**: o quadro do dia do lugar (novos pedidos a cada amanhecer), cada um com quem
  pede (nome e ofício), o pedido, o pagamento, a reputação e o prazo. "Aceitar" (até 3 ao mesmo tempo) → o
  **rastreador** do HUD mostra o trabalho, o progresso e para onde ir (distância e seta; toque = seguir: waypoint
  dourado no radar, no mapa e no mundo). Feito o trabalho, "Pronto!" → volte ao mural e "Entregar" (coisas pedidas e
  encomendas saem da mochila). Abandonar custa reputação.
- **Propriedades**: mural → **Propriedades**: as suas (de qualquer lugar: o que custa por dia, a dívida e os dias de
  aviso, "Pagar", "Ver", "Vender" / "Devolver"), casas à venda, casas para alugar e terrenos. "Ver" fecha o mural e põe o
  waypoint na porta da casa / no meio do terreno, e desenha as **divisas dos terrenos** no chão por um tempo (dourado
  tracejado = à venda, verde-água = seu, cinza = de outro). Comprar uma casa: as portas, os baús e as camas dela passam a
  ser seus (só você abre; "Renascer aqui"). Comprar um terreno: dentro da terra da vila / cidade só se constrói num
  terreno seu — dentro da divisa pode, ao lado não ("Terra de <Vila>: compre um terreno no mural", "Terreno de
  <nome>", "Passa da divisa do terreno"). No modo construir, dentro da vila, as divisas aparecem sozinhas.
- **Reino**: a aba Reino abre com o cartão "Você e <reino>": viajante ou membro, a reputação (faixa e barra até a
  próxima), o imposto do reino, o que significa ser membro, e o botão **Entrar no Reino de …** / **Sair do reino** (a
  qualquer momento, em qualquer mural daquele reino; sair vale de qualquer mural). Sem reino você é **viajante**: comercia
  e trabalha com todos. Membro: comercia com o próprio reino e com os reinos da mesma terra que não estão em guerra com
  ele (§3: reinos de outra terra não interagem; a guerra é da fase 3: `game.realms.atWar`); os benefícios (exército,
  ordens) chegam na fase 3 — o cartão diz isso.

### O mercado (oferta e procura)

- 39 mercadorias (`GOODS`): comida (trigo 8, batata 6, milho 6, carne 12, peixe 10, pão 22, ensopado 55), matérias-primas
  (madeira 6, pedra 5, algodão 9, lã 12, couro 24, erva 14, carvão 12), minérios (cobre 14, ferro 22, ouro 60, jade 140),
  ofícios (corda 12, tecido 34, bloco de pedra 14, barras: cobre 40, ferro 64, aço 120, ouro 180), armas e ferramentas
  (flecha 3, machado / picareta de ferro 160, espada 260, lança 200, arco 70, escudo 220, armaduras de couro 140 / de
  ferro 420, elmo 200, sela 120) e roupas (casaco de pele 150, gorro de pele 60, túnica 80). Preço = base × fator.
- **Fator** (só + − × ÷: igual em todos os pares): `0,3 + 0,7·(R + K)/(S + K)`, `K = max(2, R/4)`, entre 0,3 e 3,2 —
  S o estoque, R a procura (estoque de referência: o volume da mercadoria × população/50; castelo ×1,2; celeiro ×1,3 na
  comida; armazém ×1,2). Comprar paga ×(1,05 − desconto); vender recebe ×(0,85 + desconto). Cada unidade é cobrada pelo
  estoque daquele momento (retorno decrescente). O mercado não aceita mais que 4×R.
- **Perfil de cada lugar** (`profileOf`): produção / consumo por mercadoria a partir do que o lugar tem — campos (trigo,
  batata, milho, algodão), currais (ovelha: lã e carne; vaca: carne e couro; porco; galinha), serraria (madeira),
  ferraria (barras, machados, picaretas, flechas; consome carvão e minério), mina (pedra, cobre, ferro, carvão; ouro e
  jade em algumas), tecelagem (tecido, corda, túnica; consome algodão e lã), taverna (pão, ensopado; consome trigo,
  carne, batata), capela (ervas), estábulo (selas, couro), quartel (consome comida e armas), torre de menagem (consome
  ouro, jade, tecido, aço). Cidade: come muito (×2,2) e consome matérias-primas; produz os ofícios, armas e roupas.
  Castelo: compra comida (×2), armas, ferro, couro, pedra. Clima frio: peles e lenha procuradas; quente: algodão. As
  peças vêm da planta do lugar quando o anfitrião a conhece (op `eco.feat`, replicada: todos precificam igual); antes
  disso, das mesmas chances do planejador.
- **Dia do mercado** (anfitrião, 06:00 de cada dia, ~3 ms para os ~240 lugares): o estoque anda 14 % do caminho até o
  ponto de equilíbrio `R × (1 + 0,8·produção)/(1 + 0,8·consumo)` (entre 0,32 e 2,6) × estação × notícias, ±4 % de R de
  ruído; e se espalha devagar (5 % da diferença de estoque/procura por dia) para os 4 vizinhos mais próximos a até
  1 400 passos **da mesma massa de terra** — nunca pelo mar. O resultado vai inteiro no op `eco.day` (~30 KB por dia).
- **Estações**: comida de lavoura no inverno: procura ×1,45 e oferta ×0,5 (outono: ×0,85 / ×1,35; primavera ×1,1 /
  ×0,85); carne e peixe no inverno ×1,2; peles no inverno ×1,8 (outono ×1,3, verão ×0,7); lenha no inverno ×1,3. Polar:
  comida sempre cara; trópicos: a estação seca encarece; inverno ameno, pouco. Medido (Estrosa / Alvalelar, semente
  4242): trigo 6,6 → 9,7 do outono para o inverno na vila (+47 %), 11,4 → 16,5 na capital.
- **Notícias**: 2 por dia em qualquer lugar + 1 perto de cada jogador (até 900 passos): sobra (×0,45) ou falta (×2,1) de
  uma mercadoria por 3–5 dias; o Comércio mostra as da mesma terra.
- **Margens medidas** (reino de Galéria, semente 4242, lugares a até 700 passos, sem desconto): lã de Montedo (vila) para
  Alvalelar (capital), 40 un.: custa 356, vende por 642 (**+286, 80 %**, 430 passos); milho Galerna → Alvalelar +149
  (68 %); trigo Ardival → Alvalelar +129 (44 %); barras de ferro Alvalelar → Torre de Cerverna (castelo) +156 (38 %,
  10 un.); pão +91, tecido +66, flechas +41 (41 %). Comprar demais na mesma vila sobe o preço (40 de lã ~9 → ~10,5 cada);
  vender demais derruba. Um comerciante com ~1 000 moedas faz ~150–300 por viagem de 2–4 minutos.

### Trabalhos

O quadro de cada lugar é determinístico (lugar + o dia da economia, que vira no amanhecer do anfitrião, e só a planta do
lugar: anfitrião e convidado veem o mesmo; o anfitrião confere ao
aceitar). Vila 5, cidade 6, castelo 3 pedidos por dia, dos tipos que o lugar tem. O anfitrião vê as ações (`net.js` →
`eco.onOp`, antes de aplicar a op) e manda o progresso (`eco.prog`).

| Tipo | Quando aparece | Pedido | Pagamento | Reputação | Prazo |
|---|---|---|---|---|---|
| Colheita | o lugar tem campos | colher 6–12 pés da lavoura pedida **nos campos do lugar** | 6·N + 12 | +4 | 2 dias |
| Mina | tem mina | 8–15 blocos de rocha / pedregulhos perto (terra externa + 60) | 5·N + 18 | +5 | 2 dias |
| Lenha | vila / castelo / cidade com serraria | derrubar 4–7 árvores nos arredores | 10·N + 12 | +4 | 2 dias |
| Encomenda | sempre | trazer N de algo que o lugar consome e não produz (~150–270 moedas de valor) | valor × 1,45 + 10 | +4 | 2 dias |
| Entrega | sempre (destino na mesma terra, 120–1 500 passos, do reino ou vizinho) | levar 1–3 **encomendas** (item) ao mural do destino | 20 + 0,09·distância + 8 por encomenda | +6 / +8 / +10 | 3 dias |
| Caça | sempre | caçar 3–5 animais selvagens (qualquer lugar) | 18·N + 10 | +5 | 2 dias |
| Defesa | só nas noites perigosas do lugar (inverno; inverno ameno / estação seca) | derrotar 4–8 mortos da noite perto da vila | 15·N + 40 | +10 | até amanhã |

Na cidade, colheita, mina, lenha e caça pagam ×1,3. Até 3 trabalhos ao mesmo tempo; abandonar: −3 de reputação (a
entrega devolve as encomendas); vencer o prazo: −2. Os nomes de quem pede vêm de `game.towns.people(sid)` quando o
agente dos moradores o expuser; senão, de uma lista de nomes (Bento, o lavrador; Dulce, curtidor; Helena, mercador…).

### Reputação

| Faixa | Pontos | Nas trocas | |
|---|---|---|---|
| Desconhecido | 0 | — | |
| Conhecido | 25 | 1 % melhor | pode comprar casas e terrenos |
| Respeitado | 100 | 2 % | |
| Honrado | 300 | 3 % | |
| Herói do Reino | 700 | 5 % | |

Por reino e por jogador. Sobe com trabalhos (tabela acima) e com comércio naquele reino (1 ponto a cada 60 moedas
negociadas, até 10 por dia por reino); cai ao abandonar (−3) ou perder (−2) trabalhos e quando o reino toma uma
propriedade (−15). Subir / descer de faixa: aviso no alto da tela ("Reputação: Conhecido — no Reino de Galéria · trocas
1 % melhores · já pode comprar casas e terrenos"). O cartão da aba Reino mostra a faixa, a barra e a reputação nos outros
reinos.

### Propriedades e imposto

- **Casas** (da planta: as moradias com cama): vila — 2 à venda e 1 para alugar; cidade — 4 e 3; castelo — nada
  ("O castelo não vende nada: é uma fortaleza"). Preços: casa pequena 700, casa pequena de taipa 750, casa de pedra
  pequena 900, casa 1 100, casa de pedra 1 300, casa de fazenda 1 400, casa grande 1 500, sobrado 1 900; na cidade
  ×1,6. Aluguel: 2 % do preço por dia (casa pequena 14). Vender ao reino: 60 % do preço, menos a dívida.
- **Terrenos**: quadrados livres dentro da terra do lugar (nenhuma peça, rua, praça, campo ou curral; 1 tile das
  construções): primeiro 8 × 8 (vila 400, cidade 900), depois 6 × 6 no que sobra (230 / 510); até 6 na vila e 10 na cidade
  (a vila do início, Estrosa, tem 3 + 3).
- Comprar exige ser **Conhecido** no reino; alugar não exige nada.
- **Imposto**: cada reino tem o seu, de 1,0 % a 2,4 % do valor por dia (Galéria: 1,9 % → casa pequena 13 / dia, terreno
  8 / dia); quem aluga paga o aluguel e não o imposto. **Cobrado automaticamente** a cada amanhecer (o dia do mercado),
  **só das moedas da mochila** (moedas guardadas em baús não contam: é a bolsa de quem está andando), das dívidas menores
  para as maiores (salva o máximo de propriedades), com o aviso "Imposto e aluguel pagos: −N moedas". Sem moedas
  bastantes: a dívida fica, aviso "Imposto atrasado: N moedas — 3 dias para pagar (mural · Propriedades), ou o Reino de X
  toma a casa pequena em Y"; no dia seguinte "2 dias", depois "Último dia!"; no quarto amanhecer sem pagar o reino toma a
  propriedade ("Sua casa foi tomada…"), −15 de reputação, e o que estava nos baús fica para o reino. "Pagar" na aba
  Propriedades quita a dívida a qualquer hora. Só paga quem está no mundo naquele amanhecer: um jogador ausente não
  acumula dias.

### Multijogador e saves

- Tudo é do anfitrião (§7): ops `eco.start` (os primeiros estoques) · `eco.day` (os estoques e as notícias do dia) ·
  `eco.feat` · `eco.who` · `eco.trade` · `eco.member` · `eco.job` · `eco.prog` · `eco.prop` · `eco.bill` · `eco.paid` ·
  `eco.gift`; intents `eco.hello` · `trade.buy` · `trade.sell` · `realm.join` · `realm.leave` · `job.take` · `job.done` ·
  `job.drop` · `prop.buy` · `prop.rent` · `prop.leave` · `eco.pay` · `item.give`; mensagem ao dono `eco.collect` (a conta
  do dia). As moedas são do dono (mochila): o cliente tira as moedas / mercadorias e manda como pagamento da intent
  (devolvidas se o anfitrião recusar); o anfitrião confere preço, estoque, lugar (até 8 passos do mural) e reino, e
  responde com a op cujo `give` entrega mercadoria / moedas.
- **Por jogador**: reputação, reino, trabalhos e propriedades ficam num registro por **uid** — um id do navegador
  (`localStorage wos.uid`; nos testes, `u` + `?pid`), mandado ao anfitrião (`eco.hello`) — e não pelo pid da sessão (que
  muda a cada aba aberta): o amigo volta outro dia e a casa continua dele. Duas abas do mesmo navegador viram dois
  jogadores (o anfitrião dá outro uid à segunda).
- Estado replicado em `game.eco` (`mk`, `ev`, `pl`, `pr`, `st` = conteúdo dos baús das casas, `feat`, `day`): snapshot /
  save `world.eco`, parte `eco` do digest (exata). O baú de uma casa vale em todos os pares, carregado ou não (o
  `chest.set` dele é global para o interesse).
- Save: o mundo do anfitrião leva tudo (os registros dos convidados também); o save do convidado continua só com o
  jogador dele (mochila: as moedas).

### Testes e prints

`tools/mp-test.js` **EC1–EC8** (`?run=EC1,…`): EC1 o convidado compra e vende na feira da vila pela tela (estoque, preço
e moedas mudam nos dois; a bolsa do HUD); EC2 vila agrícola × capital (trigo mais barato na vila; barras de ferro e
espadas mais baratas na cidade que no castelo), comprar 20 na cidade sobe o preço, longe do mural recusa; EC3 colheita:
aceita no mural, colhe nos campos da vila, o anfitrião conta, "Pronto" no rastreador, entrega, paga, reputação sobe nos
dois; EC4 entrega para um lugar alcançável por terra (encomendas na mochila, recusada na origem, paga no destino); EC5
casa (recusa sem reputação; compra; o baú abre para o dono e não para o outro; a porta recusa o outro) e terreno (muro
dentro pode, ao lado não); EC6 imposto (pago da mochila com aviso; sem moedas: dívida, avisos de 3 / 2 / último dia; no
quarto dia o reino toma; −15); EC7 entrar / sair do reino pela aba Reino; membro recusado em reino de outra terra,
viajante compra; EC8 o save (JSON) carregado num jogo novo dá a mesma economia (linhas do digest iguais) e os mesmos
preços. Todos terminam com o digest igual. KG7 passou a conferir as abas novas (só Exército diz "Em breve").

Prints em `shots/` (fora do git): `ec_trade_desktop`, `ec_jobs_desktop`, `ec_land_desktop`, `ec_realm_desktop`,
`ec_trade_phone`, `ec_jobs_phone`, `ec_land_phone`, `ec_realm_phone` (915 × 412, toque), `ec_*_portrait` (430 × 932),
`ec_tracker_hud`, `ec_tracker_phone`, `ec_tax_notice`, `ec_tax_paid`, `ec_plots_world`.

### Decisões (para o dono confirmar)

- O imposto sai **só das moedas da mochila** (as dos baús não contam) e só nos dias em que o dono está no mundo.
- Comprar casa ou terreno pede reputação **Conhecido** (25) no reino; alugar não pede nada.
- Casa vendida, devolvida ou tomada: os baús dela são esvaziados (ficam para o reino). Terreno tomado: o que o jogador
  construiu nele fica de pé (é estrutura dele; o próximo dono do terreno fica com o lugar como está).
- Membro de um reino só negocia com reinos da mesma terra (e, na fase 3, que não estejam em guerra com o seu); viajante
  com todos. Ser membro ainda não dá vantagem (fase 3: exército) — o cartão explica.
- As casas à venda / para alugar saem das moradias da planta; para o agente dos moradores: `game.eco.api.props(sid)`
  lista quais são, e `game.eco.pr` diz quem mora nelas — morador nenhum deveria dormir numa casa comprada.
- Pendente / ideias: caravanas de verdade no mapa (hoje o espalhar de preços é abstrato), o ouro dos mercados (hoje
  infinito), mais tipos de trabalho quando houver moradores (escoltar, guarda), o imposto pago do baú da própria casa.

- O castelo não vende terreno; a cidade e a vila venderão pelo mural (fase 2).

## 9b. Fase 2 — correções e desempenho

Os três apontamentos do dono depois da fase 1 (§8): portas bloqueadas, paliçadas sem escada, queda de frames. É a base
para os moradores e guardas (eles andam até a cama e sobem nas muralhas).

### Entradas das casas

- Em seis casas prontas o móvel ficava no tile logo atrás da porta: a mesa em `house_s`, `house_s2` e `cottage_stone`,
  a cadeira em `house_stone`, o varal na tecelagem, o cabide de armas no posto da guarda. Corrigido nos dados
  (`prefabs.js`): mesinha redonda no canto da casa pequena, mesa / cadeira para o lado, o varal na parede oeste, um
  suporte de armadura no posto (o cabide foi para o quintal, ao lado do braseiro). **Regra** para quem desenhar uma casa:
  o tile de dentro da porta é `.` (ou algo que não bloqueia: tocha, tapete) e todo móvel que se usa (cama, bancada, baú)
  tem um tile livre ao lado que se alcança da porta.
- **Validador** `tools/mp-test/towncheck.js` (cenário FX1), com o caminho e a colisão do próprio jogo (`nav.walkable`,
  `levels.findPath`; as portas abertas como um morador as abre):
  - `checkLayout(L)` — a planta de **todos** os lugares de uma semente (~240, ~1 s): nenhuma peça da planta dentro ou
    fora de uma porta; todo posto de arqueiro em cima de uma muralha.
  - `checkPrefabs` — cada casa pronta × 4 rotações feita de verdade num chão livre: porta livre dos dois lados e caminho
    da soleira até um tile livre ao lado de cada cama, local de trabalho e baú (as camas de cima da torre de menagem pela
    escada).
  - `checkTown(sid)` — um lugar feito no mundo: o mesmo para cada prédio, mais o caminho da praça até cada porta, até a
    frente do mural e, pelas escadas, até cada posto de arqueiro do adarve.
  - Resultado (sementes 4242 e 5553: 466 plantas, 80 casas × rotações, a vila do início, o castelo e a capital, a vila
    com paliçada mais perto): **zero problemas**. Antes: 24 das 80 casas × rotações e os 8 prédios da vila do início com a
    porta bloqueada; na capital, 91 de 107.
- Uma linha antiga do estado dos lugares (de um save anterior a uma mudança da planta, que muda os índices das peças) só
  vale para a peça do mesmo tile (`towns.js stateOf`, `mut/towns.js rowOf`). `game.towns.ready(sid)`: o lugar está todo
  feito neste par.

### Paliçadas e muralhas que se sobem

- **Paliçada**: o alto das toras e dos portões é o andar 1 (topo de parede = chão do andar de cima, `levels.js`).
  `layout.js palisadeStairs` põe escadas de madeira por dentro, subindo reto até a paliçada: uma ao lado de cada portão
  (2–6 tiles dele, fora da rua) e uma no meio de cada lado reto sem portão (vila do início: 4); o pé da escada fica livre
  e o chão é aplainado na altura da muralha. O adarve dá a volta inteira. Postos de arqueiro (`hooks.archers`, andar 1)
  no alto de cada escada e na paliçada ao lado de cada portão.
- **Pedra** (castelos, cidades): já tinham escadas (`stairsUp`, até o adarve no andar 2). As torres são blocos 3 × 3 de
  alvenaria com o topo no andar 2 ligado ao adarve — entra-se nelas por cima (balistas, arqueiros). O validador confere
  que cada topo de torre e cada posto se alcança da praça.
- **Paliçada do jogador**: a Parede de madeira no estilo Toras já é a paliçada e o topo dela já é o andar 1; com uma
  Escada encostada por dentro vira adarve (docs/LEVELS.md §4.4). Decisão: nenhuma peça nova (a Cerca continua fina demais
  para andar em cima).

### Desempenho

Chrome headless deste PC (1280 × 720, GPU por software), o mesmo roteiro no código de antes (`main` 2b03950) e no novo,
alternados na mesma hora (outros agentes usavam a máquina; média de 2 rodadas cada). CPU da thread principal por quadro.

| Cenário (ms, antes → depois) | média | p95 | pior | > 16 ms | > 33 ms | update |
|---|---|---|---|---|---|---|
| **andando ~300 tiles pela estrada até a capital e através dela** (~90 s) | 4,97 → 2,88 | 8,2 → 4,8 | 104,5 → 46,8 | 292 → 25 | 14,5 → 1 | 2,46 → 1,27 |
| chegada ao castelo (teletransporte, 8 s) | 4,36 → 4,03 | 6,5 → 6,6 | 129,9 → 32,7 | 26,5 → 13 | 1,5 → 0,5 | 1,83 → 1,42 |
| chegada à cidade (teletransporte, 10 s) | 8,88 → 6,43 | 31,2 → 15,3 | 140 → 143 | 95,5 → 60,5 | 39 → 19,5 | 4,67 → 2,70 |
| parado na vila do início (20 s) | 3,28 → 2,18 | 5,3 → 3,0 | 27,8 → 7,5 | 2,5 → 0 | 0 | 1,27 → 0,81 |
| parado no castelo | 3,67 → 3,59 | 4,9 → 5,4 | 9,8 → 15,5 | 0 → 1 | 0 | 1,34 → 1,20 |
| parado na praça da cidade | 4,63 → 4,72 | 6,3 → 7,4 | 18,1 → 13,2 | 1 → 0 | 0 | 1,72 → 1,46 |
| girando a câmera na praça | 10,3 → 11,3 | 15,9 → 18,6 | 48,4 → 50,6 | 32,5 → 49 | 3 → 3,5 | 2,54 → 2,19 |
| noite na praça (muitas luzes) | 4,98 → 4,66 | 6,8 → 7,2 | 14,0 → 26,7 | 0,5 → 2,5 | 0 | 1,78 → 1,43 |
| mapa aberto | 4,94 → 3,97 | 6,6 → 5,4 | 19,4 → 9,5 | 0,5 → 0 | 0 | 1,83 → 1,29 |

GPU (consulta de tempo, praça da cidade): de dia 3,14 → 3,11 ms, à noite 2,41 → 2,47 ms — as quedas eram de CPU. No
código antigo, com a máquina carregada, a queda automática baixou a escala de render para 0,85–0,95 na chegada à cidade;
no novo ficou em 1. Girar a câmera e a noite são limitados pelo desenho (iguais, dentro do ruído). Numa hora mais calma
da máquina a mesma caminhada deu: pior quadro 102,8 → 21,4 ms, quadros > 16 ms 130 → 2, > 33 ms 12 → 0.

O que causava as quedas, e o que mudou:

- **Peça no chunk errado** (o pior): a fila de cada peça era a do chunk do seu tile, mas o mundo a guarda no chunk da
  âncora (`o.x, o.y` = meio da borda sul); uma peça na última linha de um chunk **gerava o chunk de baixo na thread
  principal** (40–80 ms) e, quando esse chunk saía antes, a peça ficava sem balde. Agora a fila é por chunk da âncora, a
  peça espera os chunks sob o pé (`T.wait`), o lote confere o prazo a cada peça e os chunks mais perto vêm primeiro.
- **Mapa dos andares refeito a cada quadro**: cada peça nova mudava `game.build.v` e `levels.rebuild()` percorria as ~18
  mil peças de uma cidade; agora `levels.addPiece` só soma as marcas da peça (o mesmo mapa); abrir / fechar uma porta do
  térreo não reconstrói nada (o topo dela é chão de qualquer jeito); a checagem de desabamento pula as peças dos lugares.
- **Varreduras de todas as estruturas a cada quadro** (balistas — três laços —, marcas de construção, luzes procuradas
  pelos monstros da noite, máquinas de cerco, plantas, apoio dos trapiches): eram ~20 % da CPU andando na cidade. Agora
  índices mantidos por `placeStructure` / `removeStructure` (`mut/structures.js`: `structsOfType`, `ownStructs`,
  `eachLight`).
- **Atlas de partes reempacotado** (`art/look/lazy.js`): crescer de 1024² reempacotava tudo e mandava a textura inteira
  (30–60 ms); o jogo começa em 2048 × 1024 e cresce antes de descartar partes.
- `nudgeOut` (empurrar quem está dentro de uma peça nova): a sobreposição antes do teste de andar / escada.

Ainda fica: a primeira pintura de uma parte nova do visual (bichos — vaca, cavalo, coelho —, roupas: os pintores
preguiçosos dos agentes H / K) custa 20–50 ms uma vez por parte na sessão e não se divide; o streaming do planeta entre
os quadros (instalar um chunk 3–20 ms, janela do terreno 1–10 ms); um chunk de cidade que sai longe atrás (~2000 peças)
sai num quadro (~15–20 ms); no teletransporte, o chunk do próprio jogador gerado na hora.

Folga para os moradores: nada mais varre as ~18 mil peças a cada quadro; o mapa dos andares segue as peças novas e as
portas sem reconstruir; moradores perto do jogador custam como criaturas.

### Testes e prints

- FX1 (validador, duas sementes), FX2 (o convidado sobe a escada da paliçada da vila do início, anda no alto no andar 1,
  desce; o anfitrião o vê lá em cima; digest igual), FX3 (a caminhada até a capital e através dela a 8 tiles/s: nenhum
  quadro acima de 120 ms neste headless — que divide uma thread com a página dos testes —, p95 < 14 ms, lote de peças <
  30 ms, nenhum chunk gerado na thread principal por causa de uma peça, < 9000 sprites na praça; deu pior 35,6 ms, p95
  5,4 ms, lote 3,4 ms, 0 chunks, 2089 sprites).
- Prints (`shots/`, fora do git): `fx_doors_before_house_s` / `fx_doors_after_house_s`, `fx_doors_before_weaver` /
  `fx_doors_after_weaver`, `fx_palisade_top_a` / `_b` / `_c` (no alto da paliçada, três ângulos), `fx_perf_walk_city`
  (a caminhada na cidade com o contador de quadros).
