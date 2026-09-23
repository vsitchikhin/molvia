import { deviceNameOrNull } from '@molvia/model'

/**
 * A label for confirmation, never a claim about the device's identity.
 *
 * It is what a person reads in the bot before «this was not me», so a wrong word costs more than
 * a missing one (adversarial А2): iPadOS asks for the desktop site and says «Macintosh», so
 * Safari there is named for both; Chromium browsers carry `Chrome/` and are looked for first;
 * an in-app browser with no browser token is named by its system alone.
 */
export function deviceName(userAgent: string | undefined): string | null {
  if (!userAgent) return null
  const browser = /Edg(?:e|A|iOS)?\//.test(userAgent)
    ? 'Edge'
    : userAgent.includes('YaBrowser/')
      ? 'Yandex Browser'
      : userAgent.includes('SamsungBrowser/')
        ? 'Samsung Internet'
        : /(?:Firefox|FxiOS)\//.test(userAgent)
          ? 'Firefox'
          : /(?:Chrome|CriOS)\//.test(userAgent)
            ? 'Chrome'
            : /Version\/.*Safari\//.test(userAgent)
              ? 'Safari'
              : null
  const os = userAgent.includes('iPhone')
    ? 'iPhone'
    : userAgent.includes('iPad')
      ? 'iPad'
      : userAgent.includes('Android')
        ? 'Android'
        : userAgent.includes('Windows')
          ? 'Windows'
          : /Macintosh|Mac OS X/.test(userAgent)
            ? browser === 'Safari'
              ? 'Mac / iPad'
              : 'Mac'
            : userAgent.includes('Linux')
              ? 'Linux'
              : null
  if (!os) return null
  return deviceNameOrNull(browser ? `${os} · ${browser}` : os)
}
