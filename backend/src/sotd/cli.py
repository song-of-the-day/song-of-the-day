"""Flask CLI commands: ``flask sotd ...``."""

from __future__ import annotations

import click
from flask import Flask, current_app
from flask.cli import AppGroup

from sotd import clock
from sotd.extensions import db
from sotd.services.demo import DEMO_EMAIL, DEMO_USERNAME, seed_demo
from sotd.services.housekeeping import (
    UNREFERENCED_UPLOAD_GRACE,
    delete_expired_sessions,
    delete_expired_youtube_matches,
    delete_unreferenced_uploads,
)

sotd_cli = AppGroup("sotd", help="Song of the Day maintenance commands.")


@sotd_cli.command("prune")
def prune_command() -> None:
    """Delete expired sessions, stale uploads and expired YouTube matches."""
    now = clock.utcnow()
    sessions = delete_expired_sessions(now=now)
    uploads = delete_unreferenced_uploads(older_than=now - UNREFERENCED_UPLOAD_GRACE)
    matches = delete_expired_youtube_matches(now=now)
    db.session.commit()
    click.echo(
        f"Pruned {sessions} expired session(s), {uploads} unreferenced upload(s) "
        f"and {matches} expired YouTube match(es)."
    )


@sotd_cli.command("seed-demo")
def seed_demo_command() -> None:
    """Seed or reset the demo account with the bundled history (development only)."""
    if current_app.config["APP_ENV"] == "production":
        raise click.ClickException("seed-demo refuses to run with APP_ENV=production.")
    count = seed_demo(now=clock.utcnow())
    click.echo(f"Seeded {count} entries for {DEMO_USERNAME} ({DEMO_EMAIL}).")


def init_app(app: Flask) -> None:
    """Register the ``sotd`` command group on ``app``."""
    app.cli.add_command(sotd_cli)
