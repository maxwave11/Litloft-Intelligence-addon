"""The analysis prompt, for any viewer who can open the drive.

Editing it is an admin route in ``routers/admin.py``.
"""

from __future__ import annotations

from fastapi import APIRouter

from app import analysis_prompt

router = APIRouter(tags=["analysis-prompt"])


@router.get("/analysis-prompt")
async def get_analysis_prompt() -> dict[str, str]:
    return {"prompt": analysis_prompt.effective_prompt()}
