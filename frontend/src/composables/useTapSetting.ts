import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { ApiError } from '@molvia/client'
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

/**
 * A refusal the API said itself: its error body, under its build's header. A `2xx` is never one —
 * the change behind it went through, whatever became of the body on its way (Р4-А1).
 */
function refusedInWords(error: unknown): boolean {
  if (!(error instanceof ApiError) || !error.answered || !error.fromApi) return false
  return error.status === undefined || error.status < 200 || error.status >= 300
}

/**
 * What a screen since gone left untold, by owner and setting, for the page's life (round 8, Р8-А1;
 * round 9, Р9-А1): a change still unsure — its last choice — or one it learnt was not saved. The
 * screen that said «проверяем», or was left the moment its switch was tapped, may be gone before
 * the answer comes; it tells nobody and leaves what it learnt here, and the screen drawn on the way
 * back takes it — its first read is the check, or it says «не сохранилось» — and only a screen that
 * said so lets it go. In memory only: nothing of it is kept on the phone, and a reload reads the
 * server afresh — a named price.
 */
type LeftBehind = { readonly unsure: true; readonly choice: unknown } | { readonly unsure: false }
const leftBehind = new Map<string, LeftBehind>()

/** A fresh page, as a reload makes one: for the tests, which share one module between them. */
export function forgetUnsureChanges(): void {
  leftBehind.clear()
}

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
   * The last change got no answer, and no read has said since whether it landed (MOL-96, А2):
   * `value` is the server's word from before it — a guess. Checked again by itself until a read
   * answers.
   */
  readonly unsure: Ref<boolean>
  retry(): Promise<void>
  choose(next: T): Promise<void>
}

/**
 * A setting of the person's own saved on the tap, beside the settings form and never under its
 * «Сохранить» (MOL-134, В-5; MOL-103, Р-1). Nothing is kept on the phone: without a connection the
 * control waits, and what it shows is always what the server answered. `read` and `write` are the
 * two calls of its own address; `name` tells its unsure change from another setting's.
 */
export function useTapSetting<T>(
  name: string,
  read: () => Promise<T>,
  write: (next: T) => Promise<T>,
): TapSettingState<T> {
  const actor = useActorStore()
  const memory = (): string | undefined => (actor.id ? `${actor.id}:${name}` : undefined)
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
  // The last choice that got no «yes»: its «not saved» stays the truth whatever a check finds of an
  // earlier change — unless the server holds that very choice (round 5, Р5-А1; round 6, №11,
  // Р6-А1). An earlier tap may have put it there; with three values or more, «differs from before»
  // is not it.
  let lastChoice: { readonly choice: T } | undefined
  let check: ReturnType<typeof setTimeout> | undefined
  let checkIn = TAP_CHECK_FIRST_MS
  // Gone with its screen, it still hears what it asked: what it learns is left for the next one.
  let alive = true

  /** The person has been told — by this screen — what became of the change: nothing is left. */
  function told(): void {
    const key = memory()
    if (key) leftBehind.delete(key)
  }

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
    // What a screen since gone left: an unsure change, which this read checks, or one not saved.
    const key = memory()
    const left = unsure.value || !key ? undefined : leftBehind.get(key)
    if (left?.unsure) {
      lastChoice = { choice: left.choice as T }
      unsure.value = true
    }
    const mine = ++latest
    try {
      const answer = await read()
      if (mine !== latest) return
      const same = (one: unknown, other: unknown): boolean =>
        JSON.stringify(one) === JSON.stringify(other)
      const notSaved = unsure.value && lastChoice ? !same(answer, lastChoice.choice) : undefined
      if (!alive) {
        // Heard by a screen gone (Р9-А1): left for the next one, never let go here.
        if (key && notSaved !== undefined)
          if (notSaved) leftBehind.set(key, { unsure: false })
          else leftBehind.delete(key)
        return
      }
      // The check is the answer the change never got, either way (round 7, Р7-А1): lost offline,
      // it said only «без связи», and a check that finds the choice did not land says «не
      // сохранилось».
      if (notSaved !== undefined) saveFailed.value = notSaved
      else if (left && !left.unsure) saveFailed.value = true
      told()
      settle()
      value.value = answer
      failure.value = null
    } catch (error) {
      reportFailure(error, 'screen')
      if (mine !== latest || !alive) return
      online.value = navigator.onLine
      // A read after a change is a check, not the screen's loading (round 2, №5 and Р2-А2): the
      // setting was read, only whether the change landed is not known, and a screen whose state is
      // its read — «Бот» — must not go to its error for it. A screen drawn anew has read nothing
      // yet: its first read failing is its own failure, and the change stays unsure for the next.
      if (unsure.value && value.value !== undefined) checkLater()
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
      lastChoice = undefined
      told()
      settle()
    } catch (error) {
      value.value = shown
      lastChoice = { choice: next }
      // Unsure unless the API refused in its own words (round 3, №6; round 4, №9). Its refusal — a
      // 409, a 500 its handler wrote — rolled the change back, and «not saved» is the truth; a
      // `2xx` of any shape, whole and off the contract or cut off on its way (Р4-А1), may well have
      // landed. One unsure change is not made sure by a refusal of the next: it is still checked.
      unsure.value = unsure.value || !refusedInWords(error)
      const key = memory()
      if (key && unsure.value) leftBehind.set(key, { unsure: true, choice: next })
      // A refusal said to a screen gone is told by the next one.
      else if (key && !alive) leftBehind.set(key, { unsure: false })
      // Offline or failed is decided after the failure (MOL-19, A1): a connection that dropped while
      // the answer was on its way is the grey «без связи», never the red «не сохранилось» (self-review 7).
      online.value = navigator.onLine
      saveFailed.value = online.value
    } finally {
      saving.value = false
    }
    // A screen gone checks nothing: the one drawn on the way back does, with its first read.
    if (!alive) return
    // Asked at once while there is a connection; without one, when it comes back (below).
    if (unsure.value && online.value) await load()
    else if (!unsure.value) {
      told()
      settle()
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
    alive = false
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
