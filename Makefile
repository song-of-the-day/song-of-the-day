# Song of the Day: developer commands. Run `make` (or `make help`) for the list.
#
# Configuration comes from the environment; this Makefile never reads .env. Override any
# variable on the command line or in your shell, e.g.
#   DATABASE_URL=postgresql+psycopg://sotd:sotd@localhost:54329/sotd make api
#   TEST_DATABASE_URL=postgresql+psycopg://sotd:sotd@localhost:54329/sotd_test make test

SHELL := bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help
.DELETE_ON_ERROR:
MAKEFLAGS += --no-builtin-rules --no-print-directory

BACKEND := backend
FRONTEND := frontend
COMPOSE ?= docker compose
E2E_COMPOSE := $(COMPOSE) -f docker-compose.yml -f docker-compose.e2e.yml

# The Flask CLI app for `flask run`, `flask db ...` and `flask sotd ...`.
export FLASK_APP := sotd:create_app

#: Extra arguments for pytest, vitest and Playwright (e.g. PYTEST_ARGS="-k entries -x").
PYTEST_ARGS ?=
VITEST_ARGS ?=
E2E_ARGS ?= --project=chromium
E2E_BASE_URL ?= http://localhost:8080
#: Throwaway password for the e2e stack's tmpfs database (it is never reachable from the host).
E2E_POSTGRES_PASSWORD ?= e2e-throwaway-postgres-password
BACKUP_DIR ?= backups

.PHONY: help
help: ## Show this help
	@echo "Usage: make <target> [VAR=value ...]"
	@echo
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z0-9_-]+:.*## / { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# --- Setup and local development ---------------------------------------------------

.PHONY: setup
setup: ## Install backend (uv) and frontend (pnpm) dependencies from the lockfiles
	cd $(BACKEND) && uv sync --locked
	cd $(FRONTEND) && pnpm install --frozen-lockfile

.PHONY: db
db: ## Start only the compose PostgreSQL (localhost:5432; needs POSTGRES_PASSWORD in .env)
	$(COMPOSE) up -d --wait db

.PHONY: migrate
migrate: ## Apply database migrations to DATABASE_URL
	cd $(BACKEND) && APP_ENV=development uv run flask db upgrade

.PHONY: api
api: ## Run the Flask API on :8000 with the debugger and reloader
	cd $(BACKEND) && APP_ENV=development uv run flask run --port 8000 --debug

.PHONY: web
web: ## Run the Vite dev server on :5173 (proxies /api to :8000)
	cd $(FRONTEND) && pnpm dev

.PHONY: prune
prune: ## Delete expired sessions and unreferenced uploads (flask sotd prune)
	cd $(BACKEND) && APP_ENV=development uv run flask sotd prune

# --- Quality checks ----------------------------------------------------------------

.PHONY: test
test: test-backend test-frontend ## Run all unit tests with coverage gates

.PHONY: test-backend
test-backend: ## pytest on real PostgreSQL (TEST_DATABASE_URL) with the 90% coverage gate
	cd $(BACKEND) && APP_ENV=testing uv run pytest -n auto --cov --cov-report=term-missing:skip-covered --cov-fail-under=90 $(PYTEST_ARGS)

.PHONY: test-frontend
test-frontend: ## Vitest with coverage thresholds (TZ=UTC)
	cd $(FRONTEND) && pnpm coverage $(VITEST_ARGS)

.PHONY: lint
lint: ## ruff check + ruff format --check, ESLint, Prettier --check
	cd $(BACKEND) && uv run ruff check . && uv run ruff format --check .
	cd $(FRONTEND) && pnpm lint && pnpm format:check

.PHONY: fmt
fmt: ## Auto-fix lint where safe and format all code
	cd $(BACKEND) && uv run ruff check --fix . && uv run ruff format .
	cd $(FRONTEND) && pnpm exec eslint --fix . && pnpm format

.PHONY: typecheck
typecheck: ## mypy --strict and tsc -b
	cd $(BACKEND) && uv run mypy
	cd $(FRONTEND) && pnpm typecheck

.PHONY: build-web
build-web: ## Production build of the SPA into frontend/dist
	cd $(FRONTEND) && pnpm build

.PHONY: check
check: lint typecheck test build-web ## Everything CI runs except e2e (run before every commit)

.PHONY: lint-ci
lint-ci: ## Validate .github/workflows with actionlint (Docker)
	docker run --rm -v "$(CURDIR)":/repo -w /repo rhysd/actionlint:1.7.12 -color

# --- Docker stacks -------------------------------------------------------------------

.PHONY: up
up: ## Build and start the production-like stack on http://localhost:8080 (needs .env)
	$(COMPOSE) up -d --build --wait

.PHONY: down
down: ## Stop the compose stack (data stays in the pgdata volume)
	$(COMPOSE) down

.PHONY: logs
logs: ## Follow the compose stack's logs
	$(COMPOSE) logs -f

.PHONY: e2e
e2e: ## Playwright against a fresh e2e stack on :8080 (stack is torn down afterwards)
	export POSTGRES_PASSWORD='$(E2E_POSTGRES_PASSWORD)'; \
	trap 'cd "$(CURDIR)" && $(E2E_COMPOSE) down -v --remove-orphans' EXIT; \
	$(E2E_COMPOSE) up -d --build --wait; \
	cd $(FRONTEND); \
	pnpm exec playwright install chromium; \
	E2E_BASE_URL='$(E2E_BASE_URL)' pnpm e2e $(E2E_ARGS)

.PHONY: backup
backup: ## pg_dump -Fc of the compose database into backups/ (BACKUP_DIR; includes uploads)
	umask 077; mkdir -p '$(BACKUP_DIR)'; \
	file='$(BACKUP_DIR)'/sotd-$$(date -u +%Y%m%dT%H%M%SZ).dump; \
	if $(COMPOSE) exec -T db pg_dump --username=sotd --dbname=sotd --format=custom >"$$file"; then \
		echo "Wrote $$file"; \
	else \
		rm -f "$$file"; exit 1; \
	fi
