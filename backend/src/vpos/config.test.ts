import { describe, expect, it } from 'vitest'
import { VPOS_HOSTS } from './client'
import { vposConfiguration } from './config'

const SECRET = 'secret-value-never-named'
const full = {
  VPOS_STAND: 'test',
  VPOS_CLIENT_ID: 'client-1',
  VPOS_USERNAME: 'user-1',
  VPOS_PASSWORD: SECRET,
  APP_BASE_URL: 'https://molvia.net/',
}

describe('the bank’s configuration (MOL-277, Р-7)', () => {
  it('is read only while payments are on', () => {
    expect(vposConfiguration({}, false)).toBeNull()
  })

  it('takes the stand’s hosts, the three values and the PWA’s origin', () => {
    expect(vposConfiguration(full, true)).toEqual({
      stand: 'test',
      hosts: VPOS_HOSTS.test,
      credentials: { clientId: 'client-1', username: 'user-1', password: SECRET },
      appBaseUrl: 'https://molvia.net',
    })
  })

  it('stops the start naming what is missing — empty is missing — and never a value', () => {
    for (const name of ['VPOS_STAND', 'VPOS_PASSWORD', 'APP_BASE_URL'] as const) {
      const broken = { ...full, [name]: '' }
      expect(() => vposConfiguration(broken, true)).toThrow(name)
    }
    expect(() => vposConfiguration({ ...full, VPOS_STAND: 'prod' }, true)).toThrow('VPOS_STAND')
    try {
      vposConfiguration({ ...full, VPOS_USERNAME: '' }, true)
    } catch (error) {
      expect(String(error)).not.toContain(SECRET)
    }
  })

  it('takes the fake bank of end-to-end at its own address, never in production', () => {
    const local = { ...full, VPOS_STAND: 'local', VPOS_LOCAL_URL: 'http://127.0.0.1:3349/' }
    expect(vposConfiguration(local, true)?.hosts).toEqual({
      api: 'http://127.0.0.1:3349/VPOS/api/VPOS',
      page: 'http://127.0.0.1:3349/VPOS/Payments/Pay',
      list: 'http://127.0.0.1:3349/list',
    })
    expect(() => vposConfiguration({ ...local, NODE_ENV: 'production' }, true)).toThrow(
      'never production',
    )
    expect(() => vposConfiguration({ ...local, VPOS_LOCAL_URL: '' }, true)).toThrow(
      'VPOS_LOCAL_URL',
    )
  })
})
