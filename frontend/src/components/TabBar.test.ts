import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { AppLocale } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import TabBar from '@/components/TabBar.vue'
import { routes } from '@/router'

async function render(path: string, locale: AppLocale = 'en') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const view = mount(TabBar, { global: { plugins: [router, createAppI18n(locale)] } })
  return view
}

describe('TabBar', () => {
  it('is a labelled navigation region with the three sections in order', async () => {
    const view = await render('/')
    expect(view.get('nav').attributes('aria-label')).toBe(en.nav.label)
    expect(view.findAll('a').map((link) => link.text())).toEqual([
      en.nav.trip,
      en.nav.advice,
      en.nav.verdicts,
    ])
    expect(view.findAll('a').map((link) => link.attributes('href'))).toEqual([
      '/',
      '/advice',
      '/verdicts',
    ])
  })

  it('speaks Russian from the same dictionary', async () => {
    const view = await render('/', 'ru')
    expect(view.findAll('a').map((link) => link.text())).toEqual([
      ru.nav.trip,
      ru.nav.advice,
      ru.nav.verdicts,
    ])
  })

  it.each([
    ['/', 0],
    ['/advice', 1],
    ['/verdicts', 2],
  ])('on %s only the matching tab is the current page', async (path, index) => {
    const view = await render(path)
    const current = view.findAll('a').map((link) => link.attributes('aria-current'))
    expect(current).toEqual([0, 1, 2].map((i) => (i === index ? 'page' : undefined)))
  })

  // The trip tab must not claim the nested search as «the current page»: the search is a step
  // inside the trip, and the tab bar is not shown there anyway.
  it('marks no tab as current on a nested screen', async () => {
    const view = await render('/trip/add')
    expect(view.findAll('[aria-current]')).toHaveLength(0)
  })

  it('keeps the icons away from screen readers, which read the label', async () => {
    const view = await render('/')
    for (const icon of view.findAll('svg')) expect(icon.attributes('aria-hidden')).toBe('true')
  })
})
