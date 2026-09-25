/**
 * Who this browser was the last time the server said so — and, since MOL-53, **nothing more
 * than that**.
 *
 * The value used to be the whole proof of identity: it rode in a header on every request, so
 * losing it was losing the data, and around that grew a machinery of set-aside keys, a «bring
 * my data back» button and a claim two tabs negotiated over. All of it is gone with the header.
 * What proves a request now is a session cookie the browser owns and no script can read.
 *
 * What is left is a **cache of the owner's id, used as the name of a drawer** (Р-9): the trip
 * queue, the recent items, the recent places and the verdict drafts are all kept per person in
 * `localStorage`, and at the shelf with no signal they have to be found **before** the server
 * can be asked who we are. So it is written from the answer to `GET /actors/me` and read when
 * there is nobody to ask. It goes nowhere.
 *
 * The price is named and not fixed here: Safari wipes the storage of a site not opened for
 * seven days, and with it whatever the trip queue had not sent. That is a property of MOL-24;
 * the session itself survives, because a cookie the server set is not what ITP caps.
 */
import { forget, forgetWhere, read, reshape, sharedHolds, write } from '@/stores/storage'

const KEY = 'molvia.actor'

/**
 * Where the login screen keeps the request in progress and the owner this device approved
 * (MOL-56). Named here rather than in the login store, because erasing an owner has to reach it and
 * this module is the leaf both depend on.
 */
export const LOGIN_KEY = 'molvia.login'

/** «Выйти» was pressed for this owner and has not been confirmed yet (MOL-57, adversarial Б2). */
const LEAVING_KEY = 'molvia.leaving'

/** What this browser is right now. `null` until `/actors/me` has answered once. */
let current: string | null = null

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A value only becomes this device's key if it could be one (О-8). */
export function isIdentifier(value: string | null): value is string {
  return value !== null && UUID.test(value)
}

/** Memory first, storage only to seed it — a tab that cannot write still knows who it is. */
export function currentIdentity(): string | null {
  if (current === null) {
    const stored = read(KEY)
    if (isIdentifier(stored)) {
      if (erasedElsewhere(stored)) forgetOwner(stored)
      else current = stored
    }
  }
  return current
}

/**
 * Asks again whether the drawer this tab knows was erased in another window — what a launch and a
 * return to the tab do (`actor.start`). A tab the browser froze wakes with its memory intact and
 * the event it slept through never delivered, so the answer cached above is not enough.
 */
export function erasedWhileAway(): boolean {
  const owner = current ?? read(KEY)
  if (!isIdentifier(owner) || !erasedElsewhere(owner)) return false
  forgetOwner(owner)
  return true
}

/**
 * The drawer is on this tab's own shelf and on no other — «Выйти» in another window took it from
 * the shared one while this tab did not hear it (MOL-57, round 2, Д2). The event reaches live
 * documents only: a tab the browser unloaded to save memory, or one closed and reopened, gets its
 * `sessionStorage` back without it, and `read` falling back there opened the app of the person who
 * left.
 *
 * Every write of the app goes to both shelves, so a drawer only here, with **not one key of this
 * owner** on a shared shelf that works, is a drawer erased there. A shelf that cannot be written
 * says nothing (`null`): with it refusing, this tab's shelf is the only one, legitimately.
 */
function erasedElsewhere(owner: string): boolean {
  return (
    sharedHolds(
      (key) => key === KEY || (key.startsWith('molvia.') && key.endsWith(`.${owner}`)),
    ) === false
  )
}

/**
 * Everything this device keeps for one owner, and the name of the drawer itself (MOL-57, owner's
 * decision Q1). What «Выйти» leaves behind.
 *
 * **By the suffix, not by a list.** Every store files its data as `molvia.<what>.<owner>` — the
 * trip queue, the drafts, the remembered answers — so a store added next month is swept without
 * anybody remembering to add it here; `identity.test.ts` pins which keys exist, so a new key that
 * breaks the shape is a decision rather than a leak.
 *
 * **Every shelf this window can reach, and that is not every shelf there is** (adversarial А1).
 * `sessionStorage` belongs to one tab, so the window where «Выйти» was pressed cannot clear its
 * neighbours' — each neighbour calls this for itself when it hears the drawer go.
 *
 * The login record loses only the approval of this owner: a request in progress in it is another
 * window's, and a window takes out only what it put in (MOL-56, adversarial А3).
 *
 * **Why this does not contradict «a 401 erases nothing» (MOL-56, MOL-58).** That rule exists
 * because «no session» is also what an expired session looks like, and the queue may hold a
 * purchase made at a shelf with no signal. Here the person said it themselves, and they said it
 * after the server confirmed the session is gone. Without it the drawer would still open the app
 * offline — MOL-56's rule for a launch with an owner on the device — and show the next person at
 * that laptop the purchases of the last one.
 */
export function forgetOwner(owner: string): void {
  current = null
  forgetWhere(
    (key) =>
      key === KEY ||
      key === LEAVING_KEY ||
      (key.startsWith('molvia.') && key.endsWith(`.${owner}`)),
  )
  reshape(LOGIN_KEY, (value) => withoutClaimOf(owner, value))
}

function withoutClaimOf(owner: string, value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { claimed, ...rest } = parsed as Record<string, unknown>
    if (claimed !== owner) return value
    return Object.keys(rest).length > 0 ? JSON.stringify(rest) : null
  } catch {
    return null
  }
}

/**
 * Written **before** `POST /auth/logout` leaves, and taken away with the drawer (adversarial Б2).
 * An answer can be lost after the server has already deleted the session; the first `401` after
 * that closes the door, and the settings with «Выйти» on them are behind it — so the erasure the
 * person asked for would never come. With this on the device, the server's «no session» finishes
 * it instead.
 */
export function markLeaving(owner: string): void {
  write(LEAVING_KEY, owner)
}

export function leavingOwner(): string | null {
  const stored = read(LEAVING_KEY)
  return isIdentifier(stored) ? stored : null
}

/** The person closed the sheet, or the server said the session is alive: nothing to finish. */
export function clearLeaving(): void {
  forget(LEAVING_KEY)
}

/**
 * Forgets the owner this tab holds in memory, when another window has erased the drawer (MOL-57):
 * storage is empty there already, and this cache would otherwise name the owner who left.
 */
export function dropIdentity(): void {
  current = null
}

/** Returns whether the value outlived this tab: false means storage refused it. */
export function rememberIdentity(id: string): boolean {
  current = id
  return write(KEY, id)
}

/**
 * What the invite door left behind on devices that used it (MOL-52, adversarial Б1).
 *
 * The door is gone — `POST /actors`, the code, the header — but two traces of it outlive the
 * deletion on every phone that ever opened an invite link: the code itself in storage, and the
 * `?c=` in the address. Neither opens anything any more; what they do is sit there. The query
 * is the worse of the two, and not because of the code in it: an address goes into history,
 * into a screenshot, into the `start_url` of an installed PWA and into every `Referer` the page
 * sends — which is exactly why it used to be scrubbed on every start, and that scrubbing went
 * out with the door it belonged to.
 *
 * Called once at startup, before anything reads the address. Named here rather than inlined in
 * `main.ts` so that it can be deleted in one piece: after MOL-56 has rewritten the way in,
 * nobody will have such a device left and this goes with them.
 */
export function forgetTheInviteDoor(): void {
  forget('molvia.invite')

  const url = new URL(window.location.href)
  if (!url.searchParams.has('c')) return

  url.searchParams.delete('c')
  // The state is kept: it is the router's record of the entry underneath, and an empty one
  // makes the chevron and the tab bar lose track of where «back» leads (MOL-17).
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export const IDENTITY_KEY = KEY
