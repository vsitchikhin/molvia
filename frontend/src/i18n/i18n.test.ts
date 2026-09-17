import { describe, expect, it, vi } from 'vitest'
import { ERROR, ISSUE } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { pickLocale } from '@/i18n/locale'
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
      // Подпись таба и заголовок экрана — разные роли одного слова, живут отдельно осознанно.
      Поход: ['nav.trip', 'trip.title'],
      'Что брать': ['advice.title', 'nav.advice'],
      Оценки: ['nav.verdicts', 'verdict.title'],
      // Цена Р-2: одно состояние, написанное для трёх экранов.
      'Сервер не ответил': ['advice.error.title', 'item.error.title', 'trip.error.title'],
      'Нет сети': ['identity.offline.title', 'item.offline.title'],
      // Кнопка в двух местах похода: в списке и в офлайне.
      'Добавить позицию': ['trip.add_item', 'trip.offline.action'],
    })
  })

  it('и в английском тоже — он склеивает там, где русский различает', () => {
    // Снимок только по первичному языку пропускал «Cancel»: по-русски это «Отмена» в диалоге
    // и «Отменить» в шторке — два разных слова, поэтому русский дубль их не видел. Язык, где
    // текстов меньше, расходится там, где первичный разведён, и заметить это может только
    // проверка по обоим.
    expect(duplicates(EN)).toEqual({
      Trip: ['nav.trip', 'trip.title'],
      'What to buy': ['advice.title', 'nav.advice'],
      Ratings: ['nav.verdicts', 'verdict.title'],
      'The server did not answer': ['advice.error.title', 'item.error.title', 'trip.error.title'],
      'No connection': ['identity.offline.title', 'item.offline.title'],
      'Add an item': ['trip.add_item', 'trip.offline.action'],
      // Английский не различает отмену диалога и отмену ввода; русский различает.
      Cancel: ['item.cancel', 'trip.finish_confirm.cancel'],
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
      'item.results_announced',
      'advice.ratings_count',
      'verdict.pending_count',
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
  it('нет ключа под свёрнутую группу «не брать»', () => {
    // Сворачивание отвергнуто в решениях дизайна: «свернули читается как спрятали, а
    // пользователю иногда нужно вспомнить именно то, что брать не надо». Ключ из выжимки
    // не заводится, и тест держит это решение — иначе он вернётся.
    expect(RU).not.toHaveProperty('advice.group_never_collapsed')
    expect(EN).not.toHaveProperty('advice.group_never_collapsed')
  })

  it('нет слова «Назад» подписью кнопки возврата', () => {
    // Подпись — название предыдущего экрана («‹ Поход»), это прямо записано в макете.
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

describe('выбор языка', () => {
  it('русский язык браузера — русский', () => {
    expect(pickLocale('ru-RU')).toBe('ru')
    expect(pickLocale(['ru-RU', 'en-US'])).toBe('ru')
  })

  it('английский язык браузера — английский', () => {
    expect(pickLocale('en-US')).toBe('en')
    expect(pickLocale('EN')).toBe('en')
  })

  it('армянский телефон получает русский, а не английский', () => {
    // Телефон, купленный в Гюмри, приходит с hy-AM и принадлежит русскоязычному человеку.
    // Прежнее правило («это ru? иначе английский») показывало ему язык, на котором продукт
    // не написан, а англоязычной аудитории в 0.1 нет вовсе.
    expect(pickLocale('hy-AM')).toBe('ru')
  })

  it('читается весь список предпочтений, а не только первый язык', () => {
    // Армянский с английским вторым — это человек, читающий по-английски; армянский с
    // русским вторым — человек из Гюмри. `navigator.language` их не различает.
    expect(pickLocale(['hy-AM', 'en-US'])).toBe('en')
    expect(pickLocale(['hy-AM', 'ru-RU'])).toBe('ru')
    expect(pickLocale(['de-DE', 'fr-FR'])).toBe('ru')
  })

  it('похожий на английский тег английским не считается', () => {
    // `enm` — среднеанглийский, `en-nonsense` — мусор. Совпадение по префиксу делало
    // английским любой тег, начинающийся с «en».
    expect(pickLocale('enm')).toBe('ru')
    expect(pickLocale('en-nonsense')).toBe('en')
  })

  it('неизвестный или отсутствующий язык — тоже русский', () => {
    expect(pickLocale('')).toBe('ru')
    expect(pickLocale(undefined)).toBe('ru')
    expect(pickLocale(null)).toBe('ru')
    expect(pickLocale([])).toBe('ru')
    expect(pickLocale('de-DE')).toBe('ru')
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
