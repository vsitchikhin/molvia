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
 * Whether the screen says itself what became of its answer (MOL-349, owner's В-1 «б»): its skeleton
 * — the answer on its way — a state of no connection or of an error, a strip of the connection.
 *
 * The notice of an identity not checked (`IdentityNotice`) stood over the screen's own «нет связи»,
 * two clouds and two texts, and on «Что брать» over the field that chooses the answer (Ф-14). It now
 * speaks only where the screen says nothing of the kind — the privacy page, the terms. The skeleton is
 * in the list on purpose: a screen draws it first and its «нет связи» after the failure, and a notice
 * put in for the moment between would push the field down and back.
 *
 * Provided by the frame (`AppScreen`); a sheet provides none (`withoutAnswerWord`) — it is mounted
 * shut with its screen, and a state inside it is not the screen's word.
 */
export interface AnswerWord {
  said: ComputedRef<boolean>
  say: (owner: symbol) => void
  unsay: (owner: symbol) => void
}

const answerWordKey: InjectionKey<AnswerWord | null> = Symbol('answer-word')

export function provideAnswerWord(): AnswerWord {
  const speakers = shallowRef<readonly symbol[]>([])
  const word: AnswerWord = {
    said: computed(() => speakers.value.length > 0),
    say: (me) => {
      if (!speakers.value.includes(me)) speakers.value = [...speakers.value, me]
    },
    unsay: (me) => {
      if (speakers.value.includes(me)) speakers.value = speakers.value.filter((one) => one !== me)
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
 * Says the screen's word while `active` holds, and takes it back with the component. Called by a
 * component inside the frame's slot: a screen is the frame's parent, and from its own `setup` it hears
 * nothing (adversarial А1).
 */
export function sayAnswerWord(active: () => boolean): void {
  const word = useAnswerWord()
  if (!word) return
  const me = Symbol('speaker')
  watch(
    active,
    (now) => {
      if (now) word.say(me)
      else word.unsay(me)
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    word.unsay(me)
  })
}
