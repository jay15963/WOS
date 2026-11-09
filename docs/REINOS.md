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

**Ataques aos lugares no inverno** (dono, 5/11/2026): nas noites da estação ruim os monstros da região **atacam as vilas,
cidades e castelos** — em número **um pouco menor que o de guardas** do lugar, para ser uma batalha de verdade —, sem
força para destruir o lugar: os humanos quase sempre vencem, mas há uma chance **rara (~5 %)** de os monstros vencerem.
Se vencerem, o lugar **não perde toda a população**; no dia seguinte o povo começa a **reconstruir**, como depois de um
cerco — e ajuda a reconstruir as **casas alugadas** do jogador, mas **não** a propriedade **privada** dele (casa comprada,
o que ele construiu no terreno): essa fica para o jogador consertar.
**Feito**: [§16](#16-ataques-de-monstros-aos-lugares) — as ondas, a calibração dos ~5 %, a reconstrução, "Consertar" /
"Reconstruir", por números longe dos jogadores, testes WA1–WA6.

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
- **O reino do início** fica fora de guerras só nos **2 primeiros dias** do mundo (dono, fase 3).
- **Avisos do reino do jogador** (dono, fase 3): quem é membro de um reino vê toda mudança de relação do reino dele com
  outro — aliança formada / desfeita, tratado de paz, guerra declarada (por ele ou contra ele), fim da guerra, um lugar
  dele cercado / tomado / retomado — no alto da tela e no histórico do reino. Cada jogador vê as do seu reino.

## 4. Guerra e cerco

- Cada cidade, vila e castelo tem um **exército**; podem se juntar ou fazer campanhas separadas; enfrentam outros
  exércitos e invadem cidades, vilas e castelos.
- O jogador com reputação suficiente entra num exército pelo **mural** → aparecem **ordens do general** na tela e
  **waypoints** no mapa e no minimapa.
- **Sem fogo amigo**: só dá para atacar gente (e estruturas) de reinos **inimigos**.
- **Ajudar sem estar no exército** (dono, fase 3): o jogador **pode** atacar soldados inimigos mesmo sem entrar num
  exército — membro de um reino: os soldados dos reinos em guerra com o dele; sem reino (viajante): os soldados que
  estão atacando um lugar / exército perto dele. Isso **dá reputação** com o reino que ele ajudou a defender (e tira com
  o atacado), e os soldados atacados revidam. Assim o jogador pode defender a sua vila / cidade / castelo sem estar num
  exército. O povo e a guarda continuam protegidos (§11).
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
- **Marchas longas** (dono, fase 3c): o jogador alistado pode andar junto com o exército, mas o cartão de ordens tem
  "Ir até o exército": de um lugar do seu reino ele vai até o exército (marchando: junto dele; acampado: no acampamento),
  sem pular o tempo do mundo (vale no multijogador).
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
- **Relações herdadas** (dono, fase 3 — fecha o truque de sair do reino para negociar com o inimigo dele): ao **entrar**
  num reino o jogador **herda** as relações dele — a sua reputação com cada outro reino passa a ser a do reino (aliado:
  positiva, neutro: zero, hostil / em guerra: negativa), **substituindo** as antigas; ao **sair**, elas ficam com ele e
  ele precisa melhorá-las sozinho (comércio e trabalhos). A reputação pode ser **negativa**: com ela o jogador **ainda
  negocia, mas com preços muito piores** (compra bem mais cara, venda bem mais barata, pior quanto mais negativa) e
  **não pode entrar** naquele reino até deixá-la neutra ou positiva. Negativa **não** é inimigo: ninguém o persegue; só é
  inimigo declarado quem é membro de um reino em guerra com aquele (e aí não há comércio).
- **Perder uma propriedade** (dono, fase 3): quando um lugar é **conquistado**, quem tem propriedade nele (casa comprada,
  alugada, terreno) **perde** — perder a guerra do seu reino é um risco de verdade. Toda propriedade perdida (conquista,
  imposto não pago) **volta para a lista de vendas** do lugar; se for um **terreno, tudo o que o jogador construiu nele
  some** e o terreno volta à venda.

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
  do andar (levels.js) e quem está atrás sobe a escada de trás (0,55 s por andar) e atravessa a rampa para o topo da
  muralha. Subir é **automático** (apontamento do dono, 8/11/2026: "não entendi como subir na torre de cerco, faça com que
  suba automático ao encostar nela pela parte que sobe nela que é atrás, pois vi que era uma escada vertical"): quem anda
  contra a escada de trás (0,15 s encostado, até 0,75 tile dela) sobe sozinho, e quem empurra a torre e continua
  empurrando depois que a rampa desce (0,3 s) solta e sobe (`siege.js autoClimb`, `push`); "Subir na torre" (E) continua.
  Com a rampa ainda levantada, encostar na escada avisa: "A escada leva ao topo quando a rampa desce". Lá em cima: "Descer
  da torre". Muralha de outra altura: "Esta muralha tem N andares; a torre tem M". Empurrar para longe sobe a rampa (nunca
  com gente no deck). Teste **SG7**.

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
  tracejado = à venda, verde-água = seu, cinza = de outro; 40 s, com o botão "Terrenos à mostra ✕" para ocultar antes); no
  modo construção dentro de uma vila elas também aparecem. Antes ficavam acesas para sempre na vila onde o jogador tinha um
  terreno (apontamento do dono, 6/11/2026: "está aparecendo a demarcação dos terrenos mas não está aparecendo para fechar
  essa visão, aconteceu após eu comprar um terreno"). Comprar uma casa: as portas, os baús e as camas dela passam a
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

- 48 mercadorias (`GOODS`): comida (trigo 8, batata 6, milho 6, carne 24, peixe 10, pão 20, ensopado 21), matérias-primas
  (madeira 6, pedra 5, algodão 9, lã 12, couro 30, erva 14, carvão 12), minérios (cobre 14, ferro 22, ouro 60, jade 140),
  ofícios (corda 2, tecido 31, bloco de pedra 9, barras: cobre 40, ferro 55, aço 95, ouro 145), **ferramentas** (faca /
  machado / picareta / pá de cobre 55 / 105 / 150 / 105; machado / picareta de ferro 140 / 205), **armas e armaduras**
  (flecha 1, arco 30, lança de cobre 115 / de ferro 145, espada de cobre 225 / de ferro 295, escudo de cobre 200 / de ferro
  330, elmo de cobre 220 / de ferro 350, armaduras de couro 210 / de cobre 435 / de ferro 700, sela 190) e roupas (casaco de
  pele 180, gorro de pele 70, túnica 145). Preço = base × fator.
  **Balanço pela raridade** (dono, 5/11/2026: "coletar arbusto dá muita fibra, por isso [a corda] deve valer pouco… uma
  árvore dá até 4 madeiras… não é questão de tempo de fabricação e sim a raridade dos recursos"): o preço de algo fabricado ≈
  1,15 × o valor de mercado do que a receita usa — o raro (minério, couro, barras) é caro, o comum (fibra, madeira, pedra) é
  barato; nada vale menos que as próprias partes. Os itens de cobre entraram no mercado (dono: "falta a armadura de cobre e
  ferramentas de cobre"), no fim da lista (os estoques salvos são guardados pela posição; um save antigo começa os novos no
  volume de referência).
- **Onde se negocia o quê** (dono, a lógica do Mount & Blade — "vilas não têm coisas avançadas"; `TRADE` em
  `game/content/eco.js`): **vila** — o simples e civil (comida simples, pão, madeira, pedra, algodão, lã, couro, erva,
  carvão, corda; os minérios da própria mina); **cidade** — tudo o que é civil (além do simples: comida mais elaborada,
  roupas, construção, ferramentas, barras, gemas), nada de armas; **castelo** — o militar (armas, armaduras, flechas, sela),
  os materiais das armas (barras, couro, madeira, pedra) e a ração da tropa (carne, pão). Assim o jogador viaja à cidade para
  vender o que é mais avançado (e tem motivo para morar lá) e ao castelo para vender armas.
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

O quadro de cada lugar é determinístico (lugar + o dia da economia, que vira no amanhecer do anfitrião, a planta do
lugar, a estação dele e o planeta em volta: anfitrião e convidado veem o mesmo; o anfitrião confere ao
aceitar). Vila 5, cidade 6, castelo 3 pedidos por dia, **só dos tipos que dá para fazer ali** (abaixo, "Trabalhos
possíveis"). O anfitrião vê as ações (`net.js` → `eco.onOp`, antes de aplicar a op) e manda o progresso (`eco.prog`).

| Tipo | Quando aparece | Pedido | Pagamento | Reputação | Prazo |
|---|---|---|---|---|---|
| Colheita | o lugar tem campos, a estação deixa crescer (não no inverno rigoroso) e a lavoura tem ≥ 1,5 × N pés na planta | colher 6–12 pés da lavoura pedida **nos campos do lugar** (o pé dentro do campo; ao lado não conta) | 6·N + 12 | +4 | 2 dias |
| Mina | tem mina e pedra em volta (≥ 2 × N pedregulhos esperados) | 8–15 pedregulhos / blocos de rocha perto (terra externa + 60) | 5·N + 18 | +5 | 2 dias |
| Lenha | vila / castelo / cidade com serraria, com mata em volta (≥ 60 árvores esperadas e ≥ 6 × N) | derrubar 4–7 árvores nos arredores | 10·N + 12 | +4 | 2 dias |
| Encomenda | sempre | trazer N de algo que o lugar consome e não produz (~150–270 moedas de valor) | valor × 1,45 + 10 | +4 | 2 dias |
| Entrega | sempre (destino na mesma terra, 120–1 500 passos, do reino ou vizinho) | levar 1–3 **encomendas** (item) ao mural do destino | 20 + 0,09·distância + 8 por encomenda | +6 / +8 / +10 | 3 dias |
| Caça | há caça nos biomas em volta (os bichos selvagens deles, nomeados no pedido) | caçar 3–5 animais selvagens (qualquer lugar) | 18·N + 10 | +5 | 2 dias |
| Defesa | só nas noites perigosas do lugar (inverno; inverno ameno / estação seca) | derrotar 4–8 mortos da noite perto da vila | 15·N + 40 | +10 | até amanhã |

Na cidade, colheita, mina, lenha e caça pagam ×1,3. Até 3 trabalhos ao mesmo tempo; abandonar: −3 de reputação (a
entrega devolve as encomendas); vencer o prazo: −2. Os nomes de quem pede vêm de `game.towns.people(sid)` quando o
agente dos moradores o expuser; senão, de uma lista de nomes (Bento, o lavrador; Dulce, curtidor; Helena, mercador…).

### Trabalhos possíveis (campos replantados, quadro só com o que dá, waypoints exatos)

O dono (5/11/2026): "um trabalho de colher batata em um campo, o waypoint não estava corretamente indicando no lugar exato
e não tinha batata para colher — tem que dar uma atenção nos trabalhos se são possíveis de realizar". Código:
`game/fields.js` (campos, arredores, alvos locais), `game/eco.js` (`boardOf` / `makeJob`, `jobReason`, `jobTarget`,
`jobArea`, o amanhecer em `dayTick`), op `obj.back` (`mut/objects.js`), `content/eco.js` `JOB_SITE`.

**O que estava errado (confirmado):**
- **Os campos esvaziavam ao carregar.** `flora.js clearUnderStructures` (feito para tirar plantas de baixo das construções
  de um save antigo) rodava uma vez a cada carga e tratava os canteiros (`farm_plot`) dos campos do próprio lugar como
  "construção": tirava todos os pés plantados pelo gerador (`ground.js`) dos lugares já feitos naquela hora — a vila do
  início (Estrosa) começava **sem nenhum pé** em mundo novo (medido: 0 de 21–28 em cada campo, 816 pés das 8 vilas em
  volta se rodasse de novo), e cada save carregado esvaziava os campos de onde o jogador estava. Agora pula as peças do
  lugar (`o.town`).
- **Nada replantava.** Pé colhido some para sempre: a regeneração da flora não planta em terra de lugar (`growWeight`) e
  nem sabia dos canteiros.
- **O waypoint da colheita era a média dos centros de todos os campos da lavoura** — com campos dos dois lados da vila,
  caía na rua / no meio da vila. O da lenha e o da mina eram a serraria / a mina (dentro da vila: árvore e pedra não há).
- **Nada conferia o que o lugar tem**: lenha no meio da estepe, "cervos, javalis, lobos" no deserto, "os campos estão
  maduros" no inverno.

**Os campos são trabalhados (replantio).** Os pés dos campos são objetos do gerador (`ground.js`: um por tile do campo,
cada terceira fileira vazia — os sulcos; ids `(cy·256 + cx)·16384 + 13000 + k`, `isFieldCropId`). Colhido, o pé fica
"gone" (`game.touched`; o save o lista em `gone`). **No amanhecer da economia** (6h, `dayTick` no anfitrião) os
lavradores replantam: todo pé de campo colhido antes daquele amanhecer volta — **o mesmo objeto** (id, lugar, aparência)
pela op `obj.back` (até 64 ids por op, localizada: um convidado longe recebe com o pedaço do mapa depois; quem nunca viu o
pé sumir já o tem) — se a estação do lugar deixa crescer: **não no inverno rigoroso** (com neve; polar: nunca), sim no
inverno ameno e na estação seca. Não volta onde alguém construiu por cima (peça de jogador / de exército). Sem varrer nada
por quadro: uma passada por dia no `game.touched` do anfitrião. Save → load: os colhidos continuam colhidos (lista
`gone`), voltam no amanhecer seguinte do jogo carregado. Os pés dos campos ficam fora dos alvos da regeneração da flora
(não "renascem" como mato fora do campo). A colheita animada dos lavradores (`npc.js`) continua só cosmética.

**O quadro só oferece o que dá para fazer** (determinístico — semente, planta, estação, planeta: igual em todos os pares;
a parte `eco` do digest não muda):
- **Colheita**: só se no amanhecer daquele dia a estação do lugar deixa crescer (aí os campos estão cheios: foram
  replantados) e se a lavoura pedida tem na planta ≥ 1,5 × os pés pedidos. Texto honesto: no outono "É tempo de colheita em
  X…", nas outras estações "Os lavradores de X precisam de ajuda… Eles replantam de madrugada", com o lado do maior campo.
- **Lenha / mina / caça**: pela **vistoria dos arredores** (`fields.js survey`, das células do planeta — 32 × 32 tiles,
  sem carregar nada): árvores esperadas no anel entre a terra do lugar e a terra externa + 90 = densidade de árvores do
  bioma × 0,28 (`TREE_K`, medido em pedaços gerados: 16 lugares de 8 biomas, 0,23–0,48 × a densidade; nas estepes e
  desertos frios a conta fica abaixo do real — 29 esperadas × 38 reais em Estrosa — e é de propósito: lá não há
  lenha); pedregulhos até a terra externa + 60 (0,0012 por tile de terra, mais no cascalho / pedra e nos biomas rochosos —
  medido 0,0014–0,0058); caça: a soma das densidades dos bichos selvagens dos biomas em volta (sem os rebanhos de fazenda
  e os peixes). Números em `content/eco.js JOB_SITE`: lenha ≥ 60 árvores e ≥ 6 × as pedidas, mina ≥ 2 × as pedidas, caça
  ≥ 0,6. Semente 4242: 7 dos 242 lugares sem lenha (Estrosa, Nevães, Galerna, Venalaval, Torre de Dorilde, Torre de
  Cerverna, Ribim da Serra — estepe / deserto frio); caça em todos. A caça nomeia os bichos dos biomas ("coelhos, cavalos
  selvagens, lobos…", "camelos, escorpiões…").
- **Encomenda / entrega / defesa**: como antes (a encomenda segue o que o lugar negocia — `TRADE`).

**O anfitrião confere ao aceitar** (`jobReason`, `job.take`): colheita — os pés da lavoura que restam nos campos do lugar
(a conta da planta − os colhidos que ele conhece) ≥ os pedidos, senão "Os campos de batata de X já foram colhidos: volte
depois que replantarem (de madrugada) ou escolha outro trabalho" / "Só restam N pés de batata nos campos de X: …";
lenha / mina — árvores em pé / pedregulhos e rocha na área do trabalho, contados onde todos os pedaços da área estão
carregados ("Quase não há árvores em pé perto de X (N): escolha outro trabalho"). O mural mostra o mesmo motivo no cartão
(do que este par vê) e deixa "Aceitar" apagado; os outros pedidos continuam lá.

**Waypoints exatos.** Colheita: o meio do **maior campo** da lavoura (um campo de verdade). Lenha / mina: o lado do anel
com mais mata / pedra (o centro de massa do setor de 45° mais rico, puxado para perto). Perto do trabalho, o rastreador
(seta e distância), o marcador dourado no chão, o radar e o mapa levam ao **alvo exato mais perto** — o pé da lavoura nos
campos do lugar, a árvore em pé na área, o pedregulho / a rocha — e o rastreador diz qual ("pé de batata", "árvore",
"pedregulho"); colhido / derrubado, passa ao seguinte (local e cosmético: o mundo carregado deste par, refeito 4 × por
segundo). Longe, o waypoint fixo do trabalho. Caça: sem waypoint (qualquer lugar).

**Progresso**: colheita conta o pé da lavoura do trabalho cujo **tile** está num campo do lugar (antes valia meio tile
fora); lenha / mina na área do trabalho (raio em volta do waypoint ou do lugar); entrega, pagamento e reputação iguais.

### Reputação

| Faixa | Pontos | Nas trocas | |
|---|---|---|---|
| **Odiado** (fase 3a) | −100 ou menos | compra **+100 %**, venda **−60 %** | não entra no reino; não compra casa / terreno |
| **Malvisto** (fase 3a) | −25 … −99 | compra **+50 %**, venda **−40 %** | idem |
| **Desconfiado** (fase 3a) | −1 … −24 | compra **+20 %**, venda **−20 %** | idem |
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

**Reputação herdada (decisão do dono, fase 3a — §13):** ao **entrar** num reino o jogador **herda as relações dele** — a
reputação com **cada outro reino** é **substituída** (aliado do reino: **+40**, já "Conhecido"; em guerra com ele: **−60**,
"Malvisto"; em trégua — acabou de lutar com ele —: **−15**, "Desconfiado"; os outros, inclusive os de outras terras: **0**);
a reputação com o próprio reino não muda. Cada vez que entra num reino isso acontece de novo (substituindo as anteriores).
Ao **sair**, os valores herdados **ficam**: precisa melhorá-los sozinho (comércio, trabalhos). **Não se entra** num reino
com reputação negativa nele ("Sua reputação com o Reino de X é negativa: melhore-a com comércio e trabalhos antes de
entrar"). Reputação negativa **não é inimizade**: ninguém caça o jogador por isso, o comércio e os trabalhos continuam —
só com os preços piores da tabela, e o Comércio diz por quê ("Reputação negativa com o Reino de X (Malvisto, −60): compra
50 % mais cara e venda 40 % mais barata"). Inimigo declarado é só o membro de um reino em guerra com aquele (sem comércio,
como antes). Assim sair do reino para negociar com o inimigo dele como viajante não compensa.

### Propriedades e imposto

- **Casas** (da planta: as moradias com cama): vila — 2 à venda e 1 para alugar; cidade — 4 e 3; castelo — nada
  ("O castelo não vende nada: é uma fortaleza"). Preços: casa pequena 700, casa pequena de taipa 750, casa de pedra
  pequena 900, casa 1 100, casa de pedra 1 300, casa de fazenda 1 400, casa grande 1 500, sobrado 1 900; na cidade
  ×1,6. **Aluguel** (dono, 5/11/2026: "o aluguel tem que subir… pelo menos 4 vezes" o imposto de quem compra — senão não
  vale a pena comprar): por dia, o maior entre **7 % do preço** e **4 × o imposto** que o dono pagaria ao reino que tem o
  lugar (casa pequena na vila: ~49–67 por dia conforme o reino; na cidade ~78–108). Antes era 2 % (casa pequena 14, quase
  o imposto de 13). Vender ao reino: 60 % do preço, menos a dívida.
- **Terrenos**: quadrados livres dentro da terra do lugar (nenhuma peça, rua, praça, campo ou curral; 1 tile das
  construções): primeiro 8 × 8 (vila 400, cidade 900), depois 6 × 6 no que sobra (230 / 510); até 6 na vila e 10 na cidade
  (a vila do início, Estrosa, tem 3 + 3).
- Comprar exige ser **Conhecido** no reino; alugar não exige nada.
- **O que é da vila não é do jogador** (apontamentos do dono, 6/11/2026: "o jogador não deveria poder usar estruturas de
  produção da vila também, nem mesmo baús, o jogador precisa construir essas coisas por conta própria" e "não seja
  possível colher das plantações da vila/cidade/castelo … apenas quando o jogador estiver com um trabalho que exige colher
  algo o jogador vai poder colher apenas aquilo no campo específico do trabalho"):
  - as **estações de produção** do lugar (bancada, mesa de cantaria, fornalha, bigorna, tear, caldeirão, fogueira…) não
    dão "Criar" e não contam como estação para as receitas (`crafting.js` só vê as do jogador — e as de uma casa
    **comprada**: `eco.js ownsPiece`);
  - os **baús** do lugar só se abrem numa casa **comprada**, pelo dono (`TOWN.mayUse` → `ownsPiece`; o anfitrião recusa
    `chest.take` / `chest.put`); a casa **alugada** fica com a porta e as camas (`mayUsePiece`), não com os baús;
  - as **portas** dos prédios do lugar (não os portões) só abrem para quem tem a casa — comprada ou alugada no mural
    (apontamento do dono, 6/11/2026: "eu não posso abrir portas das casas da vila, apenas das casas alugadas por mim ou
    construídas por mim"): a casa de um morador, a oficina, a casa à venda / para alugar não dão "Abrir" e o anfitrião
    recusa `door.toggle` ("Casa pequena de X: só os moradores abrem", "Casa para alugar: alugue no mural de X"; `eco.js
    E.doorReason` por `TOWN.gateReason`). Uma porta dessas que ficou aberta (de quem deixou a casa, de antes desta regra)
    o anfitrião fecha sozinho a cada ~4 s, com a passagem livre (`towns.js hostTick`, `E.heldDoor`). O que o jogador
    constrói continua dele. Teste **VL16**;
  - as **plantações** dos campos do lugar (`fields.js fieldOf`) não dão "Colher" e o anfitrião recusa a colheita
    (`eco.js harvestWhy`, `gather.hit`), a não ser para quem tem um **trabalho de colheita daquele produto ali**, ainda
    não completo — e só nos campos daquele lugar. Plantas silvestres continuam livres. Testes **EC9**, **JB1**.
  - **dentro da casa** que o jogador tem (`eco.js houseReason`, por `TOWN.landReason`; apontamento do dono: "apenas luz
    pode ser construída em casa alugada"): alugada — só estruturas de luz (`cat` 'light': tocha, braseiro, poste,
    fogueira); comprada — também estruturas de produção ('prod') e móveis ('furn': baú, cama, mesa…); a casa de outro,
    nada. Perdida a casa
    (aluguel vencido, lugar tomado), o que o jogador pôs dentro sai junto, como num terreno (`plotBuildings`).
- **Os trabalhos de coleta pedem a coisa, não o trabalho** (apontamentos do dono, 6/11/2026: "quando um trabalho envolve
  entregar itens, eles deveriam sumir do inventário do jogador" e "os trabalhos de coleta não devem ser cortar x árvores
  ou colher x trigo/batata/milho, e sim colher/coletar x coisa naquele local ou coletar x madeira e entregar, para que seja
  removido exatamente do inventário, pois eu estou conseguindo colher milho e ficando com eles para mim"):
  - **Colheita** — "Colher N milho" (8–16 do produto): cada pé do campo do trabalho dá o produto **direto na mochila**
    (1–2; algodão 2–3), nunca mais do que o trabalho ainda pede, e **sem sementes** — tudo é do lugar (`mut/objects.js
    gather.hit` → `eco.js fieldTake`, `content/eco.js CROP_YIELD`). O progresso conta o produto; quando chega a N o campo
    fecha para o jogador ("Você já colheu N milho do trabalho: o resto da plantação é da vila"). Saem dos campos
    exatamente N, e exatamente N saem da mochila ao entregar.
  - **Lenha / mina** — "Coletar N madeiras" (12–21) / "Coletar N pedras" (10–19): conta a madeira / pedra **recolhida do
    chão** que caiu de uma árvore cortada (`tree.land`, toco) ou de pedra quebrada (pedregulho, rocha: `obj.remove`,
    `tile.mine`) perto do lugar — o anfitrião marca esses itens (`eco.js tagDrops`) e soma no `loot.take`. Madeira ou pedra
    comprada ou largada por um jogador não conta. Ao entregar saem exatamente N.
  - Entregar sem os N na mochila: o anfitrião recusa ("Entregue N …"); o cartão e o rastreador mostram "traga N … (tem
    X)". Caça e defesa continuam contando o trabalho. Os pedidos do quadro olham a terra em plantas / árvores / pedras
    que o produto pede (`plantsFor`, ~4 madeiras por árvore, ~3 pedras por pedregulho). Testes **EC3**, **JB2**, **JB5**.
- **Comprar a matéria-prima e vender o que ela faz nunca dá lucro** (apontamentos do dono, 6/11/2026: "o jogador pode
  comprar trigo e fazer pão e vender o pão que é caro … faça com que a compra seja metade do preço da venda do pão" e "o pão
  e o trigo não deveriam ter um valor de venda maior que a carne e o couro"): num mercado que compra e vende os dois, o produto
  feito de uma só matéria-prima nunca é vendido por mais do que custa comprar ali a matéria-prima que ele gasta (`eco.js
  madeCap`, das receitas: pão ≤ 2 trigos, barra ≤ 2 minérios, pano ≤ 3 algodões, carvão ≤ 3 madeiras, bloco ≤ 1,5 pedra) — a
  curva de venda inteira desce o que for preciso (cada unidade vendida continua baixando o preço); a matéria-prima guarda o
  preço do mercado dela (oferta e procura). E os preços de base (dono, depois: "a batata tá valendo mais a pena ser vendida que o trigo e
  o pão … deveria apenas ter aumentado o valor da carne e o couro e não ter diminuído do trigo e do pão"): trigo **8**
  (acima da batata e do milho, 6), pão **20** (≈ 1,15 × 2 trigos + o combustível; era 24), e carne 12 → **24**, couro
  24 → **30**, acima deles — o que é feito de couro / carne acompanha (ensopado 21, armadura de couro 210, sela 190, casaco
  de pele 180…). Teste **EC10**.
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
dois (e o waypoint num campo da lavoura; perto dos campos o marcador num pé de verdade); EC4 entrega para um lugar alcançável por terra (encomendas na mochila, recusada na origem, paga no destino); EC5
casa (recusa sem reputação; compra; o baú abre para o dono e não para o outro; a porta recusa o outro) e terreno (muro
dentro pode, ao lado não); EC6 imposto (pago da mochila com aviso; sem moedas: dívida, avisos de 3 / 2 / último dia; no
quarto dia o reino toma; −15); EC7 entrar / sair do reino pela aba Reino; membro recusado em reino de outra terra,
viajante compra; EC8 o save (JSON) carregado num jogo novo dá a mesma economia (linhas do digest iguais) e os mesmos
preços. Todos terminam com o digest igual. KG7 passou a conferir as abas novas (só Exército diz "Em breve").
**JB1–JB4** (trabalhos possíveis): JB1 o maior campo de Estrosa cheio nos dois (a conta da planta), colhido (um pelo
convidado, o resto pelo anfitrião), sumido nos dois e no save; no amanhecer seguinte em que cresce todos os pés voltam nos
dois — os mesmos objetos —; no inverno rigoroso ficam sem nada (e sem colheita no quadro); o save carregado num jogo novo:
ainda colhidos, de volta no amanhecer dele. JB2 campos colhidos: o cartão diz "Só restam N pés…" / "já foram colhidos",
"Aceitar" apagado, o anfitrião recusa com o motivo; no amanhecer, possível de novo; um pé ao lado do campo não conta, no
campo conta. JB3 os quadros de 14 lugares × 7 dias iguais nos dois pares, cada colheita num campo da lavoura, nenhum
"maduros", lenha / mina no anel e com mata / pedra; aceito um trabalho de lenha, no lado da mata o marcador fica numa
árvore em pé da área. JB4 os quadros da terra do início (e dos lugares sem mata) contra a vistoria; contando nos pedaços
gerados, quem oferece lenha tem ≥ 42 árvores em volta. Prints (`shots/`, fora do git; sem o painel de depuração):
`jb_board` (o quadro de Nevães: "Colher 10 trigo … o maior fica a sudeste. Eles replantam de madrugada", só pedidos
possíveis), `jb_marker_plant` (perto do campo: o marcador dourado num pé de trigo, o rastreador "pé de trigo · 4
passos"), `jb_field_harvested` (o campo colhido), `jb_board_refused` (o cartão: "Os campos de trigo de Nevães já foram
colhidos: volte depois que replantarem…", Aceitar apagado), `jb_field_replanted` (o mesmo campo no dia seguinte, cheio).

Prints em `shots/` (fora do git): `ec_trade_desktop`, `ec_jobs_desktop`, `ec_land_desktop`, `ec_realm_desktop`,
`ec_trade_phone`, `ec_jobs_phone`, `ec_land_phone`, `ec_realm_phone` (915 × 412, toque), `ec_*_portrait` (430 × 932),
`ec_tracker_hud`, `ec_tracker_phone`, `ec_tax_notice`, `ec_tax_paid`, `ec_plots_world`.

### Decisões (para o dono confirmar)

- O imposto sai **só das moedas da mochila** (as dos baús não contam) e só nos dias em que o dono está no mundo.
- Comprar casa ou terreno pede reputação **Conhecido** (25) no reino; alugar não pede nada.
- Casa vendida, devolvida ou tomada: os baús dela são esvaziados (ficam para o reino). ~~Terreno tomado: o que o jogador
  construiu nele fica de pé~~ — **mudado pelo dono na fase 3a (§13 "Propriedades")**: toda propriedade perdida (tomada por
  imposto, perdida com o lugar conquistado numa guerra, devolvida / vendida ao reino) volta para a lista de venda / aluguel
  do lugar, sem dívida, e **tudo o que o jogador construiu no terreno some** (um caminho só: `game/eco.js loseProps`).
- Membro de um reino só negocia com reinos da mesma terra (e, na fase 3, que não estejam em guerra com o seu); viajante
  com todos. Ser membro ainda não dá vantagem (fase 3: exército) — o cartão explica.
- As casas à venda / para alugar saem das moradias da planta; para o agente dos moradores: `game.eco.api.props(sid)`
  lista quais são, e `game.eco.pr` diz quem mora nelas — morador nenhum dorme numa casa comprada (feito no §11).
- **Trabalhos possíveis** (5/11/2026, pedido do dono — "Trabalhos possíveis" acima), para confirmar:
  - os campos são **replantados no amanhecer seguinte** à colheita (tudo o que foi colhido antes das 6h volta), não "um ou
    dois dias": simples, e o quadro de cada dia pode contar com os campos cheios. Se ficar generoso demais (cada pé dá 1–2
    batatas e sementes, todo dia), dá para trocar por "dois amanheceres" guardando o dia da colheita de cada pé;
  - **no inverno rigoroso** (com neve; polar sempre) nada é replantado e **não há colheita no quadro**; no inverno ameno e
    na estação seca, sim;
  - **sem lenha onde quase não há mata** (estepe, desertos): na semente 4242 a vila do início e as vizinhas da estepe
    (Estrosa, Nevães, Galerna, Venalaval…) não pedem lenha; quem pede tem ≥ 60 árvores esperadas em volta;
  - a mina conta **pedregulhos** (e rocha): em volta das vilas medidas não há rocha exposta no raio da mina (0 em 16
    lugares), só pedregulhos (36–174) — o texto diz "pedregulhos ou blocos de rocha";
  - o aviso no cartão do mural ("já foram colhidos", "Quase não há árvores…") é o que **este** par vê; quem decide é o
    anfitrião ao aceitar.
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
  - **corpo a corpo**: nos portões (por dentro; dois nos do lado do ataque, um num portão virado para outra frente, um em
    cada um quando não se sabe o lado), o resto no **trecho da muralha**
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
  - **O alarme dura até a ameaça ser neutralizada** (apontamento do dono, 5/11/2026: "os arqueiros saem das muralhas
    depois de um tempo mesmo estando em confronto com um monstro … o alerta de monstro funciona apenas por 5 segundos ao
    invés de sumir apenas quando a ameaça estar neutralizada"): antes o sino parava 6 s depois de o hostil sair do anel do
    alarme (a terra + 6 tiles) — um monstro que recuava uns passos, que batia na muralha de fora ou que ficava parado
    longe derrubava o alarme e a guarda largava os postos (os arqueiros desciam) e voltava logo depois. Agora um hostil que
    entrou no anel **ou ataca o lugar** (quebra uma peça dele, luta com alguém do lugar, uma onda de ataque — §16) continua
    inimigo enquanto **vive** dentro da terra + **30** tiles e chegou perto / atacou nos últimos **40 s** (`people.js
    dangerOf`, `rec.seen`; `PEOPLE.alarmHold` / `alarmMemory`); os poucos segundos de calma vêm só depois que todos
    morreram ou foram embora. Enquanto isso todos ficam nos postos.
  - **Arqueiros que não alcançam** (o mesmo apontamento: "fica parado em um lugar apenas e não consegue chegar no range de
    ataque do arco"): o arqueiro no alto da muralha com um inimigo fora do alcance / sem linha de tiro **anda pelo alto da
    muralha** (o adarve: as peças da linha e o tile logo por dentro, um piso **onde dá para ficar em pé** no andar 1 / 2 —
    `levels.surf` sem nada construído naquele andar, `defense.js standOn`: a muralha de pedra tem 2 andares e o topo da
    peça de baixo, no andar 1, fica dentro da pedra de cima; antes os arqueiros da guarda de castelo / cidade iam para lá e
    só a ponta da cabeça aparecia — apontamento do dono, 6/11/2026 —, e os postos das torres e escadas) até o ponto mais perto que tem alcance e linha de tiro — um caminho pelo adarve, nunca descendo; fora da vista
    ele já está lá — e, passada a luta, volta ao posto (`npc.js wallWalk / wallSpot / walkPath / walkWall`). No chão, sem
    progresso em 3 s (um muro no caminho, gente, um inimigo que não se alcança), ele procura outro ponto em volta do
    inimigo, a ~70 % do alcance, que ele alcança andando e de onde vê o alvo (`archerSpot`). Teste **VL13**.
  - **A guarda no lado atacado** (apontamento do dono, 5/11/2026: "os soldados não estão focados apenas em uma parte da
    muralha que é de onde estão vindo o inimigo"): com o ataque vindo de um lado, **todos os arqueiros** vão para o adarve
    **daquele lado**, espalhados ~2,5 tiles em volta de onde o ataque bate (`defense.js frontSpots` sobre `wallWalk`); os
    portões virados para ele ganham dois guardas e os outros nenhum (estão fechados); o trecho de corpo a corpo é o arco de
    ~120° do lado do ataque (`PEOPLE.def.front` 0,45), mais largo só quando ali há poucos pontos; a reserva (cidade /
    castelo) fica no torreão. Quando o lado muda (8 setores), os postos mudam — e quem já está no alto **anda pelo adarve**
    até o novo posto (`walkPath`), em vez de descer e subir de novo. Vale para os ataques do inverno, os monstros perto
    dos lugares e os cercos.
  - **As frentes: dividir só proporcionalmente** (apontamento do dono, 6/11/2026: "os arqueiros ficam em uma parte da
    muralha enquanto a invasão está acontecendo do outro lado … o único momento em que os soldados e arqueiros se dividem é
    caso uma segunda invasão aconteça em algum outro lado da muralha, mas a divisão tem que ser proporcional ao tamanho da
    invasão daquele lado, por exemplo … alguns lobos decidem aparecer de um lado, não é para dividir ao meio o exército
    defensor"): a defesa vê **frentes** (`defense.js frontsOf`) — os inimigos fora da muralha pelos 8 setores em volta do
    lugar (um gigante / pesado pesa 3, os outros 1), setores vizinhos numa frente só (no máximo 3 setores; uma fileira
    mais longa é cortada no setor mais fraco); um **exército de cerco** pesa o número inteiro dele no **lado que ataca**
    (os soldados dele não contam onde estão). A maior é a **frente principal** (`th`, a "ameaça" de antes, com a mesma
    folga para trocar de lado); cada outra frente recebe **a sua parte, proporcional ao peso** (`shareOut`:
    `round(n × peso / total)`) dos arqueiros (os mais perto dela, no adarve daquele lado), do trecho de corpo a corpo e um
    guarda no portão virado para ela; a principal fica com o resto. Uma frente pequena demais para uma parte (menos de
    1/40 do total) não leva ninguém. Ex.: um cerco de 80 e 4 lobos atrás do castelo → de 24 arqueiros, 1 vai para trás; os
    lobos mortos, ele volta. A assinatura da defesa inclui as frentes e a parte de cada uma (de 20). Vale para a guarda do
    lugar (`people.js defenseTick`, `game.townDefense.fronts(sid)`) e para a guarnição da escaramuça (`skirmish.js
    garrisonPosts`, que agora também enxerga e combate as criaturas hostis no lugar — `soldier.js isFoe`, `m.holds`).
  - **O lado do cerco é o que ele ataca** (o mesmo apontamento): a ameaça do cerco era a direção **de onde o exército
    chegou**; o plano dele escolhe um dos 4 lados da muralha (o que tem portão para o aríete, lugar para as torres, para
    os trabucos), que pode ser o lado vizinho — e a defesa ficava no lado errado. Agora `siegeAI.js siegeThreat` é o
    **lado do plano**, com o ponto onde ele bate (`hit`: o meio das peças que o aríete, as torres e os trabucos atacam e
    das brechas daquele lado), e os arqueiros se espalham em volta desse ponto. Teste **CB7**.
  - **A torre de cerco** (apontamento do dono, 6/11/2026: "os soldados corpo a corpo devem ficar um pouco na muralha também
    caso tenha torre de cerco para fazer uma defesa contra os soldados que vão desembarcar na muralha"): enquanto uma
    torre do exército de cerco estiver de pé (pronta, não queimada — `siegeAI.js siegeTowers`, `game.warfare.towersOn`:
    a peça da muralha para onde ela vai e o andar do deque), uma parte dos guardas de corpo a corpo (20 %, de 2 a 4 por
    torre: `PEOPLE.def.towerK / towerMin / towerMax`) sobe ao adarve **onde a rampa vai descer** (`defense.js towerSpots`:
    os pontos do adarve no andar da torre a até 3,3 tiles da peça, os do lado e o de dentro primeiro). Lá em cima
    (`npc.js wallFight`) eles enfrentam quem atravessa a rampa — os inimigos no mesmo andar a até 10 tiles do posto, andando
    pelo adarve até eles (`wallStep`) —, os de lança arremessam a lança nos de baixo (a equipe que empurra a torre, quem
    sobe a escada dela) e, passada a luta, voltam ao posto. Torre derrubada ou fim do cerco: os postos voltam ao normal (a
    assinatura da defesa inclui as torres). A guarnição da escaramuça faz o mesmo com os soldados (3 a 5 por torre, nunca o
    general — `skirmish.js garrisonPosts`). Teste **CB6**.
  - **Duas torres de cerco** (apontamento do dono, 6/11/2026: "no cerco devem ter 2 torres de cerco"): o plano do cerco
    (`siegeAI.js plan`, `want.tower` 2) põe até duas torres no lado que ataca, a ~8 tiles do portão do aríete (uma de cada
    lado quando cabem) e a ≥ 6 tiles uma da outra; cada uma com a equipe que empurra, os que sobem (10 cada) e os
    defensores que esperam no adarve. A 3a (por números) quer 2 torres para castelos e cidades.
  - **As torres de cerco levam dano de catapultas** (o mesmo apontamento: "elas podem receber dano de catapultas (não sei
    se ela já recebem, pois não vi uma torre ser destruída ainda)"): antes só as balistas da guarda (240 por virote) as
    feriam — nenhuma catapulta dos defensores existia, e a pedra / o virote de um jogador nunca feria máquina de exército.
    Agora:
    - **castelos e cidades têm catapultas** em 4 torres da muralha (uma virada para cada lado, onde não há balista —
      `world/realm/layout.js catapultsOn`, andar 2), guarnecidas como as balistas (`hooks.artillery`, as do lado do ataque
      primeiro). A equipe (`npc.js catapultTask`) atira nas máquinas do cerco ao alcance (5–26 tiles): **a torre primeiro**,
      depois o aríete, os trabucos; a pedra vai onde a torre empurrada **vai estar** quando cair (a velocidade medida entre
      duas olhadas × o voo; a torre mais danificada primeiro); sem máquina ao alcance, num grupo de 3+ soldados inimigos —
      nunca nos monstros (uma pedra é o dano da balista: dois matariam um gigante — as ondas do inverno seguem como eram). O tiro é o de um jogador
      (`mut/siege.js fireShot`: recarga, dispersão, ops `siege.set` / `siege.shot`) por `~<nid>` — o golpe é do guarda;
      160 por pedra (a torre tem 2000: ~13 pedras), nunca nas peças do próprio lugar nem nos seus;
    - o impacto sabe **de quem é o tiro** (`siege.js siegeImpact`): a máquina de um lugar é do reino dono dele; a de um
      exército, do reino dele; a de um jogador (sem reino) segue **a regra dos soldados** (`warfare.js
      playerMayHurtStruct`, `mayHurtStruct`): o outro lado da escaramuça, um reino em guerra com o dele, ou um viajante
      contra um exército que está atacando um lugar — então a catapulta / o trabuco / a balista de um jogador também
      quebram as máquinas e o acampamento de um exército que cerca um lugar, e as pedras dele ferem os soldados dele;
    - a torre quebrada some (`struct.remove`), quem está nela cai, e a defesa larga os postos do adarve dela. Teste **CB8**.
  - **Os mortos da noite dividem a atenção** (o mesmo apontamento: "os inimigos estão focando mais no jogador do que nos
    soldados … focar no jogador apenas se for atacado, se estiver mais perto que outro soldado, ou se decidirem atacar o
    jogador mesmo assim"): andarilhos, esqueletos, múmias e gigantes escolhem entre **todos** os corpos que veem / sentem
    perto — jogadores, o povo na rua, soldados — pela distância × (1 + 0,55 por outro morto já em cima dele: a luta se
    espalha), **quem os atacou nos últimos 8 s primeiro** (× 0,5), e um jogador vale × 1,8 a não ser que os tenha atacado,
    seja o mais perto de todos ou que aquele morto seja dos poucos (~1 em 7) que vão atrás dos jogadores de todo jeito
    (`walkers.js pickBody`; a atenção é revista a cada ~1 s, também no meio de uma luta com o povo). Antes eles sentiam o
    jogador através das paredes e o povo só com linha de visão. Teste **WA7**.
  - **Barato**: os postos só são refeitos quando algo muda — o alarme começa / acaba, uma abertura aparece / some, o lado
    do ataque muda (8 setores, com folga para não ficar trocando), um guarda morre / volta — a cada meio segundo só se
    compara uma assinatura; quem caça quem dentro dos muros é refeito no mesmo meio segundo (poucos inimigos × poucos
    guardas). Nada por quadro.
  - **Fase 3** usa o mesmo: `game.townDefense.perimeter(sid)` (a linha: peças, `inside(x, y)`), `.openings(sid)`,
    `.threat(sid)` (o lado do ataque: `{ fx, fy, sector }`), `.fronts(sid)` (as frentes: `[principal, outras]`, `{ fx,
    fy, sector, w, q, hit }`), `.posts(sid)` (os postos agora, anfitrião), `.assign(sid, threat, danger)` (os postos para
    uma ameaça dada — um exército chegando por um lado).
- **Nível** (§7b): `realmNpcLevel` = o maior entre o nível pela distância e o **progresso do mundo** — agora um recorde
  guardado (`game.towns.prog`, op `town.prog`, linha `wprog` no save / snapshot, nunca desce), até o nível dos lugares
  mais distantes. Civis: 2 níveis abaixo.
- **Mortes**: monstros ferem e matam o povo; sem corpo e sem saque. Op `town.pop` (morto, hora) → linhas `tpop` no save /
  snapshot e no digest; sem aviso por morte (dono: numa batalha há muitos mortos — seria um enxame de mensagens). **Repovoar**: cada morte é reposta 1,5 dia depois (um recém-chegado
  com a mesma identidade da semente).

### Quem a guarda enfrenta primeiro

Apontamento do dono (6/11/2026): "os soldados estão atacando lobos ao invés de andarilhos, os andarilhos devem ter prioridade
já que eles destroem estruturas". A guarda (`npc.js guardTargets`, `postedFoe`, `focusFoe`) pesa a distância de cada inimigo
por `prioK`: os mortos da noite, um gigante, os saqueadores, os soldados de um exército, quem está quebrando uma peça ou faz
parte de um ataque ao lugar contam **0,4** da distância; um lobo (que só ronda) conta a distância inteira. Um guarda ocupado
com um lobo troca para um desses quando ele aparece; ocupado com um deles, segue nele. Do outro lado, **o andarilho não larga
o muro** por quem não alcança (o mesmo apontamento: "os andarilhos param de atacar o muro se um soldado atacar eles"): ferido
por um arqueiro no alto da paliçada / muralha (ou por quem está atrás de um muro, sem linha entre eles), ele o deixa e volta à
peça que quebrava (`walkers.js walkerBrain`; antes só os de uma onda de ataque faziam isso — os da noite ficavam parados
debaixo do arqueiro). Teste **WA8**.

### O portão à noite

Apontamento do dono (6/11/2026): "tem que permitir o jogador abrir o portão à noite se fizer parte do reino, o portão fecha
automaticamente após 2 segundos se não tiver ninguém no meio do portão". O portão de um lugar é da guarda (abre de dia, fecha
à noite e no perigo), mas um **membro do reino dono do lugar** abre à noite quando nada ameaça o lugar (nenhum hostil dentro,
nenhum exército diante dele): "Abrir" aparece para ele, o anfitrião aceita o `door.toggle` (`towns.js TOWN.gateReason`) e
guarda a hora (`TOWN.gateOpened` → `memberGates`); enquanto alguém está no vão o portão fica aberto, e **2 s** depois de o vão
ficar livre ele fecha sozinho (`townsSystem`). Um viajante: "O portão é da guarda: à noite só quem é do reino abre". Teste
**VL15**.

O alcance (apontamento do dono: "não estou conseguindo interagir com o portão da vila, o raio de interação deve estar muito
pequeno ou ruim"): o portão de 2 tiles se usa a até **1,6 tile** dele (a porta comum, 1,1) e vem antes de uma pessoa parada
ao lado (prioridade 3,4 contra 2,5 do "Conversar"); o clique / toque pega o portão na altura toda do desenho (1,45 tile acima
do chão; a porta, 1 — eram 0,55, só a metade de baixo); e o portão fechado que o jogador não pode abrir não fica mudo:
"Portão fechado" e, ao usar, o motivo na tela (`building.js` kind `locked`).


### Os animais mortos perto do lugar

Apontamento do dono (6/11/2026): "os lobos que são mortos pelos guardas são praticamente carne e couro de graça para o
jogador, faça com que a população colete os lobos também, fazendo com que o amanhecer seja uma corrida para conseguir carne
e couro de 'graça'". De dia (`PEOPLE.scav.hours` 5,8–19 h, sem alarme), o corpo **fresco** de um animal (primeiro dia, ainda
não coletado, ninguém arrastando) na terra do lugar + 14 tiles, morto há **30 s** ou mais (quem o matou tem esse tempo para
coletar), chama o trabalhador livre mais perto (lavrador, pastor, carregador, lenhador, ferreiro, mineiro, cavalariço,
morador, taverneiro, tecelão — adulto, fora de luta e de conserto; até 3 de uma vez): ele vai às pressas, "coleta" no tempo
do tamanho (2,4 / 3,6 / 5,4 s) e o corpo vira carcaça para todos (op `corpse.butcher` por `npc`: a carne e o couro são do
lugar — ninguém recebe). À noite o povo está em casa: os lobos que a guarda derrubou esperam o amanhecer, e aí é uma corrida
entre o jogador e o povo (`npc.js scavTick / scavWork`). Teste **VL14**.

### Consertos

- **De dia** (7–18,6 h, sem perigo), com o povo do lugar na rua: um trabalhador (lenhador, ferreiro, carregador,
  lavrador, mineiro, cavalariço) ou um guarda da ronda vai até a peça rachada (o lado de onde dá para chegar) e bate o
  martelo: a cada 2,2 s a rachadura cai 12 % (madeira), 7 % (pedra), 3 % (dano de cerco, `o.sdmg`) — ops `struct.dmg` /
  `siege.dmg`. Até 3 consertos ao mesmo tempo, os andares de baixo primeiro. Uma peça **destruída** há mais de 20 s é
  **refeita** pelos trabalhadores (9 s de martelo, ninguém no lugar → op `town.restore`; a peça volta na hora mesmo com o
  chunk carregado — corrigido em `towns.js resyncPieces`).
  Quem refaz não conta como "alguém no lugar" (do lado da peça ele fica a ~0,7 do meio do tile: esperava por si mesmo
  para sempre — §16, WA2). Um caminho até a peça que não dá certo (buscas falhando com um jogador olhando, sem o passo
  fora da vista) ou que não termina em 60 s faz a pessoa largar aquela peça por 20 s; outra tenta (`npc.js repairWork`).
  A propriedade **privada** de um jogador nunca é consertada nem refeita (§16).
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
- **Parada na conversa** (dono): enquanto o cartão está aberto a pessoa **para** onde está (o que ela ia fazer espera),
  vira para quem fala com ela e gesticula — intent `npc.talk` (abrir / a cada 8 s / fechar; o anfitrião solta sozinho
  depois de 40 s sem notícia, se o jogador se afasta 5 tiles, com o sino ou numa luta). **Em luta não se conversa**
  (dono): quem está brigando (perseguindo um inimigo ou golpeando / atirando — o estado e a ação vêm no fluxo, iguais nos
  dois pares) não mostra o botão "Conversar", um toque nela não faz nada e o cartão não abre (e fecha se ela começa a
  lutar). Teste VL10.
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
corpo vai segurá-la (na abertura / logo por dentro); depois do "tudo calmo", um guarda continua nela. **VL13** (apontamento do dono, 5/11/2026): um lobo forte 6 tiles fora da paliçada, recuando 9 tiles além da terra
do lugar e voltando, por 65 s — o sino nunca para, nenhum arqueiro desce da muralha, todos acertam o lobo (andando pelo
adarve até ter alcance), o corpo a corpo nos postos; o "tudo calmo" só quando ele morre.
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
| **3c — o jogador no exército** (depois de 3a + 3b) | entrar pelo mural, ordens do general na tela, waypoints no mapa / minimapa, quem pode bater em quem, morrer na guerra sem perder reputação, pagamento | `game/army.js`, `game/mut/army.js`, `game/content/army.js`, `ui/armyHud.js` (§15) | `AR1…` |

### O que 3a oferece (`game.realms`, em todos os pares; estado replicado, decidido no anfitrião)

- `rel(a, b)` → `'self' | 'ally' | 'neutral' | 'war'` (simétrico) e `atWar(a, b)` (o gancho que `siegeCanDamage`,
  `eco.js` e os soldados já consultam). Reinos que **não se ligam por terra** (`canReach`) são sempre `'neutral'`.
  (Feito na 3a — §13: a trégua de um tratado de paz conta como `'neutral'`; o detalhe — desde quando, quem declarou, o
  cansaço, a trégua, a tensão — em `relInfo(a, b)`; o estado das relações fica no `Map` `game.realms.rels`.)
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
- **Como ficou na 3a (§13 — leia lá os detalhes; nada do acima foi tirado, só acrescentado):**
  - `armies` também guarda o **exército de casa** de cada lugar (`'g<sid>'`, `state 'home'`: a guarnição, `n` = soldados
    em casa); os do campo são `'a<n>'`. Campos a mais: `n0`, `mission` (`'attack' | 'relief' | 'join' | 'return'`), `grp`
    (a campanha: os contingentes `'join'` vão até o exército principal, que espera em `state 'camp'`, `phase 'muster'`, no
    lugar de reunião), `path` (`{ f, r: [estrada, sentido, …] }` pelas estradas, ou `{ f, t, c: [células] }` pelo campo),
    `t0`, `d0`, `v` (a marcha: a posição sai do relógio — `game.realms.posOf(a)` / `routeOf(a)`), `phase`, `hrs`, `bp`,
    `dw`, `foe`, `since`. `eng` é `[trabuco, catapulta, aríete, torre]`; `report` / `dematerialize` aceitam o array ou o
    objeto `{ treb, cat, ram, tower }`.
  - Com `live`, a marcha fica parada nos números (`v = 0`); `report(id, { n, eng, state, x, y })` atualiza; ao voltar
    (`dematerialize`), a marcha continua do ponto da rota mais perto de onde os soldados estavam; `siege` pode trazer
    `{ hrs, dw, bp, phase }`.
  - Quando o anfitrião não tem `game.warfare`, `live` nunca é marcado (os números seguem mesmo com um jogador perto; o
    lugar cercado perto de um jogador toca o sino, o povo fica em casa e a guarda vai para o lado do acampamento).
  - Eventos (`game.events`, em todos os pares): `capture { sid, from, to }`, `realms { type: 'rel' | 'army' | 'capture' |
    'fall' | 'wall' | 'day' | 'start' | 'sync', … }`, `realmnews { row }` (a notícia: `game.realms.newsText(row)`),
    `realmowner { sid, k }`.
  - **Para a 3b (reputação por ajudar / atacar — decisão do dono)**: `game.realms.reward(pid, k, d, motivo)` (anfitrião)
    soma `d` à reputação do jogador no reino `k` (op `eco.rep`, com aviso). O lado que a 3b vê (quem bateu em quem) decide.
  - Sem carência para o reino do início (tirada pelo dono em 2026-11-06): só o 1º dia do mundo é calmo, para todos os
    reinos (§13). `realm.rel` (depuração) ignora o dia calmo mas nunca a regra das terras.
  - **Acrescentado na 3c (§15)**: `settle(id, { n, outcome: 'won' | 'lost' | 'taken' | 'lifted', x, y })` (anfitrião) — a
    3b chama em `finishForce` e a 3a retoma os números na hora (volta para casa, segura o lugar, segue); `capture(sid, k,
    { army, n })` — a guarnição nova sai dos vencedores (metade, até o máximo; sem exército: 30 % do máximo); um exército
    vivo que muda de estado é entregue de novo à 3b na forma nova (rematerializado); uma marcha viva **escoltada** por um
    jogador alistado dela (`game.army.escorted`) mantém o relógio da 3a.

### O que 3b oferece (`game.warfare`, anfitrião; os soldados são criaturas no fluxo de entidades como o povo)

- `materialize(army)` / `dematerialize(id)` (acima); `forces` (o que está vivo agora); `startSiege(spec)` e
  `startBattle(a, b)` de depuração (testes sem a 3a: `spec = { k, sid alvo, n, lv, eng, at: [x, y] }`).
- Quem é inimigo de quem: `atWar(game, a, b)` = `game.realms?.atWar?.(a, b)`. Os testes BT forçam as guerras com a op
  de depuração `realm.rel` da 3a (o calço que havia antes da junção saiu). Nada de calço em `src/`.
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
- **Fase 3c (§15)**: um jogador **alistado** num exército de um reino em guerra também pode ferir a **guarda** dos lugares
  inimigos (nunca civis), os guardas e soldados inimigos o tratam como inimigo, e jogadores membros de reinos em guerra
  lutam entre si (PvP) — `game.army` (`npcWhy`, `townFoe`, `soldierFoe`, `pvpWhy`); os soldados de um exército deixam o
  jogador alistado nele empurrar / operar as máquinas do exército.
- `game.realms.rel(a, b)` é lido também (`'ally'`: um aliado do reino do jogador continua protegido). A devolução de um
  exército da 3a é sempre da 3a (`liveCheck`: ninguém a 150 tiles → `dematerialize`); a 3b só encerra sozinha as forças
  de depuração (`startSiege` / `startBattle` sem exército da 3a). O que ficou na junção: §14 "A passagem com a 3a".

### Regras comuns

- Anfitrião autoritativo; o estado novo vai no snapshot, no save e no digest (partes próprias); tudo igual nos dois pares.
- §7b vale para soldados e para a força dos exércitos nos números (`realmNpcLevel`).
- O reino do início não entra em guerra nos **2 primeiros dias** do mundo (decisão do dono; §13); guerras não
  podem acabar com o mundo do jogador de repente — avisos claros antes ("O Reino de X declarou guerra ao Reino de Y",
  "Um exército de X marcha sobre Y").
- Os reinos **não** cercam as bases dos jogadores (§4).
- Cada parte escreve a sua seção de implementação aqui (como §9–§11) e deixa prints em `shots/` (fora do git).

## 13. Fase 3a — diplomacia e exércitos

Feito: os reinos têm **relações** (aliado / em paz / em guerra, com trégua depois de uma paz) que mudam sozinhas ao longo
dos dias; cada lugar tem **dono** (o reino que o tem agora) e um **exército**; os reinos em guerra fazem **campanhas** — os
contingentes se juntam num lugar de reunião e marcham **pelas estradas** do reino (ou pelo campo, quando não há estrada
entre eles) —, se enfrentam em **batalhas**, **cercam** vilas, castelos e cidades, quebram muralhas e portões (o estrago
fica), **tomam** lugares e um reino sem cidade **cai**. Longe dos jogadores tudo é por números; perto, a 3b joga (§12).
Mapa, radar, mural (Reino e Exército), faixa do lugar, avisos e mercados conversam com isso.

**Nunca por dentro de um lugar inimigo** (apontamento do dono, 6/11/2026: "exércitos estão conseguindo passar por dentro de
cidades do reino inimigo … o exército vermelho passou por dentro de Outeiro"): as estradas ligam os lugares, então a rota
passava pelos lugares do caminho, os do inimigo também. Agora a busca de rota (`realms.js dijkstra` com `passFor(k)`) trata
um lugar de um reino **em guerra** com o exército como beco sem saída (chega-se a ele — o alvo —, não se passa por ele); sem
outra estrada, a marcha vai pelo campo, e o caminho pelo campo (`overland`) também contorna esses lugares (as células a até
a terra do lugar + 22 tiles ficam de fora). Vale para a reunião, a partida, os contingentes e o planejamento dos alvos.
Teste **WR11** (246 casos no mundo de teste em que a estrada mais curta cruzava um lugar inimigo: todos contornam).

**Passar perto de um cerco inimigo é lutar** (apontamento do dono, 9/11/2026: "o exército criou o acampamento de cerco e o
exército que estava passando ao invés de entrar no cerco defendendo a vila apenas passou reto"): um exército que marcha a até
`WAR.meetSiege` (45 tiles) do acampamento de um cerco de um reino em guerra com ele vira-se contra ele — batalha no
acampamento, pelo lugar cercado (`realms.js simStep`; os encontros comuns continuam a 10 tiles; um cerco "vivo" — com
jogadores perto — também conta). Teste **SM6**.

**Guerra com um reino do outro lado de um terceiro** (apontamento do dono, 6/11/2026: "o reino verde está em guerra com o
reino azul ciano, porém não consegue chegar as tropas até lá por ter o reino vermelho no meio, que inclusive o reino
vermelho está em guerra com o azul ciano"): o reino do meio, neutro para quem marcha, não barra o caminho (estrada ou campo:
`passFor` só barra os lugares de quem está em guerra com o exército). O que travava: o reino do meio, mais perto, quase
sempre toma ou cerca o alvo antes; o exército chegava depois de dias de marcha e voltava para casa sem lutar. Agora, ao
chegar a um alvo que outro reino tomou ou cerca, ele **segue** dali para o lugar mais próximo de um reino em guerra com ele
que tenha força para cercar (sem cerco, até `WAR.muster` de distância; `realms.js arrive` → `retarget`); só sem nenhum volta
para casa. Teste **WR13** (falha sem a correção: "voltou para casa").

Código: `game/realms.js` (a API `game.realms`, a simulação no anfitrião: diplomacia, campanhas, marchas, batalhas, cercos,
conquista; rotas pelas estradas / pelo campo; notícias; a passagem para a 3b), `game/mut/realms.js` (o estado e as ops:
`realm.start` · `realm.day` · `realm.rel` · `realm.army` · `realm.wall` · `realm.capture` · `realm.fall`; linhas de
snapshot / save / digest), `game/content/war.js` (os números), `ui/warMap.js` (a camada de guerra do mapa e do radar),
`ui/warHud.js` (os avisos), `ui/muralWar.js` (Reino: relações e notícias; Exército). Ganchos de uma linha em `towns.js`
(dono em `info` / `at`, cores do mural, portões fechados no cerco, nada é refeito durante / logo depois de um cerco),
`people.js` (cores da guarda pelo dono; cerco = alarme com o lado do acampamento), `npc.js` (consertos por números
seguram), `siege.js` (`siegeCanDamage` com o dono das peças / do povo), `eco.js` / `mut/eco.js` (dono em preços,
reputação, imposto, trabalhos, entregas, filiação; notícias de guerra nos mercados; **o caminho único da propriedade
perdida**; `eco.rep`), `ui/realmMap.js` (território pelo dono de cada distrito), `ui/mural.js`, `ui/muralEco.js`,
`ui/ecoHud.js`, `ui/placebanner.js`, `ui/panels.js` (legenda e chave "Guerras e exércitos"), `systems.js`,
`net/snapshot.js`, `net/digest.js`, `mut/index.js`.

### Como se joga

- **Avisos** (no alto da tela): quem é **membro** de um reino (mural · Reino · "Entrar no Reino de …") recebe **toda**
  mudança do seu reino — guerra declarada por ele ou contra ele, paz (trégua), aliança feita ou desfeita, fim de trégua,
  exércitos do reino marchando / socorrendo, cercos, batalhas vencidas ou perdidas, lugares tomados / retomados, um reino
  que cai — um por vez, com o ícone (espadas, pomba, aperto de mãos, bandeira, castelo) e uma frase sobre o seu lado ("Seu
  reino foi atacado: defenda suas terras", "Seu reino perdeu Y"). Quem não é membro só ouve o que é perto ou do reino onde
  está e dos vizinhos dele, no máximo um aviso a cada 20 s (o mural guarda tudo). Cada par decide o que mostra ao seu
  jogador (multijogador: cada um vê as notícias do seu reino).
- **Mapa** (M): os territórios seguem os donos (um lugar tomado pinta a sua terra na cor do novo reino; um reino caído
  some do mapa); **fronteiras em guerra em vermelho** pulsando; **exércitos** — disco na cor do reino com flâmula, maior com
  mais soldados, seta para onde marcham (tracejado quando recuam), "Reino · N" de perto; **cercos** — anel vermelho
  tracejado girando em volta do lugar, a tenda do acampamento, "Cerco · atacantes × defensores"; **batalhas** — espadas
  cruzadas com brilho vermelho e "Batalha · N × M". Legenda e a chave **"Guerras e exércitos"** na janela do mapa. O
  **radar** mostra os exércitos, cercos e batalhas por perto.
- **Mural · Reino**: no alto, **Relações do Reino de X** — cada reino da mesma terra com ícone e etiqueta (EM GUERRA com
  "Declarada por nós no dia N" / "Declarou guerra a nós" e a barra do cansaço da guerra; ALIADO desde o dia N; TRÉGUA até
  o dia N; EM PAZ com "fronteira calma / alguma tensão / fronteira tensa" e as guerras passadas; "Rival distante (sem
  fronteira)"; os reinos de outras terras: "sem navios, nenhuma relação"); no 1º dia do mundo, o aviso "Nenhum reino declara guerra no
  primeiro dia do mundo";
  **Notícias do reino** (as últimas 8, com dia e hora). Depois o cartão "Você e o reino" da fase 2 (agora diz que o membro
  recebe as notícias e que perde as propriedades de um lugar tomado) e os lugares do reino **agora** (os tomados marcados
  "(tomada)", os cercados com ⚔).
- **Mural · Exército**: o exército do lugar (soldados e o máximo, nível, guarda da cidade, recrutas por dia, estado — em
  casa / em campanha / sitiada —, muralha, se o reino está em guerra, a força do reino); num lugar cercado, o quadro
  vermelho do cerco (quem, onde acampou, quantos, as máquinas, os defensores, há quanto tempo, peças da muralha
  danificadas, a fase: acampando / construindo máquinas / bombardeando / atacando); **Campanhas do Reino** (cada exército:
  de onde, quantos, nível, "reunindo os soldados em X para marchar sobre Y · faltam chegar N", "marchando sobre Y ·
  faltam 324 passos, chega em ≈ 9 h", "cercando Y há 3 h · 1 aríete, 2 trabucos", "em batalha com…", "voltando para…");
  **Inimigos a caminho**; e "Entrar no exército — **Em breve**" (3c).
- **Faixa do lugar**: um lugar tomado mostra o reino novo ("Vila · Reino de Valadestra"), e "· sob cerco" quando há um
  exército acampado; o mural do lugar troca as flâmulas para as cores do novo reino; a guarda veste o tabardo e o escudo
  dele.
- **Num lugar cercado perto de um jogador** (sem a 3b): o sino toca, o povo fica em casa, os portões fecham, a guarda vai
  para o lado do acampamento (a defesa do §11 com a ameaça vinda do exército) e as peças quebradas pelo cerco somem /
  racham na hora.
- **Mercados** ("tudo se conversa"): cada dia de guerra traz notícias de **falta** nas praças da frente (flechas, espadas,
  lanças, escudos, barras de ferro, arcos, armaduras de couro: preço ×2,1 por 3 dias) e de **comida** num lugar cercado
  (pão, trigo, carne) — aparecem no Comércio como as outras notícias. Um membro não negocia com um reino em guerra com o
  seu (agora vale de verdade, e segue o dono do lugar: um lugar tomado pelo inimigo fecha o comércio para ele); o quadro de
  trabalhos, o imposto e a reputação de um lugar tomado são do reino novo; entregas nunca vão para um lugar inimigo.

### Diplomacia (anfitrião, uma vez por dia às 6h30; números em `content/war.js`)

- Pares com relações: os **vizinhos** (fronteira ou estrada entre eles) e, na mesma terra, os **rivais distantes** cujas
  capitais estão a até 2 800 tiles (sem fronteira: a tensão cresce pela metade, os exércitos vão pelo campo). Nunca entre
  terras diferentes (sem navios: `realm.rel` é ignorada mesmo forçada).
- **Tensão** 0..100 por par: começa em 10..60 (hash do par: há velhos rivais); por dia +0,6..2,7 (atrito da fronteira, ×0,5
  nos distantes), +1,4 se um é 1,4× mais forte, +0,9 por guerra passada (até 3), +2,5 se um tem um lugar que era do outro,
  **+3,2 nos pares do reino dos jogadores** (o do início, `R.k0`, e os de que algum jogador é membro — `homeKingdoms`),
  −3 entre aliados, −2,5 em trégua, −1 se um deles já está em guerra noutro lugar (nunca nos pares do reino dos jogadores),
  ±1,5 de ruído; o resto cai 3 % ao dia.
- **Guerra**: acima de **44** de tensão, chance de (tensão − 44) × 3,5 % ao dia (no máximo 60 %); quem declara é o mais forte.
  No máximo ⌈reinos / **4**⌉ guerras no mundo (16 reinos → 4) e 2 por reino. O reino dos jogadores: a partir de **34**, com
  a chance dobrada, e a guerra dele pode passar o limite do mundo em uma (apontamento do dono, 6/11/2026: "no mundo estou
  vendo apenas dois reinos entrando em guerra e já se passou uma semana, nem mesmo o reino do jogador entrou em guerra, isso
  ficou chato, sendo que a guerra é a parte divertida do jogo"; antes: +0,3..2,4 ao dia, guerra acima de 52, ⌈reinos / 6⌉ —
  o equilíbrio da maioria dos pares ficava abaixo de 52). No mundo de teste: 6–7 pares em guerra em 30 dias, o reino do
  início entre o 7º e o 10º dia (teste **WR12**). **Aliança defensiva**: os aliados do atacado
  entram na guerra contra o atacante (se o alcançam por terra e não estão no dia calmo / no limite).
- **Sem carência** para o reino do início (o da vila do spawn): o dono tirou a proteção de 2 dias (2026-11-06) — ele pode
  entrar em guerra a partir do 2º dia, como qualquer outro. O mundo inteiro fica em paz só no 1º dia (`day0`,
  `WAR.quietDays`). Um mundo antigo, sem fase 3, começa a contar quando é aberto.
- **Cansaço da guerra** 0..100 de cada lado: +5 por dia, +1 a cada 14 soldados perdidos, +18 por lugar perdido, −8 por
  lugar tomado. **Paz**: acima de 55, chance de (cansaço − 55) × 3 % ao dia, +15 % depois de 10 dias de guerra → **trégua de
  5 dias** (sem guerra entre eles; depois "Terminou a trégua").
- **Aliança**: vizinhos com tensão < 14, chance 7 % ao dia (×3 com um inimigo em comum), no máximo 2 aliados; desfeita com
  tensão > 42 (12 % ao dia).

### Exércitos

- **Exército de casa** de cada lugar (a guarnição): máximo vila 8 + pop × 0,12 (~14), castelo 50 + pop (~80), cidade
  60 + pop × 0,35 (~130); começa com 80 %; recruta 12 % do máximo por dia (×1,5 com o reino em guerra; nada sitiado);
  **nunca acima do máximo** (a conquista deixa no máximo o máximo; o dia dispensa o excesso). Nível = `realmNpcLevel`
  (§7b); força de um soldado = 1 + 0,05 × (nível − 1) (nível 18 ≈ 1,85 × nível 1). Defesa de um lugar = guarnição + guarda
  da cidade (a conta do §11: vila 6 + 2, castelo 72 % do povo, cidade 15 %) × a muralha (cidade 2,6, castelo 2,2, paliçada
  1,4, sem muralha 1).
- **Campanha** (a cada ~2 horas de jogo, cada lado de cada guerra; uma por guerra e lado): o alvo é o lugar inimigo com
  melhor nota (distância pela estrada — ou × 1,35 pelo campo —, defesa × 3, cidade +500, castelo +250, −400 se era nosso);
  vai só com força ≥ 1,5 × a defesa e ≥ 12 soldados. Os lugares a até 1 100 tiles do alvo dão o que têm além do que fica
  em casa (vila 50 %, castelo 35 %, cidade 40 %); o **lugar de reunião** é a guarnição mais forte entre as mais perto do
  alvo; os contingentes a até 420 tiles dele (≥ 6 soldados, até 4) **marcham até ele e se juntam**; o exército espera até
  12 horas e **sai como um só** ("Um exército do Reino de X (N soldados) marcha sobre Y"). Um contingente que chega depois
  segue o exército até o cerco e se junta lá.
- **Socorro**: um lugar cercado chama os exércitos do seu reino por perto (força ≥ 0,7 × os sitiantes) — "O Reino de X
  manda N soldados socorrer Y" —; chegando, batem nos sitiantes.
- **Marcha**: 1,1 tile / s (o relógio do mundo: ~860 tiles por dia de jogo; um vizinho fica a ~0,5–1,5 dia). A rota são as
  estradas do reino (Dijkstra sobre os lugares) — ou, entre reinos da mesma terra sem estrada, um caminho pelo campo (A*
  nas células do planeta, só terra, morros e montanhas custam mais), suavizado. A posição é **derivada do relógio** em todos
  os pares (rota + `t0` / `d0` / velocidade): nenhuma op enquanto marcha. Um salto do relógio (dormir, `env.skip`) é
  simulado em passos de 4 s, no máximo os últimos 3 dias.
- **Batalha**: exércitos de reinos em guerra a ≤ 10 tiles (marchando, acampados ou cercando; quem recua é deixado ir)
  param e lutam no meio do caminho; a cada 8 s de jogo cada lado perde força_do_outro × 6 % (× 0,7..1,3); quem cai abaixo
  de 45 % do que tinha **recua** pelo caminho por onde veio (ou some se ficou com menos de 3); o vencedor segue. Uma
  escaramuça de menos de 16 soldados não vira notícia.
- **Cerco** (uma hora de jogo por vez): 2 h montando o **acampamento** na estrada, 14 tiles fora da terra do lugar; depois
  **máquinas** — pontos por hora = soldados / 30; aríete 6, catapulta 5, trabuco 10, torre 12 (castelo: 1 aríete, 2
  trabucos, 1 torre; cidade: 1 aríete, 3 trabucos, 2 torres; paliçada: 1 aríete, 1 catapulta; sem muralha: nada) —; o
  **bombardeio**: cada trabuco acerta 55 % das horas (dano 0,5 × 0,7..1,3 numa peça — 70 % das vezes a mais rachada do
  trecho de frente para o acampamento: a brecha), a catapulta na paliçada; o **aríete** vai ao portão mais perto (portão
  de madeira: quebra em ~1 hora; de pedra: ~2), perdendo 2 soldados por hora. O estrago vai pela op `realm.wall` para o
  **estado dos lugares** (rachaduras `dmg`, peças destruídas `gone`), carregado ou não: quem chega depois vê a muralha
  quebrada. **Assalto** com brecha, portão quebrado, sem muralha ou com torres (depois de 8 horas), quando a força ≥ 1,3 × a
  defesa (muralha × 0,6 com brecha, × 0,75 portão, × 0,8 torres): atacantes perdem defesa × 32 %, defensores ataque × 24 %;
  fora do assalto, os arqueiros nas muralhas tiram defesa × 3,5 % × muralha por hora e as máquinas 1 % da força do ataque;
  depois de 48 horas a fome tira 3 % dos defensores por hora. **Desistem** abaixo de 40 % do que eram, ou mais fracos que
  0,9 × a defesa depois de 6 horas, ou depois de 4 dias, ou com a paz ("O cerco de Y terminou").
- **Consertos**: durante o cerco e por **2 dias** depois dele as peças não são consertadas por números nem refeitas
  (`holdRepair`); depois, as regras do §11 (o povo conserta de dia, peças destruídas voltam 2 dias depois sem ninguém perto).

### Conquista e a queda de um reino

- Defesa zerada → **tomada** (`realm.capture`): o lugar passa ao reino; metade dos atacantes fica de guarnição (até o
  máximo do lugar), o resto volta para casa. Em todos os pares: dono, cores da guarda e do mural, faixa, mapa, comércio
  (filiação), quadro de trabalhos, imposto; o povo é refeito da semente com o reino novo (os mesmos moradores; a guarda é a
  do conquistador). "Y foi tomada pelo Reino de X" — ou "retomada" quando volta ao reino original. Um exército cuja casa foi
  tomada volta para o lugar mais perto do seu reino.
- **Um reino sem cidade cai** (`realm.fall`): os castelos e vilas que restam passam ao reino que tomou a sua última cidade
  (decisão: eles juram lealdade ao conquistador — não ficam "sem dono"); as relações e tensões dele acabam; os exércitos
  dele no campo se desfazem; os jogadores membros voltam a ser **viajantes** (a reputação fica); "O Reino de X caiu: suas
  terras passam ao Reino de Y". A capital passa a ser a primeira cidade que ele tenha (um reino que tomou outra cidade
  sobrevive à perda da sua).

### Propriedades dos jogadores (decisão do dono)

"Quando uma vila, cidade ou castelo for conquistado e o jogador possuir propriedade naquele lugar, o jogador perde elas …
quando um jogador perde uma propriedade ela volta para lista de vendas, e caso seja um terreno, tudo que o jogador
construiu no terreno some e o terreno volta para venda." Feito como **um caminho só** no anfitrião (`game/eco.js
loseProps` → op `eco.lose` + `struct.remove` das peças do terreno), usado por:
- a **conquista** do lugar (casas compradas, alugadas e terrenos de todos os jogadores ali);
- o **imposto** não pago por 3 dias (−15 de reputação, como antes);
- **vender / devolver** ao reino (o aviso diz que o construído no terreno foi desmontado).
Efeitos: a linha da propriedade some (a dívida junto) e ela **volta à lista de venda / aluguel do lugar**, sob o reino
que o tem agora (imposto dele); os baús de uma casa são esvaziados; num terreno **todas as peças que o jogador construiu**
(blocos, plantas, baús…) são desmontadas em todos os pares — o anfitrião nunca descarta um chunk com construção, então
estão todas lá; um convidado longe recebe com o chunk depois; o save guarda. O jogador afetado vê: "O Reino de X tomou Y —
Você perdeu a casa pequena e o terreno 8×8 (o que estava construído no terreno foi destruído)…". **Antes**, quando o lugar
fica sob cerco: "Y está sob cerco — Se cair, suas propriedades lá serão perdidas (…)", e o mural (Propriedades) marca o
lugar "sob cerco: se cair, você a perde".

### Reputação herdada (decisão do dono)

"Ao jogador entrar em um reino, ele herda as relações do reino, fazendo com que se sair do reino, ele precise melhorar a
reputação individualmente … relação negativa não quer dizer inimigo … só vira inimigo declarado caso faça parte de um
reino inimigo, porém os preços seriam muito mais caros e muito mais baixos para venda … o jogador não pode entrar em um
reino com relações / reputação negativa." Fecha o atalho "sair do reino → viajante → negociar com o inimigo dele".
- **Entrar** (`realm.join`): o anfitrião calcula `inheritFor(k)` e a op `eco.member { inherit }` **substitui** a reputação
  do jogador com **cada outro reino** (os caídos de fora): aliado do reino **+40** (já "Conhecido"), em **trégua** com ele
  (acabou de lutar) **−15**, em **guerra** com ele **−60**, todos os outros (outras terras também) **0**; a reputação com
  o reino em que entrou não muda. Toda vez que entra num reino, de novo. Aviso: "Você jurou lealdade ao Reino de X e herdou
  as relações dele: 1 aliado te recebe bem (+40), 1 inimigo te vê mal". O cartão do Reino avisa antes de entrar quantas
  reputações serão substituídas.
- **Sair**: os valores ficam com o jogador (comércio e trabalhos os melhoram, como sempre).
- **Faixas negativas**: Desconfiado (−1 … −24: compra +20 %, venda −20 %), Malvisto (−25 … −99: +50 % / −40 %), Odiado
  (≤ −100: +100 % / −60 %); o limite continua −200. Com reputação negativa: **não entra no reino** ("Sua reputação com o
  Reino de X é negativa: melhore-a com comércio e trabalhos antes de entrar"), não compra casa / terreno (como
  "Desconhecido"), mas **negocia e trabalha** — o Comércio mostra "⚠ Reputação negativa com o Reino de X (Malvisto, −60):
  compra 50 % mais cara e venda 40 % mais barata…", o cartão mostra a faixa em vermelho, a barra até a próxima faixa e "não
  pode entrar". Subir de uma faixa negativa avisa; chegar a 0: "não é mais negativa: preços normais, já pode entrar".
- **Não é inimizade**: nada caça o jogador por reputação negativa; inimigo declarado é só o membro de um reino em guerra
  (sem comércio). Por jogador (uid), replicado (`eco.member`, `eco.rep`), no save e no digest (parte `eco`).

### Para a 3b (o contrato do §12, como ficou)

- `live`: um exército (o seu cerco / a sua batalha) a ≤ 120 tiles de um jogador → `live = 1` e
  `game.warfare.materialize(army)`; ninguém a menos de 150 → `game.warfare.dematerialize(id)` → `{ n, eng, siege }` e os
  números seguem. Enquanto `live`, a 3a não move, não cerca nem luta com aquele exército; `game.realms.report(id, {…})`.
- **Sem `game.warfare`** (este ramo): `live` nunca é marcado e tudo segue por números.
- `game.realms.capture(sid, k)` (anfitrião) → `true` quando tomou; faz tudo o que a tomada por números faz (guarnição,
  propriedades, povo, queda do reino).
- `game.realms.reward(pid, k, d, motivo)` (anfitrião): reputação para quem ajudou / atacou um reino (op `eco.rep`).
- `game.realms.siegeOf(sid)` / `besieged(sid)` / `defense(sid)` / `siegeThreat(sid)`; `game.realms.armies.get('g' + sid)` é
  a guarnição do lugar atacado.

### Multijogador e saves

Anfitrião autoritativo. Ops (todas globais para o interesse): `realm.start {day0, k0, tens}` · `realm.day {day, gar, tens,
weary}` (as guarnições e níveis de todos os lugares, ~3 KB por dia) · `realm.rel {a, b, rel, by, until, why, quiet}` ·
`realm.army {a, del, gar, news, scar, wt}` · `realm.wall {sid, hit, gone}` · `realm.capture {sid, k, from, n}` ·
`realm.fall {k, to}`; na economia `eco.lose {ids, why, k, by, give, toast, built}`, `eco.rep {u, k, d}` e `eco.member {…, inherit}` (a reputação herdada). As notícias
nascem dentro das ops (mesma lista em todos os pares; dia / hora de cada par são cosméticos). Snapshot / save:
`world.realms` (`realmRows`: dia, primeiro dia, reino do início, relações, tensões, guerras passadas, donos, caídos, todos
os exércitos, cicatrizes de cerco, notícias). Digest: parte **`realms`** (exata; um exército marchando entra pela rota e
pelo relógio, não pela posição). Um save antigo sem `realms` começa a fase 3 ao abrir (com o dia calmo).

### Desempenho

- Anfitrião: um tique a cada 0,5 s (os passos de 4 s do relógio desde o último): **~0,9 ms por tique** em média nos
  testes com guerras, campanhas e cercos (~0,05 ms por quadro), o dia da diplomacia ~1–2 ms. O pico (7–27 ms, uma vez) é a
  **planta** de um lugar sitiado longe que nunca foi carregado — feita na thread principal na primeira hora de bombardeio
  (cidade ~25–55 ms; castelo / vila menos); depois fica guardada.
- Todos os pares: as posições dos exércitos no campo a cada 0,25 s (poucos objetos); nada varre lugares ou peças por quadro.
  O mapa repinta só os pixels que mudaram de dono numa tomada; as fronteiras em guerra são uma imagem pequena por guerra,
  refeita quando as relações ou os donos mudam.

### Testes e prints

`tools/mp-test.js` **WR1–WR9** (`?run=WR1,…`; a IA dos reinos fica pausada em todo cenário — `act.js reset` — e os WR a
dirigem): WR1 a mesma diplomacia nos dois pares, nunca guerra entre terras, sem carência para o reino do início (no 1º dia
do mundo, 6 rodadas de diplomacia com tensão 99 sem guerra; a partir do 2º dia, a guerra vem também para ele) · WR2 guerra forçada: o convidado membro vê a guerra, a
aliança e a paz do seu reino (avisos e o mural Reino), uma campanha se reúne e marcha (mesmos exércitos nos dois, a
notícia), o Exército mostra a campanha, notícias de guerra nos mercados, nenhuma guarnição acima do máximo · WR3 a marcha
pela estrada: mesma posição nos dois (< 3 tiles), em cima da estrada (< 1 tile), anda velocidade × tempo, mapa e radar
desenham · WR4 batalha por números (perdas iguais nos dois, o mais forte vence, o perdedor recua) · WR5 cerco por números
longe dos dois: muralha / portão quebrados no estado dos lugares, sem conserto durante / depois, e os dois veem a brecha
ao chegar · WR6 a tomada muda o dono em tudo (guarnição até o máximo, notícia, tabardos, `towns.at` / mural, mapa,
comércio do membro, quadro de trabalhos) e a retomada · WR7 propriedades perdidas (casa e terreno de volta à venda nos
dois, o muro do terreno some, o aviso do cerco e o da perda, e o save) · WR8 a queda de um reino · WR9 save → load
igual · WR10 a reputação herdada (entrar substitui: aliado +40, inimigo −60 no lugar do +30 que havia, os outros 0;
sair mantém; viajante numa vila do inimigo negocia com preços ≥ 1,45× na compra e ≤ 0,65× na venda, o Comércio explica;
não entra com reputação negativa; um trabalho e o comércio a levam a 0 e aí entra — e herda as relações do novo reino). EC6 passou a conferir que o muro do terreno tomado por imposto some; SG6 (fase 1) troca só o `atWar` do
`game.realms` no teste e o devolve (antes apagava o objeto — agora ele é o estado dos reinos). Todos terminam com o digest
igual.

Prints (`shots/`, fora do git; sem o painel de depuração): `wr_map_wars` (o mapa: Valadestra × Rabelonia, fronteira em
vermelho, exércitos, cerco e batalha), `wr_map_army_march` (um exército marchando na estrada, de perto), `wr_map_siege`
(o anel do cerco), `wr_siege_breach_1` / `_2` (o portão da paliçada de Silvança do Vau quebrado por um cerco por números,
um guarda do novo reino segurando a abertura), `wr_castle_breach_1` / `_2` (o portão de pedra do Bastião de Arenelo
quebrado), `wr_castle_siege_map`, `wr_mural_exercito_siege`, `wr_captured_banner` (a faixa "Silvança do Vau · Vila ·
Reino de Valadestra" e as flâmulas do mural nas cores novas), `wr_captured_plaza` / `_2`, `wr_captured_castle_guards` (a
guarda do castelo tomado com o tabardo de Valadestra), `wr_mural_reino_desktop` / `_2`, `wr_mural_exercito_desktop`,
`wr_notice_war` (o aviso ao membro: "O Reino de Arenudia declarou guerra ao Reino de Galéria — Seu reino foi atacado"),
celular 915 × 412 toque: `wr_mural_reino_phone` / `_2`, `wr_mural_exercito_phone` / `_2`, `wr_map_phone`; reputação herdada:
`wr_rep_negative_trade` (o Comércio de uma vila do inimigo para quem saiu do reino: "Malvisto, −60 — compra 50 % mais cara e
venda 40 % mais barata"), `wr_rep_negative_reino` (o cartão: a faixa em vermelho, a barra até "Desconfiado", não entra).

### Decisões (para o dono confirmar)

- ~~Carência de 2 dias do reino do início~~ — tirada pelo dono (2026-11-06); fica só o 1º dia do mundo em paz para todos.
- **Rivais distantes**: reinos da mesma terra sem fronteira, com capitais a até 2 800 tiles, também têm tensão e podem
  guerrear (marchando pelo campo, sem estrada). Sem isso, na semente 4242 o reino do início (Galéria, isolado por terra
  livre) nunca teria uma guerra.
- **Um reino que perde a última cidade cai** e os seus castelos e vilas passam ao conquistador dessa cidade (não ficam
  independentes nem são divididos entre vizinhos).
- **A conquista deixa a mesma gente**: os moradores ficam (são os mesmos da semente); a guarda passa a ser a do
  conquistador (mesmos nomes, tabardo novo).
- **Propriedades**: perdidas com o lugar conquistado (pedido do dono); a reputação não cai por isso (não é culpa do
  jogador). Vender um terreno ao reino também desmonta o que foi construído nele (é o mesmo caminho).
- **Reputação herdada** (pedido do dono): os números — aliado +40 (já pode comprar casa nele), trégua −15, guerra −60
  ("Malvisto": compra 50 % mais cara); as faixas negativas e os preços da tabela do §10.
- **Os níveis do §7b na força**: só +5 % por nível (nível 18 ≈ 1,85 × nível 1) — com +12 % os reinos longe do início eram
  3× mais fortes por soldado e esmagavam o reino do jogador logo nos primeiros dias.
- **Exércitos lentos de propósito** (1,1 tile/s, ~860 tiles por dia de jogo): uma marcha leva de minutos a horas reais, e
  quem está no caminho é avisado bem antes ("marcha sobre …").
- **Sem a 3b, nada é jogado perto**: um cerco perto do jogador segue por números (o lugar reage: sino, povo em casa,
  portões, guarda no muro, peças quebrando); a 3b troca isso por soldados de verdade.
- Pendente / ideias: caravanas e exércitos visíveis andando no mundo (3b), mais de uma campanha por guerra, cercos de
  reinos aliados juntos, resgate / troca de lugares no tratado de paz, o reino do jogador (fundar: futuro).

## 14. Fase 3b — campo de batalha e cerco

Feito (parte 3b do §12): os exércitos dos reinos viram **soldados de verdade perto dos jogadores** — batalha campal e o
**cerco jogável** dos dois lados (acampamento → máquinas → bombardeio → aríete / torre / brechas → assalto → tomada ou
recuo) —, a guarda dos lugares luta contra eles e o **jogador pode ajudar um lado** (decisão do dono, abaixo). Ligada à
3a (§13): os exércitos dela viram soldados quando um jogador chega perto e voltam a números quando ele se afasta (abaixo,
"A passagem com a 3a"); as guerras, os donos, a tomada e a reputação são os da 3a. Código:
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
- **Espaço de cada um**: dois soldados nunca ficam a menos de **0,66 tile** (os bonecos não se empilham): quem anda
  desvia de quem está parado, dois parados se afastam devagar, quem está numa máquina / escada não sai do lugar. As
  formações têm fileiras de 1,25 tile e 1,15 de largura por soldado.

### A batalha campal

`startBattle(a, b)` (ou dois exércitos da 3a que se encontram — `materialize` com `state 'battle'`): as duas forças
**marcham em coluna** até o ponto de formar (17 tiles cada uma do meio), **formam as linhas** (infantaria na frente,
largura 5–16, arqueiros 2 fileiras atrás, o general entre eles com o estandarte), **avançam** a passo (a linha espera os
atrasados), os arqueiros **atiram** quando o inimigo entra no alcance (19 tiles), a 22 tiles as linhas **se chocam**
(a infantaria caça o inimigo mais perto; arqueiros e general ficam atrás). **Moral** (0–100): −1,1 por % de baixas, −30
com o general morto, −18 em desvantagem de 0,6 : 1; o general **reanima** (+14, até +32; grito "Firmes! Pelo Reino de
X!", estandarte erguido) a cada 9 s enquanto a linha vacila. Abaixo de 26 a linha **debanda** (corre para trás, some
fora da vista); o vencedor persegue 6 s e fica. Ao fim os dois **reportam** à 3a (`report(id, { n, eng, state, x, y
})` — as baixas no `n`; o `state` continua o da 3a, `'battle'`) e os soldados somem; quando a 3a os toma de volta, a
batalha por números segue dali com as baixas jogadas (quem debandou perdeu 50–67 %: a 3a quebra quem fica abaixo de
45 % do que tinha, na primeira ou segunda rodada) e o perdedor vai para casa.

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
   engenheiros (martelo). **Um acampamento vivo**, não uma fila: 2–6 **sentinelas** na beira do lado do lugar, virados
   para ele; até 6 soldados em roda de cada **fogueira** (comendo, conversando); os outros **entre as tendas**, cada um
   no seu canto, afiando a arma e conversando de vez em quando; o general diante dos estandartes; os engenheiros nas
   obras. Vale no acampamento, nas obras e no bombardeio.
3. **Obras**: a oficina, depois os trabucos, o aríete e a torre como **plantas de verdade** (`struct.add` / `struct.progress`
   / `struct.complete`, `placeReason` do jogador), 2 engenheiros na primeira, 1 nas outras (tempo = o da construção × 0,8).
4. **Bombardeio**: um engenheiro em cada trabuco (`siege.set user '~<nid>'`), a armação gira na velocidade dela
   (0,3 rad/s) e o tiro passa por `fireShot` (o mesmo de um jogador: recarga, dispersão sorteada pelo anfitrião, a
   mira que melhora no mesmo alvo). Dano de cerco persistente (`siege.dmg`, no estado do lugar) até a peça cair: uma
   **brecha**; depois as peças ao lado (a brecha alarga). A infantaria espera no acampamento.
5. **Assalto** (brecha aberta, ou aríete / torre prontos e 25 s de bombardeio, ou 70 s): o **aríete** empurrado pela
   equipe (2–4, engenheiros primeiro: `siege.set push` + o passo do próprio anfitrião, `siege.js hostPush`) até o portão,
   **pancadas** (`ramBlow`) até o portão cair ("O portão caiu! Para dentro!") — e a equipe **puxa o aríete de volta** 4
   tiles (ele tapava a passagem) e entra; a **torre** empurrada até a muralha, a
   **rampa desce**, até 10 soldados sobem a escada de trás um a um (0,55 s por andar), atravessam a rampa, **lutam no
   adarve** com os arqueiros de lá e descem por um alto de escada para dentro; a infantaria entra por **qualquer abertura**
   (o campo de fluxo até a praça — muros e portões fechados barram) — diante de cada abertura os 2–5 mais perto entram e
   os outros esperam numa **cunha de fileiras** (a 2,6 tiles da abertura, uma fileira a mais a cada 1,25 tile) e sobem
   conforme os da frente passam, nada de fila — ou, sem abertura, espera fora do alcance dos arqueiros; os
   **arqueiros** avançam até 13 tiles do muro e atiram nos defensores (alcance +25 % contra o muro); o general reanima de
   trás.
6. **Tomada**: 2+ atacantes a até 7 tiles da praça e **nenhum guarda** a até 13 por 18 s → `game.realms.capture(sid, k)`
   (a 3a: o dono muda em tudo, a guarnição nova, as propriedades perdidas); os vencedores ficam 40 s **em roda pela
   praça** (espalhados, virados para fora) e somem nas casas. **Recuo**: 62 % de baixas, moral < 22, 20 min de cerco ou
   2 soldados → correm para longe do acampamento; acampamento e máquinas desmontados quando a força acaba.

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
- **O jogador colado no soldado vem primeiro** (apontamento do dono, 6/11/2026: "quando o jogador está no meio da muvuca
  entre os soldados se matando poucos soldados focam no jogador, o jogador bate em um soldado mas ele não dá atenção …
  pelo menos o soldado deveria dar mais atenção para o jogador caso esteja muito perto, sem se mover tanto, mas bater mais
  no jogador estando no range de ataque corpo a corpo dele"): um soldado de corpo a corpo ocupado com outro soldado vira
  para um jogador inimigo **ao alcance do golpe** (`WAR.closeR` 2,4 tiles, o mesmo andar — `soldier.js closePlayer`; o
  que acabou de feri-lo primeiro) e bate nele ali; ferido por um jogador colado nele, troca de alvo na hora
  (`soldierHurt`). Isso não aumenta a perseguição: o jogador se afasta e o "puxão" acaba — vale a escolha de sempre (a
  formação se mantém). Teste **CB9**.
- **Reputação** (anfitrião, pela `game.realms.reward(pid, k, d, motivo)` da 3a — op `eco.rep`; sem a 3a, a op própria
  `war.rep`): matar um atacante dá **+2** com o reino defendido (engenheiro +3, general +10), cada 6 golpes +1, e o
  mesmo **−** com o reino dos soldados (sem aviso; não para quem é membro dele); um cerco rechaçado dá **+10** a quem
  lutou; no máximo 60 por força; juntado e mandado no máximo a cada 4 s: "+4 de reputação no Reino de Galéria:
  defendendo Estrosa". Numa batalha campal, com o reino do outro exército ("…: na batalha contra o Reino de X").
- **Sem aviso por morte** (decisão do dono): nem soldado, nem morador, nem guarda — numa batalha seriam dezenas. O sino,
  os gritos da batalha e o "tudo calmo" contam a história; a queda do general é um grito só.

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
`war.cry {texto, x, y}` (grito: um aviso para quem está a até 60 tiles), `war.rep {u, k, d, k2, d2}` (só sem a
`reward` da 3a). As máquinas usam as
ops de sempre (`struct.add`, `siege.set` com `'~<nid>'` como operador / empurrador, `siege.shot`, `siege.step`,
`siege.swing`, `siege.dmg`, `struct.remove`). Snapshot / save `war: { f: linhas, r: [[estrutura, reino]] }` (o save
guarda os cercos de depuração com as baixas — ao carregar o cerco recomeça do lugar e adota o acampamento e as máquinas
que ainda estão de pé; os exércitos da 3a são da 3a), parte **`war`** do digest (linhas públicas + marcas).
O convidado vê os mesmos soldados (proxies), máquinas, dano e desfecho.

### A API (`game.warfare`) — como o §12 pediu

`materialize(army)` (cerco / batalha / coluna conforme `army.state`; `null` para `'home'`), `dematerialize(id) → { n,
eng { treb, cat, ram, tower }, siege { phase, hrs, campo, máquinas… }, lost, killed, state, x, y }` (os soldados viram
números; o acampamento e as máquinas são desmontados), `forces`, `startSiege({ k, sid, n, lv, eng, at })`,
`startBattle(a, b)` (depuração: forças sem exército da 3a, que a 3b encerra sozinha quando ninguém está a 150 tiles);
mais `debug(id)`, `threatOn(sid)`, `siegeOn(sid)`, `mayHurt(jogador, soldado)`, `stats`, `reports` (o último relatório
de cada força) / `reportLog`. Reporta com `game.realms.report(id, { n, eng, state, x, y })` (só os exércitos da 3a) a
cada fase e a cada 6 s. Sem `game.realms` nada entra em guerra.

### A passagem com a 3a

- **Chega um jogador** (a 120 tiles — `liveCheck` da 3a marca `live` e chama `materialize`): um exército em
  **`'siege'`** vira o **cerco jogável** no mesmo lugar, com o que os números já fizeram de pé na hora: passado o
  acampamento (`phase` ≠ `'camp'`), as tendas, estandartes e fogueiras aparecem prontos; as máquinas que ele tem
  (`eng`) aparecem prontas nos seus lugares (trabucos = os que ele tem, no mínimo 1; aríete e torre como sempre, os que
  ele não tem são construídos); em **`'battle'`** a força espera o outro exército da batalha (`army.foe`) e a batalha
  campal começa quando os dois chegaram; em **`'march'` / `'retreat'`** uma **coluna** nas cores do reino andando pela
  própria rota da 3a (`routeOf`: os ~200 tiles à frente do ponto onde a 3a parou o relógio dele); em `'camp'` (a
  reunião de uma campanha) a coluna parada onde está; em `'home'` nada (a guarnição é a guarda do lugar).
- **Enquanto `live`** a 3a não anda, não cerca (nenhuma hora de cerco por números: sem dano em dobro) nem luta com
  aquele exército; a 3b reporta as baixas, as máquinas e a posição (`report`). O estado reportado é sempre o da 3a
  (`'siege'`, `'battle'`, `'march'`…): a 3b não decide o destino estratégico.
- **O jogador se afasta** (ninguém a 150 tiles): a 3a chama `dematerialize` — os soldados somem, o acampamento e as
  máquinas são desmontados e os números continuam dali: as baixas ficam, a marcha segue do ponto da rota mais perto de
  onde a coluna estava, o cerco segue com `phase` (acampamento / obras / bombardeio / assalto) e as horas jogadas.
- **Fim jogado perto** (tomada, recuo, batalha decidida): os soldados saem de cena (o recuo e a debandada correm para
  longe; a tomada fica na praça 40 s) e a força fica `done` até a 3a tomá-la de volta; a 3a decide o resto pelos
  números com as baixas jogadas (o lugar já é do vencedor → o exército volta para casa; baixas demais → desiste do
  cerco). Enquanto o jogador continua perto, aquele exército fica parado nos números (ver pendências).

### Mira automática, golpes e paredes, caminhos (pedido do dono depois de jogar a escaramuça — vale para o jogo todo)

- **A fila da mira automática** (`combat.js aimClass`): **0** os hostis (monstros, saqueadores, bichos hostis, o soldado
  inimigo que a regra deixa ferir, o jogador em guerra com o meu, qualquer criatura que esteja lutando comigo) · **1** os
  animais neutros / passivos — só quando nenhum hostil está ao alcance · **−1** nunca sozinha: soldados do próprio lado ou
  protegidos, moradores e guardas, animais domados / de criação, o cavalo montado, peixes, jogadores sem guerra. A mesma
  fila para o ataque automático (`bestFoe`), as habilidades sem alvo (`abilities.js nearestEnemy` / `abilityFoe`), o Tab e
  a mira assistida do tiro longo (`ui/aim.js`). O alvo que o jogador marcou continua valendo (um animal de criação de
  propósito, por exemplo). Um viajante nunca mira um soldado sozinho (a regra do §14 acima); quem está alistado mira os do
  reino inimigo.
- **Golpe precisa de linha livre** (`combat.js meleeWall`, no começo de `dealDamage`): um golpe — não uma flecha, um
  virote, uma pedra ou um dano contínuo — a até 4 tiles com muralha, paliçada, portão / porta fechada, rocha ou crista entre
  os dois não faz nada (o mesmo teste das flechas, `hasLOS`). Vale para todos: o jogador (ataque automático, habilidades, a
  varredura `areaTargets`, `rangeOk` diz "sem linha"), as criaturas e os monstros, os guardas e os soldados. Na tela
  "Atrás da parede", só para o jogador envolvido; `canHitNow` pede a linha também no corpo a corpo (o automático não fica
  batendo na parede). O soldado que tem uma parede entre ele e o inimigo vai até o inimigo em vez de golpear; o guarda da
  vila também (`npc.js guardFight`: sai pelo portão do próprio lugar até o monstro que bate no portão / na paliçada). Antes
  os guardas matavam o morto da noite através do portão fechado; agora quem o derruba lá fora são os guardas que saem e os
  arqueiros que andam pelo alto da muralha até ele (o VL4 espera até 150 s por isso).
- **Soldados contornam o que está no caminho** (`soldier.js routeStep`): com a linha reta até o destino bloqueada, um A*
  local (`TownNav` numa caixa de 96 tiles, caixas em cache por uma grade de 48, no máximo 16, até 3 buscas por quadro)
  dá a rota, pulando os pontos que a linha livre (`lineClear`) já alcança; sem avanço por 0,8 s → rota nova; a guarnição
  de um lugar passa pelos portões dele (`npcPass`). Os campos de fluxo do cerco continuam como estavam. A escolha de alvo
  dos monstros e o foco da defesa das vilas são do trabalho dos ataques de inverno (§1), não daqui.
- **Um sistema com erro não congela o jogo** (`game.js systemFault`): o sistema perde aquele quadro, os outros seguem; o
  erro vai ao console (uma vez a cada 5 s por sistema) e é relançado fora do laço para os relatórios; `game.faults` conta.
  O laço principal (`main.js loopFault`) faz o mesmo com `update` / `render`. (O "congelou uns 4 s com os monstros dentro
  do castelo" do dono não se repetiu no Chrome headless — 38 monstros na praça, quadros de 6–7 ms; a hipótese é um erro
  que derrubava o laço, agora isolado; o SK6 vigia.)
- **Os arqueiros NPC também usam o Tiro Longo** (pedido do dono; `game/npcLob.js npcLongShot`, só no anfitrião): o mesmo
  voo e a mesma dispersão do jogador (`content/weapons.js lobSpec / lobScatter / lobFlight`, o ponto de queda sorteado no
  anfitrião, o alvo em movimento adiantado pelo tempo de voo); o convidado vê o arco pelo fx de sempre (`['proj', id,
  'lob', …]`, sem dono; `['pend', …]` quando acerta). **Quando**: o inimigo além do tiro simples do arqueiro e dentro do
  alcance do tiro longo (arco simples 18 tiles, arco composto 22, × `heightK` lá de cima de uma muralha) **ou** sem linha
  de tiro (por cima de uma paliçada / muralha num cerco: os atacantes por cima dos muros, os defensores nos que chegam de
  longe). **Condições**: céu aberto sobre o arqueiro (`roofAtPoint`), a recarga de cada um = a do jogador (3 s, × 0,9–1,2),
  a animação de atirar. **Dano** = o da flecha simples × 1,3 + 2. **Na queda** acerta só os inimigos de quem atirou (o
  mesmo `canHit` das flechas dele: nunca o próprio lado); caindo numa muralha / rocha / telhado não acerta ninguém.
  Ligado nos soldados (`soldier.js`: batalhas, cercos, exércitos, a escaramuça — `pickFoe` aceita o inimigo atrás do muro
  dentro do alcance do tiro longo; sem linha, o arqueiro espera o próximo tiro longo em vez de cravar flecha na paliçada)
  e nos saqueadores / esqueletos arqueiros (`bandits.js archer()`: tiro simples até 9 tiles). **Os arqueiros da guarda
  das vilas, castelos e cidades** (`npc.js lobAt`) também: lá de cima da paliçada / muralha (`upTask`) no inimigo além do
  tiro simples (13 tiles × `heightK`: 15,6 na paliçada) ou sem linha de tiro, e no chão (`guardFight`) enquanto se
  aproximam (além de 11 tiles, ou por cima da paliçada); a vila tem arco simples (18 × altura), castelo e cidade arco
  composto (22 × altura); na queda só os inimigos do lugar (`hostile`), nunca o povo nem um jogador. Os soldados atiram
  simples até 19 tiles (`WAR.archer.range`), mais que o tiro longo do arco simples (18): para que o tiro longo apareça
  também em campo aberto, eles o usam a partir de 55 % do tiro simples (`WAR.archer.lobK` = 0,55, ~10,5 tiles; um a
  cada recarga, entre as flechas simples). Teste CB4 (o arqueiro da paliçada num lobo a 18 tiles). `projectiles.js` guarda no máximo 80 projéteis e agora descarta primeiro os cravados — num cerco grande
  um tiro longo no ar não some antes de cair. O tiro longo não vai num inimigo em cima de uma muralha / rocha
  (`npcLob.js lobbable`: a flecha cairia nas pedras e não acertaria ninguém) — nele vai a flecha simples.
- **Os lanceiros NPC arremessam a lança** (pedido do dono, 6/11/2026: "lanceiros npc também podem usar o tiro longo"; o
  "tiro longo" da lança é o **Lançar Lança** do jogador — `npcLob.js npcThrowSpear`, só no anfitrião): o mesmo voo baixo e
  a mesma dispersão do jogador (`lobSpec` da lança), até **8 tiles** × `heightK`, recarga de **10 s** (× 0,9–1,2), dano =
  o golpe simples × 2,4 + 6, empurrão forte; precisa de linha livre (lança não passa por cima de muro) e de um inimigo em
  chão aberto. A mão fica vazia enquanto ela voa (a pose de arremesso segue até ela cair; `art/compose.js` esconde a lança
  depois de k 0,55) e ela volta para a mão; acertando, fica cravada onde bateu, como a do jogador. O convidado vê pelo fx
  `['proj', id, 'lobs', …]`. **Quem**: os lanceiros dos exércitos (`soldier.js spearOut`: no inimigo a partir de
  **4,5 tiles** — `WAR.spearMin`; mais perto ele fecha para os golpes —, numa batalha uma saraivada de lanças antes do
  choque das linhas; lá de cima de uma muralha, sem ninguém para enfrentar no adarve, nos inimigos de baixo) e os guardas
  de lança das vilas, castelos e cidades (`npc.js spearAt`: no chão a partir de 4,5 tiles — `PEOPLE.spearMin` —, e do
  adarve na torre de cerco nos de baixo). Só os inimigos de quem arremessou são atingidos. Os saqueadores / esqueletos de
  lança continuam com o arremesso reto deles (`bandits.js special`). Teste **CB5**.
- **Textos de combate só de quem joga** (`ui/overlay.js`): acerto, erro, esquiva, imune, cura e "Atrás da parede" só
  aparecem quando o jogador local está envolvido (ele, o bicho dele, o projétil dele) — numa batalha de 200 soldados a tela
  não se enche de "Bloqueado".
- **Testes**: CB1 (a fila no jogo normal: lobo antes do cervo mais perto, o cervo quando não há hostil, nunca guarda ou
  morador; o mesmo no convidado), CB2 (golpe do jogador, mordida do lobo e golpe do convidado através da paliçada não
  fazem nada; lado a lado acertam), CB3 (um saqueador arqueiro com o convidado a 15 tiles em campo aberto: o tiro longo
  no anfitrião, o arco no convidado, o convidado ferido, um por recarga), SK2 (soldado do outro lado na fila, do próprio
  lado nunca), SK6 (40 monstros dentro de um castelo por 30 s: o relógio segue, p95 < 40 ms, sem falha de sistema), SK7
  (cerco da paliçada: os arqueiros atacantes atiram por cima dela, o convidado vê os arcos, o tiro longo fere o inimigo
  e nunca o soldado do próprio lado ao lado dele).

### Testes e prints

`tools/mp-test.js` **BT1–BT10** (as guerras pela op de depuração `realm.rel` da 3a, com a IA dos reinos pausada; a tomada
é a `capture` da 3a e o teste devolve o lugar no fim): BT1 cerco de depuração — soldados nas cores do reino nos dois pares (mesmos nomes /
visuais da semente), acampamento inteiro fora do alcance, sino, ameaça do lado do exército, portões fechados, arqueiros
na paliçada · BT2 oficina → trabuco e torre com obra (progresso no convidado), torre na altura da muralha, trabuco a
34–43 tiles, dano persistente, brecha nos dois pares segurada pela guarda · BT3 torre empurrada por 2+, rampa, soldados no
adarve, a praça tomada → `capture` · BT4 aríete empurrado até o portão, pancadas, portão quebrado, soldados entram ·
BT5 batalha campal: fases, flechas, baixas dos dois lados, debandada, relatórios · BT6 recuo por baixas: acampamento
desmontado, `war.end` · BT7 jogadores: coluna em paz protegida e não ataca, membro em guerra pode, viajante ajuda a
defender (revide, +reputação com o defensor pela `reward` da 3a, −com o atacante, aviso), moradores protegidos · BT8
teto de 80 criaturas, reservas entram, custo por quadro · BT9 a passagem de uma marcha: um exército da 3a lançado
(`dbg.launch`) vira coluna de soldados quando os jogadores chegam perto (`live` nos dois pares, a rota à frente), 6
baixas contadas na força e no exército da 3a (`report`), os jogadores se afastam → números de novo (`live 0`) com as
baixas e marchando · BT10 a passagem de um cerco: um cerco por números longe dos jogadores (o relógio adiantado até
`siege`, passado o acampamento) vira o cerco jogável quando eles voltam (acampamento e máquinas que ele já tinha de pé
na hora), sem horas de cerco por números enquanto `live` (as `hrs` não mudam: sem dano em dobro), e ao se afastarem o
acampamento é desmontado nos dois pares e o exército segue cercando por números com os soldados contados. Todos
terminam com o digest igual. Os cenários de cerco usam a vila do início
(Estrosa, semente 4242, paliçada) e aceleram só as obras e a tomada (`WAR.siege.buildK` 0,3, `captureT` 8 s) no
anfitrião; o resto (recarga e mira do trabuco, empurrar, rampa, pancadas) é o de sempre.

**Resultados** (depois de juntar a main com a 3a e os moradores que nunca ficam presos): BT1–BT10 passam; a rodada
BT + WR1–WR10 + VL1–VL10 + SG1–SG6 + KG1–KG7 + EC1–EC8 deu 48 / 51 — BT2 conferia o dano no convidado no mesmo quadro
(agora espera), SG2 depende da dispersão da pedra (passa sozinho), WR10 comprava antes de o convidado receber uma
atualização do mercado que o anfitrião já tinha (agora espera os dois verem o mesmo preço; 3 / 3). A rodada inteira
(`run=all&soak=60`, perfil limpo do Chrome): 169 passam, 5 falham (K1, HO3, EC1, EC3 passam sozinhos; WR10 o acima),
S28 só na linha de comando.

**Desempenho** (Chrome headless deste PC, 1264 × 625, `game.warfare.stats` = o sistema dos soldados: cérebros, ticks
das forças, campo de fluxo):

| Cena | soldados-criatura | média / p95 / pior por quadro (sistema) | quadro inteiro (CPU) média / p95 / pior |
|---|---|---|---|
| batalha 220 × 200 (80 criaturas, o resto em reserva), no choque | 80 (40 + 40) | 0,11 / 0,2 / 1,1 ms | 2,3 / 3,2 / 10,7 ms |
| cerco de 44 com torre, do acampamento à tomada | 44 | 0,09 ms (pior 5,2–5,9 ms: o quadro do plano) | — |

O campo de fluxo do cerco da vila (≈ 110 × 110 tiles) custou 45 ms no total ao longo do cerco, em fatias de 0,8 ms.
O plano (os quatro lados, as pistas, a oficina) roda um lado por tick (0,5 s), 2–5 ms cada.

**Prints** (`shots/`, fora do git; sem o painel de depuração): `bt_camp` / `bt_camp_close` (o acampamento vivo: as
tendas, os estandartes, uma roda em cada fogueira, soldados ao lado das tendas, as sentinelas na beira virados para a
vila, o general diante dos estandartes), `bt_build` (oficina pronta, trabuco e torre em obra, engenheiros martelando),
`bt_trebuchet_shot` / `_shot2` (o trabuco que acabou de atirar e a pedra no ar a caminho do aro onde cai),
`bt_tower_push` / `bt_tower_ramp` / `bt_tower_ramp_close` (a torre empurrada, a rampa no alto da paliçada, soldados no
deque e descendo a escada para dentro, um guarda lutando com eles), `bt_breach_fight` (a brecha do trabuco: os guardas
segurando a abertura, os atacantes apertados na frente — um cercado e roças ao pé do muro deixam só dois corredores),
`bt_ram_push` / `bt_ram_gate` / `bt_ram_gate_close` / `bt_gate_broken` (o aríete empurrado até o portão, a pancada, o
portão quebrado e a cunha entrando), `bt_archers_walls` (os arqueiros do exército em linha atirando, a guarda no muro),
`bt_battle_lines` / `bt_battle_clash` / `bt_battle_rout` (a batalha campal: as linhas com os estandartes, o choque, a
debandada), `bt_general` (o general com o estandarte entre os arqueiros e a infantaria), `bt_plaza_fight` /
`bt_capture` (a praça tomada: os vencedores em anéis pela praça, a faixa "Estrosa · Vila · Reino de Rabelonia" e o aviso
"Estrosa foi tomada pelo Reino de Rabelonia").

### Decisões (para o dono confirmar) e pendências

- **Jogadores × soldados**: a regra acima (membro em guerra; viajante ajudando quem está lutando — numa batalha campal
  o viajante pode escolher qualquer lado). Matar soldados dá XP (soldado ×1,2, general ×4) e a reputação acima; soldado
  morto não deixa corpo nem saque (cai e some em 8–24 s), como o povo.
- Moradores e guardas continuam protegidos dos jogadores mesmo em guerra (a 3c decide o resto pela filiação — §15: a
  guarda inimiga para quem está alistado; os civis sempre protegidos).
- `dematerialize` desmonta o acampamento e as máquinas (os números da 3a guardam `eng`); um cerco retomado adota o que
  ainda estiver de pé (acampamento e máquinas do mesmo reino perto) e o que os números já fizeram aparece pronto.
- **Sem aviso por morte** (decisão do dono): soldados, moradores e guardas caem sem mensagem; ficam os avisos da
  batalha (o acampamento, a brecha, o portão, a rampa, o recuo, a tomada) e o grito pela queda do general.
- ~~**Pendência da junção 3a × 3b**~~ — **resolvida na 3c (§15: `game.realms.settle`, a guarnição dos vencedores)**: quando a luta jogada perto acaba (tomada, recuo, batalha decidida) e o jogador
  continua perto, o exército da 3a fica parado nos números (`live`) até ele se afastar 150 tiles — só então a 3a decide
  o destino (volta para casa / desiste / segue). Para resolver na hora, a 3a pode oferecer `game.realms.settle(id, {
  n, outcome: 'won' | 'lost' | 'taken' })` (o que `endBattle` / `goHome` / `hostCapture(..., army)` já fazem) e não
  materializar de novo um exército nesse estado; a 3b chamaria em `finishForce`. A `capture(sid, k)` pública não recebe
  o exército: a guarnição nova sai de `capOf × 0,3`, não dos vencedores.
- Depois da tomada, os vencedores ficam 40 s na praça (em roda, virados para fora) e somem nas casas: a guarnição nova
  é da 3a (`capture`).
- Consertos durante o cerco: só com o exército longe do alarme (no acampamento), também à noite.
- Até o nível 8 os soldados lutam sem elmo (rostos e tabardos à vista); os elmos de cobre ficam para a guarda das vilas.
- O plano do cerco só usa os quatro lados retos da muralha (os cantos cortados do octógono ficam de fora) e precisa de
  uma pista reta e livre: campos, cercas e currais encostados no muro barram a torre / o aríete daquele trecho (realista
  e previsível). Sem pista nenhuma o cerco fica no trabuco e nas brechas.
- Uma força só cerca vilas, castelos e cidades dos reinos (§4: nunca bases de jogadores); as máquinas do exército nunca
  ferem jogadores nem estruturas de jogadores (`siegeCanDamage`).
- Pendente: catapultas nas muralhas das cidades (as plantas não têm; o código das guarnições já serve para elas),
  cavalaria / general montado (docs/HORSE.md), o mapa-múndi mostrando as forças (3a), escadas de assalto.
- Já existente, visto nos testes: `TOWN.note('gone')` guarda `at = worldTime` de cada par — por uma fração de segundo
  a linha `towns` de uma peça destruída pode diferir e a ressincronização a corrige (mut/towns.js; não é da 3b).
  **Resolvido** (escaramuça, docs/SKIRMISH.md): o digest da parte `towns` não compara mais o `at` (só o anfitrião o lê:
  refazer / consertar as peças); o snapshot continua levando o do anfitrião.

## 15. Fase 3c — o jogador no exército

Feito (parte 3c do §12, pedido do dono no §4: "o jogador com reputação suficiente entra num exército pelo mural →
aparecem ordens do general na tela e waypoints no mapa e no minimapa"): o **alistamento** no mural, as **ordens do
general** num cartão da tela com o **ponto** no chão, no radar e no mapa, que mudam com a campanha (3a) e com as fases da
luta jogada perto (3b); **quem pode ferir quem** com o jogador alistado (a guarda e os soldados inimigos, o PvP entre
membros de reinos em guerra, nunca civis nem o próprio lado); as **máquinas do exército** para os seus soldados; o
**soldo** diário por posto, os **bônus** de vitória, a **deserção**; e a pendência da 3b (`game.realms.settle`). Código:
`game/army.js` (as regras, as ordens, o anfitrião: quem segue qual exército, o soldo, o serviço, os bônus),
`game/mut/army.js` (o registro por jogador: op `army.rec`, intents `army.join` / `army.leave`, linhas de snapshot / save /
digest), `game/content/army.js` (os números), `ui/armyHud.js` (o cartão de ordens, o ponto, os avisos, quem é inimigo no
PvP), `ui/muralWar.js` (o cartão "Alistamento" da aba Exército). Ganchos: `combat.js` (`npcBlock`, `pvpHit`,
`attackable`, `killMob` → serviço), `mut/combat.js` (intent `pvp.hit`), `controller.js` (tocar / mirar um inimigo do
PvP, Tab), `people.js` (tocar num guarda inimigo ataca; o perigo do lugar conta o alistado inimigo), `npc.js` (a guarda
luta com ele: `hostile`, `guardTargets`, golpes e flechas por `hurtPlayer`), `towns.js` (portões fecham), `soldier.js`
(`isFoe`), `warfare.js` (inimigos da força, `finishForce` → `settle`, a coluna que acompanha a 3a, bônus), `siegeAI.js`
(a tomada com o exército, o aríete / a torre guardam o lugar do jogador), `mut/siege.js` / `siege.js` (máquinas do
exército para os seus soldados, a pedra do exército), `projectiles.js` (flechas: PvP, guarda inimiga, flechas da guarda
nos alistados inimigos), `realms.js` (`settle`, `capture` com o exército, a marcha viva escoltada, a rematerialização),
`mut/eco.js` / `eco.js` (pid → uid em todos os pares: `E.pu`), `ui/radar.js` / `ui/minimap.js` / `ui/overlay.js` (o
ponto da ordem, o inimigo do PvP em vermelho), `ui/mural.js` / `ui/muralEco.js` (textos), `net/snapshot.js` /
`net/digest.js` (parte `army`), `systems.js`, `mut/index.js`.

### Como se joga

- **Alistar-se** (mural → **Exército** → cartão **Alistamento**): os requisitos com ✓ / ✕ e o motivo de cada um, a tabela
  de postos e soldo, as regras, e o botão **"Alistar-se na milícia de Estrosa"** (vila) / "na guarnição de …" (castelo) /
  "no exército de …" (cidade). Recusas, sempre em português e com o que falta: "Entre no Reino de Galéria primeiro (aba
  Reino)", "Reputação Conhecido no Reino de Galéria: faltam 15", "Reputação Respeitado no Reino de Galéria: faltam 60",
  "Você serve na milícia de Estrosa: dê baixa lá antes" (**um exército por vez**), "Desertor: o Reino de Galéria não
  aceita você de volta até o dia 7", "Vá até o mural de …".
- **Quem pode** — membro do reino dono do lugar (o registro da economia) com reputação:

  | Exército | Reputação |
  |---|---|
  | **milícia da vila** | **Conhecido** (25) |
  | **guarnição do castelo** / **exército da cidade** | **Respeitado** (100) |

- **Postos** pelo serviço (pontos: +1 por dia servido, +1 por inimigo derrubado — até 4 por dia —, +3 pelo general
  inimigo, +3 por batalha vencida, +5 por lugar tomado, +4 por cerco rechaçado), **soldo** a cada amanhecer (o dia da
  economia), **×1,5 com o reino em guerra** (soldo de campanha):

  | Posto | Serviço | Soldo / dia (paz · guerra) |
  |---|---|---|
  | Recruta | 0 | 20 · 30 |
  | Soldado | 6 | 30 · 45 |
  | Sargento | 18 | 45 · 68 |
  | Capitão | 40 | 65 · 98 |

  Promovido ao amanhecer, já recebe o soldo novo; aviso "Promovido a Sargento! · soldo de 45 moedas por dia". Junto do
  soldo, **reputação pelo serviço** com o reino (`game.realms.reward`): +1 por dia em paz, +2 em guerra. Só recebe quem
  está no mundo naquele amanhecer (como o imposto). Aviso: "Soldo do dia: +45 moedas (Soldado, em campanha ×1,5) · +2 de
  reputação no Reino de Galéria".
- **Bônus** (uma vez por luta, para quem estava lá — a até 90 tiles da batalha, ou do lugar + 90 no cerco):

  | Desfecho | Moedas | Reputação | Serviço |
  |---|---|---|---|
  | batalha vencida | +40 | +6 | +3 |
  | lugar tomado | +90 | +12 | +5 |
  | cerco rechaçado (o lugar defendido) | +50 | +10 | +4 |

  Avisos: "Vitória sobre o Reino de X! Bônus: +40 moedas e +6 de reputação…", "Silvança é nossa! Bônus…", "Estrosa
  resistiu ao cerco! Bônus…". Equilíbrio com a economia (§10): um dia de soldo vale um trabalho do mural (30–90); um
  bônus, uma viagem curta de comércio; um Capitão em guerra ganha ~100 por dia de 13 minutos — o comércio continua
  pagando mais para quem só quer dinheiro, o exército paga a reputação e a guerra.
- **As ordens do general** (`ui/armyHud.js`): um cartão no alto à esquerda, logo abaixo da bolsa e acima do rastreador
  de trabalhos (o mesmo estilo; vermelho escuro em combate, verde na vitória): "ORDENS DO GENERAL · SARGENTO · ESTROSA",
  a ordem, o detalhe, a distância em passos e uma seta para o ponto; o último **grito do general** da própria força
  aparece no cartão ("«Firmes! Pelo Reino de Galéria!»"). Um toque minimiza (só o título e a seta), ✕ esconde até a
  próxima ordem. Cada ordem nova chega com um aviso curto ("Ordem do general · …") e um som. As ordens saem do estado real
  da guerra, iguais em todos os pares (`game.army.order()`):

  | Situação | Ordem | Ponto |
  |---|---|---|
  | paz | "Em paz: a milícia de Estrosa treina" (o soldo do dia) | — |
  | guerra, nenhuma campanha | "Guarde Estrosa" | — |
  | a campanha se reúne | "Junte-se ao exército em X" / "Aguarde a reunião em X" | o exército |
  | um contingente vai à reunião | "Alcance o contingente" / "Marche com o contingente até X" | o exército / o lugar |
  | a campanha marcha | fora da coluna (> 22 tiles): "Alcance o exército" (+ "Ir até o exército") · junto: "Marche com o exército até Z" / "Socorra Z" ("… chega em ~2 dias e meio de jogo") | o exército / o alvo |
  | volta para casa | "Recuar! Volte com o exército para X" | o exército / a casa |
  | cerco por números | "Vá ao cerco de Z" / "O exército cerca Z" | o acampamento |
  | cerco jogado (3b) | "Marche até o acampamento diante de Z" → "Monte o acampamento…" → "Proteja os engenheiros" → "Proteja os trabucos!" (opere um: a pedra é do exército) → assalto: "Empurre o aríete até o portão!", "Empurre a torre até a muralha!", "Suba pela torre!", "Entre pela brecha!", "O portão caiu! Para dentro!", dentro dos muros "Tome a praça!" → "Z é nossa! Segure a praça" · "Recuar! Recuar!" | o exército, o acampamento, a oficina, o trabuco, o aríete, a torre, a brecha, o portão, a praça |
  | batalha | por números: "Junte-se à batalha!" · jogada: "Forme na linha!" → "Avance com a linha!" → "Segure a linha! Ataque!" → "Vitória! Persiga os que fogem" / "Recuar! A linha caiu" | o exército, a linha, o inimigo |
  | a casa cercada | "Às muralhas de Estrosa!" (lado do acampamento) → "Segure as muralhas!" → "Segure a brecha!" / "Segure o portão quebrado!" / "Defenda o portão: o aríete vem aí!" / "Defenda a muralha: a torre encostou!" → "Estrosa resistiu!"; longe: "Volte para defender Estrosa!" | a muralha do lado atacado, a brecha, o aríete, a torre |

- **O ponto da ordem** (`game.army.wp`, local): uma **bandeira vermelha** balançando sobre o lugar, com o nome
  ("Exército", "Acampamento", "Aríete", "Brecha", "Praça", o lugar); fora da tela, uma **seta vermelha na borda** com o
  nome e a distância; no **radar** uma marca vermelha no anel; no **mapa** (M) e no minimapa a bandeira vermelha (presa na
  borda do mapa). Convive com o ponto dourado dos trabalhos.
- **Marchar junto**: a campanha que o jogador segue (a do seu lugar; senão a do reino mais perto da sua casa) fica **viva
  em volta dele** (a coluna de soldados da 3b) e **continua marchando** pelo relógio da 3a — chega, se reúne, cerca,
  encontra o inimigo — com a coluna acompanhando a posição dela; quando ele se afasta, volta aos números como sempre. O
  cartão diz quando o exército chega, legível: "40 soldados do Reino de Galéria · chega em ~2 dias e meio de jogo", e
  **uma distância só** (até o ponto da ordem).
- **Ir até o exército** (decisão do dono — "Viagem com o exército": uma marcha como Estrosa → Gralude, ~2 200 passos,
  ≈ 62 horas de jogo ≈ meia hora real, é longa demais para seguir a pé): o jogador **pode** marchar junto, mas o cartão
  ganha o botão **"Ir até o exército"** quando faz sentido — alistado, **longe** do exército (> 60 tiles do ponto de
  chegada) e **num lugar do próprio reino** (na terra de uma vila, castelo ou cidade dele). Um toque leva o jogador **para
  junto do exército**: marchando ou na reunião, ao lado da coluna; acampado no cerco, **no acampamento** (atrás das
  tendas, fora da terra do alvo). **Não pula o tempo do mundo** e funciona no multijogador: só aquele jogador se move (o
  próprio avatar), depois que o anfitrião confere (intent `army.travel`) e responde o lugar. Recusas: "Viaje a partir de
  um lugar do Reino de X (a terra de uma vila, castelo ou cidade dele)", "Inimigos por perto: não dá para viajar no meio
  de uma luta", "Solte a máquina de cerco antes de viajar", "X está sob cerco: não dá para sair agora", "O exército está
  em batalha: vá até lá a pé", "Você já está perto do exército". Chegando: "Você viajou até o exército · Junto do
  exército — siga as ordens do general"; com ele ali o exército fica vivo e marchando (escoltado).
- **Lutar** (a regra, igual no convidado que manda o golpe e no anfitrião que o aplica):

  | Alvo | Pode? |
  |---|---|
  | soldado de um reino em guerra com o seu | sim (membro, alistado ou não — §14) |
  | **guarda** de um lugar de um reino em guerra com o seu | **só alistado** num exército do seu reino |
  | civil (morador, criança, ancião, ofícios) de qualquer reino | **nunca** |
  | soldado / guarda do próprio reino ou de um aliado | nunca |
  | **outro jogador** | **só membros de reinos em guerra** entre si (alistados ou não); nunca viajantes, o mesmo reino, aliados, reinos em paz |

  Um guarda inimigo para o alistado: tocar nele ataca (não conversa), o Tab o escolhe, as flechas o acertam. **Os guardas
  e os soldados inimigos tratam o alistado como inimigo** nas terras deles: o sino toca, os portões fecham, a guarda vai
  atrás dele (golpes e flechas pelo `hurtPlayer`: o cliente dele rola esquiva / armadura / escudo), os soldados de um
  reino em guerra perto o atacam. **PvP**: o golpe do atacante vai ao anfitrião (intent `pvp.hit`, que confere de novo a
  guerra com os seus registros e a distância) e o cliente da vítima o recebe (`player.hurt`); o outro jogador inimigo
  pode ser mirado / tocado (`e.pvp`), tem plaquinha vermelha "Nome · Reino de X · inimigo" e ponto vermelho no mapa. Fora
  disso, o golpe não faz nada e diz por quê ("… é do seu reino", "… é viajante: jogadores só lutam entre si quando são
  membros de reinos em guerra", "… é do Reino de X, que não está em guerra com o seu").
- **Máquinas do exército**: quem serve num exército do reino da máquina **empurra o aríete / a torre** e **opera o
  trabuco / a catapulta** — a pedra é do exército (nenhuma sai da mochila); um engenheiro no trabuco dá lugar ao jogador,
  e um soldado da equipe do aríete / da torre também (a IA da 3b guarda os lugares dos jogadores e empurra com eles).
  Viajantes e outros: "Aríete do exército do Reino de X: só quem serve nesse exército a usa" (a regra do dono para os
  viajantes continua).
- **Dar baixa**: na aba Exército, "Dar baixa" (dois toques). Fora de combate é livre, a reputação fica. **No meio de uma
  batalha ou de um cerco** (do exército que segue, ou da sua casa) é **deserção**: −25 de reputação com o reino, e ele não
  aceita o jogador de volta por **2 dias**; o botão fica vermelho e avisa antes. Sair do reino (aba Reino) também dá baixa
  — deserção se for em combate.
- **Morrer na guerra**: renasce como sempre (a cama, a vila), **sem perder reputação nem o posto**; aviso "Você caiu em
  combate · Renasce como sempre — sem perder a reputação nem o posto…"; o cartão aponta de volta para o exército.
- O lugar de onde serve é tomado: passa ao lugar mais perto do seu reino ("Estrosa foi tomada: você passa à milícia de
  …"); um reino que cai desfaz o seu exército (baixa).

### `game.realms.settle` — a pendência da 3b resolvida

- `game.realms.settle(id, { n, outcome: 'won' | 'lost' | 'taken' | 'lifted', x, y })` (anfitrião), chamado pela 3b em
  `finishForce` quando a luta jogada perto acaba: a 3a retoma os números **na hora**, com o jogador ainda perto — lugar
  tomado: a guarnição já ficou, o resto volta para casa (ou some, com menos de 5); cerco abandonado: volta para casa com a
  notícia "o cerco terminou"; batalha vencida: volta ao que fazia (com a notícia de vitória); perdida: volta para casa
  com o que sobrou (ou some).
- **A guarnição de uma tomada vem dos vencedores**: `capture(sid, k, { army, n })` — metade dos vencedores vivos, até o
  máximo do lugar (antes: 30 % do máximo). Enquanto os vencedores seguram a praça (40 s), a 3a não mexe; o resto sai no
  `settle`.
- **Um exército vivo muda de forma**: a 3a confere a cada segundo; quando o estado de um exército vivo muda (chegou e
  cerca, encontrou o inimigo, volta para casa depois de uma luta, cresceu com um contingente), ela o devolve aos números e
  o entrega de novo à 3b na forma nova (`dematerialize` + `materialize`); as forças de exércitos que deixaram o campo
  (fundidos na campanha, em casa) somem.
- **Marcha escoltada**: um exército vivo marchando / voltando com um alistado dele a ≤ 120 tiles mantém o relógio da 3a
  (`v > 0`): anda, chega, se reúne, encontra outros (as reuniões vivas partem também); a coluna da 3b segue a posição da
  3a no ritmo dela. Sem escolta, como antes: parado nos números enquanto vivo.

### Multijogador e saves

Anfitrião autoritativo. Estado em `game.army` (todos os pares): `en` Map uid → `{ sid, k, rank, svc, since, paid, kills,
a (o exército da 3a que segue), kd, kn }`, `des` Map uid → `[reino, até o dia]`. **Por jogador (uid)** como a economia:
volta outro dia e continua no posto. Op única `army.rec { u, r | 0, ban, ev, by, give, toast }` (alistado, mudou, saiu;
`give` = o soldo / o bônus na mochila do dono); intents `army.join { sid }`, `army.leave {}`, `pvp.hit { pid, amount,
crit, ranged, ability, from }`. Snapshot / save `world.army { en, des }`, parte **`army`** do digest (exata). O
anfitrião (sistema `armySystem`, a cada 0,5 s) decide quem segue qual exército (`a`), confere a filiação, paga ao
amanhecer, junta o serviço das mortes (a cada 2 s) e os bônus. Para saber quem é quem numa luta, todo par conhece o uid
de cada pid (`game.eco.pu`, da op `eco.who`; no snapshot da economia, fora do digest). As ordens, o ponto, os avisos e o
`e.pvp` são locais (cosméticos), derivados do estado replicado.

### Testes

`tools/mp-test.js` **AR1–AR9** (as guerras pela op de depuração `realm.rel`, a IA pausada; o convidado vira membro e ganha
reputação pelas ops do anfitrião): AR1 alistamento no mural (recusas: não membro, reputação da vila e do castelo; aceito
pelo botão; o cartão de ordens; um exército por vez; baixa em paz sem custo) · AR2 as ordens seguem a campanha
("Alcance o exército" com o ponto no exército e a marca no radar; junto dele: vivo **e marchando** — o relógio da 3a
roda, a coluna acompanha —, "Marche com o exército até …" com o alvo como ponto; longe: números; o cerco por números; o
cerco jogado e as ordens das suas fases; ≥ 4 ordens, cada uma com aviso) · AR3 as máquinas do exército (o viajante
recusado; o soldado empurra o aríete — ele anda — e opera o trabuco sem pedra própria) · AR4 quem fere quem (membro não
alistado não fere guarda; alistado fere guarda, nunca civil; a guarda o vê como inimigo, o sino, os portões, um guarda
vai atrás dele; soldados inimigos o listam como inimigo e ele os fere; nunca o próprio lado) · AR5 PvP (viajantes,
reinos em paz, o mesmo reino, aliados: nada; em guerra os dois golpes passam) · AR6 o soldo (paz +20, guerra ×1,5,
promoção a Soldado com aviso, o bônus de cerco rechaçado +50 / +10) · AR7 morrer mantém posto e reputação; a deserção no
cerco (−25, o banimento de 2 dias, o aviso; alistar de novo recusado) · AR8 `settle` (a tomada perto dos jogadores: a
guarnição dos vencedores; o exército volta para casa na hora e vira coluna de novo) · AR9 save → load. Todos terminam com
o digest igual. **AR10** "Ir até o exército" (em terra livre: recusado; na vila com uma coluna inimiga ao lado: recusado; sem
ela, o botão no cartão; um toque — o convidado ao lado do exército nos dois pares, o exército vivo e marchando, o relógio
do mundo sem salto; o exército cercando o alvo por números: da vila, para o acampamento, fora da terra do alvo).

**Resultados** (Chrome headless deste PC, perfil limpo): **AR1–AR10 passam** (10 / 10, rodados juntos no fim). BT1–BT10,
WR1–WR10, VL1–VL10, EC1–EC8, SG1–SG6 e KG1–KG7 passam (BT9 falhou uma vez numa versão intermediária — a coluna era refeita
ao perder soldados antes do relatório; corrigido: só se refaz quando cresce além do que começou). **A rodada inteira**
(`run=all&soak=60`): 175 passam, 9 falham — S30 (tempo do corte), HO3, SG1, SG2, EC3, WR1, BT2 e BT4 (a dessincronia
transitória de `towns` já anotada no §14; o digest final igual) passam **re-rodados sozinhos**; AR1 olhava o rótulo antigo
do cartão ("Ordens do general" → "Ordem do general") e passa com o rótulo novo. S28 só na linha de comando. Depois da fila
de avisos: WR2, WR7, EC6 e AR1–AR10 de novo, passam; VL4 falhou uma vez logo depois do WR7 (os andarilhos à noite) e passa
sozinho.

### Desempenho

Nada por quadro varre peças ou criaturas a mais: o anfitrião confere os registros (um por jogador) a cada 0,5 s; as
ordens do jogador local são refeitas a cada 0,25 s (listas por tipo das peças do exército — tendas, máquinas —, as
aberturas e o perímetro do lugar, já em cache); a guarda e o perigo de um lugar olham os jogadores (no máximo 4) só
quando há alguém alistado; o `e.pvp` dos outros jogadores a cada 0,5 s. Medido (Chrome headless, a vila do início com 410 criaturas e uma coluna viva): a ordem do jogador
local **0,003 ms** por cálculo (4 por segundo), o tique do anfitrião **0,004 ms** (2 por segundo), a conferência da viagem
**0,0015 ms**. Os avisos: no máximo **dois de cada vez** (`ui/notify.js`: os outros esperam numa fila curta, os importantes
primeiro, e entram quando um sai ou depois de ~1,6 s); a ordem nova não vira aviso quando o próprio cartão a mostra (ele
pisca e soa) — só quando um painel o cobre.

### Prints

`shots/` (fora do git; sem o painel de depuração): **mural** — `ar_mural_enlist_req_desktop` (o cartão Alistamento com
um requisito faltando: "Reputação Conhecido … faltam 15"), `ar_mural_enlist_ok_desktop` (tudo ✓, o botão "Alistar-se na
milícia de Estrosa", a tabela de postos), `ar_mural_enlisted_desktop` ("Você está no exército", o posto, o soldo, a ordem
agora), celular 915 × 412 toque: `ar_mural_enlist_req_phone` / `_2`, `ar_mural_enlist_ok_phone`; **ordens** —
`ar_orders_peace` ("Em paz: a milícia de Estrosa treina"), `ar_march_with_army` / `_2` (marchando com a coluna do exército
de Galéria pela praça, o general com o estandarte, o cartão "Marche com o exército até Gralude", a marca vermelha no
radar), `ar_map_orders` (o mapa com o exército e a bandeira vermelha do destino presa na borda), `ar_orders_catch_up`
("Alcance o exército · 31 passos" e a seta vermelha "Exército" na borda), `ar_orders_phone` / `ar_orders_catch_up_phone`
(o cartão no celular, a seta da borda); **cerco** — `ar_siege_orders_camp` ("Marche até o acampamento diante de
Estrosa"), `ar_siege_orders_phase` ("Proteja os engenheiros" com a seta para a Oficina de cerco entre as tendas),
`ar_siege_camp_order_debug` ("Monte o acampamento…"), `ar_ram_push` / `ar_ram_push_2` / `ar_ram_gate` (o jogador
empurrando o aríete com três soldados do seu exército até o portão — "Aríete · 4 pessoas" —, a guarda da vila atirando
nele), `ar_assault_orders` ("Estrosa é nossa! Segure a praça", os vencedores em roda na praça, a bandeira "Praça");
**viagem** — `ar_travel_button` (na vila: "Alcance o exército · 395 passos" e o botão "Ir até o exército"),
`ar_travel_arrived` / `ar_travel_marching` (um toque: ao lado da coluna em Torre de Cerverna, "Marche com o exército até
Gralude · 40 soldados do Reino de Galéria · chega em ~2 dias e meio de jogo · 1 901 passos"); **soldo** — `ar_pay_promotion` ("Promovido a Sargento!", "+68 Moeda de ouro", "Soldo de campanha…"); **PvP** —
`ar_pvp_1` / `_2` / `_3` (anfitrião e convidado lado a lado, membros de Galéria e de Arenudia em guerra, cada um vendo o
outro com a plaquinha vermelha "Sobrevivente · Reino de … · inimigo", trocando golpes; os cartões de ordens dos dois).

### Decisões (para o dono confirmar)

- **Reputação para alistar**: milícia da vila com **Conhecido** (25); guarnição do castelo e exército da cidade com
  **Respeitado** (100).
- **Os civis continuam protegidos sempre**, mesmo de quem está alistado num reino em guerra (moradores, crianças,
  anciãos, ofícios). Só a **guarda** de um lugar inimigo pode ser ferida, e só por quem está **alistado** (ser membro
  basta para soldados e jogadores inimigos, não para a guarda).
- **PvP só entre membros de reinos em guerra** (alistados ou não), decidido no anfitrião; nunca entre viajantes, do mesmo
  reino, aliados ou reinos em paz. Morrer para outro jogador é como morrer em qualquer luta (os itens caem; a reputação
  fica).
- **Os inimigos tratam o alistado como inimigo nas terras deles** (o sino toca e os portões fecham quando ele entra);
  um membro não alistado de um reino em guerra não aciona a guarda (é inimigo no comércio, não na rua).
- **Soldo** 20 / 30 / 45 / 65 por dia (×1,5 em guerra) e **bônus** 40 / 90 / 50; reputação +1 / +2 por dia servido.
- **Deserção** = dar baixa (ou sair do reino) com o exército em combate: −25 de reputação e 2 dias sem poder voltar
  àquele reino. Afastar-se do exército não é deserção (as ordens só chamam de volta).
- **Um exército por vez**; para trocar, dar baixa antes. A campanha que o jogador segue é a do seu lugar; sem ela, a do
  reino mais perto da sua casa; com a casa cercada, a defesa dela.
- **A pedra do trabuco do exército é do exército** (o soldado não gasta as suas).
- **Marcha escoltada**: o exército vivo com um alistado junto continua marchando pelo relógio da 3a (sem escolta,
  parado como na 3b).
- **Viagem com o exército** (**decidido pelo dono**): marchas longas não precisam ser seguidas a pé — o botão "Ir até o
  exército" leva o alistado, a partir de um lugar do seu reino, para junto do exército (ou do acampamento do cerco), sem
  pular o tempo, conferido pelo anfitrião e recusado perto de inimigos, numa luta, com uma máquina de cerco nas mãos ou
  com o lugar sob cerco.
- A faixa do lugar ("Estrosa · Vila · Reino de Galéria") espera sob os painéis abertos (no celular ela cobria o título e
  as abas do mural).
- Pendente / ideias: escoltar caravanas, ordens por papel (arqueiro na muralha, engenheiro nas obras), o jogador
  general de uma campanha, medalhas, o soldo atrasado para quem estava fora.

### Decisões da fase 3 confirmadas pelo dono (5/11/2026)

O dono aprovou ("Estão boas") as decisões da fase 3 que estavam "para o dono confirmar" em §13, §14 e §15, entre elas:
os civis nunca podem ser feridos; só o alistado fere a guarda inimiga (soldados inimigos e PvP: basta ser membro de um
reino em guerra); a guarda inimiga só persegue alistados; alistar-se pede Conhecido (milícia da vila) ou Respeitado
(castelo / cidade); soldo 20 / 30 / 45 / 65 por dia (×1,5 em guerra), bônus e deserção (−25 de reputação e 2 dias sem
entrar naquele reino); um exército por vez; o exército fornece as pedras do trabuco; rivais distantes na mesma terra
(capitais até 2 800 tiles) podem guerrear; os lugares de um reino que cai vão para quem tomou a última cidade dele; num
lugar tomado os moradores ficam e só a guarda troca de cor. Mudar qualquer uma delas pede o dono.

## 16. Ataques de monstros aos lugares

Feito (pedido do dono no §1, "Ataques aos lugares no inverno"): nas noites da estação ruim de cada região os mortos dela
**atacam as vilas, castelos e cidades** — uma onda **um pouco menor que a guarda** do lugar, vinda de um lado, contra a
muralha / o portão / a paliçada / a beira de uma vila aberta —, e a defesa do §11 acontece de verdade: o sino, os arqueiros
nas muralhas, o corpo a corpo nos portões e no trecho atacado, as brechas seguradas, os civis em casa. Os humanos quase
sempre vencem; **raramente (~5 %, medido)** a defesa cai — a noite custa guardas e moradores e o lugar fica danificado,
**nunca todo o povo**; no dia seguinte o povo reconstrói, inclusive a casa que o jogador **aluga**, mas **nunca** a
propriedade **privada** dele (a casa comprada e o que ele construiu no terreno: ele conserta). Longe dos jogadores tudo
isso acontece **por números**, com a mesma taxa. Código: `game/raids.js` (o plano da noite, a onda ao vivo, os números
longe, a reconstrução, a propriedade privada, "Consertar" / "Reconstruir"), `game/raidsim.js` (a luta por números, pura:
roda no node), `game/content/raids.js` (os números), `game/mut/raids.js` (estado, ops, linhas), `ui/raidHud.js` (avisos),
`tools/raid-calib.mjs` (calibração). Ganchos de uma linha em `walkers.js` (o alvo da onda, rachaduras persistentes na
propriedade privada, o registro do que ela quebra), `giants.js` (o golpe e a pedra do gigante ferem a guarda — antes só
feriam jogadores), `mobs.js` (a onda não dorme longe dos jogadores), `bandits.js` (a onda nunca desiste nem se cura), `people.js` (a
guarda inteira sai durante o ataque; o alarme dura até a ameaça ser neutralizada; o sino não repete o aviso), `npc.js`
(os arqueiros andam pelo adarve até ter alcance; o povo não conserta propriedade privada), `towns.js` (nem a refaz), `building.js`
("Consertar"), `controller.js` ("Reconstruir"), `ui/muralEco.js` (o estrago na aba Propriedades), `ui/mural.js` (o
último ataque), `net/snapshot.js`, `net/digest.js`, `systems.js`, `mut/index.js`, `tools/mp-test/act.js`.

### Como se joga

- **Quando**: a cada noite de estação ruim de um lugar (a mesma regra dos mortos da noite: o inverno dos andarilhos no
  temperado / subpolar, toda noite no polar, o inverno ameno da zona quente, a estação seca dos trópicos; deserto: múmias),
  ele é atacado com **60 %** de chance (polar: **35 %** — lá toda noite é de inverno), numa hora sorteada do escuro
  (21h20 – 2h25) e de um lado sorteado (8 direções). Decisão: nem todo lugar toda noite — o inverno fica perigoso e o
  jogador nunca sabe se é a noite dele —, mas a maioria das noites de inverno de uma vila tem ataque. O plano da noite é
  um *hash* do mundo, do lugar e da noite: o mesmo depois de recarregar.
- **A onda**: **70–90 % dos guardas vivos** do lugar (arqueiros incluídos: sempre menos monstros que guardas), da família
  da região (Andarilhos do Gelo / Esqueletos / Múmias); em castelos (45 %) e cidades (60 %) um **gigante** da família a
  lidera (onde a família tem gigante) e **conta como 4**. Aparece fora da terra do lugar, do seu lado (fora da vista
  quando dá), vai para o meio do lugar **através da muralha** (não atrás das luzes de fora), quebra o tronco / a pedra / o
  portão na linha (as regras dos andarilhos: brecha), entra e luta com a guarda.
- **A força** (o equilíbrio do §7b): por números puros a guarda é muito mais forte que os mortos da noite do mesmo nível
  (×1,6 de vida, ×1,5 de dano, armas de ferro, escudo, elmo — longe do início um andarilho vale ~1/5 de um guarda). Por
  isso cada monstro da onda tem uma **fúria** (vida e dano ×, entre 0,75 e 3,2) calculada com os números do próprio jogo
  (vida, dano, ritmo da arma e golpes especiais, armadura de cada um contra o nível do outro) para que, **na luta ao vivo
  medida**, um monstro valha ~2/3 de um guarda corpo a corpo do lugar. Assim a batalha é igual perto do início e na borda
  do mundo: a guarda vence, mas perde gente (uma vila de 8 guardas perde 1–2). Os números: no modelo de rodadas um guarda
  vale `par` = 2,6 monstros, com o modelo ajustado ao que a luta ao vivo mostrou (`RAID.eff`: os mortos batem ×1,3, um
  terço dos arqueiros tem a onda no alcance, os mortos na brecha batem nos primeiros guardas — `RAID.focus`; medido em WA6,
  abaixo).
- **A horda** (o raro): em **7,2 %** dos ataques vem uma horda — os mortos mais antigos: a mesma contagem (82–90 % da
  guarda, nunca mais que ela), cada um mais forte (vida e dano: vila ×1,35, castelo ×1,65, cidade ×1,6), o gigante vem
  mais vezes. O aviso diz que é uma horda ("a guarda vai precisar de ajuda") — o jogador pode virar a noite.
- **A defesa cai** (op `raid.fall`) quando sobra 1/4 dos guardas de corpo a corpo (vila: 1) e ainda há 2+ monstros de pé:
  "A defesa de X caiu! Os mortos invadem as ruas". A noite está perdida; os mortos andam pelas ruas até morrerem ou o dia
  nascer.
- **O fim**: todos caídos, o amanhecer (eles desmancham) ou — os jogadores se afastaram — o resto da luta por números de
  onde parou. **Perdida**: os mortos arrombaram casas — as que quebraram ao vivo e outras perto de onde entraram (2–5 por
  números) —, cada morador delas morre com 50 % (**nunca mais que 22 % dos moradores**); por números as portas dessas
  casas caem e paredes racham. Os mortos são repostos em **1,5 dia** como qualquer morte (§11). **Sem aviso por morte**
  (regra do dono): o sino, a luta e o aviso do fim contam a história.
- **Avisos** (perto do lugar: a terra + 90 tiles): "Andarilhos do Gelo atacam Estrosa pelo norte! · 7 contra 8 guardas —
  o sino toca: o povo corre para casa, os arqueiros sobem nas muralhas e a guarda vai para o norte" (a horda: "Uma horda
  de …"; com gigante: "… e o Gigante de Gelo atacam …"); "A defesa de Estrosa caiu!"; no fim "Estrosa resistiu ao
  ataque · 7 andarilhos derrotados · 1 guarda caiu" ou "Estrosa sobreviveu à noite, com perdas · 3 moradores mortos, 4
  guardas caíram, casas arrombadas e a muralha aberta. A partir de amanhã o povo reconstrói a vila". O aviso genérico do
  sino ("Alarme em X…") não se repete durante um ataque.
- **Mural · Lugar**: as noites do lugar ("Nas noites de inverno os Andarilhos do Gelo atacam…") e o último ataque ("noite
  do dia 12: resistiu · 7 andarilhos · 1 guarda caiu"); "· sob ataque" no título enquanto dura.

### A propriedade do jogador (regra do dono)

- **Alugada**: é do lugar — o povo a conserta e a refaz como o resto (aviso: "Os monstros danificaram a casa que você
  aluga em X — o povo conserta a partir de amanhã").
- **Comprada** e **o terreno**: privadas. O povo **nunca** as conserta nem refaz (os consertos do §11 de dia, os por
  números, a reconstrução depois de 2 dias e a de um ataque — `TOWN.privatePiece`), e o que os mortos fazem nelas
  **fica**: as peças da casa no estado do lugar (salvo, igual nos pares); as estruturas do terreno com a rachadura
  **persistente** do cerco (`siege.dmg` / `o.sdmg`: não somem ao amanhecer, vão no save). Aviso ao dono, onde ele estiver
  (fixo até fechar): "Os monstros danificaram sua casa em X: conserte-a você mesmo · O povo não conserta propriedade
  privada. Perto de uma parede rachada: Consertar (E); uma peça destruída: Reconstruir (com o material dela)…" / "…o que
  você construiu no seu terreno em X". O mural (Propriedades) mostra "⚠ danificada: 2 peças rachadas, 1 destruída ·
  conserte você mesmo".
- **Consertar** (E / o botão de ação): numa peça rachada da casa que é sua (comprada ou alugada) ou de algo seu onde você
  pode construir — golpes de martelo, cada um um passo (madeira −34 %, pedra −20 % da rachadura; intent `prop.fix`, o
  anfitrião confere dono e distância). Numa porta, "Abrir" continua primeiro e "Consertar" é a segunda escolha.
  **Reconstruir**: ao lado de uma peça destruída da sua casa, com o material dela na mochila (pago na hora, devolvido se
  o anfitrião recusar) → `town.restore`.

### Por números (longe de todos os jogadores)

- Quando chega a hora de um lugar sem jogador perto (a terra + 40 tiles), a luta é feita **na hora** por `raidsim.js
  fight`: a onda anda até o muro sob as flechas, quebra a peça (os mesmos segundos-de-andarilho de `walkers.js`: madeira
  105, pedra 350; até 4 batendo; o gigante ×8), depois a luta na brecha (poucos de cada vez, mais conforme entram; os dois
  lados batem em quem está na frente), os arqueiros atirando o tempo todo, até a onda morrer, a defesa cair ou o dia
  nascer. Os mortos (guardas e moradores) e o estrago vão na op `raid.end` para o estado do lugar como o cerco por
  números: a muralha do lado do ataque rachada (1–3 peças; com brecha às vezes uma cai), perdida: a brecha (1–2 peças),
  o portão daquele lado (40 %), casas arrombadas — carregado ou não; as linhas levam o tile e o tipo da peça (nenhum par
  precisa da planta para gravá-las).
- **Barato**: o plano da noite olha cada lugar uma vez ao anoitecer (a família pelo clima do planeta e o bioma da célula,
  sem carregar nada); no máximo 3 lutas por números por meio segundo, ~0,05–0,3 ms cada. As peças só quando a planta do
  lugar já foi feita neste par, ou numa noite perdida / num lugar com propriedade de jogador (planejado uma vez: 7–55 ms);
  uma vila longe que resistiu fica só com as mortes.
- **No dia seguinte**: de manhã (7 h – 18h36), a cada hora do jogo, até 6 peças destruídas por lugar atacado nos últimos
  dias são refeitas por números (`town.restore`) — longe dos jogadores (perto, o povo faz à mão: `npc.js repairTick`) e
  nunca uma casa comprada.

### A calibração (o ~5 % do dono)

`raidsim.js` usa as tabelas do próprio jogo: as criaturas (`SPECIES`, `mobStats`), as armas, a armadura e o escudo, os kits
dos mortos (`undead.js`), o kit da guarda (`people.js`). Medido:

| Amostra | Ataques | Perdidos | Hordas (perdidas) | Ondas normais perdidas | Guardas mortos |
|---|---|---|---|---|---|
| O reino de verdade (semente 4242, os 240 lugares com o clima, a família e o nível de cada um: `game.raids.dbg.calibrate`, WA3) | 8 000 | **406 (5,08 %)** | 603 (386: 64 %) | 0,3 % | 21 % |
| Reino sintético (`tools/raid-calib.mjs 40000 7`: 77 % vilas, 17 % castelos, 6 % cidades, 3 famílias, níveis sorteados) | 40 000 | 2 527 (6,32 %) | 2 913 (2 454: 84 %) | 73 (0,20 %) | 20,2 % |
| — vila com paliçada / aberta | | 6,1 % / 6,5 % | 84 % / 88 % | 0,11 % / 0,32 % | 19 % / 27 % |
| — castelo / cidade | | 6,3 % / 5,4 % | 86 % / 71 % | 0,11 % / 0 % | 18 % / 17 % |

A taxa vale pelo reino de verdade (a chance da horda, 7,2 %, foi acertada nele: com 6 % dava 4,1 %); a amostra sintética,
com níveis sorteados, fica um pouco acima (6,3 %). As ondas normais quase nunca vencem (~0,2 %) e matam ~1/5 da guarda
(uma vila de 8 perde 1–2); uma horda vence 2 a 4 vezes em 5 conforme o lugar.

### Ao vivo (perto dos jogadores)

A calibração só vale se a luta de verdade bater com os números — e no começo não batia. `WA6` (`&raidsoak=N`) põe N ondas
seguidas contra a guarda inteira da vila do início (Estrosa: 8 guardas, 3 arqueiros, paliçada; os mortos de volta e a
paliçada refeita entre elas) e anota, de cada uma, o resultado ao vivo e a previsão dos números para o mesmo lugar.

- **Primeiras medidas** (ondas normais, fúria 1,37): perdidas 3 de 4, 3–5 guardas mortos — o modelo previa ~1 e 0 %. Os
  números da luta (`waFightLog`: quem bateu em quem) mostraram por quê, e eram defeitos, não equilíbrio: os mortos
  **fugiam e se curavam** (o "evade" dos saqueadores: imunes, +30 % de vida por segundo; e +4 %/s parados) — o dano dos
  arqueiros sumia; **perseguiam o arqueiro no alto da muralha** que os acertava (sem conseguir subir, até desistir e
  curar); no teste, os lobos de fora tomavam parte das flechas (o teste agora os afasta); e — o apontamento do dono — o **alarme caía** quando o monstro
  recuava uns passos e os **arqueiros ficavam parados fora do alcance**. Corrigido: a onda nunca desiste nem se cura
  (`bandits.js`), ignora o arqueiro lá em cima (`walkers.js`), o alarme dura até a ameaça morrer e os arqueiros andam pelo
  adarve (§11).
- **Depois** (8 ondas, uma calibração intermediária): as normais 5 de 5 seguras (2 guardas mortos cada), as hordas 3 de 3
  seguras (2–4 mortos): a guarda agora vencia demais. O modelo foi ajustado a isso (`RAID.eff`: os mortos ×1,3, um terço
  dos arqueiros no alcance, os mortos na brecha batendo nos primeiros guardas) e recalibrado (par 2,6, horda ×1,35–1,65).
- **Com os números finais** (6 ondas): normais **2 de 2 seguras** (0 e 2 guardas mortos; previsão 1,3); hordas **3 de 4
  perdidas** (previsão 79 %; 4, 2, 5 e 4 guardas mortos — previsão 4,0; 2–7 moradores mortos nas perdidas). A taxa ao vivo
  estimada: 0,928 × ~0,2 % + 0,072 × 64–79 % ≈ **5–6 %**, a mesma dos números. (Amostras pequenas — cada onda leva 40–120 s
  de jogo; o modelo é o que dá a taxa, e a luta ao vivo confere que ele bate com ela.)

### Multijogador e saves

Anfitrião autoritativo. Estado em `game.raids` (todos os pares): `on` (os ataques acontecendo: lugar, noite, família,
monstros, guardas, gigante, horda, lado, hora, ao vivo, defesa caída) e `log` (os últimos 80: noite, lugar, resultado,
monstros, guardas e moradores mortos, ao vivo, horda, hora, família). Ops `raid.start` · `raid.fall` · `raid.end` (as
mortes, as peças por números, as rachaduras das estruturas privadas, quem teve propriedade atingida); intent `prop.fix`.
As criaturas da onda vão no fluxo de entidades como os andarilhos (o convidado vê as mesmas). Snapshot / save:
`world.raids` (`raidRows`); digest: linhas `raid:` e `rlog:` na parte `towns`. O plano da noite fica só no anfitrião (é
um hash: o mesmo depois de carregar). Os avisos são locais (cada par decide o que mostra ao seu jogador).

### Desempenho

Medido (Chrome headless deste PC, WA3 / WA4):

- **O sistema dos ataques** (anfitrião, a cada 0,5 s): **0,012 ms** por tique em média durante o ataque ao castelo (pior
  5,7 ms: o tique que faz a primeira leva da onda — 8 criaturas e o gigante); o **povo** no mesmo ataque, com a guarda
  inteira para fora (17 guardas-criatura): **0,18 ms** por quadro.
- **Por números**: uma luta 0,12 ms (8 000 em ~1 s, `dbg.calibrate`); um ataque longe inteiro (a luta, as mortes, as
  peças da muralha e das casas, a op) **~1,2 ms**; no máximo 3 por meio segundo. O plano da noite: uma vez ao anoitecer,
  ~240 lugares (o clima de cada um guardado: `climateAt` uma vez por lugar).
- **Teto ao vivo**: 24 criaturas da onda de uma vez (qualidade baixa: 60 %), o resto entra a cada 1,4 s conforme caem; a
  guarda inteira vira criatura durante o ataque (o teto do povo do lugar continua valendo: 40 / 30 / 60). Nada varre peças
  por quadro: o que a onda quebra chega pelo gancho de `walkers.js hitPiece`; o adarve dos arqueiros é guardado por mudança
  do estado do lugar.

### Testes

`tools/mp-test.js` **WA1–WA7** e **VL13** (os ataques ficam pausados em todo cenário — `act.js reset` — e os WA os forçam com
`game.raids.dbg.force`; os outros mortos da noite ficam de fora enquanto o cenário roda): WA1 noite de inverno na vila do
início com os dois jogadores — a onda (70–90 % dos guardas, andarilhos, do norte, todos do lado certo fora da terra), o
sino, a ameaça do lado certo, os arqueiros na paliçada, o corpo a corpo nos portões / trecho, a paliçada atingida do lado
do ataque, o fim com o lugar de pé, a mesma linha do log nos dois, sem aviso por morte · WA2 a derrota forçada (horda,
`lose`): "A defesa … caiu", o fim perdido, o povo vivo (≥ 78 % dos moradores), as casas comprada e alugada arrombadas e a
parede do terreno rachada (persistente) nos dois, os avisos do dono, o mural; ao amanhecer a rachadura fica; de manhã o
povo refaz a porta da casa alugada e não toca na comprada nem no terreno; o convidado conserta a parede (Consertar) e
refaz a porta (Reconstruir); os mortos voltam 1,5 dia depois · WA3 por números — a taxa medida no reino de verdade
(8 000 ataques), uma noite perdida longe (mortes, brecha do lado certo, rachaduras, a casa do convidado arrombada e o
aviso a ele), uma que resistiu, a reconstrução por números no dia seguinte (menos a casa dele) · WA4 o castelo: o gigante
na frente (conta como 4), o teto de criaturas, a guarda inteira para fora, o golpe do gigante fere a guarda, o custo ·
WA5 save → load (o ataque acontecendo e o log), o plano da noite igual · **WA6** (só com `&raidsoak=N`: uma calibração
longa) N ondas seguidas na vila do início contra a guarda inteira (os mortos de volta, a paliçada refeita entre elas), o
resultado ao vivo ao lado da previsão dos números para o mesmo lugar · **VL13** o alarme até a ameaça ser neutralizada
(apontamento do dono, §11): um lobo forte 6 tiles fora da paliçada, recuando 9 tiles além da terra do lugar e voltando, por
65 s — o sino nunca para, nenhum arqueiro desce da muralha e todos acertam o lobo (andando pelo adarve até ter alcance), o
corpo a corpo nos postos; o "tudo calmo" só depois que ele morre · **WA7** a atenção dos mortos (§11, jogo normal, sem
ataque): seis andarilhos no portão norte da vila do início numa noite de inverno, os dois jogadores 6 tiles por dentro —
em 30 s o povo do lugar recebe mais da atenção deles que os jogadores e eles se espalham por pelo menos dois defensores;
o jogador acerta um e ele vem atrás dele. Todos terminam com o digest igual.

**Resultados** (Chrome headless deste PC, perfil limpo). A rodada inteira no fim (`run=all&soak=60`, 204 cenários,
~62 min): **196 passam, 6 falham, 2 pulados** (S28 só pela linha de comando, WA6 só com `&raidsoak`) — WA1, WA3–WA5, WA7,
VL1–VL13, SK1–SK5 (a escaramuça da main, que usa a mesma defesa e a mesma atenção dos mortos), NM, EC, WR e BT todos
passam. As 6: **WA2** (a porta da casa alugada nunca voltava: quem a refazia esperava por si mesmo — §11 Consertos;
corrigido depois da rodada), **AR2** (as ordens do general: 3 de 4 vistas — falha igual desde antes deste trabalho, na
parte dos exércitos), **K1**, **HO1**, **HO3** e **S9** (da ordem da rodada: HO1 / HO3 falhavam igual na primeira rodada
inteira). Depois do conserto, WA1, WA2, K1, S9, HO1 e HO3 rodados juntos: **6 / 6 passam**. A primeira rodada inteira,
antes dos consertos de IA e da junção com a main: 180 / 10 / 2. Pelo caminho: WA1 falhava (a onda normal derrubava a
defesa) até os consertos de IA acima; WA2 conferia os avisos do convidado com dois avisos fixos na frente (o teste agora
os fecha antes; os da propriedade viraram um aviso só); WA3 pegava a guarda pelo nome errado do campo (`place.g0`); WA7
via os seus andarilhos mortos pela limpeza dos hostis do próprio teste; o teste do alarme era VL11, o mesmo nome de um da
main (agora VL13).

### Prints

`shots/` (fora do git; sem o painel de depuração; 1264 × 625): `wa_village_wave_palisade` / `wa_village_wave_2…5` (uma
onda de Andarilhos do Gelo no portão norte da paliçada de Estrosa numa noite de inverno, os arqueiros no alto da paliçada,
os guardas segurando o portão), `wa_village_held_notice` ("Estrosa resistiu ao ataque · 6 andarilhos derrotados · 2
guardas caíram"), `wa_castle_giant_wave` / `wa_castle_giant_fight` / `_2` (a Torre de Dorilde: o Gigante de Gelo e 11
andarilhos no portão norte, os arqueiros nas torres, a guarda no portão), `wa_loss_horde_notice` ("Uma horda de
Andarilhos do Gelo ataca Estrosa pelo norte! · 7 contra 8 guardas…" e "A defesa de Estrosa caiu!"), `wa_loss_streets` /
`_2` (a horda rompendo o portão norte), `wa_loss_end_notices` ("Estrosa sobreviveu à noite, com perdas · 3 moradores
mortos, 2 guardas caíram…" e o aviso fixo ao dono "Os monstros danificaram sua casa em Estrosa: conserte-a você mesmo"),
`wa_own_house_damaged` (de manhã, a casa comprada ainda arrombada, o botão "Consertar" ao lado da parede rachada),
`wa_mural_damage` (Propriedades: a casa "⚠ danificada … conserte você mesmo"), `wa_mural_nights` (o mural do lugar),
`wa_rebuild_morning` / `_2` (de manhã o lavrador refazendo a porta de uma casa arrombada).

### Decisões (para o dono confirmar)

- **Frequência**: 60 % das noites ruins de cada lugar (polar 35 %), hora e lado sorteados — o inverno fica perigoso sem
  ser toda noite em todo lugar.
- **A fúria**: os mortos de uma onda têm vida e dano ajustados ao lugar (× 0,75–3,2): perto do início um pouco menos que os
  soltos, longe ~1,4× — senão a guarda (×1,6 vida, ×1,5 dano, ferro) esmagaria qualquer onda menor que ela sem perder
  ninguém. Um jogador que luta com a onda sente isso.
- **A horda** é o "raro" do dono: 7,2 % das ondas, a mesma contagem, mais fortes — o aviso diz que é uma horda.
- **O alarme até a ameaça ser neutralizada** (apontamento do dono): 30 tiles além da terra do lugar e 40 s de memória
  depois do último ataque / aproximação de cada monstro; os arqueiros andam pelo adarve atrás de alcance (§11).
- **A guarda no lado atacado e a atenção dos mortos** (apontamentos do dono na escaramuça, valem para o jogo todo — §11):
  os arqueiros todos no adarve do lado do ataque, os portões dos fundos sem guarda numa guarda pequena; os mortos dividem a
  atenção entre os defensores e só preferem o jogador quando ele os ataca, é o mais perto ou por sorteio (~1 em 7).
- **Uma noite perdida** mata no máximo 22 % dos moradores e arromba 2–5 casas; a guarda pode cair quase toda (volta em
  1,5 dia); ninguém perde a casa por isso.
- **Propriedade privada** = a casa comprada e as estruturas no terreno; a alugada é do lugar. As rachaduras de ataque nas
  estruturas do terreno não somem ao amanhecer (como as de cerco). "Consertar" é de graça (tempo); "Reconstruir" custa o
  material da peça.
- Um lugar sitiado por um exército não é atacado pelos mortos naquela noite.
- Pendente / ideias: o mapa marcar os lugares atacados na noite; um trabalho "defender a vila" que pague mais numa noite
  de horda; o jogador pagar o povo para consertar a casa dele.

## Ideias para o futuro (anotadas a pedido do dono, 5/11/2026)

Nada disto está em andamento; fica guardado para quando o dono pedir.

- **Navios** (o dono já deixou para depois): até lá, reinos que não se ligam por terra não interagem.
- **Pontes** nos rios (hoje as estradas cruzam por vaus).
- **Caravanas** de verdade no mapa (hoje o espalhar de preços entre lugares é abstrato) e o jogador **escoltando**
  caravanas como trabalho.
- **Ordens por papel** no exército: arqueiro no alto da muralha, engenheiro nas obras das máquinas, guarnição da balista.
- **O jogador general** de uma campanha (escolher o alvo, mandar o exército).
- **Medalhas** e honrarias por serviço; soldo atrasado para quem estava fora do mundo.
- **Barracas de mercado** nas praças (os mercadores hoje ficam na beira da praça) e **catapultas** nas muralhas das
  cidades (hoje só balistas).
- **Moradores subindo escadas** de verdade (hoje os arqueiros aparecem no alto da muralha quando ninguém vê).
- **Cavalos com potros** (pergunta ainda sem resposta do dono).
- **Testes:** isolar os cenários de cerco (BT / AR deixam a vila do início marcada como "cerco recente" e atrapalham os
  VL que rodam depois na mesma página).
