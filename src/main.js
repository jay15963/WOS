// Boot: build textures, world, atlas; start loop.

import { Renderer } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { buildAtlas } from './art/sprites.js';
import { generateWorld } from './world/worldgen.js';
import { World } from './world/world.js';
import { generateGroundTextures, generateNoiseTexture, TEX } from './world/terrainTex.js';
import { Environment } from './fx/environment.js';
import { Particles } from './fx/particles.js';
import { Game } from './game/game.js';
import { installSystems } from './game/systems.js';
import { installAmbient } from './fx/ambient.js';
import { Audio } from './fx/audio.js';

const $ = (s) => document.querySelector(s);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  const status = (t, p) => {
    $('#loading-text').textContent = t;
    if (p != null) $('#loading-bar > div').style.width = Math.round(p * 100) + '%';
  };
  try {
    const params = new URLSearchParams(location.search);
    const seed = parseInt(params.get('seed') || localStorage.getItem('wos.seed') || '20261028', 10);

    status('Preparando renderizador…', 0.05); await nextFrame();
    const canvas = $('#gl');
    const renderer = new Renderer(canvas);

    status('Moldando montanhas e rios…', 0.15); await nextFrame();
    const gen = generateWorld(seed);
    const world = new World(gen);
    renderer.setWorld(world);

    status('Pintando o terreno…', 0.45); await nextFrame();
    renderer.setGroundTextures(TEX, generateGroundTextures(seed));
    renderer.setNoise(256, generateNoiseTexture(seed));

    status('Desenhando criaturas e plantas…', 0.7); await nextFrame();
    const atlas = buildAtlas();
    renderer.setAtlas(atlas);

    status('Despertando o mundo…', 0.92); await nextFrame();
    const input = new Input(canvas, $('#joystick'));
    const env = new Environment(seed);
    const particles = new Particles();
    const game = new Game({ renderer, atlas, world, env, input, particles });
    game.audio = new Audio();
    const unlock = () => game.audio.unlock();
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
    installAmbient(game);
    installSystems(game);
    window.game = game; // debug handle

    $('#loading').classList.add('hidden');
    let last = performance.now();
    const fpsEl = $('#fps');
    let fpsAcc = 0, fpsN = 0;
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      game.update(dt);
      game.render();
      input.endFrame();
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
    status('Erro: ' + err.message);
  }
}

boot();

// PWA service worker (disabled on localhost so development never serves stale files)
if ('serviceWorker' in navigator && !/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
