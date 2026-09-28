"""Construcción del «cerebro» de V a partir de la configuración."""

from __future__ import annotations

from ..config import Settings
from .base import FallbackProvider, Provider, ProviderError
from .types import Image, Message, ToolCall, ToolOutput, ToolResult, ToolSpec

PROVIDERS = ("gemini", "groq", "openrouter", "ollama", "anthropic", "openai")

__all__ = [
    "FallbackProvider",
    "Image",
    "Message",
    "Provider",
    "ProviderError",
    "ToolCall",
    "ToolOutput",
    "ToolResult",
    "ToolSpec",
    "build_provider",
]


def _single(name: str, settings: Settings, model: str) -> Provider:
    if name == "gemini":
        from .gemini import GeminiProvider

        return GeminiProvider(settings.gemini_api_key, model, settings.vision)
    if name == "anthropic":
        from .anthropic_provider import AnthropicProvider

        return AnthropicProvider(settings.anthropic_api_key, model, settings.vision)
    if name in ("groq", "openrouter", "ollama", "openai"):
        from .openai_compat import OpenAICompatProvider

        keys = {
            "groq": settings.groq_api_key,
            "openrouter": settings.openrouter_api_key,
            "ollama": "",
            "openai": settings.openai_api_key,
        }
        base_url = settings.ollama_url if name == "ollama" else settings.openai_base_url or None
        if name in ("groq", "openrouter"):
            base_url = None
        return OpenAICompatProvider(name, keys[name], model, base_url, settings.vision)
    raise ProviderError(f"Proveedor desconocido '{name}'. Opciones: {', '.join(PROVIDERS)}")


def build_provider(settings: Settings) -> Provider:
    """El proveedor principal y, si se configuró, uno de respaldo."""
    primary = _single(settings.provider, settings, settings.model)
    if not settings.fallback or settings.fallback == settings.provider:
        return primary
    try:
        backup = _single(settings.fallback, settings, "")
    except ProviderError:
        return primary
    return FallbackProvider([primary, backup])
