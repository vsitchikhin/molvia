import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { TripPlace } from '@molvia/model'
import { useActorStore } from '@/stores/actor'
import { useRecentPlacesStore } from '@/stores/recentPlaces'

const recentPlaces = vi.fn<() => Promise<TripPlace[]>>()
vi.mock('@/api', () => ({ api: { recentPlaces: () => recentPlaces() } }))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const OTHER = '2c4e6a80-1111-4222-8333-444455556666'

const city: TripPlace = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  kind: 'store',
  name: 'Ереван Сити',
}

function fresh(identity = ME) {
  localStorage.setItem('molvia.actor', identity)
  localStorage.setItem(
    `molvia.settings.${identity}`,
    JSON.stringify({ country: 'AM', city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
  )
  setActivePinia(createPinia())
  // Личность живёт в модуле, а не в хранилище: без этого второй `fresh` остаётся первым.
  useActorStore().id = identity
  return useRecentPlacesStore()
}

describe('recent places', () => {
  it('does not offer the previous city’s places after settings change', async () => {
    recentPlaces.mockResolvedValue([city])
    const store = fresh()
    await store.refresh()
    expect(store.places).toEqual([city])
    localStorage.setItem(
      `molvia.settings.${ME}`,
      JSON.stringify({
        country: 'AM',
        city: 'Ереван',
        spendCurrency: 'AMD',
        incomeCurrency: 'RUB',
      }),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.settings.${ME}` }))
    await nextTick()
    expect(store.places).toEqual([])
  })

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    recentPlaces.mockReset()
  })

  it('запомненные места переживают перезапуск — у двери магазина сети может не быть', async () => {
    recentPlaces.mockResolvedValue([city])
    await fresh().refresh()

    recentPlaces.mockRejectedValue(new Error('Failed to fetch'))
    const again = fresh()
    expect(again.places).toEqual([city])
    await expect(again.refresh()).rejects.toThrow()
    // Сбой не стирает список: он всё ещё верен.
    expect(again.places).toEqual([city])
  })

  it('места принадлежат личности, а не устройству', async () => {
    recentPlaces.mockResolvedValue([city])
    await fresh().refresh()

    expect(fresh(OTHER).places).toEqual([])
  })

  it('битая память — пустой список, а не падение при запуске', () => {
    localStorage.setItem(`molvia.places.${ME}`, 'not json')
    expect(fresh().places).toEqual([])
  })
})
