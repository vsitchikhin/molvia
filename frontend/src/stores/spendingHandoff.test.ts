import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { SPENDING_TEXT_MAX } from '@molvia/model'
import { useSpendingHandoffStore } from '@/stores/spendingHandoff'

describe('spendingHandoff (MOL-78, В-1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('отдаёт переданное один раз', () => {
    const handoff = useSpendingHandoffStore()
    handoff.hand({ place: 'Ереван Сити', day: '2026-09-29' })
    expect(handoff.take()).toEqual({ place: 'Ереван Сити', day: '2026-09-29' })
    expect(handoff.take()).toBeNull()
  })

  it('имя магазина длиннее «Где» у траты обрезается по знакам, не посреди знака (ревью В)', () => {
    const handoff = useSpendingHandoffStore()
    const long = `Супермаркет «Ереван Сити» на проспекте Тиграна Меца, 4/1, вход со стороны парковки 🛒🛒`
    handoff.hand({ place: long, day: '2026-09-29' })
    const place = handoff.take()?.place ?? ''
    expect(place.length).toBeLessThanOrEqual(SPENDING_TEXT_MAX)
    expect(long.startsWith(place)).toBe(true)
    expect(place).not.toMatch(/[\uD800-\uDBFF]$/)
  })

  it('границы: ровно 80 — как есть, 81 — без последнего знака', () => {
    const handoff = useSpendingHandoffStore()
    handoff.hand({ place: 'а'.repeat(SPENDING_TEXT_MAX), day: '2026-09-29' })
    expect(handoff.take()?.place).toHaveLength(SPENDING_TEXT_MAX)
    handoff.hand({ place: 'а'.repeat(SPENDING_TEXT_MAX + 1), day: '2026-09-29' })
    expect(handoff.take()?.place).toHaveLength(SPENDING_TEXT_MAX)
  })
})
