"""Conexiones en tiempo real: dispositivos del dueño, invitados, cámara, manos y confirmaciones."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from .llm.types import Image

log = logging.getLogger("v.hub")


@dataclass
class Client:
    id: str
    ws: Any
    name: str
    role: str
    camera: bool = False
    camera_since: float = 0.0
    hands: bool = False
    device: str = ""
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "role": self.role, "camera": self.camera,
                "hands": self.hands, "device": self.device}


class Hub:
    def __init__(self, transcript_size: int = 200):
        self.clients: dict[str, Client] = {}
        self.transcript: deque[dict[str, Any]] = deque(maxlen=transcript_size)
        self.hands_state: dict[str, Any] | None = None
        self.hands_history: deque[dict[str, Any]] = deque(maxlen=30)
        self._pending: dict[str, tuple[asyncio.Future, set[str]]] = {}
        self._tasks: set[asyncio.Task] = set()

    # --- Clientes -----------------------------------------------------------

    def add(self, ws: Any, name: str, role: str) -> Client:
        client = Client(id=uuid.uuid4().hex[:10], ws=ws, name=name, role=role)
        self.clients[client.id] = client
        return client

    def remove(self, client: Client) -> None:
        self.clients.pop(client.id, None)
        for future, allowed in list(self._pending.values()):
            allowed.discard(client.id)
            if not allowed and not future.done():
                future.set_result(None)

    def owners(self) -> list[Client]:
        return [c for c in self.clients.values() if c.is_owner]

    def participants(self) -> list[dict[str, Any]]:
        return [c.public() for c in self.clients.values()]

    def names(self) -> list[str]:
        seen: list[str] = []
        for client in self.clients.values():
            label = client.name + (" (dueño)" if client.is_owner else " (invitado)")
            if label not in seen:
                seen.append(label)
        return seen

    # --- Envío --------------------------------------------------------------

    async def send(self, client: Client, message: dict[str, Any]) -> None:
        try:
            async with client.lock:
                await client.ws.send_json(message)
        except Exception:  # noqa: BLE001 - un cliente caído no debe afectar al resto
            log.debug("No se pudo enviar a %s", client.name)

    async def broadcast(self, message: dict[str, Any], owners_only: bool = False) -> None:
        targets = self.owners() if owners_only else list(self.clients.values())
        await asyncio.gather(*(self.send(c, message) for c in targets))

    async def broadcast_participants(self) -> None:
        await self.broadcast({"type": "participants", "participants": self.participants()})

    def spawn(self, coro) -> asyncio.Task:
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    # --- Peticiones con respuesta ------------------------------------------

    async def request(self, targets: list[Client], message: dict[str, Any], timeout: float) -> Any:
        if not targets:
            return None
        req_id = uuid.uuid4().hex
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[req_id] = (future, {c.id for c in targets})
        try:
            await asyncio.gather(*(self.send(c, {**message, "id": req_id}) for c in targets))
            return await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            self._pending.pop(req_id, None)

    def resolve(self, req_id: str, value: Any, client: Client) -> bool:
        entry = self._pending.get(str(req_id))
        if entry is None:
            return False
        future, allowed = entry
        if client.id not in allowed or future.done():
            return False
        future.set_result(value)
        return True

    # --- Confirmaciones (Agent.confirmer) -----------------------------------

    async def confirm(self, tool: Any, summary: str, speaker: Any) -> bool:
        owners = self.owners()
        answer = await self.request(
            owners,
            {"type": "confirm_request", "tool": tool.name, "summary": summary,
             "requested_by": getattr(speaker, "name", "")},
            timeout=60,
        )
        await self.broadcast({"type": "confirm_closed"}, owners_only=True)
        return answer is True

    # --- Sentidos (tools.base.Senses) --------------------------------------

    async def request_camera_frame(self, timeout: float = 8.0) -> Image | None:
        cams = sorted((c for c in self.owners() if c.camera), key=lambda c: c.camera_since)
        if not cams:
            return None
        data = await self.request([cams[-1]], {"type": "frame_request"}, timeout)
        if not isinstance(data, str) or not data:
            return None
        try:
            return Image.from_b64(data)
        except (ValueError, TypeError):
            return None

    def update_hands(self, data: dict[str, Any]) -> None:
        hands = data.get("hands") if isinstance(data.get("hands"), list) else []
        clean = []
        for hand in hands[:2]:
            if not isinstance(hand, dict):
                continue
            clean.append({
                "gesture": str(hand.get("gesture", "None"))[:24],
                "handedness": str(hand.get("handedness", "?"))[:12],
                "fingers": int(_num(hand.get("fingers")) or 0),
                "x": _num(hand.get("x")),
                "y": _num(hand.get("y")),
                "speed": _num(hand.get("speed")),
            })
        now = time.strftime("%H:%M:%S")
        previous = self.hands_state or {}
        self.hands_state = {"at": now, "hands": clean}
        gestures = [h["gesture"] for h in clean if h["gesture"] != "None"]
        old = [h["gesture"] for h in previous.get("hands", []) if h["gesture"] != "None"]
        if gestures and gestures != old:
            self.hands_history.append({"at": now, "gestos": gestures})

    def hands_snapshot(self) -> dict[str, Any] | None:
        if not any(c.hands for c in self.owners()):
            return None
        return {"current": self.hands_state, "history": list(self.hands_history)}


def _num(value: Any) -> float | None:
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return None
