"""``GET /api/health``: liveness plus a database round trip (public, not rate-limited)."""

from __future__ import annotations

import logging

from flask import Blueprint, Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from sotd.api.utils import json_response
from sotd.errors import ApiError
from sotd.extensions import db, limiter

logger = logging.getLogger(__name__)

bp = Blueprint("health", __name__)


@bp.get("/health")
@limiter.exempt
def health() -> Response:
    """Return ``{"status": "ok"}`` after ``SELECT 1``, or ``503`` if the database is down."""
    try:
        db.session.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        db.session.rollback()
        logger.warning("Health check failed: database unreachable (%s)", type(exc).__name__)
        raise ApiError(
            503, "service_unavailable", "The service is unavailable. Please try again later."
        ) from exc
    return json_response({"status": "ok"})
