import { computed, shallowRef } from 'vue'
import type { ComputedRef } from 'vue'
import { ffFromHeader, ffHeaderOf } from '@molvia/model'
import type { FfName } from '@molvia/model'
import { readHeld, writeWhereDiffers } from '@/stores/storage'

/**
 * The «фф» that are on, as the API last named them (MOL-382, В-1 «а»): every answer carries them, and
 * the phone keeps the last list on the device — the server's, not the person's, so «Выйти» and erasure
 * leave it, as they leave the scheme. Nothing heard and nothing kept — all are off.
 */
const KEY = 'molvia.ff'

const on = shallowRef<ReadonlySet<FfName>>(ffFromHeader(readHeld(KEY) ?? ''))

let next: (() => void) | null = null

/**
 * What an answer named. The device is written whenever a shelf holds another list — never by this
 * window's memory alone: another window may have written an older one since (adversarial А3) — so a list
 * heard a hundred times is written once. Empty is a list too, «none is on», read as one at the start.
 */
export function hearFf(heard: ReadonlySet<FfName>): void {
  const named = ffHeaderOf(heard)
  if (named !== ffHeaderOf(on.value)) on.value = heard
  writeWhereDiffers(KEY, named)
  const told = next
  next = null
  told?.()
}

/** Told once, at the next answer that names the фф — whatever it names; a later call replaces it. */
export function atNextFf(listener: () => void): void {
  next = listener
}

/** Whether an фф is on now, for a guard that asks once. */
export function ffOn(name: FfName): boolean {
  return on.value.has(name)
}

/**
 * Whether an фф is on, following the answers: an entry of a feature is `v-if` by it, and appears or
 * goes with the next answer that names another list, with no reload.
 */
export function useFf(name: FfName): ComputedRef<boolean> {
  return computed(() => on.value.has(name))
}
