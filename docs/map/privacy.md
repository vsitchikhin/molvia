# Map · Privacy: erasure, the privacy page, logs

Rules: `.claude/rules/privacy.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/export.ts` — Contract of «Скачать мои данные» (MOL-93): the file whole — header, version and a section for everything erasure removes — with money, quantity and rates as decimal strings and no enum or band a stored row may predate.
- `packages/model/src/contracts/consent.ts` — Contract of the consent to the terms and the privacy page (MOL-95): `POLICY_VERSION`, raised by hand for a change that matters; the edition a person accepted, the body that accepts one, and `consentNeeded` — whether this build asks.

## backend · usecases

- `backend/src/usecases/export-mine.ts` — Use case of «Скачать мои данные» (MOL-93): the owner's own snapshot, dated with the file's format and version; an owner erased meanwhile is «no owner».
- `backend/src/usecases/erase-me.ts` — Use case of erasing oneself, behind the bot's `/delete` and «Удалить мои данные» (MOL-94): erase the owner behind a Telegram id; nobody to erase is not an error. Tests: `backend/tests/erase-route.integration.test.ts`.
- `backend/src/usecases/consent.ts` — Use cases of the consent (MOL-95): the edition the owner accepted, and accepting the one the screen showed — never lowering the one on the row.

## backend · routes

- `backend/src/routes/consent.ts` — Routes `GET`/`PUT /actors/me/consent` (MOL-95): its own address beside `/actors/me`, which an installed app reads strictly; `no-store`.

## backend · db

- `backend/src/db/erasure-repository.ts` — Repository of erasure: everything about one Telegram id in one transaction, a dry run rolled back; `ACTOR_REFERENCES` names every key to `actors`. Tests: `backend/tests/erasure.integration.test.ts`.
- `backend/src/db/export-repository.ts` — Repository of «Скачать мои данные» (MOL-93): everything of one owner as one read-only snapshot; `EXPORT_SECTION_OF` ties each erased table to its section, `EXPORT_COLUMNS` names every column as exported or left out and why. Tests: `backend/tests/export.integration.test.ts`.
- `backend/src/db/failure.ts` — Postgres failures: foreign-key and unique violations turned into domain errors; `describeMigrationFailure`, a failed migration by its kind (`describeFailure` of the model, MOL-143) adds the statement that failed, DDL from our files, or the migrator's own words about a file of ours (MOL-153). Tests: `backend/tests/migration-log.integration.test.ts`.

## backend · other

- `backend/src/forget-cli.ts` — Entry of `dist/forget.js` in the API image: runs `forget` against the database. Tests: `backend/tests/forget-bundle.integration.test.ts`.
- `backend/src/forget.ts` — The owner's fallback erasure command: a dry run unless `--yes`, prints only counts and table names.

## backend · tests

- `backend/tests/compose-logging.integration.test.ts` — Integration test: every service of `docker-compose.prod.yml` logs to the journal, and Postgres keeps row values out of its own log.
- `backend/tests/consent.integration.test.ts` — Integration test: the consent is empty for an owner before it, accepted with the server's moment, a repeat keeps the first moment, an older edition never lowers the row, the bounds are `400`, the database refuses half a consent, and `/actors/me` carries none of it (MOL-95).
- `backend/tests/erase-route.integration.test.ts` — Integration test: `POST /internal/actors/erase` erases the owner with their sessions, answers a repeat and a stranger with the same 204, needs the bot secret; `DELETE /actors/me` erases the session's owner with every session and puts the cookie out, a repeat is `401`, nobody else is touched (MOL-94).
- `backend/tests/erasure.integration.test.ts` — Integration test: erasure leaves no row of the person anywhere, keeps items and places, counts the week, and orders its locks against a login.
- `backend/tests/export-route.integration.test.ts` — Integration test: `GET /actors/me/export` answers the owner's own file with `no-store` and `attachment`, refuses a named owner, and needs a session.
- `backend/tests/export.integration.test.ts` — Integration test: the export covers every key to `actors` and every column, counts what a dry run of erasure counts, leaks nobody else's row and no secret, keeps the removed marked.
- `backend/tests/forget-bundle.integration.test.ts` — Integration test: the bundled `dist/forget.js` runs from the bundle alone, and `make forget` erases only with `YES=1` on the command line.
- `backend/tests/life.ts` — Test support: `aLife`, a person touching every table erasure removes — the one life both the erasure and the export tests read.
- `backend/tests/migration-log.integration.test.ts` — Integration test: a migration failing through drizzle's own migrator on a cast of a person's text is logged by its kind and statement, without the value Postgres puts into the message; a file the journal names and the folder lacks is named; a connection cut mid-migration still ends in that line; `make migrate` prints a failure the same way.
- `backend/tests/request-log.integration.test.ts` — Integration test: a request is logged as method and path without the search query; an unknown address is neither logged with its query nor echoed.

## frontend · views

- `frontend/src/views/PrivacyView.vue` — «Данные и приватность» screen: a static page of what is kept, why, for how long and how to erase it; opens without a session.
- `frontend/src/views/TermsView.vue` — «Условия использования» (MOL-95): the rules of the service and the age of 16, beside the privacy page under one edition; opens without a session.
- `frontend/src/views/policy.ts` — The revision of both pages (MOL-95, В-1): the day and the fingerprint of their text, which `policy.test.ts` holds to every edit, and «Редакция {version} от {day}» they are subtitled with — the edition beside the day (MOL-236).

## frontend · components

- `frontend/src/components/EraseSheet.vue` — Sheet «Удалить все ваши данные?» (MOL-94): the bot's words for what goes and what stays, what happens to the copies on the devices, one press «Удалить навсегда»; inactive offline.
- `frontend/src/components/ConsentStep.vue` — «Условия и приватность», the door's step after the claim (MOL-95): both documents, «Мне 16 лет или больше» before «Принимаю», «Условия обновились» for an older edition; «Не принимаю» leads to «Выйти» or «Удалить мои данные», each with its own sheet.
- `frontend/src/components/YourDataGroup.vue` — «Ваши данные» on the settings (MOL-93, В-2): «Учитывать меня в статистике» first, a switch saved on the tap with no sheet and drawn only once the server has answered (MOL-96), «Скачать мои данные» with its states and «Сохранить или отправить» for a second tap, «Удалить мои данные» under it (MOL-94), and the link to «Данные и приватность».

## frontend · composables

- `frontend/src/composables/useAnalytics.ts` — «Учитывать меня в статистике» (MOL-96): the objection through `useTapSetting` — read from the server, chosen on the tap, nothing kept on the phone.
- `frontend/src/composables/useExport.ts` — «Скачать мои данные» (MOL-93, В-1): the file from the server, then the share sheet, a second tap when the phone refused it that late or it was closed, a download on a computer or where no sheet can take a file; named by `exportedAt`, cancelled when the screen goes; offline or error decided after the failure.

## frontend · stores

- `frontend/src/stores/consent.ts` — Store: the edition the owner the server named has accepted (MOL-95) — remembered under the owner so the door does not wait on every launch, asked of the server otherwise, `holds` while this build's edition is not accepted; «Принимаю», «Повторить», another window's accept.

## e2e

- `e2e/erase.spec.ts` — End-to-end: «Удалить мои данные» from the settings erases the person and this device, says so once on the login screen, and the next sign-in is a new account; on a session ended meanwhile it erases nothing and says so (MOL-94).
- `e2e/consent.spec.ts` — End-to-end: a newcomer of the seam meets the terms after the claim, reads «Условия использования» and comes back, cannot accept without the age, comes in and is not asked again; «Не принимаю» leads out through «Выйти»; the terms open by their address and from the login screen (MOL-95).
- `e2e/export.spec.ts` — End-to-end: «Скачать мои данные» downloads the file of one's own where no sheet can take it, and hands it over on a second tap where the phone refused the first.
- `e2e/privacy.spec.ts` — End-to-end: «Данные и приватность» opens by its address without a session, from the login screen and from the settings.

## repository

- `bin/forget-actor.sh` — Script behind `make forget`: runs the erasure command against this copy's database, a dry run unless `--yes`.
