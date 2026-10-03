import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE, PHONE_FAILURES_KEPT } from '@molvia/model'
import type { ClientErrors } from '@molvia/model'
import { FAILURES_KEY, failureReports, pageBuild, phoneDefect } from './failures'
import type { FailureEnvironment } from './failures'

const ORIGIN = 'https://molvia.net'
const TYPED = 'Сыр «Ширакаци», 5000 драм'

/** An error as a browser of the phone throws it: the message, and frames of the app's own script. */
function thrown(message: string, top = 'Xe', stack?: string): Error {
  const error = new TypeError(message)
  error.stack =
    stack ??
    `TypeError: ${message}\n    at ${top} (${ORIGIN}/assets/index-BTCsHrpw.js:1:48213)\n    at Qt (${ORIGIN}/assets/index-BTCsHrpw.js:1:51002)`
  return error
}

function environment(send: FailureEnvironment['send']): FailureEnvironment {
  return {
    origin: ORIGIN,
    build: 'index-BTCsHrpw',
    platform: () => 'ios 18 app',
    screen: () => 'advice',
    send,
  }
}

const network = () => new ApiError(ERROR.INTERNAL, 'Load failed', false)

let bodies: ClientErrors[]
const sending = vi.fn((body: ClientErrors) => {
  bodies.push(body)
  return Promise.resolve()
})

beforeEach(() => {
  bodies = []
  sending.mockClear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

function sentText(): string {
  return JSON.stringify(bodies)
}

describe('что уходит и что нет (MOL-144)', () => {
  it('текст поля в сообщении ошибки компонента не уходит; уходят вид, кадры, экран, сборка, платформа', async () => {
    const reports = failureReports(environment(sending))
    const Shelf = defineComponent({
      setup() {
        const price = ref(TYPED)
        return () =>
          h('div', [
            h('input', { value: price.value }),
            h(
              'button',
              {
                onClick: () => {
                  throw thrown(`Cannot price «${price.value}»`)
                },
              },
              'Сохранить',
            ),
          ])
      },
    })
    const host = document.createElement('div')
    const app = createApp(Shelf)
    app.config.errorHandler = (error) => {
      reports.report(error, 'vue')
    }
    app.mount(host)
    host.querySelector('button')?.click()
    await reports.flush()
    app.unmount()

    expect(bodies).toEqual([
      {
        reports: [
          {
            errorName: 'TypeError',
            frames: [
              'at Xe (/assets/index-BTCsHrpw.js:1:48213)',
              'at Qt (/assets/index-BTCsHrpw.js:1:51002)',
            ],
            catcher: 'vue',
            screen: 'advice',
            build: 'index-BTCsHrpw',
            platform: 'ios 18 app',
          },
        ],
      },
    ])
    expect(sentText()).not.toMatch(/Ширакаци|5000|Cannot price/)
  })

  it('кадр со своим адресом страницы уходит без него, без query и hash', async () => {
    const reports = failureReports(environment(sending))
    reports.report(
      thrown(
        'x',
        'Xe',
        `TypeError: x\n    at ${ORIGIN}/advice/search?q=%D1%81%D1%8B%D1%80#top:12:3`,
      ),
      'window',
    )
    await reports.flush()
    expect(bodies[0]?.reports[0]?.frames).toEqual(['at <anonymous> (/advice/search:12:3)'])
    expect(sentText()).not.toMatch(/q=|%D1|#top|molvia\.net/)
  })

  it('стек Safari без заголовка — с кадрами, без сообщения', async () => {
    const reports = failureReports(environment(sending))
    const error = new TypeError(`undefined is not an object (evaluating '${TYPED}')`)
    error.stack = `Xe@${ORIGIN}/assets/index-BTCsHrpw.js:1:48213\n[native code]`
    reports.report(error, 'rejection')
    await reports.flush()
    expect(bodies[0]?.reports[0]?.frames).toEqual(['at Xe (/assets/index-BTCsHrpw.js:1:48213)'])
    expect(sentText()).not.toMatch(/Ширакаци|evaluating/)
  })

  it('пойманное экраном уходит и без кадров: у DOMException их часто нет (Р-2)', async () => {
    const reports = failureReports(environment(sending))
    const error = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    Object.defineProperty(error, 'stack', { value: '' })
    reports.report(error, 'sw')
    await reports.flush()
    expect(bodies[0]?.reports).toEqual([
      expect.objectContaining({ errorName: 'QuotaExceededError', catcher: 'sw' }),
    ])
    expect(bodies[0]?.reports[0]).not.toHaveProperty('frames')
  })

  it('не должно уйти: окно услышало сбой без своего кадра — расширение, чужой скрипт', async () => {
    const reports = failureReports(environment(sending))
    reports.report(
      thrown('x', 'Xe', 'TypeError: x\n    at inject (chrome-extension://abc/content.js:1:2)'),
      'window',
    )
    reports.report(null, 'window')
    reports.report('строка вместо ошибки', 'rejection')
    await reports.flush()
    expect(sending).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(FAILURES_KEY)).toBeNull()
  })

  it('один сбой — один раз за жизнь страницы, другой — отдельно', async () => {
    const reports = failureReports(environment(sending))
    reports.report(thrown('first'), 'screen')
    await reports.flush()
    reports.report(thrown('again, another message'), 'screen')
    reports.report(thrown('other place', 'Zz'), 'screen')
    await reports.flush()
    expect(bodies.flatMap((body) => body.reports.map((report) => report.frames?.[0]))).toEqual([
      'at Xe (/assets/index-BTCsHrpw.js:1:48213)',
      'at Zz (/assets/index-BTCsHrpw.js:1:48213)',
    ])
  })
})

describe('сбой ли это телефона (Р-4, В-3)', () => {
  it.each([
    ['отказ API своим словом', new ApiError(ERROR.NOT_FOUND), false],
    ['500 API своим словом', new ApiError(ERROR.INTERNAL), false],
    ['нет связи', network(), false],
    [
      'портал или прокси: не 2xx, тело не наше',
      new ApiError(ISSUE.RESPONSE_INVALID, '', false, 502),
      false,
    ],
    ['2xx, который контракт не прочёл', new ApiError(ISSUE.RESPONSE_INVALID, '', false, 200), true],
    ['исключение в коде', new TypeError('x'), true],
  ])('%s', (_name, error, defect) => {
    expect(phoneDefect(error)).toBe(defect)
  })
})

describe('буфер до связи (Р-7)', () => {
  it('без связи — хранится, со связью — уходит, буфер пуст', async () => {
    const offline = vi.fn(() => Promise.reject(network()))
    const reports = failureReports(environment(offline))
    reports.report(thrown('x'), 'screen')
    await reports.flush()
    expect(JSON.parse(window.localStorage.getItem(FAILURES_KEY) ?? '[]')).toHaveLength(1)

    // The next page — after a reload, or the next launch — sends what was kept.
    const next = failureReports(environment(sending))
    await next.flush()
    expect(bodies[0]?.reports).toHaveLength(1)
    expect(window.localStorage.getItem(FAILURES_KEY)).toBeNull()
  })

  it('любой ответ отпускает буфер — сверх предела тоже', async () => {
    const refused = vi.fn(() => Promise.reject(new ApiError(ERROR.CLIENT_ERRORS_RATE_LIMITED)))
    const reports = failureReports(environment(refused))
    reports.report(thrown('x'), 'screen')
    await reports.flush()
    expect(refused).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(FAILURES_KEY)).toBeNull()
  })

  it(`не больше ${String(PHONE_FAILURES_KEPT)}: последние, старший уходит`, async () => {
    const offline = vi.fn(() => Promise.reject(network()))
    const reports = failureReports(environment(offline))
    for (let index = 0; index <= PHONE_FAILURES_KEPT; index += 1) {
      reports.report(thrown('x', `f${String(index)}`), 'screen')
    }
    await reports.flush()
    const kept = JSON.parse(window.localStorage.getItem(FAILURES_KEY) ?? '[]') as {
      frames: string[]
    }[]
    expect(kept).toHaveLength(PHONE_FAILURES_KEPT)
    expect(kept[0]?.frames[0]).toMatch(/^at f1 /)
  })

  it('тот же сбой с другой страницы в буфере один раз', async () => {
    const offline = vi.fn(() => Promise.reject(network()))
    failureReports(environment(offline)).report(thrown('x'), 'screen')
    failureReports(environment(offline)).report(thrown('x'), 'screen')
    await nextTick()
    expect(JSON.parse(window.localStorage.getItem(FAILURES_KEY) ?? '[]')).toHaveLength(1)
  })

  it('испорченный буфер не мешает: читается как пустой', async () => {
    window.localStorage.setItem(FAILURES_KEY, '{not json')
    const reports = failureReports(environment(sending))
    await reports.flush()
    expect(sending).not.toHaveBeenCalled()
  })
})

describe('pageBuild — сборка страницы по имени её файла (В-1)', () => {
  it.each([
    ['https://molvia.net/assets/index-BTCsHrpw.js', true, 'index-BTCsHrpw'],
    ['http://127.0.0.1:5301/assets/index-a1B2c3D4.js?v=1', true, 'index-a1B2c3D4'],
    ['http://127.0.0.1:5300/src/main.ts', false, 'dev'],
    ['https://molvia.net/assets/main-BTCsHrpw.js', true, 'dev'],
  ])('%s', (url, production, build) => {
    expect(pageBuild(url, production)).toBe(build)
  })
})

describe('ошибка, которую показал экран, уходит (В-3)', () => {
  // Every screen decides «error» or «offline» in its own catch, and the error stops there: it never
  // reaches Vue's handler. A screen added later that forgets the call is the failure this replaces.
  it('каждый файл, где экран выбирает «ошибку», зовёт reportFailure', () => {
    const sources = import.meta.glob(['/src/**/*.{ts,vue}', '!/src/**/*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const choosing = /\? '(?:error|failed|categories)' : 'offline'|\? 'offline' : 'error'/
    const silent = Object.entries(sources)
      .filter(([, text]) => choosing.test(text) && !text.includes('reportFailure('))
      .map(([path]) => path)
    expect(silent).toEqual([])
    expect(Object.values(sources).filter((text) => choosing.test(text)).length).toBeGreaterThan(20)
  })
})
