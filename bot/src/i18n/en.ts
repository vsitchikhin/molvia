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
    'Let this device into your Molvia account?\n' +
    'Device: {device}\n' +
    'Requested {when}.\n\n' +
    'If you did not start this sign-in, tap “Not me”: otherwise whoever sent you the link ' +
    'gets access to your purchases.',
  'login.device_unknown': 'unknown device',
  'login.when.now': 'less than a minute ago',
  'login.when.one': 'a minute ago',
  'login.when.few': '{n} minutes ago',
  'login.when.many': '{n} minutes ago',
  'login.confirm': 'Sign in',
  'login.decline': 'Not me',
  'login.confirmed': 'Signed in. Go back to Molvia — the app will recognise you by itself.',
  'login.already':
    'This sign-in is already confirmed — go back to Molvia.\n\n' +
    'If it was not you who confirmed it, tap “Not me”: otherwise the app will open somebody ' +
    "else's account instead of yours.",
  'login.declined': 'Sign-in declined. Nobody got into the account.',
  'login.unavailable': 'This link no longer works. Start signing in again in the app.',
  'login.failed': 'No answer came back. Please try again in a minute.',
  'start.greeting':
    'Molvia — what is worth buying, and where.\n\n' +
    'Signing in starts in the app: {url} — and I will send the confirmation here.',
}
