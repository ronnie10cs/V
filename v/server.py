"""Servidor web de V: interfaz (cara + chat), WebSocket en tiempo real y API."""

from __future__ import annotations

import logging
import re
import secrets
import sys
import time
from dataclasses import asdict
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from .agent import Agent, Speaker, addressed_to_v
from .config import WEB_DIR, Settings
from .hub import Client, Hub
from .llm import Provider, ProviderError, build_provider
from .llm.types import Image
from .notebook import Notebook
from .persona import TurnContext, speakable
from .speech import Voice
from .tools import build_registry

log = logging.getLogger("v.server")

MAX_TEXT = 4000
MAX_IMAGE_B64 = 4_000_000
PLATFORMS = {"darwin": "macOS", "win32": "Windows", "linux": "Linux"}


def _clean_name(value: str | None) -> str:
    name = re.sub(r"[\[\]<>{}·\n\r\t]", "", value or "").strip()
    return name[:24]


def _guest_name(value: str | None, owner: str) -> str:
    name = _clean_name(value) or "Invitado"
    if name.casefold() == owner.casefold():
        name = f"{name[:20]} (2)"
    return name


def create_app(settings: Settings, provider: Provider | None = None) -> FastAPI:
    settings.ensure_tokens()
    hub = Hub()
    notebook = Notebook(settings.data_dir / "cuaderno.json")
    registry, garmin = build_registry(
        settings, notebook, on_notebook_change=lambda: hub.spawn(hub.broadcast({"type": "notebook"}))
    )

    config_error = ""
    if provider is None:
        try:
            provider = build_provider(settings)
        except ProviderError as exc:
            config_error = str(exc)
            log.error("Sin cerebro: %s", exc)

    voice = Voice(settings.voice, settings.voice_rate, settings.voice_pitch)
    agent = Agent(provider, registry, settings, senses=hub, confirmer=hub.confirm,
                  emit=hub.broadcast) if provider else None

    app = FastAPI(title="V", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.hub = hub
    app.state.agent = agent
    app.state.notebook = notebook
    app.state.voice = voice

    def role_for(token: str) -> str | None:
        if token and secrets.compare_digest(token, settings.owner_token):
            return "owner"
        if token and secrets.compare_digest(token, settings.guest_token):
            return "guest"
        return None

    def require(request: Request) -> str:
        auth = request.headers.get("authorization", "")
        token = auth.removeprefix("Bearer ").strip() or request.query_params.get("t", "")
        role = role_for(token)
        if role is None:
            raise HTTPException(401, "Token inválido")
        return role

    # --- Páginas y archivos -------------------------------------------------

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/manifest.webmanifest")
    async def manifest(t: str = "") -> JSONResponse:
        # Con un token válido, la app instalada en el iPhone abre ya con la sesión iniciada
        # (en iOS la app de la pantalla de inicio no comparte datos con Safari).
        start = f"/?t={t}" if role_for(t) else "/"
        icons = [
            {"src": "/static/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/static/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "/static/icon.svg", "sizes": "any", "type": "image/svg+xml"},
        ]
        return JSONResponse(
            {"name": "V", "short_name": "V", "start_url": start, "scope": "/", "display": "standalone",
             "orientation": "any", "background_color": "#07090f", "theme_color": "#07090f", "icons": icons},
            media_type="application/manifest+json",
        )

    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.get("/api/audio/{audio_id}")
    async def audio(audio_id: str) -> Response:
        data = voice.get(audio_id)
        if data is None:
            raise HTTPException(404, "Audio caducado")
        return Response(data, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=600"})

    @app.get("/api/estado")
    async def estado(request: Request) -> JSONResponse:
        role = require(request)
        return JSONResponse({
            "rol": role,
            "proveedor": getattr(provider, "name", None),
            "modelo": getattr(provider, "model", None),
            "error_config": config_error,
            "modo": agent.mode if agent else None,
            "garmin": garmin.configured,
            "voz": settings.voice,
            "herramientas": registry.names(),
        })

    @app.get("/api/cuaderno")
    async def cuaderno(request: Request) -> JSONResponse:
        require(request)
        return JSONResponse([asdict(h) for h in notebook.all()])

    @app.get("/api/cuaderno.md")
    async def cuaderno_md(request: Request) -> PlainTextResponse:
        require(request)
        return PlainTextResponse(
            notebook.to_markdown(), media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="cuaderno-v.md"'},
        )

    # --- Tiempo real --------------------------------------------------------

    def turn_context() -> TurnContext:
        owners = hub.owners()
        return TurnContext(
            owner=settings.owner_name,
            participants=hub.names(),
            camera_on=any(c.camera for c in owners),
            hands_on=any(c.hands for c in owners),
            garmin_ready=garmin.configured,
            platform=PLATFORMS.get(sys.platform, sys.platform),
        )

    async def process(client: Client, text: str, images: list[Image]) -> None:
        assert agent is not None
        await hub.broadcast({"type": "state", "state": "thinking"})
        try:
            reply = await agent.respond(Speaker(client.name, client.role), text, images, turn_context())
        except Exception:  # noqa: BLE001 - la conversación sigue aunque algo falle
            log.exception("Fallo inesperado al responder")
            await hub.broadcast({"type": "state", "state": "idle"})
            await hub.broadcast({"type": "error", "text": "Algo falló dentro de V; revisa la consola."})
            return
        audio_id = await voice.synthesize(speakable(reply.text))
        entry = {
            "from": "V", "role": "v", "text": reply.text, "mood": reply.mood,
            "tools": reply.tools, "ts": time.time(), "error": reply.error,
        }
        hub.transcript.append(entry)
        await hub.broadcast({
            "type": "reply", **entry,
            "audio": f"/api/audio/{audio_id}" if audio_id else None,
            "speech": speakable(reply.text),
        })
        if not agent.busy:
            await hub.broadcast({"type": "state", "state": "idle"})

    async def on_message(client: Client, msg: dict[str, Any]) -> None:
        text = str(msg.get("text") or "").strip()[:MAX_TEXT]
        image_b64 = msg.get("image")
        images: list[Image] = []
        if isinstance(image_b64, str) and 0 < len(image_b64) <= MAX_IMAGE_B64:
            try:
                images.append(Image.from_b64(image_b64))
            except (ValueError, TypeError):
                pass
        if not text and not images:
            return
        entry = {"from": client.name, "role": client.role, "text": text or "(imagen)",
                 "ts": time.time(), "image": bool(images)}
        hub.transcript.append(entry)
        await hub.broadcast({"type": "chat", **entry})

        if agent is None:
            await hub.send(client, {"type": "error", "text": f"V no tiene cerebro configurado: {config_error}"})
            return
        ask = bool(msg.get("ask")) or agent.mode != "debate" or addressed_to_v(text)
        if not ask:
            agent.note(Speaker(client.name, client.role), text)
            return
        hub.spawn(process(client, text or "Mira esta imagen.", images))

    async def on_owner_command(client: Client, kind: str, msg: dict[str, Any]) -> None:
        if agent is None:
            return
        if kind == "set_mode" and msg.get("mode") in ("asistente", "debate"):
            agent.mode = msg["mode"]
            await hub.broadcast({"type": "mode", "mode": agent.mode})
        elif kind == "reset":
            agent.reset()
            hub.transcript.clear()
            await hub.broadcast({"type": "reset"})

    @app.websocket("/ws")
    async def websocket(ws: WebSocket) -> None:
        role = role_for(ws.query_params.get("t", ""))
        if role is None:
            await ws.close(code=4401)
            return
        await ws.accept()
        raw_name = ws.query_params.get("nombre")
        if role == "owner":
            name = _clean_name(raw_name) or settings.owner_name
        else:
            name = _guest_name(raw_name, settings.owner_name)
        client = hub.add(ws, name, role)
        welcome: dict[str, Any] = {
            "type": "welcome", "id": client.id, "role": role, "name": name,
            "owner": settings.owner_name, "mode": agent.mode if agent else "asistente",
            "transcript": list(hub.transcript), "lang": settings.lang,
            "provider": f"{getattr(provider, 'name', '—')} · {getattr(provider, 'model', '')}",
            "config_error": config_error, "busy": bool(agent and agent.busy),
        }
        if role == "owner":
            welcome["guest_token"] = settings.guest_token
        await hub.send(client, welcome)
        await hub.broadcast_participants()

        try:
            while True:
                msg = await ws.receive_json()
                if not isinstance(msg, dict):
                    continue
                kind = msg.get("type")
                if kind == "message":
                    await on_message(client, msg)
                elif kind == "status":
                    if "name" in msg and _clean_name(msg.get("name")):
                        client.name = (_clean_name(msg["name"]) if client.is_owner
                                       else _guest_name(msg["name"], settings.owner_name))
                    if "camera" in msg:
                        client.camera = bool(msg["camera"])
                        client.camera_since = time.time() if client.camera else 0.0
                    if "hands" in msg:
                        client.hands = bool(msg["hands"])
                    if "device" in msg:
                        client.device = str(msg["device"])[:40]
                    await hub.broadcast_participants()
                elif kind == "frame_response":
                    hub.resolve(msg.get("id", ""), msg.get("image"), client)
                elif kind == "confirm_response" and client.is_owner:
                    hub.resolve(msg.get("id", ""), bool(msg.get("approved")), client)
                elif kind == "hands" and client.is_owner:
                    hub.update_hands(msg)
                elif kind in ("set_mode", "reset") and client.is_owner:
                    await on_owner_command(client, kind, msg)
                elif kind == "ping":
                    await hub.send(client, {"type": "pong"})
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001
            log.exception("Error en la conexión de %s", client.name)
        finally:
            hub.remove(client)
            await hub.broadcast_participants()

    return app
