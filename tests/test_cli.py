import os

import v.__main__ as cli
from v.config import Settings


def test_write_env_starts_from_example_and_keeps_comments(tmp_path):
    (tmp_path / ".env.example").write_text("# Clave\nGEMINI_API_KEY=\nV_OWNER_NAME=\n# fin\n", encoding="utf-8")
    env = tmp_path / ".env"
    cli.write_env(env, {"GEMINI_API_KEY": "AIzaXYZ", "V_PORT": "9000"})
    assert env.read_text(encoding="utf-8") == "# Clave\nGEMINI_API_KEY=AIzaXYZ\nV_OWNER_NAME=\n# fin\nV_PORT=9000\n"
    cli.write_env(env, {"V_OWNER_NAME": "Ronnie"})
    assert "GEMINI_API_KEY=AIzaXYZ\nV_OWNER_NAME=Ronnie\n" in env.read_text(encoding="utf-8")


def test_setup_asks_until_the_key_looks_complete(tmp_path, monkeypatch):
    answers = iter(["Ronnie", "corta", "AIzaPRUEBAPRUEBAPRUEBAPRUEBA123"])
    monkeypatch.setattr("builtins.input", lambda prompt="": next(answers))
    monkeypatch.setattr(cli.webbrowser, "open", lambda url: True)
    monkeypatch.setattr(cli, "ENV_FILE", tmp_path / ".env")
    monkeypatch.delenv("V_OWNER_NAME", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(Settings, "from_env", classmethod(lambda cls, load_dotenv_file=True: cls(
        owner_name=os.environ.get("V_OWNER_NAME", ""), gemini_api_key=os.environ.get("GEMINI_API_KEY", ""))))

    assert cli.needs_setup(Settings())
    settings = cli.cmd_setup(Settings())
    assert settings.owner_name == "Ronnie" and settings.gemini_api_key.endswith("123")
    assert not cli.needs_setup(settings)
    assert "GEMINI_API_KEY=AIzaPRUEBAPRUEBAPRUEBAPRUEBA123" in (tmp_path / ".env").read_text(encoding="utf-8")
