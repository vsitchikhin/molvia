import { nextTick } from 'vue'
import { useAnnouncer } from '@/composables/useAnnouncer'

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
 * error, `<id>-error` of `AppField`: no second copy of them.
 */
export function useFieldRefusal(): (find: () => HTMLElement | null | undefined) => Promise<void> {
  const say = useAnnouncer()
  return async (find) => {
    await nextTick()
    const field = find()
    if (!field) return
    if (document.activeElement !== field) {
      field.focus()
      return
    }
    const words = document.getElementById(`${field.id}-error`)?.textContent.trim()
    if (words) say?.(words)
  }
}
