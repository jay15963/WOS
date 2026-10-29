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
