import { nextTick } from 'vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { revealTypedIn } from '@/composables/useKeyboardInset'

/**
 * A field of the kit refused at a send is heard (MOL-235, adversarial А1, А2). Its error has no voice of
 * its own — it is read with the field, by `aria-describedby` — so the field must be read once the error
 * is there: **the focus goes to it after the render that draws it**, since a focus that came first read
 * the field without it. **Where the focus stands in it already** — Enter in the field, or a tap Safari
 * does not move the focus for — a focus moves nothing and a description changed under it is read by
 * nobody, so **the error's words are said** in the region, the open sheet's while one is up (MOL-181).
 *
 * `find` is asked after the render, so a screen names the first field that is wrong by its mark
 * (`[aria-invalid="true"]`) and is answered in the order of its form. The words are the field's own
 * error, the one its `aria-errormessage` names — `AppField`'s, a radio of `CategoryChips`' — no second
 * copy of them; a control with no such mark, a button that is no field of the kit, by what describes it
 * (`aria-describedby`, MOL-333): «Новая строка»'s item, focused already when its search was put away.
 *
 * **In a sheet the error is brought into sight once it has grown** (MOL-354, adversarial А1): a field
 * standing last over the pinned footer is on its edge, the error grows under it (`AppReveal`), and with
 * the focus there already — Safari's tap — nothing moved the sheet: the field marked, its reason under
 * the footer. The sheet shows the field with its error, as it shows the field typed in.
 */
export function useFieldRefusal(): (find: () => HTMLElement | null | undefined) => Promise<void> {
  const say = useAnnouncer()
  return async (find) => {
    await nextTick()
    const field = find()
    if (!field) return
    const described = (
      field.getAttribute('aria-errormessage') ??
      field.getAttribute('aria-describedby') ??
      ''
    )
      .split(/\s+/u)
      .flatMap((id) => document.getElementById(id) ?? [])
    if (document.activeElement !== field) field.focus()
    else {
      const words = described
        .map((one) => one.textContent.trim())
        .filter(Boolean)
        .join(' ')
      if (words) say?.(words)
    }
    await grown(described)
    const sheet = field.closest('dialog')
    if (sheet && document.activeElement === field) revealTypedIn(sheet)
  }
}

/** Once what describes the field has stopped growing: an error comes in by `AppReveal`'s height. */
async function grown(elements: HTMLElement[]): Promise<void> {
  const moving = elements.flatMap((one) =>
    typeof one.getAnimations === 'function' ? one.getAnimations() : [],
  )
  await Promise.allSettled(moving.map((animation) => animation.finished))
}
