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
muralhas, os portões, as estradas, o mural e o mapa. Os **moradores e guardas** vieram na fase 2 (§10); ainda **sem
comércio, trabalhos** (fase 2, outro agente): as abas do mural que dependem deles dizem "Em breve".

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
  poço / chafariz, campos com plantações, currais com animais, muralhas (paliçada de toras de 1 andar; pedra de 2
  andares com ameias, torres 3 × 3, escadas para o adarve, portões nas estradas), balistas nas torres da cidade.
  Saída: `structs [[tipo, tx, ty, rot, andar, estilo, det]]` (vila ~1,1–1,7 mil peças, castelo ~1,1 mil, cidade ~7,8
  mil), `buildings`, `gates`, `mural`, `pens`, `fields`, `spawn`, a grade do chão e os **ganchos da fase 2**
  (`hooks.homes` camas por casa, `work` locais de trabalho, `guards`, `patrol`, `archers`, `artillery`).
- `ground.js` `applyRealm` — no worker de chunk: aplaina os lotes e a praça (cantos com altura-alvo), seca e limpa a
  terra da vila, pavimenta ruas e estradas (camada `road`, desenhada por `paths.js`), planta os campos.

### No jogo (`src/game/towns.js`, `src/game/mut/towns.js`)

- **Materialização por chunk** (como os acampamentos): quando um chunk carrega, as peças ancoradas nele viram
  estruturas com id `t<sid>.<k>` e `o.town = sid`, sem sujar o chunk (voltam com ele). Feito em fatias do quadro (3 ms;
  12 ms nos 3 × 3 chunks em volta do jogador); na carga do mundo a vila do início já vem pronta (atrás da tela de
  carregamento).
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
  dos territórios, livre (o modo criativo ignora a regra).
- **Nível do povo** (§7b): `realmNpcLevel(game, s)` / `game.towns.npcLevel(sid)` — a distância ao início dá o
  `baseLevel` (nunca guardado); o povo acompanha o progresso do mundo (fase 2: o recorde guardado `game.towns.prog`, §10)
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
  Trabalhos · Comércio · Exército · Propriedades (as quatro últimas: "Em breve").
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
- O dano de cerco fica até alguém consertar; (fase 2, §10: o povo conserta de dia; a aurora não limpa mais o dano das
  peças dos lugares).
- Baús, camas e comedouros dos lugares não são usáveis (fase 2: propriedades, trabalho).
- O castelo não vende terreno; a cidade e a vila venderão pelo mural (fase 2).

## 10. Fase 2 — moradores e guardas

Feito: as vilas, castelos e cidades têm **moradores** (com nome, casa, cama, ofício, local de trabalho e roupa do
ofício) e **guardas** (tabardo e escudo nas cores do reino, lança / espada, arqueiros com arco), com a rotina do dia no
relógio do jogo, o perigo (o sino, o povo corre para casa, a guarda luta), as muralhas e os portões consertados de dia,
conversa ("Conversar"), nada de fogo amigo e o nível do povo pelo progresso do mundo (§7b). Código: `game/people.js`
(identidades, plano do dia, nível de detalhe, API), `game/npc.js` (cérebros: rotina, guarda, arqueiros, balistas,
consertos), `game/townnav.js` (caminhos da cidade), `game/mut/people.js` (ops / linhas), `game/content/people.js`
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
- **Luta** (`npc.js guardFight`): vêem o hostil a 15 tiles (com o sino, mais longe e sem linha de visão) dentro da terra
  do lugar + 12; lanças / espadas vão até ele pelas ruas e portões do lugar (os portões fechados não os prendem) e batem
  no ritmo da arma (a cada ~6–10 s um golpe forte ×1,6); arqueiros no chão chegam a uma boa distância com linha de tiro;
  no muro atiram dali (+20 % de alcance por andar). Flechas da guarda (`faction 'town'`) só acertam hostis. Dano ×1,5 o
  de um saqueador do mesmo nível (treinados, armas de ferro). Os monstros revidam: os andarilhos / esqueletos / múmias
  são atraídos pelo povo na rua (`walkers.js pickGoal`), qualquer criatura que apanha de um guarda luta com ele
  (`players.hurtPlayer` agora entrega o golpe a uma criatura), as flechas dos monstros acertam o povo.
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

`tools/mp-test.js` VL1–VL8 (`?run=VL1,…`): VL1 o povo da vila nos dois pares (mesmos nomes, ofícios, visual da semente,
API) e trabalhando de dia · VL2 de noite em casa, o dono da cama dormindo na cama (pose no fluxo), só a guarda na rua ·
VL3 ronda de dia; de noite arqueiros no adarve de um castelo (andar 2) e guarnição na balista · VL4 um lobo na vila: o
sino, os civis correm para casa, a guarda mata; noite de inverno: andarilhos no portão, a guarda luta e vence, sem dano
entre o povo · VL5 sem fogo amigo (golpes do anfitrião e do convidado, atordoar, sangrar, alvo automático, cerco) e
"Conversar" · VL6 consertos de dia (rachadura e peça destruída da paliçada) e a aurora não limpa mais o dano do lugar ·
VL7 a cidade: teto de 60, custo por quadro, longe = só contagem · VL8 uma morte por monstro (sem corpo / saque), salva,
repovoada dias depois; o progresso do mundo só sobe e é salvo.
Prints em `shots/vl_*.png` (não vão para o git): `vl_village_day_a` / `vl_village_day_b` (vila de dia, 0° e 45°), `vl_work_field` / `vl_work_pen` (lavrador plantando,
pastor no curral), `vl_work_smith` (ferreiro martelando na bigorna), `vl_work_carry` / `vl_city_market_morning` /
`vl_city_plaza` / `vl_city_plaza_45` (a praça da capital: feira da manhã, gente indo ao chafariz), `vl_evening` (a vila
no fim da tarde) / `vl_evening_city` (a praça da capital à hora dourada), `vl_night_village` / `vl_night_palisade_archer`
(janelas acesas, ronda, arqueiro na paliçada), `vl_night_castle_archers` / `vl_night_castle_ballista` /
`vl_night_city_walls` / `vl_night_city_walls_45` / `vl_night_city_patrol` (arqueiros com lanterna nos muros, guarnição
da balista, ronda), `vl_night_bed` (dormindo nas camas), `vl_fight_gate` / `vl_fight_gate2` (a guarda contra andarilhos
do gelo no portão do castelo), `vl_talk` (a conversa).

### Decisões e pendências

- **Portas bloqueadas por móveis** (apontamento do dono; o agente de correções mexe nos prefabs): hoje a casa pequena tem
  a mesa na frente da porta por dentro. O povo trata isso sem travar: quem vai para dentro de uma casa assim entra pela
  porta (some e aparece dentro se um jogador está ao lado), o dono da cama aparece direto na cama e, para sair, passa
  pela porta (um passo de um tile, a porta abre); quando os prefabs forem corrigidos tudo passa a andar por dentro
  sozinho (as regiões são recalculadas).
- As camas do andar de cima (a torre de menagem) são usadas por quem está no térreo embaixo delas (o desenho deitado
  fica na cama; o povo ainda não sobe escadas — só a guarda, que aparece no alto quando ninguém vê).
- Guarda morta volta depois de 1,5 dia como qualquer morador; o inimigo que "desiste" (estado evade dos monstros) fica
  invulnerável enquanto volta para casa — a guarda o deixa ir.
- **Barracas de mercado**: as plantas não têm; os mercadores ficam na beira da praça. Quando a economia criar as
  barracas, `npc.js workTask` (merchant) é o lugar.
- **Catapultas nas muralhas**: as plantas só têm balistas; a guarnição as opera.
- **Paliçada caminhável** (outro agente): os arqueiros já ficam no alto dela (andar 1) quando ninguém vê subir.
- O povo passa pelos portões fechados do próprio lugar (os monstros não): a guarda sai para lutar e os moradores do
  campo entram depois do anoitecer.
- No modo criativo o povo existe e vive igual (os monstros do criativo não atacam ninguém).
