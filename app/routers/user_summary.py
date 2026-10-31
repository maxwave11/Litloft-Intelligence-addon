"""Summaries the viewer writes or pastes, kept beside the transcript.

Each one is a ``file_insights`` row of kind ``user_summary``, its title in
``metadata_json``. Edits rewrite the row in place, so ``created_at`` keeps
the order the summaries were added in.
"""

import asyncio
import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text as sql_text

from app.database import get_search_db, get_search_db_read
from app.drive_context import require_drive
from app.models import generate_insight_id
from app.routers.summaries import _require_file_in_drive
from app.schemas import UserSummary, UserSummaryList, UserSummaryRequest

router = APIRouter(tags=["user-summary"])

_KIND = "user_summary"


def _title_meta(title: str | None) -> str | None:
    title = (title or "").strip()
    return json.dumps({"title": title}) if title else None


def _to_item(row: object) -> UserSummary:
    meta = json.loads(row[2]) if row[2] else {}
    return UserSummary(id=row[0], title=meta.get("title"), content=row[1])


def _read_one(session: object, file_id: str, summary_id: str) -> object | None:
    return session.execute(
        sql_text(
            "SELECT id, content, metadata_json FROM file_insights "
            "WHERE id = :id AND file_id = :fid AND kind = :kind "
            "AND status = 'active'"
        ),
        {"id": summary_id, "fid": file_id, "kind": _KIND},
    ).fetchone()


@router.get("/files/{file_id}/user-summaries", response_model=UserSummaryList)
async def list_user_summaries(
    file_id: str,
    drive: str = Depends(require_drive),
) -> UserSummaryList:
    def _list() -> UserSummaryList:
        _require_file_in_drive(file_id, drive)
        with get_search_db_read() as session:
            rows = session.execute(
                sql_text(
                    "SELECT id, content, metadata_json FROM file_insights "
                    "WHERE file_id = :fid AND kind = :kind AND status = 'active' "
                    "ORDER BY created_at, id"
                ),
                {"fid": file_id, "kind": _KIND},
            ).fetchall()
        return UserSummaryList(summaries=[_to_item(r) for r in rows])

    return await asyncio.to_thread(_list)


@router.post("/files/{file_id}/user-summaries", response_model=UserSummary)
async def create_user_summary(
    file_id: str,
    body: UserSummaryRequest,
    drive: str = Depends(require_drive),
) -> UserSummary:
    content = body.content.strip()

    def _create() -> UserSummary:
        _require_file_in_drive(file_id, drive)
        if not content:
            raise HTTPException(status_code=422, detail="Summary is empty")
        summary_id = generate_insight_id()
        with get_search_db() as session:
            session.execute(
                sql_text(
                    "INSERT INTO file_insights "
                    "(id, file_id, kind, content, metadata_json, "
                    " status, created_by, created_at) "
                    "VALUES (:id, :fid, :kind, :c, :m, 'active', 'manual', :ca)"
                ),
                {
                    "id": summary_id,
                    "fid": file_id,
                    "kind": _KIND,
                    "c": content,
                    "m": _title_meta(body.title),
                    "ca": datetime.now(UTC).isoformat(),
                },
            )
            return _to_item(_read_one(session, file_id, summary_id))

    return await asyncio.to_thread(_create)


@router.put(
    "/files/{file_id}/user-summaries/{summary_id}",
    response_model=UserSummary | None,
)
async def update_user_summary(
    file_id: str,
    summary_id: str,
    body: UserSummaryRequest,
    drive: str = Depends(require_drive),
) -> UserSummary | None:
    """An empty ``content`` deletes the summary and answers ``null``."""
    content = body.content.strip()

    def _update() -> UserSummary | None:
        _require_file_in_drive(file_id, drive)
        with get_search_db() as session:
            if _read_one(session, file_id, summary_id) is None:
                raise HTTPException(status_code=404, detail="Summary not found")
            if not content:
                session.execute(
                    sql_text("DELETE FROM file_insights WHERE id = :id"),
                    {"id": summary_id},
                )
                return None
            session.execute(
                sql_text(
                    "UPDATE file_insights SET content = :c, metadata_json = :m "
                    "WHERE id = :id"
                ),
                {"id": summary_id, "c": content, "m": _title_meta(body.title)},
            )
            return _to_item(_read_one(session, file_id, summary_id))

    return await asyncio.to_thread(_update)
