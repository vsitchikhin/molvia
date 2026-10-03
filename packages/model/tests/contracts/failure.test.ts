import { describe, expect, it } from 'vitest'
import {
  PHONE_FAILURES_KEPT,
  clientErrorsSchema,
  phoneFailureSchema,
  phoneFrameSchema,
} from '#model/contracts/failure'
import { phoneFrame } from '#model/support/failure'

const REPORT = {
  errorName: 'TypeError',
  frames: ['at Xe (/assets/index-BTCsHrpw.js:1:48213)'],
  catcher: 'screen',
  screen: 'advice',
  build: 'index-BTCsHrpw',
  platform: 'ios 18 app',
}

describe('phoneFailureSchema — что телефон говорит о сбое (MOL-144)', () => {
  it('отчёт читается', () => {
    expect(phoneFailureSchema.parse(REPORT)).toEqual(REPORT)
  })

  it.each([
    ['message', { message: 'Купить сыр' }],
    ['адрес', { url: '/advice?q=сыр' }],
    ['черновик', { draft: '5000' }],
  ])('лишнее поле — %s — отказ', (_name, extra) => {
    expect(phoneFailureSchema.safeParse({ ...REPORT, ...extra }).success).toBe(false)
  })

  it.each([
    'at Xe (https://molvia.net/assets/index.js:1:2)',
    'at Xe (/advice?q=сыр:1:2)',
    'at Xe (/advice#top:1:2)',
    'at Купить сыр (/a.js:1:2)',
    'Xe@/assets/index.js:1:2',
    'at Xe (/assets/index.js)',
  ])('кадр не того вида — %s — отказ', (frame) => {
    expect(phoneFrameSchema.safeParse(frame).success).toBe(false)
  })

  it('всё, что строит phoneFrame, схема принимает', () => {
    for (const line of [
      'at Xe (https://molvia.net/assets/index-BTCsHrpw.js:1:48213)',
      'Xe@https://molvia.net/assets/index-BTCsHrpw.js:1:48213',
      'at a (https://evil.example/x.js:1:2)',
      'Аня платила@https://molvia.net/a.js:1:2',
      'at http://127.0.0.1:5300/@fs/Users/x/packages/client/src/transport.ts?v=1:9:3',
    ]) {
      const frame = phoneFrame(line, 'https://molvia.net')
      expect(frame).toBeDefined()
      expect(phoneFrameSchema.safeParse(frame).success, frame).toBe(true)
    }
  })

  it.each([
    ['ловушка не из списка', { catcher: 'console' }],
    ['экран не имя маршрута', { screen: '/advice' }],
    ['сборка не имя файла', { build: 'v0.2.0-4-gabc1234' }],
    ['платформа — User-Agent', { platform: 'Mozilla/5.0 (iPhone)' }],
    ['вид — фраза', { errorName: 'Купить сыр' }],
    ['пустой список кадров', { frames: [] }],
  ])('%s — отказ', (_name, change) => {
    expect(phoneFailureSchema.safeParse({ ...REPORT, ...change }).success).toBe(false)
  })

  it('без кадров вовсе — можно: у DOMException регистрации их часто нет', () => {
    const { frames: _frames, ...bare } = REPORT
    expect(phoneFailureSchema.safeParse(bare).success).toBe(true)
  })

  it('сборка разработки — dev', () => {
    expect(phoneFailureSchema.safeParse({ ...REPORT, build: 'dev' }).success).toBe(true)
  })
})

describe('clientErrorsSchema — тело POST /client-errors', () => {
  it(`от одного до ${String(PHONE_FAILURES_KEPT)} отчётов`, () => {
    const many = (n: number) => ({ reports: Array.from({ length: n }, () => REPORT) })
    expect(clientErrorsSchema.safeParse(many(0)).success).toBe(false)
    expect(clientErrorsSchema.safeParse(many(1)).success).toBe(true)
    expect(clientErrorsSchema.safeParse(many(PHONE_FAILURES_KEPT)).success).toBe(true)
    expect(clientErrorsSchema.safeParse(many(PHONE_FAILURES_KEPT + 1)).success).toBe(false)
  })
})
