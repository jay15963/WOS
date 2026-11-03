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
| Abissal | fundo macro abaixo de `ABYSS_M = −1500 m` (com ruído na borda) | |
| Terra | 29–31,5 % da superfície (alvo sorteado por semente, descontados os lagos); ~590–640 "vilas" de 256² de terra | `stats` |
| Continentes | 5–8 crátons (≥ 20 células de mar entre eles) + 1 continente polar sul + 3–6 microcontinentes; mais ilhas de arco e de ponto quente | |

**Nenhuma ponte entre continentes:** cada continente grande tem um "território" (as células mais próximas
dele); na fronteira entre dois territórios o fundo é empurrado para abaixo do abissal (só onde estava raso — a
parede não aparece no mar fundo). Ilhas na fronteira afundam. A emenda é sempre oceano abissal.

---

## 2. Escala vertical — `metersToStories(m)`

Uma só função (em `consts.js`) transforma elevação física (metros) em altura de jogo (andares; 1 andar = um
piso construído = 1 tile para cima na tela, `game/levels.js STORY_H`):

```
stories = 2,89 · (√(1 + m/150) − 1)        (ímpar: o fundo do mar espelha para baixo de 0)
```

| metros | andares | |
|---|---|---|
| 0 | 0 | nível do mar |
| 100 | 0,85 | planície costeira |
| 280 | 2,0 | fim das baixadas |
| 1000 | 5,1 | colinas / planalto |
| 3000 | 10,3 | montanhas |
| 6000 | 15,6 | grandes cordilheiras |
| 8800 | 19,5 | os picos mais altos |

Inversa: `storiesToMeters(s)`; inclinação: `metersPerStory(m)`. Só `+ − × ÷ √` (bits iguais em todo navegador).
Para mudar a escala, mexa em `STORY_A` / `STORY_B`. **O relevo fino é somado já em andares** (colinas,
cristas, dunas, mesas, falésias, cânions — §4), então o formato local não depende da curva.

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
   buttes** em degraus nas terras áridas, enseadas / cabos / ilhotas na linha da costa;
2. mar onde a altura < 0 perto de célula oceânica (depressões interiores não viram mar);
3. **costas** pelo tipo: praia achatada (3–9 tiles) e água rasa larga; dunas atrás da praia; **restinga** de areia
   paralela à costa fechando uma **laguna**, cortada por barras; costa rochosa; **falésias** de 0,4–6 andares que
   sobem direto da água, com **enseadas de praia** onde baixam, **plataformas de rocha** e **rochedos (sea stacks)**
   na frente dos promontórios; mangue (lama, árvores na água rasa); gelo; recifes em mar quente;
4. **rios**: spline Catmull-Rom pelas células do rio (nós com deslocamento estável), **meandros** (largos na
   várzea, encaixados no cânion), largura pela vazão (córrego 1 tile … rio grande até 40), afluentes chegando no
   nó do rio principal, saída de lagos. Perfil: canal (raso nas bordas, fundo no meio), **várzea** plana, vale em
   V nas montanhas, **cânion** com fundo plano, tálus e paredes em **camadas** (degrau + patamar, 2–4 estratos,
   rocha arenito / calcário alternada), fiorde em U abaixo do mar. Rio "suspenso" acima do chão local desce até ele;
3–4 nascentes, cachoeiras e crateras viram `features`;
5. **lagos** macro (margem pela topografia, sem quadrados) e **lagoas** (alongadas, contorno em ruído, só em
   terreno plano; muitas nos distritos de lagos frios, raras nos desertos = oásis);
6. **deltas** (leque de terra baixa + braços);
7. classes de água (rasa pela profundidade / largura de praia, abissal pelo fundo macro);
8. **alturas nos cantos** (média dos 4 tiles; 65 × 65 por chunk) e inclinação;
9. bioma por tile (clima interpolado com ruído + lapse local + contexto: praia, falésia, mangue, várzea / oásis
   ao lado de rio grande, terra vulcânica na parte alta do cone, salar), chão, **rocha** (faces íngremes ≥ 1,25
   andar por tile, cristas das montanhas, rochedos), tipo de rocha (estratos nos cânions, basalto nos vulcões),
   minérios (veios por ruído dentro da rocha), **neve** por altitude + inclinação (faces íngremes sem neve) +
   orientação (encosta virada para o polo guarda mais neve) com borda pontilhada;
10. objetos naturais (árvores sem aglomerar — o menor hash entre os vizinhos —, arbustos, pedregulhos, seixos,
    gravetos, capim de fibra, trigo selvagem no solo fértil, batata / milho / algodão selvagens), decoração.

**Tempo: ~25 ms por chunk** (desktop, média; 15–45 ms conforme o lugar). Saída ~97 KB de arrays + objetos.

### Formato da saída

```
{ cx, cy, x0, y0, size: 64,
  height:  Float32Array(65*65)  alturas nos cantos (andares; arredondadas a 1/1024)
  ground:  Uint8Array(4096)     id de chão (PG, §6)
  water:   Uint8Array           0 terra, 1 rasa, 2 funda, 3 abissal
  wlevel:  Float32Array         nível da superfície da água (andares) nos tiles de água (mar 0)
  biome:   Uint8Array           id de bioma (§5)
  rock:    Uint8Array           1 = massa de rocha mineravel (como o `rock` atual)
  rockType:Uint8Array           1 granito 2 calcário 3 ardósia 4 mármore 5 basalto 6 arenito
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

Classificação (resumo): acima de ~1500 m (ou 900 m íngreme) → picos nevados (T < −7,5), prado alpino (< 0,5 °C),
floresta nebular (trópicos úmidos); T < −13 manto de gelo; −13…−6 tundra / deserto polar; −6…2,5 taiga / tundra;
2,5…12 deserto frio / estepe / taiga / floresta temperada / úmida / charneca; 12…20 desertos / mediterrânea
(costas oeste 28–44°, inverno chuvoso) / estepe / floresta; ≥ 20 desertos / savana / floresta seca / floresta
tropical. Terras áridas altas com planalto → mesas e cânions. Planícies baixas planas e úmidas → pântano / brejo.

### Estações (para a fase de conteúdo)

`seasonZoneOf(tMédia, amplitude)` → 0 tropical (sem inverno) · 1 quente (inverno ameno, sem neve) · 2 temperado
(inverno como hoje) · 3 subpolar (inverno longo todo ano) · 4 polar (inverno eterno, walkers toda noite).
`climateAt(planet, x, y)` → `{ tMean, tAmp, precip }` de qualquer tile; `latitudeAt(y)` em graus (só exibição).

---

## 6. Tipos novos (a fase de conteúdo pinta)

**Chão** (`PG`): 0–7 = os `G.*` atuais com os mesmos números; novos: 8 `SNOW` neve · 9 `ICE` gelo · 10 `ASH` cinza
vulcânica · 11 `SALT` sal · 12 `CLAY` argila vermelha / laterita · 13 `DRY` chão seco (estepe, deserto, savana).
`GROUND_CLASSIC` dá o substituto atual de cada um (usado no `?planet=1`). O `worldgen.js` não foi alterado.

**Rocha**: 1–4 atuais + 5 basalto, 6 arenito (`ROCK_CLASSIC`: basalto → ardósia, arenito → calcário).

**Objetos que ainda não têm arte** (`NEW_KINDS`): árvores `tree_palm`, `tree_acacia`, `tree_baobab`,
`tree_jungle`, `tree_kapok`, `tree_mangrove` (em pé na água rasa, `w: 1`), `tree_spruce`, `tree_larch`,
`tree_redwood`, `tree_cypress`, `tree_olive`, `tree_fern`, `tree_dwarf`, `bamboo`; plantas `cactus`,
`cactus_tall`, `agave`, `shrub_desert`, `dead_bush`, `tussock`, `tundra_shrub`, `dune_grass`, `papyrus`,
`lichen_rock`, `termite_mound`; decoração `snowtuft`, `lichen`, `cottongrass`, `saltcrust`, `seaweed`, `coral`,
`ash`, `sandripple`. No `?planet=1` viram carvalho / pinheiro / bétula / arbusto de zimbro / pedregulho, e a
decoração nova some.

---

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

Celular: espere 3–5× mais (planeta ~6–10 s — faça em worker, uma vez por mundo, com barra de progresso).

---

## 10. Limitações conhecidas

- O clima é anual (médias + amplitude); monções e variação sazonal de chuva não existem ainda.
- A umidade anda linha a linha (ventos zonais); há uma difusão isotrópica fraca para costas norte / sul.
- Córregos em encostas uniformes ainda podem correr quase paralelos; os rios grandes formam árvores.
- Paredes de cânion e falésias são degraus de altura com rocha nas faces (1 tile); a forma final de penhasco é
  com o agente de relevo (`height` nos cantos).
- Vulcões não têm lava / atividade (só `active` nas `features`); recifes são só bioma + raso.
- Os nomes de continentes, oceanos e rios não existem ainda.
- Só foi comparado bit a bit em motores V8 (Node e Chrome); a matemática é toda exata, mas Firefox / Safari ainda
  não foram testados (compare a impressão digital em `tools/planet.html`).
