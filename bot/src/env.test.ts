import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { readEnvironment, refusedNames } from './env'

const saved = { ...process.env }

afterEach(() => {
  process.env = { ...saved }
})

describe('окружение бота', () => {
  it('без своих переменных собирает адреса из портов', () => {
    process.env.API_PORT = '3320'
    process.env.PWA_PORT = '5320'
    delete process.env.API_BASE_URL
    delete process.env.APP_BASE_URL

    const environment = readEnvironment()

    expect(environment.apiBaseUrl).toBe('http://127.0.0.1:3320')
    expect(environment.appBaseUrl).toBe('http://127.0.0.1:5320')
  })

  it('пустой секрет — обычное значение, а не отказ разбора', () => {
    // «Этой копии бот не положен» решает `index.ts`, и решает выходом с нулём. Схема о таком
    // не знает: для неё пустая строка — допустимое значение.
    process.env.BOT_API_SECRET = ''

    expect(readEnvironment().secret).toBe('')
  })

  it('значение чужой формы — отказ с именем переменной и без самого значения', () => {
    // В логе копии, где секрет вписали в шестнадцатеричном виде, не должно оказаться самого
    // секрета: zod кладёт входное значение в своё сообщение, поэтому наружу идут только имена.
    const secret = 'f'.repeat(64)
    process.env.BOT_API_SECRET = secret
    process.env.APP_BASE_URL = 'molvia.am'

    let refused: unknown
    try {
      readEnvironment()
    } catch (error) {
      refused = error
    }

    const names = refusedNames(refused)
    expect(names).toContain('BOT_API_SECRET')
    expect(names).toContain('APP_BASE_URL')
    expect(names).not.toContain(secret)
    expect(names).not.toContain('molvia.am')
  })

  it('пульс: нет или пусто — выключен, https — включён (MOL-142)', () => {
    delete process.env.BOT_PULSE_URL
    expect(readEnvironment().pulseUrl).toBeUndefined()

    process.env.BOT_PULSE_URL = ''
    expect(readEnvironment().pulseUrl).toBeUndefined()

    process.env.BOT_PULSE_URL = 'https://hc-ping.com/0f1e2d3c'
    expect(readEnvironment().pulseUrl).toBe('https://hc-ping.com/0f1e2d3c')
  })

  it('пульс не https или не адрес — отказ по имени, без самого адреса', () => {
    for (const value of ['http://hc-ping.com/0f1e2d3c-secret', 'hc-ping.com/0f1e2d3c-secret']) {
      process.env.BOT_PULSE_URL = value

      let refused: unknown
      try {
        readEnvironment()
      } catch (error) {
        refused = error
      }

      const names = refusedNames(refused)
      expect(names).toBe('BOT_PULSE_URL')
      expect(names).not.toContain('secret')
    }
  })

  it('не-зодовская ошибка не притворяется разбором', () => {
    expect(refusedNames(new Error('boom'))).toBe('unknown')
  })
})
