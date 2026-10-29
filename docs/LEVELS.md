# WOS · Andares e escadarias (height levels) — design

Owner's request: height layers. With a staircase (a stairway, not a ladder) the player walks up to the
story above or down to the one below: towers, houses with several stories, and walls you can walk on top
of (ramparts) when a staircase stands next to them. Everything stays deconstructable; built details are
fixed (rebuild to change).

Status: **phase 1 implemented** (core, stairs, ramparts, replication, basic level drawing, scenarios
L1–L5). **Phase 2** (after J — roofs — and K — details — land): upper floors, upper walls / doors /
railings / furniture, support + collapse, roof integration, reveal / hide, K styles on upper pieces.
Sections marked **[P2]** are design only.

Code: `src/game/levels.js` (core, pure simulation + small draw helpers), `src/game/mut/levels.js` (ops,
[P2] mostly), `src/art/stairs.js` (art). Hooks in other files are one-liners marked `// levels:`.

---

## 1. Units and conventions

| Name | Meaning |
|---|---|
| `lv` | story index, integer `0` (ground) … `MAX_LV = 3` |
| `z` | continuous height of an entity **in stories** (0 = ground, 1 = on a wall top / 1st upper floor) |
| `STORY_H` | screen height of one story in tiles = `WALL_H` (`26/64`, the wall front face). A wall top is exactly the floor of the next story, so a pawn on a rampart stands on the drawn top face. If walls get taller (K), `STORY_H` follows `WALL_H`. |
| level of an entity | `e.lv` = the collision / navigation level it walks on; `e.z` = drawing / combat height. Off stairs `z === lv`. On a stair from `n` to `n+1`, `z = n + u` (u = progress 0..1 along the stair) and `lv = u < 0.5 ? n : n + 1`. During a fall `lv` is already the landing level and `z` eases down. |

Everything that exists today is level 0: a structure without `lv` is `lv 0`, an entity without `z` is on
the ground, an old save has no level data at all.

## 2. Data model

### 2.1 Structures

- Shared field `o.lv` (integer, absent = 0; phase 1: always 0, [P2] set) only in op appliers (`struct.add` carries it per batch, a
  placement drag is always on one story), serialized, digested (§7).
- Structures that exist on upper levels **[P2]** (all placed with `lv = k ≥ 1`):
  - `floor_*` at `lv k` = **upper floor** (a slab: walkable surface at level k, ceiling of story k-1);
  - `wall_*`, `door_*`, `gate/fence` at `lv k` (stacked on a wall top or standing on an upper floor);
  - `railing_wood` ("Guarda-corpo") at `lv k`: a low fence-like edge piece, blocks walking at level k;
  - `stairs_*` at `lv n ≥ 1` (needs surfaces under its whole footprint at level n);
  - furniture / props at `lv k` (chest, bed, table, torch…) standing on surfaces at level k.
- **Grid keys [P2]**: upper structures go into the same `game.build.grid[layer]` maps with the key
  `tileIdx + lv * W * H` (two-line hook in `autotile.gridAdd/gridRemove`), so `structureAt(game, tx, ty,
  layer)` keeps meaning "level 0" for all existing code and `structureAtL(game, tx, ty, layer, lv)` reads any
  level. Autotile masks connect only within one level (same key offset). `world.solid` stays the level-0
  grid; upper blocking lives in `levels.blk[k]` (§2.3).
- Stairs (`stairs_wood`, phase 1): `size [1, 2]`, `rotate` (4 orientations), `block: 'stairs'` (never
  `world.solid` — the level module does its collision). `rot` = front (entrance) side: 0 S, 1 W, 2 N, 3 E;
  the stair ascends away from its front:

  | rot | footprint | ascends | entrance tile (level n) | landing tile (level n+1) |
  |---|---|---|---|---|
  | 0 | 1×2 | north | `(tx, ty+2)` | `(tx, ty-1)` |
  | 1 | 2×1 | east  | `(tx-1, ty)` | `(tx+2, ty)` |
  | 2 | 1×2 | south | `(tx, ty-1)` | `(tx, ty+2)` |
  | 3 | 2×1 | west  | `(tx+2, ty)` | `(tx-1, ty)` |

### 2.2 Entities

`e.lv`, `e.z` (absent = 0) on the local player, host creatures, remote avatars (`pl.ent`, `pl.av`) and
proxies. Owner-authoritative like positions: the local player's mover writes them; host creatures are moved
by the host; remote copies get them from the presence / entity streams (§7).

### 2.3 Derived level map (`game.levels`, rebuilt lazily)

Rebuilt from the structure list whenever `game.build.v` changes (every structure op bumps it), so it is a
pure function of replicated state — identical on every peer, no extra op hooks:

- `surf[k]` (`Uint8Array(W·H)`, allocated only for levels that have any): 1 = standable surface at level k:
  top of a **finished** level k-1 wall / door (`connect: 'wall'`; fences and gates are too thin), [P2] an
  upper floor at level k, top of a [P2] column of story k-1.
- `blk[k]` **[P2]**: blocked at level k (level-k walls, closed level-k doors, railings, solid furniture).
- `stairs[]`: `{ o, n, axis, sg, b, len, l0, l1, tiles[], entrance, landing }` (n = base level = `o.lv`);
  `st[k]` (`Int32Array`, stair index + 1) marks stair tiles at level n (the steps) and at level n+1 (the open
  stairwell above them, entered only from the landing).
- `active` = any stairs or upper surfaces exist. When false every hook takes the old level-0 path
  (zero cost for worlds without levels).

`world.levels = game.levels` so `physics.js` / `combat.hasLOS` reach it with only the world.

## 3. Support rules [P2] (consistent with J's roof support)

- An upper floor tile at level k is **supported** when a support element of story k-1 is within
  `SUPPORT_R = 6` tiles (euclidean, tile centres; the same radius J uses for roofs): a finished level k-1 wall /
  door, a column ("Coluna", J), or natural rock at k = 1. Upper floors also need 4-connectivity to a supported
  tile (no floating islands). Upper walls / railings / furniture need a surface under their footprint.
- Placement refuses unsupported pieces ("Precisa de apoio: paredes ou colunas a até 6 tiles").
- **Collapse**: when a support or a surface is removed (`struct.remove` from decon, raze, collapse), the host
  recomputes support for upper structures within `SUPPORT_R + 1` of it and emits
  `level.collapse {ids, drops}` (half the materials as loot at the level below, a dust puff, a crash sound).
  Collapsing floors take what stands on them (cascade, same op). Entities on vanished surfaces fall (§4.6).
  Collapse runs only on the host; guests just apply the op.
- Deconstruction stays free (everything is deconstructable): taking down a support simply collapses what
  depended on it (the decon menu warns: "Isto segura o andar de cima").

## 4. Stairs and movement

### 4.1 Stair placement

- Level n stair: footprint tiles free at level n (level 0: the usual `placeReason` — no rock, water, other
  main-layer structure; [P2] level ≥ 1: surfaces under every tile, no blocker).
- **Open stairwell**: at level n+1 nothing may cover the footprint — no roof (J), no upper floor, no wall top.
  "Tire o telhado / piso de cima da escada primeiro" (remove roof tiles first; roofs and floors are
  deconstructable). Conversely J's roof placement and [P2] upper floors refuse tiles over a stairwell
  (`game.levels.stairwell(tx, ty, lv)`).
- The landing does not need to exist yet (stairs may be built before the wall); the ghost shows the landing
  tile (green = a surface is there).

### 4.2 Collision per level

A tile is **free at level k** for an entity when:
- k = 0: today's rule (`tileBlocked`: rock, deep water unless swimming, `world.solid`), and it is not a stair
  tile (stair tiles at level 0 are side walls of the stair except through its entrance);
- k ≥ 1: `surf[k]` is set and `blk[k]` is not — every other tile is **air** and blocks. Walkable edges are
  therefore bounded by construction: nobody walks off a rampart into the air.
- Stair tiles: the bottom step is free at level n only for an entity whose centre is on the entrance tile, the
  top step free at level n+1 only from the landing tile. Round props (trees, chests…) collide only with
  entities of their own level (`o.lv ?? 0`).

### 4.3 Stair traversal

An entity is **on** stair s when its centre is inside the footprint and `e.lv ∈ {n, n+1}` (derived each step
from position; no hidden state). On a stair: movement is projected on the stair axis, the lateral coordinate
is eased into the corridor (`[l0 + r, l1 − r]`, side rails), `z = n + u`, `lv` switches at u = 0.5. Leaving
past the bottom edge needs the entrance free at level n; past the top edge the landing free at level n+1;
otherwise the entity stops at the edge. Speed on stairs ×0.8 (`levels.speedAt`); water / mud slowdowns only
at level 0. Footsteps on stairs use the hollow `step_stairs` sound (alias `stairs_step`), on wall tops the wall material.

### 4.4 Wall tops (ramparts)

Tops of finished walls and doors are level-1 surfaces (level k+1 above level-k walls, [P2]): a wall line with a
staircase next to it is a rampart. Diagonal squeezes between wall tops that only touch at a corner are blocked
like any corner. Doors keep their lintel walkable, open or closed.

### 4.5 Jump down

A player stranded up high (stairs removed) or wanting a shortcut keeps pushing against an edge of a surface
for ~0.9 s while not moving: a short hop lands on the tile beyond at the level below (if it is free there).
"Continue empurrando para pular" hints the first time. Creatures never jump. Owner-side movement, replicated
through presence like any movement.

### 4.6 Falling

An entity off stairs at level k ≥ 1 whose tile is no longer a surface (wall deconstructed, collapse, stair
removed under it) falls to the highest free level below at that tile (else the nearest free ground spot):
`lv` switches at once, `z` eases down (gravity), a thud and a dust puff on landing. The owner applies it (local
player; host creatures); remote copies follow the stream. No fall damage in phase 1 (relaxing game); [P2]
optional small damage from ≥ 2 stories.

## 5. Navigation

`levels.findPath(game, e, gx, gy, glv)` — the same budgeted A* (octile heuristic, no corner cutting) over
nodes `(tile, level)`:
- node ids: `tileIdx` for level 0; `W·H + j` for the j-th upper surface (`node[k][tileIdx]` lookup, only levels
  that have surfaces);
- level k node: the 8 neighbours free at level k; stair tiles only along the stair axis (entrance ↔ bottom
  step … top step ↔ landing) — **stairs are portals**;
- waypoints carry their level: `[x, y, lv]`.

`nav.steer(game, e, gx, gy, dt, speed, arrive, glv)`: when `game.levels.active` it plans with the level A*,
never drops a path for a direct seek when `glv ≠ e.lv` or `e.lv > 0`, smooths only between level-0 waypoints of
a level-0 entity (stair tiles block `clearLine` / `walkable`), and probes obstacles with the level collision.
Creatures and bandits therefore climb stairs and walk ramparts to reach a target; an unreachable target (no
stairs) ends in partial paths → `nav.fails` → evade, as today.

## 6. Combat across levels

- `sameLevel(a, b)` = `|z_a − z_b| < 0.5`. **Melee only on the same level**: `combat.reach(a, b)` returns −1
  across levels, so every melee check (creature bites, bandit swings, the player's auto attack, melee
  abilities, charge) fails and the creature keeps pathing (stairs) or gives up.
- **Ranged across levels with line of sight**: the sight line goes from `z_a + 0.5` to `z_b + 0.5` (stories);
  a level-k blocker (level 0: rock, `world.solid`; [P2] `blk[k]`, upper floors crossed) blocks only where the line
  is inside `[k, k+1)`. A rampart shooter sees over the walls around it; a target on a wall is visible over
  walls in the near half of the line, and still hidden by walls right in front of the shooter. Rock always blocks.
- Projectiles fly the same line (`pr.z0 → pr.z1`), hit only entities within 0.75 story of the line, are drawn
  lifted by `z · STORY_H`, and the cosmetic copies get `z0 / z1` in the `proj` args.
- **Height bonus**: ranged range +12 % per story of advantage over the target (max 2 stories) for players
  (`attackRange`) and bandit archers.
- AoE abilities hit only targets on the caster's level (`areaTargets` filter).

## 7. Sync

| What | How |
|---|---|
| structure `lv` [P2] | `struct.add {list, lv?}` (per batch); snapshot section `lvs: [[structId, lv]]` (only lv > 0; absent = all 0); digest part `levels` (rows `[id, lv]` + per-level hashes of `surf`/`blk`) |
| collapse [P2] | `level.collapse {ids, drops}` host op; `level.place`-free: upper pieces use `build.place {…, lv}` |
| player `z` | presence `st`/`sts` entry key `z` (2 decimals, omitted when 0); interpolated with x/y in the sender clock; host avatar `av.z`/`av.lv` (AI / hit checks) |
| creature `z` | entity stream `dyn[12] = round(z·100)` (trailing zeros trimmed: free when 0); proxies interpolate it |
| projectiles | `proj` args gain `z0, z1` (`×100`, trailing) |
| save | world part = snapshot (`lvs` included); player `z` (restored only if a surface is still there, else ground) |

`PROTO` 2 → 3 (presence / entity / projectile formats grew). Determinism: the level map is derived from
replicated structures only; randomness none; host AI uses `av.z`.

**Save migration**: none needed — old saves have no `lvs` and no player `z`: everything loads at level 0.
The data version stays 4 (only optional data was added); scenario L3 checks it.

## 8. Rendering by level (3/4 view)

- One story = `STORY_H` = 0.406 tiles up on screen (§1). An entity is drawn with its base lifted by
  `z · STORY_H` (contact shadow and sun shadow move with it: it stands on the wall top).
- **Depth order**: the single sorted batch uses `_sy` when present: entities `y + z` (one tile of depth per
  story: a pawn on a wall top draws after the wall under it, before walls / trees further south of it); stairs
  `ty + 0.2` (before anything standing on them); flat upper slabs [P2] `y + 0.001·lv`; upper walls [P2] base `y`.
- **Camera** follows the elevated position (`y − z · STORY_H`), smoothly while climbing.
- Name plates, target rings, hp bars, floating numbers use the lifted position (`levels.liftOf(e)`).
- Remote players / proxies: drawn from their replicated `z` like the local player.
- **[P2] reveal / hide** (local player's view level V = `round(player.z)`):
  - structures and entities above V inside the building the player is in fade out (J's roof fade drives
    roofs; the same alpha drives upper floors / upper walls of that building);
  - things on cells covered by a slab at level ≤ V (upper floor, roof) and below it are **not drawn** while the
    player stands above them (they are under the floor) and are drawn faded / hidden from outside like J's roofed
    interiors;
  - from outside (V = 0, not under the building) a multi-story house shows its walls stacked with the upper
    floor / roof over the interior (J's rule).

## 9. Interfaces needed

### From J (roofs, interiors, caves)
1. Roof tiles carry a story: a roof over walls of story k-1 is the ceiling of story k-1 at `lv k` (roof `lv`
   field, default 1). `game.roofs.at(tx, ty, lv)` → roof piece or null.
2. One support rule for roofs and upper floors: `game.roofs.supported(tx, ty, lv)` (walls / columns / rock of
   story lv-1 within 6), or J exports the radius + the support element test and L calls it. Columns ("Coluna")
   must be stackable per story (`lv`).
3. Collapse uses host ops; J's roof collapse op and L's `level.collapse` should share one cascade pass (a
   removed upper floor drops the roof on top of it).
4. Indoors: `game.indoors(x, y, lv)` must count an upper floor above as a ceiling (no rain, warmth, indoor
   audio, zoom-in) — the upper floor is the roof of the story below.
5. Roof fade: J's fade alpha per building region exposed (`game.roofs.fadeAt(tx, ty, lv)`), so L fades upper
   floors and upper walls with the same curve; J's roof placement refuses stairwell tiles
   (`game.levels.stairwell(tx, ty, lv)`).

### From K (details, styles)
1. `o.style` / `o.det` work on structures of any `lv` (the painters receive the lift; facades get a
   `story` index so a 2-story wall can show a beam / trim between stories).
2. Multi-story facade art: a level-k wall on top of a level k-1 wall draws its front face directly above the
   lower one (no outline seam) — K owns the wall art, L supplies the lift and the stacking mask (wall below?).
3. Railings ("Guarda-corpo") and stair styles (stone / wood, with / without handrail) as K style variants of
   L's structures; corner details on wall tops stay cosmetic (never block rampart walking).

## 10. Phase 1 scope (implemented)

- `src/game/levels.js`: level map, per-level collision + stair traversal (`move`), falls, jump down, level A*,
  `sameLevel`, `liftOf`, `heightK`, speed, footstep surface, depth keys, levels system; height LOS in
  `combat.hasLOS(…, z0, z1)`.
- `stairs_wood` (Escada de madeira, 1×2, 4 orientations, wood 6) with procedural art (`src/art/stairs.js`).
- Ramparts on finished walls / doors; creatures / bandits path through stairs; melee same level only; ranged
  across levels with height LOS + range bonus; projectiles with heights.
- Replication: presence `z`, entity stream `z`, projectile `z0/z1`, player `z` in the save, `PROTO 3`. Structure
  `lv` is read by the level map (absent = 0) but nothing can be placed above level 0 yet, so its op arg / snapshot
  section / digest part (§7) land in phase 2 with upper placement.
- Drawing: lifted entities, depth keys, camera, name plates / rings.
- Scenarios L1 (guest builds stairs, climbs a rampart, host sees it at level 1, hop down), L2 (creature can't
  melee a rampart player; control on the ground), L3 (bandit archer shoots up), L4 (creature climbs the stairs to
  reach the player, proxy z 1), L5 (save on a rampart restores it; an older save loads at level 0).
- Upper floors / roofs: **not** in phase 1; see [P2].
