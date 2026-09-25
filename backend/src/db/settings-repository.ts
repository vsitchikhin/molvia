import { and, eq, or, sql } from 'drizzle-orm'
import { actorSchema } from '@molvia/model'
import type { Actor, ActorSettings, SettingsUpdate } from '@molvia/model'
import type { Conn } from './index'
import { actors } from './schema'

export interface SettingsRepository {
  save(owner: string, input: SettingsUpdate): Promise<Actor | null>
}

function matches(value: ActorSettings) {
  return and(
    eq(actors.country, value.country),
    eq(actors.city, value.city),
    eq(actors.spendCurrency, value.spendCurrency),
    eq(actors.incomeCurrency, value.incomeCurrency),
  )
}

export function createSettingsRepository(db: Conn): SettingsRepository {
  return {
    async save(owner, { previous, settings }) {
      // Compare inside the UPDATE: two devices must not both overwrite the same old form.
      // The target also matches so a retry after a lost response is successful.
      const [row] = await db
        .update(actors)
        .set({
          ...settings,
          // The day the currency of conversion changed (MOL-42, В-2), decided by the row as it
          // is: a retry of the same form finds the currency already there and moves nothing. Every
          // change sets it — the wallet decides what the day cuts: only exchanges paid in another
          // currency before it (round 2, Л1, Л2).
          incomeCurrencySince: sql`case when ${actors.incomeCurrency} = ${settings.incomeCurrency} then ${actors.incomeCurrencySince} else clock_timestamp() end`,
        })
        .where(and(eq(actors.id, owner), or(matches(previous), matches(settings))))
        .returning()
      return row ? actorSchema.parse(row) : null
    },
  }
}
