/**
 * 光の空間を描くCanvas2Dエンジン。
 * 学生版の「上下→色と形」「速さ→明るさと発生量」を、時間刻み付きの粒子へ移植しています。
 * 画面・音声・保存処理は持たず、呼び出し元がrender()を進めます。
 */
const TAU = Math.PI * 2;
const SCENES = new Set(['garden', 'water', 'aurora']);
const PALETTES = new Set(['spectral', 'lagoon', 'dusk']);
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const bounded = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const clamp01 = value => bounded(finite(value), 0, 1);

function randomGenerator(seed) {
  let value = finite(seed, 2026) >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let x = Math.imul(value ^ value >>> 15, 1 | value);
    x ^= x + Math.imul(x ^ x >>> 7, 61 | x);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

/** 生徒が変更しやすい、なぞり操作の対応関係。位置・速さはCSS px。 */
export function pointerAppearance(y, height, speed, pressure = .5) {
  const normalY = clamp01(finite(y) / Math.max(1, finite(height, 1)));
  const energy = bounded(finite(speed) / 900 + clamp01(pressure) * .18, .1, 1);
  return {
    hue: normalY * 220,
    shape: normalY > .65 ? 'round' : 'star',
    sides: normalY > .65 ? 0 : Math.floor(3 + (1 - normalY) * 5),
    energy,
    size: (3 + (1 - normalY) * 5) * (.7 + energy * .5),
  };
}

export class VisualField {
  constructor(canvas, {seed = 2026} = {}) {
    this.canvas = canvas;
    try { this.ctx = canvas?.getContext?.('2d', {alpha: false}) ?? null; }
    catch { this.ctx = null; }
    this.supported = !!this.ctx;
    this.disposed = false;
    this.width = 1; this.height = 1; this.dpr = 1;
    this.scene = 'garden';
    this.options = {intensity: .68, motion: .7, palette: 'spectral', trails: .65, quality: 'auto'};
    this.demo = true;
    this.random = randomGenerator(seed);
    this.particles = [];
    this.ripples = [];
    this.pointers = new Map();
    this._signal = {level: .2, pitchHz: null, hasPitch: false};
    this._voiceHue = 180;
    this._spectralHue = 180;
    this._time = 0;
    this._emission = 0;
    this._audioEmission = 0;
    this._rippleClock = 0;
    this._fresh = true;
    this._primed = false;
    this._stars = Array.from({length: 95}, () => ({x: this.random(), y: this.random(), size: .3 + this.random() * 1.1, alpha: .12 + this.random() * .4}));
  }

  get stats() {
    return {particles: this.particles.length, maxParticles: this._limit(), ripples: this.ripples.length};
  }

  _limit() {
    const quality = this.options.quality;
    if (quality === 'low') return 420;
    if (quality === 'high') return 1500;
    return this.width * this.height < 340000 ? 560 : 950;
  }

  resize(width, height, dpr = 1) {
    if (this.disposed) return;
    const previousWidth = this.width, previousHeight = this.height;
    this.width = bounded(finite(width, 1), 1, 8192);
    this.height = bounded(finite(height, 1), 1, 8192);
    this.dpr = bounded(finite(dpr, 1), 1, 2);
    if (this.canvas) {
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
    }
    // 表示サイズが変わっても、既に描いた光の相対位置を保ちます。
    for (const p of this.particles) { p.x *= this.width / previousWidth; p.y *= this.height / previousHeight; p.px = p.x; p.py = p.y; }
    for (const p of this.ripples) { p.x *= this.width / previousWidth; p.y *= this.height / previousHeight; }
    for (const p of this.pointers.values()) { p.x *= this.width / previousWidth; p.y *= this.height / previousHeight; p.lastX = p.x; p.lastY = p.y; }
    this._fresh = true;
    if (!this._primed && this.width > 20 && this.height > 20) this._prime();
    this._trim();
  }

  setScene(scene) {
    if (this.disposed || !SCENES.has(scene) || this.scene === scene) return;
    this.scene = scene;
    this.clear();
    this._prime();
  }

  setOptions(options = {}) {
    if (this.disposed || !options || typeof options !== 'object') return;
    for (const key of ['intensity', 'motion', 'trails']) {
      if (Number.isFinite(options[key])) this.options[key] = clamp01(options[key]);
    }
    if (PALETTES.has(options.palette)) this.options.palette = options.palette;
    if (['auto', 'low', 'high'].includes(options.quality)) this.options.quality = options.quality;
    this._trim();
  }

  setDemo(enabled) { if (!this.disposed) this.demo = enabled === true; }

  pointer({id, x, y, pressure = .5} = {}) {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y) || id === undefined) return;
    const nextX = bounded(x, 0, this.width), nextY = bounded(y, 0, this.height);
    const current = this.pointers.get(id);
    if (current) { current.x = nextX; current.y = nextY; current.pressure = clamp01(pressure); }
    else if (this.pointers.size < 12) {
      this.pointers.set(id, {x: nextX, y: nextY, lastX: nextX, lastY: nextY, pressure: clamp01(pressure)});
      this.burst(nextX, nextY);
    }
  }

  release(id) { this.pointers.delete(id); }

  burst(x, y) {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    x = bounded(x, 0, this.width); y = bounded(y, 0, this.height);
    const count = 18 + Math.round(this.options.intensity * 20);
    for (let i = 0; i < count; i++) this._emit(x, y, .7, false, this.random() * TAU, 10 + this.random() * 48);
    this._ripple(x, y, .8);
    this._trim();
  }

  clear() {
    this.particles.length = 0; this.ripples.length = 0;
    this.pointers.clear();
    this._emission = 0; this._audioEmission = 0; this._rippleClock = 0; this._fresh = true;
  }

  dispose() {
    this.clear();
    this.disposed = true;
    this.ctx = null;
    this.supported = false;
  }

  _trim() {
    const excess = this.particles.length - this._limit();
    if (excess > 0) this.particles.splice(0, excess);
    if (this.ripples.length > 22) this.ripples.splice(0, this.ripples.length - 22);
  }

  _colour(hue, alpha = 1, lightness = 65) {
    let chosen = hue;
    if (this.options.palette === 'lagoon') chosen = 155 + hue * .25;
    if (this.options.palette === 'dusk') chosen = (315 + hue * .36) % 360;
    return `hsla(${chosen.toFixed(2)},82%,${lightness}%,${clamp01(alpha).toFixed(4)})`;
  }

  _emit(x, y, energy = .4, voiced = false, angle = null, speed = null, hueOverride = null) {
    const appearance = pointerAppearance(y, this.height, energy * 900, .2);
    const a = angle ?? this.random() * TAU;
    const velocity = speed ?? (5 + this.random() * 23) * (.5 + energy);
    this.particles.push({
      x, y, px: x, py: y,
      vx: Math.cos(a) * velocity, vy: Math.sin(a) * velocity,
      life: 2.5 + this.random() * 4.6, age: this.random() * .2,
      hue: (Number.isFinite(hueOverride) ? hueOverride : voiced ? this._voiceHue : appearance.hue) + this.random() * 16 - 8,
      energy: bounded(energy, .05, 1), size: .65 + this.random() * 1.7,
      sides: appearance.sides, phase: this.random() * TAU,
    });
  }

  _ripple(x, y, energy = .4, hueOverride = null) {
    this.ripples.push({x, y, radius: 1, age: 0, life: 4 + energy * 3, hue: Number.isFinite(hueOverride) ? hueOverride : y / this.height * 220, energy});
    this._trim();
  }

  _prime() {
    this._primed = true;
    const count = Math.min(this._limit(), this.options.quality === 'low' ? 190 : 390);
    for (let i = 0; i < count; i++) {
      const u = this.random(), angle = u * TAU * 2;
      const spread = this.random();
      const x = this.width * (.5 + Math.sin(angle) * (.15 + spread * .23));
      const y = this.height * (.5 + Math.cos(angle * .61) * (.10 + spread * .29));
      this._emit(x, y, .15 + this.random() * .45, false, angle, 4 + this.random() * 13);
      this.particles[this.particles.length - 1].age = .3 + this.random() * 1.4;
    }
    if (this.scene === 'water') {
      for (let i = 0; i < 6; i++) { this._ripple(this.width * (.15 + this.random() * .7), this.height * (.2 + this.random() * .6), .35); this.ripples.at(-1).age = this.random() * 3; }
    }
  }

  _background(time, dt) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // 残像の消え方を経過秒に対応させ、リフレッシュレート差を小さくします。
    const fade = this._fresh ? 1 : 1 - Math.pow(1 - (.14 + (1 - this.options.trails) * .52), Math.max(.1, dt * 60));
    ctx.fillStyle = `rgba(3,6,12,${fade})`;
    ctx.fillRect(0, 0, this.width, this.height);
    this._fresh = false;
    const centres = this.scene === 'aurora' ? [[.33, .3, 172], [.7, .4, 258]] : [[.34, .47, 180], [.73, .55, 258]];
    for (const [x, y, hue] of centres) {
      const radius = Math.max(this.width, this.height) * .57;
      const gradient = ctx.createRadialGradient(this.width * x, this.height * y, 0, this.width * x, this.height * y, radius);
      gradient.addColorStop(0, this._colour(hue, .018 + this.options.intensity * .012, 25));
      gradient.addColorStop(1, 'rgba(3,6,12,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, this.width, this.height);
    }
    for (const star of this._stars) {
      ctx.fillStyle = this._colour(star.y * 220, star.alpha * (.4 + this.options.intensity * .4), 73);
      ctx.beginPath(); ctx.arc(star.x * this.width, star.y * this.height, star.size, 0, TAU); ctx.fill();
    }
  }

  _garden(time, level) {
    const ctx = this.ctx, width = this.width, height = this.height;
    ctx.globalCompositeOperation = 'lighter';
    const anchors = [[.29, .47, .18, 165], [.62, .37, .23, 205], [.76, .7, .12, 275]];
    // 一枚ずつ異なる曲率を持つ花弁を重ね、触れなくても光の庭として成立させます。
    for (let index = 0; index < anchors.length; index++) {
      const [nx, ny, scale, hue] = anchors[index];
      const cx = width * nx, cy = height * ny;
      const radius = Math.min(width, height * 1.7) * scale * (.95 + level * .15);
      const petals = 17 + index * 4;
      const turn = time * .022 * (index % 2 ? -1 : 1);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.4);
      gradient.addColorStop(0, this._colour(hue, .035 + level * .02));
      gradient.addColorStop(1, this._colour(hue + 35, 0));
      ctx.fillStyle = gradient; ctx.fillRect(cx - radius * 1.4, cy - radius * 1.4, radius * 2.8, radius * 2.8);
      for (let i = 0; i < petals; i++) {
        const angle = i / petals * TAU + turn;
        const r = radius * (.7 + Math.sin(i * 1.73 + time * .07) * .12);
        const ex = cx + Math.cos(angle) * r, ey = cy + Math.sin(angle) * r * .72;
        ctx.strokeStyle = this._colour(hue + i * 2.3, (.07 + level * .055) * (.4 + this.options.intensity));
        ctx.lineWidth = .65;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.bezierCurveTo(cx + Math.cos(angle - .63) * r * .7, cy + Math.sin(angle - .63) * r * .65, ex, ey, cx, cy);
        ctx.stroke();
      }
      ctx.fillStyle = this._colour(hue, .75, 80);
      ctx.beginPath(); ctx.arc(cx, cy, 1.4 + level * 1.5, 0, TAU); ctx.fill();
    }
    // 緩い帯状の流線。粒子の軌跡と重なって奥行きが生まれます。
    for (let line = 0; line < 18; line++) {
      ctx.beginPath();
      for (let i = 0; i <= 65; i++) {
        const u = i / 65;
        const x = width * (.06 + u * .9);
        const y = height * (.56 + Math.sin(u * 5.4 + time * .075 + line * .04) * .2 + Math.sin(u * 10 - time * .05) * .05) + line * 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = this._colour(175 + line * 4, .025 + this.options.intensity * .018);
      ctx.lineWidth = .7; ctx.stroke();
    }
  }

  _water(time, level) {
    const ctx = this.ctx, width = this.width, height = this.height;
    ctx.globalCompositeOperation = 'lighter';
    for (let row = 0; row < 21; row++) {
      ctx.beginPath();
      for (let i = 0; i <= 55; i++) {
        const u = i / 55, y = height * (.15 + row * .034) + Math.sin(u * 11 + row * .28 - time * .3) * (5 + level * 12);
        if (!i) ctx.moveTo(u * width, y); else ctx.lineTo(u * width, y);
      }
      ctx.strokeStyle = this._colour(170 + row * 4, .022 + this.options.intensity * .016);
      ctx.lineWidth = .65; ctx.stroke();
    }
    for (const ripple of this.ripples) {
      const progress = ripple.age / ripple.life;
      const radius = 8 + progress * Math.min(width, height) * .44;
      const alpha = Math.sin(Math.PI * bounded(progress, 0, 1)) * (.15 + this.options.intensity * .12);
      for (let ring = 0; ring < 3; ring++) {
        ctx.strokeStyle = this._colour(ripple.hue + ring * 18, alpha * (1 - ring * .24));
        ctx.lineWidth = ring === 0 ? 1.1 : .6;
        ctx.beginPath(); ctx.ellipse(ripple.x, ripple.y, radius + ring * 8, (radius + ring * 8) * .48, -.11, 0, TAU); ctx.stroke();
      }
    }
  }

  _aurora(time, level) {
    const ctx = this.ctx, width = this.width, height = this.height;
    ctx.globalCompositeOperation = 'lighter';
    const count = this.options.quality === 'low' ? 85 : 145;
    // 無数の細い縦糸を波状のリボンへ束ねます。白い面で画面を埋めないよう低い不透明度を使います。
    for (let ribbon = 0; ribbon < 3; ribbon++) {
      for (let i = 0; i < count; i++) {
        const u = i / (count - 1);
        const x = width * (.02 + u * .96);
        const wave = Math.sin(u * 5.8 + ribbon * 1.4 + time * .085) * .15;
        const top = height * (.19 + ribbon * .105 + wave);
        const length = height * (.14 + Math.sin(u * 12 + ribbon + time * .07) * .055 + level * .08);
        const gradient = ctx.createLinearGradient(x, top, x + width * .025, top + length);
        const hue = (this._signal.hasPitch ? this._voiceHue : 165 + ribbon * 42) + u * 28;
        const edge = Math.pow(Math.sin(u * Math.PI), .6);
        const alpha = (.12 + this.options.intensity * .1 + level * .05) * edge;
        gradient.addColorStop(0, this._colour(hue, alpha));
        gradient.addColorStop(.35, this._colour(hue + 12, alpha * .45));
        gradient.addColorStop(1, this._colour(hue + 26, 0));
        ctx.strokeStyle = gradient; ctx.lineWidth = width / count * 1.18;
        ctx.beginPath(); ctx.moveTo(x, top);
        ctx.bezierCurveTo(x + Math.sin(u * 8 + time * .1) * width * .025, top + length * .4, x + width * .015, top + length * .7, x + width * .035, top + length);
        ctx.stroke();
      }
      ctx.beginPath();
      for (let i = 0; i <= 90; i++) {
        const u = i / 90;
        const x = width * (.02 + u * .96), y = height * (.19 + ribbon * .105 + Math.sin(u * 5.8 + ribbon * 1.4 + time * .085) * .15);
        if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = this._colour(170 + ribbon * 42, .09 + level * .07); ctx.lineWidth = .85; ctx.stroke();
    }
  }

  _advanceParticles(dt, time, level) {
    const speed = this.options.motion * (.55 + level * .5);
    const active = [];
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.px = p.x; p.py = p.y;
      const nx = p.x / this.width, ny = p.y / this.height;
      const angle = Math.sin(nx * 5.2 + time * .095) * 2 + Math.cos(ny * 6 - time * .07) * 1.7;
      const driftX = Math.cos(angle) * (this.scene === 'water' ? 12 : 24);
      const driftY = Math.sin(angle) * (this.scene === 'aurora' ? 7 : 16);
      p.x += (p.vx + driftX) * dt * speed;
      p.y += (p.vy + driftY) * dt * speed;
      const damping = Math.exp(-dt * .25);
      p.vx *= damping; p.vy *= damping;
      if (p.x < -50 || p.x > this.width + 50 || p.y < -50 || p.y > this.height + 50) continue;
      const fade = Math.sin(Math.PI * bounded(p.age / p.life, 0, 1));
      const alpha = fade * (.18 + p.energy * .36) * (.35 + this.options.intensity * .8);
      ctx.strokeStyle = this._colour(p.hue, alpha, 64 + p.energy * 12);
      ctx.lineWidth = p.size * .48;
      ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x + driftX * .022, p.y + driftY * .022); ctx.stroke();
      ctx.fillStyle = this._colour(p.hue, alpha * .8, 75);
      // 学生版と同じく、上の粒子は小さな星、下の粒子は丸い光になります。
      if (p.sides && p.size > 1.35) {
        const radius = p.size * (1 + p.energy * .7);
        ctx.beginPath();
        for (let i = 0; i < p.sides * 2; i++) {
          const a = i / (p.sides * 2) * TAU + p.phase;
          const r = i % 2 ? radius * .35 : radius;
          const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
          if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
      } else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * .8, 0, TAU); ctx.fill(); }
      active.push(p);
    }
    this.particles = active;
  }

  render({time = 0, dt = 1 / 60, signal = {}} = {}) {
    if (this.disposed || !this.ctx) return;
    time = bounded(finite(time, this._time), 0, 1e8);
    dt = bounded(finite(dt, 1 / 60), 0, .05);
    this._time = time;
    this._signal = {level: clamp01(signal?.level), hasPitch: signal?.hasPitch === true && Number.isFinite(signal?.pitchHz) && signal.pitchHz > 0, pitchHz: finite(signal?.pitchHz, 220), centroidHz: bounded(finite(signal?.centroidHz), 0, 24000)};
    if (this._signal.hasPitch) {
      const pitch = clamp01(Math.log2(bounded(this._signal.pitchHz, 80, 1200) / 80) / Math.log2(15));
      const targetHue = (1 - pitch) * 220;
      this._voiceHue += (targetHue - this._voiceHue) * (1 - Math.exp(-dt * 4));
    }
    // 基本周波数を検出できない音も、周波数重心で色に反映します。
    // こちらは音高の推定ではないためhasPitchと混同しません。
    if (!this._signal.hasPitch && this._signal.centroidHz > 0) {
      const band = clamp01(Math.log2(bounded(this._signal.centroidHz, 150, 8000) / 150) / Math.log2(8000 / 150));
      const targetHue = (1 - band) * 220;
      this._spectralHue += (targetHue - this._spectralHue) * (1 - Math.exp(-dt * 4));
    }
    const level = this._signal.level;
    const motion = this.options.motion;
    const visualTime = time * motion;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.save();
    try {
      this._background(visualTime, dt);
      if (this.scene === 'garden') this._garden(visualTime, level);
      if (this.scene === 'water') this._water(visualTime, level);
      if (this.scene === 'aurora') this._aurora(visualTime, level);
      if (dt > 0) {
        const demoRate = this.demo ? (35 + this.options.intensity * 85 + level * 95) : 0;
        this._emission += dt * demoRate * Math.max(.15, motion);
        const emitCount = Math.min(24, Math.floor(this._emission));
        this._emission -= emitCount;
        for (let i = 0; i < emitCount; i++) {
          const lane = i % 3;
          const x = this.width * (.5 + Math.sin(visualTime * .17 + lane * 2.1) * .29 + Math.sin(visualTime * .53) * .045);
          const y = this.height * (.5 + Math.cos(visualTime * .23 + lane * 1.7) * .25);
          this._emit(x, y, .25 + level * .55, this._signal.hasPitch);
        }
        // 実音源・マイクではデモを止めても音のエネルギーから新しい光を作ります。
        // 音量の閾値以下は補充せず、既存の粒子だけを自然に消します。
        const audioStrength = !this.demo ? clamp01((level - .06) / .94) : 0;
        if (audioStrength > 0) {
          const audioRate = audioStrength * (85 + this.options.intensity * 190);
          this._audioEmission += dt * audioRate;
          const audioCount = Math.min(24, Math.floor(this._audioEmission));
          this._audioEmission -= audioCount;
          const hue = this._signal.hasPitch ? this._voiceHue : this._spectralHue;
          for (let i = 0; i < audioCount; i++) {
            const x = this.width * (.5 + Math.sin(visualTime * .25) * .17 + (this.random() - .5) * (.14 + audioStrength * .42));
            const y = this.height * (.24 + hue / 220 * .48 + (this.random() - .5) * .12);
            this._emit(x, y, .15 + audioStrength * .75, this._signal.hasPitch, null, null, hue);
          }
        } else this._audioEmission = 0;
        for (const p of this.pointers.values()) {
          const distance = Math.hypot(p.x - p.lastX, p.y - p.lastY);
          const appearance = pointerAppearance(p.y, this.height, distance / Math.max(dt, .001), p.pressure);
          const count = Math.min(22, Math.max(1, Math.floor(distance / 6 + dt * 24)));
          for (let i = 0; i < count; i++) {
            const f = (i + .5) / count;
            this._emit(p.lastX + (p.x - p.lastX) * f, p.lastY + (p.y - p.lastY) * f, appearance.energy);
          }
          p.lastX = p.x; p.lastY = p.y;
        }
        this._rippleClock += dt;
        if (this.scene === 'water' && (this.demo || audioStrength > 0) && this._rippleClock > (this.demo ? 1.1 : 1.5 - audioStrength)) {
          this._rippleClock = 0;
          const hue = this._signal.hasPitch ? this._voiceHue : this._spectralHue;
          this._ripple(this.width * (.2 + this.random() * .6), this.height * (.24 + this.random() * .5), .2 + level * .6, this.demo ? null : hue);
        }
        for (const ripple of this.ripples) ripple.age += dt * (.35 + motion * .65);
        this.ripples = this.ripples.filter(ripple => ripple.age < ripple.life);
      }
      this._trim();
      this._advanceParticles(dt, visualTime, level);
    } finally { this.ctx.restore(); }
  }
}
