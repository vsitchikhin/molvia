import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE, parseMoney } from '@molvia/model'
import type { SpendingAmendBody, SpendingBody, SpendingCategoryBody } from '@molvia/model'
import { categoriesWith } from '@/components/spending'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import type { SpendingFields } from '@/stores/spendingQueue'

const recordSpending = vi.fn<(body: SpendingBody) => Promise<unknown>>()
const amendSpending = vi.fn<(id: string, body: SpendingAmendBody) => Promise<unknown>>()
const removeSpending = vi.fn<(id: string) => Promise<void>>()
const restoreSpending = vi.fn<(id: string) => Promise<unknown>>()
const addSpendingCategory = vi.fn<(body: SpendingCategoryBody) => Promise<unknown>>()
const archiveSpendingCategory = vi.fn<(id: string) => Promise<unknown>>()
const restoreSpendingCategory = vi.fn<(id: string) => Promise<unknown>>()
const spending = vi.fn<(id: string) => Promise<{ revision: number }>>()
const calls: string[] = []
vi.mock('@/api', () => ({
  api: {
    recordSpending: (body: SpendingBody) => (calls.push(`record ${body.id}`), recordSpending(body)),
    amendSpending: (id: string, body: SpendingAmendBody) => (
      calls.push(`amend ${id} r${String(body.revision)}`),
      amendSpending(id, body)
    ),
    removeSpending: (id: string) => (calls.push(`remove ${id}`), removeSpending(id)),
    restoreSpending: (id: string) => (calls.push(`restore ${id}`), restoreSpending(id)),
    spending: (id: string) => (calls.push(`get ${id}`), spending(id)),
    addSpendingCategory: (body: SpendingCategoryBody) => (
      calls.push(`category-add ${body.id}`),
      addSpendingCategory(body)
    ),
    archiveSpendingCategory: (id: string) => (
      calls.push(`category-archive ${id}`),
      archiveSpendingCategory(id)
    ),
    restoreSpendingCategory: (id: string) => (
      calls.push(`category-restore ${id}`),
      restoreSpendingCategory(id)
    ),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const OTHER = '2c4e6a80-1111-4222-8333-444455556666'
const BARBER = 'eeeeeeee-0000-4000-8000-000000000001'
const RENT = 'eeeeeeee-0000-4000-8000-000000000002'
const BEAUTY = 'ffffffff-0000-4000-8000-000000000001'
const TAXI = 'ffffffff-0000-4000-8000-000000000002'

function fields(price = '5000', note = 'Барбер', categoryId = BEAUTY): SpendingFields {
  return { spentOn: '2026-09-20', amount: parseMoney(price, 'AMD'), categoryId, note }
}

function fresh(state: 'ready' | 'idle' = 'ready') {
  localStorage.setItem('molvia.actor', ME)
  setActivePinia(createPinia())
  useActorStore().state = state
  return useSpendingQueueStore()
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))
const offline = () => Promise.reject(new ApiError(ERROR.INTERNAL, 'offline', false))

describe('spending queue', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    calls.length = 0
    for (const mock of [
      recordSpending,
      amendSpending,
      removeSpending,
      restoreSpending,
      addSpendingCategory,
      archiveSpendingCategory,
      restoreSpendingCategory,
    ])
      mock.mockReset().mockResolvedValue(undefined)
    spending.mockReset().mockResolvedValue({ revision: 5 })
    vi.restoreAllMocks()
  })

  // «Сохраните ещё раз поверх» (adversarial round 6 of MOL-159, О): the revision a conflict was
  // refused over is the one that conflicts, and the phone may hold no newer one on any page.
  describe('an amendment sent over what the server holds', () => {
    it('asks the server its revision as it leaves, and goes over that', async () => {
      const queue = fresh()
      queue.amend(BARBER, 1, fields('6000'), true)
      await queue.flush()
      expect(calls).toEqual([`get ${BARBER}`, `amend ${BARBER} r5`])
      expect(queue.rejected).toEqual([])
    })

    it('keeps «over» on the shelf — another window, or the app opened again, sends it the same', async () => {
      const first = fresh('idle')
      first.amend(BARBER, 1, fields('6000'), true)
      const queue = fresh()
      await queue.flush()
      expect(calls).toEqual([`get ${BARBER}`, `amend ${BARBER} r5`])
    })

    it('an amendment folded into it, or made behind it while it is on the way, asks too', async () => {
      const folded = fresh('idle')
      folded.amend(BARBER, 1, fields('6000'), true)
      folded.amend(BARBER, 1, fields('7000'))
      useActorStore().state = 'ready'
      await folded.flush()
      expect(calls).toEqual([`get ${BARBER}`, `amend ${BARBER} r5`])

      calls.length = 0
      localStorage.clear()
      let land: () => void = () => undefined
      amendSpending.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            land = () => {
              resolve(undefined)
            }
          }),
      )
      spending.mockResolvedValueOnce({ revision: 5 }).mockResolvedValueOnce({ revision: 6 })
      const queue = fresh()
      queue.amend(BARBER, 1, fields('6000'), true)
      await settled()
      queue.amend(BARBER, 1, fields('8000'))
      land()
      await queue.flush()
      await settled()
      await queue.flush()
      expect(calls).toEqual([
        `get ${BARBER}`,
        `amend ${BARBER} r5`,
        `get ${BARBER}`,
        `amend ${BARBER} r6`,
      ])
    })

    it('a spending gone from the server is refused as such, and the refusal keeps «over»', async () => {
      spending.mockRejectedValue(new ApiError(ERROR.NOT_FOUND))
      const queue = fresh()
      queue.amend(BARBER, 1, fields('6000'), true)
      await queue.flush()
      expect(calls).toEqual([`get ${BARBER}`])
      expect(queue.rejected).toMatchObject([
        { code: ERROR.NOT_FOUND, write: { kind: 'amend', over: true } },
      ])
    })

    it('must not fire: an amendment not marked goes over its own revision, asking nothing', async () => {
      const queue = fresh()
      queue.amend(BARBER, 3, fields('6000'))
      await queue.flush()
      expect(calls).toEqual([`amend ${BARBER} r3`])
    })
  })

  it('sends nothing until the server has said who we are (MOL-56)', async () => {
    const queue = fresh('idle')
    queue.record({ id: BARBER, ...fields() })
    await settled()
    expect(calls).toEqual([])
    expect(queue.pending).toHaveLength(1)

    useActorStore().state = 'ready'
    await queue.flush()
    expect(calls).toEqual([`record ${BARBER}`])
    expect(queue.pending).toEqual([])
    expect(queue.landed).toBe(1)
  })

  it('keeps a spending made with no signal on the device, per owner, and sends it later', async () => {
    recordSpending.mockImplementationOnce(offline)
    const queue = fresh()
    queue.record({ id: BARBER, ...fields() })
    await settled()
    expect(queue.pending).toHaveLength(1)
    expect(localStorage.getItem(`molvia.spending-queue.${ME}`)).toContain(BARBER)

    // Another launch reads the same queue; another owner does not see it.
    const again = fresh()
    await again.flush()
    expect(calls).toEqual([`record ${BARBER}`, `record ${BARBER}`])
    expect(again.pending).toEqual([])
    localStorage.setItem('molvia.actor', OTHER)
    expect(localStorage.getItem(`molvia.spending-queue.${OTHER}`)).toBeNull()
  })

  it.each([
    ['a connection that dropped', new ApiError(ERROR.INTERNAL, 'x', false)],
    ['a portal page', new ApiError(ISSUE.RESPONSE_INVALID, 'x', false)],
    ['a code the API did not say itself', new ApiError(ERROR.NOT_FOUND, 'x', false)],
    ['an identity the server forgot', new ApiError(ERROR.NO_ACTOR, 'x')],
    ['a server that broke', new ApiError(ERROR.INTERNAL, 'x')],
  ])('%s holds the queue rather than dropping the spending', async (_, error) => {
    recordSpending.mockRejectedValueOnce(error)
    const queue = fresh()
    queue.record({ id: BARBER, ...fields() })
    queue.record({ id: RENT, ...fields('160000', 'Аренда') })
    await settled()
    expect(calls).toEqual([`record ${BARBER}`])
    expect(queue.pending).toHaveLength(2)
    expect(queue.rejected).toEqual([])
  })

  it('sets a refusal aside and goes on with the rest', async () => {
    recordSpending.mockRejectedValueOnce(new ApiError(ERROR.SPENDING_IN_FUTURE, 'spentOn'))
    const queue = fresh()
    queue.record({ id: BARBER, ...fields() })
    queue.record({ id: RENT, ...fields('160000', 'Аренда') })
    await settled()
    await queue.flush()
    expect(calls).toEqual([`record ${BARBER}`, `record ${RENT}`])
    expect(queue.pending).toEqual([])
    expect(queue.rejected).toMatchObject([
      { code: ERROR.SPENDING_IN_FUTURE, write: { kind: 'record' } },
    ])

    const [refused] = queue.rejected
    if (refused) queue.dismiss(refused)
    expect(queue.rejected).toEqual([])
    expect(fresh().rejected).toEqual([])
  })

  describe('the writes of one spending fold while they wait', () => {
    it('an amendment of one not yet sent rewrites its record — one POST', async () => {
      const queue = fresh('idle')
      queue.record({ id: BARBER, ...fields() })
      queue.amend(BARBER, 1, fields('6000'))
      useActorStore().state = 'ready'
      await queue.flush()
      expect(calls).toEqual([`record ${BARBER}`])
      expect(recordSpending.mock.calls[0]?.[0].amount.minor).toBe(600_000n)
    })

    it('two amendments are one PUT over the revision the first was made on', async () => {
      const queue = fresh('idle')
      queue.amend(BARBER, 3, fields('6000'))
      queue.amend(BARBER, 3, fields('7000'))
      useActorStore().state = 'ready'
      await queue.flush()
      expect(calls).toEqual([`amend ${BARBER} r3`])
      expect(amendSpending.mock.calls[0]?.[1].amount.minor).toBe(700_000n)
    })

    it('an amendment made while its record is on the way goes over revision 1', async () => {
      let land: () => void = () => undefined
      recordSpending.mockImplementationOnce(
        () =>
          new Promise(
            (resolve) =>
              (land = () => {
                resolve(undefined)
              }),
          ),
      )
      const queue = fresh()
      queue.record({ id: BARBER, ...fields() })
      await settled()
      queue.amend(BARBER, 1, fields('6000'))
      land()
      await queue.flush()
      await settled()
      await queue.flush()
      expect(calls).toEqual([`record ${BARBER}`, `amend ${BARBER} r1`])
    })

    it('an amendment made while another is on the way goes over the next revision', async () => {
      let land: () => void = () => undefined
      amendSpending.mockImplementationOnce(
        () =>
          new Promise(
            (resolve) =>
              (land = () => {
                resolve(undefined)
              }),
          ),
      )
      const queue = fresh()
      queue.amend(BARBER, 2, fields('6000'))
      await settled()
      queue.amend(BARBER, 2, fields('7000'))
      land()
      await settled()
      await queue.flush()
      expect(calls).toEqual([`amend ${BARBER} r2`, `amend ${BARBER} r3`])
    })

    it('a record the server holds with other fields goes on as an amendment over 1', async () => {
      recordSpending.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, 'id'))
      const queue = fresh()
      queue.record({ id: BARBER, ...fields() })
      await settled()
      await queue.flush()
      expect(calls).toEqual([`record ${BARBER}`, `amend ${BARBER} r1`])
      expect(queue.rejected).toEqual([])
    })

    it('MOL-123: a fold keeps the account and «списано», and «без счёта» stays an explicit null', async () => {
      const CARD = 'aaaaaaaa-0000-4000-8000-000000000001'
      const debited = parseMoney('1200', 'RUB')
      const queue = fresh('idle')
      queue.record({ id: BARBER, ...fields(), accountId: CARD, debited })
      queue.amend(BARBER, 1, { ...fields('6000'), accountId: CARD, debited })
      queue.amend(RENT, 2, { ...fields('7000'), accountId: CARD })
      queue.amend(RENT, 2, { ...fields('8000'), accountId: null })
      useActorStore().state = 'ready'
      await queue.flush()
      expect(recordSpending.mock.calls[0]?.[0]).toMatchObject({ accountId: CARD, debited })
      expect(amendSpending.mock.calls[0]?.[1]).toMatchObject({ revision: 2, accountId: null })
    })

    it('MOL-123: a record turned into an amendment after 409 keeps its account', async () => {
      const CARD = 'aaaaaaaa-0000-4000-8000-000000000001'
      recordSpending.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, 'id'))
      const queue = fresh()
      queue.record({ id: BARBER, ...fields(), accountId: CARD })
      await settled()
      await queue.flush()
      expect(amendSpending.mock.calls[0]?.[1]).toMatchObject({ revision: 1, accountId: CARD })
    })

    it('Б: an amendment whose answer was lost is never folded into — the next goes over the next revision', async () => {
      amendSpending.mockImplementationOnce(offline)
      const queue = fresh()
      queue.amend(BARBER, 1, fields('6000'))
      await settled()
      queue.amend(BARBER, 1, fields('7000'))
      await queue.flush()
      expect(calls).toEqual([`amend ${BARBER} r1`, `amend ${BARBER} r1`, `amend ${BARBER} r2`])
      expect(amendSpending.mock.calls[1]?.[1].amount.minor).toBe(600_000n)
      expect(amendSpending.mock.calls[2]?.[1].amount.minor).toBe(700_000n)
    })

    it('В: a write another window has begun to send is marked on the shelf and not folded into', () => {
      localStorage.setItem(
        `molvia.spending-queue.${ME}`,
        JSON.stringify([
          {
            key: 'a',
            attempted: true,
            write: {
              kind: 'record',
              body: {
                id: BARBER,
                spentOn: '2026-09-20',
                amount: { amount: '5000.00', currency: 'AMD' },
                categoryId: BEAUTY,
              },
            },
          },
        ]),
      )
      const queue = fresh('idle')
      queue.amend(BARBER, 1, fields('6000'))
      queue.remove(BARBER)
      expect(queue.pending.map((write) => write.kind)).toEqual(['record', 'amend', 'remove'])
      const amend = queue.pending[1]
      expect(amend?.kind === 'amend' && amend.body.revision).toBe(1)
    })

    it('does not fold into another spending', async () => {
      const queue = fresh('idle')
      queue.record({ id: BARBER, ...fields() })
      queue.amend(RENT, 2, fields('160000', 'Аренда'))
      useActorStore().state = 'ready'
      await queue.flush()
      expect(calls).toEqual([`record ${BARBER}`, `amend ${RENT} r2`])
    })
  })

  describe('«Удалить» and «Вернуть»', () => {
    it('«Вернуть» before anything left sends the spending as it was last typed', async () => {
      const queue = fresh('idle')
      queue.record({ id: BARBER, ...fields() })
      queue.amend(BARBER, 1, fields('6000'))
      const undo = queue.remove(BARBER)
      // Nobody began to send it: it never reached the server, and goes out of the queue (У-1).
      expect(queue.pending).toEqual([])

      queue.restore(undo)
      useActorStore().state = 'ready'
      await queue.flush()
      expect(calls).toEqual([`record ${BARBER}`])
      expect(recordSpending.mock.calls[0]?.[0].amount.minor).toBe(600_000n)
    })

    it('removing one nobody began to send sends nothing at all (review У-1)', async () => {
      const queue = fresh('idle')
      queue.record({ id: BARBER, ...fields() })
      queue.remove(BARBER)
      useActorStore().state = 'ready'
      await queue.flush()
      expect(calls).toEqual([])
    })

    it('А: a record whose answer was lost, then removed, is removed on the server', async () => {
      recordSpending.mockImplementationOnce(offline)
      const queue = fresh()
      queue.record({ id: BARBER, ...fields() })
      await settled()
      queue.remove(BARBER)
      await queue.flush()
      expect(calls).toEqual([`record ${BARBER}`, `record ${BARBER}`, `remove ${BARBER}`])
      expect(queue.pending).toEqual([])
    })

    it('a removal takes the refusal of its spending with it', async () => {
      recordSpending.mockRejectedValueOnce(new ApiError(ERROR.SPENDING_IN_FUTURE, 'spentOn'))
      const queue = fresh()
      queue.record({ id: BARBER, ...fields() })
      await settled()
      expect(queue.rejected).toHaveLength(1)
      queue.remove(BARBER)
      expect(queue.rejected).toEqual([])
    })

    it('«Вернуть» before the removal left takes the removal back — nothing is sent', async () => {
      const queue = fresh('idle')
      queue.restore(queue.remove(BARBER))
      useActorStore().state = 'ready'
      await queue.flush()
      expect(calls).toEqual([])
    })

    it('«Вернуть» after the removal left brings the same spending back', async () => {
      const queue = fresh()
      const undo = queue.remove(BARBER)
      await settled()
      queue.restore(undo)
      await settled()
      await queue.flush()
      expect(calls).toEqual([`remove ${BARBER}`, `restore ${BARBER}`])
    })

    it('a removal of a spending the server does not have is done, not refused', async () => {
      removeSpending.mockRejectedValueOnce(new ApiError(ERROR.NOT_FOUND, 'spendingId'))
      const queue = fresh()
      queue.remove(BARBER)
      await settled()
      expect(queue.rejected).toEqual([])
      expect(queue.pending).toEqual([])
    })

    it('«Вернуть» too late is a refusal the screen can name', async () => {
      restoreSpending.mockRejectedValueOnce(new ApiError(ERROR.NOT_FOUND, 'spendingId'))
      const queue = fresh()
      queue.restore({ id: BARBER })
      await settled()
      expect(queue.rejected).toMatchObject([{ code: ERROR.NOT_FOUND, write: { kind: 'restore' } }])
    })
  })

  describe('round 2: what a write without a connection must not do', () => {
    it('tries nothing while the browser knows there is no connection, so changes still fold', async () => {
      const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      const queue = fresh()
      queue.amend(BARBER, 1, fields('6000'))
      await settled()
      queue.amend(BARBER, 1, fields('7000'))
      await settled()
      expect(calls).toEqual([])
      onLine.mockReturnValue(true)
      await queue.flush()
      expect(calls).toEqual([`amend ${BARBER} r1`])
    })

    it('Н1: an amendment refused as moved elsewhere takes the ones behind it — none goes over a guessed revision', async () => {
      amendSpending
        .mockImplementationOnce(offline)
        .mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, 'revision'))
      const queue = fresh()
      queue.amend(BARBER, 1, fields('6000'))
      await settled()
      queue.amend(BARBER, 1, fields('6000', 'Барбер, борода'))
      await queue.flush()
      expect(calls).toEqual([`amend ${BARBER} r1`, `amend ${BARBER} r1`])
      expect(queue.pending).toEqual([])
      expect(queue.rejected).toHaveLength(1)
      const refused = queue.rejected[0]?.write
      expect(refused?.kind === 'amend' && refused.body.note).toBe('Барбер, борода')
    })

    it('Н3: a refused record takes the amendments behind it — one refusal, with what was typed last', async () => {
      recordSpending
        .mockImplementationOnce(offline)
        .mockRejectedValueOnce(new ApiError(ERROR.SPENDING_CATEGORY_UNKNOWN, 'categoryId'))
      const queue = fresh()
      queue.record({ id: BARBER, ...fields() })
      await settled()
      queue.amend(BARBER, 1, fields('6000'))
      await queue.flush()
      expect(calls).toEqual([`record ${BARBER}`, `record ${BARBER}`])
      expect(queue.pending).toEqual([])
      expect(queue.rejected).toHaveLength(1)
      const refused = queue.rejected[0]?.write
      expect(refused?.kind === 'record' && refused.body.amount.minor).toBe(600_000n)
    })

    it('Р1: a record refused after the spending was removed leaves no «Не принята» behind', async () => {
      recordSpending
        .mockImplementationOnce(offline)
        .mockRejectedValueOnce(new ApiError(ERROR.SPENDING_IN_FUTURE, 'spentOn'))
      removeSpending.mockRejectedValueOnce(new ApiError(ERROR.NOT_FOUND, 'spendingId'))
      const queue = fresh()
      queue.record({ id: BARBER, ...fields() })
      await settled()
      queue.remove(BARBER)
      await queue.flush()
      expect(calls).toEqual([`record ${BARBER}`, `record ${BARBER}`, `remove ${BARBER}`])
      expect(queue.pending).toEqual([])
      expect(queue.rejected).toEqual([])
    })

    it('a record refused with «Вернуть» standing after its removal is still a refusal', async () => {
      recordSpending
        .mockImplementationOnce(offline)
        .mockRejectedValueOnce(new ApiError(ERROR.SPENDING_IN_FUTURE, 'spentOn'))
      const queue = fresh()
      queue.record({ id: BARBER, ...fields() })
      await settled()
      queue.restore(queue.remove(BARBER))
      await queue.flush()
      expect(queue.rejected).toHaveLength(1)
    })

    it('a portal answering in the API’s place leaves the write unmarked — it never reached the server', async () => {
      recordSpending.mockRejectedValueOnce(new ApiError(ISSUE.RESPONSE_INVALID, 'portal', false))
      const queue = fresh()
      queue.record({ id: BARBER, ...fields() })
      await settled()
      queue.remove(BARBER)
      await queue.flush()
      expect(calls).toEqual([`record ${BARBER}`])
      expect(queue.pending).toEqual([])
    })
  })

  describe('categories go through the same queue (В-4)', () => {
    it('a category made with no signal goes before the spending that names it', async () => {
      const queue = fresh('idle')
      queue.addCategory({ id: TAXI, name: 'Такси' })
      queue.record({ id: BARBER, ...fields('1500', 'До вокзала', TAXI) })
      useActorStore().state = 'ready'
      await queue.flush()
      expect(calls).toEqual([`category-add ${TAXI}`, `record ${BARBER}`])
    })

    it('«Убрать» and «Вернуть» still waiting cancel out', async () => {
      const queue = fresh('idle')
      queue.archiveCategory(BEAUTY, true)
      queue.archiveCategory(BEAUTY, false)
      queue.archiveCategory(TAXI, false)
      queue.archiveCategory(TAXI, true)
      useActorStore().state = 'ready'
      await queue.flush()
      expect(calls).toEqual([])
    })

    it('a name taken by a live category is a refusal', async () => {
      addSpendingCategory.mockRejectedValueOnce(new ApiError(ERROR.SPENDING_CATEGORY_TAKEN, 'name'))
      const queue = fresh()
      queue.addCategory({ id: TAXI, name: 'Такси' })
      await settled()
      expect(queue.rejected).toMatchObject([{ code: ERROR.SPENDING_CATEGORY_TAKEN }])
      expect(queue.arrived).toEqual([])
    })

    // Out of the queue on its answer, not yet in the list the server is asked for again: the chip
    // just chosen must not vanish from under «Сохранить трату» in between.
    it('a category that landed stays on the chips until the server’s list names it', async () => {
      const queue = fresh()
      queue.addCategory({ id: TAXI, name: 'Такси' })
      await settled()
      expect(queue.pending).toEqual([])
      const names = categoriesWith([], [...queue.arrived, ...queue.pending]).map((one) => one.name)
      expect(names).toEqual(['Такси'])
    })
  })

  it('drops a broken entry alone and keeps the ones around it', () => {
    localStorage.setItem(
      `molvia.spending-queue.${ME}`,
      JSON.stringify([
        { key: 'a', write: { kind: 'remove', id: BARBER } },
        { key: 'b', write: { kind: 'record', body: { id: RENT } } },
        { key: 'c', write: { kind: 'restore', id: 'not-an-id' } },
        { key: 'd', write: { kind: 'category-archive', id: BEAUTY } },
      ]),
    )
    const queue = fresh('idle')
    expect(queue.pending.map((write) => write.kind)).toEqual(['remove', 'category-archive'])
  })
})
