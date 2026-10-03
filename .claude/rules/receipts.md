---
paths:
  - 'packages/model/src/entities/{receipt,receipt-text,receipt-sum,receipt-match}.ts'
  - 'packages/model/src/contracts/receipt.ts'
  - 'packages/model/tests/entities/receipt*'
  - 'packages/model/tests/contracts/receipt.test.ts'
  - 'backend/src/receipts/**'
  - 'backend/src/routes/receipts.ts'
  - 'backend/src/usecases/{receipts,read-receipts,bind-receipt-lines,record-receipt}.ts'
  - 'backend/src/db/{receipts,store-memory}-repository.ts'
  - 'backend/src/catalogue-seed-nodes.ts'
  - 'backend/tests/{receipts,receipt-review,receipt-record}.integration.test.ts'
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

**Where only the total judges, the rate the lines share helps it** (review Р20): such a till has no
line read with no swap, so the receipt's discount rate is taken from the lines as read, and a
reading off it costs the total a quarter of a swap more — 816,32 read as 316,32 is put right rather
than another line «fixed» to make up the difference. Only there: as an order of a line's readings
the same rate «fixed» am-01's right sum to fit, 66 → 65 on the bench. **«Сошлось» is «сошлось as
read»** (review Р27): a line the total changed from its reading is unsettled — highlighted for the
person to check, even where the change is right (am-05's peaches, 342,66 read and 342,65 by the
total). The total sets any difference right by one swap in some line whose own arithmetic holds, a
line read twice or lost at a seam included, and vouched for, that line hid the error: an extra
yoghurt at a seam was «balanced» by a pastry of 460 read as 160. **In a tie** every line with a
reading of its own that differs by the same amount is in doubt too (Р20, Р24) — the line OCR misread
among them. On a generator of such receipts 1–3 in 15 «balance» wrong, and every wrong line is
highlighted in each. **Two lines of one sum whose articles are one swap of OCR apart are both
highlighted** — an item read twice at a seam is a line the total cannot see. **Only across a seam**
(Р28): one line from one part and one from another; in one photo an item has nowhere to be read twice,
and two neighbours of one line at one price — am-13's beers, 008765 and 008766 — are two items read
right. Marked after the reading is chosen, never in the choice: it says nothing of how well a reading
read, and am-13 lost four right lines to a reading chosen so. The bench is unchanged; the port departs
from the prototype in these marks only.

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

## What a line is (MOL-126)

**A line finds its item in five steps, the first that answers deciding** (MOL-114's order, approved
30.09.2026): the shop's memory by the till's article («0401/**1163909**»); the shop's memory by the
line as printed; the catalogue's names in the till's language, the customs heading printed on the line
ruling out what the line cannot be (`createLineMatcher`); the catalogue search by the line's gloss;
nothing — a new item named by the gloss. The answer's `match` is the handoff's four: `memory`,
`search`, `weak` («проверьте») and `new`. The memory and a sure search are not told apart — the
person's one action is to check and correct — and `weak` is a search found far (`near = false`, MOL-124
В-4) or an item chosen by the heading alone.

**The names and the search are found once, in the queue; the memory on every reading** (Р-1). A search
with its meaning costs tens of milliseconds a line, nothing in the background and a second on every
opening of a receipt; the memory changes with every receipt recorded, and the second receipt of a shop
must know what the first taught without anything read again. Hence no `revision` on the wire: the
record carries the whole receipt as the phone holds it (Р-4), and nothing the server suggested since is
written in silently.

**The matcher is MOL-114's `dict-match.mjs`, ported without improvements** (Р-7): on the bench's 152
lines it gives the prototype's item and gloss line for line, in the seed's order and by name alike
(`.scratch/tasks/status/MOL-126/parity.mjs`) — so the figure measured on receipts its rules never saw,
54 of 70, still holds. The nodes come by name bytewise, so a tie is decided the same on every database.
A change of a rule is measured as the parse's are.

**An item is a node** (owner, 30.09.2026): barcodes (MOL-99), the shops' articles (the memory), customs
headings (`item_hs`) and names in the countries' languages (`item_names`) all lead to it. **The names
and headings are the seed's alone** (`catalogue-seed-nodes.ts`, Р-8), written blind during MOL-114:
nobody types an Armenian name, and the memory learns what the seed lacks. They are not the person's
search: it reads `items.name` as before.

**The gloss is the dictionary of till words, in Russian** (`till-words-ru.ts`): the catalogue's
language, so the search asks it whatever the receipt's; it is shown only on a receipt read out in
Russian, and a receipt in English shows the line as printed (Т-3).

## The shops' memory (MOL-126)

**The memory is shared** (owner, 30.09.2026; it was personal, Р-2 of the epic): «1163909 at "Ереван
Сити" is milk» is a fact about the shop, not about the person. A row is one person's word on one key —
the article, or the line by its search key for a till that prints none (Dog City) — and is read so:
**the person's own word first; else the item most people said, the later on a tie** (Р-2). One
stranger's word is already the memory: a poisoned word is a line the person sees on the review, and a
threshold would lose the first receipt of every shop.

**Recording writes the person's word on every line recorded**, over their earlier one; a line left out
teaches nothing. The price kept is the shelf price of a line recorded as read, the memory's argument
where a figure reads two ways — «60 60» for «50 50» adds up either way — and it is a hint, never a
correction (В-1): a price one confused digit off the remembered is `rememberedPrice` on the line, «
проверьте», and the parse's figures stay as read. Putting the price into the parse is a change of the
parse, measured on the bench, and is not done here. **The price is someone's figure** (review 5, В6; round 2, Р2-В3): the
person's own always; other people's only as their figures are — with access (`shared_until`) and from
three prices (`AGGREGATE_MIN_CONTRIBUTIONS`), their lower median, as the prices of places open
(MOL-166) — in the receipt's currency only: prices of two currencies are never one median (review 15). Three people for an item are not three prices: a word recorded with corrected figures
carries none.

**Nobody's word is shown as someone's**: the answer is an item and, in doubt, a price — never who or
when. The item itself is shared on one word: «at this seller this article is milk» is the shop's fact
(owner, 30.09.2026), and `match: memory` says no more than that someone recorded it there. Erasure leaves a word without its author, still counted, as an item outlives its author (MOL-58);
the copy carries the person's own words.

**There is no path for «a purchase's item changed later» yet** — a purchase's patch is its quantity and
amount (`expensePatchSchema`). The memory is rewritten by the next receipt recorded at the shop; the
change of an item, when it comes, writes the person's word as recording does.

## Recording (MOL-126)

**«Записать» is the whole receipt in one transaction** (`recordReceipt`): a trip finished on the
receipt's day — not «today», and never the open trip — at the rate of that day by the trip's own rule
(`tripRateOn`: the person's own, else the official one of that day, MOL-73's rule); the purchases with
their own sums; new items through `createUnlessNamed` (MOL-12), one name on two lines one item; the
person's words to the memory; the photo deleted; the receipt `recorded`, pointing at its trip. **The
owner's lock of trips comes first**, then the receipt's row (review 7, В3): two shots of one receipt
recorded at once meet there. New items are made before the purchases, in the order of their names'
keys — each name is locked to the end of the transaction (review 6). The server works every figure out itself, the phone's are not
trusted: the unit price is the purchase's own, and the lines are every line of the receipt once.

**The trip's money is what was paid** (В-3; В-5 of the review, owner, 03.10.2026): the total the phone
sends — the printed one, or the person's correction of a total OCR misread, in the receipt's currency
(another is `error.currency_mismatch`, round 2, Р2-В2); without it the printed total
where it is not below the lines — the lines left out and those OCR lost included, while a lost line only
ever raises a total, so one below the lines was misread — else every line, a line left out at what it
would have been recorded at (В-5 of MOL-124). The sum is held to the column's bound by `addMoney`: lines
each within it may add up past it, which is `error.invalid_amount`, not a 500 (round 3, Р3-В1). A purchase keeps what was paid for its line; the line's discount stays on the line and is shown
beside the purchase (Р-9).

**A trip from a receipt is dated by the receipt's day for «Деньги» and the accounts alike**: the rule
that a `started_on` a day before the server's start is a wrong clock does not hold for a receipt's day
(`money-accounts-repository`): it is the day the person confirmed on the review, not a clock's moment —
the printed one or their correction of it, held only against a day still to come (`latestDay`). A
receipt of a week ago is a purchase of a week ago.

**The same trip sent again is the same answer, another trip a 409** — the phone names the trip, as every
write offline (MOL-24). **The same receipt recorded before is refused** (Т-11,
`error.receipt_recorded_before`): its seller's tax number and number, the person's, while its purchases
are there — a trip removed lets it be recorded again. A receipt with no number is held by its id alone.

**A recorded receipt is not removed while its trip is there** (review 1, В1, В2): its row dates the trip
on the accounts, names it «из чека», names its seller's place and guards against a second record —
removed, the trip moved a week on its account and the same receipt was recorded twice. It goes with
its trip: once the trip is removed for good (`trip_id` nulled), the receipt is recorded again from its
lines (В7) — the photo is gone, the lines are not; a trip only marked removed may come back with
«Вернуть», so until then it is a 409. «Удалить чек» reads the receipt under the row's lock «Записать»
holds (round 2, Р2-В1): a record committed while it waited is seen. **One trip is one receipt's**
(`receipts_trip_key`), and the recorded receipts are indexed by their seller (`receipts_recorded_tin_idx`):
every look at a receipt reads its seller's place off them.

**What a line is recorded at, before the person corrects it** (MOL-124 В-5, П-2, `receipt-sum.ts`): a
line that adds up — what was paid; one that does not — the printed sum where the printed total confirms
it, else quantity × price. Quantity × price is rounded half up to the digits the receipt prints — none
when every amount on it is whole — once: 0,742 kg × 1 290 = 957,18 is 957 on a receipt of whole drams.
The phone calls these very functions on the review (В-6 of MOL-124).

**The place is found by the receipts of its seller recorded in a city** (Р-6; review В4). **The city is
read off an address, never off an item's row** (rounds 4–9): nine rounds of review moved the end of the
head — where items begin — and each OCR shape moved it again; the end stays a bound (above a table's first
heading, two rows above a card's first article, twenty rows where none is read), and what decides is the
row itself. An item named after a city names its kind beside it — «ԳՅՈՒՄՐԻ ԳԱՐԵՋՈՒՐ», «Կոնյակ Երևան»,
a word of the till's dictionary (`TILL_WORDS_RU`, passed in; one letter off counts from seven letters,
since the street «Շիրազի» is a letter off «շիրակի») — or puts the city in quotes as a brand, or carries a
table's heading, an article, a unit «0.5լ», a sum with hundredths, two prices; an address puts a street
beside the city. What OCR adds at the paper's edge — «9.», «2..1», «= 4 -» — stands before both and decides
nothing. Of the addresses: a city opening the row decides; else a city after «ք.» decides only when no other
city is named in the head (a chain's legal address beside its shop's); two cities are no answer, and the
place is then looked for in the person's own city. The chain's name «ԵՐԵՎԱՆ-ՍԻԹԻ», «YEREVAN CITY» is no city.
**A test crosses every shape the bench showed** — marks, item names of both cities, tails, addresses or
none — and no head may name an item's city; on all 260 readings of the bench the city is found where the
address was read (129), and nowhere another. Of
the places this seller's receipts were recorded at there, with the trips still there: the person's own
last, else the one most people chose, the later on a tie — as the shop's memory is read. **A place
keeps no tax number**: a column written by the first receipt named a place for everyone, for good, and
one wrong tap on the sheet sent every receipt of the seller to «SAS». A removed trip takes its word
with it. «Ереван Сити» of Gyumri and of Yerevan are two places of one number; two of one name in one
city are one place by the rule of `places`. **A place picked by its id is held to the receipt's
geography as a new one is** (review 3, В8): the receipt's country and a city of the settings.

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

| What                   | How long                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| A removed receipt      | ten minutes of «Вернуть», then the minute timer (П-8, as MOL-73)                                |
| A receipt not recorded | 28 days after it arrived, whole (В-3) — by the server's clock, not the phone's                  |
| The photo              | until the receipt is recorded: recording deletes it; the timer holds the promise if it does not |
| An item line cut out   | 28 days after the receipt is recorded, and only a line recorded as read (В-4)                   |

**Cut-out lines are item rows only** — a line's figures, and its name row only between two items:
right below the figures of the one before, and with the item's number read on it — one or two digits
and then a letter, never a date or a phone (Р16, Р19). The first item's name row is never cut: the
head is above it, and OCR reads a stray digit at the edge. A table gives its heading row only. Never
the head where a customer's name is printed, never the total (review А5, А6): above the first item
whose name OCR lost stands the head — the VAT, a buyer — and a table's last row runs on into a total
whose word OCR misread. They are cut when the receipt is read, since the boxes are the reading's.
**Recording confirms the rows of a line recorded as read** (В-4, owner, 03.10.2026) — it added up, and
neither its quantity nor its sum was changed — with the text read; every other row goes. The person
never types Armenian letters, so «the text confirmed» is the text read, and a row whose figures were
corrected would teach the reader its own mistake: a wrong label is worse than none.

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
