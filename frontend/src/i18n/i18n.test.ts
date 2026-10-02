import { describe, expect, it, vi } from 'vitest'
import { ERROR, ISSUE } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { pluralRu } from '@/i18n/plural-ru'

/** The real thing rather than the rule alone: the bug this guards against is vue-i18n's own. */
function russian() {
  return createAppI18n('ru').global
}

/** `{ a: { b: 'x' } }` → `{ 'a.b': 'x' }`, so a key can be addressed the way `t()` addresses it. */
function flatten(messages: object, prefix = ''): Record<string, string> {
  return Object.entries(messages).reduce<Record<string, string>>((flat, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null) return { ...flat, ...flatten(value, path) }
    return { ...flat, [path]: String(value) }
  }, {})
}

const RU = flatten(ru)
const EN = flatten(en)

/**
 * `{n}`, `{place}`, `{version}` — what a message expects to be handed at render time.
 *
 * Unique names rather than every occurrence: a pluralised key carries `{n}` once per form,
 * and Russian has three forms where English has two. Counting occurrences would compare the
 * number of plural forms — which is meant to differ — instead of a lost placeholder.
 */
function placeholders(message: string): string[] {
  const names = [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '')
  return [...new Set(names)].sort()
}

describe('словарь: два языка', () => {
  it('зеркальны ключ в ключ', () => {
    // Русский первичен, английский вторым — но пропуск ловится здесь, а не на экране:
    // компонентные тесты монтируются с `en`, и дыра в нём видна не сразу.
    expect(Object.keys(RU).sort()).toEqual(Object.keys(EN).sort())
  })

  it('ни одного пустого значения', () => {
    // Пустая строка — это пропущенный перевод, а не текст. Заглушка запрещена здесь,
    // поэтому ключа, для которого текста ещё нет, в словаре не заводится вовсе.
    for (const [key, value] of [...Object.entries(RU), ...Object.entries(EN)]) {
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('ни одной заглушки вместо текста', () => {
    // Единственной проверкой содержания была непустота: словарь, где все десять текстов
    // ошибок заменены на «TODO», проходил и её, и зеркальность, и перебор реестра.
    for (const [key, value] of [...Object.entries(RU), ...Object.entries(EN)]) {
      expect(value.trim(), key).not.toMatch(/^(TODO|FIXME|XXX|TBD|\?+|-+)$/i)
    }
  })

  it('у одного ключа одинаковый набор подстановок в обоих языках', () => {
    // Перевод, потерявший {version}, молчит: vue-i18n отдаст строку без числа, и это
    // заметят на экране, а не в сборке.
    for (const key of Object.keys(RU)) {
      expect(placeholders(EN[key] ?? ''), key).toEqual(placeholders(RU[key] ?? ''))
    }
  })

  it('ни одного плоского ключа с точкой в имени', () => {
    // `{"trip.title": "…"}` рядом с `{"trip": {"title": "…"}}` схлопывается тестом в один
    // путь, а vue-i18n берёт вложенный: плоский не доезжает до экрана никогда. Словарь
    // правится руками, и это ровно тот способ, которым такой ключ появляется.
    const flatKeys = (messages: object): string[] =>
      Object.entries(messages).flatMap(([key, value]) =>
        key.includes('.')
          ? [key]
          : typeof value === 'object' && value !== null
            ? flatKeys(value)
            : [],
      )

    expect(flatKeys(ru)).toEqual([])
    expect(flatKeys(en)).toEqual([])
  })
})

describe('словарь: повторяющиеся тексты', () => {
  const duplicates = (messages: Record<string, string>): Record<string, string[]> => {
    const byValue = new Map<string, string[]>()
    for (const [key, value] of Object.entries(messages)) {
      byValue.set(value, [...(byValue.get(value) ?? []), key])
    }
    return Object.fromEntries(
      [...byValue.entries()]
        .filter(([, keys]) => keys.length > 1)
        .map(([value, keys]) => [value, keys.sort()]),
    )
  }

  it('в русском повторяется только то, что решено', () => {
    // Пер-экранные состояния (Р-2) стоят трёх копий «Сервер не ответил»: правка в одной
    // разойдётся с двумя другими молча. Сводить их в общий ключ нельзя — это отменит само
    // решение, за которое заплачено. Поэтому цена закреплена снимком: новый незаявленный
    // дубль уронит тест, а заявленные видно списком.
    expect(duplicates(RU)).toEqual({
      // Один глагол у двух шторок: закончить с балансом счёта и с цифрами штрихкода (MOL-98).
      Готово: ['accounts.done', 'scanner.done'],
      // Подпись таба и заголовок экрана — разные роли одного слова, живут отдельно осознанно; у
      // «Покупок» — ещё шеврон записанных покупок и строка приватности о том же (MOL-128).
      Покупки: [
        'nav.purchases',
        'privacy.stored.purchases.term',
        'purchases.title',
        'trip.history.title',
      ],
      'Что брать': ['advice.title', 'nav.advice'],
      Оценки: ['nav.verdicts', 'verdict.title'],
      Настройки: ['nav.settings', 'settings.title'],
      // Таб и его экран — разные роли одного слова, как у «Покупки».
      Деньги: ['nav.money', 'settings.group_money', 'spending.title'],
      // Заголовок экрана и ссылка на него с карточки «Куда ушли» (MOL-156).
      Графики: ['spending.charts.title', 'spending.summary.charts'],
      // The settings handoff names its own save action, independently of purchase editing.
      Сохранить: [
        'accounts.sheet.save',
        'budget.sheet.save',
        'item.save_edit',
        'settings.save',
        'trip.receipt.sheet.save',
      ],
      // Цена Р-2: одно состояние, написанное для трёх экранов.
      'Сервер не ответил': ['advice.error.title', 'item.error.title', 'trip.error.title'],
      // Та же цена у офлайна: у настроек, у обменов, у доходов и у устройств своё состояние
      // (MOL-40, MOL-57, MOL-66).
      'Нет связи': [
        'devices.offline.title',
        'exchange.offline.title',
        'income.offline.title',
        'settings.offline.title',
        'spending.categories.offline.title',
        'spending.offline.title',
      ],
      // Кнопка в шапке записи и главное действие её шторки — один глагол (MOL-128).
      Закончить: ['trip.finish', 'trip.finish_confirm.ok'],
      // Одно правило часов у обмена и у дохода, два кода — у каждого своя шторка (MOL-66).
      'Этот день ещё не наступил': [
        'error.exchange_in_future',
        'error.income_in_future',
        'error.money_account_in_future',
        'error.spending_in_future',
      ],
      // Цена Р-2 у двух экранов одной денежной модели: доходы пишутся, правятся, удаляются и
      // возвращаются по правилам обменов (MOL-66, Р-2), и слова о тех же действиях — те же.
      'исправлен {date}': ['exchange.amended', 'income.amended'],
      Вернуть: [
        'accounts.screen.restore',
        'exchange.restore',
        'income.restore',
        'spending.restore',
        'trip.remove.restore',
      ],
      'Сервер не ответил как надо. Попробуйте ещё раз': [
        'exchange.load_error.body',
        'income.load_error.body',
      ],
      'Не получилось. Проверьте связь и попробуйте ещё раз': ['exchange.failed', 'income.failed'],
      Валюта: ['accounts.sheet.currency', 'exchange.sheet.currency', 'income.sheet.currency'],
      'Прежние версии': ['exchange.sheet.history', 'income.sheet.history'],
      'Сохранить правку': ['exchange.sheet.save_amend', 'income.sheet.save_amend'],
      'Сейчас записано: {details}': ['exchange.sheet.current', 'income.sheet.current'],
      // «Деньги» (MOL-82): одно действие над отказом очереди — как у покупки похода; экран и
      // строка, которая к нему ведёт; «Прочее» и «Сумма» — одни слова у дохода и у траты.
      Убрать: ['spending.categories.remove', 'spending.sheet.dismiss', 'trip.rejected.drop'],
      Категории: ['spending.categories.title', 'spending.categories_link'],
      Прочее: ['income.source.other', 'spending.category.other'],
      // И сегмент плана «Бюджета» — сумма против доли пришедшего (MOL-117).
      Сумма: [
        'budget.sheet.kind_amount',
        'income.sheet.amount',
        'spending.sheet.amount',
        'trip.receipt.sheet.label',
      ],
      // Название экрана и пункт страницы приватности о том же (MOL-58, MOL-66).
      Доходы: ['income.title', 'privacy.stored.incomes.term'],
      // Плавающая кнопка и заголовок её шторки, как «Трата» (MOL-81); подписи сумм карточки и
      // полей шторки — одни слова об одном обмене.
      Обмен: ['accounts.account.exchange', 'exchange.fab', 'exchange.sheet.title'],
      Доход: ['income.fab', 'income.sheet.title'],
      Отдал: ['exchange.card_given', 'exchange.sheet.given'],
      Получил: ['exchange.card_received', 'exchange.sheet.received'],
      // Имя источника на карточке обмена и в строке похода. По-английски у похода «the Bank of
      // Russia» с артиклем, карточке нужно без него — в начале строки и после «the» (MOL-81, Е).
      'ЦБ РА': ['exchange.card_source_cba', 'trip.rate.source_cba'],
      'ЦБ РФ': ['exchange.card_source_cbr', 'trip.rate.source_cbr'],
      'open.er-api.com': ['exchange.card_source_erapi', 'trip.rate.source_erapi'],
      // Счета (MOL-123): экран и пункт страницы приватности о том же; плавающая «Счёт», заголовок
      // её шторки в правке и строка выбора счёта в шторках операций.
      Счета: ['accounts.title', 'privacy.stored.accounts.term'],
      Счёт: ['accounts.picker.row_spending', 'accounts.screen.add', 'accounts.sheet.title_edit'],
      // Период графика курса (MOL-168): подпись сегмента и та же фраза в «Курс рубля за …»; у
      // месяца они расходятся регистром. Сам переключатель говорит словами «Графиков».
      '6 месяцев': ['exchange.rate_chart.period_in.6', 'exchange.rate_chart.period_option.6'],
      '12 месяцев': ['exchange.rate_chart.period_in.12', 'exchange.rate_chart.period_option.12'],
      Месяц: ['exchange.rate_chart.period_option.1', 'spending.charts.mode_month'],
      Период: ['exchange.rate_chart.period', 'spending.charts.mode'],
    })
  })

  it('и в английском тоже — он склеивает там, где русский различает', () => {
    // Снимок только по первичному языку пропускал «Cancel»: по-русски это «Отмена» в диалоге
    // и «Отменить» в шторке — два разных слова, поэтому русский дубль их не видел. Язык, где
    // текстов меньше, расходится там, где первичный разведён, и заметить это может только
    // проверка по обоим.
    expect(duplicates(EN)).toEqual({
      // One verb for two sheets, as in Russian: an account's balance, a barcode's digits (MOL-98).
      Done: ['accounts.done', 'scanner.done'],
      Purchases: [
        'nav.purchases',
        'privacy.stored.purchases.term',
        'purchases.title',
        'trip.history.title',
      ],
      Finish: ['trip.finish', 'trip.finish_confirm.ok'],
      // The screen's title and the way to it from «Where it went» (MOL-156), as in Russian.
      Charts: ['spending.charts.title', 'spending.summary.charts'],
      // «Куда ушли» on «Деньги» and «Куда ушло» on «Графики» (MOL-158): one phrase in English.
      'Where it went': ['spending.categories_title', 'spending.charts.where_title'],
      // A month after «после», after «к» and after «в»: three cases in Russian, one name in
      // English (MOL-158, MOL-159).
      ...Object.fromEntries(
        Object.entries(en.spending.month_to).map(([number, name]) => [
          name,
          [
            `spending.month_in.${number}`,
            `spending.month_of.${number}`,
            `spending.month_to.${number}`,
          ],
        ]),
      ),
      // The strip of a trip removed is the strip of a spending removed (MOL-76).
      Undo: ['spending.restore', 'trip.remove.restore'],
      'What to buy': ['advice.title', 'nav.advice'],
      Ratings: ['nav.verdicts', 'verdict.title'],
      Settings: ['nav.settings', 'settings.title'],
      Money: ['nav.money', 'settings.group_money', 'spending.title'],
      Save: [
        'accounts.sheet.save',
        'budget.sheet.save',
        'item.save_edit',
        'settings.save',
        'trip.receipt.sheet.save',
      ],
      'No connection': [
        'devices.offline.title',
        'exchange.offline.title',
        'income.offline.title',
        'item.offline.title',
        'settings.offline.title',
        'spending.categories.offline.title',
        'spending.offline.title',
      ],
      'The server did not answer': ['advice.error.title', 'item.error.title', 'trip.error.title'],
      // Английский не различает отмену диалога и отмену ввода; русский различает.
      Cancel: ['item.cancel', 'trip.finish_confirm.cancel'],
      // Отметка строки и заголовок «Не приняты» над такими строками: число есть только в русском.
      'Not accepted': ['spending.list.refused', 'spending.refused'],
      'amended {date}': ['exchange.amended', 'income.amended'],
      'Bring back': ['exchange.restore', 'income.restore'],
      'The server did not answer properly. Try again': [
        'exchange.load_error.body',
        'income.load_error.body',
      ],
      'That did not work. Check the connection and try again': ['exchange.failed', 'income.failed'],
      Currency: ['accounts.sheet.currency', 'exchange.sheet.currency', 'income.sheet.currency'],
      'Earlier versions': ['exchange.sheet.history', 'income.sheet.history'],
      'Save the amendment': ['exchange.sheet.save_amend', 'income.sheet.save_amend'],
      'Now recorded: {details}': ['exchange.sheet.current', 'income.sheet.current'],
      Categories: ['spending.categories.title', 'spending.categories_link'],
      Other: ['income.source.other', 'spending.category.other'],
      Amount: ['income.sheet.amount', 'spending.sheet.amount', 'trip.receipt.sheet.label'],
      // English has one word where Russian says «было до обмена» and «было до поступления».
      'held before {amount}': ['exchange.sheet.current_held', 'income.sheet.current_held'],
      // One English word for the screen, its sheet and the privacy entry; Russian has «Доход».
      Income: ['income.fab', 'income.sheet.title', 'income.title', 'privacy.stored.incomes.term'],
      Exchange: ['accounts.account.exchange', 'exchange.fab', 'exchange.sheet.title'],
      Gave: ['exchange.card_given', 'exchange.sheet.given'],
      Got: ['exchange.card_received', 'exchange.sheet.received'],
      'open.er-api.com': ['exchange.card_source_erapi', 'trip.rate.source_erapi'],
      // One English word for a trip's total and the accounts' (MOL-123); Russian says «Итого».
      Total: ['accounts.total', 'trip.total'],
      Name: ['accounts.sheet.name', 'spending.new_category.name'],
      // The settings group of one's Molvia account and a money account are one English word.
      Account: [
        'accounts.picker.row_spending',
        'accounts.screen.add',
        'accounts.sheet.title_edit',
        'settings.group_account',
      ],
      Accounts: ['accounts.title', 'privacy.stored.accounts.term'],
      // The period of the rate chart: its switch says it in the words of «Графики» (MOL-168).
      Month: ['exchange.rate_chart.period_option.1', 'spending.charts.mode_month'],
      Period: ['exchange.rate_chart.period', 'spending.charts.mode'],
    })
  })
})

describe('словарь: плюральные формы', () => {
  const pluralised = (messages: Record<string, string>): [string, string][] =>
    Object.entries(messages).filter(([, value]) => value.includes('|'))

  it('в русском — ровно три формы у каждого ключа с плюрализацией', () => {
    // Ключ, записанный с двумя формами (скопировали английский, потеряли среднюю), проходит
    // зеркальность, непустоту и совпадение подстановок — и возвращает «2 позиций», ровно ту
    // ошибку, ради которой в задаче появилось своё правило. Зажим в `pluralRu` превращает
    // пропуск в молчащую неверную форму, поэтому стережёт её этот тест, а не рантайм.
    for (const [key, value] of pluralised(RU)) {
      expect(value.split('|'), key).toHaveLength(3)
    }
  })

  it('в английском — ровно две', () => {
    for (const [key, value] of pluralised(EN)) {
      expect(value.split('|'), key).toHaveLength(2)
    }
  })

  it('плюрализованы одни и те же ключи в обоих языках', () => {
    // Английское значение, потерявшее `|` вовсе, тоже проходило все проверки словаря и
    // отдавало «1 items».
    expect(pluralised(RU).map(([key]) => key)).toEqual(pluralised(EN).map(([key]) => key))
  })

  it('вертикальная черта стоит только у заявленных счётчиков', () => {
    // Счёт частей ловит недостачу формы, но принимает лишнее: «Итого | НДС | чаевые» — тоже
    // «ровно три», а `t()` без счётчика вернёт от фразы первую треть. Плюральные ключи здесь
    // наперечёт, поэтому список закреплён: `|` в любом другом тексте — почти наверняка
    // разделитель, поставленный по недосмотру.
    expect(pluralised(RU).map(([key]) => key)).toEqual([
      'trip.items_count',
      'trip.rejected.orphaned',
      'trip.caveat.pending',
      'trip.unsent.title',
      'item.results_announced',
      'item.far_announced',
      'advice.ratings_count',
      'verdict.pending_count',
      'spending.unsent',
      'spending.rest_operations',
      'spending.summary.donut_more',
      'spending.summary.refused',
      'spending.charts.year_center',
      'spending.charts.year_no_rate_many',
      'spending.trip_row_meta',
      'spending.more',
      'spending.sheet.trip_meta',
      'spending.list.refused_more',
      'spending.list.refused_below',
      'spending.list.count',
      'spending.list.unsent',
      'exchange.vs_market.uncounted',
      'exchange.vs_market.count',
      'sign_out.unsent',
      'accounts.more',
      'accounts.unassigned',
      'accounts.screen.uncounted',
      'accounts.account.more',
      'accounts.reconcile.cause_trip_unpriced_meta',
    ])
  })
})

describe('словарь: каждое сообщение компилируется', () => {
  it('ни одно значение не падает при подстановке', () => {
    // `@` делает из текста ссылку на другой ключ, `|` — плюрализацию, `{` без пары роняет
    // компиляцию. Сегодня словари чистые, но ошибка такого рода всплывает в рантайме на
    // экране, а не в сборке.
    const ruT = createAppI18n('ru').global
    const enT = createAppI18n('en').global

    // Параметры собираются из самих значений, а не перечисляются руками: список, записанный
    // однажды, не узнает о ключе, заведённом завтра с именем `{limit}` — тот пройдёт проверку
    // и нарисует дыру на экране.
    const params = Object.fromEntries(
      [...Object.values(RU), ...Object.values(EN)]
        .flatMap((value) => placeholders(value))
        .map((name) => [name, name === 'n' ? 1 : `‹${name}›`]),
    )

    for (const key of Object.keys(RU)) {
      expect(() => ruT.t(key, params), key).not.toThrow()
      expect(() => enT.t(key, params), key).not.toThrow()
    }
  })

  it('каждая подстановка получила значение — ни одной дыры в собранной фразе', () => {
    // Сама сборка параметров из значений даёт и проверку: если имя подстановки не попало в
    // список, `t()` подставит пустую строку, и в тексте появится «дешевле  за ». Ищем
    // именно это — фразу, потерявшую кусок.
    const t = createAppI18n('ru').global
    const params = Object.fromEntries(
      Object.values(RU)
        .flatMap((value) => placeholders(value))
        .map((name) => [name, name === 'n' ? 1 : `‹${name}›`]),
    )

    for (const [key, value] of Object.entries(RU)) {
      if (value.includes('|')) continue
      const rendered = t.t(key, params)
      expect(rendered, key).not.toMatch(/\s{2,}/)
      for (const name of placeholders(value)) {
        expect(rendered, `${key} ← {${name}}`).toContain(name === 'n' ? '1' : `‹${name}›`)
      }
    }
  })

  it('ни одно сообщение не ссылается на другой ключ через @', () => {
    // Связанное сообщение — рабочая возможность vue-i18n, но здесь её нет ни в одном ключе,
    // и появление `@:` означало бы, что текст потерял самостоятельность незаметно.
    for (const [key, value] of [...Object.entries(RU), ...Object.entries(EN)]) {
      expect(value, key).not.toMatch(/@[:.]/)
    }
  })
})

describe('словарь: реестр ошибок', () => {
  it('каждый доменный код переводится', () => {
    // Коды реестра работают ключами i18n — так написано в докблоке errors.ts. Перебираем
    // сам реестр: список, переписанный сюда руками, разойдётся с ним молча.
    for (const code of Object.values(ERROR)) {
      expect(RU, code).toHaveProperty(code)
      expect(EN, code).toHaveProperty(code)
    }
  })

  it('не должно сработать: issue.* не переводится', () => {
    // «Тело запроса не прошло схему» — сообщение разработчику, а не человеку у полки.
    // Незнакомый код сводит к error.internal отображение из MOL-18; тринадцать строк в двух
    // языках были бы обещанием, что интерфейс объяснит непонятное.
    for (const code of Object.values(ISSUE)) {
      expect(RU, code).not.toHaveProperty(code)
      expect(EN, code).not.toHaveProperty(code)
    }
  })
})

describe('словарь: чего в нём нет намеренно', () => {
  // «Поход» ушёл из интерфейса целиком (MOL-128, П-10, В-6): открытая — «запись», законченная —
  // «покупки». Девять ключей хендоффа закрывали не всё — «Деньги», «Счета», ошибки, вход и
  // приватность говорили «поход» ещё в шестидесяти трёх строках. Ключи с `trip` остаются: это имена
  // кода, их никто не читает.
  it('ни одна строка не говорит «поход», по-английски — «trip»', () => {
    expect(Object.entries(RU).filter(([, text]) => /поход/iu.test(text))).toEqual([])
    expect(Object.entries(EN).filter(([, text]) => /\btrips?\b/iu.test(text))).toEqual([])
  })

  it('нет ключа под свёрнутую группу «не брать»', () => {
    // Сворачивание отвергнуто в решениях дизайна: «свернули читается как спрятали, а
    // пользователю иногда нужно вспомнить именно то, что брать не надо». Ключ из выжимки
    // не заводится, и тест держит это решение — иначе он вернётся.
    expect(RU).not.toHaveProperty('advice.group_never_collapsed')
    expect(EN).not.toHaveProperty('advice.group_never_collapsed')
  })

  it('нет слова «Назад» подписью кнопки возврата', () => {
    // Подпись — название предыдущего экрана («‹ Покупки»), это прямо записано в макете.
    // Остаётся только nav.back_label — слово для скринридера, которому нужен глагол, а не
    // заголовок соседнего экрана.
    for (const dictionary of [RU, EN]) {
      expect(dictionary).not.toHaveProperty('nav.back')
      expect(dictionary).toHaveProperty('nav.back_label')
    }
  })
})

describe('русская плюрализация', () => {
  it('выбирает форму по последней цифре', () => {
    const t = russian().t
    expect(t('trip.items_count', 1)).toBe('1 позиция')
    expect(t('trip.items_count', 2)).toBe('2 позиции')
    expect(t('trip.items_count', 5)).toBe('5 позиций')
  })

  it('держит второй десяток: 11–14 всегда третья форма', () => {
    // Здесь ошибается встроенное правило и почти всякое написанное наспех: «11 позиция».
    const t = russian().t
    expect(t('trip.items_count', 11)).toBe('11 позиций')
    expect(t('trip.items_count', 12)).toBe('12 позиций')
    expect(t('trip.items_count', 14)).toBe('14 позиций')
  })

  it('за вторым десятком считает снова по последней цифре', () => {
    const t = russian().t
    expect(t('trip.items_count', 21)).toBe('21 позиция')
    expect(t('trip.items_count', 22)).toBe('22 позиции')
    expect(t('trip.items_count', 25)).toBe('25 позиций')
    expect(t('trip.items_count', 101)).toBe('101 позиция')
    expect(t('trip.items_count', 111)).toBe('111 позиций')
  })

  it('ноль — третья форма, а не первая', () => {
    expect(russian().t('trip.items_count', 0)).toBe('0 позиций')
  })

  it('отрицательное — «неизвестно сколько», третья форма', () => {
    // vue-i18n отдаёт правилу -1 вместо NaN, и это единственный способ, каким отрицательное
    // сюда приходит. Считать его настоящим счётчиком («минус одна позиция») смысла нет:
    // это авария, и безличная форма честнее.
    expect(pluralRu(-1, 3)).toBe(2)
    expect(pluralRu(-2, 3)).toBe(2)
  })

  it('дробное количество — вторая форма', () => {
    // Взвешенные товары это килограммы и литры: «1,5 позиции», а не «1,5 позиций».
    expect(pluralRu(1.5, 3)).toBe(1)
    expect(pluralRu(0.5, 3)).toBe(1)
    expect(pluralRu(2.5, 3)).toBe(1)
  })

  it('счётчик из пустого ответа остаётся безличным', () => {
    // Проверяется через `t()`, а не через голую функцию: vue-i18n приводит нечисло к -1 ещё
    // до вызова правила, поэтому `pluralRu(NaN, 3)` описывает вход, до которого рантайм не
    // доживает. Число из фразы всё равно исчезает — это забота вызывающей стороны, — но
    // форма не должна притворяться, что позиция ровно одна.
    const t = russian().t

    expect(t('trip.items_count', Number.NaN)).toBe(' позиций')
    expect(t('trip.items_count', Number.POSITIVE_INFINITY)).toBe(' позиций')
    expect(t('trip.items_count', -1)).toBe('-1 позиций')
  })

  it('не выходит за пределы ключа с двумя формами', () => {
    // Страховка рантайма: индекс 2 отдал бы undefined вместо текста. От написания такого
    // ключа защищает тест на число форм, а не эта строка.
    expect(pluralRu(5, 2)).toBe(1)
    expect(pluralRu(11, 2)).toBe(1)
    expect(pluralRu(1, 2)).toBe(0)
  })

  it('не ломает английский: две формы выбираются встроенным правилом', () => {
    const t = createAppI18n('en').global.t

    expect(t('trip.items_count', 1)).toBe('1 item')
    expect(t('trip.items_count', 2)).toBe('2 items')
  })
})

describe('атрибут lang', () => {
  it('следует выбранной локали', async () => {
    // От него зависят перенос слов, голос скринридера и шрифт системного отката; в
    // index.html он прибит к «ru» и верен только до загрузки приложения.
    const { applyDocumentLang } = await import('@/i18n')

    applyDocumentLang('en')
    expect(document.documentElement.lang).toBe('en')

    applyDocumentLang('ru')
    expect(document.documentElement.lang).toBe('ru')
  })

  it('импорт модуля сам по себе документ не трогает', async () => {
    // Побочный эффект на верхнем уровне делал порядок импортов значимым там, где он обычно
    // не значим: любой импорт `@/i18n` переписывал `<html lang>`. Теперь это делает main.ts.
    //
    // `resetModules` здесь несущий, а не украшение: модуль импортирован статически первой
    // строкой файла, то есть уже выполнен, и `await import(...)` попал бы в кеш. Без сброса
    // проверка проходит даже тогда, когда эффект вернули на верхний уровень, — то есть не
    // может упасть, а тест, который не может упасть, хуже отсутствующего.
    vi.resetModules()
    document.documentElement.lang = 'xx'

    await import('@/i18n')

    expect(document.documentElement.lang).toBe('xx')
  })
})
