"""Arranca V: la primera vez prepara todo lo necesario y después abre V.

Uso: doble clic en «iniciar-windows.bat» o «iniciar-mac.command», o bien
`python3 iniciar.py` en una terminal. Los argumentos se pasan a `python -m v`.
"""

import hashlib
import os
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
MARKER = VENV / ".requisitos-instalados"
DOWNLOAD = "https://www.python.org/downloads/"


def main() -> int:
    if sys.version_info < (3, 10):
        print(f"V necesita Python 3.10 o más reciente y tienes {sys.version.split()[0]}.")
        print(f"Descarga la versión actual en {DOWNLOAD}")
        return 1

    if not PYTHON.exists():
        print("Preparando V por primera vez. Tarda unos minutos; solo pasa una vez.\n")
        try:
            venv.create(VENV, with_pip=True)
        except Exception as exc:  # noqa: BLE001 - se explica al usuario
            print(f"No pude crear el entorno de Python: {exc}")
            print("En Linux instala el paquete python3-venv (sudo apt install python3-venv).")
            return 1

    requirements = ROOT / "requirements.txt"
    digest = hashlib.sha256(requirements.read_bytes()).hexdigest()
    if not MARKER.exists() or MARKER.read_text().strip() != digest:
        print("Instalando lo que V necesita…\n")
        pip = [str(PYTHON), "-m", "pip", "install", "--disable-pip-version-check"]
        if subprocess.call(pip + ["-r", str(requirements)]) != 0:
            print("\nLa instalación falló. Revisa tu conexión a internet y vuelve a intentarlo.")
            return 1
        MARKER.write_text(digest)

    try:
        return subprocess.call([str(PYTHON), "-m", "v", *sys.argv[1:]], cwd=ROOT)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
