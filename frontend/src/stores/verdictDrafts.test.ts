import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import type { PendingVerdict, Rating, VerdictCard } from '@molvia/model'
import { useActorStore } from '@/stores/actor'
import { useVerdictDraftsStore } from '@/stores/verdictDrafts'

const rateItem =
  vi.fn<(itemId: string, rating: Rating) => Promise<{ verdict: VerdictCard; created: boolean }>>()
vi.mock('@/api', () => ({
  api: { rateItem: (itemId: string, rating: Rating) => rateItem(itemId, rating) },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const OTHER = '2c4e6a80-1111-4222-8333-444455556666'
const KEY = `molvia.verdict-drafts.${ME}`
/** Draws nothing: the server refuses it as a review (`issue.text_not_visible`). */
const ZERO_WIDTH = String.fromCodePoint(0x200b)

const milk: PendingVerdict = {
  itemId: 'cccccccc-0000-4000-8000-000000000001',
  name: 'Молоко «Ашхар»',
  placeName: 'Ереван Сити',
  boughtAt: new Date('2026-09-18T17:40:00.000Z'),
}
const bread: PendingVerdict = {
  ...milk,
  itemId: 'cccccccc-0000-4000-8000-000000000002',
  name: 'Хлеб',
}

function answered(itemId: string, score: number): { verdict: VerdictCard; created: boolean } {
  const at = new Date('2026-09-19T10:00:00.000Z')
  return { verdict: { itemId, score, review: null, ratedAt: at, updatedAt: at }, created: true }
}

function fresh() {
  localStorage.setItem('molvia.actor', ME)
  setActivePinia(createPinia())
  return useVerdictDraftsStore()
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

/** Resolves when every promise already queued has run: drafts are sent in the background. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('verdict drafts', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    rateItem.mockReset()
    vi.restoreAllMocks()
  })

  it('saves on the phone first, sends after, and forgets once the server has it', async () => {
    let answer: (value: { verdict: VerdictCard; created: boolean }) => void = () => undefined
    rateItem.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const drafts = fresh()

    drafts.save(milk, 4, 'Нормальное, но на второй день кислит')

    expect(drafts.waiting.map((draft) => draft.card.itemId)).toEqual([milk.itemId])
    expect(localStorage.getItem(KEY)).toContain(milk.itemId)
    expect(rateItem).toHaveBeenCalledWith(milk.itemId, {
      score: 4,
      review: 'Нормальное, но на второй день кислит',
    })

    answer(answered(milk.itemId, 4))
    await settled()

    expect(drafts.drafts).toEqual({})
    expect(localStorage.getItem(KEY)).toBe('[]')
  })

  it('9: a review of blanks is not sent as a field — a PUT without one keeps what was written', async () => {
    rateItem.mockResolvedValue(answered(milk.itemId, 3))
    const drafts = fresh()

    drafts.save(milk, 3, '  \n\n ')
    await settled()

    expect(rateItem).toHaveBeenCalledWith(milk.itemId, { score: 3 })
  })

  it('7: no connection — the draft stays, the run stops as «offline», not as a failure', async () => {
    online(false)
    rateItem.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    const drafts = fresh()

    drafts.save(milk, 5, '')
    await settled()

    expect(drafts.waiting).toHaveLength(1)
    expect(drafts.held).toBe('offline')
  })

  it('a server that broke while the phone is online is a failure, and the draft stays', async () => {
    online(true)
    rateItem.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 502'))
    const drafts = fresh()

    drafts.save(milk, 5, '')
    await settled()

    expect(drafts.waiting).toHaveLength(1)
    expect(drafts.held).toBe('failed')
  })

  it('8: sent again after a lost answer — the same PUT, and gone once it lands', async () => {
    online(false)
    rateItem.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    rateItem.mockResolvedValueOnce(answered(milk.itemId, 2))
    const drafts = fresh()

    drafts.save(milk, 2, 'Кислит')
    await settled()
    await drafts.flush()

    expect(rateItem.mock.calls).toEqual([
      [milk.itemId, { score: 2, review: 'Кислит' }],
      [milk.itemId, { score: 2, review: 'Кислит' }],
    ])
    expect(drafts.drafts).toEqual({})
    expect(drafts.held).toBeNull()
  })

  it('a refusal a repeat would meet again comes back to the card with its code', async () => {
    rateItem.mockRejectedValueOnce(new ApiError(ISSUE.TEXT_NOT_VISIBLE))
    rateItem.mockResolvedValueOnce(answered(bread.itemId, 4))
    const drafts = fresh()

    drafts.save(milk, 1, ZERO_WIDTH)
    drafts.save(bread, 4, '')
    await settled()
    await drafts.flush()

    expect(drafts.drafts[milk.itemId]).toMatchObject({
      state: 'typing',
      score: 1,
      review: ZERO_WIDTH,
      error: ISSUE.TEXT_NOT_VISIBLE,
    })
    expect(drafts.drafts[bread.itemId]).toBeUndefined()
  })

  it('an item that is gone is forgotten quietly — there is nothing left to rate', async () => {
    rateItem.mockRejectedValue(new ApiError(ERROR.NOT_FOUND))
    const drafts = fresh()

    drafts.save(milk, 4, '')
    await settled()

    expect(drafts.drafts).toEqual({})
  })

  it('H2: an identity the server no longer knows holds the draft, and says it did not go', async () => {
    online(true)
    rateItem.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    const drafts = fresh()

    drafts.save(milk, 4, '')
    await settled()

    expect(drafts.waiting).toHaveLength(1)
    expect(drafts.held).toBe('failed')
  })

  it('H1: an answer off the contract — a proxy’s bare 404 — holds the draft, never confirms it', async () => {
    online(true)
    rateItem.mockRejectedValue(new ApiError(ISSUE.RESPONSE_INVALID, 'HTTP 404'))
    const drafts = fresh()

    drafts.save(milk, 4, '')
    await settled()

    expect(drafts.waiting).toHaveLength(1)
    expect(drafts.confirmed).toEqual({})
  })

  it('6: two runs at once are one run — a draft is never sent twice in parallel', async () => {
    let answer: (value: { verdict: VerdictCard; created: boolean }) => void = () => undefined
    rateItem.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const drafts = fresh()

    drafts.save(milk, 4, '')
    const first = drafts.flush()
    const second = drafts.flush()
    answer(answered(milk.itemId, 4))
    await Promise.all([first, second])

    expect(rateItem).toHaveBeenCalledTimes(1)
  })

  it('the latest word wins: rated again while the first was out, the second goes too', async () => {
    let answer: (value: { verdict: VerdictCard; created: boolean }) => void = () => undefined
    rateItem.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    rateItem.mockResolvedValueOnce(answered(milk.itemId, 5))
    const drafts = fresh()

    drafts.save(milk, 2, '')
    drafts.save(milk, 5, '')
    answer(answered(milk.itemId, 2))
    await settled()
    await drafts.flush()

    expect(rateItem.mock.calls.map(([, rating]) => rating.score)).toEqual([2, 5])
    expect(drafts.drafts).toEqual({})
  })

  it('what is being typed is kept but never sent; clearing it forgets it', async () => {
    const drafts = fresh()

    drafts.keep(milk, 2, 'Пахнет')
    await drafts.flush()

    expect(rateItem).not.toHaveBeenCalled()
    expect(drafts.drafts[milk.itemId]).toMatchObject({
      state: 'typing',
      score: 2,
      review: 'Пахнет',
    })

    drafts.keep(milk, null, '  ')
    expect(drafts.drafts).toEqual({})
  })

  it('a saved draft is not taken back by the card still typing', () => {
    online(false)
    rateItem.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    const drafts = fresh()

    drafts.save(milk, 4, '')
    drafts.keep(milk, 1, '')

    expect(drafts.drafts[milk.itemId]).toMatchObject({ state: 'saved', score: 4 })
  })

  it('7: a restart reads the drafts back and sends what was saved', async () => {
    online(false)
    rateItem.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    fresh().save(milk, 4, 'Кислит')
    fresh().keep(bread, 3, '')
    await settled()

    rateItem.mockReset()
    rateItem.mockResolvedValue(answered(milk.itemId, 4))
    const again = fresh()
    await again.flush()

    expect(rateItem.mock.calls).toEqual([[milk.itemId, { score: 4, review: 'Кислит' }]])
    expect(Object.keys(again.drafts)).toEqual([bread.itemId])
    expect(again.drafts[bread.itemId]?.card.boughtAt).toEqual(milk.boughtAt)
  })

  it('15: a broken memory is an empty one; a broken entry is dropped alone', () => {
    localStorage.setItem(KEY, '{not json')
    expect(fresh().drafts).toEqual({})

    const good = {
      card: { ...milk, boughtAt: milk.boughtAt.toISOString() },
      score: 4,
      review: '',
      state: 'saved',
      error: null,
    }
    localStorage.setItem(
      KEY,
      JSON.stringify([
        good,
        { ...good, score: 9 },
        { ...good, state: 'saved', score: null },
        { ...good, card: { ...good.card, itemId: 'nope' } },
        { ...good, error: 'error.made_up' },
        null,
      ]),
    )
    expect(Object.keys(fresh().drafts)).toEqual([milk.itemId])
  })

  it('14: another identity on the device has its own drafts, and the first ones are not sent', async () => {
    online(false)
    rateItem.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    const drafts = fresh()
    drafts.save(milk, 4, '')
    await settled()

    rateItem.mockReset()
    rateItem.mockResolvedValue(answered(bread.itemId, 3))
    useActorStore().id = OTHER
    await nextTick()
    await settled()

    expect(drafts.drafts).toEqual({})
    expect(rateItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(KEY)).toContain(milk.itemId)
  })

  it('R1: remembers when each rating reached the server, across a restart, until settled', async () => {
    rateItem.mockResolvedValue(answered(milk.itemId, 4))
    const drafts = fresh()
    const before = Date.now()

    drafts.save(milk, 4, '')
    await settled()

    const again = fresh()
    expect(again.confirmed[milk.itemId]).toBeGreaterThanOrEqual(before)

    again.settle(new Date(Date.now() + 1000))
    expect(again.confirmed).toEqual({})
    expect(fresh().confirmed).toEqual({})
  })
})
