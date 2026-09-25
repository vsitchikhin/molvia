import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  actorCodec,
  addExpenseBodySchema,
  catalogueEntryCodec,
  parseMoney,
  parseQuantity,
  pendingVerdictCodec,
} from '@molvia/model'
import type { ActorView, CatalogueEntry, PendingVerdict, Rating } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { sessionEnded, useActorStore } from '@/stores/actor'
import { currentIdentity } from '@/stores/identity'
import { useLoginStore } from '@/stores/login'
import { useSignOutStore } from '@/stores/signOut'
import { useVerdictDraftsStore } from '@/stores/verdictDrafts'
import SettingsView from './SettingsView.vue'

const me = vi.fn<() => Promise<ActorView>>()
const logout = vi.fn<() => Promise<void>>()
const rateItem = vi.fn<(itemId: string, rating: Rating) => Promise<unknown>>()
vi.mock('@/api', () => ({
  api: {
    me: () => me(),
    logout: () => logout(),
    rateItem: (itemId: string, rating: Rating) => rateItem(itemId, rating),
  },
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

const card: PendingVerdict = {
  itemId: 'dddddddd-0000-4000-8000-000000000001',
  name: 'Сыр «Лори»',
  placeName: 'Ереван Сити',
  boughtAt: new Date('2026-09-24T10:00:00Z'),
}

const milk: CatalogueEntry = {
  id: 'dddddddd-0000-4000-8000-000000000002',
  kind: 'product',
  name: 'Молоко «Ашхар»',
  note: null,
  defaultUnit: 'l',
  typicalQuantity: parseQuantity('1', 'l'),
}

/** The owner's keys on both shelves. */
function ownersKeys(): string[] {
  return [localStorage, sessionStorage].flatMap((shelf) =>
    Object.keys(shelf).filter((key) => key === 'molvia.actor' || key.endsWith(`.${OWNER}`)),
  )
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
  rateItem.mockReset()
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

    expect(sheet().textContent).toContain(
      '1 entry has not been sent or was not accepted and will be lost',
    )
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

describe('что «Выйти» считает пропадающим (adversarial Б3)', () => {
  it('отклонённую покупку и начатую, но не сохранённую оценку — тоже', async () => {
    localStorage.setItem('molvia.actor', OWNER)
    localStorage.setItem(
      `molvia.trip-rejected.${OWNER}`,
      JSON.stringify([
        {
          key: 'k1',
          code: ERROR.INVALID_AMOUNT,
          write: {
            kind: 'add',
            tripId: 'bbbbbbbb-0000-4000-8000-000000000001',
            entry: catalogueEntryCodec.encode(milk),
            body: addExpenseBodySchema.encode({
              id: 'cccccccc-0000-4000-8000-000000000001',
              itemId: milk.id,
              quantity: parseQuantity('0.9', 'l'),
              amount: parseMoney('520', 'AMD'),
            }),
          },
        },
      ]),
    )
    localStorage.setItem(
      `molvia.verdict-drafts.${OWNER}`,
      JSON.stringify([
        {
          card: pendingVerdictCodec.encode(card),
          score: 2,
          review: 'горчит',
          state: 'typing',
          error: null,
        },
      ]),
    )
    const view = await render()
    await askToLeave(view)
    expect(sheet().textContent).toContain('2 entries have not been sent or were not accepted')
  })
})

describe('ответ, который пришёл не вовремя', () => {
  it('оценка, отвечающая после выхода, ничего не пишет обратно (adversarial Б1)', async () => {
    localStorage.setItem('molvia.actor', OWNER)
    const view = await render()
    let answer: () => void = () => undefined
    rateItem.mockReturnValue(
      new Promise((resolve) => {
        answer = () => {
          resolve({ verdict: {}, created: true })
        }
      }),
    )
    useVerdictDraftsStore().save(card, 4, 'кисловат')
    expect(rateItem).toHaveBeenCalledOnce()

    await askToLeave(view)
    logout.mockResolvedValue(undefined)
    confirmButton().click()
    await flushPromises()
    expect(ownersKeys()).toEqual([])

    answer()
    await flushPromises()
    expect(ownersKeys()).toEqual([])
  })

  it('потерянный ответ на «Выйти»: стирание доделывает первый же «сессии нет» (adversarial Б2)', async () => {
    fillTheDrawer()
    const view = await render()
    await askToLeave(view)
    logout.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'timeout', false))
    confirmButton().click()
    await flushPromises()
    expect(sheet().textContent).toContain(en.sign_out.error)
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')

    // Сервер сессию удалил, ответ потерялся: следующий запрос приложения — `401`.
    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    sessionEnded()
    await flushPromises()

    expect(ownersKeys()).toEqual([])
    expect(replaced).toEqual(['/'])
  })

  it('шторку закрыли после сбоя — сервер переспрошен, «сессия жива» снимает намерение', async () => {
    fillTheDrawer()
    const view = await render()
    await askToLeave(view)
    logout.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    confirmButton().click()
    await flushPromises()
    sheet().querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()

    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    sessionEnded()
    await flushPromises()
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')
    expect(replaced).toEqual([])
  })

  it('шторку закрыли после сбоя, а сессии уже нет — стирание доделано (раунд 2, Д3)', async () => {
    fillTheDrawer()
    const view = await render()
    await askToLeave(view)
    logout.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'timeout', false))
    confirmButton().click()
    await flushPromises()

    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    sheet().querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await flushPromises()

    expect(ownersKeys()).toEqual([])
    expect(replaced).toEqual(['/'])
  })

  it('запуск без связи с незавершённым выходом не стирает ничего — стирает ответ сервера (раунд 2, Д1)', async () => {
    fillTheDrawer()
    const view = await render()
    await askToLeave(view)
    logout.mockImplementation(() => {
      online(false)
      return Promise.reject(new ApiError(ERROR.INTERNAL, 'offline', false))
    })
    confirmButton().click()
    await flushPromises()

    // Приложение выгружено, открыто без связи — стор выхода создан раньше запуска, как в App.vue.
    setActivePinia(createPinia())
    const signOut = useSignOutStore()
    const actor = useActorStore()
    await actor.start()
    await flushPromises()
    expect(actor.state).toBe('signed-out')
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')
    expect(replaced).toEqual([])

    // Связь вернулась: сервер спрошен, сессии нет — теперь стирание.
    online(true)
    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(signOut.leaving).toBe(false)
    expect(ownersKeys()).toEqual([])
    expect(replaced).toEqual(['/'])
  })

  it('незавершённый выход не открывает приложение без связи при следующем запуске', async () => {
    fillTheDrawer()
    const view = await render()
    await askToLeave(view)
    logout.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'timeout', false))
    confirmButton().click()
    await flushPromises()

    // Приложение закрыли, не дождавшись ответа, и открыли без связи.
    setActivePinia(createPinia())
    online(false)
    const actor = useActorStore()
    await actor.start()
    expect(actor.state).toBe('signed-out')
    expect(useLoginStore().closed).toBe(true)
  })
})

describe('выход в соседнем окне', () => {
  it('стирает и собственную полку этого окна (adversarial А1)', async () => {
    online(false)
    localStorage.setItem('molvia.actor', OWNER)
    // Всё, что пишет приложение, лежит на обеих полках — и sessionStorage у вкладки свой.
    sessionStorage.setItem('molvia.actor', OWNER)
    sessionStorage.setItem(`molvia.trip-queue.${OWNER}`, '[]')
    sessionStorage.setItem('molvia.login', JSON.stringify({ claimed: OWNER }))
    await render()

    localStorage.removeItem('molvia.actor')
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'molvia.actor', oldValue: OWNER, newValue: null }),
    )
    await flushPromises()

    expect(ownersKeys()).toEqual([])
    expect(sessionStorage.getItem('molvia.login')).toBeNull()
    expect(currentIdentity()).toBeNull()
  })

  it('«кто я», ушедший до выхода, не возвращает ящик (self-review С-2)', async () => {
    localStorage.setItem('molvia.actor', OWNER)
    await render()
    const actor = useActorStore()
    let answer: () => void = () => undefined
    me.mockReturnValue(
      new Promise((resolve) => {
        answer = () => {
          resolve(initial)
        }
      }),
    )
    actor.state = 'error'
    void actor.start()

    localStorage.removeItem('molvia.actor')
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'molvia.actor', oldValue: OWNER, newValue: null }),
    )
    answer()
    await flushPromises()

    expect(localStorage.getItem('molvia.actor')).toBeNull()
    expect(actor.state).toBe('signed-out')
    expect(actor.id).toBeNull()
  })

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
