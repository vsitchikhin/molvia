# Map · Barcodes: the scanner, a code typed by hand

Rules: `.claude/rules/barcodes.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/barcode.ts` — `typedBarcode`: a code typed by hand checked by its last digit and given in the scanner's form — UPC-A and UPC-E as thirteen digits; `barcodeTwins`, the forms of one package; `writtenBarcode`, the form a code is written to the catalogue in (MOL-100).

## backend · open-food-facts

- `backend/src/open-food-facts/client.ts` — The client of Open Food Facts (MOL-162): one product read by the server with its own User-Agent and a 2.5 s timeout, at most twelve a minute, a minute's pause after a failure, a code asked twice at once asked once; `null` when not asked or not answered.
- `backend/src/open-food-facts/product.ts` — `parseProduct`: an answer of Open Food Facts read into a hint (MOL-162) — a name per interface language, the brand when the name lacks it, the size of the package in kg or l; found only on `status: 1`, anything not JSON of that shape thrown.
- `backend/tests/fixtures/open-food-facts/` — Answers of Open Food Facts recorded byte for byte on 01.10.2026 that the parser is tested on: Nutella, Coca-Cola, a code it does not know, a code it calls invalid.
- `backend/tests/fixtures/open-food-facts/unavailable.html` — Fixture: the base's «Page temporarily unavailable» page, a `503` in HTML, which the parser must take for the base out of reach.

## backend · db

- `backend/src/db/open-food-facts-repository.ts` — The cache of Open Food Facts' answers (MOL-162): a find or a miss per written code with its age in days; `named`, whether the base named any of a proposal's codes — the item's `origin`.

## backend · tests

- `backend/tests/open-food-facts.integration.test.ts` — Integration test: the hint through the server with a fake of the base — the door, the query, the cache, the log, the mark of an item proposed after it — and the cache's table against the real schema: the age, the overwrite, the CHECKs that keep a row whole.

## backend · usecases

- `backend/src/usecases/attach-barcode.ts` — Use case: «привязать код к ней?» — a code written to anyone's item in the name of who wrote it, or the item that holds it named; «не этот товар?» lets it go (MOL-100). Routes `POST`/`DELETE /catalogue/items/:itemId/barcodes` in `routes/catalogue.ts`; tests: `backend/tests/catalogue.integration.test.ts`.
- `backend/src/usecases/hint-by-barcode.ts` — Use case: what Open Food Facts says a package the catalogue missed is (MOL-162) — only a code that could be written, the cache while it is believed (a find 30 days, a miss 7), then the base; a hint or `null`, never an error. Route `GET /catalogue/barcode/hint` in `routes/catalogue.ts`; tests: `backend/tests/open-food-facts.integration.test.ts`.
- `backend/src/usecases/find-by-barcode.ts` — Use case: the item a scanned or typed code belongs to, looked up with its twins, the code as read first; writes nothing. Route `GET /catalogue/barcode` in `routes/catalogue.ts`; tests: `backend/tests/catalogue.integration.test.ts`.

## frontend · components

- `frontend/src/components/BarcodeScannerSheet.vue` — The scanner sheet: live viewfinder with its frame and torch, the camera's refusals, the digits typed by hand; emits the code and closes.
- `frontend/src/components/CameraHintSheet.vue` — «Камера без вопросов» over the scanner (MOL-163): where Safari's setting is, for a tab and for the app from the home screen, what it costs and what happens without it; no link, iOS opens no Settings from a page.

## frontend · composables

- `frontend/src/composables/useBarcodeHint.ts` — Composable: what Open Food Facts says the package of the code waiting for its item is (MOL-162) — asked when the code starts waiting, dropped when it stops; quiet, no states of its own.
- `frontend/src/composables/useBarcodeLookup.ts` — Composable: the item a scanned code belongs to on «Что взяли?» — the server, else the codes the device found items by; found, missing, offline, error.
- `frontend/src/composables/useBarcodeScan.ts` — Composable: reads frames while the camera is live, one at a time, and hands over the first code of a barcode's shape two frames agree on.
- `frontend/src/composables/useCamera.ts` — Composable: the back camera for the viewfinder — its refusals sorted into states, stopped when closed or hidden, the torch.
- `frontend/src/composables/useCameraHint.ts` — Composable: whether to tell the person how to stop Safari asking for the camera on every page load (MOL-163) — Safari on a touch screen, `permissions.query` says `prompt`; the sheet once on this phone, a quiet line after; a tab or the app from the home screen.

## frontend · scanner

- `frontend/src/scanner/barcodeReader.ts` — The decoding worker seen from the page: warm ahead, read a frame by moving its pixels, fail everything once the worker dies; `createFrameReader` for a worker of another answer — a receipt's QR codes (MOL-233).
- `frontend/src/scanner/barcodeWorker.ts` — The decoding worker: loads zxing from the app's own origin and answers each frame with a code or nothing.
- `frontend/src/scanner/serveFrames.ts` — The inside of a decoding worker: zxing from the app's own origin, each frame answered by its decoder or by what failed — the scanner's worker and the receipt's QR worker alike.
- `frontend/src/scanner/capture.ts` — Frames of the viewfinder's video cut to what lies under the frame on the screen, on one reused canvas.
- `frontend/src/scanner/decode.ts` — Reading one frame: the four retail formats, the code as zxing gives it; `locateWasm`, the app's own copy of the reader.
- `frontend/src/scanner/frames.ts` — `cropOf`, the frame on the screen in the camera's pixels through a cover fit; `createReadStreak`, two reads in a row.
- `frontend/src/scanner/protocol.ts` — The messages between the page and the decoding worker.

## e2e

- `e2e/scanner.spec.ts` — Spec in the `camera` project: the fake camera's barcode read by the worker with the app's own wasm; no permission; no camera, and the digits typed by hand.
