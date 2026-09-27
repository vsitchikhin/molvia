import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import TripRemoveSheet from '@/components/TripRemoveSheet.vue'

async function sheet(day: Date, items = 3) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  return mount(TripRemoveSheet, {
    props: { open: false, place: 'Рынок', day, items },
    global: { plugins: [router, createPinia(), createAppI18n('ru')] },
  })
}

describe('TripRemoveSheet (MOL-76)', () => {
  it('names the shop, the day and the rows', async () => {
    const view = await sheet(new Date(), 3)
    expect(view.text()).toContain('Рынок')
    expect(view.text()).toContain('3 позиции')
  })

  it('a trip of another year is named with its year, as the history row names it (review Р-2)', async () => {
    const view = await sheet(new Date(new Date().getFullYear() - 1, 8, 12, 12))
    expect(view.text()).toContain(String(new Date().getFullYear() - 1))
  })
})
