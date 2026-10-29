// One module worker for offline synthesis (synthWorker.js). Falls back to main-thread renders when module
// workers are unavailable or the worker fails (pool.ok === false).

export class SynthPool {
  constructor() {
    this.w = null;
    this.id = 0;
    this.cb = new Map();
    this.jobs = 0;
    try {
      this.w = new Worker(new URL('./synthWorker.js', import.meta.url), { type: 'module' });
      this.w.onmessage = (e) => {
        const c = this.cb.get(e.data.id);
        this.cb.delete(e.data.id);
        this.jobs++;
        c?.(e.data);
      };
      this.w.onerror = (e) => { e.preventDefault?.(); this._fail(); };
    } catch { this.w = null; }
  }
  get ok() { return !!this.w; }
  _fail() {
    this.w?.terminate?.();
    this.w = null;
    const cbs = [...this.cb.values()];
    this.cb.clear();
    for (const c of cbs) c({ ok: false });
  }
  run(msg, done) {
    if (!this.w) return false;
    const id = ++this.id;
    this.cb.set(id, done);
    try { this.w.postMessage({ ...msg, id }); } catch { this.cb.delete(id); return false; }
    return true;
  }
}
