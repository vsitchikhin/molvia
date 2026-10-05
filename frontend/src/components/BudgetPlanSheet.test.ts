import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MoneyBudgetView } from '@molvia/model'
import BudgetPlanSheet from './BudgetPlanSheet.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'

let clock = 0
const views: VueWrapper[] = []

beforeEach(() => {
  vi.restoreAllMocks()
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  setActivePinia(createPinia())
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

async function render(save: () => Promise<MoneyBudgetView>, online = true): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money/budget')
  const view = mount(BudgetPlanSheet, {
    props: {
      open: true,
      month: '2026-09',
      subject: { kind: 'savings' },
      plan: { kind: 'share', percent: 30 },
      nameOf: () => 'Savings',
      spendCurrency: 'AMD',
      online,
      save,
    },
    attachTo: document.body,
    global: { plugins: [router, createAppI18n('en')] },
  })
  views.push(view)
  // Past the moment the sheet rises: until then it takes no tap at all.
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  return view
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('dialog[open] button')].find(
    (one) => one.textContent.trim() === text,
  )
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no «${text}» in the sheet`)
  return found
}

describe('BudgetPlanSheet at work (MOL-225)', () => {
  // Adversarial Р1-А1: «Убрать план» and «Сохранить» share one write. Before, the pressed one went
  // grey and dropped the focus while «Сохранить» said «Сохраняем…» of a save nobody asked for.
  it('«Remove the plan» says «Removing the plan…» and keeps the focus; «Save» is not now and silent', async () => {
    const save = vi.fn<() => Promise<MoneyBudgetView>>(() => new Promise(() => undefined))
    await render(save)
    const remove = button(en.budget.sheet.remove)
    remove.focus()
    remove.click()
    await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ plan: null }))

    expect(remove.textContent.trim()).toBe(en.budget.sheet.removing)
    expect(remove.getAttribute('aria-busy')).toBe('true')
    expect(remove.disabled).toBe(false)
    expect(document.activeElement).toBe(remove)
    const kept = button(en.budget.sheet.save)
    expect(kept.getAttribute('aria-busy')).toBeNull()
    expect(kept.getAttribute('aria-disabled')).toBe('true')
    kept.click()
    expect(save).toHaveBeenCalledOnce()
  })

  it('«Save» says «Saving…»; «Remove the plan» beside it is not now', async () => {
    const save = vi.fn<() => Promise<MoneyBudgetView>>(() => new Promise(() => undefined))
    await render(save)
    const saving = button(en.budget.sheet.save)
    saving.click()
    await flushPromises()
    expect(saving.textContent.trim()).toBe(en.budget.sheet.saving)
    expect(saving.getAttribute('aria-busy')).toBe('true')
    const remove = button(en.budget.sheet.remove)
    expect(remove.getAttribute('aria-busy')).toBeNull()
    expect(remove.getAttribute('aria-disabled')).toBe('true')
  })
})
