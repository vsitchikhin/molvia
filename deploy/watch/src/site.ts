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
  /** Where a redirect sends, never followed; empty without one. */
  readonly location: string
}

/** A status as curl printed it, so the text of `/fail` reads as it did under GitHub: `000`. */
const code = (status: number): string => (status === 0 ? '000' : String(status))

/**
 * What is wrong with the site, a line each; nothing when all is well. `/health` is `503` whenever
 * it is not ok, but the body is read too: a `200` that does not say `ok` is not health.
 */
export function readSite(
  health: Pick<Answer, 'status' | 'body'>,
  page: Pick<Answer, 'status' | 'body'>,
): string[] {
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

/** Access's own sign-in, on the team's domain, where it sends a request that carries no pass. */
function accessSignIn(location: string): boolean {
  if (!URL.canParse(location)) return false
  const url = new URL(location)
  return url.protocol === 'https:' && url.hostname.endsWith('.cloudflareaccess.com')
}

/**
 * What is wrong with the lock of Grafana from outside (MOL-399, В-3), a line or nothing. A request with
 * no pass is shut only when Access sends it to the team's sign-in — what Access does with every request
 * that carries none. Grafana answering by itself, its page or its own `/login`, is the lock open:
 * Grafana's own check of the pass is the second lock, not the first. Any other answer — none, Cloudflare's
 * own error, a `403` of its challenge or its firewall, which a browser may pass and reach Grafana behind
 * (adversarial А5) — says nothing of the lock, and is no lock seen either.
 */
export function readLock(door: Pick<Answer, 'status' | 'location'>): string[] {
  const redirect = door.status >= 300 && door.status < 400
  if (redirect && accessSignIn(door.location)) return []
  if (door.status === 200 || redirect) return [`grafana open ${code(door.status)}`]
  return [`grafana ${code(door.status)}`]
}
