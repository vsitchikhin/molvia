import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  currentIdentity,
  dropIdentity,
  erasedWhileAway,
  forgetOwner,
  forgetTheInviteDoor,
  rememberIdentity,
} from '@/stores/identity'

const INVITE_KEY = 'molvia.invite'

function openedAt(path: string): void {
  window.history.replaceState({ back: '/', current: path, position: 1 }, '', path)
}

afterEach(() => {
  vi.restoreAllMocks()
  dropIdentity()
})

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
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

describe('«Выйти» стирает ящик владельца (MOL-57)', () => {
  const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
  const OTHER = '0b6f6c1e-3f7a-4c2b-9a53-5b8a5d1e2f00'

  it('уходит всё с суффиксом владельца и сам ящик, на обеих полках', () => {
    for (const shelf of [localStorage, sessionStorage]) {
      shelf.setItem('molvia.actor', OWNER)
      shelf.setItem(`molvia.trip-queue.${OWNER}`, '[]')
      shelf.setItem(`molvia.advice.${OWNER}`, '{}')
      shelf.setItem(`molvia.settings-draft.${OWNER}`, '{}')
    }

    forgetOwner(OWNER)

    for (const shelf of [localStorage, sessionStorage]) expect(shelf.length).toBe(0)
  })

  it('чужой ящик и настройки вида не трогает', () => {
    localStorage.setItem('molvia.actor', OWNER)
    localStorage.setItem(`molvia.trip-queue.${OWNER}`, '[]')
    localStorage.setItem(`molvia.trip-queue.${OTHER}`, '[]')
    localStorage.setItem('molvia.total-flipped', '1')
    // Чужое приложение на том же адресе — не наше, чтобы стирать.
    localStorage.setItem(`someone-else.${OWNER}`, 'x')

    forgetOwner(OWNER)

    expect(Object.keys(localStorage).sort()).toEqual(
      [`molvia.trip-queue.${OTHER}`, 'molvia.total-flipped', `someone-else.${OWNER}`].sort(),
    )
  })

  it('с входом уходит одобрение этого владельца, а попытка входа соседнего окна остаётся', () => {
    const request = { id: '11111111-2222-4333-8444-555555555555', url: 'https://t.me/bot?start=x' }
    localStorage.setItem('molvia.login', JSON.stringify({ request, claimed: OWNER }))
    sessionStorage.setItem('molvia.login', JSON.stringify({ claimed: OWNER }))
    localStorage.setItem('molvia.leaving', OWNER)

    forgetOwner(OWNER)

    expect(JSON.parse(localStorage.getItem('molvia.login') ?? '{}')).toEqual({ request })
    expect(sessionStorage.getItem('molvia.login')).toBeNull()
    expect(localStorage.getItem('molvia.leaving')).toBeNull()
  })

  it('чужое одобрение не трогает', () => {
    localStorage.setItem('molvia.login', JSON.stringify({ claimed: OTHER }))
    forgetOwner(OWNER)
    expect(JSON.parse(localStorage.getItem('molvia.login') ?? '{}')).toEqual({ claimed: OTHER })
  })

  it('ящик только на своей полке, при рабочей общей — стёрт в другом окне (раунд 2, Д2)', () => {
    sessionStorage.setItem('molvia.actor', OWNER)
    sessionStorage.setItem(`molvia.trip-queue.${OWNER}`, '[]')

    expect(erasedWhileAway()).toBe(true)
    expect(sessionStorage.length).toBe(0)
    expect(currentIdentity()).toBeNull()
  })

  it('после выхода вошёл другой — ящик прежнего всё равно стёрт, по значению (round 4, Ж2)', () => {
    // Вкладка помнит OWNER в памяти и на своей полке — как проснувшаяся из bfcache; общая полка
    // называет уже OTHER, вошедшего после выхода.
    rememberIdentity(OWNER)
    sessionStorage.setItem(`molvia.trip-queue.${OWNER}`, '[]')
    localStorage.setItem('molvia.actor', OTHER)

    expect(erasedWhileAway()).toBe(true)
    expect(sessionStorage.getItem(`molvia.trip-queue.${OWNER}`)).toBeNull()
    // Имя ящика пришедшего не тронуто.
    expect(localStorage.getItem('molvia.actor')).toBe(OTHER)
  })

  it('forgetOwner не снимает ни ящик, ни намерение другого владельца (self-review Р3-2)', () => {
    localStorage.setItem('molvia.actor', OTHER)
    localStorage.setItem('molvia.leaving', OTHER)
    forgetOwner(OWNER)
    expect(localStorage.getItem('molvia.actor')).toBe(OTHER)
    expect(localStorage.getItem('molvia.leaving')).toBe(OTHER)
  })

  it('контроль: хоть один ключ владельца на общей полке — ящик жив', () => {
    sessionStorage.setItem('molvia.actor', OWNER)
    localStorage.setItem(`molvia.settings.${OWNER}`, '{}')
    expect(erasedWhileAway()).toBe(false)
    expect(sessionStorage.getItem('molvia.actor')).toBe(OWNER)
  })

  it('контроль: общая полка не пишет — своя единственная, и ящик на ней законен', () => {
    sessionStorage.setItem('molvia.actor', OWNER)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(erasedWhileAway()).toBe(false)
    expect(sessionStorage.getItem('molvia.actor')).toBe(OWNER)
  })

  it('после стирания устройство больше не знает владельца', () => {
    rememberIdentity(OWNER)
    forgetOwner(OWNER)
    expect(currentIdentity()).toBeNull()
  })
})

describe('какие ключи приложение пишет на устройство', () => {
  // Снимок, а не список «что стирать»: `forgetOwner` берёт всё с суффиксом владельца, и новый
  // ключ попадает под стирание сам — если он устроен как `molvia.<что>.<владелец>`. Этот тест
  // делает новый ключ решением: добавивший его видит, в какой он группе, и если ключ хранит
  // что-то о человеке без суффикса, выход его не сотрёт (MOL-57).
  it('каждый ключ либо принадлежит владельцу, либо назван здесь как общий', () => {
    const sources = import.meta.glob(['/src/**/*.{ts,vue}', '!/src/**/*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const keys = new Set<string>()
    for (const text of Object.values(sources)) {
      for (const [, key] of text.matchAll(/['`](molvia\.[a-z-]+)[.'`$]/g)) if (key) keys.add(key)
    }
    // Без владельца: имя ящика, одобренный на устройстве вход и незавершённый выход — все три
    // стирает выход; след снятой двери приглашения; выбор вида итога — он ничего не говорит о
    // человеке.
    const ownerless = [
      'molvia.actor',
      'molvia.invite',
      'molvia.leaving',
      'molvia.login',
      // Пробная запись: пишется и тут же удаляется, чтобы узнать, работает ли общая полка.
      'molvia.probe',
      'molvia.total-flipped',
    ]
    // По владельцу — `molvia.<что>.<владелец>`, всё это уходит с `forgetOwner`.
    const perOwner = [
      'molvia.advice',
      'molvia.places',
      'molvia.recent',
      // Набранный поиск и промах — пережить перезагрузку этого окна (MOL-46).
      'molvia.search-draft',
      'molvia.settings',
      'molvia.settings-draft',
      'molvia.trip',
      'molvia.trip-history',
      // Был ли последний ответ истории пустым — своим ключом, чтобы кэш читался прежней версией
      // (MOL-77).
      'molvia.trip-history-empty',
      'molvia.trip-queue',
      'molvia.trip-rejected',
      'molvia.verdict-confirmed',
      'molvia.verdict-drafts',
      'molvia.verdict-queue',
      'molvia.verdict-skips',
    ]
    expect([...keys].sort()).toEqual([...ownerless, ...perOwner].sort())
  })
})
