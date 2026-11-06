# Escaramuça (skirmish) — o pedido do dono e como ficou

> "Crie também um modo skirmish que é um botão no menu que também pode abrir para multiplayer com todos entrando no
> lobby e depois um botão para iniciar a partida com opção de batalha em campo e em cerco com um slider ajustando a
> proporção de soldados para cada lado, o jogador seleciona se é arqueiro ou lanceiro ou espada, … os jogadores podem
> escolher cada lado inclusive jogar pvp escolhendo lados opostos, … deve ter um slider para selecionar a quantidade de
> soldados em batalha de 0 a 300, se é uma vila, se a vila tem paliçada, se é um castelo ou se é uma cidade."
> "Inclusive poder selecionar um modo que é defesa contra monstros do inverno, podendo selecionar qual o tipo de monstro
> … mas dessa vez não podendo escolher o lado dos monstros, e claro, quanto mais monstros mais quantidade de gigantes."

Correções do dono durante o trabalho (valem sobre o pedido): **nada de item novo** — soldados com **armadura e armas de
cobre** (arqueiros com o **arco simples**), jogadores com **armadura de ferro e armas de aço**; o arco do jogador é o
**arco composto** (o que se faz com barra de aço: "é desse que eu estava falando"); **nesse modo o jogador não morre de
frio nem de fome**; **o lanceiro também tem escudo**.

## Como se joga

- **Menu principal → "Escaramuça"** (logo abaixo de "Multijogador"). O jogo monta a **arena** — um mundo descartável
  (planeta da semente 4242: a vila do início, Estrosa, tem paliçada; vilas abertas, castelos e a capital por perto) — e
  abre o **lobby** por cima dela: o fundo é o próprio lugar escolhido, ao vivo (escolher "Castelo" leva a vista ao
  castelo).
- **Sozinho ou com amigos**: no lobby, **"Abrir para amigos"** abre a sala ali mesmo (o código e "Copiar convite" no
  alto do lobby). Os amigos entram como em qualquer sala (Multijogador → Entrar com código, ou o link `?sala=`) e **caem
  no lobby**, não num mundo. Quem entra no meio de uma partida assiste e joga a próxima.
- **O lobby** (o anfitrião escolhe a partida; os outros veem tudo igual, ao vivo):
  - **Modo**: *Batalha em campo* · *Cerco* · *Defesa contra monstros*.
  - **Lugar** (cerco e defesa): *Vila sem paliçada* · *Vila com paliçada* · *Castelo* · *Cidade* — o lugar de verdade do
    reino mais perto do início daquele tipo (o nome, o reino e a distância aparecem no título).
  - **Monstros do inverno** (defesa): *Andarilhos do Gelo* · *Esqueletos* · *Múmias* (cada um com o seu gigante).
  - **Soldados na batalha**: 0–300, de 10 em 10 (cerco e defesa: no mínimo 10; em campo, 0 = só os jogadores, PvP).
  - **Proporção**: 5–95 % (de 5 em 5) entre os dois lados; os números de cada lado mudam ao vivo enquanto se arrasta
    ("90 Atacantes · 210 Defensores"; na defesa "90 defensores · 210 monstros (8 gigantes)"). Com soldados, cada lado tem
    pelo menos 1.
  - **Lados**: as duas colunas com o brasão e as cores de cada reino ("Exército A / B", "Atacantes / Defensores",
    "Monstros / Defensores") e os jogadores de cada uma; "Jogar deste lado" troca. **PvP**: jogadores em lados opostos
    lutam entre si. Na defesa contra monstros **todos defendem** (o lado dos monstros não se escolhe).
  - **Classe**: *Arqueiro* (arco composto), *Lanceiro* (lança de aço e escudo), *Espadachim* (espada de aço e escudo) —
    todos com **armadura e elmo de ferro**.
  - **Como se vence** (um quadro curto por modo) e a última partida.
  - Rodapé: **Sair** (volta ao menu), o motivo de ainda não dar para começar ("Aguardando Fulano ficar pronto"), e
    **"Iniciar partida"** (anfitrião; só com todos prontos) ou **"Estou pronto"** (convidados).
- **A partida**: "Preparando o campo de batalha…" (o lugar é montado, as forças sobem) → **contagem de 5 s** ("3 · As
  linhas se formam" / "O cerco começa" / "A onda chega") com todos já nos seus lugares e com o equipamento → **"Lutem!"**
  (ou "Defendam!"). No alto, o **placar**: cada lado com o brasão, vivos / do início (as reservas contam) e uma barra, o
  relógio da partida (fica vermelho no último minuto), o lugar e os seus abates.
- **Fim**: o grito, 3 s, e o **resultado** em todos: "Vitória!" / "Derrota" / o vencedor, o motivo, o tempo, as perdas
  de cada lado ("72 de 140 perdidos") e a tabela dos jogadores (lado, classe, abates, mortes). **"Jogar de novo"**
  (anfitrião): todos de volta ao lobby com as mesmas escolhas, o campo limpo (forças, acampamento, máquinas e monstros
  somem, o lugar volta como era — peças, rachaduras, mortos, dono). **"Sair"**: menu principal.

### Os modos

| Modo | Lado A | Lado B | Vence A | Vence B |
|---|---|---|---|---|
| **Batalha em campo** | exército do reino A (3b `startBattle`) | exército do reino B | B debanda (a moral da 3b: baixas, general morto) ou cai inteiro | A debanda / cai |
| **Cerco** | exército de cerco (3b `startSiege`): **acampamento montado e máquinas prontas** (trabucos, aríete, torre — conforme as muralhas) | a **guarda do lugar** (§11) + uma **guarnição** de soldados nas muralhas, portões, brechas e praça | a praça tomada (a tomada da 3b: atacantes na praça sem defensor por perto — guardas, soldados da guarnição ou jogadores defensores) | o exército recua (baixas, moral) ou o tempo acaba |
| **Defesa contra monstros** | a **onda** da família escolhida, à noite | guarda + guarnição + todos os jogadores | os monstros seguram a praça 15 s sem defensor perto, ou caem todos os guardas e soldados | a onda inteira destruída, ou o tempo acaba |

- **Tempo**: campo 12 min, cerco 15 min, defesa 12 min. Campo no tempo: o lado com mais soldados vivos (em proporção)
  vence. **Campo sem soldados** (0): um **duelo** — o primeiro lado a **10 abates** de jogador (ou o tempo; se um lado
  fica sem jogadores, o outro vence).
- **Gigantes** ("quanto mais monstros mais gigantes"): **um gigante a cada 25 monstros**, no mínimo 1 a partir de 20, no
  máximo 12; fazem parte do número de monstros (10 → 0 · 20 → 1 · 50 → 2 · 100 → 4 · 210 → 8 · 300 → 12). Vêm
  espalhados ao longo da onda.
- **Os jogadores** (todos os pares: o lado de cada um é o estado compartilhado):
  - contam como **alistados** no reino do seu lado (§15): ferem os soldados e a guarda do outro lado, nunca os do seu
    ("… é do seu lado"); os soldados e a guarda inimigos **atacam** os jogadores do outro lado; os atacantes **empurram
    o aríete e a torre e operam os trabucos** do seu exército (a pedra é do exército); os civis continuam protegidos.
  - **PvP** só entre lados opostos durante a partida (a regra `pvpWhy`, conferida pelo anfitrião).
  - **Nível 12** na arena (os níveis dos mundos de sobrevivência não mudam: a arena é outro mundo).
  - **Sem frio e sem fome** (dono): fome e calor do corpo ficam cheios o tempo todo, nenhum efeito de frio / fome; só a
    luta fere. As flechas do arqueiro nunca acabam (repostas abaixo de 40). Mais 4 ervas medicinais.
  - **Morrer**: nenhum corpo, o equipamento fica com o jogador; **renasce sozinho em 8 s na retaguarda do seu lado** (o
    acampamento / a praça / atrás das linhas) com a vida cheia, sem "fraqueza". A tela da morte mostra a contagem (sem o
    botão "Renascer").
- **Os soldados** (todos os lados): **armadura e elmo de cobre e armas de cobre**, arqueiros com o **arco simples**;
  lanceiros e espadachins com o **escudo do reino** (proteção de um escudo de cobre). A armadura do corpo fica sob o
  tabardo (como na 3b): os lados se leem pelas cores do reino. Nível 10.
- **A guarda do lugar** no nível 10 (o recorde de progresso da arena), os monstros no 10 (gigantes 12).
- **A hora para**: dia (10 h) na batalha e no cerco, **noite (22 h)** na defesa — igual em todos; céu limpo; a IA dos
  reinos fica pausada (nenhuma guerra começa sozinha); os dois reinos da partida em guerra durante ela.
- **Sem avisos de morte** (regra do dono): só os gritos da batalha da 3b ("Ataquem!", "Firmes! Pelo Reino de X!", "Uma
  brecha na muralha!", "O portão caiu!", "Recuar!"), o placar e o resultado. As dicas do modo sobrevivência não aparecem
  na arena. Numa batalha grande **os números flutuantes de combate só aparecem quando o jogador local está na troca**
  (bateu ou apanhou) — os golpes, bloqueios e erros entre soldados / monstros não cobrem mais o campo (vale para o jogo
  todo); a onda de monstros mostra plaquinha só no alvo, em quem luta com você, no do mouse e nos gigantes.

## Nada é salvo

A arena é um mundo à parte: `game.noSave` em todos os pares (o anfitrião pelo menu / `?skirmish=1`; o convidado pela
mensagem de boas-vindas da sala, `welcome.sk`, antes de o mundo existir — então nem o save de convidado
`wos.save.v2.<semente>.guest` é lido ou escrito). Nada vai para `wos.save.*`, `wos.seed`, `wos.worlds`, `wos.snap` (SK1
confere sem `?nosave` na URL). Nível, mochila, economia, reputação e reinos dos seus mundos não mudam. Sair recarrega o
menu.

## Multijogador

- Anfitrião autoritativo como o resto. **Um estado só** (`game.skirmish.st`, ~1 KB): configurações, escolhas dos
  jogadores (`[pid, nome, lado, classe, pronto]`), a fase (`lobby → prep → count → fight → end`), a partida (lugar,
  reinos, números, gigantes, onde cada lado começa e renasce), o placar (no máximo 1 vez por segundo) e o resultado.
  Op **`sk.st {st}`** (o anfitrião troca o estado inteiro quando algo muda); intents **`sk.pick {side, cls, ready}`**
  (qualquer jogador, o próprio), **`sk.set`**, **`sk.start`**, **`sk.lobby`** (só o anfitrião). Snapshot `sk`, parte
  **`sk`** do digest (exata). Cada par move e equipa **o próprio jogador** a partir do estado (nenhuma op mexe no jogador
  local).
- A guerra é a de sempre: forças da 3b (`war.force`, soldados no fluxo de entidades, máquinas pelas ops de cerco), a
  guarda (§11), os monstros (`walkers.js` / `giants.js`, proxies no convidado).
- Abates: o anfitrião conta quem derrubou cada inimigo (`combat.killMob` → `game.skirmish.onKill`) e, no PvP, credita a
  morte de um jogador a quem o feriu por último em 15 s (`pvp.hit` → `game.skirmish.pvpHit`).

## Desempenho

300 soldados não podem ser todos criaturas: os **tetos de criaturas vivas da 3b sobem na escaramuça** pela qualidade
gráfica do aparelho, e o resto de cada lado são **reservas** que entram quando os vivos caem (a regra da 3b).

| Qualidade | total | por força | cerco | monstros vivos |
|---|---|---|---|---|
| alta | 120 | 64 | 72 | 60 |
| média | 96 | 52 | 60 | 48 |
| baixa | 56 | 30 | 34 | 30 |

Medido (Chrome headless deste PC, janela 1264 × 625, CPU por quadro = update + render; 1 200 quadros):

| Cena | criaturas / sprites | quadro: média / p95 / pior | > 8 ms · > 16 ms | sistema dos soldados (3b) | sistema da escaramuça |
|---|---|---|---|---|---|
| campo 300 (150 × 150, 120 vivos), no choque | 350 / ~880 | 3,9 / 5,8 / 12 ms | 17 · 0 | 0,29 ms (pior 2,3) | 0,004 ms |
| defesa 300 (210 andarilhos — 60 vivos, 8 gigantes — × 90 defensores) | 311 / ~2 000 | 4,6 / 6,2 / 27 ms | 14 · 1 | 0,15 ms | 0,004 ms |
| cerco da capital 300 (180 × 120 + guarda, 119 soldados vivos) | 447 / ~4 700 | 6,2 / 8,9 / 28 ms | 95 · 5 | 0,26 ms | 0,001 ms |

O sistema da escaramuça é barato (o placar a cada segundo, a onda e os fins a cada 0,25 s); o pico único (~40 ms) é
escolher a arena no lobby (a planta do lugar, uma vez). Uma onda de monstros nunca dorme longe dos jogadores
(`m.awake`): marcha sobre o lugar mesmo com todos na praça.

## Código

- `game/content/skirmish.js` — números e textos (modos, lugares, famílias, classes e kits, tetos, tempos, a regra dos
  gigantes `giantsFor`, a divisão `sidesOf`).
- `game/skirmish.js` — `game.skirmish` (todos os pares) e os sistemas: anfitrião (o lobby, a arena — o lugar, os reinos, o
  campo aberto —, as forças, a **guarnição** — uma força da 3b com tique próprio, `startForce` —, a onda, os fins, o
  resultado, "Jogar de novo") e de cada par (o próprio jogador: onde fica, o kit, as barras, o renascer, a hora parada).
- `game/mut/skirmish.js` — op / intents / linhas. `ui/skirmish.js` + `ui/skirmish.css` — lobby, contagem, placar,
  resultado (desktop e celular 915 × 412).
- Ganchos de uma linha nos arquivos compartilhados: `army.js` (`kOfEnt`, `pvpWhy`, sem bônus), `soldier.js`
  (`playerMayHurt`, o kit da força em `spawnSoldier`, soldados lutam com os mortos da noite), `warfare.js` (`startForce`,
  `keep` / `hold` / `kit` / `reach` / `min` das forças, jogadores de um lado como inimigos), `siegeAI.js` (a tomada conta
  soldados / jogadores defensores), `mut/siege.js` (máquinas do exército para o lado), `combat.js` / `mut/combat.js`
  (abates), `corpses.js` (sem corpo), `player.js` (onde renasce), `npc.js` / `people.js` / `towns.js` (jogadores de um
  lado para a guarda), `walkers.js` (`m.lure`: o lugar sobre o qual a onda marcha), `mobs.js` (`m.awake`),
  `hud.js` / `economy.js` (`game.noTips`), `overlay.js` (textos e plaquinhas), `menu.js` (o botão), `main.js` (a arena),
  `session.js` (`welcome.sk`), `netui.js` ("Sair da escaramuça"), `net/snapshot.js` / `net/digest.js` (parte `sk`).
- A onda é pequena e separada (`waveTick`, `waveSpot`, `tuneMob`): quando os **ataques de inverno aos lugares**
  (`game/raids.js`, de outro agente) chegarem, ela pode passar a usá-los — o gancho `m.lure` já é genérico.

## Testes

`tools/mp-test.js` **SK1–SK7** (`?run=SK1,SK2,SK3,SK4,SK5,SK6,SK7`; o par é uma sala de escaramuça própria, sem `?nosave`):
SK1 o lobby com dois jogadores (lados, classes, pronto, as configurações do anfitrião nos dois, o convidado não muda a
partida, "Iniciar partida" espera todos, na defesa todos defendem) e nada escrito nos saves de sobrevivência · SK2
batalha em campo 200 a 30 % (60 / 140 nas duas forças), o espadachim e o arqueiro com o equipamento certo e nível 12, os
soldados de cobre com o escudo do reino, **sem frio e sem fome**, quem pode ferir quem, o placar, a debandada → o
resultado igual nos dois · SK3 cerco da vila de paliçada com **PvP**: acampamento e máquinas prontos (do exército nos
dois), arqueiros da guarnição na paliçada, o lanceiro com escudo, o anfitrião (atacante) derruba o convidado (defensor) —
o abate, a morte, nenhum corpo, renasce sozinho na praça inteiro —, o cerco rechaçado → o resultado · SK4 defesa contra
múmias 200 a 40 % (80 defensores × 120 monstros com 4 gigantes, a regra dos gigantes), noite nos dois, só múmias, o teto
de vivos, marcham sobre o lugar sem se desfazer; a onda destruída → o resultado; "Jogar de novo" limpa o campo · SK5 o
botão no menu abre a arena e o lobby, "Abrir para amigos" abre a sala ali (a escolha segue o novo id), um cerco de
castelo começa (força de cerco + guarnição, o placar) e volta ao lobby · SK6 defesa de um castelo (300 a 70 %) com 40
monstros postos dentro dos muros em volta da praça por 30 s: o relógio do mundo segue, nenhum quadro acima de 1,5 s, p95
abaixo de 40 ms, nenhuma falha de sistema nem erro solto, os defensores derrubam monstros · SK7 cerco da paliçada (160 a
50 %): um arqueiro atacante atira o tiro longo de fora para dentro da paliçada, o convidado vê o arco; seis tiros longos
num defensor a 15 tiles com um soldado do próprio lado do arqueiro colado nele — o defensor ferido, o do próprio lado
nunca, nem em toda a luta. Todos terminam com o digest igual. As regras gerais pedidas no teste do dono têm testes no jogo normal: **CB1** (a fila da mira) e **CB2** (golpe
através da paliçada) — docs/REINOS.md §14 "Mira automática, golpes e paredes, caminhos".

## Depois do teste do dono (valem para o jogo todo — docs/REINOS.md §14)

- **"Congelou uns 4 s quando os monstros invadiram o castelo"**: não se repetiu no Chrome headless (castelo, 38–40
  monstros na praça, quadros de 4–8 ms, sem quadro longo, sem erro). A causa mais provável é um erro lançado por um
  sistema, que parava o laço do jogo inteiro; agora cada sistema roda isolado (`game.js systemFault`: perde só aquele
  quadro, o erro é relatado, `game.faults` conta) e o laço principal também (`main.js loopFault`). O SK6 vigia o caso.
- **Mira automática**: hostis primeiro, animais neutros / passivos por último, amigos nunca (soldados do próprio lado,
  guarda, povo, animais domados, cavalos) — ataque, habilidades, Tab, mira assistida (`combat.js aimClass`).
- **Golpes não atravessam** muralha, paliçada, portão ou rocha — jogador, criaturas, guardas e soldados
  (`combat.js meleeWall` em `dealDamage`); "Atrás da parede" só para quem bateu.
- **Soldados contornam** o que está no caminho: A* local quando a linha reta está bloqueada, rota nova depois de 0,8 s
  sem avançar, a guarnição passa pelos portões do próprio lugar (`soldier.js routeStep`). A escolha de alvo dos monstros e
  o foco da defesa ficam com o trabalho dos ataques de inverno.
- **Textos flutuantes** (acerto, erro, imune, cura, "Bloqueado"…) só quando o jogador local está envolvido; as plaquinhas
  da onda só do alvo, de quem luta comigo, do mouse e dos gigantes.
- **Os arqueiros NPC usam o Tiro Longo** (`game/npcLob.js`, o mesmo voo / dispersão / dano × 1,3 + 2 do jogador, só os
  inimigos de quem atirou): no cerco os atacantes atiram por cima da paliçada / muralha e os defensores nos que chegam de
  longe; recarga de 3 s cada. Os soldados da escaramuça têm arco simples (tiro longo 18 tiles) e atiram simples até 19:
  em campo aberto quase só o tiro simples, o tiro longo aparece quando não há linha de tiro. Testes SK7 (escaramuça) e
  CB3 (jogo normal, saqueador).

## Prints

`shots/` (fora do git): `sk_menu_button` (o botão no menu), `sk_lobby_field_desktop` / `sk_lobby_monsters_desktop` /
`sk_lobby_city` (o lobby: modo, lugar, monstros, os controles, os lados, a classe, "Como se vence"),
`sk_lobby_phone` / `_2` (celular 915 × 412 toque), `sk_field_countdown` (a contagem "2 · As linhas se formam"),
`sk_field_200_lines` / `sk_field_200_player` (batalha de 200: o choque das linhas rosa × verde com o jogador de elmo de
ferro e lança de aço no meio), `sk_city_siege_1` (o cerco da capital: o acampamento, os trabucos e a torre), `sk_siege_1`
/ `_3` (cerco da vila: o acampamento, a rampa), `sk_monsters_giants_1` / `sk_monsters_walls` (os andarilhos rompendo o
portão da paliçada, a guarnição e a guarda lutando, um gigante de gelo chegando), `sk_monsters_giant` (esqueletos na
paliçada), `sk_board_phone` (o placar no celular), `sk_results_desktop` / `sk_results` / `sk_results_phone` (o resultado).

## Decisões (para o dono confirmar)

- **A arena**: sempre o mesmo planeta (semente 4242), novo a cada vez; os lugares são os de verdade mais perto do início
  (Estrosa com paliçada, Torre de Dorilde, a capital Alvalelar…); a batalha em campo nos campos ao lado de Estrosa.
- **Os defensores do cerco e da defesa** = a guarda do próprio lugar **mais** uma guarnição de soldados com o número da
  proporção (o placar conta os dois). A proporção divide só os soldados; a guarda vem com o lugar.
- **Cerco começa armado**: acampamento montado e máquinas prontas (sem esperar a obra: uma partida tem minutos); o
  assalto vem ~25 s depois do bombardeio começar (a regra da 3b).
- **Renascer**: 8 s, na retaguarda do lado, com tudo; sem limite de vidas. Nível 12 para os jogadores, 10 para soldados,
  guarda e monstros (gigantes 12).
- **Gigantes**: 1 a cada 25 monstros, de 20 em diante, até 12.
- **Tempo**: 12 / 15 / 12 min; o duelo sem soldados a 10 abates.
- **Tetos de criaturas** mais altos que no jogo normal (120 / 96 / 56 pela qualidade), só na arena.
- Quem entra no meio de uma partida espera a próxima no ponto de vista do lobby.
