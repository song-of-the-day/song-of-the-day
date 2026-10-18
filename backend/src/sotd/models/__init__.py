"""SQLAlchemy 2.0 typed models. Importing this package registers every table."""

from sotd.models.entry import Annotation, Entry
from sotd.models.upload import Upload
from sotd.models.user import User, UserSession
from sotd.models.youtube_match import YouTubeMatch

__all__ = ["Annotation", "Entry", "Upload", "User", "UserSession", "YouTubeMatch"]
