<template>
  <aside v-if="notice && !dismissed" class="notice" role="status">
    <h2 class="title">{{ t(`identity.${notice}_title`) }}</h2>
    <p class="body">{{ t(`identity.${notice}_body`) }}</p>
    <button v-if="notice === 'lost'" class="action" type="button" @click="dismissed = true">
      {{ t('identity.lost_action') }}
    </button>
  </aside>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useActorStore } from '@/stores/actor'

/**
 * What happened to the identity, when it is something a person has to be told. Losing the
 * stored identifier means the trips and ratings of this device are out of reach, and an app
 * that quietly reappeared empty would look broken rather than honest — the owner chose this
 * over silence when the plan was reviewed (MOL-8, В-7).
 *
 * Deliberately not a fourth «state» block: those belong to whatever a screen is loading.
 * MOL-19 builds the shared set, and this becomes one of its cases.
 */
export default defineComponent({
  name: 'IdentityNotice',
  setup() {
    const { t } = useI18n()
    const actor = useActorStore()
    const dismissed = ref(false)

    // «Lost» can be dismissed: a new identity already works, and the message is a
    // courtesy. «Uninvited» cannot — there is nothing behind it to get on with.
    const notice = computed(() =>
      actor.state === 'lost' || actor.state === 'uninvited' ? actor.state : null,
    )

    return { t, notice, dismissed }
  },
})
</script>

<style scoped lang="scss">
.notice {
  margin: var(--space-4) var(--space-4) 0;
  padding: var(--space-4);
  border: var(--hairline) solid var(--warn);
  border-radius: var(--radius);
  background: var(--warn-tint);
  color: var(--warn-ink);
}

.title {
  margin: 0 0 var(--space-2);
  font-family: var(--font-display);
  font-size: var(--text-headline);
  font-weight: var(--weight-bold);
  line-height: var(--leading-snug);
}

.body {
  margin: 0;
  font-size: var(--text-callout);
  line-height: var(--leading-body);
}

.action {
  @include touch-target;

  margin-top: var(--space-3);
  padding: 0 var(--space-4);
  border: var(--hairline) solid var(--warn-ink);
  border-radius: var(--radius);
  background: transparent;
  color: var(--warn-ink);
  font: inherit;
  font-weight: var(--weight-medium);
}
</style>
