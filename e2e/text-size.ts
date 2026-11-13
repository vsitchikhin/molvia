import type { Page } from '@playwright/test'

/**
 * The system's text size, as Android's 150 % and 200 % reach the page: the root's, which every size of the app is in
 * (MOL-321, MOL-334). Set before the page loads; 100 % sets nothing.
 */
export async function textAt(page: Page, size: string): Promise<void> {
  if (size === '100%') return
  await page.addInitScript((value) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = `html { font-size: ${value} }`
      document.head.append(style)
    })
  }, size)
}
