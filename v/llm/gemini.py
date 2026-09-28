"""Proveedor Google Gemini (nivel gratuito en Google AI Studio)."""

from __future__ import annotations

from typing import Any

from google import genai
from google.genai import errors, types

from .base import ProviderError
from .types import Message, ToolCall, ToolSpec, is_generated_id, new_call_id

DEFAULT_MODEL = "gemini-3.8-flash"


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str = "", vision: bool | None = None):
        if not api_key:
            raise ProviderError(
                "Falta GEMINI_API_KEY. Consíguela gratis en https://aistudio.google.com/apikey"
            )
        self.client = genai.Client(api_key=api_key)
        self.model = model or DEFAULT_MODEL
        self.vision = True if vision is None else vision
        # Los modelos 2.x no aceptan imágenes dentro de la respuesta de una función.
        self._multimodal_fn_response = not self.model.startswith("gemini-2")

    async def complete(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> Message:
        config = types.GenerateContentConfig(
            system_instruction=system,
            tools=[types.Tool(function_declarations=[_declaration(t) for t in tools])]
            if tools
            else None,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        contents = [self.to_content(m) for m in messages]
        try:
            response = await self.client.aio.models.generate_content(
                model=self.model, contents=contents, config=config
            )
        except errors.ClientError as exc:
            if exc.code == 429:
                raise ProviderError(
                    "Se agotó la cuota gratuita de Gemini por ahora.", retryable=True
                ) from exc
            raise ProviderError(f"Gemini rechazó la petición: {exc.message}") from exc
        except errors.ServerError as exc:
            raise ProviderError(f"Gemini no está disponible: {exc.message}", retryable=True) from exc
        except errors.APIError as exc:
            raise ProviderError(f"Error de Gemini: {exc}", retryable=True) from exc

        return self.from_response(response)

    # --- Conversión ---------------------------------------------------------

    def to_content(self, message: Message) -> types.Content:
        if message.role == "assistant":
            raw = message.raw.get("gemini")
            if raw is not None:
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
                if self._multimodal_fn_response:
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

    def from_response(self, response: Any) -> Message:
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
            raw={"gemini": content},
        )


def _declaration(spec: ToolSpec) -> types.FunctionDeclaration:
    return types.FunctionDeclaration(
        name=spec.name,
        description=spec.description,
        parameters_json_schema=spec.parameters,
    )
