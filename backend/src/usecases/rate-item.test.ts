import { describe, expect, it } from 'vitest'
import { DomainError, ERROR, ISSUE, itemSchema, verdictSchema } from '@molvia/model'
import type { Item, NewVerdict } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'
import type { VerdictRepository } from '@/db/verdicts-repository'
import { InvalidBody } from '@/parse'
import { rateItem } from './rate-item'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const MILK = '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c'

function item(kind: Item['kind']): Item {
  return itemSchema.parse({
    id: MILK,
    kind,
    name: kind === 'product' ? 'Молоко Ашхар' : 'Карбонара',
    searchKey: 'moloko',
    barcodes: [],
    note: null,
    defaultUnit: kind === 'product' ? 'l' : 'piece',
    typicalQuantity: null,
    createdBy: null,
    createdAt: new Date('2026-09-18T10:00:00.000Z'),
  })
}

function verdictFrom(input: NewVerdict) {
  return verdictSchema.parse({
    id: 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a8b',
    actorId: ACTOR,
    itemId: input.itemId,
    placeId: null,
    score: input.score,
    review: input.review ?? null,
    ratedAt: new Date('2026-09-19T10:00:00.000Z'),
    updatedAt: new Date('2026-09-19T10:00:00.000Z'),
  })
}

// Only `byId` and `put` are expected; anything else fails the test instead of passing quietly.
function deps(found: Item | null, puts: [string, NewVerdict][] = []) {
  const items = {
    byId: (id: string) => Promise.resolve(id === MILK ? found : null),
  } as Pick<ItemRepository, 'byId'> as ItemRepository
  const verdicts = {
    put: (actorId: string, input: NewVerdict) => {
      puts.push([actorId, input])
      return Promise.resolve({ verdict: verdictFrom(input), created: true })
    },
  } as Pick<VerdictRepository, 'put'> as VerdictRepository
  return { items, verdicts }
}

describe('rateItem', () => {
  it('writes the rating under the caller, for the item named by the path', async () => {
    const puts: [string, NewVerdict][] = []

    const { verdict, created } = await rateItem(deps(item('product'), puts), ACTOR, MILK, {
      score: 2,
      review: 'Пахнет крахмалом',
    })

    expect(puts).toEqual([[ACTOR, { itemId: MILK, score: 2, review: 'Пахнет крахмалом' }]])
    expect(verdict.score).toBe(2)
    expect(created).toBe(true)
  })

  it('answers «not found» for an item the catalogue does not hold, and writes nothing', async () => {
    const puts: [string, NewVerdict][] = []

    const refusal = rateItem(deps(null, puts), ACTOR, MILK, { score: 4 })

    await expect(refusal).rejects.toBeInstanceOf(DomainError)
    await expect(refusal).rejects.toMatchObject({ code: ERROR.NOT_FOUND })
    expect(puts).toEqual([])
  })

  it('refuses a dish as a body that does not fit, before the database would', async () => {
    // A dish needs a place, and the body has none until 0.3. Without this check the CHECK
    // constraint refuses it — as a 500.
    const puts: [string, NewVerdict][] = []

    const refusal = rateItem(deps(item('dish'), puts), ACTOR, MILK, { score: 4 })

    await expect(refusal).rejects.toBeInstanceOf(InvalidBody)
    await expect(refusal).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: ISSUE.VERDICT_PLACE_NOT_FOR_KIND })],
    })
    expect(puts).toEqual([])
  })
})
