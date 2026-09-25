import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, actorCodec } from '@molvia/model'
import type { ActorView } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import SettingsView from './SettingsView.vue'

const me = vi.fn<() => Promise<ActorView>>()
const logout = vi.fn<() => Promise<void>>()
vi.mock('@/api', () => ({
  api: { me: () => me(), logout: () => logout() },
}))

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const initial = actorCodec.parse({
  id: OWNER,
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
})

const views: VueWrapper[] = []
let clock = 0
let replaced: string[] = []

async function render(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = OWNER
  actor.apply(initial)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings')
  const view = mount(SettingsView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n('en')] },
  })
  views.push(view)
  await flushPromises()
  return view
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

/** «Sign out» in the account group, and the sheet given time to rise. */
async function askToLeave(view: VueWrapper): Promise<void> {
  await view.get('button.leave').trigger('click')
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
}

function sheet(): HTMLDialogElement {
  const found = document.querySelector('dialog[open]')
  if (!(found instanceof HTMLDialogElement)) throw new Error('no sheet is open')
  return found
}

function confirmButton(): HTMLButtonElement {
  const found = [...sheet().querySelectorAll('button')].find(
    (button) => button.textContent.trim() === en.sign_out.confirm,
  )
  if (!found) throw new Error('no «Sign out and erase» in the sheet')
  return found
}

/** Everything this device holds for the owner — what «Выйти» has to leave nothing of. */
function fillTheDrawer(): void {
  localStorage.setItem('molvia.actor', OWNER)
  localStorage.setItem(`molvia.advice.${OWNER}`, '{}')
  localStorage.setItem(`molvia.recent.${OWNER}`, '[]')
  localStorage.setItem('molvia.login', JSON.stringify({ claimed: OWNER }))
}

beforeEach(() => {
  vi.restoreAllMocks()
  me.mockReset()
  logout.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  online(true)
  me.mockResolvedValue(initial)
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  replaced = []
  vi.spyOn(window.location, 'replace').mockImplementation((url: string | URL) => {
    replaced.push(String(url))
  })
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

describe('«Выйти» на этом устройстве', () => {
  it('сначала спрашивает и ничего не делает до ответа', async () => {
    const view = await render()
    await askToLeave(view)

    expect(sheet().textContent).toContain(en.sign_out.title)
    expect(sheet().textContent).toContain(en.sign_out.body)
    // Неотправленного нет — и о нём не говорится.
    expect(sheet().textContent).not.toContain('not been sent')
    expect(logout).not.toHaveBeenCalled()
  })

  it('называет, что пропадёт: несохранённая форма настроек — одна запись', async () => {
    const view = await render()
    const city = view
      .findAll('select')
      .find((select) =>
        select.findAll('option').some((option) => option.element.value === 'Ереван'),
      )
    await city?.setValue('Ереван')
    await askToLeave(view)

    expect(sheet().textContent).toContain('1 entry has not been sent yet and will be lost')
  })

  it('стирает ящик только после ответа сервера и открывает приложение заново', async () => {
    fillTheDrawer()
    localStorage.setItem('molvia.total-flipped', '1')
    const view = await render()
    await askToLeave(view)

    let answer: () => void = () => undefined
    logout.mockReturnValue(
      new Promise<void>((resolve) => {
        answer = resolve
      }),
    )
    confirmButton().click()
    await flushPromises()
    // Запрос ушёл, ответа нет — на устройстве ничего не тронуто.
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')
    expect(replaced).toEqual([])

    answer()
    await flushPromises()

    expect(Object.keys(localStorage)).toEqual(['molvia.total-flipped'])
    expect(replaced).toEqual(['/'])
  })

  it('без связи — не стирает ничего и говорит, что нужна связь', async () => {
    fillTheDrawer()
    const view = await render()
    await askToLeave(view)

    logout.mockImplementation(() => {
      online(false)
      return Promise.reject(new ApiError(ERROR.INTERNAL, undefined, false))
    })
    confirmButton().click()
    await flushPromises()

    expect(sheet().textContent).toContain(en.sign_out.offline)
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')
    expect(localStorage.getItem('molvia.actor')).toBe(OWNER)
    expect(replaced).toEqual([])
  })

  it('сервер не ответил — красные слова, повтор той же кнопкой', async () => {
    fillTheDrawer()
    const view = await render()
    await askToLeave(view)

    logout.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValueOnce(undefined)
    confirmButton().click()
    await flushPromises()
    expect(sheet().textContent).toContain(en.sign_out.error)
    expect(localStorage.getItem('molvia.actor')).toBe(OWNER)

    confirmButton().click()
    await flushPromises()
    expect(localStorage.getItem('molvia.actor')).toBeNull()
    expect(replaced).toEqual(['/'])
  })
})

describe('выход в соседнем окне', () => {
  it('отпускает владельца и здесь — даже без связи, без вопроса серверу', async () => {
    online(false)
    localStorage.setItem('molvia.actor', OWNER)
    await render()
    const actor = useActorStore()
    me.mockClear()

    localStorage.removeItem('molvia.actor')
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'molvia.actor', oldValue: OWNER, newValue: null }),
    )
    await flushPromises()

    expect(actor.id).toBeNull()
    expect(actor.actor).toBeNull()
    expect(actor.state).toBe('signed-out')
    expect(me).not.toHaveBeenCalled()
  })

  it('контроль: запись ящика, а не его исчезновение, владельца не отпускает', async () => {
    await render()
    const actor = useActorStore()
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'molvia.actor', oldValue: null, newValue: OWNER }),
    )
    await flushPromises()
    expect(actor.id).toBe(OWNER)
  })
})
