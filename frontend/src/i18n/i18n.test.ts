import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { ERROR, ISSUE } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { pickLocale } from '@/i18n/locale'
import { pluralRu } from '@/i18n/plural-ru'

/** The real thing rather than the rule alone: the bug this guards against is vue-i18n's own. */
function russian() {
  return createI18n({
    legacy: false,
    locale: 'ru',
    messages: { ru: { items: '{n} позиция | {n} позиции | {n} позиций' } },
    pluralRules: { ru: pluralRu },
  }).global
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

/** `{n}`, `{place}`, `{version}` — what a message expects to be handed at render time. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort()
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

  it('у одного ключа одинаковый набор подстановок в обоих языках', () => {
    // Перевод, потерявший {version}, молчит: vue-i18n отдаст строку без числа, и это
    // заметят на экране, а не в сборке.
    for (const key of Object.keys(RU)) {
      expect(placeholders(EN[key] ?? ''), key).toEqual(placeholders(RU[key] ?? ''))
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
    expect(RU).not.toHaveProperty('nav.back')
    expect(RU).toHaveProperty('nav.back_label')
  })
})

describe('русская плюрализация', () => {
  it('выбирает форму по последней цифре', () => {
    const t = russian().t
    expect(t('items', 1)).toBe('1 позиция')
    expect(t('items', 2)).toBe('2 позиции')
    expect(t('items', 5)).toBe('5 позиций')
  })

  it('держит второй десяток: 11–14 всегда третья форма', () => {
    // Здесь ошибается встроенное правило и почти всякое написанное наспех: «11 позиция».
    const t = russian().t
    expect(t('items', 11)).toBe('11 позиций')
    expect(t('items', 12)).toBe('12 позиций')
    expect(t('items', 14)).toBe('14 позиций')
  })

  it('за вторым десятком считает снова по последней цифре', () => {
    const t = russian().t
    expect(t('items', 21)).toBe('21 позиция')
    expect(t('items', 22)).toBe('22 позиции')
    expect(t('items', 25)).toBe('25 позиций')
    expect(t('items', 101)).toBe('101 позиция')
    expect(t('items', 111)).toBe('111 позиций')
  })

  it('ноль — третья форма, а не первая', () => {
    expect(russian().t('items', 0)).toBe('0 позиций')
  })

  it('не выходит за пределы ключа с двумя формами', () => {
    // Иначе индекс 2 отдал бы undefined вместо текста — ради этого правило и берёт
    // choicesLength вторым аргументом.
    expect(pluralRu(5, 2)).toBe(1)
    expect(pluralRu(11, 2)).toBe(1)
    expect(pluralRu(1, 2)).toBe(0)
  })

  it('не ломает английский: две формы выбираются встроенным правилом', () => {
    const t = createI18n({
      legacy: false,
      locale: 'en',
      messages: { en: { items: '{n} item | {n} items' } },
      pluralRules: { ru: pluralRu },
    }).global.t

    expect(t('items', 1)).toBe('1 item')
    expect(t('items', 2)).toBe('2 items')
  })
})

describe('выбор языка', () => {
  it('русский язык браузера — русский', () => {
    expect(pickLocale('ru-RU')).toBe('ru')
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

  it('неизвестный или отсутствующий язык — тоже русский', () => {
    expect(pickLocale('')).toBe('ru')
    expect(pickLocale(undefined)).toBe('ru')
    expect(pickLocale(null)).toBe('ru')
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
})
