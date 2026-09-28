// Seguimiento de manos y gestos en el propio dispositivo con MediaPipe.
// Nada de vídeo sale del dispositivo: solo un resumen (gesto, dedos, posición).

const VERSION = '1.0.1';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]]; // punta, articulación media
const HOLD_MS = 550;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function countFingers(lm) {
  let n = 0;
  for (const [tip, pip] of FINGERS) if (dist(lm[0], lm[tip]) > dist(lm[0], lm[pip]) * 1.12) n++;
  if (dist(lm[4], lm[17]) > dist(lm[3], lm[17]) * 1.08 && dist(lm[4], lm[5]) > dist(lm[0], lm[5]) * 0.35) n++;
  return n;
}

export class HandTracker {
  constructor(video, overlay, { onUpdate, onGesture, mirrored }) {
    this.video = video;
    this.overlay = overlay;
    this.onUpdate = onUpdate;
    this.onGesture = onGesture;
    this.mirrored = mirrored; // función: ¿la vista previa está en espejo (cámara frontal)?
    this.running = false;
    this.lastRun = 0;
    this.lastSent = 0;
    this.lastSummary = '';
    this.prev = new Map();
    this.candidate = { name: 'None', since: 0, fired: false };
  }

  async start() {
    if (!this.recognizer) {
      const vision = await import(`${CDN}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      try {
        this.recognizer = await vision.GestureRecognizer.createFromOptions(fileset, options('GPU'));
      } catch {
        this.recognizer = await vision.GestureRecognizer.createFromOptions(fileset, options('CPU'));
      }
    }
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.tick();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    const ctx = this.overlay.getContext('2d');
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.onUpdate?.({ hands: [] }, true);
  }

  tick() {
    const now = performance.now();
    if (now - this.lastRun < 60 || this.video.readyState < 2) return;
    this.lastRun = now;
    let result;
    try {
      result = this.recognizer.recognizeForVideo(this.video, now);
    } catch {
      return;
    }
    const mirrored = this.mirrored();
    const hands = (result.landmarks || []).map((lm, i) => {
      const cat = result.gestures?.[i]?.[0];
      let side = result.handedness?.[i]?.[0]?.categoryName || '?';
      // MediaPipe asume imagen en espejo; con la cámara frontal sin espejo se invierte.
      if (mirrored) side = side === 'Left' ? 'Right' : side === 'Right' ? 'Left' : side;
      const center = lm[9];
      const x = mirrored ? 1 - center.x : center.x;
      const key = side;
      const before = this.prev.get(key);
      let speed = 0;
      if (before) speed = Math.hypot(x - before.x, center.y - before.y) / ((now - before.t) / 1000);
      this.prev.set(key, { x, y: center.y, t: now });
      return {
        gesture: cat && cat.score > 0.55 ? cat.categoryName : 'None',
        handedness: side === 'Left' ? 'izquierda' : side === 'Right' ? 'derecha' : side,
        fingers: countFingers(lm),
        x: +x.toFixed(3),
        y: +center.y.toFixed(3),
        speed: +speed.toFixed(2),
        landmarks: lm,
      };
    });

    this.draw(hands, mirrored);
    this.detectGesture(hands, now);

    const summary = hands.map((h) => `${h.handedness}:${h.gesture}:${h.fingers}`).join('|');
    if (summary !== this.lastSummary || now - this.lastSent > 1000) {
      this.lastSummary = summary;
      this.lastSent = now;
      this.onUpdate?.({ hands: hands.map(({ landmarks, ...rest }) => rest) });
    }
  }

  detectGesture(hands, now) {
    const name = hands.find((h) => h.gesture !== 'None')?.gesture || 'None';
    const c = this.candidate;
    if (name !== c.name) {
      this.candidate = { name, since: now, fired: false };
      return;
    }
    if (!c.fired && name !== 'None' && now - c.since > HOLD_MS) {
      c.fired = true;
      this.onGesture?.(name);
    }
  }

  draw(hands, mirrored) {
    const { overlay, video } = this;
    const w = (overlay.width = video.videoWidth || overlay.clientWidth);
    const h = (overlay.height = video.videoHeight || overlay.clientHeight);
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = Math.max(2, w / 220);
    ctx.strokeStyle = 'rgba(94,231,255,0.85)';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (const hand of hands) {
      const pt = (p) => [(mirrored ? 1 - p.x : p.x) * w, p.y * h];
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(...pt(hand.landmarks[a]));
        ctx.lineTo(...pt(hand.landmarks[b]));
      }
      ctx.stroke();
      for (const p of hand.landmarks) {
        const [x, y] = pt(p);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, w / 180), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
