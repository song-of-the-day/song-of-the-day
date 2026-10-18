"""Profile updates: username, display name, bio, theme and preferences."""

from __future__ import annotations

from flask import Blueprint, Response

from sotd.api.utils import json_response, parse_body
from sotd.schemas.auth import UserResponse
from sotd.schemas.profile import ProfileUpdateIn
from sotd.schemas.user import UserOut
from sotd.services import profile, sessions

bp = Blueprint("profile", __name__, url_prefix="/profile")


@bp.patch("")
@sessions.login_required
def update_profile() -> Response:
    """Update any subset of the profile fields (a complete theme); return the user."""
    body = parse_body(ProfileUpdateIn)
    user = profile.update_profile(
        sessions.current_account().id,
        username=body.username,
        display_name=body.display_name,
        bio=body.bio,
        theme=body.theme,
        autoplay_previews=body.autoplay_previews,
    )
    return json_response(UserResponse(user=UserOut.model_validate(user)))
