import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ComponentPublicInstance, ComputedRef, Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { monthOf as monthOfDay, monthSchema } from '@molvia/model'
import type { Currency, ExchangeRate, SpendingCategoryView, WireCode } from '@molvia/model'
import { categoriesWith, journalOf, refusedRows, unsentIn } from '@/components/spending'
import type { JournalDay, JournalRow, Removed, SpendingTarget } from '@/components/spending'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useLocalDay } from '@/composables/useLocalDay'
import { useMoneyMonth } from '@/composables/useMoneyMonth'
import type { MoneyMonth } from '@/composables/useMoneyMonth'
import { localDay, purchaseDay, timeOfDay } from '@/days'
import { useActorStore } from '@/stores/actor'
import type { SpendingPrefill } from '@/stores/spendingHandoff'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import type { RejectedSpendingWrite } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'

export interface MoneyScreen extends MoneyMonth {
  readonly queue: ReturnType<typeof useSpendingQueueStore>
  readonly tripQueue: ReturnType<typeof useTripQueueStore>
  /** A trip opened from here and removed: its «Вернуть» stands here (MOL-76). */
  readonly tripRemoved: ComputedRef<boolean>
  readonly announce: ReturnType<typeof useAnnouncer>
  readonly today: Ref<string>
  lookAtToday(): void
  readonly currentMonth: ComputedRef<string>
  /** The month of the address — never one still to come. */
  readonly selected: ComputedRef<string>
  goMonth(next: string): void
  readonly online: Ref<boolean>
  readonly categories: ComputedRef<SpendingCategoryView[]>
  readonly canWrite: ComputedRef<boolean>
  readonly spendCurrency: ComputedRef<Currency>
  readonly journal: ComputedRef<JournalDay[]>
  readonly unsent: ComputedRef<number>
  /** Refusals of what is not a spending's typing — a category, «Вернуть» too late: a card each. */
  readonly otherRefusals: ComputedRef<RejectedSpendingWrite[]>
  /** Every spending the server refused, of any month — what the summary counts. */
  readonly refusals: ComputedRef<Extract<JournalRow, { kind: 'manual' }>[]>
  /** Those of them with no marked row in the journal on screen: «Не приняты» on top of «Траты». */
  readonly refused: ComputedRef<Extract<JournalRow, { kind: 'manual' }>[]>
  /** Those marked on their own row in the journal on screen, by key. */
  readonly refusedInJournal: ComputedRef<string[]>
  reasonOf(code: WireCode): string
  /** «сентябре», «September»: a month after «в», as the words of the screens say it. */
  monthIn(month: string): string
  readonly liveRate: ComputedRef<ExchangeRate | null>
  nameOf(category: SpendingCategoryView): string
  whenOf(at: Date): string
  readonly sheetOpen: Ref<boolean>
  readonly newCategoryOpen: Ref<boolean>
  readonly made: Ref<string | null>
  readonly target: Ref<SpendingTarget>
  compose(prefill?: SpendingPrefill): void
  openRow(row: JournalRow, day: string): void
  /** The spending just removed and what is left of its ten seconds — on either screen. */
  readonly removed: ComputedRef<
    (Removed & { readonly stamp: number; readonly left: number; readonly quiet: boolean }) | null
  >
  readonly addButton: Ref<ComponentPublicInstance | null>
  onRemoved(value: Removed): void
  /** What the strip has left, as it counts: the next screen goes on from it. */
  keepLeft(seconds: number): void
  forgetRemoved(): void
  restore(): Promise<void>
}

/** The ten seconds of «Вернуть»: counted by the strip, not started again by each screen showing it. */
const UNDO_SECONDS = 10
/** Removals whose strip has been shown once: said aloud and given the focus then, and only then. */
const shownRemovals = new Set<number>()

/**
 * What «Деньги» and «Траты» share (MOL-159): one month of the server's in the address, moved by
 * `replace`, and the spending written into it — the sheet, «+ Своя», «Вернуть». Two screens of the
 * same month: the summary and its journal; neither adds anything up.
 */
export function useMoneyScreen(): MoneyScreen {
  const { t, locale } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const actor = useActorStore()
  const queue = useSpendingQueueStore()
  const tripQueue = useTripQueueStore()
  const announce = useAnnouncer()

  /**
   * This month on the phone (MOL-121), looked at again whenever the app comes back into view: an
   * installed app frozen over the last night of a month came back to the same page, and the new
   * month was «the future» — neither the address nor the arrow reached it (adversarial З, review
   * Т-10).
   */
  const today = useLocalDay()
  const currentMonth = computed(() => monthOfDay(today.value))
  // Asked also on opening the sheet and on a save: the app may have stood open across midnight.
  function lookAtToday(): void {
    today.value = localDay()
  }
  const selected = computed(() => {
    const asked = route.query.month
    return typeof asked === 'string' &&
      monthSchema.safeParse(asked).success &&
      asked <= currentMonth.value
      ? asked
      : currentMonth.value
  })
  const money = useMoneyMonth(selected)

  function goMonth(next: string): void {
    void router.replace({
      query: { ...route.query, month: next === currentMonth.value ? undefined : next },
    })
  }

  const online = ref(navigator.onLine)
  const onLine = () => (online.value = true)
  const offLine = () => (online.value = false)
  onMounted(() => {
    window.addEventListener('online', onLine)
    window.addEventListener('offline', offLine)
  })
  onUnmounted(() => {
    window.removeEventListener('online', onLine)
    window.removeEventListener('offline', offLine)
  })

  // Any month the phone keeps names the categories — they are the owner's, not the month's — so
  // a spending can be written before this month's answer, or offline on the first of the month
  // (review Т-5).
  const categories = computed(() =>
    categoriesWith(money.knownCategories.value, [...queue.arrived, ...queue.pending]),
  )
  /** Whether a spending can be written here at all: a category is required, and known. */
  const canWrite = computed(() => categories.value.some((category) => !category.archived))
  const spendCurrency = computed(
    () => money.month.value?.spendCurrency ?? actor.settings?.spendCurrency ?? 'AMD',
  )

  // A removal landed after the month on screen was read: its row is gone, not back for a moment
  // until the month is read again (MOL-151, adversarial А3) — unless «Вернуть» is on its way.
  const gone = computed(() => {
    // As of when the read set out: one sent before the removal and come after it still holds the
    // row (adversarial Б1).
    const read = money.askedAt.value?.getTime() ?? 0
    const back = new Set(
      queue.pending.flatMap((write) => (write.kind === 'restore' ? [write.id] : [])),
    )
    return new Set(
      queue.gone.flatMap((item) => (item.at > read && !back.has(item.id) ? [item.id] : [])),
    )
  })
  // The same for a record of «Покупки» (adversarial Б4): waiting, or landed after the read set
  // out — unless its «Вернуть» is on its way, which `removing` already says.
  const tripsGone = computed(() => {
    const read = money.askedAt.value?.getTime() ?? 0
    const back = new Set(
      tripQueue.pending.flatMap((write) => (write.kind === 'restore' ? [write.tripId] : [])),
    )
    return new Set([
      ...tripQueue.removing,
      ...tripQueue.gone.flatMap((item) => (item.at > read && !back.has(item.id) ? [item.id] : [])),
    ])
  })
  const journal = computed(() =>
    money.month.value
      ? journalOf(money.month.value, queue.pending, tripsGone.value, gone.value, queue.rejected)
      : [],
  )
  /** «Ещё не учтено»: the spendings of this month still on the phone — a row each, never a sum. */
  const unsent = computed(() =>
    money.month.value ? unsentIn(money.month.value, queue.pending) : 0,
  )
  const refusals = computed(() => refusedRows(money.month.value, queue.rejected, queue.pending))
  /** The refusals whose row the journal on screen shows marked: put right there (round 6, П). */
  const marked = computed(
    () =>
      new Set(
        journal.value.flatMap((day) =>
          day.rows.flatMap((row) => (row.kind === 'manual' && row.refusal ? [row.key] : [])),
        ),
      ),
  )
  /** Once on screen: the rest stand in «Не приняты». */
  const refused = computed(() => refusals.value.filter((row) => !marked.value.has(row.key)))
  /**
   * «Не приняты» names the marked ones too and leads to the first: the summary counted every
   * refusal, and a second one was left to be found among forty rows (adversarial round 7, Р).
   */
  const refusedInJournal = computed(() =>
    refusals.value.filter((row) => marked.value.has(row.key)).map((row) => row.key),
  )
  const otherRefusals = computed(() =>
    queue.rejected.filter((item) => item.write.kind !== 'record' && item.write.kind !== 'amend'),
  )
  const monthIn = (value: string) => t(`spending.month_in.${value.slice(5)}`)
  const reasonOf = (code: WireCode) =>
    code.startsWith('error.') ? t(code) : t('spending.rejected_other.unknown', { code })

  function nameOf(category: SpendingCategoryView): string {
    return category.preset ? t(`spending.category.${category.preset}`) : (category.name ?? '')
  }

  const whenOf = (at: Date) => `${purchaseDay(at, locale.value)}, ${timeOfDay(at, locale.value)}`

  const sheetOpen = ref(false)
  const newCategoryOpen = ref(false)
  const made = ref<string | null>(null)
  const target = ref<SpendingTarget>({ kind: 'add' })

  /** «Добавить трату», or a record with no purchases handed over from «Покупки» (MOL-78, В-1). */
  function compose(prefill?: SpendingPrefill): void {
    lookAtToday()
    made.value = null
    target.value = prefill ? { kind: 'add', prefill } : { kind: 'add' }
    sheetOpen.value = true
  }

  function openRow(row: JournalRow, day: string): void {
    made.value = null
    target.value = row.kind === 'trip' ? { kind: 'trip', row, day } : { kind: 'manual', row }
    sheetOpen.value = true
  }

  /**
   * «Вернуть» is the queue's, not the screen's (adversarial round 2, Ж): removed on «Траты», it
   * stands on «Деньги» after the step back, with the rest of its ten seconds — as a trip's does
   * (`TripUndoStrip`).
   */
  const removed = computed(() => {
    const value = queue.lastRemoved
    if (!value) return null
    const left = value.left - Math.floor((Date.now() - value.at) / 1000)
    return left > 0 ? { ...value, left, quiet: shownRemovals.has(value.stamp) } : null
  })
  // After the strip is drawn: a removal whose time ran out while no screen showed it is
  // forgotten, and one drawn is marked as said.
  watch(
    () => queue.lastRemoved,
    (value) => {
      if (!value) return
      if (removed.value) shownRemovals.add(value.stamp)
      else queue.lastRemoved = null
    },
    { immediate: true, flush: 'post' },
  )
  /** «Добавить трату»: where the focus goes once «Вернуть» has done its work and gone. */
  const addButton = ref<ComponentPublicInstance | null>(null)

  function onRemoved(value: Removed): void {
    const now = Date.now()
    queue.lastRemoved = { ...value, stamp: now, left: UNDO_SECONDS, at: now }
  }

  function keepLeft(seconds: number): void {
    const value = queue.lastRemoved
    if (value) queue.lastRemoved = { ...value, left: seconds, at: Date.now() }
  }

  function forgetRemoved(): void {
    queue.lastRemoved = null
  }

  async function restore(): Promise<void> {
    const value = queue.lastRemoved
    if (!value) return
    queue.restore(value.undo)
    queue.lastRemoved = null
    announce?.(t('spending.restored'))
    await nextTick()
    ;(addButton.value?.$el as HTMLElement | undefined)?.focus()
  }

  return {
    ...money,
    queue,
    tripQueue,
    tripRemoved: computed(() => tripQueue.lastRemoved !== null),
    announce,
    today,
    lookAtToday,
    currentMonth,
    selected,
    goMonth,
    online,
    categories,
    canWrite,
    spendCurrency,
    journal,
    unsent,
    otherRefusals,
    refusals,
    refused,
    refusedInJournal,
    reasonOf,
    monthIn,
    /** «Мой курс на сегодня» for the sheet: only a running month's rate is today's. */
    liveRate: money.todayRate,
    nameOf,
    whenOf,
    sheetOpen,
    newCategoryOpen,
    made,
    target,
    compose,
    openRow,
    removed,
    addButton,
    onRemoved,
    keepLeft,
    forgetRemoved,
    restore,
  }
}
