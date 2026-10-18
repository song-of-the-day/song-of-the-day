"""Bundled demo data for ``flask sotd seed-demo``.

``entries.json`` is the demo history (newest first): each row is one song's real iTunes
metadata, plus the note, YouTube link and annotations some entries carry. It was fetched
once from the public iTunes Search API and is checked in, so seeding is offline and
deterministic. Regenerate it deliberately, by hand.
"""

from __future__ import annotations

import json
from functools import cache
from importlib.resources import files
from typing import Any


@cache
def load_demo_entries() -> list[dict[str, Any]]:
    """Return the bundled demo entries (newest first), read once per process."""
    text = files(__name__).joinpath("entries.json").read_text(encoding="utf-8")
    entries: list[dict[str, Any]] = json.loads(text)
    return entries
