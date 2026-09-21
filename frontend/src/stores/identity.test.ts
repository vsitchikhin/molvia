import { beforeEach, describe, expect, it } from 'vitest'
import { forgetTheInviteDoor } from '@/stores/identity'

const INVITE_KEY = 'molvia.invite'

function openedAt(path: string): void {
  window.history.replaceState({ back: '/', current: path, position: 1 }, '', path)
}

beforeEach(() => {
  localStorage.clear()
  openedAt('/')
})

describe('what the invite door left behind', () => {
  it('forgets the code that used to live on the device', () => {
    // The door is gone — the handle, the header, the variable — but the code itself outlives
    // the deletion on every phone that ever opened an invite link, and nothing was left that
    // would ever remove it (MOL-52, adversarial Б1).
    localStorage.setItem(INVITE_KEY, 'let-me-in')

    forgetTheInviteDoor()

    expect(localStorage.getItem(INVITE_KEY)).toBeNull()
  })

  it('takes the code out of the address, which is where it actually stays', () => {
    // An address goes into history, into a screenshot, into the `start_url` of an installed
    // PWA and into every `Referer` the page sends. That is why it used to be scrubbed on every
    // start — and the scrubbing went out with the door it belonged to.
    openedAt('/advice?c=let-me-in&utm_source=telegram')

    forgetTheInviteDoor()

    expect(window.location.search).not.toContain('c=')
    expect(window.location.search).toContain('utm_source=telegram')
    expect(window.location.pathname).toBe('/advice')
  })

  it('keeps the history state while scrubbing, so «back» does not lose its way', () => {
    // Wiping it made «back» from a screen opened by such a link land nowhere: the state is the
    // router's own record of the entry underneath (MOL-17).
    openedAt('/?c=let-me-in')
    const state: unknown = window.history.state

    forgetTheInviteDoor()

    expect(window.history.state).toEqual(state)
  })

  it('leaves an address that never carried a code alone', () => {
    openedAt('/advice?utm_source=telegram#top')

    forgetTheInviteDoor()

    expect(window.location.search).toBe('?utm_source=telegram')
    expect(window.location.hash).toBe('#top')
  })
})
