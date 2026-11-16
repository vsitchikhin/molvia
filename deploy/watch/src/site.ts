/**
 * What the outside watch makes of the site's answers (MOL-142, MOL-221): pure, so the rule that
 * decides an alarm is tested without a network.
 */

/** Tries once a check has failed; three of them failing is a `/fail` (adversarial Б1 of MOL-142). */
export const ATTEMPTS = 4
export const FAILURES_TO_ALARM = 3

/**
 * One answer as the watch saw it; `0` is no answer at all — the network, a timeout. A request
 * Cloudflare itself could not complete may come back as its own code instead: a name that does not
 * resolve is `530` (seen trying the alarm on `molvia.invalid`). Either is a failure.
 */
export interface Answer {
  readonly status: number
  readonly body: string
}

/** A status as curl printed it, so the text of `/fail` reads as it did under GitHub: `000`. */
const code = (status: number): string => (status === 0 ? '000' : String(status))

/**
 * What is wrong with the site, a line each; nothing when all is well. `/health` is `503` whenever
 * it is not ok, but the body is read too: a `200` that does not say `ok` is not health.
 */
export function readSite(health: Answer, page: Answer): string[] {
  const wrong: string[] = []
  if (health.status !== 200 || !health.body.includes('"status":"ok"')) {
    wrong.push(`health ${code(health.status)}`)
  }
  if (page.status !== 200) wrong.push(`pwa ${code(page.status)}`)
  return wrong
}

export type Verdict = { readonly up: true } | { readonly up: false; readonly said: string }

/**
 * Every merge is a rollout and leaves the API silent for seconds, while `/fail` raises the alarm
 * at once, with no grace. So one failure is not believed: three tries of four failing is down,
 * and the alarm says what the last of them saw. A rollout fails one or two; one failing every
 * second request passes — that is MOL-145's share of 5xx, not an availability watch's.
 */
export function judge(attempts: readonly (readonly string[])[]): Verdict {
  const failed = attempts.filter((wrong) => wrong.length > 0)
  const last = failed.at(-1)
  if (failed.length < FAILURES_TO_ALARM || !last) return { up: true }
  return { up: false, said: last.join('\n') }
}

/** What Grafana's address answered a request with no pass of Access (MOL-399): its status and where it sent. */
export interface Door {
  readonly status: number
  readonly location: string
}

/** Access's own sign-in, on the team's domain, where it sends a request that carries no pass. */
function accessSignIn(location: string): boolean {
  if (!URL.canParse(location)) return false
  const url = new URL(location)
  return url.protocol === 'https:' && url.hostname.endsWith('.cloudflareaccess.com')
}

/**
 * What is wrong with the lock of Grafana from outside (MOL-399, В-3), a line or nothing. A request with
 * no pass is Access's to answer — sent to the team's sign-in, or refused. Anything Grafana answers itself,
 * its page or its own `/login`, is the lock open: Grafana's own check of the pass is the second lock, not
 * the first. No answer, or Cloudflare's own error, is no Access in front either.
 */
export function readLock(door: Door): string[] {
  if (door.status === 401 || door.status === 403) return []
  if (door.status >= 300 && door.status < 400 && accessSignIn(door.location)) return []
  if (door.status === 0 || door.status >= 500) return [`grafana ${code(door.status)}`]
  return [`grafana open ${code(door.status)}`]
}
