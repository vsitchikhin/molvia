# Map · Privacy: erasure, the privacy page, logs

Rules: `.claude/rules/privacy.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/export.ts` — Contract of «Скачать мои данные» (MOL-93): the file whole — header, version and a section for everything erasure removes — with money, quantity and rates as decimal strings and no enum or band a stored row may predate.

## backend · usecases

- `backend/src/usecases/export-mine.ts` — Use case of «Скачать мои данные» (MOL-93): the owner's own snapshot, dated with the file's format and version; an owner erased meanwhile is «no owner».
- `backend/src/usecases/erase-me.ts` — Use case of the bot's `/delete`: erase the owner behind a Telegram id; nobody to erase is not an error. Tests: `backend/tests/erase-route.integration.test.ts`.

## backend · db

- `backend/src/db/erasure-repository.ts` — Repository of erasure: everything about one Telegram id in one transaction, a dry run rolled back; `ACTOR_REFERENCES` names every key to `actors`. Tests: `backend/tests/erasure.integration.test.ts`.
- `backend/src/db/export-repository.ts` — Repository of «Скачать мои данные» (MOL-93): everything of one owner as one read-only snapshot; `EXPORT_SECTION_OF` ties each erased table to its section, `EXPORT_COLUMNS` names every column as exported or left out and why. Tests: `backend/tests/export.integration.test.ts`.
- `backend/src/db/failure.ts` — Postgres failures: foreign-key and unique violations turned into domain errors, and `describeFailure`, a failure logged by its kind without its message.

## backend · other

- `backend/src/forget-cli.ts` — Entry of `dist/forget.js` in the API image: runs `forget` against the database. Tests: `backend/tests/forget-bundle.integration.test.ts`.
- `backend/src/forget.ts` — The owner's fallback erasure command: a dry run unless `--yes`, prints only counts and table names.

## backend · tests

- `backend/tests/compose-logging.integration.test.ts` — Integration test: every service of `docker-compose.prod.yml` logs to the journal, and Postgres keeps row values out of its own log.
- `backend/tests/erase-route.integration.test.ts` — Integration test: `POST /internal/actors/erase` erases the owner with their sessions, answers a repeat and a stranger with the same 204, needs the bot secret.
- `backend/tests/erasure.integration.test.ts` — Integration test: erasure leaves no row of the person anywhere, keeps items and places, counts the week, and orders its locks against a login.
- `backend/tests/export-route.integration.test.ts` — Integration test: `GET /actors/me/export` answers the owner's own file with `no-store` and `attachment`, refuses a named owner, and needs a session.
- `backend/tests/export.integration.test.ts` — Integration test: the export covers every key to `actors` and every column, counts what a dry run of erasure counts, leaks nobody else's row and no secret, keeps the removed marked.
- `backend/tests/forget-bundle.integration.test.ts` — Integration test: the bundled `dist/forget.js` runs from the bundle alone, and `make forget` erases only with `YES=1` on the command line.
- `backend/tests/life.ts` — Test support: `aLife`, a person touching every table erasure removes — the one life both the erasure and the export tests read.
- `backend/tests/request-log.integration.test.ts` — Integration test: a request is logged as method and path without the search query; an unknown address is neither logged with its query nor echoed.

## frontend · views

- `frontend/src/views/PrivacyView.vue` — «Данные и приватность» screen: a static page of what is kept, why, for how long and how to erase it; opens without a session.

## frontend · components

- `frontend/src/components/YourDataGroup.vue` — «Ваши данные» on the settings (MOL-93, В-2): «Скачать мои данные» with its states and «Сохранить или отправить» for a second tap, and the link to «Данные и приватность».

## frontend · composables

- `frontend/src/composables/useExport.ts` — «Скачать мои данные» (MOL-93, В-1): the file from the server, then the share sheet, a second tap when the phone refused it that late, a download where no sheet can take a file; offline or error decided after the failure.

## e2e

- `e2e/export.spec.ts` — End-to-end: «Скачать мои данные» downloads the file of one's own where no sheet can take it, and hands it over on a second tap where the phone refused the first.
- `e2e/privacy.spec.ts` — End-to-end: «Данные и приватность» opens by its address without a session, from the login screen and from the settings.

## repository

- `bin/forget-actor.sh` — Script behind `make forget`: runs the erasure command against this copy's database, a dry run unless `--yes`.
