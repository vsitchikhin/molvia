import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { reportFailure } from '@/failures'

/**
 * How soon an unsure change is checked again, and how seldom at most (MOL-96, round 2, Р2-А1): the
 * rhythm of the consent's question (MOL-95) — five seconds, then twice as long, never longer than a
 * minute. A connection that tears its requests while the phone still says it is up sends no
 * `online` to wait for.
 */
export const TAP_CHECK_FIRST_MS = 5_000
export const TAP_CHECK_LAST_MS = 60_000

export interface TapSettingState<T> {
  /** The server's answer; undefined while it is not known yet. */
  readonly value: Ref<T | undefined>
  /** Why the setting could not be read — decided after the failure (MOL-19, A1). */
  readonly failure: Ref<'offline' | 'error' | null>
  readonly online: Ref<boolean>
  readonly saving: Ref<boolean>
  /** The last change did not reach an answer: the control is back where the server holds it. */
  readonly saveFailed: Ref<boolean>
  /**
   * The last change got no answer, and no read has said since whether it landed (MOL-96, А2): `value`
   * is the server's word from before it — a guess. Checked again by itself until a read answers.
   */
  readonly unsure: Ref<boolean>
  retry(): Promise<void>
  choose(next: T): Promise<void>
}

/**
 * A setting of the person's own saved on the tap, beside the settings form and never under its
 * «Сохранить» (MOL-134, В-5; MOL-103, Р-1). Nothing is kept on the phone: without a connection the
 * control waits, and what it shows is always what the server answered. `read` and `write` are the
 * two calls of its own address.
 */
export function useTapSetting<T>(
  read: () => Promise<T>,
  write: (next: T) => Promise<T>,
): TapSettingState<T> {
  const actor = useActorStore()
  const value = ref<T | undefined>(undefined) as Ref<T | undefined>
  const failure = ref<'offline' | 'error' | null>(null)
  const online = ref(navigator.onLine)
  const saving = ref(false)
  const saveFailed = ref(false)
  // A read that left before a change is older than it: its answer must not put the control back.
  let latest = 0
  // A change whose answer never came may have landed all the same — the answer, not the request,
  // is what a dropped connection loses — so what the control shows is only a guess until the
  // server is read again (adversarial MOL-96 А2): a privacy switch put back to «on» over a server
  // that already turned it off.
  const unsure = ref(false)
  let before: T | undefined
  let check: ReturnType<typeof setTimeout> | undefined
  let checkIn = TAP_CHECK_FIRST_MS

  function settle(): void {
    unsure.value = false
    clearTimeout(check)
    checkIn = TAP_CHECK_FIRST_MS
  }

  function checkLater(): void {
    clearTimeout(check)
    // Without a connection the check waits for it (useReconnect below), not for a clock.
    if (!online.value) return
    check = setTimeout(() => void load(), checkIn)
    checkIn = Math.min(checkIn * 2, TAP_CHECK_LAST_MS)
  }

  async function load(): Promise<void> {
    if (!actor.id || saving.value) return
    const mine = ++latest
    try {
      const answer = await read()
      if (mine !== latest) return
      // The change did land after all: «не сохранилось» is no longer true.
      if (unsure.value && JSON.stringify(answer) !== JSON.stringify(before))
        saveFailed.value = false
      settle()
      value.value = answer
      failure.value = null
    } catch (error) {
      reportFailure(error, 'screen')
      if (mine !== latest) return
      online.value = navigator.onLine
      // A read after a change is a check, not the screen's loading (round 2, №5 and Р2-А2): the
      // setting was read, only whether the change landed is not known, and a screen whose state is
      // its read — «Бот» — must not go to its error for it.
      if (unsure.value) checkLater()
      else failure.value = online.value ? 'error' : 'offline'
    }
  }

  // Shown at once and taken back if the answer does not come: the switch the browser already moved
  // has to follow the server, or a screen reader reads out a choice nobody holds.
  async function choose(next: T): Promise<void> {
    if (saving.value || value.value === undefined || value.value === next) return
    const shown = value.value
    latest += 1
    value.value = next
    saving.value = true
    saveFailed.value = false
    try {
      value.value = await write(next)
      settle()
    } catch {
      value.value = shown
      before = shown
      unsure.value = true
      // Offline or failed is decided after the failure (MOL-19, A1): a connection that dropped while
      // the answer was on its way is the grey «без связи», never the red «не сохранилось» (self-review 7).
      online.value = navigator.onLine
      saveFailed.value = online.value
    } finally {
      saving.value = false
    }
    // Asked at once while there is a connection; without one, when it comes back (below).
    if (unsure.value && online.value) await load()
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
    clearTimeout(check)
  })
  // The owner is named after the screen may already be up: a cold start asks `me()` first.
  watch(
    () => actor.id,
    (id) => {
      if (id && value.value === undefined) void load()
    },
  )
  useReconnect(() => {
    online.value = navigator.onLine
    if (online.value && (value.value === undefined || failure.value || unsure.value)) void load()
  })

  return { value, failure, online, saving, saveFailed, unsure, retry: load, choose }
}
