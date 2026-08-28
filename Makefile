# Canonical entry point for routine operations. Prefer a make target over a raw script:
# scripts in bin/ cover sub-operations the Makefile does not.
#
# Ports, database name and compose project all come from .env, which is generated per
# working copy by bin/init-env.sh — see "Several clones in parallel" in CLAUDE.md.

SHELL := /bin/bash
.DEFAULT_GOAL := help

ifneq (,$(wildcard .env))
include .env
export
endif

REQUIRE_ENV = @test -f .env || { echo "no .env in this copy — run: make setup"; exit 1; }
NEED_SCAFFOLD = @test -f package.json || { echo "no scaffold yet (package.json is missing) — this target goes live once the workspaces land"; exit 1; }

.PHONY: help setup hooks up down reup ps logs psql migrate db-reset dev format lint typecheck test e2e check prod-build certs icons ports

help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

## --- setup ---------------------------------------------------------------

setup: ## Prepare a fresh working copy: symlinks, .env, dependencies
	./bin/link-shared.sh
	@test -f .env && echo ".env already exists, keeping it" || ./bin/init-env.sh
	@if [ -f package.json ]; then npm install; else echo "no scaffold yet — skipping npm install"; fi
	$(MAKE) --no-print-directory hooks

hooks: ## Point git at the repository's hooks (per clone; worktrees share it)
	git config core.hooksPath .githooks
	@echo "hooks: pre-commit checks format and lint, pre-push runs types and every test"
	@echo "       bypass a single run with --no-verify"

## --- dev stack -----------------------------------------------------------

up: ## Start Postgres and apply migrations
	$(REQUIRE_ENV)
	docker compose up -d --wait
	@if [ -f package.json ]; then $(MAKE) --no-print-directory migrate; \
	 else echo "Postgres is up on port $(POSTGRES_PORT); no scaffold yet, skipping migrations"; fi

down: ## Stop the stack, keeping the data
	docker compose down

reup: down up ## Restart the stack

ps: ## Show this copy's containers
	docker compose ps

logs: ## Follow Postgres logs
	docker compose logs -f postgres

psql: ## Open psql inside this copy's database
	$(REQUIRE_ENV)
	docker compose exec postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

db-reset: ## Drop this copy's database volume and start clean (DESTRUCTIVE)
	$(REQUIRE_ENV)
	@read -p "Drop database $(POSTGRES_DB) of copy $(CLONE_INDEX)? All data is lost. [y/N] " ok; \
		[ "$$ok" = "y" ] || { echo "cancelled"; exit 1; }
	docker compose down -v
	$(MAKE) --no-print-directory up

migrate: ## Apply migrations
	$(NEED_SCAFFOLD)
	npm run migrate

dev: ## Run api, pwa and bot for this copy
	$(NEED_SCAFFOLD)
	npm run dev

## --- definition of done --------------------------------------------------

format: ## Autofix formatting and lint (MUTATES FILES)
	$(NEED_SCAFFOLD)
	npm run format

lint: ## Check lint, including import boundaries (read-only)
	$(NEED_SCAFFOLD)
	npm run lint

typecheck: ## Check types across the workspaces
	$(NEED_SCAFFOLD)
	npm run typecheck

test: ## Run the tests
	$(NEED_SCAFFOLD)
	npm run test

e2e: ## Run the end-to-end tests in a phone-sized browser
	$(NEED_SCAFFOLD)
	npm run test:e2e

check: format lint typecheck test ## Definition of Done, in order

## --- misc ----------------------------------------------------------------

prod-build: ## Build the production images without deploying them
	@# The compose file demands real secrets before it will start anything, which is
	@# right at deploy time and pointless when only building. Placeholders satisfy the
	@# interpolation; nothing here reaches an image.
	DOMAIN=localhost POSTGRES_DB=molvia POSTGRES_USER=molvia POSTGRES_PASSWORD=build \
	TELEGRAM_BOT_TOKEN=build docker compose -f docker-compose.prod.yml build

certs: ## Issue a locally trusted dev certificate, for testing the camera on a phone
	@command -v mkcert >/dev/null || { \
		echo "mkcert is not installed. brew install mkcert, then mkcert -install"; exit 1; }
	@mkdir -p apps/pwa/certs
	cd apps/pwa/certs && mkcert -key-file dev-key.pem -cert-file dev-cert.pem \
		localhost 127.0.0.1 $$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1)
	@echo "run the dev server on the network: PWA_EXPOSE=1 make dev"
	@echo "the phone must trust the same authority: mkcert -CAROOT, install rootCA.pem on it"

icons: ## Regenerate the app icons from the mark in favicon.svg
	python3 bin/make-icons.py

ports: ## Show this copy's index and ports
	$(REQUIRE_ENV)
	@echo "copy $(CLONE_INDEX): api $(API_PORT) · pwa $(PWA_PORT) · postgres $(POSTGRES_PORT) · db $(POSTGRES_DB)"
