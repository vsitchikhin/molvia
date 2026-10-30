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
 *
 * A sheet's footer is its strip (MOL-211, Ф-17): the action of a refusal under the thumb, pinned with
 * the sheet's hairline and shadow, as every sheet's main action is. There any full state with buttons
 * of its own holds it — the scanner's «Нет доступа к камере» and «Проверить снова» — where a screen's
 * strip is an error's alone: a screen's notice beside its own action is not the screen's answer.
 */
export interface StateStrip {
  /** Where the holder's buttons go; `null` while there is none, or for a host without a strip. */
  target: Readonly<Ref<HTMLElement | null>>
  /** A sheet's footer: a full state with buttons of its own holds it as an error does. */
  sheet: boolean
  /** An error of the whole screen holds it. */
  held: ComputedRef<boolean>
  /** Taken by the first error to ask, and by the next once that one lets go: one «Повторить». */
  claim: (owner: symbol) => void
  release: (owner: symbol) => void
  owner: Readonly<Ref<symbol | null>>
  /**
   * An error that offers «Обновить» under its own words, holding no strip — a screen typed in
   * (`flow`, MOL-208): the row of the version steps aside for it as for one that holds the strip, or a
   * waiting version is offered twice.
   */
  offering: ComputedRef<boolean>
  offer: (owner: symbol) => void
  withdraw: (owner: symbol) => void
}

const stateStripKey: InjectionKey<StateStrip | null> = Symbol('state-strip')

export function provideStateStrip(
  target: Readonly<Ref<HTMLElement | null>> = shallowRef(null),
  { sheet = false }: { sheet?: boolean } = {},
): StateStrip {
  const owner = shallowRef<symbol | null>(null)
  const offers = shallowRef<readonly symbol[]>([])
  const strip: StateStrip = {
    target,
    sheet,
    held: computed(() => owner.value !== null),
    claim: (me) => {
      owner.value ??= me
    },
    release: (me) => {
      if (owner.value === me) owner.value = null
    },
    owner,
    offering: computed(() => offers.value.length > 0),
    offer: (me) => {
      if (!offers.value.includes(me)) offers.value = [...offers.value, me]
    },
    withdraw: (me) => {
      if (offers.value.includes(me)) offers.value = offers.value.filter((one) => one !== me)
    },
  }
  provide(stateStripKey, strip)
  return strip
}

/** The strip of the screen or the sheet around, or nothing — the kit, a block on its own. */
export function useStateStrip(): StateStrip | null {
  return inject(stateStripKey, null)
}
