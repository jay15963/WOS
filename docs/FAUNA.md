# WOS · Fauna por bioma

Pedido do dono: "terá que criar animais novos para cada bioma". O planeta (docs/PLANET.md) tem 37 biomas; cada um
ganhou a sua vida: **29 espécies novas** (30 desenhos — leoa e leão de juba) além das que já existiam (lobo, raposa,
cervo, javali, urso, coelho, aranha, a criação e os peixes), com arte em 8 vistas (diagonais 3/4 reais), animações,
corpo para carnear, comportamento próprio, horário, tabelas de nascimento por bioma e a mesma sincronização das outras
criaturas (só o anfitrião simula; os convidados desenham cópias pelo fluxo de entidades).

Arquivos:

| arquivo | o que tem |
|---|---|
| `src/game/content/fauna.js` | dados puros: `FAUNA_SPECIES` (números de combate, coleta), `FAUNA` (comportamento), `FAUNA_SPAWNS` (tabelas por bioma) |
| `src/game/fauna.js` | os cérebros (só no anfitrião): `setupFauna`, `faunaBrain`, `blockedFor` |
| `src/game/faunaSpawn.js` | `spawnsForChunk` (puro), `chunkRng`, `chunkFauna` (o gancho do planeta em pedaços: `mobs.js planetSpawners`) |
| `src/art/fauna.js` | os modelos 3D (kit da criação), os quadros, os nomes dos sprites, o que vai para o atlas |
| `src/art/faunaDraw.js` | o desenho de cada quadro (andar, correr, pastar, atacar, voar, nadar, morrer), `FMODE`, `faunaKey` |
| `tools/diag.html?set=fauna&g=…` | folhas de 8 vistas por grupo (polar, taiga, steppe, desert, savanna, jungle, swamp, mountain, coast, ocean) |
| `tools/mp-test.js` FA1, FA2 | testes de multijogador |

---

## 1. Espécies

Visão = raio em que um hostil nota o jogador (regra do PLAN-V2 "Alvos, visão e alcance": +até 25 % com nível maior,
além de 3 tiles só com linha de visão). Nível = `levelForDistance(distância do início)` + o extra da espécie (como
todo bicho); minD = distância mínima do início (o começo de mãos vazias continua justo). 🔪 = precisa de lâmina.
Grupo = tamanho do bando ao nascer.

| espécie | nome | temper. | move / hora | vida · dano · vel. · visão | nível · minD | onde (grupo) | coleta | hábitos |
|---|---|---|---|---|---|---|---|---|
| `polar_bear` | Urso-polar ★ | hostil | anda · sempre | 260 · 15 · 4.3 · 8.5 | +4 · 60 | Manto de gelo 1; Deserto polar 1; Tundra (margem) 1 | Carne crua 4–6, Couro 3–5 🔪 | deita às vezes; fica de pé para atacar |
| `seal` | Foca | passivo | anfíbio · sempre | 44 · 0 · 2.2 (água 4.6) · — | +0 · 10 | Deserto polar 2–5; Praia 2–4; Costa rochosa 2–5 (margem) | Carne crua 2–3, Couro 1–2 (90%) 🔪 | foge (a 6 tiles) para a água; nada |
| `arctic_fox` | Raposa-do-ártico | passivo | anda · dia | 22 · 0 · 6 · — | +0 · 8 | Manto de gelo 1; Deserto polar 1–2; Tundra 1 | Carne crua 1, Couro 1 (80%) 🔪 | arisca (foge a 6,5) |
| `moose` | Alce | neutro | anda · sempre | 160 · 11 · 4.6 · — | +2 · 30 | Taiga 1; Floresta temperada úmida 1; Brejo 1 | Carne crua 4–6, Couro 2–3 🔪 | territorial 3,2 (investe em quem chega perto) |
| `reindeer` | Rena | passivo | anda · dia | 52 · 0 · 5.6 · — | +0 · 10 | Tundra 4–9; Taiga 3–6 | Carne crua 2–3, Couro 1–2 (90%) 🔪 | manada foge junta; migra |
| `lynx` | Lince | hostil | anda · noite | 48 · 5.5 · 5 · 7.5 | +0 · 30 | Taiga 1; Floresta temperada 1; Prado alpino 1 | Carne crua 1, Couro 1 (80%) 🔪 | espreita (devagar) e dá o bote |
| `wild_horse` | Cavalo selvagem | passivo | anda · dia | 72 · 0 · 6.4 · — | +0 · 10 | Estepe 3–7; Deserto frio 3–5; Mesas 3–5; Charneca 3–5 | Carne crua 3–4, Couro 2 🔪 | manada foge junta (galope); migra |
| `bison` | Bisão | neutro | anda · sempre | 175 · 10 · 4.5 · — | +1 · 20 | Estepe 3–8; Várzea 3–6 | Carne crua 5–7, Couro 3–4 🔪 | manada; migra; territorial 2,6; a manada inteira revida |
| `yak` | Iaque | neutro | escala · sempre | 140 · 9 · 3.8 · — | +1 · 20 | Tundra alta (4+ andares) 2–5; Deserto frio alto 2–5; Prado alpino 2–5 | Carne crua 4–5, Couro 2–3 🔪, Lã 2–4 | escala encostas; territorial 2,4 |
| `camel` | Camelo | passivo | anda · dia | 95 · 0 · 4.4 · — | +0 · 10 | Deserto frio 1–3; Dunas 1–4; Deserto rochoso 1–3; Salar 1–2 | Carne crua 3–5, Couro 2–3 🔪 | ajoelha (deita) às vezes |
| `scorpion` | Escorpião | hostil | anda · noite | 18 · 3 · 3.6 · 4.5 | +0 · 16 | Dunas 1–2; Deserto rochoso 1–2; Mesas 1–2 | — (sem corpo) | veneno (60 %) |
| `rattlesnake` | Cascavel | hostil | anda · sempre | 20 · 4 · 3.2 · 2.4 | +0 · 14 | desertos, mesas, savana, floresta tropical, pântano 1 | Carne crua 1 (60%), Couro 1 (50%) 🔪 | escondida na grama (enrolada, quase invisível), chocalha a 4,5, dá o bote a 2,4; veneno (80 %) |
| `vulture` | Abutre | passivo | voa · dia | 24 · 0 · 3.2 · — | +0 · 8 | desertos, mesas, savana, terra vulcânica 1–5 | Carne crua 1 (70%), Pena 2–4 | plana alto (5,5–8 tiles); desce nos corpos para comer |
| `zebra` | Zebra | passivo | anda · dia | 66 · 0 · 6.2 · — | +0 · 10 | Savana 4–10 | Carne crua 3, Couro 2 🔪 | manada foge junta; migra; empina |
| `gazelle` | Gazela | passivo | anda · dia | 30 · 0 · 7.2 · — | +0 · 8 | Savana 4–10; Deserto rochoso 3–6; Floresta seca 3–6 | Carne crua 1–2, Couro 1 (80%) 🔪 | arisca (foge a 8, aos saltos); manada |
| `lion` | Leão / Leoa | hostil | anda · sempre | 150 · 11 · 5 · 9 | +2 · 45 | Savana 2–5 (um macho de juba por bando) | Carne crua 3–4, Couro 2–3 🔪 | o bando descansa deitado de dia (vê só 4,5) e caça do anoitecer; bando inteiro ataca |
| `elephant` | Elefante ★ | neutro | anda · sempre | 480 · 22 · 4.2 · — | +3 · 30 | Savana 2–6; Floresta seca 2–5 | Carne crua 8–12, Couro 5–7 🔪 | manada; migra; territorial 4,2 (orelhas abertas, tromba erguida, presas) |
| `monkey` | Macaco | neutro | anda · dia | 26 · 3 · 5.4 · — | +0 · 8 | Florestas tropicais 4–9 (perto de árvores); Mangue 3–6 | Carne crua 1 | sobe na árvore (sentado na copa) quando alguém chega a 7; o bando revida |
| `jaguar` | Onça-pintada ★ | hostil | anda · noite | 125 · 12 · 5.2 · 8 | +2 · 40 | Florestas tropicais 1 | Carne crua 2–3, Couro 2 🔪 | espreita (0,6× longe) e dá o bote (1,3× a 4,5 tiles) |
| `parrot` | Arara | passivo | voa · dia | 8 · 0 · 3 · — | +0 · 4 | Florestas tropicais, pântano 3–7 | Pena 1–3, Carne crua 1 (40%) | bando; pousa nas copas |
| `crocodile` | Crocodilo | hostil | anfíbio · sempre | 170 · 14 · 3.4 (água 4.4) · 3.8 | +2 · 24 | Pântano 1–2; Mangue 1–2; Floresta tropical 1 (na água rasa junto da margem) | Carne crua 3–4, Couro 3–4 🔪 | espreita na água (só os olhos), bote rápido para fora d'água, volta à espreita |
| `heron` | Garça | passivo | voa · dia | 16 · 0 · 2.6 · — | +0 · 6 | lagos, lagunas, mangue, pântano, brejo, várzea 1–3 | Carne crua 1, Pena 2–3 | pousa na água rasa |
| `mountain_goat` | Cabra-montês | passivo | escala · dia | 42 · 0 · 5.2 · — | +0 · 10 | Prado alpino 2–5; Picos 2–4; mesas, falésias, deserto rochoso, mediterrânea (rocha) | Carne crua 2, Couro 1 (80%) 🔪, Lã 1 (50%) | anda em rocha e penhasco (onde ninguém anda); foge para as rochas |
| `eagle` | Águia | passivo | voa · dia | 22 · 0 · 3 · — | +0 · 8 | Prado alpino, picos, estepe, mesas, falésias 1 | Pena 2–4 | plana muito alto; mergulha em coelho / raposa-do-ártico / macaco / caranguejo; pousa nas rochas |
| `crab` | Caranguejo | neutro | anfíbio · sempre | 12 · 2 · 3 (água 2.4) · — | +0 · 4 | Praia 2–5; Costa rochosa 2–4; Mangue 2–5 | Carne crua 1 | anda de lado; belisca se mexerem com ele |
| `seagull` | Gaivota | passivo | voa · dia | 8 · 0 · 3 · — | +0 · 4 | Praia 3–8; Costa rochosa 3–7; Falésia 3–7; Laguna 3–6 | Pena 1–2 | bando levanta voo junto |
| `dolphin` | Golfinho | passivo | nada · sempre | 70 · 0 · 6 · — | +0 · 20 | Mar aberto 3–6; Águas rasas 2–4 (água funda) | Carne crua 3 | saltos; acompanha um barco com gente |
| `shark` | Tubarão | hostil | nada · sempre | 135 · 16 · 4.6 · 9 | +2 · 30 | mar aberto, abissal, recife 1–2 | Carne crua 3–4, Couro 2 🔪 | só caça quem está nadando (nunca quem está no barco ou na margem); a barbatana corta a água |
| `whale` | Baleia | passivo | nada · sempre | 1200 · 0 · 2.2 · — | +0 · 40 | Mar aberto / abissal longe da terra 1–2 | Carne crua 20–30, Couro 6–10 🔪 | sobe, sopra a cada 6–10 s, mergulha (cauda para fora) e some 20–40 s |

Itens: nenhum item novo — só os que já têm uso (carne, couro, lã, pena). Um "pelego" de urso-polar ou marfim ficaram de
fora de propósito: nada no jogo os usaria ainda (o casaco de pele já sai do couro, e o urso-polar dá 3–5 couros).

Modo criativo: todo ataque começa por `ai.aggro`, que nunca arruma briga com um jogador no criativo (teste FA1). Os
bichos continuam fugindo, pastando, voando.

---

## 2. Comportamentos (`src/game/fauna.js`, só no anfitrião)

`mobs.js spawnMember` chama `setupFauna` para toda espécie com `fauna: true` (marcada em `FAUNA_SPECIES`): ela ganha
`m.brain = faunaBrain` (o `mobsSystem` já chama `m.brain` quando existe) e `m.fmode` (bits replicados, §5).

- **Andarilhos** (`move: 'walk'`): o cérebro de sempre (`ai.updateCreature`: vagar, fugir, perseguir, morder, desistir,
  medo da tocha, atordoado) mais os hábitos:
  - `herd` — quando um foge, os da mesma espécie a até 14 tiles fogem do mesmo jeito (`herdFlee` → `ai.startFlee`);
  - `migrate` — a cada 70–160 s o chão da manada (o spawner) anda 6–13 tiles no mesmo bioma (até 40 do lugar de
    origem); os membros vão atrás;
  - `territorial` (neutros) — jogador à vista a menos de N tiles → investida (`ai.aggro`);
  - `rest: 'day'` (leões) — de dia, calmos, deitam (`fmode` descansando) e enxergam só `restAggro`; caçam ao anoitecer;
  - `lounge` (camelo, urso-polar) — deitam de vez em quando por 15–35 s;
  - `stalk` (onça, lince) — `m.speedK` (pequena mudança genérica em `ai.js`): 0,6 longe, 1,3 a menos de 4,5 tiles;
  - `ambush` (cascavel) — em casa e calma fica escondida (`fmode` escondido, `aggroR` 2,4), chocalha a 4,5;
  - `trees` (macacos) — jogador a 7 → corre para a árvore mais perto e "sobe" (`fmode` na árvore: desenhado na copa),
    desce quando não há ninguém por 4–7 s; o bando sobe junto.
- **Escaladores e anfíbios** (`climb`, `amphib`): cérebro próprio simples (parado, vagar, fugir, perseguir, voltar) com
  o próprio chão (`blockedFor`): escaladores passam por rocha e penhasco (não por água funda nem construções);
  anfíbios andam e nadam (velocidade na água `water`). O crocodilo mora num tile de água junto da margem: depois de
  2,5 s parado em casa se esconde (só os olhos), nota quem chega a 3,8, dá um bote 2,2× mais rápido e não se afasta
  mais de 10 tiles de casa. Focas fogem para a água; cabras para a rocha.
- **Nadadores** (`swim`): só água funda. Tubarão: alvo só quem está nadando (água funda, fora do barco); desiste 2,5 s
  depois do alvo sair da água. Golfinho: saltos (`action 'jump'`, 1,1 s) e acompanha barco com gente a até 16 tiles.
  Baleia: ciclo subir / soprar (`action 'spout'`) / mergulhar (`action 'dive'` + escondida 22–42 s).
- **Aves** (`fly`): pousadas (no chão, numa copa — arara —, na água rasa — garça —, nas rochas — águia) até alguém
  chegar perto (`flush`) ou o tempo passar; voando: as que planam (abutre, águia) fazem círculos largos 70–180 s e
  pousam pouco; as outras voam de um lugar a outro 25–65 s; o bando segue o líder em formação e pousa junto. Abutre:
  vê um corpo a até 40 tiles, circula por cima, pousa ao lado e "come" 25–45 s. Águia: mergulha num bicho pequeno e o
  mata (vira corpo), pousa ao lado. Voando não colidem com nada (ficam dentro do mundo); a altura é cosmética (§4).

Horários: `when` de cada espécie vai para o spawner (`mobs.js activeNow`): dia / noite / sempre como as outras
criaturas (as noturnas não nascem perto de luz; fora de hora voltam e somem quando ninguém vê; no inverno os bichos do
dia saem menos — regra global de hoje).

---

## 3. Nascimento por bioma

### Tabelas (`FAUNA_SPAWNS`, dados)

Linha = `{ sp, d, n: [mín, máx], on?, alt?: [mín, máx] andares, when? }`. `d` = grupos esperados num chunk 64 × 64
feito só daquele bioma (escalado pela fração do chunk que é o bioma). `on`: `land` (padrão) · `shore` (terra a ≤ 2
tiles da água) · `rock` (terra a ≤ 3 de rocha ou de encosta íngreme) · `trees` (terra a ≤ 3 de uma árvore) ·
`shallow` (água rasa) · `deep` (água funda) · `far` (funda, ≥ 10 tiles de terra) · `water` (qualquer água). Os tiles
de água têm os biomas de água (rio, lago, mar…), então numa tabela de bioma de terra `shallow` / `water` pegam a água a
até 3 tiles da margem daquele bioma (o crocodilo do pântano fica no rio que corta o pântano). As espécies que já
existiam estão listadas onde fazem sentido (lobo, cervo, javali, urso, raposa, coelho) e os cardumes (`fish`, o peixe da
criação) no mar.

| bioma | grupos (d por chunk 64², tamanho, onde) |
|---|---|
| `abyss` Oceano abissal | whale 0.25 (1–2, far) · shark 0.2 (1, deep) |
| `ocean` Mar aberto | whale 0.3 (1–2, far) · dolphin 0.6 (3–6, deep) · shark 0.35 (1–2, deep) · fish 1.4 (2–4, water) |
| `shallows` Águas rasas | dolphin 0.3 (2–4, deep) · shark 0.15 (1, deep) · fish 1.4 (2–4, water) |
| `reef` Recife de coral | shark 0.4 (1–2, deep) · fish 2.4 (3–5, water) |
| `sea_ice` Banquisa | seal 0.8 (2–5, shore) · polar_bear 0.2 (1, shore) — vale quando a banquisa for chão (hoje é água no jogo) |
| `lake` Lago | fish 1.6 (2–3, water) · heron 0.4 (1–2, shallow) |
| `lagoon` Laguna | fish 1.2 (2–3, water) · heron 0.5 (1–2, shallow) · seagull 0.4 (3–6, shallow) |
| `river` Rio | fish 1.2 (2–3, water) |
| `ice_sheet` Manto de gelo | polar_bear 0.12 (1) · arctic_fox 0.2 (1) |
| `polar_desert` Deserto polar | polar_bear 0.25 (1) · arctic_fox 0.5 (1–2) · seal 0.6 (2–5, shore) |
| `tundra` Tundra | reindeer 1 (4–9) · arctic_fox 0.6 (1) · wolf 0.45 (2–3) · rabbit 0.6 (1–2) · polar_bear 0.08 (1, shore) · yak 0.25 (2–5, 4+ andares) |
| `taiga` Taiga | moose 0.45 (1) · reindeer 0.4 (3–6) · lynx 0.35 (1) · wolf 0.6 (2–3) · bear 0.25 (1) · fox 0.5 (1) · rabbit 0.7 (1–2) · deer 0.4 (1–3) |
| `temperate_forest` Floresta temperada | deer 1.1 (1–3) · boar 0.9 (1–3) · wolf 0.7 (2–3) · fox 0.7 (1) · rabbit 1.1 (1–2) · bear 0.25 (1) · lynx 0.12 (1) |
| `temperate_rainforest` Floresta temperada úmida | deer 0.9 (1–3) · bear 0.35 (1) · wolf 0.5 (2–3) · fox 0.4 (1) · moose 0.2 (1) · rabbit 0.6 (1–2) |
| `steppe` Estepe / pradaria | wild_horse 0.8 (3–7) · bison 0.45 (3–8) · rabbit 1 (1–2) · wolf 0.35 (2–3) · fox 0.4 (1) · deer 0.3 (1–3) · eagle 0.15 (1) |
| `mediterranean` Mata mediterrânea | boar 0.8 (1–3) · deer 0.6 (1–2) · rabbit 1 (1–2) · fox 0.5 (1) · mountain_goat 0.2 (2–4, rock) · eagle 0.12 (1) |
| `cold_desert` Deserto frio | camel 0.35 (1–3) · wild_horse 0.3 (3–5) · yak 0.3 (2–5, 3+ andares) · wolf 0.25 (2–3) · vulture 0.2 (1–3) · rattlesnake 0.2 (1) |
| `desert_dunes` Deserto de dunas | camel 0.35 (1–4) · scorpion 0.8 (1–2) · rattlesnake 0.2 (1) · vulture 0.25 (2–4) |
| `desert_rocky` Deserto rochoso | camel 0.3 (1–3) · scorpion 0.9 (1–2) · rattlesnake 0.5 (1) · vulture 0.3 (2–5) · mountain_goat 0.15 (2–3, rock) · gazelle 0.25 (3–6) |
| `badlands` Mesas e cânions | rattlesnake 0.5 (1) · scorpion 0.6 (1–2) · vulture 0.35 (2–4) · mountain_goat 0.3 (2–4, rock) · wild_horse 0.2 (3–5) · eagle 0.15 (1) |
| `savanna` Savana | zebra 0.9 (4–10) · gazelle 0.9 (4–10) · elephant 0.3 (2–6) · lion 0.25 (2–5) · vulture 0.35 (2–5) · rattlesnake 0.15 (1) |
| `tropical_dry` Floresta tropical seca | elephant 0.25 (2–5) · monkey 0.6 (4–8, trees) · jaguar 0.15 (1) · boar 0.5 (1–3) · parrot 0.5 (3–6) · gazelle 0.3 (3–6) |
| `rainforest` Floresta tropical | monkey 1 (4–9, trees) · jaguar 0.3 (1) · parrot 1 (3–7) · boar 0.35 (1–3) · crocodile 0.6 (1, shallow) · rattlesnake 0.15 (1) |
| `cloud_forest` Floresta nebular | monkey 0.7 (3–7, trees) · parrot 0.7 (3–6) · jaguar 0.15 (1) · deer 0.3 (1–2) |
| `mangrove` Mangue | crocodile 1.4 (1–2, shallow) · heron 0.8 (1–3, shallow) · crab 1.2 (2–5, shore) · monkey 0.25 (3–6, trees) · fish 0.8 (2–3, water) |
| `swamp` Pântano tropical | crocodile 1.5 (1–2, shallow) · heron 1.2 (1–3, shallow) · boar 0.4 (1–3) · parrot 0.3 (3–5) · rattlesnake 0.2 (1) |
| `marsh` Brejo / turfeira | heron 0.9 (1–3, shallow) · moose 0.2 (1) · deer 0.4 (1–3) · boar 0.4 (1–3) · fox 0.3 (1) |
| `alpine` Prado alpino | mountain_goat 0.9 (2–5, rock) · yak 0.35 (2–5) · eagle 0.35 (1) · bear 0.12 (1) · rabbit 0.4 (1–2) · lynx 0.12 (1) |
| `snow_peaks` Picos nevados | mountain_goat 0.5 (2–4, rock) · eagle 0.2 (1) |
| `volcanic` Terra vulcânica | mountain_goat 0.15 (1–3, rock) · vulture 0.15 (1–3) |
| `salt_flat` Salar | camel 0.12 (1–2) · vulture 0.1 (1–2) |
| `beach` Praia | crab 1.6 (2–5, shore) · seagull 1.2 (3–8, shore) · seal 0.25 (2–4, shore) |
| `rocky_shore` Costa rochosa | seagull 1 (3–7, shore) · crab 1 (2–4, shore) · seal 0.5 (2–5, shore) |
| `cliff` Falésia | seagull 0.9 (3–7) · mountain_goat 0.2 (2–3, rock) · eagle 0.15 (1) |
| `heath` Charneca | deer 0.6 (1–3) · rabbit 1 (1–2) · fox 0.5 (1) · wolf 0.35 (2–3) · wild_horse 0.25 (3–5) |
| `floodplain` Várzea | deer 0.8 (1–3) · boar 0.6 (1–3) · heron 0.5 (1–2, shore) · rabbit 0.8 (1–2) · bison 0.2 (3–6) |

Densidade: um chunk todo de savana dá ~2,9 grupos (≈ 16 bichos); deserto de dunas ~1,6; manto de gelo ~0,3. O mundo clássico de hoje tem ~5 grupos por 64² — o planeta ficou um pouco mais vazio de propósito (mais chunks
ativos com o motor de streaming).

### API (para o motor de streaming)

```js
import { spawnsForChunk, chunkRng } from 'src/game/faunaSpawn.js';

// puro: sem jogo, sem DOM, sem Math.random — mesmo grid + mesmo rng = mesmos grupos em qualquer par
const groups = spawnsForChunk({
  size: 64,
  biome: ch.biome,      // Uint8Array(64²) ids de bioma do planeta (generateChunk)
  water: ch.water,      // 0 terra · 1 rasa · 2 funda · 3 abissal
  rock: ch.rock,        // 1 = rocha
  height: ch.height,    // cantos (65²) em andares — opcional (linhas com `alt`, `rock` por encosta)
  trees,                // Uint8Array(64²) 1 = árvore no tile — opcional (linhas `trees`; sem ele valem sempre)
  x0: ch.x0, y0: ch.y0, // canto do chunk (somado às posições)
}, chunkRng(worldSeed, cx, cy), { density: 1, gap: 6, exclude: (x, y) => false });
// → [{ species, x, y, count, when, biome, on }]  x, y = centro de tile
```

O motor transforma cada grupo num spawner (`{ species, x, y, level: levelForDistance(d, sp.lvl), count, when, fauna: true }`
— `fish: true` para `fish`), respeitando `SPECIES[sp].minD`; `mobs.js spawnMember` faz o resto (`setupFauna`).
Ligado no mundo em pedaços (docs/STREAMING.md "Regiões ativas"): na fonte `planet` (`?source=planet`, `?planet=1`),
quando um chunk carrega no anfitrião, `mobs.js planetSpawners` chama `chunkFauna(game, c, { levelFor, whenOf })`
(`faunaSpawn.js`) em vez da regra clássica do entorno: ele lê as camadas do chunk no mundo (`pbiome` = o bioma do
planeta por tile, nova camada por chunk que o `planetSource` entrega; `water`, `rock`, alturas dos cantos, árvores dos
baldes), sorteia com `chunkRng(seed, cx, cy)` e devolve os geradores; eles só enchem com o chunk ativo e saem com ele
(o mesmo chunk volta com os mesmos geradores). A fonte sintética (`synth`) continua com a regra clássica (não tem bioma
do planeta). Uma manada que migra fica dentro do próprio chunk.

---

## 4. Arte (`src/art/fauna.js`, `src/art/faunaDraw.js`)

Abordagem: o **kit 3D da criação** (`art/livestock.js`, exportado como `MODEL3D`): cada bicho é um conjunto de
elipsoides no espaço do corpo, rasterizado pixel a pixel com o sombreado em degraus, ruído de pelo, padrões no espaço
do corpo (listras da zebra, rosetas da onça, manchas do lince, escamas do crocodilo, losangos da cascavel) e o contorno
dos pintores — toda vista é o bicho de verdade visto daquele lado, inclusive as 3/4 (se / ne; sw / nw espelhadas). Um
construtor por plano de corpo:

| construtor | espécies |
|---|---|
| `quad` (quadrúpede: massas do corpo, pescoço, cabeça, focinho, mandíbula, orelhas, cauda, 4 patas com joelho; extras por espécie: chifres, galhadas, juba, crina, tromba e orelhas, barba, corcova; `wide` alarga de frente / de costas) | cavalo, zebra, gazela, rena, alce, bisão, iaque, camelo, cabra-montês, elefante, leão / leoa, onça, lince, urso-polar, raposa-do-ártico, macaco |
| `bird` (corpo inclinado, pescoço — em S na garça —, cabeça e bico, asas dobradas ou abertas em 3 fases + planando, leque da cauda, pernas finas) | abutre, águia, arara, gaivota, garça |
| `snake` (contas numa curva em S, fases do rastejar, bote, enrolada, chocalho) | cascavel |
| `croc` (corrente baixa: focinho, cabeça, corpo, cauda com escamas; patas abertas para o lado; bocarra aberta no ataque) | crocodilo |
| `crab` / `scorpion` (carapaça, 8 patas, pinças / cauda com ferrão) | caranguejo, escorpião |
| `swimmer` (corpo fusiforme, nadadeiras, cauda de tubarão ou nadadeira horizontal) / `seal` | tubarão, golfinho, baleia / foca |

Quadros (cada um nas 5 vistas e, onde faz sentido, a versão `_cut` que só mostra o que fica acima da água):
quadrúpedes `stand w0..w3 graze atk` (+ `rest` nos felinos, urso-polar, raposa, camelo; `sit` no macaco; `swim` no
urso-polar); aves `stand w0 w2 graze atk fly0 fly1 fly2 glide`; cascavel `stand s0..s3 atk coil`; crocodilo `stand
w0..w3 atk swim`; caranguejo / escorpião `stand w0..w3 atk`; nadadores `stand swim1 swim2 atk` (+ `jump` golfinho,
`dive` baleia); foca `stand w0 w2 swim`. Mais `<key>_top` (o vulto visto de cima, debaixo d'água) e `<key>_dead`
(deitado de lado — patas esticadas, barriga à mostra — visto um pouco mais de cima; caranguejo e escorpião de costas).

Desenho (`drawFauna`, chamado pelo `game.js` antes do `drawAnimal`): vista de 8 direções como a criação; passo pela
fase da marcha (`moveT`), galope que balança e estica correndo (saltos na gazela e na cabra), pastar / farejar no
horário ocioso de cada um, o bote ao longo da direção com o quadro de ataque, o tranco quando apanha, morrer = afunda e
tomba, depois o desenho deitado (o corpo no chão usa o mesmo: `corpseDraw.js`, sem girar; esqueleto e carcaça deitados
por cima). Aves: altura cosmética que sobe / desce suave em cada par (abutre e águia 5,5–8,5 tiles, gaivota 3,2–5,
arara 2,6–3,8, garça 2,8–4), sombra pequena lá embaixo, batidas de asa em rajadas e o resto planando; pousadas na copa
ficam a ~1,5 tile. Nadadores: o pedaço acima da água (`_cut`), o vulto escuro debaixo da superfície (`_top`, chato,
virado para onde nada), anéis na linha d'água; salto do golfinho em arco; o borrifo da baleia. Crocodilo escondido: só
os olhos e as escamas na água (rasa ou funda); cascavel escondida: enrolada, quase transparente. Plaquetas de nome:
nenhuma sobre aves, caranguejos ou bichos escondidos/voando, a não ser marcados ou atacando (`ui/overlay.js`); a placa
sobe com quem voa / está na árvore.

Números (Chrome sem GPU, desktop): **120 sprites no atlas** (30 desenhos × e / s / n + `_dead`), pintados em **~0,65 s**
no primeiro boot depois de uma mudança de arte (cache depois), **~512 mil px ≈ 3 % do atlas 4096²**. O resto — **1065
quadros preguiçosos** — é pintado sob demanda na textura preguiçosa (~23 ms cada, só os que aparecem na tela; um quadro
ainda não pintado mostra o quadro parado da mesma vista).

Revisão: `tools/diag.html?set=fauna&g=polar|taiga|steppe|desert|savanna|jungle|swamp|mountain|coast|ocean` (todas as
vistas: parado, andando, atacando, pastando, deitado, voando, planando, nadando, à espreita, saltando, soprando, morto).

---

## 5. Rede

Nada novo no protocolo: `SPECIES` + os nomes do contrato de arte bastam (proxies pelo fluxo de entidades). Os estados
que só o desenho precisa vão no campo da criação (`dyn[13]`): para fauna, `fmode << 4` — voando 1 · escondido 2 · na
árvore 4 · descansando 8 (`net/entities.js`, decodificado em `e.fmode`). Saltos, sopros e mergulhos são `action` (já
replicada); a altura das aves, o vulto debaixo d'água e os anéis são cosméticos, iguais em todo par. Nome da leoa
(`name`) e o macho (`variant` bit 2) vão no registro estático.

Testes (`tools/mp-test.html?run=FA1,FA2`):
- **FA1** — uma onça a ~7 tiles do convidado o vê e persegue no anfitrião (rastejando longe: `speedK` < 1; bote perto:
  `speedK` > 1); o convidado vê a cópia (onça, "Onça-pintada", perseguindo ele); as mordidas tiram vida do convidado
  (aplicadas pelo dono); no modo criativo, ao lado do convidado, ela nunca começa a perseguir; morta, o corpo de onça
  aparece nos dois; digest igual.
- **FA2** — cinco zebras de uma manada: o convidado anda até elas, uma foge e a manada inteira foge junto no anfitrião;
  no convidado as cinco se afastam (≥ 3 tiles); três gaivotas pousadas (fmode 0 nos dois) levantam voo juntas quando o
  convidado chega (bit "voando" no anfitrião e nas cópias do convidado); digest igual.

---

## 6. Mudanças pequenas em arquivos dos outros (genéricas, compatíveis)

- `art/livestock.js`: exporta o kit (`MODEL3D`); `render` com `opt.cut` (só o que está acima de uma altura), material
  `bump` (relevo mais suave que o da lã) e `cool` (pelo branco com sombra azulada); `modelSprite(model, yaw, phi, opt)`.
- `art/sprites.js` (grupo `addFauna`), `art/contract.js` (`FAUNA_SPECIES`: `<sp>_s / _n / _e` no contrato).
- `game/game.js`: `drawFauna` antes de `drawAnimal`. `art/corpseDraw.js`: corpo de fauna deitado sem girar, chave de
  arte (leão macho) e tamanho do esqueleto.
- `game/ai.js`: `bite` exportado; `m.speedK` multiplica a velocidade da perseguição.
- `game/mobs.js`: `planetSpawners` (planeta em pedaços) usa `chunkFauna` na fonte `planet`; `spawnMember` chama
  `setupFauna`; a separação ignora `noPush` (aves e nadadores).
- `world/world.js` + `world/planetSource.js`: camada por chunk `pbiome` (o bioma do planeta por tile; 255 = nenhum nas
  fontes clássica / sintética).
- `game/content/combat.js`: `...FAUNA_SPECIES` no `SPECIES`. `game/mut/corpses.js`: tamanho do corpo por `SPECIES.size`.
- `net/entities.js`: `fmode << 4` no campo da criação. `ui/overlay.js`: sem plaqueta sobre bicho escondido / voando /
  ambiente, placa erguida com a altura cosmética. `game/combat.js`: o ataque automático não escolhe bicho escondido.
- `tools/diag.html` (`set=fauna`), `tools/mp-test.js` (FA1, FA2).

---

## 7. Falta / ideias

- Peixes: as tabelas pedem cardumes no mar e nos lagos (`fish`); se o gerador por chunk da criação também puser
  peixes, tirar uma das duas fontes.
- Vegetação e chão dos biomas no planeta ainda são os do mundo clássico (acácia vira carvalho etc.) — o agente de
  vegetação está nisso; a savana aparece verde, mas os bichos nascem nos biomas certos.
- Estações por latitude: hoje o inverno é global, então "no inverno os bichos do dia saem menos" vale até na savana.
- A banquisa ainda é água no jogo: focas e ursos-polares ficam no deserto polar / na margem.
- Predadores caçando presas selvagens (leões atrás de zebras) e as presas da criação para leões / onças (`PREY.hunters`)
  ainda não; só a águia caça bichos pequenos.
- Sons próprios (rugido, trombeta, chocalho): hoje usam os sons genéricos de rosnado.
- Peixes do mar usam o peixe de rio da criação; tartaruga-marinha, morsa, hiena, girafa, anta e corujas ficaram para depois.
