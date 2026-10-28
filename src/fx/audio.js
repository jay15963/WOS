// Procedural audio (WebAudio). Owned by the environment pass.
// API used by gameplay: game.audio.play(name, { x, y, volume })  — safe no-op until implemented.
// Names: hit, crit, swing, chop, mine, pickup, eat, levelup, death, growl, ui, build, fire, splash, step

export class Audio {
  constructor() { this.ctx = null; this.enabled = true; }
  // must be called from a user gesture (first tap/click)
  unlock() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
  }
  play(name, opts = {}) { void name; void opts; }
  update(game, dt) { void game; void dt; }
}
