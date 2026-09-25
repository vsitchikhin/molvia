<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('sign_out.title') }}</template>

    <p class="words">{{ t('sign_out.body') }}</p>
    <p v-if="unsent > 0" class="warn">{{ t('sign_out.unsent', { n: unsent }, unsent) }}</p>
    <p v-if="offline" class="warn">{{ t('sign_out.offline') }}</p>
    <p v-else-if="failure" class="failed" role="alert">{{ t(`sign_out.${failure}`) }}</p>

    <template #footer>
      <AppButton
        variant="danger-ghost"
        block
        :disabled="busy"
        :inactive="offline"
        @click="$emit('confirm')"
      >
        {{ t('sign_out.confirm') }}
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
 * «Выйти из Molvia на этом устройстве?» (MOL-57, owner's decisions Q1 and Q2): what goes — every
 * copy on this phone — and what stays — everything on the server, back with the next login.
 *
 * **What has not been sent is counted aloud**, because that is the one thing erased that no login
 * brings back: a purchase in the trip queue, a rating in the drafts, an unsaved settings form. The
 * app sends them by itself whenever it can, so the number is usually zero, and when it is not the
 * person decides with it in front of them.
 */
export default defineComponent({
  name: 'SignOutSheet',
  components: { AppButton, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    /** Writes this device holds that the server does not have yet. */
    unsent: { type: Number, default: 0 },
    busy: { type: Boolean, default: false },
    /** No connection now: the way out cannot be taken, and the sheet says so before a tap. */
    offline: { type: Boolean, default: false },
    failure: { type: String as PropType<'offline' | 'error' | null>, default: null },
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
.warn,
.failed {
  margin: 0;
  font-size: var(--text-callout);
}

.words {
  color: var(--text-muted);
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
