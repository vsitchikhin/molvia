import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdsTyping, installPwaUpdate } from '@/pwaUpdate'

type Handler = () => void

/** Just enough of an event target: listeners by type, fired by hand. */
class Target {
  private readonly handlers = new Map<string, Handler[]>()
  addEventListener(type: string, handler: Handler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler])
  }
  emit(type: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler()
  }
}

class Worker extends Target {
  readonly postMessage = vi.fn()
}

class Registration extends Target {
  waiting: Worker | null = null
  installing: Worker | null = null
  readonly update = vi.fn(() => Promise.resolve())

  /** A new version found and installed: it waits, as `registerType: 'prompt'` builds it. */
  arrive(): Worker {
    const worker = new Worker()
    this.installing = worker
    this.emit('updatefound')
    this.installing = null
    this.waiting = worker
    worker.emit('statechange')
    return worker
  }
}

class Container extends Target {
  constructor(readonly controller: object | null) {
    super()
  }
  readonly registration = new Registration()
  readonly register = vi.fn(() => Promise.resolve(this.registration))
}

let hidden = false
let sheet = false

function show(state: 'visible' | 'hidden'): void {
  hidden = state === 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
}

async function installed(options: { controlled?: boolean } = {}) {
  const container = new Container(options.controlled === false ? null : {})
  const reload = vi.fn()
  installPwaUpdate({
    serviceWorker: container as unknown as ServiceWorkerContainer,
    script: '/sw.js',
    scope: '/',
    holdsTyping: () => sheet,
    reload,
  })
  await vi.waitFor(() => {
    expect(container.register).toHaveBeenCalled()
  })
  await Promise.resolve()
  return { container, registration: container.registration, reload }
}

beforeEach(() => {
  hidden = false
  sheet = false
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    hidden ? 'hidden' : 'visible',
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('an installed app taking a new version (MOL-46)', () => {
  it('registers the worker the build emits, at its scope', async () => {
    const { container } = await installed()
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })

  it('does not let a new version in while the app is looked at', async () => {
    const { registration } = await installed()
    const worker = registration.arrive()
    expect(worker.postMessage).not.toHaveBeenCalled()
  })

  it('lets it in the moment the app is put away', async () => {
    const { registration } = await installed()
    const worker = registration.arrive()

    show('hidden')

    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' })
  })

  it('lets it in at once when it arrives with the app already hidden', async () => {
    const { registration } = await installed()
    show('hidden')

    const worker = registration.arrive()

    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' })
  })

  it('reloads once the new worker has taken over, while still hidden', async () => {
    const { container, registration, reload } = await installed()
    registration.arrive()
    show('hidden')

    container.emit('controllerchange')

    expect(reload).toHaveBeenCalledOnce()
  })

  describe('never under the finger (adversarial review Г)', () => {
    it('must not reload a visible page another window let the new worker into', async () => {
      // An installed app and a tab from the bot share one worker: the other one was put away.
      const { container, reload } = await installed()

      container.emit('controllerchange')
      expect(reload).not.toHaveBeenCalled()

      show('hidden')
      expect(reload).toHaveBeenCalledOnce()
    })

    it('must not reload when the app came back before the worker took over', async () => {
      const { container, registration, reload } = await installed()
      registration.arrive()
      show('hidden')
      show('visible')

      container.emit('controllerchange')
      expect(reload).not.toHaveBeenCalled()

      show('hidden')
      expect(reload).toHaveBeenCalledOnce()
    })

    it('must not let a version in, nor reload, with a sheet up — what is typed there lives in memory', async () => {
      const { container, registration, reload } = await installed()
      const worker = registration.arrive()
      sheet = true

      show('hidden')
      expect(worker.postMessage).not.toHaveBeenCalled()

      container.emit('controllerchange')
      expect(reload).not.toHaveBeenCalled()

      // Back, the purchase added, the sheet put away — and the app away again.
      show('visible')
      sheet = false
      show('hidden')
      expect(reload).toHaveBeenCalledOnce()
    })
  })

  it('must not reload on being put away when there is nothing new', async () => {
    const { reload, registration } = await installed()

    show('hidden')

    expect(reload).not.toHaveBeenCalled()
    expect(registration.waiting).toBeNull()
  })

  it('must not reload for the first install: it replaces nothing', async () => {
    const { container, reload } = await installed({ controlled: false })
    show('hidden')

    container.emit('controllerchange')

    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once for one version', async () => {
    const { container, registration, reload } = await installed()
    registration.arrive()
    show('hidden')
    container.emit('controllerchange')

    show('visible')
    show('hidden')

    expect(reload).toHaveBeenCalledOnce()
  })

  it('looks for a new version when the app is looked at again and when the network is back', async () => {
    const { registration } = await installed()

    show('visible')
    window.dispatchEvent(new Event('online'))

    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('says nothing when a look for a new version fails offline', async () => {
    const { registration } = await installed()
    registration.update.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    show('visible')
    await Promise.resolve()

    expect(registration.update).toHaveBeenCalledOnce()
  })
})

describe('what a reload would take away (MOL-46, adversarial review Г, Ж)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('holds nothing on a page with no sheet and no search typed', () => {
    document.body.innerHTML = '<input role="combobox" value=""><input name="city" value="Гюмри">'
    expect(holdsTyping(document)).toBe(false)
  })

  it('holds a sheet that is up, and not one that is closed', () => {
    document.body.innerHTML = '<dialog></dialog>'
    expect(holdsTyping(document)).toBe(false)
    document.body.innerHTML = '<dialog open></dialog>'
    expect(holdsTyping(document)).toBe(true)
  })

  it('must not hold what keeps a draft on the device — a typed search included (review Ж2)', () => {
    // The settings, the ratings and the search write what is typed to a shelf, and a reload gives
    // it back; held, a typed query kept out the version that fixes a broken search.
    document.body.innerHTML =
      '<form><input name="city" value="Ереван"></form><textarea>хорош</textarea><input role="combobox">'
    const field = document.querySelector<HTMLInputElement>('input[role="combobox"]')
    if (field) field.value = 'кефир'
    expect(holdsTyping(document)).toBe(false)
  })
})
