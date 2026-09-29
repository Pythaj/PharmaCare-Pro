'use client';

import { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Smartphone, CheckCircle, Pill, ArrowDown, ExternalLink, Monitor, Zap, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isElectron } from '@/lib/electron';

export type Platform = 'android' | 'ios' | 'desktop' | 'other';

let deferredPrompt: any = null;

/**
 * `canInstall` and `installed` are not React state — they are facts about the
 * browser: a `beforeinstallprompt` event that may already have fired before the
 * first render, `localStorage`, and a media query. They used to be mirrored into
 * `useState` and re-synced inside `useEffect`, which is the shape React warns
 * about for good reason: the effect fires *after* the first paint, so a device
 * that had already been offered the prompt rendered one frame with the stale
 * value, and the catch-up `setState` caused a second render to fix it.
 *
 * `useSyncExternalStore` is the correct primitive for exactly this — it reads the
 * external source during render, so there is no wrong first frame, and it
 * re-reads only when the store actually changes. The snapshot is cached by
 * identity because `useSyncExternalStore` compares with `Object.is` and would loop
 * forever on a fresh object every call.
 */
interface InstallState {
  canInstall: boolean;
  installed: boolean;
}

const UNKNOWN_INSTALL_STATE: InstallState = { canInstall: false, installed: false };
let installSnapshot: InstallState = UNKNOWN_INSTALL_STATE;
const installListeners = new Set<() => void>();

function notifyInstallState() {
  for (const listener of installListeners) listener();
}

function readInstallState(): InstallState {
  const canInstall = !!deferredPrompt;
  const installed =
    typeof window !== 'undefined' &&
    (isStandalone() || localStorage.getItem('pharmacare_installed') === 'true');

  if (installSnapshot.canInstall !== canInstall || installSnapshot.installed !== installed) {
    installSnapshot = { canInstall, installed };
  }
  return installSnapshot;
}

function subscribeToInstallState(onStoreChange: () => void): () => void {
  installListeners.add(onStoreChange);

  const media = window.matchMedia('(display-mode: standalone)');
  const onDisplayModeChange = () => {
    localStorage.setItem('pharmacare_installed', isStandalone() ? 'true' : 'false');
    onStoreChange();
  };

  window.addEventListener('installpromptready', onStoreChange);
  window.addEventListener('appjustinstalled', onStoreChange);
  window.addEventListener('beforeinstallprompt', onStoreChange);
  window.addEventListener('appinstalled', onStoreChange);
  media.addEventListener('change', onDisplayModeChange);

  return () => {
    installListeners.delete(onStoreChange);
    window.removeEventListener('installpromptready', onStoreChange);
    window.removeEventListener('appjustinstalled', onStoreChange);
    window.removeEventListener('beforeinstallprompt', onStoreChange);
    window.removeEventListener('appinstalled', onStoreChange);
    media.removeEventListener('change', onDisplayModeChange);
  };
}

export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop';
  return 'other';
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;
}

export function captureInstallPrompt() {
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      window.dispatchEvent(new Event('installpromptready'));
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      localStorage.setItem('pharmacare_installed', 'true');
      window.dispatchEvent(new Event('appjustinstalled'));
    });
  }
}

export function useInstallState() {
  const { canInstall, installed } = useSyncExternalStore(
    subscribeToInstallState,
    readInstallState,
    // Server render: nothing is installable and nothing is installed. Hydration
    // picks up the real values through the same store, so the markup matches.
    () => UNKNOWN_INSTALL_STATE
  );

  // Dismissal is a user decision, not a browser fact, so it stays in React state
  // rather than the external store. Seeded from localStorage so a user who said
  // "not now" is not asked again on their next visit, and written back on change
  // so every `setDismissed(true)` — wherever it is called from — persists.
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('pharmacare_prompt_dismissed') === 'true';
  });

  useEffect(() => {
    if (!dismissed) return;
    localStorage.setItem('pharmacare_prompt_dismissed', 'true');
  }, [dismissed]);

  return { canInstall, installed, dismissed, setDismissed };
}

export function isInstallReady(): boolean {
  return !!deferredPrompt;
}

export async function triggerInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const result = await deferredPrompt.userChoice;
  deferredPrompt = null;
  // The browser fires `appinstalled` on success, but the consumed prompt has to
  // be reflected immediately: without this the UI keeps offering an "Install"
  // button whose prompt object no longer exists, and pressing it would silently
  // do nothing.
  notifyInstallState();
  return result.outcome === 'accepted';
}

export default function InstallPrompt() {
  // `revealed` records only the two things the user can cause: the one-second
  // delay elapsing, and the prompt being closed. Whether the prompt *should* be
  // visible is derived, not stored.
  const [revealed, setRevealed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const { canInstall, installed, dismissed, setDismissed } = useInstallState();
  const platform = detectPlatform();

  const eligible = canInstall && !installed && !dismissed && !isElectron();

  useEffect(() => {
    if (!eligible || revealed) return;
    // A one-second beat, so a cashier mid-sale is not interrupted by a dialog
    // the instant the app opens. The state change happens in the timer callback,
    // not synchronously in the effect body.
    const timer = setTimeout(() => setRevealed(true), 1000);
    return () => clearTimeout(timer);
  }, [eligible, revealed]);

  // Derived: previously this was `setShow(false)` inside the effect, which had to
  // run a second render to hide a prompt the user had just installed the app
  // away from — the install overlay would linger for a frame over the app they
  // now have on their home screen.
  const show = eligible && revealed;

  const handleInstall = useCallback(async () => {
    if (canInstall) {
      setInstalling(true);
      const success = await triggerInstall();
      setInstalling(false);
      if (success) {
        setJustInstalled(true);
        setTimeout(() => setRevealed(false), 2500);
      }
    } else {
      setRevealed(false);
    }
  }, [canInstall]);

  const handleDismiss = useCallback(() => {
    setRevealed(false);
    // Recorded in the hook, not just localStorage, so `eligible` goes false and
    // the prompt cannot re-arm on a later `canInstall` change.
    setDismissed(true);
  }, [setDismissed]);

  const isIOS = platform === 'ios';

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <button
              onClick={handleDismiss}
              className="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-white/70 hover:bg-white/30 hover:text-white transition-colors backdrop-blur-sm"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <div className="relative px-5 pb-5 pt-8 text-center bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500">
              <div className="relative z-10 mx-auto mb-3 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm shadow-lg ring-1 ring-white/20">
                  <Pill className="h-8 w-8 text-white" />
                </div>
              </div>
              <h2 className="relative z-10 text-xl font-bold text-white">Install PharmaCare Pro</h2>
              <p className="relative z-10 mt-1.5 text-sm text-white/80 max-w-xs mx-auto">
                Install for one-tap access, offline support, and a faster experience.
              </p>
              <div className="relative z-10 mt-3 flex justify-center gap-2">
                {[
                  { icon: Zap, label: 'Fast Launch' },
                  { icon: Wifi, label: 'Offline Mode' },
                  { icon: Monitor, label: 'App Icon' },
                ].map(({ icon: Icon, label }) => (
                  <span key={label} className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-medium text-white/90 backdrop-blur-sm border border-white/10">
                    <Icon className="h-3 w-3 text-emerald-200" />
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div className="p-5 space-y-3">
              {justInstalled ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center gap-2 py-4"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                    <CheckCircle className="h-7 w-7 text-emerald-600" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900">Installed!</h3>
                  <p className="text-xs text-slate-500 text-center">Launch PharmaCare Pro from your home screen.</p>
                </motion.div>
              ) : isIOS ? (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
                  <div className="flex items-start gap-3">
                    <Smartphone className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-800">Install on iPhone/iPad</p>
                      <ol className="mt-2 text-xs text-amber-700 space-y-1.5 list-decimal list-inside">
                        <li>Tap <strong>Share</strong> <span className="inline-block"><ExternalLink className="h-3 w-3 inline" /></span> in Safari</li>
                        <li>Scroll to <strong>"Add to Home Screen"</strong></li>
                        <li>Tap <strong>"Add"</strong></li>
                      </ol>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <Button
                    onClick={handleInstall}
                    disabled={installing}
                    className="relative w-full h-11 text-sm font-semibold text-white overflow-hidden rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-lg shadow-emerald-200"
                  >
                    {installing ? (
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                          className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full"
                        />
                        Installing...
                      </span>
                    ) : (
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        <Download className="h-4 w-4" />
                        Install App
                      </span>
                    )}
                  </Button>
                  <Button
                    onClick={handleDismiss}
                    variant="ghost"
                    className="w-full h-9 text-xs text-slate-400 hover:text-slate-600"
                  >
                    Not now
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function InstallFAB() {
  const { canInstall, installed, dismissed } = useInstallState();
  const [showPrompt, setShowPrompt] = useState(false);

  if (!canInstall || installed || isElectron()) return null;

  return (
    <>
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowPrompt(true)}
        className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg shadow-emerald-500/30 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400"
      >
        <ArrowDown className="h-5 w-5" />
      </motion.button>
      <AnimatePresence>
        {showPrompt && (
          <InstallPromptOverlay onClose={() => setShowPrompt(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

function InstallPromptOverlay({ onClose }: { onClose: () => void }) {
  const platform = detectPlatform();
  const [installing, setInstalling] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const { canInstall } = useInstallState();
  const isIOS = platform === 'ios';

  const handleInstall = useCallback(async () => {
    if (canInstall) {
      setInstalling(true);
      const success = await triggerInstall();
      setInstalling(false);
      if (success) {
        setJustInstalled(true);
        setTimeout(() => onClose(), 2000);
      }
    }
  }, [canInstall, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="text-center mb-4">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 shadow-lg shadow-emerald-200">
            <Download className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-bold text-slate-900">Install App</h3>
          <p className="mt-1 text-xs text-slate-500">Add PharmaCare Pro to your home screen</p>
        </div>

        {justInstalled ? (
          <div className="flex flex-col items-center gap-2 py-3">
            <CheckCircle className="h-8 w-8 text-emerald-500" />
            <p className="text-sm font-medium text-emerald-700">Installed!</p>
          </div>
        ) : isIOS ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-800 mb-3">
            <p>Tap <strong>Share</strong> <ExternalLink className="h-3 w-3 inline" /> in Safari, then <strong>"Add to Home Screen"</strong>.</p>
          </div>
        ) : (
          <Button
            onClick={handleInstall}
            disabled={installing}
            className="w-full h-10 text-sm font-semibold text-white mb-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-lg shadow-emerald-200"
          >
            {installing ? 'Installing...' : 'Install Now'}
          </Button>
        )}

        <Button onClick={onClose} variant="ghost" className="w-full h-9 text-xs text-slate-400">
          Close
        </Button>
      </motion.div>
    </motion.div>
  );
}
