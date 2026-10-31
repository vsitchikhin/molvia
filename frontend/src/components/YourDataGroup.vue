<template>
  <section class="group">
    <SectionCaption>{{ t('settings.group_data') }}</SectionCaption>
    <AppCard as="ul" list>
      <!-- First in the group (MOL-96): what is counted about the person, before what is done with it. -->
      <li>
        <!-- Drawn as the rows below it, its words beside the icon (adversarial А4). -->
        <div class="entry setting">
          <IconStatistics class="entry-icon" aria-hidden="true" />
          <span class="entry-text">
            <label class="entry-label" :for="`${id}-analytics-switch`">{{
              t('settings.analytics.label')
            }}</label>
            <span :id="`${id}-analytics`" class="entry-hint">{{
              t('settings.analytics.hint')
            }}</span>
            <span
              v-if="!analytics.online.value"
              :id="`${id}-analytics-offline`"
              class="entry-hint"
              >{{ t('settings.tap.offline') }}</span
            >
          </span>
          <!-- Only an answer is drawn (adversarial А1): «not known yet» drawn off read as an
               objection nobody made — nor a change whose answer was lost (round 2, Р2-А1). The
               place is held, so the words do not move when it comes; it is not faded in — an
               answer read is not played (MOL-151). -->
          <span ref="switchSlot" class="switch-slot">
            <AppSwitch
              v-if="analytics.off.value !== undefined && !analytics.unsure.value"
              :id="`${id}-analytics-switch`"
              :checked="!analytics.off.value"
              :inactive="analytics.saving.value || !analytics.online.value"
              :aria-describedby="
                analytics.online.value
                  ? `${id}-analytics`
                  : `${id}-analytics ${id}-analytics-offline`
              "
              @toggle="(on: boolean) => analytics.choose(!on)"
            />
          </span>
        </div>
        <TapUnsureLine
          v-if="analytics.unsure.value"
          ref="unsureLine"
          class="under"
          :pending="analytics.pending.value"
          :online="analytics.online.value"
          :aria-describedby="`${id}-analytics`"
          @retry="analytics.retry"
        />
        <!-- The icon and the words are one box: beside each other, the button under them once
             the line is full (Р2-А3, Р3-А4). -->
        <p
          v-else-if="analytics.online.value && analytics.saveFailed.value"
          class="failed"
          role="alert"
        >
          <span class="said"
            ><IconAlert aria-hidden="true" /><span>{{ t('settings.tap.save_failed') }}</span></span
          >
        </p>
        <div
          v-else-if="analytics.online.value && analytics.failure.value === 'error'"
          class="failed"
        >
          <span class="said"
            ><IconAlert aria-hidden="true" /><span>{{ t('settings.tap.load_error') }}</span></span
          >
          <AppButton variant="ghost" @click="analytics.retry">{{ t('state.retry') }}</AppButton>
        </div>
      </li>
      <li>
        <!-- Inactive rather than disabled, as «Сохранить» is: it keeps its focus and its hint. It acts
             at once, so no chevron (В-14 «а»). -->
        <ListRow
          ref="row"
          class="download"
          :icon="IconDownload"
          :title="busy ? t('settings.export.busy') : t('settings.export.label')"
          :meta="online ? t('settings.export.hint') : t('settings.export.offline')"
          :inactive="!online || busy"
          :aria-busy="busy"
          @click="start"
        />
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
            <AppButton variant="secondary" block @click="handOverFromCard">{{
              t('settings.export.hand_over')
            }}</AppButton>
          </div>
        </AppReveal>
      </li>
      <!-- Under the copy, so the copy is one row above it (MOL-94, owner's decision В-2). -->
      <li>
        <ListRow
          class="erase"
          :icon="IconDelete"
          :title="t('settings.erase.label')"
          :meta="t('settings.erase.hint')"
          danger
          @click="eraseOpen = true"
        />
      </li>
    </AppCard>
    <!-- The pages go on to read, the rows above act or ask: one card never holds both (В-14 «а»), so
         they are a card of their own in the same group (MOL-215, owner's В-1 «а»). -->
    <AppCard as="ul" list class="pages">
      <li>
        <NavRow :to="{ name: 'privacy' }" :icon="IconShield" :label="t('privacy.title')" />
      </li>
      <li>
        <NavRow :to="{ name: 'terms' }" :icon="IconTerms" :label="t('terms.title')" />
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
import IconCloud from '~icons/mdi/cloud-off-outline'
import IconDelete from '~icons/mdi/delete-outline'
import IconDownload from '~icons/mdi/tray-arrow-down'
import IconShield from '~icons/mdi/shield-account-outline'
import IconStatistics from '~icons/mdi/chart-box-outline'
import IconTerms from '~icons/mdi/file-document-outline'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import EraseSheet from '@/components/EraseSheet.vue'
import ListRow from '@/components/ListRow.vue'
import NavRow from '@/components/NavRow.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import TapUnsureLine from '@/components/TapUnsureLine.vue'
import { useAnalytics } from '@/composables/useAnalytics'
import { useUnsureFocus } from '@/composables/useUnsureFocus'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useExport } from '@/composables/useExport'
import { useSignOutStore } from '@/stores/signOut'

/**
 * «Ваши данные» (MOL-93, В-2): whether the person is counted (MOL-96), the copy of everything kept,
 * erasing all of it (MOL-94), the page that says what is kept and the terms beside it (MOL-95).
 */
export default defineComponent({
  name: 'YourDataGroup',
  components: {
    AppButton,
    AppCard,
    AppReveal,
    AppSwitch,
    EraseSheet,
    IconAlert,
    IconCloud,
    IconStatistics,
    ListRow,
    NavRow,
    SectionCaption,
    TapUnsureLine,
  },
  setup() {
    const { t } = useI18n()
    const exporting = useExport()
    const announce = useAnnouncer()
    const row = ref<{ $el: HTMLElement } | null>(null)
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
      row.value?.$el.focus()
      await exporting.start()
    }
    function handOverFromCard(): void {
      exporting.handOver()
      row.value?.$el.focus()
    }
    // «Удалить мои данные» leaves through the door «Выйти» does (MOL-94): closing the sheet after a
    // failure asks the server rather than drop the intent, as there.
    const signOut = useSignOutStore()
    const eraseOpen = ref(false)
    watch(eraseOpen, (open) => {
      if (!open) signOut.stay()
    })
    const analytics = useAnalytics()
    const switchSlot = ref<HTMLElement | null>(null)
    const unsureLine = ref<{ $el: HTMLElement } | null>(null)
    useUnsureFocus(
      analytics.unsure,
      analytics.pending,
      () => switchSlot.value,
      () => unsureLine.value?.$el,
    )
    return {
      t,
      id: useId(),
      row,
      IconDelete,
      IconDownload,
      IconShield,
      IconTerms,
      ...exporting,
      retry,
      handOverFromCard,
      signOut,
      eraseOpen,
      analytics,
      switchSlot,
      unsureLine,
    }
  },
})
</script>

<style scoped lang="scss">
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

.entry-icon {
  @include icon;

  color: var(--text-muted);
  font-size: var(--icon-md);
}

.entry-text {
  display: grid;
  flex: 1;
  min-width: 0;
}

.entry-label {
  flex: 1;
}

.entry-hint {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

// The row itself does nothing: its words and its switch do.
.setting {
  cursor: default;

  label {
    cursor: pointer;
  }
}

// The second card of the group, as close to the first as a caption is to its card.
.pages {
  margin-top: var(--space-2);
}

// A switch's place, held while its answer is on the way (adversarial А1).
.switch-slot {
  display: flex;
  flex: none;
  justify-content: flex-end;
  min-width: var(--switch-width);
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
    @include icon;

    font-size: var(--icon-sm);
  }
}

.failed {
  color: var(--bad-ink);
}

// The unsure line stands where the row's other lines do.
.under {
  margin: 0 var(--space-4) var(--space-3);
}

// An icon and its words as one item of the line: the words wrap beside the icon, and a button after
// them goes under once the line is full — by the words' own width, not a basis of nothing (Р3-А4).
.said {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
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
