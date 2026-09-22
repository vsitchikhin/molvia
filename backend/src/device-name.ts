import { deviceNameOrNull } from '@molvia/model'

/** A label for confirmation, never a claim about the device's identity. */
export function deviceName(userAgent: string | undefined): string | null {
  if (!userAgent) return null
  const os = userAgent.includes('iPhone')
    ? 'iPhone'
    : userAgent.includes('iPad')
      ? 'iPad'
      : userAgent.includes('Android')
        ? 'Android'
        : userAgent.includes('Windows')
          ? 'Windows'
          : /Macintosh|Mac OS X/.test(userAgent)
            ? 'Mac'
            : userAgent.includes('Linux')
              ? 'Linux'
              : null
  const browser = /Edg(?:e|A|iOS)?\//.test(userAgent)
    ? 'Edge'
    : /(?:Firefox|FxiOS)\//.test(userAgent)
      ? 'Firefox'
      : /(?:Chrome|CriOS)\//.test(userAgent)
        ? 'Chrome'
        : /Version\/.*Safari\//.test(userAgent)
          ? 'Safari'
          : null
  return os && browser ? deviceNameOrNull(`${os} · ${browser}`) : null
}
