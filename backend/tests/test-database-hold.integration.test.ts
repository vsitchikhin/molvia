import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { testDatabaseUrl } from './db'
import { holdTestDatabases } from './setup-db'

// MOL-351: a second run of one copy fails at its start rather than writing into the first one's databases. A name of
// its own, so the run holding this copy's databases is not the one asked about.
const maintenance = new URL(testDatabaseUrl())
const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
maintenance.pathname = '/postgres'

describe('the hold of a copy’s test databases', () => {
  it('refuses a second run while the first holds them, naming it, and lets the next one in after it', async () => {
    const database = `molvia_hold_${randomUUID()}`
    const first = await holdTestDatabases(maintenance.toString(), database)
    if (!('release' in first)) throw new Error('the first run was refused')
    try {
      const second = await holdTestDatabases(maintenance.toString(), database)
      expect(second).toEqual({ heldBy: `molvia tests ...${root.slice(-47)}` })
    } finally {
      await first.release()
    }
    const third = await holdTestDatabases(maintenance.toString(), database)
    expect(third).toHaveProperty('release')
    if ('release' in third) await third.release()
  })

  it('holds one copy’s databases, not another’s', async () => {
    const one = await holdTestDatabases(maintenance.toString(), `molvia_hold_${randomUUID()}`)
    const other = await holdTestDatabases(maintenance.toString(), `molvia_hold_${randomUUID()}`)
    expect([one, other].every((hold) => 'release' in hold)).toBe(true)
    for (const hold of [one, other]) if ('release' in hold) await hold.release()
  })
})
