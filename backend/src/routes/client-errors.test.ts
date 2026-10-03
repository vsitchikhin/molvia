import { describe, expect, it } from 'vitest'
import { networkOf } from './client-errors'

describe('networkOf — чья минута (MOL-144, ревью №2, адверсариальные Б4, В2)', () => {
  it('IPv6 — по /48: бесплатная /48 туннеля — один отправитель (раунд 3, В2)', () => {
    expect(networkOf('2001:db8:1:201::1')).toBe('2001:db8:1::/48')
    expect(networkOf('2001:db8:1:ff00:ffff:ffff:ffff:ffff')).toBe('2001:db8:1::/48')
    expect(networkOf('2001:0db8:0001:0201::a')).toBe('2001:db8:1::/48')
    expect(networkOf('2001:db8:2:201::1')).not.toBe(networkOf('2001:db8:1:201::1'))
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0::/48')
    expect(networkOf('::1')).toBe('0:0:0::/48')
  })

  it('IPv4 и IPv4 внутри IPv6 — как есть', () => {
    expect(networkOf('198.51.100.7')).toBe('198.51.100.7')
    expect(networkOf('::ffff:198.51.100.7')).toBe('::ffff:198.51.100.7')
  })
})
