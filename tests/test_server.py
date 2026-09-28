import base64
import io

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from conftest import FakeProvider, call, say
from v.server import create_app


def make_client(settings, *script):
    provider = FakeProvider(*script)
    app = create_app(settings, provider=provider)
    app.state.voice.available = False  # sin red en las pruebas
    return TestClient(app), provider


def receive_until(ws, kind):
    for _ in range(50):
        msg = ws.receive_json()
        if msg["type"] == kind:
            return msg
    raise AssertionError(f"No llegó {kind}")


def tiny_jpeg():
    from PIL import Image as PILImage

    buf = io.BytesIO()
    PILImage.new("RGB", (8, 8), (10, 200, 250)).save(buf, "JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def test_index_and_manifest(settings):
    client, _ = make_client(settings)
    assert client.get("/").status_code == 200
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/manifest.webmanifest").json()["start_url"] == "/"
    manifest = client.get("/manifest.webmanifest?t=dueno-123").json()
    assert manifest["start_url"] == "/?t=dueno-123"


def test_api_requires_token(settings):
    client, _ = make_client(settings)
    assert client.get("/api/cuaderno").status_code == 401
    assert client.get("/api/cuaderno", headers={"Authorization": "Bearer invitado-456"}).json() == []
    assert client.get("/api/estado?t=dueno-123").json()["rol"] == "owner"


def test_websocket_rejects_bad_token(settings):
    client, _ = make_client(settings)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws?t=malo") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_chat_round_trip(settings):
    client, provider = make_client(settings, say("[feliz] Hola, Ronnie."))
    with client.websocket_connect("/ws?t=dueno-123") as ws:
        welcome = ws.receive_json()
        assert welcome["role"] == "owner" and welcome["guest_token"] == "invitado-456"
        ws.send_json({"type": "message", "text": "Hola V"})
        chat = receive_until(ws, "chat")
        assert chat["from"] == "Ronnie" and chat["text"] == "Hola V"
        reply = receive_until(ws, "reply")
        assert reply["text"] == "Hola, Ronnie." and reply["mood"] == "feliz" and reply["audio"] is None


def test_guest_cannot_change_mode_or_see_guest_token(settings):
    client, _ = make_client(settings)
    with client.websocket_connect("/ws?t=invitado-456&nombre=Ana") as ws:
        welcome = ws.receive_json()
        assert welcome["role"] == "guest" and welcome["name"] == "Ana" and "guest_token" not in welcome
        ws.send_json({"type": "set_mode", "mode": "debate"})
        ws.send_json({"type": "ping"})
        assert receive_until(ws, "pong")
    assert client.app.state.agent.mode == "asistente"


def test_debate_mode_listens_until_addressed(settings):
    client, provider = make_client(settings, say("[pensativo] Buena pregunta."))
    with client.websocket_connect("/ws?t=dueno-123") as owner:
        owner.receive_json()
        owner.send_json({"type": "set_mode", "mode": "debate"})
        assert receive_until(owner, "mode")["mode"] == "debate"
        owner.send_json({"type": "message", "text": "El universo es una simulación"})
        receive_until(owner, "chat")
        owner.send_json({"type": "message", "text": "¿Tú qué crees, V?"})
        receive_until(owner, "reply")
    assert len(provider.calls) == 1
    first = provider.calls[0]["messages"][0].text
    assert "simulación" in first and "¿Tú qué crees, V?" in first


def test_confirmation_denied_from_ui(settings):
    client, provider = make_client(settings, call("cerrar_app", nombre="Spotify"), say("[serio] De acuerdo."))
    with client.websocket_connect("/ws?t=dueno-123") as ws:
        ws.receive_json()
        ws.send_json({"type": "message", "text": "Cierra Spotify"})
        request = receive_until(ws, "confirm_request")
        assert "Spotify" in request["summary"]
        ws.send_json({"type": "confirm_response", "id": request["id"], "approved": False})
        receive_until(ws, "reply")
    result = provider.calls[1]["messages"][-1].tool_outputs[0].result
    assert result.is_error and "no autorizó" in result.text


def test_camera_frame_reaches_the_model(settings):
    client, provider = make_client(settings, call("ver_camara"), say("[sorprendido] Veo un cuadrado azul."))
    with client.websocket_connect("/ws?t=dueno-123") as ws:
        ws.receive_json()
        ws.send_json({"type": "status", "camera": True})
        ws.send_json({"type": "message", "text": "¿Qué ves?"})
        request = receive_until(ws, "frame_request")
        ws.send_json({"type": "frame_response", "id": request["id"], "image": tiny_jpeg()})
        reply = receive_until(ws, "reply")
        assert reply["text"] == "Veo un cuadrado azul."
    result = provider.calls[1]["messages"][-1].tool_outputs[0].result
    assert not result.is_error and result.images[0].mime == "image/jpeg"


def test_camera_off_gives_helpful_error(settings):
    client, provider = make_client(settings, call("ver_camara"), say("[neutral] Enciende la cámara."))
    with client.websocket_connect("/ws?t=dueno-123") as ws:
        ws.receive_json()
        ws.send_json({"type": "message", "text": "¿Qué ves?"})
        receive_until(ws, "reply")
    result = provider.calls[1]["messages"][-1].tool_outputs[0].result
    assert result.is_error and "cámara" in result.text


def test_hands_are_reported_to_the_model(settings):
    client, provider = make_client(settings, call("ver_manos"), say("[feliz] Tres dedos."))
    with client.websocket_connect("/ws?t=dueno-123") as ws:
        ws.receive_json()
        ws.send_json({"type": "status", "camera": True, "hands": True})
        ws.send_json({"type": "hands", "hands": [
            {"gesture": "Victory", "handedness": "derecha", "fingers": 2, "x": 0.4, "y": 0.5, "speed": 0.1}]})
        ws.send_json({"type": "message", "text": "¿Qué gesto hago?"})
        receive_until(ws, "reply")
    text = provider.calls[1]["messages"][-1].tool_outputs[0].result.text
    assert "victoria" in text and "2 dedos" in text


def test_notebook_updates_are_broadcast(settings):
    client, _ = make_client(settings, call("cuaderno_registrar", titulo="T", enunciado="E"), say("[feliz] Anotado."))
    with client.websocket_connect("/ws?t=invitado-456&nombre=Ana") as ws:
        ws.receive_json()
        ws.send_json({"type": "message", "text": "Registra mi hipótesis"})
        receive_until(ws, "notebook")
        receive_until(ws, "reply")
    items = client.get("/api/cuaderno?t=dueno-123").json()
    assert items[0]["author"] == "Ana"


def test_guest_cannot_take_the_owner_name(settings):
    client, _ = make_client(settings)
    with client.websocket_connect("/ws?t=invitado-456&nombre=ronnie") as ws:
        assert ws.receive_json()["name"] == "ronnie (2)"
