# Map · Barcodes: the scanner, a code typed by hand

Rules: `.claude/rules/barcodes.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/barcode.ts` — `typedBarcode`: a code typed by hand checked by its last digit and given in the scanner's form — UPC-A and UPC-E as thirteen digits; `barcodeTwins`, the forms of one package; `writtenBarcode`, the form a code is written to the catalogue in (MOL-100).

## backend · usecases

- `backend/src/usecases/attach-barcode.ts` — Use case: «привязать код к ней?» — a code written to anyone's item in the name of who wrote it, or the item that holds it named; «не этот товар?» lets it go (MOL-100). Routes `POST`/`DELETE /catalogue/items/:itemId/barcodes` in `routes/catalogue.ts`; tests: `backend/tests/catalogue.integration.test.ts`.
- `backend/src/usecases/find-by-barcode.ts` — Use case: the item a scanned or typed code belongs to, looked up with its twins, the code as read first; writes nothing. Route `GET /catalogue/barcode` in `routes/catalogue.ts`; tests: `backend/tests/catalogue.integration.test.ts`.

## frontend · components

- `frontend/src/components/BarcodeScannerSheet.vue` — The scanner sheet: live viewfinder with its frame and torch, the camera's refusals, the digits typed by hand; emits the code and closes.

## frontend · composables

- `frontend/src/composables/useBarcodeLookup.ts` — Composable: the item a scanned code belongs to on «Что взяли?» — the server, else the codes the device found items by; found, missing, offline, error.
- `frontend/src/composables/useBarcodeScan.ts` — Composable: reads frames while the camera is live, one at a time, and hands over the first code of a barcode's shape two frames agree on.
- `frontend/src/composables/useCamera.ts` — Composable: the back camera for the viewfinder — its refusals sorted into states, stopped when closed or hidden, the torch.
- `frontend/src/composables/useCameraHint.ts` — Composable: whether to tell the person how to stop Safari asking for the camera on every page load (MOL-163) — Safari on a touch screen, `permissions.query` says `prompt`; the sheet once on this phone, a quiet line after; a tab or the app from the home screen.

## frontend · scanner

- `frontend/src/scanner/barcodeReader.ts` — The decoding worker seen from the page: warm ahead, read a frame by moving its pixels, fail everything once the worker dies.
- `frontend/src/scanner/barcodeWorker.ts` — The decoding worker: loads zxing from the app's own origin and answers each frame with a code or nothing.
- `frontend/src/scanner/capture.ts` — Frames of the viewfinder's video cut to what lies under the frame on the screen, on one reused canvas.
- `frontend/src/scanner/decode.ts` — Reading one frame: the four retail formats, the code as zxing gives it; `locateWasm`, the app's own copy of the reader.
- `frontend/src/scanner/frames.ts` — `cropOf`, the frame on the screen in the camera's pixels through a cover fit; `createReadStreak`, two reads in a row.
- `frontend/src/scanner/protocol.ts` — The messages between the page and the decoding worker.

## frontend · public

- `frontend/public/camera-probe.html` — MOL-163, temporary: a static page on the app's own origin that logs when the phone asks for the camera — after a stop, a history entry, a disabled track, the background, `<input capture>` — and what `permissions.query` says. Removed by the task's last commit.

## e2e

- `e2e/scanner.spec.ts` — Spec in the `camera` project: the fake camera's barcode read by the worker with the app's own wasm; no permission; no camera, and the digits typed by hand.
