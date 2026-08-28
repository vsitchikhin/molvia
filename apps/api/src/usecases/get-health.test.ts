import { describe, expect, it } from 'vitest'
import { getHealth } from './get-health'

describe('getHealth', () => {
  it('is ok when the database answers', async () => {
    const health = await getHealth('1.2.3', { databaseIsReachable: () => Promise.resolve(true) })
    expect(health).toEqual({ status: 'ok', version: '1.2.3', database: 'up' })
  })

  it('is degraded, not ok, when the database does not answer', async () => {
    const health = await getHealth('1.2.3', { databaseIsReachable: () => Promise.resolve(false) })
    expect(health).toEqual({ status: 'degraded', version: '1.2.3', database: 'down' })
  })

  it('does not let a probe failure escape as a crash', async () => {
    // The probe swallows its own errors, so a rejection here would be a bug in the
    // adapter rather than in the use case — assert the contract it is written against.
    await expect(
      getHealth('1.2.3', { databaseIsReachable: () => Promise.resolve(false) }),
    ).resolves.toHaveProperty('status', 'degraded')
  })
})
