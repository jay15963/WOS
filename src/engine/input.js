// Unified keyboard / mouse / touch input.
// - Keyboard: WASD/arrows move, other keys exposed via `keys` (held) / `pressed` (this frame)
// - Touch: floating virtual joystick on the left 45% of the screen (first finger only); taps elsewhere;
//   two fingers = pinch zoom. A finger that took part in a two-finger gesture never becomes a tap or the
//   joystick (a second finger landing right after the first cancels the joystick and starts a pinch).
// - Mouse: click = tap (never movement), wheel / +/- = zoom.
// Gesture state for other modules (e.g. build-mode drags): `touches` (active touch fingers),
// `multiTouch` (≥ 2 fingers down), `pinching` (a pinch is in progress), `gestureT` (performance.now() of
// the last multi-finger moment — ignore single-finger drags that started before it); the same in one object
// `gesture = { touches, multi, pinching, pinch, t }`; `isJoyPointer(id)`; `joyZone` (left screen fraction
// of the joystick: the controller narrows it in build mode so paint drags can start almost anywhere).

const JOY_R = 56;
const PINCH_GRACE = 220; // ms: a second finger this soon after the first turns the joystick into a pinch

export class Input {
  constructor(canvas, joyEl) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // keys pressed this frame
    this.taps = [];             // [{x, y, button, type}] css px
    this.zoom = 0;              // zoom request this frame (log factor; + = closer)
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false, t: 0 };
    this.joyEl = joyEl;
    this.pointers = new Map();
    this.pinchDist = 0;
    this.touches = 0;
    this.multiTouch = false;
    this.pinching = false;
    this.gestureT = 0;
    this.gesture = { touches: 0, multi: false, pinching: false, pinch: false, t: 0 }; // same state as one object
    this.joyZone = 0.45;        // left fraction of the screen where a first finger starts the joystick
    this.isTouch = matchMedia('(pointer: coarse)').matches;

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
      if (e.code === 'Tab' || e.code === 'F1' || (e.code === 'Space' && e.target === document.body)) e.preventDefault();
      // a remapped key that the browser would also use (quick find, menu bar…): the game keeps it (never with Ctrl / ⌘)
      else if (this.bind && !e.ctrlKey && !e.metaKey && /^(Slash|Quote|Backquote|AltLeft|AltRight|F\d+)$/.test(e.code) && Object.values(this.bind).some((l) => l.includes(e.code))) e.preventDefault();
      if (!this.keys.has(e.code)) {
        this.pressed.add(e.code);
        const B = this.bind;
        if (B ? B.zoomIn.includes(e.code) : (e.code === 'Equal' || e.code === 'NumpadAdd')) this.zoom += 0.18;
        if (B ? B.zoomOut.includes(e.code) : (e.code === 'Minus' || e.code === 'NumpadSubtract')) this.zoom -= 0.18;
      }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this._endJoy(); this.pointers.clear(); this._gesture(); });

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    addEventListener('pointermove', (e) => this._move(e));
    addEventListener('pointerup', (e) => this._up(e));
    addEventListener('pointercancel', (e) => this._up(e, true));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // trackpads send many small deltas, mice ±100: scale by magnitude, cap per event
      let d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      if (e.ctrlKey) d *= 2.5; // trackpad pinch arrives as ctrl+wheel
      this.zoom -= Math.max(-0.3, Math.min(0.3, d * 0.0016));
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // middle / side mouse buttons behave as keys 'Mouse1' / 'Mouse3' / 'Mouse4' (remappable, game/keymap.js); the side
    // buttons would otherwise make the browser go back / forward and the middle one start auto-scroll
    // (pointer events: the canvas cancels pointerdown, which suppresses the compatibility mouse events, so a
    // mouseup handler would never see the side button — and the browser would navigate)
    const btnCode = (e) => (e.pointerType === 'mouse' && (e.button === 1 || e.button === 3 || e.button === 4) ? 'Mouse' + e.button : null);
    const typing = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    addEventListener('pointerdown', (e) => {
      const c = btnCode(e);
      if (!c) return;
      if (e.button !== 1 || !typing(e)) e.preventDefault();
      if (typing(e) || this.captureMouse) return;
      if (!this.keys.has(c)) this.pressed.add(c);
      this.keys.add(c);
    }, true);
    addEventListener('pointerup', (e) => { const c = btnCode(e); if (!c) return; if (e.button !== 1) e.preventDefault(); this.keys.delete(c); }, true);
    for (const n of ['mousedown', 'mouseup', 'auxclick']) addEventListener(n, (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); }, true);
    // iOS Safari: block the page's own pinch zoom (two-finger gestures belong to the game)
    for (const n of ['gesturestart', 'gesturechange']) document.addEventListener(n, (e) => e.preventDefault(), { passive: false });
  }

  _touchList() { const out = []; for (const q of this.pointers.values()) if (q.type === 'touch') out.push(q); return out; }

  _gesture() {
    const t = this._touchList();
    this.touches = t.length;
    this.multiTouch = t.length >= 2;
    if (this.multiTouch) this.gestureT = performance.now();
    const free = t.filter((q) => !q.joy);
    this.pinching = free.length >= 2;
    const G = this.gesture;
    G.touches = this.touches; G.multi = this.multiTouch; G.pinching = G.pinch = this.pinching; G.t = this.gestureT;
  }

  // is this pointer driving the joystick? (build-mode paint drags ignore it)
  isJoyPointer(id) { return this.joy.id === id; }

  _down(e) {
    e.preventDefault();
    try { this.canvas.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    const now = performance.now();
    const p = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: now, type: e.pointerType, joy: false, pinched: false };
    if (e.pointerType === 'touch') {
      this.isTouch = true;
      const others = this._touchList();
      if (!others.length && this.joy.id === null && e.clientX < innerWidth * this.joyZone) {
        p.joy = true;
        Object.assign(this.joy, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0, active: true, t: now });
        this._showJoy();
      } else if (others.length) {
        // a second finger: if the joystick just started and barely moved, this is a pinch, not walking
        const j = others.find((q) => q.joy);
        if (j && now - j.t < PINCH_GRACE && Math.hypot(j.x - j.sx, j.y - j.sy) < 14) { j.joy = false; this._endJoy(); }
        // two free fingers = a gesture: none of them may become a tap (a lone finger beside a walking
        // joystick still taps normally)
        const free = others.filter((q) => !q.joy);
        if (free.length) { for (const q of free) q.pinched = true; p.pinched = true; }
      }
    }
    this.pointers.set(e.pointerId, p);
    this._gesture();
    const free = this._touchList().filter((q) => !q.joy);
    if (free.length === 2) this.pinchDist = Math.hypot(free[0].x - free[1].x, free[0].y - free[1].y);
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (p.joy) {
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) {
        // drag the base along (floating stick)
        this.joy.ox += (dx / d) * (d - JOY_R); this.joy.oy += (dy / d) * (d - JOY_R);
        dx = (dx / d) * JOY_R; dy = (dy / d) * JOY_R;
      }
      this.joy.x = dx / JOY_R; this.joy.y = dy / JOY_R;
      this._showJoy();
      return;
    }
    if (p.type !== 'touch') return;
    const free = this._touchList().filter((q) => !q.joy);
    if (free.length >= 2) {
      const d = Math.hypot(free[0].x - free[1].x, free[0].y - free[1].y);
      if (this.pinchDist > 0 && d > 0) this.zoom += Math.log(d / this.pinchDist);
      this.pinchDist = d;
      this.gestureT = performance.now();
    }
  }

  _up(e, cancel) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.joy) { this._endJoy(); this._gesture(); return; }
    const free = this._touchList().filter((q) => !q.joy);
    if (free.length === 2) this.pinchDist = Math.hypot(free[0].x - free[1].x, free[0].y - free[1].y);
    else this.pinchDist = 0;
    this._gesture();
    if (cancel || p.pinched) return;
    const moved = Math.hypot(p.x - p.sx, p.y - p.sy);
    if (moved < 14 && performance.now() - p.t < 450) this.taps.push({ x: p.x, y: p.y, button: e.button, type: p.type });
  }

  _endJoy() {
    this.joy.id = null; this.joy.active = false; this.joy.x = this.joy.y = 0;
    if (this.joyEl) this.joyEl.style.opacity = '0';
  }

  _showJoy() {
    if (!this.joyEl) return;
    this.joyEl.style.opacity = '1';
    this.joyEl.style.transform = `translate(${this.joy.ox}px, ${this.joy.oy}px)`;
    const knob = this.joyEl.firstElementChild;
    if (knob) knob.style.transform = `translate(${this.joy.x * JOY_R}px, ${this.joy.y * JOY_R}px)`;
  }

  // analog movement vector, length <= 1
  move() {
    let x = 0, y = 0;
    const k = this.keys, B = this.bind, on = (l) => l.some((c) => k.has(c));
    if (B ? on(B.left) : (k.has('KeyA') || k.has('ArrowLeft'))) x -= 1;
    if (B ? on(B.right) : (k.has('KeyD') || k.has('ArrowRight'))) x += 1;
    if (B ? on(B.up) : (k.has('KeyW') || k.has('ArrowUp'))) y -= 1;
    if (B ? on(B.down) : (k.has('KeyS') || k.has('ArrowDown'))) y += 1;
    if (x || y) { const l = Math.hypot(x, y); return [x / l, y / l]; }
    if (this.joy.active) {
      const l = Math.hypot(this.joy.x, this.joy.y);
      if (l < 0.15) return [0, 0];
      const m = Math.min(1, (l - 0.15) / 0.75);
      return [(this.joy.x / l) * m, (this.joy.y / l) * m];
    }
    return [0, 0];
  }

  endFrame() { this.pressed.clear(); this.taps.length = 0; this.zoom = 0; }
}
