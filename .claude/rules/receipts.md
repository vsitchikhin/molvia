---
paths:
  - 'packages/model/src/entities/{receipt,receipt-text,receipt-sum,receipt-match,receipt-link,receipt-journal}.ts'
  - 'packages/model/src/support/md5.ts'
  - 'packages/model/src/contracts/receipt.ts'
  - 'packages/model/tests/entities/receipt*'
  - 'packages/model/tests/contracts/receipt.test.ts'
  - 'backend/src/receipts/**'
  - 'backend/src/routes/receipts.ts'
  - 'backend/src/usecases/{receipts,read-receipts,read-tax-receipts,bind-receipt-lines,record-receipt}.ts'
  - 'backend/src/purs/**'
  - 'backend/src/db/{receipts,store-memory}-repository.ts'
  - 'backend/src/catalogue-seed-nodes.ts'
  - 'backend/tests/{receipts,receipt-review,receipt-record,receipt-links}.integration.test.ts'
  - 'services/receipt-reader/**'
  - 'frontend/src/receipts/**'
  - 'frontend/src/stores/{receiptQueue,receiptDrafts}.ts'
  - 'frontend/src/composables/{useReceipts,useReceipt,useReceiptCapture}.ts'
  - 'frontend/src/components/{Capture*,Receipt*,ItemPickSheet,LinkReceiptSheet}.vue'
  - 'frontend/src/views/ReceiptView.vue'
  - 'e2e/{receipts,receipts-link}.spec.ts'
  - 'bin/{fake-receipt-reader,fake-purs}.mjs'
---

# Receipts: the photo, the reader, the lines

The detail behind the receipt lines of `CLAUDE.md`. Reading a receipt on our server came in with
MOL-125, after the measurement of MOL-114 (`.scratch/tasks/research/MOL-114.md`) chose how. Binding
the lines to the catalogue and recording them is MOL-126, the screens are MOL-127; retraining the
reader was measured in MOL-169 and not built (below).

## How a receipt is read

**No model reads a receipt.** A model by the picture on the server's processor took 6–12 minutes and
made the names up (MOL-114). What reads is a chain of cheap parts:

| Step          | What                                                                                     | Where                     |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------------- |
| Photo         | the phone crops to the receipt's edges, full resolution of the crop, up to four parts    | MOL-127, MOL-222          |
| Reading       | Tesseract 5, Debian's `tessdata_fast`, page modes 4 and 6                                | `services/receipt-reader` |
| Figures       | the till's layout or its class code, the line's arithmetic, the discount rate, the total | `receipt-text.ts`         |
| «Переснимите» | not one item line found; read in part is the review's hint                               | `needsReshoot`            |
| No items      | a section printed with no items: a sum to record, never «переснимите» (MOL-227)          | `departmentReceipt`       |

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

## The class code (MOL-226)

**An Armenian fiscal till marks every item with its class code**, after «Դաս.»: a customs heading of four
digits for goods, a class of services «dd.dd» for food service — «56.10» at KFC — often with the till's
article, «Ն/Կ 745030». The two layouts are that code in other forms («0401/1163909», «(3824)») and stay as
measured; **the third reading, `classReceipt`, takes the code as a boundary, not a layout**: a row of
figures is an item, its code the last one above it since the item before, and its name on the side the
receipt's coded items put it — under the figures on the till's table, above them on the terminal's (ՀԴՄ)
print, which carries no article. Without the code the side cannot be told: the till's name stands under
its own figures, the terminal's over them. It reads only from the first code to «Հսկիչ» or «Ընդամենը», so
nothing of the head or the payment is an item, and it is chosen only where it finds more lines than the
two layouts — a receipt with no «Դաս» is read as before.

| What OCR does                                                                                                  | What the reading does                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| «աս, 56.10», «Դաս՝ 56 10», «Դաս. 5610», «нии‘ 5610»                                                            | a class read with its point anywhere on the receipt is the receipt's class; with no «Դաս» it is a code only where a code's follows it — nothing, a digit or two of junk, an article after its comma or mark, or a line's figures whose own arithmetic holds as read — so a price that begins with the class is a price in every form, «5610 5640», «5610:1.0» (reviews 5, 6)                                                                                                                     |
| the code row lost whole («Ан Ц 56. յ wit 70211»)                                                               | the row of figures is still an item, of the receipt's class where every code read is one class of services; the first item too: its figures within three rows above the first code begin the list, and on the terminal the name rows over them — no digit but a count, never the cashier, a word of capitals only on a till that names in capitals, and a second row only where the name runs on across the rows, one of the two starting small («Օրիգի» / «նալ») (reviews А2, Б1, В4, Г2, № 14) |
| «1 հաս 1300 1300», «Բաքեթ 5610 5610», «Կվաս 1000 մլ», «րԴաս», «Գաս», «56.10,745030», «56.10 1 հատ», «56.10 19» | a mark is the word «Դաս» — «Դ» or a look-alike «Գ», «Ղ», «հ», or no letter before «աս» — and its class no figure of the line: not the same figure again (a price and its sum), no figure before «x», no price's decimals «5610.00x», no unit of volume or weight; junk after it is the code's own, and the article's letters or digits glued to it are the article's (reviews А3–А5, Б2–Б5, В1–В3, Г1, № 13)                                                                                     |
| «393191դրա» for 3 931.91, «x10» for ×1.0, «-» for «=»                                                          | the terminal's sum has two decimals always, its count one; a till's figure without its point costs one swap                                                                                                                                                                                                                                                                                                                                                                                      |
| «4 հատ 688.09 688.09»                                                                                          | the line's arithmetic, as the card's (`candidates`)                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| the price lost («1 հատ Ա 120»)                                                                                 | the sum alone, unsettled: it says nothing of the line's arithmetic                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Latin or Cyrillic smudges in a name («Ստրիպս Thuin ‘Al»)                                                       | a word with no Armenian letter is dropped from a name that has Armenian words                                                                                                                                                                                                                                                                                                                                                                                                                    |

**The rules were picked on one receipt, KFC's two prints** (am-14, am-14t: 8 of 8 each, balanced; the bench
80 → 96 of 228, not one line of the readings before lost, no line on the ten sole traders' receipts with no
items). The honest figure is on receipts it never saw — the owner brings two or three of a café or a
terminal (В-4). **The general parse of MOL-229 was not taken as the base** (В-1): on the same bench it made
up 24 lines on the ten receipts with no items and read two or three times the lines there are. The head
ends where the list begins — `classListStart`, the reading's own rows and marks, «5б.10» as «56.10» — wherever
neither layout reads (`receiptCityOf`, review А6): a dish named after a city is a line.

**The price, named:** the terminal's print loses its tax number and fiscal number to OCR, so its two prints
of one purchase are recorded as two receipts if both are shot (В-3); with no article the shop's memory
there is by the line's text only.

**Amounts are counted in hundredths, not in minor units.** A till prints hundredths whatever the
currency; `moneyOfHundredths` turns them into the currency's minor units by its exponent. Quantities
are thousandths. A float is a ratio that ranks candidates, never money.

**The languages are the country's.** Armenia `hye+rus+eng`; Georgia has its language files in the
reader, and joins with its card (MOL-248); Serbia is read by its link, not by the reader (MOL-232). Every alphabet at once is slower and
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

**A class of services is no heading** (MOL-226, В-2): «56.10» rules nothing out, and a dish found by its name
among the catalogue's goods — by the names or by the search — is `weak`: «16 Թև», sixteen wings, is no
«Крылья куриные». The matcher is otherwise the port as measured: a four-digit heading rules out as before.

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

**A person's word is what their last line still there says** (MOL-240, owner's В-1 «а» on adversarial
А1, round 3): its item, its shelf price when «Записать» recorded it as read (`receipt_lines.as_read`, judged
once at the record — round 4, Р4-1: judged again from the purchase as it is now, a sum put right later,
a discount at the till, wiped the shelf price at the next deploy; a line an image rolled back recorded
was never judged, `null`, and keeps its price while its purchase is as the line was read, as 0061 judged
the lines before it — round 5, Р5-1; a line «Записать» judged not as read is `false` and never gets one,
whatever the purchase says later — round 6, Р6-1) and the moment of its record — the
record's transaction time, `now()`, both for `recorded_at` and the word's `written_at` — a new word's
too, not only one written over (round 5), so a word
settled from the very line that wrote it moves nothing (Р4-1б) — or no word once no line says it. A purchase removed, or
its trip removed for good, settles the words of its line by every path that deletes them: «Удалить
позицию», the minute timer, and the final removal «Начать» and a receipt's record make of a trip past its
ten minutes (`forgetWordsOf`, before the delete, in its transaction). A line of a trip only marked removed
still says its word, since «Вернуть» may bring it back. Kept as it was, the word was the person's own,
first on the next review of that shop, and the one way to correct a purchase's item — remove it and enter
it again — brought the wrong item back; and «what, where, for how much and when» lay under the person's id
while /privacy says the record goes whole. **Deleted only when nothing says it, else written over**: a word
is one row per person and key that every record writes over, so the line going may be the one that wrote
it while an older one stands behind the key — left alone, the word carried the removed purchase's price
and moment (Р3-1), and deleted, it lost the item the older purchase says (Р3-2). **Under the person's
lock** (`store_memory`, per actor, taken last — after the trip's row or the owner's lock — and by
`remember` too): two removals at once each saw the other's line, and the word outlived both (Р3-3).
**Settled whole once the API listens** (`settleStoreMemory`): 0061 deleted the lines of purchases removed
before it, and a text key is `toSearchKey`, which no migration can compute (Р3-4); it also settles what an
image rolled back removed without settling. **Never on the way to `listen`** (round 4, Р4-2): every pair of
person and seller in one `in (…)` overflowed the parser's stack from some 8 000 pairs, and the API did not
start at all — so a person at a time, by their id alone, each in a transaction of their own under their
lock, beside whatever writes meanwhile; a failure is reported (`job:store-memory`), never fatal. A removal
reads only the sellers of its lines. Settling never inserts a word. The price:
a trip removed as a duplicate forgets its words until that article is recorded again. **This is not
erasure**: the erased leave their words without a name, still counted (MOL-58) — a person leaving is not
a person taking a purchase back.

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

**A receipt of food service is recorded as a shop's, with products, until 0.3** (MOL-226, owner's В-2 «а»
after review 1): a venue and its dishes have no screen yet — «Оценки», the 19:00 reminder, «Что брать» and
«Тут дешевле» read products only, and a rating goes with no place — so eight dishes of KFC recorded as `dish`
in a `venue` could not be rated at all. Gate 0.3 counts views of «Что брать» (`advice_viewed`), not the
kinds recorded, so recording as a venue bought it nothing. The class stays on the receipt's lines
(`receipt_lines.hs`): the venues of 0.3 take it from there with nothing read again.

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
are there — a trip removed lets a new shot of it be recorded. A receipt with no number is held by its id
alone.

**A recorded receipt is not removed while its trip is there** (review 1, В1, В2): its row dates the trip
on the accounts, names it «из чека», names its seller's place and guards against a second record —
removed, the trip moved a week on its account and the same receipt was recorded twice. **It goes with
its trip, and a line with its purchase** (MOL-240, adversarial А2 and Б2 of MOL-97): `trip_id` and
`expense_id` are `ON DELETE CASCADE`, a cut-out row goes with its line by the key
`(receipt_id, position)`, and `receipts_recorded_with_trip` refuses a recorded receipt without a trip.
They were `SET NULL`, so that a receipt whose trip was removed for good could be recorded again from its
lines (В7) — but the phone draws no recorded receipt, so nobody could, and what a person removed lay on
the server, unseen, until erasure. The paper is recorded again by a new shot: its twin went with the
trip. A trip only marked removed keeps its receipt whole, and «Вернуть» brings both back; until then
«Записать» is a 409. **A line not recorded goes at «Записать»** (MOL-240, В-2): nobody sees it once the
receipt is recorded, and what it costs is counted at that moment — so a recorded receipt's lines have
gaps, and a line is found by its `position`, never its place in a list (`codesAgain`; the wire carries
no position, so a recorded receipt's `lines` are never read by their place). The minute timer deletes a
recorded receipt's line that is no purchase too, as it does a photo (adversarial А3б): **an image rolled
back** onto this schema records with every line kept, and 0061 does not run twice. The rest of a rollback
is a named price, nothing written wrong: its erasure deletes the trips first, and the cascade takes a
recorded receipt uncounted in the report (А3а); its repeat of «Записать» reads a code by the line's place
and may name another line's code to the phone (А3в). «Удалить чек» reads the receipt under the row's lock «Записать»
holds (round 2, Р2-В1): a record committed while it waited is seen. **One trip is one receipt's**
(`receipts_trip_key`), and the recorded receipts are indexed by their seller (`receipts_recorded_tin_idx`):
every look at a receipt reads its seller's place off them.

**What a line is recorded at, before the person corrects it** (MOL-124 В-5, П-2, `receipt-sum.ts`): a
line that adds up — what was paid; one that does not — the printed sum where the printed total confirms
it, else quantity × price. Quantity × price is rounded half up to the digits the receipt prints — none
when every amount on it is whole — once: 0,742 kg × 1 290 = 957,18 is 957 on a receipt of whole drams.
The phone calls these very functions on the review (В-6 of MOL-124).

**The place is found by the receipts of its seller recorded in a city** (Р-6; review В4). **The city is the
one city the head names, read off an address** (rounds 3–10). Ten rounds of review moved the end of the head
and the shape of an «address row», and each form OCR made moved them again; the rule is now two halves.
**Any second city named in the head is no answer** — an item named after a city, a chain's legal address
beside its shop's — and the place is looked for in the person's own city: an address read in any form
names its city, so no item can name another one beside it. **And the city must stand in an address row**:
a house after its first word («Գորկու 62», glued «Գորկուծ22», «62գ» a building), four digits at most — five
and more are a tax number — or, with «ք.» before the city — a mark no item's name has — the house anywhere on the row («62, Գորկու փ., ք. Գյումրի») or the street and the house on the next («ք. Գյումրի,» / «Գորկու 62»); a shop named after a city over a street without one is no address (round 12); and
none of an item's marks — a kind of the till's dictionary beside the city (`TILL_WORDS_RU` and the Latin
`TILL_KINDS_LATIN`, «LAGER», passed in; one letter off from seven letters), the city in quotes, a table's
heading, an article, a unit right after its number «0.5լ», «5տ», a gram from a hundred «500գ», a sum's
hundredths, a price and a sum at the row's end. A word cut with a dot decides nothing — «Գոր.», «Վարդ.»
are streets as often as kinds. A house «62 տ.», a postal code, a day on the row, a flat «162/105», any mark
OCR put at the edge are an address's. **The chain's site** — «www.yerevan-city.am», «Ww Yerevan: СПу. ат» —
names no city (round 11) — a row with no digit: an address with its country's code «…, AM» is still one (round 12). The end of the head stays a bound only: above a table's first heading, two rows
above a card's first article, twenty rows where none is read. **The one form left** is undecidable from
the text: the address not read at all, and in the head an item named after a city with no kind beside it
— a bare brand, a kind OCR cut mid-word — and a number. It names the item's city; the person sees the
place on the review. **Two tests cross every shape** the rounds found — marks, names, tails, addresses —
both ways: with the address read nothing names another city, bare brands included; without it, no item
with its kind does. On all 260 readings of the bench the city is found in 133, and never another.
Of
the places this seller's receipts were recorded at there, with the trips still there: the person's own
last, else the one most people chose, the later on a tie — as the shop's memory is read. **A place
keeps no tax number**: a column written by the first receipt named a place for everyone, for good, and
one wrong tap on the sheet sent every receipt of the seller to «SAS». A removed trip takes its word
with it. «Ереван Сити» of Gyumri and of Yerevan are two places of one number; two of one name in one
city are one place by the rule of `places`. **A place picked by its id is held to the receipt's
geography as a new one is** (review 3, В8): the receipt's country and a city of the settings.

## Retraining the reader (MOL-169): measured, not built

**A retrained `hye` does not replace Debian's** (owner's stop, 04.10.2026; `.scratch/tasks/research/MOL-169.md`).
Fine-tuning starts from the float `tessdata_best/hye`, which reads the bench 54 of 162 against the
`tessdata_fast` model's 66; synthetic lines in free faces, in the tills' own Arial AMU, and the bench's
real lines labelled by В-2 «б» never passed 57 — and whole words of a figure row go to `rus`, which no
retraining of `hye` touches. **As a second reader** — two more readings among `bestReading`'s candidates —
it gave 70–72 and lost nothing, every line gained on the delivery till (am-06), still 7 of 46 there.
Worth coming back to with a new receipt of that till and after the edges of MOL-222; the bench and its
scripts are kept. The cut-out lines are still kept and confirmed (В-4), with no reader of them yet.

## «Переснимите» — only when not one line was found (MOL-222, В-1)

**Every receipt with a line in it is read and goes to the review** (owner, 04.10.2026: «читать надо
все кассы, все чеки, пытаться максимально собрать информацию»). A receipt fails as `reshoot` only when
not one item line was found: there is nothing to correct, and only a new shot can help. What was
«переснимите» before (В-4 of MOL-125) — the total read and the lines under 70 % of it, or no total and
fewer than half the lines adding up — is **read in part** (`readPartly` in `receipt-sum.ts`, one
function for the server and the phone): the review says «Прочитали не всё» under its count with
«Переснять» beside it, and «Записать» stays. Before, it threw away everything read: am-06, a till whose
print Tesseract misreads, found 14 lines of which 2 add up and showed none of them; a crumpled am-13L
found 11 with 9 right. Now the person sees them and puts them right, and **those corrections are the
measure of 0.2** (`receipt_days`, below) — a till read badly is one to learn (MOL-169), never one to
refuse. **The total alone decides nothing**: OCR missed it on 9 of the bench's 16 readings, most of
them good ones. **«Переснимите» asserts no cause it does not know** — «Не нашли ни одной строки» and the
advice, not «смят или в тени»: the owner's three shots of 04.10 were none of those. **It names the ones it
may be, faint print among them** (MOL-227, owner's В-2 «а»): «так бывает, когда чек смят, в тени или
напечатан бледно» — and a retake fixes no faint print (the delivery till WIN-…, am-06, read alike on every
shot, larger, thicker, retrained), so for that one the advice is a record by hand; «Прочитали не всё» says
the same — «если печать бледная, переснимать не нужно — поправьте строки» — beside its «Переснять».

**What a person can do with a receipt read badly** (В-2): «Отправить чек разработчику» on the failure
and at the foot of the review, while its photos are on this phone — they go into «Написать
разработчику» as pictures do (`feedback.md`).

## The measure of 0.2: what people put right (MOL-222)

**`receipt_days` counts, by day in Yerevan and with no id of anyone**, as `login_days` does (MOL-68):
how readings ended (`read`, `read_partly`, `reshoot`, `no_items` — MOL-227 — `unreadable`, the attempts'
cap included), and
at «Записать» the lines of the receipt, those put right, and each kind — left out, another item than
the review showed, the quantity or the sum changed — a line counted once however many; receipts whose
**total** was put right (`totals_corrected`) — one that differs from the total read: opened, checked and
saved as it was is a check, not an edit (review 10) — one edit of the receipt, never of the lines it
confirmed: a total put right moves the sums of the lines that do not add up (В-5), and counted as
theirs it made one field N edits (review 2, adversarial А7); and how long from the server taking the
receipt (`created_at`) to its record, in buckets: never the phone's clock, and `captured_at` is the
moment of «Отправить».

**What was put right is the phone's word** (`edited` in the body of «Записать», `review.ts`): the
positions of the lines whose item differs from the one the review showed and whose figures differ
from the ones the server showed before any edit — never the ones a total typed since would show: the
draft keeps no order of edits, and a line typed before a total that confirms it was lost from the
measure (adversarial Б3). **The prices, named, both of one choice:** a line where the person
typed by hand, after a total put right, the very sum that total confirms is counted as figures put
right — opened and saved as it was, it is not, the sheet keeps no figures it did not change; and a
line where they typed, after a total put right, the server's own sum (the shelf's 890 where the total
made it 980) is not counted, though it is recorded at 890 (adversarial В2). **The item is compared
with what the review showed at the line's first edit**, kept beside the drafts (`molvia.receipt-shown`,
never inside a draft line, which the build before reads strictly): read again after another record
taught the memory the same correction, the review shows the person's own word as the reading's, and
the edit vanished (adversarial В1). A draft of the build before has none, and its lines go by the
review as it is now. Only the phone knows what it showed — the shops' memory is shared and learns
from every record, so between a review and its «Записать» another record (the person's own, queued
before it, or anyone's in the chain) changes what the server would show now (adversarial А6). A number
of the measure, never money: the server takes positions of recorded lines only. **A phone of an
earlier build sends none**, and then each line is compared with the review as the server would show
it now (`shownLines`, the review's own function) under the total the phone sends — **the price,
named:** for those builds a record made after another one taught the memory counts against the new
memory. A new item kept new under another name is no edit either way: the reading gave no name to
correct. Written in the transaction it counts, the last statement of it; a repeat of «Записать»
counts nothing — and a new shot of a receipt whose trip was removed counts as the new receipt it is
(MOL-240). Erasure does not reach it, and an erased person's corrections still count.
**`make gates` reads it as the block «0.2r»** with its stop line — more than a third of the lines put
right after four weeks brings the question of the reader back (`RECEIPT_EDITS_STOP_PERCENT`, owner,
04.10.2026) — beside the share the readings that never reached a record, since the share is of
recorded receipts only, and the totals put right. The log of a reading carries the lines found, those
that add up and «in part»: `lines: 0` of every «переснимите» sent the owner to a wrong cause on 04.10.

**Receipts that failed as `reshoot` before MOL-222 say «Не нашли ни одной строки»**, though some had
lines under the old rule (am-06: 14): the price, named — before 0.2 only the owner is on production,
and those receipts are taken again (Т-10).

**A receipt from the tax office is counted beside it, never in it: `tax_receipt_days`** (MOL-234, owner's
В-1…В-3 «а»). **A table of its own, not a `source` in that one's key** (Р-1): a key moved would break the
`on conflict (day)` of the image a failed deploy puts back, and every reading would fail on it. The same
shape and rules — by day in Yerevan, no id, in the transaction it counts — and its own columns: how the link
came, counted **when the server takes the receipt** and only then (`sent_qr`, `sent_qr_missed`,
`sent_paste_missed`, `sent_paste`, `sent_unnamed` — a repeat is the same receipt, Р-2); how the tax office
answered (`read`, `missing` after 48 hours, `invalid`, `empty` — a journal with no list); **what failed on
our side apart** (`unreadable` — a link lost in a restore, an answer we could not write: no answer of the
tax office's, adversarial А7); the specification (`specs_ok`, `specs_failed`, `specs_skipped`) and the
lines it gave a code (`lines_coded`); at «Записать» the lines put right by the
same kinds as OCR's — what the matcher missed, the figures being the tax office's — the total, the codes
bound (`codes_written`) and the time to the record. **`make gates` reads it as «0.2r · the Serbian tax
office», under the reader's block and with no stop** (Р-5): its share is the matcher's (MOL-251), and the
four ways a link came are the risk of MOL-233 — a link pasted after the camera missed is a QR that did not
read; one pasted with no shot is a habit. **No count before MOL-234** (Р-4): the edits exist only at the
moment of a record, and before 0.2 only the owner is on production. A miss after which the person gave up
is counted nowhere — the phone sends only its defects (MOL-144).

**A code from the receipt is bound by the person, at «Записать»** (MOL-234, owner's В-2 «а»): a line's code
that no item holds in any of its forms goes on the review as `code` — the item shown holding it is nothing to
ask, and another item holding it (the shop's memory put another on the line) is a question whose answer
could only be «held» (review 3). **Only to a phone that asks for it** (`RECEIPT_CODES_HEADER`, adversarial
А3): an installed app of an earlier build reads a line strictly and would not open the review; a header, not
the query, since a server rolled back refuses a query it does not know. «Записать» asks once, «Привязать
штрихкоды?», listing each code with the item it would go to: «Привязать и записать» sends the lines'
positions (`barcodes`), «Записать без кодов» none; put away with no answer it records nothing. A new item
made from a line is asked about too (Р-10). **The code is written by MOL-100's rules inside the record's
transaction**, by the same `attachBarcode`, a savepoint of its own: written; there already; another item
holds it — named, nothing written; twenty — none. **The record stands whichever it was**, and the answer
carries each outcome (`codes`); «Записали N покупок» names a code another item holds, by that item.
**Every item the record touches is locked first, in the order of the ids** (`lockForRecord`, adversarial
А1): `FOR UPDATE` where a code goes, `FOR KEY SHARE` where a purchase points; taken as the record went —
the purchase's key, then the code's update — two people binding a code to one item waited on each other,
and one record was a 500. The codes are then bound in their own order, since each code's lock lasts the
transaction. **A record sent again answers its codes again** (А2): told by who holds each code now — the
line's item `written` (whether it held it before is not kept), another `held`, nobody `full`.

## A receipt with no items (MOL-227)

**A sole trader's terminal prints no items at all**: its section «Բաժին 1», the turnover tax with the
section's sum, the total, the payment, the tax number, the day — ten receipts of one trader on the bench
(am-15…am-24, two tills, a bold print and a thin one). Read whole, it said «переснимите», though another
shot reads the same. **It is a sum to record** (owner, 04.10.2026: «с чеков мелких частников можем хотя бы
сумму забирать»): a trip on the receipt's day whose money is the total (MOL-78), its purchases added later
in the record if the person wants them — «Добавить позицию» is already there (В-1 «а»); the review adds no
line (MOL-222 Р-14 stays where it was).

**Told by what is printed, only where no reading found a line** (`departmentReceipt`, from `bestReading`): a
section «Բաժին» (and OCR's «Ււսժին», «Բայժին») and nothing an item prints anywhere — the class code, a
customs heading **with its item's name after it** «(3824) ՏՈՖՈՒ», a till's article **of six digits and
more** «0401/1163909» (the bench's 386 of 394; the eight of five digits are articles OCR cut), a table's
heading. Dog City and KFC print «Բաժին» too, over their items. **A phone in the trader's head is no item**,
«(0312) 5-12-34», «0312/51234» (adversarial А2): first looked for under the section only, it came back in a
reading that lost the section — psm 6 of am-20 read «СЕТЕ 1-1» (round 2, Б2) — and that rule would have
taken a till printing its sections in the footer for one with no items (review 2, № 10); the marks are
read anywhere and made narrower instead. **Nor is it Dog City's table**: a customs heading names its item after it,
«(3824) ՏՈՖՈՒՀՈՂ», and only that starts the table — read on any «(dddd)», a phone made one «line» of the
whole head; the bench of every reading did not move. On the bench: 10 of 10 of the trader's receipts, 0 of 25 readings with items — the seven of
them where the parse found no line among them, which stay «переснимите». **The price, named** (Р-7): a
receipt with items whose every mark OCR lost and whose «Բաժին» it read is recorded as a sum; the person
holds the receipt and reads «В чеке нет списка товаров», with «Переснять» beside it (adversarial А6) —
the review shows no photo.

**Its head is the terminal's, read there only** (Р-2): the three layouts keep theirs, measured in rounds.
The tax number is eight digits after «ՀՎՀՀ» first, anywhere; else before the till's registration number
**on the same row** — «CUCC: 57311783 Գ/Ը: 31028805», however OCR read the word — **never the receipt's own
number «ԿՀ: 00000049»**, which the card's rule took on nine of ten, nor the same number on the row above
the till's (review 1, № 1: the tax number is the key of a place for everyone); the day is DD-MM-YY; the
fiscal number in capitals. **A day no calendar has, a time no clock shows, is no reading** («64-10-26»,
«76:36»), and outvotes the other reading's right one by nothing (adversarial А3). **A field the two
readings read apart is not read** — psm 4 «87311783» against psm 6 «57311783» is no tax number. **The total
is the amount two of three agree on** — the section's sum, «Ընդամենը», the payment (Р-3): «Ընդամենը 550.09»
read once is outvoted by «550 00» twice, and one source alone is no total, since a wrong sum on a trip is
worse than none the person sees and types. **Two receipts on one photo** print two moments (am-21) — or,
the upper one's head out of the frame, two totals or two fiscal numbers, since a receipt prints each
once — **or a head under a fiscal number**, the last row of a receipt: the middle of a tape of two, one of
each in view, gave the lower receipt's time under the upper one's number (round 2, Б1). Whose total, time
and number it is nobody can tell, so none is read. **And the fiscal number — the receipt's key against a second record — is read
only from a reading that holds the receipt whole**, its moment above its number (round 3, В1): each sign of
two receipts is seen within one reading, and two readings each holding half a tape — one the lower head and
no number, the other the upper number and no head — made the key of two receipts again. **The price,
named:** such a photo keeps the time it read, the lower receipt's, beside the upper one's total — the time
orders a trip among the day's purchases and keys nothing — and with no number its receipt shot again is a
second record (Р-8). **Nor is the tax number of two receipts one head's** (round 4, Г1): it is read only where a
reading holds both heads and they print one number — two receipts of one trader, am-21, keep their place;
one head in view may be the other receipt's, another trader's, and the upper receipt recorded at its shop
under the lower trader's number proposed that shop to everyone who shot his. Read by the moments alone, such
a photo took the lower receipt's total under the upper one's fiscal number, and the upper receipt shot on
its own was then refused as recorded (adversarial А1). **The price, named** (review 1, № 5): a moment
printed twice and misread once — or noise read as a head under the fiscal number — is read as two receipts
too, on the safe side: the person types the total and, since one receipt has one head, chooses the place —
it is not proposed by the tax number, and the record teaches that number nothing (review 5, № 13). The bench, before → after: «no items» 0 → 10,
the tax number right 1 → 9 (none wrong), the total 2 → 7 (none wrong), the day 0 → 8, the fiscal number
0 → 3; not one field of any other reading moved (`.scratch/tasks/status/MOL-227/score.mts`).

**«Без товаров» is a `parsed` receipt with no lines** (`withoutItems`, Р-1): since MOL-222 a receipt is read
only with a line in it, so an empty one is this and nothing else — no status, no failure, no field on the
wire; `layout` is `department`. The tally of `receipt_days` and «Покупки» ask `withoutItems`; the bot
repeats no rule of the API and reads its count (review 1, № 6). It is counted as `no_items`, never `read_partly` (`readPartly` of no lines
is true). **The review** says «В чеке нет списка товаров — запишем сумму», draws the total without «Строки»
and with no difference, and «Записать сумму» waits for a total — **a trip with no money and no purchase is
refused by the server** (`error.receipt_total_required`, 409 as the receipt's state refuses it, review 1,
№ 8; Р-4), the phone only keeps the button from a tap; the same holds for a receipt whose every line is
left out and whose total nobody knows, **and for «Убрать сумму» on a finished trip with no purchase**
(adversarial А4, `trips.md`): one tap after the record it made the very trip «Записать» refuses. **No more is
promised** (round 2, Б3): a purchase added, the sum taken off and the purchase removed leave such a trip,
as removing the last purchase of any finished trip did before MOL-227. The
review's note says «Фото удалим после записи» — no line stays (А5). After the record «Записали сумму по
чеку», with no second sentence over «Здесь пока нет покупок» and no «К оценкам»: there is nothing to rate
(review 1, № 7). «Покупки» say «без товаров · {day}», the bot «товаров в нём нет — можно записать сумму»,
and **a trip with its sum and no purchase is «сумма по чеку»** — by the sum, wherever the trip came from:
«сумма по чеку · {day}» in «Записаны», with no «из чека» beside «по чеку», and «{category} · сумма по чеку»
in «Деньги» and an account, never «0 позиций» (Р-6; review 1, № 2, adversarial А7); a trip with neither is
«0 позиций», never a sum it has not got (А4b). **Two shots of one such receipt
are two records** where the fiscal number was not read (Р-8, the price): «ԿՀ» is one and the same on both
tills of one trader. End-to-end, the fake reader answers a square photo with such a receipt.

## A total two sources vouch for (MOL-244)

**A total is shown only where two sources vouch for it** (owner's В-1 «а», 09.10.2026; MOL-255's «неверно
прочитанное хуже непрочитанного»), in this order: the lines of the reading chosen met it **every one as
read**; else two places on the paper print it — the total, the payment and, on a receipt with no items, the
section's sum — by one function for both kinds (`votedTotal`, MOL-227's vote moved out of
`departmentReceipt`): the amount read in the most places, at least two, and the only one so; else the lines met
it **with one of them as read**. **Two readings of one row are one place**:
they read one photo, and a digit of the tills' font misread is misread in both — every wrong total of the
bench was so, «Ընդամենը 2060.01» for 2050.01 in psm 4 and psm 6 alike (am-08, am-13, am-36). **Nor is one row
two places**, whatever words OCR put on it: a row is the section, else the total, else the payment
(adversarial А2) — and a row the section took as its tax is the section's alone (round 2, Б2). **The discount is told by «եղչ»** — «զեղչ», «Զեղչ», OCR's «qեղչ» — as loosely as the total's
«դամե» (А3). **The vote comes before lines the total changed** (А1б): the total judges the lines, and makes
them meet it — it swaps a digit of a line read right (150 → 160) or gives a line with no reading what it
leaves — so «balanced» alone is the total vouching for itself. **Lines that met it every one as read and two places naming another sum vouch for none** (round 2 Б1,
round 3 Ц1; owner, 09.10.2026): the font's «5» read «6» in a card payment of both readings and in one reading's
total is two places for a wrong sum, and a line and the total misread alike (hand/am-09) is lines as read for
one — the text tells the two apart nowhere, so the person types the total. On the bench every line of am-09 and hand/am-08 was changed so, under
a wrong total; a reading whose lines the total changed every one of vouches for nothing (owner, adversarial
А1: «хотя бы одна строка как прочитана»). **The price, named:** a misread total that changed one line while
another stands as read is still shown (А1а, А1в — none on the bench); closing it cost four right totals (am-05,
KFC on both prints), whose totals put one to three lines right. **The total shown is the lines' one judge**
(review 4, 7; adversarial В1, Г1). **None shown leaves nothing of itself in them**: the reading chosen is
judged again with no total — every line as read, no rest given to a line with no reading. Kept, a line put to
160 by a total nobody sees went on to the trip's money (am-09; hand/am-08 got its right line back). **Two places
shown judge every reading again**, and the one that meets them is chosen — a row OCR lost takes what they
leave, as under its own total: Dog City's «Ընդամենը\` 9450.00», which the table's pattern does not take, left
a row empty under a total shown. **A table with no total to judge — none read or none shown — reads as
printed**: its total chose how «1,5 1 350» splits, so with none a row takes its own arithmetic, else its last
figure as its sum — 1 350 at 900, never 2 025 at 1 350 — and a row whose figures OCR lost stays empty. **A
line's candidates are found once** (`Laid`): judged again, a reading costs the judging alone, so the worst
shape of the review — four hundred rows of junk in two readings — takes what it took before MOL-244. **A sum with its thousands apart is read whole** — «6 331,07», never 331,07 in two places: the
card's shelf total and a card payment print so where there is no discount. **A table's total is never
«balanced»** (Dog City, `tableReceipt`): a blank row takes what the total leaves, so its lines meeting it vouch
for nothing — its total stands by its payment «Կանխիկ».

| On the bench, 69 readings with a truth                   | right  | wrong | none   |
| -------------------------------------------------------- | ------ | ----- | ------ |
| before: the reading's own «Ընդամենը»                     | 20     | 8     | 41     |
| the vote, else the reading's own                         | 23     | 8     | 38     |
| the lines, else the vote, else none                      | 21     | 3     | 45     |
| **the vote, else the lines with one as read, else none** | **21** | **1** | **47** |

Not one line moved (96 of 228). The one wrong left, hand/am-09, is a line read with the very digit the total
was misread with — as read, and no vote sees it. **Two receipts with items on one photo show the upper one's
vote** (adversarial А4, as before MOL-244): a receipt without items drops its total for two moments or two
fiscal rows, but one receipt of «Ереван Сити» prints both twice on nearly every reading of the bench, so no
such sign tells two of them. **The price, named:** two right totals are not shown (am-03,
hand/am-01): «Ереван Сити» prints its payment as the cash handed over, so nothing vouches for its total; the
person types it, and the measure counts that as a total put right. **A payment alone is never a total the
lines are settled against** (В-2 «а»): tried on every reading of the bench it balanced one receipt, already
right, and a blank line takes «what the total leaves» — 20 000 handed over in cash would have made its sum up.
Only a total two places agree on, the total shown, judges them.

**What was read in one place is kept for «Прочитали не всё» alone** (`receipts.read_total_minor`,
`readTotalHundredths`): hidden, the hint fell back to the share of lines that add up and went quiet on three
receipts read in part (am-13L, hand/am-01, am-36). The server's `partly` and the review measure the lines by
the total, else by it — «строки дают X из примерно Y». It is never the total shown, the trip's money or a
line's recorded sum (`shownLines` reads the total). **On the wire only to a phone that asks**
(`RECEIPT_READ_TOTAL_HEADER`, as `code`'s): an installed app of an earlier build reads the detail strictly.
A receipt read before keeps none; its total is the one it was shown with. The copy carries it (version 18).

## A Serbian receipt by its link (MOL-232)

**A Serbian receipt is not read off a photo: it is asked of the tax office** (MOL-223, `.scratch/tasks/research/MOL-223.md`).
Its QR code is the link of the tax office's check, `https://suf.purs.gov.rs/v/?vl=…`; asked for JSON —
TAP's own mode, no authentication — it answers the seller and the journal, the tax office's own rendering
of what the till sent. The journal laid out by Serbia's card gave 20 of 20 lines of three live receipts by
every field, 78 of 78 on the 23 journals of MOL-229. A country's receipts come one way
(`receiptSourceOf`): Armenia by photo, Serbia by link — read off a photo by the phone (MOL-233, below).

**`vl` is checked with no network, by one function for the phone and the server** (`serbianReceiptLink`): the
host, a size of 572–848 bytes and the MD5 at its end — `md5Hex` in the domain, which has no `node:crypto` —
and **a sale only**: a refund has nothing to record, a copy is the same purchase twice, a pro forma, a
training or an advance receipt is no purchase. It carries the signed total (in ten-thousandths of a dinar,
half up to the para), the moment and the number `requestedBy-signedBy-counter` — the receipt's head as it
is taken, and its key against a second record (with the seller's tax number, as an Armenian one).

**The lines are the JSON's journal; the page and its `/specifications` are asked after it for the codes
alone** (MOL-232 В-1 «а», MOL-234 В-1 «а»). The specification is undocumented and answered `success:false`
two times of three from production, so **it is waited on for 3 s at most** (`PURS_SPECIFICATION_TIMEOUT_MS`,
adversarial А4 — it was the journal's 10 s, twice): asked after the journal and before the receipt is
written, so **a receipt is never shown without its codes** (review 9, adversarial Б1). Written first and
coded after, a review opened in that second had no `code` and a line on the search's item, never read again
— the code lost and a twin of the item made — and at most three seconds bought that. One deadline for both
requests — the page for `viewModel.Token`, then the POST — which are reserved in the
limit together, never the page alone; a failure, another shape, a page of another receipt — no codes, no
pause of the queue, no owner's notice, its own line in the log at info (review 8) and `specs_failed`.
**The price, named** (А5): the person's share is four a minute, and a receipt takes three — so the second
receipt of a minute has no room for its specification, is never asked again and has no codes;
`specs_skipped` and the block's «not asked, over the limit» say how many. **A code is taken only from a
specification in step with the journal** (`specificationCodes`, Р-7): as many lines, each paid the same, in
order — one out of step takes every code, since a code on the wrong line is worse than none — and only a
code the catalogue would take (`writtenBarcode`: its check digit, never a shop's own), in the form written.
It lives on its line, `receipt_lines.gtin`. Measured on three live receipts: one line of twenty had one.

**The tax office has a queue of its own** (`readTaxReceipts`, the embeddings' runner, nudged when a link
arrives), never the reader's: `claimNext` takes photos only. **People in turn**, the one asked about least in
the last hour first; **twelve asks a minute, four a person** and a minute of silence after a failure of the
service — the figures of Open Food Facts (Р-3); over the limit the round stops and the receipt waits, never
refused. **A receipt not shown yet is no failure** — a receipt just printed shows in a minute or two, one
of a till that was offline later: asked again after 1, 2, 4, 8, 15 and 30 minutes, then hourly
(`receiptLinkRetryMinutes`), and `missing` once `RECEIPT_LINK_WAIT_HOURS` (48) passed since it arrived;
`400` or `isValid: false` is `invalid` at once, and so is an answer about another receipt than the
link signs (review 8); a journal with no list is `unreadable`. **A failure keeps what the link said** —
its day, time, number and total (review 2, adversarial А1): wiped, the queue's own repeat of a send
whose answer was lost met a 409 and the phone said «не принят» of a receipt the server held. A 404 pauses
nobody; a 5xx, a timeout or an answer of another shape pauses everyone a minute — the price, since a fresh
receipt sometimes answers 5xx too. **An answer that no longer reads — not JSON, or JSON of another shape —
is also the owner's** (`onBroken` → `failures`, job `receipt-link`, review 4): otherwise every Serbian
receipt waits its two days and fails as `missing` for a reason that is not the till's; a 5xx or a timeout
is the weather, the log's alone.

**The link lives in a table of its own, out of the nightly copy** (`receipt_links`, adversarial А4); a
receipt restored without it fails as `unreadable` before the next ask. **A failed receipt by its link is
told in the tax office's word, never a photo's** (adversarial Р2-1, Р2-2): the bot's notice carries
`taxOffice` — `missing`, `invalid`, or `unread` for any other failure — decided by the API from the row's
`source`, and the bot never says «переснять» of a receipt with no photo. `unread` asserts no cause: it
covers a journal with no list, a link lost in a restore and a failure of ours alike, so neither the review
nor the bot says «the tax office showed it with no list» — only that it was not read, with a record by
hand or the link pasted again. **On the phone the sheet stays at
work for a double tap** (`DOUBLE_TAP`, adversarial А3): the link is queued at once, and a sheet that went
down on the first tap let the second through onto the tab bar — «Оценки» opened over the receipt just
sent; a double click queued it twice.

**The price, named** (adversarial А7): the trip of a receipt is placed by its printed day and time, read
back on Belgrade's clock; in the hour lived twice on the last Sunday of October a receipt of the first
02:30 is placed an hour late — the exact moment is in the link, and the link is not kept.

**The journal's card** (`serbianJournal`): under «Назив Цена Кол. Укупно» a name runs over rows cut at
the fortieth column, mid-word as often as not, to its tax label «(Ђ)»; the next row is «price quantity
sum», «.» for thousands and «,» for the decimal — read as strings into hundredths and thousandths, no
float. The unit is the last unit word of the name standing alone — `KG` a kilogram, `LIT` a litre,
`KOM`, `KO`, `FL` a piece, «1KG» and «0.33L» being sizes; with none a fraction is weighed, and poured
beside a bare «L» — **a bare «L» with a whole count is a piece** (review 5): «PIVO 0,5 L» × 2 is two
bottles, never two litres at half the price of one. **A line paid less than price × quantity is
discounted** (adversarial А2): the journal prints no row for a discount — «Pesto 440,00 × 4 = 1.408,00»,
a fifth off — and the total is the sum of what was paid, so the difference is the line's discount and
the line settles; «≠» never stands on a line of the tax office. A line paid more is not settled.

**A line finds its item by the shop's memory, then by its code, then by its name whole** (owner's В-3 «а»;
the code MOL-234, Р-9): a code an item holds — with its twins, as the scanner's (MOL-99) — binds the line to
it, near; the memory is still laid over it on reading. Then `serbianItemName`
— the printed name less its unit word and the till's article at either end (a GTIN or a chain's code
opening it, «383841701269 KESICA…», «[528195] KASIKA…», adversarial А5), set as a sentence — searched
with its meaning;
near is `search`, far `weak`, nothing `new`, named so. **Measured on the 98 lines against the seed**
(`.scratch/tasks/status/MOL-232/bench-binding.md`): 14 near, 12 of them right, 2 far, 82 new. Asked again by
its first two words and its first, the search added 34 far lines, some 30 wrong — «UBRUS», paper towels, a
vinegar — and a wrong «проверьте» taken at a glance is a wrong purchase, so it is not done. **A service is no product** (adversarial А6): «Достава» at 0,00, a tip «Напојница», a «Услуга» —
`serbianServiceLine`, either script — is not searched for and goes «проверьте» with no item, for the
person to leave out or record; a delivery at 0 recorded in silence would be an item's lowest price. **82 new of 98
is the case for a dictionary of Serbian till words** as the Armenian one, a task of its own. The memory
needs nothing new: the tax office prints a line the same every time, and the second receipt of a chain
knows what the first was taught.

**The place is the premises', not the chain's** (Р-7): a Serbian chain shares one tax number among
hundreds of shops, so a receipt carries the premises' code and name (`shop_unit`, `shop`, from
`locationName` «1113343-RODA MEGAMARKET 463») and its place is the one that premises' receipts were
recorded at — whatever city, while a photo's stays by city. **A place still keeps no tax number.** A new
place is proposed by the shop's name; the city is the municipality's, Belgrade or Novi Sad, else the
person's own — the price: a receipt of Niš proposes their city.

**The measure of 0.2 is the reader's** (Р-5 of MOL-232): a receipt by its link writes nothing to
`receipt_days` — by the row's `source`, never guessed from the country (review 7): its lines have nothing
to read wrong, and counted with OCR's they would thin the stop line. It is counted in `tax_receipt_days`
(MOL-234, below).

**On the phone the QR code is read off the photo, and only the link goes** (MOL-233, owner's В-1 «а»):
a person whose country is Serbia gets «Сфотографировать чек» as anyone whose receipts are read, on «Что
брать» and in «Покупки» (`LinkReceiptSheet`), the system camera or the gallery. The shot is read **whole**, as
`decodePhoto` draws it — no «Края чека», no parts: nothing of it is sent, and a warp redraws the modules — in
a worker of its own (`receipts/qrWorker.ts`) with the scanner's wasm from the app's own origin, **`QRCode`,
`tryHarder`, up to four symbols** (`RECEIPT_QR_OPTIONS`): without `tryHarder` the bench's code at four pixels
a module on a 12 Mp photo was not found, and a receipt prints a shop's own QR beside the tax office's — am-03
carries Ереван Сити's (`.scratch/tasks/research/MOL-233/probe-12mp.mjs`). **The first code that is a link by
`serbianReceiptLink` is the receipt** (`receiptLinkOfCodes`); a refund or a copy is said by its reason, as
under the field; anything else is «QR не нашёлся». **The photo is let go as soon as it is read** — never on
the shelf of IndexedDB, never in the queue; a shot picked from the gallery stays in the gallery, which the
page cannot touch. The link goes by `sendLink`, the same write as a paste, and the sheet stays at work for
a double tap (`DOUBLE_TAP`, adversarial А3). **No code on the shot — how to shoot it, and the link pasted**
(В-2 «а»): «Вставить ссылку» opens the field of MOL-232 in the same sheet — the system camera opens the tax
office's page, its address is copied — and the link is checked by the very function of the server. **No
reading of Serbia by OCR exists**: the task's «the usual OCR path» has none to go to, and a Serbian
receipt's photo would be refused by the schema; one is built only if live receipts show the QR missed
often. A worker that failed is the phone's defect (`reportFailure`, catcher `scanner`) and a miss to the
person — the link stays. **A sheet put away while «Ищем QR…» is a «не надо»** (review 1, adversarial А1):
the reader the unmount lets go refuses the read, which is no defect, and an answer come after the sheet
went is nobody's — nothing reported, nothing queued, no worker started again. **Its words are the link's,
never a photo's** (adversarial А2, А3): with no connection the link waits, and what the queue could not
keep is the link — the sheet that keeps no photo never says one waits or was not kept. The queue
refuses a link only with nobody signed in (`sendLink`), so that is what the sheet says, never «free some
space» (review 4). **The scanner of goods is untouched** (MOL-98): its worker and options stay retail
codes only. The review says «Строки — из налоговой Сербии», names the ПИБ, and has nothing of a photo — no
«Переснять», no «Прочитали не всё», no «Фото удалим»: «Переснять» is a photo country's (`photoCountry`).
**How the link came is the body's word** (MOL-234, В-3 «а» of MOL-233): `via` — `qr` read off the shot,
`paste` from the field — and `missed`, whether the camera missed in this sheet before; a refusal read off the
shot (a refund) is no miss, a worker that failed is one. Optional on the wire (Р-3): a body a phone of an
earlier build left in its queue has neither, and a door refused is never sent again.

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

| What                   | How long                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| A removed receipt      | ten minutes of «Вернуть», then the minute timer (П-8, as MOL-73)                                 |
| A receipt not recorded | 28 days after it arrived, whole (В-3) — by the server's clock, not the phone's                   |
| The photo              | until the receipt is recorded: recording deletes it; the timer holds the promise if it does not  |
| An item line cut out   | 28 days after the receipt is recorded, and only a line recorded as read (В-4) — or with its line |
| A recorded receipt     | while its trip is there: the trip removed for good takes it (MOL-240)                            |
| A line of it           | while its purchase is there; a line not recorded goes at «Записать» (MOL-240, В-2)               |

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

**How the person learned it was read is kept** (MOL-129, `receipts.heard`): `app` once the list or the
review handed it over read **to a phone that asked with its page in view** (`?shown=1`), `bot` once the
bot was handed it to tell — the first word stands. A read of the list writes only for a receipt read and
not yet heard of, and a read asked hidden writes nothing. The rest is `bot.md`.

**A head is what a reading found**: a receipt failed before any reading answers `header: null`, not
four nulls (review А11). What the phone reads as «read» is the `status`, never `header !== null`.

## On the phone (MOL-127)

Requirements, decisions and the measurement of the photo check: `.scratch/tasks/requirements/MOL-127.md`,
`.scratch/tasks/research/MOL-127-photo-check.md`.

- **The version «с чеком» is the country's, not a flag** (Р-1, `useReceiptCapture`): a person whose
  settings name a country `receiptCountrySchema` reads gets the camera in the strip of «Что брать» and
  «Покупки», «Записать вручную» beside it, the newcomer's (а) and (б); anyone else the version «без
  чека» of MOL-128. A receipt of a country the server does not read would be refused by the schema,
  and a button that always ends in «не принят» is worse than none. **The camera is the country's;
  the receipts held are everyone's** (MOL-109, adversarial А2, Б1, Б3): an Armenian receipt taken
  before the settings moved to Georgia or Serbia is still to be recorded or removed, so `GET
/receipts` is asked of everyone, «Покупки» say «пусто» only once it answered and its failure in the
  quiet line for everyone. Its place («Где купили?») is of the receipt's country — that country's
  cities, the one read first, no recent shop of another; a receipt not read offers a record by hand
  and no retake, in words that promise only that.
- **A photo is made ready before it is queued**: upright by its EXIF, drawn under `CANVAS_PIXELS_MAX`
  (16 Mp — iOS draws no larger canvas, and an iPhone 15 shoots 24 Mp, Р-11) (`decodePhoto`), cut out at
  «Края чека», brought to `RECEIPT_PHOTO_SIDE` (3 200, П-7) and encoded as JPEG, which carries no EXIF and
  so no place (`encodePhoto`). What the server would refuse — not a picture, under 200 px, over 8 MB — is
  «файл не открылся» in the sheet, never a queued part.
- **Every shot passes «Края чека»** (MOL-222, `ReceiptEdgesSheet`): a sheet over the capture sheet with
  the four corners the phone proposed, each moved by a finger — a loupe over it, since the finger hides
  the corner — or by the arrow keys; «Повернуть» turns the photo a quarter; «Готово» straightens the
  receipt and adds the part; «‹» gives the shot up. **The whole frame lost a quarter of the lines** on
  the bench (16 receipts: 50 lines of 132 against 64 cut by hand; on the four of 04.10, 16 against 34).
  On the kit until prompt 12 of MOL-118 has a handoff (MOL-127 В-1); the brief is the step's.
  **The whole photo is the step's to drag on** (`data-drags` on it): a pull down from the outline
  between two corners closed the sheet and took the shot with it (adversarial А3) — the sheet's own
  pull starts outside the photo. **A handle near an edge of the photo is drawn inside it** (Р-4,
  review 3) — and **a corner moves as far as the finger, never to it**: put under the finger, a touch
  meant to look cut a strip of the photo off (adversarial Б1) — and a corner the detector put past the frame is kept in it, so its trapezoid is
  straightened rather than painted white — measured, not worse (22 lines of 53 against 19 on the five
  bench frames it touches). **«Готово» answers for the photo it was pressed on**: a warp
  of a shot given up — «‹» while it ran, another shot opened — is let go and nobody's part (review 8,
  adversarial А4). **Corners that make no receipt** — under half a per cent of the photo, three on a
  line — keep «Готово» waiting and say so, never «файл не открылся» (review 9). **A side under what the
  server takes is paper added**: «Оставить так» on a receipt under 200 px gets white margins to 200,
  never the refusal of a photo (adversarial А2). **Not on WebKit end-to-end** (Т-11, the price): the
  engine keeps no `Secure` cookie on http://127.0.0.1 and «Покупки» need the API; the sheet's own
  WebKit behaviour is `sheet.spec`'s, and the step's opening from the file's `change` is held by the
  system «back» in Chromium (Р-10).
- **The corners are proposed by the measured candidate** (`edges.ts`, Т-2): «paper» — on a copy at most
  640 long, the light flattened against a wide blur so glare is as dull as the table, a pixel of colour
  never paper (a hand, a wooden table), thin bridges cut, the least rectangle around the region. Of
  34 bench frames it matched the hand's box best (mean IoU 0.87; brightness 0.78, flattened alone 0.82,
  closed edges 0.72) — brightness alone took a hand on the receipt for paper (am-04). Not found — the
  corners of the photo itself, so nothing is cut that the person did not move. The figures and the
  readings are in `.scratch/tasks/research/MOL-222.md`; a change of the detector is measured there.
- **A warp redraws every pixel, and the reader pays for it** (`warp.ts`): the bench read the same cut
  fewer lines drawn anew from four neighbours, and still fewer than as the photo's own pixels. So the
  corners go on whole pixels, a receipt standing square within 1.5 % of its side is cut as its box —
  the photo's pixels copied, nothing blended — and only a real tilt is warped, from sixteen neighbours
  (Keys' cubic). Off the page in a worker (`warpWorker.ts`); a worker that does not start — its script
  not loaded offline in development, a WebView without module workers — leaves it to the page.
- **No check of sharpness** (В-3, measured): the variance of the Laplacian put am-06 — the receipt the
  check was for — highest of all, and its width (695 px) is am-03's (719), which reads 17 of 18. A check
  that cannot tell a bad photo from a good one teaches «Оставить так». **«Чек мелкий» is the width of the
  receipt cut out**, a note of the kit (`AppNote`) said through the app's one live region (`RECEIPT_PHOTO_NARROW`, 600 px — an 80 mm roll prints 42 characters, and Tesseract
  loses a till's digits under about 14 px a character): «Подойти ближе» or «Оставить так», never a
  refusal.
- **The receipts' queue is MOL-24's** (`receiptQueue`): storage is the queue, one window sends under
  `navigator.locks`, a lost connection, a 5xx, a portal, a `401` hold it; `413`/`415` and a photo the
  phone lost are «не принят» and take the later parts of the receipt along. The receipt, its parts in
  order, removal and «Вернуть», and «Записать» are writes of the one queue, so a part never overtakes
  the receipt that names it and «Записать» never a removal. «Выйти» waits for it after the trip's and
  the spendings' (`whileReceiptsAreStill`).
- **The bytes are on a shelf of their own, in IndexedDB** (`photoShelf`): a database per owner, so
  «Выйти» and erasure take it by its name (`forgetPhotos`, from `forgetOwner` and, awaited, from «Выйти»).
  Written before the write that names them; read when the part is sent. **Kept until the receipt is
  recorded, removed or gone from the server**, not until it is sent: the server gives no photo back, and
  «не разобран» shows the parts from this phone — from another phone it says so. Each list read lets go of
  what no receipt names any more, sparing the last ten minutes.
- **«Покупки» is the queue and `GET /receipts`, one row per receipt** (`useReceipts`): the phone's state
  first — «ждёт связи», «не принят», «запишем, когда появится связь» — then the server's; recorded is a
  row of «Записаны» («· из чека»), being removed is nowhere. Asked every five seconds while one is read
  and the screen is in view (Р-4). The list says «не сходится» only: «проверьте» is counted by the server
  when a receipt is read (the memory over the parse), so it is the review's (Р-9).
- **The review's arithmetic is the model's** (В-6, `receipts/review.ts`): «Строки», the difference, its
  line and «Записать N» are `receiptBalance` over the server's `amount` or the person's edit; no sum is
  the phone's own. **The edits are a draft on the phone** (`receiptDrafts`), only what was changed, so a
  line left alone follows the server, which may still learn it from the memory; they work with no
  connection, and the receipt itself is kept for the review offline (`useReceipt`). **«Записать» sends
  the whole receipt under a trip the phone names**, through the queue: a double tap and a repeat are one
  record, and with no connection the screen goes back to «Покупки» (Р-5) — from the place's sheet too,
  once its step has landed (`afterStep`, review 34: a move made from its `onClosed` was dropped as a
  second tap, and the person stayed on a locked review). **The day of the purchases is the server's
  rule** (`isRateDay`, not after the phone's today — or the day the sheet opened with, while the server
  takes it: a receipt printed after Yerevan's midnight on a phone west of it, adversarial В1). After the answer
  `router.replace` gives way to the purchases, and «Записали N покупок» comes in the history's state —
  said once, never on a reload.
- **«Итог чека» is a button** (Р-8): OCR misses the total on half the receipts, and the trip's money is
  the receipt's total (MOL-78); the person's total goes as `total`. **It turns В-5 again**: with the
  person's total the amounts of the lines not edited are `recordedSums` over their figures and that
  total, so a printed sum the total confirms is what is recorded (review 4).
- **A figure edited is the person's figure**: «≠» of the reading goes with it, «проверьте» only
  once the item is chosen (`confirmed`), and «Сохранить» with nothing changed writes no draft — the
  line goes on following the server and the shop's memory (review 16). **The draft holds the figures
  only once they changed** (`figures`, review 28): the sum in the field is prefilled, and written with
  an item chosen it froze the line — the item and then the total recorded 890, the total and then the
  item 980, for the same taps. Left alone, the line's sum is the server's or the person's total's,
  whatever was edited around it. «Не записывать» and «Вернуть в запись» are written at once, with no
  figure checked (review 17).
- **While «Записать» waits the receipt is what was sent** (review 5, adversarial А1): no line, place,
  total or removal opens; the answer moves only the review that asked, never a screen the person went
  to meanwhile (А5). A removal of a recorded receipt (409) is done, never «не принят». **«Отменить
  запись» takes it back** (MOL-169, owner's В-5): a record the server answers 5xx again and again is
  held by MOL-24's rule, the receipt locked and the receipts behind it waiting, so the dock offers to
  take it out of the queue — the review open again, its draft whole. **A record no send has begun
  goes at once; one begun goes only on the check's own answer that the receipt is not recorded,
  asked under the lock every window sends under** (`recordBegun`, `cancelChecked`; adversarial А1–А4,
  round 2 Б1–Б2): its answer lost, it may have landed, and opened as if it had not, the review
  offered «Удалить» on a recorded receipt — whose 409 is «done», so «Чек удалён» stood over purchases
  that stayed — and edits no record would ever carry. **The check's own answer**, never the shown one:
  a read that set out before the tap and came back during the check said «not recorded» of a send
  that landed after it set out (Б2). **Under the lock**, so no send of it is on its way in this window
  or another when the server answers (Б1); a begun record is taken only through it. **And asked of
  `GET /receipts/:id/settled`** (`receiptSettled`, round 3 Г1), which reads under the owner's lock and
  the receipt's row in the order «Записать» takes them: the phone gives a send up after its 15 s, and
  the server finishes it all the same — a record still in its transaction is waited for and read as
  done. It answers the trip the receipt is recorded as, and the review goes there on that answer alone:
  a read of the receipt after it failed on the same connection and left the tap unanswered (round 4,
  Д1). Recorded, the
  screen goes to its purchases; no answer — the dock says why, «no connection» or «the server did not
  answer» by `navigator.onLine` after the failure (MOL-19, Б3), until the connection or the receipt
  changes, and nothing opens. **The receipt the server calls recorded lets go of the phone's part of
  it** (`settleRecorded`, from the list of «Покупки» and from the review): a record waiting and a
  refusal of one — a 409 after a cancel — would otherwise name it for good, with its photo and draft,
  and no row to remove them from (review 1, А2). **The price, named:** a WebView with no
  `navigator.locks` takes no lock, and another window's send may still be on its way as the check is
  answered; a record of the same receipt from another phone, or one whose body reached the server but
  whose handler has not yet taken the owner's lock — milliseconds — may land after it. Then the cancel
  opens, «Удалить» meets a recorded receipt (409, «done») and an edit is not written — the next
  «Записать» is a 409 and the review goes to the purchases of the first. A record refused
  otherwise is not touched: the next «Записать» takes its place.
- **«Не принят» is a photo's word**: only a refused announcement or part makes that row, dated by the
  moment of the refusal; a tap opens the sheet with the reason and «Убрать», never removes by itself.
  **A receipt the server holds with parts missing and this phone none of them** is «не все части
  дошли», with «Удалить», and asked about by nobody: the list is asked again only while one is read
  (adversarial А2). **Not one this phone delivered whole** (`delivered`, review 29, adversarial Б1):
  the last part leaves the queue as it lands, and the list read before still says `uploading` — for a
  moment always, for good when the next read fails at the till; the server never goes back to
  `uploading` after the last part, so such a receipt is being read until the list says where it is.
  Kept on the phone, for the read may be a restart away. A removal takes the parts still waiting out of the queue, and «Вернуть» puts them
  back (А3).
- **The line's sheet is its own** (`ReceiptLineSheet`), with the box of «За единицу» and «Тут дешевле»
  of the purchase's sheet — the same keys and `useCheaperHint`: a line writes into a draft, the
  purchase's sheet into the trip's queue, and one component for both would carry both. Its currency is
  the receipt's, never chosen.
- **The printed line is set in the system's face** (`--font-printed`): Onest has no Armenian, Georgian
  or Serbian; one line of a fixed height, so a word in another script does not move the row.
- **End-to-end reads with a fake** (`bin/fake-receipt-reader.mjs`, Р-7) — the bench's reading of am-05
  for every photo — so a receipt taken in the browser goes the whole way; the copy's own Tesseract is
  never asked by a run.
