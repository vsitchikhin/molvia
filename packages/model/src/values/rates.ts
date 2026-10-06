import { z } from 'zod'
import { decimalFromScaled, divideRounded, scaledFromDecimal } from '#model/support/decimal'
import { DomainError, ERROR, ISSUE } from '#model/support/errors'
import { currencySchema, currencySign } from './money'
import type { Currency } from './money'

export const RATE_DIGITS = 6
export const RATE_SCALE = 10n ** BigInt(RATE_DIGITS)

// A sanity band, not a validation: the real check on a personal rate is disagreement with the
// official one for the same day — MOL-40's, against the cache of MOL-39.
export const RATE_MIN = RATE_SCALE / 10_000n
export const RATE_MAX = RATE_SCALE * 1_000_000n

const RATE_EPOCH = new Date('2000-01-01T00:00:00.000Z')

/**
 * `official` is the Central Bank of Armenia. `fallback` is an open source standing in for it
 * when it has published nothing for a week (MOL-39) — the screen marks such a rate, because the
 * person trusts the number by where it came from.
 */
export const rateSourceSchema = z.enum(['personal', 'official', 'fallback'])
export type RateSource = z.infer<typeof rateSourceSchema>

const exchangeRateFields = z.object({
  base: currencySchema,
  quote: currencySchema,
  scaled: z.bigint().min(RATE_MIN).max(RATE_MAX),
  source: rateSourceSchema,
  asOf: z.date(),
})

export const exchangeRateSchema = exchangeRateFields
  .refine((rate) => rate.base !== rate.quote, {
    error: ISSUE.RATE_SAME_CURRENCY,
  })
  // No Date.now() here: a schema that answers differently depending on the clock is not
  // a schema. «Not from the future» belongs to the use case that snapshots the rate.
  .refine((rate) => rate.asOf >= RATE_EPOCH, { error: ISSUE.RATE_IMPLAUSIBLE_DATE })
export type ExchangeRate = z.infer<typeof exchangeRateSchema>

function scaledFromRate(input: string): bigint | null {
  const scaled = scaledFromDecimal(input, RATE_DIGITS)
  if (scaled === null || scaled < RATE_MIN || scaled > RATE_MAX) return null
  return scaled
}

export function parseRate(input: string): bigint {
  const scaled = scaledFromRate(input)
  if (scaled === null) throw new DomainError(ERROR.INVALID_RATE, input)
  return scaled
}

export function decimalFromRate(scaled: bigint): `${number}` {
  return decimalFromScaled(scaled, RATE_DIGITS)
}

export const exchangeRateWireSchema = z.object({
  base: currencySchema,
  quote: currencySchema,
  rate: z.string().max(40),
  source: rateSourceSchema,
  asOf: z.iso.datetime(),
})
export type ExchangeRateWire = z.infer<typeof exchangeRateWireSchema>

export const rateCodec = z.codec(exchangeRateWireSchema, exchangeRateSchema, {
  decode: ({ base, quote, rate, source, asOf }, payload) => {
    const scaled = scaledFromRate(rate)
    if (scaled === null) {
      payload.issues.push({
        code: 'custom',
        input: rate,
        path: ['rate'],
        message: ERROR.INVALID_RATE,
      })
    }
    return { base, quote, scaled: scaled ?? 1n, source, asOf: new Date(asOf) }
  },
  encode: (value) => ({
    base: value.base,
    quote: value.quote,
    rate: decimalFromRate(value.scaled),
    source: value.source,
    asOf: value.asOf.toISOString(),
  }),
})

/**
 * Of a rate and the same rate the other way round, the one whose number is at least one — the
 * side a person names a rate by (MOL-81). Both are made from an exact source by the caller; this
 * only chooses, so the model and the server choose alike (review Т-7).
 */
export function uprightOf(
  forward: ExchangeRate | null,
  backward: ExchangeRate | null,
): ExchangeRate | null {
  if (forward && forward.scaled >= RATE_SCALE) return forward
  return backward ?? forward
}

/**
 * The rate turned to the side a person reads it by — `per` one unit of which, `scaled` of `of` —
 * from its own six digits: for a figure that has no source but itself, a trip's snapshot or the own
 * rate typed into it (MOL-81, adversarial А). A rate already at least one is itself.
 */
export function readingOf(rate: ExchangeRate): { of: Currency; per: Currency; scaled: bigint } {
  if (rate.scaled >= RATE_SCALE) return { of: rate.quote, per: rate.base, scaled: rate.scaled }
  return {
    of: rate.base,
    per: rate.quote,
    scaled: divideRounded(RATE_SCALE * RATE_SCALE, rate.scaled),
  }
}

/**
 * The rate as the screen prints it: «4,82 ֏/₽» — how much of one currency a unit of the other
 * buys, with both signs, because a bare number says nothing about which way it goes.
 *
 * On the side whose number is at least one, whichever way the rate is kept (MOL-81): «89,04 ₽/$»,
 * never «0,011232 $/₽» — a person names a rate so. Two digits always. A rate kept under one is
 * turned over here, from its six digits: that is honest for a snapshot, which a trip converts by
 * as it is, and a figure with an exact source — an exchange, the wallet — comes from the server
 * already on its side (`exchangeRateOf`, `ownRates`), since six digits of a small number are too
 * few to turn over (89,03 against 89,04).
 */
export function formatRate(rate: ExchangeRate, locale = 'ru-RU'): string {
  // The decimal itself, as every other formatter of the domain does it: a rate is six digits, and
  // a float on the way to the screen is a float in the one value that multiplies every amount.
  const upright = rate.scaled >= RATE_SCALE
  const decimal = upright
    ? decimalFromRate(rate.scaled)
    : decimalFromScaled(divideRounded(100n * RATE_SCALE, rate.scaled), 2)
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(decimal)
  const [of, per] = upright ? [rate.quote, rate.base] : [rate.base, rate.quote]
  return `${number} ${currencySign(of, locale)}/${currencySign(per, locale)}`
}

/**
 * A rate printed on the side another is read by — the bank's under an exchange's own on the card of
 * that exchange (MOL-81, adversarial Г), the jumped rate beside the one before it in the sheet of a
 * trip (review Т-9). Each printed on its own side, two rates on either side of one read «1,01 $/€»
 * over «1,01 €/$», and a jump of the comma — 4,30 ֏/₽ to 0,43 — read «2,33 ₽/֏» beside «4,30 ֏/₽»,
 * hiding the very jump the sheet is there for. Of another pair than `beside`, it is printed as any
 * rate is. On the side under one, with the six digits such a number needs.
 */
export function formatRateBeside(
  rate: ExchangeRate,
  beside: ExchangeRate,
  locale = 'ru-RU',
): string {
  const samePair =
    (rate.base === beside.base && rate.quote === beside.quote) ||
    (rate.base === beside.quote && rate.quote === beside.base)
  if (!samePair) return formatRate(rate, locale)
  const per = readingOf(beside).per
  const forward = per === rate.base
  const of = forward ? rate.quote : rate.base
  const six = forward ? rate.scaled : divideRounded(RATE_SCALE * RATE_SCALE, rate.scaled)
  // At least one: two digits, rounded once from the rate itself, as `formatRate` does.
  const decimal =
    six >= RATE_SCALE
      ? decimalFromScaled(
          forward
            ? divideRounded(rate.scaled, 10_000n)
            : divideRounded(100n * RATE_SCALE, rate.scaled),
          2,
        )
      : decimalFromRate(six)
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: six >= RATE_SCALE ? 2 : RATE_DIGITS,
  }).format(decimal)
  return `${number} ${currencySign(of, locale)}/${currencySign(per, locale)}`
}

/**
 * Where an official rate was read. The cache keeps the provider so that one pair is never built
 * from two sources — a rouble from one bank against a dollar from another is nobody's rate.
 */
export const rateProviderSchema = z.enum(['cba', 'cbr', 'erapi', 'nbg', 'nbs'])
export type RateProvider = z.infer<typeof rateProviderSchema>

/**
 * The central bank of a currency's own country, where it is not the dram's (MOL-110, owner's
 * decision В-1: «the first source of truth for a country's currency is that country's central
 * bank»): the lari is the National Bank of Georgia's, the dinar the National Bank of Serbia's
 * (MOL-230). Every other currency is the Central Bank of Armenia's, as it always was.
 */
export const HOME_BANK: Readonly<Partial<Record<Currency, RateProvider>>> = Object.freeze({
  GEL: 'nbg',
  RSD: 'nbs',
})

/**
 * The currency each provider quotes the others in — the dram, but for the National Bank of Serbia,
 * whose list has no dram to bring its answer into (MOL-230): its rows are dinars per unit.
 */
export const RATE_BASE: Readonly<Record<RateProvider, Currency>> = Object.freeze({
  cba: 'AMD',
  cbr: 'AMD',
  erapi: 'AMD',
  nbg: 'AMD',
  nbs: 'RSD',
})

type Quoted = Exclude<Currency, 'AMD'>

const ALL_BUT_DRAM = currencySchema.options.filter(
  (currency): currency is Quoted => currency !== 'AMD',
)

/**
 * What each provider publishes against its base (MOL-230): an answer missing one of its own is
 * refused whole, and another's currency is not asked of it. The Central Bank of Armenia has no
 * dinar, and the National Bank of Serbia neither the dram nor the lari — measured on 06.10.2026.
 */
export const PUBLISHED: Readonly<Record<RateProvider, readonly Quoted[]>> = Object.freeze({
  cba: ALL_BUT_DRAM.filter((currency) => currency !== 'RSD'),
  cbr: ALL_BUT_DRAM,
  erapi: ALL_BUT_DRAM,
  nbg: ALL_BUT_DRAM,
  nbs: ['RUB', 'USD', 'EUR'],
})

/** Whether `provider` publishes `currency` — its base, or one of the currencies it quotes. */
export function publishes(provider: RateProvider, currency: Currency): boolean {
  return RATE_BASE[provider] === currency || PUBLISHED[provider].some((one) => one === currency)
}

/**
 * The country banks of `HOME_BANK`, the one list of them. They stand only for their own pairs
 * (MOL-110, plan Р-1): the National Bank of Georgia prints the dram per 1000 with four digits, five
 * significant ones, so a dollar in drams by it is coarser than the Bank of Russia's (review 3). The
 * refresh asks them every hour and judges their jumps by their own fortnight.
 */
export const COUNTRY_BANKS: ReadonlySet<RateProvider> = new Set(Object.values(HOME_BANK))

/**
 * The bank whose rate is a pair's official one — the one a trip takes while it is fresh and calls
 * `official`, every other publisher being a `fallback`. **The first that publishes both currencies**
 * (MOL-230) of: the bank of each currency of the pair, the Central Bank of Armenia, then the other
 * country banks. So the lari's pairs are the National Bank of Georgia's — it publishes everything;
 * the dinar against the rouble, the dollar and the euro the National Bank of Serbia's; the dinar
 * against the dram the National Bank of Georgia's (MOL-110, В-5 «а»): neither Serbia's bank has the
 * dram nor Armenia's the dinar, and a pair is never built from two. The rest is the Central Bank of
 * Armenia's, as it always was.
 */
export function homeBankOf(base: Currency, quote: Currency): RateProvider {
  const order = [HOME_BANK[base], HOME_BANK[quote], 'cba' as const, ...COUNTRY_BANKS]
  const home = order.find(
    (provider) => provider !== undefined && publishes(provider, base) && publishes(provider, quote),
  )
  return home ?? 'cba'
}

/**
 * One published rate: how many units of the provider's base (`RATE_BASE`) one unit of `currency`
 * was worth on `date` — drams for every provider but the National Bank of Serbia, whose rows are
 * dinars (MOL-230). Never read without its provider: a rouble of 1,2257 is dinars, not drams.
 */
export interface AmdRate {
  readonly provider: RateProvider
  readonly currency: Quoted
  /** `YYYY-MM-DD`, the day in Yerevan the provider dates the rate by. */
  readonly date: string
  readonly scaled: bigint
}

/**
 * A rate as the cache holds it: what the provider published, and whether it jumped away from that
 * provider's recent rates when it arrived (MOL-39, Р-19). A jump is kept, not refused — it may be
 * true — and the trip that takes it lets the person choose.
 */
export interface CachedRate extends AmdRate {
  readonly jump: boolean
}

/** How many of a provider's latest rates of a currency a new one is measured against. */
export const RATE_JUMP_HISTORY = 5

/**
 * Fewer earlier rates than this and no judgement is made (MOL-39, Р-23). With two, the median is
 * their mean, and one wrong day ×100 made the next right day a jump — and offered the wrong one
 * as «previous».
 */
export const RATE_JUMP_MIN_HISTORY = 3

/** How far from their median a new rate may move before it counts as a jump: a quarter. */
const RATE_JUMP_PERCENT = 25n

/**
 * Whether `scaled` jumped: more than a quarter away from the median of `history` — the latest
 * rates it is measured against, newest first, at most `RATE_JUMP_HISTORY` of them and at least
 * `RATE_JUMP_MIN_HISTORY`. The lower median rather than the last value or a mean: one wrong day
 * in the history does not make the next right day look like a jump, and a move that holds for
 * three days of five stops being one.
 */
export function isRateJump(scaled: bigint, history: readonly bigint[]): boolean {
  const recent = [...history.slice(0, RATE_JUMP_HISTORY)].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  if (recent.length < RATE_JUMP_MIN_HISTORY) return false
  const median = recent[Math.floor((recent.length - 1) / 2)] ?? scaled
  const distance = scaled > median ? scaled - median : median - scaled
  return distance * 100n > median * RATE_JUMP_PERCENT
}

// Armenia has kept +04:00 all year since 2012, so the offset is a constant, not a lookup.
const YEREVAN_OFFSET_MS = 4 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** The calendar day in Yerevan at `instant` — the day every provider dates its rate by. */
export function yerevanDate(instant: Date): string {
  return new Date(instant.getTime() + YEREVAN_OFFSET_MS).toISOString().slice(0, 10)
}

/** The instant a Yerevan day begins: what a daily rate's `asOf` means. */
export function yerevanMidnight(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - YEREVAN_OFFSET_MS)
}

const LATEST_OFFSET_MS = 14 * 60 * 60 * 1000

/**
 * The latest calendar day at `instant` anywhere on Earth — UTC+14. A day a person writes is their
 * phone's (MOL-121, owner's decision В-3): east of Yerevan after the phone's midnight it is a day
 * Yerevan has not reached yet, and «not in the future» means not past this one, never past
 * Yerevan's. At most Yerevan's tomorrow — and from 14:00 in Yerevan it is that tomorrow already, so
 * the server alone lets a person in Yerevan write tomorrow's spending: the sheet's `max`, the
 * phone's today, is what keeps them to today (review Т-5).
 */
export function latestDay(instant: Date): string {
  return new Date(instant.getTime() + LATEST_OFFSET_MS).toISOString().slice(0, 10)
}

const EARLIEST_OFFSET_MS = 12 * 60 * 60 * 1000

/**
 * The earliest calendar day at `instant` anywhere on Earth — UTC−12. With `latestDay`, the days a
 * phone's today can be right now: at most Yerevan's yesterday.
 */
export function earliestDay(instant: Date): string {
  return new Date(instant.getTime() - EARLIEST_OFFSET_MS).toISOString().slice(0, 10)
}

/** Whether `zone` is a time zone this runtime knows by name — `Europe/Moscow`, never an offset. */
export function isTimeZone(zone: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(zone)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * The calendar day at `instant` in the phone's zone (`ZONE_HEADER`, MOL-121, adversarial round 4 У, Ч)
 * — and Yerevan's where the phone named none. What a moment the server stamped — a record written, a
 * setting changed — is a day of, beside the days the phone names.
 */
export function dayIn(instant: Date, zone?: string): string {
  if (zone === undefined) return yerevanDate(instant)
  const parts = wallClock(instant, zone)
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`
}

/** The instant `day` begins in `zone` — Yerevan's midnight without one. Summer time included. */
export function midnightIn(day: string, zone?: string): Date {
  if (zone === undefined) return yerevanMidnight(day)
  const wall = Date.parse(`${day}T00:00:00.000Z`)
  // Twice: the offset at the first guess may be the other side of a change of the clocks.
  const first = wall - offsetOf(new Date(wall), zone)
  return new Date(wall - offsetOf(new Date(first), zone))
}

function wallClock(instant: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant)
  const part = (type: string) => Number(parts.find((one) => one.type === type)?.value ?? 0)
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  }
}

/** How far the clocks of `zone` stand ahead of UTC at `instant`, in milliseconds. */
function offsetOf(instant: Date, zone: string): number {
  const at = wallClock(instant, zone)
  const wall = Date.UTC(at.year, at.month - 1, at.day, at.hour, at.minute, at.second)
  return wall - (instant.getTime() - instant.getUTCMilliseconds())
}

/**
 * Today as a request names it (`TODAY_HEADER`, MOL-121): the phone's day, held to the days that are
 * today somewhere at `instant` — a phone with a wrong clock is brought to the nearest of them, since
 * «today» is the person's now and not a fact they typed. Nothing sent, or not a day — the bot, a
 * page older than the header — and it is the day in `zone`, the person's country's (MOL-109), or
 * Yerevan's for a country with none.
 */
export function todayFrom(sent: string | undefined, instant: Date, zone?: string): string {
  if (sent === undefined || !isRateDay(sent)) {
    return dayIn(instant, zone)
  }
  const earliest = earliestDay(instant)
  const latest = latestDay(instant)
  if (sent < earliest) return earliest
  return sent > latest ? latest : sent
}

/**
 * A day a rate may be dated by: a real calendar day whose Yerevan midnight the snapshot accepts.
 * `Date.parse('2026-02-31')` is the 3rd of March, not NaN, and `0001-01-01` is what a .NET service
 * answers for a date it does not have. One rule for the cache and the snapshot, so the cache never
 * holds what no trip could take.
 */
export function isRateDay(date: string): boolean {
  return isCalendarDay(date) && yerevanMidnight(date) >= RATE_EPOCH
}

/**
 * `2026-09-28` and a day that exists: four digits of year, and `2026-02-31` — which `Date.parse`
 * reads as the 3rd of March — is not one. The one check of «a calendar day», for a rate's day, a
 * phone's today and the day of a tap alike (MOL-121, review Т-8).
 */
export function isCalendarDay(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = Date.parse(`${date}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date
}

/**
 * How long the Central Bank of Armenia may stay silent before a trip takes an open source
 * instead (MOL-39, В-7). A week covers weekends and holidays, when it publishes nothing and
 * nothing is wrong: a shorter bound would mark every Sunday trip «not the central bank».
 */
export const OFFICIAL_RATE_FRESH_DAYS = 7

/**
 * Whether a rate dated `date` still counts as current on `today`: at most a week old. The one
 * measure of «silent» for both halves of MOL-39 — when the refresh asks the open sources, and
 * when a trip takes one — so the two can never disagree about the same day.
 */
export function isRateFresh(date: string, today: string): boolean {
  const days = Math.round((Date.parse(today) - Date.parse(date)) / DAY_MS)
  // Tomorrow is as far ahead as a bank dates a rate — the Bank of Russia sets it the day before.
  // Further ahead is not fresh but wrong: `9999-12-31` is a .NET service's «no date» (Р-25).
  return days >= -1 && days <= OFFICIAL_RATE_FRESH_DAYS
}

// Tie-breaking order after the pair's own bank: the central banks, then the aggregator.
const PROVIDER_ORDER: readonly RateProvider[] = ['cba', 'cbr', 'nbg', 'nbs', 'erapi']

/**
 * The rate of `base` in `quote` built from one provider's rates against `unit`, its base
 * (`RATE_BASE`): the dram, or the dinar for the National Bank of Serbia (MOL-230). Quote per one base,
 * as the snapshot stores it. Against the unit it is the published number itself; the inverse and the
 * cross are a division rounded half-up to the snapshot's six digits — the one rounding outside
 * output, because the snapshot's scale is fixed (MOL-4) and the snapshot is this value's output.
 *
 * `null` when a currency is missing, when the pair is not a pair, or when the result is anything
 * `exchangeRateSchema` refuses — outside the band, or dated before 2000. The date is the older of the two halves: a cross
 * is no fresher than its stalest part.
 */
export function rateFromAmd(
  base: Currency,
  quote: Currency,
  rates: readonly AmdRate[],
  source: RateSource,
  unit: Currency = 'AMD',
): ExchangeRate | null {
  if (base === quote) return null

  const halves = [base, quote].map((currency) =>
    currency === unit ? null : rates.find((rate) => rate.currency === currency),
  )
  if (halves.includes(undefined)) return null

  const unitsPer = (index: number): bigint => halves[index]?.scaled ?? RATE_SCALE
  const scaled = divideRounded(unitsPer(0) * RATE_SCALE, unitsPer(1))

  const dates = halves.flatMap((half) => (half ? [half.date] : [])).sort()
  const [oldest] = dates
  if (oldest === undefined) return null

  // Whatever the snapshot would refuse — a rate outside the band, a date before 2000 — is not
  // built: a trip that cannot be written is a 500 at the shelf, not a trip without a rate.
  const rate = { base, quote, scaled, source, asOf: yerevanMidnight(oldest) }
  return exchangeRateSchema.safeParse(rate).success ? rate : null
}

/** The rate a trip snapshots, and — when that rate jumped — the last one before the jump. */
export interface OfficialRate {
  readonly rate: ExchangeRate
  /** Who published it: the trip keeps it, and the screen names the source it counts by (MOL-22). */
  readonly provider: RateProvider
  /** A half of the pair jumped when it arrived (MOL-39, Р-19, Р-21): the screen warns. */
  readonly jumped: boolean
  /**
   * The same pair from the provider's latest rows that did not jump, at most a week older than
   * the jump, offered as «count by the previous rate». Null when nothing jumped or there is no
   * such rate — the person can still count by the new one or enter their own.
   */
  readonly previous: ExchangeRate | null
}

function latestOf<Row extends AmdRate>(rows: readonly Row[]): Row[] {
  return [...new Set(rows.map((row) => row.currency))].flatMap((currency) => {
    const own = rows.filter((row) => row.currency === currency)
    const [first] = own
    return first === undefined
      ? []
      : [own.reduce((best, row) => (row.date > best.date ? row : best), first)]
  })
}

/**
 * The official rate a trip started on `today` snapshots (MOL-39, В-7, Р-18).
 *
 * The pair's own bank (`homeBankOf`) while its latest rate is at most a week old — a Friday rate on
 * Sunday is the right answer, not a stale one. Past that, whichever provider has the freshest
 * rate for both halves of the pair, the pair's bank winning a tie: another source is taken only
 * for being newer, and a trip built on it is marked `fallback`. Rows dated after `today` are
 * ignored — a bank that sets tomorrow's rate today has not made it today's.
 *
 * `rows` may hold, beside each provider's latest rate of a currency, its latest rate that did not
 * jump: when a half of the chosen pair jumped, those build `previous`.
 */
export function pickOfficialRate(
  base: Currency,
  quote: Currency,
  rows: readonly CachedRate[],
  today: string,
): OfficialRate | null {
  const needed = new Set<Currency>([base, quote])
  const home = homeBankOf(base, quote)
  const order = [
    home,
    ...PROVIDER_ORDER.filter((provider) => provider !== home && !COUNTRY_BANKS.has(provider)),
  ]
  const candidates = order.flatMap((provider) => {
    const own = rows.filter((row) => row.provider === provider && row.date <= today)
    const source = provider === home ? 'official' : 'fallback'
    const latest = latestOf(own)
    const unit = RATE_BASE[provider]
    const rate = rateFromAmd(base, quote, latest, source, unit)
    if (!rate) return []

    const jumped = latest.some((row) => row.jump && needed.has(row.currency))
    // A previous rate over a week older than the jump is not an alternative but a stale number
    // (Р-24): not offered, and the person still has «count by the new one» and their own.
    const steady = jumped
      ? rateFromAmd(base, quote, latestOf(own.filter((row) => !row.jump)), source, unit)
      : null
    const date = yerevanDate(rate.asOf)
    const previous = steady && isRateFresh(yerevanDate(steady.asOf), date) ? steady : null
    return [{ provider, pick: { rate, provider, jumped, previous }, date }]
  })

  const central = candidates.find((candidate) => candidate.provider === home)
  if (central && isRateFresh(central.date, today)) return central.pick

  const freshest = candidates.reduce<(typeof candidates)[number] | null>(
    (best, candidate) => (best === null || candidate.date > best.date ? candidate : best),
    null,
  )
  return freshest?.pick ?? null
}
