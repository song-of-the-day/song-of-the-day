"""The demo account: a fresh install's worth of history for ``flask sotd seed-demo``."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import delete, select

from sotd.demo import load_demo_entries
from sotd.extensions import db
from sotd.models import Annotation, Entry, User
from sotd.security import hash_password

#: Login of the demo account.
DEMO_EMAIL: Final = "demo@example.com"
DEMO_USERNAME: Final = "demo"
#: A published development credential, not a secret.
DEMO_PASSWORD: Final = "demo-password-123"  # noqa: S105
DEMO_DISPLAY_NAME: Final = "Demo Listener"
DEMO_BIO: Final = "One song a day. Chasing the perfect chorus, logging the runners-up."

#: Days between two consecutive entries; the newest entry is dated today.
ENTRY_SPACING_DAYS: Final = 2


def seed_demo(*, now: datetime) -> int:
    """Create or reset the demo account and (re-)seed the bundled history.

    The newest entry is dated on ``now``'s UTC day and every following song two days
    earlier. An existing demo account is reset: its profile and password are replaced
    and its entries are deleted (their annotations cascade), so runs are idempotent.

    Args:
        now: The current instant (``sotd.clock.utcnow()``).

    Returns:
        The number of entries seeded.
    """
    entries = load_demo_entries()
    user = _reset_demo_user()
    today = now.astimezone(UTC).date()
    for offset, song in enumerate(entries):
        entry = Entry(
            user_id=user.id,
            entry_date=today - timedelta(days=ENTRY_SPACING_DAYS * offset),
            title=song["title"],
            artist=song["artist"],
            album=song["album"],
            artwork_url=song["artwork_url"],
            preview_url=song["preview_url"],
            duration_ms=song["duration_ms"],
            source="itunes",
            note=song.get("note"),
            youtube_video_id=song.get("youtube_video_id"),
        )
        db.session.add(entry)
        db.session.flush()  # Give the entry its id so its annotations can link to it.
        for annotation in song.get("annotations", ()):
            db.session.add(Annotation(entry_id=entry.id, **annotation))
    db.session.commit()
    return len(entries)


def _reset_demo_user() -> User:
    """Create the demo account, or reset an existing one and delete its entries."""
    user = db.session.scalar(
        select(User).where((User.email == DEMO_EMAIL) | (User.username == DEMO_USERNAME))
    )
    if user is None:
        user = User(email=DEMO_EMAIL, username=DEMO_USERNAME)
        db.session.add(user)
    else:
        db.session.execute(
            delete(Entry)
            .where(Entry.user_id == user.id)
            .execution_options(synchronize_session=False)
        )
    user.password_hash = hash_password(DEMO_PASSWORD)
    user.email = DEMO_EMAIL
    user.username = DEMO_USERNAME
    user.display_name = DEMO_DISPLAY_NAME
    user.bio = DEMO_BIO
    user.theme = {}
    user.autoplay_previews = True
    db.session.commit()
    return user
