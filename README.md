# V — tu asistente de investigación

V es una IA personal con **cara animada, voz elegante y sentido del humor** que te ayuda con tus pruebas, teorías e hipótesis, y que puede debatir contigo y con tus amigos.

| Capacidad | Cómo funciona |
|---|---|
| 🧠 **Cerebro gratuito** | Google **Gemini 3.8 Flash** (nivel gratuito, ve imágenes y usa herramientas). Respaldo opcional en Groq, OpenRouter, Ollama (local) o Claude. |
| 🙂 **Cara** | Un visor animado que parpadea, mira, piensa, habla sincronizado con la voz y cambia de expresión según su ánimo. Modo «solo cara» a pantalla completa. |
| 🗣️ **Voz** | Voces neuronales gratuitas (Jorge de México por defecto). Le hablas con el micrófono o por texto. Modo manos libres. |
| 📷 **Cámara** | V puede mirar por la cámara del iPhone o del ordenador cuando se lo pides («V, ¿qué ves?»). |
| ✋ **Manos** | Seguimiento de manos en el propio dispositivo: gestos, dedos, posición y velocidad. Los ojos de V siguen tu mano. 👍 autoriza, 👎 deniega, ✋ lo silencia, ✌️ empieza a escuchar. |
| 🖥️ **Pantalla y apps** | Ve tu pantalla, abre y cierra aplicaciones, abre webs, escribe, pulsa teclas y hace clic. Las acciones delicadas te piden permiso. |
| ⌚ **Garmin** | Pasos, pulso, sueño, HRV, Body Battery, estrés, preparación y actividades de tu reloj. |
| 📱 **iPhone** | Se instala como app en la pantalla de inicio. |
| ⚖️ **Debate** | Tus amigos se unen desde su móvil con un enlace. V modera, hace de abogado del diablo y convierte las ideas en hipótesis falsables. |
| 📓 **Cuaderno** | Hipótesis con evidencias a favor/en contra, pruebas, predicciones, resultados y confianza. Exportable a Markdown. |
| 🌐 **Página web** | Una versión que funciona solo con el navegador, sin instalar nada: <https://ronnie10cs.github.io/V/> (cuando la publiques, ver [la sección 0](#0-v-en-la-web-sin-instalar-nada)). |

V tiene dos formas de uso:

- **V en la web**: abres una página y listo, en cualquier móvil u ordenador. Tiene voz, cara, cámara, manos, pantalla compartida, cuaderno y debate.
- **V completa**: se ejecuta en tu ordenador con Python. Además controla tus aplicaciones y lee tu Garmin.

---

## 0. V en la web (sin instalar nada)

La página `web/pagina.html` funciona entera en el navegador: piensa con Gemini usando **tu clave gratuita** y no necesita ningún servidor tuyo.

| | V en la web | V completa (`python -m v`) |
|---|---|---|
| Voz, cara y conversación | ✅ Voz de Gemini o del navegador | ✅ Voz neuronal de Microsoft |
| Cámara y seguimiento de manos | ✅ | ✅ |
| Ver tu pantalla | ✅ La que compartes (en ordenador) | ✅ Siempre, y además hace clic y escribe |
| Abrir y cerrar aplicaciones | ❌ | ✅ |
| Datos del Garmin | ❌ | ✅ |
| Cuaderno de hipótesis | ✅ Guardado en ese navegador | ✅ Guardado en tu ordenador |
| Debate | ✅ Varias personas en el mismo dispositivo | ✅ Cada amigo desde su móvil |

### Publicarla gratis con GitHub Pages

1. Lleva estos cambios a la rama `main` (fusiona el pull request).
2. En GitHub, ve a **Settings → Pages** y en **Source** elige **GitHub Actions**.
3. Ve a **Actions → Publicar V en la web → Run workflow**. A partir de ahí se vuelve a publicar sola cada vez que cambie la carpeta `web/`.
4. Abre **<https://ronnie10cs.github.io/V/>**, escribe tu nombre y pega tu clave de Gemini (<https://aistudio.google.com/apikey>).

En el iPhone, ábrela en Safari y usa **Compartir → Añadir a pantalla de inicio**. GitHub Pages ya usa HTTPS, así que la cámara y el micrófono funcionan sin configurar nada.

Para probarla en tu ordenador sin publicarla: `python -m http.server 8080 -d web` y abre <http://localhost:8080/pagina.html>.

**Tu clave** se guarda solo en el navegador donde la escribes y solo se envía a Google. Cada amigo que abra la página puede usar su propia clave. **Para debatir en un mismo dispositivo**, añade a tus amigos con el botón de personas y toca el nombre de quien va a hablar antes de su turno.

---

## 1. Puesta en marcha en tu ordenador

**Paso 1 · Instala Python** (solo una vez), versión 3.10 o más reciente, desde <https://www.python.org/downloads/>.
En Windows, durante la instalación marca la casilla **«Add python.exe to PATH»**.

**Paso 2 · Descarga V.** En <https://github.com/ronnie10cs/V> pulsa **Code → Download ZIP** y descomprímelo donde quieras (por ejemplo, en Documentos).

**Paso 3 · Ábrela con doble clic:**

| Sistema | Archivo |
|---|---|
| Windows | `iniciar-windows.bat` |
| Mac | `iniciar-mac.command` (la primera vez: clic derecho → **Abrir** → **Abrir**, porque macOS no conoce el archivo) |
| Linux | `python3 iniciar.py` en una terminal |

La primera vez tarda unos minutos porque instala lo que V necesita. Después te pregunta tu nombre y tu clave **gratuita** de Gemini: se abre la página <https://aistudio.google.com/apikey>, pulsas **Create API key**, la copias y la pegas en la ventana. A partir de ahí, V se abre sola en el navegador cada vez que haces doble clic. La primera vez, toca la pantalla para activar el audio.

- **Cerrar V:** cierra la ventana negra (o pulsa Ctrl+C en ella).
- **Cambiar tu nombre o tu clave:** abre el archivo `.env` de la carpeta con el Bloc de notas o TextEdit, o ejecuta `python3 iniciar.py configurar` en una terminal dentro de la carpeta (en Windows: `py iniciar.py configurar`).
- Si haces doble clic con V ya abierta, simplemente vuelve a abrir el navegador.
- **Actualizar V:** cierra la ventana negra y haz doble clic en `actualizar-windows.bat` (o `actualizar-mac.command`). Descarga la última versión sin tocar tu clave, tus datos ni lo ya instalado.

<details>
<summary>Instalación manual (para quien prefiera la terminal)</summary>

```bash
git clone https://github.com/ronnie10cs/V.git
cd V
python3 -m venv .venv
source .venv/bin/activate          # En Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m v                        # la primera vez te pide nombre y clave
```

`python -m v --sin-navegador` arranca sin abrir el navegador.
</details>

### Permisos en macOS

Para que V vea la pantalla y controle el teclado y el ratón, ve a **Ajustes del Sistema → Privacidad y seguridad** y da permiso a la Terminal (o a tu editor) en **Grabación de pantalla** y **Accesibilidad**. En Windows no hace falta nada.

---

## 2. Usar V en el iPhone

El iPhone solo permite cámara y micrófono en páginas **HTTPS**. Elige una opción:

**A. Tailscale (recomendado, privado y gratis).** Instala [Tailscale](https://tailscale.com/download) en el ordenador y en el iPhone con la misma cuenta, y ejecuta en el ordenador:

```bash
tailscale serve --bg 8000
```

Te dará una dirección tipo `https://tu-mac.tu-red.ts.net`, accesible solo desde tus dispositivos.

**B. Cloudflare Tunnel (para invitar a amigos de fuera).**

```bash
cloudflared tunnel --url http://localhost:8000
```

Te dará una dirección pública `https://algo.trycloudflare.com`. Está protegida por los tokens de acceso, pero no compartas el enlace de dueño.

Después:

```bash
python -m v enlace --url https://tu-direccion
```

Escanea el **código QR** con la cámara del iPhone, abre el enlace en Safari y usa **Compartir → Añadir a pantalla de inicio**. V quedará como una app con la sesión ya iniciada.

- **Modo cara:** el botón ⤢ muestra solo la cara a pantalla completa y evita que la pantalla se apague. Toca la cara para hablar. Ideal con el iPhone en un soporte.
- **Siri:** crea un Atajo «Abrir URL» con tu enlace y llámalo «V». Así basta con decir «Oye Siri, V».
- En el móvil, el botón 🔄 de la vista de la cámara alterna entre la cámara frontal y la trasera, por ejemplo para mostrarle a V un experimento.

---

## 3. Vincular tu Garmin

Garmin solo da su API oficial a empresas, así que V usa la librería comunitaria [`garminconnect`](https://github.com/cyberjunky/python-garminconnect). Ejecuta una sola vez:

```bash
python -m v garmin
```

Te pedirá el correo, la contraseña y el código de verificación, si lo tienes activado. Se guarda la **sesión** en `datos/garmin/`, no la contraseña. Después, pregúntale a V cosas como:

> «¿Cómo dormí anoche?» · «¿Estoy recuperado para entrenar fuerte hoy?» · «Compara mi pulso en reposo de esta semana con mis últimas carreras.»

---

## 4. Cómo trabajar con V

**Pruebas y teorías.** Cuéntale una idea. V la formula de modo falsable, busca la predicción arriesgada, propone la prueba más barata que podría refutarla, señala sesgos y confusores, y la registra en el **cuaderno** (📓). Cuando tengas resultados, díselo y actualizará la confianza.

**Debate con amigos.**
1. Pulsa 👥 y comparte el enlace de invitados.
2. Cambia a **Debate** con el botón de modo.
3. Todos escriben o hablan. V **escucha sin interrumpir** hasta que alguien la nombra («V, ¿quién tiene razón?») o pulsa ⚖️.
4. V resume las posturas, encuentra el punto exacto del desacuerdo, hace de abogado del diablo y registra las hipótesis nuevas con su autor.

Los invitados solo pueden hablar con V y usar el cuaderno y la calculadora. **Nunca** tocan tu ordenador, tu cámara ni tu Garmin.

**Ordenador.** «Abre Spotify», «¿qué tengo abierto?», «mira mi pantalla y dime qué error sale», «cierra Chrome», «busca en YouTube…».

**Cámara y manos.** Activa 📷 y ✋. «V, ¿qué ves?», «¿cuántos dedos levanto?», «mira cómo muevo la mano».

---

## 5. Seguridad y privacidad

- **Tokens de acceso.** Se generan en `datos/tokens.json`. Quien tenga tu enlace de dueño controla tu ordenador: no lo compartas. Si se filtra, borra ese archivo y reinicia V para generar tokens nuevos.
- **Permisos.** Cerrar apps, escribir, pulsar teclas y hacer clic piden confirmación en todos tus dispositivos conectados, con botones o con 👍/👎. Ajustable con `V_CONFIRM`.
- **Freno de emergencia.** Mueve el ratón a una **esquina de la pantalla** y cualquier acción de teclado o ratón se detiene.
- **Terminal desactivada** por defecto (`V_ALLOW_SHELL=false`). Si la activas, cada comando pide permiso.
- **Por defecto solo escucha en `127.0.0.1`**. El acceso desde fuera pasa por Tailscale o Cloudflare.
- **Qué sale de tu equipo.** El seguimiento de manos se procesa en el propio dispositivo y solo envía un resumen (gesto, dedos, posición). Las fotos de la cámara y las capturas de pantalla solo se toman cuando V las necesita, y se envían al proveedor de IA.
- **Nivel gratuito de Gemini.** Google puede usar esos datos para mejorar sus productos. Si trabajas con información sensible, usa `V_PROVIDER=ollama` (100 % local) o un plan de pago.
- **Salud.** Los datos del Garmin son orientativos. V no da diagnósticos médicos.

---

## 6. Elegir el cerebro

| `V_PROVIDER` | Coste | Visión | Notas |
|---|---|---|---|
| `gemini` *(por defecto)* | Gratis con límites | ✅ | `gemini-3.8-flash`: el mejor equilibrio gratuito actual entre inteligencia, visión y herramientas. |
| `groq` | Gratis con límites | ❌ | `openai/gpt-oss-120b`, rapidísimo. Buen respaldo: `V_FALLBACK=groq`. |
| `openrouter` | Modelos gratuitos | ✅ | `openrouter/free` elige un modelo gratuito disponible. |
| `ollama` | Gratis, local | ✅ | Privacidad total. Necesita un buen ordenador (`ollama pull qwen3-vl`). |
| `anthropic` | De pago | ✅ | Claude (`claude-opus-5`), máxima calidad de razonamiento. |

Si un modelo de Gemini está saturado («high demand») o sin cuota, V prueba sola los demás modelos gratuitos (3.8 Flash → 3.7 Flash → 3.5 Flash → 3.5 Flash-Lite → 3.1 Flash-Lite) y deja descansar dos minutos al que falló. Si todo Gemini falla, pasa al proveedor de `V_FALLBACK` (por ejemplo `groq`, con su clave gratuita).

---

## 7. Estructura

```
v/
  __main__.py        Línea de comandos: servir, garmin, enlace, voces
  server.py          Servidor web + WebSocket en tiempo real
  hub.py             Dispositivos conectados, cámara, manos y confirmaciones
  agent.py           Bucle de conversación y herramientas
  persona.py         Personalidad, modo debate y estado de cada turno
  speech.py          Voz neuronal (edge-tts)
  notebook.py        Cuaderno de hipótesis persistente
  llm/               Gemini, Groq/OpenRouter/Ollama, Claude y respaldo
  tools/             Ordenador, cámara/manos, Garmin, cuaderno y calculadora
web/
  index.html, app.js      Interfaz de V completa (se conecta al servidor)
  pagina.html, pagina.js  V en la web (funciona sola en el navegador)
  common.js               Piezas compartidas: chat, voz, micrófono, cámara y manos
  cerebro.js              Bucle de conversación de V en la web
  gemini.js               Cliente de Gemini (conversación y voz)
  herramientas.js         Herramientas de V en la web
  cuaderno.js, calculo.js Cuaderno de hipótesis y calculadora
  personalidad.json       Cómo habla y piensa V (compartido por las dos versiones)
  face.js, hands.js       La cara animada y el seguimiento de manos (MediaPipe)
  style.css               Estilos de las dos versiones
tests/                    Pruebas automáticas (pytest y node --test)
.github/workflows/        Publicación de V en la web con GitHub Pages
```

Pruebas (las de JavaScript se ejecutan también si tienes Node.js):

```bash
python -m pytest
node --test tests/web/*.test.mjs
```

## Limitaciones conocidas

- El reconocimiento de voz lo hace el navegador (Safari y Chrome sí; Firefox no). Siempre puedes escribir.
- El seguimiento de manos descarga el modelo de MediaPipe la primera vez (hace falta internet).
- `garminconnect` no es oficial. Si Garmin cambia su web, puede fallar hasta que la librería se actualice (`pip install -U garminconnect`).
- Los niveles gratuitos tienen límites por minuto y por día. Si V dice que se agotó la cuota, espera un poco o configura un respaldo.
- En V en la web, si la voz de Gemini falla o se agota su cuota, V cambia sola a la voz del navegador hasta que recargues la página.
