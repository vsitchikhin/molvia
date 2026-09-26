import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RegisterSWOptions } from 'vite-plugin-pwa/types'
import { installPwaUpdate } from '@/pwaUpdate'

function visibility(state: DocumentVisibilityState): void {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

/** The plugin's `registerSW`, driven by hand: what it was given, and a worker to report. */
function installed() {
  let options: RegisterSWOptions = {}
  const update = vi.fn(() => Promise.resolve())
  const check = vi.fn(() => Promise.resolve(undefined as never))
  installPwaUpdate((given) => {
    options = given
    return update
  })
  const registration = { update: check } as unknown as ServiceWorkerRegistration
  options.onRegisteredSW?.('/sw.js', registration)
  return { options, update, check }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('an installed app taking a new version (MOL-46)', () => {
  it('registers at once, not on the load event', () => {
    const { options } = installed()
    expect(options.immediate).toBe(true)
  })

  it('does not reload while the app is looked at: what is being typed stays', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const { options, update } = installed()

    options.onNeedRefresh?.()

    expect(update).not.toHaveBeenCalled()
  })

  it('takes the new version the moment the app is put away', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const { options, update } = installed()
    options.onNeedRefresh?.()

    visibility('hidden')

    expect(update).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('takes it at once when it is found with the app already hidden', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const { options, update } = installed()

    options.onNeedRefresh?.()

    expect(update).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('must not reload on being put away when there is nothing new', () => {
    const { update } = installed()

    visibility('hidden')

    expect(update).not.toHaveBeenCalled()
  })

  it('takes one version once: a second hide reloads nothing more', () => {
    const { options, update } = installed()
    visibility('visible')
    options.onNeedRefresh?.()

    visibility('hidden')
    visibility('visible')
    visibility('hidden')

    expect(update).toHaveBeenCalledTimes(1)
  })

  it('looks for a new version when the app is looked at again and when the network is back', () => {
    const { check } = installed()

    visibility('visible')
    window.dispatchEvent(new Event('online'))

    expect(check).toHaveBeenCalledTimes(2)
  })

  it('says nothing when a look for a new version fails offline', async () => {
    const { check } = installed()
    check.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    visibility('visible')

    await expect(Promise.resolve()).resolves.toBeUndefined()
    expect(check).toHaveBeenCalledOnce()
  })
})
