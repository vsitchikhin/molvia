# Map · Receipts: the photo, the reader, the lines

Rules: `.claude/rules/receipts.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/entities/receipt-text.ts` — `parseReceiptText`, `mergeParts`, `bestReading`: a receipt's text as Tesseract read it into lines with figures — the till's two layouts, OCR's digit swaps undone by the line's arithmetic and the printed total, parts joined at the till's articles; the port of MOL-114's prototype (MOL-125).
- `packages/model/tests/entities/` — Fixtures `receipt-text.am-*.json`: four of the owner's receipts as read, the item rows and the total only under a made-up header, with what the prototype gave (В-7).
- `packages/model/src/entities/receipt.ts` — A receipt's statuses and why one failed, its limits (four parts, the size of a part, 28 days), the countries read and their alphabets, `needsReshoot` (В-4) and the lines in the domain's money and quantities.
- `packages/model/src/entities/receipt-sum.ts` — The arithmetic of a receipt under review, one on the phone and the server (MOL-124 В-6): a line adds up with its product rounded to the receipt's digits (П-2), what a line is recorded at (В-5), «Строки», the difference with the total and its suspect line, a price one confused digit off the memory's (В-1).
- `packages/model/src/entities/receipt-match.ts` — `createLineMatcher`: a receipt line to a catalogue item by the item's names in the till's language, the customs heading ruling out what cannot be, a variety by the fat printed, the heading alone as a far match; the gloss by the dictionary of till words — the port of MOL-114's `dict-match.mjs` (MOL-126).
- `packages/model/src/contracts/receipt.ts` — «Отправить чек» and a receipt on the wire: the body named by the phone, the summary in «Покупки», the lines as read.

## packages/client

In the skeleton's client: `sendReceipt`, `putReceiptPart` (a JPEG, a minute to go up), `receipts`,
`receipt`, `removeReceipt`, `restoreReceipt`, `recordReceipt` (MOL-126).

## backend · routes

- `backend/src/routes/receipts.ts` — Routes of receipts (MOL-125): «Отправить чек», a part as a raw JPEG (the API's one body that is not JSON, in this scope only), the list, one receipt with its lines, «Удалить чек» and «Вернуть», «Записать» (MOL-126).

## backend · receipts

- `backend/src/receipts/jpeg.ts` — `jpegSize`: the sides of a JPEG from its frame header, and a scan with data after it, without decoding — what is not a photo is refused before it is kept.
- `backend/src/receipts/till-kinds-latin.ts` — The kinds a till prints in Latin letters (MOL-126): beside a city they make a receipt's row an item's, not its address; not the gloss's.
- `backend/src/receipts/till-words-ru.ts` — The dictionary of Armenian till words in Russian (MOL-114's `words-hy-ru.json`): a line's gloss, a new item's proposed name, the query of the search when the names find nothing.
- `backend/src/receipts/reader.ts` — The client of the receipt reader: a part read in a page mode, item lines cut out; `ReaderUnavailable` (nothing answered: the receipt waits), `ReaderDropped` (lost on the photo: counted, to the end), `PhotoUnreadable` (it fails).

## backend · usecases

- `backend/src/usecases/receipts.ts` — Use cases of the owner's side: send, a part checked to be a photo (`error.receipt_not_photo`, `error.receipt_too_large`), list and one with the place by tax number, one as the review shows it — the memory laid over, the amounts of В-5, a price in doubt, the rate of its day, the receipt recorded before (MOL-126) — remove, restore.
- `backend/src/usecases/bind-receipt-lines.ts` — `bindReceiptLines`: the lines of a parsed receipt to items, once, in the queue (MOL-126) — the catalogue's names in the till's language with the heading, then the search by the gloss (near found, far «проверьте»), else a new item named by the gloss.
- `backend/src/usecases/record-receipt.ts` — `recordReceipt`, «Записать» (MOL-126): the receipt as the phone holds it written in one transaction — a finished trip on the receipt's day at its rate, purchases, new items (MOL-12), the shop's memory, the place's tax number, the photo gone, the rows of lines recorded as read confirmed (В-4); a repeat is the same answer, a receipt recorded before a 409.
- `backend/src/usecases/read-receipts.ts` — `readQueuedReceipts`: the queue — every part in both page modes, joined, the reading that adds up kept, «переснимите» by `needsReshoot`, item lines cut out, the city of the address read, the lines bound (MOL-126); a reader away leaves the receipt queued, a photo it cannot read fails.

## backend · db

- `backend/src/db/receipts-repository.ts` — Repository of receipts: the receipt and its parts named by the phone, the summary and the lines, removal with «Вернуть», the timer's purge (10 minutes, 28 days, a recorded receipt's photo), and the queue — people in turn, claim, release, retry at the end, finish, a reading cut short begun again.

- `backend/src/db/store-memory-repository.ts` — Repository of the shops' shared memory (MOL-126): `recall` — the person's own word, else the item most people said, the later on a tie; `remember` — the person's word on a key, written over their earlier one.

## backend · tests

- `backend/tests/receipt-review.integration.test.ts` — Integration test of the review (MOL-126): the memory's own word, majority, tie and erased vote; the memory laid over the parse; В-5 and В-1; the place by tax number and city; the receipt recorded before; the rate of the receipt's day.
- `backend/tests/receipt-record.integration.test.ts` — Integration test of «Записать»: the trip on the receipt's day, purchases and new items, memory and the place's tax number, the photo and the rows left, «Деньги» and «Оценки», a repeat, the receipt recorded before, the refusals, the lines left out in the trip's money.
- `backend/tests/receipt-notices.integration.test.ts` — Integration test of «чек разобран» (MOL-129): a receipt read is heard of in the app once the list or the review hands it over, the first word stands.
- `backend/tests/receipts.integration.test.ts` — Integration test of receipts: sending and parts with their refusals and repeats, the queue on the bench's reading of am-05 with a fake reader, «переснимите», a reader away, removal and the 28 days, the log through the server.

## services · receipt-reader

- `services/receipt-reader/reader.py` — The receipt reader (MOL-125): Tesseract behind Python's own HTTP server — `POST /read` a part's text, row by row with each row's box; `POST /strips` item lines cut out as PNG; `GET /health` with the version of Tesseract and its language files. Stateless, no database, nothing of a receipt logged.
- `services/receipt-reader/selftest.py` — The reader's live test (В-6), run inside the image by CI: a receipt drawn on the spot, read in both page modes through the server's HTTP, a line cut out, the refusals.
- `services/receipt-reader/Dockerfile` — The reader's image: Debian trixie, Tesseract and the languages MOL-114 measured (`hye kat srp srp_latn rus eng`), Python and Pillow from apt, run as nobody.

## backend · schema

The tables are in the skeleton's schema: `receipts`, `receipt_parts`, `receipt_lines`,
`receipt_line_images`, migration `0042_receipts`. Erasure takes them through `receipts`; the copy
carries receipts and their lines, never a photo. MOL-126 (`0045_receipt_lines_bound`) binds a line to
its item and purchase and adds the item as a node — `item_names` (names in the tills' languages) and
`item_hs` (customs headings), both the seed's — `receipts_trip_key` (one trip, one receipt), and `store_memory`, the shops' shared
memory: erasure leaves its words without an author, the copy carries the person's own.

## frontend · the phone (MOL-127)

- `frontend/src/receipts/photoShelf.ts` — `photoShelf`: the bytes of the parts in IndexedDB, a database per owner, kept until the receipt is recorded, removed or gone (Т-4) — the server gives no photo back; `keepOnly` spares the last ten minutes; `forgetPhotos` for «Выйти» and erasure.
- `frontend/src/receipts/photo.ts` — `preparePhoto`: a file upright by its EXIF, drawn under the 16 Mp a canvas of iOS takes (Р-11), brought to `RECEIPT_PHOTO_SIDE` (3 200, П-7) and encoded as JPEG without EXIF; what the server would refuse is «файл не открылся» here.
- `frontend/src/receipts/review.ts` — The review as it stands: each line the server's reading with the person's edit over it, «Строки» and the difference by `receiptBalance` of the model (В-6), the place and the day, and the body of «Записать» — every line once.
- `frontend/src/stores/receiptQueue.ts` — The receipts' queue by the rules of MOL-24: the receipt, its parts in order, removal and «Вернуть», «Записать» under a trip the phone names; 413/415 and a lost photo «не принят»; «Выйти» waits for it (`whileReceiptsAreStill`).
- `frontend/src/stores/receiptDrafts.ts` — The edits of a receipt before it is recorded, on the phone and with no connection (Т-9): lines, the place and day, a corrected total.
- `frontend/src/composables/useReceipts.ts` — The receipts of «Покупки»: the queue and `GET /receipts` as one row each, the phone's state first; asked every five seconds while one is read (Р-4); every list lets the photos and drafts of what it no longer names go.
- `frontend/src/composables/useReceipt.ts` — One receipt for the review, kept on the phone for offline; `gone` when the server has none for this person.
- `frontend/src/composables/useReceiptCapture.ts` — The version «с чеком» (Д-3): the country of the settings, if the server reads it (Р-1).
- `frontend/src/composables/useOnline.ts` — Whether the browser believes it is online, now and on every change — for words said ahead of time, never for a failure.
- `frontend/src/components/CaptureButton.vue` — «Сфотографировать чек»: the strip's main action with receipts; from «Что брать» it opens «Покупки».
- `frontend/src/components/CaptureSheet.vue` — «Сфотографировать чек» (handoff 04): the system camera or the gallery, up to four parts, the part's own sheet «Переснять / Убрать часть», «Отправить чек» into the queue; «Переснять» a receipt (П-3).
- `frontend/src/components/ReceiptWorkSheet.vue` — The sheet of a receipt in work (3f): where it is, its parts from this phone, «Удалить чек».
- `frontend/src/components/ReceiptUndoStrip.vue` — «Чек удалён вместе с фото · Вернуть»: ten seconds on the screen, the queue's removal.
- `frontend/src/components/ReceiptSentLine.vue` — «Чек отправлен» for a moment where «Вернуть» stands (3d).
- `frontend/src/components/ReceiptLineRow.vue` — A line on the review: item, as printed in the system's face, «кол-во × цена», «≠ напечатанное», the marks, what it is recorded at.
- `frontend/src/components/ReceiptTotal.vue` — The foot of the review: «Строки», the total as a button (Р-8), «≈» by the rate of the receipt's day, the difference and its line.
- `frontend/src/components/ReceiptLineSheet.vue` — «Строка чека»: as printed, the item or a new one's name, how much, «цена за всё», «За единицу» with «Тут дешевле», «Не записывать»; into the draft, never the network.
- `frontend/src/components/ItemPickSheet.vue` — «Выбрать товар» over the line's sheet: the catalogue's search from the gloss, «Оставить новым товаром».
- `frontend/src/components/ReceiptPlaceSheet.vue` — «Где купили?»: the place read, the shops of this phone or a new one, and the day; «Записать» with no place opens it.
- `frontend/src/components/ReceiptTotalSheet.vue` — «Итог чека» put right, in the receipt's currency, into the draft.
- `frontend/src/views/ReceiptView.vue` — `/purchases/receipts/:id`: the review, «не разобран» with its photos, «уже записан», gone; «Записать N» through the queue, then `router.replace` to the purchases.
- `e2e/receipts.spec.ts` — Spec against the fake reader: a receipt from the gallery to the purchases under a place named, «back» to «Покупки»; taken with no connection and kept across a reload; not a photo; four parts and no fifth; «Удалить чек» and «Вернуть».
