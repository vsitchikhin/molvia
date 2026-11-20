import { z } from 'zod'
import { VPOS_HOSTS, localHosts } from './client'
import type { VposCredentials, VposStand } from './client'

/** The bank as every caller needs it: its stand, its hosts, the merchant's values and the order's offset. */
export interface VposBank {
  readonly stand: VposStand
  readonly hosts: { api: string; page: string; list: string }
  readonly credentials: VposCredentials
  /** Added to our order's number on its way to the bank (adversarial А2): the stand's range; 0 on the live one. */
  readonly orderOffset: bigint
}

/** The bank and where it sends the browser back — what the API's channel needs. */
export interface VposConfiguration extends VposBank {
  /** The PWA's origin, where the bank sends the browser back (requirement 5). */
  readonly appBaseUrl: string
}

const filled = z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1))

const bankSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VPOS_STAND: z.enum(['test', 'live', 'local']),
  VPOS_CLIENT_ID: filled,
  VPOS_USERNAME: filled,
  VPOS_PASSWORD: filled,
  VPOS_ORDER_OFFSET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^\d{1,15}$/)
      .default('0'),
  ),
  VPOS_LOCAL_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.url({ protocol: /^https?$/ }).optional(),
  ),
})

const channelSchema = bankSchema.extend({ APP_BASE_URL: z.url({ protocol: /^https?$/ }) })

/** A refusal names the variables, never a value (`VPOS_PASSWORD` is a secret of «Rotating the secrets»). */
function parsed<T>(schema: z.ZodType<T>, environment: Record<string, string | undefined>): T {
  const result = schema.safeParse(environment)
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))]
    throw new Error(`the bank needs ${names.join(', ')}`)
  }
  return result.data
}

function bankOf(value: z.infer<typeof bankSchema>): VposBank {
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
    orderOffset: BigInt(value.VPOS_ORDER_OFFSET),
  }
}

/**
 * The bank's stand and the merchant's three values (MOL-277, Р-7): read only while the фф `payments` is on, and
 * then each required — a payment on with no bank is a start that fails, not one that quietly takes nothing. `local`
 * is end-to-end's fake bank on the copy's own port, refused in production.
 */
export function vposConfiguration(
  environment: Record<string, string | undefined>,
  paymentsOn: boolean,
): VposConfiguration | null {
  if (!paymentsOn) return null
  const value = parsed(channelSchema, environment)
  return { ...bankOf(value), appBaseUrl: value.APP_BASE_URL.replace(/\/$/, '') }
}

/** The bank alone, for the owner's refund (review №13): no page to send anybody back to. */
export function vposBank(environment: Record<string, string | undefined>): VposBank {
  return bankOf(parsed(bankSchema, environment))
}
