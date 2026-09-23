<template>
  <fieldset class="fields" :disabled="disabled">
    <section class="group">
      <h2 class="caption">{{ t('settings.group_place') }}</h2>
      <AppCard class="card">
        <p class="country">
          <span class="label">{{ t('settings.country') }}</span>
          {{ modelValue.country === 'AM' ? t('settings.armenia') : modelValue.country }}
        </p>
        <div>
          <AppField
            :model-value="modelValue.city"
            :label="t('settings.city')"
            kind="select"
            :options="cityOptions"
            :aria-describedby="describedBy('city')"
            @update:model-value="change('city', $event)"
          >
            <template v-if="changed('city')" #label-extra>
              <span class="badge" aria-hidden="true">{{ t('settings.changed') }}</span>
            </template>
          </AppField>
          <p :id="`${id}-city-hint`" class="hint">{{ t('settings.city_hint') }}</p>
          <p v-if="changed('city')" :id="`${id}-city-changed`" class="info">
            <span class="hidden">{{
              t(uncertain ? 'settings.changed' : 'settings.changed_announced')
            }}</span>
            <IconInfo aria-hidden="true" />{{ t('settings.city_changed') }}
          </p>
        </div>
      </AppCard>
    </section>
    <section class="group">
      <h2 class="caption">{{ t('settings.group_currencies') }}</h2>
      <AppCard class="card">
        <div v-for="field in currencyFields" :key="field">
          <AppField
            :model-value="modelValue[field]"
            :label="t(`settings.${field}`)"
            kind="select"
            :options="currencyOptions"
            :aria-describedby="describedBy(field)"
            @update:model-value="change(field, $event)"
          >
            <template v-if="changed(field)" #label-extra>
              <span class="badge" aria-hidden="true">{{ t('settings.changed') }}</span>
            </template>
          </AppField>
          <p :id="`${id}-${field}-hint`" class="hint">
            {{ t(field === 'spendCurrency' ? 'settings.spend_hint' : 'settings.conversion_hint') }}
          </p>
          <span v-if="changed(field)" :id="`${id}-${field}-changed`" class="hidden">
            {{ t(uncertain ? 'settings.changed' : 'settings.changed_announced') }}
          </span>
        </div>
        <p v-if="modelValue.spendCurrency === modelValue.incomeCurrency" class="info equal">
          <IconInfo aria-hidden="true" />{{ t('settings.same_currencies') }}
        </p>
      </AppCard>
    </section>
  </fieldset>
</template>
<script lang="ts">
import { computed, defineComponent, useId } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { actorSettingsSchema, currencySchema, SETTINGS_CITIES } from '@molvia/model'
import type { ActorSettings } from '@molvia/model'
import IconInfo from '~icons/mdi/information-outline'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'

export default defineComponent({
  name: 'SettingsFields',
  components: { AppCard, AppField, IconInfo },
  props: {
    modelValue: { type: Object as PropType<ActorSettings>, required: true },
    base: { type: Object as PropType<ActorSettings | null>, default: null },
    disabled: { type: Boolean, default: false },
    uncertain: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (value: ActorSettings) => actorSettingsSchema.safeParse(value).success,
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const cities: readonly string[] = SETTINGS_CITIES
    const currencyFields = ['spendCurrency', 'incomeCurrency'] as const
    /**
     * The geography the form opened on. A city outside today's two — a settings row written
     * before the form existed — stays in the list and keeps its own country, so choosing it
     * again is a geography that has not changed rather than a body the server answers 400 to
     * (adversarial Б1). Its option used to vanish on the first change, and nothing but
     * «Отменить» brought it back.
     */
    const opened = { country: props.modelValue.country, city: props.modelValue.city }
    const origin = computed(() => props.base ?? opened)
    const historical = computed(() => (cities.includes(origin.value.city) ? null : origin.value))
    const cityOptions = computed(() =>
      (historical.value ? [historical.value.city, ...cities] : cities).map((city) => ({
        value: city,
        label: city,
      })),
    )
    const currencyOptions = computed(() =>
      currencySchema.options.map((currency) => ({
        value: currency,
        label: t(`settings.currencies.${currency}`),
      })),
    )
    function change(field: 'city' | 'spendCurrency' | 'incomeCurrency', next: string): void {
      const value = actorSettingsSchema.safeParse({
        ...props.modelValue,
        [field]: next,
        ...(field === 'city'
          ? { country: next === historical.value?.city ? historical.value.country : 'AM' }
          : {}),
      })
      if (value.success) emit('update:modelValue', value.data)
    }
    const changed = (field: keyof ActorSettings): boolean =>
      !!props.base && props.base[field] !== props.modelValue[field]
    const id = useId()
    const describedBy = (field: keyof ActorSettings): string =>
      [`${id}-${field}-hint`, ...(changed(field) ? [`${id}-${field}-changed`] : [])].join(' ')
    return {
      t,
      id,
      cityOptions,
      currencyOptions,
      currencyFields,
      change,
      changed,
      describedBy,
    }
  },
})
</script>
<style scoped lang="scss">
.fields {
  display: grid;
  gap: var(--space-6);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.caption {
  margin: 0 0 var(--space-3);
  padding: var(--space-1) var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.card {
  display: grid;
  gap: var(--space-4);
}

.country {
  margin: 0;
  overflow-wrap: anywhere;
}

.label {
  display: block;
  margin-bottom: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.hint,
.info {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.info {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  color: var(--text);

  svg {
    flex: none;
    width: var(--space-4);
    height: var(--space-4);
    color: var(--accent-ink);
  }
}

.equal {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);

  svg {
    color: inherit;
  }
}

.badge {
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--accent-tint);
  color: var(--accent-ink);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
}

.hidden {
  @include visually-hidden;
}
</style>
