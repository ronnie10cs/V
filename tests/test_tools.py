import asyncio

import pytest

from v.notebook import Notebook
from v.persona import speakable, split_mood, system_prompt, TurnContext
from v.tools.base import ToolContext, ToolError
from v.tools.computer import Computer
from v.tools.garmin import GarminService, _day, build_tools as garmin_tools
from v.tools.research import build_notebook_tools, safe_eval

CTX = ToolContext(speaker="Ana", role="guest")


def run(coro):
    return asyncio.run(coro)


def test_notebook_lifecycle_and_persistence(tmp_path):
    path = tmp_path / "cuaderno.json"
    nb = Notebook(path)
    h = nb.add("Café y memoria", "El café mejora el recuerdo a corto plazo", "Ana", 60, ["cognición"])
    assert h.id == "H1"
    nb.add_evidence("h1", "a_favor", "Estudio con 40 personas", "Revista X", "Ana")
    nb.add_test("1", "Test de dígitos con y sin café", "Con café se recuerdan 1+ dígitos más", "Ronnie")
    nb.record_result("H1", 1, "Sin diferencia significativa")
    nb.update_state("H1", "refutada", 20, "El experimento no la apoya")

    again = Notebook(path)
    h = again.get("H1")
    assert h.state == "refutada" and h.confidence == 20
    assert h.tests[0].result == "Sin diferencia significativa"
    assert "Café y memoria" in again.to_markdown()
    assert again.add("Otra", "x", "Ana").id == "H2"


def test_notebook_rejects_bad_input(tmp_path):
    nb = Notebook(tmp_path / "c.json")
    nb.add("t", "s", "a")
    with pytest.raises(ValueError):
        nb.add_evidence("H1", "quizas", "x", "", "a")
    with pytest.raises(KeyError):
        nb.get("H9")


def test_notebook_tools_notify_and_use_speaker(tmp_path):
    nb = Notebook(tmp_path / "c.json")
    changes = []
    tools = {t.name: t for t in build_notebook_tools(nb, lambda: changes.append(1))}
    out = run(tools["cuaderno_registrar"].handler({"titulo": "T", "enunciado": "E"}, CTX))
    assert "H1" in out and nb.get("H1").author == "Ana" and changes
    with pytest.raises(ToolError):
        run(tools["cuaderno_ver"].handler({"id": "H7"}, CTX))
    assert all(t.guest_ok for t in tools.values())


def test_safe_eval():
    assert safe_eval("2 + 3 * 4") == 14
    assert safe_eval("2^10") == 1024
    assert safe_eval("media([1, 2, 3])") == 2
    assert round(safe_eval("sqrt(2)"), 4) == 1.4142
    for bad in ("__import__('os')", "(1).__class__", "open('x')", "9**99999", "factorial(100000)",
                "(10**1000)**1000"):
        with pytest.raises(ToolError):
            safe_eval(bad)


def test_split_mood_and_speakable():
    assert split_mood("[travieso] Hola") == ("travieso", "Hola")
    assert split_mood("Sin etiqueta") == ("neutral", "Sin etiqueta")
    text = speakable("**Hola** mira [esto](https://x.com) y `código`\n- punto [feliz]")
    assert text == "Hola mira esto y código punto"


def test_system_prompt_mentions_mode_and_state():
    prompt = system_prompt(TurnContext(owner="Ronnie", mode="debate", participants=["Ana (invitado)"],
                                       camera_on=True))
    assert "Ronnie" in prompt and "Modo debate" in prompt and "Cámara: encendida" in prompt


def test_computer_click_requires_screenshot():
    comp = Computer()
    with pytest.raises(ToolError):
        comp.to_screen(10, 10)
    comp._last_shot = {"w": 640, "h": 400, "rect": {"left": 0, "top": 0, "width": 1280, "height": 800}}
    assert comp.to_screen(320, 200) == (640, 400)
    with pytest.raises(ToolError):
        comp.to_screen(700, 10)


def test_close_app_refuses_system_processes():
    with pytest.raises(ToolError):
        Computer().close_app("explorer.exe")
    with pytest.raises(ToolError):
        Computer().close_app("")


def test_shell_disabled_by_default():
    with pytest.raises(ToolError):
        Computer().run_shell("echo hola")


def test_garmin_unconfigured_explains_setup(tmp_path):
    service = GarminService(tmp_path / "garmin")
    tools = {t.name: t for t in garmin_tools(service)}
    with pytest.raises(ToolError, match="python -m v garmin"):
        run(tools["garmin_resumen"].handler({}, CTX))


def test_garmin_dates():
    assert len(_day("hoy")) == 10
    assert _day("2026-01-05") == "2026-01-05"
    with pytest.raises(ToolError):
        _day("mañana por la tarde")


def test_garmin_summary_filters_fields(tmp_path):
    service = GarminService(tmp_path / "garmin")

    async def fake_call(method, *args):
        assert method == "get_user_summary"
        return {"totalSteps": 8123, "restingHeartRate": 52, "secretoInterno": "x"}

    service.call = fake_call
    tools = {t.name: t for t in garmin_tools(service)}
    out = run(tools["garmin_resumen"].handler({"fecha": "2026-09-01"}, CTX))
    assert "8123" in out and "secretoInterno" not in out
