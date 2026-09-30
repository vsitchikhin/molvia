import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Currency } from '@molvia/model'

/** One row of `tripMoneyRows`: a sum over bigint is a numeric and a count a bigint — text to the driver. */
export interface TripMoneyRow extends Record<string, unknown> {
  readonly trip_id: string
  readonly currency: Currency
  readonly minor: string | bigint
  readonly items: string | number
}

/**
 * A trip's money in SQL — `tripMoney` of the domain (MOL-78), for the readers that sum many trips in
 * one statement: «Записаны», the month of «Деньги» and the accounts. One row per trip and currency:
 * the receipt's sum whole when the trip has one, else the sum of the priced purchases of each
 * currency, as `tripTotal` adds them — a purchase with no price adds nothing. A trip with neither
 * has no row.
 *
 * `items` is the purchases behind the sum: every purchase of the trip under a receipt, which stands
 * for all of them; otherwise the priced ones of that currency (owner's decision В-7 of MOL-73).
 *
 * `chosen` is the condition on `t`, the trips, that picks which trips are read. An integration test
 * holds these rows equal to the trip's own answer, so a fifth reader cannot drift from the rule.
 */
export function tripMoneyRows(chosen: SQL): SQL {
  return sql`
    select t.id as trip_id, t.receipt_currency as currency, t.receipt_minor::numeric as minor,
           (select count(*) from expenses e where e.trip_id = t.id) as items
      from trips t
     where t.receipt_minor is not null and (${chosen})
    union all
    select t.id, e.amount_currency, sum(e.amount_minor), count(*)
      from trips t
      join expenses e on e.trip_id = t.id and e.amount_minor is not null
     where t.receipt_minor is null and (${chosen})
     group by t.id, e.amount_currency`
}
