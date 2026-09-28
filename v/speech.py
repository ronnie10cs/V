"""Voz de V con las voces neuronales gratuitas de Microsoft Edge (edge-tts).

Si no hay conexión o falla, la interfaz usa la voz del navegador como respaldo.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections import OrderedDict

log = logging.getLogger("v.speech")

# Voces recomendadas (elegantes y claras). Lista completa: `edge-tts --list-voices`.
VOICES = {
    "es-MX-JorgeNeural": "Jorge (México), masculina, cálida",
    "es-ES-AlvaroNeural": "Álvaro (España), masculina, sobria",
    "es-AR-TomasNeural": "Tomás (Argentina), masculina",
    "es-CO-GonzaloNeural": "Gonzalo (Colombia), masculina",
    "es-MX-DaliaNeural": "Dalia (México), femenina",
    "es-ES-ElviraNeural": "Elvira (España), femenina",
}


class Voice:
    def __init__(self, voice: str, rate: str = "+0%", pitch: str = "+0Hz", cache_size: int = 24):
        self.voice = voice
        self.rate = rate
        self.pitch = pitch
        self._cache: OrderedDict[str, bytes] = OrderedDict()
        self._cache_size = cache_size
        self.available = True

    async def synthesize(self, text: str) -> str | None:
        """Genera el audio y devuelve su id, o None si no se pudo."""
        if not self.available or not text.strip():
            return None
        try:
            import edge_tts
        except ImportError:
            self.available = False
            return None
        audio = bytearray()

        async def collect() -> None:
            communicate = edge_tts.Communicate(text, self.voice, rate=self.rate, pitch=self.pitch)
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio":
                    audio.extend(chunk["data"])

        try:
            await asyncio.wait_for(collect(), timeout=15)
        except Exception as exc:  # noqa: BLE001 - la voz nunca debe tumbar una respuesta
            log.warning("No se pudo sintetizar la voz: %s", exc)
            return None
        if not audio:
            return None
        audio_id = uuid.uuid4().hex
        self._cache[audio_id] = bytes(audio)
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return audio_id

    def get(self, audio_id: str) -> bytes | None:
        return self._cache.get(audio_id)
