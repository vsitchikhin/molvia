<template>
  <fieldset class="fields" :disabled="disabled">
    <section class="group">
      <h2 class="caption">{{ t('settings.group_place') }}</h2>
      <AppCard class="card">
        <div>
          <AppField
            :model-value="modelValue.country"
            :label="t('settings.country')"
            kind="select"
            :options="countryOptions"
            :aria-describedby="describedBy('country')"
            @update:model-value="change('country', $event)"
          >
            <template v-if="changed('country')" #label-extra>
              <span class="badge" aria-hidden="true">{{ t('settings.changed') }}</span>
            </template>
          </AppField>
          <span v-if="changed('country')" :id="`${id}-country-changed`" class="hidden">
            {{ t(uncertain ? 'settings.changed' : 'settings.changed_announced') }}
          </span>
        </div>
        <div>
          <!-- A city the two of 0.1 do not carry: the person keeps it (В-4а) and is told why it
               is there, with the whole of it readable — a native select clips it (кадр 5b). -->
          <p v-if="historical" :id="`${id}-city-kept`" class="kept">
            <span>{{ t('settings.city_current', { city: historical.city }) }}</span>
            <span class="note">{{ t('settings.city_not_listed') }}</span>
          </p>
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
import {
  actorSettingsSchema,
  citiesOf,
  currencySchema,
  isSettingsCountry,
  SETTINGS_COUNTRIES,
} from '@molvia/model'
import type { ActorSettings } from '@molvia/model'
import IconInfo from '~icons/mdi/information-outline'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'
import { countryLabel } from '@/components/placeLabel'

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
    const i18n = useI18n()
    const { t } = i18n
    const currencyFields = ['spendCurrency', 'incomeCurrency'] as const
    /**
     * The geography the form opened on. A city its country does not offer — a settings row written
     * before the form existed — stays in the list under its own country, so choosing it again is
     * a geography that has not changed rather than a body the server answers 400 to (adversarial
     * Б1). Its option used to vanish on the first change, and nothing but «Отменить» brought it
     * back. Its country too, when the settings offer no such country at all (MOL-109).
     */
    // Read once: with no base the form is the one it was mounted with. The sheet that has no
    // base mounts these fields afresh at every opening (`TripContextSheet`), which is what
    // keeps this honest — a watcher trying to follow the model instead let a city the person
    // had left behind stand in the list, and it was the one city the server would refuse
    // (MOL-65, review 3, Ж2).
    const opened = { country: props.modelValue.country, city: props.modelValue.city }
    const origin = computed(() => props.base ?? opened)
    const historical = computed(() =>
      citiesOf(origin.value.country).some((city) => city === origin.value.city)
        ? null
        : origin.value,
    )
    const countryOptions = computed(() => {
      const kept = historical.value?.country
      const countries: readonly string[] = SETTINGS_COUNTRIES
      return (
        kept !== undefined && !isSettingsCountry(kept) ? [kept, ...countries] : countries
      ).map((country) => ({ value: country, label: countryLabel(country, i18n) }))
    })
    const cityOptions = computed(() => {
      const cities: readonly string[] = citiesOf(props.modelValue.country)
      const kept = historical.value
      return (kept?.country === props.modelValue.country ? [kept.city, ...cities] : cities).map(
        (city) => ({ value: city, label: city }),
      )
    })
    const currencyOptions = computed(() =>
      currencySchema.options.map((currency) => ({
        value: currency,
        label: t(`settings.currencies.${currency}`),
      })),
    )
    /**
     * A city is chosen among its country's, so a change of country lands on that country's first
     * city — or, back in the country the form opened on, on the city it opened on, listed or not
     * (adversarial А3: Ереван → Грузия → Армения was Гюмри, «изменено», and saved so) — and the form
     * is never left with a city of another country, which the server would refuse.
     */
    function cityOnArrival(country: string): string {
      return origin.value.country === country ? origin.value.city : (citiesOf(country)[0] ?? '')
    }
    function change(field: keyof ActorSettings, next: string): void {
      if (field === 'country' && next === props.modelValue.country) return
      const value = actorSettingsSchema.safeParse({
        ...props.modelValue,
        [field]: next,
        ...(field === 'country' ? { city: cityOnArrival(next) } : {}),
      })
      if (value.success) emit('update:modelValue', value.data)
    }
    const changed = (field: keyof ActorSettings): boolean =>
      !!props.base && props.base[field] !== props.modelValue[field]
    const id = useId()
    // The country has no hint of its own: unchanged, it is described by nothing, not by `""`.
    const describedBy = (field: keyof ActorSettings): string | undefined =>
      [
        ...(field === 'city' && historical.value ? [`${id}-city-kept`] : []),
        ...(field === 'country' ? [] : [`${id}-${field}-hint`]),
        ...(changed(field) ? [`${id}-${field}-changed`] : []),
      ].join(' ') || undefined
    return {
      t,
      id,
      countryOptions,
      cityOptions,
      currencyOptions,
      currencyFields,
      historical,
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
    @include icon;

    font-size: var(--icon-sm);
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

.kept {
  display: grid;
  gap: var(--space-1);
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  font-size: var(--text-footnote);
  overflow-wrap: anywhere;

  .note {
    color: var(--text-muted);
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
