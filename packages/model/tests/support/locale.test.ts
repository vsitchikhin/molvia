import { describe, expect, it } from 'vitest'
import { pickLocale } from '#model/support/locale'

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

  it('смотрит только на первый тег, и это решение, а не упрощение', () => {
    // Android и iOS сами дописывают `en-US` вторым, когда системный язык не английский.
    // Обход всего списка отдавал английский телефону из Гюмри — ровно тому человеку, ради
    // которого написано «русский по умолчанию», — и отдавал даже тогда, когда русский в
    // списке есть, только ниже.
    expect(pickLocale(['hy-AM', 'en-US'])).toBe('ru')
    expect(pickLocale(['hy-AM', 'en-US', 'ru-RU'])).toBe('ru')
    expect(pickLocale(['de-DE', 'en-US'])).toBe('ru')
    // Английский первым — человек выбрал его сам.
    expect(pickLocale(['en-GB', 'ru-RU'])).toBe('en')
  })

  it('похожий на английский тег английским не считается', () => {
    // `enm` — среднеанглийский, `en-nonsense` — мусор. Совпадение по префиксу делало
    // английским любой тег, начинающийся с «en».
    expect(pickLocale('enm')).toBe('ru')
    expect(pickLocale('en-nonsense')).toBe('en')
  })

  it('подчёркивание вместо дефиса тоже английский', () => {
    // `en_US` приходит из системных слоёв; строгое совпадение по дефису отдавало такому
    // человеку русский.
    expect(pickLocale('en_US')).toBe('en')
  })

  it('неизвестный или отсутствующий язык — тоже русский', () => {
    expect(pickLocale('')).toBe('ru')
    expect(pickLocale(undefined)).toBe('ru')
    expect(pickLocale(null)).toBe('ru')
    expect(pickLocale([])).toBe('ru')
    expect(pickLocale('de-DE')).toBe('ru')
  })
})

describe('выбор языка: тег от Telegram', () => {
  it('`language_code` — такой же тег, и правило то же', () => {
    // Бот получает одну строку вместо списка (MOL-55): у Telegram язык человека — один тег.
    expect(pickLocale('ru')).toBe('ru')
    expect(pickLocale('en')).toBe('en')
    expect(pickLocale('hy')).toBe('ru')
  })

  it('у человека без языка в профиле правило не ломается', () => {
    // `language_code` в апдейте необязателен, и отсутствие языка — обычный случай, а не сбой.
    expect(pickLocale(undefined)).toBe('ru')
  })
})
