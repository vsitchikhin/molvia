import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
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
