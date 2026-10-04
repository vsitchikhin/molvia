import { ATTEMPTS, judge, readSite } from '@/site'
import type { Answer, Verdict } from '@/site'

/**
 * One round of the outside watch (MOL-221): asks the site, then tells healthchecks.io — the check
 * «molvia-up», or its `/fail` saying what. The watch it replaces ran on GitHub's cron, which on this
 * repository came every two to six hours instead of every five minutes; the rules are the same.
 */

/** Between tries once a check has failed: four of them span the seconds a rollout is silent. */
export const PAUSE_MS = 30_000

/** One request is given up on after this, and counts as no answer, `000`. */
export const REQUEST_TIMEOUT_MS = 10_000

/** A ping is tried this many times before the round fails — curl's `--retry 3` before. */
export const PING_TRIES = 4

/** What the Worker is given: a secret and a plain variable, both set on Cloudflare. */
export interface Environment {
  readonly HC_UP_URL?: string
  readonly DOMAIN?: string
}

export interface Settings {
  readonly pingUrl: string
  readonly domain: string
}

export interface Io {
  readonly fetch: typeof globalThis.fetch
  readonly wait: (ms: number) => Promise<void>
  /** A line for the Worker's log; `warn` for what went wrong. */
  readonly log: (line: string, warn: boolean) => void
}

export interface Round {
  /** What each try found wrong, in order: one empty try when the site was well at once. */
  readonly attempts: readonly (readonly string[])[]
  readonly verdict: Verdict
}

/**
 * The watch's settings, or a refusal: a round that cannot report is an error in the Worker's log,
 * never a silence nobody reads — the check then raises the alarm once its grace runs out. The URL
 * is never in a message: whoever has it can say «alive» for us.
 *
 * `/fail` is appended to the URL, so the URL must end in its path (adversarial А1): after a query
 * or a fragment `/fail` lands in them, and healthchecks.io takes the path for a ping that says
 * «up» — a site down on every try would never raise the alarm, not even by the grace.
 */
export function settingsOf(environment: Environment): Settings {
  const pingUrl = environment.HC_UP_URL?.trim() ?? ''
  const parsed = URL.canParse(pingUrl) ? new URL(pingUrl) : undefined
  if (parsed?.protocol !== 'https:') {
    throw new Error(
      'HC_UP_URL is not an https URL, there is nowhere to report (deploy/README.md, «Signals»)',
    )
  }
  // Read on the text, not the parsed URL: an empty `?` or `#` parses to nothing and still takes `/fail`.
  if (pingUrl.includes('?') || pingUrl.includes('#') || pingUrl.endsWith('/')) {
    throw new Error(
      'HC_UP_URL has a query, a fragment or a trailing slash, so /fail cannot follow it (deploy/README.md, «Signals»)',
    )
  }
  const domain = environment.DOMAIN?.trim() ?? ''
  return { pingUrl, domain: domain === '' ? 'molvia.net' : domain }
}

/**
 * A body nobody reads is let go, and a connection broken after the status changes nothing
 * (adversarial А3): cancelling a stream already in error rejects, and a ping healthchecks.io had
 * answered `200` was counted as not gone, or a page answered `200` as `000`.
 */
async function drop(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

/**
 * A redirect is not followed — it is not the page, and curl did not follow one either. A request
 * that fails — a bad certificate too — is a `000`, unless Cloudflare answers it with its own code.
 */
async function ask(io: Io, url: string, read: boolean): Promise<Answer> {
  try {
    const response = await io.fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (read) return { status: response.status, body: await response.text() }
    await drop(response)
    return { status: response.status, body: '' }
  } catch {
    return { status: 0, body: '' }
  }
}

/** The site well at the first try is one try; otherwise four, half a minute apart. */
async function look(domain: string, io: Io): Promise<string[][]> {
  const attempts: string[][] = []
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const health = await ask(io, `https://${domain}/api/health`, true)
    const page = await ask(io, `https://${domain}/`, false)
    const wrong = readSite(health, page)
    attempts.push(wrong)
    if (attempt === 1 && wrong.length === 0) break
    if (attempt < ATTEMPTS) await io.wait(PAUSE_MS)
  }
  return attempts
}

/** A ping that did not go after every try fails the round, by its kind and never by its URL. */
async function report(settings: Settings, verdict: Verdict, io: Io): Promise<void> {
  const url = verdict.up ? settings.pingUrl : `${settings.pingUrl}/fail`
  let failure = ''
  for (let attempt = 1; attempt <= PING_TRIES; attempt += 1) {
    try {
      const response = await io.fetch(url, {
        ...(verdict.up ? {} : { method: 'POST', body: verdict.said }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      await drop(response)
      if (response.ok) return
      failure = String(response.status)
    } catch (error) {
      failure = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network'
    }
    if (attempt < PING_TRIES) await io.wait(1_000 * 2 ** (attempt - 1))
  }
  throw new Error(`the ping to healthchecks.io did not go: ${failure}`)
}

/**
 * What the tries saw is logged before the ping: a round whose ping did not go still says what the
 * site did, and that round's alarm comes only by the check's grace.
 */
export async function watch(settings: Settings, io: Io): Promise<Round> {
  const attempts = await look(settings.domain, io)
  const verdict = judge(attempts)
  attempts.forEach((wrong, index) => {
    if (wrong.length > 0) io.log(`attempt ${String(index + 1)}: ${wrong.join('; ')}`, true)
  })
  if (verdict.up) io.log(`${settings.domain} is well`, false)
  else io.log(`${settings.domain}: ${verdict.said.replaceAll('\n', '; ')}`, true)
  await report(settings, verdict, io)
  return { attempts, verdict }
}
