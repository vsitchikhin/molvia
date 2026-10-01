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

**Every check is CI's** (MOL-165, owner's decision 01.10.2026). After MOL-164 the push ran types and
vitest and the commit a type-aware lint of the whole repository — the lint past the queue, at every
commit of every copy — and pushes still failed on a timeout: the machine was too loaded to finish
them. With the ruleset of MOL-164, `master` takes a pull request only when CI is green, so a check
here guarded nothing CI does not; it only made the machine slower for the copies that were writing
code. **What stays is `pre-commit` on the files committed, Prettier alone** — seconds, and CI checks
formatting rather than fixing it, so without it a push would come back red for a space. **The
price, named:** an error of types or lint is met in CI some six minutes after the push rather than
before it, and a task may push more than once; each push cancels the run before it, and the minutes
are free on a public repository. `pre-push` went, and with it `bin/green.sh`, whose marks only it
read.

**One lock for the whole machine, taken by `make format`, `lint`, `typecheck`, `test`, `e2e` and
`check` (MOL-139)** — what is still run here, by hand. The copies exist so that several sessions
work at once, and each push once ran every check: four at once were four typechecks, four vitest
runs and four Playwright runs with their browsers on eight cores and 16 GB. Measured on 29.09.2026:
a load average of 95–223, the swap full, a push of 10–20 minutes against about five alone the day
before, and `search.integration.test.ts` running seventy minutes. Worse than slow: a test timed out
under that load failed, and was started again into the same crowd. In turn, the last of four waits
for three runs of a few minutes, and none of them fails for want of a core.

**The lock is `flock` held by the process that runs the command**, so the kernel drops it however
that process ends: a lock file with a pid in it was the alternative, and breaking a stale one is a
race between two waiters. The descriptor is closed on exec, so a server a run leaves behind does
not hold the lock. `make check` takes one turn for all four steps — one per step would let another
copy slip in between — and a run already inside the lock does not take it again.

**The integration files run in parallel, each worker in a database of its own** (MOL-164). They ran
in turn because they shared `molvia_<index>_test` and each cleans its rows in `beforeEach`: in
parallel they deleted each other's. Now the global setup migrates that database as a template and
drops the last run's copies, and `tests/setup-worker.ts` gives each worker `…_test_w<VITEST_POOL_ID>`,
copied from it on the worker's first file — the files of one worker still run in turn in one
database, exactly as all of them did. Measured under the lock on 01.10.2026: 61 s against 164 s
in turn, all 1686 green. The production bundle, which three files test, is built once in the global
setup: built by each of them, it was rewritten under a neighbour reading it.
