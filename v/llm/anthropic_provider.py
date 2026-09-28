"""Proveedor Anthropic Claude (de pago; opcional para quien quiera la máxima calidad)."""

from __future__ import annotations

from typing import Any

import anthropic

from .base import ProviderError
from .types import Message, ToolCall, ToolSpec

DEFAULT_MODEL = "claude-opus-5"
# Si el modelo declina una petición, el servidor la reenvía a otro modelo adecuado.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, model: str = "", vision: bool | None = None):
        if not api_key:
            raise ProviderError("Falta ANTHROPIC_API_KEY (https://console.anthropic.com).")
        self.client = anthropic.AsyncAnthropic(api_key=api_key)
        self.model = model or DEFAULT_MODEL
        self.vision = True if vision is None else vision

    async def complete(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> Message:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 16000,
            "system": system,
            "messages": self.to_messages(messages),
            "betas": [FALLBACK_BETA],
            "fallbacks": "default",
        }
        if tools:
            kwargs["tools"] = [
                {"name": t.name, "description": t.description, "input_schema": t.parameters}
                for t in tools
            ]
        try:
            response = await self.client.beta.messages.create(**kwargs)
        except anthropic.RateLimitError as exc:
            raise ProviderError("Claude: límite de uso alcanzado.", retryable=True) from exc
        except anthropic.APIStatusError as exc:
            retryable = exc.status_code >= 500
            raise ProviderError(f"Claude respondió {exc.status_code}: {exc.message}", retryable) from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError("No pude conectar con Claude.", retryable=True) from exc

        if response.stop_reason == "refusal":
            return Message(role="assistant", text="[serio] Prefiero no responder a eso.")

        text_parts: list[str] = []
        calls: list[ToolCall] = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                calls.append(ToolCall(id=block.id, name=block.name, args=dict(block.input or {})))
        raw = [block.model_dump(mode="json", exclude_none=True) for block in response.content]
        return Message(
            role="assistant",
            text="".join(text_parts).strip(),
            tool_calls=calls,
            raw={"anthropic": raw},
        )

    # --- Conversión ---------------------------------------------------------

    def to_messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for message in messages:
            if message.role == "assistant":
                raw = message.raw.get("anthropic")
                if raw is not None:
                    out.append({"role": "assistant", "content": raw})
                    continue
                content: list[dict[str, Any]] = []
                if message.text:
                    content.append({"type": "text", "text": message.text})
                for call in message.tool_calls:
                    content.append(
                        {"type": "tool_use", "id": call.id, "name": call.name, "input": call.args}
                    )
                out.append({"role": "assistant", "content": content or [{"type": "text", "text": "…"}]})
                continue

            content = []
            for output in message.tool_outputs:
                inner: list[dict[str, Any]] = [{"type": "text", "text": output.result.text or "(vacío)"}]
                if self.vision:
                    inner += [_image_block(img) for img in output.result.images]
                content.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": output.call_id,
                        "content": inner,
                        "is_error": output.result.is_error,
                    }
                )
            if self.vision:
                content += [_image_block(img) for img in message.images]
            if message.text:
                content.append({"type": "text", "text": message.text})
            out.append({"role": "user", "content": content or [{"type": "text", "text": "…"}]})
        return out


def _image_block(img) -> dict[str, Any]:
    return {"type": "image", "source": {"type": "base64", "media_type": img.mime, "data": img.b64()}}
