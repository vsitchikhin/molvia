import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { IncomeAmendBody, IncomeBody, IncomeView, IncomesResponse } from '@molvia/model'
import { api } from '@/api'
import type { AmendOutcome } from '@/composables/useExchanges'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'

/** `idle` — no identity yet, so there is nobody whose incomes to ask for. */
export type IncomesPhase = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'offline'

export interface Incomes {
  readonly phase: ComputedRef<IncomesPhase>
  readonly overview: Ref<IncomesResponse | null>
  /** A write in the air: a removal, «Вернуть». The form of the sheet keeps its own. */
  readonly busy: Ref<boolean>
  /** A write that failed — said once, above the list, and cleared by the next one. */
  readonly failed: Ref<boolean>
  /** The income just removed, offered back by «Вернуть» until another request makes it final. */
  readonly removed: Ref<IncomeView | null>
  /** The last «Сохранить» named an income already written otherwise (В-6). */
  readonly conflicted: Ref<boolean>
  /** The last amendment was made over a version another device had moved on from. */
  readonly amendConflicted: Ref<boolean>
  /** The income being amended is gone — removed elsewhere: the list is read again. */
  readonly vanished: Ref<boolean>
  /** «Вернуть» came after the removal became final. */
  readonly gone: Ref<boolean>
  /** The last «Вернуть» brought the income back — said out loud, the button being gone. */
  readonly restored: Ref<boolean>
  retry(): Promise<void>
  /** Resolves `null` when the server holds another income under this name (В-6). */
  record(body: IncomeBody): Promise<IncomesResponse | null>
  amend(id: string, body: IncomeAmendBody): Promise<AmendOutcome>
  remove(income: IncomeView): Promise<void>
  restore(): Promise<void>
}

/** Every income of the answer, newest first — the months hold them. */
export function incomesOf(overview: IncomesResponse | null): IncomeView[] {
  return overview?.months.flatMap(({ incomes }) => incomes) ?? []
}

/**
 * «Доходы» as this phone sees it (MOL-66): the server's answer and nothing worked out here — the
 * sums of each month are the server's. The rules are «Обмен денег»'s (MOL-40, MOL-42), each for
 * the same reason, and are said there at length: only the newest answer lands; «Вернуть» goes when
 * a write reached the server, never on a tap; a conflict and a missing income read the list again.
 *
 * Nothing is kept on the phone: an income is written at home with a connection, and without one
 * the screen says so rather than showing sums of unknown age.
 */
export function useIncomes(): Incomes {
  const actor = useActorStore()
  const overview = ref<IncomesResponse | null>(null)
  const failure = ref<'offline' | 'error' | null>(null)
  const busy = ref(false)
  const failed = ref(false)
  const removed = ref<IncomeView | null>(null)
  const conflicted = ref(false)
  const amendConflicted = ref(false)
  const vanished = ref(false)
  const gone = ref(false)
  const restored = ref(false)
  let latest = 0

  function land(answer: IncomesResponse): void {
    latest += 1
    overview.value = answer
    failure.value = null
  }

  async function load(): Promise<void> {
    if (!actor.id) return
    const mine = ++latest
    try {
      const answer = await api.incomes()
      if (mine !== latest) return
      overview.value = answer
      failure.value = null
    } catch {
      if (mine !== latest) return
      // Decided after the failure, never before the request (MOL-19, A1).
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  const phase = computed<IncomesPhase>(() => {
    if (!actor.id) return 'idle'
    if (overview.value) return overview.value.months.length > 0 ? 'ready' : 'empty'
    return failure.value ?? 'loading'
  })

  /** Every word above the list is about the last write; a new one takes them all away. */
  function hush(): void {
    failed.value = false
    conflicted.value = false
    amendConflicted.value = false
    vanished.value = false
    gone.value = false
    restored.value = false
  }

  onMounted(() => void load())
  watch(
    () => actor.id,
    () => {
      // Everything of the last owner goes with them, «Вернуть» with their amounts first.
      overview.value = null
      failure.value = null
      hush()
      removed.value = null
      void load()
    },
  )
  useReconnect(() => {
    if (failure.value) void load()
  })

  return {
    phase,
    overview,
    busy,
    failed,
    removed,
    conflicted,
    amendConflicted,
    vanished,
    gone,
    restored,
    retry: load,
    async record(body) {
      hush()
      try {
        const { incomes } = await api.recordIncome(body)
        land(incomes)
        removed.value = null
        return incomes
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === ERROR.CONFLICT && caught.answered) {
          removed.value = null
          conflicted.value = true
          await load()
          return null
        }
        throw caught
      }
    },
    async amend(id, body) {
      hush()
      try {
        land(await api.amendIncome(id, body))
        removed.value = null
        return 'saved'
      } catch (caught) {
        const answered = caught instanceof ApiError && caught.answered
        if (answered && caught.code === ERROR.CONFLICT) {
          removed.value = null
          amendConflicted.value = true
          await load()
          return 'conflict'
        }
        if (answered && caught.code === ERROR.NOT_FOUND) {
          removed.value = null
          vanished.value = true
          await load()
          return 'gone'
        }
        throw caught
      }
    },
    async remove(income) {
      if (busy.value) return
      busy.value = true
      hush()
      try {
        land(await api.removeIncome(income.id))
        removed.value = income
      } catch {
        failed.value = true
      } finally {
        busy.value = false
      }
    },
    async restore() {
      const income = removed.value
      if (!income || busy.value) return
      busy.value = true
      failed.value = false
      gone.value = false
      try {
        land(await api.restoreIncome(income.id))
        removed.value = null
        restored.value = true
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === ERROR.NOT_FOUND && caught.answered) {
          removed.value = null
          gone.value = true
          await load()
        } else {
          failed.value = true
        }
      } finally {
        busy.value = false
      }
    },
  }
}
