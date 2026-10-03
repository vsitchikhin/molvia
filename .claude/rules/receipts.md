---
paths:
  - 'packages/model/src/entities/{receipt,receipt-text}.ts'
  - 'packages/model/src/contracts/receipt.ts'
  - 'packages/model/tests/entities/receipt*'
  - 'packages/model/tests/contracts/receipt.test.ts'
  - 'backend/src/receipts/**'
  - 'backend/src/routes/receipts.ts'
  - 'backend/src/usecases/{receipts,read-receipts}.ts'
  - 'backend/src/db/receipts-repository.ts'
  - 'backend/tests/receipts.integration.test.ts'
  - 'services/receipt-reader/**'
---

# Receipts: the photo, the reader, the lines

The detail behind the receipt lines of `CLAUDE.md`. Reading a receipt on our server came in with
MOL-125, after the measurement of MOL-114 (`.scratch/tasks/research/MOL-114.md`) chose how. Binding
the lines to the catalogue and recording them is MOL-126, the screens are MOL-127, retraining the
reader is MOL-169.

## How a receipt is read

**No model reads a receipt.** A model by the picture on the server's processor took 6–12 minutes and
made the names up (MOL-114). What reads is a chain of cheap parts:

| Step          | What                                                                                     | Where                     |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------------- |
| Photo         | the phone crops to the receipt's edges, full resolution of the crop, up to four parts    | MOL-127                   |
| Reading       | Tesseract 5, Debian's `tessdata_fast`, page modes 4 and 6                                | `services/receipt-reader` |
| Figures       | the till's layout, the line's arithmetic, the receipt's discount rate, the printed total | `receipt-text.ts`         |
| «Переснимите» | too little read to be worth correcting                                                   | `needsReshoot`            |

**The parse is a port, held line for line.** `receipt-text.ts` is MOL-114's `hybrid.mjs` in
TypeScript, and on the bench's readings it gives what the prototype gave — the fixtures
`receipt-text.am-*.json` and `.scratch/tasks/status/MOL-125/parity.mjs` hold it. A change of a rule is
measured on the bench before and after, never fitted to one receipt: the rules were picked looking at
the first four receipts, and the honest figure is the one on receipts the rules never saw.

**Amounts are counted in hundredths, not in minor units.** A till prints hundredths whatever the
currency; `moneyOfHundredths` turns them into the currency's minor units by its exponent. Quantities
are thousandths. A float is a ratio that ranks candidates, never money.

**The languages are the country's.** Armenia `hye+rus+eng`; Georgia and Serbia have their language
files in the reader, and join when their currencies do (MOL-89). Every alphabet at once is slower and
mixes the scripts.

## «Переснимите» (В-4)

A receipt fails as `reshoot` when no item line was read; or the total was read and the lines make up
less than 70 % of it; or the total was not read and fewer than half the lines add up. **The total
alone decides nothing**: OCR missed it on 9 of the bench's 16 readings, most of them good ones, and
«any mismatch with the total» would have sent 12 of 16 to a new shot, am-03 with 17 lines of 18 among
them. One or two lost lines are the review screen's to add, not a new shot's.

## The reader holds nothing

**The reader is a container with no database, no disk but `/tmp`, no port outside the compose network
(В-1).** The API holds the queue, the photos and the parse, and sends the reader a JPEG; it answers
with the text, row by row with each row's box, and cuts rows out of a photo. Services never reach the
database (`services/README.md`).

**Three cores and a gigabyte** (`docker-compose.prod.yml`): a receipt takes them for half a minute, and
the API, the bot and Postgres keep the fourth. **One receipt at a time**, server-wide.

**The image is Debian trixie** — the one MOL-114 measured. Another release moves Tesseract and its
language files, and the figures with them; a move is measured on the bench first. **CI builds the image
and reads a receipt it draws** (`selftest.py`, В-6): a fake cannot stand for Tesseract's own files.

**A rollback does not touch the reader** (`deploy/deploy.sh`): a tag from before it has no reader image,
and `up -d` of everything would stop with the API left broken. The reader answers any API alike.

## The queue

**The API's own runner** — the one of the embeddings: a minute timer, nudged by a receipt's last
part. Before each round a reading left unfinished is begun again; a receipt fails after
`RECEIPT_READ_ATTEMPTS` readings begun.

**Who is at fault decides what happens.** The reader away (`ReaderUnavailable`) leaves the receipt in
the queue, its attempt uncounted — a receipt is never failed for our own outage. A photo the reader
cannot read (`PhotoUnreadable`: it did not open, ran out of time, the answer was no reading) fails as
`unreadable`; so does anything unexpected, logged by its kind. A receipt is never lost and never read
forever.

**Without a reader the queue does not run** (`RECEIPT_READER_URL` unset): receipts are taken and wait.
Tests hand in a fake; no test reads with a Tesseract a copy happens to run.

## Taking a receipt

**Named by the phone** (`deviceIdSchema`): the same receipt sent again is the same answer, anything else
under its id is a 409; «Переснять» is a new receipt, the old one removed (П-3). A part is the same
write sent again, another photo in its place a 409; the last part puts the receipt in the queue.

**A part is a raw JPEG**, the API's one body that is not JSON, taken in the receipts' scope only — every
other route keeps a megabyte. **What is not a photo is refused at once** — not a JPEG by its frame
header, a side under 200 px (`error.receipt_not_photo`, 415), a side over 4 000 px
(`error.receipt_too_large`, 413): «не принят» on the phone, set aside by its queue, never retried.

## What lives how long

| What                   | How long                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| A removed receipt      | ten minutes of «Вернуть», then the minute timer (П-8, as MOL-73)                               |
| A receipt not recorded | 28 days after it arrived, whole (В-3) — by the server's clock, not the phone's                 |
| The photo              | until the receipt is recorded (MOL-126 deletes it; the timer holds the promise if it does not) |
| An item line cut out   | 28 days after the receipt is recorded (owner, 02.10.2026)                                      |

**Cut-out lines are item rows only** — a line's name and its figures, never the head where a
customer's name is printed, never the total. They are cut when the receipt is read, since the boxes
are the reading's; recording writes the text a person confirmed (MOL-126).

## Privacy

**Photos and cut-out lines never enter the nightly copy** (`pg_dump --exclude-table-data`, В-2): a
photo carries a name and lives days, a copy lives fourteen. A restore brings their tables back empty; a
receipt queued without a photo fails as `unreadable`.

**Erasure takes a receipt whole**: `receipts` is the erased table, its parts, lines and cut-out lines
go by the cascade. **The copy carries receipts and their lines, never a photo** (`EXPORT_COLUMNS` says
why for every column left out).

**The log carries counts, never a receipt**: status, parts, lines, milliseconds. No text, no tax
number, no photo — not in the API's log, not in the reader's, which logs nothing at all.
