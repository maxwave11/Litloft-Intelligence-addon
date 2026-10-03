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
from app.routers.user_summary import get_user_summary, put_user_summary  # noqa: E402
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


def _get(drive: str = "drive1"):
    return asyncio.run(get_user_summary("abc123", drive=drive))


def _put(content: str, drive: str = "drive1"):
    return asyncio.run(
        put_user_summary("abc123", UserSummaryRequest(content=content), drive=drive)
    )


def _rows(engine) -> list[tuple[str, str]]:
    with engine.connect() as conn:
        return [
            (r[0], r[1])
            for r in conn.execute(
                text(
                    "SELECT content, status FROM file_insights "
                    "WHERE kind = 'user_summary' ORDER BY created_at"
                )
            )
        ]


def test_a_file_without_a_summary_has_none(engine) -> None:
    assert _get().available is False


def test_a_saved_summary_is_read_back_and_a_later_save_replaces_it(engine) -> None:
    _put("# First\n\n- point")
    saved = _put("# Second\n")

    assert saved.available is True
    assert saved.content == "# Second"
    assert _get().content == "# Second"
    assert _rows(engine) == [("# First\n\n- point", "superseded"), ("# Second", "active")]


@pytest.mark.parametrize("blank", ["", "  \n\t"])
def test_saving_a_blank_text_removes_the_summary(engine, blank: str) -> None:
    _put("# Summary")

    assert _put(blank).available is False
    assert _get().available is False
    assert _rows(engine) == [("# Summary", "superseded")]


@pytest.mark.parametrize("call", [_get, lambda drive: _put("x", drive=drive)])
def test_a_file_of_another_drive_is_not_found(engine, call) -> None:
    with pytest.raises(HTTPException) as exc:
        call(drive="drive2")
    assert exc.value.status_code == 404
    assert _rows(engine) == []
