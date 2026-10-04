import { randomUUID } from 'node:crypto'
import { COUNTRY_CITIES, firstGeography, newActorSchema, SETTINGS_COUNTRIES } from '@molvia/model'
import type { Actor, NewActor, SettingsCountry, TelegramUserId } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'

/**
 * Four columns are NOT NULL, so the server names them before the person has seen the settings.
 * The country and its first city are the ones the phone's time zone lives in (MOL-109, В-3) — a
 * person from Belgrade does not start in Gyumri — and Gyumri for every other zone, as every
 * account began before. The currencies stay the dram and the author's ruble until the lari and the
 * dinar come (MOL-110); the settings change all four in a tap.
 *
 * Parsed here rather than merely typed: a later edit that breaks the shape should fail when
 * the module loads, not on somebody's first visit.
 */
const FIRST_VISITS: Readonly<Record<SettingsCountry, NewActor>> = Object.freeze(
  Object.fromEntries(
    SETTINGS_COUNTRIES.map((country) => [
      country,
      Object.freeze(
        newActorSchema.parse({
          country,
          city: COUNTRY_CITIES[country][0],
          spendCurrency: 'AMD',
          incomeCurrency: 'RUB',
        }),
      ),
    ]),
  ) as Record<SettingsCountry, NewActor>,
)

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
  return actors.create(randomUUID(), telegramUserId, FIRST_VISITS[firstGeography(zone).country])
}
