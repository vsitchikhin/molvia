import { z } from 'zod'
import { VPOS_HOSTS, localHosts } from './client'
import type { VposCredentials, VposStand } from './client'

export interface VposConfiguration {
  readonly stand: VposStand
  readonly hosts: { api: string; page: string; list: string }
  readonly credentials: VposCredentials
  /** The PWA's origin, where the bank sends the browser back (requirement 5). */
  readonly appBaseUrl: string
}

const filled = z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1))

const vposEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VPOS_STAND: z.enum(['test', 'live', 'local']),
  VPOS_CLIENT_ID: filled,
  VPOS_USERNAME: filled,
  VPOS_PASSWORD: filled,
  APP_BASE_URL: z.url({ protocol: /^https?$/ }),
  VPOS_LOCAL_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.url({ protocol: /^https?$/ }).optional(),
  ),
})

/**
 * The bank's stand and the merchant's three values (MOL-277, Р-7): read only while the фф `payments` is on, and
 * then each required — a payment on with no bank is a start that fails, not one that quietly takes nothing. `local`
 * is end-to-end's fake bank on the copy's own port, refused in production. A refusal names the variable, never its
 * value (`VPOS_PASSWORD` is a secret of «Rotating the secrets»).
 */
export function vposConfiguration(
  environment: Record<string, string | undefined>,
  paymentsOn: boolean,
): VposConfiguration | null {
  if (!paymentsOn) return null
  const parsed = vposEnvironmentSchema.safeParse(environment)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]
    throw new Error(`FF_PAYMENTS=on needs ${names.join(', ')}`)
  }
  const value = parsed.data
  if (value.VPOS_STAND === 'local') {
    if (value.NODE_ENV === 'production') throw new Error('VPOS_STAND=local is never production')
    if (value.VPOS_LOCAL_URL === undefined) throw new Error('VPOS_STAND=local needs VPOS_LOCAL_URL')
  }
  return {
    stand: value.VPOS_STAND,
    hosts:
      value.VPOS_STAND === 'local'
        ? localHosts(String(value.VPOS_LOCAL_URL).replace(/\/$/, ''))
        : VPOS_HOSTS[value.VPOS_STAND],
    credentials: {
      clientId: value.VPOS_CLIENT_ID,
      username: value.VPOS_USERNAME,
      password: value.VPOS_PASSWORD,
    },
    appBaseUrl: value.APP_BASE_URL.replace(/\/$/, ''),
  }
}
