"""Control del equipo: ver la pantalla, abrir y cerrar apps, teclado y ratón.

Funciona en macOS, Windows y Linux (con escritorio). Las librerías gráficas se
importan solo al usarse para que el servidor arranque también sin pantalla.

Freno de emergencia: mueve el ratón a cualquier esquina de la pantalla y
pyautogui detiene la siguiente acción de teclado o ratón.
"""

from __future__ import annotations

import asyncio
import csv
import io
import os
import shutil
import subprocess
import sys
import time
import webbrowser
from typing import Any

from ..llm.types import Image, ToolResult
from .base import Tool, ToolContext, ToolError, schema

PLATFORM = sys.platform  # "darwin" | "win32" | "linux"

APP_ALIASES = {
    "win32": {
        "calculadora": "calc",
        "bloc de notas": "notepad",
        "notas": "notepad",
        "explorador": "explorer",
        "paint": "mspaint",
        "terminal": "wt",
        "configuracion": "ms-settings:",
        "configuración": "ms-settings:",
        "spotify": "spotify:",
    },
    "darwin": {
        "calculadora": "Calculator",
        "notas": "Notes",
        "terminal": "Terminal",
        "navegador": "Safari",
        "musica": "Music",
        "música": "Music",
        "configuracion": "System Settings",
        "configuración": "System Settings",
        "chrome": "Google Chrome",
        "vscode": "Visual Studio Code",
    },
    "linux": {
        "calculadora": "gnome-calculator",
        "terminal": "x-terminal-emulator",
        "navegador": "x-www-browser",
        "chrome": "google-chrome",
        "vscode": "code",
    },
}

# Procesos que V nunca cerrará.
PROTECTED = {
    "explorer.exe", "winlogon.exe", "csrss.exe", "lsass.exe", "services.exe",
    "svchost.exe", "system", "smss.exe", "wininit.exe", "dwm.exe",
    "systemd", "init", "kernel_task", "launchd", "loginwindow", "windowserver",
    "finder", "dock", "xorg", "gnome-shell", "kwin_x11", "kwin_wayland",
}

KEY_ALIASES = {
    "control": "ctrl", "comando": "command", "cmd": "command", "mayus": "shift",
    "mayús": "shift", "mayusculas": "shift", "intro": "enter", "retorno": "enter",
    "espacio": "space", "suprimir": "delete", "supr": "delete", "retroceso": "backspace",
    "borrar": "backspace", "escape": "esc", "arriba": "up", "abajo": "down",
    "izquierda": "left", "derecha": "right", "inicio": "home", "fin": "end",
    "opcion": "option", "opción": "option", "windows": "win", "tabulador": "tab",
    "avpag": "pagedown", "repag": "pageup",
}


def _pyautogui():
    try:
        import pyautogui
    except Exception as exc:  # noqa: BLE001 - sin pantalla lanza errores variados
        raise ToolError(f"El control de teclado y ratón no está disponible aquí: {exc}") from exc
    pyautogui.FAILSAFE = True
    w, h = pyautogui.size()
    pyautogui.FAILSAFE_POINTS = [(0, 0), (0, h - 1), (w - 1, 0), (w - 1, h - 1)]
    pyautogui.PAUSE = 0.05
    return pyautogui


class Computer:
    """Estado compartido: el tamaño de la última captura para traducir clics."""

    def __init__(self, allow_shell: bool = False):
        self.allow_shell = allow_shell
        self._last_shot: dict[str, Any] | None = None

    # --- Pantalla -----------------------------------------------------------

    def screenshot(self, monitor: int = 1, max_side: int = 1280) -> tuple[Image, str]:
        try:
            import mss
            from PIL import Image as PILImage
        except ImportError as exc:
            raise ToolError("Instala 'mss' y 'pillow' para ver la pantalla.") from exc
        try:
            with mss.mss() as sct:
                monitors = sct.monitors
                index = monitor if 0 < monitor < len(monitors) else 1
                rect = dict(monitors[index])
                raw = sct.grab(rect)
                img = PILImage.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
                total = len(monitors) - 1
        except Exception as exc:  # noqa: BLE001
            raise ToolError(f"No pude capturar la pantalla: {exc}") from exc
        img.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=72)
        self._last_shot = {"w": img.width, "h": img.height, "rect": rect}
        note = (
            f"Captura del monitor {index} de {total}, {img.width}x{img.height} px. "
            "Para hacer clic usa coordenadas en píxeles de ESTA imagen."
        )
        return Image(buf.getvalue(), "image/jpeg"), note

    def to_screen(self, x: float, y: float) -> tuple[int, int]:
        if not self._last_shot:
            raise ToolError("Primero mira la pantalla (ver_pantalla) para saber dónde hacer clic.")
        shot = self._last_shot
        if not (0 <= x <= shot["w"] and 0 <= y <= shot["h"]):
            raise ToolError(f"({x}, {y}) está fuera de la captura de {shot['w']}x{shot['h']}.")
        rect = shot["rect"]
        return (
            int(rect["left"] + x / shot["w"] * rect["width"]),
            int(rect["top"] + y / shot["h"] * rect["height"]),
        )

    # --- Aplicaciones -------------------------------------------------------

    def open_app(self, name: str) -> str:
        target = APP_ALIASES.get(PLATFORM, {}).get(name.lower().strip(), name.strip())
        if not target:
            raise ToolError("Dime qué aplicación abrir.")
        if PLATFORM == "darwin":
            proc = subprocess.run(["open", "-a", target], capture_output=True, text=True)
            if proc.returncode != 0:
                raise ToolError(f"No encontré la app '{target}'. {proc.stderr.strip()}")
        elif PLATFORM == "win32":
            # 'start' resuelve apps registradas (chrome, excel…) y URIs (spotify:).
            subprocess.Popen(["cmd", "/c", "start", "", target], creationflags=0x08000000)
        else:
            exe = shutil.which(target) or shutil.which(target.lower())
            if exe:
                subprocess.Popen([exe], start_new_session=True,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            elif shutil.which("gtk-launch"):
                subprocess.Popen(["gtk-launch", target.lower()], start_new_session=True,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                raise ToolError(f"No encontré '{target}' en este sistema.")
        return f"Abriendo {target}."

    def close_app(self, name: str) -> str:
        query = name.lower().strip().removesuffix(".exe")
        if not query:
            raise ToolError("Dime qué aplicación cerrar.")
        if query in PROTECTED or f"{query}.exe" in PROTECTED:
            raise ToolError(f"'{name}' es parte del sistema; no lo cierro.")
        if PLATFORM == "darwin":
            app = APP_ALIASES["darwin"].get(query, name.strip())
            safe = app.replace("\\", "").replace('"', "")
            proc = subprocess.run(["osascript", "-e", f'quit app "{safe}"'],
                                  capture_output=True, text=True)
            if proc.returncode == 0:
                return f"Cerré {safe}."
            # Si AppleScript no la conoce, se intenta por nombre de proceso.
        return self._terminate(query)

    def _terminate(self, query: str) -> str:
        import psutil

        me = os.getpid()
        protected_pids = {me, os.getppid()}
        victims = []
        for proc in psutil.process_iter(["pid", "name"]):
            pname = (proc.info.get("name") or "").lower()
            if not pname or proc.info["pid"] in protected_pids or pname in PROTECTED:
                continue
            if query in pname.removesuffix(".exe"):
                victims.append(proc)
        if not victims:
            raise ToolError(f"No encontré ninguna aplicación abierta llamada '{query}'.")
        for proc in victims:
            try:
                proc.terminate()
            except psutil.Error:
                pass
        _, alive = psutil.wait_procs(victims, timeout=3)
        names = sorted({(p.info.get("name") or "?") for p in victims})
        msg = f"Cerré {len(victims) - len(alive)} proceso(s): {', '.join(names)}."
        if alive:
            msg += f" {len(alive)} no respondieron."
        return msg

    def list_apps(self) -> str:
        if PLATFORM == "darwin":
            script = ('tell application "System Events" to get name of every process '
                      "whose background only is false")
            proc = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
            if proc.returncode == 0:
                return "Apps abiertas: " + proc.stdout.strip()
        elif PLATFORM == "win32":
            proc = subprocess.run(["tasklist", "/v", "/fo", "csv"], capture_output=True,
                                  text=True, creationflags=0x08000000)
            rows = list(csv.reader(io.StringIO(proc.stdout)))
            windows = sorted({f"{r[0]} — {r[-1]}" for r in rows[1:]
                              if len(r) > 1 and r[-1] not in ("N/A", "", "No disponible")})
            if windows:
                return "Ventanas abiertas:\n" + "\n".join(windows[:60])
        elif shutil.which("wmctrl"):
            proc = subprocess.run(["wmctrl", "-l"], capture_output=True, text=True)
            titles = [line.split(None, 3)[-1] for line in proc.stdout.splitlines() if line.strip()]
            return "Ventanas abiertas:\n" + "\n".join(titles[:60])
        import psutil

        user = psutil.Process().username()
        names = sorted({p.info["name"] for p in psutil.process_iter(["name", "username"])
                        if p.info.get("username") == user and p.info.get("name")})
        return "Procesos del usuario: " + ", ".join(names[:80])

    # --- Teclado y ratón ----------------------------------------------------

    def click(self, x: float, y: float, button: str = "left", double: bool = False) -> str:
        pg = _pyautogui()
        sx, sy = self.to_screen(x, y)
        pg.click(sx, sy, clicks=2 if double else 1, button=button)
        return f"Clic {'doble ' if double else ''}en ({x}, {y})."

    def type_text(self, text: str, enter: bool = False) -> str:
        pg = _pyautogui()
        if text.isascii():
            pg.write(text, interval=0.01)
        else:
            # pyautogui solo escribe ASCII: los acentos van por el portapapeles.
            import pyperclip

            previous = None
            try:
                previous = pyperclip.paste()
            except Exception:  # noqa: BLE001
                pass
            pyperclip.copy(text)
            pg.hotkey("command" if PLATFORM == "darwin" else "ctrl", "v")
            time.sleep(0.3)
            if previous is not None:
                pyperclip.copy(previous)
        if enter:
            pg.press("enter")
        return f"Escribí {len(text)} caracteres."

    def hotkey(self, combo: str) -> str:
        pg = _pyautogui()
        keys = [KEY_ALIASES.get(k.strip().lower(), k.strip().lower())
                for k in combo.replace(" ", "").split("+") if k.strip()]
        invalid = [k for k in keys if k not in pg.KEYBOARD_KEYS]
        if not keys or invalid:
            raise ToolError(f"Teclas no reconocidas: {', '.join(invalid) or combo}")
        pg.hotkey(*keys)
        return f"Pulsé {'+'.join(keys)}."

    def scroll(self, amount: int) -> str:
        pg = _pyautogui()
        pg.scroll(int(amount))
        return f"Desplacé {amount}."

    def run_shell(self, command: str) -> str:
        if not self.allow_shell:
            raise ToolError("La terminal está desactivada (V_ALLOW_SHELL=false).")
        proc = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=60)
        out = (proc.stdout or "")[-3000:]
        err = (proc.stderr or "")[-1500:]
        return f"Código de salida {proc.returncode}\n{out}\n{err}".strip()


def build_tools(computer: Computer) -> list[Tool]:
    async def ver_pantalla(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        img, note = await asyncio.to_thread(computer.screenshot, int(args.get("monitor") or 1))
        return ToolResult(note, images=[img])

    async def abrir_app(args, ctx):
        return await asyncio.to_thread(computer.open_app, str(args.get("nombre", "")))

    async def cerrar_app(args, ctx):
        return await asyncio.to_thread(computer.close_app, str(args.get("nombre", "")))

    async def apps_abiertas(args, ctx):
        return await asyncio.to_thread(computer.list_apps)

    async def abrir_url(args, ctx):
        url = str(args.get("url", "")).strip()
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        await asyncio.to_thread(webbrowser.open, url)
        return f"Abrí {url} en el navegador."

    async def clic(args, ctx):
        return await asyncio.to_thread(
            computer.click, float(args["x"]), float(args["y"]),
            str(args.get("boton") or "left"), bool(args.get("doble")),
        )

    async def escribir(args, ctx):
        return await asyncio.to_thread(computer.type_text, str(args.get("texto", "")),
                                       bool(args.get("enter")))

    async def teclas(args, ctx):
        return await asyncio.to_thread(computer.hotkey, str(args.get("combinacion", "")))

    async def desplazar(args, ctx):
        return await asyncio.to_thread(computer.scroll, int(args.get("cantidad", -5)))

    async def terminal(args, ctx):
        return await asyncio.to_thread(computer.run_shell, str(args.get("comando", "")))

    tools = [
        Tool("ver_pantalla",
             "Captura la pantalla del ordenador del dueño y te la muestra. Úsala antes de "
             "hacer clic o cuando te pregunten qué hay en pantalla.",
             schema({"monitor": {"type": "integer", "description": "Número de monitor (1 = principal)."}}),
             ver_pantalla),
        Tool("abrir_app", "Abre una aplicación por su nombre (p. ej. 'Spotify', 'Chrome', 'calculadora').",
             schema({"nombre": {"type": "string"}}, ["nombre"]), abrir_app,
             describe=lambda a: f"Abrir la aplicación «{a.get('nombre')}»"),
        Tool("cerrar_app", "Cierra una aplicación abierta por su nombre.",
             schema({"nombre": {"type": "string"}}, ["nombre"]), cerrar_app, sensitive=True,
             describe=lambda a: f"Cerrar la aplicación «{a.get('nombre')}»"),
        Tool("apps_abiertas", "Lista las aplicaciones y ventanas abiertas.", schema(), apps_abiertas),
        Tool("abrir_url", "Abre una dirección web en el navegador predeterminado.",
             schema({"url": {"type": "string"}}, ["url"]), abrir_url,
             describe=lambda a: f"Abrir {a.get('url')}"),
        Tool("clic",
             "Hace clic en la pantalla. Las coordenadas son píxeles de la última captura de ver_pantalla.",
             schema({
                 "x": {"type": "number"}, "y": {"type": "number"},
                 "boton": {"type": "string", "enum": ["left", "right", "middle"]},
                 "doble": {"type": "boolean"},
             }, ["x", "y"]),
             clic, sensitive=True,
             describe=lambda a: f"Hacer {'doble ' if a.get('doble') else ''}clic en ({a.get('x')}, {a.get('y')})"),
        Tool("escribir_texto", "Escribe texto con el teclado donde esté el cursor.",
             schema({"texto": {"type": "string"},
                     "enter": {"type": "boolean", "description": "Pulsar Enter al final."}}, ["texto"]),
             escribir, sensitive=True,
             describe=lambda a: f"Escribir: «{str(a.get('texto'))[:120]}»"),
        Tool("pulsar_teclas", "Pulsa una combinación de teclas, p. ej. 'ctrl+c', 'command+tab', 'enter'.",
             schema({"combinacion": {"type": "string"}}, ["combinacion"]), teclas, sensitive=True,
             describe=lambda a: f"Pulsar {a.get('combinacion')}"),
        Tool("desplazar", "Desplaza la ventana activa: positivo sube, negativo baja.",
             schema({"cantidad": {"type": "integer"}}, ["cantidad"]), desplazar),
    ]
    if computer.allow_shell:
        tools.append(
            Tool("ejecutar_comando",
                 "Ejecuta un comando en la terminal del ordenador y devuelve la salida. Úsalo con cautela.",
                 schema({"comando": {"type": "string"}}, ["comando"]), terminal,
                 sensitive=True, always_confirm=True,
                 describe=lambda a: f"Ejecutar en la terminal: {a.get('comando')}")
        )
    return tools
