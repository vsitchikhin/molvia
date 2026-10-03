import { afterEach, describe, expect, it, vi } from 'vitest'

// A module of the app throws while the bundle is evaluated (adversarial Б3 of round 2):
// `navigation.ts` is imported by `main.ts` after the catchers, as every module of the app is.
vi.mock('@/navigation', () => {
  throw new TypeError('undefined is not a function')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ловушки стоят до вычисления модулей приложения (MOL-144)', () => {
  it('модуль, бросивший при загрузке, застаёт слушатель error окна', async () => {
    const listen = vi.spyOn(window, 'addEventListener')
    // Vitest wraps a throwing factory in its own words; the cause is ours.
    const error = await import('@/main').catch((caught: unknown) => caught)
    expect(String((error as Error).cause ?? error)).toContain('undefined is not a function')
    expect(listen.mock.calls.map(([type]) => type)).toContain('error')
  })
})
