"""Línea de comandos de V.

    python -m v              Arranca V (igual que `python -m v servir`)
    python -m v garmin       Vincula tu cuenta de Garmin Connect (una sola vez)
    python -m v enlace       Muestra los enlaces de acceso y un código QR para el iPhone
    python -m v voces        Lista las voces en español disponibles
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import logging
import sys

from .config import Settings


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


def cmd_serve(settings: Settings) -> None:
    import uvicorn

    from .server import create_app

    app = create_app(settings)
    cmd_links(settings)
    if app.state.agent is None:
        print("  ⚠ V arrancó sin cerebro: revisa tu archivo .env (GEMINI_API_KEY).\n")
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
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("servir", help="Arranca V (predeterminado)")
    sub.add_parser("garmin", help="Vincula tu cuenta de Garmin Connect")
    enlace = sub.add_parser("enlace", help="Muestra los enlaces de acceso y un QR")
    enlace.add_argument("--url", help="Dirección pública HTTPS (Tailscale, Cloudflare…)")
    sub.add_parser("voces", help="Lista las voces en español")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    settings = Settings.from_env()

    if args.cmd == "garmin":
        cmd_garmin(settings)
    elif args.cmd == "enlace":
        cmd_links(settings, args.url)
    elif args.cmd == "voces":
        cmd_voices()
    else:
        cmd_serve(settings)


if __name__ == "__main__":
    main()
