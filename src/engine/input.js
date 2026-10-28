// Unified keyboard / mouse / touch input.
// - Keyboard: WASD/arrows move, other keys exposed via pressed set + onKey callbacks
// - Touch: floating virtual joystick on the left 45% of the screen; taps elsewhere; pinch zoom
// - Mouse: click = tap, wheel = zoom

export class Input {
  constructor(canvas, joyEl) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // keys pressed this frame
    this.taps = [];             // [{x, y}] css px
    this.zoom = 0;              // accumulated zoom factor (log)
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false };
    this.joyEl = joyEl;
    this.pointers = new Map();
    this.pinchDist = 0;
    this.isTouch = matchMedia('(pointer: coarse)').matches;

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this._endJoy(); });

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    addEventListener('pointermove', (e) => this._move(e));
    addEventListener('pointerup', (e) => this._up(e));
    addEventListener('pointercancel', (e) => this._up(e, true));
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom -= Math.sign(e.deltaY) * 0.12; }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _down(e) {
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType, joy: false };
    if (e.pointerType === 'touch') this.isTouch = true;
    if (e.pointerType === 'touch' && this.joy.id === null && e.clientX < innerWidth * 0.45 && this.pointers.size === 0) {
      p.joy = true;
      Object.assign(this.joy, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0, active: true });
      this._showJoy();
    }
    this.pointers.set(e.pointerId, p);
    const others = [...this.pointers.values()].filter((q) => !q.joy);
    if (others.length === 2) this.pinchDist = Math.hypot(others[0].x - others[1].x, others[0].y - others[1].y);
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (p.joy) {
      const R = 56;
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        // drag the base along (floating stick)
        this.joy.ox += (dx / d) * (d - R); this.joy.oy += (dy / d) * (d - R);
        dx = (dx / d) * R; dy = (dy / d) * R;
      }
      this.joy.x = dx / R; this.joy.y = dy / R;
      this._showJoy();
      return;
    }
    const others = [...this.pointers.values()].filter((q) => !q.joy);
    if (others.length === 2) {
      const d = Math.hypot(others[0].x - others[1].x, others[0].y - others[1].y);
      if (this.pinchDist > 0) this.zoom += Math.log(d / this.pinchDist);
      this.pinchDist = d;
      others.forEach((q) => { q.pinched = true; });
    }
  }

  _up(e, cancel) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.joy) { this._endJoy(); return; }
    if (cancel || p.pinched) return;
    const moved = Math.hypot(p.x - p.sx, p.y - p.sy);
    if (moved < 14 && performance.now() - p.t < 450) this.taps.push({ x: p.x, y: p.y, button: e.button });
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
    if (knob) knob.style.transform = `translate(${this.joy.x * 56}px, ${this.joy.y * 56}px)`;
  }

  // analog movement vector, length <= 1
  move() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
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
