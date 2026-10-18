"""Wall-clock access.

Every server-side read of "now" or "today" goes through this module so that tests can
freeze time in one place (see ``tests/conftest.py``). Durations measured with a
monotonic timer (for example request timing in :mod:`sotd.logging`) are not wall-clock
reads and do not need to go through here.
"""

from datetime import UTC, date, datetime


def utcnow() -> datetime:
    """Return the current time as a timezone-aware UTC datetime."""
    return datetime.now(UTC)


def today_utc() -> date:
    """Return the current calendar date in UTC."""
    return utcnow().date()
