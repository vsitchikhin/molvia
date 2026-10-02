import { markRaw } from 'vue'
import type { Component } from 'vue'
import IconBus from '~icons/mdi/bus'
import IconClothes from '~icons/mdi/tshirt-crew-outline'
import IconDocuments from '~icons/mdi/file-document-outline'
import IconFood from '~icons/mdi/food-apple-outline'
import IconHome from '~icons/mdi/home-outline'
import IconLeisure from '~icons/mdi/ticket-outline'
import IconLipstick from '~icons/mdi/lipstick'
import IconOther from '~icons/mdi/dots-horizontal'
import IconPaw from '~icons/mdi/paw-outline'
import IconPill from '~icons/mdi/pill'
import IconSofa from '~icons/mdi/sofa-outline'
import IconTag from '~icons/mdi/tag-outline'
import IconWifi from '~icons/mdi/wifi'
import IconCafe from '~icons/mdi/silverware-fork-knife'
import {
  MINOR_EXPONENT,
  RATE_SCALE,
  currencySign,
  decimalFromRate,
  formatEstimate,
  formatMoney,
  formatRate,
  nextCategoryColour,
  TRIP_CATEGORY,
} from '@molvia/model'
import type {
  ExchangeRate,
  Money,
  MoneyMonthView,
  SpendingCategoryView,
  SpendingPreset,
  SpendingView,
} from '@molvia/model'
import type { RejectedSpendingWrite, SpendingUndo, SpendingWrite } from '@/stores/spendingQueue'
import { spendingOf } from '@/stores/spendingQueue'
import type { SpendingPrefill } from '@/stores/spendingHandoff'

/**
 * What the screen of «Деньги» draws, put together from the server's month and the phone's queue
 * (MOL-82). Nothing here adds money up: every total is the server's, and a spending still in the
 * queue is a row with a mark, never a figure in a sum (CLAUDE.md, «no business logic on the
 * frontend»; requirements, Р-3).
 */

/** The icon of a preset, by its key (handoff 06); one's own categories take the tag. */
const PRESET_ICONS: Record<SpendingPreset, Component> = {
  groceries: markRaw(IconFood),
  cafe: markRaw(IconCafe),
  rent: markRaw(IconHome),
  home: markRaw(IconSofa),
  beauty: markRaw(IconLipstick),
  transport: markRaw(IconBus),
  telecom: markRaw(IconWifi),
  health: markRaw(IconPill),
  clothes: markRaw(IconClothes),
  pets: markRaw(IconPaw),
  leisure: markRaw(IconLeisure),
  documents: markRaw(IconDocuments),
  other: markRaw(IconOther),
}

export function categoryIcon(category: SpendingCategoryView): Component {
  return category.preset ? PRESET_ICONS[category.preset] : markRaw(IconTag)
}

/**
 * A rate in words — «4,62 ֏ за 1 ₽»: how much of one currency a unit of the other costs, on the
 * side whose number is at least one, as «Деньги» keeps every rate (MOL-73, С-1). A rate that came
 * the other way round is printed as the domain prints any rate, rather than turned over here.
 */
export function rateWords(
  rate: ExchangeRate,
  locale: string,
  t: (key: string, named: Record<string, unknown>) => string,
): string {
  if (rate.scaled < RATE_SCALE) return formatRate(rate, locale)
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(decimalFromRate(rate.scaled))
  return t('spending.rate_value', {
    amount: `${number} ${currencySign(rate.quote, locale)}`,
    sign: currencySign(rate.base, locale),
  })
}

/**
 * An amount as it was typed (handoff 06): «5 000 ֏» for five thousand, «2 495,69 ₽» with its
 * kopecks. Whole units need no «,00» — the totals already print none — and a fraction is never
 * rounded away: this is money spent, not an estimate.
 */
export function asTyped(value: Money, locale: string): string {
  const unit = 10n ** BigInt(MINOR_EXPONENT[value.currency])
  return value.minor % unit === 0n ? formatEstimate(value, locale) : formatMoney(value, locale)
}

/** The colour of a category as a custom property — the tokens decide which colour it is. */
export function categoryColour(category: SpendingCategoryView): string {
  return category.preset
    ? `var(--cat-${category.preset})`
    : `var(--cat-own-${String(category.colour ?? 0)})`
}

/**
 * The person's categories as the phone knows them now: the server's list, then what waits in the
 * queue — a category made with no signal, and a removal or a return not yet sent (В-4). One's own
 * made on the phone stands after the others, as the server will put it.
 */
export function categoriesWith(
  server: readonly SpendingCategoryView[],
  pending: readonly SpendingWrite[],
): SpendingCategoryView[] {
  const list = [...server]
  for (const write of pending) {
    if (write.kind === 'category-add' && !list.some((one) => one.id === write.body.id)) {
      // The server's own rule, so the colour does not change when the answer comes (review Т-11).
      list.push({
        id: write.body.id,
        preset: null,
        name: write.body.name,
        colour: nextCategoryColour(list),
        archived: false,
      })
    }
    if (write.kind === 'category-archive' || write.kind === 'category-restore') {
      const archived = write.kind === 'category-archive'
      const at = list.findIndex((one) => one.id === write.id)
      const found = list[at]
      if (found) list[at] = { ...found, archived }
    }
  }
  return list
}

/**
 * The journal read a page at a time: the next page continues where the last stopped, and a day
 * cut by the page comes back with the rest of its rows. Its total is the whole day's on both pages
 * (MOL-73), so the later one is simply the same figure.
 */
export function mergePages(first: MoneyMonthView, next: MoneyMonthView): MoneyMonthView {
  const days = first.days.map((day) => ({ ...day, entries: [...day.entries] }))
  for (const day of next.days) {
    const last = days.at(-1)
    if (last?.day === day.day) last.entries.push(...day.entries)
    else days.push({ ...day, entries: [...day.entries] })
  }
  return {
    ...first,
    days,
    cursor: next.cursor,
    remaining: next.remaining,
    remainingFrom: next.remainingFrom,
    remainingTo: next.remainingTo,
  }
}

/**
 * The spendings a waiting removal takes away: the last of «Удалить» and «Вернуть» about each is a
 * removal. One brought back with «Вернуть» behind a removal already tried is on screen again, as
 * the person was told (round 2, Н2).
 */
function beingRemoved(pending: readonly SpendingWrite[]): Set<string> {
  const last = new Map<string, 'remove' | 'restore'>()
  for (const write of pending)
    if (write.kind === 'remove' || write.kind === 'restore') last.set(write.id, write.kind)
  return new Set([...last].flatMap(([id, kind]) => (kind === 'remove' ? [id] : [])))
}

/** What the queue has to say about a row: on its way, amended, or refused. */
export type SpendingMark = 'waiting' | 'editing' | 'refused'

export type JournalRow =
  | {
      readonly kind: 'manual'
      readonly key: string
      readonly spending: SpendingView
      /** In the spending currency — the server's, and null for a row only the phone holds. */
      readonly counted: Money | null
      readonly mark: SpendingMark | null
      /** The refusal behind a «Не принята» mark, for the sheet to name. */
      readonly refusal: RejectedSpendingWrite | null
      /** Only on the phone yet: the sheet amends it through the queue, not over a revision. */
      readonly local: boolean
    }
  | {
      readonly kind: 'trip'
      readonly key: string
      readonly tripId: string
      readonly placeName: string
      readonly items: number
      readonly amount: Money
      readonly counted: Money | null
    }

export interface JournalDay {
  readonly day: string
  /** The server's total, or null for a day only the phone knows of — it has no figure yet. */
  readonly total: Money | null
  readonly estimated: boolean
  readonly rows: JournalRow[]
}

/**
 * A spending only the phone holds, as the person last typed it: its record, or the latest
 * amendment waiting behind a record already on its way (review Т-4). The server has no figures of
 * it yet, so these are the only ones there are — unlike a server row, whose figures stay its own.
 */
function localView(
  write: Extract<SpendingWrite, { kind: 'record' }>,
  pending: readonly SpendingWrite[],
): SpendingView {
  const latest = pending
    .filter(
      (one): one is Extract<SpendingWrite, { kind: 'amend' }> =>
        one.kind === 'amend' && one.id === write.body.id,
    )
    .at(-1)?.body
  const { spentOn, amount, categoryId, note, place, accountId, debited } = latest ?? write.body
  const id = write.body.id
  return {
    id,
    spentOn,
    amount,
    categoryId,
    note: note ?? null,
    place: place ?? null,
    rate: null,
    accountId: accountId ?? null,
    debited: debited ?? null,
    revision: 1,
    amendedAt: null,
  }
}

/**
 * The month's journal with the queue laid over it (MOL-82, requirements 12–15): a spending still
 * on the phone stands at the top of its day marked «Отправляем…», an amendment not yet sent marks
 * the server's row — whose figures stay the server's until it answers — a removal hides the row,
 * and a refusal about a row on screen marks it «Не принята»: that row is where it is put right, and
 * any amendment of it takes the refusal away. A spending of a day the loaded pages have not reached
 * yet waits for them: shown there, it would stand among the wrong neighbours. A refusal with no row
 * on screen is `refusedRows`'s (MOL-159).
 */
export function journalOf(
  month: MoneyMonthView,
  pending: readonly SpendingWrite[],
  /** Trips whose removal is still on its way (MOL-76): their lines go, the figures stay the server's. */
  removedTrips: ReadonlySet<string> = new Set(),
  /** Spendings whose removal landed after this month was read (MOL-151): gone, not back for a moment. */
  gone: ReadonlySet<string> = new Set(),
  rejected: readonly RejectedSpendingWrite[] = [],
): JournalDay[] {
  const removing = beingRemoved(pending)
  const editing = new Set(pending.flatMap((write) => (write.kind === 'amend' ? [write.id] : [])))
  const refusals = new Map<string, RejectedSpendingWrite>()
  for (const item of rejected) {
    const id = spendingOf(item.write)
    if (id) refusals.set(id, item)
  }

  const days: JournalDay[] = month.days.map((day) => ({
    day: day.day,
    total: day.total,
    estimated: day.estimated,
    rows: day.entries.flatMap((entry): JournalRow[] => {
      if (entry.kind === 'trip')
        return removedTrips.has(entry.tripId)
          ? []
          : [
              {
                kind: 'trip',
                key: `${entry.tripId}:${entry.amount.currency}`,
                tripId: entry.tripId,
                placeName: entry.placeName,
                items: entry.items,
                amount: entry.amount,
                counted: entry.counted,
              },
            ]
      const { id } = entry.spending
      if (removing.has(id) || gone.has(id)) return []
      const refusal = refusals.get(id) ?? null
      return [
        {
          kind: 'manual',
          key: id,
          spending: entry.spending,
          counted: entry.counted,
          mark: refusal ? 'refused' : editing.has(id) ? 'editing' : null,
          refusal,
          local: false,
        },
      ]
    }),
  }))

  const known = new Set(days.flatMap((day) => day.rows.map((row) => row.key)))
  const reached = month.cursor === null ? '' : (month.days.at(-1)?.day ?? '')
  for (const write of pending) {
    if (write.kind !== 'record') continue
    const spending = localView(write, pending)
    if (known.has(spending.id) || removing.has(spending.id)) continue
    if (!spending.spentOn.startsWith(month.month) || spending.spentOn < reached) continue
    known.add(spending.id)
    const row: JournalRow = {
      kind: 'manual',
      key: spending.id,
      spending,
      counted: null,
      mark: 'waiting',
      refusal: null,
      local: true,
    }
    const at = days.findIndex((day) => day.day <= spending.spentOn)
    const same = days[at]
    if (same?.day === spending.spentOn) same.rows.unshift(row)
    else {
      const day: JournalDay = { day: spending.spentOn, total: null, estimated: false, rows: [row] }
      if (at === -1) days.push(day)
      else days.splice(at, 0, day)
    }
  }
  return days.filter((day) => day.rows.length > 0)
}

/**
 * Every spending the server refused, as rows of its own — «Не приняты» on top of «Траты», whatever
 * the month and its pages (MOL-159); the screen leaves out one whose row the journal shows marked,
 * so a refusal stands once (adversarial round 6, П). Laid into the journal, a refusal stood only where the journal
 * guessed its row was: a page not loaded, a month not answered, another month, a date moved across
 * the month's edge, a spending removed elsewhere — each guess was a refusal left on a card whose one
 * action threw the typing away (adversarial rounds 1–5). Here nothing is guessed: each opens on
 * what was typed, and an amendment of a row the month has loaded goes again over the server's
 * revision; one of a row not loaded, over the revision it was made on.
 */
export function refusedRows(
  month: MoneyMonthView | null,
  rejected: readonly RejectedSpendingWrite[],
  pending: readonly SpendingWrite[],
): Extract<JournalRow, { kind: 'manual' }>[] {
  const loaded = new Map(
    (month?.days ?? []).flatMap((day) =>
      day.entries.flatMap((entry) =>
        entry.kind === 'manual' ? [[entry.spending.id, entry] as const] : [],
      ),
    ),
  )
  return rejected.flatMap((refusal): Extract<JournalRow, { kind: 'manual' }>[] => {
    const { write } = refusal
    if (write.kind === 'record')
      return [
        {
          kind: 'manual',
          key: write.body.id,
          spending: localView(write, pending),
          counted: null,
          mark: 'refused',
          refusal,
          local: true,
        },
      ]
    if (write.kind !== 'amend') return []
    const { id, body } = write
    const held = loaded.get(id)?.spending
    // The row says what was typed and refused; the revision is the server's when the month holds it.
    return [
      {
        kind: 'manual',
        key: id,
        spending: {
          id,
          spentOn: body.spentOn,
          amount: body.amount,
          categoryId: body.categoryId,
          note: body.note ?? null,
          place: body.place ?? null,
          rate: null,
          accountId: body.accountId === undefined ? (held?.accountId ?? null) : body.accountId,
          debited: body.debited ?? null,
          revision: held?.revision ?? body.revision,
          amendedAt: null,
        },
        counted: null,
        mark: 'refused',
        refusal,
        local: false,
      },
    ]
  })
}

/**
 * How many of the month's spendings wait on the phone — «Ещё не учтено: 1 трата отправляется»:
 * the card says it rather than adding them to a total it did not count. A removal not yet sent
 * counts too — the server's total still holds the spending it takes away.
 */
export function unsentIn(month: MoneyMonthView, pending: readonly SpendingWrite[]): number {
  const shown = new Set(
    month.days.flatMap((day) =>
      day.entries.flatMap((entry) => (entry.kind === 'manual' ? [entry.spending.id] : [])),
    ),
  )
  const removing = beingRemoved(pending)
  const ids = new Set<string>()
  for (const write of pending) {
    // A record the month already shows is counted — its answer was lost, not the spending
    // (adversarial Л) — and one being taken back is not waiting to be counted at all.
    if (
      write.kind === 'record' &&
      write.body.spentOn.startsWith(month.month) &&
      !shown.has(write.body.id) &&
      !removing.has(write.body.id)
    )
      ids.add(write.body.id)
    if (
      write.kind === 'amend' &&
      (write.body.spentOn.startsWith(month.month) || shown.has(write.id))
    )
      ids.add(write.id)
    if (write.kind === 'remove' && shown.has(write.id) && removing.has(write.id)) ids.add(write.id)
  }
  return ids.size
}

/**
 * «Продукты» of the owner, where a record with no purchases lands as a spending (MOL-78, В-1) —
 * none once removed from the choice: the sheet takes only a category it shows.
 */
export function groceriesOf(categories: readonly SpendingCategoryView[]): string | null {
  return (
    categories.find((category) => category.preset === TRIP_CATEGORY && !category.archived)?.id ??
    null
  )
}

/** What the sheet of a spending is opened on: a new one, one of one's own, or a trip's line. */
export type SpendingTarget =
  /** `prefill`: a record with no purchases handed over as a spending (MOL-78, В-1). */
  | { readonly kind: 'add'; readonly prefill?: SpendingPrefill }
  | { readonly kind: 'manual'; readonly row: Extract<JournalRow, { kind: 'manual' }> }
  | {
      readonly kind: 'trip'
      readonly row: Extract<JournalRow, { kind: 'trip' }>
      readonly day: string
    }

/** What «Удалить» hands the screen for its strip: «Вернуть» and the words for it. */
export interface Removed {
  readonly undo: SpendingUndo
  readonly title: string
  readonly amount: string
}

/**
 * A figure of «Бюджет» (MOL-117) with its sign left to the words around it — «сверх плана», «осталось»:
 * whole units, as every figure of «Деньги», unless that prints a nought for money that is there —
 * 0,40 ֏ over the plan is «0,40 ֏», never «0 ֏» (adversarial Г).
 */
export function budgetAmount(value: Money, locale: string): string {
  const size = { ...value, minor: value.minor < 0n ? -value.minor : value.minor }
  // Under half a unit rounds to nought; the unit is the currency's own (review 11).
  const half = size.minor * 2n < 10n ** BigInt(MINOR_EXPONENT[size.currency])
  return size.minor !== 0n && half ? formatMoney(size, locale) : formatEstimate(size, locale)
}
