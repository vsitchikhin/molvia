<template>
  <BottomSheet :open="open" back @update:open="$emit('update:open', $event)">
    <template #title>{{ t('scanner.camera_hint_title') }}</template>

    <div class="hint">
      <p>{{ t(TEXT[place].body) }}</p>
      <p class="path">{{ t(TEXT[place].path) }}</p>
      <p v-if="place === 'app'" class="aside">{{ t('scanner.camera_hint_app_search') }}</p>
      <p class="aside">{{ t(TEXT[place].price) }}</p>
      <!-- The way for every site, checked on the owner's phone; the tab's own is behind a page menu
           that moved between versions of iOS (review 1). The search finds Safari where «Приложения»
           is not yet — before iOS 18 it stood at the top of Settings (review 5). -->
      <template v-if="place === 'tab'">
        <p class="aside">{{ t('scanner.camera_hint_tab_or') }}</p>
        <p class="aside">{{ t('scanner.camera_hint_app_search') }}</p>
      </template>
      <p class="aside">{{ t(TEXT[place].otherwise) }}</p>
    </div>

    <template #footer>
      <AppButton size="large" block @click="$emit('update:open', false)">
        {{ t('scanner.camera_hint_ok') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import type { CameraHintPlace } from '@/composables/useCameraHint'

// Keys written out whole, as the scanner's refusals are (MOL-16, О-12). A tab has a setting for
// this site alone; the app from the home screen has only Safari's own, which opens the camera to
// every site — and the sheet says so (MOL-163, Р-6).
const TEXT = {
  app: {
    body: 'scanner.camera_hint_app_body',
    path: 'scanner.camera_hint_app_path',
    price: 'scanner.camera_hint_app_price',
    otherwise: 'scanner.camera_hint_app_otherwise',
  },
  tab: {
    body: 'scanner.camera_hint_tab_body',
    path: 'scanner.camera_hint_tab_path',
    price: 'scanner.camera_hint_tab_price',
    otherwise: 'scanner.camera_hint_tab_otherwise',
  },
} as const

/**
 * «Камера без вопросов» (MOL-163): over the scanner, where Safari has just asked for the camera —
 * which it does once per page load until a setting of the phone says otherwise. No link: iOS opens
 * no Settings from a web page, so the way there is written out.
 */
export default defineComponent({
  name: 'CameraHintSheet',
  components: { AppButton, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    place: { type: String as PropType<CameraHintPlace>, required: true },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
  },
  setup() {
    const { t } = useI18n()
    return { t, TEXT }
  },
})
</script>

<style scoped lang="scss">
.hint {
  display: grid;
  gap: var(--space-3);

  p {
    margin: 0;
  }
}

.path {
  font-weight: var(--weight-bold);
}

.aside {
  color: var(--text-muted);
  font-size: var(--text-callout);
}
</style>
