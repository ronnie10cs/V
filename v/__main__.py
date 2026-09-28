"""Línea de comandos de V.

    python -m v              Arranca V y la abre en el navegador (igual que `python -m v servir`)
    python -m v configurar   Pide tu nombre y tu clave de Gemini y los guarda en .env
    python -m v garmin       Vincula tu cuenta de Garmin Connect (una sola vez)
    python -m v enlace       Muestra los enlaces de acceso y un código QR para el iPhone
    python -m v voces        Lista las voces en español disponibles
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import logging
import os
import socket
import sys
import threading
import webbrowser
from pathlib import Path

from .config import ROOT, Settings

ENV_FILE = ROOT / ".env"
KEY_PAGE = "https://aistudio.google.com/apikey"


def _qr(url: str) -> None:
    try:
        import qrcode
    except ImportError:
        return
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make(fit=True)
    qr.print_ascii(invert=True)


def cmd_links(settings: Settings, url: str | None = None) -> None:
    settings.ensure_tokens()
    if url:
        settings.public_url = url.rstrip("/")
    print("\n  V está listo.\n")
    print(f"  Tu acceso (dueño, control total):  {settings.owner_link()}")
    print(f"  Invitados para debatir:            {settings.guest_link()}")
    print("\n  No compartas el enlace de dueño: permite controlar tu ordenador.")
    if settings.public_url:
        print("\n  Escanea con el iPhone:\n")
        _qr(settings.owner_link())
    else:
        print("\n  Para usar V en el iPhone necesitas HTTPS (cámara y micrófono lo exigen).")
        print("  Mira la sección «Usar V en el iPhone» del README (Tailscale o Cloudflare)")
        print("  y luego ejecuta: python -m v enlace --url https://tu-direccion")
    print()


def write_env(path: Path, values: dict[str, str]) -> None:
    """Guarda valores en el archivo .env conservando el resto (y los comentarios)."""
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    elif (path.parent / ".env.example").exists():
        lines = (path.parent / ".env.example").read_text(encoding="utf-8").splitlines()
    else:
        lines = []
    pending = dict(values)
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if "=" in line and not line.lstrip().startswith("#") and key in pending:
            lines[i] = f"{key}={pending.pop(key)}"
    lines += [f"{key}={value}" for key, value in pending.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def needs_setup(settings: Settings) -> bool:
    return settings.provider == "gemini" and not settings.gemini_api_key


def cmd_setup(settings: Settings) -> Settings:
    """Asistente para tu nombre y tu clave de Gemini. Enter conserva lo que ya haya."""
    print("\n  Hola, soy V. Preparemos todo.\n")
    values: dict[str, str] = {}
    current_name = os.environ.get("V_OWNER_NAME", "").strip()
    name = input(f"  ¿Cómo te llamas?{f' [{current_name}]' if current_name else ''} ").strip()
    if name:
        values["V_OWNER_NAME"] = name.replace("[", "").replace("]", "")[:24]

    has_key = bool(settings.gemini_api_key)
    print("\n  Pienso con Gemini, de Google, que es gratis. Necesito tu clave:")
    print(f"  1. Abre {KEY_PAGE} y entra con tu cuenta de Google.")
    print("  2. Pulsa «Create API key» y cópiala.")
    print("  3. Pégala aquí y pulsa Enter." + (" (Enter sin nada conserva la actual.)" if has_key else "") + "\n")
    if not has_key:
        webbrowser.open(KEY_PAGE)
    while True:
        key = input("  Tu clave de Gemini: ").strip().strip('"').strip("'")
        if not key and has_key:
            break
        if len(key) >= 20:
            values["GEMINI_API_KEY"] = key
            break
        print("  Esa clave parece incompleta; cópiala entera.")

    if values:
        write_env(ENV_FILE, values)
        os.environ.update(values)
        print(f"\n  Guardado en {ENV_FILE}.")
    print("  Para cambiarlo más adelante, edita el archivo .env o ejecuta: iniciar.py configurar\n")
    return Settings.from_env()


def _already_running(port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def cmd_serve(settings: Settings, open_browser: bool = True) -> None:
    settings.ensure_tokens()
    scheme = "https" if settings.ssl_cert else "http"
    local_link = f"{scheme}://localhost:{settings.port}/?t={settings.owner_token}"
    if _already_running(settings.port):
        print(f"\n  V ya está abierta en {local_link}\n")
        if open_browser:
            webbrowser.open(local_link)
        return

    import uvicorn

    from .server import create_app

    app = create_app(settings)
    cmd_links(settings)
    if app.state.agent is None:
        print("  ⚠ V arrancó sin cerebro: pon tu clave de Gemini en el archivo .env o ejecuta: iniciar.py configurar\n")
    print("  Para cerrar V, cierra esta ventana o pulsa Ctrl+C.\n")
    if open_browser:
        threading.Timer(1.5, webbrowser.open, args=[local_link]).start()
    ssl = {}
    if settings.ssl_cert and settings.ssl_key:
        ssl = {"ssl_certfile": settings.ssl_cert, "ssl_keyfile": settings.ssl_key}
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="warning", **ssl)


def cmd_garmin(settings: Settings) -> None:
    try:
        from garminconnect import Garmin
    except ImportError:
        sys.exit("Instala las dependencias primero: pip install -r requirements.txt")
    email = settings.garmin_email or input("Correo de Garmin Connect: ").strip()
    password = settings.garmin_password or getpass.getpass("Contraseña: ")
    token_dir = settings.data_dir / "garmin"
    token_dir.mkdir(parents=True, exist_ok=True)
    client = Garmin(email, password, prompt_mfa=lambda: input("Código de verificación (MFA): ").strip())
    try:
        client.login(str(token_dir))
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"No se pudo iniciar sesión en Garmin: {exc}")
    try:
        client.client.dump(str(token_dir))
    except Exception:  # noqa: BLE001 - login() ya guarda la sesión; esto es un refuerzo
        pass
    name = ""
    try:
        name = client.get_full_name() or ""
    except Exception:  # noqa: BLE001
        pass
    print(f"Garmin vinculado{f' como {name}' if name else ''}. Sesión guardada en {token_dir}")
    print("La contraseña no se guarda; V usará la sesión para leer tus datos.")


def cmd_voices() -> None:
    try:
        import edge_tts
    except ImportError:
        sys.exit("Instala edge-tts: pip install edge-tts")
    voices = asyncio.run(edge_tts.list_voices())
    for v in sorted(voices, key=lambda v: v["ShortName"]):
        if v["Locale"].startswith("es-"):
            print(f"{v['ShortName']:<28} {v['Gender']:<7} {v['Locale']}")
    print("\nElige una con V_VOICE en el archivo .env")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m v", description="V, tu asistente de investigación.")
    parser.add_argument("--sin-navegador", action="store_true", help="No abrir el navegador al arrancar")
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("servir", help="Arranca V (predeterminado)")
    sub.add_parser("configurar", help="Pide tu nombre y tu clave de Gemini")
    sub.add_parser("garmin", help="Vincula tu cuenta de Garmin Connect")
    enlace = sub.add_parser("enlace", help="Muestra los enlaces de acceso y un QR")
    enlace.add_argument("--url", help="Dirección pública HTTPS (Tailscale, Cloudflare…)")
    sub.add_parser("voces", help="Lista las voces en español")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    settings = Settings.from_env()

    if args.cmd == "configurar":
        cmd_setup(settings)
    elif args.cmd == "garmin":
        cmd_garmin(settings)
    elif args.cmd == "enlace":
        cmd_links(settings, args.url)
    elif args.cmd == "voces":
        cmd_voices()
    else:
        if needs_setup(settings) and sys.stdin.isatty():
            settings = cmd_setup(settings)
        cmd_serve(settings, open_browser=not args.sin_navegador)


if __name__ == "__main__":
    main()
