import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { POLICY_VERSION, consentNeeded } from '@molvia/model'
import { api } from '@/api'
import { reportFailure } from '@/failures'
import { useActorStore } from '@/stores/actor'
import { read, write } from '@/stores/storage'

/** Whether the edition this owner accepted is known, being asked about, or could not be. */
export type ConsentState = 'idle' | 'loading' | 'ready' | 'error' | 'offline'

/** `molvia.consent.<owner>`, so «Выйти» and erasure sweep it with the owner's other drawers. */
function keyOf(owner: string): string {
  return `molvia.consent.${owner}`
}

function recall(owner: string): number | null {
  const kept = Number(read(keyOf(owner)))
  return Number.isInteger(kept) && kept >= 1 ? kept : null
}

/**
 * The consent to the terms and the privacy page (MOL-95): which edition the owner the server named
 * has accepted, and whether the door must stay shut on the screen that asks for it.
 *
 * **The question is this build's** (Р-3): the person accepts the text the phone shows, and an
 * edition is asked about when the one accepted is older than this build's `POLICY_VERSION`. A phone
 * that has not updated does not ask about a text it cannot show.
 *
 * **The device remembers the edition it heard** (Р-6), filed under the owner: remembering the current
 * one, the door opens with the identity and asks nothing more — a request in front of every launch
 * would be a skeleton in front of every launch. Remembering an older one, or none, the door waits
 * for the server: an edition this device never heard of may have been accepted on another one.
 *
 * **Only an identity the server has just named is asked about.** Offline, the app opens on the
 * drawer as it always has (MOL-56), and the screen comes with the next answer, not from memory.
 */
export const useConsentStore = defineStore('consent', () => {
  const actor = useActorStore()
  const owner = computed(() => (actor.state === 'ready' ? (actor.actor?.id ?? null) : null))
  /** Whose `accepted` it is: an answer about the owner before is no answer about this one. */
  const of = ref<string | null>(null)
  const accepted = ref<number | null>(null)
  const state = ref<ConsentState>('idle')
  const accepting = ref(false)
  /** What became of the last «Принимаю», for the screen to say. */
  const failure = ref<'error' | 'offline' | null>(null)
  /**
   * «Мне 16 лет или больше», ticked. Here and not in the step (adversarial А4): the step's own links
   * lead to `/terms` and `/privacy`, which `App.vue` draws in the login's place, and the step comes
   * back mounted anew — the tick the person gave before reading went with it. Held for the page's
   * life and for this owner only; never sent and never kept.
   */
  const aged = ref(false)
  /** Bumped by every new question, so an answer about a question since replaced is dropped. */
  let revision = 0

  function settle(who: string, version: number | null): void {
    revision += 1
    // Only ever upwards here too: an older answer still on its way says nothing of a newer accept.
    const before = of.value === who ? (accepted.value ?? 0) : 0
    of.value = who
    const known = Math.max(version ?? 0, before)
    accepted.value = known >= 1 ? known : null
    state.value = 'ready'
    if (accepted.value !== null) write(keyOf(who), String(accepted.value))
  }

  async function load(who: string): Promise<void> {
    const remembered = recall(who)
    if (remembered !== null && !consentNeeded(remembered)) {
      settle(who, remembered)
      return
    }
    revision += 1
    const mine = revision
    of.value = who
    accepted.value = remembered
    state.value = 'loading'
    try {
      const answer = await api.consent()
      if (mine === revision && owner.value === who) settle(who, answer.version)
    } catch (error) {
      if (mine !== revision || owner.value !== who) return
      reportFailure(error, 'screen')
      // Read after the failure, never before it (MOL-19).
      state.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  watch(
    owner,
    (who) => {
      failure.value = null
      if (who !== of.value) aged.value = false
      if (who === null) {
        revision += 1
        of.value = null
        accepted.value = null
        state.value = 'idle'
        return
      }
      if (who !== of.value || state.value === 'idle') void load(who)
    },
    { immediate: true },
  )

  /**
   * **The door stays shut on this owner** until their edition is known and is this build's: the
   * screen that asks, or the skeleton while the server is asked, or its failure with «Повторить».
   */
  const holds = computed(
    () =>
      owner.value !== null &&
      (of.value !== owner.value || state.value !== 'ready' || consentNeeded(accepted.value)),
  )

  /**
   * **What the queues wait for: an owner not known to have accepted any edition** (adversarial А1,
   * owner's decision 04.10.2026). A newcomer left on the step, or an owner from before it, can open
   * the app with no signal — the door opens on the drawer — and record at the shelf; without this the
   * queues sent it all the moment the server named them, under a step nobody had passed and with no
   * «16 или больше» said. Nothing is lost: the writes wait on the phone and go after «Принимаю». An
   * owner who accepted an older edition sends as before (Р-4): their consent is on record.
   */
  const unaccepted = computed(() => {
    const who = owner.value
    if (who === null) return false
    // Before the store has settled on this owner, what the device remembers of them is the answer:
    // a queue asked in the same tick the server named them must not wait on a mere ordering.
    return of.value === who ? accepted.value === null : recall(who) === null
  })

  /**
   * Whether this device remembers that `who` accepted this build's edition — the question the door
   * asks while the identity is still being asked (owner's decision on review №3): without it the app
   * would be shown on the drawer and then closed under the person by the step.
   */
  function remembers(who: string): boolean {
    const kept = recall(who)
    return kept !== null && !consentNeeded(kept)
  }

  /** «Принимаю»: this build's edition, the one the screen showed. */
  async function accept(): Promise<void> {
    const who = owner.value
    if (!who || accepting.value) return
    accepting.value = true
    failure.value = null
    try {
      const answer = await api.acceptConsent(POLICY_VERSION)
      if (owner.value === who) settle(who, answer.version)
    } catch (error) {
      reportFailure(error, 'screen')
      failure.value = navigator.onLine ? 'error' : 'offline'
    } finally {
      accepting.value = false
    }
  }

  /** «Повторить», or the connection back: the question is asked again. */
  async function retry(): Promise<void> {
    const who = owner.value
    if (who && (state.value === 'error' || state.value === 'offline')) await load(who)
  }

  /**
   * **The question is asked again by the store itself** (adversarial Б2): the connection back, or the
   * app looked at again. With the app shown before the step there is no step on the screen to retry
   * it, and one failed question held the shelf's writes of an owner whose consent was on record.
   */
  window.addEventListener('online', () => void retry())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void retry()
  })

  /** Another window accepted: the door opens here too, with no request of its own. */
  window.addEventListener('storage', (event) => {
    const who = owner.value
    if (!who || event.key !== keyOf(who)) return
    const kept = recall(who)
    if (kept !== null) settle(who, kept)
  })

  return {
    state,
    accepted,
    holds,
    unaccepted,
    accepting,
    failure,
    aged,
    remembers,
    accept,
    retry,
  }
})
