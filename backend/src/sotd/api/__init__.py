"""HTTP API blueprints, all mounted under ``/api``."""

from typing import Final

from flask import Flask

from sotd.api import (
    account,
    annotations,
    auth,
    entries,
    health,
    profile,
    songs,
    uploads,
    users,
)

API_PREFIX: Final = "/api"


def register_blueprints(app: Flask) -> None:
    """Mount every API blueprint under :data:`API_PREFIX`, keeping its own sub-prefix."""
    for blueprint in (
        health.bp,
        auth.bp,
        account.bp,
        profile.bp,
        entries.bp,
        annotations.bp,
        uploads.bp,
        users.bp,
        songs.bp,
    ):
        app.register_blueprint(blueprint, url_prefix=f"{API_PREFIX}{blueprint.url_prefix or ''}")
