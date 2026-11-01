<template>
  <aside v-if="notice" class="notice">
    <!-- An error is the quiet card itself (MOL-180, К-13); offline sits in one. -->
    <ScreenState
      v-if="notice === 'error'"
      inline
      kind="error"
      :title="t('identity.error.title')"
      :body="t('identity.error.body')"
      :retrying="retrying"
      :attempt="failed"
      @retry="retry"
    />
    <AppCard v-else>
      <!-- Yellow, not the green of an offline trip: without an identity nothing can be saved. -->
      <ScreenState
        inline
        kind="offline"
        tone="warn"
        :title="t('identity.offline.title')"
        :body="t('identity.offline.body')"
      />
    </AppCard>
  </aside>
</template>

<script lang="ts">
import { defineComponent, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppCard from '@/components/AppCard.vue'
import ScreenState from '@/components/ScreenState.vue'
import { useAnswerWord, withoutAnswerWord } from '@/composables/useAnswerWord'
import { useActorStore } from '@/stores/actor'

/**
 * What happened to the identity, when it is something a person has to be told.
 *
 * Two cases, and they are the reason this is not a courtesy: while the identity is not up,
 * every request the app makes goes out without an owner, and the queues send nothing (MOL-56) —
 * showing nothing left a person with an app that looked normal and could not save a thing.
 *
 * **Said only where the screen says nothing of its answer** (MOL-349, owner's В-1 «б», В-2 «б»): a
 * screen's own «нет связи», its error or its strip is the one word — drawn over it, the
 * notice made two clouds and two texts, stood over the field of «Что брать» (Ф-14), and on
 * «Настройки» with the server down put a third «Повторить» over the screen's error and the salary's
 * (kit-settings-7). Where the screen has its answer and says nothing — `/actors/me` failing alone, the
 * privacy page, «Что взяли?» — the notice is the only word that the writes wait (adversarial А2).
 * The identity asks again by itself either way (`stores/actor`).
 *
 * **`lost` went with MOL-53.** A session is not the data: losing one means signing in again, and
 * whatever happens then is MOL-56's to draw, together with the screen that can act on it.
 *
 * Drawn by the shared screen state (MOL-19) as a notice of its own height: its cases are that
 * block's cases, not a second implementation of them.
 */
const NOTICES = ['error', 'offline'] as const
type Notice = (typeof NOTICES)[number]

function noticeFor(state: string): Notice | null {
  return (NOTICES as readonly string[]).includes(state) ? (state as Notice) : null
}

export default defineComponent({
  name: 'IdentityNotice',
  components: { AppCard, ScreenState },
  setup() {
    const { t } = useI18n()
    const actor = useActorStore()
    const word = useAnswerWord()
    // Its own state is no word of the screen's, or it would silence itself.
    withoutAnswerWord()

    // **Under a skeleton the notice neither comes nor goes** (self-review №4, №10, adversarial Б1, Г1):
    // what follows it, the screen's word or its answer, decides. Counted as a word, the skeleton took a
    // failed sign-in's card away at every read and the answer brought it back; letting a failure come
    // under it, the card came over the skeleton with the server down and went with the screen's own
    // error a moment later — at every launch and every screen opened while the server was down. Settled
    // once the screen under it has mounted (`flush: 'post'`): before that nobody has said or held
    // anything. **The price, named:** with `/actors/me` failing alone — rarer than a server down — the
    // card comes with a screen's first answer, which stands one card lower than its skeleton.
    const notice = ref<Notice | null>(word ? null : noticeFor(actor.state))
    function settle(): void {
      const wanted = noticeFor(actor.state)
      if (!wanted || word?.said.value) notice.value = null
      else if (word?.held.value) notice.value = notice.value ? wanted : null
      else notice.value = wanted
    }
    onMounted(settle)
    watch(() => [actor.state, word?.said.value, word?.held.value], settle, { flush: 'post' })

    // Asked quietly, the card standing with «Повторяем…» on its button (self-review №5): put to
    // `loading`, it went from under the thumb and the screen under it moved up and back.
    // A tap that failed the same way is an answer, said again (C1 of MOL-19, adversarial В2): the card
    // stands through the quiet question, so its words would not change.
    const retrying = ref(false)
    const failed = ref(0)
    async function retry(): Promise<void> {
      retrying.value = true
      try {
        await actor.retry({ quietly: true })
      } finally {
        retrying.value = false
      }
      if (actor.state === 'error') failed.value += 1
    }

    return { t, notice, retrying, failed, retry }
  },
})
</script>

<style scoped lang="scss">
.notice {
  @include appear;

  margin: var(--space-4) var(--space-4) 0;
}
</style>
