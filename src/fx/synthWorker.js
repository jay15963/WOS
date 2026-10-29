// Synth worker: renders SFX variants and music notes off the main thread (pure DSP, no WebAudio).
// in: { id, kind: 'sfx', name } | { id, kind: 'note', inst, m, v, sr }   out: { id, ok, sr?, data: Float32Array[] }

import { renderSfx } from './sfxBank.js';
import { renderNote } from './musicInstruments.js';

self.onmessage = (e) => {
  const q = e.data || {};
  try {
    if (q.kind === 'sfx') {
      const r = renderSfx(q.name);
      if (!r) { self.postMessage({ id: q.id, ok: false }); return; }
      self.postMessage({ id: q.id, ok: true, sr: r.sr, data: r.list }, r.list.map((d) => d.buffer));
    } else if (q.kind === 'note') {
      const d = renderNote(q.inst, q.m, q.v, q.sr);
      if (!d) { self.postMessage({ id: q.id, ok: false }); return; }
      self.postMessage({ id: q.id, ok: true, sr: q.sr, data: [d] }, [d.buffer]);
    } else self.postMessage({ id: q.id, ok: false });
  } catch (err) {
    self.postMessage({ id: q.id, ok: false, err: String(err) });
  }
};
