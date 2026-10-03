# Map · Repository, tooling, module configs

Rules: `.claude/rules/workspace.md`; the working-copy scripts, `Makefile`, `.env.example` and
`docker-compose.yml` also `.claude/rules/dev-copies.md`. A test beside its source, or mirroring it
under `packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/eslint.config.js` — Domain lint config: the shared preset plus the boundary that `src` imports nothing but zod.
- `packages/model/package.json` — Domain package: exports its TypeScript source and the test search corpus, declares the `#model` subpath imports; zod only.
- `packages/model/tsconfig.json` — Domain TypeScript config: the shared base, no DOM, no node types; covers `src` and `tests`.
- `packages/model/vitest.config.ts` — Domain Vitest project: tests under `tests/`, Node environment, nothing to set up.

## packages/client

- `packages/client/eslint.config.js` — Client lint config: the shared preset in its browser flavour.
- `packages/client/package.json` — Typed API client package: exports its TypeScript source, declares the `#client` subpath imports; depends on the model and zod.
- `packages/client/tsconfig.json` — Client TypeScript config: the shared base with DOM types.
- `packages/client/vitest.config.ts` — Client Vitest project: tests beside the source, Node environment.

## backend · other

- `backend/drizzle.config.ts` — drizzle-kit config: generates migrations from `backend/src/db/schema.ts` into `backend/drizzle/`.
- `backend/eslint.config.js` — API lint config: use cases without HTTP, routes without the database, rate feeds without anything but a provider.
- `backend/package.json` — API package: dev and start, migrate, forget, seed, gates CLIs, bundle, and unit, integration and attack test scripts.
- `backend/tsconfig.json` — API TypeScript config: the shared base with Node types and `@/` to `src`; covers `src` and `tests`.
- `backend/vitest.attack.config.ts` — Vitest config for adversarial attack files copied in from `.scratch`, where green means the defect is alive; never in `make check`.
- `backend/vitest.config.ts` — API unit and use-case Vitest project: tests beside the source, no database.
- `backend/vitest.integration.config.ts` — API integration Vitest project: `tests/` against the copy's test database, files in parallel, each worker in a copy of it, attack files excluded.

## frontend · other

- `frontend/eslint.config.js` — PWA lint config: Vue and TypeScript type-aware, SFC block order, no bare strings in templates, the import boundaries.
- `frontend/package.json` — PWA package: Vue, Pinia, vue-router, vue-i18n, Reka UI, Vite with the PWA and icons plugins; dev, build, lint and style lint.
- `frontend/tsconfig.json` — PWA TypeScript config: DOM, Vite, PWA and icon types, `@/` to `src`, `.vue` files and the Stylelint plugin's test included.
- `frontend/vitest.config.ts` — PWA component Vitest project: Vue and icons plugins, happy-dom, the time zone pinned to UTC; also runs the Stylelint plugin's test.

## bot

- `bot/eslint.config.js` — Bot lint config: the shared preset plus no database driver — the bot is a client of the API.
- `bot/package.json` — Bot package: grammY and its runner, the API client and model; dev, start, bundle, lint and test scripts.
- `bot/tsconfig.json` — Bot TypeScript config: the shared base with Node types and `@/` to `src`.
- `bot/vitest.config.ts` — Bot Vitest project: tests beside the source, Node environment.

## repository

- `.editorconfig` — Editor settings: UTF-8, LF, two-space indent, tabs in the Makefile.
- `.env.example` — Sample of the generated `.env` for copy 0: ports, databases (dev, test, e2e), bot settings, rate provider URLs.
- `.githooks/commit-msg` — Git hook: refuses a subject that is not a Conventional Commit with the Jira key as scope.
- `.githooks/pre-commit` — Git hook: refuses a commit whose files are not formatted by Prettier; every other check is CI's.
- `.github/dependabot.yml` — Dependabot: weekly grouped npm updates and monthly GitHub Actions updates.
- `.github/workflows/ci.yml` — CI on push and pull request: format check, lint, types and tests against Postgres, the receipt reader's image and its live test, and end-to-end in a phone browser — the only place any check runs unasked; both jobs gate a merge.
- `.gitignore` — Ignored files: env files, the `.scratch` and `.lavish` links, dependencies, builds, certificates, Playwright output.
- `.nvmrc` — The Node major version, 22.
- `.prettierignore` — What Prettier leaves alone: builds, the lockfile, the shared links, hooks, recorded rate-provider responses.
- `.prettierrc.json` — Prettier settings: no semicolons, single quotes, width 100, trailing commas.
- `Makefile` — The canonical entry point: setup, stack, the receipt reader, database, migrate, forget, seed, gates, dev, format, lint, typecheck, test, check, certs, icons.
- `bin/check-code-map.mjs` — Refuses a code map that lies: a file it does not cover, a path that does not exist, a file with two homes; run by `npm run lint`.
- `bin/design-md.mjs` — The token block of `frontend/DESIGN.md` from `_tokens.scss`, through Prettier: `--write` in `npm run format`, `--check` in `npm run lint`.
- `bin/init-env.sh` — Generates this copy's `.env` from its index: ports — the receipt reader's too — databases, compose project; keeps bot settings across `--force`.
- `bin/fetch-model.mjs` — Fetches the pinned embedding model (MOL-105) into `.models/` or a given directory, file by file against its sha256, with the notice of its terms; `make model`, CI and the API's image.
- `bin/link-shared.sh` — Points `.scratch`, `.lavish` and `.models` at the directory shared by all working copies; idempotent.
- `bin/one-at-a-time.sh` — Runs a command under the one lock all copies share, so the heavy checks of several copies take turns; gives the command no terminal so vitest does not watch by default, refuses a vitest told to watch and Playwright's UI and debugger, names the waited copy by its root.
- `docker-compose.yml` — Development stack: this copy's Postgres on the loopback, named by the copy's index; the receipt reader only under the `receipts` profile (`make reader`).
- `eslint.config.base.js` — Shared lint preset every module opts into: type-aware rules, the alias-or-sibling import shape, the `deny` helper.
- `eslint.config.js` — Root lint config: only `e2e/` and the repository's own config files; each module lints itself.
- `package.json` — Root workspace: the module list and the repository-wide dev, lint, format, typecheck, test and e2e scripts, shared dev tools.
- `services/README.md` — What `services/` is: non-TypeScript services, outside the workspaces and never reaching the database — the receipt reader the API calls.
- `tsconfig.base.json` — Shared strict TypeScript options every module extends.
- `tsconfig.json` — Root TypeScript config: type-checks `e2e/` and the root config files.
- `vitest.config.ts` — Root Vitest run: gathers the modules' projects, coverage with a threshold on the domain only.
