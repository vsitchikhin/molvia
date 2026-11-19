/// <reference lib="dom" />
import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { asBrowser } from './session'

/** The top row of a screen as `header.spec` and `large-text.spec` read it: the back button, the small title, the action. */

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

export function apart(one: Box, other: Box): boolean {
  return (
    one.right <= other.left ||
    other.right <= one.left ||
    one.bottom <= other.top ||
    other.bottom <= one.top
  )
}

/**
 * Waits until the row has settled after the scroll: the class comes first, and the column narrows
 * under the small title a frame or two later, the label following it by the observer. Read in
 * between, the label of the wide column was caught and gone by the next read.
 */
async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const width = () => document.querySelector('.leading')?.getBoundingClientRect().width
        let last = width()
        let still = 0
        const frame = () => {
          const now = width()
          still = now === last ? still + 1 : 0
          last = now
          if (still >= 3) done()
          else requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      }),
  )
}

/**
 * Scrolls until the large title is gone and the row has settled. A short screen has nothing to scroll; room
 * under it changes nothing in the row. Scrolled again until it holds: once on CI one scroll left
 * /money/categories open, «screen docked held» (run 41674793280), not reproduced — the state is waited for,
 * not supposed.
 */
export async function collapse(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'body { padding-bottom: 150vh; }' })
  await expect(async () => {
    await page.evaluate(() => {
      window.scrollTo(0, 400)
    })
    await expect(page.locator('.screen')).toHaveClass(/collapsed/, { timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  await settled(page)
}

export /** An account named so, started today with nothing on it: a screen whose row holds an action. */
async function anAccount(page: Page, name: string): Promise<string> {
  const id = randomUUID()
  const startOn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(
    new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  )
  const made = await page.request.post('/api/money/accounts', {
    headers: await asBrowser(page),
    data: {
      id,
      name,
      currency: 'AMD',
      savings: false,
      start: { amount: '0', currency: 'AMD' },
      startOn,
    },
  })
  expect(made.status(), await made.text()).toBeLessThan(300)
  return id
}

export /**
 * The action of the row, the back button and the small title, read in one frame: how far the action's
 * words stand past its box's padding either side, in fractions (MOL-336: «Править» was 60 px, its words
 * 63 and its padding 32), and whether the small title is cut — its words wider than its box.
 */
async function actionRow(
  page: Page,
): Promise<{ back: Box; small: Box; action: Box; wordsPast: number; cut: boolean; page: number }> {
  return page.evaluate(() => {
    const box = (node: Element) => {
      const { left, right, top, bottom } = node.getBoundingClientRect()
      return { left, right, top, bottom }
    }
    const words = (node: Element) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      return [...range.getClientRects()]
    }
    const back = document.querySelector('.back')
    const small = document.querySelector('.small')
    const action = document.querySelector('.trailing button')
    if (!back || !small || !action)
      throw new Error('no back button, small title or action in the row')
    const style = getComputedStyle(action)
    const outer = action.getBoundingClientRect()
    const lines = words(action)
    const titleLines = words(small)
    return {
      back: box(back),
      small: box(small),
      action: box(action),
      wordsPast: Math.max(
        Math.max(...lines.map((line) => line.right)) -
          (outer.right - parseFloat(style.paddingRight)),
        outer.left + parseFloat(style.paddingLeft) - Math.min(...lines.map((line) => line.left)),
      ),
      cut:
        Math.max(...titleLines.map((line) => line.right)) - small.getBoundingClientRect().right >
        0.01,
      page: document.documentElement.scrollWidth,
    }
  })
}
