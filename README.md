# song of the day ✦

Song of the Day is a quiet place to keep track of the music you love. Each day you log one song,
the one that stuck with you, with a note if you like, and over time your profile becomes a
personal board and calendar of your listening life. You can pin sticky notes to moments in a
song, and make the page your own with colors, fonts and a background. Your profile lives at
`/<username>`, and anyone you send the link to can look around (read-only, in your theme).
Sharing that link is the only social part: there are no likes, followers, feeds, search or
directory, and profiles ask search engines not to index them. It's a journal, not a social
network.

## Features

- **One song a day.** Search the Apple Music catalog or type a song in by hand; add a note and an
  optional YouTube link. Log past days, edit, swap the song or delete. Each entry opens read-only
  first; the owner edits it in place.
- **Your profile, two ways.** A month *Calendar* (the default) and a *Board* of album-art cards
  (newest first), at `/<username>`. Visitors with the link get a read-only view; the **Share**
  button (your device's share sheet, or copy the link) is the only way to share it.
- **Listen anywhere.** Every entry links to the song on Spotify, Apple Music, YouTube Music,
  Amazon Music, Tidal, Deezer and SoundCloud.
- **Sticky-note annotations.** Time-stamped point or range notes on a song's timeline, synced
  with the embedded YouTube player (click a note to jump there). Audio is never stored or
  re-hosted: only licensed embeds and 30-second Apple Music previews are used.
- **Auto-play previews.** Opening an entry starts its player, and picking a song while logging
  plays its 30-second preview. Visitors without an account always get auto-play; signed-in
  people can turn it off in Account settings.
- **Customization.** Presets, five colors, heading and body fonts, a background pattern or your
  own image, card styles and a default view, with a live preview and a contrast checker.
- **Your data.** Sign up with just a username, email and password. Change your display name,
  username (old links stop working) or password, reset it by email, export everything as JSON, or
  delete your account.
- **Y2K minimal.** Clean layouts with a few nostalgic touches; responsive from 360 px phones to
  desktops, keyboard accessible, and calm under `prefers-reduced-motion`.

## Tech stack

| Layer | Technology |
| --- | --- |
| Web | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query, Radix Dialog |
| API | Python 3.12, Flask 3, SQLAlchemy 2, Alembic, Pydantic v2, Flask-Login, Flask-WTF (CSRF), Flask-Limiter, argon2, Pillow |
| Data | PostgreSQL 17, Redis (rate-limit counters) |
| Serving | gunicorn behind nginx (unprivileged), Docker Compose |
| Quality | pytest, Vitest + Testing Library + MSW, Playwright, ruff, mypy (strict), ESLint, Prettier, GitHub Actions |

## Quick start

### With Docker (production-like)

```sh
cp .env.example .env      # fill in SECRET_KEY, POSTGRES_PASSWORD, APP_BASE_URL and MAIL_*
make up                   # build, migrate and start everything; waits until healthy
open http://localhost:8080
make down                 # stop (data stays in the pgdata volume)
```

The stack runs in production mode, so it refuses to start with an unsafe configuration. To try it
over plain http on localhost, also set `APP_BASE_URL=http://localhost:8080`,
`SESSION_COOKIE_SECURE=false` and, without an SMTP server, `MAIL_BACKEND=console` with
`ALLOW_CONSOLE_MAIL=true`.

### Local development

Requires [uv](https://docs.astral.sh/uv/), Node.js ≥ 22.22.2 with pnpm 11 (`corepack enable`), and
PostgreSQL 17 (via Docker or any local server).

```sh
make setup                # backend and frontend dependencies
cp .env.example .env      # set POSTGRES_PASSWORD=sotd for a local-only database
make db                   # PostgreSQL on localhost:5432
make migrate
make api                  # Flask on http://localhost:8000
make web                  # Vite on http://localhost:5173 (open this one)
```

Run `make help` for every command.

## Testing

```sh
make test                 # pytest (real PostgreSQL, >= 90% coverage) + Vitest (coverage thresholds)
make check                # lint, format check, type checks, tests and build: what CI runs
make e2e                  # Playwright against the Docker stack on :8080
```

Backend tests create and drop a fresh database per run on the `TEST_DATABASE_URL` server, so its
role needs `CREATEDB`. CI (GitHub Actions) runs the backend and frontend jobs, then the
end-to-end job against the production images.

## Deployment notes

- **Configuration** comes only from environment variables; [`.env.example`](.env.example)
  documents every one. Production requires a random `SECRET_KEY` (≥ 32
  characters), an `https://` `APP_BASE_URL`, SMTP mail with TLS, Redis rate-limit storage and an
  explicit `TRUSTED_PROXY_COUNT`; the API refuses to start otherwise and lists every problem.
- **TLS** terminates in front of the stack (a load balancer or a host reverse proxy such as
  Caddy or nginx) that forwards to the `web` container. Bind it privately with
  `WEB_PORT=127.0.0.1:8080`. Secure `__Host-` cookies and HSTS apply once the site is served
  over https.
- **`TRUSTED_PROXY_COUNT`** is the number of proxies in front of gunicorn: `1` for the bundled
  nginx alone (the compose default), `2` with a TLS proxy in front of nginx. In that case also
  switch nginx to forward the original scheme (see `frontend/nginx/api-proxy.conf`). Too high a
  value lets clients spoof their IP address and dodge rate limits.
- **Migrations** run automatically (`migrate` service) before the API starts, and must stay
  compatible with the previous release.
- **Backups:** `make backup` writes `backups/sotd-<timestamp>.dump` (`pg_dump -Fc`, uploaded
  images included). Restore with
  `docker compose exec -T db pg_restore --clean --if-exists --username=sotd --dbname=sotd < backups/<file>.dump`.
  Copy backups off the host.
- **Housekeeping:** run the prune job daily to delete expired sessions and unreferenced uploads,
  e.g. a cron entry:
  `17 3 * * * cd /srv/sotd && docker compose exec -T api flask sotd prune`.
- **Scaling:** `WEB_CONCURRENCY` sets gunicorn workers (default 2). Logs are JSON lines on stdout
  with a request id that nginx also logs and echoes in `X-Request-ID`.
