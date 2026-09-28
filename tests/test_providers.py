from google.genai import types

from v.llm.anthropic_provider import AnthropicProvider
from v.llm.base import FallbackProvider, ProviderError
from v.llm.gemini import GeminiProvider
from v.llm.openai_compat import OpenAICompatProvider
from v.llm.types import Image, Message, ToolCall, ToolOutput, ToolResult

import asyncio
import pytest

IMG = Image(b"\x89PNGfake", "image/png")


def conversation():
    return [
        Message("user", text="[Ronnie]: mira la pantalla"),
        Message("assistant", text="Voy.", tool_calls=[ToolCall("v_abc", "ver_pantalla", {})]),
        Message("user", tool_outputs=[ToolOutput("v_abc", "ver_pantalla", ToolResult("captura", [IMG]))]),
    ]


def test_gemini_conversion_uses_multimodal_function_response():
    p = GeminiProvider("k")
    contents = [p.to_content(m) for m in conversation()]
    assert [c.role for c in contents] == ["user", "model", "user"]
    fc = contents[1].parts[1].function_call
    assert fc.name == "ver_pantalla" and fc.id is None  # id generado por V: no se envía
    fr = contents[2].parts[0].function_response
    assert fr.response == {"resultado": "captura"} and fr.parts[0].inline_data.data == IMG.data


def test_gemini_2_puts_images_after_function_response():
    p = GeminiProvider("k", model="gemini-2.5-flash")
    content = p.to_content(conversation()[2])
    assert content.parts[0].function_response.parts is None
    assert content.parts[1].inline_data.mime_type == "image/png"


def test_gemini_reuses_raw_and_parses_response():
    p = GeminiProvider("k")
    raw = types.Content(role="model", parts=[
        types.Part(text="pensando", thought=True),
        types.Part(text="[curioso] Veamos."),
        types.Part(function_call=types.FunctionCall(id="fc1", name="calcular", args={"expresion": "1+1"})),
    ])
    response = types.GenerateContentResponse(candidates=[types.Candidate(content=raw)])
    msg = p.from_response(response)
    assert msg.text == "[curioso] Veamos."
    assert msg.tool_calls[0].id == "fc1" and msg.tool_calls[0].args == {"expresion": "1+1"}
    assert p.to_content(msg) is raw


def test_openai_conversion():
    p = OpenAICompatProvider("openrouter", "k")
    out = p.to_messages(conversation())
    assert out[1]["tool_calls"][0]["function"]["name"] == "ver_pantalla"
    assert out[2] == {"role": "tool", "tool_call_id": "v_abc", "content": "captura"}
    assert out[3]["role"] == "user" and out[3]["content"][1]["type"] == "image_url"


def test_openai_without_vision_drops_images():
    p = OpenAICompatProvider("groq", "k")
    out = p.to_messages(conversation())
    assert isinstance(out[3]["content"], str) and "no tiene visión" in out[3]["content"]


def test_openai_requires_key_except_ollama():
    with pytest.raises(ProviderError):
        OpenAICompatProvider("groq", "")
    assert OpenAICompatProvider("ollama", "").model


def test_anthropic_conversion():
    p = AnthropicProvider("k")
    out = p.to_messages(conversation())
    assert out[1]["content"][1] == {"type": "tool_use", "id": "v_abc", "name": "ver_pantalla", "input": {}}
    block = out[2]["content"][0]
    assert block["type"] == "tool_result" and block["content"][1]["type"] == "image"


def test_fallback_provider_switches_on_retryable_error():
    class Failing:
        name, model, vision = "a", "a", True

        async def complete(self, *args):
            raise ProviderError("cuota", retryable=True)

    class Working:
        name, model, vision = "b", "b", True

        async def complete(self, *args):
            return Message("assistant", text="ok")

    reply = asyncio.run(FallbackProvider([Failing(), Working()]).complete("", [], []))
    assert reply.text == "ok"


# --- Respaldo entre modelos de Gemini ------------------------------------------

from google.genai import errors  # noqa: E402


class FakeModels:
    """Sustituye a client.aio.models: falla con los modelos indicados."""

    def __init__(self, failures):
        self.failures = failures  # {modelo: código HTTP}
        self.calls = []

    async def generate_content(self, model, contents, config):
        self.calls.append(model)
        code = self.failures.get(model)
        if code:
            cls = errors.ServerError if code >= 500 else errors.ClientError
            raise cls(code, {"error": {"message": "This model is currently experiencing high demand.", "status": "X"}})
        content = types.Content(role="model", parts=[types.Part(text="[feliz] Hola.")])
        return types.GenerateContentResponse(candidates=[types.Candidate(content=content)])


def gemini_with(failures):
    p = GeminiProvider("k")
    p.retry_delay = 0
    fake = FakeModels(failures)
    p.client = type("C", (), {"aio": type("A", (), {"models": fake})()})()
    return p, fake


def test_gemini_falls_back_when_a_model_is_overloaded():
    p, fake = gemini_with({"gemini-3.8-flash": 503, "gemini-3.7-flash": 429})
    msg = asyncio.run(p.complete("s", [Message("user", text="hola")], []))
    assert msg.text == "[feliz] Hola." and msg.raw["gemini_model"] == "gemini-3.5-flash"
    assert fake.calls == ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash"]
    # El siguiente turno empieza por un modelo que no ha fallado hace poco.
    asyncio.run(p.complete("s", [Message("user", text="otra")], []))
    assert fake.calls[-1] == "gemini-3.5-flash"


def test_gemini_keeps_the_model_within_a_turn():
    p, fake = gemini_with({"gemini-3.8-flash": 503})
    turn = [
        Message("user", text="mira"),
        Message("assistant", tool_calls=[ToolCall("v_1", "ver_pantalla", {})],
                raw={"gemini": types.Content(role="model", parts=[]), "gemini_model": "gemini-3.7-flash"}),
        Message("user", tool_outputs=[ToolOutput("v_1", "ver_pantalla", ToolResult("ok"))]),
    ]
    asyncio.run(p.complete("s", turn, []))
    assert fake.calls == ["gemini-3.7-flash"]


def test_gemini_explains_when_every_model_is_busy():
    p, fake = gemini_with({m: 503 for m in p_models()})
    with pytest.raises(ProviderError, match="mucha demanda") as exc:
        asyncio.run(p.complete("s", [Message("user", text="hola")], []))
    assert exc.value.retryable and len(fake.calls) == 2 * len(p_models())


def test_gemini_invalid_key_does_not_try_other_models():
    p, fake = gemini_with({"gemini-3.8-flash": 403})
    with pytest.raises(ProviderError, match="clave"):
        asyncio.run(p.complete("s", [Message("user", text="hola")], []))
    assert fake.calls == ["gemini-3.8-flash"]


def p_models():
    return GeminiProvider("k").models
