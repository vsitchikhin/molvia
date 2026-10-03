<template>
  <div class="pictures">
    <ul class="row" :aria-label="t('feedback.picture.list')">
      <li v-for="(picture, index) in pictures" :key="picture.url" class="tile">
        <img
          class="shot"
          :src="picture.url"
          :alt="t('feedback.picture.alt', { n: index + 1 })"
          :width="picture.width"
          :height="picture.height"
        />
        <button
          type="button"
          class="remove"
          :aria-label="t('feedback.picture.remove', { n: index + 1 })"
          :disabled="disabled"
          @click="$emit('remove', index)"
        >
          <span class="cross" aria-hidden="true"><IconClose /></span>
        </button>
      </li>
      <li v-if="pictures.length < max" class="tile">
        <!-- A label over a native file input: the system picker of the gallery, reached by a tap,
             by the keyboard and by a screen reader alike. -->
        <label class="add" :class="{ busy: drawing }" :aria-busy="drawing">
          <input
            ref="input"
            class="file"
            type="file"
            accept="image/*"
            :multiple="max - pictures.length > 1"
            :disabled="disabled || drawing"
            @change="pick"
          />
          <IconImagePlus class="add-icon" aria-hidden="true" />
          <span>{{ drawing ? t('feedback.picture.adding') : t('feedback.picture.add') }}</span>
        </label>
      </li>
    </ul>
    <p v-if="note" class="note" role="alert">{{ note }}</p>
    <p v-else-if="pictures.length === 0" class="hint">{{ t('feedback.picture.hint') }}</p>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/mdi/close'
import IconImagePlus from '~icons/mdi/image-plus-outline'

/** A picture as the row shows it: the drawing that goes, never the file chosen. */
export interface ShownPicture {
  readonly url: string
  readonly width: number
  readonly height: number
}

/**
 * The pictures of a message to the developer (MOL-167): each the drawing that will go, with «Убрать»,
 * and «Приложить снимок» while there is room — the gallery's own picker. Before anything is chosen a
 * line says how a screenshot is made: by the phone's buttons, then here. What is held, and what is
 * refused, is the sheet's; the row only shows it and says what was asked.
 */
export default defineComponent({
  name: 'FeedbackPictures',
  components: { IconClose, IconImagePlus },
  props: {
    pictures: { type: Array as PropType<readonly ShownPicture[]>, required: true },
    max: { type: Number, required: true },
    drawing: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    /** Why the last picture did not go in, if it did not; `null` otherwise. */
    note: { type: String as PropType<string | null>, default: null },
  },
  emits: {
    add: (files: File[]) => files.length > 0,
    remove: (index: number) => index >= 0,
  },
  setup(_props, { emit }) {
    const { t } = useI18n()
    const input = ref<HTMLInputElement | null>(null)

    function pick(): void {
      const files = [...(input.value?.files ?? [])]
      // The same file may be chosen again after it was taken away.
      if (input.value) input.value.value = ''
      if (files.length > 0) emit('add', files)
    }

    return { t, input, pick }
  },
})
</script>

<style scoped lang="scss">
.pictures {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

// Wide enough for «Приложить» on one line, tall enough for a phone's screenshot standing up.
.tile {
  @include appear;

  position: relative;
  width: calc(var(--touch-target) * 2);
  height: calc(var(--touch-target) * 2.75);
}

.shot {
  display: block;
  width: 100%;
  height: 100%;
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);

  // Whole, never cropped: the person checks what goes (MOL-150, Р-7).
  object-fit: contain;
}

// The whole corner is the button, a thumb's size; only its circle is drawn.
.remove {
  @include touch-target;

  position: absolute;
  top: calc(var(--space-3) * -1);
  right: calc(var(--space-3) * -1);
  padding: 0;
  border: 0;
  background: none;
  color: var(--surface);
  cursor: pointer;

  &:focus-visible {
    @include focus-ring(-4px);
  }

  &:disabled {
    cursor: default;
  }
}

.cross {
  display: grid;
  place-items: center;
  width: var(--space-6);
  height: var(--space-6);
  border-radius: 50%;
  background: var(--text);

  svg {
    width: var(--space-4);
    height: var(--space-4);
  }
}

.add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  width: 100%;
  height: 100%;
  padding: var(--space-1);
  border: var(--hairline) dashed var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--accent-ink);
  font-size: var(--text-footnote);
  text-align: center;
  cursor: pointer;

  &:focus-within {
    @include focus-ring;
  }

  &.busy {
    color: var(--text-muted);
    cursor: progress;
  }
}

.add-icon {
  width: var(--space-6);
  height: var(--space-6);
}

.file {
  @include visually-hidden;
}

.hint,
.note {
  margin: 0;
  font-size: var(--text-footnote);
}

.hint {
  color: var(--text-muted);
}

.note {
  @include appear;

  color: var(--bad-ink);
}
</style>
