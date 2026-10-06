import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { md5Hex } from '#model/support/md5'

const nodeMd5 = (bytes: Uint8Array): string => createHash('md5').update(bytes).digest('hex')

describe('md5Hex', () => {
  it('gives the vectors of RFC 1321', () => {
    const text = (value: string) => new TextEncoder().encode(value)
    expect(md5Hex(text(''))).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Hex(text('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5Hex(text('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0')
  })

  it('agrees with node:crypto at every length around a block and on a link’s size', () => {
    for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 556, 576, 832]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 255)
      expect(md5Hex(bytes), `length ${String(length)}`).toBe(nodeMd5(bytes))
    }
  })
})
