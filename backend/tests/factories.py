"""Model factories. Each call inserts and commits one row and returns the live object."""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta
from typing import Any

from flask import Flask
from sqlalchemy.orm import Session

from sotd.models import Annotation, Entry, Upload, User
from sotd.security import hash_password

DEFAULT_PASSWORD = "correct horse battery staple"
#: Date of the first entry an EntryFactory creates; later ones go one day further back.
FIRST_ENTRY_DATE = date(2026, 10, 11)


class UserFactory:
    """Creates users with real (cheap, testing-profile) argon2 password hashes.

    Unless given, the email is ``user<n>@example.com`` and the username ``user<n>``,
    ``n`` counting the users this factory created.
    """

    def __init__(self, app: Flask, session: Session) -> None:
        self._app = app
        self._session = session
        self._count = 0

    def __call__(
        self,
        *,
        email: str | None = None,
        username: str | None = None,
        password: str = DEFAULT_PASSWORD,
        display_name: str = "Ada",
        bio: str = "",
        theme: dict[str, Any] | None = None,
        autoplay_previews: bool = True,
    ) -> User:
        self._count += 1
        with self._app.app_context():
            password_hash = hash_password(password)
        user = User(
            email=email or f"user{self._count}@example.com",
            username=username or f"user{self._count}",
            password_hash=password_hash,
            display_name=display_name,
            bio=bio,
            theme=theme if theme is not None else {},
            autoplay_previews=autoplay_previews,
        )
        self._session.add(user)
        self._session.commit()
        return user


class EntryFactory:
    """Creates entries on distinct dates, counting back from :data:`FIRST_ENTRY_DATE`."""

    def __init__(self, session: Session, user_factory: UserFactory) -> None:
        self._session = session
        self._user_factory = user_factory
        self._count = 0

    def __call__(
        self,
        *,
        user: User | None = None,
        entry_date: date | None = None,
        title: str = "Gosh",
        artist: str = "Jamie xx",
        source: str = "manual",
        **fields: Any,
    ) -> Entry:
        self._count += 1
        entry = Entry(
            user=user or self._user_factory(),
            entry_date=entry_date or FIRST_ENTRY_DATE - timedelta(days=self._count - 1),
            title=title,
            artist=artist,
            source=source,
            **fields,
        )
        self._session.add(entry)
        self._session.commit()
        return entry


class AnnotationFactory:
    """Creates annotations (a point note at 0 ms by default)."""

    def __init__(self, session: Session, entry_factory: EntryFactory) -> None:
        self._session = session
        self._entry_factory = entry_factory

    def __call__(
        self,
        *,
        entry: Entry | None = None,
        start_ms: int = 0,
        end_ms: int | None = None,
        body: str = "the build",
        color: str = "yellow",
    ) -> Annotation:
        annotation = Annotation(
            entry=entry or self._entry_factory(),
            start_ms=start_ms,
            end_ms=end_ms,
            body=body,
            color=color,
        )
        self._session.add(annotation)
        self._session.commit()
        return annotation


class UploadFactory:
    """Creates uploads holding a few placeholder bytes."""

    def __init__(self, session: Session, user_factory: UserFactory) -> None:
        self._session = session
        self._user_factory = user_factory

    def __call__(
        self,
        *,
        user: User | None = None,
        data: bytes = b"RIFF\x00\x00\x00\x00WEBP",
        created_at: datetime | None = None,
    ) -> Upload:
        upload = Upload(
            user=user or self._user_factory(),
            content_type="image/webp",
            data=data,
            byte_size=len(data),
            width=1,
            height=1,
            sha256=hashlib.sha256(data).hexdigest(),
        )
        if created_at is not None:
            upload.created_at = created_at
        self._session.add(upload)
        self._session.commit()
        return upload
