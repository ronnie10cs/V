"""Arranca V: la primera vez prepara todo lo necesario y después abre V.

Uso: doble clic en «iniciar-windows.bat» o «iniciar-mac.command», o bien
`python3 iniciar.py` en una terminal. Los argumentos se pasan a `python -m v`.

`python3 iniciar.py actualizar` (o doble clic en «actualizar-…») descarga la
última versión de V sin tocar tu configuración (.env), tus datos ni el entorno.
"""

import hashlib
import io
import os
import subprocess
import sys
import urllib.request
import venv
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
MARKER = VENV / ".requisitos-instalados"
DOWNLOAD = "https://www.python.org/downloads/"
REPO_ZIP = "https://github.com/ronnie10cs/V/archive/HEAD.zip"
KEEP = {".env", "datos", ".venv", ".git"}


def update() -> int:
    if (ROOT / ".git").exists():
        print("Esta carpeta es un repositorio git: actualízala con `git pull`.")
        return 0
    print("Descargando la última versión de V…")
    try:
        with urllib.request.urlopen(REPO_ZIP, timeout=120) as response:
            data = response.read()
    except Exception as exc:  # noqa: BLE001 - se explica al usuario
        print(f"No pude descargar la actualización: {exc}")
        return 1
    changed = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            _, _, rel = info.filename.partition("/")
            if not rel or info.is_dir() or rel.split("/")[0] in KEEP:
                continue
            target = (ROOT / rel).resolve()
            if ROOT not in target.parents:
                continue
            content = archive.read(info)
            if target.exists() and target.read_bytes() == content:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            mode = (info.external_attr >> 16) & 0o777
            if os.name != "nt" and mode & 0o111:
                target.chmod(mode)
            changed += 1
    print(f"Listo: {changed} archivo(s) actualizados. Tu clave y tus datos siguen intactos."
          if changed else "V ya estaba al día.")
    return 0


def main() -> int:
    if sys.argv[1:2] == ["actualizar"]:
        return update()
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
