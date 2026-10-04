import { sql } from 'drizzle-orm'
import { toSearchKey } from '@molvia/model'
import type { Db } from '@/db'

/**
 * Every stored search key brought to what `toSearchKey` gives its name today (MOL-109, В-2): the
 * key is computed in TypeScript and a migration is SQL, so a change of the tables — Georgian and
 * Serbian, the first since a key was stored — reaches the rows here, at the start of the build that
 * carries it, on production and in every copy alike. Only the drifted rows are written; a build
 * whose tables did not change writes nothing.
 *
 * The table is locked against writes for the read and the update: a name an older process writes
 * meanwhile would keep its old key. A key that would come out empty is left as it is — the schema
 * refuses it, and only a name `visibleLine` let through before it refused such names can give one.
 * What cannot be brought back is a remembered pick (`search_picks`): it keeps the query's key alone.
 */
export async function rekeyItems(db: Db): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table items in share row exclusive mode`)
    const rows = await tx.execute<{ id: string; name: string; search_key: string }>(
      sql`select id, name, search_key from items`,
    )
    const drifted = rows.flatMap((row) => {
      const key = toSearchKey(row.name)
      return key !== '' && key !== row.search_key ? [{ id: row.id, key }] : []
    })
    if (drifted.length === 0) return 0
    await tx.execute(sql`
      update items set search_key = drifted.key
      from jsonb_to_recordset(${JSON.stringify(drifted)}::jsonb) as drifted(id uuid, key text)
      where items.id = drifted.id
    `)
    return drifted.length
  })
}
