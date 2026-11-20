import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DATE_STYLE_KEY,
  DICTIONARY_RETRY_MS,
  LOCALE_KEY,
  installLocale,
  tagOf,
  useLocale,
} from '@/composables/useLocale'
import { i18n, loadDictionary } from '@/i18n'
import type * as I18n from '@/i18n'

// The real loading, one dictionary at a time (MOL-337); a test makes it fail where it says so.
vi.mock('@/i18n', async (original) => {
  const actual = await original<typeof I18n>()
  return { ...actual, loadDictionary: vi.fn(actual.loadDictionary) }
})

function phoneSpeaks(...languages: string[]): void {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
}

beforeEach(async () => {
  // The module's choice outlives a test: the device's and the British order are where every test
  // starts — chosen first, as choosing writes them, and then the shelves emptied.
  phoneSpeaks('ru-RU')
  await useLocale().choose('device')
  await useLocale().chooseStyle('gb')
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** What a dictionary already loaded needs to be spoken: its promise settled, a task later. */
function settled(): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, 0)
  })
}

describe('tagOf', () => {
  it.each([
    ['device', 'gb', ['ru-RU'], 'ru'],
    // An Armenian phone stays Russian: the choice does not reopen `pickLocale`.
    ['device', 'us', ['hy-AM', 'en-US'], 'ru'],
    ['device', 'gb', ['en-US'], 'en-GB'],
    ['device', 'us', ['en-GB'], 'en-US'],
    ['en', 'gb', ['ru-RU'], 'en-GB'],
    ['en', 'us', ['ru-RU'], 'en-US'],
    // Russian has one order of the day: the English choice of it changes nothing.
    ['ru', 'us', ['en-US'], 'ru'],
  ] as const)('%s, %s order, a phone of %j — %s', (choice, style, languages, tag) => {
    expect(tagOf(choice, style, languages)).toBe(tag)
  })
})

describe('installLocale', () => {
  it('puts the choice kept on this device over the device’s language, in the screens and in lang', async () => {
    localStorage.setItem(LOCALE_KEY, 'en')
    localStorage.setItem(DATE_STYLE_KEY, 'us')
    await installLocale()
    expect(i18n.global.locale.value).toBe('en-US')
    expect(document.documentElement.lang).toBe('en-US')
    expect(useLocale().choice.value).toBe('en')
  })

  it.each([null, '', 'de', 'device', 'EN'])(
    'reads %j as the device’s own language and the British order',
    async (value) => {
      phoneSpeaks('en-US')
      if (value !== null) localStorage.setItem(LOCALE_KEY, value)
      if (value !== null) localStorage.setItem(DATE_STYLE_KEY, value)
      await installLocale()
      expect(useLocale().choice.value).toBe('device')
      expect(i18n.global.locale.value).toBe('en-GB')
    },
  )

  it('follows a choice made in another window and keeps it on this window’s own shelf', async () => {
    await installLocale()
    localStorage.setItem(LOCALE_KEY, 'en')
    window.dispatchEvent(new StorageEvent('storage', { key: LOCALE_KEY, newValue: 'en' }))
    await vi.waitFor(() => {
      expect(i18n.global.locale.value).toBe('en-GB')
    })
    expect(sessionStorage.getItem(LOCALE_KEY)).toBe('en')
    window.dispatchEvent(new StorageEvent('storage', { key: DATE_STYLE_KEY, newValue: 'us' }))
    await vi.waitFor(() => {
      expect(i18n.global.locale.value).toBe('en-US')
    })
    expect(sessionStorage.getItem(DATE_STYLE_KEY)).toBe('us')
  })

  it('a key gone in another window is no choice: this one keeps its own', async () => {
    localStorage.setItem(LOCALE_KEY, 'en')
    await installLocale()
    window.dispatchEvent(new StorageEvent('storage', { key: LOCALE_KEY, newValue: null }))
    await settled()
    expect(i18n.global.locale.value).toBe('en-GB')
  })

  it('«как на устройстве» follows a language changed in the system, a choice does not', async () => {
    await installLocale()
    phoneSpeaks('en-GB')
    window.dispatchEvent(new Event('languagechange'))
    await vi.waitFor(() => {
      expect(i18n.global.locale.value).toBe('en-GB')
    })

    await useLocale().choose('ru')
    phoneSpeaks('en-US')
    window.dispatchEvent(new Event('languagechange'))
    await settled()
    expect(i18n.global.locale.value).toBe('ru')
  })
})

describe('useLocale', () => {
  it('a choice is drawn once its dictionary is here and kept on both shelves, «как на устройстве» too', async () => {
    const { choose } = useLocale()
    await choose('en')
    expect(i18n.global.locale.value).toBe('en-GB')
    expect(document.documentElement.lang).toBe('en-GB')
    expect(localStorage.getItem(LOCALE_KEY)).toBe('en')
    expect(sessionStorage.getItem(LOCALE_KEY)).toBe('en')

    await choose('device')
    expect(i18n.global.locale.value).toBe('ru')
    expect(localStorage.getItem(LOCALE_KEY)).toBe('device')
  })

  it('the order of the day moves only English', async () => {
    const { choose, chooseStyle } = useLocale()
    await chooseStyle('us')
    expect(i18n.global.locale.value).toBe('ru')
    expect(localStorage.getItem(DATE_STYLE_KEY)).toBe('us')
    await choose('en')
    expect(i18n.global.locale.value).toBe('en-US')
  })

  it('holds until a reload where storage refuses everything', async () => {
    // On the instances, as `useColorScheme.test.ts` does: happy-dom's storages carry their own methods.
    const refuse = (): never => {
      throw new DOMException('quota', 'QuotaExceededError')
    }
    const originals = [localStorage, sessionStorage].map((shelf) => {
      const original = shelf.setItem.bind(shelf)
      Object.defineProperty(shelf, 'setItem', { configurable: true, writable: true, value: refuse })
      return () => {
        Object.defineProperty(shelf, 'setItem', {
          configurable: true,
          writable: true,
          value: original,
        })
      }
    })
    try {
      await useLocale().choose('en')
      expect(i18n.global.locale.value).toBe('en-GB')
      expect(localStorage.getItem(LOCALE_KEY)).toBeNull()
    } finally {
      for (const restore of originals) restore()
    }
  })
})

// MOL-337: a language is a dictionary of its own, loaded when it is first spoken.
describe('the dictionary a language needs', () => {
  it('must not fire: a dictionary that did not come changes no word and writes no choice', async () => {
    vi.mocked(loadDictionary).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await useLocale().choose('en')
    expect(i18n.global.locale.value).toBe('ru')
    expect(document.documentElement.lang).toBe('ru')
    expect(useLocale().choice.value).toBe('device')
    expect(localStorage.getItem(LOCALE_KEY)).toBeNull()
  })

  it('of two choices made while the first dictionary was coming, the later one is spoken and kept', async () => {
    let arrive: () => void = () => undefined
    vi.mocked(loadDictionary).mockImplementationOnce(
      () => new Promise<void>((resolve) => (arrive = resolve)),
    )
    const first = useLocale().choose('en')
    await useLocale().choose('ru')
    arrive()
    await first
    expect(i18n.global.locale.value).toBe('ru')
    expect(useLocale().choice.value).toBe('ru')
    expect(localStorage.getItem(LOCALE_KEY)).toBe('ru')
  })

  it('the start waits for its dictionary, and asks again as the connection comes back', async () => {
    localStorage.setItem(LOCALE_KEY, 'en')
    vi.mocked(loadDictionary).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    let started = false
    const start = installLocale().then(() => {
      started = true
    })
    await settled()
    expect(started).toBe(false)
    expect(i18n.global.locale.value).toBe('ru')

    window.dispatchEvent(new Event('online'))
    await start
    expect(i18n.global.locale.value).toBe('en-GB')
  })

  it('the start asks again on its own after a while, with no `online` to hear', async () => {
    vi.useFakeTimers()
    try {
      localStorage.setItem(LOCALE_KEY, 'en')
      vi.mocked(loadDictionary).mockRejectedValueOnce(new TypeError('Failed to fetch'))
      const start = installLocale()
      await vi.advanceTimersByTimeAsync(DICTIONARY_RETRY_MS - 1)
      expect(i18n.global.locale.value).toBe('ru')
      await vi.advanceTimersByTimeAsync(1)
      await start
      expect(i18n.global.locale.value).toBe('en-GB')
    } finally {
      vi.useRealTimers()
    }
  })
})
