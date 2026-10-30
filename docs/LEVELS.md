# WOS · Andares e escadarias (height levels)

Owner's request: height layers. With a staircase (a stairway, not a ladder) the player walks up to the
story above or down to the one below: towers, houses with several stories, and walls you can walk on top
of (ramparts) when a staircase stands next to them. Everything stays deconstructable; built details are
fixed (rebuild to change). Visual ask: **tall facades** (a timber-frame house with a tall front wall, windows,
a door with a canopy, under a tall gable roof) while keeping top-down readability.

Status: **phase 1** (core, stairs, ramparts, replication, scenarios L1–L5) and **phase 2** (tall facades,
upper floors / walls / doors / railings / furniture, support + collapse, J's roofs on top of the highest
story, reveal / cutaway, story selector, save v9, scenarios L6–L8) are implemented.

Code: `src/game/levels.js` (core: level map, collision, stairs, falls, A*, story rules, drawing / reveal /
cutaway helpers), `src/game/mut/levels.js` (op `lv.collapse`), `src/ui/levelbar.js` (story selector),
`src/art/stairs.js` (stairs + slab edge art). Hooks in other files are one-liners marked `levels:` /
`(agent L)`.

---

## 1. Units and conventions

| Name | Meaning |
|---|---|
| `lv` | story index, integer `0` (ground) … `MAX_LV = 3` |
| `z` | continuous height of an entity **in stories** (0 = ground, 1 = on a wall top / 1st upper floor) |
| `STORY_PX` | one story on screen at 64 PPU = **64 px** (`art/structures.js`): a facade tall enough for a door and windows |
| `STORY_H` | screen height of one story in tiles = `WALL_H = STORY_PX / 64 = 1`. A wall top is exactly the floor of the next story, so a pawn on a rampart stands on the drawn top face. |
| level of an entity | `e.lv` = the collision / navigation level it walks on; `e.z` = drawing / combat height. Off stairs `z === lv`. On a stair from `n` to `n+1`, `z = n + u` (u = progress 0..1 along the stair) and `lv = u < 0.5 ? n : n + 1`. During a fall `lv` is already the landing level and `z` eases down. |

Everything without level data is level 0: a structure without `lv`, an entity without `z`, an old save.

## 2. Data model

### 2.1 Structures

- Shared field `o.lv` (integer 1..3, absent = 0), set only by op appliers: `struct.add {list, lv}` carries it
  per batch (a placement drag is always on one story), snapshot section `lvs`, digest rows (§7). Roofs never
  carry `lv` (J's roof sits on top of the highest story, §8).
- Pieces that can stand on a story `k ≥ 1` (any building type except `farm_plot`, `campfire` and razeable ones):
  - `floor_*` at `lv k` = **upper floor** (a slab: walkable surface at level k, ceiling of story k-1);
  - `wall_*`, `door_*`, `column_*` at `lv k` (on a wall top of story k-1 or on an upper floor);
  - `fence_wood` at `lv k` = **railing** (guarda-corpo) along a rampart or a balcony edge;
  - `stairs_*` at `lv n ≥ 1` (surfaces under the whole footprint);
  - furniture / props (chest, bed, stations, decor, K's wall-mounted pieces against an upper wall).
- **Grid keys**: upper pieces go into the same `game.build.grid[layer]` maps with the key
  `tileIdx + lv · W · H` (`autotile.lvKey`). `structureAt(game, tx, ty, layer)` keeps meaning level 0;
  `structureAt(…, lv)`, `connectsAt / computeMask / wallBehind(…, lv)` read a story. Autotile masks connect
  only within one story (rock joins only at level 0). `world.solid` / occupancy stay level 0; upper blocking
  lives in `levels.blk[k]`.
- Stairs (`stairs_wood`): `size [1, 2]`, `rotate` (4 orientations), `block: 'stairs'` (never `world.solid`).
  `rot` = entrance side: 0 S, 1 W, 2 N, 3 E; the stair ascends away from it:

  | rot | footprint | ascends | entrance tile (level n) | landing tile (level n+1) |
  |---|---|---|---|---|
  | 0 | 1×2 | north | `(tx, ty+2)` | `(tx, ty-1)` |
  | 1 | 2×1 | east  | `(tx-1, ty)` | `(tx+2, ty)` |
  | 2 | 1×2 | south | `(tx, ty-1)` | `(tx, ty+2)` |
  | 3 | 2×1 | west  | `(tx+2, ty)` | `(tx-1, ty)` |

### 2.2 Entities

`e.lv`, `e.z` (absent = 0) on the local player, host creatures, remote avatars (`pl.ent`, `pl.av`) and
proxies. Owner-authoritative like positions (§7).

### 2.3 Derived level map (`game.levels`, rebuilt lazily)

Rebuilt from the structure list whenever `game.build.v` changes (every structure op bumps it), so it is a
pure function of replicated state — identical on every peer, no extra ops:

- `surf[k]` (`Uint8Array(W·H)`, allocated only for levels that have any): standable at level k = top of a
  **finished** story-(k-1) wall / door (`connect: 'wall'`; fences are too thin), or a finished upper floor at k.
- `blk[k]`: blocked at level k (story-k walls, closed story-k doors, railings, solid furniture: every
  `block: 'tile'` piece).
- `stairs[]` + `st[k]` (stair index + 1 at level n = steps, at n+1 = the open stairwell above them).
- `active` = any stairs; `hasUpper` = any piece above the ground. With neither every hook takes the old path.
- Story queries: `storeysAt(x, y)` (1 + highest story holding a wall / floor; J's eaves), `storeysIn(tiles)`,
  `supportedL`, `surfaceUnder`, `upperReason`, `buildStartReason`, `unsupported`, `lostWithout(gone)`,
  `pickUpper(wx, wy)`.

`world.levels = game.levels` so `physics.js` / `combat.hasLOS` reach it with only the world.

## 3. Support and collapse

- An upper floor tile at level k is **supported** when a support of story k-1 is within `ROOF_GEOM.support = 6`
  tiles (J's radius, euclidean): a wall / door (`connect: 'wall'`), a column (`def.support`), or natural rock at
  k = 1. Every other upper piece needs a **surface** under its footprint: an upper floor of its story or the top
  of a story-(k-1) wall.
- Placement (`placeReason(…, lv)` → `levels.upperReason`, same contract as `placeReason`): "Precisa de apoio:
  paredes ou colunas no andar de baixo a até 6 tiles", "Precisa de piso embaixo (ou o topo de uma parede)",
  "Vão da escada: deixe aberto" (no floor over a stairwell), "Árvore ou pedra embaixo: tire antes" (story-1 floor
  over a tree / boulder), "Isto só pode ficar no chão", "Encoste numa parede pronta" (mounted decor), door
  replacing a wall of the same story. Planned (blueprint) supports / floors count for planning.
- Work start (`build.hit` → `levels.buildStartReason`): the support / floor under it must be **finished**
  ("Sem apoio: termine as paredes do andar de baixo primeiro", "Construa o piso embaixo primeiro"). Upper pieces
  are built from the ground (2D reach), like J's roofs.
- **Collapse**: right after the structures change, the host's levels system lists finished upper pieces with no
  support / surface left and emits **`lv.collapse {ids, drops}`**: dust, chips, `roof_collapse` crash, half the
  materials and every chest content as loot on the ground below. A collapse can leave more pieces unsupported:
  the next check takes them (cascade, one story per frame). Entities on vanished surfaces fall (§4.6). J's roofs
  follow their own support rule on the story below (their eaves drop back when the upper story goes).
- Deconstruction stays free; marking something an upper story rests on asks for a second tap: "O andar de cima
  vai desabar (n peças)! Toque de novo para confirmar" (`building.confirmSupports` + `levels.lostWithout`).

## 4. Stairs and movement

### 4.1 Stair placement

- Footprint free at level n (level 0: `placeReason`; n ≥ 1: surfaces under every tile).
- **Open stairwell**: at level n+1 nothing may cover the footprint — no upper floor, no wall top, no roof under
  the stair's top ("Tire o piso / o telhado de cima da escada primeiro"). Conversely J's roofs and upper floors
  refuse stairwell tiles (`levels.stairwell(tx, ty, lv)`).
- The landing need not exist yet; the ghost rings the landing tile on its story (green = a surface is there).

### 4.2 Collision per level

A tile is free at level k when: k = 0: `tileBlocked` rules and not a stair tile (stair sides are walls except
through the entrance); k ≥ 1: `surf[k]` set and `blk[k]` not — everything else is **air** and blocks, so nobody
walks off a rampart or an upper floor. Stair tiles: bottom step only from the entrance, top step only from the
landing. Round props collide only with entities of their own story. Closing a door / nudging creatures out of a
new piece works per story.

### 4.3 Stair traversal

On a stair: movement projected on the stair axis, lateral eased into the corridor (side rails), `z = n + u`,
`lv` switches at u = 0.5. Speed ×0.8; hollow `step_stairs` footsteps; wall material on wall tops.
The bottom and top steps are also entered and left **sideways** (`side0` / `side1`: the tiles beside them):
pushing past a rail in the first / last third of the stair steps off onto the ground (bottom) or onto the wall
top / upper floor (top) when that side is free.

**Never stuck.** A body that already sits inside blocked geometry may always move to where it sits less or
equally deep (`levels.penL` / `_eases`), so it slides out instead of freezing. Two cases this covers:
- the corner trap: next to an end step, in the diagonal tile, the body overlapping the step that is only open from
  its entrance or sides;
- a wall built over a player.

As a last resort, ~2 s of pushing without moving with all 8 directions blocked, on any level, puts the player on
the nearest free spot (the ground when up high; toast). A fuzz test moves a body randomly around 4 stairs set
against walls (`tools`-style headless run): 0 stuck positions in ~1500 runs (8 in 512 before).

### 4.4 Wall tops (ramparts)

Tops of finished walls and doors are surfaces of the next story: a wall line with a staircase next to it is a
rampart; fences on it are railings.

### 4.5 Jump down

Pushing against an edge for ~0.9 s while not moving: a short hop to the free tile beyond, one story down
("Continue empurrando para pular" the first time). Owner-side, replicated like any movement.

### 4.6 Falling

An entity off stairs at level k ≥ 1 whose tile is no longer a surface (deconstruction, collapse) falls to the
highest surface below (else the nearest free ground spot): `lv` at once, `z` eases down with gravity, a thud and
dust. No fall damage (relaxing game).

## 5. Navigation

`levels.findPath(sx, sy, slv, gx, gy, glv)` — budgeted A* over `(tile, level)` nodes; stairs are portals;
waypoints `[x, y, lv]`. `nav.steer(…, glv)` plans with it when levels are active or the mover is up high.
Creatures / bandits climb stairs to reach a target. The player's interact goals path to the object's story for
doors, chests, beds and stations (used only from their own story); blueprints are worked from anywhere in reach.

## 6. Combat across levels

- Melee only on the same story (`sameLevel`: `|z_a − z_b| < 0.5`).
- Ranged across stories with height LOS (`combat.hasLOS(…, z0, z1)`), projectiles `z0 → z1`, +12 % range per
  story of advantage (max 2), AoE only on the caster's story.

## 7. Sync

| What | How |
|---|---|
| structure `lv` | `struct.add {list, lv?}` (whole batch); `build.place {…, lv}`; `build.move` keeps the story; snapshot section `lvs: [[structId, lv]]` (only lv > 0) with reconcile comparing `lv`; digest `structs` rows end with `lv` |
| collapse | host op `lv.collapse {ids, drops}` |
| reveal / cutaway | cosmetic `o.alpha` only (`COSMETIC_FIELDS`), never sent |
| player `z` | presence `st`/`sts` key `z` (2 decimals, omitted when 0) next to H's look and the chat `ty` flag; host avatar `av.z`/`av.lv` |
| creature `z` | entity stream `dyn[12] = round(z·100)` (trailing zeros trimmed) |
| projectiles | `proj` args `z0, z1` |
| save | **v9** (v8 = M's terrain paths): world part = snapshot (`lvs` included), player `z` (restored only if a surface is still there). Saves v1–v8 load with everything on the ground. |

`PROTO 5`. The level map is derived from replicated structures only.

## 8. Rendering by level (3/4 view)

- **Tall facades**: `STORY_PX = 64` — wall fronts, door leaves (`DH = FH − 1`), timber frames, logs, courses,
  K's windows / mounts / lanterns / sconces (`ARCH_GEOM.dlanternLift / sconceLift`, `MOUNT_UP`) and torches are
  painted for a 1-tile story; stairs climb one full story. K's per-story bands stack because an upper wall is
  drawn by the same painters with its base lifted.
- **Upper pieces** (`levels.drawUpper`, game.js hook): the normal painters with the base lifted by
  `lv · STORY_H`, every sprite (floor / blob / sill too) into the sorted batch; depth key
  `_sy = y + 0.001·lv − (floor 0.0006 | rug 0.0003)` (slab, then rugs, then what stands on it); upper blueprints
  get the blue plan grid, decon marks the red ring; an overhanging upper floor shows a beam under its south edge
  (`slab_edge`, painted on demand through K's lazy registry); K's door canopy below an upper wall is re-drawn in front of it
  (`archCompose.archSprite`, lazy too). K's lazy style / detail sprites and the baked default looks (their fallback) are
  both painted for a full story.
- **Entities**: base lifted by `z · STORY_H`; depth `y + z`; camera follows `y − z · STORY_H`; plates, rings, bars
  lifted.
- **Roofs** (J): `roofEaveH(storeys)` with `game.build.storeysAt / storeysIn` — the eaves sit on top of the
  highest story; J's region art is repainted when the upper stories under it change.
- **Reveal** (cosmetic, local player, view level `V = round(player.z)`): inside a building (J's roof region, else
  a closed room on the ground with no slab right overhead — under a stairwell —, else the upper slab right above
  the player) every upper piece above V on it or on its wall ring fades to 0; from outside a multi-story house
  shows its stacked facades under the roof. A slab right above the player (a second story, a balcony / veranda)
  also counts as indoors for the camera (`game.indoors` kind 'built', region −1).
- **One owner per faded piece**: a piece the reveal fades is left alone by the cutaway, and a piece the cutaway
  wants back is handed over by the reveal (two fades writing one `o.alpha` used to settle half-way).
- **Culling**: furniture and entities under an opaque upper floor (not faded) are not drawn (they would poke
  through the slab), nor pickable.
- **Window glow** (K): the additive night glow of a window is skipped while its face is covered — an upper floor
  or a stair right in front of the wall, or someone standing before it (archCompose `faceCovered`).
- **Cutaway** (RimWorld-style, cosmetic): walls of the local player's room whose north tile is inside the room
  (south walls, inner partitions) and the walls just south of the player fade to 0.22; on an upper story the
  room is the floor slab around the player. Everything eases back when the player leaves.
- **Picking**: `levels.pickUpper` (upper pieces under the cursor, lifted, faded ones skipped) before the ground in
  `structureAtPoint` and `controller.pick`; a decon drag that starts on an upper piece marks that story.

## 9. Build mode on a story

`game.build.mode.lv` = the story to build on, by default the player's (`round(z)`); roofs always 0.
`src/ui/levelbar.js` shows "Andar ▲ Térreo / 1º andar / 2º andar / 3º andar ▼" (PageUp / PageDown on desktop)
while placing, when there is anything to build on above the ground. The ghost, the hovered tile
(`originAt` lifts the cursor), masks, mounts and the stairs landing ring follow the story; the commit sends
`build.place {…, lv}`.

## 10. Interfaces with J and K (as implemented)

- J: `ROOF_GEOM.support` (radius), `def.support` columns, `enclosedRoom` (cutaway room), `game.indoors` +
  region fades (reveal follows the region the player is under), `roofEaveH(storeys)` fed by
  `game.build.storeysAt / storeysIn` (one-line hook in `roofs.artSpec` and the roof blueprint grid),
  stairwell refusals both ways.
- K: `o.style` / `o.det` / `_k` work on any story (carpet masks use the story key); `wallBehind(…, lv)` for
  mounted decor; facade constants follow `STORY_PX`.

## 11. Scenarios

L1 (guest builds stairs, climbs a rampart, host sees lv 1, hop down) · L2 (no melee onto a rampart; control) ·
L3 (bandit archer shoots up) · L4 (creature climbs stairs) · L5 (save on a rampart; older save at level 0) ·
**L6** (guest plans and builds a second story — floor, wall row, door, chest — with real work; refusals; same
story map on both; snapshot `lvs`; climbs in and is stopped by the upper door / walls) · **L7** (host removes the
ground walls: `lv.collapse` on both, chest items dropped, guest falls) · **L8** (save v9 keeps the stories, the
player wakes up upstairs; a v8 save still loads).

## 12. Known limits

- Upper pieces are built from the ground (no scaffolding): the work loop uses 2D reach.
- J's indoors (rain, warmth, zoom) counts J's roofs; an upper floor without a roof above it is not "indoors"
  for the story below.
- The level bar picks one story per placement; a drag never spans stories.
