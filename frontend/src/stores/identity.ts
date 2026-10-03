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
import { forget, forgetWhere, read, reshape, sharedHolds, write, writeOwn } from '@/stores/storage'
import { forgetPhotos } from '@/receipts/photoShelf'

const KEY = 'molvia.actor'

/**
 * Where the login screen keeps the request in progress and the owner this device approved
 * (MOL-56). Named here rather than in the login store, because erasing an owner has to reach it and
 * this module is the leaf both depend on.
 */
export const LOGIN_KEY = 'molvia.login'

/** «Выйти» was pressed for this owner and has not been confirmed yet (MOL-57, adversarial Б2). */
const LEAVING_KEY = 'molvia.leaving'

/**
 * The way out waiting in `molvia.leaving` is «Удалить мои данные», not «Выйти» (MOL-94, adversarial
 * А). Kept beside it rather than in it, so the intent's value stays an owner's id. For «Выйти» a
 * server that knows no session is the goal reached; for an erasure it says nothing about whether the
 * person is gone, and this is what tells the two apart.
 */
const ERASING_KEY = 'molvia.erasing'

/**
 * What the login screen of **this tab** says about an erasure just tried (MOL-94, В-3): `erased` —
 * the server's own `204`; `unknown` — an answer was lost and the server then knew no session;
 * `kept` — the session was gone before the tap, and nothing was erased. On this window's shelf
 * only (review 4): the screen is the one brought up by this tab's reload or its closing door, and a
 * neighbour hearing the drawer go must not take the note. It names nobody.
 */
const ERASED_KEY = 'molvia.erased'

export type ErasureNote = 'erased' | 'unknown' | 'kept'

function isNote(value: string | null): value is ErasureNote {
  return value === 'erased' || value === 'unknown' || value === 'kept'
}

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
 *
 * **The premise, checked** (self-review Р3-1): Safari's seven-day cap on script-writable storage
 * clears `SessionStorage` together with `LocalStorage` (WebKit, «Full Third-Party Cookie Blocking
 * and More», 2020), so ITP does not produce a drawer on one shelf only. What still can is clearing
 * the shared shelf by hand — the developer tools, an extension — and then this tab's copy goes too.
 * A named limit: a marker naming who left would keep that owner's id on the device after they
 * asked to be forgotten.
 */
function erasedElsewhere(owner: string): boolean {
  // The drawer's name counts by its value, not by its presence (round 4, Ж2): after this owner left
  // and somebody else signed in, the shared shelf names them, and this owner's drawer is gone.
  const held = sharedHolds((key, value) =>
    key === KEY ? value === owner : key.startsWith('molvia.') && key.endsWith(`.${owner}`),
  )
  return held === false
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
  forgetWhere((key) => key.startsWith('molvia.') && key.endsWith(`.${owner}`))
  // The drawer's name and the intent go only when they are this owner's: once somebody else has
  // signed in here, they name that person (self-review Р3-2).
  reshape(KEY, (value) => (value === owner ? null : value))
  reshape(LEAVING_KEY, (value) => (value === owner ? null : value))
  reshape(ERASING_KEY, (value) => (value === owner ? null : value))
  reshape(LOGIN_KEY, (value) => withoutClaimOf(owner, value))
  // The photos of receipts are not on a shelf the sweep reaches: their database goes by its name
  // (MOL-127). «Выйти» waits for it before the reload; every other way here lets it run.
  void forgetPhotos(owner)
}

function withoutClaimOf(owner: string, value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { claimed, ...rest } = parsed as Record<string, unknown>
    if (claimed !== owner) return value
    // The next person at this device begins a login rather than repeats one (MOL-68, review А1).
    delete rest.tried
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
export function markLeaving(owner: string, erasing = false): void {
  write(LEAVING_KEY, owner)
  if (erasing) write(ERASING_KEY, owner)
  else forget(ERASING_KEY)
}

/** Whose erasure is waiting for its outcome — written with the intent, gone with it. */
export function erasingOwner(): string | null {
  const stored = read(ERASING_KEY)
  return isIdentifier(stored) ? stored : null
}

export function leavingOwner(): string | null {
  const stored = read(LEAVING_KEY)
  return isIdentifier(stored) ? stored : null
}

/** The person closed the sheet, or the server said the session is alive: nothing to finish. */
export function clearLeaving(): void {
  forget(LEAVING_KEY)
  forget(ERASING_KEY)
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

/** Written right before the login screen of this tab comes up after «Удалить мои данные». */
export function noteErasure(note: ErasureNote): void {
  writeOwn(ERASED_KEY, note)
}

/** The server has said who this is: no login screen is coming that the note was for. */
export function dropErasureNote(): void {
  forget(ERASED_KEY)
}

/** The note as it stands, left in place — for a tap that may have to put it back. */
export function erasureNote(): ErasureNote | null {
  const note = read(ERASED_KEY, true)
  return isNote(note) ? note : null
}

/** What the login screen has to say about an erasure — once: the note goes as it is read. */
export function takeErasureNote(): ErasureNote | null {
  const note = read(ERASED_KEY, true)
  forget(ERASED_KEY)
  return isNote(note) ? note : null
}
