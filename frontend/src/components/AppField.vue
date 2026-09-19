<template>
  <div class="field" :class="[attrs.class, { invalid: failed, readonly }]" :style="attrs.style">
    <label class="label" :for="id">{{ label }}</label>

    <div class="well">
      <textarea
        v-if="kind === 'multiline'"
        :id="id"
        class="control"
        v-bind="control()"
        :value="modelValue"
        :readonly="readonly"
        :aria-invalid="failed ? 'true' : undefined"
        :aria-describedby="describedBy()"
        @input="update"
      ></textarea>
      <input
        v-else
        :id="id"
        class="control"
        v-bind="control()"
        :type="kind === 'date' ? 'date' : 'text'"
        :inputmode="kind === 'decimal' ? 'decimal' : undefined"
        :value="modelValue"
        :readonly="readonly"
        :aria-invalid="failed ? 'true' : undefined"
        :aria-describedby="describedBy()"
        @input="update"
      />
      <span v-if="$slots.suffix" :id="`${id}-suffix`" class="suffix">
        <slot name="suffix" />
      </span>
    </div>

    <p v-if="failed" :id="`${id}-error`" class="error">{{ errorText ?? t(error ?? '') }}</p>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, useAttrs, useId, useSlots } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ErrorCode } from '@molvia/model'

export type FieldKind = 'text' | 'decimal' | 'multiline' | 'date'

/**
 * A native input with its label, its error and its tail, wired the same way every time: the
 * label by `for`, the error by `aria-describedby` and `aria-invalid`, the tail (the dram sign)
 * read out after the value rather than typed into it.
 *
 * The value is the raw string. Nothing here parses or rounds — `1,128` comes out as `1,128`,
 * and the screen reads it through the model's codecs, because the server is the one that
 * decides what a number is.
 *
 * `kind` sets what a phone needs to open the right keyboard, so a screen never has to remember
 * it. Money and quantities are `type="text" inputmode="decimal"`, never `type="number"`: that
 * one gives spinners, refuses the comma of a Russian keyboard and silently drops what it cannot
 * read.
 *
 * The error is a code from the domain registry and doubles as its i18n key, so no message is
 * written where it is shown. `errorText` is for a refusal the registry has no code for — the
 * screen's own words, already translated: the review's «a character that cannot be saved»
 * (MOL-28, G2). It wins over `error` when both are given. Every other attribute — `autofocus`, `enterkeyhint`, `maxlength` —
 * goes to the control itself; `class` and `style` stay on the field, where the layout is.
 */
export default defineComponent({
  name: 'AppField',
  inheritAttrs: false,
  props: {
    modelValue: { type: String, required: true },
    label: { type: String, required: true },
    kind: { type: String as PropType<FieldKind>, default: 'text' },
    error: { type: String as PropType<ErrorCode | null>, default: null },
    errorText: { type: String as PropType<string | null>, default: null },
    readonly: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (value: string) => typeof value === 'string',
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const attrs = useAttrs()
    const slots = useSlots()
    const id = useId()
    const failed = computed(() => props.errorText !== null || props.error !== null)

    // Functions, not computeds: neither attrs nor slots are reactive, and a computed would keep
    // what it saw first — an `enterkeyhint` added later, a tail that came with the unit.
    function control(): Record<string, unknown> {
      return Object.fromEntries(
        Object.entries(attrs).filter(([name]) => name !== 'class' && name !== 'style'),
      )
    }

    function describedBy(): string | undefined {
      const parts = [
        slots.suffix ? `${id}-suffix` : undefined,
        failed.value ? `${id}-error` : undefined,
      ].filter(Boolean)
      return parts.length > 0 ? parts.join(' ') : undefined
    }

    function update(event: Event): void {
      emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value)
    }

    return { t, attrs, id, failed, control, describedBy, update }
  },
})
</script>

<style scoped lang="scss">
.label {
  display: block;
  margin-bottom: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.well {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--touch-target);
  padding: 0 var(--space-3);
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    outline-color var(--dur-fast) var(--ease-out);

  &:focus-within {
    border-color: var(--accent);
    outline: 2px solid var(--accent-tint);
  }
}

.control {
  flex: 1;
  min-width: 0;
  min-height: var(--touch-target);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--text-body);
  font-variant-numeric: tabular-nums;

  /* The ring is drawn on the well, around the tail as well as the value. */
  outline: none;

  &::placeholder {
    color: var(--text-muted);
    opacity: 1;
  }
}

textarea.control {
  min-height: calc(var(--touch-target) * 2);
  padding: var(--space-3) 0;
  line-height: var(--leading-body);
  resize: vertical;
}

.well:has(textarea) {
  align-items: stretch;
}

.suffix {
  flex: none;
  color: var(--text-muted);
  font-weight: var(--weight-medium);
}

.invalid .well {
  border-color: var(--bad);
}

.error {
  margin: var(--space-1) 0 0;
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}

.readonly {
  .well {
    background: var(--surface);
  }

  .control {
    color: var(--text-muted);
  }
}

@media (prefers-reduced-motion: reduce) {
  .well {
    transition: none;
  }
}
</style>
