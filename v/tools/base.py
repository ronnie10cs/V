"""Registro de herramientas (las «manos» de V) y su contexto de ejecución."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol

from ..llm.types import Image, ToolResult, ToolSpec


class Senses(Protocol):
    """Lo que el servidor ofrece a las herramientas: cámara y manos de los clientes."""

    async def request_camera_frame(self, timeout: float = 8.0) -> Image | None: ...

    def hands_snapshot(self) -> dict[str, Any] | None: ...


@dataclass
class ToolContext:
    speaker: str
    role: str  # "owner" | "guest"
    senses: Senses | None = None
    extra: dict[str, Any] = field(default_factory=dict)


Handler = Callable[[dict[str, Any], ToolContext], Awaitable["ToolResult | str"]]


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Handler
    # Pide confirmación antes de ejecutarse (según V_CONFIRM).
    sensitive: bool = False
    # Pide confirmación siempre, aunque V_CONFIRM=nada (p. ej. la terminal).
    always_confirm: bool = False
    # Los invitados de un debate solo pueden usar herramientas con guest_ok=True.
    guest_ok: bool = False
    # Texto legible para el diálogo de confirmación.
    describe: Callable[[dict[str, Any]], str] | None = None

    def spec(self) -> ToolSpec:
        return ToolSpec(self.name, self.description, self.parameters)

    def summary(self, args: dict[str, Any]) -> str:
        if self.describe:
            try:
                return self.describe(args)
            except Exception:  # noqa: BLE001 - la descripción nunca debe romper nada
                pass
        return f"{self.name}({json.dumps(args, ensure_ascii=False)[:200]})"


def schema(properties: dict[str, Any] | None = None, required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "properties": properties or {}, "required": required or []}


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def add(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def extend(self, tools: list[Tool]) -> None:
        for tool in tools:
            self.add(tool)

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return list(self._tools)

    def available(self, role: str) -> list[Tool]:
        return [t for t in self._tools.values() if role == "owner" or t.guest_ok]

    async def run(self, name: str, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult(f"La herramienta '{name}' no existe.", is_error=True)
        if ctx.role != "owner" and not tool.guest_ok:
            return ToolResult(
                f"{ctx.speaker} es invitado y no puede usar '{name}'.", is_error=True
            )
        try:
            result = await tool.handler(args, ctx)
        except ToolError as exc:
            return ToolResult(str(exc), is_error=True)
        except Exception as exc:  # noqa: BLE001 - el error se le devuelve al modelo
            return ToolResult(f"Falló {name}: {type(exc).__name__}: {exc}", is_error=True)
        if isinstance(result, str):
            return ToolResult(result)
        return result


class ToolError(Exception):
    """Error esperado y explicable que se devuelve tal cual al modelo."""


def compact_json(data: Any, limit: int = 6000) -> str:
    text = json.dumps(data, ensure_ascii=False, default=str, separators=(",", ":"))
    if len(text) > limit:
        text = text[:limit] + "…(recortado)"
    return text
