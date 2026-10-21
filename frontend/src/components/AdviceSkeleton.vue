<template>
  <ScreenSkeleton>
    <SkeletonPart v-if="field" kind="field" />
    <SkeletonPart kind="caption" :width="22" />
    <!-- A card of «Брать»: its name at the size of a title, and the plate of the place and the price. -->
    <AppCard class="ghost-take">
      <span class="ghost-name"><span class="ghost-bar"></span></span>
      <span class="ghost-plate"></span>
    </AppCard>
    <SkeletonPart kind="caption" :width="44" />
    <SkeletonPart kind="rows" lead="circle" :count="1" :narrow="false" />
    <SkeletonPart kind="caption" :width="34" />
  </ScreenSkeleton>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import AppCard from '@/components/AppCard.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'

/**
 * «Что брать» while its answer is on its way (Ф-13, handoff `01`, 1j): the field's well, then the
 * groups as they will stand — a card of «Брать», a row of «Только если дёшево», the caption of «Не
 * брать нигде». The search, waiting for its first answer, draws the same without the field: what it
 * finds is laid out by the same groups.
 */
export default defineComponent({
  name: 'AdviceSkeleton',
  components: { AppCard, ScreenSkeleton, SkeletonPart },
  props: {
    field: { type: Boolean, default: false },
  },
})
</script>

<style scoped lang="scss">
/* The padding and the radius of `AdviceTakeCard`, its edge the quiet one: the verdict is not known yet. */
.ghost-take {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
}

/* The line of the name, 24 at its tight leading: a bar in its middle. */
.ghost-name {
  display: flex;
  align-items: center;
  height: calc(var(--text-title) * var(--leading-tight));
}

.ghost-bar {
  @include skeleton-bar;

  width: 58%;
  height: var(--skeleton-line);
}

/* The plate: 8 around a line of the price, 15 at its leading. */
.ghost-plate {
  @include skeleton-bar;

  height: calc(var(--text-callout) * var(--leading-snug) + 2 * var(--space-2));
  border-radius: var(--radius-sm);
}
</style>
