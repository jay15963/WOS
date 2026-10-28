# WOS — Arquitetura

Survival MMO 2D top-down (estilo visual RimWorld, combate simplificado estilo WoW), mobile-first, PWA.
Sem build step: ES modules puros servidos estaticamente (GitHub Pages). WebGL2.

Rodar localmente: `python -m http.server 5173 --bind 127.0.0.1` → http://localhost:5173
(`?seed=123` troca a semente do mundo). Em localhost o service worker é desativado.

## Coordenadas
- 1 unidade de mundo = 1 tile. x → direita, **y → baixo** (sul). Mapa 256×256.
- Entidades/objetos usam `x, y` = posição dos **pés/base** (ponto de contato com o chão).
- `game.cam.zoom` = px CSS por tile. `game.screenToWorld(sx, sy)` / `worldToScreen(wx, wy)`.

## Pipeline de render (src/engine/renderer.js)
1. **shadow** (½ res): silhuetas de sprites cisalhadas na direção do sol (`batches.shadow`), blend MAX.
2. **scene**: shader de terreno (chão misturado por ruído, água animada, montanhas com relevo/sombra)
   → `batches.blob` (sombras de contato) → `batches.decor` (grama) → `batches.main` (ordenado por y)
   → `batches.fx` (partículas alfa).
3. **light** (½ res): limpa com luz ambiente; `batches.light` (luzes pontuais aditivas, `addRaw`).
4. **post** → tela: cena × luz, nuvens, névoa, grading, vinheta. Depois `batches.emissive` (aditivo, brilha à noite).

`batch.add(sprite, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recvShadow, lift)`
- `sway`: balanço de vento (fração da altura, ~0.03 árvores, ~0.12 grama). `lift`: altura acima do chão (pulo/bob).
- `flash`: 0..1 pisca branco (dano). `flip`: -1 espelha horizontalmente. `recvShadow`: recebe sombra de outros.

Texturas do mundo (src/world/world.js):
- `tileData` RGBA 1×: R ground id, G random, B tipo de rocha regional (1..4), A minério.
- `field` RGBA 4×/tile, linear: R máscara de rocha, G altura da rocha, B profundidade da água, A umidade da margem.
- `field2` RGBA 1×, linear: R exuberância (grama), GB direção do fluxo do rio, A livre.
- Mudanças em runtime: `world.mineRock(tx,ty)` já recalcula e marca `world.dirty`; o jogo re-envia a região.

## Objetos e entidades
- **Objetos estáticos** (`world.objects`, por chunk 16×16): `{ id, type, v, x, y, s, f, solid, ... }`
  types: `tree_oak|tree_pine|tree_birch|tree_dead|bush|berrybush|boulder` + construções (`campfire|torch|wall_wood|...`).
  Estado visual opcional: `shake` (0..1), `fall` (0..1.5 animação de queda), `stump`, `empty` (arbusto sem frutas),
  `flash`, `age` (escala de crescimento), `light: {r,g,b,radius,intensity,flicker,lift}` (emite luz), `fire: true` (emite chama/fumaça).
- **Decor** (`chunk.decor`): `{ t, v, x, y, s, f }` t: `grass|tallgrass|reed|flower|mushroom`. Não interativo.
- **Entidades** (`game.entities`): `isEntity: true`, `kind: 'pawn' | 'animal'`.
  - comuns: `x, y, r (raio colisão), facing 's'|'n'|'e'|'w', moving, moveT, action {type:'attack'|'chop'|'mine'|'gather'|'cast', t:0..1} | null, flash, dead, deadT`
  - pawn: `look: { skin:[r,g,b], hair:'short'|'long'|..., hairColor:[r,g,b], shirt:[r,g,b] }, weapon: 'sword'|'axe'|'pickaxe'|null`
  - animal: `species: 'wolf'|'boar'|'deer'|'rabbit'|'bear', scale`
- Desenho: `src/art/compose.js` → `drawPawn / drawAnimal / drawStatic / drawDecor`. Lê o estado acima, não altera nada.

## Sistemas
`game.systems` = lista de `{ update(game, dt), render?(game, B, view, env) }`.
- `src/fx/ambient.js` → `installAmbient(game)`: vida ambiente, clima, partículas de fogo de objetos `fire`.
- `src/game/systems.js` → `installSystems(game)`: gameplay (combate, mobs, sobrevivência, coleta, construção, HUD).
- `game.audio.play(name, {x, y, volume})` (src/fx/audio.js). Nomes: hit, crit, swing, chop, mine, pickup, eat,
  levelup, death, growl, ui, build, fire, splash, step.
- `game.particles.emit({...})` (src/fx/particles.js). `layer: 'fx'` (alfa) ou `'emissive'` (brilho).
- Input: `game.input` (`move()`, `pressed` Set de `KeyboardEvent.code`, `taps` [{x,y}] em px CSS, `isTouch`).
  Se `player.autoMove = [dx,dy]` estiver setado, o jogador anda nessa direção quando não há input manual.

## Contrato de sprites (src/art/sprites.js → atlas)
Nome do grupo = nome sem sufixo `_N`; `atlas.pick(grupo, v)` escolhe variante. `atlas.get(nome)`, `atlas.has(nome)`.
Sprites são desenhados a `PPU = 64` px por tile; âncora (ax, ay) em 0..1 (pés = parte de baixo).
Pawns/cabelos são **brancos/cinza** e tingidos em runtime (multiplicação) — contornos escuros permanecem escuros.

| Categoria | Nomes |
|---|---|
| FX | `fx_blob, fx_soft, fx_spark, fx_smoke, fx_leaf, fx_drop, fx_ring, fx_flame, fx_splash, fx_dust, fx_slash, fx_star` |
| Árvores | `tree_oak_0..2, tree_pine_0..2, tree_birch_0..1, tree_dead_0, tree_stump_0, tree_sapling_0` |
| Plantas | `bush_0..2, berrybush_0, berrybush_empty_0, grass_0..5, tallgrass_0..2, reed_0..2, flower_0..3, mushroom_0..1` |
| Pedras | `boulder_0..2` |
| Pawn | `pawn_body_{s,n,e}, pawn_head_{s,n,e}, hair_{short,long}_{s,n,e}` (oeste = leste espelhado) |
| Armas | `weapon_sword, weapon_axe, tool_pickaxe` (apontando para cima, âncora no punho) |
| Animais | `{wolf,boar,deer,rabbit,bear}_{s,n,e}` |
| Construções | `campfire, torch, wall_wood, chest, bed` |
| Itens | `item_wood, item_stone, item_berries, item_meat, item_cooked, item_leather, item_fiber, item_ore` |
| Ícones UI | `icon_strike, icon_charge, icon_whirlwind, icon_bandage, icon_sprint, icon_attack, icon_eat, icon_build, icon_bag, icon_gather` |

Ícones para HTML: desenhe a região do sprite de `atlas.canvas` (u0..u1, v0..v1 × atlas.size) num canvas pequeno → `toDataURL()`.

## Donos de arquivos (trabalho em paralelo)
- **Arte**: `src/art/**`, `tools/gallery.html`.
- **Ambiente/mundo**: `src/world/**`, `src/engine/shaders.js` (terreno/post), `src/fx/**`.
- **Gameplay/UI**: `src/game/**` (exceto física compartilhada), `src/ui/**`, containers no `index.html`.
- **Núcleo (integração)**: `src/engine/renderer.js, gl.js, spriteBatch.js, atlas.js, input.js`, `src/main.js`, PWA.
