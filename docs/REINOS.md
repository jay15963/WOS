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

## 8. Fases

1. Esqueletos / múmias e gigantes · geração dos reinos (territórios, assentamentos, casas prontas, castelo modular,
   muralhas, portões, nomes, estradas, mapa) · as 4 máquinas de guerra.
2. Moradores e guardas (rotina dia / noite, defesa nas muralhas) · mural · comércio, moeda, trabalhos, reputação,
   propriedades, imposto.
3. Diplomacia · exércitos no mapa · batalhas · IA do cerco completa · entrar num exército (ordens, waypoints).

Cada fase é testada (cenários multijogador), publicada e mostrada em prints.

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
