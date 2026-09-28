"""Conjunto de herramientas disponibles para V."""

from __future__ import annotations

from typing import Any, Callable

from ..config import Settings
from ..notebook import Notebook
from . import computer, garmin, research, senses
from .base import Tool, ToolContext, ToolError, ToolRegistry

__all__ = ["Tool", "ToolContext", "ToolError", "ToolRegistry", "build_registry"]


def build_registry(
    settings: Settings,
    notebook: Notebook,
    on_notebook_change: Callable[[], Any] | None = None,
) -> tuple[ToolRegistry, garmin.GarminService]:
    registry = ToolRegistry()
    registry.extend(computer.build_tools(computer.Computer(settings.allow_shell)))
    registry.extend(senses.build_senses_tools())
    registry.extend(research.build_notebook_tools(notebook, on_notebook_change))
    registry.add(research.build_calc_tool())
    garmin_service = garmin.GarminService(
        settings.data_dir / "garmin", settings.garmin_email, settings.garmin_password
    )
    registry.extend(garmin.build_tools(garmin_service))
    return registry, garmin_service
