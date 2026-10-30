---
paths:
  - 'packages/model/src/entities/{receipt,receipt-text,receipt-sum,receipt-match,receipt-link,receipt-journal,receipt-verify}.ts'
  - 'packages/model/src/contracts/receipt-miss.ts'
  - 'packages/model/src/support/md5.ts'
  - 'packages/model/src/contracts/receipt.ts'
  - 'packages/model/tests/entities/receipt*'
  - 'packages/model/tests/contracts/receipt.test.ts'
  - 'backend/src/receipts/**'
  - 'backend/src/routes/receipts.ts'
  - 'backend/src/usecases/{receipts,read-receipts,read-tax-receipts,bind-receipt-lines,record-receipt}.ts'
  - 'backend/src/purs/**'
  - 'backend/src/db/{receipts,store-memory,receipt-misses}-repository.ts'
  - 'backend/src/receipt-misses{,-cli}.ts'
  - 'backend/src/catalogue-seed-nodes.ts'
  - 'backend/tests/{receipts,receipt-review,receipt-record,receipt-links}.integration.test.ts'
  - 'services/receipt-reader/**'
  - 'frontend/src/receipts/**'
  - 'frontend/src/stores/{receiptQueue,receiptDrafts}.ts'
  - 'frontend/src/composables/{useReceipts,useReceipt,useReceiptCapture,useLineFigures}.ts'
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

**No model reads a receipt on our processor.** A model by the picture on the server's processor took
6–12 minutes and made the names up (MOL-114). **A model in the cloud reads the receipts of those it is
granted to** (MOL-272, below); for everyone else, and whenever the model is not the one to, what reads
is a chain of cheap parts:

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

**A sign read as a digit is the total's to take, the last resort, and alone** (MOL-246, H9 of MOL-228): a till
prints «=» before an amount and OCR reads the sign as a digit — «=119.00» as «2119.00». The line's sum or its
price without its first digit (`signless`, `sliced`) is offered only where no reading of the line holds with
its swaps, with every other figure as read, and only to the printed total: a line with nothing but a slice
takes the rest of the total or the slice, whichever meets it, and with no total that meets it stays as read,
unsettled (`sliced` candidates are never a line's own first reading). A slice is the total's one answer as the
blank's rest is, at its price (`ANSWER_COST`), and a receipt has one: two lines with none of their own share
no total, and a slice never buys itself with swaps of another line (review В1, В2). A slice the total took is
the total's answer as the blank's rest is: one look of the person's, never a line «as read», and a total met
through a slice is shown only where two places print it, never by the lines (review Г1; MOL-244, В-1 «а») —
else a total misread in one place vouched for itself through the slice it chose. Slices are offered to the
total only where no way without them meets it — beside a blank and another line's swaps, a wrong slice met it
cheaper by leaving that line's misread as read (review Д1) — and a reading met only by its slice has no
balance to rank by when the readings are chosen (Д2). The price of that last resort, chosen over Д1 (review
Е1): where a way without slices meets the total — even by bending a line read right with two swaps until the
blank's rest looks like what is printed — no slice is tried, and the receipt reads as on master: «=760,00»
read «2760,00» beside a cheese of 6 200,00 read right gives 1 760,00 and 5 200,00, both lines one look; with
the slice preferred, Д1 left a wrong line settled. A slice whose sum the line reads of its own spends no
answer (review 12), and at one cost and one sum the blank's rest comes first (13). So H9 reads only receipts
that print the total twice: on the bench not one line moves. The terminal's lost point, put back outside,
still counts («148032:1.0» for 480.32). Card lines and class-code lines with a count read; never the weight by
money nor the plain layout (their search is past the floor of Р15 with it, review А3), never a class row whose
count is not printed (twenty counts made up let the slice choose one, Б1). Each half was measured wrong first
(reviews, rounds 1–2): beside the swaps a price that lost a digit beat the sum's own swap — 1500.00 × 3 =
4500.00 read «=1500.00» became 500.00 × 3; with swaps of the other figures it «fixed» three figures of a line;
as a line's own reading it took the blank's place — «2119,00» read 119,00 where the total said 2 119,00 — and
made a reading that misread a line tie one that read it right. Never a count, the discount or a figure with no
decimals, never to zero; «=0.50» read «20.50» is read. The half «119.00 1» read «119.001» is not done:
`hundredthsOf` rounds the third decimal away. On the bench: not one line lost or changed, the search as on
master. Measured on no set as shipped: MOL-228's eleven Russian lines were the prototype's H9, a swap of one
price with none of these conditions, and the product's parse reads no Russian receipt. The pharmacy's «»»,
«-», «:», «Օ» are MOL-258 (owner, В-1 «а»).

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

## The model reads (MOL-272)

**Claude Haiku 5.5 reads the receipts of those it is granted to** (owner, 18.10.2026; the cap 19.10;
the decisions В-1…В-6 of 20.10 in `.scratch/tasks/requirements/MOL-272.md`). `backend/src/receipts/model-reader.ts`:
every part in one message, the answer by a schema (structured output), `effort: medium`, the prompt
`model-prompt.ts` — its version beside the model in `reader_version`, `claude-haiku-5-5@v5`.

**Who it reads for is a column and an edition** (В-4, Р-12): `actors.receipts_model_until` still to come —
a moment, as `shared_until` is, set by hand with `psql` until the paid layer (MOL-271) — and
`MODEL_CONSENT_EDITION` (5) accepted, since the photo goes to Anthropic, stored in the USA and computed in any
country it has capacity in, kept there up to 30 days (Т-9, MOL-319; edition 3 named the USA alone). Empty, past,
ending now or an older edition: Tesseract. **Without `CLAUDE_API_KEY` nobody is read by it.** A person's
key (`sk-ant-usr-…`) is refused by the API without its workspace, so `CLAUDE_WORKSPACE_ID` names it.

**The model copies, our code decides** (MOL-268, «Дальше»): every number of a line in its place — the
quantity and unit, the shelf price, the line's discount, what was paid — and every amount of the summary
with its word. `receiptTextOfModel` makes the parse's `ReceiptText` of it: a figure is a decimal string of
its kind or none, never a float; a line is as printed where its own arithmetic holds — to the till's
rounding only where that line itself prints a discount, a zero one too («Ереван Сити» rounds what was paid
off its shelf price, «250 / 0 / 249,99»), never by another line's word: a «0» under the bread gave the
milk's 3 × 130 its 389,97 (adversarial А4); the layout is the card's where any line prints a discount, the
class code's otherwise; **the total is the card's words, by MOL-244's rule** — the lines that met
a printed total every one as read, else one amount two places print — and a prepayment is no payment.
**No line is a sum to record only where a section is printed or two places vouch for the total**; with
neither it is «переснимите». Then **the one check, `verifiedReading(text, { byModel: true })`**, and
everything after it is Tesseract's path: `readPartly`, the lines' items, the wire. No line is cut out for
training (Р-4): there are no boxes.

**A figure is read in every spelling the model writes it** (MOL-294): thousands grouped by a space, a no-break or a
narrow one («1 000,00»), a comma for the point where it is the only one and no point stands («0,50»), and a minus
before a line's or the summary's discount — its size. A minus before a quantity, a price, a sum or a total is no
figure: a negative total is a refund, never a purchase. The answer is put in that one form at the door of
`receiptTextOfModel`, so the repair of the font's swaps and the total read what the lines read. **Why**: production's
36f99484 came with 39 lines, the total, and not one figure in a line, «Прочитали не всё» silent — exactly what every
line's discount written «-0.50» gives: no line holds its arithmetic, the check empties all of them, and the sums as read
still meet the total. The answer is not kept (Т-8), so the spelling is not proven; on the bench no line's figure ever
came signed. **So the log of a reading counts what was not read** (`unparsed`, a number, never the figures): the next
such receipt shows in the log, not by a guess.

**`byModel` widens one rule, and only for the model**: a line of one piece with no discount whose price is
within the card's rounding of its sum is «one number printed twice» — kept only on a receipt proven whole.
The model names the columns itself, and «389,99 390» holds either way round (lit-9295 of the bench);
Tesseract takes the columns off the paper, so its «419,98 / 420» stays read (MOL-255, Т-4) — the Tesseract
bench is 105 / 0 as before.

**The bench** (`.scratch/tasks/research/MOL-272.md`, 54 receipts, 1 038 fields, through the product's own
converter and check): v3 at medium 576–626 right, 1–3 made up, totals 26 right and none wrong; v4 573 / 3,
totals 28 / 0; v5 646–656 / 1–2, totals 26–27 / 0; Tesseract 105 / 0; Haiku by Claude Code's helpers (MOL-268)
225 / 9. $0,0022–0,0025 a receipt, 13–17 s at the median, 45–55 s the worst. **The price, named** (В-7, the
owner's to decide on the pull request): the 1–3 made up are all of one faded «Ереван Сити», am-34, where 5 and
6 are one glyph — a leading digit misread alike
in a price and a sum (640 / 5,4 / 634,6 as 540 / 5,4 / 534,6) holds the line's arithmetic, and a second
reading repeated it. Closing it to none costs two thirds of what is read: the model's figures only on a
receipt proven whole gave 171–195. The receipt is not proven whole, so its review says «Прочитали не всё».
`low` effort copied a sum into the price on a receipt proven whole — three prices the check lets through by
MOL-255's rule — so it is `medium`.

**What it costs is counted, and the cap cannot be passed** (Т-3, Т-4, В-2 «а»): `model_spend`, by the calendar
month in UTC — Anthropic's bill's — in integer micro-dollars, at the price written in the code
(`RECEIPT_MODEL_PRICE`), from each answer's `usage`, an answer we did not take too. **Before a call its worst
is reserved in one statement**: the input at most — an image's pixels over 750, the prompt's bytes and the
schema sent with it — and the whole output it may take; a month that would pass
`RECEIPT_MODEL_MONTHLY_CAP_USD` ($200) refuses it, and Tesseract reads. After the answer its own price is put
in place of the worst; **a process lost in between leaves the worst counted**, never less than was spent. **So
the client never repeats a request** (`maxRetries: 0`, adversarial А2): a request repeated inside it is two
paid and one counted, and the time out doubled held the queue; the queue asks again itself, each call with a
reserve of its own. **And an answer whose price is not known keeps the worst**: a time out, a connection lost
— it may have broken after the request went — an answer torn under its body or of no body at all. A request
past `RECEIPT_MODEL_INPUT_MAX` tokens is priced otherwise and is never sent, nor one past what the API takes —
a part over 5 MB or a request over 32 MB in base64 (`MODEL_IMAGE_BYTES_MAX`, review №3): `size`, Tesseract, no
failure.

The owner hears of half the cap, nine tenths and **the stop — the first call that does not fit** — each once a
month (`model_spend` notices, the bot's dollars to the cent). **The stop is that call's, not the month's**
(В-2 «а», adversarial А1): the model reads up to the last call that still fits, so a smaller receipt after it
may go, and the bot says so rather than «until the month ends». The workspace's monthly limit in the Anthropic
console is set to the same (Р-10): a price wrong in the code is held there too. **Nobody's**: no key to
`actors`, so neither erasure nor the copy reaches it.

**When the model is not the one to read, Tesseract reads, as before** (В-1 «а»): the cap, photos past the
price, a refusal of the model, an answer cut by its length or of no schema — each paid — a request the API
refuses for what it is (4xx, `ModelRejected`, paid nothing, a failure the owner hears of as
`job:receipt-model`), and anything else the queue's call throws — a fault of ours, heard of as
`receipt-reading`, the worst kept (review №4); never «не разобран» on a receipt Tesseract would read.

**The model away is waited for ten minutes** (Р-9, `RECEIPT_MODEL_WAIT_MS`): a 429, a 5xx, an overload, no
connection, a time out or an answer torn on its way (adversarial А3) leave the receipt queued with its attempt
uncounted and stop the round; past ten minutes since it was queued, Tesseract. **The time out is the whole
call's**, its body too: the client arms its own around `fetch` alone, and a body that stalled held the queue
past it. **A torn answer is also a failure the owner hears of** (`model_broken`, `job:receipt-model`, review
№8): what the client throws while the answer comes cannot be told from a fault of ours — a broken client would
make every receipt wait — and the fingerprint's first time in a build and its 10, 100, 1000 keep a chance tear
quiet. **The price, named**: an answer not taken whose Tesseract is away is asked of the model again the next
minute, and paid again, until the reader is back.

**The key against a second record is Tesseract's, read by its words** (Т-11, adversarial А5, А6, review №10):
the model copies every row that prints a number after its label, as printed (`id_rows`, prompt v5), and our
code takes the tax number after «ՀՎՀՀ» and the fiscal number, eight digits after «Ֆիսկալ», each only where the
rows give one — two fiscal numbers, a prepayment slip or two receipts on a photo, are none. Asked for the
fields themselves (v4), the model put «Ереван Сити»'s till registration «ԳՀ» in the tax number on 26 answers
of 94 and the shop's tax number in the fiscal one — two constants of the till, the key of every receipt there,
and the next one «recorded before»: copying, it moves a label too, mostly onto another label («ԳՀ:01282006»,
«ՀԴՄ:01282006»), and then there is no key. **Never «ԿՀ»**, a till's own count the shop's other tills repeat;
**never a number the rows print under another label too** (adversarial А6, round 4) — the shop's tax number,
the till's «ԳՀ» moved under «Ֆիսկալ»: a constant of the till, every receipt after the first «recorded
before»; no barcode, no «ՖՀ». The tax number keeps no such guard — it is a constant anyway, and the bench's
one number under two labels was the tax number under «ՀՎՀՀ» and «ՀԴՄ» both, right. **Two fiscal numbers are the key as a pair** (MOL-293, owner's В-3 «а»): «Ереван Сити» prints a prepayment slip of
the card's cashback over the receipt, with a fiscal number of its own, so every receipt of the owner's shop with the
card was keyless and could be recorded twice. The pair, in ascending order («34408642+58899619»), does not care which
the model copied first; each number is still held to its own label (А6), and three are none. On the bench (v5) two
readings by the model gave one key on 24 receipts against 21. **The price, named:** a reading that caught one of the
two is another key than one that caught both (am-13) — as one paper read twice may be two keys anyway. Anything else
is no key, and the receipt is held by its id alone. **The tax number stays the model's to copy, and v6 was measured
and not taken** (MOL-293): asked never to leave «ՀՎՀՀ» out and to copy every label letter by letter — the model had
written «ՀԿՀ:01282006» and «ՀԴՄ:01282006» for it on am-44 — three runs against three of v5 on the same photos gave
the tax number right 41, 34, 33 of 46 against 29, 30, 33, and the lines' fields 777, 803, 770 right, 3, 7, 1 made up
against 801, 833, 827 and 0, 4, 1: every run of it below the worst of v5. A line misread is worse than a tax number
missing, so v5 stays; the shop's memory of a model's receipt with no tax number is the price. **The rows have no ceiling**: they give only the key, and a bank slip
under the receipt, a row too many, threw the paid reading away (adversarial А7); the output's cap bounds them.
On the bench (v5, two runs): the tax number 32 right, 3 wrong, 11 none — against 40 wrong of 94 in v4; two
readings by the model give one key on 21 receipts and two on none (v4: 23 and 11); the model and Tesseract one
on 7, two on 1, a digit of Tesseract's; no fiscal number is a constant of a till, and the guard of round 4
takes no key away. **The prices, named**: one paper read twice may still be two keys, and so two records — as
it may by Tesseract; of 46 papers only one of the two readers keys 24; and a constant key is left where the
model puts a constant of the till under «Ֆիսկալ», copies neither its own row nor the receipt's fiscal one, on
two receipts of that till. Each part is seen apart: it moved the till's number under another label
in 6 answers of 108 — «ՀՎՀՀ» five times, «ՖՍ» once — and lost the fiscal number's label in 3; together, never.

**The log carries counts** (Т-8): who read (`reader`), what it cost and the tokens in and out, why the model
was passed and what an answer not taken cost (review №6), how many of its figures no rule read (`unparsed`,
MOL-294) — never its answer, a line or a tax number. **The
measure of 0.2 is the reader's** (В-6 «а»): a receipt the model read counts in `model_receipt_days` — read and
recorded alike, by its `reader_version` — a table of its own for MOL-234's reason, and `make gates` prints its
block under Tesseract's, with the same stop. A receipt that failed for its attempts has no reader and counts
in `receipt_days`.

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

**The languages are the country's** — its card's (below). Armenia `hye+rus+eng`; Georgia has its language
files in the reader, and joins with its card (MOL-248); Serbia is read by its link, not by the reader (MOL-232).
Every alphabet at once is slower and mixes the scripts.

## A country's card (MOL-247)

**Everything the product knows of a country's receipts is one record, its card** (`receipt-card.ts`,
`RECEIPT_CARDS`): the currency, the language of its names in the catalogue and, for a country read off a photo,
Tesseract's languages, the formats of its numbers, the digits OCR confuses in its tills' font, the letters read
for digits, and the words. MOL-229 measured why (`.scratch/tasks/research/MOL-229.md`, Г-5): the line of an item
is the same the world over, and where a receipt ends and which figure is its total are the country's words —
without them no total is found and the taxes and the payment under it are read as items, while a card of one
country reads no worse than every language's words at once. A second country is a second record, not edits
across the parse.

**The parse reads the card, never words of its own.** `bestReading`, `mergeParts`, `parseReceiptText`,
`departmentReceipt` and `classListStart` take the card first; every pattern with a word in it is built from the
card's words once a card (`lexiconOf`), and the swaps ride in the `Budget` every search already carries and in
the seams of parts. A test with a **probe card** — Armenia's with its total's word, its payment or its swaps
changed — holds that the parse follows the card: a word left as a literal in the parse fails it. The move was
measured on the bench's whole answer, byte for byte (`.scratch/tasks/status/MOL-247/dump.mts`: the 45 receipts
of MOL-114, `bestReading`, each page mode and the section) — 96 of 228 and the section 10/10, as before.

**A word is a fragment of a regular expression, as OCR reads it** — «դամե» is what every misreading of
«Ընդամենը» keeps, `հ\S?տ` a piece however OCR read its middle — and a form only one layout reads stays apart
(`tinMisread`, the table's): folding the forms of all layouts into one is a change of behaviour, measured on its
own. **Every word goes in a group of its own** (adversarial А1 of review 1): set bare, a second form after «|»
took the rest of the pattern — «Ընդամենը|Ընդամեն\s+(\d…)» found the word with no sum, and the total, the tax
number and the number were lost in silence. **A word captures nothing**: the parse reads the figures after it by
their groups, and «(Ընդամենը)» made the total NaN — `lexiconOf` refuses such a card, as the card's test does.
**The kilogram is one fragment wherever a line is weighed** (А2): it was a fragment in four patterns, a string in
two comparisons and letter by letter in the table's, so «կ[գq]» weighed nothing. The table's brackets read it in
either case by the flag `i`. **The letters read for digits are characters of a class, escaped** (А4); `letters`
alone are a class's ranges as the card writes them, built by the card's test through the parse. **Every pattern a
word goes into is read with the flag `u`**, as the word is checked (round 2, Б1): thirteen of them had none, and
there «\p{L}» was the letters «p{L}» — a word the checks admitted lost the total, the tax number and the number in
the card's, the table's and the class code's layouts while the section's read it. A test reads such a word in each
pattern with a word, the ends of the lists and the table's head included (round 3, В1).

**The tills' layouts stay the parse's** — «Ереван Сити»'s card, Dog City's table, the terminal, the class
code's mark «Դաս» and its article «Ն/Կ», the section «Բաժին», the head's end and city (`receiptCityOf`, which
reads Armenia's card by name, `ARMENIAN_RECEIPTS`): they are forms of rows, not a country's words. **Where a
receipt comes from is not on the card** (`receiptSourceOf` reads the schemas, `photoReceiptCountrySchema`): a
`source` beside them would say it twice, and the card's test holds that `photo` is there exactly for a country
read by photo.

**A card names only what the parse reads** (owner, В-1 «а»): MOL-229's template also has the words of change,
subtotal and not-an-item, the codes and the QR, which no rule of Armenia reads; they come with their first
reader (MOL-248). A field nobody reads is a word nobody checks. **The formats of numbers are a list** — Georgia's
pharmacies print three decimals beside its shops' two — **and a card may name only a format the parse reads**
(`PARSED_FRACTION_DIGITS`): the parse counts in hundredths throughout, so it **refuses** a card with no format
or with one it does not read (`RangeError` in `lexiconOf`, adversarial А3) — a card of three decimals read as
two would be every sum wrong, and only a refusal makes the field more than a declaration.

**A card read off no photo doubts no digit** (MOL-270, owner's В-1 «а», 28.10.2026): `priceInDoubt` asks the
receipt's card (`receiptCard`), and one with no `photo` — Serbia's, from the tax office — is `false`, the server's
`rememberedPrice` and the line's sheet alike. Nobody read its figures, so a price one «confused» digit off the
memory's is a price changed: the card kept the Armenian swaps for it (MOL-247, self-review № 3), and «В прошлый раз
здесь было 94,99 — проверьте цифры» over a sugar the tax office gave at 91,99 asked the person to put the old price
back. The card decides, not the country: a country read by photo comes with its own swaps. A line with no price
still shows the memory (MOL-291), which asks no doubt. **The price, named:** a price of such a receipt changed by
one such digit is told nowhere, as any other change of a price is not.

**A receipt is doubted by its reader's confusions** (MOL-315, owner's В-1 «а», 30.10.2026): `priceInDoubt(…, { byModel })`
takes the card's `modelSwaps` for a receipt the model read — 5↔6 alone, measured (MOL-290) — and `swaps` with no
reader named; the server names it by the receipt's `reader_version` (`found.byModel`). The model's 1 100 → 1 400, 990 →
999, 330 → 380 are prices changed, which «проверьте цифры» asked the person to put back; MOL-291's doubt at reading
went by 5↔6 already. A model's receipt Tesseract read in its place, and one read before MOL-255, are Tesseract's.
**The phone knows no reader** and doubts by `swaps`: the server only narrows, so a hint it sent stands while the model's
pairs are among Tesseract's — the card's test holds that. **The price, named** (В-2 «а»): a price the person typed on
the sheet of a model's receipt is doubted by Tesseract's pairs — 4 550 typed against a remembered 1 550 keeps the hint.

## What a line is (MOL-126)

**A line finds its item in five steps, the first that answers deciding** (MOL-114's order, approved
30.09.2026): the shop's memory by the till's article («0401/**1163909**»); the shop's memory by the
line as printed; the catalogue's names in the till's language, the customs heading printed on the line
ruling out what the line cannot be (`createLineMatcher`); the catalogue search by the line's gloss;
nothing — a new item named by the gloss. The answer's `match` is the handoff's four: `memory`,
`search`, `weak` («проверьте») and `new`. The memory and a sure search are not told apart — the
person's one action is to check and correct — and `weak` is a search found far (`near = false`, MOL-124
В-4) or an item chosen by the heading alone.

**An item stands on a line only by the line's kind and brand** (MOL-293, owner's В-1 «а», 21.10.2026). The first
receipt the model read on production (b8a76f31, «Ереван Сити», 39 lines) bound 7 lines to another thing altogether
and 4 to another brand or sort — a strawberry yoghurt «Клубника», a pizza base «Пицца», crab chips «Креветки», a
Fanta «Лимонад» — all of them sure, and «Записать» recorded them: «в 10 раз хуже, чем если бы они не распознались».
Both the names and the search took an item when **any** word of its name stood in the line, so a word of a flavour
or a filling found the fruit. The line's **kind** is its head word before the brand, past adjectives, participles and
the genitive (`receiptLineParts`; «խորոված», a shashlik, is a noun of an adjective's ending; «հող», soil, too short for
a participle) — the genitive of a noun in «-ի» too, in «-ու» («ազնվամորու մուրաբա» is raspberry jam, never raspberries),
and the few in «-ան» the dictionary holds («ձկան»), behind any other word, since a nominative ends so too («կատու»,
«չորաթթու»; review 2, №2). A capital past the first word on a line of small letters is a name — a sort or a brand
printed bare — and the kind only where nothing else is: «Լեզու տավարի Արցախ» is a tongue (adversarial Г3). A capital
says so only with small letters after it, on a line the till printed a small first letter in, a unit's included:
«Բանան Սաբրոսթար կգ» is a sort, while in «Ազնվամորու Մուրաբա», every word a capital, it says nothing (review 5, №1);
the kind's choice counts no unit, «Ազնվամորու Մուրաբա կգ» is jam (review 6, №1). Then:

- **A name of the seed in the till's language stands only where it says the kind** (`seedNameFits`), the seed's own
  word against the printed one — «Ատամի պաստա» is «Паста зубная» by the seed's name, which the dictionary's Russian
  need not cover — and never on a branded line: the seed names no brand. Judged by the Russian name instead, the
  first round turned 333 of the seed's 2 000 till names away from their own items and 163 onto others' (adversarial
  А1, А2); now all 2 000 bind as master bound them. The words are the same, one inflected past the other («կոնֆետներ»,
  «հրուշակեղեն»), or — a printed word the dictionary has not, from four letters — the seed's with **one letter lost**,
  as Tesseract and the model lose one: «Կոլասա» is «կոլբասա». Exact alone, the first fix of round 1 left 228 of the
  seed's 1 523 names with a letter dropped on their own items, master 1 296; now 1 386, and not one master put on its
  own is on another (adversarial Б4). **Never a common start** — «Տուշ», mascara, was «Тушёнка», «Թել», a thread,
  «Вермишель», «Դեղ», a medicine, «Персики» (Б3) — **nor a letter misread**: «Ռոլիկ», a roller, is no «լոլիկ».
- **Two things side by side, neither in a case, do not say which is the kind** (adversarial Б1): a till prints the
  kind first («Պանիր չեդդեր»), Armenian the head last («Ելակ յոգուրտ», a strawberry yoghurt), so an item — and a
  seed's name — stands only where it says both. A quality the dictionary glosses as one («միջին», средний) is no
  thing; a gloss with a thing in it is one, «պաստեղ» — «пастила фруктовая» (В2). **A word the dictionary has not is a
  thing too** — a dessert or a drink of loans, «Ելակ սմուզի», «Խնձոր շտրուդել», «Ելակ Smoothie» (В1) — said by its
  letters («Смузи»), and «-ի», «-ու» are a case only of a word the dictionary has, since a loan ends so; a name only
  where an Armenian capital says so on a line of small letters, «Բանան Սաբրոսթար», a sort; a standard or a size in
  Latin is no thing, «Կաթ UHT 3.2%», «Մարտկոց AA», «Լամպ LED» (Г2) — by a list, since a brand has the same form:
  «Շոկոլադ MARS» is a thing (review 5, №2), and a standard the list has not, too (BIO, MIX and their like are in it,
  Е2); «ICE», «ZERO» change the thing — a cold tea, a beer with no alcohol — and are none (review 7). «և» spelt as of old, «եւ» («Երեւան»), is «և» for the dictionary, the gloss, the seed's names and the letters of
  a name (Д1, Е3). Of 527 lines «flavour kind»
  made of the seed's words, the first round bound 459 to the fruit, sure; now none.
- **Any other item stands where `lineFitter` lets it** — a heading's far match, each of the search's first ten:
  **every word of its name is the line's**, by a **form** of the dictionary's Russian — an adjective in any gender,
  number and case, a noun in any number and case, the adjective a noun makes («оливки» — «оливковый», «молоко» —
  «молочный») — or by its **letters** where the line spells it, the search key's one edit from five letters at most
  («Pringles», «Принглс»); never a common start, which found «Пастила» for a toothpaste, «Печенье» for a liver and
  «Лимонад» for a lemon (А1, А3, review №2). **Every figure with its unit**: a fat is never a litre (А5). **The line's
  brand in «…» is in its name**, by the letters across scripts («Կոկա Կոլա» is «Coca-Cola»); an item of the seed is a
  kind and takes no branded line («Бекон» for a sausage of «Բեկոն»). **Its name says the line's kind**, unless all of
  it is that brand (В-2 «а»: the owner's «Coca-Cola»). A kind the dictionary has not takes nothing but its brand. **A
  word of the dictionary is read exactly**, never one edit off: «լոշիկ», a flatbread, was «լոլիկ», a tomato.

**An item the printed heading rules out is no item now**, where MOL-255 made it «проверьте»: the new item beside
it is «проверьте» too, and a wrong item offered is worse than a name to check (Tesseract's «(3824) ՏՈՖՈՒ ՀՈՂ», a
cat's litter, found «Тофу»). **The shop's memory is above all of it**: the person's own word, unchanged.

**Anything else is a new item, named in full and «проверьте»** (`match: weak` with no item, В-1 «а», on the wire too —
the review sends `new` only for a line whose item is gone since, adversarial А6): `newLineName` — the kind first, as a
shelf names it, the other words before the brand in order, the brand as its package spells it (MOL-261, below),
the words after it, the fat and the package — «Йогурт «Еремян Продактс» клубника 2% 130 г» (В-1 «б»: the weight is in
the name, so a package is an item). A word the dictionary has not is spelt in letters, and the line says so
(`receipt_lines.spelled`, 0069, В-4 «а» with the owner's note): the review offers the name, and «Убрать имя — оставить
как в чеке» takes it away in one press — while the proposal stands, never over a name of the person's own. A name
typed over the proposal answers «проверьте». Units, counts, a lone sign («x 24»), packaging marks and an abbreviation
the dictionary has not are no words of it; a word in capitals of up to four letters on a line of small ones keeps
them («АА», «ГОСТ»), and a lone Latin letter is a size («M»; review 2, №3); with no word left there is no name at all, never the gloss (А7). On a
receipt read out in English there is no Russian name, as there is no gloss. «Записать» puts a new name that is an
item's already on that item (`createUnlessNamed`).

**The bench** (`.scratch/tasks/status/MOL-293/`, `research/MOL-293.md`): MOL-114's 321 lines of 34 receipts, through
the product's own `bindReceiptLines` on the seed and the owner's items of am-34…43, each pair «line → item» judged.
Master: 47 right, 203 «general» (the kind with no brand or sort), **42 wrong**, 29 new. Now: **136 right, 0 wrong**,
4 general, 181 new with meaning (124 / 0 / 4 / 193 by letters alone) — every new one «проверьте». **The dictionary grew
by the words of these very lines**, so the honest figure is lower: with master's dictionary 93 right, 0 wrong — the
first receipts of the owner's the bench never saw will tell. **The seed's own 2 000 till names**, as lines: 1 972 to
their own item, 28 to another — as on master; by the search alone, the names path off, 1 045 own, 88 another (a kind
for a sort: «Молоко» for «Կաթ 3,2%», «Рыба» for a hake), 867 new. **The prices, named:** a line whose brand nobody
named is new however near the seed's item stands, so the first receipt of a shop is mostly «проверьте» until the
person's words fill the shop's memory, which needs the tax number (below); a word the item names that the line does
not print keeps it away from the search — «Огурцы маринованные» for «Վարունգ ընտիր»; two things side by side lose
the kind of the order a till prints — «Йогурт» for «Յոգուրտ ելակ», 407 of those 527 lines in the first round, 55 now
(«Хлеб» for «Հաց Պումպերնիկել» on the bench), a new item instead, and so do a word after the kind the dictionary has
not — with master's dictionary «Помидоры» for «Լոլիկ ջերմոցի», «Салфетки влажные» for «… անտիբակտերիալ», 96 → 93
right on the bench — and a Latin brand printed bare after it («Պահպանակ Durex»); a loan kind with a capital on a line of small letters is a sort, so its flavour
stands — «Ելակ Չիզքեյք կգ» is «Клубника», as on master, as «Բանան Սաբրոսթար կգ» is a banana: the two are one shape,
and on the bench every capital past the kind is a sort or a brand (12 of 12; adversarial Г1, Е1); a kind cut by the till or the reader
past one letter finds nothing, and its new name is the cut spelt in letters — «Թխվածքաբլ» is «Тхвацкабл», for one
press to take away (review 3, №1); a genitive before the kind is asked of no seed's name
— «Թեյի տոպրակ», a tea bag, is «Пакеты фасовочные», sure (review 2, №4); a diminutive is another word — «16 Թև» is
no «Крылья куриные» (`թևիկներ`), as «թել» is no «թելիկ»; a brand two letters off is another — unless the lexicon of
MOL-261 spells it, as it does «Կինդեր» Kinder, which now finds the owner's «Бисквит Kinder Délice»; a Russian word of a
form these rules do not make («крылья» for «крылышко») is another word. **And the measure of 0.2
moves with it** (review №6): a new line the person binds to an item of the catalogue is an item put right, so the
share of «0.2r» may rise by the caution of this rule, not by the reading.

**The names and the search are found once, in the queue; the memory on every reading** (Р-1). A search
with its meaning costs tens of milliseconds a line, nothing in the background and a second on every
opening of a receipt; the memory changes with every receipt recorded, and the second receipt of a shop
must know what the first taught without anything read again. Hence no `revision` on the wire: the
record carries the whole receipt as the phone holds it (Р-4), and nothing the server suggested since is
written in silently.

**The matcher is MOL-114's `dict-match.mjs`, ported without improvements** (Р-7) — until MOL-293 put the kind and
brand before it: on the bench's 152
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

## A new item's name as a shelf writes it (MOL-261)

**The name MOL-293 proposes is put in the words a shelf uses** (owner, 08.10.2026 on 122b8e5f: «йогурт ананасовый
записался просто как „ананас“… супер длинные названия на армянском, без перевода»; MOL-293 closed the binding and the
Armenian, this the name). Word by word the dictionary gave «Напиток газированный «Кока Кола»», «Соль мелкий», «Яйцо»,
«Сок помидор», «Кондитерские изделия французский». The rules, each a part of `NameLexicon` the backend passes
(`namingLexicon`), so a test without one names as MOL-293 did:

- **A brand as its package spells it** (`TILL_BRANDS`, owner's В-2 «а»): a Latin one bare — «Печенье Roshen Lovita
  клубника 135 г», «Coca-Cola» — a Cyrillic one in «…» («Алёнка», «Белая шляпка»), a product line of one or two words
  likewise («Արտ Բեյքրի» Art Bakery) — the till's «…» or not, a word of the lexicon is written so: «Շոկոլադ Ալյոնկա» is
  «Шоколад «Алёнка»» (adversarial А5); a brand the lexicon has not in Russian letters in «…», as before, a Russian brand's
  «-ոյե» as «-ое» («Алексеевское»). **A line may name an item by either spelling** (`lineFitter`): «Կինդեր» is Kinder.
- **The kind is the seed's** (Т-2, `seedKindOf`, `asSeedSays`): the seed's item whose name in the till's language says the
  line's kind (by `seedNameFits`'s rule, on a branded line too) names it — «Желудки куриные «Аштарак»» — only where its
  head word is the kind's gloss or the same noun in another number, or the dictionary has none: else the seed reads the
  line its own way, «Лимонад» for «газированный напиток», «Пломбир» for an ice cream. The seed's word of a kind is the one
  `kindKey` reads, past an adjective in front — «Лавровый лист» is a «лист», never the «Листы» of «Листы для лазаньи»
  (adversarial Б4). **It names nothing the line does not
  say** (adversarial А2): its whole name only where every word of it is the line's — by a form of a gloss, or of the
  adjective of a word's genitive («լոլիկ», «томатный» of «լոլիկի»); the seed lumps, «Соус острый» knows «սոուս չիլի», and a
  sweet chili stays «Соус «Чим Чим» сладкий чили». **And it stands for no word it does not say** (adversarial В1): a word
  its till name covered goes only where its Russian name says it — «Желудки куриные» says «հավի» by its genitive's
  adjective — and the rest stay, since the seed lumps the other way too: «ծամոն անշաքար» is its «Жевательная резинка»,
  and the line keeps «без сахара»; «Кофе» for «սուրճ աղացած» leaves «молотый». A kind the dictionary has not takes the
  seed's head only where its till name covered the kind alone: «Այս» of «այս թի» is no «Чай» (adversarial В3), and the
  line is spelt as before. Else the gloss gets **the seed's number of
  the same noun** — «Яйца», «Шампиньоны» — **so `kindKey` of the new item is the seed's** and «Тут дешевле» reads them as
  one kind: the «связь вида» of the task, with no column. **The same noun, never an adjective of it nor a noun for an
  adjective** (adversarial А1): `formsOf` holds «сахар» and «Сахарная», «макаронные» and «Макароны», and the kind became
  «Сахарная «Гюмри»», «Макароны изделия» — `sameNoun` takes a number and a case only, and the seed's very form stays
  («Сахар» beside «Сахарная пудра»). **The prices, named:** a seed's name that says a word another way is not taken —
  «Рис круглый» for the seed's «Рис круглозёрный», «Палочки ушные» for «Палочки ватные».
- **Russian grammar** (Т-3, `agreeing`): an adjective of the dictionary, given in the masculine, takes the gender or number of
  the next noun of the dictionary the line printed after it — «тёмная вишня», «ягодный крем» — else of the head:
  «Соль мелкая», «Желудки … свежие», «Сливки … ультрапастеризованные». The gender is the ending's, a soft sign's and an
  indeclinable's by a list, «яйца», «семена» plural; **a noun of the seed by the seed's own adjective** (adversarial Г1):
  the seed gives a kind its number, «Окорочка», «Рёбра», «Полотенца», and its «куриные», «бумажные» say it, where the
  ending «-а» reads a feminine — an adjective next to the head and of it alone, last after it or first before it, never
  «высший» of «Мука высший сорт»; **a plural only by an ending no singular has** (adversarial А3) —
  «-ы», «-ья», «-и» after «к», «г», «х» or a hushing letter, «Хлопья шоколадные», «Сливки»; any other «-и» is a loan as
  often, «сулугуни», «салями», and one no ending tells leaves the word as the dictionary has it — «Сулугуни … копчёный».
  **A possessive keeps its soft sign** (self-review Р1-1): «говяжья», «коровье», «телячьи» — a list, since «телячий» ends
  as «горячий»; so is a noun of an adjective's ending, «цикорий», and **a test of the backend holds every word in «-ий» of
  the dictionaries to one of them or to the ordinary**, a new word red until it is read. A word spelt in letters is no
  noun: a brand printed bare or a thing nobody knows, «Салфетки … антибактериальные Смайл». **The prices, named:** a noun
  in apposition takes it, «Колбаса сырокопчёное чоризо»; a flavour after the adjective too, «Йогурт … обезжиренная
  клубника», and before a preposition the head, «Семена … морские с солью» (adversarial А4) — Armenian prints no case to
  tell them; «Пельмени», «Вафли» keep the dictionary's masculine; a loan in «-ки», «-чи» the list of the indeclinable has
  not reads as a plural — «виски», «кимчи» are in it (adversarial Б3).
- **A genitive as its adjective** (Т-4, `TILL_GENITIVES_RU`): «լոլիկի» «томатный», «հավի» «куриный» — keyed by the
  genitive itself, never its ending: «ազնվամորի», «կիվի», «չիլի» end so as a flavour named in the nominative, and stay
  «малина». A genitive the table has not stays the gloss's noun, as before. The gloss itself stays the noun the search
  asks.
- **A phrase of the till** (Т-5, `TILL_PHRASES_RU`): two or three words a shelf names as one — «Ֆրանսիական հրուշակեղեն»
  «пирожные французские», «Շոկոլադե սալիկ» «шоколад» — read in the line's order before the kind is put first; a phrase
  that holds the kind is the kind, before the seed's, **in the seed's number of it** (self-review Р1-2): a test holds the
  head of every phrase to the seed's, «Пирожные».

**Each table is filled from the bench's lines and the owner's items, and grows by commits** — never in code. **The bench**
(`.scratch/tasks/status/MOL-261/`, `research/MOL-261.md`): the 321 lines of MOL-114's truth through `newLineName` with the
seed's nodes, against `meaning` and the owner's `item` — words of the name exactly as the truth writes them 595 → 783 of
some 1 070, names whole 87 → 158, the brand as the truth 138 → 205 of 226, a word the truth has in no form 266 → 137,
spelt in letters 67 → 48, Armenian 0 as before. **The honest figure**, the tables only where the odd receipts print them,
measured on the even (122 lines): words 234 → 275 (all tables 293), names 34 → 51 (59), the brand 57 → 69 (84) — most of
the gain is the rules, not the tables. The binding bench of MOL-293 with the brands: right 124 → 133, wrong 0. **The
bench has none of the review's lines** — sugar, pasta and olive oil of a brand, a sweet chili, a suluguni — so each is a
test of the domain, and the reviewer's attacks are red (`.scratch/tasks/selftests/MOL-261-adversarial*`).

**What was recorded before is named once, by hand** (owner's В-3 «а»): `make rename-items` (`dist/rename-receipt-items.js`
in production), a dry run unless `YES=1`, every item «было → станет». It renames an item only where that very record made
it, by that person — its `created_at` the record's `recorded_at`, as `make repack` tells — still under the name the line
proposed then, and not merged since: one the person named themselves stays theirs. A name another item holds already is
listed and left — the two would be one item, the night's to decide. **What guards the names people took is the owner's
reading of the dry run** (В-3 «а»), and the rules of the name with their tests: the command carries whatever they say, so
a rule broken one day — «Сахарная «Гюмри»» of adversarial А1 — would be offered for every such item. **A guard by the
words was tried and dropped** (adversarial А6, round 2 Б1, Б2): «every word of the old name in the new, in some form or
script» kept a quarter of the bench's renames, the very ones the task is for — a genitive «курица» for «куриные», a
phrase, «Мак Кофе» for MacCoffee, «Киндер» for Kinder — and let a form gone wrong through, «шотландский» to «шотландские»:
it tells a word replaced from a word in another form, never better from worse. The key goes with the name, and the
vector goes, for the API's writer to make again. A second run finds nothing.

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
correction (В-1): a price one digit its reader confuses off the remembered (MOL-315, below) is `rememberedPrice` on the line, «
проверьте», and the parse's figures stay as read — unless the total proving the receipt points at the price, its only
line's at its sum (MOL-314, below) — and, since MOL-291,
on a line the check emptied too. **The price
goes into the digits since MOL-291** (below): as a voice beside the line's arithmetic and the total, measured on the
bench, by its own rule of whose price — not the hint's. **The price is someone's figure** (review 5, В6; round 2, Р2-В3): the
person's own always; other people's only as their figures are — with access (`shared_until`) and from
three prices (`AGGREGATE_MIN_CONTRIBUTIONS`), their lower median, as the prices of places open
(MOL-166) — in the receipt's currency only: prices of two currencies are never one median (review 15). Three people for an item are not three prices: a word recorded with corrected figures
carries none. That is the rule of the price **shown**; the digits take other people's from three prices with no access
(MOL-291, owner's В-1 «в»), since what they show is the person's own paper.

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

**A line the reader lost is typed on the review and recorded with the receipt** (MOL-273, owner's В-1 «а», В-2
«а»): «Добавить строку», last in the card of lines, opens «Новая строка» — the item from the catalogue's search
from an empty field or a new one, how much, «цена за всё»; only the item is required. **Apart from the
receipt's lines** (`added` of the body): the receipt's keep their positions, so «every line once» and the 409
of another reading stand as they were. Its purchase is of the same trip and transaction, a new item made in the
one order of names with the lines' own (one name, one item, spelt as a line read spells it); **it writes no
`receipt_lines`, no word of the shop's memory and no confirmed strip, and takes no package** — nothing printed,
no article. The trip's money with no total counts it as a line; «Строки», the difference and «Записать N» are
`receiptBalance` with it as a line printed nothing. On the phone it lives beside the draft
(`molvia.receipt-added.<owner>`), never inside — the build before reads a draft strictly — and goes with it.
**The measure counts it apart and in the share** (`added` of `receipt_days`, `model_receipt_days`,
`tax_receipt_days`): «0.2r» reads «lines put right» as `(edited + added) / (lines + added)` — a line lost is the
reader's miss as an emptied one is — and «added on the review» on a row of its own. A receipt with no items
takes purchases so too, and is a receipt of lines then: no «В чеке нет списка», «Записать N», no total
required. **«Новая строка» is a sheet of its own, not a mode of «Строка чека»** — that one is the printed line,
its gloss, «≠», «проверьте», the memory and «Тут дешевле», none of which a typed line has — **and the two read
their fields by one composable** (`useLineFigures`, self-review №1), so what draws nothing, the unit and the sum
are read once; their scoped styles of the item's button and «За единицу» are each sheet's own, the kit having no
such button — a price. **At `RECEIPT_ADDED_MAX` (100) «Добавить строку» is not now, and says so** (self-review
№4): one past it would refuse the whole «Записать». **The price, named:** a server rolled back refuses a body with `added` — «не принят»
in the queue, the draft kept — as it does `edited` and `account`; and a line typed teaches the reader nothing,
so the next such receipt loses it again — MOL-310's to find.

**A trip from a receipt is dated by the receipt's day for «Деньги» and the accounts alike**: the rule
that a `started_on` a day before the server's start is a wrong clock does not hold for a receipt's day
(`money-accounts-repository`): it is the day the person confirmed on the review, not a clock's moment —
the printed one or their correction of it, held only against a day still to come (`latestDay`). A
receipt of a week ago is a purchase of a week ago.

**The trip is on the account the phone names** (MOL-312, owner's В-1…В-3 «б», 27.10.2026: «важно понимать, где
сколько осталось денег», and every recorded receipt lay in «Не попали в остатки» until set by hand in «Траты»). The
body's `account` is the body of `PUT /trips/:id/payment`, one schema, settled by the same `paymentOf` in the record's
transaction: an account the person has not got, or «списано» in another currency than its, is «без счёта», never a
refusal — the record came from a queue; a marked or removed one is taken; «списано» an account of the receipt's own
currency does not need is dropped. `account_set_at` is the record's moment, so a check sees the trip as new. Absent
— an earlier build, or «Без счёта» — the trip is on no account, as before. A repeat of «Записать» is answered before
it is read and never moves an account chosen since in «Траты». **On the phone the choice is a draft beside the
review's** (`molvia.receipt-payment`), never inside it — the build before reads a draft strictly and would drop the
receipt's edits whole; «Без счёта» chosen is kept as a choice. A row only while some account lives; «Списано» under it
for an account of another currency; not now while «Записать» waits. **The prices, named:** a server rolled back
refuses a body with it and the queue of the build before drops it, as `edited` and `barcodes`; an account whose ten
minutes of «Вернуть» run out in the very transaction is a 404, as `payTrip`'s is; and with no «Счета» kept on the phone
— the first launch, after «Выйти» — «Записать» pressed before they answer records the receipt on no account, the row not
drawn yet (self-review Р1-3: held for the answer, a record at the shelf with no connection would wait for it). A choice
is kept as chosen even where it was the default, which moves with the next receipt recorded (adversarial А5).

**The same trip sent again is the same answer, another trip a 409** — the phone names the trip, as every
write offline (MOL-24). **The same receipt recorded before is refused** (Т-11,
`error.receipt_recorded_before`): its seller's tax number and number, the person's, while its purchases
are there — a trip removed lets a new shot of it be recorded. A receipt with no number is held by its id
alone. **A trip only marked removed holds no new shot, and a new shot holds its «Вернуть»** (MOL-254,
owner's decision Р-1 «б»): the commonest reason to shoot a receipt again is having just removed its record
— the wrong shop, the wrong day — and that falls whole inside the ten minutes, while the phone offers
«Вернуть» for ten seconds; a 409 at «Записать» would have said «уже записан» for up to ten minutes of a
record nowhere to be seen. So `POST /trips/:id/restore` of a trip whose receipt has a twin recorded since,
its trip there, is the same `409 error.receipt_recorded_before`, the trip left marked to go with the
timer. One rule, `recordedTwinOf`, for «Записать», the review's `duplicateOf`, the bot's notice and
«Вернуть»; the check runs inside `trips.restore`, under the owner's lock «Записать» takes first, so a
record and a «Вернуть» at once pass one at a time and the second sees the first.

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
«Записать» of that very receipt is a 409 — a new shot of the paper is another receipt, Т-11 above.
**A line not recorded goes at «Записать»** (MOL-240, В-2): nobody sees it once the
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

**Every receipt with a line in it is read and goes to the review** (owner, 04.10.2026: «читать надо все
кассы, все чеки, пытаться максимально собрать информацию»). A receipt fails as `reshoot` only when not
one item line was found: there is nothing to correct, and only a new shot can help. What was
«переснимите» before (В-4 of MOL-125) — the total read and the lines short of it (under 70 % until
MOL-255, any shortfall since, said with its sum, of the lines as read), or no total and fewer than half
the lines adding up — is **read in part** (`readPartly` in `receipt-sum.ts`, one function for the server
and the phone): the review says «Прочитали не всё» under its count with «Переснять» beside it, and
«Записать» stays. Before, it threw away everything read: am-06, a till whose print Tesseract misreads,
found 14 lines of which 2 add up and showed none of them; a crumpled am-13L found 11 with 9 right. Now
the person sees them and puts them right, and **those corrections are the measure of 0.2**
(`receipt_days`, below) — a till read badly is one to learn (MOL-169), never one to refuse. **The total
alone decides nothing**: OCR missed it on 9 of the bench's 16 readings, most of them good ones.
**«Переснимите» asserts no cause it does not know** — «Не нашли ни одной строки» and the advice, not
«смят или в тени»: the owner's three shots of 04.10 were none of those. **It names the ones it may be,
faint print among them** (MOL-227, owner's В-2 «а»): «так бывает, когда чек смят, в тени или напечатан
бледно» — and a retake fixes no faint print (the delivery till WIN-…, am-06, read alike on every shot,
larger, thicker, retrained), so for that one the advice is a record by hand; «Прочитали не всё» says the
same — «если печать бледная, переснимать не нужно — поправьте строки» — beside its «Переснять».

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
KFC on both prints), whose totals put one to three lines right. **A total the reading did not judge its lines by
judges none** (review 4, 7; adversarial В1, Г1; round 5 Д1). The reading chosen is read again as printed —
every line as read, no rest given to a line with no reading — and is «balanced» only where those lines add up
to the total shown. Kept, a line put to 160 by a total nobody sees went on to the trip's money (am-09; hand/am-08
got its right line back). **Two places shown judge no line either** (В-2 «а»): a vote misread alike in two
places made a lost row up to meet itself and the review's «≠» went quiet (Д1). **The price, named:** under a
total two places show, a row OCR lost stays empty, and «≠» says by how much — Dog City's «Ընդամենը\`
9450.00», which the table's pattern does not take (Г1). **A table with no total to judge — none read or none
shown — reads as printed**: its total chose how «1,5 1 350» splits, so with none a row takes its own
arithmetic, else its last figure as its sum — 1 350 at 900, never 2 025 at 1 350 — and a row whose figures OCR
lost stays empty. **A line's candidates are found once** (`Laid`): read again, a reading costs the judging
alone, so the worst shape of the review — four hundred rows of junk in two readings — takes what it took before
MOL-244. **A sum with its thousands apart is read whole** — «6 331,07», never 331,07 in two places: the
card's shelf total and a card payment print so where there is no discount. **A table's total is never
«balanced»** (Dog City, `tableReceipt`): a blank row helps the total choose the splits, so its lines meeting it
vouch for nothing — its total stands by its payment «Կանխիկ». Since MOL-255 the blank row takes nothing of the
total: what the lines leave is the review's difference (В-5 «а») — it gave every blank row the same rest, below
zero too (am-26: −182 140 ֏ each).

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
Nor does a total two places agree on (round 5): only the reading's own printed total, under the rules above.

**What was read in one place is kept for «Прочитали не всё» alone** (`receipts.read_total_minor`,
`readTotalHundredths`): hidden, the hint fell back to the share of lines that add up and went quiet on three
receipts read in part (am-13L, hand/am-01, am-36). The server's `partly` and the review measure the lines by
the total, else by it — «строки дают X из примерно Y». It is never the total shown, the trip's money or a
line's recorded sum (`shownLines` reads the total). **On the wire only to a phone that asks**
(`RECEIPT_READ_TOTAL_HEADER`, as `code`'s): an installed app of an earlier build reads the detail strictly.
A receipt read before keeps none; its total is the one it was shown with. The copy carries it (version 18).

## Only what was verified goes to the review as read (MOL-255)

**«Неправильно прочитанный чек хуже вообще не прочитанного»** (owner, 08.10.2026). Every receipt is still read
(MOL-222, В-1), but a figure goes to the review as read only where it is verified, and is otherwise left empty —
«Цифры не прочитали — посмотрите в чеке» (В-3 «а») — never a guess the person must find and erase. The receipts
of 08.10 showed why: «ушные палочки» at 8 320 ֏ for 380 printed, sums of 175 560 ֏, the total's rest on blank
rows, and the person spent the review erasing.

**`settled` was never «read»**: it meant the parse found some reading, and a reading may bend two digits a field
by OCR's swaps, work the price out of the sum, the weight out of the money, or take the total's rest. **The
parse now says whether a line is as printed** (`asPrinted`): settled with no swap, nothing worked out, nothing
the total gave — the card's and the class code's `pick.swaps === 0`, the table's split of three printed figures,
the twins of a seam never. **A count the line does not print is worked out** (`counted`, review round 1, №1 and
А1): a plain card row tries twenty counts at no swap, and «2Հտ 800 100» with its 400 misread 4→1 held as eight
pieces at 100 — the right «1Հտ 400 400» emptied, the misread «1Հտ 400 100» shown as four at 100; so a count
other than the one printed before «Հտ», and every count of a class row whose unit was not read, is not as
printed. One flag a line, not a mark a figure (Т-1 of the plan): the strict threshold asks only whether the line
is verified whole. The reading chosen, its lines and its total are as before — the bench byte for byte but
`asPrinted`.

**One function decides what is shown, for any reader** (`verifiedReading`, `receipt-verify.ts`, owner's В-1 «а»):
a line as printed with a quantity and a sum above zero keeps its figures; any other is emptied — quantity, price,
sum and discount `null`, `settled` false, its name, codes and rows kept. **A line paid nothing keeps its figures
where its discount is its whole price to the hundredth** (round 2, А7 «а»): a gift by the card, «0,00/500,00
500», was emptied on a receipt proven whole, and nothing said why — the foot had nothing to lack; «0 0», or a
«0,00» with no price, holds any arithmetic and is emptied still. Of a quantity of one its price and discount are
one number printed twice, and it is kept only on a receipt proven whole, as «660 660» below (round 3, А9 «а») —
and then with its count and its nothing paid alone (round 4, А11 «а»): misread alike, the price and the discount
leave every sum as it was, so the total vouches for neither, and a price kept would go to the shop's memory and
confirm its strip. **Recorded, it is a purchase at 0, and no reader of a price takes it** (№11, А8, owner's «б»;
MOL-274): the trip's money holds its 0, «Оценки» ask about it, and «Что брать» and «Тут дешевле» leave it out as
they leave any purchase at 0 (`advice.md`). **A line of a quantity of one whose price is its sum is not verified on its own**
(В-2 «а», a kilogram too since round 1, А2): the till prints one number twice, and a digit misread alike in both
columns — «660 660» for 560 — holds that arithmetic; such a line keeps its figures only on a receipt **proven
whole** — every line as printed and their sums exactly the total shown. **The price is kept only where quantity ×
price is the sum and the discount**: on the card's layout to the few luma the till rounds what was paid by
(«419,98/0 490/420»), elsewhere to the hundredth — the terminal's «624.44 624.41» is a misread, not a rounding.
**`balanced` of a receipt is «proven whole»**, not «the total met the lines». It stands at the seam between the
parse and the rows written (`readOne` of `read-receipts.ts`), so `receipt_lines` holds only what was shown: a
guess kept would be «as read» to «Записать» once the person typed the same figure, and its strip would teach the
reader. **Nor is a line whose price the check took off recorded as read** (`asRead`, round 1, №2 and А3): it
still adds up, but its strip holds the misread — «624.44 624.41» was confirmed as the truth of its row. A model's
answer (MOL-272) is printed by its nature and goes through the same function.

**On the bench** (`.scratch/tasks/research/MOL-255.md`, 54 receipts, 346 lines, 1 038 fields): 478 right and 166
made up before, **105 right and none after** (110 before the counts of round 1: «23տ» for «2Հտ» and a class row
with no unit lost theirs); the total unchanged (17 right, none wrong). Haiku's answers of MOL-268 through it:
225 right and 9 wrong — wrong by sense, a shelf price for what was paid. **The price, named:** three in four
right figures of Tesseract are now typed by the person — and counted by `receipt_days` as figures put right,
which is the honest measure of this reader; a receipt read before the rollout keeps its figures as they were
read.

**A line with no sum is recorded with none** (В-4 «а»): only the item is required, the trip's money is the
total, and no price is made up. **The total's rest is given to no line** (В-5 «а») — neither a card's or a class
code's blank, which the gate empties, nor a table's, which the parse no longer fills. **The foot says what the
empty lines lack** (round 1, А4 «а», `receiptBalance`): «Строки» are the lines with an amount, the empty ones
counted apart (`blank`) — «Не хватает 7 160 ֏ — у 11 строк нет цифр» — and no line is suspected of it; it
shrinks as the person types the figures in. Before, one empty line made the foot «Строки —» with no difference,
on nearly every receipt.

**«Прочитали не всё» is any shortfall of the lines against the total, said with it** (В-7 «а», `readPartly`):
«строки дают 1 380 из 8 540 ֏, не хватает 7 160» — the 70 % of before kept 122b8e5f quiet at 74 %, five lines
lost at the seams. **With a total it is said of what OCR lost, never of what the check emptied** (round 1, А5
«а»): the server measures `read_partly` by the sums of the lines as read, before the check — am-05, all 13 lines
found and meeting its total, is read whole, though 12 of them go to the review empty — so there the 0.2 measure
is of the photos, not of the check's strictness; with none, it is of the lines the review shows (below). **And
the phone is told it** (`receipts.read_partly`, round 2, А6 «а»): on the review an emptied line and a lost one
look alike, so the server keeps its measure and sends it only to a phone that asks (`RECEIPT_READ_PARTLY_HEADER`,
as the total read in one place); with an empty line the strip says it with no sums — «Прочитали не всё — сверьте
строки с бумагой», «Переснять» beside it — since the lines shown do not make them, and with none, as before.
Decided on the phone alone — no strip over an empty line — it stood on no receipt of the bench: every one of the
35 has an empty line, and OCR lost rows on 23. By the server's word, with no total still measured by `settled`
(round 2), it stood on 13: 11 that lost rows, am-04, every line found and their sums read short, and am-09, a
line a luma past its total — 27 since rounds 3 and 4, below. A receipt read before keeps no word (`null`): its
lines were shown as read, and the phone measures them as before. **A line found with no figures of its own is no
line lost** (round 2, №9): where the rest meet the total, the parse gives it what the total leaves, the measure
counts it, and the foot says what it lacks — counted as lost, the strip would say «not all read» of a receipt
whose every line was found. **With no total, a line adds up only as the review shows it with its figures** (round
3, А10 «а»; round 4, А12 «а»): the share of lines that add up was of `settled`, and lines settled by swaps or a
count made up — every one emptied on the review — said «read whole» of am-12, six lines found of seven, none of
them as printed; and «1 шт, цена = сумма», as printed but emptied where no total proves it, said the same of
am-38, 12 lines found of 22, three shown with figures. The strip now stands on 27 of the bench's 35: 20 of the 23
that lost rows, and seven that lost none whose lines mostly go empty — «сверьте строки с бумагой» is true of them
too. **The price, named:** am-02 lost rows with five of its eight lines shown, am-12L found one line of seven and
showed it, and am-28's lines as read make more than its total — those three stay unsaid. **And one word is both
the strip and the 0.2 measure** (round 5, А13 «а»): with no total a receipt whose every line was found but
emptied — am-30, one «1 шт, цена = сумма» as printed — is counted «in part» in `receipt_days` too, and offered
«Переснять», which reads it the same. Two words, the measure by the lines as printed, moved two receipts of the
bench the opposite ways — am-30 right, am-38, ten rows lost of 22, wrong — and were not bought. «Покупки» call a
receipt with lines not added up or empty «проверьте N строк» (№3 «а»): «не сходятся» said of a line with nothing
to add up.

**A found item the printed heading rules out is «проверьте»** (В-6 «б», `headingRulesOut`): the matcher's own
rule — the item has headings and none is the line's, OCR's swaps allowed — now for an item the search found by
the gloss too: «Ռոլիկ» (9603, brushes) glossed one letter off «լոլիկ» found tomatoes (0702) near. Only the
headings the seed gave the catalogue's nodes are known; an item with none is ruled out by nothing.

## A card that sends its discount to the card (MOL-289)

**«Ереван Сити» does not take its card's discount off at the till: it sends it to the card.** The lines are
what was paid with the discount, «Ընդամենը:» is the sum without it — what left the card — and the discount is
printed apart as «Զեղչ գործարքից», a prepayment slip of the same sum over the receipt (am-35…39, am-44). Read as
before, the lines never met the total: no total shown, «Прочитали не всё — не хватает 191,02» on every such
receipt, and the 0.2 measure counted it read in part.

**The lines meet «Ընդամենը» less «Զեղչ գործարքից»** (`linesTotalOf`), and **its second place is the sum taxed with VAT,
«ԱԱՀ-ով հարկվող»** (the card's `cashback` and `taxed` words): the lines as read every one meet it, else those two vote;
else **the total itself where two places print it — the total and a payment equal to it to the luma** — as before the
cashback (review round 1, А2: «ԱԱՀ-ով հարկվող» misread alike lost a total master showed); **that last one puts no line
right** (review round 2, owner's Б1 «а»): it vouches for the total and says nothing of the cashback, one figure copied
with the same 5↔6 — 54,00 for 64,00 made water at 160 the line that met 6 550 less it, «ԱԱՀ-ով հարկվող» saying 6 486. A
payment rounded to the dram is no place, and nor is «Ընդամենը» under the list, 0,02 off the lines where the till rounds
a price with its discount (am-39, am-44). **The total shown is what left the card** (owner's В-5 «а»: «с карты
списывается 19 097 — записывать надо именно эту сумму»), and the discount stands beside it (`receipts.cashback_minor`):
every comparison of the lines with the total takes it off — the sums В-5 records, the review's difference, «Прочитали не
всё», «proven whole» — and the trip's money never does. **A bonus a receipt is partly paid with, «Կանխավճարի մարում»**,
is the trip's money taken off (`receiptPaidOf`, `redeemed_minor`): what the bonus covered was recorded when it was sent
to the card, «когда покроется, тогда и запишем». It is kept only where the card's payment is the total less it, to the
dram — the total shown, else one printed: with no total vouched for, the trip of the lines and the cashback is the bonus
less too (review round 6, Г5). **The price, named:** no receipt with a bonus spent has been seen — the rule is the label
every receipt prints with a 0, and the vouch by the payment keeps a misread one out; a bonus spent where the payment is
cash, change printed, is not kept, and the trip counts the total. Two discounts of the transaction printed apart are a
doubt, and the receipt reads as before. **With no total vouched for, the trip is the lines and the cashback** (review
round 1, А3) — what left the card, as В-5 «а» asks; a total vouched for below the lines is the lines alone, as before
(review round 2, Б4). **The price, named** (А2б): a till that takes «Զեղչ գործարքից» off on the spot, lines before it,
is read as one that sends it to the card — its total is shown by its two places, the review says the lines miss it by
twice the discount, and the trip is the lines, the discount over what left the card, as on master; none has been seen.

**Only a model's reading names them** (`receiptTextOfModel`): Tesseract reads its total after the word under the list,
the lines' own sum, and on the bench shows none of these receipts' totals; reading the cashback there is a change of the
parse, measured on its own. **The price, named:** a receipt Tesseract reads whole records the lines' sum, the bonus
sent to the card unrecorded. **The phone hears the cashback by `RECEIPT_CASHBACK_HEADER`**: the foot says «Кэшбэк на
карту» under «Строки» and «Оплачено бонусом карты» under the total, «≈» of what left the card; an installed app of an
earlier build reads the detail strictly and knows no cashback: it is sent the lines' total as the receipt's, so it
says no «Разница» of lines read right (review round 1, А4). **That total sent back is the printed one** (review round 2,
№5): «Итог» opened and saved as it was sends exactly the lines' total, and «Записать» takes it as the total printed —
what left the card, and no total put right in the 0.2 measure; any other figure sent is the person's word. **The
price, named** (review round 3, №7): the record carries no build, so a phone of this build that has the lines' total
typed on purpose is taken the same way — the trip what left the card, as В-5 «а» asks, but the edit uncounted.

**«Ընդամենը ամվա սկզբից» is never a total** (MOL-288, the card's `sinceStart`): what the card bought this year, the
largest amount the total's word stood by, it was the total read — «Прочитали не всё» short by 120 000 ֏. Neither read
nor a vote, for either reader.

On the bench (`.scratch/tasks/research/MOL-290.md`): totals shown 27 → 34 and 26 → 33 of 54, none wrong; am-44's.

## A model's line put right by the font's 5↔6 (MOL-290)

**«Ереван Сити»'s «5» has a flat top, and the model copies it as «6»**: the owner's first receipt read by the model on
production (am-44) found all 39 lines and lost six to it, the check emptying them rightly; a faded receipt (am-34) and
am-38/39 do the same. **A line whose arithmetic does not hold as the model copied it is tried with the card's
`modelSwaps`** — only 5↔6, measured; Tesseract's pairs are its own — at most two swaps a figure («550» copied «660»,
owner's note to В-2) in any of its four figures (am-44's line 27 needed one in each of three). A reading holds the
line's arithmetic as `lineOf` judges it, and **gives a discount at the card's rate of the shelf price**, the rate the
lines as copied share, to the till's three luma: «exactly the percentage, rounded up» holds on 233 of the bench's 254
lines, not all — 395 gives 3,96 — and without the rate three wrong readings passed where one did. **A line that prints
a discount on a receipt whose lines share no rate is not tried** (review round 1, №3): nothing would hold its discount.

**The total chooses among a line's readings, never the fewest swaps** (review round 1, owner's А1 «а»): every reading of
the quantity, price and sum stays, and of all the choices across the lines exactly one may meet the total. The fewest
swaps chose wrong where the model erred twice in one figure — the very case of В-2: 0,6 kg × 550 copied «660» read as
0,5 × 660, one swap in the quantity, the same sum at the same 1 % — and the total, the sum being one, could not see it;
the review showed 0,5 kg at 660. On the reviewer's brute force (205 498 copies): wrong quantities and prices 63 → 0,
lines put right 178 065 → 188 086 — the total now also tells a sum a luma off (am-39's 567,15 and 567,16). **The
discount of one quantity, price and sum is the one at the fewest swaps; two there are a doubt.** **The price, named**
(А1 «а»): a discount the till's rounding lets read two ways — 2,55 or 2,56 of 255 — may stand a luma off the paper, on 8
539 of the brute force's lines (4,1 %), and on 15 461 of 106 161 copies of three swaps a line (14,6 %, review round 6 —
am-44's line 27 took three); the sum, the quantity and the price are right, the line under «проверьте», and the memory
takes nothing of it. Holding it too (every reading one way, «б») loses am-44 whole: its line 18 prints 5,56 where 1 % of
555 is 5,55, and nothing tells them. A line read two ways with one sum — «0,6 × 650» reads as printed and as 0,5 × 660 —
is not put right: a doubt, not a choice. **The price, named:** a receipt whose card gives two rates (am-34: 1 % on 30
lines, 0,5 % on two) holds every line to the commoner one, and a broken line at the other is not put right.

**The total chooses only among the fewest swaps' sums** (review round 2, owner's Б2 «а»): the readings of a line it
chooses among are those whose sum is, to the till's rounding, one its fewest swaps give — the same sum split another way
(0,6 × 550, 0,5 × 660), a luma off (567,15, 567,16). A reading further off is not the total's to choose: a line the
model bent to fit, 99,00 short (am-34), made the cottage cheese's 615,78 — three swaps where one reads it as printed —
the one choice that met the total, and «proven whole» hid the difference that pointed at the butter. **A line read whole
that the swaps read whole too** (a bun copied 96 / 96 for 95 / 95) is a second way: a choice that meets the total with
it moved is a doubt, and the one choice must meet it with every such line as copied; past `REPAIR_SHIFTS_MAX` (4 096)
ways of moving them nothing is put right. **And never between two sums** (review round 3, owner's Г1 «а»): where the
fewest swaps give sums more than the till's rounding apart — «160» at 150, or «622 / 6.22» at 516,78 read back or with
its sum swapped — the line is a doubt; the total confirms a line's one sum and chooses only a luma — of the sum alone,
at the fewest swaps' quantity and price (review round 4, Г3: 0,51 × 665 = 339,15 read as 0,61 × 556 = 339,16 beside a
line a luma short); the same sum split another way stays, a doubt. The fewest swaps must read one quantity and one price
besides (review round 5, Г4): 0,61 × 515 = 314,15 with its price copied «616» reads, two swaps either way, as 0,51 × 616
= 314,16 too — a quantity a luma would have chosen, so a doubt; on a till that prints no discount a luma is therefore
never chosen, the quantity times the price being the sum to the luma. A line read whole is moved by every sum its fewest
swaps give, apart or not (№9): Г1 held to it lost «505.56»'s luma, and «205.05 / 205.06» beside it was put right at
205,05. Two readings equally cheap let the cottage cheese's 615,78 pay for am-34 again, Б2 dodged by one more error of
the model. **The price, named:** such a line stays empty as before MOL-290, copied right beside it or not — lines put
right on the brute force 187 801 → 186 157 (−0,9 %), none wrong, the bench as before. The shifts cost lines put right on
the brute force 188 086 → 187 801 (−0,15 %), none wrong; on the class code's tills each neighbour that reads whole both
ways costs some 0,5 % more (440 of 84 056 beside 1 × 560); on the card's, two neighbours at 1 % whose sum ends in a 5 or
6 read a luma off within the till's rounding, and the reviewer's synthetic (review round 3, №8) puts right 112 878 → 101
421 of 124 932 (−10 %), the discounts a luma off 9 919 → 6 675 among them; the bench as before. **The price, named**
(review round 4, owner's Г2 «а»): a line the model misread twice where one swap explains it too — 0,6 kg × 1 050 = 630
copied «0.5 / 1060 / 630», read as 0,5 × 1 060 = 530 — has its one cheap sum wrong, and a neighbour bent by just that
much the other way, no 5 or 6 to swap (a bun 380 copied 480), meets the total with it: the receipt «proven whole», two
lines made up, the repaired one under «проверьте». It is the edge the check by the sum has on master — two lines misread
by +d and −d — met by one more pair; the reviewer's search puts 327 copies of round 1's space a total away from such a
repair, every one of two errors in its line and wanting a neighbour off by exactly the difference.

**It is taken only with the whole receipt** (owner's В-1 «а»): every line as copied or put right, and their sum
exactly the total two places vouch for, less what went to the card — a second source a misread line cannot fake. Short
of it nothing changes: the lines are as copied, and the check empties them as before. **A line put right is never as
read** (`repaired`, `receipt_lines.repaired`): «проверьте» with «Цифры поправили по итогу чека — сверьте с бумагой»
until the person types their own; the shops' memory takes no shelf price from it (`as_read` false); the phone hears it
by `RECEIPT_REPAIRED_HEADER`; **an earlier build, which cannot say it, gets the line empty**, as the check left it
before (review round 1, А4). «Покупки» count it among the lines to check («проверьте N строк»), and so does the
review's «проверьте: N» (№2). A line misread alike in its price and sum (am-34: 540 / 5,4 / 534,6 for 640 / 6,4 /
633,6) holds as copied and is not tried; the total, which it does not meet, keeps every other line of the receipt as it
was.

**The model is never asked to do the sum** (MOL-268): copying, it bends the digits to fit, and the check has nothing
left to catch. Asked only to mark the figures where a 5 or a 6 may be the other (prompt v6, owner's В-4 «а»), it marked
85 % of the lines that have one and copied worse — 769 → 732 right fields; an image of the till's own 5 and 6 before the
receipt, 745. Both measured and not taken: the prompt is v5.

**Every search has a ceiling** (Р-8): `REPAIR_COMBINATIONS_MAX` 20 000 readings of a line's quantity, price and
discount, past which the line is not tried and its receipt not put right; `REPAIR_RECEIPT_COMBINATIONS_MAX` 200 000 a
receipt; `REPAIR_ASSIGNMENTS_MAX` 100 000 steps of the total's choice among the lines' readings — twelve lines read
four ways each are 16 million ways, given up in ~10 ms. **A figure that is no number is not walked** (review round 1,
№1): a swap of a digit for a digit keeps its form, and three hundred fives of junk in four fields took 0,4 s past
every ceiling. The worst shape — 300 lines of 2 233 readings each — stops at the 90th line after some 30 ms; a line of
the bench tries a few hundred. `repairTries` counts the work for the tests.

On the bench: right fields 646 → 652 and 656 → 686, am-44 99 → 117, made up 2, 1, 0 as before; proven whole 18 → 19
and 17 → 19, am-44 whole. **The price, named:** a receipt with one line no swap of the pair explains — a 3 for an 8, a
digit lost — stays as copied, its five other lines too; and am-35/36, whose sum taxed with VAT the model misread with
the same 5→6, have no second place and are not put right.

## The shop's memory as a voice in the digits (MOL-291)

**Haiku is not retrained; the shop's memory learns instead** (owner, 21.10.2026: «можем ли дообучить модель, чтоб со
временем лучше распознавала цифры на определённых чеках?»). Every receipt recorded leaves «tax number + article → item
and shelf price» (MOL-126); that price is now a third voice in a line's digits, beside its arithmetic and the total,
**and weaker than both: a shelf price changes.** It is asked in the queue, at reading, by the reading's tax number and
articles (`rememberedPrices` in `read-receipts.ts`), since `receipt_lines` holds only what is shown (MOL-255) — never by
the line's text, which OCR reads otherwise each time; no tax number, no voice (the model copies it on 32 receipts of 46).

**Whose price** (owner's В-1 «в»): the person's own word's; else the lower median of three prices or more — other
people's **with no access**: the vote shows nothing but a figure printed on the person's own paper, three keep it an
aggregate, and with access alone it would be silent for every newcomer of 0.2. The hint on the review keeps its rule —
with access (MOL-126, round 2).

**It vouches for the price alone, and only one the reader may have confused with it** — within two of the reader's
swaps (the card's `modelSwaps` for the model, `swaps` for Tesseract): a price further off is one that changed, and it
says nothing (caramel 2 030 at a remembered 1 830, pepper 1 390 at 1 320 — the two changes the bench holds, in 38
repeats over twelve days). `rememberedLines`, three ways:

- **Confirmed**: a line as printed whose price is the remembered one. A line of one piece whose price is its sum is one
  number printed twice, emptied on its own by MOL-255; the memory is its second source, and `verifiedReading` keeps it.
- **Repaired**: a line that does not hold, whose price the swaps make the remembered one — read otherwise — and whose
  quantity and discount then hold it **with the sum as read**, one way: by the swaps for the model (two a figure, as
  MOL-290), **as printed for Tesseract** — two lines whose price the memory confirmed were wrong on the bench where the
  parse had bent another figure (am-39's discount, am-41's count); **to the hundredth, the discount exactly the card's
  rate** — within the till's three luma Tesseract's «60 / 0,26 / 49,76» for 50 / 0,25 / 49,75 held at the remembered 50
  (am-39). `repaired` and «проверьте» as MOL-290's, and `receipt_lines.remembered`; shown on the memory's own word.
  **Not where the reader's own swaps explain the line at any other price** — every figure by them, the sum too
  (`withoutMemory`; review 2, Б1; review 3, №8, №9, В1): «0.6 / 660 / 3,3 / 326,7» is 0,6 kg × 550 with the price
  misread or 0,5 kg × 660 with the weight misread and the cheese gone up to 660; «0.65 / 660 / 364» is 0,65 × 560 by one
  swap of the price, never 0,56 × 650 by the memory's; «1 / 650 / 550» is one number copied two ways, 650 or 550. The
  memory's old price is the one a changed shelf price makes wrong, so it chooses none of them — the total may.
  **Tesseract's every figure goes by the card's swaps in that question** (review 4, №11), though the memory takes none
  of them but the price: «650 / 550» read by it is one number read two ways, «1 100 / 1 400» too. **The price, named**:
  a line of one piece with no discount whose price and sum are one swap apart — «60 / 50», «650 / 550» — is never the
  memory's to put right, for either reader; it is the total's (MOL-290), and where the total cannot choose its sum
  either, the line is empty — and a doubt beside it stands, since not every line has its figures (review 4, the model's
  control of Б2: a 2 × 560 as printed master showed goes empty).
  **The sum is what was paid, the total's** (adversarial А1 of review 1): a butter gone up to 650, copied «660 / 650»,
  read 1 × 550 = 550 at a remembered 550 under a total of 650 two places print — the memory overrode the total. **A price
  read as remembered whose other figures do not hold is not the memory's either** — the total's (MOL-290): with the
  poisoned memory below it «confirmed» a «60 / 50» into «60 / 60».
- **Doubted** (owner's В-2 «б»): a line as printed one **5↔6** off **the person's own** price — misread alike in its
  price and sum (am-34's 540 / 5,4 / 534,6 for 640) or the price went up by just that digit; the text cannot tell them,
  and a wrong figure is worse than none — emptied, never proving the receipt whole; the review hints the remembered
  price. **5↔6 for either reader** (adversarial А4, review №2): the owner was asked of the font's pair, and Tesseract's
  others are as many ordinary changes of a price — 990 → 999, 1 100 → 1 400, 330 → 380. **The person's own alone**
  (review №4): the hint shows other people's price only with access, and a newcomer's line would go empty with nothing
  to type it by.

**The total settles it, whatever the memory said.** Lines that meet the total two places vouch for, a doubted one as
printed among them, vouch for it: no doubt — on Tesseract's reading as on the model's (review 2, Б2). The readings that
need the total — every doubted line's, every sum changed — are taken together or not at all: only where every line
then meets it, **and the paper's own readings do not meet it too** — every line by the reader's swaps, a doubted one or
one the memory would put right at any price but the memory's (`meets`, the sums reachable line by line, at most
`REMEMBERED_WAYS_MAX` of them, past which nothing is taken): two prices changed the opposite ways by one swap each read
as each other's against the same total (Б3, В2), or a doubted butter's old price meeting it beside a bun copied
«160 / 160» for 150 (adversarial Г1 of review 4). **A total refutes what the memory said**: where every line has
its figures and they miss the total — vouched, or read in one place, which vouches for nothing but refutes — the lines
it put right go back as read, and **a line it confirmed loses its word where its own 5↔6 alone closes the gap** — the
one line the total points at (review 2, №7: the bag «60 / 60» confirmed at a remembered 60 under a total 10 short).
Every confirmation dropped instead cost 3 and 12 right fields of the bench for 0 and 2 made up: the gap is most often
another line's misread, and the total does not say whose. **The total first, and on its own** (adversarial А3, review
№1, №6): for the model MOL-290's repair by the total runs on the lines as copied; where it proves the receipt whole, the
memory says nothing more — a line the total vouches for as copied is no doubt, and doubted, it had emptied every line
MOL-290 put right. **The memory chooses none of a line's readings there**: choosing by its price, it dropped the one
the total confirms (a cheese gone up 555 → 565, its discount copied «2.68»: the memory's reading four swaps off, and the
receipt not put right) and chose 0,6 × 550 where the paper printed 0,5 × 660 (Б1). Else the memory, a line at a time,
and MOL-290 again over what it decided. A receipt whose lines meet the total as read is not touched.
Tesseract's after `bestReading` chose (`rememberedReading`): its choice is not touched, and every line keeps its figures
as printed for it (`read`, the card's and the class code's rows; a plain row of two bare figures prints no price apart
and has none). The prompt is v5: the model never sees the memory (MOL-268, MOL-290 В-4, MOL-293).

**What the memory keeps after it** (owner's В-3 «а»): a line it put right, recorded as shown, keeps the remembered price
in the person's word (`as_read`, `keepsPrice` in `record-receipt.ts`) — with none the word would lose the price, and the
memory would speak on every other receipt; its cut-out rows are not confirmed, all the same: they hold the misread
(`asRead` stays strict for them). A line the total put right (MOL-290) still keeps nothing.

**The review**: a line with no price — the check emptied it, a doubt among them — shows the remembered price as the hint
«В прошлый раз здесь было …» (`rememberedPrice`, the hint's own rule of access); the mark of a line put right says
«Цифры поправили — сверьте с бумагой», since it may be the memory's and not the total's. **A total that proves the receipt
silences the hint over the one price it points at** (MOL-314, owner's В-1 «а», В-4 «а» and В-5 «б», 30.10.2026): on
`balanced`, read by the model, where the receipt has one line — one piece with no discount, its price its sum — and sent
nothing to the card,
the server sends that line `rememberedPrice` only with no price of its own, so the phone says nothing over one with its
figures. The total settled that price before the hint: the memory said nothing at reading where the lines met it as read
(`met`), and «1 / 650 / 650» under a total of 650 is the butter gone up from a remembered 550 — «проверьте цифры» there
asked the person to put the old price back and break the total. **Only where the price is all the sum there is** (three
rounds of review): a total proves the sum — quantity × price less the discount, less what went to the card — never
whose figure is right, nor how one line's sum splits. The faded font copied both ways, butter «650» for 550 and cheese
«560» for 660, meets 1 210 as the paper does (adversarial А1); asked to vouch for the other lines, the memory confirms a
price only — the cheese's weight copied «0,5» for 0,6 hides the other half under its remembered price (Б1), a cashback
«54» for 64 beside water «160» for 150 has no line to ask (Б2), and a price read as remembered may be a shelf price gone
(Б3); and within the one line a weight and a price misread the opposite ways keep its sum, 0,6 kg × 5 000 copied
«0,5 × 6 000» (В1). So the rule is the count's, never the memory's: a receipt of more lines, a cashback, a weight, a
count or a discount keeps every hint, as before. `balanced` is the check's «proven whole» (MOL-255), so the total may
stand in one place where the lines as read are its second source (MOL-244), as the memory's silence does. **Only as the model read it** (owner, review round 5): Tesseract misreads any
digit of the till, and alike in the line and in both places of the total — «1Հտ 650 650», «Ընդամենը 650.00» and the card
payment 650 for 550 (adversarial Г1), «4» for «1» in a total printed once (А2) or in a count, «1 × 400» for 4 × 100 — so
its total vouches for no price, and its receipts keep every hint, as before. **The prices, named:** a price that really
changed still reads «проверьте» on a receipt Tesseract read, on a receipt of more than one line — the same item twice in
one purchase too — and on one line weighed, of a count or discounted; **one line the model copied with the line and its
total misread alike by its 5↔6** (am-34's faded paper), in one place or in two, is shown as read with no hint: by the
text it is the very butter gone up the rule is for, the price of В-1 «а» itself (owner, review round 5). A receipt read
before MOL-255, whose `balanced` was the parse's «met», is Tesseract's: the model reads since MOL-272, a day after it.
The log of a reading counts
what the memory said, line by line — confirmed, put right, doubted (`rememberedConfirmed`, `rememberedRepaired`,
`rememberedDoubted`, review №5) — never a price: the doubts are the price named, lines a changed shelf price emptied.

**On the bench** (`.scratch/tasks/research/MOL-291.md`, the memory of every other paper of the seller): the model's right
fields 652 → 691 and 686 → 734, made up 2 and 1 as on master (697 and 740 before review 3: the lines one number copied
two ways made, the bag «60 / 50» for 50 among them, are the total's now); am-44 and Tesseract as they were (105 / 0). **The price,
named**: a memory poisoned — every price moved by one 5↔6, a price changed by just that digit — loses some 60 right
fields a run to the doubt and makes up 8–10 (10 and 9 since the total points at the line, №7), every one the bag the model itself copied «60 / 60» for 50 into the very old
price: a reading that meets the memory is what «confirmed» is, and only a total that points at that line tells it from
the truth (№7) — on a receipt of one such line, or where the total is not read, nothing does. Taken by the owner
(review 1, №3 «а»): not confirming one number printed twice closed it and left +6 / +9 of the +45 / +54. **And by what is
shown**: «1 × p = p» stands only where the memory's price is p — the lower median of three strangers' where the person
has none, a figure their own paper prints. **Ceilings**: `REMEMBERED_COMBINATIONS_MAX` 10 000 readings a line — past it
that line alone says nothing, the receipt's budget untouched (adversarial А5) — and `REMEMBERED_RECEIPT_COMBINATIONS_MAX`
50 000 a receipt; a line of the bench tries some dozens.

## How a receipt was paid (MOL-312)

**The receipt's words of payment suggest the account, and never choose it** (owner's В-2 «б», 27.10.2026). Cash is
«Վճարված է Առձեռն» — in hand — or «Կանխիկ»; a card is «Անկանխիկ» or «Վճարված է PosTerminal» (`ReceiptCard.cash`,
`cashless`). **One way only** (`paidByOf`): a word of one way beside a sum above nothing and no word of the other so —
«Ереван Сити» prints the other way at 0; both with a sum, a mixed payment, or neither is nothing, since an account
suggested wrong is one the person may not look at (MOL-255). **The closed list is the rule**: the model copies «Առձեռն»
as «Առեն», «Առեղն», «Առնեռն», «Առոեոն», «Առժեն» — so cash is a whole word «Առ…ն» whose third letter is what they make of
«ձ» (`ձծճենոժ`; a form with another is unread, the price) —
and once as «Առևտուր», trade, which is none; a word nobody listed («Վճարված է Yandex», a delivery app) is none;
«Կանխավճարի մարում», the card's bonus spent, is no payment, though the model has copied it «Կանխիկ վճարի մարում»;
«միայն քարտապան», a promotion for the card's holders, is no card. **A word of cash is the last word before its sum**
(adversarial А1–А3): the model copies the month's trade «Առևտուր ամսվա սկզբից», always with a sum, as «Առաջին ամսվա
սկզբից», and the prepayment's rest «Կանխավճարի մնացորդ» as «Կանխիկավճարի մնացորդ» — each a word of cash with words after
it, read as cash it made a card's receipt of «Ереван Сити» mixed, and with the card's word lost, cash. «Անկանխիկ» torn by
OCR, «Ան կանխիկ», is a card (А4). **Tesseract's rows count from the total down** (`receiptPaidBy`): above it «ձեռնոց»,
gloves, is an item; a reading that lost the total's word says nothing. The model's summary is all summary
(`modelPaidBy`). **Stored at reading** (`receipts.paid_by`, 0072), for either reader of a photo; **a receipt by its link
has none** — the tax office's payments are never read (MOL-232, privacy). On the wire only to a phone that asks
(`RECEIPT_PAID_BY_HEADER`): an installed app of an earlier build reads the detail strictly. In the copy (version 23).

**On the bench** (`.scratch/tasks/status/MOL-312/bench.mts`, truth by the photos' words): the model's answers of v5, two
runs, and am-44's eight — 106 right, 0 wrong, 9 none, five of them receipts that print no way; Tesseract's two page
modes — 15 right, 0 wrong, 28 none, its readings of «Առձեռն» («Առձերե», «Ueto») unread. Over every answer of the
bench of MOL-272, 882 of them — 712 right, 0 wrong (the reviewer's probe).

**How it is used** (В-1 «б», Р-1): the phone remembers the account last recorded per currency and way of payment
(`stores/paymentAccounts`) — a receipt by card starts on the account of the last receipt by card, else of the last
receipt, else the first account of its currency; no column of «cash or card» on an account. **The price, named:** the
first receipt of a way after the phone is new starts on the last receipt's account, and the person changes it once.

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
person to leave out or record; a delivery at 0 recorded in silence was an item's lowest price until MOL-274,
and is still a purchase of an item nobody bought. **82 new of 98
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

## The package a line's name prints (MOL-264)

**A till sells a packed thing in pieces and prints its size in the name** — «Կոկա Կոլա» 1.5լ, «Աշտարակ» ափսեով 950գր, a
Serbian journal's «0.5L AQUA VIVA VODA FL» — and a price is compared only by the kilogram, the litre or the piece:
«1 шт за 702,90» compared with nothing, and «Тут дешевле» said nothing or a lie (owner, 09.10.2026). **The purchase is the
till's pieces times the package** (`receiptPack`, `packedQuantity`, `linePack` in `receipt-pack.ts`): two bottles of
«1լ» milk are 2 l, «10հտ» eggs are ten pieces, a pizza base «250±10գր» twice is 500 g.

**The till's own figures stay as printed** (Р-2): its count, its shelf price, the line's arithmetic, «≠», the total and
the shop's memory by article all speak in its pieces, as MOL-255, MOL-290 and MOL-291 built them. The package is a layer
over them, worked out of `printed` by a pure function on the server's review and at «Записать» — never stored (Р-1), so
a receipt read before the rollout and not yet recorded gets it too.

- **Sizes**: a figure and `կգ`, `գր`, `գ`, `լ`, `մլ` — or `кг`, `гр`, `г`, `л`, `мл`, `kg`, `g`, `gr`, `l`, `ml` — the unit
  ending its word; a tolerance is no part of it («470գր±3%»); «N×» before or «×N», «*N» after multiplies («6х200մլ» 1,2 l,
  «15գ*8» 120 g). **A pack of pieces is read by what follows its «× N»** (reviews 2–5, В1, Г2, Д1, Д2, Е1, Е2, №10): a
  unit of a size, glued or apart, is what each piece weighs and the count stands alone («25հտ x 2գ», «32шт х 30 г»);
  anything else — nothing, a word, a hyphen of any kind, a bracket, a quote, a comma — may be packs or plies, nothing tells
  which: none — a Serbian count's «X N» as well, «100KOM X 2», «10/1 X 2» (review 6, Ж2), and a sign of times with a
  figure anywhere after the count, «10шт. х 3», «4հ «Զևա» x 2», «10հտ (C1) x 3» (review 7, З2) — but a sign with a number
  standing alone before it is the thing's width and length, «100шт 24х37см», «30հտ 50x60», and the count stands (review 8,
  И1, №13); a figure glued to a letter is a word, «10հտ C1 x 3», «4шт LR6 x 2» — packs, none (review 9, Й3). Four rounds of review found a new spelling of «packs or plies» each time while the default was to multiply;
  none by default ends it. **The prices, named:** «4հ x 2», eight rolls, and two-ply napkins «100հ x 2 շերտ» keep no
  package. A star before a size is no count: «Արարատ 3* 0.5լ» is a cognac's stars
  (review №1). A fat, microns, milligrams, volts, metres, years («5տ», a vintage «2019г» — a whole number from 1900 to
  2099 before the Russian «г», in either case; an Armenian or a Latin gram is a package, «2000գ» of cat food — review 2, В4) are never a
  package; a figure with no unit — a size the till cut, «… 85» — is none.
- **The size or the pack is read only where it is the name's one number** (review 12, over reviews 8–11). A count of
  several beside the size makes the size one of them — «4 банки 0.5л», «6 в упаковке», «из 6ти банок», «6pk», «x6»,
  «0.5լ/6», «1+1», «пара банок», «six-pack», «тридцать банок» — and the ways a count is spelt have no end: rounds 8–12
  listed containers, words between, prepositions and number words, and each round found a new spelling, half the time
  one the last fix had opened. So any other whole number from 2 to 100 standing on its own (`OTHER_NUMBER`), a number
  spelt in a word (`COUNT_WORD`: Russian in any case to forty, English with «-pack», Armenian, Serbian, «пара»,
  «дюжина», «мультипак», «двойная», «сдвоенная», «трио», «дуо», «спарка», «double», «duplo», «զույգ»), a bundle «N+M»,
  «N x M» or «N/M» beside a weight or a volume and no count of pieces of two or more — the till's «1шт» is none (Р3) — «0.5л 1х12», «2x6 0.5լ», «0.5л 1/12» (`PAIR`,
  rounds 13–14, Н1, П3) — and a count past a hundred with a word after it, «200 пакетиков 2г» (`LARGE_COUNT`, №18),
  keeps no package. What is not a count: a figure after a lone Latin letter, a model's or a
  class's, «C1», «N4», «E27», the eggs' class «С2», «С3», «Ս2», and after «№» — but «x6» is a sign, and a figure after a word,
  glued or past its point or its comma, is a count, «уп12», «PAK6», «уп.12», «бл,4» (Т1, У1; **the price, named, as a
  class:** a model's number glued to its word — «Mach3 4шт», «Nan2 400г», «GU10 2шт», «AA LR6 4шт» — keeps none, №21;
  «0.5л №12» is read as a label); plies, «3D», years and three in one glued after
  it, «3շ», «5տ», «3-ը 1-ում», «3в1», «2in1» (`NOT_A_COUNT`, the bench's own); a fraction, a percent or degrees, a range and
  a width by a length beside a count of pieces, «3.2%», «40°» (Н3), «9-14կգ», «100шт 24х37», «35л 50х70 30шт» (П1, №19); a
  figure with a unit of measure, «500мг», «220V», «220В», «10Վտ», «10А», «9 Вольт», «60 Ватт», «70мм», «5м» glued
  (`MEASURE`, П2, Р1, С1, С2) — never a unit that is also a word, «6 в упаковке», «6 ед.»: «м» and «В» only glued; a
  Russian «В» or «А» glued, in either case, is a measure unless a word in small letters or in capitals follows (У2), «220В E27», «9В Крона» —
  «6В УПАК» stays a count (`CAPITAL_MEASURE`); **the price, named:** «Пиво 6В 0.5л», «6в 0.5л» read volts; a line's number before its name, «17.»; a code past a hundred standing
  alone, «9639», «250h 193», a vintage «2019». **The price, named, as one class:** a name's own number — «Балтика 7», «7 злаков», «Pampers 4
  Maxi 52шт», «3 в 1» apart, «12 лет в коробке», «Три медведя», «AFTER EIGHT», a model's letter copied as a figure,
  «2ոկոլապ», «Neva 12h 32» — keeps none: on the bench 231 of 233 read right (two lines of the brand «3 կոռոչկի»), 95
  and 99 of 102 and 107 by the model (its copies of «3շ» as «32», «Շ» as «2»), 20 of 21 in Serbia; nothing made up
  more, and one less in Serbia — «260ml … SCY903/01» (round 14). **What stays:** a pack of several that prints no count — «Пиво упаковка 0.5л», «набор» — is read as one; a
  count spelt in a word past the list is read as none of it — the one class no rule of the text closes, since a pack
  of several named only in words prints nothing a figure could say; the list holds the words met and the ones review
  named; a count glued after a word, «PAK6», is the word's. A word of a count is read outside what was read, so the pack's own «3զույգ» stays a pack (Р2). A word of a pair
  or a double in a name is a count too, «Milka Double», «Triple Sec» — the
  same class as the name's own number.
- **What stands before a size may say it is none of its own** (review №2, adversarial А3, А4): a range, «9-14կգ» — a
  nappy for a child of that weight; a fraction, «1/2կգ», «1/2L» — its denominator; a sign of times whose count is a word,
  «25пак*2г», «25 փաթեթ x 2գր» — one sachet of a box, 25 times the price a kilogram. The line keeps no package. A sign of
  times, in either case, is one standing apart, «25 KES X 2G»; one glued to the figure after any letter, «пакх2г», «4
  банкиx0.5л», «2 коробкиx10шт» (reviews 2–6, В2, Д3, Ж1, №12); or one ending a word that follows a figure, glued or apart,
  «25ПАКХ 2Г», «25 пакетикиx 2г» (Г1, Г3, З1). A count's word and a name's read alike there — «25 пакетикиx 2г» and «Ariel
  3в1 Max 25шт» are a figure, a word ending in «x», a figure — and a package made up is worse than one unread. With no
  figure before it, «x» is the word's own: «Elixir mix 0.33l», «Durex 3հտ», «пальчиковых 4шт» (Г5). **The prices,
  named:** «Ariel 3в1 Max 25шт», «2in1 Max 400мл», «в 2 вкусах 200г» (review 7 over Е3, №11) and «Pepsi Max1.5լ», glued,
  keep none — «Elixir mix 0.33l» is a drink,
  «Durex 3հտ» three, «пальчиковых 4шт» four (Г5). A count of pieces with a sign of times before it, «2x10հտ», is a count of packs unread: none (review 2,
  №7). **The price, named:** «1/1L» is none too.
- **A pack of pieces wins over what one holds** (Р-3, owner's В-1 «а» — every kind of goods, not food alone): «Աղբի
  պարկեր 35լ 30հտ» is thirty bags, never 35 l. Two at least: «1 հտ» is the till's own count as often as a pack. A Serbian
  pack is «107KOM» glued or «10/1»; a «KOM» apart is the journal's unit of sale.
- **A thickness printed says the thing is packaging** (Р-11): «… 60միկրոն», «KESA VJZ 7KG 51 MIKRON» — its kilograms
  are what it carries. None.
- **Two sizes that disagree are none** (Р-4); a pack of pieces with two counts too.
- **A Latin «h», in either case, beside a size is no pack** (adversarial А1, review №3; «48H» — review 2, №6, В3): it is the model's copy of «հ» — «Անձեռոցիկ 75h»,
  «Տոպրակ աղբի 20լ 30h» — and a label's hours too, «Rexona 48h 150մլ», 48 pieces of a deodorant. Nothing tells which,
  so beside a size the line keeps no package — the garbage bags of the model's copy are pieces again, never their 20 l.
  Dropped altogether, the bench lost 8 and 14 packages and made the bags' litres up. **The price, named:** hours with no
  size beside them, «Nivea Men 48h», are a pack of 48.
- **A line the till weighed or poured keeps its quantity**, and a line the check emptied gets no package (Р-8): a package
  of nobody knows how many is a guess.

**Wrong is worse than unread, so a size not read for sure is none** (MOL-255). Measured on the bench
(`.scratch/tasks/status/MOL-264/`, packages from the truth's `meaning`, written by hand, × the till's count):

|                         | truth's text | Haiku v5, three runs       | Tesseract | Serbia (78 lines) |
| ----------------------- | ------------ | -------------------------- | --------- | ----------------- |
| master: right / made up | 2 / 0        | 2, 2, 0 / 0                | 1 / 0     | —                 |
| the grammar alone       | 253 / 0      | 117, 124, 22 / 13, 12, 0   | 9 / 4     | —                 |
| the PR before review 1  | 236 / 0      | 105, 112, 20 / 0, 1, 0     | 8 / 1     | 21 / 1            |
| **as shipped**          | **233 / 0**  | **102, 107, 20 / 0, 1, 0** | **8 / 1** | **21 / 1**        |

- **A 6 read off a photo is a doubt, in a size and in a count of pieces** (Р-12; adversarial А2, review №4): «Ереван
  Сити»'s font prints a 5 with a flat top and both readers copy it as a 6 (MOL-290) — «0.46լ» for 0,45 l, «46գր», «1.6լ»,
  «260±10գր» were every one of the model's made up, and 15 eggs copied «16հտ» are as made up. Doubting the 6 costs 17 sizes
  of the truth's 230 that really hold one (165 g chips, 360 g condensed milk, 1.6 l); doubting the 5 as well cost 78 for
  one made up less. A count in doubt takes the size beside it along: the cups' 330 ml is what one holds. Serbia's text is
  the tax office's, never read off a photo: no doubt.
- **A unit read off a photo is glued to its figure** — 232 sizes of 232 on the bench — so «505 գր» is the model's copy of
  the glue's «505 6գր» with its 6 lost, «Maxi 4 L» a nappy's size, «2019 г» a vintage: none. On a Serbian journal a Latin
  unit may stand apart («MLEKO 1 L KOM»).
- **No package weighs over 50 kg or holds over 25 l**: «330լ» is a can with its point lost. A cooler's 19 l, a bag of cat
  food's 20 kg are packages.
- **The prices, named:** the model's «9գր» on an ice cream whose size the till cut is made up — a unit the model wrote
  that the paper never printed; Tesseract's «88գր» for 85 (one in nine of its packages); a Serbian baby bottle's «260ml»
  is what it holds, as the bags' litres (Р-3) — a container whose capacity is printed with no count beside it. Half a
  gram is no quantity («18.5G» of coffee): the kilogram is kept in grams.

**On the wire to a phone that asks** (`pack`, `RECEIPT_PACK_HEADER`, as `spelled`): an installed app of an earlier build
reads a line strictly. **The review shows the purchase** — the line's quantity is the pieces times the package, the
sheet opens at «1,5 л» with «За единицу» and «Тут дешевле» by the litre — and **the row keeps the till's figures where
they stood, the package after them, «2 шт × 370 ֏ · 2 л»** (owner's В-2 «а»): the person checks the paper by the
till's figures — printed by the rule of money (MOL-205), so the paper's «370,00» reads «370 ֏». «кол-во × цена» of the sheet is a weighed line's alone: a bottle's shelf price times its litres is no
figure of the line.

**At «Записать» the quantity shown is no edit, in either form** (Р-9, Р-10): the pieces times the package, or the till's
pieces a phone of an earlier build sends, knowing no package — so the 0.2 measure counts neither, the line is as read and
the shop's memory keeps its shelf price. **A line set back to the till's pieces on purpose** (adversarial Б) is put right
by the phone's word — `edited`, the measure of 0.2 counts it — and as read for the memory all the same: the till's figures
are what it read, a piece's shelf price true in either form. **The prices, named:** an earlier build, sending no
`edited`, is told from it by nothing; and `make repack`, below, moves such a line into its package — so it is run once,
right after the rollout, before a receipt is recorded on the new build. A draft of an earlier build whose sum alone was
put right carries the till's pieces, and recorded after that run it stays in pieces (review №5). **A new item takes one package as its
usual quantity** (`typical_qty`, MOL-261): the next purchase typed by hand is offered «1,5 л», the milk «1 л» for the two
bottles bought — only where the package is of the unit recorded. Its name keeps the size, as MOL-293 named it (В-1 «б»).

**What was recorded before is put right once, by hand** (owner's В-3 «а»): `make repack` (`dist/repack-receipts.js` in
production), a dry run unless `YES=1` — the same transaction, rolled back, as the seed's — printing every purchase «было →
станет». It moves a purchase only while its quantity is still the till's pieces as read, and an item only where that very
record made it, by that person — an item's `created_at` and its receipt's `recorded_at` are one transaction's `now()` —
still in pieces with no usual quantity. A second run finds nothing.

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

## Why a receipt was not read whole (MOL-309)

**Owner, 26.10.2026: such a receipt is kept, the developer told, and its reasons counted** — the photo went
at «Записать» and the model's answer nowhere, and 122b8e5f's five empty lines were left with no cause to
find. **The reasons are named by the check that took the figures** (`explainedReading`, beside
`verifiedReading`, which is its `shown`): a line's — `doubted`, `missing_figure`, `repaired_unproven`,
`unsettled`, `bent`, `zero_not_gift`, `one_alike_unproven`, `price_dropped` — and one a receipt, the first of
`no_lines`, `no_total`, `line_doubted`, `line_not_as_printed`, `lines_lost`, `lines_over`; `failed` where the
reading found no line. By kind, never a figure; a gift of one piece on a receipt proven whole is no reason —
kept with no price by design. **`lines_lost` comes after the lines' own reasons** (adversarial А1, А2): a line
found whole with its sum not read, or one read low by the font's 5↔6, makes the lines short as well — on the
bench both receipts named `lines_lost` before had lost no line — so a line lost is said only of a receipt whose
every line is as printed. **The price, named:** lines lost beside a line not as printed are said as the latter;
the server's word «Прочитали не всё» is counted apart for that (`partly`, below), and goes with the reasons
into the notice, the review and the copy (adversarial Б1 of round 2: a line lost hidden behind a line not as
printed was said nowhere a person reads). Finer kinds of «not as printed»
(which swap) are the parse's, not here: an iteration of MOL-310 that needs them opens the parse.

**Counted for every reading of a photo, by either reader** (`receipt_reason_days`): day in Yerevan × reader ×
country × scope × reason, with the receipts read and the lines found as the denominators, in the transaction
of the reading, no id — erasure does not reach it. **Beside them, two counts of the reading, never reasons**
(self-review №5, №6): `partly`, the server's «Прочитали не всё», and `no_items`, a receipt with no item lines —
a sum read whole (MOL-227), never «not whole». **A reason is a row, never a column**: a new one needs no
migration and moves no key. Read by `make receipt-reasons FROM= [TO=]`, a block a reader and country, each
share beside its n — the input of the fortnightly review (MOL-310). Not `make gates`: the gates have stop
lines, the reasons none.

**Kept and told: the model's receipt where the person has something to type** (owner's В-4 «б»): a line
emptied (a sum kept with its price taken off is no field to fill), lines lost against the total, or nothing
read. **Tesseract's are counted and never kept or told** (owner: «с ним потом разберёмся»). **Kept** —
`receipt_misses`, the model's answer as it came and the reasons, `receipt_miss_parts`, the photo copied at the
reading — **past «Записать»**, which deletes the receipt's own, **until the review lets it go**
(`make receipt-miss-forget ID=|BEFORE= [YES=1]`; a start of an id naming more than one receipt lets none go, as
`show` refuses it) **or 21 days pass** (`RECEIPT_MISS_KEEP_DAYS`, Р-8: the fortnight of MOL-310 and a week for
the review itself; the minute timer). **Only for whoever accepted edition 4** (`REVIEW_CONSENT_EDITION`,
owner's В-3 «б»: everybody's, under a new edition — a new purpose): the edition before promised the photo goes
at «Записать», and a receipt of whoever has not accepted it is counted and told, never kept.

**Its key is the receipt's id as read, never a key to the receipt** (`receipt`; owner's В-6 «а»): «Переснять»
stands on exactly the receipts the review is kept for, and removes the one it replaces. **So a retake leaves the
review**: the phone names it (`RECEIPT_RETAKE_HEADER` on `DELETE /receipts/:id`, from `molvia.receipt-retakes`
kept beside the queue — the build before reads a write strictly), the server marks `retaken_at`, «Вернуть» takes
the mark back, and the purge lets go of the link (`receipt_id` to null) before the receipt goes. Every other
removal takes it by the cascade of `receipt_id` — «Удалить чек», its trip gone for good, the 28 days of a
receipt not recorded — and **the person erased takes it whatever it is linked to** (`actor_id`,
`ACTOR_REFERENCES`). **The mark is kept before the removal is queued** (self-review №11): the queue may send it in
the same task, and the header is read as it goes — kept after, the removal of a phone with no `navigator.locks`
went with no header; it is let go once the removal leaves the queue, sent or set aside (№12). **The purge lets go
of the link and deletes the receipt in one transaction, at one moment** (`now()`): two statements of their own
clocks let a receipt whose ten minutes ended between them go with its review. **The prices, named:** a phone of an
earlier build names no retake, and its review goes as it did; a server rolled back takes the removal and ignores
the header; and the review of a receipt replaced is no longer the person's to remove by «Удалить чек» — the new
receipt is not the one it was read from — only «Удалить мои данные» takes it before its days, which «Чеки» of
edition 4 says.

**The person's copy says it** (`receiptReviews`, version 25, self-review №4): which receipt, the link while
there is one, when it was read and by what, until when it is kept, whether a retake replaced it and why it was
not whole — never the photo or what was read. **`make receipt-miss` writes out of the working directory** — a
directory `receipt-miss-<id>` under a root, `.scratch/receipts/misses/copy-<CLONE_INDEX>/` from the make target and the
system's temporary one from the command itself (self-review №1, adversarial А5): a person's photo and purchases never
stand in the public repository's tree, nor fail on the API image's `/app`; `receipt-miss-*/` is ignored besides.
**`forget --yes` lets the copies under its root go with the rows** (adversarial Б2), **and every copy there whose
review the database no longer keeps** — gone by its 21 days or with its person (Б3): a copy must not outlive what it
was copied from. **The root is one database's** (round 4, В1б): `.scratch` is one for every working copy and each has
a database of its own, so a shared root let one copy's `forget` delete the copies another still reviewed — hence
`copy-<CLONE_INDEX>`, as the ports are. **The dry run names the copies `--yes` would delete** (В1а): it is the one guard
of a command that deletes, and it named the rows alone. Only the root's own `receipt-miss-<id>` directories: copies
brought from production lie under `prod/`, which no copy's database can judge, and are the review's to delete by hand,
as one written by `--out` — the README of receipts says how.

**Told** — `receipt_partial` in `owner_notices`, after the reading is written, and only then (a receipt removed
or taken meanwhile is nothing to tell of, self-review №7): the country, lines found and with figures, the
receipt's reason — none where it was proven whole and a line emptied all the same (adversarial А3) — and the
lines' by kind, and «Прочитали не всё» where the server said it; **the id's first eight characters and until
when, only for a receipt kept** — of one not kept the id would name a person's receipt nothing here opens
(self-review №3) — no name, no sum, no shop; the day is the one of `keep_until` as written, in Yerevan
(`dayIn`, self-review №13), never worked out beside it. **Three a person an hour and twenty in all** (Р-6, the phone's budget by
the person's id in memory, `phoneNoticeBudget` with its own muted notice): the rest counted and told once an
hour, `receipt_partial_muted`; dropped unclaimed after a day, as a failure's notice. No `OWNER_TELEGRAM_ID`,
nothing told; kept all the same. **The prices, named:** a rollback past this leaves the old API unable to read
a `receipt_partial` row (`OwnerNoticeUnreadable`, a failure of the claim); a restart forgets the hour's budget,
as the phone's.

## What lives how long

| What                          | How long                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| A removed receipt             | ten minutes of «Вернуть», then the minute timer (П-8, as MOL-73)                                 |
| A receipt not recorded        | 28 days after it arrived, whole (В-3) — by the server's clock, not the phone's                   |
| The photo                     | until the receipt is recorded: recording deletes it; the timer holds the promise if it does not  |
| An item line cut out          | 28 days after the receipt is recorded, and only a line recorded as read (В-4) — or with its line |
| A recorded receipt            | while its trip is there: the trip removed for good takes it (MOL-240)                            |
| A line of it                  | while its purchase is there; a line not recorded goes at «Записать» (MOL-240, В-2)               |
| A receipt kept for the review | until the review lets it go, 21 days after reading at most, after «Записать» too (MOL-309)       |

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
photo carries a name and lives days, a copy lives fourteen. Nor does a receipt kept for the review
(`receipt_misses`, `receipt_miss_parts`, MOL-309), nor the person's copy of their data. A restore brings their tables back empty; a
receipt queued without a photo fails as `unreadable`.

**Erasure takes a receipt whole**: `receipts` is the erased table, its parts, lines and cut-out lines
go by the cascade. **The copy carries receipts and their lines, never a photo** (`EXPORT_COLUMNS` says
why for every column left out).

**The log carries counts, never a receipt**: status, parts, lines, milliseconds, the reader and what
the model cost. No text, no tax number, no photo — not in the API's log, not in the reader's, which
logs nothing at all: whatever breaks in it answers 500 with no traceback, and a connection broken under
a request is not printed (review А12). **The photo of a receipt the model reads goes to Anthropic**
(MOL-272) — whole, the customer's name with it where the shop prints one — only for whoever accepted
edition 5 (MOL-319); what comes back is kept as any reading is.

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
- **The copy is a mean, never a sample** (MOL-259): the phone halves the photo on canvas until it is
  within 1 280 (`halvingSteps`) — a step of exactly half is the mean of four pixels in any engine — and
  `grayOf` takes it the rest of the way, as it took the bench's whole frame. **Exactly half on an odd
  side too: its last pixel is left out** (`halvedSource`). Drawn 4 619 into 2 310, the canvas samples
  again — its point drifts across the photo until it reads one pixel of two in the middle, where the
  receipt is — and a long receipt of 1 513 × 2 013 tore at its crease in both engines while the bench
  found it whole (adversarial А1); such a side is any photo over 16 Mp `fittedSize` brought down, a
  crop, a screenshot. One `drawImage` from 4 032 straight to 640 bilinearly reads four pixels of some
  forty: the print and the sensor's noise it keeps tore the paper's region in two, and the phone
  proposed half a receipt the bench had found whole — am-05c, a long crumpled «Ереван Сити», lost its
  top half in Chromium and its foot in WebKit; the bench never saw it, measuring the mean. **The bench
  makes the phone's copy by `halvedCopy`** — the same steps without a canvas — and an engine's own
  drawing is checked in Chromium (on the GPU too), WebKit and Firefox
  (`.scratch/tasks/research/MOL-259/`, the adversarial rounds of MOL-259): the copy within 2 of 255 of
  `halvedCopy` on every frame, odd or even. No `willReadFrequently` on it: read once, it only cost more
  — WebKit half as much again, Chromium on the GPU 0.6–2 ms. Not `imageSmoothingQuality = 'high'`, which
  matched the bench as well: what filter it names is each engine's to choose, iOS's among them. **The
  price, named:** the cut of am-26 that brought the task, a table's column of sums, is not reproduced —
  its frame is gone, only the cut is on production — so it is explained by the mechanism, not proven on
  itself; and a crease across a receipt deep enough tears the region under the mean too, as MOL-228's
  Russian frames showed (a fold, two receipts end to end) — another mechanism, not this one.
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
