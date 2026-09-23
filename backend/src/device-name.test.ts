import { expect, it } from 'vitest'
import { deviceName } from './device-name'

it.each([
  ['Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1', 'iPhone · Safari'],
  ['Mozilla/5.0 (Android) Chrome/128.0 Safari/537.36', 'Android · Chrome'],
  ['Mozilla/5.0 (Windows) Chrome/128.0 Safari/537.36 Edg/128.0', 'Windows · Edge'],
  ['Mozilla/5.0 (iPhone) CriOS/123.0 Mobile Safari/604.1', 'iPhone · Chrome'],
  // Adversarial А2: what the audience actually holds.
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    'Mac / iPad · Safari',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    'Mac · Chrome',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    'Android · Samsung Internet',
  ],
  [
    'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 YaBrowser/24.4.1.99.00 SA/3 Mobile Safari/537.36',
    'Android · Yandex Browser',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    'iPhone',
  ],
  ['Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0', 'Linux · Firefox'],
  [undefined, null],
  ['unknown client', null],
  ['', null],
])('labels %s without retaining the raw header', (header, expected) => {
  expect(deviceName(header)).toBe(expected)
})
