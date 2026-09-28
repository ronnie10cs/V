"""El bucle de conversación de V: piensa, usa herramientas y responde."""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol

from .config import Settings
from .llm import Message, Provider, ProviderError, ToolCall, ToolOutput, ToolResult
from .llm.types import Image
from .persona import TurnContext, split_mood, system_prompt
from .tools import Tool, ToolContext, ToolRegistry
from .tools.base import Senses

log = logging.getLogger("v.agent")

MAX_STEPS = 10
# Mensajes con imágenes que se conservan; las más antiguas se sustituyen por una nota.
KEEP_IMAGE_MESSAGES = 2

_ADDRESSED_RE = re.compile(r"(^|[\s,.;:¡¿!?\"'(])v([\s,.;:!?\"')]|$)", re.IGNORECASE)
_FAKE_LABEL_RE = re.compile(r"^\s*\[([^\]\n]{1,40})\]\s*:", re.MULTILINE)


def label(speaker: "Speaker", text: str) -> str:
    """«[Nombre]: texto», neutralizando etiquetas falsas dentro del propio texto."""
    clean = _FAKE_LABEL_RE.sub(r"(\1):", text)
    who = speaker.name if speaker.role == "owner" else f"{speaker.name} · invitado"
    return f"[{who}]: {clean}"


def addressed_to_v(text: str) -> bool:
    """¿Alguien se dirige a V? («V, ¿qué opinas?», «oye v», «…verdad, V?»)."""
    return bool(_ADDRESSED_RE.search(text or ""))


@dataclass
class Speaker:
    name: str
    role: str = "owner"  # "owner" | "guest"


@dataclass
class Reply:
    text: str
    mood: str = "neutral"
    tools: list[str] = field(default_factory=list)
    error: bool = False


class Confirmer(Protocol):
    async def __call__(self, tool: Tool, summary: str, speaker: Speaker) -> bool: ...


EventSink = Callable[[dict[str, Any]], Awaitable[None]]


async def _no_events(event: dict[str, Any]) -> None:
    return None


class Agent:
    def __init__(
        self,
        provider: Provider,
        registry: ToolRegistry,
        settings: Settings,
        senses: Senses | None = None,
        confirmer: Confirmer | None = None,
        emit: EventSink | None = None,
    ):
        self.provider = provider
        self.registry = registry
        self.settings = settings
        self.senses = senses
        self.confirmer = confirmer
        self.emit = emit or _no_events
        self.history: list[Message] = []
        self.pending_notes: list[str] = []
        self.mode = "asistente"
        self._lock = asyncio.Lock()

    @property
    def busy(self) -> bool:
        return self._lock.locked()

    def reset(self) -> None:
        self.history.clear()
        self.pending_notes.clear()

    def note(self, speaker: Speaker, text: str) -> None:
        """Registra lo que alguien dice sin pedir respuesta (V escucha el debate)."""
        self.pending_notes.append(label(speaker, text))
        del self.pending_notes[:-40]

    async def respond(
        self,
        speaker: Speaker,
        text: str,
        images: list[Image] | None = None,
        turn: TurnContext | None = None,
    ) -> Reply:
        async with self._lock:
            self._compact()
            start = len(self.history)
            content = "\n".join(self.pending_notes + [label(speaker, text)])
            self.history.append(Message("user", text=content, images=list(images or [])))
            turn = turn or TurnContext(owner=self.settings.owner_name, mode=self.mode)
            turn.mode = self.mode
            system = system_prompt(turn)
            specs = [t.spec() for t in self.registry.available(speaker.role)]
            used: list[str] = []

            try:
                reply = await self._loop(system, specs, speaker, used)
            except ProviderError as exc:
                # Se deshace el turno para que el historial quede bien formado.
                del self.history[start:]
                if used:
                    self.pending_notes.append(
                        f"(Sistema: la respuesta anterior falló, pero ya se ejecutaron: {', '.join(used)}.)"
                    )
                log.warning("Error del proveedor: %s", exc)
                return Reply(f"Mis disculpas: {exc}", mood="preocupado", tools=used, error=True)

            self.pending_notes.clear()
            mood, clean = split_mood(reply.text)
            return Reply(clean or "Hecho.", mood=mood, tools=used)

    async def _loop(self, system: str, specs, speaker: Speaker, used: list[str]) -> Message:
        for _ in range(MAX_STEPS):
            reply = await self.provider.complete(system, self.history, specs)
            self.history.append(reply)
            if not reply.tool_calls:
                return reply
            outputs = []
            for call in reply.tool_calls:
                used.append(call.name)
                result = await self._run_tool(call, speaker)
                outputs.append(ToolOutput(call.id, call.name, result))
            self.history.append(Message("user", tool_outputs=outputs))

        # Demasiados pasos: se cierra el turno sin otra llamada al modelo.
        final = Message(
            "assistant",
            text="[pensativo] He encadenado muchas acciones seguidas y me detengo aquí. "
            "¿Quieres que continúe?",
        )
        self.history.append(final)
        return final

    async def _run_tool(self, call: ToolCall, speaker: Speaker) -> ToolResult:
        tool = self.registry.get(call.name)
        summary = tool.summary(call.args) if tool else call.name
        await self.emit({"type": "tool", "name": call.name, "summary": summary, "status": "start"})

        if tool and speaker.role != "owner" and not tool.guest_ok:
            # Ni siquiera se molesta al dueño con una confirmación.
            result = await self.registry.run(call.name, call.args,
                                             ToolContext(speaker=speaker.name, role=speaker.role))
            await self.emit({"type": "tool", "name": call.name, "summary": summary, "status": "denied"})
            return result

        if tool and self._needs_confirmation(tool):
            approved = False
            if self.confirmer is not None:
                await self.emit({"type": "state", "state": "confirm"})
                approved = await self.confirmer(tool, summary, speaker)
                await self.emit({"type": "state", "state": "thinking"})
            if not approved:
                await self.emit({"type": "tool", "name": call.name, "summary": summary, "status": "denied"})
                return ToolResult(
                    f"{self.settings.owner_name} no autorizó esta acción; no se ejecutó.", is_error=True
                )

        ctx = ToolContext(speaker=speaker.name, role=speaker.role, senses=self.senses)
        result = await self.registry.run(call.name, call.args, ctx)
        await self.emit({
            "type": "tool", "name": call.name, "summary": summary,
            "status": "error" if result.is_error else "ok",
            "detail": result.text[:300] if result.is_error else "",
        })
        return result

    def _needs_confirmation(self, tool: Tool) -> bool:
        if tool.always_confirm:
            return True
        mode = self.settings.confirm
        if mode == "nada":
            return False
        if mode == "todo":
            return True
        return tool.sensitive

    def _compact(self) -> None:
        """Se ejecuta al empezar cada turno; dentro del turno el historial solo crece."""
        for message in self.history:
            message.raw = {}

        seen = 0
        for message in reversed(self.history):
            holders = [message] + [o.result for o in message.tool_outputs]
            if not any(h.images for h in holders):
                continue
            seen += 1
            if seen <= KEEP_IMAGE_MESSAGES:
                continue
            for holder in holders:
                if holder.images:
                    note = f"({len(holder.images)} imagen(es) anterior(es) omitida(s))"
                    holder.images = []
                    holder.text = f"{holder.text}\n{note}".strip()

        limit = max(4, self.settings.max_history)
        if len(self.history) > limit:
            cut = len(self.history) - limit
            # El historial debe empezar con un mensaje del usuario que no sea un resultado.
            while cut < len(self.history) and not (
                self.history[cut].role == "user" and not self.history[cut].tool_outputs
            ):
                cut += 1
            del self.history[:cut]
