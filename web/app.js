import { Face } from './face.js';
import { HandTracker } from './hands.js';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* modo privado */ } },
};

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
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}
document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Markdown mínimo y seguro: negritas, cursivas, código y saltos de línea.
function renderText(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

let toastTimer;
function toast(text, ms = 2600) {
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
  desplazar: 'Desplazando', ejecutar_comando: 'Terminal', calcular: 'Calculando',
  garmin_resumen: 'Leyendo tu Garmin', garmin_sueno: 'Leyendo tu sueño', garmin_corazon: 'Leyendo tu pulso',
  garmin_recuperacion: 'Leyendo tu recuperación', garmin_actividades: 'Leyendo tus actividades',
};
const toolLabel = (name) => TOOL_LABELS[name] || (name.startsWith('cuaderno_') ? 'Cuaderno de hipótesis' : name);

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
if (params.get('t')) {
  store.set('v_token', params.get('t'));
  history.replaceState(null, '', location.pathname);
}

const state = {
  token: store.get('v_token'),
  name: store.get('v_name', ''),
  role: null,
  owner: '',
  mode: 'asistente',
  ws: null,
  retry: 0,
  confirmId: null,
  confirmTimer: null,
  camera: false,
  facing: store.get('v_facing', 'user'),
  stream: null,
  hands: false,
  listening: false,
  speaking: false,
  prefs: {
    voice: store.get('v_voice', null),
    handsFree: store.get('v_handsfree', false),
  },
  guestToken: null,
};

const face = new Face($('#face'));
const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);

// Manifiesto con el token para que «Añadir a pantalla de inicio» funcione en iPhone.
function setManifest() {
  if (!state.token) return;
  let link = document.querySelector('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  link.href = `/manifest.webmanifest?t=${encodeURIComponent(state.token)}`;
}

// ---------------------------------------------------------------------------
// Voz de V (audio del servidor con respaldo en la voz del navegador)
// ---------------------------------------------------------------------------

const speaker = {
  audio: new Audio(),
  ctx: null,
  analyser: null,
  data: null,
  unlocked: false,

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
    // Un sonido vacío dentro del gesto del usuario desbloquea el audio en iOS.
    this.audio.src = silentWav();
    this.audio.play().catch(() => {});
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
  },

  level() {
    if (!this.analyser || this.audio.paused) return null;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (const v of this.data) { const d = (v - 128) / 128; sum += d * d; }
    return Math.sqrt(sum / this.data.length);
  },

  async say(url, text) {
    this.stop();
    if (!voiceEnabled() || !text) return;
    setSpeaking(true);
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
  },

  fallback(text) {
    if (!('speechSynthesis' in window)) { this.finished(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = state.lang || 'es-MX';
    const voices = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('es'));
    u.voice = voices.find((v) => /Jorge|Diego|Juan|Pablo|Google español|Mónica|Paulina/i.test(v.name)) || voices[0] || null;
    u.rate = 1.0;
    u.onend = () => this.finished();
    u.onerror = () => this.finished();
    speechSynthesis.speak(u);
  },

  stop() {
    this.audio.pause();
    this.audio.onended = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (state.speaking) setSpeaking(false);
  },

  finished() {
    setSpeaking(false);
    if (state.prefs.handsFree && !state.listening) setTimeout(() => startListening(), 350);
  },
};
face.setLevel(() => speaker.level());
['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, () => speaker.unlock(), { once: true, capture: true }));

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

function voiceEnabled() {
  return state.prefs.voice ?? state.role !== 'guest';
}

function setSpeaking(on) {
  state.speaking = on;
  $('#stop-btn').hidden = !on;
  refreshFace();
}

// ---------------------------------------------------------------------------
// Escucha (reconocimiento de voz del navegador)
// ---------------------------------------------------------------------------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;

function startListening() {
  if (!Recognition) {
    toast('Este navegador no reconoce voz. Prueba con Safari o Chrome.');
    return;
  }
  if (state.listening) return;
  speaker.stop();
  recognizer = new Recognition();
  recognizer.lang = state.lang || 'es-MX';
  recognizer.interimResults = true;
  recognizer.continuous = false;
  let finalText = '';
  recognizer.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    $('#input').value = (finalText + interim).trim();
    autosize();
  };
  recognizer.onerror = (e) => {
    if (e.error === 'not-allowed') toast('Permite el micrófono para hablar con V.');
  };
  recognizer.onend = () => {
    state.listening = false;
    $('#mic-btn').classList.remove('active');
    refreshFace();
    const text = finalText.trim();
    if (text) {
      $('#input').value = '';
      autosize();
      sendMessage(text);
    }
  };
  try {
    recognizer.start();
    state.listening = true;
    $('#mic-btn').classList.add('active');
    refreshFace();
  } catch {
    state.listening = false;
  }
}

function stopListening() {
  try { recognizer?.stop(); } catch { /* ya parado */ }
}

// ---------------------------------------------------------------------------
// Cámara y manos
// ---------------------------------------------------------------------------

const video = $('#video');
const tracker = new HandTracker(video, $('#overlay'), {
  mirrored: () => state.facing === 'user',
  onUpdate: (data, stopped) => {
    send({ type: 'hands', ...data });
    const hand = data.hands?.[0];
    if (hand && !stopped) {
      face.lookAt((hand.x - 0.5) * -2, (hand.y - 0.5) * 2);
      $('#gesture-label').textContent = `${hand.fingers} dedos${hand.gesture !== 'None' ? ' · ' + gestureEmoji(hand.gesture) : ''}`;
    } else {
      face.clearLook();
      $('#gesture-label').textContent = stopped ? '' : 'Sin manos';
    }
  },
  onGesture: onGesture,
});

function gestureEmoji(g) {
  return { Thumb_Up: '👍', Thumb_Down: '👎', Open_Palm: '✋', Closed_Fist: '✊', Pointing_Up: '☝️', Victory: '✌️', ILoveYou: '🤟' }[g] || g;
}

function onGesture(g) {
  if (g === 'Thumb_Up' && state.confirmId) { answerConfirm(true); toast('👍 Autorizado'); }
  else if (g === 'Thumb_Down' && state.confirmId) { answerConfirm(false); toast('👎 Denegado'); }
  else if (g === 'Open_Palm' && state.speaking) { speaker.stop(); toast('✋ Silencio'); }
  else if (g === 'Victory' && !state.listening && state.role === 'owner') { toast('✌️ Te escucho'); startListening(); }
}

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (e) {
    toast(location.protocol === 'https:' || location.hostname === 'localhost'
      ? 'No pude abrir la cámara: ' + (e.message || e.name)
      : 'La cámara necesita HTTPS (mira el README).', 4000);
    return false;
  }
  video.srcObject = state.stream;
  video.classList.toggle('mirror', state.facing === 'user');
  await video.play().catch(() => {});
  state.camera = true;
  $('#pip').hidden = false;
  $('#cam-btn').classList.add('active');
  sendStatus();
  return true;
}

function stopCamera() {
  if (state.hands) stopHands();
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  state.camera = false;
  $('#pip').hidden = true;
  $('#cam-btn').classList.remove('active');
  sendStatus();
}

async function flipCamera() {
  state.facing = state.facing === 'user' ? 'environment' : 'user';
  store.set('v_facing', state.facing);
  if (state.camera) {
    const hadHands = state.hands;
    stopCamera();
    await startCamera();
    if (hadHands) startHands();
  }
}

async function startHands() {
  if (!state.camera && !(await startCamera())) return;
  toast('Cargando el seguimiento de manos…');
  try {
    await tracker.start();
  } catch (e) {
    toast('No pude cargar el seguimiento de manos: ' + (e.message || e), 4000);
    return;
  }
  state.hands = true;
  $('#hands-btn').classList.add('active');
  toast('Manos activas: 👍 autoriza · 👎 deniega · ✋ silencia · ✌️ habla', 4200);
  sendStatus();
}

function stopHands() {
  tracker.stop();
  state.hands = false;
  $('#hands-btn').classList.remove('active');
  $('#gesture-label').textContent = '';
  face.clearLook();
  sendStatus();
}

function captureFrame(maxSide = 1024) {
  if (!state.camera || video.readyState < 2) return null;
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  $('#pip').classList.add('flash');
  setTimeout(() => $('#pip').classList.remove('flash'), 300);
  return c.toDataURL('image/jpeg', 0.82);
}

// ---------------------------------------------------------------------------
// Conexión con el servidor
// ---------------------------------------------------------------------------

let reconnectTimer = null;
function connect() {
  clearTimeout(reconnectTimer);
  if (state.ws && state.ws.readyState <= WebSocket.OPEN) return;
  if (!state.token) { showLogin(); return; }
  setManifest();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = new URLSearchParams({ t: state.token });
  if (state.name) q.set('nombre', state.name);
  const ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
  state.ws = ws;
  setStatus('Conectando…');
  ws.onopen = () => { state.retry = 0; };
  ws.onmessage = (e) => {
    if (state.ws !== ws) return;
    try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); }
  };
  ws.onclose = (e) => {
    if (state.ws !== ws) return;
    state.ws = null;
    face.setState('offline');
    if (e.code === 4401) {
      store.del('v_token');
      state.token = null;
      showLogin('Ese enlace no es válido.');
      return;
    }
    const delay = Math.min(15000, 1000 * 2 ** state.retry++);
    setStatus('Reconectando…');
    reconnectTimer = setTimeout(connect, delay);
  };
}

function send(msg) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function sendStatus() {
  send({ type: 'status', camera: state.camera, hands: state.hands, device: isMobile ? 'móvil' : 'ordenador' });
}

function handle(msg) {
  switch (msg.type) {
    case 'welcome': {
      state.role = msg.role;
      state.owner = msg.owner;
      state.lang = msg.lang;
      state.name = msg.name;
      state.guestToken = msg.guest_token || null;
      document.body.classList.toggle('guest', msg.role === 'guest');
      $('#log').innerHTML = '';
      msg.transcript.forEach(addEntry);
      setMode(msg.mode);
      $('#provider-info').textContent = msg.provider;
      $('#name-input').value = msg.name;
      $('#voice-toggle').checked = voiceEnabled();
      if (msg.config_error) addSystem('⚠️ ' + msg.config_error);
      state.remoteState = msg.busy ? 'thinking' : 'idle';
      refreshFace();
      setStatus(msg.busy ? 'Pensando…' : 'En línea');
      if (msg.role === 'guest' && !store.get('v_name')) openDrawer('#settings');
      sendStatus();
      if (!msg.transcript.length) greet();
      break;
    }
    case 'participants':
      renderParticipants(msg.participants);
      break;
    case 'chat':
      addEntry(msg);
      break;
    case 'reply':
      removeTyping();
      addEntry(msg);
      face.setMood(msg.mood || 'neutral');
      showCaption(msg.speech || msg.text);
      speaker.say(msg.audio, msg.speech || msg.text);
      break;
    case 'state':
      if (msg.state === 'thinking') { showTyping(); setStatus('Pensando…'); }
      if (msg.state === 'idle') { removeTyping(); setStatus('En línea'); }
      state.remoteState = msg.state;
      refreshFace();
      break;
    case 'tool':
      showTool(msg);
      break;
    case 'confirm_request':
      openConfirm(msg);
      break;
    case 'confirm_closed':
      closeConfirm();
      break;
    case 'frame_request':
      send({ type: 'frame_response', id: msg.id, image: captureFrame() });
      break;
    case 'mode':
      setMode(msg.mode);
      addSystem(msg.mode === 'debate' ? 'Modo debate activado: V modera y escucha.' : 'Modo asistente activado.');
      break;
    case 'reset':
      $('#log').innerHTML = '';
      addSystem('Conversación reiniciada.');
      break;
    case 'notebook':
      if (!$('#notebook').hidden) loadNotebook();
      else $('#notebook-btn').classList.add('badge');
      break;
    case 'error':
      removeTyping();
      addSystem('⚠️ ' + msg.text);
      refreshFace();
      break;
  }
}

function refreshFace() {
  if (!state.ws) return face.setState('offline');
  if (state.confirmId) return face.setState('confirm');
  if (state.listening) return face.setState('listening');
  if (state.speaking) return face.setState('speaking');
  if (state.remoteState === 'thinking') return face.setState('thinking');
  face.setState('idle');
}

function greet() {
  const hour = new Date().getHours();
  const saludo = hour < 12 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  addEntry({ from: 'V', role: 'v', text: `${saludo}, ${state.name}. Soy V. ¿Qué hipótesis vamos a poner a prueba hoy?`, mood: 'feliz' });
  face.setMood('feliz', 4000);
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function sendMessage(text, { ask = false } = {}) {
  text = text.trim();
  if (!text) return;
  if (!state.ws) { toast('Sin conexión con V.'); return; }
  send({ type: 'message', text, ask });
}

function addEntry(e) {
  const log = $('#log');
  const div = document.createElement('div');
  const mine = e.role !== 'v' && e.from === state.name;
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
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function addSystem(text) {
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = text;
  $('#log').appendChild(div);
  $('#log').scrollTop = $('#log').scrollHeight;
}

function showTyping() {
  if ($('#typing')) return;
  const div = document.createElement('div');
  div.id = 'typing';
  div.className = 'msg from-v typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  $('#log').appendChild(div);
  $('#log').scrollTop = $('#log').scrollHeight;
}
function removeTyping() { $('#typing')?.remove(); }

function showTool(msg) {
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

let captionTimer;
function showCaption(text) {
  const el = $('#caption');
  el.textContent = text.length > 240 ? text.slice(0, 237) + '…' : text;
  el.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => el.classList.remove('show'), Math.max(5000, text.length * 70));
}

function setStatus(text) { $('#status-text').textContent = text; }

function setMode(mode) {
  state.mode = mode;
  document.body.classList.toggle('debate', mode === 'debate');
  $('#mode-btn').textContent = mode === 'debate' ? 'Debate' : 'Asistente';
  $('#input').placeholder = mode === 'debate'
    ? 'Tu argumento… (di «V» o pulsa ⚖️ para que opine)'
    : 'Habla o escribe a V…';
}

function renderParticipants(list) {
  $('#people-count').textContent = list.length;
  const ul = $('#people-list');
  ul.innerHTML = '';
  for (const p of list) {
    const li = document.createElement('li');
    const flags = [p.device, p.camera ? '📷' : '', p.hands ? '✋' : ''].filter(Boolean).join(' ');
    li.innerHTML = `<span class="pname"></span><span class="prole ${p.role}">${p.role === 'owner' ? 'dueño' : 'invitado'}</span><span class="pflags"></span>`;
    li.querySelector('.pname').textContent = p.name;
    li.querySelector('.pflags').textContent = flags;
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Confirmaciones
// ---------------------------------------------------------------------------

function openConfirm(msg) {
  state.confirmId = msg.id;
  $('#confirm-summary').textContent = msg.summary;
  $('#confirm-by').textContent = msg.requested_by ? `Lo pide ${msg.requested_by}` : '';
  $('#confirm').hidden = false;
  const bar = $('#confirm-bar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  requestAnimationFrame(() => { bar.style.transition = 'width 60s linear'; bar.style.width = '0%'; });
  clearTimeout(state.confirmTimer);
  state.confirmTimer = setTimeout(closeConfirm, 60000);
  refreshFace();
  if (navigator.vibrate) navigator.vibrate(80);
}

function answerConfirm(approved) {
  if (!state.confirmId) return;
  send({ type: 'confirm_response', id: state.confirmId, approved });
  closeConfirm();
}

function closeConfirm() {
  state.confirmId = null;
  clearTimeout(state.confirmTimer);
  $('#confirm').hidden = true;
  refreshFace();
}

// ---------------------------------------------------------------------------
// Cuaderno de hipótesis
// ---------------------------------------------------------------------------

const STATE_LABELS = { propuesta: 'Propuesta', en_prueba: 'En prueba', apoyada: 'Apoyada', refutada: 'Refutada', descartada: 'Descartada' };

async function loadNotebook() {
  $('#notebook-btn').classList.remove('badge');
  const list = $('#notebook-list');
  try {
    const res = await fetch('/api/cuaderno', { headers: { Authorization: `Bearer ${state.token}` } });
    if (!res.ok) throw new Error(res.status);
    const items = await res.json();
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<p class="empty">Aún no hay hipótesis. Propón una teoría y V la registrará.</p>';
      return;
    }
    for (const h of items.reverse()) {
      const pro = h.evidence.filter((e) => e.kind === 'a_favor').length;
      const con = h.evidence.filter((e) => e.kind === 'en_contra').length;
      const card = document.createElement('article');
      card.className = `hyp ${h.state}`;
      card.innerHTML = `
        <header><span class="hid"></span><span class="hstate"></span></header>
        <h3></h3><p class="stmt"></p>
        <div class="conf"><span style="width:${h.confidence}%"></span></div>
        <footer><span>${h.confidence}% de confianza</span><span>+${pro} / −${con} evidencias</span><span>${h.tests.length} pruebas</span></footer>
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
  } catch {
    list.innerHTML = '<p class="empty">No pude cargar el cuaderno.</p>';
  }
}

// ---------------------------------------------------------------------------
// Paneles, ajustes y acceso
// ---------------------------------------------------------------------------

function openDrawer(sel) {
  document.querySelectorAll('.drawer').forEach((d) => { if ('#' + d.id !== sel) d.hidden = true; });
  const el = $(sel);
  el.hidden = !el.hidden;
  if (!el.hidden && sel === '#notebook') loadNotebook();
  if (!el.hidden && sel === '#people') renderGuestLink();
}

function renderGuestLink() {
  const box = $('#guest-link-box');
  if (!state.guestToken) { box.hidden = true; return; }
  box.hidden = false;
  $('#guest-link').value = `${location.origin}/?t=${state.guestToken}`;
}

function showLogin(message = '') {
  $('#login-error').textContent = message;
  $('#login').hidden = false;
  $('#login-name').value = state.name || '';
}

function autosize() {
  const el = $('#input');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

let wakeLock = null;
async function toggleFocus() {
  const on = document.body.classList.toggle('focus');
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch { /* no disponible */ }
}

// Eventos de la interfaz.
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#input').value;
  $('#input').value = '';
  autosize();
  sendMessage(text);
});
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
$('#input').addEventListener('input', autosize);
$('#ask-btn').addEventListener('click', () => {
  const text = $('#input').value.trim() || 'V, ¿qué conclusiones sacas del debate hasta ahora? ¿Qué hipótesis propondrías?';
  $('#input').value = '';
  autosize();
  sendMessage(text, { ask: true });
});
$('#mic-btn').addEventListener('click', () => (state.listening ? stopListening() : startListening()));
$('#stop-btn').addEventListener('click', () => speaker.stop());
$('#cam-btn').addEventListener('click', () => (state.camera ? stopCamera() : startCamera()));
$('#hands-btn').addEventListener('click', () => (state.hands ? stopHands() : startHands()));
$('#flip-btn').addEventListener('click', flipCamera);
$('#focus-btn').addEventListener('click', toggleFocus);
$('#face').addEventListener('click', () => {
  if (document.body.classList.contains('focus')) state.listening ? stopListening() : startListening();
});
$('#mode-btn').addEventListener('click', () => {
  if (state.role !== 'owner') { toast('Solo el dueño cambia el modo.'); return; }
  send({ type: 'set_mode', mode: state.mode === 'debate' ? 'asistente' : 'debate' });
});
$('#notebook-btn').addEventListener('click', () => openDrawer('#notebook'));
$('#settings-btn').addEventListener('click', () => openDrawer('#settings'));
$('#people-btn').addEventListener('click', () => openDrawer('#people'));
document.querySelectorAll('.drawer .close').forEach((b) => b.addEventListener('click', () => { b.closest('.drawer').hidden = true; }));
$('#confirm-yes').addEventListener('click', () => answerConfirm(true));
$('#confirm-no').addEventListener('click', () => answerConfirm(false));

$('#name-input').addEventListener('change', (e) => {
  const name = e.target.value.trim().slice(0, 24);
  if (!name) return;
  state.name = name;
  store.set('v_name', name);
  send({ type: 'status', name });
  toast('Nombre guardado');
});
$('#voice-toggle').addEventListener('change', (e) => {
  state.prefs.voice = e.target.checked;
  store.set('v_voice', e.target.checked);
  if (!e.target.checked) speaker.stop();
});
$('#handsfree-toggle').checked = state.prefs.handsFree;
$('#handsfree-toggle').addEventListener('change', (e) => {
  state.prefs.handsFree = e.target.checked;
  store.set('v_handsfree', e.target.checked);
});
$('#reset-btn').addEventListener('click', () => {
  if (confirm('¿Reiniciar la conversación? El cuaderno de hipótesis se conserva.')) send({ type: 'reset' });
});
$('#logout-btn').addEventListener('click', () => {
  store.del('v_token');
  location.reload();
});
$('#copy-guest').addEventListener('click', async () => {
  const url = $('#guest-link').value;
  if (navigator.share && isMobile) {
    try { await navigator.share({ title: 'Debate con V', url }); return; } catch { /* cancelado */ }
  }
  try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { $('#guest-link').select(); }
});
$('#export-md').addEventListener('click', async () => {
  const res = await fetch('/api/cuaderno.md', { headers: { Authorization: `Bearer ${state.token}` } });
  if (!res.ok) return toast('No pude exportar el cuaderno.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cuaderno-v.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  let token = $('#login-token').value.trim();
  const m = token.match(/[?&]t=([^&#\s]+)/);
  if (m) token = decodeURIComponent(m[1]);
  const name = $('#login-name').value.trim().slice(0, 24);
  if (!token) return;
  store.set('v_token', token);
  if (name) store.set('v_name', name);
  state.token = token;
  state.name = name || state.name;
  $('#login').hidden = true;
  connect();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    speaker.ctx?.resume?.();
    if (!state.ws) connect();
  }
});
setInterval(() => send({ type: 'ping' }), 25000);

connect();
