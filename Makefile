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
# The heavy checks of every copy on this machine take turns, the push's among them (MOL-139).
ONE_AT_A_TIME = ./bin/one-at-a-time.sh "make $@"

.PHONY: help setup hooks up down reup ps logs psql migrate forget notify seed gates failures merge unmerge apart merge-night merge-candidates db-reset dev format lint typecheck test e2e check prod-build watcher certs icons ports

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
	@echo "hooks: pre-commit checks the formatting of the commit; everything else is CI's"
	@echo "       bypass a single run with --no-verify"

## --- dev stack -----------------------------------------------------------

up: ## Start Postgres and apply migrations
	$(REQUIRE_ENV)
	docker compose up -d --wait
	@if [ -f package.json ]; then $(MAKE) --no-print-directory migrate; \
	 else echo "Postgres is up on port $(POSTGRES_PORT); no scaffold yet, skipping migrations"; fi

down: ## Stop the stack, keeping the data
	docker compose --profile receipts down

reader: ## Start the receipt reader (Tesseract) for this copy
	$(REQUIRE_ENV)
	docker compose --profile receipts up -d --build receipt-reader
	@echo "receipt reader: http://127.0.0.1:$(RECEIPT_READER_PORT)/health"

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

# TG reaches the script through the environment, never pasted into the recipe: pasted in, even
# quoted, a value could close the quote and bring its own `--yes` (MOL-58, П-3). It is one argument.
# It erases only for YES=1 typed on this command line, as `seed` writes: `$(if $(YES),…)` read YES=0
# as yes and took a YES left in the shell as one too (MOL-112, adversarial Е). And TG is taken from
# this command line alone for the same reason: a TG left in the shell, with YES=1 typed without it,
# erased that person instead of printing the usage (MOL-91, adversarial Г).
forget: ## Erase a person by Telegram id: make forget TG=<id> [YES=1] (dry run without YES=1)
	$(NEED_SCAFFOLD)
	$(if $(filter command line,$(origin TG)),,unset TG;) ./bin/forget-actor.sh "$${TG:-}" $(if $(and $(filter command line,$(origin YES)),$(filter 1,$(YES))),--yes)

# The file and the countries reach the script through the environment, never pasted into the recipe,
# and only a value typed on this command line counts — as for `forget` (MOL-58, П-3; adversarial Е).
# It queues only for YES=1 typed here, and the file goes to the script's standard input (MOL-237).
# The countries go glued to `--country=`, so no value of COUNTRY is ever a flag (adversarial Р2-А2).
notify: ## Write to people about a leak: make notify FILE=<text> [COUNTRY=AM,GE] [OWNER=1] [YES=1] | STATUS=1 | CANCEL=1
	$(NEED_SCAFFOLD)
	$(if $(filter command line,$(origin FILE)),,unset FILE;) $(if $(filter command line,$(origin COUNTRY)),,unset COUNTRY;) ./bin/notify.sh "$${FILE:-}" "--country=$${COUNTRY:-}" $(if $(and $(filter command line,$(origin OWNER)),$(filter 1,$(OWNER))),--owner) $(if $(and $(filter command line,$(origin STATUS)),$(filter 1,$(STATUS))),--status) $(if $(and $(filter command line,$(origin CANCEL)),$(filter 1,$(CANCEL))),--cancel) $(if $(and $(filter command line,$(origin YES)),$(filter 1,$(YES))),--yes)

# No value from a person reaches the recipe, so unlike `forget` it needs no wrapper script. It
# writes only for YES=1 typed on this command line: `$(if $(YES),…)` read YES=0 as yes, and took a
# YES left in the shell's environment as one too (adversarial Е).
seed: ## Put the common names into the catalogue: make seed [YES=1] (dry run without YES=1)
	$(NEED_SCAFFOLD)
	npm run --silent seed -w @molvia/backend -- $(if $(and $(filter command line,$(origin YES)),$(filter 1,$(YES))),--yes)

# FROM and TO reach the script through the environment, never pasted into the recipe, for the
# reason `forget` gives (MOL-58, П-3). It only reads. Only a value typed on this command line
# counts, as `YES` of `forget`: a TO left in the shell turned «no TO — until now» into last
# week's window, and a FROM left there answered a bare `make gates` (adversarial В).
gates: ## Read gates 0.2 and 0.3: make gates FROM=<day|moment> [TO=<day|moment>]
	$(NEED_SCAFFOLD)
	$(if $(filter command line,$(origin FROM)),,unset FROM;) $(if $(filter command line,$(origin TO)),,unset TO;) ./bin/gates.sh "$${FROM:-}" "$${TO:-}"

failures: ## The latest failures of the API and the bot: make failures [LIMIT=20] (MOL-143)
	$(NEED_SCAFFOLD)
	$(if $(filter command line,$(origin LIMIT)),,unset LIMIT;) ./bin/failures.sh "$${LIMIT:-}"

# The ids and the number reach the script through the environment, never pasted into the recipe, and
# only a value typed on this command line counts — as for `forget` (MOL-58, П-3; adversarial Е).
merge: ## Merge a candidate of the morning's report by hand: make merge FROM=<id> INTO=<id> [YES=1] (MOL-106)
	$(NEED_SCAFFOLD)
	$(if $(filter command line,$(origin FROM)),,unset FROM;) $(if $(filter command line,$(origin INTO)),,unset INTO;) ./bin/merge.sh merge "$${FROM:-}" "$${INTO:-}" $(if $(and $(filter command line,$(origin YES)),$(filter 1,$(YES))),--yes)

unmerge: ## Undo a merge by its number in the report: make unmerge ID=<n> [YES=1] (MOL-106)
	$(NEED_SCAFFOLD)
	$(if $(filter command line,$(origin ID)),,unset ID;) ./bin/merge.sh unmerge "$${ID:-}" $(if $(and $(filter command line,$(origin YES)),$(filter 1,$(YES))),--yes)

apart: ## Two things never merged or named by the night: make apart FROM=<id> INTO=<id> [YES=1] (MOL-106)
	$(NEED_SCAFFOLD)
	$(if $(filter command line,$(origin FROM)),,unset FROM;) $(if $(filter command line,$(origin INTO)),,unset INTO;) ./bin/merge.sh apart "$${FROM:-}" "$${INTO:-}" $(if $(and $(filter command line,$(origin YES)),$(filter 1,$(YES))),--yes)

merge-night: ## Every pair a night merged, or would have: make merge-night DAY=<YYYY-MM-DD> (MOL-106)
	$(NEED_SCAFFOLD)
	$(if $(filter command line,$(origin DAY)),,unset DAY;) ./bin/merge.sh night "$${DAY:-}"

merge-candidates: ## Every candidate of the reports named and still apart, with its command (MOL-106)
	$(NEED_SCAFFOLD)
	./bin/merge.sh candidates

model: ## Fetch the embedding model of catalogue search into .models, checked by sha256 (MOL-105)
	node bin/fetch-model.mjs

dev: ## Run api, pwa and bot for this copy
	$(NEED_SCAFFOLD)
	npm run dev

## --- definition of done --------------------------------------------------

format: ## Autofix formatting and lint (MUTATES FILES)
	$(NEED_SCAFFOLD)
	$(ONE_AT_A_TIME) npm run format

lint: ## Check lint, including import boundaries (read-only)
	$(NEED_SCAFFOLD)
	$(ONE_AT_A_TIME) npm run lint

typecheck: ## Check types across the workspaces
	$(NEED_SCAFFOLD)
	$(ONE_AT_A_TIME) npm run typecheck

test: ## Run the tests
	$(NEED_SCAFFOLD)
	$(ONE_AT_A_TIME) npm run test

e2e: ## Run the end-to-end tests in a phone-sized browser
	$(NEED_SCAFFOLD)
	$(ONE_AT_A_TIME) npm run test:e2e

# One turn for the whole run, not one per step: between the steps another copy would slip in. On
# demand: the Definition of Done is a green CI (MOL-165).
check: ## Everything CI checks but end-to-end, in order: format, lint, typecheck, test
	$(NEED_SCAFFOLD)
	$(ONE_AT_A_TIME) $(MAKE) --no-print-directory format lint typecheck test

## --- misc ----------------------------------------------------------------

prod-build: ## Build the production images without deploying them
	@# The compose file demands real secrets before it will start anything, which is
	@# right at deploy time and pointless when only building. Placeholders satisfy the
	@# interpolation; nothing here reaches an image.
	DOMAIN=localhost POSTGRES_DB=molvia POSTGRES_USER=molvia POSTGRES_PASSWORD=build \
	TELEGRAM_BOT_TOKEN=build TELEGRAM_BOT_USERNAME=build_bot BOT_API_SECRET=build BOT_PULSE_URL= \
	docker compose -f docker-compose.prod.yml build

watcher: ## Roll the outside watch out to Cloudflare by hand: needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (MOL-221)
	./deploy/watch/deploy.sh

certs: ## Issue a locally trusted dev certificate, for testing the camera on a phone
	@command -v mkcert >/dev/null || { \
		echo "mkcert is not installed. brew install mkcert, then mkcert -install"; exit 1; }
	@mkdir -p frontend/certs
	cd frontend/certs && mkcert -key-file dev-key.pem -cert-file dev-cert.pem \
		localhost 127.0.0.1 $$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1)
	@echo "run the dev server on the network: PWA_EXPOSE=1 make dev"
	@echo "the phone must trust the same authority: mkcert -CAROOT, install rootCA.pem on it"

icons: ## Regenerate the app icons from the mark in favicon.svg
	python3 bin/make-icons.py

ports: ## Show this copy's index and ports
	$(REQUIRE_ENV)
	@echo "copy $(CLONE_INDEX): api $(API_PORT) · pwa $(PWA_PORT) · postgres $(POSTGRES_PORT) · db $(POSTGRES_DB) · reader $(RECEIPT_READER_PORT)"
	@# The e2e database is named by E2E_DATABASE_URL, so it is read from there rather than
	@# assembled here: a second place that decides the name is a second place to drift.
	@if [ -n "$(E2E_API_PORT)" ]; then \
		echo "       in e2e: api $(E2E_API_PORT) · pwa $(E2E_PWA_PORT) · db $(notdir $(E2E_DATABASE_URL))"; \
	else \
		echo "       in e2e: this .env predates MOL-60 — run: bin/init-env.sh $(CLONE_INDEX) --force"; \
	fi
