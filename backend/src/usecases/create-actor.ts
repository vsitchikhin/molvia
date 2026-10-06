import { randomUUID } from 'node:crypto'
import { firstGeography, newActorSchema, SETTINGS_COUNTRIES, timeZoneOf } from '@molvia/model'
import type { Actor, Currency, NewActor, TelegramUserId } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'

/**
 * What a country's shops take, where it is not the dram: a person from Tbilisi starts spending lari
 * (MOL-110), one from Belgrade dinars (MOL-230).
 */
const SPEND_CURRENCY: Readonly<Partial<Record<string, Currency>>> = { GE: 'GEL', RS: 'RSD' }

/**
 * Four columns are NOT NULL, so the server names them before the person has seen the settings.
 * The country and its first city are `firstGeography`'s — the ones the phone's time zone lives in
 * (MOL-109, В-3): a person from Belgrade does not start in Gyumri, and every other zone does, as
 * every account began before. The spending currency is the country's (`SPEND_CURRENCY`), the
 * income one the author's ruble; the settings change all four in a tap.
 */
function firstVisit(zone: string | undefined): NewActor {
  const geography = firstGeography(zone)
  return newActorSchema.parse({
    ...geography,
    spendCurrency: SPEND_CURRENCY[geography.country] ?? 'AMD',
    incomeCurrency: 'RUB',
  })
}

// Parsed for every country at load as well: a later edit that breaks the shape should fail when the
// module loads, not on somebody's first visit.
for (const country of SETTINGS_COUNTRIES) firstVisit(timeZoneOf(country) ?? undefined)

/**
 * The identifier is issued here, not brought by the device: a client that named its own could
 * name someone else's and read their trips whole.
 *
 * The Telegram id comes from the caller rather than from here, because who the person is is
 * not this use case's to know: MOL-54 takes it from a login request the person confirmed in
 * the bot, and until then the development seam mints one (MOL-52, Р-3). The zone is the phone's,
 * as the request that collected the login named it (`ZONE_HEADER`), or none.
 */
export async function createActor(
  actors: Pick<ActorRepository, 'create'>,
  telegramUserId: TelegramUserId,
  zone?: string,
): Promise<Actor> {
  return actors.create(randomUUID(), telegramUserId, firstVisit(zone))
}
