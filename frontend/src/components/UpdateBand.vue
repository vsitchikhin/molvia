<template>
  <div v-if="phase !== 'none'" class="band" :class="{ failed: phase === 'failed' }">
    <template v-if="phase === 'failed'">
      <p class="title">{{ t('update.failed.title') }}</p>
      <p class="body">{{ t('update.failed.body') }}</p>
    </template>
    <template v-else>
      <p class="title">{{ t('update.ready') }}</p>
      <AppButton variant="secondary" class="apply" :busy="phase === 'applying'" @click="apply">
        <template #icon><IconUpdate /></template>
        {{ t('update.apply') }}
      </AppButton>
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconUpdate from '~icons/mdi/update'
import AppButton from '@/components/AppButton.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { usePwaUpdate, type PwaUpdate, type UpdatePhase } from '@/pwaUpdate'

/**
 * «Вышла новая версия · Обновить» (MOL-132): a version waits, and the person takes it — the one way
 * a page that stays on the screen gets it, since the quiet way waits for the background (MOL-46).
 * Nothing is lost to the reload the button asks for: the queue and the drafts live on the device.
 *
 * Above the tab bar, the top row of the screen's pinned strip (owner's decision В-1, Р-6): the
 * screen's own main action stays under it, nearer the thumb, and what floats over the list rises
 * above it. Under an open sheet it is seen and not pressed — a modal dialog leaves the page inert,
 * which is what keeps a reload from under the finger.
 *
 * No «×»: it is quiet, and goes with the version (Р-4). A version that did not take asks for the
 * app to be closed all the way, in the words of both phones — a guess from the user agent is wrong
 * on an iPad, which calls itself a Mac (Р-3).
 */
/** What each version's state last had said out loud, across every strip and screen. */
const said = new WeakMap<PwaUpdate, UpdatePhase>()

export default defineComponent({
  name: 'UpdateBand',
  components: { AppButton, IconUpdate },
  setup() {
    const { t } = useI18n()
    const update = usePwaUpdate()
    const announce = useAnnouncer()
    const phase = computed(() => update.phase.value)

    // Said as it comes and as it fails — once for the app, not once for each strip: a screen
    // draws its own, born with the version already waiting, and a strip that spoke only of what it
    // saw change said nothing at all (adversarial Д1). What was said is kept by the version's own
    // state, the one object every strip reads.
    let unsay: (() => boolean) | undefined
    let saying: UpdatePhase | undefined
    watch(
      phase,
      (now) => {
        if (now !== 'ready' && now !== 'failed') return
        if (said.get(update) === now) return
        said.set(update, now)
        unsay?.()
        saying = now
        unsay = announce?.(now === 'failed' ? t('update.failed.title') : t('update.ready'))
      },
      { immediate: true },
    )
    // Gone before its words reached the region — the screen changed as the version came: they
    // were never said, and the strip the next screen draws says them (review С-13).
    onBeforeUnmount(() => {
      if (unsay?.() === false && said.get(update) === saying) said.delete(update)
    })

    return {
      t,
      phase,
      apply: () => {
        update.apply()
      },
    }
  },
})
</script>

<style scoped lang="scss">
.band {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  min-height: var(--touch-target);
  padding: var(--space-2) 0;
}

.title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  overflow-wrap: anywhere;
}

.body {
  flex-basis: 100%;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  line-height: var(--leading-body);
  overflow-wrap: anywhere;
}

.apply {
  flex: none;
}
</style>
