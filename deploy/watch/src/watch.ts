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
 */
export function settingsOf(environment: Environment): Settings {
  const pingUrl = environment.HC_UP_URL?.trim() ?? ''
  if (!pingUrl.startsWith('https://')) {
    throw new Error(
      'HC_UP_URL is not an https URL, there is nowhere to report (deploy/README.md, «Signals»)',
    )
  }
  const domain = environment.DOMAIN?.trim() ?? ''
  return { pingUrl, domain: domain === '' ? 'molvia.net' : domain }
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
    await response.body?.cancel()
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
      await response.body?.cancel()
      if (response.ok) return
      failure = String(response.status)
    } catch (error) {
      failure = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network'
    }
    if (attempt < PING_TRIES) await io.wait(1_000 * 2 ** (attempt - 1))
  }
  throw new Error(`the ping to healthchecks.io did not go: ${failure}`)
}

export async function watch(settings: Settings, io: Io): Promise<Round> {
  const attempts = await look(settings.domain, io)
  const verdict = judge(attempts)
  await report(settings, verdict, io)
  return { attempts, verdict }
}
