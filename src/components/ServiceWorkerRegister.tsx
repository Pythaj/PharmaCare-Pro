'use client';

import { useEffect } from 'react';
import { captureInstallPrompt } from './InstallPrompt';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    // Capture the beforeinstallprompt event globally
    captureInstallPrompt();

    if ('serviceWorker' in navigator) {
      const registerSW = async () => {
        try {
          const reg = await navigator.serviceWorker.register('/sw.js');

          // Check for updates on page load
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New version available - could show update notification
                  console.log('New version available. Refresh to update.');
                }
              });
            }
          });
        } catch {
          // Service worker registration failed silently
        }
      };

      if (document.readyState === 'complete') {
        registerSW();
      } else {
        window.addEventListener('load', registerSW);
      }
    }
  }, []);

  return null;
}
