from __future__ import annotations

import asyncio
import sys
from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

for _mod in (
    "PIL", "PIL.Image",
    "open_clip",
    "torch",
    "sentence_transformers",
    "faster_whisper",
    "onnxruntime",
    "transformers",
    "janome", "janome.tokenizer",
    "sqlite_vec",
):
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.database import Base, _create_file_insights_table  # noqa: E402
from app.routers.user_summary import (  # noqa: E402
    create_user_summary,
    list_user_summaries,
    update_user_summary,
)
from app.schemas import UserSummaryRequest  # noqa: E402


@pytest.fixture()
def engine(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'search.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        _create_file_insights_table(conn)

    from app.models import IndexedFile

    Session = sessionmaker(bind=engine, expire_on_commit=False)
    with Session() as seed:
        seed.add(
            IndexedFile(
                file_id="abc123",
                drive="drive1",
                filename="lecture.mp4",
                file_path="/drives/drive1/lecture.mp4",
                file_type="video",
                mime_type="video/mp4",
                file_size=1000,
                active=True,
            )
        )
        seed.commit()

    @contextmanager
    def _get_search_db():
        session = Session()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setattr("app.routers.user_summary.get_search_db", _get_search_db)
    monkeypatch.setattr("app.routers.summaries.get_search_db", _get_search_db)
    return engine


def _list(drive: str = "drive1") -> list[tuple[str | None, str]]:
    res = asyncio.run(list_user_summaries("abc123", drive=drive))
    return [(item.title, item.content) for item in res.summaries]


def _create(content: str, title: str | None = None, drive: str = "drive1"):
    return asyncio.run(
        create_user_summary(
            "abc123", UserSummaryRequest(title=title, content=content), drive=drive
        )
    )


def _update(summary_id: str, content: str, title: str | None = None, drive: str = "drive1"):
    return asyncio.run(
        update_user_summary(
            "abc123",
            summary_id,
            UserSummaryRequest(title=title, content=content),
            drive=drive,
        )
    )


def test_a_file_without_summaries_lists_none(engine) -> None:
    assert _list() == []


def test_summaries_are_listed_in_the_order_they_were_added(engine) -> None:
    _create("# Short\n", title=" Brief ")
    _create("Long text.", title="Detailed")
    _create("No title.")

    assert _list() == [("Brief", "# Short"), ("Detailed", "Long text."), (None, "No title.")]


def test_an_edit_changes_one_summary_in_place(engine) -> None:
    first = _create("One", title="A")
    _create("Two", title="B")

    edited = _update(first.id, "One, edited", title="A2")

    assert (edited.id, edited.title, edited.content) == (first.id, "A2", "One, edited")
    assert _list() == [("A2", "One, edited"), ("B", "Two")]


@pytest.mark.parametrize("blank", ["", "  \n\t"])
def test_saving_a_blank_text_deletes_only_that_summary(engine, blank: str) -> None:
    first = _create("One")
    _create("Two")

    assert _update(first.id, blank) is None
    assert _list() == [(None, "Two")]


def test_a_blank_summary_is_not_created(engine) -> None:
    with pytest.raises(HTTPException) as exc:
        _create("   ")
    assert exc.value.status_code == 422
    assert _list() == []


def test_a_summary_of_another_file_is_not_found(engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO file_insights (id, file_id, kind, content, status, "
                "created_by, created_at) VALUES ('other1', 'zzz999', 'user_summary', "
                "'Theirs', 'active', 'manual', '2026-01-01')"
            )
        )
    with pytest.raises(HTTPException) as exc:
        _update("other1", "Mine")
    assert exc.value.status_code == 404


@pytest.mark.parametrize(
    "call",
    [
        lambda drive: _list(drive=drive),
        lambda drive: _create("x", drive=drive),
        lambda drive: _update("any", "x", drive=drive),
    ],
)
def test_a_file_of_another_drive_is_not_found(engine, call) -> None:
    with pytest.raises(HTTPException) as exc:
        call(drive="drive2")
    assert exc.value.status_code == 404
    assert _list() == []
