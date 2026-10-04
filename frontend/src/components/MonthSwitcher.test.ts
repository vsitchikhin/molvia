import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createAppI18n } from '@/i18n'
import MonthSwitcher from './MonthSwitcher.vue'

function switcher(props: Record<string, unknown>) {
  return mount(MonthSwitcher, {
    props: { month: '2026-09', current: '2026-09', ...props },
    global: { plugins: [createAppI18n('ru')] },
  })
}

describe('MonthSwitcher', () => {
  it('goes back a month with no lower bound, and not past the current one', async () => {
    const view = switcher({ month: '2026-01', current: '2026-03' })
    expect(view.find('.month').text()).toBe('Январь 2026')
    const [back, forward] = view.findAll('button')
    await back?.trigger('click')
    await forward?.trigger('click')
    expect(view.emitted('change')).toEqual([['2025-12'], ['2026-02']])
  })

  it('in years, steps by a year between the first with data and this one (MOL-160)', async () => {
    const view = switcher({ unit: 'year', month: '2026', current: '2026', first: '2025' })
    expect(view.find('.month').text()).toBe('2026')
    const [back, forward] = view.findAll('button')
    expect(back?.attributes('aria-label')).toBe('Предыдущий год')
    await back?.trigger('click')
    await forward?.trigger('click')
    expect(view.emitted('change')).toEqual([['2025']])
  })

  // The arrow at the edge is the kit's inactive button: still in the focus order, and its tap goes
  // nowhere (Ф-6, MOL-174) — never a native `disabled`, which would drop the focus resting on it.
  it('keeps the arrow at the current month focusable, and its tap goes nowhere', async () => {
    const view = switcher({ month: '2026-09', current: '2026-09' })
    const [back, forward] = view.findAll('button')
    expect(forward?.attributes('aria-disabled')).toBe('true')
    expect(forward?.attributes('disabled')).toBeUndefined()
    expect(back?.attributes('aria-disabled')).toBeUndefined()
    await forward?.trigger('click')
    expect(view.emitted('change')).toBeUndefined()
  })

  it('in years, goes no further back than the first year with anything in it (Р-9)', async () => {
    const view = switcher({ unit: 'year', month: '2025', current: '2026', first: '2025' })
    const [back, forward] = view.findAll('button')
    await back?.trigger('click')
    await forward?.trigger('click')
    expect(view.emitted('change')).toEqual([['2026']])
  })
})
