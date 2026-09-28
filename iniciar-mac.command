#!/bin/bash
# Doble clic para arrancar V en macOS.
cd "$(dirname "$0")" || exit 1
PY=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
    PY="$candidate"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "V necesita Python 3.10 o más reciente."
  echo "Descárgalo en https://www.python.org/downloads/ , instálalo y vuelve a abrir este archivo."
  read -r -p "Pulsa Enter para cerrar."
  exit 1
fi
"$PY" iniciar.py "$@"
