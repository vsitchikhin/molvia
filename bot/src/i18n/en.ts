import type { Dictionary } from './ru'

/**
 * English, mirroring the Russian key for key — the type refuses anything else.
 *
 * English has one plural form where Russian has three, so `login.when.few` and
 * `login.when.many` carry the same sentence here. That is not a duplicate to be deduplicated:
 * the key names the Russian form, and collapsing them would move the choice of form out of the
 * dictionary and into the code.
 */
export const en: Dictionary = {
  'login.prompt':
    'Sign in to Molvia?\n' +
    'Device: {device}\n' +
    'Requested {when}.\n\n' +
    'If this was not you, tap «Not me» — nothing will happen.',
  'login.device_unknown': 'unknown device',
  'login.when.now': 'less than a minute ago',
  'login.when.one': 'a minute ago',
  'login.when.few': '{n} minutes ago',
  'login.when.many': '{n} minutes ago',
  'login.confirm': 'Sign in',
  'login.decline': 'Not me',
  'login.confirmed': 'Signed in. Go back to Molvia — the app will recognise you by itself.',
  'login.declined': 'Sign-in declined. Nobody got into the account.',
  'login.unavailable': 'This link no longer works. Start signing in again in the app.',
  'login.failed': 'That did not work. Please try again in a minute.',
  'start.greeting':
    'Molvia — what is worth buying, and where.\n\n' +
    'Signing in starts in the app: {url} — and I will send the confirmation here.',
}
