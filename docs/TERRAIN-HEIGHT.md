# Relevo: terreno com altura (protótipo)

Pedido do dono: o mundo vira um planeta realista (cordilheiras, cânions, falésias, planaltos, vales) e o chão deixa de ser
plano. Direção escolhida com o dono: **terreno 3D de verdade, liso (estilo Valheim), não blocos em degraus** — morros e
vales contínuos, chão inclinado onde não é penhasco, penhascos como faces de rocha íngremes e ásperas que se fundem às
encostas. Depois o dono pediu também **mexer no terreno** (cavar / aterrar / aplanar / suavizar) e **construir no
relevo** (a casa fica numa base nivelada, com fundação).

Estado: protótipo completo atrás da bandeira de teste `?hills=1` (só em localhost). **Sem a bandeira o mundo é plano e tudo
roda exatamente como antes** (todas as alturas 0: nenhum gancho roda, o terreno continua sendo um triângulo de tela
inteira). O gerador do planeta (outro agente, `src/world/planet/`) vai preencher as mesmas alturas.

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
| `f` | a superfície fina: 4 × 4 amostras por tile, `(4W + 1) × (4H + 1)` — o que é desenhado e o que `heightAt` lê |

**Superfície lisa.** Cada amostra fina vem de um spline Catmull-Rom sobre os cantos (uma rampa uniforme continua plana,
morros e vales arredondados), **presa perto dos cantos em volta** (sem estouro: o chão ao lado de um penhasco continua
plano, a água fica no nível do mar; 20 % de folga para curvas suaves não virarem patamares) e **áspera onde é íngreme**
(ruído escalado pela inclinação do próprio spline: zero no chão suave, rochas e borda irregular no penhasco). A
superfície fina é função pura dos cantos: reconstruir só um pedaço dá os mesmos números de uma reconstrução inteira (todo
par concorda, em qualquer ordem que tenha recebido as edições). Cada célula fina vira dois triângulos cortados na diagonal
cujas pontas diferem menos (`triH`): uma borda em qualquer direção fica uma linha limpa, nunca um serrote. **CPU e GPU usam
a mesma regra** (`height.js triH` = `shaders.js HGT_FN` / `TERRAIN_VS`): pés, profundidade e toque concordam exatamente.

**Acessores** (nada de array fora deles — a engine de streaming vai paginar esta camada):
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

O preço: na tela padrão (~14 tiles de altura) cabem uns 6–8 andares de relevo local antes de um morro tapar tudo. Então a
**escala é decidida no gerador, não no desenho**: `metersToStories` deve comprimir (relevo real vira poucos andares) e o
relevo local por tela fica limitado. O que lê bem (testado na vitrine):

| Feição | Altura (andares) | Inclinação |
|---|---|---|
| morros ondulados | 0–3 | ≤ 0,4 / tile |
| encosta caminhável | — | ≤ 0,7 / tile (acima disso vira cascalho, depois rocha) |
| penhasco / falésia / parede de cânion | 2–6 de uma vez | ≥ 1,5 / tile (a face toma ~1–2 tiles) |
| cânion | fundo 0, borda 4–6 | paredes 2–3 / tile |
| planalto | 3–5 acima do redor | borda 3–5 / tile, rampa ≤ 0,5 / tile |
| montanha | pico 12–20 acima da planície, base larga (25–40 tiles) | média ≤ 0,6 / tile, coroa íngreme |
| linha de neve | ≥ 9 (`SNOW_LINE`) | neve em chão suave e na borda / saliências das rochas |

A projeção é oblíqua (a câmera olha a 45°): uma encosta **virada para a câmera** aparece esticada (dá para ver a face do
penhasco), uma **virada para longe** fica achatada e, passando de 45°, some atrás do topo — como a face norte de uma parede.
Girando a câmera (`game.cam.rot`) o jogador vê os outros lados.

---

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
  - **Neve** acima de `SNOW_LINE` com borda ruidosa; **água só no nível do mar** (nunca subindo um morro ou um penhasco).
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
| plano (sem `?hills`) | GPU 0,84 ms · CPU render 0,5 ms | GPU 1,28 ms · CPU 0,8 ms |
| relevo (`?hills=1`) | GPU 1,12 ms · CPU 0,4 ms | GPU 0,93 ms · CPU 0,7 ms |

A malha tem ~22 mil células finas no zoom padrão (só um `texelFetch` por vértice — 4 por célula —, nenhum trabalho de
CPU por quadro). Memória: superfície fina R32F + gradiente RGBA16F ≈ 12,6 MB num mapa 256² (a engine de streaming vai
paginar por pedaço).

---

## 4. Regras de jogo

- **Andar**: penhascos bloqueiam como rocha (física, criaturas, A*: `world.blocked` / `tileBlocked`). Subindo é mais
  lento (até −38 % numa encosta no limite), descendo um pouco mais rápido (`terrain.js slopeSpeed`, jogador local).
  **Pular de penhasco**: não no protótipo (ver "Falta"); só se desce por rampa, encosta ou escada.
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
- **Minerar penhasco**: "Cavar" com a picareta numa encosta de rocha corta a face (dá pedra), abrindo um corte a céu aberto.
  Túneis com teto **dentro** de um planalto ainda não (ver "Falta"); os maciços de rocha de sempre (tiles de rocha)
  continuam sendo minerados em cavernas como hoje, agora na altura do terreno em que estão.
- **Multijogador**: as alturas geradas vêm da semente (nada a sincronizar); as edições e as bases são estado compartilhado
  (abaixo); `z` das entidades continua o de antes (andar acima do chão), replicado como hoje.

## 5. Mexer no terreno (Valheim)

Construir (B) → aba **Terreno** (só num mundo com relevo): **Cavar** (abaixa o chão sob o cursor; dá terra, pedra de rocha
ou de chão pedregoso), **Aterrar** (levanta; gasta 1 Terra por vez), **Aplanar** (leva o chão para a altura do primeiro
ponto clicado, em quartos de andar), **Suavizar** (arredonda degraus e buracos). Clique / toque aplica o pincel (raio 1,6
tile, suave) no cursor; segurar continua aplicando (~4 por segundo); Esc / botão direito sai. Precisa de picareta;
**criativo: grátis e em passos maiores**.

- Passo: 0,25 andar no centro do pincel (0,5 no criativo); limites: no máximo 4 andares abaixo / acima do terreno gerado,
  nunca abaixo do nível do mar.
- Recusas (motivo na tela): construção no pincel ("o terreno embaixo dela não muda"), água ("não dá para mexer na
  margem"), rocha ("use a picareta para minerar"), longe demais (4,5 tiles), fundo / alto demais.
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
`ramp`, `ridge` (o jogador no fundo de um buraco cavado, escondido pela borda: o recorte abre), `ridgecanyon` (90° / 270°:
a parede do cânion entre a câmera e o jogador), `night`, `dig`, `flatten`, `foundation`.

## 8. Para o gerador do planeta

- Escrever `gen.heightCorners` (Float32Array `(W + 1) × (H + 1)`, andares, ≥ 0 = acima do nível do mar) — ou entregar o
  mesmo array à camada por pedaço. Tudo o mais (superfície fina, penhascos, desenho, regras) sai daí.
- **Água**: classes 1 raso / 2 fundo / 3 abissal nos tiles; os cantos de água no nível do mar = 0. Lagos em planaltos
  ainda não (a água é desenhada só na altura 0: ver "Falta").
- **Escala**: seguir a tabela da seção 2 (relevo local ≤ ~8 andares por tela; penhascos 2–6 andares de uma vez; montanhas
  largas; neve ≥ 9). Valores muito altos (≥ 30) ficam fora da tela e precisam de mais margem na grade (cresce sozinha).
- **Penhascos**: um degrau de cantos em 1 tile (ou 2) vira uma face de rocha lisa e áspera; para bordas orgânicas, ruído
  na posição do degrau (o spline e o ruído de rocha fazem o resto). Evitar ruído de alta frequência (período < 2 tiles)
  nas paredes: fica pregueado.
- **Rochas**: `rockType` regional por tile continua valendo (textura das faces); tiles de rocha (`rock = 1`) continuam
  maciços mineráveis desenhados como hoje, na altura do terreno — para montanhas use relevo, não rocha.
- **Caminhos naturais**: deixar rampas / encostas ≤ 0,7 por tile entre os níveis (senão só se sobe cavando / aterrando).

## 9. O que falta antes de expandir para cânions / penhascos / montanhas de verdade

- **Túneis com teto em penhascos / planaltos** (uma segunda camada: o piso do túnel abaixo da superfície), hoje só corte a
  céu aberto; maciços de rocha continuam com cavernas.
- **Lagos e rios acima do nível do mar** (nível d'água por região) e **cachoeiras**.
- **Pular penhascos pequenos** (descer ≤ 1 andar empurrando a borda, como no `levels.js`), **escadas construídas** ligando o
  chão a um planalto (hoje: rampas de terra), escadas / rampas de pedra para portas altas.
- Ferramenta: item **Pá** próprio (hoje a picareta), prévia do pincel mostrando o resultado, aplanar em área arrastando.
- O padrão de "escamas" leve em encostas médias de montanha (efeito do spline nos cantos: some com relevo gerado mais
  suave), faces de rocha com veios ainda repetitivos; sombras de terreno sobre personagens (hoje só no chão).
- Mapa / radar com relevo sombreado; som de passos em cascalho / rocha; criaturas sem a lentidão de subida.
- Multijogador com a vitrine: a bandeira é só local (o gerador do planeta resolve: as alturas vêm da semente).
