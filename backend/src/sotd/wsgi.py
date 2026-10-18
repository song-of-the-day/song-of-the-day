"""WSGI entry point for gunicorn: ``gunicorn sotd.wsgi:app``."""

from sotd import create_app

app = create_app()
