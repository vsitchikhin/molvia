<template>
  <li class="item">
    <label class="row">
      <span class="label">{{ label }}</span>
      <AppSwitch
        :checked="checked"
        :inactive="inactive"
        :aria-describedby="described"
        @toggle="(on: boolean) => $emit('toggle', on)"
      />
    </label>
    <p :id="`${id}-hint`" class="hint">{{ hint }}</p>
    <p v-if="saveFailed" class="failed" role="alert">
      <IconAlert aria-hidden="true" />{{ t('settings.tap.save_failed') }}
    </p>
  </li>
</template>

<script lang="ts">
import { computed, defineComponent, useId } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAlert from '~icons/mdi/alert-circle-outline'
import AppSwitch from '@/components/AppSwitch.vue'

/**
 * One kind of the bot's messages on the page «Бот» (MOL-129, В-2): its switch, saved on the tap, and
 * what it does. Inactive while saving, without a connection, or under a block of the bot — which the
 * page says once for every switch and names to a screen reader here through `notedBy`.
 */
export default defineComponent({
  name: 'BotSwitchRow',
  components: { AppSwitch, IconAlert },
  props: {
    label: { type: String, required: true },
    hint: { type: String, required: true },
    checked: { type: Boolean, required: true },
    inactive: { type: Boolean, default: false },
    saveFailed: { type: Boolean, default: false },
    /** The page's own lines about every switch at once — the block, no connection — by their ids. */
    notedBy: { type: Array as PropType<readonly string[]>, default: () => [] },
  },
  emits: { toggle: (on: boolean) => typeof on === 'boolean' },
  setup(props) {
    const { t } = useI18n()
    const id = useId()
    const described = computed(() => [`${id}-hint`, ...props.notedBy].join(' '))
    return { t, id, described }
  },
})
</script>

<style scoped lang="scss">
.item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: var(--touch-target);
  cursor: pointer;
}

.label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.failed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  color: var(--bad-ink);
  font-size: var(--text-footnote);

  svg {
    @include icon;

    font-size: var(--icon-sm);
  }
}
</style>
