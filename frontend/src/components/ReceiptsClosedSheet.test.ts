import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { ReceiptsAccess, ReceiptsClosed } from '@molvia/model'
import ReceiptsClosedSheet from '@/components/ReceiptsClosedSheet.vue'
import { createAppI18n } from '@/i18n'
import ru from '@/i18n/ru.json'

/** The sheet's frame drawn flat — its title, body and footer — since what is tested is the words and the ways. */
const BottomSheet = defineComponent({
  name: 'BottomSheet',
  props: { open: Boolean, onClosed: { type: Function, default: undefined } },
  setup(_props, { slots }) {
    return () =>
      h('div', [
        h('h2', slots.title?.()),
        h('div', { class: 'content' }, slots.default?.()),
        h('footer', slots.footer?.()),
      ])
  },
})

const TRIAL_OVER: ReceiptsAccess = {
  until: null,
  ended: null,
  trialLeft: 0,
  trialOf: 10,
  month: '2026-11-01',
  read: 10,
  limit: 100,
}

const views: VueWrapper[] = []
function render(reason: ReceiptsClosed, othersRead: boolean, access = TRIAL_OVER): VueWrapper {
  const view = mount(ReceiptsClosedSheet, {
    props: { open: true, reason, access, othersRead },
    global: { plugins: [createAppI18n('ru')], stubs: { BottomSheet } },
  })
  views.push(view)
  return view
}
const buttons = (view: VueWrapper) => view.findAll('footer button').map((button) => button.text())

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.useRealTimers()
})

describe('«Пробные чеки закончились» (MOL-276)', () => {
  it('offers the camera first while Tesseract reads, and says it errs more', () => {
    const view = render('trial', true)
    expect(view.get('h2').text()).toBe(ru.receipts_access.sheet.trial_title)
    expect(view.get('.body').text()).toBe(
      'Вы распознали 10 чеков. Дальше читаем простым распознаванием — оно ошибается чаще, проверяйте строки. Открыть распознавание может разработчик, оплата появится позже.',
    )
    expect(buttons(view)).toEqual([
      ru.receipts_access.sheet.photograph,
      ru.purchases.manual_by_hand,
      ru.settings.feedback.label,
    ])
  })

  it('offers no camera where nobody would read the receipt', () => {
    const view = render('trial', false)
    expect(view.get('.body').text()).toContain('Покупки можно записать вручную')
    expect(buttons(view)).toEqual([ru.purchases.manual_by_hand, ru.settings.feedback.label])
  })

  it('says the month’s hundred and when it opens again, whatever was read past it', () => {
    const view = render('month', false, {
      ...TRIAL_OVER,
      until: new Date('2026-12-18T00:00:00Z'),
      trialLeft: 4,
      read: 101,
    })
    expect(view.get('h2').text()).toBe(ru.receipts_access.sheet.month_title)
    expect(view.get('.body').text()).toBe(
      'В ноябре распознано 100 чеков из 100. Снова — с 1 декабря. До тех пор покупки можно записать вручную.',
    )
  })

  it('says a paid reading ran out — never «Вы распознали 10 чеков» after a month of sixty (adversarial А2)', () => {
    // one clock the test sets: a day of another year is said with its year
    vi.useFakeTimers({ now: new Date('2026-11-19T12:00:00Z'), toFake: ['Date'] })
    const lapsed = { ...TRIAL_OVER, ended: new Date('2026-11-02T09:30:00Z'), read: 60 }
    const read = render('ended', true, lapsed)
    expect(read.get('h2').text()).toBe(ru.receipts_access.sheet.ended_title)
    expect(read.get('.body').text()).toContain(
      'Распознавание было открыто до 2 ноября. Дальше читаем простым распознаванием',
    )
    expect(read.text()).not.toContain('Вы распознали')
    expect(buttons(read)[0]).toBe(ru.receipts_access.sheet.photograph)
    const manual = render('ended', false, lapsed)
    expect(manual.get('.body').text()).toContain('Покупки можно записать вручную')
    expect(buttons(manual)).toEqual([ru.purchases.manual_by_hand, ru.settings.feedback.label])
  })

  it('names the way chosen, and leaves the going to the button that opened it', async () => {
    const view = render('trial', true)
    const footer = view.findAll('footer button')
    for (const button of footer) await button.trigger('click')
    expect(view.emitted('choose')).toEqual([['photo'], ['manual'], ['developer']])
  })
})
