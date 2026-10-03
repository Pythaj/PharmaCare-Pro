'use client';

import { useEffect, useState } from 'react';
import { captureInstallPrompt } from './InstallPrompt';
import { isElectron } from '@/lib/electron';

export default function ServiceWorkerRegister() {
  const [updateReady, setUpdateReady] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    // Capture the beforeinstallprompt event globally (skipped in Electron —
    // the packaged desktop app has no browser install flow and must not cache
    // API responses via a service worker, which would serve stale data).
    if (!isElectron()) {
      captureInstallPrompt();
    }

    if (!isElectron() && 'serviceWorker' in navigator) {
      const registerSW = async () => {
        try {
          const reg = await navigator.serviceWorker.register('/sw.js');

          // A release is only applied when the user agrees, so ask before the
          // new worker is allowed to take over.
          //
          // The service worker's install handler deliberately does not call
          // skipWaiting(): a deploy must not replace the app underneath a
          // cashier who is part-way through a sale. Until the user confirms,
          // the new worker stays in `waiting` and the current build keeps
          // serving every request, which is why nothing below is time-critical.
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              // `controller` is null on the very first install, when there is
              // no old build to replace and nothing to prompt about.
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setWaitingWorker(newWorker);
                setUpdateReady(true);
              }
            });
          });

          // A worker can already be waiting when this component mounts — a
          // reload triggered elsewhere, or a second tab having been open since
          // the deploy. Check once so the prompt is not missed.
          if (reg.waiting && navigator.serviceWorker.controller) {
            setWaitingWorker(reg.waiting);
            setUpdateReady(true);
          }
        } catch {
          // Service worker registration failed. The app still works without it:
          // it only means no offline shell and no update prompts.
        }
      };

      if (document.readyState === 'complete') {
        registerSW();
      } else {
        window.addEventListener('load', registerSW);
      }

      // Re-check on focus. Deploys happen while a POS is left open all day, and
      // without this the update prompt only ever appears on the next reload.
      const onFocus = () => {
        navigator.serviceWorker?.getRegistration().then((reg) => {
          if (reg?.waiting && navigator.serviceWorker.controller) {
            setWaitingWorker(reg.waiting);
            setUpdateReady(true);
          }
          reg?.update().catch(() => {});
        });
      };
      window.addEventListener('focus', onFocus);
      return () => window.removeEventListener('focus', onFocus);
    }
  }, []);

  const applyUpdate = () => {
    // Tell the waiting worker it may activate, then reload once it has taken
    // over. Without the reload the old document keeps running against the new
    // controller, which is the mismatch this whole flow exists to avoid.
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true }
    );
  };

  const dismiss = () => setUpdateReady(false);

  if (!updateReady) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg border border-slate-300 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        A new version is available
      </p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Finish any sale in progress before reloading, otherwise the page will
        reload and lose what you have entered.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={applyUpdate}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          Reload now
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Later
        </button>
      </div>
    </div>
  );
}