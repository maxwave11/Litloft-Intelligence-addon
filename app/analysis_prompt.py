"""The prompt the "Copy for AI" button puts above a video's transcript.

The operator can replace the built-in text from the admin GUI; the choice is
kept in ``/intelligence-data/analysis-prompt-overrides.json``. The file is read
on every call, so a saved prompt applies to the next copy without a restart.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from app._overrides_io import (
    delete_override_file,
    overrides_path as _overrides_path,
    read_override_payload,
    write_override_payload,
)

logger = logging.getLogger(__name__)

OVERRIDES_FILENAME = "analysis-prompt-overrides.json"
SCHEMA_VERSION = 1
MAX_PROMPT_CHARS = 20_000

DEFAULT_PROMPT = """\
You are analysing one video. Below are its full transcript (split into chapters) and the top viewer comments from YouTube. I want to understand in two minutes what this video is about and what it claims.

The transcript is the primary source. The comments are secondary: use them only to see whether viewers agree, object, correct the speaker or add practical experience. A comment's weight is its like count; pinned comments and [AUTHOR] comments are the channel's own voice. Never present a comment's claim as the video's claim. Ignore spam, promotion and one-word reactions.

Write your answer in the language of the transcript, in this structure:

## TL;DR
2-3 sentences: what the video is and the one conclusion to take away.

## Key points
5-8 bullets, most important first. Each is a full claim, not a topic, with the speaker's reasoning or evidence in a clause. Mark claims the speaker gives no support for as "(unsupported)".

## Detailed breakdown
Follow the video's order (use the chapter headings when present). For each part: what is said, and the concrete numbers, names, steps and examples worth keeping.

## What the comments add
The themes of the most-liked comments: agreement, disagreement, corrections, extra information. Give the like count for the ones that matter. Omit this section if there are no comments.

## Caveats
Where the speaker is selling something (a course, a product, a link), where claims look one-sided or doubtful, and where the transcript looks garbled by auto-captioning.

Use only what is in the text below. If you add outside knowledge, label it "(outside the video)". No filler and no restating of these instructions."""


def overrides_path(data_dir: str | os.PathLike[str] | None = None) -> Path:
    return _overrides_path(OVERRIDES_FILENAME, data_dir)


def validate(prompt: str) -> None:
    """Raise ``ValueError`` with a message fit to show an operator."""
    if not prompt.strip():
        raise ValueError("the prompt must not be blank; use reset to go back to the default")
    if len(prompt) > MAX_PROMPT_CHARS:
        raise ValueError(f"the prompt must be at most {MAX_PROMPT_CHARS} characters")
    if "\x00" in prompt:
        raise ValueError("the prompt must not contain NUL characters")


def read_override(data_dir: str | os.PathLike[str] | None = None) -> str | None:
    raw = read_override_payload(
        OVERRIDES_FILENAME, schema_version=SCHEMA_VERSION, data_dir=data_dir
    )
    if raw is None:
        return None
    prompt = raw.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        logger.warning("Ignoring analysis prompt override: no usable text")
        return None
    return prompt


def write_override(
    prompt: str,
    *,
    data_dir: str | os.PathLike[str] | None = None,
    updated_at: str | None = None,
) -> Path:
    return write_override_payload(
        OVERRIDES_FILENAME,
        {"prompt": prompt},
        schema_version=SCHEMA_VERSION,
        data_dir=data_dir,
        updated_at=updated_at,
    )


def delete_override(data_dir: str | os.PathLike[str] | None = None) -> bool:
    return delete_override_file(OVERRIDES_FILENAME, data_dir)


def effective_prompt(data_dir: str | os.PathLike[str] | None = None) -> str:
    override = read_override(data_dir)
    return override if override is not None else DEFAULT_PROMPT
