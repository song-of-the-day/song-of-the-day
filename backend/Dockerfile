# syntax=docker/dockerfile:1.28.0
#
# Flask API image. Build from the repository root:
#   docker build -f backend/Dockerfile -t sotd-api .

ARG PYTHON_IMAGE=python:3.12.15-slim-trixie

FROM ghcr.io/astral-sh/uv:0.13.0 AS uv

# --- Builder: resolve the locked dependencies into /app/.venv -------------------
FROM ${PYTHON_IMAGE} AS builder

COPY --from=uv /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Dependencies only, so this layer is reused until pyproject.toml or uv.lock change.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock \
    uv sync --frozen --no-dev --no-install-project

COPY backend/pyproject.toml backend/uv.lock ./
COPY backend/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

# --- Runtime: the virtualenv, migrations and shared options/rules; no build tooling ---
FROM ${PYTHON_IMAGE} AS runtime

ENV APP_ENV=production \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/app/.venv/bin:$PATH \
    FLASK_APP=sotd:create_app \
    THEME_OPTIONS_PATH=/app/shared/theme-options.json \
    USERNAMES_PATH=/app/shared/usernames.json

RUN groupadd --system --gid 10001 sotd \
    && useradd --system --uid 10001 --gid sotd --no-create-home \
        --home-dir /nonexistent --shell /usr/sbin/nologin sotd

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY backend/migrations ./migrations
COPY backend/gunicorn.conf.py ./gunicorn.conf.py
COPY shared/theme-options.json shared/usernames.json ./shared/

USER 10001

EXPOSE 8000

CMD ["gunicorn", "-c", "gunicorn.conf.py", "sotd.wsgi:app"]
