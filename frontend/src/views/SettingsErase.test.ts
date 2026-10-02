import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE, actorCodec } from '@molvia/model'
import type { ActorView } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { sessionEnded, useActorStore } from '@/stores/actor'
import { useSignOutStore } from '@/stores/signOut'
import SettingsView from './SettingsView.vue'

const me = vi.fn<() => Promise<ActorView>>()
const logout = vi.fn<() => Promise<void>>()
const eraseMe = vi.fn<() => Promise<void>>()
vi.mock('@/api', () => ({
  api: {
    me: () => me(),
    salaryShift: () => Promise.resolve({ day: null }),
    logout: () => logout(),
    eraseMe: () => eraseMe(),
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

/** «Delete my data» in «Your data», and the sheet given time to rise. */
async function askToErase(view: VueWrapper): Promise<void> {
  await view.get('button.erase').trigger('click')
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
    (button) => button.textContent.trim() === en.erase.confirm,
  )
  if (!found) throw new Error('no «Delete for good» in the sheet')
  return found
}

/** The owner's keys on both shelves. */
function ownersKeys(): string[] {
  return [localStorage, sessionStorage].flatMap((shelf) =>
    Object.keys(shelf).filter((key) => key === 'molvia.actor' || key.endsWith(`.${OWNER}`)),
  )
}

function fillTheDrawer(): void {
  localStorage.setItem('molvia.actor', OWNER)
  localStorage.setItem(`molvia.advice.${OWNER}`, '{}')
  localStorage.setItem(`molvia.recent.${OWNER}`, '[]')
}

beforeEach(() => {
  vi.restoreAllMocks()
  me.mockReset()
  logout.mockReset()
  eraseMe.mockReset()
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

describe('«Удалить мои данные» в настройках (MOL-94)', () => {
  it('строка стоит в «Ваших данных», под «Скачать мои данные»', async () => {
    const view = await render()
    const rows = view.findAll('section.group li').map((row) => row.text())
    const download = rows.findIndex((text) => text.includes(en.settings.export.label))

    expect(rows[download + 1]).toContain(en.settings.erase.label)
  })

  it('лист называет, что уйдёт, что останется и что будет с устройствами — и ничего не шлёт', async () => {
    const view = await render()
    await askToErase(view)

    const words = sheet().textContent
    expect(words).toContain(en.erase.title)
    expect(words).toContain(en.erase.goes)
    expect(words).toContain(en.erase.stays)
    expect(words).toContain(en.erase.devices)
    expect(words).toContain(en.erase.final)
    expect(eraseMe).not.toHaveBeenCalled()
    expect(logout).not.toHaveBeenCalled()
  })

  it('стирает ящик только после 204, оставляет отметку для экрана входа и открывает приложение заново', async () => {
    fillTheDrawer()
    localStorage.setItem('molvia.total-flipped', '1')
    const view = await render()
    await askToErase(view)

    let answer: () => void = () => undefined
    eraseMe.mockReturnValue(
      new Promise<void>((resolve) => {
        answer = resolve
      }),
    )
    confirmButton().click()
    await flushPromises()
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')
    expect(sessionStorage.getItem('molvia.erased')).toBeNull()
    expect(replaced).toEqual([])

    answer()
    await flushPromises()

    expect(eraseMe).toHaveBeenCalledTimes(1)
    expect(logout).not.toHaveBeenCalled()
    expect(ownersKeys()).toEqual([])
    expect(localStorage.getItem('molvia.total-flipped')).toBe('1')
    // On this tab's shelf only: a neighbour hearing the drawer go must not take it (review 4).
    expect(sessionStorage.getItem('molvia.erased')).toBe('erased')
    expect(localStorage.getItem('molvia.erased')).toBeNull()
    expect(replaced).toEqual(['/'])
  })

  it('без связи кнопка неактивна и сказано почему; ничего не уходит и намерения нет', async () => {
    fillTheDrawer()
    online(false)
    const view = await render()
    await askToErase(view)

    expect(sheet().textContent).toContain(en.erase.offline)
    expect(confirmButton().getAttribute('aria-disabled')).toBe('true')
    confirmButton().click()
    await useSignOutStore().leave('erase')
    await flushPromises()

    expect(eraseMe).not.toHaveBeenCalled()
    expect(localStorage.getItem('molvia.leaving')).toBeNull()
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')
  })

  it('сервер не ответил — красные слова, повтор той же кнопкой', async () => {
    fillTheDrawer()
    const view = await render()
    await askToErase(view)

    eraseMe.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValueOnce(undefined)
    confirmButton().click()
    await flushPromises()
    expect(sheet().textContent).toContain(en.erase.error)
    expect(localStorage.getItem('molvia.actor')).toBe(OWNER)

    confirmButton().click()
    await flushPromises()
    expect(ownersKeys()).toEqual([])
    expect(replaced).toEqual(['/'])
  })

  it('ответил портал магазина — до сервера не дошло, намерения нет, ящик цел', async () => {
    fillTheDrawer()
    const view = await render()
    await askToErase(view)
    eraseMe.mockRejectedValue(new ApiError(ISSUE.RESPONSE_INVALID, 'HTTP 200', false))
    confirmButton().click()
    await flushPromises()

    expect(sheet().textContent).toContain(en.erase.error)
    expect(localStorage.getItem('molvia.leaving')).toBeNull()
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')
  })

  it('потерянный ответ: повтор находит «сессии нет» — «не знаем», стирание доделывает «кто я»', async () => {
    fillTheDrawer()
    const view = await render()
    await askToErase(view)
    eraseMe
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'timeout', false))
      .mockRejectedValueOnce(new ApiError(ERROR.NO_ACTOR))
    confirmButton().click()
    await flushPromises()
    expect(sheet().textContent).toContain(en.erase.error)

    confirmButton().click()
    await flushPromises()
    // The refusal alone settles nothing: the drawer waits for the server's own «nobody», and the
    // sheet says nobody can tell yet (adversarial В).
    expect(sheet().textContent).toContain(en.erase.unknown)
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')

    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    sessionEnded()
    await flushPromises()

    expect(ownersKeys()).toEqual([])
    expect(replaced).toEqual(['/'])
    // Settled by «nobody», not by the erasure's own 204: the login screen says it is not known.
    expect(sessionStorage.getItem('molvia.erased')).toBe('unknown')
  })

  it('А: сессии не было ещё до нажатия — ничего не стёрто ни там, ни тут, и это сказано', async () => {
    fillTheDrawer()
    localStorage.setItem(`molvia.trip-queue.${OWNER}`, '[]')
    const view = await render()
    await askToErase(view)
    eraseMe.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))

    confirmButton().click()
    await flushPromises()
    expect(sheet().textContent).toContain(en.erase.signed_out)
    expect(localStorage.getItem('molvia.leaving')).toBeNull()
    expect(sessionStorage.getItem('molvia.erased')).toBe('kept')

    // The seam asks who this is, and the server knows nobody: the door closes, the drawer stays —
    // a 401 erases nothing, and the account is still there to sign back into.
    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    sessionEnded()
    await flushPromises()

    expect(localStorage.getItem(`molvia.trip-queue.${OWNER}`)).toBe('[]')
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')
    expect(replaced).toEqual([])
    expect(sessionStorage.getItem('molvia.erased')).toBe('kept')
  })

  it('В: «сессии нет», а «кто я» не ответил — каждое нажатие говорит, что удаления не было', async () => {
    fillTheDrawer()
    const view = await render()
    await askToErase(view)
    eraseMe.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'timeout', false))

    for (let press = 0; press < 3; press += 1) {
      confirmButton().click()
      await flushPromises()
      expect(sheet().textContent).toContain(en.erase.signed_out)
    }
    expect(eraseMe).toHaveBeenCalledTimes(3)
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')
  })

  it('В: «сессии нет», а сервер назвал того же владельца — отметка снята, второе нажатие стирает', async () => {
    fillTheDrawer()
    const view = await render()
    await askToErase(view)
    eraseMe.mockRejectedValueOnce(new ApiError(ERROR.NO_ACTOR)).mockResolvedValueOnce(undefined)

    confirmButton().click()
    await flushPromises()
    // Signed in again in another tab meanwhile: the server knows this owner under a new cookie.
    sessionEnded()
    await flushPromises()
    expect(sheet().textContent).toContain(en.erase.signed_out)
    expect(sessionStorage.getItem('molvia.erased')).toBeNull()

    confirmButton().click()
    await flushPromises()
    expect(ownersKeys()).toEqual([])
    expect(sessionStorage.getItem('molvia.erased')).toBe('erased')
    expect(replaced).toEqual(['/'])
  })

  it('Г: слова о кончившейся сессии уходят с ней — вход на той же странице открывает лист чистым', async () => {
    fillTheDrawer()
    const view = await render()
    await askToErase(view)
    eraseMe.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    confirmButton().click()
    await flushPromises()
    expect(sheet().textContent).toContain(en.erase.signed_out)

    // The door closes over the sheet without closing it: no `stay()` is called.
    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    sessionEnded()
    await flushPromises()

    expect(useSignOutStore().eraseFailure).toBeNull()
    expect(sheet().textContent).not.toContain(en.erase.signed_out)
  })

  it('Д: ждущий «Выйти» переживает «Удалить навсегда» → 401 и доделывается первым «никого»', async () => {
    fillTheDrawer()
    localStorage.setItem(`molvia.trip-queue.${OWNER}`, '[]')
    const view = await render()
    // «Выйти» landed, its answer was lost, and the server could not be asked when the sheet closed.
    await view.get('button.leave').trigger('click')
    await flushPromises()
    clock += 1000
    await new Promise((resolve) => setTimeout(resolve, 5))
    logout.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'timeout', false))
    me.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'Failed to fetch', false))
    ;[...sheet().querySelectorAll('button')]
      .find((button) => button.textContent.trim() === en.sign_out.confirm)
      ?.click()
    await flushPromises()
    sheet().querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await flushPromises()
    expect(localStorage.getItem('molvia.leaving')).toBe(OWNER)

    await askToErase(view)
    eraseMe.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    confirmButton().click()
    await flushPromises()
    expect(sheet().textContent).toContain(en.erase.signed_out)
    // The way out is put back as it was — a «Выйти», not an erasure.
    expect(localStorage.getItem('molvia.leaving')).toBe(OWNER)
    expect(localStorage.getItem('molvia.erasing')).toBeNull()

    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    sessionEnded()
    await flushPromises()

    expect(ownersKeys()).toEqual([])
    expect(replaced).toEqual(['/'])
    // The tap was the last thing done here, and the login screen says what is known of it.
    expect(sessionStorage.getItem('molvia.erased')).toBe('kept')
  })

  it('шторку закрыли после сбоя, а сессии уже нет — стирание доделано, экран входа скажет «не знаем»', async () => {
    fillTheDrawer()
    const view = await render()
    await askToErase(view)
    eraseMe.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'timeout', false))
    confirmButton().click()
    await flushPromises()

    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    sheet().querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await flushPromises()

    expect(ownersKeys()).toEqual([])
    expect(replaced).toEqual(['/'])
    expect(sessionStorage.getItem('molvia.erased')).toBe('unknown')
  })

  it('Б: сбой удаления, пришедший при закрытом листе, не попадает в лист «Выйти» — и наоборот', async () => {
    fillTheDrawer()
    const view = await render()
    await askToErase(view)
    let fail: (error: unknown) => void = () => undefined
    eraseMe.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        fail = reject
      }),
    )
    confirmButton().click()
    await flushPromises()
    sheet().querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await flushPromises()
    fail(new ApiError(ERROR.INTERNAL))
    await flushPromises()

    await view.get('button.leave').trigger('click')
    await flushPromises()
    clock += 1000
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(sheet().textContent).not.toContain(en.sign_out.error)
    expect(sheet().textContent).not.toContain(en.erase.error)
  })

  it('шторку закрыли после сбоя, а сессия жива — намерение снято, ящик цел', async () => {
    fillTheDrawer()
    const view = await render()
    await askToErase(view)
    eraseMe.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    confirmButton().click()
    await flushPromises()

    sheet().querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await flushPromises()

    expect(document.querySelector('dialog[open]')).toBeNull()
    expect(localStorage.getItem('molvia.leaving')).toBeNull()
    expect(localStorage.getItem(`molvia.advice.${OWNER}`)).toBe('{}')
    expect(replaced).toEqual([])
  })

  it('«Выйти» после неудачного удаления — своя дверь: слова листа выхода, запрос выхода', async () => {
    fillTheDrawer()
    const view = await render()
    await askToErase(view)
    eraseMe.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    confirmButton().click()
    await flushPromises()
    sheet().querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await flushPromises()

    await view.get('button.leave').trigger('click')
    await flushPromises()
    clock += 1000
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(sheet().textContent).not.toContain(en.sign_out.error)

    logout.mockResolvedValue(undefined)
    const leave = [...sheet().querySelectorAll('button')].find(
      (button) => button.textContent.trim() === en.sign_out.confirm,
    )
    leave?.click()
    await flushPromises()

    expect(logout).toHaveBeenCalledTimes(1)
    expect(eraseMe).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('molvia.erased')).toBeNull()
    expect(replaced).toEqual(['/'])
  })
})
