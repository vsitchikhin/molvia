<template>
  <AppScreen :title="t('privacy.title')">
    <template #subtitle>{{ revised }}</template>
    <!-- A breach is announced here (MOL-236, «Порядок при утечке»): the key exists only then. -->
    <div v-if="notice" class="notice">
      <h2>{{ t('privacy.notice.title') }}</h2>
      <p>{{ t('privacy.notice.text') }}</p>
    </div>
    <p class="summary">{{ t('privacy.summary') }}</p>

    <section v-for="part in PARTS" :key="part" class="part">
      <h2>{{ t(`privacy.${part}.title`) }}</h2>
      <AppCard v-if="LISTS[part]" class="list">
        <dl>
          <div v-for="kind in LISTS[part]" :key="kind" class="kind">
            <dt>{{ t(`privacy.${part}.${kind}.term`) }}</dt>
            <dd>{{ t(`privacy.${part}.${kind}.text`) }}</dd>
          </div>
        </dl>
      </AppCard>
      <!-- A text of more than one paragraph keeps them on lines of its own. -->
      <template v-else>
        <p v-for="(paragraph, at) in t(`privacy.${part}.text`).split('\n')" :key="at">
          {{ paragraph }}
        </p>
      </template>
    </section>
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import AppScreen from '@/components/AppScreen.vue'
import AppCard from '@/components/AppCard.vue'
import { PRIVACY_LISTS, PRIVACY_PARTS, revisedOn } from '@/views/policy'

/**
 * «Данные и приватность» (MOL-58): what is kept, why, for how long, and how to have it erased.
 *
 * Static on purpose, and so it has none of the four states: nothing is asked of the server, and
 * the page is in the precache like every screen — it opens at a shelf with no signal. It is also
 * the one screen a person needs **before** signing in, so it must stay reachable without a
 * session (MOL-56 puts every other route behind the login).
 *
 * Edition 2 (MOL-236) is the text of the consent art. 10 of Armenia's law asks for: who is
 * responsible, the basis, the recipients, the rights and how to withdraw — so «Принимаю» can be the
 * «reliable act» of art. 9 §7 the strict reading takes it for.
 */
export default defineComponent({
  name: 'PrivacyView',
  components: { AppScreen, AppCard },
  setup() {
    const i18n = useI18n()
    const { t, locale } = i18n
    return {
      t,
      notice: computed(() => i18n.te('privacy.notice.title')),
      LISTS: PRIVACY_LISTS,
      PARTS: PRIVACY_PARTS,
      revised: computed(() => revisedOn(t, locale.value)),
    }
  },
})
</script>

<style scoped lang="scss">
.notice {
  margin: 0 0 var(--space-4);
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--warn-tint);
  color: var(--warn-ink);

  h2 {
    margin-top: 0;
  }

  p {
    margin: 0;
    line-height: var(--leading-body);
  }
}

.summary {
  margin: 0 0 var(--space-6);
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--good-tint);
  color: var(--good-ink);
}

h2 {
  @include display-type;

  margin: var(--space-6) 0 var(--space-3);
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
