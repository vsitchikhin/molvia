import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { tripViewCodec } from '@molvia/model'
import type { TripView } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import TripTotal from '@/components/TripTotal.vue'

interface Over {
  readonly total?: readonly { amount: string; currency: 'AMD' | 'RUB' | 'USD' | 'EUR' }[]
  readonly converted?: { amount: string; currency: 'RUB' } | null
  readonly rate?: string | null
}

function trip(over: Over = {}): TripView {
  return tripViewCodec.parse({
    id: 'bbbbbbbb-0000-4000-8000-000000000001',
    startedAt: '2026-09-19T08:00:00.000Z',
    finishedAt: null,
    currency: 'AMD',
    rate:
      over.rate === null
        ? null
        : {
            base: 'RUB',
            quote: 'AMD',
            rate: over.rate ?? '4.82',
            source: 'official',
            asOf: '2026-01-15T12:00:00.000Z',
          },
    rateProvider: over.rate === null ? null : 'cba',
    rateJump: null,
    rateStale: false,
    place: { id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'store', name: 'Ереван Сити' },
    expenses: [],
    total: over.total ?? [{ amount: '6493.12', currency: 'AMD' }],
    converted: over.converted === undefined ? { amount: '1347', currency: 'RUB' } : over.converted,
  })
}

/** Прочитанное с экрана: деньги печатаются с неразрывным пробелом, тесты — обычным. */
const plain = (found: { text: () => string }): string => found.text().replaceAll('\u00a0', ' ')

function render(props: Record<string, unknown> = {}) {
  return mount(TripTotal, {
    props: { trip: trip(), ...props },
    global: { plugins: [createAppI18n('ru')] },
  })
}

describe('TripTotal', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('сумма похода крупно, пересчёт рядом со знаком «≈» и датой курса', () => {
    const view = render()
    expect(plain(view)).toContain('6 493,12 ֏')
    expect(plain(view)).toContain('≈ 1 347 ₽')
    expect(plain(view)).toContain('курс 4,82 ֏/₽ · 15 янв.')
  })

  it('без курса пересчёта нет и переворачивать нечего', () => {
    const view = render({ trip: trip({ rate: null, converted: null }) })
    expect(view.text()).not.toContain('≈')
    expect(view.find('button').exists()).toBe(false)
  })

  it('тап переворачивает, «≈» остаётся на пересчёте, и выбор помнится', async () => {
    const view = render()
    await view.get('button').trigger('click')

    // Крупным стал рубль, но признак оценки с него не снялся.
    expect(plain(view.get('.sum'))).toBe('≈ 1 347 ₽')
    expect(plain(view.get('.rest'))).toContain('6 493,12 ֏')

    const again = render()
    expect(plain(again.get('.sum'))).toBe('≈ 1 347 ₽')
  })

  it('чужая валюта — строкой ниже, и пересчёт честно говорит, что покрывает не всё', () => {
    const view = render({
      trip: trip({
        total: [
          { amount: '6493.12', currency: 'AMD' },
          { amount: '1500', currency: 'RUB' },
        ],
      }),
    })

    expect(plain(view.get('.sum'))).toBe('6 493,12 ֏')
    expect(plain(view.get('.rest'))).toContain('1 500,00 ₽')
    expect(view.text()).toContain('пересчёт только по AMD')
  })

  it('пока очередь не пуста, у итога есть оговорка — иначе он тихо меньше корзины', () => {
    const view = render({ pending: 2 })
    expect(view.text()).toContain('+ 2 позиции ещё не ушли')
  })

  it('поход, который ещё не ушёл: итога нет и сказано почему', () => {
    const view = render({ trip: null, local: true })
    expect(view.get('.sum').text()).toBe('—')
    expect(view.text()).toContain(ru.trip.caveat.local)
  })

  it('нет ни одной цены — прочерк, а не ноль', () => {
    const view = render({ trip: trip({ total: [], converted: null }) })
    expect(view.get('.sum').text()).toBe('—')
  })
})
