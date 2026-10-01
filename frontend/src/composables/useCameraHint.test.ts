import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSION_WAIT, useCameraHint } from '@/composables/useCameraHint'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
const IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15'
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
// Browsers of iOS that are WebKit with Apple's vendor, and not Safari (adversarial А).
const NOT_SAFARI = {
  yandex:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 YaBrowser/23.5.6.403.10 SA/3 Mobile/15E148 Safari/604.1',
  yandexApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 YaBrowser/26.3.7.356.10 YaApp_iOS/2603.7 YaApp_iOS_Browser/2603.7 Safari/604.1 SA/3 Version/26.0',
  duckduckgo:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15',
  duckduckgoNew:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1 Ddg/26.4',
  googleApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.123456789 Mobile/15E148 Safari/604.1',
  aloha:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/605.1.15 AlohaBrowser/8.9.0',
  opera:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 OPT/5.4.0 Mobile/15E148 Safari/604.1',
  // A browser inside another app, on a bare WKWebView: a link opened in a messenger.
  inApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
}
// The app from the home screen names no `Safari/`, and is Safari's.
const HOME_SCREEN =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

function phone(options: {
  vendor?: string
  userAgent?: string
  touch?: number
  permission?: PermissionState | 'throws' | 'none'
  standalone?: boolean
}): void {
  const {
    vendor = 'Apple Computer, Inc.',
    userAgent = IPHONE,
    touch = 5,
    permission = 'prompt',
    standalone = false,
  } = options
  const define = (name: string, value: unknown) =>
    Object.defineProperty(navigator, name, { value, configurable: true })
  define('vendor', vendor)
  define('userAgent', userAgent)
  define('maxTouchPoints', touch)
  define('standalone', standalone)
  define(
    'permissions',
    permission === 'none'
      ? undefined
      : {
          query: () =>
            permission === 'throws'
              ? Promise.reject(new TypeError('camera is not a valid permission name'))
              : Promise.resolve({ state: permission }),
        },
  )
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) => ({ matches: standalone && query.includes('standalone') }) as MediaQueryList,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCameraHint', () => {
  it('brings the sheet up once the camera is live, when Safari has just asked', async () => {
    phone({})
    const hint = useCameraHint()
    await hint.check()
    expect(hint.open.value).toBe(false)
    hint.started()
    expect(hint.open.value).toBe(true)
    expect(hint.offer.value).toBe(false)
  })

  it('must not bring it up where «Разрешить» is set already', async () => {
    phone({ permission: 'granted' })
    const hint = useCameraHint()
    await hint.check()
    hint.started()
    expect(hint.open.value).toBe(false)
    expect(hint.offer.value).toBe(false)
  })

  it('must not bring it up on a refusal — the scanner says how to allow it there', async () => {
    phone({ permission: 'denied' })
    const hint = useCameraHint()
    await hint.check()
    hint.started()
    expect(hint.open.value).toBe(false)
  })

  it('says nothing where the browser cannot tell', async () => {
    for (const permission of ['throws', 'none'] as const) {
      phone({ permission })
      const hint = useCameraHint()
      await hint.check()
      hint.started()
      expect(hint.open.value).toBe(false)
      expect(hint.offer.value).toBe(false)
    }
  })

  it('takes an iPad, which calls itself a Mac, by its touch', async () => {
    phone({ userAgent: IPAD })
    const ipad = useCameraHint()
    await ipad.check()
    ipad.started()
    expect(ipad.open.value).toBe(true)

    localStorage.clear()
    phone({ userAgent: IPAD, touch: 0 })
    const mac = useCameraHint()
    await mac.check()
    mac.started()
    expect(mac.open.value).toBe(false)
  })

  it('must not name Safari to another browser of iOS, inside an app or on Android', async () => {
    for (const options of [
      { userAgent: CHROME_IOS },
      { userAgent: ANDROID, vendor: 'Google Inc.' },
      ...Object.values(NOT_SAFARI).map((userAgent) => ({ userAgent })),
    ]) {
      phone(options)
      const hint = useCameraHint()
      await hint.check()
      hint.started()
      expect(hint.open.value).toBe(false)
    }
  })

  it('tells the tab from the app on the home screen', async () => {
    phone({})
    const tab = useCameraHint()
    await tab.check()
    expect(tab.place.value).toBe('tab')

    phone({ standalone: true, userAgent: HOME_SCREEN })
    const app = useCameraHint()
    await app.check()
    app.started()
    expect(app.place.value).toBe('app')
    expect(app.open.value).toBe(true)
  })

  it('brings the sheet up once on this phone; after that a quiet line, and only when Safari asked', async () => {
    phone({})
    const first = useCameraHint()
    await first.check()
    first.started()
    first.dismiss()
    expect(first.open.value).toBe(false)

    const next = useCameraHint()
    await next.check()
    // Before the camera: the line is in the footer from the start, never pushing a live picture up.
    expect(next.offer.value).toBe(true)
    next.started()
    expect(next.open.value).toBe(false)
    expect(next.offer.value).toBe(true)
    next.show()
    expect(next.open.value).toBe(true)

    // Asked once, the page is not asked again until it loads anew (the owner's measure).
    phone({ permission: 'granted' })
    await next.check()
    next.started()
    expect(next.offer.value).toBe(false)
  })

  it('waits for no answer longer than PERMISSION_WAIT, and then says nothing', async () => {
    vi.useFakeTimers()
    try {
      phone({})
      Object.defineProperty(navigator, 'permissions', {
        value: { query: () => new Promise(() => undefined) },
        configurable: true,
      })
      const hint = useCameraHint()
      let answered: boolean | null = null
      void hint.check().then((current) => (answered = current))
      await vi.advanceTimersByTimeAsync(PERMISSION_WAIT - 1)
      expect(answered).toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      expect(answered).toBe(true)
      hint.started()
      expect(hint.open.value).toBe(false)
      expect(hint.offer.value).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers false to a check a later one overtook, and lets its answer go', async () => {
    phone({})
    const hint = useCameraHint()
    const first = hint.check()
    const second = hint.check()
    expect(await first).toBe(false)
    expect(await second).toBe(true)

    const put = hint.check()
    hint.reset()
    expect(await put).toBe(false)
    hint.started()
    expect(hint.open.value).toBe(false)
  })

  it('must not bring it up for a camera that started without being asked', () => {
    phone({})
    const hint = useCameraHint()
    hint.started()
    expect(hint.open.value).toBe(false)
  })

  it('lets go of everything when the scanner is put away', async () => {
    phone({})
    const hint = useCameraHint()
    await hint.check()
    hint.reset()
    hint.started()
    expect(hint.open.value).toBe(false)
    expect(hint.offer.value).toBe(false)
  })
})
