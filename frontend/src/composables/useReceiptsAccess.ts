import { computed, onMounted, onUnmounted, watch } from 'vue'
import type { ComputedRef } from 'vue'
import {
  modelAlone,
  monthOf,
  nextMonth,
  photoReceiptCountrySchema,
  receiptsClosedBy,
} from '@molvia/model'
import type { PhotoReceiptCountry, ReceiptsAccess, ReceiptsClosed } from '@molvia/model'
import { api } from '@/api'
import { useLocalDay } from '@/composables/useLocalDay'
import { useReconnect } from '@/composables/useReconnect'
import { calendarDay, dateOfAnyYear } from '@/days'
import { IDENTITY_RETRY_FIRST_MS, IDENTITY_RETRY_LAST_MS, useActorStore } from '@/stores/actor'
import { useFf } from '@/stores/ff'
import { doublingRetry } from '@/stores/queueing'
import { read, write } from '@/stores/storage'

/** What the person chose in «Пробные чеки закончились»: the camera all the same, the record by hand, a word to the developer. */
export type ReceiptsClosedWay = 'photo' | 'manual' | 'developer'

/** What the sheet says, as it stands at the tap: the reason, the server's figures, whether Tesseract reads. */
export interface ReceiptsShown {
  readonly reason: ReceiptsClosed
  readonly access: ReceiptsAccess
  readonly othersRead: boolean
}

/** What the sheet «Пробные чеки закончились» was shown for on this phone, per owner (MOL-276, В-1 «а»). */
const TOLD_KEY = 'molvia.receipts-told'

interface Told {
  /** The trial's end was said: once ever, it does not come back. */
  readonly trial?: boolean
  /** The paid reading whose end was said, by its moment (adversarial А2): once for each grant that runs out. */
  readonly ended?: string
  /** The month whose hundred was said (`YYYY-MM-01`): once a month. */
  readonly month?: string
}

function toldOf(owner: string): Told {
  try {
    const raw = read(`${TOLD_KEY}.${owner}`)
    const kept = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    return {
      ...(kept.trial === true ? { trial: true } : {}),
      ...(typeof kept.ended === 'string' ? { ended: kept.ended } : {}),
      ...(typeof kept.month === 'string' ? { month: kept.month } : {}),
    }
  } catch {
    // Unreadable is never said: the sheet comes once more.
    return {}
  }
}

/**
 * The moment a paid reading ran out, which the reason `ended` stands on: `receiptsClosedBy` names it only with one,
 * so none here is a defect to see, never words with a hole in them (review №8).
 */
function endedOf(access: ReceiptsAccess): Date {
  if (!access.ended) throw new Error('the reason `ended` with no moment it ended')
  return access.ended
}

/** What a sheet shown says was told: the trial at all, a grant by its end, the hundred by its month. */
function toldNow({ reason, access }: ReceiptsShown): Told {
  if (reason === 'trial') return { trial: true }
  if (reason === 'ended') return { ended: endedOf(access).toISOString() }
  return { month: access.month }
}

/**
 * The figures of the month's hundred in words (review №3): the month's name, the hundred and the first of the next
 * month — one place for the status of «Настройки» and the sheet, so the two never part.
 */
export function monthWords(
  access: ReceiptsAccess,
  t: (key: string) => string,
  locale: string,
): { month: string; limit: number; next: string } {
  return {
    month: t(`spending.month_in.${access.month.slice(5, 7)}`),
    limit: access.limit,
    next: calendarDay(`${nextMonth(monthOf(access.month))}-01`, locale),
  }
}

/**
 * The figures a reason's words are said with (review №8): the trial's ten, the day a paid reading ran out, the month's
 * hundred — one place for the status of «Настройки» and the sheet.
 */
export function closedWords(
  reason: ReceiptsClosed,
  access: ReceiptsAccess,
  t: (key: string) => string,
  locale: string,
  today: string,
): Record<string, string | number> {
  if (reason === 'trial') return { of: access.trialOf }
  if (reason === 'ended') return { date: dateOfAnyYear(endedOf(access), locale, today, 'long') }
  return monthWords(access, t, locale)
}

/**
 * Where the person stands with the model that reads receipts (MOL-276): the server's figures as `/actors/me` last
 * said them (`receiptsAccess`), the reason the model reads no more (`receiptsClosedBy`, the domain's) and whether
 * anyone reads in its place — Tesseract, while the фф `payments` is off, in a country it reads (MOL-275, В-1 «в»).
 * Only for a country whose receipts are read off the photo: Serbia's come by their link, and the model reads none.
 */
export function useReceiptsAccess(): {
  /** The country of the settings when its receipts are read off the photo, else none — no status there. */
  readonly country: ComputedRef<PhotoReceiptCountry | null>
  /** The server's figures; none where it has not said them — a launch offline, a server before MOL-275. */
  readonly access: ComputedRef<ReceiptsAccess | null>
  readonly closed: ComputedRef<ReceiptsClosed | null>
  /** With the model closed, Tesseract still reads the receipt (В-1): the camera stays a way on. */
  readonly othersRead: ComputedRef<boolean>
  /**
   * The sheet a tap on «Сфотографировать чек» meets first, as it stands now, or none (В-1 «а»): at every tap where
   * nobody would read the receipt, else once — the trial once ever, a grant run out once for each, the month's
   * hundred once a month. Only asks: the sheet shown is marked by `told` (review №1, №9).
   */
  readonly sheetFirst: () => ReceiptsShown | null
  /** Marks this sheet shown, where it is shown once. */
  readonly told: (shown: ReceiptsShown) => void
  /**
   * Asks `/actors/me` again, quietly (Р-3): as the app comes back into view and at midnight with a screen in view
   * (adversarial А3) — a month's hundred opens again on the 1st. `verify` asks once for everyone who asks with it.
   */
  readonly askAgain: () => void
  /** Whether a question may go now (review №20): a country read off the photo, the identity settled, a connection. */
  readonly canAsk: () => boolean
} {
  const actor = useActorStore()
  const payments = useFf('payments')
  const country = computed(() => {
    const parsed = photoReceiptCountrySchema.safeParse(actor.settings?.country)
    return parsed.success ? parsed.data : null
  })
  const access = computed(() => (country.value ? (actor.actor?.receiptsAccess ?? null) : null))
  const closed = computed(() => (access.value ? receiptsClosedBy(access.value) : null))
  const othersRead = computed(
    () => !payments.value && country.value !== null && !modelAlone(country.value),
  )

  function sheetFirst(): ReceiptsShown | null {
    const reason = closed.value
    const figures = access.value
    const owner = actor.id
    if (!reason || !figures || !owner) return null
    const shown = { reason, access: figures, othersRead: othersRead.value }
    if (!shown.othersRead) return shown
    const said = toldNow(shown)
    const kept = toldOf(owner)
    return said[reason] === kept[reason] ? null : shown
  }

  function told(shown: ReceiptsShown): void {
    const owner = actor.id
    if (!owner || !shown.othersRead) return
    write(`${TOLD_KEY}.${owner}`, JSON.stringify({ ...toldOf(owner), ...toldNow(shown) }))
  }

  // only where receipts are read off the photo: nothing here would change what anyone else sees
  function canAsk(): boolean {
    return country.value !== null && actor.state === 'ready' && navigator.onLine
  }

  function askAgain(): void {
    if (canAsk()) void actor.verify()
  }

  return { country, access, closed, othersRead, sheetFirst, told, canAsk, askAgain }
}

/** A grant a day or less from running out is waited for; a later one by the next midnight's answer. */
const GRANT_WAIT_MAX_MS = 24 * 60 * 60 * 1000
/** A moment past the grant's end, so the server's clock has passed it too when asked. */
const GRANT_END_SLACK_MS = 2_000

/**
 * Keeps where the person stands as fresh as the screen that acts on it (MOL-276, Р-3) — the one rule of when to ask
 * `/actors/me` again (review №12): as the app comes back into view and at midnight (adversarial А3); as the screen
 * comes, where the figures are of a month before the phone's — an app put away on another screen over midnight (Б2);
 * and as a paid reading runs out with the screen in view, its `until` known (Б3). The phone only decides to ask: what
 * it says is the server's answer.
 *
 * Called by the screens that hold the camera — «Что брать» and «Покупки» — never by the button: Georgia's camera gone
 * with a share spent would take the asking with it, and the 1st that gives the share back went unheard (adversarial
 * В2). `readByScreen` — the settings, whose form reads `/actors/me` as it opens and as the app comes back — keeps the
 * midnight and the grant's end alone, so the same moment is not asked twice.
 */
export function useAccessKeptFresh({
  readByScreen = false,
}: { readByScreen?: boolean } = {}): void {
  const { access, canAsk, askAgain } = useReceiptsAccess()
  const actor = useActorStore()
  const today = useLocalDay()
  watch(today, askAgain)
  if (!readByScreen) {
    useReconnect(askAgain)
    onMounted(() => {
      const figures = access.value
      if (figures && monthOf(figures.month) < monthOf(today.value)) askAgain()
    })
  }

  // A grant's end is asked by the screen's own question, `api.me()` taken in by `apply` as «Что брать» takes its own —
  // never `verify`, which asks nothing while another question is out (adversarial Д1, Е1, Е2): an answer to a question
  // asked before the end, heard after it, could not be told from the answer to this one, and every order of answers
  // that let one stand for the other left the end unheard until midnight. So the moment is marked by the answer to
  // this question alone, asked after the moment by the phone's clock: an answer still naming it is believed — a phone
  // whose clock runs ahead of the server's asks once a moment, never every two seconds (В1) — and another answer heard
  // past the moment asks only where this question is neither out, nor answered, nor on its way. Armed again by every
  // answer — the one at midnight sets the timer for a grant a day off (Г1). A question with no answer is asked again
  // with a doubling pause, the identity's rhythm, until it is answered or another answer says the grant is over.
  let grantEnds: ReturnType<typeof setTimeout> | undefined
  /** The moment `grantEnds` waits for, until it fires. */
  let armedFor: number | undefined
  /** The `until` the answer to this screen's own question named. */
  let heardPast: number | undefined
  let out = false
  let gone = false
  /** Read after an `await`: the screen may have gone while the question was out. */
  const alive = (): boolean => !gone
  let cameWith = true
  const unheard = doublingRetry(
    () => void askAboutEnd(),
    IDENTITY_RETRY_FIRST_MS,
    IDENTITY_RETRY_LAST_MS,
  )

  async function askAboutEnd(): Promise<void> {
    if (out || gone) return
    if (!canAsk()) {
      unheard.later()
      return
    }
    out = true
    try {
      const loaded = await api.me()
      // An answer the store let go — a row newer came meanwhile, «Сохранить» in «Настройки» — is none (adversarial Ж1)
      if (actor.apply(loaded)) {
        heardPast = loaded.receiptsAccess?.until?.getTime()
        unheard.reset()
      } else if (alive()) unheard.later()
    } catch {
      // A refusal of the session goes to `verify` through the API's seam; any other failure is asked again.
      if (alive()) unheard.later()
    } finally {
      out = false
    }
  }

  function stop(): void {
    clearTimeout(grantEnds)
    armedFor = undefined
    unheard.cancel()
    unheard.reset()
  }

  watch(
    access,
    (figures) => {
      const fromServer = !cameWith
      cameWith = false
      const until = figures?.until?.getTime()
      if (until === undefined) {
        stop()
        return
      }
      const left = until - Date.now()
      if (fromServer && left <= 0 && (out || heardPast === until || armedFor === until)) return
      stop()
      if (left > GRANT_WAIT_MAX_MS) return
      armedFor = until
      grantEnds = setTimeout(
        () => {
          armedFor = undefined
          void askAboutEnd()
        },
        Math.max(0, left) + GRANT_END_SLACK_MS,
      )
    },
    { immediate: true },
  )
  onUnmounted(() => {
    gone = true
    stop()
  })
}
