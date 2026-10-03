import { ApiError, createClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { MolviaClient } from '@molvia/client'
import type { WireCode } from '@molvia/model'
import { localDay } from '@/days'

// Nothing about identity is passed in, and that is the change MOL-53 made: what proves a
// request is the session cookie, which the browser attaches and no script can read.
// `credentials: 'same-origin'` is already every browser's default — it is written out because
// it is now load-bearing, and a silent change to `omit` would log everybody out.
//
// Vite proxies /api to this copy's API port, so the origin is never hardcoded.
const client = createClient({
  baseUrl: '/api',
  credentials: 'same-origin',
  onVersion: (version) => {
    heard?.(version)
  },
  // The phone's today on every request (MOL-121): the server counts «today» of money by it.
  today: () => localDay(),
  // Where the phone's days begin and end (MOL-121, adversarial round 4 У, Ч): by name, as the
  // system says it — the server knows a named zone's summer time, never an offset's.
  zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
})

/** Told that the session behind this browser is gone. Registered by the actor store. */
let missing: (() => void) | undefined

/** Told the build each answer names (MOL-132). Registered by the worker's update. */
let heard: ((version: string) => void) | undefined

export function onServerVersion(told: (version: string) => void): void {
  heard = told
}

export function onMissingActor(told: () => void): void {
  missing = told
}

/**
 * The last refusals any call met, and when (MOL-147, В-1) — newest last. More than one, since the
 * question is asked as of a moment past: what an error screen was shown with, after other calls may
 * have failed meanwhile — a retry, a queue sending, a check of who we are (adversarial Н4).
 */
const refusals: { readonly code: WireCode | null; readonly at: number }[] = []

/** How many are kept: far more than fail between an error shown and a tap on its link. */
const REFUSALS_KEPT = 32

/** How long a refusal stays the reason of an error screen shown after it. */
export const REFUSAL_FRESH_MS = 60_000

/**
 * The code of the last refusal, if it came within `REFUSAL_FRESH_MS` before `now` — the moment an
 * error screen is shown, which keeps it for a message to the developer (MOL-147, В-1). No screen
 * keeps the code itself: every loader turns a failure into «offline» or «error» before the screen
 * sees it, so the one seam every call passes through keeps it instead. Another call failing in the
 * same minute lends its code — the sheet shows it before anything is sent.
 *
 * Only what came back from the server has a code: a connection dropped or a reply never waited out
 * has none of the API's, and the client's `error.internal` for it would send the developer looking
 * for a failure in a log that has none (adversarial В3а). It is kept all the same, with no code: the
 * last failure before a screen broke on a dropped connection is that one, and another call's code a
 * minute older must not stand in for it (round 3, Ф2). Nor is the sheet's own refusal one: «too many
 * today» is not why a screen broke (В3б).
 */
export function lastRefusal(now: number = Date.now()): WireCode | null {
  const before = refusals.findLast((refusal) => refusal.at <= now)
  return before !== undefined && now - before.at <= REFUSAL_FRESH_MS ? before.code : null
}

type Call = (...args: never[]) => Promise<unknown>

/**
 * **A session that ended is news for the whole app, so it is heard in one place** (MOL-56).
 *
 * Before this, `error.no_actor` was read by three callers out of a dozen and a half — the
 * settings form, the trip queue and the verdict drafts — and every other screen showed «что-то
 * пошло не так» about an account that was simply no longer there. Now any refusal of that code,
 * whichever call earned it, raises the login screen, and the refusal still reaches its caller
 * unchanged: this seam listens, it does not swallow.
 *
 * **What it deliberately does not do is look at the status.** Telling `error.no_actor` from a
 * bare `401` is `packages/client`'s rule and stays there (`CODE_BY_STATUS`): basic auth on a
 * proxy, a gateway and a shop's captive portal all answer 401 without knowing what an actor is,
 * and reading those as «signed out» would empty an account's screen over a wifi splash page.
 *
 * Wrapped by walking the client rather than by listing its methods: a call added later would
 * otherwise lose the seam silently, which is the failure this replaces.
 */
function watching<T extends Call>(call: T, remembered: boolean): T {
  return (async (...args: never[]) => {
    try {
      return await call(...args)
    } catch (error) {
      if (error instanceof ApiError) {
        const replied = error.answered || error.status !== undefined
        if (remembered) {
          refusals.push({ code: replied ? error.code : null, at: Date.now() })
          if (refusals.length > REFUSALS_KEPT) refusals.shift()
        }
        if (error.code === ERROR.NO_ACTOR) missing?.()
      }
      throw error
    }
  }) as T
}

export const api = Object.fromEntries(
  Object.entries(client).map(([name, call]) => [name, watching(call, name !== 'sendFeedback')]),
) as MolviaClient
