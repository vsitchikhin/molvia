---
paths:
  - 'deploy/**'
  - 'docker-compose*.yml'
  - '.github/workflows/**'
  - 'bin/bundle.mjs'
  - '**/Dockerfile'
  - 'backend/drizzle/**'
  - 'backend/src/db/migrate*.ts'
  - 'backend/src/routes/health.ts'
  - 'bot/src/pulse.ts'
  - '.env.prod.example'
  - 'deploy/grafana/**'
  - 'deploy/victoria/**'
---

# Deployment

One VPS, one compose file, Caddy holding the certificate — see `deploy/README.md`.
The shape worth knowing here:

- **`api` and `bot` ship as a single bundled file each** (`bin/bundle.mjs`, esbuild). The
  runtime image carries no `node_modules` at all: nothing to audit and nothing that can
  drift from the lockfile it was built with. It also sidesteps the fact that the workspace
  packages export TypeScript source, which a runtime image could not read. The API's image
  carries the owner's tools beside it, `dist/forget.js` — the fallback for erasure (MOL-58) —,
  `dist/seed-catalogue.js` (MOL-112), `dist/gates.js` (MOL-91), `dist/failures.js` (MOL-143),
  `dist/merge.js` (MOL-106), `dist/notify.js` (MOL-237), `dist/repack-receipts.js` (MOL-264) and
  `dist/rename-receipt-items.js` (MOL-261), since the
  machine has neither the source nor a published database port.
  **One module beside the file, and the model** (MOL-105, owner's decision В-1): onnxruntime's
  native library cannot be bundled, so `bin/bundle.mjs` leaves `onnxruntime-node` out and the image
  copies it — its JavaScript, `onnxruntime-common`, and the native build of the image's machine
  only, 45 MB of 288 — into `node_modules`; the model, fetched and checked by sha256 in the build,
  into `model/`. The runtime is Node's `bookworm-slim` (an exact tag and its digest, MOL-364), since that build is for glibc. The image is
  some 520 MB, the API's memory some 460 MB with the model loaded.
  **Nor npm** (MOL-365, owner's В-1 «а»): the runtime stage of the API and the bot takes npm, npx, corepack and yarn
  off the official image — every HIGH trivy found in either was theirs (ten, MOL-287 Ф-9), and nothing here runs
  them: the owner's tools are `exec backend node dist/….js`. Their bytes stay in the base's layer, public as the
  base is, and out of the container's files, which is what a scanner and an intruder read.
  **Names survive the bundle** (`keepNames`, MOL-142): node-fetch under grammY takes a signal only
  from a constructor called `AbortSignal`, and the bot's first use of the global one had esbuild
  rename abort-controller's class — every call to Telegram failed in production, every unbundled
  test passed. `bot/src/bundle.test.ts` builds the bot and checks the name.
- **The receipt reader is the one service not built from our TypeScript** (MOL-125):
  `services/receipt-reader`, Debian trixie with Tesseract and Python from apt, an image of its own in
  the release beside the three, three cores and a gigabyte, read-only but `/tmp`. `deploy.sh` pulls it
  with the others; **a rollback starts `backend bot frontend` only** — a tag from before MOL-125 has no
  reader image, and `up -d` of everything would stop on the missing pull with the API left broken. The
  reader holds nothing and answers any API alike, so whatever runs of it stays.
- **The metrics are five more services and two more images** (MOL-145): VictoriaMetrics,
  node_exporter, cAdvisor and postgres_exporter on `metrics`, an `internal` network with no way out,
  Grafana in `metrics` and in `alerts`, a network of its own with a way out, its one port on
  `127.0.0.1:3000` for an SSH tunnel. `molvia-grafana` and `molvia-victoria` carry what they read baked
  in and are built by the release beside the four — Grafana from `grafana/grafana`, never
  `grafana/grafana-oss`, which stopped at 13.0.2 in June 2026 and so would never have reached Dependabot
  (MOL-365); the exporters are upstream images of exact tags.
  **They never judge a rollout** (adversarial А4): their images are pulled before anything changes, the
  upstream ones too, but a registry's refusal is a warning; the rollout's success is
  `up -d postgres backend bot frontend receipt-reader` and the health that follows, and only then are
  the metrics started, a failure of theirs — Grafana's port held, a device missing — said and the
  rollout standing. `up -d` of everything judged them, and a metrics container that could not start
  rolled a healthy API back. A rollback leaves them as they run — a tag from before MOL-145 has none of
  their images. Each has a limit of memory (Р-9): measured on production, Grafana took 142 MB idle and
  was killed at 384 on the first login, so it has 768; VictoriaMetrics 40 of 256, cAdvisor 18 of 192,
  the exporters 7 of 64. `GRAFANA_ADMIN_PASSWORD`, `ALERTS_BOT_TOKEN`, `ALERTS_PULSE_URL` and `OWNER_TELEGRAM_ID` are
  required and filled — empty is no longer a way to tell nobody of the failures (review №3). **The
  first rollout recreates Postgres** too: its networks changed. The rules of what they measure are
  `observability.md`; `deploy/README.md`, «Metrics».
- **Every image of ours runs as a user, never root** (MOL-365, Ф-16 of MOL-287): `node` for the API and the bot,
  `caddy` (10001) for Caddy, `nobody` (65534) for VictoriaMetrics and the reader, Grafana's 472 — the last stage
  names it, the base's word is not taken, and `bin/check-pins.mjs` refuses a last stage without `USER` or with
  root — by name, uid 0 in any spelling, or a group root written beside the user (owner's В-5 «а»). **A group a
  user takes from the image's `/etc/passwd` is not read**: Grafana's 472 is in group 0, as its authors made it, and
  its provisioning is `472:0` for that (adversarial Р2-Б1 — a price, named). Caddy opens 80 and 443 by the
  `cap_net_bind_service` its binary carries and by Docker's `ip_unprivileged_port_start=0` in a container's
  network (Docker 20.10 and later). **A volume keeps the owner it
  was filled by**: Docker gives a volume the image directory's owner only while it is empty, and `caddy_data`
  holds the certificate and the ACME account as root 0600 — Caddy as `caddy` on it refused to start (probe of
  09.11.2026), and the rollout, whose health goes through Caddy, would roll back. So **a one-shot service per
  service** (owner's В-2 «а»): `frontend-volumes` `chown`s `caddy_data` and `caddy_config`, `victoria-volumes`
  `vmdata`, before their service starts (`service_completed_successfully`), at every `up` of it — the service's own
  image of the tag, root for that alone, with no network and `CHOWN` and `DAC_READ_SEARCH` only. **One per service,
  never one for both** (adversarial А1 of review 1): a `chown -R` over a volume something writes fails on a file
  gone mid-walk, and one service for both walked VictoriaMetrics' parts while it ran — about one walk in 4 500
  under load. compose stops the container it replaces before it runs the dependency, so each walks a volume
  nobody writes. **Numbers, never names**: an image of before MOL-365 has no `caddy`, and `chown caddy` in a
  rollback would stop Caddy; `compose-volumes.integration.test.ts` holds each number to its Dockerfile (В2). A
  rollback to an image of before MOL-365 runs as root over files of any owner, and whatever it writes the next
  `up` gives back — tried: root-filled volumes, the new images, a rollback writing, forward again. **The price,
  named** (А2): compose has stopped the old Caddy when `frontend-volumes` runs, so the site waits for the walk — a
  fraction of a second — and a walk that fails leaves it down until the rollback starts it again; in the metrics'
  step a failed `victoria-volumes` leaves VictoriaMetrics stopped with a warning alone (the metrics never judge a
  rollout), and the alarms' pulse, which needs it, goes quiet — healthchecks.io says so. **An `up` that recreates
  nothing starts the dependency over a container that runs** — a rollout of the tag already running does that
  (`deploy.sh` refuses none, and a re-run of a rollout is one), and the walk then goes over a Caddy and a
  VictoriaMetrics at work (adversarial Р2-А2: 13 walks of 112 710 failed under load). Caddy writes rarely (a
  certificate's renewal); a walk that fails is `up -d` red over containers that keep running — the rollout puts
  the same tag back, the metrics' step warns. **The price, named:** a red rollout of the same tag now and then, no
  outage.
- **The stage `runtime` brings its distribution up to date, and the release builds it afresh** (MOL-365, owner's
  В-3 «а»): `apk upgrade` (Caddy, the bot, VictoriaMetrics, Grafana), `apt-get upgrade` (the API, the reader, in a
  stage of its own after the install, which stays cached). `release.yml`'s `no-cache-filters: runtime` is what makes
  it happen — and `bin/check-pins.mjs` refuses a last stage named otherwise, which the filter would not reach
  (review 1, №1; adversarial В1): from the cache the layer stays as its first build left it until the base's
  digest moves. So a fix of Alpine or Debian comes with the next merge, not a week later with Dependabot's
  pull request — the price of MOL-364 undone. **The price:** a build is not reproducible byte for byte, a
  broken package of the distribution comes as silently as a fixed one, and a mirror down fails the release —
  the previous images keep running. The reader's Tesseract moves only with a point release of trixie.
- **Every container logs to journald**, which keeps fourteen days (MOL-58). `LOG_DRIVER=json-file`
  exists only for trying the stack on a laptop, where Docker Desktop has no journald.
- **The database is copied every night, encrypted, off the machine** (MOL-70): `pg_dump` inside the
  container, `age` to the owner's public key, a Cloudflare R2 bucket in the EU — one pipe, so no
  unencrypted dump touches a disk, and the private key lives only with the owner, so a compromised
  server cannot read old copies. **Fourteen days**, enforced by the bucket's own lifecycle rule and
  written on the privacy page: an erased person lives in the copies exactly that long, so the term is
  a promise, not a setting. A restore brings back whoever was erased after the copy — a window of
  at most a day, accepted for 0.1 and named on the page (owner's decision, 26.09.2026); a record of
  erasures that outlives the database is 0.2's, with the lawyer. **Receipt photos and the item lines
  cut out of them stay out of the copy** (`--exclude-table-data`, MOL-125 В-2): their tables come back
  empty, and a receipt queued without its photo fails as `unreadable`. **Nor do the pictures of a
  message to the developer** (`feedback_picture_files`, MOL-167): kept until the owner's Telegram has
  them, a week at most; their lines (`feedback_pictures`) are copied — a table of their own, so a
  message restored still says what it had (adversarial А5) — and a notice waiting at a restore goes
  without them. A missing copy is an alarm
  (healthchecks.io), not a log line. `deploy/README.md`, «Backups».
- **Migrations run when the API starts.** There is one instance, and a schema that lags
  the code deployed against it is the worse of the two failures. `make migrate`, the test
  setup and the boot path all go through the same code, so a migration cannot behave one
  way locally and another in production.
- **Every migration of the journal is applied, or the boot stops** (MOL-105, adversarial Б).
  drizzle runs a migration only if its stamp is later than the last applied: two branches whose
  stamps lie in another order than they merge in, and the second is skipped while the log says
  «migrated». `stampsOutOfOrder` holds the journal in order in a test, and after every chain —
  boot, `make migrate`, the tests' setup — `assertEveryMigrationApplied` finds each entry's row by
  its stamp. A migration renumbered behind another branch's is stamped anew before its merge.
- **A merged migration is never rewritten.** drizzle decides what to run by the journal's
  `created_at` alone and never compares a file with what was applied: a rewritten migration is
  skipped silently if its stamp is older, and fails on its first `CREATE` if newer — then the
  API does not start.

  **The line is the merge of the pull request, not the first database to run it** (owner's
  decision, 23.09.2026). The rule is about the production database and about branches other
  people build on; a working copy's database is pushed around all through development anyway.
  So while the task is still open, a task's migrations may be folded into one — and then **every
  database that already ran the old file is brought into line by hand, in the same sitting**,
  because those are the ones drizzle will silently skip. MOL-39 checked every copy's journal
  before and after doing it; MOL-25 did the same and applied the added index to this copy's
  three databases with the very statement the file now carries. After the merge the file is
  frozen and a change to the schema is a new migration, always.

- **The Postgres image is an exact tag, and part of the contract** (MOL-105):
  `pgvector/pgvector:0.8.7-pg17-bookworm` in both compose files, both CI services and the drill of
  `restore.sh`. It carries ICU, which «Что брать» sorts by (MOL-31), `vector`, which the embeddings
  need, and glibc, by whose rules every text index is built. A text index built under one libc
  answers wrongly under another and says nothing, so the move off `postgres:17-alpine` came with
  migration `0038_pgvector` that rebuilds every index whose key is text or an expression and gives
  the ICU collations the new version; a later tag that moves glibc or ICU comes with the same.
  On a volume moved off alpine the database's own collation stays without a version — Postgres
  refuses a change from none to one; a database created under glibc records it and is warned on.
  **The move is done with writes stopped** (adversarial А, В): the new image under an API that has
  not run the migration, or a deploy rolled back after it failed, leaves musl's indexes answering
  under glibc in silence. **After a rollback the database says whether the migration ran, never the
  rollback** (round 2, Г): `vector` is there or not. Alpine comes back only if it is not — back over
  indexes glibc built, the same corruption the other way round, and the migration, recorded as
  applied, would never run again — **and comes back rebuilt** (round 3, Ж): the old API the rollback
  brought up writes by glibc's rules into musl's indexes until it is stopped, so the database alone
  goes up on alpine, `deploy/window-duplicates.sql` settles what the window wrote twice — search
  picks merged as their upsert merges, a login code dropped, a pair of places named for the hand
  (round 5, З) — and `deploy/reindex-text.sql` rebuilds every text index before the API starts.
  Procedure: `deploy/README.md`, «The Postgres image is part of the
  contract».
- **Postgres publishes no port.** It is reachable only over the compose network.
- **The PWA calls `/api/...`** and Caddy strips the prefix — the same shape the Vite dev
  proxy has, so nothing about the origin differs between development and production.
- **A merge is a deploy (MOL-90, owner's decisions В-7 and В-11).** `release.yml` runs when CI
  passes on master, builds the three images of exactly that commit as `sha-<7 hex>` and rolls
  them out over ssh — about seven minutes from the merge. The key can do one thing: its forced
  command, `deploy/deploy.sh`, takes a published tag and nothing else, so a stolen key re-deploys
  what is already in the registry. **A rollout is told by the image its containers run, never by
  the version `/health` names** — every image before MOL-90 calls itself `0.0.0`, and those are
  the rollback targets. Any failure, `up -d` included, puts the previous tag back; the script
  writes to a log rather than to ssh, so a client going away cannot cut a rollback short. One
  rollout at a time, and never older over newer: a build stands aside only if the machine already
  runs its commit or a descendant — not because master moved on, since the commit that moved it
  may never pass CI. A compose file or a deploy script on the machine that differs from the
  commit stops the job before anything moves — the key cannot replace them, and a copy is made by
  hand. `~/molvia/deploy.hold` refuses every rollout, and `restore.sh --into-prod` sets it: an API
  started mid-restore migrates the empty database. It comes off only once the copy is in — a pour
  cut short leaves tables without keys that an API still calls healthy — and a hold set by hand
  is never the restore's to take off. A tag `v0.1.N` is set by hand every 10–15
  tasks as a mark and a point to roll back to; it builds nothing and deploys nothing, but names
  the `sha-…` images of its commit, and only once production's `/health` names that commit — a
  tag is the build that runs, never one that rolled back (owner's decision В-4). **`.env.prod` is
  read by asking compose** (`config --environment`), never by parsing it: two rounds of review found
  a form the copied grammar missed each time. `v0.2.0`
  starts the 0.2 cohort. **`/api/health` names the build** — the last tag, the releases since it
  and the commit, `v0.1.5-81-g0f371828` (MOL-371): a release is a commit of master's first line, each a pull
  request merged, by a merge or a squash, and rolled out; `git describe --long` counted every commit of the
  branches merged too — 1282 for those 81. The form is `describe`'s, `-g<sha>` what the tag's job looks for.
- **One release a day, through `release/<name>` (MOL-376, owner's decisions of 11.11.2026).** A merge into
  master is still the rollout; what changed is what may merge there. **Why:** each rollout puts «Обновить»
  in front of every installed app (MOL-132), and a day of agents closes up to ten tasks — ten updates a day
  for a person at the shelf. The day's tasks now gather in one branch and reach people once.
  - **Master takes `release/<name>` and `hotfix/<name>-<number>` only.** A task branches from the current
    release branch and its pull request goes back into it; CI runs on it as on any pull request, and the
    owner's word merges it, as before.
  - **The release is the pull request `release/<name>` → master**, merged by a merge commit. The tag
    `v0.2.<n>-<name>` goes on that commit once production's `/health` names it (the rule of `v0.1.N`,
    owner's В-4: a tag is the build that runs). The `v` stays: every earlier tag has it, and
    `describe --match 'v[0-9]*'` and the rollback find tags by it.
  - **When:** on the owner's word «выпускай», or by itself at 03:00 Yerevan time when no release went out in
    the 24 hours before and the branch differs from master (owner's В-10: the word and the schedule
    together). A red CI on the release branch stops the night release and tells the owner. **Since MOL-381
    the word is «Run workflow» on `release-night.yml`, and the night is its cron** (`bin/release.mjs`):
    - **The branch differs by its files, not by a commit** — after a hotfix master is merged into the next
      release branch, and that merge alone is nothing to release.
    - **Only a release by hand holds the night back** (MOL-381, owner's В-4 «а»): GitHub's cron runs late
      here (MOL-221), and a night on time after a late one would find less than 24 hours and skip a day.
      The night's merge carries `(night)` after the subject GitHub writes; a release by hand — the button
      or GitHub's interface — has none. **The price, named:** a subject edited by hand in GitHub's
      interface is read as GitHub's; edited into `(night)`, it holds no night back.
    - **What CI passed is what merges**: up to an hour for both gates on the branch's head, the merge
      bound to that commit (`--match-head-commit`); a task merged meanwhile goes with the next release.
    - **By the app `molvia-release`, never `GITHUB_TOKEN`** (owner's В-2 «а»): what GitHub's own token
      does starts no workflow — no CI on master, no rollout, no tag's job.
    - **Its word is the check `molvia-release`** (owner's В-5 «а»): a night with nothing to release pings
      too, so a night that never ran is an alarm as well.
  - **Right after a release the next branch is cut from master.** Three `release/*` stay — the next, the
    one just out and the one before it, so a rollback has its source; older ones are deleted. **Since
    MOL-381 `after-release.yml` does it, and tags**, after CI on master for whoever merged: the merge
    commit's branch says what it was, `/api/health` naming the commit says it is out (forty minutes at
    most), then the tag, the next branch and the deletions — an old branch only once master holds it. A
    release out of turn — not the next name after the last tag — is refused: the tags are the record.
  - **A hotfix mends the release that is out**, never the next one: `hotfix/<that release's name>-<k>`, `k`
    from 1, cut from master, merged into master, tagged `v0.2.<n>-<name>-<k>` with the release's own `n`;
    then master is merged into the next release branch, so the fix does not vanish with the next release —
    `after-release.yml` both, a conflict a `/fail` to merge by hand.
    The next full release takes its own name and `n + 1`. A hotfix is not «the day's release» for the 03:00
    rule: one fix would otherwise hold the day's features back a day.
  - **Names rotate through three themes — a stone, a wind, a river — each in alphabetical order** (owner's В-9,
    11.11.2026): `v0.2.1-agate`, `v0.2.2-alize`, `v0.2.3-amazon`, `v0.2.4-amethyst`… One word in Latin, lower
    case, from the lists below; a list at its end starts over, and the number `n` keeps the tags apart. A
    hotfix takes its release's name, never the next one. **The lists that count are `bin/release.mjs`'s**
    (`NAMES`, MOL-381): name `n` is the stone, the wind or the river of `n − 1` in turn; the lists below
    are their copy, held equal by `bin/release.test.ts`.
    - stones: agate, amethyst, azurite, beryl, calcite, cinnabar, citrine, diopside, dolomite, emerald,
      epidote, feldspar, fluorite, galena, garnet, gypsum, hematite, howlite, iolite, jade, jasper, kunzite,
      kyanite, labradorite, lazurite, magnetite, malachite, nephrite, obsidian, onyx, opal, peridot, pyrite,
      quartz, rhodonite, ruby, sapphire, sodalite, spinel, topaz, tourmaline, turquoise, unakite, variscite,
      wulfenite, xenotime, zircon, zoisite;
    - winds: alize, berg, bora, brickfielder, buran, chergui, chinook, elephanta, etesian, foehn, gregale,
      haboob, harmattan, karaburan, khamsin, kona, levante, leveche, libeccio, marin, meltemi, mistral, ostro,
      pampero, papagayo, simoom, sirocco, solano, sukhovey, tramontane, vendaval, williwaw, zonda;
    - rivers: amazon, amur, araks, brahmaputra, congo, danube, debed, dnieper, don, drina, ebro, elbe,
      euphrates, fraser, ganges, hrazdan, hudson, indus, irtysh, jordan, kura, lena, loire, mekong,
      mississippi, morava, niger, nile, ob, oder, orinoco, po, rhine, rhone, sava, seine, shannon, tagus,
      thames, tigris, ural, vistula, volga, yangtze, yenisei, yukon, zambezi.
  - **Master takes `release/*`, `hotfix/*` and `dependabot/*`** (MOL-381; owner's В-7 «б» for Dependabot,
    whose base cannot follow a name that changes daily): CI's first step, `bin/release.mjs source`, since a
    ruleset cannot say where a pull request comes from and already requires that job's gate. **The price,
    named:** a Dependabot merge is a rollout of its own and not the day's release. A tag of either form
    names the images (`release.yml`) and rolls back (`deploy.sh`, whose copy on the machine is the
    owner's to bring).
- **Production is watched from outside, never from the machine (MOL-142; MOL-149, В-4).** A watch on
  the same machine does not notice the machine is down. **The Worker `molvia-watch` on Cloudflare**
  (`deploy/watch`, MOL-221) asks every five minutes for `/api/health` and the page and pings the
  healthchecks.io check `molvia-up` — or its `/fail`, saying what; the certificate's term goes to a
  check of its own, `molvia-cert`, from `.github/workflows/watch.yml` hourly; the bot pings
  `molvia-bot`. The alarm is healthchecks.io's own Telegram integration, never our bot,
  which lies down with the machine. **`/health` is `503` whenever it is not `ok`**, with the same
  body: a 200 saying «degraded» is a database down that a watch reading the status never sees. The
  rollout reads the body and is unchanged by it.
  - **A `/fail` is three failures in four tries half a minute apart**: it raises the alarm with no
    grace, and every merge leaves the API silent for seconds — a rollout fails one or two. All four
    had to fail at first, and a site failing three requests in four passed as well (adversarial
    Б1). Failing every second request still passes: the share of 5xx is MOL-145's alarm, not the
    watch's.
  - **One check, one state that can last.** healthchecks.io speaks only when a check flips, and a
    certificate «expiring in 13 days» is down for days: on `molvia-up` it kept a fall of the API
    silent the whole time (Б2). An unreadable certificate is the site's matter and pings nothing.
  - **Never GitHub's cron for the site** (MOL-221): `*/5` ran on this repository every two to six
    hours, so `molvia-up` went down after every ping and a fall would have waited for hours.
    Cloudflare is already ours (DNS, R2), its cron runs on time. A Worker cannot read a certificate
    — `fetch` only checks it, a bad one fails the request — so the term stays on GitHub, hourly:
    its check waits a day and an hour, and the worst gap measured was six hours. A request
    Cloudflare could not complete may come back as its own code, `530` for a name that does not
    resolve: any answer but `200` fails, so the rule holds as it was.
  - **Node stays out of the Worker's source by its types** (adversarial А4, R2-2): the tests run on
    Node, and in one TypeScript program Node's types reach every file — `process`, `clearImmediate`
    or a `setTimeout(…).unref()` would type-check and pass every test, then fail on Workers in the
    first round, or the first pause. So `deploy/watch/tsconfig.json` types the source by the web
    platform alone (`WebWorker`, no `types`), and the tests live apart in `deploy/watch/tests/`, typed
    by their own `tsconfig.json` with Node. A list of forbidden names closed only what it named; and
    tests beside the source would have gone to the lint's default project, which takes eight files
    and then fails on the Vitest config (round 3, R3-3).
  - **The rule lives once** (MOL-221, В-4): three of four is `deploy/watch/src/site.ts`, tested, and
    `watch.yml` checks the certificate alone — a second copy in bash would drift from what watches.
    The alarm is tried on the Worker itself, `DOMAIN` set to `molvia.invalid` by hand; every rollout
    sets it back.
  - **The Worker ships with the release** (`watcher`, В-2): after green CI on master, beside the
    rollout and never judging it, by Cloudflare's API with no wrangler (В-1). The token is an
    account's «Workers Scripts: Edit» in the environment `production` — Cloudflare does not narrow
    it to one Worker. A rollout keeps the secret `HC_UP_URL` (`keep_bindings`), and a commit master
    has moved past stands aside: the Worker carries no version to compare.
  - **A round fails only when it could not report**, by its kind and never its URL — the secret
    missing, a ping not gone after four tries; `watch.yml` is red only then, or GitHub's e-mail
    would come on top of Telegram.
  - **A check that never got a ping never raises an alarm** — it stays «new» (В1). So
    `BOT_PULSE_URL` is required in `.env.prod` (`${…?}` in compose) and only empty on purpose, and
    a check set up is seen turning green.
  - **The bot is not in `/health`**: after a rollout the API knows nothing of it for a minute, and
    the rollout would roll back. What its pulse proves is in `bot.md`.
  - The periods sit a little above the pings' rhythm, so «late» does not light the panel all day;
    period plus grace is the time to an alarm. Every ping URL is kept like a secret — whoever has
    one can say «alive» — and printed nowhere; the Worker keeps logs and no traces, whose spans
    would carry the URL. The ping URL ends in its path: `/fail` after a query or a fragment is a
    ping saying «up», and after an endpoint (`/0`, `/start`, `/log`) a `400`, so a round refuses
    them (adversarial А1, R3-1). **healthchecks.io's words are read**: a check it does not have is
    `200 OK (not found)`, and taken for delivered it left a check made anew grey for good (R3-2),
    so it fails the round at once; any other word but `OK`, such as `OK (rate limited)`, is a ping
    not taken and is tried again (R4-1). The prices, accepted by the owner: a fall is a `/fail`
    within five minutes and the round's tries — 90 s when the failure answers at once, 170 s when
    the machine does not answer and every request waits its ten seconds (А2); a silent watch is an
    alarm in twenty; Cloudflare's Workers down is a false alarm.
    `deploy/README.md`, «Signals».
- **A failed deploy puts the previous image back, not the schema.** Pending migrations run in
  one transaction, so a migration that fails leaves the schema as it was and the old image
  finds what it knew. One that succeeded while something else failed stays applied, and the
  previous image then runs on the new schema: an added column costs it nothing, a dropped or
  renamed one breaks it. **So a migration that drops or renames goes out in two merges** — the
  code stops reading the thing first, the schema loses it after. **A value added to a domain list —
  a currency, a provider — is safe to roll back past only until a row the domain parses holds it** — an actor, a trip, a
  spending; a cache read only by provider does not count (MOL-230, review 7, 8):
  the image put back reads rows through the domain's schemas and refuses one with a value it does not
  know — an actor in dinars is a 500 on every request. The automatic rollback of a failed deploy comes
  before any such row; a late one by hand does not, and is a deploy forward instead. The lari (MOL-110)
  and the dinar (MOL-230) are such values. **The search keys recomputed at
  the start** (`rekeyItems`, MOL-109) stay too: the image put back looks a name up by its own key and
  may write a twin until the next start — a named price, `search.md`.
