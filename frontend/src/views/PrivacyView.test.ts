import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { expect, it } from 'vitest'
import { createAppI18n } from '@/i18n'
import ru from '@/i18n/ru.json'
import { routes } from '@/router'
import PrivacyView from './PrivacyView.vue'

async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/privacy')
  return mount(PrivacyView, { global: { plugins: [createPinia(), router, createAppI18n('ru')] } })
}

it('says what is kept, how long the logs live and how to erase everything', async () => {
  const view = await render()
  const text = view.text()

  expect(view.find('h1').text()).toBe(ru.privacy.title)
  for (const kind of Object.values(ru.privacy.stored)) {
    if (typeof kind === 'object') expect(text).toContain(kind.term)
  }
  expect(text).toContain('14 дней')
  expect(text).toContain('/delete')
  expect(view.findAll('h2').map((heading) => heading.text())).toEqual([
    ru.privacy.stored.title,
    ru.privacy.logs.title,
    ru.privacy.storage.title,
    ru.privacy.erase.title,
  ])
})

it('asks nothing of the server: no skeleton and no state, whatever the connection', async () => {
  const view = await render()
  expect(view.find('.skeleton').exists()).toBe(false)
  expect(view.find('[role="alert"]').exists()).toBe(false)
})

it('promises nothing it does not keep: no «никто не видит», no country of the server', async () => {
  const text = (await render()).text()
  expect(text).not.toMatch(/никто не видит|сервер находится|30 дней/i)
})
