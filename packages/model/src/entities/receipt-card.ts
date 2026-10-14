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
 * How a country's tills print an amount. The parse counts in hundredths throughout (`hundredthsOf`), so
 * a card names only formats it reads (`PARSED_FRACTION_DIGITS`): the parse refuses a card with none or
 * with another, rather than read every sum of it wrong. Georgia's pharmacies print three decimals,
 * «23.868 ლარი», and come with the parse that reads them (MOL-248).
 */
export interface NumberFormat {
  readonly fractionDigits: number
}

/** The decimals the parse reads an amount with. */
export const PARSED_FRACTION_DIGITS: readonly number[] = [2]

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
  /** The payment, in cash or by card. */
  readonly paid: readonly string[]
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
  /** Tesseract's languages, one country's set: every script at once is slower and mixes them (MOL-114). */
  readonly languages: string
  readonly numbers: readonly NumberFormat[]
  /** Digits OCR confuses in the tills' font: a figure is tried with each of them swapped in. */
  readonly swaps: Readonly<Record<string, string>>
  /** Letters Tesseract puts where the font has digits, before a digit or a point. */
  readonly digitLike: Readonly<Record<string, string>>
  readonly words: ReceiptWords
}

export interface ReceiptCard {
  readonly currency: Currency
  /** The language the tills print names in, and of the catalogue's names a line is matched against. */
  readonly nameLanguage: ItemNameLanguage | null
  /** A country read off a photo; a country whose receipts come by their link has none (MOL-232). */
  readonly photo: PhotoReading | null
}

/**
 * Armenia: the bench of MOL-114, the layouts of MOL-125, the class code of MOL-226, MOL-227's section.
 * Read by name where a rule is Armenia's alone — the city of an Armenian till's head.
 */
export const ARMENIAN_RECEIPTS: PhotoReading = {
  languages: 'hye+rus+eng',
  // «5 403,12 ֏», «688.09դրամ»: a point or a comma before the hundredths, thousands apart by a space
  numbers: [{ fractionDigits: 2 }],
  swaps: { 5: '6', 6: '5', 1: '4', 4: '1', 3: '8', 8: '3', 0: '9', 9: '0' },
  digitLike: { Յ: '3', З: '3', б: '6', О: '0', O: '0', o: '0' },
  words: {
    total: 'Ընդամենը',
    totalKept: 'դամե',
    // «զեղչ», «Զեղչ», «qեղչ» — as loosely as the total's word
    discountKept: 'եղչ',
    // «Առձեռն» as OCR reads it, «Կանխիկ», «Անկանխիկ», «Վճարված»
    paid: ['ձեռն', 'ձեոն', 'ձեդն', 'Կանխիկ', 'Անկանխ', 'Վճար'],
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

/**
 * The countries a receipt is read in. Serbia's receipts are not read off a photo but asked of the tax
 * office by their link (MOL-232), and its names have no language of their own in the catalogue yet
 * (MOL-232, В-3); Georgia joins with its card (MOL-248).
 */
export const RECEIPT_CARDS: Readonly<Record<ReceiptCountry, ReceiptCard>> = {
  AM: { currency: 'AMD', nameLanguage: 'hy', photo: ARMENIAN_RECEIPTS },
  RS: { currency: 'RSD', nameLanguage: null, photo: null },
}

export function receiptCard(country: ReceiptCountry): ReceiptCard {
  return RECEIPT_CARDS[country]
}
