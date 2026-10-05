import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
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
 * A change of the page's life, by owner and setting, as long as some screen still has to say how it
 * ended (rounds 8–10, Р8-А1…Р10-А1): on its way (`writing`) — a write a screen may have left the
 * moment its switch was tapped; `unsure` — its answer lost, so its last choice waits for a check;
 * or `refused` — known not saved. Every screen of the setting sees it: one drawn while a write is
 * on its way says «не знаем» and draws no conclusion until the write ends, and hears the end the
 * moment it comes, since the map is reactive. Only a screen alive lets an entry go, once it has
 * said how the change ended. `by` names the screen that wrote it, so a screen does not answer
 * itself. In memory only: nothing of it is kept on the phone, and a reload reads the server afresh
 * — a named price.
 */
type LeftBehind =
  | { readonly state: 'writing' | 'unsure'; readonly choice: unknown; readonly by: symbol }
  | { readonly state: 'refused'; readonly by: symbol }
const leftBehind = reactive(new Map<string, LeftBehind>())

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
  /**
   * Unsure because a write — another screen's, left on its way — has not ended yet: no answer has
   * been lost, it is still to come (round 12: «ответ не пришёл» was said of it too).
   */
  readonly pending: Ref<boolean>
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
  const pending = ref(false)
  // The last choice that got no «yes»: its «not saved» stays the truth whatever a check finds of an
  // earlier change — unless the server holds that very choice (round 5, Р5-А1; round 6, №11,
  // Р6-А1). An earlier tap may have put it there; with three values or more, «differs from before»
  // is not it.
  let lastChoice: { readonly choice: T } | undefined
  let check: ReturnType<typeof setTimeout> | undefined
  let checkIn = TAP_CHECK_FIRST_MS
  // Gone with its screen, it still hears what it asked: what it learns is left for the next one.
  let alive = true
  const me = Symbol(name)
  const same = (one: unknown, other: unknown): boolean =>
    JSON.stringify(one) === JSON.stringify(other)

  /**
   * Writes the setting's entry, or lets it go — only where it is this screen's own, or the very
   * one named (`over`), or `'any'` for a new choice, always the last. A later screen's change owns
   * the key, and the end of an earlier one is not its to overwrite (round 11, Р11-А1).
   */
  function leave(entry: LeftBehind | undefined, over?: LeftBehind | 'any'): void {
    const key = memory()
    if (!key) return
    const current = leftBehind.get(key)
    if (current && over !== 'any' && current.by !== me && current !== over) return
    if (entry) leftBehind.set(key, entry)
    else leftBehind.delete(key)
  }

  /** The person has been told — by this screen — what became of the change: nothing is left. */
  function told(over?: LeftBehind): void {
    leave(undefined, over)
  }

  function settle(): void {
    unsure.value = false
    pending.value = false
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
    const key = memory()
    // What another screen left: a change on its way or unsure, which this read checks.
    const left = unsure.value || !key ? undefined : leftBehind.get(key)
    if (left && left.state !== 'refused') {
      lastChoice = { choice: left.choice as T }
      unsure.value = true
      pending.value = left.state === 'writing'
    }
    const mine = ++latest
    try {
      const answer = await read()
      if (mine !== latest) return
      // As it stands now: a write on its way may have ended while this read was out.
      const now = key ? leftBehind.get(key) : undefined
      if (now?.state === 'writing') {
        // On its way: no conclusion until it ends — unless the server already holds its choice.
        if (!alive) return
        value.value = answer
        failure.value = null
        if (same(answer, now.choice)) settle()
        else {
          lastChoice = { choice: now.choice as T }
          unsure.value = true
          pending.value = true
          checkLater()
        }
        return
      }
      // Another screen's change left unsure while this read was out: this read is its check too.
      if (now?.state === 'unsure' && now.by !== me) {
        lastChoice = { choice: now.choice as T }
        unsure.value = true
      }
      pending.value = false
      const notSaved =
        now?.state === 'refused'
          ? true
          : unsure.value && lastChoice
            ? !same(answer, lastChoice.choice)
            : undefined
      if (!alive) {
        // Heard by a screen gone (Р9-А1): left for the next one, never let go here.
        if (notSaved !== undefined) leave(notSaved ? { state: 'refused', by: me } : undefined)
        return
      }
      // The check is the answer the change never got, either way (round 7, Р7-А1): lost offline,
      // it said only «без связи», and a check that finds the choice did not land says «не
      // сохранилось».
      if (notSaved !== undefined) saveFailed.value = notSaved
      told(now)
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
    // On its way, for any screen of the setting drawn before it ends (round 10, Р10-А1).
    leave({ state: 'writing', choice: next, by: me }, 'any')
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
      pending.value = false
      if (unsure.value) leave({ state: 'unsure', choice: next, by: me })
      // A refusal said to a screen gone is told by the next one; said here, it is told here.
      else leave(alive ? undefined : { state: 'refused', by: me })
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
    else if (!unsure.value) settle()
  }

  // Another screen's change ended — or another screen let it go — while this one waits on it.
  watch(
    () => {
      const key = memory()
      return key ? leftBehind.get(key) : undefined
    },
    (entry, before) => {
      if (!alive || saving.value || entry?.by === me || before?.by === me) return
      if (entry?.state === 'writing') return
      if (before?.state === 'writing' || entry) void load()
    },
  )

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

  return { value, failure, online, saving, saveFailed, unsure, pending, retry: load, choose }
}
