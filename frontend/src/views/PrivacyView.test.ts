import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { expect, it } from 'vitest'
import { FAILURE_KEEP_DAYS } from '@molvia/model'
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
    ru.privacy.failures.title,
    ru.privacy.backups.title,
    ru.privacy.barcodes.title,
    ru.privacy.storage.title,
    ru.privacy.copy.title,
    ru.privacy.erase.title,
  ])
})

it('says what goes to Open Food Facts and what never does, and offers its data under ODbL (MOL-162)', async () => {
  const text = (await render()).text()
  expect(text).toContain(ru.privacy.barcodes.text)
  expect(ru.privacy.barcodes.text).toMatch(/Open Food Facts/)
  expect(ru.privacy.barcodes.text).toMatch(/только сам код и адрес нашего сервера/)
  expect(ru.privacy.barcodes.text).toMatch(/Код этикетки магазина туда не уходит/)
  expect(ru.privacy.barcodes.text).toMatch(/ODbL.*по запросу/)
})

it("says what a failure of the app sends, and that it is nobody's (MOL-144)", async () => {
  const text = (await render()).text()
  expect(text).toContain(ru.privacy.failures.text)
  expect(ru.privacy.failures.text).toMatch(
    /вид ошибки, экран, где она случилась, версию приложения/,
  )
  expect(ru.privacy.failures.text).toMatch(/без текста, который вы ввели/)
  expect(ru.privacy.failures.text).toMatch(/Адрес телефона не записывается/)
  expect(ru.privacy.failures.text).toContain(`${String(FAILURE_KEEP_DAYS)} дней`)
})

it('names the copy by the words of the settings row that makes it (MOL-93)', async () => {
  const text = (await render()).text()
  expect(text).toContain(ru.privacy.copy.text)
  expect(ru.privacy.copy.text).toContain(`«${ru.settings.export.label}»`)
})

it('says who reads a message to the developer, what goes with it and for how long (MOL-147)', async () => {
  const text = (await render()).text()
  expect(text).toContain(ru.privacy.stored.feedback.text)
  // What the sheet attaches is named whole, and the Telegram copy that erasure cannot reach (В-3).
  expect(ru.privacy.stored.feedback.text).toMatch(/версия приложения, экран, система телефона/)
  expect(ru.privacy.stored.feedback.text).toMatch(/Читает только разработчик/)
  // The bot's half (MOL-148): a word written in Telegram, and the message a reply went out as.
  expect(ru.privacy.stored.feedback.text).toMatch(/ответом на его ответ в боте Molvia/)
  expect(ru.privacy.stored.feedback.text).toMatch(
    /номер сообщения, которым он пришёл вам в Telegram/,
  )
  expect(ru.privacy.stored.feedback.text).toMatch(/без вашего имени и номера аккаунта/)
  expect(ru.privacy.stored.feedback.text).toMatch(/остаётся в его чате/)
  expect(ru.privacy.stored.feedback.text).toMatch(/год от последнего сообщения/)
  expect(ru.privacy.stored.feedback.text).not.toMatch(/отзыв/i)
})

it('asks nothing of the server: no skeleton and no state, whatever the connection', async () => {
  const view = await render()
  expect(view.find('.skeleton').exists()).toBe(false)
  expect(view.find('[role="alert"]').exists()).toBe(false)
})

it('promises nothing it does not keep: no «никто не видит», no term longer than it is', async () => {
  const text = (await render()).text()
  // Thirty days is the failures' own term (MOL-144), held to the table's below; anywhere else it
  // would be the logs' promise MOL-58 refused — they live fourteen.
  expect(text.replace(ru.privacy.failures.text, '')).not.toMatch(/никто не видит|30 дней/i)
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
  // Both doors are named (MOL-94): the row in the settings and the bot's command.
  expect(ru.privacy.erase.text).toMatch(/«Удалить мои данные»/)
  expect(ru.privacy.erase.text).toMatch(/\/delete/)
  // After an erasure the other devices have no session to sign out of (MOL-94, review 1): the way
  // to clear their copies is the one the sheet names, and «выйдите» only beforehand.
  expect(ru.privacy.erase.text).toMatch(/удалите там приложение или очистите данные сайта/)
  expect(ru.privacy.erase.text).toMatch(/заранее выйдите там в настройках/)
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
