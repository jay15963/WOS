# Relevo: terreno com altura (protótipo)

Pedido do dono: o mundo vira um planeta realista (cordilheiras, cânions, falésias, planaltos, vales) e o chão deixa de ser
plano. Direção escolhida com o dono: **terreno 3D de verdade, liso (estilo Valheim), não blocos em degraus** — morros e
vales contínuos, chão inclinado onde não é penhasco, penhascos como faces de rocha íngremes e ásperas que se fundem às
encostas. Depois o dono pediu também **mexer no terreno** (cavar / aterrar / aplanar / suavizar) e **construir no
relevo** (a casa fica numa base nivelada, com fundação).

Estado: protótipo completo atrás das bandeiras de teste `?hills=1` (a vitrine) e `?planet=1` (um recorte do gerador do
planeta: as alturas de verdade dele, `world.heightStories`), só em localhost. **Sem bandeira o mundo é plano e tudo
roda exatamente como antes** (todas as alturas 0: nenhum gancho roda, o terreno continua sendo um triângulo de tela
inteira).

Código: `src/world/height.js` (dados e regras), `src/world/hills.js` (a vitrine `?hills=1`), `src/engine/shaders.js`
(`HGT_FN`, `TERRAIN_VS`, terreno: faces de rocha / terra / fundação, sombras do relevo), `src/engine/renderer.js`
(texturas de altura, malha), `src/game/mut/terrain.js` (edições compartilhadas), `src/game/terrain.js` (bases das
construções, ferramenta, subida mais lenta), ganchos de uma linha marcados "terrain height" em `game.js`, `physics.js`,
`combat.js`, `levels.js`, `projectiles.js`, `mut/structures.js`, `building.js`, `snapshot.js`, `ui/panels.js`.

---

## 1. Os dados (`src/world/height.js`, uma camada só)

| Nome | O que é |
|---|---|
| unidade | **andares** (1 andar = 1 tile para cima na tela, a mesma unidade dos andares construídos, `STORY_H`) |
| cantos | `(W + 1) × (H + 1)` floats: o canto `(ix, iy)` é o canto do tile no mundo `(ix, iy)` |
| `base` | o terreno gerado (da semente: nunca é enviado pela rede) |
| `t` | o terreno com as edições dos jogadores (cavar / aterrar / aplanar / suavizar, penhasco cortado) |
| `plot` | a base das construções em cada canto (derivada das estruturas em todo par) |
| `c` | a superfície em que tudo pisa: `max(t, plot)` |
| água | onde há água a superfície **é a água**: os cantos que tocam um tile de água sobem até o nível dela (`foldWater`: o mar em 0, um lago num planalto no nível dele, `gen.wlevel` do planeta) — o fundo não é desenhado, quem nada boia na superfície |
| `f` | a superfície fina: 4 × 4 amostras por tile, `(4W + 1) × (4H + 1)` — o que é desenhado e o que `heightAt` lê |

**Superfície lisa.** Cada amostra fina vem de um spline Catmull-Rom sobre os cantos (uma rampa uniforme continua plana,
morros e vales arredondados), **presa perto dos cantos em volta** (sem estouro: o chão ao lado de um penhasco continua
plano, a água fica no nível do mar; 20 % de folga para curvas suaves não virarem patamares) e **áspera onde é íngreme**
(ruído escalado pela inclinação do próprio spline: zero no chão suave, rochas e borda irregular no penhasco). A
superfície fina é função pura dos cantos: reconstruir só um pedaço dá os mesmos números de uma reconstrução inteira (todo
par concorda, em qualquer ordem que tenha recebido as edições). Cada célula fina vira dois triângulos cortados na diagonal
cujas pontas diferem menos (`triH`): uma borda em qualquer direção fica uma linha limpa, nunca um serrote. **CPU e GPU usam
a mesma regra** (`height.js triH` = `shaders.js HGT_FN` / `TERRAIN_VS`): pés, profundidade e toque concordam exatamente.

**Acessores** (nada de array fora deles — no motor de streaming a camada é paginada por pedaço: `world/heightPaged.js`, docs/STREAMING.md §1):
`world.heightAt(x, y)`, `cornerH(ix, iy)`, `tileSlope(tx, ty)` (o triângulo fino mais íngreme do tile, andares por tile),
`isCliff(tx, ty)`, `cliffBetween(ax, ay, bx, by)`, `world.hasHeight`; na camada: `gradAt`, `tileMin / tileMax`,
`maxIn(rect)` (o mais alto em blocos de 16 tiles: recorte da vista), `terrainH / plotH`, `setTerrain(list)`, `diff()` /
`applyDiff(d)`, `setPlots(map)`. `groundZ(x, y)` (a camada do mundo em jogo) serve quem só vê entidades (`levels.js`).

**Penhasco** = tile com `tileSlope > WALK_MAX` (0,75 andar por tile, ~37°): bloqueia como rocha (física, A*, construção),
desenhado como face de rocha. Em `heightAt` um tile de penhasco é a própria face (a superfície desenhada); ninguém fica em
cima dele (bloqueia), mas tiros e linha de visão passam por cima / batem nele pela altura.

---

## 2. Escala visual (a decisão)

**1 andar = 1 tile para cima na tela, igual aos andares construídos.** Assim um penhasco de 2 andares tem exatamente a
altura de uma parede de 2 andares, quem está no topo de um morro e quem está numa muralha usam o mesmo `z`, o bônus do
arco por altura vale para os dois, e as escadas / rampas ligam terreno e andares sem conversão.

**A escala do relevo é a do gerador do planeta** (escolha do dono: a primeira vitrine, com penhascos de 4–6 andares e um
pico de 17, ficou "muito exagerada"; o relevo do planeta é o alvo): `metersToStories` (`src/world/planet/consts.js`) dá
280 m → 2, 1000 m → 5,1, 6000 m → 15,6, 8800 m → 19,5 andares, e o relevo local fica moderado — morros de 1–2 andares,
penhascos / paredes de cânion / falésias de 1–3, planaltos de 2–3, cordilheiras de 8–15 acima dos vales mas com encostas
largas. A vitrine `?hills=1` foi refeita nessa escala.

| Feição (alvo) | Altura (andares) | Inclinação |
|---|---|---|
| morros ondulados | 0–2 | ≤ 0,4 / tile |
| encosta caminhável | — | ≤ 0,75 / tile (acima disso vira cascalho, depois rocha) |
| penhasco / falésia / parede de cânion | 1–3 de uma vez | ≥ 1 / tile (a face toma ~1–2 tiles) |
| planalto | 2–3 acima do redor | borda íngreme, rampa ≤ 0,5 / tile |
| montanha | 8–15 acima da planície, base larga (25–40 tiles) | média ≤ 0,6 / tile, coroa íngreme |
| neve | no `?hills=1` acima de 9 (`SNOW_LINE`); no planeta, o chão de neve / gelo do próprio clima (`planetGround`) | — |

A projeção é oblíqua (a câmera olha a 45°): uma encosta **virada para a câmera** aparece esticada (dá para ver a face do
penhasco), uma **virada para longe** fica achatada e, passando de 45°, some atrás do topo — como a face norte de uma parede.
Girando a câmera (`game.cam.rot`) o jogador vê os outros lados. O desenho aguenta ~25 andares sem mudança (a grade cresce
na direção da câmera pelo mais alto do terreno em volta).

## 3. Desenho

- **Malha 3D do terreno** (`TERRAIN_VS`): só quando há relevo. A grade fina em volta da vista (aprofundada na direção da
  câmera pelo mais alto do terreno ali: chão alto abaixo da tela entra na tela), em faixas instanciadas (uma por linha
  fina, a mais perto da câmera primeiro), 6 vértices por célula de `gl_VertexID`, cantos levantados reto na tela pela
  altura, **profundidade d = y de vista + altura** (a mesma do resto do jogo). O terreno **escreve a profundidade**: morros
  escondem o que está atrás; decalques, pisos, sombras de contato e grama só testam; sprites e faces testam e escrevem
  como antes. Sem relevo: o triângulo de tela inteira de antes.
- **O mesmo shader de terreno** (`TERRAIN_FS`) com a posição do mundo vindo da malha: texturas, grama, caminhos, água,
  margem, neve, estações, luz, luzes da noite, tudo como antes, sobre a superfície.
  - **Sombreamento liso** pelo gradiente da superfície fina (`uHgtG`, RGBA16F linear: normais suaves, sem facetas).
  - Chão íngreme mas caminhável vira **cascalho / terra nua**; mais íngreme vira **rocha** pelo campo suave de
    "íngreme aqui" por tile (`uHgtK`, linear: sem piscar célula a célula).
  - **Faces de rocha** (`cliffRock`): a rocha regional (camadas 8–11, misturadas entre os tiles: sem emenda onde o tipo de
    rocha muda) projetada nos dois planos verticais (triplanar), faixas largas de estratos com tons próprios, veios de
    escorrimento, rachaduras verticais, mais escuro no pé, a borda de cima pegando luz, musgo embaixo em faces úmidas
    (exuberância), neve na borda / saliências acima da linha de neve, luz pela normal da própria face.
  - **Faces de terra** (`earthFace`): onde os jogadores cavaram / aterraram, o barranco é terra em camadas com pedrinhas
    e raízes, não rocha.
  - **Fundação** (`masonry`): os lados íngremes do platô de uma construção são fiadas de pedra com argamassa.
  - **Neve** acima de `SNOW_LINE` com borda ruidosa (agarra no chão suave, some na rocha íngreme); **água deitada no nível
    dela** (nunca numa face íngreme nem acima da água vizinha: `uHgtK.a` = o nível d'água mais alto em 3 tiles).
  - **Leitura do relevo**: luz direcional forte pela normal lisa + **curvatura** (~1,6 tile): fundos de vale e grotas mais
    escuros, cristas e lombadas mais claras (uma borda clara nas cristas), sombras do relevo com o sol baixo.
  - **Rocha**: sulcos e costelas descendo a face (o ruído da aspereza é esticado ao longo da encosta), faixas de estrato
    largas com cores próprias (ocre / cinza-azulado), saliências (topo claro, sombra embaixo, musgo / capim nelas onde é
    úmido), pé mais escuro com blocos caídos, e **tálus** (pedras soltas) no chão suave ao pé dos penhascos.
  - **Maciços de rocha** (os tiles de rocha de antes): com relevo viram **morrotes rochosos** de verdade (vitrine: os cantos
    de dentro sobem com a profundidade na rocha; planeta: a altura dele), desenhados com a rocha das faces, sem o anel
    preto; minerar um tile corta o morrote até o canto mais baixo do tile (corte a céu aberto, em todo par).
  - **Sombras do relevo**: marcha em direção ao sol sobre a superfície (o raio sobe 1 / |shadowDir| por tile): morros e
    penhascos fazem sombra no chão, na mesma direção das sombras dos sprites.
  - **Recorte em volta do jogador**: o terreno na frente dele (morro, parede de cânion, borda de buraco) abre no mesmo
    pontilhado das estruturas (`cutOpen`), mostrando o jogador e o chão onde ele pisa.
- **Tudo em pé no chão**: os sprites (personagens, bichos, árvores, grama, itens, corpos, partículas, luzes, sombras de
  contato, decalques) são levantados **na GPU** pela altura do chão no ponto de referência (o pé: `aDepth.xy`) —
  `SPRITE_VS` / `SHADOW_VS` / `DECAL_VS` chamam `groundH`; as peças desenhadas como faces (paredes, móveis, telhados…)
  recebem a altura do chão sob a peça na CPU (`Z.g` por desenhável, `FaceBatch` soma em cada vértice). Sombras do sol caem
  sobre o relevo (cada vértice da sombra no chão onde cai). Andares construídos continuam `lv · STORY_H` acima da base.
- **Câmera e toque**: a câmera segue o jogador pela altura dele; `screenToWorld` acha o chão visível ao longo do raio
  (marcha de cima para baixo + bisseção); `worldToScreen(x, y, h)` soma o chão (plaquinhas, números). A luz ambiente
  (escuridão de caverna, interiores) acha o ponto do chão por 4 passos de ponto fixo.

### Desempenho

`game.debug.bench(150)`, Chrome headless (SwiftShader), 1264 × 625, qualidade alta, perto do cânion:

| | giro 0 | giro 0,7 |
|---|---|---|
| plano (sem `?hills`) | GPU 0,65 ms · CPU render 0,5 ms | GPU 1,12 ms · CPU 1,0 ms |
| relevo (`?hills=1`, versão final) | GPU 0,94 ms · CPU 0,5 ms | GPU 1,37 ms · CPU 1,1 ms |

(Medido no fim, num relevo mais calmo e com todos os detalhes: no SwiftShader as diferenças ficam perto do ruído.) A
malha tem ~18–22 mil células finas no zoom padrão (só um `texelFetch` por vértice — 4 por célula —, nenhum trabalho de
CPU por quadro). Memória: superfície fina R32F + gradiente RGBA16F ≈ 12,6 MB num mapa 256² (no motor de streaming:
anéis de 512 tiles em volta da câmera, docs/STREAMING.md §5).

---

## 4. Regras de jogo

- **Andar**: penhascos bloqueiam como rocha (física, criaturas, A*: `world.blocked` / `tileBlocked`). Subindo é mais
  lento (até −38 % numa encosta no limite), descendo um pouco mais rápido (`terrain.js slopeSpeed`: o jogador e as
  criaturas — `ai.js go`). **Pular barranco**: descer um degrau de até ~1 andar empurrando a borda (§13); nunca subir.
- **Profundidade**: quem está atrás de um morro some atrás dele; o recorte abre o morro em volta do jogador local.
- **Linha de visão** (`combat.hasLOS` → `terrainLOS`): a linha entre os peitos fica acima do chão; um morro ou a borda de um
  penhasco entre os dois bloqueia ataques à distância e aggro por visão.
- **Projéteis**: a linha do tiro vai do chão sob o atirador ao chão sob o ponto mirado (cada par deriva os dois chãos, nada
  muda na rede); a encosta para a flecha (crava no chão); acerto pela altura absoluta. Arremessos (lob) idem.
- **Arco**: o bônus de alcance por altura (+20 % por andar, até +100 %) conta **a altura do chão também** (`heightK`): do
  alto de um morro ou de um penhasco o arco alcança mais. Corpo a corpo só entre alturas parecidas (diferença de chão
  < 1,2 andar: não atravessa um penhasco).
- **Construir**: recusado em penhasco ("Penhasco: não dá para construir aqui"); a casca de uma casa (paredes, portas,
  pisos, escadas) recusa chão desigual demais ("Terreno muito íngreme: aplane primeiro (Construir → Terreno)", variação
  > 1,5 andar sob a peça). Ver "Construir no relevo".
- **Minerar penhasco**: a picareta na face de um penhasco / planalto / maciço de rocha **a partir do chão** cava um
  **túnel** para dentro do relevo (§10); a pá (§12) abre cortes a céu aberto. Um tile de rocha mais baixo que um andar
  acima de quem minera continua virando chão (corte), como antes.
- **Multijogador**: as alturas geradas vêm da semente (nada a sincronizar); as edições e as bases são estado compartilhado
  (abaixo); `z` das entidades continua o de antes (andar acima do chão), replicado como hoje.

## 5. Mexer no terreno (Valheim)

**A pá** (§12; E / Usar com ela na mão, ou Construir (B) → aba **Terreno**, só num mundo com relevo): **Cavar** (abaixa o
chão sob o cursor; dá terra, pedra de rocha ou de chão pedregoso), **Aterrar** (levanta; gasta 1 Terra por vez),
**Aplanar** (leva o chão para a altura do primeiro ponto clicado, em quartos de andar), **Suavizar** (arredonda degraus e
buracos). Clique / toque aplica o pincel (raio 1,6 tile, suave) no cursor; segurar continua aplicando (~4 por segundo,
mais rápido com pá melhor); R troca o modo; Esc / botão direito sai. Precisa de uma **pá**; **criativo: grátis e em
passos maiores**.

- Passo: 0,25 andar no centro do pincel (0,5 no criativo); limites: no máximo 4 andares abaixo / acima do terreno gerado,
  nunca abaixo do nível do mar.
- Recusas (motivo na tela e na prévia): construção no pincel ("o terreno embaixo dela não muda"), água ("não dá para
  mexer na margem"), rocha ("use a picareta para minerar"), túnel a até 2 tiles ("o teto e as paredes dele não mudam"),
  longe demais (4,5 tiles), fundo / alto demais.
- A grama, as flores e as pedrinhas de enfeite somem do chão cavado / aterrado (todo par, cosmético: também quando o
  pedaço volta da fonte — `terrain.js hideDugDecor`).
- **Rede**: intent `terrain.edit {m, x, y, h?}` → o anfitrião roda o pincel (`terrainBrush`) e emite **op `terrain.set
  {p: [canto, altura × 100, …]}`** com as alturas **absolutas** dos cantos mudados (os convidados não recalculam pincel
  nenhum). Terra / pedra cavadas chegam como efeito de dono (`give`); a terra do Aterrar sai da mochila antes do pedido e
  volta se for recusado.
- **Salvar / entrar na partida**: seção `terr` do snapshot (= o mundo do save) = `world.height.diff()` — a lista compacta
  `[canto, altura × 100, …]` dos cantos diferentes do terreno gerado (um formato só, num lugar só: a engine de streaming pode
  guardar a mesma lista por pedaço). `applyDiff` devolve ao gerado o que não está na lista.

## 6. Construir no relevo (base + fundação)

- A **casca** de um prédio (paredes, portas, pisos, escadas: `ON_PAD`) tem uma **base** `o.bz` (andares): o andar 0 fica
  nela, não no nível do mar. Ao colocar, o jogo propõe a base = **o ponto mais alto do terreno sob o lote, arredondado para
  cima em 0,25** (nada fica enterrado) — ou **a base de uma peça vizinha** (paredes / pisos encostados) quando ela não é mais
  baixa que o chão: as paredes de uma casa se alinham. Um lote (arraste) inteiro usa uma base só.
- **Fantasma**: a peça aparece na base proposta, com paredes translúcidas do chão até ela (a fundação que vai surgir).
- **Platô**: cada peça com base levanta os cantos do seu pé até a base (`terrain.js` deriva `plot` das estruturas em todo
  par, também das plantas). Então pisos, móveis, gente, itens e corpos numa casa em encosta ficam num nível só, e o chão em
  volta vira um **aterro** (encosta suave, caminhável até 0,75 / tile) ou, onde fica íngreme, uma **fundação de pedra**
  (fiadas desenhadas pelo shader nos lados do platô). Um degrau alto no lado de baixo bloqueia como penhasco: a porta de
  baixo precisa de rampa (Aterrar) ou escada.
- **Andares**: `bz + lv · STORY_H` (o `levels.js` continua igual: o chão sob quem está numa casa já é a base; escadas, A*,
  recorte, telhados, revelar funcionam sobre ela). Móveis e luzes ficam no chão onde estão (num piso: o platô do piso).
- **Rede**: `struct.add {…, bz: base × 100}` (o lote todo), seção `bzs: [[id, base × 100]]` do snapshot / save.

## 7. A vitrine `?hills=1` (`src/world/hills.js`)

Molda o mundo gerado (feita para a semente 4242, funciona em qualquer uma) antes de montar o `World`: morros ondulados em
volta do início; **planalto** de 4,5 andares cercado de rocha íngreme com uma **rampa** subindo pelo leste; **cânion** em
volta do rio a leste (fundo 0 com o rio, paredes de ~5,6); **falésia** de 3,6 sobre um **mar** novo a sudoeste; **vale**
com o lago a noroeste (anel de morros de 3,4); **montanha** a sudeste (pico ~17 com coroa rochosa, cristas e grotas, neve
acima de 9). Nada fica em penhasco / no mar / acima da linha das árvores. Pontos em `game.world.hills` (`plateau`, `ramp`,
`rampTop`, `lake`, `mountain`, `coast`, `canyon`). Cada par que abre o mundo precisa da bandeira (é só de teste).

Capturas em `shots/height_<feição>_<ângulo>.png` (0°, 45°, 135°, 180°): `plateau`, `canyon`, `coast`, `hills`, `peak`,
`ramp` e `slope` (o jogador subindo encostas), `ridge` (o jogador no fundo de um buraco cavado, escondido pela borda: o
recorte abre), `ridgecanyon` (90° / 270°: a parede do cânion entre a câmera e o jogador), `night`, `dig`, `flatten`,
`foundation`; e do **planeta de verdade** (`?planet=1&seed=4242&px=…&py=…`, lugares achados por
`node tools/planet-shots.mjs 4242 <pasta> auto`; câmera virada para a maior face da janela, `_a` de frente, `_b` +45°,
`_c` −45°, `_d` de trás): `height_planet_mountains_*` (cordilheira com o rio na garganta, 10288, 2256),
`height_planet_canyon_*` (15024, 5712), `height_planet_cliffs_*` (falésia costeira, 6768, 3888), `height_planet_volcano_*`
(chão vulcânico, 5104, 3472).

## 8. Para o gerador do planeta

- Já ligado: com `?planet=1` o `World` lê `gen.heightStories` (`(W + 1) × (H + 1)`, andares) e `gen.wlevel` (nível da
  superfície da água por tile): lagos e rios em altitude ficam no nível deles. Tudo o mais (superfície fina, penhascos,
  desenho, regras) sai daí. A engine de streaming pode entregar o mesmo array por pedaço.
- **O que se viu** (semente 4242, janelas de 256): alturas 0–14,5 por janela, encostas suaves, paredes de cânion e
  falésias de 1 tile (degraus de 1–1,5 andar; o maior degrau achado: 1,3 na janela das montanhas, 1,4 nas falésias). O
  dono prefere esta escala: **manter `metersToStories` como está**. Com relevo, os tiles de rocha (`rock = 1`) do planeta
  são desenhados como a rocha do relevo (sem os decalques de minério / cascalho do mundo plano); continuam não
  caminháveis — para montanhas que se escalam, rocha só nos afloramentos / faces e chão de pedra / cascalho nas encostas.
- **Chão do planeta**: `planetGround` CINZA (10) vira basalto / cinza escuros; NEVE (8) / GELO (9) viram neve (o clima
  do planeta decide a neve; a linha de neve por altura fica só na vitrine).
- **Água**: classes 1 raso / 2 fundo / 3 abissal nos tiles; o nível em `wlevel` (o mar em 0). Cachoeiras (`features`)
  hoje aparecem como uma face de rocha entre os dois níveis (ver "Falta").
- **Escala**: seguir a tabela da seção 2 (relevo local ≤ ~8 andares por tela; penhascos 2–6 andares de uma vez; montanhas
  largas; neve ≥ 9). Valores muito altos (≥ 30) ficam fora da tela e precisam de mais margem na grade (cresce sozinha).
- **Penhascos**: um degrau de cantos em 1 tile (ou 2) vira uma face de rocha lisa e áspera; para bordas orgânicas, ruído
  na posição do degrau (o spline e o ruído de rocha fazem o resto). Evitar ruído de alta frequência (período < 2 tiles)
  nas paredes: fica pregueado.
- **Rochas**: `rockType` regional por tile continua valendo (textura das faces); tiles de rocha (`rock = 1`) continuam
  maciços mineráveis desenhados como hoje, na altura do terreno — para montanhas use relevo, não rocha.
- **Caminhos naturais**: deixar rampas / encostas ≤ 0,7 por tile entre os níveis (senão só se sobe cavando / aterrando).

## 9. O que falta

- Túneis: criaturas ainda não planejam caminho dentro de túneis (o A* trata o túnel como a superfície: entram só em
  perseguição direta); escadas / rampas dentro do túnel (descer para outro nível) e construir dentro (tochas fixas,
  portas) ainda não; o teto visto de fora é a própria superfície (a boca aparece como um entalhe escuro na face).
- Cachoeiras: a cortina é desenhada sobre a face do relevo (não se separa dela num arco); sem arco-íris na névoa.
- **Escadas construídas** ligando o chão a um planalto, escadas / rampas de pedra para portas altas; aplanar em área
  arrastando.
- Faces de rocha ainda um pouco repetitivas de perto; minério sem marca visual no relevo.
- Mapa / radar com relevo sombreado; som de passos em cascalho / rocha.
- Multijogador com a vitrine: a bandeira é só local (o gerador do planeta resolve: as alturas vêm da semente).

## 10. Túneis com teto (`world.tun`, `game/tunnels.js`, `game/mut/tunnels.js`, `game/physics.js`)

Pedido do dono: cavar para **dentro** de penhascos, planaltos e montanhas, com o relevo de cima ficando onde está.

- **Dado compartilhado**: `world.tun` (camada esparsa por tile: a **altura do piso** do túnel, −∞ = nenhum) + o mapa
  `world.tunnels`. A superfície (alturas) não muda: em cima do túnel continua o chão de sempre, caminhável.
- **Cavar**: picareta, de frente para a face (o tile vizinho nos 4 lados), em pé no chão: "Cavar túnel" (trabalho
  `tunnel`, ~3–4 s com picareta primitiva; um tile de rocha: "Minerar" de sempre). Cabe um túnel se o canto mais alto do
  tile está ≥ 1 andar acima do piso e o mais baixo não está mais que 0,35 abaixo dele; não em água, construção, base de
  prédio, árvore / pedregulho. **O anfitrião decide o piso**: o chão de quem cava (o piso do túnel em que está, dentro
  de um). Dá pedra (face de rocha / chão pedregoso; rocha: pedra + o minério) ou terra.
- **Rede**: intent `tunnel.hit {tx, ty, inc | final}` (progresso pela op `rock.prog`, a mesma da rocha) → op `tunnel.dig
  {tx, ty, f: piso × 100, drops, by}`; a picareta numa rocha alta → `rock.hit` final → `tunnel.dig` (`tunnelRock`).
  Foto / save: seção `tun: [tile, piso × 100, …]` aplicada antes dos tiles minerados; digest `tiles.tun`. Um pedaço com
  túnel fica alterado (nunca descartado) — no streaming a camada é esparsa e o túnel sobrevive.
- **Quem está no túnel**: `e._tn` = o piso (`physics.js tunTrack`, como `e._ud` debaixo das pontes): entra pela **boca**
  (pisando num tile de túnel vindo de chão na altura do piso), fica de tile de túnel em tile de túnel, sai pela boca;
  quem anda em cima continua em cima. Para quem está dentro, o resto é **parede** (relevo um andar acima do piso);
  para quem está fora, a boca é aberta só para quem está na altura dela. O jogador manda o seu nível na presença
  (`tn`): uma cópia que aparece de repente (entrar na sala, teletransporte) já nasce no nível certo; o avatar do
  anfitrião usa o que o dono diz. Linha de visão e flechas: o túnel é um vão de ~1,3 andar acima do piso dentro do
  relevo (passa pelo vão, não pelo teto nem pelas paredes). `groundOf(e)` (chão de um corpo) = o piso dentro do túnel
  (câmera, recorte, alcance do arco, corpo a corpo).
- **Escuridão**: os tiles de túnel são tiles de caverna (`isCave`, regiões de `game/roofs.js`): escurecem pela distância
  da boca (a luz só entra pela boca e ao longo do túnel, nunca de cima); a escuridão não vaza para a superfície. Sem teto
  pintado: o teto é o próprio relevo.
- **Desenho**: a região (caverna) em que o jogador local está, as bocas (sempre: um entalhe escuro na face) e, na boca,
  os primeiros tiles (espiar) **mostram o piso**: os canais da GPU (`hgt`, `hgtG`, `hgtC`, `hgtK`, `cave`) recebem um
  pós-processo (`game/tunnels.js post`, `terrainWindow` → `win.post`) que baixa a superfície até o piso ali (com fade de
  ~0,35 s); o relevo se abre numa galeria escura com paredes de rocha, o jogador lá no fundo, o recorte em volta dele
  como em qualquer lugar. Fora disso o relevo continua inteiro e quem está dentro não aparece (nem plaqueta, mira,
  toque: `roofs.hidden(x, y, e)`). Quem anda em cima de um piso mostrado é erguido (`e._th`); grama e plantas de cima
  somem enquanto o piso aparece.
- **Desabamento**: um tile de túnel precisa de relevo sólido (rocha ou chão um andar acima do piso) a até 3 tiles
  (`TUN_SUPPORT`); um salão largo demais desaba: o teto cai num corte aberto até o piso (edições do terreno, poeira,
  pedras caindo, aviso; quem está embaixo se machuca). Construir sobre / dentro de túnel é recusado; o pincel da pá
  recusa mexer a até 2 tiles de um túnel.
- Capturas: `shots/relief_tunnel_0.png` / `_90` / `_180` (dentro, em L), `relief_tunnel_out.png` / `_out270` (a boca vista
  de fora). Teste **TR1**.

## 11. Cachoeiras e corredeiras (`shaders.js waterfall`, `fx/waterfalls.js`)

- Onde a **própria superfície da água** é íngreme (um rio descendo entre dois níveis — as `features` "waterfall" do
  planeta são exatamente isso —, um lago transbordando na borda) o terreno desenha uma **cortina de água caindo** em vez
  da face de rocha: estrias descendo rápido (mais rápidas quanto mais íngreme), água branca crescendo para o pé, brilhos
  do sol / da lua e do céu correndo, iluminada pela face; no inverno vira cortina de gelo. Está na malha do terreno:
  aparece em todo ângulo de câmera com profundidade por pixel.
- **Pé da cachoeira**: espuma revolta na água ao pé de faces íngremes; **névoa** subindo e **respingos** (partículas
  em cada tile de queda à vista, `fx/waterfalls.js`), **ronco** (dois leitos de ruído no som, panorâmicos, mais alto
  perto). **Corredeiras**: onde o rio desce em rampa (0,06–0,5 andar por tile) a água ganha estrias brancas e ondas
  paradas descendo o rio.
- `game.waterfalls.{list, find(rect), near(x, y), features(x, y, R)}`; as `features` do planeta agora chegam ao chunk
  (`planetSource adaptChunk`, `crec.features`).
- Capturas: `shots/relief_waterfall_0 / 135 / 180 / 270.png` (semente 4242, 10464,7 / 1598,3, queda de 2,3). Teste **TR2**.

## 12. A pá (`content/items.js shovel_*`, `game/terrain.js`, `ui/terrainbar.js`)

- Item **Pá** de pedra (bancada: 2 madeira, 3 pedra, 1 corda), cobre, ferro e aço (bigorna: 2 barras + 2 madeira);
  arma fraca. Ferramenta do terreno no lugar da picareta (a picareta fica para rocha e túneis).
- E / Usar com a pá na mão (sem outra coisa para usar ali) abre a ferramenta no último modo; ou Construir → Terreno.
- **Barra** (computador e toque; em retrato no toque vira coluna): Cavar · Aterrar · Aplanar · Suavizar · Sair, com uma
  linha dizendo o que o pincel vai fazer ("8 cantos abaixam", "Altura alvo: 3,5 andares") ou por que não.
- **Prévia do pincel** no chão: o anel no cursor (cor do modo; vermelho se recusado) e um ponto em cada canto que vai
  mexer, **na altura que ele vai ter** (verde; um ponto apagado onde está agora), os cantos recusados em vermelho;
  aplanando, um anel largo na altura alvo. É o pincel do anfitrião (`terrainBrush`) rodando no próprio mundo.
- Pose de cavar com a pá (`compose.js` pose `dig`). Captura: `shots/relief_shovel_preview.png`, `relief_shovel_flat.png`.
  Teste **TR3**.

## 13. Pular barrancos (`game/terrain.js dropAhead / startHop`, `nav.js`)

- Empurrando a borda de um penhasco cujo pé está **0,3–1,3 andar** mais baixo (e o caminho por cima só tem a face: sem
  rocha, parede ou água funda) por ~0,15 s, o jogador **pula** até o chão depois da face: arco curto (sobe ~0,15 e cai,
  0,42 s, `levels.js hopUpdate` move; `e._jh` ergue o desenho), poeira e passo ao pousar, **sem dano**. **Nunca para
  cima**; degrau maior que ~1,3 andar continua parando na borda (escolha: sem dano de queda para gerenciar e sem ficar
  preso no fundo de um buraco por acidente).
- **Criaturas** (anfitrião): o A* conhece essas descidas de mão única (um passo de 2 tiles por cima da face, custo 2,6,
  nunca de volta); na perseguição direta ou no caminho, quem empurra a borda pula também (`ai.js go → startHop /
  hopStep`). As cópias nos convidados deslizam pela face.
- Captura: `shots/relief_jump.png` (no meio do arco, em câmera lenta). Teste **TR4**.

## 14. Sombra do relevo nos personagens (`terrain.js reliefShade`)

- Quem está na sombra de um morro / penhasco fica mais escuro: a mesma marcha em direção ao sol do shader do terreno,
  na CPU, na cintura de cada criatura / personagem (todo quadro) e de plantas / objetos (a cada ~1 s), multiplicando a
  cor dos sprites dele (`SpriteBatch.tint`). Não dentro de túneis. Captura: `shots/relief_shade.png`.

## 15. Testes (`tools/mp-test.html?run=TR1,TR2,TR3,TR4`, anfitrião no planeta semente 4242)

- **TR1** — o convidado cava um túnel num penhasco: o tile vira túnel com o piso no chão dele nos dois; ele entra
  (`_tn`), cava o segundo tile de dentro (uma rocha: o anfitrião transforma em túnel), o anfitrião vê o avatar no túnel;
  o relevo de cima igual ao gerado; o anfitrião entra pela boca; um corpo em cima continua em cima; digest igual.
- **TR2** — a cachoeira da feature (10464,7 / 1598,3): os dois listam a feature e os mesmos tiles de queda com pé; névoa
  no convidado; ronco perto e silêncio longe; digest igual.
- **TR3** — sem pá a ferramenta recusa; com a pá E abre a ferramenta; aplanar: prévia, os cantos chegam ao nível nos
  dois, mesmas edições, mesma superfície, grama escondida nos dois; digest igual.
- **TR4** — o convidado pula um degrau de ~0,9 andar (arco, sem dano), o anfitrião o vê embaixo, empurrando de volta não
  sobe; o A* planeja a descida e não a subida; um lobo perseguindo o convidado pula também; digest igual.

## A pré-visualização de construção no relevo

O fantasma de uma peça sem base própria (bancada, tocha, baú, fogueira… — `ON_PAD` falso) era desenhado com a altura do chão
0 (`Z.g` só recebia a base das peças que ganham pad), então em terreno alto ele aparecia afundado / deslocado para baixo,
enquanto a peça posicionada (planta) ficava no lugar certo (apontamento do dono, 6/11/2026: "as construções não estão se
encaixando bem, pelo menos não o preview, dá de ver que está debaixo da terra"). Agora `building.js` dá a ele a altura do
terreno no seu ponto (`world.height.heightAt(x, y)`), a mesma que `game.js` usa para a peça pronta.

## Rios que chegam a um lago

O trecho do spline de um rio que segue lago adentro (até o nó da célula do lago) escavava um canal fundo e levantava as
margens até o nível do rio + um pouco — faixas de areia em pé no meio do lago (apontamento do dono, 6/11/2026: "rios com
águas profundas e contornados por terra mesmo estando desse jeito sem sentido ter terra ao redor"). Agora
(`world/planet/chunk.js`, passo 4) um tile cujo chão já está abaixo do nível de um lago (não seco) por perto não recebe o
rio nem as margens: o lago o enche no passo 5, e o rio termina na margem.

