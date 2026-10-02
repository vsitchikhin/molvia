import { describe, expect, it } from 'vitest'
import { feedbackPlatformSchema } from '@molvia/model'
import { platformLine } from './platform'

const IPHONE_SAFARI_26 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const IPHONE_APP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'
const ANDROID_REDUCED =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0'
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const CHROMEBOOK =
  'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

describe('platformLine', () => {
  it('names the system with the version the browser still tells, and how the app was opened', () => {
    expect(platformLine(IPHONE_SAFARI_26, true, false)).toBe('ios 26 browser')
    expect(platformLine(IPHONE_APP, true, true)).toBe('ios 17 app')
    expect(platformLine(ANDROID_FIREFOX, true, false)).toBe('android 15 browser')
  })

  it('tells an iPad asking for the desktop site from a Mac by touch', () => {
    expect(platformLine(IPAD_DESKTOP, true, false)).toBe('ipados 18 browser')
    expect(platformLine(IPAD_DESKTOP, false, false)).toBe('macos browser')
  })

  it('leaves out a version the browser froze rather than send a wrong one', () => {
    expect(platformLine(ANDROID_REDUCED, true, true)).toBe('android app')
    expect(platformLine(WINDOWS, false, false)).toBe('windows browser')
  })

  it('calls what it does not know «other», and anything it says passes the domain’s check', () => {
    expect(platformLine(CHROMEBOOK, false, false)).toBe('other browser')
    expect(platformLine('', false, false)).toBe('other browser')
    expect(
      platformLine('Mozilla/5.0 (iPhone; CPU iPhone OS 1000_1 like Mac OS X)', true, false),
    ).toBe('ios browser')
    for (const agent of [
      IPHONE_SAFARI_26,
      IPHONE_APP,
      IPAD_DESKTOP,
      ANDROID_REDUCED,
      WINDOWS,
      '',
    ]) {
      for (const installed of [true, false]) {
        expect(feedbackPlatformSchema.safeParse(platformLine(agent, true, installed)).success).toBe(
          true,
        )
      }
    }
  })
})
