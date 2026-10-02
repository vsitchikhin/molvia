<template>
  <section class="group">
    <h2 class="caption">{{ t('settings.group_data') }}</h2>
    <AppCard as="ul" list>
      <li>
        <!-- Inactive rather than disabled, as «Сохранить» is: it keeps its focus and its hint. -->
        <button
          ref="row"
          class="entry"
          type="button"
          :aria-disabled="!online || busy ? true : undefined"
          :aria-busy="busy"
          :aria-describedby="`${id}-hint`"
          @click="start"
        >
          <IconDownload class="entry-icon" aria-hidden="true" />
          <span class="entry-text">
            <span class="entry-label">{{
              busy ? t('settings.export.busy') : t('settings.export.label')
            }}</span>
            <span :id="`${id}-hint`" class="entry-hint">{{
              online ? t('settings.export.hint') : t('settings.export.offline')
            }}</span>
          </span>
        </button>
        <p v-if="failure === 'error' && online" class="failed" role="alert">
          <IconAlert aria-hidden="true" />
          <span>{{ t('settings.export.failed') }}</span>
          <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
        </p>
        <p v-else-if="failure === 'offline'" class="quiet">
          <IconCloud aria-hidden="true" />{{ t('settings.export.lost') }}
        </p>
        <AppReveal>
          <div v-if="ready" class="ready">
            <p class="ready-title">{{ t('settings.export.ready') }}</p>
            <AppButton block @click="handOverFromCard">{{
              t('settings.export.hand_over')
            }}</AppButton>
          </div>
        </AppReveal>
      </li>
      <!-- Under the copy, so the copy is one row above it (MOL-94, owner's decision В-2). -->
      <li>
        <button class="entry erase" type="button" @click="eraseOpen = true">
          <IconDelete class="entry-icon" aria-hidden="true" />
          <span class="entry-text">
            <span class="entry-label">{{ t('settings.erase.label') }}</span>
            <span class="entry-hint">{{ t('settings.erase.hint') }}</span>
          </span>
        </button>
      </li>
      <li>
        <RouterLink class="entry" :to="{ name: 'privacy' }">
          <IconShield class="entry-icon" aria-hidden="true" />
          <span class="entry-label">{{ t('privacy.title') }}</span>
          <IconChevron class="entry-chevron" aria-hidden="true" />
        </RouterLink>
      </li>
    </AppCard>
    <EraseSheet
      v-model:open="eraseOpen"
      :busy="signOut.leaving"
      :offline="!online"
      :failure="signOut.eraseFailure"
      @confirm="signOut.leave('erase')"
    />
  </section>
</template>

<script lang="ts">
import { defineComponent, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconChevron from '~icons/mdi/chevron-right'
import IconCloud from '~icons/mdi/cloud-off-outline'
import IconDelete from '~icons/mdi/delete-outline'
import IconDownload from '~icons/mdi/tray-arrow-down'
import IconShield from '~icons/mdi/shield-account-outline'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import EraseSheet from '@/components/EraseSheet.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useExport } from '@/composables/useExport'
import { useSignOutStore } from '@/stores/signOut'

/**
 * «Ваши данные» (MOL-93, В-2): the copy of everything kept, erasing all of it (MOL-94) and the page
 * that says what is kept. Turning off the log (MOL-96) joins them here.
 */
export default defineComponent({
  name: 'YourDataGroup',
  components: {
    AppButton,
    AppCard,
    AppReveal,
    EraseSheet,
    IconAlert,
    IconChevron,
    IconCloud,
    IconDelete,
    IconDownload,
    IconShield,
  },
  setup() {
    const { t } = useI18n()
    const exporting = useExport()
    const announce = useAnnouncer()
    const row = ref<HTMLButtonElement | null>(null)
    let withdraw: (() => void) | undefined
    watch([exporting.ready, exporting.failure], ([file, failure]) => {
      withdraw?.()
      withdraw = file
        ? announce?.(t('settings.export.ready'))
        : failure === 'offline'
          ? announce?.(t('settings.export.lost'))
          : undefined
    })
    onUnmounted(() => withdraw?.())
    // The button tapped goes with its block: the focus goes back to the row, not to the page.
    async function retry(): Promise<void> {
      row.value?.focus()
      await exporting.start()
    }
    function handOverFromCard(): void {
      exporting.handOver()
      row.value?.focus()
    }
    // «Удалить мои данные» leaves through the door «Выйти» does (MOL-94): closing the sheet after a
    // failure asks the server rather than drop the intent, as there.
    const signOut = useSignOutStore()
    const eraseOpen = ref(false)
    watch(eraseOpen, (open) => {
      if (!open) signOut.stay()
    })
    return { t, id: useId(), row, ...exporting, retry, handOverFromCard, signOut, eraseOpen }
  },
})
</script>

<style scoped lang="scss">
.caption {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.entry {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--touch-target-lg);
  padding: var(--space-2) var(--space-4);
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;

  &[aria-disabled='true'] {
    cursor: default;
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.entry-icon,
.entry-chevron {
  flex: none;
  width: var(--space-6);
  height: var(--space-6);
  color: var(--text-muted);
}

.entry-text {
  display: grid;
  flex: 1;
  min-width: 0;
}

.entry-label {
  flex: 1;
}

.entry[aria-disabled='true'] .entry-label {
  color: var(--text-muted);
}

.entry-hint {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

// The colour of an action that ends something, as «Выйти» beside it (MOL-57).
.erase {
  &,
  .entry-icon {
    color: var(--bad-ink);
  }
}

.failed,
.quiet {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0 var(--space-4) var(--space-3);
  font-size: var(--text-footnote);

  svg {
    flex: none;
    width: var(--space-6);
    height: var(--space-6);
  }
}

.failed {
  color: var(--bad-ink);
}

.quiet {
  color: var(--warn-ink);
}

.ready {
  display: grid;
  gap: var(--space-2);
  margin: 0 var(--space-4) var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--good-tint);
  color: var(--good-ink);
}

.ready-title {
  margin: 0;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}
</style>
