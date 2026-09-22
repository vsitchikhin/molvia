import { expect, it } from 'vitest'
import { deviceName } from './device-name'

it.each([
  ['Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1', 'iPhone · Safari'],
  ['Mozilla/5.0 (Android) Chrome/128.0 Safari/537.36', 'Android · Chrome'],
  ['Mozilla/5.0 (Windows) Chrome/128.0 Safari/537.36 Edg/128.0', 'Windows · Edge'],
  ['Mozilla/5.0 (iPhone) CriOS/123.0 Mobile Safari/604.1', 'iPhone · Chrome'],
  [undefined, null],
  ['unknown client', null],
  ['', null],
])('labels %s without retaining the raw header', (header, expected) => {
  expect(deviceName(header)).toBe(expected)
})
