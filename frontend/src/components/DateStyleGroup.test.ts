import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import DateStyleGroup from '@/components/DateStyleGroup.vue'
import { DATE_STYLE_KEY, installLocale, useLocale } from '@/composables/useLocale'
import { i18n, loadDictionary } from '@/i18n'
import en from '@/i18n/en.json'

// The app's own i18n, not a test's: a choice moves the one the app speaks, and the group is drawn by it.
const views: VueWrapper[] = []
function render(component: Component): VueWrapper {
  const view = mount(component, { global: { plugins: [i18n] } })
  views.push(view)
  return view
}

function checked(view: VueWrapper): string[] {
  return view
    .findAll('input')
    .filter((input) => (input.element as HTMLInputElement).checked)
    .map((input) => input.attributes('value') ?? '')
}

beforeEach(async () => {
  // Both dictionaries here before a tap (MOL-337): a choice is then spoken within one flush, as on a phone
  // whose precache holds them.
  await Promise.all([loadDictionary('ru'), loadDictionary('en')])
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ru-RU'])
  await useLocale().choose('device')
  await useLocale().chooseStyle('gb')
  localStorage.clear()
  sessionStorage.clear()
  // Spoken as the app starts: the device's language, which the module took before the phone was set.
  await installLocale()
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.restoreAllMocks()
})

describe('DateStyleGroup', () => {
  it('names each order by a day and an hour written in it, British first', async () => {
    await useLocale().choose('en')
    const view = render(DateStyleGroup)
    expect(view.get('h2').text()).toBe(en.settings.group_date_style)
    expect(view.findAll('.segment').map((segment) => segment.text())).toEqual([
      '16 Nov, 14:05',
      'Nov 16, 2:05 PM',
    ])
    expect(checked(view)).toEqual(['gb'])
    expect(view.get('.hint').text()).toBe(en.settings.date_style.hint)
  })

  it('a tap moves every date of the screens to the American order', async () => {
    await useLocale().choose('en')
    const view = render(DateStyleGroup)
    await view.get('input[value="us"]').setValue(true)
    await flushPromises()
    expect(i18n.global.locale.value).toBe('en-US')
    expect(localStorage.getItem(DATE_STYLE_KEY)).toBe('us')
    expect(checked(view)).toEqual(['us'])
  })
})
