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
muralhas, os portões, as estradas, o mural e o mapa. Fase 2: o comércio, os trabalhos e as propriedades estão no
§10; os **moradores e guardas**, no §11.

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
- **Nível do povo** (§7b): `realmNpcLevel(game, s)` / `game.towns.npcLevel(sid)` — a distância ao início dá o
  `baseLevel` (nunca guardado); o povo acompanha o progresso do mundo (fase 2: o recorde guardado `game.towns.prog`, §11)
  até o nível dos lugares mais distantes.

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
- O dano de cerco fica até alguém consertar; (fase 2, §11: o povo conserta de dia; a aurora não limpa mais o dano das
  peças dos lugares).
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
  lista quais são, e `game.eco.pr` diz quem mora nelas — morador nenhum dorme numa casa comprada (feito no §11).
- Pendente / ideias: caravanas de verdade no mapa (hoje o espalhar de preços é abstrato), o ouro dos mercados (hoje
  infinito), mais tipos de trabalho quando houver moradores (escoltar, guarda), o imposto pago do baú da própria casa.

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

## 11. Fase 2 — moradores e guardas

Feito: as vilas, castelos e cidades têm **moradores** (com nome, casa, cama, ofício, local de trabalho e roupa do
ofício) e **guardas** (tabardo e escudo nas cores do reino, lança / espada, arqueiros com arco), com a rotina do dia no
relógio do jogo, o perigo (o sino, o povo corre para casa, a guarda luta), as muralhas e os portões consertados de dia,
conversa ("Conversar"), nada de fogo amigo e o nível do povo pelo progresso do mundo (§7b). Código: `game/people.js`
(identidades, plano do dia, nível de detalhe, API), `game/npc.js` (cérebros: rotina, guarda, arqueiros, balistas,
consertos), `game/defense.js` (a defesa: a linha da muralha, as aberturas, os postos no alarme), `game/townnav.js`
(caminhos da cidade), `game/mut/people.js` (ops / linhas), `game/content/people.js`
(números, ofícios, nomes, roupas, falas), `ui/talk.js` (a conversa), arte em `art/look/body.js` (tabardo + brasão),
`art/heraldryPaint.js`, `art/gear.js` (escudo da guarda), `art/compose.js` (poses "carregar" e "falar", escudo nas
cores do reino), som `town_bell` (`fx/sfxBank.js`). Ganchos de uma linha em `combat.js`, `ai.js`, `players.js`,
`mobs.js`, `projectiles.js`, `bandits.js`, `walkers.js`, `ballista.js`, `siege.js`, `mut/siege.js`, `towns.js`,
`controller.js`, `building.js` (porta entreaberta), `juice.js`, `game.js` (8 direções), `net/entities.js`,
`net/snapshot.js`, `net/digest.js`, `ui/overlay.js`, `ui/hud.js`.

### Quem mora em cada lugar (puro da semente, igual em todos os pares)

- `game.people.of(sid)` monta a população do lugar a partir da planta (`layout.hooks`): o tamanho é o `pop` do lugar
  (vila ~40–50, castelo ~30, cidade ~200). Ordem: **guardas** (vila 6, +2 com muralha; castelo 72 % do povo — a
  guarnição; cidade 15 %), dos quais **arqueiros** (vila 34 %, castelo 42 %, cidade 40 %); os **trabalhadores** de cada
  local de trabalho (`hooks.work`: ferreiro, lenhador, mineiro, tecelão, taverneiro, padre, cavalariço, carregador do
  armazém, o senhor do castelo); **lavradores** (um por campo, até 7 na vila / 12 na cidade), **pastores** (um por
  curral), **mercadores** (cidade 5, vila grande 1); o resto são as famílias: **crianças** (26 %), **anciãos** (12 %) e
  **moradores** que cuidam da casa.
- Cada pessoa: nome (`content/people.js`: nomes portugueses medievais + apelido de lugar ou de ofício), casa (guardas no
  quartel / posto, senão no torreão ou numa casa), **cama** (os adultos da casa primeiro, depois os anciãos, depois os
  guardas que moram lá), local de trabalho e lugar (o campo, o curral, a bancada), horário próprio (acorda 5,6–6,6 h, sai
  6,3–7,4 h, larga o trabalho 16,6–17,8 h, em casa 18,6–19,35 h, dorme ~20–21,6 h), o lazer (praça, taverna ou casa) e o
  **visual**: rosto, cabelo, pele de `randomLook` (variado), a roupa do ofício (`DRESS`: lavrador com chapéu de palha e
  jardineira, ferreiro com avental de couro, lenhador de xadrez e suspensório, tecelã com vestido bordado, mercador de
  gibão rico, padre de manto…), barba / cabelo por sexo, crianças menores (×0,72, sem barba, cabelo natural), anciãos com
  rugas e cabelo grisalho. Guardas: gibão acolchoado, **tabardo nas cores do reino com a partição do brasão no metal**
  (novo item do catálogo "Tabardo", camada `lk_over_crest_<partição>`), elmo de ferro (vila: de cobre), lança ou espada
  e o **escudo da guarda** (campo na cor do reino, partição no metal, aro e umbo de ferro). Arqueiros: gibão na cor do
  reino, capuz de couro, arco.

### Nível de detalhe (desempenho)

- **Longe**: nada roda; o lugar é só uma contagem (`game.towns.people(sid)`).
- **Perto** (o plano diz onde a pessoa está agora): quem está na rua a até **46 tiles** de um jogador vira criatura
  (sai a **58** tiles e fora da vista); quem está dentro de uma construção só aparece com um jogador a até **11 tiles**
  dela (de noite: o dono da cama aparece dormindo na cama). **Teto: 40 por vila, 30 por castelo, 60 por cidade** (qualidade
  gráfica baixa: 60 % disso), os mais perto primeiro (o teto conta também os que ainda estão indo para casa). Até 6 novas por meio segundo.
- Elas **nascem** onde o plano diz quando ninguém vê (o lugar, a cama), senão saem da porta de casa; **somem** entrando
  pela porta de casa (ou fora da vista).
- **IA por distância**: a mais de 30 tiles de todos os jogadores o cérebro roda a cada 3 quadros (o dt acumulado).
- **Caminhos** (`townnav.js`): A* em tiles sobre a caixa do lugar, **guardados** (por ponta a ponta; refeitos quando um
  tile do caminho fecha), no máximo 2 buscas por quadro (o cache e um "não há caminho" não contam; quem falha espera
  1,2 s), regiões ligadas rotuladas em fatias do quadro (1,2 ms) para dizer "não há caminho" na hora (uma casa cuja porta
  está bloqueada por dentro — ver Pendências). Movimento só pela grade de tiles (sem varrer os objetos do chunk).
- Elas passam pelas portas e portões **do próprio lugar** (fechados ou não): a porta abre um instante em cada par
  (`o._ajarT`, cosmético) — nada de op de porta, nada de recalcular andares / telhados.

Medições (Chrome headless, 1280 × 720, `game.debug.bench`, sistema `game.people.stats`):

| Onde | criaturas | custo do sistema (média / p95 por quadro) | render CPU com / sem | update CPU com / sem | GPU com / sem |
|---|---|---|---|---|---|
| vila do início, 10 h | 25–40 | 0,17 / 0,2 ms | 1,3 / 1,0 ms | 0,6 / 0,6 ms | 1,6 / 1,3 ms |
| capital (Alvalelar, 237 pessoas), 10,5 h | 60 | 0,29 / 0,3 ms | 4,3 / 4,5 ms | 1,5 / 1,4 ms | 3,9 / 3,6 ms |

(VL7 confere na cidade: média < 1 ms e p95 < 3 ms por quadro, e ~0 longe.) O pico de um quadro (~35–50 ms) é a primeira
vez que um lugar é visitado (as identidades e a caixa de navegação de uma cidade); depois, nada acima de ~2 ms. As
partes do visual de cada pessoa (e as vistas 3/4) são pintadas aos poucos (o atlas preguiçoso, ~4 ms por quadro): nos
primeiros segundos numa cidade alguns aparecem com o boneco base nas mesmas cores.

### O dia

- **Manhã**: acordam em casa, saem para o trabalho. **Dia**: o lavrador no seu campo (enxada na primavera / verão,
  plantar, colher no outono — estações do lugar; no inverno a terra dorme), o pastor no curral (alimentar), o lenhador
  no pátio da serraria (machado), o mineiro na mina (picareta), o ferreiro na bigorna (martelo), a tecelã no tear, o
  taverneiro no caldeirão, o carregador levando sacos entre o armazém e a praça (pose "carregar"), o mercador na beira da
  praça (gestos de quem vende), o senhor na cadeira do salão. Um em cada quatro trabalhadores de bancada fica um tempo na
  porta do local (visto da rua). Os moradores: água no poço de manhã, afazeres na porta de casa, conversa com os
  vizinhos; crianças correm pela rua (um terço na praça), anciãos na porta de casa / no banco da praça. Na praça e nas
  portas formam **pares que conversam** (viram-se um para o outro, gesto de falar); quem está parado olha para o jogador
  que chega perto.
- **Tarde**: lazer na praça ou na taverna (sentado nas cadeiras), ou casa. **Noite**: dentro de casa, os donos das camas
  dormindo (pose deitada, "Zzz"), janelas acesas. Só a guarda fica na rua.
- **Perigo** (criatura hostil na terra do lugar + 6 tiles: monstros do inverno, gigantes, saqueadores, lobos): op
  `town.alarm` → **o sino** toca (3 badaladas e depois de tempos em tempos) e o aviso "Alarme em X! …" para quem está lá;
  os portões fecham (regra da fase 1); os civis **correm para casa** e entram; ao fim, "X: tudo calmo de novo" e voltam.

### A guarda

- **Dia**: um guarda em cada posto de portão (olhando para fora), os outros na ronda (o laço de `hooks.patrol`, pausas
  olhando em volta); metade dos arqueiros de dia num portão.
- **Noite**: o turno da noite + um terço do turno do dia; **arqueiros no alto da muralha** (castelo / cidade: torres e
  topos das escadas, andar 2 — `hooks.archers`; vila de paliçada: o alto da paliçada ao lado dos portões, andar 1; sem
  muralha: nos portões), sobem quando ninguém vê; **guarnições nas balistas** das cidades e castelos (de pé atrás dela;
  miram e atiram nos inimigos ao alcance, gigantes primeiro — ops `ballista.set` / `ballista.shot` como as de um jogador,
  nunca com um jogador operando). Catapultas: as plantas não têm (fase 3).
- **Luta** (`npc.js guardFight`): sem alarme, vêem o hostil a 15 tiles dentro da terra do lugar + 12 (com o sino, cada
  um luta a partir do seu posto — a defesa, abaixo); lanças / espadas vão até ele pelas ruas e portões do lugar (os portões fechados não os prendem) e batem
  no ritmo da arma (a cada ~6–10 s um golpe forte ×1,6); arqueiros no chão chegam a uma boa distância com linha de tiro;
  no muro atiram dali (+20 % de alcance por andar). Flechas da guarda (`faction 'town'`) só acertam hostis. Dano ×1,5 o
  de um saqueador do mesmo nível (treinados, armas de ferro). Os monstros revidam: os andarilhos / esqueletos / múmias
  são atraídos pelo povo na rua (`walkers.js pickGoal`), qualquer criatura que apanha de um guarda luta com ele
  (`players.hurtPlayer` agora entrega o golpe a uma criatura), as flechas dos monstros acertam o povo.
- **Quando o sino toca, a defesa** (`game/defense.js`; apontamento do dono: "os soldados vão para as muralhas e não
  ficam defendendo apenas o mural / castelo … e caso o inimigo abra uma abertura na muralha os soldados corpo a corpo vão
  até a abertura"): **toda** a guarda (os dois turnos) vai para o **perímetro**, não para a praça:
  - **arqueiros no alto da muralha / paliçada** (`hooks.archers`), os do lado de onde vem o ataque primeiro, atirando
    para fora; quem está no chão corre até o pé do muro e sobe em ~1 s mesmo à vista (sem caminho até o pé: sobe em 8 s);
  - **corpo a corpo**: um em cada portão (por dentro; dois nos portões do lado do ataque), o resto no **trecho da muralha**
    de onde vem o ataque (os pontos da ronda logo por dentro do muro, só a metade da frente); o guarda de um trecho de
    muro inteiro só luta com o que está **dentro** (não sai dando a volta pelo portão); o do portão enfrenta o que chega a
    7 tiles dele (sai pelo portão), o do trecho a 8;
  - **balistas**: guarnição (até um terço dos de corpo a corpo, as do lado do ataque primeiro);
  - **reserva** perto do torreão (cidade 15 %, castelo 12 % dos de corpo a corpo): caça o que **já entrou**; e para cada
    inimigo dentro dos muros os 2 guardas mais perto (reserva primeiro, nunca quem segura uma abertura ou opera balista)
    vão atrás dele;
  - **vila sem muralha**: em linha na **beira do lado do ataque** (5 pontos em leque) e nas entradas das estradas; os
    arqueiros 2,5 tiles atrás da linha;
  - civis em casa (o torreão, para quem mora nele).
  - **Aberturas**: uma peça da linha da muralha (madeira / pedra / portão, andar 0) **destruída** — o estado do lugar,
    igual em todos os pares — é uma **abertura** (`game.townDefense.openings(sid)`: `{ id, ids, x, y, fx, fy (para fora),
    w (tiles), gate }`; peças vizinhas até 2 tiles juntam numa só). Os **guardas de corpo a corpo mais perto** vão
    segurá-la (no alarme: 2, ou 3 se larga / portão; o primeiro **na** abertura, os outros logo por dentro, lado a lado;
    lutam com o que chega a 5 tiles); os arqueiros do muro perto dela (12 tiles) atiram primeiro no que vem até ela. **Sem
    alarme**, uma abertura ainda fica com **um** guarda logo por dentro até ser refeita (os consertos de dia a refazem).
  - **Barato**: os postos só são refeitos quando algo muda — o alarme começa / acaba, uma abertura aparece / some, o lado
    do ataque muda (8 setores, com folga para não ficar trocando), um guarda morre / volta — a cada meio segundo só se
    compara uma assinatura; quem caça quem dentro dos muros é refeito no mesmo meio segundo (poucos inimigos × poucos
    guardas). Nada por quadro.
  - **Fase 3** usa o mesmo: `game.townDefense.perimeter(sid)` (a linha: peças, `inside(x, y)`), `.openings(sid)`,
    `.threat(sid)` (o lado do ataque: `{ fx, fy, sector }`), `.posts(sid)` (os postos agora, anfitrião), `.assign(sid,
    threat, danger)` (os postos para uma ameaça dada — um exército chegando por um lado).
- **Nível** (§7b): `realmNpcLevel` = o maior entre o nível pela distância e o **progresso do mundo** — agora um recorde
  guardado (`game.towns.prog`, op `town.prog`, linha `wprog` no save / snapshot, nunca desce), até o nível dos lugares
  mais distantes. Civis: 2 níveis abaixo.
- **Mortes**: monstros ferem e matam o povo; sem corpo e sem saque. Op `town.pop` (morto, hora) → linhas `tpop` no save /
  snapshot e no digest; aviso "<Guarda> X caiu defendendo Y". **Repovoar**: cada morte é reposta 1,5 dia depois (um recém-chegado
  com a mesma identidade da semente).

### Consertos

- **De dia** (7–18,6 h, sem perigo), com o povo do lugar na rua: um trabalhador (lenhador, ferreiro, carregador,
  lavrador, mineiro, cavalariço) ou um guarda da ronda vai até a peça rachada (o lado de onde dá para chegar) e bate o
  martelo: a cada 2,2 s a rachadura cai 12 % (madeira), 7 % (pedra), 3 % (dano de cerco, `o.sdmg`) — ops `struct.dmg` /
  `siege.dmg`. Até 3 consertos ao mesmo tempo, os andares de baixo primeiro. Uma peça **destruída** há mais de 20 s é
  **refeita** pelos trabalhadores (9 s de martelo, ninguém no lugar → op `town.restore`; a peça volta na hora mesmo com o
  chunk carregado — corrigido em `towns.js resyncPieces`).
- **Longe dos jogadores**: por números, cada hora do jogo de dia −20 % de rachadura. Peças destruídas longe: a regra da
  fase 1 (2 dias sem ninguém a 40 tiles).
- A regra antiga "os andarilhos de dia limpam o dano" **não vale mais para as peças dos lugares** (só para as dos
  jogadores); o dano de cerco de uma peça do lugar agora também fica no estado do lugar (sobrevive ao chunk sair).

### Conversar, nada de fogo amigo

- **E** perto de uma pessoa / um toque nela: "Conversar com <nome>" → o cartão da conversa (`ui/talk.js`): retrato
  (o mesmo pintor do editor de personagem), nome, ofício · lugar · reino, o brasão, e 4–5 falas (oi, uma do ofício e da
  estação, o **mural** para quem nunca abriu um, uma do lugar / da estação, tchau); no perigo, "Para dentro!" / "Deixe
  com a guarda!". E / Espaço / toque seguem; Esc / "Tchau" / se afastar fecham. Local: nada vai pela rede.
- Uma pessoa parada vira para o jogador que chega perto e às vezes gesticula.
- **Plaquinhas**: só a da pessoa com quem o E fala, a do alvo, a do mouse e a de um guarda ferido (com a barra de vida).
- **Sem fogo amigo**: um golpe, flecha, atordoar, sangrar de um jogador num morador ou guarda não faz nada ("X é de Y: o
  povo do Reino de Z está sob a proteção do reino", no máximo a cada 4 s); o ataque automático nunca escolhe o povo (Tab
  também não); um toque no povo é conversa, nunca ataque; flechas dos jogadores passam por eles; virotes de balista e
  máquinas de cerco nunca os ferem (`siegeCanDamage`: só em guerra — fase 3).

### Multijogador

O povo é criatura do anfitrião, no fluxo de entidades com interesse (40 × 30 tiles). O convidado refaz quem é cada um
pelo `camp` = `p<sid>.<i>` e pela semente (o visual vai como 0: economiza ~600 B por pessoa); a pose (`b:<cama>` /
`s:<assento>`) vai no fluxo; a porta entreaberta, o sino, os avisos são cosméticos em cada par. Ops novas:
`town.pop {sid, i, dead, at}`, `town.prog {lv}`, `town.alarm {sid, on}`. Save / snapshot: `tpop`, `wprog`. Digest:
parte `towns` (+ as mortes e o progresso). Conversas: interface local.

### API para a economia

`game.towns.people(sid)` (em todos os pares) → um **Array** com todas as pessoas do lugar (vivas ou não: a mesma lista
em todos os pares, da semente) — `[{ i, name, job, role (o ofício em português), jobPt, female, age, home (índice do
prédio na planta), work (prédio | −1), alive }]` — que carrega os números do lugar como propriedades: `{ sid, name,
kind, total, alive, dead, guards, archers, children, elders, jobs: { <ofício>: { pt, n, alive } }, workplaces: [{ b
(índice do prédio), name (local: 'Ferreiro', 'Armazém'…), job, slots, alive, productivity 0..1 }], fields: { slots,
alive }, pens: { slots, alive }, productivity (trabalhadores vivos / vagas), list() }`. O quadro de trabalhos da
economia tira daí o nome de quem dá cada trabalho. Também: `game.people.of(sid)` (as identidades),
`game.people.alive(sid, i)`, evento `townpop {sid, i, dead}` (em todos os pares) quando a população muda. A produção do
mercado pode usar `workplaces[].productivity` / `fields` / `pens`.
- **As casas da economia** (as que se vendem / alugam aos jogadores: `game.eco.api.props(sid).houses`, uma lista fixa da
  planta) ficam vazias: nenhum morador mora ou dorme nelas, compradas ou não (se todas as casas de um lugar estivessem à
  venda, o povo fica com elas). Sem a economia presente, nada muda.

### Testes e prints

`tools/mp-test.js` VL1–VL9 (`?run=VL1,…`): VL1 o povo da vila nos dois pares (mesmos nomes, ofícios, visual da semente,
API) e trabalhando de dia · VL2 de noite em casa, o dono da cama dormindo na cama (pose no fluxo), só a guarda na rua ·
VL3 ronda de dia; de noite arqueiros no adarve de um castelo (andar 2) e guarnição na balista · VL4 um lobo (forte, ×12
de vida, para o alarme durar) na vila: o sino, os civis correm para casa e entram, os guardas que caçam o que entrou o
matam; noite de inverno: andarilhos no portão, a guarda luta e vence, sem dano entre o povo · VL5 sem fogo amigo (golpes
do anfitrião e do convidado, atordoar, sangrar, alvo automático, cerco) e "Conversar" · VL6 consertos de dia (rachadura
e peça destruída da paliçada) e a aurora não limpa mais o dano do lugar · VL7 a cidade: teto de 60, custo por quadro,
longe = só contagem · VL8 uma morte por monstro (sem corpo / saque), salva, repovoada dias depois; o progresso do mundo
só sobe e é salvo · VL9 **a defesa**: um lobo (preso no lugar) fora da paliçada de dia — o sino, a ameaça do lado dele,
todo arqueiro na rua sobe na paliçada (superfície do andar 1, nenhum no mural), os de corpo a corpo nos portões / no
trecho de frente (nenhum no mural); um tronco desse trecho é destruído → abertura nos dois pares e um guarda de corpo a
corpo vai segurá-la (na abertura / logo por dentro); depois do "tudo calmo", um guarda continua nela.
Prints em `shots/vl_*.png` (não vão para o git): `vl_village_day_a` / `vl_village_day_b` (vila de dia, 0° e 45°), `vl_work_field` / `vl_work_pen` (lavrador plantando,
pastor no curral), `vl_work_smith` (ferreiro martelando na bigorna), `vl_work_carry` / `vl_city_market_morning` /
`vl_city_plaza` / `vl_city_plaza_45` (a praça da capital: feira da manhã, gente indo ao chafariz), `vl_evening` (a vila
no fim da tarde) / `vl_evening_city` (a praça da capital à hora dourada), `vl_night_village` / `vl_night_palisade_archer`
(janelas acesas, ronda, arqueiro na paliçada), `vl_night_castle_archers` / `vl_night_castle_ballista` /
`vl_night_city_walls` / `vl_night_city_walls_45` / `vl_night_city_patrol` (arqueiros com lanterna nos muros, guarnição
da balista, ronda), `vl_night_bed` (dormindo nas camas), `vl_fight_gate` / `vl_fight_gate2` (a guarda contra andarilhos
do gelo no portão do castelo), `vl_talk` (a conversa), `vl_breach_gap` / `vl_breach_gap_45` / `vl_breach_walls` (a
defesa: lobos fora da paliçada de uma vila, um tronco destruído — um guarda na abertura e outro logo por dentro, os
arqueiros no alto da paliçada, um guarda no trecho de frente).

### Decisões e pendências

- **Portas bloqueadas por móveis**: corrigidas nos prefabs (§9b). O povo continua tratando uma casa que ainda fique
  fechada sem travar (uma construção de jogador, um móvel posto depois): quem vai para dentro entra pela porta (some e
  aparece dentro se um jogador está ao lado), o dono da cama aparece direto na cama e, para sair, passa pela porta (um
  passo de um tile, a porta abre); as regiões são recalculadas quando algo muda. Com as portas livres, agora todos
  **entram** de verdade nas casas: no vão de uma porta eles passam um pelo outro (sem empurrão: quem entra e quem sai
  nunca travam a porta de 1 tile), o caminho reto só vale se o corpo inteiro passa (não raspa no batente) e quem foge
  para casa entra até o fim (antes ficava indo e voltando na soleira).
- As camas do andar de cima (a torre de menagem) são usadas por quem está no térreo embaixo delas (o desenho deitado
  fica na cama; o povo ainda não sobe escadas — só a guarda, que aparece no alto quando ninguém vê).
- Guarda morta volta depois de 1,5 dia como qualquer morador; o inimigo que "desiste" (estado evade dos monstros) fica
  invulnerável enquanto volta para casa — a guarda o deixa ir.
- **Barracas de mercado**: as plantas não têm; os mercadores ficam na beira da praça. Quando a economia criar as
  barracas, `npc.js workTask` (merchant) é o lugar.
- **Catapultas nas muralhas**: as plantas só têm balistas; a guarnição as opera.
- **Paliçada caminhável** (§9b): os arqueiros ficam no alto dela (andar 1); sobem quando ninguém vê subir (o povo ainda
  não usa as escadas).
- O povo passa pelos portões fechados do próprio lugar (os monstros não): a guarda sai para lutar e os moradores do
  campo entram depois do anoitecer.
- No modo criativo o povo existe e vive igual (os monstros do criativo não atacam ninguém).

## 12. Fase 3 — guerra: o contrato entre as partes

O dono deu o "prossiga" para a fase 3 (§8): diplomacia · exércitos no mapa · batalhas · IA do cerco completa · entrar
num exército (ordens, waypoints). Ela é feita em três partes; as duas primeiras ao mesmo tempo, em ramos separados, e
este contrato diz o que cada uma oferece à outra para que se juntem sem atrito. Quem mudar o contrato atualiza esta
seção.

| Parte | O quê | Arquivos novos (donos) | Testes |
|---|---|---|---|
| **3a — estratégia** | diplomacia, o dono de cada lugar, exércitos no mapa, marchas, batalhas e cercos **longe** dos jogadores (por números), conquista, mapa / minimapa / mural (informação) | `game/realms.js`, `game/mut/realms.js`, `game/content/war.js` (+ a camada de guerra do mapa) | `WR1…` |
| **3b — campo de batalha** | soldados de verdade **perto** dos jogadores, batalha entre exércitos, a IA do cerco jogável (acampamento → máquinas → bombardeio → aríete / torres / brechas → assalto → tomada ou recuo), a guarda contra soldados | `game/warfare.js`, `game/soldier.js`, `game/siegeAI.js`, `game/content/soldiers.js` | `BT1…` |
| **3c — o jogador no exército** (depois de 3a + 3b) | entrar pelo mural, ordens do general na tela, waypoints no mapa / minimapa, quem pode bater em quem, morrer na guerra sem perder reputação, pagamento | — | `AR1…` |

### O que 3a oferece (`game.realms`, em todos os pares; estado replicado, decidido no anfitrião)

- `rel(a, b)` → `'self' | 'ally' | 'neutral' | 'war'` (simétrico) e `atWar(a, b)` (o gancho que `siegeCanDamage`,
  `eco.js` e os soldados já consultam). Reinos que **não se ligam por terra** (`canReach`) são sempre `'neutral'`.
- `owner(sid)` → o reino **atual** de um lugar (começa em `s.k`; muda na conquista). Todo código que pergunta "de quem
  é este lugar" passa a usar isto (3a troca os usos de `s.k` como dono: economia, cores da guarda, mapa, faixa do lugar,
  mural). `alive(k)`: o reino ainda existe (tem cidade).
- `armies` → `Map id → { id, k, home (sid), n (soldados), lv (§7b), x, y (tile), state 'home' | 'march' | 'camp' |
  'siege' | 'battle' | 'retreat', target (sid | null), path, eng { treb, cat, ram, tower } (máquinas que leva / fez),
  live (true = 3b está jogando ele perto de alguém) }`.
- `capture(sid, k)` (anfitrião) → op: o lugar muda de reino em todos os pares (guarda, cores, mural, mapa, economia);
  evento `capture { sid, from, to }`. Outros eventos: `war { a, b, on }`, `army { id, state }`, `battle { … }`.
- Op de depuração / testes `realm.rel { a, b, rel }` (anfitrião): força uma relação (3b e 3c usam nos testes).
- **A passagem para 3b**: quando um exército fica a ~120 tiles de um jogador (ou uma batalha / cerco dele), 3a marca
  `live = true` e chama `game.warfare?.materialize(army)`; quando ninguém mais está perto, `game.warfare?.dematerialize(id)`
  devolve `{ n, eng, siege }` e a simulação por números continua dali. Sem 3b (`game.warfare` ausente), tudo é por
  números. Enquanto `live`, 3a não mexe nos números daquele exército — 3b reporta com `game.realms.report(id, { n, eng,
  state })`.

### O que 3b oferece (`game.warfare`, anfitrião; os soldados são criaturas no fluxo de entidades como o povo)

- `materialize(army)` / `dematerialize(id)` (acima); `forces` (o que está vivo agora); `startSiege(spec)` e
  `startBattle(a, b)` de depuração (testes sem a 3a: `spec = { k, sid alvo, n, lv, eng, at: [x, y] }`).
- Quem é inimigo de quem: `atWar(game, a, b)` = `game.realms?.atWar?.(a, b)`. Nos testes de 3b, **antes** da 3a existir,
  um calço só no código de teste (`tools/mp-test.js`) põe `game.realms = { atWar, owner }`; na junção os testes passam a
  usar a op `realm.rel` da 3a. Nada de calço em `src/`.
- O dono de um lugar: `ownerOf(game, sid)` = `game.realms?.owner?.(sid) ?? realm.settlements[sid].k`.
- A defesa do lugar atacado é a de §11 (`game.townDefense.assign(sid, threat, true)` com a ameaça do lado do
  exército, as aberturas, a reserva); 3b só a estende para lutar contra soldados (que são inimigos só em guerra).
- A tomada: os atacantes seguram o centro (a praça / o torreão) sem defensores por um tempo → `game.realms?.capture?.(sid, k)`.
- Jogadores — **correção do dono** (substitui o "neutros até a 3c"): "o jogador pode sim atacar npc inimigo mesmo não
  fazendo parte do exército, isso ganha reputação aliás e cria uma possibilidade do jogador ajudar a defender sua
  vila/cidade/castelo mesmo não estando em um exército". Sem entrar em exército nenhum, um jogador pode lutar com
  **soldados** (nunca com moradores / guardas: §11 continua) quando (a) é membro de um reino K e o soldado é de um reino
  em guerra com K, ou (b) o soldado está **lutando** — sitiando um lugar ou numa batalha campal — e não é do reino do
  jogador nem de um aliado (um viajante ajuda um lado). Os soldados que ele fere revidam (ele vira o inimigo deles por um
  tempo); fora isso soldado nenhum vai atrás de jogador. Ajudar dá **reputação** com o reino defendido (ou com o outro
  exército) e tira com o dos soldados. Regra exata, números e avisos: §14 "Jogadores" (`game/soldier.js playerMayHurt`).
  A 3c estende isso pelo exército (ordens, pagamento, morrer na guerra).
- `game.realms.rel(a, b)` é lido também (`'ally'`: um aliado do reino do jogador continua protegido); `game.realms.release?.(id,
  r)` (opcional): 3b devolve sozinha uma força sem jogador por perto (a 150 tiles) com o mesmo `r` de `dematerialize`.

### Regras comuns

- Anfitrião autoritativo; o estado novo vai no snapshot, no save e no digest (partes próprias); tudo igual nos dois pares.
- §7b vale para soldados e para a força dos exércitos nos números (`realmNpcLevel`).
- O reino do início não entra em guerra nos primeiros dias do mundo (3a decide quantos e documenta); guerras não
  podem acabar com o mundo do jogador de repente — avisos claros antes ("O Reino de X declarou guerra ao Reino de Y",
  "Um exército de X marcha sobre Y").
- Os reinos **não** cercam as bases dos jogadores (§4).
- Cada parte escreve a sua seção de implementação aqui (como §9–§11) e deixa prints em `shots/` (fora do git).

## 14. Fase 3b — campo de batalha e cerco

Feito (parte 3b do §12): os exércitos dos reinos viram **soldados de verdade perto dos jogadores** — batalha campal e o
**cerco jogável** dos dois lados (acampamento → máquinas → bombardeio → aríete / torre / brechas → assalto → tomada ou
recuo) —, a guarda dos lugares luta contra eles e o **jogador pode ajudar um lado** (decisão do dono, abaixo). Código:
`game/soldier.js` (quem é cada soldado, visual, andar, lutar, a regra do jogador), `game/warfare.js` (`game.warfare`, as
forças, reservas, moral, general, batalha campal, reputação), `game/siegeAI.js` (o cerco), `game/mut/warfare.js` (ops,
linhas do snapshot / save / digest), `game/content/soldiers.js` (números, papéis, falas), `art/faces/camp.js` (tendas,
estandartes e o estandarte do general nas cores do reino). Ganchos de uma linha em `combat.js` (a regra do jogador, o
crédito da morte), `ai.js`, `mobs.js`, `projectiles.js` (flechas do exército e da guarda com `canHit`), `ballista.js`
(guarnições contra soldados e máquinas), `npc.js` / `people.js` (a guarda contra soldados, o alarme e a ameaça do cerco,
consertos no cerco), `towns.js` (portões fecham com exército, peças do exército não se desmontam), `siege.js` /
`mut/siege.js` (soldados empurram / operam pelas mesmas regras; `fireShot` / `ramBlow` exportados; o jogador não usa
máquina de exército), `mut/structures.js`, `mut/eco.js` (`addRep` exportado), `townnav.js` (função de passagem por
parâmetro), `net/entities.js`, `net/snapshot.js`, `net/digest.js`, `ui/overlay.js`, `ui/hud.js`, `controller.js`,
`game.js`, `juice.js`.

### Os soldados

- **Quem é**: criatura do anfitrião (espécie `soldier`, `kind 'pawn'`, `faction 'army'`) no fluxo de entidades como o povo.
  O convidado refaz cada um pelo `camp` = `w<reino>.<etiqueta da força>.<papel><índice>` e pela semente (nome português,
  rosto, cabelo, o visual do papel nas cores do reino — o visual nunca vai pela rede).
- **Papéis**: **lanceiro / espadachim** (tabardo nas cores do reino com a partição do brasão, gibão acolchoado, escudo do
  reino), **arqueiro** (gibão na cor do reino, capuz, arco), **engenheiro** (camisa na cor do reino, avental de couro,
  machado: monta o acampamento, constrói, empurra e opera as máquinas), o **general** (gibão bordado, tabardo, e o
  **estandarte do reino** no alto de uma haste, que ele ergue quando reanima a linha). Uma força de n soldados: 1
  general (n ≥ 6), engenheiros (cerco: 10 %, 2–10), arqueiros 30 % do resto, e o resto lanças / espadas.
- **Armadura pelo nível** (§7b `realmNpcLevel` da capital, ou o `lv` do exército da 3a): até o nível 8 sem elmo (rostos
  e tabardos à vista), armas de cobre; 9–17 elmo de ferro, armas de ferro, gibão de cota; 18+ armas de aço. Vida = a do
  soldado no nível × 1,05–1,45 (general × 4,2), dano × 1,1–1,3; proteção pela armadura e pelo escudo.
- **Plaquinhas** (regra do §11): só o alvo, o do mouse, o que luta comigo e o **general** (até 18 tiles): "Nome · Lanceiro
  · Reino de X  nível" — em salmão quando o jogador pode atacá-lo, em creme quando está protegido. O alvo no HUD mostra o
  papel e o reino.
- **Desempenho**: no máximo **80 soldados-criatura** no mundo (cada força até 44; cerco 56; qualidade baixa × 0,6), o
  resto são **números** que entram (pela retaguarda, fora da vista quando dá) conforme os vivos caem. Cérebro a cada
  quadro perto dos jogadores, a cada 3 quadros longe (> 30 tiles); cada um escolhe o inimigo numa **lista curta** da sua
  força (refeita a cada 0,5 s), nunca varrendo as criaturas; o caminho no cerco é um **campo de fluxo** (Dial, custos
  10 / 14) do lugar inteiro até a praça, refeito em fatias de 0,8 ms quando a passagem muda (portão quebrado, brecha,
  portões abertos / fechados); nada por quadro varre as peças.

### A batalha campal

`startBattle(a, b)` (ou dois exércitos da 3a que se encontram — `materialize` com `state 'battle'`): as duas forças
**marcham em coluna** até o ponto de formar (17 tiles cada uma do meio), **formam as linhas** (infantaria na frente,
largura 5–16, arqueiros 2 fileiras atrás, o general entre eles com o estandarte), **avançam** a passo (a linha espera os
atrasados), os arqueiros **atiram** quando o inimigo entra no alcance (19 tiles), a 22 tiles as linhas **se chocam**
(a infantaria caça o inimigo mais perto; arqueiros e general ficam atrás). **Moral** (0–100): −1,1 por % de baixas, −30
com o general morto, −18 em desvantagem de 0,6 : 1; o general **reanima** (+14, até +32; grito "Firmes! Pelo Reino de
X!", estandarte erguido) a cada 9 s enquanto a linha vacila. Abaixo de 26 a linha **debanda** (corre para trás, some
fora da vista); o vencedor persegue 6 s e fica. Ao fim os dois **reportam** à 3a (`report(id, { n, lost, killed,
state 'retreat' | 'won' })`) e somem.

### O cerco

Perto de um jogador o cerco é jogado de verdade (`startSiege(spec)` de depuração, ou `materialize` de um exército da 3a
em `state 'siege'`):

1. **Plano** (espalhado pelos ticks da força, poucos ms cada): os quatro lados retos da linha da muralha
   (`game.townDefense.perimeter`) são pesados — uma pista reta e livre para o **aríete** até um portão, uma para a
   **torre** até um trecho de duas peças da mesma altura com adarve caminhável (`towerStoriesFor`), lugar para os
   **trabucos** a 34–43 tiles do alvo — e vence o lado de frente para o exército com mais máquinas. As pistas começam
   fora do alcance dos arqueiros (13 × (1 + 0,2 por andar) + 2) e fora da terra da vila; a **Oficina de cerco** fica no
   meio delas (toda máquina a até 16 tiles: a regra do jogador).
2. **Acampamento** fora do alcance de tudo o que defende: cada arqueiro dos muros (pelo andar), cada balista (34), a
   guarda que persegue (raio do lugar + 12), + 7 de folga: **4 tendas** em meia-lua, **3 estandartes** virados para o
   lugar, **2 fogueiras** (estruturas do exército: `o.realm = k`, nas cores do reino), erguidas uma a uma pelos
   engenheiros (martelo).
3. **Obras**: a oficina, depois os trabucos, o aríete e a torre como **plantas de verdade** (`struct.add` / `struct.progress`
   / `struct.complete`, `placeReason` do jogador), 2 engenheiros na primeira, 1 nas outras (tempo = o da construção × 0,8).
4. **Bombardeio**: um engenheiro em cada trabuco (`siege.set user '~<nid>'`), a armação gira na velocidade dela
   (0,3 rad/s) e o tiro passa por `fireShot` (o mesmo de um jogador: recarga, dispersão sorteada pelo anfitrião, a
   mira que melhora no mesmo alvo). Dano de cerco persistente (`siege.dmg`, no estado do lugar) até a peça cair: uma
   **brecha**; depois as peças ao lado (a brecha alarga). A infantaria espera formada na frente do acampamento.
5. **Assalto** (brecha aberta, ou aríete / torre prontos e 25 s de bombardeio, ou 70 s): o **aríete** empurrado pela
   equipe (2–4, engenheiros primeiro: `siege.set push` + o passo do próprio anfitrião, `siege.js hostPush`) até o portão,
   **pancadas** (`ramBlow`) até o portão cair ("O portão caiu! Para dentro!") — e a equipe **puxa o aríete de volta** 4
   tiles (ele tapava a passagem) e entra; a **torre** empurrada até a muralha, a
   **rampa desce**, até 10 soldados sobem a escada de trás um a um (0,55 s por andar), atravessam a rampa, **lutam no
   adarve** com os arqueiros de lá e descem por um alto de escada para dentro; a infantaria entra por **qualquer abertura**
   (o campo de fluxo até a praça — muros e portões fechados barram) ou espera fora do alcance dos arqueiros; os
   **arqueiros** avançam até 13 tiles do muro e atiram nos defensores (alcance +25 % contra o muro); o general reanima de
   trás.
6. **Tomada**: 2+ atacantes a até 7 tiles da praça e **nenhum guarda** a até 13 por 18 s → `game.realms.capture(sid, k)`;
   a força fica 40 s como guarnição e some nas casas. **Recuo**: 62 % de baixas, moral < 22, 20 min de cerco ou 2
   soldados → correm para longe do acampamento; acampamento e máquinas desmontados quando a força acaba.

**A defesa** (o §11 estendido): soldados de um reino em guerra com o dono do lugar são inimigos da guarda (`npc.js
hostile(e, S, game)`), o alarme toca quando o exército acampa (`game.warfare.threatOn(sid)` → `game.townDefense` com a
ameaça do lado do exército: arqueiros nos muros de lá, corpo a corpo nos portões / no trecho / nas brechas, reserva no
castelo, civis em casa), os **portões fecham** enquanto houver cerco (`towns.js hostileInside`), as **balistas** miram
soldados (o general antes) e **as máquinas** (um virote preso numa máquina inimiga: 240 de dano de cerco), as flechas da
guarda só acertam inimigos (`canHit`). **Consertos no cerco**: com o exército longe (no acampamento) os guardas do trecho /
da reserva consertam as peças — **também à noite**, só se for seguro (nenhum inimigo no alarme).

### Jogadores (decisão do dono, muda o §12)

"O jogador pode sim atacar NPC inimigo mesmo não fazendo parte do exército, isso ganha reputação aliás e cria uma
possibilidade do jogador ajudar a defender sua vila/cidade/castelo". A regra (`soldier.js playerMayHurt`, a mesma no
convidado e no anfitrião):

- **Membro** de um reino K (o registro da economia): pode lutar com soldados de **qualquer reino em guerra com K**; nunca
  com os do próprio reino nem de um aliado (`rel 'ally'`).
- **Viajante** (ou membro de um reino de fora da briga): pode lutar com soldados **que estão lutando** — sitiando um
  lugar (acampamento, obras, bombardeio, assalto, recuo) ou numa batalha campal — ou seja, **ajudar um lado**.
- Fora disso o soldado é protegido como o povo: o golpe não faz nada e diz "Soldado do Reino de X: só se luta com
  soldados de um reino em guerra com o seu, ou que estejam atacando um lugar ou outro exército" (no máximo a cada 4 s).
  Moradores e guardas continuam protegidos (§11); a máquina de um exército não se opera nem se desmonta ("…só os
  engenheiros dele a usam" / "Isto pertence ao exército do Reino de X").
- **Revide**: o soldado ferido por um jogador passa a tê-lo como inimigo por 22 s (renovado a cada golpe: espada,
  flecha); fora disso **soldado nenhum vai atrás de um jogador**. O ataque automático nunca escolhe um soldado sozinho —
  só o marcado ou um que esteja lutando comigo.
- **Reputação** (anfitrião, por uid, op `war.rep`): matar um atacante dá **+2** com o reino defendido (engenheiro +3,
  general +10), cada 6 golpes +1, e o mesmo **−** com o reino dos soldados (não para quem é membro dele); um cerco
  rechaçado dá **+10** a quem lutou; no máximo 60 por força; juntado e mandado no máximo a cada 4 s: "+4 reputação com o
  Reino de X — defendendo Estrosa · −4 com Rabel". Numa batalha campal, com o reino do outro exército.

### Avisos (tudo em português)

- Ao chegar perto de uma força pela primeira vez: "Cerco de Estrosa: o exército do Reino de Rabel (34 soldados) —
  acampando. Quem lutar com os soldados ajuda a defender Estrosa (reputação com o Reino de Galéria)." / "Batalha: o Reino
  de X contra o Reino de Y. Lutar por um dos lados dá reputação com ele." / "Um exército do Reino de X marcha por aqui
  (N soldados). Em paz com você: não ataca quem não o ataca."
- Gritos (`war.cry`, para quem está a até 60 tiles): o acampamento, "Os trabucos do Reino de X começam o bombardeio de
  Y", máquina pronta, "Uma brecha na muralha! Avante!", "O portão caiu! Para dentro!", "A rampa desceu! Para a muralha!",
  o general ("Firmes! Pelo Reino de X!", "Segurem a linha!"), "O general do Reino de X caiu!", "Recuar! Recuar!", "Y
  resistiu! O exército do Reino de X recua", "Y foi tomada pelo Reino de X!".

### Multijogador

Anfitrião autoritativo. Ops novas: `war.force {row}` (a linha pública de uma força: `[id, etiqueta, reino, tipo, alvo,
inimigo, fase, n, n0, nível, x, y, fx, fy]`), `war.end {id}`, `war.mark {ids, k}` (estruturas do exército: `o.realm`),
`war.cry {texto, x, y}` (grito: um aviso para quem está a até 60 tiles), `war.rep {u, k, d, k2, d2}`. As máquinas usam as
ops de sempre (`struct.add`, `siege.set` com `'~<nid>'` como operador / empurrador, `siege.shot`, `siege.step`,
`siege.swing`, `siege.dmg`, `struct.remove`). Snapshot / save `war: { f: linhas, r: [[estrutura, reino]] }` (o save
guarda os cercos de depuração com as baixas — ao carregar o cerco recomeça do lugar e adota o acampamento e as máquinas
que ainda estão de pé; os exércitos da 3a são da 3a), parte **`war`** do digest (linhas públicas + marcas).
O convidado vê os mesmos soldados (proxies), máquinas, dano e desfecho.

### A API (`game.warfare`) — como o §12 pediu

`materialize(army)` (cerco / batalha / coluna em marcha conforme `army.state`), `dematerialize(id) → { n, eng { treb,
cat, ram, tower }, siege { fase, acampamento, máquinas… }, lost, killed, state }` (os soldados viram números; o
acampamento e as máquinas são desmontados), `forces`, `startSiege({ k, sid, n, lv, eng, at })`, `startBattle(a, b)`;
mais `debug(id)`, `threatOn(sid)`, `siegeOn(sid)`, `mayHurt(jogador, soldado)`, `stats`. Reporta com
`game.realms.report(id, { n, eng, state, x, y, lost, killed })` a cada fase e a cada 6 s; uma força sem jogador a menos
de 150 tiles é devolvida (`game.realms.release?.(id, dematerialize(id))` — gancho opcional para a 3a). Sem
`game.realms` nada entra em guerra (os testes instalam um calço só em `tools/mp-test.js`).

### Testes e prints

`tools/mp-test.js` **BT1–BT8** (calço da 3a: `game.realms = { atWar, rel, owner, capture, report }` nos dois pares; na
junção, trocar pela op `realm.rel`): BT1 cerco de depuração — soldados nas cores do reino nos dois pares (mesmos nomes /
visuais da semente), acampamento inteiro fora do alcance, sino, ameaça do lado do exército, portões fechados, arqueiros
na paliçada · BT2 oficina → trabuco e torre com obra (progresso no convidado), torre na altura da muralha, trabuco a
34–43 tiles, dano persistente, brecha nos dois pares segurada pela guarda · BT3 torre empurrada por 2+, rampa, soldados no
adarve, a praça tomada → `capture` · BT4 aríete empurrado até o portão, pancadas, portão quebrado, soldados entram ·
BT5 batalha campal: fases, flechas, baixas dos dois lados, debandada, relatórios · BT6 recuo por baixas: acampamento
desmontado, `war.end` · BT7 jogadores: coluna em paz protegida e não ataca, membro em guerra pode, viajante ajuda a
defender (revide, +reputação com o defensor, −com o atacante, aviso), moradores protegidos · BT8 teto de 80 criaturas,
reservas entram, custo por quadro. Todos terminam com o digest igual.
