"""Formato neutral de mensajes, independiente del proveedor de IA."""

from __future__ import annotations

import base64
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class Image:
    data: bytes
    mime: str = "image/jpeg"

    def b64(self) -> str:
        return base64.b64encode(self.data).decode("ascii")

    def data_url(self) -> str:
        return f"data:{self.mime};base64,{self.b64()}"

    @classmethod
    def from_b64(cls, value: str, mime: str = "image/jpeg") -> "Image":
        if value.startswith("data:"):
            header, _, value = value.partition(",")
            mime = header[5:].split(";")[0] or mime
        return cls(data=base64.b64decode(value), mime=mime)


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolResult:
    text: str
    images: list[Image] = field(default_factory=list)
    is_error: bool = False


@dataclass
class ToolOutput:
    """Resultado de una llamada concreta, listo para devolverlo al modelo."""

    call_id: str
    name: str
    result: ToolResult


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class Message:
    role: Literal["user", "assistant"]
    text: str = ""
    images: list[Image] = field(default_factory=list)
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_outputs: list[ToolOutput] = field(default_factory=list)
    # Contenido original del proveedor (firmas de pensamiento, etc.). Solo se
    # reutiliza dentro del turno en curso; al empezar un turno nuevo se borra.
    raw: dict[str, Any] = field(default_factory=dict)


def new_call_id() -> str:
    """Id para llamadas cuyo proveedor no asigna uno (prefijo reconocible)."""
    return f"v_{uuid.uuid4().hex[:12]}"


def is_generated_id(call_id: str) -> bool:
    return call_id.startswith("v_")
