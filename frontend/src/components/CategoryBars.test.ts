import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMoney } from '@molvia/model'
import type { MoneyMonthView } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import CategoryBars from './CategoryBars.vue'

const CLOTHES = 'ffffffff-0000-4000-8000-000000000009'

function month(value: string): MoneyMonthView {
  return {
    month: value,
    spent: parseMoney('25000', 'AMD'),
    byCategory: [{ categoryId: CLOTHES, amount: parseMoney('25000', 'AMD') }],
    categories: [{ id: CLOTHES, preset: 'clothes', name: null, colour: null, archived: false }],
  } as MoneyMonthView
}

function bars(value: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  return mount(CategoryBars, {
    props: { month: month(value), nameOf: () => 'Одежда' },
    global: { plugins: [router, createAppI18n('ru')] },
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('CategoryBars → «Графики» (MOL-74)', () => {
  it('a category of one of the last six months opens the charts on it', () => {
    const href = bars('2026-04').find('a.row').attributes('href')
    expect(href).toBe(`/money/charts?category=${CLOTHES}`)
  })

  it('an older month opens them on twelve, where it is (adversarial А, d9 Г)', () => {
    const href = bars('2026-03').find('a.row').attributes('href')
    expect(href).toBe(`/money/charts?period=12&category=${CLOTHES}`)
  })

  it('leads to the charts and to the categories under the bars', () => {
    const links = bars('2026-09')
      .findAll('a.link')
      .map((link) => link.attributes('href'))
    expect(links).toEqual(['/money/charts', '/money/categories'])
  })
})
