import { afterEach, describe, expect, it, vi } from 'vitest'

// The test here past half a second on CI carries a timeout of 10 s: it took 626 ms there at worst
// (MOL-266). Ten times that, rounded up to 5 s, so the time reporter names one only on a run slower
// than any yet seen.

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
  }, 10_000)
})
