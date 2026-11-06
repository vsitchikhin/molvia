---
paths:
  - 'deploy/Caddyfile'
  - 'deploy/README.md'
  - 'docker-compose.prod.yml'
  - '.env.prod.example'
  - '.github/workflows/*.yml'
  - '.github/dependabot.yml'
  - 'bin/check-pins*'
  - '*/Dockerfile'
  - 'services/*/Dockerfile'
  - 'deploy/*/Dockerfile'
  - 'backend/src/routes/{auth,client-errors,catalogue,receipts,internal-auth,feedback}.ts'
  - 'backend/src/{purs,open-food-facts,rates}/*.ts'
  - 'backend/src/usecases/{start-login,propose-item,receipts}.ts'
  - 'backend/src/{env,secret,login-config}.ts'
  - 'bot/src/env.ts'
  - 'packages/model/src/entities/receipt-link.ts'
  - 'deploy/deploy.sh'
  - 'deploy/backup/*'
  - 'deploy/watch/**'
---

# Security: what a stranger must not get, and what holds it

The audit before `v0.2.0` (MOL-287, 03.11.2026; the report and its probes in `.scratch/tasks/security/`) went
over everything with an attacker's eyes for the first time. What was clean is held by the areas' own rules —
IDOR by `resource.ts` and ownership in every `WHERE`, the cookie by `auth.md`, the copy by `privacy.md`; this
file holds what belongs to no single area, and what the audit found missing.

## Who may write how much

- **A write that grows what everybody shares, or what the server keeps on its disk, has a quota per person**
  (MOL-287, owner's В-3 «а»: a cheap way to bring the service down — one request without a session, or one
  account within a minute — is a blocker of the release). **Three have none yet, each a blocker of
  `v0.2.0`**: the login's quota is the whole database's, so one `curl` holds the door shut for everyone
  (Ф-1, MOL-359: five a minute an address, three hundred in all); a receipt's photos have none, and one
  account fills some 12 GB an hour against 51 GB free (Ф-2, MOL-360: forty a day, twenty not recorded at
  once); «Предложить товар» has none, and some nine thousand names an hour go into everybody's search
  (Ф-4, MOL-362: sixty a day). Each task, merged, rewrites its line here. **A new write path names its
  quota in its task**, or says why it needs none. **A person's own rows of money have none either, and
  that is a price, not a reason** (self-review №5): the bodies are small and bounded, but nothing bounds
  their number, and how fast one account fills the disk with them was not measured — the disk alarm of
  MOL-360 is what would say it first.
- **What answers without a session is limited by the address Caddy names**, never by anything the client
  sends: the last `X-Forwarded-For` only from a peer inside, an IPv6 address by its `/48` (`networkOf`,
  `/client-errors`, MOL-144). A forged header changes nothing — the audit sent sixty under sixty addresses
  and was refused at the sixty-first. **The address is a key of a count, never a column or a line of the
  log** (`privacy.md`).
- **The money of the owner is the model's alone, and only a column the owner writes opens it**:
  `receipts_model_until`, set by hand, and no route writes it. Within it there is no share per person yet
  (MOL-367).

## What the server asks of others

- **A host the server asks is the code's, never the request's** (SSRF): a Serbian receipt's link is
  checked and rebuilt on `SERBIAN_RECEIPT_HOST`, a code is asked of Open Food Facts as digits, the banks'
  addresses are constants. A new outgoing request keeps the same shape — the input is a parameter, never a
  URL — and has a timeout. The size of an answer is not limited yet (MOL-368).

## Secrets

- **Every secret of production is a row of «Rotating the secrets» in `deploy/README.md`**: where it lives,
  how it is changed, and what stops meanwhile. A new secret comes with its row and its line in
  `.env.prod.example`, in the same pull request. **The database's password lives in its volume too**, so
  changing the line alone breaks the API, and it takes only what a URL takes bare — compose puts it into
  `DATABASE_URL` as it is (drilled and attacked, MOL-287). **A secret never goes on a command line**: argv
  is everybody's in `ps`, and the history keeps it on the machine that leaked. Typed at `read -rs`, it goes
  into a pipe, a heredoc, a shell builtin or a command's environment — never its arguments, a variable's
  expansion included (MOL-287, adversarial Р2-А2).
- **The images are public** (ghcr, pulled anonymously): nothing secret goes into a layer, a build argument
  or the PWA's bundle — the audit read all six images and the bundle. A secret reaches a container only
  through compose's environment from `.env.prod` on the machine. **The machine has no login to the
  registry**, so a new image's package is made public before its first rollout — GitHub creates it
  private.
- **The repository is public, its history and every pull request's ref included**: a token committed is
  read before it is removed, and a force push removes nothing (`CLAUDE.md`). A secret found there is
  rotated, never rewritten out. gitleaks over the whole history found none (MOL-287); a guard in CI is
  MOL-369.
- **CI's secrets stand in the environment `production`, which admits `master` alone**, and a job holding
  one has `permissions: contents: read` — all but `HC_CERT_URL` of `watch.yml`, a repository secret to be
  moved there (MOL-368).

## What CI runs is pinned

- **Every `uses:` is a full commit sha with its release in a comment, every base image an exact tag and its
  digest** (MOL-364, owner's В-1 «а»): `actions/checkout@3d3c…90b1 # v7.0.1`,
  `FROM caddy:2.11.9-alpine@sha256:…`. A tag is a pointer whoever publishes it can move, and the next run
  takes what it points at then — the way secrets of CI leaked through `tj-actions` in 2025; `release.yml`
  holds the deploy key and Cloudflare's token beside its actions. A floating image tag, besides, built
  something nobody saw: under `caddy:2-alpine` the audit found 2.11.7, three days later it was 2.11.9.
  `bin/check-pins.mjs` in `npm run lint` refuses either form left out — in a workflow and in an action of the
  repository wherever it lives (`action.yml`, its `image: docker://…` too), in a Dockerfile under any of its
  names, in any case, as Docker and Dependabot read them (`Dockerfile.*`, `*.Dockerfile`, `Containerfile`,
  `dockerfile`): its `# syntax=` — the image BuildKit hands the whole file to — `FROM`, `COPY --from` and
  `RUN --mount=…,from=`, an instruction's lines joined at `\` — and a comment naming a major alone (`# v7`).
  **An exact tag is a closed rule**, not a list of floating ones: a version of three numbers at its start
  (`2.11.9-alpine`, `v1.153.0`) or the day of a snapshot (`trixie-20261104-slim`); `latest`, `22`,
  `2.11-alpine`, `lts-alpine`, `trixie-slim` are refused. A stage of the file — named only after its own line,
  so `FROM caddy AS caddy` is an image — `scratch` and a local action are not pinned. **The digest is what
  runs**: Docker pulls it and never reads the tag, so a tag changed by hand without its digest changes
  nothing, and which tag a digest is only the registry knows — the check holds the form, Dependabot the pair.
  **What the check is**: a guard against the ordinary spelling, not a form built to slip past it — the
  boundary of `check-clock-bounds.mjs`: `uses:` and `image:` as the key at the start of their line or after
  `- `, the value on that line; a Dockerfile's lines joined at `\`, the default escape, a blank or a comment
  line inside dropped, CRLF read as LF, the quotes of a value taken off and the keys of a mount in any case,
  as BuildKit reads them; Dependabot's directories written out — a pattern there is refused rather than
  guessed at. **It holds actions and images, nothing else a build fetches**: a file `ADD` takes by a URL or
  from git, and whatever `RUN` downloads, are review's, and their pinned forms (`ADD --checksum=sha256:…`,
  `#<full sha>`) with them (adversarial Р3-А3) — no Dockerfile here has either. **The price, named:** another
  spelling of YAML (a value on the next line, a flow mapping, a quoted key) is past it, and only GitHub's
  `sha_pinning_required` refuses such an action, at the run (adversarial Б1); the `image:` of a workflow's
  container or service is not read (below); and **a sha is trusted as the action's own** — GitHub serves a
  commit of any fork under the action's name (adversarial Г2, «imposter commits»), which neither the check,
  the setting nor Dependabot tells from a release: a sha written by hand rather than by Dependabot is review's
  to check against `gh api repos/<action>/commits/<tag>`.
- **Dependabot moves the pins**: actions monthly, the base images weekly in one group (`images`), the sha or
  the digest with its tag or comment; a major of Node never, since it is `.nvmrc`'s, which CI runs on too.
  **Every directory with a Dockerfile is in the docker entry's `directories`** — the check refuses one left
  out, since a digest nobody moves is frozen for good (adversarial В1). A security update of npm comes in one
  pull request (`security`, `applies-to: security-updates`), Playwright's apart, as its version updates. **The
  price**: a patch of Alpine under the same tag no longer comes with any build — only with the bot's pull
  request, a week late at most and merged by the owner. **Not watched**: the images of compose (`pgvector` — a
  contract of ICU and glibc that a migration moves, `deploy.md`; the exporters and cAdvisor on `metrics`,
  which has no way out — each move of `docker-compose.prod.yml` a copy by hand to the machine) and
  `services:`/`container:` of `ci.yml`, the Playwright image held by its own check (`e2e.md`).
- **Settings outside git, written here since nothing else holds them** (MOL-364): secret scanning and push
  protection, Dependabot alerts and security updates on; Actions only GitHub's own and `docker/*`
  (`allowed_actions: selected`, owner's В-3 «а») and only by a full sha (`sha_pinning_required`). A new action
  of another author is a dependency to discuss, then a pattern in that list. Checked by
  `gh api repos/vsitchikhin/molvia --jq .security_and_analysis` and `…/actions/permissions`.

## The edges

- **`/internal/*` is closed twice**: Caddy answers 404 for `/api/internal` and below, and the API asks
  `BOT_API_SECRET` — 43 characters, compared in constant time — of every route in its scope. A new route
  of the bot goes into that scope, never beside it. The audit's seventeen spellings of the path (`//`,
  `/./`, `..`, `%69`, the case, `%2F`, `;`, `%00`) all ended in a 404.
- **Caddy sends no CSP, HSTS or `frame-ancestors` yet** (MOL-363); until then nothing on a page may build
  HTML from a person's text — no `v-html`, no `innerHTML`, the bot with no `parse_mode` — as is the case.

## Checking it again

The probes of the audit are scripts against a working copy (`.scratch/tasks/security/MOL-287/probes/`,
`stand.mts` first): IDOR by path and by body, the login's hijack and quota, the flood of receipts and of
proposals, the threshold of three, search timing, the rotation drills on the production stack run locally.
A change to an area they touch runs its probe before the merge; a finding is a probe that shows it, on a
copy, never on production.
