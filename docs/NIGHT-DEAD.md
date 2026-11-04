# Mortos da noite das terras quentes — esqueletos, múmias e seus gigantes

Fase 1 do pedido do dono em [REINOS.md §1](REINOS.md#1-perigo-noturno-em-todas-as-zonas-monstros-de-inverno): "o perigo
noturno nos invernos que cada zona sempre vai existir". Código: `src/game/undead.js` (regras, kits, drops),
`src/game/walkers.js` e `src/game/giants.js` (a mesma máquina dos Andarilhos e do Gigante de Gelo),
`src/art/deadBody.js` + `src/art/deadRig.js` (corpos e rig), `src/fx/undeadfx.js`, `src/fx/sfxUndead.js`. Testes: NM1–NM6
(`tools/mp-test.js`).

## Onde e quando

A família de um lugar sai da **estação do lugar** (`seasonAt`: zona por latitude + altitude, o outro hemisfério meio ano
defasado) e, nos desertos, do **bioma da região** (`desertAt`: cinco amostras a 7 tiles do ponto — o centro e as
quatro direções —; deserto quente = pelo menos 3 de 5 em bioma árido: dunas, deserto rochoso, mesas e cânions, salar,
deserto frio). Uma mancha de dunas na savana não é deserto; um oásis no deserto continua deserto.

| Família | Onde (zona do lugar) | Quando | Monstros |
|---|---|---|---|
| gelo `ice` | temperado / subpolar no inverno, polar sempre (inverno de verdade: neve) | noite | Andarilhos do Gelo + Gigante de Gelo (**sem mudança**) |
| ossos `bone` | zona quente (inverno ameno) | noites do inverno ameno | Esqueletos + Gigante Esqueleto |
| ossos `bone` | trópicos úmidos (selva, savana, mata seca…) | noites da estação seca (`wet < 0,5`) | Esqueletos (sem gigante) |
| areia `sand` | deserto quente na zona quente ou tropical | noites do inverno ameno / da estação seca | Múmias + Múmia Gigante |

**Uma família por lugar.** Um grupo vem atrás de um jogador numa noite ruim do lugar dele e só nasce em chão da mesma
família (a borda do deserto nunca manda esqueletos para as dunas); quem fica onde a noite da sua família acabou (saiu
dela, ou a estação virou, ou amanheceu) desmancha em poucos segundos: o andarilho vira neve, o esqueleto **cai em ossos**,
a múmia **escorre em areia**. A contagem por jogador (até 3 no 1º inverno, +2 por inverno até 9) junta todas as famílias.

## Como se comportam (iguais aos Andarilhos)

Facção `walker`: o mesmo cérebro (`walkerBrain`) — vêm atrás de gente que veem / sentem através das paredes e de **luz**
(fogueiras, tochas, lampiões, a tocha na mão), quebram paredes, portas e cercas no caminho ou para entrar num cômodo
fechado, lutam como os saqueadores (`bandits.js`). No **modo criativo** não são atraídos pela luz, não quebram nada, não
caçam ninguém. Mesmo ritmo de surgimento (`WINTER_GROWTH`, `GIANT_GROWTH`). Nível pela distância do início do mundo,
como todos os bichos (as terras quentes costumam ficar longe: nível alto).

### Esqueleto (`skeleton`)
- 70 de vida base (88 no nível 2 · 263 no 12), dano 6 (como o andarilho), um pouco mais rápido (3,95), armadura 2, XP 2,2.
- Armas: espada de osso (38%), lança com ponta de osso (32%: estocada e arremesso), **arco** (30%: arqueiro, recua e
  atira, Tiro Mirado).
- **Ossos**: pancada (porrete, maça, martelo, pá, punhos, Esmagar, Empurrão, Golpe de Escudo, Golpe de Tocha) faz
  **+50%**; flechas e lanças arremessadas passam entre as costelas: **−30%**. Não sangra: lascas de osso.
- Chacoalha (sons de ossos ao avistar, ao apanhar, à toa), anda rápido e aos trancos.
- Morto por um jogador: **ossos** 1–2 (90%), o arqueiro **flechas** 2–4 (70%).

### Múmia (`mummy`)
- 128 de vida base (160 no nível 2 · 480 no 12), dano 7, **lenta** (3,0), armadura 6, XP 2,8.
- 60% de mãos nuas (pancada lenta com os dois braços, 2,2 s), 40% com **khopesh** de bronze (bate como a espada de gelo).
- **Maldição**: 30% dos golpes deixam o jogador **35% mais lento por 3 s** (debuff "Maldição da múmia", aviso na tela).
- Arrasta um pé, anda com os braços esticados à frente, geme; areia escorre das faixas. Não sangra: pó.
- Morta por um jogador: **faixas de linho** 1–3 (90%), erva medicinal (25%), minério de ouro (8%, um amuleto).

### Gigante Esqueleto (`skeleton_giant`)
- Da escala do Gigante de Gelo (2,4×, ~3,5 tiles de altura): 360 de vida base, dano 40, velocidade 2,9, armadura 12, XP 7.
- Esmagar com uma **clava de fêmur** cravada de pregos (círculo de perigo no chão, desvie), arremessa um **osso gigante**
  (dano de um andarilho, giro no ar), quebra paredes 8× mais rápido que um esqueleto.
- Crânio com chifres e presas, **fogo-fantasma verde** dentro das costelas, ombreiras de osso.
- Também é feito de ossos: +25% a pancada, −20% a flechas. **Balista: dois dardos** (55% da vida cada), como o de gelo.
- Só na zona quente (os trópicos úmidos têm só os esqueletos).
- Derrubado: ossos 4–7, barras de ferro 1–2 (60%), aço (25%).

### Múmia Gigante (`mummy_giant`)
- Um faraó: 440 de vida base, dano 42, mais lento (2,4), XP 8. Toucado listrado (nemes) com a naja e a barba postiça,
  colar largo de ouro / lápis-lazúli / cornalina, braceletes, saiote plissado.
- Esmagar com uma **coluna de arenito** (anéis entalhados, hieróglifos, capitel de lótus): o golpe **amaldiçoa por 4 s**;
  arremessa a **tampa do sarcófago** (amaldiçoa por 2 s).
- **Balista: dois dardos**, como os outros.
- Derrubada: linho 4–6, barras de ouro 1–2 (70%), jade (25%).

## Drops úteis
| Item | De onde | Uso |
|---|---|---|
| Ossos | esqueletos, gigante | **Flechas de osso**: 1 osso + 2 gravetos → 5 flechas (bancada). **Farinha de ossos**: 2 ossos → 3 (mesa de cantaria) |
| Farinha de ossos | — | **Adubo**: "Adubar" numa plantação que ainda cresce → +25% de crescimento na hora (até 2 vezes por plantação) |
| Faixas de linho | múmias | **Tecido** no tear (3 → 1); à mão, **1 linho + 1 erva → 2 ervas** (curativos de linho) |
| Ouro, jade, ferro, aço | gigantes | os de sempre |

## Arte
Corpos próprios como o Gigante de Gelo: cada parte é um modelo 3D de elipsoides pintado em 5 vistas (as outras 3
espelhadas) e posicionado por um esqueleto 3D a cada quadro — **8 direções de verdade em qualquer ângulo de câmera**
(0° também). Esqueleto e múmia nas proporções dos bonecos (cabeça grande), 1,3× o tamanho de modelo; gigantes 1,8×.
Animações: parado, andar (esqueleto aos trancos e chacoalhando; múmia mancando, braços à frente), golpe de espada,
estocada e arremesso de lança, arco puxado até a bochecha (a corda segue a mão, flecha encaixada), pancada de dois
braços; gigantes: passos pesados, Esmagar erguido e tremendo, arremesso. Olhos acesos (verde-fantasma nos ossos, âmbar
nas faixas) e um brilho fraco à noite. Morte / amanhecer: os ossos caem, quicam, se espalham e o crânio rola (depois
somem); a múmia afunda num monte de areia que escorre e se desfaz. Os gigantes também (maiores). Mapa e radar: gigante
com anel marfim (esqueleto) / dourado (múmia).

## Sons (procedurais)
`skeleton_*` (chocalho de ossos, estalo, desmoronar), `mummy_*` (gemido seco, pano rasgando, areia), os gigantes
(uivo cavernoso com costelas chacoalhando; gemido profundo de rei enterrado), `bones_fall`, `sand_pour`,
`giant_step_dry`, `giant_smash_dry`, `bone_land`, `slab_land`.

## HUD e ajuda
Aviso de zona (quente / tropical) diz o que sai à noite ali (esqueletos ou, no deserto, múmias); aviso de estação
(inverno ameno / estação seca) também; **ao anoitecer** numa noite de ossos / areia, um aviso do que vem. A ajuda (H)
explica as noites de cada região.

## Multijogador
Anfitrião autoritativo como os andarilhos: as criaturas, o cérebro, os drops e as mortes no anfitrião; os convidados
recebem o fluxo de entidades (espécie, arma, ação, morte) e desenham / tocam tudo igual. Op `giant.tele` com `k`
(`smash` / `smash_bone` / `smash_sand`: os detritos), op `giant.rock` com `p` (`giant_bone` / `giant_slab`), mensagem
`player.hurt` com `curse`; intent `farm.fert` → op `crop.fert`.

## Testes (NM)
NM1 esqueletos no inverno ameno da zona quente (só esqueletos, Gigante Esqueleto, porrete 1,5× espada, ossos ao amanhecer
nos dois) · NM2 múmias no deserto (só múmias, Múmia Gigante, maldição, linho no chão igual nos dois, areia ao
amanhecer) · NM3 inverno temperado continua com andarilhos e o Gigante de Gelo; esqueleto fora do lugar desmancha ·
NM4 criativo: nada quebra, nada vai atrás da luz (e no sobrevivência vão) · NM5 / NM6 cada gigante replicado e dois dardos
de balista. LZ3 ajustado: a seca tropical tem seus esqueletos.

## Para o dono decidir depois
- As terras quentes ficam longe do início: os monstros de lá chegam em nível alto (regra geral do jogo). Se quiser, dá
  para limitar o nível dos mortos da noite.
- Esqueletos nos trópicos úmidos não trazem gigante (como decidido); dá para ligar um gigante raro lá também.
- A farinha de ossos acelera a plantação mas não muda a regra do solo seco / do inverno.
