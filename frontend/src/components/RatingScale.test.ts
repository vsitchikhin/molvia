import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RatingScale from '@/components/RatingScale.vue'
import { createAppI18n } from '@/i18n'

const render = (modelValue: number | null = null, current: number | null = null) =>
  mount(RatingScale, {
    props: { modelValue, current },
    global: { plugins: [createAppI18n('ru')] },
  })

describe('RatingScale', () => {
  it('five digits, each named for a screen reader and grouped as one control', () => {
    const view = render()

    expect(view.findAll('button').map((key) => key.text())).toEqual(['1', '2', '3', '4', '5'])
    expect(view.get('[role="group"]').attributes('aria-label')).toBe('Оценка')
    expect(view.get('button').attributes('aria-label')).toBe('Оценка 1 из 5')
  })

  it('shows what is chosen and reports a tap', async () => {
    const view = render(4)

    expect(view.get('button[aria-label="Оценка 4 из 5"]').attributes('aria-pressed')).toBe('true')

    await view.get('button[aria-label="Оценка 2 из 5"]').trigger('click')
    expect(view.emitted('update:modelValue')).toEqual([[2]])
  })

  it('a second tap on the chosen digit takes it back — the only way to undo a mis-tap', async () => {
    const view = render(4)

    await view.get('button[aria-label="Оценка 4 из 5"]').trigger('click')

    expect(view.emitted('update:modelValue')).toEqual([[null]])
  })

  it('says the score as it stands over the keys, and keeps it while another is chosen (Ф-25)', () => {
    const view = render(2, 4)

    expect(view.get('.current').text()).toBe('Ваша оценка: 4')
    // It only says it: the digit chosen is the caller's.
    expect(view.get('button[aria-label="Оценка 2 из 5"]').attributes('aria-pressed')).toBe('true')
    expect(view.get('button[aria-label="Оценка 4 из 5"]').attributes('aria-pressed')).toBe('false')
  })

  it('without a score of its own says nothing over the keys', () => {
    expect(render(4).find('.current').exists()).toBe(false)
  })
})
