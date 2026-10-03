# Map · Receipts: the photo, the reader, the lines

Rules: `.claude/rules/receipts.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/receipt-text.ts` — `parseReceiptText`, `mergeParts`, `bestReading`: a receipt's text as Tesseract read it into lines with figures — the till's two layouts, OCR's digit swaps undone by the line's arithmetic and the printed total, parts joined at the till's articles; the port of MOL-114's prototype (MOL-125).
- `packages/model/tests/entities/` — Fixtures `receipt-text.am-*.json`: four of the owner's receipts as read, the item rows and the total only under a made-up header, with what the prototype gave (В-7).
- `packages/model/src/entities/receipt.ts` — A receipt's statuses and why one failed, its limits (four parts, the size of a part, 28 days), the countries read and their alphabets, `needsReshoot` (В-4) and the lines in the domain's money and quantities.
- `packages/model/src/entities/receipt-sum.ts` — The arithmetic of a receipt under review, one on the phone and the server (MOL-124 В-6): a line adds up with its product rounded to the receipt's digits (П-2), what a line is recorded at (В-5), «Строки», the difference with the total and its suspect line, a price one confused digit off the memory's (В-1).
- `packages/model/src/contracts/receipt.ts` — «Отправить чек» and a receipt on the wire: the body named by the phone, the summary in «Покупки», the lines as read.

## packages/client

In the skeleton's client: `sendReceipt`, `putReceiptPart` (a JPEG, a minute to go up), `receipts`,
`receipt`, `removeReceipt`, `restoreReceipt`.

## backend · routes

- `backend/src/routes/receipts.ts` — Routes of receipts (MOL-125): «Отправить чек», a part as a raw JPEG (the API's one body that is not JSON, in this scope only), the list, one receipt with its lines, «Удалить чек» and «Вернуть».

## backend · receipts

- `backend/src/receipts/jpeg.ts` — `jpegSize`: the sides of a JPEG from its frame header, and a scan with data after it, without decoding — what is not a photo is refused before it is kept.
- `backend/src/receipts/reader.ts` — The client of the receipt reader: a part read in a page mode, item lines cut out; `ReaderUnavailable` (nothing answered: the receipt waits), `ReaderDropped` (lost on the photo: counted, to the end), `PhotoUnreadable` (it fails).

## backend · usecases

- `backend/src/usecases/receipts.ts` — Use cases of the owner's side: send, a part checked to be a photo (`error.receipt_not_photo`, `error.receipt_too_large`), list, one, remove, restore.
- `backend/src/usecases/read-receipts.ts` — `readQueuedReceipts`: the queue — every part in both page modes, joined, the reading that adds up kept, «переснимите» by `needsReshoot`, item lines cut out; a reader away leaves the receipt queued, a photo it cannot read fails.

## backend · db

- `backend/src/db/receipts-repository.ts` — Repository of receipts: the receipt and its parts named by the phone, the summary and the lines, removal with «Вернуть», the timer's purge (10 minutes, 28 days, a recorded receipt's photo), and the queue — people in turn, claim, release, retry at the end, finish, a reading cut short begun again.

## backend · tests

- `backend/tests/receipts.integration.test.ts` — Integration test of receipts: sending and parts with their refusals and repeats, the queue on the bench's reading of am-05 with a fake reader, «переснимите», a reader away, removal and the 28 days, the log through the server.

## services · receipt-reader

- `services/receipt-reader/reader.py` — The receipt reader (MOL-125): Tesseract behind Python's own HTTP server — `POST /read` a part's text, row by row with each row's box; `POST /strips` item lines cut out as PNG; `GET /health` with the version of Tesseract and its language files. Stateless, no database, nothing of a receipt logged.
- `services/receipt-reader/selftest.py` — The reader's live test (В-6), run inside the image by CI: a receipt drawn on the spot, read in both page modes through the server's HTTP, a line cut out, the refusals.
- `services/receipt-reader/Dockerfile` — The reader's image: Debian trixie, Tesseract and the languages MOL-114 measured (`hye kat srp srp_latn rus eng`), Python and Pillow from apt, run as nobody.

## backend · schema

The tables are in the skeleton's schema: `receipts`, `receipt_parts`, `receipt_lines`,
`receipt_line_images`, migration `0042_receipts`. Erasure takes them through `receipts`; the copy
carries receipts and their lines, never a photo.
