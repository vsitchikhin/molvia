import {
  computed,
  inject,
  onBeforeUnmount,
  provide,
  shallowRef,
  watch,
  type ComputedRef,
  type InjectionKey,
} from 'vue'

/**
 * What the screen says itself of its answer (MOL-349, owner's В-1 «б»): a state of no connection or of
 * an error, a strip of the connection — the screen's word — or a skeleton, the answer on its way.
 *
 * The notice of an identity not checked (`IdentityNotice`) stood over the screen's own «нет связи»,
 * two clouds and two texts, and on «Что брать» over the field that chooses the answer (Ф-14). It now
 * speaks only where the screen says nothing of the kind.
 *
 * **A skeleton is no word, it holds the notice as it is** (self-review №4, adversarial Б1): after it
 * comes the screen's «нет связи» or its answer, and which one nobody knows yet. Counted as a word, it
 * took the notice of a failed sign-in away at every read — a month turned, a search typed — and the
 * answer brought it back, the control the read was chosen by going up and down under the thumb.
 *
 * Provided by the frame (`AppScreen`); a sheet provides none (`withoutAnswerWord`) — it is mounted
 * shut with its screen, and a state inside it is not the screen's word.
 */
export interface AnswerWord {
  /** A state or a strip of the screen says what became of its answer. */
  said: ComputedRef<boolean>
  /** A skeleton stands: the answer is on its way. */
  held: ComputedRef<boolean>
  say: (owner: symbol, how: 'says' | 'holds') => void
  unsay: (owner: symbol) => void
}

const answerWordKey: InjectionKey<AnswerWord | null> = Symbol('answer-word')

export function provideAnswerWord(): AnswerWord {
  const speakers = shallowRef<ReadonlyMap<symbol, 'says' | 'holds'>>(new Map())
  const has = (how: 'says' | 'holds') => [...speakers.value.values()].includes(how)
  const word: AnswerWord = {
    said: computed(() => has('says')),
    held: computed(() => has('holds')),
    say: (me, how) => {
      if (speakers.value.get(me) !== how) speakers.value = new Map(speakers.value).set(me, how)
    },
    unsay: (me) => {
      if (!speakers.value.has(me)) return
      const next = new Map(speakers.value)
      next.delete(me)
      speakers.value = next
    },
  }
  provide(answerWordKey, word)
  return word
}

/** What is under it says nothing for the screen: a sheet, the notice's own state. */
export function withoutAnswerWord(): void {
  provide(answerWordKey, null)
}

/** The frame's word, or nothing — the kit, a block on its own, the login. */
export function useAnswerWord(): AnswerWord | null {
  return inject(answerWordKey, null)
}

/**
 * Says the screen's word while `active` holds — or, `holds`, keeps the notice as it is — and takes it
 * back with the component. Called by a component inside the frame's slot: a screen is the frame's
 * parent, and from its own `setup` it hears nothing (adversarial А1).
 */
export function sayAnswerWord(active: () => boolean, how: 'says' | 'holds' = 'says'): void {
  const word = useAnswerWord()
  if (!word) return
  const me = Symbol('speaker')
  watch(
    active,
    (now) => {
      if (now) word.say(me, how)
      else word.unsay(me)
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    word.unsay(me)
  })
}
