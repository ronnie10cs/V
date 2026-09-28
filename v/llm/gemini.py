"""Proveedor Google Gemini (nivel gratuito en Google AI Studio).

Si un modelo está saturado o sin cuota, se prueba el siguiente modelo gratuito:
cada uno tiene su propia capacidad y su propio límite.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from google import genai
from google.genai import errors, types

from .base import ProviderError
from .types import Message, ToolCall, ToolSpec, is_generated_id, new_call_id

DEFAULT_MODEL = "gemini-3.8-flash"
# Modelos gratuitos, del más capaz al más ligero.
FALLBACK_MODELS = (
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
)
# Tras fallar, un modelo se deja descansar este tiempo (segundos) antes de volver a él.
COOLDOWN = 120.0


class _Busy(Exception):
    """El modelo está saturado, sin cuota o no disponible: hay que probar otro."""

    def __init__(self, message: str, quota: bool = False):
        super().__init__(message)
        self.quota = quota


class GeminiProvider:
    name = "gemini"
    retry_delay = 2.0

    def __init__(self, api_key: str, model: str = "", vision: bool | None = None):
        if not api_key:
            raise ProviderError(
                "Falta GEMINI_API_KEY. Consíguela gratis en https://aistudio.google.com/apikey"
            )
        self.client = genai.Client(api_key=api_key)
        self.model = model or DEFAULT_MODEL
        self.models = [self.model] + [m for m in FALLBACK_MODELS if m != self.model]
        self.vision = True if vision is None else vision
        self._cooldown: dict[str, float] = {}

    async def complete(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> Message:
        # Dentro de un mismo turno se sigue con el modelo que empezó: sus firmas
        # de pensamiento solo valen para él.
        pinned = _turn_model(messages)
        candidates = [pinned] if pinned else self._ordered()
        quota_only = True
        for attempt in range(2):
            for model in candidates:
                try:
                    return await self._call(model, system, messages, tools)
                except _Busy as exc:
                    quota_only = quota_only and exc.quota
                    self._cooldown[model] = time.monotonic() + COOLDOWN
            if attempt == 0:
                await asyncio.sleep(self.retry_delay)
        if quota_only:
            message = "Se agotó la cuota gratuita de Gemini por ahora. Espera un minuto y vuelve a intentarlo."
        else:
            message = ("Gemini tiene mucha demanda ahora mismo y ninguno de sus modelos gratuitos "
                       "respondió. Inténtalo de nuevo en un minuto.")
        raise ProviderError(message, retryable=True)

    def _ordered(self) -> list[str]:
        """Primero los modelos que no han fallado hace poco, en orden de preferencia."""
        now = time.monotonic()
        ready = [m for m in self.models if self._cooldown.get(m, 0) <= now]
        resting = sorted((m for m in self.models if m not in ready), key=lambda m: self._cooldown[m])
        return ready + resting

    async def _call(self, model: str, system: str, messages: list[Message], tools: list[ToolSpec]) -> Message:
        config = types.GenerateContentConfig(
            system_instruction=system,
            tools=[types.Tool(function_declarations=[_declaration(t) for t in tools])]
            if tools
            else None,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        contents = [self.to_content(m, model) for m in messages]
        try:
            response = await self.client.aio.models.generate_content(
                model=model, contents=contents, config=config
            )
        except errors.ClientError as exc:
            if exc.code == 429:
                raise _Busy("sin cuota", quota=True) from exc
            if exc.code == 404:
                raise _Busy("modelo no disponible") from exc
            if exc.code in (401, 403) or "api key" in (exc.message or "").lower():
                raise ProviderError(
                    "Tu clave de Gemini no es válida. Revísala en el archivo .env (GEMINI_API_KEY)."
                ) from exc
            raise ProviderError(f"Gemini rechazó la petición: {exc.message}") from exc
        except errors.APIError as exc:
            raise _Busy(str(exc)) from exc
        return self.from_response(response, model)

    # --- Conversión ---------------------------------------------------------

    def to_content(self, message: Message, model: str | None = None) -> types.Content:
        model = model or self.model
        if message.role == "assistant":
            raw = message.raw.get("gemini")
            if raw is not None and message.raw.get("gemini_model", model) == model:
                return raw
            parts: list[types.Part] = []
            if message.text:
                parts.append(types.Part(text=message.text))
            for call in message.tool_calls:
                parts.append(
                    types.Part(
                        function_call=types.FunctionCall(
                            id=None if is_generated_id(call.id) else call.id,
                            name=call.name,
                            args=call.args,
                        )
                    )
                )
            return types.Content(role="model", parts=parts or [types.Part(text="…")])

        parts = []
        trailing_images: list[types.Part] = []
        for output in message.tool_outputs:
            result = output.result
            key = "error" if result.is_error else "resultado"
            fn_parts = None
            if result.images and self.vision:
                # Los modelos 2.x no aceptan imágenes dentro de la respuesta de una función.
                if not model.startswith("gemini-2"):
                    fn_parts = [
                        types.FunctionResponsePart.from_bytes(data=img.data, mime_type=img.mime)
                        for img in result.images
                    ]
                else:
                    trailing_images.extend(
                        types.Part.from_bytes(data=img.data, mime_type=img.mime)
                        for img in result.images
                    )
            parts.append(
                types.Part(
                    function_response=types.FunctionResponse(
                        id=None if is_generated_id(output.call_id) else output.call_id,
                        name=output.name,
                        response={key: result.text},
                        parts=fn_parts,
                    )
                )
            )
        parts.extend(trailing_images)
        if message.text:
            parts.append(types.Part(text=message.text))
        if self.vision:
            parts.extend(
                types.Part.from_bytes(data=img.data, mime_type=img.mime) for img in message.images
            )
        return types.Content(role="user", parts=parts or [types.Part(text="…")])

    def from_response(self, response: Any, model: str | None = None) -> Message:
        candidates = getattr(response, "candidates", None) or []
        if not candidates or candidates[0].content is None:
            reason = ""
            feedback = getattr(response, "prompt_feedback", None)
            if feedback is not None and getattr(feedback, "block_reason", None):
                reason = f" ({feedback.block_reason})"
            return Message(role="assistant", text=f"[serio] No puedo responder a eso{reason}.")

        content = candidates[0].content
        text_parts: list[str] = []
        calls: list[ToolCall] = []
        for part in content.parts or []:
            if part.function_call is not None:
                fc = part.function_call
                calls.append(
                    ToolCall(id=fc.id or new_call_id(), name=fc.name or "", args=dict(fc.args or {}))
                )
            elif part.text and not part.thought:
                text_parts.append(part.text)
        return Message(
            role="assistant",
            text="".join(text_parts).strip(),
            tool_calls=calls,
            raw={"gemini": content, "gemini_model": model or self.model},
        )


def _turn_model(messages: list[Message]) -> str | None:
    """El modelo que ya respondió en el turno en curso, si lo hay."""
    for message in reversed(messages):
        if message.role == "user" and not message.tool_outputs:
            return None
        if message.role == "assistant" and message.raw.get("gemini_model"):
            return message.raw["gemini_model"]
    return None


def _declaration(spec: ToolSpec) -> types.FunctionDeclaration:
    return types.FunctionDeclaration(
        name=spec.name,
        description=spec.description,
        parameters_json_schema=spec.parameters,
    )
