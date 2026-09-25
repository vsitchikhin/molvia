import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { ERROR, money } from '@molvia/model'
import type { IncomeAmendBody, IncomeBody } from '@molvia/model'
import { createIncomeRepository } from '@/db/incomes-repository'
import { actors, incomeRevisions, incomes } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll, insertActor } from './fixtures'

const { db, close } = connectDrizzle()
const repository = createIncomeRepository(db)

beforeEach(async () => {
  await clearAll(db)
})
afterAll(async () => {
  await clearAll(db)
  await close()
})

function body(patch: Partial<IncomeBody> = {}): IncomeBody {
  return {
    id: randomUUID(),
    amount: money(9_961_500n, 'RUB'),
    receivedOn: '2026-09-15',
    source: 'salary',
    ...patch,
  }
}

function amendment(income: IncomeBody, patch: Partial<IncomeAmendBody> = {}): IncomeAmendBody {
  const { amount, receivedOn, heldBefore, source, note } = income
  return { amount, receivedOn, heldBefore, source, note, revision: 1, ...patch }
}

describe('incomes: запись', () => {
  it('пишет доход целиком, и остаток — в валюте поступления', async () => {
    const owner = await insertActor(db)
    const input = body({
      amount: money(20_000_000n, 'AMD'),
      heldBefore: money(11_500_000n, 'AMD'),
      source: 'freelance',
      note: 'Викаса',
    })
    const { income, created } = await repository.add(owner, input)

    expect(created).toBe(true)
    expect(income).toMatchObject({
      id: input.id,
      actorId: owner,
      amount: money(20_000_000n, 'AMD'),
      receivedOn: '2026-09-15',
      heldBefore: money(11_500_000n, 'AMD'),
      source: 'freelance',
      note: 'Викаса',
      revision: 1,
      amendedAt: null,
    })
  })

  it('«не сказал» остаётся null, а ноль — нулём', async () => {
    const owner = await insertActor(db)
    const unsaid = await repository.add(owner, body())
    const empty = await repository.add(owner, body({ heldBefore: money(0n, 'RUB') }))
    expect(unsaid.income.heldBefore).toBeNull()
    expect(empty.income.heldBefore).toEqual(money(0n, 'RUB'))
  })

  it('повтор тем же id и тем же телом — тот же доход', async () => {
    const owner = await insertActor(db)
    const input = body({ note: 'Викаса' })
    const first = await repository.add(owner, input)
    const again = await repository.add(owner, input)
    expect(again).toEqual({ income: first.income, created: false })
    expect(await db.select().from(incomes)).toHaveLength(1)
  })

  it('тот же id с другой суммой, днём, источником или заметкой — CONFLICT, записанное цело (В-6)', async () => {
    const owner = await insertActor(db)
    const input = body()
    await repository.add(owner, input)
    for (const other of [
      { amount: money(9_961_600n, 'RUB') },
      { receivedOn: '2026-09-16' },
      { source: 'bonus' as const },
      { note: 'премия' },
      { heldBefore: money(1n, 'RUB') },
    ]) {
      await expect(repository.add(owner, { ...input, ...other })).rejects.toMatchObject({
        code: ERROR.CONFLICT,
      })
    }
    expect((await repository.list(owner))[0]?.amount).toEqual(input.amount)
  })

  it('чужой id — CONFLICT, и чужой доход не тронут', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const input = body()
    await repository.add(stranger, input)
    await expect(repository.add(owner, input)).rejects.toMatchObject({ code: ERROR.CONFLICT })
    expect(await repository.list(owner)).toEqual([])
    expect(await repository.list(stranger)).toHaveLength(1)
  })

  it('база не пускает ноль, неизвестную валюту, неизвестный источник и отрицательный остаток', async () => {
    const owner = await insertActor(db)
    const row = {
      actorId: owner,
      amountMinor: 100n,
      currency: 'RUB',
      receivedOn: '2026-09-15',
      source: 'salary',
    } as const
    const insert = (patch: Record<string, unknown>) =>
      db.execute(sql`
        insert into incomes (id, actor_id, amount_minor, currency, received_on, source, held_before_minor)
        values (${randomUUID()}, ${owner}, ${patch.amount ?? row.amountMinor}, ${patch.currency ?? row.currency},
                ${row.receivedOn}, ${patch.source ?? row.source}, ${patch.held ?? null})`)
    await expect(insert({ amount: 0n })).rejects.toThrow()
    await expect(insert({ currency: 'GEL' })).rejects.toThrow()
    await expect(insert({ source: 'lottery' })).rejects.toThrow()
    await expect(insert({ held: -1n })).rejects.toThrow()
    await db.insert(incomes).values({ id: randomUUID(), ...row })
    expect(await db.select().from(incomes)).toHaveLength(1)
  })
})

describe('incomes: правка с историей (В-3 MOL-42)', () => {
  it('правит на месте, прежняя версия — в истории, created_at прежний', async () => {
    const owner = await insertActor(db)
    const input = body()
    const { income } = await repository.add(owner, input)
    const { income: amended, amended: moved } = await repository.amend(
      owner,
      input.id,
      amendment(input, { amount: money(10_234_500n, 'RUB'), receivedOn: '2026-08-31' }),
    )

    expect(moved).toBe(true)
    expect(amended).toMatchObject({
      amount: money(10_234_500n, 'RUB'),
      receivedOn: '2026-08-31',
      revision: 2,
      createdAt: income.createdAt,
    })
    expect(amended.amendedAt).not.toBeNull()
    const history = (await repository.history(owner)).get(input.id)
    expect(history).toEqual([
      expect.objectContaining({
        revision: 1,
        amount: money(9_961_500n, 'RUB'),
        receivedOn: '2026-09-15',
        source: 'salary',
        replacedAt: amended.amendedAt,
      }),
    ])
  })

  it('повтор той же правки — успех без новой версии', async () => {
    const owner = await insertActor(db)
    const input = body()
    await repository.add(owner, input)
    const change = amendment(input, { note: 'Викаса' })
    await repository.amend(owner, input.id, change)
    const again = await repository.amend(owner, input.id, change)
    expect(again.amended).toBe(false)
    expect(await db.select().from(incomeRevisions)).toHaveLength(1)
  })

  it('правка поверх уже сменённой версии — CONFLICT, записанное цело', async () => {
    const owner = await insertActor(db)
    const input = body()
    await repository.add(owner, input)
    await repository.amend(owner, input.id, amendment(input, { note: 'с одного телефона' }))
    await expect(
      repository.amend(owner, input.id, amendment(input, { note: 'с другого' })),
    ).rejects.toMatchObject({ code: ERROR.CONFLICT })
    expect((await repository.list(owner))[0]?.note).toBe('с одного телефона')
  })

  it('две правки одной версии разом — одна проходит, вторая CONFLICT', async () => {
    const owner = await insertActor(db)
    const input = body()
    await repository.add(owner, input)
    const results = await Promise.allSettled([
      repository.amend(owner, input.id, amendment(input, { note: 'первая' })),
      repository.amend(owner, input.id, amendment(input, { note: 'вторая' })),
    ])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: ERROR.CONFLICT },
    })
  })

  it('помеченный, чужой, отсутствующий и кривой id — NOT_FOUND', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const removed = body()
    await repository.add(owner, removed)
    await repository.remove(owner, removed.id)
    const theirs = body()
    await repository.add(stranger, theirs)
    for (const [id, input] of [
      [removed.id, removed],
      [theirs.id, theirs],
      [randomUUID(), removed],
      ['not-a-uuid', removed],
    ] as const) {
      await expect(repository.amend(owner, id, amendment(input))).rejects.toMatchObject({
        code: ERROR.NOT_FOUND,
      })
    }
  })

  it('история уходит вместе с доходом', async () => {
    const owner = await insertActor(db)
    const input = body()
    await repository.add(owner, input)
    await repository.amend(owner, input.id, amendment(input, { note: 'x' }))
    await repository.remove(owner, input.id)
    await repository.purgeRemoved(owner)
    expect(await db.select().from(incomeRevisions)).toEqual([])
  })
})

describe('incomes: чтение и удаление', () => {
  it('отдаёт только свои, по дню, затем по порядку записи', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const late = await repository.add(owner, body({ receivedOn: '2026-09-20' }))
    const early = await repository.add(owner, body({ receivedOn: '2026-09-01' }))
    const sameDay = await repository.add(owner, body({ receivedOn: '2026-09-20' }))
    await repository.add(stranger, body())

    expect((await repository.list(owner)).map(({ id }) => id)).toEqual([
      early.income.id,
      late.income.id,
      sameDay.income.id,
    ])
  })

  it('удаляет свой — из всех читателей; чужой, отсутствующий и кривой id — молча', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const own = await repository.add(owner, body())
    const theirs = await repository.add(stranger, body())

    await repository.remove(owner, theirs.income.id)
    await repository.remove(owner, randomUUID())
    await repository.remove(owner, 'not-a-uuid')
    await repository.remove(owner, own.income.id.toUpperCase())

    expect(await repository.list(owner)).toEqual([])
    expect((await repository.list(stranger)).map(({ id }) => id)).toEqual([theirs.income.id])
  })

  it('«Вернуть» возвращает ту же строку с прежним created_at, чужое — нет; повтор — тот же успех', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const own = await repository.add(owner, body())
    await repository.remove(owner, own.income.id)

    expect(await repository.restore(stranger, own.income.id)).toBe(false)
    expect(await repository.restore(owner, own.income.id)).toBe(true)
    expect((await repository.list(owner))[0]?.createdAt).toEqual(own.income.createdAt)
    expect(await repository.restore(owner, own.income.id)).toBe(true)
  })

  it('через 10 минут удалённое не вернуть и таймер стирает его — у всех; свежее не трогает (В-7)', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const old = await repository.add(owner, body())
    const theirs = await repository.add(stranger, body())
    const fresh = await repository.add(owner, body())
    await repository.remove(owner, old.income.id)
    await repository.remove(stranger, theirs.income.id)
    await repository.remove(owner, fresh.income.id)
    await db
      .update(incomes)
      .set({ deletedAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(inArray(incomes.id, [old.income.id, theirs.income.id]))

    expect(await repository.restore(owner, old.income.id)).toBe(false)
    await repository.purgeStale()
    expect((await db.select().from(incomes)).map(({ id }) => id)).toEqual([fresh.income.id])
    expect(await repository.restore(owner, fresh.income.id)).toBe(true)
  })

  it('удалённое держит имя, пока не стёрто, и стирается окончательно только своё — кроме названного', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const input = body()
    await repository.add(owner, input)
    await repository.remove(owner, input.id)
    await expect(repository.add(owner, input)).rejects.toMatchObject({ code: ERROR.CONFLICT })

    const kept = await repository.add(owner, body())
    await repository.remove(owner, kept.income.id)
    const theirs = await repository.add(stranger, body())
    await repository.remove(stranger, theirs.income.id)
    await repository.purgeRemoved(owner, kept.income.id)
    expect(await repository.restore(owner, input.id)).toBe(false)
    expect(await repository.restore(owner, kept.income.id)).toBe(true)
    expect(await repository.restore(stranger, theirs.income.id)).toBe(true)
  })

  it('уходит вместе с владельцем', async () => {
    const owner = await insertActor(db)
    await repository.add(owner, body())
    await db.delete(actors).where(eq(actors.id, owner))
    expect(await db.select().from(incomes)).toEqual([])
  })
})
