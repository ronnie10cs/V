// V en la web: funciona solo en el navegador, sin instalar nada. Piensa con
// Gemini usando la clave gratuita de quien la abre.

import { Face } from './face.js';
import {
  $, Camera, ChatLog, Hands, Listener, Speaker, autosize, downloadText, frameFrom, greeting, injectIcons,
  isMobile, renderNotebook, setStatus, showCaption, showTool, spanishVoices, store, toast, toggleFocus,
} from './common.js';
import { Brain, addressedToV, speakable, systemPrompt } from './cerebro.js';
import { Notebook } from './cuaderno.js';
import { DEFAULT_MODEL, TTS_VOICES, generate, speak } from './gemini.js';
import { calcTool, linkTool, notebookTools, senseTools } from './herramientas.js';

injectIcons();

const MODELS = {
  'gemini-3.8-flash': 'Gemini 3.8 Flash · el más capaz gratis',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite · más rápido, con más cuota',
};

const prefs = {
  key: store.get('vweb_key', ''),
  name: store.get('v_name', ''),
  model: store.get('vweb_model', DEFAULT_MODEL),
  voice: store.get('vweb_voice', 'gemini:Charon'),
  voiceOn: store.get('v_voice', true),
  handsFree: store.get('v_handsfree', false),
  people: store.get('vweb_people', []),
};

const state = {
  mode: store.get('vweb_mode', 'asistente'),
  speaker: '',
  thinking: false,
  queue: Promise.resolve(),
  ttsFailed: false,
  audioUrl: null,
  screen: null,
  personality: null,
};

const lang = () => (navigator.language?.toLowerCase().startsWith('es') ? navigator.language : 'es-MX');
const myName = () => prefs.name || 'Investigador';
const participants = () => [myName(), ...prefs.people];

const face = new Face($('#face'));
const log = new ChatLog($('#log'));

const speaker = new Speaker({
  lang,
  enabled: () => prefs.voiceOn,
  voiceName: () => (prefs.voice.startsWith('nav:') ? prefs.voice.slice(4) : null),
  onChange: (on) => { $('#stop-btn').hidden = !on; refreshFace(); },
  onFinished: () => {
    if (prefs.handsFree && !listener.active) setTimeout(() => listener.start(), 350);
  },
});
face.setLevel(() => speaker.level());

const listener = new Listener({
  lang,
  onText: (text) => { $('#input').value = text; autosize($('#input')); },
  onFinal: (text) => { $('#input').value = ''; autosize($('#input')); submit(text); },
  onChange: (on) => {
    if (on) speaker.stop();
    $('#mic-btn').classList.toggle('active', on);
    refreshFace();
  },
});

const camera = new Camera($('#video'));
const hands = new Hands({
  face,
  camera,
  onGesture: (g) => {
    if (g === 'Open_Palm' && speaker.speaking) { speaker.stop(); toast('✋ Silencio'); }
    else if (g === 'Victory' && !listener.active) { toast('✌️ Te escucho'); listener.start(); }
  },
});

const notebook = new Notebook({
  load: () => store.get('vweb_cuaderno'),
  save: (data) => store.set('vweb_cuaderno', data),
});

const brain = new Brain({
  generate,
  tools: [
    ...senseTools({
      cameraFrame: () => camera.capture(),
      hands: () => hands,
      screenFrame: () => (state.screen ? frameFrom($('#screen-video'), 1280) : null),
    }),
    ...notebookTools(notebook, () => {
      if (!$('#notebook').hidden) renderNotebook($('#notebook-list'), notebook.all());
      else $('#notebook-btn').classList.add('badge');
    }),
    calcTool,
    linkTool((title, url) => log.link(title, url)),
  ],
});

// ---------------------------------------------------------------------------
// Conversación
// ---------------------------------------------------------------------------

function refreshFace() {
  if (!prefs.key) return face.setState('offline');
  if (listener.active) return face.setState('listening');
  if (speaker.speaking) return face.setState('speaking');
  if (state.thinking) return face.setState('thinking');
  face.setState('idle');
}

function refreshStatus() {
  if (!prefs.key) return setStatus('Falta tu clave de Gemini');
  setStatus(state.thinking ? 'Pensando…' : `Lista · ${MODELS[prefs.model]?.split(' · ')[0] || prefs.model}`);
}

function submit(text, { ask = false } = {}) {
  text = text.trim();
  if (!text) return;
  if (!prefs.key) { openSetup(); return; }
  const who = state.speaker || myName();
  log.add({ from: who, role: 'owner', text }, myName());
  if (!ask && state.mode === 'debate' && !addressedToV(text)) {
    brain.note(who, text);
    return;
  }
  // Las preguntas se atienden de una en una, en orden.
  state.queue = state.queue.then(() => think(who, text)).catch((e) => {
    state.thinking = false;
    log.typing(false);
    log.system(`⚠️ Algo falló: ${e.message}`);
    refreshFace();
    refreshStatus();
  });
}

async function think(who, text) {
  state.thinking = true;
  log.typing(true);
  refreshFace();
  refreshStatus();
  const reply = await brain.respond({
    speaker: who,
    text,
    apiKey: prefs.key,
    model: prefs.model,
    system: systemPrompt(state.personality, {
      owner: myName(),
      mode: state.mode,
      participants: participants(),
      camera: camera.on,
      hands: hands.on,
      screen: Boolean(state.screen),
    }),
    onTool: showTool,
  });
  state.thinking = false;
  log.typing(false);
  log.add({ from: 'V', role: 'v', text: reply.text, tools: reply.tools, error: reply.error }, myName());
  face.setMood(reply.mood);
  refreshFace();
  refreshStatus();
  const spoken = speakable(reply.text);
  showCaption(spoken);
  await sayAloud(spoken);
}

// Voz de Gemini (más natural) con la del navegador como respaldo.
async function sayAloud(text) {
  if (!prefs.voiceOn || !text) return;
  let url = null;
  if (prefs.voice.startsWith('gemini:') && !state.ttsFailed) {
    try {
      const blob = await speak({ apiKey: prefs.key, text, voice: prefs.voice.slice(7) });
      if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
      url = state.audioUrl = URL.createObjectURL(blob);
    } catch (e) {
      state.ttsFailed = true;
      toast(`Uso la voz del navegador: ${e.message}`, 4500);
    }
  }
  speaker.say(url, text);
}

function setMode(mode) {
  state.mode = mode;
  store.set('vweb_mode', mode);
  document.body.classList.toggle('debate', mode === 'debate');
  $('#mode-btn').textContent = mode === 'debate' ? 'Debate' : 'Asistente';
  $('#input').placeholder = mode === 'debate'
    ? 'Tu argumento… (di «V» o pulsa ⚖️ para que opine)'
    : 'Habla o escribe a V…';
}

// ---------------------------------------------------------------------------
// Participantes de este dispositivo
// ---------------------------------------------------------------------------

function renderPeople() {
  const all = participants();
  if (!all.includes(state.speaker)) state.speaker = myName();
  $('#people-count').textContent = all.length;

  const chips = $('#speakers');
  chips.hidden = all.length < 2;
  chips.innerHTML = '';
  for (const name of all) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `speaker-chip${name === state.speaker ? ' active' : ''}`;
    b.textContent = name;
    b.setAttribute('aria-pressed', String(name === state.speaker));
    b.addEventListener('click', () => { state.speaker = name; renderPeople(); });
    chips.appendChild(b);
  }

  const ul = $('#people-list');
  ul.innerHTML = '';
  all.forEach((name, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="pname"></span>';
    li.querySelector('.pname').textContent = name;
    if (i === 0) {
      li.insertAdjacentHTML('beforeend', '<span class="prole owner">tú</span>');
    } else {
      const rm = document.createElement('button');
      rm.className = 'remove';
      rm.dataset.icon = 'close';
      rm.title = `Quitar a ${name}`;
      rm.addEventListener('click', () => {
        prefs.people = prefs.people.filter((p) => p !== name);
        store.set('vweb_people', prefs.people);
        renderPeople();
      });
      li.appendChild(rm);
      injectIcons(li);
    }
    ul.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Pantalla compartida (solo ordenador)
// ---------------------------------------------------------------------------

async function toggleScreen() {
  if (state.screen) { stopScreen(); return; }
  try {
    state.screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch {
    toast('No se compartió ninguna pantalla.');
    return;
  }
  const video = $('#screen-video');
  video.srcObject = state.screen;
  await video.play().catch(() => {});
  state.screen.getVideoTracks()[0]?.addEventListener('ended', stopScreen);
  $('#screen-btn').classList.add('active');
  toast('V verá lo que compartes cuando se lo pidas.');
}

function stopScreen() {
  state.screen?.getTracks().forEach((t) => t.stop());
  state.screen = null;
  $('#screen-video').srcObject = null;
  $('#screen-btn').classList.remove('active');
}

// ---------------------------------------------------------------------------
// Ajustes y primera vez
// ---------------------------------------------------------------------------

function fillVoices() {
  const select = $('#voice-select');
  select.innerHTML = '';
  const gem = document.createElement('optgroup');
  gem.label = 'Voces de Gemini (más naturales)';
  for (const [id, label] of Object.entries(TTS_VOICES)) gem.appendChild(new Option(label, `gemini:${id}`));
  select.appendChild(gem);
  const local = spanishVoices();
  if (local.length) {
    const nav = document.createElement('optgroup');
    nav.label = 'Voces de este dispositivo (sin límite)';
    for (const v of local) nav.appendChild(new Option(`${v.name} (${v.lang})`, `nav:${v.name}`));
    select.appendChild(nav);
  }
  select.value = prefs.voice;
  if (select.value !== prefs.voice) select.value = 'gemini:Charon';
}

function fillSettings() {
  $('#name-input').value = prefs.name;
  $('#key-input').value = prefs.key;
  const models = $('#model-select');
  models.innerHTML = '';
  for (const [id, label] of Object.entries(MODELS)) models.appendChild(new Option(label, id));
  if (!MODELS[prefs.model]) models.appendChild(new Option(prefs.model, prefs.model));
  models.value = prefs.model;
  fillVoices();
  $('#voice-toggle').checked = prefs.voiceOn;
  $('#handsfree-toggle').checked = prefs.handsFree;
}

function openSetup(message = '') {
  $('#setup-name').value = prefs.name;
  $('#setup-key').value = prefs.key;
  $('#setup-error').textContent = message;
  $('#setup').hidden = false;
}

function openDrawer(sel) {
  document.querySelectorAll('.drawer').forEach((d) => { if ('#' + d.id !== sel) d.hidden = true; });
  const el = $(sel);
  el.hidden = !el.hidden;
  if (el.hidden) return;
  if (sel === '#notebook') {
    $('#notebook-btn').classList.remove('badge');
    renderNotebook($('#notebook-list'), notebook.all());
  }
  if (sel === '#settings') fillSettings();
}

function saveName(name) {
  prefs.name = name.trim().slice(0, 24);
  store.set('v_name', prefs.name);
  renderPeople();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#input').value;
  $('#input').value = '';
  autosize($('#input'));
  submit(text);
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
  submit(text, { ask: true });
});
$('#mic-btn').addEventListener('click', () => listener.toggle());
$('#stop-btn').addEventListener('click', () => speaker.stop());
$('#cam-btn').addEventListener('click', () => {
  if (camera.on) { if (hands.on) hands.stop(); camera.stop(); } else camera.start();
});
$('#hands-btn').addEventListener('click', () => (hands.on ? hands.stop() : hands.start()));
$('#flip-btn').addEventListener('click', () => camera.flip());
$('#screen-btn').addEventListener('click', toggleScreen);
$('#screen-btn').hidden = isMobile || !navigator.mediaDevices?.getDisplayMedia;
$('#focus-btn').addEventListener('click', toggleFocus);
$('#face').addEventListener('click', () => {
  if (document.body.classList.contains('focus')) listener.toggle();
});
$('#mode-btn').addEventListener('click', () => {
  const next = state.mode === 'debate' ? 'asistente' : 'debate';
  setMode(next);
  if (next === 'debate') {
    log.system('Modo debate: V escucha y responde cuando la nombran o pulsáis ⚖️.');
    if (participants().length < 2) toast('Añade a tus amigos con el botón de personas para que V sepa quién habla.', 4500);
  } else {
    log.system('Modo asistente: V responde a cada mensaje.');
  }
});
$('#notebook-btn').addEventListener('click', () => openDrawer('#notebook'));
$('#settings-btn').addEventListener('click', () => openDrawer('#settings'));
$('#people-btn').addEventListener('click', () => openDrawer('#people'));
document.querySelectorAll('.drawer .close').forEach((b) => b.addEventListener('click', () => { b.closest('.drawer').hidden = true; }));

$('#add-person').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#person-input').value.replace(/[[\]<>{}]/g, '').trim().slice(0, 24);
  if (!name || participants().includes(name)) return;
  prefs.people.push(name);
  store.set('vweb_people', prefs.people);
  $('#person-input').value = '';
  renderPeople();
});
$('#name-input').addEventListener('change', (e) => { saveName(e.target.value); toast('Nombre guardado'); });
$('#key-input').addEventListener('change', (e) => {
  prefs.key = e.target.value.trim();
  store.set('vweb_key', prefs.key);
  state.ttsFailed = false;
  refreshFace();
  refreshStatus();
  toast(prefs.key ? 'Clave guardada en este navegador' : 'Clave borrada');
});
$('#model-select').addEventListener('change', (e) => {
  prefs.model = e.target.value;
  store.set('vweb_model', prefs.model);
  refreshStatus();
});
$('#voice-select').addEventListener('change', (e) => {
  prefs.voice = e.target.value;
  store.set('vweb_voice', prefs.voice);
  state.ttsFailed = false;
});
$('#voice-toggle').addEventListener('change', (e) => {
  prefs.voiceOn = e.target.checked;
  store.set('v_voice', prefs.voiceOn);
  if (!prefs.voiceOn) speaker.stop();
});
$('#handsfree-toggle').addEventListener('change', (e) => {
  prefs.handsFree = e.target.checked;
  store.set('v_handsfree', prefs.handsFree);
});
$('#reset-btn').addEventListener('click', () => {
  if (!confirm('¿Reiniciar la conversación? El cuaderno de hipótesis se conserva.')) return;
  brain.reset();
  log.clear();
  log.system('Conversación reiniciada.');
});
$('#forget-btn').addEventListener('click', () => {
  if (!confirm('¿Borrar tu clave de Gemini de este navegador?')) return;
  prefs.key = '';
  store.del('vweb_key');
  $('#key-input').value = '';
  refreshFace();
  refreshStatus();
  toast('Clave borrada');
});
$('#export-md').addEventListener('click', () => downloadText('cuaderno-v.md', notebook.toMarkdown()));
$('#setup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const key = $('#setup-key').value.trim();
  if (!/^[\w-]{20,}$/.test(key)) {
    $('#setup-error').textContent = 'Esa clave no parece válida. Cópiala completa desde Google AI Studio.';
    return;
  }
  saveName($('#setup-name').value || 'Investigador');
  prefs.key = key;
  store.set('vweb_key', key);
  $('#setup').hidden = true;
  refreshFace();
  refreshStatus();
  log.add({ from: 'V', role: 'v', text: greeting(myName()) }, myName());
  face.setMood('feliz', 4000);
});
if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', () => { if (!$('#settings').hidden) fillVoices(); });

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function boot() {
  setMode(state.mode);
  renderPeople();
  try {
    const res = await fetch('personalidad.json');
    state.personality = await res.json();
  } catch {
    log.system('⚠️ No pude cargar la personalidad de V. Recarga la página.');
    return;
  }
  refreshFace();
  refreshStatus();
  if (!prefs.key) {
    openSetup();
    return;
  }
  log.add({ from: 'V', role: 'v', text: greeting(myName()) }, myName());
  face.setMood('feliz', 4000);
}

boot();
