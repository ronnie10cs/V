// Piezas compartidas por V conectada al ordenador (app.js) y V en la web (pagina.js):
// iconos, chat, voz, escucha, cámara, manos y cuaderno.

import { HandTracker } from './hands.js';

export const $ = (sel) => document.querySelector(sel);
export const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);

export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* modo privado */ } },
};

// ---------------------------------------------------------------------------
// Iconos y texto
// ---------------------------------------------------------------------------

const ICONS = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1.5-5.5-4L4 13a1.6 1.6 0 0 1 2.6-1.8L8 13"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c2.8.3 5 2.7 5 5.8"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  flip: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
  scale: '<path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
};

export function injectIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[el.dataset.icon] || ''}</svg>`);
  });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Markdown mínimo y seguro: negritas, cursivas, código y saltos de línea.
export function renderText(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

let toastTimer;
export function toast(text, ms = 2600) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

const TOOL_LABELS = {
  ver_pantalla: 'Mirando la pantalla', ver_camara: 'Mirando por la cámara', ver_manos: 'Observando tus manos',
  abrir_app: 'Abriendo', cerrar_app: 'Cerrando', apps_abiertas: 'Revisando las apps abiertas',
  abrir_url: 'Abriendo la web', clic: 'Haciendo clic', escribir_texto: 'Escribiendo', pulsar_teclas: 'Pulsando teclas',
  desplazar: 'Desplazando', ejecutar_comando: 'Terminal', calcular: 'Calculando', mostrar_enlace: 'Preparando un enlace',
  garmin_resumen: 'Leyendo tu Garmin', garmin_sueno: 'Leyendo tu sueño', garmin_corazon: 'Leyendo tu pulso',
  garmin_recuperacion: 'Leyendo tu recuperación', garmin_actividades: 'Leyendo tus actividades',
};
export const toolLabel = (name) => TOOL_LABELS[name] || (name.startsWith('cuaderno_') ? 'Cuaderno de hipótesis' : name);

export function gestureEmoji(g) {
  return { Thumb_Up: '👍', Thumb_Down: '👎', Open_Palm: '✋', Closed_Fist: '✊', Pointing_Up: '☝️', Victory: '✌️', ILoveYou: '🤟' }[g] || g;
}

export function autosize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

export function setStatus(text) { $('#status-text').textContent = text; }

let captionTimer;
export function showCaption(text) {
  const el = $('#caption');
  el.textContent = text.length > 240 ? text.slice(0, 237) + '…' : text;
  el.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => el.classList.remove('show'), Math.max(5000, text.length * 70));
}

export function showTool(msg) {
  const feed = $('#tool-feed');
  const pill = document.createElement('div');
  pill.className = `tool-pill ${msg.status}`;
  const mark = { start: '…', ok: '✓', error: '✕', denied: '⛔' }[msg.status] || '';
  pill.textContent = `${toolLabel(msg.name)} ${mark}`;
  if (msg.status === 'error' && msg.detail) pill.title = msg.detail;
  feed.appendChild(pill);
  while (feed.children.length > 4) feed.firstChild.remove();
  setTimeout(() => pill.remove(), 6000);
}

let wakeLock = null;
export async function toggleFocus() {
  const on = document.body.classList.toggle('focus');
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch { /* no disponible */ }
}

export function downloadText(filename, text, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Conversación
// ---------------------------------------------------------------------------

export class ChatLog {
  constructor(el) { this.el = el; }

  scroll() { this.el.scrollTop = this.el.scrollHeight; }
  clear() { this.el.innerHTML = ''; }

  add(e, myName) {
    const div = document.createElement('div');
    const mine = e.role !== 'v' && e.from === myName;
    div.className = `msg ${e.role === 'v' ? 'from-v' : mine ? 'mine' : 'other'}${e.error ? ' error' : ''}`;
    if (e.role !== 'v' && !mine) {
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = e.from + (e.role === 'guest' ? ' · invitado' : '');
      div.appendChild(who);
    }
    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = renderText(e.text);
    div.appendChild(body);
    if (e.tools?.length) {
      const tools = document.createElement('div');
      tools.className = 'used-tools';
      tools.textContent = [...new Set(e.tools.map(toolLabel))].join(' · ');
      div.appendChild(tools);
    }
    this.el.appendChild(div);
    this.scroll();
  }

  system(text) {
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = text;
    this.el.appendChild(div);
    this.scroll();
  }

  link(title, url) {
    const a = document.createElement('a');
    a.className = 'msg link-card';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const t = document.createElement('strong');
    t.textContent = title || url;
    const u = document.createElement('span');
    u.textContent = url;
    a.append(t, u);
    this.el.appendChild(a);
    this.scroll();
  }

  typing(on) {
    const existing = this.el.querySelector('#typing');
    if (!on) { existing?.remove(); return; }
    if (existing) return;
    const div = document.createElement('div');
    div.id = 'typing';
    div.className = 'msg from-v typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    this.el.appendChild(div);
    this.scroll();
  }
}

export function greeting(name) {
  const hour = new Date().getHours();
  const saludo = hour < 12 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  return `${saludo}, ${name}. Soy V. ¿Qué hipótesis vamos a poner a prueba hoy?`;
}

// ---------------------------------------------------------------------------
// Cuaderno de hipótesis
// ---------------------------------------------------------------------------

const STATE_LABELS = { propuesta: 'Propuesta', en_prueba: 'En prueba', apoyada: 'Apoyada', refutada: 'Refutada', descartada: 'Descartada' };

export function renderNotebook(list, items) {
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<p class="empty">Aún no hay hipótesis. Propón una teoría y V la registrará.</p>';
    return;
  }
  for (const h of [...items].reverse()) {
    const pro = h.evidence.filter((e) => e.kind === 'a_favor').length;
    const con = h.evidence.filter((e) => e.kind === 'en_contra').length;
    const conf = Math.max(0, Math.min(100, Number(h.confidence) || 0));
    const card = document.createElement('article');
    card.className = `hyp ${h.state}`;
    card.innerHTML = `
      <header><span class="hid"></span><span class="hstate"></span></header>
      <h3></h3><p class="stmt"></p>
      <div class="conf"><span style="width:${conf}%"></span></div>
      <footer><span>${conf}% de confianza</span><span>+${pro} / −${con} evidencias</span><span>${h.tests.length} pruebas</span></footer>
      <ul class="tests"></ul>`;
    card.querySelector('.hid').textContent = `${h.id} · ${h.author}`;
    card.querySelector('.hstate').textContent = STATE_LABELS[h.state] || h.state;
    card.querySelector('h3').textContent = h.title;
    card.querySelector('.stmt').textContent = h.statement;
    const ul = card.querySelector('.tests');
    h.tests.forEach((t, i) => {
      const li = document.createElement('li');
      li.textContent = `P${i + 1}: ${t.description} → ${t.result || 'pendiente'}`;
      ul.appendChild(li);
    });
    list.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Voz de V: audio (del servidor o de Gemini) con respaldo en la voz del navegador
// ---------------------------------------------------------------------------

// Medio segundo de silencio para desbloquear el audio en iOS.
function silentWav() {
  const samples = 4000;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

const PREFERRED_VOICES = /Jorge|Diego|Juan|Pablo|Álvaro|Alvaro|Google español|Mónica|Monica|Paulina|Dalia|Elvira/i;

export function spanishVoices() {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('es'));
}

export class Speaker {
  constructor({ lang, enabled, voiceName = () => null, onChange, onFinished }) {
    Object.assign(this, { lang, enabled, voiceName, onChange, onFinished });
    this.audio = new Audio();
    this.ctx = null;
    this.analyser = null;
    this.data = null;
    this.unlocked = false;
    this.speaking = false;
    ['pointerdown', 'keydown', 'touchend'].forEach((ev) =>
      window.addEventListener(ev, () => this.unlock(), { once: true, capture: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.ctx?.resume?.();
    });
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.audio.setAttribute('playsinline', '');
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      const src = this.ctx.createMediaElementSource(this.audio);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.data = new Uint8Array(this.analyser.fftSize);
      src.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.ctx.resume();
    } catch {
      this.ctx = null;
      this.analyser = null;
    }
    this.audio.src = silentWav();
    this.audio.play().catch(() => {});
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
  }

  // Volumen actual de la voz (0-1) para mover la boca; null si no se puede medir.
  level() {
    if (!this.analyser || this.audio.paused) return null;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (const v of this.data) { const d = (v - 128) / 128; sum += d * d; }
    return Math.sqrt(sum / this.data.length);
  }

  setSpeaking(on) {
    this.speaking = on;
    this.onChange?.(on);
  }

  async say(url, text) {
    this.stop();
    if (!this.enabled() || !text) return;
    this.setSpeaking(true);
    if (url) {
      try {
        if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume();
        this.audio.src = url;
        this.audio.onended = () => this.finished();
        this.audio.onerror = () => this.fallback(text);
        await this.audio.play();
        return;
      } catch {
        /* se usa la voz del navegador */
      }
    }
    this.fallback(text);
  }

  fallback(text) {
    if (!('speechSynthesis' in window)) { this.finished(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.lang();
    const voices = spanishVoices();
    const wanted = this.voiceName();
    u.voice = voices.find((v) => v.name === wanted) || voices.find((v) => PREFERRED_VOICES.test(v.name)) || voices[0] || null;
    u.onend = () => this.finished();
    u.onerror = () => this.finished();
    speechSynthesis.speak(u);
  }

  stop() {
    this.audio.pause();
    this.audio.onended = null;
    this.audio.onerror = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.speaking) this.setSpeaking(false);
  }

  finished() {
    this.setSpeaking(false);
    this.onFinished?.();
  }
}

// ---------------------------------------------------------------------------
// Escucha (reconocimiento de voz del navegador)
// ---------------------------------------------------------------------------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export class Listener {
  constructor({ lang, onText, onFinal, onChange }) {
    Object.assign(this, { lang, onText, onFinal, onChange });
    this.active = false;
    this.recognizer = null;
  }

  start() {
    if (!Recognition) {
      toast('Este navegador no reconoce voz. Prueba con Safari, Chrome o Edge.');
      return;
    }
    if (this.active) return;
    const rec = new Recognition();
    rec.lang = this.lang();
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.onText?.((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') toast('Permite el micrófono para hablar con V.');
    };
    rec.onend = () => {
      this.active = false;
      this.onChange?.(false);
      const text = finalText.trim();
      if (text) this.onFinal?.(text);
    };
    try {
      rec.start();
      this.recognizer = rec;
      this.active = true;
      this.onChange?.(true);
    } catch {
      this.active = false;
    }
  }

  stop() {
    try { this.recognizer?.stop(); } catch { /* ya parado */ }
  }

  toggle() { this.active ? this.stop() : this.start(); }
}

// ---------------------------------------------------------------------------
// Cámara y manos
// ---------------------------------------------------------------------------

export function frameFrom(video, maxSide = 1024) {
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

export class Camera {
  constructor(video, { onChange } = {}) {
    this.video = video;
    this.onChange = onChange;
    this.on = false;
    this.facing = store.get('v_facing', 'user');
    this.stream = null;
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      toast(window.isSecureContext
        ? 'No pude abrir la cámara: ' + (e.message || e.name)
        : 'La cámara necesita una dirección https:// (mira el README).', 4000);
      return false;
    }
    this.video.srcObject = this.stream;
    this.video.classList.toggle('mirror', this.facing === 'user');
    await this.video.play().catch(() => {});
    this.on = true;
    $('#pip').hidden = false;
    $('#cam-btn').classList.add('active');
    this.onChange?.(true);
    return true;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.on = false;
    $('#pip').hidden = true;
    $('#cam-btn').classList.remove('active');
    this.onChange?.(false);
  }

  async flip() {
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    store.set('v_facing', this.facing);
    if (this.on) {
      this.stop();
      await this.start();
    }
  }

  capture(maxSide = 1024) {
    if (!this.on) return null;
    const frame = frameFrom(this.video, maxSide);
    if (frame) {
      $('#pip').classList.add('flash');
      setTimeout(() => $('#pip').classList.remove('flash'), 300);
    }
    return frame;
  }
}

// Seguimiento de manos: mueve los ojos de V hacia la mano y avisa de cada gesto.
export class Hands {
  constructor({ face, camera, onUpdate, onGesture }) {
    this.face = face;
    this.camera = camera;
    this.on = false;
    this.latest = { hands: [] };
    this.history = [];
    this.tracker = new HandTracker(camera.video, $('#overlay'), {
      mirrored: () => camera.facing === 'user',
      onGesture: (g) => {
        this.history.push({ at: new Date().toLocaleTimeString(), gesto: g });
        this.history = this.history.slice(-20);
        onGesture?.(g);
      },
      onUpdate: (data, stopped) => {
        this.latest = data;
        onUpdate?.(data);
        const hand = data.hands?.[0];
        if (hand && !stopped) {
          face.lookAt((hand.x - 0.5) * -2, (hand.y - 0.5) * 2);
          $('#gesture-label').textContent = `${hand.fingers} dedos${hand.gesture !== 'None' ? ' · ' + gestureEmoji(hand.gesture) : ''}`;
        } else {
          face.clearLook();
          $('#gesture-label').textContent = stopped ? '' : 'Sin manos';
        }
      },
    });
  }

  async start() {
    if (!this.camera.on && !(await this.camera.start())) return false;
    toast('Cargando el seguimiento de manos…');
    try {
      await this.tracker.start();
    } catch (e) {
      toast('No pude cargar el seguimiento de manos: ' + (e.message || e), 4000);
      return false;
    }
    this.on = true;
    $('#hands-btn').classList.add('active');
    toast('Manos activas: 👍 autoriza · 👎 deniega · ✋ silencia · ✌️ habla', 4200);
    return true;
  }

  stop() {
    this.tracker.stop();
    this.on = false;
    $('#hands-btn').classList.remove('active');
    $('#gesture-label').textContent = '';
    this.face.clearLook();
  }
}
