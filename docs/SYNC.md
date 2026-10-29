# WOS — Multiplayer sync: root causes, replication design, regression guards

Status: **implemented** (design by the sync analyst; implemented by the CODER — see §7 for what changed
during implementation and the exact test API; the TESTER verifies it with `tools/mp-test.html`).
Scope: everything the user saw in the first real 2-player test, plus everything else that will
desync, plus the mechanisms that keep it from coming back when new content is added.
Code identifiers are in English; player-facing strings stay pt-BR.

---

## 0. TL;DR

| Symptom | Root cause (verified) | Fix |
|---|---|---|
| Sticks **pink** on one machine only | That client's cached atlas contains the magenta `stick_0` **placeholder** (`sprites.js:87`) because `addNatural` threw during a paint run; the failed atlas was cached with no validation, and the atlas cache key is computed from sources fetched at runtime (racy with the stale-while-revalidate SW), so a stale/failed atlas can be stored under the *new* key and reused forever. The handshake never compares builds/art. | `BUILD_ID`/`ART_ID` stamped into the code, atlas key = running code's `ART_ID`, validate cached atlas against required names, never cache an atlas with failures, SW network-first, handshake refuses mismatched build/atlas. |
| Remote walk **very sped up** | `session.js:527` advances remote `moveT` by `2.2 × distance + 0.2·dt`; local players advance `0.25 × distance` (`game.js:66`). Measured **×9.0**. | One shared gait function `stepGait(e, dist)` (0.25/tile) used everywhere. |
| Spider shown as **deer-like** animal with the spider's **name**, attacking | (1) In Phase 1 every client simulates its own creatures: the creature attacking a player exists only in that player's world. (2) When the atlas has no `spider_s`, `artcompat.js:26-31` silently swaps the species to **wolf × 0.6 scale** (a small tan quadruped) while the nameplate/AI still come from `SPECIES.spider` → "a deer with the spider's name attacking me". Reproduced (see §1c). The same stale/broken atlas as the pink sticks. | Host-authoritative creatures streamed to guests; atlas validation; art fallbacks become loud (netlog + dev marker) and impossible in a validated atlas. |
| NPCs chasing me invisible to him; his buildings not visible to me; … | Phase 1 only replicates presence/chat/clock/weather. Everything else (`installSystems`, `systems.js:24-79`) runs independently on each client, with `Math.random`, local saves, local ids and `game.player`-only logic. Verified in two tabs. | Host-authoritative world: intents → host → sequenced deterministic ops; entity snapshots; join snapshot; guards. |

Architecture in one paragraph: **the host is the only authority for the shared world** (objects, tiles,
structures, loot, crops, flora, creatures, camps, projectiles fired by creatures, world time, weather).
**Each player is authoritative for its own avatar** (movement, inventory, equipment, XP, hunger, energy,
HP — damage is *applied by the owner* when the host says "you were hit", attack rolls are made by the
attacker). Guests never mutate shared state: they send **intents**; the host validates them, decides
all randomness, and broadcasts **ops** (sequenced, deterministic appliers that every peer — host
included — executes through the same code). Single-player is "host with zero peers", so it runs the
exact same path. Creatures are simulated only on the host and streamed (10 Hz, interest-managed) to
guests, who render AI-less proxies. A guest joining mid-game regenerates the seed world and applies a
**world snapshot** produced by the same serializer as the save file. Regression guards: a static lint
(`tools/check-sync.mjs`), runtime mutation guards, mandatory `sync` tags on systems, a digest-based
desync detector with auto-resync, a build/atlas identity check at handshake, and a two-client test
harness.

---

## 1. Root causes (verified in code, reproduced where possible)

Reproduction setup used: dev server `http://localhost:5173`, host tab `?seed=7` + `new Session().host(game)`,
guest tab `?sala=CODE` → Entrar (real WebRTC via Trystero). Test saves were deleted afterwards and
`wos.seed` restored.

### 1a. Pink sticks on one machine only

Facts:
- The **only** pink in the code base is the contract placeholder: `src/art/sprites.js:80-89`
  (`ensureContract`, `fillStyle = '#c040c0'`, a magenta disc). `stick_0` is in `CONTRACT` (`sprites.js:75`).
  `atlas.pick('stick', v)` (`engine/atlas.js:42-46`) wraps over the group, so if the group is only the
  placeholder `stick_0`, **every** stick is pink.
- A placeholder exists only when the painter group failed: each group runs in `try/catch`
  (`sprites.js:43-45`); `addNatural` (`art/natural.js:132-139`) adds `pebble_0..3` first, then sticks,
  fibre grass and wild plants. A throw at `stick(0)` leaves pebbles normal and sticks/fibregrass/wild
  plants as pink placeholders — exactly "sticks pink".
- `natural.js` has not changed since `16d59c2`, and its helpers in `paint.js` only got additions, so the
  painter does not throw deterministically: the failure is **client-specific** (e.g. a canvas allocation
  failure under memory pressure — ~560 software canvases + 2× supersampled temporaries are alive until
  `cropAll`, `paint.js:62-99, 228-280`; or a run with mixed module versions, see below).
- The failed atlas is then **cached as if it were good**: `main.js:50-54` stores whatever `buildAtlas()`
  returned (`storeAtlas`, `atlasCache.js:72-88`); nothing records or rejects placeholders/failures, and a
  later hit (`atlasCache.js:58`) reuses it on every boot until the art code changes.
- The cache **key is computed from sources fetched at runtime**, not from the code that is running:
  `atlasCache.js:23-44` `sourceHash()` does `fetch(url)` of every module reachable from `sprites.js`.
  In production those fetches go through the service worker (`sw.js:16-28`, stale-while-revalidate) and
  the HTTP cache (GitHub Pages `max-age=600`). Race after a deploy:
  1. Boot N: the SW answers the module graph from its cache (**old** code runs) and revalidates each file
     in the background (`sw.js:21-25`, `cache.put`).
  2. Later in the same boot `sourceHash()` fetches the same URLs; if revalidation finished, it reads the
     **new** files → key = NEW.
  3. Miss → `buildAtlas()` paints with the **old** code → `storeAtlas(NEW key, OLD atlas)`.
  4. Boot N+1: new code, key NEW → **hit** → the old atlas is used with the new code, indefinitely.
  The SW also revalidates files independently, so a boot can run a **mix of two deploys** (each module
  from a different time; the HTTP cache can itself return 10-minute-old files during revalidation).
  On the deploy day there were ~45 commits between 18:38 and 23:22 (`git log`), so this window was wide open.
- The two clients were never compared: `hello` carries `build: BUILD` but `_onHello` only checks
  `m.v !== PROTO` (`session.js:325`); `PROTO = 1` and `BUILD = '2026.10.28'` are hand-edited constants
  (`net/netlog.js:9-10`), identical for every commit of that day.
- Not reproducible on localhost by design (`atlasCache.js` disabled on localhost, SW not registered:
  `main.js:160`), which is why development never saw it.

Fix (all of it, see §3.10 and §5 tasks A1–A4):
1. `tools/stamp.mjs` generates `src/version.js` with `BUILD_ID` (hash of every file under `src/` +
   `index.html`) and `ART_ID` (hash of the art module graph: same import walk as `sourceHash`). It also
   rewrites `sw.js` `VERSION` and is verified by `tools/check-sync.mjs`.
2. Atlas cache key = `ART_ID` **imported as a constant** (identity of the code actually running) + atlas
   format tag. No runtime source fetching.
3. `buildAtlas()` returns `atlas.failures` (painter groups that threw) and `atlas.placeholders` (contract
   names that got the magenta disc). **Never store an atlas with failures or placeholders**; log them to
   `netlog.error('art', …)` and show a dev toast.
4. On a cache hit, validate: `meta.artId === ART_ID`, `meta.placeholders.length === 0`, and every name
   from `requiredSprites()` is present (CONTRACT ∪ `<species>_{s,n,e}` for every non-pawn `SPECIES` ∪ one
   sprite per `BUILDINGS` type per the `hasArt` rule ∪ `<kind>_0` per flora/natural kind ∪ `crop_<kind>_0`).
   Invalid → discard and repaint.
5. SW: **network-first** for same-origin GETs with `fetch(req, { cache: 'no-cache' })` (cheap 304s,
   bypasses the 10-min HTTP cache), fall back to the SW cache only when offline; `VERSION` = `'wos-' + BUILD_ID`.
6. Handshake: `hello` carries `build: BUILD_ID` and `art: atlasDigest` (hash of the **sorted sprite
   names** only — pixel sizes can differ by a pixel between browsers). Host refuses mismatches with a clear
   pt-BR message; on an atlas mismatch with equal build, the guest clears its atlas cache and reloads once.

### 1b. Remote walk animation sped up

- Local: `game.js:66` `p.moveT += dt * hypot(mx,my) * (spd/4)` → moveT grows by **distance / 4**
  (0.25 per tile). Creatures: `ai.js:87` `m.moveT += dt * (spd/4)` → same 0.25/tile.
- Remote players: `session.js:527` `if (e.moving) e.moveT += d * 2.2 + dt * 0.2` → 2.2 per tile plus a
  constant drift.
- The pawn gait phase is `moveT * 9.5` (`compose.js:189`), so remote legs cycle ~9× faster.
- **Measured** (two tabs): host walked 11.73 tiles, host `moveT` +2.93 (0.250/tile); the guest's copy of
  the host avatar +26.32 (2.244/tile) → **×9.0**.
- Also: `session.js:525` `if (d > 6) { e.x = x; e.y = y; } else { e.x = x; e.y = y; }` — the teleport
  branch is a no-op (respawn/teleport is interpolated across the map instead of snapping).
- Fix: `src/game/anim.js` exports `GAIT_PER_TILE = 0.25` and `stepGait(e, dist)`; used by `game.js`
  (local player, with the actually moved distance), `ai.js go()`, session interpolation
  (`stepGait(e, Math.min(d, 1))`), and entity proxies. Teleport: if `d > 6`, snap and clear `_buf`.

### 1c. Spider shown as a deer-like animal with the spider's name, attacking

Code paths that make a creature's picture disagree with its species:
- `src/game/artcompat.js:26-31`: if the atlas has no `<species>_s`, the entity is drawn through a proxy
  with `species = SPECIES_FB[species] || 'wolf'` and `SCALE_FB` (`spider → wolf × 0.6`).
- `src/art/compose.js:499`: `const S = T.animal[key] || T.animal.wolf;` — any species without art is a wolf.
- The nameplate (`ui/overlay.js:138`) and target frame (`ui/hud.js:337`) use `e.name`/`SPECIES[…]`, and
  the AI uses `SPECIES[m.species]` → name "Aranha da caverna", hostile, bites.

**Reproduced**: in a `?seed=7` tab next to two spiders and a deer, removing `spider_s` from the atlas
(`game.A.sprites.delete('spider_s')`) turns both spiders into small tan quadrupeds (wolf sprite at 0.59
scale) labelled "Aranha da caverna 4/5", standing next to the real deer — visually "a deer with the
spider's name". An atlas without `spider_*` is exactly what a stale atlas painted by any build before
commit `a2eafaa` (21:09, when `spider_*` entered `CONTRACT` and `creatures.js` was painted) looks like —
i.e. the same stale/broken-atlas defect as 1a, on the same machine.

Independently of art, in Phase 1 **the creature attacking a player exists only in that player's world**:
creatures are spawned and simulated per client (`systems.js:44`, `mobs.js:76-98` with `Math.random`
positions/levels/scales, AI in `ai.js:154-247` targeting only `game.player` at `ai.js:156`). The spider the
friend saw was a different object in a different simulation. Measured: same spawners (seeded) but every
member differs (`1:rabbit@186.5,222.3 L6` vs `1:rabbit@183.6,224.4 L6`, wolves at different spots and
levels, bandit kits differ: `sword_copper/bow_wood/spear_stone/axe_stone/knife_stone` vs
`sword_copper/bow_wood/club_wood/knife_stone/axe_stone`). Spawner lists can also diverge when saves differ
(`createSpawners` runs after `loadGame`, `systems.js:42-44`, and depends on trees and `world.solid`,
`mobs.js:41-55`; removing 60 trees changed 2 of 91 spawners in a test).

Fix: host-authoritative creatures (§3.6); validated atlas (§1a); fallbacks become loud: `drawProxy` and the
`|| T.animal.wolf` path call `artWarn(name)` once (netlog error + dev on-screen tag) — in a validated atlas
they never trigger; `game.net.selfTest()` asserts every `SPECIES` has its own sprites.

### 1d. Creatures, buildings, loot, harvest/mining, crops, camps, projectiles not shared

Confirmed by design (Phase 1) and by experiment:
- Host placed a wall (`placeStructure(game,'wall_wood',123,120)`) and removed tree `2545`: guest had
  `build.structures.length === 0`, `world.solid[idx(123,120)] === 0` (walks through it) and tree `2545`
  still standing.
- `session.js` only sends `st/sts` (position, facing, action, gear, hp, level), `lk`, `chat`, env every
  2 s (`session.js:476-504`). Every gameplay system in `systems.js:60-76` and `economy.js:37-39` runs on
  every client against its own world.
- Host creatures ignore guests entirely: AI, bandits and projectiles only consider `game.player`
  (`ai.js:156`, `bandits.js:349`, `projectiles.js:115-118`, `combat.js:91`).

### 1e. Other desync sources found

| # | Source | Where |
|---|---|---|
| 1 | Guest loads its **own world save** (`wos.save.v2.<seed>.guest`): its old structures, harvested trees, mined tiles, crops and loot appear only for it | `save.js:18, 92-169`, `main.js:97-99` |
| 2 | `worldTime` per client = own save + offline credit (≤ 1 h). Drives respawns, crops, saplings, stump decay | `save.js:102-103`; measured host 7.2 s vs guest 61.6 s |
| 3 | `createSpawners` / `installBandits` / `ensureStarter` run on every client, after `loadGame` (save-dependent) | `systems.js:42-45`, `economy.js:34` |
| 4 | Random ids: `world.addObject` assigns `Math.random()*1e9` when no id (camp objects: host `319032744…` vs guest `412805537…`); flora `'f'+n+random` (`flora.js:126`; host `f11w7` vs guest `f1237`); structures `'b'+Date.now()+n` (`building.js:238`); loot module counter (`loot.js:9`, `1e6+n` on load `save.js:168`); mob module counter (`mobs.js:16`) | world.js:67 etc. |
| 5 | `Math.random` in shared outcomes: drops (`gathering.js:177-179, 202, 228-233, 301-302`, `mining.js:122-128`, `farming.js:95`, `combat.js:254-256`, `bandits.js:228-269`), loot velocities (`loot.js:13-15`), structure variant `v` (`building.js:238`), crate flip (`bandits.js:120`), raider kits (`bandits.js:170-194`), mob members (`mobs.js:81-92`), respawn timers (`combat.js:284`, `bandits.js:521`), cave spawns (`mobs.js:109-118`), flora regrowth (`flora.js:31` everywhere) | — |
| 6 | Loot pickup is local: both players can pick up the same item (duplication) | `loot.js:105-108` |
| 7 | Regrowth / sapling solidity / stump decay / respawn use only the local player and local view | `flora.js:157, 243-247, 255`, `gathering.js:313-324`, `mobs.js:145-146, 175, 113` |
| 8 | Bed sleep jumps `env.hour` and `worldTime` locally (host env sync later overwrites the hour, not `worldTime`) | `building.js:496-514` |
| 9 | Chest contents, station fuel, station `working` light are per client | `ui/panels.js:197-233`, `crafting.js:90-100, 165-177` |
| 10 | Mining progress (`rockHits`) and designations are per client; mined tiles never reach others | `mining.js:103-134` |
| 11 | Doors open only for the local player (cosmetic, but derived from local data) | `building.js:525-534` |
| 12 | Host tab in background → no `requestAnimationFrame` → the authoritative world, presence and env stop for everyone (observed: background host clock frozen at 8.20 h while the guest ran to 9.42 h) | `main.js:121-139` |
| 13 | Remote interpolation uses packet **arrival** time (`session.js:424`) → jitter on TURN shows as stutter | — |
| 14 | `ManualLink` sends raw JSON on one data channel (`links.js` `ch.send(JSON.stringify(msg))`): messages > ~256 KB (a world snapshot) fail | `links.js` ManualLink.send |
| 15 | Version check is PROTO only, and PROTO/BUILD are manual constants | `session.js:325`, `netlog.js:9-10` |
| 16 | `kit.js:156` `tufts(..., rand = Math.random)` default (all callers pass a seeded rng today) — pixel identity of art is not guaranteed by the type system; atlas identity must therefore be names, not pixels | `art/kit.js:156` |

---

## 2. Inventory of state mutations

Legend — **Auth**: H = host (world authority), O = owning player, L = local-only (per player, never
replicated), C = cosmetic. **How**: `op` = sequenced deterministic op broadcast by the host; `int` = intent
a guest sends to the host (the host turns it into ops); `ent` = entity snapshot stream; `pres` = presence
(`st/sts`); `own` = host→owner message; `fx` = unsequenced cosmetic event; `—` = not replicated.

### 2.1 World objects — natural (worldgen ids 1..N) and flora (dynamic)

| Mutation | file:line | Auth | How |
|---|---|---|---|
| Tree hit: `o.shake`, `o.prog` | gathering.js:113-120 | H (O requests) | int `gather.hit` → op `obj.prog` |
| Tree felled: `o.fall`, `o.fallDir`, `o.prog=0`, `occRemove`, `game.falling.push` | gathering.js:121-131 | H | op `tree.fell` |
| Fall animation `o.fall += …` | gathering.js:289-292 | C (all clients animate) | — (driven by `tree.fell`) |
| Landing drops (wood, stick) | gathering.js:294-303 | H | op `tree.land {drops}` |
| Becomes stump: `fall=0, stump, prog=0, stumpAt`, `stumps.add`, `touched` | gathering.js:304-310 | H | op `tree.stump` |
| Stump hit / removal + 1 wood | gathering.js:134-157 | H | int `gather.hit` → `obj.prog`, `obj.remove {drops}` |
| Boulder hit / break + stone/pebble | gathering.js:159-187 | H | int → `obj.prog`, `obj.remove {drops}` |
| Pick (pebble/stick) → item to actor | gathering.js:196-209 | H | int → `obj.remove {by, give}` |
| Forage (bush/berry/fibre/wild) → drops | gathering.js:211-241 | H | int → `obj.remove {drops}` |
| `removeNatural`: `removeObject`, `gone`, `touched`, flora bookkeeping | flora.js:89-97 | H | inside op appliers only |
| Shake/flash decay | gathering.js:279-286 | C | — |
| Stump decay after 3 days, off-screen | gathering.js:313-325 | H | op `obj.remove` |
| Flora regrowth spawn (`makeFloraObject`, `addObject`, `dyn.set`, `occAdd`, `growing.add`) | flora.js:123-154, 159-178, 252-272 | H | op `obj.add` |
| Starter safety net | flora.js:198-231, 274-275; economy.js:34 | H | op `obj.add` |
| Sapling age `o.age` (from `born`, `worldTime`) | flora.js:240-250 | H decides solid; age C | age: computed locally from replicated `born` + synced `worldTime`; solid: op `tree.solid` |
| Sapling solid flip + `occAdd` | flora.js:247 | H | op `tree.solid` |
| `initFlora` targets/jitter (`Math.random`) | flora.js:33-69 | H | — (host only uses them) |
| Load-time natural changes | save.js:78-90, 111-141 | H (load) | snapshot (§3.8) |
| `Game` constructor `o.solid = SOLID[type]` | game.js:19 | deterministic on all | — |
| Canopy fade `o.alpha` | game.js:126-134 | C | — |
| `o._px`, `o._ph`, `o._occ` | artcompat.js, compose.js:101, nav.js | C/L | — |

### 2.2 Tiles and grids

| Mutation | file:line | Auth | How |
|---|---|---|---|
| `world.mineRock` (rock, ore, ground, textures, `dirty`) | world.js:121-134 via mining.js:117 | H | op `tile.mine` |
| `game.minedTiles/minedSet` | mining.js:119, save.js:114 | H | inside `tile.mine` |
| `game.rockHits` (mining progress) | mining.js:105, 120 | H | op `rock.prog` |
| Mining designations `game.mining.marks/blocked` | mining.js:118-134, 249 | **L** (personal job list) | — |
| `world.solid` set/clear (walls 1, doors 2) | building.js:301, 349 | H | inside `struct.complete` / `struct.remove` |
| `world.noGrow` stamps | flora.js:77-86 via building.js:250, 346 | H | inside struct ops |
| `game.occ` (`occAdd/occRemove/occAddTiles`) | nav.js:20-44 (called from ops) | derived on all | inside appliers |
| Decor removal under structures | building.js:260-267 | H | inside `struct.add` |
| Decor removal in camps | bandits.js:100 | deterministic on all | camp layout (§3.8) |
| Masks (`o.mask`, `o.orient`) | autotile.js:64-86; building.js:252, 362; mining.js:134 | derived on all | recomputed inside struct/tile ops |
| `world.dirty` → GPU upload | world.js:266; game.js:87-91 | C | — |

### 2.3 Structures

| Mutation | file:line | Auth | How |
|---|---|---|---|
| Place blueprint(s) (`placeStructure`, cost paid) | building.js:185-209, 234-258 | H (O pays) | int `build.place` → op `struct.add` (+ refund `give` for rejected tiles) |
| Door replacing a wall | building.js:195 | H | `struct.remove` + `struct.add` in the same batch |
| Blueprint progress `o.progress` | building.js:440 | H | int `build.hit` → op `struct.progress` |
| Footprint clearing (natural objects removed, yields to builder) | building.js:407-425 | H | inside `build.hit` (first hit) → `obj.remove {give}` |
| Completion (`completeStructure`: solid, light, fire, nudge, bed respawn, xp, toast) | building.js:295-324 | H; bed respawn/xp/toast O | op `struct.complete {by, xp}` |
| Deconstruct designation toggle | building.js:377-404 | H | int `build.decon` → op `struct.decon` / `struct.remove` (blueprint cancel) |
| Deconstruction completion (`removeStructure`, refund, chest dump) | building.js:338-369, 457-462 | H | int `decon.hit` → op `struct.remove {refund→give, drops}` |
| Chest contents (`o.store`) | ui/panels.js:197-233; building.js:358 | H | int `chest.put/take` → op `chest.set` |
| Station `working`, `workT`, `light`, `fire` | crafting.js:165-177 | H (O requests) | int `station.work` → op `struct.working` |
| Station fuel `o.fuel` | crafting.js:90-100 | **L** (move to a per-player fuel bank) | — |
| Door `o.open` animation | building.js:525-534 | C (derived from all known player positions) | — |
| Bed `p.respawn` | building.js:311, 497; player.js:124-137 | O | — |
| Floor speed `p.speed *= 1.1` | building.js:536-538 | O | — |

### 2.4 Ground loot

| Mutation | file:line | Auth | How |
|---|---|---|---|
| `dropLoot` (id counter, random velocity) | loot.js:11-18 | H | rows rolled by host, op `loot.add` |
| Kill loot / `rollKillLoot` / `dropTable` | loot.js:22-40; combat.js:250-267 | H | `loot.add` inside `mob.die` handling |
| Pop arc physics | loot.js:88-95 | C (all simulate same params) | — |
| Magnet toward local player | loot.js:100-104 | C (local) | — |
| Pickup (`pickup`, splice) | loot.js:42-56, 105-108 | H arbitrates, O receives items | int `loot.take` → op `loot.take {by}` |
| Expiry `t > 300` | loot.js:96 | H | op `loot.expire` |
| Drop from inventory | ui/panels.js:247-254; crafting.js:83, 108; gathering.js:193; building.js:333 | O pays, H creates | int `loot.drop` → op `loot.add` |
| Recoverable arrows | projectiles.js:60-62, 77-80 | shooter O | int `loot.drop` |
| Loaded loot | save.js:166-169 | H | snapshot |

### 2.5 Crops

| Mutation | file:line | Auth | How |
|---|---|---|---|
| Plant (`plantCrop`, seed removed) | farming.js:29-35, 64-85 | H (O pays seed) | int `farm.plant` → op `crop.add` |
| Growth / stage | farming.js:107-127 | H | op `crop.stage` (on stage change only) |
| Harvest (drops, `removeCrop`) | farming.js:87-105 | H | int `farm.harvest` → op `crop.remove {drops}` |
| Removed with plot | building.js:360; farming.js:21 | H | inside `struct.remove` |

### 2.6 Creatures (mobs, raiders), camps, props

| Mutation | file:line | Auth | How |
|---|---|---|---|
| Spawners + members (`createSpawners`, `spawnMember`) | mobs.js:31-98 | H | ent stream |
| Cave spider nests | mobs.js:101-123, 185-186 | H | ent |
| AI movement/state/aggro/leash/evade/flee/fear/daze | ai.js:22-247; bandits.js:348-503; nav.js | H | ent |
| Separation push | mobs.js:151-165 | H | ent |
| Corpse cleanup, respawn | mobs.js:137-143, 166-184; bandits.js:516-527 | H | ent (`del`/`add`) |
| Damage to mobs (`dealDamage`, `killMob`, `stun`, `addDot`, `knock`, dazeT, fearT, interrupt) | combat.js:87-153, 177-212, 269-290, 390-398; abilities.js:235, 251, 271, 300, 314, 376, 390-394, 487-490; player.js:212-216 | H (attacker O rolls) | int `mob.hit` → ent + `fx dmg` + op `mob.die` |
| Mob dots ticking | combat.js:196-212 | H | ent (dot bits) |
| Camp layout (tents, crates, fire, banner, clear area) | bandits.js:62-147, 209-223 | deterministic on all (seeded) | — (must be made deterministic, §3.9) |
| Raider spawn/kit/look | bandits.js:169-207 | H | ent (full record carries look/kit) |
| Crate damage / break / respawn (`o.hp`, `o.broken`, `removeObject/addObject`) | combat.js:216-236; bandits.js:272-281, 528-532 | H | int `prop.hit` → op `prop.set` (+ `loot.add`) |
| Archer/spear projectiles | bandits.js:298-310, 323-327, 487-502 | H | fx `proj` / `pend` |

### 2.7 Players (what others see)

| State | file:line | Auth | How |
|---|---|---|---|
| Position, facing, moving, action | game.js:57-69; abilities.js:472-519; controller.js | O | pres (12 Hz) |
| HP, dead, maxHp, level, blocking | combat.js:118, 142; player.js:79-157 | O | pres |
| Weapon/offhand/armor visuals | equipment.js:100-109; player.js:36-58 | O | pres |
| Look | session.js:485 | O | `lk` |
| Damage taken from creatures | ai.js:136-152; bandits.js:286-310; projectiles.js:115-121 | H decides hit, O applies | own `player.hurt` |
| Poison/bleed/stun on players | ai.js:146-150; bandits.js:321, 335 | O applies | own `player.hurt {poison/bleed/stun}` |
| XP, level-up | player.js:79-94 | O | via `by/xp` on ops |
| Inventory, equipment, hunger, energy, buffs, cooldowns, crafting queue | inventory.js; equipment.js; survival.js; abilities.js; crafting.js | O | — (L) |
| Respawn | player.js:139-157; hud.js:175 | O | pres |

### 2.8 Environment

| State | file:line | Auth | How |
|---|---|---|---|
| `hour`, `dayIndex` | environment.js:77-78 | H | `sts.env` (2 s) + welcome |
| Weather | environment.js:79-87 | H | `sts.env` + welcome |
| `worldTime` | systems.js:47-50; save.js:103; building.js:510 | H | **add** to `sts.env` and welcome |
| Sleep skip | building.js:496-514 | H only | op `env.skip`; guests' sleep refused |
| Lightning, wind gusts | environment.js:92-103 | C | — |

### 2.9 Cosmetic / local (never replicated, never digested)

`juice.js` (shake, particles, footsteps — Math.random OK), `fx/particles.js`, `fx/ambient.js`,
`fx/audio.js`, `ui/*` (except the chest/drop/eat/equip calls listed above), `game.cam`, `game.time`,
`o.shake/flash/alpha/open`, `_`-prefixed caches, target ring, hover, nameplates, build ghost
(`building.js:151-182`), mining overlay, `ctl.hinted`.

---

## 3. Replication architecture

### 3.1 Authority model (decision and justification)

- **Host = world authority** for everything in §2.1–2.6 and 2.8. Rationale: one simulation of creatures
  and world (no divergence by construction), conflicts resolved in one place, existing AI/economy code
  keeps working on the host almost unchanged.
- **Owner = player authority** for its avatar: movement (no server-side movement; co-op, no anti-cheat),
  inventory, equipment, XP, hunger/energy, buffs, cooldowns, **HP and death**. Damage from host creatures
  is sent to the owner, who runs its own `dealDamage` (dodge, armor, block, herb-heal interruption, death).
  Rationale: all of that state already lives on the player object and is driven by `game.player`; moving
  it to the host would mean replicating inventories and stats, for no benefit in co-op.
- **Attacker rolls**: a player's hit/miss/crit/damage rolls happen on the attacker's client (as today,
  `combat.js:59-67`); the host applies the rolled amount to its authoritative mob (armor, evade immunity,
  aggro, death and loot are host-side).
- **Solo = host with zero peers.** `game.net` always exists; role `solo` behaves exactly like `host`.

### 3.2 Net core (`src/net/net.js`, `game.net`)

```js
// role: 'solo' | 'host' | 'guest'; auth = role !== 'guest'
game.net = new Net(game);
net.pid                    // session pid (solo: 'local')
net.request(intent, args, { refund, onOk, onReject })   // ANY gameplay code; the only way to ask for a shared change
net.emit(op, args)         // authority-only (throws on guests): apply locally + queue for broadcast
net.toOwner(pid, name, a)  // authority-only: own message (player.hurt); local pid → applied immediately
net.newId(prefix)          // authority-only id allocation: 's','f','L','m','h','c' … (counters saved by the host)
net.roll()                 // authority-only Math.random wrapper (throws on guests in dev)
net.applying               // >0 while an op/snapshot is being applied (mutation guard)
net.digest(), net.dump(part), net.diff(a, b), net.stats, net.selfTest(), net.forceResync()
```

Registries (one file per domain under `src/game/mut/`):

```js
defineIntent('gather.hit', {
  doc: 'Actor hits a natural object with the current work tool; host accumulates progress and completes it.',
  args: { id: 'objId', kind: "'tree'|'stump'|'boulder'|'pick'|'forage'", inc: 'number 0..1', fibre: 'bool?' },
  run(game, a, actor, net) { /* authority side: validate, roll, net.emit(...) ; return false|'reason' to reject */ },
});
defineOp('tree.fell', {
  doc: 'Tree starts falling; landing drops come later in tree.land.',
  args: { id: 'objId', dir: '±1', by: 'pid', xp: 'number' },
  apply(game, a, ctx) { /* deterministic: no Math.random, no Date.now, no game.player */ },
});
```

Rules of the core:
1. `request` on an authority: `run(game, args, actor = { pid: net.pid, ent: game.player, local: true })`
   synchronously; reject → `refund` items go back to the local inventory and `onReject(reason)` runs.
2. `request` on a guest: `rid++`, store `{rid, name, args, refund, onOk, onReject}`, send
   `{t:'rq', r:rid, n, a}`; **no local application** (no prediction of shared state).
3. Host on `rq`: `actor = { pid, ent: players.get(pid).ent }`; ignore if the guest is not `synced`;
   `run(...)`; then send `{t:'ack', r, ok:1}` or `{t:'ack', r, ok:0, why}` to the requester **after** the
   op batch (same ordered channel ⇒ the guest has applied the ops when the ack arrives).
4. `emit(op, a)` (authority): `net.applying++; OPS[op].apply(game, a, ctx); net.applying--;` then
   `queue.push([op, a])`. At the end of `game.update` the host flushes `{t:'ops', s: firstSeq, l: queue}`
   to every **synced** guest (one message per frame; per-op seq = `s + index`).
5. Guest on `ops`: skip entries with seq ≤ `lastSeq` (already in the snapshot, §3.8), require the next one
   to be `lastSeq + 1` (else log `desync gap` and request a resync), apply each with `net.applying` set.
6. **Owner effects travel inside ops**: any op may carry `by` (pid), `xp`, `give: {itemId: qty}`, `toast`.
   After `apply`, the core does: `if (a.by === net.pid) { if (a.xp) gainXp(game, a.xp); if (a.give) giveItems(game, a.give); … }`.
   `giveItems` adds to `game.player.inv`; leftovers → `net.request('loot.drop', …)` at the player.
   This is the only place op appliers touch the local player — appliers themselves never reference `game.player`.
7. All randomness and all allocations happen in `run` (authority) and are written into the op args
   (e.g. `drops: [[id, item, qty, x, y, vx, vy, vlift]]`, `v`, `id`, `at`).

### 3.3 Intent catalogue (guest → host; also used locally by host/solo)

| Intent | Args | Host validation (`run`) | Ops emitted |
|---|---|---|---|
| `gather.hit` | `{id, kind, inc, fibre?}` | object exists, not gone, kind matches (tree: !stump && !fall && age≥0.9; stump: stump; boulder; pick: `PICK[type]`; forage: `FORAGE[type]`), `dist(actor.ent, o) ≤ 3` | `obj.prog {id, prog}`; when `prog ≥ 0.999`: tree → `tree.fell {id, dir, by, xp:6}`; stump → `obj.remove {ids:[id], drops, by, xp:2}`; boulder → `obj.remove {…drops stone/pebble, xp:6}`; pick → `obj.remove {ids, by, xp:1, give:{pebble|stick: n}}`; forage → `obj.remove {…drops, xp:2}` |
| `build.place` | `{type, tiles:[[tx,ty]], paid}` (paid = cost × tiles, already removed from the guest inventory) | `placeReason` per tile with the actor position; door-replaces-wall allowed | `struct.remove` (replaced walls, `give` refund) + `struct.add {list:[[id,type,tx,ty,v,progress:0,builtAt]]}` + refund `give` for rejected tiles |
| `build.hit` | `{id, inc}` | blueprint exists; first hit: `clearFootprint` must succeed (else reject "Algo está no caminho") | first hit: `obj.remove {ids, give: yields, by}`; `struct.progress {id, p}`; at ≥1: `struct.complete {id, by, xp}` |
| `build.decon` | `{ids:[...], on}` | structures exist | blueprints: `struct.remove {id, refund:'full', by}`; others: `struct.decon {ids, on}` |
| `decon.hit` | `{id, inc}` | marked for decon | at completion: `struct.remove {id, refund:0.75, by, drops (chest contents)}` |
| `rock.hit` | `{tx, ty, inc}` | `rock===1`, mineable; tier checked by the actor (trusted) | `rock.prog {i, p}`; at ≥1: `tile.mine {tx, ty, drops, by, xp}` |
| `farm.plant` | `{tx, ty, seed}` (seed already removed; `refund`) | plot is a completed `farm_plot`, no crop | `crop.add {tx, ty, kind, growth:0, at, by, xp:1}` |
| `farm.harvest` | `{tx, ty}` | crop stage ≥ 3 | `crop.remove {tx, ty, drops, by, xp:4}` |
| `loot.take` | `{id, qty}` | loot exists, `t ≥ 0.45`, `dist(actor.ent, loot) ≤ 2.6` | `loot.take {id, qty: min(qty, it.qty), by}` |
| `loot.drop` | `{item, qty, x, y, hold?}` (already removed; `refund`) | item exists in `ITEMS` | `loot.add {list}` (row `t = hold ? -2 : 0`) |
| `chest.put` | `{id, item, qty}` (already removed) | chest exists | `chest.set {id, slots}` + `give` leftover back to actor |
| `chest.take` | `{id, slot}` | slot non-empty | `chest.set {id, slots}` + `give` to actor |
| `station.work` | `{id, on}` | station exists | `struct.working {id, on}` (only on transitions) |
| `mob.hit` | `{nid, amount, crit, miss, ability, dtype, ranged, from:[x,y], knock, skin, stun, daze, fear, dot:{id,dur,tick,dmg}, interrupt}` | mob alive, `dist(actor.ent, m) ≤ (ranged ? 16 : 4.5)` | none directly (mob state goes out in the entity stream; damage numbers in `fx dmg`); on kill: `mob.die {nid, by, xp}` + `loot.add` (skin flag from the killing hit) |
| `prop.hit` | `{id, amount}` | crate exists, not broken | `prop.set {id, hp, broken, at}`; on break also `loot.add` and camp aggro on `actor.ent` |
| `proj.fire` | `{lid, kind, x, y, tx, ty, angle, speed, range}` | — (cosmetic relay) | `fx proj` to the other guests; host spawns a cosmetic copy |
| `env.sleep` | `{}` | **rejected for guests** ("Em multijogador só o anfitrião dorme até o amanhecer") | host local: `env.skip {hour, day, wt}` |

Conflict handling: two players chopping the same tree add their `inc` to the same `o.prog` on the host;
the hit that crosses 1 fells it once (`by` = that actor; only that actor gets XP). The other actor's work
loop stops because its `valid()` (`gathering.js:104`) now sees `o.fall`. Two players taking the same loot /
pebble / crop: the first request wins, the second gets `ack ok:0` (silent, or "Já foi coletado").
A guest's work loop never mutates on local completion: when its local `wk.hits ≥ need` it sends the last
`gather.hit` with `final: true` (host completes if `prog ≥ 0.9`) and ends its `p.work`.

### 3.4 Op catalogue (deterministic appliers, all peers)

| Op | Args | Apply (reuse) |
|---|---|---|
| `obj.add` | `{list:[{id,type,x,y,v,s,f,born?,age?,flora:1}]}` | `makeFloraObject(game, type, x, y, {id, v, s, f, born, age})` (`flora.js:123`) — id **required** |
| `obj.remove` | `{ids, drops?, by?, xp?, give?}` | `removeNatural` (`flora.js:89`) per id, `stumps.delete`, `loot.add` rows, juice puff |
| `obj.prog` | `{id, prog}` | `o.prog = prog`; cosmetic shake/chips/sound by type (from `gathering.js:113-119, 142-146, 167-173`) |
| `tree.fell` | `{id, dir, by, xp}` | body of `gathering.js:122-129` (no `gainXp`) |
| `tree.land` | `{id, drops}` | juice of `gathering.js:295-298` + `loot.add` rows |
| `tree.stump` | `{id, at}` | `gathering.js:305-309` |
| `tree.solid` | `{id}` | `flora.js:247` body (`o.solid`, `occAdd`) |
| `struct.add` | `{list:[[id,type,tx,ty,v,progress,builtAt]]}` | `placeStructure(game, type, tx, ty, {id, v, progress, builtAt})` (`building.js:234`) |
| `struct.progress` | `{id, p}` | `o.progress = min(0.999, p)` |
| `struct.complete` | `{id, by, xp}` | `completeStructure(game, o, {by})`: solid/light/fire/masks as today; `nudgeOut` only the local player (+ mobs on the authority); bed → `p.respawn = o.id` only if `by === me`; toast/puff for everyone, xp via core |
| `struct.remove` | `{id, refund:'full'|0.75|0, by, drops}` | `removeStructure(game, o, {refundTo: by, refund, drops})` — refund becomes `give` to `by`; store contents use the given `drops` rows |
| `struct.decon` | `{ids, on}` | `build.decon` set add/delete, `build.v++` |
| `struct.working` | `{id, on}` | `crafting.js:170-175` body |
| `chest.set` | `{id, slots}` | `o.store.load(slots)` |
| `tile.mine` | `{tx, ty, drops, by, xp}` | `mining.js:117-134` body (world.mineRock, minedTiles/Set, marks/rockHits cleanup, masks, tile event) + `loot.add` |
| `rock.prog` | `{i, p}` | `game.rockHits.set(i, p)` + chips/sound |
| `crop.add` | `{tx, ty, kind, growth, at, by, xp}` | `plantCrop(game, kind, tx, ty, growth)` with `lastT = at` |
| `crop.stage` | `{tx, ty, stage, growth}` | set + `tile` event |
| `crop.remove` | `{tx, ty, drops, by, xp}` | `removeCrop` + `loot.add` |
| `loot.add` | `{list:[[id,item,qty,x,y,vx,vy,vlift,t]]}` | push loot objects with those exact values |
| `loot.take` | `{id, qty, by}` | reduce/remove; core gives `{item: qty}` to `by` |
| `loot.expire` | `{ids}` | remove |
| `prop.set` | `{id, hp, broken, at}` | broken: `occRemove`+`removeObject`, `brokenAt`; restored: `addObject`+`occAdd`, `hp=maxHp` |
| `mob.die` | `{nid, by, xp}` | on guests: proxy `dead`, target-clear logic of `combat.js:286-289`; xp via core |
| `env.skip` | `{hour, day, wt}` | `env.hour/dayIndex`, `game.worldTime`, toast |

Owner message (`{t:'own', n, a}`, host → one guest; local pid → immediate):
`player.hurt {src: nid|null, sx, sy, slv, amount, crit, ability, dtype, ranged, from, noDodge, poison?:{dur,tick,dmg}, bleed?:{dur,tick,dmg}, stun?: dur}`
→ owner: `dealDamage(game, proxyOf(src) || {x:sx, y:sy, level:slv}, game.player, amount, opts)`, then
`addDot(game, p, 'poison'|'bleed', …)` / `stunPlayer(game, dur)`.

### 3.5 Host AI with several players

New `src/game/players.js` (used by host-only code):

```js
allPlayers(game)            // [game.player, ...remote avatars (session pl.ent, not stale)]
nearestPlayer(game, x, y, maxD, { alive = true } = {})
minPlayerDist(game, x, y)
inAnyView(game, x, y, mx = 2, my = 3)   // local view rect, or a 24×14 box around each remote avatar
hurtPlayer(game, src, target, amount, opts) // local → dealDamage; remote → net.toOwner(target.pid, 'player.hurt', …)
```

Remote avatars on the host get `ax, ay` (latest received position, used by AI and hit checks — not the
120 ms-delayed interpolated one), `vx, vy, speed` (velocity estimate for archer lead, `bandits.js:300-304`).

Changes (all host-only code paths):
- `ai.js:156` `const p = game.player` → target = `m.state==='chase' ? m.threat : nearestPlayer(game, m.x, m.y, 30) || game.player`;
  perception/flee/fear use that player; `bite()` (`ai.js:136-152`) → `hurtPlayer(...)` with `poison`.
  `aggro()` (`ai.js:22-48`): `enterCombat` only for the local player (already).
- `bandits.js:349` same pattern; `meleeHit`, `shootAt`, `special`, `archer` take the target; `stunPlayer`
  and `addDot(bleed)` on remote → `player.hurt {stun|bleed}`; `crateBreak` aggro → breaker's avatar.
- `mobs.js:145-146` sleep: `minPlayerDist > SLEEP*1.4`; respawn `mobs.js:175`: `minPlayerDist < 18` skips;
  `caveSpawn` (`mobs.js:101-123`) around any player; corpse cleanup `onScreen` → `inAnyView`.
- `projectiles.js:115-118` victim test for creature projectiles → every player; `onHit` → `hurtPlayer`.
- `combat.js:269-290` `killMob`: `byPlayer` = killer is any player; XP via `mob.die {by: killer.pid}`;
  `dropTable` skin flag from the killing `mob.hit` (`m.lastHitSkin`), not `canSkin(game)`.
- `flora.js:157, 247, 255`, `gathering.js:313-324`, `flora.js:198-212`: use `inAnyView`/`minPlayerDist`.

### 3.6 Entity replication (creatures; `src/net/entities.js`)

Host `EntityServer` (runs at 10 Hz, after the mob systems):
- Interest per guest: mob is *in* when `|dx| ≤ 40 && |dy| ≤ 30` from the guest avatar's `ax, ay`, *out*
  when `|dx| > 46 || |dy| > 36` (hysteresis). Always in: mobs whose `threat` is that guest.
- Per guest `known: Map<nid, lastSent>`. Message `{t:'ents', ht, add:[full…], up:[dyn…], del:[nid…]}`.
- `add` (on enter, respawn, or any static change) — full record:
  `[nid, kind('a'|'p'), species, name, level, elite, temper, faction|0, scale, maxHp, variant|0, look|0, weapon|0, offhand|0, armorBody|0, armorHead|0, camp|0, ...dyn]`
- `up` (only if changed: |Δx| or |Δy| ≥ 0.02, or bits/hp/action/cast changed; plus a forced full refresh every 5 s):
  `[nid, x*100|0, y*100|0, bits, hp, actType|0, actT*100|0, actDur*100|0, actSeq, castName|0, castT*100|0, castDur*100|0, tgtPid|0]`
  `bits`: facing (0 s,1 n,2 e,3 w) | moving<<2 | dead<<3 | blocking<<4 | stunned<<5 | chase<<6 | bleed<<7 | poison<<8 | burn<<9 | dazed<<10 | feared<<11.
  `actSeq`: the host tracks `m.action` object identity; a new object ⇒ seq+1 (restarts the anim on guests).
- `del` when the mob leaves interest or is removed (corpse cleanup / respawn replacement).
- `nid` = `'m' + base36(counter)` allocated by `net.newId('m')` in `spawnMember`/`spawnBandit` (replaces
  the module counters `mobs.js:16`, `bandits.js:184`).

Guest `EntityClient`:
- Proxies live in `game.entities` with `proxy: true, isMob: true, nid`, the full-record fields, `_buf`
  for interpolation, `hp/maxHp`, `cast`, `blocking`, `dots` (ids from bits, for nameplate pips),
  `state = 'chase'` + `threat = game.player` when `tgtPid === net.pid` (overlay `overlay.js:117` and
  `enterCombat(game.player, 1)` for the local player).
- Interpolation in host time: offset = min over recent `(performance.now()/1000 - ht)`; render time =
  `now - offset - 0.15`. `stepGait(e, dist)`; `action.t` advanced locally by `dt/dur`; `deadT`/`flash`
  decay as today (`game.js:83`).
- **Never** run AI, `updateDots`, separation, respawn on proxies (assert `!m.proxy` in `updateCreature`
  and `updateBandit`; `combat.js:196-212` skips proxies).
- Remote players keep the presence channel (`st/sts`) — only fix gait (§1b), add `ht`, snap teleports.

Guest combat routing (the guest still runs its auto-attack/abilities/arrows locally for feel):
- `dealDamage` (`combat.js:87`): on a guest, `if (dst !== game.player)` → `routeHit(game, src, dst, amount, opts)`
  → `net.request('mob.hit' | 'prop.hit', …)`; returns the rolled amount for local UX but emits **no**
  local damage event (the host's `fx dmg` echo shows the number).
- `stun` (`combat.js:390`), `addDot` on non-player (`combat.js:177`), `knock` on mobs (`player.js:212`),
  and the direct status writes in `abilities.js` (`235` daze/interrupt, `300` daze, `314` aggro,
  `390-394` fear/flee) go through one helper `mobEffect(game, e, {stun, daze, fear, dot, interrupt, aggro})`
  that applies locally on the authority and is folded into `mob.hit` on guests.
- Misses (`combat.js:72-73, 327, 331`) → `mob.hit {miss: true}` (host aggroes and shows "Errou").

### 3.7 Combat feedback and projectiles

- Host listens to its own `game.events` `damage`/`kill` and forwards them (interest-filtered, batched per
  frame) as `{t:'fx', l:[['dmg', tgtRef, srcRef, amount, kind, crit, dtype, ability, blocked, dot], …]}`
  with refs `'m:'+nid | 'p:'+pid | 'o:'+propId`. Guests resolve refs and emit the same `damage` event
  locally (floating text, flash, `juice.hit/blood`, audio).
- Creature projectiles (host): `fx ['proj', id, kind, x, y, tx, ty, angle, speed, range, faction, h1]` →
  guests spawn a **cosmetic** projectile (`fireArrow(game, {..., cosmetic: true})`: no victim tests, no
  `onHit`, no loot) and remove/stick it on `fx ['pend', id, x, y, stuck, ground]`.
- Player arrows: the shooter simulates its real projectile locally (hits → `mob.hit`), sends
  `proj.fire` so others get a cosmetic copy; arrow recovery → `loot.drop`.

### 3.8 Join snapshot, resync, persistence

Flow (single reliable ordered channel):
1. guest → `hello {v, build, art, pid, name, look}`; host checks versions (§3.10) → `welcome {seed, hour, day, weather, wt, hostPid, hostName, players}`.
2. Guest generates the world from `seed` with `game.net.role = 'guest'` **set before `installSystems`**,
   then sends `ready {}`; loading screen shows "Sincronizando o mundo…" until the snapshot is applied.
3. Host on `ready`: `snap = serializeWorld(game, {exactIds: true})` with `snap.seq = net.seq` (the last
   seq **assigned**, including ops still queued for this frame's flush), sends it as `{t:'snap', i, n, d}`
   chunks of ≤ 48 KB of the JSON string (needed for `ManualLink`, harmless on Trystero), and marks the
   guest `synced = true` in the same tick, so every later op batch reaches it after the snapshot.
4. Guest: `applyWorld(game, snap, 'net')`, sets `lastSeq = snap.seq`, and **discards any op entry with
   `seq ≤ lastSeq`** (already contained in the snapshot — this covers ops emitted in the same frame as
   the snapshot); then the entity stream starts with full `add`s.

Snapshot content (`src/net/snapshot.js`; the world part of `saveGame`/`loadGame` (`save.js:28-57,
111-169`) is **extracted into** `serializeWorld/applyWorld` and used by both the save file and the
network — "anything persisted is replicated at join" by construction):

```
{ v, build, seed, seq, wt, env:{h,d,w},
  gone:   [worldgen ids removed],
  nat:    [[id, stump, stumpAt, prog]],                    // modified worldgen objects
  dyn:    [[id, type, x, y, v, s, f, born, stump, stumpAt, solid]],   // host-created flora
  falling:[[id, fall, dir]],
  mined:  [tileIdx...],  rockp: [[i, p]],
  structs:[[id, type, tx, ty, v, progress, decon, store|0, working, builtAt]],
  crops:  [[tx, ty, kind, growth, stage]],
  loot:   [[id, item, qty, x, y]],
  props:  [[id, hp, broken, brokenAt]],
  ids:    { s, f, L, m, h }                                 // (host save only, not sent)
}
```

`applyWorld(game, data, mode)`:
- `mode 'load'` (host/solo save): today's semantics incl. position fallback (`findNatural`, `save.js:70-76`).
- `mode 'net'` (join **and resync**): exact ids, **reconcile** semantics — remove local structures / dyn
  flora / crops / loot not in the snapshot, add missing, overwrite fields of existing; mine listed tiles;
  remove `gone` ids; never un-mine. Runs inside `net.applying`.

Guest world init (role `guest`): skip the world part of `loadGame`, `createSpawners`, raider population,
`ensureStarter`; **do** run the deterministic camp layout (§3.9). Guest save = **player only**
(`player`, `hinted`, crafting queue, fuel bank) under `wos.save.v2.<seed>.guest`; never world data.

Resync: on reconnect (`session.js:235-249`) the guest sends `ready {resync: 1}` and gets a fresh snapshot
(reconcile). The desync detector (§4.3) can also request it. Host leaving for good: guests see "O anfitrião
saiu" with "Voltar ao menu" (no silent switch to a half-simulated solo world).

Host persistence: as today plus `ids` counters (`net.ids`), loot ids, and guests' builds (they are host
structures). On load the host bumps each counter above the max existing suffix.

### 3.9 Determinism rules

1. **Worldgen** is a pure function of `(seed, BUILD_ID)` (true today: `worldgen.js` uses only seeded rngs;
   ids `1..N` at `worldgen.js:357+`). Never call `Math.random` in `src/world/**` or in art painters.
2. **Camp layout** is deterministic on every client: `installCamps(game)` runs right after `new Game`
   and **before** any save/snapshot; it must not read player state (`bandits.js:57` structures check and
   `55` `w.solid` only matter on the fallback path — compute it from the pristine world); object ids
   `'camp' + i + ':' + k`; crate `f` from `camp.rand` (`bandits.js:120`). Raider population stays
   host-only (`populateCamps`).
3. **Ids**: worldgen = integers; everything created at runtime gets its id from the authority
   (`net.newId(prefix)`), carried in op args. Per-client cosmetic things (player projectiles) use
   `` `${pid}:${n}` ``. `world.addObject` **throws** if `o.id` is missing (replace `world.js:67`).
4. **Randomness**: allowed in cosmetic code, in attacker rolls on the attacker's client, and in authority
   code (`run`, host-only systems) through `net.roll()`. Forbidden in op appliers and in any code that
   runs on guests and changes shared state. Every random outcome that matters is in an op's args.
5. **Time**: `game.worldTime` is the host's clock (welcome + `sts.env.wt`, guest snaps when |Δ| > 2 s).
   Ops carry absolute times (`stumpAt`, `builtAt`, `born`, `at`). Guests never run time-driven transitions
   (crop growth, sapling solidity, stump decay, respawns, loot expiry) — they only animate.
   `game.time`/`performance.now` = cosmetics and interpolation only.
6. **`game.player`** is never referenced by op appliers, intents (use `actor`), or host AI (use `players.js`).
7. Systems are tagged (`sync: 'host' | 'owner' | 'all' | 'cosmetic'`); guests skip `host` systems:

| sync | systems |
|---|---|
| `host` | mobsSystem, banditsSystem (respawn/crates), floraSystem regrowth+solid flip, farmingSystem growth, stump-decay part of gatheringSystem, loot expiry part of lootSystem, EntityServer, authoritative projectile resolution for creature shots, clock's `game.later` timers created by host-only code |
| `owner` | controller, playerSystem, abilitiesSystem, combatSystem (local player auto-attack), gathering work loop, workSystem, craftingSystem, survivalSystem, equipmentSystem, guideSystem, miningSystem (designations), buildingSystem (preview, floor speed), saveSystem (role-aware) |
| `all` | clock (`worldTime` advance), falling-tree animation, shake decay, doors animation, sapling age visual, loot pop arcs/magnet, projectiles flight (cosmetic part), EntityClient, session |
| `cosmetic` | juice, overlay, HUD, ambient, audio, netui |

### 3.10 Version / content safety

- `src/version.js` (generated by `node tools/stamp.mjs`): `BUILD_ID` (12 hex, every file under `src/` +
  `index.html`), `ART_ID` (art module graph), `BUILD_DATE`. `netlog.js` re-exports `BUILD = BUILD_ID`;
  menu footer shows `Versão <date> · <BUILD_ID>`; netlog report includes both ids and the atlas digest.
- `PROTO = 2` (message formats change in this pass).
- `atlasDigest` = FNV hash of the sorted sprite names (computed after the atlas is ready).
- `hello {v, build, art}` → host: `v` or `build` differ → `reject {reason:'version', host: BUILD_ID}` →
  guest shows "Versões diferentes do jogo (sua X, anfitrião Y). Recarregue a página (Ctrl+Shift+R);
  se persistir, o anfitrião também deve recarregar." `art` differs with equal build →
  `reject {reason:'atlas'}` → guest clears the atlas cache and reloads once (sessionStorage flag), else
  shows "Gráficos corrompidos neste navegador — limpe os dados do site".
- A client whose atlas has failures/placeholders refuses to host or join ("Gráficos incompletos: recarregue").
- Dev: on localhost, after boot, fetch all sources with `cache:'no-store'`, hash, compare with `BUILD_ID`;
  mismatch → console error "version.js is stale: run `node tools/stamp.mjs`".

### 3.11 Messages, rates, bandwidth

| `t` | Dir | Rate | Size (JSON) |
|---|---|---|---|
| `hello/welcome/reject/ready` | — | once | < 1 KB |
| `snap` (chunks) | H→G | join/resync | 30–150 KB total |
| `st` / `sts` (+`ht`, env `wt`) | G→H / H→G | 12 Hz | ~150 B per player entry |
| `ents` | H→G | 10 Hz | ~30 B per changed mob; typical 3–6 KB/s, busy 12 KB/s |
| `rq` / `ack` | G→H / H→G | on action | 60–200 B |
| `ops` | H→G | per frame with changes | 50–300 B typical, batched |
| `own` | H→G | on hit | ~150 B |
| `fx` | H→G | per frame with events | 50–400 B |
| `dg` / `dgx` / `dgr` | H↔G | every 5 s / on mismatch | ~400 B / rows |
| `chat/ping/pong/lk/left/bye` | — | as today | — |

Budget: per guest ≈ 10–20 KB/s down, 2–3 KB/s up; host with 3 guests ≈ 30–60 KB/s up (~0.5 Mbit/s) —
fine for Cloudflare TURN. JSON stays; arrays instead of objects for `ents/ops/fx`.

### 3.12 Host keeps ticking in the background

When `document.hidden` and a session is active, drive `game.update` from a dedicated Worker timer
(`postMessage` every 50 ms; dt clamped to 0.1, sub-stepped) and skip `render`; pages with live WebRTC are
not subject to Chrome's intensive timer throttling, and worker timers are not clamped to 1 Hz. Apply to
guests too (keeps presence alive). Back to rAF when visible.

---

## 4. Regression-proofing ("never again")

### 4.1 `tools/check-sync.mjs` (node, no deps; `npm run check`; exit 1 on violations)

Scans `src/**/*.js` line by line (ignores comments); a line ending with `// sync-ok: <reason>` is exempt
(reason required, reviewable). Rules:

| Rule | Pattern | Allowed only in |
|---|---|---|
| R1 raw world mutation | `\b(addObject|removeObject|mineRock)\s*\(` | `src/world/world.js`, `src/game/mut/**`, `src/net/snapshot.js`, camp layout fn |
| R2 entity list | `entities\.(push|splice|unshift|pop|shift)\b`, `entities\s*=` | `src/game/mut/**`, `src/net/entities.js`, `src/net/session.js`, `src/game/game.js`, `src/game/mobs.js`/`bandits.js` spawn fns (host) |
| R3 loot list | `loot\.(push|splice)`, `game\.loot\s*=` | `src/game/mut/loot.js`, `src/game/systems.js` |
| R4 replicated fields | `\.(stump|stumpAt|fall|fallDir|gone|prog|born|progress|blueprint|mask|orient|working|fire|lit|broken|brokenAt|stage|growth|removed|store|decon)\s*(=(?!=)|\+=|-=)` | `src/game/mut/**`, `autotile.js` (mask/orient), `src/net/snapshot.js`, art (none) |
| R5 tile grids | `solid\[[^\]]+\]\s*=(?!=)`, `noGrow\[`, `\bocc\[[^\]]+\]\s*(=|\+\+|--)` | `src/game/mut/**`, `src/world/world.js`, `src/game/nav.js` |
| R6 applier purity | `Math\.random|Date\.now|performance\.now|game\.player` | forbidden in `src/game/mut/**` except `mut/roll.js` (asserts authority) and `mut/own.js` |
| R7 random ids | `id\s*[:=][^,;]*Math\.random` | nowhere (session `playerId` exempt) |
| R8 Math.random in shared code | `Math\.random` | forbidden in `src/world/**`, `src/net/**` (except `playerId`), `gathering.js building.js mining.js farming.js loot.js save.js crafting.js work.js autotile.js inventory.js equipment.js economy.js game.js systems.js` |
| R9 op registry | every `net.emit('x'` / `net.request('x'` literal has a `defineOp('x'`/`defineIntent('x'`; every definition has `doc:` and `args:`; no unused definitions | — |
| R10 system tags | every `export function \w+System\s*\(` returns an object containing `sync:` | — |
| R11 stamp fresh | recomputed `BUILD_ID`/`ART_ID` equal `src/version.js`; `sw.js` VERSION matches | — |
| R12 art required names | every `SPECIES` (non-pawn) appears in `CONTRACT` as `<sp>_{s,n,e}`; every `BUILDINGS` type, flora kind and crop kind has a contract name | — |
| R13 registration (added) | every `src/game/mut/*.js` is imported by `src/game/mut/index.js` (otherwise its ops would not be registered) | — |

Changed during implementation: R5's `noGrow[` pattern only matches **writes**; R9 also checks `toOwner(pid, 'x')` ↔ `defineOwn('x')`.

### 4.2 Runtime guards (dev = localhost: throw; prod: `netlog.error('sync', …)` once per site with stack)

- `World.addObject/removeObject/mineRock` call `this.guard?.(name)`; `Net` installs a guard that requires
  `net.applying > 0` (snapshot apply, op apply, or deterministic camp layout which sets `applying` too).
- `addSystem(game, sys)` replaces raw `game.systems.push`: throws if `sys.sync` is missing; guests skip
  `host` systems.
- `net.emit`, `net.newId`, `net.roll` throw on guests.
- `updateCreature`/`updateBandit` assert `!m.proxy`.
- `artWarn(name)` on any art fallback (`artcompat.js`, `compose.js:499`, held/wear misses for ids in `ITEMS`).

### 4.3 Desync detector (`src/net/digest.js`)

Canonical rows (cosmetic fields excluded: shake, flash, alpha, open, `_*`, loot x/y, sapling age):
- `nat`: worldgen ids gone + `[id, stump, round(prog*10)]` of modified ones;
- `dyn`: `[id, type, x.toFixed(2), y.toFixed(2), v, stump, solid>0, born]`;
- `structs`: `[id, type, tx, ty, round(progress*10), mask, orient, decon, working, store]`;
- `tiles`: FNV of `world.rock` and `world.solid` byte arrays + sorted `minedTiles`;
- `loot`: `[id, item, qty]`; `crops`: `[tx, ty, kind, stage]`; `props`: `[id, hp, broken]`;
- tolerant: `env` (day exact, hour ±0.05, weather exact, worldTime ±3 s); `ents`: host sends
  `[nid, species, dead, x, y]` of the guest's interest set → guest checks species/dead exact, position ≤ 1.5 tiles.

Protocol: every 5 s the host sends `{t:'dg', s: lastSeq, parts:{name: hash}, ents}`. Because the channel is
ordered, the guest has applied exactly the ops ≤ `s` when it processes `dg`, so exact parts must match.
On mismatch: guest sends `dgx {part}`, host replies `dgr {part, rows}`, guest diffs, logs
`netlog.error('sync', 'Dessincronia em structs: 3 diferenças (s12 ausente, …)')` with the first 20
diverging keys, emits `game.events 'desync'`, increments `net.stats.desyncs`, and requests a resync
(rate-limited: 1 per 30 s; after 3 in 5 min a toast "Problema de sincronização — veja o Diagnóstico").

### 4.4 Debug API (TESTER)

`game.net.digest()` → `{seq, parts, counts}`; `game.net.dump(part)` → canonical rows; `game.net.diff(a, b)`;
`game.net.stats` → `{opsIn, opsOut, rq, rejects, bytesIn, bytesOut, desyncs, resyncs, lastSeq}`;
`game.net.ents` (proxy map on guests / interest sets on host); `game.net.forceResync()`;
`game.net.selfTest()` → `{atlasOk, placeholders, missingSprites, speciesFallbacks, systemsUntagged}`;
`window.netlog` (filter `cat === 'sync'`).

### 4.5 Rules to add to `docs/ARCHITECTURE.md` (section "Multijogador — contrato de sincronização")

1. Every change to shared state (world objects, tiles, structures, loot, crops, creatures, camps, time)
   is an **op** (`defineOp`, deterministic `apply`, `doc` + `args`) emitted by the authority, usually from
   an **intent** (`defineIntent`) requested with `game.net.request`. Never mutate those directly.
2. Every new system declares `sync: 'host'|'owner'|'all'|'cosmetic'`.
3. Every new runtime field on a shared object is either set only inside an op `apply`, serialized by
   `serializeWorld` and listed in the digest rows, or declared cosmetic (prefix `_` or listed in
   `COSMETIC_FIELDS` in `digest.js`).
4. Randomness/allocation only on the authority, carried in op args. No `Math.random` ids.
5. New creature species: add to `SPECIES` + art contract names (`<sp>_{s,n,e}`); the entity stream needs
   nothing else. New structure/item/crop: add art contract names; ops are generic by type.
6. Before committing: `node tools/stamp.mjs` and `node tools/check-sync.mjs`; for a new mechanic, add a
   scenario to `tools/mp-test.js`. Bump `PROTO` when a message format changes.

### 4.6 Automated two-client harness (`tools/mp-test.html` + `tools/mp-test.js`)

- Two (or three) same-origin **iframes** side by side (both visible ⇒ both run rAF; module state is
  isolated per iframe): host `/?seed=4242&mp=host&sala=T<rand>&link=bc&nosave=1`, guest
  `/?sala=T<rand>&link=bc&autojoin=1&nosave=1`.
- Needs in the game: `BroadcastLink` (in `links.js`, `BroadcastChannel('wos-' + code)`, same interface as
  `ManualLink`; enabled only by `?link=bc`), `?mp=host` (skip menu, host with the given code), `?autojoin=1`,
  `?nosave=1` (`game.noSave`: no save writes, no `wos.seed`, no menu snapshot — tests never touch real saves),
  `?fakebuild=X` (localhost only, to test refusals).
- The runner drives `H = hostFrame.contentWindow`, `G = guestFrame.contentWindow` (`H.game`, `G.game.net`,
  `G.session`), with helpers `waitFor(pred, ms)`, `act.chop(win, id)`, `act.build(win, type, tiles)`…, and
  asserts with `net.digest()` equality plus scenario-specific checks; results table on the page
  (`get_page_text`-friendly) and `?run=all` for one-shot runs.
- A soak scenario runs a simple bot on both clients (wander, gather, build, fight) for 10 min and expects
  `stats.desyncs === 0`.

---

## 5. Work plan for the CODER (ordered; each step keeps the game playable)

**A. Identity, art cache, animation (independent, do first)**
1. `tools/stamp.mjs` → writes `src/version.js` (`BUILD_ID`, `ART_ID`, `BUILD_DATE`) and the `VERSION`
   line of `sw.js`. `netlog.js` imports `BUILD_ID`; `PROTO = 2`. Menu footer shows the id.
2. `sw.js`: network-first with `cache:'no-cache'`, cache fallback offline, `VERSION` from stamp.
3. `src/art/sprites.js`: `buildAtlas()` sets `A.failures`, `A.placeholders`; export `requiredSprites()`.
   `src/engine/atlasCache.js`: key from imported `ART_ID` (delete `sourceHash`), store
   `{key, artId, buildId, placeholders, meta, blob}`, validate on hit, refuse to store bad atlases.
   `main.js:50-54` accordingly; `netlog.error('art', …)` on failures. `atlasDigest(atlas)` helper.
4. `src/game/anim.js` (`GAIT_PER_TILE`, `stepGait`); use in `game.js:66`, `ai.js:87`, `session.js:527`;
   fix `session.js:525` teleport snap; `ht` host time in `sts` and time-offset interpolation.
5. `artcompat.js` / `compose.js:499`: `artWarn` once per missing name.

**B. Net core + plumbing**
6. `src/net/net.js` (`Net`, registries, request/emit/ack/ops batching/seq, `toOwner`, `newId`, `roll`,
   owner-effects `by/xp/give`, `applying` guard, stats). `game.net` created in `Game` constructor (role
   `solo`); session sets role/pid. `world.js` `addObject` requires an id + guard hook.
7. `session.js`: new message types (`ready`, `snap`, `rq`, `ack`, `ops`, `own`, `ents`, `fx`, `dg*`),
   per-guest `synced`, version/atlas checks in `_onHello`/`_onWelcome`, `wt` in env, remote avatar
   `ax/ay/vx/vy/speed`, players list for `players.js`. `links.js`: `BroadcastLink`; app-level chunking.
8. `main.js`: role known before `installSystems` (`game.net.role = 'guest'`), `?mp=host`, `?autojoin`,
   `?nosave`, `?link=bc`, `?fakebuild`; "Sincronizando o mundo…" until snapshot; background worker clock.

**C. Ops and intents (one domain at a time; single-player must behave exactly as before after each)**

Move, don't duplicate: the state-mutating helpers (`placeStructure`, `completeStructure`, `removeStructure`,
`clearDecor`, `nudgeOut`, `plantCrop`, `removeCrop`, `removeNatural`, `makeFloraObject`, `noGrowStamp`,
loot creation) move into `src/game/mut/*` and the old modules re-export them, so the lint allowlist is
"`src/game/mut/**` only". Expect a handful of reviewed `// sync-ok:` annotations (art proxies `px.lit`
in `artcompat.js`, the fall *animation* `o.fall +=`, the `ctl.hinted.blueprint` flag in `building.js:204`).
9. `src/game/mut/roll.js` (drop rows, `net.roll`), `mut/loot.js` (`loot.add/take/expire`, intents
   `loot.take/drop`); `loot.js` pickup → intent; magnet stays cosmetic; expiry host-only.
10. `mut/objects.js` (`obj.add/remove/prog`, `tree.*`, intent `gather.hit`); refactor `gathering.js`
    handlers (`hit` = cosmetic + request; `finish` = no mutation), falling loop: side effects only on
    authority; stump decay host-only; flora regrowth/safety/solid flip emit ops; ids via `newId('f')`.
11. `mut/structures.js` (`struct.*`, `chest.set`, intents `build.place/hit/decon`, `decon.hit`,
    `chest.put/take`, `station.work`); refactor `building.js` (`placeStructure` opts id/v/builtAt;
    `completeStructure(game, o, {by})`; `removeStructure(game, o, {refundTo, refund, drops})`; nudge local
    only), `ui/panels.js` chest/drop buttons → intents; crafting station `working` → intent; fuel → per-player
    bank in `game.craft.fuel` (saved with the player).
12. `mut/tiles.js` (`tile.mine`, `rock.prog`, intent `rock.hit`); refactor `mining.js` work handler.
13. `mut/crops.js` (`crop.*`, intents `farm.plant/harvest`); farming growth host-only emitting `crop.stage`.
14. `mut/camps.js` (`prop.set`, intent `prop.hit`); `bandits.js` split into `installCamps` (deterministic,
    all clients, before save/snapshot) and `populateCamps` (host); crate respawn host op.
15. `mut/env.js` (`env.skip`); bed sleep: host → op, guest → refused message.

**D. Creatures**
16. `src/game/players.js`; multi-player targeting in `ai.js`, `bandits.js`, `mobs.js`, `projectiles.js`,
    `combat.js` (`hurtPlayer`, `killMob` generalization, `mob.die` op, nids via `newId('m')`).
17. `src/net/entities.js` (EntityServer/EntityClient, interest, proxies); guest combat routing
    (`routeHit`, `mobEffect`, intents `mob.hit`/`prop.hit`); `own player.hurt`; `fx dmg/proj/pend`;
    cosmetic projectiles; `proj.fire` relay.

**E. Join / persistence / gating**
18. `src/net/snapshot.js` (`serializeWorld`/`applyWorld` extracted from `save.js`; reconcile mode);
    `save.js` uses them; guest save player-only; host saves `net.ids` and loot ids.
19. System `sync` tags + `addSystem` + guest gating in `systems.js`/`economy.js`; guest skips
    `createSpawners`, `populateCamps`, `ensureStarter`, world part of `loadGame`.

**F. Guards and docs**
20. `src/net/digest.js` + `dg` protocol + auto-resync + debug API + `selfTest()`.
21. `tools/check-sync.mjs` (R1–R12) and `package.json` `"check"`/`"stamp"` scripts; fix or annotate every hit.
22. `tools/mp-test.html` + `tools/mp-test.js` with the scenarios of §6.
23. Update `docs/ARCHITECTURE.md` (§4.5 text, new files, messages), `README.md` dev section (stamp/check).

Acceptance for the coder: single-player unchanged; `node tools/check-sync.mjs` passes; harness scenarios
S1–S20 green; two-tab WebRTC session shows no `desync` entries in `netlog`.

---

## 6. Test plan for the TESTER

Use the harness (`tools/mp-test.html?run=all`, BroadcastChannel, ~0 ms latency) for everything, then
repeat the starred (★) scenarios over real WebRTC in two tabs (and with `wos.forceRelay=1` for TURN).
Timing budgets: harness ≤ 100 ms; WebRTC LAN ≤ 300 ms; TURN ≤ 600 ms. "Digest equal" = all exact parts of
`H.game.net.digest()` and `G.game.net.digest()` equal after `waitFor(G.game.net.stats.lastSeq === H.game.net.stats.lastSeq)`.

| # | Scenario | Expected |
|---|---|---|
| S1 ★ | Join a fresh host | Connected; digest equal immediately after snapshot; guest `createSpawners`/`ensureStarter` not run (no local mobs: every mob on the guest has `proxy:true`); camp object ids identical (`camp1:0`…); `worldTime` within 2 s |
| S2 | Version mismatch (`?fakebuild=X` on guest) | Rejected with the pt-BR "Versões diferentes…" message, no world generated |
| S3 | Atlas mismatch (guest with a deleted sprite / placeholder injected) | Guest refuses ("Gráficos incompletos") or auto-clears cache and reloads once; never connects with a different atlas digest |
| S4 | Atlas cache poisoning | With `?cache=1`: inject a painter failure → no atlas stored; store a fake atlas with a missing `spider_s` → rejected on next boot and repainted; `selfTest().speciesFallbacks` empty |
| S5 ★ | Animation parity | Host walks 10 tiles: guest's copy `moveT` delta = host delta ±10% (0.25/tile); same for a host mob seen on the guest |
| S6 ★ | Host chops a tree | Guest sees shakes during chopping, fall start ≤ budget, stump at the end; wood/stick loot with identical ids/items on both; digest equal |
| S7 ★ | Guest chops a tree | Same as S6; XP only on the guest; host `game.player.xp` unchanged |
| S8 | Both chop the same tree | Exactly one fall; one set of drops; XP to the finishing player only |
| S9 | Guest and host pick the same pebble in the same frame | One `loot`/item gain total; the other gets `ack ok:0`; object gone on both |
| S10 ★ | Guest builds a wall line (5 tiles) incl. a corner | Host sees 5 structures with the same ids, `mask`, `orient`; `world.solid=1` on both; host cannot walk through; guest paid once |
| S11 | Guest places on a tile the host just built | That tile rejected, cost refunded to the guest |
| S12 | Guest deconstructs a chest with items | Structure gone on both; 75% refund only to the guest; chest contents appear as loot with identical ids |
| S13 | Door built by host | Both players pass; host creatures cannot (proxy positions never inside the door tile) |
| S14 ★ | Guest mines a rock tile with ore | `tile.mine` on both (rock 0, ground STONE, textures updated); adjacent wall masks updated; ore loot ids equal |
| S15 | Farming: guest plants, host time advances, host harvests | `crop.add` on both; stage changes visible on both at the same stage; harvest loot equal; seed refunded on a rejected plant |
| S16 ★ | Wolf killed by the guest | Wolf `dead` on both; loot appears on both with identical ids; leather only if the guest had a knife; XP only to the guest; only one player can pick each item |
| S17 ★ | Creature chases the guest | Visible on both; same `nid`, species, name, level; position on guest within 0.5 tile of the host's position 150 ms earlier; bites reduce the **guest's** HP (owner applies), host sees it via presence; guest death → creature evades |
| S18 | Bandit archer shoots the guest | Arrow visible on both; damage only on the guest; aimed-shot cast bar visible on the guest's nameplate |
| S19 | Guest abilities on host mobs | stun (`smash`), daze (`shove`), bleed (`lacerate`), fear (`torch_swing`), interrupt (`shield_bash`) take effect on the host mob (bits in `ents`) and show on both |
| S20 | Guest breaks a bandit crate | `prop.set broken` on both; loot ids equal; crate restored on both after `CRATE_RESPAWN` (host time) |
| S21 | Flora regrowth | Host-spawned saplings appear on the guest with the same id/position; never inside any player's view; solid flip on both |
| S22 ★ | Join mid-game after S6–S20 | A third client (or a rejoining guest) gets digest equal right after the snapshot (incl. stumps, mined tiles, structures, crops, loot, props, falling trees) |
| S23 ★ | Guest reload / reconnect | Resync; digest equal; guest inventory/equipment/level restored from the player-only guest save; no world data in `wos.save.v2.<seed>.guest` |
| S24 | Host leaves | Guests get "O anfitrião saiu" and return to the menu; their saves contain no world data |
| S25 ★ | Weather / clock | Host weather change visible on guests ≤ 2 s; host sleep → `env.skip` on all (hour, day, worldTime); guest sleep refused with message |
| S26 | Host tab hidden 60 s | World keeps ticking (host `worldTime` advances ≥ 50 s), guests keep receiving `ents`/`sts` |
| S27 | Desync detector | Manually corrupt the guest (`G.game.build.structures.pop()` without op) → within 5 s a `sync` error in `netlog` naming `structs` and the missing id; automatic resync restores equality |
| S28 | Lint | `node tools/check-sync.mjs` exits 0; adding `game.world.addObject({...})` in `gathering.js` makes it exit 1 with R1 + file:line |
| S29 | Soak 10 min (bots on both) | `net.stats.desyncs === 0`, no `ack ok:0` except expected races, bandwidth per guest < 25 KB/s |
| S30 | Single-player regression | `?seed=N` solo: chopping, building, mining, farming, combat, loot, save/load behave as before (same yields/timings); no `rq` messages, `net.role === 'solo'` |

---

## Appendix A — field classification of shared objects

| Object | Replicated (op/snapshot) | Derived locally (deterministic from replicated) | Cosmetic (never compared) |
|---|---|---|---|
| natural/flora object | id, type, x, y, v, s, f, gone, stump, stumpAt, prog, fall>0 (start), fallDir, born, solid (trees), empty | age (from born + worldTime), `_occ` | shake, flash, alpha, fall progress value, `_px`, `_ph` |
| structure | id, type, tx, ty, v, progress, blueprint, decon, store, working, light/fire (from working/def), builtAt | x, y, cy, mask, orient, `world.solid`, noGrow, occ | open, shake, flash, workT |
| crop | tx, ty, kind, growth (on stage change), stage, lastT | x, y, f | — |
| loot | id, item, qty, spawn x/y/vx/vy/vlift, t0 | pop-arc position | magnet offset, ph, lift |
| prop (crate) | id (deterministic), hp, broken, brokenAt | — | flash, shake |
| creature (proxy) | nid, kind, species, name, level, elite, temper, faction, scale, maxHp, variant, look/weapon/offhand/armor, camp, x, y, facing, moving, dead, hp, action (type,t,dur,seq), cast, blocking, stunned, chase target, dot bits | moveT (stepGait), deadT | flash, `_ph` |
| remote player | pid, name, look, x, y, facing, moving, action, weapon, offhand, armor, hp, maxHp, dead, blocking, level | moveT (stepGait) | flash |
| env | hour, day, weather, worldTime | everything in `env.compute()` | lightning, gusts |

## Appendix B — evidence log (two-tab session, seed 7)

- Spawners identical (91), members differ: guest `1:rabbit@186.5,222.3 L6 sc0.94` vs host `1:rabbit@183.6,224.4 L6 sc0.98`; `3:wolf@62.2,81.6 L3` vs `3:wolf@62.3,80.9 L3`; fox `L4` vs `L5`.
- Camp object ids: host `319032744/955036969/253282282`, guest `412805537/938351401/309617612`; crate flips `1,-1,-1` vs differing.
- Bandit kits camp1: host `sword_copper/bow_wood/club_wood/knife_stone/axe_stone`, guest `sword_copper/bow_wood/spear_stone/axe_stone/knife_stone`.
- `ensureStarter` pebble: host `f11w7@119.43,115.44`, guest `f1237@109.36,116.47`.
- `worldTime` host 7.2 s, guest 61.6 s; background host hour frozen 8.44 vs guest 9.42.
- Host wall at (123,120) and removed tree 2545: guest `structures 0`, `solid 0`, tree present.
- Remote gait: host 11.73 tiles, `moveT` +2.93 (host) vs +26.32 (guest's copy) → ×9.0.
- Missing `spider_s` → spiders drawn as wolf × 0.59 with "Aranha da caverna" plates next to a real deer.

---

## 7. Implementation notes — changed during implementation

Everything in §3–§5 is implemented (tasks 1–21 and 23; task 22 is the tester's harness). Where the code
differs from the design text above, the code is described here (this section wins).

### 7.1 Files

| File | Role |
|---|---|
| `tools/stamp.mjs` | writes `src/version.js` (`BUILD_ID`, `ART_ID`, `BUILD_DATE`, `BUILD_FILES`) and `sw.js` `VERSION`; `--check` only verifies. Text is LF-normalised before hashing. |
| `tools/check-sync.mjs` | lint R1–R13 (`npm run check` = stamp check + lint) |
| `src/art/contract.js` | `CONTRACT` (moved out of `sprites.js`, pure data so node can import it), `hasKindArt`, `atlasDigest` |
| `src/game/artcheck.js` | `requiredSprites()` / `checkAtlas(A)` (**changed**: lives on the game side instead of `sprites.js`, so `ART_ID` does not depend on content/balance files) |
| `src/net/registry.js` | `defineIntent` / `defineOp` / `defineOwn` registries (**changed**: a leaf module, not inside `net.js`, to avoid ES-module init cycles) |
| `src/net/net.js` | `Net` (`game.net`) |
| `src/game/mut/*.js` | `loot`, `objects` (natural + flora), `structures`, `tiles`, `crops`, `camps`, `combat`, `env`, `own` (owner effects + `player.hurt`), `roll` (authority randomness), `index.js` imports them all (**new rule R13**: every `mut/*.js` must be imported there) |
| `src/game/players.js`, `src/game/anim.js` | §3.5 / §1b |
| `src/net/entities.js` | `EntityServer` / `EntityClient` / `ClockSync` |
| `src/net/snapshot.js` | `serializeWorld` / `applyWorld` |
| `src/net/digest.js` | digest parts, `dg/dgx/dgr`, `installNetDebug` (debug API) |

### 7.2 Protocol / ops details that differ from §3.3–§3.4

- **Work hits** (`gather.hit`, `build.hit`, `rock.hit`): each local hit sends `{inc: 1/need}` (host: `prog = min(0.999, prog + inc)`,
  op `obj.prog` / `struct.progress` / `rock.prog`); the end of the local work loop sends `{final: true}` and the host completes when
  `prog ≥ 0.85` (pick / forage have no progress and complete on `final`). Keeps single-player timing identical.
- `build.hit {id, start: true}` is sent when the work **starts** (not on the first hit): the host clears the footprint
  (`obj.remove {ids, give: yields}`, crops `crop.remove`) or rejects with "Algo está no caminho" (the work stops).
- `build.place {type, tiles}` (the cost × tiles is paid locally and passed as `refund` of the request); refused tiles come back as
  `give` on `struct.add`; a door replacing a wall emits `struct.remove {give: wall cost, quiet: 1}` first.
- `struct.remove {id, by?, give?, giveAt?, drops?, quiet?, toast?}`: refunds are computed by the host and travel as `give`.
- `struct.complete` carries `toast` and, for beds, `respawn` (owner effect sets `p.respawn`).
- `chest.put {id, item, qty}` / `chest.take {id, slot, qty}` (qty = room in the backpack) → `chest.set {id, slots, by, give}`.
- `mob.hit` also accepts `noDmg: 1` + `eff: {stun, daze, interrupt, dot:{id,dur,tick,dmg}, fear, aggro, status:[text, dtype]}` —
  ability effects on a proxy (`mobEffect()` in `combat.js`; on the authority the same effects are applied directly).
- `mob.die {nid, by?, xp?, toast?, tip?}` (`tip = [hintKey, text, max]`, e.g. "Sem faca…" for the killer only).
- `prop.set {id, hp, broken, at?, hit?, by?, toast?}` (`hit: 1` plays the hit feedback on every peer).
- `proj.fire {id: 'pid:n', a: [kind, x, y, tx, ty, angle, speed, range, faction, h1]}`; creature shots use `fx ['proj', id, …a]` and
  `['pend', id, x, y, stuck, ground]`. Player arrows are not 'pend'-ed (their cosmetic copies stick on their own).
- Owner-effect fields: `by, xp, give, giveAt, quiet, toast, toastKind, tip, respawn`.
- `env.skip {hour, day, wt, by}`; the guest's local check refuses sleeping with
  "Ponto de renascimento definido. Em multijogador só o anfitrião dorme até o amanhecer." (the intent itself refuses guests too).
- Station fuel is a per-player bank `game.craft.fuel` (saved with the player as `fuel`; legacy station fuel is moved to the
  host's bank on migration).
- `dg` also carries `env` rows; `env` and creature positions (> 4 tiles) are **soft** checks (netlog warning only). Creature
  species / missing proxy / "dead only here" are hard (`sync` error, `desyncs++`, resync).
- On an op gap / unknown op the guest stops applying (`net.synced = false`) and asks for a resync; other resyncs keep applying.
- The guest whose atlas differs from the host's (same build) clears its atlas cache and reloads once (`sessionStorage
  wos.atlasRetry`); with `?nosave` the reload is skipped and the "Gráficos corrompidos…" message is shown at once.
- R5 (`noGrow[`) matches **writes** only (reads in regrowth checks are fine).
- **Presence animation fields** (round V2, agent D; `packState` in `session.js`): `a = [type, t, dur, loop, item?]` (`dur` 0 =
  held pose; `loop` 1 = work cycle that repeats while working, `dur` = `p.work.cycle`), `hd` = head facing when it differs from
  `f`, `ps` = resting pose `'sit' | ['sit', seatId] | ['sleep', bedId]`. Receivers keep `f / a / hd / ps` in the interpolation
  buffer and apply them at the same delayed render time as the position; an action's start is rebuilt as
  `sampleTime - t·dur`, so a swing is shown from its first frame even when it started between two samples (S40). The host
  relays other guests' last raw sample (aged by the time since it arrived), so guest ↔ guest copies carry weapon / action /
  pose too. Creature proxies (`entities.js`) likewise start a new action at `ht - t·dur` instead of on receipt.
  Everything else a pawn does on screen (walk cycle, feet, hands, blink, breathing, flinch from `flash`, death / rise from
  `dead`) is derived in `art/compose.js` from these replicated fields; cosmetic caches are `_`-prefixed.
- **Construction (round V2, agent A)** — shared structure fields `rot`, `paid`, `open`, `moveOf` (set in op appliers, in snapshot
  `structs` rows `[id, type, tx, ty, v, progress, decon, store|0, working, builtAt, rot, paid, open, moveOf]` and in the `structs`
  digest rows; derived on every peer by `setGeom`: `fw × fh` footprint after rotation, `x, y, cy`, `face`). Cosmetic: `_openT`
  (door swing), `_mount` (wall torch), `_lid` (chest lid, local player only).
  - `build.place {type, tiles, rot}` places **free** blueprints (`struct.add` rows `[id, type, tx, ty, v, progress, builtAt, rot, paid,
    moveOf]`); the builder delivers the cost when work starts: `build.hit {id, start, pay}` (cost taken locally, `refund` on reject) →
    `struct.paid {id, by, give?}` (a second delivery comes back as `give`). Unpaid blueprints refuse `inc`/`final` ("Falta material").
    Cancelling (`build.decon` on a blueprint) gives back delivered materials only.
  - Doors / gates: closed = `world.solid` 1 (blocks everyone), open = 0; only `door.toggle {id, open}` (reach 2.4, closing refused
    while a player / creature overlaps the tile) → `door.set {id, open, by}` (each peer nudges its own player out when closing).
  - "Mover": `build.move {id, tx, ty, rot}` → a paid plan (`moveOf` = source id, kept out of the tile grid, may overlap the source);
    finishing it (`build.hit final`, target re-validated) → `struct.relocate {id: plan, src}` moves the SAME object (id, store, state).
  - "Arrasar" (campfires): `struct.raze {id}` → `struct.remove {fx:'raze', give: half the pebbles}`.
  - Autotile: `def.joins` (Set of groups, `'rock'` = rock tiles) — walls join wall + rock, fences join fence + wall + rock.

### 7.3 Save format

Key unchanged (`wos.save.v2.<seed>[.guest]`), data `v: 3`: `{ v, seed, savedAt, worldTime, env:{hour,day,weather}, player, craft,
fuel, hinted, marks, world: serializeWorld(game, {save: true}) }` (the snapshot plus `ids` and `natpos` — `{id: [type, x, y]}` used to
re-find worldgen objects if the world generator changed). Guests write `{ v: 3, guest: 1, player, craft, fuel, hinted }` only.
v1/v2 saves are migrated into a snapshot and applied through `applyWorld(…, 'load')`. Snapshot `dyn[...][10]` (solid) may be
`null` = derive from the age. **v4** (round V2): structure rows carry `rot, paid, open, moveOf`; older rows (10 fields) are migrated by
`migrateStructRows` (rot 0, paid, closed; beds saved as 1×1 get the first free 1×2 spot: south, north, sideways, nearby).

### 7.4 Background clock

The worker clock (§3.12) drives `game.update` while a session is live and the tab is hidden **or `requestAnimationFrame` stalled
for > 300 ms** (occluded / background tabs of some embedders never report `document.hidden`), or `wosDebug.setHidden(true)`.

### 7.5 Test API (stable; used by `tools/mp-test.*`)

URL flags: `?seed=N`, `?mp=host&sala=CODE` (host directly, seed from `?seed`, default 4242), `?sala=CODE&autojoin=1`, `?nosave=1`,
`?link=bc`, `?pid=ID` (localhost: overrides `playerId()`), localhost only: `?fakebuild=X`, `?fakeart=<sprite>` (deleted from the
atlas) / `?fakeart=ph:<sprite>` (marked as placeholder) — both make the atlas invalid → join/host refused with
"Gráficos incompletos neste navegador…" — and `?fakepaintfail=1` (painter group `addNatural` throws → placeholders, atlas never cached).

Globals: `window.game`, `window.session` (`players` Map pid → `{pid, name, key, ent, av, synced, rtt}`, `state`, `hostKey`,
`_close(key)`, `lastError {reason, msg}`, `allList`), `window.netlog` (`subscribe`, `session.entries`), `window.wosDebug.setHidden(bool)`,
`window.wosBootError` (message shown on the loading screen when boot / join failed).

`game.net`: `role`, `pid`, `seq`, `synced`, `stats {opsIn, opsOut, rq, rejects, acks, bytesIn, bytesOut, desyncs, resyncs, lastSeq}`,
`request(name, args, {refund, refundAt, onOk, onReject})`, `digest() → {seq, parts, counts}`, `dump(part)` (parts: `nat dyn structs
tiles loot crops props env ents`), `diff(a, b)` (two digests → list of parts; two row arrays → `{missing, extra, changed, count}`),
`ents` (host: `{role, guests: {pid: [nid…]}, mobs}`; guest: `{role, proxies: [{nid, species, name, level, dead, x, y, state}]}`),
`forceResync()`, `selfTest() → {atlasOk, atlasDigest, placeholders, failures, missingSprites, speciesFallbacks, artWarnings,
systemsUntagged, role, synced, seq}`, `entsApi.byNid(nid)`.

`game.A.source = 'cache' | 'painted'`, `game.A.check` (= `checkAtlas`). Creature proxies on guests: `proxy: true, nid, isEntity,
isMob, species, name, level, state ('idle'|'chase'|'dead'), threat (=== game.player when chasing the local player), cast {name,t,dur},
stunT / dazeT / fearT (1 or 0), dots [{id}], hp, maxHp`. Events: `game.events` `desync {part, msg, detail}`, `worldreset`,
session events `synced`, `hostgone`.
