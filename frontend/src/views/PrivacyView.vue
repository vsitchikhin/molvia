<template>
  <AppScreen :title="t('privacy.title')">
    <template #subtitle>{{ t('privacy.revised') }}</template>
    <p class="summary">{{ t('privacy.summary') }}</p>

    <h2>{{ t('privacy.stored.title') }}</h2>
    <AppCard class="stored">
      <dl>
        <div v-for="kind in STORED" :key="kind" class="kind">
          <dt>{{ t(`privacy.stored.${kind}.term`) }}</dt>
          <dd>{{ t(`privacy.stored.${kind}.text`) }}</dd>
        </div>
      </dl>
    </AppCard>

    <section v-for="part in PARTS" :key="part" class="part">
      <h2>{{ t(`privacy.${part}.title`) }}</h2>
      <p>{{ t(`privacy.${part}.text`) }}</p>
    </section>
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import AppScreen from '@/components/AppScreen.vue'
import AppCard from '@/components/AppCard.vue'

/** What is kept, in the order of how personal it is: the account, then what it did. */
const STORED = [
  'telegram',
  'purchases',
  'places',
  'ratings',
  'search',
  'visits',
  'devices',
  'settings',
]
const PARTS = ['logs', 'storage', 'erase']

/**
 * «Данные и приватность» (MOL-58): what is kept, why, for how long, and how to have it erased.
 *
 * Static on purpose, and so it has none of the four states: nothing is asked of the server, and
 * the page is in the precache like every screen — it opens at a shelf with no signal. It is also
 * the one screen a person needs **before** signing in, so it must stay reachable without a
 * session (MOL-56 puts every other route behind the login).
 */
export default defineComponent({
  name: 'PrivacyView',
  components: { AppScreen, AppCard },
  setup() {
    const { t } = useI18n()
    return { t, STORED, PARTS }
  },
})
</script>

<style scoped lang="scss">
.summary {
  margin: 0 0 var(--space-6);
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--good-tint);
  color: var(--good-ink);
}

h2 {
  margin: var(--space-6) 0 var(--space-3);
  font-family: var(--font-display);
  font-size: var(--text-headline);
}

dl {
  margin: 0;
}

.kind + .kind {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: var(--hairline) solid var(--border);
}

dt {
  font-weight: var(--weight-medium);
}

dd,
.part p {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  font-size: var(--text-callout);
  line-height: var(--leading-body);
}
</style>
