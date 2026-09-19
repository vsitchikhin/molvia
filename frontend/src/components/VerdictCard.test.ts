import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ERROR, ISSUE } from '@molvia/model'
import type { PendingVerdict } from '@molvia/model'
import VerdictCard from '@/components/VerdictCard.vue'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import type { VerdictDraft } from '@/stores/verdictDrafts'

const milk: PendingVerdict = {
  itemId: 'cccccccc-0000-4000-8000-000000000001',
  name: 'Молоко «Ашхар»',
  placeName: 'Ереван Сити',
  boughtAt: new Date(2026, 8, 12, 17, 40),
}

function render(draft?: VerdictDraft) {
  return mount(VerdictCard, {
    props: { card: milk, draft },
    global: { plugins: [createAppI18n('en')] },
    attachTo: document.body,
  })
}

function button(view: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> {
  const found = view.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`no button «${text}»`)
  return found
}

const key = (view: VueWrapper, n: number) =>
  view.get<HTMLButtonElement>(`button[aria-label="Rating ${String(n)} out of 5"]`)

describe('VerdictCard', () => {
  it('asks about the item, where and when it was bought', () => {
    const view = render()

    expect(view.get('h2').text()).toContain('Молоко «Ашхар»')
    expect(view.get('h2').text()).toContain(en.verdict.question_tail)
    expect(view.get('.context').text()).toBe('Sep 12 · Ереван Сити')
    view.unmount()
  })

  it('five digits, each named for a screen reader; a second tap takes the choice back', async () => {
    const view = render()

    await key(view, 3).trigger('click')
    expect(key(view, 3).attributes('aria-pressed')).toBe('true')
    expect(view.findAll('[aria-pressed="true"]')).toHaveLength(1)

    await key(view, 4).trigger('click')
    expect(key(view, 3).attributes('aria-pressed')).toBe('false')

    await key(view, 4).trigger('click')
    expect(view.findAll('[aria-pressed="true"]')).toHaveLength(0)
    view.unmount()
  })

  it('5: without a score the button says what is missing, stays enabled and sends nothing', async () => {
    const view = render()
    const save = button(view, en.verdict.save_disabled)

    expect(save.attributes('disabled')).toBeUndefined()
    await save.trigger('click')

    expect(view.emitted('save')).toBeUndefined()
    view.unmount()
  })

  it('saves the score and the words as typed', async () => {
    const view = render()
    await key(view, 2).trigger('click')
    await view.get('textarea').setValue('Кислит\nна второй день')
    await button(view, en.verdict.save).trigger('click')

    expect(view.emitted('save')).toEqual([[2, 'Кислит\nна второй день']])
    view.unmount()
  })

  it('6: a double tap saves once', async () => {
    const view = render()
    await key(view, 5).trigger('click')
    await button(view, en.verdict.save).trigger('click')
    await button(view, en.verdict.save).trigger('click')

    expect(view.emitted('save')).toHaveLength(1)
    view.unmount()
  })

  it('empty lines in a row fold to one instead of being refused by the server', async () => {
    const view = render()
    await key(view, 3).trigger('click')
    await view.get('textarea').setValue('Сверху\n\n\n\nснизу')
    await button(view, en.verdict.save).trigger('click')

    expect(view.emitted('save')).toEqual([[3, 'Сверху\n\nснизу']])
    view.unmount()
  })

  it('F5: a tab, a line separator and a line of invisible marks become what they look like', async () => {
    const view = render()
    const separator = String.fromCodePoint(0x2028)
    const invisible = String.fromCodePoint(0x200b)
    await key(view, 4).trigger('click')
    await view
      .get('textarea')
      .setValue(`Вкусно,\tно дорого${separator}второй раз\n${invisible}\n${invisible}\nещё`)
    await button(view, en.verdict.save).trigger('click')

    expect(view.emitted('save')).toEqual([[4, 'Вкусно, но дорого\nвторой раз\n\nещё']])
    view.unmount()
  })

  it('R3: braille-blank lines and direction marks are tidied by the model, not refused', async () => {
    const view = render()
    const blank = String.fromCodePoint(0x2800)
    const [open, close] = [String.fromCodePoint(0x2068), String.fromCodePoint(0x2069)]
    await key(view, 4).trigger('click')
    await view.get('textarea').setValue(`Советовал ${open}Арам${close}\n${blank}\n${blank}\nне зря`)
    await button(view, en.verdict.save).trigger('click')

    expect(view.emitted('save')).toEqual([[4, 'Советовал Арам\n\nне зря']])
    view.unmount()
  })

  it('С-9: the scale is named «Rating», not the section', () => {
    const view = render()
    expect(view.get('[role="group"]').attributes('aria-label')).toBe(en.verdict.scale_group)
    view.unmount()
  })

  it('10: the field holds the review to its bound', () => {
    const view = render()
    expect(view.get('textarea').attributes('maxlength')).toBe('500')
    view.unmount()
  })

  it('reports every change, so the phone keeps what is being typed', async () => {
    const view = render()
    await key(view, 1).trigger('click')
    await view.get('textarea').setValue('Пахнет')

    expect(view.emitted('change')).toEqual([
      [1, ''],
      [1, 'Пахнет'],
    ])
    view.unmount()
  })

  it('opens with what the phone kept, and a refusal under the field until it is edited', async () => {
    const view = render({
      card: milk,
      score: 2,
      review: 'Пахнет',
      state: 'typing',
      error: ERROR.INVALID_SCORE,
    })

    expect(key(view, 2).attributes('aria-pressed')).toBe('true')
    expect((view.get('textarea').element as HTMLTextAreaElement).value).toBe('Пахнет')
    expect(view.text()).toContain(en.error.invalid_score)

    await view.get('textarea').setValue('Пахнет крахмалом')
    expect(view.text()).not.toContain(en.error.invalid_score)
    view.unmount()
  })

  it('a refusal that is a message to a developer reads as «something went wrong»', () => {
    const view = render({
      card: milk,
      score: 2,
      review: 'x',
      state: 'typing',
      error: ISSUE.TEXT_NOT_VISIBLE,
    })

    expect(view.text()).toContain(en.error.internal)
    expect(view.text()).not.toContain(ISSUE.TEXT_NOT_VISIBLE)
    view.unmount()
  })

  it('takes the focus on arrival only when asked', () => {
    const quiet = render()
    expect(document.activeElement?.tagName).not.toBe('H2')
    quiet.unmount()

    const moved = mount(VerdictCard, {
      props: { card: milk, focusOnMount: true },
      global: { plugins: [createAppI18n('en')] },
      attachTo: document.body,
    })
    expect(document.activeElement).toBe(moved.get('h2').element)
    moved.unmount()
  })
})
