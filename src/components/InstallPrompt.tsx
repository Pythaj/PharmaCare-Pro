'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Smartphone, CheckCircle, Pill, ArrowDown, ExternalLink, Monitor, Zap, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type Platform = 'android' | 'ios' | 'desktop' | 'other';

let deferredPrompt: any = null;
let promptFired = false;

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
      promptFired = true;
      window.dispatchEvent(new Event('installpromptready'));
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      promptFired = false;
      localStorage.setItem('pharmacare_installed', 'true');
      window.dispatchEvent(new Event('appjustinstalled'));
    });
  }
}

export function useInstallState() {
  const [canInstall, setCanInstall] = useState(() => !!deferredPrompt);
  const [installed, setInstalled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return isStandalone() || localStorage.getItem('pharmacare_installed') === 'true';
  });
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('pharmacare_prompt_dismissed') === 'true';
  });

  useEffect(() => {
    const onReady = () => setCanInstall(!!deferredPrompt);
    const onInstalled = () => {
      setInstalled(true);
      setCanInstall(false);
      deferredPrompt = null;
      promptFired = false;
      localStorage.setItem('pharmacare_installed', 'true');
    };
    const onDisplayModeChange = () => {
      setInstalled(isStandalone());
    };

    if (deferredPrompt) {
      setCanInstall(true);
    }
    if (isStandalone()) {
      setInstalled(true);
    }

    window.addEventListener('installpromptready', onReady);
    window.addEventListener('appjustinstalled', onInstalled);
    window.addEventListener('beforeinstallprompt', onReady);
    window.addEventListener('appinstalled', onInstalled);
    window.matchMedia('(display-mode: standalone)').addEventListener('change', onDisplayModeChange);

    return () => {
      window.removeEventListener('installpromptready', onReady);
      window.removeEventListener('appjustinstalled', onInstalled);
      window.removeEventListener('beforeinstallprompt', onReady);
      window.removeEventListener('appinstalled', onInstalled);
      window.matchMedia('(display-mode: standalone)').removeEventListener('change', onDisplayModeChange);
    };
  }, []);

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
  promptFired = false;
  return result.outcome === 'accepted';
}

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const { canInstall, installed, dismissed } = useInstallState();
  const platform = detectPlatform();

  useEffect(() => {
    if (canInstall && !installed && !dismissed) {
      const timer = setTimeout(() => setShow(true), 1000);
      return () => clearTimeout(timer);
    }
    if (installed) {
      setShow(false);
    }
  }, [canInstall, installed, dismissed]);

  const handleInstall = useCallback(async () => {
    if (canInstall) {
      setInstalling(true);
      const success = await triggerInstall();
      setInstalling(false);
      if (success) {
        setJustInstalled(true);
        setTimeout(() => setShow(false), 2500);
      }
    } else {
      setShow(false);
    }
  }, [canInstall]);

  const handleDismiss = useCallback(() => {
    setShow(false);
    localStorage.setItem('pharmacare_prompt_dismissed', 'true');
  }, []);

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

  if (!canInstall || installed) return null;

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
