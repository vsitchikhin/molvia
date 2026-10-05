---
paths:
  - 'packages/model/src/support/{search-key,synonyms,text}.ts'
  - 'packages/model/src/{entities,contracts}/{item,catalogue}.ts'
  - 'packages/model/tests/support/{search-*,synonyms*,text*,name-identity*}.ts'
  - 'packages/model/tests/entities/item.test.ts'
  - 'packages/model/tests/contracts/catalogue.test.ts'
  - 'backend/src/db/{items,item-embeddings,search-picks,seed}-repository.ts'
  - 'backend/src/db/rekey.ts'
  - 'backend/src/embeddings/**'
  - 'backend/src/usecases/{embed-items,query-meaning}*.ts'
  - 'backend/src/{catalogue-seed,seed-catalogue,seed-catalogue-cli}*.ts'
  - 'backend/src/usecases/{search-catalogue,propose-item}*.ts'
  - 'backend/src/routes/catalogue.ts'
  - 'backend/tests/{search,seed,catalogue}*.ts'
  - 'bin/fetch-model.mjs'
  - 'backend/drizzle/*{catalogue,search}*.sql'
  - 'frontend/src/views/ItemSearchView*'
  - 'frontend/src/components/{CatalogueCombobox,ProposeItemSheet}*'
  - 'frontend/src/composables/useCatalogueSearch*'
  - 'frontend/src/stores/{searchDraft,itemEntry,recentItems}*'
  - 'e2e/item-search.spec.ts'
  - 'packages/model/src/entities/twins.ts'
  - 'packages/model/src/contracts/merge.ts'
  - 'backend/src/db/{merge-repository,trace}.ts'
  - 'backend/src/usecases/merge-twins*.ts'
  - 'backend/src/merge-{command,cli}.ts'
  - 'backend/tests/merge*.ts'
  - 'bin/merge.sh'
---

# Catalogue search, transliteration, the dictionary, the seed

The detail behind the search lines of `CLAUDE.md`: what was measured, what each rule costs,
and why the thresholds stand where they do.

**A code scanned on «Что взяли?» is not a query** (MOL-99): the item found by it is picked with no
query, and the codes the device found items by are kept beside «Часто берёте», not in its rows.
«Предложить товар» takes the codes read from the package; a name already there takes none — the screen
asks about it (MOL-100, В-5). The rules are in `.claude/rules/barcodes.md`, «The item by its code» and «Writing a code».

## How catalogue search works, and why

Measured, not assumed — the numbers below come from a probe against a real database.

- **Transliteration happens in `packages/model`, not in Postgres.** `unaccent` strips
  diacritics; it does **not** turn Cyrillic into Latin, so `moloko` scores exactly 0.000
  against `молоко`. Items carry a `search_key`: the whole name normalised to Latin by a
  pure function in the domain — Latin plus one letter, `ц`, for the reason below. Against that column the same query scores 0.500.
  A custom `unaccent` rules file inside Postgres would buy only this half and cost us
  ownership of the database image — CI can pull a service image but cannot build one.
- **The alphabet folds the forks rather than preserving them.** A transliteration fork is
  one letter with two spellings in common use — `ж` is zh or j, `ц` is ts or c, `х` is kh or
  h, `щ` is shch or sch — and the product plan already named them when it picked the name
  Molvia. `search_key` keeps one spelling per fork and folds the other half of each into it,
  on **both** ends: the name on write and the query on read go through the same function.
  Measured over 46 queries: without the fold four miss the distance threshold outright
  (`jem` against `dzhem` is 3, `Grand Candy` against «Гранд Кенди» is 3), with it none do,
  at a cost of 0.26 extra candidates per query. Folding harder than that — collapsing `ч`
  with `ц`, `ш` with `щ` — wins no query and loses the distinction, so it was rejected.
  **The `к`/`c` fork is closed by position (MOL-11).** Latin `c` is two letters: soft before
  `e`, `i` and the diphthong `ae` — that is `ц` (`cena`, `Caesar`) — and `k` everywhere else
  (`Coca-Cola`, `Picnic`); `ch` is `ч` and is left alone. So `ц` is a letter of its own in the
  key: `ц`, `ծ`, `ց`, `ts` and a soft `c` all become `ц`, a hard `c` becomes `k`, and doubling
  collapses before the decision. «Кока-кола» and `Coca-Cola` are one key where they were 2
  apart, and «кока» finds Coca-Cola before «кола» is typed — before, it was not even a
  candidate; memory could not have closed this. **Only Latin `c` is decided by the next
  letter, never `ц`:** the first version hardened every `c`, and a case ending or the next
  keystroke flipped `ц` — «куриц» stopped being the start of «курицы», «огурцов» fell out of
  the budget. The price of the rule is a Russian word typed with `c` for `ц` in a hard
  position: `otec` and `cukaty` cost an edit, `jajca` left the corpus (45 of 46); `ts`
  spellings are untouched. A Latin word cut right after a `c` — «Nutric» on the way to
  «Nutricia» — is not the start of the finished one, but it is one edit from it, and from four
  letters a start is allowed one: «Nutric» finds «Nutricia» (MOL-47, measured). Only a cut of
  three letters or fewer is lost, which is narrower still. The fold also fires on what the alphabet itself produced, not only on Latin someone
  typed — `тс` becomes `ts` becomes `ц` — which is what makes «счёт» and «щёт» one key, and also
  what reads the `тс` of «Советский» as `ц`. A false merge costs a candidate, a miss costs the
  answer; the trade is deliberate, and it is a trade. **That is why the key is never an
  identity:** «Предложить товар» decides a duplicate by `nameIdentity` — case, spacing,
  invisible characters and the three Armenian spellings «և» / «եւ» / «եվ» only — because there a
  false merge costs the item itself: «Milo» would be answered with «Мыло» (MOL-12). The identity
  is built from the key's own first steps, and a property test holds that one identity is always
  one key: the lookup is by key.
- **Armenian is in the table, not passed through.** The first market is Gyumri and Yerevan,
  so an Armenian label is the norm on the shelf. With the table «Գյումրի», «Гюмри» and
  `Gyumri` all become `giumri`, and an Armenian name is reachable from all three keyboards;
  worst distance across a corpus of sixteen names in three scripts is 1. Two mechanics are
  easy to get wrong: `ու` and `և` are single letters written with two code points and must
  be resolved before the per-character pass, and the aspirated pairs (`պ`/`փ`, `կ`/`ք`,
  `տ`/`թ`) are collapsed deliberately — the same trade as `ш`/`щ`. A letter no table knows
  keeps itself: dropping it would produce an empty key, and `visibleLine` refuses that, so
  the item would become unbuildable inside the server. **What draws nothing is one list,
  `INVISIBLE` in `text.ts`**, that the name's measure and the key both strip: two copies
  drifted twice — the Hangul fillers in MOL-12, U+13441 in MOL-27, each time a valid name
  whose key its own schema refused, a 500. A test walks every code point to hold them equal.
- **Georgian and Serbian are in the tables too (MOL-109)**, since both countries are in the
  settings from 0.2. Georgian has a table of its own, collapsed as the Armenian one is — the
  ejectives with their plain pairs, `ჯ` as `j` — so «ბორჯომი», «Боржоми» and `Borjomi` are one
  key, `borjomi`. Serbian Cyrillic is rows of the Cyrillic table (`ђ`/`џ` `dj`, `ћ` `ch`, `љ` `lj`,
  `њ` `nj`, `ј` `j`), and its Latin meets it: `č` and `ć` are `ch`, `š` `sh`, `ž` `j` — resolved
  after NFD and **before the marks are stripped** (`LATIN_MARKED`), since stripped first `č` was a
  `c` and the fold made it `k`; `đ` has no decomposition and is a row of its own. So «ćevapi»,
  «ћевапи» and «чевапи» are one key, and so are «džem», «џем» and «джем». Only those four marked
  letters: Polish `ś` and Czech `ě` keep what NFD gives. What draws nothing is taken out **before**
  the pairs are read, as `nameIdentity` takes it out before it composes — a zero-width space between
  `c` and `ˇ` gave one identity two keys and «Предложить товар» a second «Čaj» (adversarial А4).
  **The price, pinned in `search-key.test.ts`** (review, remark 3): Serbian `c` is always `ц`, but
  a Latin `c` is decided by the letter after it — `pljeskavica` is `pljeskavika`, «пљескавица»
  `pljeskaviцa` — and `ј` is the `j` of its Latin where Russian `й` is `i` and `я` `ia`: «ајвар» and
  «айвар», «ракија» and «ракия» are one edit apart, found near, not one key. The fold has no
  language to tell a Serbian `c` from an English one, and the tables are frozen. **Serbian Latin
  typed without its marks is far from the label** (adversarial А1, owner's В-4 «а», 04.10.2026): one
  key cannot be both «чевапчичи» and «cevapcici», since `č` is `ч` and a bare `c` at once, and the
  Russian query was chosen — the person is Russian-speaking, a label and Open Food Facts write the
  marks. «cevapcici» and «secer» are found whole by meaning, «cevap» as it is typed not at all, and
  without the model (its first seconds, the phone offline) by nothing. Pinned in `search-key.test.ts`.
- **The tables are frozen; a change reaches the stored keys at the API's start** (MOL-109, В-2).
  So are the rules that fold and decide `c`. The key is stored, so an edit after the first row is
  written makes every accumulated key foreign — silently, with no error and no log line. The key
  is TypeScript and a migration is SQL, so no migration can recompute it: `rekeyItems`
  (`backend/src/db/rekey.ts`) runs after the migrations, rewrites every `items.search_key` that
  differs from `toSearchKey(name)` under a lock against writes, and stops the boot on a failure as a
  migration does. It writes nothing when the tables did not change. **What it cannot bring back** is
  a key whose source is not stored: a remembered pick (`search_picks` keeps the query's key alone)
  and the shops' memory by the text of a line (`store_memory` of kind `text` keeps
  `toSearchKey(line.printed)`, not the line) — both are forgotten under letters that changed, named
  prices; the second costs nothing while receipts are Armenian and a change leaves the Armenian
  table and Cyrillic alone (review, remark 4). **A rollback past a rekeying build is a rename for
  the data** (adversarial А5): the image put back looks a name up by its own tables' key, misses the
  row rewritten, and `createUnlessNamed` may write a twin; the next start of the new build rekeys
  again, and a twin made meanwhile is the nightly merge's (MOL-106) — merged, or named to the owner. Accepted: a
  rollback is rare, a twin is seen, and holding the old key beside the new would be a second column
  for one deploy. MOL-11 and MOL-27 changed the alphabet before any
  key was stored; MOL-109 is the first change the recompute carried. Same standing as
  `MINOR_EXPONENT`. Retuning the thresholds is a different thing and does not touch the alphabet.
- **Candidates come from `word_similarity`, never `similarity`.** `similarity` compares
  whole strings, so a long name dilutes the match: «малако» scored 0.158 against
  «Молоко «Ашхар»» and ranked «Марианна» above it. `word_similarity` compares against the
  best-matching part: 1.000 on a correct spelling, 0.600 on one swapped vowel — but only
  0.167 on two, which is the corpus case «малако», so the candidate threshold is 0.15 and
  not 0.3 (measured in MOL-10). Two traps sit under the operator. **Only `search_key %> $1`
  reaches the GIN index** — `$1 %> search_key`, `search_key <% $1` and
  `word_similarity($1, search_key) > t` mean the same and all fall back to a Seq Scan, which
  a test's handful of rows cannot show. And **the threshold of `%>` is a setting of the
  connection** (`pg_trgm.word_similarity_threshold`, default 0.6) that `set_limit()` does not
  touch, so it is set locally inside the query's transaction and never leaks across the pool.
- **Ranking is by minimum Levenshtein across the words**, via `fuzzystrmatch`. Two swapped
  vowels in a six-letter word defeat every trigram measure; edit distance puts «малако» at
  2 from `moloko` with the nearest wrong answer at 3. Across words, not the first word:
  «чанах» is a brand, and matching only the head noun missed it. **Word against word**, never
  the whole query against a name's words: that put «Հաց Կաթ» and `Hats Kat` at distance 4
  while their keys are identical character for character — an artefact of the metric, not of
  the transliteration. How the per-word distances then combine across a multi-word query is
  MOL-10's to settle, and three traps are already known. Taking the worst query word loses an
  item to a _correct_ extra word: «молоко ашхар пастеризованное» scores 11 against «Молоко
  Ашхар 3.2%», and the extra word is the one printed on the package. Keeping every word lets
  a query of nothing but digits match every name that carries them. And **dropping words
  shorter than two characters is not the cure** — those words are the packaging size: it
  makes «Молоко 1 л» and «Молоко 2 л» identical for ranking while «Молоко 1л» written
  without the space stays distinct, so two shops' labels for one product rank by different
  rules. MOL-10 took **the third way**, and its review made it hold on both sides. A word
  **grounds** a match only if it has two characters, no digit and is not a unit — «32», «1л»,
  «500г» are sizes, not grounds, and so are «шт», «мл», «см», «հատ», «pcs» (MOL-48): the length
  alone let `sht` through, two edits from «сыр», and every item sold by the piece answered it.
  The units are a list in natural spelling keyed by `toSearchKey` itself, so nothing stored
  depends on it and a missing unit is a line; only the forms written after a number — «рулона»,
  «пакетиков», «таблеток», never «таблетки», which begins the goods' own name. A query word right
  after a number that starts a unit is read as that unit against every name — «батарейки 4 шту»
  on its way to «штук», or the item vanished on every keystroke until the unit was typed whole.
  One that is a slip from a unit — an edit, or two letters swapped: «кефир 500 мд», «500 лм» — is
  that unit only against a name that prints it after the same number — apart or together, «500 мл»
  or «500мл» — and elsewhere the word it spells: read as a size everywhere, «2 сом замороженный» let
  «Котлеты … замороженные» in beside the fish, and against any «см» it let in «Пицца … 30 см» — the
  number gives a slip away. Either way only while another word still grounds the query, because in
  «2 суп» or «2 кап» the word is the goods. What it costs, named: «чай пакетики» misses the tea, its
  word measured as a word (the owner's decision); a right unit no longer carries a typo through the
  mean — «шакалат 100 гр» is lost where «шакалат голд» is found; a real word that shares a unit's
  key goes with it — «7 Up» is `7 up`, which «7 ап» no longer reaches; a slip reaches only the unit
  it slipped from, beside the number typed — «кефир 500 мд» loses «Кефир 1 л», which «кефир 500 мл»
  finds, and «кефир 1 мд» loses «Кефир 1000 мл»; a small count that matches the label passes for a
  slip — «1 суп доширак» brings «Doshirak лапша … 1 уп» in at the soup's distance, since only the
  meaning tells the goods from a mistyped unit; the start of a brand after a number is taken for a
  unit being typed — on «сыр 125 ка» (`ka` starts `kapsul`) every cheese comes one edit behind the
  Camembert, for one keystroke; and «тш» for «шт» is `цh` in the key, no transposition of `sht`, and
  two edits from it.
  A grounding word is measured against the grounding words of the name only, never
  against «л» or «1», which every two-letter word is within two edits of. Grounding words fold by their **mean**,
  rounded up; short words by their **worst**, at most one edit, so each has to find its pair
  and «1 л» against «2 л» costs one. A query with no grounding word but with letters — «M&M's» is
  `m m s`, «m&m» is what the screen sends halfway — finds names in which every one of its words
  is found exactly; digits alone find nothing. The screen searches while the
  person types, so **the last word also matches the start of a name word** — exactly up to
  three letters, one edit from four, two from seven; any slack on two letters matches every
  word there is. The price is that a finished word matches longer ones too: «сыр» finds
  «Сырок», «чай» finds «Чайник» — below the exact match, never above it. Measured on the MOL-10 corpus: the right item first in 20 of 20, junk queries
  find nothing. The correct extra word is still lost (4 against a budget of 2) — chosen
  knowingly, and pinned by a test. The distance is exact `levenshtein` on words cut to 255
  characters: past that it raises an error, and `levenshtein_less_equal` is no substitute,
  because its capped answer distorts the mean. Limits MOL-14 measured and left in place: the
  budget is absolute, so a short wrong word passes where a long right one does not —
  «молоко ашхар кефир» finds the milk, and «кока кола 0,5 л» even finds «Вода Джермук 0.5 л»,
  every word wrong by two; the two thresholds disagree — «ыср» is two edits from «сыр» yet
  shares no trigram with it, so it never becomes a candidate; and a name of punctuation only
  («???») has a key but no query reaches it. MOL-47 measured all of them again on the seed
  (28.09.2026) and both still stand — there «ыср» is a far answer of «Икра красная» — and two
  more with them: «Сааар» folds its doubling to `sar`, so «Сардельки», «Сардины» and «Сыр» rank
  above «Сахар»; «Cheesecake» finds nothing, since no alphabet makes «чиз» of `cheese` — only the
  dictionary could. Left for the real input MOL-47 waits for. A name without a size ranks level
  with a wrong size — unknown is not worse than wrong, which is likely right.
- **The answer says how near it is (MOL-46), and nothing is dropped for it.** The budget is
  absolute: `pelmeni` is two edits from `zeleni` of «Чай зелёный» exactly as `malako` is from
  `moloko`. Six rules on the letters were measured against the whole corpus and 241 two-edit
  typos, and each bought false hits with typos: vowels by sound lost 38 of 40 slips of the
  finger, the first letter every typo touching it, keyboard neighbours explained «овощи» as
  well, and the best of them emptied ten answers for 28 typos — the trade this search refuses.
  So `GET /catalogue/search` answers `near` beside the items: **true when some row has every
  word within one edit (`ACCEPTED_DISTANCE - 1`, not a number of its own), or the person took it
  on this query before, or it is their own word for it** — their choice says more than a typo
  metric, as in the lift. **Every word, and the words alone** (adversarial review А, Б): by the
  mean one exact word beside a wrong one made the row near — «мыло детское» over «Масло
  детское», even three edits over two exact words — and a size in another number made a one-edit
  typo far, «кефр 1 л» over «Кефир 0,5 л», which the ranking already calls the kefir in another
  size. A word found by a synonym counts as exact. **The answer is near by the rows it hands out**
  (owner's decision on review): the order is by the mean and the size, nearness by the worst word,
  so a near row can rank below twenty far ones — and then the screen says «не нашли» over what it
  shows rather than «нашли» over a list with nothing near in it. An empty answer is not near. A far answer is drawn as rows headed «Похоже по написанию» with «не нашли» and
  «Предложить товар» **under them**, in place of the quiet «Нет нужного?» — above them, the block
  moved every row under the finger as the answer flipped near and far while a word was typed
  (owner's decision on review). It is read out as «не нашли» too, and it is a miss for the
  person's own word as an empty one is. **An answer from a server older than the field is read as
  near**, what every answer was before it existed — so «an empty answer is not near» is said of
  this server, and the phone tells a miss by the rows as well (review Р-5). On MOL-14's shelf it is exactly the class: «овощи», «специи», eight of
  twelve everyday words that share only letters, «яблоки» → «яблочный» of the edits of the
  ending, and five things meant, still first — two brands spelt two edits off («хаггис», «лейс»)
  and three queries with a word in another form than the label's («собачий корм», «средство для
  полов», «таблетки для посудомойки»). The price, named: a word two edits from its label's —
  a typo, «малако», or another form, «полов» for «пола» — reads «не нашли» under the item it
  found, first in the list; and a wrong word within one edit — «водка» → «Вода» — stays a find, since nothing
  tells it from a typo.
- **Every candidate is ranked; there is no ceiling.** Any cut before ranking is wrong one
  way or another. By similarity it drops the typo the low threshold exists for — «малако»
  scores 0.429 against any «Малина» and 0.167 against the milk, and two hundred raspberries
  pushed it out. Unordered it drops by row age, that is the newest items, the ones «Предложить
  товар» just added. `order by id` is worse still: the planner walks the primary key and
  filters every row. The cost is bounded by the catalogue, by at most sixteen words of the
  dictionary (MOL-45) and by taking at most twelve words of a query: a two-letter query over
  20 000 names answers in about 370 ms.
- **What the user picked is remembered.** A query and the item that went into a trip after
  it are stored under the query's search key, and next time that item comes first. No model,
  no image change, and it compounds from the first day — it is also the labelled set anything
  smarter would later need. Four rules hold it (MOL-11). **Personal:** only the asker's own
  picks count; a sum across people would be popularity in the results, indistinguishable from
  the paid placement forbidden below. **Above distance, but only among what was found:** a
  pick outranks a closer spelling and never lets in what the search did not accept — with one
  written exception, the person's own word, below.
  **The same query** means every word but the last equal, one last word the start of the
  other from three characters, and the word being typed still the start of a word of the item
  taken — the screen searches while typing, so the pick was made on «мол» and the next search
  may fire on «моло», but «молоток» typed in full is another word and lifts nothing.
  **Latest first**, then most frequent, summed over the keys that match. Memory belongs to
  the query: a new brand taken on «молоко» is on top of «молоко» from the next trip, but one
  found and taken by its own name («марианна») does not move «молоко» at all. It is written when the item is
  added to a trip, not on a tap — a tap the sheet cancels is a changed mind. It never forgets;
  if a stale pick starts to hurt, decay is a task with a number, not a guess.
- **What people call a thing the shelf writes otherwise is a dictionary (MOL-45).** «картошка» for
  «Картофель», «орешки» for «Арахис»: no spelling rule and no threshold reaches them.
  `synonymKeys` in `packages/model` expands a word of the query, looked up by its **exact** key,
  into the words it also stands for — a group of the same thing both ways, a wider word into
  narrower ones one way («арахис» never finds «Фисташки»). Only the query is expanded and nothing
  is stored, so **the dictionary is not frozen**: a word added is a commit, not a migration. **A
  synonym counts only as the word of the kind, at no cost** — the first word of a name that is not
  an adjective, `kindKey` (owner's decisions on review): «Вода Джермук», «Скумбрия х/к», «Молодой
  картофель», «Армянский лаваш». Anywhere in the name it found «Мицеллярная вода» for «минералка»,
  the tuna of a cat food for «рыба», a pizza for «сыр»; the first word alone missed every name
  with an adjective in front, which is how people write it. An adjective is read off the name by
  its ending (`ADJECTIVE_WORD`, one pattern for the domain and for Postgres), not off the key,
  which collapses «солёный» to `soleni`, the ending of «огурцы»; nouns with that ending —
  «Пирожное», «Мороженое», «Жаркое» — are listed apart (`NOUN_WORD`), or «Пирожное Картошка» was a
  potato. The words of a name are split by one written-out class, `WORD_BREAK` — every Unicode
  `White_Space` — in both places: `\s` of JavaScript takes the no-break space and `\s` of Postgres
  does not, and a name pasted with one was found offline and missed online; a test walks every
  code point, as for `INVISIBLE`. A narrower target that is itself an adjective — «минеральная»,
  «газированная» — is never the kind, and counts as any word of the name; an adjective of a group
  of the same thing — «гречневая», «сгущённое» — counts anywhere in a name whose kind is one of its
  own, written beside it in the dictionary (`PAIRED`): «Крупа гречневая» and «Гречневая крупа»,
  «Молоко цельное сгущённое» and «Сгущённое молоко» — a shelf writes both orders — and never
  «Лапша гречневая» or «Гречневая лапша» (owner's decisions on review; the price: a kind not
  written there, «Ядрица гречневая», is found by letters only). «вода» is no longer a target of
  «минералка»: the water is in «Вода туалетная» first word and all. The prices: «Вода Джермук»
  without the word is not a «минералка», a name with its brand first («Barilla спагетти») is found
  only by its own word, and «Фарш рыбный» is meat to «мясо». Its candidates come from
  `like 'word%'` and `like '% word%'` — the start of a word — on the same GIN index, not from
  `%>`: at 0.15 each of the eight fish of «рыба» brought in half of 20 000 names and the query took six
  seconds. **The typed spelling is not measured only for a word whose synonym brought the name
  in** — «лори» brings «Рис», and `sir` is two edits from `ris`; but «хаггис» of «памперсы хаггис»
  is still measured against the «Huggies» that «подгузники» brought. **A word found by its synonym
  stays out of the mean** of MOL-10: free, it lent its budget to the next word, and «хлеб
  барадинский» found «Лаваш армянский». **At most sixteen words** of the dictionary per query
  (`MAX_SYNONYMS`): twelve wide words expanded into fifty and held a connection for a second and a
  half. **The price, measured:** over 20 000 names built of the very words the dictionary expands
  into, twelve wide words take about 0.47 s against 0.28 s on master, one word with synonyms
  («мясо», «сыр») 0.2–0.3 s against 0.19, and the same word after a number («мясо 1 кг») 0.2 s
  against 0.11; the cost is ranking the names that carry the synonyms, not finding them, so a
  smaller cap wins little. **The check for a slipped unit (MOL-48) runs only after a number, and
  once** (review Ш): joined to the thousands of names a synonym brings, it took «мясо» to 1.4 s
  while having nothing to look for — and without it «мо» answers in 0.11 s where master takes 0.17.
  **And the search runs without JIT**, set locally beside the threshold (review Щ): twelve words
  with sizes — a shopping list pasted in — are estimated at a million, and Postgres spent 2.2 s
  compiling a statement that answers in 0.4 s. **A target is a kind of product, never a brand**:
  expanding into a maker would be a place in the results handed out by hand; the other way round
  is fine («памперсы» → «подгузники» of every maker), and «белизна» is let in as the common name
  of a kind. **No categories** — «овощи», «специи», «сладости» name a shelf, and reaching kefir
  from «молочка» is the search by meaning's (MOL-105, below). The forms people type are written out —
  nominative, genitive and accusative, singular and plural; a form left out is a miss. Measured on
  MOL-14's corpus: the six misses found, «макароны» finds the spaghetti the shelf carries, nothing
  else moved; the words come from the owner's expense log plus the usual pairs of a grocery. The
  prices, named: a typo in the synonym itself is not expanded, and a name with no word of its kind
  («Coca-Cola 1 л» for «газировка») stays out of reach. Offline, «Часто берёте» reads the
  dictionary by the same rules — the word of the kind, a pair for every word.
- **And the person's own word (MOL-45).** A query the server found nothing for — or nothing near
  (MOL-46) — followed on
  the same screen by a pick found by another word, is learnt with the purchase —
  `search_picks.admits` — and from then on **exactly that query** lets the item in: the one
  written exception to «never lets in what the search did not accept», and personal for the
  reason memory is. **It stands below a find of the very words and a pick, above a typo in a
  word** (owner's decisions on review): «кефир» learnt as the milk taken in its place stops
  standing above the kefir the day there is one, in any size — «кефир 1 л» against «0,5 л» is the
  same words — and the potato learnt for «овощи» stays above the flour the absolute budget finds
  there (MOL-46): the words a person teaches are the ones the search misses. The price, named: a
  kefir found only through a typo of the query («кефра») stays below the learnt milk. **Only the first sheet opened after a miss may take it
  along**, and every pick uses it up: a milk looked at and put back does not make the bread
  taken next the meaning of «кефир». Not when one query starts the other — «сыр» after «сыр
  косичка» is the same query cut short, and «Кефир» is «кефир » — compared as typed _or_ by the
  key, since each alone misses: «дет» is not the start of `deцkoe`, and «сгущенка» is not the
  start of «сгущёнка варёная» as typed. The server skips a missed query whose key starts the found
  one or the other way round too. Erasing back keeps the word by the same rule; a pick from the
  recent items or from «Предложить
  товар» learns nothing. It is not checked against the search: a real substitution — no kefir,
  milk taken — is learnt as it is, and costs its owner one row on that exact query. A dictionary
  grown from everyone's words is 0.2's, and would need three people, as any aggregate does.

**The thresholds — `word_similarity` > 0.15, edit distance <= 2 — were measured and kept
(MOL-14).** The set: the owner's own words from the expense log («кола», «дошик», «туалетка», 73
queries and 19 for what the shelf does not carry) against 64 names written for the shelf of
«Ереван Сити», plus the typo corpus of MOL-5, since the log holds no typos. At the kept point 62
of 73 have what they meant first and alone, 6 more share the first place with an item they did
not mean — a tie the row's uuid broke: «мол» with «Кофе … молотый», «туалетка» with the
litter's «туалета»; 45 of 45 typos land in the top three; 17 of 19 absent words find nothing.
**Since MOL-112, at one distance the shorter name goes first** (owner's decision В-5, and its review):
the more of a name the query covers, the nearer — and with a common name beside its varieties,
«Молоко» and «Молоко 3,2%», that is every common word, not six of 73. The order at one distance is
**found by the word before found by a synonym** («маслины» keeps «Маслины» above «Оливки»), **a
whole word before the exact start of a longer one** («печень» is the liver, not «Печенье»: MOL-10's
«below the exact match, never above it», which the length alone broke — review И; a start one edit
off is not marked, or «туалетка» put the litter above the paper), **more fats typed with «%» that the
name carries whole** («кефир 2,5% 1 л» names «Кефир 2,5%» — review З; whole, or «3,5%» scored on the
«3» of «Молоко 3,2%» and a fat the list lacks lost the common name it should give — review Н; a bare
number may be a size, and counted it would hand «молоко 1 л» back to «Молоко 1,5%»), **then the
shorter name, then the similarity**, then the
uuid. The length ranks before the similarity because a size in the query otherwise handed the first
row to a variety: «молоко 1 л» put «Молоко 1,5%» first by the «1» of its fat, «рис 1 кг» put «Рис
круглозёрный» first by the «к» of `kg` (adversarial А, Б) — the purchase and the rating went to the
variety. The fat is read off the query as typed (`percentNumbers`) and matched against the name as
written, since the key drops the sign and splits the number at its comma; its digits are taken out of
the distance, or the «1» of «молоко 1%» paired with «Молоко 1,5%» at no cost before the rule of fats
was asked (review Н′). By value, not by place: a size that shares a digit with the fat leaves with
it — «кефир 1% 1 л» is judged by «л» alone — which loses nothing measured, since a neighbour of the
same fat has the same digits and one of another fat is told apart by the rule of fats (review С-12).
A space before «%» is `WORD_BREAK` on both sides — `\s` of JavaScript takes
the no-break space a name pasted from a shop's site carries, `[[:space:]]` of Postgres does not
(review О) — and as many fats are looked at as words (review П). On the shelf of MOL-14 all six
ties go to the item meant. The prices, named: a short wrong name beside a long right one — «лейс»
puts «Рис» above the chips; «малако» finds «Молоко» where the similarity chose «Молоко
миндальное»; among the kinds a wide word leads to, the shortest — «мясо» is «Фарш» first; names of
one key length are still the uuid's where the similarity is equal too — «Молоко 1,5%» and «3,2%», and
on the seed «кур» is «Курица» or «Курага»; «молоко 1», typed on the way to «1 л», still gives
«Молоко 1,5%», whose «1» is an exact pair; a fat typed without «%» is read as a size — «масло 72,5»
and «молоко 3,2» still find their variety, both digits paired at no cost, but a size beside them
takes it away; and without «%» a short word may pair twice with one of the name's — «творог 5,5» is
«Творог 5%» at no cost, by the distance (with the sign, «творог 5,5%» gives «Творог», the digits of a
fat being out of the distance — review Р).
**No point of the grid did better on both halves.** A threshold of 0.3 empties every false hit
but drops «Молоко Ашхар» from «малако» — the case 0.15 exists for; a budget of 1 empties them
too and loses five typos and «собачий корм»; a budget of 3 wins one query and brings six false
hits. The slack on an unfinished word (MOL-10) moves five or six whole answers either way but
never a first row, so the grid could not tell its three settings apart — kept as it is, not
chosen. What no threshold reaches went to tasks with numbers: **synonyms** — «картошка» against
«Картофель», 6 of 73, one of them («мясо») found by letters only — MOL-45 closed them with the
dictionary above, which puts 67 of 73 first and alone, and the shorter name of MOL-112 the other six
— less the two brands of В-6 below, «дошик» and «принглс»; **the absolute
budget** — «овощи» finds «Мука … высший сорт», «специи» «Соевый соус», «пельмени» «Чай зелёный»,
3 of 25 — MOL-46 made them a far answer rather than a find; **a unit word grounding a match** — «сыр» is two edits from `sht` of «4 шт» —
closed by MOL-48 for the units it lists, which took six of the ten items «сыр» found. Weighting
vowel edits below consonant ones was tried against the budget and refuted:
`ovoshi`/`vishi` share every consonant, while the right `canah`/«Чанах» and `grecka`/«Гречка»
differ by two. **The owner's absent words flatter the search:** of fifty everyday purchases the
shelf does not carry, 25 find something since MOL-45 — «макароны» finds the spaghetti through
the dictionary, the shelf carrying it under another name — and the other 24 are two outcomes. In 12 the first row carries
the word's root — a taste or a property printed on another item. Six of those are found exactly
or by the start of a word («сметана» is in the chips' name), which no threshold can remove — a
question for the screen, which MOL-23 answered: «Нет нужного? Предложить товар» stands under every
answer. The other six are an edit of the ending inside the budget («яблоки» →
«яблочный», gone at a budget of 1); the one two edits away, «яблоки», is a far answer since
MOL-46. The remaining 12 share nothing but letters — the absolute
budget («водка» → «Вода», «сыр» → «Сок»); eight of them are a far answer since MOL-46, the four
within one edit are not; the unit word that added to them is gone (MOL-48).
`REMEMBERED_PREFIX` was measured by typing letter by letter: a pick lifts its item on the next
letter 18 times at 2, 9 at 3, 5 at 4. It harms 5 times at 2 — where two of the owner's words
share two letters, a pick for Coca-Cola on «ко» puts it above «Колбаса» on «кол», one for
«Креветки» on «кр» above «Крекеры» on «кре», and each the other way round — and once at 3 and at
4, whatever the prefix: the owner's «кол» is a query of its own, for the cola, and a sausage
picked on «кол» while typing «колбаса» takes its first row through the equal key. That is the
price of memory belonging to the query — one short word serving two items. 3 stays, and real
picks measure it again (MOL-47). The corpus pins every answer whole — the shelf, those fifty
words, Latin and Cyrillic brand spellings, Armenian labels — so a change of either threshold
shows what it moves.

## By meaning (MOL-105)

- **What it answers.** A word that names a shelf — «молочка», «овощи», «спиртное», «для кошки» —
  shares no letters with what the shelf holds: the dictionary keeps no categories (MOL-45), and the
  absolute budget made those words a far answer, «Мука высший сорт» first under «овощи» (MOL-46).
  Every name has a vector of a multilingual model, so has the query, and the names nearest it in
  meaning are **added** to what the letters found. Typos and transliteration stay the letters':
  the model is no better at them, and its own sense of spelling is the noise below.
- **The model** (owner's decisions В-1, В-2 of 02.10.2026): EmbeddingGemma-300m, quantised to four
  bits, resident in the API — `onnxruntime-node` and the tokenizer of `@huggingface/tokenizers`,
  not transformers.js, whose `sharp` and runtime the API does not need. Its revision and the
  sha256 of every file are pinned in `backend/src/embeddings/model.json`; `make model` puts it into
  `.models/`, shared by the copies, CI caches it, the image carries it. Measured on the seed against
  e5-small and granite-311m, at the same number of false finds: the first row of the shelf for 59 %
  of Russian shelf words, against 36 % and 18 %; on the VPS 45 ms a query at the median, 70 at p95,
  two threads, some 460 MB (`.scratch/tasks/selftests/MOL-105-measure.md`). Its prompts are
  retrieval's — `task: search result | query:` and `title: none | text:`; those of clustering were
  worse. **Its terms are Gemma's**, not an open licence: the notice they ask a copy to carry is
  written beside the files. **onnxruntime 1.30 carries Microsoft's telemetry**, switched off in the
  code before the library loads and in the image's environment (`privacy.md`).
- **An addition, never a condition.** While it loads, without its files, failed, or slower than
  150 ms for a query, the search answers by the letters as it always did; end-to-end runs without
  it (`EMBEDDINGS=off`) to prove that. A query that missed the wait is still computed and kept:
  typed letter by letter, the next cut finds it ready. The query goes to the model as typed, lower
  case, at most a hundred characters; a thousand are remembered.
- **One writer** of `item_embeddings`: the API's minute timer, nudged by «Предложить товар» and by
  the model's load. Nothing that writes an item waits for the model or fails with it — a proposal is
  found by its letters at once and by its meaning seconds later. A vector carries its model and
  revision, and one of another model is never read and is written again. One row per item, HNSW by
  cosine on half precision; the query asks the index for sixty neighbours, and `hnsw.ef_search` is
  set as long, locally beside the threshold, or the index answers fewer.
  **Measured on 20 000 names** (the seed with thirty-four makers each, real vectors, a Mac): the
  meaning adds 2–8 ms to the statement — «мо» 52 ms against 55, «мясо», the heaviest, 141 against
  146, «бытовая химия» 22 against 30; the vector of a query not seen before is some 20 ms there and
  45 on the VPS, and typing letter by letter reads it from the cache. The budget — not to double a
  two-letter query — holds with room to spare.
- **Where a name found by meaning stands** (owner's decision В-3): after everything within one edit
  by the mean, before two edits — `MEANING_DISTANCE`, the nearer by meaning first; so nothing the
  letters found within one edit moves, and an answer with such a name is near. «молоко» keeps every
  milk above the kefir; «овощи» puts the carrot above the flour. **A name found both ways takes the
  nearer place**: «собачий корм» finds the dog food two edits away by its letters and close by its
  meaning, and left at two it stood under the treat the meaning alone found — so «собачий корм» and
  «корм собакам» are near now, MOL-46's price taken back. The person's own word keeps its rank; a
  pick lifts a name found by meaning as any found name (MOL-11) — and lets in none the meaning did
  not reach.
- **The thresholds were measured** on the seed's thirty shelves — 84 shelf words in Russian,
  Armenian, Georgian and Serbian, 25 things the seed does not carry, and every cut of a shelf word
  typed letter by letter. **Similarity 0.40**: 0.38 won seven points of first rows and lost to the
  model's sense of spelling inside the search — «малако» found «Малина» at 0.381 above the milk,
  «кружка» the dried apricot. **From four letters** (`MEANING_MIN_LETTERS`): below, a cut finds
  nearly two names by meaning that are not of its shelf. `search-meaning.integration.test.ts` pins
  the shelf words, the owner's words of `seed-words.ts` — the first row the letters gave, unmoved —
  and the things that must find nothing near.
- **The prices, named.** A word still being typed finds by its spelling: «молоч» on its way to
  «молочка» shows «Мука» and «Мочалка» above the milk two edits away, for a keystroke. «молочка»
  reaches the milks and not the kefir or the curd — the name alone goes into the vector (В-4), and
  the kefir stays below the threshold; a section of the seed as data would be a task of its own.
  **Armenian and Georgian shelf words find the wrong thing, near** — the model reads them by their
  spelling: «կաթնամթերք» is «Матнакаш», «ձուկ» «Лук-порей», «ბოსტნეული» «Бастурма», and Serbian
  «meso» «Пакеты мусорные»; others find nothing. Since MOL-109 the letters of Georgian and Serbian
  answer too, as wrong: «ხილი» is `hili`, «Хлеб белый» two edits away, and «piće» `piche`, the start
  of «Печенье». Armenian names are still found by their letters
  through the alphabet above. Russian words of a shelf with no word of its kind in the names find
  nothing — «бытовая химия», «гигиена», «приправы». Eight words of the corpus have their nearest
  name within 0.006 of the threshold, and five of them answer otherwise on x86 — CI and production —
  than on a Mac's ARM: the model's arithmetic differs in its last digits, so «выпивка» finds «Водка»
  in production and nothing on a Mac. Those carry both answers seen. All of it is pinned
  word by word — `SHELF_WORDS` and `SEED_ABSENT` of the corpus, `search-meaning.integration.test.ts`.
- **The vectors are also the ground the merging of duplicates stands on** (MOL-106): two names close
  by spelling and by meaning, with every number equal.

## How the catalogue grows

- **The seed carries the items' Armenian names and customs headings too** (MOL-126,
  `catalogue-seed-nodes.ts`): what a receipt line is matched by, written to `item_names` and `item_hs`
  for the item a seed line ends at, a twin given none. **They are not the person's search**, which
  reads `items.name` alone: a receipt's line is matched by `createLineMatcher` (`.claude/rules/receipts.md`).

- **The catalogue grows two ways: «Предложить товар» and the seed (MOL-112).** MOL-12 decided «no
  seed» and the owner reversed it on 26.09.2026: with an empty catalogue every trip began by
  typing the shelf in — 3–4 new words a trip in the owner's own log, 5–8 at the level of a brand
  and a size — and a proposal needs a connection, so at a shelf with no signal a new item could
  not be made at all. The seed is `backend/src/catalogue-seed.ts`: some six hundred common names,
  the kind first, a variety only where the shelf tells it by a number and the common name beside
  it, no brands, no categories, each with the unit its price is compared by. **Rating «Молоко»
  means milk here in general** (owner's decision В-1); a brand is «Молоко Марианна», proposed by
  hand. `dist/seed-catalogue.js` (`make seed` in a copy) writes it through `createUnlessNamed` with
  no author, in one transaction: a dry run unless `--yes` — the real run, rolled back, as `forget`'s
  is — a second run adds nothing, and a name already there stays as it is, its unit and author
  included, the ones whose unit differs printed. **It only adds**: a line removed or renamed stays
  in every database it reached, with what was bought and rated under it, so the list grows by
  commits and a line is added with care. It is not a migration, since a migration is frozen once
  merged and the key is computed in TypeScript. The seed never stays in the `_test` or `_e2e`
  databases, where it would move the corpora; `seed-search.integration.test.ts` loads it and pins
  the owner's words against it. **A brand people name a kind by leads to the kind** through the
  dictionary — «фанта» to «Лимонад», «дошик» to «Лапша» (owner's decision В-6) — so the owner's
  words find something from the first trip. A brand item spelled as the word is typed stays above
  the kind: both at no cost, and at one distance what the typed word found ranks before what a
  synonym found (`by_synonym`) — not the similarity, which ranks after the length (review С-8).
  **The prices, named:** one spelled otherwise — «Doshirak», «Pringles», an edit or two from
  «дошик», «принглс» — stands under the kind until it is taken once, and memory lifts it from then
  on (MOL-11); and a brand leads to the word of the kind, among whose names the shortest goes
  first — «дошик» is «Лапша» by the kilo before «Лапша быстрого приготовления», «несквик» «Какао»
  before the instant one (review Л). MOL-112 first kept
  brands out on the claim that a synonym row ties with an exact one; the order says otherwise
  (adversarial Д). **The seed is not the answer offline**:
  with no connection «Что взяли?» searches only the recent items, so a seed item not yet taken is
  as far out of reach there as one that does not exist (adversarial Ж) — «Предложить товар» offline
  is В-4's, to come back to on MOL-38. **A line whose key is there under another spelling is not
  written**: `nameIdentity` knows case and spacing, the key also `ё`, a decimal point and the
  scripts, so the person's «Мед», «Молоко 3.2%» or «Լավաշ» would have got the seed's twin beside it,
  one the search cannot tell apart — the report names each pair instead (adversarial В). The key is
  still no identity: another thing with the same key is left out too — «Мыло» beside somebody's
  «Milo» — and is proposed by hand, since «Предложить товар» compares names (review К, С-9). A line
  left out costs a proposal; a twin written would be there for good, since the seed only adds.

## The merge of twins (MOL-106)

The owner's decision of 26.09.2026: strangers proposing items make twins — «Молоко 3.2%» beside
«Молоко 3,2%», «Малоко» beside «Молоко», «Yerevan City» beside «Ереван Сити» — and a twin splits the
ratings and prices of one thing in two, so «Что брать» has under three people on each half and shows
neither. The night merges them by itself; **a false merge is worse than a missed one**, since it pours
the ratings of two things into one. Places joined from MOL-50 on 02.10.2026: one journal, one undo, one
report.

- **What merges by itself** (`twinVerdict`): one kind, one unit a price is compared by, **every size
  the same with its unit** — «3.2%» and «3,2%» are one, «1 л» and «2 л», «С0» and «С1», «1 кг» and
  «1000 г» are not (`nameParts`: the number by its value, the unit from `TWIN_UNITS` by its spelling in
  lower case — **never by `toSearchKey`**, which folds «мм» into «м», «км» into «см» and «pc» into a
  pack, and let «Лента 50 мм» merge into «Лента 50 м» at 0.957, adversarial А2; a test holds that no
  spelling stands for two units, and a unit missing is a word, so the pair is a candidate, never a
  merge) — **the same scripts** (review №6: held by the code, not by the model), **the same number of words,
  each within one edit, two in the name** (`twinSpelling`: matched one to one in any order, «Чанах сыр» is
  «Сыр чанах»; a word under four letters must be the same — «SAS» and «SOS» are two shops), **and the
  names' vectors at least 0.90 apart by cosine**. A word more is a brand, never a twin: «Сыр чанах
  Ашхар», «Молоко Марианна» (MOL-112, В-1) — not even a candidate, or every brand would stand in the list
  beside its kind.
- **Measured on the seed** (`.scratch/tasks/status/MOL-106-measure.md`, the bench beside it): of its
  178 000 pairs none merges; the nearest one edit apart is «Курица» and «Корица» at 0.856; two edits in a
  word let in «Хлеб» and «Хлебцы» at 0.937, so a word takes one. Taken: a fat with a comma or a point
  (7 of 7), «ё» (32 of 33), the order of words (207 of 222), half of the typos. 0.88 also had no false
  merge, but «Курица» stood 0.024 from it. `merge-corpus.integration.test.ts` pins it end to end on the
  real model, with pairs well clear of the threshold — the model's last digits differ on x86 (MOL-105).
- **The model does not read across scripts.** «Moloko» against «Молоко» is 0.69 at the median, «Mylo»
  against «Мыло» 0.47 — as far as «Milo» from «Мыло», 0.48: a transliteration and a homograph look alike
  to it — and its highest, «Bulochki dlya burgerov», stands at 0.902, past the threshold. So **a pair
  in two sets of scripts is always a candidate, never a merge, by the code** (`sameScripts` of
  `twinSpelling`), whatever a model or a re-measure says; the search key is no ground of the merge (it is
  no identity, MOL-12). The price: «Сметанa» with a Latin «a» is named, not merged. A unit after a number
  is no script of the name: «Молоко 1 l» merges with «Молоко 1 л». For places this is the price the owner chose with В-1:
  «Yerevan City» is 0.818 from «Ереван Сити» and is named, not merged; a double space, a hyphen or «ё»
  inside merge by themselves. **A place's name is a proper name, and merges by itself only with no edit
  at all** (`properName`, adversarial Ж1): one letter apart is another shop, and the model reads a
  proper name by its letters — «Маркет Ширак» and «Маркет Шираз» at 0.942, «Магнит» and «Магнат» at
  0.919, both in Gyumri. Every place the measure merged by itself was no edit apart, so nothing is lost;
  a typo of a shop's name is a candidate. `merge-corpus.integration.test.ts` pins both on the model.
- **A candidate** (named to the owner, never merged): the same sizes and words, two edits a word at
  most, and the meaning at 0.80 or one key; a pair that would merge but for its unit or for more than
  twenty codes together. **Named once, and only once printed** (`catalogue_merge_candidates`): a morning
  prints ten and marks those, the rest come by name on the mornings after — marked all at once, the
  eleventh was never named at all (review №2). A candidate with a side merged that same night waits for
  the next, where it meets the survivor: its command would be refused (adversarial А8). On the seed alone
  the first nights name some twenty («Курица ~ Корица»), then none.
- **The older survives** (`created_at`, the lower id on a tie), as places did in `0007` and `0010`: on
  production the seed is older than anything a person types. The price: a typo proposed first is the
  canon's name, and the undo does not rename.
- **The merged item stays as a trace** (`items.merged_into`, `places.merged_into`), never deleted. The
  one column does four things: the trace's name is the survivor's **second name** — the search finds it
  by its key and its vector and answers the survivor once, at the better place, the limit after the
  folding; **an id from before** — a purchase queued on a phone, a draft, a bot's button — lands on the
  survivor by `liveItemId` / `livePlaceId` on every path that writes by an id, and `byId` reads through
  it; **a trace's name typed again** — «Предложить товар», a receipt's new line, the seed that only adds,
  a place at the door — is the survivor, so a twin never comes back; and the undo takes the mark off. A
  trace always points at a live item: a merge into a trace is refused, and the traces of a merged item
  follow it. A trace is no node of the receipt matcher. **The price on the phone:** «Часто берёте» offline
  shows the old name until the server answers.
- **What moves**: purchases, verdicts, picks and the person's own word (`admits`, added together when
  both items had one query), codes (refused past `ITEM_BARCODES_MAX` — then a candidate), Armenian names
  and headings (one both have stays on the trace), the shops' memory, receipts' lines; for a place, trips
  and dishes' verdicts. The vector stays with the trace: the meaning finds the survivor by it.
- **One person's two verdicts** (Т-5): a live one beats a withdrawn one, of two alike the later
  `rated_at`, the survivor's on a tie. The rows stay and **trade what they say** — the unique key holds
  row by row, so two rows cannot cross in one statement — and the loser, on the trace, is withdrawn. **The
  0.2 gate counts rows** (`reachedRatings`, MOL-27), so a merge gives nobody a rating and takes none
  (Т-6, the test at five). `updated_at`, the order of «Что брать», travels with the words: the trigger
  `verdicts_touch_updated_at` keeps still under `molvia.merging` (0054). **The price:** a withdrawn row
  holds no text (CHECK), so the undo brings the loser back without its review — the journal keeps no
  one's words.
- **The journal** (`catalogue_merges`, `catalogue_merge_moves`) writes down every row moved by its own
  key; **`make unmerge ID=`** moves those back — **each only from where the merge put it**, the survivor
  or what that was merged into since: a code let go and written to another item, a word of the shop's
  memory said again, stay with what people did (adversarial А4). **Merges are undone from the last
  that touched the same rows** (`chained`, naming it): a merge whose survivor was merged on since (a
  chain, А3, Б1), or after which another merge into the same survivor swapped the same person's verdict
  or added to the same pick (a fan, review №11, adversarial В1, В3). Undone out of order, a swap met
  contents another merge had put there and the person's scores came back crossed — «Малоко» with the
  score given to «Молоко 3,2%» — and an «own word» another merge brought was taken off. A later merge
  that touched nothing of it does not stand in the way. A withdrawal writes the row it lost to as well
  (`kept`): a later merge that only withdrew its own against a verdict the earlier one brought is a
  touch too — undone first, the earlier one took the winner home and left the survivor with nothing of
  the person (review №12, adversarial Д1). **A name or a heading the survivor's other twin knew too
  stays with the survivor** on an undo, and the trace undone gets a copy (Д2); **undone in turn, the
  twin takes it away** unless the survivor had it of its own, a merge still standing brought it, or
  another twin knows it — so a fan undone from the earlier merge on leaves the survivor as it was (Е1). **The price:** to part a false merge the owner
  undoes the later true one too, and merges it again by hand — the texts of the reviews withdrawn on the
  way do not come back, and the night leaves that pair to the hand from then on. The
  survivor's own pick gets back its «own word» and its last
  pick (А7). **An undone pair is never merged or named by the night again — nor the survivor of its
  survivor**: the pair is read by the live things its two ends stand in now, so «Малоко», undone from
  «Молоко 3,2%», does not merge into what that went into (А5). The owner's `make merge` still may (В-2). A
  pick has no id, so its move names its person and **goes with the person by the cascade**
  (`ACTOR_REFERENCES`); the copy of a person's data leaves the journal out, the pick itself being in it.
- **The night** (`mergeTick`): a minute timer in the API, from 04:30 Yerevan — after the copy of the
  database at 04:00, so a copy before every merge exists — claimed by its day in
  `catalogue_merge_runs`, so two instances never run one night and a night slept through runs on waking;
  the report from 09:00, queued as `catalogue_merged` and sent every morning, nothing merged included —
  it is also the word that the night ran. **A pair that fails is told as `job:catalogue-merge` and the
  night goes on**; a night that dies whole — a restart, a lost connection — leaves its day claimed and
  unfinished and **is claimed again an hour on** (`STALE_RUN_MINUTES`), and **the report reads the
  night's merges from the journal** (`catalogue_merges.night`), so what merged before it died is named
  all the same (review №3, adversarial А6). A moment goes to the driver as a string: a `Date` in a raw
  `sql` template is refused by postgres-js under drizzle, and the night never ran (№1, А1). **What
  reached a trace after its merge** (a write that read the id a moment before — `liveItemId` takes no
  lock) is swept to the survivor under the merge's number, **in both modes** and by every table a merge
  moves (№8). Yerevan, not the owner's zone, which is kept nowhere. **The prices, named:** a night that
  first starts after 23:00 — the API down since 04:30 — and dies is claimed again only in the next day,
  and its merges are named by no morning; they stand in the journal and in `make unmerge`. A candidate
  whose side merged that night waits for the next only in `on`, and meets the survivor there only if the
  survivor is near the other side too («Сыр чанох» merged into «Сыр чанах», whose pair with «Сыр чунух»
  is 0.64: never asked) — in `report`, where nothing merged, it is named as it is.
- **`CATALOGUE_MERGE`**: `on` merges, `report` says what it would and merges nothing — it only sweeps
  what reached the trace of a merge made by hand — `off` does not look — the default, so a copy, CI and the tests never merge by a timer. **Production runs `report` until
  the owner says `on`** (В-3): the thresholds stand on a corpus, not yet on strangers' twins. A pair
  only reported comes with its command **`make apart FROM= INTO=`** (review №7, owner's decision
  05.10.2026): the owner says two things are apart before `on` merges them. `catalogue_apart` holds the
  pair by its ids; the night reads it as a pair undone — by the live things its ends stand in now —
  never merging or naming it, nor what they are merged into since, **that very night too**: a side merged
  — or, in `report`, merged as if — passes what it may not be merged with to its survivor, so `report`
  never promises A→C and B→C for A and B apart (adversarial Г1). The owner's `make merge` still may.
  **Every pair of a night is kept** (adversarial В2): the message names ten, and `make merge-night DAY=`
  prints them all — in `on` the merges still standing by number, in `report` each pair with its
  `make apart` (`catalogue_merge_runs.pairs`).
- **The morning's message holds within Telegram's 4096** (`MERGE_TEXT_MAX`, review №9, adversarial Б2):
  pairs are printed while it holds them, the rest counted — a message refused is lost, being handed
  once. A candidate cut for length is named already; **`make merge-candidates`** lists every candidate
  named and still apart, with its command, so neither a cut nor a lost morning loses one.
- **Not here:** merging by codes (one package is one item already, MOL-100), renaming an item by hand,
  chains of shops across cities (two places, MOL-120).
