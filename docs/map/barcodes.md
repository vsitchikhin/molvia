# Map · Barcodes: the scanner, a code typed by hand

Rules: `.claude/rules/barcodes.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/barcode.ts` — `typedBarcode`: a code typed by hand checked by its last digit and given in the scanner's form — UPC-A and UPC-E as thirteen digits.

## backend · usecases

- `backend/src/usecases/find-by-barcode.ts` — Use case: the item a scanned or typed code belongs to, looked up with its twins, the code as read first; writes nothing. Route `GET /catalogue/barcode` in `routes/catalogue.ts`; tests: `backend/tests/catalogue.integration.test.ts`.

## frontend · components

- `frontend/src/components/BarcodeScannerSheet.vue` — The scanner sheet: live viewfinder with its frame and torch, the camera's refusals, the digits typed by hand; emits the code and closes.

## frontend · composables

- `frontend/src/composables/useBarcodeScan.ts` — Composable: reads frames while the camera is live, one at a time, and hands over the first code of a barcode's shape two frames agree on.
- `frontend/src/composables/useCamera.ts` — Composable: the back camera for the viewfinder — its refusals sorted into states, stopped when closed or hidden, the torch.

## frontend · scanner

- `frontend/src/scanner/barcodeReader.ts` — The decoding worker seen from the page: warm ahead, read a frame by moving its pixels, fail everything once the worker dies.
- `frontend/src/scanner/barcodeWorker.ts` — The decoding worker: loads zxing from the app's own origin and answers each frame with a code or nothing.
- `frontend/src/scanner/capture.ts` — Frames of the viewfinder's video cut to what lies under the frame on the screen, on one reused canvas.
- `frontend/src/scanner/decode.ts` — Reading one frame: the four retail formats, the code as zxing gives it; `locateWasm`, the app's own copy of the reader.
- `frontend/src/scanner/frames.ts` — `cropOf`, the frame on the screen in the camera's pixels through a cover fit; `createReadStreak`, two reads in a row.
- `frontend/src/scanner/protocol.ts` — The messages between the page and the decoding worker.

## e2e

- `e2e/scanner.spec.ts` — Spec in the `camera` project: the fake camera's barcode read by the worker with the app's own wasm; no permission; no camera, and the digits typed by hand.
