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
import { forget, read, write } from '@/stores/storage'

const KEY = 'molvia.actor'

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
    if (isIdentifier(stored)) current = stored
  }
  return current
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
