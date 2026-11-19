import type { Currency } from '#model/values/money'
import type { ItemNameLanguage, ReceiptCountry } from '#model/entities/receipt'

// MOL-247 — a country's card: everything the product knows of a country's receipts, one record per
// country. The line of an item is the same the world over; where a receipt ends and which figure is its
// total are the country's words (MOL-229, Г-5): without them no total is found and the taxes and the
// payment below it are read as items. So the parse takes its words from here, never from its own
// constants, and a second country is a second record rather than edits across the parse.
//
// The tills' own layouts — «Ереван Сити»'s card, Dog City's table, the terminal and the class code, the
// section «Բաժին» — stay hints of the parse: they are the forms of rows, not the country's words.

/**
 * How a country's tills print an amount. Tesseract's parse counts in hundredths throughout (`hundredthsOf`), so a card
 * it reads names only formats it reads (`PARSED_FRACTION_DIGITS`): the parse refuses a card with none or with another,
 * rather than read every sum of it wrong. The model's reading takes three decimals too (MOL-421): Georgia's pharmacies
 * print «23.868 ლარი», and a receipt whose every amount has three is rounded half up to the hundredth once its lines'
 * arithmetic held as printed (`MODEL_FRACTION_DIGITS`).
 */
export interface NumberFormat {
  readonly fractionDigits: number
}

/** The decimals Tesseract's parse reads an amount with. */
export const PARSED_FRACTION_DIGITS: readonly number[] = [2]

/** The decimals the model's reading reads an amount with (MOL-421): hundredths, and a pharmacy's thousandths. */
export const MODEL_FRACTION_DIGITS: readonly number[] = [2, 3]

/**
 * The words of a country's receipts as OCR reads them — each a fragment of a regular expression, since a
 * word is read in more forms than it is printed in («Ընդամենը» as «/չդամենը», «Կղդամեկը»). A fragment is
 * set in a group of its own, so its forms may be alternatives («A|B»); it captures nothing, since the parse
 * reads the figures after it by their groups (a test holds it). A layout reads the forms it reads; a form
 * one layout alone reads (`tinMisread`) is named apart. `letters` alone are no fragments but ranges of a
 * character class.
 */
export interface ReceiptWords {
  /** The total, as printed: what a layout reads its total after. */
  readonly total: string
  /** What OCR keeps of the total's word however it misreads it — the vote of the total looks for it. */
  readonly totalKept: string
  /** What OCR keeps of the discount's word: a row of the total with it is the discount's. */
  readonly discountKept: string
  /**
   * An amount labelled by the currency alone — a Georgian pharmacy's «23.868 ლარი» (MOL-421, owner's В-2 «а»): a place
   * of the total only where no amount carries the total's word, and only one such amount; shown by MOL-244's rule as any
   * total is. The whole label, marks around it at most. The model's reading only.
   */
  readonly bareTotal: string
  /**
   * A sum since the start of the year or the month — «Ընդամենը ամվա սկզբից», what a card bought there this
   * year: never the receipt's total, neither read nor a vote (MOL-288).
   */
  readonly sinceStart: string
  /**
   * The card's discount of the transaction, sent to the card instead of taken off — «Զեղչ գործարքից», told
   * from a line's discount by this word beside the discount's (MOL-289): the lines make the total less it.
   */
  readonly cashback: string
  /** The sum taxed with VAT, «ԱԱՀ-ով հարկվող»: the lines' sum, a second place of it (MOL-289). */
  readonly taxed: string
  /** The card's bonus this receipt is partly paid with, «Կանխավճարի մարում» (MOL-289). */
  readonly redeemed: string
  /**
   * The prepayment slip «Ереван Сити» prints over a receipt whose discount goes to the card, «Կանխավճար … Ընդամենը»
   * (MOL-289): its sum is the cashback, a second place of it where the model copied the cashback under another word
   * (MOL-310). Its word alone on its row.
   */
  readonly prepayment: string
  /**
   * A café's surcharge for service — «Հավելավճար 10%», «Սպասարկում», «Service 10%» (MOL-310): no dish, printed
   * under the dishes or among them, and the lines make the total less it. Read in any case.
   */
  readonly service: string
  /**
   * A café's bill's total in words no fiscal till prints (MOL-310): «ՎՃԱՐՄԱՆ» alone on its row, and a bill printed in
   * Russian — «Всего», «Итого к оплате». Read in any case. Its first form is anchored itself (`^…$`, a label of that
   * word alone): the pattern built of it must keep the fragment whole in its own group, as every word's is.
   */
  readonly billTotal: string
  /**
   * A bank terminal's slip, a café's only paper where it gives no bill (MOL-310): its rows name the terminal
   * («TID», «MID», «RRN»), and its one amount is printed after `slipAmount` («Գումար»).
   */
  readonly slipTerminal: string
  readonly slipAmount: string
  /** The payment, in cash or by card. */
  readonly paid: readonly string[]
  /**
   * How it was paid (MOL-312): the words of a payment in cash, and of one by card. A word of either is read
   * only beside a sum above nothing, and a receipt that says both — or neither — says nothing.
   */
  readonly cash: readonly string[]
  readonly cashless: readonly string[]
  /** The tax a section prints its sum beside: the section's sum, read again. */
  readonly sectionTax: readonly string[]
  /** The control row that closes the list of items. */
  readonly control: string
  /** The fiscal mark a table's last row runs into. */
  readonly fiscalSign: string
  /** The seller's tax number; `tinMisread` — its word as OCR misreads it, which the table reads. */
  readonly tin: string
  readonly tinMisread: readonly string[]
  /** The fiscal number, and the word «number» printed after it. */
  readonly fiscal: string
  readonly fiscalNumber: string
  /** The receipt's own number — never a tax number. */
  readonly receiptNumber: string
  /**
   * Words of a fiscal head that name no item beside the fiscal mark and the tax number, which are read
   * from their own fields: the cashier, the section, the address, the till.
   */
  readonly head: readonly string[]
  /** What follows an amount: the currency's word as OCR cuts it, the terminal's sum first. */
  readonly sumSign: string
  readonly currency: readonly string[]
  /**
   * The units a till prints after a count: a piece — and the terminal's piece cut short before its
   * «=» — a kilogram, a millilitre, and a litre and a gram of one letter. A line is weighed wherever its
   * unit is the kilogram's fragment; the table prints it in either case.
   */
  readonly units: {
    readonly piece: string
    readonly pieceCut: string
    readonly kg: string
    readonly ml: string
    readonly litre: string
    readonly gram: string
  }
  /** The country's alphabet, as ranges of a character class: capitals, small letters, any letter. */
  readonly letters: { readonly capital: string; readonly small: string; readonly any: string }
}

/** What reading a country's receipt off a photo needs. */
export interface PhotoReading {
  /**
   * Tesseract's languages, one country's set: every script at once is slower and mixes them (MOL-114). `null` — the
   * model alone reads the country (MOL-408, owner's В-2 «а»): no layout of Tesseract's finds its lines, and a receipt
   * the model does not read fails as unreadable, never «переснимите».
   */
  readonly languages: string | null
  /**
   * How many digits the seller's tax number has after its word (MOL-408): Armenia's eight, Georgia's nine of a
   * company and eleven of a sole trader — the model's rows and Tesseract's layouts are read by it alike.
   */
  readonly tinDigits: readonly number[]
  /** How many digits the receipt's fiscal number has after its word: Armenia's eight; none read, none (MOL-408). */
  readonly fiscalDigits: readonly number[]
  readonly numbers: readonly NumberFormat[]
  /** Digits OCR confuses in the tills' font: a figure is tried with each of them swapped in. */
  readonly swaps: Readonly<Record<string, string>>
  /**
   * Digits a model confuses in the tills' font (MOL-290): a line whose arithmetic does not hold as the model
   * copied it is tried with them swapped in. Only the pairs measured on the model's bench: Tesseract's
   * `swaps` are its own, and a pair joins here with a measure of its own.
   */
  readonly modelSwaps: Readonly<Record<string, string>>
  /**
   * Digits a model was seen to confuse only where the total put its line right (MOL-310, owner's В-5 «а»): the
   * repair of MOL-290 tries them beside `modelSwaps`, and nothing else does — the shop's memory doubts by
   * `modelSwaps` alone. Each kept while the bench shows no value made up by it.
   */
  readonly modelRepairSwaps: Readonly<Record<string, string>>
  /** Letters Tesseract puts where the font has digits, before a digit or a point. */
  readonly digitLike: Readonly<Record<string, string>>
  /**
   * The order the tills print a date's parts in (MOL-305): Armenia's day first, «23-10-26», «04.10.2026». A date
   * written as printed is read in this order, never by a guess: asked for «YYYY-MM-DD», Haiku made «23-10-26» of
   * 26 October 2023 — caught by the window of its arrival, since asking it for the date as printed cost the lines (v7).
   */
  readonly dateOrder: DateOrder
  readonly words: ReceiptWords
}

/**
 * A number of so many digits as a fragment of a regular expression, for a capturing group: «\d{9}|\d{11}»; none — a
 * fragment that matches nothing, never an empty one, which matches everything.
 */
export function digitCounts(counts: readonly number[]): string {
  // the longer first: a pattern with no end after it takes the first alternative that fits
  const longestFirst = [...counts].sort((a, b) => b - a)
  return longestFirst.length === 0
    ? '(?!)'
    : longestFirst.map((count) => `\\d{${String(count)}}`).join('|')
}

/** The orders of a date's parts a card may name: one so far, the next with the country that prints it. */
export type DateOrder = 'day-first'

export interface ReceiptCard {
  readonly currency: Currency
  /** The language the tills print names in, and of the catalogue's names a line is matched against. */
  readonly nameLanguage: ItemNameLanguage | null
  /** A country read off a photo; a country whose receipts come by their link has none (MOL-232). */
  readonly photo: PhotoReading | null
}

/** A word a country's tills never print: a field of the card no rule of that country reads. */
const NEVER = '(?!)'

/**
 * Armenia: the bench of MOL-114, the layouts of MOL-125, the class code of MOL-226, MOL-227's section.
 * Read by name where a rule is Armenia's alone — the city of an Armenian till's head.
 */
export const ARMENIAN_RECEIPTS: PhotoReading = {
  languages: 'hye+rus+eng',
  tinDigits: [8],
  fiscalDigits: [8],
  // «5 403,12 ֏», «688.09դրամ»: a point or a comma before the hundredths, thousands apart by a space
  numbers: [{ fractionDigits: 2 }],
  swaps: { 5: '6', 6: '5', 1: '4', 4: '1', 3: '8', 8: '3', 0: '9', 9: '0' },
  // «Ереван Сити»'s «5» has a flat top: am-44's six lines the model lost, am-34 faded
  modelSwaps: { 5: '6', 6: '5' },
  // «Ереван Сити»'s 581,75 copied 531,75 (MOL-310, 44185f32)
  modelRepairSwaps: { 3: '8', 8: '3' },
  digitLike: { Յ: '3', З: '3', б: '6', О: '0', O: '0', o: '0' },
  // «23-10-26 14:06» of the terminal (MOL-227), «04.10.2026 16:23» of the tills
  dateOrder: 'day-first',
  words: {
    total: 'Ընդամենը',
    totalKept: 'դամե',
    // «զեղչ», «Զեղչ», «qեղչ» — as loosely as the total's word
    discountKept: 'եղչ',
    bareTotal: NEVER,
    // «ամվա սկզբից», «ամսվա սկզբից»
    sinceStart: 'սկզբ',
    cashback: 'գործարք',
    taxed: 'հարկվող',
    redeemed: 'մարում',
    prepayment: 'Կանխավճար',
    // «Հավելավճար 10%» — a surcharge — and «Սպասարկում», service, in Armenian; a bill in Russian or English
    service: 'Հավելավճար|Սպասարկում|Обслуживание|Service',
    // «ՎՃԱՐՄԱՆ», to be paid — the word alone on its row: the model copies the payment «Վճարված է Առձեռն» as «Վճարման է
    // Առնեմն», which is the payment's place (adversarial А1); «Всего», «Итого к оплате», «Итого с обслуживанием»
    // and «ԵՆԹԱԿԱ Է ՎՃԱՐՄԱՆ», subject to payment, a shop's till (MOL-310, round 2)
    billTotal: '^[\\s:=/-]*Վճարման[\\s:=/-]*$|Ենթակա\\s+է\\s+վճարման|Всего|Итого|К оплате',
    slipTerminal: '\\b(?:TID|MID|RRN)\\b',
    // «Գումար:», the amount — never «Գումար/Զչ», a fiscal till's column, since a slip has no lines
    slipAmount: 'Գումար|Amount|Сумма',
    // «Առձեռն» as OCR reads it, «Կանխիկ», «Անկանխիկ», «Վճարված»
    paid: ['ձեռն', 'ձեոն', 'ձեդն', 'Կանխիկ', 'Անկանխ', 'Վճար'],
    // «Վճարված է Առձեռն» — in hand — a whole word «Առ…ն» as OCR and the model make of it, its third letter what
    // they make of «ձ» («Առեղն», «Առնեռն», «Առծեն», «Առոեոն», «Առժեն»), never «Առաջին»; «Կանխիկ» whole,
    // never «Անկանխիկ» — «Ան կանխիկ» torn by OCR too — nor «Կանխավճար» as «Կանխիկավճար». And the last word
    // before its sum: a
    // word of cash with words after it is another row's, «Առաջին ամսվա սկզբից», the year's trade as the model
    // copied it, «Կանխիկով մուծում» (MOL-312, adversarial А1–А4). (Letters alone: «Ա-և» holds the marks
    // «՝», «՛» an amount follows, «Առձեռն՝ 1700.00».)
    cash: [
      '(?<![Ա-Ֆա-և])[Աա]ռ[ձծճենոժ][Ա-Ֆա-և]{0,3}ն(?![^\\d]*[Ա-Ֆա-և])',
      '(?<![Աա]ն\\s?)[Կկ]անխիկ(?![^\\d]*[Ա-Ֆա-և])',
    ],
    // «Անկանխիկ», «Ան կանխիկ», «Վճարված է PosTerminal» — never «միայն քարտապան», a promotion for the card's holders
    cashless: ['[Աա]ն\\s?կանխիկ', '[Pp][Oo][Ss]\\s?[Tt]erminal'],
    // «Շրջանառության հարկ», its «կ» read «լ»
    sectionTax: ['Շրջ', 'հար[կլ]'],
    control: 'Հսկիչ',
    fiscalSign: '\\(Ֆ',
    tin: 'ՀՎՀՀ',
    tinMisread: ['ՎՎՀՀ', 'ՀՎՀ'],
    fiscal: 'Ֆիսկալ',
    fiscalNumber: 'համար',
    receiptNumber: 'ԿՀ',
    head: ['Գանձապահ', 'Բաժին', 'Հասցե', 'ՀԴՄ'],
    sumSign: 'դր',
    currency: ['դրամ', 'դրա'],
    units: { piece: 'հ\\S?տ', pieceCut: 'հ\\S{1,2}', kg: 'կգ', ml: 'մլ', litre: 'լ', gram: 'գ' },
    letters: { capital: 'Ա-Ֆ', small: 'ա-ֆ', any: 'Ա-և' },
  },
}

/** Georgia's letters: Mkhedruli, which has no case, and Mtavruli, its capitals for headings. */
const GEORGIAN = { capital: 'Ა-ᲺᲽ-Ჿ', small: 'ა-ჺჽ-ჿ' }

/** «სულ», the total — never inside a word: «სულგუნი» is a cheese. */
const SUL = `(?<![${GEORGIAN.small}])სულ(?![${GEORGIAN.small}])`

/**
 * Georgia (MOL-408): read off its photo by the model alone — `languages` none (owner's В-2 «а»). **Every word names the
 * receipt it was seen on** — the five photos of MOL-229 (`.scratch/receipts/foreign/ge-01…05.jpg`) and its draft card
 * (`research/MOL-229/cards/GE.json`) — and a word no Georgian receipt has shown is `NEVER`, as is what Georgia prints
 * no counterpart of (the card's cashback, the sum since the year's start): a word without a paper behind it would
 * decide what a total is. The model's 5↔6 was seen only where the total put a sum right (Carrefour, MOL-420): a swap of
 * the repair alone, never the shop's memory's doubt, which nobody measured. The pharmacies print three decimals and
 * their total under the currency alone, «23.868 ლარი» (ge-04, ge-05): the model's reading takes both (MOL-421).
 */
export const GEORGIAN_RECEIPTS: PhotoReading = {
  languages: null,
  // «ს/კ» — the identification code the law has a seller print; none of the five photos prints it, so the shop's
  // memory learns only from a receipt that does (owner's В-6 «а»): nine digits of a company, eleven of a sole trader
  tinDigits: [9, 11],
  // the receipt's number «ქვითარი 1687592» (ge-02) is not read yet (Р-5, MOL-422)
  fiscalDigits: [],
  // «23.868 ლარი» of the pharmacies (ge-04, ge-05)
  numbers: [{ fractionDigits: 2 }, { fractionDigits: 3 }],
  swaps: {},
  modelSwaps: {},
  // Carrefour's «5,85» copied «5,86» (ge-03): the total printed twice puts it right (MOL-420)
  modelRepairSwaps: { 5: '6', 6: '5' },
  digitLike: {},
  // «25.05.2024», «19.07.2008» (ge-02, ge-01)
  dateOrder: 'day-first',
  words: {
    // «სულ» (ge-01, ge-02), Carrefour's «GEL* TOT» (ge-03)
    total: `${SUL}|\\bTOT\\b`,
    totalKept: `${SUL}|\\bTOT\\b`,
    discountKept: NEVER,
    // the pharmacies' total, «ლარი» alone on its row (ge-04, ge-05)
    bareTotal: 'ლარი|₾|GEL',
    sinceStart: NEVER,
    cashback: NEVER,
    taxed: NEVER,
    redeemed: NEVER,
    prepayment: NEVER,
    service: NEVER,
    billTotal: NEVER,
    slipTerminal: NEVER,
    slipAmount: NEVER,
    // «გადახდა» (ge-01), «BOG_Cards» (ge-02), «EFT» (ge-03), «ნაღდი», «ბარათი» (GE.json); the change «ხურდა» is no
    // payment and prints below nought (ge-01)
    paid: ['ნაღდ', 'ბარათ', 'გადახდ', 'Cards?\\b', '\\bEFT\\b'],
    cash: ['ნაღდ'],
    cashless: ['ბარათ', 'Cards?\\b', '\\bEFT\\b'],
    sectionTax: [NEVER],
    control: NEVER,
    fiscalSign: NEVER,
    tin: 'ს[/.]\\s?კ\\.?',
    tinMisread: [],
    fiscal: NEVER,
    fiscalNumber: NEVER,
    receiptNumber: NEVER,
    head: [NEVER],
    // «ლარი», «₾», «GEL» (GE.json; ge-03, ge-04)
    sumSign: 'ლარ',
    currency: ['ლარი', '₾', 'GEL'],
    // «1ც» (ge-02), «100 ცალი» (ge-05), «100მლ» (ge-04), «50 გრ» (ge-02); no kilogram or litre seen
    units: {
      piece: `ც(?:ალი)?(?![${GEORGIAN.small}])`,
      pieceCut: NEVER,
      kg: NEVER,
      ml: 'მლ',
      litre: NEVER,
      gram: `გრ(?![${GEORGIAN.small}])`,
    },
    letters: { ...GEORGIAN, any: `${GEORGIAN.small}${GEORGIAN.capital}` },
  },
}

/**
 * The countries a receipt is read in. Serbia's receipts are not read off a photo but asked of the tax
 * office by their link (MOL-232), and its names have no language of their own in the catalogue yet
 * (MOL-232, В-3); nor have Georgia's (MOL-408).
 */
export const RECEIPT_CARDS: Readonly<Record<ReceiptCountry, ReceiptCard>> = {
  AM: { currency: 'AMD', nameLanguage: 'hy', photo: ARMENIAN_RECEIPTS },
  GE: { currency: 'GEL', nameLanguage: null, photo: GEORGIAN_RECEIPTS },
  RS: { currency: 'RSD', nameLanguage: null, photo: null },
}

export function receiptCard(country: ReceiptCountry): ReceiptCard {
  return RECEIPT_CARDS[country]
}

/** A reading Tesseract does too: a card that names its languages. */
export type TesseractReading = PhotoReading & { readonly languages: string }

/**
 * Whether Tesseract reads the country's photos (MOL-408): where not, the model alone does — the server fails what it
 * did not read as unreadable, and the phone offers the camera only to whom it reads. One rule for both.
 */
export function tesseractReads(reading: PhotoReading): reading is TesseractReading {
  return reading.languages !== null
}

/**
 * Whether the model alone reads the country's receipts (MOL-408): read off a photo, and Tesseract reads none of it. A
 * country read by its link has no photo to read — Serbia's — and is no such country.
 */
export function modelAlone(country: ReceiptCountry): boolean {
  const { photo } = receiptCard(country)
  return photo !== null && !tesseractReads(photo)
}

/**
 * Whether an item a line found is a guess (MOL-408, owner's В-5 «б»): a receipt read off a photo in a country the
 * catalogue names nothing in — its line goes by the search of its name whole, by letters across scripts and by
 * meaning, and a find is «проверьте». The tax office's lines are its own words (Serbia, MOL-232), and stay as found.
 */
export function findsAreGuesses(card: ReceiptCard): boolean {
  return card.photo !== null && card.nameLanguage === null
}
