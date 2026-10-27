import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { parseMoney, POLICY_VERSION, tripViewCodec } from '@molvia/model'
import type { TripView } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import type { TripRowView } from '@/components/tripRow'
import { useTripReceipt } from '@/composables/useTripReceipt'
import type { TripReceipt } from '@/composables/useTripReceipt'
import { useTripQueueStore } from '@/stores/tripQueue'

vi.mock('@/api', () => ({
  api: { setTripReceipt: () => new Promise(() => undefined) },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const TRIP = 'bbbbbbbb-0000-4000-8000-000000000001'

function trip(receipt: string | null): TripView {
  return tripViewCodec.parse({
    id: TRIP,
    startedAt: '2026-09-19T08:00:00.000Z',
    finishedAt: null,
    currency: 'AMD',
    rate: null,
    rateProvider: null,
    rateJump: null,
    rateStale: false,
    place: { id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'store', name: 'Рынок' },
    expenses: [],
    total: receipt ? [{ amount: receipt, currency: 'AMD' }] : [],
    converted: null,
    receipt: receipt ? { amount: receipt, currency: 'AMD' } : null,
  })
}

const row = (key: string, amount: string | null, mark: TripRowView['mark'] = null) =>
  ({
    key,
    name: key,
    quantity: null,
    amount: amount ? parseMoney(amount, 'AMD') : null,
    unitPrice: null,
    mark,
    entry: null,
    expense: null,
  }) satisfies TripRowView

/** The composable in a component, as the screens call it: `useI18n` needs a setup. */
function harness(
  shown: TripView | null,
  rows: TripRowView[],
  known: () => boolean = () => true,
): TripReceipt {
  let got: TripReceipt | undefined
  mount(
    defineComponent({
      setup() {
        got = useTripReceipt(ref(TRIP), ref(shown), ref(rows), known)
        return () => null
      },
    }),
    { global: { plugins: [createAppI18n('ru')] } },
  )
  if (!got) throw new Error('no composable')
  return got
}

// «+ Сумма по чеку» / «Изменить» — одно правило для открытой записи и записанной (MOL-206, ревью 2,
// №4): полоса записанных и кнопка под карточкой записи расходились, пока снятие суммы ждало в очереди.
describe('useTripReceipt', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('molvia.actor', ME)
    localStorage.setItem(`molvia.consent.${ME}`, String(POLICY_VERSION))
    setActivePinia(createPinia())
  })

  it('с покупками и без суммы — «+ Сумма по чеку»; без покупок и без суммы — ничего (В-1)', () => {
    expect(harness(trip(null), [row('a', '500')]).receiptAction.value).toBe(ru.trip.receipt.add)
    expect(harness(trip(null), []).receiptAction.value).toBeNull()
  })

  it('сумма есть — «Изменить», даже когда покупок не осталось (адверсариальное А1)', () => {
    expect(harness(trip('5000'), []).receiptAction.value).toBe(ru.trip.receipt.edit)
  })

  it('снятие суммы в очереди — уже «+ Сумма по чеку»: сумма уходит', () => {
    const queue = useTripQueueStore()
    queue.enqueue({ kind: 'receipt', tripId: TRIP, body: { receipt: null } })
    expect(harness(trip('5000'), [row('a', '500')]).receiptAction.value).toBe(ru.trip.receipt.add)
  })

  it('запись из памяти телефона суммы не знает — ни «+», ни «Изменить» (ревью 4)', () => {
    expect(harness(trip('5000'), [row('a', '500')], () => false).receiptAction.value).toBeNull()
  })

  it('строки считаются без удаляемой — тот же счёт, что у «Закончить» (Р-5)', () => {
    const counted = harness(trip(null), [
      row('a', '500'),
      row('b', null, 'removing'),
      row('c', null),
    ])
    expect(counted.kept.value).toBe(2)
    expect(counted.unpriced.value).toBe(1)
  })
})
