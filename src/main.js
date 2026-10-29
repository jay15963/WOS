// Boot: graphics load in the background while the main menu is shown; the world is generated only
// after the player chooses (single player, host a room, or join one — a guest gets the host's seed).
// Dev shortcuts: ?seed=N starts single player directly; ?sala=CODE opens the join screen.

import { Renderer } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { buildAtlas } from './art/sprites.js';
import { startAtlasLookup, storeAtlas } from './engine/atlasCache.js';
import { generateWorld } from './world/worldgen.js';
import { World } from './world/world.js';
import { generateGroundTextures, generateNoiseTexture, TEX } from './world/terrainTex.js';
import { Environment } from './fx/environment.js';
import { Particles } from './fx/particles.js';
import { Game } from './game/game.js';
import { installSystems } from './game/systems.js';
import { installAmbient } from './fx/ambient.js';
import { Audio } from './fx/audio.js';
import { showMainMenu, wipeWorlds } from './ui/menu.js';
import { installNetUI } from './ui/netui.js';
import { applyQuality } from './ui/netpanels.js';
import { Session, playerName } from './net/session.js';
import { netlog } from './net/netlog.js';

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
    const atlas = cached.atlas || buildAtlas();
    console.info(`[boot] atlas ${cached.atlas ? 'from cache' : 'painted'} in ${Math.round(performance.now() - t0)} ms (${atlas.size}px, ${atlas.list.length} sprites)`);
    if (!cached.atlas) storeAtlas(cached.key, atlas);
    renderer.setAtlas(atlas);
    report(1, 'Pronto');
    return { renderer, atlas };
  })();
  return { promise, progress: (fn) => { listeners.push(fn); fn(...last); } };
}

async function boot() {
  try {
    const params = new URLSearchParams(location.search);
    const assets = loadAssets();
    let choice;
    if (params.has('seed')) {
      choice = { mode: 'single', seed: parseInt(params.get('seed'), 10) || 1 };
    } else {
      $('#loading').classList.add('hidden');
      await nextFrame();
      choice = await showMainMenu({ presetCode: params.get('sala') || '', progress: assets.progress });
      $('#loading').classList.remove('hidden');
    }
    status('Preparando…', 0.3); await nextFrame();
    const { renderer, atlas } = await assets.promise;

    if (choice.fresh) wipeWorlds();
    const seed = choice.mode === 'join' ? choice.welcome.seed : choice.seed;
    if (choice.mode !== 'join') { try { localStorage.setItem('wos.seed', String(seed)); } catch { /* ignore */ } }

    status(choice.mode === 'join' ? `Gerando o mundo de ${choice.welcome.hostName}…` : 'Moldando montanhas e rios…', 0.55); await nextFrame();
    const world = new World(generateWorld(seed));
    renderer.setWorld(world);
    renderer.setNoise(256, generateNoiseTexture(seed));

    status('Despertando o mundo…', 0.9); await nextFrame();
    const input = new Input($('#gl'), $('#joystick'));
    const env = new Environment(seed);
    const particles = new Particles();
    const game = new Game({ renderer, atlas, world, env, input, particles });
    game.audio = new Audio();
    try { const v = parseFloat(localStorage.getItem('wos.audio.volume')); if (Number.isFinite(v)) game.audio.volume = v; } catch { /* ignore */ }
    const unlock = () => game.audio.unlock();
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
    if (choice.mode === 'join') game.saveSuffix = '.guest';
    installAmbient(game);
    installSystems(game);
    game.player.name = playerName();
    const netui = installNetUI(game);
    game.systems.push(netui);
    window.game = game; // debug handle

    if (choice.mode === 'host') {
      const s = new Session();
      s.host(game);
      setTimeout(() => netui.pause.open('room'), 600);
    } else if (choice.mode === 'join') {
      const w = choice.welcome;
      env.hour = w.hour; env.dayIndex = w.day; env.setWeather(w.weather);
      choice.session.attach(game);
      game.events.emit('toast', { text: `Você entrou no mundo de ${w.hostName.replace(/[<>&]/g, '')}`, kind: 'good' });
    }
    netlog.fact('Modo', choice.mode === 'single' ? 'um jogador' : choice.mode === 'host' ? 'anfitrião' : 'convidado');

    $('#loading').classList.add('hidden');
    let last = performance.now();
    const fpsEl = $('#fps');
    let fpsAcc = 0, fpsN = 0, snapT = 20;
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // single player pauses while the in-game menu is open; multiplayer keeps running
      const paused = game.ui?.pause && !(game.session && game.session.state !== 'closed');
      if (!paused) game.update(dt);
      game.render();
      input.endFrame();
      // menu background: a small snapshot of the world, taken right after rendering
      snapT -= dt;
      if (snapT <= 0) { snapT = 45; takeSnapshot(renderer.canvas); }
      fpsAcc += dt; fpsN++;
      if (fpsAcc > 0.5) {
        if (fpsEl) fpsEl.textContent = `${Math.round(fpsN / fpsAcc)} fps · ${renderer.stats.sprites} spr`;
        fpsAcc = 0; fpsN = 0;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    $('#loading').classList.remove('hidden');
    status('Erro: ' + err.message);
  }
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

// PWA service worker (disabled on localhost so development never serves stale files)
if ('serviceWorker' in navigator && !/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
