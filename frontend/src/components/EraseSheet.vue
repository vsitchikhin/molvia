<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('erase.title') }}</template>

    <p class="words">{{ t('erase.goes') }}</p>
    <p class="words">{{ t('erase.stays') }}</p>
    <p class="words">{{ t('erase.devices') }}</p>
    <p class="final">{{ t('erase.final') }}</p>
    <p v-if="offline" class="warn">{{ t('erase.offline') }}</p>
    <!-- Keys written whole: one built from a string is seen by neither the linter nor vue-tsc. -->
    <p v-else-if="failure" class="failed" role="alert">
      {{
        failure === 'offline'
          ? t('erase.offline')
          : failure === 'signed_out'
            ? t('erase.signed_out')
            : failure === 'unknown'
              ? t('erase.unknown')
              : t('erase.error')
      }}
    </p>

    <template #footer>
      <AppButton
        variant="danger-ghost"
        block
        :busy="busy"
        :busy-label="t('erase.confirm_busy')"
        :inactive="offline"
        @click="$emit('confirm')"
      >
        {{ t('erase.confirm') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'

/**
 * «Удалить все ваши данные?» (MOL-94): the bot's question for `/delete`, word for word in what goes
 * and what stays — the privacy rules make both doors name all of it — and one thing the bot cannot
 * say: what happens to the copies on this device and on the others. One press, as in the bot
 * (owner's decision В-4); the row and the sheet are already two taps.
 *
 * What has not been sent is not counted here, as «Выйти» counts it: everything goes, so the number
 * would help no decision.
 */
export default defineComponent({
  name: 'EraseSheet',
  components: { AppButton, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    busy: { type: Boolean, default: false },
    /** No connection now: nothing can be erased, and the sheet says so before a tap. */
    offline: { type: Boolean, default: false },
    failure: {
      type: String as PropType<'offline' | 'error' | 'signed_out' | 'unknown' | null>,
      default: null,
    },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    confirm: () => true,
  },
  setup() {
    return { t: useI18n().t }
  },
})
</script>

<style scoped lang="scss">
.words,
.final,
.warn,
.failed {
  margin: 0;
  font-size: var(--text-callout);
}

.words {
  margin-bottom: var(--space-3);
  color: var(--text-muted);
}

.final {
  font-weight: var(--weight-medium);
}

.warn,
.failed {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius);
}

.warn {
  background: var(--warn-tint);
  color: var(--warn-ink);
}

.failed {
  background: var(--bad-tint);
  color: var(--bad-ink);
}
</style>
