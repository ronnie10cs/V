// La cara de V: un visor de cristal con ojos y boca de luz que reaccionan a su
// estado (escucha, piensa, habla), a su ánimo y a tus manos.

const PALETTE = {
  idle: [94, 231, 255],
  listening: [108, 243, 197],
  thinking: [167, 139, 250],
  speaking: [94, 231, 255],
  confirm: [255, 195, 107],
  offline: [120, 130, 150],
};

// Parámetros objetivo por ánimo. Todos se interpolan suavemente.
const MOODS = {
  neutral:     { eyeH: 1.0, happy: 0,   smile: 0.25, mouthW: 1.0, browA: 0,    browY: 0,    squint: 0,   skew: 0,    round: 0 },
  feliz:       { eyeH: 1.0, happy: 1,   smile: 0.9,  mouthW: 1.15, browA: 0,   browY: -0.2, squint: 0,   skew: 0,    round: 0 },
  curioso:     { eyeH: 1.12, happy: 0,  smile: 0.1,  mouthW: 0.8, browA: 0.35, browY: -0.6, squint: 0,   skew: 0.2,  round: 0 },
  pensativo:   { eyeH: 0.8, happy: 0,   smile: -0.05, mouthW: 0.7, browA: -0.2, browY: 0.1, squint: 0.1, skew: 0.35, round: 0 },
  sorprendido: { eyeH: 1.3, happy: 0,   smile: 0,    mouthW: 0.45, browA: 0,   browY: -1.0, squint: 0,   skew: 0,    round: 1 },
  serio:       { eyeH: 0.78, happy: 0,  smile: -0.1, mouthW: 0.85, browA: -0.45, browY: 0.35, squint: 0, skew: 0,    round: 0 },
  travieso:    { eyeH: 0.95, happy: 0,   smile: 0.7, mouthW: 1.0, browA: 0.3,  browY: -0.3, squint: 0.55, skew: 0.45, round: 0 },
  preocupado:  { eyeH: 1.05, happy: 0,  smile: -0.45, mouthW: 0.8, browA: 0.55, browY: -0.3, squint: 0, skew: 0,   round: 0 },
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Face {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'offline';
    this.mood = 'neutral';
    this.levelFn = null;
    this.look = null; // {x, y} en -1..1 cuando hay una mano que seguir
    this.p = { ...MOODS.neutral, open: 1, gx: 0, gy: 0, talk: 0, ring: 0, color: [...PALETTE.offline] };
    this.nextBlink = performance.now() + 2500;
    this.blinkUntil = 0;
    this.wander = { x: 0, y: 0, next: 0 };
    this.moodUntil = 0;
    this.t0 = performance.now();
    this.last = this.t0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      this.dpr = dpr;
    };
    resize();
    new ResizeObserver(resize).observe(canvas);
    this.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame((t) => this.frame(t));
  }

  setState(state) { this.state = state; }

  // El ánimo dura un rato y luego vuelve a neutral.
  setMood(mood, holdMs = 9000) {
    this.mood = MOODS[mood] ? mood : 'neutral';
    this.moodUntil = performance.now() + holdMs;
  }

  setLevel(fn) { this.levelFn = fn; }
  lookAt(x, y) { this.look = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }; }
  clearLook() { this.look = null; }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.update(now, dt);
    this.draw(now);
    requestAnimationFrame((t) => this.frame(t));
  }

  update(now, dt) {
    const p = this.p;
    if (this.moodUntil && now > this.moodUntil && this.state !== 'speaking') {
      this.mood = 'neutral';
      this.moodUntil = 0;
    }
    const target = { ...MOODS[this.mood] };

    // Mirada: la mano manda; si no, pequeños movimientos naturales.
    let gx = 0, gy = 0;
    if (this.look) {
      gx = this.look.x; gy = this.look.y;
    } else if (this.state === 'thinking') {
      gx = 0.55 + Math.sin(now / 700) * 0.15; gy = -0.65;
    } else {
      if (now > this.wander.next) {
        this.wander.x = (Math.random() - 0.5) * 0.7;
        this.wander.y = (Math.random() - 0.5) * 0.4;
        this.wander.next = now + 1500 + Math.random() * 3000;
      }
      gx = this.wander.x; gy = this.wander.y;
    }
    if (this.state === 'listening') target.eyeH *= 1.1;

    // Parpadeo.
    let open = 1;
    if (now > this.nextBlink) {
      this.blinkUntil = now + 130;
      this.nextBlink = now + 2200 + Math.random() * 4200;
    }
    if (now < this.blinkUntil) open = 0.08;

    // Boca: nivel de voz real o simulado.
    let talk = 0;
    if (this.state === 'speaking') {
      const level = this.levelFn ? this.levelFn() : null;
      talk = level == null
        ? 0.35 + 0.35 * Math.abs(Math.sin(now / 90)) * Math.abs(Math.sin(now / 230))
        : clamp(level * 3.2, 0, 1);
    }

    const k = 1 - Math.pow(0.0008, dt); // suavizado independiente de los FPS
    const kFast = 1 - Math.pow(0.00001, dt);
    for (const key of Object.keys(target)) p[key] = lerp(p[key], target[key], k);
    p.gx = lerp(p.gx, gx, this.look ? kFast : k);
    p.gy = lerp(p.gy, gy, this.look ? kFast : k);
    p.open = lerp(p.open, open, kFast);
    p.talk = lerp(p.talk, talk, kFast);
    p.ring = lerp(p.ring, this.state === 'listening' ? 1 : 0, k);
    const color = PALETTE[this.mood === 'preocupado' && this.state === 'idle' ? 'confirm' : this.state] || PALETTE.idle;
    p.color = p.color.map((c, i) => lerp(c, color[i], k));
  }

  draw(now) {
    const { ctx, canvas, p } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const S = Math.min(W, H * 1.25) * 0.8;
    const cx = W / 2, cy = H / 2;
    const [r, g, b] = p.color.map(Math.round);
    const rgba = (a) => `rgba(${r},${g},${b},${a})`;
    const t = (now - this.t0) / 1000;
    const breathe = this.reduceMotion ? 0 : Math.sin(t * 1.3) * 0.006;

    // Visor.
    const vw = S * 0.95, vh = S * 0.7;
    const vx = cx - vw / 2, vy = cy - vh / 2 + S * breathe;
    const grad = ctx.createLinearGradient(0, vy, 0, vy + vh);
    grad.addColorStop(0, 'rgba(20,26,40,0.92)');
    grad.addColorStop(1, 'rgba(8,11,19,0.96)');
    ctx.save();
    roundRect(ctx, vx, vy, vw, vh, S * 0.2);
    ctx.fillStyle = grad;
    ctx.shadowColor = rgba(0.25 + p.ring * 0.35);
    ctx.shadowBlur = S * (0.08 + p.ring * 0.08 * (1 + Math.sin(t * 6)) / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, S * 0.006);
    ctx.strokeStyle = rgba(0.18 + p.ring * 0.45);
    ctx.stroke();
    // Reflejo del cristal.
    ctx.clip();
    const shine = ctx.createLinearGradient(vx, vy, vx + vw * 0.6, vy + vh);
    shine.addColorStop(0, 'rgba(255,255,255,0.06)');
    shine.addColorStop(0.45, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.restore();

    // Elementos luminosos.
    ctx.save();
    ctx.shadowColor = rgba(0.9);
    ctx.shadowBlur = S * 0.05;
    ctx.fillStyle = rgba(0.95);
    ctx.strokeStyle = rgba(0.95);
    ctx.lineCap = 'round';

    const eyeY = cy - S * 0.07 + S * breathe + p.gy * S * 0.035;
    const eyeDX = S * 0.19;
    const ew = S * 0.13, ehBase = S * 0.2;
    for (const side of [-1, 1]) {
      const ex = cx + side * eyeDX + p.gx * S * 0.05;
      const squint = side === 1 ? p.squint : p.squint * 0.2;
      const eh = Math.max(S * 0.012, ehBase * p.eyeH * p.open * (1 - squint * 0.55) * (1 - p.happy * 0.75));

      // Ojo «feliz» (arco) mezclado con el ojo normal.
      ctx.globalAlpha = 1 - p.happy;
      roundRect(ctx, ex - ew / 2, eyeY - eh / 2, ew, eh, Math.min(ew, eh) * 0.45);
      ctx.fill();
      if (p.happy > 0.02) {
        ctx.globalAlpha = p.happy;
        ctx.lineWidth = S * 0.035;
        ctx.beginPath();
        ctx.arc(ex, eyeY + S * 0.03, ew * 0.48, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Cejas.
      const browAlpha = clamp(Math.abs(p.browA) * 1.6 + Math.abs(p.browY) * 0.6, 0, 0.85);
      if (browAlpha > 0.05) {
        ctx.globalAlpha = browAlpha;
        ctx.lineWidth = S * 0.018;
        const by = eyeY - ehBase * 0.62 + p.browY * S * 0.04;
        const tilt = p.browA * S * 0.035 * side * -1;
        const lift = side === 1 && this.mood === 'curioso' ? -S * 0.03 : 0;
        ctx.beginPath();
        ctx.moveTo(ex - ew * 0.55, by + tilt + lift);
        ctx.lineTo(ex + ew * 0.55, by - tilt + lift);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Boca.
    const my = cy + S * 0.17 + S * breathe;
    const mx = cx + p.gx * S * 0.02 + p.skew * S * 0.03;
    const mw = S * 0.2 * p.mouthW * (1 - p.round * 0.3 + p.talk * 0.1);
    const open = S * (0.012 + p.talk * 0.1 + p.round * 0.06);
    const curve = p.smile * S * 0.06;
    const skewY = p.skew * S * 0.025;
    ctx.lineWidth = S * 0.022;
    ctx.beginPath();
    ctx.moveTo(mx - mw / 2, my + skewY);
    ctx.quadraticCurveTo(mx, my + curve - open * 0.35, mx + mw / 2, my - skewY);
    if (open > S * 0.02) {
      ctx.quadraticCurveTo(mx, my + curve + open, mx - mw / 2, my + skewY);
      ctx.closePath();
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.stroke();
    }

    // Pensando: tres puntos que orbitan.
    if (this.state === 'thinking' && !this.reduceMotion) {
      for (let i = 0; i < 3; i++) {
        const a = t * 2.4 + (i * Math.PI * 2) / 3;
        ctx.globalAlpha = 0.45 + 0.4 * Math.sin(a * 1.5 + i);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * S * 0.07, vy + S * 0.09 + Math.sin(a) * S * 0.025, S * 0.012, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Anillo de escucha.
    if (p.ring > 0.02) {
      ctx.save();
      const pulse = this.reduceMotion ? 0.5 : (Math.sin(t * 4) + 1) / 2;
      ctx.strokeStyle = rgba(p.ring * (0.15 + pulse * 0.25));
      ctx.lineWidth = S * 0.01;
      roundRect(ctx, vx - S * 0.035 - pulse * S * 0.015, vy - S * 0.035 - pulse * S * 0.015,
        vw + S * 0.07 + pulse * S * 0.03, vh + S * 0.07 + pulse * S * 0.03, S * 0.23);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
