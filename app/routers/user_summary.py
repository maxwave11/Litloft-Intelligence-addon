"""A summary the viewer writes or pastes, kept beside the transcript.

Stored as ``file_insights`` rows of kind ``user_summary``: each save
supersedes the previous active row, and saving an empty text supersedes
it without a replacement.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import text as sql_text

from app.database import get_search_db
from app.drive_context import require_drive
from app.models import generate_insight_id
from app.routers.summaries import _require_file_in_drive
from app.schemas import UserSummaryRequest, UserSummaryResponse

router = APIRouter(tags=["user-summary"])

_KIND = "user_summary"


def _read_active(session: object, file_id: str) -> UserSummaryResponse:
    row = session.execute(
        sql_text(
            "SELECT content, created_at FROM file_insights "
            "WHERE file_id = :fid AND kind = :kind AND status = 'active'"
        ),
        {"fid": file_id, "kind": _KIND},
    ).fetchone()
    if row is None:
        return UserSummaryResponse(available=False)
    return UserSummaryResponse(
        available=True, content=row[0], updated_at=str(row[1])
    )


@router.get("/files/{file_id}/user-summary", response_model=UserSummaryResponse)
async def get_user_summary(
    file_id: str,
    drive: str = Depends(require_drive),
) -> UserSummaryResponse:
    _require_file_in_drive(file_id, drive)
    with get_search_db() as session:
        return _read_active(session, file_id)


@router.put("/files/{file_id}/user-summary", response_model=UserSummaryResponse)
async def put_user_summary(
    file_id: str,
    body: UserSummaryRequest,
    drive: str = Depends(require_drive),
) -> UserSummaryResponse:
    _require_file_in_drive(file_id, drive)
    now = datetime.now(UTC).isoformat()
    content = body.content.strip()
    with get_search_db() as session:
        session.execute(
            sql_text(
                "UPDATE file_insights SET status = 'superseded' "
                "WHERE file_id = :fid AND kind = :kind AND status = 'active'"
            ),
            {"fid": file_id, "kind": _KIND},
        )
        if content:
            session.execute(
                sql_text(
                    "INSERT INTO file_insights "
                    "(id, file_id, kind, content, metadata_json, "
                    " status, created_by, created_at) "
                    "VALUES (:id, :fid, :kind, :c, NULL, "
                    " 'active', 'manual', :ca)"
                ),
                {
                    "id": generate_insight_id(),
                    "fid": file_id,
                    "kind": _KIND,
                    "c": content,
                    "ca": now,
                },
            )
        return _read_active(session, file_id)
