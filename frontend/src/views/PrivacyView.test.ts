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
    ru.privacy.backups.title,
    ru.privacy.storage.title,
    ru.privacy.erase.title,
  ])
})

it('asks nothing of the server: no skeleton and no state, whatever the connection', async () => {
  const view = await render()
  expect(view.find('.skeleton').exists()).toBe(false)
  expect(view.find('[role="alert"]').exists()).toBe(false)
})

it('promises nothing it does not keep: no «никто не видит», no term longer than it is', async () => {
  const text = (await render()).text()
  expect(text).not.toMatch(/никто не видит|30 дней/i)
  // Selfreview 1: the shared mode shows other people's prices, so «shown to nobody» is said of
  // the list of purchases, and the prices are named with their threshold.
  expect(text).not.toMatch(/покупки никому не показываются/i)
  expect(text).toMatch(/хотя бы трое/)
  // Selfreview 5: an address can reach Caddy's error log, so the promise is about requests.
  expect(text).not.toMatch(/IP-адрес и то, что вы искали, в них не пишутся/)
})

it('names what stays after erasure in full — the items and the shops (adversarial О-5)', async () => {
  const text = (await render()).text()
  expect(ru.privacy.erase.text).toMatch(/магазин/)
  // Selfreview 7: «Магазины» is in the list above, so «everything in it goes» names the exception.
  expect(ru.privacy.erase.text).toMatch(/всё из списка выше, кроме магазинов/)
  expect(text).toContain(ru.privacy.stored.places.term)
  // Selfreview 3: copies on the phone are out of the server's reach, and the page says so.
  expect(ru.privacy.erase.text).toMatch(/телефоне/)
})

it('names the country and the copies, and what a restore would undo (MOL-70)', async () => {
  const text = (await render()).text()
  // «Персональные данные» 5.4: the country goes on the page once there is a machine.
  expect(text).toContain('Германии')
  // The copies are encrypted, in the EU, and live exactly as long as the bucket keeps them.
  expect(ru.privacy.backups.text).toMatch(/зашифрованном виде.*в ЕС/)
  expect(ru.privacy.backups.text).toContain('14 дней')
  // «Сразу и насовсем» is true of the database; the copies are named with their own term.
  expect(ru.privacy.erase.text).toMatch(/из резервных копий — в течение 14 дней/)
  // Owner's decision В-4: a restore can bring back an erasure of the last day, and the page says so.
  expect(ru.privacy.backups.text).toMatch(/меньше чем за сутки до сбоя/)
})
