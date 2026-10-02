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

/** The last refusal any call met, and when (MOL-147, В-1). */
let refused: { readonly code: WireCode; readonly at: number } | undefined

/** How long a refusal stays the reason of an error screen shown after it. */
export const REFUSAL_FRESH_MS = 60_000

/**
 * The code of the last refusal, if it came within `REFUSAL_FRESH_MS` before `now` — what an error
 * screen says it failed with in a message to the developer (MOL-147, В-1). No screen keeps the code
 * itself: every loader turns a failure into «offline» or «error» before the screen sees it, so the
 * one seam every call passes through keeps it instead. Another call failing in the same minute
 * lends its code — the sheet shows it before anything is sent.
 */
export function lastRefusal(now: number = Date.now()): WireCode | null {
  return refused !== undefined && now - refused.at <= REFUSAL_FRESH_MS ? refused.code : null
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
function watching<T extends Call>(call: T): T {
  return (async (...args: never[]) => {
    try {
      return await call(...args)
    } catch (error) {
      if (error instanceof ApiError) {
        refused = { code: error.code, at: Date.now() }
        if (error.code === ERROR.NO_ACTOR) missing?.()
      }
      throw error
    }
  }) as T
}

export const api = Object.fromEntries(
  Object.entries(client).map(([name, call]) => [name, watching(call)]),
) as MolviaClient
