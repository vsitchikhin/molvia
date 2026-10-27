import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  formatEstimate,
  formatMoney,
  formatRate,
  formatRateBeside,
  yerevanDate,
} from '@molvia/model'
import type { Money, RateProvider, TripView } from '@molvia/model'
import { calendarDay } from '@/days'
import { read, writeEverywhere } from '@/stores/storage'

const FLIPPED = 'molvia.total-flipped'

/**
 * The publishers whose terms ask for their name beside every rate taken from them (MOL-230, review 1):
 * the National Bank of Serbia lets its lists be reproduced «with the source visibly named every time».
 * Every other bank is named where it is silent or stale, and the aggregator in the fallback's note.
 */
const NAMED_BESIDE: ReadonlySet<RateProvider> = new Set(['nbs'])

/** What a trip's total is drawn from: the props of the strip and of the card alike. */
export interface TripTotalInput {
  /** The trip as the server answered it; null while it is still only on the phone. */
  readonly trip: TripView | null
  /** How many writes of this trip the server has not taken yet. */
  readonly pending: number
  /** The trip itself has not reached the server: there is no total to show yet, and why. */
  readonly local: boolean
  /** «Сумма по чеку» still in the queue: the sum typed, or `receipt: null` for one taken off. */
  readonly receiptWaiting: { readonly receipt: Money | null } | null
  /**
   * The rows on screen, one being removed not among them, and those of them with no price — what
   * «С ценой — n из m» counts: the same count «Закончить» asks by (Р-5 of MOL-76, adversarial А2).
   * Left out, the line is not said.
   */
  readonly rows?: {
    readonly kept: number
    readonly unpriced: number
    /** None of them being removed or waiting to be sent: the list the server counted (MOL-207). */
    readonly settled?: boolean
  } | null
}

export interface TripTotal {
  readonly big: ComputedRef<string>
  readonly rest: ComputedRef<string[]>
  readonly estimate: ComputedRef<string | null>
  readonly rateLine: ComputedRef<string | null>
  readonly caveat: ComputedRef<string | null>
  readonly priced: ComputedRef<string | null>
  readonly flippable: ComputedRef<boolean>
  readonly flipped: Ref<boolean>
  readonly flip: () => void
  readonly receiptParts: ComputedRef<string[]>
  readonly receiptStale: ComputedRef<boolean>
  readonly waiting: ComputedRef<string | null>
}

/**
 * «ИТОГО 6 493,12 ֏ ≈ 1 347 ₽ · курс 4,82 ֏/₽ · 18 сент.» — what a trip's total says, whichever way
 * it is laid out: the strip of a finished record (until MOL-207) or the card of the record typed by
 * hand (MOL-206). The one place in the app where money is converted (handoff «Валюты»).
 *
 * **Every number here is the server's.** The phone does not add the rows up, and it does not
 * convert: `total` and `converted` come with the trip, and until a queued purchase has been
 * answered the total is honestly behind the list — hence the caveat beside it (MOL-24, В-11).
 *
 * **The conversion always looks like an estimate**: «≈» and the muted colour stay on it in either
 * position of the flip, and beside the big number it is smaller as well. Two equal numbers read as
 * two facts; there is one fact here and one guess, and the guess may be wrong by the whole rate.
 * Flipped, the person asked for their own money to be the big number (handoff «Валюты»), so the
 * size is theirs to change and the other two marks are not.
 *
 * **Only the trip's own currency is converted.** A purchase paid for in another is its own line
 * under the total: adding two currencies is refused by the domain and meaningless on a screen.
 *
 * **With a receipt's sum the big number is the receipt** (MOL-78, В-2): «Итого по чеку», and in the
 * line under it what the prices say — what they came to and for how many purchases, what the rest came
 * to, or by how much the prices miss the receipt (MOL-207). Those figures are the server's (`prices`,
 * `gap`); the phone only counts the rows with a price among the rows the server sent. A sum still in the
 * queue is a line of its own, never the total (MOL-82's rule).
 */
export function useTripTotal(props: TripTotalInput): TripTotal {
  const { t, locale } = useI18n()

  // A display choice, not a fact about a trip: it holds for every trip on this device.
  const flipped = ref(read(FLIPPED) === '1')
  function flip(): void {
    flipped.value = !flipped.value
    writeEverywhere(FLIPPED, flipped.value ? '1' : '0')
  }

  const own = computed<Money | null>(() => {
    const trip = props.trip
    if (!trip) return null
    return trip.total.find((money) => money.currency === trip.currency) ?? null
  })

  const others = computed(() =>
    (props.trip?.total ?? []).filter((money) => money.currency !== props.trip?.currency),
  )

  const money = (value: Money): string => formatMoney(value, locale.value)
  const estimated = (value: Money): string =>
    t('money.approx', { amount: formatEstimate(value, locale.value) })

  const converted = computed(() => props.trip?.converted ?? null)

  /**
   * What the big number shows: the total in the trip's own currency, or — when nothing was paid
   * in it — the first of the others, so a trip paid for entirely in roubles is not a dash.
   */
  const shown = computed(() => own.value ?? props.trip?.total[0] ?? null)

  const big = computed(() => {
    const value = converted.value
    if (flipped.value && value) return estimated(value)
    return shown.value ? money(shown.value) : '—'
  })

  /**
   * Beside the big number: every other sum of the trip, and the one the flip moved down. Never
   * what is already big — a trip paid for in one foreign currency printed it twice (review 3).
   */
  const rest = computed(() => {
    const big = flipped.value && converted.value ? null : shown.value
    const lines = props.trip?.total ?? []
    return lines.filter((value) => value.currency !== big?.currency).map((value) => money(value))
  })

  const estimate = computed(() => {
    const value = converted.value
    if (!value) return null
    const sum = own.value
    return flipped.value && sum ? null : estimated(value)
  })

  const rateLine = computed(() => {
    const rate = props.trip?.rate
    if (!rate) return null
    // The person's own — from their exchanges, or entered for this trip after a jump — is said
    // to be theirs: «мой курс» beside a number reads differently from the bank's (MOL-40).
    // After a jump, on the side the jump's note and sheet print by — the rate before it, or the
    // jumped when there is none: «23,26 ₽/֏» over «0,043 ֏/₽ вместо 4,31 ֏/₽» was one rate read
    // two ways a line apart (review Т-11, adversarial А‴).
    const jump = props.trip.rateJump
    const anchor = jump ? (jump.previous ?? jump.jumped) : null
    const provider = props.trip.rateProvider
    const named = rate.source !== 'personal' && provider !== null && NAMED_BESIDE.has(provider)
    const key =
      rate.source === 'personal'
        ? 'trip.rate_line_mine'
        : named
          ? 'trip.rate_line_source'
          : 'trip.rate_line'
    return t(key, {
      source: named ? t(`exchange.card_source_${provider}`) : '',
      rate: anchor ? formatRateBeside(rate, anchor, locale.value) : formatRate(rate, locale.value),
      // A rate is dated by a day of Yerevan: printed as that day, never as the moment of its
      // midnight, which is the evening before west of UTC+4 (adversarial Ж″).
      date: calendarDay(yerevanDate(rate.asOf), locale.value, { day: 'numeric', month: 'short' }),
    })
  })

  /**
   * Why the total is not the whole basket: purchases still on their way, and a conversion that
   * covers only the trip's own currency. Both are said plainly — a number quietly smaller than
   * what the person has picked up is the worst lie an app about money can tell.
   */
  const caveat = computed(() => {
    if (props.local) return t('trip.caveat.local')
    const lines: string[] = []
    if (props.pending > 0) lines.push(t('trip.caveat.pending', { n: props.pending }, props.pending))
    if (converted.value && others.value.length > 0) {
      lines.push(t('trip.caveat.partial', { currency: props.trip?.currency ?? '' }))
    }
    return lines.length > 0 ? lines.join(' · ') : null
  })

  /**
   * «С ценой — 1 из 2 · без цены — 1» (MOL-206, Ф-23): said only while some purchase on screen has no
   * price, so the total reads as the part it is; with a receipt's sum the split below says it instead.
   * The rows the screen shows, as «Закончить» counts them: a purchase without a price being removed
   * with no signal is no longer «без цены» here while the question at «Закончить» has forgotten it.
   */
  const priced = computed(() => {
    const rows = props.rows
    if (!rows || rows.unpriced === 0 || props.trip?.receipt) return null
    return t('trip.total_line', {
      priced: rows.kept - rows.unpriced,
      total: rows.kept,
      unpriced: rows.unpriced,
    })
  })

  // Nothing to swap without a conversion: a lone total is not two numbers.
  const flippable = computed(() => converted.value !== null)

  /**
   * «по ценам 10 070 ֏ · чек меньше цен на 200 ֏» — what the prices say beside the receipt's sum, as parts
   * of the card's one line (MOL-207, Ф-23): every figure the server's (`prices`, `gap`), each with its
   * words; the phone only counts the rows with a price among those the server sent. The column of
   * «С ценой / Без цены / Цены больше чека» went with the strip.
   *
   * **Prices more than the receipt are said as they are** (owner's В-1 «а»): «чек меньше цен» — a
   * discount on the receipt and a price typed wrong look alike to the phone, and «скидка» about a typo
   * would be a figure made up. **Agreeing is said only where it was measured and nothing is left
   * unpriced**: the prices in the receipt's own currency, one sum, and no gap — two currencies do not
   * subtract (`receiptGap`); prices that meet the receipt beside a purchase with none leave it nothing,
   * and that is said — «без цены — 0 ֏», never «сходится» (adversarial А4). **Two currencies are a list,
   * never a sum** — «8 000 ֏ и 20 $» by the locale's own conjunction: a «+» read as adding what the domain
   * refuses to add (review №2, А3).
   *
   * **Of the list the server counted** (adversarial А1): a purchase removed or added is on the screen
   * and not in `prices` and `gap` until its answer, and «— 1 из 2 · без цены — 830 ֏» over a struck-out
   * loaf spoke of a list no longer shown as if it were. While a row is being removed or waits to be sent
   * the line is that previous answer while the next is on its way — `receiptStale`, drawn at
   * `--opacity-stale`, judged by the rows and not their counts: milk swapped for cheese keeps both (round
   * 2, Б1). Taken away instead, it went and came back in one frame with every purchase sent online,
   * moving the buttons under the card (round 3, В1). The receipt's sum above it is the server's and true.
   *
   * **A dash never starts a line, and «12 из 14» is never cut** (review round 2, №3, П1): what follows
   * the dash of a part — the count, the sum — goes with it, no-break; the words before wrap.
   */
  const receiptParts = computed(() => {
    const trip = props.trip
    if (!trip?.receipt || trip.expenses.length === 0) return []
    const all = trip.expenses.length
    const priced = trip.expenses.filter((expense) => expense.amount !== null).length
    if (trip.prices.length === 0) return [t('trip.receipt.line_none')]
    const amount = new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(
      trip.prices.map((value) => money(value)),
    )
    const parts = [
      priced < all
        ? t('trip.receipt.line_prices_part', { amount, n: priced, total: all })
        : t('trip.receipt.line_prices', { amount }),
    ]
    const gap = trip.gap
    const currency = trip.receipt.currency
    if (gap) parts.push(t(`trip.receipt.line_${gap.kind}`, { amount: money(gap.amount) }))
    else if (trip.prices.length === 1 && trip.prices[0]?.currency === currency)
      parts.push(
        priced < all
          ? t('trip.receipt.line_unpriced', { amount: money({ minor: 0n, currency }) })
          : t('trip.receipt.line_meets'),
      )
    return parts.map((part) => {
      const dash = part.lastIndexOf(' — ')
      return dash < 0 ? part : part.slice(0, dash) + part.slice(dash).replaceAll(' ', '\u00a0')
    })
  })

  /** The rows on screen are not the list `prices` and `gap` were counted on: a write is on its way. */
  const receiptStale = computed(() => {
    const trip = props.trip
    const rows = props.rows
    if (!trip?.receipt || !rows) return false
    const all = trip.expenses.length
    const priced = trip.expenses.filter((expense) => expense.amount !== null).length
    return rows.settled === false || rows.kept !== all || rows.unpriced !== all - priced
  })

  const waiting = computed(() => {
    const held = props.receiptWaiting
    if (!held) return null
    return held.receipt
      ? t('trip.receipt.sending', { amount: money(held.receipt) })
      : t('trip.receipt.removing')
  })

  return {
    big,
    rest,
    estimate,
    rateLine,
    caveat,
    priced,
    flippable,
    flipped,
    flip,
    receiptParts,
    receiptStale,
    waiting,
  }
}
