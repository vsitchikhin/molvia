import { and, eq, or, sql } from 'drizzle-orm'
import { actorSchema } from '@molvia/model'
import type { Actor, ActorSettings, SettingsUpdate } from '@molvia/model'
import type { Conn } from './index'
import { actors, exchanges } from './schema'

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
          // is: a retry of the same form finds the currency already there and moves nothing.
          // And only when the old currency was ever in an exchange (review С-1, Ж2): the cut
          // protects exchanges counted in it, and a first choice made over the default `RUB` by
          // someone who never exchanged roubles has none — cutting there took their whole history.
          incomeCurrencySince: sql`case
            when ${actors.incomeCurrency} = ${settings.incomeCurrency}
              then ${actors.incomeCurrencySince}
            when exists (
              select 1 from ${exchanges}
              where ${exchanges.actorId} = ${actors.id}
                and ${exchanges.deletedAt} is null
                and ${actors.incomeCurrency} in (${exchanges.givenCurrency}, ${exchanges.receivedCurrency})
            )
              then clock_timestamp()
            else ${actors.incomeCurrencySince}
          end`,
        })
        .where(and(eq(actors.id, owner), or(matches(previous), matches(settings))))
        .returning()
      return row ? actorSchema.parse(row) : null
    },
  }
}
