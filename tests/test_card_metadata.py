import asyncio
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import Base, _create_file_summaries_table
from app.models import IndexedFile, TranscriptChunk, FileInsight
from app.routers.files import CardMetadataRequest, get_card_metadata


@pytest.mark.parametrize("pending,expected", [(False, "ready"), (True, "working")])
@pytest.mark.parametrize("manual,short_mode,detailed_mode,summary_pending,expected_summary", [
    (True, "manual", "false", False, "ready"),
    (True, "false", "false", False, "ready"),
    (False, "false", "false", False, "unknown"),
    (False, "false", "on_index", True, "working"),
    (False, "manual", "false", True, "working"),
])
def test_scoped_metadata_includes_manual_summary_and_pending_transcript(tmp_path, monkeypatch, pending, expected, manual, short_mode, detailed_mode, summary_pending, expected_summary):
    engine = create_engine(f"sqlite:///{tmp_path / 'cards.db'}")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        _create_file_summaries_table(connection)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        for fid, drive, active in [("visible", "drv", True), ("hidden", "other", True), ("deleted", "drv", False)]:
            db.add(IndexedFile(file_id=fid, drive=drive, filename="v.mp4", file_path="v.mp4", file_type="video", mime_type="video/mp4", file_size=100, active=active))
        db.add(TranscriptChunk(file_id="visible", chunk_index=0, text="Text", timestamp_start=0, timestamp_end=1, language="en"))
        if manual:
            db.add(FileInsight(file_id="visible", kind="user_summary", content="Manual summary", status="active", created_by="manual"))
        db.execute(text("""INSERT INTO file_summaries
            (file_id, short_summary, long_summary, model, context_type, context_chars, created_at)
            VALUES ('visible', 'Old generated summary', '', 'test', 'transcript', 100, '2026-10-03')"""))
        db.commit()

    @contextmanager
    def database():
        with Session() as db:
            yield db

    manager = MagicMock()
    manager.get_queue_breakdown.return_value = {"whisper": {"processing": []}}
    manager.is_queued.return_value = pending
    worker = MagicMock()
    worker.is_pending.return_value = summary_pending
    monkeypatch.setattr("app.routers.files.settings", SimpleNamespace(features=SimpleNamespace(
        summaries=short_mode, detailed_summaries=detailed_mode,
    )))
    monkeypatch.setattr("app.database.get_search_db", database)
    monkeypatch.setattr("app.routers.files.get_index_manager", lambda: manager)
    monkeypatch.setattr("app.dependencies.get_summaries_worker", lambda: worker)
    monkeypatch.setattr("app.policy_client.is_feature_enabled", AsyncMock(return_value=True))
    result = asyncio.run(get_card_metadata(CardMetadataRequest(file_ids=["visible", "hidden", "deleted", "unknown"]), drive="drv"))
    assert result == {"visible": {"transcript": expected, "summary": expected_summary}}
    engine.dispose()
