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
