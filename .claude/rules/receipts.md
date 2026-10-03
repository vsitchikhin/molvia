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

**The parse is a port, measured on the bench.** `receipt-text.ts` began as MOL-114's `hybrid.mjs` in
TypeScript, line for line on the bench's readings (`.scratch/tasks/status/MOL-125/parity.mjs`); the
review of MOL-125 then fixed what the prototype got wrong, and each fix was run on the bench's truth
before and after (`score.mjs`: lines whose quantity and sum are right). A change of a rule is measured
so, never fitted to one receipt: the rules were picked looking at the first four receipts, and the
honest figure is the one on receipts the rules never saw.

| Fix                                                                             | Bench, right of 162                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| before the review                                                               | 65                                                                                         |
| the total's rest goes to a blank line only when the lines met the total (Р6)    | 66 — am-08 lost a negative sum                                                             |
| a line read untouched before the receipt's rate (Р5); the seam of parts (Р7–Р9) | 66, the same                                                                               |
| **refused:** a discount without decimals taking no shelf price (Р4)             | 63 — OCR splits «86,9» into «86 9» (am-02), and the greedy group of the prototype reads it |

**Every search of the parse has a ceiling, measured in time** (review 2, 8, Р14, Р15, Р18): it runs in
the API's process, and every request waits while it does. On the review's worst shapes a reading now
costs about half a second at most, and the bench reads the same.

| Ceiling                                                              | What it bounds                                                                                                                                                          | The bench uses                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `LINE_COMBINATIONS_MAX` 200 000                                      | the readings tried for one line's figures                                                                                                                               | 55 176 (am-03)                          |
| `READING_COMBINATIONS_MAX` 300 000                                   | all lines of a reading                                                                                                                                                  | 122 161 (am-03)                         |
| `LINE_COMBINATIONS_FLOOR` 10 000 of `FLOOR_COMBINATIONS_MAX` 200 000 | what a line may try once the reading's budget is spent — junk above the list drains it (Р15) without buying seconds with hundreds of rows (Р18)                         | —                                       |
| `RECONCILE_STATES_MAX` 300                                           | the readings the search against the total carries from line to line: the cheapest, and at one cost the one whose sum with the lines ahead lands nearest the total (П11) | 9 732 carried, the same answer with 300 |
| `RECONCILE_STEPS_MAX` 500 000                                        | the search against the total; past it the lines keep their first reading                                                                                                | 94 445 (am-03)                          |

A till that prints no shelf price lets every swap of a line fit the line, so only the total judges:
fifteen ordinary lines held the API for 52 s before the beam (Р14), ninety now balance in a third of a
second. A line past its ceiling is taken as read, unsettled.

**Where only the total judges, the rate the lines share helps it** (review Р20): such a till has no line
read with no swap, so the receipt's discount rate is taken from the lines as read, and a reading off it
costs the total a quarter of a swap more — 816,32 read as 316,32 is put right rather than another line
«fixed» to make up the difference. Only there: as an order of a line's readings the same rate «fixed»
am-01's right sum to fit, 66 → 65 on the bench. **«Сошлось» is «сошлось as read»** (review Р27): a line the total changed from its reading is
unsettled — highlighted for the person to check, even where the change is right (am-05's peaches,
342,66 read and 342,65 by the total). The total sets any difference right by one swap in some line whose
own arithmetic holds, a line read twice or lost at a seam included, and vouched for, that line hid the
error: an extra yoghurt at a seam was «balanced» by a pastry of 460 read as 160. **In a tie** every line
with a reading of its own that differs by the same amount is in doubt too (Р20, Р24) — the line OCR
misread among them. On a generator of such receipts 1–3 in 15 «balance» wrong, and every wrong line is
highlighted in each. **Two lines of one sum whose articles are one swap of OCR apart are both
highlighted** — an item read twice at a seam is a line the total cannot see; two neighbours of one line
at one price (am-13's beers, 008765 and 008766) cost one look. Marked after the reading is chosen, never
in the choice: it says nothing of how well a reading read, and am-13 lost four right lines to a reading
chosen so. The bench is unchanged; the port departs from the prototype in these marks only.

**A long receipt's seam must be one an overlap can make** (Р7–Р9): the last article of the text so far
that the next part has (exactly, else one digit off by a swap OCR makes — 5↔6, 1↔4, 3↔8, 0↔9), where the
next part holds no more articles before it than the text so far does, and everything after it in the
text so far is in the next part too. **One digit off by any other digit is the next article of the
list**: a maker numbers its flavours in a row, 1160033 and 1160036 are two yoghurts (Р23). **And one
swap of OCR off is the same article only under the same name** (Р25): one pair of neighbours in ten,
1160035 and 1160036, differs by a swap OCR makes, and only «8.Յոգուրտ … դեղձ» against «9.Յոգուրտ … ելակ»
tells them. A name split in two rows is read whole. **A name on one side only is no agreement**
(Р26): the top edge of a part cuts between an item's name and its figures as often as anywhere, and
the strawberry yoghurt was lost there under a balanced total. Only a till that prints no name above its
articles at all leaves the digits to decide; an item read twice for want of a name shows twice,
unbalanced — a loss behind «сошлось» is the worse error.

**Where the articles do not show the overlap** — rows of it read worse in the next part: an article two
digits off, figures cut at its top edge, a name lost or split, a row cut through at the first part's
foot (Р17, Р21, 9, Р23) — the first part's last sixteen rows and the next part's first sixteen are
aligned in order, the longest run of rows the overlap could hold twice (`sameRow`: read alike, not two
numbers of the list, not two articles; an article misread by OCR's swaps only under one name, or,
where one part lost the name, right after the rows aligned above it (Р21, Р26); and the
figures right below a name aligned are that item's, whatever article OCR made there). The run must be
the first part's foot and the next part's top — end within the last three rows of the one, start within
the first three of the other — or it is rows alike in the middle, a rule under the head and a rule above
the total (review 11), or two items alike; the next part goes on after the last row aligned, and the
first part keeps its own reading of the overlap. No run — the parts are joined. Likeness reads a row's
first 80 letters (Р22), and the strict seam compares digits by a loop: two hundred articles cost it
seventy milliseconds, not two seconds of CI.

**What is printed at the head is checked as a calendar and a clock** (Р10, Р12, Р13): a date of
the calendar from 2000 to the server's tomorrow, a time `HH:MM` — OCR makes up «01.01.0000», which
Postgres refuses, «2099» and «99:99».

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

**Who is at fault decides what happens.** Three outcomes, by what `fetch` saw:

|                     | What                                                                                       | The receipt                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `ReaderUnavailable` | nothing answered: refused, not resolved, not there                                         | stays where it is in the queue, its attempt uncounted; the round stops                          |
| `ReaderDropped`     | reached, then lost on this photo: the connection dropped, the answer cut off, our time out | its attempt counted, to the end of the queue; `failed/unreadable` after `RECEIPT_READ_ATTEMPTS` |
| `PhotoUnreadable`   | the reader answered that it could not: 422, 504, 500                                       | `failed/unreadable`                                                                             |

A photo that fells the reader every time would otherwise have gone back to the head of the queue each
minute and held everyone behind it, looking like a reader that is down (review 1). A reading the table
refuses fails at once rather than read twice; the lines are checked against the wire's contract before
they are written (Т-5). A receipt is never lost and never read forever.

**People in turn** (review А10): the next receipt is of the person read least in the last hour, then
the oldest — fifty receipts of one person do not hold another's behind them.

**Without a reader the queue does not run** (`RECEIPT_READER_URL` unset): receipts are taken and wait.
Tests hand in a fake; no test reads with a Tesseract a copy happens to run.

## Taking a receipt

**Named by the phone** (`deviceIdSchema`): the same receipt sent again is the same answer, anything else
under its id is a 409; «Переснять» is a new receipt, the old one removed (П-3). A part is the same
write sent again, another photo in its place a 409; the last part puts the receipt in the queue.

**A part is a raw JPEG**, the API's one body that is not JSON, taken in the receipts' scope only — every
other route keeps a megabyte. **What is not a photo is refused at once** — not a JPEG by its frame
header, no scan with data after it (a head alone, review А9), a side under 200 px
(`error.receipt_not_photo`, 415); a side over 6 000 px, or a body over 8 MB — by its
`Content-Length` before it is read, and counted by the scope's own parser when it comes in chunks
with no length (`error.receipt_too_large`, 413, review А7, А16): «не принят» on the phone, set aside
by its queue, never retried. **The ceiling of a side lets a phone's whole frame through** — 4 032 px of a
12-megapixel camera, 5 712 of a 24-megapixel one (review А8): the phone crops to 3 200, and one that did
not would otherwise be refused for good. Whether the data decodes is the reader's to find out.

## What lives how long

| What                   | How long                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| A removed receipt      | ten minutes of «Вернуть», then the minute timer (П-8, as MOL-73)                               |
| A receipt not recorded | 28 days after it arrived, whole (В-3) — by the server's clock, not the phone's                 |
| The photo              | until the receipt is recorded (MOL-126 deletes it; the timer holds the promise if it does not) |
| An item line cut out   | 28 days after the receipt is recorded (owner, 02.10.2026)                                      |

**Cut-out lines are item rows only** — a line's figures, and its name row only between two items:
right below the figures of the one before, and with the item's number read on it — one or two digits
and then a letter, never a date or a phone (Р16, Р19). The first item's name row is never cut: the head
is above it, and OCR reads a stray digit at the edge. A table gives its heading row only. Never the head where a customer's name is printed, never
the total (review А5, А6): above the first item whose name OCR lost stands the head — the VAT, a
buyer — and a table's last row runs on into a total whose word OCR misread. They are cut when the
receipt is read, since the boxes are the reading's; recording writes the text a person confirmed
(MOL-126).

## Privacy

**Photos and cut-out lines never enter the nightly copy** (`pg_dump --exclude-table-data`, В-2): a
photo carries a name and lives days, a copy lives fourteen. A restore brings their tables back empty; a
receipt queued without a photo fails as `unreadable`.

**Erasure takes a receipt whole**: `receipts` is the erased table, its parts, lines and cut-out lines
go by the cascade. **The copy carries receipts and their lines, never a photo** (`EXPORT_COLUMNS` says
why for every column left out).

**The log carries counts, never a receipt**: status, parts, lines, milliseconds. No text, no tax
number, no photo — not in the API's log, not in the reader's, which logs nothing at all: whatever
breaks in it answers 500 with no traceback, and a connection broken under a request is not printed
(review А12).

**A head is what a reading found**: a receipt failed before any reading answers `header: null`, not
four nulls (review А11). What the phone reads as «read» is the `status`, never `header !== null`.
