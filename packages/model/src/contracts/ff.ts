import { z } from 'zod'

/**
 * A feature flag — «фф» (MOL-382, MOL-376 В-1 «в»): 0.3 ships openly, and an фф closes only a thing
 * people should not see yet. `meaning` is what it closes, `removedBy` the task that takes it off once it
 * is on in production (owner's В-3 «а») — filed with the entry, so nothing lives forever by forgetting.
 */
export interface FfEntry {
  readonly meaning: string
  readonly removedBy: `MOL-${number}`
}

/** Every фф there is. A name is Latin `snake_case`: it is a header's word and an environment's name. */
export const FF = {
  venues: {
    meaning: 'Заведения и блюда, пока их цепочка (MOL-390…MOL-394) не цельная',
    removedBy: 'MOL-439',
  },
  payments: {
    meaning: 'Оплата картой и её экраны (MOL-277, MOL-395), пока банк не подключён',
    removedBy: 'MOL-440',
  },
} as const satisfies Record<string, FfEntry>

export type FfName = keyof typeof FF

/** In the list's order — the order the header names them in. */
export const FF_NAMES = Object.keys(FF) as readonly FfName[]

/**
 * The header every answer of the API names the фф that are on in (MOL-382, В-1 «а»): `venues,payments`,
 * empty for none — an answer too. Beside `X-Molvia-Version`, on every route, a 404 and a refusal
 * included, so the phone hears it before the login and an older page reads nothing new in a body.
 */
export const FF_HEADER = 'X-Molvia-Ff'

/** The header's value for the фф that are on, in the list's order. */
export function ffHeaderOf(on: ReadonlySet<FfName>): string {
  return FF_NAMES.filter((name) => on.has(name)).join(',')
}

/**
 * The фф a header names. A name this build does not know — the server is newer — is passed over, as
 * are spaces and a repeat; the header absent is the caller's to tell from an empty one.
 */
export function ffFromHeader(value: string): ReadonlySet<FfName> {
  const named = new Set(value.split(',').map((word) => word.trim()))
  return new Set(FF_NAMES.filter((name) => named.has(name)))
}

/** `venues` → `FF_VENUES`, the server's environment variable. */
export function ffEnvName(name: FfName): string {
  return `FF_${name.toUpperCase()}`
}

/**
 * One фф in the environment: `on` or `off`, nothing else (В-2 of the requirements). `ON`, `true`, a typo
 * stop the API's boot — a payment silently off is worse than a rollout that failed and was rolled back.
 */
const ffSwitchSchema = z.enum(['on', 'off'])

/** The environment read into the фф that are on: each `FF_<NAME>` of the list, `off` when unset. */
export const ffEnvironmentSchema = z
  .object(
    Object.fromEntries(FF_NAMES.map((name) => [ffEnvName(name), ffSwitchSchema.default('off')])),
  )
  .transform(
    (values): ReadonlySet<FfName> =>
      new Set(FF_NAMES.filter((name) => values[ffEnvName(name)] === 'on')),
  )
