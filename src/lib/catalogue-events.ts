'use client'

/**
 * Catalogue change notifications — how one screen tells the others to refetch.
 *
 * The owner edits a drug on the catalogue screen and expects the till to show
 * the new price straight away. Three clients can be showing the catalogue, and
 * they are not always in the same tab or even the same device:
 *
 *   1. The tab that made the change      — it already knows; it updates itself.
 *   2. Another tab in the SAME browser   — BroadcastChannel reaches it instantly.
 *   3. Another DEVICE (another branch's
 *      till, the owner's phone)         — nothing in the browser can reach
 *                                         across, so those clients poll
 *                                         /api/catalogue-revision (see
 *                                         useCatalogueSync) and refetch when
 *                                         the token moves.
 *
 * Splitting it this way is the whole point: a same-device edit is instant with
 * no network round-trip, and a cross-device edit costs one tiny token poll
 * rather than a full catalogue refetch on a timer.
 *
 * The `localStorage` write alongside BroadcastChannel is deliberate and not
 * redundant: BroadcastChannel is unsupported on older Safari and on some
 * embedded WebViews, and a storage event fires in every OTHER tab of the origin.
 * Between the two, a mutation reaches every same-browser tab.
 */

const CHANNEL_NAME = 'pharmacare-catalogue'
const STORAGE_KEY = 'pharmacare:catalogue:changed'
/** Bumped on each notify so repeat notifications are distinguishable. */
let notificationId = 0

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
    return null
  }
  try {
    return new BroadcastChannel(CHANNEL_NAME)
  } catch {
    return null
  }
}

/**
 * Announce that the catalogue changed. Call this after any successful mutation
 * that changes what the catalogue looks like: product create/edit/delete, bulk
 * import, a price change, a branch being opened or closed, a transfer landing.
 *
 * Best-effort by design — a failure to notify must never fail the mutation that
 * already committed. Cross-device clients will still converge on their next
 * revision poll, so the worst case is the old 30-second delay, not a stale
 * price forever.
 */
export function notifyCatalogueChanged(): void {
  if (typeof window === 'undefined') return

  notificationId += 1
  const payload = { at: Date.now(), id: notificationId }

  const channel = getChannel()
  if (channel) {
    try {
      channel.postMessage(payload)
    } catch {
      /* ignore */
    } finally {
      channel.close()
    }
  }

  try {
    // `storage` events only fire in other tabs, and only when the value changes,
    // hence the counter: two edits in the same millisecond must both notify.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* Private browsing / quota — the poll path still covers us. */
  }
}

/**
 * Run `onChange` whenever the catalogue changes in this browser.
 *
 * Returns an unsubscribe function, for use as a `useEffect` cleanup.
 */
export function subscribeCatalogueChanged(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const handle = () => onChange()

  const channel = getChannel()
  if (channel) {
    channel.onmessage = handle
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    if (channel) {
      channel.onmessage = null
      channel.close()
    }
    window.removeEventListener('storage', onStorage)
  }
}
