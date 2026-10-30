# WOS · Round V2 — quality of life + "magnificent" pass (6 parallel agents)

The owner (pt-BR speaker, plays on an Android phone and on desktop; a friend plays on an iPhone) wants the
game to feel *magnificent and relaxing*: the player should calm down while playing. Visual identity stays
RimWorld-like (top-down, soft painterly sprites, warm palette), all art is original and procedural
(Canvas2D in `src/art/*`, packed into the atlas). Every user-facing string is **Brazilian Portuguese**.

Six agents work at the same time, each in its own git worktree/branch. The coordinator merges them one by
one into `main`, so **stay inside your file ownership** (table below). When you must touch a file you do not
own, keep the change minimal (a hook call, one line), and list it in your final report.

## 0. Rules for everyone

1. **Multiplayer contract** (`docs/SYNC.md` §4.5, `docs/ARCHITECTURE.md`): every change to shared state is an
   op emitted by the host, usually from an intent (`game.net.request`). Systems declare
   `sync: 'host'|'owner'|'all'|'cosmetic'`. New fields on shared objects are set inside op `apply`,
   serialized (`src/net/snapshot.js`) and digested (`src/net/digest.js`), or are cosmetic (`_` prefix /
   `COSMETIC_FIELDS`). Randomness for shared state only on the host. Cosmetic things (particles, critters,
   music, wind sway, camera) are local and must never feed gameplay.
2. **Before every commit:** `node tools/stamp.mjs` then `npm run check` (stamp + sync lint) must pass.
3. **Before finishing:** the two-client suite must pass: `http://localhost:<PORT>/tools/mp-test.html?run=all`
   (BroadcastChannel). A new shared mechanic gets a new scenario in `tools/mp-test.js` (next free S-number;
   prefix your scenarios with your letter in the title, e.g. "A: rotated chest"). Also check
   `game.net.selfTest()` → `atlasOk: true`, no placeholders, no missing sprites, no untagged systems.
4. **Dev server:** `python tools/serve.py <PORT>` from **your worktree**, run in the background. Play URL:
   `http://localhost:<PORT>/?seed=12345&nosave=1` (skips the menu). Mobile check: `resize_window` preset
   `mobile` on **your own tab** (reset to `desktop` when done).
5. **Shared browser pane:** six agents use the same built-in browser. Open your pages with `preview_start`
   (`url`) — it creates your own tab and returns its `tabId`; pass that `tabId` on **every** browser call;
   never close, navigate or resize tabs you did not create. Prefer `get_page_text`/`javascript_tool` for
   checks, screenshots for visuals.
6. **Performance:** mid-range Android phone at 60 fps is the target. No per-frame allocations in hot loops,
   cap particles, cull by view, keep the atlas under 4096² (`src/engine/atlas.js`). Offer low/medium/high
   where a feature is expensive (the quality setting is owned by C; read `game.quality` if it exists).
7. **No downloaded assets.** Art, sound and music are generated in code (original by construction, so free
   of copyright). A small MIT/OFL library vendored under `vendor/` from npm is fine when really needed
   (say so in the report, add the license to `vendor/<lib>/LICENSE`).
8. **Saves:** do not break existing saves. If you change the save format, bump the data version in
   `src/game/save.js` and migrate old data. Only A changes structure fields; others add optional fields only.
9. **Commits:** small, in pt-BR, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
   Commit on your branch; **do not push**. `src/version.js` / the `sw.js` VERSION line will conflict between
   branches — that is expected, the coordinator re-stamps after merging.
10. **Final report:** what changed (player-visible, in plain words), files touched outside your ownership,
    suite results (pass counts), measured fps before/after on the mobile preset, known issues.

## 1. Ownership

| Agent | Port | Owns |
|---|---|---|
| **A · Construção** | 5181 | `src/game/{building,autotile,work}.js`, `src/game/mut/structures.js`, `src/game/content/buildings.js`, build-mode parts of `src/game/controller.js`, door rules in `physics.js`/`nav.js`, structure art (`src/art/{structures,stations,buildings}.js` and their parts of `composeWorld.js`), new `src/ui/buildbar.js`, structure scenarios in `tools/mp-test.js` |
| **B · Interface e controles** | 5182 | `src/engine/input.js`, camera/zoom, non-build parts of `controller.js`, `src/ui/*` (except `buildbar.js`), `src/art/icons.js` + `src/art/items.js` (icon review), `src/game/survival.js`, food/warmth numbers in `content/items.js`, `src/main.js` (menu flow), `index.html`, `manifest.webmanifest`, `sw.js`, `tools/make-icons.mjs`, `icons/` |
| **C · Ambientação visual** | 5183 | `src/engine/{renderer,shaders,spriteBatch,gl}.js`, `src/fx/{environment,particles}.js`, `src/fx/ambient.js` (except the critter sections), weather/light visuals, quality setting |
| **D · Animações** | 5184 | `src/game/{anim,juice}.js`, `src/art/{compose,pawns,animals,creatures,gear,apparel}.js`, avatar/creature animation fields in `src/game/players.js` / `src/net/entities.js` |
| **E · Natureza** | 5185 | `src/art/{trees,plants,foliage,natural,rocks,crops}.js`, their parts of `composeWorld.js`, decor in `src/world/worldgen.js`, `src/world/terrainTex.js`, `src/game/flora.js`, critter sections of `ambient.js` or a new `src/fx/wildlife.js`, the herbs feature (§E2) |
| **F · Som e música** | 5186 | `src/fx/audio.js`, new `src/fx/music.js` (+ any `src/fx/sfx*.js`), audio section of the settings, one-line `game.audio.play(...)` hooks anywhere |

Cross-agent interfaces (agree on these names, do not wait for each other):
- **Sounds:** anyone may call `game.audio?.play('<name>', { x, y })` with names from F's catalogue (§F).
  Unknown names are ignored, so call them even before F lands. Names: `door_open`, `door_close`, `chest_open`,
  `chest_close`, `blueprint`, `build_hit`, `build_done`, `decon`, `raze`, `rotate`, `herb_pick`, `heal`,
  `ui_open`, `ui_close`, `ui_hover`, `ui_click`, `hotbar`, `zoom` (optional), plus the existing ones in
  `src/fx/audio.js`.
- **Music:** F exports `getAudio()` from `src/fx/audio.js` (a singleton usable before a game exists) with
  `getAudio().music.setMood(mood)`; moods `menu`, `day`, `night`, `dawn`, `rain`, `cave`, `danger`, `home`.
  B's menu calls `getAudio()?.music?.setMood?.('menu')` (guarded). F decides moods in game by itself.
- **Wind:** C exposes `game.env.wind = { x, y, gust }` (cosmetic, updated per frame) and a shader sway
  uniform; D and E read it (guard for missing).
- **Heal pose:** the heal ability's action/pose id becomes `heal` (E sets it in content, D draws it; D keeps
  `bandage` as an alias until E lands).
- **Door/chest visuals:** A stores the shared state (`o.open` boolean, op-driven) and animates the swing /
  lid locally (`o._openT`); D does not touch structures.
- **Quality:** C owns `game.quality` ('low'|'medium'|'high', persisted, auto by default) and the setting UI row.

| **G · Combate de arco** (added later) | 5187 | bow parts of `src/game/{abilities,projectiles}.js` and `content/{combat,weapons}.js`, new `src/ui/aim.js` (aim joystick / mouse aim / ground indicator / camera focus), `tools/mp-test.js` bow scenarios |

Contract B ↔ G: abilities may have `aim: 'ground'`; B's action bar and key handling call `game.aim?.beginTouch(id, buttonEl, ev)` /
`game.aim?.beginMouse(id)` / `game.aim?.release()`; B's camera honours `game.camFocus = { x, y, k }` while aiming.

## A · Construção (structures)

The game already has blueprints (`o.blueprint`, `o.progress`), line/area drag, deconstruction (75%
refund), doors with `world.solid = 2`, sizes w×h and auto-work (`work.js`: idle player walks to pending jobs).
Audit what exists, then make it match the requests below:

1. **Rotation + edge placement.** While placing, a rotate button (mobile, in a build toolbar `buildbar.js`:
   ⟳ girar, ✓ confirmar, ✕ cancelar) and `R` / `Shift+R` on desktop. Small props (chest, torch, crate, barrel,
   chair, stool, pot, sign…) have **5 options**: pushed against the N / E / S / W edge of the tile (facing
   away from that edge, e.g. a torch against a wall becomes a wall-mounted torch) + **centred**. Multi-tile
   things rotate between 4 orientations (footprint w×h swaps). Remember the last rotation per type.
   Stored on the structure (`rot`), in ops, snapshot, save, digest; collision follows the offset; art has the
   needed directional variants.
2. **Real footprints.** Bed 1×2, workbench 2×1, table 2×1 (others where it makes sense: double bed 2×2,
   stove/forge/loom 2×1…). Art fills the footprint and never pokes through walls (screenshot: the bed
   drawn over the wall). Fix depth sorting for multi-tile objects. Migrate old 1×1 saves.
3. **Fences connect to walls** (and gates/doors/posts): a generic connect rule (`connectsWith` sets per
   group) so every future connectable declares what it joins; walls already join rock.
4. **Doors and gates open only by an action** (E / Space / action button "Abrir"/"Fechar", tap/click on the
   door) — never automatically. Shared state via intent → host op. Closed blocks everyone (creatures
   included), open lets everyone through. Swing animation, sounds `door_open`/`door_close`.
5. **RimWorld construction flow.** Placing creates a **blueprint** drawn as RimWorld's: translucent **blue**,
   outlined, free to place, any number of tiles, rows by dragging (line for walls/fences, area for floors),
   on desktop **and** mobile (one-finger drag in build mode; two fingers stay pinch-zoom, implemented by B
   in `input.js` — coordinate through `game.input` gestures, do not handle multi-touch yourself). Then the
   player builds them in sequence (existing auto-work): materials are taken from the inventory when work on
   a blueprint starts ("delivered"), a blueprint lacking materials shows a "falta material" badge and is
   skipped, cancelling refunds delivered materials. Stages: blueprint (blue) → frame (scaffold, progress
   bar) → finished. Auto-work stops instantly on any movement input. Desktop: the ghost follows the mouse
   exactly (tile under cursor), placement allowed anywhere on screen within ~20 tiles (not just next to the
   player), left-drag = row, right-click/Esc = cancel.
6. **Remove / move.** Every structure can be removed: "Desmontar" (refund 75%), campfires "Arrasar"
   (small/no refund), blueprints "Cancelar". Stations, furniture, chests, beds can be **moved** ("Mover":
   RimWorld reinstall — a move blueprint at the new spot; when built, the object moves keeping its state:
   chest contents, fuel, queue). Offered in a context menu when the player taps/clicks a structure
   (Usar/Abrir · Mover · Desmontar) and via the existing deconstruct tool.
7. **Sync scenarios** in `tools/mp-test.js`: rotated/edge chest seen identically; 2-tile bed collision on
   both sides; door toggled by the guest blocks a creature on the host; dragged blueprint row replicated and
   built by the guest (materials leave the guest's bag); move a chest with contents; decon refund; raze
   campfire; old save migration (unit-style check is fine).

## B · Interface e controles

1. **No movement by click/tap** (desktop and mobile). The joystick / WASD are the only way to walk. A
   tap/click only targets or interacts with a specific thing the automatic focus did not pick (chest, door,
   tree, rock, crop, station, loot, creature): within reach → do it; out of reach → highlight + "Chegue mais
   perto". Never path the player. Tapping empty ground does nothing (on mobile it may clear the target).
2. **Pinch zoom** with two fingers (mobile) and wheel zoom (desktop), smooth, clamped, persisted; two-finger
   gestures never trigger taps or the joystick. Expose gesture state on `game.input` for A's build drag.
3. **XP bar inside the top-left player card** (remove the bar at the bottom of the screen).
4. **Fullscreen button is broken.** Root cause: `press()` in `src/ui/hud.js` fires on `pointerdown`; a touch
   `pointerdown` is not a user activation, so `requestFullscreen` is rejected on phones. Use `click` (or
   `pointerup`) for fullscreen and install; handle `webkitfullscreenchange`. On iPhone (no element
   fullscreen) the button opens the install guide instead (an installed PWA already runs fullscreen).
5. **PWA install.**
   - Popup "Aviso importante" on the main menu every time the game runs in a browser tab (not standalone:
     `display-mode` standalone/fullscreen/minimal-ui or `navigator.standalone`). It closes **only** with its
     close button (no backdrop / Esc). It has an **Instalar** button.
   - Android/desktop Chrome/Edge/Samsung: `beforeinstallprompt.prompt()`. **iOS** (Safari, and Chrome/Firefox
     on iOS; detect iPadOS too: `MacIntel` + touch points): there is no install event — show an illustrated
     step-by-step: Compartilhar (share icon) → "Adicionar à Tela de Início" → Adicionar. Firefox Android:
     menu → Instalar. Other: generic instructions.
   - Desktop browser: recommend installing here (button when available) **and** installing on the phone to
     get notifications while away from the PC — show a QR code of the game URL (+ copy link).
   - The install button next to the minimap must also show on iOS (today it depends on
     `beforeinstallprompt`, which iOS never fires) and in any non-installed context; it opens the same guide.
   - Add a 180×180 `apple-touch-icon` (generate in `tools/make-icons.mjs`), check the iOS meta tags.
6. **Main menu, much more beautiful.** Live animated background: the real engine rendering a scenic showcase
   (river, forest, campfire, slow day/night, weather, fireflies) with a slow cinematic camera, painted
   fallback while assets load; strong logo/typography; animated entrance; icon buttons with hover/press;
   calls the menu music (§1). **Settings do not scroll on mobile** (main menu and pause) — fix.
7. **Desktop HUD redesign** (today it looks like a mobile port): Minecraft/Terraria feel — bottom-centre
   hotbar (keys 1–9, 0; items: tools, weapons → equip, food → eat, placeables → build mode, consumables),
   proper windows for inventory (I), crafting (C), build (B), map (M), equipment, drag-and-drop between
   hotbar/inventory/chests, rich hover tooltips, a shortcuts overlay (H / F1). Combat abilities keep a compact
   bar with their own keys (design a coherent scheme and show it in the overlay; E/Space = interact, Esc =
   menu). Mobile keeps the touch layout but shares the new visual style.
8. **Mobile HUD review:** things overlap under the player card (screenshot: the small craft-queue chip
   overlaps the left column of buttons); fix spacing/safe areas at common phone sizes (375×812, 412×915,
   landscape 844×390 / 915×412).
9. **Icons review:** consistent style, readable at small sizes; **pebble (`pedrinha`) and stone
   (`pedra`/`pedregulho`) icons are almost identical** — make them clearly different (pebbles: a few small
   round river stones; stone: one big angular chunk). Check every item icon pair that could be confused.
10. **Survival is too easy.** Hunger: roughly 2.5× faster (full → empty about 8–9 min idle, faster when
    sprinting/working/cold), penalties below 25%, starvation damage that ramps. Cold: temperature from
    biome + night + rain/wind (read `game.env`), warmth from fires, enclosed rooms with roof (big bonus),
    clothing, warm food; chilled (<30%: slower, hungrier), hypothermia damage (<10%). Show the temperature
    (°C) and clear warnings. Put the numbers in one tunable table. The first nights must require fire,
    shelter or clothes. Owner-side (`sync: 'owner'`).

## C · Ambientação visual (cosmetic only)

Make every moment beautiful and calm: time-of-day colour grading (golden dawn, warm afternoon, pink/orange
dusk, moonlit blue night with stars), sun direction moving across the day (shadow angle/length), drifting
cloud shadows, light shafts through canopies at dawn, morning fog near water, rain (wind-angled layers,
ground darkening when wet, puddles that reflect, splashes), storms with lightning lighting the scene, snow in
cold biomes, a global wind field (`game.env.wind`) driving grass/tree/crop sway in the shader, particles,
rain angle and smoke; water shimmer, shoreline foam, sky reflections; campfire/torch flicker with warm
bounce light, soft bloom on lights, contact shadows/AO at the base of walls and trees, gentle vignette and
grain, per-biome/weather colour LUT. Weather state comes from the shared env (`mut/env.js`) — only visuals
here. A graphics quality setting (`game.quality`, auto/low/medium/high) with a row in settings. Keep 60 fps
on the mobile preset.

## D · Animações

Pawns: idle breathing and blinking, head turning toward the target, a real walk cycle (legs, arm swing,
body bob, hair/cloth follow-through), run, per-tool actions with anticipation and impact (axe chop, pickaxe
overhead, hammer while building, sword slash arcs, spear thrust, bow draw/release, shield raise, hoe/plant
kneel, harvest pull, eating, crafting at a station, the new `heal` pose: crush herbs and press them on the
arm), hit flinch, knockback, death and respawn, sleeping in a bed, sitting. Animals and creatures: proper
gaits per species (deer trot/bound, boar, wolf, rabbit hop, spider legs), idle life (grazing, ear twitch,
tail swish, looking around), lunges, death. World reactions: tree shake + leaves when hit, tree fall with
timber rotation, dust and stump, rock cracks and crumble, bushes rustle when walked through, crops wiggle.
UI juice is B's; structures are A's. **Remote players must show the same animations** — derive them from
replicated avatar/creature state (add stream fields following `docs/SYNC.md` if needed; never from local
input). Walking speed of remote avatars must stay ×1.00 (S-scenarios already measure it).

## E · Natureza

1. **Richer nature per biome** (original art, same identity): more tree species and variants (better pine,
   oak, birch, willow by rivers, autumn maples, dead trees; desert/cold biome species), undergrowth (ferns,
   flower clusters with biome palettes, tall grass, clover, moss, mushroom rings), ground details (fallen
   leaves under trees, twigs, petals, sand ripples, mud, worn paths), water edges (reeds, cattails, lily pads
   with flowers, river stones, sand bars), mossy rocks, mountain/cliff edge details, smoother biome
   transitions, richer terrain texture (`terrainTex.js`). Cosmetic decor stays cosmetic; anything harvestable
   follows the sync path like `berrybush`.
2. **Herbs replace bandages.** Remove the bandage concept everywhere (item, recipes at hand and loom, ability,
   bandit loot, loot icon, texts). New bush **"Arbusto de ervas"** with **little green berries**, spawning
   and regrowing like berry bushes (never near player buildings), harvest gives **"Erva medicinal"**; the heal
   ability becomes "Ervas medicinais" (uses 1 herb, heal over time, interrupted by damage — keep the current
   balance), ability/pose id `heal`. Item and icon art, migration of old saves/chests/ground loot (bandage →
   herb 1:1). Touches `content/{items,recipes,combat}.js`, `abilities.js`, `combat.js`, `bandits.js`,
   `loot.js`, `actionbar.js` (one line), `mut/structures.js` CLEARABLE yields — keep those edits minimal.
3. **Wildlife (cosmetic):** butterflies of several kinds, bees on flowers, dragonflies over water, frogs that
   hop into the water, ducks on lakes, fish shadows, squirrels on trees, birds that land, peck and fly off
   when the player approaches, rabbits that dart away. All flee from players, all capped and culled.

## F · Som e música

The game already has procedural WebAudio SFX and a soundscape (`src/fx/audio.js`). Make it rich:
- SFX with variation (pitch/volume jitter, layers): footsteps by surface (grass, dirt, sand, stone, wood
  floor, shallow water, snow), material impacts (wood, stone, metal, flesh, shield block), bow/arrow, UI
  (click, hover tick on desktop, panel open/close, craft done, level-up fanfare, pickup pop, error),
  construction (blueprint place, hammering, done, deconstruct, raze), doors/chests, eating, fire ignite and
  crackle, creature voices per species, weather (rain on ground vs on a roof when indoors, wind gusts,
  thunder), caves, water, insects at night, dawn bird chorus. Spatial (pan, distance, muffled behind walls).
  Sounds of **other players' actions** must play too (hook into op application / replicated events, not only
  local input).
- **Music, original and generative** (copyright-free by construction): themes for `menu`, `day`, `night`,
  `dawn`, `rain`, `cave`, `danger` (combat/chase), `home` (by your campfire). Real-sounding instruments
  (Karplus-Strong plucks, FM/e-piano, additive pads with chorus, breathy flute, soft strings, frame drums
  for danger), proper harmony and voice leading, humanised timing, generated-impulse reverb. Like Minecraft:
  phrases with long silences between them to stay relaxing; danger starts quickly and fades after the fight;
  crossfades between moods. Light on mobile CPU (schedule ahead / pre-render with `OfflineAudioContext`).
- **Volume sliders:** Geral, Música, Efeitos, Ambiente (+ mute), in the settings of the main menu and of the
  pause menu, persisted, applied live. Audio unlock on the first gesture (iOS: resume on `touchend`). Lower
  or pause when the tab is hidden.
- Export `getAudio()` singleton + `music.setMood()` (§1).

## G · Combate de arco (long lobbed shot)

Owner's request: a bow ability "Tiro longo" — the player shoots upward so the arrow flies much further.
- **Mobile:** hold the ability button → aim mode; the button becomes a joystick (like Mobile Legends
  skillshots): the more it is tilted, the further the shot; a clear ground indicator (landing circle, arc
  preview, max-range ring); release fires; drag back to the centre / cancel zone cancels. Quick tap = default.
- **Desktop:** aim with the mouse. Holding the ability key shows the indicator at the mouse; a click fires
  (the mouse is already there); a quick key tap fires at the mouse point. Esc / right-click cancels.
- **Range:** a long range clamp per bow. Today there is one bow: its range is what the screen shows at max
  zoom out (game zoom clamp is 22..110 px/tile in `game.js`; define the range in tiles from a landscape phone
  at max zoom out, the same on every device, so multiplayer is fair). Better bows (future) do not zoom out
  further: the camera follows the landing point as far as it goes. While aiming the camera eases toward the
  aim point (`game.camFocus`).
- **Inaccuracy grows with distance** (scatter radius ∝ distance), rolled **on the host** (shared randomness).
- **Arc:** the arrow flies a visible parabola with its shadow on the ground, lands, sticks; hits creatures
  near the landing point (small radius); costs an arrow; cooldown/energy like the other bow abilities.
- **Sync:** guest → intent with the aim point; host validates (range, ammo, cooldown), rolls the scatter,
  emits the projectile through the existing projectile replication (`src/game/projectiles.js`,
  `docs/SYNC.md` §3.7); damage only on the host; everyone sees the same arrow and landing. The aim indicator
  and camera are local. Scenario "G: long shot" in `tools/mp-test.js`.

## H · Personalização do personagem (added later, port 5188)

Owner's request: a character customizer that is a **core feature of the game**, so well made that players
would one day want to buy cosmetic items. In the main menu the player's character stands on screen, with a
text field above it for the player name and an **"Editar aparência"** button opening a rich, beautiful editor:
skin tone, head shape, face (eyes, eye colour, brows, nose, mouth, ears, freckles/marks/scars, face paint),
hair (many styles, colour, highlights), facial hair, body type, clothing (shirt/tunic styles, pants, shoes, colours,
patterns). **No accessories such as hats** — headgear and armour are game equipment. Content is a catalogue
with ids, names, rarity and an `unlocked` flag (everything free for now, ready for future cosmetics).

- Owns: new `src/game/look.js` (schema, defaults, validation `cleanLook`, random, migration of the old
  `look = { skin, hair, hairColor, shirt }`), new `src/ui/charcreator.{js,css}` (menu avatar + editor), new
  `src/art/look/*.js` (part painters), the look parts of `src/art/{pawns,compose,apparel}.js` **after D lands**.
- Sync: `look` already travels in `hello` / `lk` (`src/net/session.js`, `cleanLook`). The new schema must be
  compact, validated on receipt (unknown ids → default, colours clamped), sent on change, and drawn the same on
  every client. Bump `PROTO` if the message format changes. Scenario "H: look sync" in `tools/mp-test.js`.
- Contract with B: B's main menu hosts H's widget: `mountMenuAvatar(el, { name, onName })` exported by
  `src/ui/charcreator.js` (B imports it guarded: `import('./charcreator.js').then(m => m.mountMenuAvatar?.(…))`,
  and moves the player-name field there). Contract with D: D owns the rig/animation; H owns what each part looks
  like; part painters take `(g, dir, look, params)` and fit the rig's anchors.

## I · Corpos e decomposição (added later, port 5189)

Owner's request: every living being leaves a corpse that decomposes, counted from the moment of death in
shared world time (`game.worldTime`; one game day = `env.dayLength` s, 720 today), not by calendar days:
- **Day 1 (0–1 day): fresh** · **day 2 (1–2): rotten, visibly** (discoloured, flies) · **days 3–5 (2–5): skeleton**
  · after 5 days it disappears.
- **Players (and bandits):** the dead player's carried items (bag + equipped) stay on the corpse; it can be
  opened until the end of day 2. Opening shows the player's inventory and the corpse's side by side; clicking
  an item moves it across (same as a chest), with the sort buttons on both. From day 3 it can't be opened;
  the action becomes removing the skeleton, which gives bones ("Ossos"), with an animation.
- **Animals:** no automatic loot on death any more. The corpse stays; on day 1 the action is **"Coletar"**
  (butcher: meat, hide, etc., over a few seconds, better with a cutting tool); from day 2 (rotten) it can't be
  butchered; then skeleton → remove → bones; gone after day 5.
- Sync: corpses are shared world objects created by the host's death op (id, species/look, position,
  facing, `deathT`, store); the stage is derived from `worldTime - deathT` on every peer; looting, butchering,
  bone removal and expiry are intents → host ops; snapshot, save and digest include them.
- Contracts: **B** owns the container window (inventory ↔ chest with sorting); it must accept any container
  (chest or corpse) through one adapter. **D** draws the butcher and gather-bones poses (`butcher`,
  `gather_bones`) and lying/death poses. **F** adds `butcher`, `bones` and a flies buzz near rotten corpses.

## J · Telhados, interiores e cavernas (added later, port 5190)

Owner's request: what counts as a "cave" must make sense — if a player mines a mountain open (or all of it),
it is no longer a cave. A roof system for both buildings and caves:
- **Built roofs** (like floors: a build category, area drag, blueprints): they hide what is inside a building
  and reveal it only for the player standing under that roof. Drawn **procedurally** for any shape and size
  (hip-roof shading from the distance-to-edge field, ridges, eaves, material texture). A roof needs support:
  walls, and **columns** ("Coluna", new structure) when the interior is large (e.g. every roof tile within 6
  tiles of a wall/column/rock); losing support collapses it.
- **Natural roofs**: a mined tile is a cave only while the rock above is still supported by nearby rock;
  opening a mountain removes the roof (sky light, rain). Deterministic and synced.
- **Inside (cave or building)**: screen effects (darker, closer vignette, dust in caves) and the zoom eases to a
  fixed, closer view (reduced field of view); leaving eases back to the player's own zoom — smooth both ways,
  never a jump, never a lock outside. No rain under roofs, darker interiors lit by fires/torches, warmth and
  "indoors" audio based on the roof.
- **Cave ceilings** (later request): a cave shows a ceiling from outside — the mountain's rock under an earthy,
  mossy crust, so it reads as a cave and not as solid mountain — hiding what is inside (sprites, names, lights,
  picking). The cave the local player is in fades out. A cave-in plays as cracks spreading from the middle, the
  ceiling splitting into chunks that drop tile by tile outwards, pieces falling, dust; the ceiling around the hole
  stays cracked for a while. Cosmetic and derived from the shared rock / roof grids (game/roofs.js "cave
  ceilings", roofData A / G, terrain shader `ceilMask`); scenario **J6**.
- **Mining cracks** (later request): cracks follow the pickaxe — each hit's progress (op `rock.prog`, shared)
  opens impact cracks from the middle of the tile, faster with a better pickaxe; the last hit breaks the block
  along them into wedges that drop into the hole (src/fx/rockfx.js, terrain shader `uMine`).
- **Roof paint bucket** (later request): a roof is never placed tile by tile — tapping inside a closed room
  (walls, doors or rock around it) fills the whole room and its wall ring at once, all or nothing: tiles with no
  support within reach turn red ("Falta apoio em N pontos: coloque colunas onde está vermelho") and nothing is
  placed until columns fix them (building.js updatePreview; up to 420 tiles per roof, `MAX_ROOF_TILES`). The
  build-mode view shows the world grid faintly.
- **Roof details are placed by the roof** (later request): the player picks the detail, the roof decides where
  it goes (decoration.js `placeRoofProps`): dormers on the slope facing the camera (every 3 tiles, second row
  from the eave) or on both side slopes of a front-gable roof (every 4 tiles); skylights spread over the middle
  of every visible slope; one weathervane near the middle of the ridge. Each prop is drawn for its slope (the
  roof art keeps `tileF` / `tileP`, the facet and pitch under each tile): stretched on the front slope, sheared
  on the sides (east = the west sprite mirrored), none on a north slope. Chimneys are not a choice: they appear
  over every hearth / oven / furnace inside, and smoke only while it burns.

## Mundos salvos e modo criativo (added later)

Owner's request: create worlds and keep them in a list (at most 10 per browser), and a creative mode to test buildings.
- **Worlds** (src/ui/worlds.js): registry `wos.worlds` = [{ id, name, seed, mode, created, played }]; a world saves under
  `wos.save.v2.<id>` (game.worldId) and keeps its hotbar under `wos.hotbar.<id>`. Saves from before the list join it with
  id = their seed (keys unchanged). Menu: "Continuar" (last world), "Mundos" (play / delete with a confirmation / create
  with name, seed and mode); hosting a room picks a world from the same list. Creating a world never wipes the others.
- **Creative** (src/game/creative.js): building finished at once without materials (build.place / move / decon, paths),
  crafting without ingredients, no damage, bars always full (endless running), creatures never pick a fight. A world
  setting carried by the snapshot (`mode`), so the host's world decides for everyone and the save keeps it. Scenario **C1**.

## Noite, estações e inverno (added later)

Owner's request: the night must have life and danger, and the year must turn.
- **Who is out when** (mobs.js, host): passive animals (green: rabbit, fox, deer) by day only; predators (wolves)
  by night only, and many more of them. Their dens fill at dusk, and hunting packs (`nightHunt`) come out of the
  dark toward the players and roam a spot ~9 tiles from them. Boars and bears (not nocturnal) any time. Monsters
  (spiders) live in cave nests only, day and night; out of the cave in daylight they give up after ~4 s and go
  back (ai.js `SUN_LEASH`). Nothing nocturnal appears within **3x the radius of any light** (campfire, torch,
  brazier, lamp, a working furnace, a player's hand torch: `litNear`). Creatures out of their hours walk away and
  vanish once nobody sees them (never mid-fight). In winter the green animals are very rare (one den in 6, one
  animal each): food is stocked during the rest of the year (wild potatoes are 3x as common).
- **The bed only sets the respawn point** (the night is never skipped; lying down is just a pose).
- **Calendar** (calendar.js, later request): a day lasts 13 min of play, 8 min of daylight (06:00-19:00) and 5 of
  night (19:00-06:00: `advanceClock`, `hourRate`). A **year has 7 days**: spring (day 1), summer (days 2-3), autumn
  (day 4, the day before winter), winter (days 5-7), so a year is 91 min. A new world starts on the first spring
  morning of year 1. `dateOf(day)` gives { year, day of the year, season }; `elapsedOf` / `formatElapsed` give how
  long a world has lived ("3 anos e 4 dias"). The HUD shows "Ano N · Dia D" under the radar (the tooltip has the
  long date and the world's age); the world list and "Continuar" show the age. A pure function of the shared clock,
  meant to date more things later.
- **Seasons** (seasons.js): the calendar's year; positions are relative to the seasons' first days (`START`,
  `CYCLE`), never hard-coded numbers. `game.season` is a pure function
  of the shared clock (env day / hour), the same on every peer with no extra sync: `id`, `day`, `toWinter`, smooth
  visual weights (`snow`, `ice`, `autumn`, `bare`, `bloom`, `winter`), gameplay `frozen` / `coldC`. HUD: a season
  chip under the radar and a notice when each season starts.
- **Winter**:
  - water freezes (`world.frozen`; `liquidAt` / `blocked` / `speedAt` / swimming treat it as ice: walkable, no
    swimming), and crops stop growing;
  - wolf packs are 3x bigger;
  - it is much colder: the biomes' climate gives way to the winter's (survival.js `SURVIVAL.temp.winter`), and rain
    falls as snow (it soaks much less).
- **Winter clothes and the hand torch** (survival.js): winter clothes (`coat_fur` "Casaco de pele", `hat_fur`
  "Gorro de pele", `armor.insul` up to 0.8) keep the heat in: only (1 - insul) of the gap below comfort is felt.
  The hand torch (off hand) warms by +14 deg C, against 26 for a fire at its center. On a winter night (~ -11 deg C in
  a meadow), the heat loss is:
  - nothing: ~1.9 %/s;
  - winter clothes: ~0.6 %/s;
  - hand torch: ~0.75 %/s;
  - clothes + torch: ~0.2 %/s (holds);
  - clothes + fire: normal.
  The gap below comfort also makes you hungrier (up to 1.7x), so a normal temperature means normal hunger.
- **Andarilhos do Gelo** (walkers.js, SPECIES.walker): the frozen dead walk out of the dark on winter nights in
  groups of 1-3 (at most ~3 around a player, 24-34 tiles away, out of sight and away from lights). They carry ice
  swords / ice spears (`sword_ice` / `spear_ice`, `mat: 'ice'`, as strong as stone; the spear is thrown as
  `ice_spear`) and use the raiders' brain (bandits.js updateBandit, per-species numbers). They crumble to snow at
  sunrise or when the winter ends: no body, no loot, no XP. Killed by a player, one leaves its ice weapon 25% of
  the time. Art: the seasons visual agent (vegetation by season, snow, ice, walker look, ice weapons, shatter).
- **Visual** (agent "seasons visuals", cosmetic, reads `game.season` only):
  - `fx/seasonfx.js` feeds `uSeaA` (snow, ice, autumn, bloom) / `uSeaB` (bare, winter, crown autumn, blizzard) to the
    shaders and spawns petals (spring), breath puffs (winter) and glints on the snow.
  - The sprite batch carries a season class per sprite (16th `add()` argument: tree / shrub / grass / conifer…)
    for autumn recolouring, leaf drop over lazily painted bare twins (`art/season.js`, `art/trees.js`), snow caps
    and spring blossoms.
  - Terrain: snow over every biome, the ice surface (no waves, cracks, frost), golden turf and leaf litter, and
    more flowers in spring.
  - Snow on roofs (`uRoofSnow`), snowfall instead of rain and blizzards; wildlife, water sounds and the
    waterline go quiet on ice.
  - Walkers: `art/walker.js` (3 looks, dark frost-crusted armor, shoulder crystals, glowing eyes, no lying body)
    and `fx/walkerfx.js` (mist, cold light, ice shatter + `ice_shatter` sound). Ice weapons are in `art/gear.js`
    (`proj_ice_spear`); fur clothes in `art/apparel.js`.
- **Walkers break in** (later request: hiding indoors must not be safe). They sense the living through walls (14
  tiles) and are drawn to light (50 tiles, indoors too). When what they want is shut in a room (roofs.enclosedRoom),
  they pick the closest wall / door / fence of it, stand outside and hit it.
  - Every hit is op `struct.dmg` {id, d}: the same damage on every peer. The cracks grow in 4 stages from the middle
    of the top and front faces (art `siege_crack_{t,f}0..3`, fx/rockfx.js), tremble and throw splinters / chips.
  - At 1 it breaks (`struct.remove` fx `smash`: pieces drop with dust, the screen shakes nearby).
  - Pace (walker-seconds to break, one walker): wood 105, stone 350 (doubled by request, on the 5-min night).
    A group of 3 breaks a wooden wall in ~35 s (about 6-7 a night) and a stone one in ~2 min (about 2 a night).
  - Seeing a player in reach, they fight. At sunrise the cracks left settle (`struct.dmg` 0); what broke stays broken.
- **Every winter brings more walkers** (walkers.js `WINTER_GROWTH`, winter number = the calendar year):
  - winter 1: up to 3 around a player, in groups of 1-3, every 25-40 s;
  - each winter after: +2 around a player and +1 per group, and the groups come 30% sooner;
  - caps: 9 around a player, groups of 5, a group every 12 s at the soonest.
- Debug (localhost, host): `game.debug.skipTo(day, hour)` jumps the shared clock (op `env.skip`). Scenario
  **W1** covers: winter on both, frozen water, a walker replicated with its ice weapon, crumbling at sunrise, no
  green animals at night. **W2** covers: a walker breaks into a closed room with the guest inside (same cracks on
  both, the wall falls on both, the cracks settle at sunrise).

## Ajustes de jogabilidade e HUD (added later)

- The campfire has no collision (walk right up to it; `block: 0`).
- Inventory: an item's actions (Equipar, Comer, Largar…) sit right under its name, never below the fold on a phone.
- "Materiais da obra": its header (with the close button) stays in view while the list scrolls. It closes when
  the player moves or taps / clicks outside it.
- Touch HUD layout (hudlayout.js): every piece moves on its own:
  - each left button (Mochila, Criar, Construir, Mapa), Comer, Atacar, every ability slot (by position; reapplied
    when the weapon changes the abilities), Usar, Remover, Obra;
  - each corner button (menu, tela cheia, instalar, ajuda);
  - the life card, the target, the effects, the radar and the item bar.

  Layouts saved by groups are converted (`wos.hudlayout` v2).

## Corpos: arrastar pessoas, remover animais (added later)

- **Animals and monsters:** their bodies can be removed any time (context menu, the touch "Remover" button; when
  butchered or rotten, removing is their tap action).
- **People's bodies** (players and NPCs such as the raiders: pawn corpses): never removed before the bones.
  - They are dragged: "Arrastar corpo" (touch button beside the use button, context menu, or the tap action of
    an empty body) → intent `corpse.drag {on: 1}` → op `corpse.drag` (dragBy).
  - Every peer draws the body behind its dragger (corpses.js, cosmetic); the dragger walks at 72% speed.
  - "Largar corpo" (its use action while dragged) → `corpse.drag {on: 0, x, y}` → op `corpse.drop` at that spot.
  - The host lets go of a body whose dragger left or died. `corpse.discard` refuses people's bodies.
- **Winter walkers:** shatter (no body) and give XP only, no drop.
- **Touch long press on the joystick side:** a finger that starts the joystick but stays still ~0.5 s over
  something with a context menu opens the menu and gives up the joystick (input.js `joyStill` / `releaseJoy`).
  A finger that drags first stays the joystick.
- **HUD icons** (icon agent): bold cream-and-ink glyphs with an outline everywhere (`icons.js` `glyph`,
  `hud-icons.css`). "Remover" / "Arrastar" and "Obra" sit above the use button on touch, clear of the message feed.

## Plantas grátis e materiais da obra (added later)

- Placing a plan ("planta", a blueprint) never needs materials: the Construir cards always enter build mode;
  missing materials only show in red. The materials are taken when the work on a plan starts.
- **Work sites** (game/blueprints.js, local view of the shared structures):
  - plans whose footprints are at most `LINK` = 3 tiles apart form one site, on any story;
  - a site's need = the cost of every plan whose work has not started (`o.paid` ones already took theirs);
    built plans stop being blueprints, so both drop out by themselves.
- **"Obra" button** (ui/sitepanel.js):
  - it shows while the player is within 2.6 tiles of a site's plan: on touch beside the use button, on desktop
    as a chip above the use prompt, key **O** (keymap 'site');
  - it opens "Materiais da obra": how many plans are left, by type, and every material as have/need ("12/45
    madeira", green when enough), plus what is still missing;
  - it updates live and closes when the player walks away.

## Controles e HUD do jogador (added later)

Owner's request: a settings tab to remap every shortcut on desktop (keyboard keys and mouse buttons, side buttons
included) and, on phones, a tab to place the HUD freely — both kept for the next sessions.
- **Keys** (src/game/keymap.js, src/ui/keybinds.js): 36 actions × 2 bindings (movement, actions, abilities 1–5, hotbar
  1–10, windows, chat, zoom, build mode), saved in `wos.keys` (only the changes), applied in place to the live tables
  (controller KEYS / ABILITY_KEYS, input movement / zoom); middle / side mouse buttons are keys 'Mouse1/3/4' (pointer
  events: the side buttons never make the browser go back). A key taken from another action is announced. HUD key
  chips follow (event 'keymap'). Labels use the player's keyboard layout when the browser gives it.
- **HUD layout** (src/ui/hudlayout.js): Configurações → HUD → "Organizar a HUD": drag the card, quick column, effects,
  system buttons, radar, the combat bar, the use and eat buttons; per orientation in `wos.hudlayout`, applied as CSS
  `translate` on top of each block's own placement; "Restaurar padrão".

## K · Detalhes de arquitetura e decoração (added later, port 5192)

Owner's request: much more detail for interior and exterior decoration (including a **straw training dummy**
for combat practice), and, in build mode, a **"Detalhes" button** that opens a list of details for the selected
structure — corner details that make buildings less blocky, trims, styles — so building becomes relaxing and
deeply satisfying because it is beautiful. Procedural roofs (agent J) get the same detail list. Building must
feel complete and magnificent, with a lot of freedom.
- K owns: decoration content (furniture, interior/exterior props, training dummy), the per-structure **style /
  details** data model (`o.style`, `o.det`), the details UI (from `buildbar.js`), the art for styles, corners and
  details, and wall/floor/fence/door style variants.
- J owns roof geometry/rendering; **roof details** go through an interface J exposes (roof style fields read by
  J's renderer + roof-layer props such as chimneys and dormers). K defines the catalogue; J draws.
- Sync: style and details are shared structure state set by ops (place / restyle intents), in snapshot, save
  and digest. Scenarios **K1, K2…** in `tools/mp-test.js`.

## L · Andares e escadarias (added later, port 5193)

Owner's request: a system of height layers. With a roof/upper floor and a **staircase** (a stairway, not a
ladder), the player walks up to the floor above or down to the floor below — towers, houses with several
stories, and **walls you can walk on top of** (ramparts) when a staircase stands next to them.
- Stories `lv` 0 (ground), 1, 2…; upper floors need support from below (same idea as J's roof support);
  stairs connect lv n ↔ n+1 and need the tile above to be open (remove roof tiles first — everything is
  deconstructable); wall tops are walkable at the next level when reachable by stairs.
- Per-level collision/navigation, rendering by level (what is above the local player fades/hides, what is
  below an upper floor is hidden), the local player's level drives the reveal; creatures/bandits may use stairs.
- Sync: `lv` on structures (ops/snapshot/save/digest) and `z`/level in the avatar and creature streams.
- Two phases: (1) design + core in isolated modules now; (2) integration after J (roofs) and K (details) merge.
- Everything stays deconstructable; built details are fixed (rebuild to change).

## M · Caminhos no terreno (added later, port 5194)

Owner's request (with a screenshot of the soft sand/grass/water blends): a kind of "ground" construction that
is NOT square like floors — **dirt path (free, no resources)**, **gravel**, **flagstone / lajota**, etc. — painted
on the terrain and **blending softly and in detail with the ground textures**, like the river shore does.
- Painted with a brush (drag; line/area; brush size), removable; a shared per-tile path grid (ops, snapshot,
  save, digest); drawn inside the terrain pass with noisy soft edges and material detail (pebbles, cracks,
  worn ruts), edge scatter; walking speed bonus; flora never regrows on paths, grass decor hidden on them.
- Floors (inside buildings, square) stay agent K's; paths are terrain. Roofs are J's.

## N · HUD nova (added later, port 5195)

Owner's request: an absurdly better HUD — the current one "looks AI-made". Reference: `docs/ref/hud-reference.jpg`
(a stylised game HUD kit: warm cream/parchment shapes on dark brown, orange/red/teal/mustard accents,
diamond portrait frames, ribbon bars with a glowing tip, segmented radial cooldown rings, diamond ability
clusters with key tags, hand-drawn hatching around elements, a round-counter badge). The owner especially liked
the **radar-like element** (an arc gauge sitting on an elliptical ring with coloured teardrop markers around
it — like a compass/radar): "esse design combina muito com o jogo".
- N reskins and re-lays out every HUD piece (player card, bars, ability buttons, hotbar, minimap → radar,
  clock/weather badge, target frame, buffs, toasts, chat, build bar, auto-work banner, windows/panels,
  menus) on desktop and mobile, keeping all behaviour and contracts (B's HUD API, G's aim wiring, A's buildbar,
  K's Detalhes, M's paths toolbar, H's editor). Theme through CSS variables + a few drawn assets.
