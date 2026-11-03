// Module worker generating world chunks off the main thread (docs/STREAMING.md): the streamer (src/world/streamer.js)
// sends { init: source.worker.init } once, then { id, cx, cy, decor } jobs; the answer is the chunk data with its typed
// arrays transferred. The generator is the same pure function the main thread falls back to.
let gen = null;
let ready = null;

async function setup(init) {
  if (init.kind === 'synth') {
    const m = await import('./synth.js');
    gen = (cx, cy, o) => m.synthChunk(init.seed, cx, cy, o);
  } else if (init.kind === 'planet') {
    const m = await import('./planetSource.js');
    gen = await m.workerGenerator(init);
  } else throw new Error('unknown source ' + init.kind);
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.init) { ready = setup(msg.init); return; }
  try {
    await ready;
    const t0 = performance.now();
    const d = gen(msg.cx, msg.cy, { decor: !!msg.decor });
    const ms = performance.now() - t0;
    const tr = [];
    for (const k in d) { const v = d[k]; if (v && v.buffer instanceof ArrayBuffer && ArrayBuffer.isView(v)) tr.push(v.buffer); }
    self.postMessage({ id: msg.id, cx: msg.cx, cy: msg.cy, d, ms }, tr);
  } catch (err) {
    self.postMessage({ id: msg.id, cx: msg.cx, cy: msg.cy, error: String(err && err.message || err) });
  }
};
