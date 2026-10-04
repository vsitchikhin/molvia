<template>
  <AppScreen :title="t('terms.title')">
    <template #subtitle>{{ revised }}</template>
    <section v-for="part in PARTS" :key="part" class="part">
      <h2>{{ t(`terms.${part}.title`) }}</h2>
      <p>{{ t(`terms.${part}.text`) }}</p>
    </section>
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import AppScreen from '@/components/AppScreen.vue'
import { revisedOn } from '@/views/policy'

const PARTS = [
  'what',
  'who',
  'yours',
  'write',
  'catalogue',
  'ads',
  'warranty',
  'free',
  'changes',
  'contact',
]

/**
 * «Условия использования» (MOL-95, owner's decision В-2): the rules of the service beside the page
 * about data, one edition for the two — the age of 16 is here. Static and open without a session, as
 * «Данные и приватность» is, for the same reason: it is read before saying yes to it, from the
 * consent screen behind the closed door. The text is a draft until the hour with the lawyer
 * (MOL-97), and what it says then is a new edition.
 */
export default defineComponent({
  name: 'TermsView',
  components: { AppScreen },
  setup() {
    const { t, locale } = useI18n()
    return { t, PARTS, revised: computed(() => revisedOn(t, locale.value)) }
  },
})
</script>

<style scoped lang="scss">
h2 {
  @include display-type;

  margin: var(--space-6) 0 var(--space-3);
  font-size: var(--text-headline);
}

.part:first-child h2 {
  margin-top: 0;
}

.part p {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  font-size: var(--text-callout);
  line-height: var(--leading-body);
}
</style>
