# WOS — Conteúdo (contrato da expansão "Eras")

Este documento é o **contrato** entre arte, mundo, economia/construção e combate. IDs são em inglês
(snake_case); textos para o jogador em pt-BR. Quem precisar de um ID novo pode adicionar, mas deve
listá-lo no relatório final. Leia também `docs/ARCHITECTURE.md`.

## 1. Progressão por eras
O jogador **começa sem nada** (sem arma, sem ferramenta, inventário vazio) — luta com as mãos.

| Era | Como chega | O que libera |
|---|---|---|
| 0 Primitiva | à mão | pegar pedrinhas, gravetos, fibra; faca/machado/picareta **primitivos**, corda, tocha, fogueira; ervas medicinais colhidas em arbustos de ervas |
| 1 Pedra | Bancada de trabalho | ferramentas de pedra, lança de pedra, clava, arco + flechas, escudo de madeira, couro, paredes/portas/cercas/pisos de madeira, móveis |
| 2 Cobre | Fornalha + Bigorna (+ Mesa de cantaria) | barras de cobre → ferramentas/armas/escudo/elmo de cobre; blocos de pedra → paredes/pisos de pedra |
| 3 Ferro | minério de ferro (picareta de cobre+) | barras de ferro → ferramentas/armas/armadura de ferro, maça, braseiro, poste com lanterna |
| 4 Aço | ferro + carvão na fornalha | barras de aço → ferramentas/armas de aço, arco composto |

**Ferramentas são obrigatórias:** cortar árvore exige machado; minerar pedregulho/rocha exige picareta;
sem faca, animais abatidos não dão couro (só carne). Tier melhor = mais rápido (multiplicador de
velocidade de trabalho): primitive 1.0, stone 1.45, copper 1.9, iron 2.5, steel 3.2.
Minério exige tier mínimo de picareta: coal/copper → stone+, iron → copper+, gold/jade → iron+.
Rocha comum e pedregulhos: qualquer picareta.

## 2. Itens (`src/game/content/items.js`) — sprite do ícone = `item_<id>`
**Materiais:** `pebble` Pedrinha · `stick` Graveto · `fiber` Fibra vegetal · `wood` Madeira · `stone` Pedra ·
`stone_block` Bloco de pedra · `rope` Corda · `leather` Couro · `cotton` Algodão · `cloth` Tecido ·
`copper_ore` Minério de cobre · `iron_ore` Minério de ferro · `coal` Carvão · `gold_ore` Minério de ouro · `jade` Jade ·
`copper_bar` Barra de cobre · `iron_bar` Barra de ferro · `steel_bar` Barra de aço · `gold_bar` Barra de ouro ·
`arrow` Flecha · `herb` Erva medicinal (colhida no `herbbush`; o antigo `bandage` é migrado 1:1 para `herb`)
**Sementes:** `seed_potato` Semente de batata · `seed_cotton` Semente de algodão · `seed_corn` Semente de milho
**Comida:** `berries` Frutas silvestres · `meat` Carne crua · `cooked` Carne assada · `potato` Batata ·
`baked_potato` Batata assada · `corn` Milho · `roast_corn` Milho assado · `stew` Ensopado
(o antigo `ore` deve ser migrado para `copper_ore` ao carregar saves.)

**Ferramentas/armas (mão principal)** — id `<tipo>_<material>`; sprite na mão = `held_<id>`:
| tipo | materiais | observação |
|---|---|---|
| `knife` Faca | primitive, stone, copper, iron, steel | ferramenta (couro, fibra mais rápida) + arma rápida |
| `axe` Machado | primitive, stone, copper, iron, steel | ferramenta de corte + arma pesada |
| `pickaxe` Picareta | primitive, stone, copper, iron, steel | ferramenta de mineração (arma fraca) |
| `spear` Lança | stone, copper, iron, steel | alcance 1,8 |
| `sword` Espada | copper, iron, steel | |
| `club` Clava/Maça | wood (Clava), iron (Maça de ferro) | atordoa |
| `bow` Arco | wood (Arco simples), composite (Arco composto) | à distância, gasta `arrow` |
**Mão secundária:** `shield_wood`, `shield_copper`, `shield_iron` (Escudo) · `torch_hand` (Tocha de mão: luz em volta do jogador).
Arco ocupa as duas mãos (sem mão secundária).
**Vestimenta:** corpo `tunic_cloth` Túnica de tecido · `armor_leather` Armadura de couro · `armor_copper` Armadura de cobre ·
`armor_iron` Armadura de ferro; cabeça `hat_straw` Chapéu de palha · `hood_leather` Capuz de couro ·
`helmet_copper` Elmo de cobre · `helmet_iron` Elmo de ferro. Sprites sobrepostos: `wear_<id>_{s,n,e}`.

Campos de item sugeridos: `{ name, sprite, stack, desc, tier, cat:'material'|'food'|'tool'|'weapon'|'offhand'|'armor'|'seed'|'ammo',
slot:'main'|'off'|'body'|'head', tool:{ chop?, mine?, skin? } (velocidade), weapon:{ type, twoHanded? }, armor:{ value }, food:{...} }`.

## 3. Equipamento e estado visual do pawn
- `p.equip = { main, off, body, head }` (ids ou null) — gerido por economia (inventário/equipar).
- Visual (lido pela arte): `p.weapon` = id do item visível na mão principal (ou null = mãos);
  durante trabalho a economia troca temporariamente para a ferramenta usada (ex. `axe_stone`).
  `p.offhand` = id na mão secundária (escudo/tocha) · `p.armor = { body, head }` · `p.blocking` (escudo erguido).
- `p.action = { type, t }` tipos: `attack, chop, mine, gather, pick` (abaixar e pegar), `build` (martelar),
  `cast, shoot` (puxar/soltar o arco), `throw, block, bash, stab, cleave, smash, pierce`.
- Saqueadores (`faction: 'bandit'`) usam a mesma arte de pawn com `look`, `weapon`, `offhand`, `armor`.
- Arte: fallback por tipo quando faltar um `held_<id>` (ex. `axe_iron` → qualquer `held_axe_*`).

## 4. Habilidades por arma (`src/game/content/combat.js`) — ícone `icon_<id>`
| arma | habilidades |
|---|---|
| mãos | `punch` (auto) · `shove` Empurrão |
| faca | `stab` Estocada · `lacerate` Lacerar (sangramento) |
| machado | `cleave` Golpe Fendente (cone à frente) |
| clava/maça | `smash` Esmagar (atordoa) |
| lança | `pierce` Perfurar (linha) · `sweep` Varredura (empurra em arco) |
| espada | `strike` Golpe · `whirlwind` Redemoinho · `charge` Investida |
| arco | `shoot` (auto, gasta flecha) · `aimed_shot` Tiro Mirado · `multi_shot` Tiro Múltiplo · `disengage` Recuar |
| escudo | `block` Bloquear · `shield_bash` Golpe de Escudo |
| tocha de mão | `torch_swing` Brandir Tocha (assusta animais, queima) |
| sempre | `heal` Ervas medicinais (consome 1 `herb`, cura 40% em 8 s, interrompida por dano; pose `heal`) · `sprint` Disparada |
A barra de ação muda conforme `p.equip.main` / `p.equip.off`. Projéteis: sprites `proj_arrow`, `proj_spear`.
Ícones de UI extras: `icon_attack, icon_eat, icon_build, icon_bag, icon_gather, icon_craft, icon_mine, icon_equip, icon_shoot`.

## 5. Construções (`src/game/content/buildings.js`) — type = nome do sprite
**Conectáveis (autotile, regra geral):** cada estrutura conectável tem `connect: '<grupo>'`. O sprite é
`<type>_<mask>` com máscara de 4 vizinhos do **mesmo grupo**: N=1, E=2, S=4, W=8 (0..15).
Grupo `wall`: `wall_wood` Parede de madeira, `wall_stone` Parede de pedra, portas `door_wood` (contam como parede
para os vizinhos); paredes também contam **rocha natural** vizinha como conectada.
Grupo `fence`: `fence_wood` Cerca, `gate_wood` Portão. Pisos (cada tipo é seu próprio grupo): `floor_wood` Piso de madeira,
`floor_stone` Piso de pedra. Agricultura: `farm_plot` Canteiro (grupo próprio).
Portas/portões: sprites `door_wood_h` / `door_wood_v`, `gate_wood_h` / `gate_wood_v` (h = numa linha leste-oeste);
estado `o.open` 0..1 (animação de abrir). Abrem para o jogador; bloqueiam criaturas hostis.
- Convenção de posição de estrutura de 1 tile: `o.tx, o.ty` (tile), `o.x = tx + 0.5`, `o.y = ty + 1` (base na borda de baixo
  do tile). O sprite tem a âncora na base da face frontal; a face de cima pode subir ~0,5 tile (visão 3/4).
- `o.mask` (0..15) é calculado pela economia ao construir/destruir (e vizinhos atualizados); a arte usa `<type>_<o.mask>`.
- `world.solid[i]`: 1 = bloqueia tudo (parede/cerca/estação), 2 = porta/portão (bloqueia criaturas, jogador passa).
- Pisos, canteiros e tapetes são **planos**: desenhados em `B.ground` (antes de tudo), sem sombra.

**Estações (produção):** `workbench` Bancada de trabalho (2×1) · `stonecutter` Mesa de cantaria (2×1) · `furnace` Fornalha (1×1, fogo/luz
quando trabalhando: `o.working`) · `anvil` Bigorna (1×1) · `loom` Tear (2×1) · `cooking_pot` Caldeirão (1×1, fogo) · `campfire` Fogueira (cozinha).
Estruturas maiores que 1×1: `size: [w, h]`; `o.x = tx + w/2`, `o.y = ty + h`; sprite com âncora no centro da base da área.
**Móveis:** `chest` Baú · `bed` Cama · `table_wood` Mesa (2×1) · `chair_wood` Cadeira · `rug` Tapete (2×1, plano) ·
`flower_pot` Vaso de flores · `banner` Estandarte.
**Luz:** `campfire`, `torch` (de pé), `brazier` Braseiro, `lamp_post` Poste com lanterna.
**Agricultura:** `farm_plot` + plantas `crop_<kind>_<stage>` com kind `potato|cotton|corn`, stage 0..3 (3 = pronto para colher).
**Acampamento de saqueadores:** `tent_0..1` Barraca, `crate_0` Caixote (+ fogueira/estandarte).

### 5.1 Estilos e detalhes das peças de construção (agente K) — REGRA
Toda **peça de construção** (paredes, portas, cercas, portões, pisos, canteiros, telhados, colunas, escadas, parapeitos e
qualquer peça futura) tem um **kit**: o catálogo de estilos e detalhes que o jogador escolhe em **Detalhes** antes de
construir. Estações e móveis (`station`, `slots`, `decor: true`) **não** têm kit.
- Kit **explícito**: `BUILDINGS[type].kit = '<id>'` (`kit: null` desliga). Ou **inferido** (a próxima peça ganha o sistema sem
  fazer nada): grupo `wall` + `block: 'tile'` → `wall`; grupo `wall` + porta → `door`; grupo `fence` → `fence` (porta → `gate`);
  `layer: 'floor'` → `floor`; `farm_plot` → `plot`; `layer: 'roof'` → `roof`; ids `column_*` / `pillar_*` → `column`.
- Catálogo em `src/game/content/kits.js` (`KITS[kit] = { name, tabs, styles, details }`): estilo `{ id, name, desc, types?, def? }`
  (`types` limita a tipos; `def` = a arte própria do tipo), detalhe `{ id, name, cat, group?, types?, mats?, front?, tint?, light?,
  glow? }` (`group` = escolha exclusiva; `mats` filtra por material do tipo: `def.mat` ou o custo → `wood` / `stone` / `plant`).
  Um estilo ou detalhe novo é só uma linha no catálogo + a arte (`src/art/arch.js` pinta, `src/art/archCompose.js` desenha).
- Campos compartilhados da estrutura: `o.style` (id; `''` = visual padrão) e `o.det` (ids ordenados juntados com `.`; `''` = nenhum),
  **fixados na colocação** (`build.place {type, tiles, rot, style, det}`). Só **plantas** (não construídas) mudam de estilo
  (pincel / menu "Estilo da planta" → `struct.style`); peça pronta: desmontar e construir de novo. Estilos e detalhes são
  **grátis** (não mudam o custo).
- Arte: estilo = um sprite por máscara (`wst_<estilo>_<m>`, cantos suaves `wst_<estilo>_s<m>`, cercas `kfe_<estilo>_<m>`); cada
  detalhe = UM sprite sobreposto, cores = tinta na hora de desenhar. Nunca estilo × detalhe × máscara.
  **Detalhes seguem o material:** cada estilo tem uma família de cantos (`CORNER_FAM` em `src/art/arch.js`: tábuas, toras,
  enxaimel, pau a pique, blocos, pedra bruta, seixos; enxaimel de tijolos usa a madeira do enxaimel) e `look: 'wood' | 'stone'`
  no catálogo. Postes, pilares, arremates, escoras/contrafortes, coroamento, cinta e ameias são pintados nessa família e levam
  a cor (tom) da parede; pedra cinza numa parede de madeira só nas opções "de pedra" (cunhais, soco). Peças de canto têm
  um sprite por canto (nw, ne, sw, se: a luz fica sempre de cima à esquerda) e projetam sombra junto com a parede.
  Rótulos por material: `names` / `descs` `{ wood, stone }` no detalhe (`detName` / `detDesc` em `content/kits.js`).
  **Pintura preguiçosa:** só o visual padrão de cada peça (e os brilhos emissivos) é assado no atlas; variantes de estilo, cantos
  suaves, detalhes e decoração são registrados em `src/art/lazyDefs.js` (`lazyDef(nome, pintor, ax, ay)`, no import de
  `arch.js` / `decor.js`) e pintados sob demanda na textura preguiçosa de H (`art/look/lazy.js`). Enquanto um sprite não está
  pronto, a base cai no visual padrão do tipo e o detalhe é pulado nesse quadro; prévias e ícones pintam na hora. Sprite novo de
  kit: `S(nome, () => pintor(...), ax, ay)` em `archSprites` / `decorSprites` (`baked = true` só para o padrão / brilho).
- Fachadas modulares por andar: o pintor da frente pinta uma faixa `(topo, altura)`; um andar a mais repete a faixa.
- **Telhados (agente J):** o kit `roof` usa os estilos de J (`ROOF_STYLES` / `ROOF_TYPE_STYLES` em `content/roofs.js`, ids explícitos,
  nunca `''`) e os detalhes de J (`moss`, `chimney`, `vane`, `trim`) + os de K: forma (`end_gable` / `end_hip`), empena (`gab_*`),
  cumeeira (`r_board` / `r_tile` / `r_bound`), `barge`, `weather`, cores (`t_*`) — `roofArtStyle(o)` transforma esses em um estilo
  derivado que o pintor de J lê (`artSpec` → `spec.styles`) — e os adereços no telhado (`dormer`, `dormer_pl`, `skylight`), sprites
  de K desenhados sobre a água do telhado com `roofPropAt` de J. Janelas com vidro têm ids que começam com `window` (`window`,
  `window_shutters`, `window_curtains`, `window_round`): os raios de sol de J entram por elas.

### 5.2 Decoração (agente K, `src/game/content/decor.js`) — categorias Decoração e Jardim
Campos extras: `decor: true` (sem kit, devolve como móvel ao desmontar), `eg: [profundidade, meia largura]` (peças de borda),
`mount: 'wall'` (vai na parede: precisa de parede pronta ou rocha atrás; desenhada na face da parede), `dummy: true`,
`flame: n` (velas / lanternas, sem fumaça), `mat`.
**Interior:** `shelf_wood` Estante · `bookshelf` Estante de livros (2×1) · `wardrobe` Guarda-roupa · `dresser` Cômoda (2×1) ·
`bench_wood` Banco · `stool` Banquinho · `chair_fine` Cadeira estofada · `table_round` Mesa redonda · `table_small` Mesinha ·
`barrel` Barril · `crates` Pilha de caixotes · `sacks` Sacos de grãos · `jars` Potes e jarros · `candles` Velas · `candelabra`
Candelabro · `herbs_hang` Ervas penduradas · `curtain` Cortinas · `plant_pot` Planta em vaso (3) · `rug_round` Tapete redondo
(2×2) · `rug_fur` Tapete de pele (2×1) · `painting` Quadro · `trophy` Troféu de caça · `pot_hooks` Ganchos de cozinha ·
`weapon_rack` Suporte de armas (2×1) · `armor_stand` Suporte de armadura · `fireplace` Lareira (2×1, fogo, calor) · `washtub`
Tina de banho (2×1) · `training_dummy` Boneco de treino.
**Jardim / exterior:** `lamp_stone` Lanterna de pedra · `lamp_wood` Poste de lanterna · `flower_bed` Canteiro de flores (3) ·
`planter` Floreira (2×1) · `stepping` Pedras de caminho (3, plano) · `well` Poço · `signpost` Placa · `bench_stone` Banco de
pedra (2×1) · `garden_arch` Arco de jardim (passa-se por baixo) · `statue` Estátua (2) · `totem` Totem · `woodpile` Pilha de
lenha (2×1) · `haystack` Monte de feno · `cart` Carroça (2×1) · `scarecrow` Espantalho · `birdhouse` Casinha de passarinho ·
`beehive` Colmeia · `drying_rack` Varal de secagem (2×1) · `notice_board` Mural de avisos · `fountain` Chafariz (2×2) ·
`pergola` Pergolado (2×2, passa-se por baixo).
**Peças de construção novas (grupo `fence`):** `fence_stone` Muro de pedra · `hedge` Cerca viva.
**Boneco de treino:** pronto, entra em `game.props` (alvo atacável, nunca quebra, sem saque); cada golpe é a intent
`dummy.hit` → op `dummy.hit` (balanço, número flutuante, palha e som para todos); o anfitrião dá um pouco de XP ao autor
(0,5 por golpe, caindo com muitos golpes seguidos; nada a partir do nível 12). DPS na placa e no quadro do alvo.

## 6. Objetos naturais (worldgen) — interação à mão, somem ao coletar
`pebble` (v 0..3) Pedrinhas no chão → `pebble` · `stick` (0..2) Galhos caídos → `stick` · `fibergrass` (0..2) Capim de fibra → `fiber` ·
`wild_potato`, `wild_cotton`, `wild_corn` (plantas silvestres → comida/algodão + sementes) · além de `bush` (fibra + graveto),
`berrybush` (frutas + graveto), `herbbush` Arbusto de ervas (frutinhas verdes → `herb`), `boulder` (picareta → pedra), árvores (machado → madeira).
Sprites: `pebble_0..3`, `stick_0..2`, `fibergrass_0..2`, `wild_potato_0`, `wild_cotton_0`, `wild_corn_0`.

**Regras de coleta e renascimento (economia):**
- Arbustos, frutas, capim, pedrinhas, gravetos, plantas silvestres e pedregulhos **somem** ao serem coletados.
- Árvore cortada vira toco; cortar o toco de novo (machado, 2 golpes) remove-o (+1 madeira). Tocos somem sozinhos após alguns dias.
- Flora renasce aos poucos por chunk até a densidade original (árvores nascem como muda e crescem), sempre em chão adequado
  ao bioma, **nunca** a ≤ 3 tiles de qualquer construção/piso/canteiro do jogador, nem em túneis minerados, nem à vista do jogador.

## 7. Mineração estilo RimWorld (economia + mundo)
- Designar tiles de rocha (modo "Minerar" ou toque na rocha): ficam marcados; o jogador minera a fila automaticamente
  (anda até um tile vizinho, minera, vai para o próximo). Tocar de novo cancela. Requer picareta.
- Tempo depende da picareta, da dureza da rocha (`world.rockType`: 1 granito duro, 2 calcário, 3 ardósia, 4 mármore) e do minério.
- Rende `stone` (1–2) e o minério do tile (`world.ore`). O tile vira chão de pedra bruta (`G.STONE`).
- **Teto de montanha** (mundo): `world.roof[i] = 1` onde a rocha original era espessa (≥ 2 tiles para dentro). Áreas mineradas
  sob teto ficam **escuras** (luz ambiente ~15%, sem sombras do sol/nuvens, sem chuva) — precisa de tochas. `world.roofAt(tx, ty)`.

**Minérios** (`world.ore`): 0 nenhum · 1 `copper` · 2 `iron` · 3 `coal` · 4 `gold` · 5 `jade`.
Item: copper → `copper_ore`, iron → `iron_ore`, coal → `coal`, gold → `gold_ore`, jade → `jade`.
Distribuição: carvão e cobre comuns perto das bordas (profundidade 1–6), ferro mais fundo (≥ 3), ouro e jade raros (≥ 6).

## 8. Criaturas (combate + arte)
Existentes: `wolf, boar, deer, rabbit, bear`. Novas: `spider` Aranha da caverna (hostil, montanhas/rochas, veneno),
`fox` Raposa (pequena, florestas, foge). Saqueadores: `kind: 'pawn'`, `faction: 'bandit'`, nome "Saqueador",
"Chefe dos saqueadores" (elite) em acampamentos (`world.zones` tipo `bandit_camp`).
Sprites: `spider_{s,n,e}`, `fox_{s,n,e}` (+ `_e_walk`).

## 9. Donos de arquivos nesta rodada
- **Arte A — mundo e construções:** `src/art/trees.js, plants.js, rocks.js, foliage.js, buildings.js`, novos arquivos de
  estruturas (`src/art/structures.js`, `stations.js`, `crops.js`...), `src/art/composeWorld.js`. Registra módulos em `sprites.js`.
- **Arte B — personagens e itens:** `src/art/pawns.js, animals.js, icons.js, fx.js`, novos (`src/art/gear.js`, `items.js`,
  `apparel.js`...), `src/art/compose.js` (pawns/animais), `tools/gallery.*`. Registra módulos em `sprites.js`.
  (`paint.js` é compartilhado: só adicione helpers, não mude os existentes.)
- **Mundo:** `src/world/**`, `src/fx/**`, shaders de terreno/post, mudanças mínimas no `renderer.js`.
- **Economia/construção:** `src/game/content/items.js`, `content/buildings.js`, `content/recipes.js` (novo), `inventory.js`,
  `building.js`, `gathering.js`, `loot.js`, `survival.js`, `save.js`, `physics.js`, novos (`crafting.js`, `equipment.js`,
  `autotile.js`, `flora.js`, `mining.js`, `farming.js`), `src/ui/panels.js` + novos painéis de UI. No `hud.js`, só o bloco dos
  botões rápidos (Mochila/Construir/Criar...).
- **Combate/criaturas:** `src/game/content/combat.js`, novo `content/weapons.js`, `combat.js`, `abilities.js`, `ai.js`, `mobs.js`,
  `nav.js`, `player.js`, novos (`projectiles.js`, `bandits.js`), `src/ui/overlay.js`, e no `hud.js` a barra de ação/quadros.
- **Núcleo (integração):** `src/engine/**`, `src/main.js`, `src/game/game.js`, `systems.js`, `data.js`, PWA, docs.
