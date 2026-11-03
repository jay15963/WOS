# WOS — Mundo em pedaços (streaming do planeta)

O mundo deixou de ser um mapa de 256×256 em arrays inteiros. Agora é um **planeta de 16384 × 8192 tiles** (134 M tiles),
gerado, carregado, simulado, salvo e sincronizado **em pedaços** (chunks de 64 × 64). O mapa clássico de 256×256 continua
existindo como uma **fonte de mundo** encaixada na origem do planeta (`?source=classic`, o padrão), então todo o jogo e
os testes rodam no motor novo com as mesmas coordenadas de antes.

| Constante | Valor | Onde |
|---|---|---|
| `PW × PH` | 16384 × 8192 tiles (x dá a volta, y não: polos em 0 e PH − 1) | `src/world/store.js` |
| chunk | 64 × 64 tiles (256 × 128 chunks) | `CS`, `CW`, `CH` |
| balde de objetos | 16 × 16 tiles (1024 × 512 baldes) | `world.js` `CHUNK`, `BKW` |
| janela da GPU | 512 × 512 tiles (8 × 8 chunks) em volta da câmera | `terrainWindow.js` `WIN` |

## 1. Armazenamento (store)

`src/world/store.js`. Um tile é endereçado pelo **índice global** `i = y * PW + x` (cabe num int32). Toda camada por tile
(`w.rock`, `w.water`, `w.ground`, `w.solid`…) é um `Layer`: uma tabela de páginas por chunk (typed arrays de 4096
valores), então `get` / `set` são poucas operações de bits e duas leituras de array.

```js
w.rock.get(i)        // valor (o padrão da camada se o chunk não está carregado)
w.rock.set(i, v)     // escreve (carrega o chunk na hora se preciso)
w.rock.at(x, y)      // x dá a volta, y fora do planeta = padrão
w.idx(x, y)          // (y << 14) | (x & 16383) — SEMPRE use idx: nunca y * W + x com x fora de 0..W-1
w.roofs.data.get4(i, k) / set4(i, k, v)   // camadas RGBA (comps 4); getc / setc para qualquer número de componentes
```

Dois tipos de camada, mesma API:
- **por chunk** (vêm da fonte): `ground, water, rock, rock0, rockType, ore, roof, roof0, tramp, biome, fertile, lush, flowX,
  flowY, dWater, dRock, caveDk, rubble, hBase, hT, hC, wlevel, pground`. Ler um chunk não carregado dá o padrão (`rock` = 1: sólido, ninguém entra);
  escrever carrega o chunk sincronamente (`world.ensure(c)`) — a correção nunca espera um worker.
- **esparsas** (páginas só onde há algo): `solid, broof, deck, rail, railU, noGrow, path, pathPlan`, `height.plot`, a ocupação da navegação
  (`game.occ`), as grades dos andares (`levels.surf/blk/st/node`), telhados (`roofs.regionOf/caveOf/data`), caminhos
  (`_paths.data/cov/dir/preview`). `clear()` solta tudo; `forEach(fn(i, v))` percorre os não-zeros.

As chaves das grades de construção continuam `i + lv * W * H` (cabe: 134 M × 5 andares < 2³¹).

**A*** (`nav.js`, `levels.js`): sem arrays do tamanho do mundo — uma tabela de endereçamento aberto (`NodeTable`) indexada
pelo id do nó, zerada por carimbo.

**Alturas** (`src/world/heightPaged.js`, `PagedHeight` = `world.height`; o sistema em si: docs/TERRAIN-HEIGHT.md). Os
cantos são camadas do armazenamento: canto (x, y) = canto noroeste do tile (x, y), índice `w.idx(x, y)` (x dá a volta;
cada chunk guarda os seus 64 × 64 cantos, o 65º é o primeiro do vizinho):
- `hBase` (por chunk): o terreno gerado — os `heights` (65 × 65) que a fonte entrega com o chunk; nunca vai para a rede.
- `hT` (por chunk): o terreno com as edições dos jogadores; `hC` (por chunk): a superfície = max(`hT`, base dos prédios).
- `plot` (esparsa, −∞ = nada): a altura base dos prédios em cada canto.
- `edits` (Map canto → altura ≠ base): o **diff** das edições — `height.diff()` / `applyDiff()` vão na foto (`terr`), no
  save e para os convidados; um chunk editado fica alterado (nunca descarregado); ao (re)carregar um chunk as edições e
  bases dele são reaplicadas.

A **página fina** de um chunk (4 × 4 amostras por tile, com um anel em volta; inclinação e penhasco por tile) é uma função
pura dos cantos do chunk + 3 em volta (`computeFine`: o mesmo spline, limites e escarpas do `HeightLayer` — conferido igual
até o último bit). Normalmente quem a faz é o **worker da janela do terreno**, junto com o resto do chunk (~8 ms fora da
thread principal); a thread principal só calcula uma página quando alguém pergunta por um chunk fora da janela
(`heightAt`, `isCliff`). Uma página é `complete` se os 8 vizinhos estavam carregados; sem um vizinho, os cantos dele são
a borda do próprio chunk esticada (provisório: só muda a até 3 tiles da beira, nunca um penhasco falso), e quando ele
chega só as páginas incompletas caem; uma edição derruba as que alcança. Perto dos jogadores tudo está carregado (raio 3),
então o que eles pisam é exato e igual em todo par. Chunk com todos os cantos (e margem) zero = plano, sem
página. Mesma API do `HeightLayer`: `heightAt, gradAt, cornerH, terrainH, plotH, tileSlope, isCliff, tileMin, tileMax,
maxIn, cliffBetween, setTerrain, setPlots, diff, applyDiff` (+ `ci(ix, iy)` = índice do canto para os módulos de edição).
Sem alturas (`any` falso: o mundo clássico sem `?hills=1`) tudo devolve 0 / falso, como antes.

## 2. Fonte do mundo

`src/world/source.js` define o contrato: uma fonte é função pura de (semente, chunk) — o mesmo chunk em todo par.

```js
{ kind: 'classic' | 'synth' | 'planet', seed, wrap, bounds, spawn: {x, y}, zones: [],
  chunk(cx, cy, { decor }) → ChunkData,           // síncrono (fallback na thread principal)
  worker: { url, init } | null,                   // o mesmo gerador num Web Worker (chunkWorker.js)
  macro() → { w, h, rgba, tpp } | null,          // imagem grosseira do planeta para o mapa
  decor?(cx, cy), chunkOfId?(id) }                // decor tardio; o chunk de um objeto natural pelo id
ChunkData = { ground, water (0 terra · 1 raso · 2 fundo · 3 abissal), rock, rockType, ore, roof, tramp, biome, fertile :
  Uint8Array(4096); lush, flowX, flowY, dWater, dRock : Float32Array(4096); heights? : Float32Array(65²);
  objects: [{ id, type, x, y, v, s, f… }]; decor: [] | null }
```

- **classic** (`ClassicSource`): o gerador de sempre (`worldgen.js`, 256 × 256) roda inteiro (rios e distâncias são
  globais) e é servido em chunks; fora dele é rocha (a borda antiga). `wrap = false`, `bounds = {0,0,256,256}`: `inBounds`,
  extensões do mapa e regras de borda (`w.inside(x, y, m)`) são as antigas. Tudo carregado na partida (16 chunks).
- **synth** (`?source=synth`, `synth.js`): planeta sintético barato para teste de carga — continentes de ruído periódico
  (a costura do x fica sempre num oceano largo), mares polares, cordilheiras, biomas por latitude / altura / umidade,
  árvores e plantas; ~6–8 ms por chunk num worker.
- **planet** (`?source=planet` ou `?planet=1[&px=&py=]`, `planetSource.js`): o gerador real (`src/world/planet`,
  docs/PLANET.md). `generatePlanet(seed)` (~1,9 s) roda uma vez num worker (`planetWorker.js`, começa junto com a carga dos
  gráficos); a thread principal fica com o objeto (spawn por `findSpawn`, imagem do mapa por `renderMacro`, fallback
  síncrono) e o manda (arrays, ~13 MB) para cada worker de chunks no `init`; cada chunk
  é `generateChunk(planet, cx, cy, { decor })` (~40 ms no worker) adaptado: chão 8–13 e rochas 5–6 → os clássicos
  (`GROUND_CLASSIC` / `ROCK_CLASSIC`), bioma → a sua classe clássica (`BIOME_LIST[b].cl`), árvores / plantas novas → arte
  existente (a mesma tabela de `planet/ingame.js`), `lush` 0..255 → 0..1, posições do chunk → do planeta, `height`
  (65 × 65) → `hBase` (a água dobrada no nível dela: `wlevel`), decor no máximo ~1600 por chunk. Ids naturais do planeta: `(cy·256 + cx)·16384 + k`.

Água abissal (3) vira 2 (fundo) para o jogo ao instalar o chunk. Ids de objetos naturais por chunk: `1e7 + c·8192 + k`
(synth) / `c·16384 + k` (planet) → `chunkOfId` carrega o chunk de um objeto citado numa op ou num save.

## 3. Ciclo de vida dos chunks

`world.ensure(c)` (síncrono) / `world.install(c, data)` (resultado de worker) / `world.evict(c)`.

- Instalar: anexa as páginas, copia `rock`/`roof` (as originais ficam em `rock0`/`roof0`), insere objetos (com `solid` de
  `NATURAL_SOLID`) e decor nos baldes, conta a população por balde (alvos de rebrota) e chama `world.onLoad` (flora,
  ocupação da navegação, geradores de criaturas, janela da GPU).
- **Alterado** (`world.markDirty`): minerar, pôr / tirar objeto, mexer num natural (`touch`), editar alturas. Um chunk
  alterado **nunca é descartado** (o estado dele só existe aqui; o save / o snapshot guardam os diffs). Chunks só
  naturais são descartados longe de todos e voltam idênticos da fonte.
- Decor (grama, flores) é cosmético e pesado: só existe a até `R_DECOR = 3` chunks da câmera, largado longe
  (`dropDecor`) e refeito por um worker quando a câmera volta.

## 4. Streamer e regiões ativas

`src/world/streamer.js` (só em mundos que dão a volta; o clássico está todo carregado).

Âncoras (a cada quadro, `streamerSystem`): o anfitrião usa todos os jogadores (o seu + os avatares remotos), um convidado
só o seu; os dois somam a câmera. Em volta de cada âncora:

| raio (chunks) | efeito |
|---|---|
| `R_ACT = 2` | **ativo**: criaturas, geradores, rebrota rodam ali (`streamer.isActive(c)` / `activeAt(x, y)`) |
| `R_LOAD = 3` | carregado (workers, mais perto primeiro; a janela da GPU pede os dela) |
| `R_KEEP = 5` | fica carregado; além disso é descartado (não alterado, até 16 por quadro) |
| jogador | o chunk em que ele está, e um vizinho a < 10 tiles, saem síncronos se o worker atrasar |

Sistemas com região ativa:
- **Rebrota** (`flora.js`): registros por balde de 16×16 (`F.chunks` = Map por índice de balde, `F.keys`), criados quando o
  chunk carrega e soltos quando sai; a volta passa só nos baldes ativos, as visitas de cada segundo espalhadas pelos
  quadros (≤ 2 por quadro).
- **Criaturas** (`mobs.js`): no planeta os geradores são feitos **por chunk** quando ele carrega no anfitrião (layout
  determinístico, rng do próprio chunk), só enchem a matilha com o chunk ativo, e saem com o chunk (as criaturas fora de
  combate também). Criaturas longe de todos já dormiam (`SLEEP`). O mapa clássico mantém o layout antigo.
- Plantações / corpos / mudas dependem do tempo do mundo (`born` + `worldTime`): continuam certos quando a região volta.

## 5. Render: janela da GPU

`src/world/terrainWindow.js` + `terrainFill.js` (puro) + `terrainWorker.js`.

Nenhuma textura do tamanho do mundo. Cada textura por tile que os sombreadores leem é um **anel** de 512 × 512 tiles em
volta da câmera: o tile (x, y) mora no texel (x mod 512, y mod 512) e as texturas usam `REPEAT`, então o sombreador lê
`wp / uWorld` (com `uWorld = 512`) e `texelFetch(…, c & 511)` sem saber onde a janela está — nem a costura do planeta
(16384 = 32 × 512) precisa de nada.

Canais: `tile` (1×), `field2` (1×), `field` (4×), `cave` (1×), `clim` (1×) — calculados juntos por `computeTerrain` a
partir das camadas do chunk + 12 tiles de margem (`gatherTerrain`, cópias de página) — mais os registrados por outros
módulos com o seu `fill`: `roof` (renderer, de `game.roofs.data`), `path` e `pathCov` (2×) (`paths.js`).

- Chunks que entram na janela vão para o worker (os mais perto primeiro, 3 em voo); só o chunk sob a câmera (e a janela
  inteira no aquecimento) é feito na hora. Um slot à espera fica zerado (chão liso), nunca com os texels do chunk antigo.
- Edições (`world.dirty`, `caveDirty`, telhados, caminhos, `syncSolid`) recalculam só o retângulo (thread principal).
- Um chunk que chega recalcula os vizinhos na janela (as margens dele).
- `R.coldAt(x, y)` lê a cópia da CPU do canal `clim` dentro da janela.
- **Alturas** (docs/TERRAIN-HEIGHT.md): quatro canais a mais — `hgt` (4×, R32F: a superfície fina, geometria exata nos
  vertex shaders), `hgtG` (4×, RGBA16F: gradiente + altura), `hgtC` (1×, R32F: cantos) e `hgtK` (1×, RGBA8: inclinação,
  base de prédio, edição, nível da água perto). O worker manda `hgt` / `hgtG` e a página fina do chunk junto com o resto;
  `hgtC` / `hgtK` são feitos na thread principal (≤ 0,3 ms por chunk). A malha 3D (faixas instanciadas) cobre a vista em
  coordenadas de tile sem limite de mundo (o planeta dá a volta; um mundo limitado guarda a borda + 8) e lê os anéis com
  máscara (`& (tamanho − 1)`).

**Costura e precisão**: posições ficam canônicas (0 ≤ x < W: `moveCircle`, o laço do jogo, o barco); distâncias usam
`w.dx(a, b)` (`query`, colisões, jogadores, interesse da rede, A*); a câmera segue **contínua** (pode sair de 0..W ao
cruzar a costura, sem salto no ruído dos sombreadores); `game.screenToWorld` devolve x canônico. Todo vertex shader passa a
diferença para a câmera por `cw()` (a imagem do ponto mais perto da câmera) e `game.render` desloca por uma volta o que
está do outro lado da costura enquanto desenha. Os sombreadores trabalham em highp (o `vW` dos sprites passou a highp).

## 6. Mapa e minimapa

`src/ui/minimap.js`: um anel de 1024 × 1024 tiles (1 px / tile) com os chunks em volta do jogador, rasterizados quando
carregam (um por quadro); o mapa grande desenha a imagem grosseira do planeta (`source.macro()`) por baixo e os chunks
descobertos por cima, com **zoom** (roda / botões + −) e **arrastar**; "Centrar" volta ao jogador. No mundo clássico o mapa
grande continua mostrando o mapa inteiro.

## 7. Save

Save **v10** (`save.js`): semente + configurações + só o que mudou (objetos tirados / tocos, flora nova, estruturas,
tiles minerados — índices do planeta —, edições do terreno (`terr`: canto → altura, só os cantos editados) e alturas base
dos prédios (`bzs`), caminhos como corridas esparsas `{ s: 2, g, p }` de `[início, n, valor]`,
plantações, corpos, saque, andares, barcos…) + o jogador; `src` = a fonte do mundo (o `main.js` abre um mundo salvo com a
fonte dele). Saves antigos (índices de 256 de largura) não são lidos: são apagados com um aviso ("Este mundo era de uma
versão antiga…") e um mundo novo nasce da mesma semente.

## 8. Multijogador

- `welcome.src` leva a fonte do anfitrião; o convidado gera o terreno localmente da semente (nada de dados de tiles na
  rede). `PROTO = 6`.
- Snapshot de entrada / ressincronização = os mesmos diffs do save (nunca o mundo inteiro). As alturas geradas nunca vão
  pela rede (o convidado as gera); só o diff das edições (`terr`) e as bases dos prédios; a op `terrain.set` muda poucos
  cantos e carrega o chunk deles se preciso (como as outras ops).
- Entidades: o fluxo de 10 Hz já era por interesse (caixa em volta de cada convidado) — agora atravessa a costura.
- A foto de entrada carrega o chunk de cada flora nova / construção antes de conferir o terreno dela (quem entra longe do
  anfitrião não perde nada).
- Ops continuam globais e pequenas (uma por ação). Uma op sobre um chunk que o convidado não tem (um objeto natural, um
  tile) carrega esse chunk na hora (`findObj` → `chunkOfId`, `Layer.set` → `ensure`), então todo par aplica igual.
- Digest: `rock` / `roof` são comparados só nos chunks com tiles minerados (o resto é a fonte pura); as camadas esparsas
  pelos não-zeros.
- **A fazer** (interesse por chunk dos diffs): filtrar o snapshot e as ops pelos chunks em volta de cada convidado e
  mandar o diff de um chunk quando ele entra no interesse (e o digest por conjunto de interesse). Hoje o volume é
  limitado pela atividade dos jogadores, não pelo tamanho do planeta.

## 9. Desempenho (medido)

Chrome headless (SwiftShader: GPU por software), `?source=synth&dev=1`, este PC. Tempo de CPU da thread principal por
quadro (`game.frameStats()`: update + render), resultados de worker medidos à parte:

| Cenário | média | p95 | máx | quadros > 8 ms |
|---|---|---|---|---|
| synth: andando a 9 tiles/s por 20 s (8 chunks/s gerados) | 1,1 ms | 1,7 ms | 4,6 ms | 0 |
| planet: andando a 9 tiles/s por 15 s (~13 chunks/s gerados) | 0,8 ms | 1,5 ms | 5,9 ms | 0 |
| synth: 4 jogadores longe uns dos outros (232 chunks, 100 ativos) | 0,7 ms | 1,0 ms | 2,6 ms | 0 |
| synth: 4 teletransportes pelo planeta | 0,8 ms | 1,4 ms | 24,6 ms | 5 (no teletransporte) |

- Geração de chunk no worker: synth 6–8 ms, planet ~40–45 ms (3 workers); instalar o resultado na thread principal:
  ≤ 6,2 ms (objetos + decor + ganchos); conteúdo da janela no worker ~4,4 ms/chunk, envio às texturas ≤ 2,4 ms.
- Memória com 4 jogadores longe: camadas de tiles 30 MB, ~32 mil objetos, heap JS ~95–110 MB, janela da GPU 24,5 MB.
- Partida (parte do mundo: fonte + chunks + sistemas, sem os gráficos; `window.wosWorldMs`): clássico ~0,6 s (gerar o mapa
  ~0,4 s, como antes), synth ~0,3 s, planet ~1,3 s (o planeta macro no worker em paralelo com os gráficos). O total em dev
  é dominado pela pintura do atlas (sem cache em localhost; em produção o atlas vem do IndexedDB).
- Mundo clássico: 16 chunks (+ rocha em volta para a janela), camadas ~7 MB; `get` de camada ~4 ns.
- **Com alturas** (planeta, `?source=planet`): andando a 9 tiles/s por 15 s → média 1,2 ms, p95 1,9 ms, máx 6,3 ms,
  0 quadros > 8 ms. Página fina: ~7–8 ms por chunk (no worker: 26 de 32 páginas na caminhada; as da thread principal eram
  oceano plano, 8 ms ao todo). Memória: páginas finas ~0,26 MB por chunk com relevo (~17 MB com ~70 chunks); janela da GPU
  74,5 MB (24,5 MB sem as alturas: `hgt` 16 MB + `hgtG` 32 MB + `hgtC` / `hgtK` 2 MB). `?hills=1` no clássico: idêntico
  ao protótipo (mesmos números de `heightAt` / penhascos).
- Medir: `game.streamStats()` (HUD de streaming, ligado em localhost no planeta ou com `?stream=1`), `game.frameStats(reset)`,
  `game._prof = new Map()` (o sistema mais lento por quadro), `game.debug.bench(n)`.

## 10. Ferramentas de dev

- Cenário **ST1** (`tools/mp-test.html?run=ST1`): anfitrião no planeta sintético, convidado gera os mesmos chunks, o
  anfitrião muda um chunk a 3000 tiles (o convidado o carrega sob demanda), os dois cruzam a costura, digest igual.

- Cenário **ST2** (`?run=ST2`): anfitrião no planeta real, o convidado gera as mesmas alturas (heightAt / penhascos
  iguais), o anfitrião levanta cantos do terreno longe (op `terrain.set`): o convidado carrega o chunk sob demanda e fica
  igual; um segundo convidado que entra depois recebe as edições na foto (`terr`); digests iguais.

- `?source=classic|synth|planet` · `?stream=1` (HUD) · `game._extraAnchors = [{x, y}]` (simula jogadores longe).
- `world.stats` (gerados síncronos / assíncronos, tempo de instalar), `world.streamer.stats`, `R.win.stats`.

## 11. Limitações conhecidas / próximos passos

- Interesse por chunk dos diffs no multijogador (§8).
- No planeta sintético não há acampamentos de saqueadores, rebanhos nem cardumes (os geradores deles ainda são do mapa
  inteiro); o gerador real do planeta deve trazer as zonas.
- Chunks alterados ficam na memória até o fim da sessão (o save os guarda como diffs); um próximo passo é descarregá-los
  serializando o diff.
- Distâncias de muitos sistemas cosméticos ainda usam `x − x'` direto: só erram exatamente na costura (oceano abissal).
- Alturas: uma edição (cavar, aterrar) recalcula na thread principal as páginas finas que alcança (~8 ms por chunk, 1–4
  chunks); poderia ir para o worker como os chunks novos. Os 50 MB de GPU das alturas podem cair (ex.: `hgtG` em RG16F
  + altura do `hgt`) se o celular apertar.
