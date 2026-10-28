import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import type { Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { donutSlices, parseMoney } from '@molvia/model'
import type { JournalKey, MoneyMonthView } from '@molvia/model'
import { useMoneyMonth } from '@/composables/useMoneyMonth'
import type { MoneyMonth } from '@/composables/useMoneyMonth'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

const moneyMonth = vi.fn<(month: string, cursor?: JournalKey) => Promise<MoneyMonthView>>()
vi.mock('@/api', () => ({
  api: { moneyMonth: (month: string, cursor?: JournalKey) => moneyMonth(month, cursor) },
}))

// A screen left mounted would hear the next test's `online` too.
enableAutoUnmount(afterEach)

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const BEAUTY = 'ffffffff-0000-4000-8000-000000000001'
const TAXI = 'ffffffff-0000-4000-8000-000000000002'
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
      transferId: null,
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
    count: 0,
    incomeCount: 0,
    shiftedIn: [],
    shiftedOut: [],
    rest: null,
    accountsFrom: null,
    accountsRemoved: false,
    budget: null,
    rate: null,
    rateKind: 'live',
    previousSpent: null,
    previousToDay: null,
    byCategory: [],
    slices: [],
    categories: [
      { id: BEAUTY, preset: 'beauty', name: null, colour: null, icon: null, archived: false },
    ],
    days: days.map(([day, entries]) => ({
      day,
      total: amd('1000'),
      estimated: false,
      uncounted: [],
      entries,
    })),
    cursor,
    remaining: cursor ? 1 : 0,
    remainingFrom: null,
    frequent: [],
    remainingTo: null,
  } satisfies MoneyMonthView
}

/** Mounts a component that uses the composable, and hands back what it returned. */
function host(
  pinia: ReturnType<typeof createPinia>,
  month: string | Ref<string> = '2026-09',
): MoneyMonth {
  const holder: { month?: MoneyMonth } = {}
  const Host = defineComponent({
    setup() {
      holder.month = useMoneyMonth(typeof month === 'string' ? ref(month) : month)
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
    sessionStorage.clear()
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

  // A move before the running month answered: its answer lands for a month no longer on screen, and
  // the month now shown fails — the categories are the owner's, so «Добавить трату» still has some
  // (MOL-183, e2e «a summary that did not load»), and its sheet today's rate (MOL-262, А1).
  it('takes the categories and today’s rate from an answer of the month just left, landed after the move', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useActorStore().id = ACTOR
    let give: (value: MoneyMonthView) => void = () => undefined
    let fail: (reason: unknown) => void = () => undefined
    moneyMonth
      .mockImplementationOnce(() => new Promise((resolve) => (give = resolve)))
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    const selected = ref('2026-09')
    const month = host(pinia, selected)
    await flushPromises()
    selected.value = '2026-08'
    await flushPromises()
    // Nothing kept on this phone: the month on screen has no categories of its own yet.
    expect(month.knownCategories.value).toEqual([])
    expect(month.todayRate.value).toBeNull()
    const rate = {
      base: 'RUB' as const,
      quote: 'AMD' as const,
      scaled: 4_160_000n,
      source: 'personal' as const,
      asOf: new Date('2026-09-27T00:00:00Z'),
    }
    give({ ...page([], null), rate })
    await flushPromises()
    fail(new TypeError('500'))
    await flushPromises()
    expect(month.phase.value).toBe('error')
    expect(month.knownCategories.value.map((one) => one.id)).toEqual([BEAUTY])
    expect(month.todayRate.value?.scaled).toBe(4_160_000n)
  })

  it('a month kept before the ring reads offline, its categories whole and no ring (MOL-156, review 9)', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useActorStore().id = ACTOR
    const byCategory = [{ categoryId: BEAUTY, amount: amd('3000') }]
    moneyMonth.mockResolvedValue({ ...page([], null), byCategory, slices: donutSlices(byCategory) })
    host(pinia)
    await flushPromises()
    // As the version before the ring kept it: the answer with no `slices` at all.
    const key = `molvia.money.${ACTOR}`
    const kept = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<
      string,
      { answer: Record<string, unknown> }
    >
    delete kept['2026-09']?.answer.slices
    localStorage.setItem(key, JSON.stringify(kept))

    moneyMonth.mockRejectedValue(new TypeError('network'))
    const offline = host(pinia)
    await flushPromises()
    // The phone adds nothing up (CLAUDE.md): the ring waits for the next read, and the card says so.
    expect(offline.month.value?.slices).toEqual([])
    expect(offline.month.value?.byCategory).toEqual(byCategory)
  })

  it('Б6: a month recalled after a restart is as of when its read set out, not when it came', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
    try {
      const pinia = createPinia()
      setActivePinia(pinia)
      useActorStore().id = ACTOR
      let give: (value: MoneyMonthView) => void = () => undefined
      moneyMonth.mockImplementationOnce(() => new Promise((resolve) => (give = resolve)))
      host(pinia)
      // The read set out at 08:00; a removal answered meanwhile; the answer came at 08:00:05.
      vi.setSystemTime(new Date('2026-09-27T08:00:05Z'))
      give(page([], null))
      await flushPromises()

      // A restart with no connection: the month is the phone's.
      const restarted = createPinia()
      setActivePinia(restarted)
      useActorStore().id = ACTOR
      moneyMonth.mockRejectedValue(new TypeError('network'))
      const offline = host(restarted)
      await flushPromises()
      expect(offline.fetchedAt.value).toEqual(new Date('2026-09-27T08:00:05Z'))
      expect(offline.askedAt.value).toEqual(new Date('2026-09-27T08:00:00Z'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('С-5: another month on screen still knows today’s rate, from the running month kept', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
    try {
      const pinia = createPinia()
      setActivePinia(pinia)
      useActorStore().id = ACTOR
      const rate = {
        base: 'RUB' as const,
        quote: 'AMD' as const,
        scaled: 4_620_000n,
        source: 'personal' as const,
        asOf: new Date('2026-09-27T00:00:00Z'),
      }
      moneyMonth.mockResolvedValueOnce({ ...page([], null), rate })
      host(pinia)
      await flushPromises()
      moneyMonth.mockResolvedValueOnce({ ...page([], null), month: '2026-08', rateKind: 'frozen' })
      const august = host(pinia, '2026-08')
      await flushPromises()
      expect(august.todayRate.value?.scaled).toBe(4_620_000n)
    } finally {
      vi.useRealTimers()
    }
  })

  // Kept are three months, and older ones read after it pushed this month out: four months back, the
  // sheet lost today's rate — on a reload too, which a screen mounted anew is (MOL-262, adversarial А3).
  it('А3: this month stays kept however far back the months were read, and with it today’s rate', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
    try {
      const pinia = createPinia()
      setActivePinia(pinia)
      useActorStore().id = ACTOR
      const rate = {
        base: 'RUB' as const,
        quote: 'AMD' as const,
        scaled: 4_620_000n,
        source: 'personal' as const,
        asOf: new Date('2026-09-27T00:00:00Z'),
      }
      moneyMonth.mockResolvedValueOnce({ ...page([], null), rate })
      host(pinia)
      await flushPromises()
      for (const [minute, month] of ['2026-08', '2026-07', '2026-06', '2026-05'].entries()) {
        vi.setSystemTime(new Date(Date.UTC(2026, 8, 27, 8, minute + 1)))
        moneyMonth.mockResolvedValueOnce({ ...page([], null), month, rateKind: 'frozen' })
        host(pinia, month)
        await flushPromises()
      }
      moneyMonth.mockRejectedValueOnce(new TypeError('network'))
      const april = host(pinia, '2026-04')
      await flushPromises()
      expect(april.todayRate.value?.scaled).toBe(4_620_000n)
    } finally {
      vi.useRealTimers()
    }
  })

  // An exchange is written on its own screen and tells «Деньги» nothing: opened on another month, the
  // screen reads the running one after its own, or the sheet kept the rate from before it (MOL-262,
  // adversarial А5).
  it('А5: opened on another month, the screen reads the running one too, for today’s rate', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
    try {
      const pinia = createPinia()
      setActivePinia(pinia)
      useActorStore().id = ACTOR
      const rate = (scaled: bigint) => ({
        base: 'RUB' as const,
        quote: 'AMD' as const,
        scaled,
        source: 'personal' as const,
        asOf: new Date('2026-09-27T00:00:00Z'),
      })
      moneyMonth.mockResolvedValueOnce({ ...page([], null), rate: rate(4_620_000n) })
      host(pinia)
      await flushPromises()
      // An exchange since: the server's rate today is another.
      moneyMonth
        .mockResolvedValueOnce({ ...page([], null), month: '2026-08', rateKind: 'frozen' })
        .mockResolvedValueOnce({ ...page([], null), rate: rate(4_480_000n) })
      const august = host(pinia, '2026-08')
      await flushPromises()
      expect(moneyMonth.mock.calls.map(([month]) => month)).toEqual([
        '2026-09',
        '2026-08',
        '2026-09',
      ])
      expect(august.month.value?.month).toBe('2026-08')
      expect(august.todayRate.value?.scaled).toBe(4_480_000n)
    } finally {
      vi.useRealTimers()
    }
  })

  // That read goes beside the screen's own, and a screen left still hears its answer: one from before
  // an exchange, landed after a later one, put the old rate back on the phone (MOL-262, adversarial А6).
  it('А6: an answer of the running month landed after one that set out later is not kept over it', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
    try {
      const pinia = createPinia()
      setActivePinia(pinia)
      useActorStore().id = ACTOR
      const rate = (scaled: bigint) => ({
        base: 'RUB' as const,
        quote: 'AMD' as const,
        scaled,
        source: 'personal' as const,
        asOf: new Date('2026-09-27T00:00:00Z'),
      })
      const august = { ...page([], null), month: '2026-08', rateKind: 'frozen' as const }
      let give: (value: MoneyMonthView) => void = () => undefined
      moneyMonth
        .mockResolvedValueOnce(august)
        .mockImplementationOnce(() => new Promise((resolve) => (give = resolve)))
      host(pinia, '2026-08')
      await flushPromises()
      // An exchange, then «Деньги» opened anew: its read of this month sets out later and lands first.
      vi.setSystemTime(new Date('2026-09-27T08:01:00Z'))
      moneyMonth
        .mockResolvedValueOnce(august)
        .mockResolvedValueOnce({ ...page([], null), rate: rate(5_000_000n) })
      host(pinia, '2026-08')
      await flushPromises()
      give({ ...page([], null), rate: rate(4_160_000n) })
      await flushPromises()
      moneyMonth.mockRejectedValue(new TypeError('network'))
      const july = host(pinia, '2026-07')
      await flushPromises()
      expect(july.todayRate.value?.scaled).toBe(5_000_000n)
    } finally {
      vi.useRealTimers()
    }
  })

  // A screen left while its own month was on its way reads the running one after it, later than the
  // screen opened anew: that screen's answer is refused, and it must not keep the rate it read at
  // the opening, from before the exchange (MOL-262, adversarial А7).
  it('А7: a screen whose answer the phone refused takes today’s rate from the phone', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
    try {
      const pinia = createPinia()
      setActivePinia(pinia)
      useActorStore().id = ACTOR
      const rate = (scaled: bigint) => ({
        base: 'RUB' as const,
        quote: 'AMD' as const,
        scaled,
        source: 'personal' as const,
        asOf: new Date('2026-09-27T00:00:00Z'),
      })
      const august = { ...page([], null), month: '2026-08', rateKind: 'frozen' as const }
      moneyMonth.mockResolvedValueOnce({ ...page([], null), rate: rate(4_160_000n) })
      host(pinia)
      await flushPromises()
      // S1 opened on August, its month slow; an exchange; S2 opened anew, its running month slow too.
      let giveLeft: (value: MoneyMonthView) => void = () => undefined
      let giveOpened: (value: MoneyMonthView) => void = () => undefined
      vi.setSystemTime(new Date('2026-09-27T08:01:00Z'))
      moneyMonth.mockImplementationOnce(() => new Promise((resolve) => (giveLeft = resolve)))
      host(pinia, '2026-08')
      await flushPromises()
      vi.setSystemTime(new Date('2026-09-27T08:02:00Z'))
      moneyMonth
        .mockResolvedValueOnce(august)
        .mockImplementationOnce(() => new Promise((resolve) => (giveOpened = resolve)))
      const opened = host(pinia, '2026-08')
      await flushPromises()
      expect(opened.todayRate.value?.scaled).toBe(4_160_000n)
      // S1's month lands; its read of the running month sets out after S2's and is kept.
      vi.setSystemTime(new Date('2026-09-27T08:03:00Z'))
      moneyMonth.mockResolvedValueOnce({ ...page([], null), rate: rate(5_000_000n) })
      giveLeft(august)
      await flushPromises()
      // Refused: the phone's answer set out later, and it is the one the screen goes by.
      giveOpened({ ...page([], null), rate: rate(4_900_000n) })
      await flushPromises()
      expect(opened.todayRate.value?.scaled).toBe(5_000_000n)
    } finally {
      vi.useRealTimers()
    }
  })

  // What a refusal takes from the phone is the owner's categories too: a screen with no answer of its
  // own goes by them for «Добавить трату» (MOL-262, adversarial А8).
  it('А7: a screen with no answer whose read the phone refused takes the categories from the phone', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
    try {
      const pinia = createPinia()
      setActivePinia(pinia)
      useActorStore().id = ACTOR
      moneyMonth.mockResolvedValueOnce(page([], null))
      host(pinia)
      await flushPromises()
      // August fails, and its read of the running month is slow.
      let give: (value: MoneyMonthView) => void = () => undefined
      vi.setSystemTime(new Date('2026-09-27T08:01:00Z'))
      moneyMonth
        .mockRejectedValueOnce(new TypeError('500'))
        .mockImplementationOnce(() => new Promise((resolve) => (give = resolve)))
      const august = host(pinia, '2026-08')
      await flushPromises()
      // Meanwhile another screen reads the running month later, with a category made since.
      vi.setSystemTime(new Date('2026-09-27T08:02:00Z'))
      const categories = [
        ...page([], null).categories,
        {
          id: TAXI,
          preset: 'transport' as const,
          name: null,
          colour: null,
          icon: null,
          archived: false,
        },
      ]
      moneyMonth.mockResolvedValueOnce({ ...page([], null), categories })
      host(pinia)
      await flushPromises()
      give(page([], null))
      await flushPromises()
      expect(august.phase.value).toBe('error')
      expect(august.knownCategories.value.map((one) => one.id)).toEqual([BEAUTY, TAXI])
    } finally {
      vi.useRealTimers()
    }
  })

  // Another build may keep a month this one cannot read: it is no later answer, and the first one
  // landed is kept over it (MOL-262, self-review 12).
  it('А6: a month the phone cannot read back refuses no answer', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
    try {
      const pinia = createPinia()
      setActivePinia(pinia)
      useActorStore().id = ACTOR
      const rate = {
        base: 'RUB' as const,
        quote: 'AMD' as const,
        scaled: 5_000_000n,
        source: 'personal' as const,
        asOf: new Date('2026-09-27T00:00:00Z'),
      }
      let give: (value: MoneyMonthView) => void = () => undefined
      moneyMonth.mockImplementationOnce(() => new Promise((resolve) => (give = resolve)))
      host(pinia)
      await flushPromises()
      vi.setSystemTime(new Date('2026-09-27T08:02:00Z'))
      localStorage.setItem(
        `molvia.money.${ACTOR}`,
        JSON.stringify({
          '2026-09': {
            answer: { month: '2026-09', shape: 'another build' },
            fetchedAt: '2026-09-27T08:01:00.000Z',
            askedAt: '2026-09-27T08:01:00.000Z',
          },
        }),
      )
      give({ ...page([], null), rate })
      await flushPromises()
      moneyMonth.mockRejectedValue(new TypeError('network'))
      const august = host(pinia, '2026-08')
      await flushPromises()
      expect(august.todayRate.value?.scaled).toBe(5_000_000n)
    } finally {
      vi.useRealTimers()
    }
  })

  it('А6: a month kept from a clock that ran ahead is read over, not held for good', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-30T08:00:00Z'))
    try {
      const pinia = createPinia()
      setActivePinia(pinia)
      useActorStore().id = ACTOR
      moneyMonth.mockResolvedValueOnce({ ...page([], null), count: 1 })
      host(pinia)
      await flushPromises()
      // The clock put right, three days back: the month read now is the later read.
      vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
      moneyMonth.mockResolvedValueOnce({ ...page([], null), count: 2 })
      host(pinia)
      await flushPromises()
      moneyMonth.mockRejectedValue(new TypeError('network'))
      const offline = host(pinia)
      await flushPromises()
      expect(offline.month.value?.count).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  // After «Показать ещё» on another month the screen keeps two pages open; the running month's read
  // keeps its first alone, so it asks for no more (MOL-262, self-review 9).
  it('the running month is read for today’s rate one page only, whatever pages the screen keeps', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
    try {
      const pinia = createPinia()
      setActivePinia(pinia)
      useActorStore().id = ACTOR
      const cursor: JournalKey = {
        day: '2026-08-20',
        moment: 1,
        id: 'eeeeeeee-0000-4000-8000-00000000000a',
      }
      moneyMonth.mockImplementation((month, after) =>
        Promise.resolve({ ...page([], after ? null : cursor), month }),
      )
      const august = host(pinia, '2026-08')
      await flushPromises()
      await august.loadMore()
      moneyMonth.mockClear()
      window.dispatchEvent(new Event('online'))
      await flushPromises()
      expect(moneyMonth.mock.calls.map(([month, after]) => [month, Boolean(after)])).toEqual([
        ['2026-08', false],
        ['2026-08', true],
        ['2026-09', false],
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})
