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
- `frontend/package.json` — PWA package: Vue, Pinia, vue-router, vue-i18n, Reka UI, Vite with the PWA and icons plugins; dev, build, lint and style lint; one export, `./testing/root-font-size`, for the guard's tests and e2e.
- `frontend/tsconfig.json` — PWA TypeScript config: DOM, Vite, PWA and icon types, `@/` to `src`, `.vue` files, the Stylelint plugin's test and `testing/` included.
- `frontend/testing/page-environment.ts` — The PWA tests' Vitest environment: happy-dom whose timers are cleared as its window is taken down, so none fires into a worker with no `window` (MOL-286).
- `frontend/testing/root-font-size.ts` — `setsRoot` and `zooms`: whether CSS sets the root's `font-size`, fail-closed, or a `zoom` on any element, under any condition — one rule for the guard of the sources (`useLargeText.test.ts`) and for the build and the pages in `e2e/large-text.spec.ts` (MOL-334).
- `frontend/vitest.config.ts` — PWA component Vitest project: Vue and icons plugins, the page environment over happy-dom, the time zone pinned to UTC; also runs the Stylelint plugin's and the environment's tests.

## bot

- `bot/eslint.config.js` — Bot lint config: the shared preset plus no database driver — the bot is a client of the API.
- `bot/package.json` — Bot package: grammY and its runner, the API client and model; dev, start, bundle, lint and test scripts.
- `bot/tsconfig.json` — Bot TypeScript config: the shared base with Node types and `@/` to `src`.
- `bot/vitest.config.ts` — Bot Vitest project: tests beside the source, Node environment.

## deploy · watch

- `deploy/watch/eslint.config.js` — Outside watch lint config (MOL-221): the shared preset plus no `node:*` in the source — it runs on Cloudflare Workers; the tests typed by `tests/tsconfig.json`, the Vitest config by the default project.
- `deploy/watch/package.json` — Outside watch package: no dependencies; bundle (esbuild, one ES module), lint and test scripts.
- `deploy/watch/tsconfig.json` — Outside watch TypeScript config of the source: the web platform alone (`WebWorker`, no Node types), so Node's API is a type error; `@/` to `src`.
- `deploy/watch/tests/tsconfig.json` — Outside watch TypeScript config of the tests and the Vitest config: the source's, plus Node's types; a directory of its own, so the lint finds it without the default project.
- `deploy/watch/vitest.config.ts` — Outside watch Vitest project: tests in `tests/`, apart from the source by its types, Node environment.

## repository

- `.editorconfig` — Editor settings: UTF-8, LF, two-space indent, tabs in the Makefile.
- `.env.example` — Sample of the generated `.env` for copy 0: ports, databases (dev, test, e2e), bot settings, rate provider URLs.
- `.githooks/commit-msg` — Git hook: refuses a subject that is not a Conventional Commit with the Jira key as scope, and any `Co-Authored-By` line.
- `.githooks/pre-commit` — Git hook: refuses a commit whose files are not formatted by Prettier; every other check is CI's.
- `.github/dependabot.yml` — Dependabot: weekly grouped npm updates and base images, monthly GitHub Actions updates.
- `.github/scanners/gitleaks/Dockerfile` — gitleaks of CI (MOL-369): its official image by tag and digest as `runtime`, `USER 1001` the runner's uid, nothing of ours built — here so that Dependabot's `images` moves it and `bin/check-pins.mjs` holds it; `ci.yml` builds and runs it.
- `.github/workflows/ci.yml` — CI on push and pull request: format check, lint, types and tests against Postgres, the receipt reader's image and its live test, and end-to-end in a phone browser, in the image of Playwright of the lockfile's version (MOL-295) — the only place any check runs unasked; both jobs gate a merge.
- `.gitignore` — Ignored files: env files, the `.scratch` and `.lavish` links, dependencies, builds, certificates, Playwright output.
- `.gitleaks.toml` — gitleaks' rules (MOL-369): its defaults, a ping URL of healthchecks.io, and the tests' values let go for the generic rule alone, by value — ids, builds, the session token of the tests, a draft's key, the model's sha256 in `model.json` only.
- `.gitleaksignore` — The fingerprints of secrets gitleaks found in a commit and that were rotated (MOL-369, Р-4), each with what it was and the day; never a test value.
- `.nvmrc` — The Node major version, 22.
- `.prettierignore` — What Prettier leaves alone: builds, the lockfile, the shared links, hooks, recorded rate-provider responses.
- `.prettierrc.json` — Prettier settings: no semicolons, single quotes, width 100, trailing commas.
- `Makefile` — The canonical entry point: setup, stack, the receipt reader, database, migrate, forget, seed, gates, dev, format, lint, typecheck, test, check, the outside watch to Cloudflare (`watcher`), certs, icons.
- `bin/check-clock-bounds.mjs` — Refuses a bound on a duration a test asserts other than through `expectWithin` (MOL-266), found by parsing — a subtraction of two readings of the clock, through names resolved by TypeScript's binder and the file's helpers, bounded in the spellings of vitest, chai and `assert` its head lists, fake time left alone; run by `npm run lint`.
- `bin/check-clock-bounds.d.mts` — Types of the clock check for its test: the check is plain JS.
- `bin/check-clock-bounds.test.ts` — Test: a bound on a duration found written any way — a name, a helper of the file and a mention of it, an object it is put in, `expect(d < n)` asserted either way, a budget, a clock under another name, real time beside fake timers; a lower bound, `expectWithin`, the age of a stamp and fake time left alone.
- `bin/check-ordered-reads.mjs` — Refuses rows an integration test reads with no ORDER BY and uses in an order (MOL-323), closed at each place it recognises something — what reads, what orders, what the rows are used for — by one rule, in doubt there is no order; chance, identities and unique keys read from the schema; the price a closed list of classes in its head; run by `npm run lint`.
- `bin/check-ordered-reads.d.mts` — Types of the order check for its test: the check is plain JS.
- `bin/check-ordered-reads.test.ts` — Test: rows with no order refused in every use not known orderless — an index, a name of a name, an object, `Promise.all`, `.join`, `.resolves`, a spread, a callback by the index, a helper naming its read or learning its order late, `order by` of an aggregate, a comment or a string, `orderBy()`; rows of chance refused against what is written in place and let meet a snapshot; the first row, `find`, `sort`, `reduce`, `slice`, a value by its key and a loop that collects or leaves at a row refused (round 14), and anything a callback or a loop may change outside it — a call, `new`, a query by a tag, a write taken apart, `delete`, an alias, `this`, the platform's `fetch` and `console` (round 15), any call of the platform in a file that spies on it (round 16), a snapshot or a matcher of `extend` (round 17); a `limit`, an aggregate or a window of a place with no order by of its own, in SQL text and in Drizzle (round 18); an order, a length, `onlyRow`, `sorted` and `sum` by their import, a loop of assertions, a `Set`, `arrayContaining` and a select with no `from` left alone; the schema's columns of chance read; the files read, the helpers beside the tests among them.
- `bin/check-code-map.mjs` — Refuses a code map that lies: a file it does not cover, a path that does not exist, a file with two homes; run by `npm run lint`.
- `bin/check-playwright-image.mjs` — Refuses an image of Playwright in `ci.yml` (the value of `image:`, never a comment) that is not the version of `@playwright/test`, its `playwright` and `playwright-core` as Node resolves them from `package-lock.json` (MOL-295), with the tag to set; run by `npm run lint`.
- `bin/check-playwright-image.d.mts` — Types of the image check for its test: the check is plain JS.
- `bin/check-playwright-image.test.ts` — Test: the image of the chain's version passes, a hoisted `playwright` and a prerelease too; a lockfile raised without it, a digest, the packages apart, a floating image behind a comment, a second image, no image and no packages are refused; the repository as it stands passes.
- `bin/check-pins.mjs` — Refuses an action or an image CI runs by a pointer someone else can move (MOL-364), the files chosen by their paths from `git ls-files`: a `uses:` of a workflow or of an action of the repository (`action.yml` anywhere) that is not a full sha with its release (`X.Y` at least) in a comment; an image — an action's `image: docker://…`, a Dockerfile's (Dependabot's word as a part of its name in any case, no extension of another kind; a workflow or an action read as one first) `# syntax=`, `FROM`, `COPY --from`, `RUN --mount=…,from=`, lines joined at `\` (CRLF, a blank line inside, quotes taken off) — without an exact tag (three numbers or a snapshot's day) and its digest; a directory with a Dockerfile that takes an image the docker entry of `dependabot.yml` does not list. A stage of the file after its own line, `scratch` and a local action left alone; the ordinary spelling only. And a Dockerfile whose last stage is not named `runtime`, or names no `USER`, or root by name, uid 0 in any spelling of the number or the group root, or an argument (`lastStageProblems`, MOL-365); the body of a heredoc — one begun by a whole word, its word read as the shell reads it, and closed, or it is none — is no instruction, and a backslash outside single quotes escapes in a word of the instruction, never in a mount's CSV; `ONBUILD` takes its instruction's heredocs; run by `npm run lint`.
- `bin/check-pins.d.mts` — Types of the pin check for its test: the check is plain JS.
- `bin/check-pins.test.ts` — Test: a sha with its release, quoted, a reusable workflow, a stage, `scratch`, a platform flag and a snapshot's tag pass; a tag, a branch, a short sha, a major or no release named, `docker://`, a floating image, a tag or a digest alone, a stage named as its image or below, an image of `COPY --from`, a mount, a continued line, a syntax directive or a Docker action, an image by an argument, an action in a directory of its own, a Dockerfile by another name, a pattern of directories and a Dockerfile Dependabot does not watch are refused; a container of a workflow is left alone; a last stage `runtime` with a user by name, uid or group, and root for a `RUN` and back, pass, while a last stage named otherwise, with no `USER` of its own, root by name, by `0`, `00`, `+0`, `-0` or by its group, or a user by an argument is refused, and the body of a heredoc reads no `USER`, `FROM` or image, while `<<` inside a word, a quote or arithmetic begins none, `<<\EOF` and `<<E"O"F` end at `EOF`, a heredoc never closed is read as instructions and `it\'s` opens no quote; the repository as it stands passes.
- `bin/design-md.mjs` — The token block of `frontend/DESIGN.md` from `_tokens.scss`, through Prettier: `--write` in `npm run format`, `--check` in `npm run lint`.
- `bin/init-env.sh` — Generates this copy's `.env` from its index: ports — the receipt reader's too — databases, compose project; keeps bot settings across `--force`; the databases' host and port from `MOLVIA_PG_HOST`/`MOLVIA_PG_PORT` where given (CI's container, MOL-295).
- `bin/fetch-model.mjs` — Fetches the pinned embedding model (MOL-105) into `.models/` or a given directory, file by file against its sha256, with the notice of its terms; `make model`, CI and the API's image.
- `bin/link-shared.sh` — Points `.scratch`, `.lavish` and `.models` at the directory shared by all working copies; idempotent.
- `bin/test-time-reporter.ts` — The time reporter of the root run (MOL-266): a test, a `beforeAll`/`afterAll` or a bound on the clock whose time, ten times over, passes its limit, by the rule of MOL-243 — red on CI in a file the pull request changes, a warning elsewhere and here; prints what it measures for the next measure.
- `bin/test-time-reporter.fixture.ts` — A test file the reporter's test runs through vitest itself: hooks that wait set times, a quick one past a limit of its own, a test with its own timeout, two bounds on the clock and one on fake clocks.
- `bin/one-at-a-time.sh` — Runs a command under the one lock all copies share, so the heavy checks of several copies take turns; gives the command no terminal so vitest does not watch by default, refuses a vitest told to watch and Playwright's UI and debugger, names the waited copy by its root.
- `docker-compose.yml` — Development stack: this copy's Postgres on the loopback, named by the copy's index; the receipt reader only under the `receipts` profile (`make reader`).
- `eslint.config.base.js` — Shared lint preset every module opts into: type-aware rules, the alias-or-sibling import shape, the `deny` and `boundary` helpers.
- `eslint.config.js` — Root lint config: only `e2e/` and the repository's own config files; each module lints itself.
- `package.json` — Root workspace: the module list, the outside watch among them (MOL-221), and the repository-wide dev, lint, format, typecheck, test and e2e scripts, shared dev tools.
- `services/README.md` — What `services/` is: non-TypeScript services, outside the workspaces and never reaching the database — the receipt reader the API calls.
- `tsconfig.base.json` — Shared strict TypeScript options every module extends.
- `tsconfig.json` — Root TypeScript config: type-checks `e2e/`, the root config files and the TypeScript of `bin/`.
- `vitest.config.ts` — Root Vitest run: gathers the modules' projects and `bin`'s own tests, the time reporter beside the default, coverage with a threshold on the domain only.
