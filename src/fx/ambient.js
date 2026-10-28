// Ambient life & weather FX system (owned by the environment pass).
// Installed from main.js: installAmbient(game). Runs as a regular game system.

export function installAmbient(game) {
  game.systems.push(ambientSystem());
}

function ambientSystem() {
  let acc = 0;
  return {
    update(g, dt) {
      acc += dt;
      const env = g.env.env;
      const v = g.view();
      while (acc > 0.12) {
        acc -= 0.12;
        const x = v.x0 + Math.random() * (v.x1 - v.x0), y = v.y0 + Math.random() * (v.y1 - v.y0);
        if (env.night > 0.5 && Math.random() < 0.5) {
          g.particles.emit({ spr: 'fx_spark', x, y, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, life: 3 + Math.random() * 2, size: 0.5, size1: 0.4, r: 0.8, g: 1, b: 0.4, a: 0.9, a1: 0, layer: 'emissive', lift: 0.5 + Math.random(), fadeIn: 1, ground: false });
        }
      }
    },
  };
}
