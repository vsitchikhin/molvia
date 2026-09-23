import { describe, expect, it } from 'vitest'
import { en } from '@/i18n/en'
import { ru } from '@/i18n/ru'
import { t } from './i18n'

/** `{device}`, `{n}` — what a message expects to be handed when it is printed. */
function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? ''))].sort()
}

const RU: Record<string, string> = ru
const EN: Record<string, string> = en

describe('словарь бота', () => {
  it('ни одного пустого значения', () => {
    // Пустая строка — это пропущенный перевод, а не текст. Ключа без текста не заводится.
    for (const [key, value] of [...Object.entries(RU), ...Object.entries(EN)]) {
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('ни одной заглушки вместо текста', () => {
    for (const [key, value] of [...Object.entries(RU), ...Object.entries(EN)]) {
      expect(value.trim(), key).not.toMatch(/^(TODO|FIXME|XXX|TBD|\?+|-+)$/i)
    }
  })

  it('у одного ключа одинаковый набор подстановок в обоих языках', () => {
    // Зеркальность ключей держат типы; потерянная подстановка типами не видна — перевод
    // без `{device}` промолчит и напечатает сообщение без устройства.
    for (const key of Object.keys(RU)) {
      expect(placeholders(EN[key] ?? ''), key).toEqual(placeholders(RU[key] ?? ''))
    }
  })
})

describe('перевод', () => {
  it('подставляет по имени', () => {
    expect(t('ru', 'login.when.few', { n: 3 })).toBe('3 минуты назад')
    expect(t('ru', 'start.greeting', { url: 'https://molvia.test' })).toContain(
      'https://molvia.test',
    )
  })

  it('неподставленное имя остаётся как есть, а не становится «undefined»', () => {
    // Печатать «undefined» человеку хуже, чем показать имя подстановки: второе видно в
    // тесте и на глаз, первое читается как поломка приложения.
    expect(t('ru', 'login.prompt', { device: 'iPhone' })).toContain('{when}')
  })

  it('язык берётся правилом домена, а не сравнением строк', () => {
    expect(t('en', 'login.confirm')).toBe('Sign in')
    expect(t('en-GB', 'login.confirm')).toBe('Sign in')
    expect(t('ru', 'login.confirm')).toBe('Войти')
    // Армянский телефон и человек без языка в профиле получают русский — решение MOL-16.
    expect(t('hy-AM', 'login.confirm')).toBe('Войти')
    expect(t(undefined, 'login.confirm')).toBe('Войти')
    // `enm` — среднеанглийский, а не английский.
    expect(t('enm', 'login.confirm')).toBe('Войти')
  })
})
