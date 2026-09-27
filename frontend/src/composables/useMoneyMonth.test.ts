import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMoney } from '@molvia/model'
import type { JournalKey, MoneyMonthView } from '@molvia/model'
import { useMoneyMonth } from '@/composables/useMoneyMonth'
import type { MoneyMonth } from '@/composables/useMoneyMonth'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

const moneyMonth = vi.fn<(month: string, cursor?: JournalKey) => Promise<MoneyMonthView>>()
vi.mock('@/api', () => ({
  api: { moneyMonth: (month: string, cursor?: JournalKey) => moneyMonth(month, cursor) },
}))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const BEAUTY = 'ffffffff-0000-4000-8000-000000000001'
const amd = (text: string) => parseMoney(text, 'AMD')

function entry(id: string, day: string, note: string) {
  return {
    kind: 'manual' as const,
    spending: {
      id,
      spentOn: day,
      amount: amd('1000'),
      categoryId: BEAUTY,
      note,
      place: null,
      rate: null,
      accountId: null,
      debited: null,
      revision: 1,
      amendedAt: null,
    },
    counted: amd('1000'),
  }
}

function page(days: [string, ReturnType<typeof entry>[]][], cursor: JournalKey | null) {
  return {
    month: '2026-09',
    spendCurrency: 'AMD',
    incomeCurrency: 'AMD',
    spent: amd('3000'),
    uncounted: [],
    foreign: [],
    spentIncome: null,
    income: amd('0'),
    incomeUncounted: [],
    rest: null,
    rate: null,
    rateKind: 'live',
    previousSpent: null,
    byCategory: [],
    categories: [{ id: BEAUTY, preset: 'beauty', name: null, colour: null, archived: false }],
    days: days.map(([day, entries]) => ({ day, total: amd('1000'), estimated: false, entries })),
    cursor,
    remaining: cursor ? 1 : 0,
    remainingFrom: null,
    remainingTo: null,
  } satisfies MoneyMonthView
}

/** Mounts a component that uses the composable, and hands back what it returned. */
function host(pinia: ReturnType<typeof createPinia>): MoneyMonth {
  const holder: { month?: MoneyMonth } = {}
  const Host = defineComponent({
    setup() {
      holder.month = useMoneyMonth(ref('2026-09'))
      return () => h('div')
    },
  })
  mount(Host, { global: { plugins: [pinia] } })
  if (!holder.month) throw new Error('not mounted')
  return holder.month
}

describe('useMoneyMonth', () => {
  beforeEach(() => {
    localStorage.clear()
    moneyMonth.mockReset()
    setActivePinia(createPinia())
  })

  it('Е: a next page asked for before a fresh read landed does not lay the old answer over it', async () => {
    const cursor: JournalKey = {
      day: '2026-09-20',
      moment: 1,
      id: 'eeeeeeee-0000-4000-8000-00000000000a',
    }
    const first = page(
      [['2026-09-20', [entry('eeeeeeee-0000-4000-8000-00000000000a', '2026-09-20', 'Rent')]]],
      cursor,
    )
    const fresh = page(
      [
        ['2026-09-27', [entry('eeeeeeee-0000-4000-8000-00000000000b', '2026-09-27', 'Taxi')]],
        ['2026-09-20', [entry('eeeeeeee-0000-4000-8000-00000000000a', '2026-09-20', 'Rent')]],
      ],
      cursor,
    )
    const second = page(
      [['2026-09-10', [entry('eeeeeeee-0000-4000-8000-00000000000c', '2026-09-10', 'Cafe')]]],
      null,
    )

    const pinia = createPinia()
    setActivePinia(pinia)
    const actor = useActorStore()
    actor.id = ACTOR
    moneyMonth.mockResolvedValueOnce(first)
    const month = host(pinia)
    await flushPromises()

    let giveNext: (value: MoneyMonthView) => void = () => undefined
    let giveFresh: (value: MoneyMonthView) => void = () => undefined
    moneyMonth
      .mockImplementationOnce(() => new Promise((resolve) => (giveNext = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (giveFresh = resolve)))
      .mockResolvedValue(second)
    const more = month.loadMore()
    useSpendingQueueStore().landed++
    await flushPromises()
    giveFresh(fresh)
    await flushPromises()
    giveNext(second)
    await more
    await flushPromises()

    const notes = month.month.value?.days.flatMap((day) =>
      day.entries.map((one) => (one.kind === 'manual' ? one.spending.note : null)),
    )
    expect(notes).toEqual(['Taxi', 'Rent', 'Cafe'])
  })

  it('keeps the categories of a month read before, for a month not read yet', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useActorStore().id = ACTOR
    moneyMonth.mockResolvedValue(page([], null))
    host(pinia)
    await flushPromises()
    moneyMonth.mockRejectedValue(new TypeError('network'))
    const other = host(pinia)
    await flushPromises()
    expect(other.knownCategories.value.map((one) => one.id)).toEqual([BEAUTY])
  })
})
