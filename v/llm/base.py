"""Interfaz común de proveedores y proveedor con respaldo."""

from __future__ import annotations

import logging
from typing import Protocol

from .types import Message, ToolSpec

log = logging.getLogger("v.llm")


class ProviderError(Exception):
    """Error de un proveedor. `retryable` indica que otro proveedor puede intentarlo."""

    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


class Provider(Protocol):
    name: str
    model: str
    vision: bool

    async def complete(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> Message: ...


class FallbackProvider:
    """Usa el primer proveedor y, si se queda sin cuota o falla, pasa al siguiente."""

    def __init__(self, providers: list[Provider]):
        if not providers:
            raise ValueError("Se necesita al menos un proveedor")
        self.providers = providers

    @property
    def name(self) -> str:
        return self.providers[0].name

    @property
    def model(self) -> str:
        return self.providers[0].model

    @property
    def vision(self) -> bool:
        return self.providers[0].vision

    async def complete(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> Message:
        last: ProviderError | None = None
        for provider in self.providers:
            try:
                return await provider.complete(system, messages, tools)
            except ProviderError as exc:
                last = exc
                if not exc.retryable:
                    raise
                log.warning("Proveedor %s falló (%s); probando el siguiente", provider.name, exc)
        assert last is not None
        raise last
