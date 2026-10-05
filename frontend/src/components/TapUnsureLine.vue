<template>
  <!-- Not an error, a wait (MOL-96, round 3, №7): quiet, never an alert — its words go through the
       app's one live region, or are read by the focus it takes (`useUnsureFocus`). -->
  <div class="unsure" tabindex="-1">
    <span class="said"
      ><IconCloud aria-hidden="true" /><span>{{
        pending ? t('settings.tap.waiting') : t('settings.tap.unsure')
      }}</span></span
    >
    <AppButton v-if="online" variant="ghost" @click="$emit('retry')">{{
      t('state.retry')
    }}</AppButton>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCloud from '~icons/mdi/cloud-off-outline'
import AppButton from '@/components/AppButton.vue'

/**
 * The line that stands where a switch saved on the tap was while its change is unsure (MOL-96): the
 * answer of the last change was lost, or another screen's write is still on its way (`pending`).
 * «Повторить» asks at once; without a connection the check waits for it, and there is no button.
 */
export default defineComponent({
  name: 'TapUnsureLine',
  components: { AppButton, IconCloud },
  props: {
    pending: { type: Boolean, default: false },
    online: { type: Boolean, required: true },
  },
  emits: { retry: () => true },
  setup() {
    const { t } = useI18n()
    return { t }
  },
})
</script>

<style scoped lang="scss">
.unsure {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  color: var(--warn-ink);
  font-size: var(--text-footnote);

  &:focus-visible {
    @include focus-ring;
  }
}

// An icon and its words as one item of the line: the words wrap beside the icon, and the button
// goes under them once the line is full (Р3-А4).
.said {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;

  svg {
    @include icon;

    font-size: var(--icon-sm);
  }
}
</style>
