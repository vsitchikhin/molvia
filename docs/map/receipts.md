# Map · Receipts: the photo, the reader, the lines

Rules: `.claude/rules/receipts.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/receipt-text.ts` — `parseReceiptText`, `mergeParts`, `bestReading`: a receipt's text as Tesseract read it into lines with figures — the till's two layouts, OCR's digit swaps undone by the line's arithmetic and the printed total, parts joined at the till's articles; the port of MOL-114's prototype (MOL-125).
- `packages/model/tests/entities/` — Fixtures `receipt-text.am-*.json`: four of the owner's receipts as read, the item rows and the total only under a made-up header, with what the prototype gave (В-7).
- `packages/model/src/entities/receipt.ts` — A receipt's statuses and why one failed, its limits (four parts, the size of a part, 28 days), the countries read and their alphabets, `needsReshoot` (В-4) and the lines in the domain's money and quantities.
- `packages/model/src/contracts/receipt.ts` — «Отправить чек» and a receipt on the wire: the body named by the phone, the summary in «Покупки», the lines as read.

## services · receipt-reader

- `services/receipt-reader/reader.py` — The receipt reader (MOL-125): Tesseract behind Python's own HTTP server — `POST /read` a part's text, row by row with each row's box; `POST /strips` item lines cut out as PNG; `GET /health` with the version of Tesseract and its language files. Stateless, no database, nothing of a receipt logged.
- `services/receipt-reader/selftest.py` — The reader's live test (В-6), run inside the image by CI: a receipt drawn on the spot, read in both page modes through the server's HTTP, a line cut out, the refusals.
- `services/receipt-reader/Dockerfile` — The reader's image: Debian trixie, Tesseract and the languages MOL-114 measured (`hye kat srp srp_latn rus eng`), Python and Pillow from apt, run as nobody.
