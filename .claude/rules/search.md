---
paths:
  - 'packages/model/src/support/{search-key,synonyms,text}.ts'
  - 'packages/model/src/{entities,contracts}/{item,catalogue}.ts'
  - 'packages/model/tests/support/{search-*,synonyms*,text*,name-identity*}.ts'
  - 'packages/model/tests/entities/item.test.ts'
  - 'packages/model/tests/contracts/catalogue.test.ts'
  - 'backend/src/db/{items,search-picks,seed}-repository.ts'
  - 'backend/src/{catalogue-seed,seed-catalogue,seed-catalogue-cli}*.ts'
  - 'backend/src/usecases/{search-catalogue,propose-item}*.ts'
  - 'backend/src/routes/catalogue.ts'
  - 'backend/tests/{search,seed,catalogue}*.ts'
  - 'backend/drizzle/*{catalogue,search}*.sql'
  - 'frontend/src/views/ItemSearchView*'
  - 'frontend/src/components/{CatalogueCombobox,ProposeItemSheet}*'
  - 'frontend/src/composables/useCatalogueSearch*'
  - 'frontend/src/stores/{searchDraft,itemEntry,recentItems}*'
  - 'e2e/item-search.spec.ts'
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
- **The tables are frozen, and changing one is a migration.** So are the rules that fold and
  decide `c`. The key is stored, so an edit after the first row is written makes every
  accumulated key foreign — silently, with no error and no log line. MOL-11 changed the
  alphabet without one only because no key was stored yet — no production, no real catalogue
  in any copy; MOL-27 widened `INVISIBLE` under the same condition. Same standing as `MINOR_EXPONENT`. Retuning the thresholds is a
  different thing and does not touch the alphabet.
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
  from «молочка» is what embeddings are for in 0.2. The forms people type are written out —
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

**Embeddings are a 0.2 question, not a 0.1 one.** They answer what trigrams cannot —
«молочка» reaching kefir and curd, and the duplicate merging the canonical catalogue needs.
They are not the answer to typos or transliteration, both of which are already solved
deterministically above. The cost is real: `vector` is not in `postgres:17-alpine`, so it
means owning the image, plus a model resident in memory on a cheap VPS.

## How the catalogue grows

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
