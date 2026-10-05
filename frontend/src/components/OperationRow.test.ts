import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import IconBus from '~icons/mdi/bus'
import AppTag from '@/components/AppTag.vue'
import ListRow from '@/components/ListRow.vue'
import OperationRow from '@/components/OperationRow.vue'

const base = {
  icon: IconBus,
  tint: 'var(--cat-transport)',
  verb: 'Открыть трату:',
  title: 'Такси домой',
  meta: 'Транспорт · Yandex Go',
}

describe('OperationRow', () => {
  it('is a row of a list: an item holding the kit’s row, its title wrapped, the chevron on it', () => {
    const view = mount(OperationRow, { props: { ...base, amount: '1 200 ֏' } })
    expect(view.element.tagName).toBe('LI')
    const row = view.getComponent(ListRow)
    expect(row.props()).toMatchObject({ wrap: true, next: true, tint: 'var(--cat-transport)' })
    expect(view.find('.chevron').exists()).toBe(true)
  })

  it('has the chevron with no amount too: every row opens something to go on with (В-14)', () => {
    const view = mount(OperationRow, { props: base })
    expect(view.find('.chevron').exists()).toBe(true)
    expect(view.find('.tail').exists()).toBe(false)
  })

  it('stands the amount and the line under it in its tail, the line only when there is one', () => {
    const both = mount(OperationRow, { props: { ...base, amount: '450 ₽', sub: '≈ 2 080 ֏' } })
    expect(both.get('.tail .amount').text()).toBe('450 ₽')
    expect(both.get('.tail .sub').text()).toBe('≈ 2 080 ֏')
    const one = mount(OperationRow, { props: { ...base, amount: '1 200 ֏' } })
    expect(one.find('.sub').exists()).toBe(false)
  })

  it('is read verb first, then all it shows — no label silences the rest', () => {
    const view = mount(OperationRow, { props: { ...base, amount: '1 200 ֏' } })
    const button = view.get('button')
    expect(button.attributes('aria-label')).toBeUndefined()
    expect(button.text()).toMatch(/^Открыть трату: Такси домой/)
    expect(button.text()).toContain('1 200 ֏')
  })

  it('draws a tag under the meta in its tone, with the icon of what it says', () => {
    const waiting = mount(OperationRow, {
      props: { ...base, tag: { tone: 'warn', text: 'Отправляем…' } },
    })
    expect(waiting.get('.below').getComponent(AppTag).props('tone')).toBe('warn')
    expect(waiting.get('.below').text()).toBe('Отправляем…')
    const refused = mount(OperationRow, {
      props: { ...base, tag: { tone: 'bad', text: 'Не принята' } },
    })
    expect(refused.getComponent(AppTag).props('tone')).toBe('bad')
    expect(refused.getComponent(AppTag).props('icon')).not.toBe(
      waiting.getComponent(AppTag).props('icon'),
    )
    expect(mount(OperationRow, { props: base }).find('.below').exists()).toBe(false)
  })

  it('says it was opened, and nothing else', async () => {
    const view = mount(OperationRow, { props: base })
    await view.get('button').trigger('click')
    expect(view.emitted('open')).toEqual([[]])
  })
})
