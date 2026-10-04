import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError } from '@molvia/client'
import { ERROR, POLICY_VERSION, parseMoney } from '@molvia/model'
import type { ActorView, Consent, LoginPoll, LoginStarted, SpendingBody } from '@molvia/model'
import { useActorStore } from '@/stores/actor'
import { useConsentStore } from '@/stores/consent'
import { useLoginStore } from '@/stores/login'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

const startLogin = vi.fn<(options?: { readonly again?: boolean }) => Promise<LoginStarted>>()
const pollLogin = vi.fn<(id: string) => Promise<LoginPoll>>()
const me = vi.fn<() => Promise<ActorView>>()
const consent = vi.fn<() => Promise<Consent>>()
const acceptConsent = vi.fn<(version: number) => Promise<Consent>>()
const recordSpending = vi.fn<(body: SpendingBody) => Promise<unknown>>()
vi.mock('@/api', () => ({
  api: {
    startLogin: (options?: { readonly again?: boolean }) => startLogin(options),
    pollLogin: (id: string) => pollLogin(id),
    logout: () => Promise.resolve(),
    me: () => me(),
    consent: () => consent(),
    acceptConsent: (version: number) => acceptConsent(version),
    recordSpending: (body: SpendingBody) => recordSpending(body),
  },
  onMissingActor: () => undefined,
}))

const KEY = 'molvia.login'
const OWNER = 'molvia.actor'
const MINE: ActorView = {
  id: '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f',
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: new Date('2026-10-04T10:00:00.000Z'),
  updatedAt: new Date('2026-10-04T10:00:00.000Z'),
}
const CONSENT = `molvia.consent.${MINE.id}`

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

function visibility(value: DocumentVisibilityState): void {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value)
  document.dispatchEvent(new Event('visibilitychange'))
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Claimed on this device («Да, это я»); the terms not accepted on it. */
function claimedHere(): void {
  localStorage.setItem(KEY, JSON.stringify({ claimed: MINE.id }))
  localStorage.setItem(OWNER, MINE.id)
  setActivePinia(createPinia())
}

function spend(): void {
  useSpendingQueueStore().record({
    id: 'eeeeeeee-0000-4000-8000-000000000001',
    spentOn: '2026-10-04',
    amount: parseMoney('5000', 'AMD'),
    categoryId: 'ffffffff-0000-4000-8000-000000000001',
    note: 'Барбер',
  })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  for (const mock of [startLogin, pollLogin, me, consent, acceptConsent, recordSpending])
    mock.mockReset()
  recordSpending.mockResolvedValue(undefined)
  acceptConsent.mockImplementation((version) => Promise.resolve({ version }))
  online(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the writes of an owner who accepted no edition wait on the phone (MOL-95, А1)', () => {
  it('recorded at the shelf with no signal, they do not go when the server names the owner — and go after «Принимаю»', async () => {
    claimedHere()
    online(false)
    const actor = useActorStore()
    const login = useLoginStore()
    const step = useConsentStore()
    const queue = useSpendingQueueStore()
    await actor.start()
    await flush()
    expect(login.closed).toBe(false)
    spend()

    online(true)
    me.mockResolvedValue(MINE)
    consent.mockResolvedValue({ version: null })
    await actor.start()
    await flush()
    expect(step.accepted).toBeNull()
    expect(login.writesHeld).toBe(true)
    await queue.flush()
    expect(recordSpending).not.toHaveBeenCalled()

    await step.accept()
    expect(login.writesHeld).toBe(false)
    await queue.flush()
    expect(recordSpending).toHaveBeenCalledTimes(1)
  })

  it('an owner who accepted an older edition sends as before (Р-4)', async () => {
    claimedHere()
    me.mockResolvedValue(MINE)
    consent.mockResolvedValue({ version: POLICY_VERSION - 1 || null })
    const actor = useActorStore()
    const login = useLoginStore()
    await actor.start()
    await flush()
    // With the first edition there is no older one yet: the case is the domain's, held here by
    // what `unaccepted` reads — an edition on record, whichever.
    useConsentStore().$patch({ accepted: 1 })
    expect(login.writesHeld).toBe(false)
  })

  it('while the server is asked about an owner the device remembers, nothing waits', async () => {
    claimedHere()
    localStorage.setItem(CONSENT, String(POLICY_VERSION))
    me.mockResolvedValue(MINE)
    const actor = useActorStore()
    const login = useLoginStore()
    await actor.start()
    await flush()
    expect(login.writesHeld).toBe(false)
    expect(consent).not.toHaveBeenCalled()
  })
})

describe('the step does not close the door over an app already shown (MOL-95, review №3)', () => {
  it('online, with no edition remembered, the launch is the skeleton and then the step — never the app first', async () => {
    claimedHere()
    let named: (view: ActorView) => void = () => undefined
    me.mockReturnValue(new Promise((resolve) => (named = resolve)))
    consent.mockResolvedValue({ version: null })
    const actor = useActorStore()
    const login = useLoginStore()
    const starting = actor.start()
    await flush()
    expect(actor.state).toBe('loading')
    expect(login.closed).toBe(true)
    expect(login.phase).toBe('loading')
    named(MINE)
    await starting
    await flush()
    expect(login.phase).toBe('consent')
  })

  it('remembering this edition, the launch opens on the drawer while the server is asked, as before', async () => {
    claimedHere()
    localStorage.setItem(CONSENT, String(POLICY_VERSION))
    me.mockReturnValue(new Promise(() => undefined))
    const actor = useActorStore()
    const login = useLoginStore()
    void actor.start()
    await flush()
    expect(actor.state).toBe('loading')
    expect(login.closed).toBe(false)
  })

  /** Shown on the drawer with no signal; the signal back, and `me()` answers when told to. */
  async function shownOffline() {
    claimedHere()
    online(false)
    const actor = useActorStore()
    const login = useLoginStore()
    await actor.start()
    await flush()
    expect(login.closed).toBe(false)
    online(true)
    return { actor, login }
  }

  function aSheet(): HTMLDialogElement {
    const sheet = document.createElement('dialog')
    sheet.setAttribute('open', '')
    document.body.append(sheet)
    return sheet
  }

  it('the signal back: the door stays open for the whole of `me()`, not shut by its skeleton (№7)', async () => {
    const { actor, login } = await shownOffline()
    let named: (view: ActorView) => void = () => undefined
    me.mockReturnValue(new Promise((resolve) => (named = resolve)))
    consent.mockResolvedValue({ version: POLICY_VERSION })
    const starting = actor.start()
    await flush()
    expect(actor.state).toBe('loading')
    expect(login.closed).toBe(false)
    named(MINE)
    await starting
    await flush()
    expect(login.closed).toBe(false)
  })

  it('and so after an identity that could not be checked, asked again (№7)', async () => {
    claimedHere()
    me.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const actor = useActorStore()
    const login = useLoginStore()
    await actor.start()
    await flush()
    expect(actor.state).toBe('error')
    expect(login.closed).toBe(false)
    me.mockReset().mockReturnValue(new Promise(() => undefined))
    void actor.start()
    await flush()
    expect(actor.state).toBe('loading')
    expect(login.closed).toBe(false)
  })

  it('one who accepted nothing: over an open sheet the door waits, and the step comes as the last sheet closes (Б1)', async () => {
    const { actor, login } = await shownOffline()
    const sheet = aSheet()
    me.mockResolvedValue(MINE)
    consent.mockResolvedValue({ version: null })
    await actor.start()
    await flush()
    expect(useConsentStore().holds).toBe(true)
    // A price may be being typed in that sheet: the door does not close over it.
    expect(login.closed).toBe(false)

    sheet.removeAttribute('open')
    sheet.dispatchEvent(new Event('close'))
    expect(login.closed).toBe(true)
    expect(login.phase).toBe('consent')
  })

  it('one who accepted nothing, with no sheet open: the step at once — nothing written past it (Б1)', async () => {
    const { actor, login } = await shownOffline()
    me.mockResolvedValue(MINE)
    consent.mockResolvedValue({ version: null })
    await actor.start()
    await flush()
    expect(login.closed).toBe(true)
    expect(login.phase).toBe('consent')
  })

  it('not known yet (the question failed): the app stays until hidden with no sheet open', async () => {
    const { actor, login } = await shownOffline()
    me.mockResolvedValue(MINE)
    consent.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    await actor.start()
    await flush()
    expect(useConsentStore().state).toBe('error')
    expect(login.closed).toBe(false)

    const sheet = aSheet()
    visibility('hidden')
    expect(login.closed).toBe(false)
    sheet.remove()
    visibility('hidden')
    expect(login.closed).toBe(true)
  })

  it('a failed question is asked again when the signal is back, and the shelf’s writes go (Б2)', async () => {
    const { actor, login } = await shownOffline()
    spend()
    online(false)
    me.mockResolvedValue(MINE)
    consent.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'transport', false))
    online(true)
    await actor.start()
    await flush()
    expect(login.writesHeld).toBe(true)

    consent.mockResolvedValue({ version: POLICY_VERSION })
    window.dispatchEvent(new Event('online'))
    await flush()
    // Asked again (stores of earlier tests listen to `online` too, so not counted by calls).
    expect(useConsentStore().accepted).toBe(POLICY_VERSION)
    expect(login.writesHeld).toBe(false)
    await useSpendingQueueStore().flush()
    expect(recordSpending).toHaveBeenCalledTimes(1)
  })
})

describe('a login failure from before does not stand above the step (MOL-95, А3)', () => {
  it('a neighbour signs in: this window shows the step, and nothing begins another login', async () => {
    setActivePinia(createPinia())
    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    const actor = useActorStore()
    await actor.start()
    const login = useLoginStore()
    startLogin.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    await login.begin()
    expect(login.phase).toBe('error')

    me.mockReset().mockResolvedValue(MINE)
    consent.mockResolvedValue({ version: null })
    localStorage.setItem(KEY, JSON.stringify({ claimed: MINE.id }))
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    await flush()

    expect(login.closed).toBe(true)
    expect(login.phase).toBe('consent')
    expect(startLogin).toHaveBeenCalledTimes(1)
  })
})

describe('the age ticked outlives the step (MOL-95, А4)', () => {
  it('is the store’s, for this owner — another owner starts unticked', async () => {
    claimedHere()
    me.mockResolvedValue(MINE)
    consent.mockResolvedValue({ version: null })
    const actor = useActorStore()
    await actor.start()
    await flush()
    const step = useConsentStore()
    step.aged = true
    expect(useConsentStore().aged).toBe(true)

    actor.release()
    await flush()
    expect(step.aged).toBe(false)
  })
})
