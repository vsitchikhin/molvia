import {
  computed,
  inject,
  provide,
  shallowRef,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue'

/**
 * The strip of a screen, as an error of the whole screen sees it (MOL-180, К-1, Ф-15).
 *
 * A screen-wide error offers «Повторить» in the strip, over the tab bar, where every screen has its
 * main action — one height on every screen, and never a second filled button beside the screen's
 * own. While it is there the strip is the error's: the screen's `#docked` and the strip's «Вышла
 * новая версия» step aside, since the error offers «Обновить» itself (8c).
 *
 * The buttons stay the error's own — its `retry`, its `#action`, its «Сообщить о проблеме» — and
 * are only drawn in the strip, by a `Teleport` into `target`. A host with no target (the login,
 * which has no strip) leaves them where the error stands and only learns that it is held.
 */
export interface StateStrip {
  /** Where the holder's buttons go; `null` while there is none, or for a host without a strip. */
  target: Readonly<Ref<HTMLElement | null>>
  /** An error of the whole screen holds it. */
  held: ComputedRef<boolean>
  /** Taken by the first error to ask, and by the next once that one lets go: one «Повторить». */
  claim: (owner: symbol) => void
  release: (owner: symbol) => void
  owner: Readonly<Ref<symbol | null>>
}

const stateStripKey: InjectionKey<StateStrip | null> = Symbol('state-strip')

export function provideStateStrip(
  target: Readonly<Ref<HTMLElement | null>> = shallowRef(null),
): StateStrip {
  const owner = shallowRef<symbol | null>(null)
  const strip: StateStrip = {
    target,
    held: computed(() => owner.value !== null),
    claim: (me) => {
      owner.value ??= me
    },
    release: (me) => {
      if (owner.value === me) owner.value = null
    },
    owner,
  }
  provide(stateStripKey, strip)
  return strip
}

/**
 * A sheet is no strip's: an error in it keeps its buttons in the sheet, and the strip under the
 * sheet — inert while it is open — stays the screen's.
 */
export function closeStateStrip(): void {
  provide(stateStripKey, null)
}

/** The strip of the screen around, or nothing — a sheet, the kit, a block on its own. */
export function useStateStrip(): StateStrip | null {
  return inject(stateStripKey, null)
}
