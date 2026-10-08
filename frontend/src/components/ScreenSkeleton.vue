<template>
  <div class="skeleton">
    <p v-if="!announce" class="hidden" role="status">{{ t('state.loading') }}</p>

    <div ref="bars" class="bars" aria-hidden="true">
      <SkeletonPart v-if="groups?.length" kind="lines" :widths="groups" />
      <slot />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onBeforeUnmount, onMounted, ref, warn, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import SkeletonPart, { isWidths } from '@/components/SkeletonPart.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'

/**
 * Loading drawn as the content that is coming, not as a spinner: the screen must not jump
 * when the data arrives. The frame says «Loading…», hides its bars from a screen reader and keeps
 * the screen's rhythm — 8 between its parts, 24 above a caption that is not the first (Ф-13,
 * MOL-178); the shape is the screen's, put in the slot in the order the answer will stand: the kit's
 * parts (`SkeletonPart`) and between them what is the screen's own — the five squares of the rating
 * scale — in bars of `skeleton-bar`, which breathe by their colour.
 *
 * `groups` is the shape from before the parts: one width per group, in percent, drawn as pairs of
 * bars in a card (`SkeletonPart kind="lines"`), and the slot after it. The screens trade it for the
 * shape of their answer in their own tasks (owner's В-1 «а»).
 *
 * No `aria-busy`: a screen reader holds back what changes inside a busy region until it is
 * no longer busy, and nothing ever clears it here — the skeleton is simply removed — so the
 * «Loading…» it wraps would never be read.
 */
export default defineComponent({
  name: 'ScreenSkeleton',
  components: { SkeletonPart },
  props: {
    groups: {
      type: Array as PropType<number[]>,
      default: undefined,
      validator: isWidths,
    },
  },
  setup() {
    const { t } = useI18n()
    // A frame with no shape says «Loading…» over nothing — the invisible skeleton of Н-5, which no
    // type and no test would see once `groups` stopped being required (adversarial А4). Read from what
    // was drawn, not from what was passed: a slot of `<SkeletonPart v-if="known">` is passed and draws
    // nothing (adversarial Б4).
    const bars = ref<HTMLElement | null>(null)
    // Said in the app's live region when there is one, and taken back when loading is over —
    // «Loading…» left in the region would be read under the answer (MOL-19, П-2, C3).
    const announce = useAnnouncer()
    let withdraw: (() => void) | undefined
    onMounted(() => {
      withdraw = announce?.(t('state.loading'), { held: true })
      if (bars.value?.childElementCount === 0) warn('ScreenSkeleton has nothing to draw')
    })
    onBeforeUnmount(() => withdraw?.())
    return { t, announce, bars }
  },
})
</script>

<style scoped lang="scss">
.hidden {
  @include visually-hidden;
}

.bars {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* 24 above a caption that is not the first, as on a screen: the frame's rhythm, not the part's — the
   part stands on its own in the kit, under the answer it stands for. */
:slotted(.skeleton-caption:not(:first-child)) {
  margin-top: var(--space-4);
}
</style>
