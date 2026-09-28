import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'

/** The day turning the setting on puts in: the one of the owner's sheet (MOL-134, В-5). */
export const SALARY_SHIFT_DEFAULT = 25

export interface SalaryShiftState {
  /** The server's answer: a day, null for off, undefined while it is not known yet. */
  readonly day: Ref<number | null | undefined>
  /** Why the setting could not be read — decided after the failure (MOL-19, A1). */
  readonly failure: Ref<'offline' | 'error' | null>
  readonly online: Ref<boolean>
  readonly saving: Ref<boolean>
  /** The last change did not reach an answer: the switch is back where the server holds it. */
  readonly saveFailed: Ref<boolean>
  retry(): Promise<void>
  choose(day: number | null): Promise<void>
}

/**
 * «Зарплата с … числа — в следующий месяц» on the settings screen (MOL-134, В-3): saved on the tap,
 * as «мой курс / ЦБ РА» is (В-5), never part of the form under «Сохранить» — its four fields are also
 * a trip's context (Н-1). Nothing is kept on the phone: without a connection the switch waits, and
 * what it shows is always what the server answered.
 */
export function useSalaryShift(): SalaryShiftState {
  const actor = useActorStore()
  const day = ref<number | null | undefined>(undefined)
  const failure = ref<'offline' | 'error' | null>(null)
  const online = ref(navigator.onLine)
  const saving = ref(false)
  const saveFailed = ref(false)
  // A read that left before a change is older than it: its answer must not put the switch back.
  let latest = 0

  async function load(): Promise<void> {
    if (!actor.id || saving.value) return
    const mine = ++latest
    try {
      const answer = await api.salaryShift()
      if (mine !== latest) return
      day.value = answer.day
      failure.value = null
    } catch {
      if (mine !== latest) return
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  // Shown at once and taken back if the answer does not come: the switch the browser already moved
  // has to follow the server, or a screen reader reads out a choice nobody holds.
  async function choose(next: number | null): Promise<void> {
    if (saving.value || day.value === undefined || day.value === next) return
    const shown = day.value
    latest += 1
    day.value = next
    saving.value = true
    saveFailed.value = false
    try {
      day.value = (await api.chooseSalaryShift(next)).day
    } catch {
      day.value = shown
      // Offline or failed is decided after the failure (MOL-19, A1): a connection that dropped while
      // the answer was on its way is the grey «без связи», never the red «не сохранилось» (self-review 7).
      online.value = navigator.onLine
      saveFailed.value = online.value
    } finally {
      saving.value = false
    }
  }

  const offline = (): void => {
    online.value = false
  }
  onMounted(() => {
    window.addEventListener('offline', offline)
    void load()
  })
  onUnmounted(() => {
    window.removeEventListener('offline', offline)
  })
  // The owner is named after the screen may already be up: a cold start asks `me()` first.
  watch(
    () => actor.id,
    (id) => {
      if (id && day.value === undefined) void load()
    },
  )
  useReconnect(() => {
    online.value = navigator.onLine
    if (online.value && (day.value === undefined || failure.value)) void load()
  })

  return { day, failure, online, saving, saveFailed, retry: load, choose }
}
