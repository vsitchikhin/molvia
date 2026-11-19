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
- **The form is a closed list** (Р-8): a parser adds its own in one line. The domain knows two things of it: whether
  the key repeats — a file's does, a screenshot's not, the model rewrites the payee (Е1) — and whether the day may
  move from the phone's (`SHIFTED_FORMS`, T-Bank's CSV — not measured, a named price).

## The key

- **A line's key is its spending's id** (Р-2, `statementLineKeys`): a uuid v3 (`nameUuid` over `md5Hex` — the domain
  imports no `node:crypto`; MD5 here is a name, not a secret) of the person, the statement's account, the day, the
  sign, the amount and the payee as printed, spaces squeezed, and the turn among equal lines. The same line uploaded
  again is the same id, written once. **The person is in it**: two people's like lines of statements with no
  account would be one id, and the spendings' id is one primary key for everyone — the second would vanish silently
  on a conflict. **The form is not**: the same text in a bank's CSV and its PDF is the same line. The reader's
  additions — status, kind, time, posting day — move nothing.
- **The link** (`statementLinkSchema`, stored by MOL-433 on a spending, a trip and a transfer) keeps the key, the day,
  «pending», the form, the amount, the payee and the time: enough to tell another line from it (Г2, Д2), let a hold's
  posting in (Г2б), compare two screenshots' times (Ж2) and write the line of a relinked record as a spending (Д1).

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
- **The windows and the tolerance are measured** (MOL-428): a file meets a record within ± 2 days; a screenshot,
  which shows the posting day, from two days before the record to four after; the amount exactly. A line up to a
  fifth over is a tip, a doubt (А2); one under, down to half, by the same name and on the statement's account, a hold,
  a doubt (В4, Г3). **Not measured, named prices**: a hold posts within 7 days, a late posting by the same name is a
  doubt to 30, a refund looks back 60 days.
- **A record on another account is a doubt, never filtered out** (owner's В-1 «а», against round А6): MOL-428 found 6
  of its 19 misses were card payments the owner had recorded on «Наличные AMD» — filtered, each came back a duplicate,
  ticked. A record on the statement's account is preferred to one on another. **A transfer or an exchange is the
  other way** (Б1а): only from the account its money left — or either unknown — and it settles the line, «не трата»,
  only exactly, on its day, from that very account, on a line calling itself a transfer or an exchange; otherwise a
  doubt (Б1б, Г1, Р-6).
- **The payee's name is the second sign** (`payee-name.ts`, А4): folded across Cyrillic, Armenian and Georgian with
  the sounds banks spell apart — **never `toSearchKey`**, whose tables are frozen under the catalogue's keys (А4б: no
  word of «YEREVAN CITY» meets «Ереван Сити» there). It orders the candidates, and a record whose name meets the payee
  in no word is a doubt (Б4). **One seller** (В3, Г4) is every word of one name in the other, the words of a place
  aside — the cities of the settings folded (`COUNTRY_CITIES`, Р-4), exact under six letters so «SAS» is no «Сад» — and
  one common word is no seller (Н1).
- **One to one by the greatest matching** (А3, Б2, Kuhn's path): what met exactly first, the doubts only for records
  left free.
- **The link decides another line** (Г2, Д1, Д2, Е1, Е2): its own line; another form on the link's day, ± 1 for a form
  whose day moves; never another key of the same file; **a hold's posting within its 7 days, past the window too** —
  the bench's grid hid that a window of 2 days lost postings of days 3–7. A screenshot against a screenshot on one day
  is told by the time (`printed-time.ts`: an hour apart and not the font's 5↔6 is another operation, Ж2…Л1), else a
  doubt. A line nearer the record than its link's is a doubt «пересвязать» (Д1).
- **Refunds** (В3, М1, Н1, Г4): a purchase refunded in the same file is new and not ticked; a refund of a recorded
  spending or trip is «не трата» naming it.
- **A hold with no posting** (Д3, Е4, Ж1): a record made from a «pending» line, on the statement's account, that no line
  met, where the statement covers its day — «убрать трату?» once it runs 7 days past it, ticked only for a bank's file
  with a period in its head; a screenshot is what the person chose to show.
- **The answer is a discriminated union** (Р-9, `StatementLineDecision`): `new` (ticked, a note, a hint),
  `recorded` (the record and the doubt, or none), `not_spending` (the reason and the record that settled it); the holds
  apart (`unposted`). MOL-433 and MOL-435 read one shape and repeat no rule.

## The prices, named

- **The bench's truth is the rule's own feature**: MOL-428's pairs were gathered by «the same sum, the day ± 3» — false
  «recorded» answers are not measured. A doubt is shown, not ticked, so an error costs a tap, never a lost spending.
- **The five unmeasured constants** (7, 30, 60, a fifth, T-Bank's day) are measured by the parsers' tasks on the owner's
  files; a change is a test of its boundary moved.
