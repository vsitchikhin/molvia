import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { expect, it } from 'vitest'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { routes } from '@/router'
import TermsView from './TermsView.vue'

async function render(language: 'ru' | 'en' = 'ru') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/terms')
  return mount(TermsView, {
    global: { plugins: [createPinia(), router, createAppI18n(language)] },
  })
}

it('reads every part of the terms, in order, under the revision of both pages (MOL-95)', async () => {
  const view = await render()
  expect(view.find('h1').text()).toBe(ru.terms.title)
  expect(view.text()).toContain('Редакция от 7 октября 2026')
  const parts = Object.entries(ru.terms).filter(([key]) => key !== 'title')
  expect(view.findAll('h2').map((heading) => heading.text())).toEqual(
    parts.map(([, part]) => (part as { title: string }).title),
  )
  for (const [, part] of parts) expect(view.text()).toContain((part as { text: string }).text)
})

it('says the age of 16, no ads and how to leave — what the consent screen points to', async () => {
  expect(ru.terms.who.text).toMatch(/16 лет или больше/)
  expect(en.terms.who.text).toMatch(/16 or older/)
  expect(ru.terms.ads.text).toMatch(/нет рекламы и платных мест/)
  expect(ru.terms.changes.text).toMatch(/\/delete/)
  expect(ru.terms.changes.text).toMatch(/спросит согласие заново/)
  const view = await render('en')
  expect(view.find('h1').text()).toBe(en.terms.title)
})
