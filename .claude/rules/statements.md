---
paths:
  - 'packages/model/src/entities/{statement-line,statement-match}.ts'
  - 'packages/model/src/support/{payee-name,printed-time}.ts'
  - 'packages/model/tests/entities/statement-*'
  - 'packages/model/tests/support/{payee-name,printed-time}.test.ts'
---

# Spendings from a bank's statement: the line, its key, «не траты», the duplicates rule (MOL-429)

The epic MOL-427 turns a bank's statement into spendings: a parser of a bank's file (MOL-430…432) or the model
reading a screenshot (MOL-437) fills lines, the API (MOL-433) answers which are new, which are recorded and which
are no spendings, the screen (MOL-435) shows it. This area is the domain all of them share, pure and with no I/O:
the server calls it (the file is parsed there, Д-3 «а» of MOL-409), the phone gets the answer. The rule is MOL-409's
bench (`.scratch/tasks/research/MOL-409/bench/match.mjs`, adversarial rounds А…Н) with the two findings of MOL-428's
measurement on the owner's samples; the owner's decisions are in `.scratch/tasks/plans/MOL-{409,428,429}.md`.

## The line

- **One shape for every reader** (`statementLineSchema`): the day — the operation's for a file (Д2), the one the
  screen shows for a screenshot — the posting day, the time as printed, the amount and «списано», the sign (`-`,
  `+`, none), the payee as the bank prints it, MCC, the bank's category, the status (posted, pending, declined) and
  the kind. **The kind is the reader's** (Р-5): the parser knows its format's columns and words, the model the
  screen — the domain reads a bank's words only where the rule needs them (a line calling itself a transfer, В2б, or
  an exchange), and an MCC of cash only where no kind was set.
- **The form is a closed list** (Р-8): a parser adds its own in one line. The domain knows three things of it: whether
  it is a bank's file (`isBankFile`) — every line of its period, dated by the operation with the posting day beside it
  where the format prints one, while a screenshot shows the posting day (MOL-428); whether the key repeats — a file's
  does, a screenshot's not, the model rewrites the payee (Е1); and whether the day may move from the phone's
  (`SHIFTED_FORMS`, T-Bank's CSV — not measured, a named price). **A parser reads the posting day where its format
  prints one**: it is how a file's line meets a screenshot of the same operation.

## The key

- **A line's key is its spending's id** (Р-2, `statementLineKeys`): a uuid v3 (`nameUuid` over `md5Hex` — the domain
  imports no `node:crypto`; MD5 here is a name, not a secret) of the person, the statement's account, the day, the
  sign, the amount and the payee as printed, spaces squeezed, and the turn among equal lines **of its status** — a
  later export may leave out a refusal or a hold the bank dropped, and the payment made again beside it would take
  its key (adversarial А5, А9). So a hold and its posting are two keys: the link lets the posting in. The same line
  uploaded again is the same id, written once. **The person is in it**: two people's like lines of statements with no
  account would be one id, and the spendings' id is one primary key for everyone — the second would vanish silently
  on a conflict. **The form is not**: the same text in a bank's CSV and its PDF is the same line. The reader's
  other additions — kind, time, posting day — move nothing.
- **The link** (`statementLinkSchema`, stored by MOL-433 on a spending, a trip and a transfer) keeps the key and the
  account of the upload it was keyed under, the day and the posting day, «pending», the form, the amount, the payee
  and the time: enough to know its own line again after an account chosen since (adversarial А4: the account is in
  the key, so the same file uploaded first «без счёта» was all new) — **as a doubt «другой счёт», never silently**:
  the same file again and a like line of another card of the bank are one key there (А8) — tell another line from it
  (Г2, Д2), let a hold's posting in (Г2б), compare two screenshots' times (Ж2) and write the line of a relinked
  record as a spending (Д1).

## «Не траты»

- **No spending**: money in (`+`), a line the bank declined (В1 — it settles nothing), a line with no sign (А9), an
  own transfer, a cash withdrawal and an exchange — by the reader's kind, or by a recorded transfer or exchange that
  settles it. **«В обработке» is a spending.** **A bank's fee is a spending**, ticked, with the hint «Прочее».
- **A transfer to somebody with nothing recorded is new, not ticked, marked «перевод — трата ли это?»** (owner's
  В-2 «б»): banks word rent paid to a person and a move to one's own card at another bank alike.

## The duplicates rule

- **The candidates are built by the domain** (Р-10): spendings — removed ones still within «Вернуть» too, a match with
  one a doubt (А5) — finished trips by `tripMoney` and their days, the phone's or the moment's in Yerevan (А7), as
  every reader of a trip; transfers; and **exchanges, the given side** (MOL-428: 13 of the 19 lines it missed were
  exchanges the owner had recorded).
- **The windows and the sum are measured** (MOL-428): a file meets a record within ± 2 days; a screenshot, which
  shows the posting day, from two days before the record to four after; the amount exactly. **Not measured, named
  prices**: a line up to a fifth over is a tip, a doubt (А2 — MOL-409 saw one tip, +5 %); one under, down to half, by
  the same name and on the statement's account, a hold, a doubt (В4, Г3); a hold posts within 7 days, a late posting
  by the same name is a doubt to 30, a refund looks back 60 days.
- **A record on another account is a doubt, never filtered out** (owner's В-1 «а», against round А6): MOL-428 found 6
  of its 19 misses were card payments the owner had recorded on «Наличные AMD» — filtered, each came back a duplicate,
  ticked. A record on the statement's account is preferred to one on another. **A transfer or an exchange is the
  other way** (Б1а): only from the account its money left — or either unknown — and it settles the line, «не трата»,
  only exactly, on its day, from that very account, on a line calling itself a transfer or an exchange; otherwise a
  doubt (Б1б, Г1, Р-6).
- **The payee's name is the second sign** (`payee-name.ts`, А4): folded across Cyrillic, Armenian and Georgian with
  the sounds banks spell apart, and Serbian in both scripts, its marks read as its Cyrillic (review №3) — **never
  `toSearchKey`**, whose tables are frozen under the catalogue's keys (А4б: no word of «YEREVAN CITY» meets «Ереван
  Сити» there). It orders the candidates, and a record whose name meets the payee in no word is a doubt (Б4). **The
  words of a place are no seller's** — the cities of the settings folded (`COUNTRY_CITIES`, Р-4), exact under six
  letters so «SAS» is no «Сад»: aside in a bank's line (М1) and in a record's name alike, or «Ереван Сити» meets every
  card line of Yerevan and a purchase at SAS is silently its trip (adversarial А6). **One seller** (В3, Г4) is every
  word of one name in the other, and one common word is no seller (Н1). **A name that is nothing but a city's word
  keeps it** (А10): the restaurant «Казан», the cinema «Москва» would be no name, met by any line; with the line's
  city aside too, such a record meets its own line in no word — a doubt «другое имя», a tap.
- **One to one by the greatest matching** (А3, Б2, Kuhn's path): what met exactly first, the doubts only for records
  left free.
- **The link decides another line** (Г2, Д1, Д2, Е1, Е2), past the window too where it names it: its own line, by its
  key; another form on the link's day, ± 1 for a form whose day moves — **and a screenshot against a file's line by
  the posting day the file prints, and by it alone** (adversarial А1, А11: the bench took a screenshot's day for the
  operation's, MOL-428 measured the posting's); **a file that prints none — Ameria's CSV — against a screenshot one
  to four days after it is a doubt «день проводки?»** (А12: Ameria posts its card lines one to three days late, 32
  of 32 measured, so one day only made a duplicate of almost every such pair); never
  another key of the same file; **a hold's posting** — in a file on the hold's own day, the operation's (adversarial
  А2, А3: a week after it a file's line is another operation, and let in it was a spending lost silently), on a
  screenshot within its 7 days. A screenshot against a screenshot on one day is told by the time (`printed-time.ts`:
  an hour apart and not the font's 5↔6 is another operation, Ж2…Л1), else a doubt. A line nearer the record than its
  link's is a doubt «пересвязать» (Д1); a late posting, a doubt to 30 days, is a screenshot's only. The line a record
  was made from is its first, before a like one of the same file.
- **Refunds** (В3, М1, Н1, Г4): a purchase refunded in the same file is new and not ticked; a refund of a recorded
  spending or trip is «не трата» naming it — the nearest before it, then by id, never the order MOL-433 reads them in.
- **A hold with no posting** (Д3, Е4, Ж1): a record made from a «pending» line, on the statement's account, that no line
  met, where the statement covers its day — «убрать трату?» once it runs 7 days past it, ticked only for a bank's file
  with a period in its head; a screenshot is what the person chose to show.
- **The rule's ceiling is held by its work** (review №1, А13): it runs in the API's process. A line weighs only the
  records whose window or link reaches its day — a link at most a late posting's thirty days either way — the sum
  first, a name folded once a line and once a record; a statement holds `STATEMENT_LINES_MAX` lines (3 000, five
  years of the samples' 30–50 a month). Linked records passed every window and took a year 4–10 s; now 3 000 lines
  against 3 000 records linked to screenshots is some 0.5 s here, and a test holds the count weighed
  (`statementRecordsWeighed`) under a quarter of every pair — a clock on CI does not tell a second from four. A
  month against a year with no links, folded a pair at a time, was 8.1 s: a test bounds it at 4 s.
- **The answer is a discriminated union** (Р-9, `StatementLineDecision`): `new` (ticked, a note, a hint),
  `recorded` (the record and the doubt, or none), `not_spending` (the reason and the record that settled it); the holds
  apart (`unposted`). MOL-433 and MOL-435 read one shape and repeat no rule.

## The prices, named

- **The bench's truth is the rule's own feature**: MOL-428's pairs were gathered by «the same sum, the day ± 3» — false
  «recorded» answers are not measured. A doubt is shown, not ticked, so an error costs a tap, never a lost spending.
- **The unmeasured constants** — 7, 30, 60 days, a fifth, a half, T-Bank's day, and a file with no posting day
  meeting a screenshot one to four days later as a doubt — are measured by the parsers' tasks on the owner's files;
  a change is a test of its boundary moved. Whether Ameria's CSV «Date» is the operation's day is MOL-432's: if it is
  the posting's, the form is no `isBankFile` of that kind, and the doubt asks for nothing.
