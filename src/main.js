// Boot: graphics load in the background while the main menu is shown; the world is generated only
// after the player chooses (single player, host a room, or join one — a guest gets the host's seed).
// Dev shortcuts: ?seed=N starts single player directly; ?sala=CODE opens the join screen.
// Test flags (automated two-client harness, docs/SYNC.md §4.6): ?mp=host&sala=CODE hosts directly,
// ?sala=CODE&autojoin=1 joins directly, ?nosave=1, ?link=bc (BroadcastChannel), ?pid=ID, and on localhost
// ?fakebuild=X / ?fakeart=<sprite|ph:sprite> / ?fakepaintfail=1; window.wosDebug.setHidden(bool).

import { Renderer } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { buildAtlas, buildAtlasAsync } from './art/sprites.js';
import { startAtlasLookup, storeAtlas } from './engine/atlasCache.js';
import { checkAtlas } from './game/artcheck.js';
import { BUILD_ID, BUILD_FILES } from './version.js';
import { generateWorld } from './world/worldgen.js';
import { World } from './world/world.js';
import { generateGroundTextures, generateNoiseTexture, TEX } from './world/terrainTex.js';
import { Environment } from './fx/environment.js';
import { Particles } from './fx/particles.js';
import { Game } from './game/game.js';
import { installSystems, addSystem } from './game/systems.js';
import { installAmbient } from './fx/ambient.js';
import { getAudio } from './fx/audio.js';
import { showMainMenu } from './ui/menu.js';
import { touchWorld } from './ui/worlds.js';
import { installNetUI } from './ui/netui.js';
import { applyQuality } from './ui/netpanels.js';
import { Session, playerName, normalizeCode, newRoomCode, GRAPHICS_BROKEN } from './net/session.js';
import { netlog, runtime } from './net/netlog.js';
import { installNetDebug } from './net/digest.js';

const $ = (s) => document.querySelector(s);
// Yield so the screen can paint; the timeout keeps boot going in background tabs (no rAF there).
const nextFrame = () => new Promise((r) => {
  let done = false;
  const go = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 60);
});
const status = (t, p) => {
  $('#loading-text').textContent = t;
  if (p != null) $('#loading-bar > div').style.width = Math.round(p * 100) + '%';
};

// ---------- test / dev flags (docs/SYNC.md §4.6) ----------
const QS = new URLSearchParams(location.search);
const DEV = /^(localhost|127\.|\[::1\])/.test(location.hostname);
const FLAGS = {
  noSave: QS.has('nosave'),                 // no save writes, no wos.seed, no menu snapshot
  mpHost: QS.get('mp') === 'host',          // skip the menu and host room ?sala=CODE (seed ?seed)
  autojoin: QS.has('autojoin'),             // skip the menu and join room ?sala=CODE
  code: normalizeCode(QS.get('sala') || ''),
  fakeArt: DEV ? QS.get('fakeart') : null,  // localhost: delete a sprite / mark it as a placeholder ('ph:<name>')
  paintFail: DEV && QS.has('fakepaintfail'), // localhost: one painter group throws
};
// tests: simulate a hidden tab for the background clock (iframes are never document.hidden)
const wosDebug = window.wosDebug = { hidden: false, setHidden(b) { this.hidden = !!b; } };

// ---------- background asset loading (seed-independent) ----------
function loadAssets() {
  const listeners = [];
  let last = [0, 'Carregando gráficos…'];
  const report = (p, label) => { last = [p, label]; listeners.forEach((fn) => fn(p, label)); };
  const promise = (async () => {
    const atlasLookup = startAtlasLookup();
    await nextFrame();
    const renderer = new Renderer($('#gl'));
    try { applyQuality(renderer, localStorage.getItem('wos.quality') || 'auto'); } catch { /* ignore */ }
    report(0.2, 'Pintando o terreno…'); await nextFrame();
    renderer.setGroundTextures(TEX, generateGroundTextures());
    report(0.5, 'Desenhando criaturas e plantas…'); await nextFrame();
    const cached = await atlasLookup;
    const t0 = performance.now();
    if (cached.why) netlog.warn('art', 'Atlas guardado descartado: ' + cached.why);
    let atlas = cached.atlas;
    if (atlas) {
      const chk = checkAtlas(atlas);
      if (!chk.ok) {
        netlog.warn('art', 'Atlas guardado incompleto, pintando de novo', { faltam: chk.missingSprites.concat(chk.missingKinds).slice(0, 12) });
        atlas = null;
      }
    }
    const fromCache = !!atlas;
    // first boot after an art update: paint group by group, letting the loading bar move in between
    if (!atlas) atlas = await buildAtlasAsync({ fail: FLAGS.paintFail ? 'addNatural' : null },
      (f, what) => report(0.5 + f * 0.45, what ? `Desenhando ${what}…` : 'Desenhando…'));
    atlas.source = fromCache ? 'cache' : 'painted';
    if (FLAGS.fakeArt) { // test hook: break the atlas before the handshake
      if (FLAGS.fakeArt.startsWith('ph:')) atlas.placeholders = [...(atlas.placeholders || []), FLAGS.fakeArt.slice(3)];
      else atlas.sprites.delete(FLAGS.fakeArt);
    }
    const chk = atlas.check = checkAtlas(atlas);
    runtime.atlasDigest = chk.digest; runtime.atlasOk = chk.ok;
    runtime._atlasDone();
    console.info(`[boot] atlas ${fromCache ? 'from cache' : 'painted'} in ${Math.round(performance.now() - t0)} ms (${atlas.size}px, ${atlas.list.length} sprites, digest ${chk.digest})`);
    if (!chk.ok) {
      netlog.error('art', 'Gráficos incompletos neste navegador (o atlas não será guardado e o multijogador fica bloqueado)',
        { falhas: chk.failures, substitutos: chk.placeholders, faltam: chk.missingSprites.concat(chk.missingKinds).slice(0, 20) });
    }
    if (!fromCache && chk.ok) storeAtlas(cached.key, atlas); // never cache an atlas with failures / placeholders / holes
    renderer.setAtlas(atlas);
    report(1, 'Pronto');
    return { renderer, atlas };
  })();
  return { promise, progress: (fn) => { listeners.push(fn); fn(...last); } };
}

function fail(msg) {
  console.warn('[boot] ' + msg);
  window.wosBootError = msg;
  $('#loading').classList.remove('hidden');
  status('Erro: ' + msg);
}

async function boot() {
  try {
    const assets = loadAssets();
    let choice;
    if (FLAGS.mpHost) {
      choice = { mode: 'host', seed: parseInt(QS.get('seed'), 10) || 4242, code: FLAGS.code || newRoomCode(), direct: true };
    } else if (FLAGS.autojoin && FLAGS.code.length === 6) {
      status(`Entrando na sala ${FLAGS.code}…`, 0.1);
      const session = new Session();
      try { choice = { mode: 'join', session, welcome: await session.join(FLAGS.code) }; } catch (e) { fail(e.message); return; }
    } else if (QS.has('seed')) {
      choice = { mode: 'single', seed: parseInt(QS.get('seed'), 10) || 1 };
    } else {
      // the loading screen stays until EVERYTHING the menu needs is ready (graphics painted, live background
      // drawn once): painting the atlas under a visible menu made it freeze on slow phones
      assets.progress((p, label) => status(label || 'Carregando…', 0.05 + (p || 0) * 0.85));
      await assets.promise;
      status('Preparando o menu…', 0.93); await nextFrame();
      getAudio()?.music?.setMood?.('menu'); // idempotent (the menu may set it too)
      choice = await showMainMenu({ presetCode: QS.get('sala') || '', progress: assets.progress, assets: assets.promise,
        onShown: () => $('#loading').classList.add('hidden') });
      $('#loading').classList.remove('hidden');
    }
    status('Preparando…', 0.3); await nextFrame();
    const { renderer, atlas } = await assets.promise;

    const guest = choice.mode === 'join';
    const seed = guest ? choice.welcome.seed : choice.seed;
    // a world of the list (ui/worlds.js): it goes to the top; worlds without an id (dev ?seed=) save by seed as before
    if (!guest && !FLAGS.noSave) { if (choice.worldId) touchWorld(choice.worldId); else try { localStorage.setItem('wos.seed', String(seed)); } catch { /* ignore */ } }

    status(guest ? `Gerando o mundo de ${choice.welcome.hostName}…` : 'Moldando montanhas e rios…', 0.55); await nextFrame();
    const world = new World(generateWorld(seed));
    renderer.setWorld(world);
    renderer.setNoise(256, generateNoiseTexture(seed));

    status('Despertando o mundo…', 0.8); await nextFrame();
    const input = new Input($('#gl'), $('#joystick'));
    const env = new Environment(seed);
    const particles = new Particles();
    const game = new Game({ renderer, atlas, world, env, input, particles });
    game.noSave = FLAGS.noSave;
    if (!guest) {
      game.worldId = choice.worldId;                    // save key (save.js) / hotbar layout of this world
      game.creative = choice.gameMode === 'creative';   // a new world's mode (a saved world keeps its own: snapshot `mode`)
    }
    game.audio = getAudio().attach(game); // procedural audio: unlocks on the first gesture, music moods follow the game
    if (guest) {
      // the role must be known BEFORE installSystems: a guest runs no host systems, no world save,
      // no spawners / raiders / starter flora — the world comes from the host's snapshot
      game.saveSuffix = '.guest';
      game.net.role = 'guest';
      game.net.pid = choice.session.pid;
      game.net.synced = false;
    }
    installAmbient(game);
    installSystems(game);
    installNetDebug(game);
    game.player.name = playerName();
    const netui = installNetUI(game);
    addSystem(game, netui);
    window.game = game; // debug handle
    if (!atlas.check.ok) game.later(1.5, () => game.events.emit('toast', { text: 'Gráficos incompletos neste navegador — recarregue a página (Ctrl+Shift+R). O multijogador fica bloqueado.', kind: 'warn' }));

    if (choice.mode === 'host') {
      const s = new Session();
      if (!s.host(game, choice.code)) fail(GRAPHICS_BROKEN);
      else if (!choice.direct) setTimeout(() => netui.pause.open('room'), 600);
    } else if (guest) {
      const s = choice.session, w = choice.welcome;
      status('Sincronizando o mundo…', 0.92);
      const synced = new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('o anfitrião não enviou o mundo a tempo')), 60000);
        s.on('synced', () => { clearTimeout(t); res(); });
        s.on('hostgone', (d) => { clearTimeout(t); rej(new Error('O anfitrião saiu: ' + (d.why || ''))); });
      });
      s.attach(game);
      startLoop(game, renderer, input, true); // keeps presence / messages flowing while the snapshot arrives
      try { await synced; } catch (e) { fail(e.message); return; }
      game.events.emit('toast', { text: `Você entrou no mundo de ${w.hostName.replace(/[<>&]/g, '')}`, kind: 'good' });
    }
    netlog.fact('Modo', choice.mode === 'single' ? 'um jogador' : choice.mode === 'host' ? 'anfitrião' : 'convidado');
    $('#loading').classList.add('hidden');
    startLoop(game, renderer, input, false);
  } catch (err) {
    console.error(err);
    fail(err.message);
  }
}

// ---------- frame loop (+ background clock while hidden in multiplayer) ----------
let loopState = null;
function startLoop(game, renderer, input, syncing) {
  if (loopState) { loopState.syncing = syncing; return; }
  const L = loopState = { syncing, last: performance.now(), wLast: performance.now() };
  const fpsEl = $('#fps');
  let fpsAcc = 0, fpsN = 0, snapT = 20;
  // Hidden / occluded tabs get no (or rare) requestAnimationFrame: with a live session the world (host)
  // and presence (guest) keep ticking from a worker timer (not throttled like page timers); no rendering.
  const live = () => game.session && game.session.state !== 'closed';
  const hidden = () => document.hidden || wosDebug.hidden;
  L.lastRaf = performance.now();
  const loop = (now) => {
    L.lastRaf = now;
    const dt = Math.min(0.05, Math.max(0, now - L.last) / 1000);
    L.last = now;
    if (!(hidden() && live())) {
      // single player pauses while the in-game menu is open; multiplayer keeps running
      const paused = game.ui?.pause && !(game.session && game.session.state !== 'closed');
      if (!paused) game.update(dt);
      game.render();
      input.endFrame();
      // menu background: a small snapshot of the world, taken right after rendering
      snapT -= dt;
      if (snapT <= 0 && !L.syncing && !game.noSave) { snapT = 45; takeSnapshot(renderer.canvas); }
      fpsAcc += dt; fpsN++;
      if (fpsAcc > 0.5) {
        if (fpsEl) fpsEl.textContent = `${Math.round(fpsN / fpsAcc)} fps · ${renderer.stats.sprites} spr`;
        fpsAcc = 0; fpsN = 0;
      }
      L.wLast = now;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try {
    const src = 'let t=null;onmessage=(e)=>{if(e.data===1&&!t)t=setInterval(()=>postMessage(0),50);if(e.data===0&&t){clearInterval(t);t=null;}};';
    const wk = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    wk.onmessage = () => {
      const now = performance.now();
      if (!live() || !(hidden() || now - L.lastRaf > 300)) { L.wLast = now; return; }
      let dt = Math.min(0.1, (now - L.wLast) / 1000);
      L.wLast = now; L.last = now;
      while (dt > 1e-4) { const s = Math.min(0.05, dt); game.update(s); dt -= s; }
      input.endFrame();
    };
    wk.postMessage(1);
  } catch (e) { console.warn('[boot] background clock unavailable', e); }
}

function takeSnapshot(glCanvas) {
  try {
    const w = 640, h = Math.round((glCanvas.height / glCanvas.width) * w);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(glCanvas, 0, 0, w, h);
    localStorage.setItem('wos.snap', c.toDataURL('image/jpeg', 0.62));
  } catch { /* quota or tainted: ignore */ }
}

boot();

// Dev only: version.js must describe the code that is running (tools/stamp.mjs). Refetch every stamped file
// without caches, hash it exactly like the stamp tool and compare.
async function devVersionCheck() {
  try {
    const enc = new TextEncoder();
    const parts = [];
    for (const p of BUILD_FILES) {
      const r = await fetch(p, { cache: 'no-store' });
      if (!r.ok) throw new Error(p + ' ' + r.status);
      parts.push(p + '\n' + (await r.text()).replace(/\r\n?/g, '\n') + '\n');
    }
    const buf = await crypto.subtle.digest('SHA-1', enc.encode(parts.join('')));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
    if (hex !== BUILD_ID) console.error('version.js is stale: run `node tools/stamp.mjs` (stamped ' + BUILD_ID + ', code ' + hex + ')');
  } catch (e) { console.warn('[dev] version check skipped:', e.message); }
}
if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) setTimeout(devVersionCheck, 4000);

// PWA service worker (disabled on localhost so development never serves stale files)
if ('serviceWorker' in navigator && !/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
