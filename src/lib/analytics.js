/**
 * Google Ads conversion tracking and cookie consent.
 *
 * The Google tag itself is loaded in index.html with Consent Mode v2
 * defaults of "denied"; this module only records the visitor's choice and
 * reports confirmed bookings. Nothing here may ever throw into, or block, the
 * booking flow.
 */

const TAG_ID = 'AW-16890045753'
// Conversion label for "Booking completed" (Google Ads → Goals → Conversions).
const BOOKING_LABEL = import.meta.env.VITE_GADS_BOOKING_LABEL

export const CONSENT_KEY = 'sdk-cookie-consent' // also read in index.html

const CONSENT_FIELDS = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']

/** 'granted' | 'denied' | null (not chosen yet, or storage unavailable). */
export function readConsent() {
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    return null
  }
}

export function saveConsent(choice) {
  try {
    localStorage.setItem(CONSENT_KEY, choice)
  } catch {
    // Private mode etc. — the choice still applies for this page view.
  }
  try {
    window.gtag?.(
      'consent',
      'update',
      Object.fromEntries(CONSENT_FIELDS.map((f) => [f, choice])),
    )
  } catch {
    // Never let tracking break the page.
  }
}

// Survives re-renders, remounts and StrictMode; sessionStorage covers reloads.
const fired = new Set()

/**
 * Report one confirmed booking (paid order or intensive request) to Google
 * Ads. Fires at most once per id. Silently does nothing without a label.
 */
export function trackBookingConversion({ id }) {
  try {
    if (!id) return
    if (!BOOKING_LABEL) {
      if (import.meta.env.DEV) {
        console.warn('VITE_GADS_BOOKING_LABEL is not set — booking conversion not sent.')
      }
      return
    }

    const key = `sdk-gads-conversion:${id}`
    if (fired.has(key)) return
    fired.add(key)
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // Storage unavailable — the in-memory guard still holds for this load.
    }

    window.gtag?.('event', 'conversion', {
      send_to: `${TAG_ID}/${BOOKING_LABEL}`,
      transaction_id: String(id),
    })
  } catch (err) {
    if (import.meta.env.DEV) console.warn('Booking conversion failed to send', err)
  }
}
