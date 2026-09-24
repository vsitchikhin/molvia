import { describe, expect, it } from 'vitest'
import { LOGIN_LIFETIME_SECONDS } from '@molvia/model'
import { timeAgo } from './when'

const NOW = new Date('2026-09-23T12:05:00Z')
const ago = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1000)

describe('возраст запроса словами', () => {
  it('меньше минуты — так и говорит, на обеих границах', () => {
    expect(timeAgo(ago(0), 'ru', NOW)).toBe('меньше минуты назад')
    expect(timeAgo(ago(59), 'ru', NOW)).toBe('меньше минуты назад')
  })

  it('ровно минута — «минуту назад», а не «1 минуты»', () => {
    expect(timeAgo(ago(60), 'ru', NOW)).toBe('минуту назад')
    expect(timeAgo(ago(119), 'ru', NOW)).toBe('минуту назад')
  })

  it('две-четыре минуты — своя форма', () => {
    expect(timeAgo(ago(120), 'ru', NOW)).toBe('2 минуты назад')
    expect(timeAgo(ago(299), 'ru', NOW)).toBe('4 минуты назад')
  })

  it('пять минут — последняя форма и потолок', () => {
    expect(timeAgo(ago(300), 'ru', NOW)).toBe('5 минут назад')
  })

  it('часы бота не печатают невозможного возраста', () => {
    // Запрос старше срока `previewLogin` не отдаёт вовсе, значит такой возраст — это
    // разошедшиеся часы бота и базы. Без зажима здесь получилось бы «21 минут назад»:
    // неверный русский, которого никакая общая плюрализация в боте не стоит.
    expect(timeAgo(ago(21 * 60), 'ru', NOW)).toBe('5 минут назад')
    expect(timeAgo(ago(LOGIN_LIFETIME_SECONDS), 'ru', NOW)).toBe('5 минут назад')
  })

  it('время из будущего — «меньше минуты назад», а не отрицательное число', () => {
    expect(timeAgo(ago(-600), 'ru', NOW)).toBe('меньше минуты назад')
  })

  it('срок жизни запроса не длиннее двадцати минут — иначе нужна плюрализация', () => {
    // Четырёх ключей хватает **потому что** запрос живёт пять минут: дальше начинается «21
    // минуту», «22 минуты», и зажим напечатает «21 минут назад». Граница рассуждения записана
    // здесь, у той единственной строки в `contracts/auth.ts`, которой её сломают.
    expect(LOGIN_LIFETIME_SECONDS).toBeLessThanOrEqual(20 * 60)
  })

  it('по-английски формы совпадают, и это не дубль', () => {
    expect(timeAgo(ago(0), 'en', NOW)).toBe('less than a minute ago')
    expect(timeAgo(ago(60), 'en', NOW)).toBe('a minute ago')
    expect(timeAgo(ago(180), 'en', NOW)).toBe('3 minutes ago')
    expect(timeAgo(ago(300), 'en', NOW)).toBe('5 minutes ago')
  })
})
