import { sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'

/**
 * The week an instant falls in, as a Monday in Yerevan — the key of `erasures` (MOL-91). One
 * fragment for the write in `erase` and the read in the gates: two copies of a formula are two
 * places a shift can drift apart, and the check on the column holds a Monday, not the right one.
 *
 * From the instant itself, `at time zone 'UTC'` and Armenia's constant +04:00 — never the
 * session's `timezone`, which would move a Sunday night into the next week.
 */
export function yerevanWeek(instant: SQLWrapper): SQL {
  // The instant in its own brackets: `at time zone` binds tighter than `-`, and an expression
  // handed in — `to` less a millisecond — would otherwise be read inside out.
  return sql`date_trunc('week', ((${instant}) at time zone 'UTC') + interval '4 hours')::date`
}
