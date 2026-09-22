import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { VerdictLevel } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import AdviceGroup from '@/components/AdviceGroup.vue'

const render = (level: VerdictLevel) =>
  mount(AdviceGroup, {
    props: { level },
    slots: { default: '<p class="row">Молоко «Ашхар»</p>' },
    global: { plugins: [createAppI18n('ru')] },
  })

describe('AdviceGroup', () => {
  it('names each group by its own word and gives it a heading', () => {
    expect(render('take').get('h2').text()).toBe('Брать')
    expect(render('if_cheap').get('h2').text()).toBe('Только если дёшево')
    expect(render('never').get('h2').text()).toBe('Не брать нигде')
  })

  it('the circle is not named twice: the word is right beside it', () => {
    // Left as an image with a label of its own, every group heading was read out twice.
    const view = render('if_cheap')

    expect(view.get('h2').text()).toBe('Только если дёшево')
    expect(view.get('.mark').attributes('aria-hidden')).toBe('true')
  })

  it('draws whatever rows the screen puts inside — the three groups are not the same shape', () => {
    expect(render('never').get('.row').text()).toBe('Молоко «Ашхар»')
  })
})
