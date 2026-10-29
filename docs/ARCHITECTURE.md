# WOS — Arquitetura

Survival MMO 2D top-down (estilo visual RimWorld, combate simplificado estilo WoW), mobile-first, PWA.
Sem build step: ES modules puros servidos estaticamente (GitHub Pages). WebGL2.

Rodar localmente: `python tools/serve.py` → http://localhost:5173
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
- `field2` RGBA 1×, linear: R exuberância (grama), GB direção do fluxo do rio, A proximidade de rocha (0 = rocha, 1 = ≥ 4 tiles).
- Texturas de chão (src/world/terrainTex.js): array 512², camadas 0..7 chão, 8..11 rochas; RGB = cor, **A = altura**
  (mistura por altura entre tipos, poças, relevo dinâmico nas rochas). Cache em IndexedDB (chave = hash do código).
- Mudanças em runtime: `world.mineRock(tx,ty)` já recalcula e marca `world.dirty`; o jogo re-envia a região.
- Uniforms extras: `env.extra = { uNome: número | [..] }` é aplicado genericamente aos shaders de terreno e post.

Biomas e zonas (src/world/worldgen.js):
- `world.biome` (Uint8Array por tile, nomes em `BIOMES`): `meadow, forest, pine, birch, marsh, shore, rocky, water, mountain`
  (`BIOME_NAMES_PT` para a UI). `world.biomeAt(x, y)` → nome.
- `world.zones = [{ type, x, y, r, f? }]`: um por chunk 16×16 onde um bioma domina (`type` = bioma, `f` = fração)
  + `lake, river, flowers, mushrooms, outcrop, clearing, spawn`. Útil para tabelas de spawn de animais.
- `world.dWater`, `world.dRock` (Float32Array, distância em tiles até água / rocha).

## Objetos e entidades
- **Objetos estáticos** (`world.objects`, por chunk 16×16): `{ id, type, v, x, y, s, f, solid, ... }`
  types: `tree_oak|tree_pine|tree_birch|tree_dead|bush|berrybush|herbbush|boulder` + construções (`campfire|torch|wall_wood|...`).
  Estado visual opcional: `shake` (0..1), `fall` (0..1.5 animação de queda), `stump`, `empty` (arbusto sem frutas),
  `flash`, `age` (escala de crescimento), `light: {r,g,b,radius,intensity,flicker,lift}` (emite luz), `fire: true` (emite chama/fumaça).
- **Decor** (`chunk.decor`): `{ t, v, x, y, s, f }` t: `grass|tallgrass|reed|flower|mushroom|fern|bloom|heather|drygrass|thistle` (em pé,
  balançam com o vento) e detalhes planos no chão (`B.ground`, `FLAT_DECOR` em composeWorld): `litter|needles|twigs|petals|moss|lily|riverstone|
  scree|shell|driftwood`. Não interativo, determinístico pela semente (`addNatureDetails` em worldgen.js).
- **Espécies (só arte)** dentro dos tipos de jogo, codificadas em `o.v` (worldgen e renascimento usam as mesmas regras, `treeSpecies` /
  `bushSpecies` / `boulderMossy` em worldgen.js): árvores `v = espécie * 16 + variante` (`TREE_SPECIES` em trees.js: carvalho/bordo/salgueiro,
  conífera/pinheiro-silvestre/zimbro, bétula/choupo, morta/tronco quebrado), arbustos `v = espécie * 1000 + variante` (rosa-brava, zimbro),
  pedregulho com musgo `v >= 8000`.
- **Entidades** (`game.entities`): `isEntity: true`, `kind: 'pawn' | 'animal'`.
  - comuns: `x, y, r (raio colisão), facing 's'|'n'|'e'|'w', moving, moveT, action {type:'attack'|'chop'|'mine'|'gather'|'cast', t:0..1} | null, flash, dead, deadT`
  - pawn: `look` (esquema do agente H, `src/game/look.js`: `{ v:1, build, height, skin:'hex', head, ears, eyes, eyeC, brows, nose, mouth, cheeks, age, marks, scar, paint, paintC, hair, hairC, hairFx, hairC2, beard, beardC, top, topC, topC2, pattern, over, overC, bottom, botC, shoes, shoeC }`; o formato antigo `{ skin:[r,g,b], hair, hairColor, shirt }` dos saqueadores é migrado na hora), `weapon: 'sword'|'axe'|'pickaxe'|null`
  - animal: `species: 'wolf'|'boar'|'deer'|'rabbit'|'bear', scale`
- Desenho: `src/art/compose.js` → `drawPawn / drawAnimal / drawStatic / drawDecor`. Lê o estado acima, não altera nada.

## Aparência do personagem (agente H)
- **Esquema** `src/game/look.js`: `cleanLook(x)` aceita qualquer coisa (objeto, string compacta da rede, visual antigo) e sempre
  devolve um visual válido (ids desconhecidos → padrão, cores hex); `packLook` (rede, ~200 B) / `unpackLook`, `randomLook(seed,
  base?, campos?)`, `loadLook` / `saveLook` (perfil do jogador, `localStorage wos.look`, não por mundo), `applyLook(game, look)`
  (jogo rodando: troca o visual local e avisa os outros com `session.sendLook()`).
- **Catálogo** `src/art/look/catalog.js`: toda opção tem `id`, nome pt-BR, `rarity` (`RARITY`) e `unlocked` (cosméticos futuros só
  acrescentam entradas). Paletas de pele, olhos, cabelo, tinturas, tecido, couro e pintura.
- **Arte** `src/art/look/{body,face,hair}.js` (pintores por parte, branco/cinza tingido no atlas) → `index.js` (`lookDefs()` nomes
  `lk_<parte>_<id>_<dir>`, `addLook` em `sprites.js`) → `rig.js` (`lookRig(A, look)`: pilhas ordenadas e tingidas por direção
  `body / head / brows / beard / hair / hairBack`, `lids`, `feet`, escala de corpo `sx, sy, hk`; cache por objeto de visual). O
  `compose.js` desenha essas pilhas nas transformações do rig. Capacetes: `WEAR_HIDES_HAIR` (`true` esconde o cabelo da frente,
  `'tall'` só os estilos altos); o cabelo longo de trás continua visível.
- **Prévia** `src/art/look/preview.js`: `PreviewAtlas(k)` pinta as partes sob demanda em k× com os mesmos pintores, `drawPawn2D`
  reproduz num canvas 2D as instâncias que `compose.drawPawn` gera (mesmas regras do shader). `atlasView(A)` usa o atlas do jogo.
- **UI** `src/ui/charcreator.js`: `mountMenuAvatar(el, { name, onName })` (menu do B, `.mc-avatar`) e `openCharEditor({ game?,
  look?, name? })` (também no menu de pausa: "Aparência"; no jogo a prévia mostra o equipamento atual). Guarda-roupa: até 8 visuais
  salvos (`localStorage wos.looks`, strings de `packLook`). Ao salvar, `wos:look` (evento em `window`) avisa o avatar do menu e a
  fogueira da vitrine. Galeria: `tools/looks.html` (`?cat=hair&dirs=s,e,n`, `?gear=helmet_iron`).

## Sistemas
`game.systems` = lista de `{ update(game, dt), render?(game, B, view, env) }`.
- `src/fx/wildlife.js` → `installWildlife(game)` (`game.wildlife`, chamado por installAmbient, `sync: 'cosmetic'`): borboletas, abelhas, libélulas,
  sapos, patos, sombras de peixe, esquilos, passarinhos e coelhos; todos fogem dos jogadores, limitados por espécie (`game.quality`), entram na
  ordenação por profundidade via `collect`.
- `src/fx/ambient.js` → `installAmbient(game)` (`game.ambient`): vida ambiente (vaga-lumes, borboletas, folhas, pássaros,
  peixes, brilhos na água, poeira), respingos de chuva, fumaça + brasas de objetos `fire`, resolução adaptativa
  (`game.R.autoScale = false` desliga).
- `src/fx/environment.js`: `env.setWeather('clear'|'cloudy'|'rain'|'storm'|'fog')`, `env.weatherName()` (pt-BR),
  `env.env.{wind, windDir, gust, rain, wet, storm, night, day, hour, weather, snowCover, snowAt}`; raios em `env.strikes`.
  Vento cosmético por quadro: `game.env.wind = { x, y, gust }` (direção × força 0..~1,05, rajada 0..1, filtrados).
  Relâmpago: `game.events.emit('lightning', { x, y, power, dist })`. Neve: chuva sobre biomas frios (pinheiral,
  montanha) cai como neve (`R.coldAt(x, y)` ≥ 0,6). Balanço de plantas: parâmetro `sway` do `batch.add` (`swayFor(tipo)`
  em `renderer.js`, ver o topo do arquivo).
- `src/fx/quality.js`: `game.quality` = `'low'|'medium'|'high'` (efetivo), `game.qualityMode` (escolha, `wos.quality`),
  `qualitySettings(el, game)` (linha das configurações). `game.debug.*` (só localhost): `src/fx/debug.js`.
- `src/game/systems.js` → `installSystems(game)`: gameplay (combate, mobs, sobrevivência, coleta, construção, HUD).
- Áudio procedural (src/fx/audio.js, sem arquivos): `getAudio()` (singleton, também no menu) = `game.audio`.
  `game.audio.play(name, {x, y, volume, delay, pitch})` — catálogo em `src/fx/sfxBank.js` + rotas em audio.js (step usa o
  chão/piso em x,y; swing a arma; hit/growl/death a espécie mais próxima). Nomes desconhecidos são ignorados.
  Música generativa: `game.audio.music.setMood('menu'|'day'|'night'|'dawn'|'rain'|'cave'|'danger'|'home')` (o diretor
  `src/fx/audioDirector.js` escolhe sozinho no jogo). Volumes `setLevel('master'|'music'|'sfx'|'amb')`, `.enabled` (mudo),
  UI em `src/fx/audioSettings.js`. `net.js` chama `audio.onOp()` antes de cada op (sons das ações de todos). Teste/escuta:
  `tools/audio-test.html` (localhost).
- `game.particles.emit({...})` (src/fx/particles.js). `layer: 'fx'` (alfa) ou `'emissive'` (brilho).
- Input: `game.input` (`move()`, `pressed` Set de `KeyboardEvent.code`, `taps` [{x,y}] em px CSS, `isTouch`).
  Se `player.autoMove = [dx,dy]` estiver setado, o jogador anda nessa direção quando não há input manual.

## Contrato de sprites (src/art/sprites.js → atlas)
Nome do grupo = nome sem sufixo `_N`; `atlas.pick(grupo, v)` escolhe variante. `atlas.get(nome)`, `atlas.has(nome)`.
Sprites são desenhados a `PPU = 64` px por tile; âncora (ax, ay) em 0..1 (pés = parte de baixo).
Pawns/cabelos são **brancos/cinza** e tingidos em runtime (multiplicação) — contornos escuros permanecem escuros.

| Categoria | Nomes |
|---|---|
| FX | `fx_blob, fx_soft, fx_spark, fx_smoke, fx_leaf, fx_drop, fx_ring, fx_flame, fx_flame_0..2, fx_splash, fx_dust, fx_slash, fx_star, fx_glow, fx_ember` |
| Árvores | `tree_oak_0..4, tree_pine_0..4, tree_birch_0..2, tree_dead_0..1, tree_maple_0..2, tree_willow_0..1, tree_scots_0..1, tree_juniper_0..1, tree_aspen_0..1, tree_snag_0, tree_stump_0, tree_sapling_0` |
| Plantas | `bush_0..3, bush_rose_0..1, bush_juniper_0..1, berrybush_0..1, berrybush_empty_0..1, herbbush_0..2, grass_0..7, tallgrass_0..3, reed_0..2, flower_0..5, mushroom_0..4, fern_0..3, bloom_0..5, heather_0..1, drygrass_0..1, thistle_0..1` + planos `litter_0..4, needles_0..1, twigs_0..1, petals_0..1, moss_0..2, lily_0..3, riverstone_0..2, scree_0..1, shell_0..1, driftwood_0`; `boulder_moss_0..2` |
| Bichos (cosméticos) | `cr_butterfly_0..4, cr_bee, cr_dragonfly_0..1, cr_frog_0..1, cr_frog_jump, cr_duck_0..1, cr_duck_fly, cr_duckling, cr_fish, cr_squirrel_{sit,run,climb}, cr_bird_0..2_{sit,peck,fly}` (src/art/critters.js) |
| Pedras | `boulder_0..3` |
| Pawn | `pawn_body_{s,n,e}, pawn_head_{s,n,e}, hair_{short,long,bun,mohawk,ponytail,curly}_{s,n,e}, beard_{s,e}` (oeste = leste espelhado) |
| Armas | `weapon_sword, weapon_axe, weapon_spear, weapon_club, tool_pickaxe` (apontando para cima, âncora no punho) |
| Animais | `{wolf,boar,deer,rabbit,bear}_{s,n,e}` + `{...}_e_walk` (quadro de passada lateral) |
| Construções | `campfire, torch, wall_wood, chest, bed` |
| Itens | `item_wood, item_stone, item_berries, item_meat, item_cooked, item_leather, item_fiber, item_ore` |
| Ícones UI | `icon_strike, icon_charge, icon_whirlwind, icon_heal, icon_sprint, icon_attack, icon_eat, icon_build, icon_bag, icon_gather` |

Ícones para HTML: desenhe a região do sprite de `atlas.canvas` (u0..u1, v0..v1 × atlas.size) num canvas pequeno → `toDataURL()`.

**Cache do atlas** (`src/engine/atlasCache.js`): em produção o atlas pronto (PNG + metadados) fica no IndexedDB, com chave =
`ART_ID` (hash do grafo de módulos de arte gravado em `src/version.js` por `node tools/stamp.mjs` — a identidade do código que
está rodando, nunca fontes baixadas em tempo de execução). Um atlas com falhas de pintura ou substitutos (`A.failures`,
`A.placeholders`) **nunca** é guardado; num acerto o atlas é validado (`src/game/artcheck.js`: contrato, `<espécie>_{s,n,e}` de toda
criatura, arte de toda construção / flora / plantação) e descartado se faltar algo. Desligado em localhost (force com `?cache=1`;
`?nocache` desliga). Regra: módulos de arte não podem depender de estado calculado durante a pintura. Contrato de nomes:
`src/art/contract.js`. Service worker: **network-first** com `cache:'no-cache'` (um carregamento nunca mistura dois deploys; o
cache do SW só serve offline).

Animação (rodada V2, agente D): `compose.js` monta o pawn como um rig (corpo, botas `pawn_foot_*`, mãos `pawn_hand`, cabeça
com pálpebras `pawn_lids_*`) e lê, além dos campos acima, `p.headFacing` (cabeça virada para o alvo), `p.pose`
(`{type:'sit'|'sleep', o?}`: sentado / deitado na cama) e `action.item` (comida na mão). Ações novas: `eat`, `craft`, `cook`,
`plant`, `harvest`, `heal` (alias `bandage`). O motor cosmético fica em `juice.js` (olhar, sentar perto da fogueira / na
cadeira, dormir, passos, arbustos e plantações que balançam, migalhas/ervas/Zzz) e o vento chega por `animEnv` (exportado
por `compose.js`). Animais: quadro `<espécie>_e_graze` (pastar/farejar) gerado do quadro parado; andadura por velocidade.
`e._sy` (cosmético) troca a chave de profundidade enquanto o pawn está deitado/sentado num móvel. Prévia: `tools/gallery.html?strip=walk,run,chop&sdir=e`
(`&species=deer` para animais).
Campos visuais opcionais lidos por `compose.js`: `look.beard` (bool), `hair: 'bald'` (sem cabelo), `o.fallDir` (±1, lado da queda
da árvore), `o.alpha` (0..1, transparência — o jogo usa nas copas que cobrem o jogador), `o.fire === false` / `o.lit === false`
(apaga chama de fogueira/tocha). Galeria de sprites: `tools/gallery.html` (`?focus=<regex>`, `?only=scene|pawns|animals|atlas`).

## Donos de arquivos (trabalho em paralelo)
- **Arte**: `src/art/**`, `tools/gallery.html`.
- **Ambiente/mundo**: `src/world/**`, `src/engine/shaders.js` (terreno/post), `src/fx/**`.
- **Gameplay/UI**: `src/game/**` (exceto física compartilhada), `src/ui/**`, containers no `index.html`.
- **Núcleo (integração)**: `src/engine/renderer.js, gl.js, spriteBatch.js, atlas.js, input.js`, `src/main.js`, PWA.

## APIs da expansão "Eras" (resumo; contrato completo em `docs/CONTENT.md`)
- **Mundo** (`src/world/worldgen.js`, `world.js`): `ORE`, `ORE_ITEM`, `ORE_NAMES_PT`, `BIOME_ID`, `CAMP_R`;
  `world.roof` / `roofAt(tx,ty)`, `isCave`, `isMined`, `caveDark(x,y)`, `world.rock0` (rocha original);
  `world.caveData` (textura RGBA: escuridão da caverna, minério próximo, chão pisado, piso minerado);
  `chunk.pop` (população inicial por tipo), `world.canGrow(tx,ty,kind)`, `world.growWeight(tx,ty,kind)`;
  `world.camps` / `world.zones` (`bandit_camp`). Luz: passe `AMBIENT_FS` (ambiente × caverna) + luzes aditivas; batch `decal`.
- **Economia** (`game.econ`): `hasTool, bestTool, equipItem, unequip, equipFromSlot, rollKillLoot, craft, recipeState, build,
  designate, nextStep`; `game.hasTool(p, kind)`; `registerWork(kind, handler)` (gathering.js); `world.noGrow` (sem renascer perto de
  construções); física: `collides(world, x, y, r, ignore, passDoors)`, `tileBlocked`; `world.solid` 1 = bloqueia (paredes, móveis,
  portas FECHADAS), 0 = livre (porta aberta). Portas só abrem/fecham por ação (`door.toggle`).
- **Construção (rodada V2)**: plantas grátis (azuis), material entregue no início da obra (`struct.paid`), rotação `o.rot`
  (4 orientações / 5 posições de borda), pegada `o.fw × o.fh`, `Mover` (`build.move` → `struct.relocate`), `Arrasar`
  (`struct.raze`), barra de construção e menu de contexto em `src/ui/buildbar.js`. Detalhes em `docs/SYNC.md` §7.2.
  Save v2 (`wos.save.v1.<seed>` migrado). Fila de trabalho automática (`work.js`): plantas, mineração, desmontar, colheita.
- **Combate**: `content/weapons.js` (perfis por tipo/tier, armaduras, escudos), habilidades em `content/combat.js` (`act` = pose),
  `projectiles.js`, `bandits.js` (`game.camps`), barra de ação dinâmica (`src/ui/actionbar.js`). Sistemas podem expor
  `collect(game, list, view)` para objetos com `o.draw(B, A, t)` entrarem na ordenação por profundidade.
- **Arte**: `structureSprite(A, type, mask, {orient, kind, v})` (composeWorld.js) para fantasmas de construção; galerias em
  `tools/gallery.html` (personagens/itens) e `tools/gallery-world.html` (mundo/construções).

## Menu e multijogador (fase 1)
- **Boot** (`src/main.js`): gráficos carregam em segundo plano enquanto o **menu principal** (`src/ui/menu.js`) aparece; o mundo
  só é gerado depois da escolha (um jogador / criar sala / entrar). `?seed=N` pula o menu (testes); `?sala=CODIGO` abre a tela
  de entrar já preenchida (link de convite). Menu do jogo (☰ / Esc): `src/ui/netui.js` (pausa só em um jogador).
- **Rede** (`src/net/`): sempre WebRTC (navegador ↔ navegador). Encontro pelo código via Trystero (`vendor/trystero/*`, MIT,
  empacotado com esbuild) em cascata **Nostr → BitTorrent → MQTT** (anfitrião escuta nas três); alternativa sem rede de encontro:
  **código manual** (`ManualLink`). STUN: Google + Cloudflare. **TURN da Cloudflare** como fallback automático: o jogo busca
  credenciais temporárias no Worker `server/turn` (`TURN_ENDPOINT_DEFAULT` em `rtc.js`); o navegador só usa o repetidor quando a
  conexão direta falha. Modo de teste `wos.forceRelay=1`. TURN manual de outro provedor ainda é possível (`wos.turn`).
- **Sessão** (`session.js`): o anfitrião é a autoridade do mundo; mensagens `hello/welcome/reject/ready/snap/st/sts/lk/chat/ping/
  pong/left/bye/rq/ack/ops/own/ents/fx/dg/dgx/dgr`, máx. 4 jogadores, presença a 12 Hz interpolada no relógio do remetente.
  `hello` leva protocolo, `BUILD_ID` e o digest do atlas: versões / gráficos diferentes são recusados com mensagem clara.
  O convidado gera o mundo da semente **como convidado** (sem criaturas, regrowth ou save de mundo locais) e recebe o
  snapshot do anfitrião; depois disso só ops sequenciadas mudam o mundo. Convidado salva **só o jogador**
  (`wos.save.v2.<seed>.guest`). Jogadores remotos: entidades `kind:'pawn', remote:true, faction:'friend'`; no anfitrião cada
  um tem também um avatar (`pl.av`, posição mais recente) usado pela IA. Se o anfitrião sair: "O anfitrião saiu" + Voltar ao menu.
- **Logs** (`netlog.js`): cada passo (sinalização, candidatos ICE, rota escolhida, falhas explicadas, erros da biblioteca) com
  horário, salvos nas últimas sessões (`wos.netlog`). **Copiar relatório** gera texto com IPs públicos mascarados.
  `rtc.js`: `tracePC` (explica falhas: sem candidatos remotos, UDP bloqueado, NAT incompatível) e `probeNetwork` (tipo de NAT).
- Mundo compartilhado (coleta / construção / mineração / plantações / saque / acampamentos) e criaturas / combate
  sincronizados pelo anfitrião: ver a seção abaixo e `docs/SYNC.md`.

## Multijogador — contrato de sincronização (leia antes de mexer em gameplay)
Arquitetura completa e API de teste: `docs/SYNC.md` (§3 desenho, §7 o que foi implementado). Um jogador = anfitrião sem
convidados: o mesmo caminho de código roda sempre.

1. Toda mudança de estado compartilhado (objetos do mundo, tiles, construções, itens no chão, plantações, criaturas,
   acampamentos, horário) é uma **op** (`defineOp` em `src/game/mut/*.js`, `apply` determinístico, com `doc` + `args`) emitida
   pela autoridade (`game.net.emit`), normalmente a partir de uma **intent** (`defineIntent`) pedida com
   `game.net.request(nome, args, { refund, onOk, onReject })`. Nunca mude esse estado diretamente
   (`world.addObject/removeObject/mineRock` têm guarda em tempo de execução).
2. Todo sistema novo declara `sync: 'host' | 'owner' | 'all' | 'cosmetic'` e é instalado com `addSystem` (convidados pulam
   `host`).
3. Todo campo novo de runtime num objeto compartilhado é setado só dentro de um `apply`, serializado em `src/net/snapshot.js`
   e listado nas linhas do digest (`src/net/digest.js`) — ou é cosmético (prefixo `_` ou em `COSMETIC_FIELDS`).
4. Aleatoriedade e ids só na autoridade (`net.roll()`, `net.newId(prefixo)`), e o resultado vai nos args da op. Nada de
   `Math.random` em ids. Aplicadores nunca usam `game.player` (efeitos no jogador local: campos `by/xp/give/toast` da op).
5. Criatura nova: `SPECIES` + nomes no contrato de arte (`<sp>_{s,n,e}` em `src/art/contract.js`); o stream de entidades não
   precisa de nada. Construção / item / plantação nova: nomes no contrato; as ops são genéricas por tipo.
6. Antes de commitar: `node tools/stamp.mjs` e `node tools/check-sync.mjs` (ou `npm run check`); para mecânica nova,
   adicione um cenário em `tools/mp-test.js`. Mudou formato de mensagem → aumente `PROTO` (`src/net/netlog.js`).

Arquivos: `src/net/net.js` (núcleo), `registry.js`, `session.js`, `links.js` (+ `BroadcastLink` para testes, `?link=bc`),
`entities.js` (criaturas 10 Hz com interesse, proxies nos convidados, eventos cosméticos), `snapshot.js` (save e entrada),
`digest.js` (detector de dessincronia a cada 5 s + ressincronização automática + API de depuração `game.net.digest/dump/diff/
selfTest`), `src/game/mut/*` (ops e intents por domínio), `src/game/players.js` (todos os jogadores para a IA do anfitrião),
`src/game/anim.js` (`stepGait`: 0,25 de ciclo por tile para todos). Testes automáticos com dois clientes: `tools/mp-test.html`.
