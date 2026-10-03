import { describe, expect, it } from 'vitest'
import { networkOf } from './client-errors'

describe('networkOf — чья минута (MOL-144, ревью №2, адверсариальный Б4)', () => {
  it('IPv6 — по /56: роутер одной квартиры — один счёт', () => {
    expect(networkOf('2001:db8:1:201::1')).toBe('2001:db8:1:200::/56')
    expect(networkOf('2001:db8:1:2ff:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:200::/56')
    expect(networkOf('2001:0db8:0001:0201::a')).toBe('2001:db8:1:200::/56')
    expect(networkOf('2001:db8:1:301::1')).not.toBe(networkOf('2001:db8:1:201::1'))
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0:0::/56')
    expect(networkOf('::1')).toBe('0:0:0:0::/56')
  })

  it('IPv4 и IPv4 внутри IPv6 — как есть', () => {
    expect(networkOf('198.51.100.7')).toBe('198.51.100.7')
    expect(networkOf('::ffff:198.51.100.7')).toBe('::ffff:198.51.100.7')
  })
})
