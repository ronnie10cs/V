"""Datos de salud y entrenamiento desde Garmin Connect.

Usa la librería no oficial `garminconnect` (la API oficial de Garmin es solo para
empresas). El primer inicio de sesión se hace con `python -m v garmin`, que
guarda la sesión en datos/garmin/ para no volver a pedir contraseña ni MFA.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from .base import Tool, ToolContext, ToolError, compact_json, schema

log = logging.getLogger("v.garmin")

SUMMARY_KEYS = [
    "calendarDate", "totalSteps", "dailyStepGoal", "totalDistanceMeters", "totalKilocalories",
    "activeKilocalories", "restingHeartRate", "minHeartRate", "maxHeartRate",
    "lastSevenDaysAvgRestingHeartRate", "averageStressLevel", "maxStressLevel",
    "stressPercentage", "bodyBatteryChargedValue", "bodyBatteryDrainedValue",
    "bodyBatteryHighestValue", "bodyBatteryLowestValue", "bodyBatteryMostRecentValue",
    "sleepingSeconds", "floorsAscended", "moderateIntensityMinutes", "vigorousIntensityMinutes",
    "intensityMinutesGoal", "averageSpo2", "lowestSpo2", "latestSpo2",
    "avgWakingRespirationValue", "highestRespirationValue", "lowestRespirationValue",
]
SLEEP_KEYS = [
    "calendarDate", "sleepTimeSeconds", "deepSleepSeconds", "lightSleepSeconds",
    "remSleepSeconds", "awakeSleepSeconds", "awakeCount", "sleepStartTimestampLocal",
    "sleepEndTimestampLocal", "averageSpO2Value", "lowestSpO2Value", "averageRespirationValue",
    "avgSleepStress", "restlessMomentsCount", "avgHeartRate",
]
ACTIVITY_KEYS = [
    "activityName", "startTimeLocal", "duration", "distance", "calories", "averageHR", "maxHR",
    "averageSpeed", "elevationGain", "aerobicTrainingEffect", "anaerobicTrainingEffect",
    "vO2MaxValue", "steps", "averageRunningCadenceInStepsPerMinute", "trainingEffectLabel",
]


def _pick(data: Any, keys: list[str]) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {}
    return {k: data[k] for k in keys if data.get(k) is not None}


def _day(value: Any) -> str:
    text = str(value or "").strip().lower()
    today = date.today()
    if text in ("", "hoy", "today"):
        return today.isoformat()
    if text in ("ayer", "yesterday"):
        return (today - timedelta(days=1)).isoformat()
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError as exc:
        raise ToolError(f"Fecha inválida '{value}'. Usa AAAA-MM-DD, 'hoy' o 'ayer'.") from exc


class GarminService:
    def __init__(self, token_dir: Path, email: str = "", password: str = ""):
        self.token_dir = token_dir
        self.email = email
        self.password = password
        self._client = None
        self._lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return self.token_dir.exists() and any(self.token_dir.iterdir()) or bool(
            self.email and self.password
        )

    def _login(self):
        try:
            from garminconnect import Garmin
        except ImportError as exc:
            raise ToolError("Instala 'garminconnect' para usar Garmin.") from exc
        client = Garmin(self.email or None, self.password or None)
        self.token_dir.mkdir(parents=True, exist_ok=True)
        try:
            client.login(str(self.token_dir))
        except Exception as exc:  # noqa: BLE001
            raise ToolError(
                "No pude entrar en Garmin Connect. Ejecuta `python -m v garmin` en el ordenador "
                f"para iniciar sesión (admite verificación en dos pasos). Detalle: {exc}"
            ) from exc
        return client

    async def call(self, method: str, *args: Any) -> Any:
        async with self._lock:
            if self._client is None:
                if not self.configured:
                    raise ToolError(
                        "Garmin no está configurado. Ejecuta `python -m v garmin` una vez para "
                        "vincular tu cuenta."
                    )
                self._client = await asyncio.to_thread(self._login)
            client = self._client
        try:
            return await asyncio.to_thread(getattr(client, method), *args)
        except Exception as exc:  # noqa: BLE001
            name = type(exc).__name__
            if "Authentication" in name:
                self._client = None
            if "TooManyRequests" in name:
                raise ToolError("Garmin pide esperar un poco antes de más consultas.") from exc
            raise ToolError(f"Garmin respondió con un error ({name}): {exc}") from exc


def _downsample(values: list, every: int) -> list:
    return [v for i, v in enumerate(values) if i % every == 0]


def build_tools(garmin: GarminService) -> list[Tool]:
    fecha = {"fecha": {"type": "string", "description": "AAAA-MM-DD, 'hoy' o 'ayer' (por defecto hoy)."}}

    async def resumen(args: dict[str, Any], ctx: ToolContext) -> str:
        day = _day(args.get("fecha"))
        data = await garmin.call("get_user_summary", day)
        return f"Resumen Garmin {day}: " + compact_json(_pick(data, SUMMARY_KEYS))

    async def sueno(args, ctx):
        day = _day(args.get("fecha"))
        data = await garmin.call("get_sleep_data", day) or {}
        dto = _pick(data.get("dailySleepDTO") or {}, SLEEP_KEYS)
        scores = (data.get("dailySleepDTO") or {}).get("sleepScores") or {}
        overall = (scores.get("overall") or {}).get("value")
        if overall is not None:
            dto["puntuacionSueno"] = overall
        for key in ("restingHeartRate", "avgOvernightHrv", "hrvStatus", "bodyBatteryChange"):
            if data.get(key) is not None:
                dto[key] = data[key]
        return f"Sueño {day}: " + compact_json(dto)

    async def corazon(args, ctx):
        day = _day(args.get("fecha"))
        data = await garmin.call("get_heart_rates", day) or {}
        out = _pick(data, ["restingHeartRate", "minHeartRate", "maxHeartRate",
                           "lastSevenDaysAvgRestingHeartRate"])
        values = [v for v in (data.get("heartRateValues") or []) if v and v[1] is not None]
        if values:
            # Una muestra cada ~30 min para ver la tendencia sin inundar el contexto.
            step = max(1, len(values) // 48)
            out["serie_[epoch_ms,lpm]"] = _downsample(values, step)
        return f"Frecuencia cardiaca {day}: " + compact_json(out)

    async def recuperacion(args, ctx):
        day = _day(args.get("fecha"))
        out: dict[str, Any] = {}
        for label, method in (("hrv", "get_hrv_data"), ("preparacion", "get_training_readiness"),
                              ("estado_entrenamiento", "get_training_status")):
            try:
                out[label] = await garmin.call(method, day)
            except ToolError as exc:
                out[label] = f"no disponible ({exc})"
        hrv = out.get("hrv")
        if isinstance(hrv, dict):
            out["hrv"] = hrv.get("hrvSummary") or hrv
        stress = await garmin.call("get_stress_data", day) or {}
        out["estres"] = _pick(stress, ["avgStressLevel", "maxStressLevel"])
        return f"Recuperación {day}: " + compact_json(out, 5000)

    async def actividades(args, ctx):
        n = max(1, min(20, int(args.get("cantidad") or 5)))
        data = await garmin.call("get_activities", 0, n) or []
        items = []
        for act in data if isinstance(data, list) else []:
            item = _pick(act, ACTIVITY_KEYS)
            item["tipo"] = (act.get("activityType") or {}).get("typeKey")
            items.append(item)
        return f"Últimas {len(items)} actividades: " + compact_json(items)

    return [
        Tool("garmin_resumen", "Resumen diario del Garmin: pasos, calorías, pulso en reposo, estrés, "
             "Body Battery, SpO2, respiración y minutos de intensidad.",
             schema(fecha), resumen),
        Tool("garmin_sueno", "Datos de sueño del Garmin: duración, fases, puntuación, SpO2, HRV nocturna.",
             schema(fecha), sueno),
        Tool("garmin_corazon", "Frecuencia cardiaca del día con serie temporal resumida.",
             schema(fecha), corazon),
        Tool("garmin_recuperacion", "HRV, preparación para entrenar, estado de entrenamiento y estrés.",
             schema(fecha), recuperacion),
        Tool("garmin_actividades", "Últimas actividades registradas (carrera, bici, gimnasio…).",
             schema({"cantidad": {"type": "integer", "description": "1-20, por defecto 5."}}),
             actividades),
    ]
