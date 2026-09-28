#!/bin/bash
# Doble clic para actualizar V en macOS (conserva tu clave y tus datos).
cd "$(dirname "$0")" || exit 1
python3 iniciar.py actualizar
echo
read -r -p "Pulsa Enter para cerrar y abre V con iniciar-mac.command."
