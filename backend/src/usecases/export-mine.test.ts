import { describe, expect, it } from 'vitest'
import { DomainError, ERROR } from '@molvia/model'
import type { ExportContent } from '@molvia/model'
import type { ExportRepository } from '@/db/export-repository'
import { exportMine } from './export-mine'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const SESSION = '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c'
const NOW = new Date('2026-10-12T08:14:03Z')

const content = { account: { id: ACTOR }, trips: [] } as unknown as ExportContent

function fake(found: ExportContent | null, calls: [string, string][]) {
  return {
    exportOf: (actorId: string, sessionId: string) => {
      calls.push([actorId, sessionId])
      return Promise.resolve(found)
    },
  } satisfies ExportRepository
}

describe('exportMine', () => {
  it('reads the caller’s own and dates the file with its format and version', async () => {
    const calls: [string, string][] = []

    const file = await exportMine(fake(content, calls), ACTOR, SESSION, NOW)

    expect(calls).toEqual([[ACTOR, SESSION]])
    expect(file).toMatchObject({ format: 'molvia-export', version: 15, exportedAt: NOW, trips: [] })
  })

  it('answers «no owner» when the owner was erased between the session and the read', async () => {
    const refusal = exportMine(fake(null, []), ACTOR, SESSION, NOW)

    await expect(refusal).rejects.toBeInstanceOf(DomainError)
    await expect(refusal).rejects.toMatchObject({ code: ERROR.NO_ACTOR })
  })
})
