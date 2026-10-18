"""Gunicorn settings for the API container.

Loaded with ``gunicorn -c gunicorn.conf.py sotd.wsgi:app``. Only ``WEB_CONCURRENCY`` is
read from the environment; everything else is fixed so every deployment behaves the same.
Reverse-proxy headers are handled by the app (``ProxyFix``, ``TRUSTED_PROXY_COUNT``), not
by gunicorn.
"""

import os

# The container's port; it is only reachable on the compose network (nginx proxies to it).
bind = "0.0.0.0:8000"
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
worker_class = "sync"

timeout = 60
graceful_timeout = 30
keepalive = 5

# Recycle workers periodically (jittered so they don't all restart at once).
max_requests = 1000
max_requests_jitter = 100

# Worker heartbeat files on tmpfs: a disk-backed /tmp can stall heartbeats under I/O load.
worker_tmp_dir = "/dev/shm"  # noqa: S108

accesslog = "-"
errorlog = "-"
