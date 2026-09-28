// V conectada a tu ordenador: habla con el servidor de V (python -m v) por WebSocket.

import { Face } from './face.js';
import {
  $, Camera, ChatLog, Hands, Listener, Speaker, autosize, downloadText, greeting, injectIcons,
  isMobile, renderNotebook, setStatus, showCaption, showTool, store, toast, toggleFocus,
} from './common.js';

injectIcons();

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
  lang: 'es-MX',
  mode: 'asistente',
  ws: null,
  retry: 0,
  remoteState: 'idle',
  confirmId: null,
  confirmTimer: null,
  prefs: {
    voice: store.get('v_voice', null),
    handsFree: store.get('v_handsfree', false),
  },
  guestToken: null,
};

const face = new Face($('#face'));
const log = new ChatLog($('#log'));
const voiceEnabled = () => state.prefs.voice ?? state.role !== 'guest';

const speaker = new Speaker({
  lang: () => state.lang,
  enabled: voiceEnabled,
  onChange: (on) => { $('#stop-btn').hidden = !on; refreshFace(); },
  onFinished: () => {
    if (state.prefs.handsFree && !listener.active) setTimeout(() => listener.start(), 350);
  },
});
face.setLevel(() => speaker.level());

const listener = new Listener({
  lang: () => state.lang,
  onText: (text) => { $('#input').value = text; autosize($('#input')); },
  onFinal: (text) => { $('#input').value = ''; autosize($('#input')); sendMessage(text); },
  onChange: (on) => {
    if (on) speaker.stop();
    $('#mic-btn').classList.toggle('active', on);
    refreshFace();
  },
});

const camera = new Camera($('#video'), { onChange: () => sendStatus() });
const hands = new Hands({
  face,
  camera,
  onUpdate: (data) => send({ type: 'hands', ...data }),
  onGesture: (g) => {
    if (g === 'Thumb_Up' && state.confirmId) { answerConfirm(true); toast('👍 Autorizado'); }
    else if (g === 'Thumb_Down' && state.confirmId) { answerConfirm(false); toast('👎 Denegado'); }
    else if (g === 'Open_Palm' && speaker.speaking) { speaker.stop(); toast('✋ Silencio'); }
    else if (g === 'Victory' && !listener.active && state.role === 'owner') { toast('✌️ Te escucho'); listener.start(); }
  },
});

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
  send({ type: 'status', camera: camera.on, hands: hands.on, device: isMobile ? 'móvil' : 'ordenador' });
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
      log.clear();
      msg.transcript.forEach((e) => log.add(e, state.name));
      setMode(msg.mode);
      $('#provider-info').textContent = msg.provider;
      $('#name-input').value = msg.name;
      $('#voice-toggle').checked = voiceEnabled();
      if (msg.config_error) log.system('⚠️ ' + msg.config_error);
      state.remoteState = msg.busy ? 'thinking' : 'idle';
      refreshFace();
      setStatus(msg.busy ? 'Pensando…' : 'En línea');
      if (msg.role === 'guest' && !store.get('v_name')) openDrawer('#settings');
      sendStatus();
      if (!msg.transcript.length) {
        log.add({ from: 'V', role: 'v', text: greeting(state.name) }, state.name);
        face.setMood('feliz', 4000);
      }
      break;
    }
    case 'participants':
      renderParticipants(msg.participants);
      break;
    case 'chat':
      log.add(msg, state.name);
      break;
    case 'reply':
      log.typing(false);
      log.add(msg, state.name);
      face.setMood(msg.mood || 'neutral');
      showCaption(msg.speech || msg.text);
      speaker.say(msg.audio, msg.speech || msg.text);
      break;
    case 'state':
      if (msg.state === 'thinking') { log.typing(true); setStatus('Pensando…'); }
      if (msg.state === 'idle') { log.typing(false); setStatus('En línea'); }
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
      send({ type: 'frame_response', id: msg.id, image: camera.capture() });
      break;
    case 'mode':
      setMode(msg.mode);
      log.system(msg.mode === 'debate' ? 'Modo debate activado: V modera y escucha.' : 'Modo asistente activado.');
      break;
    case 'reset':
      log.clear();
      log.system('Conversación reiniciada.');
      break;
    case 'notebook':
      if (!$('#notebook').hidden) loadNotebook();
      else $('#notebook-btn').classList.add('badge');
      break;
    case 'error':
      log.typing(false);
      log.system('⚠️ ' + msg.text);
      refreshFace();
      break;
  }
}

function refreshFace() {
  if (!state.ws) return face.setState('offline');
  if (state.confirmId) return face.setState('confirm');
  if (listener.active) return face.setState('listening');
  if (speaker.speaking) return face.setState('speaking');
  if (state.remoteState === 'thinking') return face.setState('thinking');
  face.setState('idle');
}

function sendMessage(text, { ask = false } = {}) {
  text = text.trim();
  if (!text) return;
  if (!state.ws) { toast('Sin conexión con V.'); return; }
  send({ type: 'message', text, ask });
}

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
// Cuaderno, paneles y acceso
// ---------------------------------------------------------------------------

async function loadNotebook() {
  $('#notebook-btn').classList.remove('badge');
  try {
    const res = await fetch('/api/cuaderno', { headers: { Authorization: `Bearer ${state.token}` } });
    if (!res.ok) throw new Error(res.status);
    renderNotebook($('#notebook-list'), await res.json());
  } catch {
    $('#notebook-list').innerHTML = '<p class="empty">No pude cargar el cuaderno.</p>';
  }
}

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

// Eventos de la interfaz.
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#input').value;
  $('#input').value = '';
  autosize($('#input'));
  sendMessage(text);
});
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
$('#input').addEventListener('input', () => autosize($('#input')));
$('#ask-btn').addEventListener('click', () => {
  const text = $('#input').value.trim() || 'V, ¿qué conclusiones sacas del debate hasta ahora? ¿Qué hipótesis propondrías?';
  $('#input').value = '';
  autosize($('#input'));
  sendMessage(text, { ask: true });
});
$('#mic-btn').addEventListener('click', () => listener.toggle());
$('#stop-btn').addEventListener('click', () => speaker.stop());
$('#cam-btn').addEventListener('click', () => {
  if (camera.on) { if (hands.on) hands.stop(); camera.stop(); } else camera.start();
});
$('#hands-btn').addEventListener('click', async () => {
  if (hands.on) hands.stop(); else await hands.start();
  sendStatus();
});
$('#flip-btn').addEventListener('click', () => camera.flip());
$('#focus-btn').addEventListener('click', toggleFocus);
$('#face').addEventListener('click', () => {
  if (document.body.classList.contains('focus')) listener.toggle();
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
  downloadText('cuaderno-v.md', await res.text());
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
  if (document.visibilityState === 'visible' && !state.ws) connect();
});
setInterval(() => send({ type: 'ping' }), 25000);

connect();
