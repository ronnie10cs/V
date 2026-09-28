"""Configuración de V, leída de variables de entorno (y del archivo .env)."""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"

CONFIRM_MODES = ("todo", "sensibles", "nada")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, "").strip() or default


def _env_bool(name: str, default: bool) -> bool:
    value = _env(name)
    if not value:
        return default
    return value.lower() in ("1", "true", "si", "sí", "yes", "on")


@dataclass
class Settings:
    # Cerebro
    provider: str = "gemini"
    model: str = ""
    fallback: str = ""
    gemini_api_key: str = ""
    groq_api_key: str = ""
    openrouter_api_key: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    openai_base_url: str = ""
    ollama_url: str = "http://localhost:11434/v1"
    vision: bool | None = None

    # Personalidad y voz
    owner_name: str = "Investigador"
    voice: str = "es-MX-JorgeNeural"
    voice_rate: str = "+0%"
    voice_pitch: str = "+0Hz"
    lang: str = "es-MX"

    # Seguridad
    confirm: str = "sensibles"
    allow_shell: bool = False
    owner_token: str = ""
    guest_token: str = ""

    # Servidor
    host: str = "127.0.0.1"
    port: int = 8000
    public_url: str = ""
    ssl_cert: str = ""
    ssl_key: str = ""
    data_dir: Path = field(default_factory=lambda: ROOT / "datos")

    # Garmin
    garmin_email: str = ""
    garmin_password: str = ""

    # Memoria de conversación (mensajes que se conservan)
    max_history: int = 60

    @classmethod
    def from_env(cls, load_dotenv_file: bool = True) -> "Settings":
        if load_dotenv_file:
            try:
                from dotenv import load_dotenv

                load_dotenv(ROOT / ".env")
            except ImportError:
                pass

        vision_raw = _env("V_VISION")
        confirm = _env("V_CONFIRM", "sensibles").lower()
        if confirm not in CONFIRM_MODES:
            confirm = "sensibles"

        return cls(
            provider=_env("V_PROVIDER", "gemini").lower(),
            model=_env("V_MODEL"),
            fallback=_env("V_FALLBACK").lower(),
            gemini_api_key=_env("GEMINI_API_KEY") or _env("GOOGLE_API_KEY"),
            groq_api_key=_env("GROQ_API_KEY"),
            openrouter_api_key=_env("OPENROUTER_API_KEY"),
            anthropic_api_key=_env("ANTHROPIC_API_KEY"),
            openai_api_key=_env("OPENAI_API_KEY"),
            openai_base_url=_env("OPENAI_BASE_URL"),
            ollama_url=_env("OLLAMA_URL", "http://localhost:11434/v1"),
            vision=None if not vision_raw else _env_bool("V_VISION", True),
            owner_name=_env("V_OWNER_NAME", "Investigador"),
            voice=_env("V_VOICE", "es-MX-JorgeNeural"),
            voice_rate=_env("V_VOICE_RATE", "+0%"),
            voice_pitch=_env("V_VOICE_PITCH", "+0Hz"),
            lang=_env("V_LANG", "es-MX"),
            confirm=confirm,
            allow_shell=_env_bool("V_ALLOW_SHELL", False),
            owner_token=_env("V_OWNER_TOKEN"),
            guest_token=_env("V_GUEST_TOKEN"),
            host=_env("V_HOST", "127.0.0.1"),
            port=int(_env("V_PORT", "8000") or 8000),
            public_url=_env("V_PUBLIC_URL").rstrip("/"),
            ssl_cert=_env("V_SSL_CERT"),
            ssl_key=_env("V_SSL_KEY"),
            data_dir=Path(_env("V_DATA_DIR") or ROOT / "datos"),
            garmin_email=_env("GARMIN_EMAIL"),
            garmin_password=_env("GARMIN_PASSWORD"),
            max_history=int(_env("V_MAX_HISTORY", "60") or 60),
        )

    def ensure_tokens(self) -> None:
        """Carga o genera los tokens de acceso (dueño e invitados)."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        path = self.data_dir / "tokens.json"
        stored: dict[str, str] = {}
        if path.exists():
            try:
                stored = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                stored = {}
        changed = False
        if not self.owner_token:
            if not stored.get("owner"):
                stored["owner"] = secrets.token_urlsafe(24)
                changed = True
            self.owner_token = stored["owner"]
        if not self.guest_token:
            if not stored.get("guest"):
                stored["guest"] = secrets.token_urlsafe(16)
                changed = True
            self.guest_token = stored["guest"]
        if changed:
            path.write_text(json.dumps(stored, indent=2), encoding="utf-8")
            try:
                path.chmod(0o600)
            except OSError:
                pass

    def base_url(self) -> str:
        if self.public_url:
            return self.public_url
        scheme = "https" if self.ssl_cert else "http"
        host = "localhost" if self.host in ("127.0.0.1", "0.0.0.0") else self.host
        return f"{scheme}://{host}:{self.port}"

    def owner_link(self) -> str:
        return f"{self.base_url()}/?t={self.owner_token}"

    def guest_link(self) -> str:
        return f"{self.base_url()}/?t={self.guest_token}"
