import { describe, expect, it } from 'vitest'
import { networkOf } from './client-errors'

describe('networkOf — чья минута (MOL-144, ревью №2)', () => {
  it('IPv6 — по /64: одно домашнее подключение — один счёт', () => {
    expect(networkOf('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64')
    expect(networkOf('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64')
    expect(networkOf('2001:0db8:0001:0002::a')).toBe('2001:db8:1:2::/64')
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(networkOf('::1')).toBe('0:0:0:0::/64')
  })

  it('IPv4 и IPv4 внутри IPv6 — как есть', () => {
    expect(networkOf('198.51.100.7')).toBe('198.51.100.7')
    expect(networkOf('::ffff:198.51.100.7')).toBe('::ffff:198.51.100.7')
  })
})
