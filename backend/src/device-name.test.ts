import { expect, it } from 'vitest'
import { deviceName } from './device-name'

it.each([
  ['Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1', 'iPhone · Safari'],
  [
    'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
    'Android · Chrome',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
    'Windows · Edge',
  ],
  ['Mozilla/5.0 (iPhone) CriOS/123.0 Mobile Safari/604.1', 'iPhone · Chrome'],
  // Adversarial А2: what the audience actually holds.
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    'Mac / iPad · Safari',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
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
  // Adversarial Б3: Chromium that is not Chrome is named by its system, or by its own token.
  [
    'Mozilla/5.0 (Linux; U; Android 12; ru-ru; M2101K6G Build/SKQ1.210908.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/112.0.5615.136 Mobile Safari/537.36 XiaoMi/MiuiBrowser/14.4.0-g',
    'Android',
  ],
  [
    'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 OPR/80.4.4244.7786',
    'Android · Opera',
  ],
  [
    'Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36',
    'Android',
  ],
  [
    'Mozilla/5.0 (Linux; Android 13; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Android',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Vivaldi/6.5',
    'Windows',
  ],
  [undefined, null],
  ['unknown client', null],
  ['', null],
])('labels %s without retaining the raw header', (header, expected) => {
  expect(deviceName(header)).toBe(expected)
})
