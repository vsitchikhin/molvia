---
paths:
  - '**/package.json'
  - '**/tsconfig*.json'
  - '**/eslint.config*.js'
  - '**/vitest*.config.ts'
  - '**/vite.config.ts'
  - '.prettierrc.json'
  - '.editorconfig'
  - 'bin/check-code-map.mjs'
  - 'bin/one-at-a-time.sh'
  - 'bin/green.sh'
  - '.githooks/**'
  - 'Makefile'
  - 'docs/map/**'
---

# The stack's rejected alternatives, and what stays at the root

The detail behind the stack and workspace lines of `CLAUDE.md`.

## Why not Nest, Prisma, TypeORM or Quasar

**Nest, Prisma and TypeORM were considered and rejected**, each for a reason that is not
obvious enough to leave unwritten:

- **Nest** is Fastify plus a DI container, decorators and modules. That superstructure
  solves a team problem — imposing one shape on ten people. Here the shape is imposed by
  these rules and by the linter's import boundaries, for free. Worse, it works against the
  core decision: in Nest the business logic lives in `@Injectable()` classes, so the domain
  would import the framework, and "the domain imports nothing but zod" could not hold.
- **TypeORM** makes an entity a decorated class, so a table becomes a framework object;
  its migration generator has a long history of being unreliable, and the query builder
  returns `any` down many paths — typed on paper, untyped where it matters.
- **Prisma** has the best developer experience of the three. It breaks on exactly this
  project: its schema is its own DSL, and everything the DSL lacks is hand-written into
  generated migrations. Nearly all of the plan sits outside it — the `pg_trgm` and
  `unaccent` extensions, GIN indexes, `similarity()` queries, the aggregates behind "what
  to buy". Raw SQL exists through `$queryRaw` but loses its types, and here raw SQL is the
  main instrument rather than an escape hatch.

**Quasar was rejected for the same reason**, with one addition. It bundles a component kit
with a build layer for SPA, PWA, Capacitor and Electron. The second half is useful one day;
the first brings its own theme and Sass variables, which would become a second source of
truth about colour. And the second half is available on its own: if native happens at 1.0,
**Capacitor** wraps the existing web app for the stores without a component kit or a CLI of
its own. Until then `vite-plugin-pwa` already ships the manifest, the service worker and
the precache — a PWA that installs to the home screen and works offline is the mobile
build.

## The root only gathers the applications

The root only gathers them. `eslint.config.base.js` is a shared preset a module opts into,
the way separate repositories share a company config; it knows nothing about the modules'
names. The root `eslint.config.js` ignores the module directories entirely and covers only
`e2e/` and the repository's own config files. The root `vitest.config.ts` lists the
modules' configs as projects rather than defining suites itself.

**What deliberately stays at the root**, with the reason:

|                                         | Why                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prettier, `.editorconfig`, `.gitignore` | repository hygiene, not application config; five copies would only drift                                                                                                       |
| `.env` (development)                    | the three must agree on ports here — the frontend proxies to the backend's port and the bot calls it. In production nothing is shared: each container gets its own environment |
| `Makefile`                              | the entry point to the repository                                                                                                                                              |
| `playwright.config.ts`                  | end-to-end spans the whole stack and belongs to no single application                                                                                                          |

## The code map

**`docs/map/` answers «which file», before any search (MOL-133).** Every task used to open with
reconnaissance — grep, find, reading files in a row — repeated by every session and every subagent.
The map is one file per area, named as the area's rules file, so the name is already known from
«Rules by area»; `docs/map/README.md` holds the conventions and the skeleton that belongs to no area.
An entry says what a file is and what it is for, never how it works and never a rule.

**It is not in `.claude/rules/`, though the task first proposed that.** A rules file reaches the
context only after a file in its `paths:` is read — measured on MOL-130 with `claude -p`: no file
read, no rules — which is after the search the map is meant to replace. Loaded whole in every
session it would cost what MOL-130 took out of the core.

**The check is in `npm run lint`, not in a test**, so the pre-commit hook refuses a commit that adds,
moves or removes a file without the map. `bin/check-code-map.mjs` reads only entries — list items
that start with a path in backticks — so prose may name `x.test.ts` freely. Code is named file by
file; a test beside or mirroring its source is covered by the source's entry; only data (`sql`,
`json`, fonts, icons) may be covered by a directory, or the map would decay to «`backend/src/` —
the backend» and still pass. A file with two homes is refused: the map gives one. A path an entry
points at after its own (`Tests: …`) must exist too, unless it is outside the repository's
directories — a route or a build output. What it cannot check is meaning: an entry describing old
behaviour passes, and that is left to review.

## The heavy checks take turns

**One lock for the whole machine, taken by `pre-push` and by `make format`, `lint`, `typecheck`,
`test`, `e2e` and `check` (MOL-139).** Since MOL-164 the push no longer runs end-to-end — CI does,
and gates the merge (`.claude/rules/e2e.md`) — so the line is mostly `make check`. The copies exist so that several sessions work at once, and
each push ran every check: four at once were four typechecks, four vitest runs and four Playwright
runs with their browsers on eight cores and 16 GB. Measured on 29.09.2026: a load average of
95–223, the swap full, a push of 10–20 minutes against about five alone the day before, and
`search.integration.test.ts` running seventy minutes. Worse than slow: a test timed out under that
load failed the push — locally there are no retries — and the push was started again into the same
crowd. In turn, the last of four waits for three runs of a few minutes, and none of them fails for
want of a core.

**The lock is `flock` held by the process that runs the command**, so the kernel drops it however
that process ends: a lock file with a pid in it was the alternative, and breaking a stale one is a
race between two waiters. The descriptor is closed on exec, so a server a run leaves behind does
not hold the lock. `make check` takes one turn for all four steps — one per step would let another
copy slip in between — and a run already inside the lock does not take it again.

**A step green on this tree is not run again** (`bin/green.sh`): `make check` records typecheck and
test, the push records each step it passes, and a push skips what is recorded for `HEAD^{tree}`.
The Definition of Done runs `make check` just before the push, and the push used to repeat both
steps on the same tree; a push the remote rejected repeated everything. A mark is written and
trusted only when `git status` is empty, untracked files included — vitest would run a test git
does not know. What is outside the tree — `.env`, `node_modules`, the database — is not in the
mark; the price is accepted for a mark that lives minutes between a check and its push. The marks
are per worktree (`git rev-parse --git-path`), since each copy has its own environment.

**A tree that differs from the green one only in documents is green too** (MOL-164): `*.md`,
`docs/`, `.claude/`. No check that leaves a mark reads them — types, vitest — and a task's last
commit is often its rules, after `make check` passed on the code; that commit used to run every step
again. The comparison takes both names of a rename, so code moved into `docs/` is code taken away;
the code map in `docs/map/` is lint's, which runs at commit and is never skipped. The list is
written in `bin/green.sh` and is the place to widen it, with a reason: a file a test reads is not a
document.

**The integration files run in parallel, each worker in a database of its own** (MOL-164). They ran
in turn because they shared `molvia_<index>_test` and each cleans its rows in `beforeEach`: in
parallel they deleted each other's. Now the global setup migrates that database as a template and
drops the last run's copies, and `tests/setup-worker.ts` gives each worker `…_test_w<VITEST_POOL_ID>`,
copied from it on the worker's first file — the files of one worker still run in turn in one
database, exactly as all of them did. Measured under the lock on 01.10.2026: 61 s against 164 s
in turn, all 1686 green. The production bundle, which three files test, is built once in the global
setup: built by each of them, it was rewritten under a neighbour reading it.
