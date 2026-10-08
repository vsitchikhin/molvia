import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import { FAILURE_KEEP_DAYS } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { routes } from '@/router'
import { PRIVACY_RECIPIENTS } from './policy'
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
    ru.privacy.operator.title,
    ru.privacy.stored.title,
    ru.privacy.bases.title,
    ru.privacy.statistics.title,
    ru.privacy.recipients.title,
    ru.privacy.logs.title,
    ru.privacy.failures.title,
    ru.privacy.backups.title,
    ru.privacy.barcodes.title,
    ru.privacy.serbian_receipts.title,
    ru.privacy.storage.title,
    ru.privacy.copy.title,
    ru.privacy.erase.title,
    ru.privacy.inactive.title,
    ru.privacy.rights.title,
    ru.privacy.complaints.title,
    ru.privacy.breach.title,
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

it('says what goes to the Serbian tax office with a receipt’s link, and what is never kept (MOL-232)', async () => {
  const text = (await render()).text()
  expect(text).toContain(ru.privacy.serbian_receipts.text)
  expect(ru.privacy.serbian_receipts.text).toMatch(/налоговая Сербии/)
  expect(ru.privacy.serbian_receipts.text).toMatch(/не вас, не ваш телефон и не ваш вход/)
  expect(ru.privacy.serbian_receipts.text).toMatch(
    /имя кассира, номер покупателя и способ оплаты не берём/,
  )
  expect(ru.privacy.serbian_receipts.text).toMatch(/ссылку стираем, как только налоговая ответила/)
  // the photo's line no longer says no outside service sees the receipt
  expect(ru.privacy.stored.receipts.text).not.toMatch(/сторонние сервисы чек не видят/)
})

it("says what a failure of the app sends, and that it is nobody's (MOL-144)", async () => {
  const text = (await render()).text()
  expect(text).toContain(ru.privacy.failures.text)
  expect(ru.privacy.failures.text).toMatch(
    /вид ошибки, экран, где она случилась, версию приложения/,
  )
  expect(ru.privacy.failures.text).toMatch(/без текста, который вы ввели/)
  // MOL-241 is named as it is until it is fixed (MOL-236, owner's decision В-3).
  expect(ru.privacy.failures.text).toMatch(/Адрес телефона в базу не записывается/)
  expect(ru.privacy.failures.text).toMatch(/держится в памяти сервера до его перезапуска/)
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
  // The API's metrics keep their own thirty (MOL-145, named by MOL-236, Р6-А1), in a sentence of their own.
  const metrics = /Видны из них последние 30 дней[^.]*\./
  expect(ru.privacy.logs.text).toMatch(metrics)
  expect(text.replace(ru.privacy.failures.text, '').replace(metrics, '')).not.toMatch(
    /никто не видит|30 дней/i,
  )
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

it('says the consent is kept — the edition and when — and nothing of the age (MOL-95)', async () => {
  const view = await render()
  expect(view.text()).toContain(ru.privacy.stored.consent.text)
  expect(ru.privacy.stored.consent.text).toMatch(/Возраст и дату рождения мы не храним/)
  // The subtitle is the revision written in code, not a sentence of the dictionary.
  expect(view.text()).toContain('Редакция 2 от 8 октября 2026')
})

describe('edition 2: the text of the consent art. 10 of Armenia’s law asks for (MOL-236)', () => {
  it('names who is responsible, by name and town, and how to reach him (В-1, В-6 of MOL-97)', async () => {
    const text = (await render()).text()
    expect(text).toContain(ru.privacy.operator.text)
    expect(ru.privacy.operator.text).toMatch(/Владимир Ситчихин — частное лицо, Гюмри, Армения/)
    expect(ru.privacy.operator.text).toContain(`«${ru.settings.feedback.label}»`)
    expect(en.privacy.operator.text).toMatch(/Vladimir Sitchikhin/)
  })

  it('says what rests on the contract and what on the consent, and what is done with the data', async () => {
    const text = (await render()).text()
    expect(text).toContain(ru.privacy.bases.text.split('\n')[0])
    expect(ru.privacy.bases.text).toMatch(/«Условия использования», и это наш договор/)
    expect(ru.privacy.bases.text).toMatch(/с вашего отдельного согласия: статистика/)
    // Art. 10 asks for the operations too.
    expect(ru.privacy.bases.text).toMatch(/получаем от вас, храним, показываем вам/)
  })

  it('names the consent to the statistics: what, how long, how to withdraw and what stays (В-7)', async () => {
    const view = await render()
    const statistics = view
      .findAll('section')
      .find((part) => part.text().startsWith(ru.privacy.statistics.title))
    expect(statistics?.findAll('p').map((paragraph) => paragraph.text())).toEqual(
      ru.privacy.statistics.text.split('\n'),
    )
    // Both counts are named: the visit marks and the ratings, withdrawn ones included (review №8).
    expect(ru.privacy.statistics.text).toMatch(/по отметкам о визитах/)
    expect(ru.privacy.statistics.text).toMatch(/сколько оценок ставят, считая снятые/)
    // The switch holds the consent, so the text is true of whoever turned it off before (Р-11).
    expect(ru.privacy.statistics.text).toContain(
      `пока в настройках включено «${ru.settings.analytics.label}»`,
    )
    expect(ru.privacy.statistics.text).not.toMatch(/нажимая/i)
    expect(ru.privacy.statistics.text).toMatch(/отметки о визитах удалятся сразу/)
    // Review 3–4 of MOL-97: the withdrawn row stays whole, for the reminder, and is no longer counted.
    expect(ru.privacy.statistics.text).toMatch(/с самой оценкой и моментом, когда вы её поставили/)
    expect(ru.privacy.statistics.text).toMatch(/бот не спрашивает/)
    expect(ru.privacy.statistics.text).toMatch(/в счёт уже не идёт/)
    // Its paragraphs stand apart on the page, not run together.
    expect(ru.privacy.statistics.text.split('\n')).toHaveLength(4)
    // The day counters with no one's id are named, and that the switch does not touch them
    // (adversarial Р2-А2, owner's 1-а): a press under a reminder is counted whatever the switch.
    expect(ru.privacy.statistics.text).toMatch(
      /без чьего-либо имени и номера — только числами по дням/,
    )
    expect(ru.privacy.statistics.text).toMatch(/сколько оценок дано в ответ на них/)
    // Every group `receipt_days` counts: read, how soon recorded, lines put right or left out (Р5-А1).
    expect(ru.privacy.statistics.text).toMatch(/как скоро после отправки их записали/)
    expect(ru.privacy.statistics.text).toMatch(/поправлено или оставлено незаписанными/)
    expect(en.privacy.statistics.text).toMatch(/how soon after sending they were recorded/)
    // And the reminders turned off, by each way `reminder_days` counts (Р4-А2, С-10).
    expect(ru.privacy.statistics.text).toMatch(/кнопкой, в настройках или заблокировав бота/)
    expect(en.privacy.statistics.text).toMatch(/by blocking the bot/)
    expect(ru.privacy.statistics.text).toMatch(/выключатель их не касается/)
    expect(ru.privacy.statistics.text).not.toMatch(/перестанут считаться\./)
  })

  it('lists every recipient, the Serbian tax office among them, and nobody else', async () => {
    const view = await render()
    const recipients = view
      .findAll('section')
      .find((part) => part.text().startsWith(ru.privacy.recipients.title))
    expect(recipients?.findAll('dt').map((term) => term.text())).toEqual(
      PRIVACY_RECIPIENTS.map((kind) => ru.privacy.recipients[kind].term),
    )
    expect(ru.privacy.recipients.serbian_tax.term).toBe('Налоговая Сербии')
    // A transfer abroad, with its basis (review С-3, owner's 2-а).
    expect(ru.privacy.recipients.telegram.text).toMatch(/зарубежная компания/)
    expect(ru.privacy.recipients.telegram.text).toMatch(/вход и бот Molvia работают через Telegram/)
    expect(ru.privacy.recipients.nobody.text).toMatch(/не продаём/)
  })

  it('names the rights with their term, the three authorities and what a breach brings', async () => {
    const text = (await render()).text()
    expect(text).toContain(ru.privacy.rights.text)
    expect(ru.privacy.rights.text).toMatch(/не позже чем через пять рабочих дней/)
    expect(ru.privacy.rights.text).toContain(`«${ru.settings.export.label}»`)
    expect(ru.privacy.rights.text).toContain(`«${ru.settings.erase.label}»`)
    expect(ru.privacy.rights.text).toContain(`«${ru.settings.analytics.label}»`)
    for (const site of ['pdpa.am', 'sao.ge', 'poverenik.rs']) {
      expect(ru.privacy.complaints.text).toContain(site)
      expect(en.privacy.complaints.text).toContain(site)
    }
    expect(ru.privacy.breach.text).toMatch(/вверху этой страницы/)
    expect(ru.privacy.breach.text).toMatch(/в полицию Армении/)
  })

  it('names the two years of silence and the bot’s warnings (В-2 of MOL-97)', async () => {
    const text = (await render()).text()
    expect(text).toContain(ru.privacy.inactive.text)
    expect(ru.privacy.inactive.text).toMatch(/два года/)
    expect(ru.privacy.inactive.text).toMatch(/За 30 и за 7 дней/)
  })

  it('names the API’s metrics beside the logs: per section, every 15 s, 30 days, no one (Р6-А1)', () => {
    expect(ru.privacy.logs.text).toMatch(
      /сервер хранит метрики: сколько запросов пришло к каждому разделу/,
    )
    expect(ru.privacy.logs.text).toMatch(/по 15 секунд, без имени, адреса и того, что вы искали/)
    expect(en.privacy.logs.text).toMatch(/every 15 seconds/)
    // Read for 30 days, on the disk until their month goes whole: VictoriaMetrics drops by month.
    expect(ru.privacy.logs.text).toMatch(
      /Видны из них последние 30 дней, а с диска они уходят помесячно — до двух месяцев/,
    )
  })

  it('names the shops’ memory among what stays, and the transfer to Germany', async () => {
    const text = (await render()).text()
    expect(ru.privacy.erase.text).toMatch(/память магазинов — какой товар стоит за строкой чека/)
    expect(ru.privacy.backups.text).toMatch(/Германия — в его списке стран с достаточной защитой/)
    // «No analytics» would be untrue beside the statistics: it is the third-party kind there is none of.
    expect(text).toContain(ru.privacy.summary)
    expect(ru.privacy.summary).toMatch(/сторонних трекеров и аналитики/)
  })

  it('says the same of what others see at the top of the page and on the step (Р2-А1)', () => {
    for (const words of [ru.privacy.summary, ru.consent.body]) {
      expect(words).toMatch(/видят все — (тоже )?без имени, но и без порога/)
      // The barcodes a person linked are seen by anyone who scans (MOL-100), here as in the list (Р3-А2).
      expect(words).toMatch(/Товары, магазины и штрихкоды/)
      expect(words).not.toMatch(/Другие видят только/)
    }
    expect(en.privacy.summary).toMatch(/with no threshold/)
    expect(en.consent.body).toMatch(/with no threshold/)
    // MOL-166: a shop's price is the lower median of its buyers' last, not the lowest.
    expect(ru.privacy.stored.purchases.text).not.toMatch(/самая низкая/)
  })

  it('names everything other people see, and that the shops’ memory has no access or threshold (А2)', () => {
    const people = ru.privacy.recipients.people.text
    expect(people).toMatch(/Без доступа и без порога трёх/)
    expect(people).toMatch(/товары, магазины и штрихкоды, которые вы добавили в общий справочник/)
    expect(people).toMatch(/даже если так сказали только вы/)
    expect(en.privacy.recipients.people.text).toMatch(/even if only you said it/)
  })

  it('promises the corrections there are, and names those there are not (А3)', () => {
    expect(ru.privacy.rights.text).not.toMatch(/любой записи/)
    expect(ru.privacy.rights.text).toMatch(/Товар покупки и магазин или день записи не правятся/)
    expect(en.privacy.rights.text).toMatch(/cannot be edited/)
  })

  it('says a Serbian receipt’s link may carry the buyer’s own number, not only a firm’s (А5)', () => {
    expect(ru.privacy.recipients.serbian_tax.text).toMatch(
      /номер покупателя, если он в чеке указан, — фирмы или ваш/,
    )
    expect(ru.privacy.serbian_receipts.text).toMatch(/его номер — фирмы или ваш/)
    expect(ru.privacy.serbian_receipts.text).not.toMatch(/выписан на фирму/)
  })

  // MOL-240: named as a defect by edition 2 (В-3) until fixed; a narrower processing is a revision
  it('says a recorded receipt goes with its record and a line with its purchase', () => {
    const text = ru.privacy.stored.receipts.text
    expect(text).toMatch(/удалите запись — через 10 минут уйдёт и чек со всеми строками/)
    expect(text).toMatch(/Удалите одну покупку — сразу уйдёт её строка/)
    expect(text).toMatch(/Строки, которые вы не стали записывать, удаляются при записи/)
    expect(text).not.toMatch(/пока есть аккаунт|исправляем/)
  })

  it('draws no notice of a breach while the dictionary has none', async () => {
    const view = await render()
    expect(view.find('.notice').exists()).toBe(false)
  })

  it('draws the notice of a breach above the summary once the dictionary has one', async () => {
    const i18n = createAppI18n('ru')
    i18n.global.mergeLocaleMessage('ru', {
      privacy: { notice: { title: 'Утечка 1 января', text: 'Что случилось и что делать.' } },
    })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/privacy')
    const view = mount(PrivacyView, { global: { plugins: [createPinia(), router, i18n] } })

    const notice = view.find('.notice')
    expect(notice.text()).toContain('Утечка 1 января')
    expect(notice.text()).toContain('Что случилось и что делать.')
    expect(view.html().indexOf('class="notice"')).toBeLessThan(
      view.html().indexOf('class="summary"'),
    )
  })
})
