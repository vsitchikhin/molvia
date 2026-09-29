import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPLY_TIMEOUT_MS,
  CHECK_EVERY_MS,
  LOOK_AGAIN_MS,
  holdsTyping,
  installPwaUpdate,
} from '@/pwaUpdate'

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
  active: Worker | null = null
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

  /**
   * A version on a registration no page uses: it does not wait but becomes the active worker at
   * once — what Chromium does on a first visit, which nothing controls (adversarial Д2).
   */
  takeOver(): Worker {
    const worker = new Worker()
    this.installing = worker
    this.emit('updatefound')
    this.installing = null
    this.active = worker
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
/** The notes «Обновить» leaves for the page it brings up — the moments they were written at. */
let marks: number[] = []
const now = Date.parse('2026-09-29T10:00:00Z')
/** The page's own clock, `now()`; moved by hand where the time between two answers matters. */
let clock = now

function show(state: 'visible' | 'hidden'): void {
  hidden = state === 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
}

async function installed(
  options: { controlled?: boolean; waiting?: boolean; active?: boolean } = {},
) {
  const container = new Container(options.controlled === false ? null : {})
  if (options.waiting) container.registration.waiting = new Worker()
  if (options.active ?? options.controlled !== false) container.registration.active = new Worker()
  const reload = vi.fn()
  const update = installPwaUpdate({
    serviceWorker: container as unknown as ServiceWorkerContainer,
    script: '/sw.js',
    scope: '/',
    holdsTyping: () => sheet,
    reload,
    mark: (at) => marks.push(at),
    takeMark: () => marks.splice(0).at(-1) ?? null,
    now: () => clock,
  })
  expect(container.register).toHaveBeenCalled()
  // The registration settles on the microtask queue; the clock stays where it is.
  await vi.advanceTimersByTimeAsync(0)
  return { container, registration: container.registration, reload, update }
}

beforeEach(() => {
  vi.useFakeTimers()
  hidden = false
  sheet = false
  marks = []
  clock = now
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    hidden ? 'hidden' : 'visible',
  )
})

afterEach(() => {
  vi.useRealTimers()
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

describe('a new version taken by the button (MOL-132)', () => {
  it('has nothing to offer until a version waits', async () => {
    const { update, registration } = await installed()
    expect(update.phase.value).toBe('none')

    registration.arrive()

    expect(update.phase.value).toBe('ready')
  })

  it('offers a version that was already waiting when the page came up', async () => {
    const { update } = await installed({ waiting: true })
    expect(update.phase.value).toBe('ready')
  })

  it('must not offer the first install: a page nothing controls runs what it fetched', async () => {
    const { update, registration } = await installed({ controlled: false })
    registration.arrive()
    expect(update.phase.value).toBe('none')
  })

  it('lets the version in on «Обновить», once for a double tap, and reloads when it takes over', async () => {
    const { update, container, registration, reload } = await installed()
    const worker = registration.arrive()

    update.apply()
    update.apply()

    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' })
    expect(update.phase.value).toBe('applying')
    expect(reload).not.toHaveBeenCalled()

    container.emit('controllerchange')

    expect(reload).toHaveBeenCalledOnce()
    expect(marks).toHaveLength(1)
  })

  it('reloads at once where another window already let the version in (Р-5)', async () => {
    const { update, container, registration, reload } = await installed()
    const worker = registration.arrive()
    container.emit('controllerchange')
    expect(update.phase.value).toBe('ready')
    expect(reload).not.toHaveBeenCalled()

    update.apply()

    expect(reload).toHaveBeenCalledOnce()
    expect(worker.postMessage).not.toHaveBeenCalled()
  })

  it('must not do anything by itself while the app is looked at', async () => {
    const { update, container, registration, reload } = await installed()
    const worker = registration.arrive()
    vi.advanceTimersByTime(APPLY_TIMEOUT_MS * 10)

    expect(update.phase.value).toBe('ready')
    expect(worker.postMessage).not.toHaveBeenCalled()
    container.emit('controllerchange')
    expect(reload).not.toHaveBeenCalled()
  })

  it('must not act when nothing waits', async () => {
    const { update, reload } = await installed()
    update.apply()
    expect(update.phase.value).toBe('none')
    expect(reload).not.toHaveBeenCalled()
  })

  describe('a version that did not take (Т-7)', () => {
    it('fails when the worker has not taken over in ten seconds — and not a moment sooner', async () => {
      const { update, registration } = await installed()
      registration.arrive()
      update.apply()

      vi.advanceTimersByTime(APPLY_TIMEOUT_MS - 1)
      expect(update.phase.value).toBe('applying')
      vi.advanceTimersByTime(1)
      expect(update.phase.value).toBe('failed')
    })

    it('fails when the page «Обновить» brought up still has a version waiting', async () => {
      marks.push(now)
      const { update } = await installed({ waiting: true })
      expect(update.phase.value).toBe('failed')
      expect(marks).toEqual([])
    })

    it('offers the version as usual when the note is from another time', async () => {
      marks.push(now - 60_000)
      const { update } = await installed({ waiting: true })
      expect(update.phase.value).toBe('ready')
    })

    it('takes the note away when the version did take', async () => {
      marks.push(now)
      const { update } = await installed()
      expect(update.phase.value).toBe('none')
      expect(marks).toEqual([])
    })

    it('offers the reload again when the version takes over after all, past the ten seconds', async () => {
      const { update, container, registration, reload } = await installed()
      registration.arrive()
      update.apply()
      vi.advanceTimersByTime(APPLY_TIMEOUT_MS)
      expect(update.phase.value).toBe('failed')

      container.emit('controllerchange')
      expect(update.phase.value).toBe('ready')
      expect(reload).not.toHaveBeenCalled()

      update.apply()
      expect(reload).toHaveBeenCalledOnce()
    })

    it('stays failed rather than offering the same button again', async () => {
      const { update, registration } = await installed()
      registration.arrive()
      update.apply()
      vi.advanceTimersByTime(APPLY_TIMEOUT_MS)

      registration.arrive()
      update.apply()

      expect(update.phase.value).toBe('failed')
    })
  })

  describe('looking for a version while the app stays on the screen', () => {
    it('looks every quarter of an hour while it is looked at', async () => {
      const { registration } = await installed()

      vi.advanceTimersByTime(CHECK_EVERY_MS - 1)
      expect(registration.update).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(registration.update).toHaveBeenCalledOnce()
    })

    it('must not look while hidden', async () => {
      const { registration } = await installed()
      show('hidden')
      vi.advanceTimersByTime(CHECK_EVERY_MS * 3)
      expect(registration.update).not.toHaveBeenCalled()
    })

    it('must not look offline', async () => {
      const { registration } = await installed()
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      vi.advanceTimersByTime(CHECK_EVERY_MS)
      expect(registration.update).not.toHaveBeenCalled()
    })

    it('starts over when the app is looked at again, rather than keeping two clocks', async () => {
      const { registration } = await installed()
      show('hidden')
      show('visible')
      registration.update.mockClear()

      vi.advanceTimersByTime(CHECK_EVERY_MS)
      expect(registration.update).toHaveBeenCalledOnce()
    })
  })

  describe('a sheet opened after the tap (adversarial Д3)', () => {
    it('must not reload under it: the button comes back, and the reload waits for the tap', async () => {
      const { update, container, registration, reload } = await installed()
      registration.arrive()
      update.apply()
      sheet = true

      container.emit('controllerchange')

      expect(reload).not.toHaveBeenCalled()
      expect(update.phase.value).toBe('ready')
      sheet = false
      update.apply()
      expect(reload).toHaveBeenCalledOnce()
    })

    it('must not reload behind it either, with the app put away for the calculator', async () => {
      const { update, container, registration, reload } = await installed()
      registration.arrive()
      update.apply()
      sheet = true
      show('hidden')

      container.emit('controllerchange')
      expect(reload).not.toHaveBeenCalled()

      // Back, the purchase added, the sheet put away — and away again: the quiet way takes it.
      show('visible')
      sheet = false
      show('hidden')
      expect(reload).toHaveBeenCalledOnce()
    })

    it('still gives up after ten seconds when the version does not take over at all', async () => {
      const { update, registration } = await installed()
      registration.arrive()
      update.apply()
      sheet = true
      vi.advanceTimersByTime(APPLY_TIMEOUT_MS)
      expect(update.phase.value).toBe('failed')
    })
  })

  describe('a first visit, which nothing controls (adversarial Д2)', () => {
    it('offers a version that became the active worker behind it, and «Обновить» only reloads', async () => {
      const { update, registration, reload } = await installed({ controlled: false })
      // The page's own build installs first; that is not a version.
      const own = registration.takeOver()
      expect(update.phase.value).toBe('none')

      const next = registration.takeOver()
      expect(update.phase.value).toBe('ready')

      update.apply()
      expect(reload).toHaveBeenCalledOnce()
      expect(own.postMessage).not.toHaveBeenCalled()
      expect(next.postMessage).not.toHaveBeenCalled()
    })

    it('takes it quietly once put away, as any version', async () => {
      const { registration, reload } = await installed({ controlled: false })
      registration.takeOver()
      registration.takeOver()

      show('hidden')

      expect(reload).toHaveBeenCalledOnce()
    })

    it('knows its own worker when it was already installing as the page came up', async () => {
      const container = new Container(null)
      container.registration.installing = new Worker()
      const reload = vi.fn()
      const update = installPwaUpdate({
        serviceWorker: container as unknown as ServiceWorkerContainer,
        script: '/sw.js',
        scope: '/',
        holdsTyping: () => sheet,
        reload,
        mark: (at) => marks.push(at),
        takeMark: () => null,
        now: () => now,
      })
      await vi.advanceTimersByTimeAsync(0)
      const own = container.registration.installing
      container.registration.installing = null
      container.registration.active = own
      own.emit('statechange')

      expect(update.phase.value).toBe('none')
    })

    it('takes the worker already active as it came up for its own, as a fast first install leaves it', async () => {
      const { update, registration } = await installed({ controlled: false, active: true })
      expect(update.phase.value).toBe('none')

      registration.takeOver()

      expect(update.phase.value).toBe('ready')
    })
  })

  describe('the build an answer names (Т-3)', () => {
    it('looks again while nothing is found, but not more often than every half a minute (С-8)', async () => {
      const { update, registration } = await installed()
      update.serverVersion('v0.1.4-1-g3a00000')
      update.serverVersion('v0.1.4-2-g9f00000')
      expect(registration.update).toHaveBeenCalledOnce()

      // The API came out a moment before the static files: the first look found the old worker.
      clock += LOOK_AGAIN_MS - 1
      update.serverVersion('v0.1.4-2-g9f00000')
      expect(registration.update).toHaveBeenCalledOnce()
      clock += 1
      update.serverVersion('v0.1.4-2-g9f00000')
      expect(registration.update).toHaveBeenCalledTimes(2)

      // Found: nothing more to look for.
      registration.arrive()
      clock += LOOK_AGAIN_MS
      update.serverVersion('v0.1.4-2-g9f00000')
      expect(registration.update).toHaveBeenCalledTimes(2)
    })

    it('looks at once when the server names another build than it did', async () => {
      const { update, registration } = await installed()
      update.serverVersion('v0.1.4-1-g3a00000')
      update.serverVersion('v0.1.4-1-g3a00000')
      expect(registration.update).not.toHaveBeenCalled()

      update.serverVersion('v0.1.4-2-g9f00000')
      update.serverVersion('v0.1.4-2-g9f00000')

      expect(registration.update).toHaveBeenCalledOnce()
    })

    it('must not offer a version on the build alone: only a worker has one to let in', async () => {
      const { update } = await installed()
      update.serverVersion('v0.1.4-1-g3a00000')
      update.serverVersion('v0.1.4-2-g9f00000')
      expect(update.phase.value).toBe('none')
    })

    it('must not compare a build nobody named', async () => {
      const { update, registration } = await installed()
      update.serverVersion('dev')
      update.serverVersion('v0.1.4-2-g9f00000')
      update.serverVersion('dev')
      expect(registration.update).not.toHaveBeenCalled()
    })
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
