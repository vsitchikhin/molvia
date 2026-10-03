# Map · Observability

Rules: `.claude/rules/observability.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/support/failure.ts` — A failure by its kind, never its content (MOL-58): `describeFailure` — name, driver code, up to eight frames cut below the stack's header — and `failureCodeOf`, the code under drizzle's wrapper; one rule for the API, the bot and the phone (MOL-143).
- `packages/model/src/contracts/failure.ts` — Wire contract of failures (MOL-143): the sources, the limits of a kind, code, route and frame, the bot's report of its own failure, the thresholds 10/100/1000, and the owner's notices — a union by `kind` the feedback of MOL-148 joins — with what a claim hands the bot.

## backend

- `backend/src/failure-reporter.ts` — One path for a failure of the API and the bot's reports (MOL-143): logged by its kind and gathered in memory by fingerprint, one write in flight a fingerprint and four at once, a burst written as one count, the API's written first and the phone's at most fifty of the waiting (MOL-144); a recording that fails is one more line of the log; `apiFailureReporter` is the API's, queued for the owner, with the hour of the phone's notices and rows, and `tellHeld` for the minute timer.
- `backend/src/failures.ts` — The command behind `make failures` and `dist/failures.js`: the latest fingerprints — when, the first six of the fingerprint, source, kind, place, counts in all and in the last build, frames — the API's of the running build read back to the source through the image's map (`bundleDecoder`, В-6), the phone's through the map of their own file from the site (`phoneDecoder`, MOL-144); usage and a failure by kind.
- `backend/src/failures-cli.ts` — Entry point of `dist/failures.js`: connects to the database and runs the failures command.
- `backend/src/usecases/record-failure.ts` — Use case «Сбой»: the fingerprint — source, kind, code, top frame without its position, place, and the phone's system — the fields cut to the table's limits, and what the owner hears: the first time in a build, then 10, 100, 1000 crossed (В-2, В-5); the bot's report as a summary and its handler; the phone's as its catcher and screen with its page's build (MOL-144), the limit of its reports — an address's sixty and everybody's two hundred a minute, in memory — the hour of its notices — three a sender, twenty in all, the rest held and told by the timer once an hour — and of its new rows, sixty a sender and a thousand in all, a place given back when the write failed.
- `backend/src/routes/client-errors.ts` — Route `POST /client-errors` (MOL-144): the phone's failures with no session and no cookie read, `204`, `no-store`; the limit's key is the address Caddy names, trusted only from inside, an IPv6 one by its `/48` (`networkOf`), written nowhere.
- `backend/src/db/failures-repository.ts` — Repository of `failures`: one occurrence added to its fingerprint by a single upsert that counts in the build, the owner's notices queued in the same transaction, the 30 days kept, the latest for `make failures`.
- `backend/src/db/owner-notices-repository.ts` — Repository of `owner_notices`: one notice queued by itself (`queue`, MOL-144), the claim that hands out and marks in one statement, skipping rows another claim holds, the phone's after the API's and the bot's (MOL-144) — a notice about a message handed again ten minutes on, six times at most, until the bot says it went (`markSent`, MOL-148); a notice about a failure unhanded for a day goes, a handed one after 30 days.
- `backend/src/usecases/owner-notices.ts` — Use case «Что сказать владельцу»: the notices waiting, handed to the bot with whom to write; nothing without an owner; a stored notice the contract no longer reads is said once and dropped.
- `backend/tests/failures-api.integration.test.ts` — Integration test of failures through a real server: a 500 by its route's template and never the address, a person's text in the driver's message nowhere, a refusal not a failure, one notice a build, none without an owner; the bot's report and the owner's claim through `/internal`.
- `backend/tests/client-errors.integration.test.ts` — Integration test of `POST /client-errors` (MOL-144): taken with no session and with a stranger's cookie, a row of `phone` with the page's build and platform, the owner's notice naming them; a message, a frame with the page's address or an origin, a User-Agent, an empty or too large batch refused; twenty a minute from an address, a forged header from outside not believed, the address in neither the log nor the table.
- `backend/tests/failures.integration.test.ts` — Integration test of the two tables: the count by fingerprint and by build, ten at once, a notice in the same transaction, the 30 days, the queue handed out once, no key to `actors`.
- `backend/src/metrics.ts` — The API's metrics (MOL-145) in Prometheus's text format, with no library: answers counted by method, route template and class of status — `aborted` when the client left first — their time in a histogram by route, a request no route answered `*`/`unmatched`, never its path; the process's event loop — how late a tick of its own came, over a sliding minute no reader resets — heap and resident memory.
- `backend/src/metrics-server.ts` — `GET /metrics` on a port of its own (MOL-145, В-1), never the API's: what the network of the metrics scrapes and Caddy cannot reach.
- `backend/tests/metrics.integration.test.ts` — Integration test of the metrics through a real server: a uuid and a query never in a label, a hundred unknown paths one series, `HEAD` as `GET`, a failure as 5xx; `/metrics` no address of the API in any spelling, and answered on its own server.
- `backend/tests/metrics-stack.integration.test.ts` — Test of the metrics' stack as written (MOL-145): no port but Caddy's and Grafana's on the loopback, the exporters on a network with no way out, Caddy proxying only the API's port, Grafana calling nobody home, the alarms at the thresholds of Р-6 of MOL-149, and every figure the dashboard and the alarms read written by the API or an exporter.

## frontend

- `frontend/src/catchers.ts` — The phone's catchers, imported by the first line of `main.ts` (MOL-144): the app's reports and the window's `error`, `unhandledrejection` and `online` stand before any other module of the app is evaluated; the screen is `start` until `main.ts` places it.
- `frontend/src/main-first-route.test.ts` — Test of the start whose first route did not settle (MOL-144, adversarial Б2): its throw is reported as the start's, and the app is mounted all the same.
- `frontend/src/failures.ts` — The phone's own failures (MOL-144): whether a failure is the phone's (`phoneDefect` — not an API's word, not the weather), the kind and frames in one shape with no message, the screen, the page's build by its script's name (`pageBuild`) and the platform; one a failure a page, kept on the device up to twenty until there is an answer, sent at once, at start and on `online`; `reportFailure` is the call every catch makes.

## bin

- `bin/failures.sh` — Script behind `make failures [LIMIT=20]`: the latest failures in this copy's database; the line for production in its header.

## bot

- `bot/src/failure.ts` — The bot's failures (MOL-143): `handlerOf` — the kind of update and the prefix of its button or command, never its data or sender — what is a defect and what is the weather (network, Telegram, the API's own answers), the report by kind to the API, its own failure one line of the log.
- `bot/src/owner.ts` — The owner's notices: claimed from the API every minute as the reminders are, sent one by one in Russian, a 429 ending the run, a message's notice said to have gone (MOL-148); `ownerText` writes a new failure, a count reached, and a message to the developer or its continuation with the thread's tag ending the first line (MOL-148), which `threadTagOf` reads back. MOL-167: a message's pictures after its notice, each a photo replying to it with the tag in its caption, the phone's as a file and a Telegram photo by its id; a picture refused or gone does not hold the rest, a connection broken holds «sent».

## deploy · metrics

- `deploy/victoria/Dockerfile` — Image `molvia-victoria` (MOL-145, В-2): VictoriaMetrics of an exact tag with its scrape config baked in.
- `deploy/victoria/scrape.yml` — What VictoriaMetrics scrapes every fifteen seconds: the API's own metrics port, node_exporter, cAdvisor, postgres_exporter, Grafana's deliveries and itself.
- `deploy/grafana/Dockerfile` — Image `molvia-grafana` (MOL-145, В-2): Grafana of an exact tag with the dashboard, the alarms and their contact point baked in, started through `start.sh`.
- `deploy/grafana/start.sh` — Grafana's entry: writes `OWNER_TELEGRAM_ID` into the contact point as text, refusing anything but digits, the API's rule — Grafana 13.0 makes a number of what it reads from the environment — and sets the admin's password from `GRAFANA_ADMIN_PASSWORD` at every start, through stdin, stopping on a refusal.
- `deploy/grafana/provisioning/datasources/victoria.yaml` — The one source of the dashboard and the alarms: VictoriaMetrics, read as Prometheus, not editable.
- `deploy/grafana/provisioning/dashboards/molvia.yaml` — The provider of the dashboard: read-only, a change in the interface is not kept (Р-10), and a file removed takes its dashboard with it.
- `deploy/grafana/provisioning/alerting/` — The alarms (`rules.json`: every threshold in one file — memory, disk, 5xx and p95 of a person's requests, a restart, containers unseen, figures gone silent, and the pulse) and where they go (`notify.json`: the Telegram contact point of the alarms' own bot, the message in Russian, the pulse's webhook to healthchecks.io, the policy).
- `deploy/grafana/dashboards/` — The dashboard «Молвия»: the API, the machine, the containers, Postgres.
