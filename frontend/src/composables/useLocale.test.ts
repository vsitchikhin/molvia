import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DATE_STYLE_KEY,
  LOCALE_KEY,
  installLocale,
  tagOf,
  useLocale,
} from '@/composables/useLocale'
import { i18n } from '@/i18n'

function phoneSpeaks(...languages: string[]): void {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
}

beforeEach(() => {
  // The module's choice outlives a test: the device's and the British order are where every test
  // starts — chosen first, as choosing writes them, and then the shelves emptied.
  phoneSpeaks('ru-RU')
  useLocale().choose('device')
  useLocale().chooseStyle('gb')
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

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
  it('puts the choice kept on this device over the device’s language, in the screens and in lang', () => {
    localStorage.setItem(LOCALE_KEY, 'en')
    localStorage.setItem(DATE_STYLE_KEY, 'us')
    installLocale()
    expect(i18n.global.locale.value).toBe('en-US')
    expect(document.documentElement.lang).toBe('en-US')
    expect(useLocale().choice.value).toBe('en')
  })

  it.each([null, '', 'de', 'device', 'EN'])(
    'reads %j as the device’s own language and the British order',
    (value) => {
      phoneSpeaks('en-US')
      if (value !== null) localStorage.setItem(LOCALE_KEY, value)
      if (value !== null) localStorage.setItem(DATE_STYLE_KEY, value)
      installLocale()
      expect(useLocale().choice.value).toBe('device')
      expect(i18n.global.locale.value).toBe('en-GB')
    },
  )

  it('follows a choice made in another window and keeps it on this window’s own shelf', () => {
    installLocale()
    localStorage.setItem(LOCALE_KEY, 'en')
    window.dispatchEvent(new StorageEvent('storage', { key: LOCALE_KEY, newValue: 'en' }))
    expect(i18n.global.locale.value).toBe('en-GB')
    expect(sessionStorage.getItem(LOCALE_KEY)).toBe('en')
    window.dispatchEvent(new StorageEvent('storage', { key: DATE_STYLE_KEY, newValue: 'us' }))
    expect(i18n.global.locale.value).toBe('en-US')
    expect(sessionStorage.getItem(DATE_STYLE_KEY)).toBe('us')
  })

  it('a key gone in another window is no choice: this one keeps its own', () => {
    localStorage.setItem(LOCALE_KEY, 'en')
    installLocale()
    window.dispatchEvent(new StorageEvent('storage', { key: LOCALE_KEY, newValue: null }))
    expect(i18n.global.locale.value).toBe('en-GB')
  })

  it('«как на устройстве» follows a language changed in the system, a choice does not', () => {
    installLocale()
    phoneSpeaks('en-GB')
    window.dispatchEvent(new Event('languagechange'))
    expect(i18n.global.locale.value).toBe('en-GB')

    useLocale().choose('ru')
    phoneSpeaks('en-US')
    window.dispatchEvent(new Event('languagechange'))
    expect(i18n.global.locale.value).toBe('ru')
  })
})

describe('useLocale', () => {
  it('a choice is drawn at once and kept on both shelves, «как на устройстве» too', () => {
    const { choose } = useLocale()
    choose('en')
    expect(i18n.global.locale.value).toBe('en-GB')
    expect(document.documentElement.lang).toBe('en-GB')
    expect(localStorage.getItem(LOCALE_KEY)).toBe('en')
    expect(sessionStorage.getItem(LOCALE_KEY)).toBe('en')

    choose('device')
    expect(i18n.global.locale.value).toBe('ru')
    expect(localStorage.getItem(LOCALE_KEY)).toBe('device')
  })

  it('the order of the day moves only English', () => {
    const { choose, chooseStyle } = useLocale()
    chooseStyle('us')
    expect(i18n.global.locale.value).toBe('ru')
    expect(localStorage.getItem(DATE_STYLE_KEY)).toBe('us')
    choose('en')
    expect(i18n.global.locale.value).toBe('en-US')
  })

  it('holds until a reload where storage refuses everything', () => {
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
      useLocale().choose('en')
      expect(i18n.global.locale.value).toBe('en-GB')
      expect(localStorage.getItem(LOCALE_KEY)).toBeNull()
    } finally {
      for (const restore of originals) restore()
    }
  })
})
