import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from v.config import Settings  # noqa: E402
from v.llm.types import Message, ToolCall  # noqa: E402


class FakeProvider:
    """Proveedor guionizado: devuelve las respuestas indicadas en orden."""

    name = "fake"
    model = "fake-1"
    vision = True

    def __init__(self, *script):
        self.script = list(script)
        self.calls = []

    async def complete(self, system, messages, tools):
        self.calls.append({
            "system": system,
            "messages": copy.deepcopy(messages),
            "tools": [t.name for t in tools],
        })
        if not self.script:
            return Message("assistant", text="[neutral] (sin guion)")
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def say(text):
    return Message("assistant", text=text)


def call(name, **args):
    return Message("assistant", tool_calls=[ToolCall(id=f"c_{name}", name=name, args=args)])


@pytest.fixture
def settings(tmp_path):
    s = Settings(data_dir=tmp_path / "datos", owner_name="Ronnie", owner_token="dueno-123",
                 guest_token="invitado-456")
    return s
