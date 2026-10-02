# Map · Catalogue search

Rules: `.claude/rules/search.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/catalogue.ts` — Wire contract of the catalogue: the search query and its bound, the entry allowlist, the answer with `near`, the «Предложить товар» body.
- `packages/model/src/entities/item.ts` — Entity: a catalogue item — kind, name, search key, barcodes, unit — and the schema of a new item.
- `packages/model/src/support/search-key.ts` — `toSearchKey`, the frozen alphabet that folds any spelling of a name to one key, `unfinishedFoldSpellings` for a word typed halfway through a fold, and `nameIdentity` for duplicates.
- `packages/model/src/support/synonyms.ts` — The synonym dictionary (`synonymKeys`) and the word-of-the-kind rules: adjective and noun patterns, `WORD_BREAK`, `kindKey`.
- `packages/model/src/support/text.ts` — Visible-text rules shared by every name: `INVISIBLE`, `visibleLine`/`visibleText`, `pastedLine` for what a paste brings along.

## packages/model · tests

- `packages/model/tests/support/name-identity.test.ts` — Unit test: `nameIdentity` sets aside only case, spacing, invisibles and Armenian spellings, and one identity is always one key.
- `packages/model/tests/support/search-corpus.ts` — Test data: the search corpora — forks, typos, three scripts, the owner's shelf — shared by the model and backend tests.
- `packages/model/tests/support/search-key.corpus.test.ts` — Corpus test: every spelling in the corpus keeps its key within the edit budget, without a database.

## backend · routes

- `backend/src/routes/catalogue.ts` — Routes `GET /catalogue/search` and `POST /catalogue/items` («Предложить товар»): 201 for new, 200 for one already there. Tests: `backend/tests/catalogue.integration.test.ts`.

## backend · usecases

- `backend/src/usecases/embed-items.ts` — The one writer of item vectors (MOL-105): every item without a vector of the current model, in batches; a minute timer nudged by a proposal and by the model's load. Tests: `embed-items.test.ts`.
- `backend/src/usecases/embed-items.test.ts` — Use-case test: the writer fills every missing vector batch by batch, rewrites another model's, waits for no model; a nudge during a run repeats it once.
- `backend/src/usecases/propose-item.ts` — Use case «Предложить товар»: the item of the same name already there, or a new one in the asker's name.
- `backend/src/usecases/query-meaning.ts` — The vector of a query for the search by meaning (MOL-105), from four letters and only if it came in time; else the letters alone.
- `backend/src/usecases/search-catalogue.ts` — Use case: the catalogue lookup behind «Что взяли?», at most `SEARCH_LIMIT` rows, writing nothing to the event log.

## backend · db

- `backend/src/db/kind-word.ts` — `kindAt`: where the word of the kind stands in a name, the one SQL spelling of `kindKey` (MOL-45) — read by the search's synonyms and by «Тут дешевле»'s items of a kind (MOL-92).
- `backend/src/db/item-embeddings-repository.ts` — Repository of item vectors (MOL-105): the items without one of a model, and the vectors written — another model's replaced, an item gone skipped.
- `backend/src/db/items-repository.ts` — Repository of items: the ranked search (candidates, distance, units, synonyms, picks, `near`) and `createUnlessNamed`. Tests: `backend/tests/search.integration.test.ts`.
- `backend/src/db/search-picks-repository.ts` — Repository of remembered picks: a query and the item taken after it, and the person's own word (`admits`). Tests: `backend/tests/search-picks.integration.test.ts`.
- `backend/src/db/seed-repository.ts` — Repository writing the seed in one transaction: adds new names, reports those kept and twins under another spelling. Tests: `backend/tests/seed-catalogue.integration.test.ts`.

## backend · other

- `backend/src/embeddings/embedder.ts` — The model of the search by meaning in the API (MOL-105): loaded in the background with onnxruntime's telemetry off, queries ahead of names, a wait of 150 ms, a cache of queries; without it no vector and the letters alone.
- `backend/src/embeddings/model.json` — The pinned model: EmbeddingGemma-300m q4, its revision and the sha256 of every file — read by the API and by `bin/fetch-model.mjs`.
- `backend/src/catalogue-seed.ts` — The seed list: some six hundred common names without brands, each with the unit its price is compared by.
- `backend/src/seed-catalogue-cli.ts` — Entry point of `dist/seed-catalogue.js`: connects to the database and runs the seed command.
- `backend/src/seed-catalogue.ts` — The seed command behind `make seed`: dry run unless `--yes`, prints what was added, kept and skipped.

## backend · tests

- `backend/tests/catalogue.integration.test.ts` — Integration test: both catalogue routes through the server — the door, the query bound, the wire answer, no event, proposal dedup.
- `backend/tests/search-corpus.integration.test.ts` — Integration test: the whole corpora and the owner's shelf through the real search, every answer pinned whole, near and far included.
- `backend/tests/search-meaning.integration.test.ts` — Integration test: the search by meaning on the seed with the real model — shelf words, the owner's words unmoved, nothing near for things absent, other models unread, the HNSW plan, the server and the writer.
- `backend/tests/search-picks.integration.test.ts` — Integration test: a pick is one row per person, query key and item, counted up, in the caller's transaction, within the key length.
- `backend/tests/search.integration.test.ts` — Integration test: each search rule one case at a time — index use, thresholds, sizes and units, synonyms, picks, order, `near`.
- `backend/tests/seed-catalogue.integration.test.ts` — Integration test: the seed writes every line once, keeps existing items and twins, and the bundled command works.
- `backend/tests/seed-search.integration.test.ts` — Integration test: the owner's own words against the seed alone find the item meant first, near or far as pinned.
- `backend/tests/seed-words.ts` — Test support: the owner's words with the first name and nearness the seed gives them, shared by the search by letters and by meaning.

## frontend · views

- `frontend/src/views/ItemSearchView.vue` — «Что взяли?» screen: catalogue lookup for a trip, «Часто берёте» under an empty field, «Предложить товар» on a miss.

## frontend · components

- `frontend/src/components/CatalogueCombobox.vue` — The field and result list of «Что взяли?»: an ARIA combobox on a native input, rows only as the server sent them.
- `frontend/src/components/ProposeItemSheet.vue` — «Предложить товар» sheet: name from the query, unit and note, waits for a connection, «already there» is a pick.

## frontend · composables

- `frontend/src/composables/useCatalogueSearch.ts` — Composable: the debounced search as the person types — phases, stale answers, far answers, the missed query.

## frontend · stores

- `frontend/src/stores/itemEntry.ts` — Store: the item picked on «Что взяли?», carried with its query and missed query to the purchase sheet.
- `frontend/src/stores/recentItems.ts` — Store: the recent items per identity on the device, searched offline by the same key and synonym rules.
- `frontend/src/stores/searchDraft.ts` — Store: the typed query and missed query of «Что взяли?», kept in session storage across a reload of this window.

## e2e

- `e2e/item-search.spec.ts` — End-to-end: «Что взяли?» finds by typo and Latin, drives by keyboard, proposes on a miss, says far, works offline.
