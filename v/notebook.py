"""Cuaderno de hipótesis: memoria persistente de teorías, evidencias y pruebas."""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

STATES = ("propuesta", "en_prueba", "apoyada", "refutada", "descartada")
STATE_LABELS = {
    "propuesta": "Propuesta",
    "en_prueba": "En prueba",
    "apoyada": "Apoyada",
    "refutada": "Refutada",
    "descartada": "Descartada",
}
EVIDENCE_KINDS = ("a_favor", "en_contra", "neutral")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


@dataclass
class Evidence:
    kind: str
    description: str
    source: str = ""
    author: str = ""
    at: str = field(default_factory=_now)


@dataclass
class Test:
    description: str
    prediction: str
    result: str = ""
    author: str = ""
    at: str = field(default_factory=_now)


@dataclass
class Hypothesis:
    id: str
    title: str
    statement: str
    author: str
    state: str = "propuesta"
    confidence: int = 50
    tags: list[str] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)
    tests: list[Test] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    created: str = field(default_factory=_now)
    updated: str = field(default_factory=_now)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Hypothesis":
        data = dict(data)
        data["evidence"] = [Evidence(**e) for e in data.get("evidence", [])]
        data["tests"] = [Test(**t) for t in data.get("tests", [])]
        return cls(**data)

    def brief(self) -> str:
        pro = sum(1 for e in self.evidence if e.kind == "a_favor")
        con = sum(1 for e in self.evidence if e.kind == "en_contra")
        return (f"{self.id} [{STATE_LABELS.get(self.state, self.state)}, {self.confidence}%] "
                f"{self.title} — de {self.author}; evidencias +{pro}/-{con}, pruebas {len(self.tests)}")

    def detail(self) -> str:
        lines = [self.brief(), f"Enunciado: {self.statement}"]
        if self.tags:
            lines.append("Etiquetas: " + ", ".join(self.tags))
        for i, e in enumerate(self.evidence, 1):
            src = f" (fuente: {e.source})" if e.source else ""
            lines.append(f"  E{i} {e.kind}: {e.description}{src} — {e.author}")
        for i, t in enumerate(self.tests, 1):
            res = f" → resultado: {t.result}" if t.result else " → pendiente"
            lines.append(f"  P{i} {t.description}. Predicción: {t.prediction}{res}")
        for n in self.notes[-5:]:
            lines.append(f"  Nota: {n}")
        return "\n".join(lines)


class Notebook:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._items: dict[str, Hypothesis] = {}
        self._counter = 0
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        self._counter = int(data.get("counter", 0))
        for item in data.get("hypotheses", []):
            h = Hypothesis.from_dict(item)
            self._items[h.id] = h

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {"counter": self._counter, "hypotheses": [asdict(h) for h in self._items.values()]}
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def get(self, hid: str) -> Hypothesis:
        key = hid.strip().upper()
        if not key.startswith("H"):
            key = f"H{key}"
        if key not in self._items:
            raise KeyError(f"No existe la hipótesis {hid}.")
        return self._items[key]

    def all(self) -> list[Hypothesis]:
        return list(self._items.values())

    def add(self, title: str, statement: str, author: str, confidence: int = 50,
            tags: list[str] | None = None) -> Hypothesis:
        with self._lock:
            self._counter += 1
            h = Hypothesis(
                id=f"H{self._counter}", title=title.strip(), statement=statement.strip(),
                author=author, confidence=_clamp(confidence), tags=tags or [],
            )
            self._items[h.id] = h
            self._save()
            return h

    def add_evidence(self, hid: str, kind: str, description: str, source: str, author: str) -> Hypothesis:
        if kind not in EVIDENCE_KINDS:
            raise ValueError(f"Tipo de evidencia inválido: {kind}. Usa {', '.join(EVIDENCE_KINDS)}.")
        with self._lock:
            h = self.get(hid)
            h.evidence.append(Evidence(kind, description.strip(), source.strip(), author))
            h.updated = _now()
            self._save()
            return h

    def add_test(self, hid: str, description: str, prediction: str, author: str) -> Hypothesis:
        with self._lock:
            h = self.get(hid)
            h.tests.append(Test(description.strip(), prediction.strip(), author=author))
            if h.state == "propuesta":
                h.state = "en_prueba"
            h.updated = _now()
            self._save()
            return h

    def record_result(self, hid: str, index: int, result: str) -> Hypothesis:
        with self._lock:
            h = self.get(hid)
            if not 1 <= index <= len(h.tests):
                raise ValueError(f"{h.id} no tiene la prueba P{index}.")
            h.tests[index - 1].result = result.strip()
            h.updated = _now()
            self._save()
            return h

    def update_state(self, hid: str, state: str | None, confidence: int | None, note: str) -> Hypothesis:
        if state and state not in STATES:
            raise ValueError(f"Estado inválido: {state}. Usa {', '.join(STATES)}.")
        with self._lock:
            h = self.get(hid)
            if state:
                h.state = state
            if confidence is not None:
                h.confidence = _clamp(confidence)
            if note:
                h.notes.append(note.strip())
            h.updated = _now()
            self._save()
            return h

    def to_markdown(self) -> str:
        lines = ["# Cuaderno de hipótesis de V", ""]
        if not self._items:
            lines.append("_Todavía no hay hipótesis._")
        for h in self._items.values():
            lines += [
                f"## {h.id} · {h.title}",
                f"**Estado:** {STATE_LABELS.get(h.state, h.state)} · **Confianza:** {h.confidence}% · "
                f"**Autor:** {h.author} · **Actualizada:** {h.updated}",
                "",
                f"> {h.statement}",
                "",
            ]
            if h.evidence:
                lines.append("**Evidencias**")
                for e in h.evidence:
                    icon = {"a_favor": "➕", "en_contra": "➖"}.get(e.kind, "•")
                    src = f" _(fuente: {e.source})_" if e.source else ""
                    lines.append(f"- {icon} {e.description}{src} — {e.author}")
                lines.append("")
            if h.tests:
                lines.append("**Pruebas**")
                for i, t in enumerate(h.tests, 1):
                    lines.append(f"{i}. {t.description} — _Predicción:_ {t.prediction}"
                                 + (f" — **Resultado:** {t.result}" if t.result else ""))
                lines.append("")
            if h.notes:
                lines.append("**Notas**")
                lines += [f"- {n}" for n in h.notes]
                lines.append("")
        return "\n".join(lines)


def _clamp(value: int) -> int:
    return max(0, min(100, int(value)))
