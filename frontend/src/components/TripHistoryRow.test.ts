import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import TripHistoryRow from '@/components/TripHistoryRow.vue'
import type { HistoryRow } from '@/composables/useTripHistory'

const TRIP = 'bbbbbbbb-0000-4000-8000-000000000001'

function yesterdayAt(hours: number, minutes: number): Date {
  const at = new Date()
  at.setDate(at.getDate() - 1)
  at.setHours(hours, minutes, 0, 0)
  return at
}

function render(over: Partial<HistoryRow> = {}) {
  const row: HistoryRow = {
    id: TRIP,
    name: 'Ереван Сити',
    at: yesterdayAt(19, 40),
    pending: false,
    ...over,
  }
  return mount(TripHistoryRow, { props: { row }, global: { plugins: [createAppI18n('ru')] } })
}

describe('TripHistoryRow', () => {
  it('место и «Завершён · вчера, 19:40» — день словами, как везде в приложении', () => {
    const view = render()
    expect(view.text()).toContain('Ереван Сити')
    expect(view.text()).toContain('Завершён · вчера, 19:40')
  })

  it('поход, завершённый без сети, помечен', () => {
    expect(render().text()).not.toContain(ru.trip.history.local_finish)
    expect(render({ pending: true }).text()).toContain(ru.trip.history.local_finish)
  })

  it('это кнопка с шевроном, и тап называет свой поход', async () => {
    const view = render()
    expect(view.element.tagName).toBe('BUTTON')
    expect(view.find('.chevron').attributes('aria-hidden')).toBe('true')
    await view.trigger('click')
    expect(view.emitted('open')).toEqual([[TRIP]])
  })
})
