import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Money } from '@molvia/model'
import { useRouter } from 'vue-router'
import { useTripHistoryStore } from '@/stores/tripHistory'
import { useTripQueueStore } from '@/stores/tripQueue'
import { useReceiptQueueStore } from '@/stores/receiptQueue'
import { useActorStore } from '@/stores/actor'
import { reportFailure } from '@/failures'
import { useReconnect } from './useReconnect'

/** A row of «Записаны» on «Покупки» (MOL-128; the history and the home screen, MOL-77). */
export interface HistoryRow {
  id: string
  name: string
  at: Date
  pending: boolean
  /** The server's count and sums (В-4); `null` where only the phone knows the row. */
  itemCount: number | null
  total: readonly Money[] | null
  /** Recorded from a receipt (MOL-126): «· из чека» beside the count (MOL-127, С-5 of MOL-128). */
  fromReceipt: boolean
  /** Finished on this phone and in no answer yet: no read drew it, failed or not (adversarial Б3). */
  onPhone: boolean
}
interface TripHistoryScreen {
  t: ReturnType<typeof useI18n>['t']
  history: ReturnType<typeof useTripHistoryStore>
  rows: ComputedRef<HistoryRow[]>
  loading: ComputedRef<boolean>
  /** The load «Показать ещё» asked for — the one that button says it is at work on (MOL-225). */
  loadingMore: Ref<boolean>
  trouble: Ref<'error' | 'offline' | null>
  /** How many loads failed: the strip says the same words again for each (MOL-181, C1). */
  failures: Ref<number>
  /**
   * The last load's «did not load» came of a list that kept moving, not of the server: every ask was
   * answered, under a cache another window was writing, and the page shown is the server's answer
   * (MOL-204, adversarial А4, В1). A page put back that is not the answer is memory (Б4).
   */
  moved: Ref<boolean>
  load(): void
  more(): void
  open(tripId: string): void
}
/** How many times one load asks, when every answer came back to a list that had moved. */
const ATTEMPTS = 4
/** The pause before the first ask again; each next one is twice as long. */
const RETRY_PAUSE_MS = 400

export function useTripHistory(): TripHistoryScreen {
  const history = useTripHistoryStore()
  const queue = useTripQueueStore()
  const receipts = useReceiptQueueStore()
  const actor = useActorStore()
  const router = useRouter()
  const { t } = useI18n()
  const busy = ref(false)
  /**
   * Loading covers «the owner is not known yet»: the first launch is still making an identity,
   * and «Здесь будут ваши походы» would be a statement about data nobody has asked for. Computed
   * rather than a flag the early return leaves set — that return goes past no `finally` (В-4).
   */
  const loading = computed(() => busy.value || !actor.id)
  const loadingMore = ref(false)
  const trouble = ref<'error' | 'offline' | null>(null)
  const failures = ref(0)
  const moved = ref(false)
  let run = 0
  /** The screen was taken away (И1). */
  let gone = false
  /** The read begun last, of either page — what «Показать ещё» waits for (Л1). */
  let latest: Promise<void> = Promise.resolve()
  const rows = computed(() => {
    // A list moved under every read is the answer by its rows; a count the answer does not say is
    // unknown, never memory said as the answer (MOL-307, owner's В-2 «а»).
    const unsure = moved.value ? history.unconfirmed() : new Set<string>()
    const rows = new Map(
      history.page.trips.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.place.name,
          at: row.finishedOnDeviceAt ?? row.finishedAt,
          pending: false,
          itemCount: unsure.has(row.id) ? null : row.itemCount,
          total: unsure.has(row.id) ? null : row.total,
          fromReceipt: row.fromReceipt,
          onPhone: false,
        },
      ]),
    )
    // A cached selection may be older than the first page. Offline it still needs an entrance.
    const saved = history.selected
    if (history.stale && saved?.finishedAt && !rows.has(saved.id)) {
      rows.set(saved.id, {
        id: saved.id,
        name: saved.place.name,
        at: saved.finishedOnDeviceAt ?? saved.finishedAt,
        pending: false,
        itemCount: saved.expenses.length,
        total: saved.total,
        fromReceipt: saved.receiptId !== null,
        onPhone: false,
      })
    }
    for (const row of history.local) {
      if (!queue.orphaned(row.id))
        rows.set(row.id, {
          id: row.id,
          name: row.name,
          at: row.completedAt,
          pending: queue.pending.some(
            (write) => write.kind === 'finish' && write.tripId === row.id,
          ),
          // Unknown, not the snapshot's: it was taken at «Закончить», before what the queue still
          // holds of this record, and read as the total it was not (review Р-10).
          itemCount: null,
          total: null,
          fromReceipt: false,
          onPhone: true,
        })
    }
    // A removal still waiting takes the row off every list at once (MOL-76).
    for (const id of queue.removing) rows.delete(id)
    return [...rows.values()].sort(
      (a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id),
    )
  })
  /** Every read goes through here, so the one begun last is known. */
  function load(more = false, tapped = more): Promise<void> {
    const reading = ask(more, tapped)
    latest = reading
    return reading
  }

  /** `tapped`: a first page read for «Показать ещё», whose button says it is at work meanwhile. */
  async function ask(more: boolean, tapped: boolean): Promise<void> {
    if (!actor.id) return
    const token = ++run
    busy.value = true
    loadingMore.value = tapped
    history.stale = true
    try {
      // An answer the list moved under is asked for again (adversarial А), after a pause that
      // doubles: the move may be a stream — another window sending its queue one purchase at a
      // time once the connection is back — and asking at once only met the next write (round 2,
      // Ж2). What is left after that is a quiet «did not load», worded so it is true either way.
      let taken = await history.load(more)
      for (let again = 1; !taken && again < ATTEMPTS && token === run; again += 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS * 2 ** (again - 1)))
        if (token === run) taken = await history.load(more)
      }
      if (token === run && more && taken) {
        // A next page taken says nothing of the first (MOL-307, rounds 4–6: Г1, Д1, Е1): neither that it
        // was answered nor that it was not. The first page in doubt is read before it (`more`), and the
        // strip and the counts stay its own outcome's.
      } else if (token === run) {
        trouble.value = taken ? null : 'error'
        moved.value = !taken && history.showsAnswer()
      }
      if (token === run && !taken) failures.value += 1
    } catch (error) {
      reportFailure(error, 'screen')
      if (token === run) {
        trouble.value = navigator.onLine ? 'error' : 'offline'
        moved.value = false
        failures.value += 1
      }
    } finally {
      if (token === run) {
        busy.value = false
        loadingMore.value = false
      }
    }
  }
  /**
   * «Показать ещё». A next page says nothing of the first, and the screen is not the first page's only
   * reader — a finish sent reads it in the store (MOL-307, Е1). So a first page in doubt — a strip over
   * it, or a list moved under every read — is read again first, and its own outcome decides the strip and
   * the counts; then the next page, from the boundary it now has. Read after the next one, a first page
   * whose boundary had moved since the shelf threw the tapped page away and put the button back (Ж1).
   */
  async function more(): Promise<void> {
    if (trouble.value !== null || moved.value) {
      const owner = actor.id
      await load(false, true)
      // A read of this very list begun meanwhile — a receipt recorded starts one as the re-read ends — is
      // waited for, and the next page asked from the boundary it leaves (round 9 of MOL-307, Л1): stopped
      // by it, the tap brought nothing. A screen taken away, or another owner, ends the tap here (И1, З1).
      let seen: Promise<void>
      do {
        seen = latest
        await seen
        await nextTick()
      } while (seen !== latest)
      if (gone || owner !== actor.id) return
    }
    await load(true)
  }
  watch(
    () => actor.id,
    () => {
      run += 1
      void load()
    },
    { immediate: true },
  )
  useReconnect(() => {
    if (!loading.value) void load()
  })
  // A receipt recorded is a finished record the server made (MOL-127): «Записаны» is read again —
  // after a load already on its way, which may have set out before the record landed (review 15).
  let again = false
  watch(
    () => receipts.recorded.length,
    () => {
      if (loading.value) again = true
      else void load()
    },
  )
  watch(loading, (now) => {
    if (now || !again) return
    again = false
    void load()
  })
  // A screen taken away ends its asking: a retry asleep in its pause would otherwise wake and go
  // for the history again with nobody to show it to (round 3, И1).
  onScopeDispose(() => {
    gone = true
    run += 1
  })
  return {
    t,
    history,
    rows,
    loading,
    loadingMore,
    trouble,
    failures,
    moved,
    load: () => void load(),
    more: () => void more(),
    open: (tripId: string) => void router.push({ name: 'purchase', params: { tripId } }),
  }
}
