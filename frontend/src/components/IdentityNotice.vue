<template>
  <aside v-if="shown" class="notice">
    <AppCard>
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
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import AppCard from '@/components/AppCard.vue'
import ScreenState from '@/components/ScreenState.vue'
import { useAnswerWord, withoutAnswerWord } from '@/composables/useAnswerWord'
import { useActorStore } from '@/stores/actor'

/**
 * What happened to the identity, when it is something a person has to be told.
 *
 * Opened with no connection, the app shows the owner on the device with nothing checked, and every
 * request goes out without an owner. **Said only where the screen says nothing of its answer**
 * (MOL-349, owner's В-1 «б»): a screen's own «нет связи», its strip or its skeleton is the one word
 * about the connection — drawn over it, the notice made two clouds and two texts, and on «Что брать»
 * stood over the field that chooses the answer (Ф-14). The privacy page and the terms say nothing of
 * the kind, and there it stays. What holds the queues meanwhile is their `flush()`, never this notice
 * (MOL-56).
 *
 * **An identity that could not be checked says nothing here** (MOL-349, owner's В-2 «б»): its quiet
 * card with a «Повторить» of its own stood over the screen's error and its «Повторить» — three on
 * «Настройки» (kit-settings-7). The identity asks again by itself (`stores/actor`), and the screen's
 * error is the one word.
 *
 * **`lost` went with MOL-53.** A session is not the data: losing one means signing in again, and
 * whatever happens then is MOL-56's to draw, together with the screen that can act on it.
 *
 * Drawn by the shared screen state (MOL-19) as a notice of its own height: its cases are that
 * block's cases, not a second implementation of them.
 */
export default defineComponent({
  name: 'IdentityNotice',
  components: { AppCard, ScreenState },
  setup() {
    const { t } = useI18n()
    const actor = useActorStore()
    const word = useAnswerWord()
    // Its own state is no word of the screen's, or it would silence itself.
    withoutAnswerWord()

    return {
      t,
      shown: computed(() => actor.state === 'offline' && !(word?.said.value ?? false)),
    }
  },
})
</script>

<style scoped lang="scss">
.notice {
  @include appear;

  margin: var(--space-4) var(--space-4) 0;
}
</style>
