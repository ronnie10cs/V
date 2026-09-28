"""Ejecuta las pruebas de la versión web (JavaScript) si Node.js está instalado."""

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js no está instalado")
def test_web_modules():
    files = sorted(str(p) for p in (ROOT / "tests" / "web").glob("*.test.mjs"))
    proc = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-2000:]
