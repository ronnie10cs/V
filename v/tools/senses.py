"""Sentidos de V: la cámara y el seguimiento de manos del dispositivo conectado."""

from __future__ import annotations

from typing import Any

from ..llm.types import ToolResult
from .base import Tool, ToolContext, ToolError, compact_json, schema

GESTURE_NAMES = {
    "Thumb_Up": "pulgar arriba 👍",
    "Thumb_Down": "pulgar abajo 👎",
    "Open_Palm": "palma abierta ✋",
    "Closed_Fist": "puño cerrado ✊",
    "Pointing_Up": "índice arriba ☝️",
    "Victory": "victoria ✌️",
    "ILoveYou": "te quiero 🤟",
    "None": "sin gesto reconocido",
}


def build_senses_tools() -> list[Tool]:
    async def ver_camara(args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        if ctx.senses is None:
            raise ToolError("No hay ningún dispositivo conectado.")
        frame = await ctx.senses.request_camera_frame()
        if frame is None:
            raise ToolError(
                "La cámara no está encendida. Pide que la activen con el botón 📷 de la interfaz."
            )
        return ToolResult("Imagen actual de la cámara.", images=[frame])

    async def ver_manos(args: dict[str, Any], ctx: ToolContext) -> str:
        if ctx.senses is None:
            raise ToolError("No hay ningún dispositivo conectado.")
        snap = ctx.senses.hands_snapshot()
        if not snap:
            raise ToolError(
                "El seguimiento de manos está apagado. Se activa con el botón ✋ (requiere la cámara)."
            )
        current = snap.get("current") or {}
        hands = current.get("hands") or []
        lines = []
        if not hands:
            lines.append("Ahora mismo no veo ninguna mano.")
        for hand in hands:
            gesture = GESTURE_NAMES.get(hand.get("gesture", "None"), hand.get("gesture"))
            lines.append(
                f"Mano {hand.get('handedness', '?')}: {gesture}, {hand.get('fingers', '?')} dedos "
                f"extendidos, posición x={hand.get('x')}, y={hand.get('y')} "
                f"(0-1, origen arriba a la izquierda), velocidad {hand.get('speed', 0)}."
            )
        history = snap.get("history") or []
        if history:
            lines.append("Gestos recientes: " + compact_json(history[-12:], 1500))
        return "\n".join(lines)

    return [
        Tool("ver_camara",
             "Toma una foto con la cámara del dispositivo del dueño (móvil u ordenador) y te la "
             "muestra. Úsala cuando te pidan mirar algo, a alguien o un experimento.",
             schema(), ver_camara),
        Tool("ver_manos",
             "Lee el seguimiento de manos en tiempo real: gesto, dedos extendidos, posición, "
             "velocidad y gestos recientes.",
             schema(), ver_manos),
    ]
