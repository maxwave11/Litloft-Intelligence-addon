from __future__ import annotations

import json
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import analysis_prompt


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture()
def client(data_dir):
    sys.modules.pop("app.routers.admin", None)
    from app.routers import admin, analysis_prompt as prompt_router

    app = FastAPI()
    app.include_router(admin.router)
    app.include_router(prompt_router.router)
    return TestClient(app)


def test_default_prompt_is_used_without_an_override(data_dir) -> None:
    assert analysis_prompt.effective_prompt() == analysis_prompt.DEFAULT_PROMPT


def test_a_saved_prompt_is_returned_exactly_as_written(data_dir) -> None:
    text = "\nAnalyse this.\n\nKeep it short.\n"

    analysis_prompt.write_override(text)

    assert analysis_prompt.effective_prompt() == text


def test_deleting_the_override_restores_the_default(data_dir) -> None:
    analysis_prompt.write_override("custom")

    assert analysis_prompt.delete_override() is True
    assert analysis_prompt.delete_override() is False
    assert analysis_prompt.effective_prompt() == analysis_prompt.DEFAULT_PROMPT


@pytest.mark.parametrize(
    "raw",
    [
        "{not json",
        "[]",
        json.dumps({"schema_version": 1, "prompt": 7}),
        json.dumps({"schema_version": 1, "prompt": "   \n"}),
        json.dumps({"schema_version": 1}),
        json.dumps({"schema_version": 99, "prompt": "from the future"}),
    ],
    ids=["malformed", "not an object", "wrong type", "blank", "missing key", "unknown schema"],
)
def test_an_unusable_override_file_falls_back_to_the_default(data_dir, raw) -> None:
    (data_dir / analysis_prompt.OVERRIDES_FILENAME).write_text(raw, encoding="utf-8")

    assert analysis_prompt.effective_prompt() == analysis_prompt.DEFAULT_PROMPT


@pytest.mark.parametrize(
    "prompt",
    ["", "   ", "\n\t\n", "x" * (analysis_prompt.MAX_PROMPT_CHARS + 1), "a\x00b"],
    ids=["empty", "spaces", "whitespace", "over the cap", "NUL"],
)
def test_put_rejects_a_prompt_that_cannot_be_used(client, data_dir, prompt) -> None:
    response = client.put("/admin/analysis-prompt", json={"prompt": prompt})

    assert response.status_code == 400
    assert not (data_dir / analysis_prompt.OVERRIDES_FILENAME).exists()


def test_put_accepts_a_prompt_at_the_cap_and_keeps_its_whitespace(client) -> None:
    prompt = "\n" + "x" * (analysis_prompt.MAX_PROMPT_CHARS - 2) + "\n"

    assert client.put("/admin/analysis-prompt", json={"prompt": prompt}).status_code == 200
    assert client.get("/analysis-prompt").json() == {"prompt": prompt}


def test_a_saved_prompt_reaches_the_viewer_route_without_a_restart(client) -> None:
    assert client.get("/analysis-prompt").json() == {"prompt": analysis_prompt.DEFAULT_PROMPT}

    client.put("/admin/analysis-prompt", json={"prompt": "custom"})

    assert client.get("/analysis-prompt").json() == {"prompt": "custom"}


def test_the_admin_view_says_whether_the_default_is_in_use(client) -> None:
    default_view = client.get("/admin/analysis-prompt").json()
    client.put("/admin/analysis-prompt", json={"prompt": "custom"})
    custom_view = client.get("/admin/analysis-prompt").json()

    assert default_view == {
        "prompt": analysis_prompt.DEFAULT_PROMPT,
        "default": analysis_prompt.DEFAULT_PROMPT,
        "is_default": True,
    }
    assert custom_view == {
        "prompt": "custom",
        "default": analysis_prompt.DEFAULT_PROMPT,
        "is_default": False,
    }


def test_reset_is_idempotent_and_brings_back_the_default(client) -> None:
    client.put("/admin/analysis-prompt", json={"prompt": "custom"})

    assert client.delete("/admin/analysis-prompt").status_code == 200
    assert client.delete("/admin/analysis-prompt").status_code == 200
    assert client.get("/analysis-prompt").json() == {"prompt": analysis_prompt.DEFAULT_PROMPT}


def test_no_prompt_route_asks_the_core_to_show_the_restart_banner(client, monkeypatch) -> None:
    from app.routers import admin

    async def banner(*_args, **_kwargs):  # pragma: no cover - must not run
        raise AssertionError("restart-pending was requested")

    monkeypatch.setattr(admin, "_notify_core_restart_pending", banner)

    client.put("/admin/analysis-prompt", json={"prompt": "custom"})
    client.delete("/admin/analysis-prompt")
