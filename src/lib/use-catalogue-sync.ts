'use client'

import { useEffect, useRef } from 'react'
import { subscribeCatalogueChanged } from '@/lib/catalogue-events'

/**
 * Keeps a screen's catalogue data fresh.
 *
 * @param onChange  Refetch callback. Must be stable (wrap in `useCallback`),
 *                  because this hook re-subscribes whenever it changes.
 *
 * HOW IT STAYS FRESH
 *
 *   Same device, other tab  — `subscribeCatalogueChanged` fires the moment
 *                             another tab mutates the catalogue. No polling, no
 *                             latency.
 *   Other device            — a small token from /api/catalogue-revision is
 *                             polled on `intervalMs`. The full catalogue is
 *                             refetched ONLY when that token actually changed,
 *                             so a quiet pharmacy costs one tiny request per
 *                             tick instead of a full product list.
 *   Tab regains focus      — checked immediately, because a laptop that slept
 *                             through several ticks would otherwise show
 *                             whatever was on screen when it went to sleep.
 *   Offline                — failures are swallowed. A till must keep selling
 *                             from what it already has; the next successful
 *                             poll reconciles it. Errors are not surfaced
 *                             because a failed poll is not actionable here.
 *
 * The revision is tracked in a ref, not state: it is bookkeeping, and putting
 * it in state would re-render the whole catalogue screen on every tick.
 */
export function useCatalogueSync(onChange: () => void, intervalMs = 10000): void {
  // Kept in a ref so the subscription effect can depend on `intervalMs` alone
  // and never re-subscribe just because the parent re-rendered a new closure.
  // The write happens in an effect, not during render: mutating a ref mid-render
  // is not safe under concurrent rendering.
  const handlerRef = useRef(onChange)
  useEffect(() => {
    handlerRef.current = onChange
  })

  useEffect(() => {
    let cancelled = false
    let lastRevision: string | null = null

    const ping = () => {
      if (cancelled) return
      handlerRef.current()
    }

    // Same-browser tabs and windows.
    const unsubscribe = subscribeCatalogueChanged(ping)

    // Other devices: a cheap change token, not the whole catalogue.
    const checkRevision = async () => {
      if (cancelled) return
      // Don't pile requests up if one is still in flight.
      if (checkRevision.inFlight) return
      checkRevision.inFlight = true
      try {
        const res = await fetch('/api/catalogue-revision', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { revision?: string }
        if (typeof data.revision !== 'string') return
        // First response only establishes the baseline; it is not a change.
        if (lastRevision === null) {
          lastRevision = data.revision
          return
        }
        if (data.revision !== lastRevision) {
          lastRevision = data.revision
          ping()
        }
      } catch {
        /* offline — keep serving what we have */
      } finally {
        checkRevision.inFlight = false
      }
    }
    checkRevision.inFlight = false

    const interval = setInterval(checkRevision, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkRevision()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      unsubscribe()
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
}
