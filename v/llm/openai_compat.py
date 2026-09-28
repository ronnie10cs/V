"""Proveedores con API compatible con OpenAI: Groq, OpenRouter, Ollama (local) y otros."""

from __future__ import annotations

import json
from typing import Any

import openai
from openai import AsyncOpenAI

from .base import ProviderError
from .types import Message, ToolCall, ToolSpec, new_call_id

PRESETS: dict[str, dict[str, Any]] = {
    # Gratis con límites; muy rápido. gpt-oss no tiene visión.
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model": "openai/gpt-oss-120b",
        "vision": False,
        "key_hint": "GROQ_API_KEY (gratis en https://console.groq.com/keys)",
    },
    # Pasarela a muchos modelos; los que terminan en ':free' no cuestan.
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "model": "openrouter/free",
        "vision": True,
        "key_hint": "OPENROUTER_API_KEY (https://openrouter.ai/keys)",
    },
    # Totalmente local y privado: nada sale de tu equipo.
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "model": "qwen3-vl",
        "vision": True,
        "key_hint": "",
    },
    # Cualquier otro servidor compatible (LM Studio, vLLM, OpenAI…).
    "openai": {
        "base_url": None,
        "model": "",
        "vision": True,
        "key_hint": "OPENAI_API_KEY",
    },
}


class OpenAICompatProvider:
    def __init__(
        self,
        name: str,
        api_key: str,
        model: str = "",
        base_url: str | None = None,
        vision: bool | None = None,
    ):
        preset = PRESETS.get(name, PRESETS["openai"])
        if not api_key:
            if name == "ollama":
                api_key = "ollama"
            else:
                raise ProviderError(f"Falta la clave de API: {preset['key_hint']}")
        self.name = name
        self.model = model or preset["model"]
        if not self.model:
            raise ProviderError(f"Define V_MODEL para el proveedor '{name}'.")
        self.vision = preset["vision"] if vision is None else vision
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url or preset["base_url"])

    async def complete(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> Message:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}] + self.to_messages(messages),
        }
        if tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                }
                for t in tools
            ]
        try:
            response = await self.client.chat.completions.create(**payload)
        except openai.RateLimitError as exc:
            raise ProviderError(f"{self.name}: límite de uso alcanzado.", retryable=True) from exc
        except openai.APIStatusError as exc:
            retryable = exc.status_code >= 500
            raise ProviderError(f"{self.name} respondió {exc.status_code}: {exc.message}", retryable) from exc
        except openai.APIConnectionError as exc:
            raise ProviderError(f"No pude conectar con {self.name}.", retryable=True) from exc

        choice = response.choices[0].message
        calls = []
        for tc in choice.tool_calls or []:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            calls.append(ToolCall(id=tc.id or new_call_id(), name=tc.function.name, args=args))
        return Message(role="assistant", text=(choice.content or "").strip(), tool_calls=calls)

    # --- Conversión ---------------------------------------------------------

    def to_messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for message in messages:
            if message.role == "assistant":
                entry: dict[str, Any] = {"role": "assistant", "content": message.text or None}
                if message.tool_calls:
                    entry["tool_calls"] = [
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {"name": call.name, "arguments": json.dumps(call.args)},
                        }
                        for call in message.tool_calls
                    ]
                elif not message.text:
                    entry["content"] = "…"
                out.append(entry)
                continue

            tool_images = []
            for output in message.tool_outputs:
                text = output.result.text
                if output.result.is_error:
                    text = f"ERROR: {text}"
                out.append({"role": "tool", "tool_call_id": output.call_id, "content": text})
                tool_images.extend(output.result.images)

            images = tool_images + message.images
            text = message.text
            if tool_images and not message.text:
                text = "(Imágenes devueltas por las herramientas.)"
            if not text and not images:
                continue
            if images and self.vision:
                content: Any = [{"type": "text", "text": text}] if text else []
                content += [{"type": "image_url", "image_url": {"url": img.data_url()}} for img in images]
            else:
                if images:
                    text = f"{text}\n[Imagen omitida: este modelo no tiene visión]".strip()
                content = text
            out.append({"role": "user", "content": content})
        return out
