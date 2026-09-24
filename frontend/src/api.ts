import { ApiError, createClient } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { MolviaClient } from '@molvia/client'

// Nothing about identity is passed in, and that is the change MOL-53 made: what proves a
// request is the session cookie, which the browser attaches and no script can read.
// `credentials: 'same-origin'` is already every browser's default — it is written out because
// it is now load-bearing, and a silent change to `omit` would log everybody out.
//
// Vite proxies /api to this copy's API port, so the origin is never hardcoded.
const client = createClient({ baseUrl: '/api', credentials: 'same-origin' })

/** Told that the session behind this browser is gone. Registered by the actor store. */
let missing: (() => void) | undefined

export function onMissingActor(told: () => void): void {
  missing = told
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
      if (error instanceof ApiError && error.code === ERROR.NO_ACTOR) missing?.()
      throw error
    }
  }) as T
}

export const api = Object.fromEntries(
  Object.entries(client).map(([name, call]) => [name, watching(call)]),
) as MolviaClient
