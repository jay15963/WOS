# WOS · Planeta (geração do mundo inteiro)

Pedido do dono: um planeta inteiro e realista — placas tectônicas, cordilheiras, planícies, planaltos, cânions,
rios com nascente e foz, sistemas de rios, lagos, lagunas, deltas, fiordes, falésias, desertos, gelo polar,
temperatura e umidade, biomas novos — com espaço de terra para ~500 vilas (o mapa atual de 256×256 = o território
de uma vila), continentes separados por oceano abissal (onde nem o barco navega) e a emenda leste–oeste do mundo
sempre num oceano largo.

**Fase 1 (este documento):** o gerador do planeta (o que o mundo É). Outros dois agentes fazem, em paralelo, o
motor de mundo em chunks (como carregar / salvar / sincronizar) e o protótipo de relevo com alturas. A fase de
conteúdo (vegetação e animais por bioma, estações por latitude, regras do oceano) vem depois e usa as tabelas
daqui.

Código: `src/world/planet/` (puro, sem DOM, roda em worker). Ferramentas: `tools/planet.html`,
`tools/planet-shots.mjs`, `tools/planet-seams.mjs`. Modo de jogo de teste: `?planet=1`.

---

## 1. Números (contrato comum)

| Nome | Valor | Onde |
|---|---|---|
| Planeta | `W = 16384` × `H = 8192` tiles | `consts.js` |
| Emenda | x dá a volta (`((x % W) + W) % W`); oceano da emenda centrado em x = 0, forçado a abissal por `SEAM_HALF = 16` células para cada lado (1024 tiles de largura no mínimo, na prática ~1500–2500) | |
| Polos | y = 0 polo norte, y = H − 1 polo sul, equador em H / 2 | |
| Latitude | **área igual**: `sin(lat) = 1 − 2(y + 0,5)/H` (cada faixa de clima tem a parte do planeta que teria numa esfera: trópicos ~40 %, calotas ~8 %) | `sinLatAt`, `latitudeAt` |
| Célula macro | 32 × 32 tiles → grade 512 × 256 | `CELL`, `MW`, `MH` |
| Chunk | 64 × 64 tiles → 256 × 128 chunks | `CHUNK`, `CW`, `CHH` |
| Classes de água | 0 terra · 1 rasa (vadear) · 2 funda (nadar, barco) · 3 **abissal** (barco não entra) | `WATER` |
| Abissal | fundo macro abaixo de `ABYSS_M = −1500 m` **e** a ≥ `ABYSS_D = 6` células (192 tiles; ≥ 150 tiles no nível de tile) de qualquer terra ou baixio onde possa surgir ilhota. Perto da terra há sempre plataforma + talude (fundo no máximo 60 + 245 m por célula): costas, baías, fiordes, estreitos e lagos nunca são abissais | |
| Terra | 29–31,5 % da superfície (alvo sorteado por semente, descontados os lagos); ~590–640 "vilas" de 256² de terra | `stats` |
| Continentes | 5–8 crátons (≥ 20 células de mar entre eles) + 1 continente polar sul + 3–6 microcontinentes; mais ilhas de arco e de ponto quente | |

**Nenhuma ponte entre continentes:** cada continente grande tem um "território" (as células mais próximas
dele, `planet.terr`); na fronteira entre dois territórios o fundo é empurrado para abaixo do abissal e há uma
faixa sem terra de 8–10 células de cada lado (ilhas ou costas perto demais afundam), então os anéis de
plataforma de dois continentes nunca se tocam. A emenda é sempre oceano. `tools/planet-abyss.mjs` verifica.

---

## 2. Escala vertical — `metersToStories(m)`

Uma só função (em `consts.js`) transforma elevação física (metros) em altura de jogo (andares; 1 andar = um
piso construído = 1 tile para cima na tela, `game/levels.js STORY_H`):

```
stories = 2,89 · (√(1 + m/150) − 1)                      (ímpar: o fundo do mar espelha para baixo de 0)
        + 0,0082 · d² / (d + 700),  d = m − 900 > 0      (as terras altas: 9/11/2026, pedido do dono)
```

| metros | andares | |
|---|---|---|
| 0 | 0 | nível do mar |
| 100 | 0,85 | planície costeira |
| 280 | 2,0 | fim das baixadas |
| 1000 | 5,2 | colinas / planalto |
| 1500 | 9,0 | serras |
| 2000 | 13,6 | montanhas |
| 3000 | 23,3 | montanhas altas |
| 6000 | 52 | grandes cordilheiras |
| 8800 | 79 | os picos mais altos |

Até 900 m é a raiz quadrada de antes (planícies, vilas, estradas iguais); acima disso cada metro rende ~0,0082 andar a
mais (sem quina: a inclinação extra começa em zero), para as cordilheiras do mapa-múndi serem altas de verdade no jogo
(o dono: "terrenos mais elevados devem ser realmente mais elevados"). Rios, lagos, cachoeiras e o gradiente de
temperatura passam todos por esta curva: continuam coerentes. Inversa: `storiesToMeters(s)` (Newton com 8 passos acima
de 900 m); inclinação: `metersPerStory(m)`. Só `+ − × ÷ √` (bits iguais em todo navegador). Para mudar a escala, mexa
em `STORY_A` / `STORY_B` / `HI_M0` / `HI_D` / `HI_K`. **O relevo fino é somado já em andares** (colinas, cristas,
dunas, mesas, falésias, cânions — §4), então o formato local não depende da curva.

---

## 3. Como o planeta é feito (macro, 512 × 256) — `generatePlanet(seed)`

1. **Continentes** (`tectonics.js`): 5–8 crátons de tamanhos bem diferentes (o maior 5–10× o menor), cada um
   1–4 "lobos" ao longo de uma espinha curva, crescidos por Dijkstra com custo de ruído e anisotropia. Estilos:
   o maior costuma ser **maciço**; um é **longo norte–sul** (como as Américas); um é **quebrado em arquipélago**;
   às vezes um fica perto do polo norte. Mais o **continente polar sul** (como a Antártida): faixa no sul com costa
   muito irregular — baías fundas até o polo, penínsulas compridas — cortada pela emenda. Contornos deformados
   por ruído (sem bordas retas).
2. **Placas** (12–19): sementes dentro dos continentes e nos oceanos, crescimento com ruído (atravessar uma
   costa custa mais: muitas bordas de placa seguem margens continentais), mapa deformado por ruído (bordas
   curvas). Cada placa tem vetor de movimento; em cada borda o movimento relativo contra a normal dá
   convergência, divergência ou transformante.
3. **Relevo**: base continental (planícies, planaltos com bordas, cinturões antigos de montanhas, bacias),
   plataforma continental (larga em margem passiva, estreita em margem ativa), talude, planície abissal. Nas
   bordas de placa:
   - continente × continente convergente → cordilheira larga e alta + planalto atrás + contrafortes;
   - continente × oceano → cordilheira costeira + arco vulcânico + **fossa**;
   - oceano × oceano → **arco de ilhas** vulcânicas + fossa;
   - divergente continental → **rifte** (vale com lagos + ombros); divergente oceânico → dorsal meso-oceânica;
   - transformante → cristas curtas.
   A largura das cordilheiras varia ao longo delas, com passos (gargantas) e cristas em ruído "ridged".
   **Costas fractais** (golfos, penínsulas, baías, cabos); continentes "quebrados" viram arquipélagos.
4. **Vulcões**: arcos (zonas de subducção), **cadeias de ponto quente** (ilhas em linha, mais velhas = menores,
   na direção oposta ao movimento da placa), caldeiras continentais, vulcões de rifte. Cones somados depois da
   erosão (`coneAt`), refeitos com precisão por tile no chunk.
5. **Nível do mar** ajustado por busca binária para a fração de terra alvo (só nos continentes).
6. **Paredes abissais** entre territórios e oceano da emenda.
7. **Erosão**: 6 passos de "stream power" implícito (Braun–Willett) sobre fluxo D8 com aspereza em ruído (as
   drenagens convergem em árvores, sem linhas paralelas), suavização leve e difusão.
8. **Clima** (`climate.js`):
   - temperatura média anual pela latitude (27 °C no equador, ~0 °C a 60°, −25 °C no polo) − 6,5 °C/km +
     **ondas planetárias** (anomalia de ±3–4 °C: isotermas onduladas) + **correntes** (fria na costa oeste
     subtropical, quente na costa leste, deriva quente nas costas oeste de latitude média) + continentalidade;
     amplitude sazonal cresce com a latitude e com a distância do mar;
   - ventos por faixa: alísios (sopram para oeste, 0–30°), ventos de oeste (30–60°), polares de leste;
   - umidade levada pelo vento em cada linha (duas voltas no planeta): o oceano evapora, a terra chove
     (**chuva orográfica** na encosta de barlavento, **sombra de chuva** a sotavento), as plantas devolvem parte;
     mais uma difusão isotrópica fraca a partir das costas; faixa equatorial muito úmida (ZCIT), cinturões secos
     subtropicais.
9. **Hidrologia** (`hydro.js`): *priority-flood* → depressões; pequenas rasas viram planície (sedimento),
   as outras viram **lagos**. Balanço de água por lago: se o que chega não vence a evaporação da superfície, o lago
   é **endorreico** (salgado, nível mais baixo) ou um **salar** seco. Segundo *priority-flood* com os lagos
   endorreicos como sumidouros → direção de escoamento de toda célula, **vazão** (escoamento acumulado; lagos
   perdem a evaporação; gelo e permafrost não escoam) e área drenada.
   - **rio** (vazão ≥ `RIVER_Q` e ≥ 9 células drenadas) — nascentes onde o rio começa;
   - **córrego** (cabeceiras que alimentam um rio ou lago em até 2 células);
   - **leito seco** (wadi) em terra árida;
   - **fiorde** perto da foz em costas montanhosas frias de alta latitude;
   - **cânion**: rio em planalto árido entalhado 3–5 andares (cachoeira na cabeceira do cânion);
   - **cachoeira** onde o nível do rio cai > 1,25 andar entre duas células;
   - **delta** na foz de rio grande em plataforma rasa e costa baixa: leque + 3–6 braços (polilinhas) gerados
     uma vez no planeta; **estuário** (alargamento) nos outros rios.
10. **Biomas e costas** (`biomes.js`, §5) por temperatura × chuva × altitude, com ruído nas bordas (ecótonos).
    Banquisa com borda irregular que avança e recua com a longitude, placas de gelo soltas e canais (`seaIceAt`).
    Tipo de costa por célula costeira: praia, dunas costeiras, laguna com restinga, costa rochosa, **falésia**,
    mangue, fiorde, gelo, delta.

Tempo: **1,6–2,1 s** (Node / Chrome, desktop), ~13 MB de arrays.

### Saída macro (objeto simples de typed arrays — dá para mandar a um worker)

`elev` (m, rocha + gelo) · `cone` (m, parte dos vulcões) · `iceT` (espessura do manto de gelo) · `surf` (superfície
de drenagem; lagos no nível) · `sd` (distância em células à borda continental, + dentro) · `plateau`, `relief`,
`mtn` (0..1) · `crust`, `plate`, `plates[]`, `bkind` (tipo de borda) · `tMean`, `tAmp` (°C), `precip` (mm/ano),
`dOcean` (células) · `ocean`, `water` (0 terra, 2 mar, 3 abissal, 4 lago), `biome`, `coast`, `flags` (vulcânico,
cânion, fiorde, delta, planalto, rifte, erg, distrito de lagos), `comp` (componente de terra) · `down` (célula a
jusante), `flow` (vazão / `RIVER_Q`), `drain` (células drenadas), `rkind` (0, 1 rio, 2 leito seco, 3 fiorde,
4 córrego), `upMain`, `mouthD`, `rlevel` (nível do rio em andares, monótono para jusante), `fall`, `canyon` ·
`lakeId`, `lakeLevel`, `lakes[]` · `volcanoes[]`, `deltas[]`, `continents[]`, `stats`, `timings`.

---

## 4. Chunk em escala de tile — `generateChunk(planet, cx, cy, opts)`

Função pura de (planeta, cx, cy); cx dá a volta. Cada chunk calcula uma janela com **margem de 16 tiles**; tudo
que depende de vizinhança (distâncias, costa, árvores) é limitado a menos que isso, então chunks vizinhos
concordam bit a bit (`tools/planet-seams.mjs` verifica os cantos compartilhados, inclusive na emenda x = 0, e a
repetição). Etapas:

1. elevação macro **bicúbica** (separável, sem ultrapassar os vizinhos) + cones exatos + ruído em andares:
   colinas, **cristas e vales** nas montanhas (ridged 256 + 64 tiles), **dunas** transversais no erg, **mesas e
   buttes** em degraus nas terras áridas, enseadas / cabos / ilhotas na linha da costa; nas **cordilheiras de verdade**
   (`mountainK(mtn)`: 0 abaixo de mtn 0,15, 1 a partir de 0,7) maciços (512 tiles, 12 andares), cristas (ridged 192,
   20 andares) e **faixas de penhasco** em degraus que seguem as curvas de nível, com brechas e passagens
   (docs/TERRAIN-HEIGHT.md §16);
2. mar onde a altura < 0 perto de célula oceânica (depressões interiores não viram mar);
3. **costas** pelo tipo: praia achatada (3–9 tiles) e água rasa larga; dunas atrás da praia; **restinga** de areia
   paralela à costa fechando uma **laguna**, cortada por barras; costa rochosa; **falésias** de 0,4–6 andares que
   sobem direto da água, com **enseadas de praia** onde baixam, **plataformas de rocha** e **rochedos (sea stacks)**
   na frente dos promontórios; mangue (lama, árvores na água rasa); gelo; recifes em mar quente;
4. **rios**: spline Catmull-Rom pelas células do rio (nós com deslocamento estável), **meandros** (largos na
   várzea, encaixados no cânion), largura pela vazão (córrego 1 tile … rio grande até 40), afluentes chegando no
   nó do rio principal, saída de lagos. Perfil: canal (raso nas bordas, fundo no meio), **várzea** plana, vale em
   V nas montanhas (nas cordilheiras de verdade o vale se abre 2,4 tiles por andar acima do rio, até 40 tiles: a
   passagem pela serra), **cânion** com fundo plano, tálus e paredes em **camadas** (degrau + patamar, 2–4 estratos,
   rocha arenito / calcário alternada), **fiorde**: braço de mar sinuoso, mais largo na foz e estreitando para o
   interior, fundo em U (borda rasa, meio fundo — classe 2, nunca abissal), soleira rasa na boca, paredes íngremes,
   e no fim o vale com o rio (muitas vezes uma cachoeira). Rio "suspenso" acima do chão local desce até ele;
3–4 nascentes, cachoeiras e crateras viram `features`;
5. **lagos** macro (margem pela topografia, sem quadrados) e **lagoas** (alongadas, contorno em ruído, só em
   terreno plano; muitas nos distritos de lagos frios, raras nos desertos = oásis);
6. **deltas** (leque de terra baixa + braços);
7. classes de água (rasa pela profundidade / largura de praia, abissal pelo fundo macro);
8. **alturas nos cantos** (média dos 4 tiles; 65 × 65 por chunk) e inclinação;
9. bioma por tile (clima interpolado com ruído + lapse local + contexto: praia, falésia, mangue, várzea / oásis
   ao lado de rio grande, terra vulcânica na parte alta do cone, salar), chão, rocha, tipo de rocha, minérios, neve:
   - **encostas são chão, não rocha**: cascalho (tálus) onde é íngreme (≥ 0,62 andar por tile, com ruído), manchas de
     cascalho nas partes altas acima das árvores e nas cristas, pedra nua só nas faces mais íngremes; o prado alpino é
     terra com capim / urze / flores; areia, neve, sal e gelo guardam o próprio chão;
   - **rocha (`rock = 1`, minerável) só em**: faces de penhasco (≥ 1,25 andar por tile), **tors / morrotes** em
     manchas ao longo das cristas (ruído de 48 + 12 tiles, só onde há lombada ou encosta: um cume largo e plano fica
     chão), afloramentos em encosta íngreme, rochedos do mar e afloramentos que furam a neve dos picos. Os tiles de rocha
     **sobem com a profundidade** (0,58 andar por tile de profundidade, até 4): um afloramento é um morrote de rocha de
     verdade no relevo (minerar corta o tile até o canto mais baixo). Nas janelas de montanha da semente 4242 a rocha
     caiu de 11–16 % para 1–3 % da terra; 96–99 % da terra é caminhável;
   - **picos nevados ásperos**: na neve alta o vento varre cristas, lombadas e encostas (ruído + crista + curvatura +
     inclinação) até o cascalho de gelifração; a neve fica nas baixadas; afloramentos de rocha furam a neve;
   - **neve permanente** (chão `SNOW`) só onde a média do ano fica bem abaixo de zero (−8,5 °C com ruído, orientação e
     inclinação; o bioma de picos nevados e o manto de gelo são neve): a tundra no verão não fica branca — a neve do
     inverno é das estações;
   - **tipo de rocha regional em todo tile de terra** (não só nos de rocha: é a cor das faces, dos morrotes e do
     cascalho): basalto nos vulcões e na terra vulcânica, arenito em cânions, mesas e desertos (calcário em manchas),
     arenito também nas terras secas quentes, granito / ardósia / calcário / mármore no resto;
   - minérios: veios por ruído dentro da rocha; como os afloramentos são pequenos, o ferro aparece a ≥ 1,4 tile de
     profundidade e ouro / jade a ≥ 2,2;
10. objetos naturais (árvores sem aglomerar — o menor hash entre os vizinhos; nas florestas fechadas só os vizinhos
    em cruz, então as copas se fecham; na savana, estepe e mata mediterrânea as árvores vêm em **bosques** com campo
    aberto entre eles —, arbustos e plantas da tabela do bioma, pedregulhos (com líquen no frio e no alto, de arenito
    nos desertos), seixos, gravetos, capim de fibra, trigo selvagem no solo fértil, batata / milho / algodão
    selvagens) — **nada cresce em neve, gelo, sal ou pedra nua** (nem galho, fruta, flor ou capim; na cinza só seixos,
    arbustos do deserto e capim seco) — e a **cobertura do chão por bioma** (`decorKind`: a densidade vem da coluna
    "grama" da tabela; nas terras abertas em manchas com chão nu entre elas) + detalhes esparsos: crosta de sal, lama
    rachada, ondulações de areia, conchas / madeira trazida pelo mar / algas na praia, líquen na tundra e no alto,
    cinza e escória no vulcão, cascalho solto nas encostas, raízes respiratórias do mangue, lírios em lagoas quentes,
    corais nos recifes, algas em costões. Tabela dos tipos em §6.

**Tempo: ~25 ms por chunk** (desktop, média; 15–45 ms conforme o lugar). Saída ~97 KB de arrays + objetos.

### Formato da saída

```
{ cx, cy, x0, y0, size: 64,
  height:  Float32Array(65*65)  alturas nos cantos (andares; arredondadas a 1/1024)
  ground:  Uint8Array(4096)     id de chão (PG, §6)
  water:   Uint8Array           0 terra, 1 rasa, 2 funda, 3 abissal
  wlevel:  Float32Array         nível da superfície da água (andares) nos tiles de água (mar 0)
  biome:   Uint8Array           id de bioma (§5)
  rock:    Uint8Array           1 = massa de rocha minerável (faces, tors, afloramentos; os cantos dela sobem com a profundidade)
  rockType:Uint8Array           rocha regional de todo tile de terra: 1 granito 2 calcário 3 ardósia 4 mármore 5 basalto 6 arenito
  ore:     Uint8Array           ids de ORE do jogo (1 cobre, 2 ferro, 3 carvão, 4 ouro, 5 jade)
  flowX, flowY: Float32Array    correnteza dos rios (−1..1, como hoje)
  fertile: Uint8Array           1 = até 5 tiles da margem de um rio (mesma regra de soil.js)
  lush:    Uint8Array           0..255 viço da grama
  objects: [{ id, type, v, x, y, s, f, age?, w? }]   x, y relativos ao chunk; w = em pé na água
  decor:   [{ t, v, x, y, s, f, w? }]
  features:[{ t: 'waterfall'|'spring'|'crater', x, y, drop?, dx?, dy?, active?, kind? }]
  ms }
```

Ids dos objetos: `(cy * 256 + cx) * 16384 + k` (números únicos, estáveis, nunca colidem com os ids de texto de
`net.newId`). Índice de tile `y * 64 + x`; canto `y * 65 + x`; tile (x, y) tem cantos (x, y) … (x + 1, y + 1).

---

## 5. Biomas

Ids e parâmetros em `BIOME_LIST` (`biomes.js`); `landBiome(T, P, elevação, ctx)` classifica. Colunas: tipos de
árvore com peso (os que ainda não existem estão em itálico na lista do §6), chance de árvore por tile livre,
arbustos / plantas, grama (0..1), chão principal, fertilidade, perigo (0..3: frio, calor, predadores), bioma
clássico usado no `?planet=1`.

| id | chave | nome | árvores (peso) | dens. árvore | arbustos / plantas | dens. arb. | grama | chão | fert. | perigo | clássico |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `abyss` | Oceano abissal | (água) | | | | | | | 3 | water |
| 1 | `ocean` | Mar aberto | (água) | | | | | | | 1 | water |
| 2 | `shallows` | Águas rasas | (água) | | | | | | | 0 | water |
| 3 | `reef` | Recife de coral | (água) | | | | | | | 0 | water |
| 4 | `sea_ice` | Banquisa (mar congelado) | (água) | | | | | | | 3 | water |
| 5 | `lake` | Lago | (água) | | | | | | | 0 | water |
| 6 | `salt_lake` | Lago salgado | (água) | | | | | | | 0 | water |
| 7 | `lagoon` | Laguna | (água) | | | | | | | 0 | water |
| 8 | `river` | Rio | (água) | | | | | | | 0 | water |
| 9 | `ice_sheet` | Manto de gelo | — | 0 | — | 0 | 0 | Neve | 0 | 3 | rocky |
| 10 | `polar_desert` | Deserto polar | — | 0 | lichen_rock×1 | 0.01 | 0.05 | Cascalho | 0 | 3 | rocky |
| 11 | `tundra` | Tundra | tree_dwarf×1 | 0.006 | tundra_shrub×3 berrybush×1 | 0.03 | 0.45 | Musgo | 0.15 | 2 | meadow |
| 12 | `taiga` | Taiga | tree_spruce×5 tree_pine×3 tree_larch×2 tree_birch×1 | 0.42 | bush×1 berrybush×1 | 0.02 | 0.35 | Musgo | 0.3 | 2 | pine |
| 13 | `temperate_forest` | Floresta temperada | tree_oak×6 tree_birch×2 tree_pine×1 | 0.36 | bush×3 berrybush×2 herbbush×1 | 0.05 | 0.6 | Terra | 0.75 | 1 | forest |
| 14 | `temperate_rainforest` | Floresta temperada úmida | tree_redwood×3 tree_spruce×3 tree_pine×2 tree_oak×1 | 0.5 | bush×2 herbbush×2 | 0.06 | 0.7 | Musgo | 0.6 | 1 | pine |
| 15 | `steppe` | Estepe / pradaria | tree_oak×1 | 0.004 | tussock×4 bush×1 | 0.03 | 0.8 | Terra | 0.85 | 1 | meadow |
| 16 | `mediterranean` | Mata mediterrânea | tree_olive×3 tree_cypress×2 tree_oak×2 tree_pine×1 | 0.08 | bush×3 herbbush×1 | 0.08 | 0.4 | Chão seco | 0.55 | 1 | birch |
| 17 | `cold_desert` | Deserto frio | — | 0 | shrub_desert×3 dead_bush×1 | 0.02 | 0.08 | Chão seco | 0.1 | 2 | rocky |
| 18 | `desert_dunes` | Deserto de dunas | — | 0 | dead_bush×1 | 0.002 | 0 | Areia | 0 | 3 | shore |
| 19 | `desert_rocky` | Deserto rochoso | tree_acacia×1 | 0.001 | cactus×2 cactus_tall×1 shrub_desert×3 agave×1 dead_bush×2 | 0.015 | 0.04 | Chão seco | 0.05 | 3 | rocky |
| 20 | `badlands` | Mesas e cânions | tree_pine×1 | 0.002 | shrub_desert×3 cactus×1 dead_bush×1 | 0.012 | 0.05 | Argila vermelha | 0.1 | 2 | rocky |
| 21 | `savanna` | Savana | tree_acacia×5 tree_baobab×1 | 0.018 | bush×2 termite_mound×1 | 0.02 | 0.75 | Chão seco | 0.45 | 2 | meadow |
| 22 | `tropical_dry` | Floresta tropical seca | tree_jungle×3 tree_acacia×2 tree_baobab×1 bamboo×1 | 0.2 | bush×3 berrybush×1 | 0.05 | 0.5 | Terra | 0.5 | 2 | forest |
| 23 | `rainforest` | Floresta tropical | tree_jungle×6 tree_kapok×1 tree_palm×1 bamboo×1 | 0.55 | bush×2 herbbush×2 berrybush×1 | 0.07 | 0.6 | Musgo | 0.4 | 2 | forest |
| 24 | `cloud_forest` | Floresta nebular | tree_jungle×3 tree_fern×3 tree_oak×1 | 0.45 | herbbush×2 bush×1 | 0.06 | 0.7 | Musgo | 0.4 | 1 | forest |
| 25 | `mangrove` | Mangue | tree_mangrove×1 | 0.3 | — | 0 | 0.2 | Lama | 0.3 | 2 | marsh |
| 26 | `swamp` | Pântano tropical | tree_jungle×2 tree_dead×1 tree_palm×1 | 0.1 | papyrus×3 bush×1 | 0.08 | 0.8 | Brejo | 0.4 | 2 | marsh |
| 27 | `marsh` | Brejo / turfeira | tree_dead×2 tree_birch×2 | 0.03 | bush×1 | 0.02 | 0.85 | Brejo | 0.35 | 1 | marsh |
| 28 | `alpine` | Prado alpino | tree_dwarf×2 tree_pine×1 | 0.01 | tundra_shrub×2 bush×1 | 0.02 | 0.6 | Terra | 0.3 | 2 | meadow |
| 29 | `snow_peaks` | Picos nevados | — | 0 | — | 0 | 0 | Neve | 0 | 3 | mountain |
| 30 | `volcanic` | Terra vulcânica | tree_dead×1 tree_pine×1 | 0.01 | shrub_desert×1 | 0.01 | 0.05 | Cinza vulcânica | 0.6 | 3 | rocky |
| 31 | `salt_flat` | Salar | — | 0 | — | 0 | 0 | Sal | 0 | 2 | shore |
| 32 | `beach` | Praia | tree_palm×1 | 0.004 | dune_grass×1 | 0.01 | 0.05 | Areia | 0.05 | 0 | shore |
| 33 | `rocky_shore` | Costa rochosa | tree_pine×1 | 0.01 | bush×1 | 0.01 | 0.2 | Cascalho | 0.1 | 1 | rocky |
| 34 | `cliff` | Falésia | — | 0 | bush×1 | 0.01 | 0.3 | Pedra | 0.1 | 1 | rocky |
| 35 | `heath` | Charneca | tree_birch×1 tree_pine×1 | 0.01 | bush×2 berrybush×1 | 0.04 | 0.7 | Terra | 0.3 | 1 | meadow |
| 36 | `floodplain` | Várzea | tree_oak×2 tree_birch×1 | 0.03 | bush×1 berrybush×1 | 0.02 | 0.9 | Terra fértil | 1 | 0 | meadow |

Mudanças da fase de conteúdo na tabela: floresta tropical `tree_jungle 7, kapok 1, palm 2, bamboo 1, fern 1` com
densidade 0,6 e `banana 4` no sub-bosque; floresta nebular, pântano e floresta seca ganham bananeira; savana com
`td 0,03` em bosques e `tussock` (touceiras) entre os arbustos; `desert_rock` nos desertos.

Classificação (resumo): acima de ~1500 m (ou 900 m íngreme) → picos nevados (T < −7,5), prado alpino (< 0,5 °C),
floresta nebular (trópicos úmidos); T < −13 manto de gelo; −13…−6 tundra / deserto polar; −6…2,5 taiga / tundra;
2,5…12 deserto frio / estepe / taiga / floresta temperada / úmida / charneca; 12…20 desertos / mediterrânea
(costas oeste 28–44°, inverno chuvoso) / estepe / floresta; ≥ 20 desertos / savana / floresta seca / floresta
tropical. Terras áridas altas com planalto → mesas e cânions. Planícies baixas planas e úmidas → pântano / brejo.

### Estações (no jogo: docs/PLAN-V2.md "O planeta como o jogo", `src/game/seasons.js`)

`seasonZoneOf(tMédia, amplitude)` → 0 tropical (sem inverno) · 1 quente (inverno ameno, sem neve) · 2 temperado
(inverno como hoje) · 3 subpolar (inverno longo todo ano) · 4 polar (inverno eterno, walkers toda noite). Pelo mês mais
quente / mais frio: polar < 2 °C no mais quente; subpolar < −12 °C no mais frio ou < 10 °C no mais quente; temperado
< **6** °C no mais frio; quente < **16** °C; tropical o resto (os limites eram 1 / 15 °C: só ~1 % da terra ficava
temperada; agora ~6–12 %).
**Hemisférios:** do outro lado do equador em relação ao início do mundo o ano corre meio ano defasado (estações
invertidas: `world.hemiAt` / `seasonSlot`, `game.seasons[zona + 5 · hemisfério]`, `seasons.js slotClock`). O início é
sempre temperado (`temperateSpawn`) e um mundo novo começa numa manhã de primavera lá; do outro lado é outono. O
calendário (ano, dia) é global; o HUD mostra a estação local e avisa ao cruzar o equador.
`climateAt(planet, x, y)` → `{ tMean, tAmp, precip }` de qualquer tile; `latitudeAt(y)` em graus (só exibição). O jogo
usa `source.climateAt(x, y, h)` (`planetSource.js`: com a correção de altitude para a altura `h` em andares; `null` = o
chão macro) e a camada `zone` do mundo (por tile, feita no adaptador do chunk: o clima macro por bloco de 4 × 4 tiles e o
gradiente de 6,5 °C/km pela altura de cada tile; bit 8 = abissal).

### Terra quente e seca: as faixas do Nilo

Em terra árida (deserto de dunas / rochoso, badlands, deserto frio, e estepe / savana / mata mediterrânea / várzea com
menos de 650 mm de chuva, T > 4 °C) o chunk põe uma faixa de **Várzea** (`FLOODPLAIN`, chão fértil, `fertile` = 1, viço
alto) com borda nítida: ao longo de todo rio e córrego (largura 2,5 tiles num córrego, `3 + meia-largura × (1 + 3 ×
planura do vale)` num rio, + um ruído), em volta de lagos e lagoas (oásis: 4,5–7,5 tiles da água, distância exata dentro
da margem do chunk) e nos deltas secos. Na faixa: tamareiras (`tree_palm`) quando T > 14 °C e papiro junto da água. O
jogo só deixa plantar nessas faixas em terra quente e seca (`mut/crops.js`).

---

## 6. Tipos novos — chão, rocha, flora (pintados)

**Chão** (`PG`): 0–7 = os `G.*` atuais com os mesmos números; novos: 8 `SNOW` neve · 9 `ICE` gelo · 10 `ASH` cinza
vulcânica · 11 `SALT` sal · 12 `CLAY` argila vermelha / laterita · 13 `DRY` chão seco (estepe, deserto, savana).
O jogo continua jogando com o chão clássico (`GROUND_CLASSIC`: velocidade, escavar, sons); **o visual é o do planeta**:
cada um tem a própria camada de textura (`src/world/terrainTex.js`, camadas 12–17 do `uGround`): neve com sastrugi e
ondas de vento (azul nas baixadas, brilho de grãos ao sol), gelo azul polido com crevasses e neve soprada, cinza preta
com escória vermelha e pedra-pomes, crosta de sal em placas poligonais de borda branca (vira espelho do céu quando
chove), argila vermelha mosqueada com sulcos e rachaduras, chão seco com pavimento de seixos envernizados, crosta
rachada e palha. O tile mostra o chão do planeta enquanto o chão clássico embaixo for o substituto dele (`world.pground`;
um tile minerado vira pedra e mostra pedra). Cascalho e tálus pegam a cor da rocha regional (vermelhos sob arenito,
quase pretos sob basalto). A neve / gelo do planeta continuam no canal A do clima (neve nas bordas e saliências das
faces); o canal B é a **sombra do dossel** das florestas fechadas (floresta tropical, nebular, temperada úmida, mangue,
pântano, taiga), com manchas de sol — também nas plantas do chão.

**Rocha**: 1–4 atuais + 5 basalto, 6 arenito (`ROCK_CLASSIC`: basalto → ardósia, arenito → calcário para o jogo; o visual
lê `world.prock`). Camadas 18 (basalto: topos de colunas em hexágonos, juntas escuras, vesículas, líquen ferrugem) e 19
(arenito: estratos curvos creme / laranja / vermelho com estratificação cruzada, alvéolos, verniz). Nas **faces** o
arenito desenha camadas finas ao longo da altura (creme, laranja, ferrugem, marrom-arroxeado) com verniz do deserto
escorrendo das saliências; o basalto desenha **colunas** prismáticas com juntas e cortes transversais.

**Flora** (`src/art/planetFlora.js`, pintada **sob demanda** na textura preguiçosa — não entra no atlas fixo). Cada tipo do
planeta é jogado como um tipo clássico (`src/world/planet/flora.js FLORA_KIND`: colisão, coleta, rebrota e rede iguais)
e desenhado como uma espécie dentro dele:

| tipo do planeta | joga como | arte (variantes) | estações |
|---|---|---|---|
| `tree_palm` coqueiro | `tree_oak` sp 3 | tronco curvo anelado, leque de folhas pinadas, cocos (3) | tropical |
| `tree_acacia` acácia-guarda-chuva | `tree_oak` 4 | tronco bifurcado, copa chata larga (3) | tropical |
| `tree_baobab` baobá | `tree_oak` 5 | tronco-garrafa, galhos curtos (2 + 2 sem folhas) | tropical |
| `tree_jungle` árvore da selva | `tree_oak` 6 | dossel: copa larga e irregular, sapopemas, cipós (2) · sub-bosque (2) | tropical |
| `tree_kapok` sumaúma | `tree_oak` 7 | emergente, sapopemas enormes, copa em guarda-chuva (2) | tropical |
| `tree_olive` oliveira | `tree_oak` 8 | tronco retorcido oco, copa prateada solta, azeitonas (3) | perene |
| `tree_fern` samambaia-açu | `tree_oak` 9 | tronco fibroso, roseta de frondes (2) | tropical |
| `tree_mangrove` mangue | `tree_oak` 10 | raízes-escora na água rasa, copa baixa e larga (3) | tropical |
| `tree_spruce` abeto | `tree_pine` 3 | conífera estreita escura azulada (3) | perene, neve |
| `tree_larch` lariço | `tree_pine` 4 | conífera leve; dourado no outono, sem agulhas no inverno (2 + 2) | caducifólio |
| `tree_redwood` sequoia | `tree_pine` 5 | tronco vermelho fibroso enorme, copa alta (2) | perene, neve |
| `tree_cypress` cipreste | `tree_pine` 6 | coluna em chama verde-escura (2) | perene, neve |
| `tree_dwarf` bétula-anã | `tree_birch` 2 | arbusto-árvore torto pelo vento (3) | laranja, perde as folhas |
| `bamboo` bambu | `tree_birch` 3 | touceira de colmos com nós e leques de folhas (2) | tropical |
| `cactus` / `cactus_tall` | `bush` 3 / 4 | palma, barril com flores; saguaro com braços (3 / 2) | tropical |
| `agave` | `bush` 5 | roseta azulada, uma com haste florida (2) | tropical |
| `shrub_desert` | `bush` 6 | arbusto cinza-esverdeado (sálvia), um em flor (3) | vermelho no outono |
| `dead_bush` | `bush` 7 | emaranhado seco (2) | neve |
| `tundra_shrub` | `bush` 8 | salgueiro-anão / mirtilo rasteiro (3) | vermelho no outono |
| `banana` bananeira / helicônia | `bush` 9 | pseudocaules e folhas enormes rasgadas, cacho / flores (3) | tropical |
| `tussock` / `dune_grass` / `papyrus` | `fibergrass` 1 / 2 / 3 | touceira com espigas (3), capim de duna (2), papiro (2) | dourado / tropical |
| `lichen_rock` / `termite_mound` / `desert_rock` | `boulder` 20 / 21 / 22 | rocha com líquen (3), cupinzeiro-catedral (2), pedra de arenito (3) | neve / tropical |

`o.v` = espécie × 16 + variante (árvores) ou espécie × 1000 + variante (bush, fibergrass, boulder); as espécies
clássicas continuam 0–2 (o mundo atual não muda). A rebrota pede ao planeta a espécie do bioma do tile
(`source.floraLook` → `regrowV`). **Decoração nova** (`PLANET_DECOR`): `snowtuft`, `cottongrass`, `savgrass` (capim
dourado da savana), `jungleplant` (folhas grandes do chão da selva), `pneumato` (raízes respiratórias), e no chão
`lichen`, `saltcrust`, `seaweed`, `coral`, `ash`, `sandripple`, `crackedmud`.

**Estações**: as decíduas (baobá, lariço, bétula-anã) usam as classes do shader (dourado / laranja, perdem as folhas
sobre o gêmeo sem folhas); arbustos avermelham, capins douram. As espécies `tropical` (palmeira, acácia, baobá, selva,
sumaúma, samambaia-açu, mangue, bambu, cactos, agave, bananeira, papiro, cupinzeiro, capim da savana, plantas da selva,
raízes, corais) **não recebem inverno** enquanto as estações forem um relógio só do mundo: `art/season.js
SEASON_LOCAL.winterAt(x, y)` é o gancho para as estações por latitude (TODO: o chão ainda recebe a neve do inverno
global). Prévia: `tools/flora.html` (todas as variantes pintadas direto, `?g=tree_palm,cactus`).

## 7. Interface para o motor de streaming

```js
import { generatePlanet, generateChunk, findSpawn, metersToStories, storiesToMeters, climateAt,
         seasonZoneOf, latitudeAt, W, H, CHUNK, CW, CHH, WATER, BIOME, BIOME_LIST, PG } from 'src/world/planet/index.js';

const planet = generatePlanet(seed);          // ~2 s; uma vez por mundo, em worker; 13 MB; clonável (postMessage)
const spot = findSpawn(planet);               // { x, y } tile de início (+ cell, score, biome, tMean, precip)
const spot2 = findSpawn(planet, 1);           // k-ésimo bom lugar, ≥ 48 células dos melhores (outras vilas)
const ch = generateChunk(planet, cx, cy);     // ~25 ms; opts.decor = false pula a decoração
```

- **Determinismo:** tudo é função de `seed` (e de `cx, cy`). Sem `Math.random`, sem relógio; só `+ − × ÷`,
  `Math.sqrt`, `Math.floor`, `Math.imul` e hashes inteiros nos dados gerados (nada de `sin` / `exp` / `pow` / `**`,
  que podem diferir entre motores). `tools/planet-seams.mjs` gera duas vezes e compara bits; `tools/planet.html`
  mostra uma **impressão digital** (hash de `elev` + `biome` + `flow`) para comparar entre navegadores / pares.
- O planeta pode ser gerado por cada par (mesma semente → mesmos bits) ou mandado pronto (typed arrays).
  `planet._vb` / `planet._spawnScore` são caches preguiçosos (podem ser ignorados).
- Coordenadas de chunk: `cx` dá a volta (qualquer inteiro serve), `cy` em 0..127.
- O chunk não guarda nada do jogo (construções, mineração): o motor de streaming guarda as diferenças.
- `baseHeight(planet, x, y)` / `macroAt` dão altura e clima de um ponto sem gerar o chunk (minimapa, LOD de longe);
  `renderDetail` desenha o planeta inteiro.

---

## 8. Ferramentas

- `tools/planet.html?seed=N` — o planeta inteiro com camadas (Detalhe = altura real amostrada a cada 8 tiles com
  biomas misturados, rios em spline, gelo; Satélite, Relevo, Biomas, Temperatura, Chuva, Rios e lagos, Placas,
  Água, Estações), arrastar = mover (dá a volta), roda = zoom, passar o mouse = valores do ponto (latitude, bioma,
  costa, elevação em m e andares, °C, mm, zona de estação, placa), **clique = janela de 256 ou 512 tiles** gerada
  com `generateChunk` (relevo sombreado; círculos: branco cachoeira, azul nascente, laranja cratera). Tempos e
  números na linha de status. `?compare` (ou `?compare=1,7,9,…`) = grade de 6 sementes.
- `node tools/planet-shots.mjs <seed> [pasta] macro detail auto zoom:x,y,tam,nome` — as mesmas imagens em PNG sem
  navegador (`shots/planet_<camada>_<seed>.png`, `planet_detail_<seed>.png`, `planet_zoom_<lugar>.png`; `auto` acha
  cânion, falésias, laguna, delta, fiorde, montanhas, dunas, rio, vulcão, distrito de lagos e o início).
- `node tools/planet-seams.mjs [seed] [n]` — emendas entre chunks (incl. x = 0), repetição, planeta bit a bit.
- `tools/flora.html[?g=grupo,…]` — toda a flora do planeta (árvores, plantas, decoração; gêmeos sem folhas) pintada
  direto dos pintores, em 1×, com o tempo de pintura no título.
- `node tools/planet-abyss.mjs [sementes] [n]` — nenhum abissal a < 6 células da terra (macro) nem a < 150 tiles
  de um tile de terra (janelas de 7×7 chunks em fozes de fiorde, falésias, ilhas vulcânicas, margens de subducção,
  costas e na borda da plataforma) e nenhum caminho de água não abissal juntando dois territórios.
- `?planet=1[&seed=N][&px=..&py=..][&psize=256|512]` (só em localhost) — o jogo atual num recorte do planeta em
  volta do início (ou do tile px, py), sem salvar. Camadas mapeadas para os campos do `World` atual; as alturas
  ficam em `world.heightStories` (cantos, (W+1)×(H+1)) para o protótipo de relevo, e os dados do planeta em
  `world.planetBiome`, `planetGround`, `planetWater` (com abissal = 3), `wlevel`, `planetAt` (origem).

---

## 9. Desempenho e memória

| | desktop |
|---|---|
| `generatePlanet` | 1,6–2,1 s (continentes 0,3 · placas 0,2 · relevo 0,15 · erosão 0,25 · clima 0,2 · hidrologia 0,15 · biomas 0,15) |
| memória do planeta | ~13 MB (só grades macro; nada por tile do planeta inteiro) |
| `generateChunk` | ~25 ms em média (15–45), ~97 KB de arrays + ~250 objetos (+ ~6000 decorações) |
| `findSpawn` | ~70 ms (gera 1 chunk) |
| imagem "Detalhe" 2048×1024 | ~2,6 s |
| flora do planeta (111 sprites: todas as variantes + gêmeos) | ~480 ms para pintar tudo; por cena 45–62 partes, 60–380 ms espalhados pelos quadros (a textura preguiçosa vai de 1024² a 2048² numa floresta tropical); o atlas fixo **não muda** (4096², 828 sprites, 21 % ocupado) |
| chão do planeta (8 camadas 512²) | ~340 ms na primeira vez (depois do cache do IndexedDB), só quando o mundo é um planeta; 8 MB a mais no array de chão (as camadas 12–19 são reservadas sempre) |
| aquecimento na chegada | a flora num raio de 22 tiles do início é pintada na carga (sem árvores trocando na frente do jogador) |

Celular: espere 3–5× mais (planeta ~6–10 s — faça em worker, uma vez por mundo, com barra de progresso).

---

## 10. Limitações conhecidas

- O clima é anual (médias + amplitude); monções e variação sazonal de chuva não existem ainda.
- A umidade anda linha a linha (ventos zonais); há uma difusão isotrópica fraca para costas norte / sul.
- Córregos em encostas uniformes ainda podem correr quase paralelos; os rios grandes formam árvores.
- Paredes de cânion e falésias são degraus de altura com rocha nas faces (1 tile); a forma final de penhasco é
  com o agente de relevo (`height` nos cantos).
- Vulcões não têm lava / atividade (só `active` nas `features`); recifes são bioma + raso + corais desenhados.
- Estações por latitude ainda não existem: a flora tropical fica sem inverno, mas o chão recebe a neve do inverno global.
- As faces de rocha do arenito / basalto são desenhadas pelo shader sobre as texturas de cima (camadas, colunas); de
  perto ainda repetem um pouco.
- Os nomes de continentes, oceanos e rios não existem ainda.
- Só foi comparado bit a bit em motores V8 (Node e Chrome); a matemática é toda exata, mas Firefox / Safari ainda
  não foram testados (compare a impressão digital em `tools/planet.html`).
