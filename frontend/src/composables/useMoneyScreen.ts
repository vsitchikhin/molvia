import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { ComponentPublicInstance, ComputedRef, Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { monthOf as monthOfDay, monthSchema } from '@molvia/model'
import type { Currency, ExchangeRate, SpendingCategoryView, WireCode } from '@molvia/model'
import { categoriesWith, journalOf, unsentIn } from '@/components/spending'
import type { JournalDay, JournalRow, Removed, SpendingTarget } from '@/components/spending'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useLocalDay } from '@/composables/useLocalDay'
import { useMoneyMonth } from '@/composables/useMoneyMonth'
import type { MoneyMonth } from '@/composables/useMoneyMonth'
import { localDay, purchaseDay, timeOfDay } from '@/days'
import { useActorStore } from '@/stores/actor'
import type { SpendingPrefill } from '@/stores/spendingHandoff'
import { spendingOf, useSpendingQueueStore } from '@/stores/spendingQueue'
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
  readonly otherRefusals: ComputedRef<RejectedSpendingWrite[]>
  reasonOf(code: WireCode): string
  readonly liveRate: ComputedRef<ExchangeRate | null>
  nameOf(category: SpendingCategoryView): string
  whenOf(at: Date): string
  readonly sheetOpen: Ref<boolean>
  readonly newCategoryOpen: Ref<boolean>
  readonly made: Ref<string | null>
  readonly target: Ref<SpendingTarget>
  compose(prefill?: SpendingPrefill): void
  openRow(row: JournalRow, day: string): void
  readonly removed: Ref<(Removed & { stamp: number }) | null>
  readonly addButton: Ref<ComponentPublicInstance | null>
  onRemoved(value: Removed): void
  restore(): Promise<void>
}

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

  const journal = computed(() =>
    money.month.value
      ? journalOf(money.month.value, queue.pending, queue.rejected, tripQueue.removing)
      : [],
  )
  /** «Ещё не учтено»: the spendings of this month still on the phone — a row each, never a sum. */
  const unsent = computed(() =>
    money.month.value ? unsentIn(money.month.value, queue.pending) : 0,
  )
  /**
   * Refusals no row of this month carries — «Вернуть» too late, a category — said under the
   * switcher; one a row of the month carries is that row's on «Траты» (adversarial round 3, Ж).
   */
  const otherRefusals = computed(() =>
    queue.rejected.filter(
      (item) =>
        !['record', 'amend'].includes(item.write.kind) ||
        !journal.value.some((day) =>
          day.rows.some((row) => row.kind === 'manual' && row.key === spendingOf(item.write)),
        ),
    ),
  )
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

  const removed = ref<(Removed & { stamp: number }) | null>(null)
  /** «Добавить трату»: where the focus goes once «Вернуть» has done its work and gone. */
  const addButton = ref<ComponentPublicInstance | null>(null)

  function onRemoved(value: Removed): void {
    removed.value = { ...value, stamp: Date.now() }
  }

  async function restore(): Promise<void> {
    const value = removed.value
    if (!value) return
    queue.restore(value.undo)
    removed.value = null
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
    reasonOf,
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
    restore,
  }
}
